/**
 * THE THIRD DAY-30 CHAIN ON ONE PAGE GETS THE SAME CONTROL.
 *
 * 20260925163517 and 20260925163842 gave the per-employer and per-field day-30
 * gates a positive control. refresh_layoff_partition (20260918100700) is the
 * THIRD chain in this codebase that publishes S(30), and it was left with the
 * four terms all three started from: a floor on the risk set, a ceiling on the
 * interval half-width, the R + X + S identity, and an admitted observability
 * bucket. Every one of those passes VACUOUSLY on a cohort that produced no
 * events -- no events means no Greenwood variance, so the half-width is exactly
 * zero, and S is exactly one so the identity is 0 + 0 + 1.
 *
 * WHY IT COULD NOT BE LEFT FOR ITS OWN PASS. Both arms of this function are
 * rendered by LayoffPartitionSection on the same public index page as the field
 * table the other two migrations fixed. After that change the page would have
 * printed a field table computed over boards whose own cohorts produced events,
 * beside a layoff sentence computed over boards that had not: two day-30 shares
 * on one page, drawn from different populations, read side by side by the same
 * reader. That is the error feedback_measure_like_with_like exists to stop, and
 * it is worse here than a wrong number would be, because the whole point of the
 * section is the COMPARISON of its two arms. Measured live at 2026-09-25T21:47Z
 * the control arm published still_open_30 = 0.5466 over 387,957 observations on
 * 30,867 boards with sufficient_30 true, while a full catalogue walk the same
 * evening put 10.59% of the day-30 risk mass on boards whose cohort produced
 * ZERO events and a further 5.00% on boards with one to four.
 *
 * WHAT THIS FILE GUARDS.
 *
 *   1. THE DEFECT, REPRODUCED. Lane A alone, over one fixture, publishes a
 *      control arm whose risk set is dominated by a board that never showed us
 *      a takedown -- and calls it sufficient.
 *
 *   2. THE CONTROL, APPLIED. The same fixture under the re-issued function
 *      drops that board's mass, publishes the counts the gate is built from,
 *      and moves the share by more than the gap between the two arms.
 *
 *   3. THE STORED ROW IS REFUSED UNTIL THE REFRESH RE-RUNS. The partition is a
 *      TABLE, not a live computation: the instant the migration applies, the row
 *      already in it was written by the four-term gate and still carries
 *      sufficient_30 = true. Its events_30 is NULL because the column did not
 *      exist, and that NULL is the only honest tell. The reader must refuse it.
 *
 *   4. A GATE THAT EMPTIES AN ARM IS NOT AN ARM WITH TOO FEW ROLES. Those are
 *      different sentences and the writer names which one it is -- the same
 *      lesson the field table's `unread` / `ungated` split carries, and a defect
 *      an earlier draft of these two migrations actually shipped.
 *
 *   5. THE CONTROL IS COUNTED PER (BOARD, ARM). A board contributes to BOTH
 *      arms -- an arm is decided per POSTING, by whether a qualifying filing
 *      preceded that posting's own date -- so a count taken per board alone
 *      would admit a board into one arm on the events it produced in the other.
 *
 * TEETH. Every behavioural assertion runs twice over ONE fixture in pglite:
 * once against lane A alone, which must return the defect, and once against the
 * re-issued definitions, which must not. A guard whose "before" is not observed
 * is a guard nobody has tested. The code assertions carry their own mutation
 * block at the foot and run against COMMENT-STRIPPED SQL, because this repo has
 * shipped a guard satisfied by its own header comment seven times.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
/** Lane A: the eleven 20260918-1xxxxx files that build the layoff chain. */
const LANE_A = FILES.filter((f) => /^202609181\d{5}_/.test(f));
const NEW_WRITER = "20260925164237_the_third_day_thirty_chain_on_one_page_gets_the_same_control.sql";
const NEW_READER = "20260925164510_an_arm_written_before_the_control_existed_is_not_a_sufficient_arm.sql";
const mig = (f: string) => readFileSync(resolve(DIR, f), "utf8");
/** Executable text only: `--` to end of line, and block comments. */
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/--[^\n]*/g, "");

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* ───────────────────────── the fixture, worked by hand ────────────────────
   No layoff filing is seeded, so every posting falls in the CONTROL arm and the
   filed arm is legitimately empty -- which is the shape that matters here,
   because the control arm is the one that carried 387,957 observations live.

   GIANTL  full_read  20,000 age-outs at day 30 and 20,000 still-live roles, and
                      not one closure. n30 = 40,000, every observation censored.
   HEALTHYL full_read 300 fills and 100 relists spread over four days, 600
                      age-outs at day 30, 4,000 still-live roles. 400 events.

   Every cohort member is dated 33 days ago, which is inside the day-30 cohort
   on any day from 2026-09-09 onward. Batches are sized so the feed-dark proxy
   cannot fire: it censors a batch removing more than max(5, 0.30 x the board
   size at the time), and every closure carries a batch_live_before well above
   that, so the events below are real events and not censored ones. */
