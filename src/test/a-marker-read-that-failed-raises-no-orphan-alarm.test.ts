// @vitest-environment node
/**
 * A MARKER READ THAT FAILED RAISES NO ORPHAN ALARM (S10-082).
 *
 * WHAT WAS WRONG. reconcile-stripe lists the paid sessions of the last 48
 * hours and asks used_stripe_sessions which have a fulfilment marker; a paid
 * session with none is an orphan, re-sent to the webhook and named in a mail
 * to the owner. The marker read's error was dropped, and every id went in one
 * list. A read that failed, or a list too long for one request, left no
 * marker at all: every paid session counted as an orphan, up to ten were
 * re-sent, and the owner was told the webhook had missed every sale.
 *
 * WHAT HOLDS NOW, on the shipped handler with Stripe, Resend and the webhook
 * faked, over 250 paid sessions that all have their marker:
 *   - the ids are read at most 100 to a request, so a database that refuses
 *     a longer list still answers every marker, and nothing is an orphan;
 *   - a read that fails, first or later, judges no orphan: no re-delivery,
 *     no door taken, no mail; the answer is a 503 that says the read failed,
 *     and the run's stamp says so too;
 *   - a session that really has no marker is still found among the 250.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const env: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_live_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", ADMIN_EMAIL: "owner@example.com",
  STRIPE_WEBHOOK_SECRET: "whsec_harness_0123456789",
};
const N = 250;
const sid = (i: number) => `cs_live_paid${String(i).padStart(4, "0")}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
const session = (i: number) => ({
  id: sid(i), object: "checkout.session", livemode: true, status: "complete", payment_status: "paid", mode: "payment",
  amount_total: 500, currency: "usd", customer_details: { email: `buyer${i}@example.com` }, metadata: { product_type: "full_analysis" }, created: 1_800_000_000,
});
/** Stripe's list, 100 to a page, as the sweep pages it. */
const pagesOf = (n: number) => {
  const all = Array.from({ length: n }, (_, i) => session(i));
  const out: Array<{ has_more: boolean; data: unknown[] }> = [];
  for (let i = 0; i < all.length; i += 100) out.push({ has_more: i + 100 < all.length, data: all.slice(i, i + 100) });
  return out;
};

let db: FakeDb;
let reconcile: EdgeHandler;
let pages: Array<{ has_more: boolean; data: unknown[] }> = [];
let mails: Array<{ subject: string }> = [];
let posts: string[] = [];
let doors: string[] = [];
/** How many ids each marker read carried. */
let readSizes: number[] = [];
/** The marker read that fails (1-based), or 0 for none. */
let failRead = 0;
const realFetch = globalThis.fetch;

/** A database client whose marker read refuses a list over 100 ids, as an oversized request is refused. */
const client = () => ({
  rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
  from: (t: string) => {
    const q = db.from(t);
    if (t !== "used_stripe_sessions") return q;
    const inner = q.in.bind(q);
    (q as unknown as { in: (c: string, v: unknown[]) => unknown }).in = (c: string, v: unknown[]) => {
      readSizes.push(v.length);
      if (v.length > 100) db.faults.push({ table: t, op: "select", error: { code: "PGRST000", message: "request URI too long" } });
      else if (readSizes.length === failRead) db.faults.push({ table: t, op: "select", error: { code: "57014", message: "canceling statement due to statement timeout" } });
      return inner(c, v);
    };
    return q;
  },
});

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__mr = {
    db: client,
    list: async () => pages.shift() ?? { has_more: false, data: [] },
    send: (m: { subject: string }) => { mails.push(m); return Promise.resolve({ data: { id: "re_1" }, error: null }); },
  };
  reconcile = await loadEdgeHandler("reconcile-stripe", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.checkout = { sessions: { list: (p, o) => globalThis.__mr.list(p, o) } }; } }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__mr.db();",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: (m) => globalThis.__mr.send(m) }; } }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.mail_door_take = (a) => { doors.push(String(a.p_bucket)); return { data: true, error: null }; };
  pages = pagesOf(N);
  mails = []; posts = []; doors = []; readSizes = []; failRead = 0;
  // Every one of the 250 was fulfilled: each has its marker.
  for (let i = 0; i < N; i++) db.rows("used_stripe_sessions").push({ session_id: sid(i), product_type: "full_analysis" });
  (globalThis as Record<string, unknown>).fetch = async (input: string | URL | Request) => {
    posts.push(String(input instanceof Request ? input.url : input));
    return new Response("{}", { status: 200 });
  };
  for (const k of ["log", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});
afterAll(() => { (globalThis as Record<string, unknown>).fetch = realFetch; vi.restoreAllMocks(); });

const run = async () => {
  const res = await reconcile(new Request("https://harness.supabase.co/functions/v1/reconcile-stripe", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
  }));
  return { status: res.status, build: res.headers.get("x-fn-build"), body: await res.json() as Record<string, unknown> };
};
const stamp = () => (db.rows("job_board_meta").find((r) => r.k === "reconcile_stripe_run")?.v ?? null) as Record<string, unknown> | null;

describe("250 paid sessions, every one with its marker", () => {
  it("are read 100 ids at a time, so none is an orphan and nobody is mailed", async () => {
    const r = await run();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ checkedPaid: N, orphans: 0, markerReadFailed: false });
    expect(Math.max(...readSizes), "one marker read carried every id").toBeLessThanOrEqual(100);
    expect(readSizes.reduce((a, b) => a + b, 0)).toBe(N);
    expect(mails, "the owner was told the webhook missed sales it delivered").toEqual([]);
    expect(posts, "delivered sales were re-sent to the webhook").toEqual([]);
    expect(buildIsAtLeast(r.build, "reconcile-stripe", "2026-11-21"), String(r.build)).toBe(true);
  });
});

describe("a marker read that fails", () => {
  for (const which of [1, 3]) {
    it(`(read ${which}) judges no orphan: no re-delivery, no door, no mail, a 503 and a stamp that say so`, async () => {
      failRead = which;
      const r = await run();
      expect(posts, "a failed read re-sent delivered sales to the webhook").toEqual([]);
      expect(doors).toEqual([]);
      expect(mails, "a failed read mailed the owner a false orphan alarm").toEqual([]);
      expect(r.status).toBe(503);
      expect(r.body).toMatchObject({ checkedPaid: N, orphans: 0, markerReadFailed: true, alerted: null });
      expect(stamp()).toMatchObject({ checkedPaid: N, orphans: 0, markerReadFailed: true });
    });
  }
});

describe("a sale the webhook really missed", () => {
  it("is still found among the 250 and the owner is told of it alone", async () => {
    db.tables.used_stripe_sessions = db.rows("used_stripe_sessions").filter((r) => r.session_id !== sid(201));
    const r = await run();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ checkedPaid: N, orphans: 1, markerReadFailed: false });
    expect(doors).toEqual([sid(201).slice(0, 64)]);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/^⚠️ 1 paid Stripe session/);
  });
});
