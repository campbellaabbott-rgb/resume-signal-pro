/**
 * THE HOMEPAGE AND THE PRICING PAGE SAY THE SAME THING (hp/integration).
 *
 * The two pages were built on separate branches, each with its own gate
 * module, its own facts mirrors and its own strings. A reader who sees the
 * plan strip on "/" and then the cards on /pricing must read one story:
 *   - the same things on sale, closed for the same reason, flipped by one switch;
 *   - the same prices, allowances, retention days and withheld systems;
 *   - in every language, the same final-sale sentence and the same delivery
 *     sentence, and a G1 sentence that says purchases open soon without
 *     claiming the seller is published on the homepage itself.
 * The open cases use an obviously fake TEST SELLER; nothing real is invented.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homePlanRows, saleGates, SALE_SWITCHES } from "@/lib/home/sale-gates";
import {
  FULL_ANALYSIS_DELIVERY_WATCHED,
  PRO_SUBSCRIPTION_WATCHED,
  resolveSaleGates,
} from "@/components/pricing/sale-gates";
import { visibleProPerks } from "@/components/pricing/pro-perks-mirror";
import * as homeFacts from "@/lib/home/facts";
import * as planFacts from "@/components/pricing/plan-facts";
import { HOME_WITHHELD_SOURCES } from "@/lib/home/board-figures";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const NO_SELLER = { legalName: "", postalAddress: "" };

type Tree = Record<string, unknown>;
const readJson = (rel: string): Tree => JSON.parse(readFileSync(resolve(__dirname, rel), "utf8")) as Tree;
const homeStrings = (lng: string) => (readJson(`../lib/home/strings/${lng}.json`).home as Tree).plans as Record<string, string>;
const pricingStrings = (lng: string) => readJson(`../components/pricing/strings/${lng}.json`).pricingPlans as Record<string, Record<string, string>>;

describe("one switch decides what both pages sell", () => {
  it("the pricing page's stand-ins read the homepage's switches", () => {
    expect(FULL_ANALYSIS_DELIVERY_WATCHED).toBe(SALE_SWITCHES.fullAnalysisOnSale);
    expect(PRO_SUBSCRIPTION_WATCHED).toBe(SALE_SWITCHES.proOnSale);
  });

  it("with the shipped defaults both pages sell nothing, for the same reason", () => {
    const home = homePlanRows(saleGates());
    const pricing = resolveSaleGates();
    expect(home.onSale).toBe(0);
    expect(home.fullAnalysis.state).toBe("gatedSeller");
    expect(pricing.fullAnalysis).toEqual({ onSale: false, closedBy: "seller" });
    expect(pricing.pro).toEqual({ onSale: false, closedBy: "seller" });
    expect(home.pro).toBeNull();
  });

  for (const [sellerName, seller] of [["no seller", NO_SELLER], ["TEST SELLER", TEST_SELLER]] as const) {
    for (const fa of [false, true]) {
      for (const pro of [false, true]) {
        it(`${sellerName}, Full Analysis switch ${fa}, Pro switch ${pro}: the pages agree`, () => {
          const hg = saleGates({ seller, fullAnalysisOnSale: fa, proOnSale: pro });
          const home = homePlanRows(hg);
          const pricing = resolveSaleGates({ seller, fullAnalysisDelivered: fa, proWatched: pro });

          expect(hg.fullAnalysisOnSale).toBe(pricing.fullAnalysis.onSale);
          expect(hg.proOnSale).toBe(pricing.pro.onSale);

          const reason = { onSale: null, gatedSeller: "seller", gatedDelivery: "delivery" }[home.fullAnalysis.state];
          expect(reason).toBe(pricing.fullAnalysis.closedBy);

          // Pro appears on "/" exactly when /pricing sells it, and says it
          // includes the Full Analysis exactly when the pricing card does.
          expect(home.pro !== null).toBe(pricing.pro.onSale);
          if (home.pro) {
            const proCardIncludesFa = visibleProPerks({ fullAnalysisOnSale: pricing.fullAnalysis.onSale })
              .some((p) => p.key.endsWith("includedFullAnalysis"));
            expect(home.pro.includesFullAnalysis).toBe(proCardIncludesFa);
          }
        });
      }
    }
  }
});

describe("one answer about alerts (G6)", () => {
  for (const [sellerName, seller] of [["no seller", NO_SELLER], ["TEST SELLER", TEST_SELLER]] as const) {
    for (const digestMailClass of ["unruled", "marketing", "transactional"] as const) {
      it(`${sellerName}, digest ${digestMailClass}: the pricing page may name alerts exactly when the homepage may`, () => {
        const home = saleGates({ seller, digestMailClass });
        const pricing = resolveSaleGates({ seller, digestMailClass });
        expect(pricing.alertsStatable).toBe(home.alertsStatable);
        expect(home.alertsStatable).toBe(digestMailClass === "transactional" || seller === TEST_SELLER);
      });
    }
  }

  it("with the shipped defaults neither page names alerts", () => {
    expect(saleGates().alertsStatable).toBe(false);
    expect(resolveSaleGates().alertsStatable).toBe(false);
  });
});

describe("one set of facts", () => {
  it("prices", () => {
    expect(homeFacts.HOME_FULL_ANALYSIS_USD).toBe(planFacts.FULL_ANALYSIS_PRICE_USD);
    expect(homeFacts.HOME_PRO_USD_PER_MONTH).toBe(planFacts.PRO_PRICE_USD);
  });

  it("scan and writing allowances", () => {
    expect(homeFacts.HOME_FREE_SCANS_PER_DAY).toBe(planFacts.FREE_SCANS_PER_DAY);
    expect(homeFacts.HOME_SIGNED_IN_SCANS_PER_DAY).toBe(planFacts.SIGNED_IN_SCANS_PER_DAY);
    expect(homeFacts.HOME_FREE_WRITING_PER_DAY).toBe(planFacts.WRITING.freePerToolPerDay);
    expect(homeFacts.HOME_PRO_WRITING_PER_DAY).toBe(planFacts.WRITING.proPackagesPerDay);
    expect(homeFacts.HOME_PRO_WRITING_PER_MONTH).toBe(planFacts.WRITING.proPackagesPerMonth);
  });

  it("retention", () => {
    expect(homeFacts.HOME_FREE_REPORT_DAYS).toBe(planFacts.FREE_REPORT_DAYS);
    expect(homeFacts.HOME_PAID_REPORT_DAYS).toBe(planFacts.FULL_ANALYSIS_LINK_DAYS);
  });

  it("the systems the AI connector and the data API leave out", () => {
    expect([...HOME_WITHHELD_SOURCES].sort()).toEqual([...planFacts.WITHHELD_SOURCES].sort());
  });
});

describe("one wording, in every language", () => {
  for (const lng of LOCALES) {
    it(`${lng}: the product's name, the final-sale and the delivery sentences are the same on both pages`, () => {
      const h = homeStrings(lng);
      const p = pricingStrings(lng);
      expect(h.faTitle).toBe(p.fa.name);
      expect(h.termFinal).toBe(p.buy.finalSale);
      expect(h.faGatedDelivery).toBe(p.buy.gateFaDelivery);
    });

    it(`${lng}: neither page's strings carry the stricter page's banned stems`, () => {
      // The pricing strings guard bans these stems in every language; the
      // homepage's guard was narrower, so its French said what pricing may not.
      const banned = /verif|vérifi|zero ghost|cero empleos fantasma|सत्यापित|geverifieerd|beripikado/i;
      const leaves = (o: unknown, out: string[] = []): string[] => {
        if (typeof o === "string") out.push(o);
        else if (o && typeof o === "object") for (const v of Object.values(o)) leaves(v, out);
        return out;
      };
      const all = [...leaves(readJson(`../lib/home/strings/${lng}.json`)), ...leaves(readJson(`../components/pricing/strings/${lng}.json`))];
      expect(all.filter((s) => banned.test(s))).toEqual([]);
    });
  }

  it("en: the homepage's G1 sentence says purchases open soon and names the pricing page, as /pricing does", () => {
    for (const lng of ["en", "en-GB"]) {
      const h = homeStrings(lng);
      const p = pricingStrings(lng);
      expect(h.faGatedSeller).toContain("Purchases open soon");
      expect(h.faGatedSeller).toContain("on the pricing page");
      expect(h.faGatedSeller).not.toContain("on this page");
      expect(p.buy.gateSeller).toContain("Purchases open soon");
    }
  });

  it("en: both pages name the same refused territories and the same two checks", () => {
    const h = homeStrings("en");
    const p = pricingStrings("en");
    for (const place of ["the EU", "the EEA", "the UK", "India"]) {
      expect(h.termTerritory).toContain(place);
      expect(p.buy.region).toContain(place);
    }
    const homeChecks = h.termTerritory.toLowerCase();
    const pricingChecks = `${p.before.regionBody}`.toLowerCase();
    for (const check of ["currency", "time zone"]) {
      expect(homeChecks).toContain(check);
      expect(pricingChecks).toContain(check);
    }
    for (const s of [homeChecks, pricingChecks]) expect(s).not.toMatch(/\bip\b|lookup/);
    for (const s of [homeChecks, pricingChecks]) expect(s).not.toContain("billing address");
  });
});
