import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A PAGE THAT COULD NEVER BE SCORED IS NOT A PERSONALISED PAGE.
 *
 * 2026-09-04, from a real visitor's screenshot: a scanned résumé, "For you"
 * active, sort newest first — and the board saying "not ranked — no posting on
 * this page could be scored yet". Fit ranking scores the page it is given, and
 * the default page is the newest rows, which are precisely the rows whose
 * description has not arrived yet (it comes on a later detail hop). Measured
 * the same day: the newest 20 rows were 5% scoreable, while role-query pages
 * ran 85-95%. So the one view named after personalisation was the one
 * guaranteed to show none.
 *
 * `hasDescription` narrows to rows the scorer can read. It is deliberately NOT
 * bound by any search RPC, so the blind-set gate routes a request carrying it
 * through buildQuery rather than letting an RPC answer with rows it never
 * filtered — the p_work_mode regression class, avoided the same way
 * excludeAgencies avoids it. And it is disclosed, because a filtered page that
 * does not say so gets read as a census.
 */
const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const FILTERS_RAW = readFileSync(resolve(ROOT, "supabase/functions/job-board/filters.ts"), "utf8");
const BOARD_RAW = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const FILTERS = strip(FILTERS_RAW);
const BOARD = strip(BOARD_RAW);
// CODE is asserted against the stripped source, PROSE against the raw source.
// Asserting a comment's words against stripped source is this repo's oldest
// guard bug — six occurrences now, and it always passes for the wrong reason
// or fails for a confusing one.

describe("a page that could never be scored", () => {
  it("is declared, normalised strictly, and carried into applied", () => {
    expect(FILTERS).toMatch(/hasDescription: boolean;/);
    expect(FILTERS).toMatch(/const hasDescription = body\.hasDescription === true;/);
    expect(FILTERS, "a string \"true\" must be named as ignored, not silently honoured")
      .toMatch(/if \(body\.hasDescription !== undefined && body\.hasDescription !== null && typeof body\.hasDescription !== "boolean"\) \{\s*ignored\.push\("hasDescription"\);/);
    expect(FILTERS).toMatch(/excludeAgencies,\s*hasDescription,\s*\},/);
  });

  it("narrows on the column the scorer actually reads", () => {
    expect(BOARD).toMatch(/if \(applied\.hasDescription\) q = q\.not\("description", "is", null\);/);
  });

  it("is NOT bound by any search RPC, so a request carrying it cannot be answered blind", () => {
    const set = FILTERS.slice(FILTERS.indexOf("const RPC_BOUND_FILTERS"), FILTERS.indexOf("const RPC_BOUND_FILTERS") + 700);
    expect(set).not.toMatch(/"hasDescription"/);
  });

  // Two things this filter deliberately does NOT have. Both were written, both
  // were caught by existing guards the same minute, and both absences are the
  // correct answer rather than a gap — so they are pinned as decisions.

  it("emits NO disclosure flag: the only caller that sets it already knows it asked", () => {
    expect(BOARD, "an emitter with no reader is the defect a-disclosure-nobody-renders-is-not-a-disclosure guards")
      .not.toMatch(/out\.describedOnly/);
    expect(BOARD_RAW, "the reason must stay written down, or someone re-adds the flag").toMatch(/NO describedOnly DISCLOSURE FLAG/);
  });

  it("takes NO per-row self-check: the list route does not carry description", () => {
    expect(FILTERS, "a check against a column rowToJob never emits flags every row — the companyToken mistake")
      .not.toMatch(/a\.hasDescription && r\.description/);
    expect(FILTERS_RAW, "the reason must stay written down, or someone re-adds the check").toMatch(/NO SELF-CHECK FOR hasDescription/);
  });
});
