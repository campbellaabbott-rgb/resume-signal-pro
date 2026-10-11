// @vitest-environment node
/**
 * EVERY CLAUDE AND CHATGPT USER SHARED ONE ADDRESS'S UNKEYED ALLOWANCE.
 *
 * MCP directory prep (commercial plan 2026-10-08, experiment 2: "give Claude
 * and ChatGPT users their own allowance instead of a shared 25 calls a day").
 * claude.ai and ChatGPT call the connector from their own servers, so the
 * per-address bucket was one bucket for every user behind each egress
 * address: the first user of the day could spend it for everyone.
 *
 * agent-mcp run as shipped, its meter the REAL mcp_anon_check (migration
 * 20260915100000) in pglite, only the network faked. A call whose
 * platform-seen address is in the host's published egress list is counted
 * under the ChatGPT user (openai/subject) or Claude's own pool first, and a
 * spent host bucket falls through to the address bucket. A subject from any
 * other address keys nothing, and the global cap still binds.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { PgSupabase } from "./helpers/pglite-supabase";
import { migration } from "./helpers/agent-db";
import { MCP_ANON_CAPS } from "@/config/mcp-tools";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const READER_FIX = "20261009123000_the_adoption_reader_counts_addresses_not_a_hosts_own_buckets.sql";
const OPENAI_LIST = "https://openai.com/chatgpt-connectors.json";
/** TEST-NET-2 stands in for an OpenAI egress block; 160.79.104.0/21 is Anthropic's published outbound range. */
const CHATGPT_ADDR = "198.51.100.20";
const CLAUDE_ADDR = "160.79.105.10";
const OTHER_ADDR = "203.0.113.7";

let handler: EdgeHandler;
let db: PGlite;
let pg: PgSupabase;

const hex16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);
const seed = (bucket: string, calls: number) =>
  db.query("INSERT INTO public.mcp_anon_rate (day, bucket, calls) VALUES ($1::date, $2, $3) ON CONFLICT (day, bucket) DO UPDATE SET calls = excluded.calls", [today(), bucket, calls]);
const callsIn = async (bucket: string) =>
  (await db.query<{ calls: number }>("SELECT calls FROM public.mcp_anon_rate WHERE day = $1::date AND bucket = $2", [today(), bucket])).rows[0]?.calls ?? 0;

function chain(result: unknown): unknown {
  const p: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result).then(ok, no);
      if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result);
      return () => p;
    },
  });
  return p;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(migration("20260915100000_a_shared_egress_makes_a_per_address_bucket_a_global_one_so_both_exist.sql"));
  // The adoption reader's other four tables, as stand-ins with the columns it reads.
  await db.exec(`
    CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), name text, key_prefix text);
    CREATE TABLE public.api_usage (day date, key_id uuid, endpoint text, calls integer);
    CREATE TABLE public.agent_passes (purchased_at timestamptz, activated_at timestamptz, activated_via text, applications_used integer, applications_total integer);
    CREATE TABLE public.job_board_search_events (at timestamptz, caller text, results integer);
  `);
  await db.exec(migration("20260917200000_a_channel_cannot_be_judged_until_someone_can_read_it.sql"));
  await db.exec(migration(READER_FIX));
  pg = new PgSupabase(db);
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string) => {
    if (String(url) === OPENAI_LIST) {
      return new Response(JSON.stringify({ creationTime: "2026-10-06T23:18:01", prefixes: [{ ipv4Prefix: "198.51.100.0/24" }, { ipv4Prefix: "100.31.168.162/32" }] }), { status: 200 });
    }
    if (String(url).endsWith("/functions/v1/job-board")) {
      return new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Nurse", matchScope: "title" }], total: 1, hasMore: false }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  g.__mcpDb = {
    rpc: (name: string, args: Record<string, unknown>) => pg.rpc(name, args),
    from: () => chain({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 120_000);

beforeEach(async () => {
  await db.exec("DELETE FROM public.mcp_anon_rate");
});

const search = async (address: string, meta?: Record<string, unknown>) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": address },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_jobs", arguments: { query: "nurse" }, ...(meta ? { _meta: meta } : {}) } }),
  }));
  const body = await res.json() as { result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text: string }> } };
  return { refused: body.result?.isError === true, text: body.result?.content?.[0]?.text ?? "", sc: body.result?.structuredContent ?? {} };
};

