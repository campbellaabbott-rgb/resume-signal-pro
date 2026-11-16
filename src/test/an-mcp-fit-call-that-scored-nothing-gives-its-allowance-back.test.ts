// @vitest-environment node
/**
 * AN MCP FIT CALL THAT SCORED NOTHING GIVES ITS ALLOWANCE BACK (S14X-132, the connector's door).
 *
 * fit_resume is metered by api_key_check before the tool runs, and the free
 * allowance (api_key_fit_allowance) counts those calls: 25 a day. A call that
 * read no occupation, whose employer scope the board could not apply, that
 * found no rows, or that the scorer refused or failed scored nothing, and
 * still spent one of the 25. Now each of those outcomes, and a refusal by the
 * free gate, records api_key_fit_unscored under '/mcp/fit_resume' (the
 * public-api lane's definer, the same rule as POST /v1/fit), so the allowance
 * counts scorings. A database without that function answers an error, which
 * is logged and swallowed: the answer is unchanged and the call stays counted
 * as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const CV = "Registered nurse with eight years on acute medical wards, IV therapy, patient assessment and discharge planning. ".repeat(3);
const NO_OCCUPATION = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(2);
const KEY = { authorization: "Bearer rb_live_harness_key" };
const allowed = (tier: string) => ({ data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: tier, rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null });
const JOB = { id: "greenhouse:acme:1", title: "Registered Nurse", company: "Acme", companyToken: "acme", source: "greenhouse", location: "Leeds" };

let mcp: KeylessMcp;
let scorer: () => Response;
beforeEach(async () => {
  mcp = await bootKeylessMcp();
  mcp.answers.api_key_check = allowed("builder");
  mcp.board = () => new Response(JSON.stringify({ jobs: [JOB], total: 1, hasMore: false }), { status: 200 });
  scorer = () => new Response(JSON.stringify({ fits: { [JOB.id]: 71 }, matched: {}, missing: {} }), { status: 200 });
  const inner = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) =>
    String(url).endsWith("/functions/v1/job-fit") ? scorer() : inner(url, init)) as typeof fetch;
});

const fit = async (args: Record<string, unknown>) => {
  const body = await mcp.rpc("tools/call", { name: "fit_resume", arguments: args }, KEY);
  return body.result as { isError?: boolean; content?: Array<{ text: string }> } | undefined;
};
const givenBack = () => mcp.rpcs.filter((r) => r.name === "api_key_fit_unscored");
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a call that scored nothing records api_key_fit_unscored under the MCP endpoint", () => {
  it("no occupation read from the CV", async () => {
    await fit({ resumeText: NO_OCCUPATION });
    await settle();
    expect(givenBack().map((r) => r.args)).toEqual([{ p_key_id: "key-1", p_endpoint: "/mcp/fit_resume" }]);
  });

  it("an employer scope the board could not apply", async () => {
    mcp.board = () => new Response(JSON.stringify({ jobs: [JOB], total: 1, ignoredFilters: ["companies"] }), { status: 200 });
    await fit({ resumeText: CV, companies: ["nosuchemployer"] });
    await settle();
    expect(givenBack()).toHaveLength(1);
  });

  it("a search that found no rows", async () => {
    mcp.board = () => new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 });
    await fit({ resumeText: CV });
    await settle();
    expect(givenBack()).toHaveLength(1);
  });

  it("the scorer's own daily limit", async () => {
    scorer = () => new Response(JSON.stringify({ error: "limit", limit: 120 }), { status: 429 });
    await fit({ resumeText: CV });
    await settle();
    expect(givenBack()).toHaveLength(1);
  });

  it("the scorer failing", async () => {
    scorer = () => new Response(JSON.stringify({ error: "upstream" }), { status: 502 });
    const out = await fit({ resumeText: CV });
    await settle();
    expect(out?.isError).toBe(true);
    expect(givenBack()).toHaveLength(1);
  });

  it("the free gate refusing the call", async () => {
    mcp.answers.api_key_check = allowed("free");
    mcp.answers.api_key_fit_allowance = { data: [{ confirmed: false, proven: false, used_today: 1 }], error: null };
    const out = await fit({ resumeText: CV });
    await settle();
    expect(out?.isError).toBe(true);
    expect(givenBack()).toHaveLength(1);
  });
});

describe("a call that scored keeps its count, and a database without the function changes nothing", () => {
  it("a scored answer records nothing", async () => {
    const out = await fit({ resumeText: CV });
    await settle();
    expect(out?.content?.[0]?.text).toMatch(/"fit":71/);
    expect(givenBack()).toHaveLength(0);
  });

  it("an absent function answers an error, and the answer is the same", async () => {
    mcp.answers.api_key_fit_unscored = { data: null, error: { message: "Could not find the function public.api_key_fit_unscored(p_endpoint, p_key_id) in the schema cache" } };
    mcp.board = () => new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 });
    const out = await fit({ resumeText: CV });
    await settle();
    expect(out?.isError).not.toBe(true);
    expect(out?.content?.[0]?.text).toMatch(/"jobs":\[\]/);
    expect(out?.content?.[0]?.text).not.toMatch(/schema cache/);
    expect(givenBack()).toHaveLength(1);
  });
});