const BOARD_STAND_INS = `
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
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read','lap_proven','lap_pending','unprovable','unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
`;

const ageouts = (t: string, n: number) => `
  INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
  SELECT '${t}:a:'||g, 'greenhouse', '${t}', 'other', 'aged_out',
         now() - interval '33 days' + interval '30 days', now() - interval '33 days'
  FROM generate_series(1, ${n}) g;`;
const closures = (t: string, n: number, day: number, relist: boolean, before: number) => `
  INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis, batch_live_before)
  SELECT '${t}:${relist ? "x" : "f"}${day}:'||g, 'greenhouse', '${t}', 'other',
         now() - interval '33 days', now() - interval '33 days' + interval '${day} days', ${relist}, 'full_read', ${before}
  FROM generate_series(1, ${n}) g;`;
const liveRoles = (t: string, n: number) => `
  INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
  SELECT '${t}:live:'||g, 'greenhouse', '${t}', 'other', now() - interval '33 days',
         now() - interval '3 days', now() - interval '33 days', now()
  FROM generate_series(1, ${n}) g;`;

async function boot(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOARD_STAND_INS);
  for (const f of LANE_A) await db.exec(mig(f));
  await db.exec([
    ageouts("GIANTL", 20000), liveRoles("GIANTL", 20000),
    closures("HEALTHYL", 100, 10, false, 4000), closures("HEALTHYL", 100, 11, false, 4000),
    closures("HEALTHYL", 100, 12, false, 4000), closures("HEALTHYL", 100, 5, true, 4000),
    ageouts("HEALTHYL", 600), liveRoles("HEALTHYL", 4000),
    `INSERT INTO public.job_board_company_snapshots VALUES ('GIANTL', current_date - 40, 20000), ('HEALTHYL', current_date - 40, 4000);`,
    `INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('GIANTL','full_read'), ('HEALTHYL','full_read');`,
  ].join("\n"));
  return db;
}

const arms = async (db: PGlite): Promise<Map<string, Row>> =>
  new Map((await db.query<Row>(`SELECT * FROM public.get_layoff_partition()`)).rows.map((r) => [String(r.lp_arm), r]));

let before: Map<string, Row>;
let migrated: Map<string, Row>;
let after: Map<string, Row>;
const dbs: PGlite[] = [];

beforeAll(async () => {
  const db = await boot();
  dbs.push(db);
  await db.query(`SELECT * FROM public.refresh_layoff_partition()`);
  before = await arms(db);
  // The migrations land on the SAME database, with the same rows and the same
  // stored partition, so every difference below is a difference in definition.
  await db.exec(mig(NEW_WRITER));
  await db.exec(mig(NEW_READER));
  migrated = await arms(db);
  await db.query(`SELECT * FROM public.refresh_layoff_partition()`);
  after = await arms(db);
}, 240_000);

