// EVERY LOCALE STATES THE SAME CONVENTIONS PER COUNTRY (S14X-215).
//
// WHAT WAS WRONG. The localized CV-standards pages are hand translations of
// the English source, COUNTRY_STANDARDS, which the scan applies too. The
// German Austria page was not translated from it: it was Germany's list
// adapted. It dropped the source's second convention (formal titles such as
// Mag. and Dipl.-Ing. matter more than in Germany) and added one the source
// never says ("Zeugnisse werden erwartet"), so the German reader was told
// something the English page and the scan card do not say. Both lists had two
// entries, so a count alone could not see it.
//
// WHAT THIS HOLDS, for every localized country page:
//   1. it states as many conventions as the English source;
//   2. every abbreviation, level code and acronym an English convention names
//      (Mag., Dipl.-Ing., B2/C1, CABA, PDF) appears in its translation, so a
//      translation cannot drop the fact it rests on;
//   3. the Austrian page in German names the titles and makes no claim about
//      Zeugnisse the source does not make.
import { describe, expect, it } from "vitest";
import { COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan/country-standards";
import { CV_LOCALES } from "../data/cv-standards-content";

/**
 * The tokens a translation keeps as they are: a dotted academic abbreviation
 * (Mag., Dipl.-Ing.), a language-level code (B2/C1) and an all-capitals
 * acronym of three or more letters (CABA, PDF). "CV" is left out, since the
 * German pages rightly say "Lebenslauf".
 */
export function keptTokens(convention: string): string[] {
  const out = new Set<string>();
  for (const m of convention.matchAll(/\b[A-Z][a-z]{1,5}\.(?:-[A-Z][a-z]{1,5}\.)?/g)) out.add(m[0]);
  for (const m of convention.matchAll(/\b[A-C][12](?:\/[A-C][12])+\b/g)) out.add(m[0]);
  for (const m of convention.matchAll(/\b[A-Z]{3,}\b/g)) out.add(m[0]);
  return [...out];
}

const pages = Object.entries(CV_LOCALES).flatMap(([locale, cfg]) =>
  Object.entries(cfg.content).map(([iso, content]) => ({ locale, iso, content })));

describe("every locale states the same conventions per country (S14X-215)", () => {
  it("guards the guard: it reads every localized page, and the token reader finds what the sources name", () => {
    expect(pages.length).toBeGreaterThanOrEqual(16);
    expect(keptTokens("Formal titles (Mag., Dipl.-Ing.) matter more than in Germany")).toEqual(["Mag.", "Dipl.-Ing."]);
    expect(keptTokens("Languages section with levels (B2/C1) important")).toEqual(["B2/C1"]);
    expect(keptTokens("Norms vary by province; CABA mandates blind-CV-compatible hiring")).toEqual(["CABA"]);
    expect(keptTokens("Send PDF + lettre de motivation")).toEqual(["PDF"]);
    expect(keptTokens("Full Bewerbung = cover letter + CV + Zeugnisse (certificates)")).toEqual([]);
  });

  it("each localized country states as many conventions as the English source", () => {
    const off = pages
      .filter(({ iso, content }) => content.conventions.length !== (COUNTRY_STANDARDS[iso]?.conventions.length ?? -1))
      .map(({ locale, iso, content }) => `${locale}/${iso}: ${content.conventions.length} against ${COUNTRY_STANDARDS[iso]?.conventions.length}`);
    expect(off).toEqual([]);
  });

  it("each translation keeps every abbreviation, level code and acronym its English convention names", () => {
    const lost: string[] = [];
    for (const { locale, iso, content } of pages) {
      const english = COUNTRY_STANDARDS[iso]?.conventions ?? [];
      const said = content.conventions.join(" \n ");
      for (const c of english) for (const tok of keptTokens(c)) if (!said.includes(tok)) lost.push(`${locale}/${iso}: "${tok}" (from "${c}")`);
    }
    expect(lost).toEqual([]);
  });

  it("the Austrian page in German names the titles and adds no claim about Zeugnisse", () => {
    const at = CV_LOCALES.de.content.AT.conventions.join(" \n ");
    expect(at).toContain("Mag.");
    expect(at).toContain("Dipl.-Ing.");
    expect(at).not.toContain("Zeugnisse werden erwartet");
    expect(COUNTRY_STANDARDS.AT.conventions.join(" ")).not.toMatch(/Zeugnisse/);
  });
});
