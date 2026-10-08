// A SECONDARY BOARD'S LANDER KEEPS THE ONE CANONICAL THE BAKE CHOSE.
//
// An employer that runs several boards gets one indexable lander: the bake
// points every secondary board's canonical at the primary's
// (prerender-seo.mjs, "ONE EMPLOYER, TWO BOARDS, TWO IDENTICAL PAGES"). Once JS
// ran, the page rendered its own <SEO path=/jobs/company/<itself>>, React 19
// adopted nothing (it reuses a baked element only on an exact match) and the
// head carried TWO canonicals -- the bake's, pointing at the primary, and
// React's, pointing at itself -- and two descriptions. Live on
// pwc~wd3~crm_experienced_careers_site and maersk~wd3~Maersk_Manual.
//
// Mounted over a head seeded the way the bake writes it, and judged on what
// the head holds after the page has rendered.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
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
const SITE = "https://resumebooster.work";
const row = (token: string, i: number) => ({
  id: `workday:${token}:${1000 + i}`, token, company: "PwC", title: `Consultant ${i}`,
  location: "London, United Kingdom", salary: null, applyUrl: `https://x/${i}`, source: "workday",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
function mock() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const tok = (b.companies as string[] | undefined)?.[0] ?? "x";
      const rows = [row(tok, 0), row(tok, 1), row(tok, 2)];
      return { data: { jobs: rows, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
/** The bake's head for one lander: its canonical and its description. */
function seedBake(canonicalPath: string, description: string) {
  const l = document.createElement("link");
  l.rel = "canonical"; l.href = `${SITE}${canonicalPath}`;
  document.head.appendChild(l);
  const m = document.createElement("meta");
  m.name = "description"; m.content = description;
  document.head.appendChild(m);
}
const canonicals = () => [...document.head.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute("href"));
const descriptions = () => [...document.head.querySelectorAll('meta[name="description"]')].map((m) => m.getAttribute("content"));
const sweep = () => document.head.querySelectorAll('link[rel="canonical"], meta[name="description"]').forEach((n) => n.remove());
function mount(url: string) {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  sweep();
  mock();
});
// Unmount first: React must remove the head tags it owns itself.
afterEach(() => { cleanup(); sweep(); });

describe("a secondary board's lander keeps the one canonical the bake chose", () => {
  it("a secondary board: one canonical, the primary's, and one description", async () => {
    seedBake("/jobs/company/pwc~wd3~Global_Experienced_Careers", "Browse 2,119 open roles at PwC, pulled straight from PwC's own job board.");
    mount("/jobs/company/pwc~wd3~crm_experienced_careers_site");
    await waitFor(() => expect(document.body.textContent).toContain("Consultant 2"), SLOW);
    await waitFor(() => expect(canonicals().length, `two canonicals: ${canonicals().join(" | ")}`).toBe(1), SLOW);
    expect(canonicals()[0]).toBe(`${SITE}/jobs/company/pwc~wd3~Global_Experienced_Careers`);
    expect(descriptions().length, `two descriptions: ${descriptions().join(" | ")}`).toBe(1);
    // The one left is the page's own, not the bake's stale count.
    await waitFor(() => expect(descriptions()[0]).toMatch(/^Browse PwC's open roles/), SLOW);
  });

  it("positive control: a primary board keeps its own canonical, once", async () => {
    seedBake("/jobs/company/maersk~wd3~Maersk_Careers", "Browse open roles at Maersk.");
    mount("/jobs/company/maersk~wd3~Maersk_Careers");
    await waitFor(() => expect(document.body.textContent).toContain("Consultant 2"), SLOW);
    await waitFor(() => expect(canonicals()).toEqual([`${SITE}/jobs/company/maersk~wd3~Maersk_Careers`]), SLOW);
    expect(descriptions().length).toBe(1);
  });
});
