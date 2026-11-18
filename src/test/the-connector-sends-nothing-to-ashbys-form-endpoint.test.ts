// @vitest-environment node
/**
 * THE CONNECTOR SENDS NOTHING TO ASHBY'S FORM ENDPOINT (OD14-ASHBY-1).
 *
 * apply_myself read an Ashby posting's application form by POSTing to
 * jobs.ashbyhq.com/api/, a path Ashby's robots file disallows. The owner's
 * option "stop" (2026-11-16, OD14(b) / OD-M1): the connector reads no Ashby
 * form. An Ashby posting answers the way a posting on any system whose form
 * is not read here does: the apply link, the posting's own terms and its
 * lines on applying, with a note that the form is not read through this
 * connection; no card offers to read its form, and no listing, instruction
 * or /agents line names Ashby as a form reader. /v1 stops the same read
 * (OD14-ASHBY-2); job-board's own call stops in its own wave.
 *
 * Pinned on the shipped handler, keyless and keyed: the board is asked for
 * the posting, Ashby is asked nothing, and a Greenhouse posting's form is
 * still read, so the stop is Ashby's alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { MCP_FORM_VENDORS, MCP_TOOLS } from "../config/mcp-tools";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ALLOWED = {
  is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free",
  rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1,
};
const KEY = { authorization: "Bearer rb_live_harness_key" };
const ASHBY_ID = "ashby:acme:0b1c2d3e-0000-4000-8000-000000000001";
const GREENHOUSE_ID = "greenhouse:acme:101";
const detail = (id: string) => {
  const [source, token] = id.split(":");
  return { job: { id, source, token, title: "Registered Nurse", company: "Acme", location: "Austin, TX", applyUrl: `https://example.invalid/apply/${source}` }, description: "<p>Registered nurse. Apply with your licence number.</p>" };
};
const ASHBY_FORM = { data: { jobPosting: { id: "x", title: "Registered Nurse", applicationForm: { sections: [{ title: null, fieldEntries: [{ field: { path: "_systemfield_name", title: "Name", type: "String" }, isRequired: true }] }] } } } };
const GREENHOUSE_FORM = { questions: [{ label: "Why do you want to work here?", required: true, fields: [{ type: "textarea" }] }] };

let mcp: KeylessMcp;
let outbound: string[];
beforeEach(async () => {
  mcp = await bootKeylessMcp();
  mcp.answers.api_key_check = { data: ALLOWED, error: null };
  mcp.board = (body) => new Response(JSON.stringify(detail(String(body.id))), { status: 200 });
  outbound = [];
  const inner = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes("harness.supabase.co") && !u.includes("openai.com")) outbound.push(u);
    if (u.startsWith("https://jobs.ashbyhq.com/")) return new Response(JSON.stringify(ASHBY_FORM), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("greenhouse.io")) return new Response(JSON.stringify(GREENHOUSE_FORM), { status: 200, headers: { "content-type": "application/json" } });
    return inner(url as string, init);
  }) as typeof fetch;
});

const structured = (body: Record<string, unknown>) => ((body.result as { structuredContent?: Record<string, unknown> } | undefined)?.structuredContent ?? {}) as Record<string, unknown>;
const apply = (id: string, headers: Record<string, string> = {}) => mcp.rpc("tools/call", { name: "apply_myself", arguments: { id } }, headers);

describe("an Ashby posting", () => {
  it.each([["keyless", {}], ["keyed", KEY]] as Array<[string, Record<string, string>]>)("%s: apply_myself asks the board for it and Ashby for nothing", async (_tier, headers) => {
    const sc = structured(await apply(ASHBY_ID, headers));
    expect(mcp.boardCalls.some((b) => b.action === "detail" && b.id === ASHBY_ID)).toBe(true);
    expect(outbound.filter((u) => /ashbyhq\.com/.test(u)), "a request went to Ashby").toEqual([]);
    const form = sc.form as { source: string; questions: unknown[]; note: string };
    expect(form.source).toBe("not-read-on-this-surface");
    expect(form.questions).toEqual([]);
    expect(form.note).toMatch(/not read through this connection/);
    expect(sc.applyUrl).toBe("https://example.invalid/apply/ashby");
  });

  it("a Greenhouse posting's form is still read: the stop is Ashby's alone", async () => {
    const sc = structured(await apply(GREENHOUSE_ID));
    expect(outbound.some((u) => u.includes("greenhouse.io"))).toBe(true);
    expect((sc.form as { source: string }).source).toBe("employer-published");
  });
});

describe("nothing offers to read an Ashby form", () => {
  it("a search card for an Ashby posting carries no applyForm; a Greenhouse card does", async () => {
    mcp.board = () => new Response(JSON.stringify({ jobs: [detail(ASHBY_ID).job, detail(GREENHOUSE_ID).job], total: 2, hasMore: false }), { status: 200 });
    const sc = structured(await mcp.rpc("tools/call", { name: "search_jobs", arguments: { query: "registered nurse" } }));
    const cards = sc.jobs as Array<{ id: string; applyForm?: boolean }>;
    expect(cards.find((c) => c.id === ASHBY_ID)?.applyForm).toBeUndefined();
    expect(cards.find((c) => c.id === GREENHOUSE_ID)?.applyForm).toBe(true);
  });

  it("apply_myself's listing and the instructions name no Ashby reader, keyless or keyed", async () => {
    for (const headers of [{}, KEY]) {
      const tools = ((await mcp.rpc("tools/list", {}, headers)).result as { tools: Array<{ name: string; description: string }> }).tools;
      const desc = tools.find((t) => t.name === "apply_myself")!.description;
      expect(desc).toMatch(/Greenhouse/);
      expect(desc).not.toMatch(/Ashby/);
    }
    const init = (await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).result as { instructions: string };
    const readers = /publishes one \(([^)]*)\)/.exec(init.instructions)?.[1] ?? "";
    expect(readers).toMatch(/Greenhouse/);
    expect(readers).not.toMatch(/Ashby/);
  });

  it("/agents names no Ashby form reader", () => {
    expect(MCP_FORM_VENDORS.map((v) => v.key)).not.toContain("ashby");
    expect(MCP_TOOLS.find((t) => t.name === "apply_myself")!.body).not.toMatch(/Ashby/);
  });
});
