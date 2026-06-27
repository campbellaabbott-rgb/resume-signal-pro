import { describe, it, expect } from "vitest";
import {
  createEmptyResume,
  createEmptyContact,
  createEmptyExperienceEntry,
  createEmptyEducationEntry,
  normalizeBuilderResume,
} from "./resume-builder";

describe("createEmptyResume", () => {
  it("starts with one blank experience and one blank education entry", () => {
    const resume = createEmptyResume();
    expect(resume.experience).toHaveLength(1);
    expect(resume.education).toHaveLength(1);
    expect(resume.skills).toEqual([]);
    expect(resume.certifications).toEqual([]);
    expect(resume.summary).toBe("");
  });

  it("contact starts fully blank", () => {
    expect(createEmptyResume().contact).toEqual(createEmptyContact());
  });
});

describe("createEmptyExperienceEntry", () => {
  it("has a single blank bullet to start", () => {
    const entry = createEmptyExperienceEntry();
    expect(entry.bullets).toEqual([""]);
  });

  it("generates a unique id per call", () => {
    const a = createEmptyExperienceEntry();
    const b = createEmptyExperienceEntry();
    expect(a.id).not.toBe(b.id);
  });
});

describe("createEmptyEducationEntry", () => {
  it("generates a unique id per call", () => {
    const a = createEmptyEducationEntry();
    const b = createEmptyEducationEntry();
    expect(a.id).not.toBe(b.id);
  });
});

describe("normalizeBuilderResume", () => {
  it("injects a unique id into every experience and education entry from raw AI data", () => {
    const raw = {
      contact: { fullName: "Jane Doe" },
      summary: "A summary",
      experience: [
        { company: "Acme", title: "Engineer", bullets: ["Did things"] },
        { company: "Globex", title: "Lead", bullets: ["Did other things"] },
      ],
      education: [{ school: "State U", degree: "B.S." }],
      skills: ["React"],
      certifications: [],
    };

    const result = normalizeBuilderResume(raw);

    expect(result.experience).toHaveLength(2);
    expect(result.experience[0].id).toBeTruthy();
    expect(result.experience[1].id).toBeTruthy();
    expect(result.experience[0].id).not.toBe(result.experience[1].id);
    expect(result.education[0].id).toBeTruthy();
  });

  it("falls back to one blank entry when the AI omits experience/education entirely", () => {
    const result = normalizeBuilderResume({ contact: {}, summary: "" });
    expect(result.experience).toHaveLength(1);
    expect(result.education).toHaveLength(1);
  });

  it("replaces an empty bullets array with a single blank bullet", () => {
    const result = normalizeBuilderResume({
      experience: [{ company: "Acme", title: "Engineer", bullets: [] }],
    });
    expect(result.experience[0].bullets).toEqual([""]);
  });

  it("handles completely empty/null input without throwing", () => {
    expect(() => normalizeBuilderResume(null)).not.toThrow();
    expect(() => normalizeBuilderResume(undefined)).not.toThrow();
    const result = normalizeBuilderResume(undefined);
    expect(result.skills).toEqual([]);
    expect(result.certifications).toEqual([]);
  });

  it("preserves real field values rather than only filling gaps", () => {
    const result = normalizeBuilderResume({
      contact: { fullName: "Jane Doe", email: "jane@example.com" },
      experience: [{ company: "Acme", title: "Engineer", location: "Remote", startDate: "2020", endDate: "Present", bullets: ["Shipped X"] }],
    });
    expect(result.contact.fullName).toBe("Jane Doe");
    expect(result.contact.email).toBe("jane@example.com");
    expect(result.experience[0].company).toBe("Acme");
    expect(result.experience[0].bullets).toEqual(["Shipped X"]);
  });
});
