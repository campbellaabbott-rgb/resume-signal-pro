// @vitest-environment node
/**
 * A FAILED ATTESTATION LOG LEFT A SCORED CANDIDATE BEHIND (S14X-289).
 *
 * WHAT WAS WRONG. shortlist-evaluate stored the candidate first and then
 * wrote the uploader's confirmation (and, on the alternative-review path, the
 * review request) to shortlist_decisions. When that second write failed it
 * answered 500 "Could not log your confirmation" and left the candidate in
 * the role's list: scored, ranked, exportable, with no logged confirmation,
 * and a retry stored a second copy.
 *
 * WHAT HOLDS NOW, running the shipped handler with the network faked: a
 * candidate is kept only with its log lines. When one cannot be written the
 * row just stored is removed again (its decisions go with it, ON DELETE
 * CASCADE), the answer says attestation_log_failed and that nothing was kept,
 * and if the removal itself fails the answer says the row is still there.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const CLIENT = `export function createClient() {
  const db = globalThis.__slDb;
  return {
    rpc: (n, a) => db.rpc(n, a),
    from: (t) => {
      const q = db.from(t);
      const insert = q.insert.bind(q);
      q.insert = (p) => insert(t === "shortlist_candidates" && !p.id ? { id: "cand-" + (++globalThis.__slSeq), ...p } : p);
      const select = q.select.bind(q);
      q.select = (cols, opts) => {
        if (!opts || !opts.head) return select(cols);
        const counted = { eq: () => counted, then: (ok, no) => Promise.resolve({ data: null, error: null, count: 0 }).then(ok, no) };
        return counted;
      };
      return q;
    },
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "hr@employer.test" } }, error: null }) },
  };
}`;

const JD = "Senior data engineer: Airflow, dbt and Snowflake, five years, on-call for the warehouse.";
const RESUME = "Built Airflow pipelines and dbt models on Snowflake for six years; led the warehouse on-call rota. ".repeat(3);
const WEBSITE = ["e30", Buffer.from(JSON.stringify({ sub: "user-1", role: "authenticated", aud: "authenticated" })).toString("base64url"), "sig"].join(".");
const FAIL = { code: "XX000", message: "fake: the log write failed" };

let db: FakeDb;
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness", LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const args = { matchScore: 70, levelRead: "Senior", signals: [], flags: [], interviewQuestions: [], manipulationSuspected: false };
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("shortlist-evaluate", { "https://esm.sh/@supabase/supabase-js@2": CLIENT });
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  db.rows("shortlist_roles").push({ id: "role-1", jd_text: JD, jd_version: 2 });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  const g = globalThis as Record<string, unknown>;
  g.__slDb = db;
  g.__slSeq = 0;
});

/** The Nth insert into shortlist_decisions fails; every other call runs. */
const failDecisionInsert = (n: number) => {
  let seen = 0;
  const take = db.takeFault.bind(db);
  db.takeFault = (table: string, op: string) => {
    if (table === "shortlist_decisions" && op === "insert" && ++seen === n) return FAIL;
    return take(table, op);
  };
};

const evaluate = async (extra: Record<string, unknown> = {}) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/shortlist-evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${WEBSITE}`, "cf-connecting-ip": "198.51.100.4" },
    body: JSON.stringify({ roleId: "role-1", resumeText: RESUME, attested: true, fileName: "Candidate 7.pdf", ...extra }),
  }));
  return { status: res.status, build: res.headers.get("x-fn-build"), body: await res.json() as Record<string, unknown> };
};

describe("a candidate is kept only with its logged confirmation", () => {
  it("a scored candidate whose confirmation cannot be logged is removed, and the answer says so", async () => {
    failDecisionInsert(1);
    const r = await evaluate();
    expect(buildIsAtLeast(r.build, "shortlist-evaluate", "2026-11-09", 2), String(r.build)).toBe(true);
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: "attestation_log_failed", kept: false });
    expect(String(r.body.error)).toMatch(/not kept/);
    expect(db.rows("shortlist_candidates")).toEqual([]);
    expect(db.writes.filter((w) => w.table === "shortlist_candidates").map((w) => w.op)).toEqual(["insert", "delete"]);
  });

  it("an alternative review whose request cannot be logged is removed", async () => {
    failDecisionInsert(1);
    const r = await evaluate({ altReview: true, resumeText: "" });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: "attestation_log_failed", kept: false });
    expect(db.rows("shortlist_candidates")).toEqual([]);
  });

  it("an alternative review whose confirmation cannot be logged is removed", async () => {
    failDecisionInsert(2);
    const r = await evaluate({ altReview: true, resumeText: "" });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: "attestation_log_failed", kept: false });
    expect(db.rows("shortlist_candidates")).toEqual([]);
  });

  it("when the removal fails too, the answer says the row is still there", async () => {
    failDecisionInsert(1);
    db.faults.push({ table: "shortlist_candidates", op: "delete", error: FAIL });
    const r = await evaluate();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: "attestation_log_failed", kept: true });
    expect(String(r.body.error)).toMatch(/could not be removed/);
    expect(db.rows("shortlist_candidates")).toHaveLength(1);
  });

  it("a candidate whose confirmation is logged stays, with its log line", async () => {
    const r = await evaluate();
    expect(r.status).toBe(200);
    expect(db.rows("shortlist_candidates")).toHaveLength(1);
    expect(db.rows("shortlist_decisions").map((d) => d.new_value)).toEqual([expect.stringMatching(/^uploader_attested:/)]);
  });
});
