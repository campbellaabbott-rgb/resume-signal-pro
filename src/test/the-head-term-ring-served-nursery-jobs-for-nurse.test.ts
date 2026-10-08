// @vitest-environment node
/**
 * THE HEAD-TERM RING SERVED NURSERY JOBS FOR "NURSE" (L8-05).
 *
 * q="nurse", GB, limit 60: total 314 and positions 37-46 were ten "Nursery
 * ..." rows (Busy Bees, N Family Club, Monkey Puzzle). The ring read titles by
 * a bare prefix, ILIKE 'nurse%', and scoreTitle gave any title starting with
 * the query +45 whether or not the prefix ended at a word: "Nursery
 * Housekeeper" scored 29.75 for "nurse" on that bonus alone, "JavaScript
 * Developer" the same for "java". English FTS stems nursery to 'nurseri', so
 * those rows were outside the count they sat under.
 *
 * The ring now also requires the prefix to end at a word (title ~* pattern,
 * run here in Postgres), the deep page's fallback exclusion uses the same rule,
 * and the +45 needs the boundary.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ringWordPattern, scoreTitle, startsWithWord } from "../../supabase/functions/job-board/search-routing.ts";
import { bootBoardList, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

describe("the +45 prefix bonus needs a word boundary", () => {
  it("Nursery and JavaScript no longer outscore an unrelated title on the prefix alone", () => {
    expect(scoreTitle("Nursery Housekeeper", "nurse")).toBeLessThan(0);
    expect(scoreTitle("JavaScript Developer", "java")).toBeLessThan(0);
    expect(scoreTitle("Nurse Practitioner", "nurse") - scoreTitle("Nursery Practitioner", "nurse")).toBeGreaterThan(100);
  });

  it("a real word prefix keeps it, and so does a symbol", () => {
    expect(startsWithWord("nurse practitioner", "nurse")).toBe(true);
    expect(startsWithWord("nurse", "nurse")).toBe(true);
    expect(startsWithWord("nurse-midwife", "nurse")).toBe(true);
    expect(startsWithWord("nursery nurse", "nurse")).toBe(false);
    expect(startsWithWord("c++ engineer", "c++")).toBe(true);
    expect(startsWithWord("c++builder", "c++")).toBe(true);
  });
});

describe("the ring's pattern, in Postgres", () => {
  let db: PGlite;
  beforeAll(async () => { db = new PGlite(); });
  const hit = async (title: string, q: string) =>
    (await db.query<{ m: boolean }>("SELECT $1 ~* $2 AS m", [title, ringWordPattern(q)])).rows[0].m;

  it("matches a word, never the start of a longer one", async () => {
    expect(await hit("Nurse Practitioner", "nurse")).toBe(true);
    expect(await hit("NURSE", "nurse")).toBe(true);
    expect(await hit("Nurse, Band 5", "nurse")).toBe(true);
    expect(await hit("Nursery Housekeeper", "nurse")).toBe(false);
    expect(await hit("Registered Nurse", "registered nurse")).toBe(true);
    expect(await hit("Registered Nurses Wanted", "registered nurse")).toBe(false);
    expect(await hit("C++ Engineer", "c++")).toBe(true);
    expect(await hit("Clerk (Part Time)", "clerk (part")).toBe(true);
  });
});

describe("the shipped ring read binds it", () => {
  let board: BoardList;
  beforeAll(async () => { board = await bootBoardList(); });

  it("q=nurse: the ring's title read carries the prefix AND the word pattern", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse", country: "GB", limit: 60, groupSimilar: false });
    const ring = board.db.queries.find((q) => q.table === "job_board_postings" && q.calls.some(([m, a]) => m === "ilike" && a[0] === "title"));
    expect(ring, "the ring read ran").toBeTruthy();
    expect(ring!.calls.find(([m]) => m === "ilike")![1]).toEqual(["title", "nurse%"]);
    expect(ring!.calls.find(([m]) => m === "filter")![1]).toEqual(["title", "imatch", ringWordPattern("nurse")]);
  });
});
