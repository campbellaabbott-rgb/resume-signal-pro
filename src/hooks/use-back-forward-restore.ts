import { useEffect, useRef } from "react";

/**
 * RUN `reset` WHEN THE BROWSER RESTORES THIS PAGE FROM ITS BACK/FORWARD CACHE
 * (sweep S8-014).
 *
 * A page that navigated to Stripe is frozen with whatever state it had at that
 * moment, and pressing Back thaws it as it was: the homepage came back under
 * its full-screen "Redirecting to checkout" overlay, which has no way out.
 * A restore fires `pageshow` with `persisted` true and runs no React effects,
 * so this is the one place such a page learns it is being looked at again.
 */
export function useBackForwardRestore(reset: () => void): void {
  const latest = useRef(reset);
  latest.current = reset;
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) latest.current();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
}
