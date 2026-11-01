// @vitest-environment node
//
// Node, not jsdom: both scanner forks are bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE FREE SCAN READS THE WHOLE RÉSUMÉ, AND SAYS WHAT IT COULD NOT.
 *
 *  S13-008  Both prompts put only the first 20,000 characters inside
 *           <resume> (the fallback 15,000), about five pages, with no notice.
 *           A long CV was scored, summarised, given its page count ("5 / 2
 *           pages" for an 11-page file) and its missing skills from the first
 *           part. Now the whole text is sent (the server refuses anything over
 *           50,000 characters), resumeTruncated says whether anything was
 *           cut, a "missing skill" the full résumé holds is dropped, and the
 *           page and word counts come from the full text.
 *  S13-024  A résumé in a language the report is not built for carries a
 *           languageNotice; an English one carries null.
 *  S13-005  The detected hiring system reaches the page by its name.
 *
 * Run against the shipped handlers, the model faked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

// About 32,000 characters: past the old 20,000 and 15,000 cuts. The last role
// and the skills line, with Kubernetes, sit at the end.
const ROLE = (i: number) => [
  `Operations Lead, Northwind Site ${i}, Jan ${2000 + (i % 20)} - Dec ${2001 + (i % 20)}`,
  `- Ran the night shift for site ${i}, coordinating forty staff across receiving, picking and dispatch`,
  `- Rebuilt the slotting plan for site ${i}, which cut average pick travel by a fifth over two quarters`,
  `- Trained eleven new supervisors at site ${i} on safety walks, root-cause reviews and shift handover notes`,
].join("\n");
const LONG_RESUME = [
  "Sam Rivera | sam.rivera@example.com",
  "SUMMARY",
  "Operations leader with two decades running distribution sites and the systems behind them.",
  "EXPERIENCE",
  ...Array.from({ length: 90 }, (_, i) => ROLE(i + 1)),
  "Platform Operations Manager, Zanzibar Logistics, Jan 2021 - Present",
  "- Moved the warehouse control system onto containers run with Kubernetes and Helm",
  "EDUCATION",
  "BSc Industrial Engineering, State University",
  "SKILLS",
  "Kubernetes, Helm, SQL, Lean, Six Sigma",
].join("\n");
const JD = "Operations Platform Manager. You will run Kubernetes clusters, write Terraform, own SQL reporting and lead site teams.";

const ANALYSIS: Record<string, unknown> = {
  detectedLanguage: { code: "en", name: "English" },
  candidateName: "Sam Rivera",
  industry: "logistics",
  atsScoreEstimate: 62,
  formatGrade: "B",
  formatIssue: "Long but clean.",
  experienceLevel: { level: "senior", yearsEstimate: "20 years" },
  sectionCheck: { hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, sectionQuality: {} },
  contactInfo: { hasEmail: true, hasPhone: false, hasLinkedIn: false, missingItems: [] },
  topStrength: "Two decades of site leadership",
  redFlags: [], keywords: [], quickWins: [],
  topSkipReasons: [], powerWords: [], weakPhrases: [], additionalRewrites: [], formatGradeDrivers: [],
  recruiterFirstPassSummary: "Seasoned operations leader.",
  nextBestAction: null,
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Trim" },
  // what a model that read five pages would say
  resumeLength: { currentPages: 5, recommendedPages: 2, verdict: "too_long" },
  wordCount: { current: 2900, idealMin: 400, idealMax: 850, verdict: "too_many" },
  actionVerbGrade: "B", readabilityScore: 70, keywordDensity: 3,
  scoreBreakdown: { keywords: 50, format: 70, quantification: 60 },
  matchingSkills: ["SQL"],
  missingSkills: ["Kubernetes", "Terraform"],
  missingSkillsDetailed: [{ skill: "Kubernetes", importance: "high" }, { skill: "Terraform", importance: "high" }],
  skillGapActions: [],
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  NOTIFY_SCANS: "false",
};

let primary: EdgeHandler;
let stream: EdgeHandler;
let pending: Promise<unknown>[];
let prompts: string[];
let streamDb: FakeDb;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

function primaryClient() {
  const rpc = async (name: string) => {
    switch (name) {
      case "check_global_rate_limit":
      case "check_rate_limit": return { data: true, error: null };
      case "acquire_scan_slot": return { data: "slot-1", error: null };
      default: return { data: null, error: null };
    }
  };
  const from = () => {
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
        return () => builder;
      },
    });
    return builder;
  };
  return { rpc, from, auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: unknown) => { pending.push(Promise.resolve(p).catch(() => {})); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(init?.body ?? "{}") as { stream?: boolean; messages?: Array<{ content?: unknown }> };
      for (const m of body.messages ?? []) if (typeof m.content === "string") prompts.push(m.content);
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
      "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }",
  });
}, 240_000);

