/**
 * RUN A REAL EDGE FUNCTION'S HANDLER UNDER NODE, WITH ONLY ITS NETWORK FAKED.
 *
 * WHY THIS EXISTS. The paid analysis was refused for every buyer for nine
 * months under a suite that was green, because every guard near the payment
 * path read SPELLINGS: that a session id was passed, that a gate function was
 * named. None of them ran the handler with a $5 session and looked at the
 * status code. A 402 on every purchase is invisible to a guard that never
 * makes a purchase.
 *
 * So this bundles the shipped index.ts with esbuild and replaces exactly the
 * modules that reach the network -- the Deno std server, Stripe, the Supabase
 * client factory, the AI gateway -- with stubs that read from objects the test
 * controls. Every other import, the pure shared modules included, is the real
 * file. What runs is the code that deploys, minus its sockets.
 *
 * The bundle is executed with `new Function`, so the module-level code runs
 * exactly once per load, the same as a cold start: `serve(handler)` hands the
 * handler to the stub, and the stub parks it on globalThis for the test.
 *
 * Node environment only: esbuild refuses jsdom's TextEncoder (the same reason
 * a-window-of-ours-is-not-a-closure-of-theirs runs under node).
 */
import { build, type Plugin } from "esbuild";
import { resolve } from "node:path";

export type EdgeHandler = (req: Request) => Promise<Response>;

const FUNCTIONS = resolve(__dirname, "../../../supabase/functions");

/**
 * Bundle `supabase/functions/<fn>/index.ts` with `stubs` standing in for the
 * named imports, and return the handler it passes to serve().
 *
 * A stub key is either an exact import specifier (a URL) or a path suffix
 * beginning `_shared/` (matched against relative imports). An https: or npm:
 * import with no stub is a build ERROR rather than a silent network call.
 */
export async function loadEdgeHandler(fn: string, stubs: Record<string, string>): Promise<EdgeHandler> {
  const plugin: Plugin = {
    name: "edge-stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        for (const key of Object.keys(stubs)) {
          if (args.path === key) return { path: key, namespace: "edge-stub" };
          if (key.startsWith("_shared/") && args.path.endsWith(key)) return { path: key, namespace: "edge-stub" };
        }
        if (/^(https?:|npm:|jsr:)/.test(args.path)) {
          return { errors: [{ text: `unstubbed remote import ${args.path} -- add a stub or the test would reach the network` }] };
        }
        return undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "edge-stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
    },
  };
  const out = await build({
    entryPoints: [resolve(FUNCTIONS, fn, "index.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "node",
    target: "es2022",
    plugins: [plugin],
    logLevel: "silent",
  });
  const g = globalThis as Record<string, unknown>;
  g.__edgeHandler = undefined;
  new Function(out.outputFiles[0].text)();
  const handler = g.__edgeHandler as EdgeHandler | undefined;
  if (typeof handler !== "function") throw new Error(`${fn}: the bundle ran but never called serve()`);
  return handler;
}

// ---------------------------------------------------------------------------
// An in-memory stand-in for the supabase-js query builder.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };
export type DbResult = { data: unknown; error: DbError | null };

/**
 * The tables a test touches, with the UNIQUE keys that make a claim atomic.
 *
 * Every call yields to the event loop before it reads or writes, exactly as a
 * real round trip would, so two requests started together interleave at every
 * database call and a check-then-write race is reproducible rather than
 * theoretical.
 */
export class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, (args: Record<string, unknown>) => DbResult | Promise<DbResult>> = {};
  /** One-shot injected failures, consumed by the first matching call. */
  faults: Array<{ table: string; op: string; error: DbError }> = [];
  /** Every write, in order, for assertions about what a request recorded. */
  writes: Array<{ table: string; op: string; payload: unknown }> = [];

  constructor(public unique: Record<string, string[]> = {}) {}

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  /**
   * Awaitable directly, or through .maybeSingle() / .single() as supabase-js
   * allows for a set-returning RPC: those take the first row of an array.
   */
  rpc(name: string, args: Record<string, unknown> = {}): Promise<DbResult> & { maybeSingle(): Promise<DbResult>; single(): Promise<DbResult> } {
    const run = (async (): Promise<DbResult> => {
      await Promise.resolve();
      const f = this.rpcs[name];
      if (!f) return { data: null, error: { code: "PGRST202", message: `fake: no rpc ${name}` } };
      return f(args);
    })();
    const first = (r: DbResult): DbResult => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
    return Object.assign(run, { maybeSingle: () => run.then(first), single: () => run.then(first) });
  }

  takeFault(table: string, op: string): DbError | null {
    const i = this.faults.findIndex((f) => f.table === table && f.op === op);
    if (i < 0) return null;
    return this.faults.splice(i, 1)[0].error;
  }
}

let seq = 0;
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

