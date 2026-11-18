/**
 * A SCAN ANSWERED FOR A RÉSUMÉ NO LONGER ON SCREEN SHOWS NOTHING (NB-15).
 *
 * The page guarded a file READ against a later pick or Clear (S11-030), but
 * not the SCAN: a scan pressed for résumé A that answered after the reader
 * cleared it, or replaced it with résumé B, still put A's report on screen,
 * under B's text, ready to be bought from. Every pick, Clear and edit now
 * makes a scan in flight stale, and a stale answer is dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

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
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));

const held = vi.hoisted(() => ({ resolve: null as null | ((v: unknown) => void) }));
const freeScan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, freeKeywordScan: freeScan } };
});

const A = "Jane Doe\nData Engineer, Acme Corp, Jan 2020 - Present\n- Built pipelines that moved two billion rows a day\n- Led a team of five engineers";
const B = "John Roe\nStaff Nurse, St Mary's, Mar 2018 - Present\n- Ran triage for a thirty-bed ward\n- Trained twelve new starters a year";
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: (p: { onResumeDraftChange?: (t: string) => void; onFreeScan?: (t?: string) => void; onClearResume?: () => void }) => (
    <div>
      <button type="button" onClick={() => p.onResumeDraftChange?.(A)}>draft A</button>
      <button type="button" onClick={() => p.onResumeDraftChange?.(B)}>draft B</button>
      <button type="button" onClick={() => p.onFreeScan?.()}>scan</button>
      <button type="button" onClick={() => p.onClearResume?.()}>clear</button>
    </div>
  ),
}));
vi.mock("@/components/FreeKeywordResults", () => ({
  FreeKeywordResults: (p: { candidateName?: string }) => <div data-testid="report">{p.candidateName}</div>,
}));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import Index from "@/pages/Index";

const reportFor = (name: string) => ({ data: { success: true, candidateName: name, industry: "technology", atsScoreEstimate: 70, keywords: [], redFlags: [], quickWins: [] }, error: null, attempts: 1, totalDuration: 1 });

beforeEach(() => {
  freeScan.mockReset(); toast.mockReset(); held.resolve = null;
  freeScan.mockImplementation(() => new Promise((r) => { held.resolve = r; }));
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(() => { cleanup(); });

async function pressScanForA() {
  render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "draft A" }, SLOW));
  fireEvent.click(screen.getByRole("button", { name: "scan" }));
  await waitFor(() => expect(held.resolve).not.toBeNull(), SLOW);
}
async function answerWith(v: unknown) {
  await act(async () => { held.resolve!(v); await new Promise((r) => setTimeout(r, 20)); });
}

describe("a scan in flight", () => {
  it("answering after Clear puts no report on screen", async () => {
    await pressScanForA();
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await answerWith(reportFor("Jane Doe"));
    expect(screen.queryByTestId("report"), "the cleared résumé's report came back").toBeNull();
  });

  it("answering after the résumé was replaced puts the old résumé's report nowhere", async () => {
    await pressScanForA();
    fireEvent.click(screen.getByRole("button", { name: "draft B" }));
    await answerWith(reportFor("Jane Doe"));
    expect(screen.queryByTestId("report"), "résumé A's report shown under résumé B").toBeNull();
  });

  it("answering for the résumé still on screen shows its report", async () => {
    await pressScanForA();
    await answerWith(reportFor("Jane Doe"));
    expect((await screen.findByTestId("report", {}, SLOW)).textContent).toBe("Jane Doe");
  });
});
