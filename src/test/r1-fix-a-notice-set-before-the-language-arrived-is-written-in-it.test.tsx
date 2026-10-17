/**
 * R1 FIX (S12-183): A NOTICE SET BEFORE THE READER'S LANGUAGE ARRIVED IS
 * WRITTEN IN IT ONCE IT DOES.
 *
 * The sign-in strings load lazily (src/i18n/auth/load.ts). A notice the page
 * set before the bundle arrived (an expired session, a link's error) was
 * stored as its English text and stayed English after the German bundle
 * loaded. The page now keeps each message as the call that writes it and
 * renders it at render time.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const h = vi.hoisted(() => ({ listeners: [] as Array<(event: string, s: unknown) => void>, toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a), useToast: () => ({ toast: h.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { h.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => ({ error: null }),
    },
    functions: { invoke: async () => ({ data: { proven: true, passwordCleared: false }, error: null }) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/lib/auth-probe", () => ({ resolveTokens: vi.fn(), verifyLink: vi.fn(), revoke: vi.fn() }));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "../pages/Auth";

vi.setConfig(MOUNT_TEST_BUDGET);

beforeAll(async () => {
  await i18next.use(initReactI18next).init({ lng: "de", fallbackLng: "en", resources: { de: { translation: {} }, en: { translation: {} } }, interpolation: { escapeValue: false } });
});
afterAll(() => { cleanup(); });

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const session = {
  access_token: `h.${b64({ sub: "u1", email: "me@example.com", session_id: "sid-de", exp: 4_102_444_800 })}.s`,
  refresh_token: "rt",
  user: { id: "u1", email: "me@example.com" },
};

describe("a notice raised outside /auth on a German page (lead decision G, third fixer round)", () => {
  it("a link's error that landed on another page is explained in German: the strings are loaded before the notice is raised", async () => {
    sessionStorage.setItem("rb_url_stash", JSON.stringify({ error: "access_denied", error_code: "otp_expired", error_description: "expired", _at: Date.now(), _path: "/jobs" }));
    window.history.replaceState(null, "", "/jobs");
    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <AuthProvider>
          <Routes><Route path="/auth" element={<Auth />} /><Route path="*" element={<div />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(1), SLOW);
    const notice = h.toast.mock.calls[0][0] as { title: string; description: string };
    expect(notice.title).toBe("Die Anmeldung wurde nicht abgeschlossen. Bitte versuchen Sie es erneut.");
    expect(notice.description).toMatch(/^Dieser Link ist abgelaufen/);
    window.history.replaceState(null, "", "/");
    sessionStorage.clear();
  });
});

describe("the expired-session notice on a German page", () => {
  it("is German once the German strings arrive, though it was set before they did", async () => {
    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <AuthProvider>
          <Routes><Route path="/auth" element={<Auth />} /><Route path="*" element={<div />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    // The session ends before the lazily loaded bundle can have arrived.
    act(() => {
      for (const cb of h.listeners) cb("SIGNED_IN", session);
      for (const cb of h.listeners) cb("SIGNED_OUT", null);
    });
    expect(await screen.findByText(/^Ihre Sitzung ist abgelaufen\./, {}, SLOW)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Your session expired");
  });
});
