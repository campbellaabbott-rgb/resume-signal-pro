/**
 * THE BACKUP SCANNER IS SENT THE SIGNED-IN PERSON'S TOKEN, AND SAYS WHICH LIMIT FIRED (S12-144).
 *
 * use-streaming-scan always sent the publishable key, so the backup scanner
 * counted every caller as anonymous (a free account got the anonymous
 * allowance, a Pro member was refused), and every refusal event read "Daily
 * Scan Limit Reached", the shared hourly request budget and a busy analyser
 * included.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

let session: { access_token: string } | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session }, error: null }) } },
}));

import { streamErrorFor, useStreamingScan } from "@/hooks/use-streaming-scan";

const resume = "Jane Doe\nSoftware Engineer\nExperience\n" + "Built and shipped services used by thousands of customers every day. ".repeat(12);

afterEach(() => { vi.unstubAllGlobals(); session = null; });

async function authorizationSent(): Promise<string> {
  let auth = "";
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    auth = String((init.headers as Record<string, string>).Authorization);
    return new Response("event: error\ndata: {\"error\":\"stop\"}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  }));
  const { result } = renderHook(() => useStreamingScan());
  await act(async () => { await result.current.startStreamingScan(resume, { skipCache: true, maxRetries: 0 }); });
  return auth;
}

describe("the token sent", () => {
  it("is the signed-in person's access token", async () => {
    session = { access_token: "user-access-token" };
    expect(await authorizationSent()).toBe("Bearer user-access-token");
  });

  it("is the publishable key for a visitor", async () => {
    session = null;
    expect(await authorizationSent()).not.toBe("Bearer user-access-token");
  });
});

describe("a refusal says which limit fired", () => {
  it("the shared request budget is an hour's wait, retryable, not a spent day", () => {
    const e = streamErrorFor({ error: "Too many requests.", rateLimited: true, code: "rate_limited_budget", retryAfterSeconds: 3600 }, "Too many requests.");
    expect(e.title).not.toMatch(/Daily/);
    expect(e.isRetryable).toBe(true);
    expect(e.description).toMatch(/60 minutes/);
  });

  it("a busy analyser is retryable", () => {
    expect(streamErrorFor({ error: "Busy", code: "busy", retryable: true }, "Busy").isRetryable).toBe(true);
  });

  it("a spent day is still a spent day", () => {
    expect(streamErrorFor({ error: "x", rateLimited: true, code: "daily_scan_limit" }, "x").title).toBe("Daily Scan Limit Reached");
  });
});
