// @vitest-environment node
/**
 * A PULSE PRINTS THE NEWEST SCORE, OR NONE (S14X-237).
 *
 * WHAT WAS WRONG. Every monthly pulse said "Your last scan scored N/100" from
 * the subscriber row's last_score: the score the address signed up with,
 * which market_pulse_request_confirm keeps (coalesce) and nothing newer ever
 * replaces. A reader who had scanned twenty points higher since was told the
 * old number every month as "your last scan".
 *
 * WHAT HOLDS NOW, on the shipped handler with the database and Resend faked:
 * the line is printed only from the newest score get_user_score_trend
 * returns (trend[0]), and left out when no score is known.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ html: string }> = [];
const db = new FakeDb();
let pulse: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__s237Sent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  pulse = await loadEdgeHandler("send-market-pulse", {
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__s237Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);
afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

async function runWith(trend: Array<{ ats_score: number }>) {
  db.rpcs.market_pulse_claim_batch = () => ({ data: [{ cl_email: "sub@example.com", cl_industry: "technology", cl_last_score: 41, cl_confirmed_at: "2026-06-01T00:00:00Z", cl_prev_sent_at: "2026-10-01T15:47:00Z" }], error: null });
  db.rpcs.get_user_score_trend = () => ({ data: trend, error: null });
  db.rows("market_pulse_subscribers").push({ email: "sub@example.com", locale: null });
  const res = await pulse(new Request("https://harness.supabase.co/functions/v1/send-market-pulse", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
  }));
  expect(await res.json()).toMatchObject({ success: true, sent: 1 });
  expect(sent).toHaveLength(1);
  return sent[0].html;
}

describe("the score a pulse prints", () => {
  it("is not the sign-up score when no scan is on record: no score line at all", async () => {
    const html = await runWith([]);
    expect(html, "the pulse printed the frozen sign-up score").not.toMatch(/41\/100/);
    expect(html).not.toMatch(/Your last scan scored/);
  });

  it("is the newest scan's, when there is one", async () => {
    const html = await runWith([{ ats_score: 77 }]);
    expect(html).toMatch(/Your last scan scored <b>77\/100<\/b>/);
    expect(html).not.toMatch(/41\/100/);
  });

  it("is the newest of several, and the progress box still runs oldest to newest", async () => {
    const html = await runWith([{ ats_score: 82 }, { ats_score: 64 }, { ats_score: 58 }]);
    expect(html).toMatch(/Your last scan scored <b>82\/100<\/b>/);
    expect(html).toMatch(/<b>58<\/b> → <b>82<\/b>/);
  });
});
