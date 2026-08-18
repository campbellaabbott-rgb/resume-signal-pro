import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "LOAD MORE" SHOWED THE SAME JOB TWICE AND SILENTLY HID OTHERS.
 *
 * Measured 2026-08-18 with the ingest active: 4 of 8 page-1 -> page-2
 * transitions on the default sort OVERLAPPED — the worst pair duplicated 9 of
 * 60 rows and hid 9 others (union 111/120). Offset pagination cannot be stable
 * over a table inserting ~70k rows/day above the reader.
 *
 * The fix is a keyset cursor: the (effective_posted, id) of the last RAW row
 * the previous page consumed. What this file pins is the correctness core:
 * the cursor predicate must be the EXACT successor set of the ORDER BY, the
 * inputs must be validated before interpolation into a filter tree, and the
 * cursor must come from the raw stream — not the grouped cards.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const UI = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

describe("board pages are anchored to rows, not row counts", () => {
  it("the keyset predicate is the exact successor of ORDER BY (ep DESC, id ASC)", () => {
    // lt on the date, and the id tiebreak ONLY inside the eq branch. A missing
    // tiebreak drops every same-timestamp sibling after the cursor row.
    expect(FN).toMatch(
      /\.or\(`\$\{dateCol\}\.lt\."\$\{cursor\.ep\}",and\(\$\{dateCol\}\.eq\."\$\{cursor\.ep\}",id\.gt\."\$\{cursor\.id\}"\)`\)/,
    );
  });

  it("validates both cursor fields before interpolating them into a filter tree", () => {
    const block = FN.slice(FN.indexOf("const cursor = (() => {"), FN.indexOf("})();", FN.indexOf("const cursor = (() => {")));
    expect(block, "cursor parser not found").not.toBe("");
    // The timestamp must look like our own emission, the id must be bounded,
    // and characters with meaning inside or() trees are rejected outright.
    expect(block).toMatch(/\\d\{4\}-\\d\{2\}-\\d\{2\}T/);
    expect(block).toMatch(/id\.length > 200/);
    expect(block).toMatch(/\[",\(\)\\\\\]/);
    // Invalid input falls back to offset paging — never a 500 on a stale bookmark.
    expect(block.match(/return null;/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("emits the successor from the RAW stream, never from the grouped cards", () => {
    const emit = FN.slice(FN.indexOf("nextCursor: (() => {"), FN.indexOf("})(),", FN.indexOf("nextCursor: (() => {")));
    expect(emit, "nextCursor emission not found").not.toBe("");
    expect(emit).toMatch(/\(data \?\? \[\]\)\[Math\.max\(0, grouped\.rawConsumed - 1\)\]/);
    // Paths that still page by offset must say so with null, not a wrong cursor.
    expect(emit).toMatch(/if \(twoSubset \|\| sortSalary\) return null;/);
  });

  it("selects the ordering column the cursor is built from", () => {
    expect(FN).toMatch(/missing_since,effective_posted",/);
  });

  it("the client sends the cursor only when CONTINUING a list", () => {
    // A fresh load (offset 0) must start from the top; carrying a stale cursor
    // across a filter change would resume mid-list of a different result set.
    expect(UI).toMatch(/cursor: offset > 0 \? nextCursorRef\.current \?\? undefined : undefined,/);
    expect(UI).toMatch(/nextCursorRef\.current = br\.nextCursor \?\? null;/);
  });
});
