// @vitest-environment node
/**
 * A SECOND CHECKOUT BY THE SAME VISITOR IS A SECOND ROW.
 *
 * The funnel writer answers a visitor's second event of a kind inside 24
 * hours with "duplicate", charges every event to a shared per-address budget
 * and can only be reached from a browser event that the navigation to Stripe
 * cancels. The server-side record of a checkout start has to be immune to all
 * three, and this file proves it against a real Postgres (pglite) with the
 * migration applied on top of the two tables it joins to:
 *
 *   1. The same Stripe session id twice writes one row: the first call
 *      answers true, the second false, and no error is raised.
 *   2. Two sessions for one visitor seconds apart are two rows; sixty starts
 *      in a burst are sixty rows -- nothing here has a window or a budget.
 *   3. A visitor id outside the funnel's 8-to-64 shape is stored as unknown
 *      and the start is kept; an origin with a query string is stored as its
 *      path; a start with no visitor is still a start.
 *   4. anon and authenticated can neither read the table nor call the writer
 *      (permission denied, not an empty answer), under the default
 *      privileges Supabase grants new objects to those roles; service_role
 *      can do both.
 *   5. THE JOIN. A paid session (a used_stripe_sessions row with the same
 *      id) reaches its start by equality on the session id, and the start
 *      reaches the visitor's landing_view in ab_test_events by visitor id --
 *      the query below is the documented join, run for real.
 *
 * TEETH. A second database boots the writer with its conflict clause cut: the
 * second call for the same id then raises a unique violation, which is the
 * failure the clause exists to prevent. A third boots the migration with the
 * revocations cut: anon can then read the table, which is what the grants
 * exist to prevent under Supabase's defaults.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";

// PGLITE BOOTS A POSTGRES AND REPLAYS MIGRATIONS, SO ITS HOOK IS NOT A UNIT
// TEST. The boot budget is the hook's; a hanging QUERY still fails on the
// smaller test budget.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8");

/** The LAST migration whose code matches: the live definition, never archaeology. */
function lastMatching(needle: RegExp): string {
  const hits = FILES.filter((f) => needle.test(sqlCodeOf(read(f))));
  if (!hits.length) throw new Error(`no migration matches ${needle}`);
  return hits[hits.length - 1];
}

