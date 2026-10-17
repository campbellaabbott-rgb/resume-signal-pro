// @vitest-environment node
/**
 * THE CUT PRODUCTS ARE SOLD NOWHERE (owner decision 2026-10-12, the product
 * line; S12-070, S12-008).
 *
 * Stopping a sale means three things, each run here rather than read:
 *   - the checkout refuses it: create-product-checkout answers every cut
 *     product with 410, the reason a page keys on and a sentence in the
 *     buyer's language, BEFORE the limiter, a Pro grant or Stripe (nothing is
 *     counted, minted or charged); create-scan-pack-checkout does the same
 *     for the scan packs; the unauthenticated dev checkout is switched off;
 *   - the catalogue hides it: every cut id is in HIDDEN_PRODUCT_IDS (so every
 *     surface that reads the list drops it), the two lists are equal, and
 *     the price range the structured data quotes is what is still sold;
 *   - what is still sold still sells: Freelance Boost reaches the purchase
 *     path (the control).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { codeOf } from "./helpers/strip-comments";
import { CUT_PRODUCT_IDS, cutSentence, PAST_BUYER_DAYS } from "../../supabase/functions/_shared/product-cuts";
import { getAllProducts, HIDDEN_PRODUCT_IDS, oneTimePriceRangeUsd, PRODUCTS, type ProductId } from "@/config/products";

let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-product-checkout", "create-scan-pack-checkout", "create-test-checkout"]);
}, 240_000);
beforeEach(() => { world = freshWorld(); });

const ran = () => [...world.stripe.touched, ...world.db.writes.map((w) => `write:${w.table}`)];

describe("create-product-checkout refuses every cut product before anything is counted, minted or charged", () => {
  it.each(CUT_PRODUCT_IDS.filter((id) => id !== "scanPack"))("%s answers 410 with the sentence and touches nothing", async (productId) => {
    let limiterAsked = false;
    world.db.rpcs.check_rate_limit = () => { limiterAsked = true; return { data: true, error: null }; };
    const res = await post(h["create-product-checkout"], "create-product-checkout", { productId, email: "buyer@example.com" });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toMatchObject({ retired: true, cut: true, reason: "product_retired", language: "en" });
    expect(body.error).toBe(cutSentence(productId, "en"));
    expect(body.error).toContain(`${PAST_BUYER_DAYS} days`);
    expect(body.pricing).toBe("https://resumebooster.work/pricing");
    expect(body).not.toHaveProperty("url");
    expect(limiterAsked, "the refusal counted the caller").toBe(false);
    expect(ran()).toEqual([]);
  });

  it("the sentence follows the page's language, then the browser's", async () => {
    const de = await (await post(h["create-product-checkout"], "create-product-checkout", { productId: "coverLetter", language: "de" })).json();
    expect(de.language).toBe("de");
    expect(de.error).toBe(cutSentence("coverLetter", "de"));
    expect(de.error).toMatch(/nicht mehr verkauft/);
    const fr = await (await post(h["create-product-checkout"], "create-product-checkout", { productId: "premiumPackage" }, { headers: { "accept-language": "fr-FR,fr;q=0.9" } })).json();
    expect(fr.language).toBe("fr");
  });

  it("control: Freelance Boost, still sold, reaches the purchase path and Stripe", async () => {
    const res = await post(h["create-product-checkout"], "create-product-checkout", { productId: "freelanceBoost" });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(world.stripe.created).toHaveLength(1);
  });

  it("the preflight answers the round-2 build", async () => {
    const res = await h["create-product-checkout"](new Request("https://harness.supabase.co/functions/v1/create-product-checkout", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "create-product-checkout", "2026-10-11", 23)).toBe(true);
  });
});

describe("scan packs and the dev checkout are switched off", () => {
  it("create-scan-pack-checkout answers 410 for a pack, before the limiter or Stripe", async () => {
    let limiterAsked = false;
    world.db.rpcs.check_rate_limit = () => { limiterAsked = true; return { data: true, error: null }; };
    const res = await post(h["create-scan-pack-checkout"], "create-scan-pack-checkout", { email: "buyer@example.com", creditAmount: 10 });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toMatchObject({ retired: true, cut: true, product: "scan_pack" });
    expect(body.error).toBe(cutSentence("scanPack", "en"));
    expect(limiterAsked).toBe(false);
    expect(ran()).toEqual([]);
    const pre = await h["create-scan-pack-checkout"](new Request("https://harness.supabase.co/functions/v1/create-scan-pack-checkout", { method: "OPTIONS" }));
    expect(buildIsAtLeast(pre.headers.get("x-fn-build"), "create-scan-pack-checkout", "2026-10-11", 23)).toBe(true);
  });

  it("create-test-checkout answers 410 and mints no test session", async () => {
    const res = await post(h["create-test-checkout"], "create-test-checkout", { productId: "x", productName: "X", priceUsd: 5 });
    expect(res.status).toBe(410);
    expect(world.stripe.touched).toEqual([]);
    const pre = await h["create-test-checkout"](new Request("https://harness.supabase.co/functions/v1/create-test-checkout", { method: "OPTIONS" }));
    expect(buildIsAtLeast(pre.headers.get("x-fn-build"), "create-test-checkout", "2026-10-11", 23)).toBe(true);
  });
});

describe("the LinkedIn import behind a cut free-report extra is switched off", () => {
  // scrape-linkedin fed the LinkedIn insights card, one of the free report
  // extras the product line cut. It was unauthenticated and the only user
  // of the paid Firecrawl key. The stub below is loaded through the same
  // harness: a fetch would land in world.fetches, a limiter in the FakeDb.
  it("scrape-linkedin answers 410 before a limiter, a database client or Firecrawl, and carries the round-2 build", async () => {
    const sl = (await loadCheckouts(["scrape-linkedin"]))["scrape-linkedin"];
    let limiterAsked = false;
    world.db.rpcs.check_global_rate_limit = () => { limiterAsked = true; return { data: true, error: null }; };
    world.db.rpcs.check_rate_limit = () => { limiterAsked = true; return { data: true, error: null }; };
    const res = await post(sl, "scrape-linkedin", { url: "https://www.linkedin.com/in/example" });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, retired: true, reason: "linkedin_import_cut" });
    expect(body.error).toMatch(/no longer offered/);
    expect(body).not.toHaveProperty("text");
    expect(limiterAsked, "the refusal counted the caller").toBe(false);
    expect(world.fetches, "Firecrawl was called").toEqual([]);
    expect(ran()).toEqual([]);
    const pre = await sl(new Request("https://harness.supabase.co/functions/v1/scrape-linkedin", { method: "OPTIONS" }));
    expect(pre.status).toBe(200);
    expect(buildIsAtLeast(pre.headers.get("x-fn-build"), "scrape-linkedin", "2026-10-11", 23)).toBe(true);
  });

  it("no page, hook or component calls it any more (the insights card is unmounted)", () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "test") walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (readFileSync(p, "utf8").includes("scrape-linkedin")) callers.push(p);
      }
    };
    walk(resolve(__dirname, ".."));
    expect(callers).toEqual([]);
  });
});

describe("the catalogue hides exactly what the server refuses", () => {
  it("HIDDEN_PRODUCT_IDS is the cut list plus the retired Apply Assistant", () => {
    expect([...HIDDEN_PRODUCT_IDS].sort()).toEqual([...CUT_PRODUCT_IDS, "applyAssistant"].sort());
    for (const id of CUT_PRODUCT_IDS) expect(Object.keys(PRODUCTS), id).toContain(id);
  });

  it("what a buyer can reach is the Full Analysis and the two Freelance tiers, and the quoted range is theirs", () => {
    const reachable = getAllProducts().map((p) => (Object.keys(PRODUCTS) as ProductId[]).find((k) => PRODUCTS[k] === p)).sort();
    expect(reachable).toEqual(["freelanceBoost", "freelanceTransitionPro", "fullAnalysis"]);
    expect(oneTimePriceRangeUsd()).toEqual({ min: PRODUCTS.fullAnalysis.priceUsd, max: PRODUCTS.freelanceTransitionPro.priceUsd });
  });
});

describe("the post-publish smoke asks the cut checkout for its refusal, not for a session", () => {
  // scripts/post-publish-smoke.mjs runs against production after every
  // publish. It used to ask create-product-checkout for a Premium Package
  // session and pass on a Stripe url: with the cut, that pass would mean an
  // old bundle is still selling it. Read with comments stripped, so the
  // literals below are judged in code only.
  const smoke = codeOf(readFileSync(resolve(__dirname, "../../scripts/post-publish-smoke.mjs"), "utf8"));

  it("names no generator of a cut product in its preflight list", () => {
    expect(smoke).not.toMatch(/generate-premium-package-stream/);
  });

  it("passes on the 410 the server answers for the Premium Package, and on no Stripe url", async () => {
    const section = smoke.match(/post\("create-product-checkout", \{ productId: "premiumPackage"[^]*?record\([^]*?\);/)?.[0] ?? "";
    expect(section, "the smoke no longer asks the Premium checkout").not.toBe("");
    expect(section).toMatch(/r\.status === 410/);
    expect(section).toMatch(/!\("url" in j\)/);
    expect(section).not.toMatch(/checkout\.stripe\.com/);
    // The product name the smoke pins is the one the running server answers.
    const pinned = section.match(/j\.product === "([a-z_]+)"/)?.[1];
    const body = await (await post(h["create-product-checkout"], "create-product-checkout", { productId: "premiumPackage", language: "en" })).json();
    expect(body.product).toBe(pinned);
  });
});
