import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { onetForRole, onetNamesRole } from "@/lib/onet-match";
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
  it("the four the register named no longer cite another occupation", () => {
    expect(onetNamesRole("Pilot", "Aircraft Mechanics")).toBe(false);
    expect(onetNamesRole("Dentist", "Dental Hygienists")).toBe(false);
    expect(onetNamesRole("Professor", "Elementary School Teachers")).toBe(false);
    expect(onetNamesRole("Plumber", "Electricians")).toBe(false);
  });

  it("a generic word is not a match, a real one is", () => {
    expect(onetNamesRole("Sales Manager", "Marketing Managers")).toBe(false);
    expect(onetNamesRole("Registered Nurse", "Registered Nurses")).toBe(true);
    expect(onetNamesRole("Data Scientist", "Data Scientists")).toBe(true);
  });

  it("over the shipped tables, every cited occupation shares a non-generic word with its role", () => {
    let cited = 0;
    let withheld = 0;
    for (const role of Object.values(ROLE_PAGES)) {
      const onet = ONET_EXPECTATIONS[role.industry];
      if (!onet) continue;
      if (onetForRole(role.title, onet)) cited++;
      else withheld++;
    }
    expect(cited, "some roles still cite their own occupation").toBeGreaterThan(0);
    expect(withheld, "and the mismatched ones do not").toBeGreaterThan(0);
  });

  it("the React role page and the bake both go through the match", () => {
    expect(codeOf(readFileSync(resolve(__dirname, "../pages/RoleKeywords.tsx"), "utf8"))).toMatch(/onetForRole\(role\.title, ONET_EXPECTATIONS\[role\.industry\]\)/);
    const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    expect(bake).toMatch(/D\.onetForRole\(role\.title, D\.ONET_EXPECTATIONS\[role\.industry\]\)/);
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
