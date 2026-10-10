// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE SCAN FALLBACK THREW ON A NULL KEYWORD AND CACHED A THIN REPLY.
 *
 * The wave 3 deploy note said free-keyword-scan-stream was kept in step with
 * the primary's partial-report rules. It was not. keywords: [null] from the
 * model reached the keyword filter unshaped and threw a TypeError after the
 * day's slot was counted, so the browser saw "An error occurred". And every
 * completed analysis went to store_cached_response, however little the
 * model wrote, so a near-empty reply replayed to each rescan for its TTL.
 *
 * Run against the shipped handler, the model's stream faked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const CLIENT =
  "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }";
const STUBS: Record<string, string> = { "https://esm.sh/@supabase/supabase-js@2": CLIENT };

const RESUME = "Jane Q. Candidate\nEXPERIENCE\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts\n- Built the monthly close model in Excel and SQL\nEDUCATION\nBSc Economics, State University\nSKILLS\nExcel, SQL, Tableau\n";

const FULL = {
  detectedLanguage: { code: "en", name: "English" },
  industry: "finance",
  atsScoreEstimate: 62,
  formatGrade: "B",
  formatIssue: "Single column.",
  experienceLevel: { level: "Senior", yearsEstimate: "6 years" },
  sectionCheck: { hasContact: true, hasSummary: false, hasExperience: true, hasEducation: true, hasSkills: true },
  topStrength: { title: "Quantified savings", description: "Cut vendor spend by $250,000" },
  redFlags: [{ issue: "No summary", impact: "Recruiters skim the top" }],
  keywords: [{ keyword: "variance analysis", reason: "Core FP&A term" }],
  quickWins: [{ fix: "Add a summary", timeEstimate: "5 min", impact: "medium" }],
  improvementPotential: { level: "moderate", estimatedScoreIncrease: 6, topPriority: "Add a summary" },
};

let handler: EdgeHandler;
let db: FakeDb;
let toolArgs: string;
let stores: number;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness",
    SUPABASE_ANON_KEY: "anon_harness",
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: unknown) => { Promise.resolve(p).catch(() => {}); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(init?.body ?? "{}") as { stream?: boolean };
      if (!body.stream) return new Response(JSON.stringify({ error: "only the streamed analysis is faked" }), { status: 400 });
      const chunk = JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: toolArgs } }] } }] });
      return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("free-keyword-scan-stream", STUBS);
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  db.rpcs.release_scan_slot = () => ({ data: null, error: null });
  db.rpcs.log_scan_metric = () => ({ data: null, error: null });
  db.rpcs.increment_free_scan_count = () => ({ data: null, error: null });
  stores = 0;
  db.rpcs.store_cached_response = () => { stores++; return { data: null, error: null }; };
  (globalThis as Record<string, unknown>).__streamDb = db;
  toolArgs = JSON.stringify(FULL);
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

async function scan() {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.22", "cf-ipcountry": "US" },
    body: JSON.stringify({ resumeText: RESUME, skipAdminEmail: true }),
  }));
  const text = await res.text();
  await new Promise((r) => setTimeout(r, 0));
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  return { complete: events.find((e) => e.event === "complete")?.data, error: events.find((e) => e.event === "error")?.data };
}

describe("the fallback's model JSON", () => {
  it("is a report, not an error, when keywords holds a null and industry is a number", async () => {
    toolArgs = JSON.stringify({ ...FULL, keywords: [null, { keyword: "variance analysis", reason: "Core term" }], redFlags: [null], industry: 5 });
    const r = await scan();
    expect(r.error).toBeUndefined();
    expect(r.complete?.success).toBe(true);
  });

  it("a whole reply is cached and not marked partial", async () => {
    const r = await scan();
    expect(r.complete?.partialResults).toBeUndefined();
    expect(stores).toBe(1);
  });

  it("a thin reply is served marked partial and never cached", async () => {
    toolArgs = JSON.stringify({ industry: "finance", atsScoreEstimate: 55, keywords: [], redFlags: [] });
    const r = await scan();
    expect(r.complete?.partialResults).toBe(true);
    expect(r.complete?.partialReason).toBe("thin");
    expect(stores).toBe(0);
  });
});
