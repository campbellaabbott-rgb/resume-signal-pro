// A TILE THAT WAITED FOR A NUMBER IT ALREADY HAD.
//
// On 2026-09-10 the Ghost Job Index's three stats tiles showed a loading
// skeleton for ~16 seconds. Their own reads answered in 0.24s
// (get_stats_cache, ghost_stats present); they were waiting on a sibling in
// the same Promise.all — get_actively_hiring_companies, which took 15.9s
// after 20260909217000 made the fill curve it calls five times heavier.
//
// The property: the stats tiles paint as soon as the STATS read settles,
// whatever the leaderboard is doing. The leaderboard here never resolves at
// all, and the tile must still show its number within two seconds. Against
// the pre-fix page (one Promise.all over all four reads) this never paints.
import { describe, it, expect, vi, beforeEach } from "vitest";
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

import GhostJobIndex from "../pages/GhostJobIndex";

const NEVER = new Promise<never>(() => {});
const body = () => document.body.textContent ?? "";

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_stats_cache") {
      return Promise.resolve({ data: { computed_at: new Date().toISOString(), ghost_stats: {
        total_open: 794317, total_companies: 32967, total_company_names: 32086, closed_90d: 1000,
        observed_days: 58, median_days_open: 13.8, median_days_to_close: 11, posted_coverage_pct: 99.4,
        computed_at: new Date().toISOString(),
      } } });
    }
    // THE LEADERBOARD NEVER ANSWERS. A 16s answer and a never-answer are the
    // same thing to a reader looking at a skeleton.
    if (fn === "get_actively_hiring_companies") return NEVER;
    return Promise.resolve({ data: null });
  });
});

describe("a tile that waited for a number it already had", () => {
  it("paints the stats tiles as soon as the stats read settles, while the leaderboard is still pending", async () => {
    render(<MemoryRouter><GhostJobIndex /></MemoryRouter>);
    await waitFor(() => {
      expect(body(), "the verified-open-roles tile did not paint while the leaderboard was pending")
        .toContain("794,317");
    }, { timeout: 2000 });
    expect(body()).toContain("13.8d");
    // and the skeleton is gone from the tiles that have their number
    const skeletons = document.querySelectorAll(".text-2xl .animate-pulse").length;
    expect(skeletons, "a stats tile still shows a skeleton after its number arrived").toBe(0);
  });
});
