// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * A VISIT RECORDS WHERE IT CAME FROM ON THE PAGE IT STARTS ON.
 *
 * WHAT WAS WRONG. The funnel's landing (and the cohort record carrying the
 * visit's utm tags, referrer and landing page) was started only as a side
 * effect of a component: the header's product dialog mounts the checkout
 * hook, whose funnel hook records the landing. A page without the header
 * recorded nothing -- and the one that matters is /r/<code>, the affiliate
 * short link: it reloads the browser onto /?ref=<code>, which drops the link's
 * utm tags and replaces the external referrer with our own /r/ page, so the
 * landing the homepage then records reads "direct" with no campaign. Every
 * affiliate visit was filed as direct traffic.
 *
 * WHAT THIS HOLDS. The whole app is mounted with tracking switched on: at an
 * affiliate short link carrying a campaign, and at a posting carrying one.
 * Both landings leave the browser naming the path the visit started on, the
 * campaign and the source, under the browser's one visitor id -- the short
 * link's before its redirect runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowAnalytics } from "./helpers/analytics-consent";
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    const self = () => th;
    for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "limit"]) th[k] = self;
    th.maybeSingle = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: { name: "x", message: "offline" } }) },
      from: () => table(),
      rpc: async () => ({ data: [] }),
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});

import App from "../App";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Body = { testName?: string; variant?: string; visitorId?: string; metadata?: Record<string, unknown> };

function arrive(path: string, referrer: string) {
  window.history.replaceState(null, "", path);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
  vi.stubEnv("DEV", false);
  const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ status: "recorded" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  return (): Body[] =>
    fetchSpy.mock.calls
      .filter(([u]) => String(u).endsWith("/functions/v1/track-ab-event"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body);
}

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); allowAnalytics(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("a visit records where it came from on the page it starts on", () => {
  it("an affiliate short link records its own landing, campaign and referrer before it redirects", async () => {
    const sent = arrive("/r/creator1?utm_source=newsletter&utm_medium=email&utm_campaign=t1", "https://creator.example/best-tools");
    render(<App />);
    await waitFor(() => expect(sent().some((b) => b.variant === "landing_view"), "no landing was recorded on the short link").toBe(true), { timeout: 4000 });
    const landing = sent().find((b) => b.testName === "conversion_funnel" && b.variant === "landing_view")!;
    expect(landing.metadata).toMatchObject({
      landingPage: "/r/creator1",
      utmSource: "newsletter",
      utmCampaign: "t1",
      trafficSource: "email",
      referrer: "https://creator.example/best-tools",
    });
    expect(landing.visitorId).toMatch(UUID_RE);
  });

  it("a posting records the posting's path, the campaign and the source, with the cohort record under the same visitor", async () => {
    const sent = arrive("/jobs/posting/greenhouse/acme/4012345?utm_source=reddit&utm_medium=community&utm_campaign=t1", "https://www.reddit.com/r/jobs/comments/abc/");
    render(<App />);
    await waitFor(() => expect(sent().some((b) => b.variant === "landing_view")).toBe(true), { timeout: 4000 });
    const landing = sent().find((b) => b.testName === "conversion_funnel" && b.variant === "landing_view")!;
    expect(landing.metadata).toMatchObject({
      landingPage: "/jobs/posting/greenhouse/acme/4012345",
      page: "/jobs/posting/greenhouse/acme/4012345",
      utmSource: "reddit",
      utmMedium: "community",
      utmCampaign: "t1",
      trafficSource: "social",
      referrer: "https://www.reddit.com/r/jobs/comments/abc/",
    });
    expect(landing.visitorId).toMatch(UUID_RE);
    const cohort = sent().find((b) => b.testName === "cohort_analysis")!;
    expect(cohort, "the cohort record of the visit was never sent").toBeTruthy();
    expect(cohort.metadata).toMatchObject({
      eventType: "session_start",
      landingPage: "/jobs/posting/greenhouse/acme/4012345",
      utmCampaign: "t1",
      referrerDomain: "www.reddit.com",
    });
    expect(cohort.visitorId).toBe(landing.visitorId);
  });
});
