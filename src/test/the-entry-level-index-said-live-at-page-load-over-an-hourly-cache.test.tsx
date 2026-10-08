// THE ENTRY-LEVEL INDEX SAID "LIVE AT PAGE LOAD" OVER AN HOURLY CACHE.
//
// /entry-level-index returns early from get_stats_cache whenever entry_stats
// and entry_companies are there, yet told readers its numbers were "computed
// live from the board" and "exact counts from the live posting table at page
// load", and never read the cache's computed_at or stale_parts (register
// L2-11). It now prints when the figures were counted, names a part the last
// refresh could not recompute, and says "counted when this page loaded" only
// on the live path, where it is true.
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

import EntryLevelIndex from "../pages/EntryLevelIndex";

const body = () => document.body.textContent ?? "";
const STATS = { total_entry: 41234, total_open: 712000, companies_with_entry: 3100, remote_entry: 2900, by_category: { engineering: 9000 } };
const LEADERS = [{ company: "Acme", company_token: "acme", entry_roles: 40, open_roles: 120 }];

function mount(cache: unknown) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_stats_cache") return Promise.resolve({ data: cache });
    if (fn === "get_entry_level_stats") return Promise.resolve({ data: [STATS] });
    if (fn === "get_entry_level_companies") return Promise.resolve({ data: LEADERS });
    return Promise.resolve({ data: [] });
  });
  return render(<MemoryRouter><EntryLevelIndex /></MemoryRouter>);
}

beforeEach(() => { rpc.mockReset(); });

describe("the Entry-Level Index says when it counted", () => {
  it("prints the cache's own hour, and makes no 'live at page load' claim", async () => {
    mount({ computed_at: "2026-10-05T00:27:00Z", stale_parts: [], entry_stats: STATS, entry_companies: LEADERS });
    await waitFor(() => expect(body()).toContain("41,234"));
    const line = document.querySelector('[data-basis="cache"]');
    expect(line?.textContent).toMatch(/^Counted Oct [45], 2026, .+, refreshed hourly\.$/);
    expect(body()).not.toMatch(/at page load/i);
    expect(body()).not.toMatch(/computed live/i);
  });

  it("names the part the last refresh could not recompute", async () => {
    mount({ computed_at: "2026-10-05T00:27:00Z", stale_parts: ["entry_companies", "hiring_trends"], entry_stats: STATS, entry_companies: LEADERS });
    await waitFor(() => expect(body()).toContain("41,234"));
    const line = document.querySelector('[data-basis="cache"]')?.textContent ?? "";
    expect(line).toContain("The last refresh could not recompute the board ranking, so that is from an earlier hour.");
    expect(line, "a part this page does not show is not named").not.toContain("hiring");
  });

  it("says it counted at page load only when it did", async () => {
    mount(null);
    await waitFor(() => expect(body()).toContain("41,234"));
    expect(document.querySelector('[data-basis="live"]')?.textContent).toBe("Counted when this page loaded.");
    expect(document.querySelector('[data-basis="cache"]')).toBeNull();
  });
});
