// @vitest-environment node
/**
 * S14X-012, OPTION B (the owner's choice of 2026-11-15): the fix-plan email
 * sequence is withdrawn rather than drained. Its four mails were queued where
 * nothing sent them, while the confirmation page told the reader the first
 * one would arrive in two days and the Trust page described scheduled fix-plan
 * mails waiting in a send queue for 14 days.
 *
 * Held here, in all nine languages:
 *   - no bundle carries the confirmation page's sequence strings (only its
 *     link home stays), so no chunk can promise a first mail;
 *   - the Trust page's email row names the report you send yourself and the
 *     paid analysis, and no fix-plan mail and no send queue.
 * The last test reads the page itself, which the mail lane rewrites to say the
 * sequence is withdrawn: it FAILS on this branch until that page is merged
 * under it, since a page still asking for a withdrawn string would print its
 * English default to every other language.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Lng = (typeof LNGS)[number];
type Json = Record<string, unknown>;
const bundle = (l: Lng): Json => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8"));
function strings(o: unknown, out: string[] = []): string[] {
  if (typeof o === "string") out.push(o);
  else if (o && typeof o === "object") for (const v of Object.values(o)) strings(v, out);
  return out;
}

// The two-day promise, as each language spelled it.
const FIRST_MAIL: Record<Lng, string> = {
  en: "The first email arrives in two days", "en-GB": "The first email arrives in two days",
  de: "Die erste E-Mail kommt in zwei Tagen", es: "El primer correo llega en dos días",
  fr: "Le premier e-mail arrive dans deux jours", hi: "पहला ईमेल दो दिन में आएगा",
  nl: "De eerste e-mail komt over twee dagen", pt: "O primeiro e-mail chega em dois dias",
  tl: "Darating ang unang email sa loob ng dalawang araw",
};
// The fix-plan sequence and its send queue, as each language named them.
const SEQUENCE: Record<Lng, RegExp> = {
  en: /fix-plan|queue/i, "en-GB": /fix-plan|queue/i, de: /Fix-Plan|Warteschlange/i, es: /plan de mejoras|del plan|cola de envío/i,
  fr: /plan de correction|du plan|file d'envoi/i, hi: /फ़िक्स-प्लान|कतार/, nl: /verbeterplan|wachtrij/i, pt: /plano de correções|do plano|fila de envio/i,
  tl: /fix-plan|queue/i,
};

describe("no language promises a fix-plan email that nothing sends", () => {
  it("the confirmation page's sequence strings are gone from every bundle, and its link home stays", () => {
    for (const l of LNGS) {
      expect(Object.keys((bundle(l).fixPlanConfirm ?? {}) as Json), l).toEqual(["home"]);
    }
  });

  it("no string in any bundle says the first email arrives in two days", () => {
    for (const l of LNGS) {
      expect(strings(bundle(l)).filter((s) => s.includes(FIRST_MAIL[l])), l).toEqual([]);
    }
  });

  it("the Trust page's email row names no fix-plan mail, no send queue and no 14-day schedule", () => {
    for (const l of LNGS) {
      const r = ((bundle(l).trustPage as Json).retention as Json & { rows: Record<string, Record<string, string>> }).rows.email;
      for (const k of ["what", "where", "howLong"]) {
        expect(r[k], `${l} ${k}`).toBeTruthy();
        expect(r[k], `${l} ${k}`).not.toMatch(SEQUENCE[l]);
        expect(r[k], `${l} ${k}`).not.toMatch(/14/);
      }
    }
  });

  it("reads, in English, as the crawler's copy of /trust prints it", () => {
    for (const l of ["en", "en-GB"] as const) {
      const r = ((bundle(l).trustPage as Json).retention as Json & { rows: Record<string, Record<string, string>> }).rows.email;
      expect(r).toEqual({
        what: "A report you email to yourself and the paid analysis we email you",
        where: "Your inbox, sent through our email provider",
        howLong: "In your inbox for as long as you keep it",
      });
    }
  });

  it("the confirmation page asks for none of the withdrawn strings", () => {
    const page = readFileSync(resolve(ROOT, "src/pages/FixPlanConfirm.tsx"), "utf8");
    const asked = [...page.matchAll(/\bt\(\s*["'`]fixPlanConfirm\.([\w-]+)["'`]/g)].map((m) => m[1]).filter((k) => k !== "home");
    expect(asked, "the mail lane's withdrawn page must merge first").toEqual([]);
  });
});
