// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * SHORTLIST SCORED THE JD THE BROWSER SENT, AND HAD NO REVIEW WITHOUT A SCORE
 * (sweep S8-110, S8-111).
 *
 * - S8-110: shortlist-evaluate put body.jdText in the prompt while the audit
 *   row recorded only the role's jd_version, so an auditor could not tie a
 *   score to the JD it was scored against. It now scores the role's stored
 *   jd_text, read through the employer's own client, and keeps that text on
 *   the row (jd_text_scored).
 * - S8-111: the ADA "alternative review" existed only on an already-scored
 *   candidate. A candidate can now be routed to it before any scoring: a
 *   record with no score and its logged request, and no model call.
 *
 * Run against the shipped handler with only the network faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const CLIENT = `export function createClient() {
  const db = globalThis.__slDb;
  return {
    rpc: (n, a) => db.rpc(n, a),
    from: (t) => {
      const q = db.from(t);
      const insert = q.insert.bind(q);
      q.insert = (p) => insert(t === "shortlist_candidates" && !p.id ? { id: "cand-" + (++globalThis.__slSeq), ...p } : p);
      // A head count, as supabase-js answers { count } for select(cols, { count: "exact", head: true }).
      const select = q.select.bind(q);
      q.select = (cols, opts) => {
        if (!opts || !opts.head) return select(cols);
        const filters = [];
        const counted = {
          eq: (c, v) => { filters.push([c, v]); return counted; },
          then: (ok, no) => Promise.resolve({ data: null, error: null, count: db.rows(t).filter((r) => filters.every(([c, v]) => r[c] === v)).length }).then(ok, no),
        };
        return counted;
      };
      return q;
    },
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "hr@employer.test" } }, error: null }) },
  };
}`;

const STORED_JD = "Senior data engineer: Airflow, dbt and Snowflake, five years, on-call for the warehouse.";
const BODY_JD = "Junior marketing assistant: social posts and events, no experience needed at all.";
const RESUME = "Built Airflow pipelines and dbt models on Snowflake for six years; led the warehouse on-call rota. ".repeat(3);

let db: FakeDb;
let prompts: string[];
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness", LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      prompts.push(JSON.parse(String(init?.body ?? "{}")).messages?.[1]?.content ?? "");
      const args = { matchScore: 71, levelRead: "Senior", signals: [], flags: [], interviewQuestions: [] };
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("shortlist-evaluate", { "https://esm.sh/@supabase/supabase-js@2": CLIENT });
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  db.rows("shortlist_roles").push({ id: "role-1", jd_text: STORED_JD, jd_version: 3 });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  const g = globalThis as Record<string, unknown>;
  g.__slDb = db;
  g.__slSeq = 0;
  prompts = [];
});

const call = async (body: Record<string, unknown>) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/shortlist-evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-jwt", "cf-connecting-ip": "198.51.100.4" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

const inserted = (table: string) => db.writes.filter((w) => w.table === table && w.op === "insert").map((w) => w.payload as Record<string, unknown>);

describe("an evaluation", () => {
  it("scores the role's stored JD, never the one the request carries, and keeps the text it scored", async () => {
    const r = await call({ roleId: "role-1", jdText: BODY_JD, resumeText: RESUME, fileName: "Candidate 7" });
    expect(r.status).toBe(200);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(STORED_JD);
    expect(prompts[0]).not.toContain(BODY_JD);
    const [row] = inserted("shortlist_candidates");
    expect(row).toMatchObject({ jd_version: 3, jd_text_scored: STORED_JD, score: 71, owner_id: "user-1" });
  });
});

/**
 * S11-139: since 20261009111000 only this function writes shortlist_candidates,
 * as service_role, which the 10,000-row cap used to exempt. The cap now holds
 * for it (20261009134200), and a full account is told before a model call.
 */
describe("an account that holds the most evaluations it can", () => {
  it("is refused before any model call, and nothing is written", async () => {
    for (let i = 0; i < 10_000; i++) db.rows("shortlist_candidates").push({ id: `old-${i}`, owner_id: "user-1" });
    const r = await call({ roleId: "role-1", resumeText: RESUME, fileName: "Candidate 9" });
    expect(r.status, "a full account was scored anyway").toBe(409);
    expect(r.body.code).toBe("candidate_cap");
    expect(prompts).toHaveLength(0);
    expect(inserted("shortlist_candidates")).toHaveLength(0);
  });

  it("one under the cap is still scored", async () => {
    for (let i = 0; i < 9_999; i++) db.rows("shortlist_candidates").push({ id: `old-${i}`, owner_id: "user-1" });
    const r = await call({ roleId: "role-1", resumeText: RESUME, fileName: "Candidate 10" });
    expect(r.status).toBe(200);
    expect(prompts).toHaveLength(1);
  });
});

describe("alternative review before scoring", () => {
  it("records the candidate with no score and logs the request, with no model call", async () => {
    const r = await call({ roleId: "role-1", altReview: true, fileName: "Candidate 8" });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(prompts).toHaveLength(0);
    const [cand] = inserted("shortlist_candidates");
    expect(cand).toMatchObject({ role_id: "role-1", owner_id: "user-1", file_name: "Candidate 8", jd_version: 3 });
    expect(cand.score ?? null).toBeNull();
    expect(inserted("shortlist_decisions")).toEqual([
      expect.objectContaining({ candidate_id: cand.id, owner_id: "user-1", actor_email: "hr@employer.test", action: "alt_review_requested" }),
    ]);
  });
});
