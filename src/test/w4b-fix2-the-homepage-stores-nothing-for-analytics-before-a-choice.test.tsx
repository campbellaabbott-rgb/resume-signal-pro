/**
 * THE HOMEPAGE STORES NOTHING FOR ANALYTICS BEFORE A CHOICE (wave 4 round 2
 * recheck; the consent fix finished).
 *
 * WHAT WAS WRONG. The round 1 fix (a955ada1) routed six funnel and cohort keys
 * through src/lib/analytics-session-store.ts, and Privacy now says that until
 * you choose our own analytics stores and sends nothing. But the scroll and
 * time hooks Index and Pricing mount wrote scroll_tracked_<page>_<date> and
 * time_tracked_<page>_<date> before the transport's consent check,
 * use-optimization-tracking wrote session_start when its module loaded, the
 * funnel wrote funnel_progress after every event, and the success page wrote
 * purchase_tracked_<id>. forgetAnalyticsSession left all of them behind.
 *
 * WHAT HOLDS NOW (the real pages and hooks, mounted):
 *   - the homepage, mounted with no choice made, and every one of those hooks
 *     run, leave sessionStorage empty;
 *   - after a yes they are stored; a no removes every one, the per-page and
 *     per-purchase keys included.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit", "gte", "lte", "in"]) th[k] = () => th;
    th.maybeSingle = async () => ({ data: null });
    th.single = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: null }) },
      from: table,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
vi.mock("@/hooks/use-shared-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkConnectionHealth: async () => true,
}));
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...real, resilientCallers: { ...real.resilientCallers, freeKeywordScan: () => new Promise(() => {}) } };
});

import Index from "@/pages/Index";
import HomePage from "@/pages/home/HomePage";
import { TOOL_LANDINGS } from "@/data/tool-landings";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";
import { useFunnelTracking } from "@/hooks/use-funnel-tracking";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";
import { useOptimizationTracking } from "@/hooks/use-optimization-tracking";
import { isAnalyticsSessionKey } from "@/lib/analytics-session-store";
import { resetConsentMemory, setAnalyticsConsent } from "@/lib/consent";
import { chooseAnalytics } from "@/lib/track-transport";

vi.setConfig(MOUNT_TEST_BUDGET);
const keys = () => Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)!).sort();
const REVIEWED = /^(?:scroll_tracked_|time_tracked_|purchase_tracked_)|^(?:session_start|funnel_progress)$/;

/** Every hook the recheck named, run once. */
const runTheHooks = () => {
  renderHook(() => { useScrollDepth("pricing"); useTimeOnPage("pricing"); });
  const funnel = renderHook(() => useFunnelTracking()).result.current;
  act(() => { funnel.trackScanStarted("tech"); });
  const conversion = renderHook(() => useConversionTracking()).result.current;
  act(() => { conversion.trackPurchaseCompleted("fullAnalysis", 5, "cs_test_consent_probe"); });
  const optimisation = renderHook(() => useOptimizationTracking()).result.current;
  act(() => { optimisation.trackExitIntentDismissed(); });
};

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); resetConsentMemory(); chooseAnalytics("denied"); localStorage.clear(); resetConsentMemory(); });
afterEach(cleanup);

describe("before a choice", () => {
  // Since the homepage switch-over "/" is the board-first homepage, which
  // mounts no scroll or time hook (docs/homepage-pricing/README.md, step 13).
  it("the homepage at \"/\", mounted, leaves sessionStorage empty", async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><HomePage /></MemoryRouter></HelmetProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(document.getElementById("home-h1"), "the homepage rendered").not.toBeNull();
    expect(keys()).toEqual([]);
  });

  // The scanner's scroll and time hooks run where the scanner lives: every
  // Index route carries a landing, and the scanner's address is /resume-checker.
  it("the scanner at /resume-checker, mounted, leaves sessionStorage empty", async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/resume-checker"]}><Index landing={TOOL_LANDINGS["resume-checker"]} /></MemoryRouter></HelmetProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(keys()).toEqual([]);
  });

  it("every hook the recheck named stores nothing", () => {
    runTheHooks();
    expect(keys()).toEqual([]);
  });
});

describe("after a choice", () => {
  it("a yes stores them, and a no removes every one", () => {
    setAnalyticsConsent("granted");
    runTheHooks();
    const stored = keys();
    expect(stored.filter((k) => REVIEWED.test(k)).map((k) => k.replace(/_(?:pricing|cs_test).*$/, ""))).toEqual(
      expect.arrayContaining(["funnel_progress", "purchase_tracked", "scroll_tracked", "session_start", "time_tracked"]),
    );
    expect(stored.every(isAnalyticsSessionKey), stored.join(", ")).toBe(true);
    chooseAnalytics("denied");
    expect(keys()).toEqual([]);
  });
});
