/**
 * A REFUNDED FULL ANALYSIS SAYS SO AND ASKS FOR NO RÉSUMÉ (RC-S13-048; bug
 * round 2026-11-12).
 *
 * WHAT WAS WRONG. analyze-resume refuses a purchase it will never analyse
 * (refunded, not a Full Analysis, not found, already used, a Pro grant it
 * cannot honour), and the success page read every one of those answers as
 * "the résumé is missing": a refunded buyer opening their link was asked to
 * paste their résumé, did, and was then shown a bare English sentence and a
 * toast sending them to support, with a Try again that could never work.
 *
 * NOW each refusal carries a code (purchase_refunded, payment_required,
 * purchase_not_found, session_used, grant_refused), and the page shows a
 * panel that says which, in the page's language (paidAnalysis.refused.*),
 * with only the way home: no résumé box and no Try again. Until analyze-resume
 * 2026-11-12.1 is live a refusal carries no code, so the page also judges it
 * by its status (402, 401, a 409 that is not "in progress").
 *
 * The page is mounted for real, with only the backend and the toast faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { PRIVACY_EMAIL } from "@/lib/resume-retention";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Senior software engineer with ten years of shipping. ".repeat(10);
const PASTED = "Jane Doe. Staff engineer, payments platform, eight years. ".repeat(8);
const answered = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
});
const words = (key: string) => i18n.t(`paidAnalysis.refused.${key}`, { email: PRIVACY_EMAIL });

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
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = (search: string) => render(
  <MemoryRouter initialEntries={[`/success${search}`]}>
    <Success />
  </MemoryRouter>,
);

/** The refused panel, its words, and nothing that asks for a résumé or offers to try again. */
async function expectRefused(key: string) {
  const panel = await screen.findByTestId("analysis-refused", {}, SLOW);
  expect(words(key), `paidAnalysis.refused.${key} is not a string in the shard`).not.toBe(`paidAnalysis.refused.${key}`);
  expect(panel.textContent, "the panel does not say why").toContain(words(key));
  expect(panel.textContent).toContain(i18n.t("paidAnalysis.refused.title"));
  expect(screen.queryByRole("button", { name: /paste text/i }), "a refused purchase was asked for the résumé").toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /try again/i }), "a refused purchase was offered a Try again that cannot work").toBeNull();
  expect(screen.getByRole("button", { name: i18n.t("success.error.backHome") })).toBeInTheDocument();
  expect(toasts.find((t) => t.description === i18n.t("success.toast.analysisFailedDesc")), "a refusal sent the buyer to support").toBeUndefined();
}

describe("the purchase opened by its link (asked by the session alone)", () => {
  for (const [name, answer, key] of [
    ["refunded, with its code", () => answered(402, { error: "This purchase was refunded, so it can no longer be delivered.", code: "purchase_refunded" }), "refunded"],
    ["refunded, before analyze-resume 2026-11-12.1 (no code)", () => answered(402, { error: "This purchase was refunded, so it can no longer be delivered." }), "refunded"],
    ["not a Full Analysis", () => answered(402, { error: "Payment verification required.", code: "payment_required" }), "notThisProduct"],
    ["not a Full Analysis (no code)", () => answered(402, { error: "Payment verification required." }), "notThisProduct"],
    ["not found", () => answered(401, { error: "Payment verification required.", code: "purchase_not_found" }), "notFound"],
    ["not found (no code)", () => answered(401, { error: "Payment verification required." }), "notFound"],
    ["already used and its copy gone", () => answered(409, { error: "This session has already been used for analysis.", code: "session_used" }), "used"],
    ["already used (no code)", () => answered(409, { error: "This session has already been used for analysis." }), "used"],
    ["a Pro grant the plan no longer covers", () => answered(402, { error: "Subscription is not active", code: "grant_refused" }), "grant"],
    ["a Pro grant past the day's ten openings (S14X-079)", () => answered(429, { error: "Pro includes up to 10 Full Analyses a day and 60 a month.", code: "grant_cap", window: "daily" }), "cap"],
  ] as const) {
    it(`${name}: says so, and asks for no résumé`, async () => {
      invoke.mockImplementation(async (fn: string) => (fn === "analyze-resume" ? answer() : { data: {}, error: null }));
      mount("?session_id=cs_live_refused_link");
      await expectRefused(key);
      expect(invoke.mock.calls.filter(([fn]) => fn === "analyze-resume"), "the page asked again").toHaveLength(1);
    });
  }

  it("a 409 'in progress' is still waited on, not refused", async () => {
    let n = 0;
    invoke.mockImplementation(async (fn: string) => {
      if (fn !== "analyze-resume") return { data: {}, error: null };
      n++;
      return n === 1 ? answered(409, { error: "Your analysis is already being made.", code: "analysis_in_progress" }) : answered(400, { error: "Resume text is required" });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount("?session_id=cs_live_inprogress_link");
      await vi.advanceTimersByTimeAsync(6_000);
      expect(await screen.findByRole("button", { name: /paste text/i }, SLOW)).toBeInTheDocument();
      expect(screen.queryByTestId("analysis-refused")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the analysis asked with a résumé", () => {
  it("the stored résumé's analysis refused as refunded: the panel, not an error and a support toast", async () => {
    invoke.mockImplementation(async (fn: string) =>
      fn === "analyze-resume" ? answered(402, { error: "This purchase was refunded, so it can no longer be delivered.", code: "purchase_refunded" }) : { data: {}, error: null });
    setResumeData("tempSessionId:cs_live_refused_main", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    mount("?session_id=cs_live_refused_main");
    await expectRefused("refunded");
  });

  it("the pasted résumé's analysis refused as already used: the panel, and the pasted text is let go", async () => {
    invoke.mockImplementation(async (fn: string, opts: { body: { resumeText?: string } }) => {
      if (fn !== "analyze-resume") return { data: {}, error: null };
      if (!opts.body.resumeText) return answered(400, { error: "Resume text is required" });
      return answered(409, { error: "This session has already been used for analysis.", code: "session_used" });
    });
    mount("?session_id=cs_live_refused_pasted");
    fireEvent.click(await screen.findByRole("button", { name: /paste text/i }, SLOW));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: PASTED } });
    fireEvent.click(screen.getByRole("button", { name: /generate analysis/i }));
    await expectRefused("used");
  });
});

describe("the words", () => {
  it("every refusal and its title are in the shard, in every language, and only English says them in English", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const shard = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/shards/paid", `${l}.json`), "utf8")).paidAnalysis;
    const en = shard("en").refused;
    for (const k of ["title", "refunded", "notThisProduct", "notFound", "used", "grant", "cap"]) expect(en?.[k], `paidAnalysis.refused.${k}`).toBeTruthy();
    for (const l of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const r = shard(l).refused;
      for (const k of ["title", "refunded", "notThisProduct", "notFound", "used", "grant", "cap"]) {
        expect(r?.[k], `${l}: paidAnalysis.refused.${k}`).toBeTruthy();
        expect(r[k], `${l} says paidAnalysis.refused.${k} in English`).not.toBe(en[k]);
      }
    }
  });
});
