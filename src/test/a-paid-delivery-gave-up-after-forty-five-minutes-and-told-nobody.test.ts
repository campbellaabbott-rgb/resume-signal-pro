// @vitest-environment node
//
// Node, not jsdom: the migrations run in pglite and the sweep is bundled with esbuild.
/**
 * A PAID DELIVERY GAVE UP AFTER FORTY-FIVE MINUTES AND TOLD NOBODY (S11-014),
 * AND THE LIVE SWEEP WOULD HAVE STALLED ON STUCK GENERATIONS (S11-146).
 *
 * S11-014. A delivery got three tries in about 45 minutes (5, 15, 45 minutes
 * of backoff, max_retries 3) and was then never selected again. A 402 (AI
 * credits exhausted), a 429, a 5xx or a timeout spent a try like a real
 * failure, so any outage longer than that left a paid sale undelivered, and
 * nothing told the owner. Owner decision 2026-10-11: spread the tries over
 * the résumé's 24 hours, do not count transient errors, alarm when a delivery
 * runs out.
 *
 * S11-146. 20261009140000 handed 'generating' rows to the live sweep, which
 * skips them without spending a try; ordered oldest first, they would take
 * its five-row batch on every run until the new sweep deployed. The
 * selector now hands them only to a caller that asks.
 *
 * Every function is read from the LATEST migration that defines it, so this
 * file runs against whatever the branch holds.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
/** Files that define one of these functions, in apply order, from the table's retry columns on. */
const definers = (names: string[]) => files.filter((f) => f >= "20251223225642" && names.some((n) =>
  new RegExp(`FUNCTION\\s+(?:public\\.)?${n}\\s*\\(`, "i").test(sqlCodeOf(read(f)))));

const TABLE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.product_deliveries (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    stripe_session_id text NOT NULL,
    customer_email text,
    product_type text NOT NULL,
    product_name text,
    content_generation_started_at timestamptz,
    status text NOT NULL DEFAULT 'payment_received',
    generation_error text,
    metadata jsonb
  );`;

async function deliveriesDb(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(TABLE);
  // The retry columns and the first functions, then every later definer in order.
  for (const f of ["20251223225642_04bb933d-47c1-459f-ab85-7f60a8f702fc.sql", ...definers(["update_delivery_retry", "delivery_error_is_transient", "get_failed_deliveries_for_retry"]).filter((f) => !f.startsWith("20251223225642") && f >= "20261005110000" && !f.startsWith("20261005110000"))]) {
    await pg.exec(read(f));
  }
  return pg;
}

async function fail(pg: PGlite, id: string, error: string, status = "generation_failed") {
  await pg.query("SELECT public.update_delivery_retry($1::uuid, $2, $3, true)", [id, status, error]);
  const { rows } = await pg.query<{ retry_count: number; max_retries: number; wait_min: number | null }>(
    "SELECT retry_count, max_retries, round(extract(epoch FROM next_retry_at - now()) / 60)::int AS wait_min FROM public.product_deliveries WHERE id = $1", [id]);
  return rows[0];
}

async function newRow(pg: PGlite, createdAgo = "1 minute", extra = ""): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at${extra ? ", " + extra.split("=")[0] : ""})
     VALUES ('cs_' || md5(random()::text), 'cover_letter', 'generation_failed', now() - interval '${createdAgo}'${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id`);
  return rows[0].id;
}

describe("a delivery is retried through the day, and an outage spends no tries (S11-014)", () => {
  it("an AI-gateway outage (402s and 5xx) for hours leaves the row with every try it had", async () => {
    const pg = await deliveriesDb();
    const id = await newRow(pg);
    let r = await fail(pg, id, "Generation failed: 402 - credits exhausted");
    for (const e of ["Generation failed: 503", "Generation failed: 429", "send-product-email answered 502", "Generation failed: 500 - upstream"]) r = await fail(pg, id, e);
    expect(r.retry_count, "an outage spent the order's tries").toBe(0);
    expect(r.retry_count < r.max_retries).toBe(true);
    await pg.close();
  });

  it("the tries are spread across the day: 5 min, 15 min, 1 h, 2 h, 4 h, 6 h after each failure", async () => {
    const pg = await deliveriesDb();
    const id = await newRow(pg);
    const waits: Array<number | null> = [];
    for (let i = 0; i < 6; i++) waits.push((await fail(pg, id, "Generation failed: 400 - the model refused")).wait_min);
    expect(waits, "the retries were bunched into the first hour").toEqual([5, 15, 60, 120, 240, 360]);
    const r = await fail(pg, id, "Generation failed: 400");
    expect(r.retry_count < r.max_retries, "a delivery ran out of tries within its first day").toBe(true);
    await pg.close();
  });

  it("a failure once the résumé's day is over spends the row", async () => {
    const pg = await deliveriesDb();
    const id = await newRow(pg, "25 hours");
    const r = await fail(pg, id, "Generation failed: 503");
    expect(r.retry_count).toBeGreaterThanOrEqual(r.max_retries);
    expect(r.wait_min).toBeNull();
    await pg.close();
  });

  it("an open row an outage exhausted under the old budget of three is selected again", async () => {
    const pg = new PGlite();
    await pg.exec(TABLE);
    await pg.exec(read("20251223225642_04bb933d-47c1-459f-ab85-7f60a8f702fc.sql"));
    await pg.exec(`INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at, retry_count, max_retries, last_retry_error)
                   VALUES ('cs_outage', 'cover_letter', 'generation_failed', now() - interval '2 hours', 3, 3, 'Generation failed: 402')`);
    for (const f of definers(["update_delivery_retry", "delivery_error_is_transient", "get_failed_deliveries_for_retry"]).filter((f) => f >= "20261005110000")) await pg.exec(read(f));
    const { rows } = await pg.query<{ stripe_session_id: string }>("SELECT stripe_session_id FROM public.get_failed_deliveries_for_retry(10)");
    expect(rows.map((r) => r.stripe_session_id), "a sale an outage exhausted stays undelivered").toEqual(["cs_outage"]);
    await pg.close();
  });
});

