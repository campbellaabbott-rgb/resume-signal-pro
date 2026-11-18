// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/?utm_source=news&utm_medium=mail" }
/**
 * A LANDING SEEN BEFORE THE YES IS SENT ONCE, AFTER IT (S14X-040).
 *
 * WHAT WAS WRONG. Our analytics send nothing until the visitor allows them
 * (src/lib/consent.ts), and the funnel's landing is recorded once per tab
 * (initFunnelTracking, mounted once above every route). On a first visit the
 * landing ran before the banner was answered: it marked the tab as landed in
 * the page's memory, its send was dropped by the transport because nothing
 * was allowed yet, and nothing ever sent it again. So every visitor who said
 * yes during their first visit, which is most of the visitors who say yes,
 * had no landing_view row, and their campaign and referrer were lost with it.
 *
 * WHAT HOLDS NOW, with the real hooks, the real consent module and the real
 * transport, only fetch faked and development mode off:
 *   - before the choice nothing is sent and nothing is stored;
 *   - a yes sends exactly one landing_view, carrying the campaign, the
 *     referrer and the page the visit LANDED on (not the page the yes was
 *     given on), under the funnel session the page held, which is now in the
 *     tab's storage;
 *   - a second yes sends nothing more;
 *   - a no sends nothing, and a later yes does not resurrect that landing;
 *   - a visitor who had already said yes is recorded at once, as before, and
 *     a later yes sends no second landing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LANDED = "/?utm_source=news&utm_medium=mail";
const REFERRER = "https://news.example/story";

type Body = { testName?: string; variant?: string; eventType?: string; metadata?: Record<string, unknown> };
let fetchSpy: ReturnType<typeof vi.fn>;
const bodies = (): Body[] =>
  fetchSpy.mock.calls
    .filter(([u]) => String(u).endsWith("/functions/v1/track-ab-event"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body);
const landings = () => bodies().filter((b) => b.testName === "conversion_funnel" && b.variant === "landing_view");
const settle = () => new Promise((r) => setTimeout(r, 0));

async function freshPage() {
  vi.resetModules();
  const consent = await import("@/lib/consent");
  consent.resetConsentMemory();
  const transport = await import("@/lib/track-transport");
  const funnel = await import("@/hooks/use-funnel-tracking");
  return { consent, transport, funnel };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", LANDED);
  Object.defineProperty(document, "referrer", { value: REFERRER, configurable: true });
  vi.stubEnv("DEV", false);
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ success: true, status: "recorded" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(async () => {
  // A landing still waiting for an answer belongs to this test's page only.
  const { CONSENT_EVENT } = await import("@/lib/consent");
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: "denied" }));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a landing seen before the yes", () => {
  it("is sent once a yes is given, with the campaign, the referrer and the page it landed on", async () => {
    const { transport, funnel } = await freshPage();
    funnel.initFunnelTracking();
    await settle();
    expect(bodies(), "something was sent before the visitor chose").toEqual([]);
    expect(sessionStorage.getItem("funnel_session_id"), "the funnel stored its session before the visitor chose").toBeNull();

    // The visitor moves on, then answers the banner on another page.
    window.history.pushState(null, "", "/pricing");
    transport.chooseAnalytics("granted");
    await settle();

    expect(landings(), "the yes sent no landing: this visit has no landing_view row").toHaveLength(1);
    const landing = landings()[0];
    expect(landing.eventType).toBe("view");
    expect(landing.metadata).toMatchObject({
      utmSource: "news",
      utmMedium: "mail",
      landingPage: "/",
      page: "/",
      referrer: REFERRER,
      stageIndex: 0,
      previousStages: 0,
      skippedStages: 0,
    });
    expect(landing.metadata?.timeSinceLanding).toBe(0);
    expect(sessionStorage.getItem("funnel_session_id"), "the page's funnel session did not move into the tab's storage").toBe(landing.metadata?.sessionId);
    expect(sessionStorage.getItem("funnel_initialized")).toBe("true");

    transport.chooseAnalytics("granted");
    await settle();
    expect(landings(), "a second yes sent the landing again").toHaveLength(1);
  });

  it("a later stage after the yes is the same funnel session as the landing it sent", async () => {
    const { transport, funnel } = await freshPage();
    funnel.initFunnelTracking();
    transport.chooseAnalytics("granted");
    await settle();
    funnel.trackFunnel("upload_started");
    await settle();
    const [landing] = landings();
    const upload = bodies().find((b) => b.variant === "upload_started");
    expect(upload?.metadata?.sessionId).toBe(landing.metadata?.sessionId);
    expect(upload?.metadata?.previousStages).toBe(1);
  });

  it("a no sends nothing, and a yes after it does not bring that landing back", async () => {
    const { transport, funnel } = await freshPage();
    funnel.initFunnelTracking();
    transport.chooseAnalytics("denied");
    await settle();
    expect(bodies()).toEqual([]);
    transport.chooseAnalytics("granted");
    await settle();
    expect(landings(), "a landing the visitor said no to was sent after a later yes").toEqual([]);
  });

  it("a visitor who already said yes is recorded at once, and a later yes sends no second landing", async () => {
    const { consent, transport, funnel } = await freshPage();
    consent.setAnalyticsConsent("granted");
    funnel.initFunnelTracking();
    await settle();
    expect(landings()).toHaveLength(1);
    transport.chooseAnalytics("granted");
    await settle();
    expect(landings()).toHaveLength(1);
  });
});
