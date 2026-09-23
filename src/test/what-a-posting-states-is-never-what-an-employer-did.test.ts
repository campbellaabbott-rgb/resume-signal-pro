/**
 * WHAT A POSTING STATES IS NEVER WHAT AN EMPLOYER DID -- IN EVERY LANGUAGE.
 *
 * The Ontario ESA panel quotes a posting's own words against four clauses of
 * Part III.1 and stops there, because O. Reg. 476/24 s.1 exempts an employer
 * under a headcount threshold and this board holds no headcount for anyone.
 * The restraint is a COPY rule, so it has to hold in nine languages: a
 * conclusion written in Hindi is invisible to an English regex, and a
 * translator never sees this test.
 *
 * Four properties, per language:
 *
 *   1. Every key English has, the language has, and no extras -- there is no
 *      exemption list here, because the parity lists in src/i18n/index.test.ts
 *      end empty by project rule and a second list beside them would be the
 *      same mute button under another name.
 *   2. No value states a conclusion about an employer, by a regex written for
 *      THAT language, and no value carries a percent sign -- this surface has
 *      no share to state and the measured share it would have used was wrong
 *      by roughly 24 points.
 *   3. Every placeholder in the English value survives the translation, and
 *      none is invented; and every placeholder English uses is one the
 *      component actually supplies.
 *   4. The two numbers that come from the regulation -- its headcount
 *      threshold and its annual compensation ceiling -- are NEVER typed into
 *      a value. They are interpolated from ONTARIO_ESA, so a change to the
 *      regulation cannot leave nine stale translations behind, which is
 *      exactly how the "no subscriptions" copy went false here once before.
 *
 * Each check is proven to fire on a doctored copy of a locale.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ONTARIO_ESA } from "../components/jobs/OntarioEsaDisclosures";

const DIR = resolve(__dirname, "../i18n/locales");
const LOCALES = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
type Bundle = Record<string, Record<string, string>>;
const load = (l: string): Bundle => JSON.parse(readFileSync(resolve(DIR, `${l}.json`), "utf8"));

/** The panel's section, flat. */
export function esaKeys(b: Bundle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.ontarioEsa ?? {})) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * A conclusion about an employer, in each language's own words. Plain
 * case-insensitive substrings rather than word boundaries: JS \b is ASCII, so
 * an anchor around "Verstoß" or "infração" does not mean what it looks like.
 */
export const VERDICT_WORDS: Record<string, string[]> = {
  en: ["illegal", "unlawful", "violat", "non-compliant", "noncompliant", "non-compliance", "breach", "offence", "penalt", "guilty", "broke the law", "breaking the law", "failed to comply"],
  "en-GB": ["illegal", "unlawful", "violat", "non-compliant", "noncompliant", "non-compliance", "breach", "offence", "penalt", "guilty", "broke the law", "breaking the law", "failed to comply"],
  de: ["illegal", "rechtswidrig", "gesetzwidrig", "verstoß", "verstoss", "nicht konform", "strafe", "bußgeld", "bussgeld", "schuldig"],
  es: ["ilegal", "ilícit", "ilicit", "infracci", "infracc", "incumpl", "sanci", "multa", "culpable"],
  fr: ["illégal", "illegal", "illicite", "infraction", "non conforme", "non-conforme", "manquement", "sanction", "amende", "coupable"],
  hi: ["अवैध", "गैरकानूनी", "उल्लंघन", "अनुपालन नहीं", "जुर्माना", "दंड", "दोषी"],
  nl: ["illegaal", "onwettig", "overtreding", "niet conform", "schending", "boete", "sanctie", "schuldig"],
  pt: ["ilegal", "ilícit", "ilicit", "infraç", "infrac", "incumprimento", "descumprimento", "não conform", "sanç", "multa", "culpado"],
  tl: ["ilegal", "paglabag", "labag", "parusa", "multa", "nagkasala"],
};

/** A sentence in each language that MUST trip the list above. */
const VERDICT_SAMPLE: Record<string, string> = {
  en: "this employer is in violation of the Act",
  "en-GB": "this employer is in violation of the Act",
  de: "ein Verstoß des Arbeitgebers",
  es: "una infracción del empleador",
  fr: "une infraction de l'employeur",
  hi: "नियोक्ता का उल्लंघन",
  nl: "een overtreding door de werkgever",
  pt: "uma infração do empregador",
  tl: "isang paglabag ng employer",
};

