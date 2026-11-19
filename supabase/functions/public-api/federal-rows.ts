// A U.S. FEDERAL ROW, AS THE API AND THE CONNECTOR HAND IT ON (OD16, owner
// 2026-11-18: yes).
//
// The board reads USAJOBS, the U.S. Office of Personnel Management's federal
// job site. Its API terms (developer.usajobs.gov/guides/terms-of-service, read
// 2026-11-16 and 2026-11-18) let anyone copy, publish and redistribute the
// public data, with no prior approval, and ask a republisher to name USAJOBS
// as the source, link to the current official announcement, give the date the
// data was retrieved, and say the product is not operated, sponsored,
// approved or endorsed by OPM. Every federal row and every body that carries
// one does those four things, from the constants below.
//
// THREE THINGS A PLAIN ROW WOULD GET WRONG (more-good-jobs 2026-11-18, OD16):
//
//   WHO MAY APPLY. Not every announcement is open to the public: some are for
//   current federal staff ("Temp Promo"), some need Guard membership (Title 32
//   technicians). A row is handed on only once the board has stored the
//   agency's own who-may-apply statement (job-board .104, migration
//   20261119110000); until then it stays withheld, so an assistant never
//   suggests a job the person cannot apply for.
//
//   AGE. USAJOBS re-publishes open-continuous announcements with fresh dates,
//   so the feed's date is not an age. Our own first sighting is not one either
//   (a posting age is the employer's date or nothing), so it is handed on only
//   as on_board_since, "on our board since", and never as an age.
//
//   OPEN. The board does not re-read every federal row on every pass (one
//   query returns at most 10,000), so "still in the employer's own feed" is not
//   a promise we can make of a federal row. It is "open until the agency's
//   closing date", which the announcement states (closes_at).
//
// The hiring agency is the employer: the board stores it in `company`, and
// every federal row shares one board token, the vendor code itself.
//
// ONE FILE, TWO FUNCTIONS. This module imports nothing, and agent-mcp carries
// a byte-identical copy (supabase/functions/agent-mcp/federal-rows.ts): no
// function imports another's folder. The test
// a-federal-row-reaches-the-api-with-its-notice-agency-and-who-may-apply holds
// the two copies equal.

/** The board's vendor code for USAJOBS, and the one board token every federal row carries. */
export const FEDERAL_SOURCE = "usajobs";

/** The non-affiliation notice OPM's terms ask for, in the words shown to the owner with OD16. */
export const OPM_NOTICE = "Not an official copy; resumebooster.work is not operated, sponsored, approved or endorsed by OPM.";

/** USAJOBS named as the source, as OPM's terms ask. */
export const FEDERAL_PUBLISHER = "USAJOBS (U.S. Office of Personnel Management)";

/** The official site, linked beside every federal body. No seal and no logo is ever shown. */
export const FEDERAL_SITE = "https://www.usajobs.gov";

/** The terms the rows are handed on under. */
export const FEDERAL_TERMS_URL = "https://developer.usajobs.gov/guides/terms-of-service";

/** What "open" means for a federal row. */
export const FEDERAL_OPEN_UNTIL = "Open until the agency's closing date (closes_at), unless the agency withdraws it sooner.";

/** Said once beside every body that carries a federal row. */
export const FEDERAL_ROW_NOTE =
  "A U.S. federal job announcement from USAJOBS. The hiring agency is the employer (company). Who may apply is the agency's own statement (who_may_apply): some announcements are open only to current federal staff, veterans or another group. Apply only through the announcement's own instructions at its official link. posted_at is the feed's date, which USAJOBS moves when an announcement is reposted, so it is not the announcement's age; on_board_since is when it first appeared on our board, and is not an age either. Our categories, parsed pay and closed status are our own, not official.";

/** Why a federal posting is not handed on yet. */
export const FEDERAL_UNLABELLED_NOTE =
  "This U.S. federal announcement is not handed on yet: who may apply to it (the public, or only current federal staff, veterans or another group) has not been stored, so it is not suggested. It opens on resumebooster.work and on USAJOBS.";

/**
 * Said beside a 404 for a federal id, which cannot tell a withdrawn
 * announcement from one not handed on yet without a second read: a possibility,
 * never a claim about this id.
 */
export const FEDERAL_NOT_FOUND_NOTE =
  "A U.S. federal announcement that is still open is also absent until the agency's statement of who may apply to it (the public, or only current federal staff, veterans or another group) is stored; meanwhile it opens on resumebooster.work and on USAJOBS.";

/**
 * The row gate in PostgREST's or() syntax: a row that is not federal, or a
 * federal row whose who-may-apply statement is stored.
 */
