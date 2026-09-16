// A BOARD THAT GREW IS A RATE WITH GATES, NOT A COUNT.
//
// THE OWNER'S DECISION (2026-09-09): "Actively hiring" = takedowns we watched
// PLUS the rate at which an employer posts NEW roles — "the key is to
// recognize smaller companies that are hiring to demonstrate growth patterns;
// of course the huge companies have a lot of openings". migration
// 20260909227000 (get_company_growth) is that rate: served count on the
// board's own daily snapshot, latest day against seven days earlier, refused
// unless every read in the window was whole, the board is old enough, big
// enough, and the series has no gap. THE RPC OWNS THE VERDICT.
//
// THE PROPERTIES THIS FILE GUARDS, and each has a teeth case that hands the
// property routine a broken implementation and requires it to throw:
//
//   1. AN UNKNOWN GROWTH READING NEVER RENDERS AS NO-GROWTH. A windowed
//      board's +2,700% and a small board's +1 role are not "did not grow";
//      they are "could not read", with the reason retained and counted.
//   2. THE TWO HALVES COMBINE IN ONE PLACE, AS A THREE-VALUED OR. Positive if
//      either half is positive; unknown if neither is and either is unread;
//      negative only when both were read and both said no.
//   3. THE CLIENT NEVER RE-DERIVES THE BAR. No site compares net or rate
//      against a threshold — and because `(x?.net ?? 0) >= 4` and
//      `Number(x?.net) >= 4` are not comparisons AGAINST `.net` textually, the
//      reads of the bar's own fields are confined to the coercion and the
//      figure helpers, and six mutants of the realistic shapes must throw.
//      The constants in Jobs.tsx exist for copy and are PINNED TO THE
//      MIGRATION'S k CTE (mirror constant + cross-runtime test, the
//      claim-drift lesson: copy goes false when the thing it describes moves
//      runtimes).
//   4. EVERY GROWTH SENTENCE NAMES ITS DATE BASIS AND SAYS BOARD. Both of our
//      observation dates, both counts, "counted from our own daily
//      observation", never "employer grew", never "shrinking", never a hire
//      or a headcount, never a calendar date literal.
//   5. THE MIGRATION KEEPS ITS SHAPE: one function in the file, LANGUAGE sql,
//      SECURITY DEFINER with anon EXECUTE, a statement_timeout, the served
//      column and never open_roles, never first_seen, the read-quality bucket
//      by equality and never `<> 'truncated'`, and it was executed in pglite.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  growthVerdict,
  growthUnknownReason,
  growthReasonFamily,
  activelyHiringVerdict,
  admittedBy,
  partitionByHiringSignal,
  hiringRecordVerdict,
  dayLabel,
  GROWTH_WINDOW_DAYS,
  GROWTH_MIN_BASELINE_SERVED,
  GROWTH_MIN_NET_ADD,
  GROWTH_MIN_RATE,
  GROWTH_MIN_TENURE_DAYS,
  type GrowthVerdict,
  type HiringRecordVerdict,
  type ActivelyHiringVerdict,
} from "../pages/Jobs";
import { changelog } from "../data/changelog";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "");
const JOBS = strip(read("src/pages/Jobs.tsx"));
const lineOf = (src: string, i: number) => src.slice(0, i).split("\n").length;
const all = (src: string, re: RegExp) => {
  const out: number[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let m = r.exec(src); m; m = r.exec(src)) out.push(m.index);
  return out;
};
const MIG_NAME = "20260909227000_a_board_that_grew_is_a_rate_with_gates_not_a_count.sql";
const MIG = read(`supabase/migrations/${MIG_NAME}`);

// ── fixtures, named for what they are ──────────────────────────────────────
/** A board at 10 served that served 14 a week later: +4, +40%, every gate passed. */
const GREW = { verdict: "grew", unknown_reason: null };
/** Read whole every day, old enough, big enough, and the pool did not rise by
 *  the bar. The only growth verdict a surface may render silently. */
const NO_GROWTH = { verdict: "no-growth", unknown_reason: null };
/** CVS: 678 stored against 19,265 advertised, a deep cursor walking it. The
 *  served count rose by hundreds with no employer action. THIS IS THE ROW A
 *  NAIVE DIFFERENCE PUBLISHES AS +2,700%. */
const WINDOWED = { verdict: "unknown", unknown_reason: "windowed_read" };
const TOO_NEW = { verdict: "unknown", unknown_reason: "too_new" };
const TOO_SMALL = { verdict: "unknown", unknown_reason: "too_small" };
const GAP = { verdict: "unknown", unknown_reason: "series_gap" };
/** An undated board whose vendor re-issued every posting id: 30 served
 *  became 100 with no employer action. More roles LEFT than the pool held. */
