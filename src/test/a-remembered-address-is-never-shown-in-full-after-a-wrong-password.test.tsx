/**
 * A REMEMBERED ADDRESS IS NEVER SHOWN IN FULL AFTER A WRONG PASSWORD
 * (S14X-207).
 *
 * WHAT WAS WRONG. The sign-in page offers "Continue as j***@example.com" for
 * the address this browser last signed in with (an expired session keeps it;
 * on a shared computer it may be the last person's). Pressed, with a wrong
 * password, the refusal offered "New here? You can create an account for
 * jane.doe@example.com", the full address the mask was there to hide, and a
 * new account for someone else's address.
 *
 * WHAT HOLDS NOW: a refused password for the remembered address names it
 * masked, offers no account, and empties the field for the person to type
 * their own. A typed address still gets the offer (r1-signin-auth holds it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/config/auth-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/auth-providers")>()),
  GOOGLE_SIGN_IN_LIVE: false,
  CODE_SIGN_IN_LIVE: false,
  RECOVERY_LIVE: false,
  APPLE_SIGN_IN_LIVE: false,
}));

const h = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signUp: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: (...a: unknown[]) => h.signInWithPassword(...a),
      signUp: (...a: unknown[]) => h.signUp(...a),
      signOut: async () => ({ error: null }),
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: () => undefined, useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "../pages/Auth";

vi.setConfig(MOUNT_TEST_BUDGET);

const mount = () => {
  window.history.replaceState(null, "", "/auth");
  return render(
    <MemoryRouter initialEntries={["/auth"]}>
      <AuthProvider>
        <Routes><Route path="/auth" element={<Auth />} /></Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
};
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
  h.signUp.mockReset();
  localStorage.setItem("rb_last_email", "jane.doe@example.com");
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("S14X-207: a refused password for the remembered address", () => {
  it("names it masked, offers no account for it, and leaves the field empty for the person's own address", async () => {
    mount();
    await press("Continue as j***@example.com");
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: "wrong" } });
    await press(/^Continue$/);
    expect(h.signInWithPassword).toHaveBeenCalledWith({ email: "jane.doe@example.com", password: "wrong" });
    expect(document.body.textContent, "the remembered address was shown in full").not.toContain("jane.doe@example.com");
    expect(screen.queryByTestId("offer-create"), "an account was offered for the remembered address").toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't sign you in as j***@example.com. Type your address to try again.");
    expect(screen.getByLabelText(/^Email$/)).toHaveValue("");
    expect(h.signUp).not.toHaveBeenCalled();
  });
});