export const FEDERAL_GATE_OR = `source.neq.${FEDERAL_SOURCE},who_may_apply.not.is.null`;

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/** A row from USAJOBS. */
export function isFederal(source: unknown): boolean {
  return norm(source) === FEDERAL_SOURCE;
}

/** The vendor a posting id names (its first segment). */
export function vendorOfPostingId(id: unknown): string {
  return norm(String(id ?? "").split(":")[0]);
}

/** The agency's who-may-apply statement as stored (text, or an object with a Name), or null. */
export function whoMayApplyOf(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const name = o.Name ?? o.name ?? o.text;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }
  return null;
}

/** The announcement's hiring paths as stored (an array, or a comma list), or null. */
export function hiringPathsOf(v: unknown): string[] | null {
  const raw: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out = raw
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? (x as Record<string, unknown>).Name ?? (x as Record<string, unknown>).name : null))
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((x) => x.trim());
  return out.length ? [...new Set(out)] : null;
}

/** True when a row may be handed on as far as this gate goes: not federal, or federal with who-may-apply stored. */
export function passesFederalGate(source: unknown, whoMayApply: unknown): boolean {
  return !isFederal(source) || whoMayApplyOf(whoMayApply) !== null;
}

/**
 * The current official announcement: USAJOBS's own page for the control
 * number the id carries, or the stored link when it is on USAJOBS. Null
 * when neither is (no other host is ever called official).
 */
export function officialUrlOf(id: unknown, applyUrl: unknown): string | null {
  const ext = String(id ?? "").split(":").slice(2).join(":").trim();
  if (/^\d{4,12}$/.test(ext)) return `${FEDERAL_SITE}/job/${ext}`;
  if (typeof applyUrl === "string") {
    try {
      const u = new URL(applyUrl);
      if (u.protocol === "https:" && (u.hostname === "www.usajobs.gov" || u.hostname === "usajobs.gov")) return applyUrl;
    } catch { /* not a URL */ }
  }
  return null;
}

/** An ISO stamp, or null. */
const isoOrNull = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;

export interface FederalFacts {
  /** The hiring agency, credited as the employer. */
  agency: string | null;
  whoMayApply: string;
  hiringPaths: string[] | null;
  /** The closing date the agency states. */
  closesAt: string | null;
  /** When the announcement first appeared on our board: never an age. */
  onBoardSince: string | null;
  officialUrl: string | null;
  openUntil: string;
  notice: string;
}

/** What a federal row carries, or null when it is not federal or not labelled (and so is not handed on). */
export function federalFacts(input: {
  id: unknown; source: unknown; company: unknown; whoMayApply: unknown; hiringPaths: unknown;
  closesAt: unknown; firstSeen: unknown; applyUrl: unknown;
}): FederalFacts | null {
  if (!isFederal(input.source)) return null;
  const who = whoMayApplyOf(input.whoMayApply);
  if (who === null) return null;
  const agency = typeof input.company === "string" && input.company.trim() ? input.company.trim() : null;
  return {
    agency: agency && norm(agency) !== FEDERAL_SOURCE ? agency : null,
    whoMayApply: who,
    hiringPaths: hiringPathsOf(input.hiringPaths),
    closesAt: isoOrNull(input.closesAt),
    onBoardSince: isoOrNull(input.firstSeen),
    officialUrl: officialUrlOf(input.id, input.applyUrl),
    openUntil: FEDERAL_OPEN_UNTIL,
    notice: OPM_NOTICE,
  };
}

export interface FederalCredit {
  source: string;
  publisher: string;
  notice: string;
  officialSite: string;
  terms: string;
  /** When our board last read the USAJOBS feed, for the rows in this body; null when it could not be read. */
  retrievedAt: string | null;
  retrievedAtBasis: string;
  openUntil: string;
  note: string;
}

/** The credit a body carrying federal rows states once, with the date we retrieved them. */
export function federalCredit(retrievedAt: unknown): FederalCredit {
  return {
    source: FEDERAL_SOURCE,
    publisher: FEDERAL_PUBLISHER,
    notice: OPM_NOTICE,
    officialSite: FEDERAL_SITE,
    terms: FEDERAL_TERMS_URL,
    retrievedAt: isoOrNull(retrievedAt),
    retrievedAtBasis:
      "When our board last read the USAJOBS feed. One read returns at most 10,000 announcements, so it may not have included every announcement here; each stays open until the agency's closing date.",
    openUntil: FEDERAL_OPEN_UNTIL,
    note: FEDERAL_ROW_NOTE,
  };
}

/** The earliest read stamp among the federal rows: the oldest data the body carries. */
export function earliestRead(stamps: readonly unknown[]): string | null {
  const ok = stamps.map(isoOrNull).filter((s): s is string => s !== null).sort((a, b) => Date.parse(a) - Date.parse(b));
  return ok[0] ?? null;
}
