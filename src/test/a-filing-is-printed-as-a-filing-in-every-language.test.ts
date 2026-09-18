/**
 * A FILING IS PRINTED AS A FILING, IN EVERY LANGUAGE.
 *
 * The rule (SPEC section 7): a layoff filing prints as a filing -- the filer
 * as the source names it, a date, a count, a state or a form, a link -- with
 * no adjective and no verdict. Eight words are banned inside every layoff key,
 * in each language's own spelling: ghost, fake, real, quality, legit, live,
 * real time, now. The first six turn a filing into a judgement about the
 * role; the last two claim a speed we do not have (EDGAR is read hourly, the
 * state side is days behind by construction, NY two months).
 *
 * Digits are interpolated, never typed: every number and date a layoff line
 * prints is a placeholder rendered from src/config/layoffs.ts or from the
 * row, so a translator cannot state a stale bar and cannot drop a date. This
 * file therefore asserts, per language:
 *
 *   1. every layoff key English has, the language has (no exemption list --
 *      the i18n parity guard's lists END EMPTY; project rule);
 *   2. the banned words are absent, by a regex written for THAT language --
 *      a denial in Hindi is invisible to an English regex;
 *   3. every placeholder in the English value is in the translation, and the
 *      translation adds none English lacks;
 *   4. no calendar date and no bare threshold digit is typed into a value
 *      that should be rendering a placeholder.
 *
 * Each check is proven to fire on a doctored copy of one locale.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../i18n/locales");
const LOCALES = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
type Bundle = Record<string, Record<string, string>>;
const load = (l: string): Bundle => JSON.parse(readFileSync(resolve(DIR, `${l}.json`), "utf8"));

/** Every `<section>.<key>` whose key starts with `layoff`, plus the lander's "Also on record" label. */
export function layoffKeys(b: Bundle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [section, keys] of Object.entries(b)) {
    if (typeof keys !== "object" || keys === null) continue;
    for (const [k, v] of Object.entries(keys)) {
      if (typeof v !== "string") continue;
      if (/^layoff/i.test(k) || k === "hhAlsoOnRecord") out[`${section}.${k}`] = v;
    }
  }
  return out;
}

/**
 * The banned words, per language. Latin scripts use word boundaries; Hindi
 * uses plain substrings because JS \b is ASCII-only. Each list carries the
 * language's spellings of: ghost, fake, real, quality, legit, live, real time,
 * now.
 */
export const BANNED: Record<string, RegExp> = {
  en: /\b(ghost|fake|real[ -]?time|real|quality|legit|legitimate|live|now)\b/i,
  "en-GB": /\b(ghost|fake|real[ -]?time|real|quality|legit|legitimate|live|now)\b/i,
  de: /\b(geist|gefälscht|gefaelscht|fake|echt|echte[nrsm]?|qualität|qualitaet|legitim|live|echtzeit|jetzt)\b/i,
  es: /\b(fantasma|falso|falsa|real|reales|calidad|legítimo|legitimo|legítima|en vivo|en directo|tiempo real|ahora)\b/i,
  fr: /\b(fantôme|fantome|faux|fausse|réel|reel|réelle|reelle|qualité|qualite|légitime|legitime|en direct|temps réel|temps reel|maintenant)\b/i,
  hi: /(भूत|नकली|फ़र्ज़ी|फर्जी|असली|वास्तविक|गुणवत्ता|वैध|लाइव|रीयल टाइम|रियल टाइम|अभी)/,
  nl: /\b(spook|nep|echt|echte|kwaliteit|legitiem|live|realtime|real-time|nu)\b/i,
  pt: /\b(fantasma|falso|falsa|real|reais|qualidade|legítimo|legitimo|legítima|ao vivo|tempo real|agora)\b/i,
  tl: /\b(multo|peke|pekeng|totoo|tunay|kalidad|lehitimo|live|real[ -]?time|real|ngayon)\b/i,
};

const placeholders = (v: string) => [...v.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
const CALENDAR_DATE = /\b20\d\d-\d\d-\d\d\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/;

/** Everything one locale gets wrong against English, as named findings. */
export function findings(locale: string, en: Record<string, string>, other: Record<string, string>): string[] {
  const f: string[] = [];
  const re = BANNED[locale];
  if (!re) f.push(`no banned-word regex for ${locale}`);
  for (const [k, enV] of Object.entries(en)) {
    const v = other[k];
    if (v === undefined) { f.push(`${k}: missing`); continue; }
    if (re) {
      const hit = v.match(re);
      if (hit) f.push(`${k}: banned word "${hit[0]}"`);
    }
    const want = placeholders(enV), got = placeholders(v);
    for (const p of want) if (!got.includes(p)) f.push(`${k}: placeholder {{${p}}} dropped`);
    for (const p of got) if (!want.includes(p)) f.push(`${k}: placeholder {{${p}}} invented`);
    if (CALENDAR_DATE.test(v)) f.push(`${k}: a calendar date is typed into the copy`);
  }
  return f;
}

/** A threshold typed as a digit where a placeholder should be. 30 (the day-30 cap) and 8-K/2.05 (form names) are nouns, not thresholds. */
export function typedThresholds(en: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(en)) {
    const digits = [...v.replace(/\{\{[^}]*\}\}/g, "").replace(/8-K|2\.05|30-day|within 30 days/g, "").matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => m[0]);
    if (digits.length) out.push(`${k}: typed number(s) ${digits.join(", ")}`);
  }
  return out;
}

