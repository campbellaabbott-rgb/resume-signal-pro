/**
 * R1 HOTFIX S13-106 (low): AN EXPIRED OR ALREADY-USED RESET LINK FROM OUR OWN
 * MAIL SAYS SO, AND OFFERS A NEW RESET LINK.
 *
 * WHAT WAS WRONG. With notify.resumebooster.work verified, recovery mail uses
 * our template, whose button opens /auth?mode=confirm&token_hash=..&type=recovery.
 * Pressed a second time, or after its 15 minutes, the confirm page's press got
 * a definite refusal and printed the generic "This link has expired or was
 * already used. Sign in again to get a new one." with only "Back to sign in":
 * someone who forgot their password was told to sign in. The reset-specific
 * explanation and "Send a new reset link" existed only for Lovable's default
 * link (mode=reset with a stashed error).
 *
 * WHAT HOLDS NOW (the real page and provider; only the Supabase client, the
 * throwaway probe client and the broker are faked): a definite refusal of a
 * recovery link opens the reset page on its "expired" step, with "Send a new
 * reset link" for the address this browser asked for (read before the
 * refusal spends the marker) and "Email support"; the link and the marker are
 * spent; every other link type keeps the generic wording; a reset link the
 * auth server could not be asked about still offers Try again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  resetPasswordForEmail: vi.fn(),
  invoke: vi.fn(),
  verifyLink: vi.fn(),
  resolveTokens: vi.fn(),
  revoke: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { h.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => { await Promise.resolve(); return { data: { session: null } }; },
      signUp: async () => ({ data: {}, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signInWithOtp: async () => ({ data: {}, error: null }),
      verifyOtp: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: (...a: unknown[]) => h.resetPasswordForEmail(...a),
      updateUser: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      setSession: async () => ({ data: {}, error: null }),
      resend: async () => ({ error: null }),
    },
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({ error: null }) } } }));
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

const RESET_EXPIRED = "This reset link has expired or was already used, so no password was set. Ask for a new one.";
const GENERIC_EXPIRED = "This link has expired or was already used. Sign in again to get a new one.";
const REFUSED = { error: "Email link is invalid or has expired", transient: false };

beforeEach(() => {
  h.listeners = [];
  localStorage.clear();
  sessionStorage.clear();
  for (const f of [h.resetPasswordForEmail, h.invoke, h.verifyLink, h.resolveTokens, h.revoke, h.toast]) f.mockReset();
  h.invoke.mockResolvedValue({ data: { proven: true, passwordCleared: false }, error: null });
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("a reset link from our own mail that the auth server refused for good", () => {
  it("says the reset link expired, offers a new reset link for the address asked for and support, and spends the link and the marker", async () => {
    marker("/account", "member@example.com");
    stash({ token_hash: "th-reset-used", type: "recovery" });
    h.verifyLink.mockResolvedValue(REFUSED);
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" }, SLOW);
    await press(/^Continue$/);
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent(RESET_EXPIRED);
    expect(document.body.textContent, "a locked-out member was told to sign in again").not.toContain(GENERIC_EXPIRED);
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Email support" })).toHaveAttribute("href", "mailto:resumeboostersupp@gmail.com");
    expect(h.verifyLink).toHaveBeenCalledWith("th-reset-used", "recovery");
    expect(stashed().token_hash, "a refused link stayed in the stash").toBeUndefined();
    expect(localStorage.getItem(PENDING_KEY), "the marker outlived a definite refusal").toBeNull();

    await press("Send a new reset link");
    expect(await screen.findByLabelText(/^Email$/)).toHaveValue("member@example.com");
    h.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await press("Email me a reset link");
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith("member@example.com", expect.objectContaining({ redirectTo: expect.stringContaining("/auth?mode=reset") }));
  });

  it("with no address known in this browser, the same explanation and an empty request form", async () => {
    stash({ token_hash: "th-reset-other-device", type: "recovery" });
    h.verifyLink.mockResolvedValue(REFUSED);
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" }, SLOW);
    await press(/^Continue$/);
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent(RESET_EXPIRED);
    await press("Send a new reset link");
    expect(await screen.findByLabelText(/^Email$/)).toHaveValue("");
  });

  it("a reset link the auth server could not be asked about still offers Try again (control)", async () => {
    marker("/account", "member@example.com");
    stash({ token_hash: "th-reset-blip", type: "recovery" });
    h.verifyLink.mockResolvedValue({ error: "Failed to fetch", transient: true });
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" }, SLOW);
    await press(/^Continue$/);
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("We couldn't reach the sign-in server. Check your connection and try again; the link is still valid.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(stashed().token_hash).toBe("th-reset-blip");
  });

  it("every other link type keeps the generic wording (control)", async () => {
    marker("/account", "member@example.com");
    stash({ token_hash: "th-signin-used", type: "magiclink" });
    h.verifyLink.mockResolvedValue(REFUSED);
    mount("/auth?mode=confirm");
    await screen.findByRole("heading", { name: "Finish signing in" }, SLOW);
    await press(/^Continue$/);
    expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent(GENERIC_EXPIRED);
    expect(screen.queryByRole("button", { name: "Send a new reset link" })).toBeNull();
  });
});
