/**
 * A FULL ANALYSIS BUYER WHO RELOADED WAS ASKED FOR THE RÉSUMÉ AGAIN (S11-016).
 *
 * Once the $5 analysis rendered, the success page deleted its temporary keys
 * and the address kept only session_id. A reload, Back or a restored tab
 * found no key and showed "Resume Not Found": the buyer was asked to
 * regenerate the product they had just paid for, while the server held it.
 * Now the address names the analysis once it is shown (?share=, beside the
 * session), and a page with no résumé asks analyze-resume by the session
 * alone, which answers a redeemed session from its saved copy.
 *
 * The page is mounted for real, through the browser's own history, with only
 * the backend faked; a reload is a second mount at the address the browser
 * then holds, over the same storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => stubTable(),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/components/AnalysisResults", () => ({ AnalysisResults: () => <div data-testid="analysis">the analysis</div> }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "upsert", "in", "gte", "lte"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Success from "../pages/Success";
import { setResumeData, clearAllResumeData } from "@/hooks/use-resume-storage";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Senior software engineer with ten years of shipping. ".repeat(10);
const ANALYSIS = { industry: "Software", experienceLevel: "Senior", atsScore: { overall: 72 } };
const page = () => render(<BrowserRouter><Success /></BrowserRouter>);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  clearAllResumeData();
  invoke.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_temp_resume") return { data: [{ resume_text: RESUME, linkedin_text: null, job_description_text: null }], error: null };
    if (name === "get_analysis_by_share_id") return { data: [{ share_id: "share_saved_01", analysis_result: ANALYSIS }], error: null };
    return { data: null, error: null };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("the paid analysis on the success page", () => {
  it("is still there after a reload", async () => {
    invoke.mockImplementation(async (fn: string, o: { body: { resumeText: string } }) => fn === "analyze-resume" && o.body.resumeText
      ? { data: { ...ANALYSIS, shareId: "share_saved_01", emailSent: false }, error: null }
      : { data: { error: "Resume text is required" }, error: null });
    setResumeData("tempSessionId:cs_live_reload", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    window.history.replaceState(null, "", "/success?session_id=cs_live_reload");
    page();
    expect(await screen.findByTestId("analysis", {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(window.location.search, "the address does not name the analysis it showed").toContain("share=share_saved_01"));
    expect(window.location.search).toContain("session_id=cs_live_reload");
    cleanup();
    page(); // the reload
    expect(await screen.findByTestId("analysis", {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText(en.resumeRecovery.title), "a reload asked the buyer for the résumé again").toBeNull();
    expect(screen.queryByText(en.success.sharedView), "the buyer's own page was called a shared view").toBeNull();
  });

  it("with no résumé in the tab, shows the analysis the purchase already received", async () => {
    invoke.mockImplementation(async (fn: string, o: { body: { resumeText: string } }) => fn === "analyze-resume" && !o.body.resumeText
      ? { data: { ...ANALYSIS, shareId: "share_saved_01", emailSent: false, alreadyDelivered: true }, error: null }
      : { data: { error: "unexpected" }, error: null });
    window.history.replaceState(null, "", "/success?session_id=cs_live_other_device");
    page();
    expect(await screen.findByTestId("analysis", {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText(en.resumeRecovery.title), "a paid, delivered analysis was asked for again").toBeNull();
  });

  it("a purchase with nothing delivered still asks for the résumé", async () => {
    invoke.mockImplementation(async () => ({ data: { error: "Resume text is required" }, error: null }));
    window.history.replaceState(null, "", "/success?session_id=cs_live_nothing_yet");
    page();
    expect(await screen.findByText(en.resumeRecovery.title, {}, SLOW)).toBeInTheDocument();
  });
});
