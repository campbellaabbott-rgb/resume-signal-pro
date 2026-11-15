// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { skipWithoutDist } from "./helpers/built-output";
import { fontHeadProblems } from "../../scripts/prerender-preload.mjs";
import { PHONE, repeatLoadVerdict } from "../../scripts/seo-lab-font-check.mjs";
import viteConfig from "../../vite.config";

/**
 * WHAT WAS WRONG (SEO-020, spec 2026-10-12): the first rule of the app
 * stylesheet imported Google's font CSS. A browser cannot paint until both
 * stylesheets have arrived, and it cannot even ask for the second until the
 * first is parsed: one more blocking round trip, chained, on every page. On
 * the mobile lab profile the font CSS alone ran 1,783-2,374 ms, and FCP waited
 * for it. The head also opened a connection to Stripe's script host, which no
 * page loads.
 *
 * THEN, THE ROUND'S REVIEW (2026-10-24): the round applied Google's font
 * CSS by a media swap AFTER the first paint and asked for font-display
 * optional. An optional face that is not declared when the text first lays
 * out is never used for that page, so Inter rendered on no load at all,
 * first or repeat (h1 read "Arial", the fallback face, on 42 matrix loads and
 * on repeat loads with the HTTP cache on), while the woff2 still downloaded.
 *
 * What holds now:
 * - src/index.css imports nothing; the app stylesheet is the only stylesheet
 *   the first paint waits for;
 * - the faces are declared in the head itself (an inline style, no font
 *   stylesheet request at all), font-display optional, pointing at woff2
 *   files this site serves itself (S12-011: a visit asked Google's font host
 *   for them before any consent). So the face is known at the first layout:
 *   on a first visit it is used if it arrives inside the browser's short
 *   block period, otherwise the page keeps the metric-matched Inter Fallback
 *   for that view and never re-wraps (the swap cost the Domino's page 0.136
 *   of CLS on a phone); from the next load on it comes from the HTTP cache
 *   and renders;
 * - THE FILES ARE BUILT (B12, SEO/GEO audit 2026-11-07, F06 and PERF-02):
 *   the faces name src/assets/fonts, and the build emits each as a hashed
 *   /assets/*.woff2 with the year-long immutable cache. The public/fonts
 *   copies were served with no Cache-Control and never answered 304, so a
 *   phone downloaded 47-152 KB of font again on every full page load and
 *   painted the fallback on repeat loads too. The copies stay published for
 *   one more publish, for HTML cached before it;
 * - NO FONT IS PRELOADED (PERF-01): the preload of the Inter latin file
 *   shared the line with the one render-blocking stylesheet and cost the
 *   phone lab a median 156 ms of LCP on / and 192 ms on a company page;
 * - it carries every face the tailwind stacks name: Inter 400-700 and
 *   JetBrains Mono 400 (the mono stack, used for ids and code);
 * - there is no preconnect to a host the page never uses, the old font host
 *   included, and every file a face names is in src/assets/fonts;
 * - R1's stash script is still the first thing in the head.
 * The built pages (the bake copies this head into every page it writes) are
 * read too, when a build exists: every face names a hashed /assets/ file the
 * build emitted, and no head names /fonts/.
 */
const ROOT = resolve(__dirname, "../..");
const HTML = readFileSync(resolve(ROOT, "index.html"), "utf8");
const CSS = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
const TAILWIND = readFileSync(resolve(ROOT, "tailwind.config.ts"), "utf8");

const headOf = (html: string) => (/<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "").replace(/<!--[\s\S]*?-->/g, "");
const cssCode = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)(?:\s*=\s*"([^"]*)")?/g)) out[m[1].toLowerCase()] = m[2] ?? "";
  return out;
}
const linksOf = (head: string) => [...head.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "").matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0].slice(5)));
/** Where a face's file lives: in the source head, a file in src/assets/fonts; in a built head, the hashed file the build emitted (B12). */
const SOURCE_FONT = /^\/src\/assets\/fonts\/[a-z0-9-]+\.woff2$/;
const BUILT_FONT = /^\/assets\/[a-z0-9-]+-[A-Za-z0-9_-]{6,}\.woff2$/;
const THIRD_PARTY_FONT_HOST = /fonts\.(gstatic|googleapis)\.com/;