const STARTS = lastMatching(/CREATE TABLE(?: IF NOT EXISTS)? public\.checkout_starts\s*\(/);
const USED = lastMatching(/CREATE TABLE public\.used_stripe_sessions\s*\(/);
const EVENTS = lastMatching(/CREATE TABLE public\.ab_test_events\s*\(/);

const WRITER_ARGS = "p_stripe_session_id => $1, p_checkout_function => $2, p_product_type => $3, p_product_id => $4, p_visitor_id => $5, p_amount_cents => $6, p_currency => $7, p_origin_path => $8, p_mode => $9, p_metadata => $10::jsonb";

type Row = Record<string, unknown>;

/**
 * Supabase's own shape: the three roles exist, service_role bypasses RLS,
 * and every new table and function in public is granted to anon,
 * authenticated and service_role by default -- which is exactly why a
 * migration has to REVOKE by name.
 */
async function boot(migration: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);
  await db.exec(read(USED));
  await db.exec(read(EVENTS));
  await db.exec(migration);
  return db;
}

async function record(db: PGlite, args: {
  session: string; fn?: string; product?: string; productId?: string | null; visitor?: string | null;
  amount?: number | null; currency?: string | null; page?: string | null; mode?: string | null; metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `SELECT public.record_checkout_start(${WRITER_ARGS}) AS ok`,
    [
      args.session, args.fn ?? "create-checkout", args.product ?? "full_analysis", args.productId ?? null,
      args.visitor === undefined ? "visitor-000000001" : args.visitor, args.amount ?? 500, args.currency ?? "usd",
      args.page === undefined ? "/" : args.page, args.mode ?? "payment", JSON.stringify(args.metadata ?? {}),
    ],
  );
  return r.rows[0].ok;
}

const count = async (db: PGlite, where = "true", params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.checkout_starts WHERE ${where}`, params)).rows[0].n);

/** Runs a statement as a role and reports the error message, or null when it succeeded. */
async function asRole(db: PGlite, role: string, sql: string, params: unknown[] = []): Promise<{ rows: Row[]; error: string | null }> {
  await db.exec(`SET ROLE ${role}`);
  try {
    const r = await db.query<Row>(sql, params);
    return { rows: r.rows, error: null };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  } finally {
    await db.exec("RESET ROLE");
  }
}

let db: PGlite;
const dbs: PGlite[] = [];

beforeAll(async () => {
  db = await boot(read(STARTS));
  dbs.push(db);
});

afterAll(async () => {
  for (const d of dbs) await d.close();
});

describe("keyed on the session id, and on nothing else", () => {
  it("the same session id twice is one row: true, then false, no error", async () => {
    expect(await record(db, { session: "cs_live_same_twice_0001" })).toBe(true);
    expect(await record(db, { session: "cs_live_same_twice_0001" })).toBe(false);
    expect(await count(db, "stripe_session_id = $1", ["cs_live_same_twice_0001"])).toBe(1);
  });

  it("two sessions for one visitor seconds apart are two rows", async () => {
    expect(await record(db, { session: "cs_live_twice_a", visitor: "visitor-twice-0001" })).toBe(true);
    expect(await record(db, { session: "cs_live_twice_b", visitor: "visitor-twice-0001" })).toBe(true);
    expect(await count(db, "visitor_id = $1", ["visitor-twice-0001"])).toBe(2);
  });

  it("sixty starts in a burst are sixty rows -- no window, no budget", async () => {
    for (let i = 0; i < 60; i++) {
      expect(await record(db, { session: `cs_live_burst_${String(i).padStart(3, "0")}`, visitor: "visitor-burst-0001" })).toBe(true);
    }
    expect(await count(db, "visitor_id = $1", ["visitor-burst-0001"])).toBe(60);
  });
});

describe("what is stored", () => {
  it("a visitor id outside 8 to 64 characters is unknown and the start is kept", async () => {
    expect(await record(db, { session: "cs_live_shape_short", visitor: "short" })).toBe(true);
    expect(await record(db, { session: "cs_live_shape_long", visitor: "v".repeat(65) })).toBe(true);
    expect(await record(db, { session: "cs_live_shape_edge", visitor: "v".repeat(64) })).toBe(true);
    expect(await record(db, { session: "cs_live_shape_none", visitor: null })).toBe(true);
    const rows = (await db.query<Row>(
      "SELECT stripe_session_id, visitor_id FROM public.checkout_starts WHERE stripe_session_id LIKE 'cs_live_shape_%' ORDER BY 1",
    )).rows;
    expect(rows).toEqual([
      { stripe_session_id: "cs_live_shape_edge", visitor_id: "v".repeat(64) },
      { stripe_session_id: "cs_live_shape_long", visitor_id: null },
      { stripe_session_id: "cs_live_shape_none", visitor_id: null },
      { stripe_session_id: "cs_live_shape_short", visitor_id: null },
    ]);
  });

  it("an origin is reduced to its path; something that is not a path is unknown", async () => {
    await record(db, { session: "cs_live_path_query", page: "/pricing?utm_source=x&plan=pro#top" });
    await record(db, { session: "cs_live_path_bare", page: "pricing" });
    await record(db, { session: "cs_live_path_long", page: "/" + "a".repeat(400) });
    await record(db, { session: "cs_live_path_none", page: null });
    const rows = (await db.query<Row>(
      "SELECT stripe_session_id, origin_path FROM public.checkout_starts WHERE stripe_session_id LIKE 'cs_live_path_%' ORDER BY 1",
    )).rows;
    expect(rows).toEqual([
      { stripe_session_id: "cs_live_path_bare", origin_path: null },
      { stripe_session_id: "cs_live_path_long", origin_path: "/" + "a".repeat(199) },
      { stripe_session_id: "cs_live_path_none", origin_path: null },
      { stripe_session_id: "cs_live_path_query", origin_path: "/pricing" },
    ]);
  });

  it("the product, the amount and the minting function are stored as given; the currency lower-cased", async () => {
    await record(db, { session: "cs_live_fields", fn: "create-product-checkout", product: "premium_package", productId: "premiumPackage", amount: 4500, currency: "USD", mode: "payment", metadata: { language: "en" } });
    const row = (await db.query<Row>("SELECT * FROM public.checkout_starts WHERE stripe_session_id = $1", ["cs_live_fields"])).rows[0];
    expect(row).toMatchObject({
      checkout_function: "create-product-checkout", product_type: "premium_package", product_id: "premiumPackage",
      amount_cents: 4500, currency: "usd", mode: "payment", metadata: { language: "en" },
    });
  });

  it("a missing session id or product type is refused loudly rather than stored as junk", async () => {
    await expect(record(db, { session: "short" })).rejects.toThrow(/session id/);
    await expect(record(db, { session: "cs_live_no_product", product: "" })).rejects.toThrow(/product type/);
    expect(await count(db, "stripe_session_id = $1", ["cs_live_no_product"])).toBe(0);
  });
});

describe("who may touch it", () => {
  it("anon can neither read the table nor call the writer: permission denied, not an empty answer", async () => {
    const readTable = await asRole(db, "anon", "SELECT stripe_session_id FROM public.checkout_starts LIMIT 1");
    expect(readTable.error).toMatch(/permission denied for table checkout_starts/);
    const call = await asRole(db, "anon", `SELECT public.record_checkout_start(${WRITER_ARGS})`,
      ["cs_live_anon_attempt", "create-checkout", "full_analysis", null, null, null, null, null, null, "{}"]);
    expect(call.error).toMatch(/permission denied for function record_checkout_start/);
    expect(await count(db, "stripe_session_id = $1", ["cs_live_anon_attempt"])).toBe(0);
  });

  it("authenticated is refused the same way", async () => {
    const readTable = await asRole(db, "authenticated", "SELECT stripe_session_id FROM public.checkout_starts LIMIT 1");
    expect(readTable.error).toMatch(/permission denied for table checkout_starts/);
    const call = await asRole(db, "authenticated", `SELECT public.record_checkout_start(${WRITER_ARGS})`,
      ["cs_live_auth_attempt", "create-checkout", "full_analysis", null, null, null, null, null, null, "{}"]);
    expect(call.error).toMatch(/permission denied for function record_checkout_start/);
  });

  it("service_role can call the writer and read the rows", async () => {
    const call = await asRole(db, "service_role", `SELECT public.record_checkout_start(${WRITER_ARGS}) AS ok`,
      ["cs_live_service_ok", "create-checkout", "full_analysis", null, "visitor-service-001", 500, "usd", "/", "payment", "{}"]);
    expect(call.error).toBeNull();
    expect(call.rows[0]).toEqual({ ok: true });
    const readTable = await asRole(db, "service_role", "SELECT visitor_id FROM public.checkout_starts WHERE stripe_session_id = $1", ["cs_live_service_ok"]);
    expect(readTable.error).toBeNull();
    expect(readTable.rows).toEqual([{ visitor_id: "visitor-service-001" }]);
  });
});

describe("the join: a paid session reaches its start, and the start reaches the landing", () => {
  const JOIN = `
    SELECT cs.stripe_session_id,
           cs.visitor_id,
           cs.origin_path,
           cs.product_type,
           u.session_id      AS paid_session,
           u.product_type    AS paid_product,
           landing.page      AS landing_page
    FROM public.checkout_starts cs
    JOIN public.used_stripe_sessions u
      ON u.session_id = cs.stripe_session_id
    LEFT JOIN LATERAL (
      SELECT e.metadata->>'page' AS page
      FROM public.ab_test_events e
      WHERE e.test_name = 'conversion_funnel'
        AND e.variant = 'landing_view'
        AND e.visitor_id = cs.visitor_id
        AND e.created_at <= cs.created_at
      ORDER BY e.created_at DESC
      LIMIT 1
    ) landing ON true
    WHERE cs.stripe_session_id = $1`;

  it("runs for real over the three tables", async () => {
    // used_stripe_sessions carries product_type since 20260827180000; the
    // pglite lane replays only its CREATE, so the column is added here the
    // way that migration adds it.
    await db.exec("ALTER TABLE public.used_stripe_sessions ADD COLUMN IF NOT EXISTS product_type text");
    await db.exec(`
      INSERT INTO public.ab_test_events (test_name, variant, event_type, visitor_id, metadata, created_at)
      VALUES ('conversion_funnel', 'landing_view', 'view', 'visitor-join-000001', '{"page": "/pricing"}', now() - interval '10 minutes'),
             ('conversion_funnel', 'landing_view', 'view', 'visitor-join-000001', '{"page": "/agents"}',  now() - interval '3 days');
    `);
    await record(db, { session: "cs_live_join_paid", visitor: "visitor-join-000001", product: "pro_subscription", fn: "create-subscription-checkout", page: "/pricing?plan=pro" });
    await record(db, { session: "cs_live_join_unpaid", visitor: "visitor-join-000001", product: "pro_subscription", fn: "create-subscription-checkout", page: "/pricing" });
    await db.query("INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ($1, $2)", ["cs_live_join_paid", "pro_subscription"]);

    const paid = (await db.query<Row>(JOIN, ["cs_live_join_paid"])).rows;
    expect(paid).toEqual([{
      stripe_session_id: "cs_live_join_paid",
      visitor_id: "visitor-join-000001",
      origin_path: "/pricing",
      product_type: "pro_subscription",
      paid_session: "cs_live_join_paid",
      paid_product: "pro_subscription",
      landing_page: "/pricing",
    }]);
    expect((await db.query<Row>(JOIN, ["cs_live_join_unpaid"])).rows, "a start that never paid does not join").toEqual([]);
  });
});

describe("teeth", () => {
  it("a writer without its conflict clause raises on the second call for the same id", async () => {
    const sql = read(STARTS);
    const cut = sql.replace(/\s*ON CONFLICT \(stripe_session_id\) DO NOTHING/, "");
    expect(cut).not.toBe(sql);
    const mutant = await boot(cut);
    dbs.push(mutant);
    expect(await record(mutant, { session: "cs_live_mutant_same" })).toBe(true);
    await expect(record(mutant, { session: "cs_live_mutant_same" })).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it("a migration without its revocations lets anon read the table under Supabase's defaults", async () => {
    const sql = read(STARTS);
    const cut = sql.replace(/REVOKE ALL ON TABLE public\.checkout_starts FROM (?:PUBLIC|anon|authenticated);\n/g, "");
    expect(cut).not.toBe(sql);
    const mutant = await boot(cut);
    dbs.push(mutant);
    const readTable = await asRole(mutant, "anon", "SELECT stripe_session_id FROM public.checkout_starts LIMIT 1");
    expect(readTable.error, "without the revocation the default grant lets anon in (RLS then hides rows, which is an empty answer, not a refusal)").toBeNull();
  });
});
