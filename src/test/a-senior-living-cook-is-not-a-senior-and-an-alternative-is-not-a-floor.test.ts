/**
 * A SENIOR LIVING COOK IS NOT A SENIOR, AND AN ALTERNATIVE IS NOT A FLOOR
 * (S12-036, S12-126; job-board .93, wave 4 round 2).
 *
 * S12-036. bandFromTitle read every "senior" as the rung, so "Housekeeper -
 * Senior Living", "Senior Living Cook" and "Nurse Aide | Senior Care" were
 * filed senior and the entry filter lost them: 55 of the first 60 live rows
 * for "senior living" under experience=senior on 2026-10-12 were hourly
 * kitchen, care and housekeeping jobs. The word names who is served. A UK
 * "Senior Carer", a "Senior Care Assistant" and a "Senior Community Manager"
 * are still rungs.
 *
 * S12-126. parseMinYears took the years offered as an alternative ("Graduate
 * of an MA school or 5+ years of experience", a live Humana medical assistant
 * filed mid) and the years an employer only prefers, and missed "3 or more
 * years" altogether.
 */
import { describe, expect, it } from "vitest";
import { bandFromTitle, detectExperience, parseMinYears } from "../../supabase/functions/job-board/experience";

describe("senior as the people served is not the rung (S12-036)", () => {
  it("files the live clientele titles as no rung", () => {
    for (const t of [
      "Housekeeper - Senior Living",
      "Senior Living Cook",
      "Senior Living Server",
      "Senior Living Management Intern",
      "Nurse Aide | Senior Care",
      "Certified Aide Senior Care",
      "Recreational Therapist - Senior Care",
      "Cook - Senior Community Services - J01710 - 41900",
      "Life Enrichment Assistant at Luxury Senior Community",
      "Behavioral Health Clinician - Senior Services",
      "Senior Center Coordinator",
      "Activities Aide - Senior Housing",
    ]) expect(bandFromTitle(t), t).not.toBe("senior");
    expect(bandFromTitle("Senior Living Management Intern")).toBe("entry");
    expect(detectExperience("Housekeeper - Senior Living", "Must be 18 years or older.").band).toBeNull();
  });

  it("positive control: the rungs that share the word stay senior", () => {
    for (const t of [
      "Senior Carer",
      "Senior Care Assistant (Days)",
      "Senior Care Worker",
      "Night Senior Care Assistant",
      "Senior Community Manager",
      "Senior Services Engineer",
      "Senior Software Engineer",
      "Senior Living Program Manager, Senior Analyst",
    ]) expect(bandFromTitle(t), t).toBe("senior");
    expect(bandFromTitle("Director, Senior Living Operations")).toBe("expert");
  });
});

describe("only a binding floor is a minimum (S12-126)", () => {
  it("skips the years offered as an alternative path", () => {
    expect(parseMinYears("Graduate of an accredited MA school or 5+ years of experience as a medical assistant")).toBeNull();
    expect(parseMinYears("High school diploma or equivalent 2 years of related work experience")).toBeNull();
    expect(detectExperience("Medical Assistant", "Graduate of an MA school or 5+ years of experience").band).toBeNull();
  });

  it("skips the years an employer only prefers", () => {
    expect(parseMinYears("5+ years of experience preferred")).toBeNull();
    expect(parseMinYears("2 years of experience required; 7 years preferred")).toBe(2);
    expect(parseMinYears("Experience: 3 years of retail experience (a plus)")).toBeNull();
    expect(parseMinYears("Basic Qualifications\n- 2+ years of experience in SQL\nPreferred Qualifications\n- 6+ years of experience with Spark")).toBe(2);
  });

  it("reads 'N or more years' as N", () => {
    expect(parseMinYears("3 or more years of experience in accounting")).toBe(3);
    expect(parseMinYears("Requires 4 or more years of professional experience")).toBe(4);
  });

  it("positive control: required floors and 'two or three years' still read", () => {
    expect(parseMinYears("5+ years of experience required")).toBe(5);
    expect(parseMinYears("2 or 3 years of experience in sales")).toBe(3);
    expect(parseMinYears("Minimum 8 years of professional experience")).toBe(8);
    expect(parseMinYears("Required Qualifications: 4 years of experience. Preferred Qualifications: a CPA")).toBe(4);
  });
});
