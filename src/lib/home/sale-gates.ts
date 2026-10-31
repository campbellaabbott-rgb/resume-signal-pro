/**
 * WHAT THE HOMEPAGE MAY SAY IS ON SALE (corrected spec section 1, gates G2,
 * G2b and G6; owner decisions of 2026-10-17; the owner's rule of 2026-10-27:
 * there is no sales pause).
 *
 *   G2   the owner's switch for the $5 Full Analysis (on, as on main).
 *   G2b  the owner's switch for Pro (on, as on main).
 *   G6   "alerts" is printed beside saved searches unless the digest is ruled
 *        marketing mail and the seller is unknown. send-search-digest sends
 *        whatever the seller's state, as on main, so an unruled digest is
 *        named as the alerts it is.
 *
 * Nothing here waits for the seller's legal name and postal address
 * (src/config/seller.ts): sales stay on with the seller unnamed, as on main
 * and on live, and the name and address print once the owner gives them.
 *
 * The switches for G2, G2b and G6 are the owner's, in src/config/sales-gate.ts
 * (FULL_ANALYSIS_ON_SALE, PRO_ON_SALE, DIGEST_MAIL_CLASS), the module every buy
 * control on the site reads through src/lib/purchases-open.ts. SALE_SWITCHES
 * reads them when asked, so both new pages follow the same switches as every
 * other control (switch-over step 5). The homepage has no buy control; it only
 * says what is and is not on sale.
 */
import { sellerIdentity, SELLER, type SellerIdentity } from "@/config/seller";
import { DIGEST_MAIL_CLASS, FULL_ANALYSIS_ON_SALE, PRO_ON_SALE, type DigestMailClass } from "@/config/sales-gate";

export type { DigestMailClass };

export const SALE_SWITCHES: {
  readonly fullAnalysisOnSale: boolean;
  readonly proOnSale: boolean;
  readonly digestMailClass: DigestMailClass;
} = {
  get fullAnalysisOnSale() { return FULL_ANALYSIS_ON_SALE; },
  get proOnSale() { return PRO_ON_SALE; },
  get digestMailClass() { return DIGEST_MAIL_CLASS; },
};

export interface SaleGates {
  /** The seller's name and address are published (they gate no sale). */
  seller: boolean;
  /** G2. */
  fullAnalysisOnSale: boolean;
  /** G2b. */
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
    fullAnalysisOnSale: faSwitch,
    proOnSale: proSwitch,
    fullAnalysisDelivers: faSwitch,
    alertsStatable: mail !== "marketing" || seller,
  };
}

export type FullAnalysisRow =
  | { state: "onSale" }
  /** G2 off: the reason is delivery. */
  | { state: "gatedDelivery" };

export interface HomePlanRows {
  fullAnalysis: FullAnalysisRow;
  /** Null while G2b is off: the row is not shown. */
  pro: { includesFullAnalysis: boolean } | null;
  /** How many paid things are on sale: the strip's lede says it. */
  onSale: 0 | 1 | 2;
}

export function homePlanRows(g: SaleGates): HomePlanRows {
  const fullAnalysis: FullAnalysisRow = g.fullAnalysisOnSale ? { state: "onSale" } : { state: "gatedDelivery" };
  const pro = g.proOnSale ? { includesFullAnalysis: g.fullAnalysisDelivers } : null;
  const onSale = ((g.fullAnalysisOnSale ? 1 : 0) + (pro ? 1 : 0)) as 0 | 1 | 2;
  return { fullAnalysis, pro, onSale };
}
