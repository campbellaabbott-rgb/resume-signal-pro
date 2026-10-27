// @vitest-environment node
/**
 * MARKETING MAIL SENDS AS IT DOES ON MAIN, WITH NO SELLER NAMED (owner,
 * 2026-10-27: "there is no sales pause ... no one told you to do that").
 *
 * Wave 4 paused the market pulse, the agent digest and the fix-plan sequence
 * while the seller's legal name and postal address were empty, which is how
 * they ship. Nobody asked for that. Running the shipped handlers with the
 * shipped (empty) identity and only their network faked:
 *   - the pulse batch claims and mails its due subscriber;
 *   - a pulse sign-up mails its confirmation, and a confirmation link
 *     confirms with no paused flag;
 *   - the agent digest claims its batch;
 *   - the fix-plan button queues its four mails, and a sealed report mail
 *     with the box ticked carries the button;
 *   - no response carries a paused marketing header;
 *   - the seller line stays absent while the identity is empty: nothing is
 *     invented.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { signDripLink } from "../../supabase/functions/_shared/scan-drip-link";
import { SELLER_IDENTITY } from "../../supabase/functions/_shared/seller-identity";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
const enqueued: Array<Record<string, unknown>> = [];
const h: Record<string, EdgeHandler> = {};
const SENDERS = ["send-market-pulse", "send-agent-digest", "send-scan-report"];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__ssoSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  const stubs = {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__ssoSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  };
  for (const fn of SENDERS) h[fn] = await loadEdgeHandler(fn, stubs);
  // The report mail as free-keyword-scan sealed it: only the seal is stood in for.
  h["send-scan-report:sealed"] = await loadEdgeHandler("send-scan-report", {
    ...stubs,
    "_shared/scan-mail-seal.ts": "export async function scanMailSealValid() { return true; }",
  });
}, 120_000);

afterEach(() => { sent.length = 0; enqueued.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

let claims = 0;
function install() {
  claims = 0;
  db.rpcs.market_pulse_claim_batch = () => { claims++; return { data: [{ cl_email: "sub@example.com", cl_industry: "technology", cl_last_score: 70, cl_confirmed_at: "2026-09-01T00:00:00Z", cl_prev_sent_at: null }], error: null }; };
  db.rpcs.get_user_score_trend = () => ({ data: [], error: null });
  db.rpcs.agent_digest_claim_batch = () => { claims++; return { data: [], error: null }; };
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
  db.rpcs.enqueue_email_delayed = (a) => { enqueued.push(a); return { data: enqueued.length, error: null }; };
  db.rpcs.save_free_scan_lead = () => ({ data: null, error: null });
  db.rpcs.market_pulse_request_confirm = () => ({ data: { pc_send: true, pc_reason: "new" }, error: null });
  db.rpcs.market_pulse_confirm = () => ({ data: { cf_confirmed: true }, error: null });
}
const batch = (fn: string) => h[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));
const ask = (body: Record<string, unknown>) => h["send-market-pulse"](new Request("https://harness.supabase.co/functions/v1/send-market-pulse", {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body),
}));

describe("the premise: the identity ships empty, and nothing is invented", () => {
  it("both halves are empty", () => {
    expect(SELLER_IDENTITY).toEqual({ legalName: "", postalAddress: "" });
  });

  it("no marketing sender says it is paused, on its preflight or anywhere", async () => {
    for (const fn of SENDERS) {
      const res = await h[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
      expect(res.headers.get("x-marketing-mail"), fn).toBeNull();
    }
  });
});

describe("the market pulse", () => {
  it("the batch claims its due subscriber and mails them", async () => {
    install();
    const res = await batch("send-market-pulse");
    const body = await res.json();
    expect(body).toMatchObject({ success: true, sent: 1 });
    expect(body.paused).toBeUndefined();
    expect(claims).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toMatch(/Example Seller|Example Street/);
  });

  it("a sign-up mails its confirmation", async () => {
    install();
    const res = await ask({ action: "subscribe", email: "seeker@example.org", industry: "technology", score: 70 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, pending: true });
    expect(sent).toHaveLength(1);
  });

  it("a confirmation link confirms, with no paused flag", async () => {
    install();
    const res = await ask({ action: "confirm", token: "a".repeat(64) });
    expect(await res.json()).toEqual({ success: true, confirmed: true });
  });
});

describe("the agent digest", () => {
  it("claims its batch", async () => {
    install();
    const res = await batch("send-agent-digest");
    const body = await res.json();
    expect(body.paused).toBeUndefined();
    expect(claims).toBe(1);
  });
});

describe("the fix-plan sequence", () => {
  it("the button queues the four mails, as marketing with a text part carrying the unsubscribe link", async () => {
    install();
    const token = await signDripLink(SERVICE, { email: "jane@example.com", score: 64, reportId: "A1B2C3D4E5F6", steps: [{ step: "Add numbers", minutes: 10, scoreImpact: 6 }] });
    const res = await h["send-scan-report"](new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" }, body: JSON.stringify({ action: "confirm-drip", token }),
    }));
    expect(await res.json()).toEqual({ success: true, queued: true });
    expect(enqueued).toHaveLength(4);
    for (const e of enqueued) {
      const p = e.payload as { purpose?: string; text?: string; label?: string };
      expect(p.label).toBe("fix-plan-drip");
      expect(p.purpose).toBe("marketing");
      expect(p.text).toMatch(/Unsubscribe \(https:\/\/resumebooster\.work\/email\/unsubscribe/);
      expect(p.text).not.toMatch(/Example Seller|Example Street/);
    }
  });

  it("a sealed report mail with the box ticked carries the button", async () => {
    install();
    const body = {
      email: "jane@example.com", score: 61, dripOptIn: true, reportId: "A1B2C3D4E5F6", mailSeal: "stood-in",
      fixRoadmap: { totalMinutes: 20, steps: [{ step: "Add numbers to three bullets", minutes: 10, scoreImpact: 6 }] },
    };
    const res = await h["send-scan-report:sealed"](new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" }, body: JSON.stringify(body),
    }));
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain("Start my fix-plan emails");
  });
});
