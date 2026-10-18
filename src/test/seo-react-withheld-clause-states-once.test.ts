/**
 * A WITHHELD CLOSURE RECORD IS SAID TO BE WITHHELD ONCE (R1, 2026-10-18 after-audit).
 *
 * The verdict clause read "we hold a closure record for this employer and do
 * not print it: {{why}}", and every reason withheldWhy() fills in opens by
 * saying "We do not print …" again: "…do not print it: We do not print how
 * many of this employer's roles came down…". The clause now states only that
 * a record is held; the reason says what is withheld and why.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HIRING_RECORD_GATE_COPY, fillGateCopy } from "@/lib/hiring-record-gate";
import { LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";
import { codeOf } from "./helpers/strip-comments";

/** Each locale's old second negation, which the clause no longer carries. */
const OLD_NEGATION = /do not print it|zeigen sie aber nicht an|no lo mostramos|ne l'affichons pas|tonen ze niet|não o mostramos|hindi namin ito ipinapakita|नहीं दिखाते/;

describe("the withheld-record clause", () => {
  it.each(LOCALE_FILES)("%s: the clause says a record is held, then gives the reason", (file) => {
    const clause = String((readMainLocale(file).jobsPage as Record<string, unknown>).verdictRecordWithheld);
    expect(clause).toMatch(/\{\{why\}\}$/);
    expect(clause).not.toMatch(OLD_NEGATION);
  });

  it("filled with every English reason, says 'not print' at most once", () => {
    const en = String((readMainLocale("en.json").jobsPage as Record<string, unknown>).verdictRecordWithheld);
    for (const [key, why] of Object.entries(HIRING_RECORD_GATE_COPY)) {
      const text = en.replace("{{why}}", fillGateCopy(why, { n: 120, d: 40, min: 21, pct: 30 }));
      expect((text.match(/not print/g) ?? []).length, key).toBeLessThanOrEqual(1);
    }
  });

  it("the page's English defaults are the locale's sentence (both call sites)", () => {
    const jobs = codeOf(readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8"));
    expect(jobs.split('"we hold a closure record for this employer: {{why}}"').length - 1).toBe(2);
    expect(jobs).not.toMatch(OLD_NEGATION);
  });
});
