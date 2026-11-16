// @vitest-environment node
/**
 * THE ACTIVELY HIRING LIST LEAVES OUT STAFFING BOARDS (bug round NB-5).
 *
 * On 2026-11-15 the hourly cache's "Actively hiring" list put Weekday AI
 * first and Distro fifth: two intermediaries whose takedowns are their
 * clients' roles closing. The owner chose (2026-11-16) to leave staffing,
 * recruiting and job-ad intermediaries out of the list while they stay on the
 * board, labelled. Executed, not read: the newest definition of
 * get_actively_hiring_companies runs over five boards built alike, one
 * flagged by the catalogue, three named intermediaries the catalogue does not
 * flag, and one employer.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEEN_AGAIN_SCHEMA } from "./helpers/seen-again-fixture";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const DEFINES = "CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies";
/** The file that last defines the list: apply order is name order. */
const NEWEST = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes(DEFINES)).pop()!;
const ORIGIN = "20260909201000_the_same_late_date_in_thirteen_more_places.sql";
/** The list reads the employer curve, so the curve is defined first, as the two-counts guard does. */
const CURVE = "20261008110000_a_role_is_counted_once_and_a_posting_seen_again_never_came_down.sql";

/** 201000 is a file of thirteen functions: only the list, its comment and its grant are cut from it. */
function fromOrigin(): string {
  const src = readFileSync(resolve(DIR, ORIGIN), "utf8");
  const grant = "GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated, service_role;";
  const from = src.indexOf(DEFINES);
  const to = src.indexOf(grant, from);
  if (from < 0 || to < 0) throw new Error("the list moved out of " + ORIGIN);
  return src.slice(from, to + grant.length);
}
const newest = () => (NEWEST === ORIGIN ? fromOrigin() : readFileSync(resolve(DIR, NEWEST), "utf8"));

const EXTRA = `
  ALTER TABLE public.job_board_postings ADD COLUMN agency boolean NOT NULL DEFAULT false;
  ALTER TABLE public.job_board_closures ADD COLUMN company text NOT NULL DEFAULT '', ADD COLUMN title text;
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, feed_total int, verified_at timestamptz);
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`;

/** One board, the same for every token: 150 served roles and 90 taken down inside the window. */
function board(tok: string, company: string, agency: boolean): string {
  return `
    INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen, agency)
    SELECT '${tok}:L:'||g, 'workable', '${tok}', 'engineering', now() - interval '20 days', now() - interval '20 days', now() - interval '20 days', now(), ${agency}
    FROM generate_series(1, 150) g;
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, company, title, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
    SELECT '${tok}:F:'||g, 'workable', '${tok}', 'engineering', '${company}', 'Role F'||g, now() - interval '30 days', now() - interval '30 days',
           now() - interval '25 days', false, NULL, 5000, 'full_read'
    FROM generate_series(1, 90) g;
    INSERT INTO public.job_board_company_snapshots VALUES ('${tok}', current_date - 40, 150);
  `;
}
const BOARDS: Array<[string, string, boolean]> = [
  ["calm-employer", "Calmco", false],
  ["flagged-staffing", "Flagged Staffing", true],
  ["weekday-1", "Weekday AI", false],
  ["distro", "Distro", false],
  ["mercier-consultancy-group", "Mercier Consultancy Group", false],
];

type Row = Record<string, unknown>;
let db: PGlite;
let before: Map<string, Row>;
let after: Map<string, Row>;
let contract: string;
const read = async () => new Map((await db.query<Row>(`SELECT * FROM public.get_actively_hiring_companies(20)`)).rows
  .map((r) => [String(r.company_token), r]));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SEEN_AGAIN_SCHEMA);
  await db.exec(EXTRA);
  await db.exec(BOARDS.map(([t, c, a]) => board(t, c, a)).join("\n"));
  await db.exec(readFileSync(resolve(DIR, CURVE), "utf8"));
  await db.exec(fromOrigin());
  before = await read();
  await db.exec(newest());
  await db.exec(newest());   // safe to re-run
  after = await read();
  contract = (await db.query<{ c: string }>(
    `SELECT obj_description('public.get_actively_hiring_companies(integer)'::regprocedure, 'pg_proc') AS c`)).rows[0].c ?? "";
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the actively hiring list", () => {
  it("listed all five boards before (the premise: they rank like any employer)", () => {
    expect([...before.keys()].sort()).toEqual(BOARDS.map(([t]) => t).sort());
  });

  it("leaves out a board the catalogue flags as a staffing agency", () => {
    expect(after.has("flagged-staffing")).toBe(false);
  });

  it("leaves out Weekday AI, Distro and Mercier Consultancy Group, which the catalogue does not flag yet", () => {
    expect(after.has("weekday-1")).toBe(false);
    expect(after.has("distro")).toBe(false);
    expect(after.has("mercier-consultancy-group")).toBe(false);
  });

  it("keeps an employer's board, with every figure it had before", () => {
    expect([...after.keys()]).toEqual(["calm-employer"]);
    expect(after.get("calm-employer")).toEqual(before.get("calm-employer"));
  });

  it("says so in its contract, once, however often the file runs", () => {
    expect(contract.split("STAFFING BOARDS (20261112197000)").length - 1).toBe(1);
    expect(contract).toMatch(/stay\s+on the board, labelled/);
  });

  it("is still one definition that anon can call", async () => {
    const r = await db.query<{ n: number; anon: boolean }>(`
      SELECT (SELECT count(*)::int FROM pg_proc WHERE proname = 'get_actively_hiring_companies') AS n,
             has_function_privilege('anon', 'public.get_actively_hiring_companies(integer)', 'EXECUTE') AS anon`);
    expect(r.rows[0]).toEqual({ n: 1, anon: true });
  });
});
