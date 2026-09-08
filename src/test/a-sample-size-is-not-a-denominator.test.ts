/**
 * A COLUMN PUBLISHED BESIDE A RATE WILL BE DIVIDED BY. NAME IT ACCORDINGLY.
 *
 * get_actively_hiring_companies publishes fill_incidence_14d — R(14), an
 * Aalen-Johansen cumulative incidence — together with at_risk_14d and
 * fills_le_14d, so a reader can check the rate rather than trust it. That is
 * the right instinct and it shipped with the wrong label: the column comment
 * described at_risk_14d as "the common denominator the rate is computed
 * against".
 *
 * It is not. at_risk_14d is sum(cnt) WHERE tt >= 14 — the SURVIVORS at day 14.
 * A cumulative incidence accumulates over the whole entering cohort, so the
 * survivors are a strict subset of the denominator and dividing by them
 * overstates. Measured against the live function on 2026-09-07, EIGHT of the
 * fourteen returned rows have fills_le_14d > at_risk_14d — Ubc 207/120,
 * Schnucks 293/194, BBVA 209/54 (387%) — while the rates themselves sit
 * between 0.40 and 0.60. A reader who did the arithmetic the comment invited
 * would get a number over 100% and conclude the rate was broken.
 *
 * This is the same defect the function was rewritten to remove, one level up:
 * a published quantity whose stated meaning is not what it computes. The
 * function stopped calling closure events "fills" in the same release its own
 * schema comment started calling a survivor count a denominator.
 *
 * AND THE PROCESS ERROR, WHICH IS THE HALF WORTH REMEMBERING. The correction
 * was first made by EDITING 20260907010000 — after that migration had already
 * been applied to production. Editing an applied migration changes nothing in
 * the database. The live COMMENT stayed wrong, the file stopped matching what
 * ran, and THIS TEST WENT GREEN over a production falsehood, because it reads
 * the file. A guard that reads source can only ever attest to source; when the
 * artifact under test is a database object, the guard must follow the
 * migration chain to the statement that actually executes.
 *
 * So this file pins two properties, not one:
 *   1. no risk-set column is described as a rate's denominator, judged on the
 *      EFFECTIVE comment — the declaring migration plus every later correction;
 *   2. a correction to an already-applied migration arrives as a NEW migration,
 *      never as an edit to the applied file.
 *
 * Assertions run against RAW SQL because what is pinned IS the prose — the
 * comment is the artifact — and separately against the identifier list to
 * prove the columns still exist to be described.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const SQL = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => ({ f, text: readFileSync(resolve(DIR, f), "utf8") }));

/** The newest definition wins — earlier ones are history, not live. */
/** SQL builds a COMMENT from adjacent string literals, so a sentence is cut by
 *  `' <newline> '` wherever the line wrapped. Matching prose against the raw
 *  file therefore fails on any phrase that straddles a wrap — which is exactly
 *  where the defect was. Rejoin the literals first, then match. */
const prose = (sql: string) => sql.replace(/'\s*\n\s*'/g, "");

const latest = (needle: string) => {
  const hits = SQL.filter((s) => s.text.includes(needle));
  expect(hits.length, `no migration defines ${needle}`).toBeGreaterThan(0);
  return hits[hits.length - 1];
};

describe("a sample size is not a denominator", () => {
  const MISNAMING = /at_risk_14d[^.]*?\bthe\s+(?:common\s+)?denominator\s+the\s+rate\s+is\s+computed\s+against/is;

  it("no risk-set column is described as the rate's denominator, once the chain has run", () => {
    // EFFECTIVE state, not the declaring file. The declaring migration was
    // already applied when the misnaming was found, so the correction had to
    // arrive later in the chain; judging the declaring file alone would report
    // a defect that a subsequent migration has already fixed — and, before
    // this rewrite, reported a FIX that production had never received.
    const declaring = latest("at_risk_14d int");
    const idx = SQL.findIndex((s) => s.f === declaring.f);
    const after = SQL.slice(idx + 1).map((s) => prose(s.text)).join("\n");
    const stillWrong = MISNAMING.test(prose(declaring.text))
      && !/at_risk_14d[\s\S]*?NOT THE DENOMINATOR|DIVIDING BY IT IS WRONG/i.test(after);
    expect(
      stillWrong,
      `${declaring.f} calls at_risk_14d the rate's denominator and no later migration corrects it`,
    ).toBe(false);
  });

  it("a correction to an APPLIED migration is a new migration, never an edit", () => {
    // 20260907010000 was applied on 2026-09-07. Its bytes are therefore
    // history: whatever it says is what the database got, and editing it
    // silently desynchronises the file from the schema while making every
    // source-reading guard agree with the edit rather than with production.
    const applied = SQL.find((s) => s.f.startsWith("20260907010000_"));
    expect(applied, "the applied migration must still exist").toBeTruthy();
    expect(
      MISNAMING.test(prose(applied!.text)),
      "20260907010000 must still read exactly as it was APPLIED — corrections belong in a later migration",
    ).toBe(true);
    const corrector = SQL.slice(SQL.findIndex((s) => s.f === applied!.f) + 1)
      .find((s) => /COMMENT ON FUNCTION[\s\S]*get_actively_hiring_companies|get_actively_hiring_companies[\s\S]*COMMENT ON FUNCTION/i.test(s.text));
    expect(corrector, "no later migration corrects the comment in the database").toBeTruthy();
    expect(
      /NOT THE DENOMINATOR|DIVIDING BY IT IS WRONG/i.test(prose(corrector!.text)),
      `${corrector?.f} must carry the corrected wording`,
    ).toBe(true);
  });

  it("says plainly that dividing by it is wrong, since eight of fourteen live rows exceed 1", () => {
    const m = SQL.filter((s) => /NOT THE DENOMINATOR|DIVIDING BY IT IS WRONG/i.test(s.text)).slice(-1)[0];
    expect(m, "nothing carries the corrected wording").toBeTruthy();
    expect(prose(m.text), "the comment must warn against the division it invites")
      .toMatch(/NOT THE DENOMINATOR|DIVIDING BY IT IS WRONG/i);
    expect(prose(m.text), "and must say what it IS for").toMatch(/sample[- ]size gate/i);
  });

  it("still publishes both figures — the fix is the label, not removing the check", () => {
    const m = latest("at_risk_14d int");
    for (const col of ["at_risk_14d", "fills_le_14d", "fill_incidence_14d"]) {
      expect(m.text, `${col} must still be returned`).toContain(col);
    }
  });

  it("has teeth: the shipped wording fails the first assertion", () => {
    const shipped = "'(15) at_risk_14d: observations still at risk at day 14 -- the common " +
      "'\n  'denominator the rate is computed against. '";
    expect(
      /at_risk_14d[^.]*?\bthe\s+(?:common\s+)?denominator\s+the\s+rate\s+is\s+computed\s+against/is.test(prose(shipped)),
      "the regex must match the wording that actually shipped",
    ).toBe(true);
  });
});
