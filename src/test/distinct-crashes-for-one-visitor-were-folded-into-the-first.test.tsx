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
 * Since NB-42 a crash is written to the error log (src/lib/client-crash-
 * report.ts), not the funnel, and is said once a page. WHAT HOLDS NOW, with
 * the real boundaries mounted and only the database client captured: two
 * different crashes are two rows, a repeat of one crash in the same page is
 * not written again, and a card's crash keeps its section.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const rpc = vi.fn(async (..._a: unknown[]) => ({ data: true, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CardErrorBoundary } from "@/components/CardErrorBoundary";
import { resetCrashReportsForTests } from "@/lib/client-crash-report";

const Boom = ({ message }: { message: string }): JSX.Element => { throw new Error(message); };
const A = "Cannot read properties of undefined (reading 'map')";
const B = "Minified React error #310; visit https://reactjs.org/docs/error-decoder.html";

beforeEach(() => {
  rpc.mockClear();
  resetCrashReportsForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const crashes = () => rpc.mock.calls.filter(([fn]) => fn === "log_error_telemetry").map(([, a]) => a as { p_error_message: string; p_context: { place?: string } });
function crash(node: JSX.Element) { render(node); cleanup(); }

describe("one visitor's crashes stay distinct", () => {
  it("the app boundary: two different crashes, two rows; the same crash again, no new row", () => {
    crash(<ErrorBoundary><Boom message={A} /></ErrorBoundary>);
    crash(<ErrorBoundary><Boom message={B} /></ErrorBoundary>);
    crash(<ErrorBoundary><Boom message={A} /></ErrorBoundary>);
    expect(crashes().map((c) => c.p_error_message), "a second, different crash was folded into the first").toEqual([A, B]);
  });

  it("the card boundary: two different crashes in one section, two rows, each naming the section", () => {
    const section = "salary_insight_card_for_the_report";
    crash(<CardErrorBoundary section={section}><Boom message={A} /></CardErrorBoundary>);
    crash(<CardErrorBoundary section={section}><Boom message={B} /></CardErrorBoundary>);
    const [a, b] = crashes();
    expect([a?.p_error_message, b?.p_error_message]).toEqual([A, B]);
    for (const c of [a, b]) expect(c.p_context.place).toBe(section);
  });
});
