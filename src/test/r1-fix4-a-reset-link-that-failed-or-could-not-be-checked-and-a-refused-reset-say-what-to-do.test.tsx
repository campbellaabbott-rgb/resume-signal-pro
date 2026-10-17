/**
 * R1 FIX, ROUND 4 (second recheck of R1, items 2 and 4).
 *
 * WHAT WAS WRONG.
 *   2. Until notify.resumebooster.work is verified, reset mail comes from
 *      Lovable's default sender, whose link is the auth server's /verify: it
 *      redirects to /auth?mode=reset with the session in the fragment, or
 *      with #error=... when the link expired or a mail scanner already opened
 *      it (a GET spends that link). The reset page never read that outcome:
 *      the person saw an empty "Enter your email" form and no word of what
 *      happened. And the provider dropped the stashed tokens BEFORE asking
 *      the auth server about them, so a network blip threw a still-valid
 *      recovery session away, silently.
 *   4. A reset for an account that signs in with Google ends in the guard's
 *      409 no_email_identity: the page said the address could not be
 *      confirmed (false: the mail reached the mailbox) and offered a new
 *      reset link that gets the same refusal every time. A 200 that says
 *      "not proven" (stale_session, not_a_mailbox_sign_in) offered Try
 *      again, which can never pass for that session.
 *
 * WHAT HOLDS NOW (the real page and provider; only the Supabase client, the
 * throwaway probe client and the broker are faked):
 *   - a stashed error on /auth?mode=reset shows that the reset link expired
 *     or was already used, with "Send a new reset link", which goes back to
 *     the request with the address this browser asked for filled in; the
 *     outcome is shown once;
 *   - a refused token pair says the same, and spends the stash and marker;
 *   - a token pair the auth server could not be asked about keeps the stash
 *     and the marker, says the server could not be reached, and Try again
 *     finishes the reset;
 *   - the guard's 409 no_email_identity says the account signs in with
 *     Google, offers the Google button and support, and no reset link;
 *   - a 200 "not proven" answer offers a fresh link, never Try again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  verifyOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  setSession: vi.fn(),
  invoke: vi.fn(),
  oauth: vi.fn(),
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
      signUp: async () => ({ data: {}, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signInWithOtp: async () => ({ data: {}, error: null }),
      verifyOtp: (...a: unknown[]) => h.verifyOtp(...a),
      resetPasswordForEmail: (...a: unknown[]) => h.resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => h.updateUser(...a),
      signOut: (...a: unknown[]) => h.signOut(...a),
      setSession: (...a: unknown[]) => h.setSession(...a),
      resend: async () => ({ error: null }),
    },
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: (...a: unknown[]) => h.oauth(...a) } } }));
vi.mock("@/lib/auth-probe", () => ({
  resolveTokens: (...a: unknown[]) => h.resolveTokens(...a),
  verifyLink: (...a: unknown[]) => h.verifyLink(...a),
  revoke: (...a: unknown[]) => h.revoke(...a),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a), useToast: () => ({ toast: h.toast }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import { AuthProvider } from "@/contexts/AuthContext";
import { PENDING_KEY, readPendingSignIn } from "@/lib/auth-fragment";
import Auth from "../pages/Auth";

vi.setConfig(MOUNT_TEST_BUDGET);

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${b64({ exp: 4_102_444_800, ...claims })}.sig`;
const claimsOf = (token: string) => JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
const sessionFor = (email: string, sid: string, method = "otp") => ({
  access_token: jwt({ sub: "u-" + sid, email, session_id: sid, amr: [{ method, timestamp: 1 }] }),
  refresh_token: "rt-" + sid,
  user: { id: "u-" + sid, email },
});
const emit = (event: string, s: unknown) => { h.session = s; for (const cb of h.listeners) cb(event, s); };

const mount = (at: string) => {
  window.history.replaceState(null, "", at);
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
};
const stash = (o: Record<string, string>) => sessionStorage.setItem("rb_url_stash", JSON.stringify({ ...o, _at: Date.now(), _path: "/auth" }));
const stashed = () => JSON.parse(sessionStorage.getItem("rb_url_stash") ?? "{}") as Record<string, unknown>;
const marker = (next: string, email?: string) => localStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), next, ...(email ? { email } : {}) }));
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };
const typeIn = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const guardRefuses = (status: number, body: Record<string, unknown>) =>
  h.invoke.mockResolvedValue({ data: null, error: { message: "refused", context: { status, clone: () => ({ json: async () => body }) } } });

const EXPIRED = "This reset link has expired or was already used, so no password was set. Ask for a new one.";

beforeEach(() => {
  h.listeners = [];
  h.session = null;
  localStorage.clear();
  sessionStorage.clear();
  for (const f of [h.verifyOtp, h.resetPasswordForEmail, h.updateUser, h.signOut, h.setSession, h.invoke, h.oauth, h.resolveTokens, h.verifyLink, h.revoke, h.toast]) f.mockReset();
  h.resolveTokens.mockImplementation(async (access: string, refresh: string) => {
    const c = claimsOf(access);
    return { session: { access_token: access, refresh_token: refresh, user: { id: c.sub, email: c.email } }, email: c.email };
  });
  h.setSession.mockImplementation(async (tokens: { access_token: string }) => {
    const c = claimsOf(tokens.access_token);
    act(() => emit("SIGNED_IN", { ...sessionFor(c.email, c.session_id), access_token: tokens.access_token }));
    return { data: {}, error: null };
  });
  h.revoke.mockResolvedValue(undefined);
  h.invoke.mockResolvedValue({ data: { proven: true, passwordCleared: false }, error: null });
  h.signOut.mockResolvedValue({ error: null });
  h.oauth.mockResolvedValue({ error: null, redirected: true });
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("2. a reset link from the default sender that failed, or could not be checked", () => {
  it("a stashed #error (expired, or spent by a mail scanner) says so, and 'Send a new reset link' goes back to the request with the address filled in", async () => {
    marker("/account", "member@example.com");
    stash({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" });
    mount("/auth?mode=reset");
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent(EXPIRED);
    expect(screen.queryByLabelText(/^Email$/), "the expired link was met with an empty form").toBeNull();
    await press("Send a new reset link");
    expect(await screen.findByLabelText(/^Email$/)).toHaveValue("member@example.com");
    expect(screen.queryByRole("alert"), "the outcome was shown twice").toBeNull();
    expect(stashed().error).toBeUndefined();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("a token pair the auth server refused says the link expired, and spends the stash and the marker", async () => {
    marker("/account", "member@example.com");
    stash({ access_token: jwt({ email: "member@example.com", session_id: "sid-a" }), refresh_token: "rt-a", type: "recovery" });
    h.resolveTokens.mockResolvedValue({ error: "Invalid Refresh Token: Already Used", transient: false });
    mount("/auth?mode=reset");
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent(EXPIRED);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(stashed().access_token).toBeUndefined();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    await press("Send a new reset link");
    expect(await screen.findByLabelText(/^Email$/)).toHaveValue("member@example.com");
  });

  it("a token pair the auth server could not be asked about keeps the stash and the marker, says so, and Try again finishes the reset", async () => {
    marker("/account", "member@example.com");
    stash({ access_token: jwt({ email: "member@example.com", session_id: "sid-b" }), refresh_token: "rt-b", type: "recovery" });
    h.resolveTokens.mockResolvedValueOnce({ error: "Failed to fetch", transient: true });
    mount("/auth?mode=reset");
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("We couldn't reach the sign-in server. Check your connection and try again; the link is still valid.");
    expect(stashed().access_token, "a still-valid recovery session was thrown away by a network blip").toBeTruthy();
    expect(readPendingSignIn()?.email, "the marker was spent by a network blip").toBe("member@example.com");
    expect(h.setSession).not.toHaveBeenCalled();
    await press("Try again");
    expect(await screen.findByLabelText("New password", {}, SLOW)).toBeInTheDocument();
    expect(h.resolveTokens).toHaveBeenCalledTimes(2);
    expect(h.setSession).toHaveBeenCalledTimes(1);
    expect(stashed().access_token, "an adopted session's tokens stayed in the stash").toBeUndefined();
  });
});

describe("4. a refused reset says what is true and offers a way that can work", () => {
  const recovery = sessionFor("gmailer@example.com", "sid-r", "otp");
  async function reachChecking() {
    h.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    h.verifyOtp.mockImplementation(async () => { act(() => emit("PASSWORD_RECOVERY", recovery)); return { data: { session: recovery }, error: null }; });
    mount("/auth?mode=reset");
    await screen.findByRole("heading", { name: "Reset your password" });
    typeIn(/^Email$/, "gmailer@example.com");
    await press("Email me a reset link");
    fireEvent.change(await screen.findByLabelText("Code from the email"), { target: { value: "654321" } });
    await press("Continue");
  }

  it("409 no_email_identity: the account signs in with Google, with the Google button and support, and no reset link", async () => {
    guardRefuses(409, { error: "This account has no email sign-in to check the address against.", reason: "no_email_identity", proven: false, passwordCleared: false });
    await reachChecking();
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("This account signs in with Google, so it has no password to change here. Continue with Google to sign in.");
    expect(document.body.textContent).not.toMatch(/We couldn't confirm this address with that link or code/);
    expect(screen.queryByRole("button", { name: "Send a new reset link" }), "a reset link that gets the same refusal every time").toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Email support" })).toHaveAttribute("href", "mailto:resumeboostersupp@gmail.com");
    expect(screen.queryByLabelText("New password")).toBeNull();
    await press(/Continue with Google/);
    expect(h.oauth).toHaveBeenCalledTimes(1);
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it.each(["stale_session", "not_a_mailbox_sign_in"])("a 200 'not proven' answer (%s) offers a fresh link, never Try again", async (reason) => {
    h.invoke.mockResolvedValue({ data: { proven: false, passwordCleared: false, reason }, error: null });
    await reachChecking();
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("We couldn't confirm this address with that link or code, so no password was set. Ask for a new reset link, or email support.");
    expect(screen.queryByRole("button", { name: "Try again" }), "Try again can never pass for this session").toBeNull();
    await press("Send a new reset link");
    expect(await screen.findByLabelText(/^Email$/)).toHaveValue("gmailer@example.com");
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("a guard that could not answer (503) still offers Try again (control)", async () => {
    guardRefuses(503, { error: "unavailable", reason: "unavailable", proven: false, passwordCleared: false });
    await reachChecking();
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("We couldn't confirm this address just now, so no password was set.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
  });
});
