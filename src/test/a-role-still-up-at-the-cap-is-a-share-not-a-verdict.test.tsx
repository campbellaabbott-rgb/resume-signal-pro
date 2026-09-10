// A ROLE STILL UP AT THE CAP IS A SHARE, NOT A VERDICT.
//
// Past day 30 a posting is deleted, not observed, so "how long postings stay
// up" can only mean S(30): the share of a DATED cohort still advertised when
// it reached our cap, from the Aalen-Johansen estimator the repo already runs,
// beside R(30) taken down for good and X(30) re-listed (a floor). Migration
// 20260909217500 appends those columns to get_category_fill_curve, and the
// Ghost Job Index now renders them as one line under a field's row.
//
// WHAT WOULD MAKE THE LINE A LIE, AND WHAT THIS FILE PINS AGAINST EACH:
//
//   1. A WINDOWED BOARD READS 1.0 BY CONSTRUCTION. On a board we can only
//      read part of, a takedown is invisible and every posting "ages out", so
//      the RPC admits only full_read / lap_proven boards and returns NULL —
//      never 1.0 — where the gate admitted nothing. The page must therefore
//      render on the RPC's own finding, sufficient_30 === true, and on nothing
//      else. A NULL, an absent column (the deployed .67 RPC) and an explicit
//      false all draw NOTHING — no dash, no "n/a" — because a placeholder
//      beside a field name reads as a finding about that field. The teeth
//      test below hands the property routine a mutant that renders whenever
//      the numbers are present and requires that it be rejected.
//   2. THE COHORT FLOOR MOVES. cohort_from is the day our exit log began
//      holding what the estimator needs, and it retires itself as the 90-day
//      window passes it. A typed date would go stale on its own, so the line
//      prints the row's cohort_from / cohort_to and the page's code carries no
//      date literal at all.
//   3. THE DISCLOSURE OF WHICH FIELDS LACK A READING is only true once the
//      function that decides it has run. Against an old RPC every field would
//      be "unread" — a claim the response cannot support — so the sentence is
//      gated on the column being present on some row, and against an old RPC
//      the whole day-30 surface is silent.
//   4. median_censored IS NOT S(30). The caption used to say "more than half
//      the roles we tracked were still up at 30 days" for a flag that means
//      R(30) < 0.5 — the fill arm alone — which a field with 30% re-listed and
//      25% still advertised satisfies. That sentence now names the arm it
//      measures; published-claims.test.ts pins the wording.
//
// Guards read COMMENT-STRIPPED source. The literal trap has bitten this repo
// five times; nothing a guard below requires is spelled inside a comment.
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

import GhostJobIndex, { day30Reading, day30ColumnPresent } from "../pages/GhostJobIndex";
import { FILL_RATE_MIN_TRACKING_DAYS } from "../pages/Jobs";
import { changelog } from "../data/changelog";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
// Line comments off first, then block comments — a line comment holding `/*`
// otherwise opens a block that eats real code and turns a guard vacuous.
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const PAGE = strip(read("src/pages/GhostJobIndex.tsx"));
const SLOW = { timeout: 6000 } as const;
const body = () => document.body.textContent ?? "";

// ── fixtures ────────────────────────────────────────────────────────────────
// A listed row: sufficient, dated, watched past the floor /jobs declares.
const base = (category: string) => ({
  category,
  n_at_risk_14: 400, fills_le_14: 120, fill_rate_14: 0.3, fill_rate_14_lo: 0.25, fill_rate_14_hi: 0.35,
  relist_rate_14: 0.1, still_open_14: 0.6, median_days_to_fill: null, median_censored: true,
  dated_coverage: 0.7, window_days: FILL_RATE_MIN_TRACKING_DAYS + 30, sufficient: true,
});
const DAY30 = {
  gate_share_30: 0.81, still_open_30: 0.41, still_open_30_lo: 0.35, still_open_30_hi: 0.47,
  taken_down_30: 0.44, relist_rate_30: 0.15, n_at_risk_30: 312, ageouts_at_30: 128,
  sum_check_30: 1, cohort_from: "2026-08-07", cohort_to: "2026-08-11",
};
const NULL30 = {
  gate_share_30: null, still_open_30: null, still_open_30_lo: null, still_open_30_hi: null,
  taken_down_30: null, relist_rate_30: null, n_at_risk_30: null, ageouts_at_30: null,
  sum_check_30: null, cohort_from: "2026-08-07", cohort_to: "2026-08-11",
};
/** alpha publishes; beta has every number but the RPC said false (the mutant
 *  bait); gamma is the gate-admitted-nothing NULL row; delta is a row from a
 *  build without the columns at all; epsilon has every number and a NULL
 *  finding — the bait for a gate spelled `!== false`. */
