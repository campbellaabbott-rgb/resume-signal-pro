// @vitest-environment node
/**
 * A FILTER, OR THE PAY ORDER, CHANGED WHICH JOBS WERE SEARCHED.
 *
 * L8-04: q="it manager" alone took route SIMPLE (10/10 IT Manager). With
 * country=GB the router stood down and the english tsquery, which drops "it",
 * answered 5,649 rows identical to q="manager": Store Manager, TEAM MANAGER.
 * The router's own premise was wrong: buildQuery binds every filter in SQL
 * BEFORE the routed window, so a filtered routed search is not a subset.
 *
 * L8-01: with any filter set, sort=salary fell to the recency path's
 * substring ILIKE, so q="rn" (US, Highest pay) served an orthopedic surgeon
 * (NorthwesteRN), "Vice President ... | WesteRNunion" and no nurse.
 *
 * L8-02: on an employer search the pay order searched TITLES for the
 * employer's name (q="dominos": top $46,800 while Domino's $85,000 manager
 * rows were excluded for not naming the brand), or was ignored outright.
 *
 * Run through the shipped handler (helpers/board-list.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, calls, row, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });
beforeEach(() => board.reset());

const postings = () => board.db.queries.filter((q) => q.table === "job_board_postings");
const titleIlike = () => postings().filter((q) => q.calls.some(([m, a]) => m === "or" && String(a[0]).includes("title.ilike")));

describe("a filter keeps the query's route (L8-04)", () => {
  it("q=it manager with country GB is served by the simple-config title match, filter bound", async () => {
    board.answer((q) => (q.table === "job_board_postings" && calls(q, "textSearch")
      ? { data: [row("greenhouse:acme:1", "IT Manager"), row("greenhouse:acme:2", "Head of IT")], error: null } : undefined));
    const r = await board.post({ action: "list", q: "it manager", country: "GB", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("SIMPLE");
    const routed = postings().find((q) => calls(q, "textSearch"))!;
    expect(routed.calls.find(([m]) => m === "textSearch")![1][2]).toMatchObject({ config: "simple" });
    expect(calls(routed, "eq", "country", "GB"), "the filter rides the routed read").toBe(true);
    expect(board.db.rpcArgs("search_jobs"), "the english tsquery never ran").toEqual([]);
  });
});

describe("the pay order searches what relevance searches (L8-01, L8-02)", () => {
  it("q=rn US sort=salary: a title match ordered on pay, no substring ILIKE anywhere", async () => {
    board.answer((q) => (q.table === "job_board_postings" && calls(q, "textSearch")
      ? { data: [row("greenhouse:h:1", "Registered Nurse (RN)", { salary_rank_usd: 120000 })], error: null } : undefined));
    const r = await board.post({ action: "list", q: "rn", country: "US", sort: "salary", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("SALARY");
    const sal = postings().find((q) => calls(q, "order", "salary_rank_usd"))!;
    expect(calls(sal, "textSearch"), "a title match").toBe(true);
    expect(calls(sal, "eq", "country", "US")).toBe(true);
    expect(titleIlike(), "the recency ILIKE never served the pay order").toEqual([]);
  });

  it("q=dominos sort=salary: the employer's own jobs by pay, not titles carrying the brand", async () => {
    board.answer((q) => (q.table === "job_board_postings" && calls(q, "in", "company_token")
      ? { data: [row("smartrecruiters:dominos:1", "General Manager In Training", { salary_rank_usd: 85000 })], error: null } : undefined));
    const r = await board.post({ action: "list", q: "dominos", sort: "salary", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("SALARY");
    expect(r.companyMatched).toBe("Domino's");
    const sal = postings().find((q) => calls(q, "order", "salary_rank_usd"))!;
    expect(sal.calls.find(([m, a]) => m === "in" && a[0] === "company_token")![1][1]).toEqual(["dominos"]);
    expect(calls(sal, "textSearch"), "the brand is not title text").toBe(false);
    expect((r.jobs as unknown[]).length).toBe(1);
  });

  it("nothing pay-ordered to serve is said out loud, never answered by the substring path", async () => {
    const r = await board.post({ action: "list", q: "chilis", country: "US", sort: "salary", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("SALARY");
    expect(r.jobs).toEqual([]);
    expect(r.sortUnavailable).toBe("no-stated-pay");
    expect(titleIlike()).toEqual([]);
  });

  it("countOnly under the pay order mirrors the list (no total), never the substring count", async () => {
    board.answer((q) => (q.rpc === "count_jobs_capped" ? { data: [{ n: 9999, capped: false }], error: null } : undefined));
    const r = await board.post({ action: "list", q: "rn", country: "US", sort: "salary", countOnly: true });
    expect(r.total).toBeNull();
    expect(r.countUnavailable).toBe(true);
    expect(board.db.rpcArgs("count_jobs_capped"), "the substring count was not asked").toEqual([]);
    expect(titleIlike()).toEqual([]);
  });
});
