import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasFitAccess, isPaidKeyTier } from "../../supabase/functions/_shared/key-tier.ts";
import { PASS_TIER } from "../../supabase/functions/_shared/pass.ts";

// Guard 6 of the pass build (SPEC section 6).
//
// A key holding a live pass answers key_tier = 'pass'. Under the inline
// predicate agent-mcp and public-api both spelled — "not null, not free, not
// trial" — that tier would have read as PAID everywhere: the ranked engine,
// /v1/fit, the long changes window. The pass is sold as "your agent", never
// "your script", so it must be unpaid to every /v1 gate while fit_resume opens
// to it (the pipeline refuses unattended release on unknown fit; research that
// cannot score before the spend is not research).
//
// Two predicates in one shared module, walked by value here. The source
// checks below pin that the two functions IMPORT them and no longer carry a
// private copy — the copy is exactly what would answer 'pass' wrong.

const root = resolve(__dirname, "../..");

// The tier values a key can carry, plus a never-seen one — a paid tier the
// predicate has not heard of must still be paid (the old shape), and null
// (no key) must never be.
const WALK: ReadonlyArray<[string | null | undefined, boolean, boolean]> = [
  // tier,        isPaidKeyTier, hasFitAccess
  [null,          false,         false],
  [undefined,     false,         false],
  ["free",        false,         false],
  ["trial",       false,         false],
  [PASS_TIER,     false,         true],
  ["pro",         true,          true],
  ["x",           true,          true],
];

describe("isPaidKeyTier / hasFitAccess, by value", () => {
  it.each(WALK)("tier %j → paid %s, fit %s", (tier, paid, fit) => {
    expect(isPaidKeyTier(tier)).toBe(paid);
    expect(hasFitAccess(tier)).toBe(fit);
  });

  it("the pass is the one tier that has fit access without being paid", () => {
    expect(isPaidKeyTier("pass")).toBe(false);
    expect(hasFitAccess("pass")).toBe(true);
    expect(PASS_TIER).toBe("pass");
    const fitButNotPaid = WALK.filter(([t]) => hasFitAccess(t) && !isPaidKeyTier(t)).map(([t]) => t);
    expect(fitButNotPaid).toEqual([PASS_TIER]);
  });

  // A/B against the inline predicate both functions used to spell: for every
  // value other than the pass the shared predicate must answer identically,
  // or extracting it changed a gate it was meant only to centralise.
  it("agrees with the retired inline predicate on every non-pass value", () => {
    const inline = (tier: string | null | undefined) => tier != null && tier !== "free" && tier !== "trial";
    for (const [tier] of WALK) {
      if (tier === PASS_TIER) continue;
      expect(isPaidKeyTier(tier), `tier ${JSON.stringify(tier)}`).toBe(inline(tier));
    }
    expect(inline(PASS_TIER)).toBe(true);
    expect(isPaidKeyTier(PASS_TIER)).toBe(false);
  });
});

// Comment-stripped views, so prose explaining the predicate never trips this.
const codeOf = (rel: string) =>
  readFileSync(resolve(root, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

const CONSUMERS = [
  "supabase/functions/agent-mcp/index.ts",
  "supabase/functions/public-api/index.ts",
];

// The inline shape, in either operand order, with either quote style and
// either polarity (a `=== "free" || === PASS_TIER` rewrite is the same
// private copy), with or without the trial clause: a private copy in any of
// those spellings is the bug.
const INLINE_PREDICATE = /tier\s*(?:!==|!=|===|==)\s*["']free["']|["']free["']\s*(?:!==|!=|===|==)\s*tier/;

// The fit_resume arm of callTool — from its case label to the next case —
// so the gate is checked where it dispatches, not anywhere in the file
// (key_status also calls hasFitAccess, which would satisfy a file-wide
// match while the dispatcher refused the pass).
function fitResumeArmOf(code: string): string {
  const a = code.indexOf('case "fit_resume": {');
  if (a < 0) throw new Error("the fit_resume arm is gone");
  const b = code.indexOf("\n    case ", a + 1);
  return code.slice(a, b < 0 ? code.length : b);
}

describe("the two functions import the shared predicates and keep no private copy", () => {
  it.each(CONSUMERS)("%s imports from _shared/key-tier.ts", (rel) => {
    expect(codeOf(rel)).toMatch(
      /import\s*\{[^}]*\b(?:isPaidKeyTier|hasFitAccess)\b[^}]*\}\s*from\s*["']\.\.\/_shared\/key-tier\.ts["']/,
    );
  });

  it.each(CONSUMERS)("%s no longer spells the tier predicate inline", (rel) => {
    expect(codeOf(rel)).not.toMatch(INLINE_PREDICATE);
  });

  it("agent-mcp opens fit_resume with hasFitAccess, not the paid predicate alone — in the dispatch arm itself", () => {
    const arm = fitResumeArmOf(codeOf("supabase/functions/agent-mcp/index.ts"));
    expect(arm).toMatch(/\bhasFitAccess\s*\(/);
    expect(arm).not.toMatch(/\bisPaidKeyTier\s*\(/);
    expect(arm).not.toMatch(INLINE_PREDICATE);
  });

  it("public-api never grants fit access on the pass — it uses only isPaidKeyTier", () => {
    const code = codeOf("supabase/functions/public-api/index.ts");
    expect(code).toMatch(/\bisPaidKeyTier\s*\(/);
    expect(code).not.toMatch(/\bhasFitAccess\b/);
  });

  // The inline regex is a real detector: it must match the retired shape.
  it("the inline-predicate detector recognises the retired shape, in either polarity", () => {
    expect('const paid = tier != null && tier !== "free" && tier !== "trial";').toMatch(INLINE_PREDICATE);
    expect("if ('free' !== tier)").toMatch(INLINE_PREDICATE);
    expect('const fit = tier === "free" || tier === PASS_TIER;').toMatch(INLINE_PREDICATE);
    expect("isPaidKeyTier(tier)").not.toMatch(INLINE_PREDICATE);
  });

  // TEETH: the one regression the arm check exists for — the dispatcher's
  // gate reverting to the paid predicate while key_status still advertises
  // fit_resume — must fail exactly the arm expectation.
  it("a copy whose fit_resume arm gates on isPaidKeyTier is caught by the arm check, not by the file-wide ones", () => {
    const code = codeOf("supabase/functions/agent-mcp/index.ts");
    const arm = fitResumeArmOf(code);
    const swappedArm = arm.replace(/\bhasFitAccess\s*\(/, "isPaidKeyTier(");
    expect(swappedArm).not.toBe(arm);
    const swapped = code.replace(arm, swappedArm);
    // The file-wide checks still pass on the copy (key_status keeps hasFitAccess) …
    expect(swapped).toMatch(/\bhasFitAccess\s*\(/);
    expect(swapped).not.toMatch(INLINE_PREDICATE);
    // … and only the arm check sees it.
    expect(fitResumeArmOf(swapped)).not.toMatch(/\bhasFitAccess\s*\(/);
    expect(fitResumeArmOf(swapped)).toMatch(/\bisPaidKeyTier\s*\(/);
    const inlined = code.replace(arm, arm.replace(/\bhasFitAccess\s*\(tier\)/, '(tier !== "free" && tier !== "trial")'));
    expect(inlined).not.toBe(code);
    expect(fitResumeArmOf(inlined)).toMatch(INLINE_PREDICATE);
  });
});
