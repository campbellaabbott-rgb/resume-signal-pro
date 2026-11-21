// @vitest-environment node
/**
 * A CLIENT THAT ASKS FOR 2025-03-26 IS ANSWERED 2025-03-26, ONE TEST DOES THE
 * SAME FOR EACH REVISION THE SERVER LISTS, AND A CLIENT OF 2026-07-28 IS
 * EITHER SERVED OR TOLD TO FALL BACK (lane fix/1121-connector-errors, item 8).
 *
 * Live 2026-11-21: initialize answered 2025-06-18 whatever was asked
 * (2024-11-05 and 2025-11-25 tried). The rule (2025-11-25 lifecycle, Version
 * Negotiation): a server that supports the requested version MUST answer it;
 * a client that does not support the answer SHOULD disconnect. And a
 * 2026-07-28 client's server/discover was answered HTTP 200 with -32601,
 * which its fallback rule cannot read.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { MCP_PROTOCOL_VERSIONS, SERVES_2026_07_28 } from "../../supabase/functions/agent-mcp/protocol.ts";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let m: KeylessMcp;
let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  m = await bootKeylessMcp();
  m.board = () => new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 1, hasMore: false }), { status: 200 });
  // The same bundle the helper booted, reached directly for raw status codes and headers.
  handler = (globalThis as Record<string, unknown>).__edgeHandler as typeof handler;
}, 120_000);

const URL_ = "https://harness.supabase.co/functions/v1/agent-mcp";
const post = async (body: unknown, headers: Record<string, string> = {}) => {
  const res = await handler(new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
};
const init = (v: string) => ({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "1" } } });
const call = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_jobs", arguments: { query: "nurse" } } });

describe("initialize answers each handshake revision as itself", () => {
  it("the server lists the four handshake revisions, latest first", () => {
    expect(MCP_PROTOCOL_VERSIONS).toEqual(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
  });
  it.each(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"])("asked %s, answers %s", async (v) => {
    const r = await post(init(v));
    expect(r.body.result.protocolVersion).toBe(v);
  });
  it.each(["2099-01-01", "2026-07-28"])("asked %s, answers the latest handshake revision", async (v) => {
    const r = await post(init(v));
    expect(r.body.result.protocolVersion).toBe("2025-11-25");
  });
});

describe("2025-03-26 batches", () => {
  it("a batch of two calls answers an array of two, each metered on its own", async () => {
    const before = m.rpcs.filter((x) => x.name === "mcp_anon_check_v2").length;
    const r = await post([call(1), call(2)]);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.map((x: { id: number }) => x.id)).toEqual([1, 2]);
    expect(m.rpcs.filter((x) => x.name === "mcp_anon_check_v2").length - before).toBe(2);
  });
  it("a batch of eleven is refused with the bound named", async () => {
    const r = await post(Array.from({ length: 11 }, (_, i) => call(i + 1)));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(-32600);
    expect(r.body.error.message).toMatch(/at most 10/);
  });
  it("a batch sent with the header 2025-06-18 keeps the old refusal", async () => {
    const r = await post([call(1)], { "mcp-protocol-version": "2025-06-18" });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe("batching not supported; send one message per request");
  });
  it("initialize inside a batch is that element's refusal", async () => {
    const r = await post([init("2025-03-26"), call(2)]);
    expect(r.body[0].error.code).toBe(-32600);
    expect(r.body[1].result).toBeDefined();
  });
});

describe("the current revision, 2026-07-28", () => {
  it("a browser-run client's preflight may send mcp-method and mcp-name", async () => {
    const res = await handler(new Request(URL_, { method: "OPTIONS", headers: { origin: "http://localhost:6274", "access-control-request-method": "POST", "access-control-request-headers": "mcp-method, mcp-name" } }));
    const allow = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allow).toMatch(/mcp-method/);
    expect(allow).toMatch(/mcp-name/);
  });
  const modern = { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" };
  const discover = { jsonrpc: "2.0", id: 7, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } };
  if (SERVES_2026_07_28) {
    it("server/discover answers resultType complete with the versions it speaks", async () => {
      const r = await post(discover, modern);
      expect(r.status).toBe(200);
      expect(r.body.result.resultType).toBe("complete");
      expect(r.body.result.supportedVersions).toContain("2026-07-28");
    });
  } else {
    it("server/discover, and a _meta-carrying tools/list, are told to fall back to initialize: HTTP 400, -32600, no `supported`", async () => {
      for (const msg of [discover, { jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }]) {
        const r = await post(msg, modern);
        expect(r.status).toBe(400);
        expect(r.body.error.code).toBe(-32600);
        expect(r.body.error.code).not.toBe(-32022);
        expect(r.body.error.data.handshakeVersions).toEqual(MCP_PROTOCOL_VERSIONS);
        expect(r.body.error.data).not.toHaveProperty("supported");
      }
    });
  }
  it("an unknown method with no _meta version answers 200 with -32601, as today", async () => {
    const r = await post({ jsonrpc: "2.0", id: 9, method: "nope/nothing", params: {} });
    expect(r.status).toBe(200);
    expect(r.body.error.code).toBe(-32601);
  });
  it("a GET asking for an event stream is told the transport", async () => {
    const res = await handler(new Request(URL_, { method: "GET", headers: { accept: "text/event-stream" } }));
    expect(res.status).toBe(405);
    expect((await res.json()).error).toMatch(/set the transport type to http, not sse/);
  });
});
