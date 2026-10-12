/**
 * R1: THE SIGN-IN PAGE ONCE ITS SWITCHES ARE ON (the follow-up publish).
 *
 * The same page as r1-signin-auth.test.tsx, with GOOGLE_SIGN_IN_LIVE,
 * CODE_SIGN_IN_LIVE and RECOVERY_LIVE turned on (APPLE stays off for good):
 *   - each control renders only because its switch is on, and Apple never;
 *   - Google sets the pending marker BEFORE leaving, and returns to
 *     /auth?mode=return;
 *   - the code sign-in creates the account with the Terms, verifies type
 *     'email', and takes a pasted code with spaces;
 *   - THE RESET RACE (register CP-001 with review problem 4): the account
 *     guard is awaited before the new-password form exists, and the new
 *     password is written only after the guard answered; then every other
 *     device is signed out. A guard that refuses sets no password.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TERMS_VERSION } from "@/config/terms";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.mock("@/config/auth-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/auth-providers")>()),
  GOOGLE_SIGN_IN_LIVE: true,
  CODE_SIGN_IN_LIVE: true,
  RECOVERY_LIVE: true,
  APPLE_SIGN_IN_LIVE: false,
}));

const h = vi.hoisted(() => ({
  listeners: [] as Array<(event: string, s: unknown) => void>,
  session: null as unknown,
  order: [] as string[],
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
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "../pages/Auth";

vi.setConfig(MOUNT_TEST_BUDGET);

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${b64({ exp: 4_102_444_800, ...claims })}.sig`;
const sessionFor = (email: string, sid: string, method: string) => ({
  access_token: jwt({ sub: "u-" + sid, email, session_id: sid, amr: [{ method, timestamp: 1 }] }),
  refresh_token: "rt-" + sid,
  user: { id: "u-" + sid, email },
});
const emit = (event: string, s: unknown) => { h.session = s; for (const cb of h.listeners) cb(event, s); };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
const mount = (at: string) => render(
  <MemoryRouter initialEntries={[at]}>
    <AuthProvider>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </AuthProvider>
  </MemoryRouter>,
);
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };
const typeIn = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  h.listeners = [];
  h.session = null;
  h.order = [];
  localStorage.clear();
  sessionStorage.clear();
  for (const f of [h.signUp, h.signInWithPassword, h.signInWithOtp, h.verifyOtp, h.resetPasswordForEmail, h.updateUser, h.signOut, h.setSession, h.invoke, h.oauth]) f.mockReset();
  h.invoke.mockResolvedValue({ data: { proven: false, passwordCleared: false, reason: "password" }, error: null });
  h.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe("each control renders because its switch is on", () => {
  it("Google, the code and Forgot password show; Apple never does", async () => {
    mount("/auth");
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email me a sign-in code" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apple|microsoft/i })).toBeNull();
    // The code leads; the password is one press away, with Forgot password under it.
    await press("Use a password instead");
    expect(screen.getByLabelText(/^Password$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/auth?mode=reset");
  });

  it("Google sets the pending marker before it leaves, and returns to /auth?mode=return", async () => {
    h.oauth.mockImplementation(async () => {
      h.order.push(`marker:${JSON.parse(localStorage.getItem("rb_auth_pending") ?? "null")?.next}`);
      return { error: null, redirected: true };
    });
    mount("/auth?next=%2Fjobs");
    await press(/Continue with Google/);
    expect(h.oauth).toHaveBeenCalledWith("google", { redirect_uri: `${window.location.origin}/auth?mode=return` });
    expect(h.order).toEqual(["marker:/jobs"]);
  });
});

describe("the emailed code", () => {
  it("creates the account with the Terms, then verifies the pasted code as type 'email'", async () => {
    h.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    h.verifyOtp.mockImplementation(async () => {
      const s = sessionFor("new@example.com", "sid-c", "otp");
      emit("SIGNED_IN", s);
      return { data: { session: s }, error: null };
    });
    mount("/auth?next=%2Fjobs");
    typeIn(/^Email$/, "new@example.com");
    await press("Email me a sign-in code");
    const opts = (h.signInWithOtp.mock.calls[0][0] as { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string; data: Record<string, string> } });
    expect(opts.email).toBe("new@example.com");
    expect(opts.options.shouldCreateUser).toBe(true);
    expect(opts.options.data.terms_version).toBe(TERMS_VERSION);
    expect(opts.options.emailRedirectTo).toBe(`${window.location.origin}/auth?mode=confirm&next=%2Fjobs`);
    expect(await screen.findByText("If this address can sign in, a code is on its way. It usually arrives within a minute.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bsent\b/i);
    const field = screen.getByLabelText("Code from the email");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    fireEvent.change(field, { target: { value: "123 456" } });
    expect(field).toHaveValue("123456");
    await press("Sign in");
    expect(h.verifyOtp).toHaveBeenCalledWith({ email: "new@example.com", token: "123456", type: "email" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs"));
  });
});

describe("password recovery: the guard is awaited before the new password", () => {
  const recovery = sessionFor("member@example.com", "sid-r", "recovery");

  async function reachChecking() {
    h.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    h.verifyOtp.mockImplementation(async () => {
      h.order.push("verify");
      emit("PASSWORD_RECOVERY", recovery);
      return { data: { session: recovery }, error: null };
    });
    mount("/auth?mode=reset");
    expect(await screen.findByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    typeIn(/^Email$/, "member@example.com");
    await press("Email me a reset code");
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith("member@example.com", { redirectTo: `${window.location.origin}/auth?mode=reset` });
    expect(await screen.findByText(/If an account exists for this address, a reset code is on its way/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Code from the email"), { target: { value: "654321" } });
    await press("Continue");
    expect(h.verifyOtp).toHaveBeenCalledWith({ email: "member@example.com", token: "654321", type: "recovery" });
  }

  it("no password form while the guard works; the new password is written only after it answered; then other devices are signed out", async () => {
    const guard = deferred<{ data: unknown; error: null }>();
    h.invoke.mockImplementation((fn: string, opts: { headers: Record<string, string> }) => {
      h.order.push(`guard:${fn}:${opts.headers.Authorization === `Bearer ${recovery.access_token}` ? "own-token" : "other"}`);
      return guard.promise.then((r) => { h.order.push("guard-answered"); return r; });
    });
    h.updateUser.mockImplementation(async () => { h.order.push("updateUser"); return { data: {}, error: null }; });
    h.signOut.mockImplementation(async (o: unknown) => { h.order.push(`signOut:${JSON.stringify(o)}`); return { error: null }; });
    await reachChecking();
    expect(await screen.findByText("Checking your account…")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText("New password"), "the password form showed before the guard answered").toBeNull();
    expect(h.updateUser).not.toHaveBeenCalled();
    await act(async () => { guard.resolve({ data: { proven: true, passwordCleared: true }, error: null }); });
    const field = await screen.findByLabelText("New password", {}, SLOW);
    expect(field).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(field, { target: { value: "short" } });
    await press("Set new password");
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 8 characters.");
    fireEvent.change(field, { target: { value: "a-new-long-password" } });
    await press("Set new password");
    await screen.findByText("Your new password is set, and every other device was signed out.");
    expect(h.updateUser).toHaveBeenCalledWith({ password: "a-new-long-password" });
    expect(h.invoke, "the guard was asked more than once for one session").toHaveBeenCalledTimes(1);
    expect(h.order).toEqual(["verify", "guard:auth-signed-in:own-token", "guard-answered", "updateUser", 'signOut:{"scope":"others"}']);
    // The guard cleared a password on its way: no toast for that during a reset.
    expect(document.body.textContent).not.toMatch(/Your old password was cleared/);
  });

  it("a guard that refuses sets no password", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { message: "refused", context: { status: 409, clone: () => ({ json: async () => ({ error: "conflict", reason: "email_changed_after_proof" }) }) } } });
    await reachChecking();
    expect(await screen.findByText(/We couldn't confirm this address just now, so no password was set/, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("the emailed reset link (a stashed recovery session) waits for the guard the same way", async () => {
    const guard = deferred<{ data: unknown; error: null }>();
    h.invoke.mockImplementation(() => guard.promise);
    h.setSession.mockImplementation(async () => { emit("SIGNED_IN", recovery); return { data: {}, error: null }; });
    sessionStorage.setItem("rb_url_stash", JSON.stringify({ access_token: recovery.access_token, refresh_token: recovery.refresh_token, type: "recovery", _at: Date.now(), _path: "/auth" }));
    localStorage.setItem("rb_auth_pending", JSON.stringify({ at: Date.now(), next: "/account" }));
    mount("/auth?mode=reset");
    expect(await screen.findByText("Checking your account…", {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).toBeNull();
    await act(async () => { guard.resolve({ data: { proven: true, passwordCleared: false }, error: null }); });
    expect(await screen.findByLabelText("New password", {}, SLOW)).toBeInTheDocument();
  });
});
