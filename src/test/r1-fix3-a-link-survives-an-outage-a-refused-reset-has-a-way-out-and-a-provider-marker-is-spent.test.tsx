/**
 * R1 FIX, ROUND 3 (lead decisions D, E and F of 2026-10-12):
 *
 *   D. A confirmation link is KEPT until its verification succeeds. A
 *      transient failure (the auth server unreachable, a 5xx, a timeout) says
 *      the server could not be reached and offers Try again in the same tab;
 *      only a definite answer (expired, already used) says so and spends the
 *      link. Before, the token_hash was taken from the stash before the call,
 *      so an outage was reported as an expired link and the person was sent
 *      to ask for a new mail during exactly the outage R1 targets.
 *   E. The Google pending marker is cleared on a failed or cancelled return
 *      and when /auth mounts without a provider return, a provider marker is
 *      live for ten minutes rather than an hour, and a session adopted under
 *      an address-less marker ALWAYS shows "Signed in as ... Not you?", link
 *      type or not. Before, an abandoned Google press left a marker that
 *      adopted any crafted token pair for an hour, silently.
 *   F. A reset the guard refuses for a reason no retry can pass (the account
 *      changed since the sign-in, no email identity, ...) does not dead-end on
 *      Try again: it says plainly what happened and offers "Send a new reset
 *      link" and "Email support". A guard that could not answer (503) keeps
 *      Try again, with the way back and the support address beside it.
 *
 * Same harness as r1-signin-flags-on.test.tsx: the real page and provider,
 * only the Supabase client, the throwaway probe client and the broker faked.
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
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
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
      signUp: (...a: unknown[]) => h.signUp(...a),
      signInWithPassword: (...a: unknown[]) => h.signInWithPassword(...a),
      signInWithOtp: (...a: unknown[]) => h.signInWithOtp(...a),
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
import { PENDING_KEY, readPendingSignIn, setPendingSignIn } from "@/lib/auth-fragment";
import { PENDING_SIGN_IN_TTL_MS, PROVIDER_PENDING_TTL_MS } from "@/config/auth-providers";
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
const probed = (email: string, sid = "sid-p") => ({ session: sessionFor(email, sid), email });
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
const typeIn = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const stashed = () => JSON.parse(sessionStorage.getItem("rb_url_stash") ?? "{}") as Record<string, unknown>;

beforeEach(() => {
  h.listeners = [];
  h.session = null;
  localStorage.clear();
  sessionStorage.clear();
  for (const f of [h.signUp, h.signInWithPassword, h.signInWithOtp, h.verifyOtp, h.resetPasswordForEmail, h.updateUser, h.signOut, h.setSession, h.invoke, h.oauth, h.resolveTokens, h.verifyLink, h.revoke, h.toast]) f.mockReset();
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
  h.invoke.mockResolvedValue({ data: { proven: false, passwordCleared: false, reason: "password" }, error: null });
  h.signOut.mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("D. a confirmation link survives an outage", () => {
  it("the server unreachable: the link is kept, the page says so and offers Try again, and the second press finishes the sign-in", async () => {
    stash({ token_hash: "th-1", type: "magiclink" });
    marker("/account", "me@example.com");
    h.verifyLink.mockResolvedValueOnce({ error: "Failed to fetch", transient: true }).mockResolvedValueOnce(probed("me@example.com"));
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the sign-in server. Check your connection and try again; the link is still valid.");
    expect(document.body.textContent).not.toMatch(/expired or was already used/);
    expect(stashed().token_hash, "the link was spent by an outage").toBe("th-1");
    expect(readPendingSignIn()?.email, "the marker was spent by an outage").toBe("me@example.com");
    await press("Try again");
    expect(h.verifyLink).toHaveBeenCalledTimes(2);
    expect(h.verifyLink).toHaveBeenLastCalledWith("th-1", "magiclink");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/account"), SLOW);
    expect(stashed().token_hash, "a spent link stayed in the stash").toBeUndefined();
  });

  it("a definite refusal (expired, already used) says so and spends the link", async () => {
    stash({ token_hash: "th-2", type: "magiclink" });
    marker("/account", "me@example.com");
    h.verifyLink.mockResolvedValue({ error: "Email link is invalid or has expired", transient: false });
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent("This link has expired or was already used. Sign in again to get a new one.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(stashed().token_hash).toBeUndefined();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe("E. the provider marker is spent, short-lived, and never silent", () => {
  it("a provider return that failed (a stashed error) clears the marker, so no later crafted link rides it", async () => {
    marker("/account");
    stash({ error: "access_denied", error_code: "otp_expired", error_description: "cancelled" });
    mount("/auth?mode=return");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in didn't finish. Please try again.");
    expect(localStorage.getItem(PENDING_KEY), "the marker outlived the failed return").toBeNull();
  });

  it("a token pair with no link type, adopted under an address-less marker, still shows 'Signed in as ... Not you?'", async () => {
    marker("/account");
    stash({ access_token: jwt({ email: "attacker@evil.example", session_id: "sid-x" }), refresh_token: "rt-x" });
    mount("/jobs");
    await waitFor(() => expect(h.setSession).toHaveBeenCalledTimes(1), SLOW);
    const banner = await screen.findByRole("status", {}, SLOW);
    expect(banner).toHaveTextContent("Signed in as attacker@evil.example.");
    expect(screen.getByRole("button", { name: "Not you? Sign out" })).toBeInTheDocument();
  });

  it("/auth mounted without a provider return (Back from Google) clears an address-less marker and keeps one that names an address", async () => {
    marker("/jobs");
    mount("/auth");
    await screen.findByRole("heading", { name: "Sign in or create your free account" });
    expect(localStorage.getItem(PENDING_KEY), "an abandoned Google press left its marker").toBeNull();
    cleanup();
    h.listeners = [];
    marker("/jobs", "me@example.com");
    mount("/auth");
    await screen.findByRole("heading", { name: "Sign in or create your free account" });
    expect(readPendingSignIn()?.email).toBe("me@example.com");
  });

  it("a Google press writes a provider marker, which lives ten minutes, while a marker for a typed address lives the hour", () => {
    const now = 1_700_000_000_000;
    setPendingSignIn("/jobs", now, null, { provider: true });
    expect(readPendingSignIn(now + PROVIDER_PENDING_TTL_MS - 1)?.next).toBe("/jobs");
    expect(readPendingSignIn(now + PROVIDER_PENDING_TTL_MS + 1), "a provider marker outlived ten minutes").toBeNull();
    setPendingSignIn("/jobs", now, "me@example.com");
    expect(readPendingSignIn(now + PROVIDER_PENDING_TTL_MS + 1)?.email).toBe("me@example.com");
    expect(readPendingSignIn(now + PENDING_SIGN_IN_TTL_MS + 1)).toBeNull();
    expect(PROVIDER_PENDING_TTL_MS).toBeLessThan(PENDING_SIGN_IN_TTL_MS);
  });

  it("the Google button writes the provider marker", async () => {
    h.oauth.mockResolvedValue({ error: null, redirected: true });
    mount("/auth?next=%2Fjobs");
    await press(/Continue with Google/);
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as { provider?: boolean; next?: string };
    expect(raw?.provider).toBe(true);
    expect(raw?.next).toBe("/jobs");
  });
});

describe("F. a refused reset has a way out", () => {
  const recovery = sessionFor("member@example.com", "sid-r", "otp");
  async function reachChecking() {
    h.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    h.verifyOtp.mockImplementation(async () => { act(() => emit("PASSWORD_RECOVERY", recovery)); return { data: { session: recovery }, error: null }; });
    mount("/auth?mode=reset");
    await screen.findByRole("heading", { name: "Reset your password" });
    typeIn(/^Email$/, "member@example.com");
    await press("Email me a reset link");
    fireEvent.change(await screen.findByLabelText("Code from the email"), { target: { value: "654321" } });
    await press("Continue");
  }

  it("a refusal no retry can pass (the account changed since the sign-in) says so, offers a new link and support, and never Try again", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { message: "refused", context: { status: 409, clone: () => ({ json: async () => ({ error: "changed", reason: "changed_since_sign_in", proven: false, passwordCleared: true }) }) } } });
    await reachChecking();
    const alert = await screen.findByRole("alert", {}, SLOW);
    expect(alert).toHaveTextContent("We couldn't confirm this address with that link or code, so no password was set. Ask for a new reset link, or email support.");
    expect(screen.queryByRole("button", { name: "Try again" }), "a refusal that cannot pass on retry offered Try again").toBeNull();
    expect(screen.getByRole("link", { name: "Email support" })).toHaveAttribute("href", "mailto:resumeboostersupp@gmail.com");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth");
    expect(screen.queryByLabelText("New password")).toBeNull();
    await press("Send a new reset link");
    expect(await screen.findByLabelText(/^Email$/)).toHaveValue("member@example.com");
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it("a guard that could not answer (503) keeps Try again, with the way back and support beside it", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { message: "unavailable", context: { status: 503, clone: () => ({ json: async () => ({ error: "unavailable", reason: "unavailable", proven: false, passwordCleared: false }) }) } } });
    await reachChecking();
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("We couldn't confirm this address just now, so no password was set.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth");
    expect(screen.getByRole("link", { name: "Email support" })).toHaveAttribute("href", "mailto:resumeboostersupp@gmail.com");
  });

  it("the reset copy promises a link or a code, never a code alone (the default sender's template carries only a link)", async () => {
    h.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    mount("/auth?mode=reset");
    await screen.findByRole("heading", { name: "Reset your password" });
    expect(screen.getByText(/we'll email a link \(or a 6-digit code\) you can use to choose a new password/)).toBeInTheDocument();
    typeIn(/^Email$/, "member@example.com");
    await press("Email me a reset link");
    expect(await screen.findByText(/If an account exists for this address, check your email for a link \(or a 6-digit code\)\. Either one lets you choose a new password\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/a reset code is on its way/);
    expect(document.body.textContent).not.toMatch(/\bsent\b/i);
  });
});
