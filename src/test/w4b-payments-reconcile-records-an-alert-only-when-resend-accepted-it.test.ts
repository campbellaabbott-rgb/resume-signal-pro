// @vitest-environment node
/**
 * RECONCILE-STRIPE RECORDS AN ALERT ONLY WHEN RESEND ACCEPTED IT (CP-027).
 *
 * The orphan alarm went from Resend's test sender, and the SDK answers a
 * refusal as {error} without throwing, so "alerted: true" was written to the
 * run stamp for a mail nobody received: the one row that says whether the
 * owner was told about a paid session with no delivery said yes. Now our own
 * domain is tried first, Resend's onboarding sender second, and alerted is
 * true only when one of them accepted. The shipped handler, Stripe and
 * Resend faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const env: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_live_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", ADMIN_EMAIL: "owner@example.com",
};
const tried: string[] = [];
const refusing = new Set<string>();
let db: FakeDb;
let reconcile: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__rec = { tried, refusing, db: () => db };
  reconcile = await loadEdgeHandler("reconcile-stripe", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() { this.checkout = { sessions: { list: async () => ({ has_more: false, data: [
      { id: "cs_live_orphanpaidsession01", status: "complete", payment_status: "paid", mode: "payment", amount_total: 500, currency: "usd",
        customer_details: { email: "buyer@example.com" }, metadata: { product_type: "full_analysis" }, created: Math.floor(Date.now() / 1000) } ] }) } }; } }`,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__rec.db();",
    "https://esm.sh/resend@2.0.0": `export class Resend { constructor() { this.emails = { send: async (m) => {
      globalThis.__rec.tried.push(m.from);
      return globalThis.__rec.refusing.has(m.from) ? { data: null, error: { message: "domain not verified" } } : { data: { id: "re_1" }, error: null };
    } }; } }`,
  });
}, 120_000);

beforeEach(() => { db = new FakeDb(); tried.length = 0; refusing.clear(); });

const run = async () => (await reconcile(new Request("https://harness.supabase.co/functions/v1/reconcile-stripe", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
}))).json();
const stamp = () => (db.rows("job_board_meta").find((r) => r.k === "reconcile_stripe_run")?.v ?? {}) as Record<string, unknown>;

describe("the orphan alarm's bookkeeping", () => {
  it("is alerted when our own domain accepted it", async () => {
    const r = await run();
    expect(r).toMatchObject({ orphans: 1, alerted: true });
    expect(tried).toEqual(["Resume Booster Alerts <alerts@resumebooster.work>"]);
  });

  it("falls back to Resend's onboarding sender when our domain is refused, and is alerted only then", async () => {
    refusing.add("Resume Booster Alerts <alerts@resumebooster.work>");
    expect(await run()).toMatchObject({ alerted: true });
    expect(tried).toEqual(["Resume Booster Alerts <alerts@resumebooster.work>", "Resume Booster Alerts <onboarding@resend.dev>"]);
  });

  it("is NOT alerted when every sender refused, in the answer and in the run stamp", async () => {
    refusing.add("Resume Booster Alerts <alerts@resumebooster.work>");
    refusing.add("Resume Booster Alerts <onboarding@resend.dev>");
    const r = await run();
    expect(r.alerted, "a refused alarm was recorded as sent").toBe(false);
    expect(stamp().alerted).toBe(false);
  });
});
