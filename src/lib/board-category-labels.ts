// The board's own English names for its categories, for the English-only data
// pages. They are the values of jobsPage.categories in the English locale (a
// test holds the two equal), so a data page names a field the way the board's
// filter does (S12-046: /pay-transparency printed the raw slugs "product",
// "security" and "other", and kept names for fields the board does not have).
import { isBoardCategory, type BoardCategorySlug } from "./job-board-categories";

export const BOARD_CATEGORY_LABELS: Record<BoardCategorySlug | "other", string> = {
  engineering: "Engineering & IT",
  data_ai: "Data & AI",
  design: "Design",
  product: "Product",
  marketing: "Marketing & Comms",
  sales: "Sales & Partnerships",
  customer: "Customer Success & Support",
  finance: "Finance & Accounting",
  legal: "Legal & Compliance",
  people_hr: "People & Recruiting",
  operations: "Operations & Logistics",
  healthcare: "Healthcare & Clinical",
  science: "Science & Research",
  education: "Education",
  hospitality_retail: "Hospitality & Retail",
  security: "Security & Trust",
  admin: "Administrative",
  other: "Other",
};

export interface CategoryShare {
  category: string;
  total: number;
  pay_pct: number;
}

/**
 * Rows of a per-category figure, folded onto the board's categories: a slug
 * the board serves keeps its row and gets its board name; every other slug
 * ("other", and legacy fields the board does not have) is summed into one
 * "Other" row, its share weighted by each row's total, placed last. Pure.
 */
export function foldToBoardCategories(rows: CategoryShare[]): Array<CategoryShare & { label: string }> {
  const kept: Array<CategoryShare & { label: string }> = [];
  let otherTotal = 0;
  let otherPay = 0;
  for (const r of rows ?? []) {
    const total = Number(r?.total) || 0;
    const pct = Number(r?.pay_pct) || 0;
    if (isBoardCategory(r?.category)) {
      kept.push({ category: r.category, total, pay_pct: pct, label: BOARD_CATEGORY_LABELS[r.category] });
    } else {
      otherTotal += total;
      otherPay += (pct * total) / 100;
    }
  }
  if (otherTotal > 0) {
    kept.push({ category: "other", total: otherTotal, pay_pct: Math.round((1000 * otherPay) / otherTotal) / 10, label: BOARD_CATEGORY_LABELS.other });
  }
  return kept;
}
