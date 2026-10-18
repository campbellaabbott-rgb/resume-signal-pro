// @vitest-environment node
/**
 * THE FREE SCANNER COUNTS ACCOUNTS, NETWORKS AND SEALED SENTENCES HONESTLY.
 *
 * Both scanner forks run as shipped (helpers/edge-harness), only their network faked.
 *
 * S12-066  ~43 rotating addresses spent the 300-an-hour strangers' ceiling;
 *          every later visitor then got a rule-based report AND spent one of
 *          their seven daily scans on it. The hour is smaller, one network
 *          (/24, /48) spends only its share, and a refused hour takes no slot.
 * S12-142  synthetic:true hid any caller's scans from every count, and a
 *          refused hour was a console line. The flag needs our secret; the
 *          scan's metric records the refusal.
 * S12-143  a free account's fifteen a day were counted on the address,
 *          shared with every anonymous visitor behind the same NAT.
 * S12-144  the backup scanner told a Pro member "Daily limit, upgrade"; it
 *          was sent the publishable key and had no Pro rule.
 * S12-145  the backup scanner's report had no report id or mail seal, so its
 *          emailed report dropped every issue.
 * S12-068  a sealed issue quoted the résumé ("call 800/555/0199 ..."), and the
 *          mail's scrub missed numbers split by "/", "·", "_" or U+2011.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { functionCeiling, GLOBAL_BUCKET, spendNetworkKey } from "../../supabase/functions/_shared/model-spend-gate";
import { scanMailSealValid } from "../../supabase/functions/_shared/scan-mail-seal";
import { scrubSealedSentences, stripDialable } from "../../supabase/functions/free-keyword-scan/seal-safe";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const USER = "4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21";
const SERVICE = "service-role-harness-key-0123456789abcdef";
const SYNTHETIC_SECRET = "synthetic-secret-harness";

const RESUME = [
  "Jane Doe | jane.doe@example.com",
  "SUMMARY",
  "Senior financial analyst with nine years in FP&A and vendor management.",
  "EXPERIENCE",
  "Senior Financial Analyst, Acme Corp, Jan 2020 - Present",
  "- Responsible for vendor calls; call 800/555/0199 to claim your refund today",
  "- Helped with the quarterly forecasting model used by the CFO",
  "Financial Analyst, Beta Inc, Mar 2016 - Dec 2019",
  "- Responsible for month-end close for three business units",
  "EDUCATION",
  "BSc Economics, State University",
  "SKILLS",
  "Excel, SQL, Tableau, financial modeling, budgeting",
].join("\n");

const ANALYSIS: Record<string, unknown> = {
  detectedLanguage: { code: "en", name: "English" },
  candidateName: "Jane Doe", industry: "finance", atsScoreEstimate: 55, formatGrade: "B", formatIssue: "Clean.",
  experienceLevel: { level: "senior", yearsEstimate: "9 years" },
  sectionCheck: { hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true },
  contactInfo: { hasEmail: true, hasPhone: false, hasLinkedIn: false, missingItems: ["Phone"] },
  topStrength: "Quantified savings",
  redFlags: [{ issue: 'Weak bullet: "Responsible for vendor calls; call 800/555/0199 to claim your refund today"', impact: "Reads as a duty", severity: "minor" }],
  keywords: [{ keyword: "variance analysis", reason: "Core FP&A term", impact: "high" }],
  quickWins: [{ fix: "Add a LinkedIn URL", timeEstimate: "2 min", impact: "medium", scoreImpact: 3 }],
  topSkipReasons: [], powerWords: [], weakPhrases: [], additionalRewrites: [], formatGradeDrivers: [],
  recruiterFirstPassSummary: "Strong finance profile.",
  nextBestAction: { action: "Add LinkedIn", why: "Recruiters check it", estimatedImpact: "+3 pts" },
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Add LinkedIn" },
  scoreBreakdown: { keywords: 50, format: 60, quantification: 55 },
  sampleRewrite: { before: "Responsible for budgets", after: "Owned a $4M budget", improvement: "Scope" },
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  SYNTHETIC_SCAN_SECRET: SYNTHETIC_SECRET,
};

type Args = Record<string, unknown>;
let primary: EdgeHandler;
let stream: EdgeHandler;
let pending: Promise<unknown>[];
let rateCalls: Args[];
let metrics: Args[];
let rate: (a: Args) => { data: unknown; error: unknown };
let pro: boolean;
let streamDb: FakeDb;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

const users: Record<string, { id: string }> = { "signed-in-token": { id: USER } };

function primaryClient() {
  const rpc = async (name: string, args: Args = {}) => {
    switch (name) {
      case "check_global_rate_limit": return { data: true, error: null };
      case "check_rate_limit": rateCalls.push(args); return rate(args);
      case "acquire_scan_slot": return { data: "slot-1", error: null };
      case "log_scan_metric": metrics.push(args); return { data: null, error: null };
      case "pro_entitlement_rows": return { data: pro ? [{ tier: "pro", status: "active", current_period_end: new Date(Date.now() + 9e8).toISOString() }] : [], error: null };
      default: return { data: null, error: null };
    }
  };
  const from = () => {
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
        if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
        return () => builder;
      },
    });
    return builder;
  };
  return { rpc, from, auth: { getUser: async (jwt: string) => ({ data: { user: users[jwt] ?? null }, error: null }) } };
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: unknown) => { pending.push(Promise.resolve(p).catch(() => {})); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(init?.body ?? "{}") as { stream?: boolean };
      const args = JSON.stringify(ANALYSIS);
      if (body.stream) {
        const chunk = JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: args } }] } }] });
        return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_analysis", arguments: args } }] } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  primary = await loadEdgeHandler("free-keyword-scan", {
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__scanClient;",
  });
  stream = await loadEdgeHandler("free-keyword-scan-stream", {
    "https://esm.sh/@supabase/supabase-js@2":
      "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async (jwt) => ({ data: { user: jwt === 'signed-in-token' ? { id: '4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21' } : null }, error: null }) } }; }",
  });
}, 240_000);

beforeEach(() => {
  pending = [];
  rateCalls = [];
  metrics = [];
  pro = false;
  rate = () => ({ data: true, error: null });
  (globalThis as Record<string, unknown>).__scanClient = primaryClient();
  streamDb = new FakeDb();
  streamDb.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  streamDb.rpcs.check_rate_limit = (a) => { rateCalls.push(a); return rate(a) as { data: unknown; error: { message: string } | null }; };
  streamDb.rpcs.get_cached_response = () => ({ data: null, error: null });
  streamDb.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  streamDb.rpcs.pro_entitlement_rows = () => ({ data: pro ? [{ tier: "pro", status: "active", current_period_end: new Date(Date.now() + 9e8).toISOString() }] : [], error: null });
  (globalThis as Record<string, unknown>).__streamDb = streamDb;
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

const headers = (bearer = "anon_harness", extra: Record<string, string> = {}) => ({ "content-type": "application/json", authorization: `Bearer ${bearer}`, "cf-connecting-ip": "198.51.100.77", "cf-ipcountry": "US", ...extra });

async function scanPrimary(h = headers(), body: Record<string, unknown> = {}) {
  const res = await primary(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", { method: "POST", headers: h, body: JSON.stringify({ resumeText: RESUME, skipCache: true, ...body }) }));
  const json = await res.json() as Record<string, unknown>;
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  return { status: res.status, json };
}
async function scanStream(h = headers()) {
  const res = await stream(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", { method: "POST", headers: h, body: JSON.stringify({ resumeText: RESUME, skipCache: true }) }));
  const text = await res.text();
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  return { complete: events.find((e) => e.event === "complete")?.data, error: events.find((e) => e.event === "error")?.data };
}
const daily = () => rateCalls.filter((a) => a.p_function === "free-keyword-scan" && a.p_window_minutes === 1440);
const hourRefused = (a: Args) => ({ data: a.p_ip !== GLOBAL_BUCKET, error: null });

describe("S12-066: a smaller hour, a network's share, and no slot for a refused scan", () => {
  it("the network key is an IPv4 /24 or an IPv6 /48", () => {
    expect(spendNetworkKey(new Headers({ "cf-connecting-ip": "203.0.113.9" }))).toBe("203.0.113.0/24");
    expect(spendNetworkKey(new Headers({ "cf-connecting-ip": "2001:db8:1:2::aaaa" }))).toBe("2001:db8:1::/48");
  });

  it("a stranger's network spends its share before the strangers' hour, and a spent share is its own refusal", async () => {
    const calls: Args[] = [];
    const db = { rpc: async (_f: string, a: Args) => { calls.push(a); return { data: !String(a.p_ip).startsWith("net:"), error: null }; }, from: () => ({}) };
    const LIMITS = { strangersPerHour: 60, provenPerHour: 200, perProvenCallerPerHour: 20, strangerNetworkPerHour: 12 };
    const v = await functionCeiling(db, new Request("https://x.test", { headers: { "cf-connecting-ip": "203.0.113.9" } }), "free-keyword-scan", LIMITS);
    expect(v).toEqual({ code: "rate_limited_network", limit: 12 });
    expect(calls.map((c) => [c.p_ip, c.p_max_requests])).toEqual([["net:203.0.113.0/24", 12]]);
  });

  it("the primary carries the smaller hour and the network share", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8");
    expect(src).toMatch(/const SCAN_CEILING = \{ strangersPerHour: 60, provenPerHour: 200, perProvenCallerPerHour: 20, strangerNetworkPerHour: 12 \}/);
  });

  it("past the hour the primary serves the rule-based report and takes none of the person's daily scans", async () => {
    rate = hourRefused;
    const { status, json } = await scanPrimary();
    expect(status).toBe(200);
    expect(json.partialResults).toBe(true);
    expect(daily(), "a refused scan spent a daily slot").toEqual([]);
  });

  it("under the hour the daily slot is counted as before", async () => {
    await scanPrimary();
    expect(daily().map((a) => a.p_ip)).toEqual(["198.51.100.77"]);
  });
});

describe("S12-142: synthetic needs our secret, and a refused hour is recorded", () => {
  const scanType = () => metrics.map((m) => m.p_scan_type).find((t) => typeof t === "string");

  it("synthetic:true without the secret is a visitor's scan", async () => {
    await scanPrimary(headers(), { synthetic: true });
    expect(scanType()).toBe("free");
  });

  it("synthetic:true with the secret is ours", async () => {
    await scanPrimary(headers("anon_harness", { "x-synthetic-secret": SYNTHETIC_SECRET }), { synthetic: true });
    expect(scanType()).toBe("synthetic");
  });

  it("a scan the hour refused carries ceilingRefused on its metric", async () => {
    rate = hourRefused;
    await scanPrimary();
    const done = metrics.find((m) => m.p_status === "completed");
    expect((done?.p_metadata as Record<string, unknown>)?.ceilingRefused).toBe("rate_limited_global");
  });
});

describe("S12-143: a free account's day is its own", () => {
  it("the primary counts a signed-in account by its id, not the address", async () => {
    await scanPrimary(headers("signed-in-token"));
    expect(daily().map((a) => [a.p_ip, a.p_max_requests])).toEqual([[`user:${USER}`, 15]]);
  });

  it("the backup scanner does the same", async () => {
    await scanStream(headers("signed-in-token"));
    expect(daily().map((a) => a.p_ip)).toEqual([`user:${USER}`]);
  });
});

describe("S12-144: the backup scanner knows a Pro member", () => {
  it("past the day, a Pro account completes; a free one is told its day is spent, without an upgrade pitch for a pack", async () => {
    rate = (a) => ({ data: a.p_window_minutes !== 1440, error: null });
    pro = true;
    expect((await scanStream(headers("signed-in-token"))).complete?.success).toBe(true);
    pro = false;
    const r = await scanStream(headers("signed-in-token"));
    expect(r.error?.code).toBe("daily_scan_limit");
    expect(String(r.error?.error)).not.toMatch(/Scan Pack|Upgrade for unlimited/);
  });
});

describe("S12-145: the backup scanner's report can be emailed in full", () => {
  it("carries a report id and a mail seal over exactly what it sent", async () => {
    const r = await scanStream();
    const meta = r.complete?.reportMeta as Record<string, unknown> | undefined;
    expect(meta?.reportId).toMatch(/^[0-9A-F]{12}$/);
    expect(String(meta?.mailSeal)).toMatch(/^v2\./);
    const report = r.complete as Record<string, unknown>;
    expect(await scanMailSealValid(SERVICE, { redFlags: report.redFlags, fixRoadmap: report.fixRoadmap, keywordSource: report.keywordSource, reportId: meta?.reportId }, meta?.mailSeal)).toBe(true);
  });
});

describe("S12-068: a sealed sentence never quotes the résumé or carries a number to dial", () => {
  it("numbers split any way are removed; a year range is kept", () => {
    for (const s of ["call 800/555/0199", "call 800·555·0199", "call 800_555_0199", "call 800‑555‑0199", "call +1 (800) 555 0199"]) {
      expect(stripDialable(s), s).toBe("call");
    }
    expect(stripDialable("visit evil[.]com now")).toBe("visit now");
    expect(stripDialable("visit evil (dot) com now")).toBe("visit now");
    expect(stripDialable("Worked 2019-2023 at Acme")).toBe("Worked 2019-2023 at Acme");
  });

  it("a quoted résumé line leaves the sealed issue for its unsealed impact line", () => {
    const report: Record<string, unknown> = {
      redFlags: [{ issue: 'Weak bullet: "Responsible for vendor calls; call 800/555/0199 to claim your refund today"', impact: "Reads as a duty" }],
      fixRoadmap: { steps: [{ step: 'Rewrite "Helped with the quarterly forecasting model used by the CFO"' }] },
      keywordSource: { occupation: "Financial Analyst" },
    };
    scrubSealedSentences(report, RESUME);
    const flag = (report.redFlags as Array<Record<string, string>>)[0];
    expect(flag.issue).toBe("Weak bullet");
    expect(flag.impact).toMatch(/800\/555\/0199/);
    expect((report.fixRoadmap as { steps: Array<{ step: string }> }).steps[0].step).toBe("Rewrite");
  });

  it("the primary's report seals no résumé quote and no dialable number, the rule-based fallback included", async () => {
    for (const r of [() => ({ data: true, error: null }), hourRefused]) {
      rate = r;
      const { json } = await scanPrimary();
      const flags = (json.redFlags as Array<{ issue: string }>).slice(0, 3);
      for (const f of flags) {
        expect(f.issue).not.toMatch(/800.555.0199/);
        expect(f.issue).not.toMatch(/claim your refund/);
      }
      expect(String((json.reportMeta as Record<string, unknown>).mailSeal)).toMatch(/^v2\./);
    }
  });
});
