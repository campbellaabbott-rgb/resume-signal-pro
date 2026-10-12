// @vitest-environment node
/**
 * EVERY CLAUDE AND CHATGPT USER SHARED ONE ADDRESS'S UNKEYED ALLOWANCE —
 * AND THEN ANY SCRAPER COULD SPEND THE DAY FOR ALL OF THEM.
 *
 * MCP directory prep (2026-10-08) gave Claude and ChatGPT users their own
 * buckets, but every bucket still fell through to one global row of 2,000 a
 * day, so a script on any network could spend the day for every Claude and
 * ChatGPT seeker, and nothing bounded a minute. Owner decision 2026-10-11
 * (economics 1(b)): 20,000 a day split by the platform the VERIFIED address
 * belongs to — Claude 10,000, ChatGPT 6,000 (200 per person OpenAI names, 2,000
 * for calls naming nobody), everyone else 4,000 (100 per IPv4 address or IPv6
 * /64) — 60 a minute overall (30 / 20 / 15 per share), a forms pool of its own
 * for applying yourself, no refund for a timeout, board_stats cached and never
 * counted.
 *
 * agent-mcp run as shipped, its meter the REAL mcp_anon_check_v2
 * (20261011102000) in pglite, its call counter the real mcp_count_call
 * (20261011101000), only the network faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { PgSupabase } from "./helpers/pglite-supabase";
import { migration } from "./helpers/agent-db";
import { ANON_ALLOWANCE as A } from "../../supabase/functions/agent-mcp/allowance";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const OPENAI_LIST = "https://openai.com/chatgpt-connectors.json";
/** TEST-NET-2 stands in for an OpenAI egress block; 160.79.104.0/21 is Anthropic's published outbound range. */
const CHATGPT_ADDR = "198.51.100.20";
const CLAUDE_ADDR = "160.79.105.10";
const OTHER_ADDR = "203.0.113.7";
const V6_A = "2001:db8:1234:5678::1";
const V6_SAME_64 = "2001:db8:1234:5678:ffff::9";
const V6_OTHER_64 = "2001:db8:1234:9999::1";

let handler: EdgeHandler;
let db: PGlite;
let pg: PgSupabase;
let boardMode: "ok" | "timeout" | "unreachable" | "unknown-id";
let boardCalls: Array<Record<string, unknown>>;
/** A board that takes this long to answer, and how many of its reads ran at once at most. */
let boardDelayMs = 0;
let boardInFlight = 0;
let boardMaxInFlight = 0;

const hex16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);
const hhmi = () => new Date().toISOString().slice(11, 16).replace(":", "");
const seed = (bucket: string, calls: number) =>
  db.query("INSERT INTO public.mcp_anon_rate (day, bucket, calls) VALUES ($1::date, $2, $3) ON CONFLICT (day, bucket) DO UPDATE SET calls = excluded.calls", [today(), bucket, calls]);
const callsIn = async (bucket: string) =>
  (await db.query<{ calls: number }>("SELECT calls FROM public.mcp_anon_rate WHERE day = $1::date AND bucket = $2", [today(), bucket])).rows[0]?.calls ?? 0;
