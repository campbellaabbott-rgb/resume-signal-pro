// @vitest-environment node
/**
 * RÉSUMÉ FIT SCORING IS FREE ON A CONFIRMED KEY, AND EVERY PAGE SAYS SO (the
 * recheck of the merge of main 899be058, 2026-10-25).
 *
 * Wave 4 makes fit scoring free: 25 a day on a key whose email was confirmed,
 * across POST /v1/fit and fit_resume together, more on a paid plan
 * (_shared/fit-gate.ts opens a "free" basis). Six places still called it
 * paid, to readers, crawlers and AI hosts alike: the React /data-api endpoint
 * list ("POST /v1/fit — Paid."), the React /agents tool table (fit_resume's
 * badge), the crawler /data-api ("POST /v1/fit (paid)"), the crawler /agents
 * ("fit_resume needs a paid key"), llms-full.txt ("and fit_resume a paid
 * key") and llms.txt ("POST /v1/fit (paid)"), while the same pages also said
 * a confirmed free key scores 25 a day.
 *
 * The guard: while fitGate opens a free basis, no clause of a page source, the
 * bake's output or an llms file may pair /v1/fit or fit_resume with "paid"
 * unless the same clause states the free allowance, and every figure is read
 * from the mirror pinned to FIT_FREE_PER_DAY, never typed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { crawlerText } from "../../scripts/prerender-retired.mjs";
import { fitGate } from "../../supabase/functions/_shared/fit-gate";
import { FIT_FREE_PER_DAY, FIT_FULL_PER_DAY } from "../../supabase/functions/_shared/fit-allowance";
import * as MIRROR from "@/config/mcp-tools";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Every clause that pairs fit scoring with "paid" and states no free allowance. */
function fitCalledPaid(text: string): string[] {
  return String(text)
    .split(/(?<=[.!?])\s+|;|\n|<\/?(?:li|p|td|tr|div|h\d)\b[^>]*>|,\s+and\s+/)
    .filter((c) => /\/v1\/fit\b|\bfit_resume\b/.test(c) && /\bpaid\b/i.test(c) && !/\bfree\b/i.test(c))
    .map((c) => c.trim().slice(0, 160));
}

const FREE_OPEN = (() => {
  const g = fitGate({ paid: false, plan: false, standing: { userId: null, confirmed: true, proven: false, used: 1 } });
  return g.open === true && g.basis === "free";
})();

describe("the premise: a confirmed free key scores", () => {
  it("fitGate opens a free basis for a confirmed key with calls left, so the guard below is not vacuous", () => {
    expect(FREE_OPEN).toBe(true);
  });
  it("the mirror's figures are the server's", () => {
    expect(MIRROR.MCP_FIT_FREE_PER_DAY).toBe(FIT_FREE_PER_DAY);
    expect(MIRROR.MCP_FIT_FULL_PER_DAY).toBe(FIT_FULL_PER_DAY);
  });
});

