import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Suspense, lazy } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_MOUNT_ATTRIBUTE, mountBesidePrerendered, prerenderedNodes, routeHasCommitted } from "@/lib/keep-prerendered-page";
import { codeOf } from "./helpers/strip-comments";

/**
 * WHAT WAS WRONG (SEO-021): main.tsx handed #root, full of the bake's markup,
 * to createRoot. React empties its container on its first commit, and that
 * commit is the route boundary's fallback, which is nothing: every route is a
 * lazy chunk behind <Suspense fallback={null}>. Live, #root's text dropped to
 * zero after the prerendered paint on /, /jobs, a company page, a posting
 * page and /pricing, for 0.4-1.0 s on desktop and longer on a phone.
 *
 * What holds now (src/lib/keep-prerendered-page.ts): React mounts beside the
 * baked nodes, and they leave in the same task as the commit that brings the
 * page, so #root's text is never empty and never doubled. These tests render
 * a real React root shaped like App (chrome outside a fallback-null boundary
 * around a lazy route) and record #root's text after every DOM change. The
 * same harness run the old way, straight into #root, records an empty #root:
 * that control is what shows the check can fail.
 */

const BAKED = `<header class="baked"><a href="/">Resume Booster</a></header><main><h1>Open roles at Domino's</h1><p>1,200 open roles, read from Domino's own hiring system.</p></main><footer>Footer links</footer>`;

let root: Root | null = null;
let texts: string[] = [];
let recorder: MutationObserver | null = null;
let actEnv: unknown;

function bakedPage(marked = true) {
  document.head.innerHTML = marked ? `<meta name="x-prerendered" content="1" />` : "";
  document.body.innerHTML = `<div id="root">${BAKED}</div>`;
  return document.getElementById("root")!;
}

/**
 * Records #root's text after every batch of DOM changes. A browser paints only
 * between tasks, after every microtask has run, and MutationObserver callbacks
 * run in the order the observers were created, so an observer created after
 * the mount's sees each batch as the next frame would.
 */
function record(container: HTMLElement) {
  texts = [container.textContent ?? ""];
  recorder = new MutationObserver(() => texts.push(container.textContent ?? ""));
  recorder.observe(container, { childList: true, subtree: true, characterData: true });
}

/** An app shaped like App.tsx: chrome outside the route boundary, the route a lazy chunk. */
function appWithLazyRoute(delayMs: number) {
  const Route = lazy(
    () =>
      new Promise<{ default: () => JSX.Element }>((done) =>
        setTimeout(
          () => done({ default: () => <><header role="banner">Site header</header><main><h1>Open roles at Domino&apos;s</h1><p>Live list</p></main></> }),
          delayMs,
        ),
      ),
  );
  return (
    <>
      <section aria-label="Notifications" />
      <Suspense fallback={null}>
        <Route />
      </Suspense>
      <div style={{ position: "fixed" }} data-floating-help="">
        <button aria-label="Get help" />
      </div>
    </>
  );
}

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

beforeEach(() => {
  actEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  // A browser, not act(): commits happen when React schedules them.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(() => {
  recorder?.disconnect();
  root?.unmount();
  root = null;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = actEnv;
});

