// @vitest-environment node
//
// Node, not jsdom: this file executes migrations in pglite, a wasm Postgres
// that needs real Node globals.
/**
 * A DAY-THIRTY SHARE NEEDS THIRTY DAYS OF READING IN FULL.
 *
 * All three chains that publish S(30) -- the share of a dated cohort still
 * advertised when it reached our 30-day cap -- admitted a board on its
 * observability bucket AS IT STANDS THIS WEEK and then applied that to roles
 * posted 30 to 55 days earlier. Nothing in any gate was about time. Live on
 * 2026-10-01 careers.ulta.com (lap_proven, twelve tracking days, first read
 * 2026-09-07) published 0.9431 with sufficient_30 true on a cohort posted
 * wholly before we first read it; the earliest first provable lap of any lap
 * board was 2026-09-22, three weeks after the cohort ended.
 *
 * THE MECHANISM IS OURS, NOT THE EMPLOYERS'. Before a windowed board's first
 * proven lap an absence is unprovable, so a takedown either becomes an age-out
 * at the cap (counted as "still advertised") or a lap_backfill closure (which
 * every chain excludes). A board onboarded mid-cohort only ever held the roles
 * still alive the day we found it. A full_read board windowed during its
 * cohort keeps no lap record at all once it reads in full again. And a lap
 * board certifies each takedown a lap or more late, however long we have
 * watched it.
 *
 * THE FIX, IN THREE MIGRATIONS (20261002121417 company, 20261002121843 field,
 * 20261002122309 layoff arms): a per-board WATCH FLOOR. A role counts only if
 * it was posted on a later UTC day than the day its board's takedowns became
 * observable -- the later of the first observed day and the last cut-short
 * read, for a full_read board; no floor at all, so refused, for a lap board
 * and for a board we cannot date.
 *
 * THE FIXTURE, every board built from one process whose true S(30) is
 * exactly 0.4000: fifty roles posted on each of the days 31 to 54 ago, one
 * taken down on each of days 1 to 30, twenty reaching the cap.
 *
 *   W  full_read   read in full for eighty days                customer
 *   B  full_read   W, with a single cut-short read 3 days ago   customer
 *   F  full_read   WINDOWED with no proven lap until 12 days
 *                  ago -- its lap entry deleted on going full   customer
 *   N  full_read   onboarded 12 days ago                        customer
 *   L  lap_proven  first provable lap 12 days ago               customer
 *   K  lap_proven  watched 80 days, every takedown certified
 *                  four days late                               customer
 *   P  lap_proven  no lap_w0 at all                             legal
 *   Q  full_read   no watch row                                 legal
 *   G  lap_pending                                              legal
 *   S  full_read   watched only for its two newest days, whose
 *                  roles produced four takedowns between them   science
 *   Z  a token we hold nothing for
 *
 * The takedowns a lap board could not see are written the way the collector
 * writes them: an aged_out exit when the role passed day 30 before the first
 * proven lap, a lap_backfill closure when it did not.
 *
 * THE CONTRACT MOVES WITH THE RULE. A CREATE OR REPLACE keeps a function's
 * stored comment, and the field curve's re-issue keeps its shape: without a
 * comment of its own it would run the floor under 20260925163842's text,
 * which says lap boards are admitted and names two admission tests. The
 * database here is built through that file, so it stores that text exactly
 * as production does, and the comment it holds after the re-issues is read
 * back and judged.
 *
 * TEETH. Every behavioural assertion runs over ONE database: the definitions
 * the database ran until this change first (they must return the defect),
 * then the three re-issues over the same rows. Six mutants of the re-issues
 * are executed against the same rows and each must put a wrong figure back.
 * The code assertions run against comment-stripped SQL and carry their own
 * mutation block at the foot.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { commentsOf } from "./helpers/strip-comments";

// A boot replays lane A and four curve migrations, then the re-issues and
// six mutants over the same rows; the hook budget is the boot's. A single
// query should not take half a minute, so the test budget stays smaller.
vi.setConfig({ hookTimeout: 240_000, testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const mig = (f: string) => readFileSync(resolve(DIR, f), "utf8");
/** Lane A: the eleven 20260918-1xxxxx files that build the layoff chain. */
const LANE_A = FILES.filter((f) => /^202609181\d{5}_/.test(f));

/** The definitions the database ran until this change. */
const WAS_COMPANY = "20260925163517_a_gate_made_of_width_alone_admits_a_board_that_showed_us_nothing.sql";
const WAS_CATEGORY = "20260928003117_a_timeout_that_blanks_a_section_is_raised_where_the_cron_pays_for_it.sql";
const WAS_WRITER = "20260925164237_the_third_day_thirty_chain_on_one_page_gets_the_same_control.sql";
const READER = "20260925164510_an_arm_written_before_the_control_existed_is_not_a_sufficient_arm.sql";
/** The last file that wrote the field curve's stored comment before this change; WAS_CATEGORY raised a header and wrote none. */
const WAS_CATEGORY_CONTRACT = "20260925163842_a_field_pooled_over_boards_that_never_showed_us_an_event_is_not_a_field.sql";
/** The re-issues this file guards. */
const NEW_COMPANY = "20261002121417_a_board_is_judged_at_day_thirty_only_on_roles_posted_while_we_were_reading_it_in_full.sql";
const NEW_CATEGORY = "20261002121843_a_field_pools_only_the_roles_whose_whole_thirty_days_we_could_see.sql";
const NEW_WRITER = "20261002122309_the_layoff_arms_get_the_same_watch_floor_as_the_field_table_beside_them.sql";

/** Executable text only: `--` to end of line, and block comments. */
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/--[^\n]*/g, "");
/** Comment-stripped, trailing blanks trimmed, empty lines dropped: what a comparison of two bodies should see. */
const norm = (s: string) =>
  stripSql(s).split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "").join("\n");

