// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE FREE SCAN SPENDS A CREDIT ONLY FOR A PROVEN BUYER, AND ONLY FOR A
 * DELIVERED REPORT.
 *
 * Defect sweep 2.07: past the daily limit, free-keyword-scan spent the
 * credits of whatever address the request body named, and gave unlimited
 * scans to anyone naming an active Pro subscriber's address. 2.06: the credit
 * was spent before the report cache and the model call and never given back.
 * 2.18: the 7-day report cache replayed the first scanner's credit receipt.
 * Register L5-14: malformed JSON answered 500 and emailed the owner.
 *
 * Sign-ups are auto-confirmed (mailer_autoconfirm = true), so an address on a
 * session is a claim too: anyone can sign up as a buyer's or a subscriber's
 * address. A password session spends only the purchases its account claimed;
 * the address's pool and its Pro need a verified Google sign-in for that
 * address (or, once the owner switches confirmation on, a confirmation the
 * auth server itself vouches for).
 *
 * The shipped handler runs with its database, its auth and the AI gateway
 * faked. Credits are a balance the fake RPCs keep, so every assertion is about
 * what a buyer is left holding.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

type Args = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

const RESUME = [
  "Jane Doe | jane.doe@example.com | (555) 010-0199",
  "SUMMARY",
  "Senior financial analyst with nine years in FP&A and vendor management.",
  "EXPERIENCE",
  "Senior Financial Analyst, Acme Corp, Jan 2020 - Present",
  "- Cut vendor spend by $250,000 annually by renegotiating contracts",
  "- Built the quarterly forecasting model used by the CFO",
  "Financial Analyst, Beta Inc, Mar 2016 - Dec 2019",
  "- Led month-end close for three business units",
  "EDUCATION",
  "BSc Economics, State University, 2015",
  "SKILLS",
  "Excel, SQL, Tableau, financial modeling, budgeting",
].join("\n");

const ANALYSIS = {
  detectedLanguage: { code: "en", name: "English" },
  candidateName: "Jane Doe",
  industry: "finance",
  atsScoreEstimate: 72,
  formatGrade: "B",
  formatIssue: "Clean single-column layout.",
  experienceLevel: { level: "senior", yearsEstimate: "9 years" },
  sectionCheck: { hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] },
  contactInfo: { hasEmail: true, hasPhone: true, hasLinkedIn: false, missingItems: ["LinkedIn URL"] },
  topStrength: "Quantified cost savings",
  redFlags: [],
  keywords: [],
  quickWins: [{ fix: "Add a LinkedIn URL", timeEstimate: "2 min", impact: "medium", scoreImpact: 3, category: "contact" }],
  topSkipReasons: [],
  powerWords: [],
  weakPhrases: [],
  additionalRewrites: [],
  formatGradeDrivers: [],
  recruiterFirstPassSummary: "Strong, quantified finance profile.",
  nextBestAction: { action: "Add LinkedIn", why: "Recruiters check it", estimatedImpact: "+3 pts" },
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Add LinkedIn" },
  resumeLength: { current: 1, recommended: 1 },
  wordCount: { current: 110, ideal: "400-700" },
  actionVerbGrade: "B",
  readabilityScore: 70,
  keywordDensity: 3,
  scoreBreakdown: { keywords: 70, format: 80, quantification: 60 },
  industryBenchmark: { industryAvg: 66, comparison: "above", percentile: "60th" },
  sampleRewrite: null,
};

let handler: EdgeHandler;
let aiOk: boolean;
let aiCalls: number;
let balances: Map<string, number>;
let rpcLog: Array<[string, Args]>;
let cacheRow: { report: unknown; created_at: string } | null;
let cacheWrites: unknown[];
/** What pro_entitlement_rows answers per ACCOUNT (the plan is read by user id). */
let proPlans: Record<string, Array<{ tier: string; status: string; current_period_end: string | null; bound: boolean }>>;
/** The account ids the scanner asked about. */
let proLookups: unknown[];
let underLimit: boolean;
let grants: Map<string, { email: string; left: number; claimedBy: string | null }>;
let settingsReads: number;
let autoconfirm: boolean;
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  STRIPE_SECRET_KEY: "sk_test_harness",
  NOTIFY_SCANS: "false",
};

