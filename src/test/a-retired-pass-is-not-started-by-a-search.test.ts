// @vitest-environment node
/**
 * A RETIRED PASS IS NOT STARTED BY A SEARCH (audit 2026-10-31, S13-074;
 * migration 20261103110000).
 *
 * WHAT WAS WRONG. The $29 pass's six-hour clock started at the first allowed
 * keyed MCP call other than the key's status and a resource read. Wave 4
 * retired the pass and its one paid tool, so a past buyer holding an unused
 * pass who searched jobs with the key started the six hours, and the lazy
 * close then wrote 'session_ended' with 0 of 10 applications used, which is
 * the row the owner's refund decision reads.
 *
 * WHAT HOLDS NOW (run, not read: the WINNING definition, the last migration
 * that defines api_key_check, applied twice to pglite from Supabase's default
 * grants):
 *   - a search, a job read, a fit, the key's status and a resource read leave
 *     an unused pass unused, and it closes 'shelf_expired' at its shelf end;
 *   - the tool the pass was sold for still starts it, once;
 *   - an open pass still serves its own limits (the overlay is unchanged);
 *   - still one function, a definer closed to the client roles.
 * The teeth: 20260917230000, the definition this one replaces, run through the
 * same fixture, does start the clock on a search.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const DEFINES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .filter((f) => read(f).includes("FUNCTION public.api_key_check("));
const WINNING = DEFINES[DEFINES.length - 1];
const REPLACED = "20260917230000_a_look_at_the_guide_does_not_start_the_clock.sql";

const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL UNIQUE,
    tier text NOT NULL DEFAULT 'free', rate_per_min integer NOT NULL DEFAULT 10, daily_quota integer NOT NULL DEFAULT 100,
    revoked_at timestamptz, user_id uuid, last_used_at timestamptz);
  CREATE TABLE public.api_rate (key_id uuid NOT NULL, minute timestamptz NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, minute));
  CREATE TABLE public.api_quota (key_id uuid NOT NULL, day date NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day));
  CREATE TABLE public.api_usage (key_id uuid NOT NULL, day date NOT NULL, endpoint text NOT NULL, calls integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key_id, day, endpoint));
  CREATE TABLE public.agent_passes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    session_hours integer NOT NULL DEFAULT 6, applications_total integer NOT NULL DEFAULT 10, applications_used integer NOT NULL DEFAULT 0,
    rate_per_min integer NOT NULL DEFAULT 60, daily_quota integer NOT NULL DEFAULT 5000,
    shelf_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
    activated_at timestamptz, expires_at timestamptz, closed_at timestamptz, close_reason text);
`;

const USER = "00000000-0000-4000-8000-0000000074a1";
let pg: PGlite;

async function freshPass() {
  await pg.exec(`
    DELETE FROM public.api_rate; DELETE FROM public.api_quota; DELETE FROM public.api_usage;
    DELETE FROM public.agent_passes; DELETE FROM public.api_keys;
    INSERT INTO public.api_keys (key_hash, user_id) VALUES ('hash-74', '${USER}');
    INSERT INTO public.agent_passes (user_id) VALUES ('${USER}');`);
}
const call = async (endpoint: string) =>
  (await pg.query<{ is_allowed: boolean; key_tier: string; rate_limit: number; pass_ends_at: string | null }>(
    `SELECT * FROM public.api_key_check('hash-74', $1)`, [endpoint])).rows[0];
const pass = async () =>
  (await pg.query<{ activated_at: string | null; closed_at: string | null; close_reason: string | null }>(
    `SELECT activated_at, closed_at, close_reason FROM public.agent_passes`)).rows[0];

const LOOKING = ["/mcp/search_jobs", "/mcp/get_job", "/mcp/score_fit", "/mcp/key_status", "/mcp/resource/guide"];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(STAND_INS);
}, 180_000);
afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

describe("the fixture can see a clock start (the definition this replaces)", () => {
  beforeAll(async () => { await pg.exec(read(REPLACED)); });
  beforeEach(freshPass);

  it("20260917230000 starts an unused pass's clock on a search", async () => {
    expect((await call("/mcp/search_jobs")).is_allowed).toBe(true);
    expect((await pass()).activated_at).not.toBeNull();
  });
});

describe(`the winning api_key_check (${WINNING}) starts a pass only on the call it was sold for`, () => {
  beforeAll(async () => {
    await pg.exec(read(WINNING));
    await pg.exec(read(WINNING));
  });
  beforeEach(freshPass);

  it("is this round's file, not the definition it replaces", () => {
    expect(WINNING).not.toBe(REPLACED);
  });

  for (const endpoint of LOOKING) {
    it(`${endpoint} leaves an unused pass unused`, async () => {
      const r = await call(endpoint);
      expect(r.is_allowed).toBe(true);
      expect(r.pass_ends_at).toBeNull();
      expect((await pass()).activated_at).toBeNull();
    });
  }

  it("an open pass still serves its own limits while it waits", async () => {
    const r = await call("/mcp/search_jobs");
    expect(r.key_tier).toBe("pass");
    expect(r.rate_limit).toBe(60);
  });

  it("an unused pass searched with all month closes as 'shelf_expired', not 'session_ended'", async () => {
    await call("/mcp/search_jobs");
    await pg.exec(`UPDATE public.agent_passes SET shelf_expires_at = now() - interval '1 minute'`);
    await call("/mcp/search_jobs");
    const p = await pass();
    expect(p.closed_at).not.toBeNull();
    expect(p.close_reason).toBe("shelf_expired");
  });

  it("the tool the pass was sold for starts the clock, once", async () => {
    const r = await call("/mcp/request_application");
    expect(r.pass_ends_at).not.toBeNull();
    const first = (await pass()).activated_at;
    expect(first).not.toBeNull();
    await call("/mcp/request_application");
    expect((await pass()).activated_at).toEqual(first);
  });

  it("is one function, a definer with a fixed search_path, closed to the client roles", async () => {
    const { rows } = await pg.query<{ n: number; def: boolean; cfg: string[]; anon: boolean; auth: boolean }>(`
      SELECT (SELECT count(*)::int FROM pg_proc WHERE proname = 'api_key_check') AS n,
             p.prosecdef AS def, p.proconfig AS cfg,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
        FROM pg_proc p WHERE p.oid = 'public.api_key_check(text,text)'::regprocedure`);
    expect(rows[0]).toMatchObject({ n: 1, def: true, anon: false, auth: false });
    expect(rows[0].cfg.some((c) => c.startsWith("search_path="))).toBe(true);
  });
});
