/**
 * AN ACCOUNT IS TOLD ITS ADDRESS IS OFF OUR MAIL, ON ITS PAGE (S14X-107; the
 * server's half is an-account-is-told-its-address-is-off-our-mail).
 *
 * WHAT HOLDS NOW, mounted with account-settings faked: when the read answers
 * mailStopped, the Email preferences card says in one sentence that no alert,
 * report or pulse reaches the address, with its own sentence for a bounce, a
 * spam report and a deleted account's note; a server that predates the field
 * (no mailStopped in its answer) shows the card as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "@/i18n/shards/mail/en.json";

vi.setConfig(MOUNT_TEST_BUDGET);

let answer: Record<string, unknown> = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async () => ({ data: answer, error: null }) } },
}));

import { AccountSettingsCards } from "@/components/account/ConnectedAIsCard";

const BASE = { connectors: [], mail: { marketPulse: [{ industry: "technology", state: "subscribed" }] }, mailboxProven: true };
afterEach(() => cleanup());

async function stoppedText(extra: Record<string, unknown>): Promise<string | null> {
  answer = { ...BASE, ...extra };
  render(<MemoryRouter><AccountSettingsCards /></MemoryRouter>);
  await waitFor(() => expect(document.querySelector("[data-mail-card]")).not.toBeNull());
  return document.querySelector("[data-mail-stopped]")?.textContent ?? null;
}

describe("the Email preferences card", () => {
  it("says an address that asked to stop all mail gets none", async () => {
    expect(await stoppedText({ mailStopped: { reason: "unsubscribe", accountDeleted: false } })).toBe(en.mailPrefs.stoppedUnsubscribe);
  });

  it("names a bounce, a spam report and a deleted account's note in their own sentences", async () => {
    expect(await stoppedText({ mailStopped: { reason: "bounce", accountDeleted: false } })).toBe(en.mailPrefs.stoppedBounce);
    cleanup();
    expect(await stoppedText({ mailStopped: { reason: "complaint", accountDeleted: false } })).toBe(en.mailPrefs.stoppedComplaint);
    cleanup();
    expect(await stoppedText({ mailStopped: { reason: "unsubscribe", accountDeleted: true } })).toBe(en.mailPrefs.stoppedAccountDeleted);
  });

  it("says nothing for an address on no list, or from a server that predates the field", async () => {
    expect(await stoppedText({ mailStopped: null })).toBeNull();
    cleanup();
    expect(await stoppedText({})).toBeNull();
    expect(document.querySelector('[data-pulse-state="subscribed"]')).not.toBeNull();
  });
});
