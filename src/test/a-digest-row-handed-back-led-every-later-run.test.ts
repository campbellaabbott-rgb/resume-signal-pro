// @vitest-environment node
/**
 * A DIGEST ROW HANDED BACK LED EVERY LATER RUN (review of the wave-3
 * integration, 2026-10-10, email lens: one major finding and two minor).
 *
 * WHAT WAS WRONG.
 *   1. send-search-digest restored a failed search's window stamp when the
 *      run ended, and search_digest_claim_batch orders by that stamp, never-
 *      sent first. A search that failed every run therefore led every run.
 *      Thirteen whose board count answered countUnavailable after 8 s each
 *      used the whole 100 s clock; 400 that failed at once used the whole
 *      run. The searches behind them were handed back unstarted, run after
 *      run, and every run answered ok:true. The merged guard missed it: its
 *      board failed in zero time and it planted 30.
 *   2. The give-backs were kept in memory and written in a `finally` when the
 *      run ended. A search still in flight (three board calls with no clock)
 *      could outlive the isolate, and then every give-back of that run was
 *      never written: windows lost, and a daily "Alert me when this exists"
 *      search lost its first-match mail.
 *   3. send-agent-digest handed back every mandate it did not mail (not
 *      entitled, suppressed, an empty shortlist), and its one 500-row claim
 *      orders the same way: 500 such mandates at the head and no mandate
 *      behind them was ever claimed.
 *
 * WHAT HOLDS NOW, proved against the SQL that ships: the claims are the real
 * migrations applied to pglite (20261004100000 and every later file that
 * redefines a claim), the shipped handlers run against that database through
 * PgSupabase, and the board's slow answers move the handler's clock.
 *   - a search a run worked waits behind every search not yet worked, so the
 *     searches behind failing ones are mailed on the next run at the latest;
 *   - a give-back is written while the run is still going, and every board
 *     call carries a clock;
 *   - a mandate nobody may mail, or with nothing to tell, keeps the claim's
 *     stamp, so the mandate behind 500 of them is mailed the next day.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { bootMailDoorDb, MAIL_DOOR_FILE } from "./helpers/mail-door-db";
import { PgSupabase } from "./helpers/pglite-supabase";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const MAIL_DOOR_STAMP = MAIL_DOOR_FILE.replace(/^.*\/(\d{14})_.*$/, "$1");
/** Every migration after the mail door that redefines a digest claim, in apply order. */
const LATER_CLAIMS = readdirSync(MIG_DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) > MAIL_DOOR_STAMP).sort()
  .filter((f) => /FUNCTION\s+public\.(search|agent)_digest_claim_batch\s*\(/i.test(readFileSync(resolve(MIG_DIR, f), "utf8")));

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const DAY = 24 * 3600 * 1000;
const realNow = Date.now;
let offset = 0;

/** timestamptz as PostgREST sends it: an ISO string, never a Date. */
const iso = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();

const SEED = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL);
  ALTER TABLE public.agent_mandates ADD COLUMN apply_mode text, ADD COLUMN auto_apply_daily_cap integer;
  CREATE TABLE public.agent_queue (
    user_id uuid NOT NULL, status text NOT NULL, posting_id text, title text, company text, location text,
    apply_url text, salary text, fit_pct integer, reasons jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.agent_subscribers (user_id uuid, email text, status text, current_period_end timestamptz);
  -- The plan read by account (20261005130000), reduced to the columns the digest reads.
  CREATE FUNCTION public.agent_subscription_rows(p_user_ids uuid[])
    RETURNS TABLE (user_id uuid, email text, status text, current_period_end timestamptz)
    LANGUAGE sql STABLE AS $$ SELECT s.user_id, s.email, s.status, s.current_period_end FROM public.agent_subscribers s WHERE s.user_id = ANY (p_user_ids) $$;
  CREATE TABLE public.search_digest_sent (search_id uuid, posting_id text);
`;

let pg: PGlite;
let client: PgSupabase;
let search: EdgeHandler;
let agent: EdgeHandler;
const sent: Array<{ to: unknown; subject: string }> = [];
/** What the fake board does with a saved search, by its q. */
type Board = (q: string, body: Record<string, unknown>, init: { signal?: unknown }) => Promise<Response>;
let board: Board;
const asked: string[] = [];

beforeAll(async () => {
  pg = new PGlite({ parsers: { 1184: iso } });
  await bootMailDoorDb({ db: pg, seed: SEED });
  for (const f of LATER_CLAIMS) await pg.exec(readFileSync(resolve(MIG_DIR, f), "utf8"));
  client = new PgSupabase(pg);
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__pgClient = client;
  g.__claimSent = sent;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string; signal?: unknown }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      if (b.countOnly) asked.push(String(b.q));
      return board(String(b.q), b, init);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const stubs = {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__pgClient;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__claimSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  };
  search = await loadEdgeHandler("send-search-digest", stubs);
  agent = await loadEdgeHandler("send-agent-digest", stubs);
  Date.now = () => realNow() + offset;
}, 120_000);

afterAll(() => { Date.now = realNow; });

beforeEach(async () => {
  offset = 0; sent.length = 0; asked.length = 0;
  // TRUNCATE, not DELETE: each case starts from an empty heap, so the rows sit
  // in the order they are planted and no case inherits another's free space.
  await pg.exec("TRUNCATE public.user_job_searches, public.agent_mandates, public.agent_queue, public.agent_subscribers, public.suppressed_emails, auth.users;");
});

const post = async (h: EdgeHandler, fn: string) => (await h(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}))).json();

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const answer = (body: Record<string, unknown>, extra: Record<string, unknown>) => new Response(JSON.stringify({ ...extra, newSince: body.newSince }), { status: 200 });
/** The board for searches named normal-*: nothing new. */
const quiet = (body: Record<string, unknown>) => answer(body, body.countOnly ? { total: 0 } : { jobs: [] });

/** `heads` searches named head-* ahead of 10 normal-* ones (stamped nine days ago, so behind every never-sent head). */
async function plantSearches(heads: number, cadence: "daily" | "weekly" = "weekly") {
  const nine = new Date(realNow() - 9 * DAY).toISOString();
  for (let i = 0; i < heads; i++) {
    await pg.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [uid(i), `head${i}@example.com`]);
    await pg.query("INSERT INTO public.user_job_searches (id, user_id, name, params, digest_opt_in, digest_cadence) VALUES ($1, $1, $2, $3, true, $4)",
      [uid(i), `head ${i}`, JSON.stringify({ q: `head-${i}` }), cadence]);
  }
  for (let i = 0; i < 10; i++) {
    const id = uid(5000 + i);
    await pg.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `ok${i}@example.com`]);
    await pg.query("INSERT INTO public.user_job_searches (id, user_id, name, params, digest_opt_in, digest_cadence, digest_last_sent_at) VALUES ($1, $1, $2, $3, true, 'weekly', $4)",
      [id, `normal ${i}`, JSON.stringify({ q: `normal-${i}` }), nine]);
  }
}
const normalsAsked = () => new Set(asked.filter((q) => q.startsWith("normal-"))).size;
const headStamps = async () => (await pg.query<{ s: string | null }>("SELECT digest_last_sent_at AS s FROM public.user_job_searches WHERE name LIKE 'head %' ORDER BY id")).rows.map((r) => r.s);

describe("the claims, as the migrations leave them", () => {
  it("a search a run worked and handed back waits behind one not yet worked; one never started keeps its place", async () => {
    await plantSearches(2);
    const claim = async () => (await pg.query<{ sd_id: string }>("SELECT sd_id FROM public.search_digest_claim_batch(1)")).rows[0]?.sd_id;
    const first = await claim();
    expect(first).toBe(uid(0));
    // worked, failed, window handed back: the next claim is the other search
    await pg.query("UPDATE public.user_job_searches SET digest_last_sent_at = NULL WHERE id = $1", [first]);
    expect(await claim(), "a search handed back after an attempt led the next claim").toBe(uid(1));
  });

  it("a mandate a run worked and handed back waits behind one not yet worked", async () => {
    await pg.query("INSERT INTO public.agent_mandates (user_id, email, email_opt_in) VALUES ($1, 'a@example.com', true), ($2, 'b@example.com', true)", [uid(1), uid(2)]);
    const claim = async () => (await pg.query<{ ad_user_id: string }>("SELECT ad_user_id FROM public.agent_digest_claim_batch(1)")).rows[0]?.ad_user_id;
    const first = await claim();
    expect(first).toBe(uid(1));
    await pg.query("UPDATE public.agent_mandates SET email_last_sent_at = NULL WHERE user_id = $1", [first]);
    expect(await claim(), "a mandate handed back after an attempt led the next claim").toBe(uid(2));
  });
});

describe("the saved-search digest reaches the searches behind ones that keep failing", () => {
  it("13 slow uncountable searches at the head: the 10 behind them are reached by the second run, and the 13 keep their windows", async () => {
    await plantSearches(13);
    board = async (q, body) => {
      if (!q.startsWith("head-")) return quiet(body);
      offset += 8_000; // the board took 8 s to say it could not count
      return answer(body, body.countOnly ? { total: null, countUnavailable: true } : { jobs: [] });
    };
    const runs = [];
    for (let r = 0; r < 3 && normalsAsked() < 10; r++) runs.push(await post(search, "send-search-digest"));
    expect(normalsAsked(), `the searches behind the slow ones were never reached: ${JSON.stringify(runs)}`).toBe(10);
    expect(runs.length, "it took more than the next run").toBeLessThanOrEqual(2);
    expect(await headStamps(), "a search the board could not count lost its window").toEqual(new Array(13).fill(null));
  }, 60_000);

  it("searches whose board answers 500 after 25 s: the 10 behind them are reached by the second run", async () => {
    await plantSearches(5);
    board = async (q, body) => {
      if (!q.startsWith("head-")) return quiet(body);
      offset += 25_000;
      return new Response("{}", { status: 500 });
    };
    const runs = [];
    for (let r = 0; r < 3 && normalsAsked() < 10; r++) runs.push(await post(search, "send-search-digest"));
    expect(normalsAsked(), JSON.stringify(runs)).toBe(10);
    expect(runs.length).toBeLessThanOrEqual(2);
  }, 60_000);

  it("400 searches that fail at once fill a whole run: the 10 behind them are reached by the second run", async () => {
    await plantSearches(400);
    board = async (q, body) => (q.startsWith("head-") ? new Response("{}", { status: 500 }) : quiet(body));
    const first = await post(search, "send-search-digest");
    expect(first).toMatchObject({ ok: true, considered: 400 });
    const second = await post(search, "send-search-digest");
    expect(normalsAsked(), `run 1 ${JSON.stringify(first)}; run 2 ${JSON.stringify(second)}`).toBe(10);
    expect(await headStamps(), "a failed search lost its window").toEqual(new Array(400).fill(null));
  }, 120_000);
});

describe("a give-back is written while the run is still going, and a board call has a clock", () => {
  it("five daily searches handed back hold their old stamp while a sixth is still in flight", async () => {
    await plantSearches(6, "daily");
    let release: (r: Response) => void = () => {};
    let entered: () => void = () => {};
    const inFlight = new Promise<void>((r) => { entered = r; });
    let signal: unknown = null;
    board = async (q, body, init) => {
      if (q === "head-5") {
        signal = init.signal;
        entered();
        return new Promise<Response>((r) => { release = r; });
      }
      return q.startsWith("head-") ? new Response("{}", { status: 500 }) : quiet(body);
    };
    const run = post(search, "send-search-digest");
    await inFlight;
    const during = (await headStamps()).slice(0, 5);
    release(new Response("{}", { status: 500 }));
    await run;
    expect(during, "a give-back was held in memory until the run ended: an isolate killed here loses every window").toEqual(new Array(5).fill(null));
    expect(signal instanceof AbortSignal, "a board call carried no clock, so it could outlive the isolate").toBe(true);
  }, 60_000);
});

describe("the morning shortlist reaches the mandate behind 500 it does not mail", () => {
  /** n mandates ahead (never mailed), entitled or not, with no ready picks; then one entitled mandate with a pick, mailed two days ago. */
  async function plantMandates(n: number, entitled: boolean) {
    const live = new Date(realNow() + 30 * DAY).toISOString();
    for (let i = 0; i < n; i++) {
      await pg.query("INSERT INTO public.agent_mandates (user_id, email, email_opt_in, apply_mode) VALUES ($1, $2, true, 'review')", [uid(i), `m${i}@example.com`]);
      if (entitled) await pg.query("INSERT INTO public.agent_subscribers VALUES ($1, $2, 'active', $3)", [uid(i), `m${i}@example.com`, live]);
    }
    const twoDays = new Date(realNow() - 2 * DAY).toISOString();
    await pg.query("INSERT INTO public.agent_mandates (user_id, email, email_opt_in, apply_mode, email_last_sent_at) VALUES ($1, 'picked@example.com', true, 'review', $2)", [uid(9000), twoDays]);
    await pg.query("INSERT INTO public.agent_subscribers VALUES ($1, 'picked@example.com', 'active', $2)", [uid(9000), live]);
    await pg.query("INSERT INTO public.agent_queue (user_id, status, posting_id, title, company, location, apply_url, fit_pct, created_at) VALUES ($1, 'ready', 'p1', 'Nurse', 'Acme', 'Leeds', 'https://acme.example/a', 80, now() - interval '1 hour')", [uid(9000)]);
  }
  const mailedPicked = () => sent.some((m) => JSON.stringify(m.to).includes("picked@example.com"));

  it("500 entitled mandates with empty shortlists at the head: the mandate with a pick is mailed by the second run", async () => {
    await plantMandates(500, true);
    const runs = [];
    for (let r = 0; r < 3 && !mailedPicked(); r++) runs.push(await post(agent, "send-agent-digest"));
    expect(mailedPicked(), `the mandate behind 500 empty shortlists was never mailed: ${JSON.stringify(runs)}`).toBe(true);
    expect(runs.length).toBeLessThanOrEqual(2);
  }, 60_000);

  it("500 mandates whose plan lapsed at the head: the entitled mandate with a pick is mailed by the second run", async () => {
    await plantMandates(500, false);
    const runs = [];
    for (let r = 0; r < 3 && !mailedPicked(); r++) runs.push(await post(agent, "send-agent-digest"));
    expect(mailedPicked(), `the mandate behind 500 lapsed plans was never mailed: ${JSON.stringify(runs)}`).toBe(true);
    expect(runs.length).toBeLessThanOrEqual(2);
    expect(sent.filter((m) => !JSON.stringify(m.to).includes("picked@example.com")), "a lapsed plan was mailed").toEqual([]);
  }, 60_000);
});
