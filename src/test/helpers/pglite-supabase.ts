/**
 * A SUPABASE CLIENT WHOSE DATABASE IS A REAL POSTGRES (pglite).
 *
 * WHY THIS EXISTS. FakeDb answers RPCs with whatever a test hands it, so a
 * handler test proves the handler's half and assumes the database's. The
 * agents-api review (2026-10-05) found exactly that seam: the broker's loop and
 * the claim function each looked right alone, and together one packet held
 * every account's work, because the claim read funding by one key and the
 * broker by another. This client sends every rpc() to the migration's real
 * function and every from() to the real table — triggers included — so a
 * handler loaded with loadEdgeHandler runs end to end against the SQL that
 * ships.
 *
 * It speaks the slice of PostgREST the agent functions use: select with a
 * column list (or count/head), eq / is / in / not-is / gt / lt / order /
 * limit, insert / update / upsert / delete with returning, maybeSingle /
 * single, and rpc with named arguments (a set-returning function answers rows,
 * a scalar one its value — PostgREST's own rule). A jsonb column is sent as
 * JSON and an array column as an array, by the column's catalogue type.
 */
import type { PGlite } from "@electric-sql/pglite";

type Err = { code?: string; message: string };
export type Result = { data: unknown; error: Err | null; count?: number | null };

/** Every call a handler made, for assertions about what it asked. */
export type Call = { kind: "rpc" | "from" | "auth" | "storage" | "functions"; name: string; args?: unknown };

const ident = (s: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`pglite-supabase: refusing identifier ${s}`);
  return `"${s}"`;
};

export class PgSupabase {
  calls: Call[] = [];
  /** jwt -> user, for auth.getUser(). */
  tokens: Record<string, { id: string; email: string }> = {};
  /** auth.admin.getUserById answers this error once per listed id, then normally. */
  userLookupFaults = new Set<string>();
  /** rpc names that answer an error (PGRST-shaped) instead of running. */
  rpcFaults = new Map<string, Err>();
  private colTypes = new Map<string, Map<string, string>>();
  private fnShapes = new Map<string, { set: boolean }>();

  constructor(public db: PGlite) {}

  private async columns(table: string): Promise<Map<string, string>> {
    const hit = this.colTypes.get(table);
    if (hit) return hit;
    const { rows } = await this.db.query<{ column_name: string; data_type: string; udt_name: string }>(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    const m = new Map(rows.map((r) => [r.column_name, r.data_type === "ARRAY" ? `${r.udt_name.replace(/^_/, "")}[]` : r.udt_name]));
    this.colTypes.set(table, m);
    return m;
  }

  /** A parameter and its cast for a value bound for `col` of `table`. */
  async bind(table: string, col: string, v: unknown, params: unknown[]): Promise<string> {
    const t = (await this.columns(table)).get(col);
    if (!t) throw new Error(`pglite-supabase: ${table}.${col} does not exist`);
    if (v === null || v === undefined) { params.push(null); return `$${params.length}::${t}`; }
    if (t === "jsonb" || t === "json") { params.push(JSON.stringify(v)); return `$${params.length}::${t}`; }
    params.push(v);
    return `$${params.length}::${t}`;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; error: Err | null }> {
    try {
      const r = await this.db.query<Record<string, unknown>>(sql, params);
      return { rows: r.rows, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { rows: [], error: { code: err.code, message: String(err.message ?? e) } };
    }
  }

  from(table: string) {
    this.calls.push({ kind: "from", name: table });
    return new PgQuery(this, table);
  }

  rpc(name: string, args: Record<string, unknown> = {}) {
    this.calls.push({ kind: "rpc", name, args });
    const run = (async (): Promise<Result> => {
      await Promise.resolve();
      const fault = this.rpcFaults.get(name);
      if (fault) return { data: null, error: fault };
      let shape = this.fnShapes.get(name);
      if (!shape) {
        const { rows } = await this.db.query<{ set: boolean; typtype: string }>(
          `SELECT p.proretset AS set, t.typtype FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             JOIN pg_type t ON t.oid = p.prorettype WHERE n.nspname = 'public' AND p.proname = $1 LIMIT 1`, [name]);
        if (!rows.length) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } };
        shape = { set: rows[0].set || rows[0].typtype === "c" };
        this.fnShapes.set(name, shape);
      }
      const params: unknown[] = [];
      const named = Object.entries(args).map(([k, v]) => {
        params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
        return `${ident(k)} => $${params.length}`;
      });
      const sql = shape.set
        ? `SELECT * FROM public.${ident(name)}(${named.join(", ")})`
        : `SELECT public.${ident(name)}(${named.join(", ")}) AS v`;
      const { rows, error } = await this.run(sql, params);
      if (error) return { data: null, error };
      return { data: shape.set ? rows : (rows[0]?.v ?? null), error: null };
    })();
    const first = (r: Result): Result => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
    return Object.assign(run, { maybeSingle: () => run.then(first), single: () => run.then(first) });
  }

