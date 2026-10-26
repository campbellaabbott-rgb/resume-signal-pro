// @vitest-environment node
/**
 * THE CRAWLER'S "/" AND "/pricing" ARE THE NEW PAGES (homepage switch-over,
 * docs/homepage-pricing/README.md step 10).
 *
 * The real bake runs against a stubbed network: get_board_vendor_counts
 * answers a fixture, and every other request is refused, so nothing leaves
 * the machine. What it wrote for "/" and "/pricing" is read back:
 *   - "/" serves the owner's headline in React's own classes (the baked paint
 *     stays the Largest Contentful Paint), a GET /jobs form with q and
 *     location, and the one open-postings figure exactly as React prints it
 *     ("1,040,488 open postings · counted 17 Oct 2026, 22:45 UTC"), never a
 *     floored "950,000+"; field links only from the category list; the three
 *     /agents setups; the sources table from the same read; the plan strip
 *     with no offer while no seller is named; the FAQ in open <details>;
 *   - "/pricing" serves the page's own head for its gates, every paid card's
 *     closed reason, no buy control, the currency sentences, the territory
 *     line naming the currency and the time zone and nothing else, the
 *     comparison and the FAQ in open <details>;
 *   - the structured data of both is the pricing page's own pricingJsonLd:
 *     the free offer alone while no seller is named;
 *   - each page preloads its own route chunk (HomePage, PricingPage).
 * And a failed count read prints no figure at all (the offline bake).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crawlerText } from "../../scripts/prerender-retired.mjs";
import { routeChunkPrefix } from "../../scripts/prerender-preload.mjs";
import HOME from "@/i18n/shards/home/en.json";
import PRICING from "@/i18n/shards/pricing/en.json";
import EN from "@/i18n/locales/en.json";
import { HOME_H1_CLASS } from "@/lib/home/hero-classes";
import { HOME_FIELD_SLUGS } from "@/lib/home/fields";
import { pricingJsonLd } from "@/components/pricing/pricing-jsonld";
import { resolveSaleGates } from "@/components/pricing/sale-gates";
import { pricingMetaKeys } from "@/components/pricing/pricing-meta";
import { sellerIdentity, SELLER } from "@/config/seller";
import { parseVendorCounts } from "@/lib/home/vendor-counts";

vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const H = HOME.home;
const P = PRICING.pricingPlans;
/** The fixture row: three systems and USAJOBS, summing to openTotal. */
const ROW = {
  sourcesFacet: { workday: 640000, oracle: 220000, greenhouse: 90000, usajobs: 50000, smartrecruiters: 40000, lever: 488 },
  openTotal: 1040488,
  as_of: "2026-10-17T22:45:00.000Z",
};

let OUT = "";
let OFFLINE_OUT = "";
const page = (out: string, p: string) => readFileSync(join(out, "dist", ...(p === "/" ? ["index.html"] : [...p.split("/").filter(Boolean), "index.html"])), "utf8");
const ld = (html: string) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function bake(out: string, env: Record<string, string>) {
  mkdirSync(join(out, "dist", "assets"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(out, "dist", "index.html"));
  // Route chunks with the names Vite gives the two lazy pages, so the preload hints have something to name.
  writeFileSync(join(out, "dist", "assets", "HomePage-abc123.js"), 'import{a}from"./HomeSearchHero-d4.js";');
  writeFileSync(join(out, "dist", "assets", "HomeSearchHero-d4.js"), "");
  writeFileSync(join(out, "dist", "assets", "PricingPage-ef56.js"), "");
  return execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: out, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "hp-bake-"));
  const stub = join(OUT, "stub-fetch.cjs");
  writeFileSync(stub, `
const row = ${JSON.stringify(ROW)};
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/\\/rest\\/v1\\/rpc\\/get_board_vendor_counts$/.test(url)) return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  throw new Error("stubbed network: " + url);
};`);
  bake(OUT, { VITE_SUPABASE_URL: "https://stub.supabase.test", VITE_SUPABASE_PUBLISHABLE_KEY: "stub-key", NODE_OPTIONS: `--require ${stub}` });
  OFFLINE_OUT = mkdtempSync(join(tmpdir(), "hp-bake-offline-"));
  bake(OFFLINE_OUT, { PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" });
}, 400_000);
afterAll(() => {
  for (const d of [OUT, OFFLINE_OUT]) if (d && d.startsWith(tmpdir())) rmSync(d, { recursive: true, force: true });
});

