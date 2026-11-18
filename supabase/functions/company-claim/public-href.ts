/**
 * THE ADDRESS THIS HOST ACTUALLY SERVES FOR A PATH, FOR THE CLAIM MAILS
 * (S14X-061).
 *
 * A path whose last segment contains a dot 404s on this host without a
 * trailing slash (/jobs/company/careers.ulta.com answers a 9-byte "Not
 * found", /jobs/company/careers.ulta.com/ serves the page): the host reads
 * the dot as a file extension. Both claim mails built the company page's
 * address by hand and linked the dead form for every dotted token.
 *
 * A copy of publicPath and companyLanderPath from src/lib/public-href.ts,
 * kept here rather than in _shared because company-claim is its only
 * importer (and _shared counts against the board's upload room). A test
 * holds the two copies to the same answers
 * (src/test/a-claim-mail-links-the-company-page-the-host-serves.test.ts).
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
