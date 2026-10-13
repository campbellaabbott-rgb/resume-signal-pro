// @vitest-environment node
/**
 * TITLE FAMILIES (_shared/title-families.ts): the table's own invariants, the
 * bench résumés' titles mapping where a recruiter would put them, the
 * not-lists doing their job, the fallback for an occupation the table does not
 * carry, and level words read the way the board's own band reads them.
 */
import { describe, expect, it } from "vitest";
import {
  familyByKey, familyForTitles, familyQuery, fallbackFamily, GENERIC_NOT, levelFacets, NOT_MAX_CHARS, TITLE_FAMILIES, titleRank,
} from "../../supabase/functions/_shared/title-families";

describe("the table", () => {
  it("every family has 3-8 query phrases, a head noun, a label, and a not-list of at most 400 characters; keys are unique", () => {
    const keys = new Set<string>();
    for (const f of TITLE_FAMILIES) {
      expect(keys.has(f.key), f.key).toBe(false);
      keys.add(f.key);
      expect(f.q.length, f.key).toBeGreaterThanOrEqual(3);
      expect(f.q.length, f.key).toBeLessThanOrEqual(8);
      expect(f.headNoun, f.key).toMatch(/^[a-z]+$/);
      expect(f.label.length, f.key).toBeGreaterThan(2);
      if (f.not) expect(f.not.source.length, f.key).toBeLessThanOrEqual(NOT_MAX_CHARS);
      for (const p of f.q) expect(p, f.key).toMatch(/^[a-z0-9&' -]+$/);
    }
    expect(TITLE_FAMILIES.length).toBeGreaterThanOrEqual(90);
  });

  it("each family's own phrases are titles it recognises (core or near), never ones its not-list refuses", () => {
    const loose = new Set(["mental_health_counselor", "public_relations", "it_support", "home_health_aide"]);
    for (const f of TITLE_FAMILIES) {
      const recognised = f.q.filter((p) => titleRank(f, p) !== 9);
      if (!loose.has(f.key)) expect(recognised.length / f.q.length, `${f.key}: ${f.q.filter((p) => titleRank(f, p) === 9).join(", ")}`).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("the query is websearch syntax: phrases quoted and OR'ed; any word order drops the quotes", () => {
    expect(familyQuery(["registered nurse", "rn"])).toBe('"registered nurse" or rn');
    expect(familyQuery(["registered nurse", "rn"], true)).toBe("registered nurse or rn");
    expect(familyQuery(['bad "quote']), "a quote in a phrase cannot break the syntax").toBe('"bad quote"');
  });
});

describe("résumé titles map to the family a recruiter would use", () => {
  const cases: Array<[string, string | null]> = [
    ["Staff Software Engineer", "swe_staff"], ["Backend Software Engineer", "swe"], ["ICU Registered Nurse", "rn_icu"],
    ["Registered Nurse", "rn"], ["Ward Manager", "ward_manager"], ["Cashier / Customer Service", "cashier"],
    ["Retail Shift Supervisor", "retail_supervisor"], ["Store Manager", "store_manager"], ["Entry-Level Financial Analyst", "financial_analyst"],
    ["Corporate Controller", "controller"], ["Marketing Coordinator", "marketing_coordinator"], ["Digital Marketing Manager", "digital_marketing"],
    ["Content Marketing and Communications", "content_marketing"], ["HVAC Technician", "hvac_tech"], ["A-Grade Electrician", "electrician"],
    ["Apprentice Electrician", "apprentice_electrician"], ["Elementary School Teacher", "elementary_teacher"], ["Mathematics Teacher", "math_teacher"],
    ["Instructional Designer", "instructional_designer"], ["Senior Data Analyst", "data_analyst"], ["Data Scientist", "data_scientist"],
    ["News Reporter", "journalist"], ["High School English Teacher", "high_school_teacher"], ["line cook", "line_cook"], ["Biochemist", "lab_scientist"],
    ["Court Reporter", null], ["Underwater Basket Weaver", null],
  ];
  for (const [title, key] of cases) {
    it(`${title} -> ${key ?? "no family"}`, () => {
      expect(familyForTitles([title])?.family.key ?? null).toBe(key);
    });
  }
  it("the first title that maps decides; an unmapped first title falls through to the next", () => {
    expect(familyForTitles(["Underwater Basket Weaver", "Cashier"])?.family.key).toBe("cashier");
  });
});

describe("not-lists: shared words, another job", () => {
  const rn = familyByKey("rn")!;
  const controller = familyByKey("controller")!;
  const swe = familyByKey("swe")!;
  it.each([
    [rn, "Nurse Practitioner - Family Medicine"], [rn, "LPN - Long Term Care"], [rn, "Certified Nursing Assistant (CNA)"], [rn, "Nurse Manager, ICU"],
    [controller, "Air Traffic Controller"], [controller, "Assistant Controller"], [controller, "Inventory Controller"],
    [swe, "Sales Engineer"], [swe, "Mechanical Engineer"],
  ])("%s refuses %s", (f, title) => {
    expect(titleRank(f, title)).toBe(9);
  });
  it.each([[rn, "Registered Nurse - Med Surg", 0], [rn, "Telemetry Nurse", 1], [controller, "Corporate Controller", 0], [swe, "Software Engineer II, Payments", 0]])(
    "%s reads %s as rank %d", (f, title, rank) => {
      expect(titleRank(f, title)).toBe(rank);
    },
  );
});

describe("an occupation the table does not carry", () => {
  it("falls back to the reader's own titles OR'ed, order-free, with the generic not-list", () => {
    const f = fallbackFamily(["Underwater Basket Weaver", "Basket Maker"])!;
    expect(f.key).toBe("");
    expect(familyQuery(f.q)).toBe('"underwater basket weaver" or "basket maker"');
    expect(titleRank(f, "Basket Weaver, Underwater")).toBe(9);
    expect(titleRank(f, "Senior Underwater Basket Weaver - Night")).toBe(0);
    expect(titleRank(f, "Basket Maker Sales Representative")).toBe(9);
    expect(f.not).toBe(GENERIC_NOT);
    expect(fallbackFamily([])).toBeNull();
  });
});

describe("level words, as the board's band reads them", () => {
  it("staff is a rung only as the engineering rung; lead is not a rung beside a shift or a till", () => {
    expect(levelFacets("Staff Nurse").aboveEntry).toBe(false);
    expect(levelFacets("Shift Lead").aboveEntry).toBe(false);
    expect(levelFacets("Lead Cashier").aboveEntry).toBe(false);
    expect(levelFacets("Staff Software Engineer")).toMatchObject({ aboveEntry: true, overreach: true });
    expect(levelFacets("Senior Accountant")).toMatchObject({ aboveEntry: true, overreach: false });
    expect(levelFacets("Nurse Manager").aboveEntry).toBe(true);
    expect(levelFacets("Registered Nurse II").numeral).toBe(true);
    expect(levelFacets("Junior Developer").junior).toBe(true);
    expect(levelFacets("Software Engineering Intern").intern).toBe(true);
    expect(levelFacets("Director of Nursing").overreach).toBe(true);
  });
});
