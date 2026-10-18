/**
 * EVERY NUMBER ON THE PRICING PAGE IS THE NUMBER THAT DECIDES IT.
 *
 * src/components/pricing/plan-facts.ts mirrors each constant the page prints.
 * Where the deciding constant is on this base, it is read here and the mirror
 * must equal it. Where it lives on a branch that has not merged (wave 4:
 * writing-allowance.ts, builder-plan.ts, MCP_FIT_FREE_PER_DAY, the API's
 * BUILDER_PROPOSED, PRO_PERK_ITEMS, and hp/honesty's sales-gate.ts), the pin
 * switches on by itself the day that file or export appears, and until then
 * the mirror is held to the owner's decision as written.
 *
 * The Pro pin is deliberately strict: once wave 4's PRO_PERK_ITEMS exists, the
 * card's list (pro-perks-mirror.ts) must say exactly what it says, so the
 * page and the server can never disagree. Switch-over replaces the mirror
 * with a re-export of wave 4's list (docs/homepage-pricing/README.md).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";
import { MCP_FREE_KEY_DAILY_QUOTA, MCP_WITHHELD_SOURCES } from "@/config/mcp-tools";
import * as mcpTools from "@/config/mcp-tools";
import * as proPerks from "@/config/pro-perks";
import { REPORT_CACHE_DAYS, SHARED_ANALYSIS_DAYS } from "@/lib/resume-retention";
import { codeOf } from "./helpers/strip-comments";
import { LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";
import * as F from "@/components/pricing/plan-facts";
import { PRO_PERK_ITEMS } from "@/components/pricing/pro-perks-mirror";
import { FULL_ANALYSIS_DELIVERY_WATCHED, PRO_SUBSCRIPTION_WATCHED } from "@/components/pricing/sale-gates";
import "@/components/pricing/use-pricing-strings";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => codeOf(readFileSync(resolve(ROOT, p), "utf8"));
const num = (code: string, re: RegExp, where: string) => {
  const m = code.match(re);
  if (!m) throw new Error(`${re} not found in ${where}`);
  return Number(m[1]);
};

const writingModules = import.meta.glob<{ WRITING_ALLOWANCE: Record<string, number> }>("../config/writing-allowance.ts", { eager: true });
const builderModules = import.meta.glob<{ BUILDER_PLAN_PRICE_USD: number }>("../config/builder-plan.ts", { eager: true });
const salesGateModules = import.meta.glob<{ FULL_ANALYSIS_ON_SALE?: boolean; PRO_ON_SALE?: boolean }>("../config/sales-gate.ts", { eager: true });

describe("mirrors of constants on this base", () => {
  it("the Full Analysis price is the catalogue's", () => {
    expect(F.FULL_ANALYSIS_PRICE_USD).toBe(PRODUCTS.fullAnalysis.priceUsd);
  });

  it("Pro's price is what the checkout charges", () => {
    const cents = num(src("supabase/functions/_shared/pro.ts"), /PRO_PRICE_CENTS\s*=\s*(\d+)/, "_shared/pro.ts");
    expect(F.PRO_PRICE_USD * 100).toBe(cents);
    expect(F.PRO_PRICE_USD).toBe(SUBSCRIPTIONS.pro.priceUsd);
  });

  it("the scan allowances are free-keyword-scan's", () => {
    const fn = src("supabase/functions/free-keyword-scan/index.ts");
    expect(F.FREE_SCANS_PER_DAY).toBe(num(fn, /const FREE_SCANS_PER_DAY\s*=\s*(\d+)/, "free-keyword-scan"));
    expect(F.SIGNED_IN_SCANS_PER_DAY).toBe(num(fn, /const SIGNED_IN_SCANS_PER_DAY\s*=\s*(\d+)/, "free-keyword-scan"));
  });

  it("the free key's quota and the withheld systems are the connector's", () => {
    expect(F.FREE_KEY_DAILY_QUOTA).toBe(MCP_FREE_KEY_DAILY_QUOTA);
    expect([...F.WITHHELD_SOURCES].sort()).toEqual([...MCP_WITHHELD_SOURCES].sort());
    for (const s of F.WITHHELD_SOURCES) expect(F.WITHHELD_SOURCE_NAMES[s], s).toBeTruthy();
  });

  it("the retention periods are resume-retention's", () => {
    expect(F.FREE_REPORT_DAYS).toBe(REPORT_CACHE_DAYS);
    expect(F.FULL_ANALYSIS_LINK_DAYS).toBe(SHARED_ANALYSIS_DAYS);
  });

  it("the limits' date is a real day, not in the future", () => {
    expect(F.LIMITS_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(F.LIMITS_AS_OF)).toBeLessThanOrEqual(Date.now());
  });
});

describe("mirrors of constants still on other branches (they pin themselves when they land)", () => {
  it("the writing allowance: wave 4's WRITING_ALLOWANCE, else the owner's 1 / 5 / 60", () => {
    const mod = Object.values(writingModules)[0];
    if (mod) expect({ ...F.WRITING }).toEqual({ ...mod.WRITING_ALLOWANCE });
    else expect({ ...F.WRITING }).toEqual({ freePerToolPerDay: 1, proPackagesPerDay: 5, proPackagesPerMonth: 60 });
  });

  it("the Builder price: builder-plan.ts, else $49", () => {
    const mod = Object.values(builderModules)[0];
    expect(F.BUILDER_PRICE_USD).toBe(mod ? mod.BUILDER_PLAN_PRICE_USD : 49);
  });

  it("the Builder proposal: the API's BUILDER_PROPOSED.perDay, else 5,000", () => {
    const api = src("supabase/functions/public-api/index.ts");
    const m = api.match(/BUILDER_PROPOSED\s*=\s*\{\s*perDay:\s*(\d+)/);
    expect(F.BUILDER_PROPOSED_PER_DAY).toBe(m ? Number(m[1]) : 5000);
  });

  it("fit with a free key: MCP_FIT_FREE_PER_DAY, else 25", () => {
    const v = (mcpTools as Record<string, unknown>).MCP_FIT_FREE_PER_DAY;
    expect(F.MCP_FIT_FREE_PER_DAY).toBe(typeof v === "number" ? v : 25);
  });

  it("the sale gates' stand-ins are the safe value until hp/honesty's flags exist, then equal them", () => {
    const mod = Object.values(salesGateModules)[0];
    if (mod && typeof mod.FULL_ANALYSIS_ON_SALE === "boolean") expect(FULL_ANALYSIS_DELIVERY_WATCHED).toBe(mod.FULL_ANALYSIS_ON_SALE);
    else expect(FULL_ANALYSIS_DELIVERY_WATCHED).toBe(false);
    if (mod && typeof mod.PRO_ON_SALE === "boolean") expect(PRO_SUBSCRIPTION_WATCHED).toBe(mod.PRO_ON_SALE);
    else expect(PRO_SUBSCRIPTION_WATCHED).toBe(false);
  });

  it("Pro's card says what wave 4's PRO_PERK_ITEMS says, the day that list exists", () => {
    const theirs = (proPerks as Record<string, unknown>).PRO_PERK_ITEMS as ReadonlyArray<{ key: string; text: string }> | undefined;
    if (!theirs || theirs === PRO_PERK_ITEMS) return;
    const vars = { perDay: F.WRITING.proPackagesPerDay, perMonth: F.WRITING.proPackagesPerMonth, faPrice: `$${F.FULL_ANALYSIS_PRICE_USD}` };
    const ours = PRO_PERK_ITEMS.map((p) => i18n.t(p.key, { ...vars, lng: "en", defaultValue: p.text }));
    expect(theirs.map((p) => p.text), "switch-over: wave 4's PRO_PERK_ITEMS and pro-perks-mirror.ts disagree").toEqual(ours);
  });

  it("the Builder strings are /data-api's, byte for byte, once its keys are in the main locales", () => {
    for (const f of LOCALE_FILES) {
      const main = readMainLocale(f) as { dataApiPage?: Record<string, string> };
      if (!main.dataApiPage?.builderName) continue;
      const ours = (JSON.parse(readFileSync(resolve(__dirname, `../components/pricing/strings/${f}`), "utf8")) as { pricingPlans: { b2b: Record<string, string> } }).pricingPlans.b2b;
      for (const k of ["builderName", "builderPrice", "builderBody", "builderNotYet", "builderCta"]) expect(ours[k], `${f} ${k}`).toBe(main.dataApiPage[k]);
    }
  });
});
