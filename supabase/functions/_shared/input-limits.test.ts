import { describe, it, expect } from "vitest";
import { checkInputLimits, MAX_RESUME_LENGTH, MAX_JOB_DESCRIPTION_LENGTH } from "./input-limits";

// Regression coverage for the public-generator input cap (bounds per-call AI
// token cost). Rule: no fix without a test that would have caught its absence.
describe("checkInputLimits", () => {
  it("passes normal-sized inputs", () => {
    expect(checkInputLimits({ resumeText: "a".repeat(3000), jobDescription: "b".repeat(1500) })).toBeNull();
  });

  it("ignores absent or non-string fields (never throws)", () => {
    expect(checkInputLimits({})).toBeNull();
    expect(checkInputLimits({ resumeText: undefined })).toBeNull();
    expect(checkInputLimits({ resumeText: 123 as unknown })).toBeNull();
  });

  it("accepts a resume exactly at the cap, rejects one char over (boundary)", () => {
    expect(checkInputLimits({ resumeText: "x".repeat(MAX_RESUME_LENGTH) })).toBeNull();
    expect(checkInputLimits({ resumeText: "x".repeat(MAX_RESUME_LENGTH + 1) })).toContain("Resume text is too long");
  });

  it("rejects an over-length job description", () => {
    expect(checkInputLimits({ jobDescription: "x".repeat(MAX_JOB_DESCRIPTION_LENGTH + 1) })).toContain("Job description is too long");
  });

  it("reports the resume cap first when both inputs are over", () => {
    const err = checkInputLimits({
      resumeText: "x".repeat(MAX_RESUME_LENGTH + 1),
      jobDescription: "y".repeat(MAX_JOB_DESCRIPTION_LENGTH + 1),
    });
    expect(err).toContain("Resume text is too long");
  });
});
