// @vitest-environment node
/**
 * A SCAN CREDIT IS SPENT ONLY BY WHOEVER PROVED THE PURCHASE.
 *
 * Defect sweep 2026-10-02: 1.26 (the credit reader and spender were open to
 * the publishable key), 2.07 (the scanner spent the credits of whatever
 * address the request body named, and a Pro subscriber's address gave
 * unlimited scans), 2.06 (a credit was spent before the cache lookup and the
 * model call and never given back).
 *
 * Run, not read. Migration 20261005120000 is applied to a real Postgres
 * (pglite) holding the three original credit functions with Supabase's
 * default grants, and the scanner's own credit module
 * (supabase/functions/_shared/scan-credits.ts) is driven against that same
 * database through a minimal client, with Stripe faked:
 *   - no client role can execute any credit function, the scanner's role can;
 *   - a purchase spends at most what it bought from its address's pool,
 *     however much the address holds;
 *   - a refund never lifts a balance above what was ever purchased;
 *   - a session id the database has never seen claimed costs no Stripe call;
 *   - a session is recorded once, read from the table afterwards, and never
 *     re-pointed at another address;
 *   - the signed-in account is reserved from first and refunded exactly.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { anonCan, authenticatedCan, migrationReplay } from "./helpers/function-acl";
import {
  creditsBoughtOf,
  grantFromStripe,
  parseCreditSessions,
  refundScanCredit,
  reserveScanCredit,
  resolveCreditSessions,
  scanCreditBalance,
  sessionHash,
  type CreditDb,
} from "../../supabase/functions/_shared/scan-credits";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILE = readdirSync(DIR).find((f) => f.startsWith("20261005120000_"))!;
const MIGRATION = readFileSync(resolve(DIR, FILE), "utf8");

let pg: PGlite;

/** The scanner's view of the database: service_role, through rpc() and from().select().in(). */
function creditDb(db: PGlite): CreditDb {
  const run = async (sql: string, params: unknown[]) => {
    try {
      await db.exec("SET ROLE service_role");
      const r = await db.query<Record<string, unknown>>(sql, params);
      return { data: r.rows as unknown, error: null };
    } catch (e) {
      return { data: null, error: { message: String(e) } };
    } finally {
      await db.exec("RESET ROLE");
    }
  };
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const names = Object.keys(args);
      const sql = `SELECT public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) AS v`;
      const r = await run(sql, names.map((n) => args[n]));
      return { data: r.error ? null : (r.data as Array<{ v: unknown }>)[0]?.v ?? null, error: r.error };
    },
    from: (table: string) => {
      let cols = "*";
      let filter: { col: string; vals: string[] } | null = null;
      const q = {
        select(c: string) { cols = c; return q; },
        in(col: string, vals: string[]) { filter = { col, vals }; return q; },
        then(ok: (v: { data: unknown; error: unknown }) => unknown, no?: (e: unknown) => unknown) {
          const f = filter;
          const sql = `SELECT ${cols} FROM public.${table}${f ? ` WHERE ${f.col} = ANY($1::text[])` : ""}`;
          return run(sql, f ? [f.vals] : []).then(ok, no);
        },
      };
      return q as unknown as ReturnType<CreditDb["from"]>;
    },
  };
}

const balanceOf = async (email: string) =>
  (await pg.query<{ c: number }>("SELECT credits_remaining AS c FROM public.user_scan_credits WHERE email = $1", [email])).rows[0]?.c;

