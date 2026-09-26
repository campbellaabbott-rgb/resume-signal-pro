/**
 * A SUFFICIENCY TEST WITH NO POSITIVE CONTROL PASSES ON A BOARD THAT SHOWED US
 * NOTHING.
 *
 * 20260909217000 / 20260909217500 published S(30) -- the share of a dated
 * cohort still advertised when it reached our 30-day cap -- behind four terms:
 * a floor on the risk set, a ceiling on the interval half-width, the
 * R + X + S identity, and an admitted observability bucket. All four pass
 * VACUOUSLY on a cohort that produced no events: no events means no Greenwood
 * variance, so the half-width is exactly zero; S is exactly one, so the
 * identity is 0 + 0 + 1; and the risk-set floor is cleared most easily by
 * exactly the boards that never lose an observation. Reproduced live on
 * 2026-09-25 by walking all 44,379 catalogue tokens with the anon key: 71
 * boards holding 30,182 live postings published still_open_30 = 1.0000 with a
 * zero-width interval and sufficient_30 true, 67 of them in the full_read
 * bucket -- so the observability bucket was not the leak.
 *
 * WHAT THIS FILE GUARDS, AND WHY EACH PROPERTY IS HERE.
 *
 *   1. THE GATE REFUSES A COHORT THAT PRODUCED NO EVENTS. Both grains. The
 *      exactly-degenerate board (no events of any kind) and the near-
 *      degenerate one (plenty of events in the 90-day window, none inside the
 *      day-30 cohort) must both be refused, because both were measured live
 *      and the second is what a board we are failing to READ looks like from
 *      here.
 *
 *   2. THE COUNT COMES FROM THE COHORT THE FIGURE REPORTS ON. Not from
 *      fills_90d: that is a WINDOW OF EVENTS over a different population, and
 *      42 of the 71 live offenders have events in it and none in the cohort.
 *      Not from the age-out arm either: an age-out is OUR sweep at the cap,
 *      and admitting those would clear any floor 20,000 times over on the
 *      board that opened this defect.
 *
 *   3. THE FIELD CURVE CUTS ITS RISK SET BY EQUALITY. A board whose cohort
 *      produced nothing cannot be handed a NULL when it is pooled: its
 *      observations sit in the risk set on every day and contribute no event
 *      on any of them, so they hold the field's S(30) up in proportion to the
 *      board's size. The fixture below makes that exact: one field holds a
 *      20,000-observation eventless board beside one healthy board, and the
 *      pre-fix definition publishes 0.9985 with sufficient_30 TRUE where the
 *      only board we can actually see says 0.6250.
 *
 *   4. THE SHARE THAT DISCLOSES THE CUT MEASURES THE SAME CUT. gate_share_30
 *      must be computed over the gated risk set, or the page prints a coverage
 *      figure for an admission the number beside it was not computed under.
 *
 * TEETH. Every behavioural assertion is executed twice over ONE fixture in
 * pglite: once against the definitions the database runs today, which must
 * return the defect, and once against the re-issued ones, which must not. A
 * guard whose "before" is not observed is a guard nobody has tested. The code
 * assertions carry their own mutation block at the foot, and all of them run
 * against COMMENT-STRIPPED SQL: this repo has shipped a guard satisfied by its
 * own header comment seven times.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const mig = (f: string) => readFileSync(resolve(DIR, f), "utf8");

const OLD_COMPANY = "20260909217000_a_role_still_up_at_day_thirty_is_a_share_not_a_verdict.sql";
const OLD_CATEGORY = "20260909217500_a_field_is_only_as_open_as_the_boards_we_can_read.sql";
const NEW_COMPANY = "20260925163517_a_gate_made_of_width_alone_admits_a_board_that_showed_us_nothing.sql";
const NEW_CATEGORY = "20260925163842_a_field_pooled_over_boards_that_never_showed_us_an_event_is_not_a_field.sql";

/** Executable text only: `--` to end of line, and block comments. */
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/--[^\n]*/g, "");

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* ───────────────────────── the fixture, worked by hand ────────────────────
   Every cohort member is dated 33 days ago, which is inside the day-30 cohort
   [GREATEST(the day after the event window opened, 2026-08-07), today - 30]
   on any day from 2026-09-09 onward, and stays inside it after the floor
   retires itself. Events land at day 5, 6, 10 or 30, all inside the 90-day
   event window.

   A  giant-eventless    lap_proven  engineering  20,000 age-outs at day 30,
                                                  nothing else. n30 = 20,000,
                                                  S(30) = 1, interval [1,1].
   B  outside-the-cohort full_read   other        200 age-outs at day 30 inside
                                                  the cohort; 60 fills and 20
                                                  relists on postings dated TEN
                                                  days ago, which are in the
                                                  90-day counts and NOT in the
                                                  day-30 cohort.
   C  healthy            full_read   engineering  80 dated: 10 relists day 5,
                                                  20 fills day 10, 40 age-outs
                                                  day 30, 10 still live.
                                                  S(30) = 0.625, R = 0.25,
                                                  X = 0.125, n30 = 50,
                                                  half-width 0.1058.
   E  exactly-five       full_read   science      100 dated: 5 fills day 10,
                                                  95 age-outs day 30.
                                                  S = 0.95, n30 = 95, hw 0.047.
   F  exactly-four       full_read   science      100 dated: 4 fills day 10,
                                                  96 age-outs day 30.
                                                  S = 0.96, n30 = 96, hw 0.044.
   G  not-admitted       lap_pending design       C's shape on a bucket that
                                                  cannot prove an absence.
   D  five-in-twenty-k   full_read   customer     20,000 age-outs at day 30 and
                                                  exactly 5 fills at day 10.
                                                  S = 0.9998, half-width
                                                  0.00025 -- absolutely narrow,
                                                  and 1.25 times the complement
                                                  it is about.
   H  events-elsewhere   full_read   marketing    20,000 eventless age-outs in
                         full_read   product      MARKETING, and 5 fills in
                                                  PRODUCT. Nothing about
                                                  marketing was ever observed.
   R  relists-only       full_read   legal        5 relists at day 5, 100
                                                  age-outs at day 30. Five
                                                  events, zero fills, and
                                                  taken_down_30 = 0.0000.
   U  part-uncategorised full_read   education    3 categorised fills at day 10,
                                                  2 closures the collector left
                                                  uncategorised, 100 age-outs.
                                                  Five cohort events at company
                                                  grain, three at field grain.

   Snapshots are sized so the feed-dark proxy never fires: a batch is censored
   when it removes more than max(5, 0.30 x the board size at the time), and
   every batch below is well inside that. */
