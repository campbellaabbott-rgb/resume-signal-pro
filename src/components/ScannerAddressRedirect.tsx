import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { scannerAddressFor } from "@/lib/scanner-address";

/**
 * THE SCANNER'S OLD ADDRESSES STILL REACH THE SCANNER (homepage switch-over,
 * docs/homepage-pricing/README.md, owner decision 5: the scanner lives at
 * /resume-checker).
 *
 * "/" was the scanner, and links all over the site, in sent emails and in
 * bookmarks still carry its addresses:
 *
 *   - "/#upload" (with or without a query): the board's "Check my fit", the
 *     header's Start, the account checklist, ProductPreview, the rate-limit
 *     sign-in's next=, and the builder's "/?rescan=1#upload";
 *   - "/?outcome=<answer>&rid=<report>": the outcome links in every scan
 *     report email sent so far (send-scan-report), which Index records;
 *   - the other query parameters only Index reads (coupon=, canceled=,
 *     scan_pack_success=, scan_pack_canceled=, session_id=).
 *
 * This element sits on the "/" route, outside the lazy page, so a redirect
 * loads no page chunk before it moves (spec P27). It keeps the query and the
 * hash: Index reads both at /resume-checker exactly as it did at "/". Any other
 * address of "/" (utm_ tags, a bare visit) renders the route's page.
 */

export function ScannerAddressRedirect({ children }: { children: ReactNode }) {
  const { search, hash } = useLocation();
  const to = scannerAddressFor(search, hash);
  if (to) return <Navigate to={to} replace />;
  return <>{children}</>;
}
