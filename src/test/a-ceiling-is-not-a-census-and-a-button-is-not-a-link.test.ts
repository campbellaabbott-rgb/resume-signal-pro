import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THREE THINGS THE BOARD SAID THAT WERE NOT TRUE, MEASURED 2026-08-25.
 *
 *  1. A CAP RENDERED AS A COUNT. The feed-health line printed
 *     `data.failedSources.length` as "{{count}} company feeds are unreachable
 *     right now". failedSources is `.slice(-120)` of the refresh loop's failure
 *     log — a display cap. It read exactly 120 on every poll for 45 minutes
 *     (saturated ceiling), then 112 once a pass landed (a real number), and
 *     nothing in the sentence distinguished the two. The loop already publishes
 *     the uncapped total as `failedCount`: probed live the same minute, the
 *     `status` action returned failedCount 23 while a `list` response carried a
 *     112-entry failedSources sample. No list exit sends failedCount yet, so the
 *     page must be able to fall back to the floor it can defend — "at least N".
 *
 *  2. THE SKIP LINK WAS DEAD ON ARRIVAL. index.html ships
 *     `<a href="#main-content">` as the first focusable element of every page.
 *     Curling the served /jobs HTML: "main-content" occurs exactly ONCE — in
 *     the link's own href — and the prerendered shell emits a bare
 *     `<main class="pt-10 pb-20">`. The id comes from React, so for the whole
 *     1.0-2.7s hydration window the first key a keyboard user presses on the
 *     SEO landing surface does nothing. The existing guard asserts the id from
 *     Jobs.tsx SOURCE, which is exactly why it passed while the served page was
 *     broken. The press still writes the fragment to the URL, so the intent
 *     survives the window and can be honoured on mount.
 *
 *  3. NO CRAWLABLE PATH TO ANY JOB. On the hydrated board, all 60
 *     `a[href^="/jobs/"]` pointed at /jobs/company/<token> and ZERO at a
 *     posting: each job title was a `<button title="...">` with no href, while
 *     ~70k postings sit in the sitemap as /jobs?job=<id>. Before: 0 job-detail
 *     anchors per page. After: one per card, 60 on a full page, at the same URL
 *     the canonical link and the JobPosting JSON-LD publish — and still one tab
 *     stop per card (the anchor REPLACES the button; the page stays at 480 focus
 *     stops, not 540).
 */
import {
  unreachableFeeds,
  jobDetailHref,
  opensInNewContext,
  honourPendingSkipLink,
} from "../pages/Jobs";

const root = resolve(__dirname, "../..");
// Comments are not code. A guard's own literal written into a nearby comment
// has silently passed a dead check in this repo before, so every source
// assertion below reads the stripped text.
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const JOBS = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");
const JOBS_CODE = strip(JOBS);
const APP_CODE = strip(readFileSync(resolve(root, "src/App.tsx"), "utf8"));

describe("a ceiling is not a census", () => {
  it("the uncapped total wins whenever the server sends one", () => {
    expect(unreachableFeeds(2317, 120)).toEqual({ count: 2317, exact: true });
    // The pathological pair that started this: a saturated sample beside the
    // truth. The sample must not be what gets printed.
    expect(unreachableFeeds(23, 112)?.count).toBe(23);
  });

  it("a capped sample is reported as a floor, never as a total", () => {
    // Today every list exit omits failedCount, so this is the live path.
    const saturated = unreachableFeeds(undefined, 120);
    expect(saturated).toEqual({ count: 120, exact: false });
    // Below the cap it is still only a sample as far as the client can prove —
    // 112 was a true count on one pass and a coincidence on the next.
    expect(unreachableFeeds(undefined, 112)?.exact).toBe(false);
  });

  it("nothing failing renders nothing at all", () => {
    expect(unreachableFeeds(undefined, 0)).toBeNull();
    // An explicit uncapped zero outranks a stale sample: the accumulator keeps
    // the last 120 entries across passes, so a healthy board can still carry a
    // non-empty list.
    expect(unreachableFeeds(0, 112)).toBeNull();
  });

  it("a nonsense total falls back to the sample instead of printing NaN", () => {
    expect(unreachableFeeds(Number.NaN, 5)).toEqual({ count: 5, exact: false });
    expect(unreachableFeeds(-1, 5)).toEqual({ count: 5, exact: false });
  });

  it("both renders exist and the hedged one says so in its own words", () => {
    expect(JOBS_CODE).toMatch(/unreachableFeeds\(data\.failedCount, data\.failedSources\?\.length \?\? 0\)/);
    expect(JOBS_CODE).toMatch(/jobsPage\.sourcesDownAtLeast/);
    expect(JOBS_CODE).toMatch(/at least \{\{count\}\} company feeds are unreachable right now/);
    // The bare-count sentence must be reachable ONLY through the exact branch.
    const line = JOBS_CODE.slice(JOBS_CODE.indexOf("unreachableFeeds(data.failedCount"));
    expect(line.slice(0, 900)).toMatch(/feeds\.exact/);
  });
});

