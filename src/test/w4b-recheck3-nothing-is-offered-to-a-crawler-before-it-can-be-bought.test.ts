// @vitest-environment node
/**
 * NOTHING IS OFFERED TO A CRAWLER BEFORE IT CAN BE BOUGHT (recheck 3 of wave 4,
 * 2026-10-26).
 *
 * Until src/config/seller.ts names the seller (as shipped, it does not), the
 * Full Analysis and Pro checkouts answer 409 seller_identity_missing and
 * React's /pricing shows "Purchases open soon" where their buttons would be.
 * The crawler's /pricing still said "The Full Resume Analysis is a one-time
 * payment that never renews" and "Pro renews every month until you cancel",
 * and offered an AggregateOffer up to Pro's $45, to every crawler and AI host;
 * llms.txt said the same. This runs the real bake offline, as it ships, and
 * reads what it wrote; and the one structured-data shape both pages use is
 * proved in both states.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crawlerText } from "../../scripts/prerender-retired.mjs";
import { LLMS_PRICING_TAG, llmsPurchaseLines, offersAPrice, pricingJsonLd } from "@/lib/pricing-offer";
import { purchasesOpen } from "@/lib/purchases-open";
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";
import EN from "@/i18n/locales/en.json";
import PRICING_EN from "@/i18n/shards/pricing/en.json";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const GATE = (EN as { checkoutGate: Record<string, string> }).checkoutGate;
const PRICING = PRICING_EN.pricingPlans;
let OUT = "";
let HTML = "";
let LLMS = "";

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "w4b-r3-pricing-"));
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

describe("as shipped, no seller is named, so purchases are closed (the premise)", () => {
  it("purchasesOpen() is false", () => {
    expect(purchasesOpen()).toBe(false);
  });
});

describe("the crawler's /pricing while purchases are closed", () => {
  it("offers nothing at a price in its structured data, only the free scan", () => {
    const blocks = ldBlocks(HTML);
    expect(blocks.length).toBeGreaterThan(0);
    expect(offersAPrice(blocks), JSON.stringify(blocks).slice(0, 400)).toBe(false);
    expect(HTML).not.toMatch(/AggregateOffer/);
  });

  // Since the homepage switch-over the crawler /pricing is the new pricing
  // page: each paid card says why it is not on sale in the page's own
  // sentence (pricingPlans.buy.gateSeller while no seller is named), and its
  // head is the page's closed description.
  it("says purchases open soon on each paid card and in the description, in the page's own words", () => {
    const text = crawlerText(HTML);
    const soon = PRICING.buy.gateSeller;
    expect(soon).toMatch(/Purchases open soon/);
    expect(text).toContain(soon);
    expect((HTML.match(/data-gate="seller"/g) ?? []).length).toBe(2);
    expect(descOf(HTML)).toBe(PRICING.meta.descriptionClosed);
    expect(descOf(HTML)).toMatch(/purchases open soon\.$/);
  });

  it("never states the payment terms as a sale open now, and offers no way to buy", () => {
    const text = crawlerText(HTML);
    expect(text).not.toContain(`The ${PRODUCTS.fullAnalysis.name} is a one-time payment that never renews.`);
    expect(text).not.toMatch(/Pro renews every month until you cancel/);
    // No call to buy while closed: neither card's button text is baked.
    expect(text).not.toContain(PRICING.fa.cta.replace("{{price}}", `$${PRODUCTS.fullAnalysis.priceUsd}`));
    expect(text).not.toContain(PRICING.pro.cta.replace("{{price}}", `$${SUBSCRIPTIONS.pro.priceUsd}`));
    // The prices themselves are still stated: they are what purchases will open at.
    expect(text).toContain(`$${PRODUCTS.fullAnalysis.priceUsd} once`);
    expect(text).toContain(`$${SUBSCRIPTIONS.pro.priceUsd} a month`);
  });

  it("llms.txt says purchases open soon on its paid line and its Pricing line, committed and baked", () => {
    const committed = readFileSync(join(ROOT, "public/llms.txt"), "utf8");
    for (const f of [committed, LLMS]) {
      expect(f).toContain(`no daily scan cap). ${GATE.purchasesOpenSoon} Current prices are on [/pricing]`);
      expect(f).toMatch(/^- \[Pricing\]\([^)]*\): The free tools, the \$5 Full Analysis and Pro \(purchases open soon\)\.$/m);
    }
  });
});

describe("the one structured-data shape, closed and open", () => {
  const prices = [PRODUCTS.fullAnalysis.priceUsd, SUBSCRIPTIONS.pro.priceUsd];
  it("closed: a free Offer and a description that says the paid ones open soon", () => {
    const ld = pricingJsonLd({ open: false, offerPrices: prices, url: "https://x.test/pricing" });
    expect(offersAPrice(ld)).toBe(false);
    expect(ld.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(String(ld.description)).toMatch(/open for purchase soon/);
  });
  it("open: the AggregateOffer of what is sold, up to Pro", () => {
    const ld = pricingJsonLd({ open: true, offerPrices: prices, url: "https://x.test/pricing" });
    expect(offersAPrice(ld)).toBe(true);
    expect(ld.offers).toEqual({ "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: "0", highPrice: String(SUBSCRIPTIONS.pro.priceUsd), offerCount: 3 });
  });
  it("positive control: offersAPrice finds a priced Offer nested anywhere, and passes a free one", () => {
    expect(offersAPrice([{ "@graph": [{ offers: { "@type": "Offer", price: "5" } }] }])).toBe(true);
    expect(offersAPrice({ offers: { "@type": "Offer", price: "0" } })).toBe(false);
  });
  it("llms.txt loses both purchase lines once open, and gets them back when closed again", () => {
    const committed = readFileSync(join(ROOT, "public/llms.txt"), "utf8");
    const opened = llmsPurchaseLines(committed, true, GATE.purchasesOpenSoon);
    expect(opened).not.toContain(GATE.purchasesOpenSoon);
    expect(opened).not.toContain(LLMS_PRICING_TAG);
    expect(opened).toMatch(/^- \[Pricing\]\([^)]*\): The free tools, the \$5 Full Analysis and Pro\.$/m);
    expect(llmsPurchaseLines(opened, false, GATE.purchasesOpenSoon)).toBe(committed);
    expect(llmsPurchaseLines(committed, false, GATE.purchasesOpenSoon)).toBe(committed);
  });
});
