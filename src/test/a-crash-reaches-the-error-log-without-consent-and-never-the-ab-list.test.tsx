/**
 * A CRASH REACHES THE ERROR LOG WITHOUT CONSENT, AND NEVER THE A/B LIST
 * (NB-42).
 *
 * WHAT WAS WRONG. Both error boundaries sent a crash as an A/B event (test
 * "client_error") through the analytics transport, which sends nothing until
 * a visitor allows analytics. Most visitors never answer the banner, so most
 * crashes were never reported; those that were landed in the owner's A/B
 * test list, which reads no message. Nothing listened for window errors or
 * unhandled promise rejections, so a crash in an event handler or in async
 * code was reported nowhere, and /errors saw none of it.
 *
 * WHAT HOLDS NOW, with the real boundaries mounted and only the database
 * client and the transport captured:
 *   - a crash in the app's, a page's or a card's boundary, an uncaught error
 *     and an unhandled rejection each write one error_telemetry row through
 *     log_error_telemetry (type "client", code CRASH_<where>), with the
 *     message, the route and the first stack frames, whatever the analytics
 *     choice: operational logging, with no visitor id;
 *   - no boundary sends a crash to the A/B list, with or without consent;
 *   - main.tsx listens for both window events before the app mounts;
 *   - a deploy (a chunk that cannot be fetched, a page reloading for the new
 *     build), a cross-origin "Script error.", an extension's error, the
 *     ResizeObserver notice and a request the network refused are not
 *     crashes and write nothing;
 *   - one crash is written once a page, at most five a page, and its text
 *     keeps no e-mail address and no query or fragment of an address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { codeOf } from "./helpers/strip-comments";

const rpc = vi.fn(async (..._a: unknown[]) => ({ data: true, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
const posted = vi.fn();
const VISITOR = "8b2f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
vi.mock("@/lib/track-transport", async (orig) => ({
  ...(await orig<typeof import("@/lib/track-transport")>()),
  postTrackEvent: (...a: unknown[]) => posted(...a),
  getVisitorId: () => VISITOR,
}));

import { ErrorBoundary, RouteErrorBoundary } from "@/components/ErrorBoundary";
import { CardErrorBoundary } from "@/components/CardErrorBoundary";
import { analyticsAllowed, resetConsentMemory, setAnalyticsConsent } from "@/lib/consent";
import { reloadForNewVersion, resetNewVersionReloadForTests } from "@/lib/new-version-reload";
import { installWindowCrashReporting, resetCrashReportsForTests } from "@/lib/client-crash-report";

const MESSAGE = "Cannot read properties of undefined (reading 'map')";
const Boom = ({ message = MESSAGE }: { message?: string }): JSX.Element => { throw new Error(message); };

type Row = { p_error_type: string; p_error_code: string; p_error_message: string; p_function_name: string; p_context: Record<string, unknown> };
const rows = (): Row[] => rpc.mock.calls.filter(([fn]) => fn === "log_error_telemetry").map(([, args]) => args as Row);
const crashEvents = () => posted.mock.calls.filter(([b]) => (b as { testName?: string }).testName === "client_error");

let uninstall: (() => void) | null = null;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetConsentMemory();
  resetCrashReportsForTests();
  resetNewVersionReloadForTests();
  rpc.mockClear();
  posted.mockClear();
  window.history.pushState({}, "", "/jobs/company/acme");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  uninstall?.();
  uninstall = null;
  cleanup();
  vi.restoreAllMocks();
  resetNewVersionReloadForTests();
  window.history.pushState({}, "", "/");
});

describe("a crash in a boundary reaches the error log, with no analytics choice made", () => {
  it("the app's boundary writes one row: the message, the route, the first frames, and no visitor id", () => {
    expect(analyticsAllowed(), "this test is about a visitor who never answered the banner").toBe(false);
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(rows(), "the crash was not written to the error log").toHaveLength(1);
    const r = rows()[0];
    expect(r.p_error_type).toBe("client");
    expect(r.p_error_code).toBe("CRASH_APP");
    expect(r.p_error_message).toBe(MESSAGE);
    expect(r.p_function_name).toBe("/jobs/company/acme");
    expect(r.p_context.route).toBe("/jobs/company/acme");
    expect(String(r.p_context.stack)).toContain(MESSAGE);
    expect(String(r.p_context.stack).split("\n").length).toBeLessThanOrEqual(6);
    expect(String(r.p_context.componentStack ?? "")).toMatch(/Boom|ErrorBoundary/);
    expect(JSON.stringify(r)).not.toMatch(/visitor/i);
    expect(JSON.stringify(r)).not.toContain(VISITOR);
  });

  it("a page's boundary and a card's say which they were, and the card its section", () => {
    render(<MemoryRouter><RouteErrorBoundary><Boom /></RouteErrorBoundary></MemoryRouter>);
    render(<CardErrorBoundary section="salary_insight_card"><Boom /></CardErrorBoundary>);
    expect(rows().map((r) => r.p_error_code)).toEqual(["CRASH_PAGE", "CRASH_CARD"]);
    expect(rows()[1].p_context.place).toBe("salary_insight_card");
  });

  it("no boundary sends a crash to the A/B list, with or without consent", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    setAnalyticsConsent("granted");
    render(<ErrorBoundary><Boom message="a second crash" /></ErrorBoundary>);
    render(<CardErrorBoundary section="ats_card"><Boom /></CardErrorBoundary>);
    expect(crashEvents(), "a crash went to the A/B list").toEqual([]);
    expect(rows()).toHaveLength(3);
  });
});

describe("a crash outside React reaches it too", () => {
  it("an uncaught error and an unhandled rejection each write a row", () => {
    uninstall = installWindowCrashReporting(window);
    window.dispatchEvent(new ErrorEvent("error", {
      error: new TypeError("handler is not a function"),
      message: "Uncaught TypeError: handler is not a function",
      filename: "https://resumebooster.work/assets/Jobs-Cq3x9a1F.js",
    }));
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: new Error("the save never answered") });
    window.dispatchEvent(rejection);
    expect(rows().map((r) => [r.p_error_code, r.p_error_message])).toEqual([
      ["CRASH_WINDOW", "handler is not a function"],
      ["CRASH_PROMISE", "the save never answered"],
    ]);
  });

  it("main.tsx listens before the app mounts", () => {
    const main = codeOf(readFileSync(resolve(__dirname, "../main.tsx"), "utf8"));
    const at = main.indexOf("installWindowCrashReporting(");
    expect(at, "main.tsx does not install the window listeners").toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf("createRoot("));
  });
});

describe("what is not a crash, and what is said once", () => {
  const fire = (error: unknown, extra: Partial<ErrorEventInit> = {}) =>
    window.dispatchEvent(new ErrorEvent("error", { error, message: String((error as Error)?.message ?? error ?? ""), ...extra }));
  const reject = (reason: unknown) => {
    const e = new Event("unhandledrejection");
    Object.defineProperty(e, "reason", { value: reason });
    window.dispatchEvent(e);
  };

  it("a deploy writes nothing: a chunk that cannot be fetched, or a page reloading for the new build", () => {
    uninstall = installWindowCrashReporting(window);
    render(<ErrorBoundary><Boom message="Importing a module script failed." /></ErrorBoundary>);
    reject(new TypeError("Failed to fetch dynamically imported module: https://resumebooster.work/assets/Jobs-Cq3x9a1F.js"));
    reloadForNewVersion(new Event("vite:preloadError", { cancelable: true }), () => undefined);
    render(<ErrorBoundary><Boom message="Cannot read properties of undefined (reading 'default')" /></ErrorBoundary>);
    expect(rows()).toEqual([]);
  });

  it("noise writes nothing: a cross-origin script, an extension, ResizeObserver, a refused request, an abort", () => {
    uninstall = installWindowCrashReporting(window);
    fire(null, { message: "Script error.", filename: "" });
    fire(new Error("ext broke"), { filename: "chrome-extension://abcdefghijklmnop/content.js" });
    fire(null, { message: "ResizeObserver loop completed with undelivered notifications." });
    reject(new TypeError("Failed to fetch"));
    reject(new TypeError("Load failed"));
    reject(Object.assign(new Error("The user aborted a request."), { name: "AbortError" }));
    expect(rows()).toEqual([]);
  });

  it("one crash is written once a page, two crashes twice, and never more than five a page", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(rows(), "the same crash again was written again").toHaveLength(1);
    render(<ErrorBoundary><Boom message="a different crash" /></ErrorBoundary>);
    expect(rows(), "a different crash was folded into the first").toHaveLength(2);
    for (let i = 0; i < 8; i++) render(<ErrorBoundary><Boom message={`crash number ${i}`} /></ErrorBoundary>);
    expect(rows()).toHaveLength(5);
  });

  it("the text keeps no e-mail address, and no query or fragment of an address", () => {
    render(<ErrorBoundary><Boom message="Rejected jane.doe@example.com at https://resumebooster.work/shortlist?k=s3cr3t#t=1 then" /></ErrorBoundary>);
    const r = rows()[0];
    const all = JSON.stringify(r);
    expect(all).not.toContain("jane.doe@example.com");
    expect(all).not.toContain("s3cr3t");
    expect(r.p_error_message).toBe("Rejected [email] at https://resumebooster.work/shortlist then");
  });
});