const MIXED = [
  { ...base("alpha_field"), ...DAY30, sufficient_30: true },
  { ...base("beta_field"), ...DAY30, sufficient_30: false },
  { ...base("gamma_field"), ...NULL30, sufficient_30: false },
  base("delta_field"),
  { ...base("epsilon_field"), ...DAY30, sufficient_30: null },
];
const OLD_RPC = [base("alpha_field"), base("beta_field")];
const NONE_SUFFICIENT = [
  { ...base("alpha_field"), ...NULL30, sufficient_30: false },
  { ...base("beta_field"), ...DAY30, sufficient_30: false },
];

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
const OLD_TILE = "hard freshness cap — older postings auto-dropped";

describe("a role still up at the cap is a share, not a verdict — behaviour", () => {
  beforeEach(() => { rpc.mockReset(); });

  it("renders the day-30 line for the row whose sufficient_30 is true, from the row's own numbers and dates", async () => {
    mount(MIXED);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    const text = body();
    expect(text).toContain("41% of dated alpha field roles posted 2026-08-07 to 2026-08-11 were still advertised when they reached our 30-day cap");
    expect(text, "n and the half-width, from the row").toContain("(n=312, ±6 points)");
    expect(text, "R(30) beside it, as the ceiling it is").toContain("at most 44% had been taken down for good");
    expect(text, "X(30) is a floor").toContain("at least 15% re-listed");
    expect(text, "the population the line was counted on").toContain("Counted only on boards we read to the end.");
  });

  it("draws NOTHING for day 30 on a false, a NULL and an absent row — no dash, no placeholder", async () => {
    mount(MIXED);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    const text = body();
    for (const f of ["beta field", "gamma field", "delta field", "epsilon field"]) {
      expect(text, `${f} must not publish: the RPC's finding is false, NULL or absent`).not.toContain(`of dated ${f} roles`);
    }
    expect(text).not.toMatch(/n\/a/i);
    expect((text.match(/were still advertised when they reached our 30-day cap/g) ?? []).length, "exactly one row publishes").toBe(1);
  });

  it("names the listed fields that lack a reading, once, above the table", async () => {
    mount(MIXED);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    const text = body();
    expect(text).toContain("4 of the fields listed here — beta field, gamma field, delta field, epsilon field — have no reading of the share still advertised at our 30-day cap");
    expect((text.match(/have no reading of the share still advertised/g) ?? []).length).toBe(1);
  });

  it("re-captions the cap tile only once at least one field publishes the reading", async () => {
    mount(MIXED);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    expect(body()).toContain("The share still advertised on reaching the cap is the day-30 line in the field table below.");
    expect(body()).not.toContain(OLD_TILE);
  });

  it("against the deployed RPC (no day-30 columns) the whole day-30 surface is silent", async () => {
    mount(OLD_RPC);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    const text = body();
    expect(text).not.toContain("still advertised when they reached our 30-day cap");
    expect(text, "an old RPC cannot say which fields were read to the end").not.toContain("have no reading of the share still advertised");
    expect(text, "the tile may not point at a line that is not there").toContain(OLD_TILE);
    expect(text).not.toContain("day-30 line in the field table below");
  });

  it("with the columns present and nothing sufficient: no line, old tile, and every listed field named as unread", async () => {
    mount(NONE_SUFFICIENT);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    const text = body();
    expect(text).not.toContain("still advertised when they reached our 30-day cap");
    expect(text).toContain(OLD_TILE);
    expect(text).toContain("2 of the fields listed here — alpha field, beta field — have no reading");
  });

  it("the censored-median sentence names the arm it measures, not the share still up", async () => {
    mount(MIXED);
    await waitFor(() => expect(body()).toContain("alpha field"), SLOW);
    expect(body()).toContain("fewer than half the roles we tracked had been taken down for good by day 30");
    expect(body()).not.toContain("more than half the roles we tracked were still up");
  });
});