describe("a filing is printed as a filing, in every language", () => {
  const en = layoffKeys(load("en"));

  it("covers all nine locales and found the layoff copy (guards the guard)", () => {
    expect(LOCALES).toEqual(["de", "en", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]);
    expect(Object.keys(en).length, "no layoff keys in en.json -- lane D's copy has not landed or was renamed").toBeGreaterThanOrEqual(16);
    for (const k of ["jobsPage.layoffChipWarn", "jobsPage.layoffChipSec", "jobsPage.layoffTip", "jobsPage.layoffLineWarnNoticed", "jobsPage.layoffLineSecPct",
      "jobsPage.layoffParent", "jobsPage.layoffRead", "jobsPage.layoffReadStale", "jobsPage.layoffMore", "jobsPage.hhAlsoOnRecord",
      "ghostIndex.layoffTitle", "ghostIndex.layoffSentence", "ghostIndex.layoffUnavailable", "ghostIndex.layoffReasonEmployers", "ghostIndex.layoffReasonShare",
      "ghostIndex.layoffReasonN", "ghostIndex.layoffReasonWidth", "ghostIndex.layoffReasonStale", "ghostIndex.layoffLag"]) {
      expect(en, `${k} is missing from en.json`).toHaveProperty(k);
    }
  });

  it("English itself: no banned word, no typed threshold, no calendar date", () => {
    expect(findings("en", en, en)).toEqual([]);
    expect(typedThresholds(en)).toEqual([]);
  });

  it("every threshold the copy prints is a placeholder the config renders", () => {
    // The spec's list: a translator cannot drop a number or a date.
    const must: Record<string, string[]> = {
      "jobsPage.layoffLineWarnNoticed": ["filer", "state", "noticeDate", "workers", "site", "visibleDate", "agency", "sourceName"],
      "jobsPage.layoffLineWarnReceived": ["filer", "agency", "visibleDate", "workers", "site", "sourceName"],
      "jobsPage.layoffLineSecPct": ["filer", "pct", "reportDate", "filedDate"],
      "jobsPage.layoffLineSecCount": ["filer", "headcount", "reportDate", "filedDate"],
      "jobsPage.layoffLineSecNoNumber": ["filer", "reportDate", "filedDate"],
      "jobsPage.layoffTip": ["filer", "eventDate", "sourceName", "readAgo"],
      "jobsPage.layoffReadStale": ["readAt"],
      "ghostIndex.layoffSentence": ["lookback", "rFiled", "cohortFrom", "cohortTo", "nFiled", "eFiled", "hwFiled", "rControl", "nControl", "hwControl"],
      "ghostIndex.layoffReasonEmployers": ["minEmployers"],
      "ghostIndex.layoffReasonShare": ["maxShare"],
      "ghostIndex.layoffReasonN": ["minN"],
      "ghostIndex.layoffReasonWidth": ["maxHw"],
      "ghostIndex.layoffReasonStale": ["computedAt"],
      "ghostIndex.layoffLag": ["p50", "measuredOn"],
    };
    for (const [k, ps] of Object.entries(must)) {
      const got = placeholders(en[k] ?? "");
      for (const p of ps) expect(got, `${k} must interpolate {{${p}}}`).toContain(p);
    }
  });

  for (const locale of LOCALES.filter((l) => l !== "en")) {
    it(`${locale}: every key present, no banned word in its own spelling, every placeholder kept`, () => {
      expect(findings(locale, en, layoffKeys(load(locale)))).toEqual([]);
    });
  }

  it("the two dates and the read stamp are on every filing line, and the filer is verbatim (a placeholder, never a typed name)", () => {
    for (const k of ["jobsPage.layoffLineWarnNoticed", "jobsPage.layoffLineWarnReceived", "jobsPage.layoffLineSecPct", "jobsPage.layoffLineSecCount", "jobsPage.layoffLineSecNoNumber"]) {
      const ps = placeholders(en[k]);
      expect(ps, `${k} must print the filer as a placeholder`).toContain("filer");
      // The filing's own date(s) on the line; OUR read is the second date, appended from layoffRead / layoffReadStale.
      expect(ps.filter((p) => /Date$/.test(p)).length, `${k} must print the filing's date`).toBeGreaterThanOrEqual(1);
    }
    expect(placeholders(en["jobsPage.layoffLineWarnNoticed"]).filter((p) => /Date$/.test(p)).length).toBeGreaterThanOrEqual(2);
    expect(placeholders(en["jobsPage.layoffLineSecPct"]).filter((p) => /Date$/.test(p)).length).toBeGreaterThanOrEqual(2);
    expect(placeholders(en["jobsPage.layoffRead"])).toEqual(["readAgo", "sourceName"]);
    expect(placeholders(en["jobsPage.layoffReadStale"])).toEqual(["readAt"]);
  });

  it("the partition sentence prints two arms side by side, never a ratio, with 'up to' on each share and ± on each width", () => {
    const s = en["ghostIndex.layoffSentence"];
    expect(s).toMatch(/up to \{\{rFiled\}\}%/);
    expect(s).toMatch(/up to \{\{rControl\}\}%/);
    expect(s).toMatch(/±\{\{hwFiled\}\}/);
    expect(s).toMatch(/±\{\{hwControl\}\}/);
    expect(s).not.toMatch(/×|\btimes\b|\bratio\b|\{\{rFiled\}\}\s*\/\s*\{\{rControl\}\}/);
    expect(s).toMatch(/taken down/);
    expect(s).not.toMatch(/\bfilled\b|\bhired\b(?! )/);
    expect(s).toMatch(/A takedown is not a hire/);
  });
});

