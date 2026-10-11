// @vitest-environment node
/**
 * THE DESCRIPTION TIER HAD NO CLOCK (S11-009).
 *
 * search_jobs reads search_tsv when the filtered title count is under 200,
 * and nothing bounds how many rows that tier examines. Live on .91,
 * 2026-10-11: {q:"manager", country:"GB", payBasis:"hourly"} 57014 after
 * 8.12 s, served unranked at 10.4 s; experience/CA/salaried 8.12 s;
 * manager/CA/hourly 8.13 s. job-board awaited the RPC bare while its
 * neighbours ran under withDeadline.
 *
 * Now the full call races RANKED_FULL_DEADLINE_MS; on a miss the title tier
 * alone (p_title_only, migration 20261009101000) answers, ranked, with
 * relatedUnavailable. Run through the shipped handler with a search_jobs
 * that takes nine seconds unless asked for the title tier.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, row, type BoardList } from "./helpers/board-list";
import type { Answer, Query } from "./helpers/proxy-db";
import { RANKED_FULL_DEADLINE_MS, rankedWithDeadline } from "../../supabase/functions/job-board/ranked-deadline";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

describe("rankedWithDeadline", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const never = () => new Promise<never>(() => {});

  it("answers with the full call when it beats the clock, and asks nothing else", async () => {
    const asked: boolean[] = [];
    const p = rankedWithDeadline((t) => { asked.push(t); return Promise.resolve({ data: [1], error: null }); }, () => 30_000);
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toEqual({ data: [1], error: null, cut: false, timedOut: false });
    expect(asked).toEqual([false]);
  });

  it("asks for the title tier once the full call misses, and says the description tier was cut", async () => {
    const asked: boolean[] = [];
    const p = rankedWithDeadline((t) => { asked.push(t); return t ? Promise.resolve({ data: [2], error: null }) : never(); }, () => 30_000);
    await vi.advanceTimersByTimeAsync(RANKED_FULL_DEADLINE_MS - 1);
    expect(asked).toEqual([false]);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toEqual({ data: [2], error: null, cut: true, timedOut: false });
    expect(asked).toEqual([false, true]);
  });

  it("an error inside the clock is the answer, not a reason to retry", async () => {
    const asked: boolean[] = [];
    const err = { code: "PGRST202", message: "no function" };
    const p = rankedWithDeadline((t) => { asked.push(t); return Promise.resolve({ data: null, error: err }); }, () => 30_000);
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toEqual({ data: null, error: err, cut: false, timedOut: false });
    expect(asked).toEqual([false]);
  });

  it("both clocks missing is a timeout, and no clock outlasts the request's budget", async () => {
    const p = rankedWithDeadline(() => never(), () => 500);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await p).toEqual({ data: null, error: null, cut: true, timedOut: true });
  });
});

describe("the board under a slow description tier", () => {
  let board: BoardList;
  let release: Array<() => void> = [];
  beforeAll(async () => { board = await bootBoardList(); });
  beforeEach(() => board.reset());
  afterEach(() => { for (const r of release) r(); release = []; });

  const TITLE_ROWS = [
    { ...row("greenhouse:a:1", "Shift Manager", { country: "GB", salary_period: "hour" }), total_rows: 2, related_rows: null, title_match: true, snippet: null },
    { ...row("greenhouse:a:2", "Assistant Manager", { country: "GB", salary_period: "hour" }), total_rows: 2, related_rows: null, title_match: true, snippet: null },
  ];
  /** search_jobs: the title tier answers at once; the full call times out at nine seconds. */
  const slowFull = (q: Query): Answer | Promise<Answer> | undefined => {
    if (q.rpc !== "search_jobs") return undefined;
    const args = q.calls[0][1][0] as Record<string, unknown>;
    if (args.p_title_only === true) return { data: TITLE_ROWS, error: null };
    return new Promise<Answer>((resolve) => {
      const t = setTimeout(() => resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }), 9_000);
      release.push(() => { clearTimeout(t); resolve({ data: null, error: { code: "57014", message: "released" } }); });
    });
  };

  it("a list answers ranked from the title tier inside the clock, and says the related segment was not read", async () => {
    board.answer(slowFull);
    const t0 = Date.now();
    const r = await board.post({ action: "list", q: "manager", country: "GB", payBasis: "hourly", limit: 60, groupSimilar: false });
    const ms = Date.now() - t0;
    expect(r.rankedFellBack, "the defect: 57014 and the unranked fallback").toBeUndefined();
    expect(r.ranked).toBe(true);
    expect(r.total).toBe(2);
    expect(r.relatedUnavailable).toBe(true);
    expect(r.relatedTotal).toBeUndefined();
    expect(((r.jobs ?? []) as Array<{ title: string }>).map((j) => j.title).sort()).toEqual(["Assistant Manager", "Shift Manager"]);
    const sj = board.db.rpcArgs("search_jobs");
    expect(sj.map((a) => a.p_title_only ?? null)).toEqual([null, true]);
    expect(sj[1].p_country).toBe("GB");
    expect(ms, "the clock, not the statement timeout, decided").toBeLessThan(RANKED_FULL_DEADLINE_MS + 2_500);
  });

  it("a count answers the title count inside the clock", async () => {
    board.answer(slowFull);
    const r = await board.post({ action: "list", q: "manager", country: "GB", payBasis: "hourly", countOnly: true });
    expect(r.total).toBe(2);
    expect(r.relatedUnavailable).toBe(true);
    expect(board.db.rpcArgs("search_jobs").map((a) => a.p_title_only ?? null)).toEqual([null, true]);
  });

  it("a full call inside the clock is served as before, one call", async () => {
    board.answer((q) => (q.rpc === "search_jobs"
      ? { data: TITLE_ROWS.map((x) => ({ ...x, related_rows: 40 })), error: null } : undefined));
    const r = await board.post({ action: "list", q: "manager", country: "GB", payBasis: "hourly", limit: 60, groupSimilar: false });
    expect(r.ranked).toBe(true);
    expect(r.relatedTotal).toBe(40);
    expect(r.relatedUnavailable).toBeUndefined();
    expect(board.db.rpcArgs("search_jobs")).toHaveLength(1);
  });
});
