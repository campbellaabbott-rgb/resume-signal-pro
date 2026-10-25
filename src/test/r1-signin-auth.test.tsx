/**
 * R1: THE SIGN-IN PAGE WITH EVERY SWITCH OFF BUT THE PASSWORD.
 *
 * The first publish turns Google and recovery on (register S12-057); this file
 * still proves the page with every method off, so each switch is shown to gate
 * its control (r1-signin-flags-on.test.tsx proves the on path the same way).
 *
 * Mounted for real (AuthProvider + /auth) with only the Supabase client, the
 * throwaway probe client (src/lib/auth-probe.ts) and the provider broker faked:
 *   - one Continue screen: no sign-up/sign-in switch, no magic link, nothing
 *     that says a mail was sent;
 *   - no Google button, no code field, no "Forgot password?" and no reset
 *     screen while their switches are off;
 *   - Continue SIGNS IN first: a returning member whose old password fails
 *     today's strength rule still signs in, and a new account is only ever an
 *     explicit second step for the address typed (no silent account for a typo);
 *   - a confirmation link is spent only by the press, and one this browser did
 *     not start asks "Is this your account?" before any session exists here;
 *   - a session that arrives in the URL is resolved by the auth server first
 *     and adopted silently only with the pending marker for that address;
 *   - a provider return goes to the marker's next, never off-site;
 *   - a link's error is shown once, never again on a later visit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { TERMS_VERSION } from "@/config/terms";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.mock("@/config/auth-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/auth-providers")>()),
  GOOGLE_SIGN_IN_LIVE: false,
  CODE_SIGN_IN_LIVE: false,
  RECOVERY_LIVE: false,
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
  resend: vi.fn(),
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
vi.mock("@/lib/auth-probe", () => ({
  resolveTokens: (...a: unknown[]) => h.resolveTokens(...a),
  verifyLink: (...a: unknown[]) => h.verifyLink(...a),
  revoke: (...a: unknown[]) => h.revoke(...a),
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: (...a: unknown[]) => h.oauth(...a) } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a), useToast: () => ({ toast: h.toast }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "../pages/Auth";

vi.setConfig(MOUNT_TEST_BUDGET);

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${b64({ exp: 4_102_444_800, ...claims })}.sig`;
const claimsOf = (token: string) => JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
const sessionFor = (email: string, sid = "sid-1", method = "password") => ({
  access_token: jwt({ sub: "u-" + sid, email, session_id: sid, amr: [{ method, timestamp: 1 }] }),
  refresh_token: "rt-" + sid,
  user: { id: "u-" + sid, email },
});
/** What the auth server says a session is (the probe's answer). */
const probed = (email: string, sid = "sid-p", method = "otp") => ({ session: sessionFor(email, sid, method), email });
const emit = (event: string, s: unknown) => act(() => { h.session = s; for (const cb of h.listeners) cb(event, s); });

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
function Nav() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/auth")}>go-to-auth</button>;
}
const mount = (at: string) => {
  // The page's own address (the provider reads it to decide where a link's error is explained).
  window.history.replaceState(null, "", at);
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="*" element={<><Where /><Nav /></>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
};
const stash = (o: Record<string, string>) => sessionStorage.setItem("rb_url_stash", JSON.stringify({ ...o, _at: Date.now(), _path: "/auth" }));
const marker = (next: string, email?: string) => localStorage.setItem("rb_auth_pending", JSON.stringify({ at: Date.now(), next, ...(email ? { email } : {}) }));

beforeEach(() => {
  h.listeners = [];
  h.session = null;
  localStorage.clear();
  sessionStorage.clear();
  for (const f of [h.signUp, h.signInWithPassword, h.signInWithOtp, h.verifyOtp, h.resetPasswordForEmail, h.updateUser, h.signOut, h.setSession, h.resend, h.invoke, h.oauth, h.resolveTokens, h.verifyLink, h.revoke, h.toast]) f.mockReset();
  h.invoke.mockResolvedValue({ data: { proven: false, passwordCleared: false, reason: "password" }, error: null });
  h.signOut.mockResolvedValue({ error: null });
  h.revoke.mockResolvedValue(undefined);
  h.setSession.mockImplementation(async (tokens: { access_token: string }) => {
    const claims = claimsOf(tokens.access_token);
    emit("SIGNED_IN", { ...sessionFor(claims.email, claims.session_id, "otp"), access_token: tokens.access_token });
    return { data: {}, error: null };
  });
  // The auth server answers for a token pair with the account it belongs to.
  h.resolveTokens.mockImplementation(async (access: string) => probed(claimsOf(access).email, claimsOf(access).session_id));
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

const typeIn = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

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

describe("the password path: sign in first, a new account only when asked", () => {
  it("an existing member whose password fails today's strength rule still signs in (the review blocker, S12-058)", async () => {
    h.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Password is known to be weak and easy to guess, please choose a different one." } });
    h.signInWithPassword.mockImplementation(async () => { emit("SIGNED_IN", sessionFor("member@example.com")); return { data: { weak_password: { reasons: ["pwned"] } }, error: null }; });
    mount("/auth?next=%2Fjobs");
    typeIn(/^Email$/, "member@example.com");
    typeIn(/^Password$/, "password123");
    await press(/^Continue$/);
    expect(h.signInWithPassword, "sign-in was never attempted").toHaveBeenCalledWith({ email: "member@example.com", password: "password123" });
    expect(h.signUp, "a returning member's sign-in went through the sign-up first").not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs"));
    expect(document.body.textContent).not.toMatch(/too weak/);
  });

  it("a refused password never makes an account by itself: the typo address gets an explicit offer (S12-088)", async () => {
    h.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    mount("/auth");
    typeIn(/^Email$/, "jane@gmial.com");
    typeIn(/^Password$/, "my-real-password");
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't sign you in with that email and password.");
    expect(h.signUp, "an account was made for an address nobody chose to register").not.toHaveBeenCalled();
    expect(screen.getByTestId("offer-create")).toHaveTextContent("New here? You can create an account for jane@gmial.com with this password.");
    expect(document.body.textContent).not.toMatch(/already|exists|have an account/i);
    expect(screen.getByLabelText(/^Email$/)).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
    expect(screen.getByText(/Can't sign in\? Email/)).toBeInTheDocument();
    expect(localStorage.getItem("rb_auth_pending"), "a refused password left a marker a crafted link could ride").toBeNull();
    // Editing the address withdraws the offer for the old one.
    typeIn(/^Email$/, "jane@gmail.com");
    expect(screen.queryByTestId("offer-create")).toBeNull();
  });

  it("the offer, pressed, makes the account with the Terms and lands where it was headed", async () => {
    h.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    h.signUp.mockImplementation(async () => {
      expect(JSON.parse(localStorage.getItem("rb_auth_pending") ?? "null"), "the marker names the address before the sign-up leaves").toMatchObject({ next: "/jobs", email: "new@example.com" });
      return { data: { session: sessionFor("new@example.com"), user: { identities: [{}] } }, error: null };
    });
    mount("/auth?next=%2Fjobs");
    typeIn(/^Email$/, "new@example.com");
    typeIn(/^Password$/, "longenough1");
    await press(/^Continue$/);
    await press("Create a new account");
    const arg = h.signUp.mock.calls[0][0] as { email: string; options: { emailRedirectTo: string; data: Record<string, string> } };
    expect(arg.email).toBe("new@example.com");
    expect(arg.options.data.terms_version).toBe(TERMS_VERSION);
    expect(arg.options.emailRedirectTo).toBe(`${window.location.origin}/auth?mode=confirm&next=%2Fjobs`);
    emit("SIGNED_IN", sessionFor("new@example.com"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs"));
    expect(localStorage.getItem("rb_auth_pending"), "a sign-up with a session leaves no marker for a later link to ride").toBeNull();
  });

  it("a new account refused for an address that has one says neither 'exists' nor 'on its way'", async () => {
    h.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    h.signUp.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    mount("/auth");
    typeIn(/^Email$/, "member@example.com");
    typeIn(/^Password$/, "wrongpassword");
    await press(/^Continue$/);
    await press("Create a new account");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't create an account with that email and password.");
    expect(document.body.textContent).not.toMatch(/on its way|already|exists/i);
    expect(localStorage.getItem("rb_auth_pending")).toBeNull();
  });

  it("a password too short for a new account is said at the offer, and no sign-up leaves", async () => {
    h.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    mount("/auth");
    typeIn(/^Email$/, "old@example.com");
    typeIn(/^Password$/, "short");
    await press(/^Continue$/);
    await press("Create a new account");
    expect(h.signUp).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("A new account needs a password of at least 8 characters.");
  });

  it("any other refusal clears a marker left from an earlier request, and names the support address", async () => {
    marker("/jobs", "member@example.com");
    h.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Database error querying schema" } });
    mount("/auth");
    typeIn(/^Email$/, "member@example.com");
    typeIn(/^Password$/, "whatever-it-is");
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.getByText(/Can't sign in\? Email/)).toBeInTheDocument();
    expect(localStorage.getItem("rb_auth_pending")).toBeNull();
  });
});

describe("a confirmation link from the mail (?mode=confirm)", () => {
  it("is spent only by the press, and goes where this browser's sign-in for that address was headed", async () => {
    stash({ token_hash: "th-press", type: "magiclink" });
    marker("/jobs", "member@example.com");
    h.verifyLink.mockResolvedValue(probed("member@example.com", "sid-2", "otp"));
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.verifyLink, "loading the page spent the link").not.toHaveBeenCalled();
    await press(/^Continue$/);
    expect(h.verifyLink).toHaveBeenCalledWith("th-press", "magiclink");
    expect(h.verifyOtp, "the link was spent through the site's own client").not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/jobs"));
    expect(h.setSession).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("rb_url_stash") ?? "").not.toContain("th-press");
  });

  it("without a sign-in started here, asks 'Is this your account?' with the full address BEFORE any session exists (S12-089)", async () => {
    stash({ token_hash: "th-cold", type: "magiclink" });
    h.verifyLink.mockResolvedValue(probed("stranger@example.com", "sid-3"));
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByText("Is this your account?")).toBeInTheDocument();
    expect(screen.getByTestId("link-check-email")).toHaveTextContent("stranger@example.com");
    expect(h.setSession, "the link's session was adopted before the question").not.toHaveBeenCalled();
    expect(h.session).toBeNull();
    await press("Yes, continue");
    expect(h.setSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/account"));
  });

  it("'Not me' after a crafted link signs nothing in and leaves the visitor's own work (review major)", async () => {
    localStorage.setItem("resumeBuilderDraft", JSON.stringify({ name: "Victim Draft" }));
    localStorage.setItem("rb_scan_history", "[1]");
    stash({ token_hash: "th-attacker", type: "magiclink" });
    h.verifyLink.mockResolvedValue(probed("attacker@evil.example", "sid-evil"));
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    await press("Not me, cancel");
    expect(await screen.findByText(/Nothing was signed in/)).toBeInTheDocument();
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.signOut, "no sign-out was needed: nothing was ever signed in").not.toHaveBeenCalled();
    expect(h.revoke).toHaveBeenCalledWith(expect.objectContaining({ refresh_token: "rt-sid-evil" }));
    expect(localStorage.getItem("resumeBuilderDraft")).toContain("Victim Draft");
    expect(localStorage.getItem("rb_scan_history")).toBe("[1]");
  });

  it("an address-change link this browser did not start asks the same question (minor: email_change skipped the check)", async () => {
    stash({ token_hash: "th-change", type: "email_change" });
    h.verifyLink.mockResolvedValue(probed("attacker@evil.example", "sid-change"));
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByText("Is this your account?")).toBeInTheDocument();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("a link for another address than the one this browser asked for asks too", async () => {
    stash({ token_hash: "th-other", type: "magiclink" });
    marker("/jobs", "me@example.com");
    h.verifyLink.mockResolvedValue(probed("attacker@evil.example", "sid-other"));
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByText("Is this your account?")).toBeInTheDocument();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("an expired link says so, offers the way back, and spends the marker", async () => {
    stash({ token_hash: "th-old", type: "signup" });
    marker("/jobs", "me@example.com");
    h.verifyLink.mockResolvedValue({ error: "Token has expired or is invalid" });
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" });
    await press(/^Continue$/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired or was already used/);
    expect(localStorage.getItem("rb_auth_pending")).toBeNull();
  });
});

describe("a session that arrives in the URL (login-CSRF protection)", () => {
  it("without the pending marker it is not adopted: the prompt names the auth server's account, and 'Not me' discards it", async () => {
    stash({ access_token: jwt({ email: "victim@example.com", session_id: "sid-x" }), refresh_token: "rt-x", type: "magiclink" });
    mount("/auth?mode=return");
    const dialog = await screen.findByRole("dialog", {}, SLOW);
    expect(dialog).toHaveTextContent("Is this your account?");
    expect(within(dialog).getByTestId("link-check-email")).toHaveTextContent("victim@example.com");
    expect(h.setSession).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Not me, cancel" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.setSession).not.toHaveBeenCalled();
    expect(h.revoke).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("rb_url_stash") ?? "").not.toContain("rt-x");
  });

  it("a forged token naming the visitor's own address shows the account the auth server names (minor: forged interstitial)", async () => {
    stash({ access_token: jwt({ email: "victim@example.com", session_id: "sid-f", exp: 1 }), refresh_token: "rt-attacker" });
    h.resolveTokens.mockResolvedValue(probed("attacker@evil.example", "sid-real"));
    mount("/auth?mode=return");
    const dialog = await screen.findByRole("dialog", {}, SLOW);
    expect(within(dialog).getByTestId("link-check-email")).toHaveTextContent("attacker@evil.example");
    expect(dialog.textContent).not.toContain("victim@example.com");
  });

  it("the prompt's Continue adopts the tokens the auth server answered with", async () => {
    stash({ access_token: jwt({ email: "me@example.com", session_id: "sid-y" }), refresh_token: "rt-y" });
    h.resolveTokens.mockResolvedValue(probed("me@example.com", "sid-y2"));
    mount("/auth?mode=return");
    const dialog = await screen.findByRole("dialog", {}, SLOW);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Yes, continue" })); });
    expect(h.setSession).toHaveBeenCalledWith({ access_token: expect.any(String), refresh_token: "rt-sid-y2" });
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

  it("a marker for another address does not carry a stranger's link (minor: a crafted link rode a live marker)", async () => {
    stash({ access_token: jwt({ email: "attacker@evil.example", session_id: "sid-m" }), refresh_token: "rt-m", type: "magiclink" });
    marker("/jobs", "me@example.com");
    mount("/auth?mode=return");
    expect(await screen.findByRole("dialog", {}, SLOW)).toHaveTextContent("Is this your account?");
    expect(h.setSession).not.toHaveBeenCalled();
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

  it("an error the auth server sent back is explained on the Continue screen once, and not on a later visit (S12-182)", async () => {
    stash({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" });
    h.signInWithPassword.mockImplementation(async () => { emit("SIGNED_IN", sessionFor("me@example.com")); return { data: {}, error: null }; });
    mount("/auth?mode=return");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in didn't finish. Please try again.");
    typeIn(/^Email$/, "me@example.com");
    typeIn(/^Password$/, "rightpassword");
    await press(/^Continue$/);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/account"));
    emit("SIGNED_OUT", null);
    await press("go-to-auth");
    await screen.findByRole("heading", { name: "Sign in or create your free account" });
    expect(screen.queryByRole("alert"), "the old link's error came back on a fresh visit").toBeNull();
  });

  it("an error that lands on another page is explained there, by a notice", async () => {
    stash({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" });
    mount("/jobs");
    await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(h.toast.mock.calls[0][0])).toMatch(/expired or was already used/);
  });
});