// ── the gate as a function, and its teeth ───────────────────────────────────
type Fn = typeof day30Reading;
/** THE PROPERTY: a reading exists iff the RPC's own finding is the boolean
 *  true and every number it needs is present. Handed the real function below
 *  and a mutant that renders on the numbers alone; the mutant must throw. */
function assertDay30Gate(fn: Fn) {
  expect(fn({ ...DAY30, sufficient_30: true }), "true + numbers → a reading").not.toBeNull();
  expect(fn({ ...DAY30, sufficient_30: false }), "false → nothing, numbers or not").toBeNull();
  expect(fn({ ...DAY30, sufficient_30: null }), "NULL → nothing").toBeNull();
  expect(fn({ ...DAY30 }), "absent column → nothing").toBeNull();
  expect(fn({ ...NULL30, sufficient_30: true }), "true with NULL numbers → nothing (never a 0)").toBeNull();
  // One column at a time: a `?? 0` on any single column prints a 0 for a NULL
  // and survives the all-NULL case above, because a sibling's NULL exits first.
  for (const col of ["still_open_30", "still_open_30_lo", "still_open_30_hi", "taken_down_30", "relist_rate_30", "n_at_risk_30"] as const) {
    expect(fn({ ...DAY30, sufficient_30: true, [col]: null }), `true with only ${col} NULL → nothing (never a 0)`).toBeNull();
    expect(fn({ ...DAY30, sufficient_30: true, [col]: "" }), `true with only ${col} blank → nothing`).toBeNull();
  }
  for (const edge of ["cohort_from", "cohort_to"] as const) {
    expect(fn({ ...DAY30, sufficient_30: true, [edge]: null }), `no ${edge} to print → nothing`).toBeNull();
    expect(fn({ ...DAY30, sufficient_30: true, [edge]: "" }), `empty ${edge} → nothing`).toBeNull();
  }
}

describe("a role still up at the cap is a share, not a verdict — the gate", () => {
  it("day30Reading renders on sufficient_30 === true and on nothing else", () => {
    assertDay30Gate(day30Reading);
  });

  it("coerces numeric strings at the boundary and carries the row's cohort edges through untouched", () => {
    const r = day30Reading({
      sufficient_30: true, still_open_30: "0.41", still_open_30_lo: "0.35", still_open_30_hi: "0.47",
      taken_down_30: "0.44", relist_rate_30: "0.15", n_at_risk_30: "312", cohort_from: "2026-08-07", cohort_to: "2026-08-11",
    });
    expect(r).toEqual({ pct: 41, lo: 35, hi: 47, hw: 6, r: 44, x: 15, n: 312, cohortFrom: "2026-08-07", cohortTo: "2026-08-11" });
  });

  it("day30ColumnPresent is true only when some row carries the RPC's finding as a boolean", () => {
    expect(day30ColumnPresent(OLD_RPC as Parameters<typeof day30ColumnPresent>[0])).toBe(false);
    expect(day30ColumnPresent([{ sufficient_30: null }])).toBe(false);
    expect(day30ColumnPresent(NONE_SUFFICIENT)).toBe(true);
    expect(day30ColumnPresent(MIXED as Parameters<typeof day30ColumnPresent>[0])).toBe(true);
  });

  it("TEETH: a mutant that renders whenever the numbers are present is rejected", () => {
    // The exact defect the gate exists to stop: a windowed board reads 1.0 by
    // construction, and the RPC's false/NULL is the only thing that says so.
    const mutantOnNumbers: Fn = (row) => {
      const s = Number(row.still_open_30);
      if (!Number.isFinite(s)) return null;
      return { pct: Math.round(s * 100), lo: 0, hi: 0, hw: 0, r: 0, x: 0, n: 0, cohortFrom: String(row.cohort_from), cohortTo: String(row.cohort_to) };
    };
    expect(() => assertDay30Gate(mutantOnNumbers)).toThrow();
    // A mutant that treats NULL as "not false" — `sufficient_30 !== false`.
    const mutantNotFalse: Fn = (row) => (row.sufficient_30 === false ? null : day30Reading({ ...row, sufficient_30: true }));
    expect(() => assertDay30Gate(mutantNotFalse)).toThrow();
    // A mutant that prints a 0 for a NULL number.
    const mutantZero: Fn = (row) => (row.sufficient_30 === true
      ? { pct: Math.round(Number(row.still_open_30 ?? 0) * 100), lo: 0, hi: 0, hw: 0, r: 0, x: 0, n: 0, cohortFrom: String(row.cohort_from), cohortTo: String(row.cohort_to) }
      : null);
    expect(() => assertDay30Gate(mutantZero)).toThrow();
    // A `?? 0` on ONE column, with the real gate on every other: the defect
    // the all-NULL case cannot see.
    for (const col of ["still_open_30", "still_open_30_lo", "still_open_30_hi", "taken_down_30", "relist_rate_30", "n_at_risk_30"] as const) {
      const mutantOneZero: Fn = (row) => day30Reading({ ...row, [col]: row[col] ?? 0 });
      expect(() => assertDay30Gate(mutantOneZero), `a \`?? 0\` on ${col} alone must be rejected`).toThrow();
    }
  });
});

