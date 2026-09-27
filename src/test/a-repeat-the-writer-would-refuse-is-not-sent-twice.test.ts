// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/jobs?q=nurse#results" }
/**
 * A REPEAT THE WRITER WOULD REFUSE IS NOT SENT TWICE.
 *
 * WHAT WAS WRONG. The two-tier budget charges the visitor's tier on the
 * ATTEMPT, before the writer's duplicate check runs. The board fires an
 * event on every section toggle, the A/B hook one per mount, the handoff
 * one per click; every one of those repeats would be answered "duplicate"
 * and inserted nowhere, and every one spent one of the visitor's hourly
 * budget. A heavy hour of that reached the budget on attempts that stored
 * nothing, and the real stages after it were refused (reviewed 2026-09-27).
 *
 * THE PROPERTY. A given (test, variant, type) leaves this browser once per
 * tab session -- and only once the server has said it kept the row or
 * already had it. A send the server rate-limited, failed to answer, or
 * refused leaves the event re-sendable, so nothing is lost to a bad hour.
 * The client's window is SHORTER than the writer's shortest dedup window,
 * read out of the writer's live definition, so nothing is suppressed here
 * that the writer would have stored. Bodies with no (test, variant, type)
 * identity are never suppressed. Storage that throws still suppresses for
 * the page's lifetime; a reload in the same tab still suppresses.
 *
 * Runs at a production address with DEV off and a fetch spy, so what is
 * asserted is the request that leaves the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveDefinitionOf } from "./helpers/live-sql";

type Transport = typeof import("../lib/track-transport");

async function freshTransport(): Promise<Transport> {
  vi.resetModules();
  return await import("../lib/track-transport");
}

type Answer = { status?: number; body?: unknown; reject?: boolean };

/** A fetch spy answering each call from a script; the last answer repeats. */
function hookFetch(...answers: Answer[]) {
  vi.stubEnv("DEV", false);
  let i = 0;
  const spy = vi.fn(async () => {
    const a = answers[Math.min(i++, answers.length - 1)] ?? {};
    if (a.reject) throw new TypeError("network down");
    return new Response(JSON.stringify(a.body ?? { success: true, status: "recorded" }), { status: a.status ?? 200 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const sentVariants = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { variant?: string }).variant);

const ev = (variant: string, eventType = "view", testName = "job_board") => ({ testName, variant, eventType, metadata: { title: variant } });

describe("a given (test, variant, type) leaves the browser once per tab session", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("the same identity posted forty times is one request; a second variant is a second", async () => {
    const t = await freshTransport();
    const spy = hookFetch();
    for (let i = 0; i < 40; i++) t.postTrackEvent(ev("jd_section_open"));
    t.postTrackEvent(ev("apply_click"));
    await settle();
    expect(sentVariants(spy)).toEqual(["jd_section_open", "apply_click"]);
    // And once acknowledged, still one.
    t.postTrackEvent(ev("jd_section_open"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("the identity is the test AND the variant AND the type: each differing field is a new event", async () => {
    const t = await freshTransport();
    const spy = hookFetch();
    t.postTrackEvent(ev("landing_view", "view", "conversion_funnel"));
    t.postTrackEvent(ev("landing_view", "conversion", "conversion_funnel"));
    t.postTrackEvent(ev("landing_view", "view", "another_test"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("a send the server rate-limited is re-sendable; one it recorded or already had is not", async () => {
    const t = await freshTransport();
    const spy = hookFetch(
      { body: { success: true, status: "rate_limited_visitor" } },
      { body: { success: true, status: "rate_limited_address" } },
      { body: { success: true, status: "duplicate" } },
    );
    t.postTrackEvent(ev("welcome_agent")); await settle();
    t.postTrackEvent(ev("welcome_agent")); await settle();
    t.postTrackEvent(ev("welcome_agent")); await settle();
    t.postTrackEvent(ev("welcome_agent")); await settle();
    expect(spy, "two refusals re-sent, the duplicate answer settled it").toHaveBeenCalledTimes(3);
  });

  it("a failed send -- a rejection, a 5xx, a 4xx -- is re-sendable", async () => {
    const t = await freshTransport();
    const spy = hookFetch({ reject: true }, { status: 500, body: { error: "x" } }, { status: 400, body: { error: "Invalid input format" } }, { body: { success: true, status: "recorded" } });
    for (let i = 0; i < 5; i++) { t.postTrackEvent(ev("compare_open")); await settle(); }
    expect(spy, "three failures re-sent, the fourth recorded, the fifth suppressed").toHaveBeenCalledTimes(4);
  });

  it("an answer without a status word (the pre-status contract) counts as recorded", async () => {
    const t = await freshTransport();
    const spy = hookFetch({ body: { success: true } });
    t.postTrackEvent(ev("agent_handoff_job")); await settle();
    t.postTrackEvent(ev("agent_handoff_job")); await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("two posts on the wire at once are one request, even before either is answered", async () => {
    const t = await freshTransport();
    let release: (() => void) | null = null;
    vi.stubEnv("DEV", false);
    const spy = vi.fn(() => new Promise<Response>((r) => { release = () => r(new Response('{"status":"recorded"}', { status: 200 })); }));
    vi.stubGlobal("fetch", spy);
    t.postTrackEvent(ev("employer_ctx_view"));
    t.postTrackEvent(ev("employer_ctx_view"));
    expect(spy).toHaveBeenCalledTimes(1);
    release!();
    await settle();
    t.postTrackEvent(ev("employer_ctx_view"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a reload in the same tab still suppresses (the sent map survives the module)", async () => {
    const a = await freshTransport();
    const spy = hookFetch();
    a.postTrackEvent(ev("welcome_posted_today")); await settle();
    const b = await freshTransport();
    b.postTrackEvent(ev("welcome_posted_today")); await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("with sessionStorage blocked, the page's memory suppresses for its lifetime", async () => {
    const t = await freshTransport();
    vi.stubGlobal("sessionStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    const spy = hookFetch();
    t.postTrackEvent(ev("welcome_stated_pay")); await settle();
    t.postTrackEvent(ev("welcome_stated_pay")); await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a body with no (test, variant, type) identity is never suppressed", async () => {
    const t = await freshTransport();
    const spy = hookFetch();
    expect(t.eventKeyOf({ testName: "x", variant: "y" })).toBeNull();
    t.postTrackEvent({ testName: "x", variant: "y" });
    t.postTrackEvent({ testName: "x", variant: "y" });
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("an acknowledged send older than the client window is re-sendable, and the window is under the writer's shortest dedup window", async () => {
    const t = await freshTransport();
    const key = t.eventKeyOf(ev("welcome_actively_hiring"))!;
    const now = Date.now();
    sessionStorage.setItem("rb_sent_events", JSON.stringify({ [key]: now - t.CLIENT_REPEAT_WINDOW_MS + 1000 }));
    expect(t.wasSentRecently(key, now)).toBe(true);
    expect(t.wasSentRecently(key, now + 1000)).toBe(false);
    // The writer's windows, from its live definition: the client's must be
    // shorter than the shortest, or the client would drop a row the writer
    // would have stored.
    const { body, file } = liveDefinitionOf("track_ab_event_optimized");
    const unit: Record<string, number> = { minute: 60_000, minutes: 60_000, hour: 3_600_000, hours: 3_600_000, day: 86_400_000, days: 86_400_000 };
    const thresholds = body.slice(body.indexOf("v_dedup_threshold :="));
    const windows = [...thresholds.matchAll(/NOW\(\)\s*-\s*INTERVAL\s*'(\d+)\s+(minutes?|hours?|days?)'/gi)].map((m) => Number(m[1]) * unit[m[2].toLowerCase()]);
    expect(windows.length, `${file}: no dedup windows found after the threshold assignment`).toBeGreaterThanOrEqual(2);
    expect(t.CLIENT_REPEAT_WINDOW_MS).toBeLessThan(Math.min(...windows));
    expect(t.CLIENT_REPEAT_WINDOW_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});