afterAll(async () => {
  for (const db of dbs) { try { await db.close(); } catch { /* best effort */ } }
});

describe("the third day-30 chain carries the same positive control as the other two", () => {
  it("found the migrations it executes, and the lane it executes them over (guards the guard)", () => {
    expect(LANE_A.length, "lane A's eleven files").toBeGreaterThanOrEqual(11);
    expect(FILES, "the writer re-issue").toContain(NEW_WRITER);
    expect(FILES, "the reader re-issue").toContain(NEW_READER);
    // The re-issues must sort after the files they supersede, or a database
    // rebuilt in filename order would run the old bodies last.
    expect(NEW_WRITER > LANE_A[LANE_A.length - 1]).toBe(true);
    expect(NEW_READER > NEW_WRITER).toBe(true);
  });

  it("reproduced the defect before the change: an arm dominated by a board that never showed us a takedown, called sufficient", () => {
    // If this ever stops failing, every assertion below is about a property
    // nothing was ever wrong about and the fixture has drifted.
    const c = before.get("control")!;
    expect(c.lp_sufficient_30, "the pre-fix gate admitted it").toBe(true);
    expect(c.lp_reason).toBeNull();
    expect(num(c.lp_n_at_risk_30), "GIANTL's 40,000 censored observations are in the risk set").toBe(44600);
    expect(num(c.lp_still_open_30)).toBeCloseTo(0.9911, 4);
    expect(num(c.lp_gate_share_30), "the bucket gate admitted everything").toBeCloseTo(1, 4);
    // ...and the arm it is meant to be compared against is empty, which is the
    // shape that makes an uncontrolled control arm the whole finding.
    expect(before.get("filed")!.lp_sufficient_30).toBe(false);
  });

  it("refuses the row the old gate wrote, from the instant the migration applies and until the refresh re-runs", () => {
    /* THE PARTITION IS A STORED TABLE. Nothing recomputes on read, so the row
       already in it keeps sufficient_30 = true under the new reader — for as
       long as the gap between the migration and the next scheduled refresh,
       which a staged migration runner makes unpredictable. events_30 is NULL on
       that row because the column did not exist when it was written, and the
       writer COALESCES the count to zero on every row it writes, so that NULL
       means one thing only. */
    for (const arm of ["filed", "control"] as const) {
      const r = migrated.get(arm)!;
      expect(r.lp_events_30, `${arm}: the old gate published no count`).toBeNull();
      expect(r.lp_sufficient_30, `${arm} must not be sufficient on an uncontrolled row`).toBe(false);
      expect(r.lp_reason, `${arm} must say WHY, in the word the field table uses`).toBe("uncontrolled");
    }
    // The stored figures are still there -- this is a gate change, not a wipe --
    // which is exactly why the boolean has to refuse them.
    expect(num(migrated.get("control")!.lp_still_open_30)).toBeCloseTo(0.9911, 4);
  });

  it("drops the eventless board from both arms once the refresh runs, and publishes the counts the gate is built from", () => {
    const c = after.get("control")!;
    expect(num(c.lp_events_30), "HEALTHYL's 300 fills and 100 relists").toBe(400);
    expect(num(c.lp_fills_30)).toBe(300);
    expect(num(c.lp_relists_30)).toBe(100);
    expect(num(c.lp_n_at_risk_30), "GIANTL's 40,000 are gone").toBe(4600);
    expect(num(c.lp_still_open_30)).toBeCloseTo(0.92, 4);
    expect(c.lp_sufficient_30).toBe(true);
    expect(c.lp_reason).toBeNull();
    // THE SIZE OF WHAT WAS WRONG. The share moves by more than seven points,
    // and the row says what share of its own dated cohort it was computed on.
    const moved = Math.abs(num(before.get("control")!.lp_still_open_30)! - num(c.lp_still_open_30)!);
    expect(moved).toBeGreaterThan(0.07);
    expect(num(c.lp_gate_share_30), "and the reader is told how much was cut").toBeCloseTo(0.1111, 4);
    expect(num(c.lp_gate_share_30)! < num(before.get("control")!.lp_gate_share_30)!).toBe(true);
  });

  it("publishes every bar of the gate on the row, so the copy cannot print a threshold the server did not use", () => {
    const c = after.get("control")!;
    expect(num(c.lp_min_events)).toBe(5);
    expect(num(c.lp_min_fills)).toBe(5);
    expect(num(c.lp_max_rel_half_width)).toBeCloseTo(0.5, 6);
    expect(num(c.lp_min_n)).toBe(25);
    expect(num(c.lp_max_half_width)).toBeCloseTo(0.15, 6);
  });

  it("says a gate emptied an arm rather than that the arm had too few roles", async () => {
    /* THE TWO ABSENCES ARE DIFFERENT SENTENCES. An arm with no estimator row
       either never had a dated role reach the cap, or had them and the two
       admission tests removed all of them. Reporting the first for both would
       tell a reader the arm was too small when a gate had emptied it -- the same
       defect the field table's `unread` / `ungated` split exists to stop, and one
       an earlier draft of these migrations shipped. Proven on a database whose
       ONLY board is the eventless one. */
    const db = new PGlite();
    dbs.push(db);
    await db.exec(BOARD_STAND_INS);
    for (const f of [...LANE_A, NEW_WRITER, NEW_READER]) await db.exec(mig(f));
    await db.exec([
      ageouts("GIANTL", 400), liveRoles("GIANTL", 400),
      `INSERT INTO public.job_board_company_snapshots VALUES ('GIANTL', current_date - 40, 400);`,
      `INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('GIANTL','full_read');`,
    ].join("\n"));
    await db.query(`SELECT * FROM public.refresh_layoff_partition()`);
    const only = await arms(db);
    const c = only.get("control")!;
    expect(num(c.lp_events_30), "a written row always carries a number").toBe(0);
    expect(c.lp_sufficient_30).toBe(false);
    expect(c.lp_reason, "dated roles reached the cap and the gate removed all of them").toBe("ungated");
    expect(num(c.lp_gate_share_30)).toBe(0);
    // ...and an arm that genuinely never had a dated role reach the cap says
    // the other thing.
    expect(only.get("filed")!.lp_reason).toBe("n");
    expect(only.get("filed")!.lp_gate_share_30).toBeNull();
  });
});

