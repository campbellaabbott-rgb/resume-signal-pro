/**
 * A CONFIRMED PULSE SAYS WHEN THE NEXT ONE ARRIVES (S14X-238, the page's half;
 * the claim and the confirm answer are a-pulse-goes-once-a-calendar-month).
 *
 * WHAT WAS WRONG. The pulse now goes at most once a calendar month, but the
 * confirm page told every address "The first pulse arrives within a day",
 * including one coming back after an unsubscribe that already had this
 * month's.
 *
 * WHAT HOLDS NOW, on the real page with the network faked: a confirm answer
 * carrying nextPulse 'next_month' or 'later_this_month' prints that sentence
 * (src/i18n/shards/mail, mailPrefs); an answer without it (a first
 * subscription, or a server that predates the field) prints the old one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import en from "@/i18n/shards/mail/en.json";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import MarketPulseConfirm from "../pages/MarketPulseConfirm";

const TOKEN = "ef".repeat(32);
beforeEach(() => {
  invoke.mockReset();
  window.history.replaceState(null, "", `/market-pulse/confirm#t=${TOKEN}`);
});
afterEach(() => cleanup());

async function confirmWith(answer: Record<string, unknown>): Promise<string> {
  invoke.mockResolvedValue({ data: answer, error: null });
  render(<HelmetProvider><MemoryRouter><MarketPulseConfirm /></MemoryRouter></HelmetProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /yes, send me the pulse/i }));
  const done = await waitFor(() => {
    const el = document.querySelector("[data-next-pulse]");
    if (!el) throw new Error("not confirmed yet");
    return el;
  });
  return done.textContent ?? "";
}

describe("the confirmed page", () => {
  it("says the next pulse arrives next month when this month's already went", async () => {
    expect(await confirmWith({ success: true, confirmed: true, nextPulse: "next_month" })).toBe(en.mailPrefs.pulseDoneNextMonth);
  });

  it("says later this month when the last one went under four weeks ago", async () => {
    expect(await confirmWith({ success: true, confirmed: true, nextPulse: "later_this_month" })).toBe(en.mailPrefs.pulseDoneLater);
  });

  it("keeps 'within a day' for a first subscription, an older server, or a value it does not know", async () => {
    expect(await confirmWith({ success: true, confirmed: true })).toMatch(/The first pulse arrives within a day/);
    cleanup();
    window.history.replaceState(null, "", `/market-pulse/confirm#t=${TOKEN}`);
    expect(await confirmWith({ success: true, confirmed: true, nextPulse: "<b>soon</b>" })).toMatch(/The first pulse arrives within a day/);
  });
});
