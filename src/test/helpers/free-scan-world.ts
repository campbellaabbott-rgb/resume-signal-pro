/**
 * BOTH FREE SCANNERS, LOADED AS THEY DEPLOY, WITH THEIR DATABASE AND MODEL
 * GATEWAY FAKED (the bug round's free-scan-engine tests share this).
 *
 * The primary (free-keyword-scan) and its backup fork
 * (free-keyword-scan-stream) are bundled by edge-harness.ts. Every database
 * call is recorded by a ProxyDb (one per scanner), so a test asserts on the
 * rpc a run made, its arguments and its order; every fetch is recorded with
 * its body. The gateway answers through `world.gateway`, which a test swaps
 * for a failing or a hanging one.
 *
 * Node environment only (esbuild).
 */
import { loadEdgeHandler, type EdgeHandler } from "./edge-harness";
import { ProxyDb, type Answer, type Query } from "./proxy-db";

export const SCAN_ENV: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  RESEND_API_KEY: "re_harness",
};

export const RESUME = [
  "Jane Doe | jane.doe@example.com | (415) 555-0134",
  "SUMMARY",
  "Senior financial analyst with nine years in FP&A and vendor management.",
  "EXPERIENCE",
  "Senior Financial Analyst, Acme Corp, Jan 2020 - Present",
  "- Cut vendor spend by $250,000 annually by renegotiating contracts",
  "- Built the quarterly forecasting model used by the CFO",
  "Financial Analyst, Beta Inc, Mar 2016 - Dec 2019",
  "- Led month-end close for three business units",
  "EDUCATION",
  "BSc Economics, State University",
  "SKILLS",
  "Excel, SQL, Tableau, financial modeling, budgeting",
].join("\n");

/** A complete model report for RESUME (the shape submit_analysis returns). */
export const ANALYSIS: Record<string, unknown> = {
  detectedLanguage: { code: "en", name: "English" },
  candidateName: "Jane Doe", industry: "finance", atsScoreEstimate: 55, formatGrade: "B", formatIssue: "Clean.",
  experienceLevel: { level: "senior", yearsEstimate: "9 years" },
  sectionCheck: { hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true },
  contactInfo: { hasEmail: true, hasPhone: true, hasLinkedIn: false, missingItems: ["LinkedIn"] },
  topStrength: "Quantified savings",
  redFlags: [{ issue: "No LinkedIn", impact: "Recruiters check it", severity: "minor" }],
  keywords: [{ keyword: "variance analysis", reason: "Core FP&A term", impact: "high" }],
  quickWins: [{ fix: "Add a LinkedIn URL", timeEstimate: "2 min", impact: "medium", scoreImpact: 3 }],
  topSkipReasons: [], powerWords: [], weakPhrases: [], additionalRewrites: [], formatGradeDrivers: [],
  recruiterFirstPassSummary: "Strong finance profile.",
  nextBestAction: { action: "Add LinkedIn", why: "Recruiters check it", estimatedImpact: "+3 pts" },
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Add LinkedIn" },
  scoreBreakdown: { keywords: 50, format: 60, quantification: 55 },
  sampleRewrite: { before: "Responsible for budgets", after: "Owned a $4M budget", improvement: "Scope" },
};

export type GatewayReply = (body: Record<string, unknown>, signal: AbortSignal | undefined) => Response | Promise<Response>;

/** The gateway answering every call with `analysis`, streamed when the call asks for a stream. */
export const gatewayAnswering = (analysis: Record<string, unknown>): GatewayReply => (body) => {
  const args = JSON.stringify(analysis);
  if (body.stream) {
    const chunk = JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: args } }] } }] });
    return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_analysis", arguments: args } }] } }] }), { status: 200 });
};

/** The gateway failing every call with `status`. */
export const gatewayFailing = (status: number): GatewayReply => () => new Response(JSON.stringify({ error: `gateway ${status}` }), { status });

/** The gateway that never answers until the call is aborted; `onCall` runs as each call arrives. */
export const gatewayHanging = (onCall: () => void): GatewayReply => (_body, signal) => new Promise<Response>((_ok, no) => {
  onCall();
  const stop = () => no(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop);
});

