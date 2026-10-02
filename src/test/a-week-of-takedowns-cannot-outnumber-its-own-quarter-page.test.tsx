// A WEEK OF TAKEDOWNS CANNOT OUTNUMBER ITS OWN QUARTER -- the page half. The
// SQL half, the verdict's unit cases and the prerender's mirror are guarded in
// a-week-of-takedowns-cannot-outnumber-its-own-quarter.test.ts.
//
// On 2026-10-01 /hiring-trends rendered 806,570 under "roles filled or closed
// last week", from a cache row whose own ghost_stats said 1,852,789 closures
// in 90 days. The prerender had been holding that figure back from crawlers
// since 2026-09-23; the React page printed `fmt(lastFull.closed)` whatever it
// was. A unit test of closureVerdict cannot catch a page that imports the
// verdict and never consults it, so this file MOUNTS the page with a mocked
// rpc and reads what it renders:
//   1. the live incident payload, in the old five-column shape, renders no
//      806,570 and renders the withheld reason (the record's ceiling);
//   2. the same weeks in the new six-column shape render the flagged-majority
//      reason, with both counts, and still no takedown figure in the tile;
//   3. a clean week prints its number and says how many flagged records it
//      excludes;
//   4. a held week has no takedown bar -- its tooltip says "withheld" -- while
//      a clean week's bar carries its count;
//   5. the cache-miss path is judged against the cache's own record too;
//   6. the old nouns ("filled or closed") are gone from the page.
// Red on the pre-fix page: every case in 1-4 and 6 fails against the
// HiringTrends.tsx this change replaces (recorded in the commit).
import { describe, it, expect, vi, beforeEach } from "vitest";
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
import { VIZ_SERIES_B } from "@/components/DataViz";

const body = () => document.body.textContent ?? "";
/** Rendered once the weeks have arrived, by the pre-fix page and this one alike,
 *  so the pre-fix page reaches the assertions instead of timing out on a label. */
const READY = "new roles posted last week";
const RECORD = { closed_90d: 1_854_930, observed_days: 79, total_open: 752_000, computed_at: "2026-10-01T23:05:00+00:00" };
/** The live rows of 2026-10-01, as the cache carried them before 20261002113617. */
const OLD_ROWS = [
  { week_start: "2026-08-31", new_postings: 253266, entry_new: 20452, remote_new: 7807, closed: 172263 },
  { week_start: "2026-09-07", new_postings: 303025, entry_new: 23170, remote_new: 8337, closed: 845110 },
  { week_start: "2026-09-14", new_postings: 345732, entry_new: 32030, remote_new: 10798, closed: 870536 },
  { week_start: "2026-09-21", new_postings: 332381, entry_new: 30000, remote_new: 9000, closed: 806570 },
  { week_start: "2026-09-28", new_postings: 144411, entry_new: 16998, remote_new: 6064, closed: 499871 },
];
/** The same weeks as the new body partitions them. */
const NEW_ROWS = [
  { ...OLD_ROWS[0], closed: 172263, closed_flagged: 0 },
  { ...OLD_ROWS[1], closed: 160000, closed_flagged: 685110 },
  { ...OLD_ROWS[2], closed: 170000, closed_flagged: 700536 },
  { ...OLD_ROWS[3], closed: 150000, closed_flagged: 656570 },
  { ...OLD_ROWS[4], closed: 90000, closed_flagged: 409871 },
];
const cacheRow = (rows: unknown[] | undefined, ghost: unknown = RECORD) => ({
  computed_at: "2026-10-01T23:12:00+00:00",
  stale_parts: [],
  ghost_stats: ghost,
  ...(rows === undefined ? {} : { hiring_trends: rows }),
  trending_categories: [],
});

function mount(cache: unknown, live: unknown[] = []) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_stats_cache") return Promise.resolve({ data: cache });
    if (fn === "get_hiring_trends") return Promise.resolve({ data: live });
    return Promise.resolve({ data: [] });
  });
  return render(<MemoryRouter><HiringTrends /></MemoryRouter>);
}

/** The takedown tile's big figure, found by the label beneath it. */
function tileFigure(): string {
  const label = [...document.querySelectorAll("div")].find((d) => d.textContent === "takedowns logged last week");
  expect(label, "the takedown tile is not rendered").toBeTruthy();
  return label!.previousElementSibling?.textContent ?? "";
}

