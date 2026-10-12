// @vitest-environment node
/**
 * A CV IS NEVER LOGGED OR STORED.
 *
 * The wave-4 review found the privacy sentence false: find_roles_for_my_cv
 * took the CV itself as a prompt argument and echoed it back into the
 * conversation, and fit_resume takes a CV. Owner decision 2026-10-11: the
 * argument comes off the prompt (the person's AI reads the CV in the chat and
 * sends job titles and places), and the one tool that receives a CV —
 * fit_resume, on the key surface only — holds it in memory and forwards it to
 * the scorer, nothing else.
 *
 * A sentinel CV is planted in a prompt's arguments, in apply_myself's
 * arguments and in fit_resume's, on the happy path and on a scorer fault, and
 * it must appear in no console line, no database call and no request to any
 * function but the scorer.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SENTINEL = "SENTINEL-CV-7f3a9 registered nurse at St Example's 2019-2024 ICU triage";
const CV = `${SENTINEL} `.repeat(6);
const URL_ = "https://harness.supabase.co/functions/v1/agent-mcp";
let handler: EdgeHandler;
let outbound: Array<{ url: string; body: string }>;
let dbCalls: string[];
let scorerStatus: number;
let lines: string[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body?: string } = {}) => {
    outbound.push({ url: String(url), body: String(init.body ?? "") });
    if (String(url).endsWith("/functions/v1/job-board")) {
      const body = JSON.parse(String(init.body ?? "{}")) as { action?: string; id?: string };
      if (body.action === "detail") return new Response(JSON.stringify({ job: { id: body.id, source: "workday", token: "acme", title: "Nurse", company: "Acme" }, description: "Nurse." }), { status: 200 });
      return new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme", title: "Nurse", company: "Acme" }], total: 1 }), { status: 200 });
    }
    if (String(url).endsWith("/functions/v1/job-fit")) {
      return scorerStatus === 200
        ? new Response(JSON.stringify({ fits: { "greenhouse:acme:1": 71 }, matched: {}, missing: {} }), { status: 200 })
        : new Response(JSON.stringify({ error: "worker crashed" }), { status: scorerStatus });
    }
    return new Response("{}", { status: 404 });
  };
  g.__mcpDb = {
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      dbCalls.push(`${name} ${JSON.stringify(args)}`);
      const data = name === "api_key_check"
        ? { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "paid", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }
        : name === "mcp_anon_check_v2"
        ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: 100, share_used: 1, share_cap: 4000, overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 15 }
        : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r, single: () => r });
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const record = (op: string) => (...a: unknown[]) => { dbCalls.push(`${table}.${op} ${JSON.stringify(a)}`); return q; };
      for (const op of ["select", "eq", "is", "not", "in", "insert", "update", "upsert", "order", "limit"]) q[op] = record(op);
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return q;
    },
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 120_000);

beforeEach(() => {
  outbound = [];
  dbCalls = [];
  scorerStatus = 200;
  lines = [];
  for (const level of ["log", "warn", "error", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); });
  }
});
afterEach(() => { vi.restoreAllMocks(); });

const rpc = async (method: string, params: Record<string, unknown>, key?: string) => {
  const res = await handler(new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  return await res.text();
};
const assertNowhere = () => {
  expect(lines.filter((l) => l.includes("SENTINEL-CV")), "a console line carries the CV").toEqual([]);
  expect(dbCalls.filter((c) => c.includes("SENTINEL-CV")), "a database call carries the CV").toEqual([]);
  expect(outbound.filter((o) => o.body.includes("SENTINEL-CV") && !o.url.endsWith("/functions/v1/job-fit")).map((o) => o.url), "a request to anything but the scorer carries the CV").toEqual([]);
};

describe("a CV planted anywhere reaches no log, no table and no function but the scorer", () => {
  it("in a prompt's arguments: dropped, never echoed into the prompt body", async () => {
    for (const name of ["find_roles_for_my_cv", "browse_jobs", "apply_myself", "apply_to_my_shortlist"]) {
      const text = await rpc("prompts/get", { name, arguments: { resume_text: CV, location: "Leeds", id: "greenhouse:acme:1" } });
      expect(text, name).not.toContain("SENTINEL-CV");
    }
    assertNowhere();
  });

  it("in apply_myself's arguments: ignored", async () => {
    const text = await rpc("tools/call", { name: "apply_myself", arguments: { id: "workday:acme:R1", resumeText: CV, resume_text: CV } });
    expect(text).not.toContain("SENTINEL-CV");
    assertNowhere();
  });

  it("in fit_resume: forwarded to the scorer only, and never in the answer, a log line or a write", async () => {
    const text = await rpc("tools/call", { name: "fit_resume", arguments: { resumeText: CV, query: "nurse" } }, "rb_live_harness_key");
    expect(text).not.toContain("SENTINEL-CV");
    expect(outbound.filter((o) => o.url.endsWith("/functions/v1/job-fit") && o.body.includes("SENTINEL-CV"))).toHaveLength(1);
    assertNowhere();
  });

  it("in fit_resume when the scorer fails: the fault is logged without the CV", async () => {
    scorerStatus = 500;
    const text = await rpc("tools/call", { name: "fit_resume", arguments: { resumeText: CV, query: "nurse" } }, "rb_live_harness_key");
    expect(text).toMatch(/internal error/);
    expect(lines.some((l) => l.includes("fit_resume failed"))).toBe(true);
    assertNowhere();
  });
});
