/**
 * THE PAY PAGE NAMES WHAT IT COUNTS, IN THE APP AS IN THE BAKE (S13-049,
 * S13-088; the React half the bake builder handed off).
 *
 * The baked /pay-transparency says "Most transparent large job boards — one
 * row per job board" and that its population is the postings the board
 * carries plus the few awaiting removal. The app still printed "Most
 * transparent large employers" over a per-token ranking, and said its figures
 * included "roles since taken down or aged past the board's 30-day cap",
 * which the closure pass and the freshness sweep stopped being true of when
 * they began deleting those rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

const PAY = {
  categories: [{ category: "engineering", total: 1200, pay_pct: 41 }],
  top_companies: [{ company: "Acme", company_token: "acme", total: 80, pay_pct: 90 }],
  overall: { total: 5000, pay_pct: 38 },
};
const COVERAGE = { by_source: [{ source: "greenhouse", total: 900, pay_pct: 44, mode_pct: 70 }], overall: { total: 5000, pay_pct: 38, mode_n: 3000, mode_pct: 60 } };
const body = () => document.body.textContent ?? "";

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => (fn === "get_transparency_cache"
    ? Promise.resolve({ data: { pay: PAY, coverage: COVERAGE, computed_at: "2026-10-24T01:37:00Z" }, error: null })
    : Promise.resolve({ data: null, error: { code: "42501" } })));
});

describe("/pay-transparency in the app", () => {
  it("ranks job boards, one row per board, and says so", async () => {
    render(<MemoryRouter><PayTransparencyIndex /></MemoryRouter>);
    await waitFor(() => expect(body()).toContain("Acme"));
    expect(body()).toContain("Most transparent large job boards");
    expect(body()).toContain("One row per job board; an employer running several counts once per board.");
    expect(body()).not.toContain("Most transparent large employers");
  });

  it("names the population the table holds, never roles since taken down", async () => {
    render(<MemoryRouter><PayTransparencyIndex /></MemoryRouter>);
    await waitFor(() => expect(body()).toContain("refreshed hourly"));
    expect(body()).toContain("Counted across the postings the board currently carries, plus the few awaiting removal");
    expect(body()).not.toMatch(/including roles since taken down/);
  });
});
