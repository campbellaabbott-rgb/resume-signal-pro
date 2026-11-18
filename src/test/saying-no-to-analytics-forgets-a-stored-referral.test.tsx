/**
 * SAYING NO TO ANALYTICS FORGETS A STORED REFERRAL (S14X-021, the browser's half).
 *
 * WHAT WAS WRONG. A visitor who allowed analytics and arrived through an
 * affiliate link kept a 30-day affiliate_ref entry in localStorage and a
 * cookie of the same name. Changing the answer to "No thanks" removed the
 * visitor ids and the A/B keys and left both copies of the referral behind.
 * And the click the link logged carried a fingerprint the page built from the
 * browser's agent, language, screen size and time zone, sent as p_ip_hash.
 *
 * WHAT HOLDS NOW:
 *   - a yes plus ?ref= stores the referral (both copies), as before;
 *   - chooseAnalytics('denied') removes both copies;
 *   - the click is logged without p_ip_hash: the server keys the platform's
 *     address itself (20261112121000), so the page builds no fingerprint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...(a as [])) } }));

import { useAffiliateTracking, clearReferralCode } from "@/hooks/use-affiliate-auth";
import { resetConsentMemory, setAnalyticsConsent } from "@/lib/consent";
import { chooseAnalytics } from "@/lib/track-transport";

const CODE = "0a1b2c3d4e5f";

function Landing() {
  useAffiliateTracking();
  return <p>landing</p>;
}

const clicks = () => rpc.mock.calls.filter((c) => (c as unknown[])[0] === "track_affiliate_click");
const storedEntry = () => localStorage.getItem("affiliate_ref");
const referralCookie = () => document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("affiliate_ref=") && c.length > "affiliate_ref=".length);

beforeEach(() => {
  localStorage.clear();
  resetConsentMemory();
  clearReferralCode();
  rpc.mockClear();
  window.history.pushState({}, "", `/?ref=${CODE}`);
});
afterEach(() => {
  cleanup();
  clearReferralCode();
  window.history.pushState({}, "", "/");
});

describe("a stored referral follows the analytics answer", () => {
  it("a yes stores it in both places, and a later No thanks removes both", async () => {
    setAnalyticsConsent("granted");
    render(<Landing />);
    await waitFor(() => expect(clicks()).toHaveLength(1));
    expect(JSON.parse(storedEntry() ?? "{}").code).toBe(CODE);
    expect(referralCookie()).toBeTruthy();

    chooseAnalytics("denied");
    expect(storedEntry(), "the localStorage copy outlived a No thanks").toBeNull();
    expect(referralCookie(), "the cookie outlived a No thanks").toBeUndefined();
  });

  it("the click carries no fingerprint built by the page", async () => {
    setAnalyticsConsent("granted");
    render(<Landing />);
    await waitFor(() => expect(clicks()).toHaveLength(1));
    const args = (clicks()[0] as unknown[])[1] as Record<string, unknown>;
    expect(args).toMatchObject({ p_referral_code: CODE });
    expect(args, "the page sent its own visitor hash").not.toHaveProperty("p_ip_hash");
  });
});
