/**
 * Teamtailor was losing more than half its postings to English-only regexes.
 *
 * MEASURED 2026-08-03 across 13 live postings: 7 failed at `resolveFormUrl`
 * with "no form found". Every failure was a NON-ENGLISH tenant — Swedish
 * (attendosverige, vardaga, purplerekrytering, dentalbusinessgroup), Norwegian
 * (compass-group.no), Italian (roccofortehotelsitaly), Spanish (kidsandus).
 * Every English tenant passed. On a vendor headquartered in Stockholm.
 *
 * TWO CAUSES, and the first one hid the second:
 *
 *  1. APPLY_RE covered en/de/fr/es and no Nordic language at all.
 *  2. The form usually is not inline. `{posting}/applications/new` returns it —
 *     verified by fetching three failing tenants directly and finding
 *     `candidate[email]` in the raw HTML. The comment being replaced guessed
 *     "probably external apply redirects"; it was wrong, and the guess had
 *     stood in for a measurement.
 *
 * Fixing (1) alone took 7 failures to 2 resolutions. Fixing (2) took it to 7/7
 * — at which point all six remaining tenants located every field, attached the
 * résumé and read the questions, then reported "stuck" because SUBMIT_RE was
 * `^submit application$` and the button said "Skicka ansökan". Three layers of
 * the same mistake, each invisible until the one above it was cleared.
 *
 * Final: 7/7 of the morning's failures would now submit.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(__dirname, "../../worker/src/vendors/teamtailor.ts"), "utf8");

/** Pull a regex literal or constructed pattern out of the source and build it. */
function patternFor(name: string): RegExp {
  const lit = src.match(new RegExp(`const ${name} = (/[^\\n]+/[a-z]*);`));
  if (lit) {
    const body = lit[1]!;
    const i = body.lastIndexOf("/");
    return new RegExp(body.slice(1, i), body.slice(i + 1));
  }
  const built = src.match(new RegExp(`const ${name} = new RegExp\\(([\\s\\S]*?)\\n\\);`));
  expect(built, `${name} is neither a literal nor a constructed RegExp`).toBeTruthy();
  // eslint-disable-next-line no-eval
  return eval(`new RegExp(${built![1]})`) as RegExp;
}

const APPLY = patternFor("APPLY_RE");
const SUBMIT = patternFor("SUBMIT_RE");

describe("the apply control is recognised in the languages tenants use", () => {
  // Button text as it appears on the live tenants that were failing.
  const APPLY_LABELS = [
    ["en", "Apply for this job"], ["en", "Apply now"],
    ["sv", "Ansök"], ["sv", "Ansök nu"], ["sv", "Sök tjänsten"],
    ["no", "Søk stillingen"], ["no", "Søk nå"],
    ["da", "Ansøg"],
    ["fi", "Hae paikkaa"],
    ["it", "Candidati"], ["it", "Invia candidatura"],
    ["nl", "Solliciteer"],
    ["pt", "Candidatar"],
    ["de", "Jetzt bewerben"], ["fr", "Postuler"], ["es", "Solicitar"],
  ] as const;

  for (const [lang, label] of APPLY_LABELS) {
    it(`matches ${lang}: "${label}"`, () => {
      expect(APPLY.test(label), `${label} would not be clicked`).toBe(true);
    });
  }

  it("still resolves via the canonical /applications/new route", () => {
    // The bigger of the two fixes. Losing this returns 5 of 7 tenants to
    // "no form found" no matter how good the button regex is.
    expect(src).toMatch(/\$\{url\}\/applications\/new/);
  });

  it("never returns a URL without seeing a vendor-controlled field", () => {
    // The safety property that makes a LOOSE apply match acceptable: proof of
    // a form is candidate[email], never "a button was found".
    const fn = src.slice(src.indexOf("async resolveFormUrl"), src.indexOf("async locate("));
    const returns = [...fn.matchAll(/return\s+(canonical|url)\s*;/g)].length;
    const checks = [...fn.matchAll(/candidate\[email\]/g)].length;
    expect(checks, "fewer email checks than URL returns — a path can return unverified")
      .toBeGreaterThanOrEqual(returns);
  });
});

/**
 * THE ASYMMETRY THAT MATTERS. A wrong apply click costs nothing — the form
 * check catches it. A wrong SUBMIT click sends a real application to a real
 * employer and cannot be withdrawn. So this pattern is held to a stricter
 * standard than the one above, and these tests exist to keep it there.
 */
describe("the submit control is recognised but never loosely", () => {
  const SUBMIT_LABELS = [
    ["en", "Submit application"],
    ["sv", "Skicka ansökan"], ["no", "Send søknad"], ["da", "Send ansøgning"],
    ["fi", "Lähetä hakemus"], ["it", "Invia candidatura"],
    ["es", "Enviar solicitud"], ["fr", "Envoyer ma candidature"],
    ["de", "Bewerbung absenden"], ["nl", "Sollicitatie versturen"],
  ] as const;

  for (const [lang, label] of SUBMIT_LABELS) {
    it(`matches ${lang}: "${label}"`, () => {
      expect(SUBMIT.test(label)).toBe(true);
    });
  }

  it("is fully anchored — no fragment can trigger a send", () => {
    expect(SUBMIT.source.startsWith("^("), "SUBMIT_RE is not anchored at the start").toBe(true);
    expect(SUBMIT.source.endsWith(")$"), "SUBMIT_RE is not anchored at the end").toBe(true);
  });

  it("refuses buttons that merely CONTAIN a submit word", () => {
    for (const near of [
      "Submit application to another role",
      "Skicka ansökan senare",
      "Do not submit",
      "Back",
      "Ansök",              // bare apply word — a nav link, not a send
      "Save draft",
      "Cancel",
    ]) {
      expect(SUBMIT.test(near), `"${near}" would be clicked as a submit`).toBe(false);
    }
  });

  it("proceed() delegates to canProceed so dry run and real run cannot disagree", () => {
    expect(src).toMatch(/if \(await this\.canProceed\(page\) === "would-submit"\)/);
  });
});
