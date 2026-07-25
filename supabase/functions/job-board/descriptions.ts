// Where a posting's description text actually comes from, per vendor.
//
// Measured against the live vendor APIs on 2026-07-24, when stored coverage was
// 19.8% (113,174 of 570,663). The gap was not patchy — it was binary. Every
// vendor whose LIST payload carries the text sat near 100%; every vendor needing
// a per-posting fetch sat at exactly 0%, because nothing had ever fetched them:
//
//   in the list payload we already fetch  greenhouse 99.9 · ashby 100 · recruitee 100
//                                         teamtailor 99.9 · lever 89.6 · personio 87.1
//                                         + workable and pinpoint (were being
//                                           parsed and then discarded)
//   per-posting detail fetch              workday 0 · smartrecruiters 0 · bamboohr 0
//                                         · oracle 0 · breezy 0
//   no public source                      rippling — board HTML is client-rendered
//                                         and carries no JD; stored null is honest
//
// These helpers are pure so the test suite can exercise the URL derivation and
// HTML parsing without booting the edge function.

/** Vendors whose description needs a per-posting fetch (the backfill sweep's scope). */
export const DETAIL_DESC_SOURCES = ["workday", "smartrecruiters", "bamboohr", "oracle", "breezy"] as const;

/**
 * Vendors with no public description source. A null here is a measured fact, not
 * a hole to be filled later — keep them out of the sweep so it doesn't burn
 * requests re-failing on them every pass.
 */
export const NO_DESC_SOURCES = ["rippling"] as const;

/**
 * Workday's CXS JSON detail endpoint, derived from the public posting URL we
 * already store. Workday's list payload has no description and its ids are bare
 * requisition numbers (JR12345), so the apply_url is the only thing that carries
 * the site + job path the detail endpoint needs.
 *
 *   https://acme.wd3.myworkdayjobs.com/en-US/Acme_Careers/job/Boston/Engineer_JR9620
 *   → https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Acme_Careers/job/Boston/Engineer_JR9620
 *
 * The locale segment (en-US) is optional and must not be mistaken for the site.
 */
export function workdayCxsUrl(applyUrl: string): string | null {
  const m = (applyUrl || "").match(
    /^https:\/\/([a-z0-9][a-z0-9-]*)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?([^/?#]+)(\/job\/[^?#]+)/i,
  );
  if (!m) return null;
  const [, tenant, wd, site, path] = m;
  return `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${path}`;
}

/**
 * The description from a page's schema.org JobPosting node.
 *
 * Breezy renders its posting body client-side — the /json list has no
 * description field at all — but it emits this block for Google Jobs. Pages
 * carry MORE THAN ONE ld+json script (a WebSite node comes first), so every node
 * has to be checked; taking only the first one finds nothing.
 */
export function jobPostingLdDescription(html: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of (html || "").matchAll(re)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // not valid JSON — keep looking
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const n = node as { "@type"?: unknown; description?: unknown } | null;
      if (n && n["@type"] === "JobPosting" && typeof n.description === "string" && n.description.length > 100) {
        return n.description;
      }
    }
  }
  return null;
}
