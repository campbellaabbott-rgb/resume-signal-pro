/**
 * WHAT THE BAKE WRITES, READ AS A CRAWLER READS IT (SEO round, 2026-10-18).
 *
 * Runs the real bake (scripts/prerender-seo.mjs) offline into a scratch
 * directory, the way pd-bake-the-crawler-copy-sells-nothing-retired does, and
 * reads the pages it wrote. An offline bake writes no posting pages (no board
 * read), so the posting markup is held by seo-bake-posting-markup.test.ts and
 * by the bake's own job-markup check, whose clean line this file asserts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { crawlerText, jsonLdBlocks } from "../../scripts/prerender-retired.mjs";
import { OFF_PAGE_HOST_NAMES, bannedSourcePhrasesIn } from "../../scripts/prerender-copy.mjs";
import { AFFILIATE_COMMISSION_CENTS, formatUsd } from "@/config/affiliate-commission";
import { mcpServerUrl, publicApiBase } from "@/config/public-endpoints";

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
let OUT = "";
let DIST = "";
let LOG = "";

const filesUnder = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out;
};
const page = (path: string): string => readFileSync(path === "/" ? join(DIST, "index.html") : join(DIST, ...path.split("/").filter(Boolean), "index.html"), "utf8");
const meta = (html: string, re: RegExp) => (re.exec(html) || [])[1] ?? null;
const robotsOf = (h: string) => meta(h, /<meta name="robots" content="([^"]*)"/);
const canonOf = (h: string) => meta(h, /<link rel="canonical" href="([^"]*)"/);
const descOf = (h: string) => meta(h, /<meta name="description" content="([^"]*)"/);
const sitemapPaths = () => [...readFileSync(join(DIST, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, "").replace(/\/$/, "") || "/");

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "seo-bake-"));
  DIST = join(OUT, "dist");
  mkdirSync(DIST, { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(DIST, "index.html"));
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

describe("the bake ran and checked itself", () => {
  it("wrote its pages and logged its own checks clean", () => {
    expect(LOG).toMatch(/Wrote \d+ static HTML pages/);
    expect(LOG).toMatch(/source-sentence check: no written page or llms file says/);
    expect(LOG).not.toMatch(/BANNED SOURCE PHRASES/);
    expect(LOG).toMatch(/job-markup check: no TELECOMMUTE/);
    expect(LOG).not.toMatch(/JOB MARKUP the bake would not stand behind/);
    expect(LOG).toMatch(/\/terms and \/privacy: full text baked/);
  });
});

describe("SEO-011a: one Organization on every page, and everything that means us points at it", () => {
  it("every written page carries the #org node and the WebSite's @id and publisher", () => {
    let read = 0;
    for (const rel of filesUnder(DIST).filter((f) => f.endsWith("index.html")).slice(0, 400)) {
      const blocks = jsonLdBlocks(readFileSync(join(DIST, rel), "utf8")) as Array<Record<string, unknown>>;
      const org = blocks.find((b) => b["@type"] === "Organization" && b["@id"] === `${SITE}/#org`);
      expect(org, rel).toBeTruthy();
      for (const k of ["legalName", "address", "contactPoint", "sameAs"]) expect(org, `${rel} ${k}`).not.toHaveProperty(k);
      const site = blocks.find((b) => b["@type"] === "WebSite");
      expect(site?.["@id"], rel).toBe(`${SITE}/#website`);
      expect(site?.publisher, rel).toEqual({ "@id": `${SITE}/#org` });
      read++;
    }
    expect(read).toBeGreaterThan(300);
  });
  it("no inline publisher, creator or isPartOf names us without the @id", () => {
    for (const p of ["/guides/what-resume-score-means", "/research/ats-score-benchmarks", "/ghost-job-index", "/jobs", "/jobs/company/dominos", "/data-api", "/explore"]) {
      const json = JSON.stringify(jsonLdBlocks(page(p)));
      const inline = [...json.matchAll(/\{"@type":"(?:Organization|WebSite)","name":"Resume Booster"[^}]*\}/g)].map((m) => m[0]).filter((s) => !s.includes("@id"));
      expect(inline, p).toEqual([]);
    }
  });
  it("/agents carries the MCP server as SoftwareApplication with the software's own links", () => {
    const sw = (jsonLdBlocks(page("/agents")) as Array<Record<string, unknown>>).find((b) => b["@type"] === "SoftwareApplication");
    expect(sw).toBeTruthy();
    expect(sw!.sameAs).toEqual(expect.arrayContaining(["https://github.com/campbellaabbott-rgb/resumebooster-mcp"]));
    expect(sw!.publisher).toEqual({ "@id": `${SITE}/#org` });
  });
  it("/about is a page of its own, linked from the footer and listed in the sitemap and llms.txt", () => {
    const about = page("/about");
    expect(canonOf(about)).toBe(`${SITE}/about`);
    expect(robotsOf(about) ?? "index, follow").not.toMatch(/noindex/);
    expect(crawlerText(about)).toMatch(/what the board is/i);
    expect(page("/pricing")).toContain('href="/about"');
    expect(sitemapPaths()).toContain("/about");
    expect(readFileSync(join(DIST, "llms.txt"), "utf8")).toContain(`${SITE}/about`);
  });
});

describe("SEO-014 / SEO-015: the addresses a machine needs, the same everywhere", () => {
  it("/agents and both llms files carry one MCP server address", () => {
    const agents = page("/agents");
    const addr = (/<code>(https:\/\/[^<]*\/functions\/v1\/agent-mcp)<\/code>/.exec(agents) || [])[1];
    expect(addr).toBeTruthy();
    expect(addr).toMatch(/\/functions\/v1\/agent-mcp$/);
    for (const f of ["llms.txt", "llms-full.txt"]) {
      const t = readFileSync(join(DIST, f), "utf8");
      expect(t, f).toContain(`MCP server address (Streamable HTTP): ${addr}`);
      expect(t, f).toContain("work.resumebooster/jobs");
    }
    expect(mcpServerUrl(null)).toMatch(/\/functions\/v1\/agent-mcp$/);
  });
  it("/data-api and both llms files print the API's host; the /v1 paths are noindex pages pointing at it", () => {
    const api = (/<code>(https:\/\/[^<]*\/functions\/v1\/public-api)<\/code>/.exec(page("/data-api")) || [])[1];
    expect(api).toBeTruthy();
    expect(api).toMatch(/\/functions\/v1\/public-api$/);
    for (const f of ["llms.txt", "llms-full.txt"]) expect(readFileSync(join(DIST, f), "utf8"), f).toContain(`${api}/v1`);
    for (const p of ["/v1", "/v1/jobs", "/v1/changes", "/v1/companies", "/v1/stats", "/v1/usage"]) {
      const h = page(p);
      expect(robotsOf(h), p).toBe("noindex, follow");
      expect(h, p).toContain(api);
      expect(h, p).toContain('href="/data-api"');
      expect(sitemapPaths(), p).not.toContain(p);
    }
    expect(publicApiBase(null)).toMatch(/\/functions\/v1\/public-api$/);
  });
});

describe("SEO-005: no company page links /jobs?job=", () => {
  it("holds over every company file the bake wrote", () => {
    const offenders: string[] = [];
    let read = 0;
    for (const rel of filesUnder(join(DIST, "jobs", "company")).filter((f) => f.endsWith("index.html"))) {
      if (/href="\/jobs\?job=/.test(readFileSync(join(DIST, "jobs", "company", rel), "utf8"))) offenders.push(rel);
      read++;
    }
    expect(read).toBeGreaterThan(400);
    expect(offenders).toEqual([]);
  });
});

describe("R5a / R6a / R7a: the source sentence, the re-check's condition and the hosts a seeker page names", () => {
  it("no written page outside the employers' posting text, and neither llms file, carries a banned phrase", () => {
    const offenders: string[] = [];
    for (const rel of filesUnder(DIST).filter((f) => f.endsWith("index.html"))) {
      const path = `/${rel.replace(/\/?index\.html$/, "")}`;
      if (path.startsWith("/jobs/posting/") || path === "/changelog") continue;
      const html = readFileSync(join(DIST, rel), "utf8");
      for (const [claim, m] of bannedSourcePhrasesIn(`${crawlerText(html)} ${JSON.stringify(jsonLdBlocks(html))}`)) offenders.push(`${path}: ${claim} (${m})`);
    }
    for (const f of ["llms.txt", "llms-full.txt"]) for (const [claim, m] of bannedSourcePhrasesIn(readFileSync(join(DIST, f), "utf8"))) offenders.push(`${f}: ${claim} (${m})`);
    expect(offenders).toEqual([]);
  });
  it("/agents and both llms files name only Claude, ChatGPT and Claude Code", () => {
    for (const [what, text] of [["/agents", crawlerText(page("/agents")) + JSON.stringify(jsonLdBlocks(page("/agents")))], ["llms.txt", readFileSync(join(DIST, "llms.txt"), "utf8")], ["llms-full.txt", readFileSync(join(DIST, "llms-full.txt"), "utf8")]] as const) {
      expect(OFF_PAGE_HOST_NAMES.exec(text)?.[0] ?? null, what).toBeNull();
    }
    expect(crawlerText(page("/agents"))).toContain("Setup for other apps is in the install repository on GitHub");
  });
});

describe("SEO-027: llms.txt lists only indexable sitemap pages, its guides and comparisons generated", () => {
  it("every llms.txt URL is in the sitemap and indexable, /shortlist is gone and /vs/chatgpt is there", () => {
    const t = readFileSync(join(DIST, "llms.txt"), "utf8");
    const paths = [...t.matchAll(/https:\/\/resumebooster\.work(\/[^\s)#]*)?/g)].map((m) => (m[1] || "/").replace(/\/$/, "") || "/");
    const sm = new Set(sitemapPaths());
    const missing = paths.filter((p) => p !== "/llms-full.txt" && !sm.has(p));
    expect(missing).toEqual([]);
    expect(t).not.toContain("/shortlist");
    expect(t).toContain(`${SITE}/vs/chatgpt`);
  });
});

describe("SEO-029: /privacy and /terms carry their full text", () => {
  it("bakes every clause, the refund terms and the retention windows included", () => {
    const terms = crawlerText(page("/terms"));
    const privacy = crawlerText(page("/privacy"));
    expect(terms.length).toBeGreaterThan(8000);
    expect(privacy.length).toBeGreaterThan(8000);
    expect(terms).toMatch(/4\. Payment Terms and Refund Policy/);
    expect(privacy).toMatch(/Held in a private temporary store for 24 hours/);
    expect(terms).not.toMatch(/The full text renders at this address in your browser/);
  });
});

describe("S12-133: /affiliates says what the server pays", () => {
  it("prints the mirror's figures and no percentage", () => {
    const h = page("/affiliates");
    const text = `${meta(h, /<title>([^<]*)<\/title>/)} ${descOf(h)} ${crawlerText(h)}`;
    expect(text).not.toMatch(/\b20%/);
    expect(text).toContain(formatUsd(AFFILIATE_COMMISSION_CENTS.other));
    expect(text).toContain(formatUsd(AFFILIATE_COMMISSION_CENTS.smallTool));
  });
});

describe("SEO-034: a page in another language says so, and links its own scan page", () => {
  it("rewrites og:locale, adds content-language, fixes the country phrases and the Spanish CTA", () => {
    const fr = page("/fr/normes-cv/france");
    expect(meta(fr, /<meta property="og:locale" content="([^"]*)"/)).toBe("fr_FR");
    expect(meta(fr, /<meta http-equiv="content-language" content="([^"]*)"/)).toBe("fr");
    expect(meta(page("/pt/padroes-cv/brasil"), /<title>([^<]*)<\/title>/)).toBe("Currículo no Brasil: foto, extensão e formato");
    expect(meta(page("/cv-standards/united-states"), /<title>([^<]*)<\/title>/)).toBe("CV Rules in the United States: Photo, Length, Format");
    const es = page("/es/industrias/healthcare");
    expect(es).toContain('href="/es/revisar-curriculum" class="inline-flex');
    expect((jsonLdBlocks(es) as Array<Record<string, unknown>>).some((b) => b["@type"] === "BreadcrumbList")).toBe(true);
  });
});

describe("SEO-028: the Datasets and the research Article are citable", () => {
  it("brand-qualifies the Ghost Job Index, gives each Dataset an @id and a creator, and dates the research page", () => {
    const ds = (p: string) => (jsonLdBlocks(page(p)) as Array<Record<string, unknown>>).find((b) => b["@type"] === "Dataset")!;
    expect(ds("/ghost-job-index").name).toBe("Resume Booster Ghost Job Index");
    for (const p of ["/ghost-job-index", "/entry-level-index", "/hiring-trends", "/pay-transparency", "/research/ats-score-benchmarks"]) {
      expect(ds(p)["@id"], p).toBe(`${SITE}${p}#dataset`);
      expect(ds(p).creator, p).toEqual({ "@id": `${SITE}/#org` });
      expect(ds(p).variableMeasured, p).toBeTruthy();
      expect(JSON.stringify(ds(p)), p).not.toMatch(/\/v1\/stats/);
    }
    const art = (jsonLdBlocks(page("/research/ats-score-benchmarks")) as Array<Record<string, unknown>>).find((b) => b["@type"] === "Article")!;
    expect(art.datePublished).toBe("2026-07-06");
    expect(art.image).toBe(`${SITE}/og-image.png`);
    expect(crawlerText(page("/research/ats-score-benchmarks"))).toMatch(/How to cite:/);
  });
});

describe("S13-087: the research page says scans logged, not completed scans", () => {
  it("in its copy and its FAQ markup", () => {
    const h = page("/research/ats-score-benchmarks");
    expect(`${crawlerText(h)} ${JSON.stringify(jsonLdBlocks(h))}`).not.toMatch(/completed scans/i);
    expect(JSON.stringify(jsonLdBlocks(h))).toMatch(/scans logged/);
  });
});

describe("SEO-018: a field page links every other field and says its re-check honestly", () => {
  it("links all sixteen siblings and drops 'disappear on the next pass'", () => {
    const h = page("/jobs/field/engineering");
    const fields = new Set([...h.matchAll(/href="\/jobs\/field\/([a-z_]+)"/g)].map((m) => m[1]));
    expect(fields.size).toBe(17);
    expect(crawlerText(h)).not.toMatch(/disappear on the next pass/);
  });
});

describe("OBS-2: the families the report named fit the snippet at the source", () => {
  it("industry, role, Spanish industry, comparison, legal, explore and company descriptions are 160 or fewer", () => {
    const over: string[] = [];
    for (const rel of filesUnder(DIST).filter((f) => f.endsWith("index.html"))) {
      const path = `/${rel.replace(/\/?index\.html$/, "")}`;
      if (!/^\/(industries|roles|es\/industrias|vs|jobs\/company|cv-standards)\//.test(path) && !["/explore", "/privacy", "/terms", "/jobs", "/cv-standards"].includes(path)) continue;
      const d = (descOf(readFileSync(join(DIST, rel), "utf8")) ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (d.length > 160 || d.endsWith("…")) over.push(`${path} (${d.length})`);
    }
    expect(over).toEqual([]);
  });
});

describe("no page in the bake carries pay in its job markup", () => {
  it("baseSalary appears nowhere in dist", () => {
    const offenders = filesUnder(DIST).filter((f) => f.endsWith(".html") && readFileSync(join(DIST, f), "utf8").includes('"baseSalary"'));
    expect(offenders).toEqual([]);
    expect(existsSync(join(DIST, "llms.txt"))).toBe(true);
  });
});
