/**
 * EVERY AFFILIATE FIELD IS NAMED, AND THE PAGE WAITS IN THE READER'S
 * LANGUAGE (the bug round's review of S14X-115 and S14X-093).
 *
 * WHAT WAS WRONG. The affiliate page's fields were named only by their
 * placeholders: the new-password field, the two email fields, the
 * change-of-address field and the ERASE field had no label a screen reader
 * keeps once something is typed (WCAG 1.3.1, 4.1.2). Two words were typed in
 * English in every language: the email fields' "Email" and the buttons'
 * "Please wait...".
 *
 * WHAT HOLDS NOW, with the page mounted for real (Supabase faked): each of
 * those fields carries an aria-label from the affiliate strings, in the
 * reader's language; a German reader sees "E-Mail" and, while a request is
 * out, "Bitte warten…". A refusal from the address door (affiliate-account's
 * 429) shows the sentence the function sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

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
const affiliate = { id: "a1", email: "aff@example.com", referral_code: "ab12cd34", commission_amount: 1000, status: "active", created_at: "2026-11-01T00:00:00Z", email_confirmed: true };
const stats = { total_clicks: 0, total_conversions: 0, total_revenue: 0, pending_payout: 0, paid_out: 0, conversion_rate: 0 };
const signIn = () => localStorage.setItem("affiliate_session", JSON.stringify({ affiliateId: "a1", email: "aff@example.com", referralCode: "ab12cd34", sessionToken: TOKEN }));
const mount = async () => { await act(async () => { render(<MemoryRouter><Affiliates /></MemoryRouter>); }); };
const named = (name: string) => document.querySelector(`input[aria-label="${name}"]`);

beforeEach(() => {
  for (const f of Object.values(toast)) f.mockReset();
  invoke.mockReset();
  invoke.mockImplementation(async () => ({ data: { status: "sent" }, error: null }));
  rpc.mockClear();
  localStorage.clear();
  window.history.replaceState(null, "", "/affiliates");
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoResize;
});
afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
});

describe("every field carries a name a screen reader keeps", () => {
  it("the sign-in card's two fields and the forgot form's address", async () => {
    await mount();
    expect(named("Email"), "the sign-in email field").not.toBeNull();
    expect(named("Password (min 8 characters)"), "the sign-in password field").not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Forgot password?" })); });
    expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
  });

  it("the new-password form a #reset= link opens", async () => {
    window.history.replaceState(null, "", `/affiliates#reset=${LINK}`);
    await mount();
    await screen.findByRole("button", { name: "Save the new password" });
    expect(named("New password (min 8 characters)")).not.toBeNull();
  });

  it("the account card's change-of-address and ERASE fields", async () => {
    signIn();
    dashboard = { affiliate, stats, recent_conversions: [] };
    await mount();
    await screen.findByText("Affiliate Dashboard");
    expect(screen.getByRole("textbox", { name: "New email address" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Type ERASE to confirm" })).toBeTruthy();
  });
});

describe("a German reader", () => {
  it("is asked for an E-Mail, not an Email, and waits with Bitte warten…, never Please wait...", async () => {
    await i18n.changeLanguage("de");
    // German loads on demand, with its shards.
    await waitFor(() => expect(i18n.hasResourceBundle("de", "translation")).toBe(true));
    let answer: (v: { data: unknown; error: unknown }) => void = () => {};
    invoke.mockImplementation(() => new Promise((r) => { answer = r; }));
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: i18n.t("affiliateProgram.auth.forgot") })); });
    const field = screen.getByRole("textbox", { name: "E-Mail" });
    expect(field.getAttribute("placeholder")).toBe("E-Mail");
    fireEvent.change(field, { target: { value: "aff@example.com" } });
    await act(async () => { fireEvent.submit(field.closest("form")!); });
    expect(document.body.textContent).not.toContain("Please wait");
    expect(document.body.textContent).toContain("Bitte warten…");
    await act(async () => { answer({ data: { status: "sent" }, error: null }); });
  });
});

describe("a refusal from affiliate-account's address door", () => {
  it("shows the sentence the function sends", async () => {
    signIn();
    dashboard = { affiliate, stats, recent_conversions: [] };
    invoke.mockImplementation(async () => ({ data: null, error: Object.assign(new Error("non-2xx"), { context: new Response(JSON.stringify({ error: "Too many address changes today. Please try again tomorrow." }), { status: 429 }) }) }));
    await mount();
    await screen.findByText("Affiliate Dashboard");
    fireEvent.change(screen.getByPlaceholderText("New email address"), { target: { value: "new@example.com" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send a link to the new address" })); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too many address changes today. Please try again tomorrow."));
  });
});
