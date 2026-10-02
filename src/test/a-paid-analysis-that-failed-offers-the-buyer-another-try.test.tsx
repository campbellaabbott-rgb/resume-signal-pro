/**
 * A PAID ANALYSIS THAT FAILED OFFERS THE BUYER ANOTHER TRY.
 *
 * WHAT WAS WRONG. When analyze-resume failed for a buyer, the success page's
 * error state offered one thing: the way home. That matched a server that
 * answered every retry with "already used" -- the claim was written before
 * the AI ran -- so there was nothing to try again. The server now redeems a
 * session only once its analysis exists, so a failure leaves the purchase
 * redeemable, and the page has to say so: a Try again control on the paid
 * path. It must NOT appear for a shared link (?share=...), which has no
 * purchase behind it to retry.
 *
 * The page is mounted for real, with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  clearAllResumeData();
  invoke.mockReset();
  rpc.mockReset();
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "analyze-resume") return { data: { error: "The analysis service is busy. Please try again." }, error: null };
    return { data: {}, error: null };
  });
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

describe("the success page's error state", () => {
  it("after a paid analysis fails, offers Try again beside the way home", async () => {
    setResumeData("tempSessionId:cs_live_failed_once", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    mount("?session_id=cs_live_failed_once");
    expect(await screen.findByText("The analysis service is busy. Please try again.", {}, SLOW)).toBeInTheDocument();
    expect(invoke.mock.calls.filter(([fn]) => fn === "analyze-resume"), "the page never asked analyze-resume, so this is not its error state").toHaveLength(1);
    expect(screen.getByRole("button", { name: /try again/i }), "a buyer whose purchase is still redeemable was offered only the way home").toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to home/i })).toBeInTheDocument();
  });

  it("for a shared link that failed to load, offers no Try again -- there is no purchase behind it", async () => {
    mount("?share=0123456789abcdef01234567");
    expect(await screen.findByText(/Analysis not found/i, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back to home/i })).toBeInTheDocument();
  });
});
