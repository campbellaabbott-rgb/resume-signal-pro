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
