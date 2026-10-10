// @vitest-environment node
/**
 * THE APPLY KIT'S ADDRESS DAY CAPPED A PRO ACCOUNT AT FORTY.
 *
 * generate-apply-package counts 40 calls per address per 1,440 minutes, and
 * it counted them for every caller before entitlement. While the hourly
 * sweep emptied that bucket it was really hourly; once a day lasts a day
 * (migration 20261009110000) a Pro account, which the function itself
 * promises "unlimited application kits", got a 429 on its 41st kit of the
 * day from its own address. The Pro plan is now decided first and its kits
 * are never counted in the address's day; purchase and unentitled callers
 * still are.
 *
 * Run against the shipped handler; Stripe, auth, the plan lookup, the
 * database and the model are faked.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

type Session = { id: string; payment_status: string; metadata: Record<string, string> };

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end.";

const sessions = new Map<string, Session>();
let db: FakeDb;
let counts: Map<string, number>;
let handler: EdgeHandler;

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const STRIPE = "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: (id) => globalThis.__kitStripe(id) } }; } }";
const SUPABASE = "export function createClient(_u, _k, o) { const h = o?.global?.headers?.Authorization ?? ''; return { auth: { getUser: async () => ({ data: { user: h === 'Bearer pro_user_jwt' ? { id: 'user-pro' } : null }, error: null }) } }; }";
const PRO = "export async function accountProStanding(_db, userId) { return { pro: userId === 'user-pro' }; }";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_test_harness",
    LOVABLE_API_KEY: "lovable_harness",
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.__kitStripe = async (id: string) => {
    const s = sessions.get(id);
    if (!s) throw new Error(`No such checkout.session: '${id}'`);
    return JSON.parse(JSON.stringify(s));
  };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("generate-apply-package", {
    "https://deno.land/std@0.168.0/http/server.ts": SERVE,
    "https://esm.sh/stripe@18.5.0": STRIPE,
    "https://esm.sh/@supabase/supabase-js@2": SUPABASE,
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__kitDb;",
    "_shared/pro.ts": PRO,
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  counts = new Map();
  // check_rate_limit as the database answers it: every bucket counts up to its cap for the day.
  db.rpcs.check_rate_limit = (a) => {
    const key = `${a.p_function}|${a.p_ip}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { data: n <= Number(a.p_max_requests), error: null };
  };
  (globalThis as Record<string, unknown>).__kitDb = db;
  sessions.clear();
});

const ask = (auth: string, sessionId?: string) => handler(new Request("https://harness.supabase.co/functions/v1/generate-apply-package", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: auth, "cf-connecting-ip": "203.0.113.40" },
  body: JSON.stringify({ resumeText: RESUME, jobPostingText: POSTING, sessionId }),
}));

describe("the Apply kit's day per address", () => {
  it("never refuses a Pro account's kits, past forty in a day from one address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) statuses.push((await ask("Bearer pro_user_jwt")).status);
    expect(statuses.filter((s) => s === 429)).toEqual([]);
    expect(statuses.filter((s) => s === 402)).toEqual([]);
  });

  it("still counts a caller with no plan, who is refused at forty-one before entitlement", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 41; i++) statuses.push((await ask("Bearer anon_harness")).status);
    expect(statuses.slice(0, 40).every((s) => s === 402)).toBe(true);
    expect(statuses[40]).toBe(429);
  });

  it("still counts a purchase's calls in the address's day", async () => {
    sessions.set("cs_live_kit", { id: "cs_live_kit", payment_status: "paid", metadata: { product_type: "apply_assistant" } });
    await ask("Bearer anon_harness", "cs_live_kit");
    expect(counts.get("generate-apply-package|203.0.113.40")).toBe(1);
  });
});
