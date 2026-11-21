/**
 * THE SKIP LINK IS DEAD ON ARRIVAL, AND THE PRESS IS NOT RECOVERABLE LATER.
 *
 * index.html ships `<a href="#main-content">` as the first focusable element of
 * every page, but the id is added by React: the prerendered shell emits a bare
 * `<main class="…">` (verified live 2026-08-25 — "main-content" occurs exactly
 * ONCE in the served /jobs HTML, in the link's own href), so for the whole
 * 1.0-2.7s hydration window the first key a keyboard user presses moves
 * nothing. The browser still writes the fragment to the URL, so the press
 * leaves a trace: when the page mounts and the target finally exists, honour it.
 *
 * WHY IT LIVES IN src/lib RATHER THAN IN Jobs.tsx.
 *
 * It was declared in Jobs.tsx because /jobs was the only page that needed it.
 * /explore needs it too — it is prerendered and sitemapped at priority 0.8
 * daily, and its <main> carried no id at all, so a keyboard or screen-reader
 * user's very first keystroke on that page moved nothing FOR EVER rather than
 * for the hydration window. Importing the helper from Jobs.tsx would have
 * pulled that 10.6k-line module — every board control, the detail panel, the
 * fit scorer — into /explore's chunk to reach a nine-line function. A shared
 * behaviour with two callers is a lib module; Jobs.tsx re-exports it so its own
 * guards and importers are untouched.
 *
 * The other half of the repair is in the prerender shell (see the report on
 * scripts/prerender-seo.mjs) — this is the half that belongs to the pages.
 */
export function honourPendingSkipLink(hash: string, doc: Document = document): boolean {
  if (hash !== "#main-content") return false;
  const el = doc.getElementById("main-content") as HTMLElement | null;
  if (!el) return false;
  el.focus();
  return doc.activeElement === el;
}

/**
 * WHERE THE SKIP LINK LANDS ON A PAGE WITHOUT #main-content (S8-095).
 *
 * Only four page components (Index, Jobs, Explore, GhostJobIndex) render the
 * id; /pricing, /auth, /account and some thirty-five others render a bare
 * <main> or none, so on them the first focusable control on the page moved
 * neither focus nor scroll. Rather than an id typed into forty files, the
 * press is caught once: the page's own #main-content when it has one (the
 * browser's fragment jump, untouched), else its first <main>, else its first
 * <h1>, made focusable for the press.
 */
export function skipLinkTarget(doc: Document = document): HTMLElement | null {
  return (doc.getElementById("main-content")
    ?? doc.querySelector("#root main")
    ?? doc.querySelector("main")
    ?? doc.querySelector("#root h1")
    ?? doc.querySelector("h1")) as HTMLElement | null;
}

/**
 * THE SHELL'S SKIP LINK, IN THE READER'S LANGUAGE (S14X-177).
 *
 * index.html writes the link in English as the first child of <body>, outside
 * React: the words a reader meets before the app has run. Once the app knows
 * the language, the link takes its words and its lang. Only that one link:
 * a page's own skip link is the page's.
 */
export const SHELL_SKIP_LINK = 'body > a[href="#main-content"]';

/** Give the shell's link these words and this lang. Answers whether there was a link to give them to. */
export function localiseSkipLink(doc: Document, text: string, lang: string): boolean {
  const link = doc.querySelector(SHELL_SKIP_LINK);
  if (!link || !text.trim()) return false;
  if (link.textContent !== text) link.textContent = text;
  if (lang) link.setAttribute("lang", lang);
  return true;
}

/** Catch a press on the skip link wherever the page has no #main-content.
 *  Returns the uninstaller. */
export function installSkipLinkFallback(doc: Document = document): () => void {
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[href="#main-content"]');
    if (!a || doc.getElementById("main-content")) return;
    const el = skipLinkTarget(doc);
    if (!el) return;
    e.preventDefault();
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus();
    el.scrollIntoView?.({ block: "start" });
  };
  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}

