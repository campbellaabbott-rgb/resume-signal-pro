/**
 * TWO HUNDRED INPUTS WRITTEN TO BREAK THE FIX-3 RULE (four rounds of 50).
 *
 * Each round was written after a change to the rule and run before the next.
 * Round 1 found eleven factual asks still drafted, in words no list held
 * ("... and the hours you can commit", "... and how much you'd want per
 * hour"); round 2 found eleven more through nouns no list could hold ("...
 * and your political views", "... and the region you're in"); so the rule
 * stopped trying to name every fact and made the person the default for a
 * later clause that addresses them. Round 3 found six, round 4 three, one of
 * them a regex defect ("need" read as a past tense), now fixed.
 *
 * What holds: every factual ask is the person's except the KNOWN_DRAFTED
 * ones below (it.fails: if one starts passing, the gap closed and this list
 * shrinks); every work or motivation question is drafted except the
 * KNOWN_OVER_ROUTED ones, the safe side, most of which origin/main drafted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { whoAnswers } from "../../supabase/functions/_shared/self-apply";

type Row = { id: string; round: number; label: string; hint?: string; expect: "draft" | "person"; why: string; was: { main: string; r2: string } };
const ROWS = (JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-questions/self-break.json"), "utf8")) as { rows: Row[] }).rows;

/** Factual asks the rule still drafts. Round 4's default-deny clause rule closed all four round 3 listed (a run-on, a hint naming a view, two past-tense personal facts). */
const KNOWN_DRAFTED = new Set<string>([]);
/**
 * Work and motivation questions sent to the person. Five are HR, payroll or
 * legal work in protected words (the area accepts these); the rest are later
 * clauses in the present or future tense that the rule cannot tell from a
 * second ask ("... and how you would scale it", "... and the CRM you prefer").
 */
const KNOWN_OVER_ROUTED = new Set([
  "sb-37", "sb-38", "sb-41", "sb-48", "sb-49",
  "sb2-36", "sb2-37", "sb2-44", "sb2-45", "sb2-46", "sb2-47",
  "sb3-29", "sb3-30", "sb3-38", "sb3-39", "sb3-50",
  "sb4-36", "sb4-42", "sb4-46",
]);

const drafted = (r: Row) =>
  whoAnswers({ label: r.label, required: true, type: "textarea", ...(r.hint ? { hint: r.hint } : {}) }, 1).answeredBy === "draft_from_your_cv";

describe("the self-break inputs", () => {
  it("are 200, four rounds of 50", () => {
    expect(ROWS.length).toBe(200);
    for (const n of [1, 2, 3, 4]) expect(ROWS.filter((r) => r.round === n).length).toBe(50);
  });

  for (const r of ROWS.filter((x) => x.expect === "person")) {
    const test = KNOWN_DRAFTED.has(r.id) ? it.fails : it;
    test(`${r.id} the person answers: ${r.label}${r.hint ? ` (hint: ${r.hint})` : ""}`, () => {
      expect(drafted(r)).toBe(false);
    });
  }

  for (const r of ROWS.filter((x) => x.expect === "draft")) {
    it(`${r.id} ${KNOWN_OVER_ROUTED.has(r.id) ? "known over-route, sent to the person" : "drafted"}: ${r.label}`, () => {
      expect(drafted(r)).toBe(!KNOWN_OVER_ROUTED.has(r.id));
    });
  }

  it("drafts fewer factual asks than 9af3c783 did, and none 9af3c783 kept with the person", () => {
    const persons = ROWS.filter((r) => r.expect === "person");
    const ours = persons.filter(drafted).map((r) => r.id);
    const theirs = persons.filter((r) => r.was.r2 === "draft").map((r) => r.id);
    expect(ours.length).toBeLessThan(theirs.length / 10);
    expect(ours.filter((id) => !theirs.includes(id))).toEqual([]);
  });
});
