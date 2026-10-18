// @vitest-environment node
//
// Node, not jsdom: the migration runs in pglite, from Supabase's default grants.
/**
 * PRO RENEWS ONLY WITH THE BUYER'S OWN TICK, AND THE TICK IS ON RECORD (owner
 * decision 2026-10-17; California's automatic renewal law, B&P 17600 and
 * following, as amended by AB 2863).
 *
 * WHAT WAS WRONG. Pro renews every month until cancelled. The card showed the
 * renewal sentence beside the Terms line, and nothing asked for, or kept, the
 * buyer's separate consent to automatic renewal.
 *
 * WHAT HOLDS NOW, on the shipped handler (with a seller named, so the gate
 * does not answer first) and the shipped migration:
 *   - a Pro checkout without autoRenewConsent: true is a 400 that says which
 *     box, in the buyer's language, and asks Stripe for nothing; it carries no
 *     consentRequired field, which a page would read as the EU switch;
 *   - with it, the session and the subscription carry the wording's version
 *     and the time, and pro_auto_renew_consents keeps one row for the
 *     session (account, wording version, Terms version, price, interval,
 *     time) before the browser has the url;
 *   - a consent that cannot be recorded expires the session and answers 503:
 *     no url, so no plan is sold without its consent on file;
 *   - 20261011151000 runs twice, ends with its own self-check, and leaves the
 *     table to service_role alone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { agentDb, migration } from "./helpers/agent-db";
import { AUTO_RENEW_CONSENT_VERSION, autoRenewConsentOf } from "../../supabase/functions/_shared/auto-renew-consent";
import { TERMS_VERSION } from "../../supabase/functions/_shared/checkout-policy";

const BUYER = { id: "00000000-0000-4000-8000-00000000a501", email: "buyer@example.com" };
const M = "20261011151000_a_pro_plan_renews_only_for_a_buyer_whose_consent_is_on_record.sql";
let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-subscription-checkout"]);
}, 240_000);
beforeEach(() => {
  world = freshWorld({ "jwt-buyer": BUYER });
});

const subscribe = (body: Record<string, unknown>) =>
  post(h["create-subscription-checkout"], "create-subscription-checkout", { language: "en", termsVersion: TERMS_VERSION, ...body }, { bearer: "jwt-buyer" });

describe("a Pro checkout without the renewal box ticked", () => {
  for (const [name, body] of [["no field", {}], ["false", { autoRenewConsent: false }], ["a string", { autoRenewConsent: "true" }]] as const) {
    it(`${name}: 400 auto_renew_consent_required, and Stripe is asked nothing`, async () => {
      const res = await subscribe(body);
      expect(res.status).toBe(400);
      const out = await res.json();
      expect(out).toMatchObject({ reason: "auto_renew_consent_required", autoRenewConsentRequired: true });
      expect(out.error).toMatch(/renews automatically every month until you cancel/);
      expect(out.error).toMatch(/Nothing was charged/);
      expect(out, "a page reads consentRequired as the EU switch being on").not.toHaveProperty("consentRequired");
      expect(world.stripe.touched).toEqual([]);
      expect(world.db.rows("pro_auto_renew_consents")).toEqual([]);
    });
  }

  it("the refusal is in the buyer's language", async () => {
    const out = await (await subscribe({ language: "pt" })).json();
    expect(out.language).toBe("pt");
    expect(out.error).toMatch(/renovado automaticamente/);
  });
});

describe("a Pro checkout with the box ticked", () => {
  it("the session and the subscription carry the consent, and the row is kept before the url is returned", async () => {
    const before = Date.now();
    const res = await subscribe({ autoRenewConsent: true });
    expect(res.status).toBe(200);
    const { url, sessionId } = await res.json();
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const s = world.stripe.created[0] as { metadata: Record<string, string>; subscription_data: { metadata: Record<string, string> } };
    expect(s.metadata.auto_renew_consent).toBe(AUTO_RENEW_CONSENT_VERSION);
    expect(s.subscription_data.metadata.auto_renew_consent).toBe(AUTO_RENEW_CONSENT_VERSION);
    const at = Date.parse(s.metadata.auto_renew_consented_at);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(s.subscription_data.metadata.auto_renew_consented_at).toBe(s.metadata.auto_renew_consented_at);
    expect(world.db.rows("pro_auto_renew_consents")).toEqual([
      expect.objectContaining({
        stripe_session_id: sessionId,
        user_id: BUYER.id,
        renewal_terms_version: AUTO_RENEW_CONSENT_VERSION,
        terms_version: TERMS_VERSION,
        price_cents: 4500,
        renewal_interval: "month",
        consented_at: s.metadata.auto_renew_consented_at,
      }),
    ]);
  });

  it("a consent that cannot be recorded expires the session and answers 503 with no url", async () => {
    world.db.faults.push({ table: "pro_auto_renew_consents", op: "upsert", error: { code: "42P01", message: "relation does not exist" } });
    const res = await subscribe({ autoRenewConsent: true });
    expect(res.status).toBe(503);
    const out = await res.json();
    expect(out.url).toBeUndefined();
    expect(out.retryable).toBe(true);
    expect(world.stripe.created).toHaveLength(1);
    expect(world.stripe.touched, "the session whose consent was not kept is expired").toContain("sessions.expire:cs_test_w4b0001");
    expect(world.db.rows("checkout_buyers"), "no buyer row for a session that was expired").toEqual([]);
  });

  it("the page's field is read only as the literal true", () => {
    expect(autoRenewConsentOf({ autoRenewConsent: true })).toBe(true);
    for (const v of [1, "true", "yes", null, undefined, false]) expect(autoRenewConsentOf({ autoRenewConsent: v }), String(v)).toBe(false);
    expect(autoRenewConsentOf(null)).toBe(false);
  });
});

describe("20261011151000 (pro_auto_renew_consents)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await agentDb({ seed: `INSERT INTO auth.users (id, email) VALUES ('${BUYER.id}', '${BUYER.email}');` });
    await db.exec(migration(M));
    // Safe twice: the staged runner re-stages files.
    await db.exec(migration(M));
  }, 240_000);
  afterAll(async () => { await db?.close(); });

  it("leaves the table to service_role alone, with row level security on", async () => {
    const priv = async (role: string, p: string) =>
      (await db.query<{ ok: boolean }>(`SELECT has_table_privilege('${role}', 'public.pro_auto_renew_consents', '${p}') AS ok`)).rows[0].ok;
    for (const role of ["anon", "authenticated"]) for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(await priv(role, p), `${role} ${p}`).toBe(false);
    for (const p of ["SELECT", "INSERT"]) expect(await priv("service_role", p), `service_role ${p}`).toBe(true);
    expect((await db.query<{ r: boolean }>(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public.pro_auto_renew_consents'::regclass`)).rows[0].r).toBe(true);
  });

  it("keeps a row as the checkout writes it, and refuses one with no wording version or a session id that is not Stripe's", async () => {
    await db.exec(`INSERT INTO public.pro_auto_renew_consents (stripe_session_id, user_id, renewal_terms_version, terms_version, price_cents, renewal_interval, consented_at)
                   VALUES ('cs_test_w4b0001', '${BUYER.id}', '${AUTO_RENEW_CONSENT_VERSION}', '${TERMS_VERSION}', 4500, 'month', now())`);
    const fails = async (sql: string) => { try { await db.exec(sql); return false; } catch { return true; } };
    expect(await fails(`INSERT INTO public.pro_auto_renew_consents (stripe_session_id, renewal_terms_version, price_cents, consented_at) VALUES ('cs_test_w4b0002', 'soon', 4500, now())`)).toBe(true);
    expect(await fails(`INSERT INTO public.pro_auto_renew_consents (stripe_session_id, renewal_terms_version, price_cents, consented_at) VALUES ('not-a-session', '2026-10-17', 4500, now())`)).toBe(true);
    expect(await fails(`INSERT INTO public.pro_auto_renew_consents (stripe_session_id, renewal_terms_version, price_cents) VALUES ('cs_test_w4b0003', '2026-10-17', 4500)`), "the time is required").toBe(true);
  });

  it("deleting the account keeps the record without the account", async () => {
    await db.exec(`DELETE FROM auth.users WHERE id = '${BUYER.id}'`);
    const row = (await db.query<{ user_id: string | null }>(`SELECT user_id FROM public.pro_auto_renew_consents WHERE stripe_session_id = 'cs_test_w4b0001'`)).rows[0];
    expect(row).toEqual({ user_id: null });
  });
});