beforeAll(async () => {
  pg = new PGlite();
  // service_role bypasses row level security on Supabase; so it does here.
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  // As production holds them before this file: the 2025-12-18 table and the
  // three functions, every one open to anon and authenticated directly.
  await pg.exec(`
    CREATE TABLE public.user_scan_credits (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      email text NOT NULL UNIQUE,
      credits_remaining integer NOT NULL DEFAULT 0,
      total_credits_purchased integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE public.user_scan_credits ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.user_scan_credits TO service_role;
    CREATE TABLE public.used_stripe_sessions (session_id text PRIMARY KEY, used_at timestamptz DEFAULT now(), ip_address text, product_type text);
    GRANT ALL ON public.used_stripe_sessions TO service_role;
    CREATE FUNCTION public.add_scan_credits(p_email text, p_credits integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased)
      VALUES (lower(trim(p_email)), p_credits, p_credits)
      ON CONFLICT (email) DO UPDATE SET credits_remaining = user_scan_credits.credits_remaining + p_credits,
        total_credits_purchased = user_scan_credits.total_credits_purchased + p_credits, updated_at = now();
      RETURN true;
    END $$;
    CREATE FUNCTION public.use_scan_credit(p_email text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      UPDATE public.user_scan_credits SET credits_remaining = credits_remaining - 1 WHERE email = lower(trim(p_email)) AND credits_remaining > 0;
      RETURN FOUND;
    END $$;
    CREATE FUNCTION public.get_scan_credits(p_email text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE v integer; BEGIN SELECT credits_remaining INTO v FROM public.user_scan_credits WHERE email = lower(trim(p_email)); RETURN coalesce(v, 0); END $$;
    GRANT EXECUTE ON FUNCTION public.add_scan_credits(text, integer) TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.use_scan_credit(text) TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.get_scan_credits(text) TO anon, authenticated, service_role;
  `);
  await pg.exec(`BEGIN;\n${MIGRATION}\nCOMMIT;`);
}, 120_000);

afterAll(async () => { await pg?.close(); });

const can = async (role: string, sig: string) =>
  (await pg.query<{ ok: boolean }>("SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS ok", [role, sig])).rows[0].ok;

describe("the migration, applied", () => {
  const SIGS = [
    "public.use_scan_credit(text)", "public.get_scan_credits(text)", "public.add_scan_credits(text,integer)",
    "public.scan_credit_grant_record(text,text,text,integer)", "public.scan_credit_redeem(text,text)",
    "public.scan_credit_refund(text,text)", "public.scan_credit_balance(text,text[])", "public.scan_credit_grants_bought(text[])",
  ];

  it("closes every credit function to both client roles and keeps it for the scanner's role", async () => {
    for (const sig of SIGS) {
      expect(await can("anon", sig), `anon can execute ${sig}`).toBe(false);
      expect(await can("authenticated", sig), `authenticated can execute ${sig}`).toBe(false);
      expect(await can("service_role", sig), `service_role lost ${sig}`).toBe(true);
    }
  });

  it("refuses the publishable key's old drain call outright", async () => {
    await pg.exec("INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased) VALUES ('victim@example.com', 9, 9)");
    await pg.exec("SET ROLE anon");
    await expect(pg.query("SELECT public.use_scan_credit('victim@example.com')")).rejects.toThrow(/permission denied/);
    await expect(pg.query("SELECT public.get_scan_credits('victim@example.com')")).rejects.toThrow(/permission denied/);
    await pg.exec("RESET ROLE");
    expect(await balanceOf("victim@example.com")).toBe(9);
  });

  it("the replay of every migration in order agrees: no credit function reaches a client role", () => {
    const { fns } = migrationReplay();
    for (const sig of SIGS) {
      const f = fns.get(sig);
      expect(f, `${sig} missing from the replay`).toBeTruthy();
      expect(anonCan(f!) || authenticatedCan(f!), `${sig} is client-callable in the replay`).toBe(false);
    }
  });

  it("keeps the purchase table closed to client roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await pg.query<{ ok: boolean }>(
        "SELECT has_table_privilege($1, 'public.scan_credit_session_grants', 'SELECT') OR has_table_privilege($1, 'public.scan_credit_session_grants', 'INSERT') AS ok", [role]);
      expect(r.rows[0].ok, role).toBe(false);
    }
  });
});

