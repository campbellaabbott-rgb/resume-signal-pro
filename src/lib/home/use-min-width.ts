import { useEffect, useState } from "react";

/**
 * True while the viewport is at least `px` wide. Read synchronously on the
 * first render, so a block that is open on a desktop is open in the first
 * frame and nothing moves when the effect runs.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const read = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState<boolean>(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    if (typeof mql.addEventListener === "function") mql.addEventListener("change", on);
    else mql.addListener?.(on);
    return () => {
      if (typeof mql.removeEventListener === "function") mql.removeEventListener("change", on);
      else mql.removeListener?.(on);
    };
  }, [query]);
  return matches;
}
