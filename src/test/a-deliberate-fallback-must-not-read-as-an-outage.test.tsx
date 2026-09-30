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
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
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
// THE WAITING BUDGET, and why it is not a number chosen here: helpers/mount-
// budget.ts. SLOW was 4000 under vitest's default 5000 ms per-test budget,
// so a stuck wait could only be reported as "Test timed out in 5000ms",
// naming nothing. The slowest case measured 873 ms on the 2026-09-30 loaded
// run -- the most headroom here, and it takes the shared policy so there is
// one number to change, not eleven.
vi.setConfig(MOUNT_TEST_BUDGET);

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

/**
 * Mount and search, so the sort line (query-only) renders.
 *
 * READ FROM THE SLOT, NOT FROM A PROSE PREFIX. This used to wait for the text
 * "Sorted by" and then slice the page text from there — which located the sentence
 * only while every arm of the claim began with those two words. Two arms have since
 * been CORRECTED to stop claiming a sort they do not perform (the exact-word tier
 * and the recency fall-through both order by `effective_posted`, our crawl stamp,
 * so they now say "Ordered by when we first saw each posting" and "Exact whole-word
 * matches…"), and the helper stopped finding them. A guard that breaks when the
 * copy becomes true is worse than no guard. `data-sort-claim` marks the slot; every
 * assertion below is still about the words in it.
 */
async function search(extra: Record<string, unknown>) {
  boardMock(extra);
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  await waitFor(() => expect(invoke).toHaveBeenCalled(), SLOW);
  fireEvent.change(screen.getByPlaceholderText(/Title or keyword/i), { target: { value: "nurse" } });
  await waitFor(() => expect(document.querySelector("[data-sort-claim]")?.textContent ?? "").not.toBe(""), SLOW);
  const el = document.querySelector("[data-sort-claim]");
  return (el?.textContent ?? "").split("·")[0].trim();
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

  it("behaviour: the exact-word line names OUR date, because that is the order it has", async () => {
    /* THIS CASE ASSERTED THE FALSEHOOD. It required the sentence to say "newest
     * first", on the reasoning that the tier's two reads are date-ordered — but
     * they are `ORDER BY effective_posted DESC`, and effective_posted is
     * `coalesce(posted_at, first_seen)`: for every posting the employer never
     * dated it is OUR CRAWL STAMP. "Newest first" over that is the claim this
     * build exists to retire, and the two reads are not even globally ordered
     * relative to each other. `jobsPage.sortedExactWord` ("Sorted by newest first
     * — exact whole-word matches, not relevance-ranked") is deleted from all nine
     * locales rather than edited, because a locale value overrides an inline
     * default.
     *
     * So the disclosure's content is now: which tier ran, and WHOSE date the rows
     * are in. */
    const exact = await search({ exactWordMatch: "nurse" });
    expect(exact, "the retired claim is back: these rows are not in the employer's date order")
      .not.toMatch(/newest first/i);
    expect(exact, "the tier must name the order it actually has").toMatch(/when we first saw each posting/i);
    expect(exact, "and say the date is ours, not the employer's").toMatch(/our date, not the employer's/i);
    expect(exact, "and that it is not relevance-ranked").toMatch(/not relevance-ranked/i);
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
      // THE RENAMED KEYS. `sortedExactWord` and `sortedNewestFallback` both began
      // "Sorted by newest first" over an effective_posted order and are DELETED
      // from every locale, not edited — an edited English default is overridden by
      // eight untouched translations. Their replacements name whose date the rows
      // carry.
      expect(jp.sortedExactWord, `${f} still carries the retired jobsPage.sortedExactWord`).toBeUndefined();
      expect(jp.sortedNewestFallback, `${f} still carries the retired jobsPage.sortedNewestFallback`).toBeUndefined();
      expect(typeof jp.sortedExactWordDiscovery, `${f}: jobsPage.sortedExactWordDiscovery is missing`).toBe("string");
      expect(String(jp.sortedExactWordDiscovery).trim().length, `${f}: jobsPage.sortedExactWordDiscovery is empty`).toBeGreaterThan(0);
      expect(typeof jp.sortedDiscoveryFallback, `${f}: jobsPage.sortedDiscoveryFallback is missing`).toBe("string");
      // Distinct from the outage sentence in EVERY language, not just English —
      // a translator who reused the fallback string would undo the whole fix.
      expect(jp.sortedExactWordDiscovery, `${f}: the deliberate tier and the outage read identically`).not.toBe(jp.sortedDiscoveryFallback);
    }
    for (const f of ["de.json", "es.json", "fr.json", "nl.json", "pt.json", "hi.json", "tl.json"]) {
      const jp = JSON.parse(readFileSync(resolve(LOCALE_DIR, f), "utf8")).jobsPage;
      expect(jp.sortedExactWordDiscovery, `${f} still holds the English text`).not.toBe(en.sortedExactWordDiscovery);
      expect(jp.sortedDiscoveryFallback, `${f} still holds the English text`).not.toBe(en.sortedDiscoveryFallback);
    }
  });
});
