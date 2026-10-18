/**
 * WHAT THE HOMEPAGE MAY SAY IS ON SALE (gates G1, G2, G2b, G6).
 *
 *   - G1 closed (src/config/seller.ts has no legal name and address): the Full
 *     Analysis says it is not on sale BECAUSE of the seller's identity; Pro is
 *     not shown. That is the state of this branch, and the seller is never
 *     invented: the open cases below use an obviously fake TEST SELLER.
 *   - G1 open, G2 closed: the reason is delivery, a different sentence (P17).
 *   - Pro appears only with G1 and G2b, and says it includes the Full
 *     Analysis only once G2 has passed.
 *   - "Alerts" is printed only when the digest is ruled transactional or the
 *     seller is known (G6).
 */
import { describe, expect, it } from "vitest";
import { SELLER, sellerIdentity } from "@/config/seller";
import { homePlanRows, saleGates, SALE_SWITCHES } from "@/lib/home/sale-gates";

const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const NO_SELLER = { legalName: "", postalAddress: "" };

describe("the sale gates", () => {
  it("this branch ships with every gate closed and no seller identity", () => {
    expect(sellerIdentity(SELLER)).toBeNull();
    expect(SALE_SWITCHES).toEqual({ fullAnalysisOnSale: false, proOnSale: false, digestMailClass: "unruled" });
    const g = saleGates();
    expect(g).toEqual({ seller: false, fullAnalysisOnSale: false, proOnSale: false, fullAnalysisDelivers: false, alertsStatable: false });
    expect(homePlanRows(g)).toEqual({ fullAnalysis: { state: "gatedSeller" }, pro: null, onSale: 0 });
  });

  it("a switch alone sells nothing while the seller is unknown (G1 first)", () => {
    const g = saleGates({ seller: NO_SELLER, fullAnalysisOnSale: true, proOnSale: true });
    expect(g.fullAnalysisOnSale).toBe(false);
    expect(g.proOnSale).toBe(false);
    expect(homePlanRows(g).fullAnalysis.state).toBe("gatedSeller");
    expect(homePlanRows(g).pro).toBeNull();
  });

  it("with the seller known but delivery unwatched, the reason changes to delivery", () => {
    const g = saleGates({ seller: TEST_SELLER, fullAnalysisOnSale: false, proOnSale: false });
    expect(homePlanRows(g)).toEqual({ fullAnalysis: { state: "gatedDelivery" }, pro: null, onSale: 0 });
  });

  it("Pro appears with G1 and G2b, and claims the Full Analysis only once G2 has passed", () => {
    const proOnly = homePlanRows(saleGates({ seller: TEST_SELLER, fullAnalysisOnSale: false, proOnSale: true }));
    expect(proOnly.pro).toEqual({ includesFullAnalysis: false });
    expect(proOnly.onSale).toBe(1);
    const both = homePlanRows(saleGates({ seller: TEST_SELLER, fullAnalysisOnSale: true, proOnSale: true }));
    expect(both).toEqual({ fullAnalysis: { state: "onSale" }, pro: { includesFullAnalysis: true }, onSale: 2 });
  });

  it("alerts are said only when the digest can be sent", () => {
    expect(saleGates({ seller: NO_SELLER, digestMailClass: "unruled" }).alertsStatable).toBe(false);
    expect(saleGates({ seller: NO_SELLER, digestMailClass: "marketing" }).alertsStatable).toBe(false);
    expect(saleGates({ seller: NO_SELLER, digestMailClass: "transactional" }).alertsStatable).toBe(true);
    expect(saleGates({ seller: TEST_SELLER, digestMailClass: "marketing" }).alertsStatable).toBe(true);
  });
});