const settle = () => new Promise((r) => setTimeout(r, 60));

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
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");
  await db.exec(migration("20260915100000_a_shared_egress_makes_a_per_address_bucket_a_global_one_so_both_exist.sql"));
  // The readers' other tables, as stand-ins with the columns they read.
  await db.exec(`
    CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), name text, key_prefix text, tier text, daily_quota integer, revoked_at timestamptz);
    CREATE TABLE public.api_usage (day date, key_id uuid, endpoint text, calls integer);
    CREATE TABLE public.agent_passes (purchased_at timestamptz, activated_at timestamptz, activated_via text, applications_used integer, applications_total integer);
    CREATE TABLE public.job_board_search_events (at timestamptz, caller text, results integer);
  `);
  await db.exec(migration("20260917200000_a_channel_cannot_be_judged_until_someone_can_read_it.sql"));
  await db.exec(migration("20261009123000_the_adoption_reader_counts_addresses_not_a_hosts_own_buckets.sql"));
  await db.exec(migration("20261011100000_an_employers_application_form_is_read_once_a_day_not_once_a_question.sql"));
  await db.exec(migration("20261011101000_every_connector_call_is_counted_by_host_and_outcome_and_never_by_who.sql"));
  await db.exec(migration("20261011102000_a_hosts_users_can_spend_only_their_hosts_share_of_the_day.sql"));
  await db.exec(migration("20261011102100_the_adoption_reader_counts_addresses_not_shares_minutes_or_forms.sql"));
  pg = new PgSupabase(db);
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body?: string } = {}) => {
    if (String(url) === OPENAI_LIST) {
      return new Response(JSON.stringify({ creationTime: "2026-10-06T23:18:01", prefixes: [{ ipv4Prefix: "198.51.100.0/24" }] }), { status: 200 });
    }
    if (String(url).endsWith("/functions/v1/job-board")) {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      boardCalls.push(body);
      boardInFlight++;
      boardMaxInFlight = Math.max(boardMaxInFlight, boardInFlight);
      try {
        if (boardDelayMs) await new Promise((r) => setTimeout(r, boardDelayMs));
      } finally {
        boardInFlight--;
      }
      if (boardMode === "unreachable") throw new TypeError("fetch failed");
      if (boardMode === "timeout") return new Response(JSON.stringify({ error: "canceling statement due to statement timeout" }), { status: 504 });
      if (body.action === "detail") {
        if (boardMode === "unknown-id") return new Response(JSON.stringify({ error: "Unknown job id" }), { status: 404 });
        return new Response(JSON.stringify({ job: { id: body.id, source: "greenhouse", token: "acme", company: "Acme", title: "Nurse", applyUrl: "https://boards.greenhouse.io/acme/jobs/1" }, description: "Registered nurse, patient care." }), { status: 200 });
      }
      return new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Nurse", matchScope: "title" }], total: 1, hasMore: false, totalAllCompanies: 900000, companiesOpenCount: 30000, categories: { healthcare: 1 } }), { status: 200 });
    }
    if (String(url).startsWith("https://boards-api.greenhouse.io/")) {
      return new Response(JSON.stringify({ questions: [{ label: "Why do you want this role?", required: true, fields: [{ type: "textarea" }] }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  g.__mcpDb = {
    rpc: (name: string, args: Record<string, unknown>) => pg.rpc(name, args),
    from: (table: string) => (table === "application_form_cache" ? pg.from(table) : chain({ data: null, error: null })),
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 180_000);

beforeEach(async () => {
  boardMode = "ok";
  boardCalls = [];
  boardDelayMs = 0;
  boardMaxInFlight = 0;
  await db.exec("DELETE FROM public.mcp_anon_rate; DELETE FROM public.mcp_calls_daily;");
});

type Opts = { meta?: Record<string, unknown>; ua?: string; name?: string; args?: Record<string, unknown> };
const callFrom = async (address: string, o: Opts = {}) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": address, ...(o.ua ? { "user-agent": o.ua } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: o.name ?? "search_jobs", arguments: o.args ?? { query: "nurse" }, ...(o.meta ? { _meta: o.meta } : {}) } }),
  }));
  const body = await res.json() as { result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text: string }> } };
  return {
    res,
    refused: body.result?.isError === true,
    text: body.result?.content?.[0]?.text ?? JSON.stringify(body),
    sc: body.result?.structuredContent ?? {},
  };
};

