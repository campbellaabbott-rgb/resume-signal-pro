// A POSTING WE CANNOT READ IS NOT ONE WE HOLD NO DESCRIPTION FOR (S14X-052).
//
// fit-batch answered null for two different postings: one with no stored
// description, and one whose description we hold but in which the scorer
// recognised no skill or tool (a posting in German, say: the scorer reads
// English keywords). The board printed "we hold no description for this
// posting" for both, which was false for the second. job-fit now sends the
// reason beside each null (`unscored`), and the card and the panel say which.
// A job-fit that sends no reason (the build before this round) reads as
// before: the old sentence, which is true for most nulls.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { unscoredReason, FIT_MIN_DESCRIPTION_CHARS } from "../../supabase/functions/job-fit/score-rows";

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

vi.setConfig(MOUNT_TEST_BUDGET);
const RESUME = "registered nurse ".repeat(20);

const ROWS = [
  { id: "j2", company: "Gamma", title: "Pflegefachkraft", location: "Berlin, Germany", salary: null, applyUrl: "https://x/2", source: "greenhouse", token: "gamma", postedAt: null },
  { id: "j1", company: "Beta", title: "Described Role", location: "Remote", salary: null, applyUrl: "https://x/1", source: "greenhouse", token: "beta", postedAt: null },
];

function mount(opts: { withReason: boolean }) {
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: [] } };
    if (fn === "job-fit" && b.action === "fit-batch") {
      const ids = (b.ids as string[]) ?? [];
      const fits = Object.fromEntries(ids.map((id) => [id, id === "j1" ? 62 : null]));
      return { data: opts.withReason
        ? { fits, unscored: { j2: "no_recognised_terms" }, missing: {}, matched: {} }
        : { fits, missing: {}, matched: {} } };
    }
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return { data: { jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement | null;
const dropResume = () =>
  fireEvent.change(fileInput()!, { target: { files: [new File([RESUME], "cv.txt", { type: "text/plain" })] } });
const text = () => document.body.textContent ?? "";

describe("the reason a row has no score (job-fit/score-rows.ts)", () => {
  it("no stored description, or one at or under the bound, is no_description", () => {
    expect(unscoredReason(null, null)).toBe("no_description");
    expect(unscoredReason("x".repeat(FIT_MIN_DESCRIPTION_CHARS), null)).toBe("no_description");
  });
  it("a description we hold in which nothing was recognised is no_recognised_terms", () => {
    expect(unscoredReason("Wir suchen eine Pflegefachkraft ".repeat(10), null)).toBe("no_recognised_terms");
  });
  it("a scored row has no reason, a zero included", () => {
    expect(unscoredReason("x".repeat(400), 0)).toBeNull();
    expect(unscoredReason("x".repeat(400), 62)).toBeNull();
  });
});

describe("a posting we cannot read is not one we hold no description for", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset();
  });

  it("the panel says we cannot read its terms, and does not say we hold no description", async () => {
    window.history.replaceState({}, "", "/jobs?job=j2");
    mount({ withReason: true });
    await waitFor(() => expect(fileInput()).not.toBeNull(), SLOW);
    dropResume();
    await waitFor(() => expect(text()).toContain("Not scored — we can't read this posting's terms yet"), SLOW);
    expect(text()).not.toContain("we hold no description for this posting");
    expect(document.querySelector('[data-unscored="no_recognised_terms"]')).not.toBeNull();
  });

  it("the card's not-scored chip says the same in its tip", async () => {
    window.history.replaceState({}, "", "/jobs");
    mount({ withReason: true });
    await waitFor(() => expect(fileInput()).not.toBeNull(), SLOW);
    dropResume();
    await waitFor(() => expect(screen.queryAllByText("Not scored").length).toBe(1), SLOW);
    const chip = screen.getByText("Not scored").closest("[title]") as HTMLElement;
    expect(chip.getAttribute("title")).toMatch(/we hold this posting's description, but the scorer recognised no skill or tool/);
  });

  it("a job-fit that sends no reason reads as before", async () => {
    window.history.replaceState({}, "", "/jobs?job=j2");
    mount({ withReason: false });
    await waitFor(() => expect(fileInput()).not.toBeNull(), SLOW);
    dropResume();
    await waitFor(() => expect(text()).toContain("Not scored — we hold no description for this posting"), SLOW);
    expect(text()).not.toContain("can't read this posting's terms");
  });
});
