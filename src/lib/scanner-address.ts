/**
 * The scanner's old addresses, as data (see src/components/ScannerAddressRedirect.tsx
 * for why "/" still hands them to /resume-checker). Pure: no React, no router.
 */

/**
 * Every query parameter Index reads from the address, and every one a hook
 * Index mounts reads for the scanner ("ref": the affiliate code, which only
 * Index's useAffiliateTracking records). A test holds this list to those reads.
 */
export const SCANNER_QUERY_PARAMS: readonly string[] = [
  "outcome",
  "rid",
  "coupon",
  "canceled",
  "scan_pack_success",
  "scan_pack_canceled",
  "session_id",
  "ref",
];

/**
 * The scanner's own mail campaigns, which carry only campaign tags: the scan
 * report's and the market pulse's "Rescan free" links (utm_campaign=rescan),
 * and every scan-report link to "/" (utm_medium=scan_report). Mail already
 * sent keeps these addresses, so they reach the scanner whatever "/" becomes.
 */
function scannerMailCampaign(params: URLSearchParams): boolean {
  return params.get("utm_campaign") === "rescan" || params.get("utm_medium") === "scan_report";
}

/**
 * Where a sign-in started on the scanner brings the reader back: the scanner
 * page they are on, or /resume-checker from "/", which stops being the
 * scanner at the switch-over.
 */
export function scannerReturnPath(pathname: string = typeof window === "undefined" ? "/" : window.location.pathname): string {
  return pathname && pathname !== "/" ? pathname : "/resume-checker";
}

/** The scanner's address for this location of "/", or null when it is not one of the scanner's. */
export function scannerAddressFor(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const scanner = hash === "#upload" || SCANNER_QUERY_PARAMS.some((k) => params.has(k)) || scannerMailCampaign(params);
  return scanner ? `/resume-checker${search}${hash}` : null;
}
