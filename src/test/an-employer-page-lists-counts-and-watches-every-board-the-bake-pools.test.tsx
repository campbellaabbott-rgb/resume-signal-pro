/**
 * AN EMPLOYER PAGE LISTS, COUNTS AND WATCHES EVERY BOARD THE BAKE POOLS
 * (sweep S12-021), AND A SHARED BOARD NAME IS WATCHED BY ITS NAME (S13-117).
 *
 * S12-021: the bake states an employer page's count as the sum over the
 *   employer's boards it pools (PwC: 2,202 across 3 Workday sites, live
 *   2026-11-01), but the live page asked the board for its one token (1,042)
 *   and its Watch saved only that token. The page now reads the same pool from
 *   /landers.json, waits for it before its first read, lists and counts every
 *   board in it, says how many, and saves the watch over all of them. A
 *   secondary board's page keeps its own board, as the bake does.
 * S13-117: /jobs/company/clear names no employer, but its watch was saved as
 *   "New roles at Clear" and toasted "Watching Clear".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";
import { companiesOf, searchToBoardBody, searchToQuery } from "@/lib/job-search-params";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
const toasts: Array<{ title?: string }> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { user: { id: "u1" }, access_token: "t" } }) }));
vi.mock("@/hooks/use-toast", () => ({
  toast: (t: { title?: string }) => { toasts.push(t); return { id: "1", dismiss() {}, update() {} }; },
  useToast: () => ({ toast: () => ({}), dismiss() {}, toasts: [] }),
}));
function stubTable(table: string) {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "in", "gte", "lte", "is", "upsert", "delete"]) th[k] = () => th;
  th.insert = (row: Record<string, unknown>) => { inserts.push({ table, row }); return th; };
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;
const now = new Date().toISOString();
const row = (source: string, token: string, company: string, n: number) => ({
  id: `${source}:${token}:${n}`, source, token, company, title: `Associate ${n}`, location: "New York, NY, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "finance", department: null, agency: false,
  postedAt: now, lastSeen: now, recheckedAt: now, applyUrl: `https://apply.example/${token}/${n}`, remote: false,
});
const A = "pwc~wd3~Global_Experienced_Careers";
const B = "pwc~wd3~crm_experienced_careers_site";
const C = "pwc~wd3~global_campus_careers";
const COUNT: Record<string, number> = { [A]: 1042, [B]: 843, [C]: 317 };

const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Record<string, unknown> })?.body?.action === "list" && "offset" in ((o as { body: Record<string, unknown> }).body))
  .map(([, o]) => (o as { body: Record<string, unknown> }).body);

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  inserts.length = 0; toasts.length = 0;
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board" || b.action !== "list") return { data: {} };
    if (b.facetCounts) return { data: { categories: {} } };
    const cs = Array.isArray(b.companies) ? (b.companies as string[]) : [];
    if (cs[0] === "clear") {
      const jobs = [row("bamboohr", "clear", "Clear", 1), row("greenhouse", "clear", "CLEAR - Corporate", 2)];
      return { data: { jobs, total: 2, totalAllCompanies: 2, companies: [], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false, unknownCompanies: [] } };
    }
    const total = cs.reduce((n, t) => n + (COUNT[t] ?? 0), 0);
    if (b.countOnly) return { data: { total } };
    const jobs = cs.map((t, i) => row("workday", t, "PwC", i + 1));
    return { data: { jobs, total, totalAllCompanies: total, companies: [], companiesCount: cs.length, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: true, nextOffset: jobs.length, unknownCompanies: [] } };
  });
});
afterEach(() => { cleanup(); setLanderManifestForTests(null); });

const mountAt = (path: string) => {
  window.history.replaceState({}, "", path);
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes></MemoryRouter>);
};
const POOL = { [A]: `/jobs/company/${A}`, [B]: `/jobs/company/${A}`, [C]: `/jobs/company/${A}`, other: "/jobs/company/other" };

describe("an employer page the bake pools", () => {
  it("lists and counts every board in the pool from its first read, and says how many", async () => {
    setLanderManifestForTests(POOL);
    mountAt(`/jobs/company/${A}`);
    await waitFor(() => expect(listBodies().length).toBeGreaterThan(0), SLOW);
    expect(listBodies()[0].companies, "the page's first read asked for one board of the employer's three").toEqual([A, B, C]);
    await waitFor(() => expect(document.querySelector("[data-company-answer]")?.textContent ?? "").toMatch(/2,202/), SLOW);
    expect(document.querySelector("[data-company-pooled-boards]")?.textContent).toBe("Counted across 3 of this employer's hiring-system boards");
  });

  it("saves a watch over every board, keeping the page's own board as `company`", async () => {
    setLanderManifestForTests(POOL);
    mountAt(`/jobs/company/${A}`);
    const watch = await screen.findByRole("button", { name: /^Watch/ }, SLOW);
    fireEvent.click(watch);
    await waitFor(() => expect(inserts.filter((i) => i.table === "user_job_searches").length).toBeGreaterThan(0), SLOW);
    const saved = inserts.find((i) => i.table === "user_job_searches")!.row;
    expect(saved.params).toEqual({ company: A, companies: [A, B, C] });
  });

  it("control: a secondary board's page stays its own board, as its baked page does", async () => {
    setLanderManifestForTests(POOL);
    mountAt(`/jobs/company/${C}`);
    await waitFor(() => expect(listBodies().length).toBeGreaterThan(0), SLOW);
    expect(listBodies()[0].companies).toEqual([C]);
    await waitFor(() => expect(document.querySelector("[data-company-answer]")?.textContent ?? "").toMatch(/317/), SLOW);
    expect(document.querySelector("[data-company-pooled-boards]")).toBeNull();
  });
});

describe("a board name two hiring systems share", () => {
  it("S13-117: its watch is named for the boards, and so is the toast", async () => {
    setLanderManifestForTests("*");
    mountAt("/jobs/company/clear");
    const watch = await screen.findByRole("button", { name: "Watch boards named “clear”" }, SLOW);
    fireEvent.click(watch);
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0), SLOW);
    const saved = inserts.find((i) => i.table === "user_job_searches")!.row;
    expect(saved.name).toBe("New roles on boards named “clear”");
    expect(saved.params).toEqual({ company: "clear" });
    expect(toasts.at(-1)!.title).toBe("Watching boards named “clear”");
    expect(JSON.stringify([saved, toasts])).not.toMatch(/at Clear|Watching Clear/);
  });
});

describe("the saved watch reaches the digest and the account as every board", () => {
  it("the shared helpers read `companies` first and fall back to `company`", () => {
    expect(companiesOf({ company: A, companies: [A, B, C] })).toEqual([A, B, C]);
    expect(companiesOf({ company: A })).toEqual([A]);
    expect(companiesOf({})).toBeUndefined();
    expect(searchToBoardBody({ company: A, companies: [A, B, C] }).companies).toEqual([A, B, C]);
    expect(new URLSearchParams(searchToQuery({ company: A, companies: [A, B] }).split("?")[1]).get("company")).toBe(`${A},${B}`);
  });

  it("send-search-digest sends the list and links it", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/send-search-digest/index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(src).toMatch(/companies:\s*companiesOf\(p\),/);
    expect(src).not.toMatch(/companies:\s*p\.company \? \[p\.company\]/);
    expect(src).toMatch(/qs\.set\("company", boards\.join\(","\)\)/);
    expect(src).toMatch(/Array\.isArray\(p\.companies\)[\s\S]{0,160}\.slice\(0, 12\)/);
  });
});
