// @vitest-environment node
/**
 * A TRAILING "UNITED" BECAME A PLACE FILTER (L8-09).
 *
 * {q:"pilot united"} took the location-split rescue: locationSplit {q:"pilot",
 * location:"united"}, total 1,283 — pilots anywhere "United" appears (United
 * States, United Kingdom), the employer the searcher named discarded. Any
 * letters-only tail was bound as location ILIKE '%tail%', and the acceptance
 * gate (hits >= max(2 x total, 15)) passes trivially for a word in half the
 * board's locations. A one-word tail that only ever qualifies a place
 * (united, states, kingdom, county, remote, north, new, ...) is no longer tried;
 * a real place, and a two-word one ("united kingdom"), still is.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, row, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });
beforeEach(() => board.reset());

const thin = (total: number) => ({ data: [{ ...row("greenhouse:a:1", "Pilot"), total_rows: total, related_rows: null }], error: null });
const probesAt = () => board.db.rpcArgs("search_jobs").map((a) => a.p_location).filter((l) => l !== null && l !== undefined);

describe("the location-split rescue", () => {
  it("never tries a word that only qualifies a place", async () => {
    board.answer((q) => (q.rpc === "search_jobs" ? thin(3) : undefined));
    await board.post({ action: "list", q: "pilot united", limit: 20, groupSimilar: false });
    expect(probesAt()).toEqual([]);
    board.reset();
    board.answer((q) => (q.rpc === "search_jobs" ? thin(3) : undefined));
    await board.post({ action: "list", q: "nurse county", limit: 20, groupSimilar: false });
    expect(probesAt()).toEqual([]);
  });

  it("still tries a real place, and a two-word place", async () => {
    board.answer((q) => (q.rpc === "search_jobs" ? thin(3) : undefined));
    await board.post({ action: "list", q: "nurse boston", limit: 20, groupSimilar: false });
    expect(probesAt()).toEqual(["boston"]);
    board.reset();
    board.answer((q) => (q.rpc === "search_jobs" ? thin(3) : undefined));
    await board.post({ action: "list", q: "senior pilot united kingdom", limit: 20, groupSimilar: false });
    expect(probesAt()).toEqual(["united kingdom"]);
  });
});
