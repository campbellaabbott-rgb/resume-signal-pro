// Shortlist strips protected-class proxies before a résumé reaches the
// scoring model, and stores the list of what it stripped as compliance
// evidence. The name rule read only the first line, with an ASCII word
// class and a case-sensitive replace, and there was no contact rule at all:
// accented, ALL-CAPS, credentialed and piped names went through, the whole
// "email | phone | city ZIP | linkedin" line went through, and the audit row
// still said candidate_name was excluded. These are real header shapes.

import { describe, it, expect } from "vitest";
import { redactForScoring } from "../../supabase/functions/_shared/redaction";

const feature = (r: ReturnType<typeof redactForScoring>, f: string) =>
  r.exclusionsApplied.find((e) => e.feature === f)?.count ?? 0;

describe("every name shape is masked, in any case, everywhere it appears", () => {
  const shapes: Array<{ label: string; text: string; mustNotSurvive: RegExp }> = [
    { label: "Spanish accents", text: "José García\nSoftware Engineer\n\nJose Garcia led the payments team. García shipped v2.", mustNotSurvive: /jos[eé]|garc[ií]a/i },
    { label: "Vietnamese, ALL CAPS", text: "NGUYỄN VĂN AN\nData Analyst\n\nNguyễn Văn An built the ETL pipeline.", mustNotSurvive: /nguy[eễ]n|v[aă]n an/i },
    { label: "Polish letters outside Latin-1", text: "Łukasz Żółć\nBackend developer\n\nŁukasz Żółć wrote the Go services.", mustNotSurvive: /łukasz|żółć/i },
    { label: "an ALL-CAPS header with the name in the body", text: "MARIA GONZALEZ\nEXPERIENCE\nMaria Gonzalez managed a team of 6.", mustNotSurvive: /maria|gonzalez/i },
    { label: "a name with credentials", text: "Jane Okafor, PMP, CSM\nProject Manager\n\nJane Okafor delivered 14 projects.", mustNotSurvive: /okafor|jane/i },
    { label: "a name and title split by a pipe", text: "Jane Okafor | Senior Engineer | Remote\n\nOkafor led the migration.", mustNotSurvive: /okafor|jane/i },
    { label: "a RESUME line above the name", text: "RESUME\nJane Okafor\n\nJane Okafor led the migration.", mustNotSurvive: /okafor|jane/i },
    { label: "a Word page-header contact block above the name", text: "jane.okafor@gmail.com | 555-010-0199\nJane Okafor\nSenior Engineer\n\nOkafor led the migration.", mustNotSurvive: /okafor|jane/i },
    { label: "a doctor's title and degree", text: "Dr. Priya Raghunathan, PhD\nClinical Research Lead\n\nPriya ran 12 trials.", mustNotSurvive: /priya|raghunathan/i },
    { label: "a name in Chinese characters", text: "王小明\n工程师\n\n王小明 developed the billing system.", mustNotSurvive: /王小明/ },
  ];
  for (const s of shapes) {
    it(`masks ${s.label}`, () => {
      const r = redactForScoring(s.text);
      expect(r.redacted).not.toMatch(s.mustNotSurvive);
      expect(feature(r, "candidate_name")).toBeGreaterThan(0);
    });
  }

  it("does not mistake a job-title first line for the name, and masks the name below it", () => {
    const r = redactForScoring("Senior Software Engineer\nJane Okafor\n\nSenior engineer at Acme. Software Engineer II at Initech. Jane led.");
    expect(r.redacted).not.toMatch(/okafor|jane/i);
    expect(r.redacted).toContain("Senior engineer at Acme");
    expect(r.redacted).toContain("Software Engineer II at Initech");
  });

  it("records candidate_name only when the name was actually masked", () => {
    const r = redactForScoring("Professional Summary\nBuilt data pipelines for 10 years in Python and Spark at three companies.");
    expect(feature(r, "candidate_name")).toBe(0);
  });

  it("keeps everyday words that share a name's spelling, while masking the name", () => {
    const r = redactForScoring("Will Brown\nEngineer\n\nWill Brown will deliver the roadmap. Teams will scale.");
    expect(r.redacted).not.toMatch(/Brown|Will Brown/);
    expect(r.redacted).toContain("will deliver the roadmap. Teams will scale.");
  });
});

describe("no contact detail reaches the model", () => {
  it("strips a pipe-separated contact line: email, phone, ZIP and profile URL", () => {
    const r = redactForScoring("Maria Gonzalez\nmaria.gonzalez1975@gmail.com | 718-555-0199 | Brooklyn, NY 11215 | linkedin.com/in/mariagonzalez\n\nMarketing manager with 8 years of experience.");
    expect(r.redacted).not.toMatch(/gonzalez|1975|718|555-0199|11215|linkedin/i);
    expect(r.redacted).toContain("Marketing manager with 8 years of experience.");
    for (const f of ["email", "phone", "zip_code", "profile_url"]) expect(feature(r, f), f).toBeGreaterThan(0);
  });

  it("strips international phones, UK and Canadian postcodes and personal sites", () => {
    const r = redactForScoring("Priya Raghunathan\n+44 20 7946 0958 · London SW1A 1AA · priyar.dev\nToronto, ON M5V 3L9 · https://github.com/priyar · (416) 555-0123\n\nResearch lead.");
    expect(r.redacted).not.toMatch(/7946|SW1A|priyar|M5V|github|416/);
    expect(r.redacted).toContain("London");
    expect(r.redacted).toContain("Research lead.");
  });

  it("keeps employment date ranges, metrics and versions that look like digits", () => {
    const r = redactForScoring("Jane Okafor\nEXPERIENCE\nEngineer, Acme | 2015-2019\nGrew revenue 1,250,000 to 2,100,000; ISO 9001; 0.5 FTE\nRaised 25000, then 30000.");
    expect(r.redacted).toContain("2015-2019");
    expect(r.redacted).toContain("1,250,000 to 2,100,000");
    expect(r.redacted).toContain("Raised 25000, then 30000.");
  });
});
