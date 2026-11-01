/**
 * A FULL ANALYSIS THAT RAN OUT OF TIME SAYS SO, AND ASKS AGAIN (S13-001).
 *
 * WHAT WAS WRONG. analyze-resume's one big model call ran out of time after
 * 126 s and answered 500, and the success page took that as the end:
 *   - the main flow showed whatever English text the server sent and a toast
 *     telling the buyer to contact support, for a purchase that was never
 *     redeemed and could simply be asked again;
 *   - the résumé-recovery flow (no résumé in this tab, so the buyer pastes
 *     it) threw the raw FunctionsHttpError, so the page read "Edge Function
 *     returned a non-2xx status code", and its Try again reloaded the page,
 *     which threw away the text the buyer had just pasted.
 *
 * analyze-resume now answers a timed-out chain 504 with retryable: true, and
 * the platform's own gateway answers 504 with no JSON at all when a function
 * outlives it. Either way the page has to say, in the buyer's language, that
 * nothing was saved or charged twice and that trying again is safe, and its
 * Try again has to ask again with the résumé already given: the main flow by
 * reloading (the stored résumé is read again, see
 * a-paid-analysis-that-failed-offers-the-buyer-another-try), the recovery
 * flow in place, with the pasted text it still holds.
 *
 * The page is mounted for real, with only the backend and the toast faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const { invoke, rpc, toasts, toastFn } = vi.hoisted(() => {
  const toasts: Array<{ title?: string; description?: string; variant?: string }> = [];
  return {
    invoke: vi.fn(),
    rpc: vi.fn(),
    toasts,
    // One function for the page's whole life: Success re-runs its load effect
    // whenever `toast` changes identity.
    toastFn: (t: { title?: string; description?: string; variant?: string }) => { toasts.push(t); },
  };
});
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
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastFn }), toast: toastFn }));

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

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const locale = (l: string) =>
  JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales", `${l}.json`), "utf8")) as {
    success: { error: Record<string, string>; toast: Record<string, string> };
  };
const EN = locale("en").success;

const RESUME = "Senior software engineer with ten years of shipping. ".repeat(10);
const PASTED = "Jane Doe. Staff engineer, payments platform, eight years. ".repeat(8);
// What analyze-resume answers a chain that ran out of time.
const SERVER_TIMEOUT = {
  error: "The analysis took too long and was stopped before anything was saved. Your purchase is safe: nothing was charged twice, and trying again is free.",
  code: "analysis_timed_out",
  retryable: true,
};
const timedOut = () => ({
  data: null,
  error: new FunctionsHttpError(new Response(JSON.stringify(SERVER_TIMEOUT), { status: 504, headers: { "content-type": "application/json" } })),
});
// What the platform's gateway answers a function that outlived it: no JSON.
const gatewayTimedOut = () => ({
  data: null,
  error: new FunctionsHttpError(new Response("upstream request timeout", { status: 504, headers: { "content-type": "text/plain" } })),
});
const DELIVERED = {
  shareId: "0123456789abcdef01234567",
  emailSent: false,
  industry: "Software",
  experienceLevel: "senior",
  atsScore: { score: 74, breakdown: { keywordMatch: 70, formatting: 75, structure: 76, relevance: 73 }, improvements: [] },
  optimizedBullets: [{ original: "did things", improved: "Shipped things", explanation: "verb" }],
  actionVerbs: ["Shipped"],
  keywords: { found: ["TypeScript"], missing: ["Kubernetes"] },
  redFlags: [],
};

const asks = () => invoke.mock.calls.filter(([fn, opts]) => fn === "analyze-resume" && (opts as { body: { resumeText?: string } }).body.resumeText);
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  clearAllResumeData();
  invoke.mockReset();
  rpc.mockReset();
  toasts.length = 0;
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_temp_resume") return { data: [{ resume_text: RESUME, linkedin_text: null, job_description_text: null }], error: null };
    if (name === "get_analysis_by_share_id") return { data: [], error: null };
    return { data: null, error: null };
  });
  // jsdom cannot reload: record it, and read everything else through.
  const real = window.location;
  reload = vi.fn();
  const location: Record<string, unknown> = { reload, assign: (u: string) => real.assign(u), replace: (u: string) => real.replace(u), toString: () => real.href };
  for (const k of ["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"] as const) {
    Object.defineProperty(location, k, { get: () => real[k], enumerable: true });
  }
  vi.stubGlobal("location", location);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = (search: string) => render(
  <MemoryRouter initialEntries={[`/success${search}`]}>
    <Success />
  </MemoryRouter>,
);

describe("the words a timed-out analysis is answered with", () => {
  it("every locale says it, and only English says it in English", () => {
    expect(EN.error.timedOut, "en.json has no success.error.timedOut").toBeTruthy();
    for (const l of LOCALES) {
      const s = locale(l).success.error.timedOut;
      expect(s, `${l}.json has no success.error.timedOut`).toBeTruthy();
      if (l !== "en" && l !== "en-GB") expect(s, `${l} says it in English`).not.toBe(EN.error.timedOut);
    }
  });
});

describe("the main flow (the résumé stored at checkout)", () => {
  for (const [name, answer] of [["analyze-resume's own 504", timedOut], ["the gateway's bare 504", gatewayTimedOut]] as const) {
    it(`after ${name}, says nothing was lost, offers Try again, and the toast does not send the buyer to support`, async () => {
      invoke.mockImplementation(async (fn: string) => (fn === "analyze-resume" ? answer() : { data: {}, error: null }));
      setResumeData("tempSessionId:cs_live_slow_once", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
      mount("?session_id=cs_live_slow_once");

      expect(await screen.findByText(EN.error.timedOut, {}, SLOW), "the page did not say the analysis ran out of time and can be asked again").toBeInTheDocument();
      expect(asks()).toHaveLength(1);
      const failed = toasts.find((t) => t.variant === "destructive");
      expect(failed?.description, "the toast told a buyer with a redeemable purchase to contact support").toBe(EN.toast.analysisFailedRetryDesc);

      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      // The stored résumé is read again on the reload (the retry guard proves the second ask).
      expect(reload, "Try again did not reload the page that reads the stored résumé again").toHaveBeenCalledTimes(1);
    });
  }
});

describe("the recovery flow (the buyer pasted the résumé on this page)", () => {
  const pasteAndAnalyze = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /paste text/i }, SLOW));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: PASTED } });
    fireEvent.click(screen.getByRole("button", { name: /generate analysis/i }));
  };

  it("after a timeout, says so in words, and Try again asks again in place with the pasted text", async () => {
    let analyses = 0;
    invoke.mockImplementation(async (fn: string, opts: { body: { resumeText?: string } }) => {
      if (fn !== "analyze-resume") return { data: {}, error: null };
      // The session-only ask for an analysis this purchase already received: none.
      if (!opts.body.resumeText) return { data: { error: "No analysis yet." }, error: null };
      analyses++;
      return analyses === 1 ? timedOut() : { data: DELIVERED, error: null };
    });
    mount("?session_id=cs_live_pasted");
    await pasteAndAnalyze();

    expect(await screen.findByText(EN.error.timedOut, {}, SLOW), "the page did not say the analysis ran out of time and can be asked again").toBeInTheDocument();
    expect(screen.queryByText(/non-2xx/i), "the page showed the client library's error text").toBeNull();
    expect(toasts.find((t) => t.variant === "destructive")?.description).toBe(EN.toast.analysisFailedRetryDesc);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(asks().length, "Try again did not ask again").toBe(2), SLOW);
    expect(reload, "Try again reloaded the page and threw away the pasted résumé").not.toHaveBeenCalled();
    const [first, second] = asks().map(([, o]) => (o as { body: { resumeText?: string; sessionId?: string } }).body);
    expect(second.resumeText, "the retry did not carry the résumé the buyer pasted").toBe(PASTED.trim());
    expect(second.sessionId).toBe("cs_live_pasted");
    expect(second).toEqual(first);
    await waitFor(() => expect(screen.queryByText(EN.error.timedOut)).toBeNull(), SLOW);
  });

  it("an error a second ask cannot fix still goes back to asking for the résumé", async () => {
    invoke.mockImplementation(async (fn: string, opts: { body: { resumeText?: string } }) => {
      if (fn !== "analyze-resume") return { data: {}, error: null };
      if (!opts.body.resumeText) return { data: { error: "No analysis yet." }, error: null };
      return {
        data: null,
        error: new FunctionsHttpError(new Response(JSON.stringify({ error: "Resume text is too short." }), { status: 400 })),
      };
    });
    mount("?session_id=cs_live_pasted_short");
    await pasteAndAnalyze();

    expect(await screen.findByText("Resume text is too short.", {}, SLOW)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(asks()).toHaveLength(1);
  });
});
