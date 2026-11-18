// @vitest-environment node
/**
 * A BAKED PAGE FETCHES ITS ROUTE CHUNKS BEHIND THE STYLESHEET, AND ITS FONTS
 * FROM HASHED FILES (PERF-01 and B12, SEO/GEO audit 2026-11-07; PERFORMANCE-1,
 * SEO audit 2026-11-18).
 *
 * Every baked page paints from its own HTML and one render-blocking
 * stylesheet; the LCP element is baked text on every page type the lab
 * measured, so no preloaded script feeds the first paint. PERF-01 lowered the
 * twelve route-chunk hints in each board page's head to fetchpriority="low",
 * but the attribute is honoured only by the preload scanner and only without
 * bandwidth throttling: lab/prio2.mjs saw the live /jobs hints at High with
 * the download throttled, sharing the line with the stylesheet. Written after
 * the first paint instead (verify-performance-raw/ab.jsonl, 4 interleaved
 * phone rounds), /jobs LCP went from 2,402 to 1,876 ms and a field page from
 * 2,040 to 1,598, with React's board no later.
 *
 * So on the board's own pages (/jobs, a field, an employer, a posting) the
 * head names no route chunk, and one inline script at the end of <body>
 * adds the same files once a frame has been painted (requestAnimationFrame,
 * then a task). A hint still starts its chunk before the entry asks for it.
 * The homepage's hints were already added by a script; /pricing and the
 * scanner's pages, not measured, keep their low-priority head hints.
 *
 * The faces named the public/fonts copies, which the host serves with no
 * Cache-Control and never a 304, so every full page load fetched them again.
 * The build now emits them as hashed /assets/ files with the immutable cache,
 * and the bake checks the head it copies into every page (fontHeadProblems).
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deferredPreloadFiles, deferredPreloadHtml, defersRouteHints, fallbackPreloadHtml, fontHeadProblems, modulepreloadTag, preloadClosure } from "../../scripts/prerender-preload.mjs";
import { codeOf } from "./helpers/strip-comments";
import { skipWithoutDist } from "./helpers/built-output";

const ROOT = resolve(__dirname, "../..");
const BAKE = codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));
const SOURCE_HEAD = readFileSync(resolve(ROOT, "index.html"), "utf8");

/** Every route-chunk hint tag in a page. */
const hints = (html: string): string[] => html.match(/<link\b[^>]*\brel="modulepreload"[^>]*>/g) ?? [];
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

  it("is how the bake writes every page's hints, in the head or in the loader after the first paint", () => {
    expect(BAKE).toMatch(/files\.map\(modulepreloadTag\)/);
    expect(BAKE).toMatch(/deferredPreloadHtml\(routeFilesFor\(path\)\)/);
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

/** Runs a page's after-paint loader with the frame and the task under the test's control. */
const runLoader = (html: string) => {
  const added: Array<Record<string, string>> = [];
  const frames: Array<() => void> = [];
  const tasks: Array<() => void> = [];
  const doc = { createElement: () => ({}) as Record<string, string>, head: { appendChild: (l: Record<string, string>) => { added.push({ ...l }); } } };
  for (const m of html.matchAll(/<script data-route-preload="1">([\s\S]*?)<\/script>/g)) {
    new Function("document", "requestAnimationFrame", "setTimeout", m[1])(doc, (f: () => void) => frames.push(f), (f: () => void) => tasks.push(f));
  }
  return { added, frames, tasks };
};

describe("the loader written after the first paint", () => {
  it("adds nothing until a frame has been painted and a task has run, then the files in order", () => {
    const html = deferredPreloadHtml(["Jobs-a.js", "board-b.js", "Footer-z.js"]);
    const { added, frames, tasks } = runLoader(html);
    expect(added).toEqual([]);
    expect(frames).toHaveLength(1);
    frames[0]();
    expect(added, "the frame alone adds nothing").toEqual([]);
    expect(tasks).toHaveLength(1);
    tasks[0]();
    expect(added).toEqual([
      { rel: "modulepreload", href: "/assets/Jobs-a.js" },
      { rel: "modulepreload", href: "/assets/board-b.js" },
      { rel: "modulepreload", href: "/assets/Footer-z.js" },
    ]);
    expect(deferredPreloadFiles(html)).toEqual(["Jobs-a.js", "board-b.js", "Footer-z.js"]);
  });

  it("names nothing a quote could break, and is nothing for no files", () => {
    expect(deferredPreloadHtml([])).toBe("");
    expect(deferredPreloadFiles(deferredPreloadHtml(['x".js', "ok-1.js", "../up.js"]))).toEqual(["ok-1.js"]);
  });

  it("is read by verify section 98-seo-round's P3, which fails a posting page that still names its chunks in the head", () => {
    const sec = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/98-seo-round.sh"), "utf8");
    const from = sec.indexOf("const afterPaint = (h) => {");
    expect(from, "P3 reads the after-paint loader").toBeGreaterThan(-1);
    const fn = sec.slice(from, sec.indexOf("\n  };", from) + 5);
    const afterPaint = new Function(`${fn}; return afterPaint;`)() as (h: string) => string[];
    const html = `<html><head></head><body>${deferredPreloadHtml(["Footer-f.js", "JobPosting-p.js"])}</body></html>`;
    expect(afterPaint(html)).toEqual(deferredPreloadFiles(html));
    expect(afterPaint("<html><head></head><body></body></html>")).toEqual([]);
    expect(sec).toMatch(/names its route chunks in the head/);
  });

  it("is used on the board's own pages and nowhere else", () => {
    for (const p of ["/jobs", "/jobs/field/engineering", "/jobs/company/acme", "/jobs/posting/greenhouse/acme/1"]) expect(defersRouteHints(p), p).toBe(true);
    for (const p of ["/", "/pricing", "/resume-checker", "/es/revisar-curriculum", "/jobsearch", "/guides/x"]) expect(defersRouteHints(p), p).toBe(false);
  });
});

/**
 * THE PAGES AN OFFLINE BAKE WRITES, over route chunks named as Vite names
 * them: the board's pages carry no route-chunk hint in the head and a loader
 * naming the same files the head named before; /pricing keeps its head hints.
 */
describe("the baked pages", () => {
  let OUT = "";
  const CHUNKS: Record<string, string> = {
    "Jobs-j1.js": 'import{a}from"./board-x1.js";import"./Footer-f1.js";',
    "board-x1.js": "",
    "Footer-f1.js": "",
    "JobPosting-p1.js": 'import{a}from"./posting-p2.js";',
    "posting-p2.js": "",
    "PricingPage-pp1.js": "",
    "HomePage-h1.js": 'import{a}from"./HomeSearchHero-h2.js";',
    "HomeSearchHero-h2.js": "",
    "Index-i1.js": "",
  };
  const bake = () => {
    if (OUT) return join(OUT, "dist");
    OUT = mkdtempSync(join(tmpdir(), "route-hints-"));
    mkdirSync(join(OUT, "dist", "assets"), { recursive: true });
    copyFileSync(join(ROOT, "index.html"), join(OUT, "dist", "index.html"));
    for (const [f, code] of Object.entries(CHUNKS)) writeFileSync(join(OUT, "dist", "assets", f), code);
    execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
      cwd: ROOT,
      env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return join(OUT, "dist");
  };
  afterAll(() => {
    if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true });
  });
  const readChunk = (f: string) => CHUNKS[f] ?? null;
  /** What the head used to name for a route: its chunk's static closure, with Footer. */
  const routeFiles = (chunk: string) => {
    const files = preloadClosure(chunk, { readChunk });
    if (!files.includes("Footer-f1.js")) files.unshift("Footer-f1.js");
    return files;
  };
  const head = (html: string) => (/<head[^>]*>([\s\S]*?)<\/head>/.exec(html) || [])[1] ?? "";
  const firstPage = (dist: string, dir: string) => {
    const walk = (d: string): string | null => {
      if (existsSync(join(d, "index.html")) && d !== join(dist, dir)) return join(d, "index.html");
      for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { const hit = walk(join(d, e.name)); if (hit) return hit; }
      return null;
    };
    return walk(join(dist, dir));
  };

  it("/jobs, a field, an employer and a posting name no route chunk in the head, and their loader names the chunks the route runs", () => {
    const dist = bake();
    const pages: Array<[string, string, string]> = [
      ["/jobs", join(dist, "jobs", "index.html"), "Jobs-j1.js"],
      ["a field", join(dist, "jobs", "field", "engineering", "index.html"), "Jobs-j1.js"],
      ["an employer", firstPage(dist, "jobs/company") ?? "", "Jobs-j1.js"],
      ["a posting", firstPage(dist, "jobs/posting") ?? "", "JobPosting-p1.js"],
    ];
    for (const [name, file, chunk] of pages) {
      expect(existsSync(file), `${name}: ${file}`).toBe(true);
      const html = readFileSync(file, "utf8");
      expect(hints(head(html)), `${name}: head hints`).toEqual([]);
      expect(deferredPreloadFiles(html), name).toEqual(routeFiles(chunk));
      // the loader is the last thing in <body>
      expect(html, name).toMatch(/<script data-route-preload="1">[\s\S]*?<\/script><\/body>/);
    }
  }, 120_000);

  it("/pricing keeps its low-priority head hints and carries no loader", () => {
    const html = readFileSync(join(bake(), "pricing", "index.html"), "utf8");
    expect(hints(head(html)).length).toBeGreaterThan(0);
    expect(competing(html)).toEqual([]);
    expect(hints(head(html)).some((t) => t.includes("PricingPage-pp1.js"))).toBe(true);
    expect(deferredPreloadFiles(html)).toEqual([]);
  }, 120_000);
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
  it("every head hint asks at low priority, each page names its chunks (in the head or the after-paint loader), and no font is preloaded", () => {
    const pages = builtPages();
    expect(pages.length).toBeGreaterThanOrEqual(4);
    const assets = readdirSync(join(DIST, "assets"));
    for (const p of pages) {
      const html = readFileSync(join(DIST, p), "utf8");
      expect(hints(html).length + deferredPreloadFiles(html).length, p).toBeGreaterThan(0);
      expect(competing(html), p).toEqual([]);
      expect(fontHeadProblems(html, assets), p).toEqual([]);
    }
  });
});
