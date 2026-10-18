/**
 * THE PRICING PAGE'S TITLE AND DESCRIPTION FOLLOW THE SALE GATES.
 *
 * A search result must not advertise a price that is not on sale: the title
 * names Pro's price only while Pro is on sale (G1 and G2b), and the
 * description names each price only while that product is on sale (the Full
 * Analysis with G1 and G2, Pro with G1 and G2b). With nothing on sale it
 * says the paid extras open soon. The preview's forced-open state sells
 * nothing, so it reads as closed. Every description that names a price also
 * names where nothing is sold yet: the EU, the EEA, the UK and India.
 */
import type { SaleGates } from "./sale-gates";

export interface PricingMetaKeys {
  title: string;
  description: string;
}

export function pricingMetaKeys(gates: SaleGates): PricingMetaKeys {
  const fa = !gates.previewOpen && gates.fullAnalysis.onSale;
  const pro = !gates.previewOpen && gates.pro.onSale;
  const description = fa && pro ? "description" : fa ? "descriptionFa" : pro ? "descriptionPro" : "descriptionClosed";
  return {
    title: pro ? "pricingPlans.meta.title" : "pricingPlans.meta.titleNoPro",
    description: `pricingPlans.meta.${description}`,
  };
}
