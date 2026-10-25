/**
 * THE KEYWORD BOX NEVER CREDITS A POOLED COUNT TO ONE NAME (R2, R8).
 *
 * The company FilterBar printed "Search {{n}} roles at {{name}}" on every
 * company page: on a board name two hiring systems share it read "Search 45
 * roles at CLEAR - Corporate" (the pooled count of both boards, credited to
 * the first row's employer), and on the federal hub "Search 13,926 roles at
 * USAJOBS" under the heading "Federal openings listed on USAJOBS" — a listing
 * site is not an employer. Each variant now says what the page is.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { FilterBar } from "@/components/jobs/FilterBar";
import { LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";

const value = { q: "", location: "", workMode: "", employmentType: "", freshness: "", category: "", experience: "", statedPayOnly: false, vendor: "", country: "", hideAgencies: false, companyTokens: [] };
const options = { fields: [], seniority: [], systems: [], countries: [] };
const placeholder = () => (document.querySelector("input[placeholder]") as HTMLInputElement | null)?.placeholder ?? "";

function bar(company: Parameters<typeof FilterBar>[0]["company"]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<FilterBar variant="company" value={value as any} onChange={() => {}} options={options} company={company} />);
}

describe("the company keyword box", () => {
  it("on a board name two hiring systems share, names the boards, not an employer", () => {
    bar({ name: "CLEAR - Corporate", openRoles: { value: 45, floor: false, asOf: null }, kind: "collision", token: "clear" });
    expect(placeholder()).toBe("Search 45 roles on boards named “clear”");
    expect(placeholder()).not.toMatch(/CLEAR - Corporate/);
  });

  it("on the federal hub, says the openings are listed on USAJOBS", () => {
    bar({ name: "Federal openings listed on USAJOBS", openRoles: { value: 13926, floor: false, asOf: null }, kind: "usajobs", token: "usajobs" });
    expect(placeholder()).toBe("Search 13,926 federal openings listed on USAJOBS");
    expect(placeholder()).not.toMatch(/roles at USAJOBS/);
  });

  it("positive control: an employer's own page keeps its name", () => {
    bar({ name: "Domino's", openRoles: { value: 120, floor: false, asOf: null }, kind: "employer", token: "dominos" });
    expect(placeholder()).toBe("Search 120 roles at Domino's");
  });

  it.each(LOCALE_FILES)("%s carries both variants' strings", (file) => {
    const fb = readMainLocale(file).filterBar as Record<string, string>;
    for (const k of ["collisionKeywordPlaceholder_one", "collisionKeywordPlaceholder_other", "collisionKeywordPlaceholderNoCount", "usajobsKeywordPlaceholder_one", "usajobsKeywordPlaceholder_other", "usajobsKeywordPlaceholderNoCount"]) {
      expect(typeof fb[k], `${file} filterBar.${k}`).toBe("string");
    }
    expect(fb.collisionKeywordPlaceholder_other).toContain("{{token}}");
  });
});
