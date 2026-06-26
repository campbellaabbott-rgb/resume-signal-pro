import { describe, it, expect, beforeEach } from "vitest";
import {
  saveResumeToSession,
  getResumeFromSession,
  clearResumeSession,
  hasResumeInSession,
  setMultiColumnDetectedInSession,
  getMultiColumnDetectedFromSession,
} from "./use-session-resume";

describe("use-session-resume", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns nulls when nothing has been saved", () => {
    expect(getResumeFromSession()).toEqual({
      resumeText: null,
      linkedInText: null,
      jobDescriptionText: null,
    });
    expect(hasResumeInSession()).toBe(false);
  });

  it("round-trips resume text", () => {
    saveResumeToSession("my resume text");
    expect(getResumeFromSession().resumeText).toBe("my resume text");
  });

  it("treats resume text under 50 chars as not present for hasResumeInSession", () => {
    saveResumeToSession("short text");
    expect(hasResumeInSession()).toBe(false);
  });

  it("treats resume text over 50 chars as present for hasResumeInSession", () => {
    saveResumeToSession("a".repeat(60));
    expect(hasResumeInSession()).toBe(true);
  });

  it("round-trips all three fields together", () => {
    saveResumeToSession("resume", "linkedin", "job description");
    expect(getResumeFromSession()).toEqual({
      resumeText: "resume",
      linkedInText: "linkedin",
      jobDescriptionText: "job description",
    });
  });

  it("does not overwrite linkedIn/job description with empty values", () => {
    saveResumeToSession("resume", "linkedin", "job description");
    saveResumeToSession("updated resume");
    // saveResumeToSession only writes a key when the value is truthy, so the
    // earlier linkedIn/job description values should still be present.
    expect(getResumeFromSession()).toEqual({
      resumeText: "updated resume",
      linkedInText: "linkedin",
      jobDescriptionText: "job description",
    });
  });

  it("clears all three fields", () => {
    saveResumeToSession("resume", "linkedin", "job description");
    clearResumeSession();
    expect(getResumeFromSession()).toEqual({
      resumeText: null,
      linkedInText: null,
      jobDescriptionText: null,
    });
    expect(hasResumeInSession()).toBe(false);
  });
});

describe("multiColumnDetected session storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns undefined when nothing has been set", () => {
    expect(getMultiColumnDetectedFromSession()).toBeUndefined();
  });

  it("round-trips true and false distinctly", () => {
    setMultiColumnDetectedInSession(true);
    expect(getMultiColumnDetectedFromSession()).toBe(true);

    setMultiColumnDetectedInSession(false);
    expect(getMultiColumnDetectedFromSession()).toBe(false);
  });

  it("clears the value when set to undefined", () => {
    setMultiColumnDetectedInSession(true);
    setMultiColumnDetectedInSession(undefined);
    expect(getMultiColumnDetectedFromSession()).toBeUndefined();
  });

  it("is cleared by clearResumeSession", () => {
    setMultiColumnDetectedInSession(true);
    clearResumeSession();
    expect(getMultiColumnDetectedFromSession()).toBeUndefined();
  });
});
