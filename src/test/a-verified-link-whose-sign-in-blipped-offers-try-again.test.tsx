/**
 * A VERIFIED LINK WHOSE SIGN-IN BLIPPED OFFERS TRY AGAIN (S14X-208).
 *
 * WHAT WAS WRONG. The confirm step spends the link at verifyLink, and only
 * then hands the session it got to the site's client (setSession, which GETs
 * /auth/v1/user). A network drop or a 503 at that second step came back as
 * an error, adoptSession read every error as false, and the page said "This
 * link has expired or was already used": a good link, already spent, and the
 * person sent to ask for another mail during the very outage. The stash path
 * did the same after it had discarded the tokens.
 *
 * WHAT HOLDS NOW, with the real page and provider (only the Supabase client,
 * the probe client and the broker faked): a blip keeps the verified session
 * and says "We verified your link but couldn't finish signing in", with Try
 * again, which hands the same session over and lands where the sign-in was
 * headed. A definite refusal (a 400) still says the link expired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.mock("@/config/auth-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/auth-providers")>()),
  GOOGLE_SIGN_IN_LIVE: true,
  CODE_SIGN_IN_LIVE: false,
  RECOVERY_LIVE: true,
  APPLE_SIGN_IN_LIVE: false,
}));

const h = vi.hoisted(() => ({
  listeners: [] as Array<(event: string, s: unknown) => void>,
  session: null as unknown,
  setSession: vi.fn(),
  invoke: vi.fn(),
  resolveTokens: vi.fn(),
  verifyLink: vi.fn(),
  revoke: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { h.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => { await Promise.resolve(); return { data: { session: h.session } }; },
      setSession: (...a: unknown[]) => h.setSession(...a),
      signOut: async () => ({ error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    },
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/lib/auth-probe", () => ({
  resolveTokens: (...a: unknown[]) => h.resolveTokens(...a),
  verifyLink: (...a: unknown[]) => h.verifyLink(...a),
  revoke: (...a: unknown[]) => h.revoke(...a),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a), useToast: () => ({ toast: h.toast }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import { AuthProvider } from "@/contexts/AuthContext";
import { PENDING_KEY } from "@/lib/auth-fragment";
import Auth from "../pages/Auth";

vi.setConfig(MOUNT_TEST_BUDGET);

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${b64({ exp: 4_102_444_800, ...claims })}.sig`;
const claimsOf = (token: string) => JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
const sessionFor = (email: string, sid: string) => ({
  access_token: jwt({ sub: "u-" + sid, email, session_id: sid, amr: [{ method: "otp", timestamp: 1 }] }),
  refresh_token: "rt-" + sid,
  user: { id: "u-" + sid, email },
});
const emit = (event: string, s: unknown) => { h.session = s; for (const cb of h.listeners) cb(event, s); };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
const mount = (at: string) => {
  window.history.replaceState(null, "", at);
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
};
const stash = (o: Record<string, string>) => sessionStorage.setItem("rb_url_stash", JSON.stringify({ ...o, _at: Date.now(), _path: "/auth" }));
const marker = (next: string, email?: string) => localStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), next, ...(email ? { email } : {}) }));
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

/** What supabase-js 2.87.1 answers for setSession offline or on a 503 (AuthRetryableFetchError). */
const BLIP = { data: { session: null, user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" } };
const REFUSED = { data: { session: null, user: null }, error: { name: "AuthApiError", status: 400, message: "Invalid Refresh Token: Already Used" } };
const adopts = async (tokens: { access_token: string }) => {
  const c = claimsOf(tokens.access_token);
  act(() => emit("SIGNED_IN", { ...sessionFor(c.email, c.session_id), access_token: tokens.access_token }));
  return { data: {}, error: null };
};

beforeEach(() => {
  h.listeners = [];
  h.session = null;
  localStorage.clear();
  sessionStorage.clear();
  for (const f of [h.setSession, h.invoke, h.resolveTokens, h.verifyLink, h.revoke, h.toast]) f.mockReset();
  h.resolveTokens.mockImplementation(async (access: string, refresh: string) => {
    const c = claimsOf(access);
    return { session: { access_token: access, refresh_token: refresh, user: { id: c.sub, email: c.email } }, email: c.email };
  });
  h.setSession.mockImplementation(adopts);
  h.invoke.mockResolvedValue({ data: { proven: true, passwordCleared: false }, error: null });
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("S14X-208: the confirm step", () => {
  it("a blip after the link was verified keeps the session and offers Try again, which finishes the sign-in", async () => {
    marker("/jobs", "me@example.com");
    h.verifyLink.mockResolvedValueOnce({ session: sessionFor("me@example.com", "sid-c1"), email: "me@example.com" });
    h.setSession.mockResolvedValueOnce(BLIP);
    mount("/auth?mode=confirm&token_hash=th-c1&type=magiclink");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent("We verified your link but couldn't finish signing in. Check your connection and try again.");
    expect(document.body.textContent, "a verified link was called expired").not.toMatch(/expired or was already used/);
    await press("Try again");
    expect(h.verifyLink, "the spent link was asked again").toHaveBeenCalledTimes(1);
    expect(h.setSession).toHaveBeenCalledTimes(2);
    expect(h.setSession.mock.calls[1][0]).toEqual(h.setSession.mock.calls[0][0]);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs"), SLOW);
  });

  it("a definite refusal still says the link expired", async () => {
    marker("/jobs", "me@example.com");
    h.verifyLink.mockResolvedValueOnce({ session: sessionFor("me@example.com", "sid-c2"), email: "me@example.com" });
    h.setSession.mockResolvedValueOnce(REFUSED);
    mount("/auth?mode=confirm&token_hash=th-c2&type=magiclink");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent("This link has expired or was already used. Sign in again to get a new one.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("a hand-over that throws is a blip too", async () => {
    marker("/jobs", "me@example.com");
    h.verifyLink.mockResolvedValueOnce({ session: sessionFor("me@example.com", "sid-c3"), email: "me@example.com" });
    h.setSession.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mount("/auth?mode=confirm&token_hash=th-c3&type=magiclink");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't finish signing in/);
  });
});

describe("S14X-208: the stash path", () => {
  it("tokens the auth server vouched for, whose hand-over blipped, are kept and Try again adopts them", async () => {
    marker("/jobs", "me@example.com");
    stash({ access_token: jwt({ sub: "u-s1", email: "me@example.com", session_id: "sid-s1" }), refresh_token: "rt-s1", type: "magiclink" });
    h.setSession.mockResolvedValueOnce(BLIP);
    mount("/auth");
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("We verified your link but couldn't finish signing in. Check your connection and try again.");
    expect(document.body.textContent).not.toMatch(/expired or was already used/);
    await press("Try again");
    expect(h.resolveTokens, "the tokens were asked about again").toHaveBeenCalledTimes(1);
    expect(h.setSession).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs"), SLOW);
  });

  it("a definite refusal of the hand-over still fails", async () => {
    marker("/jobs", "me@example.com");
    stash({ access_token: jwt({ sub: "u-s2", email: "me@example.com", session_id: "sid-s2" }), refresh_token: "rt-s2", type: "magiclink" });
    h.setSession.mockResolvedValueOnce(REFUSED);
    mount("/auth");
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("This link has expired or was already used. Sign in again to get a new one.");
  });
});
