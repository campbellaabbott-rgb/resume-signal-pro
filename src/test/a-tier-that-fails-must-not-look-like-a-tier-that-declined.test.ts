import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The semantic rescue tier is failing on every query, and nothing said so.
 *
 * Live, read-only: search_jobs_semantic answers 57014 "canceling statement due
 * to statement timeout" on real query embeddings. On the list path the tier's
 * own deadline is <= 5s, so it never even sees that error — withDeadline wins
 * the race first and hands back `{ data: null }`. The tier then returned [],
 * which is exactly what it returns when it looked and genuinely found nothing.
 *
 * So the page rendered "No verified openings match all of that" — a claim about
 * the CORPUS — on searches where the second pass had not run at all.
 *
 * This is the same shape as the ranked-path outage: down in production, behind
 * a silent catch, and only diagnosable once `ranked: true` was surfaced on the
 * response. The fix follows that precedent exactly rather than inventing a
 * second convention.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const JOBS = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

describe("a tier that fails must not look like a tier that declined", () => {
  it("declares the flag ABOVE the path that sets it", () => {
    // This file has already taken a TDZ ReferenceError from a declaration sited
    // below its use, and that outage took ranked search down silently. Position
    // is part of the fix, not a style preference.
    const decl = FN.indexOf("let semanticDegraded:");
    const firstUse = FN.indexOf('semanticDegraded = "');
    expect(decl, "semanticDegraded is not declared").toBeGreaterThan(-1);
    expect(firstUse, "semanticDegraded is never set").toBeGreaterThan(-1);
    expect(decl).toBeLessThan(firstUse);
    // Beside rankedFellBack, which is the same idea for the ranked path.
    expect(FN.indexOf("let rankedFellBack")).toBeLessThan(decl);
  });

  it("distinguishes a deadline miss from an RPC error — they are different silences", () => {
    // withDeadline is a Promise.race that RESOLVES { data: null } both on
    // timeout and on rejection; it never throws. So `error` is undefined on a
    // deadline miss and an `if (sErr)` guard alone can never see one.
    // `data === null && !error` is exactly and only that sentinel.
    expect(FN).toMatch(/if \(sem === null && !sErr\) \{[\s\S]{0,200}semanticDegraded = "ann_deadline";/);
    expect(FN).toMatch(/if \(sErr\) \{[\s\S]{0,200}semanticDegraded = "ann_error";/);
    // The old trailing .catch could never fire, because withDeadline never
    // rejects — a dead handler that made a dead tier look alive.
    expect(FN, "the dead .catch must be gone").not.toMatch(
      /\.catch\(\(\) => \(\{ data: null, error: new Error\("semantic deadline"\) \}\)\)/);
  });

  it("names every infrastructure failure, and only those", () => {
    for (const kind of ["embed", "ann_deadline", "ann_error", "refilter_deadline", "cooldown"]) {
      expect(FN, `${kind} must set the flag`).toContain(`semanticDegraded = "${kind}"`);
    }
    // An honest "no" must stay null, or the signal means nothing: the token
    // refusal, the filters-removed-everything case and the unanchored case are
    // answers, not failures.
    const decl = FN.indexOf("let semanticDegraded:");
    const setCount = (FN.slice(decl).match(/semanticDegraded = "/g) ?? []).length;
    // FIVE NOW: the four failures plus "cooldown", the stand-down that follows
    // one of them. It belongs here rather than being treated as a decline,
    // because the retrieval still did not happen — the page must not claim the
    // corpus has no answer just because the tier is resting.
    expect(setCount, "only these five states may set it").toBe(5);
  });

  it("surfaces it on the response, spread-when-set like rankedFellBack", () => {
    // Observable from outside without shell access to the function logs.
    expect((FN.match(/\.\.\.\(semanticDegraded \? \{ semanticDegraded \} : \{\}\),/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  it("stops filing a failed retrieval as a catalog gap", () => {
    // The demand census steers what gets sourced next. Logging a tier that
    // could not run as `rescued: 'none'` argues for adding jobs the board may
    // already have.
    expect(FN).toMatch(/const logMiss = \(rescued: "none" \| "fuzzy" \| "semantic" \| "degraded"\) =>/);
    expect(FN).toMatch(/logMiss\(semanticDegraded \? "degraded" : "none"\);/);
  });

  it("the page stops claiming the corpus has no answer", () => {
    expect(JOBS, "the response type must carry it").toMatch(/semanticDegraded\?: string;/);
    // The zero-state headline is a claim about the corpus; it may only be made
    // when every tier actually ran.
    expect(JOBS).toMatch(/data\?\.semanticDegraded[\s\S]{0,160}jobsPage\.zeroTitleDegraded/);
    expect(JOBS).toMatch(/data\?\.semanticDegraded[\s\S]{0,200}jobsPage\.zeroBodyDegraded/);
  });

  it("stands the tier down after a failure instead of paying 5s per search", () => {
    // The race lost EVERY time while the RPC was dead: a fixed 5.0s tax on a 9s
    // budget for nothing (58% of tookMs on a thin search), and the abandoned
    // query kept running in Postgres for another 13-31s because walking away
    // does not cancel it.
    expect(FN).toMatch(/const SEMANTIC_COOLDOWN_MS = 10 \* 60_000;/);
    expect(FN).toMatch(/semanticColdUntil = Date\.now\(\) \+ SEMANTIC_COOLDOWN_MS;/);
    // Checked BEFORE the embed, which costs 100-200ms of the per-request CPU
    // budget before the RPC that is going to fail is even reached.
    const check = FN.indexOf("if (Date.now() < semanticColdUntil)");
    const embed = FN.indexOf("const t_embed_query = Date.now();");
    expect(check, "no cooldown check").toBeGreaterThan(-1);
    expect(check, "the cooldown must be checked before the embed spend").toBeLessThan(embed);
  });

  it("a phase duration carries its outcome", () => {
    // `semantic: 5002` reads the same whether the tier answered in five seconds
    // or was cut off at its five-second deadline having answered nothing — which
    // is how "the rescue ladder was never the cost" got recorded as settled.
    expect(FN).toMatch(/const phaseOutcome: Record<string, string> = \{\};/);
    expect(FN).toMatch(/markFrom = \(name: string, t0: number, outcome\?: "ok" \| "deadline" \| "error" \| "declined"\)/);
    expect(FN).toMatch(/markFrom\("semantic", t_semantic, "deadline"\)/);
    expect(FN).toMatch(/markFrom\("semantic", t_semantic, "error"\)/);
    expect((FN.match(/phaseOutcome: \{ \.\.\.phaseOutcome \}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("a resolved ranked error is reported, not just checked", () => {
    // rankErr gated the happy path and was never read again, so a ranked search
    // that TIMED OUT was indistinguishable from one never attempted.
    expect(FN).toMatch(/if \(rankErr\) \{[\s\S]{0,320}rankedFellBack =/);
    expect(FN).toMatch(/ranked search failed for q=/);
  });
});
