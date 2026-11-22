// @vitest-environment node
/**
 * A GUIDE DATES ITS MARKUP THE DAY ITS PAGE PRINTS (SEO audit 2026-11-18,
 * STRUCTURED-B10).
 *
 * Each guide prints "Updated <day>" from its own committed date, while its
 * Article markup took the sitemap's lastmod, which moves whenever the page's
 * shell changes: on 2026-11-18 all nine guides printed one day and stated
 * another in dateModified. The markup now states the printed day. The sitemap
 * keeps the day the page last changed, which may be later and never earlier.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GUIDES } from "@/data/guides";
import { codeOf } from "./helpers/strip-comments";

const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
const guideLoop = code.slice(code.indexOf("for (const g of guides) {"), code.indexOf("for (const g of guides) {") + 4000);

describe("a guide's Article", () => {
  it("states the guide's own updated day, the one its page prints, as dateModified", () => {
    const ld = guideLoop.slice(guideLoop.indexOf("const jsonLd"), guideLoop.indexOf("write({"));
    expect(ld).toMatch(/"@type": "Article"/);
    expect(ld).toMatch(/dateModified: g\.updated,/);
    expect(ld).not.toMatch(/dateModified: lastmod/);
  });

  it("is on a page that prints that same day beside Updated", () => {
    const content = guideLoop.slice(guideLoop.indexOf("write({"));
    expect(content).toMatch(/· Updated \$\{g\.updated\}/);
  });

  it("every guide's updated day is a real day no earlier than its first publish", () => {
    for (const g of Object.values(GUIDES)) {
      expect(g.updated, g.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${g.updated}T00:00:00Z`)), g.slug).toBe(false);
      expect(g.updated >= g.published, g.slug).toBe(true);
    }
  });
});