// ── the render path, in comment-stripped source ─────────────────────────────
describe("a role still up at the cap is a share, not a verdict — the page's code", () => {
  it("the gate is the boolean true, in code", () => {
    expect(PAGE).toMatch(/if \(row\.sufficient_30 !== true\) return null;/);
  });

  it("the day-30 line is drawn through day30Reading and nothing else", () => {
    expect(PAGE).toMatch(/day30Reading\(r\)/);
    const i = PAGE.indexOf('"ghostIndex.stillUp30Row"');
    expect(i, "the day-30 line moved — re-anchor").toBeGreaterThan(-1);
    expect(PAGE.slice(i - 400, i), "the line must sit inside a `d &&` branch").toMatch(/\{d && \(/);
    // No other JSX reads the raw day-30 columns.
    for (const col of ["still_open_30", "still_open_30_lo", "still_open_30_hi", "taken_down_30", "relist_rate_30", "n_at_risk_30", "cohort_from", "cohort_to"]) {
      const reads = (PAGE.match(new RegExp(`\\b${col}\\b`, "g")) ?? []).length;
      const inGate = (PAGE.slice(PAGE.indexOf("export const day30Reading"), PAGE.indexOf("export const day30ColumnPresent")).match(new RegExp(`\\b${col}\\b`, "g")) ?? []).length;
      const inType = (PAGE.slice(PAGE.indexOf("interface FillCurveRow"), PAGE.indexOf("export interface Day30Reading")).match(new RegExp(`\\b${col}\\b`, "g")) ?? []).length;
      expect(reads - inGate - inType, `${col} is read outside the type and the gate`).toBe(0);
    }
  });

  it("the cohort edges are printed from the row — the day-30 path carries no date literal", () => {
    expect(PAGE).toMatch(/cohortFrom: d\.cohortFrom, cohortTo: d\.cohortTo/);
    // Scoped to the gate and the line it feeds: the methodology prose
    // elsewhere on the page dates its own measurements, which is right.
    const gate = PAGE.slice(PAGE.indexOf("export const day30Reading"), PAGE.indexOf("export const day30ColumnPresent"));
    expect(gate.length).toBeGreaterThan(200);
    expect(gate, "a typed cohort date in the gate goes stale by itself; the floor retires itself").not.toMatch(/20\d\d-\d\d-\d\d/);
    const i = PAGE.indexOf('"ghostIndex.stillUp30Row"');
    expect(PAGE.slice(i - 800, i + 800), "the row line prints the row's edges, never a typed date").not.toMatch(/20\d\d-\d\d-\d\d/);
    const u = PAGE.indexOf('"ghostIndex.stillUp30Unread"');
    expect(PAGE.slice(u - 800, u + 800)).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it("the unread sentence is gated on the column being present, and the tile on a field publishing", () => {
    expect(PAGE).toMatch(/day30ColumnPresent\(fillCurve\)\s*\?/);
    expect(PAGE).toMatch(/\{day30Unread\.length > 0 && \(/);
    expect(PAGE).toMatch(/\{anyDay30\s*\?\s*t\("ghostIndex\.capTileWithReading"/);
  });

  it("the cap's methodology names both bounds and says the identity holds before rounding, not after", () => {
    const i = PAGE.indexOf('term: "30-day freshness cap"');
    expect(i).toBeGreaterThan(-1);
    const entry = PAGE.slice(i, PAGE.indexOf("},", i));
    expect(entry).toMatch(/taken down for good \(a ceiling/);
    expect(entry).toMatch(/re-listed \(a floor\)/);
    expect(entry).toMatch(/sum to one before each is rounded to the nearest point/);
    expect(entry, "three independently rounded percents need not sum to 100").not.toMatch(/the three summing to one/);
  });

  it("no day-30 placeholder exists to render: no dash or n/a beside the day-30 keys", () => {
    const i = PAGE.indexOf('"ghostIndex.stillUp30Row"');
    const around = PAGE.slice(i - 600, i + 600);
    expect(around).not.toMatch(/n\/a|"—"|'—'/);
  });
});

// ── the copy, in nine locales and two namespaces ────────────────────────────
const LOCALES = resolve(ROOT, "src/i18n/locales");
const CHANGELOG = resolve(ROOT, "src/i18n/changelog");
const localeFiles = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
const changelogFiles = readdirSync(CHANGELOG).filter((f) => f.endsWith(".json"));
const GI_KEYS = ["stillUp30Row", "stillUp30Unread", "capTileWithReading"];
const NEW_IDS = ["oneRequisitionIsOnePosting", "staleBoardsAreNamed", "stillUpAtThirtyDays", "departmentFilterRemoved"];
const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
const en = JSON.parse(read("src/i18n/locales/en.json")) as { ghostIndex: Record<string, string> };

describe("a role still up at the cap is a share, not a verdict — the copy", () => {
  it("there are nine of each, and the page's keys are the ones the locales carry", () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(9);
    expect(changelogFiles.length).toBeGreaterThanOrEqual(9);
    for (const k of GI_KEYS) expect(PAGE, `the page renders ghostIndex.${k}`).toContain(`"ghostIndex.${k}"`);
  });

  it("the English row sentence keeps the handed structure: share, population, dates, n, ±, R, X as a floor, the boards it counts", () => {
    const s = en.ghostIndex.stillUp30Row;
    expect(placeholders(s)).toEqual(["{{cohortFrom}}", "{{cohortTo}}", "{{field}}", "{{hw}}", "{{n}}", "{{pct}}", "{{r}}", "{{x}}"]);
    expect(s).toMatch(/of dated \{\{field\}\} roles posted \{\{cohortFrom\}\} to \{\{cohortTo\}\}/);
    expect(s).toMatch(/still advertised when they reached our 30-day cap/);
    expect(s, "R(30) is a ceiling (a takedown not yet seen re-listed counts there)").toMatch(/at most \{\{r\}\}% had been taken down for good/);
    expect(s, "X(30) is a floor").toMatch(/at least \{\{x\}\}% re-listed/);
    expect(s).toMatch(/Counted only on boards we read to the end/);
  });

  for (const f of localeFiles) {
    it(`${f} carries every ghostIndex key with every placeholder English has`, () => {
      const d = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")) as { ghostIndex?: Record<string, string> };
      for (const k of GI_KEYS) {
        expect(d.ghostIndex?.[k], `${f} lacks ghostIndex.${k}`).toBeTruthy();
        expect(placeholders(d.ghostIndex![k]), `${f}: ghostIndex.${k} placeholders`).toEqual(placeholders(en.ghostIndex[k]));
        // No "ghost" or "fake" in a sentence that carries a number.
        for (const sentence of d.ghostIndex![k].split(/[.!?।]/)) {
          if (/ghost|fake/i.test(sentence)) expect(sentence, `${f}: ${k} puts the word beside a number`).not.toMatch(/\d/);
        }
      }
    });
  }

  for (const f of changelogFiles) {
    it(`${f} carries the four 2026-09-10 entries with a title and a description, and no "ghost"/"fake" beside a number`, () => {
      const d = JSON.parse(readFileSync(resolve(CHANGELOG, f), "utf8")) as { changelogEntries: Record<string, { title: string; description: string }> };
      for (const id of NEW_IDS) {
        const e = d.changelogEntries[id];
        expect(e, `${f} lacks changelogEntries.${id}`).toBeTruthy();
        expect(e.title.trim().length).toBeGreaterThan(10);
        expect(e.description.trim().length).toBeGreaterThan(80);
        for (const sentence of `${e.title}. ${e.description}`.split(/[.!?।]/)) {
          if (/ghost|fake/i.test(sentence)) expect(sentence, `${f}: ${id} puts the word beside a number`).not.toMatch(/\d/);
        }
      }
      expect(d.changelogEntries.activelyHiringIsBack, `${f} lost activelyHiringIsBack`).toBeTruthy();
    });
  }

  it("changelog.ts lists the four at the top, dated 2026-09-10, with the tags the entries claim", () => {
    expect(changelog.slice(0, 4).map((e) => e.id)).toEqual(NEW_IDS);
    for (const e of changelog.slice(0, 4)) expect(e.date).toBe("2026-09-10");
    const tags = Object.fromEntries(changelog.slice(0, 4).map((e) => [e.id, e.tags]));
    expect(tags).toEqual({
      oneRequisitionIsOnePosting: ["fixed"],
      staleBoardsAreNamed: ["fixed"],
      stillUpAtThirtyDays: ["new"],
      departmentFilterRemoved: ["improved"],
    });
    const back = changelog.find((e) => e.id === "activelyHiringIsBack");
    expect(back, "the activelyHiringIsBack entry was not to be touched").toEqual({ id: "activelyHiringIsBack", date: "2026-09-09", tags: ["improved"] });
  });

  it("the English entries say what each admits", () => {
    const d = JSON.parse(read("src/i18n/changelog/en.json")) as { changelogEntries: Record<string, { title: string; description: string }> };
    const one = d.changelogEntries.oneRequisitionIsOnePosting.description;
    expect(one).toMatch(/counting every copy/);
    expect(one).toMatch(/that is the duplicate leaving, not roles closing/);
    expect(one, "the 703 is measured (200/200 sampled identical); the board-wide share is a range the sweep counts for itself").toMatch(/read on 9 September, listed the same 703 roles twice over/);
    expect(one, "a sample's midpoint is not a measurement").not.toMatch(/\d+\s?% of the board/);
    const stale = d.changelogEntries.staleBoardsAreNamed;
    expect(stale.title).toMatch(/boards the site had stopped serving/);
    expect(stale.description).toMatch(/none of whose postings were still being served/);
    expect(stale.description).toMatch(/counted as their own bucket/);
    expect(stale.description).toMatch(/on 10 September the stalest read as more than two weeks old/);
    expect(stale.description, "the two oldest are catalogued boards the checks fail on, not orphans").toMatch(/still in our catalogue that our checks reach and fail on, not boards we had dropped/);
    for (const refuted of [/naming mistake/, /no longer watch/, /stopped watching/, /two boards were removed/, /has been reset/]) {
      expect(stale.description, `a cause the analysis refuted: ${refuted}`).not.toMatch(refuted);
    }
    const s30 = d.changelogEntries.stillUpAtThirtyDays.description;
    expect(s30).toMatch(/cannot say how long postings stay up beyond that/);
    expect(s30).toMatch(/counted only on boards we read to the end/);
    expect(s30).toMatch(/not proof of anything about the employer/);
    expect(s30, "the entry must not read a closure as a hire").not.toMatch(/\bhired\b/);
    const dept = d.changelogEntries.departmentFilterRemoved.description;
    expect(dept).toMatch(/two in five postings/);
    expect(dept).toMatch(/still work/);
  });
});
