// @vitest-environment node
/**
 * TWO ROLE COUNTS BUILT DIFFERENTLY CLAIMED TO BE BUILT ALIKE.
 *
 * 20261008110000 gave get_company_fill_curve filled_roles_90d and
 * relisted_roles_90d, and its contract said they were "built as
 * get_actively_hiring_companies builds filled_roles_ceiling and
 * relisted_roles_floor"; the leaderboard's own contract (20260909201000) says
 * its suspect and feed-dark exclusion matches the curve's "so the two cannot
 * publish different fill counts for one employer". Neither held. The curve
 * removes a doubted closure whose posting was seen again BEFORE it counts
 * roles (the owner-approved seen-again rule); the leaderboard drops a role on
 * ANY doubted closure in the window. A role that flapped in a dark batch and
 * then came down for real is filled on the employer page and in neither count
 * on the leaderboard pages -- and Workday tenants carry the flap in bulk.
 *
 * Executed, not read: both functions run over one board with ten flapped
 * roles and one without. The difference must be exactly the flapped roles,
 * zero elsewhere, and each stored contract must say so.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEEN_AGAIN_SCHEMA } from "./helpers/seen-again-fixture";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const mig = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const CURVE = "20261008110000_a_role_is_counted_once_and_a_posting_seen_again_never_came_down.sql";
const LEADERBOARD_FILE = "20260909201000_the_same_late_date_in_thirteen_more_places.sql";

/** The leaderboard's own definition, comment and grant, cut from the file that last wrote it. */
function leaderboard(): string {
  const src = mig(LEADERBOARD_FILE);
  const from = src.indexOf("CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies");
  const grant = "GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated, service_role;";
  const to = src.indexOf(grant, from);
  if (from < 0 || to < 0) throw new Error("the leaderboard moved out of " + LEADERBOARD_FILE + " -- re-anchor this guard");
  return src.slice(from, to + grant.length);
}

const EXTRA = `
  ALTER TABLE public.job_board_closures ADD COLUMN company text NOT NULL DEFAULT '', ADD COLUMN title text;
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, feed_total int, verified_at timestamptz);
`;

/** One board: 150 served roles, 80 roles taken down once, 10 more taken down for real 5 days ago -- each,
 *  on the flapped board only, after a suspect batch 15 days ago stamped it and it came back. */
function board(tok: string, company: string, flapped: boolean): string {
  const s = [`
    INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
    SELECT '${tok}:L:'||g, 'workday', '${tok}', 'engineering', now() - interval '20 days', now() - interval '20 days', now() - interval '20 days', now()
    FROM generate_series(1, 150) g;
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, company, title, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
    SELECT '${tok}:F:'||g, 'workday', '${tok}', 'engineering', '${company}', 'Role F'||g, now() - interval '30 days', now() - interval '30 days',
           now() - interval '25 days', false, NULL, 5000, 'full_read'
    FROM generate_series(1, 80) g;
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, company, title, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
    SELECT '${tok}:D:'||g, 'workday', '${tok}', 'engineering', '${company}', 'Role D'||g, now() - interval '30 days', now() - interval '14 days',
           now() - interval '5 days', false, NULL, 5000, 'full_read'
    FROM generate_series(1, 10) g;
    INSERT INTO public.job_board_company_snapshots VALUES ('${tok}', current_date - 40, 150);
  `];
  if (flapped) s.push(`
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, company, title, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
    SELECT '${tok}:D:'||g, 'workday', '${tok}', 'engineering', '${company}', 'Role D'||g, now() - interval '30 days', now() - interval '30 days',
           now() - interval '15 days', false, true, 5000, 'full_read'
    FROM generate_series(1, 10) g;
  `);
  return s.join("\n");
}

type Row = Record<string, unknown>;
let db: PGlite;
let curve: Map<string, Row>;
let leaders: Map<string, Row>;
let curveContract: string;
let leaderContract: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SEEN_AGAIN_SCHEMA);
  await db.exec(EXTRA);
  await db.exec(board("FLAP", "Flapco", true) + board("CALM", "Calmco", false));
  await db.exec(mig(CURVE));        // the curve, before the leaderboard exists
  await db.exec(leaderboard());     // the leaderboard as 20260909201000 wrote it
  await db.exec(mig(CURVE));        // and the curve again: re-run safe, and now the leaderboard is there
  curve = new Map((await db.query<Row>(`SELECT * FROM public.get_company_fill_curve(ARRAY['FLAP','CALM'])`)).rows
    .map((r) => [String(r.company_token), r]));
  leaders = new Map((await db.query<Row>(`SELECT * FROM public.get_actively_hiring_companies(20)`)).rows
    .map((r) => [String(r.company_token), r]));
  const c = await db.query<{ curve: string; lead: string }>(`
    SELECT obj_description('public.get_company_fill_curve(text[])'::regprocedure, 'pg_proc') AS curve,
           obj_description('public.get_actively_hiring_companies(integer)'::regprocedure, 'pg_proc') AS lead`);
  curveContract = c.rows[0].curve;
  leaderContract = c.rows[0].lead;
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the employer page and the leaderboard count a flapped role differently, and say so", () => {
  it("lists both boards on the leaderboard (guards the guard)", () => {
    expect([...leaders.keys()].sort()).toEqual(["CALM", "FLAP"]);
  });

  it("publishes the same role counts on both surfaces for a board with no doubted closure", () => {
    expect(curve.get("CALM")!.filled_roles_90d).toBe(90);
    expect(Number(leaders.get("CALM")!.filled_roles_ceiling)).toBe(90);
    expect(Number(leaders.get("CALM")!.relisted_roles_floor)).toBe(curve.get("CALM")!.relisted_roles_90d);
  });

  it("differs on the flapped board by exactly the roles whose doubted closure was seen again", () => {
    expect(curve.get("FLAP")!.filled_roles_90d).toBe(90);
    expect(Number(leaders.get("FLAP")!.filled_roles_ceiling)).toBe(80);
  });

  it("states that difference in the curve's contract, and no longer claims the two are built alike", () => {
    expect(curveContract).toMatch(/NOT THE LEADERBOARD'S COUNT/);
    expect(curveContract).toMatch(/drops a role on ANY doubted\s+closure in the window, seen again or not/);
    expect(curveContract).not.toMatch(/Built as get_actively_hiring_companies builds/);
  });

  it("states it in the leaderboard's contract too, once, however often the file runs", () => {
    expect(leaderContract.split("SEEN AGAIN (20261008110000)").length - 1).toBe(1);
    expect(leaderContract).toMatch(/can publish fewer filled roles than the employer page does/);
  });
});
