import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THREE WAYS THE BOARD PUNISHED A VISITOR FOR ITS OWN BAD DAY.
 *
 * All three were measured on the live site and all three are usability
 * defects, not edge cases — each fires on an ordinary action during any wobble:
 *
 *  1. AN APOSTROPHE WAS TREATED AS AN ATTACK. The error classifier matched a
 *     bare ' so "Kohl's", "St. Luke's", "Lowe's" and "Macy's" — real employers
 *     on this board — were labelled hostile queries. The visitor was told their
 *     own search was the problem, given NO retry, and offered one button that
 *     threw away what they typed.
 *  2. A FAILED "LOAD MORE" DELETED THE 60 JOBS ALREADY ON SCREEN, because the
 *     error state replaced the whole list regardless of which page failed. One
 *     flaky request on a phone wiped out minutes of scrolling with no way back.
 *  3. A FAILED DESCRIPTION FETCH WAS CACHED AS "this employer wrote none".
 *     invokeBoard RETURNS errors rather than throwing, so the catch never
 *     fired; `res?.description ?? ""` wrote empty string, which this cache
 *     defines as fetched-and-empty. A transient error became a permanent false
 *     claim about a named company for the rest of the session.
 */
const UI = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

describe("a failure costs the visitor as little as possible", () => {
  it("does not call an ordinary possessive a hostile query", () => {
    // Extracted by finding the literal's own end delimiter, not by [^/]+ —
    // the pattern contains escaped slashes (\/\*), so a "no slashes" class
    // stops at the first one and matches nothing. That mistake was in this
    // test, not in the code it guards.
    const start = UI.indexOf("setErrorKind(/");
    expect(start, "error classifier not found").toBeGreaterThan(-1);
    const end = UI.indexOf("/i.test(q)", start);
    expect(end, "classifier end delimiter not found").toBeGreaterThan(start);
    const source = UI.slice(start + "setErrorKind(/".length, end);
    const re = new RegExp(source, "i");
    // Real employers on this board must never be classified as attacks.
    for (const q of ["Kohl's", "St. Luke's", "Lowe's", "Macy's", "Land O'Lakes"]) {
      expect(re.test(q), `${q} must not be treated as a hostile query`).toBe(false);
    }
    // A genuine injection sequence still classifies, so the hint stays useful.
    expect(re.test("1; DROP TABLE jobs")).toBe(true);
  });

  it("always offers a retry, whatever it thinks of the query", () => {
    // The query branch used to offer ONLY "Clear the search".
    const block = UI.slice(UI.indexOf('errorKind === "query" && ('), UI.indexOf('errorKind === "query" && (') + 400);
    expect(UI).toMatch(/onClick=\{\(\) => fetchJobs\(0\)\}[\s\S]{0,120}jobsPage\.retry/);
    // Clearing is still offered, but as the secondary action.
    expect(block).toMatch(/jobsPage\.clearSearch/);
  });

  it("a failed Load more keeps the results on screen", () => {
    // Only a FIRST-PAGE failure may replace the list.
    expect(UI).toMatch(/if \(offset === 0\) setError\(true\);\s*\n\s*else setLoadMoreError\(true\);/);
    // And the inline strip retries at the same place rather than resetting.
    expect(UI).toMatch(/jobsPage\.loadMoreFailed/);
    expect(UI).toMatch(/loadMoreError \? t\("jobsPage\.loadMoreRetry"/);
  });

  it("never caches a failed description fetch as 'no description'", () => {
    const fn = UI.slice(UI.indexOf('const { data: res, error: detErr }'), UI.indexOf('const { data: res, error: detErr }') + 900);
    expect(fn, "detail fetch not found").not.toBe("");
    // The error must be READ — invokeBoard returns it rather than throwing,
    // which is exactly why the old catch-only version never fired.
    expect(fn).toMatch(/error: detErr/);
    expect(fn).toMatch(/if \(detErr \|\| !res\)/);
    // On failure: evict, never write. A written "" means fetched-and-empty.
    expect(fn).toMatch(/descCache\.current\.delete\(job\.id\)/);
    expect(fn).not.toMatch(/descCache\.current\.set\(job\.id, res\?\.description \?\? ""\)/);
  });

  it("shows a fetch failure as a failure, not as an employer's silence", () => {
    expect(UI).toMatch(/\) : detailFailed \? \(/);
    expect(UI).toMatch(/jobsPage\.descFailed/);
    // And it resets per open, so a retry can succeed.
    expect(UI).toMatch(/setDetailFailed\(false\);/);
  });
});
