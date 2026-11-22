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
 * A ROUTE THAT IS STILL WAITING FOR ITS PAGE (PERFORMANCE-5). The posting
 * page's first commit was its header, its breadcrumb and a spinner while its
 * one detail read was in flight, and that commit took the baked posting off
 * the screen: the text went from 7,871 characters to 669 and back for 0.6 to
 * 1.6 s, and a slow or refused read left the reader less than the file they
 * were sent. A route that renders this attribute on an element of its tree
 * (the posting page puts it on a hidden <main>) has not committed its page,
 * whatever else it drew, and the baked page stays until the attribute goes.
 */
export const ROUTE_PENDING_ATTRIBUTE = "data-route-pending";

/**
 * True once React's tree holds a page: a route's first real commit, or the
 * error boundary's screen. That is a <main>, <h1> or <header> anywhere in it,
 * or any element of its own in the flow with a height: a page whose first
 * commit is a loading spinner (the affiliate dashboard's) counts, so React's
 * page never sits above a baked one. The chrome outside the route boundary
 * never counts: the toaster region has no height and the help button and the
 * sign-in banners are fixed. A tree holding the pending mark is not a page
 * yet, and that is asked first: a pending route may also hold a header.
 */
export function routeHasCommitted(mount: Element): boolean {
  if (mount.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`)) return false;
  if (mount.querySelector("main, h1, header")) return true;
  const view = mount.ownerDocument?.defaultView;
  for (const child of Array.from(mount.children)) {
    const position = view ? view.getComputedStyle(child).position : "";
    if (position === "fixed" || position === "absolute") continue;
    if (child.getBoundingClientRect().height > 0) return true;
  }
  return false;
}

/**
 * True while a baked page is on screen beside React's mount: the route that
 * draws over it may hold it there (ROUTE_PENDING_ATTRIBUTE). False on a page
 * the bake did not write, and after a client-side navigation, where nothing
 * baked is left to keep and a route shows its own loading state.
 */
export function prerenderedPageShowing(doc: Document = document): boolean {
  const mount = doc.querySelector(`[${APP_MOUNT_ATTRIBUTE}]`);
  const parent = mount?.parentNode;
  if (!mount || !parent) return false;
  return Array.from(parent.childNodes).some((n) => n !== mount && n.nodeType === 1);
}

/**
 * WHAT WAS TYPED INTO THE BAKED PAGE (PERFORMANCE-M1). The homepage's baked
 * search form works before the app has loaded, and anything typed into it
 * between the first paint (about 2 s on a phone) and React's commit (about
 * 4.8 s) went with the baked nodes, with its focus. A field is read while the
 * baked page is still on screen, or from the record taken in the same task
 * that removes it (a route may draw its form later, after its strings land),
 * until the route that seeds from it claims it.
 */
export interface BakedField {
  value: string;
  /** The baked field had the focus. */
  focused: boolean;
  /** The caret or selection in it, where the field type keeps one. */
  selection: [number, number] | null;
  /** Read from the baked node itself, which is still on screen. */
  live: boolean;
}

let bakedNow: ChildNode[] = [];
const recorded = new Map<string, BakedField>();
const claimed = new Set<string>();

const FIELD_SELECTOR = "input[id], textarea[id]";

function fieldsIn(nodes: ChildNode[]): Array<HTMLInputElement | HTMLTextAreaElement> {
  const out: Array<HTMLInputElement | HTMLTextAreaElement> = [];
  for (const n of nodes) {
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.matches(FIELD_SELECTOR)) out.push(el as HTMLInputElement);
    out.push(...Array.from(el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(FIELD_SELECTOR)));
  }
  return out;
}

function readField(el: HTMLInputElement | HTMLTextAreaElement, live: boolean): BakedField {
  let selection: [number, number] | null = null;
  try {
    if (el.selectionStart !== null && el.selectionEnd !== null) selection = [el.selectionStart, el.selectionEnd];
  } catch { /* a field type with no caret */ }
  return { value: el.value, focused: el.ownerDocument.activeElement === el, selection, live };
}

/** The baked field with this id: what it holds now, or what it held when the baked page left. Null once claimed. */
export function bakedField(id: string): BakedField | null {
  if (claimed.has(id)) return null;
  const el = fieldsIn(bakedNow).find((f) => f.id === id);
  if (el) return readField(el, true);
  return recorded.get(id) ?? null;
}

/** The route has taken the field over: it is never offered again (a later visit to the route starts empty). */
export function claimBakedField(id: string): void {
  claimed.add(id);
  recorded.delete(id);
}

function recordFields(nodes: ChildNode[]): void {
  for (const el of fieldsIn(nodes)) {
    if (!el.id || claimed.has(el.id)) continue;
    const f = readField(el, false);
    if (f.value !== "" || f.focused) recorded.set(el.id, f);
  }
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
  // One document, one baked page: its fields are offered afresh.
  bakedNow = baked;
  recorded.clear();
  claimed.clear();
  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer(() => {
    if (!isReady(mount)) return;
    observer.disconnect();
    recordFields(baked);
    bakedNow = [];
    for (const node of baked) if (node.parentNode === container) container.removeChild(node);
  });
  // The pending mark can leave on its own (an attribute change, no new node).
  observer.observe(mount, { childList: true, subtree: true, attributes: true, attributeFilter: [ROUTE_PENDING_ATTRIBUTE] });
  return mount;
}