describe('the crawler\'s "/" is the board-first homepage', () => {
  it("the owner's headline, in React's own classes, and the line under it", () => {
    const html = page(OUT, "/");
    const h1 = /<h1 id="home-h1" class="([^"]*)">([^<]*)<\/h1>/.exec(html);
    expect(h1, "the baked H1").not.toBeNull();
    expect(h1![1]).toBe(HOME_H1_CLASS);
    expect(unescape(h1![2])).toBe("Live jobs, straight from employers' own hiring systems.");
    expect(crawlerText(html)).toContain(H.hero.sub);
    const title = unescape((/<title>([^<]*)<\/title>/.exec(html) || [])[1] ?? "");
    expect(title).toBe(H.seo.title);
  });

  it("a real GET /jobs form with q and location", () => {
    const html = page(OUT, "/");
    const form = /<form action="\/jobs" method="get"[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
    expect(form).toMatch(/name="q"/);
    expect(form).toMatch(/name="location"/);
    expect(form).toMatch(/<button type="submit"[^>]*>Search jobs<\/button>/);
  });

  it("the one open-postings figure, exactly as React prints it, with its UTC moment; never a floor", () => {
    const html = page(OUT, "/");
    const line = /<p[^>]*data-home-count="">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(crawlerText(line).trim()).toBe("1,040,488 open postings · counted 17 Oct 2026, 22:45 UTC");
    expect(line).toContain('<time datetime="2026-10-17T22:45:00.000Z">');
    expect(crawlerText(html)).not.toMatch(/\d{1,3},000\+/);
  });

  it("no flow figure, no 'verified', no probability, no never-submit promise", () => {
    const t = crawlerText(page(OUT, "/"));
    expect(t).not.toMatch(/new · /);
    expect(t).not.toMatch(/verified/i);
    expect(t).not.toMatch(/never submit/i);
    expect(t).not.toMatch(/zero ghost/i);
  });

  it("field links only from the category list, never /jobs/field/retail or /hospitality", () => {
    const html = page(OUT, "/");
    const fields = [...html.matchAll(/href="\/jobs\/field\/([a-z_]+)"/g)].map((m) => m[1]);
    expect(fields).toEqual([...HOME_FIELD_SLUGS]);
    expect(html).not.toMatch(/\/jobs\/field\/(?:retail|hospitality)"/);
  });

  it("the three AI setups, and only Claude, ChatGPT and Claude Code", () => {
    const html = page(OUT, "/");
    for (const a of ["claude", "chatgpt", "claude-code"]) expect(html).toContain(`<a href="/agents#${a}"`);
    expect(crawlerText(html)).not.toMatch(/\b(?:Cursor|Windsurf|Gemini|Copilot|VS Code)\b/);
  });

  it("the sources table and the AI's reach come from the same read", () => {
    const t = crawlerText(page(OUT, "/"));
    expect(t).toContain("Open postings by source · counted 17 Oct 2026, 22:45 UTC · 1,040,488 in all, the same count as above");
    expect(t).toContain("Workday 640,000");
    expect(t).toMatch(/USAJOBS \(the federal government's listing site\) 50,000/);
    expect(t).toContain("Your AI searches 950,488 of the 1,040,488 open postings: USAJOBS and SmartRecruiters postings (90,000) stay on this website. Counted 17 Oct 2026, 22:45 UTC.");
  });

  it("the plan strip offers nothing while no seller is named, and says each product's currency", () => {
    expect(sellerIdentity(SELLER), "the premise: no seller in src/config/seller.ts").toBeNull();
    const t = crawlerText(page(OUT, "/"));
    expect(t).toContain(H.plans.ledeNone);
    expect(t).toContain(H.plans.faGatedSeller);
    expect(t).toContain(H.plans.termCurrencyFa);
    expect(t).not.toContain(H.plans.termCurrency.split(". ")[0]);
    expect(t).toContain(H.plans.termTerritory);
    expect(t).not.toMatch(/IP address|lookup|billing address/i);
  });

  it("the FAQ sits in open <details>", () => {
    const html = page(OUT, "/");
    const opened = [...html.matchAll(/<details open[^>]*><summary[^>]*>([^<]*)<\/summary>/g)].map((m) => unescape(m[1]));
    for (const q of [H.faq.sourcesQ, H.faq.applyQ, H.faq.currentQ, H.faq.fitQ, H.faq.resumeQ]) expect(opened).toContain(q);
  });

  it("its structured data is the pricing page's own offers: the free one alone while no seller is named", () => {
    const blocks = ld(page(OUT, "/"));
    const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
    expect(app).toBeTruthy();
    const offers = pricingJsonLd(resolveSaleGates()).offers as Array<{ name: string }>;
    expect(app.offers).toEqual(offers.filter((o) => o.name === "Free"));
    expect(app.offers.every((o: { price: string }) => o.price === "0")).toBe(true);
    expect(JSON.stringify(blocks)).not.toMatch(/verified/i);
  });

  it("the homepage's chunks are preloaded on \"/\" only, the scanner's never", () => {
    expect(routeChunkPrefix("/")).toBe("HomePage");
    const html = page(OUT, "/");
    expect(html).toMatch(/data-home-preload="1">if\(location\.pathname==="\/"\)\{\["HomePage-abc123\.js","HomeSearchHero-d4\.js"\]/);
    expect(html).not.toMatch(/Index-[\w-]+\.js/);
  });

  it("an unread count prints no figure at all (the offline bake)", () => {
    const html = page(OFFLINE_OUT, "/");
    expect(/<p[^>]*data-home-count="">([\s\S]*?)<\/p>/.exec(html)?.[1].trim()).toBe("");
    expect(crawlerText(html)).not.toMatch(/open postings ·/);
  });
});

describe('the crawler\'s "/pricing" is the new pricing page', () => {
  it("its head is the page's own for its gates", () => {
    const html = page(OUT, "/pricing");
    const g = resolveSaleGates();
    const meta = pricingMetaKeys(g);
    const fill = (s: string) => s.replace(/\{\{faPrice\}\}/g, "$5").replace(/\{\{proPrice\}\}/g, "$45");
    const pick = (k: string) => P.meta[k.replace("pricingPlans.meta.", "") as keyof typeof P.meta];
    expect(unescape((/<title>([^<]*)<\/title>/.exec(html) || [])[1] ?? "")).toBe(fill(pick(meta.title)));
    expect(unescape((/<meta name="description" content="([^"]*)"/.exec(html) || [])[1] ?? "")).toBe(fill(pick(meta.description)));
    expect(html).toMatch(/<h1 id="pricing-h1"/);
  });

  it("each paid card says why it is not on sale, and no buy control is baked", () => {
    const html = page(OUT, "/pricing");
    const t = crawlerText(html);
    expect((html.match(/data-gate="seller"/g) ?? []).length).toBe(2);
    expect(t).toContain(P.buy.gateSeller);
    expect(t).not.toContain("Buy the Full Analysis");
    expect(t).not.toMatch(/Go Pro, \$\d+/);
    expect(html).not.toMatch(/<button/);
  });

  it("the currency sentences and the territory line, naming only the currency and the time zone", () => {
    const t = crawlerText(page(OUT, "/pricing"));
    expect(t).toContain("Pro is billed in US dollars");
    expect(t).toContain("priced in US dollars and charged at about the same value in the currency of your device's time zone when we recognize the zone and support its currency, or in US dollars otherwise");
    expect(t).not.toMatch(/Prices (?:are )?in US dollars|your local currency/i);
    expect(t).toContain("All sales are final");
    expect(t).toMatch(/EU.*EEA.*UK.*India/);
    expect(t).toMatch(/the currency and the time zone your device reports/);
    expect(t).not.toMatch(/IP address|lookup|billing address/i);
  });

  it("Pro is the writing tools in packages, the comparison and the FAQ sit in open <details>", () => {
    const html = page(OUT, "/pricing");
    const t = crawlerText(html);
    expect(t).toContain(EN.proPlan.perks.writingToolsPackages);
    expect(t).not.toMatch(/\bun(?:limited)\b/i);
    expect(t).not.toMatch(/Freelance Boost|Transition Pro|Scan Pack/);
    const opened = [...html.matchAll(/<details open[^>]*><summary[^>]*>([^<]*)<\/summary>/g)].map((m) => unescape(m[1]));
    expect(opened).toContain(P.adds.summary);
    for (const id of ["refund", "region", "fit", "package", "cancel", "apply", "interviews"]) expect(opened).toContain(P.faq[`${id}Q` as keyof typeof P.faq]);
  });

  it("its structured data is pricingJsonLd of its gates, beside the breadcrumb, and preloads PricingPage", () => {
    const html = page(OUT, "/pricing");
    const blocks = ld(html);
    expect(blocks.find((b) => b["@type"] === "SoftwareApplication")).toEqual(pricingJsonLd(resolveSaleGates()));
    expect(blocks.some((b) => b["@type"] === "BreadcrumbList")).toBe(true);
    expect(routeChunkPrefix("/pricing")).toBe("PricingPage");
    expect(html).toContain('<link rel="modulepreload" href="/assets/PricingPage-ef56.js">');
  });

  it("the open-postings figure on the free card names its moment", () => {
    const t = crawlerText(page(OUT, "/pricing"));
    expect(t).toContain("Search 1,040,488 open postings counted 17 Oct 2026, 22:45 UTC");
  });
});

describe("one reading of get_board_vendor_counts, for the hook and the bake", () => {
  it("a measurement: positive counts, the total, the moment", () => {
    expect(parseVendorCounts(ROW)).toEqual({
      counts: ROW.sourcesFacet,
      openTotal: 1040488,
      asOf: "2026-10-17T22:45:00.000Z",
    });
  });
  it("absence is not zero: a cold row, an empty facet, a zero or a junk value is no reading or no count", () => {
    expect(parseVendorCounts(null)).toBeNull();
    expect(parseVendorCounts({ sourcesFacet: {}, openTotal: null })).toBeNull();
    expect(parseVendorCounts({ sourcesFacet: { workday: 0, oracle: "x" } })).toBeNull();
    expect(parseVendorCounts({ sourcesFacet: { workday: 5, oracle: 0 }, openTotal: 0, as_of: "nope" })).toEqual({ counts: { workday: 5 }, openTotal: null, asOf: null });
  });
  it("the hook and the bake both read it", () => {
    expect(readFileSync(join(ROOT, "src/hooks/useBoardVendorCounts.ts"), "utf8")).toMatch(/const reading = parseVendorCounts\(data\);/);
    expect(readFileSync(join(ROOT, "scripts/prerender-seo.mjs"), "utf8")).toMatch(/D\.parseVendorCounts\(await r\.json\(\)\)/);
  });
});
