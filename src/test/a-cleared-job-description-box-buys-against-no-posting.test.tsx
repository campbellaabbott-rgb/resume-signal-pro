/**
 * A CLEARED JOB DESCRIPTION BOX BUYS AGAINST NO POSTING (S13-039).
 *
 * The free scan was already told the box is the truth (L13-31); the $5 Full
 * Analysis was not. Its two presses went on falling back to the page's earlier
 * posting and skipped the failure filter, and the page fell back once more, so:
 *   - a visitor from "Check my fit" who cleared the box and bought got the paid
 *     analysis against the posting they removed;
 *   - a failed Google Sheets import sent its failure sentence as the posting,
 *     which analyze-resume treats as one.
 *
 * WHAT HOLDS NOW, on the whole homepage with its real uploader and only the
 * backend faked. What is read is the p_job_description the purchase stores: that
 * is the row the success page delivers from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { JD_HANDOFF_KEY } from "@/lib/jd-handoff";

const STORED = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const stores = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit", "gte", "lte", "in", "insert", "upsert", "update"]) th[k] = () => th;
    th.maybeSingle = async () => ({ data: null });
    th.single = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke },
      from: table,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn !== "store_temp_resume") return { data: null, error: null };
        stores.push(args);
        return { data: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn(), dismiss() {}, toasts: [] }), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/hooks/use-shared-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkConnectionHealth: async () => true,
}));
const createCheckout = vi.hoisted(() => vi.fn());
const parseSpreadsheet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, createCheckout, parseSpreadsheet } };
});
// The overlay, reduced to the retry the page hands it.
vi.mock("@/components/CheckoutOverlay", () => ({
  CLOSE_OFFERED_AFTER_MS: 4000,
  CheckoutOverlay: ({ onRetry }: { onRetry?: () => void }) =>
    onRetry ? <button type="button" onClick={onRetry}>retry the checkout</button> : null,
}));

import Index from "@/pages/Index";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Senior financial analyst with nine years in FP&A, forecasting and the monthly close. ".repeat(3);
const POSTING_A = "POSTING A. Senior payroll analyst at Alpha Co. Reconcile multi-state payroll, own the quarterly filings, and partner with HR on audits.";
const POSTING_B = "POSTING B. Staff data engineer at Beta Co. Build streaming pipelines in Kafka and Flink, own the warehouse models and mentor two engineers.";

beforeEach(() => {
  sessionStorage.clear();
  stores.length = 0;
  invoke.mockReset();
  invoke.mockResolvedValue({ data: null, error: null });
  parseSpreadsheet.mockReset();
  createCheckout.mockReset();
  createCheckout.mockResolvedValue({ data: null, error: { title: "x", description: "stopped for the test", isRetryable: false }, attempts: 1, totalDuration: 1 });
  sessionStorage.setItem("rb_resume_text", RESUME);
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

function mountHandedOff() {
  sessionStorage.setItem(JD_HANDOFF_KEY, JSON.stringify({ jd: POSTING_A, title: "Senior payroll analyst", company: "Alpha Co" }));
  return render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
}
const jdBox = () => (screen.getAllByRole("textbox") as HTMLTextAreaElement[]).find((t) => /job description you're applying to/i.test(t.placeholder ?? ""));
const buy = () => screen.getByRole("button", { name: /complete analysis/i });
async function pressBuy() {
  await waitFor(() => expect(buy().hasAttribute("disabled"), "the buy press never became available").toBe(false));
  fireEvent.click(buy());
  await waitFor(() => expect(createCheckout, "create-checkout was never called").toHaveBeenCalled());
}
/** What the purchase's stored row holds: the last store before the checkout. */
const boughtAgainst = () => stores[stores.length - 1]?.p_job_description;

