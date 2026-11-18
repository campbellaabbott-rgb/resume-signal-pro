// @vitest-environment node
/**
 * A WEB PAGE CANNOT SPEND THE KEYLESS ALLOWANCE THROUGH ITS VISITORS (S14X-091).
 *
 * A keyless call is counted against the address it comes from. The server
 * answered every preflight with Access-Control-Allow-Origin: *, and read the
 * body of a text/plain POST (which a browser sends with no preflight at all),
 * so any page on the web could make its visitors' browsers spend their
 * allowance, or the shared one, on calls the visitors never asked for.
 *
 * Now a POST that is not application/json is refused with 415 and a POST from
 * a page that is not one of ours or a host's is refused with 403, both before
 * anything is counted. A listed page is answered by name with Vary: Origin and
 * keeps the cost wave's two-hour preflight cache. A call with no Origin (how
 * Claude's and ChatGPT's servers, Claude Code and a script call) is answered
 * exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const URL_ = "https://harness.supabase.co/functions/v1/agent-mcp";
const EVIL = "https://evil.example";
const SEARCH = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_jobs", arguments: { query: "nurse" } } });

let mcp: KeylessMcp;
let handler: EdgeHandler;
beforeEach(async () => {
  mcp = await bootKeylessMcp();
  handler = (globalThis as Record<string, unknown>).__edgeHandler as EdgeHandler;
});

const counted = () => mcp.rpcs.filter((r) => r.name === "mcp_anon_check_v2").length;
const post = (headers: Record<string, string>, body = SEARCH) =>
  handler(new Request(URL_, { method: "POST", headers: { accept: "application/json, text/event-stream", "x-forwarded-for": "203.0.113.7", ...headers }, body }));
const preflight = (origin: string) =>
  handler(new Request(URL_, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type, mcp-protocol-version" } }));

describe("a POST a browser can send without asking first is refused before it is counted", () => {
  it("a text/plain tools/call from a foreign page is 415 and nothing is counted", async () => {
    const res = await post({ "content-type": "text/plain;charset=UTF-8", origin: EVIL });
    expect(res.status).toBe(415);
    expect(counted()).toBe(0);
    expect(mcp.boardCalls).toHaveLength(0);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("an application/json tools/call from a foreign page is 403 and nothing is counted", async () => {
    const res = await post({ "content-type": "application/json", origin: EVIL });
    expect(res.status).toBe(403);
    expect(counted()).toBe(0);
    expect(mcp.boardCalls).toHaveLength(0);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("a page that hides its origin (Origin: null) is refused the same way", async () => {
    const res = await post({ "content-type": "application/json", origin: "null" });
    expect(res.status).toBe(403);
    expect(counted()).toBe(0);
  });

  it("a form-encoded POST from a script is told to send JSON, uncounted", async () => {
    const res = await post({ "content-type": "application/x-www-form-urlencoded" });
    expect(res.status).toBe(415);
    expect(JSON.stringify(await res.json())).toMatch(/Content-Type: application\/json/);
    expect(counted()).toBe(0);
  });
});

describe("the callers it is for are answered as before", () => {
  it("an application/json call with no Origin (a host's server, Claude Code, curl) is answered and counted once", async () => {
    const res = await post({ "content-type": "application/json" });
    expect(res.status).toBe(200);
    expect(counted()).toBe(1);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it.each(["https://claude.ai", "https://chatgpt.com", "https://resumebooster.work", "https://www.resumebooster.work", "http://localhost:6274"])(
    "a call from %s is answered by name and counted once",
    async (origin) => {
      const res = await post({ "content-type": "application/json; charset=utf-8", origin });
      expect(res.status).toBe(200);
      expect(counted()).toBe(1);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Vary")).toMatch(/Origin/);
    },
  );
});

describe("the preflight names the page it allows, and only that page", () => {
  it("a foreign page's preflight carries no Access-Control-Allow-Origin", async () => {
    const res = await preflight(EVIL);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("our own page's preflight is allowed by name and keeps the two-hour cache", async () => {
    const res = await preflight("https://resumebooster.work");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://resumebooster.work");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("7200");
    expect(res.headers.get("Vary")).toMatch(/Origin/);
  });

  it("a lookalike of our host is not ours", async () => {
    for (const o of ["https://resumebooster.work.evil.example", "http://resumebooster.work", "https://claude.ai:8443", "http://localhost.evil.example"]) {
      expect((await preflight(o)).headers.get("Access-Control-Allow-Origin"), o).toBeNull();
    }
  });
});
