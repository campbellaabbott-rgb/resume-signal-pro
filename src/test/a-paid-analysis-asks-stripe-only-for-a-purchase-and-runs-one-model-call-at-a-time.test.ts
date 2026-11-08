// @vitest-environment node
/**
 * A PAID ANALYSIS ASKS STRIPE ONLY FOR A PURCHASE, AND RUNS ONE MODEL CALL AT
 * A TIME (hotfix 2026-11-10: H3 M-S14-050 and C-S14-003's analyze-resume
 * half; M-S14-005, C-S14-005).
 *
 * What was wrong, run against the shipped handler (helpers/analyze-resume-harness):
 *   - any string as a session id was read from Stripe with the live key, so a
 *     loop spent the account's read limit, which the checkouts and the
 *     webhook share;
 *   - every reload of a delivered analysis read Stripe again before our own
 *     rows answered it;
 *   - Stripe reads were counted nowhere, and the shared per-address budget
 *     refused a paying buyer 429 before the payment was looked at;
 *   - two requests for one purchase (two tabs, a double click, a retry while
 *     the first was still working) each started a model run.
 * What holds now: a reference that cannot be a purchase is refused with no
 * read; a delivered analysis is answered from our rows with no read; every
 * read is counted under analyze-resume's own name, and a count that cannot be
 * taken refuses: per network for an id our records do not know, and by the
 * purchase for one the webhook claimed or create-checkout minted, so strangers
 * on the buyer's network cannot lock the buyer out (review of M-S14-050);
 * the shared budget refuses nobody here; a
 * second request while a run holds the session's lease is told 409
 * analysis_in_progress and gets the first run's analysis when it asks again;
 * a failed run frees the session, so a failure still uses nothing up.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";
import { claimRunLease, purchaseRefOf, releaseRunLease, RUN_LEASE_TABLE } from "../../supabase/functions/analyze-resume/paid-run";
import { FakeDb } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });

let h: Harness;
let reads: string[];
let realRetrieve: (id: string) => Promise<unknown>;
const g = globalThis as unknown as { __fakeStripe: { retrieve: (id: string) => Promise<unknown> } };

beforeAll(async () => {
  h = await analyzeResumeHarness();
  realRetrieve = g.__fakeStripe.retrieve;
}, 60_000);
beforeEach(() => {
  h.reset();
  reads = [];
  g.__fakeStripe.retrieve = (id: string) => { reads.push(id); return realRetrieve(id); };
});
afterEach(() => { g.__fakeStripe.retrieve = realRetrieve; });

const buy = (id: string) => { h.sessions.set(id, fullAnalysisSession(id)); return id; };

describe("Stripe is asked only about something that can be a purchase", () => {
  it.each([
    ["a word", "not-a-session"],
    ["a link", "https://example.com/cs_live_x"],
    ["an id far too long", `cs_live_${"a".repeat(300)}`],
    ["an id with a slash", "cs_live_abc/../x"],
    ["a malformed Pro grant", "pro_not-a-uuid"],
  ])("%s is refused before any Stripe read", async (_label, sessionId) => {
    const r = await h.call({ resumeText: RESUME, sessionId });
    expect(r.status).toBe(401);
    expect(reads, `Stripe was read for ${sessionId}`).toEqual([]);
    expect(h.aiCalls()).toBe(0);
  });

  it("the shapes a purchase takes are recognised", () => {
    expect(purchaseRefOf("cs_live_a1B2c3")).toEqual({ kind: "checkout", id: "cs_live_a1B2c3" });
    expect(purchaseRefOf("pro_8a6f7d3e-1b2c-4d5e-9f00-112233445566")).toMatchObject({ kind: "pro", grantId: "8a6f7d3e-1b2c-4d5e-9f00-112233445566" });
    expect(purchaseRefOf(42)).toBeNull();
  });
});

describe("a delivered analysis is answered from our own rows", () => {
  it("a reload of a delivered purchase reads Stripe no more", async () => {
    const id = buy("cs_live_delivered_once");
    const first = await h.call({ resumeText: RESUME, sessionId: id });
    expect(first.status).toBe(200);
    expect(reads).toEqual([id]);
    for (let i = 0; i < 3; i++) {
      const again = await h.call({ resumeText: "", sessionId: id });
      expect(again.status).toBe(200);
      expect(again.json.alreadyDelivered).toBe(true);
      expect(again.json.shareId).toBe(first.json.shareId);
    }
    expect(reads, "a delivered purchase was read from Stripe again").toEqual([id]);
    expect(h.aiCalls()).toBe(1);
  });
});

describe("every Stripe read is counted, under analyze-resume's own name", () => {
  it("the count is taken per network, before the read", async () => {
    const counted: Array<Record<string, unknown>> = [];
    h.db.rpcs.check_rate_limit = (a) => { counted.push(a); return { data: true, error: null }; };
    const id = buy("cs_live_counted");
    expect((await h.call({ resumeText: RESUME, sessionId: id })).status).toBe(200);
    expect(counted).toHaveLength(1);
    expect(counted[0].p_function).toBe("analyze-resume");
    expect(String(counted[0].p_ip)).toMatch(/^[0-9a-f]{32}$/);
    expect(String(counted[0].p_ip), "the bucket names the caller's address").not.toContain("203.0.113");
  });

  it("a count that cannot be taken refuses, and Stripe is not read blind", async () => {
    h.db.rpcs.check_rate_limit = () => ({ data: null, error: { code: "57014", message: "statement timeout" } });
    const r = await h.call({ resumeText: RESUME, sessionId: buy("cs_live_count_down") });
    expect(r.status).toBe(503);
    expect(reads).toEqual([]);
    expect(h.aiCalls()).toBe(0);
  });

  it("a network that spent its reads is told when to come back, and Stripe is not read", async () => {
    h.db.rpcs.check_rate_limit = () => ({ data: false, error: null });
    const r = await h.call({ resumeText: RESUME, sessionId: buy("cs_live_count_spent") });
    expect(r.status).toBe(429);
    expect(r.json.code).toBe("rate_limited_stripe_reads");
    expect(reads).toEqual([]);
  });

  /** check_rate_limit as the database answers it: the buyer's network spent by strangers, every purchase's own allowance free. */
  function networkSpentByStrangers() {
    const counted: Array<Record<string, unknown>> = [];
    h.db.rpcs.check_rate_limit = (a) => { counted.push(a); return { data: a.p_function !== "analyze-resume", error: null }; };
    return counted;
  }

  it("a purchase create-checkout minted is read even when strangers on the buyer's network spent the network's reads", async () => {
    const counted = networkSpentByStrangers();
    const id = buy("cs_live_minted_on_shared_network");
    h.db.rows("checkout_starts").push({ stripe_session_id: id, product_type: "full_analysis", metadata: {} });
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(reads).toEqual([id]);
    expect(counted).toHaveLength(1);
    expect(counted[0].p_function).toBe("analyze-resume:purchase");
    expect(String(counted[0].p_ip)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("a purchase the webhook already claimed is read the same way, by its own allowance", async () => {
    const counted = networkSpentByStrangers();
    const id = buy("cs_live_claimed_on_shared_network");
    h.db.rows("used_stripe_sessions").push({ session_id: id, product_type: "full_analysis", ip_address: null });
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(counted.map((c) => c.p_function)).toEqual(["analyze-resume:purchase"]);
  });

  it("an id our records do not know still spends only its network's allowance, and a spent one reads nothing", async () => {
    const counted = networkSpentByStrangers();
    const r = await h.call({ resumeText: RESUME, sessionId: buy("cs_live_invented_by_a_stranger") });
    expect(r.status).toBe(429);
    expect(r.json.code).toBe("rate_limited_stripe_reads");
    expect(counted.map((c) => c.p_function)).toEqual(["analyze-resume"]);
    expect(reads).toEqual([]);
  });

  it("a known purchase's own allowance is bounded too, and a start for another product is not this purchase", async () => {
    const id = buy("cs_live_minted_retried");
    h.db.rows("checkout_starts").push({ stripe_session_id: id, product_type: "full_analysis", metadata: {} });
    h.db.rpcs.check_rate_limit = () => ({ data: false, error: null });
    expect((await h.call({ resumeText: RESUME, sessionId: id })).status).toBe(429);
    expect(reads).toEqual([]);
    const counted = networkSpentByStrangers();
    const pack = buy("cs_live_scan_pack_start");
    h.db.rows("checkout_starts").push({ stripe_session_id: pack, product_type: "scan_pack", metadata: {} });
    expect((await h.call({ resumeText: RESUME, sessionId: pack })).status).toBe(429);
    expect(counted.map((c) => c.p_function)).toEqual(["analyze-resume"]);
  });

  it("the shared per-address budget refuses a paying buyer nothing", async () => {
    let asked = 0;
    h.db.rpcs.check_global_rate_limit = () => { asked++; return { data: false, error: null }; };
    const r = await h.call({ resumeText: RESUME, sessionId: buy("cs_live_busy_household") });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(asked, "analyze-resume still asked the shared budget").toBe(0);
  });
});

describe("one model run per purchase at a time", () => {
  it("a second request while the first runs is told it is in progress, costs no Stripe read, and then gets the first run's analysis", async () => {
    const id = buy("cs_live_two_tabs");
    let open!: () => void;
    h.aiPlan.push(new Promise<void>((r) => { open = r; }));
    const first = h.call({ resumeText: RESUME, sessionId: id });
    try {
      await vi.waitFor(() => expect(h.aiCalls()).toBe(1), { timeout: 3_000, interval: 5 });
    } catch (e) {
      open();
      await first;
      throw e;
    }
    const readsBefore = reads.length;
    const second = await h.call({ resumeText: `${RESUME} second tab`, sessionId: id });
    expect(second.status).toBe(409);
    expect(second.json).toMatchObject({ code: "analysis_in_progress", retryable: true });
    expect(reads.length, "the in-progress answer read Stripe").toBe(readsBefore);
    open();
    const done = await first;
    expect(done.status).toBe(200);
    const asked = await h.call({ resumeText: `${RESUME} second tab`, sessionId: id });
    expect(asked.status).toBe(200);
    expect(asked.json.alreadyDelivered).toBe(true);
    expect(asked.json.shareId).toBe(done.json.shareId);
    expect(h.aiCalls(), "a second model run was paid for one purchase").toBe(1);
    expect(h.db.rows(RUN_LEASE_TABLE), "the lease outlived its run").toEqual([]);
  });

  it("a run that fails frees its session, so the next ask runs again", async () => {
    const id = buy("cs_live_fail_then_retry");
    h.aiPlan.push(500);
    const failed = await h.call({ resumeText: RESUME, sessionId: id });
    expect(failed.status).toBe(500);
    expect(h.db.writes.some((w) => w.table === RUN_LEASE_TABLE && w.op === "insert"), "the run took no lease").toBe(true);
    expect(h.db.rows(RUN_LEASE_TABLE), "a failed run kept its session locked").toEqual([]);
    const retried = await h.call({ resumeText: RESUME, sessionId: id });
    expect(retried.status, JSON.stringify(retried.json)).toBe(200);
  });

  it("a live lease held by another run answers in progress; one left by a killed run is taken over once it lapses", async () => {
    const id = buy("cs_live_killed_run");
    h.db.rows(RUN_LEASE_TABLE).push({ session_id: id, holder: "00000000-0000-4000-8000-000000000001", expires_at: new Date(Date.now() + 60_000).toISOString() });
    const busy = await h.call({ resumeText: RESUME, sessionId: id });
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe("analysis_in_progress");
    expect(h.aiCalls()).toBe(0);
    h.db.tables[RUN_LEASE_TABLE] = [{ session_id: id, holder: "00000000-0000-4000-8000-000000000001", expires_at: new Date(Date.now() - 1_000).toISOString() }];
    const taken = await h.call({ resumeText: RESUME, sessionId: id });
    expect(taken.status, JSON.stringify(taken.json)).toBe(200);
    expect(h.aiCalls()).toBe(1);
    expect(h.db.rows(RUN_LEASE_TABLE)).toEqual([]);
  });
});

describe("the lease helpers", () => {
  it("one taker wins a free session; a second is busy; only the holder frees it", async () => {
    const db = new FakeDb({ [RUN_LEASE_TABLE]: ["session_id"] });
    expect(await claimRunLease(db, "cs_live_x", "holder-a")).toBe("claimed");
    expect(await claimRunLease(db, "cs_live_x", "holder-b")).toBe("busy");
    await releaseRunLease(db, "cs_live_x", "holder-b");
    expect(db.rows(RUN_LEASE_TABLE)).toHaveLength(1);
    await releaseRunLease(db, "cs_live_x", "holder-a");
    expect(db.rows(RUN_LEASE_TABLE)).toHaveLength(0);
  });

  it("a table that cannot be written is 'unavailable', never a refusal", async () => {
    const db = new FakeDb({ [RUN_LEASE_TABLE]: ["session_id"] });
    db.faults.push({ table: RUN_LEASE_TABLE, op: "insert", error: { code: "42P01", message: "missing" } });
    expect(await claimRunLease(db, "cs_live_y", "holder-a")).toBe("unavailable");
  });
});
