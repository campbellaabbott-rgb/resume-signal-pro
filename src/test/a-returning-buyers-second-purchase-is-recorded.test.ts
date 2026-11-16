// @vitest-environment node
/**
 * A RETURNING BUYER'S SECOND PURCHASE IS RECORDED (S14X-153), AND THE
 * FUNCTION CAN ASK WHETHER A PURCHASE IS ONE THE SITE SOLD (S14X-154).
 *
 * WHAT WAS WRONG. track_ab_event_optimized refused a conversion it had seen
 * from the same visitor, test and variant inside ninety days. A purchase is a
 * conversion, so a buyer's second purchase within ninety days was answered
 * "duplicate" in the funnel's purchase_completed stage, in
 * product_conversion and in every A/B test: one sale where the payment side
 * took two. The sign-in funnel, sent as conversions, counted a person once
 * for ninety days.
 *
 * WHAT HOLDS NOW, in a real Postgres (pglite) that starts from Supabase's
 * default grants, with the tables lifted from the migrations that created
 * them and the writer's definitions applied in stamp order:
 *   - a second Stripe session forty days after the first is recorded, in the
 *     funnel and in product_conversion;
 *   - the same session sent again is a repeat, from any visitor;
 *   - a conversion with no Stripe session keeps the ninety-day visitor
 *     window, and the funnel's own tab id is never read as a purchase;
 *   - a sign-in a day later is recorded again;
 *   - ab_purchase_known says yes only for a session checkout_starts or
 *     used_stripe_sessions holds;
 *   - neither function can be executed by anon or authenticated;
 *   - the migration runs twice cleanly and its self-check leaves no row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const read = (name: string) => readFileSync(resolve(MIGRATIONS, name), "utf8");
const defines = (fn: string) => (name: string) =>
  new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").test(sqlCodeOf(read(name)));

/** The window fix of 2026-09-27: the writer every later definition replaces. */
const BASE_WRITER = "20260927202451_";
/** Every file from the base writer on that defines the writer or the purchase check, in stamp order. */
const CHAIN = FILES.filter((n) => n >= BASE_WRITER && (defines("track_ab_event_optimized")(n) || defines("ab_purchase_known")(n)));
const LIVE_HELPER = FILES.filter(defines("ab_purchase_known")).pop();

