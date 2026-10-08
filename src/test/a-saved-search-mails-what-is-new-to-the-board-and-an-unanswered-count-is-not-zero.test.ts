// @vitest-environment node
/**
 * A SAVED SEARCH MAILS WHAT IS NEW TO THE BOARD, AND AN UNANSWERED COUNT IS
 * NOT ZERO (wave 2 email-ops, register L10-02, L10-03, L10-14, L11-01).
 *
 * WHAT WAS WRONG.
 *   L10-03  send-search-digest read a failed board call (callBoard never
 *           checked r.ok and its .catch returned null), a {total:null,
 *           countUnavailable:true} answer, or a null candidate list as "zero
 *           new" -- and kept the claim's advanced stamp, so that window's
 *           matches were never sent. A board hiccup during the run deleted a
 *           day or a week of alerts per saved search.
 *   L10-02  the window was postedAfter = the last send, bound to the
 *           EMPLOYER's stated date. A posting dated three days ago and first
 *           read by us today was outside every later window, and an undated
 *           posting could never enter one, so a watch on an employer whose feed
 *           gives no dates never fired.
 *   L10-14  the unsubscribe link unsubscribed on a bare GET (mail link
 *           scanners follow every link) and answered HTML that Supabase serves
 *           as text/plain on its own domain.
 *   L11-01  no cron job existed, so nothing above ever ran.
 *
 * WHAT HOLDS NOW, by running the shipped handler with the board, Resend and
 * the database faked, and by applying the two migrations to pglite.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bootEmailOpsDb, migration, rows, splitVerify } from "./helpers/email-ops-db";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
type Sent = { to: string; subject: string; html: string; headers?: Record<string, string> };
const sent: Sent[] = [];
const failFor = new Set<string>();
const db = new FakeDb();
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const boardBodies: Array<Record<string, unknown>> = [];
/** How the fake board answers a request body. */
let board: (b: Record<string, unknown>) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
let search: EdgeHandler;

const PREV = "2026-10-06T14:23:00.000Z";
const SID = "5e7a0c1d-1111-4111-8111-111111111111";
const claimed = (extra: Record<string, unknown> = {}) => ({
  sd_id: SID, sd_user_id: "abcd-user", sd_name: "Nurse jobs", sd_params: { q: "nurse" },
  sd_prev_sent_at: PREV, sd_fit_threshold: 0, sd_cadence: "daily", ...extra,
});
const job = (id: string, postedAt: string | null) => ({ id, company: "Acme", title: `Nurse ${id}`, location: "Leeds", applyUrl: `https://acme.example/${id}`, postedAt });
/** A board that applied the window it was asked for, and says so. */
const echoing = (total: number, jobs: unknown[]) => (b: Record<string, unknown>) =>
  ({ status: 200, body: b.countOnly ? { total, newSince: b.newSince } : { jobs, newSince: b.newSince } });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__sdSent = sent;
  g.__sdFail = failFor;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = {
    admin: { getUserById: async () => ({ data: { user: { email: "seeker@example.com" } }, error: null }) },
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      boardBodies.push(b);
      const a = board(b);
      return new Response(JSON.stringify(a.body), { status: a.status });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  search = await loadEdgeHandler("send-search-digest", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0":
      "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__sdSent.push(m); return globalThis.__sdFail.has(m.to) ? { data: null, error: { message: 'bounced' } } : { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

afterEach(() => {
  sent.length = 0; calls.length = 0; boardBodies.length = 0; failFor.clear();
  db.tables = {}; db.writes = []; db.rpcs = {};
  board = () => ({ status: 200, body: {} });
});

function install(extra: Record<string, unknown> = {}) {
  const rpc = (name: string, impl: (a: Record<string, unknown>) => unknown) => {
    db.rpcs[name] = (args) => { calls.push({ name, args }); return { data: impl(args), error: null }; };
  };
  rpc("search_digest_claim_batch", () => [claimed(extra)]);
  rpc("search_digest_record_sent", (a) => (a.p_posting_ids as string[]).length);
  // The claim stamped the row; a give-back restores PREV.
  db.rows("user_job_searches").push({ id: SID, digest_last_sent_at: "2026-10-07T14:23:00.000Z", digest_opt_in: true });
}
const run = () => search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));
const stamp = () => db.rows("user_job_searches")[0].digest_last_sent_at;

