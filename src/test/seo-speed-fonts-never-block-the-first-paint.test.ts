import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { skipWithoutDist } from "./helpers/built-output";

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
 *   stylesheet request at all), font-display optional, pointing at the
 *   woff2 files on the font host; the Inter latin file, one variable file for
 *   400-700, is preloaded. So the face is known at the first layout: on a
 *   first visit it is used if it arrives inside the browser's short block
 *   period, otherwise the page keeps the metric-matched Inter Fallback for
 *   that view and never re-wraps (the swap cost the Domino's page 0.136 of
 *   CLS on a phone); from the next load on it comes from the HTTP cache and
 *   renders;
 * - it carries every face the tailwind stacks name: Inter 400-700 and
 *   JetBrains Mono 400 (the mono stack, used for ids and code);
 * - there is no preconnect to a host the page never uses;
 * - R1's stash script is still the first thing in the head.
 * The built pages (the bake copies this head into every page it writes) are
 * read too, when a build exists.
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
const FILE_HOST = "https://fonts.gstatic.com/";

/** The @font-face rules a head declares inline, as { family, weight, display, src, range }. */
function inlineFaces(head: string) {
  const css = [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const prop = (k: string) => (new RegExp(`${k}\\s*:\\s*([^;]+)`).exec(m[1])?.[1] ?? "").trim();
    return { family: prop("font-family").replace(/['"]/g, ""), weight: prop("font-weight"), display: prop("font-display"), src: (/url\(([^)]+)\)/.exec(prop("src"))?.[1] ?? "").replace(/['"]/g, ""), range: prop("unicode-range") };
  });
}

/** What a head must hold for the fonts never to block a paint and still be used. Returns the problems found. */
function fontProblems(html: string): string[] {
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
    if (!f.src.startsWith(FILE_HOST) || !f.src.endsWith(".woff2")) problems.push(`${f.family} is not a woff2 on the font file host: ${f.src}`);
  }
  if (inter.length && !inter.every((f) => /^400\s+700$/.test(f.weight))) problems.push(`Inter does not cover 400-700: ${inter.map((f) => f.weight).join(", ")}`);
  if (mono.length && !mono.every((f) => f.weight === "400")) problems.push(`JetBrains Mono is not 400: ${mono.map((f) => f.weight).join(", ")}`);
  const latin = inter.find((f) => /^U\+0000-00FF\b/.test(f.range));
  if (!latin) problems.push("no Inter face covers latin (U+0000-00FF)");
  else if (!links.some((l) => l.rel === "preload" && l.as === "font" && l.type === "font/woff2" && "crossorigin" in l && l.href === latin.src)) problems.push(`the Inter latin file ${latin.src} is not preloaded as a crossorigin woff2 font`);
  if (!links.some((l) => l.rel === "preconnect" && l.href === "https://fonts.gstatic.com" && "crossorigin" in l)) problems.push("no crossorigin preconnect to the font file host");
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

  it("still opens with R1's stash script", () => {
    const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(HTML)?.[1] ?? "";
    expect(head).toMatch(/^\s*<script>\s*\/\*/);
    expect(/<script\b[^>]*>([\s\S]*?)<\/script>/.exec(head)?.[1]).toMatch(/rb_url_stash/);
  });

  it("the check reads something: the head that shipped before this fix fails it", () => {
    const before = HTML.replace(/<head>/, `<head><link rel="preconnect" href="https://js.stripe.com" />`);
    expect(fontProblems(before).some((p) => /stripe/.test(p))).toBe(true);
    expect(fontProblems("<html><head></head></html>").length).toBeGreaterThan(0);
    // The round's media-swap head: Inter rendered on no load at all.
    const swapped = `<html><head><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=optional" media="print" onload="this.media='all'" /></head></html>`;
    expect(fontProblems(swapped).some((p) => /font stylesheet request/.test(p))).toBe(true);
    expect(fontProblems(swapped).some((p) => /declares no Inter face/.test(p))).toBe(true);
  });
});

const DIST = resolve(ROOT, "dist");
const BUILT = ["dist/index.html", "dist/jobs/index.html", "dist/pricing/index.html"].map((p) => resolve(ROOT, p));
describe.skipIf(skipWithoutDist(BUILT.every((p) => existsSync(p))))("the built pages", () => {
  it.each(BUILT.map((p) => [p.slice(DIST.length + 1)] as const))("%s carries the same non-blocking font head", (rel) => {
    expect(fontProblems(readFileSync(resolve(DIST, rel), "utf8"))).toEqual([]);
  });

  it("the built app stylesheet imports nothing", () => {
    const html = readFileSync(resolve(DIST, "index.html"), "utf8");
    const sheets = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/assets\/([^"]+\.css)"/g)].map((m) => m[1]);
    expect(sheets.length).toBeGreaterThan(0);
    for (const s of sheets) expect(readFileSync(resolve(DIST, "assets", s), "utf8")).not.toMatch(/@import\b/);
    expect(readdirSync(resolve(DIST, "assets")).some((f) => f.endsWith(".css"))).toBe(true);
  });
});