describe("the checks have teeth", () => {
  const en = layoffKeys(load("en"));

  it("fires on a reintroduced banned word, in the language it is reintroduced in", () => {
    const de = layoffKeys(load("de"));
    const doctored = { ...de, "jobsPage.layoffChipWarn": "Entlassungsmeldung liegt vor (echt)" };
    expect(findings("de", en, doctored)).toEqual(['jobsPage.layoffChipWarn: banned word "echt"']);
    const hi = layoffKeys(load("hi"));
    expect(findings("hi", en, { ...hi, "jobsPage.layoffChipSec": hi["jobsPage.layoffChipSec"] + " अभी" })).toEqual(['jobsPage.layoffChipSec: banned word "अभी"']);
    expect(findings("en", en, { ...en, "ghostIndex.layoffTitle": "Roles at employers with a real layoff filing" })).toEqual(['ghostIndex.layoffTitle: banned word "real"']);
    expect(findings("en", en, { ...en, "jobsPage.layoffRead": "read live from {{sourceName}} {{readAgo}}" })).toEqual(['jobsPage.layoffRead: banned word "live"']);
    expect(findings("en", en, { ...en, "jobsPage.layoffRead": "read from {{sourceName}} {{readAgo}} in real time" }))
      .toEqual(['jobsPage.layoffRead: banned word "real time"']);
  });

  it("fires on a dropped placeholder, an invented one, a missing key and a typed date", () => {
    const fr = layoffKeys(load("fr"));
    const dropped = { ...fr, "ghostIndex.layoffReasonN": "moins de roles ont atteint notre plafond de 30 jours" };
    expect(findings("fr", en, dropped)).toEqual(["ghostIndex.layoffReasonN: placeholder {{minN}} dropped"]);
    const invented = { ...fr, "jobsPage.layoffMore": fr["jobsPage.layoffMore"] + " {{bonus}}" };
    expect(findings("fr", en, invented)).toEqual(["jobsPage.layoffMore: placeholder {{bonus}} invented"]);
    const { "jobsPage.layoffTip": _gone, ...missing } = fr;
    expect(findings("fr", en, missing)).toEqual(["jobsPage.layoffTip: missing"]);
    const dated = { ...fr, "ghostIndex.layoffReasonStale": "pas recalcule depuis 2026-09-01" };
    expect(findings("fr", en, dated)).toEqual(expect.arrayContaining(["ghostIndex.layoffReasonStale: a calendar date is typed into the copy"]));
  });

  it("fires on a typed threshold", () => {
    expect(typedThresholds({ ...en, "ghostIndex.layoffReasonEmployers": "fewer than 10 employers with a qualifying filing" }))
      .toEqual(["ghostIndex.layoffReasonEmployers: typed number(s) 10"]);
    expect(typedThresholds({ x: "50 positions at a site" })).toEqual(["x: typed number(s) 50"]);
    expect(typedThresholds({ x: "an 8-K (Item 2.05) within 30 days" })).toEqual([]);
  });
});
