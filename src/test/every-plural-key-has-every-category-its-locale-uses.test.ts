/**
 * EVERY PLURAL KEY HAS EVERY CATEGORY ITS LANGUAGE USES.
 *
 * i18next picks a plural suffix with Intl.PluralRules and looks up exactly
 * that key, then the bare key, then the fallback language. Spanish, French
 * and Portuguese have a third category, "many" (1,000,000 and the like), and
 * all 33 plural keys in those three files carried only _one and _other, so a
 * count of a million rendered the ENGLISH sentence to a Spanish reader.
 * Measured 2026-10-12 with Intl.PluralRules: es, fr and pt use one, many and
 * other; en, en-GB, de, nl, hi and tl use one and other.
 *
 * Checked over what a reader is served: each main locale file with its
 * string shards merged.
 */
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { leafKeys, type Bundle } from "@/i18n/merge-shards";
import { LOCALE_FILES, readLocale } from "./helpers/locale-strings";

const SUFFIX = /_(zero|one|two|few|many|other)$/;

const intlLocale = (lng: string) => (lng === "tl" ? "fil" : lng);
const categories = (lng: string) =>
  new Intl.PluralRules(intlLocale(lng)).resolvedOptions().pluralCategories.filter((c) => c !== "zero");

function groups(bundle: Bundle): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const k of leafKeys(bundle)) {
    const m = k.match(SUFFIX);
    if (!m) continue;
    const base = k.slice(0, -m[0].length);
    if (!out.has(base)) out.set(base, new Set());
    out.get(base)!.add(m[1]);
  }
  return out;
}

describe("plural categories per language", () => {
  it("the measured categories are the ones this guard expects", () => {
    expect(categories("es")).toEqual(["one", "many", "other"]);
    expect(categories("fr")).toEqual(["one", "many", "other"]);
    expect(categories("pt")).toEqual(["one", "many", "other"]);
    for (const l of ["en", "en-GB", "de", "nl", "hi", "tl"]) expect(categories(l), l).toEqual(["one", "other"]);
  });

  it("the sweep reads nine languages and finds plural keys in them", () => {
    expect(LOCALE_FILES.length).toBe(9);
    expect(groups(readLocale("en.json")).size).toBeGreaterThan(10);
  });

  for (const file of LOCALE_FILES) {
    const lng = file.replace(/\.json$/, "");
    it(`${file}: every plural key carries ${categories(lng).join(", ")}`, () => {
      const need = categories(lng);
      const gaps: string[] = [];
      for (const [base, have] of groups(readLocale(file))) {
        for (const c of need) if (!have.has(c)) gaps.push(`${base}_${c}`);
      }
      expect(gaps).toEqual([]);
    });
  }

  it("positive control: a million in Spanish resolves to Spanish, not the English fallback", async () => {
    const es = (await import("@/i18n/locales/es.json")).default as Bundle;
    i18n.addResourceBundle("es", "translation", es, true, true);
    const en = i18n.t("uploader.otherJobsAvailable", { lng: "en", count: 1_000_000 });
    const sp = i18n.t("uploader.otherJobsAvailable", { lng: "es", count: 1_000_000 });
    expect(new Intl.PluralRules("es").select(1_000_000)).toBe("many");
    expect(sp).not.toBe(en);
  });
});
