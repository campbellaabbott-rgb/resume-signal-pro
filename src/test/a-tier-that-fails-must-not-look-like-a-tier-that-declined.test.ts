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
    for (const kind of ["embed", "ann_deadline", "ann_error", "refilter_deadline"]) {
      expect(FN, `${kind} must set the flag`).toContain(`semanticDegraded = "${kind}"`);
    }
    // An honest "no" must stay null, or the signal means nothing: the token
    // refusal, the filters-removed-everything case and the unanchored case are
    // answers, not failures.
    const decl = FN.indexOf("let semanticDegraded:");
    const setCount = (FN.slice(decl).match(/semanticDegraded = "/g) ?? []).length;
    // BACK TO FOUR. A fifth, "cooldown", was added and then removed: it depended
    // on module-level state surviving between requests, and that was measured
    // not to happen here (14 consecutive requests, zero cache hits against a 60s
    // TTL). A flag that can never be set is worse than no flag.
    expect(setCount, "only these four states may set it").toBe(4);
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

  it("does NOT rely on in-isolate state to stand the tier down", () => {
    // A 10-minute cooldown was shipped and then removed, because module-level
    // state does not survive between requests in this runtime. Measured on the
    // offset-ceiling exit, which reads the meta row and runs no query of its
    // own: fourteen consecutive requests — six on ONE TCP connection, under a
    // second apart — cost 452-1,034ms each against a 60,000ms TTL. Zero hits.
    // The cache was provably being seeded on those same requests, so it is a
    // demonstration rather than an inference.
    //
    // Each attempt is still bounded by its own 5s deadline and semanticDegraded
    // reports the failure from outside. A guard that cannot fire is worse than
    // no guard: it reads as protection.
    expect(FN, "the cooldown must not come back as in-isolate state")
      .not.toMatch(/semanticColdUntil/);
    expect(FN).not.toMatch(/SEMANTIC_COOLDOWN_MS/);
    // And the reason must stay written down, or it gets re-added.
    expect(FN).toMatch(/IN-ISOLATE STATE DOES NOT SURVIVE BETWEEN REQUESTS HERE/);
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
