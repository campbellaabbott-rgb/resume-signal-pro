// WHAT THE MY-JOBS VIEWS TOOK OFF THE PAGE.
//
// Saved / Hide viewed / Hide applied narrow rows the server already sent — the
// same kind of thing as a dismissal, which has printed "{{count}} hidden" beside
// the results since it shipped. The three toggles said nothing: a page of forty
// rows read "Showing 3 matching openings" with no trace of the 37 the reader's
// own switches removed, and the end card then offered wideners measured
// against a page nobody could see.
//
// The line prints the count AND names which toggle did it, in that toggle's
// own label, so the reader knows which switch to flip back. Zero is not a
// disclosure: the line renders only while the toggles remove something.
//
// Behavioural: the viewed record is seeded before mount (rb_viewed_jobs, the
// same localStorage key the page writes), the toggle is clicked, the sentence
// is read, the toggle is clicked again and the sentence is gone.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
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
const LOCALES = resolve(ROOT, "src/i18n/locales");
const jp = (f: string) => JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, unknown>;
const SLOW = { timeout: 4000 } as const;

const row = (id: string, title: string) => ({
  id, source: "greenhouse", token: "acme", company: "Acme", title, location: "Cambridge", country: "GB",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: null, employmentType: null, experienceBand: null, minYears: null,
  category: "engineering", department: null, remote: false,
  postedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
  recheckedAt: null, applyUrl: `https://x/${id}`,
});
const ROWS = [row("g:1", "Staff Engineer"), row("g:2", "Data Engineer"), row("g:3", "Platform Engineer")];

function mount() {
  window.history.replaceState({}, "", "/jobs");
  rpc.mockImplementation(async () => ({ data: [] }));
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: null, sources: null }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: 1, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}
const text = () => document.body.textContent ?? "";
const line = () => document.querySelector('[data-testid="hidden-by-views"]')?.textContent ?? null;

describe("what the my-jobs views took off the page", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("behaviour: Hide viewed says how many it hid and which toggle did it; off again, the line is gone", async () => {
    // Two of the three rows were opened on an earlier visit.
    localStorage.setItem("rb_viewed_jobs", JSON.stringify(["g:1", "g:3"]));
    mount();
    await waitFor(() => expect(text()).toContain("Data Engineer"), SLOW);
    // Nothing hidden yet: no line. Zero is not a disclosure.
    expect(line()).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Hide viewed" })[0]);
    await waitFor(() => expect(line()).toContain("2 hidden by Hide viewed"), SLOW);
    // The rows really are gone — the sentence describes the page.
    expect(text()).not.toContain("Staff Engineer");
    expect(text()).not.toContain("Platform Engineer");
    expect(text()).toContain("Data Engineer");
    fireEvent.click(screen.getAllByRole("button", { name: "Hide viewed" })[0]);
    await waitFor(() => expect(line()).toBeNull(), SLOW);
    expect(text()).toContain("Staff Engineer");
  });

  it("behaviour: a toggle that removes nothing prints nothing", async () => {
    // One row viewed, but it is not on this page — the toggle is on, hides
    // nothing, and the line must not say "0 hidden".
    localStorage.setItem("rb_viewed_jobs", JSON.stringify(["someone-else:9"]));
    mount();
    await waitFor(() => expect(text()).toContain("Data Engineer"), SLOW);
    fireEvent.click(screen.getAllByRole("button", { name: "Hide viewed" })[0]);
    await new Promise((r) => setTimeout(r, 200));
    expect(line()).toBeNull();
    expect(text()).not.toContain("0 hidden");
  });

  it("the key carries both placeholders in the English locales, and the count is interpolated, never spelled", () => {
    for (const f of ["en.json", "en-GB.json"]) {
      const s = String(jp(f).hiddenByViews ?? "");
      expect(s, `${f} lacks jobsPage.hiddenByViews`).not.toBe("");
      expect(s).toContain("{{count}}");
      expect(s).toContain("{{views}}");
      expect(s).not.toMatch(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
    }
  });
});
