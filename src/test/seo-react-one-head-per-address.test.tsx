/**
 * ONE HEAD PER ADDRESS, WHOEVER RENDERS IT (SEO-007, R3).
 *
 * The bake and React wrote different titles and descriptions for the same
 * company, field and /jobs addresses: /jobs/company/dominos baked "Domino's
 * jobs: 23,789 open roles from their own hiring system" and React replaced it
 * with "Domino's jobs: open roles from their own hiring system"; an agency's
 * page baked "roles listed by a staffing agency" while React (with no agency
 * branch) said "open roles from their own hiring system". So a crawler that
 * runs no scripts and one that does read two heads.
 *
 *   1. React's company heads come from src/lib/seo/board-heads.ts, held here
 *      equal to the bake's own builder (companyLanderPage in
 *      scripts/prerender-pages.mjs) for every kind, with and without a count.
 *   2. Mounted over a baked file for its own address, the lander keeps the
 *      baked title and description: one title element, unchanged.
 *   3. With no baked head (an SPA navigation), an agency's board gets the
 *      agency sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import i18n from "@/i18n";
import { companyLanderPage, LANDER_KIND_COPY } from "../../scripts/prerender-pages.mjs";
import { companyBoardHead, type HeadT } from "@/lib/seo/board-heads";
import { possessive } from "@/lib/company-display";
import { resetBakedHeadForTests } from "@/components/seo/baked-head";

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
const SLOW = { timeout: 6000 } as const;

const enT: HeadT = (key, defaultValue, vars) => i18n.t(key, { defaultValue, ...(vars ?? {}), lng: "en" });
const fmt = (n: number) => n.toLocaleString("en-US");
const esc = (s: string) => s;

describe("the company head builder is the bake's", () => {
  const cases: Array<{ kind: "employer" | "agency" | "usajobs"; name: string; openN: number | null }> = [
    { kind: "employer", name: "Domino's", openN: 23789 },
    { kind: "employer", name: "Domino's", openN: null },
    { kind: "employer", name: "The Very Long Employer Name Of Many Words Incorporated", openN: 1234 },
    { kind: "agency", name: "Surge Staffing", openN: 308 },
    { kind: "agency", name: "Surge Staffing", openN: null },
    { kind: "usajobs", name: LANDER_KIND_COPY.usajobsH1, openN: 13926 },
  ];
  it.each(cases)("$kind, $name, count $openN", ({ kind, name, openN }) => {
    const baked = companyLanderPage({
      token: "tok", name, primaryToken: "tok", openN, facts: null, sources: "Workday", boardCompanies: null,
      site: "https://resumebooster.work", esc, possessive, fmt, href: (t: string) => `/jobs/company/${t}`, kind,
    });
    const react = companyBoardHead({
      kind, name, possessive: possessive(name), n: openN === null ? null : fmt(openN), t: enT,
      usajobsH1: i18n.t("companyProfile.usajobs.h1", { lng: "en" }),
      capLine: i18n.t("companyProfile.usajobs.cap", { cap: fmt(LANDER_KIND_COPY.usajobsCapValue), lng: "en" }),
    });
    expect(react).toEqual({ title: baked.title, description: baked.description });
  });
});

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const job = (token: string, company: string, n: number, agency = false) => ({
  id: `greenhouse:${token}:${n}`, source: "greenhouse", token, company, title: `Role ${n}`, location: "New York, NY, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "engineering", department: null, agency,
  postedAt: ago(2 * DAY), lastSeen: ago(2 * DAY), recheckedAt: ago(60_000), applyUrl: `https://x/${n}`, remote: false,
});
function answer(token: string, jobs: ReturnType<typeof job>[], total: number) {
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total } };
      return { data: { jobs, total, totalAllCompanies: total, companies: [{ token, name: jobs[0].company, open: total }], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: ago(0), hasMore: false, unknownCompanies: [] } };
    }
    return { data: {} };
  });
}
function mount(path: string) {
  window.history.replaceState({}, "", path);
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}
/**
 * The head a prerendered company file ships, as composeHtml writes it, read
 * as the document's load of `path`: jsdom has no navigation entry, so the
 * address at the moment of reading stands in for the URL the file was loaded at.
 */
function bakeHead(path: string, title: string, description: string) {
  window.history.replaceState({}, "", path);
  document.head.innerHTML = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<meta name="robots" content="index, follow">`,
    `<link rel="canonical" href="https://resumebooster.work${path}">`,
    `<meta name="x-prerendered" content="1">`,
  ].join("");
  resetBakedHeadForTests();
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  document.head.innerHTML = "";
  document.title = "";
});
afterEach(() => { cleanup(); document.head.innerHTML = ""; resetBakedHeadForTests(); });

describe("the rendered head", () => {
  it("mounted over its own baked file, the lander keeps the baked title and description, once", async () => {
    const BAKED_TITLE = "Domino's jobs: 23,789 open roles from their own hiring system";
    const BAKED_DESC = "23,789 open roles at Domino's, read from Domino's own hiring system. Check your resume's fit free before you apply.";
    bakeHead("/jobs/company/dominos", BAKED_TITLE, BAKED_DESC);
    answer("dominos", [job("dominos", "Domino's", 1), job("dominos", "Domino's", 2), job("dominos", "Domino's", 3)], 23_500);
    mount("/jobs/company/dominos");
    await waitFor(() => expect(document.querySelector("h1")?.textContent ?? "").toContain("Domino's"), SLOW);
    await waitFor(() => expect(document.body.textContent).toMatch(/23,500/), SLOW);
    expect([...document.querySelectorAll("title")].map((t) => t.textContent)).toEqual([BAKED_TITLE]);
    expect(document.title).toBe(BAKED_TITLE);
    const descs = [...document.head.querySelectorAll('meta[name="description"]')].map((m) => m.getAttribute("content"));
    expect(descs).toEqual([BAKED_DESC]);
  });

  it("with no baked head (an SPA visit), an agency's board says it is an agency's, with its count", async () => {
    answer("surge", [job("surge", "Surge Staffing", 1, true), job("surge", "Surge Staffing", 2, true)], 308);
    mount("/jobs/company/surge");
    await waitFor(() => expect(document.title).toBe("Surge Staffing jobs: 308 roles listed by a staffing agency"), SLOW);
    const desc = document.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    expect(desc).toMatch(/^308 roles listed by Surge Staffing, a staffing agency/);
    expect(document.title).not.toMatch(/own hiring system/);
  });

  it("a baked head for ANOTHER address is never kept (SPA navigation away from the first page)", async () => {
    bakeHead("/jobs/company/dominos", "Domino's jobs: 23,789 open roles from their own hiring system", "Baked for dominos.");
    answer("acme", [job("acme", "Acme", 1), job("acme", "Acme", 2)], 40);
    mount("/jobs/company/acme");
    await waitFor(() => expect(document.title).toBe("Acme jobs: 40 open roles from their own hiring system"), SLOW);
  });
});
