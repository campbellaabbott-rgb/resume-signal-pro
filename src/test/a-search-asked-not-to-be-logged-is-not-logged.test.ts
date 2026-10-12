// @vitest-environment node
/**
 * A SEARCH OUR SERVERS ASK NOT TO LOG IS NOT LOGGED (wave 4, job-board .93).
 *
 * OpenAI's plugin rules forbid collecting "query patterns", and the owner
 * decided on 2026-10-11 that ChatGPT-surface searches are not stored. The
 * board logs every list call (job_board_search_events, and a zero-result one
 * into job_board_search_misses), so agent-mcp sends noLog:true for that
 * surface. The board honours it only alongside the reader proof our servers
 * hold: a browser that sends the flag is logged like any other visitor. And
 * an AI's search that is logged (the Claude surface) keeps its query, never
 * the ids it was shown.
 *
 * Run through the shipped handler, with the database faked.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ANON, bootBoardHandler, type BoardHandler } from "./helpers/board-handler";
import type { Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardHandler;
beforeAll(async () => { board = await bootBoardHandler(); });

const inserted = (table: string) => board.db.on(table, "insert")
  .map((q: Query) => (q.calls.find(([m]) => m === "insert")?.[1][0] ?? {}) as Record<string, unknown>);

const browser = { authorization: `Bearer ${ANON}`, apikey: ANON, origin: "https://resumebooster.work" };

describe("the no-log flag", () => {
  it("with the reader proof, a search writes no search event and no miss", async () => {
    board.reset();
    const r = await board.post({ action: "list", q: "underwater basket weaver", noLog: true, caller: "mcp" }, await board.readerHeaders());
    expect(Array.isArray(r.jobs), JSON.stringify(r).slice(0, 200)).toBe(true);
    expect(inserted("job_board_search_events"), "the search was logged").toEqual([]);
    expect(inserted("job_board_search_misses"), "the zero-result search was logged as a miss").toEqual([]);
  });

  it("without the proof the flag is ignored: a browser cannot take itself out of the log", async () => {
    board.reset();
    await board.post({ action: "list", q: "underwater basket weaver", noLog: true }, browser);
    const events = inserted("job_board_search_events");
    expect(events.length, "a browser's search went unlogged because it asked").toBe(1);
    expect(events[0].q).toBe("underwater basket weaver");
    expect(inserted("job_board_search_misses").length, "its zero-result miss is kept too").toBeGreaterThan(0);
  });

  it("the proof alone changes nothing: our servers' searches are logged unless they ask", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse", caller: "api" }, await board.readerHeaders());
    expect(inserted("job_board_search_events").length).toBe(1);
  });
});

describe("an AI's logged search keeps its query, not what it was shown", () => {
  it("caller mcp: q is written and shown is not", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse", caller: "mcp" }, await board.readerHeaders());
    const [e] = inserted("job_board_search_events");
    expect(e?.q).toBe("nurse");
    expect(e?.caller).toBe("mcp");
    expect("shown" in (e ?? {}), "an MCP search event carries the ids it showed").toBe(false);
  });

  it("the site's own search still records the shown set", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse" }, browser);
    const [e] = inserted("job_board_search_events");
    expect(e?.caller).toBe("web");
    expect(Array.isArray(e?.shown), "the site's denominator is gone").toBe(true);
  });
});
