// @vitest-environment node
/**
 * TWO HEADLINES THAT PUBLISHED A NUMBER THE PAGE COULD NOT BACK.
 *
 * L8-16 (old 2.34): a ring-merged search withdrew its exact count for a
 * "proven floor" larger than the count. q="nurse", GB: offsets 0/135/218 said
 * 314; offset 400 said totalAtLeast 460, offset 497 512 with hasMore false,
 * after only 207 distinct rows. The floor was offset + cards shown: a POOL
 * position, which counts head-term ring rows outside the tsquery ("Nursery
 * ...") and the jump to the 400 seam.
 *
 * L8-17 (old 2.15): "c#" and "c++" parse to the bare letter, so both
 * published total 2,067 as exact, ranked, while 15 of 60 first-page titles
 * carried "c#".
 *
 * Both run through the shipped handler (helpers/board-list.ts) with search_jobs
 * and the ring read answered.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, row, type BoardList } from "./helpers/board-list";
import { rowsReached, symbolLiteralRows } from "../../supabase/functions/job-board/paging.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });
beforeEach(() => board.reset());

const ranked = (rows: Array<Record<string, unknown>>, total: number) =>
  rows.map((r) => ({ ...r, total_rows: total, related_rows: null, title_match: true, snippet: null }));
const isRing = (q: { table: string; calls: Array<[string, unknown[]]> }) =>
  q.table === "job_board_postings" && q.calls.some(([m, a]) => m === "ilike" && a[0] === "title");

describe("a deep page sets the count against rows, not pool positions (L8-16)", () => {
  it("q=nurse GB at offset 400: the exact 314 stands (it was withdrawn for 460)", async () => {
    const sql = Array.from({ length: 60 }, (_, i) => row(`greenhouse:nhs:${200 + i}`, `Registered Nurse ${i}`));
    board.answer((q) => (q.rpc === "search_jobs" ? { data: ranked(sql, 314), error: null } : undefined));
    board.answer((q) => (isRing(q) ? { data: [row("greenhouse:busybees:1", "Nursery Practitioner")], error: null } : undefined));
    const r = await board.post({ action: "list", q: "nurse", country: "GB", offset: 400, limit: 60, groupSimilar: false });
    expect(board.db.rpcArgs("search_jobs")[0]).toMatchObject({ p_offset: 200 });
    expect(r.total).toBe(314);
    expect(r.totalAtLeast).toBeUndefined();
  });

  it("a count the rows really outrun is still withdrawn, for the rows reached", async () => {
    const sql = Array.from({ length: 60 }, (_, i) => row(`greenhouse:nhs:${200 + i}`, `Registered Nurse ${i}`));
    board.answer((q) => (q.rpc === "search_jobs" ? { data: ranked(sql, 210), error: null } : undefined));
    const r = await board.post({ action: "list", q: "nurse", country: "GB", offset: 400, limit: 60, groupSimilar: false });
    expect(r.total).toBeNull();
    expect(r.countUnavailable).toBe(true);
    expect(r.totalAtLeast).toBe(260);
  });

  it("page one still withdraws a count its own rows outrun (q=camarero: 3 counted, 60 delivered)", async () => {
    const sql = [row("greenhouse:bar:1", "Camarero"), row("greenhouse:bar:2", "Camarero de sala"), row("greenhouse:bar:3", "Camarero extra")];
    const ring = Array.from({ length: 57 }, (_, i) => row(`greenhouse:bar:${100 + i}`, "Camarero/a"));
    board.answer((q) => (q.rpc === "search_jobs" ? { data: ranked(sql, 3), error: null } : undefined));
    board.answer((q) => (isRing(q) ? { data: ring, error: null } : undefined));
    const r = await board.post({ action: "list", q: "camarero", limit: 60, groupSimilar: false });
    expect(r.total).toBeNull();
    expect(r.totalAtLeast).toBe(60);
  });

  it("the arithmetic alone: positions below the seam, SQL rank past it, and nothing from an empty deep page", () => {
    expect(rowsReached({ deepPage: false, pOffset: 0, offset: 218, rawConsumed: 60, poolLength: 260, sqlRowsOnPage: 200 })).toBe(260);
    expect(rowsReached({ deepPage: true, pOffset: 297, offset: 497, rawConsumed: 17, poolLength: 0, sqlRowsOnPage: 17 })).toBe(314);
    expect(rowsReached({ deepPage: true, pOffset: 200, offset: 400, rawConsumed: 0, poolLength: 0, sqlRowsOnPage: 0 })).toBe(0);
  });
});

describe("a symbol query withholds the letter's count (L8-17)", () => {
  it("q=c#: total withheld, a floor of the rows that carry c#", async () => {
    const rows = [
      row("greenhouse:a:1", "Senior C# Developer"), row("greenhouse:a:2", "C Programmer"),
      row("greenhouse:a:3", "C#/.NET Engineer"), row("greenhouse:a:4", "C++ Engineer"),
    ];
    board.answer((q) => (q.rpc === "search_jobs" ? { data: ranked(rows, 2067), error: null } : undefined));
    const r = await board.post({ action: "list", q: "c#", limit: 60, groupSimilar: false });
    expect(r.total).toBeNull();
    expect(r.countUnavailable).toBe(true);
    expect(r.totalAtLeast).toBe(2);
    expect(r.countCapped).toBeUndefined();
  });

  it("countOnly says unknown instead of the letter's 2,067", async () => {
    board.answer((q) => (q.rpc === "search_jobs" ? { data: ranked([row("greenhouse:a:1", "C# Developer")], 2067), error: null } : undefined));
    const r = await board.post({ action: "list", q: "c++", countOnly: true });
    expect(r.total).toBeNull();
    expect(r.countUnavailable).toBe(true);
  });

  it("an ordinary query keeps its exact count", async () => {
    board.answer((q) => (q.rpc === "search_jobs" ? { data: ranked([row("greenhouse:a:1", "Welder")], 684), error: null } : undefined));
    board.answer((q) => (isRing(q) ? { data: [], error: null } : undefined));
    const r = await board.post({ action: "list", q: "welder", limit: 60, groupSimilar: false });
    expect(r.total).toBe(684);
    const c = await board.post({ action: "list", q: "welder", countOnly: true });
    expect(c.total).toBe(684);
  });

  it("the literal floor counts every symbol token", () => {
    expect(symbolLiteralRows([{ title: "C# Dev" }, { title: "C Dev" }, { title: "c# and c++" }], "c# c++")).toBe(1);
    expect(symbolLiteralRows([{ title: "C# Dev" }], "nurse")).toBe(0);
  });
});
