// @vitest-environment node
/**
 * SEARCHES THE DIGEST HANDED BACK HELD THE HEAD OF THE QUEUE (review of
 * wave3/email-ops, 2026-10-10, on the S8-052 clock).
 *
 * WHAT WAS WRONG. search_digest_claim_batch orders due searches by their stamp,
 * NULLS FIRST, and hands back any row whose stamp is due. The digest claimed 25
 * at a time and restored a skipped row's stamp AT ONCE: an owner who is
 * suppressed, or a search the board cannot count, was due again before the
 * next claim, which returned the same 25 rows. All of them were already seen,
 * so the run stopped. Twenty-five such searches at the head of the queue were
 * enough for every run to consider the same 25, send nothing and never reach
 * the rest.
 *
 * WHAT HOLDS NOW, running the shipped handler against a claim that behaves as
 * the SQL does (due when NULL or past the cadence floor, NULLS FIRST then id,
 * stamped now, previous stamp returned): one run reaches every due search
 * behind 30 that are skipped; a passing skip gets its old stamp back when the
 * run ends; a suppressed owner keeps the claim's stamp, so the next run does
 * not start from them again.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const db = new FakeDb();
const asked: string[] = [];
let search: EdgeHandler;

const DAY = 24 * 3600 * 1000;
const NINE_DAYS_AGO = new Date(Date.now() - 9 * DAY).toISOString();

/** The claim, as search_digest_claim_batch (20261004100000) writes it. */
function sqlClaim(a: Record<string, unknown>) {
  const now = Date.now();
  const due = db.rows("user_job_searches").filter((r) => r.digest_opt_in === true && (
    r.digest_last_sent_at == null
    || Date.parse(String(r.digest_last_sent_at)) < now - (r.digest_cadence === "daily" ? 20 * 3600 * 1000 : 6 * DAY)));
  due.sort((x, y) => {
    const xs = x.digest_last_sent_at as string | null, ys = y.digest_last_sent_at as string | null;
    if (xs == null && ys != null) return -1;
    if (ys == null && xs != null) return 1;
    if (xs != null && ys != null && xs !== ys) return Date.parse(xs) - Date.parse(ys);
    return String(x.id).localeCompare(String(y.id));
  });
  const take = due.slice(0, Math.min(Math.max(Number(a.p_limit) || 0, 1), 400));
  const out = take.map((r) => ({
    sd_id: r.id, sd_user_id: r.user_id, sd_name: r.name, sd_params: r.params,
    sd_prev_sent_at: r.digest_last_sent_at ?? null, sd_fit_threshold: 0, sd_cadence: r.digest_cadence,
  }));
  for (const r of take) r.digest_last_sent_at = new Date(now).toISOString();
  return { data: out, error: null };
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = {
    admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.com` } }, error: null }) },
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      if (b.countOnly) asked.push(String(b.q));
      // A search the board cannot count answers 500; the rest have nothing new.
      if (String(b.q).startsWith("broken")) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(b.countOnly ? { total: 0, newSince: b.newSince } : { jobs: [], newSince: b.newSince }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  search = await loadEdgeHandler("send-search-digest", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 'em' }, error: null }) }; } }",
  });
}, 60_000);

afterEach(() => { asked.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

const run = async () => (await search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}))).json();

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function plant(head: "suppressed" | "broken") {
  for (let i = 0; i < 30; i++) {
    const user = `head-${i}`;
    db.rows("user_job_searches").push({ id: id(i), user_id: user, name: `head ${i}`, params: { q: `${head}-${i}` }, digest_opt_in: true, digest_cadence: "weekly", digest_last_sent_at: null });
    if (head === "suppressed") db.rows("suppressed_emails").push({ email: `${user}@example.com` });
  }
  for (let i = 0; i < 10; i++) {
    db.rows("user_job_searches").push({ id: id(100 + i), user_id: `ok-${i}`, name: `ok ${i}`, params: { q: `normal-${i}` }, digest_opt_in: true, digest_cadence: "weekly", digest_last_sent_at: NINE_DAYS_AGO });
  }
  db.rpcs.search_digest_claim_batch = sqlClaim;
}
const normalsReached = () => new Set(asked.filter((q) => q.startsWith("normal-"))).size;
const head = () => db.rows("user_job_searches").filter((r) => String(r.name).startsWith("head"));

describe("searches the digest gives back do not stop it reaching the rest", () => {
  it("30 suppressed owners at the head: one run reaches all 10 searches behind them", async () => {
    plant("suppressed");
    const body = await run();
    expect(normalsReached(), "the run never got past the searches it handed back").toBe(10);
    expect(body).toMatchObject({ considered: 40, sent: 0 });
  });

  it("a suppressed owner keeps the claim's stamp, so the next run does not start from them again", async () => {
    plant("suppressed");
    await run();
    expect(head().every((r) => r.digest_last_sent_at != null), "a suppressed owner went back to the head of the queue").toBe(true);
    expect((await run()).considered).toBe(0);
  });

  it("30 searches the board cannot count at the head: all 10 behind them are reached, and the 30 get their old stamp back when the run ends", async () => {
    plant("broken");
    const body = await run();
    expect(normalsReached()).toBe(10);
    expect(body).toMatchObject({ considered: 40 });
    expect(head().map((r) => r.digest_last_sent_at), "a search the board could not count lost its window").toEqual(new Array(30).fill(null));
  });
});
