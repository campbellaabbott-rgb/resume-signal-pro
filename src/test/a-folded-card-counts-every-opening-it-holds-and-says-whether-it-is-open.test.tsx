/**
 * A FOLDED CARD COUNTS EVERY OPENING IT HOLDS, AND SAYS WHETHER IT IS OPEN
 * (sweep S12-048).
 *
 * The server folds one employer's same-title postings into one card and lists
 * at most GROUP_SIBLINGS_MAX (50) of them. The card's toggle counted the LISTED
 * siblings, so Cinemark's "Theatre Team Member" (98 postings, live 2026-11-01)
 * read "50 more openings of this role" collapsed. The toggle now counts the
 * postings the card stands for, says "locations" only when every one is a
 * different place, and carries aria-expanded and aria-controls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;
const now = new Date().toISOString();
const base = (id: string, title: string, location: string) => ({
  id, source: "workday", token: "cinemark~wd1~cinemark", company: "Cinemark", title, location, country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: null, employmentType: null, experienceBand: null, minYears: null, category: "hospitality", department: null,
  postedAt: now, lastSeen: now, recheckedAt: now, applyUrl: `https://apply.example/${id}`, remote: false,
});
// 98 postings in 98 places, 50 of them listed: the live shape.
const team = {
  ...base("workday:cinemark~wd1~cinemark:team-0", "Theatre Team Member", "Plano, TX"),
  postingCount: 98, locationCount: 98, otherLocations: ["Dallas, TX"],
  siblings: Array.from({ length: 50 }, (_, i) => ({ id: `workday:cinemark~wd1~cinemark:team-${i + 1}`, location: `Town ${i + 1}, TX`, applyUrl: `https://apply.example/team-${i + 1}`, postedAt: now })),
};
// 30 postings in 4 places, 29 listed: openings, not locations.
const cook = {
  ...base("workday:cinemark~wd1~cinemark:cook-0", "Line Cook", "Plano, TX"),
  postingCount: 30, locationCount: 4, otherLocations: ["Dallas, TX"],
  siblings: Array.from({ length: 29 }, (_, i) => ({ id: `workday:cinemark~wd1~cinemark:cook-${i + 1}`, location: ["Dallas, TX", "Austin, TX", "Waco, TX"][i % 3], applyUrl: `https://apply.example/cook-${i + 1}`, postedAt: now })),
};

beforeEach(() => {
  window.history.replaceState({}, "", "/jobs");
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board" || b.action !== "list") return { data: {} };
    if (b.facetCounts) return { data: { categories: {} } };
    if (b.countOnly) return { data: { total: 128 } };
    return { data: { jobs: [team, cook], total: 128, totalAllCompanies: 128, companies: [], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
  });
});

const toggleOf = (title: string) => {
  const card = Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]")).find((c) => (c.textContent ?? "").includes(title))!;
  return Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find((b) => /more (openings|locations)|other (openings|locations)/i.test(b.textContent ?? ""))!;
};

describe("a folded card", () => {
  it("counts the postings it stands for, not the ones listed, and names places only when every one is a place", async () => {
    render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
    await waitFor(() => expect(toggleOf("Theatre Team Member")).toBeTruthy(), SLOW);
    expect(toggleOf("Theatre Team Member").textContent).toBe("Same role in 97 more locations");
    expect(toggleOf("Line Cook").textContent).toBe("29 more openings of this role");
  });

  it("tells a screen reader whether it is open, and which list it opens", async () => {
    render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
    await waitFor(() => expect(toggleOf("Theatre Team Member")).toBeTruthy(), SLOW);
    const btn = toggleOf("Theatre Team Member");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    await waitFor(() => expect(toggleOf("Theatre Team Member").getAttribute("aria-expanded")).toBe("true"), SLOW);
    const list = document.getElementById(toggleOf("Theatre Team Member").getAttribute("aria-controls") ?? "");
    expect(list, "aria-controls names no element").not.toBeNull();
    expect(list!.querySelectorAll("li").length).toBe(51); // 50 listed, and the link to all 98
    expect(list!.textContent).toContain("See all 98 openings of this role");
  });
});
