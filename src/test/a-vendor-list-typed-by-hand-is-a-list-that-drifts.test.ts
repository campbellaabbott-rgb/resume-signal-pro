import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_BOARD_SOURCES,
  SERVING_SOURCES,
  SERVING_SOURCE_KEYS,
  SERVING_SOURCE_LIST,
  DORMANT_SOURCES,
  servingSourceSummary,
  BOARD_SOURCE_LIST,
} from "../config/ats-vendors";

/**
 * A VENDOR LIST TYPED BY HAND IS A LIST THAT DRIFTS.
 *
 * WHAT HAPPENED. The board reads nineteen hiring systems. On 2026-09-22 the
 * public surfaces named, respectively: six of them (the prerendered Ghost Job
 * Index), twelve (the prerendered Entry-Level Index), fourteen (the field and
 * employer landers), fifteen (the Ghost Job Index page), "Greenhouse, Lever,
 * Ashby and 8 more" (the same page's audit note, written when the board read
 * eleven), and nineteen plus one that serves nothing (the Entry-Level Index
 * page). Six copies of one fact, five of them wrong, every one of them a
 * sentence about where a reader's job came from.
 *
 * The twentieth entry is the other half of the same defect. USAJOBS is carried
 * in the config, offered in the board's vendor menu, and named in public
 * source copy -- and the board serves ZERO rows from it, because its secrets
 * are not set. Measured 2026-09-23 against the board's own per-source facet
 * and its date-coverage rollup: both return nineteen sources, and usajobs is
 * in neither. A reader who filtered to it got an empty page.
 *
 * THE PROPERTY, in three parts:
 *   1. No surface in the lane below spells a board-source list out. The names
 *      come from src/config/ats-vendors.ts or they do not appear.
 *   2. A source the board serves nothing from is marked in the config and
 *      filtered out of every public list -- and the entry survives, because
 *      it comes back the day its secrets land.
 *   3. Anything that COUNTS the list ("and N more") computes N from the list.
 *
 * TEETH. Each part is shown failing: the pre-fix sentences are rebuilt from
 * the current config and must be reported; a config with the dormancy marker
 * removed must put the dormant source back into public copy; and the summary
 * helper's tail must move when the list does.
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Comment-stripped, and this is load-bearing.
 *
 * Every file in the lane carries a comment explaining which list it used to
 * spell out, and those comments necessarily name platforms. A scanner reading
 * them would report the fix as the defect -- the false positive this repo has
 * shipped seven times. JSX comment braces are stripped before the block
 * comment inside them, or the closing brace survives as code.
 */
const code = (s: string) =>
  s
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\s*\/\/[^\n]*/gm, " ");

/**
 * The surfaces this guard owns: the prerendered documents non-JS readers get,
 * and the four React pages behind them.
 *
 * NOT the whole repo, deliberately and with each gap named rather than hidden.
 * The wiring pass added src/pages/DataApi.tsx, whose dataset bullet used to
 * spell five systems out and end in "and more" and now interpolates the
 * computed summary. What is still OUT, and exactly why:
 *
 *   - scripts/update-vendor-copy-rung3.mjs is a SPENT one-shot codemod. Its
 *     constants are the before-and-after text of an edit that landed long ago,
 *     against locale strings that now interpolate, so it can no longer match
 *     anything. "Pointing it at the config" is meaningless for a find-and-
 *     replace over text that is gone; the honest follow-up is to delete it,
 *     which belongs to whoever owns that script, not to this guard.
 *   - src/i18n/changelog/*.json is excluded on a different ground entirely: a
 *     changelog entry records what was true on the day it shipped and must NOT
 *     be rewritten when the list grows.
 *
 * A guard that fails on work nobody has scheduled gets disabled, and a
 * disabled guard protects nothing — so the exclusions stay written down here
 * rather than being quietly loosened into the regex.
 */
