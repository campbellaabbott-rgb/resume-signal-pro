/**
 * AN AFFILIATE LINK STORES AND LOGS NOTHING UNTIL ANALYTICS ARE ALLOWED
 * (hotfix H6; sweep M-S14-021, C-S14-009).
 *
 * useAffiliateTracking (src/hooks/use-affiliate-auth.ts) wrote a 30-day
 * affiliate_ref cookie and localStorage entry and called track_affiliate_click
 * on the first render of any ?ref= visit, before the analytics banner was
 * answered: the S12-011 consent gate never covered it. What holds now:
 *   - before an answer, nothing is stored on the device and no click is logged;
 *   - a yes later in the same visit stores the referral and logs the click
 *     once, even from another page after the scanner has unmounted;
 *   - a no stores and logs nothing, and a later yes still releases it;
 *   - a visitor who already said yes is recorded at once, as before;
 *   - a purchase started in the same visit still names the referrer, from
 *     memory, with nothing stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...(a as [])) } }));

import { useAffiliateTracking, getStoredReferralCode, clearReferralCode } from "@/hooks/use-affiliate-auth";
import { resetConsentMemory, setAnalyticsConsent } from "@/lib/consent";

const CODE = "0a1b2c3d4e5f";

function Scanner() {
  useAffiliateTracking();
  return <p>scanner</p>;
}

const clicks = () => rpc.mock.calls.filter((c) => (c as unknown[])[0] === "track_affiliate_click");
const storedEntry = () => localStorage.getItem("affiliate_ref");
const referralCookie = () => document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("affiliate_ref="));

beforeEach(() => {
  localStorage.clear();
  resetConsentMemory();
  clearReferralCode();
  rpc.mockClear();
  window.history.pushState({}, "", `/resume-checker?ref=${CODE}`);
});
afterEach(() => {
  cleanup();
  clearReferralCode();
  window.history.pushState({}, "", "/");
});

describe("before the visitor answers the analytics question", () => {
  it("a ?ref= visit sets no cookie, writes no localStorage entry and logs no click", async () => {
    render(<Scanner />);
    // Give the old fire-and-forget logger every chance to have run.
    await new Promise((r) => setTimeout(r, 50));
    expect(storedEntry(), "the referral was stored before consent").toBeNull();
    expect(referralCookie(), "the 30-day cookie was set before consent").toBeUndefined();
    expect(clicks(), "the click was logged before consent").toHaveLength(0);
  });

  it("a purchase started in the same visit still names the referrer, from memory", () => {
    render(<Scanner />);
    expect(getStoredReferralCode()).toBe(CODE);
    expect(storedEntry()).toBeNull();
    expect(referralCookie()).toBeUndefined();
  });
});

describe("a yes releases the held referral", () => {
  it("allowing analytics later in the visit stores the referral and logs the click once", async () => {
    render(<Scanner />);
    setAnalyticsConsent("granted");
    await waitFor(() => expect(clicks()).toHaveLength(1));
    expect((clicks()[0] as unknown[])[1]).toMatchObject({ p_referral_code: CODE });
    expect(JSON.parse(storedEntry() ?? "{}").code).toBe(CODE);
    expect(referralCookie()).toBeTruthy();
    // A second consent event does not log it twice.
    setAnalyticsConsent("granted");
    await new Promise((r) => setTimeout(r, 30));
    expect(clicks()).toHaveLength(1);
  });

  it("still counts when the yes comes on another page, after the scanner unmounted", async () => {
    const { unmount } = render(<Scanner />);
    unmount();
    window.history.pushState({}, "", "/jobs");
    setAnalyticsConsent("granted");
    await waitFor(() => expect(clicks()).toHaveLength(1));
    expect(JSON.parse(storedEntry() ?? "{}").code).toBe(CODE);
  });

  it("a no stores and logs nothing, and a later yes from the Privacy page still releases it", async () => {
    render(<Scanner />);
    setAnalyticsConsent("denied");
    await new Promise((r) => setTimeout(r, 30));
    expect(storedEntry()).toBeNull();
    expect(referralCookie()).toBeUndefined();
    expect(clicks()).toHaveLength(0);
    setAnalyticsConsent("granted");
    await waitFor(() => expect(clicks()).toHaveLength(1));
  });

  it("a visitor who already allowed analytics is recorded at once, as before", async () => {
    setAnalyticsConsent("granted");
    render(<Scanner />);
    await waitFor(() => expect(clicks()).toHaveLength(1));
    expect(JSON.parse(storedEntry() ?? "{}").code).toBe(CODE);
    expect(referralCookie()).toBeTruthy();
  });

  it("a completed purchase clears a held code too, so a later yes records nothing", async () => {
    render(<Scanner />);
    clearReferralCode();
    expect(getStoredReferralCode()).toBeNull();
    setAnalyticsConsent("granted");
    await new Promise((r) => setTimeout(r, 30));
    expect(clicks()).toHaveLength(0);
    expect(storedEntry()).toBeNull();
  });
});