/** A session token shaped like the auth server's: only its amr claim is read. */
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (sub: string, method: string, at = Math.floor(Date.now() / 1000)) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", amr: [{ method, timestamp: at }] })}.sig`;
const google = (email: string) => [{ provider: "google", identity_data: { email, email_verified: true } }];
type FakeUser = { id: string; email: string; email_confirmed_at?: string; identities?: unknown[] };

const OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
const PRO_ID = "00000000-0000-4000-8000-0000000000a2";
const SQUATTER_ID = "00000000-0000-4000-8000-0000000000a3";
const BUYER_ID = "00000000-0000-4000-8000-0000000000a4";
const JWT = {
  ownerGoogle: token(OWNER_ID, "oauth"),
  ownerPassword: token(OWNER_ID, "password"),
  proGoogle: token(PRO_ID, "oauth"),
  // Signed up with a password as the victim's / the subscriber's address.
  squatsVictim: token(SQUATTER_ID, "password"),
  buyerPassword: token(BUYER_ID, "password"),
};
const USERS: Record<string, FakeUser> = {
  [JWT.ownerGoogle]: { id: OWNER_ID, email: "owner@example.com", identities: google("owner@example.com") },
  [JWT.ownerPassword]: { id: OWNER_ID, email: "owner@example.com", identities: google("owner@example.com") },
  [JWT.proGoogle]: { id: PRO_ID, email: "pro@example.com", identities: google("pro@example.com") },
  [JWT.squatsVictim]: { id: SQUATTER_ID, email: "victim@example.com", email_confirmed_at: new Date().toISOString() },
  [JWT.buyerPassword]: { id: BUYER_ID, email: "buyer@example.com", email_confirmed_at: new Date().toISOString() },
};

/** A supabase-js stand-in: every builder method chains; awaiting answers what the test set. */
function client() {
  const rpc = async (name: string, args: Args = {}): Promise<Result> => {
    rpcLog.push([name, args]);
    switch (name) {
      case "check_global_rate_limit": return { data: true, error: null };
      case "check_rate_limit": return { data: args.p_function === "free-keyword-scan" ? underLimit : true, error: null };
      case "acquire_scan_slot": return { data: "slot-1", error: null };
      case "pro_entitlement_rows":
        proLookups.push(args.p_user_id);
        return { data: proPlans[String(args.p_user_id)] ?? [], error: null };
      case "scan_credit_redeem": {
        const e = String(args.p_email);
        const n = balances.get(e) ?? 0;
        const g = args.p_session_hash != null ? grants.get(String(args.p_session_hash)) : null;
        if (args.p_session_hash != null && (!g || g.email !== e || g.left <= 0)) return { data: false, error: null };
        if (n <= 0) return { data: false, error: null };
        balances.set(e, n - 1);
        if (g) g.left -= 1;
        return { data: true, error: null };
      }
      case "scan_credit_refund": {
        const e = String(args.p_email);
        balances.set(e, (balances.get(e) ?? 0) + 1);
        const g = args.p_session_hash != null ? grants.get(String(args.p_session_hash)) : null;
        if (g) g.left += 1;
        return { data: true, error: null };
      }
      case "scan_credit_account_grants":
        return {
          data: [...grants.entries()]
            .filter(([, g]) => g.claimedBy === args.p_user_id && g.left > 0)
            .map(([session_hash, g]) => ({ session_hash, email: g.email })),
          error: null,
        };
      case "scan_credit_balance": {
        const own = args.p_email ? balances.get(String(args.p_email)) ?? 0 : 0;
        const claimed = [...grants.values()].filter((g) => g.claimedBy === args.p_user_id && g.email !== args.p_email)
          .reduce((t, g) => t + Math.min(g.left, balances.get(g.email) ?? 0), 0);
        return { data: own + claimed, error: null };
      }
      default: return { data: null, error: null };
    }
  };
  const from = (table: string) => {
    const state: { op: string; payload?: unknown; eq: Array<[string, unknown]>; single: boolean } = { op: "select", eq: [], single: false };
    const resolve = async (): Promise<Result> => {
      if (state.op === "upsert" || state.op === "insert") {
        if (table === "scan_report_cache") cacheWrites.push(state.payload);
        return { data: null, error: null };
      }
      if (table === "scan_report_cache") return { data: state.single ? cacheRow : cacheRow ? [cacheRow] : [], error: null };
      return { data: state.single ? null : [], error: null };
    };
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: Result) => unknown, no?: (e: unknown) => unknown) => resolve().then(ok, no);
        if (prop === "maybeSingle" || prop === "single") return () => { state.single = true; return resolve(); };
        return (...a: unknown[]) => {
          if (prop === "upsert" || prop === "insert" || prop === "update" || prop === "delete") { state.op = prop; state.payload = a[0]; }
          if (prop === "eq") state.eq.push([String(a[0]), a[1]]);
          return builder;
        };
      },
    });
    return builder;
  };
  return {
    rpc,
    from,
    auth: { getUser: async (jwt: string) => ({ data: { user: USERS[jwt] ?? null }, error: null }) },
  };
}

