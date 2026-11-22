// @vitest-environment node
/**
 * A ROLE PAGE LINKS ITS FIELD LANDER (SEO audit 2026-11-18, CONTENT-N8).
 *
 * /roles/registered-nurse named its industry and linked the industry page,
 * and never the live healthcare jobs: a reader looking up a role's keywords
 * had no way to the openings for it. Both renderers now link the role's board
 * field, named by the board's own label. seo-bake-crawler-output reads the
 * served bytes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROLE_PAGES } from "@/data/roles";
import { INDUSTRY_TO_CATEGORY } from "@/lib/job-board-categories";
import { codeOf } from "./helpers/strip-comments";

const src = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("a role page", () => {
  it("in the bake, links its field's lander by the board's own label", () => {
    expect(codeOf(src("scripts/prerender-seo.mjs"))).toMatch(/\$\{D\.INDUSTRY_TO_CATEGORY\[role\.industry\] \? `<p class="mb-8 -mt-4"><a href="\/jobs\/field\/\$\{D\.INDUSTRY_TO_CATEGORY\[role\.industry\]\}" class="text-primary font-medium">Live \$\{esc\(D\.BOARD_CATEGORY_LABELS\[D\.INDUSTRY_TO_CATEGORY\[role\.industry\]\]\)\} jobs on the board →<\/a><\/p>` : ""\}/);
  });

  it("in React, prints the same link", () => {
    const tsx = src("src/pages/RoleKeywords.tsx");
    expect(tsx).toMatch(/<Link to=\{`\/jobs\/field\/\$\{INDUSTRY_TO_CATEGORY\[role\.industry\]\}`\} className="text-primary font-medium">/);
    expect(tsx).toMatch(/Live \{BOARD_CATEGORY_LABELS\[INDUSTRY_TO_CATEGORY\[role\.industry\]\]\} jobs on the board →/);
  });

  it("registered nurse is one of the roles that gets the link", () => {
    expect(INDUSTRY_TO_CATEGORY[ROLE_PAGES["registered-nurse"].industry]).toBe("healthcare");
  });
});
