/**
 * A PERMISSIVE STAND-IN FOR THE SUPABASE CLIENT, FOR HANDLERS WHOSE QUERIES ARE
 * TOO VARIED FOR FakeDb.
 *
 * Every builder method is accepted and RECORDED, in order, per query; a query
 * resolves when awaited (or on maybeSingle/single) to whatever `answer` returns
 * for it, by default an empty result. So a test can run a real handler path
 * (the board's list, with its dozens of builder calls) and then assert on the
 * calls it made -- the range it asked for, the rpc arguments, the rows it
 * wrote -- without modelling PostgREST.
 */
export type Call = [method: string, args: unknown[]];
export type Query = { table: string; rpc: string | null; calls: Call[]; mode: "many" | "maybe" | "single" };
export type Answer = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };

export class ProxyDb {
  queries: Query[] = [];
  answer: (q: Query) => Answer | undefined = () => undefined;

  private build(q: Query): unknown {
    const settle = (mode: Query["mode"]) => {
      q.mode = mode;
      return Promise.resolve().then(() => {
        const a = this.answer(q);
        if (a) return { count: null, ...a };
        return { data: mode === "many" ? [] : null, error: null, count: 0 };
      });
    };
    const proxy: unknown = new Proxy(function () {}, {
      get: (_t, prop) => {
        if (prop === "then") return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => settle("many").then(ok, no);
        if (prop === "maybeSingle") return () => settle("maybe");
        if (prop === "single") return () => settle("single");
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => { q.calls.push([prop, args]); return proxy; };
      },
    });
    return proxy;
  }

  from(table: string) {
    const q: Query = { table, rpc: null, calls: [], mode: "many" };
    this.queries.push(q);
    return this.build(q);
  }

  rpc(name: string, args: Record<string, unknown> = {}) {
    const q: Query = { table: "", rpc: name, calls: [["rpc", [args]]], mode: "many" };
    this.queries.push(q);
    return this.build(q);
  }

  /** Queries on `table` whose calls include `method`. */
  on(table: string, method?: string): Query[] {
    return this.queries.filter((q) => q.table === table && (!method || q.calls.some(([m]) => m === method)));
  }

  /** Calls to rpc `name`, by their argument object. */
  rpcArgs(name: string): Record<string, unknown>[] {
    return this.queries.filter((q) => q.rpc === name).map((q) => q.calls[0][1][0] as Record<string, unknown>);
  }
}

/** The first argument of the query's first call to `method`, or undefined. */
export const argOf = (q: Query, method: string, i = 0): unknown => q.calls.find(([m]) => m === method)?.[1][i];
/** Does the query filter `col` = `val` with .eq? */
export const eqs = (q: Query, col: string, val: unknown): boolean => q.calls.some(([m, a]) => m === "eq" && a[0] === col && a[1] === val);
