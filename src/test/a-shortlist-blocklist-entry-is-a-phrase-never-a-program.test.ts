// @vitest-environment node
/**
 * A SHORTLIST BLOCKLIST ENTRY IS A PHRASE, NEVER A PROGRAM (S13-073).
 *
 * WHAT WAS WRONG. shortlist-evaluate handed the body's redactionConfig to
 * _shared/redaction.ts as it came, and the redactor compiled each of up to 20
 * entries with new RegExp and ran it over the whole resume (up to 40,000
 * characters), before any metering or model call. The only check was that the
 * pattern compiled, so a signed-in caller could send a catastrophic-backtracking
 * pattern and spend the isolate's CPU in String.replace. No page sends the
 * field.
 *
 * WHAT HOLDS NOW, running the shipped handler with the network faked: each
 * entry is a literal phrase (escaped, trimmed, at most PHRASE_MAX characters,
 * at most ENTRIES_MAX entries, the feature name reduced to [a-z0-9_]). A
 * phrase is still redacted wherever it appears, in any case; regular
 * expression syntax in an entry matches only itself; twenty backtracking
 * patterns over a resume built to trigger them cost nothing.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { ENTRIES_MAX, PHRASE_MAX, callerBlocklist, literalPattern } from "../../supabase/functions/shortlist-evaluate/caller-blocklist";

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

describe("the handler reads each entry as the phrase it spells", () => {
  it("a phrase is redacted wherever it appears, in any case, and nothing else is", async () => {
    const r = await evaluate(`${RESUME}\nSpeaks Spanish at home. Volunteer coach, speaks spanish AT HOME too.`, {
      extraBlocklist: [{ feature: "home language", pattern: "speaks spanish at home" }],
    });
    expect(r.status).toBe(200);
    expect(buildIsAtLeast(r.build, "shortlist-evaluate", "2026-11-03"), String(r.build)).toBe(true);
    expect(prompts[0]).not.toMatch(/speaks spanish at home/i);
    expect(prompts[0].match(/\[REDACTED-HOME_LANGUAGE\]/g)).toHaveLength(2);
    expect(prompts[0]).toContain("Built Airflow pipelines");
  });

  it("regular-expression syntax in an entry matches only itself: 'a+' does not eat every run of a's", async () => {
    const r = await evaluate(`${RESUME}\nGraded aaa on the audit, a+ on the exam.`, {
      extraBlocklist: [{ feature: "grade", pattern: "a+" }],
    });
    expect(r.status).toBe(200);
    expect(prompts[0]).toContain("Graded aaa on the audit");
    expect(prompts[0].match(/\[REDACTED-GRADE\]/g), "the literal 'a+' is the only match").toHaveLength(1);
    expect(prompts[0]).toContain("Snowflake");
  });

  it("twenty backtracking patterns over a resume built to trigger them cost nothing", async () => {
    const bait = `${RESUME}\n${"a".repeat(22)}! ${"word ".repeat(18)}!`;
    const evil = ["(a+)+$", "(a|aa)+$", "(\\w+\\s?)+$", "(.*a){12}$"];
    const extraBlocklist = Array.from({ length: ENTRIES_MAX }, (_, i) => ({ feature: `x${i}`, pattern: evil[i % evil.length] }));
    const started = performance.now();
    const r = await evaluate(bait, { extraBlocklist });
    const took = performance.now() - started;
    expect(r.status).toBe(200);
    expect(took, `${Math.round(took)} ms`).toBeLessThan(500);
    expect(prompts[0]).not.toMatch(/\[REDACTED-X\d+\]/);
  });
});

describe("the bounds, on their own", () => {
  it("an entry is a literal phrase, trimmed and capped; a malformed entry is dropped", () => {
    const cfg = callerBlocklist({
      extraBlocklist: [
        { feature: "Home Language!", pattern: "  speaks (\\w+) at home  " },
        { feature: "long", pattern: "z".repeat(PHRASE_MAX + 50) },
        { feature: "", pattern: "no name" },
        { feature: "empty", pattern: "   " },
        { feature: 7, pattern: "not a string feature" },
        "not an object",
        null,
      ],
    });
    expect(cfg.extraBlocklist).toEqual([
      { feature: "home_language", pattern: literalPattern("speaks (\\w+) at home") },
      { feature: "long", pattern: "z".repeat(PHRASE_MAX) },
    ]);
    const re = new RegExp(cfg.extraBlocklist![0].pattern, "gi");
    expect("Speaks (\\w+) at home".replace(re, "X")).toBe("X");
    expect("speaks Spanish at home".replace(re, "X")).toBe("speaks Spanish at home");
  });

  it("at most ENTRIES_MAX entries are read, and anything that is not a list is no blocklist", () => {
    const many = Array.from({ length: ENTRIES_MAX + 15 }, (_, i) => ({ feature: `f${i}`, pattern: `phrase ${i}` }));
    expect(callerBlocklist({ extraBlocklist: many }).extraBlocklist).toHaveLength(ENTRIES_MAX);
    for (const raw of [undefined, null, "x", 3, {}, { extraBlocklist: "x" }, { extraBlocklist: {} }]) expect(callerBlocklist(raw)).toEqual({});
  });
});
