// @vitest-environment node
/**
 * A FIT CALL THAT SCORED NOTHING GIVES ITS ALLOWANCE BACK (S14X-132, M-S14-106).
 *
 * The free fit allowance is 25 SCORED calls a UTC day, and it was read back
 * from api_usage, which counts every metered call. So a GET to /v1/fit (a
 * 405 the router answered after the key was metered), a résumé under 100
 * characters, a body that was not JSON, a résumé with no occupation in it, a
 * search that found nothing and a scorer that failed each spent one of the
 * 25 and scored nothing.
 *
 * Now a non-POST /v1/fit is refused before the key is read, and every outcome
 * that scored nothing records one give-back through api_key_fit_unscored, which
 * the allowance reader subtracts. Run in a real Postgres (pglite, from
 * Supabase's default grants) and through the shipped handler.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { bootMailDoorDbOnDefaults, rows } from "./helpers/mail-lists-db";
import { splitStatements } from "./helpers/function-acl";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb, type Fetched } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const migration = (prefix: string) => readFileSync(resolve(MIG_DIR, readdirSync(MIG_DIR).find((f) => f.startsWith(prefix))!), "utf8");
const UNSCORED_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_a_fit_call_that_scored_nothing_gives_its_allowance_back.sql"));

// ── the SQL, in a real Postgres ─────────────────────────────────────────────

const PROVEN_SQL = splitStatements(migration("20261005130000_"))
  .filter((s) => /^\s*(CREATE TABLE IF NOT EXISTS public\.mailbox_proof_settings|INSERT INTO public\.mailbox_proof_settings|CREATE OR REPLACE FUNCTION public\.account_mailbox_proven)/.test(s))
  .map((s) => `${s.trim()};`)
  .join("\n");

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

const h = (c: string) => c.repeat(64).slice(0, 64);

describe("api_key_fit_unscored and the allowance reader, from Supabase's default grants", () => {
  let db: PGlite;
  beforeAll(async () => {
    expect(UNSCORED_FILE, "the migration exists in the lane's range").toMatch(/^202611122\d{5}_/);
    const sql = readFileSync(resolve(MIG_DIR, UNSCORED_FILE!), "utf8");
    db = await bootMailDoorDbOnDefaults();
    OPEN.push(db);
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, created_at timestamptz DEFAULT now());
      CREATE TABLE auth.identities (user_id uuid, provider text, identity_data jsonb);
      CREATE TABLE IF NOT EXISTS public.api_usage (
        key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE, day date NOT NULL,
        endpoint text NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day, endpoint));
    `);
    await db.exec(PROVEN_SQL);
    await db.exec(migration("20261011110000_"));
    await db.exec(sql);
    await db.exec(sql);
  }, 120_000);
  beforeEach(async () => { await db.exec("BEGIN"); });
  afterEach(async () => { await db.exec("ROLLBACK"); });

  const mint = async (email: string, token: string, keyHash: string): Promise<string> => {
    await rows(db, "SELECT * FROM public.api_key_request_open($1, 'app', $2, 'net-a')", [email, token]);
    await rows(db, "SELECT * FROM public.api_key_issue($1, $2, 'rb_live_' || left($2, 8), 'net-b')", [token, keyHash]);
    const [k] = await rows<{ id: string }>(db, "SELECT id FROM public.api_keys WHERE key_hash = $1", [keyHash]);
    return k.id;
  };
  const usage = (key: string, endpoint: string, calls: number) =>
    db.query("INSERT INTO public.api_usage (key_id, day, endpoint, calls) VALUES ($1, (now() AT TIME ZONE 'utc')::date, $2, $3)", [key, endpoint, calls]);
  const giveBack = async (key: string, endpoint = "/v1/fit") =>
    (await rows<{ ok: boolean }>(db, "SELECT public.api_key_fit_unscored($1::uuid, $2) AS ok", [key, endpoint]))[0].ok;
  const used = async (key: string, endpoint = "/v1/fit") =>
    (await rows<{ fa_used: number }>(db, "SELECT fa_used FROM public.api_key_fit_allowance($1::uuid, $2)", [key, endpoint]))[0].fa_used;

  it("twenty-five calls with three that scored nothing leave twenty-two used, read through either door", async () => {
    const key = await mint("dev@example.org", h("a"), h("b"));
    await usage(key, "/v1/fit", 25);
    for (let i = 0; i < 3; i++) expect(await giveBack(key)).toBe(true);
    expect(await used(key, "/v1/fit")).toBe(22);
    expect(await used(key, "/mcp/fit_resume"), "one allowance across both doors").toBe(22);
  });

  it("a give-back never exceeds that endpoint's calls today, so the count is never negative", async () => {
    const key = await mint("cap@example.org", h("c"), h("d"));
    await usage(key, "/v1/fit", 5);
    const answers: boolean[] = [];
    for (let i = 0; i < 40; i++) answers.push(await giveBack(key));
    expect(answers.filter(Boolean)).toHaveLength(5);
    expect(await used(key)).toBe(0);
    expect(await giveBack(key, "/mcp/fit_resume"), "the other door had no calls to give back").toBe(false);
  });

  it("only the two fit endpoints can be given back, and yesterday's rows are pruned", async () => {
    const key = await mint("prune@example.org", h("e"), h("f"));
    await usage(key, "/v1/jobs", 9);
    expect(await giveBack(key, "/v1/jobs")).toBe(false);
    await db.query("INSERT INTO public.api_fit_unscored (key_id, day, endpoint, calls) VALUES ($1, (now() AT TIME ZONE 'utc')::date - 3, '/v1/fit', 4)", [key]);
    await usage(key, "/v1/fit", 1);
    expect(await giveBack(key)).toBe(true);
    const left = await rows<{ day: string }>(db, "SELECT day::text FROM public.api_fit_unscored WHERE key_id = $1", [key]);
    expect(left, "only today's row is left").toHaveLength(1);
  });

  it("no client role can call either function or read the give-back table; service_role can call both", async () => {
    const [r] = await rows<Record<string, boolean>>(db, `SELECT
      has_function_privilege('anon', 'public.api_key_fit_unscored(uuid, text)', 'EXECUTE') AS anon_give,
      has_function_privilege('authenticated', 'public.api_key_fit_unscored(uuid, text)', 'EXECUTE') AS auth_give,
      has_function_privilege('anon', 'public.api_key_fit_allowance(uuid, text)', 'EXECUTE') AS anon_read,
      has_function_privilege('authenticated', 'public.api_key_fit_allowance(uuid, text)', 'EXECUTE') AS auth_read,
      has_table_privilege('anon', 'public.api_fit_unscored', 'SELECT') AS anon_table,
      has_table_privilege('authenticated', 'public.api_fit_unscored', 'SELECT') AS auth_table,
      has_table_privilege('authenticated', 'public.api_fit_unscored', 'INSERT') AS auth_insert,
      has_function_privilege('service_role', 'public.api_key_fit_unscored(uuid, text)', 'EXECUTE') AS svc_give,
      has_function_privilege('service_role', 'public.api_key_fit_allowance(uuid, text)', 'EXECUTE') AS svc_read`);
    expect(r).toEqual({ anon_give: false, auth_give: false, anon_read: false, auth_read: false,
      anon_table: false, auth_table: false, auth_insert: false, svc_give: true, svc_read: true });
  });

  it("a revoked or unknown key is given nothing back", async () => {
    const key = await mint("gone@example.org", h("g"), h("i"));
    await usage(key, "/v1/fit", 3);
    await db.query("UPDATE public.api_keys SET revoked_at = now() WHERE id = $1", [key]);
    expect(await giveBack(key)).toBe(false);
    expect(await giveBack("00000000-0000-4000-8000-000000000000")).toBe(false);
  });
});

// ── the shipped handler ─────────────────────────────────────────────────────

let handler: EdgeHandler;
let fetched: Fetched[];
let boardJobs: unknown[];
let scorerStatus: number;
let db: RecordingDb;

beforeAll(async () => {
  ({ handler, fetched } = await loadPublicApi((f) => {
    if (f.url.endsWith("/functions/v1/job-board")) return new Response(JSON.stringify({ jobs: boardJobs }), { status: 200 });
    if (f.url.endsWith("/functions/v1/job-fit")) {
      return scorerStatus === 200
        ? new Response(JSON.stringify({ fits: { "greenhouse:acme:1": 71 }, matched: {}, missing: {} }), { status: 200 })
        : new Response("{}", { status: scorerStatus });
    }
    return new Response("{}", { status: 404 });
  }));
}, 120_000);

beforeEach(() => {
  fetched.length = 0;
  boardJobs = [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Nurse", applyUrl: "https://x" }];
  scorerStatus = 200;
  db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.rpcs.api_key_fit_allowance = () => ({ data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 3 }], error: null });
  db.rpcs.api_key_fit_unscored = () => ({ data: true, error: null });
  useDb(db);
});

const RESUME = "Registered nurse with eight years of triage, emergency department care, patient education and charting experience. ".repeat(2);
const NO_ROLE = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(2);
const post = (body: unknown) => callApi(handler, "/v1/fit", { method: "POST", body });
const gaveBack = () => db.rpcCalls.filter((r) => r.name === "api_key_fit_unscored").map((r) => r.args);
const ONE = [{ p_key_id: "key-1", p_endpoint: "/v1/fit" }];

describe("POST /v1/fit gives back a call that scored nothing", () => {
  it("a GET is refused before the key is read, so it is never metered", async () => {
    for (const auth of [false, true]) {
      db.rpcCalls.length = 0;
      const r = await callApi(handler, "/v1/fit", { auth });
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toMatch(/POST/);
      expect(db.rpcCalls.map((c) => c.name), "api_key_check counts the call it is asked about").toEqual([]);
    }
    expect((await callApi(handler, "/v1/fit/", { method: "GET" })).status).toBe(405);
  });

  it("a résumé under a hundred characters gives its call back", async () => {
    const r = await post({ resumeText: "Nurse, eight years of triage experience." });
    expect(r.status).toBe(400);
    expect(gaveBack()).toEqual(ONE);
  });

  it("a body that is not JSON gives its call back", async () => {
    const r = await post("{not json");
    expect(r.status).toBe(400);
    expect(gaveBack()).toEqual(ONE);
  });

  it("a résumé with no occupation in it gives its call back", async () => {
    const r = await post({ resumeText: NO_ROLE });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(gaveBack()).toEqual(ONE);
  });

  it("a search that found nothing gives its call back", async () => {
    boardJobs = [];
    const r = await post({ resumeText: RESUME, q: "nurse" });
    expect(r.status).toBe(200);
    expect(gaveBack()).toEqual(ONE);
  });

  it("a scorer that failed gives the call back, and so does a scorer that refused", async () => {
    scorerStatus = 502;
    expect((await post({ resumeText: RESUME, q: "nurse" })).status).toBe(502);
    expect(gaveBack()).toEqual(ONE);
    db.rpcCalls.length = 0;
    scorerStatus = 429;
    expect((await post({ resumeText: RESUME, q: "nurse" })).status).toBe(429);
    expect(gaveBack()).toEqual(ONE);
  });

  it("a refused call gives its call back", async () => {
    db.rpcs.api_key_fit_allowance = () => ({ data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 26 }], error: null });
    expect((await post({ resumeText: RESUME })).status).toBe(402);
    expect(gaveBack()).toEqual(ONE);
  });

  it("a scored call keeps its count", async () => {
    const r = await post({ resumeText: RESUME, q: "nurse" });
    expect(r.status).toBe(200);
    expect((r.body.data as Array<{ fit: number }>)[0].fit).toBe(71);
    expect(gaveBack()).toEqual([]);
  });

  it("a give-back that fails is logged and the caller's answer is unchanged", async () => {
    db.rpcs.api_key_fit_unscored = () => ({ data: null, error: { code: "PGRST202", message: "not yet applied" } });
    const r = await post({ resumeText: "too short" });
    expect(r.status).toBe(400);
    expect((r.body.error as { code: string }).code).toBe("invalid_value");
  });
});
