import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WE WERE SERVING 6% OF THE LARGEST EMPLOYERS ON THE BOARD.
 *
 * Every capped vendor fetched from offset 0 on every pass. WORKDAY_PAGE_CAP is
 * 25 pages x 20 = 500 postings, so a tenant with more than 500 could never be
 * read past its first 500 no matter how many times the rotation visited it.
 * The cap was not a per-pass budget; it was a permanent ceiling.
 *
 * Measured live 2026-08-25, stored rows vs. the tenant's own advertised total:
 *
 *   CVS Health          678 of 19,265
 *   O'Reilly Auto       571 of 18,185
 *   Wells Fargo         585 of  1,771
 *   Trinity Health      570 of  2,000
 *   ------------------------------------
 *   four boards       2,404 of 41,221   = 6%
 *
 * Across a 24-board sample of the 160 Workday boards sitting at the cap we hold
 * 12,441 of 53,856 (23%), which scales to roughly 276,000 postings never
 * fetched — a LOWER bound, because several tenants report exactly 2000 and that
 * is Workday's own reporting cap rather than a count.
 *
 * The fix is a per-board cursor, not a bigger cap: raising the cap would slow
 * every pass and shrink how many boards the rotation reaches, which is the
 * trade the cap was chosen to make in the first place.
 *
 * IT ONLY WORKS BECAUSE OF THE SAFETY HALF. A windowed board used to still
 * DELETE the ids it had not read — closure LOGGING was suppressed, the delete
 * was not, and GRACE_MS is five minutes. Rotating the offset without that fix
 * would have made each pass cull the window the previous pass had just stored,
 * churning the board instead of filling it. The two changes are one change, and
 * these tests fail if either half is removed.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
// Comments stripped, because this change ADDS comments containing the very
// identifiers asserted below and that trap has caught this repo nine times.
//
// WHOLE-LINE comments only. The usual trailing-// strip truncates any line
// containing a URL — it cut
//   `...smartrecruiters.com/v1/companies/${s.token}/postings?...offset=...`
// at the "//" in "https://", so an assertion about the offset reaching the
// request failed against a line the stripper had eaten. A comment remover that
// silently mangles code is worse than none: it fails honest assertions and
// passes dishonest ones.
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");

describe("a cap that restarts at zero is a ceiling", () => {
  it.each(["fetchWorkday", "fetchOracle", "fetchRippling", "fetchSmartRecruiters"])(
    "%s resumes from a caller-supplied offset", (fn) => {
      expect(CODE, `${fn} still starts every pass at 0`)
        .toMatch(new RegExp(`async function ${fn}\\(s: JobSource, startOffset = 0\\)`));
    },
  );

  it("the offset actually reaches the request, not just the signature", () => {
    // A parameter that is accepted and ignored is the worst outcome: it reads
    // as fixed and changes nothing.
    expect(CODE).toMatch(/offset: startOffset \+ page \* 20/);                       // workday
    expect(CODE).toMatch(/offset=\$\{startOffset \+ page \* ORACLE_PAGE_SIZE\}/);     // oracle
    expect(CODE).toMatch(/offset=\$\{startOffset \+ offset\}/);                       // smartrecruiters
    expect(CODE).toMatch(/Math\.floor\(startOffset \/ RIPPLING_PER_PAGE\)/);          // rippling
  });

  it("every rotating fetcher reports where to resume", () => {
    expect((CODE.match(/nextOffset/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it("a finished feed wraps to zero instead of paging into nothing", () => {
    // Without the feedTotal bound, a board whose total shrinks between passes
    // would page forever past the end and store nothing.
    expect(CODE).toMatch(/exhausted \|\| \(feedTotal > 0 && advanced >= feedTotal\) \? 0 : advanced/);
    expect(CODE).toMatch(/reachedEnd \? 0 : lastPage \* RIPPLING_PER_PAGE/);
  });

  it("the cursor survives the pass and is cleared on wrap", () => {
    // Stored only for boards still filling, so the row does not grow an entry
    // per board in a 31,600-board catalogue.
    expect(CODE).toMatch(/eq\("k", "deep_cursor"\)/);
    expect(CODE).toMatch(/k: "deep_cursor"/);
    expect(CODE).toMatch(/delete deepCursors\[s\.token\]; deepCursorsDirty = true;/);
  });

  it("the rotation is PARKED, and the test says so out loud", () => {
    // Deployed 2026-08-25 and withdrawn the same day. Before: CVS Health 678
    // stored against 19,265 advertised. After a completed pass: exactly 500,
    // and still exactly 500 eleven minutes and one refresh later. O'Reilly
    // 571 -> 500, Trinity 570 -> 500, Wells Fargo 585 -> 498. Every at-cap
    // board converged on one window and lost rows it had held.
    //
    // Rows were not churning wholesale (CVS's 500 carried first_seen across
    // four hours, so they survived passes) but the count was pinned at exactly
    // the window size, and job_board_meta is not anon-readable so the cursor
    // could not be observed at all. Parked rather than left running.
    //
    // The plumbing below stays asserted because it is correct and it is what a
    // re-arm builds on. THIS test is the one that must be flipped, and only
    // once the cursor is observable — a deepCursor summary on status — so the
    // next attempt is judged on a number instead of an inference.
    expect(CODE).toMatch(/fetchBoard\(s, \(m\) => \{ failReason = m; \}, 0\)/);
    expect(CODE).not.toMatch(/fetchBoard\([^)]*deepCursors\[s\.token\]/);
  });

  // ── the safety half ────────────────────────────────────────────────────
  it("A PARTIAL READ NEVER ABSENCE-PRUNES", () => {
    // The load-bearing assertion. Rotation without this deletes the previous
    // window five minutes later, every pass, forever.
    expect(CODE).toMatch(/const partialRead = r\.windowed === true;/);
    expect(CODE).toMatch(/if \(partialRead\) continue;/);
  });

  it("but an aged-out row still goes, because that date is ours to prove", () => {
    // The age-out branch must come BEFORE the partialRead bail, or the 30-day
    // cap stops being enforced on exactly the biggest boards.
    const loop = CODE.slice(CODE.indexOf("for (const id of vanishedAll)"), CODE.indexOf("toUnstamp = ["));
    expect(loop).toMatch(/agedOutIds\.has\(id\)/);
    expect(loop.indexOf("agedOutIds.has(id)")).toBeLessThan(loop.indexOf("if (partialRead) continue;"));
  });

  it("a board read WHOLE still prunes normally", () => {
    // The relaxation is scoped to windowed boards. If `windowed` were hardcoded
    // true anywhere, every board would stop pruning and closures would stall.
    expect(CODE).toMatch(/windowed: feedTotal > all\.length/);
    expect(CODE).toMatch(/windowed: totalPages > RIPPLING_PAGE_CAP/);
  });
});
