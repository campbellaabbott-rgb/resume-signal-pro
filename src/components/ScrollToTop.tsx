import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { scrollToFragment } from "@/lib/scroll-to-fragment";
import { ROUTE_ANNOUNCER_ID, landOnNewPage, whenNewPageShows } from "@/lib/skip-link";

/**
 * A new page opens at its top, and an address with a fragment opens on the
 * element it names (src/lib/scroll-to-fragment.ts): a fresh load of
 * /pricing#pro, Go Pro's return from sign-in, the Builder link to
 * /data-api#builder. "#upload" is the scanner's own (Index scrolls to its
 * uploader). A fragment that goes away on the same page moves nothing.
 *
 * A move to another page is also said and focused (S14X-256): once the new
 * page shows, the live region below reads its title, and focus that fell out
 * of the old page lands on the new one (src/lib/skip-link.ts). Never on the
 * first load, an address with a fragment, or a change of query alone.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const first = useRef(true);
  const lastPath = useRef<string | null>(null);
  const announcer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const firstLoad = first.current;
    first.current = false;
    const samePage = lastPath.current === pathname;
    lastPath.current = pathname;
    if (hash && hash !== "#upload") return scrollToFragment(hash, { firstLoad });
    if (samePage) return undefined;
    window.scrollTo(0, 0);
    if (firstLoad || hash) return undefined;
    return whenNewPageShows(document, () => {
      landOnNewPage(document, announcer.current);
    });
  }, [pathname, hash]);

  return <div id={ROUTE_ANNOUNCER_ID} ref={announcer} className="sr-only" aria-live="polite" aria-atomic="true" />;
}
