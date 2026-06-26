import { describe, it, expect } from "vitest";
import {
  createEmptyResume,
  createEmptyContact,
  createEmptyExperienceEntry,
  createEmptyEducationEntry,
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
