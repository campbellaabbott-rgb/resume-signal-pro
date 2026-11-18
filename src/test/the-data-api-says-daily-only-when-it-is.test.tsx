/**
 * /DATA-API AND THE GHOST JOB INDEX SAY "DAILY" ONLY WHILE THE RUN RECORD SAYS
 * SO (CONTENT-7, the React half; SEO audit 2026-11-18).
 *
 * The accuracy re-check is scheduled once a day. Live on 17 November 2026 its
 * history ended 11-05, 11-06, 11-07, 11-16: one result in the ten scheduled
 * days since 7 November (the 11-17 run died before its write). The Ghost Job
 * Index's own audit sentence already went conditional past 36 hours (SEO-F07),
 * but /data-api still said "We sample random live postings every day" (the
 * dataset card), "audited against them daily" (the hero) and "daily accuracy
 * audits" (the description that replaces the baked one after hydration); the
 * Index's method line said "Every day we draw ~100 served postings", and its
 * chart was captioned "most recent 14 days" over entries spanning 26 October
 * to 16 November.
 *
 * Held here: with the newest run 44 hours old, /data-api says "scheduled
 * daily; latest run <date>" in all three places and "every day" in none; with
 * a run from this morning it keeps "daily" (the control); with no run read it
 * says only "scheduled daily". The Index's method line follows the same rule,
 * and its chart says how many runs it shows and the dates they span. The
 * page-local copies of the Index's age rule are held equal to it, and
 * /data-api does not import the Index's module (which imports the board's).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import DataApi, { DATA_API_AUDIT_DAILY_MAX_HOURS, dataApiAuditAgeHours, dataApiAuditCopy, dataApiAuditRunDate } from "../pages/DataApi";
import GhostJobIndex, { AUDIT_DAILY_MAX_HOURS, auditAgeHours, auditCadence, auditRunDate, auditTrendCaption } from "../pages/GhostJobIndex";

vi.setConfig({ ...MOUNT_TEST_BUDGET, testTimeout: 30_000 });
const ROOT = resolve(__dirname, "../..");
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const body = () => document.body.textContent ?? "";
/** The run's UTC day as the pages print it ("Nov 16, 2026"). */
const utcDay = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const description = () => document.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
const AUDIT = (at: string, history?: Array<{ at: string; sampled: number; accuracyPct: number }>) =>
  ({ at, accuracyPct: 96.6, sampled: 120, decided: 117, live: 113, gone: 4, unknown: 3, ...(history ? { history } : {}) });

function answer(audit: unknown) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_audit_result") return Promise.resolve({ data: audit });
    if (fn === "get_stats_cache") return Promise.resolve({ data: { computed_at: iso(0), stale_parts: [], ghost_stats: { total_open: 794317, total_companies: 32967, total_company_names: 32086, closed_90d: 1000, observed_days: 58, median_days_open: 13.8, computed_at: iso(0) } } });
    return Promise.resolve({ data: null });
  });
}
const dataApi = () => render(<HelmetProvider><MemoryRouter initialEntries={["/data-api"]}><DataApi /></MemoryRouter></HelmetProvider>);
const ghost = () => render(<HelmetProvider><MemoryRouter initialEntries={["/ghost-job-index"]}><GhostJobIndex /></MemoryRouter></HelmetProvider>);

beforeEach(() => { rpc.mockReset(); });
afterEach(() => { cleanup(); document.head.innerHTML = ""; });

