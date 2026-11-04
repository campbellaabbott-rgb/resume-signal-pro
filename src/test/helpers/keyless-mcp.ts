/**
 * THE SHIPPED agent-mcp HANDLER ON A KEYLESS CALL, WITH ONLY ITS NEIGHBOURS FAKED.
 *
 * The meter answers what a test sets; job-board and notify-owner are one fetch.
 * Boot one per test when a test needs a fresh isolate: the alert memo lives in
 * the bundle.
 */
import { loadEdgeHandler, type EdgeHandler } from "./edge-harness";

/** TEST-NET-2 stands in for an OpenAI egress block. */
export const CHATGPT_ADDRESS = "198.51.100.20";
const OPENAI_LIST = "https://openai.com/chatgpt-connectors.json";

export type MeterRow = {
  allowed: boolean; refused_by: string | null; bucket_used: number; bucket_cap: number;
  share_used: number; share_cap: number; overall_used: number; overall_cap: number; minute_used: number; minute_cap: number;
};
export const QUIET_METER: MeterRow = {
  allowed: true, refused_by: null, bucket_used: 1, bucket_cap: 200, share_used: 1, share_cap: 6000, overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 20,
};

export interface KeylessMcp {
  /** Every call the handler made to job-board, by body. */
  boardCalls: Array<Record<string, unknown>>;
  /** Every RPC by name and arguments. */
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  /** Every delete, by table and its eq filters. */
  deletes: Array<{ table: string; eq: Record<string, unknown> }>;
  /** Every post to notify-owner, by body. */
  notes: Array<Record<string, unknown>>;
  meter: MeterRow;
  /** What an RPC answers, by name; unset names answer { data: null, error: null }. */
  answers: Record<string, { data: unknown; error: { message: string } | null }>;
  /** What notify-owner does with a post. */
  notifyOwner: () => Response | Promise<Response>;
  /** What job-board does with a call. */
  board: (body: Record<string, unknown>) => Response | Promise<Response>;
  call: (args: Record<string, unknown>, o?: { name?: string; meta?: Record<string, unknown>; address?: string; ua?: string }) => Promise<{ isError: boolean; text: string }>;
}

export async function bootKeylessMcp(): Promise<KeylessMcp> {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  const m: KeylessMcp = {
    boardCalls: [], rpcs: [], deletes: [], notes: [], meter: { ...QUIET_METER }, answers: {},
    notifyOwner: () => new Response(JSON.stringify({ success: true, kind: "allowance" }), { status: 200 }),
    board: () => new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 }),
    call: async () => ({ isError: false, text: "" }),
  };
  g.fetch = async (url: string, init: { body?: string } = {}) => {
    const u = String(url);
    if (u === OPENAI_LIST) return new Response(JSON.stringify({ creationTime: "2026-10-06T23:18:01", prefixes: [{ ipv4Prefix: "198.51.100.0/24" }] }), { status: 200 });
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    if (u.endsWith("/functions/v1/notify-owner")) { m.notes.push(body); return await m.notifyOwner(); }
    if (u.endsWith("/functions/v1/job-board")) { m.boardCalls.push(body); return await m.board(body); }
    return new Response("{}", { status: 404 });
  };
  const thenable = (result: unknown): unknown => {
    const p: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result).then(ok, no);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result);
        return () => p;
      },
    });
    return p;
  };
  g.__keylessMcpDb = {
    rpc: (name: string, args: Record<string, unknown>) => {
      m.rpcs.push({ name, args });
      if (name === "mcp_anon_check_v2") return thenable({ data: m.meter, error: null });
      return thenable(m.answers[name] ?? { data: null, error: null });
    },
    from: (table: string) => {
      const rec = { table, eq: {} as Record<string, unknown>, deleting: false };
      const result = { data: null, error: null };
      const chain: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") {
            if (rec.deleting) m.deletes.push({ table: rec.table, eq: rec.eq });
            return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result).then(ok, no);
          }
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result);
          return (...a: unknown[]) => {
            if (prop === "delete") rec.deleting = true;
            if (prop === "eq") rec.eq[String(a[0])] = a[1];
            return chain;
          };
        },
      });
      return chain;
    },
  };
  const handler: EdgeHandler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__keylessMcpDb; }",
  });
  m.call = async (args, o = {}) => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": o.address ?? "203.0.113.7", ...(o.ua ? { "user-agent": o.ua } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: o.name ?? "search_jobs", arguments: args, ...(o.meta ? { _meta: o.meta } : {}) } }),
    }));
    const body = await res.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    return { isError: body.result?.isError === true, text: body.result?.content?.[0]?.text ?? JSON.stringify(body) };
  };
  return m;
}