/** The rpc answers both scanners need to reach their model: rate limits allow, the slot is free, nothing cached. */
export function scannerDefaults(q: Query): Answer | undefined {
  if (q.rpc === "check_global_rate_limit" || q.rpc === "check_rate_limit") return { data: true, error: null };
  if (q.rpc === "acquire_scan_slot") return { data: "slot-1", error: null };
  if (q.rpc) return { data: null, error: null };
  return undefined;
}

export const world = {
  primaryDb: new ProxyDb(),
  streamDb: new ProxyDb(),
  fetched: [] as Array<{ url: string; body: string }>,
  pending: [] as Promise<unknown>[],
  gateway: gatewayAnswering(ANALYSIS) as GatewayReply,
  /** Per-test answers, read before scannerDefaults. */
  answer: ((_q: Query): Answer | undefined => undefined) as (q: Query) => Answer | undefined,
};

const clientOver = (db: ProxyDb) => ({
  rpc: (n: string, a?: Record<string, unknown>) => db.rpc(n, a),
  from: (t: string) => db.from(t),
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
});

/** A fresh world for each test: new databases, nothing fetched, the gateway answering ANALYSIS. */
export function resetWorld(): void {
  world.primaryDb = new ProxyDb();
  world.streamDb = new ProxyDb();
  for (const db of [world.primaryDb, world.streamDb]) db.answer = (q) => world.answer(q) ?? scannerDefaults(q);
  world.fetched = [];
  world.pending = [];
  world.gateway = gatewayAnswering(ANALYSIS);
  world.answer = () => undefined;
  const g = globalThis as Record<string, unknown>;
  g.__scanClient = clientOver(world.primaryDb);
  g.__streamClient = clientOver(world.streamDb);
}

let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => SCAN_ENV[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: unknown) => { world.pending.push(Promise.resolve(p).catch(() => {})); } };
  g.fetch = async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    const u = String(url);
    world.fetched.push({ url: u, body: typeof init?.body === "string" ? init.body : "" });
    if (u.includes("ai.gateway.lovable.dev")) {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(init?.body ?? "{}"); } catch { body = {}; }
      return world.gateway(body, init?.signal);
    }
    return new Response("{}", { status: 200 });
  };
  resetWorld();
}

/** Bundle the named scanners (each once per test file). */
export async function loadScanners(which: Array<"primary" | "stream">): Promise<{ primary: EdgeHandler; stream: EdgeHandler }> {
  install();
  const out = {} as { primary: EdgeHandler; stream: EdgeHandler };
  if (which.includes("primary")) {
    out.primary = await loadEdgeHandler("free-keyword-scan", {
      "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__scanClient;",
    });
  }
  if (which.includes("stream")) {
    out.stream = await loadEdgeHandler("free-keyword-scan-stream", {
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__streamClient; }",
    });
  }
  return out;
}

export const HEADERS: Record<string, string> = {
  "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.77", "cf-ipcountry": "US",
};

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.allSettled(world.pending);
}

/** POST to the primary and wait for everything it handed to waitUntil. */
export async function scanPrimary(primary: EdgeHandler, body: Record<string, unknown> = { resumeText: RESUME }, headers: Record<string, string> = {}) {
  const res = await primary(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", { method: "POST", headers: { ...HEADERS, ...headers }, body: JSON.stringify(body) }));
  const json = await res.json() as Record<string, unknown>;
  await settle();
  return { status: res.status, json };
}

/** POST to the stream fork, read its events, and wait for its background work. */
export async function scanStream(stream: EdgeHandler, body: Record<string, unknown> = { resumeText: RESUME }, init: { signal?: AbortSignal; read?: boolean } = {}) {
  const res = await stream(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
    method: "POST", headers: HEADERS, body: JSON.stringify(body), signal: init.signal,
  }));
  let text = "";
  if (init.read !== false) text = await res.text();
  await settle();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  return { events, complete: events.find((e) => e.event === "complete")?.data, error: events.find((e) => e.event === "error")?.data };
}

/** Wait for background work started by a request the test did not await to the end. */
export const settleWorld = settle;

/** The rpc names a database saw, in order. */
export const rpcNames = (db: ProxyDb): string[] => db.queries.filter((q) => q.rpc).map((q) => q.rpc as string);

/** The scan_metrics statuses logged through log_scan_metric. */
export const metricStatuses = (db: ProxyDb): string[] => db.rpcArgs("log_scan_metric").map((a) => String(a.p_status));

export const modelCalls = (): number => world.fetched.filter((f) => f.url.includes("ai.gateway.lovable.dev")).length;
