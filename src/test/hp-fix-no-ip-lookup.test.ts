/**
 * NEITHER PAGE SAYS CHECKOUT LOOKS UP AN IP ADDRESS (owner decision W5,
 * 2026-10-24).
 *
 * Wave 4's territory check asks an address-lookup service only when its key
 * is set, and an unanswered lookup refuses nobody, so a sentence naming that
 * lookup could be false on the day it ships. The owner dropped the clause:
 * both pages describe only the two checks that always run, the currency and
 * the time zone the device reports.
 *
 * Held here, in all nine languages and over every string either page carries
 * (not only the four sentences that named it): no string names an IP address
 * or the lookup service, and the four territory sentences still name the
 * currency and the time zone. The hp source files, comments stripped, carry
 * no such literal either.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];

const HOME_DIR = resolve(__dirname, "../lib/home/strings");
const PRICING_DIR = resolve(__dirname, "../components/pricing/strings");

const readJson = (dir: string, lng: Locale) => JSON.parse(readFileSync(join(dir, `${lng}.json`), "utf8")) as Record<string, unknown>;

function leaves(node: unknown, path: string, out: Array<[string, string]>) {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out);
  return out;
}

const get = (o: Record<string, unknown>, key: string) =>
  key.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);

/** "IP" as a word of its own, in any script around it (IP-Adresse, adresse IP, IP पते). */
const IP_WORD = /(?<![\p{L}\p{N}])IP(?![\p{L}\p{N}])/u;
const LOOKUP_SERVICE = /ipinfo|radar/i;
/** The English noun the dropped clause used. */
const LOOKUP_EN = /\blook\s?up\b/i;

function offences(lng: Locale, all: Array<[string, string]>) {
  return all
    .filter(([, v]) => IP_WORD.test(v) || LOOKUP_SERVICE.test(v) || (lng.startsWith("en") && LOOKUP_EN.test(v)))
    .map(([k, v]) => `${lng} ${k}: ${v}`);
}

describe("no page string mentions an IP lookup", () => {
  for (const lng of LOCALES) {
    it(`${lng}: the homepage's strings`, () => {
      expect(offences(lng, leaves(readJson(HOME_DIR, lng), "", []))).toEqual([]);
    });
    it(`${lng}: the pricing page's strings`, () => {
      expect(offences(lng, leaves(readJson(PRICING_DIR, lng), "", []))).toEqual([]);
    });
  }
});

/** The words each language uses for the two checks that always run. */
const CHECK_WORDS: Record<Locale, { currency: RegExp; timeZone: RegExp }> = {
  en: { currency: /currency/, timeZone: /time zone/ },
  "en-GB": { currency: /currency/, timeZone: /time zone/ },
  de: { currency: /Währung/, timeZone: /Zeitzone/ },
  es: { currency: /moneda/, timeZone: /zona horaria/ },
  fr: { currency: /devise/, timeZone: /fuseau horaire/ },
  hi: { currency: /मुद्रा/, timeZone: /टाइम ज़ोन|समय क्षेत्र/ },
  nl: { currency: /valuta/, timeZone: /tijdzone/ },
  pt: { currency: /moeda/, timeZone: /fuso horário/ },
  tl: { currency: /currency/, timeZone: /time zone/ },
};

const TERRITORY_SENTENCES: Array<[string, string]> = [
  [HOME_DIR, "home.plans.termTerritory"],
  [PRICING_DIR, "pricingPlans.before.regionBody"],
  [PRICING_DIR, "pricingPlans.faq.regionA"],
  [PRICING_DIR, "pricingPlans.faq.regionANoAlerts"],
];

describe("the territory sentences still name the currency and the time zone", () => {
  for (const lng of LOCALES) {
    it(lng, () => {
      for (const [dir, key] of TERRITORY_SENTENCES) {
        const s = get(readJson(dir, lng), key);
        expect(typeof s, `${lng} ${key}`).toBe("string");
        expect(s as string, `${lng} ${key}`).toMatch(CHECK_WORDS[lng].currency);
        expect(s as string, `${lng} ${key}`).toMatch(CHECK_WORDS[lng].timeZone);
        expect(s as string, `${lng} ${key}`).not.toMatch(IP_WORD);
      }
    });
  }
});

const SOURCE_ROOTS = ["../components/home", "../components/pricing", "../pages/home", "../pages/pricing", "../lib/home", "../preview"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");

describe("no hp source file writes an IP lookup into the page", () => {
  it("comments stripped, no literal names an IP address or the lookup service", () => {
    const files = SOURCE_ROOTS.flatMap((r) => sourceFiles(resolve(__dirname, r)));
    expect(files.length).toBeGreaterThan(20);
    const hits = files.filter((f) => {
      const code = stripComments(readFileSync(f, "utf8"));
      return IP_WORD.test(code) || /ipinfo/i.test(code) || /\bIP address\b/i.test(code);
    });
    expect(hits).toEqual([]);
  });
});
