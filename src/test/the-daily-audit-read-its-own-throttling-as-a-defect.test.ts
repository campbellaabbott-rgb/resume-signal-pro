// @vitest-environment node
/**
 * THE DAILY AUDIT READ ITS OWN THROTTLING AS A BOARD DEFECT (L1-07, old 2.27).
 *
 * Every daily filter audit recorded three "paging ... request-failed: offset 0:
 * RateLimitError: Rate limit exceeded for trace ..." findings with
 * throttledCases 0 and clean:false. The runtime refuses a self-call by
 * THROWING RateLimitError; the probe called a throttle only an HTTP 429, and
 * the three paging walks ran together, a burst of self-calls. So the check that
 * backs "audits its own accuracy daily" was a permanent false red.
 *
 * Now a thrown RateLimitError (and a 429/503/546) is a refusal, retried once
 * after a pause and then recorded as "throttled"; the walks run one at a time,
 * paced; an ignore-case probe that was refused is not a "silent-drop"; and a
 * run whose every finding is a refusal says incomplete:true. Run through the
 * shipped handler with its self-calls answered here.
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

async function audit(answer: (payload: Record<string, unknown>) => Promise<Response>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init?: { body?: unknown }) => answer(JSON.parse(String(init?.body ?? "{}")))) as typeof fetch;
  try {
    return await board.post({ action: "filter-audit", chainKey }) as { findings: Array<{ case: string; kind: string }>; throttledCases: number; incomplete: boolean; clean: boolean };
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("the filter audit", () => {
  it("records a thrown RateLimitError as throttled, and walks the pages one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const r = await audit(async (p) => {
      if (typeof p.offset === "number") {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((res) => setTimeout(res, 20));
        inFlight--;
        throw rateLimitError();
      }
      return new Response(JSON.stringify({ jobs: [], total: 0 }), { status: 200 });
    });
    const paging = r.findings.filter((f) => f.case.startsWith("paging"));
    expect(paging.map((f) => f.kind)).toEqual(["throttled", "throttled", "throttled"]);
    expect(maxInFlight, "the three walks never overlap").toBe(1);
    expect(r.throttledCases).toBeGreaterThanOrEqual(3);
    expect(r.incomplete, "other findings were measured, so the run is not merely incomplete").toBe(false);
  });

  it("a run the runtime refused throughout says incomplete, not broken", async () => {
    const r = await audit(async () => { throw rateLimitError(); });
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.kind === "throttled"), JSON.stringify(r.findings.filter((f) => f.kind !== "throttled").slice(0, 3))).toBe(true);
    expect(r.incomplete).toBe(true);
    expect(r.clean).toBe(false);
  });
});