const LANE = [
  "scripts/prerender-seo.mjs",
  "src/pages/GhostJobIndex.tsx",
  "src/pages/EntryLevelIndex.tsx",
  "src/pages/HiringTrends.tsx",
  "src/pages/PayTransparencyIndex.tsx",
  "src/pages/DataApi.tsx",
  // THE BUSIEST PAGE ON THE SITE, and it was excluded on a claim the repo
  // contradicts. The note here said jobsPage.seoDescription named ten systems
  // and that fixing it cost nine translations — but all nine locale files
  // already carried a seoDescription naming NO platform, and a locale value
  // overrides an inline default, so the ten names lived only in a default
  // nothing rendered. The exclusion bought nothing and left the whole page
  // outside the check: handTypedRuns fires at five names, so a ten-name run
  // re-typed anywhere in this file would have shipped to every visitor with
  // the suite green. The default was cut (one line, no locale change) and the
  // file is in the lane.
  "src/pages/Jobs.tsx",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A run of platform names joined by list punctuation.
 *
 * FIVE, not three, and the reason is a real neighbouring list rather than
 * timidity: the resume scanner advertises the four ATS PARSERS it emulates
 * ("Workday, Greenhouse, Lever, iCIMS"), which is a different fact about a
 * different thing and has its own home. A board-source list is fifteen to
 * nineteen names, so five separates them cleanly. The complementary check
 * below closes the gap the threshold leaves: wherever a sentence in the lane
 * introduces the board's sources at all, it must interpolate.
 */
const RUN_MIN = 5;
function handTypedRuns(source: string): string[] {
  const alt = ALL_BOARD_SOURCES.map((v) => escapeRe(v.label))
    .sort((a, b) => b.length - a.length)
    .join("|");
  const re = new RegExp(`(?:${alt})(?:(?:,\\s+|\\s+and\\s+|\\s+or\\s+)(?:${alt})){${RUN_MIN - 1},}`, "g");
  return code(source).match(re) ?? [];
}

/**
 * Every place a sentence says the postings come from the employers' own
 * systems, with what follows it -- the sentence that must interpolate.
 *
 * TAGS ARE STRIPPED FIRST. The phrase is broken across markup on both React
 * pages ("official</b> job boards (...)") and across a line break in the
 * prerender's template literals, so a regex over the raw text matched neither
 * and this check was silently vacuous on the two files it matters most for --
 * the same shape of hole as a guard that pins a spelling over dead code.
 */
function sourceIntroductions(source: string): string[] {
  const flat = code(source).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const re = /official job boards? \(([^)]{0,220})\)/g;
  return [...flat.matchAll(re)].map((m) => m[1]);
}

describe("a vendor list typed by hand is a list that drifts", () => {
  it.each(LANE)("%s spells no board-source list out", (file) => {
    expect(handTypedRuns(read(file)), `${file} carries a hand-typed platform run`).toEqual([]);
  });

  it.each(LANE)("%s introduces the board's sources by interpolation, never by name", (file) => {
    for (const inside of sourceIntroductions(read(file))) {
      const interpolated = inside.includes("SERVING_SOURCE_LIST") || inside.includes("BOARD_SOURCE_LIST");
      expect(interpolated, `${file}: "(${inside.slice(0, 80)})" names platforms instead of interpolating`).toBe(true);
    }
  });

  it("the lane really does introduce the sources somewhere (the guard is not vacuous)", () => {
    const total = LANE.reduce((n, f) => n + sourceIntroductions(read(f)).length, 0);
    expect(total, "no source-introducing sentence found at all -- re-anchor this guard").toBeGreaterThanOrEqual(3);
  });

  it("the derived list names every serving source and nothing else", () => {
    for (const v of SERVING_SOURCES) expect(SERVING_SOURCE_LIST, `${v.label} missing`).toContain(v.label);
    for (const v of DORMANT_SOURCES) expect(SERVING_SOURCE_LIST, `${v.label} is dormant and still listed`).not.toContain(v.label);
    expect(SERVING_SOURCE_LIST.split(", ")).toHaveLength(SERVING_SOURCES.length);
  });
});

describe("a source serving nothing is marked, not quietly named", () => {
  /**
   * The sources the board actually had rows for, measured 2026-09-23 with the
   * anon key against two independent reads that agreed exactly: the facet
   * payload's per-source map (get_job_board_facets -> sourcesFacet) and the
   * 15-minute rollup's date-coverage rows (get_date_coverage). Nineteen keys,
   * no usajobs.
   *
   * RE-MEASURE THIS WHEN A VENDOR IS ADDED OR A DORMANT ONE WAKES UP -- the
   * point of the fixture is that adding a config entry does not by itself
   * entitle it to appear in public copy. A vendor with no rows is a menu entry
   * that filters to an empty page.
   */
  const MEASURED_WITH_ROWS_2026_09_23 = [
    "workday", "oracle", "smartrecruiters", "icims", "greenhouse", "paylocity", "ukg",
    "workable", "ashby", "breezy", "teamtailor", "adp", "bamboohr", "lever", "recruitee",
    "personio", "rippling", "pinpoint", "jazzhr",
  ];

  it("the config's serving set is the set the board measured", () => {
    expect([...SERVING_SOURCE_KEYS].sort()).toEqual([...MEASURED_WITH_ROWS_2026_09_23].sort());
  });

  it("the dormant source keeps its entry, its label and its standing", () => {
    expect(DORMANT_SOURCES.length, "nothing is marked dormant -- the marker has gone").toBeGreaterThan(0);
    for (const d of DORMANT_SOURCES) {
      expect(ALL_BOARD_SOURCES.map((v) => v.key), `${d.key} was deleted rather than marked`).toContain(d.key);
      expect(d.label.length, `${d.key} lost its label`).toBeGreaterThan(0);
      expect(MEASURED_WITH_ROWS_2026_09_23, `${d.key} is marked dormant but the board has rows for it`).not.toContain(d.key);
    }
  });

  it("the dormant source is absent from the list public copy interpolates", () => {
    const dormantLabels = DORMANT_SOURCES.map((v) => v.label);
    for (const label of dormantLabels) expect(SERVING_SOURCE_LIST).not.toContain(label);
    // And the prerendered documents are built from that list, so they cannot
    // name it either. (The lane files are checked above for hand-typed runs,
    // so a name reaching a page can only have come through the list.)
    for (const file of LANE) {
      for (const label of dormantLabels) {
        expect(code(read(file)), `${file} names a dormant source directly`).not.toContain(label);
      }
    }
  });

  it("the internal list still holds it, so nothing else loses the entry", () => {
    // BOARD_SOURCE_LIST answers a different question -- what do we hold an
    // entry for -- and other guards key on it. Narrowing it here would have
    // been the easy change and the wrong one.
    for (const v of ALL_BOARD_SOURCES) expect(BOARD_SOURCE_LIST).toContain(v.label);
  });
});

