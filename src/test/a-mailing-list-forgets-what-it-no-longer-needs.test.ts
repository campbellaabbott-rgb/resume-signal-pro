// @vitest-environment node
/**
 * A MAILING LIST FORGETS WHAT IT NO LONGER NEEDS (S14X-102).
 *
 * WHAT WAS WRONG. An unsubscribe from the market pulse wrote unsubscribed_at
 * and kept everything else (the score the address gave, its field, its
 * language) for ever; requests nobody confirmed stayed for ever; data-API key
 * requests whose link expired unclicked stayed for ever; and every address we
 * ever mailed stayed in the send log for ever.
 *
 * WHAT HOLDS NOW:
 *   - both stops (the pulse mail's own POST, and account-settings pulse_off)
 *     write last_score null, locale null and industry 'general' (NOT NULL)
 *     with the stop (the shipped handlers, database faked);
 *   - migration 20261112160000's mail_lists_prune (service_role only, run
 *     daily as mail-lists-prune with its timeout in its own command) deletes
 *     pulse rows unconfirmed for 90 days and rows unsubscribed 90 days ago
 *     with no confirmation sent since, unconfirmed key requests that expired
 *     90 days ago, and withholds send-log recipients older than 90 days; the
 *     file also cleared the rows already off the list (pglite).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { bootMailListsDb, migrationText, MAIL_LISTS_PREFIX, rows } from "./helpers/mail-lists-db";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";

// ── 1. the stops ────────────────────────────────────────────────────────────

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const EMAIL = "owner@example.com";
const USER_ID = "00000000-0000-4000-8000-0000000c0102";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const SESSION = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const unsubToken = (email: string) => createHmac("sha256", SERVICE).update(email.toLowerCase()).digest().subarray(0, 16).toString("hex");

let db: FakeDb;
let pulse: EdgeHandler;
let settings: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__s102Db = () => ({
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: { getUser: async (token: string) => (token === SESSION ? { data: { user: { id: USER_ID, email: EMAIL, identities: [] } }, error: null } : { data: { user: null }, error: { message: "no" } }) },
  });
  g.fetch = async (u: string) => { throw new Error(`unexpected fetch ${u}`); };
  const supa = "export function createClient(...a) { return globalThis.__s102Db(...a); }";
  pulse = await loadEdgeHandler("send-market-pulse", { ...SELLER_SET_STUB, "https://esm.sh/@supabase/supabase-js@2": supa, "https://esm.sh/resend@2.0.0": "export class Resend {}" });
  settings = await loadEdgeHandler("account-settings", { "https://esm.sh/@supabase/supabase-js@2": supa });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: EMAIL });
  db.rows("market_pulse_subscribers").push({ email: EMAIL, industry: "data_science", last_score: 74, locale: "de", confirmed_at: "2026-10-02T00:00:00Z", unsubscribed_at: null });
});

const row = () => db.rows("market_pulse_subscribers").find((r) => r.email === EMAIL)!;

describe("a stop takes what the address gave", () => {
  it("the pulse mail's own unsubscribe", async () => {
    const res = await pulse(new Request(`https://harness.supabase.co/functions/v1/send-market-pulse?action=unsubscribe&email=${encodeURIComponent(EMAIL)}&token=${unsubToken(EMAIL)}`, { method: "POST" }));
    expect(await res.json()).toEqual({ unsubscribed: true });
    expect(row().unsubscribed_at).toBeTruthy();
    expect({ last_score: row().last_score, locale: row().locale, industry: row().industry }, "the stop kept the score, the language or the field")
      .toEqual({ last_score: null, locale: null, industry: "general" });
  });

  it("the account page's Stop", async () => {
    const res = await settings(new Request("https://harness.supabase.co/functions/v1/account-settings", {
      method: "POST", headers: { authorization: `Bearer ${SESSION}`, "content-type": "application/json" }, body: JSON.stringify({ action: "pulse_off" }),
    }));
    expect(await res.json()).toEqual({ unsubscribed: 1 });
    expect({ last_score: row().last_score, locale: row().locale, industry: row().industry }).toEqual({ last_score: null, locale: null, industry: "general" });
  });

  it("a language that cannot be cleared never costs the unsubscribe", async () => {
    let updates = 0;
    const realFrom = db.from.bind(db);
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = realFrom(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const update = q.update.bind(q);
      q.update = (p: unknown) => { if (++updates === 2) throw new Error("column \"locale\" does not exist"); return update(p); };
      return q;
    };
    const res = await pulse(new Request(`https://harness.supabase.co/functions/v1/send-market-pulse?action=unsubscribe&email=${encodeURIComponent(EMAIL)}&token=${unsubToken(EMAIL)}`, { method: "POST" }));
    expect(res.status).toBe(200);
    expect(row().unsubscribed_at).toBeTruthy();
  });
});

// ── 2. the prune ────────────────────────────────────────────────────────────

let pg: PGlite;
beforeAll(async () => { pg = await bootMailListsDb(); }, 90_000);
afterAll(async () => { await pg?.close(); });

const NOW = "2026-12-01T00:00:00Z";
const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

describe("mail_lists_prune", () => {
  it("deletes what is 91 days past its use and keeps what is 89, or still in use", async () => {
    await pg.query(`DELETE FROM public.market_pulse_subscribers`);
    await pg.query(`INSERT INTO public.market_pulse_subscribers (email, industry, subscribed_at, confirm_sent_at, confirmed_at, unsubscribed_at) VALUES
      ('unconfirmed-91@example.com', 'general', $1, $1, NULL, NULL),
      ('unconfirmed-89@example.com', 'general', $2, $2, NULL, NULL),
      ('live@example.com', 'technology', $3, $3, $3, NULL),
      ('off-91@example.com', 'general', $3, $3, $3, $1),
      ('off-asked-again@example.com', 'general', $3, $4, $3, $1)`,
    [ago(91), ago(89), ago(400), ago(10)]);
    await pg.query(`DELETE FROM public.api_key_requests`);
    await pg.query(`INSERT INTO public.api_key_requests (email, mailbox, token_hash, created_at, expires_at, confirmed_at) VALUES
      ('a@example.com', 'a@example.com', 'expired-91', $1, $1, NULL),
      ('b@example.com', 'b@example.com', 'confirmed-old', $2, $2, $2),
      ('c@example.com', 'c@example.com', 'expired-89', $3, $3, NULL)`, [ago(91), ago(200), ago(89)]);
    await pg.query(`DELETE FROM public.email_send_log`);
    await pg.query(`INSERT INTO public.email_send_log (template_name, recipient_email, status, created_at) VALUES
      ('digest', 'old@example.com', 'sent', $1), ('digest', 'recent@example.com', 'sent', $2)`, [ago(91), ago(89)]);

    const [out] = await rows<{ r: Record<string, number> }>(pg, "SELECT public.mail_lists_prune($1::timestamptz) AS r", [NOW]);
    expect(out.r).toEqual({ pulse_unconfirmed: 1, pulse_unsubscribed: 1, key_requests: 1, send_log_withheld: 1 });

    expect((await rows<{ email: string }>(pg, "SELECT email FROM public.market_pulse_subscribers ORDER BY 1")).map((r) => r.email))
      .toEqual(["live@example.com", "off-asked-again@example.com", "unconfirmed-89@example.com"]);
    expect((await rows<{ token_hash: string }>(pg, "SELECT token_hash FROM public.api_key_requests ORDER BY 1")).map((r) => r.token_hash))
      .toEqual(["confirmed-old", "expired-89"]);
    expect((await rows<{ recipient_email: string }>(pg, "SELECT recipient_email FROM public.email_send_log ORDER BY created_at")).map((r) => r.recipient_email))
      .toEqual(["withheld", "recent@example.com"]);
  });

  it("is for service_role alone, and runs daily with its timeout in its own command", async () => {
    const [acl] = await rows<{ anon: boolean; authn: boolean; service: boolean; definer: boolean }>(pg, `SELECT
      has_function_privilege('anon', 'public.mail_lists_prune(timestamptz)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.mail_lists_prune(timestamptz)', 'EXECUTE') AS authn,
      has_function_privilege('service_role', 'public.mail_lists_prune(timestamptz)', 'EXECUTE') AS service,
      (SELECT prosecdef FROM pg_proc WHERE oid = 'public.mail_lists_prune(timestamptz)'::regprocedure) AS definer`);
    expect(acl).toEqual({ anon: false, authn: false, service: true, definer: true });
    const jobs = await rows<{ schedule: string; command: string }>(pg, "SELECT schedule, command FROM cron.job WHERE jobname = 'mail-lists-prune'");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].command).toMatch(/^\s*SET statement_timeout = '[^']+';\s*SELECT public\.mail_lists_prune\(\);$/);
    expect(jobs[0].schedule.split(" ")).toHaveLength(5);
  });

  it("the file cleared the score, language and field of rows already off the list", async () => {
    await pg.query(`DELETE FROM public.market_pulse_subscribers`);
    await pg.query(`INSERT INTO public.market_pulse_subscribers (email, industry, last_score, locale, confirmed_at, unsubscribed_at) VALUES
      ('was-off@example.com', 'finance', 61, 'nl', now() - interval '30 days', now() - interval '3 days'),
      ('still-on@example.com', 'finance', 70, 'fr', now() - interval '30 days', NULL)`);
    await pg.exec(migrationText(MAIL_LISTS_PREFIX));
    expect(await rows(pg, "SELECT email, industry, last_score, locale FROM public.market_pulse_subscribers ORDER BY email")).toEqual([
      { email: "still-on@example.com", industry: "finance", last_score: 70, locale: "fr" },
      { email: "was-off@example.com", industry: "general", last_score: null, locale: null },
    ]);
  });

  it("names no word the migration runner refuses", () => {
    expect(migrationText(MAIL_LISTS_PREFIX)).not.toMatch(/vault|secret|decrypted/i);
  });
});
