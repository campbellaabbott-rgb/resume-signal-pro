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
    expect(setCount, "exactly the four infrastructure failures may set it").toBe(4);
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
});