/** The @font-face rules a head declares inline, as { family, weight, display, src, range }. */
function inlineFaces(head: string) {
  const css = [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const prop = (k: string) => (new RegExp(`${k}\\s*:\\s*([^;]+)`).exec(m[1])?.[1] ?? "").trim();
    return { family: prop("font-family").replace(/['"]/g, ""), weight: prop("font-weight"), display: prop("font-display"), src: (/url\(([^)]+)\)/.exec(prop("src"))?.[1] ?? "").replace(/['"]/g, ""), range: prop("unicode-range") };
  });
}

/** What a head must hold for the fonts never to block a paint and still be used. Returns the problems found. */
function fontProblems(html: string, built = false): string[] {
  const head = headOf(html);
  const links = linksOf(head);
  const problems: string[] = [];
  const sheets = links.filter((l) => l.rel === "stylesheet" && /^https:\/\/fonts\.googleapis\.com\//.test(l.href ?? ""));
  if (sheets.length) problems.push(`a font stylesheet request (${sheets[0].href}): the faces must be declared in the head, or an optional face arrives after the first layout and is never used`);
  const faces = inlineFaces(head);
  const inter = faces.filter((f) => f.family === "Inter");
  const mono = faces.filter((f) => f.family === "JetBrains Mono");
  if (!inter.length) problems.push("the head declares no Inter face");
  if (!mono.length) problems.push("the head declares no JetBrains Mono face");
  for (const f of faces) {
    if (f.display !== "optional") problems.push(`${f.family} asks for font-display ${f.display || "nothing"}, not optional (a late swap re-wraps the prerendered page)`);
    if (!(built ? BUILT_FONT : SOURCE_FONT).test(f.src)) problems.push(`${f.family} is not a woff2 this site ${built ? "serves from a hashed /assets/ address" : "builds from src/assets/fonts"}: ${f.src}`);
  }
  if (inter.length && !inter.every((f) => /^400\s+700$/.test(f.weight))) problems.push(`Inter does not cover 400-700: ${inter.map((f) => f.weight).join(", ")}`);
  if (mono.length && !mono.every((f) => f.weight === "400")) problems.push(`JetBrains Mono is not 400: ${mono.map((f) => f.weight).join(", ")}`);
  if (!inter.some((f) => /^U\+0000-00FF\b/.test(f.range))) problems.push("no Inter face covers latin (U+0000-00FF)");
  for (const l of links.filter((x) => x.rel === "preload" && x.as === "font")) problems.push(`the head preloads the font ${l.href}, which shares the line with the render-blocking stylesheet (PERF-01)`);
  if (THIRD_PARTY_FONT_HOST.test(head)) problems.push("the head still names Google's font host: every visit asks it for something before any consent (S12-011)");
  for (const l of links.filter((x) => x.rel === "preconnect" || x.rel === "dns-prefetch")) {
    if (/stripe\.com/.test(l.href ?? "")) problems.push(`a ${l.rel} to ${l.href}, which no page loads`);
  }
  return problems;
}

describe("the app stylesheet", () => {
  it("imports nothing, so the first paint waits for one stylesheet only", () => {
    expect(cssCode(CSS).length, "src/index.css was read").toBeGreaterThan(1000);
    expect(cssCode(CSS)).not.toMatch(/@import\b/);
  });

  it("keeps the metric-matched fallback face the sans stacks name, which the swap needs to move no line", () => {
    expect(cssCode(CSS)).toMatch(/@font-face\s*{[^}]*font-family:\s*"Inter Fallback"[^}]*size-adjust:/);
    expect(codeOf(TAILWIND)).toMatch(/sans:\s*\["Inter", "Inter Fallback"/);
  });
});

describe("the static head", () => {
  it("loads the font CSS from the head without blocking the paint, and preconnects only to hosts it uses", () => {
    expect(fontProblems(HTML)).toEqual([]);
  });

  it("builds every face's file itself, a woff2 in src/assets/fonts with its licence beside it, and the licence stays published", () => {
    const faces = inlineFaces(headOf(HTML));
    expect(faces.length).toBeGreaterThanOrEqual(2);
    for (const f of faces) {
      const file = resolve(ROOT, f.src.replace(/^\//, ""));
      expect(existsSync(file), f.src).toBe(true);
      expect(statSync(file).size, f.src).toBeGreaterThan(500);
      expect(readFileSync(file).subarray(0, 4).toString("latin1"), f.src).toBe("wOF2");
    }
    for (const lic of ["OFL-Inter.txt", "OFL-JetBrainsMono.txt"]) {
      expect(readFileSync(resolve(ROOT, "src/assets/fonts", lic), "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
      expect(readFileSync(resolve(ROOT, "public/fonts", lic), "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
    }
  });

  it("keeps the old /fonts/ copies published one more publish, byte for byte, for pages cached before it", () => {
    for (const f of inlineFaces(headOf(HTML))) {
      const name = f.src.split("/").pop()!;
      const old = resolve(ROOT, "public/fonts", name);
      expect(existsSync(old), name).toBe(true);
      expect(readFileSync(old).equals(readFileSync(resolve(ROOT, f.src.replace(/^\//, "")))), name).toBe(true);
    }
  });

  it("the build never inlines a font, so even the two faces under 4 KB get a hashed, cached file", () => {
    const config = (viteConfig as unknown as (env: { mode: string; command: string }) => { build?: { assetsInlineLimit?: unknown } })({ mode: "production", command: "build" });
    const limit = config.build?.assetsInlineLimit;
    expect(typeof limit).toBe("function");
    const small = readFileSync(resolve(ROOT, "src/assets/fonts/jetbrains-mono-cyrillic-ext.woff2"));
    expect(small.length).toBeLessThan(4096);
    expect((limit as (f: string, c: Buffer) => boolean | undefined)(resolve(ROOT, "src/assets/fonts/jetbrains-mono-cyrillic-ext.woff2"), small)).toBe(false);
    // Anything else keeps Vite's own rule.
    expect((limit as (f: string, c: Buffer) => boolean | undefined)(resolve(ROOT, "src/assets/logo.svg"), Buffer.from("<svg/>"))).toBeUndefined();
  });

  it("still opens with R1's stash script", () => {
    const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(HTML)?.[1] ?? "";
    expect(head).toMatch(/^\s*<script>\s*\/\*/);
    expect(/<script\b[^>]*>([\s\S]*?)<\/script>/.exec(head)?.[1]).toMatch(/rb_url_stash/);
  });

  it("the check reads something: the head that shipped before this fix fails it", () => {
    const before = HTML.replace(/<head>/, `<head><link rel="preconnect" href="https://js.stripe.com" />`);
    expect(fontProblems(before).some((p) => /stripe/.test(p))).toBe(true);
    expect(fontProblems("<html><head></head></html>").length).toBeGreaterThan(0);
    // The head before S12-011: the same faces on Google's font host.
    const hosted = HTML.replace(/\/src\/assets\/fonts\/inter-latin\.woff2/g, "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2");
    expect(fontProblems(hosted).some((p) => /Google's font host/.test(p))).toBe(true);
    expect(fontProblems(hosted).some((p) => /not a woff2 this site builds/.test(p))).toBe(true);
    // The head served until B12 and PERF-01: faces on the uncached /fonts/
    // copies, and the latin file preloaded beside the stylesheet.
    const served = HTML.replace(/\/src\/assets\/fonts\//g, "/fonts/").replace("<style>", `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/inter-latin.woff2" /><style>`);
    expect(fontProblems(served).some((p) => /not a woff2 this site builds/.test(p))).toBe(true);
    expect(fontProblems(served).some((p) => /preloads the font \/fonts\/inter-latin\.woff2/.test(p))).toBe(true);
    expect(fontProblems(served, true).some((p) => /hashed \/assets\/ address/.test(p))).toBe(true);
    expect(fontHeadProblems(served, []).some((p) => /preloads a font/.test(p))).toBe(true);
    expect(fontHeadProblems(served, []).some((p) => /not a hashed \/assets\/\*\.woff2/.test(p))).toBe(true);
    // The round's media-swap head: Inter rendered on no load at all.
    const swapped = `<html><head><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=optional" media="print" onload="this.media='all'" /></head></html>`;
    expect(fontProblems(swapped).some((p) => /font stylesheet request/.test(p))).toBe(true);
    expect(fontProblems(swapped).some((p) => /declares no Inter face/.test(p))).toBe(true);
  });
});

describe("the lab check (scripts/seo-lab-font-check.mjs)", () => {
  const INTER = ["Inter(web)"];
  it("fails a repeat load that fetched a font from the network, even when it painted Inter", () => {
    const v = repeatLoadVerdict({ path: "/", first: ["Arial"], repeat: INTER, repeatFonts: [{ url: "/fonts/inter-latin.woff2", fromCache: false }] });
    expect(v.ok).toBe(false);
    expect(v.line).toBe("FAIL  /: first load h1 Arial; repeat load h1 Inter(web); repeat load fonts: 0 from cache, 1 from the network (/fonts/inter-latin.woff2)");
  });
  it("passes a repeat load that painted Inter from cached fonts, and fails one that painted the fallback", () => {
    expect(repeatLoadVerdict({ path: "/", first: ["Arial"], repeat: INTER, repeatFonts: [{ url: "/assets/inter-latin-8kRkwJBP.woff2", fromCache: true }] }).ok).toBe(true);
    expect(repeatLoadVerdict({ path: "/", first: ["Arial"], repeat: ["Arial"], repeatFonts: [{ url: "/assets/inter-latin-8kRkwJBP.woff2", fromCache: true }] }).ok).toBe(false);
  });
  it("throttles --phone runs to the profile the audit measured with", () => {
    expect(PHONE).toEqual({ viewport: { width: 412, height: 823 }, cpuRate: 4, latencyMs: 150, downKbps: 1600, upKbps: 750 });
  });
});

const DIST = resolve(ROOT, "dist");
const BUILT = ["dist/index.html", "dist/jobs/index.html", "dist/pricing/index.html"].map((p) => resolve(ROOT, p));
describe.skipIf(skipWithoutDist(BUILT.every((p) => existsSync(p))))("the built pages", () => {
  it.each(BUILT.map((p) => [p.slice(DIST.length + 1)] as const))("%s carries the same non-blocking font head, every face a hashed file the build emitted", (rel) => {
    const html = readFileSync(resolve(DIST, rel), "utf8");
    expect(fontProblems(html, true)).toEqual([]);
    const assets = readdirSync(resolve(DIST, "assets"));
    expect(fontHeadProblems(html, assets)).toEqual([]);
    for (const f of inlineFaces(headOf(html))) expect(readFileSync(resolve(DIST, f.src.replace(/^\//, ""))).subarray(0, 4).toString("latin1"), f.src).toBe("wOF2");
    expect(headOf(html)).not.toMatch(/["'(]\/fonts\//);
  });

  it("the built app stylesheet imports nothing", () => {
    const html = readFileSync(resolve(DIST, "index.html"), "utf8");
    const sheets = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/assets\/([^"]+\.css)"/g)].map((m) => m[1]);
    expect(sheets.length).toBeGreaterThan(0);
    for (const s of sheets) expect(readFileSync(resolve(DIST, "assets", s), "utf8")).not.toMatch(/@import\b/);
    expect(readdirSync(resolve(DIST, "assets")).some((f) => f.endsWith(".css"))).toBe(true);
  });
});
