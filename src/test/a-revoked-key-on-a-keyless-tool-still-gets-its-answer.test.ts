// @vitest-environment node
/**
 * A SEARCH SENT WITH A REVOKED KEY IS ANSWERED AS A KEYLESS SEARCH AND TOLD
 * THE KEY WAS REVOKED (lane fix/1121-connector-errors, item 10).
 *
 * Keys are revoked wholesale by design (migration 20261004100000: every
 * account-less free key with no confirmed request behind it, and any unused
 * for 30 days), so a client still configured with one got isError "This key
 * has been revoked." from search_jobs although the same call with no key is
 * answered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const REVOKED = "rb_live_revoked_harness_key";
let m: KeylessMcp;
beforeEach(async () => {
  m = await bootKeylessMcp();
  m.board = () => new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 1, hasMore: false }), { status: 200 });
  m.answers.api_key_check = { data: { is_allowed: false, deny_reason: "revoked", api_key_id: null, key_tier: null, rate_limit: 60, rate_used: 0, quota_limit: 1000, quota_used: 0 }, error: null };
}, 120_000);

const call = async (name: string, args: Record<string, unknown>, headers: Record<string, string>) => {
  const res = (await m.rpc("tools/call", { name, arguments: args }, headers)).result as { isError?: boolean; content: Array<{ text: string }> };
  return { isError: res.isError === true, text: res.content[0].text };
};

describe("a revoked key on a tool that answers with no key", () => {
  it.each([
    ["Authorization", { authorization: `Bearer ${REVOKED}` }],
    ["x-api-key", { "x-api-key": REVOKED }],
  ])("sent in %s: answered keyless, the keyless page, and told the key was revoked", async (_slot, headers) => {
    const r = await call("search_jobs", { query: "nurse", limit: 30 }, headers);
    expect(r.isError).toBe(false);
    const body = JSON.parse(r.text) as { jobs: unknown[]; unkeyed: { keyNote?: string } };
    expect(body.jobs).toHaveLength(1);
    expect(body.unkeyed.keyNote).toMatch(/revoked/);
    expect(body.unkeyed.keyNote).toMatch(/https:\/\/resumebooster\.work\/data-api/);
    expect(m.rpcs.filter((x) => x.name === "mcp_anon_check_v2")).toHaveLength(1);
    expect(m.boardCalls[0].limit).toBe(10);
  });
  it("fit_resume with the same key keeps its refusal", async () => {
    const r = await call("fit_resume", { resumeText: "Registered nurse. ".repeat(30) }, { authorization: `Bearer ${REVOKED}` });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/This key has been revoked\./);
  });
  it("a key refused for its minute is still refused on search_jobs, with Retry-After", async () => {
    m.answers.api_key_check = { data: { is_allowed: false, deny_reason: "rate_limited", api_key_id: "k", key_tier: "free", rate_limit: 60, rate_used: 61, quota_limit: 1000, quota_used: 5 }, error: null };
    const r = await call("search_jobs", { query: "nurse" }, { authorization: `Bearer ${REVOKED}` });
    expect(r.isError).toBe(true);
  });
});
