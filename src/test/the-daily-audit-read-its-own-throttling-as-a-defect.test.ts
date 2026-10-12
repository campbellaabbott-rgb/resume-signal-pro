// @vitest-environment node
/**
 * THE DAILY AUDIT READ ITS OWN THROTTLING AS A BOARD DEFECT (L1-07, old 2.27),
 * AND THEN COULD NOT FINISH (wave 4, job-board .93).
 *
 * Every daily filter audit recorded three "paging ... offset 0: RateLimitError:
 * Rate limit exceeded for trace ..." findings. .91 learned to call that
 * "throttled" and the run "incomplete" instead of broken, which made the
 * report honest and left the audit unfinished: on 2026-10-12 it still ran
 * incomplete with RateLimitError on the same three paging walks. The limiter
 * is the runtime's, on self-calls within one trace, and no pacing on our side
 * removes it.
 *
 * .93 asks the list action in-process: each probe is a Request handed to this
 * bundle's own handler, the code a network self-call would have reached, with
 * no network and so no per-trace limit. Run through the shipped handler, with
 * every network call refused the way the runtime refused them.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { bootBoardList, SVC, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const chainKey = createHash("sha256").update(`${SVC}:board-chain`).digest("hex").slice(0, 32);
let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });

function rateLimitError(): Error {
  const e = new Error("Rate limit exceeded for trace 0123");
  e.name = "RateLimitError";
  return e;
}

type AuditAnswer = { findings: Array<{ case: string; kind: string }>; throttledCases: number; incomplete: boolean; clean: boolean };

/** One audit with every network call refused as the runtime refused the self-calls; counts the list probes that tried the network. */
async function audit(): Promise<{ r: AuditAnswer; networkProbes: number }> {
  const realFetch = globalThis.fetch;
  let networkProbes = 0;
  globalThis.fetch = (async (_u: unknown, init?: { body?: unknown }) => {
    const p = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
    if (p.action === "list") networkProbes++;
    throw rateLimitError();
  }) as typeof fetch;
  try {
    board.reset();
    return { r: await board.post({ action: "filter-audit", chainKey }) as AuditAnswer, networkProbes };
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("the filter audit", () => {
  it("asks its own handler in-process, so the runtime's limit on self-calls cannot refuse a probe", async () => {
    const { r, networkProbes } = await audit();
    expect(networkProbes, "a probe went over the network, where the runtime caps self-calls per trace").toBe(0);
    const refused = r.findings.filter((f) => f.kind === "throttled" || f.kind === "request-failed");
    expect(refused, JSON.stringify(refused.slice(0, 3))).toEqual([]);
    expect(r.throttledCases).toBe(0);
    expect(r.incomplete, "the audit finished").toBe(false);
  });

  it("every probe is answered by the shipped list action, attributed to maintenance", async () => {
    await audit();
    const logged = board.db.on("job_board_search_events", "insert")
      .map((q) => (q.calls.find(([m]) => m === "insert")?.[1][0] ?? {}) as { caller?: string; offset_n?: number });
    expect(logged.length, "no probe reached the list action").toBeGreaterThan(20);
    expect(logged.every((e) => e.caller === "maintenance"), "a probe was logged as demand").toBe(true);
  });
});
