// @vitest-environment node
/**
 * A BAKED PAGE FETCHES ITS ROUTE CHUNKS BEHIND THE STYLESHEET, AND ITS FONTS
 * FROM HASHED FILES (PERF-01 and B12, SEO/GEO audit 2026-11-07).
 *
 * Every baked page paints from its own HTML and one render-blocking
 * stylesheet; the LCP element is baked text on every page type the lab
 * measured, so no preloaded script feeds the first paint. The bake wrote
 * twelve route-chunk hints at the default (high) priority on every company,
 * field, posting, /jobs and /pricing head, and the head preloaded the Inter
 * latin file: on the phone lab profile the stylesheet finished 1,290-1,360 ms
 * in, and with the hints at low priority and no font preload it finished at
 * 1,150-1,190 and LCP came 200-250 ms sooner on company, field and posting
 * pages. A hint still starts its chunk before the entry asks for it.
 *
 * The faces named the public/fonts copies, which the host serves with no
 * Cache-Control and never a 304, so every full page load fetched them again.
 * The build now emits them as hashed /assets/ files with the immutable cache,
 * and the bake checks the head it copies into every page (fontHeadProblems).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fallbackPreloadHtml, fontHeadProblems, modulepreloadTag } from "../../scripts/prerender-preload.mjs";
import { codeOf } from "./helpers/strip-comments";
import { skipWithoutDist } from "./helpers/built-output";

const ROOT = resolve(__dirname, "../..");
const BAKE = codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));
const SOURCE_HEAD = readFileSync(resolve(ROOT, "index.html"), "utf8");

/** Every route-chunk hint tag in a page. */
const hints = (html: string) => html.match(/<link\b[^>]*\brel="modulepreload"[^>]*>/g) ?? [];
/** The hints that would compete with the stylesheet: any not asking at low priority. */
const competing = (html: string) => hints(html).filter((t) => !/\sfetchpriority="low"/.test(t));

/** Runs the fallback's inline script at an address; returns the links it added, as plain records. */
const scriptAdds = (html: string, pathname: string) => {
  const added: Array<Record<string, string>> = [];
  const doc = { createElement: () => ({}) as Record<string, string>, head: { appendChild: (l: Record<string, string>) => { added.push({ ...l }); } } };
  for (const m of html.matchAll(/<script data-home-preload="1">([\s\S]*?)<\/script>/g)) {
    new Function("location", "document", "URLSearchParams", m[1])({ pathname, search: "", hash: "" }, doc, URLSearchParams);
  }
  return added;
};

