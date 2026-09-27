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
// rippling joined 2026-08-24: NO_DESC_SOURCES was measured against the LIST
// page only (client-rendered, no JD — still true). The per-posting API the
// posted-date backfill already calls serves description.{company,role} on
// every probed posting; ~7-9k rows, 100% null until now. Appended LAST so it
// queues behind breezy rather than ahead of it.
// paylocity joined 2026-08-30, the day the vendor landed: its list payload
// truncates every description to a ~110-char teaser, and leaving it out of
// all three lists is the exact icims/breezy hole this file's header documents
// (rows null forever, unswept and undecided). Appended LAST so it queues
// behind rippling.
// adp joined 2026-08-31, the day ITS vendor landed, for the plainer version
// of the same measurement: the list payload carries no description field at
// all, and the same public endpoint's per-requisition detail serves the full
// HTML JD (6,928 chars on the sampled posting). Appended LAST so it queues
// behind paylocity.
// ukg joined 2026-09-01 with the vendor: its list ships a BriefDescription
// summary while the detail page carries the full JD (4,794 chars on the
// probed posting) plus structured pay, so the summary is deliberately not
// stored and the sweep fills the real text. Appended LAST, behind paylocity.
// jazzhr joined 2026-09-04 with the vendor: its list is an HTML career page
// carrying no description and no date, and the posting page carries both —
// a JSON-LD JobPosting on 5 of 8 probed boards (5-17k chars of description,
// datePosted) and a #job-description container on all 8. Appended LAST,
// behind ukg, under the same append-last rule.
export const DETAIL_DESC_SOURCES = ["workday", "smartrecruiters", "bamboohr", "oracle", "breezy", "rippling", "paylocity", "adp", "ukg", "jazzhr"] as const;

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
export const NO_DESC_SOURCES = [] as const;

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
 * The employer's own pay, as the MonetaryAmount that rides beside the
 * description in the SAME schema.org node. Every field is the vendor's, read
 * and not interpreted: no figure is derived here and no period is guessed.
 *
 * `point` is the node's single `value`. It is a BOUND, not a range — a posting
 * that states one figure states one figure, and rendering it as min==max would
 * invent a ceiling the employer did not type.
 *
 * `unitText` is the employer's own period label and is MEASURABLY WRONG on live
 * rows, which is why it is carried through raw for a magnitude cross-check
 * rather than trusted. See ldBaseSalaryText in normalize.ts for the refusals.
 */
export interface LdBaseSalary {
  /** ISO code exactly as the MonetaryAmount states it; null when it states none. */
  currency: string | null;
  min: number | null;
  max: number | null;
  /** The node's single `value` — one bound, never half of a range. */
  point: number | null;
  /** HOUR | DAY | WEEK | MONTH | YEAR as the employer typed it, upper-cased. */
  unitText: string | null;
}

/**
 * BOTH halves of a page's schema.org JobPosting node: the description we have
 * always read, and the pay we downloaded and threw away for over a year.
 *
 * Breezy renders its posting body client-side — the /json list has no
 * description field at all — but it emits this block for Google Jobs. Pages
 * carry MORE THAN ONE ld+json script (a WebSite node comes first), so every node
 * has to be checked; taking only the first one finds nothing.
 *
 * WHY ONE READER AND NOT TWO. The description half of this walk is the only
 * description source Breezy and Paylocity have, and its predicate is exact:
 * the FIRST node whose type is a job posting and whose description is longer
 * than a teaser wins. A second function repeating that predicate to fetch the
 * pay would be a second copy of it, free to drift — and the pay must come from
 * the node the description came from, or the two halves describe different
 * requisitions. So the predicate stays in one place and returns both halves;
 * the description value returned is the same object property it always was, and
 * the existing description cases assert it unchanged.
 *
 * A node with no MonetaryAmount, or one carrying no positive figure at all,
 * yields pay: null. Measured over 356 captured live pages (240 Paylocity + 60
 * Breezy + 90 Paylocity, 2026-09-26/27): 186 have a usable description and no
 * pay node, and 0 have a pay node that is present but figureless — so the
 * common case is "description only" and it must cost the description nothing.
 */
export function jobPostingLd(html: string): { description: string | null; pay: LdBaseSalary | null } {
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
      const n = node as { "@type"?: unknown; description?: unknown; baseSalary?: unknown } | null;
      if (n && n["@type"] === "JobPosting" && typeof n.description === "string" && n.description.length > 100) {
        return { description: n.description, pay: ldBaseSalary(n.baseSalary) };
      }
    }
  }
  return { description: null, pay: null };
}

/** The MonetaryAmount's figures, unchanged. Null when there is nothing to read. */
function ldBaseSalary(raw: unknown): LdBaseSalary | null {
  if (!raw || typeof raw !== "object") return null;
  const bs = raw as { currency?: unknown; value?: unknown };
  const v = bs.value;
  if (!v || typeof v !== "object") return null;
  const q = v as { minValue?: unknown; maxValue?: unknown; value?: unknown; unitText?: unknown };
  // A figure arrives as a JSON number on every vendor measured (127 of 127 live
  // nodes); a numeric string is accepted because the cost of doing so is one
  // Number() and the cost of not doing so is a silently unread field. Zero and
  // negatives are "the field exists and this posting states nothing" — never
  // rendered.
  //
  // A COMMA IN A NUMBER-STRING IS REFUSED, NEVER STRIPPED. This used to read
  // `Number(x.replace(/,/g, ""))`, which decided that every comma is a thousands
  // group — the exact decision the comma-decimal fix in _shared/salary-extract.ts
  // exists to undo. A vendor emitting `"1,50"` with unitText HOUR would have
  // yielded 150, and a EUR 1.50 figure would have been published as a EUR 150.00
  // per hour rate that annualises to 312,000. The type is the vendor's to change
  // and nothing here would have noticed, so the predicate is the strict one the
  // Personio reader already uses: digits, optionally one dot, nothing else. A
  // comma-bearing string is a question this reader declines to answer.
  const num = (x: unknown): number | null => {
    if (typeof x === "number") return Number.isFinite(x) && x > 0 ? x : null;
    const s = typeof x === "string" ? x.trim() : "";
    if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const min = num(q.minValue);
  const max = num(q.maxValue);
  const point = num(q.value);
  if (min === null && max === null && point === null) return null;
  const cur = typeof bs.currency === "string" && bs.currency.trim() ? bs.currency.trim().toUpperCase() : null;
  const unit = typeof q.unitText === "string" && q.unitText.trim() ? q.unitText.trim().toUpperCase() : null;
  return { currency: cur, min, max, point, unitText: unit };
}
