// @vitest-environment node
/**
 * EVERY EVENT THE SITE SENDS IS ON THE WRITER'S LIST, AND NOTHING ELSE IS
 * (S14X-154).
 *
 * WHAT WAS WRONG. track-ab-event accepted any test name, variant and type of
 * view or conversion, so a caller could write rows under any test the owner's
 * dashboards read, a purchase in the funnel or a win for an A/B variant
 * included.
 *
 * WHAT HOLDS NOW:
 *   - the function's list (supabase/functions/track-ab-event/allowlist.ts)
 *     names exactly the tests the browser sends, as derived from src/ (every
 *     testName literal, every constant a testName names, every running A/B
 *     test and its click name), and refuses a name it does not list;
 *   - its copies of the funnel stages, cohort sources and A/B variants equal
 *     the browser's own lists;
 *   - every variant the browser sends as a literal (sign-ins, board and
 *     agents events, crash places, scroll and time milestones, products,
 *     optimisation events, shares) passes the pattern for its type;
 *   - a purchase is a conversion of the funnel's last stage, of a product or
 *     of an A/B test, and its Stripe session is read the way the writer
 *     reads it;
 *   - the shipped handler answers an unlisted event 400 "Unknown event"
 *     before anything is counted, even with metadata over the size cap (the
 *     post-deploy check relies on that order), and answers a purchase whose
 *     session the payment side never saw "unverified" without writing it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { crashVariant } from "@/lib/crash-variant";
import { PRODUCTS } from "@/config/products";
import {
  AB_TEST_VARIANTS,
  EVENT_RULES,
  FUNNEL_STAGES,
  TRAFFIC_SOURCES,
  admits,
  clickTestName,
  isPurchase,
  stripeSessionOf,
} from "../../supabase/functions/track-ab-event/allowlist";

const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "src");

/** Every .ts/.tsx file under src/ except the tests, with comments gone. */
function sources(): Array<{ file: string; code: string }> {
  const out: Array<{ file: string; code: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (p === resolve(SRC, "test")) continue;
        walk(p);
      } else if (/\.tsx?$/.test(name)) {
        out.push({ file: p.slice(ROOT.length + 1), code: codeOf(readFileSync(p, "utf8")) });
      }
    }
  };
  walk(SRC);
  return out;
}
const SOURCES = sources();
const code = (rel: string) => {
  const hit = SOURCES.find((s) => s.file === rel);
  if (!hit) throw new Error(`${rel} not found under src/`);
  return hit.code;
};
const quoted = (list: string) => [...list.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
const literalsOf = (rel: string, re: RegExp) => [...code(rel).matchAll(re)].map((m) => m[1]);

/** The running A/B tests and their variants, read from the hook's own table. */
function abTests(): Record<string, string[]> {
  const src = code("src/hooks/use-ab-test.ts");
  const start = src.indexOf("export const AB_TESTS = {");
  if (start < 0) throw new Error("AB_TESTS not found");
  const block = src.slice(start, src.indexOf("} as const", start) > 0 ? src.indexOf("} as const", start) : undefined);
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/(\w+):\s*\{\s*name:\s*["'](\w+)["'],\s*variants:\s*\[([^\]]*)\]/g)) out[m[2]] = quoted(m[3]);
  if (!Object.keys(out).length) throw new Error("no A/B test parsed from AB_TESTS");
  return out;
}

/** Every test name the browser sends: testName literals, the constants a testName names, the A/B tests and their click names. */
function sentTestNames(): Set<string> {
  const names = new Set<string>();
  for (const { file, code: c } of SOURCES) {
    for (const m of c.matchAll(/\btestName:\s*["']([A-Za-z0-9_]+)["']/g)) names.add(m[1]);
    for (const m of c.matchAll(/\btestName:\s*([A-Z][A-Z0-9_]+)\s*[,}]/g)) {
      const def = new RegExp(`const ${m[1]}\\s*=\\s*["']([A-Za-z0-9_]+)["']`).exec(c);
      if (!def) throw new Error(`${file}: testName ${m[1]} is a constant this guard cannot resolve`);
      names.add(def[1]);
    }
  }
  for (const name of Object.keys(abTests())) {
    names.add(name);
    names.add(clickTestName(name));
  }
  return names;
}

describe("the writer's list is the browser's list", () => {
  it("names exactly the tests the browser sends", () => {
    const sent = [...sentTestNames()].sort();
    expect(sent.length, "no test names were derived from src/").toBeGreaterThan(10);
    expect([...EVENT_RULES.keys()].sort()).toEqual(sent);
  });

  it("refuses a test, a type or a variant the browser never sends", () => {
    for (const t of ["view", "conversion"]) expect(admits("rb_forged", "x", t)).toBe(false);
    expect(admits("constructor", "x", "view")).toBe(false);
    expect(admits("__proto__", "x", "view")).toBe(false);
    expect(admits("conversion_funnel", "landing_view", "conversion"), "a landing as a sale").toBe(false);
    expect(admits("conversion_funnel", "purchase_completed", "view")).toBe(false);
    expect(admits("conversion_funnel", "rb_stage", "view")).toBe(false);
    expect(admits("job_board", "apply_click", "conversion")).toBe(false);
    expect(admits("hero_layout", "rb_variant", "conversion"), "a win for a variant that is not running").toBe(false);
    expect(admits("hero_layout__click", "compact", "conversion")).toBe(false);
    expect(admits("job_board", "Apply Click", "view")).toBe(false);
    expect(admits("job_board", "apply_click", "click")).toBe(false);
    expect(admits(42, "x", "view")).toBe(false);
  });

  it("holds the same funnel stages, cohort sources and A/B variants as the browser", () => {
    expect([...FUNNEL_STAGES]).toEqual(quoted(/export const FUNNEL_STAGES = \[([\s\S]*?)\]/.exec(code("src/hooks/use-funnel-tracking.ts"))![1]));
    expect([...TRAFFIC_SOURCES]).toEqual(quoted(/export const TRAFFIC_SOURCES = \[([\s\S]*?)\]/.exec(code("src/hooks/use-cohort-tracking.ts"))![1]));
    expect(Object.fromEntries(Object.entries(AB_TEST_VARIANTS).map(([k, v]) => [k, [...v]]))).toEqual(abTests());
  });
});

describe("every variant the browser sends passes its pattern", () => {
  const ok = (test: string, variant: string, type: string) =>
    expect(admits(test, variant, type), `${test} / ${variant} / ${type} is sent by the browser and refused`).toBe(true);

  it("the funnel: every stage a view, the purchase a conversion", () => {
    for (const s of FUNNEL_STAGES) ok("conversion_funnel", s, s === "purchase_completed" ? "conversion" : "view");
  });

  it("the cohort: every source, either type", () => {
    for (const s of TRAFFIC_SOURCES) for (const t of ["view", "conversion"]) ok("cohort_analysis", s, t);
  });

  it("the A/B tests: every variant a view and a conversion, and its click a view", () => {
    for (const [name, variants] of Object.entries(abTests())) {
      for (const v of variants) {
        ok(name, v, "view");
        ok(name, v, "conversion");
        ok(clickTestName(name), v, "view");
      }
    }
  });

  it("every object literal that names its test, variant and type", () => {
    let n = 0;
    for (const { code: c } of SOURCES) {
      for (const m of c.matchAll(/\btestName:\s*["'](\w+)["'],\s*variant:\s*["']([^"'`]+)["'],\s*eventType:\s*["'](view|conversion)["']/g)) {
        ok(m[1], m[2], m[3]);
        n++;
      }
    }
    expect(n, "no literal events were found -- the scan has drifted").toBeGreaterThanOrEqual(4);
  });

  it("sign-ins, board events and the agents page", () => {
    const auth = SOURCES.flatMap(({ code: c }) => [...c.matchAll(/\btrackAuth\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
    expect(auth.length).toBeGreaterThan(3);
    for (const v of auth) ok("auth_funnel", v.slice(0, 30), "conversion");
    const board = literalsOf("src/pages/Jobs.tsx", /\btrack(?:Board)?\(\s*["']([a-z0-9_]+)["']/g);
    expect(board.length).toBeGreaterThan(3);
    for (const v of board) ok("job_board", v, "view");
    const agents = literalsOf("src/pages/AgentConnect.tsx", /\btrackAgents\(\s*["']([a-z0-9_]+)["']/g);
    expect(agents.length).toBeGreaterThan(0);
    for (const v of agents) ok("agents", v, "view");
  });

  it("crash places, cut to fit, with their hash", () => {
    const places = SOURCES.flatMap(({ code: c }) => [...c.matchAll(/\bsection="([^"$]+)"/g)].map((m) => m[1]));
    for (const p of ["app", "section", ...places]) {
      ok("client_error", crashVariant(p, "Cannot read properties of undefined"), "view");
    }
  });

  it("scroll and time milestones for every page the hooks are named with", () => {
    const pages = new Set(["home"]);
    for (const { code: c } of SOURCES) for (const m of c.matchAll(/\buse(?:ScrollDepth|TimeOnPage)\(\s*["']([^"']+)["']\s*\)/g)) pages.add(m[1]);
    const scroll = quoted(/SCROLL_MILESTONES = \[([^\]]*)\]/.exec(code("src/hooks/use-scroll-depth.ts"))![1].replace(/(\d+)/g, "'$1'")).map(Number);
    const time = quoted(/TIME_MILESTONES = \[([^\]]*)\]/.exec(code("src/hooks/use-time-on-page.ts"))![1].replace(/(\d+)/g, "'$1'")).map(Number);
    expect(scroll.length).toBeGreaterThan(3);
    expect(time.length).toBeGreaterThan(3);
    const fmt = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`);
    for (const page of [...pages, "a-page-name-long-enough-to-be-cut"]) {
      for (const m of scroll) ok("scroll_depth", `${page}:${m}%`.slice(0, 30), "view");
      for (const s of time) ok("time_on_page", `${page}:${fmt(s)}`.slice(0, 30), "view");
    }
  });

  it("products, optimisation events and shares", () => {
    const products = [...Object.keys(PRODUCTS), ...SOURCES.flatMap(({ code: c }) => [...c.matchAll(/\btrackButtonClick\(\s*["']([^"']+)["']/g)].map((m) => m[1]))];
    for (const p of products) ok("product_conversion", p, "view");
    for (const p of Object.keys(PRODUCTS)) ok("product_conversion", p, "conversion");
    const opt = quoted(/type OptimizationEvent =([^;]*);/.exec(code("src/hooks/use-optimization-tracking.ts"))![1]);
    expect(opt.length).toBeGreaterThan(3);
    for (const e of opt) ok("optimization_features", e, /converted|succeeded|recovered/.test(e) ? "conversion" : "view");
    const shares = quoted(/action:\s*((?:'[a-z_]+'\s*\|\s*)+'[a-z_]+')/.exec(code("src/components/ShareableScoreCard.tsx"))![1]);
    for (const a of shares) ok("share_scorecard", a, "conversion");
  });
});

describe("a purchase, and the session it names", () => {
  it("is a conversion of the funnel's purchase, a product or an A/B test, and nothing else", () => {
    expect(isPurchase("conversion_funnel", "conversion")).toBe(true);
    expect(isPurchase("product_conversion", "conversion")).toBe(true);
    for (const name of Object.keys(abTests())) {
      expect(isPurchase(name, "conversion")).toBe(true);
      expect(isPurchase(clickTestName(name), "conversion")).toBe(false);
    }
    for (const t of ["auth_funnel", "cohort_analysis", "share_scorecard", "optimization_features", "cache_reanalyze"]) expect(isPurchase(t, "conversion"), t).toBe(false);
    expect(isPurchase("conversion_funnel", "view")).toBe(false);
  });

  it("is read from stripeSessionId, else sessionId outside the funnel, and only when it is a Checkout session", () => {
    expect(stripeSessionOf("conversion_funnel", { stripeSessionId: "cs_live_a" })).toBe("cs_live_a");
    expect(stripeSessionOf("conversion_funnel", { sessionId: "cs_test_tab" })).toBeNull();
    expect(stripeSessionOf("product_conversion", { sessionId: "cs_test_p" })).toBe("cs_test_p");
    expect(stripeSessionOf("hero_layout", { productId: "fullAnalysis", sessionId: "cs_test_ab" })).toBe("cs_test_ab");
    expect(stripeSessionOf("product_conversion", { sessionId: "pro_cs_test_p" })).toBeNull();
    expect(stripeSessionOf("product_conversion", { stripeSessionId: "pi_123", sessionId: "cs_test_p" })).toBe("cs_test_p");
    expect(stripeSessionOf("product_conversion", null)).toBeNull();
  });
});

describe("the shipped handler", () => {
  const db = new FakeDb();
  const rpcs: string[] = [];
  let handler: EdgeHandler;
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc_harness" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.__allowDb = db;
    for (const fn of ["check_rate_limit", "mail_door_take", "client_write_allowed"]) db.rpcs[fn] = () => { rpcs.push(fn); return { data: true, error: null }; };
    db.rpcs.ab_purchase_known = () => { rpcs.push("ab_purchase_known"); return { data: false, error: null }; };
    db.rpcs.track_ab_event_optimized = () => { rpcs.push("track_ab_event_optimized"); return { data: { success: true, status: "recorded" }, error: null }; };
    handler = await loadEdgeHandler("track-ab-event", {
      "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__allowDb; }",
    });
  }, 60_000);

  const post = (body: Record<string, unknown>) => handler(new Request("https://h.supabase.co/functions/v1/track-ab-event", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.54" }, body: JSON.stringify(body),
  }));
  const VISITOR = "00000000-0000-4000-8000-000000000000";

  it("answers an unlisted event 400 Unknown event before anything is counted, even over the metadata cap", async () => {
    rpcs.length = 0;
    const res = await post({ testName: "rb_verify_unknown", variant: "x", eventType: "view", visitorId: VISITOR, metadata: { pad: "x".repeat(3000) } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unknown event" });
    expect(rpcs, "an unlisted event reached the database").toEqual([]);
  });

  it("still answers a listed event over the cap Metadata too large", async () => {
    rpcs.length = 0;
    const res = await post({ testName: "job_board", variant: "apply_click", eventType: "view", visitorId: VISITOR, metadata: { pad: "x".repeat(3000) } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Metadata too large" });
    expect(rpcs).toEqual([]);
  });

  it("answers a purchase whose session the payment side never saw unverified, and writes nothing", async () => {
    rpcs.length = 0;
    const res = await post({ testName: "conversion_funnel", variant: "purchase_completed", eventType: "conversion", visitorId: VISITOR, metadata: { stripeSessionId: "cs_test_forged" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, status: "unverified" });
    expect(rpcs).toContain("ab_purchase_known");
    expect(rpcs).not.toContain("track_ab_event_optimized");
  });

  it("records a listed view as before", async () => {
    rpcs.length = 0;
    const res = await post({ testName: "conversion_funnel", variant: "landing_view", eventType: "view", visitorId: VISITOR, metadata: {} });
    expect(await res.json()).toMatchObject({ success: true, status: "recorded" });
    expect(rpcs.at(-1)).toBe("track_ab_event_optimized");
  });
});
