import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
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

describe("locale files", () => {
  // Regression test for a real bug: en.json (and 7 other locale files) had a
  // duplicate top-level "faq" key and a duplicate "socialProof" key. JSON.parse
  // silently keeps only the last occurrence, so the entire first "faq" block
  // (title, subtitle, all 8 Q&As) was discarded at runtime — the FAQ section
  // rendered raw translation keys like "faq.title" instead of real text, for
  // every language except the one untouched file. JSON.parse on the final object
  // can never catch this (it already hid the duplicate), so this test scans the
  // raw file text instead.
  const localesDir = join(dirname(fileURLToPath(import.meta.url)), "locales");
  const localeFiles = readdirSync(localesDir).filter((f) => f.endsWith(".json"));

  it("found at least one locale file to check", () => {
    expect(localeFiles.length).toBeGreaterThan(0);
  });

  for (const file of localeFiles) {
    it(`${file} has no duplicate top-level keys`, () => {
      const raw = readFileSync(join(localesDir, file), "utf8");
      const topLevelKeyPattern = /^ {2}"([a-zA-Z0-9_]+)":\s*[{[]/gm;
      const counts = new Map<string, number>();
      let match: RegExpExecArray | null;
      while ((match = topLevelKeyPattern.exec(raw))) {
        const key = match[1];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
      expect(duplicates, `Duplicate top-level keys in ${file} (later occurrence silently overwrites earlier content): ${JSON.stringify(duplicates)}`).toEqual([]);
    });

    it(`${file} is valid, parseable JSON`, () => {
      const raw = readFileSync(join(localesDir, file), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  }

  // Separate regression: every locale should have exactly the same set of leaf
  // keys as en.json. A key present in English but missing elsewhere falls back
  // silently (fallbackLng: 'en'), so it's lower severity than the duplicate-key
  // bug above, but it's still an untranslated string shown to users picking that
  // language — and it's exactly the kind of gap that's invisible unless checked
  // explicitly, since nothing throws or renders a raw key for it.
  function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
    let keys: string[] = [];
    for (const key of Object.keys(obj)) {
      const full = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        keys = keys.concat(flattenKeys(value as Record<string, unknown>, full));
      } else {
        keys.push(full);
      }
    }
    return keys;
  }

  const enKeys = new Set(flattenKeys(JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8"))));

  for (const file of localeFiles) {
    if (file === "en.json") continue;

    it(`${file} has the same translation keys as en.json (no missing, no extra)`, () => {
      const keys = new Set(flattenKeys(JSON.parse(readFileSync(join(localesDir, file), "utf8"))));
      const missing = [...enKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !enKeys.has(k));
      expect(missing, `${file} is missing keys present in en.json (will silently fall back to English text)`).toEqual([]);
      expect(extra, `${file} has keys not present in en.json (likely a typo, or en.json itself is missing this key)`).toEqual([]);
    });
  }
});