/** One function's definition, from its CREATE to the close of the dollar tag it opened with. */
function definitionOf(sql: string, fn: string): string {
  const m = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").exec(sql);
  if (!m) throw new Error(`no definition of ${fn}`);
  const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(m.index));
  if (!tag) throw new Error(`no body opener for ${fn}`);
  const open = m.index + tag.index + tag[0].indexOf(tag[1]);
  const close = sql.indexOf(tag[1], open + tag[1].length);
  if (close < 0) throw new Error(`unterminated body for ${fn}`);
  return sql.slice(m.index, close + tag[1].length);
}
/** The files defining a function, in apply order. */
const definers = (fn: string) =>
  FILES.filter((f) => new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`).test(stripSql(mig(f))));
/** How many functions one file defines. */
const definitionsIn = (file: string) =>
  [...stripSql(mig(file)).matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.[a-z0-9_]+\s*\(/gi)].length;

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const day = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? null : String(v).slice(0, 10);

/* ───────────────────────────── the database ───────────────────────────── */

const STAND_INS = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz, country text, region_code text);
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text);
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz);
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_meta (
    k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
`;
/** The three tables the floor reads, in their owners' shapes, created up front so the rows exist before either verdict. */
const READ_TABLES = `
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read','lap_proven','lap_pending','unprovable','unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_watch (
    company_token text PRIMARY KEY, first_observed_on date NOT NULL, first_observed_basis text NOT NULL,
    is_censored boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
`;

const W0 = 12; // days ago L's first provable lap completed, N was onboarded, F stopped being windowed
const LAG = 4; // days late K certifies every takedown

function fixture(): string {
  const s: string[] = [];
  const closure = (tok: string, cat: string, a: number, t: number, basis: string, closedDaysAgo: number) => s.push(
    `INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, absence_basis, batch_live_before)
     VALUES ('${tok}:${a}:${t}', 'workday', '${tok}', '${cat}', now() - interval '${a} days',
             now() - interval '${closedDaysAgo} days' - interval '1 hour', '${basis}', 5000);`);
  /** Our own sweep at the cap: posted_at stamped, exited thirty days and two hours later. */
  const ageouts = (tok: string, cat: string, a: number, n: number, tag: string) => s.push(
    `INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
     SELECT '${tok}:${a}:${tag}:'||g, 'workday', '${tok}', '${cat}', 'aged_out',
            now() - interval '${a} days' + interval '30 days 2 hours', now() - interval '${a} days'
     FROM generate_series(1, ${n}) g;`);
  for (let a = 31; a <= 54; a++) {
    for (const [tok, cat] of [["W", "customer"], ["B", "customer"], ["P", "legal"], ["Q", "legal"], ["G", "legal"]]) {
      for (let t = 1; t <= 30; t++) closure(tok, cat, a, t, "full_read", a - t);
      ageouts(tok, cat, a, 20, "s");
    }
    // L: a takedown before the first proven lap cannot be seen. Past the cap
    // first, our sweep logs it aged_out; otherwise the first lap closes it as
    // lap_backfill. After the lap, a lap sees it on the day.
    let hidden = 0;
    for (let t = 1; t <= 30; t++) {
      const takenDown = a - t;
      if (takenDown <= W0) closure("L", "customer", a, t, "lap", takenDown);
      else if (a - 30 > W0) hidden++;
      else closure("L", "customer", a, t, "lap_backfill", W0 - 0.5);
    }
    ageouts("L", "customer", a, 20, "s");
    if (hidden) ageouts("L", "customer", a, hidden, "h");
    // N: onboarded W0 days ago, so it only ever held the roles alive that day.
    if (a - W0 <= 30) {
      for (let t = 1; t <= 30; t++) if (a - t < W0) closure("N", "customer", a, t, "full_read", a - t);
      ageouts("N", "customer", a, 20, "s");
    }
    // F: windowed with no proven lap until W0 days ago; absences unprovable,
    // rows kept, then the first full reads close what is still held.
    hidden = 0;
    for (let t = 1; t <= 30; t++) {
      const takenDown = a - t;
      if (takenDown <= W0) closure("F", "customer", a, t, "full_read", takenDown);
      else if (a - 30 > W0) hidden++;
      else closure("F", "customer", a, t, "full_read", W0 - 0.5);
    }
    ageouts("F", "customer", a, 20, "s");
    if (hidden) ageouts("F", "customer", a, hidden, "h");
    // K: every takedown certified LAG days late; one still awaiting
    // certification at its cap is swept and logged as an age-out.
    let late = 0;
    for (let t = 1; t <= 30; t++) {
      if (t + LAG <= 30) closure("K", "customer", a, t, "lap", a - t - LAG);
      else late++;
    }
    ageouts("K", "customer", a, 20 + late, "s");
    // S: the unwatched days are the true process; the two watched days
    // produced two takedowns each and forty-eight age-outs.
    if (a >= 33) {
      for (let t = 1; t <= 30; t++) closure("S", "science", a, t, "full_read", a - t);
      ageouts("S", "science", a, 20, "s");
    } else {
      for (const t of [10, 20]) closure("S", "science", a, t, "full_read", a - t);
      ageouts("S", "science", a, 48, "s");
    }
  }
  // Snapshots sized so the feed-dark proxy never fires on a batch of one.
  for (const t of ["W", "B", "F", "N", "L", "K", "P", "Q", "G", "S"]) {
    s.push(`INSERT INTO public.job_board_company_snapshots VALUES ('${t}', current_date - 34, 5000);`);
  }
  s.push(`INSERT INTO public.job_board_board_observability (company_token, bucket, lap_w0) VALUES
    ('W','full_read',NULL), ('B','full_read',NULL), ('F','full_read',NULL), ('N','full_read',NULL),
    ('Q','full_read',NULL), ('S','full_read',NULL), ('G','lap_pending',NULL), ('P','lap_proven',NULL),
    ('L','lap_proven', now() - interval '${W0} days'), ('K','lap_proven', now() - interval '80 days');`);
  s.push(`INSERT INTO public.job_board_board_watch (company_token, first_observed_on, first_observed_basis, is_censored)
    SELECT t, current_date - 80, 'company_snapshot', true FROM unnest(ARRAY['W','B','F','L','K','P','G']) t;
    INSERT INTO public.job_board_board_watch (company_token, first_observed_on, first_observed_basis, is_censored) VALUES
      ('N', current_date - ${W0}, 'board_state', false), ('S', current_date - 33, 'board_state', false);`);
  for (let d = 26; d >= 0; d--) {
    s.push(`INSERT INTO public.job_board_board_state (company_token, observed_on, state) VALUES
      ('W', current_date - ${d}, 'ok'), ('S', current_date - ${d}, 'ok'),
      ('B', current_date - ${d}, '${d === 3 ? "truncated" : "ok"}'),
      ('F', current_date - ${d}, '${d > W0 ? "truncated" : "ok"}');`);
  }
  // The two hourly caches, holding a pool computed under the old admission.
  s.push(`INSERT INTO public.job_board_meta (k, v) VALUES
    ('stats_cache', '{"fill_curve":{"computed_at":"2026-10-01T22:27:00Z","rows":[{"category":"customer"}]},"fill_curve_computed_at":"2026-10-01T22:27:00Z","ghost_stats":{"closed_90d":1},"stale_parts":[]}'),
    ('explore_cache', '{"field_curves":{"customer":{"still_open_30":0.5785}},"field_grid":[1]}');`);
  return s.join("\n");
}

const TOKENS = ["W", "B", "F", "N", "L", "K", "P", "Q", "G", "S", "Z"];
const company = async (db: PGlite, toks = TOKENS) =>
  new Map((await db.query<Row>(`SELECT * FROM public.get_company_fill_curve($1::text[])`, [toks])).rows.map((r) => [String(r.company_token), r]));
const category = async (db: PGlite) =>
  new Map((await db.query<Row>(`SELECT * FROM public.get_category_fill_curve(90, 25)`)).rows.map((r) => [String(r.category), r]));
const arms = async (db: PGlite) =>
  new Map((await db.query<Row>(`SELECT * FROM public.get_layoff_partition()`)).rows.map((r) => [String(r.lp_arm), r]));
const refresh = (db: PGlite) => db.query(`SELECT * FROM public.refresh_layoff_partition()`);

/* ───────────────────────────── the mutants ──────────────────────────────
   Each is the shipped file's function definition with one clause spelled the
   way it could plausibly be got wrong, executed as a CREATE OR REPLACE over
   the same rows. The file's self-verifying block is not run for a mutant: it
   would refuse some of them, which is its job, and the point here is what
   the function PUBLISHES while such a body is running. */
const FLOOR_EXPR = `           CASE WHEN o.bucket = 'full_read' AND bw.first_observed_on IS NOT NULL
                THEN GREATEST(bw.first_observed_on,
                              (SELECT max(bs.observed_on)
                                 FROM public.job_board_board_state bs
                                WHERE bs.company_token = o.company_token
                                  AND bs.state = 'truncated'))
           END AS watched_from`;
function mutate(file: string, fn: string, edits: Array<[string | RegExp, string]>): string {
  let def = definitionOf(mig(file), fn);
  for (const [from, to] of edits) {
    const next = typeof from === "string" ? def.split(from).join(to) : def.replace(from, to);
    if (next === def) throw new Error(`${file}: mutant anchor missing: ${String(from).slice(0, 80)}`);
    def = next;
  }
  return def + ";";
}
const MUTANTS = {
  /** The clipped chain and the boolean's watch term deleted; the two new columns kept. */
  companyUnclipped: () => mutate(NEW_COMPANY, "get_company_fill_curve", [
    [" AND r.in_watch30\n    GROUP BY r.tok, r.tt", "\n    GROUP BY r.tok, r.tt"],
    ["\n       AND ob.watched_from IS NOT NULL\n       AND ob.watched_from < (SELECT h.to_d FROM cohort30 h)", ""],
  ]),
  /** Lap boards floored at their first proven lap instead of refused. */
  companyLapReadmitted: () => mutate(NEW_COMPANY, "get_company_fill_curve", [
    ["           CASE WHEN o.bucket = 'full_read' AND bw.first_observed_on IS NOT NULL",
      "           CASE WHEN o.bucket = 'lap_proven' THEN (o.lap_w0 AT TIME ZONE 'UTC')::date\n                WHEN o.bucket = 'full_read' AND bw.first_observed_on IS NOT NULL"],
  ]),
  /** The floor built from the first observed day alone: the read ledger dropped. */
  companyNoReadLedger: () => mutate(NEW_COMPANY, "get_company_fill_curve", [
    [FLOOR_EXPR, "           CASE WHEN o.bucket = 'full_read' THEN bw.first_observed_on END AS watched_from"],
  ]),
  /** The field pool's three admitted lines back to the bucket alone. */
  categoryArmsReverted: () => mutate(NEW_CATEGORY, "get_category_fill_curve", [
    [/COALESCE\(ob\.admitted AND [cep]\.posted_at >= \(\(ob\.watched_from \+ 1\)::timestamp AT TIME ZONE 'UTC'\), false\) AS admitted/g,
      "COALESCE(ob.admitted, false) AS admitted"],
  ]),
  /** The field's per-board control counted over every cohort row again. */
  categoryControlUnfloored: () => mutate(NEW_CATEGORY, "get_category_fill_curve", [
    [" AND r.tt <= 30 AND r.admitted\n    GROUP BY r.tok, r.cat", " AND r.tt <= 30\n    GROUP BY r.tok, r.cat"],
  ]),
  /** The layoff arms' per-board control counted over every cohort row again. */
  writerControlUnfloored: () => mutate(NEW_WRITER, "refresh_layoff_partition", [
    [" AND r.tt <= 30 AND r.admitted\n    GROUP BY r.tok, r.cat", " AND r.tt <= 30\n    GROUP BY r.tok, r.cat"],
  ]),
};

let dates: Record<string, string>;
let before: { co: Map<string, Row>; cat: Map<string, Row>; lp: Map<string, Row> };
let after: { co: Map<string, Row>; cat: Map<string, Row>; lp: Map<string, Row> };
let migrated: Map<string, Row>;
let meta: Record<string, Record<string, unknown>>;
let partial: Row;
/** The field curve's stored comment, as the database holds it before and after the re-issues. */
let contract: { before: string | null; after: string | null };
const storedContract = async (db: PGlite) =>
  (await db.query<{ d: string | null }>(
    `SELECT obj_description('public.get_category_fill_curve(int, int)'::regprocedure, 'pg_proc') AS d`,
  )).rows[0].d;
const mutant: Record<string, { co?: Map<string, Row>; cat?: Map<string, Row>; lp?: Map<string, Row> }> = {};
const mutantError: Record<string, string> = {};
/** A mutant's published rows, or a failure naming why it could not be built. */
const ran = (name: keyof typeof MUTANTS) => {
  expect(mutantError[name], `mutant ${name} could not be built`).toBeUndefined();
  return mutant[name];
};
const dbs: PGlite[] = [];

beforeAll(async () => {
  const db = new PGlite();
  dbs.push(db);
  await db.exec(STAND_INS);
  await db.exec(READ_TABLES);
  for (const f of LANE_A) await db.exec(mig(f));
  await db.exec(fixture());
  dates = (await db.query<Record<string, string>>(
    `SELECT (current_date - 80)::text AS d80, (current_date - 40)::text AS d40, (current_date - 33)::text AS d33,
            (current_date - 13)::text AS d13, (current_date - 12)::text AS d12, (current_date - 3)::text AS d3`,
  )).rows[0];

  // BEFORE: the definitions the database ran until this change, the field
  // curve built through the file that wrote its stored comment, so the
  // comment the re-issue inherits is the one production holds.
  for (const f of [WAS_COMPANY, WAS_CATEGORY_CONTRACT, WAS_CATEGORY, WAS_WRITER, READER]) await db.exec(mig(f));
  const contractBefore = await storedContract(db);
  const coBefore = await company(db);
  const catBefore = await category(db);
  await refresh(db);
  before = { co: coBefore, cat: catBefore, lp: await arms(db) };

  // AFTER: the three re-issues over the same rows and the same stored partition.
  for (const f of [NEW_COMPANY, NEW_CATEGORY, NEW_WRITER]) await db.exec(mig(f));
  contract = { before: contractBefore, after: await storedContract(db) };
  const coAfter = await company(db);
  const catAfter = await category(db);
  migrated = await arms(db);
  meta = Object.fromEntries(
    (await db.query<{ k: string; v: Record<string, unknown> }>(`SELECT k, v FROM public.job_board_meta`)).rows.map((r) => [r.k, r.v]),
  );
  await refresh(db);
  after = { co: coAfter, cat: catAfter, lp: await arms(db) };

  // PARTIAL WATCH: W restated as first observed forty days ago, then put back.
  await db.exec(`UPDATE public.job_board_board_watch SET first_observed_on = current_date - 40 WHERE company_token = 'W'`);
  partial = (await company(db, ["W"])).get("W")!;
  await db.exec(`UPDATE public.job_board_board_watch SET first_observed_on = current_date - 80 WHERE company_token = 'W'`);

  // MUTANTS, one at a time, each followed by the shipped definition again.
  const restore = {
    co: definitionOf(mig(NEW_COMPANY), "get_company_fill_curve") + ";",
    cat: definitionOf(mig(NEW_CATEGORY), "get_category_fill_curve") + ";",
    lp: definitionOf(mig(NEW_WRITER), "refresh_layoff_partition") + ";",
  };
  // A mutant whose anchor is missing is recorded rather than thrown, so the
  // behavioural assertions above still run and the teeth below say which
  // mutant could not be built.
  const run = async (name: keyof typeof MUTANTS, read: () => Promise<(typeof mutant)[string]>, back: string) => {
    try {
      await db.exec(MUTANTS[name]());
      mutant[name] = await read();
    } catch (e) {
      mutantError[name] = String(e);
    }
    await db.exec(back);
  };
  for (const name of ["companyUnclipped", "companyLapReadmitted", "companyNoReadLedger"] as const) {
    await run(name, async () => ({ co: await company(db) }), restore.co);
  }
  for (const name of ["categoryArmsReverted", "categoryControlUnfloored"] as const) {
    await run(name, async () => ({ cat: await category(db) }), restore.cat);
  }
  await run("writerControlUnfloored", async () => { await refresh(db); return { lp: await arms(db) }; }, restore.lp);
}, 240_000);

afterAll(async () => {
  for (const db of dbs) { try { await db.close(); } catch { /* best effort */ } }
});

/* ───────────────────────────── behaviour ─────────────────────────────── */

describe("the definitions the database ran until this change publish our blindness as a share", () => {
  it("a lap board whose first provable lap postdates its cohort publishes Ulta's shape", () => {
    const l = before.co.get("L")!;
    expect(l.observability_bucket).toBe("lap_proven");
    expect(num(l.still_open_30)).toBeCloseTo(0.915, 4);
    expect(num(l.still_open_30_lo)).toBeCloseTo(0.8951, 4);
    expect(num(l.still_open_30_hi)).toBeCloseTo(0.9314, 4);
    expect(num(l.n_at_risk_30)).toBe(852);
    expect(num(l.ageouts_at_30), "almost the whole risk set at the cap is our own sweep").toBe(840);
    expect(l.sufficient_30).toBe(true);
  });

  it("an onboarded board, a formerly windowed board and a late-certifying lap board all pass too", () => {
    expect(num(before.co.get("N")!.still_open_30)).toBeCloseTo(0.7843, 4);
    expect(num(before.co.get("F")!.still_open_30)).toBeCloseTo(0.7242, 4);
    expect(num(before.co.get("K")!.still_open_30)).toBeCloseTo(0.48, 4);
    for (const t of ["N", "F", "K"]) expect(before.co.get(t)!.sufficient_30, t).toBe(true);
    // The board read in full is right, so the fixture's truth is what the
    // others are compared against.
    expect(num(before.co.get("W")!.still_open_30)).toBeCloseTo(0.4, 4);
  });

  it("the field pools them and the layoff control arm inherits them", () => {
    const customer = before.cat.get("customer")!;
    expect(num(customer.still_open_30)).toBeCloseTo(0.5785, 4);
    expect(customer.sufficient_30).toBe(true);
    expect(num(customer.gate_share_30)).toBeCloseTo(1, 4);
    const control = before.lp.get("control")!;
    expect(num(control.lp_still_open_30)).toBeCloseTo(0.5176, 4);
    expect(control.lp_sufficient_30).toBe(true);
  });
});

describe("a role counts at day 30 only if its board was read in full from before it was posted", () => {
  it("the board read in full keeps its figure, unchanged, and publishes its floor", () => {
    const w = after.co.get("W")!, was = before.co.get("W")!;
    expect(num(w.still_open_30)).toBeCloseTo(0.4, 4);
    expect(w.sufficient_30).toBe(true);
    expect(w.insufficient_reason_30).toBeNull();
    expect(day(w.watched_from)).toBe(dates.d80);
    for (const k of ["still_open_30", "still_open_30_lo", "still_open_30_hi", "taken_down_30", "relist_rate_30",
      "n_at_risk_30", "ageouts_at_30", "events_30", "fills_30", "relists_30", "cohort_from", "cohort_to"]) {
      expect(w[k], `W.${k} moved`).toEqual(was[k]);
    }
  });

  it("refuses the onboarded board and the formerly windowed board for 'watch', and says where the floor sits", () => {
    const n = after.co.get("N")!, f = after.co.get("F")!;
    expect(day(n.watched_from), "the day we first read it").toBe(dates.d12);
    expect(day(f.watched_from), "its last cut-short read, later than its first observed day").toBe(dates.d13);
    for (const r of [n, f]) {
      expect(r.sufficient_30).toBe(false);
      expect(r.insufficient_reason_30).toBe("watch");
      expect(r.still_open_30, "no watched member, so no figure").toBeNull();
      expect(r.n_at_risk_30).toBeNull();
    }
  });

  it("refuses every lap board for 'lap', however long it has been watched", () => {
    for (const t of ["L", "K", "P"]) {
      const r = after.co.get(t)!;
      expect(r.observability_bucket).toBe("lap_proven");
      expect(r.sufficient_30, t).toBe(false);
      expect(r.insufficient_reason_30, t).toBe("lap");
      expect(r.watched_from, `${t} has no floor`).toBeNull();
      expect(r.still_open_30, t).toBeNull();
    }
  });

  it("refuses in the safe direction wherever the floor cannot be dated", () => {
    expect(after.co.get("Q")!.insufficient_reason_30, "full_read with no watch row").toBe("watch");
    expect(after.co.get("Q")!.watched_from).toBeNull();
    expect(after.co.get("G")!.insufficient_reason_30, "a bucket that cannot prove an absence").toBe("unobservable");
    expect(after.co.get("Z")!.insufficient_reason_30, "a token we hold nothing for").toBe("unobservable");
    for (const t of ["Q", "G", "Z"]) expect(after.co.get(t)!.sufficient_30, t).toBe(false);
  });

  it("pays for a single cut-short read with thirty-one days, as the migration says it chooses to", () => {
    const b = after.co.get("B")!;
    expect(num(before.co.get("B")!.still_open_30)).toBeCloseTo(0.4, 4);
    expect(day(b.watched_from)).toBe(dates.d3);
    expect(b.insufficient_reason_30).toBe("watch");
    expect(b.still_open_30).toBeNull();
  });

  it("clips per board: a partly watched board is measured on its watched members alone", () => {
    // W restated as first observed forty days ago keeps the members posted
    // 31 to 39 days ago: nine days of twenty-one rows at the cap each.
    expect(day(partial.watched_from)).toBe(dates.d40);
    expect(num(partial.still_open_30)).toBeCloseTo(0.4, 4);
    expect(num(partial.n_at_risk_30)).toBe(189);
    expect(partial.sufficient_30).toBe(true);
    // S is watched for its two newest days only; those produced four
    // takedowns, so it publishes its watched figure and is refused on events.
    const s = after.co.get("S")!;
    expect(day(s.watched_from)).toBe(dates.d33);
    expect(num(s.n_at_risk_30)).toBe(96);
    expect(num(s.events_30)).toBe(4);
    expect(s.insufficient_reason_30).toBe("events");
    expect(s.sufficient_30).toBe(false);
  });

  it("the field is the truth again, and the share it publishes discloses the cut", () => {
    const c = after.cat.get("customer")!;
    expect(num(c.still_open_30)).toBeCloseTo(0.4, 4);
    expect(num(c.n_at_risk_30), "W's risk set alone").toBe(504);
    expect(c.sufficient_30).toBe(true);
    expect(num(c.gate_share_30), "one board's dated cohort of six").toBeCloseTo(0.1992, 4);
    expect(num(c.dated_cohort_n_30), "the denominator did not move").toBe(num(before.cat.get("customer")!.dated_cohort_n_30));
  });

  it("a field whose every board is refused publishes nothing and says the cut was total", () => {
    for (const field of ["legal", "science"]) {
      const r = after.cat.get(field)!;
      expect(r.still_open_30, field).toBeNull();
      expect(r.sufficient_30, field).toBe(false);
      expect(num(r.gate_share_30), field).toBe(0);
      expect(before.cat.get(field)!.sufficient_30, `${field} was published before`).toBe(true);
    }
  });

  it("the stored layoff arms are refused from the instant the migration applies, then recomputed by the refresh", () => {
    for (const arm of ["filed", "control"]) {
      const r = migrated.get(arm)!;
      expect(r.lp_events_30, `${arm}: the stored count is withheld`).toBeNull();
      expect(r.lp_sufficient_30).toBe(false);
      expect(r.lp_reason).toBe("uncontrolled");
    }
    // A refusal, not a wipe: the stored figure is still there until the refresh.
    expect(num(migrated.get("control")!.lp_still_open_30)).toBeCloseTo(0.5176, 4);
    const c = after.lp.get("control")!;
    expect(num(c.lp_still_open_30)).toBeCloseTo(0.4, 4);
    expect(num(c.lp_n_at_risk_30)).toBe(504);
    expect(c.lp_sufficient_30).toBe(true);
    expect(c.lp_reason).toBeNull();
    expect(num(c.lp_gate_share_30)).toBeCloseTo(0.1109, 4);
  });

  it("the field curve's stored contract moves with its admission rule", () => {
    // The fixture holds the text production holds: lap boards admitted, two
    // tests. A re-issue that kept it would run the floor under that text.
    expect(contract.before, "the inherited contract").toMatch(/full_read or lap_proven/);
    expect(contract.before).toMatch(/cleared both tests/);
    const now = contract.after ?? "";
    expect(now, "the contract states the floor the body runs").toMatch(/WATCH FLOOR \(20261002121843\)/);
    expect(now).toMatch(/lap_proven board has none either and is REFUSED/);
    expect(now).toMatch(/ONE TRUNCATED DAY COSTS THIRTY-ONE DAYS/);
    expect(now).toMatch(/passes THREE admission tests/);
    expect(now).toMatch(/\[GREATEST\(cohort_from, watched_from \+ 1\), cohort_to\]/);
    expect(now, "an emptied field is described by the old two tests").not.toMatch(/cleared both tests/);
    expect(now, "the gate share is described as covering two gates").not.toMatch(/BOTH gates/);
    // Narrowed, not deleted: the bucket is still a necessary test, and the
    // sentences the estimator and the day-30 guards read are still there.
    expect(now).toMatch(/necessary test and no longer a sufficient one/);
    expect(now).toMatch(/NULL -- not 1\.0/);
    expect(now).toMatch(/APPROXIMATION/);
    expect(now).toMatch(/A closure never means hired/);
  });

  it("the two hourly caches lose the pre-fix pool and keep everything else", () => {
    expect(meta.stats_cache).not.toHaveProperty("fill_curve");
    expect(meta.stats_cache).not.toHaveProperty("fill_curve_computed_at");
    expect(meta.stats_cache).toHaveProperty("ghost_stats");
    expect(meta.stats_cache).toHaveProperty("stale_parts");
    expect(meta.explore_cache).not.toHaveProperty("field_curves");
    expect(meta.explore_cache).toHaveProperty("field_grid");
  });
});

describe("teeth: each mutant puts a wrong figure back on the same rows", () => {
  it("deleting the clip and the boolean's watch term republishes Ulta's shape while still printing a reason", () => {
    const l = ran("companyUnclipped").co!.get("L")!;
    expect(num(l.still_open_30)).toBeCloseTo(0.915, 4);
    expect(l.sufficient_30).toBe(true);
    expect(l.insufficient_reason_30, "a reason beside an inflated figure").toBe("lap");
  });

  it("flooring lap boards at their first proven lap re-admits the late-certifying board", () => {
    const k = ran("companyLapReadmitted").co!.get("K")!;
    expect(num(k.still_open_30)).toBeCloseTo(0.48, 4);
    expect(k.sufficient_30).toBe(true);
  });

  it("dropping the read ledger re-admits the formerly windowed board", () => {
    const f = ran("companyNoReadLedger").co!.get("F")!;
    expect(num(f.still_open_30)).toBeCloseTo(0.7242, 4);
    expect(f.sufficient_30).toBe(true);
  });

  it("reverting the field's admitted lines puts the field back where it was", () => {
    expect(num(ran("categoryArmsReverted").cat!.get("customer")!.still_open_30)).toBeCloseTo(0.5785, 4);
  });

  it("counting the field's control over unwatched rows lets them vouch for the watched ones", () => {
    const sci = ran("categoryControlUnfloored").cat!.get("science")!;
    expect(num(sci.gate_share_30)).toBeGreaterThan(0);
    expect(num(sci.still_open_30)).toBeCloseTo(0.96, 4);
  });

  it("counting the layoff arms' control over unwatched rows moves the control arm off the truth", () => {
    const c = ran("writerControlUnfloored").lp!.get("control")!;
    expect(num(c.lp_n_at_risk_30), "W's 504 and S's 96 watched rows").toBe(600);
    expect(num(c.lp_still_open_30), "four points off the truth, on four takedowns").toBeCloseTo(0.4431, 4);
  });
});

describe("each re-issue loads alone onto a schema that has never seen the tables it reads", () => {
  it("the two curves and the writer apply on lane A without the observability, watch and read-ledger tables", async () => {
    const db = new PGlite();
    dbs.push(db);
    await db.exec(STAND_INS);
    for (const f of LANE_A) await db.exec(mig(f));
    // No 20260925164237 either: the writer's file restates the columns and
    // the reasons it writes, so it stands on lane A alone.
    for (const f of [NEW_COMPANY, NEW_CATEGORY, NEW_WRITER]) await db.exec(mig(f));
    const tables = (await db.query<{ t: string }>(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('job_board_board_observability', 'job_board_board_watch', 'job_board_board_state')
        ORDER BY 1`,
    )).rows.map((r) => r.t);
    expect(tables).toEqual(["job_board_board_observability", "job_board_board_state", "job_board_board_watch"]);
    expect((await company(db, ["Z"])).get("Z")!.insufficient_reason_30).toBe("unobservable");
    await refresh(db);
    expect((await arms(db)).get("control")!.lp_reason).toBe("n");
  });
});

/* ───────────────────────────── the code ──────────────────────────────── */

const LIVE = {
  company: definitionOf(mig(NEW_COMPANY), "get_company_fill_curve"),
  category: definitionOf(mig(NEW_CATEGORY), "get_category_fill_curve"),
  writer: definitionOf(mig(NEW_WRITER), "refresh_layoff_partition"),
};

/** Every property of the floor, over comment-stripped code. */
function floorViolations(code: string, grain: "tok" | "pool"): string[] {
  const v: string[] = [];
  const flat = code.replace(/\s+/g, " ");
  const floor = /CASE WHEN o\.bucket = 'full_read' AND bw\.first_observed_on IS NOT NULL THEN GREATEST\(bw\.first_observed_on, \(SELECT max\(bs\.observed_on\) FROM public\.job_board_board_state bs WHERE bs\.company_token = o\.company_token AND bs\.state = 'truncated'\)\) END AS watched_from/;
  if (!floor.test(flat)) v.push("floor");
  if (!/LEFT JOIN public\.job_board_board_watch bw ON bw\.company_token = o\.company_token/.test(flat)) v.push("watch-join");
  // A lap board has no floor: nothing between the CASE and its alias names
  // lap_w0 or the lap bucket.
  const caseAt = flat.indexOf("CASE WHEN o.bucket");
  const aliasAt = flat.indexOf("AS watched_from", caseAt);
  if (caseAt >= 0 && aliasAt > caseAt && /lap_w0|lap_proven/.test(flat.slice(caseAt, aliasAt))) v.push("lap-floored");
  if (grain === "tok") {
    const arms = flat.match(/COALESCE\([cep]\.posted_at >= \(\(wf\.watched_from \+ 1\)::timestamp AT TIME ZONE 'UTC'\), false\) AS in_watch30/g)?.length ?? 0;
    if (arms !== 3) v.push("arms");
    if ((flat.match(/LEFT JOIN obs wf ON wf\.tok = [cep]\.company_token/g)?.length ?? 0) !== 3) v.push("arm-joins");
    if (!/WHERE r\.in_cohort30 AND r\.tt IS NOT NULL AND r\.tt >= 0 AND r\.in_watch30 GROUP BY r\.tok, r\.tt/.test(flat)) v.push("chain-clipped");
    if (!/COALESCE\(ob\.admitted AND ob\.watched_from IS NOT NULL AND ob\.watched_from < \(SELECT h\.to_d FROM cohort30 h\) AND/.test(flat)) v.push("gate-term");
    if (!/ob\.watched_from AS watched_from/.test(flat)) v.push("floor-published");
    const order = ["'unobservable'", "'lap'", "'watch'", "'n'", "'events'", "'fills'", "'relists'", "'width'", "'precision'", "'arithmetic'"]
      .map((w) => flat.indexOf(`THEN ${w}`));
    if (order.some((i) => i < 0) || order.some((i, k) => k > 0 && i < order[k - 1])) v.push("reason-order");
    if (!/WHEN ob\.bucket = 'lap_proven' THEN 'lap'/.test(flat)) v.push("reason-lap");
    if (!/WHEN ob\.watched_from IS NULL OR ob\.watched_from >= \(SELECT h\.to_d FROM cohort30 h\) THEN 'watch'/.test(flat)) v.push("reason-watch");
    if (!/END AS insufficient_reason_30/.test(flat)) v.push("reason-published");
  } else {
    const arms = flat.match(/COALESCE\(ob\.admitted AND [cep]\.posted_at >= \(\(ob\.watched_from \+ 1\)::timestamp AT TIME ZONE 'UTC'\), false\) AS admitted/g)?.length ?? 0;
    if (arms !== 3) v.push("arms");
    if (/COALESCE\(ob\.admitted, false\) AS admitted/.test(flat)) v.push("bucket-only-arm");
    if (!/AND r\.tt <= 30 AND r\.admitted GROUP BY r\.tok, r\.cat/.test(flat)) v.push("control-floored");
  }
  return v;
}

/** The day-30 constants as one record: name -> spelled value. */
function constants(code: string): Record<string, string> {
  const k = /\bk AS \(\s*SELECT([\s\S]*?)\n\s*\),/.exec(code);
  if (!k) return {};
  const out: Record<string, string> = {};
  for (const piece of k[1].split(",")) {
    const m = /^([\s\S]*?)\s+AS\s+(\w+)$/.exec(piece.trim());
    if (m) out[m[2]] = m[1].replace(/\s+/g, " ");
  }
  return out;
}

describe("the floor is spelled where the database can run it", () => {
  it("each re-issue is the newest definition of its function, and replaces the one this file's 'before' runs", () => {
    for (const [fn, was, now] of [
      ["get_company_fill_curve", WAS_COMPANY, NEW_COMPANY],
      ["get_category_fill_curve", WAS_CATEGORY, NEW_CATEGORY],
      ["refresh_layoff_partition", WAS_WRITER, NEW_WRITER],
    ] as const) {
      const files = definers(fn);
      expect(files.at(-1), `${fn}: the pins follow the newest definition`).toBe(now);
      expect(files.at(-2), `${fn}: 'before' is the definition the re-issue replaced`).toBe(was);
      expect(definitionsIn(now), `${now} defines one function`).toBe(1);
    }
  });

  it("carries every property of the floor, at both grains, against comment-stripped code", () => {
    expect(floorViolations(stripSql(LIVE.company), "tok")).toEqual([]);
    expect(floorViolations(stripSql(LIVE.category), "pool")).toEqual([]);
    expect(floorViolations(stripSql(LIVE.writer), "pool")).toEqual([]);
  });

  it("spells the floor identically in all three functions", () => {
    const floorOf = (def: string) => {
      const flat = stripSql(def).replace(/\s+/g, " ");
      const at = flat.indexOf("CASE WHEN o.bucket = 'full_read'");
      return flat.slice(at, flat.indexOf("AS watched_from", at));
    };
    const co = floorOf(LIVE.company);
    expect(co.length).toBeGreaterThan(100);
    expect(floorOf(LIVE.category)).toBe(co);
    expect(floorOf(LIVE.writer)).toBe(co);
  });

  it("keeps the day-30 constants identical across the three chains", () => {
    const co = constants(stripSql(LIVE.company));
    const cat = constants(stripSql(LIVE.category));
    const lw = constants(stripSql(LIVE.writer));
    for (const name of ["exits_origin_stamped_from", "min_n_at_risk_30", "min_events_30", "min_fills_30", "max_half_width_30", "max_rel_half_width_30"]) {
      expect(co[name], `company ${name}`).toBeTruthy();
      expect(cat[name], `category ${name}`).toBe(co[name]);
      expect(lw[name], `writer ${name}`).toBe(co[name]);
    }
  });

  it("changes nothing else: each body is its predecessor with exactly the floor's edits applied", () => {
    // Comment-stripped with blank lines dropped on both sides, so prose may
    // move freely and one moved token anywhere else fails.
    const floorLine = (al: "c" | "e" | "p", alias: string) =>
      `COALESCE(${al}.posted_at >= ((${alias}.watched_from + 1)::timestamp AT TIME ZONE 'UTC'), false)`;
    const pooled = (base: string) => {
      let s = norm(base);
      const obs = "           (o.bucket IN ('full_read', 'lap_proven')) AS admitted\n    FROM public.job_board_board_observability o\n  ),";
      expect(s.includes(obs), "pooled predecessor's obs").toBe(true);
      s = s.replace(obs, "           (o.bucket IN ('full_read', 'lap_proven')) AS admitted,\n" + FLOOR_EXPR +
        "\n    FROM public.job_board_board_observability o\n    LEFT JOIN public.job_board_board_watch bw ON bw.company_token = o.company_token\n  ),");
      for (const al of ["c", "e", "p"] as const) {
        s = s.replace("      COALESCE(ob.admitted, false) AS admitted,",
          `      ${floorLine(al, "ob").replace("COALESCE(", "COALESCE(ob.admitted AND ")} AS admitted,`);
      }
      return s.replace(" AND r.tt <= 30\n    GROUP BY r.tok, r.cat", " AND r.tt <= 30 AND r.admitted\n    GROUP BY r.tok, r.cat");
    };
    expect(norm(LIVE.category)).toBe(pooled(definitionOf(mig(WAS_CATEGORY), "get_category_fill_curve")));
    expect(norm(LIVE.writer)).toBe(pooled(definitionOf(mig(WAS_WRITER), "refresh_layoff_partition")));

    let co = norm(definitionOf(mig(WAS_COMPANY), "get_company_fill_curve"));
    const edit = (a: string, b: string) => {
      expect(co.split(a).length - 1, `company predecessor anchor: ${a.slice(0, 60)}`).toBe(1);
      co = co.replace(a, b);
    };
    edit("  relists_30          int\n)", "  relists_30          int,\n  watched_from        date,\n  insufficient_reason_30 text\n)");
    edit(
      "           (o.bucket IN ('full_read', 'lap_proven')) AS admitted\n    FROM public.job_board_board_observability o\n    JOIN toks ON toks.tok = o.company_token\n  ),",
      "           (o.bucket IN ('full_read', 'lap_proven')) AS admitted,\n" + FLOOR_EXPR +
        "\n    FROM public.job_board_board_observability o\n    JOIN toks ON toks.tok = o.company_token\n    LEFT JOIN public.job_board_board_watch bw ON bw.company_token = o.company_token\n  ),",
    );
    for (const al of ["c", "e", "p"] as const) {
      const cohortLine = `        AND ${al}.posted_at <  (SELECT h.to_d FROM cohort30 h) + 1) AS in_cohort30,`;
      edit(cohortLine, `${cohortLine}\n      ${floorLine(al, "wf")} AS in_watch30,`);
    }
    edit("    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at\n",
      "    LEFT JOIN dark dk ON dk.tok = c.company_token AND dk.at = c.closed_at\n    LEFT JOIN obs wf ON wf.tok = c.company_token\n");
    edit("    LEFT JOIN bad_batch bb ON bb.tok = e.company_token AND bb.at = e.exited_at\n",
      "    LEFT JOIN bad_batch bb ON bb.tok = e.company_token AND bb.at = e.exited_at\n    LEFT JOIN obs wf ON wf.tok = e.company_token\n");
    edit("    JOIN toks ON toks.tok = p.company_token\n    WHERE p.missing_since IS NULL\n  ),\n  counts AS (",
      "    JOIN toks ON toks.tok = p.company_token\n    LEFT JOIN obs wf ON wf.tok = p.company_token\n    WHERE p.missing_since IS NULL\n  ),\n  counts AS (");
    edit("    WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0\n    GROUP BY r.tok, r.tt\n  ),\n  curve30",
      "    WHERE r.in_cohort30 AND r.tt IS NOT NULL AND r.tt >= 0 AND r.in_watch30\n    GROUP BY r.tok, r.tt\n  ),\n  curve30");
    edit("    COALESCE(ob.admitted\n",
      "    COALESCE(ob.admitted\n       AND ob.watched_from IS NOT NULL\n       AND ob.watched_from < (SELECT h.to_d FROM cohort30 h)\n");
    // The two appended columns are pinned term by term by floorViolations;
    // here they are carried across so the rest of the body is compared.
    const live = norm(LIVE.company);
    const addedAt = live.search(/^ {4}ob\.watched_from\s+AS watched_from,$/m);
    expect(addedAt, "the published floor's projection line").toBeGreaterThan(0);
    const added = live.slice(addedAt, live.indexOf("\n  FROM toks t\n", addedAt) + 1);
    expect(added).toMatch(/AS insufficient_reason_30\n$/);
    edit("    CASE WHEN ob.admitted THEN e30.relists30 END           AS relists_30\n  FROM toks t",
      "    CASE WHEN ob.admitted THEN e30.relists30 END           AS relists_30,\n" + added + "  FROM toks t");
    expect(live).toBe(co);
  });

  it("withholds the stored pools in code, by statements that name the rows they mean", () => {
    const cat = stripSql(mig(NEW_CATEGORY)).replace(/\s+/g, " ");
    expect(cat).toMatch(/SET v = v - 'fill_curve' - 'fill_curve_computed_at' WHERE k = 'stats_cache';/);
    expect(cat).toMatch(/SET v = v - 'field_curves' WHERE k = 'explore_cache';/);
    const lw = stripSql(mig(NEW_WRITER)).replace(/\s+/g, " ");
    expect(lw).toMatch(/UPDATE public\.job_board_layoff_partition SET events_30 = NULL, fills_30 = NULL, relists_30 = NULL WHERE events_30 IS NOT NULL OR fills_30 IS NOT NULL OR relists_30 IS NOT NULL;/);
    // A predicate-less UPDATE or DELETE is refused in a PostgREST session
    // (20260926143012); none of the three files carries one.
    for (const f of [NEW_COMPANY, NEW_CATEGORY, NEW_WRITER]) {
      const code = stripSql(mig(f)).replace(/\s+/g, " ");
      for (const m of code.matchAll(/\b(UPDATE public\.\w+ SET [^;]*|DELETE FROM public\.\w+[^;]*);/g)) {
        expect(m[1], `${f}: ${m[1].slice(0, 60)}`).toMatch(/\bWHERE\b/);
      }
    }
  });

  it("repeats only the CREATE of the three tables it reads, never an ALTER or a grant that would lock them", () => {
    for (const f of [NEW_COMPANY, NEW_CATEGORY, NEW_WRITER]) {
      const code = stripSql(mig(f));
      for (const t of ["job_board_board_observability", "job_board_board_watch", "job_board_board_state"]) {
        expect(code, `${f} creates ${t}`).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`));
        expect(code, `${f} alters ${t}`).not.toMatch(new RegExp(`ALTER TABLE (?:ONLY )?public\\.${t}\\b`));
        expect(code, `${f} re-grants ${t}`).not.toMatch(new RegExp(`(?:GRANT|REVOKE)[^;]*\\bpublic\\.${t}\\b`));
      }
    }
  });

  it("states the floor and the lap refusal in the contracts the functions carry", () => {
    const join = (raw: string, fn: string) => raw.slice(raw.lastIndexOf(`COMMENT ON FUNCTION public.${fn}`)).replace(/'\s*\n\s*'/g, "");
    const co = join(mig(NEW_COMPANY), "get_company_fill_curve");
    expect(co).toMatch(/WATCH FLOOR \(20261002121417\)/);
    expect(co).toMatch(/\[GREATEST\(cohort_from, watched_from \+ 1\), cohort_to\]/);
    expect(co).toMatch(/ONE TRUNCATED DAY COSTS THIRTY-ONE DAYS/);
    expect(co).toMatch(/lap_proven board has none either and is REFUSED/);
    expect(co).toMatch(/unobservable, lap, watch, n, events, fills, relists, width, precision, arithmetic/);
    expect(join(mig(NEW_WRITER), "refresh_layoff_partition")).toMatch(/WATCH FLOOR \(20261002122309\)/);
    // The field curve keeps its shape, so nothing forces a comment; it states
    // its own anyway, because the one it would keep describes the old rule.
    const cat = join(mig(NEW_CATEGORY), "get_category_fill_curve");
    expect(cat).toMatch(/WATCH FLOOR \(20261002121843\)/);
    expect(cat).toMatch(/lap_proven board has none either and is REFUSED/);
    expect(cat).not.toMatch(/cleared both tests/);
    // And it proves that at apply time: the file refuses to report success
    // if the comment stored beside the body does not state the floor.
    expect(stripSql(mig(NEW_CATEGORY)).replace(/\s+/g, " ")).toMatch(
      /obj_description\('public\.get_category_fill_curve\(int, int\)'::regprocedure, 'pg_proc'\), ''\) NOT LIKE '%WATCH FLOOR \(20261002121843\)%' THEN RAISE EXCEPTION/,
    );
  });

  it("carries unique, non-round stamps after the previous day's last stamp, in apply order", () => {
    const stamps = [NEW_COMPANY, NEW_CATEGORY, NEW_WRITER].map((f) => f.slice(0, 14));
    for (const s of stamps) {
      expect(s).toMatch(/^2026100212\d{4}$/);
      expect(s.slice(12), "a round second collides with the runner's own stamps").not.toBe("00");
      expect(FILES.filter((f) => f.startsWith(s)), s).toHaveLength(1);
      expect(s > "20261001090000").toBe(true);
    }
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("keeps the floor's executable spellings out of the three migrations' prose and this file's comments", () => {
    const guarded = ["::timestamp AT TIME ZONE 'UTC')", "AND r.in_watch30", "AND r.tt <= 30 AND r.admitted", "THEN 'lap'"];
    for (const f of [NEW_COMPANY, NEW_CATEGORY, NEW_WRITER]) {
      const prose = mig(f).split("\n").filter((l) => /^\s*--/.test(l)).join("\n");
      for (const lit of guarded) expect(prose, `${f} prose spells ${lit}`).not.toContain(lit);
    }
    const own = commentsOf(readFileSync(__filename, "utf8"));
    for (const lit of guarded) expect(own, `a comment in this file spells ${lit}`).not.toContain(lit);
  });
});