describe("who pays is the platform the verified address belongs to", () => {
  it("a Claude call from Anthropic's published range is counted in Claude's share of 10,000", async () => {
    const r = await callFrom(CLAUDE_ADDR);
    expect(r.refused, r.text).toBe(false);
    expect(r.sc.unkeyed).toMatchObject({ allowance: "claude", partition: "claude", ipCap: A.shares.claude, partitionCap: A.shares.claude, globalCap: A.overallPerDay });
    expect(await callsIn("ip:host:claude")).toBe(1);
    expect(await callsIn("global:claude")).toBe(1);
    expect(await callsIn("global")).toBe(1);
  });

  it("a ChatGPT user calling through OpenAI's egress has their own 200, and two users never share one", async () => {
    await seed(`ip:u:chatgpt:${hex16("v1/user-a")}`, A.chatgptPerPerson);
    const a = await callFrom(CHATGPT_ADDR, { meta: { "openai/subject": "v1/user-a" } });
    expect(a.refused).toBe(true);
    const b = await callFrom(CHATGPT_ADDR, { meta: { "openai/subject": "v1/user-b" } });
    expect(b.refused, b.text).toBe(false);
    expect(b.sc.unkeyed).toMatchObject({ allowance: "chatgpt-user", partition: "chatgpt", ipCap: A.chatgptPerPerson, partitionCap: A.shares.chatgpt });
    expect(await callsIn(`ip:u:chatgpt:${hex16("v1/user-b")}`)).toBe(1);
  });

  it("ChatGPT calls that name nobody share 2,000", async () => {
    const r = await callFrom(CHATGPT_ADDR, { ua: "openai-mcp/1.0 (ChatGPT)" });
    expect(r.refused, r.text).toBe(false);
    expect(r.sc.unkeyed).toMatchObject({ allowance: "chatgpt", ipCap: A.chatgptNoSubject });
    expect(await callsIn("ip:host:chatgpt")).toBe(1);
  });

  it("a path, a user agent or an openai/subject never picks a share: from anywhere else it is everyone else's, by connection", async () => {
    for (const o of [{ ua: "openai-mcp/1.0 (ChatGPT)" }, { meta: { "openai/subject": "v1/forged" } }, { ua: "Claude-User" }] as Opts[]) {
      await db.exec("DELETE FROM public.mcp_anon_rate;");
      const r = await callFrom(OTHER_ADDR, o);
      expect(r.refused, r.text).toBe(false);
      expect(r.sc.unkeyed).toMatchObject({ allowance: "connection", partition: "other", ipCap: A.otherPerConnection, partitionCap: A.shares.other });
      expect(await callsIn(`ip:${hex16(OTHER_ADDR)}`)).toBe(1);
      expect(await callsIn("global:chatgpt")).toBe(0);
      expect(await callsIn(`ip:u:chatgpt:${hex16("v1/forged")}`)).toBe(0);
    }
  });

  it("an IPv6 caller is one connection per /64: rotating inside it buys nothing", async () => {
    await callFrom(V6_A);
    await callFrom(V6_SAME_64);
    await callFrom(V6_OTHER_64);
    expect(await callsIn(`ip:${hex16("v6:2001:db8:1234:5678::/64")}`)).toBe(2);
    expect(await callsIn(`ip:${hex16("v6:2001:db8:1234:9999::/64")}`)).toBe(1);
  });
});

