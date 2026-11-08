/**
 * A SUCCESS PAGE ANALYSES ONLY THE RÉSUMÉ ITS OWN PURCHASE STORED (review of
 * the 2026-11-10 hotfix's C-S14-010 fix).
 *
 * The checkout press wrote two pointers to the stored résumé, posting and
 * LinkedIn text: one under the purchase create-checkout named, and one under
 * a key that named no purchase. The success page read its purchase's pointer
 * and, when that was missing, the other one. The hotfix let both live a day,
 * so for 24 hours an abandoned checkout's résumé on a browser was taken by the
 * success page of a different purchase opened there (the emailed link, a
 * payment made on another device): that résumé was fetched, deleted from the
 * store, analysed and mailed for the other purchase, and the copy that
 * purchase recorded at checkout went unread.
 *
 * Mounted for real with only the backend faked, a pointer that names no
 * purchase is never read: the page asks by the session alone, and runs from
 * the purchase's own stored copy, or asks the buyer when there is none. Its
 * own purchase's pointer is used exactly as before.
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
import { clearAllResumeData, setResumeData } from "@/hooks/use-resume-storage";

vi.setConfig(MOUNT_TEST_BUDGET);

const ANALYSIS = { industry: "Software", experienceLevel: "Senior", atsScore: { overall: 72 } };
/** The résumé of a checkout started on this browser and never paid for. */
const ABANDONED_RESUME = "ABANDONED: Payroll specialist, eight years of multi-state payroll and audits. ".repeat(6);
const ABANDONED_POINTER = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
/** This purchase's own résumé, stored when its checkout was made. */
const OWN_RESUME = "OWN: Staff data engineer, streaming pipelines in Kafka and Flink. ".repeat(6);
const OWN_POINTER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const page = () => render(<BrowserRouter><Success /></BrowserRouter>);

/** A non-2xx answer as supabase-js hands it over: the response rides on the error. */
const failed = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  }),
});

const tempReads: unknown[] = [];
const bodies: Array<Record<string, unknown>> = [];

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  clearAllResumeData();
  tempReads.length = 0;
  bodies.length = 0;
  invoke.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== "get_temp_resume") return { data: null, error: null };
    tempReads.push(args.p_session_id);
    const text = args.p_session_id === ABANDONED_POINTER ? ABANDONED_RESUME : args.p_session_id === OWN_POINTER ? OWN_RESUME : null;
    return { data: text ? [{ resume_text: text, linkedin_text: null, job_description_text: null }] : [], error: null };
  });
  // The abandoned checkout's pointer, under the key that names no purchase.
  setResumeData("tempSessionId", ABANDONED_POINTER);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearAllResumeData(); window.history.replaceState(null, "", "/"); });

const sentText = () => bodies.map((b) => JSON.stringify(b)).join("\n");

describe("the success page of a purchase whose pointer is not in this browser", () => {
  it("never reads an abandoned checkout's résumé, and runs from the copy its own purchase stored", async () => {
    invoke.mockImplementation(async (_fn: string, o: { body: Record<string, unknown> }) => {
      bodies.push(o.body);
      if (o.body.fromStored === true) return { data: { ...ANALYSIS, hasJobDescription: true, shareId: "share_own_copy", emailSent: true }, error: null };
      return o.body.resumeText
        ? { data: { ...ANALYSIS, shareId: "share_wrong_resume", emailSent: true }, error: null }
        : failed(400, { error: "Resume text is required", storedInputs: { resume: true, posting: true, linkedIn: false } });
    });
    window.history.replaceState(null, "", "/success?session_id=cs_live_emailed_link");
    page();
    expect(await screen.findByTestId("analysis", {}, SLOW)).toBeInTheDocument();
    expect(tempReads, "the page fetched (and so deleted) another checkout's stored résumé").toEqual([]);
    expect(sentText(), "another checkout's résumé was analysed for this purchase").not.toContain("ABANDONED");
    expect(bodies.map((b) => b.fromStored ?? false)).toEqual([false, true]);
    expect(bodies[1]).toMatchObject({ sessionId: "cs_live_emailed_link", resumeText: "" });
  });

  it("with nothing stored for it (today's analyze-resume answers so), asks the buyer for the résumé instead", async () => {
    invoke.mockImplementation(async (_fn: string, o: { body: Record<string, unknown> }) => {
      bodies.push(o.body);
      return o.body.resumeText
        ? { data: { ...ANALYSIS, shareId: "share_wrong_resume", emailSent: true }, error: null }
        : { data: { error: "Resume text is required" }, error: null };
    });
    window.history.replaceState(null, "", "/success?session_id=cs_live_paid_elsewhere");
    page();
    expect(await screen.findByText(en.resumeRecovery.title, {}, SLOW)).toBeInTheDocument();
    expect(tempReads).toEqual([]);
    expect(screen.queryByTestId("analysis"), "an analysis of another checkout's résumé was shown").toBeNull();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ sessionId: "cs_live_paid_elsewhere", resumeText: "" });
  });
});

describe("the success page of a purchase made in this browser", () => {
  it("uses its own purchase's pointer exactly as before", async () => {
    setResumeData("tempSessionId:cs_live_made_here", OWN_POINTER);
    invoke.mockImplementation(async (_fn: string, o: { body: Record<string, unknown> }) => {
      bodies.push(o.body);
      return { data: { ...ANALYSIS, shareId: "share_made_here", emailSent: false }, error: null };
    });
    window.history.replaceState(null, "", "/success?session_id=cs_live_made_here");
    page();
    expect(await screen.findByTestId("analysis", {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(tempReads).toEqual([OWN_POINTER]));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ sessionId: "cs_live_made_here", resumeText: OWN_RESUME });
    expect(sentText()).not.toContain("ABANDONED");
  });
});
