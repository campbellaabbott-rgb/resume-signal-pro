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
 * So on /jobs and a field page, the two the lab measured, the head names no
 * route chunk, and one inline script at the end of <body> adds the same
 * files, each by its /assets/ address, once a frame has been painted
 * (requestAnimationFrame, then a task). A hint still starts its chunk before
 * the entry asks for it. The homepage's hints were already added by a script;
 * /pricing, the scanner's pages, an employer page and a posting page, none of
 * them measured, keep their low-priority head hints.
 *
 * WHAT READS THOSE NAMES OUTSIDE THE BAKE (lane A review, 2026-11-18). Two
 * verify readers this lane does not own find the app's chunks in served
 * pages: scripts/verify-deploy.sh looks for /assets/Jobs-*.js in /jobs, and
 * section 99zz reads the script src and head modulepreload hrefs of a
 * posting page and an employer page for the chunk that carries the employer
 * names. With every board page deferred and the loader naming bare files,
 * the first found nothing (its PASS/FAIL line became INFO) and the second
 * read the entry alone (pub=false, every page claim INFO). Both readers are
 * run below, as their files spell them, on an offline bake.
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

  /** One function of verify section 98-seo-round, as the section spells it. */
  const sectionFn = (sec: string, head: string) => {
    const from = sec.indexOf(head);
    expect(from, `98-seo-round carries ${head}`).toBeGreaterThan(-1);
    const end = head.endsWith("{") ? sec.indexOf("\n  };", from) + 5 : sec.indexOf("\n", from);
    return sec.slice(from, end);
  };

  it("is read by verify section 98-seo-round's P3, which fails a /jobs that still names its chunks in the head", () => {
    const sec = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/98-seo-round.sh"), "utf8");
    const fns = ["const pre = (h) =>", "const afterPaint = (h) => {", "const jobsHints = (status, h) => {"].map((h) => sectionFn(sec, h)).join("\n");
    const { afterPaint, jobsHints } = new Function(`${fns}; return { afterPaint, jobsHints };`)() as {
      afterPaint: (h: string) => string[];
      jobsHints: (status: number, h: string) => [string, string];
    };
    const html = `<html><head></head><body>${deferredPreloadHtml(["Footer-f.js", "JobPosting-p.js"])}</body></html>`;
    expect(afterPaint(html)).toEqual(deferredPreloadFiles(html));
    expect(afterPaint(html)).toEqual(["Footer-f.js", "JobPosting-p.js"]);
    expect(afterPaint("<html><head></head><body></body></html>")).toEqual([]);
    // /jobs as this branch writes it, as 9c9234e9a wrote it, and with a loader that names no Jobs chunk
    const deferred = `<html><head></head><body>${deferredPreloadHtml(["Footer-f.js", "Jobs-j.js", "board-b.js"])}</body></html>`;
    expect(jobsHints(200, deferred)[0], jobsHints(200, deferred)[1]).toBe("PASS");
    expect(jobsHints(200, deferred)[1]).toContain("Jobs-j.js");
    const inHead = `<html><head>${["Footer-f.js", "Jobs-j.js"].map(modulepreloadTag).join("")}</head><body></body></html>`;
    expect(jobsHints(200, inHead)).toEqual(["FAIL", expect.stringMatching(/^P3 \/jobs names its route chunks in the head \(Footer-f\.js, Jobs-j\.js\)/)]);
    const noJobs = `<html><head></head><body>${deferredPreloadHtml(["Footer-f.js"])}</body></html>`;
    expect(jobsHints(200, noJobs)[0]).toBe("FAIL");
    expect(jobsHints(503, deferred)[0]).toBe("FAIL");
  });

  it("is used on /jobs and a field page, the two the lab measured, and nowhere else", () => {
    for (const p of ["/jobs", "/jobs/field/engineering"]) expect(defersRouteHints(p), p).toBe(true);
    for (const p of ["/jobs/company/acme", "/jobs/posting/greenhouse/acme/1", "/", "/pricing", "/resume-checker", "/es/revisar-curriculum", "/jobsearch", "/guides/x"]) expect(defersRouteHints(p), p).toBe(false);
  });

  it("names each file by its full /assets/ address", () => {
    const html = deferredPreloadHtml(["Jobs-a.js", "Footer-z.js"]);
    expect(html).toContain('["/assets/Jobs-a.js","/assets/Footer-z.js"]');
    expect(html.match(/assets\/Jobs-[A-Za-z0-9_-]+\.js/)?.[0]).toBe("assets/Jobs-a.js");
  });
});

