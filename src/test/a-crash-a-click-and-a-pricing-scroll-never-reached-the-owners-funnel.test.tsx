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
 * transport captured: a crash's variant fits in 30 characters and its message
 * rides in metadata; a click is a view under its own test name, so its key is
 * never a conversion's; the same milestone on two pages is two keys.
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

import { eventKeyOf } from "@/lib/track-transport";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CardErrorBoundary } from "@/components/CardErrorBoundary";
import { useABTest } from "@/hooks/use-ab-test";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";

const MESSAGE = "Cannot read properties of undefined (reading 'map')";
function Boom(): JSX.Element { throw new Error(MESSAGE); }

beforeEach(() => {
  posted.length = 0; queued.length = 0;
  sessionStorage.clear(); localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("S8-121: a crash fits the variant the server accepts", () => {
  it("the app boundary sends a short stable variant and the message in metadata", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    const e = posted.find((p) => p.testName === "client_error")!;
    expect(e, "no crash event was sent").toBeTruthy();
    expect(String(e.variant).length, `variant "${String(e.variant)}" is over track-ab-event's 30`).toBeLessThanOrEqual(30);
    expect((e.metadata as Record<string, unknown>).message).toBe(MESSAGE);
  });

  it("the card boundary sends the section, within 30, and the message in metadata", () => {
    render(<CardErrorBoundary section="salary_insight_card_for_the_report"><Boom /></CardErrorBoundary>);
    const e = posted.find((p) => p.testName === "client_error")!;
    expect(String(e.variant).length).toBeLessThanOrEqual(30);
    expect(String(e.variant)).toMatch(/^salary_insight/);
    expect((e.metadata as Record<string, unknown>).message).toBe(MESSAGE);
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
