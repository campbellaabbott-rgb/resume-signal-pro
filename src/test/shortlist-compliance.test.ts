// Compliance-critical unit tests for Shortlist:
// 1. Proxy redaction — protected-class proxies must never reach the model
// 2. Impact-ratio math — the four-fifths computation must be exactly right
// These are legal-exposure tests, not style tests: a regression here is a
// discrimination-liability bug for every customer.

import { describe, it, expect } from "vitest";
import { redactForScoring } from "../../supabase/functions/_shared/redaction";
import { computeImpactAnalysis } from "../../supabase/functions/_shared/impact-ratio";

describe("proxy redaction", () => {
  const resume = `Maria Gonzalez
123 Main Street, Brooklyn, NY 11215
maria.gonzalez@email.com · she/her

SUMMARY
Marketing manager with 8 years of experience. Member of Latina Professionals Association.

EXPERIENCE
Marketing Manager, BrandCo (2019-present)
- Grew organic traffic 3x, managed $500K budget
Marketing Associate, AdWorks (2015-2019)

EDUCATION
B.A. Marketing, State University, Class of 2014

OTHER
Date of birth: 03/14/1992. Married, children: 2.
Requires wheelchair accessible workplace accommodation.`;

  const { redacted, exclusionsApplied } = redactForScoring(resume);
  const features = new Set(exclusionsApplied.map(e => e.feature));

  it("removes the candidate's name everywhere", () => {
    expect(redacted).not.toMatch(/Maria|Gonzalez/);
    expect(features.has("candidate_name")).toBe(true);
  });

  it("removes age proxies (DOB, graduation year)", () => {
    expect(redacted).not.toMatch(/03\/14\/1992/);
    expect(redacted).not.toMatch(/Class of 2014/i);
    expect(features.has("date_of_birth")).toBe(true);
  });

  it("keeps employment date ranges (tenure is job-related)", () => {
    expect(redacted).toContain("2019-present");
    expect(redacted).toContain("2015-2019");
  });

  it("removes address, gender markers, family status, affinity groups, and ADA content", () => {
    expect(redacted).not.toMatch(/123 Main Street/);
    expect(redacted).not.toMatch(/she\/her/);
    expect(redacted).not.toMatch(/children:\s*2/i);
    expect(redacted).not.toMatch(/Latina Professionals/);
    expect(redacted).not.toMatch(/wheelchair/i);
    for (const f of ["street_address", "gendered_terms", "family_status", "affinity_group", "disability_mention"]) {
      expect(features.has(f), `expected exclusion: ${f}`).toBe(true);
    }
  });

  it("preserves job-related content", () => {
    expect(redacted).toContain("Grew organic traffic 3x");
    expect(redacted).toContain("$500K budget");
    expect(redacted).toContain("Marketing Manager");
  });

  it("applies employer-extended blocklists and survives invalid patterns", () => {
    const r = redactForScoring("Fluent in Klingon. Speaks Spanish at home.", {
      extraBlocklist: [
        { feature: "home_language", pattern: "speaks \\w+ at home" },
        { feature: "broken", pattern: "([unclosed" },
      ],
    });
    expect(r.redacted).not.toMatch(/at home/i);
    expect(r.redacted).toContain("Klingon");
  });
});

describe("impact-ratio math (four-fifths rule)", () => {
  it("computes selection rates and flags ratios below 0.8", () => {
    // 10 men: 6 advanced (60%). 10 women: 3 advanced (30%). Ratio 0.5 → flag.
    const records = [
      ...Array.from({ length: 10 }, (_, i) => ({ advanced: i < 6, sex: "male" })),
      ...Array.from({ length: 10 }, (_, i) => ({ advanced: i < 3, sex: "female" })),
    ];
    const a = computeImpactAnalysis(records);
    const male = a.bySex.find(g => g.group === "male")!;
    const female = a.bySex.find(g => g.group === "female")!;
    expect(male.selectionRate).toBe(0.6);
    expect(female.selectionRate).toBe(0.3);
    expect(male.impactRatio).toBe(1);
    expect(female.impactRatio).toBe(0.5);
    expect(female.fourFifthsFlag).toBe(true);
    expect(male.fourFifthsFlag).toBe(false);
  });

  it("does not flag ratios at or above 0.8", () => {
    const records = [
      ...Array.from({ length: 10 }, (_, i) => ({ advanced: i < 5, sex: "male" })),   // 50%
      ...Array.from({ length: 10 }, (_, i) => ({ advanced: i < 4, sex: "female" })), // 40% → 0.8
    ];
    const a = computeImpactAnalysis(records);
    expect(a.bySex.find(g => g.group === "female")!.fourFifthsFlag).toBe(false);
  });

  it("marks small groups low-sample and excludes them from the rate basis", () => {
    const records = [
      ...Array.from({ length: 20 }, (_, i) => ({ advanced: i < 8, sex: "male" })), // 40%, n=20
      { advanced: true, sex: "nonbinary" },                                        // 100%, n=1
    ];
    const a = computeImpactAnalysis(records);
    const nb = a.bySex.find(g => g.group === "nonbinary")!;
    const male = a.bySex.find(g => g.group === "male")!;
    expect(nb.lowSample).toBe(true);
    // Basis is the adequately-sampled male rate, so male ratio = 1
    expect(male.impactRatio).toBe(1);
  });

  it("computes intersectional groups", () => {
    const records = [
      { advanced: true, sex: "female", raceEthnicity: "black" },
      { advanced: false, sex: "female", raceEthnicity: "black" },
      { advanced: true, sex: "male", raceEthnicity: "white" },
    ];
    const a = computeImpactAnalysis(records);
    expect(a.intersectional.some(g => g.group === "female × black" && g.total === 2)).toBe(true);
  });

  it("handles missing demographics without crashing", () => {
    const a = computeImpactAnalysis([{ advanced: true }, { advanced: false, sex: null }]);
    expect(a.bySex).toEqual([]);
    expect(a.totalRecords).toBe(2);
    expect(a.recordsWithDemographics).toBe(0);
  });
});
