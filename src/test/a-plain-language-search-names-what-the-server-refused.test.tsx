// A PLAIN-LANGUAGE SEARCH NAMES WHAT THE SERVER REFUSED.
//
// nl-search validates the model's tool call (validateParse): an out-of-list
// category, a salary floor of "150k", maxYears 25, a ceiling below the floor
// -- each is LEFT OUT of `filters` and named in `dropped`, and every filter
// that survived is named in `applied`. The page read neither. It printed the
// model's own `interpreted` chips -- including the chip for the filter that
// was refused -- under "Read as:", so the interpretation line stated filters
// the board never applied.
//
// Positive control first: with nothing dropped, the model's chips stand.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
const row = (i: number) => ({
  id: `greenhouse:acme:${1000 + i}`, token: "acme", company: "Acme", title: `Nurse ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
function mock(nl: unknown) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn === "nl-search") return { data: nl, error: null };
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [row(0), row(1), row(2)], total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
async function askInPlainLanguage(sentence: string) {
  window.history.replaceState({}, "", "/jobs");
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  await waitFor(() => expect(document.body.textContent).toContain("Nurse 2"), SLOW);
  fireEvent.click(screen.getByRole("button", { name: "Search in plain language" }));
  const box = screen.getByPlaceholderText(/remote product roles/);
  fireEvent.change(box, { target: { value: sentence } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(document.body.textContent).toContain("Read as:"), SLOW);
}
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});

describe("a plain-language search names what the server refused", () => {
  it("positive control: nothing refused, the model's chips stand", async () => {
    mock({ filters: { q: "nurse", workMode: "remote" }, applied: ["q", "workMode"], dropped: [], interpreted: ["Nurse", "Remote"], notMapped: [] });
    await askInPlainLanguage("remote nurse jobs");
    expect(text()).toContain("Nurse");
    expect(screen.getAllByText("Remote").length).toBeGreaterThan(0);
    expect(text()).not.toMatch(/Couldn't apply/);
  });

  it("a refused filter is named as refused, and no chip claims it", async () => {
    mock({
      filters: { q: "nurse" },
      applied: ["q"],
      dropped: ["salaryFloor", "category"],
      interpreted: ["Nurse", "$150k+ salary", "Astronautics field"],
      notMapped: [],
    });
    await askInPlainLanguage("nurse astronautics over 150k");
    expect(text(), "a refused filter's chip still claimed it was read").not.toContain("$150k+ salary");
    expect(text()).not.toContain("Astronautics field");
    expect(text()).toMatch(/Couldn't apply: pay floor, field/);
  });
});
