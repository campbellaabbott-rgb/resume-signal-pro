/**
 * The scanner's old addresses, as data (see src/components/ScannerAddressRedirect.tsx
 * for why "/" still hands them to /resume-checker). Pure: no React, no router.
 */

/** Every query parameter Index reads from the address. A test holds this list to Index's own reads. */
export const SCANNER_QUERY_PARAMS: readonly string[] = [
  "outcome",
  "rid",
  "coupon",
  "canceled",
  "scan_pack_success",
  "scan_pack_canceled",
  "session_id",
];

/** The scanner's address for this location of "/", or null when it is not one of the scanner's. */
export function scannerAddressFor(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const scanner = hash === "#upload" || SCANNER_QUERY_PARAMS.some((k) => params.has(k));
  return scanner ? `/resume-checker${search}${hash}` : null;
}
