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

  it("the rotation is ARMED, and the cursor is observable", () => {
    // PARKED on 2026-08-25 and re-armed the same day, because the park was a
    // mistake about MEASUREMENT, not about the code.
    //
    // I read CVS at 500 twice, eleven minutes apart, on a system whose refresh
    // passes run about ninety minutes, and concluded the rotation was pinned.
    // The next facet read — an hour later — had CVS at 630 and climbing, with
    // 13 workday boards above the 500 window. Two samples inside one pass
    // cannot distinguish "stuck" from "between passes", and I had no way to
    // check because job_board_meta is not anon-readable.
    //
    // So the cursor is now published on `status`, and that is the part that
    // must never be removed: without it the only way to judge this rotation is
    // to infer it from row counts, which is exactly how I got it wrong.
    expect(CODE).toMatch(/fetchBoard\(s, \(m\) => \{ failReason = m; \}, deepCursors\[s\.token\] \?\? 0\)/);
  });

  it("status publishes the cursor, so the rotation can be judged by a number", () => {
    expect(CODE).toMatch(/deepCursor: \(\(\) => \{/);
    // boards + maxOffset + top are the three that make a stuck cursor visible:
    // an offset that does not move between two reads is the whole diagnosis.
    expect(CODE).toMatch(/boards: entries\.length/);
    expect(CODE).toMatch(/maxOffset: entries\.length \? entries\[0\]\[1\] : 0/);
    expect(CODE).toMatch(/top: entries\.slice\(0, 8\)/);
  });

  it("the cursor read is the LAST element of a positionally destructured array", () => {
    // Adding it in the middle shifts all 28 names onto the wrong results. That
    // happened, and only a coincidental type error on an unrelated field caught
    // it — the shifted reads that still typechecked would have shipped silently.
    const arr = CODE.slice(CODE.indexOf("const [prog, pbMeta, rot, refreshMeta"));
    const end = arr.indexOf("]);");
    const body = arr.slice(0, end);
    const cur = body.indexOf('eq("k", "deep_cursor")');
    const hw = body.indexOf('eq("k", "catalog_highwater")');
    expect(cur, "deep_cursor is not read inside the status bundle").toBeGreaterThan(-1);
    expect(cur, "deep_cursor must come after every pre-existing read").toBeGreaterThan(hw);
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

  it("a named giant can be given a wider window, everyone else keeps the default", () => {
    // Measured 2026-08-30: Kroger advertises 12,350 postings against the
    // default 2,000-per-pass window — the deep cursor alone needs ~25 passes
    // to reach the tail once, and the 30-day sweep laps it. The per-board
    // `pages` override (the icims/PetSmart contract) is the fix, and it must
    // stay an OVERRIDE: the floor of 1 and the ?? mean an absent field keeps
    // the proven default, so one giant's window can never widen the fleet's.
    expect(CODE).toMatch(/const oraclePageCap = Math\.max\(1, s\.pages \?\? ORACLE_PAGE_CAP\);/);
    expect(CODE).toMatch(/page < oraclePageCap/);
  });

  it("a board read WHOLE still prunes normally", () => {
    // The relaxation is scoped to windowed boards. If `windowed` were hardcoded
    // true anywhere, every board would stop pruning and closures would stall.
    expect(CODE).toMatch(/windowed: feedTotal > all\.length/);
    expect(CODE).toMatch(/windowed: totalPages > RIPPLING_PAGE_CAP/);
  });
});
