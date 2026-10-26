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
 *   - what is still sold still sells: the Full Analysis reaches the purchase
 *     path (the control). Since 2026-10-17 Freelance Boost and Transition Pro
 *     are cut too (owner decision), so create-product-checkout sells nothing.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { codeOf } from "./helpers/strip-comments";
import { CUT_PRODUCT_IDS, CUT_PRODUCTS, cutSentence, PAST_BUYER_DAYS } from "../../supabase/functions/_shared/product-cuts";
import { getAllProducts, HIDDEN_PRODUCT_IDS, oneTimePriceRangeUsd, PRODUCTS, type ProductId } from "@/config/products";

let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-product-checkout", "create-scan-pack-checkout", "create-test-checkout", "create-checkout"]);
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

  it("Freelance Boost and Transition Pro are cut too (2026-10-17): 410, in the buyer's language, nothing charged", async () => {
    for (const [id, type] of [["freelanceBoost", "freelance_boost"], ["freelanceTransitionPro", "freelance_transition_pro"]]) {
      const res = await post(h["create-product-checkout"], "create-product-checkout", { productId: id, language: "es" });
      expect(res.status, id).toBe(410);
      const body = await res.json();
      expect(body).toMatchObject({ retired: true, cut: true, product: type, language: "es" });
      expect(body.error).toBe(cutSentence(id, "es"));
      expect(body.error).toMatch(/ya no se vende/);
    }
    expect(world.stripe.created).toEqual([]);
  });

  it("control: the Full Analysis, still sold, reaches the purchase path and Stripe", async () => {
    const res = await post(h["create-checkout"], "create-checkout", { currency: "usd" });
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

describe("the catalogue hides exactly what the server refuses", () => {
  it("HIDDEN_PRODUCT_IDS is the cut list plus the retired Apply Assistant", () => {
    expect([...HIDDEN_PRODUCT_IDS].sort()).toEqual([...CUT_PRODUCT_IDS, "applyAssistant"].sort());
    for (const id of CUT_PRODUCT_IDS) expect(Object.keys(PRODUCTS), id).toContain(id);
  });

  it("what a buyer can reach is the Full Analysis alone, and the quoted range is its price", () => {
    const reachable = getAllProducts().map((p) => (Object.keys(PRODUCTS) as ProductId[]).find((k) => PRODUCTS[k] === p)).sort();
    expect(reachable).toEqual(["fullAnalysis"]);
    expect(oneTimePriceRangeUsd()).toEqual({ min: PRODUCTS.fullAnalysis.priceUsd, max: PRODUCTS.fullAnalysis.priceUsd });
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

/**
 * NO CRAWLER OR AI HOST IS OFFERED A CUT PRODUCT (the second recheck of the
 * descope). After the checkouts refused them, llms.txt still told AI hosts
 * "Paid tools are one-time purchases: resume rewrites, cover letters,
 * interview coaching, Freelance Boost", listed "Freelance Boost ... $29
 * one-time" and called /pricing "One-time tools and the all-access plan",
 * and the /freelance-boost bake still sold the product to crawlers ("in about
 * 15 seconds") from a sitemap entry at 0.8, while the page itself says "no
 * longer sold" and is noindex. Wave 4 makes those sentences false, so wave 4
 * carries them.
 */
describe("no crawler or AI host is offered a cut product", () => {
  const OFFER = /[$€£]\s?\d|\bone-time\b|\bpurchases?\b|\bbuy\b|\bprices?\b|\bpaid\b/i;
  const named = (line: string) => Object.values(CUT_PRODUCTS).filter((c) => new RegExp(`\\b${c.name.replace(/ /g, "\\s+")}(?:es|s|ing)?\\b`, "i").test(line)).map((c) => c.name);
  const llms = readFileSync(resolve(__dirname, "../../public/llms.txt"), "utf8");

  it("no line of llms.txt names a cut product beside a price or an offer", () => {
    const offered = llms.split("\n").filter((l) => named(l).length && OFFER.test(l) && !/no longer sold/i.test(l)).map((l) => `${named(l).join(", ")}: ${l.slice(0, 120)}`);
    expect(offered).toEqual([]);
  });

  it("llms.txt sells what is on sale: the Full Analysis and Pro, and calls nothing else a one-time tool", () => {
    expect(llms).not.toMatch(/one-time tools|Paid tools are one-time purchases/i);
    expect(llms).not.toMatch(/\]\(https:\/\/resumebooster\.work\/freelance-boost\)/);
    // The figure is the catalogue's, not a second copy that drifts.
    expect(llms).toContain(`One paid report (the $${PRODUCTS.fullAnalysis.priceUsd} Full Analysis)`);
    expect(llms).toContain(`: The free tools, the $${PRODUCTS.fullAnalysis.priceUsd} Full Analysis and Pro.`);
    expect(llms.match(/\$\d+ Full Analysis/g)?.every((m) => m === `$${PRODUCTS.fullAnalysis.priceUsd} Full Analysis`)).toBe(true);
    expect(llms).toMatch(/Pro \(the writing tools, the Full Analysis and no daily scan cap\)/);
  });

  it("the teeth: the lines as they stood are caught", () => {
    for (const before of [
      "Paid tools are one-time purchases: resume rewrites, cover letters, interview coaching, Freelance Boost (turns freelance/gig projects into recruiter-grade experience sections for career changers).",
      "- [Freelance Boost](https://resumebooster.work/freelance-boost): Guided flow converting freelance projects, gig work, and side hustles into recruiter-grade resume experience. $29 one-time.",
    ]) expect(named(before).length && OFFER.test(before), before).toBeTruthy();
  });

  const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
  const block = (path: string) => {
    const at = bake.indexOf(`path: "${path}",`);
    expect(at, `${path} has no write()`).toBeGreaterThan(-1);
    return bake.slice(at, bake.indexOf("write({", at));
  };

  it("the /freelance-boost bake is noindex and says the product is no longer sold, from the page's own strings", () => {
    const fb = block("/freelance-boost");
    expect(fb).toMatch(/robots: "noindex, follow"/);
    expect(fb).toMatch(/noLongerSoldTitle/);
    expect(fb).toMatch(/noLongerSoldBody/);
    expect(fb).not.toMatch(/translates the work you have already done|What it produces|in about 15 seconds/);
    // A price or a buy control; "the link in your purchase email" is the past buyer's sentence.
    expect(fb).not.toMatch(/[$€£]\s?\d|\bone-time\b|\bbuy\b/i);
  });

  it("the sitemap's static list names no /freelance-boost", () => {
    const routes = bake.slice(bake.indexOf("const STATIC_ROUTES = ["), bake.indexOf("];", bake.indexOf("const STATIC_ROUTES = [")));
    expect(routes.length).toBeGreaterThan(100);
    expect(routes).not.toMatch(/"\/freelance-boost"/);
  });
});

/**
 * THE FOOTER LINKS NO CUT PRODUCT (the recheck of the merge of main 899be058,
 * 2026-10-25). Every page's footer listed "Freelance Boost" under resources,
 * linking a product whose checkouts answer 410 and whose page says it is no
 * longer sold; the crawler's footer had already dropped it. The footer is the
 * design owners' file, and hp/honesty removes the same line: wave 4 carries
 * that exact hunk because wave 4 is what stops the sale.
 */
describe("the shared chrome links no cut product", () => {
  const footer = codeOf(readFileSync(resolve(__dirname, "../components/Footer.tsx"), "utf8"));
  const linksCut = (src: string) => Object.values(CUT_PRODUCTS).filter((c) => new RegExp(`fallback: "${c.name}"|to: "/${c.name.toLowerCase().replace(/\s+/g, "-")}"`).test(src)).map((c) => c.name);
  it("the footer's resources name and link none of them", () => {
    expect(linksCut(footer)).toEqual([]);
  });
  it("the teeth: the line as it stood is caught", () => {
    expect(linksCut('{ to: "/freelance-boost", key: "footer.links.freelanceBoost", fallback: "Freelance Boost" },')).toEqual(["Freelance Boost"]);
  });
});
