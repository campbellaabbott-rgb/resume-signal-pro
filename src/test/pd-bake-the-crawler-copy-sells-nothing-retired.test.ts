/**
 * THE CRAWLER COPY SELLS NOTHING RETIRED, PROVEN ON WHAT THE BAKE WRITES.
 *
 * The apply pivot (owner, 2026-10-11) retired the server-side Apply Agent,
 * its monthly plan, the pass and the Apply Assistant, and the product line of
 * 2026-10-12 retires the Premium package with them. React reads the products
 * mirror and stopped selling them page by page; the bake read the same mirror
 * and went on selling every one of them to every crawler and answer engine
 * (an Offer per product on the homepage, a priced title on /agent, the plan and
 * the pass on /agents, /pricing and in llms-full). A guard over the bake's
 * SOURCE cannot see that: the price came from a mirror, the sentence from a
 * locale key. So this file runs the real bake (scripts/prerender-seo.mjs) into
 * a scratch directory, offline, and reads the pages it wrote: every page other
 * than the employers' own posting text, every JSON-LD block, llms.txt and
 * llms-full.txt. PRERENDER_OUT keeps every write out of the checkout and
 * PRERENDER_OFFLINE makes no network read, so the run is the same on CI.
 *
 * The phrases are scripts/prerender-retired.mjs's, the list the bake checks
 * its own output against and the verifier (section 83) reads live pages for.
 * They match SELLING and SUBMITTING, not a bare name, because the retirement
 * notice must be able to say what it retires.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  APPLY_YOURSELF_LINE, RETIRED_CLAIMS, crawlerText, jsonLdBlocks, offersIn, retiredClaimsIn,
} from "../../scripts/prerender-retired.mjs";

const ROOT = resolve(__dirname, "../..");
let OUT = "";
let DIST = "";
let LOG = "";

/** Every file under a directory, as paths relative to it. */
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
const page = (path: string): string => {
  const nested = join(DIST, ...path.split("/").filter(Boolean), "index.html");
  return readFileSync(path === "/" ? join(DIST, "index.html") : nested, "utf8");
};

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "pd-bake-"));
  DIST = join(OUT, "dist");
  mkdirSync(DIST, { recursive: true });
  // The template the bake reads: the app's own index.html (vite's build adds
  // script tags, which the bake carries untouched; the head tags it rewrites
  // are already here).
  copyFileSync(join(ROOT, "index.html"), join(DIST, "index.html"));
  LOG = execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}, 240_000);

afterAll(() => {
  if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true });
});

describe("the bake ran, offline, and wrote into the scratch directory only", () => {
  it("wrote the pages this file reads", () => {
    expect(LOG).toMatch(/Wrote \d+ static HTML pages/);
    for (const p of ["/", "/pricing", "/agent", "/agents", "/data-api", "/guides", "/guides/how-the-apply-agent-works", "/companies", "/jobs"]) {
      expect(page(p).length, `${p} was written`).toBeGreaterThan(2000);
    }
    expect(existsSync(join(DIST, "llms-full.txt"))).toBe(true);
    expect(existsSync(join(DIST, "llms.txt"))).toBe(true);
  });

  it("left the checkout's own files alone", () => {
    expect(existsSync(join(OUT, ".prerender-data.mjs")), "the data bundle went to the scratch directory").toBe(true);
    expect(existsSync(join(OUT, "public", "sitemap.xml")), "the public/ copies went to the scratch directory").toBe(true);
  });
});

