// @vitest-environment node
/**
 * AN EMPLOYER WE DO NOT CARRY IS NOT AN EMPLOYER WITH NO OPENINGS (sweep
 * S11-020), the server half. The page half is the .tsx file of the same name.
 *
 * WHAT WAS WRONG. job-board's list filtered company_token IN (...) without
 * asking the catalogue. A token the board has never read (amazon, google,
 * nonexistent-token-xyz) answered 200 with total 0 and nothing to tell it
 * apart from a carried employer whose board is empty today, so the company
 * page printed "<X> has no open roles" under an indexable title for any
 * string anyone typed into the address.
 *
 * WHAT HOLDS NOW, on the shipped handler (database faked):
 *   - a scope of only uncarried tokens answers the empty list shape with
 *     unknownCompanies naming them, and reads no postings at all;
 *   - a carried token is served as before, with no unknownCompanies;
 *   - a scope mixing the two is served as before: its rows are real.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, type BoardList } from "./helpers/board-list";
import { CATALOG } from "./helpers/catalog";
import { uncarriedCompanies } from "../../supabase/functions/job-board/uncarried";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });
beforeEach(() => board.reset());

const CARRIED = CATALOG[0].token;
const postingReads = () => board.db.queries.filter((q) => q.table === "job_board_postings");

describe("the list names the employers it does not carry", () => {
  it("amazon, google and a typo: no rows, a zero, and the tokens named", async () => {
    for (const token of ["amazon", "google", "nonexistent-token-xyz"]) {
      expect(CATALOG.some((c) => c.token === token), `${token} is carried now; pick another`).toBe(false);
      board.reset();
      const r = await board.post({ action: "list", companies: [token], limit: 60 });
      expect(r.unknownCompanies, `${token}: nothing tells an uncarried employer from an empty board`).toEqual([token]);
      expect(r.total).toBe(0);
      expect(r.jobs).toEqual([]);
      expect(postingReads(), "an employer we do not carry was searched for").toEqual([]);
    }
  });

  it("a carried employer is served as before and names nothing", async () => {
    const r = await board.post({ action: "list", companies: [CARRIED], limit: 60 });
    expect(r.unknownCompanies).toBeUndefined();
    expect(postingReads().length, "the carried employer's postings were never read").toBeGreaterThan(0);
  });

  it("a scope mixing carried and uncarried employers is served as before", async () => {
    const r = await board.post({ action: "list", companies: [CARRIED, "nonexistent-token-xyz"], limit: 60 });
    expect(r.unknownCompanies).toBeUndefined();
    expect(postingReads().length).toBeGreaterThan(0);
  });
});

describe("the rule itself", () => {
  const cat = new Set(["acme", "beta"]);
  it("only a scope with every token uncarried is named, each token once", () => {
    expect(uncarriedCompanies([], cat)).toBeNull();
    expect(uncarriedCompanies(["acme"], cat)).toBeNull();
    expect(uncarriedCompanies(["acme", "zed"], cat)).toBeNull();
    expect(uncarriedCompanies(["zed", "zed", "yon"], cat)).toEqual(["zed", "yon"]);
  });
});
