// Tests for the deterministic resume-structure module: the extraction-quality
// gate (parity across both scan paths) and the AI grounding scaffold.
import { describe, it, expect } from "vitest";
import {
  computeParseQuality,
  parseResumeStructure,
  formatStructureForPrompt,
} from "../../supabase/functions/free-keyword-scan/resume-structure";

const GOOD_RESUME = `John Doe
Senior Software Engineer
john.doe@example.com | (415) 555-1234 | linkedin.com/in/johndoe | San Francisco, CA

Summary
Experienced backend engineer with eight years building scalable distributed
systems across fintech and logistics. Focused on reliability, cost efficiency,
and mentoring engineers toward senior scope and ownership.

Experience
Senior Software Engineer, Acme Corp — 2020 - Present
- Built distributed systems handling one million requests per second at peak load
- Led a team of five engineers delivering the payments platform rewrite
- Cut infrastructure spend by 30 percent through autoscaling and rightsizing
- Introduced service-level objectives and on-call runbooks across four teams

Software Engineer, Beta Inc — 2016 - 2020
- Developed microservices in Go and Python serving twelve internal products
- Reduced median API latency from 240 milliseconds to 90 milliseconds
- Migrated the monolith to containerized services on Kubernetes

Education
BS Computer Science, Massachusetts Institute of Technology — 2012 - 2016

Skills
Python, Go, Kubernetes, AWS, PostgreSQL, Terraform, Kafka, gRPC
`;

describe("computeParseQuality", () => {
  it("rates a clean, full resume 'good'", () => {
    const q = computeParseQuality(GOOD_RESUME);
    expect(q.verdict).toBe("good");
    expect(q.issues).toHaveLength(0);
    expect(q.wordCount).toBeGreaterThan(120);
  });

  it("flags a tiny, section-less extraction as poor", () => {
    const q = computeParseQuality("Jane");
    expect(q.verdict).toBe("poor"); // <120 words AND no sections => 2 issues
    expect(q.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag a non-Latin (CJK) resume as symbol-heavy", () => {
    const jp = "Summary Experience Skills Education " +
      "エンジニアとして大規模なシステムを構築し、信頼性とコスト効率を向上させました。".repeat(20);
    const q = computeParseQuality(jp);
    expect(q.issues).not.toContain("unusually low text-to-symbol ratio");
  });
});

describe("parseResumeStructure", () => {
  it("extracts sections, positions, span, and contact", () => {
    const s = parseResumeStructure(GOOD_RESUME);
    expect(s.sections).toContain("Experience");
    expect(s.sections).toContain("Education");
    expect(s.sections).toContain("Skills");
    expect(s.positionCount).toBeGreaterThanOrEqual(2);
    expect(s.experienceSpanYears).not.toBeNull();
    expect(s.experienceSpanYears as number).toBeGreaterThanOrEqual(8);
    expect(s.contact.email).toBe(true);
    expect(s.contact.phone).toBe(true);
    expect(s.contact.linkedin).toBe(true);
  });

  it("handles present/current end dates", () => {
    const s = parseResumeStructure("Engineer 2021 - Present\nAnalyst 2018 - 2021");
    expect(s.positionCount).toBe(2);
    expect(s.experienceSpanYears).not.toBeNull();
  });

  it("returns null span and zero positions when there are no dated roles", () => {
    const s = parseResumeStructure("A one-line note with no dates and no sections.");
    expect(s.positionCount).toBe(0);
    expect(s.experienceSpanYears).toBeNull();
  });
});

describe("formatStructureForPrompt", () => {
  it("lists detected facts and instructs the model to defer to the text", () => {
    const block = formatStructureForPrompt(parseResumeStructure(GOOD_RESUME));
    expect(block).toContain("deterministic_structure");
    expect(block).toContain("Sections detected:");
    expect(block).toContain("never flag as ABSENT");
  });
});
