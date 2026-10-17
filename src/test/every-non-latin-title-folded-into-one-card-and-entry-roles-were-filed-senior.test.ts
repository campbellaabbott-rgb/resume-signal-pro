/**
 * EVERY NON-LATIN TITLE OF AN EMPLOYER FOLDED INTO ONE CARD, AND ENTRY ROLES
 * WERE FILED SENIOR (register L13-22, L7-08, L7-09, L8-15).
 *
 * L13-22. clusterKey normalised with [^a-z0-9], so a Cyrillic or CJK title
 * normalised to nothing and every such title of one employer shared a key:
 * Raiffeisen Bank's "Інкасатор" and "Головний економіст" became one card
 * ("Also hiring in N more locations") and the rest could not be reached.
 *
 * L7-08. bandFromTitle read bare "staff", "lead" and "partner" as senior and
 * expert: q="staff accountant" under experience=senior returned 150 Staff
 * Accountants, "shift lead" 442 Shift Leads, "care partner" 37 of 40 Care
 * Partners under expert.
 *
 * L7-09. "more than 135 years of financial experience" read as 35 (no left
 * boundary on the number) and "for more than 40 years, X has been the
 * industry's partner" as 40, beating the real "5-7 years".
 *
 * L8-15. "Must be at least 18 years of age" read as 18 years of experience;
 * the fit scorer then cut an entry cashier's match by 60%.
 */
import { describe, expect, it } from "vitest";
import { clusterKey } from "../../supabase/functions/job-board/descriptions";
import { bandFromTitle, detectExperience, parseMinYears } from "../../supabase/functions/job-board/experience";

describe("L13-22: a title in any script keys on its own words", () => {
  it("two different Cyrillic titles, and two different Chinese titles, at one employer are two cards", () => {
    expect(clusterKey("Raiffeisen Bank", "Інкасатор")).not.toBe(clusterKey("Raiffeisen Bank", "Головний економіст"));
    expect(clusterKey("Yanfeng", "质量工程师")).not.toBe(clusterKey("Yanfeng", "采购经理"));
  });
  it("positive control: the same role in two cities still folds, in any script", () => {
    // Each row's own location is passed: a bracket folds when it is that place (S11-025).
    expect(clusterKey("Ramboll", "Project Manager (Leeds)", "Leeds, United Kingdom")).toBe(clusterKey("Ramboll", "Project Manager - #R12345", "Dublin, Ireland"));
    expect(clusterKey("Raiffeisen Bank", "Інкасатор (Київ)", "Київ, Україна")).toBe(clusterKey("Raiffeisen Bank", "Інкасатор", "Львів, Україна"));
  });
  it("a title that normalises to nothing never folds with a different one", () => {
    expect(clusterKey("Acme", "###")).not.toBe(clusterKey("Acme", "***"));
  });
});

describe("L7-08: staff, lead and partner are rungs only where they are rungs", () => {
  it("hourly and entry titles carry no seniority", () => {
    for (const t of ["Staff Accountant", "Staff Nurse", "Kitchen Staff", "Shift Lead", "Team Lead - Retail", "Lead Cashier", "Care Partner"]) {
      expect(bandFromTitle(t), t).toBeNull();
    }
  });
  it("positive control: the engineering and firm rungs keep their bands", () => {
    expect(bandFromTitle("Staff Software Engineer")).toBe("senior");
    expect(bandFromTitle("Lead Data Scientist")).toBe("senior");
    expect(bandFromTitle("Tech Lead, Payments")).toBe("senior");
    expect(bandFromTitle("Managing Partner")).toBe("expert");
    expect(bandFromTitle("Senior Accountant")).toBe("senior");
    expect(bandFromTitle("Director of Nursing")).toBe("expert");
  });
  // S11-137: the modifier list lacked these words and the nouns lacked
  // manager, so these Staff-level tech titles left the Senior filter.
  it("Staff-level tech titles the list did not name are senior; non-rung Staff titles stay unspecified", () => {
    for (const t of ["Staff Product Manager", "Staff Engineering Manager", "Staff iOS Engineer", "Staff Android Engineer",
      "Staff Database Engineer", "Staff Application Security Engineer", "Staff Technical Program Manager", "Staff Web Developer"]) {
      expect(bandFromTitle(t), t).toBe("senior");
    }
    for (const t of ["Staff Nurse", "Staff Accountant", "Staff Civil Engineer", "Staff Manager", "Staff Scheduling Manager", "Staff Physical Therapist"]) {
      expect(bandFromTitle(t), t).toBeNull();
    }
  });
});

describe("L7-09, L8-15: a year count is a requirement only when it is one", () => {
  it("a company's age is not a requirement, and the real requirement wins", () => {
    expect(parseMinYears("For more than 135 years of financial experience, we have served clients. Requires 5-7 years of experience.")).toBe(5);
    expect(parseMinYears("For more than 40 years, Accelya has been the industry's partner. 3+ years of experience required.")).toBe(3);
  });
  it("a minimum age is not experience", () => {
    expect(parseMinYears("Must be at least 18 years of age.")).toBeNull();
    expect(parseMinYears("Applicants must be 21 years old or older; 2 years of experience preferred.")).toBe(2);
    expect(detectExperience("Cashier", "Must be at least 18 years of age. No experience needed.").minYears).toBeNull();
  });
  it("positive control: stated requirements still read", () => {
    expect(parseMinYears("5+ years of experience in Python")).toBe(5);
    expect(parseMinYears("Minimum of 8 years of leadership experience")).toBe(8);
    expect(parseMinYears("2 years Python, 8 years leadership experience")).toBe(8);
  });
});
