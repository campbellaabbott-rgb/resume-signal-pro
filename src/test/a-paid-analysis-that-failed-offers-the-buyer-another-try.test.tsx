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
 * A button that renders is not yet a retry. Pressing it has to end in a
 * second ask: the same purchase, with the résumé the buyer already gave. The
 * page keeps the stored résumé's key until an analysis succeeds, and the
 * server no longer deletes the résumé when it is read (get_temp_resume,
 * 20251223230313). The button reloads the page, and jsdom cannot reload. So
 * the test stands in for the browser: it records the reload, then mounts the
 * page again at whatever address the browser then holds, over the same
 * storage, which is all a reload keeps. That case routes through the real
 * window.history rather than a memory router. If the button moved the page to
 * another purchase before reloading, the second mount would load that
 * purchase, and the test would see it. A button that does nothing never gets
 * as far as a second ask, and neither does a page that drops the key on
 * failure. Both are reported as "Try again did not ask again".
 *
 * The page is mounted for real, with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

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

  it("and Try again asks again, for the same purchase, with the résumé already given", async () => {
    const TEMP = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    setResumeData("tempSessionId:cs_live_failed_once", TEMP);
    // Everything but reload reads through to the browser's own location, so
    // the address the page sees is the one window.history holds.
    const real = window.location;
    const reload = vi.fn();
    const location: Record<string, unknown> = { reload, assign: (u: string) => real.assign(u), replace: (u: string) => real.replace(u), toString: () => real.href };
    for (const k of ["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"] as const) {
      Object.defineProperty(location, k, { get: () => real[k], enumerable: true });
    }
    vi.stubGlobal("location", location);
    const asks = () => invoke.mock.calls.filter(([fn]) => fn === "analyze-resume");
    const reads = () => rpc.mock.calls.filter(([name]) => name === "get_temp_resume");
    const page = () => render(<BrowserRouter><Success /></BrowserRouter>);

    window.history.replaceState(null, "", "/success?session_id=cs_live_failed_once");
    page();
    expect(await screen.findByText("The analysis service is busy. Please try again.", {}, SLOW)).toBeInTheDocument();
    expect(asks()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    // What a reload keeps: the address and the browser's storage. Nothing else.
    if (reload.mock.calls.length > 0) {
      cleanup();
      page();
    }
    await waitFor(() => expect(asks().length, "Try again did not ask again").toBe(2), SLOW);

    const [first, second] = asks().map(([, opts]) => (opts as { body: { sessionId?: string; resumeText?: string } }).body);
    expect(second.sessionId, "the retry asked for a different purchase").toBe("cs_live_failed_once");
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.resumeText, "the retry did not carry the résumé the buyer already gave").toBe(RESUME);
    expect(reads().map(([, args]) => args), "the stored résumé was not read again by its key").toEqual([
      { p_session_id: TEMP },
      { p_session_id: TEMP },
    ]);
  });

  it("for a shared link that failed to load, offers no Try again -- there is no purchase behind it", async () => {
    mount("?share=0123456789abcdef01234567");
    expect(await screen.findByText(/Analysis not found/i, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(screen.getByRole("button", { name: /back to home/i })).toBeInTheDocument();
  });
});
