/**
 * THE MARKET PULSE IS WRITTEN IN THE LANGUAGE IT WAS ASKED IN (S13-102).
 *
 * WHAT WAS WRONG. A visitor reading the site in German, Spanish or Hindi who
 * ticked the pulse box under a scan report got the confirmation mail, and
 * then every monthly pulse, in English: the subscribe and confirm calls sent
 * no language, and send-market-pulse wrote every line in English.
 *
 * WHAT HOLDS NOW:
 *   - the subscribe call (EmailReportCapture) and the confirm call
 *     (MarketPulseConfirm) carry the page's language;
 *   - the confirmation mail is written in it (the browser's Accept-Language
 *     when the body names none, English when neither is one of ours);
 *   - the confirm stores it on the subscriber row (market_pulse_subscribers
 *     .locale, migration 20261103191000) and the monthly batch writes each
 *     pulse in the stored language, English when there is none;
 *   - every language has every line, and the industry is named in words.
 *
 * The scan-report mail and its drip, the saved-search digest, the claim mail
 * and the API-key mail are other rounds' files, so they are not judged here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { PULSE_COPY, industryLabel, mailLanguageOf, storedLanguage, type MailLanguage } from "../../supabase/functions/send-market-pulse/copy.ts";
import { KEYWORD_FREQUENCY } from "../../supabase/functions/_shared/market-intelligence.ts";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const LANGS: MailLanguage[] = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];

describe("the language a pulse mail is written in", () => {
  it("is the page's, then the browser's first one we carry, then English", () => {
    expect(mailLanguageOf({ language: "de" }, "fr-FR,fr;q=0.9")).toBe("de");
    expect(mailLanguageOf({ language: "pt-BR" }, null)).toBe("pt");
    expect(mailLanguageOf({}, "ja-JP, nl-BE;q=0.8, en;q=0.5")).toBe("nl");
    expect(mailLanguageOf({ language: "xx" }, "ja")).toBe("en");
    expect(mailLanguageOf(null, undefined)).toBe("en");
  });

  it("is stored only as one of the site's languages; anything else reads as English", () => {
    expect(storedLanguage("hi")).toBe("hi");
    expect(storedLanguage("en-GB")).toBe("en-GB");
    expect(storedLanguage(null)).toBe("en");
    expect(storedLanguage("<script>")).toBe("en");
  });
});

describe("the copy", () => {
  it("has every line in all nine languages, and the translations are not English", () => {
    const keys = Object.keys(PULSE_COPY.en) as Array<keyof typeof PULSE_COPY.en>;
    for (const lang of LANGS) {
      const c = PULSE_COPY[lang];
      expect(Object.keys(c).sort(), lang).toEqual([...keys].sort());
      for (const k of keys) {
        const v = c[k];
        const text = typeof v === "function" ? (v as (x: never) => string)("X" as never) : v;
        expect(String(text).trim().length, `${lang}.${String(k)}`).toBeGreaterThan(0);
      }
    }
    for (const lang of ["de", "es", "fr", "hi", "nl", "pt", "tl"] as const) {
      expect(PULSE_COPY[lang].confirmSubject, lang).not.toBe(PULSE_COPY.en.confirmSubject);
      expect(PULSE_COPY[lang].confirmExpiry, lang).not.toBe(PULSE_COPY.en.confirmExpiry);
      expect(PULSE_COPY[lang].subject("X"), lang).not.toBe(PULSE_COPY.en.subject("X"));
    }
  });

  it("is HTML-safe text, so the mail escapes only the values put into it", () => {
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(PULSE_COPY[lang])) {
        const text = typeof v === "function" ? (v as (x: string) => string)("X") : String(v);
        const bare = k === "lastScan" ? text.replace(/<\/?b>/g, "") : text;
        expect(bare, `${lang}.${k}`).not.toMatch(/[<>&]/);
      }
    }
  });

  it("names every industry the pulse covers in words in each language, never as a key", () => {
    for (const lang of LANGS) {
      for (const industry of [...Object.keys(KEYWORD_FREQUENCY), "general"]) {
        const label = industryLabel(industry, lang);
        expect(label, `${lang}/${industry}`).not.toMatch(/_/);
        expect(label.trim().length, `${lang}/${industry}`).toBeGreaterThan(0);
      }
    }
    expect(industryLabel("data_science", "de")).toBe("Data Science");
    expect(industryLabel("product_management", "en")).toBe("product management");
  });
});

describe("send-market-pulse", () => {
  const code = codeOf(read("supabase/functions/send-market-pulse/index.ts"));

  it("writes no mail line in English by hand any more", () => {
    expect(code).not.toMatch(/subject:\s*"Confirm your monthly market pulse"/);
    expect(code).not.toMatch(/Rescan my resume free/);
    expect(code).toMatch(/subject:\s*PULSE_COPY\[lang\]\.confirmSubject/);
    expect(code).toMatch(/subject:\s*c\.subject\(label\)/);
  });

  it("stores the confirming page's language on the row the token names, and the batch reads it", () => {
    expect(code).toMatch(/\.update\(\{\s*locale:\s*mailLanguageOf\(body,/);
    expect(code).toMatch(/\.eq\("confirm_token_hash", tokenHash\)/);
    expect(code).toMatch(/\.select\("email, locale"\)/);
    expect(code).toMatch(/storedLanguage\(localeOf\.get\(sub\.cl_email\)\)/);
  });

  it("is stamped with this round's build", () => {
    expect(code).toMatch(/const FN_BUILD = "send-market-pulse\.2026-11-03\.1"/);
  });
});

describe("the pages that ask", () => {
  it("send the page's language with the subscribe and the confirm", () => {
    expect(codeOf(read("src/components/EmailReportCapture.tsx"))).toMatch(/action: "subscribe",[^}]*language: i18n\.language/);
    expect(codeOf(read("src/pages/MarketPulseConfirm.tsx"))).toMatch(/action: "confirm", token, language: i18n\.language/);
  });
});

describe("the migration", () => {
  it("adds the column, limited to the site's languages, and checks itself", () => {
    const file = readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.startsWith("20261103191000_"));
    expect(file).toBeTruthy();
    const sql = read(`supabase/migrations/${file}`);
    expect(sql).toMatch(/ALTER TABLE public\.market_pulse_subscribers ADD COLUMN IF NOT EXISTS locale text/);
    expect(sql).toMatch(/CHECK \(locale IS NULL OR locale IN \('en', 'en-GB', 'de', 'es', 'fr', 'hi', 'nl', 'pt', 'tl'\)\)/);
    expect(sql).toMatch(/RAISE EXCEPTION 'S13-102 self-check failed/);
  });
});
