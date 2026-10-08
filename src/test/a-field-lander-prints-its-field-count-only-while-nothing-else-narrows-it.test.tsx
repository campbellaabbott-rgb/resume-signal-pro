// A FIELD LANDER PRINTS ITS FIELD COUNT ONLY WHILE NOTHING ELSE NARROWS IT.
//
// /jobs/field/healthcare's headline number is the field's serving facet. The
// server keeps sending that facet BOARD-WIDE on a filtered request (live:
// {category:healthcare, q:'night shift'} total 568 with categories
// {healthcare: 96,826}), and the lander returned its category for the count
// line unconditionally -- skipping the "nothing else narrows the page" rule
// every other category reader obeys. So typing "night shift" printed
// "96,826 live Healthcare openings" above "Showing 60 of 568 matching".
//
// The positive control first: the unnarrowed lander prints the facet. Then one
// variable changes (a query, then a country) and the number must go -- and the
// board-wide "live openings from N company feeds" line must not stand in for
// it under an H1 that names a field.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, act } from "@testing-library/react";
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
const row = (i: number) => ({
  id: `greenhouse:mercy:${1000 + i}`, token: "mercy", company: "Mercy", title: `Night Nurse ${i}`, category: "healthcare",
  location: "Leeds, United Kingdom", country: "GB", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
function mock() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 568 }, error: null };
      if (b.facetCounts) return { data: { categories: { healthcare: 568 } }, error: null };
      const narrowed = !!b.q || !!b.country;
      return {
        data: {
          jobs: Array.from({ length: 6 }, (_, i) => row(i)),
          total: narrowed ? 568 : 10000, countCapped: !narrowed,
          totalAllCompanies: 815909, companiesOpenCount: 24931,
          // The facet the server sends board-wide on every request.
          categories: { healthcare: 96826 },
          companies: [], companiesCount: 0, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: true,
        },
        error: null,
      };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const mount = (url: string) => {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/jobs/field/:category" element={<Jobs />} /></Routes>
    </MemoryRouter>,
  );
};
const hero = () => document.querySelector("main h1")?.parentElement?.parentElement?.textContent ?? "";
const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list"
    && !(o as { body?: Body }).body?.countOnly && !(o as { body?: Body }).body?.facetCounts)
  .map(([, o]) => (o as { body: Body }).body);
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  mock();
});

describe("a field lander prints its field count only while nothing else narrows it", () => {
  it("positive control: the unnarrowed lander prints the field's facet", async () => {
    mount("/jobs/field/healthcare");
    await waitFor(() => expect(document.body.textContent).toMatch(/96,826 live .* openings/), SLOW);
  });

  it("a query typed on the lander takes the field's board-wide number away", async () => {
    mount("/jobs/field/healthcare");
    await waitFor(() => expect(document.body.textContent).toMatch(/96,826 live/), SLOW);
    fireEvent.change(document.getElementById("board-search") as HTMLInputElement, { target: { value: "night shift" } });
    await waitFor(() => expect(listBodies().some((b) => b.q === "night shift")).toBe(true), SLOW);
    await settle(100);
    expect(document.body.textContent, "the board-wide field count printed over a narrowed search").not.toMatch(/96,826/);
    expect(document.body.textContent, "the board-wide total stood in under a field H1").not.toMatch(/815,909 live openings/);
  });

  it("a country on the lander does the same", async () => {
    mount("/jobs/field/healthcare?country=GB");
    await waitFor(() => expect(listBodies().some((b) => b.country === "GB")).toBe(true), SLOW);
    await waitFor(() => expect(document.body.textContent).toContain("Night Nurse 5"), SLOW);
    await settle(100);
    expect(document.body.textContent).not.toMatch(/96,826/);
    expect(document.body.textContent).not.toMatch(/815,909 live openings/);
  });
});
