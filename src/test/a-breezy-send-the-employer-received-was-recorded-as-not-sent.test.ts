// @vitest-environment node
/**
 * Sweep S11-011. Breezy submits from an ng-click handler: an XHR, no
 * navigation. After the click the worker waited for networkidle, which had
 * fired long before on that page, so it returned at once; confirmed() then
 * found the form still on screen and the outcome was "not-submitted: submit
 * did not take". That reason is not transient, so the packet was released as
 * blocked, the pass refunded, and the cooldown never saw a send the employer
 * had received. A manual or repeat apply then put a second application on the
 * employer's desk.
 *
 * Driven through the real applyToPosting with a stand-in adapter and page:
 * the click starts a write request that the "server" answers after a delay,
 * and the form disappears only once it has. worker/src/harness.ts runs the
 * same shapes in a real browser (the xhr-* modes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mode = "thank" | "stay" | "nothing" | "navigation";
const state = vi.hoisted(() => ({
  mode: "thank" as "thank" | "stay" | "nothing" | "navigation",
  delayMs: 0,
  answered: false,
  run: 0,
  listeners: [] as Array<(r: unknown) => void>,
}));

vi.mock("../../worker/src/vendors/index.ts", () => {
  const box = { isVisible: async () => true, fill: async () => {}, setFile: async () => {} };
  const adapter = {
    key: "breezy",
    resolveFormUrl: async (_p: unknown, u: string) => u,
    locate: async (_p: unknown, key: string) => (key === "fullName" || key === "email" ? box : null),
    locateResume: async () => null,
    canProceed: async () => "would-submit" as const,
    async proceed() {
      // What the browser reports for the click: one POST, answered later.
      if (state.mode !== "nothing") {
        const run = state.run;
        const response = new Promise<{ status: () => number }>((resolve) =>
          setTimeout(() => { if (state.run === run) state.answered = true; resolve({ status: () => 200 }); }, state.delayMs));
        const req = {
          method: () => "POST",
          isNavigationRequest: () => state.mode === "navigation",
          response: () => response,
        };
        for (const l of state.listeners) l(req);
      }
      return "submitted" as const;
    },
    unansweredRequired: async () => null,
    // Breezy's own reading: the form still visible is "no"; gone with a
    // thank-you on the page is "yes".
    confirmed: async () => (state.mode === "thank" && state.answered ? "yes" as const : "no" as const),
    requiredAttributeIsTrustworthy: false,
    mappedNames: new Set<string>(["cName", "cEmail"]),
    fieldKeys: new Set(["fullName", "email"]),
    enumerateQuestions: async () => [],
  };
  return { adapterFor: (s: string) => (s === "breezy" ? adapter : null), BLOCKED: {}, ADAPTERS: { breezy: adapter } };
});

import { applyToPosting } from "../../worker/src/apply.ts";
import { identityFields } from "../../worker/src/packet-fields.ts";

function fakeBrowser() {
  const locator = () => ({ evaluateAll: async () => 0 });
  const page = {
    on: (event: string, fn: (r: unknown) => void) => { if (event === "request") state.listeners.push(fn); },
    // The page's own clock: a wait moves it, so the twenty-second budget is
    // spent in a few milliseconds of real time.
    waitForTimeout: async (ms: number) => { vi.setSystemTime(Date.now() + ms); await new Promise((r) => setTimeout(r, 1)); },
    // networkidle fired before the click and the document never changed.
    waitForLoadState: async () => {},
    textContent: async () => "Apply for this role", content: async () => "<form></form>",
    evaluate: async () => false, locator, url: () => "https://acme.breezy.hr/p/1/apply",
    screenshot: async () => Buffer.from(""),
  };
  const ctx = { newPage: async () => page, close: async () => {} };
  return { newContext: async () => ctx } as unknown as Parameters<typeof applyToPosting>[0];
}

async function send(mode: Mode, delayMs = 0) {
  state.mode = mode;
  state.delayMs = delayMs;
  state.answered = false;
  state.run++;
  state.listeners = [];
  return applyToPosting(fakeBrowser(), {
    applyUrl: "https://acme.breezy.hr/p/1",
    source: "breezy",
    fields: identityFields({ fullName: "Ana Diaz", email: "ana@example.com" }),
  });
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("an XHR submit is read after the employer's server answers it", () => {
  it.each([0, 30, 150])("answered in %i ms and the form replaced: recorded as sent", async (delay) => {
    const out = await send("thank", delay);
    expect(out.kind).toBe("submitted");
  });

  it("the request went and the form stayed up: uncertain, never 'not sent'", async () => {
    const out = await send("stay", 30);
    expect(out.kind).toBe("uncertain");
    expect((out as { reason: string }).reason).toMatch(/form is still showing/);
  });
});

describe("the evidence that a submit did not take is unchanged", () => {
  it("a click that sent nothing, with the form still up, is not-submitted", async () => {
    const out = await send("nothing");
    expect(out).toMatchObject({ kind: "not-submitted", reason: expect.stringMatching(/did not take/) });
  });

  it("a posted page that came back as the form is not-submitted", async () => {
    const out = await send("navigation", 10);
    expect(out).toMatchObject({ kind: "not-submitted", reason: expect.stringMatching(/did not take/) });
  });
});