const POOL = { verdict: "unknown", unknown_reason: "pool_replaced" };
/** A verdict word this build does not know — a newer or older function. */
const ALIEN = { verdict: "surged", unknown_reason: null };

type GrowthFn = (g: { verdict: string; unknown_reason: string | null } | null | undefined) => GrowthVerdict;

/** THE PROPERTY, AS A ROUTINE, so the teeth case can hand it a fold. */
function assertUnknownIsNotNoGrowth(verdict: GrowthFn) {
  expect(verdict(WINDOWED), "a windowed read answers as a board that did not grow").not.toBe(verdict(NO_GROWTH));
  expect(verdict(WINDOWED)).toBe("unknown");
  expect(verdict(TOO_NEW)).toBe("unknown");
  expect(verdict(TOO_SMALL)).toBe("unknown");
  expect(verdict(GAP)).toBe("unknown");
  expect(verdict(null), "no row is our side").toBe("unknown");
  expect(verdict(undefined)).toBe("unknown");
  expect(verdict(ALIEN), "a verdict outside the vocabulary is our deploy, not their board").toBe("unknown");
  expect(verdict(GREW)).toBe("grew");
  expect(verdict(NO_GROWTH)).toBe("no-growth");
}

type CombineFn = (c: HiringRecordVerdict, g: GrowthVerdict) => ActivelyHiringVerdict;
/** THE COMBINATION'S PROPERTY: a three-valued OR, with unknown distinct from
 *  negative on every row where an unread half could have flipped it. */
function assertCombinationIsThreeValued(combine: CombineFn) {
  const C: HiringRecordVerdict[] = ["closes", "no-pattern", "unknown"];
  const G: GrowthVerdict[] = ["grew", "no-growth", "unknown"];
  for (const c of C) for (const g of G) {
    const v = combine(c, g);
    if (c === "closes" || g === "grew") expect(v, `${c} + ${g}`).toBe("positive");
    else if (c === "unknown" || g === "unknown") expect(v, `${c} + ${g}: an unread half is not a no`).toBe("unknown");
    else expect(v, `${c} + ${g}: both read, both no`).toBe("negative");
  }
  // The row the fold gets wrong, spelled out: closure read and found wanting,
  // growth unread. The board may well have grown.
  expect(combine("no-pattern", "unknown")).not.toBe(combine("no-pattern", "no-growth"));
}

