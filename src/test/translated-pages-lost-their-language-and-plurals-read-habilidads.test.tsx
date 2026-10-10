import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import i18next from "i18next";
import { codeOf } from "./helpers/strip-comments";
import { useDocumentLang } from "@/hooks/use-document-lang";

/**
 * Two ways a translated page read wrong (register L4-14, L4-15):
 *  - the report's upsell bullets glued an English plural "s" onto translated
 *    nouns: "habilidads", "certificacións", "vaardigheids",
 *    "Branchenzertifizierungs", for every non-English user with more than one
 *    gap. They are i18next plurals now (_one/_other), so each language
 *    inflects its own noun;
 *  - /de/lebenslauf-standards/* and the other translated CV and Spanish
 *    industry pages were baked with lang="de" (or es, fr, pt, nl), and the app
 *    reset <html lang> to the visitor's UI language as soon as it ran.
 */

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "src/i18n/locales");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const KEYS = ["kwHard", "kwCerts", "kwTools", "kwMethodology"];

async function tFor(lng: string) {
  const inst = i18next.createInstance();
  await inst.init({ lng, resources: { [lng]: { translation: JSON.parse(readFileSync(resolve(DIR, `${lng}.json`), "utf8")) } }, interpolation: { escapeValue: false } });
  return inst.t.bind(inst);
}

describe("each language inflects its own plural", () => {
  it("no locale carries a glued {{plural}} on these bullets", () => {
    for (const f of files) {
      const li = JSON.parse(readFileSync(resolve(DIR, f), "utf8")).freeResults.lockedInsights;
      for (const k of KEYS) {
        expect(li[k], `${f}: the old single key is gone`).toBeUndefined();
        expect(li[`${k}_one`], `${f} ${k}_one`).toBeTruthy();
        expect(`${li[`${k}_one`]} ${li[`${k}_other`]}`, f).not.toContain("{{plural}}");
      }
    }
  });

  it("Spanish, Dutch and German say the plural word, never the noun plus s", async () => {
    const es = await tFor("es");
    expect(es("freeResults.lockedInsights.kwHard", { count: 3 })).toContain("3 habilidades técnicas críticas");
    expect(es("freeResults.lockedInsights.kwCerts", { count: 2 })).toContain("certificaciones");
    expect(es("freeResults.lockedInsights.kwHard", { count: 1 })).toContain("1 habilidad técnica crítica");
    const nl = await tFor("nl");
    expect(nl("freeResults.lockedInsights.kwHard", { count: 2 })).toContain("vaardigheden");
    const de = await tFor("de");
    expect(de("freeResults.lockedInsights.kwCerts", { count: 2 })).toContain("Branchenzertifizierungen");
    const en = await tFor("en");
    expect(en("freeResults.lockedInsights.kwTools", { count: 1 })).toContain("1 tool commonly");
    expect(en("freeResults.lockedInsights.kwTools", { count: 4 })).toContain("4 tools commonly");
  });

  it("the report passes only the count", () => {
    const c = codeOf(readFileSync(resolve(ROOT, "src/components/FreeKeywordResults.tsx"), "utf8"));
    expect(c).not.toMatch(/plural: realKeywordGapStats/);
  });
});

describe("a page written in one language keeps that language on <html>", () => {
  it("sets the page's language on mount and hands the attribute back on unmount", () => {
    document.documentElement.lang = "en";
    const { unmount } = renderHook(() => useDocumentLang("de"));
    expect(document.documentElement.lang).toBe("de");
    unmount();
    expect(document.documentElement.lang).not.toBe("de");
  });

  it("the translated CV pages and the Spanish industry pages use it", () => {
    expect(codeOf(readFileSync(resolve(ROOT, "src/pages/CvStandards.tsx"), "utf8"))).toMatch(/useDocumentLang\(cfg\?\.htmlLang \?\? "en"\)/);
    expect(codeOf(readFileSync(resolve(ROOT, "src/pages/IndustryKeywordsEs.tsx"), "utf8"))).toMatch(/useDocumentLang\("es"\)/);
  });
});
