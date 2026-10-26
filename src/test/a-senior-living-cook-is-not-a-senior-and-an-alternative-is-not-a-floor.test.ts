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

/**
 * THE MERGE RECHECK (2026-10-25). A wish word in the clause dropped a required
 * minimum when it named something else: Tapestry's 874 sales associate
 * postings say "Required Qualifications 1+ years of sales experience (luxury
 * retail preferred)", main read entry/1 and wave 4 read nothing, and the
 * experience re-derive would have overwritten the stored rows. The rule was
 * then measured on 1,354 live descriptions against main (corpus-first): every
 * description where main, the round before and this rule disagree is in
 * fixtures/experience-merge-recheck-corpus-2026-10-25.json with the value read
 * by hand, and this rule must give it.
 */
describe("a wish that names something else does not drop a required minimum (the merge recheck)", () => {
  it("Tapestry's line and the recheck's five probes keep main's floor", () => {
    expect(detectExperience("Coach Sales Associate 32 hrs", "Qualifications\nRequired Qualifications\n1+ years of sales experience (luxury retail preferred); knowledge of fashion trends and competitors.")).toEqual({ band: "entry", minYears: 1 });
    expect(parseMinYears("Required Qualifications 1+ years of sales experience (luxury retail preferred)")).toBe(1);
    expect(parseMinYears("Minimum 2 years of experience (bilingual preferred).")).toBe(2);
    expect(parseMinYears("Requirements: 3+ years experience (healthcare preferred).")).toBe(3);
    expect(parseMinYears("At least 4 years of nursing experience (ICU preferred).")).toBe(4);
    expect(parseMinYears("Qualifications: 3+ years of customer service experience (call center preferred)")).toBe(3);
    expect(parseMinYears("5 years of experience (MBA a plus).")).toBe(5);
    expect(parseMinYears("What we need from you:\n3-5 years of experience managing benefits preferably in the hospitality industry")).toBe(3);
  });

  it("a wish on the years themselves is still a wish, under any heading", () => {
    expect(parseMinYears("Qualifications, Knowledge and Skill Requirements: 1-2 years of cooking experience preferred.")).toBeNull();
    expect(parseMinYears("BASIC QUALIFICATIONS Bachelor's degree. Preferably 1-2 years of experience working as a production coordinator")).toBeNull();
    expect(parseMinYears("Tankers endorsement is required. Preferred 2 or more years of relevant driving experience.")).toBeNull();
    expect(parseMinYears("Minimum Required: Masters in Social Work (MSW)\nPreferred: 3 years post graduate experience")).toBeNull();
    expect(parseMinYears("2 years L&D experience (strongly preferred)")).toBeNull();
  });

  it("a heading's two words sit on one line, and a heading line reads alone", () => {
    // "...is also strongly preferred" ends a line; the next opens "Experience as part of": no Preferred Experience heading.
    expect(parseMinYears("Qualifications:\nExperience in the semiconductor industry is strongly preferred\nExperience as part of lead left teams is also strongly preferred\n6+ years of investment banking experience, or 3+ years with an MBA")).toBe(6);
    expect(parseMinYears("The preferred qualifications are a bonus, not a requirement.\nRequirements\nA strong technical background, including 2-5 years of professional software development experience")).toBe(2);
    expect(parseMinYears("Required: \nBS/BA degree in Finance.\nPreferred: \nEnergy company experience.\nFINANCIAL ANALYST II\nRequired: \n1+ year experience in financial planning")).toBe(1);
    expect(parseMinYears("Preferred\nIndustry standard certifications may substitute for 1 years work experience each up to 4 years.")).toBeNull();
  });

  it("an alternative stays on its own line, and '3 to 7 or more years' is no 7-year floor", () => {
    expect(parseMinYears("REQUIRED QUALIFICATIONS\nBachelor's degree in Electrical Engineering, Robotics, or equivalent\n8+ years of experience in GN&C")).toBe(8);
    expect(parseMinYears("Bachelor's Degree in Business, Construction Management, or equivalent\nMinimum 10 Years extensive experience in the construction industry")).toBe(10);
    expect(parseMinYears("High school diploma or equivalent 2 years of related work experience")).toBeNull();
    expect(parseMinYears("What You Bring\n• 3 to 7 or more years of successful SaaS sales experience")).toBeNull();
  });

  it("every description in the live corpus where the readings disagree gives the value read by hand", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const fx = JSON.parse(readFileSync(resolve(__dirname, "fixtures/experience-merge-recheck-corpus-2026-10-25.json"), "utf8")) as {
      corpus: number; rows: Array<{ id: string; title: string; description: string; main: unknown; want: { band: string | null; minYears: number | null } }>;
    };
    expect(fx.corpus).toBeGreaterThanOrEqual(300);
    const wrong = fx.rows.filter((r) => JSON.stringify(detectExperience(r.title, r.description)) !== JSON.stringify(r.want)).map((r) => `${r.id} ${r.title}`);
    expect(wrong).toEqual([]);
    expect(fx.rows.filter((r) => r.title.startsWith("Coach Sales Associate")).every((r) => r.want.minYears === 1)).toBe(true);
  });
});

