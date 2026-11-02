/**
 * THE SECOND ROUND'S WORDS ARE IN EVERY LANGUAGE (wave 4 round 2 integration,
 * the translation pass).
 *
 * Every builder wrote its new copy as t("ns.key", "English default") and left
 * the nine locale files to one pass after integration, because the profiles
 * and design round shares them. Until that pass, a German, Hindi or Tagalog
 * reader saw these sentences in English. The pass added 349 keys to all nine
 * files, adding only (no existing value edited).
 *
 * The properties, read from the source the way the one-English-default guard
 * reads it:
 *   - every key the round's namespaces call with an English default exists in
 *     en.json, so the locale value and the default cannot drift apart unseen;
 *   - every one of those keys has a value in all nine locales, and each value
 *     carries exactly the {{placeholders}} the English one does (a lost
 *     {{price}} or {{date}} prints a sentence with a hole in it);
 *   - the two plural keys have their _one and _other forms everywhere;
 *   - en-GB's new keys never name the trader "CV Booster" (plan CP-G): the
 *     named sentences insert {{name}}, which is TRADING_NAME.
 *
 * Words waiting for the locale files (2026-11-03, the audit-rest round): while
 * the nine locale files belong to other rounds, a builder writes a new key's
 * nine translations to docs/audit-rest-pending-locales/<builder>.json, to be
 * applied once those rounds merge. A key found there counts as present, but
 * only with a value in all nine languages and the English placeholders, so a
 * key in neither place, or one waiting with a language short, still fails.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const locale = (l: string) => JSON.parse(readFileSync(resolve(SRC, "i18n/locales", `${l}.json`), "utf8")) as Record<string, unknown>;
const valueOf = (d: Record<string, unknown>, key: string): unknown =>
  key.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d);

/** Keys waiting for the locale files, by dotted key: each language's value as its builder wrote it. */
const PENDING_DIR = resolve(SRC, "../docs/audit-rest-pending-locales");
function pendingLocales(): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!existsSync(PENDING_DIR)) return out;
  for (const name of readdirSync(PENDING_DIR).filter((n) => n.endsWith(".json")).sort()) {
    const doc = JSON.parse(readFileSync(join(PENDING_DIR, name), "utf8")) as Record<string, Record<string, unknown>>;
    for (const [key, values] of Object.entries(doc)) out.set(key, values);
  }
  return out;
}
const PENDING = pendingLocales();
/** A locale's value for a key: the locale file's, else the value waiting for it. */
const localeValue = (d: Record<string, unknown>, l: string, key: string): unknown => {
  const v = valueOf(d, key);
  return typeof v === "string" ? v : PENDING.get(key)?.[l];
};

/** The namespaces this round introduced, wholly new (no key in them predates it). */
const ROUND_NAMESPACES = [
  "accountConnected.", "accountMail.", "accountPrivacy.", "accountSettings.", "orders.", "consent.",
  "crashScreen.", "writingRefusal.", "checkoutGate.", "checkoutRefusal.", "applyAnswers.",
  "productSuccess.needsJobPosting.", "productSuccess.retiredSale.", "proPlan.perks.", "proPlan.toast.",
  "affiliates.proCommission.", "freelanceBoost.noLongerSold", "agentPage.retiredPublic",
  "rateLimitUpsell.freeAccount", "freeReportSignup.", "scanPackPurchase.retired",
  "faq.questions.howLongBound.", "faq.questions.vsChatGPTTrue.", "faq.questions.whatDoIGetNamed.",
];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "i18n") continue;
      files(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function calledKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const call = /(?<![A-Za-z0-9_$.])(?:i18n\.)?t\(\s*(['"])([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\1\s*,\s*(['"`])/g;
  for (const f of files(SRC)) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(call)) keys.set(m[2], f.slice(SRC.length + 1));
  }
  // Pro's perk list is read as t(item.key, item.text): its keys are in the shared list.
  const perks = readFileSync(resolve(SRC, "../supabase/functions/_shared/pro-perks.ts"), "utf8");
  for (const m of perks.matchAll(/key:\s*"([A-Za-z0-9_.]+)"/g)) keys.set(m[1], "supabase/functions/_shared/pro-perks.ts");
  return keys;
}

const PH = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const placeholders = (v: string) => [...v.matchAll(PH)].map((m) => m[1]).sort();

describe("the second round's words", () => {
  const all = calledKeys();
  const round = [...all.keys()].filter((k) => ROUND_NAMESPACES.some((ns) => k.startsWith(ns)));
  const en = locale("en");

  it("reads the components that call them", () => {
    expect(round.length).toBeGreaterThan(150);
    expect(round).toContain("accountSettings.pwTitle");
    expect(round).toContain("proPlan.perks.noDailyScanCap");
  });

  it("every one the source calls is in en.json", () => {
    const missing = round.filter((k) => typeof localeValue(en, "en", k) !== "string").map((k) => `${k} (${all.get(k)})`);
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("every one has a value in all nine languages, with the English placeholders", () => {
    const wrong: string[] = [];
    for (const l of LOCALES) {
      const d = locale(l);
      for (const k of round) {
        const v = localeValue(d, l, k);
        const e = localeValue(en, "en", k);
        if (typeof v !== "string" || !v.trim()) { wrong.push(`${l}: ${k} missing`); continue; }
        if (typeof e === "string" && placeholders(v).join() !== placeholders(e).join()) wrong.push(`${l}: ${k} has {{${placeholders(v)}}} for {{${placeholders(e)}}}`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("TEETH: a key waiting for the locale files counts only with all nine languages", () => {
    const waiting = round.filter((k) => typeof valueOf(en, k) !== "string" && PENDING.has(k));
    for (const k of waiting) {
      const short = LOCALES.filter((l) => { const v = PENDING.get(k)?.[l]; return typeof v !== "string" || !v.trim(); });
      expect(short, `${k} waits without ${short.join(", ")}`).toEqual([]);
    }
    const d = { a: { b: "x" } };
    expect(localeValue(d, "de", "a.b")).toBe("x");
    expect(localeValue(d, "de", "a.notWaitingAnywhere")).toBeUndefined();
  });

  it("the plural keys have a one and an other form in every language", () => {
    for (const l of LOCALES) {
      const d = locale(l);
      for (const k of ["accountPage.versionInterviews", "accountPage.versionOffers"]) {
        expect(typeof valueOf(d, `${k}_one`), `${l} ${k}_one`).toBe("string");
        expect(typeof valueOf(d, `${k}_other`), `${l} ${k}_other`).toBe("string");
      }
    }
  });

  it("en-GB names the trader by {{name}}, never as CV Booster, in the named sentences", () => {
    const gb = locale("en-GB");
    for (const k of ["comparison.titleNamed", "faq.subtitleNamed", "faq.questions.whatDoIGetNamed.question", "faq.questions.vsChatGPTTrue.answer"]) {
      const v = String(valueOf(gb, k));
      expect(v, k).toContain("{{name}}");
      expect(v, k).not.toMatch(/CV Booster/);
    }
    const stray = round.filter((k) => /CV Booster/.test(String(valueOf(gb, k))));
    expect(stray).toEqual([]);
  });
});
