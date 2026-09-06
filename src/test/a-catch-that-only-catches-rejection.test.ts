/**
 * A .catch() DOES NOT GUARD A RESOLVED undefined.
 *
 * The salary-benchmark fetch on the jobs page wrote its retry as
 *
 *     let { data: rows } = await call().catch(() => ({ data: null }));
 *
 * which reads as fully defended: whatever goes wrong, `rows` ends up null. It
 * is not. `.catch` runs on REJECTION only. A call that RESOLVES with undefined
 * — a stubbed client, a mocked module, a transport that returns nothing on a
 * timeout — sails past the catch and hits the destructure, which throws
 * "Cannot destructure property 'data' of '(intermediate value)' as it is
 * undefined". Inside an async IIFE in a mounted effect there is nothing to
 * catch that, so it surfaces as an unhandled rejection: the whole benchmark
 * map never loads, and the failure is invisible in the UI.
 *
 * It showed up as two unhandled rejections in the battery on 2026-09-06 —
 * passing tests, non-zero exit — which is exactly how a swallowed effect
 * failure looks in production too.
 *
 * The property this guard states is not about one call site's spelling. It is:
 * every value that gets DESTRUCTURED must be coalesced against the resolved
 * case, not only the rejected one. `.catch(...)` alone is not sufficient
 * defence for a destructuring assignment.
 *
 * Assertions run against COMMENT-STRIPPED source. The prose above contains the
 * exact broken form, and asserting on RAW source would match this comment and
 * pass while the code was still wrong — the trap this repo has fallen into
 * seven times.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RAW = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("a catch that only catches rejection", () => {
  it("never destructures straight out of a bare .catch on the jobs page", () => {
    // `({ a } = await x().catch(...))` and `let { a } = await x().catch(...)`
    // are the two shapes that read as safe and are not.
    const offenders = CODE.match(/\{[^{}\n]*\}\s*=\s*await\s+[A-Za-z_$][\w$]*\(\)\.catch\(/g) ?? [];
    expect(offenders).toEqual([]);
  });

  it("coalesces the RESOLVED value of the salary-benchmark call, not just the rejected one", () => {
    const i = CODE.indexOf("get_salary_benchmarks");
    expect(i).toBeGreaterThan(-1);
    // The helper and both of its await sites live within a few hundred chars.
    const around = CODE.slice(Math.max(0, i - 400), i + 700);
    expect(around).toContain("?? { data: null }");
  });

  it("has teeth: the pre-fix spelling would fail the first assertion", () => {
    const broken = 'let { data: rows } = await call().catch(() => ({ data: null }));';
    expect(broken.match(/\{[^{}\n]*\}\s*=\s*await\s+[A-Za-z_$][\w$]*\(\)\.catch\(/g)).not.toEqual(null);
  });
});