describe("L10-03: a count the board could not give is not zero", () => {
  const unanswered: Array<[string, (b: Record<string, unknown>) => { status: number; body: unknown }]> = [
    ["a 500", () => ({ status: 500, body: { error: "boom" } })],
    ["countUnavailable", (b) => ({ status: 200, body: { total: null, countUnavailable: true, newSince: b.newSince } })],
    ["no total at all", (b) => ({ status: 200, body: { newSince: b.newSince } })],
    ["a bundle that ignored the window (no echo)", () => ({ status: 200, body: { total: 4 } })],
  ];
  for (const [name, answer] of unanswered) {
    it(`${name}: nothing is sent and the claim is given back, so the next run retries the same window`, async () => {
      install();
      board = answer;
      expect(await (await run()).json()).toMatchObject({ sent: 0, skipped: 1 });
      expect(sent).toEqual([]);
      expect(stamp(), "the window's matches were deleted by the advanced stamp").toBe(PREV);
    });
  }

  it("a list the board could not give, after a count that said there was something, gives the claim back", async () => {
    install();
    board = (b) => (b.countOnly ? { status: 200, body: { total: 3, newSince: b.newSince } } : { status: 502, body: {} });
    await run();
    expect(sent).toEqual([]);
    expect(stamp()).toBe(PREV);
  });

  it("strong mode: a candidate list that never arrived is not 'nothing cleared the bar'", async () => {
    install({ sd_fit_threshold: 70 });
    db.rows("user_profiles").push({ user_id: "abcd-user", matching_resume_text: "x".repeat(200), matching_scan_id: null });
    board = (b) => (b.countOnly ? { status: 200, body: { total: 3, newSince: b.newSince } } : { status: 503, body: {} });
    await run();
    expect(sent).toEqual([]);
    expect(stamp()).toBe(PREV);
  });

  it("a real zero still advances the window, as before", async () => {
    install();
    board = echoing(0, []);
    await run();
    expect(sent).toEqual([]);
    expect(db.writes.filter((w) => w.table === "user_job_searches")).toEqual([]);
  });
});

describe("L10-02: the window is discovery time, and what was mailed is not mailed again", () => {
  it("asks the board for newSince = the last send, never postedAfter", async () => {
    install();
    board = echoing(1, [job("j1", "2026-10-03T00:00:00Z")]);
    await run();
    expect(boardBodies.length).toBeGreaterThan(0);
    for (const b of boardBodies) {
      expect(b.newSince, "the digest windowed on the employer's date").toBe(PREV);
      expect(b).not.toHaveProperty("postedAfter");
    }
  });

  it("mails a posting the employer dated days ago and a posting with no date, when the board first read them since the last send", async () => {
    install();
    board = echoing(2, [job("late", "2026-10-02T00:00:00Z"), job("undated", null)]);
    expect(await (await run()).json()).toMatchObject({ sent: 1 });
    expect(sent[0].html).toContain("Nurse late");
    expect(sent[0].html).toContain("Nurse undated");
    expect(sent[0].subject).toMatch(/^2 new /);
  });

  it("drops what this search already mailed, counts only the rest, and records what it mailed after the send", async () => {
    install();
    db.rows("search_digest_sent").push({ search_id: SID, posting_id: "old" });
    board = echoing(3, [job("old", "2026-10-07T00:00:00Z"), job("n1", "2026-10-07T00:00:00Z"), job("n2", null)]);
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain("Nurse old");
    expect(sent[0].subject, "the count is the fresh rows, not the board's 3").toMatch(/^2 new /);
    const rec = calls.filter((c) => c.name === "search_digest_record_sent");
    expect(rec.map((c) => c.args)).toEqual([{ p_search_id: SID, p_posting_ids: ["n1", "n2"] }]);
  });

  it("a window holding only postings already mailed sends nothing", async () => {
    install();
    db.rows("search_digest_sent").push({ search_id: SID, posting_id: "a" });
    board = echoing(1, [job("a", "2026-10-07T00:00:00Z")]);
    await run();
    expect(sent).toEqual([]);
    expect(calls.filter((c) => c.name === "search_digest_record_sent")).toEqual([]);
  });

  it("a failed send records nothing and gives the claim back", async () => {
    install();
    failFor.add("seeker@example.com");
    board = echoing(1, [job("j1", null)]);
    await run();
    expect(calls.filter((c) => c.name === "search_digest_record_sent")).toEqual([]);
    expect(stamp()).toBe(PREV);
  });
});