/* ───────────────────────────── the code, pinned ───────────────────────────
   Executed behaviour proves the gate works on the rows it was handed; these pin
   the SHAPE, so a later re-issue cannot quietly rebuild the tautology. All
   against comment-stripped code. */
const WRITER_CODE = stripSql(mig(NEW_WRITER));
const READER_CODE = stripSql(mig(NEW_READER));

export function writerViolations(code: string): string[] {
  const v: string[] = [];
  // Every bar is a named constant in the k CTE.
  if (!/5\s+AS min_events_30/.test(code)) v.push("events-constant");
  if (!/5\s+AS min_fills_30/.test(code)) v.push("fills-constant");
  if (!/0\.50::numeric\s+AS max_rel_half_width_30/.test(code)) v.push("relative-constant");
  // The control is counted per BOARD AND ARM, over the cohort's own events, and
  // never over our own sweep's takedowns at the cap.
  if (!/sum\(r\.is_fill \+ r\.is_relist\)::int AS events30/.test(code)) v.push("board-grain-count");
  // Anchored to board30's own aggregation, not to the phrase anywhere in the
  // file: the migration's self-check names the same clause in a LIKE, and a
  // checker that matched either one would pass over a changed GROUP BY.
  if (!/AS events30\s*\n\s*FROM raw r\s*\n[^\n]*\n\s*GROUP BY r\.tok, r\.cat/.test(code)) v.push("control-grain");
  if (!/LEFT JOIN board30 b ON b\.tok = r\.tok AND b\.cat = r\.cat/.test(code)) v.push("control-join");
  if (/d_ageout[^\n]*AS events30|events30[^\n]*d_ageout/.test(code)) v.push("ageouts-counted");
  // The risk set is cut by equality on BOTH tests at once, and every day-30
  // consumer reads the gated set so all of them describe one admission.
  if (!/\(r\.admitted AND COALESCE\(b\.events30, 0\) >= \(SELECT kk\.min_events_30 FROM k kk\)\) AS admitted/.test(code))
    v.push("equality-gate");
  if ((code.match(/FROM gated r/g)?.length ?? 0) < 3) v.push("consumers-read-the-gated-set");
  // The gate's own terms.
  if (!/COALESCE\(e30\.events30, 0\) >= \(SELECT kk\.min_events_30 FROM k kk\)/.test(code)) v.push("events-term");
  if (!/COALESCE\(e30\.fills30, 0\) >= \(SELECT kk\.min_fills_30 FROM k kk\)/.test(code)) v.push("fills-term");
  if (!/COALESCE\(e30\.relists30, 0\) <= COALESCE\(e30\.fills30, 0\)/.test(code)) v.push("relist-balance");
  if (!/AND \(e30\.s30_hi - e30\.s30_lo\) \/ 2 <= \(SELECT kk\.max_rel_half_width_30 FROM k kk\) \* \(1 - e30\.s30\)/.test(code))
    v.push("relative-term");
  // A written row always carries a number, so NULL means one thing only.
  if (!/COALESCE\(e30\.events30, 0\)\s+AS events_30/.test(code)) v.push("count-coalesced");
  // The reasons, including the one that separates an emptied arm from a small one.
  for (const [arm, flag] of [["'ungated'", "reason-ungated"], ["'events'", "reason-events"],
    ["'fills'", "reason-fills"], ["'relists'", "reason-relists"], ["'precision'", "reason-precision"]] as const) {
    if (!code.includes(`THEN ${arm}`)) v.push(flag);
  }
  // ...and the table has to accept them, or the INSERT fails and the refresh
  // reports an error instead of an insufficiency.
  for (const r of ["ungated", "events", "fills", "relists", "precision"]) {
    if (!new RegExp(`insufficient_reason IN[\\s\\S]{0,200}'${r}'`).test(code)) v.push(`check-${r}`);
  }
  return v;
}

