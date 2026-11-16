/**
 * THE BACKUP SCAN IS SENT WHAT THE VISITOR ASKED FOR, AND AN ANSWERED REQUEST
 * IS NEVER SENT AGAIN (S14X-118, S14X-144, S14X-043).
 *
 * - S14X-118: the primary scanner is sent the visitor's situation, target
 *   role and confirmed industry/level; the backup was sent none of it, so a
 *   visitor who said "Data Engineer" got a report aimed at nobody.
 * - S14X-144: the hook aborted its own fetch at the scan's window, but the
 *   fork was never told the window, so it could not refuse to start late.
 * - S14X-043: the hook retried the fork on 408, 429 and 5xx. The fork counts
 *   a scan before it replies, so each retry of an answered request spent
 *   another of the visitor's scans. Only a request that never got an answer
 *   is retried now.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
}));

import { useStreamingScan } from "@/hooks/use-streaming-scan";

const resume = "Jane Doe\nData Engineer\nExperience\n" + "Built pipelines that moved billions of rows a day for analysts and finance. ".repeat(12);

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(reply: () => Response | Promise<Response>) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return reply();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { bodies, fetchMock };
}

const stop = () => new Response("event: error\ndata: {\"error\":\"stop\"}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });

async function run(options: Parameters<ReturnType<typeof useStreamingScan>["startStreamingScan"]>[1]) {
  const { result } = renderHook(() => useStreamingScan());
  await act(async () => { await result.current.startStreamingScan(resume, { skipCache: true, ...options }); });
}

describe("the backup scanner's request", () => {
  it("carries the visitor's userContext", async () => {
    const { bodies } = stubFetch(stop);
    await run({ maxRetries: 0, userContext: { targetRole: "Data Engineer", situation: "career_change" } });
    expect(bodies).toHaveLength(1);
    expect((bodies[0].userContext as Record<string, string>).targetRole).toBe("Data Engineer");
    expect((bodies[0].userContext as Record<string, string>).situation).toBe("career_change");
  });

  it("carries deadlineAt equal to the option", async () => {
    const { bodies } = stubFetch(stop);
    const deadlineAt = Date.now() + 60_000;
    await run({ maxRetries: 0, deadlineAt });
    expect(bodies[0].deadlineAt).toBe(deadlineAt);
  });
});

describe("an answered request is never sent again", () => {
  for (const status of [408, 429, 500, 503]) {
    it(`a ${status} from the fork is not retried`, async () => {
      const { fetchMock } = stubFetch(() => new Response(JSON.stringify({ error: "x" }), { status }));
      await run({ maxRetries: 2, retryDelay: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  it("a request that never got an answer is retried", async () => {
    let n = 0;
    const { fetchMock } = stubFetch(() => {
      n += 1;
      if (n === 1) throw new TypeError("Failed to fetch");
      return stop();
    });
    await run({ maxRetries: 2, retryDelay: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
