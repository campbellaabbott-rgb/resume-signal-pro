/**
 * AN OLD TAB AFTER A DEPLOY LOADS THE NEW VERSION, AND FILES NO CRASH (NB-41).
 *
 * We deploy many times a day, and every deploy renames the lazy chunks. A tab
 * opened before a deploy asks for a chunk that no longer exists when the
 * visitor moves to a page it has not loaded yet; Vite announces that with a
 * cancelable `vite:preloadError` event. The handler in main.tsx reloaded the
 * tab, but it ALWAYS cancelled the event first, so the import it cancelled
 * resolved to nothing, React threw "Cannot read properties of undefined"
 * while the reload was still on its way, the crash screen flashed, and the
 * error boundary filed a crash report for every such navigation: the
 * owner's crash log counted deploys.
 *
 * Now:
 *   - the event is cancelled only when this handler reloads, and it marks
 *     the page as reloading for a new version first;
 *   - a second failure inside RELOAD_GUARD_MS is left alone (no loop), so
 *     the import's own error reaches the boundary;
 *   - both error boundaries (src/components/ErrorBoundary.tsx) show "Loading
 *     the new version" and send nothing while the page is reloading, or when
 *     the error is a chunk that could not be fetched.
 */

let reloading = false;

/** The page is reloading to pick up a new build. */
export function markReloadingForNewVersion(): void {
  reloading = true;
}

/** Whether this page is on its way to the new build. */
export function isReloadingForNewVersion(): boolean {
  return reloading;
}

/** Tests only. */
export function resetNewVersionReloadForTests(): void {
  reloading = false;
}

/**
 * Whether an error is a lazy chunk the browser could not fetch: the import a
 * deploy left behind. Chrome, Firefox and Safari word it differently; Vite's
 * CSS preload has its own sentence.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message ?? "");
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message);
}

/** The session key that remembers the last reload, so a chunk that stays missing cannot loop. */
export const RELOAD_KEY = "rb_chunk_reload_at";
export const RELOAD_GUARD_MS = 30_000;

/**
 * The `vite:preloadError` handler: reload once for the new build. Answers
 * whether it reloaded.
 */
export function reloadForNewVersion(
  event: Event,
  reload: () => void = () => window.location.reload(),
  now: number = Date.now(),
): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    // Tried a moment ago and it is still missing: leave the event alone, so
    // the import's own error reaches the boundary instead of a page of nothing.
    if (now - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch { /* storage blocked: still reload */ }
  event.preventDefault();
  markReloadingForNewVersion();
  reload();
  return true;
}
