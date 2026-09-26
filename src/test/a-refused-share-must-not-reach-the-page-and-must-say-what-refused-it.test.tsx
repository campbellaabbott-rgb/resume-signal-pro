// A REFUSED SHARE MUST NOT REACH THE PAGE, AND THE PAGE MUST SAY WHAT REFUSED IT.
//
// WHAT HAPPENED. The day-30 sufficiency test shipped with four terms -- a
// floor on the risk set, a ceiling on the interval's half-width, the
// R + X + S identity, and an admitted observability bucket -- and every one of
// them passes VACUOUSLY on a cohort that produced no events. A curve with no
// events has zero Greenwood variance, so the half-width is exactly zero; S is
// exactly one, so the identity is 0 + 0 + 1; and the risk set is the whole
// cohort, so the floor is cleared by the widest margin of all. The test had no
// POSITIVE CONTROL: no term required the estimator to have seen anything
// happen. Reproduced live from this working tree on 2026-09-25 with the anon
// key in .env, read-only:
//
//   get_company_fill_curve(p_tokens => ARRAY['dominos'])
//     still_open_30 1.0000  [1.0000, 1.0000]  taken_down_30 0  n_at_risk_30
//     21,708  sufficient_30 TRUE  bucket lap_proven  -- and NO events_30 key
//
//   get_category_fill_curve(90, 300)  -- 18 rows, 59.9s
//     sufficient_30 TRUE on 18 of 18, NO events_30 key on any of them.
//     customer still_open_30 0.5982 on n_at_risk_30 15,507.
//
// So on the day this was written the Ghost Job Index published a day-30
// sentence for all eighteen fields, and a sibling lane measured that 14.83% of
// the pooled cohort those sentences are computed over -- 62,461 of 421,286
// observations -- sits on boards that have never once shown us a role come
// down and therefore contribute a guaranteed S = 1. On `customer` that share
// is around half the field.
//
// THE PROPERTY THIS FILE GUARDS, in three parts.
//
//   1. THE RENDERER RE-APPLIES THE GATE RATHER THAN TRUSTING IT. Every term of
//      the server's sufficient_30 is checked again here on the row's own
//      published columns, and the positive control is checked FIRST: a
//      response that carries no event count at all was computed by a function
//      whose day-30 test could pass on a cohort that produced nothing, and its
//      share is withheld rather than reprinted. This is not distrust of the
//      SQL. This deployment applies migrations through a staged runner that
//      has been observed editing and renaming them, so "the function shipped"
//      is a claim about behaviour; a renderer that prints whatever the server
//      calls sufficient has no way to be wrong about that.
//
//   2. A REFUSAL IS NAMED, NOT ROUNDED TO A ZERO. Three states, the pattern
//      /jobs already applies to "actively hiring": published, withheld with
//      the term that refused it stated, and -- at the page level -- silent,
//      when the response carried no day-30 gate at all and "we could not
//      measure this" would itself be a claim the response cannot support. No
//      withheld field draws a dash, an "n/a" or a zero, and no reason sentence
//      says a field's roles stayed up, because that is precisely the thing we
//      could not measure.
//
//   3. NO PERCENTAGE REACHES ANY PUBLISHED SURFACE. Asserted against GENERATED
//      OUTPUT on both surfaces the figure could reach a reader through: the
//      rendered DOM, and the static HTML scripts/prerender-seo.mjs bakes for
//      crawlers and readers without JavaScript. Reading the source would not
//      do -- a guard that reads source is how four data pages shipped for
//      months serving no figures at all.
//
// TEETH, all three exercised below rather than asserted: a verdict routine
// that trusts sufficient_30 alone is handed to the property and must be
// rejected; a reading that drops the event term is handed to it and must be
// rejected; the constants are re-extracted from a doctored copy of the
// migration and the comparison must fail; and the prerender checker is handed
// a page that does carry the sentence and must report it.
//
// Guards read COMMENT-STRIPPED source and COMMENT-STRIPPED SQL. Nothing any
// assertion below requires is spelled inside a comment in the file it reads.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => stubTable(),
    functions: { invoke: async () => ({ data: {} }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import GhostJobIndex, {
  day30Reading, day30Verdict, DAY30_WITHHELD_REASONS, DAY30_REASON_KEY, DAY30_REASON_EN,
  MIN_EVENTS_30, MIN_FILLS_30, MIN_N_AT_RISK_30, MAX_HALF_WIDTH_30, MAX_REL_HALF_WIDTH_30, SUM_CHECK_TOLERANCE_30,
  type Day30Row, type Day30Verdict, type Day30WithheldReason,
} from "../pages/GhostJobIndex";
import { FILL_RATE_MIN_TRACKING_DAYS } from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const stripTs = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const PAGE = stripTs(read("src/pages/GhostJobIndex.tsx"));
const SLOW = { timeout: 8000 } as const;
const body = () => document.body.textContent ?? "";

// ── fixtures ────────────────────────────────────────────────────────────────
/** A listed field row: sufficient at day 14, dated, watched past /jobs' floor. */
const base = (category: string) => ({
  category,
  n_at_risk_14: 400, fills_le_14: 120, fill_rate_14: 0.3, fill_rate_14_lo: 0.25, fill_rate_14_hi: 0.35,
  relist_rate_14: 0.1, still_open_14: 0.6, median_days_to_fill: null, median_censored: true,
  dated_coverage: 0.7, window_days: FILL_RATE_MIN_TRACKING_DAYS + 30, sufficient: true,
});
/** A day-30 arm that clears every term, with a deliberately unmistakable share:
 *  0.93 appears nowhere else this page can render, so "93%" absent from the
 *  document is a statement about the day-30 arm and nothing else. */
const OK30 = {
  gate_share_30: 0.81, top_board_share_30: 0.22, dated_cohort_n_30: 385,
  still_open_30: 0.93, still_open_30_lo: 0.90, still_open_30_hi: 0.96,
  taken_down_30: 0.05, relist_rate_30: 0.02, n_at_risk_30: 312, ageouts_at_30: 128,
  sum_check_30: 1, cohort_from: "2026-08-07", cohort_to: "2026-08-11",
  // The counts SPLIT: taken_down_30 is a fill rate and relist_rate_30 a relist
  // rate, both published under the one boolean, so the gate needs fills of its
  // own and relists not outnumbering them — not just their sum.
  events_30: 40, fills_30: 30, relists_30: 10,
  sufficient_30: true,
};
/** The interval OK30 carries has to clear the RELATIVE bar as well as the
 *  absolute one, or "every term clears" would be false and every mutant below
 *  would pass for the wrong reason. Half-width 0.03 against a complement of
 *  0.07 is a ratio of 0.43. */
const OK30_RATIO = ((OK30.still_open_30_hi - OK30.still_open_30_lo) / 2) / (1 - OK30.still_open_30);
/** THE DEFECT, AS THE LIVE FUNCTION RETURNS IT. Domino's shape at field grain:
 *  a whole cohort at risk, not one event, a zero-width interval at exactly 1,
 *  and the server's own finding is true. The published columns are the ones
 *  measured on 2026-09-25; only `category` is ours. */
const DEGENERATE = {
  gate_share_30: 1, top_board_share_30: 1, dated_cohort_n_30: 21708,
  still_open_30: 1, still_open_30_lo: 1, still_open_30_hi: 1,
  taken_down_30: 0, relist_rate_30: 0, n_at_risk_30: 21708, ageouts_at_30: 21708,
  sum_check_30: 1, cohort_from: "2026-08-07", cohort_to: "2026-08-26",
  events_30: 0, fills_30: 0, relists_30: 0,
  sufficient_30: true,
};
/** The shape the function DEPLOYED on 2026-09-25 returns: the four old terms
 *  answered, no event count published at all. */
const UNCONTROLLED = (() => {
  const { events_30, ...rest } = OK30;
  void events_30;
  return rest;
})();
const row = (category: string, day30: Record<string, unknown>) => ({ ...base(category), ...day30 });

function mount(curve: unknown[]) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_stats_cache") return { data: null };
    if (fn === "get_ghost_job_index_stats") return { data: [{ total_open: 1000, total_companies: 50, closed_90d: 200, median_days_open: 9, median_days_to_close: null, observed_days: 60 }] };
    if (fn === "get_category_fill_curve") return { data: curve };
    if (fn === "get_actively_hiring_companies") return { data: [] };
    if (fn === "get_freshness_stats") return { data: [] };
    if (fn === "get_audit_result") return { data: null };
    if (fn === "get_date_coverage") return { data: [] };
    return { data: null };
  });
  return render(<MemoryRouter><GhostJobIndex /></MemoryRouter>);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. THE GATE, RE-APPLIED — as a function, with its teeth
