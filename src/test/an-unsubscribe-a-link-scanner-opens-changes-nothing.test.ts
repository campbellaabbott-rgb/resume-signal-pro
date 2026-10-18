// @vitest-environment node
/**
 * AN UNSUBSCRIBE A LINK SCANNER OPENS CHANGES NOTHING (wave 2 email-ops,
 * register L10-14: the pulse and the fix-plan drip; the digest's half is in
 * a-saved-search-mails-what-is-new-to-the-board-and-an-unanswered-count-is-not-zero).
 *
 * WHAT WAS WRONG. send-market-pulse and send-scan-report unsubscribed on a bare
 * GET of their own supabase.co URL and answered an HTML page, which Supabase
 * serves as text/plain on its default domain (people saw raw markup). Outlook
 * Safe Links and other scanners follow every link in a mail before it is read,
 * so the GET turned corporate recipients' mail off without their asking.
 *
 * WHAT HOLDS NOW, by running both shipped handlers with Resend and the
 * database faked: a GET changes nothing and redirects to the confirm page on
 * resumebooster.work; a POST -- the page's button or the mail client's RFC 8058
 * one-click -- unsubscribes, and only with a valid token; every pulse mail
 * carries List-Unsubscribe and List-Unsubscribe-Post and links the page, never
 * the function.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";
import { unsubscribeFromHash } from "../lib/unsubscribe-link";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
type Sent = { to: string[]; subject: string; html: string; headers?: Record<string, string> };
const sent: Sent[] = [];
const db = new FakeDb();
let pulse: EdgeHandler;
let report: EdgeHandler;
let agentDigest: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__unSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  const stubs = {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0":
      "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__unSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  };
  pulse = await loadEdgeHandler("send-market-pulse", { ...stubs, ...SELLER_SET_STUB });
  report = await loadEdgeHandler("send-scan-report", { ...stubs, ...SELLER_SET_STUB });
  agentDigest = await loadEdgeHandler("send-agent-digest", { ...stubs, ...SELLER_SET_STUB });
}, 120_000);

afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

async function pulseToken(email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.toLowerCase()));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const oneClick = (url: string) => new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });

describe("the market pulse", () => {
  const EMAIL = "reader@corp.example";
  const base = "https://harness.supabase.co/functions/v1/send-market-pulse";

  it("a GET of the link changes nothing and redirects to the confirm page", async () => {
    db.rows("market_pulse_subscribers").push({ email: EMAIL, unsubscribed_at: null });
    const t = await pulseToken(EMAIL);
    const res = await pulse(new Request(`${base}?action=unsubscribe&email=${encodeURIComponent(EMAIL)}&token=${t}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://resumebooster.work/email/unsubscribe#list=market-pulse&email=reader%40corp.example&token=${t}`);
    expect(db.writes).toEqual([]);
  });

  it("a one-click POST unsubscribes with the right token and not with a wrong one; so does the page's button", async () => {
    db.rows("market_pulse_subscribers").push({ email: EMAIL, unsubscribed_at: null });
    expect((await pulse(oneClick(`${base}?action=unsubscribe&email=${encodeURIComponent(EMAIL)}&token=${"0".repeat(32)}`))).status).toBe(400);
    expect(db.rows("market_pulse_subscribers")[0].unsubscribed_at).toBeNull();
    const res = await pulse(oneClick(`${base}?action=unsubscribe&email=${encodeURIComponent(EMAIL)}&token=${await pulseToken(EMAIL)}`));
    expect(await res.json()).toEqual({ unsubscribed: true });
    expect(db.rows("market_pulse_subscribers")[0].unsubscribed_at).not.toBeNull();

    db.rows("market_pulse_subscribers")[0].unsubscribed_at = null;
    const page = await pulse(new Request(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", email: EMAIL, token: await pulseToken(EMAIL) }) }));
    expect(page.status).toBe(200);
    expect(db.rows("market_pulse_subscribers")[0].unsubscribed_at).not.toBeNull();
  });

  it("every pulse mail links the confirm page and carries the one-click headers", async () => {
    db.rpcs.market_pulse_claim_batch = () => ({ data: [{ cl_email: EMAIL, cl_industry: "technology", cl_last_score: 70, cl_confirmed_at: "2026-09-01T00:00:00Z", cl_prev_sent_at: null }], error: null });
    db.rpcs.get_user_score_trend = () => ({ data: [], error: null });
    const res = await pulse(new Request(base, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }) }));
    expect(await res.json()).toMatchObject({ sent: 1 });
    const t = await pulseToken(EMAIL);
    expect(sent[0].html).toContain(`https://resumebooster.work/email/unsubscribe#list=market-pulse&amp;email=reader%40corp.example&amp;token=${t}`);
    expect(sent[0].html).not.toContain("functions/v1/send-market-pulse?action=unsubscribe");
    expect(sent[0].headers).toEqual({
      "List-Unsubscribe": `<${base}?action=unsubscribe&email=reader%40corp.example&token=${t}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("the fix-plan drip (send-scan-report)", () => {
  const TOKEN = "ab".repeat(16);
  const base = "https://harness.supabase.co/functions/v1/send-scan-report";

  it("a GET of the drip's link changes nothing and redirects to the confirm page", async () => {
    db.rows("email_unsubscribe_tokens").push({ token: TOKEN, email: "drip@corp.example", used_at: null });
    const res = await report(new Request(`${base}?action=unsubscribe&token=${TOKEN}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://resumebooster.work/email/unsubscribe#list=scan-report&token=${TOKEN}`);
    expect(db.writes).toEqual([]);
  });

  it("a POST with a known token suppresses the address; an unknown token is refused", async () => {
    db.rows("email_unsubscribe_tokens").push({ token: TOKEN, email: "drip@corp.example", used_at: null });
    expect((await report(oneClick(`${base}?action=unsubscribe&token=${"cd".repeat(16)}`))).status).toBe(400);
    expect(db.rows("suppressed_emails")).toEqual([]);
    const res = await report(new Request(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", token: TOKEN }) }));
    expect(await res.json()).toEqual({ unsubscribed: true });
    expect(db.rows("suppressed_emails").map((r) => [r.email, r.reason])).toEqual([["drip@corp.example", "unsubscribe"]]);
  });
});

/**
 * Sweep S11-132. The agent's morning shortlist (send-agent-digest) was left
 * out of L10-14: it set email_opt_in = false on a bare GET with a valid token
 * and carried no List-Unsubscribe headers, so a link-prefetching mail scanner
 * silently ended a paying subscriber's digest.
 */