const TOKENS = ["A", "B", "C", "D", "E", "F", "G", "H", "R", "U"] as const;

async function boot(lane: string[]): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.job_board_postings (
      id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
      posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz, missing_since timestamptz
    );
    CREATE TABLE public.job_board_closures (
      posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
      first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
      superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer,
      absence_basis text
    );
    CREATE TABLE public.job_board_exits (
      event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
      company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
      days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
    );
    CREATE TABLE public.job_board_company_snapshots (
      company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date)
    );
  `);

  /** age-outs: our own sweep at the cap, never an employer event. */
  const ageouts = (tok: string, cat: string, n: number) => `
    INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
    SELECT '${tok}:age:'||g, 'greenhouse', '${tok}', '${cat}', 'aged_out',
           now() - interval '33 days' + interval '30 days', now() - interval '33 days'
    FROM generate_series(1, ${n}) g;`;
  /** closures inside the day-30 cohort, at day `day`. */
  const closures = (tok: string, cat: string, n: number, day: number, relist: boolean) => `
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
    SELECT '${tok}:${relist ? "x" : "f"}${day}:'||g, 'greenhouse', '${tok}', '${cat}',
           now() - interval '33 days', now() - interval '33 days' + interval '${day} days', ${relist}, 'full_read'
    FROM generate_series(1, ${n}) g;`;
  /** closures on postings too young to be in the day-30 cohort: 90-day counts only. */
  const youngClosures = (tok: string, cat: string, n: number, day: number, relist: boolean) => `
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
    SELECT '${tok}:young${relist ? "x" : "f"}${day}:'||g, 'greenhouse', '${tok}', '${cat}',
           now() - interval '10 days', now() - interval '10 days' + interval '${day} days', ${relist}, 'full_read'
    FROM generate_series(1, ${n}) g;`;
  const live = (tok: string, cat: string, n: number) => `
    INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
    SELECT '${tok}:live:'||g, 'greenhouse', '${tok}', '${cat}', now() - interval '33 days',
           now() - interval '3 days', now() - interval '33 days', now()
    FROM generate_series(1, ${n}) g;`;
  /** Closures the collector never categorised. The field risk set requires a
   *  non-empty category on every arm, so these are in the company grain's count
   *  and in neither the field's pool nor the field's count -- which is the
   *  difference between the two grains, pinned below rather than assumed. */
  const uncategorised = (tok: string, n: number, day: number) => `
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
    SELECT '${tok}:uncat${day}:'||g, 'greenhouse', '${tok}', '',
           now() - interval '33 days', now() - interval '33 days' + interval '${day} days', false, 'full_read'
    FROM generate_series(1, ${n}) g;`;
  const snapshot = (tok: string, n: number) =>
    `INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES ('${tok}', current_date - 40, ${n});`;

  await db.exec([
    ageouts("A", "engineering", 20000), snapshot("A", 20000),
    ageouts("B", "other", 200), youngClosures("B", "other", 60, 5, false), youngClosures("B", "other", 20, 6, true), snapshot("B", 300),
    closures("C", "engineering", 10, 5, true), closures("C", "engineering", 20, 10, false),
    ageouts("C", "engineering", 40), live("C", "engineering", 10), snapshot("C", 80),
    closures("E", "science", 5, 10, false), ageouts("E", "science", 95), snapshot("E", 100),
    closures("F", "science", 4, 10, false), ageouts("F", "science", 96), snapshot("F", 100),
    closures("G", "design", 10, 5, true), closures("G", "design", 20, 10, false),
    ageouts("G", "design", 40), live("G", "design", 10), snapshot("G", 80),
    // THE SHAPE AN ABSOLUTE FLOOR OF FIVE LETS THROUGH. Its interval is 0.0002
    // wide in points and 1.25 times the complement it is a statement about.
    closures("D", "customer", 5, 10, false), ageouts("D", "customer", 20000), snapshot("D", 20000),
    // Events in one field, an eventless mass in another, one board.
    closures("H", "product", 5, 10, false), ageouts("H", "marketing", 20000),
    live("H", "product", 30), snapshot("H", 20000),
    // Five events, none of them a fill.
    closures("R", "legal", 5, 5, true), ageouts("R", "legal", 100), snapshot("R", 100),
    // Five cohort events at company grain; the collector categorised three.
    closures("U", "education", 3, 10, false), uncategorised("U", 2, 10),
    ageouts("U", "education", 100), snapshot("U", 100),
  ].join("\n"));

  for (const f of lane) await db.exec(mig(f));
  // The observability table is created by the curve migrations themselves (a
  // LANGUAGE sql body is validated at CREATE, so the table must already exist);
  // its writer lives in 20260909217800 and is not needed to state a bucket.
  await db.exec(`
    INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES
      ('A','lap_proven'), ('B','full_read'), ('C','full_read'),
      ('E','full_read'), ('F','full_read'), ('G','lap_pending'),
      ('D','full_read'), ('H','full_read'), ('R','full_read'), ('U','full_read');
  `);
  return db;
}

const company = async (db: PGlite) =>
  new Map(
    (await db.query<Row>(
      `SELECT * FROM public.get_company_fill_curve($1::text[]) ORDER BY company_token`,
      [`{${TOKENS.join(",")}}`],
    )).rows.map((r) => [String(r.company_token), r]),
  );

const category = async (db: PGlite) =>
  new Map(
    (await db.query<Row>(`SELECT * FROM public.get_category_fill_curve(90, 25) ORDER BY category`)).rows.map(
      (r) => [String(r.category), r],
    ),
  );

let before: { co: Map<string, Row>; cat: Map<string, Row> };
let after: { co: Map<string, Row>; cat: Map<string, Row> };
const dbs: PGlite[] = [];

beforeAll(async () => {
  const oldDb = await boot([OLD_COMPANY, OLD_CATEGORY]);
  dbs.push(oldDb);
  before = { co: await company(oldDb), cat: await category(oldDb) };
  // The same rows, then the re-issued definitions over them: one fixture, two
  // verdicts, so the difference cannot be a difference in the data.
  await oldDb.exec(mig(NEW_COMPANY));
  await oldDb.exec(mig(NEW_CATEGORY));
  after = { co: await company(oldDb), cat: await category(oldDb) };
}, 240_000);

afterAll(async () => {
  for (const db of dbs) { try { await db.close(); } catch { /* best effort */ } }
});

describe("the day-30 sufficiency gate refuses a cohort that never produced an event", () => {
  it("the fixture reproduced the defect before the change: an eventless board published a zero-width 100%", () => {
    // If this ever stops failing, the rest of the file is asserting a property
    // nothing was ever wrong about, and the fixture has drifted.
    const a = before.co.get("A")!;
    expect(num(a.still_open_30)).toBe(1);
    expect(num(a.still_open_30_lo)).toBe(1);
    expect(num(a.still_open_30_hi)).toBe(1);
    expect(num(a.taken_down_30)).toBe(0);
    expect(num(a.n_at_risk_30)).toBe(20000);
    expect(num(a.ageouts_at_30)).toBe(20000);
    expect(a.sufficient_30, "the pre-fix gate admitted a board with no events").toBe(true);
  });

  it("refuses the exactly-degenerate board and keeps every other figure it published", () => {
    const a = after.co.get("A")!;
    expect(a.sufficient_30).toBe(false);
    expect(num(a.events_30), "the cohort's own events, age-outs excluded").toBe(0);
    // The estimate itself is untouched: this is a gate change, so the figure
    // is still computed and still says what it said -- the renderer is what
    // reads sufficient_30.
    expect(num(a.still_open_30)).toBe(1);
    expect(num(a.n_at_risk_30)).toBe(20000);
    expect(num(a.ageouts_at_30)).toBe(20000);
    expect(a.observability_bucket).toBe("lap_proven");
  });

  it("refuses the near-degenerate board: events in the 90-day window are a different population", () => {
    // THE REFUTED FIX, EXECUTED. `fills_90d >= 5` would admit this board --
    // it has 60 fills and 20 relists -- while its day-30 cohort produced
    // nothing at all, which is exactly the substitution
    // feedback_measure_like_with_like forbids. Measured live: 42 of the 71
    // offenders have this shape, one of them with 171 fills and 25 relists.
    const b = after.co.get("B")!;
    expect(num(b.fills_90d), "the 90-day window is full").toBe(60);
    expect(num(b.relists_90d)).toBe(20);
    expect(num(b.fills_90d)! >= 5, "a 90-day floor would have admitted it").toBe(true);
    expect(num(b.events_30), "the day-30 cohort produced nothing").toBe(0);
    expect(num(b.still_open_30)).toBe(1);
    expect(before.co.get("B")!.sufficient_30, "the pre-fix gate admitted it").toBe(true);
    expect(b.sufficient_30).toBe(false);
  });

  it("admits the healthy board unchanged, figures and all", () => {
    const c = after.co.get("C")!;
    expect(c.sufficient_30).toBe(true);
    expect(num(c.events_30), "10 relists at day 5 and 20 fills at day 10").toBe(30);
    expect(num(c.still_open_30)).toBeCloseTo(0.625, 4);
    expect(num(c.taken_down_30)).toBeCloseTo(0.25, 4);
    expect(num(c.relist_rate_30)).toBeCloseTo(0.125, 4);
    expect(num(c.n_at_risk_30)).toBe(50);
    expect(num(c.sum_check_30)).toBeCloseTo(1, 6);
    // Every day-14 figure and every 90-day count is the pre-fix answer, row
    // for row: the change may not move a column it is not about.
    const was = before.co.get("C")!;
    for (const [k, v] of Object.entries(was)) expect(c[k], `${k} moved`).toEqual(v === undefined ? undefined : v);
  });

  it("draws the line at the cohort's own events: five clears the floor, four does not", () => {
    // THE FLOOR, ON ITS OWN. Both boards clear every OTHER term that was here
    // before -- risk set, absolute half-width, identity, bucket -- so only the
    // event count can separate them, and the pre-fix definition admitted both.
    // Neither PUBLISHES under the finished gate, because five events cannot
    // clear the relative-precision term at any cohort size (see the describe
    // below); what the floor decides is ADMISSION TO A FIELD'S POOL, which is
    // the load-bearing use of it and is asserted at field grain further down.
    const e = after.co.get("E")!, f = after.co.get("F")!;
    expect(num(e.events_30)).toBe(5);
    expect(num(e.fills_30)).toBe(5);
    expect(num(f.events_30)).toBe(4);
    expect(before.co.get("E")!.sufficient_30).toBe(true);
    expect(before.co.get("F")!.sufficient_30, "the pre-fix gate admitted four events too").toBe(true);
    // Both clear the terms that were already there, which is what makes the
    // separation a property of the new terms and not a side effect.
    for (const r of [e, f]) {
      expect(num(r.n_at_risk_30)! >= 25).toBe(true);
      expect((num(r.still_open_30_hi)! - num(r.still_open_30_lo)!) / 2).toBeLessThanOrEqual(0.15);
      expect(num(r.sum_check_30)).toBeCloseTo(1, 6);
      expect(r.sufficient_30).toBe(false);
    }
    // And the OTHER refuted fix, executed: `taken_down_30 > 0` is a tautology
    // that would have admitted the four-event board.
    expect(num(f.taken_down_30)! > 0).toBe(true);
  });

  it("refuses five events in twenty thousand: an absolutely narrow interval that pins nothing", () => {
    /* THE HOLE A FLAT FLOOR LEAVES, AS A ROW. Greenwood's variance on the
       complementary log-log scale is about 1/D, so the interval's precision is
       RELATIVE to the complement while the published half-width is ABSOLUTE and
       collapses toward zero as S approaches one, however few events produced it.
       Board D is that shape: it clears the risk-set floor by the widest margin
       in the fixture, clears the absolute half-width ceiling by three orders of
       magnitude, satisfies the identity, sits in an admitted bucket, and clears
       the five-event floor exactly -- and its interval is WIDER THAN THE
       COMPLEMENT IT IS ABOUT. Rendered, that row says a hundred per cent of
       twenty thousand roles stayed up, give or take nothing. */
    const d = after.co.get("D")!;
    expect(num(d.events_30), "exactly at the floor").toBe(5);
    expect(num(d.n_at_risk_30)).toBe(20000);
    const s30 = num(d.still_open_30)!, lo = num(d.still_open_30_lo)!, hi = num(d.still_open_30_hi)!;
    const hw = (hi - lo) / 2;
    expect(s30).toBeCloseTo(0.9998, 4);
    expect(hw, "absolutely narrow -- the term that cannot see this").toBeLessThan(0.001);
    expect(hw / (1 - s30), "and wider than the complement it is a statement about").toBeGreaterThan(1);
    expect(before.co.get("D")!.sufficient_30, "the pre-fix gate admitted it").toBe(true);
    expect(d.sufficient_30, "and so would a gate whose only new term was a flat floor").toBe(false);
    // The healthy board is on the other side of the same term, so the bar is a
    // discriminator and not a blanket refusal.
    const c = after.co.get("C")!;
    const cs = num(c.still_open_30)!, chw = (num(c.still_open_30_hi)! - num(c.still_open_30_lo)!) / 2;
    expect(chw / (1 - cs)).toBeLessThan(0.5);
    expect(c.sufficient_30).toBe(true);
  });

  it("refuses a cohort whose only events are relists, and never prints its taken-down share as a measurement", () => {
    /* S(30) falls on a fill and on a relist alike, so the events floor counts
       both. taken_down_30 and relist_rate_30 are NOT that quantity: they are a
       fill rate and a relist rate published from the same row under the same
       boolean. Board R produced five events and not one fill, so it clears the
       events floor and would have published taken_down_30 = 0.0000 as a measured
       figure about an employer nothing was ever seen to come down from. The
       day-14 gate beside this one refuses that shape twice over; this one now
       does too, and the counts are published separately so a reader can see
       which of them carried the gate. */
    const r = after.co.get("R")!;
    expect(num(r.events_30), "five events, and the floor is cleared").toBe(5);
    expect(num(r.fills_30)).toBe(0);
    expect(num(r.relists_30)).toBe(5);
    expect(num(r.taken_down_30), "the figure a flat events floor would have published").toBe(0);
    expect(before.co.get("R")!.sufficient_30, "the pre-fix gate admitted it").toBe(true);
    expect(r.sufficient_30).toBe(false);
  });

  it("counts a cohort's events over its own rows at company grain, uncategorised ones included", () => {
    // The two grains count over different populations by construction -- every
    // arm of the FIELD risk set requires a non-empty category and this one does
    // not -- so a board whose events are partly uncategorised counts them all
    // here and only the categorised ones there. The direction is conservative:
    // the field grain is the stricter of the two. Pinned at both ends so the
    // difference is a decision rather than a discovery.
    const u = after.co.get("U")!;
    expect(num(u.events_30), "three categorised fills and two the collector left blank").toBe(5);
    expect(num(u.fills_30)).toBe(5);
  });

  it("leaves the observability gate exactly where it was: an unadmitted bucket publishes nothing", () => {
    const g = after.co.get("G")!;
    expect(g.observability_bucket).toBe("lap_pending");
    for (const k of ["still_open_30", "taken_down_30", "n_at_risk_30", "sum_check_30", "events_30"]) {
      expect(g[k], `${k} must be NULL off an admitted bucket`).toBeNull();
    }
    expect(g.sufficient_30).toBe(false);
  });
});

describe("a field is pooled only over boards whose own cohort produced events", () => {
  it("reproduced the pooling defect before the change: one eventless board held a whole field at 99.9%", () => {
    // engineering holds the 20,000-observation eventless board beside the one
    // healthy board. Every hazard is divided by the eventless mass, so the
    // field publishes a figure near 1 with a confident interval -- and
    // sufficient_30 true -- while the only board in it we can see says 0.625.
    const eng = before.cat.get("engineering")!;
    expect(num(eng.still_open_30)).toBeCloseTo(0.9985, 4);
    expect(num(eng.n_at_risk_30)).toBe(20050);
    expect(eng.sufficient_30).toBe(true);
    expect(num(eng.gate_share_30), "the bucket gate admitted everything").toBeCloseTo(1, 4);
  });

  it("cuts the risk set by equality, so the field is the boards that showed us something", () => {
    const eng = after.cat.get("engineering")!;
    expect(num(eng.still_open_30), "the healthy board's own answer").toBeCloseTo(0.625, 4);
    expect(num(eng.taken_down_30)).toBeCloseTo(0.25, 4);
    expect(num(eng.n_at_risk_30)).toBe(50);
    expect(num(eng.events_30)).toBe(30);
    expect(num(eng.sum_check_30)).toBeCloseTo(1, 6);
    expect(eng.sufficient_30).toBe(true);
  });

  it("publishes what it cut in the same row, measured over the same admission", () => {
    // gate_share_30 exists so a field measured on its small boards says so.
    // If it were computed over the ungated set it would describe an admission
    // the figure beside it was not computed under -- 1.0000 next to a number
    // built on 0.4% of the cohort.
    const eng = after.cat.get("engineering")!;
    expect(num(eng.gate_share_30)).toBeCloseTo(80 / 20080, 4);
    const sci = after.cat.get("science")!;
    expect(num(sci.gate_share_30), "the four-event board left the pool").toBeCloseTo(0.5, 4);
    expect(num(sci.still_open_30), "the five-event board alone").toBeCloseTo(0.95, 4);
    expect(num(sci.n_at_risk_30)).toBe(95);
    expect(num(sci.events_30)).toBe(5);
  });

  it("publishes nothing for a field whose every board failed the control, and says the share was zero", () => {
    // NULL rather than 1.0 is the same rule the bucket gate already follows:
    // where absence is not observable the absence of a number is the answer.
    const other = after.cat.get("other")!;
    for (const k of ["still_open_30", "taken_down_30", "n_at_risk_30", "sum_check_30", "events_30"]) {
      expect(other[k], `${k} must be NULL when the gate admitted nothing`).toBeNull();
    }
    expect(other.sufficient_30).toBe(false);
    expect(num(other.gate_share_30)).toBe(0);
    expect(before.cat.get("other")!.sufficient_30, "the pre-fix field gate admitted it").toBe(true);
    expect(num(before.cat.get("other")!.still_open_30)).toBe(1);
  });

  it("admits a board into a field only on THAT field's own events", () => {
    /* THE CONTROL HAS TO BE COUNTED AT THE GRAIN THE FIGURE IS POOLED AT. Board
       H is one board with two fields: five fills in PRODUCT and twenty thousand
       eventless roles censored at the cap in MARKETING. A control counted per
       board and applied per board-and-field admits the whole board into every
       field it touches, so marketing inherits product's five fills and H's
       eventless mass sits in marketing's risk set on every day of the curve
       contributing no event to any of them -- which is the mechanism this file's
       own title names, one grain finer. Counted per (board, field) it does not:
       marketing publishes nothing, and says the share it admitted was zero. */
    const mk = after.cat.get("marketing")!;
    for (const k of ["still_open_30", "taken_down_30", "n_at_risk_30", "events_30", "fills_30"]) {
      expect(mk[k], `marketing.${k} must be NULL: nothing about marketing was observed`).toBeNull();
    }
    expect(mk.sufficient_30).toBe(false);
    expect(num(mk.gate_share_30), "and the row says the cut was total").toBe(0);
    // The field the events actually belong to keeps them.
    const pd = after.cat.get("product")!;
    expect(num(pd.events_30), "product's own five fills").toBe(5);
    expect(num(pd.fills_30)).toBe(5);
    expect(num(pd.gate_share_30)).toBeCloseTo(1, 4);
    // ...and before the change, marketing published the inherited figure.
    const wasMk = before.cat.get("marketing")!;
    expect(num(wasMk.still_open_30), "the pre-fix pool answered 1.0 on 20,000 censored roles").toBe(1);
    expect(wasMk.sufficient_30).toBe(true);
  });

  it("counts a field's control over the rows the field pool can contain, and nothing else", () => {
    /* Board U produced five cohort events, two of which the collector left
       uncategorised. The FIELD risk set requires a non-empty category on every
       arm, so the field can neither pool those two rows nor count them: at this
       grain U produced three events, below the floor, and education publishes
       nothing. The company grain counts all five (asserted above). That makes
       this grain the stricter of the two -- nothing is over-published as a
       result -- and the difference is a decision, stated in the migration's
       COMMENT ON and pinned here at both ends. */
    const ed = after.cat.get("education")!;
    expect(num(ed.gate_share_30), "three events is below the floor, so the pool is empty").toBe(0);
    expect(ed.events_30, "and with an empty pool there is no count to publish").toBeNull();
    expect(ed.sufficient_30).toBe(false);
    expect(num(after.co.get("U")!.events_30), "while the company grain counted five").toBe(5);
  });

  it("publishes the two disclosures a pooled figure needs: its coverage and its concentration", () => {
    /* gate_share_30 says how much of the field's dated cohort survived both
       tests; dated_cohort_n_30 is its denominator, so a NULL reading can say
       WHICH absence it is rather than guessing; top_board_share_30 names the
       residual the control does NOT close -- S(30) is a mass-weighted average, so
       a large board that cleared the events floor on a handful of its own events
       still carries its whole censored mass into the pool. */
    const eng = after.cat.get("engineering")!;
    expect(num(eng.top_board_share_30), "engineering is the healthy board alone").toBeCloseTo(1, 4);
    expect(num(eng.dated_cohort_n_30), "the denominator of its gate share").toBe(20080);
    // A field the gate emptied still states its denominator, which is what
    // separates "nothing reached the cap" from "the gate removed all of it".
    const mk = after.cat.get("marketing")!;
    expect(num(mk.dated_cohort_n_30)).toBe(20000);
    expect(mk.top_board_share_30, "no admitted mass, so no concentration to state").toBeNull();
  });

  it("moves no column the change is not about", () => {
    const was = before.cat.get("engineering")!, now = after.cat.get("engineering")!;
    for (const k of ["fill_rate_14", "fill_rate_14_lo", "fill_rate_14_hi", "relist_rate_14", "still_open_14",
      "n_at_risk_14", "fills_le_14", "median_days_to_fill", "median_censored", "dated_coverage",
      "window_days", "sufficient", "cohort_from", "cohort_to"]) {
      expect(now[k], `${k} moved`).toEqual(was[k]);
    }
  });
});

/* ───────────────────────────── the code, pinned ───────────────────────────
   Executed behaviour proves the gate works on the rows it was handed; these
   pin the SHAPE, so a later re-issue cannot quietly rebuild the tautology --
   by counting age-outs, by reading the 90-day window, or by gating the field's
   disclosure on a different set from its figure. All against comment-stripped
   code. */
const CODE = {
  company: stripSql(mig(NEW_COMPANY)),
  category: stripSql(mig(NEW_CATEGORY)),
};

function controlViolations(code: string, grain: "tok" | "cat"): string[] {
  const v: string[] = [];
  // The bar is a named constant in the k CTE, beside the two it joins.
  if (!/5\s+AS min_events_30/.test(code)) v.push("constant");
  // The count is the cohort's own fills and relists at or before the cap.
  if (!/COALESCE\(sum\(c\.d_fill \+ c\.d_relist\) FILTER \(WHERE c\.tt <= 30\), 0\)::int AS events30/.test(code))
    v.push("events-from-the-cohort");
  // ...and never our own sweep's takedowns at the cap.
  if (/d_ageout[^\n]*AS events30|events30[^\n]*d_ageout/.test(code)) v.push("ageouts-counted");
  // ...and never the 90-day window's counts.
  if (/(?:f90|fills_90d|r90|relists_90d)[^\n]{0,40}>=\s*\(?SELECT? ?kk\.min_events_30/.test(code)) v.push("window-substituted");
  // The gate reads the constant rather than a spelled number.
  if (!/COALESCE\(e30\.events30, 0\) >= \(SELECT kk\.min_events_30 FROM k kk\)/.test(code)) v.push("gate-term");
  // The count is published, so the gate can be checked rather than trusted...
  if (!/AS events_30\b/.test(code)) v.push("events-published");
  // ...and SPLIT, because taken_down_30 is a fill rate and relist_rate_30 a
  // relist rate, both issued under this same boolean: their sum cannot tell a
  // reader which of the two carried the gate.
  if (!/AS fills_30\b/.test(code) || !/AS relists_30\b/.test(code)) v.push("counts-not-split");
  // A FLOOR ON FILLS ALONE, and relists not outnumbering them: the day-14
  // gate's own two terms, re-counted on this cohort. Without them a cohort
  // whose only events are relists publishes taken_down_30 = 0.0000 as a
  // measured figure.
  if (!/5\s+AS min_fills_30/.test(code)) v.push("fills-constant");
  if (!/COALESCE\(e30\.fills30, 0\) >= \(SELECT kk\.min_fills_30 FROM k kk\)/.test(code)) v.push("fills-term");
  if (!/COALESCE\(e30\.relists30, 0\) <= COALESCE\(e30\.fills30, 0\)/.test(code)) v.push("relist-balance");
  // AND THE TERM AN ABSOLUTE WIDTH CANNOT EXPRESS: the half-width measured
  // against the complement the sentence asserts. Without it the gate moves from
  // zero events to five and leaves the mechanism open one batch deeper.
  if (!/0\.50::numeric\s+AS max_rel_half_width_30/.test(code)) v.push("relative-constant");
  if (!/AND \(e30\.s30_hi - e30\.s30_lo\) \/ 2 <= \(SELECT kk\.max_rel_half_width_30 FROM k kk\) \* \(1 - e30\.s30\)/.test(code))
    v.push("relative-term");
  if (grain === "cat") {
    // At field grain the control runs per BOARD before anything is pooled...
    if (!/sum\(r\.is_fill \+ r\.is_relist\)::int AS events30/.test(code)) v.push("board-grain-count");
    if (!/\(r\.admitted AND COALESCE\(b\.events30, 0\) >= \(SELECT kk\.min_events_30 FROM k kk\)\) AS admitted/.test(code))
      v.push("equality-gate");
    // ...and per BOARD AND FIELD, joined on both keys. Counted per board alone
    // it would admit a board into every field it touches on events it produced
    // in a different one.
    if (!/AS events30\s*\n\s*FROM raw r\s*\n[^\n]*\n\s*GROUP BY r\.tok, r\.cat/.test(code)) v.push("control-grain");
    if (!/LEFT JOIN board30 b ON b\.tok = r\.tok AND b\.cat = r\.cat/.test(code)) v.push("control-join");
    // The two disclosures a pooled figure needs: which absence a NULL is, and
    // how much of the admitted mass is one board.
    if (!/AS dated_cohort_n_30\b/.test(code)) v.push("denominator-published");
    if (!/AS top_board_share_30\b/.test(code)) v.push("concentration-published");
    // ...and BOTH day-30 consumers read the gated set, so the disclosure
    // describes the admission the figure was computed under.
    const consumers = code.match(/FROM gated r/g)?.length ?? 0;
    if (consumers < 2) v.push("consumers-read-the-gated-set");
    if (/AS admitted_dated_n[\s\S]{0,200}?FROM raw r/.test(code)) v.push("share-over-ungated");
  } else {
    // At employer grain the count is NULL off an admitted bucket like the rest.
    if (!/CASE WHEN ob\.admitted THEN e30\.events30 END\s+AS events_30/.test(code)) v.push("null-not-zero");
  }
  return v;
}

describe("the positive control is spelled where the database can run it", () => {
  it("carries every property, at both grains, against comment-stripped code", () => {
    expect(controlViolations(CODE.company, "tok")).toEqual([]);
    expect(controlViolations(CODE.category, "cat")).toEqual([]);
  });

  it("re-issues rather than edits, and refuses to report success without the new term", () => {
    for (const f of [NEW_COMPANY, NEW_CATEGORY]) {
      const raw = mig(f), code = stripSql(raw);
      const fn = f === NEW_COMPANY ? "get_company_fill_curve" : "get_category_fill_curve";
      expect(code).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`));
      // THE REACHABLE SET IS STATED, NOT INHERITED. Each file DROPS the function
      // from the catalogue before recreating it, which discards every grant, and
      // a freshly created function carries EXECUTE TO PUBLIC by default -- so a
      // bare GRANT names three roles on top of everyone. Both functions are
      // deliberately anon-callable; PUBLIC is still not the same set as anon,
      // and project_definer_exposure is the record of what that difference cost
      // (107 of 121 definer functions anon-callable, one of them granting paid
      // credits). The three REVOKEs must precede the GRANT, or the GRANT is
      // adding names to a set that already holds everybody.
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        const rev = new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM ${role};`);
        expect(code, `${fn} is not revoked from ${role} by name`).toMatch(rev);
        expect(code.search(rev), `${fn}: the REVOKE from ${role} must precede the GRANT`)
          .toBeLessThan(code.indexOf(`GRANT EXECUTE ON FUNCTION public.${fn}`));
      }
      expect(code).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO anon, authenticated, service_role;`));
      // The migration checks its own work: the body it installed must carry the
      // constant, or the apply raises rather than reporting a success.
      expect(code).toMatch(/pg_get_functiondef\(p\.oid\) INTO body/);
      expect(code).toMatch(/body NOT LIKE '%min_events_30%'[\s\S]{0,160}RAISE EXCEPTION/);
      expect(code).toMatch(/cols NOT LIKE '%events_30%'[\s\S]{0,160}RAISE EXCEPTION/);
    }
    // The files they supersede are untouched: migrations are immutable.
    expect(mig(OLD_COMPANY)).not.toMatch(/min_events_30/);
    expect(mig(OLD_CATEGORY)).not.toMatch(/min_events_30/);
  });

  it("names the control and its exclusions in the contract the function carries", () => {
    for (const f of [NEW_COMPANY, NEW_CATEGORY]) {
      const raw = mig(f);
      // Adjacent SQL literals joined first: the contract is the TEXT the
      // database stores, and a guard that reads the line wrapping instead
      // fails on a reflow while the sentence is intact.
      const comment = raw.slice(raw.indexOf("COMMENT ON FUNCTION")).replace(/'\s*\n\s*'/g, "");
      expect(comment).toMatch(/POSITIVE CONTROL/);
      expect(comment).toMatch(/AGE-OUTS ARE NOT EVENTS HERE/);
      expect(comment).toMatch(/WINDOW OF EVENTS/);
      expect(comment).toMatch(/events_30/);
    }
  });
});

