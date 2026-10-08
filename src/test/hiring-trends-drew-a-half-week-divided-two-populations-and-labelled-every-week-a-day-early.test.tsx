// HIRING TRENDS DREW A HALF-WEEK, DIVIDED TWO POPULATIONS, AND LABELLED EVERY
// WEEK A DAY EARLY.
//
// Three defects on /hiring-trends, judged by what the mounted page renders:
//   L2-06  the oldest bar reached past the 30-day fence and had lost its
//          aged-out postings (126,499 beside 235,529 on a Sunday); a cached row
//          whose Monday was past the fence at the cache's stamp is not drawn.
//   L2-21  the remote tile divided remote_new (live rows only) by new_postings
//          (live + closed): 9,357 / 267,124 = 4%. It now divides by live_new.
//   L2-22  weekLabel formatted a UTC date in the reader's zone, so a reader in
//          New York saw every Monday as the Sunday before.
// Red on the page before this change: every case below fails against it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
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

import HiringTrends from "../pages/HiringTrends";

const body = () => document.body.textContent ?? "";
const READY = "new roles posted last week";
const RECORD = { closed_90d: 1_854_930, observed_days: 79 };
// Stamped on a Sunday: the week of 08-31 starts 34 days earlier and reaches
// past the fence; the next four are inside it.
const STAMP = "2026-10-04T23:27:00+00:00";
const ROWS = [
  { week_start: "2026-08-31", new_postings: 126499, entry_new: 474, remote_new: 159, closed: 90000, closed_flagged: 0, live_new: 100000 },
  { week_start: "2026-09-07", new_postings: 235529, entry_new: 20000, remote_new: 8000, closed: 160000, closed_flagged: 0, live_new: 180000 },
  { week_start: "2026-09-14", new_postings: 265495, entry_new: 21000, remote_new: 9000, closed: 170000, closed_flagged: 0, live_new: 190000 },
  { week_start: "2026-09-21", new_postings: 267124, entry_new: 22000, remote_new: 9357, closed: 150000, closed_flagged: 0, live_new: 170140 },
  { week_start: "2026-09-28", new_postings: 144411, entry_new: 16998, remote_new: 6064, closed: 90000, closed_flagged: 0, live_new: 100000 },
];
const cache = (rows: unknown[]) => ({ computed_at: STAMP, stale_parts: [], ghost_stats: RECORD, hiring_trends: rows, trending_categories: [] });

function mount(c: unknown) {
  rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === "get_stats_cache" ? c : [] }));
  return render(<MemoryRouter><HiringTrends /></MemoryRouter>);
}
/** The tooltip labels of every drawn bar group, in order. */
function barLabels(container: HTMLElement): string[] {
  const groups = [...container.querySelectorAll("svg g")].filter((g) => g.querySelector('rect[fill="transparent"]'));
  return groups.map((g) => {
    fireEvent.mouseEnter(g);
    return container.querySelector(".pointer-events-none")?.textContent ?? "";
  });
}

const TZ = process.env.TZ;
beforeEach(() => { rpc.mockReset(); });
afterEach(() => { process.env.TZ = TZ; });

describe("the weekly bars", () => {
  it("do not draw a week whose Monday was past the 30-day fence when the rows were computed", async () => {
    const { container } = mount(cache(ROWS));
    await waitFor(() => expect(body()).toContain(READY));
    const labels = barLabels(container);
    expect(labels).toHaveLength(4);
    expect(labels.join(" | ")).not.toContain("126,499");
    expect(labels[0]).toContain("235,529");
  });

  it("are labelled with the Monday they start on, for a reader west of Greenwich", async () => {
    process.env.TZ = "America/New_York";
    const { container } = mount(cache(ROWS));
    await waitFor(() => expect(body()).toContain(READY));
    const labels = barLabels(container);
    expect(labels[0]).toMatch(/Sep 7\b/);
    expect(labels[0]).not.toMatch(/Sep 6\b/);
    expect(body()).toMatch(/w\/o Sep 21\b/);
  });
});

describe("the remote tile", () => {
  it("divides remote roles by the live rows they were counted from, not by every posting dated that week", async () => {
    mount(cache(ROWS));
    await waitFor(() => expect(body()).toContain(READY));
    const label = [...document.querySelectorAll("div")].find((d) => /still on the board state remote/.test(d.textContent ?? "") && d.children.length === 0);
    expect(label, "the remote tile is not rendered").toBeTruthy();
    // 9,357 of 170,140 live rows: 5%. Over new_postings it read 4%.
    expect(label!.previousElementSibling?.textContent).toBe("5%");
  });

  it("prints no share for a row from before live_new existed", async () => {
    mount(cache(ROWS.map(({ live_new: _l, ...r }) => r)));
    await waitFor(() => expect(body()).toContain(READY));
    const label = [...document.querySelectorAll("div")].find((d) => /still on the board state remote/.test(d.textContent ?? "") && d.children.length === 0);
    expect(label!.previousElementSibling?.textContent).toBe("—");
  });
});
