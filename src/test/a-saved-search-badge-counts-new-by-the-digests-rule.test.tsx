/**
 * A SAVED SEARCH'S BADGE COUNTS "NEW" BY THE DIGEST'S RULE, AND A CAPPED TOTAL
 * SAYS SO (NB-21, the account card's half; SavedSearchPills on /jobs is
 * board-ui's).
 *
 * WHAT WAS WRONG. The card's "new since your last visit" badges asked the
 * board for postedAfter (the employer's date alone) while the alert mail asks
 * for newSince (the employer's date OR the day the board first saw the
 * posting), so a posting the mail counted as new was missing from the badge.
 * And the headline summed the per-search counts with no sign that one of them
 * was the board's cap, so "10,000 new jobs" read as an exact figure.
 *
 * WHAT HOLDS NOW, mounted with the board faked: each badge probe sends
 * newSince = the search's watermark and no postedAfter; a headline that adds
 * a capped count prints "N+".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  bodies: [] as Array<Record<string, unknown>>,
  answer: (_b: Record<string, unknown>) => ({ total: 3 }) as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => q;
    q.limit = () => Promise.resolve({ data: h.rows, error: null });
    q.update = () => q;
    q.eq = () => Promise.resolve({ data: null, error: null });
    return q;
  };
  return { supabase: { from: () => chain() } };
});
vi.mock("@/lib/invoke-job-board", () => ({
  invokeJobBoard: vi.fn(async ({ body }: { body: Record<string, unknown> }) => { h.bodies.push(body); return { data: h.answer(body) }; }),
}));

import { SavedSearchesCard } from "@/components/account/SavedSearchesCard";

beforeEach(() => {
  h.rows = [
    { id: "a", name: "Nurse", params: { q: "nurse" }, last_seen_at: "2026-11-01T00:00:00Z", digest_opt_in: true, fit_threshold: 0, digest_cadence: "weekly" },
    { id: "b", name: "Anything", params: { q: "" }, last_seen_at: "2026-11-02T00:00:00Z", digest_opt_in: false, fit_threshold: 0, digest_cadence: "weekly" },
  ];
  h.bodies = [];
  h.answer = () => ({ total: 3 });
});
afterEach(cleanup);

describe("the badge probe", () => {
  it("asks for newSince at the search's own watermark, never postedAfter", async () => {
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    await waitFor(() => expect(h.bodies).toHaveLength(2));
    for (const b of h.bodies) {
      expect(b.countOnly).toBe(true);
      expect(b, "the badge counted by the employer's date alone").not.toHaveProperty("postedAfter");
    }
    expect(h.bodies.map((b) => b.newSince).sort()).toEqual(["2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"]);
  });
});

describe("the headline", () => {
  it("prints the exact sum when no count was capped", async () => {
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-new-headline]")).not.toBeNull());
    const el = document.querySelector("[data-new-headline]")!;
    expect(el.getAttribute("data-new-headline")).toBe("exact");
    expect(el.textContent).toMatch(/^6 new jobs match/);
  });

  it("says N+ when a count it adds is the board's cap", async () => {
    h.answer = (b) => (b.q === "nurse" ? { total: 10_000, countCapped: true } : { total: 12 });
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector('[data-new-headline="capped"]')).not.toBeNull());
    expect(document.querySelector("[data-new-headline]")!.textContent).toBe("10,012+ new jobs match your saved searches since your last visit");
  });
});