// ════════════════════════════════════════════════════════════════════════════

type VerdictFn = (row: Day30Row) => Day30Verdict;
const reasonOf = (fn: VerdictFn, r: Day30Row): Day30WithheldReason | "published" => {
  const v = fn(r);
  return v.state === "published" ? "published" : v.reason;
};

/** THE PROPERTY. A share is published only when the row's own columns show the
 *  cohort produced at least the floor of events AND every other term of the
 *  server's gate holds AND the server agreed; otherwise the verdict names the
 *  term that refused it. Handed the real routine and, below, mutants that drop
 *  one term each; every mutant must be rejected. */
function assertPositiveControl(fn: VerdictFn) {
  expect(reasonOf(fn, OK30), "every term clears → the share publishes").toBe("published");
  // THE CONTROL ITSELF, in the two shapes the defect arrives in.
  expect(reasonOf(fn, UNCONTROLLED as Day30Row),
    "no event count published at all → the answer predates the control").toBe("uncontrolled");
  expect(reasonOf(fn, DEGENERATE),
    "a whole cohort at risk and not one event → an absence, not a 100%").toBe("noEvents");
  expect(reasonOf(fn, { ...OK30, events_30: MIN_EVENTS_30 - 1, fills_30: MIN_EVENTS_30 - 1, relists_30: 0 }),
    "below the floor").toBe("fewEvents");
  expect(reasonOf(fn, { ...OK30, events_30: MIN_EVENTS_30, fills_30: MIN_EVENTS_30, relists_30: 0 }),
    "exactly at both floors publishes").toBe("published");
  expect(reasonOf(fn, { ...OK30, events_30: "40", fills_30: "30", relists_30: "10" }),
    "numeric arriving as a string still counts").toBe("published");
  // A RESPONSE WITH THE EVENT COUNT AND NEITHER FILL COUNT came from a gate
  // with no fill term, which is the same class of answer as one with no event
  // count at all and is refused under the same reason.
  expect(reasonOf(fn, (() => { const { fills_30, ...r } = OK30; void fills_30; return r as Day30Row; })()))
    .toBe("uncontrolled");
  // THE FILL TERMS. S(30) falls on a fill and on a relist alike, so the events
  // floor counts both — but two of the three shares beside it are a fill rate
  // and a relist rate, and a cohort with no fills of its own may carry neither.
  expect(reasonOf(fn, { ...OK30, fills_30: MIN_FILLS_30 - 1, relists_30: 0 }), "no fills of its own").toBe("noFills");
  expect(reasonOf(fn, { ...OK30, events_30: 40, fills_30: 0, relists_30: 40 }), "five relists and no fill").toBe("noFills");
  expect(reasonOf(fn, { ...OK30, fills_30: 10, relists_30: 30 }), "relists outnumber fills").toBe("relists");
  // The three terms the gate always had, each still refusing on its own.
  expect(reasonOf(fn, { ...OK30, n_at_risk_30: MIN_N_AT_RISK_30 - 1 })).toBe("fewRoles");
  expect(reasonOf(fn, { ...OK30, still_open_30_lo: 0.5, still_open_30_hi: 0.99 })).toBe("width");
  expect(reasonOf(fn, { ...OK30, taken_down_30: 0.2 })).toBe("arithmetic");
  // THE TERM AN ABSOLUTE WIDTH CANNOT EXPRESS. The Domino's shape one batch
  // deeper: absolutely narrow, and wider than the complement it is about.
  expect(OK30_RATIO, "the fixture that PUBLISHES must clear the relative bar").toBeLessThanOrEqual(MAX_REL_HALF_WIDTH_30);
  expect(reasonOf(fn, { ...OK30, still_open_30: 0.9998, still_open_30_lo: 0.9994, still_open_30_hi: 0.9999,
    taken_down_30: 0.0002, relist_rate_30: 0, n_at_risk_30: 20000, events_30: 5, fills_30: 5, relists_30: 0 }))
    .toBe("precision");
  // The server declined and its columns do not say which term did it...
  expect(reasonOf(fn, { ...OK30, sufficient_30: false })).toBe("declined");
  expect(reasonOf(fn, { ...OK30, sufficient_30: null })).toBe("declined");
  // ...which is NOT the same as a reading that passed every term and simply did
  // not publish the cohort's own dates. Telling a reader the reading failed its
  // sufficiency test when it passed every term would be a second false
  // statement beside the one the refusal replaced.
  expect(reasonOf(fn, { ...OK30, cohort_from: null })).toBe("undated");
  expect(reasonOf(fn, { ...OK30, cohort_to: "" })).toBe("undated");
  expect(reasonOf(fn, { ...OK30, cohort_from: null, sufficient_30: false })).toBe("declined");
  // The gate admitted nothing: NULL columns, never a 1.0 — and WHICH absence it
  // is comes from the row's own denominator, because "nothing of this field
  // reached the cap" and "things reached it and the gate removed all of them"
  // are different sentences.
  const nulls = { still_open_30: null, still_open_30_lo: null, still_open_30_hi: null,
    taken_down_30: null, relist_rate_30: null, n_at_risk_30: null, events_30: null,
    fills_30: null, relists_30: null } as const;
  expect(reasonOf(fn, { ...OK30, ...nulls, dated_cohort_n_30: 0, gate_share_30: null })).toBe("unread");
  expect(reasonOf(fn, { ...OK30, ...nulls, dated_cohort_n_30: null })).toBe("unread");
  expect(reasonOf(fn, { ...OK30, ...nulls, dated_cohort_n_30: 204, gate_share_30: 0 }),
    "a board we read to the end had 204 dated roles reach the cap").toBe("ungated");
  expect(reasonOf(fn, { ...OK30, events_30: null, fills_30: null, relists_30: null, dated_cohort_n_30: 0 }),
    "an admitted-nothing event count is not a zero").toBe("unread");
}

