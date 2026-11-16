// @vitest-environment node
/**
 * A SHORTLIST BLOCKLIST ENTRY IS A PHRASE, NEVER A PROGRAM (S13-073), AND NO
 * REQUEST CARRIES ONE AT ALL (RC-S13-073).
 *
 * WHAT WAS WRONG. shortlist-evaluate read an extra blocklist from the request
 * body and the redactor applied its entries one after another. S13-073 made
 * each entry a literal phrase, but every entry still ran over the marks the
 * earlier ones had written: three entries spelling "e" turned each "e" into
 * a mark spelled with E's, the next entry matched those, and the text the
 * scorer read grew several times over. No page offered the field; only a
 * direct call could send it.
 *
 * WHAT HOLDS NOW, running the shipped handler with the network faked: the
 * request body's blocklist changes nothing the scorer is shown (the baseline
 * is the same for every caller), and the redactor's own extra list, for a
 * caller inside the codebase, runs as ONE pass over whole words, so no entry
 * can match another's mark and the text cannot grow with the entry count.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { redactForScoring } from "../../supabase/functions/_shared/redaction";

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
      const m = JSON.parse(String(init?.body ?? "{}")).messages ?? [];
      prompts.push(String(m[1]?.content ?? ""));
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
  prompts = [];
});

const evaluate = async (resumeText: string, redactionConfig: unknown) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/shortlist-evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${WEBSITE}`, "cf-connecting-ip": "198.51.100.4" },
    body: JSON.stringify({ roleId: "role-1", resumeText, attested: true, redactionConfig }),
  }));
  return { status: res.status, build: res.headers.get("x-fn-build"), body: await res.json() as Record<string, unknown> };
};

describe("a request's blocklist changes nothing the scorer is shown", () => {
  it("the same resume reads the same to the scorer with and without a blocklist in the request", async () => {
    const text = `${RESUME}\nSpeaks Spanish at home. Volunteer coach.`;
    const plain = await evaluate(text, undefined);
    const withList = await evaluate(text, { extraBlocklist: [{ feature: "home language", pattern: "speaks spanish at home" }, { feature: "e", pattern: "e" }] });
    expect(plain.status).toBe(200);
    expect(withList.status).toBe(200);
    expect(buildIsAtLeast(withList.build, "shortlist-evaluate", "2026-11-09", 2), String(withList.build)).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe(prompts[0]);
    expect(prompts[1]).toContain("Speaks Spanish at home");
    const stored = db.rows("shortlist_candidates") as Array<{ exclusions_applied: Array<{ feature: string }> }>;
    expect(stored.flatMap((r) => r.exclusions_applied.map((e) => e.feature)).filter((f) => f.startsWith("custom:"))).toEqual([]);
  });

  it("twenty backtracking patterns in a request cost nothing, because none is read", async () => {
    const bait = `${RESUME}\n${"a".repeat(22)}! ${"word ".repeat(18)}!`;
    const evil = ["(a+)+$", "(a|aa)+$", "(\\w+\\s?)+$", "(.*a){12}$"];
    const extraBlocklist = Array.from({ length: 20 }, (_, i) => ({ feature: `x${i}`, pattern: evil[i % evil.length] }));
    const started = performance.now();
    const r = await evaluate(bait, { extraBlocklist });
    const took = performance.now() - started;
    expect(r.status).toBe(200);
    expect(took, `${Math.round(took)} ms`).toBeLessThan(500);
    expect(prompts[0]).not.toMatch(/\[REDACTED/);
  });

  it("the module that read the request's list is gone", () => {
    expect(existsSync(join(process.cwd(), "supabase/functions/shortlist-evaluate/caller-blocklist.ts"))).toBe(false);
  });
});

describe("the redactor's own extra list runs once, over whole words", () => {
  it("three entries spelling 'e' keep the text under twice its length and leave no mark of their own", () => {
    const base = "Jane Okafor\nEXPERIENCE\n" + "Engineered pipelines here. ".repeat(10);
    const cfg = { extraBlocklist: [1, 2, 3].map(() => ({ feature: "eeeeeeeeeeeeeeeeeeee", pattern: "e" })) };
    const out = redactForScoring(base, cfg).redacted;
    expect(out.length).toBeLessThan(base.length * 2);
    expect(out).not.toContain("[REDACTED-E");
    expect(out).toContain("Engineered pipelines here.");
  });

  it("an entry never matches the mark another entry wrote", () => {
    const r = redactForScoring("Fluent in Klingon. Speaks Spanish at home. Redacted twice?", {
      extraBlocklist: [
        { feature: "home_language", pattern: "speaks \\w+ at home" },
        { feature: "redacted", pattern: "redacted" },
        { feature: "broken", pattern: "([unclosed" },
      ],
    });
    expect(r.redacted).toBe("Fluent in Klingon. [REDACTED]. [REDACTED] twice?");
    expect(r.exclusionsApplied.filter((e) => e.feature.startsWith("custom:"))).toEqual([
      { feature: "custom:home_language", count: 1 },
      { feature: "custom:redacted", count: 1 },
    ]);
  });
});