/**
 * A ROUTE CHANGE MOVES FOCUS TO THE NEW PAGE AND SAYS ITS TITLE (S14X-256).
 *
 * Every page is lazy and nothing persists across routes, so the link a
 * keyboard user pressed leaves with the old page and focus falls to <body>:
 * the next Tab starts from the top of the document, and a screen reader hears
 * nothing about the new page. ScrollToTop calls these on a path change (never
 * on the first load, an address with a fragment or a change of query alone):
 * wait for the new page to show, say its title in a polite live region, and,
 * when focus fell out of the old page, land it where the skip link lands
 * (skipLinkTarget's order), made focusable, without scrolling.
 *
 * Nothing is said or moved while a modal dialog is open (the consent banner
 * is not one: aria-modal="false"), and focus the reader put on a control that
 * stayed is left there.
 */
export const ROUTE_ANNOUNCER_ID = "rb-route-announcer";

/** How long a new page may take to show (a phone fetching the board's chunk) before nothing is moved. */
export const ROUTE_SETTLE_MAX_MS = 10_000;

const PAGE_TARGETS = ["#main-content", "main", "h1"] as const;
const OPEN_MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="dialog"][data-state="open"]';

/** In the document and not inside anything hidden: React hides a page whose successor is still loading with display:none. */
function isShown(el: Element | null): boolean {
  if (!el || !el.isConnected) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const h = n as HTMLElement;
    if (h.hidden || h.style?.display === "none") return false;
  }
  return true;
}

/**
 * Where a new page lands: skipLinkTarget's order, among what the app renders
 * and shows (inside the app's mount on a baked page, else #root, else the
 * document), so never a hidden old page or a baked node about to leave.
 */
export function shownPageTarget(doc: Document = document): HTMLElement | null {
  const scope: ParentNode = doc.querySelector("[data-app-mount]") ?? doc.getElementById("root") ?? doc;
  for (const sel of PAGE_TARGETS) {
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>(sel))) if (isShown(el)) return el;
  }
  return null;
}

/** Focus fell out of the page: onto <body>, nowhere, or an element that left or was hidden. */
export function focusWasLost(doc: Document = document): boolean {
  const a = doc.activeElement;
  return !a || a === doc.body || a === doc.documentElement || !isShown(a);
}

/** A modal dialog is open: it owns the focus and the reader's attention. */
export function modalIsOpen(doc: Document = document): boolean {
  return Array.from(doc.querySelectorAll(OPEN_MODAL)).some(isShown);
}

/**
 * The new page shows: say its title and, if focus fell out of the old page,
 * land it on the new one. Answers whether focus moved.
 */
export function landOnNewPage(doc: Document, announcer: HTMLElement | null): boolean {
  if (modalIsOpen(doc)) return false;
  if (announcer) {
    // Emptied first, so the same title twice in a row is still a change.
    announcer.textContent = "";
    announcer.textContent = doc.title;
  }
  if (!focusWasLost(doc)) return false;
  const el = shownPageTarget(doc);
  if (!el) return false;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  return doc.activeElement === el;
}

/**
 * Wait, a frame at a time, for the new page to show (a lazy page's code may
 * still be on its way), then one frame more for a title written on the next
 * frame, and call `land`. Gives up after `maxMs`. Returns a cancel, for the
 * next route change or an unmount.
 */
export function whenNewPageShows(doc: Document, land: () => void, maxMs: number = ROUTE_SETTLE_MAX_MS): () => void {
  const win = doc.defaultView;
  const raf: (cb: () => void) => number = win?.requestAnimationFrame
    ? (cb) => win.requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16) as unknown as number;
  const caf: (id: number) => void = win?.cancelAnimationFrame ? (id) => win.cancelAnimationFrame(id) : (id) => clearTimeout(id);
  const start = Date.now();
  let shownOnce = false;
  let done = false;
  let id = 0;
  const tick = () => {
    if (done) return;
    if (shownPageTarget(doc)) {
      if (shownOnce) {
        done = true;
        land();
        return;
      }
      shownOnce = true;
    }
    if (Date.now() - start > maxMs) {
      done = true;
      return;
    }
    id = raf(tick);
  };
  id = raf(tick);
  return () => {
    done = true;
    caf(id);
  };
}
