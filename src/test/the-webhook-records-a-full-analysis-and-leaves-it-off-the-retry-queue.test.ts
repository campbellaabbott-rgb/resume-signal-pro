// @vitest-environment node
/**
 * THE WEBHOOK RECORDS A FULL ANALYSIS AND LEAVES IT OFF THE RETRY QUEUE.
 *
 * WHAT WAS WRONG. stripe-webhook claimed every paid session, opened a
 * product_deliveries row, and then -- having no résumé for a full analysis,
 * which create-checkout never puts in its metadata -- fell through to "No
 * resume session ID", marked the row generation_failed and scheduled it for
 * retry-failed-deliveries, which could do nothing for it either. The fix
 * recognises the product, returns before that failure, and writes the row
 * with next_retry_at at infinity so the sweeper (which selects rows whose
 * next_retry_at has passed) never picks it up, while analyze-resume closes it
 * as delivered. That last part had no guard: deleting it left every test
 * green.
 *
 * So the webhook is RUN: its shipped handler, bundled with esbuild, given a
 * signed-looking checkout.session.completed event, against an in-memory
 * database. Stripe's signature check is the stub's (it returns the body);
 * everything from the event onward is the code that deploys.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { sqlCodeOf } from "./helpers/strip-comments";

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0":
    "export default class Stripe { constructor() { this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) }; } }",
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } }",
};

let handler: EdgeHandler;
let db: FakeDb;
const pending: Promise<unknown>[] = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_WEBHOOK_SECRET: "whsec_harness",
    STRIPE_SECRET_KEY: "sk_test_harness",
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness",
    SUPABASE_ANON_KEY: "anon_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.fetch = async () => new Response("{}", { status: 200 });
  handler = await loadEdgeHandler("stripe-webhook", STUBS);
}, 60_000);

// ONE database object for the whole file: the webhook keeps its client in a
// module-level singleton from the first request, as it does warm in
// production, so a fresh object per test would be one it never sees.
db = new FakeDb({ used_stripe_sessions: ["session_id"] });
(globalThis as Record<string, unknown>).__fakeSupabase = db;
beforeEach(() => {
  db.tables = {};
  db.writes = [];
});

async function completed(session: Record<string, unknown>) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: `evt_${String(session.id)}`, type: "checkout.session.completed", data: { object: session } }),
  }));
  while (pending.length) await pending.shift();
  return res.status;
}

const paid = (id: string, metadata: Record<string, string>) => ({
  id,
  payment_status: "paid",
  amount_total: 500,
  currency: "usd",
  customer_email: null,
  customer_details: { email: "buyer@example.com" },
  metadata,
});

describe("a paid full analysis, as the webhook sees it", () => {
  it("is claimed in its own name and its delivery row is never scheduled for the sweeper", async () => {
    const id = "cs_live_webhook_full_analysis";
    expect(await completed(paid(id, { product_type: "full_analysis", originalCurrency: "usd", baseAmountUSD: "5" }))).toBe(200);
    expect(db.rows("used_stripe_sessions")).toEqual([expect.objectContaining({ session_id: id, product_type: "full_analysis" })]);
    const rows = db.rows("product_deliveries").filter((d) => d.stripe_session_id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0].product_type).toBe("full_analysis");
    expect(rows[0].next_retry_at, "the row is due for a retry that cannot help -- the sweeper will pick it up").toBe("infinity");
    expect(rows[0].status, "the webhook marked a purchase it never meant to deliver as failed").toBe("payment_received");
  });

  it("and the sweeper still chooses rows by next_retry_at, so infinity means never", () => {
    // The exemption is only as good as the selection it relies on. The
    // pre-fix row (payment_received, next_retry_at NULL) was exactly what
    // this selection picks up; if it stops reading next_retry_at, the
    // exemption above silently stops meaning anything.
    const MIG = resolve(__dirname, "../../supabase/migrations");
    const definers = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /FUNCTION\s+(?:public\.)?get_failed_deliveries_for_retry\s*\(/i.test(sqlCodeOf(readFileSync(resolve(MIG, f), "utf8"))));
    expect(definers.length, "the sweeper's selection function was not found -- re-anchor this guard").toBeGreaterThanOrEqual(1);
    const latest = sqlCodeOf(readFileSync(resolve(MIG, definers[definers.length - 1]), "utf8"));
    const body = latest.slice(latest.search(/FUNCTION\s+(?:public\.)?get_failed_deliveries_for_retry\s*\(/i));
    expect(/next_retry_at\s+IS\s+NULL\s+OR\s+(?:\w+\.)?next_retry_at\s*<=\s*now\(\)/i.test(body),
      `${definers[definers.length - 1]}: the sweeper no longer gates on next_retry_at`).toBe(true);
    expect(/status\s+IN\s*\([^)]*'payment_received'/i.test(body), "the sweeper no longer selects payment_received rows -- re-read what this exemption is for").toBe(true);
  });

  it("while a product the webhook DOES deliver keeps its retry schedule (the exemption is this product's alone)", async () => {
    const id = "cs_live_webhook_cover_letter";
    await completed(paid(id, { product_type: "cover_letter", product_name: "Cover Letter", customer_email: "buyer@example.com" }));
    const row = db.rows("product_deliveries").find((d) => d.stripe_session_id === id);
    expect(row?.product_type).toBe("cover_letter");
    expect(row?.next_retry_at ?? null).toBeNull();
  });
});
