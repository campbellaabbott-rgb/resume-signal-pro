// @vitest-environment node
/**
 * A KEY REFUSED FOR ITS MINUTE IS NOT TOLD ITS DAY (S14X-275, the connector's half).
 *
 * api_key_check answers quota_used 0 on a rate_limited or a revoked refusal:
 * it never read the day's count. The server turned that into
 * X-Quota-Remaining = the whole quota, so a key at 990 of 1,000 bursting past
 * sixty a minute was told 1,000 calls remained. Now the quota pair rides only
 * a call the check allowed and the quota refusal itself (or a row that says
 * it read the day); the rate pair and Retry-After are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let mcp: KeylessMcp;
let handler: EdgeHandler;
beforeEach(async () => {
  mcp = await bootKeylessMcp();
  handler = (globalThis as Record<string, unknown>).__edgeHandler as EdgeHandler;
});
const decision = (o: Record<string, unknown>) => ({
  data: { is_allowed: false, deny_reason: "rate_limited", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 61, quota_limit: 1000, quota_used: 0, ...o },
  error: null,
});
const call = () => handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer rb_live_harness_key", "x-forwarded-for": "203.0.113.7" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "key_status", arguments: {} } }),
}));

describe("a refusal names only the limits the check read", () => {
  it("rate_limited: the rate pair and Retry-After, no quota pair", async () => {
    mcp.answers.api_key_check = decision({});
    const res = await call();
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("X-Quota-Remaining")).toBeNull();
    expect(res.headers.get("X-Quota-Limit")).toBeNull();
  });

  it("revoked: no quota pair", async () => {
    mcp.answers.api_key_check = decision({ deny_reason: "revoked", rate_used: 0 });
    const res = await call();
    expect(res.headers.get("X-Quota-Remaining")).toBeNull();
  });

  it("quota_exceeded: the quota pair it read", async () => {
    mcp.answers.api_key_check = decision({ deny_reason: "quota_exceeded", rate_used: 3, quota_used: 1001 });
    const res = await call();
    expect(res.headers.get("X-Quota-Remaining")).toBe("0");
    expect(res.headers.get("X-Quota-Limit")).toBe("1000");
  });

  it("a row that says it read the day is believed", async () => {
    mcp.answers.api_key_check = decision({ quota_used: 990, quota_read: true });
    const res = await call();
    expect(res.headers.get("X-Quota-Remaining")).toBe("10");
  });

  it("an allowed call still carries both pairs", async () => {
    mcp.answers.api_key_check = decision({ is_allowed: true, deny_reason: "", rate_used: 2, quota_used: 12 });
    const res = await call();
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("58");
    expect(res.headers.get("X-Quota-Remaining")).toBe("988");
  });
});
