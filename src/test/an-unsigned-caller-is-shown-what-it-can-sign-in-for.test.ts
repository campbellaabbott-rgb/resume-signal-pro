// @vitest-environment node
/**
 * AN UNSIGNED CALLER IS SHOWN WHAT IT CAN SIGN IN FOR (S14X-262).
 *
 * While the sign-in service is on, the server marks each tool with the
 * security schemes a host reads to offer its Connect card: a keyless tool
 * noauth or oauth2, a keyed tool oauth2 only. But it filtered a caller with
 * no credential down to the keyless tools BEFORE attaching them, so the only
 * tools a signed-in account adds (scoring a CV, a key's status) were never
 * shown to anyone who had not signed in yet, and no host could raise the
 * card for them. The site's Claude line promised the card "to open a posting
 * in full or to check a shortlist", which are keyless.
 *
 * Now, while sign-in is on, an unsigned caller is also shown fit_resume and
 * key_status, oauth2 only; never debug_search, and inside ChatGPT none of the
 * tools it never lists. While sign-in is off the list is exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import type { EdgeHandler } from "./helpers/edge-harness";
import { AUTHORIZATION_SERVER_METADATA_URL } from "../../supabase/functions/agent-mcp/as-probe";
import { AUTH_ISSUER } from "../../supabase/functions/agent-mcp/oauth";
import { MCP_HOSTS } from "../config/mcp-tools";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const KEYLESS = ["board_stats", "search_jobs", "search", "fetch", "get_job", "get_jobs", "check_jobs_open", "employer_hiring_record", "employer_growth", "apply_myself"];
const FULL_DOCUMENT = {
  issuer: AUTH_ISSUER,
  registration_endpoint: `${AUTH_ISSUER}/oauth/clients/register`,
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
};
type Listed = { name: string; securitySchemes?: Array<{ type: string }> };

let mcp: KeylessMcp;
let handler: EdgeHandler;
/** Boot with the authorization server answering its metadata document (on) or the harness's 404 (off). */
async function boot(signIn: "on" | "off") {
  mcp = await bootKeylessMcp();
  handler = (globalThis as Record<string, unknown>).__edgeHandler as EdgeHandler;
  if (signIn === "on") {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) =>
      String(url) === AUTHORIZATION_SERVER_METADATA_URL
        ? new Response(JSON.stringify(FULL_DOCUMENT), { status: 200, headers: { "Content-Type": "application/json" } })
        : inner(url as string, init)) as typeof fetch;
  }
}
const list = async (ua?: string): Promise<Listed[]> => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "203.0.113.7", ...(ua ? { "user-agent": ua } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  return ((await res.json()) as { result: { tools: Listed[] } }).result.tools;
};
const names = (tools: Listed[]) => tools.map((t) => t.name).sort();

describe("while sign-in is on", () => {
  beforeEach(() => boot("on"));

  it("an unsigned caller in Claude is shown fit_resume and key_status, oauth2 only, and never debug_search", async () => {
    const tools = await list();
    expect(names(tools)).toEqual([...KEYLESS, "fit_resume", "key_status"].sort());
    for (const keyed of ["fit_resume", "key_status"]) {
      expect(tools.find((t) => t.name === keyed)?.securitySchemes?.map((s) => s.type), keyed).toEqual(["oauth2"]);
    }
    for (const t of tools.filter((x) => KEYLESS.includes(x.name))) {
      expect(t.securitySchemes?.map((s) => s.type), t.name).toEqual(["noauth", "oauth2"]);
    }
  });

  it("an unsigned caller inside ChatGPT is shown none of the tools ChatGPT never lists", async () => {
    const tools = await list("openai-mcp/1.0 (ChatGPT)");
    expect(names(tools)).toContain("search_jobs");
    expect(names(tools)).not.toContain("fit_resume");
    expect(names(tools)).not.toContain("key_status");
    expect(names(tools)).not.toContain("debug_search");
  });

  it("calling the tool it was shown raises the sign-in challenge, not a refusal", async () => {
    await list();
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "key_status", arguments: {} } }),
    }));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/Bearer/);
    expect(mcp.rpcs.filter((r) => r.name === "mcp_anon_check_v2")).toHaveLength(0);
  });
});

describe("while sign-in is off nothing changes", () => {
  beforeEach(() => boot("off"));

  it("an unsigned caller is shown the keyless tools only, with no security schemes", async () => {
    const tools = await list();
    expect(names(tools)).toEqual([...KEYLESS].sort());
    for (const t of tools) expect(t.securitySchemes, t.name).toBeUndefined();
  });
});

describe("the site's Claude line names what needs an account", () => {
  it("scoring a CV and the key's status, and no keyless tool's work", () => {
    const claude = MCP_HOSTS.find((h) => h.id === "claude")!;
    const on = claude.signIn("on");
    expect(on).toMatch(/score your CV/);
    expect(on).toMatch(/key's status/);
    expect(on).not.toMatch(/open a posting|check a shortlist|search/i);
  });
});
