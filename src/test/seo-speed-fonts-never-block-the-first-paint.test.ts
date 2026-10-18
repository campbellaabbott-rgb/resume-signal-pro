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
 * What holds now:
 * - src/index.css imports nothing; the app stylesheet is the only stylesheet
 *   the first paint waits for;
 * - the font CSS is requested from the head, at the same moment as the app
 *   CSS, preloaded, applied without blocking the paint (media swap, with a
 *   noscript twin), and asks for font-display swap. Text paints at once in the
 *   metric-matched Inter Fallback and changes face in place, moving no line;
 * - it carries every face the tailwind stacks name: Inter 400/500/600/700 and
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
const noscriptLinksOf = (head: string) => [...head.matchAll(/<noscript>([\s\S]*?)<\/noscript>/gi)].flatMap((m) => [...m[1].matchAll(/<link\b[^>]*>/gi)].map((l) => attrs(l[0].slice(5))));
const FONT_HOST = "https://fonts.googleapis.com/";

/** What a head must hold for the fonts never to block a paint. Returns the problems found. */
function fontProblems(html: string): string[] {
  const head = headOf(html);
  const links = linksOf(head);
  const problems: string[] = [];
  const sheets = links.filter((l) => l.rel === "stylesheet" && (l.href ?? "").startsWith(FONT_HOST));
  if (sheets.length !== 1) problems.push(`expected one font stylesheet link, found ${sheets.length}`);
  for (const s of sheets) {
    if (s.media !== "print" || !/this\.media\s*=\s*'all'/.test(s.onload ?? "")) problems.push(`the font stylesheet blocks the paint (media="${s.media}", onload="${s.onload}")`);
    const href = s.href ?? "";
    if (!/display=swap/.test(href)) problems.push("the font CSS does not ask for font-display swap");
    if (!/family=Inter:wght@400;500;600;700(&|$)/.test(href)) problems.push(`the font CSS does not carry Inter 400-700: ${href}`);
    if (!/family=JetBrains\+Mono:wght@400(&|$)/.test(href)) problems.push(`the font CSS does not carry JetBrains Mono 400: ${href}`);
    if (!links.some((l) => l.rel === "preload" && l.as === "style" && l.href === href)) problems.push("the font CSS is not preloaded");
    if (!noscriptLinksOf(head).some((l) => l.rel === "stylesheet" && l.href === href)) problems.push("no noscript twin applies the font CSS without script");
  }
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
