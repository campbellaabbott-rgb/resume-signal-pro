// BEFORE THE WHO-MAY-APPLY COLUMNS EXIST (OD16 review, 2026-11-19).
//
// The OD16 reads name three columns of job_board_postings: closes_at
// (20261111100000), and who_may_apply and hiring_paths (20261119110000, the
// migration job-board .104 carries). JOB_FIELDS selects all three, the federal
// gate binds who_may_apply on every direct read, and the change feed and the
// two statement reads select them. PostgREST answers a read that names a
// column the table does not have with 42703, so a public-api build deployed
// before that migration is applied would answer 500 on every /v1/jobs,
// /v1/jobs/{id}, /application and /v1/changes read, for every vendor, not only
// the federal one.
//
// So the client public-api reads through is wrapped here. A read of
// job_board_postings is built on the real client exactly as before, and its
// calls are recorded beside it. When the database refuses it for one of those
// three columns, the same read is sent once more in the shape /v1 served
// before OD16: the three columns left out of the select, and every filter or
// or() that names one of them replaced by source <> 'usajobs'. That keeps
// every U.S. federal row out,
// which is exactly what the federal gate gives a row whose who-may-apply
// statement is not stored (and none is, while the column is missing); every
// other vendor's rows are served as before. Every fence the read carried
// (withdrawn, the serving window, the redistribution boundary) is sent again
// unchanged.
//
// The isolate remembers the miss for ten minutes and reads in the old shape
// meanwhile, so a missing column costs one extra round trip per isolate per
// ten minutes, and the migration is picked up without a deploy once it lands.
//
// Pure apart from the injected client, so the Node suite runs it on a fake.

/** The columns the OD16 reads name that an older table does not have. */
export const FEDERAL_COLUMNS = ["closes_at", "who_may_apply", "hiring_paths"] as const;

/** The table whose reads name them. Every other table is read as it always was. */
const POSTINGS = "job_board_postings";

/** The vendor whose rows the old shape keeps out (federal-rows.ts FEDERAL_SOURCE; this module imports nothing). */
const FEDERAL = "usajobs";

/** How long an isolate reads in the old shape after a miss before asking again. */
export const FEDERAL_COLUMNS_RECHECK_MS = 600_000;

let missingAt = 0;

/** Whether this isolate saw a federal column missing within the last ten minutes. */
export function federalColumnsKnownMissing(now = Date.now()): boolean {
  return missingAt > 0 && now - missingAt < FEDERAL_COLUMNS_RECHECK_MS;
}

const namesFederalColumn = (text: string): boolean =>
  FEDERAL_COLUMNS.some((c) => new RegExp(`(^|[^a-z_])${c}([^a-z_]|$)`).test(text));

/**
 * A read refused because one of the three columns is not on the table yet:
 * Postgres's undefined-column error (42703), or PostgREST's schema-cache miss,
 * naming one of them. Any other error is left to the caller as it was.
 */
export function isMissingFederalColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const text = `${String(e.message ?? "")} ${String(e.details ?? "")} ${String(e.hint ?? "")}`;
  const code = String(e.code ?? "");
  const missing = code === "42703" || code === "PGRST204" || /does not exist|schema cache/i.test(text);
  return missing && namesFederalColumn(text);
}

/** A select list with the three columns left out (never empty: id stands in). */
export function withoutFederalColumns(cols: string): string {
  const kept = cols.split(",").map((c) => c.trim()).filter((c) => c && !namesFederalColumn(c));
  return kept.length ? kept.join(",") : "id";
}

type Call = [string, unknown[]];
// deno-lint-ignore no-explicit-any
type Builder = any;

/** A filter call that names one of the three columns, which the old shape sends as source <> 'usajobs'. */
function namesFederalFilter(method: string, args: unknown[]): boolean {
  if (method === "or") return namesFederalColumn(String(args[0] ?? ""));
  return typeof args[0] === "string" && namesFederalColumn(args[0]);
}

/**
 * Each call of a read in the old shape, in order (null drops it): the select
 * without the three columns, no ordering by one, and every filter naming one
 * replaced by a single source <> 'usajobs'. Every other call, each fence
 * among them, is sent as it was.
 */
function oldShaper(): (call: Call) => Call | null {
  let fenced = false;
  return ([method, args]) => {
    if (method === "select") return ["select", [withoutFederalColumns(String(args[0] ?? "*")), ...args.slice(1)]];
    if (method === "order" && typeof args[0] === "string" && namesFederalColumn(args[0])) return null;
    if (namesFederalFilter(method, args)) {
      if (fenced) return null;
      fenced = true;
      return ["neq", ["source", FEDERAL]];
    }
    return [method, args];
  };
}

/**
 * A read of the postings table. Built on the real client as it is built (in
 * the old shape when this isolate already knows the columns are missing), and
 * recorded, so a refusal for a missing column can send it again in the old
 * shape.
 */
function recordedRead(client: { from: (t: string) => Builder }, table: string, onMiss: (e: unknown) => void): Builder {
  const calls: Call[] = [];
  const known = federalColumnsKnownMissing();
  const shape = known ? oldShaper() : null;
  let live: Builder = client.from(table);
  const send = async (): Promise<unknown> => {
    const first = await live;
    if (known) return first;
    const err = (first as { error?: unknown } | null)?.error;
    if (!isMissingFederalColumn(err)) return first;
    missingAt = Date.now();
    onMiss(err);
    const again = oldShaper();
    let b: Builder = client.from(table);
    for (const call of calls) {
      const c = again(call);
      if (c) b = b[c[0]](...c[1]);
    }
    return await b;
  };
  let sent: Promise<unknown> | null = null;
  const once = () => (sent ??= send());
  const proxy: Builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok?: (v: unknown) => unknown, no?: (e: unknown) => unknown) => once().then(ok, no);
      if (prop === "catch") return (no?: (e: unknown) => unknown) => once().catch(no);
      if (prop === "finally") return (f?: () => void) => once().finally(f);
      if (typeof prop !== "string") return undefined;
      // Every builder method (select, the filters, order, range, limit,
      // maybeSingle, single, ...) is applied to the real read, recorded, and
      // returns this same read, as supabase-js's own builders return themselves.
      return (...args: unknown[]) => {
        calls.push([prop, args]);
        const c: Call | null = shape ? shape([prop, args]) : [prop, args];
        if (c) live = live[c[0]](...c[1]);
        return proxy;
      };
    },
  });
  return proxy;
}

/**
 * The client public-api reads through: every table but job_board_postings,
 * and every rpc, exactly as the real client answers them; job_board_postings
 * through recordedRead above.
 */
export function federalColumnTolerant<C extends { from: (t: string) => Builder }>(
  client: C,
  onMiss: (e: unknown) => void = (e) =>
    console.warn(
      "[PUBLIC-API] job_board_postings has no who_may_apply yet (20261119110000 not applied): serving no U.S. federal row:",
      String((e as { message?: unknown } | null)?.message ?? "").slice(0, 120),
    ),
): C {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "from") {
        return (table: string) => (table === POSTINGS ? recordedRead(target, table, onMiss) : target.from(table));
      }
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
