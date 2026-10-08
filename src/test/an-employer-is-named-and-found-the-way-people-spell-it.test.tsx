// AN EMPLOYER IS NAMED, AND FOUND, THE WAY PEOPLE SPELL IT.
//
// Two places where the board showed or matched a machine's spelling:
//   - the active-filter chip on a company lander read
//     companies.find(token)?.name ?? token, and `companies` is the 150-board
//     head facet (smallest open count ~495) -- so on nearly every lander the
//     chip said "Deloitte6" or "emqk~ca3~CX_1" while the rows on the same page
//     said "Deloitte";
//   - the employer typeahead's local filter was name.toLowerCase().includes(q),
//     so "dominos" found nothing though Domino's had 21,531 open roles, and
//     "chilis" missed Chili's. (The server's company-suggest has the same
//     defect; that half belongs to the job-board group. This is the half the
//     page can fix: its own fold, with the server's rule.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const HEAD = [
  { token: "dominos", name: "Domino's", open: 21531 },
  { token: "chilis", name: "Chili's", open: 1094 },
  { token: "acme", name: "Acme", open: 900 },
];
const row = (i: number, token: string, company: string) => ({
  id: `workday:${token}:${1000 + i}`, token, company, title: `Analyst ${i}`,
  location: "Vienna, Austria", salary: null, applyUrl: `https://x/${i}`, source: "workday",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
function mock() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    // The server's own suggest still misses the possessive (its half is the
    // job-board group's) -- so only the page's fold can find it here.
    if (b.action === "company-suggest") return { data: { companies: [] }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const tok = (b.companies as string[] | undefined)?.[0];
      const rows = tok === "Deloitte6" ? [row(0, "Deloitte6", "Deloitte"), row(1, "Deloitte6", "Deloitte")] : [row(0, "acme", "Acme")];
      return { data: { jobs: rows, total: rows.length, totalAllCompanies: 50, companies: HEAD, companiesCount: 3, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
/** The active-filter chips: buttons whose text ends in the clear mark. */
const chipTexts = () => Array.from(document.querySelectorAll("button"))
  .map((b) => (b.textContent ?? "").trim())
  .filter((s) => s.endsWith("×"));

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  mock();
});

describe("an employer is named, and found, the way people spell it", () => {
  it("a long-tail lander's chip names the employer, not the board token", async () => {
    window.history.replaceState({}, "", "/jobs/company/Deloitte6");
    render(
      <MemoryRouter initialEntries={["/jobs/company/Deloitte6"]}>
        <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.textContent).toContain("Analyst 1"), SLOW);
    await waitFor(() => expect(chipTexts()).toContain("Deloitte×"), SLOW);
    expect(chipTexts(), "the chip printed the raw board token").not.toContain("Deloitte6×");
  });

  it("the typeahead finds a possessive name typed without its apostrophe", async () => {
    window.history.replaceState({}, "", "/jobs");
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain("Analyst 0"), SLOW);
    const box = screen.getByLabelText("Employer") as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "dominos" } });
    await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent ?? "").join("|")).toContain("Domino's"), SLOW);
    fireEvent.change(box, { target: { value: "chilis" } });
    await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent ?? "").join("|")).toContain("Chili's"), SLOW);
    // Positive control: an ordinary substring still matches, and a miss is a miss.
    fireEvent.change(box, { target: { value: "acm" } });
    await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent ?? "").join("|")).toContain("Acme"), SLOW);
    expect(screen.getAllByRole("option").map((o) => o.textContent ?? "").join("|")).not.toContain("Domino's");
  });
});
