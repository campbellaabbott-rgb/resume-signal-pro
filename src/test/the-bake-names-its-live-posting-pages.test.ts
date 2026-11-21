// @vitest-environment node
/**
 * THE BAKE NAMES ITS LIVE POSTING PAGES (SEO audit 2026-11-18, CRAWL-M1).
 *
 * Other work (the board's own links to posting pages, lane B) needs to know
 * which posting pages are live and indexable, and had only the sitemap to
 * read. The bake now writes /posting-pages.json beside /landers.json:
 * { "at": "YYYY-MM-DD", "live": ["/jobs/posting/...", ...] }, made from the
 * sitemap's own final entries, so its live set IS the sitemap's posting locs
 * and a noindex stub (which never enters the sitemap) is never in it.
 *
 * An offline bake writes no posting page (it reads no board), so the offline
 * run below proves the file is written beside the sitemap and agrees with it;
 * postingPagesManifest, the function it is written by, is held to a set of
 * entries with posting pages in it, capped as the bake caps them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { postingPagesManifest } from "../../scripts/prerender-seo.mjs";
import { capPostingEntries } from "../../scripts/prerender-pages.mjs";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
let OUT = "";
let DIST = "";
let LOG = "";
let TODAY = "";

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "posting-pages-"));
  DIST = join(OUT, "dist");
  mkdirSync(DIST, { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(DIST, "index.html"));
  TODAY = new Date().toISOString().slice(0, 10);
  LOG = execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}, 300_000);
afterAll(() => {
  if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true });
});

const isPosting = (e: { path: string }) => e.path.startsWith("/jobs/posting/");

describe("postingPagesManifest", () => {
  it("names the sitemap's posting entries in its order, and nothing else", () => {
    const entries = [
      { path: "/jobs" },
      { path: "/jobs/posting/greenhouse/acme/2" },
      { path: "/jobs/company/acme" },
      { path: "/jobs/posting/workday/asml~wd3~asmlext1/J-00348204" },
    ];
    expect(postingPagesManifest(entries, { today: "2026-11-18", isPosting })).toEqual({
      at: "2026-11-18",
      live: ["/jobs/posting/greenhouse/acme/2", "/jobs/posting/workday/asml~wd3~asmlext1/J-00348204"],
      // CRAWL18B-4: the same paths as rows; with nothing known of a page, its path and a null field.
      rows: [{ path: "/jobs/posting/greenhouse/acme/2", field: null }, { path: "/jobs/posting/workday/asml~wd3~asmlext1/J-00348204", field: null }],
    });
  });

  it("after the ceiling's cap it names exactly what the sitemap keeps", () => {
    const entries = [{ path: "/" }, ...Array.from({ length: 7 }, (_, i) => ({ path: `/jobs/posting/greenhouse/acme/${i + 1}` }))];
    const capped = capPostingEntries(entries, { isPosting, ceiling: 5 });
    const m = postingPagesManifest(capped.kept, { today: "2026-11-18", isPosting });
    expect(m.live).toHaveLength(5);
    expect(m.live).toEqual(capped.kept.filter(isPosting).map((e: { path: string }) => e.path));
  });

  it("writes each path as the sitemap writes its loc", () => {
    const href = (p: string) => (/\.[^/]+$/.test(p) ? `${p}/` : p);
    expect(postingPagesManifest([{ path: "/jobs/posting/x/y/1.5" }], { today: "2026-11-18", isPosting, href }).live).toEqual(["/jobs/posting/x/y/1.5/"]);
  });
});

describe("the bake writes /posting-pages.json beside /landers.json", () => {
  it("is written, dated today, and its live set equals the sitemap's posting locs", () => {
    const file = join(DIST, "posting-pages.json");
    expect(existsSync(file), LOG.split("\n").filter((l) => /posting/.test(l)).join("\n")).toBe(true);
    expect(existsSync(join(DIST, "landers.json"))).toBe(true);
    const m = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(m).sort()).toEqual(["at", "live", "rows"]);
    expect(m.rows.map((r: { path: string }) => r.path)).toEqual(m.live);
    expect(m.at).toBe(TODAY);
    const locs = [...readFileSync(join(DIST, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1].replace(SITE, "")).filter((p) => p.startsWith("/jobs/posting/"));
    expect(m.live).toEqual(locs);
    expect(LOG).toMatch(/\/posting-pages\.json written: \d+ live posting page\(s\), the sitemap's own/);
  });
});
