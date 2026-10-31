/**
 * THE SALE SWITCHES SAY WHAT THE OWNER HAS WATCHED (homepage and pricing spec
 * of 2026-10-17, gates G2, G2b and G6; switch-over README, step 5).
 *
 * src/config/sales-gate.ts holds the three switches the switch-over's
 * SALE_SWITCHES reads, under the names step 5 imports. Their values are the
 * owner's: there is no sales pause (2026-10-27), so G2 and G2b are on and
 * the $5 Full Analysis and Pro are sold as they are on main and on live,
 * whatever src/config/seller.ts holds; G6 waits for the owner's or counsel's
 * ruling on the saved-search digest, so it is unruled. Changing one is the
 * owner's act: change the value and this file together, in a commit that
 * says why.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as gate from "@/config/sales-gate";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("the switches the switch-over imports", () => {
  it("exports FULL_ANALYSIS_ON_SALE, PRO_ON_SALE and DIGEST_MAIL_CLASS, and nothing else", () => {
    expect(Object.keys(gate).sort()).toEqual(["DIGEST_MAIL_CLASS", "FULL_ANALYSIS_ON_SALE", "PRO_ON_SALE"]);
    expect(typeof gate.FULL_ANALYSIS_ON_SALE).toBe("boolean");
    expect(typeof gate.PRO_ON_SALE).toBe("boolean");
    expect(["transactional", "marketing", "unruled"]).toContain(gate.DIGEST_MAIL_CLASS);
  });

  it("the README's step 5 imports exactly these names", () => {
    // The plan ships with hp/integration; on a tree without it there is no
    // step 5 to agree with yet.
    if (!existsSync(resolve(ROOT, "docs/homepage-pricing/README.md"))) return;
    const readme = read("docs/homepage-pricing/README.md");
    expect(readme).toContain('import { FULL_ANALYSIS_ON_SALE, PRO_ON_SALE, DIGEST_MAIL_CLASS } from "@/config/sales-gate";');
  });
});

describe("the order they open in", () => {
  it("Pro goes on sale only once the Full Analysis is: Stripe's description of Pro includes it", async () => {
    // Pro's Stripe description is built from every PRO_PERK_ITEMS line, the
    // included Full Analysis among them, and the checkout cannot read these
    // switches; the pages hide that line while G2 is closed.
    const { proStripeDescription } = await import("../../supabase/functions/_shared/pro-perks");
    expect(proStripeDescription()).toMatch(/Full Analysis included/);
    expect(!gate.PRO_ON_SALE || gate.FULL_ANALYSIS_ON_SALE, "PRO_ON_SALE is true while FULL_ANALYSIS_ON_SALE is false").toBe(true);
  });
});

describe("their values today", () => {
  it("G2 is on: the $5 Full Analysis is sold, as on main and on live (no sales pause, owner 2026-10-27)", () => {
    expect(gate.FULL_ANALYSIS_ON_SALE).toBe(true);
  });

  it("G2b is on: Pro is sold, as on main and on live (no sales pause, owner 2026-10-27)", () => {
    expect(gate.PRO_ON_SALE).toBe(true);
  });

  it("G6 is unruled: no ruling on the digest's mail class exists", () => {
    expect(gate.DIGEST_MAIL_CLASS).toBe("unruled");
  });

  it("a ruling, once made, must match what the digest sender does", () => {
    // The sender waits for the seller's name only if it reads the marketing
    // pause; a "marketing" ruling with a sender that does not wait (or a
    // "transactional" one with a sender that does) is a switch that lies.
    const sender = read("supabase/functions/send-search-digest/index.ts");
    const waits = /from "\.\.\/_shared\/marketing-pause\.ts"/.test(sender);
    if (gate.DIGEST_MAIL_CLASS === "marketing") expect(waits, "ruled marketing, but send-search-digest does not wait for the seller").toBe(true);
    if (gate.DIGEST_MAIL_CLASS === "transactional") expect(waits, "ruled transactional, but send-search-digest waits for the seller").toBe(false);
    // Unruled, the sender does not wait (as sales-gate.ts says), as on main,
    // so the pages name the alerts it sends.
    if (gate.DIGEST_MAIL_CLASS === "unruled") expect(waits).toBe(false);
  });
});
