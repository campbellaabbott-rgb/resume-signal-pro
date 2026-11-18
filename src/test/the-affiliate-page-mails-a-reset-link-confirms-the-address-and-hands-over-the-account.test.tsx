/**
 * THE AFFILIATE PAGE MAILS A RESET LINK, CONFIRMS THE ADDRESS AND HANDS OVER
 * THE ACCOUNT (S14X-115, S14X-093, S14X-021: the page's half of
 * affiliate-account).
 *
 * WHAT WAS WRONG. An affiliate who lost the password had no way back in: the
 * sign-in card offered no reset. No address was ever proven, a session could
 * not be ended anywhere but the device that held it, and the program offered
 * no copy of what it held and no way to close the account.
 *
 * WHAT HOLDS NOW:
 *   - the sign-in card offers "Forgot password?", which asks affiliate-account
 *     to mail a link and answers the same whether or not the address is known;
 *   - a #reset= link opens a new-password form that spends the link; #confirm=
 *     and #email= links are spent on arrival, and the fragment is cleared;
 *   - a signed-in affiliate whose address is unproven sees why it matters and
 *     a button that mails the confirmation link; a proven one sees no banner;
 *   - the account card signs out every device, downloads the export, mails a
 *     change-of-address link and closes the account only after ERASE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a), info: (...a: unknown[]) => toast.info(...a), warning: (...a: unknown[]) => toast.warning(...a) } }));

let dashboard: Record<string, unknown> = {};
const rpc = vi.fn(async (name: string, _args?: unknown) => (name === "get_affiliate_dashboard" ? { data: dashboard, error: null } : { data: [], error: null }));
const invoke = vi.fn(async (..._a: unknown[]): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(),
    rpc: (name: string, args?: unknown) => rpc(name, args),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

import Affiliates from "../pages/Affiliates";

class NoResize { observe() {} unobserve() {} disconnect() {} }

const TOKEN = "f".repeat(64);
const LINK = "a".repeat(64);
const affiliate = (confirmed: boolean | undefined) => ({ id: "a1", email: "aff@example.com", referral_code: "ab12cd34", commission_amount: 1000, status: "active", created_at: "2026-11-01T00:00:00Z", ...(confirmed === undefined ? {} : { email_confirmed: confirmed }) });
const stats = { total_clicks: 0, total_conversions: 0, total_revenue: 0, pending_payout: 0, paid_out: 0, conversion_rate: 0 };
const calls = (action: string) => invoke.mock.calls.filter(([fn, opts]) => fn === "affiliate-account" && (opts as { body?: { action?: string } })?.body?.action === action);
const signIn = () => localStorage.setItem("affiliate_session", JSON.stringify({ affiliateId: "a1", email: "aff@example.com", referralCode: "ab12cd34", sessionToken: TOKEN }));
const mount = async () => { await act(async () => { render(<MemoryRouter><Affiliates /></MemoryRouter>); }); };

beforeEach(() => {
  for (const f of Object.values(toast)) f.mockReset();
  invoke.mockReset();
  invoke.mockImplementation(async () => ({ data: { status: "sent" }, error: null }));
  rpc.mockClear();
  localStorage.clear();
  window.history.replaceState(null, "", "/affiliates");
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoResize;
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("a lost password", () => {
  it("the sign-in card offers a reset link, and the answer never says whether the address is known", async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Forgot password?" })); });
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "Aff@Example.com" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Email me a link" })); });
    await waitFor(() => expect(calls("reset-request")).toHaveLength(1));
    expect((calls("reset-request")[0][1] as { body: Record<string, unknown> }).body).toEqual({ action: "reset-request", email: "Aff@Example.com" });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/If an affiliate account uses that address/));
  });

  it("a #reset= link opens a new-password form that spends the link, then clears it from the address bar", async () => {
    window.history.replaceState(null, "", `/affiliates#reset=${LINK}`);
    invoke.mockImplementation(async () => ({ data: { status: "reset" }, error: null }));
    await mount();
    fireEvent.change(await screen.findByPlaceholderText("New password (min 8 characters)"), { target: { value: "a-new-password" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save the new password" })); });
    await waitFor(() => expect(calls("reset")).toHaveLength(1));
    expect((calls("reset")[0][1] as { body: Record<string, unknown> }).body).toEqual({ action: "reset", token: LINK, password: "a-new-password" });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Password changed/));
    expect(window.location.hash).toBe("");
  });

  it("a spent or late link says so", async () => {
    window.history.replaceState(null, "", `/affiliates#reset=${LINK}`);
    invoke.mockImplementation(async () => ({ data: null, error: Object.assign(new Error("non-2xx"), { context: new Response(JSON.stringify({ status: "expired" }), { status: 400 }) }) }));
    await mount();
    fireEvent.change(await screen.findByPlaceholderText("New password (min 8 characters)"), { target: { value: "a-new-password" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save the new password" })); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/expired or was already used/)));
  });
});

describe("the address", () => {
  it("a #confirm= link is spent on arrival", async () => {
    window.history.replaceState(null, "", `/affiliates#confirm=${LINK}`);
    invoke.mockImplementation(async () => ({ data: { status: "confirmed" }, error: null }));
    await mount();
    await waitFor(() => expect(calls("confirm")).toHaveLength(1));
    expect((calls("confirm")[0][1] as { body: Record<string, unknown> }).body).toEqual({ action: "confirm", token: LINK });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Your email address is confirmed."));
    expect(window.location.hash).toBe("");
  });

  it("a #email= link changes the address", async () => {
    window.history.replaceState(null, "", `/affiliates#email=${LINK}`);
    invoke.mockImplementation(async () => ({ data: { status: "changed" }, error: null }));
    await mount();
    await waitFor(() => expect(calls("email-confirm")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/address is changed/)));
  });

  it("an unproven address sees why and can ask for the link; a proven one sees no banner", async () => {
    signIn();
    dashboard = { affiliate: affiliate(false), stats, recent_conversions: [] };
    await mount();
    await screen.findByText("Confirm your email address to be paid");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send the confirmation link" })); });
    await waitFor(() => expect(calls("confirm-request")).toHaveLength(1));
    expect((calls("confirm-request")[0][1] as { body: Record<string, unknown> }).body).toEqual({ action: "confirm-request", sessionToken: TOKEN });
    cleanup();

    dashboard = { affiliate: affiliate(true), stats, recent_conversions: [] };
    await mount();
    await screen.findByText("Affiliate Dashboard");
    expect(screen.queryByText("Confirm your email address to be paid")).toBeNull();
  });

  it("before the round's dashboard says either way, no banner is shown", async () => {
    signIn();
    dashboard = { affiliate: affiliate(undefined), stats, recent_conversions: [] };
    await mount();
    await screen.findByText("Affiliate Dashboard");
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_affiliate_dashboard", expect.anything()));
    expect(screen.queryByText("Confirm your email address to be paid")).toBeNull();
  });
});

describe("the account card", () => {
  beforeEach(() => { signIn(); dashboard = { affiliate: affiliate(true), stats, recent_conversions: [] }; });

  it("signs out every device, this one included", async () => {
    invoke.mockImplementation(async () => ({ data: { status: "signed_out", sessions: 3 }, error: null }));
    await mount();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Sign out everywhere" })); });
    await waitFor(() => expect(calls("sign-out-everywhere")).toHaveLength(1));
    await waitFor(() => expect(localStorage.getItem("affiliate_session")).toBeNull());
  });

  it("downloads what the program holds", async () => {
    const created: Blob[] = [];
    const url = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    const saved = { create: url.createObjectURL, revoke: url.revokeObjectURL };
    url.createObjectURL = (b: Blob) => { created.push(b); return "blob:x"; };
    url.revokeObjectURL = () => {};
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      invoke.mockImplementation(async () => ({ data: { status: "ok", export: { account: { email: "aff@example.com" } } }, error: null }));
      await mount();
      await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Download my data" })); });
      await waitFor(() => expect(created).toHaveLength(1));
      expect(JSON.parse(await created[0].text())).toEqual({ account: { email: "aff@example.com" } });
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
      url.createObjectURL = saved.create;
      url.revokeObjectURL = saved.revoke;
    }
  });

  it("mails a change-of-address link to the new address", async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText("New email address"), { target: { value: "new@example.com" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send a link to the new address" })); });
    await waitFor(() => expect(calls("email-change-request")).toHaveLength(1));
    expect((calls("email-change-request")[0][1] as { body: Record<string, unknown> }).body).toEqual({ action: "email-change-request", sessionToken: TOKEN, newEmail: "new@example.com" });
  });

  it("closes the account only after ERASE, then signs this device out", async () => {
    invoke.mockImplementation(async () => ({ data: { status: "erased" }, error: null }));
    await mount();
    const close = await screen.findByRole("button", { name: "Close the account for good" });
    expect((close as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("ERASE"), { target: { value: "ERASE" } });
    await act(async () => { fireEvent.click(close); });
    await waitFor(() => expect(calls("erase")).toHaveLength(1));
    expect((calls("erase")[0][1] as { body: Record<string, unknown> }).body).toEqual({ action: "erase", sessionToken: TOKEN, confirm: "ERASE" });
    await waitFor(() => expect(localStorage.getItem("affiliate_session")).toBeNull());
  });
});