function tableDdl(stampPrefix: string, table: string): string {
  const file = FILES.find((n) => n.startsWith(stampPrefix));
  if (!file) throw new Error(`no migration starts with ${stampPrefix}`);
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${table} \\([\\s\\S]*?\\);`).exec(sqlCodeOf(read(file)));
  if (!m) throw new Error(`${file} does not create ${table}`);
  return m[0];
}

/** Supabase's defaults: anon and authenticated get every new table and function unless a file takes them back. */
const SUPABASE_DEFAULTS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

async function boot(files: string[]): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SUPABASE_DEFAULTS);
  await db.exec(tableDdl("20251216002238", "rate_limits"));
  await db.exec(tableDdl("20251217181914", "ab_test_events"));
  await db.exec(tableDdl("20260927211436", "checkout_starts"));
  await db.exec(tableDdl("20251216023523", "used_stripe_sessions"));
  for (const f of files) await db.exec(read(f));
  return db;
}

type Call = { test: string; variant: string; type?: string; visitor: string; metadata?: Record<string, unknown> };

async function track(db: PGlite, c: Call): Promise<string> {
  const r = await db.query<{ status: string }>(
    "SELECT public.track_ab_event_optimized($1, $2, $3, $4, $5::jsonb, '203.0.113.53', 1800, 60)->>'status' AS status",
    [c.test, c.variant, c.type ?? "conversion", c.visitor, JSON.stringify(c.metadata ?? {})],
  );
  return r.rows[0].status;
}

async function plant(db: PGlite, c: Call, age: string): Promise<void> {
  await db.query(
    "INSERT INTO public.ab_test_events (test_name, variant, event_type, visitor_id, metadata, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, now() - $6::interval)",
    [c.test, c.variant, c.type ?? "conversion", c.visitor, JSON.stringify(c.metadata ?? {}), age],
  );
}

const FUNNEL = { test: "conversion_funnel", variant: "purchase_completed" };
const PRODUCT = { test: "product_conversion", variant: "fullAnalysis" };

describe("under the writer before this round (pglite)", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot([FILES.find((n) => n.startsWith(BASE_WRITER))!]); });

  it("TEETH: a buyer's second Stripe session forty days after the first was answered duplicate", async () => {
    await plant(db, { ...FUNNEL, visitor: "v-teeth", metadata: { stripeSessionId: "cs_test_A" } }, "40 days");
    expect(await track(db, { ...FUNNEL, visitor: "v-teeth", metadata: { stripeSessionId: "cs_test_B" } })).toBe("duplicate");
  });
});

describe("under the live writer: the base writer, then every later definition (pglite)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await boot(CHAIN);
    await plant(db, { ...FUNNEL, visitor: "v-buyer", metadata: { stripeSessionId: "cs_test_A" } }, "40 days");
    await plant(db, { ...PRODUCT, visitor: "v-buyer", metadata: { sessionId: "cs_test_A", productId: "fullAnalysis" } }, "40 days");
  });

  it("finds a definition after the base writer, and one of ab_purchase_known", () => {
    expect(CHAIN.length, "no migration after the 2026-09-27 window fix redefines the writer").toBeGreaterThanOrEqual(2);
    expect(LIVE_HELPER, "no migration defines ab_purchase_known").toBeDefined();
  });

  it("records a returning buyer's second purchase in the funnel and in product_conversion", async () => {
    expect(await track(db, { ...FUNNEL, visitor: "v-buyer", metadata: { stripeSessionId: "cs_test_B" } })).toBe("recorded");
    expect(await track(db, { ...PRODUCT, visitor: "v-buyer", metadata: { sessionId: "cs_test_B", productId: "fullAnalysis" } })).toBe("recorded");
    const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.ab_test_events WHERE visitor_id = 'v-buyer'");
    expect(r.rows[0].n).toBe(4);
  });

  it("answers the same purchase sent again as a repeat, whoever sends it", async () => {
    expect(await track(db, { ...FUNNEL, visitor: "v-buyer", metadata: { stripeSessionId: "cs_test_B" } })).toBe("duplicate");
    expect(await track(db, { ...FUNNEL, visitor: "v-other-browser", metadata: { stripeSessionId: "cs_test_B" } })).toBe("duplicate");
    expect(await track(db, { ...PRODUCT, visitor: "v-other-browser", metadata: { sessionId: "cs_test_B" } })).toBe("duplicate");
  });

  it("holds a session for longer than ninety days", async () => {
    await plant(db, { ...FUNNEL, visitor: "v-old", metadata: { stripeSessionId: "cs_live_OLD" } }, "200 days");
    expect(await track(db, { ...FUNNEL, visitor: "v-old", metadata: { stripeSessionId: "cs_live_OLD" } })).toBe("duplicate");
  });

  it("keeps the ninety-day visitor window for a conversion with no Stripe session", async () => {
    await plant(db, { test: "share_scorecard", variant: "download", visitor: "v-share" }, "10 days");
    expect(await track(db, { test: "share_scorecard", variant: "download", visitor: "v-share" })).toBe("duplicate");
    await plant(db, { test: "share_scorecard", variant: "copy", visitor: "v-share" }, "91 days");
    expect(await track(db, { test: "share_scorecard", variant: "copy", visitor: "v-share" })).toBe("recorded");
  });

  it("never reads the funnel's own tab id as a purchase", async () => {
    await plant(db, { ...FUNNEL, visitor: "v-tab", metadata: { sessionId: "cs_test_TAB" } }, "10 days");
    expect(await track(db, { ...FUNNEL, visitor: "v-tab", metadata: { sessionId: "cs_test_TAB2" } })).toBe("duplicate");
  });

  it("records a sign-in a day later, and holds one inside the day", async () => {
    await plant(db, { test: "auth_funnel", variant: "signin_success", visitor: "v-auth-25h" }, "25 hours");
    await plant(db, { test: "auth_funnel", variant: "signin_success", visitor: "v-auth-23h" }, "23 hours");
    expect(await track(db, { test: "auth_funnel", variant: "signin_success", visitor: "v-auth-25h" })).toBe("recorded");
    expect(await track(db, { test: "auth_funnel", variant: "signin_success", visitor: "v-auth-23h" })).toBe("duplicate");
  });

  it("keeps the view window at a day", async () => {
    await plant(db, { test: "conversion_funnel", variant: "landing_view", type: "view", visitor: "v-view" }, "23 hours");
    expect(await track(db, { test: "conversion_funnel", variant: "landing_view", type: "view", visitor: "v-view" })).toBe("duplicate");
  });

  it("ab_purchase_known says yes only for a session the site minted or redeemed", async () => {
    await db.exec(`INSERT INTO public.checkout_starts (stripe_session_id, product_type, checkout_function) VALUES ('cs_test_MINTED', 'full_analysis', 'create-checkout')`);
    await db.exec(`INSERT INTO public.used_stripe_sessions (session_id) VALUES ('cs_live_REDEEMED')`);
    const known = async (s: string | null) =>
      (await db.query<{ k: boolean }>("SELECT public.ab_purchase_known($1) AS k", [s])).rows[0].k;
    expect(await known("cs_test_MINTED")).toBe(true);
    expect(await known("cs_live_REDEEMED")).toBe(true);
    expect(await known("cs_test_NEVER")).toBe(false);
    expect(await known("pro_cs_test_MINTED")).toBe(false);
    expect(await known("")).toBe(false);
    expect(await known(null)).toBe(false);
  });

  it("closes both functions to anon and authenticated and opens them to service_role", async () => {
    for (const sig of [
      "public.track_ab_event_optimized(text, text, text, text, jsonb, text, integer, integer)",
      "public.ab_purchase_known(text)",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await db.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig]);
        expect(r.rows[0].ok, `${role} may execute ${sig}`).toBe(false);
      }
      const s = await db.query<{ ok: boolean }>("SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok", [sig]);
      expect(s.rows[0].ok, `service_role may not execute ${sig}`).toBe(true);
    }
  });

  it("runs again cleanly, and its self-check leaves no row behind", async () => {
    await db.exec(read(LIVE_HELPER!));
    const r = await db.query<{ n: number }>(
      "SELECT (SELECT count(*) FROM public.ab_test_events WHERE test_name = 'rb_self_check') + (SELECT count(*) FROM public.rate_limits WHERE ip_address = 'rb-self-check') AS n",
    );
    expect(Number(r.rows[0].n)).toBe(0);
    const p = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'track_ab_event_optimized'");
    expect(p.rows[0].n, "a second overload of the writer").toBe(1);
  });
});
