/**
 * THREE ALARMS AND ONE SENTENCE HAD ALL DRIFTED FROM THE SYSTEM THEY DESCRIBE.
 *
 * The rotation SLA was computed from a constant 0.95 min per 80-board hop. At
 * 31.5k cold boards that promises a 375-min wrap and a 525-min SLA — while the
 * measured healthy rotation (46 boards/min, the fast-lane incident's own
 * benchmark) takes ~685 min. A HEALTHY rotation breached the SLA structurally;
 * the check sat red and taught people to ignore it. Same disease, same day, as
 * the disk alarm dividing by an 8GB plan on a 12GB disk.
 *
 * And the public copy promised "most feeds re-verified within a few hours"
 * while the measured median stood at 5.6h and P95 at 13.6h — with the inline
 * i18n default in Jobs.tsx still carrying an OLDER, stronger sentence ("every
 * feed ... within a few hours") that en.json had already walked back: two
 * spellings of one claim, drifting independently.
 *
 * The fixes move every one of them onto measurement:
 *  - the wrap writer stamps wrapMin (how long the rotation actually took);
 *  - the SLA anchors on 1.5x the last measured wrap, floored by the formula
 *    (a fast board is still held to expectations) and CEILINGED AT 24H so a
 *    history of slow wraps can never normalize a rotation slower than daily;
 *  - the copy stops naming a number it cannot keep and points at the live
 *    median/P95 published on the Ghost Job Index;
 *  - the claim mirror guards what the new sentence actually promises:
 *    median <= 480 (several passes a day), P95 <= 1440 (never slower than
 *    daily).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const HB = strip(read("supabase/functions/scan-heartbeat/index.ts"));
const BOARD = strip(read("supabase/functions/job-board/index.ts"));
const EN = JSON.parse(read("src/i18n/locales/en.json"));
const JOBS = read("src/pages/Jobs.tsx");

describe("the rotation SLA is anchored on what rotations measurably take", () => {
  it("the wrap writer stamps the measured duration, and never a poisoned one", () => {
    expect(BOARD, "wrapMin is not written — the SLA has no measured basis")
      .toMatch(/wrapMin !== null \? \{ wrapMin \} : \{\}/);
    // The pre-wrap read's error must be CHECKED: this upsert replaces the
    // whole v row, so a silently failed read would delete the measurement and
    // revert the SLA to the fallback with nothing logged (review finding).
    expect(BOARD, "the pre-wrap read discards its error again")
      .toMatch(/prevRotErr/);
    expect(BOARD, "a failed read must be loud").toMatch(/cold_rotation pre-wrap read failed/);
    // And never wrapMin 0: chain hops force past the slice lock, so two
    // chains wrapping within a minute could stamp a zero the reader discards.
    expect(BOARD).toMatch(/rawWrap >= 1 \? rawWrap : null/);
  });

  it("the SLA prefers the measured wrap and keeps both backstops", () => {
    expect(HB, "the measured basis is gone").toMatch(/lastWrapMin \* 1\.5/);
    // Floor: never below the benchmark expectation — one freak-fast wrap must
    // not ratchet the SLA down and alarm on the next normal one. The
    // expectation itself uses the MEASURED 46 boards/min benchmark, not the
    // 0.95-min/hop hope: with the old constant the no-measurement fallback was
    // itself the structurally-red alarm (525-min SLA vs healthy 685-960-min
    // wraps), so a single unstamped wrap rearmed the disease.
    expect(HB).toMatch(/coldBoards \/ 46/);
    expect(HB).toMatch(/Math\.max\(120, Math\.ceil\(expectedWrapMin \* 1\.5\), slaBasis\)/);
    // Ceiling: no history of slow wraps normalizes slower-than-daily.
    expect(HB).toMatch(/Math\.min\(1440,/);
  });

  it("the alert names its basis, so measured and assumed cannot be confused", () => {
    expect(HB).toMatch(/1\.5x the last measured wrap of \$\{lastWrapMin\} min/);
    expect(HB).toMatch(/formula fallback — no measured wrap yet/);
  });
});

describe("the copy and its mirror promise the same thing", () => {
  it("no locale still promises re-verification 'within a few hours'", () => {
    // Median 336 min made the sentence false in every language at once.
    const dir = resolve(__dirname, "../i18n/locales");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const note = JSON.parse(readFileSync(resolve(dir, f), "utf8"))?.jobsPage?.sourceNote ?? "";
      expect(note, `${f} still carries the numeric promise`).not.toMatch(/few hours|wenigen Stunden|pocas horas|quelques heures|paar uur|poucas horas/i);
    }
  });

  it("the served sentence points at the published live figures instead", () => {
    expect(EN.jobsPage.sourceNote).toMatch(/median and 95th-percentile re-check ages are published/);
  });

  it("the inline default matches en.json — one claim, one spelling", () => {
    // The default in code said "every feed ... within a few hours" while
    // en.json had already walked that back: the fallback string was STRONGER
    // than the served one, waiting for any locale gap to publish it.
    expect(JOBS).not.toMatch(/within a few hours/);
    expect(JOBS).toContain("the live median and 95th-percentile re-check ages are published on the Ghost Job Index");
  });

  it("the mirror bounds what the new sentence promises, not the old one", () => {
    expect(HB).toMatch(/CLAIM_MEDIAN_MIN = 480/);
    expect(HB).toMatch(/CLAIM_P95_MIN = 1440/);
    expect(HB, "the median half of the promise is unguarded")
      .toMatch(/f\.p50_min > CLAIM_MEDIAN_MIN/);
  });
});

describe("nine coverage figures from one scan", () => {
  const MIG = read("supabase/migrations/20260827230000_nine_coverage_figures_one_scan.sql");

  it("the scan counts every figure over the SERVING population", () => {
    for (const k of ["salaryFloor", "workMode", "experience", "country", "payBasis", "hasStatedPay", "maxYears", "department"]) {
      expect(MIG, `${k} missing from the scan`).toContain(`'${k}'`);
    }
    expect(MIG).toMatch(/missing_since IS NULL/);
    expect(MIG).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
    expect(MIG, "a public exact scan of the whole table is a free load test")
      .toMatch(/GRANT EXECUTE ON FUNCTION public\.get_filter_coverage\(\) TO service_role/);
  });

  it("the pass calls it first and keeps the old path only as the deploy-window fallback", () => {
    const at = BOARD.indexOf('client.rpc("get_filter_coverage")');
    expect(at, "the pass no longer uses the one-scan RPC").toBeGreaterThan(-1);
    expect(at, "the RPC must be tried BEFORE the four separate counts")
      .toBeLessThan(BOARD.indexOf('one("work_mode", "not.is.null")'));
  });

  it("the disclosure serves live figures, pinned constants only as dated fallback", () => {
    expect(BOARD).toMatch(/liveOr\(cov\.payBasis, MEASURED_COVERAGE\.payBasis\)/);
    expect(BOARD).toMatch(/liveOr\(cov\.department, MEASURED_COVERAGE\.department\)/);
    // vendor stays pinned at 1 — counting a complete column proves a tautology.
    expect(BOARD).toMatch(/out\.vendor = MEASURED_COVERAGE\.vendor/);
  });
});