describe("the sentence every surface reads, and the badge", () => {
  it("MCP_FIT_ALLOWANCE states the free figure and the paid-plan figure from the mirror", () => {
    expect(MIRROR.MCP_FIT_ALLOWANCE).toBe(`${FIT_FREE_PER_DAY} scorings a day on a confirmed free key, ${FIT_FULL_PER_DAY.toLocaleString("en-US")} on an account with a paid plan`);
  });
  it("the fit tool's badge says free and the daily figure, never 'paid key'", () => {
    expect(MIRROR.MCP_PAID_TOOLS.map((t) => t.name)).toEqual(["fit_resume"]);
    for (const t of MIRROR.MCP_PAID_TOOLS) {
      const badge = MIRROR.MCP_TIER_BADGE[t.tier];
      expect(badge, t.name).toMatch(/\bfree\b/);
      expect(badge, t.name).toContain(String(FIT_FREE_PER_DAY));
      expect(badge, t.name).not.toMatch(/\bpaid key\b/);
    }
  });
  it("the React /agents page and the bake read that badge, and keep no badge map of their own", () => {
    const page = codeOf(read("src/pages/AgentConnect.tsx"));
    expect(page).toMatch(/\bMCP_TIER_BADGE\b/);
    expect(page).not.toMatch(/"paid key"/);
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    expect(bake).toMatch(/D\.MCP_TIER_BADGE/);
    expect(bake).not.toMatch(/"paid key"/);
  });
  it("the React /data-api row for POST /v1/fit reads the allowance from the mirror", () => {
    const page = codeOf(read("src/pages/DataApi.tsx"));
    expect(page).toMatch(/path: "POST \/v1\/fit", body: `\$\{MCP_FIT_ALLOWANCE\}/);
  });
  it("llms.txt states the allowance the mirror states", () => {
    expect(read("public/llms.txt")).toContain(`POST /v1/fit (${MIRROR.MCP_FIT_ALLOWANCE}`);
  });
});

describe("no source calls fit scoring paid while it is free", () => {
  const SOURCES = [
    "src/pages/DataApi.tsx", "src/pages/AgentConnect.tsx", "src/config/mcp-tools.ts", "scripts/prerender-seo.mjs", "public/llms.txt",
    "supabase/functions/agent-mcp/index.ts", "supabase/functions/public-api/index.ts", "src/data/guides.ts", "src/i18n/locales/en.json",
  ];
  it.each(SOURCES)("%s", (p) => {
    const raw = read(p);
    const text = /\.(?:ts|tsx|mjs)$/.test(p) ? codeOf(raw) : raw;
    if (FREE_OPEN) expect(fitCalledPaid(text)).toEqual([]);
  });
  it("the teeth: each line the recheck quoted is caught", () => {
    for (const before of [
      '{ path: "POST /v1/fit", body: "Paid. POST a résumé and get the board\'s best matches back scored',
      "<li><code>POST /v1/fit</code> (paid) — a résumé in, the board's best matches out</li>",
      "<code>fit_resume</code> needs a paid key, exactly like <code>POST /v1/fit</code> on the data API.",
      "so any host can use those before sign-in; every other read tool needs a free key, and fit_resume a paid key.",
      "GET /v1/jobs, /v1/jobs/{id}, /v1/changes, /v1/companies, /v1/stats, /v1/usage, POST /v1/fit (paid). Cursor pagination, ETags.",
    ]) expect(fitCalledPaid(before).length, before).toBeGreaterThan(0);
    expect(fitCalledPaid(`fit_resume — ${MIRROR.MCP_FIT_ALLOWANCE}.`)).toEqual([]);
  });
});

describe("what the bake writes says it too", () => {
  let OUT = "";
  beforeAll(() => {
    OUT = mkdtempSync(join(tmpdir(), "w4b-mr-fit-"));
    mkdirSync(join(OUT, "dist"), { recursive: true });
    copyFileSync(join(ROOT, "index.html"), join(OUT, "dist", "index.html"));
    execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
      cwd: ROOT,
      env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
    });
  }, 300_000);
  afterAll(() => { if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true }); });
  const doc = (rel: string) => readFileSync(join(OUT, rel), "utf8");
  const llms = () => (existsSync(join(OUT, "public", "llms.txt")) ? doc("public/llms.txt") : doc("dist/llms.txt"));

  it("the crawler /data-api, /agents, llms-full.txt and llms.txt pair fit with paid nowhere", () => {
    for (const [name, text] of [["data-api", doc("dist/data-api/index.html")], ["agents", doc("dist/agents/index.html")], ["llms-full.txt", doc("dist/llms-full.txt")], ["llms.txt", llms()]] as const) {
      if (FREE_OPEN) expect(fitCalledPaid(text), name).toEqual([]);
    }
  });
  it("each states the free allowance, from the mirror", () => {
    const allowance = MIRROR.MCP_FIT_ALLOWANCE;
    expect(crawlerText(doc("dist/data-api/index.html"))).toContain(allowance);
    expect(crawlerText(doc("dist/agents/index.html"))).toContain(allowance);
    expect(doc("dist/llms-full.txt")).toContain(allowance);
    expect(llms()).toContain(allowance);
  });
});
