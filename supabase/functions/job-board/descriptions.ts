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
 * Vendors whose description rides along in the LIST payload, so ingest stores it
 * for free — but ingest is INSERT-ONLY (postings are immutable in practice, so
 * unchanged rows are never rewritten). Rows that predate the extraction keep
 * their null forever, and they must NOT go in the per-posting sweep: one row
 * there would re-fetch the whole board. They get a board-level lane instead —
 * one fetch fills every null row on that board.
 *
 * icims joined 2026-08-24: it ships `data.description` (plus qualifications/
 * responsibilities) on every LIST item and the parser in
 * listPayloadDescriptions had handled it from the start — but no ingest
 * branch and no sweep membership ever CALLED it, so 18,713 servable icims
 * rows (100% of the vendor) stored null while the text arrived on every
 * fetch. A dead export named LIST_DESC_SOURCES documented the intent and
 * was imported nowhere; membership here is what actually runs.
 */
export const BOARD_DESC_SOURCES = ["workable", "pinpoint", "icims"] as const;

/**
 * Vendors with no public description source. A null here is a measured fact, not
 * a hole to be filled later — keep them out of the sweep so it doesn't burn
 * requests re-failing on them every pass.
 */
export const NO_DESC_SOURCES = ["rippling"] as const;

/**
 * The text a posting is embedded FROM (gte-small, 384-dim, run in the edge
 * runtime). The model truncates at 512 tokens and is English-only, so this is
 * deliberately title-forward: title and company lead, then location, then the
 * OPENING slice of the description — the part that states what the role is.
 * Feeding a whole 14KB JD would just push the informative text past the
 * truncation point.
 *
 * Kept pure so tests can pin the shape; the caller records whether a
 * description was present (embedded_desc) so the row is re-embedded when one
 * lands later.
 */
export function buildEmbedInput(
  title: string | null | undefined,
  company: string | null | undefined,
  location: string | null | undefined,
  description: string | null | undefined,
): string {
  const parts = [
    (title ?? "").trim(),
    [company, location].filter((x) => (x ?? "").trim()).join(" — ").trim(),
    (description ?? "").replace(/\s+/g, " ").trim().slice(0, 1200),
  ].filter(Boolean);
  return parts.join("\n").slice(0, 1600);
}

/**
 * Grouping key for "this is the same job, posted again in another location".
 *
 * Measured on production 2026-07-25: searching `driver` returned ONE posting
 * from one employer 13 times in the first 40 rows (six Colorado towns, some
 * repeated); `project manager` returned the same Ramboll role 7 times across
 * UK/Ireland cities. 30-35% of a results page was a single job. These are not
 * duplicate DATA — each row is a genuine, separately-applyable ATS posting with
 * its own apply URL — so they must not be deleted. They just shouldn't each
 * consume a result slot.
 *
 * The key is deliberately conservative: same employer AND same normalized
 * title. Requisition numbers, location suffixes in parentheses/brackets, and
 * punctuation/whitespace noise are stripped so "Nurse (Boston)" and
 * "Nurse - Boston #R123" collapse, while "Senior Nurse" stays distinct from
 * "Nurse". Titles that differ in any meaningful word are never merged.
 */
export function clusterKey(companyKey: string, title: string): string {
  // The company side is a display NAME since 2026-07-25 (so one employer's
  // several feed tokens fold together); normalize it the same way as titles.
  const companyKey0 = (companyKey || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const t = (title || "")
    .toLowerCase()
    // location/req qualifiers that ride along on the title
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    // requisition ids: R12345, JR-9620, #2025-031054
    .replace(/#?\b(?:jr|r|req|job)?[-\s]?\d[\d-]{3,}\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${companyKey0} ${t}`;
}

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
