// @vitest-environment node
/**
 * A ZERO-RESULT ALERT SAYS "WE FOUND IT" WHEN THE FIRST MATCH ARRIVES (audit
 * 2026-10-31, S13-083), AND AN OLD AGENT-READY SEARCH IS NOT NARROWED (S13-118,
 * the digest half).
 *
 * WHAT WAS WRONG. "Alert me when this exists" saves a search with no results,
 * on a daily digest. The subject written for the moment it finally matches was
 * keyed on the search's window stamp being empty, and the claim stamps every
 * run, the empty ones too: by its first real match the stamp was weeks old, so
 * the mail nobody is waiting harder for read like any other. And a search saved
 * while the board offered an "agent-ready" filter still carried it, so the
 * digest kept narrowing it to the vendors the retired agent could send to.
 *
 * WHAT HOLDS NOW, by running the shipped handler (board, Resend and the
 * database faked): the subject asks whether a match was ever mailed
 * (search_digest_sent), a read that fails is not "never", and the old flag
 * reaches neither the board nor the mail's link, present or not.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const SID = "5e7a0c1d-1111-4111-8111-111111111111";
type Sent = { to: string; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
const boardBodies: Array<Record<string, unknown>> = [];
let search: EdgeHandler;

const job = (id: string) => ({ id, company: "Acme", title: `Nurse ${id}`, location: "Leeds", applyUrl: `https://acme.example/${id}`, postedAt: "2026-11-01T00:00:00Z" });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__zrSent = sent;
  g.__zrDb = db;
  (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => ({ data: { user: { email: "seeker@example.com" } }, error: null }) } };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (!String(url).endsWith("/functions/v1/job-board")) throw new Error(`unexpected fetch ${url}`);
    const b = JSON.parse(init.body);
    boardBodies.push(b);
    return new Response(JSON.stringify(b.countOnly ? { total: 2, newSince: b.newSince } : { jobs: [job("a"), job("b")], newSince: b.newSince }), { status: 200 });
  };
  search = await loadEdgeHandler("send-search-digest", {
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__zrDb;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__zrSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

afterEach(() => {
  sent.length = 0; boardBodies.length = 0;
  db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = [];
});

/** A daily search whose claim stamped it weeks ago, on a run that found nothing. */
function install(extra: Record<string, unknown> = {}) {
  let handed = false;
  db.rpcs.search_digest_claim_batch = () => {
    if (handed) return { data: [], error: null };
    handed = true;
    return { data: [{ sd_id: SID, sd_user_id: "abcd-user", sd_name: "Nurse jobs", sd_params: { q: "nurse" }, sd_prev_sent_at: "2026-10-06T14:23:00.000Z", sd_fit_threshold: 0, sd_cadence: "daily", ...extra }], error: null };
  };
  db.rpcs.search_digest_record_sent = (a) => ({ data: (a.p_posting_ids as string[]).length, error: null });
  db.rows("user_job_searches").push({ id: SID, digest_last_sent_at: "2026-11-03T14:23:00.000Z", digest_opt_in: true, created_at: "2026-10-20T09:00:00.000Z" });
}
const run = () => search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));

describe("the subject of a zero-result alert's first match", () => {
  it("a daily search whose empty runs stamped it, with nothing ever mailed, says We found it", async () => {
    install();
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("We found it: 2 matches for “Nurse jobs”");
  });

  it("a daily search that has been mailed before gets the plain subject", async () => {
    install();
    db.rows("search_digest_sent").push({ search_id: SID, posting_id: "older" });
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("2 new nurse matches — Nurse jobs");
  });

  it("another search's mailed postings do not count as this one's", async () => {
    install();
    db.rows("search_digest_sent").push({ search_id: "another-search", posting_id: "older" });
    await run();
    expect(sent[0].subject).toMatch(/^We found it/);
  });

  it("a read that failed is not never: the plain subject, and the mail still goes", async () => {
    install();
    // The run reads this table twice: which postings went (a failure there gives
    // the claim back, as it always has), then whether any ever did.
    const realFrom = db.from.bind(db);
    let reads = 0;
    db.from = ((table: string) => {
      if (table === "search_digest_sent" && ++reads === 2) db.faults.push({ table, op: "select", error: { code: "57014", message: "fake: timed out" } });
      return realFrom(table);
    }) as typeof db.from;
    try { await run(); } finally { db.from = realFrom; }
    expect(reads).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("2 new nurse matches — Nurse jobs");
  });

  it("a first-ever run that already has matches is an ordinary watch, not a wait that ended: the plain subject", async () => {
    install({ sd_prev_sent_at: null });
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("2 new nurse matches — Nurse jobs");
  });

  it("a search older than the record of what was mailed may have been mailed: the plain subject", async () => {
    install();
    db.rows("user_job_searches")[0].created_at = "2026-09-20T09:00:00.000Z";
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("2 new nurse matches — Nurse jobs");
  });

  it("a search whose age cannot be read is not called a first match, and the mail still goes", async () => {
    install();
    const realFrom = db.from.bind(db);
    db.from = ((table: string) => {
      if (table === "user_job_searches") db.faults.push({ table, op: "select", error: { code: "57014", message: "fake: timed out" } });
      return realFrom(table);
    }) as typeof db.from;
    try { await run(); } finally { db.from = realFrom; }
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).not.toMatch(/We found it/);
  });

  it("a weekly search never says We found it", async () => {
    install({ sd_cadence: "weekly" });
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).not.toMatch(/We found it/);
  });
});

describe("a search saved with the old agent-ready flag", () => {
  it("is not narrowed: the flag reaches neither the board nor the mail's link", async () => {
    install({ sd_params: { q: "nurse", sendableOnly: true } });
    await run();
    expect(boardBodies.length).toBeGreaterThan(0);
    for (const b of boardBodies) {
      expect(b, "the board was asked for sendable vendors only").not.toHaveProperty("sendableOnly");
      expect(b).not.toHaveProperty("agentOnly");
      expect(b.q).toBe("nurse");
    }
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toMatch(/sendable|agent=1|agentOnly/i);
  });

  it("a search without the flag asks the board the same question", async () => {
    install({ sd_params: { q: "nurse", sendableOnly: true } });
    await run();
    const withFlag = JSON.stringify(boardBodies);
    const mailWithFlag = sent[0].html;
    sent.length = 0; boardBodies.length = 0; db.tables = {};
    install({ sd_params: { q: "nurse" } });
    await run();
    expect(JSON.stringify(boardBodies)).toBe(withFlag);
    expect(sent[0].html).toBe(mailWithFlag);
  });
});
