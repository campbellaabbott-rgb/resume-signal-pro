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
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toastSpy(...a), useToast: () => ({ toast: toastSpy, toasts: [] }) }));
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
  toastSpy.mockReset();
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

// ── What the page does with a refusal, an empty reading and a sort ──────────
//
// S14X-293: a refused parse (the gateway busy, the spend gate's daily cap)
// toasted "Couldn't read that", which blamed the sentence; the gate's own
// sentence was thrown away; and the words typed were lost. Now the gate's
// sentence is shown as it was sent, an unavailable parse says so and offers
// to search the words as keywords. NB-23 (the page's half): a reading that
// binds no filter changes no filter. S14X-292: "newest" read from a sentence
// with a query in it is the newest-first order, as the sort control means it.

type NlToast = { title?: string; action?: { label: string; onClick: () => void } };
const lastToast = () => toastSpy.mock.calls.at(-1)?.[0] as NlToast | undefined;
/** supabase-js's non-2xx shape: the Response rides on error.context. */
const refusedWith = (status: number, body: unknown) =>
  ({ __refused: true, error: { name: "FunctionsHttpError", message: "non-2xx", context: new Response(JSON.stringify(body), { status }) } });
function mockRefusal(nl: { __refused: true; error: unknown } | Record<string, unknown>) {
  mock(null);
  const board = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn === "nl-search") return "__refused" in nl ? { data: null, error: nl.error } : { data: nl, error: null };
    return board(fn, o);
  });
}
async function askOnly(sentence: string, url = "/jobs") {
  window.history.replaceState({}, "", url);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  await waitFor(() => expect(document.body.textContent).toContain("Nurse 2"), SLOW);
  fireEvent.click(screen.getByRole("button", { name: "Search in plain language" }));
  const box = screen.getByPlaceholderText(/remote product roles/);
  fireEvent.change(box, { target: { value: sentence } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(toastSpy).toHaveBeenCalled(), SLOW);
}

describe("a plain-language search that could not be read says why, and keeps the words", () => {
  it("an unavailable parse says so, and offers the words as a keyword search", async () => {
    mockRefusal(refusedWith(502, { error: "Parse unavailable", gatewayStatus: 503, reason: "unavailable" }));
    await askOnly("night shift icu nurse");
    expect(lastToast()?.title).toBe("Plain-language search is unavailable right now.");
    expect(lastToast()?.action?.label).toBe("Search these words instead");
    act(() => lastToast()!.action!.onClick());
    await waitFor(() => expect((document.getElementById("board-search") as HTMLInputElement).value).toBe("night shift icu nurse"), SLOW);
  });

  it("the spend gate's own sentence is shown as it was sent", async () => {
    const sentence = "Plain-language search is limited to 25 a day for each visitor; it resets at midnight UTC.";
    mockRefusal(refusedWith(429, { error: sentence, code: "daily_cap", limit: 25, retryable: false }));
    await askOnly("remote nurse jobs");
    expect(lastToast()?.title, "the gate's sentence was replaced by a blame on the reader's words").toBe(sentence);
  });

  it("control: a parse that failed for no stated reason keeps the old sentence", async () => {
    mockRefusal(refusedWith(500, { error: "Parse failed", reason: "unavailable" }));
    await askOnly("remote nurse jobs");
    expect(lastToast()?.title).toBe("Couldn't read that — try the filters below instead.");
  });

  it("a reading that binds no filter changes no filter (NB-23)", async () => {
    mockRefusal({ filters: {}, applied: [], dropped: [], interpreted: [], notMapped: [] });
    await askOnly("something no filter maps to", "/jobs?category=healthcare");
    expect(lastToast()?.title).toBe("Nothing in that sentence matched a filter, so your filters are unchanged.");
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(new URLSearchParams(window.location.search).get("category"), "an empty reading cleared the reader's field").toBe("healthcare");
  });

  it("'newest' read from a sentence with a query is the newest-first order (S14X-292)", async () => {
    mock({ filters: { q: "nurse", sort: "newest" }, applied: ["q", "sort"], dropped: [], interpreted: ["Nurse", "Newest first"], notMapped: [] });
    await askInPlainLanguage("newest nurse jobs");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("sort")).toBe("newest"), SLOW);
  });
});
