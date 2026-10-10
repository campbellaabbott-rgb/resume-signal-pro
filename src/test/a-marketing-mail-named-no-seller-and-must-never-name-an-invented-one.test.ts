// @vitest-environment node
/**
 * A MARKETING MAIL NAMED NO SELLER, AND MUST NEVER NAME AN INVENTED ONE
 * (commercial-readiness 2026-10-08, item 10; owner decision 2026-10-08).
 *
 * WHAT WAS WRONG. US anti-spam law asks every marketing mail for the
 * sender's postal address; no mail had a place for it. The owner has not
 * chosen the entity or the address yet, so the place must exist and stay
 * silent until both are set: no blank "Sent by", no made-up name.
 *
 * WHAT HOLDS NOW, running the shipped morning digest with its network faked:
 * with the identity as shipped (empty) the mail carries no seller line; with
 * the identity filled the same mail prints the name and address, escaped;
 * half an identity prints nothing. The digest also carries the reply address.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_IDENTITY } from "../../supabase/functions/_shared/seller-identity";
import { sellerFooterHtml } from "../../supabase/functions/_shared/seller-footer";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const NAME = "Example Seller <LLC>";
const ADDRESS = "1 Main St, Suite 2 & 3, Springfield";
type Sent = { to: string[]; subject: string; html: string; reply_to?: string };
const sent: Sent[] = [];
const db = new FakeDb();
let shipped: EdgeHandler;
let filled: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__sellerSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  const stubs = {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__sellerSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  };
  shipped = await loadEdgeHandler("send-agent-digest", stubs);
  filled = await loadEdgeHandler("send-agent-digest", {
    ...stubs,
    "_shared/seller-identity.ts": `export const SELLER_IDENTITY = { legalName: ${JSON.stringify(NAME)}, postalAddress: ${JSON.stringify(ADDRESS)} };`,
  });
}, 60_000);

afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

function install() {
  db.rpcs.agent_digest_claim_batch = () => ({ data: [{ ad_user_id: "u-1", ad_email: "sub@example.com", ad_prev_sent_at: null }], error: null });
  db.rows("agent_subscribers").push({ email: "sub@example.com", status: "active", current_period_end: new Date(Date.now() + 9e8).toISOString() });
  // The digest reads the plan by account, not by address (agents-api S8-076,
  // merged beside this group's footer in wave 3).
  db.rpcs.agent_subscription_rows = (a) => ({
    data: (a.p_user_ids as string[]).includes("u-1") ? [{ user_id: "u-1", email: "sub@example.com", status: "active", current_period_end: new Date(Date.now() + 9e8).toISOString() }] : [],
    error: null,
  });
  db.rows("agent_mandates").push({ user_id: "u-1", email_last_sent_at: null, apply_mode: "review", auto_apply_daily_cap: 5 });
  db.rows("agent_queue").push({ user_id: "u-1", status: "ready", posting_id: "p1", title: "Nurse", company: "Acme", location: "Leeds", apply_url: "https://acme.example/a", salary: null, fit_pct: 80, reasons: [], created_at: new Date().toISOString() });
}
const run = (h: EdgeHandler) => h(new Request("https://harness.supabase.co/functions/v1/send-agent-digest", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));

describe("the seller line in a marketing mail", () => {
  it("ships empty: the identity is not invented", () => {
    expect(SELLER_IDENTITY).toEqual({ legalName: "", postalAddress: "" });
    expect(sellerFooterHtml()).toBe("");
  });

  it("as shipped, the morning digest carries no seller line, and its replies reach a person", async () => {
    install();
    await run(shipped);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain(ADDRESS);
    expect(sent[0].html).not.toMatch(/&middot;\s*<\/p>|Sent by/);
    expect(sent[0].reply_to).toBe("resumeboostersupp@gmail.com");
  });

  it("once the owner fills the identity, the same mail prints the name and the address, escaped", async () => {
    install();
    await run(filled);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain("Example Seller &lt;LLC&gt;");
    expect(sent[0].html).toContain("1 Main St, Suite 2 &amp; 3, Springfield");
    expect(sent[0].html).not.toContain(NAME);
  });

  it("half an identity prints nothing", () => {
    expect(sellerFooterHtml({ legalName: NAME, postalAddress: " " })).toBe("");
    expect(sellerFooterHtml({ legalName: "", postalAddress: ADDRESS })).toBe("");
  });
});