describe("the scanner's credit module against that database", () => {
  const stripeCalls: string[] = [];
  const stripe = (sessions: Record<string, unknown>): typeof fetch => (async (url: string | URL | Request) => {
    const id = decodeURIComponent(String(url).split("/checkout/sessions/")[1].split("?")[0]);
    stripeCalls.push(id);
    const s = sessions[id];
    return new Response(JSON.stringify(s ?? { error: "no such session" }), { status: s ? 200 : 404 });
  }) as unknown as typeof fetch;

  it("reads the credited address and the count the way the verifiers do", () => {
    expect(creditsBoughtOf({ metadata: { credits: "25" }, line_items: { data: [{ quantity: 25 }] } })).toBe(25);
    expect(creditsBoughtOf({ line_items: { data: [{ quantity: 7 }] } })).toBe(7);
    expect(creditsBoughtOf({ metadata: { product_type: "career_bundle" } })).toBe(75);
    expect(grantFromStripe({ payment_status: "unpaid", metadata: { product_type: "scan_pack", customer_email: "a@b.co" } })).toBeNull();
    expect(grantFromStripe({ payment_status: "paid", metadata: { product_type: "premium_package", customer_email: "a@b.co" } })).toBeNull();
    expect(parseCreditSessions(["cs_live_abcdefghijk", "nope", "cs_live_abcdefghijk", 42])).toEqual(["cs_live_abcdefghijk"]);
  });

  it("a purchase made 'as' a rich address spends only what it bought, and a guessed id costs no Stripe call", async () => {
    const db = creditDb(pg);
    // The victim's own purchases: 9 credits (from the test above).
    // The attacker buys ONE credit at checkout typing the victim's address.
    await pg.exec("SELECT public.add_scan_credits('victim@example.com', 1)");
    await pg.exec("INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ('cs_test_attackerbuysone', 'scan_pack')");
    const fetchImpl = stripe({
      cs_test_attackerbuysone: { id: "cs_test_attackerbuysone", payment_status: "paid", customer_email: "victim@example.com", metadata: { product_type: "scan_pack", credits: "1" } },
    });
    const opts = { stripeKey: "sk_test_x", fetchImpl };

    const first = await reserveScanCredit(db, { accountEmail: null, sessionIds: ["cs_test_attackerbuysone", "cs_test_guessedbyattacker"] }, opts);
    expect(first?.via).toBe("purchase");
    expect(stripeCalls, "only the claimed session may reach Stripe").toEqual(["cs_test_attackerbuysone"]);
    expect(await balanceOf("victim@example.com")).toBe(9);

    // The purchase is spent: nothing more, however much the address holds.
    stripeCalls.length = 0;
    const second = await reserveScanCredit(db, { accountEmail: null, sessionIds: ["cs_test_attackerbuysone"] }, opts);
    expect(second).toBeNull();
    expect(stripeCalls, "a recorded purchase is read from the table, not Stripe").toEqual([]);
    expect(await balanceOf("victim@example.com")).toBe(9);
    expect(await scanCreditBalance(db, { accountEmail: null, sessionHashes: [await sessionHash("cs_test_attackerbuysone")] })).toBe(0);
  });

  it("a recorded purchase is never re-pointed at another address", async () => {
    const db = creditDb(pg);
    const hash = await sessionHash("cs_test_attackerbuysone");
    const { data } = await db.rpc("scan_credit_grant_record", { p_session_hash: hash, p_email: "someone@else.com", p_product_type: "scan_pack", p_credits_bought: 50 });
    expect(data).toBe(false);
    const grants = await resolveCreditSessions(db, ["cs_test_attackerbuysone"], { stripeKey: "" });
    expect(grants.map((g) => g.email)).toEqual(["victim@example.com"]);
  });

  it("the signed-in account is reserved first, and a refund gives back exactly what was taken", async () => {
    const db = creditDb(pg);
    await pg.exec("SELECT public.add_scan_credits('owner@example.com', 2)");
    const hold = await reserveScanCredit(db, { accountEmail: "Owner@Example.com", sessionIds: [] }, { stripeKey: "" });
    expect(hold).toEqual({ email: "owner@example.com", sessionHash: null, via: "account" });
    expect(await balanceOf("owner@example.com")).toBe(1);
    expect(await refundScanCredit(db, hold)).toBe(true);
    expect(await balanceOf("owner@example.com")).toBe(2);
    // A stray second refund cannot mint a credit.
    expect(await refundScanCredit(db, hold)).toBe(false);
    expect(await balanceOf("owner@example.com")).toBe(2);
  });

  it("an account with nothing proven gets no credit (and the scan is refused, not given away)", async () => {
    const db = creditDb(pg);
    expect(await reserveScanCredit(db, { accountEmail: null, sessionIds: [] }, { stripeKey: "" })).toBeNull();
    expect(await reserveScanCredit(db, { accountEmail: "nobody@example.com", sessionIds: [] }, { stripeKey: "" })).toBeNull();
  });
});
