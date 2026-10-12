/**
 * R1: THE SIGN-IN PAGE AS IT SHIPS FIRST (every switch off but the password).
 *
 * Mounted for real (AuthProvider + /auth) with only the Supabase client and
 * the provider broker faked:
 *   - one Continue screen: no sign-up/sign-in switch, no magic link, nothing
 *     that says a mail was sent;
 *   - no Google button, no code field, no "Forgot password?" and no reset
 *     screen while their switches are off;
 *   - a new address becomes an account with the Terms recorded; an address
 *     that already has one goes on to sign in, and nothing says it exists;
 *   - a confirmation link is spent only by the press;
 *   - a session that arrives in the URL is adopted silently only with the
 *     pending marker, else the signed-in-as prompt asks (login CSRF);
 *   - a provider return goes to the marker's next, never off-site.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TERMS_VERSION } from "@/config/terms";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

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
  resend: vi.fn(),
  invoke: vi.fn(),
  oauth: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { h.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: h.session } }),
      signUp: (...a: unknown[]) => h.signUp(...a),
      signInWithPassword: (...a: unknown[]) => h.signInWithPassword(...a),
      signInWithOtp: (...a: unknown[]) => h.signInWithOtp(...a),
      verifyOtp: (...a: unknown[]) => h.verifyOtp(...a),
      resetPasswordForEmail: (...a: unknown[]) => h.resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => h.updateUser(...a),
      signOut: (...a: unknown[]) => h.signOut(...a),
      setSession: (...a: unknown[]) => h.setSession(...a),
      resend: (...a: unknown[]) => h.resend(...a),
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
const sessionFor = (email: string, sid = "sid-1", method = "password") => ({
  access_token: jwt({ sub: "u-" + sid, email, session_id: sid, amr: [{ method, timestamp: 1 }] }),
  refresh_token: "rt-" + sid,
  user: { id: "u-" + sid, email },
});
const emit = (event: string, s: unknown) => act(() => { h.session = s; for (const cb of h.listeners) cb(event, s); });

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
const stash = (o: Record<string, string>) => sessionStorage.setItem("rb_url_stash", JSON.stringify({ ...o, _at: Date.now(), _path: "/auth" }));
const marker = (next: string) => localStorage.setItem("rb_auth_pending", JSON.stringify({ at: Date.now(), next }));

beforeEach(() => {
  h.listeners = [];
  h.session = null;
  localStorage.clear();
  sessionStorage.clear();
  for (const f of [h.signUp, h.signInWithPassword, h.signInWithOtp, h.verifyOtp, h.resetPasswordForEmail, h.updateUser, h.signOut, h.setSession, h.resend, h.invoke, h.oauth]) f.mockReset();
  h.invoke.mockResolvedValue({ data: { proven: false, passwordCleared: false, reason: "password" }, error: null });
  h.signOut.mockResolvedValue({ error: null });
  h.setSession.mockImplementation(async (tokens: { access_token: string }) => {
    const claims = JSON.parse(atob(tokens.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    emit("SIGNED_IN", { ...sessionFor(claims.email, claims.session_id, "otp"), access_token: tokens.access_token });
    return { data: {}, error: null };
  });
});
afterEach(cleanup);

const typeIn = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = async (name: RegExp) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

describe("one Continue screen", () => {
  it("email first, the password leads, the Terms line above one button, and no switch between sign-up and sign-in", async () => {
    mount("/auth");
    expect(await screen.findByRole("heading", { name: "Sign in or create your free account" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email$/)).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText(/^Password$/)).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByTestId("purchase-terms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Continue$/ })).toBeInTheDocument();
    expect(screen.queryByText(/Already have an account|New here\?|Create free account/)).toBeNull();
  });

  it("no magic link anywhere, and no screen says a mail was sent", async () => {
    mount("/auth");
    await screen.findByRole("heading", { name: "Sign in or create your free account" });
    expect(screen.queryByText(/magic link|sign-in link/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bsent\b/i);
    cleanup();
    stash({ token_hash: "th-1", type: "magiclink" });
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    expect(document.body.textContent).not.toMatch(/\bsent\b/i);
  });
});

describe("a method whose switch is off does not render", () => {
  it("no Google button, no code field, no Forgot password", async () => {
    mount("/auth");
    await screen.findByRole("heading", { name: "Sign in or create your free account" });
    expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /apple|microsoft/i })).toBeNull();
    expect(document.querySelector('input[autocomplete="one-time-code"]')).toBeNull();
    expect(screen.queryByText(/sign-in code/i)).toBeNull();
    expect(screen.queryByText(/Forgot password/i)).toBeNull();
  });

  it("?mode=reset is the Continue screen while recovery is off", async () => {
    mount("/auth?mode=reset");
    expect(await screen.findByRole("heading", { name: "Sign in or create your free account" })).toBeInTheDocument();
    expect(screen.queryByText(/Reset your password/)).toBeNull();
  });
});

describe("the password path", () => {
  it("a new address becomes an account, records the Terms, and lands where it was headed", async () => {
    h.signUp.mockImplementation(async () => {
      expect(JSON.parse(localStorage.getItem("rb_auth_pending") ?? "null")?.next, "the marker is set before the sign-up leaves").toBe("/jobs");
      return { data: { session: sessionFor("new@example.com"), user: { identities: [{}] } }, error: null };
    });
    mount("/auth?next=%2Fjobs");
    typeIn(/^Email$/, "new@example.com");
    typeIn(/^Password$/, "longenough1");
    await press(/^Continue$/);
    const arg = h.signUp.mock.calls[0][0] as { email: string; options: { emailRedirectTo: string; data: Record<string, string> } };
    expect(arg.email).toBe("new@example.com");
    expect(arg.options.data.terms_version).toBe(TERMS_VERSION);
    expect(arg.options.emailRedirectTo).toBe(`${window.location.origin}/auth?mode=confirm&next=%2Fjobs`);
    expect(h.signInWithPassword).not.toHaveBeenCalled();
    emit("SIGNED_IN", sessionFor("new@example.com"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs"));
    expect(localStorage.getItem("rb_auth_pending"), "a password sign-in leaves no marker for a later link to ride").toBeNull();
  });

  it("an address that already has an account goes on to sign in with the same password, and nothing says it exists", async () => {
    h.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "User already registered" } });
    h.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    mount("/auth");
    typeIn(/^Email$/, "member@example.com");
    typeIn(/^Password$/, "wrongpassword");
    await press(/^Continue$/);
    expect(h.signInWithPassword).toHaveBeenCalledWith({ email: "member@example.com", password: "wrongpassword" });
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't sign you in with that email and password.");
    expect(document.body.textContent).not.toMatch(/already|exists|have an account/i);
    expect(screen.getByLabelText(/^Email$/)).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
    expect(localStorage.getItem("rb_auth_pending"), "a refused password left a marker a crafted link could ride").toBeNull();
  });

  it("the auth server's 'Confirm email' answer for an existing address also goes on to sign in", async () => {
    h.signUp.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    h.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    mount("/auth");
    typeIn(/^Email$/, "member@example.com");
    typeIn(/^Password$/, "rightpassword");
    await press(/^Continue$/);
    expect(h.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/on its way/);
  });

  it("a password shorter than a new account allows only tries to sign in", async () => {
    h.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    mount("/auth");
    typeIn(/^Email$/, "old@example.com");
    typeIn(/^Password$/, "short");
    await press(/^Continue$/);
    expect(h.signUp).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/A new account needs at least 8 characters/);
  });
});

describe("a confirmation link from the mail (?mode=confirm)", () => {
  it("is spent only by the press, and goes where this browser's sign-in was headed", async () => {
    stash({ token_hash: "th-press", type: "magiclink" });
    marker("/jobs");
    h.verifyOtp.mockImplementation(async () => { emit("SIGNED_IN", sessionFor("member@example.com", "sid-2", "magiclink")); return { data: { session: sessionFor("member@example.com", "sid-2", "magiclink") }, error: null }; });
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.verifyOtp, "loading the page spent the link").not.toHaveBeenCalled();
    await press(/^Continue$/);
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: "th-press", type: "magiclink" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs"));
    expect(sessionStorage.getItem("rb_url_stash") ?? "").not.toContain("th-press");
  });

  it("without a sign-in started here, says whose account it is before anything else", async () => {
    stash({ token_hash: "th-cold", type: "magiclink" });
    h.verifyOtp.mockResolvedValue({ data: { session: sessionFor("stranger@example.com", "sid-3", "magiclink") }, error: null });
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByText("You're signed in as s***@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not you? Sign out" })).toBeInTheDocument();
  });

  it("an expired link says so and offers the way back", async () => {
    stash({ token_hash: "th-old", type: "signup" });
    h.verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: "Token has expired or is invalid" } });
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired or was already used/);
  });
});

describe("a session that arrives in the URL (login-CSRF protection)", () => {
  it("without the pending marker it is not adopted: the signed-in-as prompt asks, and 'Not you?' discards it", async () => {
    stash({ access_token: jwt({ email: "victim@example.com", session_id: "sid-x" }), refresh_token: "rt-x", type: "magiclink" });
    mount("/auth?mode=return");
    const dialog = await screen.findByRole("dialog", {}, SLOW);
    expect(dialog).toHaveTextContent("You're signed in as v***@example.com");
    expect(h.setSession).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Not you? Sign out" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.setSession).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("rb_url_stash") ?? "").not.toContain("rt-x");
  });

  it("the prompt's Continue adopts it", async () => {
    stash({ access_token: jwt({ email: "me@example.com", session_id: "sid-y" }), refresh_token: "rt-y" });
    mount("/auth?mode=return");
    const dialog = await screen.findByRole("dialog", {}, SLOW);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    expect(h.setSession).toHaveBeenCalledWith({ access_token: expect.any(String), refresh_token: "rt-y" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/account"));
  });

  it("with the marker it is adopted without a question, the marker is spent, and the page goes to its next", async () => {
    stash({ access_token: jwt({ email: "me@example.com", session_id: "sid-z" }), refresh_token: "rt-z" });
    marker("/jobs?q=nurse");
    mount("/auth?mode=return");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs?q=nurse"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.setSession).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("rb_auth_pending")).toBeNull();
  });

  it("a return refuses an off-site next", async () => {
    for (const evil of ["https://evil.example/steal", "//evil.example", "/\\evil.example"]) {
      cleanup();
      h.listeners = [];
      stash({ access_token: jwt({ email: "me@example.com", session_id: "sid-e" }), refresh_token: "rt-e" });
      marker(evil);
      mount("/auth?mode=return");
      await waitFor(() => expect(screen.getByTestId("where").textContent, evil).toBe("/account"));
    }
  });

  it("an error the auth server sent back is explained on the Continue screen", async () => {
    stash({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" });
    mount("/auth?mode=return");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in didn't finish. Please try again.");
  });
});
