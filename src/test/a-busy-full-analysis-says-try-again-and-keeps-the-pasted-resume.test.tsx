/**
 * A BUSY FULL ANALYSIS SAYS TRY AGAIN AND KEEPS THE PASTED RÉSUMÉ (S14X-110;
 * bug round 2026-11-12).
 *
 * WHAT WAS WRONG. When the model gateway was busy (429), out of credit (402),
 * or a service was briefly unreachable (503, or the platform's 502), nothing
 * was saved and the purchase was untouched, yet the success page treated it
 * like any other failure: an English sentence from the server, a toast telling
 * the buyer to contact support, and, after a pasted résumé, a Try again that
 * reloaded the page and threw the pasted text away.
 *
 * NOW analyze-resume answers every outage 503 with retryable: true (a busy
 * gateway with code model_busy), and the page treats a retryable answer, or a
 * 502, 503 or 429 from today's live function, like a timeout: it says in the
 * page's language that the service is busy and the purchase is safe
 * (paidAnalysis.busy), the toast says try again, and Try again asks again with
 * the résumé already given. A failure no second ask can fix still names
 * support.
 *
 * The page is mounted for real, with only the backend and the toast faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const { invoke, rpc, toasts, toastFn } = vi.hoisted(() => {
  const toasts: Array<{ title?: string; description?: string; variant?: string }> = [];
  return {
    invoke: vi.fn(),
    rpc: vi.fn(),
    toasts,
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
import i18n from "@/i18n";
import { setResumeData, clearAllResumeData } from "@/hooks/use-resume-storage";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Senior software engineer with ten years of shipping. ".repeat(10);
const PASTED = "Jane Doe. Staff engineer, payments platform, eight years. ".repeat(8);
const answered = (status: number, body: unknown) => ({
  data: null,
  error: new FunctionsHttpError(new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": typeof body === "string" ? "text/plain" : "application/json" } })),
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
const BUSY = () => i18n.t("paidAnalysis.busy");
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

describe("the main flow (the résumé stored at checkout)", () => {
  for (const [name, answer] of [
    ["a busy gateway (503 model_busy)", () => answered(503, { error: "Service temporarily unavailable. Please try again later.", code: "model_busy", retryable: true })],
    ["Stripe unreachable (503 stripe_unavailable)", () => answered(503, { error: "Service temporarily unavailable. Please try again later.", code: "stripe_unavailable", retryable: true })],
    ["a busy gateway before analyze-resume 2026-11-12.1 (429)", () => answered(429, { error: "Too many requests. Please try again later." })],
    ["an outage before analyze-resume 2026-11-12.1 (503 with no flag)", () => answered(503, { error: "Service temporarily unavailable. Please try again later." })],
    ["the platform's gateway (502, no JSON)", () => answered(502, "bad gateway")],
  ] as const) {
    it(`${name}: says the service is busy and the purchase is safe, the toast says try again, and Try again asks again`, async () => {
      invoke.mockImplementation(async (fn: string) => (fn === "analyze-resume" ? answer() : { data: {}, error: null }));
      setResumeData("tempSessionId:cs_live_busy_main", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
      mount("?session_id=cs_live_busy_main");

      expect(BUSY(), "paidAnalysis.busy is not in the shard").not.toBe("paidAnalysis.busy");
      expect(await screen.findByText(BUSY(), {}, SLOW), "the page did not say the service is busy and the purchase is safe").toBeInTheDocument();
      const failed = toasts.find((t) => t.variant === "destructive");
      expect(failed?.description, "a busy service sent the buyer to support").toBe(i18n.t("success.toast.analysisFailedRetryDesc"));
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(reload).toHaveBeenCalledTimes(1);
    });
  }

  it("a failure a second ask cannot fix (500) still names support", async () => {
    invoke.mockImplementation(async (fn: string) =>
      fn === "analyze-resume" ? answered(500, { error: "An error occurred while processing your request. Please try again." }) : { data: {}, error: null });
    setResumeData("tempSessionId:cs_live_broken_main", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    mount("?session_id=cs_live_broken_main");
    await waitFor(() => expect(toasts.find((t) => t.variant === "destructive")).toBeTruthy(), SLOW);
    expect(toasts.find((t) => t.variant === "destructive")?.description).toBe(i18n.t("success.toast.analysisFailedDesc"));
    expect(screen.queryByText(BUSY())).toBeNull();
  });
});

describe("the recovery flow (the buyer pasted the résumé on this page)", () => {
  it("busy: says so, and Try again asks again in place with the pasted text", async () => {
    let analyses = 0;
    invoke.mockImplementation(async (fn: string, opts: { body: { resumeText?: string } }) => {
      if (fn !== "analyze-resume") return { data: {}, error: null };
      if (!opts.body.resumeText) return answered(400, { error: "Resume text is required" });
      analyses++;
      return analyses === 1 ? answered(503, { error: "Service temporarily unavailable. Please try again later.", code: "model_busy", retryable: true }) : { data: DELIVERED, error: null };
    });
    mount("?session_id=cs_live_busy_pasted");
    fireEvent.click(await screen.findByRole("button", { name: /paste text/i }, SLOW));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: PASTED } });
    fireEvent.click(screen.getByRole("button", { name: /generate analysis/i }));

    expect(await screen.findByText(BUSY(), {}, SLOW)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(asks().length, "Try again did not ask again").toBe(2), SLOW);
    expect(reload, "Try again reloaded the page and threw away the pasted résumé").not.toHaveBeenCalled();
    const [first, second] = asks().map(([, o]) => (o as { body: Record<string, unknown> }).body);
    expect(second).toEqual(first);
    await waitFor(() => expect(screen.queryByText(BUSY())).toBeNull(), SLOW);
  });
});

describe("the words", () => {
  it("paidAnalysis.busy is in every language, and only English says it in English", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const shard = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/shards/paid", `${l}.json`), "utf8")).paidAnalysis;
    const en = shard("en").busy;
    expect(en).toBeTruthy();
    for (const l of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      expect(shard(l).busy, `${l}: paidAnalysis.busy`).toBeTruthy();
      expect(shard(l).busy, `${l} says it in English`).not.toBe(en);
    }
  });
});
