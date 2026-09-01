import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A DEPLOY COMMITTED THE FUNCTION BACK WITH EVERY COMMENT REMOVED.
 *
 * 2026-09-01: a deploy pipeline wrote job-board/index.ts back to the repo
 * stripped of comments and blank lines — 13,208 lines became 6,720, and 6,270
 * lines of recorded reasoning went with them. Nothing was wrong with the
 * deployed code: both files carry exactly 6,349 lines of it, byte-identical
 * once trailing comments are removed, and the live board never faltered.
 *
 * What broke was the guard system. This codebase deliberately writes its
 * contracts into the source and pins them from tests — a rule that lives only
 * in someone's head is a rule that fails the day they are not looking — so
 * removing the prose removed the contracts. The stripped file failed 27 tests
 * across 12 files, none of which said anything about comments; they said
 * things like "the inherited location contract is no longer stated".
 *
 * This test exists to convert that into one legible failure. If it goes red
 * alongside a scattering of contract guards, the cause is almost certainly a
 * tool that rewrote the file rather than a person who edited it — check the
 * comment count before debugging anything else, and restore from the last
 * commit that has them.
 *
 * The threshold is deliberately far below the real figure. It is a
 * catastrophe detector, not a style rule: nobody should have to think about it
 * while deleting a paragraph that stopped being true.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

describe("a deploy that strips the reasoning", () => {
  it("keeps the recorded reasoning in the serving function", () => {
    const commentLines = FN.split("\n").filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l)).length;
    expect(
      commentLines,
      `job-board/index.ts carries ${commentLines} comment lines. A tool that rewrites ` +
        `this file without them takes the contracts the guard suite pins with it — ` +
        `restore from the last commit that has them rather than re-deriving the rules.`,
    ).toBeGreaterThan(2_000);
  });

  it("keeps the file readable as source, not as a minified artifact", () => {
    // Every blank line vanished in the same rewrite. Alone it is cosmetic;
    // together with the comment count it identifies the cause precisely.
    const blankLines = FN.split("\n").filter((l) => l.trim() === "").length;
    expect(blankLines, "no blank lines at all is a machine's formatting, not a person's").toBeGreaterThan(20);
  });
});
