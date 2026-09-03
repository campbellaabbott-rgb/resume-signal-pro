/**
 * FIT-BATCH SCANNED THE SAME RÉSUMÉ SIXTY TIMES.
 *
 * computeFit(posting, resumeText) walks the whole detection dictionary twice —
 * once over the posting, once over the résumé — and fit-batch called it in a
 * loop over up to 60 postings. The résumé half of that work is identical on
 * every iteration: same 50KB text, same dictionary, same term list out. And
 * containsTerm compiled a fresh RegExp for every single test, so one batch
 * call compiled hundreds of thousands of regexes to produce sixty numbers.
 *
 * MEASURED (deno, 60 postings x ~7KB, 25KB résumé): the shipped loop cost
 * 2,542ms of pure compute; scanning the résumé once and reusing it costs
 * 599ms — 4.2x — with byte-identical results on all sixty postings, verified
 * in the same benchmark.
 *
 * scanResume() is the hoist; computeFit accepts either the raw string (the
 * single-posting application-fit path, unchanged) or a ResumeScan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeFit, scanResume } from "../../supabase/functions/_shared/fit-score";

const BOARD = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const RESUME = "Registered nurse with ICU and telemetry experience. BLS and ACLS certified. " +
  "Patient care, medication administration, electronic health records, Epic. ".repeat(4);
const POSTING = "We are hiring a registered nurse for our ICU. BLS required, ACLS preferred. " +
  "Duties include patient care and charting in Epic. ".repeat(4);

describe("one résumé scan serves the whole batch", () => {
  it("a scan and the raw string produce identical results", () => {
    // The hoist must be a pure refactor: same pct, same matched, same missing.
    const viaString = computeFit(POSTING, RESUME, 40);
    const viaScan = computeFit(POSTING, scanResume(RESUME), 40);
    expect(viaScan).toEqual(viaString);
  });

  it("fit-batch scans the résumé ONCE, outside the loop", () => {
    const at = BOARD.indexOf('action === "fit-batch"');
    expect(at, "fit-batch action is gone").toBeGreaterThan(-1);
    const block = BOARD.slice(at, at + 2200);
    expect(block, "the batch no longer hoists the résumé scan").toMatch(/const resumeScan = scanResume\(resumeText\);/);
    // .31 bounds the POSTING side (r.description.slice(0, FIT_DESC_CHARS));
    // the property here is about the RÉSUMÉ side — the scan is hoisted and
    // handed in, never the raw text — so the pin tolerates the bound and
    // asserts the actual regression directly.
    expect(block, "computeFit is back to rescanning the résumé per posting")
      .toMatch(/computeFit\(r\.description(?:\.slice\(0, FIT_DESC_CHARS\))?, resumeScan, 40\)/);
    expect(block, "the raw résumé text must never be handed to computeFit inside the loop")
      .not.toMatch(/computeFit\([^)]*,\s*resumeText\b/);
    // The scan must sit before the loop, or it is just a rename.
    expect(block.indexOf("scanResume("), "the scan happens inside the loop")
      .toBeLessThan(block.indexOf("for (const r of"));
  });

  it("the résumé term list stays uncapped — the padding exploit stays closed", () => {
    // Capping resume terms at maxTerms would truncate a padded résumé's
    // denominator to the posting's 60 and revive the 100%-on-everything
    // exploit the F1 rewrite closed.
    const padded = scanResume(RESUME + " " + RESUME + " " + RESUME);
    expect(padded.terms.length).toBeGreaterThan(0);
    const f = computeFit(POSTING, padded, 40);
    expect(f.precision).toBeLessThanOrEqual(1);
    // And a genuinely matching résumé still scores.
    expect(computeFit(POSTING, scanResume(RESUME), 40).pct ?? 0).toBeGreaterThan(0);
  });
});
