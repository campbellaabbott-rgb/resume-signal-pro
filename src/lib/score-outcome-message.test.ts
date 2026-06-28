import { describe, it, expect } from "vitest";
import { getFilterPhraseKey, getOutcomeTier, getOutcomeStatus, getOutcome } from "./score-outcome-message";

describe("getFilterPhraseKey", () => {
  it("returns 'compliance' for legal/finance/consulting", () => {
    expect(getFilterPhraseKey("legal")).toBe("compliance");
    expect(getFilterPhraseKey("finance")).toBe("compliance");
    expect(getFilterPhraseKey("consulting")).toBe("compliance");
  });

  it("returns 'credential' for healthcare", () => {
    expect(getFilterPhraseKey("healthcare")).toBe("credential");
    expect(getFilterPhraseKey("nursing")).toBe("credential");
  });

  it("returns 'recruiterScreen' for creative/marketing", () => {
    expect(getFilterPhraseKey("marketing")).toBe("recruiterScreen");
    expect(getFilterPhraseKey("creative")).toBe("recruiterScreen");
  });

  it("returns 'volume' for sales", () => {
    expect(getFilterPhraseKey("sales")).toBe("volume");
  });

  it("is case-insensitive", () => {
    expect(getFilterPhraseKey("LEGAL")).toBe("compliance");
  });

  it("falls back to 'generic' for an unmatched/unknown industry", () => {
    expect(getFilterPhraseKey("technology")).toBe("generic");
    expect(getFilterPhraseKey("")).toBe("generic");
  });
});

describe("getOutcomeTier / getOutcomeStatus", () => {
  it("returns 'strong' + success for a high score", () => {
    expect(getOutcomeTier(90)).toBe("strong");
    expect(getOutcomeStatus("strong")).toBe("success");
  });

  it("returns 'likely' + success for a good (but not excellent) score", () => {
    expect(getOutcomeTier(75)).toBe("likely");
    expect(getOutcomeStatus("likely")).toBe("success");
  });

  it("returns 'atRisk' + warning for a borderline score", () => {
    expect(getOutcomeTier(55)).toBe("atRisk");
    expect(getOutcomeStatus("atRisk")).toBe("warning");
  });

  it("returns 'highRisk' + destructive for a low score", () => {
    expect(getOutcomeTier(30)).toBe("highRisk");
    expect(getOutcomeStatus("highRisk")).toBe("destructive");
  });
});

describe("getOutcome", () => {
  it("combines tier, status, and filter phrase key", () => {
    expect(getOutcome(30, "legal")).toEqual({
      tier: "highRisk",
      status: "destructive",
      filterPhraseKey: "compliance",
    });
  });

  it("never returns a numeric probability — only language-agnostic keys", () => {
    const result = getOutcome(42, "sales");
    expect(typeof result.tier).toBe("string");
    expect(typeof result.filterPhraseKey).toBe("string");
  });
});
