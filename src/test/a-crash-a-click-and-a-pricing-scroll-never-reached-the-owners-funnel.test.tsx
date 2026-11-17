/**
 * A CRASH, A CLICK AND A PRICING SCROLL NEVER REACHED THE OWNER'S FUNNEL
 * (S8-121, S8-122, S8-123).
 *
 * WHAT WAS WRONG.
 *   S8-121  Both error boundaries sent the crash message as the event's
 *           variant (up to 120 characters, or "section: message").
 *           track-ab-event refuses a variant over 30 characters with a 400
 *           the transport swallows: most crashes never arrived.
 *   S8-122  A CTA click went out as [test, variant, "conversion"], the key a
 *           purchase sends, so the purchase was dropped as a duplicate and
 *           every A/B readout measured clicks.
 *   S8-123  Scroll and time milestones kept the page only in metadata, which
 *           no dedup key reads: a visitor's 25% on / swallowed their 25% on
 *           /pricing.
 *
 * WHAT HOLDS NOW, with the real components and hooks mounted and only the
 * transport and the database client captured: a crash is no longer a funnel
 * event at all (NB-42): both boundaries write it, message included, to the
 * error log, so no variant has to fit; a click is a view under its own test
 * name, so its key is never a conversion's; the same milestone on two pages
 * is two keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

const posted: Array<Record<string, unknown>> = [];
const queued: Array<Record<string, unknown>> = [];
vi.mock("@/lib/track-transport", async (orig) => ({
  ...(await orig<typeof import("@/lib/track-transport")>()),
  postTrackEvent: (b: Record<string, unknown>) => { posted.push(b); },
  getVisitorId: () => "8b2f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
}));
vi.mock("@/hooks/use-shared-data", () => ({ queueABEvent: (e: Record<string, unknown>) => { queued.push(e); } }));
const rpc = vi.fn(async (..._a: unknown[]) => ({ data: true, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { eventKeyOf } from "@/lib/track-transport";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CardErrorBoundary } from "@/components/CardErrorBoundary";
import { useABTest } from "@/hooks/use-ab-test";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";
import { resetCrashReportsForTests } from "@/lib/client-crash-report";

const MESSAGE = "Cannot read properties of undefined (reading 'map')";
function Boom(): JSX.Element { throw new Error(MESSAGE); }

beforeEach(() => {
  posted.length = 0; queued.length = 0;
  rpc.mockClear(); resetCrashReportsForTests();
  sessionStorage.clear(); localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("S8-121, then NB-42: a crash arrives, message and all, and not as a funnel event", () => {
  const logged = () => rpc.mock.calls.filter(([fn]) => fn === "log_error_telemetry").map(([, a]) => a as Record<string, unknown>);

  it("the app boundary writes the message to the error log and sends the funnel nothing", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(posted.filter((p) => p.testName === "client_error"), "a crash went to the funnel").toEqual([]);
    expect(logged().map((a) => a.p_error_message), "no crash reached the error log").toEqual([MESSAGE]);
  });

  it("the card boundary writes the message and its section, and sends the funnel nothing", () => {
    render(<CardErrorBoundary section="salary_insight_card_for_the_report"><Boom /></CardErrorBoundary>);
    expect(posted.filter((p) => p.testName === "client_error")).toEqual([]);
    const [row] = logged();
    expect(row.p_error_message).toBe(MESSAGE);
    expect((row.p_context as Record<string, unknown>).place).toBe("salary_insight_card_for_the_report");
  });
});

describe("S8-122: a click is never the conversion a purchase sends", () => {
  it("the click's key differs from the purchase's for the same test and variant", () => {
    let click: ((m?: Record<string, unknown>) => void) | undefined;
    function Cta() {
      const t = useABTest("hero_layout") as unknown as { variant: string; trackClick: typeof click };
      click = t.trackClick;
      return null;
    }
    render(<Cta />);
    expect(typeof click, "the hook offers no click tracker").toBe("function");
    click!({ cta: "scan" });
    const view = queued.find((q) => q.testName === "hero_layout" && q.eventType === "view")!;
    const clickEvent = queued[queued.length - 1];
    expect(clickEvent.eventType, "a click was recorded as the conversion").not.toBe("conversion");
    const purchaseKey = eventKeyOf({ testName: "hero_layout", variant: view.variant, eventType: "conversion" });
    expect(eventKeyOf(clickEvent)).not.toBe(purchaseKey);
    expect(eventKeyOf(clickEvent)).not.toBe(eventKeyOf(view));
  });
});

describe("S8-123: the same milestone on two pages is two events", () => {
  it("home's 0% and pricing's 0% (scroll and time) have different keys, each within 30 characters", () => {
    function Page({ name }: { name: string }) { useScrollDepth(name); useTimeOnPage(name); useEffect(() => undefined, []); return null; }
    render(<Page name="home" />);
    cleanup();
    render(<Page name="pricing" />);
    for (const test of ["scroll_depth", "time_on_page"]) {
      const rows = posted.filter((p) => p.testName === test);
      const pages = new Set(rows.map((r) => (r.metadata as { page: string }).page));
      expect(pages, `${test} was not sent from both pages`).toEqual(new Set(["home", "pricing"]));
      const first = (page: string) => rows.find((r) => (r.metadata as { page: string }).page === page)!;
      expect(eventKeyOf(first("home")), `${test}: pricing's first milestone shares home's key and is dropped`).not.toBe(eventKeyOf(first("pricing")));
      for (const r of rows) expect(String(r.variant).length).toBeLessThanOrEqual(30);
    }
  });
});
