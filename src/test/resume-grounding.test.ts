// The tailored resume's accuracy contract: the validator must catch invented
// employers/titles/schools/years (fatal) and strip unsupported skills/certs
// (reported), while never punishing legitimate rephrasing.
import { describe, it, expect } from "vitest";
import { validateTailoredResume, normalizeForMatch } from "../../supabase/functions/_shared/resume-grounding";

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
});
