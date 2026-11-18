import { describe, it, expect } from "vitest";
import { hasUnsupportedPdfCharacters, anyFieldHasUnsupportedPdfCharacters, sanitizeExportText, unsupportedPdfCharacters } from "./pdf-text-support";

describe("hasUnsupportedPdfCharacters", () => {
  it("does not flag plain English text", () => {
    expect(hasUnsupportedPdfCharacters("Senior Software Engineer with 8 years of experience.")).toBe(false);
  });

  it("does not flag Western European accented characters (within jsPDF's WinAnsi range)", () => {
    expect(hasUnsupportedPdfCharacters("Résumé for François Müller, café manager")).toBe(false);
  });

  it("does not flag common punctuation/symbols", () => {
    expect(hasUnsupportedPdfCharacters("Increased revenue by 30% — managed a team of 5 (2020-2023)")).toBe(false);
  });

  it("flags Cyrillic text", () => {
    expect(hasUnsupportedPdfCharacters("Старший инженер-программист")).toBe(true);
  });

  it("flags Devanagari (Hindi) text", () => {
    expect(hasUnsupportedPdfCharacters("वरिष्ठ सॉफ्टवेयर इंजीनियर")).toBe(true);
  });

  it("flags CJK text", () => {
    expect(hasUnsupportedPdfCharacters("软件工程师")).toBe(true);
  });

  it("flags Arabic text", () => {
    expect(hasUnsupportedPdfCharacters("مهندس برمجيات أول")).toBe(true);
  });

  it("flags emoji", () => {
    expect(hasUnsupportedPdfCharacters("Great teammate 🎉")).toBe(true);
  });

  it("handles empty string", () => {
    expect(hasUnsupportedPdfCharacters("")).toBe(false);
  });
});

describe("anyFieldHasUnsupportedPdfCharacters", () => {
  it("returns false when all fields are supported", () => {
    expect(anyFieldHasUnsupportedPdfCharacters(["Hello", "World", undefined, null, ""])).toBe(false);
  });

  it("returns true if any field has unsupported characters", () => {
    expect(anyFieldHasUnsupportedPdfCharacters(["Hello", "软件工程师", "World"])).toBe(true);
  });

  it("ignores undefined/null/empty fields", () => {
    expect(anyFieldHasUnsupportedPdfCharacters([undefined, null, ""])).toBe(false);
  });
});

// S14X-034: what an export draws first passes through sanitizeExportText, so a
// character nobody can see never decides the file format. The check itself
// is unchanged for the career-tools exporters, which do not sanitise.
describe("sanitizeExportText", () => {
  it("removes what cannot be seen and keeps what can", () => {
    expect(sanitizeExportText("Led\u200B the team\uFEFF")).toBe("Led the team");
    expect(sanitizeExportText("Résumé — “quoted” € 5½")).toBe("Résumé — “quoted” € 5½");
  });

  it("turns the soft breaks into line breaks", () => {
    expect(sanitizeExportText("one\u000Btwo\u2028three")).toBe("one\ntwo\nthree");
  });

  it("leaves the check itself as it was: a zero-width space alone is still undrawable", () => {
    expect(unsupportedPdfCharacters("a\u200Bb")).toEqual(["\u200B"]);
    expect(unsupportedPdfCharacters(sanitizeExportText("a\u200Bb"))).toEqual([]);
  });

  it("handles an empty string", () => {
    expect(sanitizeExportText("")).toBe("");
  });
});
