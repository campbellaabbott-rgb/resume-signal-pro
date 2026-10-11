import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { onetCitesRole, onetForRole, ROLE_ONET_SOC } from "@/lib/onet-match";
import { ROLE_PAGES } from "@/data/roles";
import { ONET_EXPECTATIONS } from "../../supabase/functions/free-keyword-scan/onet-expectations";

/**
 * WHAT WAS WRONG (register L1-05): every role page printed its INDUSTRY's
 * O*NET occupation as "Core skills per the U.S. Department of Labor":
 * /roles/pilot cited 49-3011.00 Aircraft Mechanics, dentist Dental
 * Hygienists, professor Elementary School Teachers, plumber Electricians.
 * 120 of 174 role pages carried a block, citing 40 occupations, about 80 of
 * them someone else's. The intro also called industry-wide lists the data
 * the scanner uses "when it detects a <role> resume".
 */

describe("a role page cites an occupation only when it names the role", () => {
  const cites = (slug: string) => onetForRole(ROLE_PAGES[slug], ONET_EXPECTATIONS[ROLE_PAGES[slug].industry]) !== null;

  it("the four the register named no longer cite another occupation", () => {
    for (const slug of ["pilot", "dentist", "professor", "plumber"]) expect(cites(slug), slug).toBe(false);
  });

  // S11-152: the word-overlap matcher dropped words under three letters, so
  // RN and CPA lost their own occupation, and stemmed "attorney" against
  // "Lawyers"; it matched "engineer" alone, so civil and electrical engineers
  // cited Mechanical Engineers, and "manager" was generic only on one side.
  it("RN, CPA and attorney cite their own occupation; civil and electrical engineers and HR managers cite none", () => {
    for (const slug of ["rn", "cpa", "attorney", "registered-nurse", "lawyer", "data-scientist", "mechanical-engineer"]) expect(cites(slug), slug).toBe(true);
    for (const slug of ["civil-engineer", "electrical-engineer", "human-resources-manager", "sales-manager", "ui-designer", "line-cook", "dental-assistant", "data-analyst"]) expect(cites(slug), slug).toBe(false);
  });

  it("every row of the table names a real role and the code its industry's entry carries", () => {
    expect(ROLE_ONET_SOC.size).toBeGreaterThan(40);
    for (const [slug, code] of ROLE_ONET_SOC) {
      const role = ROLE_PAGES[slug];
      expect(role, `${slug} is not a role page`).toBeDefined();
      expect(ONET_EXPECTATIONS[role.industry]?.code, `${slug} cites ${code}, its industry's entry is another occupation`).toBe(code);
      expect(onetCitesRole(slug, ONET_EXPECTATIONS[role.industry])).toBe(true);
    }
    // a code that is not the entry's cites nothing, even for a listed slug
    expect(onetCitesRole("rn", { code: "29-1171.00" })).toBe(false);
    expect(onetCitesRole("no-such-role", ONET_EXPECTATIONS.healthcare)).toBe(false);
  });

  it("over the shipped tables, cited and withheld pages both exist", () => {
    let cited = 0;
    let withheld = 0;
    for (const role of Object.values(ROLE_PAGES)) {
      const onet = ONET_EXPECTATIONS[role.industry];
      if (!onet) continue;
      if (onetForRole(role, onet)) cited++;
      else withheld++;
    }
    expect(cited, "some roles still cite their own occupation").toBeGreaterThan(0);
    expect(withheld, "and the mismatched ones do not").toBeGreaterThan(0);
  });

  it("the React role page and the bake both go through the table", () => {
    expect(codeOf(readFileSync(resolve(__dirname, "../pages/RoleKeywords.tsx"), "utf8"))).toMatch(/onetForRole\(role, ONET_EXPECTATIONS\[role\.industry\]\)/);
    const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    expect(bake).toMatch(/D\.onetForRole\(role, D\.ONET_EXPECTATIONS\[role\.industry\]\)/);
    expect(bake, "the intro no longer calls the field's lists the role's").not.toMatch(/when it detects a \$\{esc\(role\.title/);
  });
});

describe("a role page's headings say the lists are its field's, as its intro does", () => {
  // Reviewer, 2026-10-10: only the bake's intro was rewritten. The headings
  // under it ("Keywords ATS systems expect on a pilot resume",
  // "Certifications that anchor a pilot resume") and the React intro ("the
  // live data our resume scanner uses when it detects a pilot resume")
  // still presented the industry list as written for the title, so the baked
  // and rendered text contradicted each other on 174 role pages.
  it("the React page for /roles/pilot names the field's tables in its intro and both headings", async () => {
    const { render } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { MemoryRouter, Routes, Route } = await import("react-router-dom");
    const { HelmetProvider } = await import("react-helmet-async");
    const { default: RoleKeywords } = await import("@/pages/RoleKeywords");
    const { container } = render(
      createElement(HelmetProvider, null,
        createElement(MemoryRouter, { initialEntries: ["/roles/pilot"] },
          createElement(Routes, null, createElement(Route, { path: "/roles/:slug", element: createElement(RoleKeywords) })))),
    );
    const role = ROLE_PAGES.pilot;
    const h2 = [...container.querySelectorAll("h2")].map((h) => h.textContent ?? "");
    const text = container.textContent ?? "";
    expect(h2.some((h) => /^Keywords from the .+ tables$/.test(h)), h2.join(" | ")).toBe(true);
    for (const h of h2) expect(h, "no heading presents the field's list as written for the title").not.toMatch(new RegExp(`on a ${role.title.toLowerCase()} resume`, "i"));
    expect(text).not.toMatch(/when it detects a pilot resume/);
    expect(text).toContain("They are the field's lists, not a list written for this one title.");
  }, 30_000);

  it("the bake prints the same intro and headings from the same function", () => {
    const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    expect(bake).toMatch(/const copy = D\.roleListCopy\(role\.title, indName\);/);
    expect(bake).toMatch(/\$\{esc\(copy\.keywordsHeading\)\}/);
    expect(bake).toMatch(/\$\{esc\(copy\.certsHeading\)\}/);
    expect(bake).toMatch(/\$\{esc\(copy\.intro\)\}/);
  });
});
