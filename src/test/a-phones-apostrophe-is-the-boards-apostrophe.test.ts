// @vitest-environment node
/**
 * S11-021 (the apostrophe half): location is matched with a literal ILIKE and
 * nothing folded the curly apostrophe iPhone smart punctuation types, so
 * "St. John’s" (U+2019) matched 0 live postings where "St. John's" matched
 * 101. Stored rows are mostly ASCII (4,671 locations with "'" against 89 with
 * U+2019, read 2026-10-11 with countOnly probes). The list action now folds
 * its typed text, ingest folds what it stores, and a stored curly apostrophe
 * healed by the next read is our reading changing, not an employer's edit.
 *
 * The shipped job-board handler is bundled and run with only its database
 * faked, and the location predicate it sends is read off the query.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootBoardList, row, type BoardList } from "./helpers/board-list";
import { foldApostrophes, foldTypedText, sameButApostrophes } from "../../supabase/functions/job-board/typed-text";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("a phone's apostrophe is the board's apostrophe (S11-021)", () => {
  let board: BoardList;
  beforeAll(async () => { board = await bootBoardList(); });
  beforeEach(() => board.reset());

  it("a location typed with U+2019 reaches the database with the ASCII apostrophe the rows carry", async () => {
    board.answer((q) => (q.table === "job_board_postings" ? { data: [row("greenhouse:acme:1", "Nurse", { location: "St. John's, NL, Canada", country: "CA" })], error: null, count: 1 } : undefined));
    await board.post({ action: "list", location: "St. John’s", limit: 20, groupSimilar: false });
    const sent = JSON.stringify(board.db.queries.filter((q) => q.table === "job_board_postings").map((q) => q.calls));
    expect(sent, "the location predicate carried a curly apostrophe no stored row has").not.toContain("’");
    expect(sent).toContain("St. John's");
  });

  it("the fold is exactly the apostrophe: other text is untouched", () => {
    expect(foldApostrophes("Women’s Health ‘A’ ʼOkina")).toBe("Women's Health 'A' 'Okina");
    expect(foldTypedText({ q: "nurse", location: "Montréal" })).toEqual({ q: "nurse", location: "Montréal" });
    expect(foldTypedText({ q: "women’s health", location: 3 })).toEqual({ q: "women's health", location: 3 });
  });

  it("a stored curly apostrophe healed on the next read is not logged as an employer edit", () => {
    expect(sameButApostrophes("St. John’s", "St. John's")).toBe(true);
    expect(sameButApostrophes("St. John's", "St. John's")).toBe(false);
    expect(sameButApostrophes("Nurse", "Senior Nurse")).toBe(false);
    // Ingest stores the fold, and the change log's note skips an apostrophe-only difference.
    expect(FN).toMatch(/title: clean\(foldApostrophes\(j\.title\.trim\(\)\)\.slice\(0, 300\)\)/);
    expect(FN).toMatch(/location: clean\(foldApostrophes\(j\.location\.trim\(\)\)\.slice\(0, 300\)\)/);
    const note = FN.slice(FN.indexOf("const note = (field: string, oldV: unknown, newV: unknown) => {"));
    expect(note.slice(0, 600)).toMatch(/if \(sameButApostrophes\(oldV, newV\)\) return;/);
  });
});