describe("the code checker can actually fail", () => {
  it("fires on the definitions these files replace", () => {
    expect(floorViolations(stripSql(definitionOf(mig(WAS_COMPANY), "get_company_fill_curve")), "tok")).toEqual(
      expect.arrayContaining(["floor", "watch-join", "arms", "chain-clipped", "gate-term", "reason-lap", "reason-watch"]),
    );
    for (const [file, fn] of [[WAS_CATEGORY, "get_category_fill_curve"], [WAS_WRITER, "refresh_layoff_partition"]] as const) {
      expect(floorViolations(stripSql(definitionOf(mig(file), fn)), "pool")).toEqual(
        expect.arrayContaining(["floor", "watch-join", "arms", "bucket-only-arm", "control-floored"]),
      );
    }
  });

  it("is not satisfied by the right spellings appearing only in a COMMENT", () => {
    // The superseded body with the whole new body appended as comment lines.
    // Against the raw text the single-line properties are satisfied by the
    // comment; against the stripped view every one of them fires.
    const commented = LIVE.company.split("\n").map((l) => `-- ${l}`).join("\n");
    const text = definitionOf(mig(WAS_COMPANY), "get_company_fill_curve") + "\n" + commented;
    const single = ["watch-join", "reason-lap", "reason-watch"];
    const raw = floorViolations(text, "tok");
    for (const flag of single) expect(raw, `raw text satisfies ${flag}`).not.toContain(flag);
    const stripped = floorViolations(stripSql(text), "tok");
    for (const flag of [...single, "floor", "chain-clipped", "gate-term"]) expect(stripped).toContain(flag);
  });

  it("fires on each mutant's text", () => {
    expect(floorViolations(stripSql(MUTANTS.companyUnclipped()), "tok")).toEqual(expect.arrayContaining(["chain-clipped", "gate-term"]));
    expect(floorViolations(stripSql(MUTANTS.companyLapReadmitted()), "tok")).toContain("lap-floored");
    expect(floorViolations(stripSql(MUTANTS.companyNoReadLedger()), "tok")).toContain("floor");
    expect(floorViolations(stripSql(MUTANTS.categoryArmsReverted()), "pool")).toEqual(expect.arrayContaining(["arms", "bucket-only-arm"]));
    expect(floorViolations(stripSql(MUTANTS.categoryControlUnfloored()), "pool")).toContain("control-floored");
    expect(floorViolations(stripSql(MUTANTS.writerControlUnfloored()), "pool")).toContain("control-floored");
  });
});
