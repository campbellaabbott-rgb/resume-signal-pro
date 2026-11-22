/**
 * THE NEWEST SCAN IS THE RÉSUMÉ THE BOARD RANKS (sweep MATCH-08).
 *
 * The board looks for a résumé to rank jobs by in this order: one dropped on
 * the board in this tab, then the account's pinned résumé, then the
 * homepage's scan stash. A visitor who dropped an older résumé on the board
 * and then scanned a newer one on the homepage had the board go on ranking
 * against the older drop, because the drop outranks the stash and nothing
 * took it out. A fresh scan on the homepage now takes the board's drop out of
 * the tab, so the board reads the newest scan. A scan that fails leaves the
 * drop where it was.
 *
 * Read on the whole homepage with the uploader and the report reduced to
 * their buttons, and the scanner's answer faked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn(), dismiss() {}, toasts: [] }), toast: vi.fn() }));

const freeScan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, freeKeywordScan: freeScan } };
});

// Trimmed, as the page keeps a draft.
const OLDER_DROP = "Jane Doe\nJunior Analyst, Old Co, 2015 - 2017\n- Wrote weekly reports by hand for the sales team\n- Kept the shared drive tidy\n".repeat(2).trim();
const NEWER = "Jane Doe\nSenior Data Engineer, Acme Corp, Jan 2020 - Present\n- Built pipelines that moved two billion rows a day\n- Led a team of five engineers\n".repeat(2).trim();
const NEWEST = "Jane Doe\nStaff Data Engineer, Beta Ltd, Mar 2024 - Present\n- Owns the warehouse models and the streaming platform\n- Mentors four engineers\n".repeat(2).trim();
const LATER_DROP = "Jane Doe\nAnalytics Lead, Gamma Inc, 2019 - 2023\n- Ran the experimentation programme for three product lines\n- Hired two analysts\n".repeat(2).trim();

let draft = NEWER;
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: (p: { onResumeDraftChange?: (t: string) => void; onFreeScan?: (t?: string) => void }) => (
    <div>
      <button type="button" onClick={() => p.onResumeDraftChange?.(draft)}>draft</button>
      <button type="button" onClick={() => p.onFreeScan?.()}>scan</button>
    </div>
  ),
}));
vi.mock("@/components/FreeKeywordResults", () => ({
  FreeKeywordResults: (p: { resumeText?: string }) => <div data-testid="report">{(p.resumeText ?? "").slice(0, 40)}</div>,
}));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import Index from "@/pages/Index";

const report = { data: { success: true, reportVerdict: { v: 1 }, candidateName: "Jane Doe", industry: "technology", atsScoreEstimate: 70, keywords: [], redFlags: [], quickWins: [] }, error: null, attempts: 1, totalDuration: 1 };
const refused = { data: null, error: { title: "Too short", description: "That résumé is too short to scan.", isRetryable: false }, errorBody: { code: "too_short" }, httpStatus: 400, attempts: 1, totalDuration: 1 };

// NO REQUEST LEAVES THE TEST. The checked-in .env names production, and a
// draft of 100 characters or more starts the page's background scan with a
// plain fetch: every request is answered here, unavailable, and never sent.
const sent: string[] = [];
beforeAll(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    sent.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(new Response("{}", { status: 503, headers: { "content-type": "application/json" } }));
  });
});
afterAll(() => { vi.unstubAllGlobals(); });

beforeEach(() => {
  freeScan.mockReset();
  freeScan.mockResolvedValue(report);
  draft = NEWER;
  sent.length = 0;
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(() => { cleanup(); try { sessionStorage.clear(); } catch { /* blocked */ } });

async function scanDraft(text: string) {
  draft = text;
  fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
  fireEvent.click(screen.getByRole("button", { name: "scan" }));
  await waitFor(() => expect(freeScan).toHaveBeenCalled(), SLOW);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}
const boardDrop = () => sessionStorage.getItem("rb_board_resume");
const scanStash = () => sessionStorage.getItem("rb_resume_for_fit");

describe("a scan on the homepage after a résumé was dropped on the board", () => {
  it("takes the older drop out, so the board ranks by the scan", async () => {
    sessionStorage.setItem("rb_board_resume", OLDER_DROP);
    render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
    await scanDraft(NEWER);
    await screen.findByTestId("report", {}, SLOW);
    expect(boardDrop(), "the board would still rank jobs against the older drop").toBeNull();
    expect(scanStash()).toBe(NEWER);
  });

  it("after a second scan, the board ranks by that one, not a drop made between the two", async () => {
    render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
    await scanDraft(NEWER);
    await screen.findByTestId("report", {}, SLOW);
    // The visitor goes to the board and drops another résumé there, then comes back.
    sessionStorage.setItem("rb_board_resume", LATER_DROP);
    freeScan.mockClear();
    await scanDraft(NEWEST);
    await waitFor(() => expect(scanStash()).toBe(NEWEST), SLOW);
    expect(boardDrop(), "the second scan left the board ranking by the drop").toBeNull();
  });

  it("leaves the drop in place when the scan does not come back", async () => {
    freeScan.mockResolvedValue(refused);
    sessionStorage.setItem("rb_board_resume", OLDER_DROP);
    render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
    await scanDraft(NEWER);
    expect(screen.queryByTestId("report")).toBeNull();
    expect(boardDrop(), "a refused scan took away the résumé the board was ranking by").toBe(OLDER_DROP);
  });
});