/* ───────────────────────────────── teeth ─────────────────────────────────
   The behavioural half already has teeth by construction: every "before" above
   is the pre-fix definition executed over the same rows, and it returns the
   defect. These are the teeth of the CODE checker -- each fixture is the
   shipped file with one clause spelled the way it could plausibly be got
   wrong, and the checker must fire on it. */
describe("the code checker can actually fail", () => {
  it("fires on the definitions this change supersedes", () => {
    expect(controlViolations(stripSql(mig(OLD_COMPANY)), "tok")).toEqual(
      expect.arrayContaining(["constant", "events-from-the-cohort", "gate-term", "events-published"]),
    );
    expect(controlViolations(stripSql(mig(OLD_CATEGORY)), "cat")).toEqual(
      expect.arrayContaining(["constant", "board-grain-count", "equality-gate", "consumers-read-the-gated-set"]),
    );
  });

  it("is not satisfied by the right spellings appearing only in a COMMENT", () => {
    // The trap this repo has fallen into seven times. The fixture is the
    // superseded body with the whole new body appended as comment lines.
    const commented = mig(NEW_COMPANY).split("\n").map((l) => `-- ${l}`).join("\n");
    const fixture = mig(OLD_COMPANY) + "\n" + commented;
    expect(controlViolations(fixture, "tok"), "against RAW the comment satisfies it").toEqual([]);
    expect(controlViolations(stripSql(fixture), "tok")).toEqual(
      expect.arrayContaining(["constant", "gate-term"]),
    );
  });

  it("fires when the gate is dropped from the sufficiency test but the count is still published", () => {
    const code = CODE.company.replace(/\s+AND COALESCE\(e30\.events30, 0\) >= \(SELECT kk\.min_events_30 FROM k kk\)/, "");
    expect(code).not.toBe(CODE.company);
    expect(controlViolations(code, "tok")).toContain("gate-term");
  });

  it("fires when the count is rebuilt out of our own age-outs", () => {
    const code = CODE.company.replace(
      "COALESCE(sum(c.d_fill + c.d_relist) FILTER (WHERE c.tt <= 30), 0)::int AS events30",
      "COALESCE(sum(c.d_fill + c.d_relist + c.d_ageout) FILTER (WHERE c.tt <= 30), 0)::int AS events30",
    );
    expect(code).not.toBe(CODE.company);
    const v = controlViolations(code, "tok");
    expect(v).toContain("events-from-the-cohort");
    expect(v).toContain("ageouts-counted");
  });

  it("fires when the field's disclosure is computed over the ungated set", () => {
    const code = CODE.category.replace(
      `count(*) FILTER (WHERE r.in_cohort30 AND r.dated)::int                AS dated_n30
    FROM gated r`,
      `count(*) FILTER (WHERE r.in_cohort30 AND r.dated)::int                AS dated_n30
    FROM raw r`,
    );
    expect(code).not.toBe(CODE.category);
    const v = controlViolations(code, "cat");
    expect(v).toContain("consumers-read-the-gated-set");
    expect(v).toContain("share-over-ungated");
  });

  it("fires when the relative bar is dropped and only the flat floor is left", () => {
    // THE MUTANT THAT IS THE DEFECT ONE BATCH DEEPER, and the one an earlier
    // draft of this change actually shipped.
    for (const grain of ["tok", "cat"] as const) {
      const src = grain === "tok" ? CODE.company : CODE.category;
      const code = src.replace(/\s+AND \(e30\.s30_hi - e30\.s30_lo\) \/ 2 <= \(SELECT kk\.max_rel_half_width_30 FROM k kk\) \* \(1 - e30\.s30\)/, "");
      expect(code, grain).not.toBe(src);
      expect(controlViolations(code, grain)).toContain("relative-term");
    }
  });

  it("fires when the fill terms are dropped and a relist-only cohort can publish a taken-down share", () => {
    for (const grain of ["tok", "cat"] as const) {
      const src = grain === "tok" ? CODE.company : CODE.category;
      const noFloor = src.replace(/\s+AND COALESCE\(e30\.fills30, 0\) >= \(SELECT kk\.min_fills_30 FROM k kk\)/, "");
      expect(noFloor, grain).not.toBe(src);
      expect(controlViolations(noFloor, grain)).toContain("fills-term");
      const noBalance = src.replace(/\s+AND COALESCE\(e30\.relists30, 0\) <= COALESCE\(e30\.fills30, 0\)/, "");
      expect(noBalance, grain).not.toBe(src);
      expect(controlViolations(noBalance, grain)).toContain("relist-balance");
    }
  });

  it("fires when the field's control is counted per board instead of per board and field", () => {
    // The exact shape this change corrected: one GROUP BY and one join key.
    // One GROUP BY, in comment-stripped code. board_share30 groups the other
    // way round (cat then tok), so this anchor is board30's alone.
    expect(CODE.category.match(/GROUP BY r\.tok, r\.cat/g)?.length, "one place counts the control").toBe(1);
    const grouped = CODE.category.replace("GROUP BY r.tok, r.cat", "GROUP BY r.tok");
    expect(grouped).not.toBe(CODE.category);
    expect(controlViolations(grouped, "cat")).toContain("control-grain");
    const joined = CODE.category.replace(
      "LEFT JOIN board30 b ON b.tok = r.tok AND b.cat = r.cat",
      "LEFT JOIN board30 b ON b.tok = r.tok",
    );
    expect(joined).not.toBe(CODE.category);
    expect(controlViolations(joined, "cat")).toContain("control-join");
  });

  it("fires when the split counts or the two disclosures stop being published", () => {
    const noSplit = CODE.company.replace(/AS fills_30\b/, "AS fills_thirty");
    expect(noSplit).not.toBe(CODE.company);
    expect(controlViolations(noSplit, "tok")).toContain("counts-not-split");
    for (const [needle, flag] of [["AS dated_cohort_n_30", "denominator-published"],
      ["AS top_board_share_30", "concentration-published"]] as const) {
      const code = CODE.category.replace(needle, needle.replace("AS ", "AS x_"));
      expect(code, needle).not.toBe(CODE.category);
      expect(controlViolations(code, "cat")).toContain(flag);
    }
  });

  it("fires when the field gate stops being an equality on both tests", () => {
    const code = CODE.category.replace(
      "(r.admitted AND COALESCE(b.events30, 0) >= (SELECT kk.min_events_30 FROM k kk)) AS admitted",
      "r.admitted AS admitted",
    );
    expect(code).not.toBe(CODE.category);
    expect(controlViolations(code, "cat")).toContain("equality-gate");
  });
});