describe("the selector hands a stuck generation only to a sweep that asks (S11-146)", () => {
  it("the live sweep's call gets no 'generating' row; the new sweep's call does", async () => {
    const pg = await deliveriesDb();
    await pg.exec(`
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at, content_generation_started_at) VALUES
        ('gen_stuck', 'cover_letter', 'generating', now() - interval '3 hours', now() - interval '3 hours'),
        ('real_failure', 'cover_letter', 'generation_failed', now() - interval '1 hour', NULL);`);
    const live = await pg.query<{ stripe_session_id: string }>("SELECT stripe_session_id FROM public.get_failed_deliveries_for_retry(p_limit => 5)");
    expect(live.rows.map((r) => r.stripe_session_id), "the live sweep would hold its batch with a row it cannot finish").toEqual(["real_failure"]);
    const next = await pg.query<{ stripe_session_id: string }>("SELECT stripe_session_id FROM public.get_failed_deliveries_for_retry(p_limit => 5, p_include_generating => true)");
    expect(next.rows.map((r) => r.stripe_session_id)).toEqual(["gen_stuck", "real_failure"]);
    await pg.close();
  });
});

describe("the sweep asks for stuck generations and tells the owner when a delivery runs out (S11-014)", () => {
  const RESUME_ID = "11111111-2222-4333-8444-555555555555";
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness",
    RESEND_API_KEY: "re_harness", OWNER_NOTIFY_EMAIL: "owner@example.com",
  };
  let sweeper: EdgeHandler;
  const db = new FakeDb();
  const mails: Array<{ to: string[]; subject: string; html: string }> = [];
  let selectorArgs: Record<string, unknown> | null = null;

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
    g.__spentClient = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
    g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://api.resend.com/emails") { mails.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }
      if (url.includes("/functions/v1/generate-")) return new Response(JSON.stringify({ error: "the model refused" }), { status: 400 });
      return new Response("{}", { status: 200 });
    };
    sweeper = await loadEdgeHandler("retry-failed-deliveries", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__spentClient;",
    });
  });

  it("passes p_include_generating, and mails the owner once when a failed try spends the row", async () => {
    db.tables = {};
    mails.length = 0;
    db.rows("product_deliveries").push({
      id: "pd-last", stripe_session_id: "cs_live_last_try", product_type: "cover_letter", status: "generation_failed",
      customer_email: "buyer@example.com", retry_count: 7, max_retries: 8, metadata: { resume_session_id: RESUME_ID },
    });
    db.rpcs = {
      check_rate_limit: () => ({ data: true, error: null }),
      get_failed_deliveries_for_retry: (a) => { selectorArgs = a; return { data: db.rows("product_deliveries").filter((r) => r.status === "generation_failed" && Number(r.retry_count) < Number(r.max_retries)), error: null }; },
      get_temp_resume: () => ({ data: [{ resume_text: "A".repeat(400), job_description_text: "Senior engineer posting" }], error: null }),
      // The migration's rule for a counted failure, as far as this test needs it.
      update_delivery_retry: (a) => {
        const row = db.rows("product_deliveries").find((r) => r.id === a.p_id)!;
        Object.assign(row, { status: a.p_status, last_retry_error: a.p_error, retry_count: Number(row.retry_count) + 1 });
        return { data: true, error: null };
      },
      mail_door_take: () => ({ data: !mails.length, error: null }),
    };
    const sweep = () => sweeper(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }));
    await sweep();
    expect(selectorArgs).toMatchObject({ p_include_generating: true });
    expect(mails, "a delivery ran out of tries and nobody was told").toHaveLength(1);
    expect(mails[0].to).toEqual(["owner@example.com"]);
    expect(mails[0].subject).toMatch(/ran out of retries/);
    expect(mails[0].html).toContain("buyer@example.com");
    expect(mails[0].html).toContain("cs_live_last_try");
  });

  it("a failed try that leaves tries does not alarm", async () => {
    db.tables = {};
    mails.length = 0;
    db.rows("product_deliveries").push({
      id: "pd-early", stripe_session_id: "cs_live_early", product_type: "cover_letter", status: "generation_failed",
      customer_email: "buyer@example.com", retry_count: 1, max_retries: 8, metadata: { resume_session_id: RESUME_ID },
    });
    await sweeper(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }));
    expect(mails).toHaveLength(0);
  });
});
