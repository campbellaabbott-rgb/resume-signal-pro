import { describe, it, expect } from "vitest";
import { getFilterPhrase, getOutcomeMessage } from "./score-outcome-message";

describe("getFilterPhrase", () => {
  it("returns industry-specific phrasing for legal/finance/consulting", () => {
    expect(getFilterPhrase("legal")).toBe("rigid, compliance-style ATS screens");
    expect(getFilterPhrase("finance")).toBe("rigid, compliance-style ATS screens");
    expect(getFilterPhrase("consulting")).toBe("rigid, compliance-style ATS screens");
  });

  it("returns industry-specific phrasing for healthcare", () => {
    expect(getFilterPhrase("healthcare")).toBe("credential-focused applicant tracking systems");
    expect(getFilterPhrase("nursing")).toBe("credential-focused applicant tracking systems");
  });

  it("returns industry-specific phrasing for creative/marketing", () => {
    expect(getFilterPhrase("marketing")).toBe("automated filters before a recruiter ever sees it");
    expect(getFilterPhrase("creative")).toBe("automated filters before a recruiter ever sees it");
  });

  it("returns industry-specific phrasing for sales", () => {
    expect(getFilterPhrase("sales")).toBe("ATS systems screening hundreds of applicants per role");
  });

  it("is case-insensitive", () => {
    expect(getFilterPhrase("LEGAL")).toBe("rigid, compliance-style ATS screens");
  });

  it("falls back to generic phrasing for an unmatched/unknown industry", () => {
    expect(getFilterPhrase("technology")).toBe("automated ATS screens");
    expect(getFilterPhrase("")).toBe("automated ATS screens");
  });
});

describe("getOutcomeMessage", () => {
  it("returns a success status with strong-candidate framing for a high score", () => {
    const result = getOutcomeMessage(90, "technology");
    expect(result.status).toBe("success");
    expect(result.text).toContain("Strong candidate");
  });

  it("returns a success status with hedged framing for a good (but not excellent) score", () => {
    const result = getOutcomeMessage(75, "technology");
    expect(result.status).toBe("success");
    expect(result.text).toContain("Likely to clear");
  });

  it("returns a warning status for a borderline score", () => {
    const result = getOutcomeMessage(55, "technology");
    expect(result.status).toBe("warning");
    expect(result.text).toContain("At risk");
  });

  it("returns a destructive status for a low score", () => {
    const result = getOutcomeMessage(30, "technology");
    expect(result.status).toBe("destructive");
    expect(result.text).toContain("High risk");
  });

  it("incorporates the industry-specific filter phrase into the message", () => {
    const result = getOutcomeMessage(30, "legal");
    expect(result.text).toContain("rigid, compliance-style ATS screens");
  });

  it("never asserts a specific numeric probability (stays hedged, not fabricated precision)", () => {
    for (const score of [10, 40, 60, 95]) {
      const result = getOutcomeMessage(score, "technology");
      expect(result.text).not.toMatch(/\d+%/);
    }
  });
});
