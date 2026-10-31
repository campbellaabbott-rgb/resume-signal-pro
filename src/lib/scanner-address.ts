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

/**
 * AN AFFILIATE'S CODE, BY ITS SHAPE (review round 2026-10-26). Codes are
 * minted as 12 hex characters (affiliates.referral_code DEFAULT
 * encode(gen_random_bytes(6),'hex')). Directories and aggregators tag their
 * own links ?ref=producthunt, ?ref=github: those visitors belong on the
 * homepage, so a "ref" counts as the scanner's only in a code's shape.
 */
export const AFFILIATE_CODE = /^[0-9a-f]{12}$/i;

function scannerParam(params: URLSearchParams, k: string): boolean {
  if (!params.has(k)) return false;
  return k === "ref" ? AFFILIATE_CODE.test(params.get(k) ?? "") : true;
}

/** The scanner's address for this location of "/", or null when it is not one of the scanner's. */
export function scannerAddressFor(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const scanner = hash === "#upload" || SCANNER_QUERY_PARAMS.some((k) => scannerParam(params, k)) || scannerMailCampaign(params);
  return scanner ? `/resume-checker${search}${hash}` : null;
}

/**
 * The same rule as one JavaScript expression over `location`, for the baked
 * fallback's inline scripts (scripts/prerender-seo.mjs, prerender-preload.mjs),
 * which run before any bundle: true on a scanner address of "/". Written from
 * SCANNER_QUERY_PARAMS and AFFILIATE_CODE, so the inline copy cannot drift
 * from the route's; a test runs both over the same addresses.
 */
export function scannerAddressScript(): string {
  const keys = JSON.stringify(SCANNER_QUERY_PARAMS.filter((k) => k !== "ref"));
  return `(function(){var p=new URLSearchParams(location.search);return location.hash==="#upload"||${keys}.some(function(k){return p.has(k);})||${AFFILIATE_CODE.toString()}.test(p.get("ref")||"")||p.get("utm_campaign")==="rescan"||p.get("utm_medium")==="scan_report";})()`;
}
