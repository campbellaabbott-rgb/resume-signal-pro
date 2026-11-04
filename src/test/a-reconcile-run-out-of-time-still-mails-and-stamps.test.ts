// @vitest-environment node
/**
 * A RECONCILE RUN OUT OF TIME STILL MAILS AND STAMPS (the recheck of S13-028).
 *
 * WHAT WAS WRONG. Ten re-deliveries at 25 s each, after a list that could wait
 * on Stripe for minutes, pass the platform's cut of an isolate at about 150 s.
 * The sweep died before it reached its mail and its stamp: the owner never heard
 * about the paid orders it found, and the status page never heard it ran.
 *
 * WHAT HOLDS NOW, running the shipped handler with Stripe, Resend, the webhook
 * and the clock faked:
 *   - no re-delivery starts past 90 s and none runs past 105 s;
 *   - a session left over is said as such, counted in `deferred`, and takes no
 *     door, so the next run sends it;
 *   - the mail goes and the stamp is written whatever the webhook did;
 *   - a hung mail attempt falls through to the second sender;
 *   - the list has a bounded wait, stops paging at its budget and keeps what it
 *     read when a later page fails; a first page failing is still a failed run.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const env: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_live_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", ADMIN_EMAIL: "owner@example.com",
  STRIPE_WEBHOOK_SECRET: "whsec_harness_0123456789",
};
const session = (i: number) => ({
  id: `cs_live_orphan${String(i).padStart(2, "0")}`, object: "checkout.session", livemode: true, status: "complete", payment_status: "paid", mode: "payment",
  amount_total: 500, currency: "usd", customer_details: { email: `buyer${i}@example.com` }, metadata: { product_type: "full_analysis" }, created: 1_800_000_000,
});

let db: FakeDb;
let reconcile: EdgeHandler;
let clock = 0;
let webhookMs = 25_000;
let posts: string[] = [];
let timeouts: number[] = [];
type Page = { has_more: boolean; data: unknown[] } | Error;
let pages: Page[] = [];
let listOptions: unknown[] = [];
let listMs = 0;
let mails: Array<{ from: string; subject: string; html: string }> = [];
let hangFrom = "";
let doors: string[] = [];
const realNow = Date.now;
const realTimeout = AbortSignal.timeout;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__cl = {
    db: () => db,
    list: async (_params: unknown, options: unknown) => {
      listOptions.push(options);
      clock += listMs;
      const p = pages.shift() ?? { has_more: false, data: [] };
      if (p instanceof Error) throw p;
      return p;
    },
    send: (m: { from: string; subject: string; html: string }) => {
      if (m.from.includes(hangFrom) && hangFrom) return new Promise(() => { /* never answers */ });
      mails.push(m);
      return Promise.resolve({ data: { id: "re_1" }, error: null });
    },
  };
  reconcile = await loadEdgeHandler("reconcile-stripe", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.checkout = { sessions: { list: (p, o) => globalThis.__cl.list(p, o) } }; } }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__cl.db();",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: (m) => globalThis.__cl.send(m) }; } }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.mail_door_take = (a) => { doors.push(String(a.p_bucket)); return { data: true, error: null }; };
  clock = 1_800_000_000_000; webhookMs = 25_000; posts = []; timeouts = []; pages = []; listOptions = []; listMs = 0; mails = []; hangFrom = ""; doors = [];
  Date.now = () => clock;
  AbortSignal.timeout = ((ms: number) => { timeouts.push(ms); return realTimeout.call(AbortSignal, 600_000); }) as typeof AbortSignal.timeout;
  (globalThis as Record<string, unknown>).fetch = async (input: string | URL | Request) => {
    posts.push(String(input instanceof Request ? input.url : input));
    clock += webhookMs;
    return new Response("{}", { status: 500 });
  };
});
afterEach(() => { Date.now = realNow; AbortSignal.timeout = realTimeout; });
afterAll(() => { (globalThis as Record<string, unknown>).fetch = realFetch; });

