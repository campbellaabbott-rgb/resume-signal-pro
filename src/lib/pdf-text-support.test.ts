import { describe, it, expect } from "vitest";
import { hasUnsupportedPdfCharacters, anyFieldHasUnsupportedPdfCharacters } from "./pdf-text-support";

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
