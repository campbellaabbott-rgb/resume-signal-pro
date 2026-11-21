// @vitest-environment node
/**
 * EVERY DATA PAGE SHOWS THE BREADCRUMB IT MARKS UP (SEO audit 2026-11-18,
 * STRUCTURED-B12).
 *
 * The guides, the landers and the posting pages carry a visible trail and a
 * BreadcrumbList; the four data pages (/ghost-job-index, /entry-level-index,
 * /hiring-trends, /pay-transparency) and /companies carried neither, so a
 * results page showed their bare address and the site's hierarchy stopped at
 * them. Each now prints Home / its name and marks up the same two steps, from
 * one pair of helpers, so the markup describes a trail a person sees.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
const PAGES: Array<[string, string]> = [
  ["/companies", "Companies"],
  ["/ghost-job-index", "Ghost Job Index"],
  ["/entry-level-index", "Entry-Level Index"],
  ["/hiring-trends", "Weekly Hiring Trends"],
  ["/pay-transparency", "Pay Transparency Index"],
];
/** The write({ ... }) call for a page, up to the next write(. */
const writeOf = (path: string) => {
  const at = code.indexOf(`path: "${path}",`);
  expect(at, path).toBeGreaterThan(-1);
  const end = code.indexOf("write({", at);
  return code.slice(at, end === -1 ? at + 8000 : end);
};

describe("the two helpers", () => {
  it("print Home / name and mark up Home > name from the same two steps", () => {
    expect(code).toMatch(/const dataPageCrumbs = \(name\) => breadcrumbNav\(\[\{ name: "Home", href: "\/" \}, \{ name \}\]\);/);
    expect(code).toMatch(/const dataPageCrumbsLd = \(name, path\) => breadcrumbLd\(\[\{ name: "Home", path: "\/" \}, \{ name, path \}\]\);/);
  });
});

describe.each(PAGES)("%s", (path, name) => {
  it(`shows "Home / ${name}" above its heading`, () => {
    const w = writeOf(path);
    const crumb = w.indexOf(`\${dataPageCrumbs("${name}")}`);
    expect(crumb, path).toBeGreaterThan(-1);
    expect(crumb).toBeLessThan(w.indexOf("<h1"));
  });

  it("marks up the same trail, ending at its own address", () => {
    expect(writeOf(path)).toContain(`dataPageCrumbsLd("${name}", "${path}")`);
  });
});