const run = async () => {
  const res = await reconcile(new Request("https://harness.supabase.co/functions/v1/reconcile-stripe", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const stamp = () => (db.rows("job_board_meta").find((r) => r.k === "reconcile_stripe_run")?.v ?? null) as Record<string, unknown> | null;
const twelve = () => [{ has_more: false, data: Array.from({ length: 12 }, (_, i) => session(i)) }];

describe("the run's clock", () => {
  it("twelve orphans on a webhook that takes 25 s each: four are sent, the rest wait, and the mail and the stamp happen", async () => {
    pages = twelve();
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(posts, "a re-delivery started past the run's budget").toHaveLength(4);
    expect(body).toMatchObject({ orphans: 12, deferred: 8, listCut: false, alerted: true });
    expect(stamp()).toMatchObject({ orphans: 12, deferred: 8, listCut: false, alerted: true });
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/8 left for the next run/);
    expect(mails[0].html).toMatch(/8 were not re-sent in this run and the next run sends them/);
    expect(mails[0].html).toMatch(/not re-sent: the run's clock ran out, the next run sends it/);
  });

  it("a session left over takes no door, so the next run can send it", async () => {
    pages = twelve();
    await run();
    expect(doors, "a deferred session's door was spent").toHaveLength(4);
  });

  it("the sessions beyond ten a run count as deferred too, on a quick webhook", async () => {
    webhookMs = 100;
    pages = twelve();
    const { body } = await run();
    expect(posts).toHaveLength(10);
    expect(body).toMatchObject({ orphans: 12, deferred: 2 });
  });

  it("a re-delivery's wait never reaches past the run's hard end", async () => {
    webhookMs = 30_000;
    pages = twelve();
    await run();
    // Starts at 0, 30 and 60 s wait the full 25 s; the start at 90 s is past the budget.
    expect(timeouts).toEqual([25_000, 25_000, 25_000]);
    timeouts = [];
    webhookMs = 22_000;
    pages = twelve();
    clock += 1;
    await run();
    // Starts at 0, 22, 44, 66 and 88 s: the last has 17 s left to the hard end.
    expect(timeouts).toEqual([25_000, 25_000, 25_000, 25_000, 17_000]);
  });

  it("no orphan at all: nothing is deferred and the stamp says so", async () => {
    pages = [{ has_more: false, data: [] }];
    const { body } = await run();
    expect(body).toMatchObject({ orphans: 0, deferred: 0, listCut: false, alerted: null });
    expect(stamp()).toMatchObject({ orphans: 0, deferred: 0, listCut: false });
    expect(mails).toEqual([]);
  });
});

describe("the owner's mail", () => {
  it("a sender that never answers falls through to the other one", async () => {
    pages = [{ has_more: false, data: [session(1)] }];
    hangFrom = "alerts@resumebooster.work";
    const realSetTimeout = globalThis.setTimeout;
    const asked: number[] = [];
    (globalThis as Record<string, unknown>).setTimeout = ((f: () => void, ms?: number) => {
      asked.push(Number(ms));
      return realSetTimeout(f, ms === 10_000 ? 1 : ms);
    }) as typeof setTimeout;
    try {
      const { body } = await run();
      expect(body).toMatchObject({ alerted: true });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(asked).toContain(10_000);
    expect(mails.map((m) => m.from)).toEqual(["Resume Booster Alerts <onboarding@resend.dev>"]);
    expect(stamp()).toMatchObject({ alerted: true });
  });
});

describe("the list", () => {
  it("each list call has a bounded wait and one retry, not the SDK's minutes", async () => {
    pages = [{ has_more: false, data: [] }];
    await run();
    expect(listOptions).toEqual([{ timeout: 15_000, maxNetworkRetries: 1 }]);
  });

  it("stops paging at its budget and keeps what it read, and says so", async () => {
    listMs = 20_000;
    pages = Array.from({ length: 5 }, (_, i) => ({ has_more: true, data: [session(i)] }));
    const { body } = await run();
    expect(listOptions, "the list kept paging past its budget").toHaveLength(3);
    expect(body).toMatchObject({ checkedPaid: 3, orphans: 3, listCut: true, alerted: true });
    expect(mails[0].html).toMatch(/stopped reading Stripe's list before its end/);
  });

  it("a later page failing keeps the orphans already found", async () => {
    pages = [{ has_more: true, data: [session(1)] }, new Error("fake: Stripe timed out")];
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toMatchObject({ orphans: 1, listCut: true, alerted: true });
    expect(stamp()).toMatchObject({ orphans: 1, listCut: true });
  });

  it("the first page failing is still a failed run, with no stamp", async () => {
    pages = [new Error("fake: Stripe is down")];
    const { status, body } = await run();
    expect(status).toBe(500);
    expect(body).toEqual({ error: "reconciliation failed" });
    expect(stamp()).toBeNull();
    expect(mails).toEqual([]);
  });
});
