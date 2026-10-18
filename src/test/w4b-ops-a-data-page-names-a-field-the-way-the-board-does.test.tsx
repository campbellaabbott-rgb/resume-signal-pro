/**
 * A DATA PAGE NAMES A FIELD THE WAY THE BOARD DOES (S12-046).
 *
 * WHAT WAS WRONG. /pay-transparency's "By field" table named fields from a
 * list of its own: the board's "product" and "security" were missing from it,
 * so the page printed the raw slugs, the catch-all printed "other", and it
 * kept names ("Construction & Trades", "Media & Creative") for fields the
 * board's filter does not offer. A citable page showed internal keys.
 *
 * WHAT HOLDS NOW: the page names each field with the board's own English
 * label (held equal to the English locale's jobsPage.categories), and folds
 * every slug the board does not serve into one "Other" row whose share is
 * weighted by its rows' totals.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import en from "../i18n/locales/en.json";
import { BOARD_CATEGORY_SLUGS } from "@/lib/job-board-categories";
import { BOARD_CATEGORY_LABELS, foldToBoardCategories } from "@/lib/board-category-labels";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    functions: { invoke: async () => ({ data: {} }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import PayTransparencyIndex from "../pages/PayTransparencyIndex";

describe("the board's field names", () => {
  it("name every board category and Other, exactly as the English locale's board filter does", () => {
    const board = (en as { jobsPage: { categories: Record<string, string> } }).jobsPage.categories;
    for (const slug of [...BOARD_CATEGORY_SLUGS, "other"] as const) expect(BOARD_CATEGORY_LABELS[slug], slug).toBe(board[slug]);
    expect(Object.keys(BOARD_CATEGORY_LABELS).sort()).toEqual([...BOARD_CATEGORY_SLUGS, "other"].sort());
  });

  it("fold a slug the board does not serve into Other, weighting its share by each row's total", () => {
    const rows = foldToBoardCategories([
      { category: "product", total: 400, pay_pct: 60 },
      { category: "construction", total: 300, pay_pct: 20 },
      { category: "other", total: 100, pay_pct: 60 },
      { category: "security", total: 250, pay_pct: 50.5 },
    ]);
    expect(rows.map((r) => [r.label, r.total, r.pay_pct])).toEqual([
      ["Product", 400, 60], ["Security & Trust", 250, 50.5], ["Other", 400, 30],
    ]);
  });
});

describe("/pay-transparency's By field table", () => {
  it("prints the board's names, never a raw slug or a field the board does not offer", async () => {
    rpc.mockImplementation(async () => ({
      data: {
        pay: {
          categories: [
            { category: "product", total: 900, pay_pct: 61.2 }, { category: "security", total: 700, pay_pct: 55 },
            { category: "people_hr", total: 500, pay_pct: 40 }, { category: "creative", total: 300, pay_pct: 30 },
            { category: "other", total: 200, pay_pct: 10 },
          ],
          top_companies: [], overall: { total: 5000, pay_pct: 38 },
        },
        coverage: { by_source: [], overall: { total: 5000, pay_pct: 38, mode_n: 3000, mode_pct: 60 } },
        computed_at: "2026-10-12T10:37:00Z",
      },
    }));
    render(<MemoryRouter><PayTransparencyIndex /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Security & Trust")).toBeTruthy());
    const fields = [...document.querySelectorAll("[data-field]")].map((el) => el.querySelector("span")?.textContent);
    expect(fields).toEqual(["Product", "Security & Trust", "People & Recruiting", "Other"]);
    for (const raw of ["product", "security", "other", "creative", "Media & Creative", "People & HR"]) {
      expect(fields, raw).not.toContain(raw);
    }
    expect(document.querySelector('[data-field="other"]')?.textContent).toMatch(/^Other22% of 500$/);
  });
});
