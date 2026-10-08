// @vitest-environment node
/**
 * A MORNING MAIL SAYS WHAT THIS AGENT DOES (wave 2 email-ops, register L9-14).
 *
 * WHAT WAS WRONG. send-agent-digest ended every shortlist with "We never
 * submit anything for you - you always press send", for every entitled
 * subscriber. apply_mode was never read, and the product sells "The agent
 * applies for you" to auto-mode buyers: the sentence was true only by accident
 * (auto packets were being held) and would turn false the day that was fixed.
 *
 * WHAT HOLDS NOW, by running the shipped handler with Resend and the database
 * faked: a review-mode mandate is told nothing goes until released, an
 * auto-mode mandate is told its agent sends within its daily cap, and a mode
 * that could not be read gets no sentence rather than a guess.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__agdSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-agent-digest", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__agdSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

function install(mandate: Record<string, unknown> | null) {
  db.rpcs.agent_digest_claim_batch = () => ({ data: [{ ad_user_id: "u-1", ad_email: "sub@example.com", ad_prev_sent_at: null }], error: null });
  db.rows("agent_subscribers").push({ email: "sub@example.com", status: "active", current_period_end: new Date(Date.now() + 9e8).toISOString() });
  if (mandate) db.rows("agent_mandates").push({ user_id: "u-1", email_last_sent_at: null, ...mandate });
  db.rows("agent_queue").push({ user_id: "u-1", status: "ready", posting_id: "p1", title: "Nurse", company: "Acme", location: "Leeds", apply_url: "https://acme.example/a", salary: null, fit_pct: 80, reasons: [], created_at: new Date().toISOString() });
}
const run = () => handler(new Request("https://harness.supabase.co/functions/v1/send-agent-digest", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));

describe("the morning mail's footer is the mandate's own mode", () => {
  it("auto mode: the agent sends for you, up to its daily cap -- never 'we never submit anything'", async () => {
    install({ apply_mode: "auto", auto_apply_daily_cap: 7 });
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].html, "an auto-mode buyer was told nothing is ever sent for them").not.toMatch(/never submit anything/);
    expect(sent[0].html).toContain("Your agent is in auto mode: it sends applications for you, up to 7 a day.");
  });

  it("review mode: nothing is sent until you release it", async () => {
    install({ apply_mode: "review", auto_apply_daily_cap: 5 });
    await run();
    expect(sent[0].html).toContain("Your agent is in review mode: nothing is sent until you release it from your queue.");
  });

  it("a mode that could not be read gets no sentence at all", async () => {
    install(null);
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toMatch(/never submit anything|review mode|auto mode/);
  });
});