/**
 * RECHECK 3 (2026-10-26). The rule's own sentence says a required heading, or
 * a line opening Required or Minimum, binds; but a wish word right after
 * "experience" returned before either check ran, so "3+ years of experience
 * preferably in SaaS" under Minimum Qualifications stated no figure, where
 * main and the same line with a comma read 3. An adverb on a setting
 * ("preferably in", "ideally in") names the setting, as the comma form always
 * did; a participle on one ("desired in a clinical setting") yields to a
 * required heading or line. And two wishes still read as floors: "preferred
 * but not required" (the "required" inside "not required" bound it) and a wish
 * after a short phrase ("4+ years' experience in related field preferred").
 */
describe("a wish on a setting leaves a required minimum, and a wish after a phrase or 'but not required' is a wish (recheck 3)", () => {
  it("the recheck's five probes read main's floor", () => {
    expect(parseMinYears("Minimum Qualifications\n3+ years of sales experience preferably in SaaS")).toBe(3);
    expect(parseMinYears("Minimum 2 years of experience preferably in a hospital")).toBe(2);
    expect(parseMinYears("Required Qualifications\n- 3+ years of experience ideally in B2B sales")).toBe(3);
    expect(parseMinYears("Requirements\n- 2+ years of experience preferably in a hospital setting")).toBe(2);
    expect(parseMinYears("Required Qualifications\n- 3+ years of experience desired in a clinical setting")).toBe(3);
  });

  it("the comma-less adverb reads as the comma form does, under no heading too", () => {
    for (const [plain, comma] of [
      ["3+ years of sales experience preferably in SaaS", "3+ years of sales experience, preferably in SaaS"],
      ["2 years of experience ideally within a hospital", "2 years of experience, ideally within a hospital"],
    ]) expect(parseMinYears(plain), plain).toBe(parseMinYears(comma));
    expect(parseMinYears("3+ years of sales experience preferably in SaaS")).toBe(3);
  });

  it("a participle on a setting is still a wish where nothing binds, and under a wish heading", () => {
    expect(parseMinYears("3+ years of experience desired in a clinical setting")).toBeNull();
    expect(parseMinYears("Preferred Qualifications\n3+ years of experience preferably in SaaS")).toBeNull();
  });

  it("'preferred but not required' and a wish after a short phrase state no floor", () => {
    expect(detectExperience("Senior Living Cook", "2 years of assisted living experience preferred but not required!")).toEqual({ band: null, minYears: null });
    expect(parseMinYears("2-3 years of accounting experience preferred but not required")).toBeNull();
    expect(parseMinYears("4+ years' experience in related field preferred")).toBeNull();
    expect(parseMinYears("3 years of experience in a retail environment preferred.")).toBeNull();
  });

  it("positive control: 'required' still binds, and 'not required' elsewhere in the sentence does not drop a floor", () => {
    expect(parseMinYears("5+ years of experience required, degree not required")).toBe(5);
    expect(parseMinYears("3+ years of experience; a degree is not required")).toBe(3);
    expect(parseMinYears("Minimum 2 years of experience, preferably in the hospitality industry")).toBe(2);
    expect(parseMinYears("Required Qualifications 1+ years of sales experience (luxury retail preferred)")).toBe(1);
  });
});

describe("a Senior Community Manager, Support Worker or Associate is a rung anywhere in a title (the merge recheck)", () => {
  it("the live titles with a prefix stay senior", () => {
    for (const t of ["TOPS - Senior Community Manager Specialist - Dallas, TX", "TOPS - Senior Community Manager Specialist - Atlanta, GA", "Part-Time Senior Community Support Worker", "Roving Senior Community Manager", "Assistant Senior Community Associate"]) expect(bandFromTitle(t), t).toBe("senior");
  });
  it("the clientele forms still are not", () => {
    for (const t of ["Cook - Senior Community Services - J01710 - 41900", "Life Enrichment Assistant at Luxury Senior Community", "Housekeeper - Senior Community"]) expect(bandFromTitle(t), t).not.toBe("senior");
  });
});
