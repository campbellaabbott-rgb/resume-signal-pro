// A DELIBERATE FALLBACK MUST NOT READ AS AN OUTAGE.
//
// The board's sort line has exactly one job: say truthfully how the rows in
// front of the reader were ordered. It had two answers — "Sorted by relevance
// — title matches first" when the response carried `ranked`, and "Sorted by
// newest first (relevance ranking briefly unavailable)" when it did not.
//
// The second sentence is the ONLY place a ranked-path outage becomes visible
// to anyone, and that matters because ranked search has been fully down and
// silent before (a hoisted function reading a const out of the TDZ; every
// query quietly served recency for weeks). A sentence that cries outage on a
// healthy board is worth nothing as a signal.
//
// The exact whole-word rescue tier used to stamp `ranked: true` on its
// responses, which was false — it concatenates two `ORDER BY effective_posted
// DESC` reads and scores nothing. Removing that claim was right, and it
// immediately made this line lie in the other direction: a tier that answered
// perfectly well, and that the page already names a few hundred lines up
// ("Showing exact whole-word matches for …"), started reporting that relevance
// ranking was unavailable.
//
// So there are three states now, and the point of this guard is that the
// deliberate one and the broken one must never render the same words.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [] }),
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

const ROOT = resolve(__dirname, "../..");
const LOCALE_DIR = resolve(ROOT, "src/i18n/locales");
const SLOW = { timeout: 4000 } as const;

const ROWS = Array.from({ length: 3 }, (_, i) => ({
  id: `j${i}`, company: `Employer ${i}`, title: `Nurse Role ${i}`, location: "Remote",
  salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
}));

function boardMock(extra: Record<string, unknown>) {
  invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
    const b = opts?.body ?? {};
    if (fn !== "job-board" || b.action !== "list") return { data: null };
    if (b.facetCounts) return { data: { categories: {} } };
    if (b.countOnly) return { data: { total: 0 } };
    return {
      data: {
        jobs: ROWS, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0,
        categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        ...extra,
      },
    };
  });
}

/** Mount and search, so the sort line (query-only) renders. */
async function search(extra: Record<string, unknown>) {
  boardMock(extra);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  await waitFor(() => expect(invoke).toHaveBeenCalled(), SLOW);
  fireEvent.change(screen.getByPlaceholderText(/Title or keyword/i), { target: { value: "nurse" } });
  await waitFor(() => expect(document.body.textContent).toMatch(/Sorted by/), SLOW);
  return (document.body.textContent ?? "").match(/Sorted by[^·]*/)?.[0]?.trim() ?? "";
}

describe("a deliberate fallback must not read as an outage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset();
  });

  it("behaviour: the three orderings render three different sentences", async () => {
    const ranked = await search({ ranked: true });
    document.body.innerHTML = "";
    invoke.mockReset();
    const exact = await search({ exactWordMatch: "nurse" });
    document.body.innerHTML = "";
    invoke.mockReset();
    const broken = await search({});

    expect(ranked).toMatch(/relevance/i);
    // THE ASSERTION THIS FILE EXISTS FOR.
    expect(exact, "the exact-word tier is reporting an outage that did not happen").not.toBe(broken);
    expect(exact, "a deliberate tier must not claim anything is unavailable").not.toMatch(/unavailable/i);
    expect(broken, "the ranked-path outage signal has been diluted").toMatch(/unavailable/i);
    // All three distinct — a state that cannot be told apart is not disclosed.
    expect(new Set([ranked, exact, broken]).size).toBe(3);
  });

  it("behaviour: the exact-word line still says the rows are newest-first, because they are", async () => {
    // The tier concatenates two `ORDER BY effective_posted DESC` reads. Saying
    // so is the whole content of the disclosure.
    const exact = await search({ exactWordMatch: "nurse" });
    expect(exact).toMatch(/newest first/i);
    // ...and the page still names the tier itself, separately.
    expect(document.body.textContent).toMatch(/exact whole-word matches for/i);
  });

  it("behaviour: a ranked page is unaffected — the new branch must not swallow it", async () => {
    const ranked = await search({ ranked: true });
    expect(ranked).toMatch(/Sorted by relevance/i);
    expect(ranked).not.toMatch(/unavailable/i);
  });

  it("the new string is translated in all nine locales, and not left in English", () => {
    const en = JSON.parse(readFileSync(resolve(LOCALE_DIR, "en.json"), "utf8")).jobsPage;
    const files = readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length, "expected nine locale files").toBe(9);
    for (const f of files) {
      const jp = JSON.parse(readFileSync(resolve(LOCALE_DIR, f), "utf8")).jobsPage ?? {};
      expect(typeof jp.sortedExactWord, `${f}: jobsPage.sortedExactWord is missing`).toBe("string");
      expect(String(jp.sortedExactWord).trim().length, `${f}: jobsPage.sortedExactWord is empty`).toBeGreaterThan(0);
      // Distinct from the outage sentence in EVERY language, not just English —
      // a translator who reused the fallback string would undo the whole fix.
      expect(jp.sortedExactWord, `${f}: the deliberate tier and the outage read identically`).not.toBe(jp.sortedNewestFallback);
    }
    for (const f of ["de.json", "es.json", "fr.json", "nl.json", "pt.json", "hi.json", "tl.json"]) {
      const jp = JSON.parse(readFileSync(resolve(LOCALE_DIR, f), "utf8")).jobsPage;
      expect(jp.sortedExactWord, `${f} still holds the English text`).not.toBe(en.sortedExactWord);
    }
  });
});
