// @vitest-environment node
//
// Node, not jsdom: both scanner forks are bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE FREE REPORT KEEPS EVERY KEYWORD GAP, AND A TRANSLATED LABEL CANNOT CRASH IT.
 *
 *  S11-058  The primary scanner returned three missing keywords and put the
 *           next six in gatedKeywords, which wave 3 stopped rendering: half of
 *           every report's gaps vanished while its audit said "3 expected
 *           keywords missing". All of them are now in `keywords` (the card
 *           shows three and collapses the rest), and the audit counts them.
 *  S11-029  keywords[].impact and sectionCheck.sectionQuality are looked up in
 *           fixed maps by the page, but the language hint told the model to
 *           translate every string, so "alta" and "sólida" crashed the whole
 *           report and the crash was cached for a week. Null lists crashed it
 *           too. Both forks now hold the served report to values the page can
 *           draw, cached replays included, and tell the model the fixed
 *           choices stay in English.
 *
 * Run against the shipped handlers, the model faked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { keywordImpact, normalizeScanReport, sectionQualities } from "../../supabase/functions/_shared/scan-report-shape";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const RESUME = [
  "Jane Doe | jane.doe@example.com",
  "SUMMARY",
  "Platform engineer with nine years building distributed systems.",
  "EXPERIENCE",
  "Senior Software Engineer, Acme Corp, Jan 2020 - Present",
  "- Cut deploy time from 40 minutes to 6 with a new CI pipeline",
  "- Led a team of five engineers on the billing platform",
  "Software Engineer, Beta Inc, Mar 2016 - Dec 2019",
  "- Built the event pipeline in Go and PostgreSQL",
  "EDUCATION",
  "BSc Computer Science, State University",
  "SKILLS",
  "Go, Python, PostgreSQL, Docker, AWS",
].join("\n");

const SPANISH_RESUME = [
  "María López | maria.lopez@example.com",
  "RESUMEN PROFESIONAL",
  "Ingeniera de software con nueve años de experiencia en sistemas distribuidos y plataformas en la nube.",
  "EXPERIENCIA",
  "Ingeniera de Software Senior, Acme, enero de 2020 - actualidad",
  "- Reduje el tiempo de despliegue de 40 minutos a 6 con una nueva canalización de integración continua",
  "- Dirigí un equipo de cinco ingenieros en la plataforma de facturación",
  "Ingeniera de Software, Beta, marzo de 2016 - diciembre de 2019",
  "- Construí la canalización de eventos con Go y PostgreSQL para todos los clientes",
  "EDUCACIÓN",
  "Grado en Ingeniería Informática, Universidad de Madrid",
  "HABILIDADES",
  "Go, Python, PostgreSQL, Docker, AWS, liderazgo de equipos",
].join("\n");

const SIX = ["Terraform", "GraphQL", "Kafka", "gRPC", "Prometheus", "Grafana"];
const KEYWORDS = SIX.map((keyword, i) => ({ keyword, reason: `Expected for the role (${i})`, category: "tool", impact: ["alta", "High", "low", "critical", "media", "must-have"][i] }));