describe("a host's users are not one address", () => {
  it("a ChatGPT user calling through OpenAI's published egress has their own allowance after the address is spent", async () => {
    await seed(`ip:${hex16(CHATGPT_ADDR)}`, MCP_ANON_CAPS.perAddressPerDay);
    const r = await search(CHATGPT_ADDR, { "openai/subject": "v1/user-b" });
    expect(r.refused, r.text).toBe(false);
    expect(r.sc.unkeyed).toMatchObject({ allowance: "chatgpt-user", callsLeftToday: MCP_ANON_CAPS.perAddressPerDay - 1 });
    expect(await callsIn(`ip:u:chatgpt:${hex16("v1/user-b")}`)).toBe(1);
    expect(await callsIn(`ip:${hex16(CHATGPT_ADDR)}`)).toBe(MCP_ANON_CAPS.perAddressPerDay);
  });

  it("two ChatGPT users behind one address do not spend each other's calls", async () => {
    await seed(`ip:u:chatgpt:${hex16("v1/user-a")}`, MCP_ANON_CAPS.perAddressPerDay);
    const b = await search(CHATGPT_ADDR, { "openai/subject": "v1/user-b" });
    expect(b.refused, b.text).toBe(false);
    expect(b.sc.unkeyed).toMatchObject({ allowance: "chatgpt-user" });
  });

  it("a Claude call from Anthropic's published range is counted in Claude's own pool", async () => {
    await seed(`ip:${hex16(CLAUDE_ADDR)}`, MCP_ANON_CAPS.perAddressPerDay);
    const r = await search(CLAUDE_ADDR);
    expect(r.refused, r.text).toBe(false);
    expect(r.sc.unkeyed).toMatchObject({ allowance: "claude", ipCap: MCP_ANON_CAPS.hostPoolPerDay });
    expect(await callsIn("ip:host:claude")).toBe(1);
  });
});

describe("the bounds that stay", () => {
  it("a subject sent from an address outside the host's list keys nothing", async () => {
    await seed(`ip:${hex16(OTHER_ADDR)}`, MCP_ANON_CAPS.perAddressPerDay);
    const r = await search(OTHER_ADDR, { "openai/subject": "v1/made-up" });
    expect(r.refused).toBe(true);
    expect(await callsIn(`ip:u:chatgpt:${hex16("v1/made-up")}`)).toBe(0);
  });

  it("a spent host pool falls through to the address's own allowance", async () => {
    await seed("ip:host:claude", MCP_ANON_CAPS.hostPoolPerDay);
    const r = await search(CLAUDE_ADDR);
    expect(r.refused, r.text).toBe(false);
    expect(r.sc.unkeyed).toMatchObject({ allowance: "address", ipCap: MCP_ANON_CAPS.perAddressPerDay });
  });

  it("the global cap binds a host's callers too, and the refusal names it", async () => {
    await seed("global", MCP_ANON_CAPS.globalPerDay);
    const r = await search(CLAUDE_ADDR);
    expect(r.refused).toBe(true);
    expect(r.text).toContain(`${MCP_ANON_CAPS.globalPerDay} unkeyed calls a day across every caller`);
    expect(await callsIn("ip:host:claude")).toBe(0);
  });
});

describe("the adoption reader counts addresses, not a host's own buckets", () => {
  it("a Claude pool and a ChatGPT user's row are unkeyed calls, not addresses, and never the busiest address", async () => {
    await seed("global", 530);
    await seed(`ip:${hex16(OTHER_ADDR)}`, 7);
    await seed("ip:host:claude", 500);
    await seed(`ip:u:chatgpt:${hex16("v1/user-a")}`, 23);
    const { rows } = await db.query<{ unkeyed_calls: number; unkeyed_addresses: number; unkeyed_address_calls_max: number; unkeyed_addresses_at_max: number }>(
      "SELECT unkeyed_calls, unkeyed_addresses, unkeyed_address_calls_max, unkeyed_addresses_at_max FROM public.agent_adoption_metrics(1)",
    );
    expect(rows[0]).toEqual({ unkeyed_calls: 530, unkeyed_addresses: 1, unkeyed_address_calls_max: 7, unkeyed_addresses_at_max: 1 });
  });

  it("the migration runs again cleanly (its self-check included)", async () => {
    await db.exec(migration(READER_FIX));
  });
});
