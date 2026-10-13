// @vitest-environment node
/**
 * THE PROFILE READER (_shared/resume-profile.ts) ON THE 24 DEV RÉSUMÉS, AND ITS RULES.
 *
 * Floors are the accuracy prototype's dev-set figures (country 24/24,
 * authorisation 24/24, relocation 24/24, level 17/24, years within 3 18/24),
 * read through the parse round trip (parsed/*.pdf.txt) and from the original
 * text. These are DEV-SET numbers: the reader was written against these
 * résumés. The held-out targets (spec 19) need the 60 held-out résumés.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dateRanges, readProfile, splitSections } from "../../supabase/functions/_shared/resume-profile";
import { RESUMES } from "./fixtures/match-bench/manifest";

const F = resolve(__dirname, "fixtures/match-bench");
const text = (id: string, kind: "parsed" | "resumes") => readFileSync(resolve(F, kind, kind === "parsed" ? `${id}.pdf.txt` : `${id}.txt`), "utf8");

function score(kind: "parsed" | "resumes") {
  const ok = { country: 0, auth: 0, reloc: 0, level: 0, years3: 0, sponsorship: 0 };
  for (const r of RESUMES) {
    const p = readProfile(text(r.id, kind), { nowYear: 2026 });
    const lvl = r.profile === "new_grad" ? ["entry"] : r.profile === "senior" ? ["senior", "exec"] : r.profile === "career_changer" ? ["entry", "mid"] : ["mid"];
    const norm = (x: unknown) => JSON.stringify(Array.isArray(x) ? [...x].sort() : x);
    ok.country += +(p.home?.country === r.country);
    ok.auth += +(norm(p.canWorkIn) === norm(r.authorized));
    ok.reloc += +(norm(p.relocate) === norm(r.relocate));
    ok.level += +lvl.includes(p.level);
    ok.years3 += +(p.years !== null && Math.abs(p.years.low - r.years) < 3);
    ok.sponsorship += +(p.workAuth.needsSponsorship === r.sponsorshipFuture);
  }
  return ok;
}

describe("dev-set accuracy (24 synthetic résumés; floors = the prototype's figures)", () => {
  for (const kind of ["parsed", "resumes"] as const) {
    it(`${kind === "parsed" ? "through the PDF round trip" : "from the original text"}: country, authorisation and relocation 24/24, level >= 17, years within 3 >= 18`, () => {
      const ok = score(kind);
      expect(ok.country).toBe(24);
      expect(ok.auth).toBe(24);
      expect(ok.reloc).toBe(24);
      expect(ok.sponsorship).toBe(24);
      expect(ok.level).toBeGreaterThanOrEqual(17);
      expect(ok.years3).toBeGreaterThanOrEqual(18);
    });
  }
});

describe("the rules the review added", () => {
  const p = (id: string) => readProfile(text(id, "parsed"), { nowYear: 2026 });

  it("the headline is the first title line, cut at | ( , and a spaced dash; grade words are kept", () => {
    expect(p("sw-sr-seattle").headline).toBe("Staff Software Engineer");
    expect(p("sw-sr-seattle").grade).toContain("staff");
    expect(p("rn-ng-phoenix").headline).toBe("Registered Nurse");
    expect(p("rn-ng-phoenix").grade).toContain("new graduate");
    expect(p("ed-ng-sacramento").headline).toBe("Elementary School Teacher");
    expect(p("rt-ng-columbus").headline).toBe("Cashier / Customer Service");
    expect(p("fn-ng-nyc").headline).toBe("Entry-Level Financial Analyst");
  });

  it("a term found only on a licence line is dropped (\"Educator's License\" gave educator)", () => {
    const r = p("ed-mid-gap-raleigh");
    expect(r.roles[0]).toBe("Mathematics Teacher");
    expect(r.roles.map((x) => x.toLowerCase())).not.toContain("educator");
  });

  it("a career changer's old job is former, never a search role", () => {
    const j = p("mk-ch-journalist-portland");
    expect(j.careerChanger).toBe(true);
    expect(j.former).toMatch(/reporter/i);
    expect(j.roles.join(" ")).not.toMatch(/reporter|journalist/i);
    const cook = p("tr-ch-cook-to-electrician-philly");
    expect(cook.former).toBe("line cook");
    expect(cook.roles).toEqual(["Apprentice Electrician"]);
    expect(cook.level).toBe("entry");
    expect(p("da-ch-biochem-to-ds-sandiego").former).toMatch(/biochemist/i);
    expect(p("ed-ch-teacher-to-id-minneapolis").former).toMatch(/teacher/i);
  });

  it("authorisation only as declared: no statement is unknown; 'sponsorship for US roles' takes the US out", () => {
    const chicago = p("rn-mid-chicago");
    expect(chicago.workAuth).toEqual({ status: "unknown", needsSponsorship: false, citizenOf: [], clearance: null });
    expect(chicago.canWorkIn).toEqual(["US"]);
    expect(chicago.canWorkInBasis).toBe("home");
    const toronto = p("sw-mid-toronto");
    expect(toronto.canWorkIn).toEqual(["CA"]);
    expect(toronto.workAuth.status).toBe("permanent_resident");
    expect(toronto.workAuth.needsSponsorship).toBe(false);
    const opt = p("da-ng-opt-sanjose");
    expect(opt.workAuth).toMatchObject({ status: "student_visa", needsSponsorship: true });
    expect(p("rn-sr-manchester").workAuth.citizenOf).toEqual(["GB"]);
  });

  it("relocation scope, remote intent and named search areas", () => {
    expect(p("rn-ng-phoenix").relocate).toEqual(["AZ", "NM", "TX"]);
    expect(p("rt-sr-dallas").relocate).toEqual(["TX"]);
    expect(p("sw-ng-austin").relocate).toBe("country");
    expect(p("rt-ng-columbus").relocate).toBe("none");
    expect(p("sw-mid-toronto").remote).toBe(true);
    expect(p("mk-ng-boston").extraPlaces.map((x) => x.city)).toEqual(["New York"]);
    expect(p("rt-ng-columbus").radiusKm).toBe(40);
  });

  it("licences carry their jurisdiction (and the compact)", () => {
    expect(p("rn-ng-phoenix").licences).toEqual([expect.objectContaining({ kind: "rn", jurisdiction: "AZ", compact: true })]);
    expect(p("rn-mid-chicago").licences[0]).toMatchObject({ kind: "rn", jurisdiction: "IL", compact: false });
    expect(p("tr-mid-brisbane").licences[0]).toMatchObject({ kind: "electrician", jurisdiction: "QLD" });
    expect(p("rn-sr-manchester").licences[0]).toMatchObject({ kind: "nmc", jurisdiction: "NMC" });
    expect(p("fn-sr-chicago").licences[0]).toMatchObject({ kind: "cpa", jurisdiction: "IL" });
  });

  it("every field names the line it came from, at most 160 characters", () => {
    for (const r of RESUMES) {
      const b = readProfile(text(r.id, "parsed"), { nowYear: 2026 }).basis;
      for (const v of Object.values(b)) expect(v.length).toBeLessThanOrEqual(160);
      expect(b.home).toBeTruthy();
    }
  });
});

describe("years: employment only, merged intervals, non-English dates", () => {
  it("German, Spanish and numeric dates are ranges", () => {
    expect(dateRanges("Pflegefachkraft - Charité, Berlin | 03/2018 – heute", 2026)).toEqual([[2018 + 2 / 12, 2026.8]]);
    expect(dateRanges("Enfermera | ene. 2021 – actualidad", 2026)).toEqual([[2021, 2026.8]]);
    expect(dateRanges("Analyst | Jan 2020 - Dec 2021", 2026)[0][0]).toBe(2020);
  });

  it("internships, practicums and a career break are not employment; education dates never count", () => {
    const t = [
      "Alex Doe", "Data Analyst", "Austin, TX | alex@example.com", "",
      "EXPERIENCE",
      "Data Analyst - Acme | Jan 2022 - Present",
      "Data Intern - Beta | Jun 2021 - Aug 2021",
      "Career break - family | 2019 - 2021",
      "EDUCATION",
      "B.S. Statistics - UT Austin | 2015 - 2019",
    ].join("\n");
    const p = readProfile(t, { nowYear: 2026 });
    expect(p.years?.low).toBeCloseTo(4.8, 1);
    expect(p.degree).toBe("bachelor");
  });

  it("a German résumé's own headings are sections", () => {
    const t = "Anna Müller\nPflegefachkraft\nBerlin, Germany | anna@example.com\n\nBERUFSERFAHRUNG\nPflegefachkraft - Charité | 03/2018 – heute\n\nAUSBILDUNG\nB.Sc. Pflege 2017";
    expect(splitSections(t).map((s) => s.head)).toEqual(["HEADER", "BERUFSERFAHRUNG", "AUSBILDUNG"]);
    const p = readProfile(t, { nowYear: 2026 });
    expect(p.home).toEqual({ city: "Berlin", region: null, country: "DE" });
    expect(p.years?.low).toBeCloseTo(8.6, 1);
  });

  it("a student with an expected graduation is a student (internships are not set aside for them)", () => {
    const t = "Sam Lee\nSoftware Engineering Student\nBoston, MA | sam@example.com\n\nEDUCATION\nB.S. Computer Science, Northeastern University - expected May 2028\n\nEXPERIENCE\nIntern - Acme | Jun 2025 - Aug 2025";
    expect(readProfile(t, { nowYear: 2026 }).student).toBe(true);
  });
});
