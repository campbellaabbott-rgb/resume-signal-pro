// Regression tests for the secondary-industry "relaxed bar" fix.
// A genuine runner-up field normally has to clear 50% of the primary's score to
// be reported. When the runner-up has its OWN evidence (a matched job title or
// the field's required anchor terms), it now surfaces at a 35% bar — catching
// cross-functional resumes whose second field is a real 35-50% of the profile.
// Skills-list noise (no title/anchor evidence) must still be suppressed.
import { describe, it, expect } from "vitest";
import { detectIndustry } from "../../supabase/functions/free-keyword-scan/industry-detection.ts";

describe("industry secondary detection — relaxed bar for evidence-backed runner-ups", () => {
  it("surfaces a dual-title runner-up sitting at ~42% (would be dropped at the old 50% bar)", () => {
    const r = detectIndustry(
      "Jordan Blake\nSales Director — previously Marketing Manager\nPROFESSIONAL EXPERIENCE\n" +
        "Sales Director, Acme (2021-present)\n- Led enterprise sales team, exceeded quota, managed pipeline in Salesforce, closed $6M ARR, negotiation and closing\n" +
        "Marketing Manager, Acme (2017-2021)\n- Ran demand generation campaigns, brand strategy, content marketing, SEO, managed social media and advertising\n" +
        "SKILLS\nsales, quota, pipeline, Salesforce, prospecting, marketing, campaigns, brand, content, SEO, advertising",
    );
    expect(r.industry).toBe("sales");
    expect(r.secondaryIndustry).toBe("marketing");
    expect(r.industryBlend).toBeTruthy();
  });

  it("does NOT invent a secondary for a clean single-industry resume", () => {
    const r = detectIndustry(
      "Jane Doe\nSenior Software Engineer\nPROFESSIONAL EXPERIENCE\n" +
        "Senior Software Engineer, Acme (2021-present)\n- Built REST API services in Python, deployed to AWS with Docker and CI/CD\n- Designed database schema in PostgreSQL, improved query performance 40%\n" +
        "SKILLS\nPython, AWS, Docker, PostgreSQL, Kubernetes",
    );
    expect(r.industry).toBe("technology");
    expect(r.secondaryIndustry).toBeUndefined();
  });

  it("does NOT surface a low-scoring noise runner-up that lacks title/anchor evidence", () => {
    // A sales resume whose runner-ups are incidental keyword noise (no real
    // second field, no matching title or required anchors) must stay single.
    const r = detectIndustry(
      "Senior Account Executive — Enterprise Sales\nPROFESSIONAL EXPERIENCE\n" +
        "Senior Account Executive, CloudCo (2019-present)\n- Exceeded quota 6 quarters running, closed $4M ARR, managed pipeline in Salesforce, outbound prospecting, negotiation and closing\n- Ran discovery and demos, forecasting, territory planning\n" +
        "SKILLS\nSalesforce, quota, pipeline, prospecting, closing, negotiation",
    );
    expect(r.industry).toBe("sales");
    expect(r.secondaryIndustry).toBeUndefined();
  });
});
