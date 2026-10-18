/**
 * True while the viewport is at least `px` wide, read synchronously on the
 * first render so a section never paints in its phone form and then jumps to
 * its desktop form (a layout shift). The pricing page renders ONE form of each
 * responsive section, so its text sits in the DOM once: a reader's Find and a
 * crawler's rendered page meet each sentence a single time.
 */
import { useCallback, useSyncExternalStore } from "react";

function mql(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = mql(query);
      if (!m) return () => {};
      if (typeof m.addEventListener === "function") {
        m.addEventListener("change", cb);
        return () => m.removeEventListener("change", cb);
      }
      m.addListener?.(cb);
      return () => m.removeListener?.(cb);
    },
    [query],
  );
  const read = () => mql(query)?.matches ?? false;
  return useSyncExternalStore(subscribe, read, () => false);
}
