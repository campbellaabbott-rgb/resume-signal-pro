// @vitest-environment node
/**
 * MARKETING MAIL WAITS FOR A SELLER WITH A NAME AND A POSTAL ADDRESS (S12-010).
 *
 * WHAT WAS WRONG. The market pulse, the agent digest and the fix-plan
 * sequence went out with an empty seller identity, so every one of them was
 * a commercial mail with no postal address (15 U.S.C. 7704(a)(5)). The owner
 * decided (2026-10-12) that marketing mail is paused until the seller's legal
 * name and postal address are filled in, and that they are never invented.
 *
 * WHAT HOLDS NOW, running the shipped handlers with only their network faked:
 *   - as shipped (identity empty) the pulse batch and the agent digest send
 *     nothing, claim nothing, and answer paused_no_seller_identity; the
 *     fix-plan button starts nothing and spends no monthly slot; the report
 *     mail a person asked for still goes, with no button for the sequence;
 *   - every response carries x-marketing-mail, the preflight included, so the
 *     verifier can read the state without sending anything;
 *   - with an identity filled in (a test stand-in, never shipped) the same
 *     batch mails with the seller line, and the sequence is queued as
 *     marketing with a plain-text part that carries the unsubscribe link.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { signDripLink } from "../../supabase/functions/_shared/scan-drip-link";
import { MARKETING_PAUSED, marketingPaused } from "../../supabase/functions/_shared/marketing-pause";
import { SELLER_IDENTITY } from "../../supabase/functions/_shared/seller-identity";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const NAME = "Example Seller LLC";
const ADDRESS = "1 Example Street, Springfield";
const FILLED = { "_shared/seller-identity.ts": `export const SELLER_IDENTITY = { legalName: ${JSON.stringify(NAME)}, postalAddress: ${JSON.stringify(ADDRESS)} };` };
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
const enqueued: Array<Record<string, unknown>> = [];
const h: Record<string, EdgeHandler> = {};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__mpSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  const stubs = {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__mpSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  };
  for (const fn of ["send-market-pulse", "send-agent-digest", "send-scan-report"]) {
    h[fn] = await loadEdgeHandler(fn, stubs);
    h[`${fn}:filled`] = await loadEdgeHandler(fn, { ...stubs, ...FILLED });
  }
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
}
const batch = (fn: string) => h[fn](new Request(`https://harness.supabase.co/functions/v1/${fn.split(":")[0]}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));
const press = async (fn: string) => {
  const token = await signDripLink(SERVICE, { email: "jane@example.com", score: 64, reportId: "A1B2C3D4E5F6", steps: [{ step: "Add numbers", minutes: 10, scoreImpact: 6 }] });
  return h[fn](new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" }, body: JSON.stringify({ action: "confirm-drip", token }),
  }));
};

describe("the identity ships empty, so marketing ships paused", () => {
  it("nothing is invented, and the pause reads the identity", () => {
    expect(SELLER_IDENTITY).toEqual({ legalName: "", postalAddress: "" });
    expect(marketingPaused()).toBe(true);
    expect(marketingPaused({ legalName: NAME, postalAddress: ADDRESS })).toBe(false);
    expect(marketingPaused({ legalName: NAME, postalAddress: " " })).toBe(true);
  });

  it("every marketing sender says so on its preflight", async () => {
    for (const fn of ["send-market-pulse", "send-agent-digest", "send-scan-report"]) {
      const res = await h[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
      expect(res.headers.get("x-marketing-mail"), fn).toBe(MARKETING_PAUSED);
      expect(res.headers.get("x-fn-build"), fn).toBe(`${fn}.2026-10-11.25`);
      const filled = await h[`${fn}:filled`](new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
      expect(filled.headers.get("x-marketing-mail"), fn).toBe("on");
    }
  });
});

describe("the market pulse batch", () => {
  it("as shipped: claims nobody and mails nobody", async () => {
    install();
    const res = await batch("send-market-pulse");
    expect(await res.json()).toMatchObject({ success: true, sent: 0, paused: MARKETING_PAUSED });
    expect(claims, "a claim would have cost every due subscriber a month").toBe(0);
    expect(sent).toEqual([]);
  });

  it("with the seller named, the same batch mails and prints the seller line", async () => {
    install();
    const res = await batch("send-market-pulse:filled");
    expect(await res.json()).toMatchObject({ success: true, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(ADDRESS);
  });
});

describe("the agent digest", () => {
  it("as shipped: claims nothing", async () => {
    install();
    const res = await batch("send-agent-digest");
    expect(await res.json()).toMatchObject({ ok: true, sent: 0, paused: MARKETING_PAUSED });
    expect(claims).toBe(0);
  });
});

describe("the fix-plan sequence", () => {
  it("as shipped: the button starts nothing and spends no monthly slot", async () => {
    install();
    let doors = 0;
    db.rpcs.mail_door_take = () => { doors++; return { data: true, error: null }; };
    const res = await press("send-scan-report");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, queued: false, reason: MARKETING_PAUSED, retry: false });
    expect(enqueued).toEqual([]);
    expect(doors, "the month's slot was taken for a sequence that cannot start").toBe(0);
  });

  it("with the seller named: four mails queued as marketing, each with a text part carrying its unsubscribe link", async () => {
    install();
    const res = await press("send-scan-report:filled");
    expect(await res.json()).toEqual({ success: true, queued: true });
    expect(enqueued).toHaveLength(4);
    for (const e of enqueued) {
      const p = e.payload as { purpose?: string; text?: string; html?: string; label?: string };
      expect(p.label).toBe("fix-plan-drip");
      expect(p.purpose).toBe("marketing");
      expect(p.text, "an empty text part").toMatch(/\S{20}/);
      expect(p.text).toMatch(/Unsubscribe \(https:\/\/resumebooster\.work\/email\/unsubscribe/);
      expect(p.text).toContain(ADDRESS);
      expect(p.text).not.toMatch(/<[a-z]/i);
    }
  });

  it("the report mail a person asked for still goes, and offers no button while paused", async () => {
    install();
    const body = { email: "jane@example.com", score: 61, dripOptIn: true };
    const res = await h["send-scan-report"](new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" }, body: JSON.stringify(body),
    }));
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain("Start my fix-plan emails");
  });
});
