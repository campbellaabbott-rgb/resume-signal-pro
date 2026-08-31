import { describe, it, expect } from "vitest";
import { buildLanguageInstruction } from "../../../supabase/functions/_shared/language-instruction";

describe("buildLanguageInstruction", () => {
  it("returns an empty string for English (no need to instruct the default)", () => {
    expect(buildLanguageInstruction("en")).toBe("");
  });

  it("returns an empty string when no language is provided", () => {
    expect(buildLanguageInstruction(undefined)).toBe("");
  });

  it("returns a clear instruction naming the language for Spanish", () => {
    const result = buildLanguageInstruction("es");
    expect(result).toContain("Spanish");
    expect(result.toLowerCase()).toContain("respond entirely in");
  });

  it("maps every supported locale code to a real language name, not the raw code", () => {
    for (const code of ["en-GB", "es", "hi", "tl", "de", "fr", "fr-CA", "nl", "pt"]) {
      const result = buildLanguageInstruction(code);
      expect(result).not.toContain(`in ${code}.`); // would indicate a missing name mapping
    }
  });

  it("falls back to echoing an unrecognized code rather than throwing", () => {
    expect(() => buildLanguageInstruction("xx")).not.toThrow();
    expect(buildLanguageInstruction("xx")).toContain("xx");
  });
});
