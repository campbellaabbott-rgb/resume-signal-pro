// The tailored resume's accuracy contract: the validator must catch invented
// employers/titles/schools/years (fatal) and strip unsupported skills/certs
// (reported), while never punishing legitimate rephrasing.
import { describe, it, expect } from "vitest";
import {
  validateTailoredResume,
  normalizeForMatch,
  unsupportedNumericClaims,
  validateProseClaims,
} from "../../supabase/functions/_shared/resume-grounding";

const SOURCE = `
Jane Doe — Senior Software Engineer
jane@example.com · Berlin, Germany

EXPERIENCE
Senior Software Engineer, Acme Analytics GmbH — Berlin (2019 – 2023)
- Built streaming data pipelines in Python and Kafka serving 2M events/day
- Led migration to Kubernetes, cutting infra spend 30%
Software Engineer, DataWorks Ltd (2016 – 2019)
- Shipped React dashboards; introduced TypeScript across the team

EDUCATION
B.Sc. Computer Science, Technical University of Munich, 2012 – 2016

SKILLS: Python, Kafka, Kubernetes, React, TypeScript, SQL, Café-de-Flore POS
CERTIFICATIONS: AWS Certified Solutions Architect (2021)
`;

const base = () => ({
  contact: { fullName: "Jane Doe", title: "Senior Software Engineer", email: "jane@example.com", phone: "", location: "Berlin", linkedIn: "", website: "" },
  summary: "Engineer with streaming data expertise.",
  experience: [
    { company: "Acme Analytics GmbH", title: "Sr. Software Eng", location: "Berlin", startDate: "2019", endDate: "2023", bullets: ["Built pipelines"] },
    { company: "DataWorks Ltd", title: "Software Engineer", location: "", startDate: "2016", endDate: "2019", bullets: ["Shipped dashboards"] },
  ],
  education: [
    { school: "Technical University of Munich", degree: "B.Sc.", field: "Computer Science", startDate: "2012", endDate: "2016", details: "" },
  ],
  skills: ["Python", "Kafka", "kubernetes", "React"],
  certifications: ["AWS Certified Solutions Architect"],
});

describe("validateTailoredResume", () => {
  it("passes a faithful tailoring, including reformatted titles and case-shifted skills", () => {
    const r = validateTailoredResume(SOURCE, base());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.removedSkills).toEqual([]);
    expect(r.cleaned.skills).toContain("kubernetes");
  });

  it("fatally rejects an invented employer", () => {
    const resume = base();
    resume.experience[0].company = "Google";
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toContain("Google");
  });

  it("fatally rejects a title the candidate never held", () => {
    const resume = base();
    resume.experience[1].title = "Chief Marketing Officer";
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(false);
  });

  it("fatally rejects years that appear nowhere in the source", () => {
    const resume = base();
    resume.experience[0].startDate = "2010";
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toContain("2010");
  });

  it("fatally rejects an invented school", () => {
    const resume = base();
    resume.education[0].school = "Harvard University";
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(false);
  });

  it("strips unsupported skills and certifications without failing the run", () => {
    const resume = base();
    resume.skills.push("Rust", "Terraform");
    resume.certifications.push("PMP");
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(true);
    expect(r.removedSkills).toEqual(["Rust", "Terraform"]);
    expect(r.removedCertifications).toEqual(["PMP"]);
    expect(r.cleaned.skills).not.toContain("Rust");
    expect(r.cleaned.certifications).toEqual(["AWS Certified Solutions Architect"]);
  });

  it("matches across accents and punctuation", () => {
    const resume = base();
    resume.skills = ["Cafe de Flore POS"];
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.cleaned.skills).toEqual(["Cafe de Flore POS"]);
    expect(normalizeForMatch("Café-de-Flore")).toBe("cafe de flore");
  });

  it("fatally rejects a bullet decorated with an invented percentage", () => {
    const resume = base();
    resume.experience[0].bullets = ["Boosted conversion 47% through pipeline optimization"];
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toContain('"47%"');
  });

  it("fatally rejects an invented figure in the summary", () => {
    const resume = base();
    resume.summary = "Engineer who saved $1.2M in annual infrastructure costs.";
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toContain("summary");
  });

  it("accepts bullets that reuse figures the source actually contains", () => {
    const resume = base();
    resume.experience[0].bullets = [
      "Built streaming pipelines serving 2M events/day",
      "Cut infra spend 30% by leading the Kubernetes migration",
    ];
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("allows small structural counts and source years in bullets", () => {
    const resume = base();
    resume.experience[0].bullets = ["Mentored 4 engineers across 2 teams since 2019"];
    const r = validateTailoredResume(SOURCE, resume);
    expect(r.ok).toBe(true);
  });
});

describe("unsupportedNumericClaims", () => {
  const src = "Increased revenue by 32 percent; managed a $500,000 budget; 7 years in analytics since 2016.";

  it("flags percentages, dollar amounts, multipliers, and magnitudes absent from the source", () => {
    const bad = unsupportedNumericClaims(src, "Drove 45% growth, saved $2.3M, achieved 3x throughput on 10k users");
    expect(bad).toContain("45%");
    expect(bad).toContain("$2.3M");
    expect(bad).toContain("3x");
    expect(bad).toContain("10k");
  });

  it('supports "32%" in the output via "32 percent" in the source', () => {
    expect(unsupportedNumericClaims(src, "Grew revenue 32%")).toEqual([]);
  });

  it("matches currency across comma formatting", () => {
    expect(unsupportedNumericClaims(src, "Managed a $500,000 budget")).toEqual([]);
  });

  it("ignores small bare integers and years", () => {
    expect(unsupportedNumericClaims(src, "Led 3 stakeholders and 2 vendors starting 2016")).toEqual([]);
  });

  it("flags large bare integers that appear nowhere in the source", () => {
    expect(unsupportedNumericClaims(src, "Processed 84000 records daily")).toContain("84000");
  });
});

describe("validateProseClaims", () => {
  it("passes a clean cover letter and fails a decorated one", () => {
    const src = "Software engineer. Cut costs 30% at Acme.";
    expect(validateProseClaims(src, "I cut costs 30% at Acme and would love this role.")).toEqual([]);
    const issues = validateProseClaims(src, "I increased sales 250% and managed $4M budgets.");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("250%");
    expect(issues.join(" ")).toContain("$4M");
  });
});
