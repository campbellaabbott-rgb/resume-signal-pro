import { useEffect } from "react";
import { installSkipLinkFallback } from "@/lib/skip-link";

/** index.html's "Skip to main content" works on every page, not only the four
 *  that render #main-content (see installSkipLinkFallback). Mounted once in App. */
export function SkipLinkFallback(): null {
  useEffect(() => installSkipLinkFallback(), []);
  return null;
}