describe("/data-api", () => {
  it("with the newest run 44 hours old, says 'scheduled daily; latest run <date>' and never 'every day' or 'audited against them daily'", async () => {
    const at = iso(44 * HOUR);
    answer(AUDIT(at));
    dataApi();
    await waitFor(() => expect(body()).toContain("open postings tracked now"));
    await waitFor(() => expect(body()).not.toMatch(/audited against them daily/));
    expect(body()).not.toMatch(/every day/);
    expect(body()).not.toMatch(/Daily accuracy audits/);
    const when = `scheduled daily; latest run ${utcDay(at)}`;
    await waitFor(() => expect(body()).toContain(`audited against them (${when})`));
    expect(body()).toContain(`Accuracy audits are ${when}.`);
    expect(body()).not.toMatch(/every day|audited against them daily/);
    await waitFor(() => expect(description()).toContain(`accuracy audits (${when})`));
    expect(description()).not.toMatch(/daily accuracy audits/);
  });

  it("with a run from this morning, keeps 'daily' (the control)", async () => {
    answer(AUDIT(iso(6 * HOUR)));
    dataApi();
    await waitFor(() => expect(body()).toContain("audited against them daily"));
    expect(body()).toContain("Daily accuracy audits");
    expect(body()).toMatch(/We sample random live postings every day/);
    await waitFor(() => expect(description()).toContain("daily accuracy audits"));
    expect(body()).not.toMatch(/latest run/);
  });

  it("with no run read (a failed or empty read), says only 'scheduled daily'", async () => {
    answer(null);
    dataApi();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_audit_result", undefined));
    await waitFor(() => expect(body()).toContain("audited against them (scheduled daily)"));
    expect(body()).not.toMatch(/every day|audited against them daily|latest run/);
  });

  it("the cadence copy turns at 36 hours, as the Index's does", () => {
    const now = Date.parse("2026-11-18T04:00:00Z");
    expect(dataApiAuditCopy("2026-11-16T16:00:00Z", now).hero).toBe("audited against them daily"); // exactly 36 h
    expect(dataApiAuditCopy("2026-11-16T15:59:00Z", now).hero).toBe("audited against them (scheduled daily; latest run Nov 16, 2026)");
    expect(dataApiAuditCopy("not a date", now).hero).toBe("audited against them (scheduled daily)");
  });

  it("its copies of the Index's rule equal the originals", () => {
    expect(DATA_API_AUDIT_DAILY_MAX_HOURS).toBe(AUDIT_DAILY_MAX_HOURS);
    const now = Date.parse("2026-11-18T04:23:25Z");
    for (const at of ["2026-11-16T04:23:25Z", "2026-11-17T23:59:59Z", "2026-10-26T04:00:00+02:00", "2026-11-18T05:00:00Z", "", "nope", null, undefined]) {
      expect(dataApiAuditAgeHours(at as string | null | undefined, now), String(at)).toBe(auditAgeHours(at as string | null | undefined, now));
      if (at && Number.isFinite(Date.parse(at))) expect(dataApiAuditRunDate(at)).toBe(auditRunDate(at));
    }
  });

  it("does not import the Index's module, which would load the board's with it", () => {
    const code = codeOf(readFileSync(resolve(ROOT, "src/pages/DataApi.tsx"), "utf8"));
    expect(code).not.toMatch(/from\s+["']@\/pages\/GhostJobIndex["']|from\s+["']\.\/GhostJobIndex["']|import\(\s*["'][^"']*GhostJobIndex["']/);
    expect(code).toMatch(/rpc\("get_audit_result"\)/);
  });
});

describe("the Ghost Job Index", () => {
  const HISTORY = [
    "2026-10-26T04:23:00Z", "2026-10-27T04:23:00Z", "2026-11-05T04:23:00Z", "2026-11-06T04:23:00Z", "2026-11-07T04:23:00Z", "2026-11-16T04:23:25Z",
  ].map((at) => ({ at, sampled: 120, accuracyPct: 96 }));

  it("with a stale run, its method line says the re-check is scheduled daily and names the latest run, not 'Every day'", async () => {
    const at = iso(44 * HOUR);
    answer(AUDIT(at, HISTORY));
    ghost();
    await waitFor(() => expect(body()).toContain("we sampled"));
    expect(body()).not.toMatch(/Every day we draw/);
    expect(body()).toContain(`The re-check is scheduled daily; latest run ${utcDay(at)}. Each run draws ~100 served postings`);
    expect(auditRunDate(at)).toBe(utcDay(at));
  });

  it("with a fresh run it keeps 'Every day' (the control); with none read, says only that it is scheduled daily", async () => {
    answer(AUDIT(iso(6 * HOUR)));
    ghost();
    await waitFor(() => expect(body()).toContain("We run this audit every day."));
    expect(body()).toMatch(/Every day we draw ~100 served postings/);
    cleanup();
    answer(null);
    ghost();
    await waitFor(() => expect(body()).toContain("The re-check is scheduled daily. Each run draws ~100 served postings"));
    expect(body()).not.toMatch(/Every day we draw/);
    expect(auditCadence(null)).toEqual({ kind: "unknown" });
  });

  it("captions the chart with the runs it shows and the dates they span, never 'most recent 14 days'", async () => {
    answer(AUDIT(iso(44 * HOUR), HISTORY));
    ghost();
    await waitFor(() => expect(body()).toContain("hover any bar for the dated measurement"));
    expect(body()).not.toMatch(/most recent \d+ days/);
    const caption = document.querySelector("[data-audit-trend-caption]")!.textContent;
    expect(caption).toBe("Latest 6 runs, Oct 26, 2026–Nov 16, 2026 — hover any bar for the dated measurement.");
    expect(auditTrendCaption([{ at: "2026-11-16T04:23:25Z" }])).toBe("Latest 1 run, Nov 16, 2026 — hover any bar for the dated measurement.");
  });
});
