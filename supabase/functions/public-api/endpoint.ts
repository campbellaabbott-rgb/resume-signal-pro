// WHICH METERED ENDPOINT A PATH IS, AND WHICH POSTING AN APPLICATION PATH NAMES.
//
// api_key_check writes one api_usage row per (key, day, endpoint), and two
// things read those rows back as limits rather than as an invoice: the free
// fit allowance (25 scored calls a day on /v1/fit) and the owner's per-route
// usage. So the endpoint string is part of the contract, and two spellings of
// one route must land on ONE row:
//
//   - /v1/jobs/{id}/application is its own endpoint. Matched before the
//     /v1/jobs/ prefix, or every form read would be metered, and routed, as a
//     posting lookup for the id "<id>/application".
//   - /v1/fit/ is /v1/fit. The router has always answered both; metered apart,
//     the trailing slash was a second daily allowance.
//
// Pure, so the Node suite runs it by value.

/** The metered name of the application-form route. */
export const APPLICATION_ENDPOINT = "/v1/jobs/{id}/application";

/** The metered name of the fit route, whichever spelling reached it. */
export const FIT_ENDPOINT = "/v1/fit";

/**
 * The posting id segment of /v1/jobs/{id}/application, still percent-encoded,
 * or null for any other path. One segment: an id holding a slash arrives
 * encoded (%2F) and is decoded by the caller.
 */
export function applicationIdSegment(path: string): string | null {
  const m = /^\/v1\/jobs\/([^/]+)\/application\/?$/.exec(path);
  return m ? m[1] : null;
}

/** The endpoint api_key_check meters this stripped path under. */
export function meteredEndpoint(path: string): string {
  if (applicationIdSegment(path) !== null) return APPLICATION_ENDPOINT;
  if (path.startsWith("/v1/jobs/")) return "/v1/jobs/{id}";
  if (path === FIT_ENDPOINT || path === `${FIT_ENDPOINT}/`) return FIT_ENDPOINT;
  return path;
}
