// A ZERO PAGE NAMES THE EMPLOYER FROM THE OVERRIDE MAP (RC-OI-42).
//
// A company page's name comes from its rows (the stored company), else the
// list's company facet. A board whose system token is not a name (an Oracle
// "recruiting2~CON1074CVTG~…" site) has its name in the override map, but a
// page with no open roles has no row and no facet, so the override was never
// reached: the zero page headed itself, and titled itself, with the token.
// The override map is now the zero page's name too.
//
// Positive control first: a page with a row takes the row's name.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const TOKEN = "recruiting2~CON1074CVTG~1831b61a-1945-44fa-afd8-624795c9b30d";
const now = new Date().toISOString();
const job = (company: string) => ({
  id: `oracle:${TOKEN}:1`, source: "oracle", token: TOKEN, company, title: "Field Technician", location: "Chicago, IL, USA", country: "US",
  salary: null, workMode: "onsite", employmentType: "full_time", category: "engineering", agency: false,
  postedAt: now, lastSeen: now, recheckedAt: now, applyUrl: "https://x/1", remote: false,
});

function mount(jobs: ReturnType<typeof job>[]) {
  const path = `/jobs/company/${TOKEN}`;
  window.history.replaceState({}, "", path);
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: jobs.length } };
      return { data: { jobs, total: jobs.length, totalAllCompanies: jobs.length, companies: jobs.length ? [{ token: TOKEN, name: jobs[0].company, open: jobs.length }] : [], companiesCount: jobs.length ? 1 : 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false, unknownCompanies: [] } };
    }
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  document.title = "";
});

describe("a zero page names the employer from the override map", () => {
  it("positive control: a page with a row is headed by the row's name", async () => {
    mount([job("Convergint Technologies")]);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Convergint"), SLOW);
  });

  it("the page with no open role is headed and titled Convergint, not by its system token", async () => {
    mount([]);
    await waitFor(() => expect(document.title).toBe("Convergint jobs"), SLOW);
    const h1 = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(h1).toContain("Convergint");
    expect(h1).not.toContain("CON1074CVTG");
    expect(document.title).not.toContain("recruiting2");
  });
});
