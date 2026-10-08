/**
 * THE ADDRESS THIS HOST ACTUALLY SERVES FOR A PATH.
 *
 * A path whose last segment contains a dot 404s on this host without a
 * trailing slash: /jobs/company/careers.amd.com answers a 9-byte "Not found"
 * while /jobs/company/careers.amd.com/ serves the page, because the host reads
 * the dot as a file extension (measured 2026-08-15; the bake's publicHref in
 * scripts/prerender-seo.mjs records the 25-of-485 measurement). In-app
 * navigation never noticed — only a cold load does, which is what a crawler, a
 * pasted link, a new tab and a reload all are.
 *
 * The React side built every /jobs/company/<token> href by hand without the
 * slash, so the card's employer link, the panel's, the employer context, the
 * similar-companies tiles, the layoff-filing line, the posting page and the
 * board's own address bar all pointed at the dead form for dotted tokens.
 * Every one of them now asks here.
 *
 * Same rule as the bake's publicHref, applied to the PATH only: a query string
 * or fragment is kept after the slash, never swallowed into the test.
 */
export function publicPath(href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const rest = cut < 0 ? "" : href.slice(cut);
  return /\.[^/]*$/.test(path) ? `${path}/${rest}` : `${path}${rest}`;
}

/** The lander for one employer board, in the form this host serves. */
export function companyLanderPath(token: string, query?: string): string {
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return publicPath(`/jobs/company/${encodeURIComponent(token)}${q}`);
}
