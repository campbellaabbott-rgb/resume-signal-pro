/**
 * A FULL ANALYSIS IS DELETED ONLY BY ITS BUYER, AND ITS SHARE LINK IS A REAL
 * LINK (S13-079, S13-123, S13-027).
 *
 *   - S13-079: the success page deleted an analysis by its share id alone,
 *     and the share id is the link a buyer forwards, so anyone holding it
 *     could delete the buyer's $5 analysis. The page now sends the share id
 *     with the purchase it was made for, '<share id>:<purchase reference>'
 *     (the RPC's new rule, migration 20261103130000); a page opened from a
 *     share link alone offers no delete and says who can; an answer other
 *     than true is never reported as a deletion.
 *   - S13-123: the report sent buyers to "the share link above", which the
 *     page never showed, and the address bar shows a bare /success that opens
 *     "No session found" anywhere else. The buyer's view now has a Copy link
 *     card with the link that opens the analysis; a bare /success says how an
 *     analysis opens.
 *   - S13-027: the shared-computer note said the data auto-expires in an
 *     hour; the analysis is kept 90 days and opens for anyone with its link.
 *
 * The REAL first script out of index.html runs on each arrival and the real
 * success page mounts on the address it leaves; only the backend is faked,
 * and its delete keeps the migration's rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const h = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: (...a: unknown[]) => h.rpc(...a),
    from: () => {
      const th: Record<string, unknown> = {};
      const self = () => th;
      for (const k of ["select", "order", "eq", "not", "update", "insert", "upsert", "in", "gte", "lte"]) th[k] = self;
      th.limit = async () => ({ data: [] });
      th.maybeSingle = async () => ({ data: null });
      th.single = async () => ({ data: null });
      th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
      return th;
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackButtonClick: vi.fn(), trackAllConversions: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()),
  useFunnelTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast, dismiss() {}, toasts: [] }), toast: h.toast }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/SmartProductRecommendations", () => ({ SmartProductRecommendations: () => null }));
vi.mock("@/components/AnalysisResults", () => ({
  AnalysisResults: ({ data }: { data: { industry?: string } }) => <div data-testid="analysis">{String(data?.industry ?? "")}</div>,
}));

import Success from "../pages/Success";

vi.setConfig(MOUNT_TEST_BUDGET);

const HEAD = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(readFileSync(resolve(__dirname, "../../index.html"), "utf8"))?.[1] ?? "";
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(HEAD)?.[1] ?? "";
const arrive = (url: string) => { window.history.replaceState(null, "", url); new Function(SCRIPT)(); };
const page = () => render(<BrowserRouter><Success /></BrowserRouter>);

const SESSION = "cs_test_a1B2c3D4e5F6g7H8buyer";
const SHARE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
let saved: Map<string, { share_id: string; analysis_result: Record<string, unknown> }>;
/** The purchase that redeemed each analysis, as purchased_content records it. */
let redeemedBy: Map<string, string>;
const deletes: string[] = [];
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  deletes.length = 0;
  saved = new Map([[SHARE, { share_id: SHARE, analysis_result: { industry: "the buyer's analysis" } }]]);
  redeemedBy = new Map([[SESSION, SHARE]]);
  h.toast.mockReset();
  h.invoke.mockReset().mockImplementation(async (fn: string, o: { body: { sessionId?: string; resumeText?: string } }) => {
    if (fn !== "analyze-resume") return { data: {}, error: null };
    const share = redeemedBy.get(String(o.body.sessionId ?? ""));
    const copy = share ? saved.get(share) : undefined;
    return copy ? { data: { ...copy.analysis_result, shareId: share, alreadyDelivered: true }, error: null } : { data: { error: "Resume text is required" }, error: null };
  });
  // The migration's rule: '<share>:<purchase>', and only the purchase that redeemed that share.
  h.rpc.mockReset().mockImplementation(async (name: string, a: Record<string, string>) => {
    if (name === "get_temp_resume") return { data: [], error: null };
    if (name === "get_analysis_by_share_id") { const s = saved.get(a.share_id_param); return { data: s ? [s] : [], error: null }; }
    if (name === "delete_analysis_by_share_id") {
      deletes.push(a.p_share_id);
      const m = /^([a-f0-9]{24}|[a-f0-9]{32}):(.+)$/.exec(a.p_share_id ?? "");
      if (!m) return { data: null, error: { message: "Invalid share_id format: want <share id>:<purchase reference>" } };
      if (redeemedBy.get(m[2]) !== m[1]) return { data: false, error: null };
      saved.delete(m[1]);
      return { data: true, error: null };
    }
    return { data: null, error: null };
  });
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

describe("the buyer's own page", () => {
  it("S13-027: the shared-computer note says how long the analysis is kept, not an hour", async () => {
    arrive(`/success?session_id=${SESSION}`);
    page();
    const note = await screen.findByTestId("shared-computer-note");
    expect(note.textContent).not.toMatch(/1 hour|an hour/i);
    expect(note.textContent).toMatch(/90 days/);
    expect(note.textContent).toMatch(/anyone with its link/i);
  });

  it("S13-123: Copy link copies the link that opens the analysis anywhere", async () => {
    arrive(`/success?session_id=${SESSION}`);
    page();
    fireEvent.click(await screen.findByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(`${window.location.origin}/success?share=${SHARE}`);
  });

  it("S13-079: Delete sends the share id with the purchase, and the analysis goes", async () => {
    arrive(`/success?session_id=${SESSION}`);
    page();
    fireEvent.click(await screen.findByRole("button", { name: /Delete Data/ }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Yes, delete my data" })); });
    await waitFor(() => expect(deletes).toEqual([`${SHARE}:${SESSION}`]));
    expect(saved.has(SHARE)).toBe(false);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: en.success.toast.dataDeleted })));
  });

  it("S13-079: a delete the server refused is not reported as done", async () => {
    arrive(`/success?session_id=${SESSION}`);
    page();
    await screen.findByTestId("analysis");
    // A purchase with no redemption row naming this share (one delivered
    // before 2026-10-01): the server deletes nothing and answers false.
    h.rpc.mockImplementation(async (name: string, a: Record<string, string>) => {
      if (name === "delete_analysis_by_share_id") { deletes.push(a.p_share_id); return { data: false, error: null }; }
      return { data: [], error: null };
    });
    fireEvent.click(await screen.findByRole("button", { name: /Delete Data/ }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Yes, delete my data" })); });
    await waitFor(() => expect(deletes).toHaveLength(1));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: en.success.toast.deleteFailed })));
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: en.success.toast.dataDeleted }));
    expect(saved.has(SHARE)).toBe(true);
  });
});

describe("a page opened from a share link alone", () => {
  it("S13-079: offers no delete, and says who can", async () => {
    arrive(`/success?share=${SHARE}`);
    page();
    await screen.findByTestId("analysis");
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.getByTestId("shared-view-delete-note").textContent).toMatch(/Only the buyer can delete/);
    expect(deletes).toEqual([]);
    expect(saved.has(SHARE)).toBe(true);
  });
});

describe("a bare /success", () => {
  it("S13-123: says how an analysis opens, not 'No session found'", async () => {
    arrive("/success");
    const { container } = page();
    await waitFor(() => expect(container.textContent).toMatch(/No analysis is open here/));
    expect(container.textContent).not.toMatch(/No session found|complete the checkout process first/);
    expect(container.textContent).toMatch(/purchase email/);
  });
});
