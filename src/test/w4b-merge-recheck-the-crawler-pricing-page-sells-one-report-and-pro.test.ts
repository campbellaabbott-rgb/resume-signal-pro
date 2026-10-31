// @vitest-environment node
/**
 * THE CRAWLER'S /PRICING SELLS WHAT WAVE 4 SELLS (the recheck of the merge
 * of main 899be058, 2026-10-25).
 *
 * Wave 4 keeps one one-time product, the $5 Full Analysis, and sells the
 * writing tools through Pro. The /pricing bake is main's template, written
 * for a list of one-time tools, and it went on rendering that template from a
 * one-item list: the title "One-Time Tools from $5", the description
 * "One-time tools $5–$5", the lead "Paid tools are one-time purchases, not
 * subscriptions", a plural "One-time tools" heading over one report, and a
 * closing line about bundle discounts that no tree has ever shown. React's
 * /pricing says "A $5 Full Analysis paid once, or Pro at $45 a month for the
 * writing tools". This runs the real bake offline and reads what it wrote: one
 * product is named in React's own sentences, Pro is described by the list the
 * page and Stripe read, and the bake's own retired-claim check now fails a
 * bundle-discount line and a range that starts and ends at one price. Since
 * the homepage switch-over the page it reads is the new pricing page.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crawlerText, retiredClaimsIn } from "../../scripts/prerender-retired.mjs";
import { getAllProducts, PRODUCTS, SUBSCRIPTIONS } from "@/config/products";
import { GATE_TEXT_KEY, resolveSaleGates } from "@/components/pricing/sale-gates";
import { pricingMetaKeys } from "@/components/pricing/pricing-meta";
import { visibleProPerks } from "@/components/pricing/pro-perks-mirror";
import PRICING_EN from "@/i18n/shards/pricing/en.json";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
let OUT = "";
let LOG = "";
let HTML = "";

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "w4b-mr-pricing-"));
  mkdirSync(join(OUT, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(OUT, "dist", "index.html"));
  LOG = execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  HTML = readFileSync(join(OUT, "dist", "pricing", "index.html"), "utf8");
}, 300_000);
afterAll(() => { if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true }); });

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
const titleOf = (h: string) => (/<title>([^<]*)<\/title>/.exec(h) || [])[1] ?? "";
const descOf = (h: string) => (/<meta name="description" content="([^"]*)"/.exec(h) || [])[1] ?? "";
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const fa = PRODUCTS.fullAnalysis;
const pro = SUBSCRIPTIONS.pro;
const PS = PRICING_EN.pricingPlans;
/** A dollar range that opens and closes at the same price: "$5–$5". */
const ONE_PRICE_RANGE = /\$\s?(\d[\d,.]*)\s?[–—-]\s?\$\s?\1(?![\d,.]*\d)/;

describe("the catalogue the bake reads holds one one-time product", () => {
  it("what a buyer can reach once is the Full Analysis alone (the premise of this file)", () => {
    expect(getAllProducts()).toEqual([fa]);
  });
});