describe("no page, block or llms file sells or describes a retired product", () => {
  it("the bake's own check found nothing", () => {
    expect(LOG).toMatch(/retired-claim check: no written page/);
    expect(LOG).not.toMatch(/RETIRED CLAIMS in/);
  });

  it("every written page outside the employers' posting text is clean, its JSON-LD included", () => {
    const offenders: string[] = [];
    let read = 0;
    for (const rel of filesUnder(DIST).filter((f) => f.endsWith("index.html"))) {
      const path = `/${rel.replace(/\/?index\.html$/, "")}`;
      if (path.startsWith("/jobs/posting/") || path === "/changelog") continue;
      const html = readFileSync(join(DIST, rel), "utf8");
      const text = `${crawlerText(html)} ${JSON.stringify(jsonLdBlocks(html))}`;
      for (const [claim, m] of retiredClaimsIn(text, { sales: path === "/" || path === "/pricing" })) offenders.push(`${path}: ${claim} (${m})`);
      read++;
    }
    expect(read, "read the written pages, not an empty directory").toBeGreaterThan(500);
    expect(offenders).toEqual([]);
  });

  it("llms.txt and llms-full.txt are clean", () => {
    for (const f of ["llms.txt", "llms-full.txt"]) {
      const text = readFileSync(join(DIST, f), "utf8");
      expect(text.length).toBeGreaterThan(5000);
      expect(retiredClaimsIn(text), f).toEqual([]);
    }
  });

  it("names every retired product and price this round removed, by the list the verifier reads", () => {
    // The list covers the four claims the task names, each one.
    const claims = RETIRED_CLAIMS.map(([c]) => c).join(" | ");
    for (const want of [/\$99/, /\$29/, /\$7/, /Premium/, /verified openings/, /zero ghost/, /applies for you/]) expect(claims).toMatch(want);
  });

  it("no Offer anywhere carries a retired price or names a retired product, and the homepage has no Service block", () => {
    const offers: Array<{ path: string; o: Record<string, unknown> }> = [];
    for (const rel of filesUnder(DIST).filter((f) => f.endsWith("index.html") && !f.startsWith("jobs/posting/"))) {
      const blocks = jsonLdBlocks(readFileSync(join(DIST, rel), "utf8"));
      for (const o of offersIn(blocks)) offers.push({ path: rel, o });
    }
    expect(offers.length, "the free scan's own Offer is still there").toBeGreaterThan(0);
    for (const { path, o } of offers) {
      for (const k of ["price", "highPrice"]) if (k in o) expect(["99", "29", "7"], `${path} ${k}`).not.toContain(String(o[k]));
      expect(JSON.stringify(o), path).not.toMatch(/Agent|Pass|Premium|Assistant|\/agents\/pass/);
    }
    const home = jsonLdBlocks(page("/"));
    expect(home.map((b) => (b as { "@type"?: string })["@type"])).not.toContain("Service");
    const pricing = jsonLdBlocks(page("/pricing"));
    const agg = offersIn(pricing).find((o) => o["@type"] === "AggregateOffer") as { highPrice: string } | undefined;
    expect(agg, "the pricing range is still published").toBeTruthy();
    expect(Number(agg!.highPrice)).toBeLessThan(99);
  });

  it("/pricing lists no retired one-time product and no plan but Pro", () => {
    const t = crawlerText(page("/pricing"));
    expect(t).not.toMatch(/Premium Resume Package|Apply Assistant|Morning Queue|Agent plan|Agent Pass/);
    expect(t).toMatch(/One monthly plan/);
    expect(t).toMatch(/Pro .*\$45\/month/);
  });

  it("teeth: a page carrying a retired claim, planted in a copy of the real output, is caught", () => {
    const home = crawlerText(page("/"));
    expect(retiredClaimsIn(home, { sales: true })).toEqual([]);
    expect(retiredClaimsIn(`${home} Apply Agent $99/month.`, { sales: true }).map(([c]) => c)).toContain("the Apply Agent's $99 a month");
    expect(retiredClaimsIn(`${home} A $29 pass for your own agent.`).map(([c]) => c)).toContain("the $29 Agent Pass");
    expect(retiredClaimsIn(`${home} Apply Assistant, $7.`).map(([c]) => c)).toContain("the $7 Apply Assistant");
    expect(retiredClaimsIn(`${home} Premium Resume Package`).map(([c]) => c)).toContain("the Premium Resume Package");
    expect(retiredClaimsIn(`${home} 900,000+ verified openings`).map(([c]) => c)).toContain("'verified openings'");
    expect(retiredClaimsIn(`${home} Zero ghost jobs.`).map(([c]) => c)).toContain("'zero ghost'");
    expect(retiredClaimsIn(`${home} The agent applies for you.`).map(([c]) => c)).toContain("an agent that applies for you");
    // And an employer's pay figure, or a job title's own rate, is not the plan's price.
    expect(retiredClaimsIn("Pay: $99,000 to $120,000 a year.")).toEqual([]);
    expect(retiredClaimsIn("Ariat Merchandiser - $99 per visit, one-time project")).toEqual([]);
    expect(retiredClaimsIn("the Morning Queue at $99 a month").map(([c]) => c)).toContain("the Apply Agent's $99 a month");
  });
});

describe("what the crawler reads instead: search and apply through your own AI", () => {
  it("the homepage, /agents, /agent and /pricing carry the one true line, naming only Claude, ChatGPT and Claude Code", () => {
    for (const p of ["/", "/agents", "/agent", "/pricing"]) {
      expect(crawlerText(page(p)), p).toContain(APPLY_YOURSELF_LINE);
    }
    expect(APPLY_YOURSELF_LINE).toMatch(/Claude, ChatGPT or Claude Code/);
    expect(APPLY_YOURSELF_LINE).toMatch(/you press submit/);
  });

  it("the homepage H1 is the headline, and keeps the host-allowance sentence section 73 reads", () => {
    const html = page("/");
    expect(/<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1]).toBe("Live jobs, straight from employers' own hiring systems.");
    expect(crawlerText(html)).toMatch(/from ChatGPT each person has their own|within a free daily allowance/);
  });

  it("/agent is the retirement page: no price in its title, indexable, linking /agents", () => {
    const html = page("/agent");
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe("The Apply Agent is retired: apply with your own AI");
    expect(html).not.toMatch(/<meta name="robots" content="noindex/);
    expect(html).toMatch(/<a href="\/agents"/);
  });

  it("the footer of every baked page links /agents, never the retired /agent", () => {
    const html = page("/industries");
    const footer = html.slice(html.lastIndexOf("<footer"));
    expect(footer).toMatch(/<a href="\/agents"/);
    expect(footer).not.toMatch(/<a href="\/agent"/);
  });

  it("the /agents tool list leaves out the retired agent's tools and the prompt that requested applications", () => {
    const t = crawlerText(page("/agents"));
    expect(t).not.toMatch(/request_application|application_status|apply_to_my_shortlist/);
    // A host's own setup steps may list a read tool's name; no line describes
    // what the retired agent could submit.
    expect(t).not.toMatch(/apply agent can submit|on your behalf/i);
    expect(t).toMatch(/search_jobs/);
  });
});

