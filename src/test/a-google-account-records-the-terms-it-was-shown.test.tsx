/**
 * A GOOGLE ACCOUNT RECORDS THE TERMS IT WAS SHOWN (S12-078).
 *
 * WHAT WAS WRONG. A password or code sign-up stores terms_version and
 * terms_accepted_at in the account's metadata. An account made through
 * Google stored neither: nothing wrote them on its return. And the sign-in
 * page printed its "By continuing you agree to the Terms" line under the
 * form, below the Google button, so a Google sign-up never passed it.
 *
 * WHAT HOLDS NOW:
 *   - the Terms line comes before the Google button;
 *   - pressing Google there leaves a mark (the Terms version and the moment,
 *     nothing about the person), and a session with no terms_version that
 *     arrives while the mark is fresh gets the acceptance written through
 *     updateUser, dated by the press; the mark then goes;
 *   - no mark (a press that showed no Terms, a stale one, another version),
 *     or an account that already holds a version: nothing is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TERMS_VERSION } from "@/config/terms";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/config/auth-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/auth-providers")>()),
  GOOGLE_SIGN_IN_LIVE: true,
}));

const h = vi.hoisted(() => ({
  listeners: [] as Array<(event: string, s: unknown) => void>,
  updateUser: vi.fn(),
  invoke: vi.fn(),
  oauth: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { h.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      updateUser: (...a: unknown[]) => h.updateUser(...a),
      signOut: async () => ({ error: null }),
    },
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: (...a: unknown[]) => h.oauth(...a) } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "../pages/Auth";
import { GOOGLE_TERMS_KEY, GOOGLE_TERMS_TTL_MS, noteTermsShown, termsToRecord } from "@/lib/google-terms";

vi.setConfig(MOUNT_TEST_BUDGET);

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${b64({ exp: 4_102_444_800, ...claims })}.sig`;
const googleSession = (meta: Record<string, unknown> = {}) => ({
  access_token: jwt({ sub: "u-g", email: "new@example.com", session_id: "sid-g", amr: [{ method: "oauth", timestamp: 1 }] }),
  refresh_token: "rt-g",
  user: { id: "u-g", email: "new@example.com", user_metadata: meta, app_metadata: { provider: "google" } },
});
const emit = (event: string, s: unknown) => act(() => { for (const cb of h.listeners) cb(event, s); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const termsCalls = () => h.updateUser.mock.calls.filter((c) => (c[0] as { data?: { terms_version?: string } })?.data?.terms_version);

const mountAuth = () => render(
  <MemoryRouter initialEntries={["/auth"]}>
    <AuthProvider>
      <Routes><Route path="/auth" element={<Auth />} /></Routes>
    </AuthProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  h.listeners = [];
  localStorage.clear();
  sessionStorage.clear();
  h.updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  h.invoke.mockReset().mockResolvedValue({ data: { proven: true, passwordCleared: false }, error: null });
  h.oauth.mockReset().mockResolvedValue({ error: null, redirected: true });
});
afterEach(cleanup);

describe("the mark a Google press leaves", () => {
  it("is read only for an account with no Terms yet, while fresh and for the current version", () => {
    const at = Date.UTC(2026, 10, 3, 9, 0, 0);
    expect(termsToRecord({ user_metadata: {} }, at)).toBeNull();
    noteTermsShown(at);
    expect(JSON.parse(localStorage.getItem(GOOGLE_TERMS_KEY)!)).toEqual({ v: TERMS_VERSION, at });
    expect(termsToRecord({ user_metadata: {} }, at + 5_000)).toEqual({ terms_version: TERMS_VERSION, terms_accepted_at: new Date(at).toISOString() });
    expect(termsToRecord({ user_metadata: { terms_version: "2026-07-10" } }, at + 5_000)).toBeNull();
    expect(termsToRecord({ user_metadata: {} }, at + GOOGLE_TERMS_TTL_MS + 1)).toBeNull();
    localStorage.setItem(GOOGLE_TERMS_KEY, JSON.stringify({ v: "2020-01-01", at }));
    expect(termsToRecord({ user_metadata: {} }, at + 5_000)).toBeNull();
  });
});

describe("the sign-in page", () => {
  it("shows the Terms line before the Google button, and the press leaves the mark", async () => {
    mountAuth();
    const google = await screen.findByRole("button", { name: /Continue with Google/ });
    const terms = screen.getByTestId("purchase-terms");
    expect(terms.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING, "the Terms line precedes the Google button").toBeTruthy();
    expect(screen.getAllByTestId("purchase-terms")).toHaveLength(1);
    await act(async () => { fireEvent.click(google); });
    expect(h.oauth).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(GOOGLE_TERMS_KEY) ?? "null")?.v).toBe(TERMS_VERSION);
  });
});

describe("the account the Google return brings", () => {
  it("records the Terms, dated by the press, and spends the mark", async () => {
    const pressedAt = Date.now() - 4_000;
    noteTermsShown(pressedAt);
    mountAuth();
    emit("SIGNED_IN", googleSession());
    await flush();
    await waitFor(() => expect(termsCalls()).toHaveLength(1));
    expect(termsCalls()[0][0]).toEqual({ data: { terms_version: TERMS_VERSION, terms_accepted_at: new Date(pressedAt).toISOString() } });
    expect(localStorage.getItem(GOOGLE_TERMS_KEY)).toBeNull();
    // The account's next event carries the version: nothing more is written.
    emit("USER_UPDATED", googleSession({ terms_version: TERMS_VERSION }));
    await flush();
    expect(termsCalls()).toHaveLength(1);
  });

  describe("and the mailbox guard's window", () => {
    // The guard refuses to record a proof if the account changed since its
    // sign-in, and the Terms write is such a change (a user_modified entry in
    // the auth log). So the write waits until the guard has answered.
    const guardAsks = () => h.invoke.mock.calls.filter((c) => c[0] === "auth-signed-in");
    const heldGuard = () => {
      let answer: (v: unknown) => void = () => undefined;
      h.invoke.mockImplementation(() => new Promise((r) => { answer = r; }));
      return (v: unknown) => answer(v);
    };

    it("writes the Terms only after the guard has answered", async () => {
      const answer = heldGuard();
      noteTermsShown(Date.now() - 4_000);
      mountAuth();
      emit("SIGNED_IN", googleSession());
      await flush();
      expect(guardAsks(), "the guard was never asked").toHaveLength(1);
      expect(termsCalls(), "the write landed inside the guard's window").toHaveLength(0);
      await act(async () => { answer({ data: { proven: true, passwordCleared: false }, error: null }); });
      await waitFor(() => expect(termsCalls()).toHaveLength(1));
      expect(localStorage.getItem(GOOGLE_TERMS_KEY)).toBeNull();
    });

    it("a guard that could not answer still lets the Terms be written", async () => {
      h.invoke.mockRejectedValue(new Error("network"));
      noteTermsShown(Date.now() - 4_000);
      mountAuth();
      emit("SIGNED_IN", googleSession());
      await waitFor(() => expect(termsCalls()).toHaveLength(1));
    });

    it("a session that ended while the guard was asked writes nothing on whoever comes next, and keeps the mark", async () => {
      const answer = heldGuard();
      noteTermsShown(Date.now() - 4_000);
      mountAuth();
      emit("SIGNED_IN", googleSession());
      await flush();
      emit("SIGNED_OUT", null);
      await act(async () => { answer({ data: { proven: true, passwordCleared: false }, error: null }); });
      await flush();
      expect(termsCalls()).toHaveLength(0);
      expect(localStorage.getItem(GOOGLE_TERMS_KEY)).not.toBeNull();
    });

    it("two events for one sign-in write the Terms once", async () => {
      const answer = heldGuard();
      noteTermsShown(Date.now() - 4_000);
      mountAuth();
      emit("SIGNED_IN", googleSession());
      emit("INITIAL_SESSION", googleSession());
      await flush();
      await act(async () => { answer({ data: { proven: true, passwordCleared: false }, error: null }); });
      await waitFor(() => expect(termsCalls()).toHaveLength(1));
      await flush();
      expect(termsCalls()).toHaveLength(1);
    });
  });

  it("without a mark writes nothing", async () => {
    mountAuth();
    emit("SIGNED_IN", googleSession());
    await flush();
    expect(termsCalls()).toHaveLength(0);
  });

  it("an account that already agreed is left alone, and the mark goes", async () => {
    noteTermsShown(Date.now() - 1_000);
    mountAuth();
    emit("SIGNED_IN", googleSession({ terms_version: "2026-07-10", terms_accepted_at: "2026-08-01T00:00:00.000Z" }));
    await flush();
    expect(termsCalls()).toHaveLength(0);
    expect(localStorage.getItem(GOOGLE_TERMS_KEY)).toBeNull();
  });

  it("a failed write keeps the mark for the next event", async () => {
    h.updateUser.mockResolvedValue({ data: null, error: { message: "network" } });
    noteTermsShown(Date.now() - 1_000);
    mountAuth();
    emit("SIGNED_IN", googleSession());
    await flush();
    await waitFor(() => expect(termsCalls()).toHaveLength(1));
    expect(localStorage.getItem(GOOGLE_TERMS_KEY)).not.toBeNull();
  });
});
