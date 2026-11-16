// @vitest-environment node
/**
 * S14X-073, THE SHORTLIST RETENTION RULE ON THE TRUST PAGE (the owner's rule
 * A, 2026-11-15): an employer deletes a candidate or a role, and anything
 * still held four years after it was uploaded is deleted.
 *
 * The Trust page's retention table said a candidate's résumé stays in the
 * employer's account until the employer deletes it, in every language, while
 * no delete existed and the Shortlist page promised four years. The row now
 * names the delete of a candidate, a role or the account, and the four-year
 * purge, in all nine languages; the crawler's copy of /trust is printed from
 * the English row (scripts/prerender-seo.mjs), so it says the same.
 *
 * The row is a claim about code the shortlist lane builds (the delete RPCs and
 * the daily purge), so the second half of this file FAILS until that code is
 * on the branch: the row may not reach the page ahead of it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Lng = (typeof LNGS)[number];
const row = (l: Lng): string => {
  const d = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8"));
  return d?.trustPage?.retention?.rows?.shortlist?.howLong ?? "";
};

// What each language must name: the employer's delete of a candidate, a role
// or the account, and the four years.
const NAMES_THE_DELETE: Record<Lng, RegExp> = {
  en: /the candidate, the role or its account/,
  "en-GB": /the candidate, the role or its account/,
  de: /Kandidat.*, die Stelle oder sein Konto/,
  es: /al candidato, el puesto o su cuenta/,
  fr: /le candidat, le poste ou son compte/,
  hi: /उम्मीदवार, भूमिका या अपना खाता/,
  nl: /de kandidaat, de functie of zijn account/,
  pt: /o candidato, a vaga ou a conta/,
  tl: /ang kandidato, ang role o ang account/,
};
const FOUR_YEARS: Record<Lng, RegExp> = {
  en: /four years/, "en-GB": /four years/, de: /vier Jahre/, es: /cuatro años/, fr: /quatre ans/,
  hi: /चार साल/, nl: /vier jaar/, pt: /quatro anos/, tl: /apat na taon/,
};

describe("the Trust page's Shortlist row states rule A in every language", () => {
  it("names the employer's delete of a candidate, a role or the account, and the four-year purge", () => {
    for (const l of LNGS) {
      expect(row(l), `${l}: the delete`).toMatch(NAMES_THE_DELETE[l]);
      expect(row(l), `${l}: the four years`).toMatch(FOUR_YEARS[l]);
    }
  });

  it("reads, in English, exactly what the crawler's copy of /trust prints", () => {
    const en = "Until the employer deletes the candidate, the role or its account; anything still held four years after it was uploaded is deleted";
    expect(row("en")).toBe(en);
    expect(row("en-GB")).toBe(en);
  });
});

describe("the delete and the purge the row describes are on the branch with it", () => {
  const DIR = resolve(ROOT, "supabase/migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const code = (f: string) => readFileSync(resolve(DIR, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

  it("a migration gives the employer a delete for one candidate and one for a role", () => {
    expect(files.filter((f) => /FUNCTION public\.shortlist_delete_candidate\s*\(/i.test(code(f))), "the shortlist lane's rule-A file must merge first").not.toEqual([]);
    expect(files.filter((f) => /FUNCTION public\.shortlist_delete_role\s*\(/i.test(code(f))), "the shortlist lane's rule-A file must merge first").not.toEqual([]);
  });

  it("a migration schedules the purge of what has been held four years", () => {
    const purges = files.filter((f) => { const c = code(f); return /cron\.schedule\s*\(/.test(c) && /shortlist/i.test(c) && /4 years|four years|interval\s*'4 year/i.test(c); });
    expect(purges, "the shortlist lane's daily four-year purge must merge first").not.toEqual([]);
  });
});