describe("a scraper cannot spend another platform's share, or hold a minute", () => {
  it("a spent 'other' share refuses the scraper and leaves Claude's users answering", async () => {
    await seed("global:other", A.shares.other);
    const scraper = await callFrom(OTHER_ADDR);
    expect(scraper.refused).toBe(true);
    const claude = await callFrom(CLAUDE_ADDR);
    expect(claude.refused, claude.text).toBe(false);
  });

  it("a full minute refuses with the seconds left, counts nothing for the refused call, and leaves the day untouched", async () => {
    await seed(`min:global:other:${hhmi()}`, A.perMinute.other);
    const r = await callFrom(OTHER_ADDR);
    expect(r.refused).toBe(true);
    expect(r.text).toMatch(/Too many keyless calls this minute/);
    expect(Number(r.res.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(await callsIn(`ip:${hex16(OTHER_ADDR)}`)).toBe(0);
    expect(await callsIn("global")).toBe(0);
  });
});

describe("a refusal speaks to its host: hours until reset, the keyless twin, header advice only off the chat platforms", () => {
  it("from Claude: shared by every Claude user, the hours, the site — and no header", async () => {
    await seed("global:claude", A.shares.claude);
    const r = await callFrom(CLAUDE_ADDR);
    expect(r.refused).toBe(true);
    expect(r.text).toMatch(/The unkeyed allowance is spent/);
    expect(r.text).toMatch(/shared by every Claude user/);
    expect(r.text).toMatch(/in about \d+ hours?/);
    expect(r.text).toMatch(/resumebooster\.work\/jobs/);
    expect(r.text).not.toMatch(/Bearer|Authorization|x-api-key/);
    expect(Number(r.res.headers.get("retry-after"))).toBeGreaterThan(60);
  });

  it("from ChatGPT: no header and no key", async () => {
    await seed("ip:host:chatgpt", A.chatgptNoSubject);
    const r = await callFrom(CHATGPT_ADDR, { ua: "openai-mcp/1.0 (ChatGPT)" });
    expect(r.refused).toBe(true);
    expect(r.text).not.toMatch(/Bearer|Authorization|data-api/);
  });

  it("from a script: the free key and how it travels", async () => {
    await seed(`ip:${hex16(OTHER_ADDR)}`, A.otherPerConnection);
    const r = await callFrom(OTHER_ADDR);
    expect(r.refused).toBe(true);
    expect(r.text).toMatch(/Authorization: Bearer <key>/);
  });
});

describe("no refund for the expensive failure", () => {
  it("a board timeout is never given back", async () => {
    boardMode = "timeout";
    const r = await callFrom(OTHER_ADDR);
    expect(r.refused).toBe(true);
    await settle();
    expect(await callsIn(`ip:${hex16(OTHER_ADDR)}`)).toBe(1);
  });

  it("a transport fault before the board did any work is given back", async () => {
    boardMode = "unreachable";
    await callFrom(OTHER_ADDR);
    await settle();
    expect(await callsIn(`ip:${hex16(OTHER_ADDR)}`)).toBe(0);
  });

  it("an id the board does not carry is given back", async () => {
    boardMode = "unknown-id";
    const r = await callFrom(OTHER_ADDR, { name: "get_job", args: { id: "greenhouse:nobody:9" } });
    expect(r.sc).toMatchObject({ notFound: true });
    await settle();
    expect(await callsIn(`ip:${hex16(OTHER_ADDR)}`)).toBe(0);
  });
});

describe("board_stats and applying yourself spend no lookup", () => {
  it("board_stats is never counted, and a second call is served from the cache", async () => {
    const one = await callFrom(OTHER_ADDR, { name: "board_stats", args: {} });
    const two = await callFrom(OTHER_ADDR, { name: "board_stats", args: {} });
    expect(one.refused, one.text).toBe(false);
    expect(two.sc.servablePostings).toBe(900000);
    expect((one.sc.unkeyed as Record<string, unknown>).counted).toBe(false);
    expect(boardCalls.filter((b) => b.includeFacets === true)).toHaveLength(1);
    expect((await db.query("SELECT 1 FROM public.mcp_anon_rate")).rows).toHaveLength(0);
  });

  it("apply_myself draws on the forms pool, never the lookups or the overall day", async () => {
    const r = await callFrom(OTHER_ADDR, { name: "apply_myself", args: { id: "greenhouse:acme:1" } });
    expect(r.refused, r.text).toBe(false);
    expect(r.sc.unkeyed).toMatchObject({ pool: "forms", ipCap: A.forms.perBucket, partitionCap: A.forms.shares.other, globalCap: A.forms.overall });
    expect(await callsIn(`ip:f:${hex16(OTHER_ADDR)}`)).toBe(1);
    expect(await callsIn("global:forms:other")).toBe(1);
    expect(await callsIn("global:forms")).toBe(1);
    expect(await callsIn("global")).toBe(0);
    expect(await callsIn(`ip:${hex16(OTHER_ADDR)}`)).toBe(0);
  });
});

/**
 * The review of 9fe3bc0d, as its probe ran it: twenty apply_myself calls from
 * two IPv6 /64s outside both platforms filled the forms pool's one minute row,
 * and the next Claude and ChatGPT callers were refused "for reading
 * application forms (20 of 20)"; a spent pool day refused them until midnight.
 * Each platform now has its own part of the pool, by the day and the minute.
 */
describe("a scraper cannot spend Claude's or ChatGPT's part of the forms pool", () => {
  const OPENAI_META = { "openai/subject": "v1/forms-person" };
  it("twenty calls from outside both platforms leave Claude's and ChatGPT's apply_myself answering", async () => {
    const outcomes: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      outcomes.push((await callFrom(`2001:db8:aaaa:1::${i + 1}`, { name: "apply_myself", args: { id: "greenhouse:acme:1" } })).refused);
      outcomes.push((await callFrom(`2001:db8:aaaa:2::${i + 1}`, { name: "apply_myself", args: { id: "greenhouse:acme:1" } })).refused);
    }
    // The 'other' part of the pool takes its own minute and no more.
    expect(outcomes.filter((x) => !x)).toHaveLength(A.forms.perMinute.other);
    const claude = await callFrom(CLAUDE_ADDR, { name: "apply_myself", args: { id: "greenhouse:acme:1" } });
    const chatgpt = await callFrom(CHATGPT_ADDR, { name: "apply_myself", args: { id: "greenhouse:acme:1" }, meta: OPENAI_META });
    expect(claude.refused, claude.text).toBe(false);
    expect(chatgpt.refused, chatgpt.text).toBe(false);
  });

  it("a spent 'other' part of the pool for the day leaves Claude and ChatGPT answering", async () => {
    await seed("global:forms:other", A.forms.shares.other - 1);
    expect((await callFrom(OTHER_ADDR, { name: "apply_myself", args: { id: "greenhouse:acme:1" } })).refused).toBe(false);
    const next = await callFrom(V6_OTHER_64, { name: "apply_myself", args: { id: "greenhouse:acme:1" } });
    expect(next.refused).toBe(true);
    expect(next.text).toMatch(/1,000 application-form reads a day for everyone outside Claude and ChatGPT/);
    expect((await callFrom(CLAUDE_ADDR, { name: "apply_myself", args: { id: "greenhouse:acme:1" } })).refused).toBe(false);
    expect((await callFrom(CHATGPT_ADDR, { name: "apply_myself", args: { id: "greenhouse:acme:1" }, meta: OPENAI_META })).refused).toBe(false);
  });
});

describe("each call is counted by host, tool and outcome, never by who", () => {
  it("mcp_calls_daily holds the host partition and the outcome, and no address or subject", async () => {
    await callFrom(CLAUDE_ADDR);
    await seed("global:other", A.shares.other);
    await callFrom(OTHER_ADDR, { meta: { "openai/subject": "v1/secret-subject" } });
    await settle();
    const rows = (await db.query<{ host: string; surface: string; tool: string; outcome: string; calls: number }>("SELECT host, surface, tool, outcome, calls FROM public.mcp_calls_daily ORDER BY host")).rows;
    expect(rows).toEqual([
      { host: "claude", surface: "keyless", tool: "search_jobs", outcome: "ok", calls: 1 },
      { host: "other", surface: "keyless", tool: "search_jobs", outcome: "refused_day", calls: 1 },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/203\.0\.113|secret-subject/);
  });
});

describe("the adoption reader counts addresses, not a host's own buckets", () => {
  it("a Claude pool, a ChatGPT user's row, a share, a minute row and a forms bucket are not addresses", async () => {
    await seed("global", 530);
    await seed(`ip:${hex16(OTHER_ADDR)}`, 7);
    await seed("ip:host:claude", 500);
    await seed(`ip:u:chatgpt:${hex16("v1/user-a")}`, 23);
    await seed("global:claude", 500);
    await seed(`min:global:claude:${hhmi()}`, 9);
    await seed(`ip:f:${hex16(OTHER_ADDR)}`, 40);
    const { rows } = await db.query<{ unkeyed_calls: number; unkeyed_addresses: number; unkeyed_address_calls_max: number; unkeyed_addresses_at_max: number }>(
      "SELECT unkeyed_calls, unkeyed_addresses, unkeyed_address_calls_max, unkeyed_addresses_at_max FROM public.agent_adoption_metrics(1)",
    );
    expect(rows[0]).toEqual({ unkeyed_calls: 530, unkeyed_addresses: 1, unkeyed_address_calls_max: 7, unkeyed_addresses_at_max: 1 });
  });
});

/**
 * The review of 9fe3bc0d, three probes of the shipped handler:
 *   - ninety concurrent board_stats calls on a cold isolate made ninety facet
 *     reads (the cache helped only calls that came one after another);
 *   - sixty keyless searches sent at once ran sixty board reads at once, all
 *     inside the per-minute caps;
 *   - one keyless search_jobs with 300 token-shaped employer names was counted
 *     once and forwarded all 300 names to the board.
 */
describe("a burst is bounded in this isolate, and a long employer list is refused before it is counted", () => {
  it("concurrent board_stats misses share one board read", async () => {
    const later = Date.now() + 2 * A.boardStatsCacheMs;
    const spy = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      boardDelayMs = 80;
      const all = await Promise.all(Array.from({ length: 90 }, (_, i) =>
        callFrom(`2001:db8:${(i % 3) + 1}:1::${i + 1}`, { name: "board_stats", args: {} })));
      expect(all.filter((r) => r.refused)).toHaveLength(0);
      expect(boardCalls.filter((b) => b.includeFacets === true)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("sixty keyless searches sent at once never run more than the isolate's turns on the board at the same time", async () => {
    boardDelayMs = 80;
    const calls = [
      ...Array.from({ length: 30 }, () => callFrom(CLAUDE_ADDR)),
      ...Array.from({ length: 20 }, (_, i) => callFrom(CHATGPT_ADDR, { meta: { "openai/subject": `v1/burst-${i}` } })),
      ...Array.from({ length: 10 }, (_, i) => callFrom(`203.0.113.${100 + i}`)),
    ];
    const all = await Promise.all(calls);
    expect(all.filter((r) => r.refused).map((r) => r.text)).toEqual([]);
    expect(boardCalls.length).toBe(60);
    expect(boardMaxInFlight).toBeLessThanOrEqual(A.inFlightPerIsolate);
    expect(boardMaxInFlight).toBeGreaterThan(1);
  });

  it("a search naming 300 employers is an argument error: nothing counted, nothing sent to the board", async () => {
    const companies = Array.from({ length: 300 }, (_, i) => `zz-nobody-${i}`);
    const r = await callFrom(OTHER_ADDR, { args: { query: "nurse", companies } });
    expect(r.refused).toBe(true);
    expect(r.text).toMatch(/one search takes up to 50/);
    expect(await callsIn(`ip:${hex16(OTHER_ADDR)}`)).toBe(0);
    expect(boardCalls).toHaveLength(0);
  });
});

describe("only a call from OpenAI's published egress keeps its search out of the demand log", () => {
  it("a ChatGPT user agent or an openai/ _meta key from anywhere else is logged like any other search", async () => {
    await callFrom(OTHER_ADDR, { ua: "ChatGPT-probe/1.0" });
    await callFrom(OTHER_ADDR, { meta: { "openai/anything": "x" } });
    expect(boardCalls.map((b) => b.noLog)).toEqual([undefined, undefined]);
    boardCalls = [];
    await callFrom(CHATGPT_ADDR, { meta: { "openai/subject": "v1/real-person" } });
    expect(boardCalls.map((b) => b.noLog)).toEqual([true]);
  });
});
