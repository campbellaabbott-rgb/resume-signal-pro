/**
 * DISTINCT CRASHES FOR ONE VISITOR WERE FOLDED INTO THE FIRST (review of
 * wave3/email-ops, 2026-10-10, on S8-121).
 *
 * WHAT WAS WRONG. To fit track-ab-event's 30-character variant, every
 * whole-app crash was sent as variant "app" and every card crash as its
 * section. Both dedup layers key on [test, variant, type] per visitor: the
 * transport per tab session, the writer for 24 hours for a view. So after a
 * visitor's first crash, a different crash in the same session or day was
 * dropped as a duplicate.
 *
 * WHAT HOLDS NOW, with the real boundaries mounted and only the transport
 * captured: two different crashes have two dedup keys, a repeat of one crash
 * has the same key, and every variant fits in 30 characters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const posted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/track-transport", async (orig) => ({
  ...(await orig<typeof import("@/lib/track-transport")>()),
  postTrackEvent: (b: Record<string, unknown>) => { posted.push(b); },
  getVisitorId: () => "8b2f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
}));

import { eventKeyOf } from "@/lib/track-transport";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CardErrorBoundary } from "@/components/CardErrorBoundary";

const Boom = ({ message }: { message: string }): JSX.Element => { throw new Error(message); };
const A = "Cannot read properties of undefined (reading 'map')";
const B = "Minified React error #310; visit https://reactjs.org/docs/error-decoder.html";

beforeEach(() => {
  posted.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const crashes = () => posted.filter((p) => p.testName === "client_error");
function crash(node: JSX.Element) { render(node); cleanup(); }

describe("one visitor's crashes stay distinct", () => {
  it("the app boundary: two different crashes, two keys; the same crash again, the same key", () => {
    crash(<ErrorBoundary><Boom message={A} /></ErrorBoundary>);
    crash(<ErrorBoundary><Boom message={B} /></ErrorBoundary>);
    crash(<ErrorBoundary><Boom message={A} /></ErrorBoundary>);
    const [a, b, again] = crashes();
    expect(eventKeyOf(b), "a second, different crash shares the first one's key and is dropped").not.toBe(eventKeyOf(a));
    expect(eventKeyOf(again)).toBe(eventKeyOf(a));
    for (const e of crashes()) expect(String(e.variant).length).toBeLessThanOrEqual(30);
  });

  it("the card boundary: two different crashes in one section, two keys, each within 30 and naming the section", () => {
    const section = "salary_insight_card_for_the_report";
    crash(<CardErrorBoundary section={section}><Boom message={A} /></CardErrorBoundary>);
    crash(<CardErrorBoundary section={section}><Boom message={B} /></CardErrorBoundary>);
    const [a, b] = crashes();
    expect(eventKeyOf(b)).not.toBe(eventKeyOf(a));
    for (const e of [a, b]) {
      expect(String(e.variant).length).toBeLessThanOrEqual(30);
      expect(String(e.variant)).toMatch(/^salary_insight/);
    }
  });
});