describe("company pages name their counts honestly, and never 'verified'", () => {
  it("a company page's title is 'X jobs: N open roles from their own hiring system', and its body dates the count", () => {
    const html = page("/jobs/company/dominos");
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    expect(title).toMatch(/^Domino's jobs: [\d,]+ open roles from their own hiring system$/);
    expect(crawlerText(html)).toMatch(/open Domino's roles, counted \d{4}-\d{2}-\d{2}/);
    expect(html).not.toMatch(/verified/i);
  });

  it("/companies drops 'Verified Job Boards' and dates its counts", () => {
    const html = page("/companies");
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toMatch(/Companies Hiring Now, From Their Own Hiring Systems$/);
    expect(crawlerText(html)).toMatch(/measured when this index was last built, \d{4}-\d{2}-\d{2}/);
  });
});

describe("the homepage's own structured data never rides on another address (SEO-033)", () => {
  it("each homepage block is tagged home-only, and the fallback script removes them off /", () => {
    const html = page("/");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"([^>]*)>/g)].map((m) => m[1]);
    // The template's WebSite block is the site's, not the homepage's own.
    expect(blocks.filter((a) => a.includes('data-home-only="1"')).length).toBeGreaterThan(0);
    expect(html).toMatch(/document\.querySelectorAll\('script\[data-home-only\]'\)\.forEach\(function\(s\)\{s\.remove\(\);\}\)/);
    // Another page's blocks are its own and carry no tag.
    expect(page("/pricing")).not.toMatch(/data-home-only/);
  });
});

describe("a once-published URL outside this bake's set keeps a noindex page of its own (SEO-002)", () => {
  const ledger = () => JSON.parse(readFileSync(join(DIST, "prerender-ledger.json"), "utf8")) as {
    companies: Record<string, { state: string; seed?: boolean; token: string }>;
    postings: Record<string, { state: string; seed?: boolean }>;
  };

  it("a seeded company path the bake did not choose is a noindex stub, out of the sitemap, never the homepage copy", () => {
    const stubs = Object.entries(ledger().companies).filter(([, e]) => e.state === "stub" && e.seed);
    expect(stubs.length, "the seed reached the company carry").toBeGreaterThan(100);
    const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
    for (const [path, e] of stubs.slice(0, 25)) {
      const html = page(path);
      expect(html, path).toMatch(/<meta name="robots" content="noindex, follow"/);
      expect(crawlerText(html), path).toMatch(/no longer has a page of its own here/);
      expect(html, path).toContain(`href="/jobs?company=${encodeURIComponent(e.token)}"`);
      expect(html, path).not.toMatch(/<h1[^>]*>Live jobs, straight from employers/);
      expect(sitemap, path).not.toContain(`${path}<`);
    }
  });

  it("a seeded posting path is the honest 'retired' page that says nothing was checked, never 'gone'", () => {
    const seeded = Object.entries(ledger().postings).filter(([, e]) => e.state === "seeded" && e.seed);
    expect(seeded.length, "the seed reached the posting carry").toBeGreaterThan(100);
    for (const [path] of seeded.slice(0, 10)) {
      const html = page(path);
      expect(html, path).toMatch(/<meta name="robots" content="noindex, follow"/);
      expect(crawlerText(html), path).toMatch(/whether it is still open was not checked/);
      expect(crawlerText(html), path).not.toMatch(/is no longer listed/);
    }
  });

  it("the ledger the bake serves names the companies map, and every carried company is noindex or a stub", () => {
    const ledger = JSON.parse(readFileSync(join(DIST, "prerender-ledger.json"), "utf8"));
    const companies = Object.values(ledger.companies ?? {}) as Array<{ state: string }>;
    expect(companies.length).toBeGreaterThan(500);
    const states = new Set(companies.map((c) => c.state));
    for (const s of states) expect(["live", "canonical", "noindex", "stub", "tombstone"]).toContain(s);
    expect(LOG).toMatch(/company pages: carried \d+ once-published paths this bake did not choose \/ noindex \d+ \/ stubbed \d+ \/ tombstoned \d+/);
  });
});
