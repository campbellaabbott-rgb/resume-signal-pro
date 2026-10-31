/**
 * WHAT A BUY CONTROL READS: its product's sale switch (homepage and pricing
 * spec of 2026-10-17, gates G2 and G2b), and nothing about the seller.
 *
 * Sales stay on (the owner, 2026-10-27: there is no sales pause). No buy
 * control waits for the seller's legal name and postal address: they print
 * once the owner gives them (src/config/seller.ts), and until then the $5
 * Full Analysis and Pro are sold as they are on main. The owner's switches in
 * src/config/sales-gate.ts are on, so every control below shows.
 *
 * fullAnalysisOnSale() is G2 and proOnSale() is G2b. Every Full Analysis
 * control (the uploader, the free report, the sticky bar, the comparison
 * table, the closing call to action) and the Pro card read these, and the new homepage and pricing page read the same
 * switches through SALE_SWITCHES (src/lib/home/sale-gates.ts). The checkouts
 * read neither: they sell what main sells.
 */
import { FULL_ANALYSIS_ON_SALE, PRO_ON_SALE } from "@/config/sales-gate";

/** G2: the owner's switch for the $5 Full Analysis (on). */
export function fullAnalysisOnSale(): boolean {
  return FULL_ANALYSIS_ON_SALE;
}

/** G2b: the owner's switch for Pro (on). */
export function proOnSale(): boolean {
  return PRO_ON_SALE;
}