describe("the $5 press in the uploader", () => {
  it("with the handed-off posting left in the box, buys against it (the control)", async () => {
    mountHandedOff();
    await waitFor(() => expect(jdBox()?.value).toBe(POSTING_A));
    await pressBuy();
    expect(createCheckout.mock.calls[0][0]).toMatchObject({ tempSessionId: STORED });
    expect(boughtAgainst()).toBe(POSTING_A);
  });

  it("with the box cleared, buys against no posting, and says so to the store", async () => {
    mountHandedOff();
    await waitFor(() => expect(jdBox()?.value).toBe(POSTING_A));
    fireEvent.change(jdBox()!, { target: { value: "" } });
    await pressBuy();
    expect(boughtAgainst(), "the purchase was stored with the posting the buyer removed").toBeNull();
  });

  it("with the box cleared, the tab forgets the posting too, so a reload does not bring it back", async () => {
    mountHandedOff();
    await waitFor(() => expect(jdBox()?.value).toBe(POSTING_A));
    expect(sessionStorage.getItem("rb_job_description_text")).toBe(POSTING_A);
    fireEvent.change(jdBox()!, { target: { value: "" } });
    await pressBuy();
    expect(sessionStorage.getItem("rb_job_description_text")).toBeNull();
    expect(sessionStorage.getItem("rb_resume_text"), "the résumé went with it").toBe(RESUME);
  });

  it("a retry after a failed checkout buys against what the press said, not the earlier posting", async () => {
    mountHandedOff();
    await waitFor(() => expect(jdBox()?.value).toBe(POSTING_A));
    fireEvent.change(jdBox()!, { target: { value: "" } });
    await pressBuy();
    expect(boughtAgainst()).toBeNull();
    const retry = await screen.findByRole("button", { name: "retry the checkout" });
    stores.length = 0;
    createCheckout.mockClear();
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(createCheckout).toHaveBeenCalled());
    // The retry may reuse a stored copy made from the same inputs; a new store must also hold none.
    for (const s of stores) expect(s.p_job_description, "the retry went back to the removed posting").toBeNull();
  });

  it("from the paste tab, a cleared box buys against no posting too", async () => {
    mountHandedOff();
    await waitFor(() => expect(jdBox()?.value).toBe(POSTING_A));
    fireEvent.change(jdBox()!, { target: { value: "" } });
    fireEvent.click(document.getElementById("resume-paste-tab")!);
    const paste = (screen.getAllByRole("textbox") as HTMLTextAreaElement[]).find((t) => /resume content here/i.test(t.placeholder ?? ""))!;
    fireEvent.change(paste, { target: { value: RESUME } });
    await pressBuy();
    expect(boughtAgainst(), "the paste path bought against the posting the buyer removed").toBeNull();
  });

  it("with another posting typed into the box, buys against that one", async () => {
    mountHandedOff();
    await waitFor(() => expect(jdBox()?.value).toBe(POSTING_A));
    fireEvent.change(jdBox()!, { target: { value: POSTING_B } });
    await pressBuy();
    expect(boughtAgainst()).toBe(POSTING_B);
  });
});

describe("a failed Google Sheets import", () => {
  async function failImport(answer: Record<string, unknown>) {
    parseSpreadsheet.mockResolvedValue(answer);
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: /^Google Sheets$/ }));
    const url = screen.getByPlaceholderText(/docs\.google\.com/i);
    fireEvent.change(url, { target: { value: "https://docs.google.com/spreadsheets/d/abc/edit" } });
    fireEvent.click(screen.getByRole("button", { name: /Import from Google Sheets/i }));
    await waitFor(() => expect(parseSpreadsheet).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }

  it("is never sent as the posting: the refused call's sentence", async () => {
    await failImport({ data: null, error: { title: "t", description: "d", isRetryable: false } });
    await pressBuy();
    expect(boughtAgainst(), "the failure sentence was bought against as the job description").toBeNull();
  });

  it("is never sent as the posting: the server's own error", async () => {
    await failImport({ data: { success: false, error: "No jobs found", suggestion: "Check the columns." }, error: null });
    await pressBuy();
    expect(boughtAgainst()).toBeNull();
  });
});
