// @vitest-environment node
/**
 * THE COMMISSION MAIL NAMES THE THIRTY-DAY HOLD, NOT A MONTHLY PAYOUT
 * (S14X-085, the owner-gated half: the proposed default rule).
 *
 * The mail an affiliate gets for a referred sale said the commission would be
 * paid out monthly. Nothing paid anyone monthly: a commission waits for
 * approval, and a payout is something the affiliate requests. With the
 * approval job (20261112123000) the mail says what happens: approved thirty
 * days after the sale when it was not refunded, is not held for review and
 * the address is confirmed, then requested from the dashboard at $25.
 *
 * The handler is RUN, bundled from the shipped index.ts with only Resend and
 * the server stubbed, and the html it hands Resend is read.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
type Sent = { to: string[]; html: string };
const sent: Sent[] = [];
const RESEND = "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__sentHold.push(m); return { data: { id: 'em_1' }, error: null }; } }; } }";
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__sentHold = sent;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-affiliate-commission-email", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/resend@4.0.0": RESEND,
  });
}, 60_000);

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the commission mail", () => {
  it("says the commission is approved after a thirty-day hold and requested at $25, not paid monthly", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/send-affiliate-commission-email", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ affiliateEmail: "affiliate@example.com", productName: "Pro", saleAmount: 4500, commissionAmount: 1500, referralCode: "abc123" }),
    }));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const body = text(sent[0].html);
    expect(body).not.toMatch(/monthly/i);
    expect(body).toMatch(/30 days after the sale/);
    expect(body).toMatch(/not refunded/);
    expect(body).toMatch(/held for review/);
    expect(body).toMatch(/email address is confirmed/);
    expect(body).toMatch(/\$25/);
  });
});
