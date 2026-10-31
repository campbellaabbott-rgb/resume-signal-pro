/**
 * WHAT THE HOMEPAGE MAY SAY IS ON SALE (gates G2, G2b, G6; sales stay on, the
 * owner, 2026-10-27).
 *
 *   - No gate reads the seller: with src/config/seller.ts empty, as shipped,
 *     both switches are on, so the Full Analysis is on sale and Pro shows,
 *     including the Full Analysis. The seller is never invented: the cases
 *     with one use an obviously fake TEST SELLER, and it changes nothing.
 *   - G2 off: the reason is delivery (P17).
 *   - Pro appears with G2b, and says it includes the Full Analysis only while
 *     G2 is on.
 *   - "Alerts" is printed unless the digest is ruled marketing mail while the
 *     seller is unknown (G6): send-search-digest sends whatever the seller's
 *     state, so an unruled digest is named as the alerts it is.
 */
import { describe, expect, it } from "vitest";
import { SELLER, sellerIdentity } from "@/config/seller";
import { homePlanRows, saleGates, SALE_SWITCHES } from "@/lib/home/sale-gates";
import { DIGEST_MAIL_CLASS, FULL_ANALYSIS_ON_SALE, PRO_ON_SALE } from "@/config/sales-gate";

const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const NO_SELLER = { legalName: "", postalAddress: "" };

describe("the sale gates", () => {
  it("this branch ships with both products on sale and no seller identity", () => {
    expect(sellerIdentity(SELLER)).toBeNull();
    // The switches are the owner's, in src/config/sales-gate.ts (switch-over step 5).
    expect(SALE_SWITCHES).toEqual({ fullAnalysisOnSale: FULL_ANALYSIS_ON_SALE, proOnSale: PRO_ON_SALE, digestMailClass: DIGEST_MAIL_CLASS });
    expect(SALE_SWITCHES).toEqual({ fullAnalysisOnSale: true, proOnSale: true, digestMailClass: "unruled" });
    const g = saleGates();
    expect(g).toEqual({ seller: false, fullAnalysisOnSale: true, proOnSale: true, fullAnalysisDelivers: true, alertsStatable: true });
    expect(homePlanRows(g)).toEqual({ fullAnalysis: { state: "onSale" }, pro: { includesFullAnalysis: true }, onSale: 2 });
  });

  it("the seller changes nothing a switch decides", () => {
    for (const seller of [NO_SELLER, TEST_SELLER]) {
      for (const fullAnalysisOnSale of [false, true]) {
        for (const proOnSale of [false, true]) {
          const g = saleGates({ seller, fullAnalysisOnSale, proOnSale });
          expect(g.fullAnalysisOnSale).toBe(fullAnalysisOnSale);
          expect(g.proOnSale).toBe(proOnSale);
        }
      }
    }
  });

  it("with G2 off the reason is delivery, seller or no seller", () => {
    for (const seller of [NO_SELLER, TEST_SELLER]) {
      expect(homePlanRows(saleGates({ seller, fullAnalysisOnSale: false, proOnSale: false }))).toEqual({ fullAnalysis: { state: "gatedDelivery" }, pro: null, onSale: 0 });
    }
  });

  it("Pro appears with G2b, and claims the Full Analysis only while G2 is on", () => {
    const proOnly = homePlanRows(saleGates({ seller: NO_SELLER, fullAnalysisOnSale: false, proOnSale: true }));
    expect(proOnly.pro).toEqual({ includesFullAnalysis: false });
    expect(proOnly.onSale).toBe(1);
    const both = homePlanRows(saleGates({ seller: NO_SELLER, fullAnalysisOnSale: true, proOnSale: true }));
    expect(both).toEqual({ fullAnalysis: { state: "onSale" }, pro: { includesFullAnalysis: true }, onSale: 2 });
  });

  it("alerts are said whenever the digest can be sent", () => {
    expect(saleGates({ seller: NO_SELLER, digestMailClass: "unruled" }).alertsStatable).toBe(true);
    expect(saleGates({ seller: NO_SELLER, digestMailClass: "transactional" }).alertsStatable).toBe(true);
    expect(saleGates({ seller: NO_SELLER, digestMailClass: "marketing" }).alertsStatable).toBe(false);
    expect(saleGates({ seller: TEST_SELLER, digestMailClass: "marketing" }).alertsStatable).toBe(true);
  });
});
