/**
 * FOLDING SIBLING POSTINGS INTO ONE CARD — on its own, so a test can walk it.
 *
 * Extracted from index.ts on 2026-08-23, for the same reason paging.ts was:
 * the logic was inline, nothing could import it, and the guards that covered
 * it matched source text. That is how the card came to say "Also hiring in 84
 * more locations" about a role posted 85 times in ONE city — the fold counted
 * sibling ROWS and called them locations, while dutifully deduping the sample
 * list it displayed beside the number. Measured 2026-08-23: 2.4% of served
 * cards claimed locations that do not exist.
 */
import { clusterKey } from "./descriptions.ts";

// One employer's role, reposted per location, was eating up to 35% of a
// results page (measured 2026-07-25). Collapse those into a single result that
// says how many locations it covers, instead of spending 13 slots on it.
export const GROUP_OVERFETCH = 3;
export const GROUP_SAMPLE_LOCATIONS = 6;

/**
 * Fold rows sharing a cluster key into one, carrying a location count.
 *
 * `rawConsumed` is the number of SOURCE rows this page swallowed, which is what
 * the next page must offset by — the displayed row count no longer equals the
 * rows read, so paginating by jobs.length would re-show siblings as if they
 * were new results. Consumption deliberately continues past the limit for rows
 * that join an ALREADY-emitted cluster, and stops at the first row that would
 * open a new one, so no row is ever skipped or shown twice.
 */
// "Newest first" was, on the default board, one refresh batch sorted
// alphabetically by employer.
//
// The serving sort is `effective_posted DESC, id ASC`. effective_posted is
// coalesce(posted_at, first_seen), and first_seen defaults to now() — which is
// transaction-stable, so every row in a 250-row upsert chunk shares one
// timestamp. Ingest runs per board, so a tie group is ONE employer's postings.
// The id tie-break is `source:token:externalId`, which then walks those
// employers in alphabetical order.
//
// Measured 2026-07-29: 13 of the 60 first-page slots (22%) were taken by two
// employers, in runs of 7 and 6. The data underneath is accurate; the page just
// looks like a low-quality board, and page 1 is what every visitor judges us on.
//
// This does not re-sort — reordering by recency would be a lie about data whose
// recency genuinely ties. It caps how many CONSECUTIVE cards one employer may
// hold, deferring the overflow a little further down. Every posting still
// appears, in the same tie group, so pagination stays stable and no card claims
// to be newer than it is.
const MAX_CONSECUTIVE_PER_COMPANY = 2;

export function interleaveByCompany(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let deferred: Array<Record<string, unknown>> = [];
  let runKey = "";
  let runLen = 0;
  const keyOf = (r: Record<string, unknown>) => String(r.company ?? r.company_token ?? "");
  // The TIE GROUP a row belongs to. Reordering is only honest inside one:
  // rows sharing an effective_posted are genuinely equally recent, so their
  // relative order carries no information and may be permuted freely. Moving a
  // row ACROSS groups would make the page claim a recency it does not have —
  // which the previous version did, inverting 22 of 59 adjacent pairs (max
  // 55.3s) while its own comment promised the opposite.
  const tieOf = (r: Record<string, unknown>) => String(r.postedAt ?? r.effective_posted ?? r.firstSeen ?? "");
  let tie = rows.length ? tieOf(rows[0]) : "";
  const flush = () => { out.push(...deferred); deferred = []; runKey = ""; runLen = 0; };
  for (const r of rows) {
    const t = tieOf(r);
    if (t !== tie) { flush(); tie = t; }   // group boundary: nothing crosses it
    const k = keyOf(r);
    if (k && k === runKey && runLen >= MAX_CONSECUTIVE_PER_COMPANY) { deferred.push(r); continue; }
    // A deferred row is eligible again as soon as a different employer breaks
    // the run, so nothing is pushed to the end of the group wholesale.
    if (k === runKey) runLen++; else { runKey = k; runLen = 1; }
    out.push(r);
    if (deferred.length) {
      const i = deferred.findIndex((d) => keyOf(d) !== runKey);
      if (i >= 0) {
        const [d] = deferred.splice(i, 1);
        runKey = keyOf(d); runLen = 1;
        out.push(d);
      }
    }
  }
  flush();
  return out;
}

/**
 * The categories facet a response may honestly publish.
 *
 * BOARD-WIDE COUNTS INSIDE A FILTERED VIEW OVERSTATED BY 15.7x TO 45x, which is
 * why `categories` is withheld unless the request is unfiltered. That rule is
 * right and stays.
 *
 * But it took a true number away from the one page that needs it most. A
 * category lander (/jobs/field/engineering) IS filtered, so it got nothing, and
 * the page fell back to the capped `total` — rendering "10,000+" under a Google
 * snippet promising "68,347+". The count that won the click did not survive it.
 *
 * The single ACTIVE category is a different claim from the whole facet: it is
 * scoped to exactly what the reader filtered, so it cannot overstate. Publish
 * that one entry, and nothing else.
 */
export function visibleCategories(
  facet: Record<string, number> | undefined,
  unfiltered: boolean,
  activeCategory: string | null,
): Record<string, number> | undefined {
  if (unfiltered) return facet ?? {};
  if (!activeCategory || !facet) return undefined;
  const n = facet[activeCategory];
  return typeof n === "number" ? { [activeCategory]: n } : undefined;
}

