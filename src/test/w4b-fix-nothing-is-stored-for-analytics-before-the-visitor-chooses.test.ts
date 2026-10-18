/**
 * NOTHING IS STORED FOR ANALYTICS BEFORE THE VISITOR CHOOSES (wave 4 round 2
 * review, security lens).
 *
 * WHAT WAS WRONG. The banner says "Nothing is stored or sent for this until
 * you choose", and only the send was gated: on every page, before any choice,
 * the funnel and cohort hooks wrote funnel_session_id, funnel_initialized,
 * funnel_landing_time, cohort_session_id, cohort_initialized and cohort_data
 * (UTM, referrer, time zone) to sessionStorage.
 *
 * WHAT HOLDS NOW (the real hooks): before a choice, initFunnelTracking writes
 * none of those keys (it keeps them in the page's memory); after a yes they
 * are stored; a no removes them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_SESSION_KEYS } from "@/lib/analytics-session-store";

vi.mock("@/lib/track-transport", async (orig) => {
  const real = await orig<typeof import("@/lib/track-transport")>();
  return { ...real, postTrackEvent: vi.fn(async () => undefined) };
});

const stored = () => ANALYTICS_SESSION_KEYS.filter((k) => sessionStorage.getItem(k) !== null);

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
});

describe("the funnel and cohort hooks store nothing before the choice", () => {
  it("before a choice: no analytics key reaches sessionStorage", async () => {
    const { initFunnelTracking } = await import("@/hooks/use-funnel-tracking");
    initFunnelTracking();
    expect(stored()).toEqual([]);
  });

  it("after a yes they are stored, and a no removes them", async () => {
    const consent = await import("@/lib/consent");
    consent.setAnalyticsConsent("granted");
    const { initFunnelTracking } = await import("@/hooks/use-funnel-tracking");
    initFunnelTracking();
    expect(stored()).toEqual(expect.arrayContaining(["funnel_initialized", "funnel_landing_time", "cohort_data", "cohort_initialized"]));
    const transport = await import("@/lib/track-transport");
    transport.chooseAnalytics("denied");
    expect(stored()).toEqual([]);
  });
});