describe("a board that grew is a rate with gates, not a count", () => {
  it("the growth verdict answers three things, and the third is not a no", () => {
    assertUnknownIsNotNoGrowth(growthVerdict);
    // The reason travels with the unknown and is never invented: a row's own
    // word, or `unread` when there is no row / no known word.
    expect(growthUnknownReason(WINDOWED)).toBe("windowed_read");
    expect(growthUnknownReason(TOO_NEW)).toBe("too_new");
    expect(growthUnknownReason(null)).toBe("unread");
    expect(growthUnknownReason(ALIEN)).toBe("unread");
    expect(growthUnknownReason({ verdict: "unknown", unknown_reason: "a_reason_this_build_does_not_know" })).toBe("unread");
    expect(growthUnknownReason(GREW)).toBeNull();
    expect(growthUnknownReason(NO_GROWTH)).toBeNull();
    // Every RPC reason lands in a family the set-aside sentence renders.
    for (const r of ["not_in_ledger", "windowed_read", "failed_read", "ledger_gap"] as const) expect(growthReasonFamily(r)).toBe("read");
    for (const r of ["no_series", "series_gap", "series_stale"] as const) expect(growthReasonFamily(r)).toBe("series");
    expect(growthReasonFamily("too_new")).toBe("tooNew");
    expect(growthReasonFamily("too_small")).toBe("tooSmall");
    expect(growthReasonFamily("pool_replaced")).toBe("replaced");
    expect(growthReasonFamily("excluded")).toBe("excluded");
    expect(growthReasonFamily("unread")).toBe("unread");
  });

  it("TEETH: folding unknown into no-growth fails this file", () => {
    const folded: GrowthFn = (g) => (growthVerdict(g) === "grew" ? "grew" : "no-growth");
    expect(() => assertUnknownIsNotNoGrowth(folded), "the property routine accepted a function that answers 'did not grow' for a board it could not read — the guard has no teeth").toThrow();
  });

  it("the two halves combine as a three-valued OR, in one place", () => {
    assertCombinationIsThreeValued(activelyHiringVerdict);
    expect(admittedBy("closes", "grew")).toBe("both");
    expect(admittedBy("closes", "unknown")).toBe("closes");
    expect(admittedBy("no-pattern", "grew")).toBe("grew");
    expect(admittedBy("unknown", "grew")).toBe("grew");
    expect(admittedBy("no-pattern", "no-growth")).toBeNull();
    expect(admittedBy("unknown", "unknown")).toBeNull();
  });

  it("TEETH: a combination that folds an unread half into a no fails this file", () => {
    // The exact fold a two-state OR produces: `closes || grew`, everything else false.
    const folded: CombineFn = (c, g) => (c === "closes" || g === "grew" ? "positive" : "negative");
    expect(() => assertCombinationIsThreeValued(folded), "the combination routine accepted a two-state OR — the guard has no teeth").toThrow();
    // And a fold on ONE side only — the shape a "growth is optional" edit
    // would produce: unknown growth treated as no-growth.
    const halfFolded: CombineFn = (c, g) => activelyHiringVerdict(c, g === "unknown" ? "no-growth" : g);
    expect(() => assertCombinationIsThreeValued(halfFolded), "a one-sided fold was not caught").toThrow();
  });

  it("the filter keeps three piles apart over both halves, and counts each unread reason", () => {
    const closes: Record<string, HiringRecordVerdict> = {
      acme: "closes", both: "closes", grower: "no-pattern", cvs: "unknown", small: "no-pattern",
      fresh: "unknown", flat: "no-pattern", gap: "no-pattern", unasked: "no-pattern", rekey: "no-pattern",
    };
    const growth: Record<string, { verdict: string; unknown_reason: string | null } | undefined> = {
      acme: NO_GROWTH, both: GREW, grower: GREW, cvs: WINDOWED, small: TOO_SMALL,
      fresh: TOO_NEW, flat: NO_GROWTH, gap: GAP, unasked: undefined, rekey: POOL,
    };
    const rows = [
      { token: "acme" }, { token: "both" }, { token: "grower" }, { token: "grower" },
      { token: "cvs" }, { token: "cvs" }, { token: "small" }, { token: "fresh" },
      { token: "flat" }, { token: "gap" }, { token: "unasked" }, { token: "rekey" },
      { token: undefined },
    ];
    const p = partitionByHiringSignal(rows, (tok) => (tok ? closes[tok] ?? "unknown" : "unknown"), (tok) => (tok ? growth[tok] : undefined));
    // Positive: acme (closes only), both (both), grower x2 (grew only).
    expect(p.shown.map((r) => r.token)).toEqual(["acme", "both", "grower", "grower"]);
    expect(p.admitted).toEqual({ closes: 1, both: 1, grew: 2 });
    // Negative, silently: flat (no-pattern + no-growth).
    expect(p.noPattern).toBe(1);
    // Set aside: cvs x2, small, fresh, gap, unasked, rekey, and the untokened row.
    expect(p.setAside.length).toBe(8);
    expect(p.setAsideEmployers, "deduped on token; the untokened row is not an employer").toBe(6);
    // Which half was unread, per employer: cvs and fresh have no closure
    // record; cvs, small, fresh, gap, unasked and rekey have no growth reading.
    expect(p.noClosureEmployers).toBe(2);
    expect(p.growthUnreadEmployers).toBe(6);
    expect(p.growthReasons).toEqual({ read: 1, series: 1, tooNew: 1, tooSmall: 1, replaced: 1, excluded: 0, unread: 1 });
    // Nothing is lost between the piles.
    expect(p.shown.length + p.setAside.length + p.noPattern).toBe(rows.length);
  });

  /** THE PROPERTY, AS A ROUTINE OVER SOURCE, so the teeth case can hand it a
   *  mutated copy of Jobs.tsx. Three rules: the verdict word is read once;
   *  nothing is compared against the bar's fields or the mirrors; and the
   *  bar's fields are READ only where they are coerced (normaliseGrowth) or
   *  printed (growthPct; a served count straight into a figure). The third
   *  rule is what catches `(x?.net ?? 0) >= 4` and `Number(x?.net) >= 4`,
   *  which the second cannot see — the operand is a parenthesised expression,
   *  and the file's own growthPct writes `(g.rate ?? 0)`, so that is exactly
   *  the shape a later edit would copy. */
  function assertBarNotRederived(src: string) {
    // The verdict word is read in exactly one place.
    const verdictReads = all(src, /\.verdict\s*[!=]==/);
    expect(verdictReads.map((i) => lineOf(src, i)), "`.verdict ===` outside growthVerdict — that site cannot carry the RPC's reason").toHaveLength(2);
    for (const i of verdictReads) expect(src.slice(0, i)).toMatch(/export function growthVerdict\([\s\S]*$/);
    expect(src.slice(verdictReads[1]).search(/\n}/), "both reads are inside growthVerdict's body").toBeLessThan(200);
    // No comparison against net, rate, a served count, tenure, or any
    // GROWTH_MIN_* mirror.
    const compares = all(src, /\.(net|rate|baseline_served|latest_served|tenure_days)\s*[<>]=?|[<>]=?\s*GROWTH_MIN_\w+|GROWTH_MIN_\w+\s*[<>]=?/);
    expect(compares.map((i) => `${lineOf(src, i)}: ${src.slice(i, i + 40).trim()}`), "the client re-derives the growth bar — the RPC owns the verdict").toEqual([]);
    // The fields the bar is made of are read only where they are coerced or
    // printed.
    const span = (start: RegExp, end: RegExp): [number, number] => {
      const i = src.search(start);
      expect(i, `${start} not found in Jobs.tsx — RE-ANCHOR this guard, do not delete it`).toBeGreaterThan(-1);
      const j = src.slice(i).search(end);
      expect(j).toBeGreaterThan(-1);
      return [i, i + j];
    };
    const inside = ([a, b]: [number, number], i: number) => i >= a && i <= b;
    const NORMALISE = span(/function normaliseGrowth\(/, /\n}/);
    const PCT = span(/const growthPct = /, /;\n/);
    const stray = (re: RegExp, ok: (i: number) => boolean) =>
      all(src, re).filter((i) => !ok(i)).map((i) => `${lineOf(src, i)}: ${src.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, " ").trim()}`);
    expect(stray(/\.(net|rate)\b/, (i) => inside(NORMALISE, i) || inside(PCT, i)),
      "net or rate is read outside normaliseGrowth / growthPct — the bar is being re-derived on the client").toEqual([]);
    expect(stray(/\.(baseline_served|latest_served)\b(?!\s*\?\?\s*0\)\.toLocaleString\(\))/, (i) => inside(NORMALISE, i)),
      "a served count is read other than straight into a printed figure — a gate is being re-derived on the client").toEqual([]);
    expect(stray(/\.(tenure_days|days_observed|days_expected|ledger_days_expected|board_days_ok|board_days_bad|untracked_departures|removed_departures|observed_arrivals)\b/, (i) => inside(NORMALISE, i)),
      "a gate's input is read outside normaliseGrowth — no surface prints these and no site may gate on them").toEqual([]);
  }

  it("the bar is never re-derived on the client: no site compares net or rate, and the mirrors are pinned to the migration", () => {
    assertBarNotRederived(JOBS);
    // The mirrors are the migration's own numbers.
    const k = stripSql(MIG).match(/k AS \(\s*SELECT\s+(\d+)\s+AS window_days,\s+(\d+)\s+AS min_baseline_served,\s+(\d+)\s+AS min_net_add,\s+([\d.]+)::numeric\s+AS min_rate,\s+(\d+)\s+AS min_tenure_days/);
    expect(k, "the migration's k CTE moved — RE-ANCHOR this guard").toBeTruthy();
    expect(GROWTH_WINDOW_DAYS, "Jobs.tsx window differs from the migration").toBe(Number(k![1]));
    expect(GROWTH_MIN_BASELINE_SERVED).toBe(Number(k![2]));
    expect(GROWTH_MIN_NET_ADD).toBe(Number(k![3]));
    expect(GROWTH_MIN_RATE).toBe(Number(k![4]));
    expect(GROWTH_MIN_TENURE_DAYS).toBe(Number(k![5]));
    // And they are literals in the source, not computed — a number typed once.
    expect(JOBS).toMatch(/export const GROWTH_WINDOW_DAYS = 7;/);
    expect(JOBS).toMatch(/export const GROWTH_MIN_NET_ADD = 4;/);
    expect(JOBS).toMatch(/export const GROWTH_MIN_RATE = 0\.25;/);
    expect(JOBS).toMatch(/export const GROWTH_MIN_BASELINE_SERVED = 10;/);
    expect(JOBS).toMatch(/export const GROWTH_MIN_TENURE_DAYS = 21;/);
    // The migration's header says why 4 and 25% and not the 3 and 15% the
    // design proposed — the measured noise floor, in its own words.
    expect(MIG).toMatch(/MIN_NET_ADD = 4 -- RAISED from the house precedent of 3/);
    expect(MIG).toMatch(/MIN_RATE = 0\.25 -- RAISED from the design's 15%/);
  });

  it("TEETH: the re-derivations a later edit would actually write fail this file", () => {
    // The card's badge site, where a "quick" inline bar would land.
    const anchor = "hiringBadgeTip(hiringRecordOf(job.token), growthVerdict(growthOf(job.token))";
    expect(JOBS.split(anchor).length - 1, "the card's badge site moved — RE-ANCHOR this teeth case").toBe(1);
    const MUTANTS: Record<string, string> = {
      "null-coalesce": `hiringBadgeTip(hiringRecordOf(job.token), (((growthOf(job.token)?.net ?? 0) >= 4 && (growthOf(job.token)?.rate ?? 0) >= 0.25) ? "grew" : "no-growth")`,
      "Number()": `hiringBadgeTip(hiringRecordOf(job.token), ((Number(growthOf(job.token)?.net) >= 4 && Number(growthOf(job.token)?.rate) >= 0.25) ? "grew" : "no-growth")`,
      "baseline gate": `hiringBadgeTip(hiringRecordOf(job.token), ((growthOf(job.token)?.baseline_served ?? 0) < 10 ? "unknown" : growthVerdict(growthOf(job.token)))`,
      "tenure gate": `hiringBadgeTip(hiringRecordOf(job.token), ((growthOf(job.token)?.tenure_days ?? 0) < 21 ? "unknown" : growthVerdict(growthOf(job.token)))`,
      "verdict read inline": `hiringBadgeTip(hiringRecordOf(job.token), (growthOf(job.token)?.verdict === "grew" ? "grew" : "no-growth")`,
      "direct compare": `hiringBadgeTip(hiringRecordOf(job.token), (growthOf(job.token)!.net >= 4 ? "grew" : "no-growth")`,
      "mirror compare": `hiringBadgeTip(hiringRecordOf(job.token), ((growthOf(job.token)?.net ?? 0) >= GROWTH_MIN_NET_ADD ? "grew" : "no-growth")`,
    };
    for (const [name, m] of Object.entries(MUTANTS)) {
      expect(() => assertBarNotRederived(JOBS.replace(anchor, m)), `mutant "${name}" re-derives the bar on the card and the guard let it through`).toThrow();
    }
    // The shipped source passes the same routine, so the teeth are not vacuous.
    expect(() => assertBarNotRederived(JOBS)).not.toThrow();
  });

  it("every consumer of the growth reading is enumerated FROM THE SOURCE, and each one answers for unknown", () => {
    const CONSUMER = /\b(growthOf|growthVerdict|hiringSignalOf)\s*\(/g;
    const DEFINITION = /(export function growthVerdict\s*\(|export function growthUnknownReason|const growthOf = useCallback|const hiringSignalOf = useCallback|const isActivelyHiring = useCallback|hiringSignalOf\(tok\) === "positive"|activelyHiringVerdict\(hiringRecordOf\(tok\), growthVerdict\(growthOf\(tok\)\)\)|growthVerdict\(g\) !== "unknown"|const growth = growthVerdict\(g\);)/;
    const sites = all(JOBS, CONSUMER).filter((i) => {
      const lineStart = JOBS.lastIndexOf("\n", i) + 1;
      const lineEnd = JOBS.indexOf("\n", i);
      return !DEFINITION.test(JOBS.slice(lineStart, lineEnd === -1 ? undefined : lineEnd));
    });
    expect(sites.length, "no consumer of the growth reading found — RE-ANCHOR this guard, do not delete it").toBeGreaterThanOrEqual(6);
    const WINDOW = 2500;
    const unhandled: number[] = [];
    for (const i of sites) {
      const near = JOBS.slice(Math.max(0, i - WINDOW), i + WINDOW);
      if (!/=== "unknown"|=== "unreadable"|"unknown" &&/.test(near)) unhandled.push(lineOf(JOBS, i));
    }
    expect(unhandled, `these sites read the growth reading and never say what an unread one means: lines ${unhandled.join(", ")}`).toEqual([]);
    // The five surfaces the build was asked for, pinned by their keys: the
    // chip (via the partition), the detail panel clause, the compare row, the
    // employer page's health line, and the card's second unread chip.
    for (const k of ["verdictGrew", "verdictGrowthUnread", "hhGrowthGrew", "hhGrowthNone", "hhGrowthUnread", "growthUnreadBadge", "growthUnreadBadgeTip", "hiringAdmittedGrew"]) {
      expect(JOBS, `jobsPage.${k} is not rendered`).toContain(`"jobsPage.${k}"`);
    }
    expect(all(JOBS, /"jobsPage\.verdictGrew"/).length, "the detail clause and the compare row both render the grew sentence").toBe(2);
    // The card's second unread chip is reached only when the combined
    // verdict is unknown AND the growth half is the unread one.
    expect(JOBS).toMatch(/hiringSignalOf\(job\.token\) === "unknown" && growthVerdict\(growthOf\(job\.token\)\) === "unknown"/);
  });

  it("every growth sentence names its date basis, prints both dates and both counts, and says board", () => {
    const en = JSON.parse(read("src/i18n/locales/en.json")).jobsPage as Record<string, string>;
    const inline: Record<string, string> = {};
    for (const m of read("src/pages/Jobs.tsx").matchAll(/t\("jobsPage\.([A-Za-z0-9_]+)",\s*"((?:[^"\\]|\\.)*)"/g)) inline[m[1]] = m[2];
    const FIGURE_KEYS = ["verdictGrew", "hhGrowthGrew", "hhGrowthNone", "hiringAdmittedGrew", "hiringAdmittedBoth"] as const;
    const CALENDAR_DATE = /\b20\d\d-\d\d-\d\d\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b|\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
    for (const src of [en, inline]) {
      for (const k of FIGURE_KEYS) {
        const v = src[k];
        expect(v, `jobsPage.${k} missing`).toBeTruthy();
        for (const ph of ["{{latest}}", "{{baseline}}", "{{latestDay}}", "{{baselineDay}}"]) expect(v, `${k} does not print ${ph}`).toContain(ph);
        expect(v, `${k} does not say the figure is counted from our own daily observation`).toMatch(/counted from our own daily observation/);
        expect(v, `${k} says employer where it means board`).toMatch(/\bboard\b/);
        expect(v, `${k} calls the rise a hire or a headcount`).not.toMatch(/\bhired\b|is a headcount|headcount grew/i);
        expect(v).not.toMatch(CALENDAR_DATE);
      }
      // The grew sentences carry the rate; the no-growth sentence never
      // renders a fall as shrinking (our own de-duplication lowers a count).
      for (const k of ["verdictGrew", "hhGrowthGrew", "hiringAdmittedGrew", "hiringAdmittedBoth"]) expect(src[k], `${k} does not print the rate`).toContain("{{pct}}");
      expect(src.hhGrowthNone).toMatch(/not a claim that they are shrinking/);
      expect(src.hhGrowthNone).not.toMatch(/\bis shrinking\b|\bshrank\b|\bcut\b/i);
      // The unread sentences name OUR gap and never the employer's inactivity.
      for (const k of ["growthUnreadBadgeTip", "hhGrowthUnread"]) {
        expect(src[k]).toMatch(/gap in our record/);
        expect(src[k]).toMatch(/not a sign they are not hiring/);
      }
      for (const k of ["growthWhyRead", "growthWhySeries", "growthWhyTooNew", "growthWhyTooSmall", "growthWhyReplaced", "growthWhyExcluded", "growthWhyUnread"]) {
        expect(src[k], `${k} missing`).toBeTruthy();
        expect(src[k], `${k} makes a claim about the employer`).not.toMatch(/not hiring|stopped|inactive|shrink/i);
      }
      expect(src.growthWhyTooNew).toContain("{{minTenure}}");
      expect(src.growthWhyTooSmall).toContain("{{minBaseline}}");
      // The reason list under the results prints a count per family.
      // A replaced pool names OUR observation (the listings changed under us),
      // never the employer's intent.
      expect(src.growthWhyReplaced).toMatch(/changed under us|turned over/);
      for (const k of ["growthReasonRead", "growthReasonSeries", "growthReasonTooNew", "growthReasonTooSmall", "growthReasonReplaced", "growthReasonExcluded", "growthReasonUnread"]) {
        expect(src[k], `${k} does not print its count`).toContain("{{c}}");
      }
    }
    // The tenure copy never prints an onboarding date: no growth key carries a
    // first_snapshot placeholder at all, because a censored board's first day
    // is the table's own floor.
    for (const [k, v] of Object.entries(inline)) if (/^(growth|hhGrowth|verdictGrow|hiringAdmitted)/.test(k)) expect(v, `${k} prints a first-snapshot date`).not.toMatch(/firstSnapshot|onboarded/i);
  });

  it("the observation day renders in UTC, so no reader west of Greenwich sees the day before", () => {
    expect(dayLabel("2026-09-07", "en")).toBe("Sep 7");
    expect(dayLabel("2026-09-14T00:00:00", "en")).toBe("Sep 14");
    expect(dayLabel("not-a-date", "en")).toBe("not-a-date");
    expect(dayLabel(null, "en")).toBe("");
    expect(JOBS, "toLocaleDateString must be told the zone").toMatch(/timeZone: "UTC"/);
  });

  it("the migration keeps its shape: one LANGUAGE sql definer, anon EXECUTE, a timeout, the served column, the read bucket by equality", () => {
    const sql = stripSql(MIG);
    expect(all(sql, /CREATE OR REPLACE FUNCTION/).length, "one function per file — the out-params guard slices by dollar quotes").toBe(1);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_company_growth\(p_tokens text\[\]\)/);
    expect(sql).toMatch(/LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = public\s+SET statement_timeout = '25s'/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_company_growth\(text\[\]\) TO anon, authenticated, service_role;/);
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/);
    const body = sql.slice(sql.indexOf("AS $$"), sql.lastIndexOf("$$;"));
    // The served count and never the stored one; never first_seen.
    expect(body).toMatch(/open_roles_served/);
    expect(body, "open_roles (stored rows) must never feed the rate").not.toMatch(/\bopen_roles\b/);
    expect(body, "first_seen is never a posting age").not.toMatch(/first_seen/);
    // Read quality bucketed by equality on the writer's vocabulary; the NULL
    // trap spelled `<> 'truncated'` must not appear.
    expect(body).toMatch(/bs\.state = k\.read_state_ok/);
    expect(body).not.toMatch(/<>\s*'truncated'|!=\s*'truncated'/);
    // Every gate names its reason, and the three verdict words are these.
    for (const r of ["excluded", "series_stale", "no_series", "too_new", "series_gap", "too_small", "pool_replaced", "not_in_ledger", "windowed_read", "failed_read", "ledger_gap"]) {
      expect(body, `reason '${r}' missing`).toContain(`'${r}'`);
    }
    // THE LEDGER IS READ ONE DAY EARLIER THAN THE SERIES: the 02:30 snapshot
    // dated D is the product of the read dated D-1, so the read that produced
    // the BASELINE count is dated baseline_day - 1. Nine ledger rows for an
    // eight-row series, and the gap arm counts against that nine, not eight.
    expect(body).toMatch(/bs\.observed_on BETWEEN w\.baseline_day - 1 AND w\.latest_day/);
    expect(body).toMatch(/k\.window_days \+ 2\s+AS ledger_days_expected/);
    expect(body).toMatch(/c\.board_days_ok < c\.ledger_days_expected\s+THEN 'ledger_gap'/);
    expect(body, "the gap arm must count against the ledger's own expectation").not.toMatch(/c\.board_days_ok < c\.days_expected/);
    expect(MIG).toMatch(/THE LEDGER IS CHECKED ONE DAY EARLIER THAN THE SERIES/);
    // A pool that turned over under us is refused after too_small and before
    // the ledger arms, on the employer's own removals against the baseline.
    expect(body).toMatch(/THEN 'too_small'\s+WHEN c\.removed_departures >= c\.baseline_served\s+THEN 'pool_replaced'\s+WHEN c\.board_days_any = 0/);
    expect(body).toMatch(/sum\(f\.departures_removed\)::int\s+AS removed_departures/);
    expect(body).toMatch(/THEN 'unknown'/);
    expect(body).toMatch(/THEN 'grew'/);
    expect(body).toMatch(/ELSE 'no-growth'/);
    // A gap refuses; it never shortens. The interior-days rule is the
    // ceil(0.8 x window) the design fixed, and both endpoints are required.
    expect(body).toMatch(/ceil\(0\.8 \* k\.window_days\)::int\s+AS min_interior_days/);
    expect(body).toMatch(/c\.baseline_served IS NULL OR c\.latest_served IS NULL\s+OR \(c\.days_observed - 2\) < c\.min_interior_days/);
    // Tenure is a floor when censored at the table's own first day.
    expect(body).toMatch(/tn\.first_snapshot_day = w\.series_floor/);
    // Every column the page reads is in the return shape.
    const outs = sql.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/)?.[1] ?? "";
    for (const c of ["window_days", "baseline_day", "baseline_served", "latest_day", "latest_served", "net", "rate", "days_observed", "days_expected", "ledger_days_expected", "board_days_ok", "board_days_bad", "first_snapshot_day", "tenure_days", "tenure_censored", "untracked_departures", "removed_departures", "observed_arrivals", "verdict", "unknown_reason"]) {
      expect(outs, `RETURNS TABLE lacks ${c}`).toMatch(new RegExp(`^\\s*${c}\\s`, "m"));
    }
    // The catalogue is cleared by name before the issue, and the calibration
    // sentence is in the header.
    expect(sql).toMatch(/p\.proname = 'get_company_growth'/);
    expect(MIG).toMatch(/ONE service-role query\s+(--\s+)?on day one/);
    // Executed in pglite, and the script names this file.
    const verify = "scripts/verify-migration-20260909227000.mjs";
    expect(existsSync(resolve(ROOT, verify)), `${verify} is missing`).toBe(true);
    expect(read(verify)).toContain(MIG_NAME);
    expect(read(verify), "the verifier must prove the NULL trap on a mutant").toMatch(/IS DISTINCT FROM 'truncated'/);
    expect(read(verify), "the verifier must prove that a ledger read over the snapshot days only publishes the baseline's cursor walk").toMatch(/BETWEEN w\.baseline_day AND w\.latest_day/);
    expect(read(verify), "the verifier must work a replaced pool by hand").toMatch(/pool_replaced/);
    // This migration sorts after every migration that was live when it was
    // written, and it is the newest definer of the function.
    const defining = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /FUNCTION public\.get_company_growth\s*\(/.test(read(`supabase/migrations/${f}`)));
    expect(defining[defining.length - 1]).toBe(MIG_NAME);
  });

  it("the changelog entry states what joined, what it measures, and what stays unknown", () => {
    const CL = JSON.parse(read("src/i18n/changelog/en.json")) as { changelogEntries: Record<string, { title: string; description: string }> };
    const e = CL.changelogEntries.newPostingsJoinActivelyHiring;
    expect(e, "newPostingsJoinActivelyHiring missing from en").toBeTruthy();
    const text = `${e.title} ${e.description}`;
    expect(text).toMatch(/rate/i);
    expect(text).toMatch(/counted from our own daily observation/);
    expect(text, "the bars, in the constants' own numbers").toMatch(new RegExp(`at least ${GROWTH_MIN_NET_ADD} more roles`));
    // The takedown bar too, pinned to its constant — a bar written as a word
    // ("three") cannot be pinned and goes stale when the constant moves.
    const minClosed = Number(read("src/pages/Jobs.tsx").match(/const ACTIVELY_HIRING_MIN_CLOSED = (\d+);/)?.[1]);
    expect(minClosed, "ACTIVELY_HIRING_MIN_CLOSED not found — RE-ANCHOR").toBeGreaterThan(0);
    expect(text).toMatch(new RegExp(`at least ${minClosed} roles down`));
    expect(text, "no count spelled as a word").not.toMatch(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty[- ]one) (more )?roles\b/i);
    expect(text).toMatch(new RegExp(`at least ${Math.round(GROWTH_MIN_RATE * 100)}% more`));
    expect(text).toMatch(new RegExp(`than ${GROWTH_WINDOW_DAYS} days earlier`));
    expect(text).toMatch(new RegExp(`fewer than ${GROWTH_MIN_TENURE_DAYS} days`));
    expect(text).toMatch(new RegExp(`fewer than ${GROWTH_MIN_BASELINE_SERVED} roles`));
    expect(text, "what stays unknown, and that it is counted on screen").toMatch(/counted on screen with the reason/);
    expect(text).toMatch(/only read part of/);
    expect(text).toMatch(/(none of those is|not) a sign an employer is not hiring/i);
    expect(text, "a takedown is not a hire, a rise is not a headcount").toMatch(/A takedown is not a hire/);
    expect(text).toMatch(/not a headcount/);
    expect(text, "board, not employer, and the several-sites caveat").toMatch(/each is read on its own/);
    expect(text, "the bars are modelled and may move — said, not hidden").toMatch(/if the bars move an entry here will say so/);
    const entry = changelog.find((x) => x.id === "newPostingsJoinActivelyHiring");
    expect(entry).toEqual({ id: "newPostingsJoinActivelyHiring", date: "2026-09-14", tags: ["new", "improved"] });
    // And the list is newest first around it: nothing older sits above it,
    // nothing newer below. (It was pinned to index 0, which every later entry
    // — the first came two days on — necessarily broke; the property is the
    // order, not the slot.)
    const at = changelog.findIndex((x) => x.id === "newPostingsJoinActivelyHiring");
    expect(at).toBeGreaterThanOrEqual(0);
    for (const x of changelog.slice(0, at)) expect(x.date >= entry!.date, `${x.id} (${x.date}) sits above a newer entry`).toBe(true);
    for (const x of changelog.slice(at + 1)) expect(x.date <= entry!.date, `${x.id} (${x.date}) sits below an older entry`).toBe(true);
    // en-GB carries it too (the English build owns both).
    const GB = JSON.parse(read("src/i18n/changelog/en-GB.json")) as typeof CL;
    expect(GB.changelogEntries.newPostingsJoinActivelyHiring?.description).toBe(e.description);
  });

  it("the closure half is untouched: its verdict still answers alone and the growth half cannot leak into it", () => {
    // hiringRecordVerdict reads fills and relists and nothing else; a growth
    // row handed to it by mistake is ignored, not folded.
    expect(hiringRecordVerdict({ fills_90d: 5, relists_90d: 1 })).toBe("closes");
    expect(hiringRecordVerdict({ fills_90d: 0, relists_90d: 0 })).toBe("unknown");
    expect(JOBS.match(/export function hiringRecordVerdict\([\s\S]*?\n}/)?.[0], "hiringRecordVerdict must not read the growth row").not.toMatch(/growth|verdict\b/);
  });
});
