/**
 * WHAT THE HOMEPAGE MAY SAY IS ON SALE (corrected spec section 1, gates G1,
 * G2, G2b and G6; owner decisions of 2026-10-17).
 *
 *   G1   the seller's legal name and postal address are in
 *        src/config/seller.ts. Nothing is sold, and no buy control renders,
 *        until they are. Never invented: the values come from the owner.
 *   G2   the Full Analysis delivered to a watched real purchase, and the
 *        failed-delivery alarm fired on a forced failure.
 *   G2b  one watched Pro subscription: subscribe, one package, cancel, still
 *        on until the period ends.
 *   G6   the saved-search digest's mail class is ruled. If it is marketing
 *        mail it pauses until the seller identity exists, so "alerts" is
 *        printed only when the digest is ruled transactional or the seller is
 *        known.
 *
 * The switches for G2, G2b and G6 belong in src/config/sales-gate.ts
 * (hp/honesty). It does not exist on this branch, so they are mirrored here,
 * all closed, and the switch-over replaces SALE_SWITCHES with that module.
 * The homepage has no buy control; it only says what is and is not on sale.
 */
import { sellerIdentity, SELLER, type SellerIdentity } from "@/config/seller";

export type DigestMailClass = "transactional" | "marketing" | "unruled";

export const SALE_SWITCHES: {
  readonly fullAnalysisOnSale: boolean;
  readonly proOnSale: boolean;
  readonly digestMailClass: DigestMailClass;
} = {
  fullAnalysisOnSale: false,
  proOnSale: false,
  digestMailClass: "unruled",
};

export interface SaleGates {
  /** G1: the seller's name and address are published. */
  seller: boolean;
  /** G1 and G2. */
  fullAnalysisOnSale: boolean;
  /** G1 and G2b. */
  proOnSale: boolean;
  /** G2: the Full Analysis delivery was watched (Pro may say it includes it). */
  fullAnalysisDelivers: boolean;
  /** G6: "alerts" may be printed beside saved searches. */
  alertsStatable: boolean;
}

export function saleGates(input: {
  seller?: SellerIdentity;
  fullAnalysisOnSale?: boolean;
  proOnSale?: boolean;
  digestMailClass?: DigestMailClass;
} = {}): SaleGates {
  const seller = sellerIdentity(input.seller ?? SELLER) !== null;
  const faSwitch = input.fullAnalysisOnSale ?? SALE_SWITCHES.fullAnalysisOnSale;
  const proSwitch = input.proOnSale ?? SALE_SWITCHES.proOnSale;
  const mail = input.digestMailClass ?? SALE_SWITCHES.digestMailClass;
  return {
    seller,
    fullAnalysisOnSale: seller && faSwitch,
    proOnSale: seller && proSwitch,
    fullAnalysisDelivers: faSwitch,
    alertsStatable: mail === "transactional" || seller,
  };
}

export type FullAnalysisRow =
  | { state: "onSale" }
  /** G1 closed: the reason is the seller's identity. */
  | { state: "gatedSeller" }
  /** G1 open, G2 closed: the reason is delivery. */
  | { state: "gatedDelivery" };

export interface HomePlanRows {
  fullAnalysis: FullAnalysisRow;
  /** Null while G1 or G2b is closed: the row is not shown. */
  pro: { includesFullAnalysis: boolean } | null;
  /** How many paid things are on sale: the strip's lede says it. */
  onSale: 0 | 1 | 2;
}

export function homePlanRows(g: SaleGates): HomePlanRows {
  const fullAnalysis: FullAnalysisRow = g.fullAnalysisOnSale
    ? { state: "onSale" }
    : !g.seller
      ? { state: "gatedSeller" }
      : { state: "gatedDelivery" };
  const pro = g.proOnSale ? { includesFullAnalysis: g.fullAnalysisDelivers } : null;
  const onSale = ((g.fullAnalysisOnSale ? 1 : 0) + (pro ? 1 : 0)) as 0 | 1 | 2;
  return { fullAnalysis, pro, onSale };
}
