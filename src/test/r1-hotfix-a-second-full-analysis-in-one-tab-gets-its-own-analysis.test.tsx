/**
 * R1 HOTFIX S13-002 (high, commercial blocker): A SECOND FULL ANALYSIS BOUGHT
 * IN THE SAME TAB GETS ITS OWN ANALYSIS.
 *
 * WHAT WAS WRONG. Since R1 the first script in index.html moves session_id
 * and share out of the address into this tab's stash, and the success page
 * keeps the share of the analysis it showed there (S11-016, for a reload).
 * The script merged only the keys it captured on each load, so a second $5
 * purchase in the same tab arrived at /success?session_id=<new> beside the
 * FIRST purchase's share. The page took the share branch: it showed analysis
 * #1 under "Your analysis is ready" (with a Delete button that deleted #1),
 * never generated #2, recorded no sale, and hid Try again. After a Delete of
 * #1, or after the analysis email's share link had been opened in the tab,
 * the new purchase said "Analysis not found" with only Back home.
 *
 * WHAT HOLDS NOW, end to end in one jsdom tab: the REAL first script out of
 * index.html runs on each arrival, over one sessionStorage, and the real
 * success page mounts on the address it leaves; only the backend is faked
 * (it generates an analysis per purchase, saves it under a share, answers a
 * redeemed purchase from its saved copy, and deletes by share).
 *   - a second purchase in the tab generates ITS analysis from ITS résumé,
 *     records the sale, and a reload shows it again;
 *   - so does a purchase after the first analysis was deleted, and one after
 *     the email's share link was opened in the tab (a Pro member's included
 *     analysis, a pro_ grant, too);
 *   - a share link opened in a tab that holds a purchase shows the analysis
 *     the link names, read-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const h = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), funnel: vi.fn(), toast: vi.fn() }));
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
  useFunnelTracking: () => ({ trackPurchaseCompleted: h.funnel, trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));
// One toast function, as the real hook gives: the page re-runs its loader whenever toast changes.
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast, dismiss() {}, toasts: [] }), toast: h.toast }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/SmartProductRecommendations", () => ({ SmartProductRecommendations: () => null }));
vi.mock("@/components/AnalysisResults", () => ({
  AnalysisResults: ({ data }: { data: { industry?: string } }) => <div data-testid="analysis">{String(data?.industry ?? "")}</div>,
}));

import Success from "../pages/Success";
import { setResumeData, clearAllResumeData } from "@/hooks/use-resume-storage";

vi.setConfig(MOUNT_TEST_BUDGET);

// The first <head> script, exactly as index.html ships it.
const HEAD = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(readFileSync(resolve(__dirname, "../../index.html"), "utf8"))?.[1] ?? "";
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(HEAD)?.[1] ?? "";
/** A full page load of `url` in this tab: the address, then the first script, as the browser runs it. */
const arrive = (url: string) => { window.history.replaceState(null, "", url); new Function(SCRIPT)(); };
const page = () => render(<BrowserRouter><Success /></BrowserRouter>);
const stash = () => JSON.parse(sessionStorage.getItem("rb_url_stash") ?? "{}") as Record<string, unknown>;

/** The backend: one analysis per purchase, saved under its share. */
let temp: Map<string, string>;
let saved: Map<string, { share_id: string; analysis_result: Record<string, unknown> }>;
let delivered: Map<string, string>;
const resumeOf = (sessionId: string) => `Résumé for the purchase ${sessionId}. `.repeat(12);
const analysisOf = (sessionId: string) => `the analysis of ${sessionId}`;
const shareOf = (sessionId: string) => `share-of-${sessionId}`;