describe("a refused share must not reach the page — the gate as a function", () => {
  it("publishes only on the cohort's own events, and names the term that refused it otherwise", () => {
    assertPositiveControl(day30Verdict);
  });

  it("the verdict and the sentence cannot come apart: published iff day30Reading returns a reading", () => {
    const rows: Day30Row[] = [
      OK30, DEGENERATE, UNCONTROLLED as Day30Row,
      { ...OK30, events_30: 0 }, { ...OK30, events_30: 1 }, { ...OK30, events_30: MIN_EVENTS_30 },
      { ...OK30, events_30: null }, { ...OK30, n_at_risk_30: 3 }, { ...OK30, taken_down_30: 0.9 },
      { ...OK30, still_open_30_lo: 0.1, still_open_30_hi: 0.99 },
      { ...OK30, sufficient_30: false }, { ...OK30, sufficient_30: null },
      { ...OK30, cohort_to: "" }, { ...OK30, still_open_30: null },
    ];
    for (const r of rows) {
      const v = day30Verdict(r);
      expect(v.state === "published", `verdict and reading disagree on ${JSON.stringify(r.events_30)}/${String(r.sufficient_30)}`)
        .toBe(day30Reading(r) !== null);
      if (v.state === "published") expect(v.reading).toEqual(day30Reading(r));
    }
  });

  it("day30Reading itself refuses the uncontrolled and the eventless row — the sentence has no second door", () => {
    expect(day30Reading(UNCONTROLLED as Day30Row), "the shape the deployed function returns").toBeNull();
    expect(day30Reading(DEGENERATE), "server said sufficient; the cohort showed us nothing").toBeNull();
    expect(day30Reading({ ...OK30, events_30: MIN_EVENTS_30 - 1 })).toBeNull();
    expect(day30Reading(OK30), "and it still publishes what clears every term").not.toBeNull();
  });

  it("TEETH: a verdict that trusts the server's finding, and a reading that drops the event term, are both rejected", () => {
    // The live defect, written as code: believe sufficient_30 and print.
    const trustsServer: VerdictFn = (r) => (r.sufficient_30 === true
      ? { state: "published", reading: { pct: 100, lo: 100, hi: 100, hw: 0, r: 0, x: 0, n: 0, cohortFrom: String(r.cohort_from), cohortTo: String(r.cohort_to), gateShare: null, topBoardShare: null } }
      : { state: "withheld", reason: "declined" });
    expect(() => assertPositiveControl(trustsServer)).toThrow();
    // The control present but not required: events counted, never compared.
    const countsButDoesNotGate: VerdictFn = (r) => (r.events_30 === undefined
      ? { state: "withheld", reason: "uncontrolled" }
      : day30Verdict({ ...r, events_30: MIN_EVENTS_30 }));
    expect(() => assertPositiveControl(countsButDoesNotGate)).toThrow();
    // A zero read as "no data" rather than as "nothing happened", which would
    // put the eventless board back in the pool under a different name.
    const zeroIsMissing: VerdictFn = (r) => day30Verdict({ ...r, events_30: r.events_30 === 0 ? MIN_EVENTS_30 : r.events_30 });
    expect(() => assertPositiveControl(zeroIsMissing)).toThrow();
    // The control checked last, after the terms that pass vacuously without it.
    const controlLast: VerdictFn = (r) => {
      const v = day30Verdict({ ...r, events_30: r.events_30 ?? MIN_EVENTS_30 });
      return v.state === "published" && r.events_30 === undefined ? { state: "withheld", reason: "width" } : v;
    };
    expect(() => assertPositiveControl(controlLast)).toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. THE THRESHOLDS ARE THE SERVER'S — read from the migration the DB runs
// ════════════════════════════════════════════════════════════════════════════

const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/--[^\n]*/g, "");
/** The file that DEFINES a function last in filename order is the one the
 *  database ends up running: migrations are immutable here, so a re-issue is a
 *  new file and the newest definition wins. A pin on an older file passes
 *  while the live gate drifts, which is this tree's oldest failure mode. */
function liveDefinition(fn: string): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
    .filter((f) => new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`).test(stripSql(readFileSync(resolve(MIGRATIONS, f), "utf8"))));
  expect(files.length, `no migration defines ${fn}`).toBeGreaterThan(0);
  const file = files[files.length - 1];
  return { file, sql: stripSql(readFileSync(resolve(MIGRATIONS, file), "utf8")) };
}
/** The four numbers the page re-applies, lifted out of executable SQL. */
function serverGate(sql: string) {
  const one = (re: RegExp, what: string) => {
    const m = sql.match(re);
    expect(m, `the live definition no longer names ${what} where this guard reads it`).not.toBeNull();
    return Number(m![1]);
  };
  return {
    events: one(/(\d+)\s+AS\s+min_events_30/, "the event floor"),
    n: one(/(\d+)\s+AS\s+min_n_at_risk_30/, "the risk-set floor"),
    hw: one(/([\d.]+)::numeric\s+AS\s+max_half_width_30/, "the half-width ceiling"),
    tol: one(/s30\s*-\s*1\)\s*<=\s*([\d.]+)/, "the identity tolerance"),
  };
}

describe("a refused share must not reach the page — the page re-applies the server's own numbers", () => {
  for (const fn of ["get_company_fill_curve", "get_category_fill_curve"]) {
    it(`${fn}: the live definition publishes an event count and gates on it, at the page's thresholds`, () => {
      const { file, sql } = liveDefinition(fn);
      expect(sql, `${file} must publish the count the gate is built from`).toMatch(/events_30\s+int/);
      const g = serverGate(sql);
      expect(g.events, `${file}: the event floor the page re-applies`).toBe(MIN_EVENTS_30);
      expect(g.n, `${file}: the risk-set floor`).toBe(MIN_N_AT_RISK_30);
      expect(g.hw, `${file}: the half-width ceiling`).toBe(MAX_HALF_WIDTH_30);
      expect(g.tol, `${file}: the identity tolerance`).toBe(SUM_CHECK_TOLERANCE_30);
      // The gate must USE the floor, not merely declare it beside the others.
      expect(sql).toMatch(/events30,\s*0\)\s*>=\s*\(SELECT\s+kk\.min_events_30/);
    });
  }

  it("TEETH: a definition whose floor has drifted from the page's is caught", () => {
    const { sql } = liveDefinition("get_category_fill_curve");
    const drifted = sql.replace(/(\d+)(\s+AS\s+min_events_30)/, "1$2");
    expect(serverGate(drifted).events).not.toBe(MIN_EVENTS_30);
    const widened = sql.replace(/([\d.]+)(::numeric\s+AS\s+max_half_width_30)/, "0.99$2");
    expect(serverGate(widened).hw).not.toBe(MAX_HALF_WIDTH_30);
  });

  it("the page carries no spelled threshold: the copy interpolates the constants it gates on", () => {
    const en = JSON.parse(read("src/i18n/locales/en.json")) as { ghostIndex: Record<string, string> };
    expect(en.ghostIndex.stillUp30ReasonFewEvents).toContain("{{minEvents}}");
    expect(en.ghostIndex.stillUp30ReasonFewRoles2).toContain("{{minN}}");
    expect(en.ghostIndex.stillUp30ReasonWidth).toContain("{{maxHw}}");
    expect(en.ghostIndex.stillUp30ReasonNoFills).toContain("{{minFills}}");
    expect(en.ghostIndex.stillUp30ReasonPrecision).toContain("{{maxRel}}");
    expect(PAGE).toMatch(/minEvents:\s*MIN_EVENTS_30/);
    expect(PAGE).toMatch(/minFills:\s*MIN_FILLS_30/);
    expect(PAGE).toMatch(/minN:\s*MIN_N_AT_RISK_30/);
    expect(PAGE).toMatch(/maxHw:\s*Math\.round\(MAX_HALF_WIDTH_30 \* 100\)/);
    expect(PAGE).toMatch(/maxRel:\s*Math\.round\(MAX_REL_HALF_WIDTH_30 \* 100\)/);
    // A BASIS CLAUSE THAT NAMES THE OLD BASIS IS A STALE CLAIM IN EIGHT
    // LANGUAGES. The row sentence's pool changed, so it is a NEW key: a locale
    // VALUE beats an inline default, and editing the old key in place would
    // leave every translation stating "boards we read to the end" alone.
    expect(en.ghostIndex, "the single-term basis sentence is retired").not.toHaveProperty("stillUp30Row");
    expect(en.ghostIndex.stillUp30Row2).toContain("whose own roles we saw come down or go back up");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. THE RENDERED PAGE — generated DOM, not source
// ════════════════════════════════════════════════════════════════════════════

/** The live field curve as get_category_fill_curve answered it on 2026-09-25:
 *  eighteen fields, sufficient_30 true on every one, no event count on any.
 *  The shares are the ones measured; they are here so the test can assert that
 *  NONE of them reaches the document. */
const LIVE_2026_09_25: Array<[string, number, number]> = [
  ["other", 0.5329, 93402], ["operations", 0.5753, 79385], ["healthcare", 0.5631, 56653],
  ["engineering", 0.5599, 42694], ["sales", 0.5179, 38376], ["hospitality_retail", 0.5468, 31050],
  ["finance", 0.5286, 19559], ["customer", 0.5982, 15507], ["marketing", 0.5718, 9015],
  ["education", 0.5781, 6496], ["people_hr", 0.5232, 5553], ["legal", 0.5915, 4697],
  ["data_ai", 0.5118, 4644], ["science", 0.5588, 4614], ["product", 0.5393, 4301],
  ["security", 0.5248, 3268], ["admin", 0.4729, 3196], ["design", 0.5485, 2524],
];
/** THE FIXTURE MUST FAIL FOR EXACTLY ONE REASON. Live, sum_check_30 was 1 on
 *  every one of the eighteen rows, so the arms are reconstructed to satisfy the
 *  identity and the interval is the narrow one the live half-widths imply. With
 *  the identity, the risk-set floor and the width ceiling all cleared, the ONLY
 *  term that refuses these rows is the absent event count — which is the whole
 *  claim, and would be untestable against a fixture that also failed the
 *  arithmetic. */
const liveCurve = LIVE_2026_09_25.map(([cat, s, n]) => {
  const taken = Math.round((1 - s) * 0.8 * 10000) / 10000;
  return row(cat, {
    ...UNCONTROLLED, still_open_30: s, still_open_30_lo: s - 0.003, still_open_30_hi: s + 0.003,
    // s is about 0.5 on every live row, so a half-width of 0.003 against a
    // complement of about 0.47 is a ratio near 0.006: the relative term is
    // cleared with three orders of magnitude to spare, and the ONLY term these
    // rows fail is the one the deployed function never published.
    taken_down_30: taken, relist_rate_30: 1 - s - taken, n_at_risk_30: n, cohort_to: "2026-08-26",
  });
});

describe("a refused share must not reach the page — what a reader actually sees", () => {
  beforeEach(() => { rpc.mockReset(); });

  it("against the function deployed on 2026-09-25, not one of the eighteen fields prints a day-30 share", async () => {
    mount(liveCurve);
    await waitFor(() => expect(body()).toContain("customer"), SLOW);
    const text = body();
    expect(text, "the sentence itself").not.toContain("were still advertised when they reached our 30-day cap");
    for (const [cat, s] of LIVE_2026_09_25) {
      expect(text, `${cat} must not print its day-30 share`).not.toContain(`${Math.round(s * 100)}% of dated`);
    }
    expect(text).not.toMatch(/n\/a/i);
    expect(text, "a withheld share is never a zero").not.toContain("0% of dated");
  });

  it("and it says so, naming the reason and counting the fields it covers", async () => {
    mount(liveCurve);
    await waitFor(() => expect(body()).toContain("customer"), SLOW);
    const text = body();
    expect(text).toContain("18 of the 18 fields listed here have no reading of the share still advertised at our 30-day cap");
    expect(text, "the reason is the one that actually refused them").toContain("this share has not been recomputed since we found that our day-30 test could pass on roles we had never once seen come down");
    expect(text, "and every field it covers is named").toContain("customer");
    expect(text, "the tile may not point at a line that is not there").toContain("hard freshness cap — older postings auto-dropped");
    expect(text).not.toContain("day-30 line in the field table below");
  });

  it("a curve that fails the control renders no percentage from the day-30 arm anywhere in the document", async () => {
    // 0.93 / 0.89 / 0.97 appear nowhere else this page can draw, so their
    // absence is a statement about the day-30 arm alone. The control is the
    // ONLY thing that differs between the two mounts below.
    mount([row("alpha_field", { ...OK30, events_30: 0 })]);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    for (const pct of ["93%", "89%", "97%"]) expect(body(), `${pct} reached the page from a refused curve`).not.toContain(pct);
    expect(body()).toContain("not one dated role in this cohort was seen taken down or re-listed");
  });

  it("the same curve with the control satisfied does print it — the refusal is the control, not the fixture", async () => {
    mount([row("alpha_field", OK30)]);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    expect(body()).toContain("93% of dated alpha field roles posted 2026-08-07 to 2026-08-11 were still advertised when they reached our 30-day cap");
    expect(body(), "nothing is withheld, so nothing is named").not.toContain("have no reading of the share still advertised");
  });

  it("every reason a field can be withheld for is a sentence on the page, and each names its own fields", async () => {
    mount([
      row("alpha_field", OK30),
      row("bravo_field", UNCONTROLLED),
      row("charlie_field", DEGENERATE),
      row("delta_field", { ...OK30, events_30: MIN_EVENTS_30 - 1, fills_30: MIN_EVENTS_30 - 1, relists_30: 0 }),
      row("echo_field", { ...OK30, n_at_risk_30: MIN_N_AT_RISK_30 - 1 }),
      row("foxtrot_field", { ...OK30, still_open_30_lo: 0.5, still_open_30_hi: 0.99 }),
      row("golf_field", { ...OK30, taken_down_30: 0.2 }),
      row("hotel_field", { ...OK30, still_open_30: null, still_open_30_lo: null, still_open_30_hi: null, taken_down_30: null, relist_rate_30: null, n_at_risk_30: null, events_30: null, fills_30: null, relists_30: null, dated_cohort_n_30: 0, gate_share_30: null }),
      row("india_field", { ...OK30, sufficient_30: false }),
      row("juliett_field", { ...OK30, fills_30: 0, relists_30: 40 }),
      row("kilo_field", { ...OK30, fills_30: 10, relists_30: 30 }),
      row("lima_field", { ...OK30, still_open_30: 0.9998, still_open_30_lo: 0.9994, still_open_30_hi: 0.9999,
        taken_down_30: 0.0002, relist_rate_30: 0, n_at_risk_30: 20000, events_30: 5, fills_30: 5, relists_30: 0 }),
      row("mike_field", { ...OK30, cohort_from: null }),
      row("november_field", { ...OK30, still_open_30: null, still_open_30_lo: null, still_open_30_hi: null, taken_down_30: null, relist_rate_30: null, n_at_risk_30: null, events_30: null, fills_30: null, relists_30: null, dated_cohort_n_30: 204, gate_share_30: 0 }),
    ]);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    const text = body();
    expect(text).toContain("13 of the 14 fields listed here have no reading");
    const expected: Array<[Day30WithheldReason, string]> = [
      ["uncontrolled", "bravo field"], ["unread", "hotel field"], ["ungated", "november field"],
      ["noEvents", "charlie field"], ["fewEvents", "delta field"], ["noFills", "juliett field"],
      ["relists", "kilo field"], ["fewRoles", "echo field"], ["width", "foxtrot field"],
      ["precision", "lima field"], ["arithmetic", "golf field"], ["undated", "mike field"],
      ["declined", "india field"],
    ];
    expect(expected.map(([r]) => r), "every reason the code can return has a row here")
      .toEqual([...DAY30_WITHHELD_REASONS]);
    for (const [reason, field] of expected) {
      const sentence = DAY30_REASON_EN[reason]
        .replace("{{minEvents}}", String(MIN_EVENTS_30))
        .replace("{{minFills}}", String(MIN_FILLS_30))
        .replace("{{minN}}", String(MIN_N_AT_RISK_30))
        .replace("{{maxHw}}", String(Math.round(MAX_HALF_WIDTH_30 * 100)))
        .replace("{{maxRel}}", String(Math.round(MAX_REL_HALF_WIDTH_30 * 100)));
      expect(text, `${reason} must name ${field}`).toContain(`${field} — ${sentence}`);
    }
    expect(text, "the one field that cleared every term still publishes").toContain("93% of dated alpha field roles");
    // EXACTLY ONE day-30 sentence, and it is alpha's. Counting the sentence
    // rather than scanning for percentages keeps this clear of the page's own
    // methodology prose, which describes the line in words.
    const drawn = text.match(/were still advertised when they reached our 30-day cap/g) ?? [];
    expect(drawn.length, "one field cleared the gate, so one sentence is drawn").toBe(1);
    for (const f of ["bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india",
      "juliett", "kilo", "lima", "mike", "november"]) {
      expect(text, `${f} field must not draw a share of its own`).not.toContain(`of dated ${f} field roles`);
    }
  });

  it("no reason sentence claims a field's roles stayed up — the thing we could not measure is never asserted", () => {
    for (const reason of DAY30_WITHHELD_REASONS) {
      const s = DAY30_REASON_EN[reason];
      expect(s.length, `${reason} needs a sentence`).toBeGreaterThan(40);
      expect(s, `${reason} must not carry a percentage`).not.toMatch(/\d\s?%/);
      expect(s, `${reason} must not read as a finding about the employer`).not.toMatch(/\bghost|\bfake|\bhired\b/i);
      expect(DAY30_REASON_KEY[reason], `${reason} needs a key`).toMatch(/^ghostIndex\.stillUp30Reason/);
      expect(PAGE, `the page must carry ${reason}'s key literally`).toContain(`"${DAY30_REASON_KEY[reason]}"`);
    }
  });

  it("all nine locales carry every new key with English's placeholders, and none puts a number beside an accusation", () => {
    const LOCALES = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(9);
    const en = JSON.parse(read("src/i18n/locales/en.json")) as { ghostIndex: Record<string, string> };
    const keys = ["stillUp30WithheldLead", "stillUp30WithheldGroup",
      ...DAY30_WITHHELD_REASONS.map((r) => DAY30_REASON_KEY[r].replace("ghostIndex.", ""))];
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const f of files) {
      const d = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")) as { ghostIndex?: Record<string, string> };
      for (const k of keys) {
        expect(d.ghostIndex?.[k], `${f} lacks ghostIndex.${k}`).toBeTruthy();
        expect(ph(d.ghostIndex![k]), `${f}: ghostIndex.${k} placeholders`).toEqual(ph(en.ghostIndex[k]));
        for (const sentence of d.ghostIndex![k].split(/[.!?।]/)) {
          if (/ghost|fake/i.test(sentence)) expect(sentence, `${f}: ${k} puts the word beside a number`).not.toMatch(/\d/);
        }
      }
      expect(d.ghostIndex, `${f} still carries the single-reason sentence this replaced`).not.toHaveProperty("stillUp30Unread");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. THE PRERENDERED HTML — generated output, not source
// ════════════════════════════════════════════════════════════════════════════
//
// scripts/prerender-seo.mjs bakes the four data pages' figures into static
// HTML for crawlers and for readers with no JavaScript. It does NOT publish a
// day-30 share today -- that is measured below against what it EMITS, not
// assumed from what it says -- and it must not start doing so without the
// positive control, because the static copy is the one surface where a figure
// cannot be withdrawn by a client-side gate. The builder is sliced out and run
// exactly the way a-data-page-that-serves-no-number-is-an-empty-page runs it.

const SCRIPT = resolve(ROOT, "scripts/prerender-seo.mjs");
const START = "// >>> DATA-PAGE FIGURE BUILDER START";
const END = "// <<< DATA-PAGE FIGURE BUILDER END";
type PageFigures = { html: string; desc: string | null; read: boolean };
function loadBuilder(): (p: unknown) => Record<"ghost" | "entry" | "trends" | "pay", PageFigures> {
  const src = readFileSync(SCRIPT, "utf8");
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  expect(a, "the builder's start marker moved — re-anchor this guard").toBeGreaterThan(-1);
  expect(b, "the builder's end marker moved — re-anchor this guard").toBeGreaterThan(a);
  return new Function(`${src.slice(a, b)}; return dataPageFigures;`)() as (p: unknown) => Record<"ghost" | "entry" | "trends" | "pay", PageFigures>;
}
/** A payload of the shape the board returns, carrying a day-30 arm in every
 *  form a future author might hand it: the field curve, and a naked share. If
 *  the builder ever reaches for one, the assertions below see the number. */
const PRERENDER_PAYLOAD = {
  stats: {
    computed_at: "2026-09-25T20:20:00.000000+00:00",
    stale_parts: [] as string[],
    ghost_stats: {
      total_open: 770712, total_companies: 32301, total_company_names: 31482,
      closed_90d: 1543884, observed_days: 71, median_days_open: 13.7,
      median_days_to_close: 12.5, posted_coverage_pct: 99.5,
      computed_at: "2026-09-25T20:05:00.000000+00:00",
    },
  },
  // THE BUILDER'S OWN KEY NAMES. It reads f.p50_min / f.p95_min, and a fixture
  // spelling them p50_minutes made every row of the re-check-rotation group
  // null, so group() filtered the whole section out and the assertions below
  // ran over a baked page with one fewer section than the real bake has.
  freshness: { p50_min: 91, p95_min: 640, computed_at: "2026-09-25T20:15:00.000000+00:00" },
  fill_curve: LIVE_2026_09_25.map(([category, still_open_30, n_at_risk_30]) => ({ category, still_open_30, n_at_risk_30, sufficient_30: true })),
  still_open_30: 0.5982,
};
/** Text as a reader with no JavaScript receives it. */
const asText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
/** Every way the day-30 share could show itself in baked HTML: the sentence,
 *  and any of the shares the live function returned rendered as a percentage. */
function day30Leaks(html: string): string[] {
  const t = asText(html);
  const found: string[] = [];
  if (/still advertised when they reached our 30-day cap/i.test(t)) found.push("the day-30 sentence");
  if (/reached our 30-day cap/i.test(t)) found.push("the cap-reading phrase");
  for (const [cat, s] of LIVE_2026_09_25) {
    const pct = `${Math.round(s * 100)}%`;
    if (t.includes(`${pct} of dated`)) found.push(`${cat}: ${pct}`);
  }
  return found;
}

describe("a refused share must not reach the page — the prerendered HTML", () => {
  it("the baked /ghost-job-index carries figures, and none of them is an ungated day-30 share", () => {
    const built = loadBuilder()(PRERENDER_PAYLOAD);
    // The page must still be doing its job: a figure-free assertion would pass
    // against a builder that had stopped emitting anything at all.
    expect(built.ghost.read, "the builder read the payload").toBe(true);
    expect(asText(built.ghost.html), "the page still publishes counted figures").toMatch(/\d{1,3}(?:,\d{3})+/);
    // ...and the three groups the real bake has, so the fixture exercises what
    // it claims to: the stock counts, the closure record, and the rotation.
    const baked = asText(built.ghost.html);
    expect(baked, "the stock group").toContain("verified open roles");
    expect(baked, "the closure group").toContain("the board");
    expect(baked, "the re-check-rotation group, which a mis-keyed fixture dropped entirely")
      .toContain("91 minutes");
    expect(baked).toContain("10.7 hours");
    expect(day30Leaks(built.ghost.html), "an ungated day-30 share reached the static HTML").toEqual([]);
    for (const page of ["entry", "trends", "pay"] as const) {
      expect(day30Leaks(built[page].html), `${page} carries a day-30 share`).toEqual([]);
    }
  });

  it("TEETH: the same checker reports a page that does carry one", () => {
    const built = loadBuilder()(PRERENDER_PAYLOAD);
    const leaked = `${built.ghost.html}<p>60% of dated customer roles posted 2026-08-07 to 2026-08-26 were still advertised when they reached our 30-day cap.</p>`;
    const found = day30Leaks(leaked);
    expect(found).toContain("the day-30 sentence");
    expect(found).toContain("customer: 60%");
  });
});
