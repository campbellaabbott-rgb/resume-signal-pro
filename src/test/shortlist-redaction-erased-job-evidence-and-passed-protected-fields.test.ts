// The Shortlist redactor failed in both directions at once. Over-broad rules
// erased job evidence (CPT coding, "Ministry of Finance", "Temple
// University", hotel accommodations) and their value classes crossed
// newlines into the next line's title and employer, so the model, which must
// cite evidence for every signal, scored those skills as absent. Meanwhile
// explicit protected fields ("Gender: Female", "Citizenship: Nigerian",
// "Mr. Jones", "Deaf"), most age proxies, and every employment year after an
// Education-first section went the wrong way.

import { describe, it, expect } from "vitest";
import { redactForScoring } from "../../supabase/functions/_shared/redaction";

const run = (text: string) => redactForScoring(text);
const has = (r: ReturnType<typeof run>, f: string) => r.exclusionsApplied.some((e) => e.feature === f);

describe("job evidence survives redaction", () => {
  const evidence = [
    "CPT and ICD-10 coding for 3 outpatient clinics",
    "Senior Analyst, Ministry of Finance, 2017-2021",
    "B.A. Economics, Temple University",
    "Managed hotel accommodations for 200 conference guests",
    "Built opt-in email flows that lifted conversion 30%",
    "Led campaigns for the Hispanic market across 4 states",
    "Department of Veterans Affairs, Program Analyst, 2016-2020",
    "Maintained a 20-year-old codebase in COBOL",
    "Proficient in MS Office and SQL",
    "Islamic finance product design for 2 banks",
  ];
  for (const line of evidence) {
    it(`keeps "${line}"`, () => {
      const r = run(`Jane Okafor\n\nEXPERIENCE\n${line}\nNext line stays too`);
      expect(r.redacted).toContain(line);
      expect(r.redacted).toContain("Next line stays too");
    });
  }

  it("never lets a labelled value swallow the next line's title and employer", () => {
    const r = run("Jane Okafor\nWork Authorization: Green Card\nSenior Accountant\nDeloitte, 2015-2020");
    expect(r.redacted).toContain("Senior Accountant\nDeloitte, 2015-2020");
    expect(r.redacted).not.toMatch(/green card/i);
  });
});