/** The homepage before checkout: the résumé goes to temp storage, and this tab keeps its id under the purchase. */
function checkout(sessionId: string) {
  const tempId = `7c9e6679-7425-40de-944b-${sessionId.slice(-12).padStart(12, "0")}`;
  temp.set(tempId, resumeOf(sessionId));
  setResumeData(`tempSessionId:${sessionId}`, tempId);
}
/** An analysis that exists on the server already (made in another tab, or for another person). */
function savedAnalysis(sessionId: string) {
  saved.set(shareOf(sessionId), { share_id: shareOf(sessionId), analysis_result: { industry: analysisOf(sessionId) } });
  delivered.set(sessionId, shareOf(sessionId));
}
const analyzeCalls = () => h.invoke.mock.calls.filter((c) => c[0] === "analyze-resume").map((c) => (c[1] as { body: { resumeText: string; sessionId: string } }).body);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  clearAllResumeData();
  temp = new Map(); saved = new Map(); delivered = new Map();
  h.funnel.mockReset();
  h.invoke.mockReset().mockImplementation(async (fn: string, o: { body: { resumeText?: string; sessionId?: string } }) => {
    if (fn !== "analyze-resume") return { data: {}, error: null };
    const sid = String(o.body.sessionId ?? "");
    if (o.body.resumeText) {
      if (o.body.resumeText !== resumeOf(sid)) return { data: { error: "that is another purchase's résumé" }, error: null };
      savedAnalysis(sid);
      return { data: { industry: analysisOf(sid), shareId: shareOf(sid), emailSent: false }, error: null };
    }
    const share = delivered.get(sid);
    const copy = share ? saved.get(share) : undefined;
    return copy
      ? { data: { ...copy.analysis_result, shareId: share, alreadyDelivered: true }, error: null }
      : { data: { error: "Resume text is required" }, error: null };
  });
  h.rpc.mockReset().mockImplementation(async (name: string, a: Record<string, string>) => {
    if (name === "get_temp_resume") {
      const text = temp.get(a.p_session_id);
      temp.delete(a.p_session_id);
      return { data: text ? [{ resume_text: text, linkedin_text: null, job_description_text: null }] : [], error: null };
    }
    if (name === "get_analysis_by_share_id") { const s = saved.get(a.share_id_param); return { data: s ? [s] : [], error: null }; }
    if (name === "delete_analysis_by_share_id") { saved.delete(a.p_share_id); return { data: true, error: null }; }
    return { data: null, error: null };
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

/** One whole purchase in this tab: checkout, Stripe's return, the analysis on screen. */
async function buyAndSee(sessionId: string) {
  checkout(sessionId);
  arrive(`/success?session_id=${sessionId}`);
  page();
  expect(await screen.findByTestId("analysis", {}, SLOW)).toHaveTextContent(analysisOf(sessionId));
  await waitFor(() => expect(stash().share, "the tab did not keep the share of the analysis it showed").toBe(shareOf(sessionId)));
}

describe("a second full analysis bought in the same tab", () => {
  it("is generated from its own résumé and shown, the sale is recorded, and a reload shows it again", async () => {
    await buyAndSee("cs_live_AAAAAAAAAAAA");
    cleanup();

    // Back to the homepage, a different résumé, $5 again; Stripe returns to /success with the new session.
    await buyAndSee("cs_live_BBBBBBBBBBBB");
    expect(screen.getByTestId("analysis"), "the second purchase was shown the first one's analysis").not.toHaveTextContent(analysisOf("cs_live_AAAAAAAAAAAA"));
    expect(analyzeCalls().filter((b) => b.sessionId === "cs_live_BBBBBBBBBBBB" && b.resumeText === resumeOf("cs_live_BBBBBBBBBBBB")), "the second purchase's analysis was never generated").toHaveLength(1);
    expect(h.rpc.mock.calls.filter((c) => c[0] === "get_analysis_by_share_id"), "the page loaded an analysis by a share instead of generating the new one").toEqual([]);
    expect(h.funnel.mock.calls.map((c) => c[2]), "the second sale was never recorded").toEqual(["cs_live_AAAAAAAAAAAA", "cs_live_BBBBBBBBBBBB"]);
    expect(stash()).toMatchObject({ session_id: "cs_live_BBBBBBBBBBBB", share: shareOf("cs_live_BBBBBBBBBBBB"), share_session: "cs_live_BBBBBBBBBBBB" });
    cleanup();

    // A reload of the bare /success: the second analysis again, by its own share.
    arrive("/success");
    page();
    expect(await screen.findByTestId("analysis", {}, SLOW)).toHaveTextContent(analysisOf("cs_live_BBBBBBBBBBBB"));
    expect(screen.queryByText(en.resumeRecovery.title), "a reload asked for the résumé again").toBeNull();
    expect(screen.queryByText(en.success.sharedView), "the buyer's own page was called a shared view").toBeNull();
    expect(analyzeCalls().filter((b) => b.sessionId === "cs_live_BBBBBBBBBBBB"), "a reload generated the analysis a second time").toHaveLength(1);
  });

  it("after the first analysis was deleted, the new purchase gets its analysis, never 'Analysis not found'", async () => {
    await buyAndSee("cs_live_DELETEDAAAAA");
    fireEvent.click(screen.getByRole("button", { name: /Delete Data/ }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Yes, delete my data" })); });
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(saved.has(shareOf("cs_live_DELETEDAAAAA"))).toBe(false);
    expect(stash().share, "the tab still names an analysis that was deleted").toBeUndefined();
    cleanup();

    await buyAndSee("cs_live_AFTERDELETE1");
    expect(screen.queryByText("Analysis not found. The link may be invalid or expired.")).toBeNull();
  });

  it("after the analysis email's share link was opened in the tab, the new purchase (a Pro member's included one too) gets its analysis", async () => {
    savedAnalysis("cs_live_EMAILEDAAAA");
    arrive(`/success?share=${shareOf("cs_live_EMAILEDAAAA")}`);
    expect(window.location.search, "the share id stayed in the address").toBe("");
    page();
    expect(await screen.findByTestId("analysis", {}, SLOW)).toHaveTextContent(analysisOf("cs_live_EMAILEDAAAA"));
    cleanup();

    await buyAndSee("pro_grant_BBBBBBBBBB");
    expect(screen.getByTestId("analysis")).not.toHaveTextContent(analysisOf("cs_live_EMAILEDAAAA"));
    expect(analyzeCalls().filter((b) => b.sessionId === "pro_grant_BBBBBBBBBB" && b.resumeText)).toHaveLength(1);
    expect(h.funnel, "a Pro member's included analysis took no money and is no $5 sale").not.toHaveBeenCalled();
  });
});

describe("a share link opened in a tab that holds a purchase", () => {
  it("shows the analysis the link names, read-only, not the tab's purchase", async () => {
    await buyAndSee("cs_live_TABPURCHASE");
    cleanup();
    savedAnalysis("cs_live_SOMEONEELSE");
    arrive(`/success?share=${shareOf("cs_live_SOMEONEELSE")}`);
    page();
    expect(await screen.findByTestId("analysis", {}, SLOW)).toHaveTextContent(analysisOf("cs_live_SOMEONEELSE"));
    expect(screen.getAllByText(en.success.sharedView).length, "the link's analysis was shown as this tab's own purchase").toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Delete Data/ }), "a share link offered the delete of someone's analysis as the buyer's own").toBeNull();
  });
});
