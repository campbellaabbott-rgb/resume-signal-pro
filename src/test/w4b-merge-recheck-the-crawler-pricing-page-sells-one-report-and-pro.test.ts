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
 * product is named in React's own sentences, Pro is described by the line the
 * page and Stripe read, and the bake's own retired-claim check now fails a
 * bundle-discount line and a range that starts and ends at one price.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crawlerText, retiredClaimsIn } from "../../scripts/prerender-retired.mjs";
import { getAllProducts, PRODUCTS, SUBSCRIPTIONS } from "@/config/products";
import { PRO_SUMMARY } from "@/config/pro-perks";
import EN from "@/i18n/locales/en.json";
import { purchasesOpen } from "@/lib/purchases-open";

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
const PP = (EN as unknown as { pricingPage: Record<string, string> }).pricingPage;
/** A dollar range that opens and closes at the same price: "$5–$5". */
const ONE_PRICE_RANGE = /\$\s?(\d[\d,.]*)\s?[–—-]\s?\$\s?\1(?![\d,.]*\d)/;

describe("the catalogue the bake reads holds one one-time product", () => {
  it("what a buyer can reach once is the Full Analysis alone (the premise of this file)", () => {
    expect(getAllProducts()).toEqual([fa]);
  });
});

describe("the crawler's /pricing names the one report and Pro in React's own sentences", () => {
  it("the bake ran and its retired-claim check is clean", () => {
    expect(LOG).toMatch(/Wrote \d+ static HTML pages/);
    expect(LOG).toMatch(/retired-claim check: no written page/);
  });

  it("the title names the report and Pro's price, never 'One-Time Tools'", () => {
    const title = unescape(titleOf(HTML));
    expect(title).not.toMatch(/one-time tools/i);
    expect(title).toContain(`$${fa.priceUsd} ${fa.name}`);
    expect(title).toContain(`Pro $${pro.priceUsd}/month`);
    expect(title).not.toMatch(ONE_PRICE_RANGE);
  });

  it("the description is React's metaDescriptionFa with the catalogue's figures (and, while purchases are closed, React's 'Purchases open soon')", () => {
    // Recheck 3: while no seller is named, React's /pricing ends its description with checkoutGate.purchasesOpenSoonTitle, and so does the bake.
    const soon = purchasesOpen() ? "" : ` ${(EN as { checkoutGate: Record<string, string> }).checkoutGate.purchasesOpenSoonTitle}.`;
    const want = fill(PP.metaDescriptionFa, { lowPrice: fa.priceUsd, highPrice: fa.priceUsd, proPrice: pro.priceUsd }) + soon;
    expect(unescape(descOf(HTML))).toBe(want);
    expect(unescape(descOf(HTML))).not.toMatch(ONE_PRICE_RANGE);
  });

  it("the lead says React's oneTimeAndProLineFa, not 'Paid tools are one-time purchases'", () => {
    const text = crawlerText(HTML);
    expect(text).toContain(fill(PP.oneTimeAndProLineFa, { price: fa.priceUsd }));
    expect(text).not.toMatch(/Paid tools are one-time purchases/);
  });

  it("one report sits under a singular heading, and Pro is described by the line the page and Stripe read", () => {
    const text = crawlerText(HTML);
    expect(text).toMatch(/One paid report/);
    expect(text).not.toMatch(/One-time tools/);
    expect(text).toContain(PRO_SUMMARY.text);
    expect(text).not.toMatch(/every paid tool included/i);
    // Recheck 3: the terms are a sale open now only once purchases open.
    expect(text).toContain(purchasesOpen() ? `The ${fa.name} is a one-time payment that never renews.` : `When purchases open, the ${fa.name} will be a one-time payment that never renews`);
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
