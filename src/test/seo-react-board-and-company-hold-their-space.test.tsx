/**
 * THE BOARD AND THE COMPANY PAGE HOLD THEIR SPACE WHILE DATA ARRIVES (SEO-022, R9).
 *
 * Lab CLS, 2026-10-18 (local build of design/integration, 1280px): Domino's
 * 0.360 — the hiring-record card landed above the pay card in the rail
 * (0.166), then the header's answer line arrived under the H1 and moved the
 * page (0.193); /jobs 0.049 — the activity strip arrived as a second line of
 * the count paragraph and "posted today" wrapped to a third. After: Domino's
 * 0.013, /jobs 0.026 (src/test lab numbers are in the round's report).
 *
 *   - /jobs: the count paragraph reserves its final lines, and "posted today"
 *     rides the count line, before the strip.
 *   - the company header holds the answer line's place (a bar of its height)
 *     while the list loads, even when the name is already known;
 *   - the results line holds its place while the list loads;
 *   - the rail is laid out but not shown until its readers have answered (or a
 *     ceiling passes), then shown in one paint.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { createElement } from "react";
import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";
import { CompanyHeader } from "@/components/jobs/company/CompanyHeader";
import { CompanyResultsLine, RAIL_SETTLE_MAX_MS, useRailSettled } from "@/components/jobs/company/CompanyLander";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stub(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stub() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "@/pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "dominos", storedName: null, bakedName: "Domino's", cachedName: null,
  listTotal: null, listFloor: false, feedTotal: null, feedFloor: false, feedAsOf: null,
  boardReadAt: null, source: null, agency: false, collision: null, isUsajobs: false,
  loading: true, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
});

describe("the company page while its list loads", () => {
  it("holds the answer line's place under a known name, at the line's own height", () => {
    render(createElement(MemoryRouter, null, createElement(CompanyHeader, { model: buildLanderModel(input()), token: "dominos", system: null, boardReadAt: null, onWatch: () => {} })));
    expect(document.querySelector("h1")?.textContent).toBe("Domino's");
    const bar = document.querySelector("[data-company-answer-reserve]");
    expect(bar, "no reserved answer line while the list loads").not.toBeNull();
    expect(bar?.className).toMatch(/\bh-5\b/);
    expect(bar?.className).toMatch(/\bsm:h-6\b/);
  });

  it("holds the results line's place, and gives it up once the list has answered", () => {
    const { rerender } = render(createElement(CompanyResultsLine, { model: buildLanderModel(input()), shown: 0, boardReadAt: null }));
    expect(document.querySelector("[data-company-results-reserve]")).not.toBeNull();
    rerender(createElement(CompanyResultsLine, { model: buildLanderModel(input({ loading: false, listTotal: 0 })), shown: 0, boardReadAt: null }));
    expect(document.querySelector("[data-company-results-reserve]")).toBeNull();
  });

  it("shows the rail once its readers have answered, or after the ceiling", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ settled }) => useRailSettled(settled, "dominos"), { initialProps: { settled: false } });
    expect(result.current).toBe(false);
    rerender({ settled: true });
    expect(result.current).toBe(true);
    const late = renderHook(() => useRailSettled(false, "acme"));
    expect(late.result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(RAIL_SETTLE_MAX_MS + 1); });
    expect(late.result.current).toBe(true);
  });
});

describe("/jobs while its counts load", () => {
  it("a field page holds the field line's place until the field table has been read", async () => {
    invoke.mockImplementation(async () => ({ data: {}, error: null }));
    window.history.replaceState({}, "", "/jobs/field/engineering");
    render(<HelmetProvider><MemoryRouter initialEntries={["/jobs/field/engineering"]}><Routes><Route path="/jobs/field/:category" element={<Jobs />} /></Routes></MemoryRouter></HelmetProvider>);
    const reserve = document.querySelector("[data-field-line-reserve]");
    expect(reserve, "no reserved field line while the field table loads").not.toBeNull();
    expect(reserve?.className).toMatch(/min-h-\[128px\]/);
    expect(reserve?.className).toMatch(/lg:min-h-\[56px\]/);
    await waitFor(() => expect(document.querySelector("[data-field-line-reserve]")).toBeNull(), { timeout: 8000 });
  });

  it("reserves the count paragraph's final lines and puts 'posted today' on the count line", async () => {
    const DAY = 86_400_000;
    invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
      const b = a?.body ?? {};
      if (fn !== "job-board") return { data: {} };
      if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
      if (b.action === "list" && b.countOnly) return { data: { total: 1492 }, error: null };
      if (b.action === "list") return { data: { jobs: [], total: 0, totalAllCompanies: 1021877, companiesOpenCount: 31937, trackedTotal: 1031670, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: new Date(Date.now() - DAY).toISOString(), hasMore: false }, error: null };
      return { data: {} };
    });
    window.history.replaceState({}, "", "/jobs");
    render(<HelmetProvider><MemoryRouter initialEntries={["/jobs"]}><Routes><Route path="/jobs" element={<Jobs />} /></Routes></MemoryRouter></HelmetProvider>);
    const p = document.querySelector("[data-board-count-line]");
    expect(p, "the count paragraph renders before the counts arrive").not.toBeNull();
    expect(p?.className).toMatch(/min-h-\[3lh\]/);
    expect(p?.className).toMatch(/sm:min-h-\[2lh\]/);
    await waitFor(() => expect(document.querySelector("[data-board-new-today]")).not.toBeNull(), { timeout: 8000 });
    const kids = [...(p?.children ?? [])];
    const today = kids.findIndex((k) => k.hasAttribute("data-board-new-today"));
    const strip = kids.findIndex((k) => k.classList.contains("sm:block"));
    expect(strip, "the activity strip rendered").toBeGreaterThan(-1);
    expect(today, "'posted today' sits before the strip").toBeLessThan(strip);
  });
});