  auth = {
    getUser: async (jwt?: string) => {
      this.calls.push({ kind: "auth", name: "getUser" });
      const u = jwt ? this.tokens[jwt] : undefined;
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
    },
    admin: {
      getUserById: async (id: string) => {
        this.calls.push({ kind: "auth", name: "getUserById", args: id });
        if (this.userLookupFaults.delete(id)) return { data: { user: null }, error: { message: "lookup failed" } };
        const { rows } = await this.db.query<{ id: string; email: string }>(`SELECT id::text, email FROM auth.users WHERE id = $1::uuid`, [id]);
        return rows[0] ? { data: { user: rows[0] }, error: null } : { data: { user: null }, error: { message: "User not found" } };
      },
    },
  };

  storage = {
    createBucket: async () => ({ data: null, error: { message: "The resource already exists" } }),
    from: (_bucket: string) => ({
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/signed/${path}` }, error: null }),
    }),
  };

  functions = {
    invoke: async (name: string) => {
      this.calls.push({ kind: "functions", name });
      return { data: null, error: { message: `pglite-supabase: no function ${name} in tests` } };
    },
  };

  rpcCalls(name: string): Record<string, unknown>[] {
    return this.calls.filter((c) => c.kind === "rpc" && c.name === name).map((c) => c.args as Record<string, unknown>);
  }
}

type Filter = (params: unknown[]) => Promise<string>;

class PgQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private cols = "*";
  private head = false;
  private counting = false;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private conflict: string | null = null;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private returning = false;

  constructor(private c: PgSupabase, private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.cols = cols;
      this.head = opts?.head === true;
      this.counting = !!opts?.count;
    } else this.returning = true;
    return this;
  }
  insert(p: Record<string, unknown> | Record<string, unknown>[]) { this.op = "insert"; this.payload = p; return this; }
  update(p: Record<string, unknown>) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Record<string, unknown> | Record<string, unknown>[], o?: { onConflict?: string }) {
    this.op = "upsert"; this.payload = p; this.conflict = o?.onConflict ?? null; return this;
  }
  delete() { this.op = "delete"; return this; }
  private where(col: string, op: string, v: unknown) {
    this.filters.push(async (params) => `${ident(col)} ${op} ${await this.c.bind(this.table, col, v, params)}`);
    return this;
  }
  eq(col: string, v: unknown) { return this.where(col, "=", v); }
  gt(col: string, v: unknown) { return this.where(col, ">", v); }
  lt(col: string, v: unknown) { return this.where(col, "<", v); }
  gte(col: string, v: unknown) { return this.where(col, ">=", v); }
  lte(col: string, v: unknown) { return this.where(col, "<=", v); }
  is(col: string, v: null | boolean) {
    this.filters.push(async () => `${ident(col)} IS ${v === null ? "NULL" : v ? "TRUE" : "FALSE"}`);
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error(`pglite-supabase: not(${col}, ${op}) is not modelled`);
    this.filters.push(async () => `${ident(col)} IS NOT NULL`);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push(async (params) => {
      if (!vals.length) return "false";
      const parts: string[] = [];
      for (const v of vals) parts.push(await this.c.bind(this.table, col, v, params));
      return `${ident(col)} IN (${parts.join(", ")})`;
    });
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.orders.push(`${ident(col)} ${o?.ascending === false ? "DESC" : "ASC"}`); return this; }
  limit(n: number) { this.lim = n; return this; }

  maybeSingle(): Promise<Result> { return this.exec("maybe"); }
  single(): Promise<Result> { return this.exec("single"); }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec("many").then(ok, no);
  }

  private async whereSql(params: unknown[]): Promise<string> {
    const parts: string[] = [];
    for (const f of this.filters) parts.push(await f(params));
    return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
  }

  private async exec(mode: "many" | "maybe" | "single"): Promise<Result> {
    await Promise.resolve();
    const t = `public.${ident(this.table)}`;
    const params: unknown[] = [];
    let sql: string;
    if (this.op === "select") {
      const list = this.cols.trim() === "*" ? "*" : this.cols.split(",").map((s) => ident(s.trim())).join(", ");
      if (this.counting && this.head) {
        sql = `SELECT count(*)::int AS n FROM ${t}${await this.whereSql(params)}`;
        const { rows, error } = await this.c.run(sql, params);
        return { data: null, error, count: error ? null : Number(rows[0]?.n ?? 0) };
      }
      sql = `SELECT ${list} FROM ${t}${await this.whereSql(params)}`
        + (this.orders.length ? ` ORDER BY ${this.orders.join(", ")}` : "")
        + (this.lim !== null ? ` LIMIT ${Math.floor(this.lim)}` : "");
    } else if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
      const rowsSql: string[] = [];
      for (const r of list) {
        const vals: string[] = [];
        for (const k of keys) vals.push(await this.c.bind(this.table, k, r[k], params));
        rowsSql.push(`(${vals.join(", ")})`);
      }
      sql = `INSERT INTO ${t} (${keys.map(ident).join(", ")}) VALUES ${rowsSql.join(", ")}`;
      if (this.op === "upsert") {
        const target = this.conflict
          ? this.conflict.split(",").map((s) => ident(s.trim()))
          : await this.primaryKey();
        const sets = keys.filter((k) => !target.includes(ident(k))).map((k) => `${ident(k)} = EXCLUDED.${ident(k)}`);
        sql += ` ON CONFLICT (${target.join(", ")}) ` + (sets.length ? `DO UPDATE SET ${sets.join(", ")}` : "DO NOTHING");
      }
      sql += " RETURNING *";
    } else if (this.op === "update") {
      const sets: string[] = [];
      for (const [k, v] of Object.entries(this.payload ?? {})) sets.push(`${ident(k)} = ${await this.c.bind(this.table, k, v, params)}`);
      sql = `UPDATE ${t} SET ${sets.join(", ")}${await this.whereSql(params)} RETURNING *`;
    } else {
      sql = `DELETE FROM ${t}${await this.whereSql(params)} RETURNING *`;
    }
    const { rows, error } = await this.c.run(sql, params);
    if (error) return { data: null, error };
    const returns = this.op === "select" || this.returning;
    if (mode === "maybe") {
      if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "more than one row" } };
      return { data: returns ? (rows[0] ?? null) : null, error: null };
    }
    if (mode === "single") {
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: `${rows.length} rows` } };
    }
    return { data: returns ? rows : null, error: null };
  }

  private async primaryKey(): Promise<string[]> {
    const { rows } = await this.c.db.query<{ attname: string }>(
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary`, [`public.${this.table}`]);
    return rows.map((r) => ident(r.attname));
  }
}
