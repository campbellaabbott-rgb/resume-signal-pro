// @vitest-environment node
/**
 * OUR OWN PROBE IS NOT A VISITOR'S SEARCH (job-board .103, push-all plan).
 *
 * Lovable's 14-day read of job_board_search_events (2026-11-17) found our
 * verify runs among the visitors: a run searches "nurse" about 21 times and
 * "software engineer" several more, and every one of those rows carried
 * caller NULL, beside real direct-API callers. Our verify sections and
 * diagnostic scripts all send x-rb-budget: probe (scripts/verify-deploy.sh),
 * so a request carrying that header and no declared caller is labelled
 * 'maintenance'. A declared caller still wins, and a browser search without
 * the header is still 'web'.
 *
 * Run through the shipped handler, with the database faked.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ANON, bootBoardHandler, type BoardHandler } from "./helpers/board-handler";
import type { Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardHandler;
beforeAll(async () => { board = await bootBoardHandler(); });

const events = () => board.db.on("job_board_search_events", "insert")
  .map((q: Query) => (q.calls.find(([m]) => m === "insert")?.[1][0] ?? {}) as Record<string, unknown>);

const anon = { authorization: `Bearer ${ANON}`, apikey: ANON };

describe("a probe's search is logged as maintenance", () => {
  it("x-rb-budget: probe with no declared caller is caller 'maintenance', not NULL", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse" }, { ...anon, "x-rb-budget": "probe" });
    const [e] = events();
    expect(e, "the probe's search was not logged at all").toBeTruthy();
    expect(e.caller, "our verify run's search was counted as a visitor's (caller NULL)").toBe("maintenance");
  });

  it("the header's value is read the way the budget reads it: case and spaces do not matter", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse" }, { ...anon, "x-rb-budget": " Probe " });
    expect(events()[0]?.caller).toBe("maintenance");
  });

  it("a declared caller still wins over the probe header", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse" }, { ...anon, "x-rb-budget": "probe", "x-rb-caller": "api" });
    expect(events()[0]?.caller).toBe("api");
  });

  it("no probe header: an anonymous caller with no origin stays unlabelled, and a browser stays 'web'", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse" }, anon);
    expect("caller" in (events()[0] ?? {}), "a bare anonymous search was given a caller it never declared").toBe(false);
    board.reset();
    await board.post({ action: "list", q: "nurse" }, { ...anon, origin: "https://resumebooster.work" });
    expect(events()[0]?.caller).toBe("web");
  });

  it("the build tool's own budget label is not a probe", async () => {
    board.reset();
    await board.post({ action: "list", q: "nurse" }, { ...anon, "x-rb-budget": "build" });
    expect("caller" in (events()[0] ?? {})).toBe(false);
  });
});
