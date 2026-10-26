/**
 * THE ENTRY-LEVEL LEADERBOARD'S HEADING SAYS HOW IT IS RANKED (S13-090).
 *
 * get_entry_level_companies ranks by the SHARE of a board's roles that are
 * early-career, so 63-of-63 boards sit above CHS at 1,222 of 1,394. The H2
 * still read "Hiring the most entry-level right now", a claim about counts,
 * while the bake's heading already said where a beginner has the best
 * chance. The React heading now carries the bake's words and the ranking
 * rule, in all nine languages; the caption no longer calls the roles verified.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";

const LEADERS = [
  { company: "Cngholdingsinc", company_token: "cng", entry_roles: 63, open_roles: 63 },
  { company: "CHS", company_token: "chs", entry_roles: 1222, open_roles: 1394 },
];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string) =>
      fn === "get_stats_cache"
        ? { data: { entry_stats: { total_entry: 5000, companies_with_entry: 300, remote_entry: 200, total_open: 90000, by_category: {} }, entry_companies: LEADERS, computed_at: "2026-10-18T00:00:00Z", stale_parts: [] } }
        : { data: null },
  },
}));

import EntryLevelIndex from "@/pages/EntryLevelIndex";
afterEach(cleanup);

describe("the Entry-Level Index leaderboard", () => {
  it("is headed by the share rule, not 'hiring the most'", async () => {
    render(<HelmetProvider><MemoryRouter><EntryLevelIndex /></MemoryRouter></HelmetProvider>);
    const h2 = await screen.findByRole("heading", { level: 2, name: /beginner has the best chance right now/ });
    expect(h2.textContent).toMatch(/Where a beginner has the best chance right now — ranked by share/);
    expect(document.body.textContent).not.toMatch(/Hiring the most entry-level/);
    expect(document.body.textContent).not.toMatch(/verified entry-level openings|verified roles/);
  });

  it.each(LOCALE_FILES)("%s carries the heading", (file) => {
    const eli = readMainLocale(file).entryLevelIndex as Record<string, string> | undefined;
    expect(typeof eli?.leadersHeading).toBe("string");
    expect(typeof eli?.totalCaption).toBe("string");
  });
});