const placeholders = (v: string) => [...v.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

/** The regulation's own numbers, in any of the ways nine locales write them. */
const TYPED_THRESHOLD = new RegExp(`\\b${ONTARIO_ESA.minEmployees}\\b`);
const TYPED_CEILING = /200[.,   ]?000/;

/** Everything one locale gets wrong, as named findings. */
export function findings(locale: string, en: Record<string, string>, other: Record<string, string>): string[] {
  const f: string[] = [];
  const words = VERDICT_WORDS[locale];
  if (!words) f.push(`no verdict-word list for ${locale}`);
  for (const [k, enV] of Object.entries(en)) {
    const v = other[k];
    if (v === undefined) { f.push(`${k}: missing`); continue; }
    const low = v.toLowerCase();
    for (const w of words ?? []) if (low.includes(w.toLowerCase())) f.push(`${k}: states a conclusion ("${w}")`);
    if (v.includes("%")) f.push(`${k}: a percentage on a surface that has no share to state`);
    const want = placeholders(enV), got = placeholders(v);
    for (const p of want) if (!got.includes(p)) f.push(`${k}: placeholder {{${p}}} dropped`);
    for (const p of got) if (!want.includes(p)) f.push(`${k}: placeholder {{${p}}} invented`);
    if (TYPED_THRESHOLD.test(v)) f.push(`${k}: the regulation's headcount threshold is typed, not interpolated`);
    if (TYPED_CEILING.test(v)) f.push(`${k}: the regulation's compensation ceiling is typed, not interpolated`);
  }
  for (const k of Object.keys(other)) if (!(k in en)) f.push(`${k}: not in English`);
  return f;
}

const EN = esaKeys(load("en"));
/** Prose long enough that an untranslated copy is a real gap, not a shared
 *  proper noun like the citation of a regulation. */
const PROSE = ["title", "basis", "payAbsent", "vacancyAbsent", "notAFinding", "exclusions", "postingLink", "sourceLine"];

describe("what a posting states is never what an employer did, in every language", () => {
  it("covers all nine locales and found the panel's copy (guards the guard)", () => {
    expect(LOCALES).toEqual(["de", "en", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]);
    expect(Object.keys(EN).length, "the Ontario panel's copy is missing from en.json").toBeGreaterThanOrEqual(20);
    for (const k of ["title", "basis", "payLabel", "payStated", "payAbsent", "payBasisSalaryField", "payBasisDescription",
      "vacancyLabel", "vacancyStated", "vacancyAbsent", "aiLabel", "aiStated", "canadianExperienceLabel",
      "canadianExperienceStated", "notAFinding", "exclusions", "statuteLink", "regLink", "postingLink", "sourceLine"]) {
      expect(EN, `ontarioEsa.${k} is missing from en.json`).toHaveProperty(k);
    }
  });

  it("English itself states no conclusion, types neither regulation number, and prints no share", () => {
    expect(findings("en", EN, EN)).toEqual([]);
  });

  for (const locale of ["de", "en", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]) {
    it(`${locale} carries the panel unchanged in meaning`, () => {
      expect(findings(locale, EN, esaKeys(load(locale)))).toEqual([]);
    });
  }

  it("the seven non-English locales really were translated", () => {
    // A locale pass that "landed" by copying English is the failure mode the
    // exemption lists in src/i18n/index.test.ts exist to make visible; this
    // is the same check for this section, with no list to leave populated.
    for (const locale of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const other = esaKeys(load(locale));
      const untranslated = PROSE.filter((k) => other[k] === EN[k]);
      expect(untranslated, `${locale} still carries the English text for: ${untranslated.join(", ")}`).toEqual([]);
    }
  });

  it("every placeholder the copy uses is one the component supplies", () => {
    const code = readFileSync(resolve(__dirname, "../components/jobs/OntarioEsaDisclosures.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const used = new Set(Object.values(EN).flatMap(placeholders));
    expect(used.size, "no placeholders found -- the assertion below would be vacuous").toBeGreaterThan(0);
    for (const p of used) {
      expect(code, `the copy interpolates {{${p}}} but the component never passes it`).toMatch(new RegExp(`\\b${p}\\b`));
    }
    // And the two regulation numbers reach the copy from the mirrored config.
    expect(code).toMatch(/minEmployees:\s*ONTARIO_ESA\.minEmployees/);
    expect(code).toMatch(/ONTARIO_ESA\.compensationExemptCad/);
  });
});

describe("the findings function fires (teeth)", () => {
  it("catches a conclusion in each language's own spelling", () => {
    for (const locale of LOCALES) {
      const doctored = { ...esaKeys(load(locale)), notAFinding: VERDICT_SAMPLE[locale] };
      const f = findings(locale, EN, doctored);
      expect(f.some((x) => x.startsWith("notAFinding: states a conclusion")), `${locale}: the verdict list never fired`).toBe(true);
    }
  });

  it("catches a dropped placeholder, an invented one, a typed regulation number and a percentage", () => {
    const en = { ...EN };
    expect(findings("en", en, { ...en, notAFinding: "no numbers here at all" }))
      .toContain("notAFinding: placeholder {{minEmployees}} dropped");
    expect(findings("en", en, { ...en, title: "a title with {{surprise}}" }))
      .toContain("title: placeholder {{surprise}} invented");
    expect(findings("en", en, { ...en, notAFinding: "fewer than 25 employees {{minEmployees}}" }))
      .toContain("notAFinding: the regulation's headcount threshold is typed, not interpolated");
    expect(findings("en", en, { ...en, exclusions: "above $200,000 a year {{ceiling}}" }))
      .toContain("exclusions: the regulation's compensation ceiling is typed, not interpolated");
    expect(findings("en", en, { ...en, title: "stated on 54% of postings" }))
      .toContain("title: a percentage on a surface that has no share to state");
    expect(findings("en", en, { ...en, extraKey: "x" } as Record<string, string>))
      .toContain("extraKey: not in English");
  });

  it("does not fire on the Act's own year, which is not the ceiling", () => {
    // "Employment Standards Act, 2000" must not read as 200,000.
    expect(TYPED_CEILING.test("Employment Standards Act, 2000, Part III.1")).toBe(false);
    expect(TYPED_CEILING.test("200 000")).toBe(true);
    expect(TYPED_CEILING.test("200.000")).toBe(true);
  });
});