describe("a vendor list typed by hand is a list that drifts -- has teeth", () => {
  it("reports each of the six lists this change deleted, rebuilt from the config", () => {
    const L = Object.fromEntries(ALL_BOARD_SOURCES.map((v) => [v.key, v.label]));
    const preFix = [
      // the prerendered Ghost Job Index: six
      `official job boards (${[L.greenhouse, L.lever, L.ashby, L.smartrecruiters, L.workable, L.bamboohr].join(", ")})`,
      // the prerendered Entry-Level Index: twelve
      `official job boards (${[L.greenhouse, L.lever, L.ashby, L.smartrecruiters, L.workable, L.bamboohr, L.recruitee, L.teamtailor, L.personio, L.breezy, L.rippling, L.workday].join(", ")})`,
      // the field and employer landers: fourteen
      `publish on ${[L.greenhouse, L.workday, L.lever, L.ashby, L.smartrecruiters, L.oracle, L.workable, L.bamboohr, L.recruitee, L.teamtailor, L.personio, L.breezy, L.rippling, L.pinpoint].join(", ")}`,
      // the Ghost Job Index page: fifteen
      `official job boards (${[L.greenhouse, L.lever, L.ashby, L.smartrecruiters, L.workable, L.bamboohr, L.recruitee, L.teamtailor, L.personio, L.breezy, L.rippling, L.workday, L.icims, L.oracle, L.pinpoint].join(", ")})`,
      // the Entry-Level Index page: nineteen and the dormant one
      `official job boards (${ALL_BOARD_SOURCES.map((v) => v.label).join(", ")})`,
    ];
    for (const sentence of preFix) {
      expect(handTypedRuns(sentence).length, `not reported: ${sentence.slice(0, 60)}`).toBeGreaterThan(0);
    }
    // And the interpolation check reports the parenthetical form specifically.
    for (const sentence of preFix.filter((s) => s.includes("("))) {
      const inside = sourceIntroductions(sentence);
      expect(inside.length).toBeGreaterThan(0);
      expect(inside[0].includes("SERVING_SOURCE_LIST")).toBe(false);
    }
  });

  it("does not report the four-name ATS PARSER list, which is a different fact", () => {
    // The scanner emulates four vendors' parsers; that sentence is about the
    // resume checker, not about where postings come from, and must survive.
    const parserCopy = "per-vendor parsing checks for Workday, Greenhouse, Lever, and iCIMS";
    expect(handTypedRuns(parserCopy)).toEqual([]);
  });

  it("does not report a comment that explains which list it replaced", () => {
    const withComment = `
      // It named Workday, Greenhouse, SmartRecruiters, Ashby, iCIMS, Oracle and Lever by hand.
      /* and so did this: Workday, Greenhouse, SmartRecruiters, Ashby, iCIMS, Oracle, Lever */
      const line = \`official job boards (\${SERVING_SOURCE_LIST})\`;
    `;
    expect(handTypedRuns(withComment)).toEqual([]);
    expect(sourceIntroductions(withComment)[0]).toContain("SERVING_SOURCE_LIST");
  });

  it("a config with the marker removed puts the dormant source straight back into public copy", () => {
    // The fix is one field. This is what happens without it.
    const unmarked = ALL_BOARD_SOURCES.map((v) => ({ key: v.key, label: v.label }));
    const listWithoutMarker = unmarked.filter((v) => (v as { serving?: false }).serving !== false).map((v) => v.label).join(", ");
    for (const d of DORMANT_SOURCES) {
      expect(listWithoutMarker, `${d.label} should reappear once the marker is gone`).toContain(d.label);
      expect(SERVING_SOURCE_LIST).not.toContain(d.label);
    }
  });

  it("the 'and N more' tail is computed, so it cannot freeze the way it did", () => {
    const summary = servingSourceSummary(3);
    const tail = /and (\d+) more$/.exec(summary);
    expect(tail, `summary does not end in a computed tail: ${summary}`).toBeTruthy();
    expect(Number(tail![1])).toBe(SERVING_SOURCES.length - 3);
    // The frozen literal it replaced: written at eleven vendors, still on the
    // page at nineteen.
    expect(Number(tail![1]), "the tail has drifted back to the frozen value").not.toBe(8);
    // Lead length is honoured, and a lead as long as the list prints no tail.
    expect(servingSourceSummary(2).startsWith(SERVING_SOURCES[0].label)).toBe(true);
    expect(servingSourceSummary(SERVING_SOURCES.length)).toBe(SERVING_SOURCE_LIST);
  });
});