describe("explicit protected fields and honorifics never reach the model", () => {
  it("drops the values of a personal-details block and keeps its lines", () => {
    const block = [
      "PERSONAL DETAILS",
      "Date of Birth: 15.03.1970",
      "Gender: Female",
      "Sex: F",
      "Marital Status: Single",
      "Nationality: Indian / Citizenship: Nigerian",
      "Religion: Hindu",
      "Height: 5'6\" | Weight: 60kg",
    ].join("\n");
    const r = run(`Jane Okafor\n${block}`);
    expect(r.redacted).not.toMatch(/1970|Female|Sex: F\b|Single|Indian|Nigerian|Hindu|5'6|60kg/);
    expect(r.redacted.split("\n")).toHaveLength(block.split("\n").length + 1);
    for (const f of ["date_of_birth", "gendered_terms", "family_status", "national_origin", "religion", "physical_characteristics"]) {
      expect(has(r, f), f).toBe(true);
    }
  });

  it("masks honorifics written with a period and a space", () => {
    const r = run("Jane Okafor\nReferences: Mr. Jones, Mrs. Smith and Ms. Doe.");
    expect(r.redacted).not.toMatch(/\b(?:Mr|Mrs|Ms)\./);
  });

  it("masks citizenship, disability, veteran and affiliation self-descriptions", () => {
    const r = run([
      "Jane Okafor",
      "US Citizen; Permanent Resident since 2015; on F-1 OPT",
      "I am Deaf and use ASL. Living with PTSD.",
      "U.S. Army veteran",
      "Member of the Hispanic Chamber of Commerce; Hillel board; HBCU graduate",
      "Served a two-year LDS mission in Brazil",
      "Member of First Baptist Church",
      "Treasurer, National Society of Black Engineers",
    ].join("\n"));
    expect(r.redacted.replace(/\[[A-Z-]+\]/g, "")).not.toMatch(/citizen|permanent resident|\bOPT\b|deaf|ptsd|veteran|hispanic|hillel|hbcu|lds|baptist|black engineers/i);
    expect(r.redacted).toContain("U.S. Army");
    expect(r.redacted).toContain("Treasurer");
  });
});

describe("age proxies are caught wherever they sit", () => {
  const cases = [
    { text: "SUMMARY\nMBA, Wharton (1994). Twenty years in banking.", gone: /1994/ },
    { text: "SUMMARY\nB.A. History, Yale '98", gone: /'98/ },
    { text: "SUMMARY\nGraduated May 1992 and joined Deloitte.", gone: /1992/ },
    { text: "Birthdate: 1970-03-15", gone: /1970/ },
    { text: "D.O.B. 15.03.1970", gone: /1970/ },
    { text: "Energetic 52-year-old operations leader", gone: /52-year-old/ },
  ];
  for (const c of cases) {
    it(`removes the year or age in "${c.text.split("\n").pop()}"`, () => {
      const r = run(`Jane Okafor\n${c.text}`);
      expect(r.redacted).not.toMatch(c.gone);
    });
  }
});

describe("an Education-first résumé keeps every employment year", () => {
  it("closes the Education section at PROFESSIONAL EXPERIENCE", () => {
    const r = run([
      "Jane Okafor, RN",
      "EDUCATION",
      "B.S. Nursing, Columbia University",
      "2008 - 2012",
      "PROFESSIONAL EXPERIENCE",
      "Charge Nurse, Mercy Hospital, 2016-2024",
      "Staff Nurse, Mercy Hospital, 2012-2016",
    ].join("\n"));
    expect(r.redacted).toContain("Charge Nurse, Mercy Hospital, 2016-2024");
    expect(r.redacted).toContain("Staff Nurse, Mercy Hospital, 2012-2016");
    expect(r.redacted).not.toMatch(/2008/);
  });

  it("closes it at a title-case heading such as Clinical Experience", () => {
    const r = run("Jane Okafor\nEducation\nB.S. Computer Science, 2014\nClinical Experience\nRN, Mercy, 2016-2024");
    expect(r.redacted).toContain("RN, Mercy, 2016-2024");
    expect(r.redacted).not.toMatch(/2014/);
  });
});

describe("no rule reads past the line it starts on (S14X-024)", () => {
  it("the line after an affinity line survives whole", () => {
    const r = run("Jane Okafor\nAFFILIATIONS\nNational Society of Black Engineers\nPMP Certified Project Manager\nWomen in\nTechnology Leadership Program");
    expect(r.redacted).toContain("PMP Certified Project Manager");
    expect(r.redacted).toContain("Technology Leadership Program");
    expect(r.redacted).not.toMatch(/Black Engineers/);
  });

  it("'as a' at a line end does not take the next line", () => {
    const r = run("Jane Okafor\nI joined as a\nBlack Belt trainer");
    expect(r.redacted).toContain("Black Belt trainer");
  });

  it("a church membership does not reach into the next line", () => {
    const r = run("Jane Okafor\nVolunteer at the\nTemple University Hospital pharmacy");
    expect(r.redacted).toContain("Temple University Hospital pharmacy");
  });
});

describe("role nouns and named events are job evidence (S14X-025)", () => {
  const lines = ["Worked as a Japanese interpreter for Toyota", "Certified as a Black Belt in Six Sigma", "Spoke at Black Hat USA Conference 2019", "Served as an Indian market specialist"];
  it("keeps each line verbatim and logs no identity or affinity exclusion for them", () => {
    const r = run(`Jane Okafor\nEXPERIENCE\n${lines.join("\n")}`);
    for (const l of lines) expect(r.redacted).toContain(l);
    expect(has(r, "identity_self_description")).toBe(false);
    expect(has(r, "affinity_group")).toBe(false);
  });

  it("'As a Black woman' is still self-description and goes", () => {
    const r = run("Jane Okafor\nSUMMARY\nAs a Black woman in tech, I mentor new engineers.");
    expect(has(r, "identity_self_description")).toBe(true);
    expect(r.redacted).not.toMatch(/Black woman/);
    expect(r.redacted).toContain("in tech, I mentor new engineers.");
  });
});

describe("a birth date with a capitalised month goes (S14X-288)", () => {
  it("'Born: March 3, 1958', 'D.O.B. 3 March 1958', 'born on March 3, 1958' and 'D. O. B.' lose the year", () => {
    const r = run("Jane Okafor\nBorn: March 3, 1958\nD.O.B. 3 March 1958\nborn on March 3, 1958\nD. O. B. 3 March 1958");
    expect(r.redacted).not.toMatch(/1958/);
    expect(r.exclusionsApplied.find((e) => e.feature === "date_of_birth")?.count).toBe(4);
  });
});