beforeEach(() => {
  pending = [];
  prompts = [];
  (globalThis as Record<string, unknown>).__scanClient = primaryClient();
  streamDb = new FakeDb();
  streamDb.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  streamDb.rpcs.check_rate_limit = () => ({ data: true, error: null });
  streamDb.rpcs.get_cached_response = () => ({ data: null, error: null });
  streamDb.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  streamDb.rpcs.store_cached_response = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__streamDb = streamDb;
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

const HEADERS = { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.42", "cf-ipcountry": "US" };

async function scanPrimary(body: Record<string, unknown>) {
  const res = await primary(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", { method: "POST", headers: HEADERS, body: JSON.stringify(body) }));
  const json = await res.json() as Record<string, unknown>;
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  return { status: res.status, json };
}

async function scanStream(body: Record<string, unknown>) {
  const res = await stream(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", { method: "POST", headers: HEADERS, body: JSON.stringify({ skipAdminEmail: true, ...body }) }));
  const text = await res.text();
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  return events.find((e) => e.event === "complete")?.data;
}

const fullWords = LONG_RESUME.split(/\s+/).filter(Boolean).length;

describe("S13-008: the primary reads the whole résumé", () => {
  it("the test résumé is past both old cuts", () => {
    expect(LONG_RESUME.length).toBeGreaterThan(30_000);
    expect(LONG_RESUME.length).toBeLessThan(50_000);
  });

  it("the prompt carries the last role and the skills line, and resumeTruncated is false", async () => {
    const { status, json } = await scanPrimary({ resumeText: LONG_RESUME, jobDescriptionText: JD });
    expect(status).toBe(200);
    const p = prompts.join("\n");
    expect(p).toContain("Zanzibar Logistics");
    expect(p).toContain("Kubernetes, Helm, SQL, Lean, Six Sigma");
    expect(json.resumeTruncated).toBe(false);
  });

  it("a missing skill the full résumé holds is dropped; one it lacks stays", async () => {
    const { json } = await scanPrimary({ resumeText: LONG_RESUME, jobDescriptionText: JD });
    expect(json.missingSkills).toEqual(["Terraform"]);
    expect((json.missingSkillsDetailed as Array<{ skill: string }>).map((s) => s.skill)).toEqual(["Terraform"]);
  });

  it("the page and word counts come from the full text", async () => {
    const { json } = await scanPrimary({ resumeText: LONG_RESUME });
    const rl = json.resumeLength as { currentPages: number; recommendedPages: number; verdict: string };
    expect(rl.currentPages).toBeGreaterThanOrEqual(Math.ceil(fullWords / 700));
    expect(rl.currentPages).toBeLessThanOrEqual(Math.ceil(fullWords / 400));
    expect(rl.verdict).toBe("too_long");
    expect((json.wordCount as { current: number }).current).toBe(fullWords);
  });

  it("a model's count the text allows is kept", async () => {
    const short = ["Ana Ruiz | ana@example.com", "EXPERIENCE", ROLE(1), ROLE(2), "EDUCATION", "BA, State University", "SKILLS", "SQL, Excel"].join("\n");
    const saved = ANALYSIS.resumeLength;
    ANALYSIS.resumeLength = { currentPages: 1, recommendedPages: 1, verdict: "just_right" };
    try {
      const { json } = await scanPrimary({ resumeText: short });
      expect(json.resumeLength).toMatchObject({ currentPages: 1, verdict: "just_right" });
    } finally {
      ANALYSIS.resumeLength = saved;
    }
  });

  it("over 50,000 characters is still refused, before any model call", async () => {
    const { status } = await scanPrimary({ resumeText: LONG_RESUME + "x".repeat(25_000) });
    expect(status).toBe(400);
    expect(prompts).toEqual([]);
  });
});

describe("S13-008: the fallback reads the whole résumé too", () => {
  it("the prompt carries the end of a 32,000-character résumé, and resumeTruncated is false", async () => {
    const complete = await scanStream({ resumeText: LONG_RESUME });
    expect(complete?.success).toBe(true);
    expect(prompts.join("\n")).toContain("Zanzibar Logistics");
    expect(complete?.resumeTruncated).toBe(false);
  });
});

describe("the prompts keep no fixed cut", () => {
  const root = resolve(__dirname, "../../supabase/functions");
  it("neither fork slices the résumé at 20,000 or 15,000", () => {
    expect(readFileSync(resolve(root, "free-keyword-scan/index.ts"), "utf8")).not.toMatch(/resumeText\.substring\(0, 20000\)/);
    expect(readFileSync(resolve(root, "free-keyword-scan-stream/index.ts"), "utf8")).not.toMatch(/resumeText\.substring\(0, 15000\)/);
  });
});
