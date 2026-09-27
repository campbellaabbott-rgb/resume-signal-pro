// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/pricing?utm_source=news&email=a%40b.c#top" }
/**
 * A PAGE FIELD IS A PATHNAME, NOT AN ADDRESS.
 *
 * WHAT THIS GUARDS. An event's `page` (and `landingPage`, `path`, `pathname`)
 * says where the visitor was. Where they were is a pathname. The query string
 * is what the link they followed carried — utm_* values, the ?outcome=&rid=
 * of an email button, whatever a campaign appended — and the hash is where
 * they scrolled. Recorded under `page`, either one splits a single page into
 * as many "pages" as there are links to it, and copies whatever the link
 * carried into a table that is read for analytics. A referrer is the page
 * they came FROM: its origin and path say that; its query does not.
 *
 * WHERE IT IS ENFORCED. At the one transport, not in each hook. A hook that
 * reads `window.location.pathname` is right today and one edit from
 * `.href`; the chokepoint cuts every page-naming field of every body it
 * sends, so the property holds for a caller that never heard of it. Which
 * is only true if every caller GOES through the chokepoint — so this file
 * also holds that no hook reaches the endpoint by a bare client invoke, and
 * names exactly the files outside the hooks that still do (a ratchet).
 *
 * The page runs at a production hostname carrying a query and a hash (the
 * environment option above) with DEV off, so the transport really serialises
 * and what is asserted is the JSON that leaves the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { getVisitorId, pathnameOnly, postTrackEvent, referrerOnly } from "../lib/track-transport";

const ROOT = resolve(__dirname, "../..");
const CHOKEPOINT = "src/lib/track-transport.ts";
const ENDPOINT = "track-ab-event";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { visitorId?: string; metadata?: Record<string, unknown>; [k: string]: unknown };

function hookFetch() {
  vi.stubEnv("DEV", false);
  const spy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  return spy;
}
const sent = (spy: ReturnType<typeof vi.fn>): Body[] =>
  spy.mock.calls
    .filter(([u]) => String(u).endsWith(`/functions/v1/${ENDPOINT}`))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body);

describe("the chokepoint cuts every page field to a pathname", () => {
  // sessionStorage too: the transport now sends a given (test, variant, type)
  // once per tab session, and these cases re-send the same identities.
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("the page runs where the transport serialises (the setup itself must work)", () => {
    expect(window.location.hostname).toBe("resumebooster.work");
    expect(window.location.search).toContain("utm_source=news");
    const spy = hookFetch();
    postTrackEvent({ testName: "t", variant: "v", eventType: "view" });
    expect(sent(spy)).toHaveLength(1);
  });

  it("page, landingPage, path and pathname leave as pathnames; the referrer keeps origin and path; nothing else is touched", () => {
    const spy = hookFetch();
    const metadata = {
      page: "/pricing?utm_source=news&email=a%40b.c#top",
      landingPage: "https://resumebooster.work/jobs?q=nurse&page=2#results",
      path: "/a?b=c",
      pathname: "/c#d",
      referrer: "https://www.google.com/search?q=resume+booster&hl=en#x",
      host: "chatgpt",
      utmSource: "news",
      sessionId: "session_1?keep=me",
      seconds: 30,
    };
    postTrackEvent({ testName: "conversion_funnel", variant: "landing_view", eventType: "view", metadata });
    const [body] = sent(spy);
    expect(body.metadata).toEqual({
      page: "/pricing",
      landingPage: "/jobs",
      path: "/a",
      pathname: "/c",
      referrer: "https://www.google.com/search",
      host: "chatgpt",
      utmSource: "news",
      sessionId: "session_1?keep=me",
      seconds: 30,
    });
    // Same keys in, same keys out: the reader's shape is the caller's shape.
    expect(Object.keys(body.metadata!).sort()).toEqual(Object.keys(metadata).sort());
  });

  it("a body without metadata, or with metadata that is not an object, is sent as given", () => {
    const spy = hookFetch();
    postTrackEvent({ testName: "nav", variant: "nav_agents", eventType: "view" });
    postTrackEvent({ testName: "x", variant: "y", eventType: "view", metadata: ["not", "an", "object"] });
    const [a, b] = sent(spy);
    expect("metadata" in a).toBe(false);
    expect(b.metadata).toEqual(["not", "an", "object"]);
  });

  it("the visitor on every body is this browser's one id, whatever the caller passed", () => {
    const spy = hookFetch();
    postTrackEvent({ testName: "t", variant: "v", eventType: "view", visitorId: "someone-else-entirely-0000000000" });
    postTrackEvent({ testName: "t", variant: "w", eventType: "view" });
    const [a, b] = sent(spy);
    expect(a.visitorId).toBe(getVisitorId());
    expect(a.visitorId).toMatch(UUID_RE);
    expect(b.visitorId).toBe(a.visitorId);
  });

  it("the cut itself: relative and absolute forms, and the values that must survive", () => {
    expect(pathnameOnly("/pricing?utm_source=x#top")).toBe("/pricing");
    expect(pathnameOnly("/jobs#results")).toBe("/jobs");
    expect(pathnameOnly("https://resumebooster.work/?a=1")).toBe("/");
    expect(pathnameOnly("https://resumebooster.work/agents/pass?x=1#y")).toBe("/agents/pass");
    expect(pathnameOnly("/x")).toBe("/x");
    expect(pathnameOnly("home")).toBe("home");
    expect(pathnameOnly("")).toBe("");
    expect(referrerOnly("https://www.google.com/search?q=a#b")).toBe("https://www.google.com/search");
    expect(referrerOnly("https://t.co/abc?s=1")).toBe("https://t.co/abc");
    expect(referrerOnly("direct")).toBe("direct");
    expect(referrerOnly("")).toBe("");
  });

  it("the batch queue's identity for a view is the test AND the variant", async () => {
    // The server's duplicate key once left the variant out and collapsed
    // every funnel stage into the landing; the client-side batch key had the
    // same hole. Two views of one test that differ in variant are two events.
    vi.useFakeTimers();
    const spy = hookFetch();
    const { queueABEvent } = await import("../hooks/use-shared-data");
    queueABEvent({ testName: "hero_layout", variant: "control", eventType: "view" });
    queueABEvent({ testName: "hero_layout", variant: "benefit_led", eventType: "view" });
    queueABEvent({ testName: "hero_layout", variant: "control", eventType: "view" });
    vi.advanceTimersByTime(200);
    const bodies = sent(spy);
    expect(bodies.map((b) => b.variant).sort()).toEqual(["benefit_led", "control"]);
    for (const b of bodies) expect(b.visitorId).toBe(getVisitorId());
  });
});

// ---------------------------------------------------------------------------
// Every caller goes through the chokepoint.
// ---------------------------------------------------------------------------

function appFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (relative(ROOT, p) === "src/test") continue;
        walk(p);
        continue;
      }
      const rel = relative(ROOT, p);
      if (!/\.(ts|tsx)$/.test(rel) || /\.(test|spec)\.(ts|tsx)$/.test(rel) || rel.endsWith(".d.ts")) continue;
      if (rel === CHOKEPOINT) continue;
      out.push(rel);
    }
  };
  walk(resolve(ROOT, "src"));
  return out.sort();
}
const code = (rel: string) => codeOf(readFileSync(resolve(ROOT, rel), "utf8"));

/**
 * THE RATCHET, burned down. Files outside the chokepoint whose CODE names the
 * endpoint — i.e. reach it by a bare client invoke, around the transport:
 * none. The three the first build left (the share card, the score hero, the
 * sign-in page) go through postTrackEvent now. A new one fails this at once.
 */
const STILL_INVOKING_DIRECTLY: string[] = [];

describe("every recorded event reaches the endpoint through the chokepoint", () => {
  const files = appFiles();

  it("no hook names the endpoint at all", () => {
    const hooks = files.filter((f) => f.startsWith("src/hooks/"));
    expect(hooks.length).toBeGreaterThanOrEqual(8);
    for (const f of hooks) expect(code(f).includes(ENDPOINT), `${f} reaches the endpoint around the transport`).toBe(false);
  });

  it("the files that still reach it directly are exactly the named ones (a ratchet)", () => {
    const direct = files.filter((f) => code(f).includes(ENDPOINT));
    expect(direct).toEqual([...STILL_INVOKING_DIRECTLY].sort());
  });

  it("the chokepoint is the one place the endpoint's path is built", () => {
    const src = code(CHOKEPOINT);
    expect(src).toContain(`/functions/v1/${ENDPOINT}`);
    for (const f of files) expect(code(f).includes(`/functions/v1/${ENDPOINT}`), f).toBe(false);
  });
});
