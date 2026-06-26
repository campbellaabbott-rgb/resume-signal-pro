import { describe, it, expect } from "vitest";
import { normalizeLanguageCode, languages } from "./index";

describe("normalizeLanguageCode", () => {
  it("returns an exact match unchanged", () => {
    expect(normalizeLanguageCode("es")).toBe("es");
    expect(normalizeLanguageCode("en-GB")).toBe("en-GB");
  });

  it("falls back to the base language for unsupported regional variants", () => {
    expect(normalizeLanguageCode("es-MX")).toBe("es");
    expect(normalizeLanguageCode("fr-BE")).toBe("fr");
  });

  it("falls back to English for entirely unsupported languages", () => {
    expect(normalizeLanguageCode("ja")).toBe("en");
    expect(normalizeLanguageCode("xx-YY")).toBe("en");
  });

  it("every declared language code normalizes to itself", () => {
    for (const { code } of languages) {
      expect(normalizeLanguageCode(code)).toBe(code);
    }
  });
});