export function readerViolations(code: string): string[] {
  const v: string[] = [];
  for (const c of ["lp_events_30", "lp_fills_30", "lp_relists_30", "lp_min_events", "lp_min_fills", "lp_max_rel_half_width"]) {
    if (!new RegExp(`${c}\\s+(?:int|numeric)`).test(code)) v.push(`column-${c}`);
  }
  // The shape changes, so the function is dropped from the catalogue first:
  // CREATE OR REPLACE cannot change a RETURNS TABLE.
  if (!/proname = 'get_layoff_partition'[\s\S]{0,400}DROP FUNCTION/.test(code)) v.push("no-catalogue-drop");
  // A row written before the control existed is not a sufficient row.
  if (!/r\.events_30 IS NOT NULL\s*\n?\s*AND COALESCE\(r\.sufficient_30, false\)/.test(code)) v.push("stale-row-admitted");
  if (!/WHEN r\.events_30 IS NULL THEN 'uncontrolled'/.test(code)) v.push("no-uncontrolled-reason");
  // The reachable set is stated, not inherited.
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.get_layoff_partition\\(\\) FROM ${role};`).test(code))
      v.push(`revoke-${role}`);
  }
  return v;
}

describe("the control is spelled where the database can run it", () => {
  it("the writer carries every property, against comment-stripped code", () => {
    expect(writerViolations(WRITER_CODE)).toEqual([]);
  });

  it("the reader publishes the control and refuses the row that predates it", () => {
    expect(readerViolations(READER_CODE)).toEqual([]);
  });

  it("re-issues rather than edits, and refuses to report success without the new terms", () => {
    expect(WRITER_CODE).toMatch(/CREATE OR REPLACE FUNCTION public\.refresh_layoff_partition\(\)/);
    expect(WRITER_CODE).toMatch(/body NOT LIKE '%min_events_30%'[\s\S]{0,200}RAISE EXCEPTION/);
    expect(READER_CODE).toMatch(/cols NOT LIKE '%lp_events_30%'[\s\S]{0,200}RAISE EXCEPTION/);
    // Migrations are immutable: the files these supersede are untouched.
    for (const f of LANE_A) expect(mig(f), `${f} was edited`).not.toMatch(/min_events_30/);
  });

  it("the COMMENT ON says the gate is duplicated and not inherited, and names what each added term is for", () => {
    // Adjacent SQL literals joined first: the contract is the TEXT the database
    // stores, and a guard that reads the line wrapping fails on a reflow while
    // the sentence is intact.
    const join = (raw: string) => raw.slice(raw.indexOf("COMMENT ON FUNCTION")).replace(/'\s*\n\s*'/g, "");
    const w = join(mig(NEW_WRITER));
    expect(w).toMatch(/POSITIVE CONTROL/);
    expect(w, "the claim the previous comment got wrong").toMatch(/NOT INHERITED, IT IS DUPLICATED/);
    expect(w).toMatch(/per \(board, arm\)/);
    expect(w).toMatch(/COALESCED TO ZERO/);
    expect(join(mig(NEW_READER))).toMatch(/AN ARM WRITTEN BEFORE THE CONTROL EXISTED IS NOT SUFFICIENT/);
  });
});

/* ───────────────────────────────── teeth ─────────────────────────────────
   The behavioural half has teeth by construction: the "before" above is lane A
   executed over the same rows, and it returns the defect. These are the teeth
   of the CODE checkers -- each fixture is the shipped file with one clause
   spelled the way it could plausibly be got wrong. */
describe("the code checkers can actually fail", () => {
  it("fire on the definitions these files supersede", () => {
    const oldWriter = stripSql(mig(LANE_A.find((f) => f.includes("two_arms_side_by_side"))!));
    expect(writerViolations(oldWriter)).toEqual(expect.arrayContaining([
      "events-constant", "fills-constant", "relative-constant", "board-grain-count",
      "equality-gate", "events-term", "fills-term", "relative-term", "reason-ungated",
    ]));
    const oldReader = stripSql(mig(LANE_A.find((f) => f.includes("renders_its_reason"))!));
    expect(readerViolations(oldReader)).toEqual(expect.arrayContaining([
      "column-lp_events_30", "column-lp_min_events", "stale-row-admitted", "no-uncontrolled-reason",
    ]));
  });

  it("are not satisfied by the right spellings appearing only in a COMMENT", () => {
    /* THE TRAP THIS REPO HAS FALLEN INTO SEVEN TIMES: a guard counting literals
       across a whole file is satisfied by a header comment that documents the
       very clause it is checking for. The fixture is the superseded body with
       the whole new body appended as comment lines, which is the worst case --
       every spelling present, none of it executable.

       Against RAW the single-line properties are all satisfied by the comment,
       which is the defect. (The multi-line ones are not, because a `-- ` prefix
       on the second line breaks the anchor; that is luck, not a design, and it
       is why the checkers are only ever run against the stripped view.) Against
       the STRIPPED view every property fires. */
    const commented = mig(NEW_WRITER).split("\n").map((l) => `-- ${l}`).join("\n");
    const fixture = mig(LANE_A.find((f) => f.includes("two_arms_side_by_side"))!) + "\n" + commented;
    const SINGLE_LINE = ["events-constant", "fills-constant", "relative-constant", "control-join",
      "equality-gate", "events-term", "fills-term", "relist-balance", "relative-term",
      "count-coalesced", "reason-ungated", "reason-events", "reason-fills", "reason-relists",
      "reason-precision"] as const;
    const raw = writerViolations(fixture);
    for (const flag of SINGLE_LINE) {
      expect(raw, `against RAW the comment satisfies ${flag}`).not.toContain(flag);
    }
    const stripped = writerViolations(stripSql(fixture));
    for (const flag of SINGLE_LINE) {
      expect(stripped, `against the stripped view ${flag} must fire`).toContain(flag);
    }
    // ...and the checker must be strictly harder to satisfy after stripping, or
    // the strip is decorative.
    expect(stripped.length).toBeGreaterThan(raw.length);
  });

  it("fire when the control is counted per board instead of per board and arm", () => {
    // The exact shape a board contributing to both arms would break: one join
    // key. A board's `filed` mass would then be admitted on its `control`
    // events, and the arms would stop being separate populations.
    const joined = WRITER_CODE.replace(
      "LEFT JOIN board30 b ON b.tok = r.tok AND b.cat = r.cat",
      "LEFT JOIN board30 b ON b.tok = r.tok",
    );
    expect(joined).not.toBe(WRITER_CODE);
    expect(writerViolations(joined)).toContain("control-join");
    // board30's own GROUP BY, and the migration's self-check which names the
    // same clause in a LIKE. The emp CTE groups the other way round (cat then
    // tok), so this anchor is those two alone and the first is board30's.
    expect(WRITER_CODE.match(/GROUP BY r\.tok, r\.cat/g)?.length, "board30's grouping and the file's own check on it").toBe(2);
    const grouped = WRITER_CODE.replace("GROUP BY r.tok, r.cat", "GROUP BY r.tok");
    expect(grouped).not.toBe(WRITER_CODE);
    expect(writerViolations(grouped)).toContain("control-grain");
  });

  it("fire when a term is dropped from the gate but its constant is left in place", () => {
    for (const [pattern, flag] of [
      [/\s+AND COALESCE\(e30\.events30, 0\) >= \(SELECT kk\.min_events_30 FROM k kk\)/, "events-term"],
      [/\s+AND COALESCE\(e30\.fills30, 0\) >= \(SELECT kk\.min_fills_30 FROM k kk\)/, "fills-term"],
      [/\s+AND COALESCE\(e30\.relists30, 0\) <= COALESCE\(e30\.fills30, 0\)/, "relist-balance"],
      [/\s+AND \(e30\.s30_hi - e30\.s30_lo\) \/ 2 <= \(SELECT kk\.max_rel_half_width_30 FROM k kk\) \* \(1 - e30\.s30\)/, "relative-term"],
    ] as const) {
      const code = WRITER_CODE.replace(pattern, "");
      expect(code, flag).not.toBe(WRITER_CODE);
      expect(writerViolations(code)).toContain(flag);
    }
  });

  it("fire when a written row's count is left NULL, which would make the reader report the wrong absence", () => {
    const code = WRITER_CODE.replace("COALESCE(e30.events30, 0)  AS events_30", "e30.events30              AS events_30");
    expect(code).not.toBe(WRITER_CODE);
    expect(writerViolations(code)).toContain("count-coalesced");
  });

  it("fire when the reader stops refusing the row the old gate wrote", () => {
    const code = READER_CODE.replace(/\s+AND r\.events_30 IS NOT NULL/, "");
    expect(code).not.toBe(READER_CODE);
    expect(readerViolations(code)).toContain("stale-row-admitted");
    const noReason = READER_CODE.replace("WHEN r.events_30 IS NULL THEN 'uncontrolled'", "");
    expect(noReason).not.toBe(READER_CODE);
    expect(readerViolations(noReason)).toContain("no-uncontrolled-reason");
  });
});
