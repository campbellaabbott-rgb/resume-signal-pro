// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE CHANGE FEED SERVED A DOUBTED BATCH AS A CLOSURE.
 *
 * Register 1.70 / L13-56. The collector stamps a closure batch `suspect` when
 * one pass removed so much of a board that the likelier story is our own
 * failed read (20260906090000). /v1/changes selected closures without that
 * column, so every such row reached a paying consumer as outcome "closed" —
 * live jobs marked closed — while the response note promised the remainder
 * reconciled with the published daily figures.
 *
 * The owner's decision (2026-10-07): leave those batches out by default; an
 * explicit include_suspect=true returns them marked suspectBatch:true.
 *
 * Run against the shipped public-api handler with only its database faked: the
 * fake applies every filter the handler sends, so a row the handler forgets to
 * exclude comes back in the response exactly as it would from PostgREST.
 *
 * The takedown ticker's own catalogue description said the same thing from the
 * other side ("the feed does not expose the flag ... will count higher"); its
 * correction (20261008140000) is applied in a real Postgres (pglite) after the
 * description it replaces.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { splitStatements } from "./helpers/function-acl";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

type Row = Record<string, unknown>;

/** The slice of the PostgREST builder /v1/changes uses, applied for real. */
class Query implements PromiseLike<{ data: Row[]; error: null }> {
  private preds: Array<(r: Row) => boolean> = [];
  private orders: Array<[string, boolean]> = [];
  private max = Infinity;
  selected: string[] = [];
  constructor(private rows: Row[], private log: Array<{ table: string; q: Query }>, public table: string) {
    log.push({ table, q: this });
  }
  select(cols: string) { this.selected = cols.split(","); return this; }
  is(col: string, v: unknown) { this.preds.push((r) => (r[col] ?? null) === v); return this; }
  eq(col: string, v: unknown) { this.preds.push((r) => r[col] === v); return this; }
  gte(col: string, v: string) { this.preds.push((r) => String(r[col]) >= v); return this; }
  not(col: string, op: string, list: string) {
    if (op !== "in") throw new Error(`fake: not.${op}`);
    const vals = list.replace(/^\(|\)$/g, "").split(",");
    this.preds.push((r) => !vals.includes(String(r[col])));
    return this;
  }
  or(expr: string) {
    const m = /^(\w+)\.gt\.(.+?),and\(\1\.eq\.\2,(\w+)\.gt\.(.+)\)$/.exec(expr);
    if (!m) throw new Error(`fake: or(${expr})`);
    const [, a, av, b, bv] = m;
    const gt = (x: unknown, y: string) => (typeof x === "number" ? x > Number(y) : String(x) > y);
    this.preds.push((r) => String(r[a]) > av || (String(r[a]) === av && gt(r[b], bv)));
    return this;
  }
  order(col: string, o: { ascending: boolean }) { this.orders.push([col, o.ascending]); return this; }
  limit(n: number) { this.max = n; return this; }
  then<A, B = never>(ok?: ((v: { data: Row[]; error: null }) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) {
    const out = this.rows.filter((r) => this.preds.every((p) => p(r))).sort((x, y) => {
      for (const [c, asc] of this.orders) {
        const d = x[c] === y[c] ? 0 : (x[c] as string | number) < (y[c] as string | number) ? -1 : 1;
        if (d) return asc ? d : -d;
      }
      return 0;
    }).slice(0, this.max).map((r) => {
      const o: Row = {};
      for (const c of this.selected) o[c] = r[c];
      return o;
    });
    return Promise.resolve({ data: out, error: null as null }).then(ok, no);
  }
}

const STUBS: Record<string, string> = {
  "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__apiDb; }",
};

let handler: EdgeHandler;
let closures: Row[];
let queries: Array<{ table: string; q: Query }>;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const closure = (event_id: number, closedHoursAgo: number, extra: Row = {}): Row => ({
  event_id, posting_id: `greenhouse:acme:${event_id}`, source: "greenhouse", company_token: "acme", company: "Acme",
  title: `Role ${event_id}`, category: "engineering", first_seen: hoursAgo(400), posted_at: hoursAgo(400),
  closed_at: hoursAgo(closedHoursAgo), superseded: false, absence_basis: "full_read", suspect: false, ...extra,
});

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("public-api", STUBS);
}, 120_000);

beforeEach(() => {
  queries = [];
  closures = [
    closure(101, 30),
    // One pass took most of the board down: the collector doubted it.
    closure(102, 20, { suspect: true, company_token: "flaky", company: "Flaky Corp" }),
    closure(103, 20, { suspect: true, company_token: "flaky", company: "Flaky Corp" }),
    closure(104, 10, { superseded: true }),
    closure(105, 5),
  ];
  const tables: Record<string, Row[]> = { job_board_closures: closures, job_board_postings: [] };
  (globalThis as Record<string, unknown>).__apiDb = {
    rpc: (name: string) => {
      const data = name === "api_key_check"
        ? { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }
        : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r });
    },
    from: (t: string) => new Query(tables[t] ?? [], queries, t),
  };
});

