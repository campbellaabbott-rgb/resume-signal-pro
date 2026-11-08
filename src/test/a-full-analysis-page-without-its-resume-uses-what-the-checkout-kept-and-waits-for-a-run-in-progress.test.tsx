/**
 * A FULL ANALYSIS PAGE WITHOUT ITS RÉSUMÉ USES WHAT THE CHECKOUT KEPT, AND
 * WAITS FOR A RUN IN PROGRESS (hotfix 2026-11-10: H4 C-S14-010; M-S14-005,
 * C-S14-005).
 *
 * The success page lost its pointer to the stored résumé, posting and
 * LinkedIn text after an hour, on another device, or in a cleared browser,
 * and then asked for the résumé alone: the purchase was analysed without the
 * posting it was bought against. And a second request for one purchase made
 * a second model run. Now, mounted for real with only the backend faked:
 *   - told the purchase's copy is still stored, the page asks for the
 *     analysis from it (fromStored) and shows it, asking the buyer nothing;
 *   - told the checkout was made with a posting and the copy is gone, the
 *     résumé box asks for the posting too, and sends it;
 *   - told neither (today's live analyze-resume), the page asks for the
 *     résumé alone, exactly as before;
 *   - a request answered "in progress" is asked again, unchanged, until the
 *     first run's analysis is there; nothing else on the page asks
 *     analyze-resume any other way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import paidEn from "../i18n/shards/paid/en.json";

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
import { clearAllResumeData } from "@/hooks/use-resume-storage";
import { invokePaidAnalysis, readSessionOnlyAnswer } from "@/lib/paid-analysis-run";

vi.setConfig(MOUNT_TEST_BUDGET);

const ANALYSIS = { industry: "Software", experienceLevel: "Senior", atsScore: { overall: 72 } };
const RESUME = "Senior software engineer with ten years of shipping. ".repeat(10);
const POSTING = "Platform Engineer at Example Corp: Kubernetes, Terraform and on-call ownership.";
const page = () => render(<BrowserRouter><Success /></BrowserRouter>);

/** A non-2xx answer as supabase-js hands it over: the response rides on the error. */
const failed = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  }),
});

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  clearAllResumeData();
  invoke.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async () => ({ data: null, error: null }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("the success page with no résumé in its tab", () => {
  it("runs the analysis from the copy the checkout kept, and asks the buyer nothing", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    invoke.mockImplementation(async (_fn: string, o: { body: Record<string, unknown> }) => {
      bodies.push(o.body);
      return o.body.fromStored === true
        ? { data: { ...ANALYSIS, hasJobDescription: true, shareId: "share_from_store", emailSent: false }, error: null }
        : failed(400, { error: "Resume text is required", storedInputs: { resume: true, posting: true, linkedIn: false } });
    });
    window.history.replaceState(null, "", "/success?session_id=cs_live_new_device");
    page();
    expect(await screen.findByTestId("analysis", {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText(en.resumeRecovery.title), "the buyer was asked for what the checkout kept").toBeNull();
    expect(bodies.map((b) => b.fromStored ?? false)).toEqual([false, true]);
    expect(bodies[1]).toMatchObject({ sessionId: "cs_live_new_device", resumeText: "" });
  });

  it("asks for the posting with the résumé when the checkout was made with one, and sends it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    invoke.mockImplementation(async (_fn: string, o: { body: Record<string, unknown> }) => {
      bodies.push(o.body);
      return o.body.resumeText
        ? { data: { ...ANALYSIS, shareId: "share_pasted", emailSent: false }, error: null }
        : failed(400, { error: "Resume text is required", checkoutHadPosting: true });
    });
    window.history.replaceState(null, "", "/success?session_id=cs_live_copy_gone");
    page();
    expect(await screen.findByText(en.resumeRecovery.title, {}, SLOW)).toBeInTheDocument();
    const postingBox = screen.getByPlaceholderText(paidEn.paidAnalysis.recovery.postingPlaceholder);
    fireEvent.click(screen.getByRole("button", { name: /Paste Text/ }));
    fireEvent.change(screen.getByPlaceholderText((text) => text.startsWith(en.resumeRecovery.pastePlaceholder.split("\n")[0])), { target: { value: RESUME } });
    fireEvent.change(postingBox, { target: { value: POSTING } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Analysis/ }));
    await waitFor(() => expect(bodies.length).toBe(2), SLOW);
    expect(bodies[1]).toMatchObject({ resumeText: RESUME.trim(), jobDescriptionText: POSTING, sessionId: "cs_live_copy_gone" });
    expect(await screen.findByTestId("analysis", {}, SLOW)).toBeInTheDocument();
  });

  it("told neither, as today's analyze-resume answers, asks for the résumé alone as before", async () => {
    invoke.mockImplementation(async () => ({ data: { error: "Resume text is required" }, error: null }));
    window.history.replaceState(null, "", "/success?session_id=cs_live_live_today");
    page();
    expect(await screen.findByText(en.resumeRecovery.title, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(paidEn.paidAnalysis.recovery.postingPlaceholder)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("a run in progress is waited for, not repeated", () => {
  it("an in-progress answer is asked again with the same body until the analysis is there", async () => {
    const answers = [
      failed(409, { error: "in progress", code: "analysis_in_progress", retryable: true }),
      failed(409, { error: "in progress", code: "analysis_in_progress", retryable: true }),
      { data: { ...ANALYSIS, alreadyDelivered: true, shareId: "share_first_run" }, error: null },
    ];
    const bodies: unknown[] = [];
    const waits: number[] = [];
    let waiting = 0;
    const body = { language: "en", resumeText: RESUME, sessionId: "cs_live_two_tabs" };
    const result = await invokePaidAnalysis(
      async () => { bodies.push(body); return answers.shift()!; },
      { sleep: async (ms) => { waits.push(ms); }, onWaiting: () => { waiting++; } },
    );
    expect(result.data.shareId).toBe("share_first_run");
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(waits).toEqual([5_000, 5_000]);
    expect(waiting, "the buyer was told more than once").toBe(1);
  });

  it("any other failure is returned at once, and the wait ends at its budget", async () => {
    const other = failed(504, { error: "timed out", code: "analysis_timed_out", retryable: true });
    let calls = 0;
    const once = await invokePaidAnalysis(async () => { calls++; return other; }, { sleep: async () => {} });
    expect(once).toBe(other);
    expect(calls).toBe(1);
    let clock = 0;
    calls = 0;
    const busy = await invokePaidAnalysis(
      async () => { calls++; return failed(409, { code: "analysis_in_progress" }); },
      { sleep: async (ms) => { clock += ms; }, now: () => clock, budgetMs: 20_000 },
    );
    expect(busy.error).toBeTruthy();
    expect(calls).toBe(5);
  });

  it("a session-only answer is read the same from a 400 and from a body", async () => {
    expect(await readSessionOnlyAnswer(failed(400, { storedInputs: { resume: true } }))).toEqual({ kind: "stored" });
    expect(await readSessionOnlyAnswer({ data: { error: "x", checkoutHadPosting: true }, error: null })).toEqual({ kind: "needsResume", askPosting: true });
    expect(await readSessionOnlyAnswer({ data: { alreadyDelivered: true, shareId: "s" }, error: null })).toMatchObject({ kind: "delivered" });
  });

  it("every ask the page makes of analyze-resume goes through the waiting caller, and names the page's language first", () => {
    const src = readFileSync(resolve(__dirname, "../pages/Success.tsx"), "utf8");
    const asks = src.match(/functions\.invoke\("analyze-resume", \{ body: \{[^}]*/g) ?? [];
    expect(asks.length, "the page's asks moved: point this guard at them").toBeGreaterThanOrEqual(4);
    // Section 57 reads each published ask up to its first closing brace and
    // wants the language inside it.
    for (const ask of asks) expect(ask, ask).toMatch(/\{ body: \{ language: i18n\.language,/);
    const wrapped = src.match(/askAnalysis\(\(\) => (?:fromStored\s*\?\s*)?supabase\.functions\.invoke\("analyze-resume"/g) ?? [];
    const inStoredBranch = src.match(/:\s*supabase\.functions\.invoke\("analyze-resume"/g) ?? [];
    expect(wrapped.length + inStoredBranch.length, "an ask of analyze-resume does not wait for a run in progress").toBe(asks.length);
  });
});