class FakeQuery implements PromiseLike<DbResult> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: unknown = null;
  /** upsert's conflict column (supabase-js onConflict); the row's id when absent. */
  private conflict = "id";
  private filters: Array<[string, unknown]> = [];
  /** Filters other than equality (.in, .gt), as predicates over a row. */
  private preds: Array<(r: Row) => boolean> = [];
  private returning = false;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) { this.returning = true; return this; }
  insert(payload: unknown) { this.op = "insert"; this.payload = payload; return this; }
  upsert(payload: unknown, opts?: { onConflict?: string }) { this.op = "upsert"; this.payload = payload; this.conflict = opts?.onConflict ?? "id"; return this; }
  update(payload: unknown) { this.op = "update"; this.payload = payload; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: unknown) { this.filters.push([col, val]); return this; }
  is(col: string, val: unknown) { this.filters.push([col, val]); return this; }
  in(col: string, vals: unknown[]) { this.preds.push((r) => vals.includes(r[col] ?? null)); return this; }
  gt(col: string, val: unknown) { this.preds.push((r) => r[col] != null && String(r[col]) > String(val)); return this; }
  order() { return this; }
  limit() { return this; }

  maybeSingle(): Promise<DbResult> { return this.exec("maybe"); }
  single(): Promise<DbResult> { return this.exec("single"); }
  then<A = DbResult, B = never>(
    ok?: ((v: DbResult) => A | PromiseLike<A>) | null,
    no?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.exec("many").then(ok, no);
  }

  private matches(r: Row): boolean {
    return this.filters.every(([c, v]) => (r[c] ?? null) === (v ?? null)) && this.preds.every((p) => p(r));
  }

  private finish(list: Row[], mode: "many" | "maybe" | "single"): DbResult {
    const copy = list.map((r) => ({ ...r }));
    if (mode === "maybe") {
      if (copy.length > 1) return { data: null, error: { code: "PGRST116", message: "fake: more than one row" } };
      return { data: copy[0] ?? null, error: null };
    }
    if (mode === "single") {
      return copy.length === 1
        ? { data: copy[0], error: null }
        : { data: null, error: { code: "PGRST116", message: `fake: ${copy.length} rows` } };
    }
    return { data: this.op === "select" || this.returning ? copy : null, error: null };
  }

  private async exec(mode: "many" | "maybe" | "single"): Promise<DbResult> {
    await Promise.resolve();
    await Promise.resolve();
    const fault = this.db.takeFault(this.table, this.op);
    if (fault) return { data: null, error: fault };
    const rows = this.db.rows(this.table);
    if (this.op === "select") return this.finish(rows.filter((r) => this.matches(r)), mode);
    if (this.op === "upsert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const done = list.map((row) => {
        const hit = rows.find((r) => r[this.conflict] != null && r[this.conflict] === row[this.conflict]);
        if (hit) { Object.assign(hit, row); return hit; }
        const full: Row = { ...defaultsFor(this.table), ...row };
        rows.push(full);
        return full;
      });
      this.db.writes.push({ table: this.table, op: "upsert", payload: this.payload });
      return this.finish(done, mode);
    }
    if (this.op === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const keys = this.db.unique[this.table] ?? [];
      for (const row of list) {
        for (const k of keys) {
          if (row[k] != null && rows.some((r) => r[k] === row[k])) {
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${this.table}_${k}_key"` } };
          }
        }
      }
      const inserted = list.map((row) => {
        const full: Row = { ...defaultsFor(this.table), ...row };
        rows.push(full);
        this.db.writes.push({ table: this.table, op: "insert", payload: { ...full } });
        return full;
      });
      return this.finish(inserted, mode);
    }
    if (this.op === "update") {
      const hit = rows.filter((r) => this.matches(r));
      for (const r of hit) Object.assign(r, this.payload as Row);
      if (hit.length) this.db.writes.push({ table: this.table, op: "update", payload: this.payload });
      return this.finish(hit, mode);
    }
    const gone = rows.filter((r) => this.matches(r));
    this.db.tables[this.table] = rows.filter((r) => !this.matches(r));
    if (gone.length) this.db.writes.push({ table: this.table, op: "delete", payload: gone.map((r) => ({ ...r })) });
    return this.finish(gone, mode);
  }
}

function defaultsFor(table: string): Row {
  const now = new Date().toISOString();
  seq++;
  switch (table) {
    case "resume_analyses":
      return { id: `ra-${seq}`, share_id: hex(24), created_at: now, expires_at: new Date(Date.now() + 90 * 864e5).toISOString() };
    case "product_deliveries":
      return { id: `pd-${seq}`, created_at: now, retry_count: 0, max_retries: 3, status: "payment_received" };
    case "purchased_content":
      return { id: `pc-${seq}`, created_at: now };
    case "used_stripe_sessions":
      return { used_at: now, product_type: null, ip_address: null };
    case "pro_grants":
      // The real column defaults: a uuid id, unspent.
      return { id: `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`, created_at: now, consumed_at: null, revoked_at: null };
    case "company_claims":
      return { id: `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`, verify_token: `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`, status: "pending", created_at: now, verified_at: null };
    default:
      return {};
  }
}
