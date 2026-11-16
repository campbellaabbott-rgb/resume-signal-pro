// @vitest-environment node
/**
 * A BROWSER ASKS EACH FUNCTION FOR LEAVE ONCE PER TWO HOURS, NOT BEFORE EVERY
 * CALL (cost audit 2026-11-08, Do first #10, lane ci-edge).
 *
 * WHAT WAS WRONG. No function said Access-Control-Max-Age, so a browser kept
 * its CORS preflight for five seconds. Every call the site makes sends apikey,
 * Authorization and a JSON content type, so every call more than five seconds
 * after the last one paid a full extra round trip (225 ms from IAD on a fresh
 * connection, more for a distant visitor) and one more function invocation
 * that ran the function's own code to answer OPTIONS.
 *
 * WHAT HOLDS NOW, by running each function's shipped index.ts: its preflight
 * answers Access-Control-Max-Age 7200 (Chrome's ceiling), so a browser asks
 * once per two hours per function. A cached preflight allows only what the
 * function already allows; a new request header still asks again.
 *
 * And every function the site's own code names is either in that set or named
 * below with the place it is handled, so a new browser-called function cannot
 * be added without a decision here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build, type Plugin } from "esbuild";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const FUNCTIONS = join(ROOT, "supabase/functions");

/** The functions browsers call whose preflight this lane made cacheable. */
const CACHED = [
  "account-order", "account-settings", "admin-ops", "affiliate-payout-request", "agent-access", "agent-mcp",
  "agent-pass-status", "analyze-resume", "api-key-request", "application-fit", "auth-signed-in", "check-subscription",
  "company-claim", "create-agent-checkout", "create-checkout", "create-portal-session", "create-product-checkout",
  "create-scan-pack-checkout", "create-subscription-checkout", "create-test-checkout", "delete-account",
  "fetch-job-posting", "generate-apply-package", "generate-ats-defense", "generate-career-path",
  "generate-career-snapshot", "generate-cover-letter", "generate-freelance-boost", "generate-graduate-gameplan",
  "generate-interview-coach", "generate-keyword-fix", "generate-premium-package", "generate-tailored-resume",
  "get-account-data", "get-analytics", "get-error-telemetry", "health-check", "job-fit", "parse-docx", "parse-pdf",
  "parse-resume-structured", "parse-spreadsheet", "recover-purchase", "save-lead", "scan-credits",
  "send-agent-digest", "send-market-pulse", "send-scan-report", "send-search-digest", "shortlist-evaluate",
  "test-ai-fallback", "track-ab-event", "verify-product-purchase", "verify-scan-pack-purchase", "withdraw-subscription",
];

/** Named by the site's code, and handled somewhere other than this set. */
const ELSEWHERE: Record<string, string> = {
  "job-board": "the job-board board wave (one wave per hot file set), audit PERF-06",
  "free-keyword-scan": "the heartbeat lane owns this function",
  "free-keyword-scan-stream": "the heartbeat lane owns this function",
  "scan-heartbeat": "the heartbeat lane owns this function; a cron calls it, the health page only names it",
  "warm-up": "the ai lane owns this function",
  "nl-search": "the ai lane owns this function",
  "generate-product-preview": "the ai lane owns this function",
  "generate-application-answers": "the ai lane owns this function",
  "import-freelance-profile": "the ai lane owns this function",
  "generate-summary": "the ai lane decides its retirement",
  "generate-resume-roast": "the ai lane decides its retirement",
  "generate-recruiter-view": "the ai lane decides its retirement",
  "generate-elevator-pitch": "the ai lane decides its retirement",
  "analyze-linkedin-profile": "the ai lane decides its retirement",
  "create-pass-checkout": "retired: answers 410; the site names it only in the affiliate commission list",
  "public-api": "no page of the site calls it: /data-api and /api-address print its address for curl and agents",
  "stripe-webhook": "Stripe's servers call it; the site names it only in the circuit-breaker table",
  "affiliate-account": "the bug round's affiliate lane: born with Max-Age 7200 on the round's build day, held by an-affiliate-resets-a-password-by-mail-and-proves-the-address.test.ts",
  "layoff-filings": "no page calls it: the site names it only as the layoff-filings string-shard directory in src/i18n/merge-shards.ts; a cron runs the function",
};

