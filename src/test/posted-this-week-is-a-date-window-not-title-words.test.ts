// @vitest-environment node
/**
 * "POSTED THIS WEEK" IS A DATE WINDOW, NOT TITLE WORDS (connect W1, BR-05).
 *
 * Live 2026-11-07: search_jobs {query:"marketing jobs posted this week"}
 * kept "posted this week" as words to match: total 0, relatedTotal 3,000
 * (capped) and eight rows. Date words at the end of a query, or
 * after "posted", "listed", "added", "published" or "opened", now become
 * maxAgeDays and the answer says what was read. A title that holds the same
 * words ("Producer, TODAY Show", "Weekly Pay Driver", "Recent Graduate
 * Engineer") stays as typed, and a window the caller sent is never replaced.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("the reader turns date words into a window", () => {
  it.each([
    ["marketing jobs posted this week", "marketing", 7],
    ["nurse jobs posted in the last 3 days", "nurse", 3],
    ["nurse jobs posted today", "nurse", 1],
    ["software engineer jobs this week", "software engineer", 7],
    ["recently posted data analyst jobs", "data analyst", 7],
    ["new grad jobs posted this month", "new grad", 30],
  ])("%s searches %s within %i days", (q, rest, days) => {
    expect(readQuery(q)).toMatchObject({ query: rest, maxAgeDays: days });
  });

  it.each(["Producer, TODAY Show", "Last Week Tonight producer", "Weekly Pay Driver", "Monthly Reporting Analyst", "recent graduate software engineer"])(
    "%s is a title and stays whole",
    (q) => expect(readQuery(q)).toEqual({ query: q }),
  );

  it("a window the caller already sent is kept and the words stay", () => {
    expect(readQuery("marketing jobs posted this week", { maxAgeDays: true })).toEqual({ query: "marketing jobs posted this week" });
  });
});

describe("the server sends the window and says so", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);
  beforeEach(() => { mcp.boardCalls.length = 0; });
  const list = () => mcp.boardCalls.find((b) => b.action === "list")!;

  it("'marketing jobs posted this week' reaches the board as marketing within 7 days", async () => {
    const out = JSON.parse((await mcp.call({ query: "marketing jobs posted this week" })).text);
    expect(list()).toMatchObject({ q: "marketing", maxAgeDays: 7 });
    expect(out.locationInterpreted).toMatchObject({ query: "marketing", maxAgeDays: 7, from: "posted this week" });
  });

  it("a caller's own maxAgeDays is sent as it is", async () => {
    await mcp.call({ query: "marketing jobs posted this week", maxAgeDays: 14 });
    expect(list().maxAgeDays).toBe(14);
  });
});