/**
 * THE PAGES AN OFFLINE BAKE WRITES, over route chunks named as Vite names
 * them: /jobs and a field page carry no route-chunk hint in the head and a
 * loader naming the same files the head named before; an employer page, a
 * posting page and /pricing keep their head hints.
 */
describe("the baked pages", () => {
  let OUT = "";
  const CHUNKS: Record<string, string> = {
    "Jobs-j1.js": 'import{a}from"./board-x1.js";import"./Footer-f1.js";import{n}from"./company-display-c1.js";',
    "board-x1.js": "",
    "Footer-f1.js": "",
    // the chunk that carries the employer names, as the real build splits it
    // (src/lib/company-display.ts, imported by the board and the posting page)
    "company-display-c1.js": "",
    "JobPosting-p1.js": 'import{a}from"./posting-p2.js";import{n}from"./company-display-c1.js";',
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

  const pageFile = (dist: string, name: string) =>
    ({
      "/jobs": join(dist, "jobs", "index.html"),
      "a field": join(dist, "jobs", "field", "engineering", "index.html"),
      "an employer": firstPage(dist, "jobs/company") ?? "",
      "a posting": firstPage(dist, "jobs/posting") ?? "",
    })[name] ?? "";

  it("/jobs and a field name no route chunk in the head, and their loader names the chunks the route runs", () => {
    const dist = bake();
    for (const name of ["/jobs", "a field"]) {
      const file = pageFile(dist, name);
      expect(existsSync(file), `${name}: ${file}`).toBe(true);
      const html = readFileSync(file, "utf8");
      expect(hints(head(html)), `${name}: head hints`).toEqual([]);
      expect(deferredPreloadFiles(html), name).toEqual(routeFiles("Jobs-j1.js"));
      // the loader is the last thing in <body>
      expect(html, name).toMatch(/<script data-route-preload="1">[\s\S]*?<\/script><\/body>/);
    }
  }, 120_000);

  it("an employer and a posting keep the chunks the route runs in the head, at low priority, and carry no loader", () => {
    const dist = bake();
    for (const [name, chunk] of [["an employer", "Jobs-j1.js"], ["a posting", "JobPosting-p1.js"]]) {
      const file = pageFile(dist, name);
      expect(existsSync(file), `${name}: ${file}`).toBe(true);
      const html = readFileSync(file, "utf8");
      expect(hints(head(html)), `${name}: head hints`).toEqual(routeFiles(chunk).map(modulepreloadTag));
      expect(competing(html), name).toEqual([]);
      expect(deferredPreloadFiles(html), name).toEqual([]);
    }
  }, 120_000);

  /**
   * THE READERS OUTSIDE THIS LANE, as their files spell them today: the
   * board-budget line of scripts/verify-deploy.sh (the Jobs chunk named in
   * /jobs) and section 99zz's asset reader (script src and modulepreload
   * href on a posting page and an employer page). If either reader changes
   * to read the after-paint loader, an employer and a posting page may defer
   * their hints too, and this case changes with it.
   */
  const readerSource = (file: string, re: RegExp) => {
    const m = re.exec(readFileSync(resolve(ROOT, file), "utf8"));
    expect(m, `${file} still reads the chunks the way this case runs it`).not.toBeNull();
    return m![1];
  };

  it("verify-deploy.sh's board-budget line finds the Jobs chunk in the baked /jobs", () => {
    const src = readerSource("scripts/verify-deploy.sh", /const m=html\.match\(\/(assets\\\/Jobs-[^\n]*?)\/\);if\(!m\)return console\.log\("INFO {2}\/jobs served no Jobs/);
    const html = readFileSync(pageFile(bake(), "/jobs"), "utf8");
    expect(html.match(new RegExp(src))?.[0]).toBe("assets/Jobs-j1.js");
  }, 120_000);

  it("section 99zz's asset reader finds every chunk a posting and an employer page run, the employer-name chunk among them", () => {
    const src = readerSource("scripts/verify-deploy.d/99zz-trusted-pages.sh", /h\.matchAll\(\/(<\(\?:script[^\n]*?)\/g\)\)out\.add/);
    const dist = bake();
    const found = new Set<string>();
    for (const name of ["a posting", "an employer"]) for (const m of readFileSync(pageFile(dist, name), "utf8").matchAll(new RegExp(src, "g"))) found.add(m[1]);
    const want = [...new Set([...routeFiles("JobPosting-p1.js"), ...routeFiles("Jobs-j1.js")])].map((f) => `/assets/${f}`);
    expect([...found].sort()).toEqual(expect.arrayContaining(want));
    expect(found.has("/assets/company-display-c1.js")).toBe(true);
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