const ANALYSIS: Record<string, unknown> = {
  detectedLanguage: { code: "en", name: "English" },
  candidateName: "Jane Doe",
  industry: "technology",
  atsScoreEstimate: 61,
  formatGrade: "B",
  formatIssue: "Clean single-column layout.",
  experienceLevel: { level: "senior", yearsEstimate: "9 years" },
  sectionCheck: {
    hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true,
    sectionQuality: { summary: "sólida", experience: "Strong", skills: "thin", education: "adecuada" },
  },
  contactInfo: { hasEmail: true, hasPhone: false, hasLinkedIn: false, missingItems: ["Phone"] },
  topStrength: "Quantified delivery wins",
  redFlags: [{ issue: "No LinkedIn", impact: "Recruiters check it", severity: "minor" }],
  keywords: KEYWORDS,
  quickWins: [{ fix: "Add a LinkedIn URL", timeEstimate: "2 min", impact: "medium", scoreImpact: 3, category: "contact" }],
  topSkipReasons: [], powerWords: [], weakPhrases: [], additionalRewrites: [], formatGradeDrivers: [],
  recruiterFirstPassSummary: "Strong platform profile.",
  nextBestAction: { action: "Add LinkedIn", why: "Recruiters check it", estimatedImpact: "+3 pts" },
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Add LinkedIn" },
  resumeLength: { current: 1, recommended: 1 }, wordCount: { current: 110, ideal: "400-700" },
  actionVerbGrade: "B", readabilityScore: 70, keywordDensity: 3,
  scoreBreakdown: { keywords: 50, format: 70, quantification: 60 },
  industryBenchmark: { industryAvg: 66, comparison: "below", percentile: "40th" },
  sampleRewrite: { before: "Responsible for deploys", after: "Cut deploys to 6 minutes", improvement: "Scope" },
  matchingSkills: null, missingSkills: null, missingSkillsDetailed: null, skillGapActions: null,
};

describe("the shape the page can draw", () => {
  it("impact is one of three, anything else medium; quality is one of four, anything else dropped; null lists are empty", () => {
    expect(["critical", "High", " medium ", "alta", "low", "must-have", undefined, 5].map(keywordImpact))
      .toEqual(["critical", "high", "medium", "medium", "medium", "critical", "medium", "medium"]);
    expect(sectionQualities({ summary: "sólida", experience: "Strong", skills: "thin", education: 3 })).toEqual({ experience: "strong", skills: "thin" });
    const r = normalizeScanReport({ keywords: [{ keyword: "x", impact: "alta" }, null], sectionCheck: { sectionQuality: null }, matchingSkills: null, skillGapActions: "none" });
    expect(r.keywords).toEqual([{ keyword: "x", impact: "medium" }]);
    expect((r.sectionCheck as { sectionQuality: unknown }).sectionQuality).toEqual({});
    expect(r.matchingSkills).toEqual([]);
    expect(r.skillGapActions).toEqual([]);
    expect("missingSkills" in r).toBe(false);
  });
});

