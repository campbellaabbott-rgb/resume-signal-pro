/**
 * AN ADDRESS WITH A FRAGMENT LANDS ON THE ELEMENT IT NAMES (review round of
 * 2026-10-26).
 *
 * Three ways it did not:
 *   - A fresh load of /pricing#pro (the JSON-LD Offer.url points crawlers and
 *     AI hosts at /pricing#free, and at #full-analysis and #pro once they are
 *     on sale) ended at the very bottom of the page. The baked page carried
 *     the same ids, Chrome anchored to the baked card, React's page was
 *     inserted above it and pushed it down, then the baked nodes were removed
 *     and the scroll clamped at the footer (src/lib/keep-prerendered-page.ts).
 *     #pricing-limits and #pricing-faq, which the baked page lacks, stayed at
 *     the top.
 *   - A client-side navigation to an address with a fragment (Go Pro's return
 *     from /auth?next=/pricing%23pro, the Builder link to /data-api#builder)
 *     opened the page at its top: ScrollToTop scrolled to 0 on every new path
 *     and nothing looked at the fragment.
 *   - Even on a page the bake did not write, ScrollToTop's first run scrolled
 *     to 0 after the browser's own anchoring.
 *
 * So ScrollToTop hands a fragment here: wait for React's element with that id
 * (inside the app's mount, never a baked node that is about to be removed),
 * scroll it into view once (scroll-padding-top keeps it below the header),
 * and give up the moment the reader scrolls, presses a key or touches the
 * page first, or after FRAGMENT_WAIT_MS.
 */

/** How long to wait for the named element (a page may wait up to 6 s for its locale). */
export const FRAGMENT_WAIT_MS = 8000;

const INTERACTIONS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/** The element React rendered with this id: inside the app's mount on a baked page, anywhere otherwise. */
export function reactElementById(doc: Document, id: string): HTMLElement | null {
  const mount = doc.querySelector<HTMLElement>("[data-app-mount]");
  if (!mount) return doc.getElementById(id);
  for (const el of Array.from(mount.querySelectorAll<HTMLElement>("[id]"))) if (el.id === id) return el;
  return null;
}

/**
 * Scroll to the element `hash` names once it exists. `firstLoad` says this is
 * the page's first route: then a scroll already made (the reader's, not the
 * browser's anchoring to a baked node of the same id) wins. Returns a cleanup.
 */
export function scrollToFragment(hash: string, { firstLoad = false, doc = document }: { firstLoad?: boolean; doc?: Document } = {}): () => void {
  let id = "";
  try { id = decodeURIComponent(hash.replace(/^#/, "")); } catch { id = hash.replace(/^#/, ""); }
  const win = doc.defaultView;
  if (!id || !win) return () => {};

  if (firstLoad && win.scrollY > 2) {
    // The browser anchors a fresh load to a baked node of this id; any other
    // scroll before React's first route is the reader's.
    const baked = doc.getElementById(id);
    if (!baked || baked.closest("[data-app-mount]")) return () => {};
  } else if (!firstLoad) {
    win.scrollTo(0, 0);
  }

  let done = false;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    if (timer) clearTimeout(timer);
    for (const e of INTERACTIONS) win.removeEventListener(e, stop, true);
  };
  const tryScroll = () => {
    if (done) return;
    const el = reactElementById(doc, id);
    if (!el) return;
    stop();
    el.scrollIntoView({ block: "start" });
  };
  for (const e of INTERACTIONS) win.addEventListener(e, stop, { capture: true, passive: true });
  tryScroll();
  if (!done) {
    const Observer = win.MutationObserver ?? MutationObserver;
    observer = new Observer(tryScroll);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["id"] });
    timer = setTimeout(stop, FRAGMENT_WAIT_MS);
  }
  return stop;
}
