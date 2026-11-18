/**
 * A GCC CV PAGE POINTS AT THE SAUDI PAGE (SEO audit 2026-11-18, CONTENT-3).
 *
 * The scanner's country data gives Kuwait, Qatar, Bahrain and Oman the Saudi
 * entry field for field; only the name differs. Their four /cv-standards pages
 * were the Saudi page with another name in it, each self-canonical and in the
 * sitemap, and llms.txt counted all of them as "56 countries".
 *
 * Now each names /cv-standards/saudi-arabia as its canonical (baked and
 * rendered alike), leaves the sitemap and carries no hreflang; the Saudi
 * page's title names the group; the llms files count 52 countries plus four
 * GCC states that follow the Saudi rules. Which pages follow another is
 * worked out here from the data, independently of the bake.
 *
 * The bake is handed a stale llms.txt saying "56 countries", as 9c9234e9a
 * committed it: a bake of this branch's file, already rewritten, served the
 * right count whether or not the bake restated it (lane A review,
 * 2026-11-18).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan/country-standards";
import { COUNTRY_SLUGS } from "@/data/cv-standards-content";
import CvStandards from "@/pages/CvStandards";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const SAUDI = `${SITE}/cv-standards/saudi-arabia`;
const GCC = ["kuwait", "qatar", "bahrain", "oman"];
const COUNT = "52 countries plus four GCC states that follow the Saudi rules";

const COMMITTED_LLMS = readFileSync(join(ROOT, "public/llms.txt"), "utf8");
/** A line no restatement touches: the served file carries it only if the bake read the stale copy. */
const SEEDED = "Seeded stale copy, lane A review 2026-11-18.";
const STALE_LLMS = `${COMMITTED_LLMS.replace(`norms for ${COUNT}`, "norms for 56 countries")}\n${SEEDED}\n`;

let OUT = "";
function bake(): string {
  if (OUT) return join(OUT, "dist");
  OUT = mkdtempSync(join(tmpdir(), "gcc-cv-"));
  mkdirSync(join(OUT, "dist"), { recursive: true });
  mkdirSync(join(OUT, "public"), { recursive: true });
  writeFileSync(join(OUT, "public", "llms.txt"), STALE_LLMS);
  copyFileSync(join(ROOT, "index.html"), join(OUT, "dist", "index.html"));
  execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return join(OUT, "dist");
}
afterAll(() => {
  if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true });
});

const page = (slug: string) => readFileSync(join(bake(), "cv-standards", slug, "index.html"), "utf8");
const canonicalOf = (html: string) => (/<link rel="canonical" href="([^"]+)"/.exec(html) || [])[1];
const alternatesOf = (html: string) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)"/g)].map((m) => m[1]);
const titleOf = (html: string) => ((/<title>([^<]*)<\/title>/.exec(html) || [])[1] ?? "").replace(/&amp;/g, "&");
const sitemapLocs = () => [...readFileSync(join(bake(), "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

describe("the data", () => {
  it("gives exactly the four GCC states the Saudi rules, field for field", () => {
    const key = (iso: string) => {
      const { iso: _i, name: _n, ...rules } = COUNTRY_STANDARDS[iso];
      return JSON.stringify(rules);
    };
    const isos = Object.keys(COUNTRY_SLUGS).filter((iso) => COUNTRY_STANDARDS[iso]);
    const same = isos.filter((iso) => iso !== "SA" && key(iso) === key("SA")).map((iso) => COUNTRY_SLUGS[iso]).sort();
    expect(same).toEqual([...GCC].sort());
    // and no other two countries share their rules
    const keys = isos.filter((iso) => !GCC.includes(COUNTRY_SLUGS[iso])).map(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(isos.length - GCC.length).toBe(52);
  });
});

describe("the baked pages", () => {
  it("each GCC page names the Saudi page as canonical, carries no hreflang and leaves the sitemap", () => {
    const locs = sitemapLocs();
    for (const slug of GCC) {
      const html = page(slug);
      expect(canonicalOf(html), slug).toBe(SAUDI);
      expect(alternatesOf(html), slug).toEqual([]);
      expect(locs, slug).not.toContain(`${SITE}/cv-standards/${slug}`);
    }
  }, 120_000);

  it("the Saudi page names itself, stays in the sitemap and titles the group", () => {
    const html = page("saudi-arabia");
    expect(canonicalOf(html)).toBe(SAUDI);
    expect(sitemapLocs()).toContain(SAUDI);
    expect(titleOf(html)).toBe("CV Rules in Saudi Arabia & the GCC: Photo, Length, Format");
    // every other country page still names itself
    expect(canonicalOf(page("germany"))).toBe(`${SITE}/cv-standards/germany`);
    expect(sitemapLocs().filter((l) => l.startsWith(`${SITE}/cv-standards/`))).toHaveLength(52);
  }, 120_000);

  it("the llms files count 52 countries plus four GCC states, from a stale llms.txt too", () => {
    expect(STALE_LLMS, "the bake is handed the old count").toContain("norms for 56 countries —");
    const dist = bake();
    expect(readFileSync(join(dist, "llms.txt"), "utf8"), "the bake read the stale copy").toContain(SEEDED);
    for (const [name, text] of [
      ["dist/llms.txt", readFileSync(join(dist, "llms.txt"), "utf8")],
      ["dist/llms-full.txt", readFileSync(join(dist, "llms-full.txt"), "utf8")],
      ["public/llms.txt", readFileSync(join(ROOT, "public/llms.txt"), "utf8")],
    ]) {
      expect(text, name).toContain(`norms for ${COUNT}`);
      expect(text, name).not.toMatch(/norms for 56 countries/);
    }
  }, 120_000);
});

describe("the rendered pages", () => {
  const head = async (path: string) => {
    const view = render(
      h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: "/cv-standards/:country", element: h(CvStandards) })))),
    );
    await new Promise((r) => setTimeout(r, 0));
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    const alternates = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.getAttribute("hreflang"));
    const title = document.title;
    view.unmount();
    return { canonical, alternates, title };
  };

  it("name the canonical and title their baked files name", async () => {
    for (const slug of GCC) {
      const got = await head(`/cv-standards/${slug}`);
      expect(got.canonical, slug).toBe(SAUDI);
      expect(got.alternates, slug).toEqual([]);
      expect(got.title, slug).toBe(titleOf(page(slug)));
    }
    const saudi = await head("/cv-standards/saudi-arabia");
    expect(saudi.canonical).toBe(SAUDI);
    expect(saudi.title).toBe(titleOf(page("saudi-arabia")));
  }, 120_000);
});
