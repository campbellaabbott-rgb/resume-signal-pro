/**
 * AN EXPIRED SESSION WAS READ AS A SIGN-OUT, AND A SIGN-UP RECORDED NO TERMS.
 *
 * WHAT WAS WRONG.
 *   L3-20 (platform sweep 2026-10-04): auth-js reports a refresh that failed
 *     as SIGNED_OUT, and AuthContext raised "session expired" only for other
 *     events, so the notice could never fire; "Resend confirmation" dropped
 *     the page the sign-up was headed to.
 *   Item 12 (commercial-readiness plan 2026-10-08): the sign-up button carried
 *     no "By continuing you agree to the Terms" and the account stored no
 *     record of which Terms it was created under.
 *
 * Mounted for real with the Supabase client faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TERMS_VERSION } from "@/config/terms";
import en from "../i18n/locales/en.json";

const h = vi.hoisted(() => ({
  listener: null as null | ((event: string, s: unknown) => void),
  listeners: [] as Array<(event: string, s: unknown) => void>,
  signUp: vi.fn(async () => ({ error: null })),
  signInWithOtp: vi.fn(async () => ({ error: null })),
  resend: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => { h.listener?.("SIGNED_OUT", null); return { error: null }; }),
  signInWithPassword: vi.fn(async () => ({ error: { message: "Email not confirmed" } })),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { h.listener = cb; h.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      signUp: h.signUp,
      signInWithOtp: h.signInWithOtp,
      resend: h.resend,
      signOut: h.signOut,
      signInWithPassword: h.signInWithPassword,
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Auth from "../pages/Auth";

const SESSION = { user: { id: "u1", email: "member@example.com" }, access_token: "jwt" };

function Probe() {
  const { sessionExpired, signOut } = useAuth();
  return <div><span data-testid="expired">{String(sessionExpired)}</span><button onClick={() => void signOut()}>out</button></div>;
}

beforeEach(() => { h.listener = null; h.listeners = []; localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

describe("an expired session is told apart from the user signing out (L3-20)", () => {
  it("a session that vanishes as SIGNED_OUT without the user pressing sign out reads as expired", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => h.listener!("SIGNED_IN", SESSION));
    act(() => h.listener!("SIGNED_OUT", null));
    await waitFor(() => expect(screen.getByTestId("expired").textContent).toBe("true"));
  });

  it("the user's own sign-out is not called an expiry", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => h.listener!("SIGNED_IN", SESSION));
    await act(async () => { fireEvent.click(screen.getByText("out")); });
    expect(screen.getByTestId("expired").textContent).toBe("false");
  });
});

/**
 * S11-145: auth-js broadcasts SIGNED_OUT to every open tab. Two providers
 * stand for two tabs of one browser (one localStorage); the sign-out pressed
 * in the first reaches the second as the broadcast SIGNED_OUT.
 */
function TabProbe({ id }: { id: string }) {
  const { sessionExpired, signOut } = useAuth();
  return <div><span data-testid={`expired-${id}`}>{String(sessionExpired)}</span><button onClick={() => void signOut()}>{`out-${id}`}</button></div>;
}

describe("a sign-out pressed in one tab is not an expiry in the others (S11-145)", () => {
  it("the other tab, told SIGNED_OUT by the broadcast, says nothing about an expired session", async () => {
    render(<><AuthProvider><TabProbe id="a" /></AuthProvider><AuthProvider><TabProbe id="b" /></AuthProvider></>);
    const [tabA, tabB] = h.listeners;
    act(() => { tabA("SIGNED_IN", SESSION); tabB("SIGNED_IN", SESSION); });
    h.signOut.mockImplementationOnce(async () => { tabA("SIGNED_OUT", null); return { error: null }; });
    await act(async () => { fireEvent.click(screen.getByText("out-a")); });
    act(() => tabB("SIGNED_OUT", null)); // the broadcast
    expect(screen.getByTestId("expired-a").textContent).toBe("false");
    expect(screen.getByTestId("expired-b").textContent, "the sibling tab called a deliberate sign-out an expiry").toBe("false");
  });

  it("a session that vanishes long after any sign-out is still an expiry", async () => {
    localStorage.setItem("rb_signed_out_at", String(Date.now() - 5 * 60_000));
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => h.listener!("SIGNED_IN", SESSION));
    act(() => h.listener!("SIGNED_OUT", null));
    await waitFor(() => expect(screen.getByTestId("expired").textContent).toBe("true"));
  });
});

describe("the sign-up page", () => {
  // R1 made this one Continue screen (src/pages/Auth.tsx): a new address
  // becomes an account, an existing one goes on to sign in, and there is no
  // emailed sign-in link any more. The Terms rule is unchanged.
  const mount = (at = "/auth?next=%2Fagent%3Fwelcome%3D1") =>
    render(<MemoryRouter initialEntries={[at]}><AuthProvider><Auth /></AuthProvider></MemoryRouter>);

  it("says above its button that continuing agrees to the Terms, and the account stores which Terms", async () => {
    mount();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === en.purchaseTerms.agree.replace(/<\/?(terms|privacy)>/g, ""))).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "longenough1" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Continue$/ })); });
    const opts = (h.signUp.mock.calls[0] as unknown as [{ options: { data: Record<string, string>; emailRedirectTo: string } }])[0].options;
    expect(opts.data.terms_version).toBe(TERMS_VERSION);
    expect(Number.isNaN(Date.parse(opts.data.terms_accepted_at))).toBe(false);
  });

  it("no emailed sign-in link remains to create an account without the Terms (the emailed code records them: r1-signin-flags-on)", async () => {
    mount();
    expect(screen.queryByRole("button", { name: /sign-in link/ })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "longenough1" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Continue$/ })); });
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });

  it("Resend confirmation sends the link to the confirm step, carrying the page the sign-up was headed to", async () => {
    h.signUp.mockResolvedValueOnce({ error: { message: "User already registered" } } as never);
    mount();
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "longenough1" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Continue$/ })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /Email the confirmation link again/ })); });
    const arg = (h.resend.mock.calls[0] as unknown as [{ options?: { emailRedirectTo?: string } }])[0];
    expect(arg.options?.emailRedirectTo).toBe(`${window.location.origin}/auth?mode=confirm&next=%2Fagent%3Fwelcome%3D1`);
  });
});
