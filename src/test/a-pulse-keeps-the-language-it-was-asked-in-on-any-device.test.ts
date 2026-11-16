// @vitest-environment node
/**
 * A PULSE KEEPS THE LANGUAGE IT WAS ASKED IN, ON ANY DEVICE (S14X-239).
 *
 * WHAT WAS WRONG. The pulse's language was stored only at confirmation, from
 * the page that opened the link. A German reader who asked on the German site
 * and opened the link on a phone set to French got every monthly pulse in
 * French, though the confirmation mail itself was German.
 *
 * WHAT HOLDS NOW, on the shipped handler with the database and Resend faked:
 * the sign-up stores the asking page's language (the one its confirmation
 * mail is written in) on the row its new token names; the confirm writes the
 * confirming page's language only on a row that holds none (asked before the
 * sign-up stored one).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ to: string[]; html: string; subject: string }> = [];
const db = new FakeDb();
let pulse: EdgeHandler;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__s239Sent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  pulse = await loadEdgeHandler("send-market-pulse", {
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__s239Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);
afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

const post = (body: unknown) => pulse(new Request("https://harness.supabase.co/functions/v1/send-market-pulse", {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body),
}));

/** The database's half: request_confirm writes the row the token names (no language); confirm spends it. */
function installDoors() {
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
  db.rpcs.market_pulse_request_confirm = (a: Record<string, unknown>) => {
    const rows = db.rows("market_pulse_subscribers");
    const hit = rows.find((r) => r.email === a.p_email);
    const patch = { industry: a.p_industry, confirm_token_hash: a.p_token_hash, confirm_sent_at: new Date().toISOString() };
    if (hit) Object.assign(hit, patch); else rows.push({ email: a.p_email, locale: null, confirmed_at: null, last_sent_at: null, ...patch });
    return { data: { pc_send: true, pc_reason: "sent" }, error: null };
  };
  db.rpcs.market_pulse_confirm = (a: Record<string, unknown>) => {
    const hit = db.rows("market_pulse_subscribers").find((r) => r.confirm_token_hash === a.p_token_hash);
    if (!hit) return { data: { cf_confirmed: false, cf_reason: "invalid_or_expired" }, error: null };
    Object.assign(hit, { confirmed_at: new Date().toISOString(), confirm_token_hash: null, unsubscribed_at: null });
    return { data: { cf_confirmed: true, cf_reason: "confirmed" }, error: null };
  };
}

describe("the pulse's language", () => {
  it("is the asking page's, even when the link is opened on a device in another language", async () => {
    installDoors();
    const asked = await post({ action: "subscribe", email: "leser@example.com", industry: "finance", language: "de" });
    expect(asked.status).toBe(200);
    const token = /\/market-pulse\/confirm#t=([0-9a-f]{64})"/.exec(sent[0].html)?.[1];
    expect(token, "the confirmation mail carries no link").toBeTruthy();
    expect(db.rows("market_pulse_subscribers")[0].locale, "the sign-up did not keep its language").toBe("de");

    const confirmed = await post({ action: "confirm", token, language: "fr" });
    expect(await confirmed.json()).toMatchObject({ success: true, confirmed: true });
    expect(db.rows("market_pulse_subscribers")[0].locale, "the confirming device's language replaced the asking page's").toBe("de");
  });

  it("a request made before the sign-up stored a language takes the confirming page's", async () => {
    installDoors();
    const token = "ab".repeat(32);
    db.rows("market_pulse_subscribers").push({ email: "old@example.com", locale: null, confirmed_at: null, confirm_token_hash: sha(token), confirm_sent_at: new Date(Date.now() - 3_600_000).toISOString(), last_sent_at: null });
    expect(await (await post({ action: "confirm", token, language: "fr" })).json()).toMatchObject({ confirmed: true });
    expect(db.rows("market_pulse_subscribers")[0].locale).toBe("fr");
  });

  it("an address that asks again in another language after an unsubscribe gets its new one", async () => {
    // The unsubscribe clears the language (S14X-102), so the new request's is kept.
    installDoors();
    db.rows("market_pulse_subscribers").push({ email: "back@example.com", locale: null, confirmed_at: "2026-01-01T00:00:00Z", unsubscribed_at: "2026-05-01T00:00:00Z", last_sent_at: null });
    await post({ action: "subscribe", email: "back@example.com", industry: "finance", language: "es" });
    expect(db.rows("market_pulse_subscribers")[0].locale).toBe("es");
  });
});
