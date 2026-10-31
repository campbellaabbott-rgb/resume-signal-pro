import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { scrollToFragment } from "@/lib/scroll-to-fragment";

/**
 * A new page opens at its top, and an address with a fragment opens on the
 * element it names (src/lib/scroll-to-fragment.ts): a fresh load of
 * /pricing#pro, Go Pro's return from sign-in, the Builder link to
 * /data-api#builder. "#upload" is the scanner's own (Index scrolls to its
 * uploader). A fragment that goes away on the same page moves nothing.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const first = useRef(true);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const firstLoad = first.current;
    first.current = false;
    const samePage = lastPath.current === pathname;
    lastPath.current = pathname;
    if (hash && hash !== "#upload") return scrollToFragment(hash, { firstLoad });
    if (!samePage) window.scrollTo(0, 0);
    return undefined;
  }, [pathname, hash]);

  return null;
}
