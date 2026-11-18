/**
 * A SIGN-IN FROM THE REPORT COMES BACK TO THE SAME REPORT (S14X-019).
 *
 * The free report's "Sign in to tailor" and "Sign in to practise" links went
 * to /auth and came back to an empty scanner: the report, the posting and the
 * reason for signing in were gone, and seeing the report again spent another
 * scan. Before either link leaves, the page now keeps the report in this
 * tab's session storage (rb_pending_report), tied to the résumé by its
 * fingerprint. Back with a session, within 30 minutes and on the same résumé,
 * the report is put back without a scan and the reader's action opens. A
 * stash for another résumé is ignored.
 *
 * The real page, with the uploader and the report reduced to the props the
 * page hands them; the scanner and the writer are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

const auth = vi.hoisted(() => ({ session: null as null | { access_token: string; user: { id: string; email: string } } }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gte", "lte", "insert", "upsert", "update", "delete"]) chain[k] = () => chain;
  Object.assign(chain, {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: {
        getSession: async () => ({ data: { session: auth.session }, error: null }),
        getUser: async () => ({ data: { user: auth.session?.user ?? null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: auth.session, user: auth.session?.user ?? null, loading: false }),
  safeNextPath: (s: string) => s,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));

const freeScan = vi.hoisted(() => vi.fn());
const writer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, callEdgeFunctionWithRetry: writer, resilientCallers: { ...actual.resilientCallers, freeKeywordScan: freeScan } };
});

const RESUME = "Jane Doe\nData Engineer, Acme Corp, Jan 2020 - Present\n- Built pipelines that moved two billion rows a day\n- Led a team of five engineers across three regions";
const POSTING = "Senior Data Engineer at Northwind. Own the batch and streaming pipelines, mentor four engineers and run the on-call rota.";
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: (p: { onResumeDraftChange?: (t: string) => void; onFreeScan?: (t?: string) => void; onJobDescriptionTextChange?: (t: string) => void }) => (
    <div>
      <button type="button" onClick={() => { p.onResumeDraftChange?.(RESUME); p.onJobDescriptionTextChange?.(POSTING); }}>draft</button>
      <button type="button" onClick={() => p.onFreeScan?.(RESUME)}>scan</button>
    </div>
  ),
}));
// The report, reduced to the two sign-in links it renders for a signed-out reader.
vi.mock("@/components/FreeKeywordResults", () => ({
  FreeKeywordResults: (p: { industry?: string; onBeforeSignIn?: (intent: "tailor" | "interview") => void; openInterviewPrep?: boolean }) => (
    <div data-testid="report">
      <span data-testid="report-industry">{p.industry}</span>
      <span data-testid="interview-open">{String(!!p.openInterviewPrep)}</span>
      <button type="button" data-testid="tailored-resume-sign-in" onClick={() => p.onBeforeSignIn?.("tailor")}>sign in to tailor</button>
      <button type="button" data-testid="interview-sign-in" onClick={() => p.onBeforeSignIn?.("interview")}>sign in to practise</button>
    </div>
  ),
}));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import Index from "@/pages/Index";

const REPORT = { success: true, industry: "data_engineering", atsScoreEstimate: 71, formatGrade: "B", experienceLevel: "mid", keywords: [], redFlags: [], quickWins: [], matchingSkills: ["spark"], missingSkills: ["dbt"] };
const KEY = "rb_pending_report";

beforeEach(() => {
  auth.session = null;
  freeScan.mockReset(); writer.mockReset(); toast.mockReset();
  freeScan.mockResolvedValue({ data: REPORT, error: null, attempts: 1, totalDuration: 1 });
  writer.mockResolvedValue({ data: { success: true, professionalSummary: "Data engineer." }, error: null, attempts: 1, totalDuration: 1 });
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(() => { cleanup(); });

const mount = () => render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
async function scanSignedOut() {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
  fireEvent.click(screen.getByRole("button", { name: "scan" }));
  await screen.findByTestId("report", {}, SLOW);
}
const stash = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };

describe("leaving for sign-in from the report", () => {
  it("keeps the report, the posting and the reason in this tab before the link leaves", async () => {
    await scanSignedOut();
    fireEvent.click(screen.getByTestId("tailored-resume-sign-in"));
    const kept = JSON.parse(stash() ?? "null") as { intent?: string; result?: { industry?: string }; jobDescriptionText?: string; fingerprint?: string } | null;
    expect(kept, "nothing was kept for the trip to /auth").not.toBeNull();
    expect(kept?.intent).toBe("tailor");
    expect(kept?.result?.industry).toBe("data_engineering");
    expect(kept?.jobDescriptionText).toBe(POSTING);
    expect(typeof kept?.fingerprint).toBe("string");
  });
});

describe("coming back signed in", () => {
  it("shows the same report with no second scan, opens the tailor, and drops the stash", async () => {
    await scanSignedOut();
    fireEvent.click(screen.getByTestId("tailored-resume-sign-in"));
    cleanup();
    const scansBefore = freeScan.mock.calls.length;
    auth.session = { access_token: "t", user: { id: "u1", email: "jane@example.com" } };
    mount();
    expect((await screen.findByTestId("report-industry", {}, SLOW)).textContent).toBe("data_engineering");
    expect(freeScan.mock.calls.length, "seeing the report again spent a scan").toBe(scansBefore);
    await waitFor(() => expect(writer.mock.calls.filter(([fn]) => fn === "generate-tailored-resume").length).toBe(1), SLOW);
    expect((writer.mock.calls[0][1] as { jobDescription?: string }).jobDescription).toBe(POSTING);
    expect(stash(), "the stash outlived its one use").toBeNull();
  });

  it("opens interview practice when that was the reason, and writes nothing", async () => {
    await scanSignedOut();
    fireEvent.click(screen.getByTestId("interview-sign-in"));
    cleanup();
    auth.session = { access_token: "t", user: { id: "u1", email: "jane@example.com" } };
    mount();
    await waitFor(() => expect(screen.getByTestId("interview-open").textContent).toBe("true"), SLOW);
    expect(writer).not.toHaveBeenCalled();
  });

  it("ignores a stash made for another résumé", async () => {
    await scanSignedOut();
    fireEvent.click(screen.getByTestId("tailored-resume-sign-in"));
    const kept = JSON.parse(stash()!);
    sessionStorage.setItem(KEY, JSON.stringify({ ...kept, fingerprint: "another-resume" }));
    cleanup();
    auth.session = { access_token: "t", user: { id: "u1", email: "jane@example.com" } };
    mount();
    await screen.findByRole("button", { name: "draft" }, SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("report"), "another résumé's report was put back").toBeNull();
    expect(writer).not.toHaveBeenCalled();
  });
});
