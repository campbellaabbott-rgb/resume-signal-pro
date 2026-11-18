// @vitest-environment node
/**
 * A STALE AUDIT IS NOT CALLED DAILY (SEO audit 2026-11-18, CONTENT-7).
 *
 * The data-page builder already applied a 36-hour rule to the re-check's
 * figures (SEO-F07): past 36 hours the page names the run's age instead of
 * saying it runs daily. Everything around it said "daily" regardless: the
 * Ghost Job Index's H2 and tile, its intro, its Dataset description and
 * variableMeasured, and /data-api's sentence and markup. With the newest run
 * 44 hours old at build time the two pages said "daily" six times.
 *
 * The real bake runs twice against a stubbed network that answers the stats
 * cache and the audit blob (every other request is refused, nothing leaves
 * the machine): once with the audit 44 hours old, once 10 hours old. A
 * stale build may say the re-check is "scheduled daily" beside the latest
 * run's date, and nothing else daily; a fresh build keeps the daily wording
 * (and verify section 76's S2 line, which reads "Daily re-check:").
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const STATS = {
  computed_at: "2026-11-17T06:00:00+00:00",
  ghost_stats: { total_open: 1028735, total_company_names: 31000, closed_90d: 816312, observed_days: 120, median_days_open: 9, posted_coverage_pct: 99.5, computed_at: "2026-11-17T05:30:00+00:00" },
};
const auditAt = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

function bake(hoursAgo: number): { out: string; day: string } {
  const out = mkdtempSync(join(tmpdir(), `stale-audit-${hoursAgo}h-`));
  mkdirSync(join(out, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(out, "dist", "index.html"));
  const at = auditAt(hoursAgo);
  const routes = { get_stats_cache: STATS, get_audit_result: { at, sampled: 114, decided: 113, live: 112, gone: 1, unknown: 1, accuracyPct: 99.1 } };
  const stub = join(out, "stub-fetch.cjs");
  writeFileSync(stub, `
const routes = ${JSON.stringify(routes)};
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /\\/rest\\/v1\\/rpc\\/([a-z_0-9]+)$/.exec(url);
  if (m && routes[m[1]]) return new Response(JSON.stringify(routes[m[1]]), { status: 200, headers: { "content-type": "application/json" } });
  throw new Error("stubbed network: " + url);
};`);
  execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: out, PRERENDER_OFFLINE: "", VITE_SUPABASE_URL: "https://stub.supabase.test", VITE_SUPABASE_PUBLISHABLE_KEY: "stub-key", NODE_OPTIONS: `--require ${stub}` },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return { out, day: at.slice(0, 10) };
}

let STALE = { out: "", day: "" };
let FRESH = { out: "", day: "" };
beforeAll(() => {
  STALE = bake(44);
  FRESH = bake(10);
}, 300_000);
afterAll(() => {
  for (const d of [STALE.out, FRESH.out]) if (d && d.startsWith(tmpdir())) rmSync(d, { recursive: true, force: true });
});

const page = (out: string, p: string) => readFileSync(join(out, "dist", ...p.split("/").filter(Boolean), "index.html"), "utf8");
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** Every "daily" in the served file (body and markup) that is not "scheduled daily". */
const unconditionalDaily = (html: string) => [...html.matchAll(/(.{0,40})\bdaily\b(.{0,40})/gi)].filter((m) => !/scheduled\s*$/i.test(m[1])).map((m) => m[0]);

describe("with the newest re-check 44 hours old at build time", () => {
  for (const p of ["/ghost-job-index", "/data-api"]) {
    it(`${p} says "daily" only as "scheduled daily", and names the latest run's date`, () => {
      const html = page(STALE.out, p);
      expect(unconditionalDaily(html)).toEqual([]);
      expect(html).toContain(`scheduled daily (the latest run on record is from ${STALE.day})`);
    });
  }

  it("the Ghost Job Index heads and labels the figure without a frequency, and gives the run's age", () => {
    const t = text(page(STALE.out, "/ghost-job-index"));
    expect(t).toMatch(/The re-check /);
    expect(t).not.toMatch(/The daily re-check|Daily re-check:/);
    expect(t).toContain("Re-check: 99.1% of 113 decided sample postings still live at the source");
    expect(t).toContain("44 hours older than this page's build");
  });
});

describe("with the newest re-check 10 hours old", () => {
  it("the pages still say it runs daily, and the dated line verify 76 S2 reads is there", () => {
    const g = text(page(FRESH.out, "/ghost-job-index"));
    expect(g).toMatch(new RegExp(`Daily re-check: 99\\.1% of 113 decided sample postings still live at the source \\(n = 113, 95% interval [^,)]+, ${FRESH.day}\\)`));
    expect(g).toContain("we sample listings daily and re-check them");
    expect(page(FRESH.out, "/data-api")).toContain("a daily sample is re-checked against them");
    expect(page(FRESH.out, "/ghost-job-index")).not.toContain("the latest run on record is from");
  });
});
