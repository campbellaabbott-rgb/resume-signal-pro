/**
 * THE SHIPPED /v1 HANDLER, WITH A DATABASE THAT WRITES DOWN WHAT IT WAS ASKED.
 *
 * public-api's tests that read its source pinned spellings; these run the
 * bundled index.ts (helpers/edge-harness) against an in-memory client that
 * applies the filters it understands, records every builder call it receives,
 * and answers RPCs from functions the test controls. A test can then say both
 * what a caller got back and what the query was bounded by.
 *
 * Unknown builder methods are recorded and ignored rather than thrown on, so a
 * route's unrelated reads (last-verified stamps, withheld tokens) come back
 * empty instead of failing a test about something else.
 */
import { loadEdgeHandler, type EdgeHandler } from "./edge-harness";

type Row = Record<string, unknown>;
export type Op = [string, unknown[]];
export type Recorded = { table: string; ops: Op[] };
export type RpcAnswer = { data: unknown; error: { code?: string; message: string } | null };

const cmp = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a), y = String(b);
  return x === y ? 0 : x < y ? -1 : 1;
};

/** `a:b->c` and `b->>c` select paths, read off a row. */
function project(row: Row, cols: string | undefined): Row {
  if (!cols) return { ...row };
  const parts = cols.split(",").map((c) => c.trim()).filter(Boolean);
  if (!parts.some((p) => p.includes(":") || p.includes("->"))) return { ...row };
  const out: Row = {};
  for (const p of parts) {
    const [alias, expr] = p.includes(":") ? [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)] : [null, p];
    const path = expr.split(/->>?/);
    let v: unknown = row[path[0]];
    for (const k of path.slice(1)) v = v && typeof v === "object" ? (v as Row)[k] : undefined;
    out[alias ?? path[path.length - 1]] = v ?? null;
  }
  return out;
}

class Query {
  ops: Op[] = [];
  private preds: Array<(r: Row) => boolean> = [];
  private orders: Array<[string, boolean]> = [];
  private lo = 0;
  private hi = Infinity;
  private cols: string | undefined;
  private head = false;
  private counting = false;

  constructor(private rows: Row[], private fault: RpcAnswer["error"]) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    this.ops.push(["select", [cols, opts]]);
    this.cols = cols;
    this.counting = !!opts?.count;
    this.head = !!opts?.head;
    return this;
  }
  eq(c: string, v: unknown) { this.ops.push(["eq", [c, v]]); this.preds.push((r) => (r[c] ?? null) === v); return this; }
  neq(c: string, v: unknown) { this.ops.push(["neq", [c, v]]); this.preds.push((r) => (r[c] ?? null) !== v); return this; }
  is(c: string, v: unknown) { this.ops.push(["is", [c, v]]); this.preds.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.ops.push(["in", [c, vs]]); this.preds.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: unknown) { this.ops.push(["gte", [c, v]]); this.preds.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this; }
  lte(c: string, v: unknown) { this.ops.push(["lte", [c, v]]); this.preds.push((r) => r[c] != null && cmp(r[c], v) <= 0); return this; }
  gt(c: string, v: unknown) { this.ops.push(["gt", [c, v]]); this.preds.push((r) => r[c] != null && cmp(r[c], v) > 0); return this; }
  lt(c: string, v: unknown) { this.ops.push(["lt", [c, v]]); this.preds.push((r) => r[c] != null && cmp(r[c], v) < 0); return this; }
  not(c: string, op: string, v: unknown) {
    this.ops.push(["not", [c, op, v]]);
    if (op === "in") {
      const vals = String(v).replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      this.preds.push((r) => !vals.includes(String(r[c])));
    } else if (op === "is") this.preds.push((r) => (r[c] ?? null) !== null);
    return this;
  }
  /** Recorded, not applied: a test about a keyset reads the expression it was sent. */
  or(expr: string) { this.ops.push(["or", [expr]]); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.ops.push(["order", [c, o]]); this.orders.push([c, o?.ascending !== false]); return this; }
  limit(n: number) { this.ops.push(["limit", [n]]); this.hi = Math.min(this.hi, this.lo + n - 1); return this; }
  range(a: number, b: number) { this.ops.push(["range", [a, b]]); this.lo = a; this.hi = b; return this; }

  private result(): { data: unknown; error: RpcAnswer["error"]; count: number | null } {
    if (this.fault) return { data: null, error: this.fault, count: null };
    const hit = this.rows.filter((r) => this.preds.every((p) => p(r))).sort((x, y) => {
      for (const [c, asc] of this.orders) {
        const d = cmp(x[c], y[c]);
        if (d) return asc ? d : -d;
      }
      return 0;
    });
    const page = hit.slice(this.lo, this.hi === Infinity ? undefined : this.hi + 1).map((r) => project(r, this.cols));
    return { data: this.head ? null : page, error: null, count: this.counting ? hit.length : null };
  }
  maybeSingle() {
    this.ops.push(["maybeSingle", []]);
    const r = this.result();
    return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data });
  }
  single() { return this.maybeSingle(); }
  then<A, B = never>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.result()).then(ok, no);
  }
}

