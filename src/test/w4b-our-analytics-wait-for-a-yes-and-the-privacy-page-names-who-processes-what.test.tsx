// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * OUR ANALYTICS WAIT FOR A YES (S12-011), AND THE PRIVACY PAGE NAMES WHO
 * PROCESSES WHAT (S12-049; plan CP-039, CP-041, D14).
 *
 * WHAT WAS WRONG.
 *   S12-011  A persistent visitor id (rb_visitor_id) was written and funnel
 *            events were posted to track-ab-event from the first page view,
 *            with no consent anywhere; the Privacy page said cookies were
 *            managed "through your browser settings".
 *   S12-049  The homepage claimed "Data Never Used for Training", unverified;
 *            the Privacy page said data improves "our AI algorithms", named no
 *            mail, address-lookup or font processor, still described the
 *            retired apply agent and said an uploaded CV had to be erased by
 *            email although deleting the account removes it.
 *
 * WHAT HOLDS NOW.
 *   - Before a choice: no event leaves, no visitor id is read or stored, no
 *     A/B assignment is stored; a checkout still gets a per-page id.
 *   - After "Allow": events go and the id persists. After "No thanks": the
 *     stored ids are removed and nothing goes.
 *   - The banner shows until a choice, says the host's own counter is not
 *     controlled by it, and the Privacy page can open it again.
 *   - The comparison table makes no training claim and offers no LinkedIn row;
 *     the Privacy page names its processors and the Shortlist rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

import { CONSENT_KEY, analyticsConsent, resetConsentMemory, setAnalyticsConsent } from "@/lib/consent";
import { checkoutContext, chooseAnalytics, getVisitorId, postTrackEvent, VISITOR_ID_KEY } from "@/lib/track-transport";
import { ConsentBanner, openConsentChoice } from "@/components/ConsentBanner";
import { ComparisonTable, COMPARISON_FEATURES } from "@/components/ComparisonTable";

const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ status: "recorded" }), { status: 200 }));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetConsentMemory();
  fetchSpy.mockClear();
  // A production address with DEV off, so the transport would send (as a-repeat-the-writer-would-refuse runs it).
  vi.stubEnv("DEV", false);
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const sends = () => fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/functions/v1/track-ab-event"));

describe("S12-011: before a choice, nothing", () => {
  it("no event leaves and no visitor id is read or stored; a checkout still has a per-page id", () => {
    localStorage.setItem(VISITOR_ID_KEY, "11111111-1111-4111-8111-111111111111");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    postTrackEvent({ testName: "t", variant: "a", eventType: "view" });
    expect(sends()).toEqual([]);
    const id = getVisitorId();
    expect(id).not.toBe("11111111-1111-4111-8111-111111111111");
    expect(getItem.mock.calls.filter((c) => c[0] === VISITOR_ID_KEY)).toEqual([]);
    getItem.mockRestore();
    expect(checkoutContext().visitorId).toBe(id);
  });

  it("after Allow, events go and the id persists; after No thanks, the ids are removed and nothing goes", async () => {
    setAnalyticsConsent("granted");
    postTrackEvent({ testName: "t", variant: "a", eventType: "view" });
    expect(sends()).toHaveLength(1);
    const id = getVisitorId();
    expect(localStorage.getItem(VISITOR_ID_KEY)).toBe(id);
    localStorage.setItem("ab_some_test", "control");
    chooseAnalytics("denied");
    expect(localStorage.getItem(VISITOR_ID_KEY)).toBeNull();
    expect(localStorage.getItem("ab_some_test")).toBeNull();
    postTrackEvent({ testName: "t2", variant: "a", eventType: "view" });
    expect(sends()).toHaveLength(1);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("denied");
  });
});

describe("the banner", () => {
  it("shows until a choice, names the host's own counter, and records the choice", () => {
    render(<ConsentBanner />);
    const banner = screen.getByRole("dialog", { name: "Analytics choice" });
    expect(banner.textContent).toMatch(/Nothing is stored or sent for this until you choose/);
    expect(banner.textContent).toMatch(/hosting provider runs its own page-visit counter, which this choice does not control/);
    fireEvent.click(screen.getByRole("button", { name: "Allow analytics" }));
    expect(analyticsConsent()).toBe("granted");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays away after a choice, and the Privacy page's control opens it again", () => {
    setAnalyticsConsent("denied");
    render(<ConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openConsentChoice());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("S12-049: no unverified claim, and the processors named", () => {
  it("the comparison makes no training claim and has no LinkedIn row", () => {
    expect(COMPARISON_FEATURES.map((f) => f.key)).not.toEqual(expect.arrayContaining(["privacyFirst"]));
    expect(COMPARISON_FEATURES.map((f) => f.key)).not.toContain("linkedinAnalysis");
    render(<MemoryRouter><ComparisonTable /></MemoryRouter>);
    expect(document.body.textContent).not.toMatch(/Never Used for Training|LinkedIn/i);
  });

  it("the Privacy page names every processor, the Shortlist rule and the analytics choice, and no retired agent", async () => {
    const Privacy = (await import("@/pages/Privacy")).default;
    render(<HelmetProvider><MemoryRouter><Privacy /></MemoryRouter></HelmetProvider>);
    const text = document.body.textContent ?? "";
    const processors = document.querySelector("[data-processors]")!.textContent!;
    for (const name of ["Stripe", "Lovable", "Supabase", "Google and OpenAI", "Mailgun", "Resend", "ipinfo", "Google Fonts"]) expect(processors, name).toContain(name);
    expect(text).toMatch(/record no candidate's sex or race/);
    expect(text).toMatch(/We do not train AI models on your resume/);
    expect(text).not.toMatch(/AI algorithms|through your browser settings|apply agent/i);
    expect(text).toMatch(/Deleting your account erases them all, including the uploaded CV files/);
    fireEvent.click(document.querySelector("[data-change-consent]")!);
  });
});