/** The tooltip a week's bar group shows on hover. */
function tooltipFor(container: HTMLElement, index: number): string {
  const groups = [...container.querySelectorAll("svg g")].filter((g) => g.querySelector('rect[fill="transparent"]'));
  expect(groups.length, "no bar groups rendered").toBeGreaterThan(index);
  fireEvent.mouseEnter(groups[index]);
  const tip = container.querySelector(".pointer-events-none");
  return tip?.textContent ?? "";
}

beforeEach(() => { rpc.mockReset(); });

describe("1. the incident payload, old shape: held by the record's ceiling", () => {
  it("renders no 806,570 and says why the week is withheld", async () => {
    mount(cacheRow(OLD_ROWS));
    await waitFor(() => expect(body()).toContain(READY));
    expect(body(), "the page printed the refuted weekly figure").not.toContain("806,570");
    expect(tileFigure()).toBe("—");
    expect(body()).toContain("Withheld — the week reads at more than twice the daily average of our own 90-day closure record.");
  });
});

describe("2. the incident weeks, new shape: held because the flagged records outnumber the admitted", () => {
  it("renders the flagged-majority reason with both counts, and no figure in the tile", async () => {
    mount(cacheRow(NEW_ROWS));
    await waitFor(() => expect(body()).toContain(READY));
    expect(tileFigure()).toBe("—");
    expect(body()).toContain(
      "Withheld — our collector flagged 656,570 of the week's takedown records as possible read failures of its own, more than the 150,000 it could vouch for, so a figure here would describe our crawler rather than employers.",
    );
    expect(body()).not.toContain("806,570");
  });
});

describe("3. a clean week prints its number, and what it excludes", () => {
  it("prints 172,263 and the flagged records it left out", async () => {
    mount(cacheRow([{ ...NEW_ROWS[0], closed_flagged: 4000 }, NEW_ROWS[1]]));
    await waitFor(() => expect(body()).toContain(READY));
    expect(tileFigure()).toBe("172,263");
    expect(body()).toContain("excludes 4,000 records our collector flagged as possible read failures of its own");
    expect(body()).not.toContain("Withheld —");
  });
});

describe("4. a held week has no takedown bar; a clean week's bar carries its count", () => {
  it("tooltips: the clean week shows its count, every held week shows withheld", async () => {
    const { container } = mount(cacheRow(OLD_ROWS));
    await waitFor(() => expect(body()).toContain("New postings by week"));
    expect(body()).toContain("Taken down");
    // One takedown bar is DRAWN -- the clean week's. A held week passing its
    // refused number as the bar's height would draw four more, each taller
    // than the board, with a tooltip that still said "withheld".
    expect(container.querySelectorAll(`svg path[fill="${VIZ_SERIES_B}"]`)).toHaveLength(1);
    expect(tooltipFor(container, 0)).toContain("172,263 taken down");
    for (const i of [1, 2, 3, 4]) {
      const tip = tooltipFor(container, i);
      expect(tip, `week ${i}`).toContain("takedowns withheld");
      expect(tip, `week ${i}`).not.toMatch(/845,110|870,536|806,570|499,871/);
    }
  });
});

describe("5. the cache-miss path is judged against the cache's own record", () => {
  it("live old-shape rows are held by the ceiling the cache row carries", async () => {
    mount(cacheRow(undefined), OLD_ROWS);
    await waitFor(() => expect(body()).toContain(READY));
    expect(rpc.mock.calls.some((c) => c[0] === "get_hiring_trends")).toBe(true);
    expect(tileFigure()).toBe("—");
    expect(body()).not.toContain("806,570");
  });

  it("with no cache at all, live new-shape rows are still held on the flagged majority", async () => {
    mount(null, NEW_ROWS);
    await waitFor(() => expect(body()).toContain(READY));
    expect(tileFigure()).toBe("—");
    expect(body()).toContain("more than the 150,000 it could vouch for");
  });
});

describe("6. the nouns the figure cannot carry are gone", () => {
  it("no 'filled or closed', no filled roles, a takedown never called a hire", async () => {
    mount(cacheRow(NEW_ROWS));
    await waitFor(() => expect(body()).toContain(READY));
    expect(body()).not.toMatch(/filled or closed/i);
    expect(body()).not.toMatch(/roles?\s+(?:actually\s+)?(?:got|were|get)\s+filled/i);
    expect(body()).toMatch(/never called a hire/);
    expect(body()).toContain("dated by the day we confirmed it gone");
  });
});
