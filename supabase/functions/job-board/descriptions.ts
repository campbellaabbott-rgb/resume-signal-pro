// Rationale: docs/job-board-index-notes.md#n1292-vendors-whose-description-needs-a-per

/** Vendors whose description needs a per-posting fetch (the backfill sweep's scope). */
// Rationale: docs/job-board-index-notes.md#n1293-export-const-detail_desc_sources-workday
export const DETAIL_DESC_SOURCES = ["workday", "smartrecruiters", "bamboohr", "oracle", "breezy", "rippling", "paylocity", "adp", "ukg", "jazzhr"] as const;

// Rationale: docs/job-board-index-notes.md#n1294-export-const-board_desc_sources-workable
export const BOARD_DESC_SOURCES = ["workable", "pinpoint", "icims"] as const;

// Rationale: docs/job-board-index-notes.md#n1295-export-const-no_desc_sources-as-const
export const NO_DESC_SOURCES = [] as const;

// Rationale: docs/job-board-index-notes.md#n1296-export-function-buildembedinput
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

// Rationale: docs/job-board-index-notes.md#n1297-export-function-clusterkey-companykey-st
export function clusterKey(companyKey: string, title: string, location?: string | null): string {
  // Rationale: docs/job-board-index-notes.md#n1298-const-companykey0-companykey-tolowercase
  const companyKey0 = (companyKey || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const placeWords = qualifierWords(location ?? "");
  const t = (title || "")
    .toLowerCase()
    // Rationale: docs/job-board-index-notes.md#n1299-replace-g-_m-inner-string-qualifierisnoi
    .replace(/[([{]([^)\]}]*)[)\]}]/g, (_m, inner: string) => (qualifierIsNoise(inner, placeWords) ? " " : ` ${inner} `))
    // requisition ids: R12345, JR-9620, #2025-031054
    .replace(/#?\b(?:jr|r|req|job)?[-\s]?\d[\d-]{3,}\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // A title that normalises to nothing is never folded with another: it keys
  // on its own spelling.
  return t === "" ? `${companyKey0} \u0001${(title || "").trim().toLowerCase()}` : `${companyKey0} ${t}`;
}

/** Lower-cased, accents dropped, so "Montréal" in a title matches "Montreal" in a location. */
const foldQualifier = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "");
/** Words a bracket may hold and still only say WHERE or HOW the job is worked. */
const WORK_MODE_WORDS = new Set(["remote", "hybrid", "onsite", "on", "site", "in", "office", "virtual", "telecommute", "wfh", "home", "work", "from"]);

/** The words of a location, as a bracket's words are compared against them. */
function qualifierWords(location: string): Set<string> {
  return new Set(foldQualifier(location).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2));
}

// Rationale: docs/job-board-index-notes.md#n1300-function-qualifierisnoise-inner-string-p
function qualifierIsNoise(inner: string, placeWords: ReadonlySet<string>): boolean {
  const s = foldQualifier(inner).trim();
  if (!s) return true;
  if (/\d{3,}/.test(s) || /#\s*\d/.test(s)) return true;
  const words = s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  if (words.length === 0) return false;
  return words.every((w) => placeWords.has(w) || WORK_MODE_WORDS.has(w));
}

// Rationale: docs/job-board-index-notes.md#n1301-export-function-workdaycxsurl-applyurl-s
export function workdayCxsUrl(applyUrl: string): string | null {
  const m = (applyUrl || "").match(
    /^https:\/\/([a-z0-9][a-z0-9-]*)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?([^/?#]+)(\/job\/[^?#]+)/i,
  );
  if (!m) return null;
  const [, tenant, wd, site, path] = m;
  return `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${path}`;
}

// Rationale: docs/job-board-index-notes.md#n1302-export-interface-ldbasesalary
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

// Rationale: docs/job-board-index-notes.md#n1303-export-function-jobpostingld-html-string
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
  // Rationale: docs/job-board-index-notes.md#n1304-const-num-x-unknown-number-null
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