describe("the crawler's /pricing names the one report and Pro in React's own sentences", () => {
  // Since the homepage switch-over the crawler /pricing is the new pricing
  // page (src/pages/pricing/PricingPage.tsx): its strings
  // (src/i18n/shards/pricing), its gates (resolveSaleGates) and its head
  // (pricingMetaKeys). What this file held stays held: one report and one
  // plan, each named with its price, never "One-Time Tools", never a range
  // whose ends are one price, never a bundle discount.
  const gates = resolveSaleGates();
  const meta = pricingMetaKeys(gates);
  const prices = { faPrice: `$${fa.priceUsd}`, proPrice: `$${pro.priceUsd}` };
  const key = (k: string) => PS.meta[k.replace(/^pricingPlans\.meta\./, "") as keyof typeof PS.meta];

  it("the bake ran and its retired-claim check is clean", () => {
    expect(LOG).toMatch(/Wrote \d+ static HTML pages/);
    expect(LOG).toMatch(/retired-claim check: no written page/);
  });

  it("the title is the page's own for its gates, never 'One-Time Tools'", () => {
    const title = unescape(titleOf(HTML));
    expect(title).toBe(fill(key(meta.title), prices));
    expect(title).not.toMatch(/one-time tools/i);
    expect(title).not.toMatch(ONE_PRICE_RANGE);
    // Pro's price is in the title only while Pro is on sale.
    expect(title.includes(`$${pro.priceUsd}`)).toBe(gates.pro.onSale);
  });

  it("the description is the page's own for its gates, both products priced, and nothing opens soon", () => {
    // Sales stay on (owner, 2026-10-27): both switches are on with no seller
    // named, so the description prices both and has no purchases-open-soon tail.
    const desc = unescape(descOf(HTML));
    expect(meta.description).toBe("pricingPlans.meta.description");
    expect(desc).toBe(fill(key(meta.description), prices));
    expect(desc).not.toMatch(ONE_PRICE_RANGE);
    expect(desc).not.toMatch(/open soon/i);
  });

  it("the one report and the one plan are each named with their price, and Pro by wave 4's list", () => {
    const text = crawlerText(HTML);
    expect(text).toContain(`${PS.fa.name}, $${fa.priceUsd} ${PS.fa.unit}`);
    expect(text).toContain(`${PS.pro.name}, $${pro.priceUsd} ${PS.pro.unit}`);
    expect(text).not.toMatch(/One-time tools|Paid tools are one-time purchases/);
    expect(text).not.toMatch(/every paid tool included/i);
    for (const perk of visibleProPerks({ fullAnalysisOnSale: gates.fullAnalysis.onSale })) expect(text).toContain(perk.text);
    // Sales stay on (owner, 2026-10-27): both cards are on sale, so neither
    // prints a gate sentence; one would, in the page's own words, if its
    // switch were off.
    expect(gates.fullAnalysis.onSale && gates.pro.onSale).toBe(true);
    if (!gates.fullAnalysis.onSale) expect(text).toContain(PS.buy[GATE_TEXT_KEY[gates.fullAnalysis.closedBy!].replace("pricingPlans.buy.", "") as keyof typeof PS.buy]);
    if (!gates.pro.onSale) expect(text).toContain(PS.buy[GATE_TEXT_KEY[gates.pro.closedBy!].replace("pricingPlans.buy.", "") as keyof typeof PS.buy]);
    expect(text).not.toMatch(/open soon/i);
    for (const gate of [PS.buy.gateFaDelivery, PS.buy.gateProWatched]) expect(text).not.toContain(gate);
  });

  it("no bundle discount and no one-price range anywhere on the page", () => {
    const text = `${crawlerText(HTML)} ${HTML}`;
    expect(text).not.toMatch(/bundle discount/i);
    expect(text).not.toMatch(ONE_PRICE_RANGE);
  });
});

describe("the bake's own check fails what this page used to say", () => {
  it("a bundle-discount line is a retired claim on any page", () => {
    expect(retiredClaimsIn("Current bundle discounts are shown live on this page in the app.").map(([c]) => c)).toContain("bundle discounts");
  });
  it("a one-price range is caught on a page that sells, and a real range is not", () => {
    expect(retiredClaimsIn("One-time tools $5–$5; Pro $45/month.", { sales: true }).map(([c]) => c)).toContain("a price range that starts and ends at one price");
    expect(retiredClaimsIn("Pricing — Free Resume Scan, One-Time Tools from $5 — One-time tools $5–$5.", { sales: true }).length).toBeGreaterThan(0);
    expect(retiredClaimsIn("One-time tools $2–$59; Pro $45/month.", { sales: true })).toEqual([]);
    expect(retiredClaimsIn("One-time tools $5–$50; Pro $45/month.", { sales: true })).toEqual([]);
  });
});
