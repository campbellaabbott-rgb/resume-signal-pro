// @vitest-environment node
/**
 * THE LLMS COMPANIES LINE COUNTS EMPLOYERS APART FROM AGENCIES (SEO audit
 * 2026-11-18, GEO-9).
 *
 * On 2026-11-18 llms-full.txt said /companies lists "the 490 employers" this
 * site gives a page, while /companies itself said 487 employers, plus the
 * federal listing site and 2 staffing agencies, labelled: the file counted
 * every row and called them all employers. It now takes the count /companies
 * prints and names the others apart, in the same words.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as pages from "../../scripts/prerender-pages.mjs";
import { codeOf } from "./helpers/strip-comments";

const P = pages as unknown as {
  companiesLlmsLine: (o: { site: string; count: unknown; agencies?: number; federal?: boolean }) => string;
  companiesOthersPhrase?: (o?: { agencies?: number; federal?: boolean }) => string;
};
const SITE = "https://resumebooster.work";
const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));

describe("the /companies line in llms-full.txt", () => {
  it("counts the employers, and names the federal site and the agencies apart, labelled", () => {
    const line = P.companiesLlmsLine({ site: SITE, count: 487, agencies: 2, federal: true });
    expect(line).toContain("the 487 employers this site gives a page, plus the federal listing site and 2 staffing agencies, labelled, A–Z");
  });

  it("says one agency in the singular, and nothing extra when there are none", () => {
    expect(P.companiesOthersPhrase!({ agencies: 1 })).toBe(", plus 1 staffing agency, labelled");
    expect(P.companiesLlmsLine({ site: SITE, count: 487 })).toContain("the 487 employers this site gives a page, A–Z");
  });

  it("uses the words /companies prints for the same rows", () => {
    expect(code).toMatch(/\.\.\.\(federalListed \? \["the federal listing site"\] : \[\]\)/);
    expect(code).toMatch(/`\$\{fmt\(agenciesListed\)\} staffing \$\{agenciesListed === 1 \? "agency" : "agencies"\}`/);
  });
});

describe("the bake", () => {
  it("hands the line the employer count and the others /companies counted", () => {
    expect(code).toMatch(/COMPANY_PAGE_COUNT = employersListed;\s*COMPANY_PAGE_OTHERS = \{ agencies: agenciesListed, federal: federalListed \};/);
    expect(code).toMatch(/lines\.push\(companiesLlmsLine\(\{ site: SITE, count: COMPANY_PAGE_COUNT, \.\.\.\(COMPANY_PAGE_OTHERS \?\? \{\}\) \}\)\);/);
    expect(code).toMatch(/const agenciesListed = primaries\.filter\(\(c\) => landerKindOf\(c\.token\) === "agency"\)\.length;/);
  });
});
