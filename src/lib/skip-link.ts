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