describe("L10-14: unsubscribing is a button or a one-click POST, never a GET", () => {
  const token = async (id: string) => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id.toLowerCase()));
    return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  it("a GET on the old link (what a mail scanner follows) changes nothing and redirects to the confirm page on our domain", async () => {
    db.rows("user_job_searches").push({ id: SID, digest_opt_in: true });
    const t = await token(SID);
    const res = await search(new Request(`https://harness.supabase.co/functions/v1/send-search-digest?action=unsubscribe&id=${SID}&token=${t}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://resumebooster.work/email/unsubscribe#list=search-digest&id=${SID}&token=${t}`);
    expect(db.writes).toEqual([]);
    expect(db.rows("user_job_searches")[0].digest_opt_in).toBe(true);
  });

  it("the mail client's one-click POST (RFC 8058) unsubscribes; a forged token does not", async () => {
    db.rows("user_job_searches").push({ id: SID, digest_opt_in: true });
    const bad = await search(new Request(`https://harness.supabase.co/functions/v1/send-search-digest?action=unsubscribe&id=${SID}&token=${"0".repeat(32)}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click",
    }));
    expect(bad.status).toBe(400);
    expect(db.rows("user_job_searches")[0].digest_opt_in).toBe(true);
    const ok = await search(new Request(`https://harness.supabase.co/functions/v1/send-search-digest?action=unsubscribe&id=${SID}&token=${await token(SID)}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click",
    }));
    expect(await ok.json()).toEqual({ unsubscribed: true });
    expect(db.rows("user_job_searches")[0].digest_opt_in).toBe(false);
  });

  it("the confirm page's POST {action:'unsubscribe', id, token} unsubscribes", async () => {
    db.rows("user_job_searches").push({ id: SID, digest_opt_in: true });
    const res = await search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", id: SID, token: await token(SID) }),
    }));
    expect(res.status).toBe(200);
    expect(db.rows("user_job_searches")[0].digest_opt_in).toBe(false);
  });

  it("every digest links the confirm page and carries List-Unsubscribe and List-Unsubscribe-Post", async () => {
    install();
    board = echoing(1, [job("j1", null)]);
    await run();
    const t = await token(SID);
    expect(sent[0].html).toContain(`https://resumebooster.work/email/unsubscribe#list=search-digest&amp;id=${SID}&amp;token=${t}`);
    expect(sent[0].html).not.toContain("supabase.co/functions/v1/send-search-digest?action=unsubscribe");
    expect(sent[0].headers).toEqual({
      "List-Unsubscribe": `<https://harness.supabase.co/functions/v1/send-search-digest?action=unsubscribe&id=${SID}&token=${t}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("the sent-id ledger, applied to pglite (20261008120000)", () => {
  it("records ids once, refreshes a repeat, prunes this search's rows past 30 days, and is closed to the client roles", async () => {
    const pg = await bootEmailOpsDb({ apply: ["20261008120000"] });
    const [{ id }] = await rows<{ id: string }>(pg, "INSERT INTO public.user_job_searches (user_id, name) VALUES (gen_random_uuid(), 's') RETURNING id");
    await pg.query("INSERT INTO public.search_digest_sent (search_id, posting_id, sent_at) VALUES ($1, 'stale', now() - interval '31 days'), ($1, 'kept', now() - interval '5 days')", [id]);
    const [{ n }] = await rows<{ n: number }>(pg, "SELECT public.search_digest_record_sent($1, ARRAY['a', 'b', 'a', 'kept']) AS n", [id]);
    expect(n).toBe(3);
    const ids = (await rows<{ posting_id: string }>(pg, "SELECT posting_id FROM public.search_digest_sent WHERE search_id = $1 ORDER BY posting_id", [id])).map((r) => r.posting_id);
    expect(ids).toEqual(["a", "b", "kept"]);
    const acl = await rows<{ anon_t: boolean; auth_t: boolean; anon_f: boolean; svc_f: boolean }>(pg, `
      SELECT has_table_privilege('anon', 'public.search_digest_sent', 'SELECT') AS anon_t,
             has_table_privilege('authenticated', 'public.search_digest_sent', 'SELECT') AS auth_t,
             has_function_privilege('anon', 'public.search_digest_record_sent(uuid,text[])', 'EXECUTE') AS anon_f,
             has_function_privilege('service_role', 'public.search_digest_record_sent(uuid,text[])', 'EXECUTE') AS svc_f`);
    expect(acl[0]).toEqual({ anon_t: false, auth_t: false, anon_f: false, svc_f: true });
    await pg.exec(migration("20261008120000"));
  }, 60_000);
});

describe("L11-01: both digests are scheduled with the cron key (20261008125000)", () => {
  it("creates the two jobs where none existed, each posting to its own function with x-email-cron, and is safe to re-run", async () => {
    const pg = await bootEmailOpsDb({ cron: true });
    expect(await rows(pg, "SELECT jobname FROM cron.job")).toEqual([]);
    await pg.exec(migration("20261008125000"));
    await pg.exec(migration("20261008125000"));
    const jobs = await rows<{ jobname: string; schedule: string; command: string }>(pg, "SELECT jobname, schedule, command FROM cron.job ORDER BY jobname");
    expect(jobs.map((j) => [j.jobname, j.schedule])).toEqual([["industry-corrections-digest", "15 9 * * 1"], ["send-search-digest", "23 14 * * *"]]);
    for (const j of jobs) {
      expect(j.command).toMatch(/'x-email-cron', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'email_cron_key'/);
      expect(j.command).toContain(`/functions/v1/${j.jobname}'`);
      expect(j.command).toContain(`'{"action":"send"}'::jsonb`);
    }
  }, 60_000);

  it("the self-check refuses a job edited back to no key", async () => {
    const pg = await bootEmailOpsDb({ cron: true });
    const [apply, verify] = splitVerify(migration("20261008125000"));
    await pg.exec(apply);
    await pg.query("UPDATE cron.job SET command = 'SELECT net.http_post(url := ''https://x/functions/v1/send-search-digest'')' WHERE jobname = 'send-search-digest'");
    await expect(pg.exec(verify)).rejects.toThrow(/the send-search-digest cron does not post to its function with the email cron key/);
  }, 60_000);
});
