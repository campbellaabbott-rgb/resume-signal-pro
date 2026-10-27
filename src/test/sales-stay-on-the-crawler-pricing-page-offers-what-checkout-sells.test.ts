// @vitest-environment node
/**
 * THE CRAWLER'S /PRICING AND LLMS.TXT OFFER WHAT CHECKOUT SELLS (owner,
 * 2026-10-27: "there is no sales pause ... no one told you to do that").
 *
 * Wave 4 made the bake offer only a free Offer, put "Purchases open soon" in
 * the lead, beside each price and in the description, said the terms "when
 * purchases open", and tagged llms.txt the same way, all while
 * src/config/seller.ts was empty, which is how it ships. The checkouts sell
 * the $5 Full Analysis and Pro with that identity, so this runs the real bake
 * offline, as it ships, and reads what it wrote: the structured data offers
 * the paid range up to Pro, the terms are stated as a sale open now, and
 * neither the page nor llms.txt (committed or baked) says anything opens
 * soon.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crawlerText } from "../../scripts/prerender-retired.mjs";
import { offersAPrice, pricingJsonLd } from "@/lib/pricing-offer";
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";
import { SELLER } from "@/config/seller";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
let OUT = "";
let HTML = "";
let LLMS = "";

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "sales-stay-on-pricing-"));
  mkdirSync(join(OUT, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(OUT, "dist", "index.html"));
  execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  HTML = readFileSync(join(OUT, "dist", "pricing", "index.html"), "utf8");
  LLMS = readFileSync(join(OUT, "dist", "llms.txt"), "utf8");
}, 300_000);
afterAll(() => { if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true }); });

const ldBlocks = (h: string) => [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const descOf = (h: string) => ((/<meta name="description" content="([^"]*)"/.exec(h) || [])[1] ?? "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

describe("the premise", () => {
  it("the bake ran with the seller as it ships: empty", () => {
    expect({ ...SELLER }).toEqual({ legalName: "", postalAddress: "" });
  });
});

describe("the crawler's /pricing, with no seller named", () => {
  it("offers the paid range in its structured data, from free up to Pro", () => {
    const blocks = ldBlocks(HTML);
    expect(offersAPrice(blocks), JSON.stringify(blocks).slice(0, 400)).toBe(true);
    const offer = blocks.map((b) => b.offers).find(Boolean);
    expect(offer).toMatchObject({ "@type": "AggregateOffer", lowPrice: "0", highPrice: String(SUBSCRIPTIONS.pro.priceUsd) });
  });

  it("states the terms of a sale open now, with both prices", () => {
    const text = crawlerText(HTML);
    expect(text).toContain(`The ${PRODUCTS.fullAnalysis.name} is a one-time payment that never renews.`);
    expect(text).toMatch(/Pro renews every month until you cancel/);
    expect(text).toContain(`$${PRODUCTS.fullAnalysis.priceUsd}`);
    expect(text).toContain(`$${SUBSCRIPTIONS.pro.priceUsd}/month`);
  });

  it("says nothing opens soon, in the page or its description", () => {
    expect(crawlerText(HTML)).not.toMatch(/open soon|purchases open/i);
    expect(HTML).not.toMatch(/data-purchases-open-soon/);
    expect(descOf(HTML)).not.toMatch(/open soon/i);
  });
});

describe("the one structured-data shape React's /pricing and the bake share", () => {
  it("is the AggregateOffer of what is sold, from free up to Pro", () => {
    const ld = pricingJsonLd({ offerPrices: [PRODUCTS.fullAnalysis.priceUsd, SUBSCRIPTIONS.pro.priceUsd], url: "https://x.test/pricing" });
    expect(offersAPrice(ld)).toBe(true);
    expect(ld.offers).toEqual({ "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: "0", highPrice: String(SUBSCRIPTIONS.pro.priceUsd), offerCount: 3 });
  });
  it("positive control: offersAPrice finds a priced Offer nested anywhere, and passes a free one", () => {
    expect(offersAPrice([{ "@graph": [{ offers: { "@type": "Offer", price: "5" } }] }])).toBe(true);
    expect(offersAPrice({ offers: { "@type": "Offer", price: "0" } })).toBe(false);
  });
});

describe("llms.txt, committed and baked", () => {
  it("names the paid report and Pro with no closed-shop line, and its Pricing line is plain", () => {
    const committed = readFileSync(join(ROOT, "public/llms.txt"), "utf8");
    for (const f of [committed, LLMS]) {
      expect(f).not.toMatch(/open soon/i);
      expect(f).toContain("One paid report (the $5 Full Analysis) and one optional monthly plan, Pro");
      expect(f).toMatch(/^- \[Pricing\]\([^)]*\): The free tools, the \$5 Full Analysis and Pro\.$/m);
    }
  });
});