describe("a prerendered page while React loads its route", () => {
  it("#root's text is never empty and never doubled, and ends as React's page alone", async () => {
    const container = bakedPage();
    const mount = mountBesidePrerendered(document, container);
    // Created after the mount's own observer, so each record is the DOM at the
    // end of a microtask checkpoint: the only moments a browser can paint.
    record(container);
    root = createRoot(mount);
    root.render(appWithLazyRoute(40));
    await settle(10);
    expect(container.textContent, "the baked page is still on screen while the route loads").toContain("1,200 open roles");
    await settle(700);
    expect(texts.length, "the recorder saw React's commits").toBeGreaterThan(2);
    expect(texts.filter((t) => t.trim() === ""), "a frame with an empty #root").toEqual([]);
    for (const t of texts) expect((t.match(/Open roles at Domino/g) ?? []).length, `doubled: ${t}`).toBe(1);
    expect(container.textContent).toContain("Live list");
    expect(container.textContent).not.toContain("1,200 open roles");
    expect(container.querySelector("header.baked")).toBeNull();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("CONTROL: the same app mounted straight into #root (the code before the fix) empties #root", async () => {
    const container = bakedPage();
    record(container);
    root = createRoot(container);
    root.render(appWithLazyRoute(40));
    await settle(700);
    expect(container.textContent).toContain("Live list");
    expect(texts.some((t) => t.trim() === ""), "the old mount blanked #root, which is what the first test rules out").toBe(true);
  });

  it("React's first commit, the chrome outside the route boundary, leaves the baked page in place", async () => {
    const container = bakedPage();
    const mount = mountBesidePrerendered(document, container);
    root = createRoot(mount);
    root.render(appWithLazyRoute(10_000));
    await settle(40);
    expect(mount.querySelector("[data-floating-help]"), "the chrome committed").not.toBeNull();
    expect(container.textContent).toContain("1,200 open roles");
    expect(container.firstElementChild).toBe(mount);
  });

  it("the mount is first in #root, attributed, and adds no box of its own", () => {
    const container = bakedPage();
    const mount = mountBesidePrerendered(document, container);
    expect(mount).not.toBe(container);
    expect(container.firstChild).toBe(mount);
    expect(mount.hasAttribute(APP_MOUNT_ATTRIBUTE)).toBe(true);
    expect(mount.style.display).toBe("contents");
  });
});

describe("a page the bake did not write", () => {
  it("an empty #root mounts as before", () => {
    document.head.innerHTML = `<meta name="x-prerendered" content="1" />`;
    document.body.innerHTML = `<div id="root"></div>`;
    const container = document.getElementById("root")!;
    expect(mountBesidePrerendered(document, container)).toBe(container);
  });

  it("markup without the bake's marker is not treated as prerendered", () => {
    const container = bakedPage(false);
    expect(prerenderedNodes(document, container)).toEqual([]);
    expect(mountBesidePrerendered(document, container)).toBe(container);
  });

  it("the readiness test wants the page itself, not the chrome", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    div.innerHTML = `<section aria-label="Notifications"></section><div style="position:fixed"><button aria-label="Get help"></button></div>`;
    expect(routeHasCommitted(div)).toBe(false);
    div.insertAdjacentHTML("beforeend", "<main><p>x</p></main>");
    expect(routeHasCommitted(div)).toBe(true);
  });

  it("a route whose first commit is a spinner (no main, no heading) counts once it takes up room in the flow, the chrome never does", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    div.innerHTML = `<section aria-label="Notifications"></section><div style="position:fixed" data-tall=""><button aria-label="Get help"></button></div>`;
    // jsdom lays nothing out: give the elements marked tall a height, as a browser would.
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return { ...rect.call(this), height: this.hasAttribute("data-tall") ? 600 : 0 } as DOMRect;
    };
    try {
      expect(routeHasCommitted(div), "a fixed element is chrome however tall it is").toBe(false);
      div.insertAdjacentHTML("afterbegin", `<div class="min-h-screen" data-tall=""><div class="animate-spin"></div></div>`);
      expect(routeHasCommitted(div)).toBe(true);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
    }
  });
});

describe("main.tsx", () => {
  const main = codeOf(readFileSync(resolve(__dirname, "../main.tsx"), "utf8"));

  it("mounts React through mountBesidePrerendered, after the baked lander name is read", () => {
    const mountAt = main.search(/createRoot\(\s*mountBesidePrerendered\(\s*document\s*,\s*document\.getElementById\("root"\)!?\s*\)\s*\)/);
    expect(mountAt, "createRoot(mountBesidePrerendered(document, #root))").toBeGreaterThan(-1);
    const nameAt = main.search(/captureBakedLanderName\(\s*document/);
    expect(nameAt).toBeGreaterThan(-1);
    expect(nameAt).toBeLessThan(mountAt);
    expect(main.match(/createRoot\(/g), "one root").toHaveLength(1);
  });
});