export function collapseClusters(
  rows: Array<Record<string, unknown>>,
  limit: number,
): { jobs: Array<Record<string, unknown>>; rawConsumed: number } {
  const out: Array<Record<string, unknown>> = [];
  const byKey = new Map<string, Record<string, unknown>>();
  let rawConsumed = 0;
  // Every distinct non-empty location per cluster — uncapped, unlike the
  // six-item display sample, because this feeds the COUNT the card states.
  const locSets = new Map<string, Set<string>>();
  for (const r of rows) {
    // Keyed on the display NAME, not the feed token: PwC's five sub-boards
    // must fold together. Two different employers sharing an identical display
    // name AND an identical title is the residual risk, accepted — users could
    // not tell those cards apart anyway.
    const key = clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""));
    const hit = byKey.get(key);
    if (!hit && out.length >= limit) break; // next page starts exactly here
    rawConsumed++;
    if (hit) {
      // TWO COUNTS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. postingCount is
      // how many requisitions folded into this card. locationCount is how many
      // DISTINCT places they cover — and it used to be the sibling count
      // wearing the location count's name. The sample list below was already
      // deduped (the same role genuinely recurs in one town — Pueblo, CO,
      // twice), so the code knew locations repeat and counted them anyway:
      // measured 2026-08-23, 2.4% of served cards claimed locations that do
      // not exist, the largest a single-location role in Kyiv posted 85 times
      // and captioned "84 more locations".
      hit.postingCount = (Number(hit.postingCount) || 1) + 1;
      const locs = hit.otherLocations as string[];
      const loc = typeof r.location === "string" ? r.location.trim() : "";
      if (loc && loc !== hit.location && locs.length < GROUP_SAMPLE_LOCATIONS && !locs.includes(loc)) locs.push(loc);
      // The DISPLAY sample above is capped; the count below is not, or a role
      // genuinely spread across 13 sites would read "6 more locations".
      if (loc) locSets.get(key)?.add(loc);
      hit.locationCount = locSets.get(key)?.size ?? 1;
      continue;
    }
    const row = { ...r, postingCount: 1, locationCount: 1, otherLocations: [] as string[] };
    const leadLoc = typeof r.location === "string" ? r.location.trim() : "";
    locSets.set(key, new Set(leadLoc ? [leadLoc] : []));
    byKey.set(key, row);
    out.push(row);
  }
  // Only surface the grouping fields when there is actually a group.
  for (const row of out) {
    if ((Number(row.postingCount) || 1) < 2) {
      delete row.postingCount;
      delete row.locationCount;
      delete row.otherLocations;
    }
  }
  return { jobs: out, rawConsumed };
}

// One employer, several feed tokens (PwC ships five Workday sub-sites; 76 such
// employers in the top 1,500 alone, 43k postings). Serving the facet raw put
// "PwC" in the company dropdown five times, each filtering to a fifth of the
// real roles. Merge by display name: one row, counts summed, every token
// carried so the filter can cover them all. The primary token is the largest
// sub-board's (stable for links).
export function mergeCompanyFacet(rows: Array<{ token?: string; name?: string; count?: number }>): Array<{ token?: string; name?: string; count?: number; tokens?: string[] }> {
  const byName = new Map<string, { token?: string; name?: string; count: number; tokens: string[]; top: number }>();
  const out: Array<{ token?: string; name?: string; count?: number; tokens?: string[] }> = [];
  for (const r of rows) {
    // NAME ALONE IS NOT AN IDENTITY. Two unrelated companies can share one:
    // measured 2026-08-23, the Greenhouse fintech "Flex" (9 postings) and the
    // Workday manufacturer "Flex" (572, token flextronics~wd1~Careers) became
    // ONE dropdown entry with zero title overlap — 52 names, 4,575 postings in
    // that state. The tenant stem (the token's first ~-segment) is the tell:
    // PwC's five sub-sites all stem "pwc" and keep folding; the two Flexes
    // stem "flex" vs "flextronics" and stay apart. The failure directions are
    // not symmetric — an unmerged pair shows a name twice and each row still
    // filters correctly, while a wrong merge hands one company's filter the
    // other company's jobs — so ambiguity resolves toward NOT merging.
    const stem = (r.token ?? "").split("~")[0].trim().toLowerCase();
    const nm = (r.name ?? "").trim().toLowerCase();
    // A nameless row has nothing to merge ON — pass it through untouched, as
    // the name-only key always did (the compound key is never empty, so the
    // old falsy check would silently stop firing here).
    if (!nm) { out.push(r); continue; }
    const key = nm + "|" + stem;
    const hit = byName.get(key);
    const n = r.count ?? 0;
    if (!hit) {
      byName.set(key, { token: r.token, name: r.name, count: n, tokens: r.token ? [r.token] : [], top: n });
    } else {
      hit.count += n;
      if (r.token) hit.tokens.push(r.token);
      if (n > hit.top) { hit.top = n; hit.token = r.token; }
    }
  }
  for (const v of byName.values()) {
    out.push(v.tokens.length > 1 ? { token: v.token, name: v.name, count: v.count, tokens: v.tokens } : { token: v.token, name: v.name, count: v.count });
  }
  return out;
}