/** Function names written as a string anywhere in the site's own (non-test) code. */
function namedBySite(): Set<string> {
  const fns = readdirSync(FUNCTIONS).filter((n) => n !== "_shared" && statSync(join(FUNCTIONS, n)).isDirectory());
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!p.endsWith(join("src", "test"))) walk(p); }
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(join(ROOT, "src"));
  const named = new Set<string>();
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    for (const n of fns) if (new RegExp(`["'\`/]${n}["'\`]`).test(s)) named.add(n);
  }
  return named;
}

describe("the set is the site's", () => {
  it("every function the site's code names is cached here or named with where it is handled", () => {
    const named = namedBySite();
    expect(named.size, "the scan of src/ found no function names: it is broken, not the set").toBeGreaterThan(40);
    const undecided = [...named].filter((n) => !CACHED.includes(n) && !(n in ELSEWHERE)).sort();
    expect(undecided, "a browser-called function with no preflight decision").toEqual([]);
    expect(CACHED.filter((n) => n in ELSEWHERE)).toEqual([]);
  });
});

/**
 * Every network module the function imports becomes one callable, constructible
 * object whose every property is another; the std server's serve() parks the
 * handler. A preflight touches none of them, so whatever they would have done
 * cannot decide the answer.
 */
const ANY = `
const target = function () {};
const make = () => new Proxy(target, {
  get(_t, k) { if (k === "then") return undefined; if (k === Symbol.toPrimitive) return () => ""; if (k === "__esModule") return false; return make(); },
  apply() { return make(); },
  construct() { return make(); },
});
module.exports = make();`;
const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const anyRemote: Plugin = {
  name: "any-remote",
  setup(b) {
    b.onResolve({ filter: /^(https?:|npm:|jsr:)/ }, (a) => ({ path: a.path, namespace: /\/std@[^/]+\/http\/server\.ts$/.test(a.path) ? "serve" : "any" }));
    b.onLoad({ filter: /.*/, namespace: "any" }, () => ({ contents: ANY, loader: "js" }));
    b.onLoad({ filter: /.*/, namespace: "serve" }, () => ({ contents: SERVE, loader: "js" }));
  },
};

const g = globalThis as Record<string, unknown>;
const savedDeno = g.Deno;
beforeAll(() => {
  g.Deno = { env: { get: () => undefined, toObject: () => ({}) }, serve: (a: unknown, b: unknown) => { g.__edgeHandler = typeof a === "function" ? a : b; } };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => { g.Deno = savedDeno; vi.restoreAllMocks(); });

async function preflight(fn: string): Promise<Response> {
  const out = await build({
    entryPoints: [join(FUNCTIONS, fn, "index.ts")], bundle: true, write: false, format: "iife",
    platform: "node", target: "es2022", plugins: [anyRemote], logLevel: "silent",
  });
  g.__edgeHandler = undefined;
  new Function(out.outputFiles[0].text)();
  const handler = g.__edgeHandler as ((r: Request) => Promise<Response>) | undefined;
  if (typeof handler !== "function") throw new Error(`${fn}: the bundle ran but never called serve()`);
  return handler(new Request(`https://h.supabase.co/functions/v1/${fn}`, {
    method: "OPTIONS",
    headers: { Origin: "https://resumebooster.work", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, apikey, content-type" },
  }));
}

describe("each one's real preflight says a browser may keep it for two hours", () => {
  it.each(CACHED)("%s answers OPTIONS with Access-Control-Max-Age 7200, its origin rule and its build unchanged in kind", async (fn) => {
    const res = await preflight(fn);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-max-age")).toBe("7200");
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    // The cost wave's build or a later one: a later round restamps the function, never to an earlier day.
    const stamp = new RegExp(`^${fn}\\.(\\d{4}-\\d{2}-\\d{2})\\.\\d+$`).exec(res.headers.get("x-fn-build") ?? "");
    expect(stamp, `${fn}'s x-fn-build`).not.toBeNull();
    expect(stamp![1] >= "2026-11-09", `${fn} answers ${stamp![0]}, a day before the cost wave`).toBe(true);
  }, 30_000);
});
