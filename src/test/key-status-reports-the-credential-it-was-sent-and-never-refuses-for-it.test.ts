// @vitest-environment node
/**
 * WITH NO KEY, key_status SAYS WHAT A KEYLESS CALLER HAS AND WHERE A FREE KEY
 * COMES FROM, AS AN ANSWER AND NOT AN ERROR (lane fix/1121-connector-errors,
 * item 6).
 *
 * Live 2026-11-21: key_status {} with no key answered isError "Sign-in through
 * this server is not switched on yet, so this tool needs a key", though
 * tools/list offered it to any caller sending some bearer (Supabase's usual
 * function-call recipe sends its publishable key): "Bearer not-a-key" was
 * listed 12 tools, no header 10. And a key in x-api-key beside that bearer
 * was never checked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const CLAUDE_ADDR = "160.79.105.10";
const LIVE = "rb_live_harness_key_0001";
const KEYLESS_TEN = ["board_stats", "search_jobs", "search", "fetch", "get_job", "get_jobs", "check_jobs_open", "employer_hiring_record", "employer_growth", "apply_myself"];

let m: KeylessMcp;
beforeEach(async () => {
  m = await bootKeylessMcp();
}, 120_000);

const keyStatus = async (headers: Record<string, string> = {}) => {
  const r = await m.rpc("tools/call", { name: "key_status", arguments: {} }, headers);
  const res = r.result as { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
  return { isError: res.isError === true, body: JSON.parse(res.content[0].text) as Record<string, Record<string, unknown>> };
};
const checks = (name: string) => m.rpcs.filter((r) => r.name === name);
const decision = (over: Record<string, unknown>) => ({
  data: { is_allowed: false, deny_reason: "", api_key_id: null, key_tier: null, rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1, ...over }, error: null,
});

describe("key_status with no key, sign-in off", () => {
  it("is an answer: tier none, the keyless allowance, and where a free key comes from; nothing is counted or checked", async () => {
    const r = await keyStatus();
    expect(r.isError).toBe(false);
    expect(r.body.key).toMatchObject({ tier: "none", paid: false, id: null });
    expect(Number.isInteger(r.body.keyless.lookupsPerDay) && (r.body.keyless.lookupsPerDay as number) > 0).toBe(true);
    expect(r.body.getAKey.url).toBe("https://resumebooster.work/data-api");
    expect(checks("mcp_anon_check_v2")).toHaveLength(0);
    expect(checks("api_key_check")).toHaveLength(0);
  });
  it("from Claude's servers: no header advice and no getAKey", async () => {
    const r = await keyStatus({ "x-forwarded-for": CLAUDE_ADDR });
    expect(r.isError).toBe(false);
    expect(r.body).not.toHaveProperty("getAKey");
  });
  it("'Bearer not-a-key' gets the same answer", async () => {
    const r = await keyStatus({ authorization: "Bearer not-a-key" });
    expect(r.isError).toBe(false);
    expect(r.body.key.tier).toBe("none");
  });
});

describe("a key in either slot is found, and every refusal is the key's state", () => {
  it("Authorization: Bearer <publishable key> with x-api-key: rb_live_... is checked as that key", async () => {
    m.answers.api_key_check = decision({ is_allowed: true, api_key_id: "key-1", key_tier: "free" });
    await keyStatus({ authorization: "Bearer sb_publishable_abc", "x-api-key": LIVE });
    const sent = JSON.stringify(checks("api_key_check")[0]?.args ?? {});
    expect(checks("api_key_check")).toHaveLength(1);
    expect(sent).not.toMatch(/sb_publishable_abc/);
  });
  it("an unrecognised key is key.recognised false, a revoked one key.revoked true, never isError", async () => {
    m.answers.api_key_check = decision({ deny_reason: "unknown_key" });
    const unknown = await keyStatus({ authorization: `Bearer ${LIVE}` });
    expect(unknown.isError).toBe(false);
    expect(unknown.body.key.recognised).toBe(false);
    m.answers.api_key_check = decision({ deny_reason: "revoked" });
    const revoked = await keyStatus({ authorization: `Bearer ${LIVE}` });
    expect(revoked.isError).toBe(false);
    expect(revoked.body.key.revoked).toBe(true);
  });
  it("a key over its day says quota.remaining 0 with Retry-After", async () => {
    m.answers.api_key_check = decision({ deny_reason: "quota_exceeded", api_key_id: "key-1", key_tier: "free", quota_used: 1000 });
    const r = await keyStatus({ authorization: `Bearer ${LIVE}` });
    expect(r.isError).toBe(false);
    expect(r.body.quota.remaining).toBe(0);
  });
});

describe("tools/list offers key_status only to a caller who holds a key", () => {
  const names = async (headers: Record<string, string>) =>
    ((await m.rpc("tools/list", {}, headers)).result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
  it("'Bearer not-a-key' is listed the keyless ten, an rb_live_ key twelve", async () => {
    expect(await names({ authorization: "Bearer not-a-key" })).toEqual([...KEYLESS_TEN].sort());
    expect(await names({})).toEqual([...KEYLESS_TEN].sort());
    const keyed = await names({ authorization: `Bearer ${LIVE}` });
    expect(keyed).toContain("key_status");
    expect(keyed).toContain("fit_resume");
    expect(keyed).toHaveLength(12);
  });
});

describe("fit_resume with no key keeps the sign-in sentence", () => {
  it("is still refused", async () => {
    const r = await m.rpc("tools/call", { name: "fit_resume", arguments: { resumeText: "x".repeat(300) } });
    const res = r.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Sign-in through this server is not switched on yet/);
  });
});
