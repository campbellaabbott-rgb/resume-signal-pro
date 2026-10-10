// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * A CAREER REPORT SHIPPED WHOLE WHEN A SECTION WAS MISSING, OR ITS VERDICTS
 * WERE TRANSLATED (sweep S8-073, S8-034).
 *
 * generate-career-snapshot and generate-graduate-gameplan answered 200
 * whenever four top-level keys were present. A reply without
 * seniorityAlignment, a week of the 30-day plan or the networking playbook
 * was saved, emailed and marked delivered, then crashed the success page,
 * and recovery returned the same copy. And the language instruction told the
 * model to translate every label, so a Spanish buyer's "Strong" came back as
 * "Fuerte", which the page draws as a red 30% gauge.
 *
 * Run against the shipped handlers with only the network faked: an
 * incomplete reply makes the generator ask the next model; a complete one
 * ships with its verdicts in English; when no model completes it, the answer
 * is a retryable 502, never a 200.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT =
  "export function createClient() { const db = globalThis.__crDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://deno.land/std@0.190.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
};

const SNAPSHOT_ES = {
  careerSignalScore: {
    overall: "Fuerte",
    performanceSignal: { score: "Fuerte", summary: "Supera sus cuotas." },
    trajectorySignal: { score: "Crecimiento", summary: "Ascensos constantes." },
    credibilitySignal: { score: "Alta", summary: "Permanencias largas." },
    seniorityAlignment: { currentLevel: "Sénior", targetFit: "Alineado", summary: "Encaja." },
  },
  recruiterPerception: { summary: "Una ingeniera sénior sólida." },
  topStrengths: [{ strength: "Pagos", evidence: "Migró el sistema de pagos." }],
  careerRisks: [],
  positioningGuidance: { idealPositioning: "IC sénior.", rolesToTarget: ["Staff"], rolesToAvoid: "Gerente", companyStages: ["Serie B"], storyFraming: "Multiplicadora." },
  priorityFixes: [{ fix: "Añadir mentoría", impact: "Alto", timeEstimate: "15 minutos" }],
};
const { seniorityAlignment: _drop, ...SIGNAL_WITHOUT_SENIORITY } = SNAPSHOT_ES.careerSignalScore;
const SNAPSHOT_MISSING = { ...SNAPSHOT_ES, careerSignalScore: SIGNAL_WITHOUT_SENIORITY };

const WEEK = { focus: "Focus", tasks: ["Task"] };
const GAMEPLAN = {
  resumeReadinessGate: { verdict: "Listo para postular", confidence: "Alta", summary: "Listo.", quickFixes: [] },
  roleTargetingMap: { summary: "Junior.", priorityRoles: [{ title: "Junior Engineer", whyFit: "CS." }], rolesToAvoid: [] },
  applicationStrategy: { weeklyTarget: "15", whereToApply: [{ channel: "Career pages", priority: "Alta", tip: "Apply early." }], whatToAvoid: [], keyInsight: "Referrals." },
  networkingPlaybook: { approach: "Alumni.", outreachScript: { scenario: "Cold", script: "Hi" }, linkedInTips: [] },
  interviewReadiness: { summary: "STAR.", storiesToPrepare: [], whyThisRole: "Mission.", projectTalkingPoints: [] },
  thirtyDayPlan: { week1: WEEK, week2: WEEK, week3: WEEK, week4: WEEK },
};
const { networkingPlaybook: _n, ...GAMEPLAN_MISSING } = GAMEPLAN;

let db: FakeDb;
let replies: unknown[];
let asked: Array<{ model: string; system: string }>;
const handlers = new Map<string, EdgeHandler>();

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key",
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      asked.push({ model: body.model, system: body.messages?.[0]?.content ?? "" });
      const next = replies.length > 1 ? replies.shift() : replies[0];
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(next) } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  for (const fn of ["generate-career-snapshot", "generate-graduate-gameplan"]) handlers.set(fn, await loadEdgeHandler(fn, STUBS));
}, 180_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  db.rows("used_stripe_sessions").push({ session_id: "cs_paid", product_type: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  (globalThis as Record<string, unknown>).__crDb = db;
  asked = [];
});

async function generate(fn: string) {
  const res = await handlers.get(fn)!(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.4" },
    body: JSON.stringify({ resumeText: "Jane Doe, senior engineer. ".repeat(20), language: "es", sessionId: "cs_paid" }),
  }));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("the Career Snapshot generator", () => {
  it("asks the next model when a section is missing, and ships the complete reply with English verdicts", async () => {
    replies = [SNAPSHOT_MISSING, SNAPSHOT_ES];
    const r = await generate("generate-career-snapshot");
    expect(r.status).toBe(200);
    expect(asked.map((a) => a.model)).toEqual(["google/gemini-2.5-pro", "google/gemini-2.5-flash"]);
    const s = r.body.data.careerSignalScore;
    expect([s.overall, s.performanceSignal.score, s.trajectorySignal.score, s.credibilitySignal.score]).toEqual(["Strong", "Strong", "Growth", "High"]);
    expect([s.seniorityAlignment.currentLevel, s.seniorityAlignment.targetFit]).toEqual(["Senior", "Aligned"]);
    expect(r.body.data.positioningGuidance.rolesToAvoid).toEqual(["Gerente"]);
    expect(r.body.modelUsed).toBe("google/gemini-2.5-flash");
  });

  it("answers a retryable 502, never a 200, when no model returns the whole report", async () => {
    replies = [SNAPSHOT_MISSING];
    const r = await generate("generate-career-snapshot");
    expect(r.status).toBe(502);
    expect(r.body.retryable).toBe(true);
    expect(r.body.data).toBeUndefined();
    expect(asked.length).toBe(3);
  });

  it("tells a Spanish buyer's model to keep the fixed choices in English", async () => {
    replies = [SNAPSHOT_ES];
    await generate("generate-career-snapshot");
    expect(asked[0].system).toMatch(/Spanish/);
    expect(asked[0].system).toMatch(/fixed choice[^.]*exactly as written in English/);
    expect(asked[0].system).not.toMatch(/all text, labels/);
  });
});

describe("the Graduate Game Plan generator", () => {
  it("asks the next model when the networking playbook is missing, and ships English verdicts", async () => {
    replies = [GAMEPLAN_MISSING, GAMEPLAN];
    const r = await generate("generate-graduate-gameplan");
    expect(r.status).toBe(200);
    expect(asked.length).toBe(2);
    expect(r.body.data.resumeReadinessGate.verdict).toBe("Ready to Apply");
    expect(r.body.data.resumeReadinessGate.confidence).toBe("High");
    expect(r.body.data.applicationStrategy.whereToApply[0].priority).toBe("High");
  });

  it("answers a retryable 502 when every reply lacks a week of the plan", async () => {
    const { week4: _w, ...threeWeeks } = GAMEPLAN.thirtyDayPlan;
    replies = [{ ...GAMEPLAN, thirtyDayPlan: threeWeeks }];
    const r = await generate("generate-graduate-gameplan");
    expect(r.status).toBe(502);
    expect(r.body.retryable).toBe(true);
  });
});
