// @vitest-environment node
/**
 * A REFUSAL NAMES ONLY THE LIMITS IT READ (S14X-275, C-S14-122).
 *
 * api_key_check reads the day bucket only when it decides "quota_exceeded".
 * On a per-minute refusal and on a revoked key it returns quota_used 0, and
 * the refusal turned that into X-Quota-Remaining equal to the whole quota:
 * measured live 2026-11-15, a revoked key was answered 403 with
 * x-quota-remaining 1000. A refusal now carries the per-minute pair always and
 * the daily pair only when the daily bucket is why the call was refused.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { refusalHeaders } from "../../supabase/functions/public-api/refusal-headers";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let handler: EdgeHandler;
beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 500 })));
}, 120_000);

function denied(decision: Record<string, unknown> | null) {
  const db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: decision, error: null });
  useDb(db);
  return callApi(handler, "/v1/jobs");
}

describe("the refusal headers, by value", () => {
  it("a per-minute refusal and a revoked key state the per-minute pair only", () => {
    for (const deny_reason of ["rate_limited", "revoked"]) {
      const h = refusalHeaders({ deny_reason, rate_limit: 60, rate_used: 61, quota_limit: 1000, quota_used: 0 });
      expect(h).toEqual({ "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "0" });
    }
  });

  it("a daily refusal states the daily pair it read", () => {
    expect(refusalHeaders({ deny_reason: "quota_exceeded", rate_limit: 60, rate_used: 3, quota_limit: 1000, quota_used: 1001 }))
      .toEqual({ "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "57", "X-Quota-Limit": "1000", "X-Quota-Remaining": "0" });
  });

  it("no decision states nothing", () => {
    expect(refusalHeaders(null)).toEqual({});
  });
});

describe("the shipped handler's refusals", () => {
  it("a per-minute refusal is a 429 with Retry-After 60 and no daily figure", async () => {
    const r = await denied({ ...ALLOWED, is_allowed: false, deny_reason: "rate_limited", rate_used: 61, quota_used: 0 });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(r.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(r.headers.get("x-quota-remaining"), "the day bucket was never read").toBeNull();
    expect(r.headers.get("x-quota-limit")).toBeNull();
  });

  it("a revoked key is a 403 with no daily figure", async () => {
    const r = await denied({ ...ALLOWED, is_allowed: false, deny_reason: "revoked", rate_used: 0, quota_used: 0 });
    expect(r.status).toBe(403);
    expect((r.body.error as { code: string }).code).toBe("key_revoked");
    expect(r.headers.get("x-quota-remaining"), "a revoked key has no calls left to state").toBeNull();
  });

  it("a daily refusal is a 429 that says the quota is spent", async () => {
    const r = await denied({ ...ALLOWED, is_allowed: false, deny_reason: "quota_exceeded", rate_used: 2, quota_used: 1001 });
    expect(r.status).toBe(429);
    expect(r.headers.get("x-quota-remaining")).toBe("0");
    expect(r.headers.get("x-quota-limit")).toBe("1000");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("an unknown key is a 401 with no limits at all", async () => {
    const r = await denied(null);
    expect(r.status).toBe(401);
    expect(r.headers.get("x-ratelimit-remaining")).toBeNull();
    expect(r.headers.get("x-quota-remaining")).toBeNull();
  });
});
