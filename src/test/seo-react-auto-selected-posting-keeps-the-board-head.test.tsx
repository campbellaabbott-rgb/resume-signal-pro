/**
 * THE POSTING A WIDE SCREEN OPENS BY ITSELF DOES NOT BECOME THE PAGE (found in
 * this round's hydration check, 2026-10-18).
 *
 * At 1280px the board opens its first card by itself. Rendered with scripts
 * at that width (local build of design/integration), /jobs and
 * /jobs/field/engineering ended with canonical
 * https://resumebooster.work/jobs?job=<the first card's id> and a JobPosting
 * block: the board's own page told a desktop crawler it was a duplicate of
 * one job. The company page had already stopped auto-selecting for exactly
 * this reason. The board keeps auto-selecting for the reader, and only a
 * posting the reader (or the address) chose rewrites the head.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";

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
const SLOW = { timeout: 8000 } as const;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const job = (n: number) => ({
  id: `greenhouse:acme:${n}`, source: "greenhouse", token: "acme", company: "Acme", title: `Nurse ${n}`, location: "Leeds, UK", country: "GB",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "healthcare", department: null, agency: false,
  postedAt: ago(2 * DAY), lastSeen: ago(DAY), recheckedAt: ago(60_000), applyUrl: `https://acme.example/${n}`, remote: false,
});
const JOBS = [job(1), job(2), job(3)];
const DESC = "We are hiring a staff nurse for our Leeds site, full time, on a ward with a strong team. ".repeat(4);

let matchMedia: typeof window.matchMedia;
beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  setLanderManifestForTests("*");
  matchMedia = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: /min-width:\s*1024px/.test(q), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn !== "job-board") return { data: {} };
    if (b.action === "detail") return { data: { job: JOBS.find((j) => j.id === b.id) ?? JOBS[0], description: DESC }, error: null };
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    if (b.action === "list" && (b.countOnly || b.facetCounts)) return { data: { total: 3, categories: {} }, error: null };
    if (b.action === "list") return { data: { jobs: JOBS, total: 3, totalAllCompanies: 3, companies: [{ token: "acme", name: "Acme", open: 3 }], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: ago(0), hasMore: false }, error: null };
    return { data: {} };
  });
  document.head.innerHTML = '<link rel="canonical" href="https://resumebooster.work/jobs">';
});
afterEach(() => { cleanup(); window.matchMedia = matchMedia; document.head.innerHTML = ""; });

const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");
const jobPostings = () => [...document.querySelectorAll('script[type="application/ld+json"]')].filter((s) => /"JobPosting"/.test(s.textContent ?? ""));

describe("the board at desktop width", () => {
  it("auto-selects its first card without making it the page's canonical or structured data", async () => {
    window.history.replaceState({}, "", "/jobs");
    render(<HelmetProvider><MemoryRouter initialEntries={["/jobs"]}><Routes><Route path="/jobs" element={<Jobs />} /></Routes></MemoryRouter></HelmetProvider>);
    // The auto-select opened the first posting (the address names it).
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("job")).toBe(JOBS[0].id), SLOW);
    await waitFor(() => expect(invoke.mock.calls.some(([, o]) => (o as { body?: { action?: string } })?.body?.action === "detail")).toBe(true), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(canonical()).not.toMatch(/\?job=/);
    expect(jobPostings()).toEqual([]);
  });

  it("positive control: a posting the reader opens does take over the head", async () => {
    window.history.replaceState({}, "", "/jobs");
    render(<HelmetProvider><MemoryRouter initialEntries={["/jobs"]}><Routes><Route path="/jobs" element={<Jobs />} /></Routes></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("job")).toBe(JOBS[0].id), SLOW);
    const second = (await screen.findAllByText("Nurse 2", undefined, SLOW))[0];
    fireEvent.click(second);
    await waitFor(() => expect(canonical()).toBe(`https://resumebooster.work/jobs?job=${encodeURIComponent(JOBS[1].id)}`), SLOW);
    await waitFor(() => expect(jobPostings().length).toBe(1), SLOW);
  });
});
