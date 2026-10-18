/**
 * THE ACCOUNT PAGE SHOWS ITS CONNECTED AIS AND ITS MAIL (plan CP-H, Account UX
 * spec section 6; decision D12).
 *
 * WHAT WAS WRONG. A key minted for a person's AI never appeared on the account
 * page and could only be replaced by minting another; the market pulse could
 * only be left from one of its mails; the page's section menu reached none of
 * the account's own sections.
 *
 * WHAT HOLDS NOW, mounted with account-settings faked: each live key shows by
 * its prefix with its dates and a Revoke that asks account-settings to stop
 * that key; the pulse shows with Stop for a proven address and no list for an
 * unproven one; a failed read says so and Try again reads again; the section
 * menu links #orders, #plan, #security, #connected and #privacy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

type Settings = { connectors: unknown[]; mail: unknown; mailboxProven: boolean };
const invoked: Array<Record<string, unknown>> = [];
let reply: (body: Record<string, unknown>) => { data: unknown; error: unknown } = () => ({ data: null, error: { message: "x" } });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (fn: string, opts: { body: Record<string, unknown> }) => {
        invoked.push({ fn, ...opts.body });
        return reply(opts.body);
      },
    },
  },
}));

import { AccountSettingsCards } from "@/components/account/ConnectedAIsCard";
import { AccountNav } from "@/components/account/AccountNav";
import { MAILBOX_PROOF_LIVE } from "@/components/account/CreditsAndPurchases";

const KEY = { id: "11111111-1111-4111-8111-111111111111", prefix: "rb_live_ab12cd34", name: "Connected agent", createdAt: "2026-10-10T09:00:00Z", lastUsedAt: null };
let state: Settings;

beforeEach(() => {
  invoked.length = 0;
  state = { connectors: [KEY], mail: { marketPulse: [{ industry: "technology", state: "subscribed" }] }, mailboxProven: true };
  reply = (body) => {
    if (body.action === "read") return { data: state, error: null };
    if (body.action === "revoke_connector") { state = { ...state, connectors: [] }; return { data: { revoked: true }, error: null }; }
    if (body.action === "pulse_off") { state = { ...state, mail: { marketPulse: [{ industry: "technology", state: "off" }] } }; return { data: { unsubscribed: 1 }, error: null }; }
    return { data: null, error: { message: "unknown" } };
  };
});
afterEach(() => cleanup());

const mount = () => render(<MemoryRouter><AccountSettingsCards /></MemoryRouter>);

describe("Connected AIs", () => {
  it("shows each live key by its prefix, never the key, and Revoke stops that key", async () => {
    mount();
    const row = await waitFor(() => {
      const el = document.querySelector(`[data-connector="${KEY.id}"]`);
      if (!el) throw new Error("no key row yet");
      return el;
    });
    expect(row.textContent).toMatch(/rb_live_ab12cd34…/);
    expect(row.textContent).toMatch(/Not used yet/);
    fireEvent.click(screen.getByText("Revoke"));
    await waitFor(() => expect(document.querySelector("[data-connected-empty]")).not.toBeNull());
    expect(invoked).toContainEqual({ fn: "account-settings", action: "revoke_connector", keyId: KEY.id });
  });
});

describe("Email preferences", () => {
  it("a proven address sees its pulse and can stop it", async () => {
    mount();
    await waitFor(() => expect(document.querySelector('[data-pulse-state="subscribed"]')).not.toBeNull());
    fireEvent.click(screen.getByText("Stop the market pulse"));
    await waitFor(() => expect(document.querySelector('[data-pulse-state="off"]')).not.toBeNull());
    expect(invoked).toContainEqual({ fn: "account-settings", action: "pulse_off" });
  });

  it("an unproven address is shown no list", async () => {
    state = { ...state, mail: null, mailboxProven: false };
    mount();
    await waitFor(() => expect(document.querySelector("[data-mail-unproven]")).not.toBeNull());
    expect(document.querySelector("[data-pulse]")).toBeNull();
  });

  it("the unproven note names no sign-in that is switched off (no code, no Google while their switches are off)", async () => {
    state = { ...state, mail: null, mailboxProven: false };
    mount();
    await waitFor(() => expect(document.querySelector("[data-mail-unproven]")).not.toBeNull());
    const note = document.querySelector("[data-mail-unproven]")!.textContent ?? "";
    expect(MAILBOX_PROOF_LIVE).toBe(false);
    expect(note).not.toMatch(/\bcode\b|google|apple/i);
    expect(note).toMatch(/once this page can check that the address is yours/);
    expect(note).toMatch(/unsubscribe link/);
  });
});

describe("a failed read", () => {
  it("says so, shows no empty list as fact, and Try again reads again", async () => {
    const ok = reply;
    reply = () => ({ data: null, error: { message: "500" } });
    mount();
    await waitFor(() => expect(document.querySelector("[data-settings-failed]")).not.toBeNull());
    expect(document.querySelector("[data-connected-empty]")).toBeNull();
    reply = ok;
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(document.querySelector(`[data-connector="${KEY.id}"]`)).not.toBeNull());
    expect(invoked.filter((c) => c.action === "read")).toHaveLength(2);
  });
});

describe("the section menu", () => {
  it("reaches the account's own sections", () => {
    render(<AccountNav />);
    const hrefs = [...document.querySelectorAll("nav a")].map((a) => a.getAttribute("href"));
    for (const h of ["#orders", "#plan", "#security", "#connected", "#privacy"]) expect(hrefs).toContain(h);
  });
});
