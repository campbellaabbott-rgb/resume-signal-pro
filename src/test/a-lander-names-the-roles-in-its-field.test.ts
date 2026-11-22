// @vitest-environment node
/**
 * A LANDER NAMES THE ROLES IN ITS FIELD (SEO audit 2026-11-18, OPP-2 after
 * OPP-6).
 *
 * The field landers printed no role names: 69 of the 85 FIELD_ROLES names
 * appeared nowhere in their bytes, and five roles people search (backend,
 * frontend and full stack engineer, AI engineer, privacy) were missing from
 * the list. The list now has them, and a lander names up to eight of its
 * field's roles, each linked to a baked posting page whose title names it; a
 * name with no such page is left out, so no name stands unlinked and no count
 * is claimed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as seo from "../../scripts/prerender-seo.mjs";
import { FIELD_ROLES } from "@/data/field-roles";

const S = seo as unknown as { landerRoleLinks?: (roles: readonly string[], postings: unknown[], most?: number) => Array<{ role: string; path: string }> };
const P = (path: string, title: string, postedAt = "2026-11-20") => ({ path, title, postedAt });

describe("the roles a lander names", () => {
  it("each linked to the newest baked page whose title names the role as whole words", () => {
    expect(typeof S.landerRoleLinks).toBe("function");
    const links = S.landerRoleLinks!(["registered nurse", "pharmacist", "medical assistant"], [
      P("/jobs/posting/a/1", "Registered Nurse - ICU", "2026-11-18"),
      P("/jobs/posting/a/2", "Registered Nurse (Nights)", "2026-11-20"),
      P("/jobs/posting/a/3", "Pharmacist in Charge"),
      P("/jobs/posting/a/4", "Medical Assistants Supervisor"),
    ]);
    expect(links).toEqual([
      { role: "registered nurse", path: "/jobs/posting/a/2" },
      { role: "pharmacist", path: "/jobs/posting/a/3" },
    ]);
  });

  it("never links two roles to one page, and stops at eight", () => {
    const many = Array.from({ length: 12 }, (_, i) => P(`/p/${i}`, `Role ${i} engineer`));
    const roles = Array.from({ length: 12 }, (_, i) => `role ${i} engineer`);
    expect(S.landerRoleLinks!(roles, many).length).toBe(8);
    expect(S.landerRoleLinks!(["nurse", "registered nurse"], [P("/p/1", "Registered Nurse")])).toEqual([{ role: "nurse", path: "/p/1" }]);
  });

  it("with no baked page to link, names nothing", () => {
    expect(S.landerRoleLinks!(FIELD_ROLES.healthcare, [])).toEqual([]);
  });
});

describe("the role list and the lander", () => {
  it("carries the five searched roles in their fields", () => {
    expect(FIELD_ROLES.engineering).toEqual(expect.arrayContaining(["backend engineer", "frontend engineer", "full stack engineer"]));
    expect(FIELD_ROLES.data_ai).toContain("ai engineer");
    expect(FIELD_ROLES.legal).toContain("privacy analyst");
  });

  it("the bake prints the linked names under Roles in this field", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/const roleLinks = landerRoleLinks\(D\.FIELD_ROLES\[slug\] \?\? \[\], fieldPostings\.get\(slug\) \?\? \[\]\);/);
    expect(src).toMatch(/<h2>Roles in this field<\/h2>/);
  });
});