const CLAIMED_HASH = "c".repeat(64);

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: unknown) => { void Promise.resolve(p).catch(() => {}); } };
  g.fetch = async (url: string) => {
    if (String(url).endsWith("/auth/v1/settings")) {
      settingsReads++;
      return new Response(JSON.stringify({ mailer_autoconfirm: autoconfirm, disable_signup: false }), { status: 200 });
    }
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiCalls++;
      if (!aiOk) return new Response(JSON.stringify({ error: "down" }), { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_analysis", arguments: JSON.stringify(ANALYSIS) } }] } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("free-keyword-scan", {
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__scanClient;",
  });
}, 180_000);

beforeEach(() => {
  aiOk = true;
  aiCalls = 0;
  balances = new Map([["victim@example.com", 9], ["owner@example.com", 2], ["pro@example.com", 0], ["buyer@example.com", 5]]);
  grants = new Map([[CLAIMED_HASH, { email: "buyer@example.com", left: 1, claimedBy: BUYER_ID }]]);
  settingsReads = 0;
  autoconfirm = true; // as read from the live project on 2026-10-04
  delete env.EMAIL_CONFIRMED_SINCE;
  rpcLog = [];
  cacheRow = null;
  cacheWrites = [];
  proPlans = { [PRO_ID]: [{ tier: "pro", status: "active", current_period_end: null, bound: true }] };
  proLookups = [];
  underLimit = false; // past today's free scans: only a credit or Pro can pay
  (globalThis as Record<string, unknown>).__scanClient = client();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function scan(body: Record<string, unknown>, jwt = "anon_harness") {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}`, "cf-connecting-ip": "198.51.100.40" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json };
}
const redeems = () => rpcLog.filter(([n]) => n === "scan_credit_redeem");

describe("an address in the request body proves nothing", () => {
  it("a stranger naming a buyer's address is refused at the limit, and the buyer keeps every credit", async () => {
    const r = await scan({ resumeText: RESUME, creditEmail: "victim@example.com" });
    expect(r.status).toBe(429);
    expect(r.json.rateLimited).toBe(true);
    expect(redeems()).toEqual([]);
    expect(balances.get("victim@example.com")).toBe(9);
    expect(aiCalls).toBe(0);
  });

  it("naming a Pro subscriber's address buys no scan, and the subscription is not even looked up", async () => {
    const r = await scan({ resumeText: RESUME, creditEmail: "pro@example.com" });
    expect(r.status).toBe(429);
    expect(proLookups).toEqual([]);
    expect(aiCalls).toBe(0);
  });

  it("a Pro subscriber signed in with Google for that address still scans past the limit, with no credit spent", async () => {
    const r = await scan({ resumeText: RESUME }, JWT.proGoogle);
    expect(r.status).toBe(200);
    expect(proLookups).toEqual([PRO_ID]);
    expect(redeems()).toEqual([]);
  });
});

describe("an address on a session proves nothing either, while sign-ups are auto-confirmed", () => {
  it("a password sign-up as a buyer's address spends none of that address's credits", async () => {
    const r = await scan({ resumeText: RESUME }, JWT.squatsVictim);
    expect(r.status).toBe(429);
    expect(r.json.mailboxUnproven).toBe(true);
    expect(String(r.json.error)).toMatch(/not used until the address is confirmed/);
    expect(redeems()).toEqual([]);
    expect(balances.get("victim@example.com")).toBe(9);
    expect(aiCalls).toBe(0);
  });

  it("a password sign-up as a subscriber's address gets no Pro: the plan is read by account, and that account holds none", async () => {
    USERS[JWT.squatsVictim].email = "pro@example.com";
    try {
      const r = await scan({ resumeText: RESUME }, JWT.squatsVictim);
      expect(r.status).toBe(429);
      expect(proLookups).toEqual([SQUATTER_ID]);
      expect(aiCalls).toBe(0);
    } finally {
      USERS[JWT.squatsVictim].email = "victim@example.com";
    }
  });

  it("the owner's own password session does not reach the address's pool either: the proof is the session, not the account", async () => {
    const r = await scan({ resumeText: RESUME }, JWT.ownerPassword);
    expect(r.status).toBe(429);
    expect(balances.get("owner@example.com")).toBe(2);
  });

  it("the owner's flag alone is not enough: while the auth server still auto-confirms, a confirmation proves nothing", async () => {
    env.EMAIL_CONFIRMED_SINCE = new Date(Date.now() - 3600_000).toISOString();
    const r = await scan({ resumeText: RESUME }, JWT.squatsVictim);
    expect(settingsReads).toBe(1);
    expect(r.status).toBe(429);
    expect(balances.get("victim@example.com")).toBe(9);
  });

  it("a password session spends a purchase its account claimed, capped at what that purchase has left", async () => {
    const first = await scan({ resumeText: RESUME }, JWT.buyerPassword);
    expect(first.status).toBe(200);
    expect(first.json.creditUsed).toBe(true);
    expect(redeems().map(([, a]) => a.p_session_hash)).toEqual([CLAIMED_HASH]);
    expect(balances.get("buyer@example.com")).toBe(4);
    // The purchase is spent; the rest of the address's pool is not this session's.
    rpcLog = [];
    const second = await scan({ resumeText: RESUME }, JWT.buyerPassword);
    expect(second.status).toBe(429);
    expect(balances.get("buyer@example.com")).toBe(4);
  });
});

describe("a proven buyer's credit is spent only when a full report is delivered", () => {
  it("a full report keeps the credit and prints the receipt", async () => {
    const r = await scan({ resumeText: RESUME }, JWT.ownerGoogle);
    expect(r.status).toBe(200);
    expect(r.json.creditUsed).toBe(true);
    expect(r.json.creditsRemaining).toBe(1);
    expect(balances.get("owner@example.com")).toBe(1);
  });

  it("the cached copy never carries the receipt", async () => {
    await scan({ resumeText: RESUME }, JWT.ownerGoogle);
    await new Promise((r) => setTimeout(r, 0));
    expect(cacheWrites.length).toBe(1);
    const report = (cacheWrites[0] as { report: Record<string, unknown> }).report;
    expect(report.creditUsed).toBeUndefined();
    expect(report.creditsRemaining).toBeUndefined();
  });

  it("a model outage serves the rule-based report and gives the credit back", async () => {
    aiOk = false;
    const r = await scan({ resumeText: RESUME }, JWT.ownerGoogle);
    expect(r.status).toBe(200);
    expect(r.json.partialResults).toBe(true);
    expect(r.json.creditUsed).toBeUndefined();
    expect(balances.get("owner@example.com")).toBe(2);
  });

  it("a cache hit is free, and an old cached receipt is not replayed", async () => {
    cacheRow = { report: { success: true, atsScoreEstimate: 70, creditUsed: true, creditsRemaining: 9 }, created_at: new Date().toISOString() };
    const r = await scan({ resumeText: RESUME }, JWT.ownerGoogle);
    expect(r.status).toBe(200);
    expect(r.json.cachedReport).toBe(true);
    expect(r.json.creditUsed).toBeUndefined();
    expect(r.json.creditsRemaining).toBeUndefined();
    expect(balances.get("owner@example.com")).toBe(2);
    expect(aiCalls).toBe(0);
  });

  it("under the daily limit nothing is redeemed at all", async () => {
    underLimit = true;
    const r = await scan({ resumeText: RESUME }, JWT.ownerGoogle);
    expect(r.status).toBe(200);
    expect(redeems()).toEqual([]);
    expect(balances.get("owner@example.com")).toBe(2);
  });
});

describe("a malformed body is the caller's mistake", () => {
  it("answers 400, not a 500 incident", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anon_harness" },
      body: "{not json",
    }));
    expect(res.status).toBe(400);
  });

  it("every answer carries the build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "free-keyword-scan", "2026-10-08")).toBe(true);
  });
});