describe("the agent's morning shortlist (send-agent-digest)", () => {
  const USER = "66666666-6666-4666-8666-666666666666";
  const base = "https://harness.supabase.co/functions/v1/send-agent-digest";
  const mandate = () => db.rows("agent_mandates").find((r) => r.user_id === USER)!;

  it("a GET of the link changes nothing and redirects to the confirm page", async () => {
    db.rows("agent_mandates").push({ user_id: USER, email_opt_in: true });
    const t = await pulseToken(USER);
    const res = await agentDigest(new Request(`${base}?action=unsubscribe&id=${USER}&token=${t}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://resumebooster.work/email/unsubscribe#list=agent-digest&id=${USER}&token=${t}`);
    expect(db.writes).toEqual([]);
    expect(mandate().email_opt_in).toBe(true);
  });

  it("a one-click POST unsubscribes with the right token and not a wrong one; so does the page's button", async () => {
    db.rows("agent_mandates").push({ user_id: USER, email_opt_in: true });
    expect((await agentDigest(oneClick(`${base}?action=unsubscribe&id=${USER}&token=${"0".repeat(32)}`))).status).toBe(400);
    expect(mandate().email_opt_in).toBe(true);
    const res = await agentDigest(oneClick(`${base}?action=unsubscribe&id=${USER}&token=${await pulseToken(USER)}`));
    expect(await res.json()).toEqual({ unsubscribed: true });
    expect(mandate().email_opt_in).toBe(false);

    mandate().email_opt_in = true;
    const page = await agentDigest(new Request(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", id: USER, token: await pulseToken(USER) }) }));
    expect(page.status).toBe(200);
    expect(mandate().email_opt_in).toBe(false);
  });

  it("the confirm page knows the list and posts to the shortlist's own function", async () => {
    const t = await pulseToken(USER);
    expect(unsubscribeFromHash(`#list=agent-digest&id=${USER}&token=${t}`))
      .toEqual({ list: "agent-digest", fn: "send-agent-digest", params: { id: USER, token: t } });
    expect(unsubscribeFromHash(`#list=agent-digest&id=not-a-user&token=${t}`)).toBeNull();
  });

  it("every shortlist links the confirm page and carries the one-click headers", async () => {
    const later = new Date(Date.now() + 86_400_000).toISOString();
    db.rows("agent_mandates").push({ user_id: USER, email_opt_in: true, apply_mode: "review", auto_apply_daily_cap: 5 });
    db.rows("agent_queue").push({ user_id: USER, status: "ready", posting_id: "teamtailor:acme:1", title: "Nurse", company: "Acme", location: "Leeds", apply_url: "https://x", salary: null, fit_pct: 80, reasons: [], created_at: new Date().toISOString() });
    db.rpcs.agent_digest_claim_batch = () => ({ data: [{ ad_user_id: USER, ad_email: "sub@corp.example", ad_prev_sent_at: null, ad_prev_attempted_at: null }], error: null });
    db.rpcs.agent_subscription_rows = () => ({ data: [{ user_id: USER, status: "active", current_period_end: later, bound: true }], error: null });
    const res = await agentDigest(new Request(base, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }) }));
    expect(await res.json()).toMatchObject({ sent: 1 });
    const t = await pulseToken(USER);
    expect(sent[0].html).toContain(`https://resumebooster.work/email/unsubscribe#list=agent-digest&amp;id=${USER}&amp;token=${t}`);
    expect(sent[0].html).not.toContain("functions/v1/send-agent-digest?action=unsubscribe");
    expect(sent[0].headers).toEqual({
      "List-Unsubscribe": `<${base}?action=unsubscribe&id=${USER}&token=${t}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
