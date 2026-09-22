import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A COPY OF THE CATALOGUE DRIFTS THE DAY THE CATALOGUE MOVES.
 *
 * The layoff-filings function writes the mirror of board names the layoff
 * matcher compares against, built from the same catalogue job-board serves
 * (sources.ts) and the same facet second names (employer-aliases.ts). It was
 * written to import both from ../job-board/. The deploy on 2026-09-21 could
 * not: the platform uploads one function's folder (plus _shared), so a
 * ../job-board import does not resolve at bundle time, and the deploy runner
 * answered by COPYING both files into layoff-filings/ as board-sources.ts and
 * board-employer-aliases.ts — plain files, mode 100644, though the comment it
 * wrote calls them symlinks.
 *
 * A copy is correct on the day it is made and wrong the day the original
 * moves. The catalogue moves with every census merge. A stale copy fails
 * silently in both directions: a board added to job-board never enters the
 * mirror (its filings match nothing), and a board removed from job-board keeps
 * its mirror row (the prune only drops what a run did not see, and a stale
 * copy still sees it). Nothing in the pipeline would say so — the matcher
 * would report its counts, the partition would refresh, the reader would
 * answer null rows, all with a straight face.
 *
 * WHAT THIS GUARDS. Both copies are byte-identical to their originals. When
 * this fails, the fix is the copy, never an edit to the copy:
 *
 *   cp supabase/functions/job-board/sources.ts          supabase/functions/layoff-filings/board-sources.ts
 *   cp supabase/functions/job-board/employer-aliases.ts supabase/functions/layoff-filings/board-employer-aliases.ts
 *
 * and mirror-catalogue.ts must keep importing the copies, not ../job-board,
 * or the next deploy forks them again. Buffer equality, not string equality:
 * an encoding difference is a difference.
 */

const ROOT = resolve(__dirname, "../..");
const FN = resolve(ROOT, "supabase/functions");

const PAIRS: Array<[original: string, copy: string]> = [
  ["job-board/sources.ts", "layoff-filings/board-sources.ts"],
  ["job-board/employer-aliases.ts", "layoff-filings/board-employer-aliases.ts"],
];

describe("a copy of the catalogue drifts the day the catalogue moves", () => {
  for (const [original, copy] of PAIRS) {
    it(`${copy} is byte-identical to ${original}`, () => {
      const a = readFileSync(resolve(FN, original));
      const b = readFileSync(resolve(FN, copy));
      expect(
        a.equals(b),
        `${copy} (${b.length} bytes) has drifted from ${original} (${a.length} bytes); ` +
          `run: cp supabase/functions/${original} supabase/functions/${copy}`,
      ).toBe(true);
    });
  }

  it("mirror-catalogue.ts imports the copies, not ../job-board (which the deploy cannot bundle)", () => {
    const src = readFileSync(resolve(FN, "layoff-filings/mirror-catalogue.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/from\s+"\.\/board-sources\.ts"/);
    expect(src).toMatch(/from\s+"\.\/board-employer-aliases\.ts"/);
    expect(src, "a ../job-board import in the function breaks the deploy bundle").not.toMatch(/from\s+"\.\.\/job-board\//);
  });

  it("the copies are files the deploy can upload, not symlinks pointing outside the folder", () => {
    // A symlink to ../job-board would leave the folder the platform uploads;
    // readFileSync follows links, so check the link itself.
    const { lstatSync } = require("node:fs") as typeof import("node:fs");
    for (const [, copy] of PAIRS) {
      expect(lstatSync(resolve(FN, copy)).isSymbolicLink(), `${copy} must be a regular file`).toBe(false);
    }
  });
});
