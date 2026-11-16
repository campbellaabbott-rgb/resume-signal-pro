// @vitest-environment node
/**
 * A PULSE GOES ONCE A CALENDAR MONTH (S14X-238).
 *
 * WHAT WAS WRONG. market_pulse_claim_batch took any confirmed row 28 days
 * after its last pulse, and two jobs call it (the daily one, and in
 * production one on the 1st). A pulse on the 1st and the next on the 29th
 * is two in one month, and a 28-day rhythm is thirteen a year for a list
 * that promises a monthly mail. An address that came back after an
 * unsubscribe was told "the first pulse arrives within a day" whatever it had
 * already been sent.
 *
 * WHAT HOLDS NOW:
 *   - migration 20261112160000 re-issues the claim as (p_limit, p_now): a row
 *     is claimed only when it never had a pulse, or its last one is over 28
 *     days old AND in an earlier calendar month (UTC); the one-argument form
 *     is gone and a call naming p_limit alone still resolves (pglite, from
 *     Supabase's default grants, with the file's own self-check run);
 *   - the confirm answer adds nextPulse when the address's last pulse was too
 *     recent for the next run (the shipped handler, its clock pinned).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { rows } from "./helpers/mail-door-db";
import { bootMailListsDb, migrationText, MAIL_LISTS_PREFIX } from "./helpers/mail-lists-db";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";

let pg: PGlite;
beforeAll(async () => { pg = await bootMailListsDb(); }, 90_000);
afterAll(async () => { await pg?.close(); });

const AT = "2026-03-30T12:00:00Z";
async function claim(at = AT): Promise<string[]> {
  return (await rows<{ cl_email: string }>(pg, "SELECT cl_email FROM public.market_pulse_claim_batch(200, $1::timestamptz) ORDER BY 1", [at])).map((r) => r.cl_email);
}

describe("the claim", () => {
  it("refuses a row already sent this calendar month, though 28 days have passed, and takes one sent last month", async () => {
    await pg.exec(`DELETE FROM public.market_pulse_subscribers;
      INSERT INTO public.market_pulse_subscribers (email, industry, confirmed_at, last_sent_at) VALUES
        ('same-month@example.com', 'technology', '2026-01-01', '2026-03-01T12:00:00Z'),
        ('last-month@example.com', 'technology', '2026-01-01', '2026-02-27T12:00:00Z'),
        ('never@example.com', 'technology', '2026-01-01', NULL),
        ('too-soon@example.com', 'technology', '2026-01-01', '2026-03-10T12:00:00Z');`);
    expect(await claim()).toEqual(["last-month@example.com", "never@example.com"]);
    const [stamp] = await rows<{ last_sent_at: Date }>(pg, "SELECT last_sent_at FROM public.market_pulse_subscribers WHERE email = 'last-month@example.com'");
    expect(new Date(stamp.last_sent_at).toISOString()).toBe("2026-03-30T12:00:00.000Z");
  });

  it("the row it refused in March goes on 1 April, and not again in April", async () => {
    expect(await claim("2026-04-01T09:00:00Z")).toEqual(["same-month@example.com"]);
    expect(await claim("2026-04-29T15:47:00Z"), "a second pulse in April").not.toContain("same-month@example.com");
  });

  it("at most twelve a year, however often both jobs run", async () => {
    await pg.exec(`DELETE FROM public.market_pulse_subscribers;
      INSERT INTO public.market_pulse_subscribers (email, industry, confirmed_at) VALUES ('yearly@example.com', 'technology', '2026-01-01');`);
    let mails = 0;
    for (let d = Date.parse("2026-01-01T00:00:00Z"); d < Date.parse("2027-01-01T00:00:00Z"); d += 86_400_000) {
      for (const hour of ["T09:00:00Z", "T15:47:00Z"]) {
        mails += (await claim(new Date(d).toISOString().slice(0, 10) + hour)).length;
      }
    }
    expect(mails).toBe(12);
  }, 60_000);

  it("is one function, (p_limit, p_now), for service_role only, and a call naming p_limit alone still resolves", async () => {
    const sigs = await rows<{ args: string }>(pg, `SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'market_pulse_claim_batch'`);
    expect(sigs).toEqual([{ args: "p_limit integer, p_now timestamp with time zone" }]);
    const acl = await rows<{ anon: boolean; authn: boolean; service: boolean }>(pg, `SELECT
      has_function_privilege('anon', 'public.market_pulse_claim_batch(integer,timestamptz)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.market_pulse_claim_batch(integer,timestamptz)', 'EXECUTE') AS authn,
      has_function_privilege('service_role', 'public.market_pulse_claim_batch(integer,timestamptz)', 'EXECUTE') AS service`);
    expect(acl).toEqual([{ anon: false, authn: false, service: true }]);
    await expect(pg.query("SELECT * FROM public.market_pulse_claim_batch(p_limit => 1)")).resolves.toBeTruthy();
  });

  it("the file runs twice cleanly, its self-check included", async () => {
    await expect(pg.exec(migrationText(MAIL_LISTS_PREFIX))).resolves.toBeTruthy();
  });
});

// ── the confirm answer ───────────────────────────────────────────────────────

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const fake = new FakeDb();
let handler: EdgeHandler;
const TOKEN = "cd".repeat(32);

describe("the confirm answer", () => {
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
    g.__fakeSupabase = fake;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    handler = await loadEdgeHandler("send-market-pulse", {
      ...SELLER_SET_STUB,
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
      "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 'em' }, error: null }) }; } }",
    });
  }, 60_000);
  afterEach(() => { vi.useRealTimers(); fake.tables = {}; fake.writes = []; fake.rpcs = {}; });

  async function confirmAt(now: string, lastSentAt: string | null) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    fake.rpcs.mail_door_take = () => ({ data: true, error: null });
    fake.rpcs.market_pulse_confirm = () => ({ data: { cf_confirmed: true, cf_reason: "confirmed" }, error: null });
    fake.rows("market_pulse_subscribers").push({
      email: "back@example.com", locale: "en", confirmed_at: "2025-12-01T00:00:00Z", unsubscribed_at: "2026-03-02T00:00:00Z",
      confirm_token_hash: createHash("sha256").update(TOKEN).digest("hex"), confirm_sent_at: new Date(Date.parse(now) - 3_600_000).toISOString(), last_sent_at: lastSentAt,
    });
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/send-market-pulse", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ action: "confirm", token: TOKEN, language: "en" }),
    }));
    return res.json();
  }

  it("says next month when a pulse already went this month", async () => {
    expect(await confirmAt("2026-03-30T12:00:00Z", "2026-03-01T15:47:00Z")).toEqual({ success: true, confirmed: true, nextPulse: "next_month" });
  });

  it("says later this month when the last one went under four weeks ago, last month", async () => {
    expect(await confirmAt("2026-03-20T12:00:00Z", "2026-02-25T15:47:00Z")).toEqual({ success: true, confirmed: true, nextPulse: "later_this_month" });
  });

  it("says nothing more when the next run may send it, or none was ever sent", async () => {
    expect(await confirmAt("2026-03-30T12:00:00Z", "2026-02-27T15:47:00Z")).toEqual({ success: true, confirmed: true });
    fake.tables = {};
    expect(await confirmAt("2026-03-30T12:00:00Z", null)).toEqual({ success: true, confirmed: true });
  });
});
