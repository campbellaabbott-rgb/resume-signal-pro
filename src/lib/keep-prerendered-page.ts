/**
 * THE PRERENDERED PAGE STAYS ON SCREEN UNTIL REACT HAS THE PAGE (SEO-021).
 *
 * The bake writes each public page's markup into #root. main.tsx used to hand
 * #root to createRoot, and React empties its container on its first commit.
 * That first commit is NOT the page: every route is a lazy chunk behind
 * <Suspense fallback={null}>, so React first commits the fallback, which is
 * nothing, and the page arrives with the route's chunk. Measured live
 * (Playwright, 2026-10-12 and 10-18): #root's text dropped to zero after the
 * prerendered paint on every page tested, for about 0.4-1.0 s (1.1-2.3 s on a
 * throttled phone), and desktop LCP moved to the re-render.
 *
 * WHY NOT hydrateRoot. Hydration adopts markup only when it is exactly what
 * React would render. The bake writes its own HTML (scripts/prerender-seo.mjs,
 * not a React server render), so every page would mismatch, React would throw
 * the markup away and client-render, and the page would blank all the same,
 * with a hydration error logged on every load.
 *
 * WHAT HAPPENS INSTEAD. React mounts into a new, layout-neutral node
 * (display: contents) placed first inside #root, and the baked nodes stay
 * where they are. Before the route arrives React's tree holds only what sits
 * outside the route boundary (the toaster region, the fixed help button), none
 * of it in the flow, so the baked page neither moves nor is covered. When a
 * commit puts the page itself into the mount (see routeHasCommitted), the
 * observer removes the baked nodes. A
 * MutationObserver callback runs as a microtask straight after React's DOM
 * writes, before the browser can paint, so no frame ever shows both pages,
 * and none shows neither: #root's text goes from the baked page to React's.
 *
 * No data is carried over: the baked rows can be days old, so React never
 * receives them, it only stops the screen going blank while it loads.
 *
 * A page that was not prerendered (dev, a route the bake did not write, or
 * the fallback file, whose inline script empties #root on any other address)
 * mounts into #root exactly as before.
 */

export const APP_MOUNT_ATTRIBUTE = "data-app-mount";

/**
 * True once React's tree holds a page: a route's first real commit, or the
 * error boundary's screen. That is a <main>, <h1> or <header> anywhere in it,
 * or any element of its own in the flow with a height: a page whose first
 * commit is a loading spinner (the affiliate dashboard's) counts, so React's
 * page never sits above a baked one. The chrome outside the route boundary
 * never counts: the toaster region has no height and the help button and the
 * sign-in banners are fixed.
 */
export function routeHasCommitted(mount: Element): boolean {
  if (mount.querySelector("main, h1, header")) return true;
  const view = mount.ownerDocument?.defaultView;
  for (const child of Array.from(mount.children)) {
    const position = view ? view.getComputedStyle(child).position : "";
    if (position === "fixed" || position === "absolute") continue;
    if (child.getBoundingClientRect().height > 0) return true;
  }
  return false;
}

/** The prerendered nodes in `container`: none unless the bake marked the page and wrote markup into it. */
export function prerenderedNodes(doc: Document, container: Element): ChildNode[] {
  if (!doc.querySelector('meta[name="x-prerendered"]')) return [];
  const nodes = Array.from(container.childNodes);
  return nodes.some((n) => n.nodeType === 1) ? nodes : [];
}

/**
 * The element React should mount into. On a prerendered page, a new node
 * placed first inside `container`; the baked nodes are removed in the same
 * task as the commit that brings the page (see above). Elsewhere, `container`.
 */
export function mountBesidePrerendered(
  doc: Document,
  container: HTMLElement,
  isReady: (mount: HTMLElement) => boolean = routeHasCommitted,
): HTMLElement {
  const baked = prerenderedNodes(doc, container);
  if (baked.length === 0) return container;
  const mount = doc.createElement("div");
  mount.setAttribute(APP_MOUNT_ATTRIBUTE, "");
  mount.style.display = "contents";
  container.insertBefore(mount, container.firstChild);
  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer(() => {
    if (!isReady(mount)) return;
    observer.disconnect();
    for (const node of baked) if (node.parentNode === container) container.removeChild(node);
  });
  observer.observe(mount, { childList: true, subtree: true });
  return mount;
}