describe("the skip link must land somewhere, even after the window closed", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  const mount = () => {
    document.body.innerHTML = '<main id="main-content" tabindex="-1">board</main>';
    return document.getElementById("main-content")!;
  };

  it("a press that landed during hydration is honoured when the target appears", () => {
    const main = mount();
    expect(honourPendingSkipLink("#main-content")).toBe(true);
    expect(document.activeElement).toBe(main);
  });

  it("it does nothing when the fragment is not the skip target", () => {
    mount();
    const before = document.activeElement;
    expect(honourPendingSkipLink("")).toBe(false);
    expect(honourPendingSkipLink("#job-42")).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it("it reports failure instead of throwing when the target is missing", () => {
    document.body.innerHTML = "<main>no id yet — this is the served HTML</main>";
    expect(honourPendingSkipLink("#main-content")).toBe(false);
  });

  it("the page still renders the target it focuses, and runs the recovery on mount", () => {
    expect(JOBS_CODE).toMatch(/<main id="main-content" tabIndex=\{-1\}/);
    expect(JOBS_CODE).toMatch(/honourPendingSkipLink\(window\.location\.hash\)/);
  });
});

describe("every job on the board has an address", () => {
  it("the detail href is the URL the sitemap and the canonical link publish", () => {
    expect(jobDetailHref("greenhouse:acme:12345")).toBe("/jobs?job=greenhouse%3Aacme%3A12345");
  });

  it("the id survives the round trip, colons, tildes and all", () => {
    const id = "workday:humana~wd5~CenterWell_External_Career_Site:R-428050";
    const u = new URL(jobDetailHref(id), "https://resumebooster.work");
    expect(u.pathname).toBe("/jobs");
    expect(u.searchParams.get("job")).toBe(id);
  });

  it("that URL is a route the app actually serves, and /jobs/:id is not", () => {
    // The detail view is a query param on /jobs, not a path segment. Inventing
    // /jobs/<id> would render NotFound and orphan every anchor on the page.
    expect(APP_CODE).toMatch(/path="\/jobs" element=\{<Jobs \/>\}/);
    expect(APP_CODE).not.toMatch(/path="\/jobs\/:/);
    // ...and the page reads the param back off the URL.
    expect(JOBS_CODE).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\("job"\)/);
  });

  it("the card title is an anchor to that href, not a bare button", () => {
    const card = JOBS_CODE.slice(JOBS_CODE.indexOf("data-job-id={job.id}"));
    expect(card).toMatch(/<Link\s+to=\{jobDetailHref\(job\.id\)\}/);
    // The old control must be gone, or the card grows a second tab stop and the
    // page goes back to 540 focus stops.
    expect(card).not.toMatch(/<button\s+type="button"\s+onClick=\{\(e\) => \{ e\.stopPropagation\(\); void openDetail\(job\); \}\}/);
  });

  it("a plain left click still opens the panel; a modified one belongs to the browser", () => {
    // Only these two facts matter: the interaction did not change for the
    // mouse, and cmd/ctrl/shift/middle-click are not swallowed.
    expect(opensInNewContext({})).toBe(false);
    expect(opensInNewContext({ button: 0 })).toBe(false);
    expect(opensInNewContext({ metaKey: true })).toBe(true);
    expect(opensInNewContext({ ctrlKey: true })).toBe(true);
    expect(opensInNewContext({ shiftKey: true })).toBe(true);
    expect(opensInNewContext({ altKey: true })).toBe(true);
    expect(opensInNewContext({ button: 1 })).toBe(true);
  });

  it("the handler defers to the browser BEFORE it preventDefaults", () => {
    // Order is the whole fix: a preventDefault above the guard turns the anchor
    // back into a counterfeit link that cannot be opened in a new tab.
    const card = JOBS_CODE.slice(JOBS_CODE.indexOf("to={jobDetailHref(job.id)}"));
    const handler = card.slice(0, card.indexOf("title={job.title}"));
    expect(handler.indexOf("opensInNewContext(e)")).toBeGreaterThan(-1);
    expect(handler.indexOf("opensInNewContext(e)")).toBeLessThan(handler.indexOf("e.preventDefault()"));
    expect(handler).toMatch(/void openDetail\(job\)/);
  });
});
