// @vitest-environment node
/**
 * THE LLMS FILES PROMISE ONLY SECTIONS THE GHOST PAGE SERVES (SEO audit
 * 2026-11-18, GEO-4).
 *
 * llms.txt and llms-full.txt told an answer engine the Ghost Job Index shows
 * "how long postings stay up" and "which employers are actively hiring". The
 * page a crawler is served prints neither (the leaderboard is drawn after the
 * page loads), so an engine that trusted the file promised a reader a section
 * that is not there. Each clause the files say is now tied to the H2 the
 * baked page prints for it, and the bake warns when a section goes missing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as seo from "../../scripts/prerender-seo.mjs";
import { codeOf } from "./helpers/strip-comments";

const S = seo as unknown as {
  GHOST_LLMS_SECTIONS?: ReadonlyArray<{ clause: string; h2: string }>;
  GHOST_LLMS_CLAUSE?: string;
  ghostSectionsMissing?: (html: string) => string[];
};
const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
const code = codeOf(src);
const builder = src.slice(src.indexOf("// >>> DATA-PAGE FIGURE BUILDER START"), src.indexOf("// <<< DATA-PAGE FIGURE BUILDER END"));

describe("what the llms files say the Ghost Job Index shows", () => {
  it("names only sections whose H2 the baked page's builder prints", () => {
    expect(S.GHOST_LLMS_SECTIONS?.length).toBeGreaterThanOrEqual(2);
    for (const x of S.GHOST_LLMS_SECTIONS!) expect(builder, x.h2).toContain(`group("${x.h2}"`);
  });

  it("says nothing of how long postings stay up or who is actively hiring", () => {
    expect(S.GHOST_LLMS_CLAUSE).not.toMatch(/how long postings stay up|actively hiring/);
    for (const x of S.GHOST_LLMS_SECTIONS!) expect(S.GHOST_LLMS_CLAUSE).toContain(x.clause);
  });

  it("is the clause both files print", () => {
    expect(code).toMatch(/- Ghost Job Index: \$\{SITE\}\/ghost-job-index — the board's live measure of posting reality: \$\{GHOST_LLMS_CLAUSE\},/);
    expect(code).toMatch(/sub\(\/how many roles are open, how long postings stay up, how fast they come down, and which employers are actively hiring\/, GHOST_LLMS_CLAUSE\)/);
  });
});

describe("a section the page stops printing", () => {
  it("is named, and the bake says so at the WARN tier", () => {
    const all = S.GHOST_LLMS_SECTIONS!.map((x) => `<h2 class="x">${x.h2}</h2>`).join("");
    expect(S.ghostSectionsMissing!(all)).toEqual([]);
    const without = all.replace(`>${S.GHOST_LLMS_SECTIONS![1].h2}</h2>`, "></h2>");
    expect(S.ghostSectionsMissing!(without)).toEqual([S.GHOST_LLMS_SECTIONS![1].h2]);
    expect(code).toMatch(/const missing = ghostSectionsMissing\(DATA_FIGURES\.ghost\.html\);\s*if \(missing\.length\) console\.warn\(`\[prerender-seo\] WARN /);
  });
});