describe("a route-chunk hint", () => {
  it("asks at low priority, with the attribute after its href so a reader of the tag up to its href still reads it", () => {
    const tag = modulepreloadTag("Jobs-ab12.js");
    expect(tag).toBe('<link rel="modulepreload" href="/assets/Jobs-ab12.js" fetchpriority="low">');
    // The reader 98-seo-round and the bake's own guards use.
    expect([...tag.matchAll(/<link rel="modulepreload" href="\/assets\/([^"]+)"/g)].map((m) => m[1])).toEqual(["Jobs-ab12.js"]);
    expect(competing(tag)).toEqual([]);
  });

  it("is how the bake writes every page's hints", () => {
    expect(BAKE).toMatch(/files\.map\(modulepreloadTag\)/);
    expect(BAKE, "a hint tag written by hand in the bake").not.toMatch(/rel="modulepreload"/);
  });

  it("the SPA fallback's static hint and every link its script adds on '/' ask at low priority", () => {
    const html = fallbackPreloadHtml(["HomePage-a.js", "HomeSearchHero-b.js"], { always: ["Footer-z.js"] });
    expect(hints(html)).toEqual(['<link rel="modulepreload" href="/assets/Footer-z.js" fetchpriority="low">']);
    expect(scriptAdds(html, "/")).toEqual([
      { rel: "modulepreload", fetchPriority: "low", href: "/assets/HomePage-a.js" },
      { rel: "modulepreload", fetchPriority: "low", href: "/assets/HomeSearchHero-b.js" },
    ]);
    expect(scriptAdds(html, "/auth")).toEqual([]);
  });

  it("the check reads something: the hints as the bake wrote them until PERF-01 compete", () => {
    const before = '<link rel="modulepreload" href="/assets/Jobs-ab12.js"><link rel="modulepreload" href="/assets/Footer-z.js">';
    expect(competing(before)).toHaveLength(2);
  });
});

describe("the head's fonts, as the bake checks them", () => {
  const built = (faces: string[], extra = "") => `<html><head>${extra}<style>${faces.map((f) => `@font-face{font-family:Inter;font-display:optional;src:url(${f}) format("woff2")}`).join("")}</style></head><body></body></html>`;

  it("a head whose faces name the hashed files this build emitted, with no font preloaded, has no problem", () => {
    expect(fontHeadProblems(built(["/assets/inter-latin-8kRkwJBP.woff2", "/assets/jetbrains-mono-latin-RruCX7RW.woff2"]), ["inter-latin-8kRkwJBP.woff2", "jetbrains-mono-latin-RruCX7RW.woff2", "index-a.js"])).toEqual([]);
  });

  it("names a face whose file the build did not emit", () => {
    expect(fontHeadProblems(built(["/assets/inter-latin-OLDHASH1.woff2"]), ["inter-latin-8kRkwJBP.woff2"])).toEqual(["a face names /assets/inter-latin-OLDHASH1.woff2, which the build did not emit"]);
  });

  it("names the head served until B12 and PERF-01: faces on the uncached /fonts/ copies and a font preload", () => {
    const served = built(["/fonts/inter-latin.woff2"], '<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/inter-latin.woff2" />');
    expect(fontHeadProblems(served, [])).toEqual([
      "a face names /fonts/inter-latin.woff2, not a hashed /assets/*.woff2",
      "the head preloads a font (/fonts/inter-latin.woff2), which competes with the stylesheet",
    ]);
  });

  it("names a source head the build never rewrote, so a bake on an unbuilt template says so", () => {
    const problems = fontHeadProblems(SOURCE_HEAD, []);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => /\/src\/assets\/fonts\/[a-z0-9-]+\.woff2, not a hashed/.test(p)), problems.join("\n")).toBe(true);
  });

  it("reads no face out of a comment", () => {
    expect(fontHeadProblems("<html><head><!-- <style>@font-face{src:url(/fonts/x.woff2)}</style> --></head></html>", [])).toEqual(["the head declares no @font-face"]);
  });
});

const DIST = resolve(ROOT, "dist");
/** The page types the lab measured, as this build wrote them. */
const builtPages = (): string[] => {
  const out = ["index.html", "pricing/index.html", "jobs/index.html"].filter((p) => existsSync(join(DIST, p)));
  const pick = (dir: string) => {
    const base = join(DIST, dir);
    if (!existsSync(base)) return;
    const first = readdirSync(base, { withFileTypes: true }).find((d) => d.isDirectory() && existsSync(join(base, d.name, "index.html")));
    if (first) out.push(join(dir, first.name, "index.html"));
  };
  pick("jobs/company");
  pick("jobs/field");
  return out;
};
describe.skipIf(skipWithoutDist(existsSync(join(DIST, "pricing/index.html"))))("the built pages", () => {
  it("every route-chunk hint asks at low priority, each page has at least one, and no font is preloaded", () => {
    const pages = builtPages();
    expect(pages.length).toBeGreaterThanOrEqual(4);
    const assets = readdirSync(join(DIST, "assets"));
    for (const p of pages) {
      const html = readFileSync(join(DIST, p), "utf8");
      expect(hints(html).length, p).toBeGreaterThan(0);
      expect(competing(html), p).toEqual([]);
      expect(fontHeadProblems(html, assets), p).toEqual([]);
    }
  });
});