type ChangesBody = {
  closed: Row[];
  suspectBatchesIncluded: boolean;
  note: string;
  page: { closed: { hasMore: boolean; nextCursor: string } };
  error: { code: string };
};

async function changes(qs: string) {
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/public-api/v1/changes?since=${encodeURIComponent(hoursAgo(48))}${qs}`, {
    headers: { authorization: "Bearer rb_live_harness" },
  }));
  return { status: res.status, body: await res.json() as ChangesBody };
}

describe("the change feed leaves out the batches its collector doubted", () => {
  it("a default walk serves no doubted row, marks every row it serves, and says which feed it is", async () => {
    const r = await changes("");
    expect(r.status).toBe(200);
    const ids = (r.body.closed as Row[]).map((c) => c.event_id);
    expect(ids, "a doubted batch must not reach a consumer as a closure").toEqual([101, 104, 105]);
    for (const c of r.body.closed as Row[]) expect(c.suspectBatch).toBe(false);
    expect(r.body.suspectBatchesIncluded).toBe(false);
    // The re-list is still named, not dropped: only the doubted batch is left out.
    expect((r.body.closed as Row[]).find((c) => c.event_id === 104)?.outcome).toBe("relisted");
    // The raw column is not served beside the named field.
    expect((r.body.closed as Row[]).some((c) => "suspect" in c)).toBe(false);
    expect(String(r.body.note)).toMatch(/include_suspect=true/);
  });

  it("a cursor walk of the default feed steps over the doubted rows instead of serving them on page two", async () => {
    const seen: unknown[] = [];
    let cursor = "";
    for (let page = 0; page < 6; page++) {
      const r = await changes(`&limit=1${cursor ? `&closed_cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      seen.push(...(r.body.closed as Row[]).map((c) => c.event_id));
      if (!r.body.page.closed.hasMore) break;
      cursor = r.body.page.closed.nextCursor;
    }
    expect(seen).toEqual([101, 104, 105]);
  });

  it("include_suspect=true returns the doubted rows, each marked, in their place in the log", async () => {
    const r = await changes("&include_suspect=true");
    expect(r.status).toBe(200);
    const rows = r.body.closed as Row[];
    expect(rows.map((c) => c.event_id)).toEqual([101, 102, 103, 104, 105]);
    expect(rows.filter((c) => c.suspectBatch === true).map((c) => c.event_id)).toEqual([102, 103]);
    expect(r.body.suspectBatchesIncluded).toBe(true);
  });

  it("include_suspect=false is the default walk, and anything else is refused rather than read as either", async () => {
    const off = await changes("&include_suspect=false");
    expect(off.status).toBe(200);
    expect((off.body.closed as Row[]).map((c) => c.event_id)).toEqual([101, 104, 105]);
    for (const v of ["1", "yes", "TRUE", ""]) {
      const r = await changes(`&include_suspect=${v}`);
      expect(r.status, `include_suspect=${v}`).toBe(400);
      expect(r.body.error.code).toBe("invalid_value");
    }
  });
});

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const migration = (prefix: string) => readFileSync(resolve(MIG_DIR, readdirSync(MIG_DIR).find((f) => f.startsWith(prefix))!), "utf8");

describe("the takedown ticker's description stops saying the feed counts higher", () => {
  const OPEN: PGlite[] = [];
  afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

  /** The ticker's signature, described exactly as 20261002113617 left it. */
  async function boot(): Promise<PGlite> {
    const db = new PGlite();
    OPEN.push(db);
    await db.exec("CREATE FUNCTION public.get_takedowns_today() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;");
    const before = splitStatements(migration("20261002113617_"))
      .find((st) => /^\s*COMMENT ON FUNCTION public\.get_takedowns_today\(\)/.test(st));
    expect(before, "the description being replaced").toBeTruthy();
    await db.exec(`${before};`);
    return db;
  }
  const describeOf = async (db: PGlite) =>
    (await db.query<{ d: string }>("SELECT obj_description('public.get_takedowns_today()'::regprocedure, 'pg_proc') AS d")).rows[0].d;

  it("names the feed's default and its opt-in, and keeps every other sentence word for word", async () => {
    const db = await boot();
    const old = await describeOf(db);
    await db.exec(migration("20261008140000_"));
    const now = await describeOf(db);
    expect(now).toMatch(/include_suspect=true/);
    expect(now).not.toMatch(/does not expose the flag/);
    // Only the sentence about the feed changed: what precedes it and the
    // absence-basis paragraph after it are the old text, unchanged.
    const head = (t: string) => t.slice(0, t.indexOf("rate was a fraction of that.") + "rate was a fraction of that.".length);
    const tail = (t: string) => t.slice(t.indexOf("ADMITTED ABSENCE BASES"));
    expect(head(now)).toBe(head(old));
    expect(tail(now)).toBe(tail(old));
    // Safe to re-run.
    await db.exec(migration("20261008140000_"));
    expect(await describeOf(db)).toBe(now);
  });

  it("refuses to report success against a database without the function", async () => {
    const db = new PGlite();
    OPEN.push(db);
    await expect(db.exec(migration("20261008140000_"))).rejects.toThrow();
  });
});
