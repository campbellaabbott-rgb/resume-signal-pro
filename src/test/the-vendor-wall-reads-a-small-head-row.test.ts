// @vitest-environment node
/**
 * THE VENDOR WALL READS A SMALL HEAD ROW
 * (cost audit 2026-11-08, "Small facets_head row"; migration 20261109175000).
 *
 * get_board_vendor_counts() answered the home page, /pricing and the résumé
 * checker's vendor wall by pulling three keys out of job_board_meta k =
 * 'facets', a multi-megabyte value. refresh_job_board_facets() now writes a
 * small k = 'facets_head' row {sourcesFacet, openTotal, as_of} in the same
 * statement as the big one, and the wall reads it -- the big row behind it.
 *
 * Two pglite databases on the same board: one with 20261009100200's refresh
 * and 20260810161607's wall, one with those plus the migration.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const REFRESH = read("20261009100200_federal_jobs_were_credited_to_whichever_agency_sorted_last.sql");
const WALL = read("20260810161607_e2c869dd-79d8-4b2b-8504-57570af38f33.sql");
const NEW = read("20261109175000_the_vendor_wall_reads_a_small_head_row.sql");

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text, company text, source text, category text,
    missing_since timestamptz, effective_posted timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
  REVOKE ALL ON public.job_board_meta FROM anon, authenticated;
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, feed_total int, verified_at timestamptz);
`;
const BOARD = `
  INSERT INTO public.job_board_postings (id, company_token, company, source, category, missing_since, effective_posted) VALUES
    ('usajobs:usajobs:1', 'usajobs', 'Veterans Health Administration', 'usajobs', 'healthcare', NULL, now()),
    ('usajobs:usajobs:2', 'usajobs', 'Forest Service', 'usajobs', 'science', now() - interval '2 days', now()),
    ('greenhouse:acme:1', 'acme', 'Acme', 'greenhouse', 'engineering', NULL, now()),
    ('greenhouse:acme:2', 'acme', 'Acme', 'greenhouse', 'engineering', NULL, now()),
    ('greenhouse:acme:3', 'acme', 'Acme', 'greenhouse', 'engineering', NULL, now() - interval '45 days'),
    ('lever:beta:1', 'beta', 'Beta', 'lever', 'design', NULL, now()),
    ('ashby:gamma:1', 'gamma', 'Gamma', '', 'sales', NULL, now());
`;

type Wall = { sourcesFacet: Record<string, number>; openTotal: number | null; as_of: string | null; cached: boolean };
const wall = async (db: PGlite, role = "anon"): Promise<Wall> => {
  await db.exec(`SET ROLE ${role}`);
  try {
    return (await db.query<{ v: Wall }>("SELECT public.get_board_vendor_counts() AS v")).rows[0].v;
  } finally {
    await db.exec("RESET ROLE");
  }
};
const refresh = async (db: PGlite) => {
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ v: Record<string, unknown> }>("SELECT public.refresh_job_board_facets() AS v")).rows[0].v;
  } finally {
    await db.exec("RESET ROLE");
  }
};
type Meta = { k: string; v: Record<string, unknown>; updated_at: string; xmin: string };
const meta = async (db: PGlite) =>
  new Map((await db.query<Meta>("SELECT k, v, updated_at::text AS updated_at, xmin::text AS xmin FROM public.job_board_meta")).rows.map((r) => [r.k, r]));

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });
async function boot(withNew: boolean, before = ""): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SCHEMA);
  await db.exec(BOARD);
  await db.exec(REFRESH);
  await db.exec(WALL);
  await db.exec(before);
  if (withNew) await db.exec(NEW);
  return db;
}

describe("the wall's answer does not change", () => {
  let was: PGlite;
  let now: PGlite;
  let wasV: Record<string, unknown>;
  let nowV: Record<string, unknown>;
  beforeAll(async () => {
    [was, now] = await Promise.all([boot(false), boot(true)]);
    [wasV, nowV] = await Promise.all([refresh(was), refresh(now)]);
  });

  it("the refresh builds the same facets value, every key but the instant it ran", () => {
    const strip = (v: Record<string, unknown>) => ({ ...v, as_of: "x" });
    expect(strip(nowV)).toEqual(strip(wasV));
    expect(Object.keys(nowV).sort()).toEqual(["as_of", "carriedEmployers", "categoriesFacet", "companiesFacet", "companiesOpen",
      "companiesOpenCount", "openTotal", "sourcesFacet", "total"]);
  });

  it("the wall answers the same object from the head row as the old wall did from the big row", async () => {
    const a = await wall(now);
    const b = await wall(was);
    expect({ ...a, as_of: "x" }).toEqual({ ...b, as_of: "x" });
    // Not vacuous: the 30-day window, the empty source and the closed posting are all in the fixture.
    expect(a).toMatchObject({ sourcesFacet: { greenhouse: 2, lever: 1, usajobs: 1 }, openTotal: 5, cached: true });
    expect(a.as_of).toBe(nowV.as_of);
  });

  it("the head row is written in the same statement as the big row: one transaction, one instant, one pass", async () => {
    const m = await meta(now);
    const big = m.get("facets")!;
    const head = m.get("facets_head")!;
    expect(head.xmin).toBe(big.xmin);
    expect(head.updated_at).toBe(big.updated_at);
    expect(head.v).toEqual({ sourcesFacet: big.v.sourcesFacet, openTotal: big.v.openTotal, as_of: big.v.as_of });
  });

  it("the old refresh never wrote a head row", async () => {
    expect((await meta(was)).has("facets_head")).toBe(false);
  });
});

describe("the wall reads the head, with the big row behind it", () => {
  it("teeth: what the head row says is what the wall answers", async () => {
    const db = await boot(true);
    await refresh(db);
    await db.exec(`UPDATE public.job_board_meta SET v = jsonb_set(v, '{openTotal}', '4242') WHERE k = 'facets_head'`);
    expect((await wall(db)).openTotal).toBe(4242);
  });

  it("with no head row the wall answers the big row exactly as before; with neither, the empty answer", async () => {
    const [was, now] = await Promise.all([boot(false), boot(true)]);
    await Promise.all([refresh(was), refresh(now)]);
    await now.exec("DELETE FROM public.job_board_meta WHERE k = 'facets_head'");
    // The same big row on both sides, so even the as_of must agree.
    const bigV = (await meta(was)).get("facets")!.v;
    await now.query("UPDATE public.job_board_meta SET v = $1 WHERE k = 'facets'", [bigV]);
    expect(await wall(now)).toEqual(await wall(was));
    await now.exec("DELETE FROM public.job_board_meta");
    await was.exec("DELETE FROM public.job_board_meta");
    expect(await wall(now)).toEqual({ sourcesFacet: {}, openTotal: null, as_of: null, cached: false });
    expect(await wall(now)).toEqual(await wall(was));
  });
});

describe("the seed and re-apply", () => {
  it("the migration seeds the head from the facets row the last refresh wrote, so the wall reads it at once", async () => {
    const db = await boot(false);
    await refresh(db);
    const before = await wall(db);
    await db.exec(NEW);
    const m = await meta(db);
    expect(m.get("facets_head")?.v.as_of).toBe(m.get("facets")!.v.as_of);
    expect(m.get("facets_head")?.updated_at).toBe(m.get("facets")!.updated_at);
    expect(await wall(db)).toEqual(before);
  });

  it("re-applying never moves a newer head backwards", async () => {
    const db = await boot(true);
    await refresh(db);
    await db.exec(`UPDATE public.job_board_meta SET v = jsonb_set(v, '{openTotal}', '1'), updated_at = updated_at - interval '1 hour' WHERE k = 'facets'`);
    const head = (await meta(db)).get("facets_head")!;
    await db.exec(NEW);
    expect((await meta(db)).get("facets_head")).toEqual(head);
  });

  it("a database with no facets row yet applies cleanly and the wall answers empty", async () => {
    const db = await boot(true);
    expect((await meta(db)).size).toBe(0);
    expect((await wall(db)).cached).toBe(false);
  });

  it("the wall stays callable by the page's roles, the refresh by service_role only", async () => {
    const db = await boot(true);
    const { rows } = await db.query<Record<string, boolean>>(`
      SELECT has_function_privilege('anon', 'public.get_board_vendor_counts()', 'EXECUTE') AS wall_anon,
             has_function_privilege('authenticated', 'public.get_board_vendor_counts()', 'EXECUTE') AS wall_auth,
             has_function_privilege('anon', 'public.refresh_job_board_facets()', 'EXECUTE') AS refresh_anon,
             has_function_privilege('authenticated', 'public.refresh_job_board_facets()', 'EXECUTE') AS refresh_auth,
             has_function_privilege('service_role', 'public.refresh_job_board_facets()', 'EXECUTE') AS refresh_svc`);
    expect(rows[0]).toEqual({ wall_anon: true, wall_auth: true, refresh_anon: false, refresh_auth: false, refresh_svc: true });
    await db.exec("SET ROLE anon");
    await expect(db.query("SELECT v FROM public.job_board_meta WHERE k = 'facets_head'")).rejects.toThrow(/permission denied/);
    await db.exec("RESET ROLE");
  });
});