// ── the primary ────────────────────────────────────────────────────────────

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
let cache: Map<string, { report: unknown; created_at: string }>;
let streamDb: FakeDb;
let streamStored: unknown[];
let prompts: string[];
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
  const from = (table: string) => {
    const state: { op: string; single: boolean; eq: Record<string, unknown>; row?: Record<string, unknown> } = { op: "select", single: false, eq: {} };
    const resolve = async () => {
      if (table === "scan_report_cache") {
        if (state.op === "upsert" && state.row) {
          cache.set(String(state.row.cache_key), { report: state.row.report, created_at: String(state.row.created_at) });
          return { data: null, error: null };
        }
        if (state.op === "select" && state.single) return { data: cache.get(String(state.eq.cache_key)) ?? null, error: null };
      }
      return { data: state.single ? null : [], error: null };
    };
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => resolve().then(ok, no);
        if (prop === "maybeSingle" || prop === "single") return () => { state.single = true; return resolve(); };
        return (...a: unknown[]) => {
          if (prop === "upsert" || prop === "insert" || prop === "update" || prop === "delete") { state.op = prop; state.row = a[0] as Record<string, unknown>; }
          if (prop === "eq") state.eq[String(a[0])] = a[1];
          return builder;
        };
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
  cache = new Map();
  prompts = [];
  (globalThis as Record<string, unknown>).__scanClient = primaryClient();
  streamDb = new FakeDb();
  streamStored = [];
  streamDb.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  streamDb.rpcs.check_rate_limit = () => ({ data: true, error: null });
  streamDb.rpcs.get_cached_response = () => ({ data: null, error: null });
  streamDb.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  streamDb.rpcs.store_cached_response = (a) => { streamStored.push(a.p_response); return { data: null, error: null }; };
  (globalThis as Record<string, unknown>).__streamDb = streamDb;
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

const HEADERS = { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.41", "cf-ipcountry": "US" };

async function scanPrimary(resumeText = RESUME) {
  const res = await primary(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan", { method: "POST", headers: HEADERS, body: JSON.stringify({ resumeText }) }));
  const json = await res.json() as Record<string, unknown>;
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  return { status: res.status, json };
}

async function scanStream() {
  const res = await stream(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", { method: "POST", headers: HEADERS, body: JSON.stringify({ resumeText: RESUME, skipAdminEmail: true }) }));
  const text = await res.text();
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending);
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  return events.find((e) => e.event === "complete")?.data;
}

const kws = (r: Record<string, unknown> | undefined) => (r?.keywords as Array<{ keyword: string; impact: string }>) ?? [];

describe("S11-058: the primary returns every keyword gap", () => {
  it("all six are in keywords, none in a gated list, and the audit counts six", async () => {
    const { status, json } = await scanPrimary();
    expect(status).toBe(200);
    expect(kws(json).map((k) => k.keyword).sort()).toEqual([...SIX].sort());
    expect(json.gatedKeywords).toBeUndefined();
    const audit = JSON.stringify(json.scoreAudit);
    expect(audit).toContain("6 expected");
  });
});

describe("S11-029: a translated fixed choice never reaches the page", () => {
  it("the primary serves and caches only impacts and qualities the page draws, and empty lists for null", async () => {
    const { json } = await scanPrimary();
    for (const k of kws(json)) expect(["critical", "high", "medium"]).toContain(k.impact);
    expect((json.sectionCheck as { sectionQuality: unknown }).sectionQuality).toEqual({ experience: "strong", skills: "thin" });
    for (const f of ["matchingSkills", "missingSkills", "missingSkillsDetailed", "skillGapActions"]) expect(json[f], f).toEqual([]);
    const cached = [...cache.values()][0]?.report as Record<string, unknown>;
    expect(cached).toBeTruthy();
    for (const k of kws(cached)) expect(["critical", "high", "medium"]).toContain(k.impact);
  });

  it("a report cached with a translated label is held to the shape on replay", async () => {
    await scanPrimary();
    const [key, entry] = [...cache.entries()][0];
    const stale = { ...(entry.report as Record<string, unknown>), keywords: [{ keyword: "Kafka", reason: "r", impact: "alta" }], sectionCheck: { sectionQuality: { summary: "sólida" } }, matchingSkills: null };
    cache.set(key, { ...entry, report: stale });
    const { json } = await scanPrimary();
    expect(json.cached).toBe(true);
    expect(kws(json)[0].impact).toBe("medium");
    expect((json.sectionCheck as { sectionQuality: unknown }).sectionQuality).toEqual({});
    expect(json.matchingSkills).toEqual([]);
  });

  it("the primary's prompt for a Spanish résumé says the fixed choices stay in English", async () => {
    await scanPrimary(SPANISH_RESUME);
    const p = prompts.join("\n");
    expect(p).toContain("DETECTED RESUME LANGUAGE");
    expect(p).toContain("Fixed choices stay in English");
  });

  it("the stream fork serves and caches the same shape, and tells the model the same", async () => {
    const complete = await scanStream();
    expect(complete?.success).toBe(true);
    for (const k of kws(complete)) expect(["critical", "high", "medium"]).toContain(k.impact);
    expect((complete?.sectionCheck as { sectionQuality: unknown }).sectionQuality).toEqual({ experience: "strong", skills: "thin" });
    for (const f of ["matchingSkills", "missingSkills", "missingSkillsDetailed", "skillGapActions"]) {
      if (complete && f in complete) expect(complete[f], f).toEqual([]);
    }
    for (const stored of streamStored) for (const k of kws(stored as Record<string, unknown>)) expect(["critical", "high", "medium"]).toContain(k.impact);
    expect(prompts.join("\n")).toContain("Fixed choices stay in English");
  });
});