/** Any method the class does not define is recorded and returns the chain. */
function recorded(q: Query): Query {
  const proxy: Query = new Proxy(q, {
    get(t, prop, recv) {
      if (prop in t) {
        const v = Reflect.get(t, prop, recv);
        return typeof v === "function" ? (...a: unknown[]) => { const out = v.apply(t, a); return out === t ? proxy : out; } : v;
      }
      if (typeof prop !== "string") return undefined;
      return (...a: unknown[]) => { t.ops.push([prop, a]); return proxy; };
    },
  });
  return proxy;
}

export class RecordingDb {
  tables: Record<string, Row[]> = {};
  /** A table whose reads answer this error. */
  faults: Record<string, RpcAnswer["error"]> = {};
  rpcs: Record<string, (args: Record<string, unknown>) => RpcAnswer> = {};
  calls: Recorded[] = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  client() {
    return {
      from: (table: string) => {
        const q = new Query(this.tables[table] ?? [], this.faults[table] ?? null);
        this.calls.push({ table, ops: q.ops });
        return recorded(q);
      },
      rpc: (name: string, args: Record<string, unknown> = {}) => {
        this.rpcCalls.push({ name, args });
        const f = this.rpcs[name];
        const r = Promise.resolve(f ? f(args) : { data: null, error: { code: "PGRST202", message: `fake: no rpc ${name}` } });
        const first = r.then((x) => ({ ...x, data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data }));
        return Object.assign(r, { maybeSingle: () => first, single: () => first });
      },
    };
  }

  /** The recorded builders for one table, in the order the handler made them. */
  queriesOf(table: string): Op[][] {
    return this.calls.filter((c) => c.table === table).map((c) => c.ops);
  }
}

export const ALLOWED = {
  is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free",
  rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1,
};

export type Fetched = { url: string; body: unknown; headers: Record<string, string> };

/**
 * Load the shipped public-api handler once per file. `fetchHook` answers the
 * edge-to-edge calls (job-board, job-fit); every call is recorded with its
 * parsed JSON body.
 */
export async function loadPublicApi(fetchHook: (f: Fetched) => Response | Promise<Response>) {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  const fetched: Fetched[] = [];
  g.fetch = async (url: string, init: { body?: string; headers?: Record<string, string> } = {}) => {
    let body: unknown = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
    const f = { url: String(url), body, headers: { ...(init.headers ?? {}) } };
    fetched.push(f);
    return fetchHook(f);
  };
  const handler: EdgeHandler = await loadEdgeHandler("public-api", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__apiDb; }",
  });
  return { handler, fetched };
}

export function useDb(db: RecordingDb): void {
  (globalThis as Record<string, unknown>).__apiDb = db.client();
}

export async function callApi(handler: EdgeHandler, path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.auth !== false) headers.authorization = "Bearer rb_live_harness_key_0123456789";
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/public-api${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) } : {}),
  }));
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* a 304 or empty body */ }
  return { status: res.status, headers: res.headers, body };
}

/** base64url JSON, the shape every /v1 cursor has. */
export const cursorOf = (o: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const decodeCursorForTest = (c: string) =>
  JSON.parse(Buffer.from(c.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { ep: string; id: string };
