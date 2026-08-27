// Saved-search plumbing shared by the board (save) and Account (reopen).
// Pure — unit tested.
//
// THIS SHAPE MUST COVER WHAT THE BOARD ACTUALLY SAVES. It knew seven fields
// while saveCurrentSearch was already storing work mode, country, the freshness
// window, agent-only and the uncategorised toggle — so reopening a saved search
// silently dropped them and landed the visitor on a DIFFERENT search from the
// one they saved, and two searches differing only by those fields produced the
// same name and looked like duplicates in Account.
//
// The board's own comment at saveCurrentSearch says it plainly: "a saved search
// is a promise to mail THIS query". Reopening has to keep the same promise.

export interface JobSearchParams {
  q?: string;
  category?: string;
  /** Category filter also admits the uncategorised bucket (~27% of the board). */
  includeUncategorised?: boolean;
  location?: string;
  remote?: boolean;
  /** Comma-joined subset of remote|hybrid|onsite. A LIST since 2026-08-27. */
  workMode?: string;
  company?: string;
  /** ISO-2, comma-joined for a multi-country selection. */
  country?: string;
  /** Experience band: entry | mid | senior | expert (from job-board/experience.ts). */
  experience?: string;
  /** Annualized floor on the posting's own stated pay (no currency conversion). */
  salaryFloor?: number;
  /** Freshness window in days, as the digest forwards it. */
  maxAgeDays?: number;
  /** Only postings the apply agent can submit on. */
  sendableOnly?: boolean;
}

const MODE_LABEL: Record<string, string> = {
  remote: "remote", hybrid: "hybrid", onsite: "on-site",
};

/** Human name for a saved search, e.g. "nurse · Healthcare & Clinical · remote". */
export function searchName(p: JobSearchParams, categoryLabel?: string, experienceLabel?: string): string {
  // EVERY DISTINGUISHING FIELD, or two different searches get one name. Saving
  // "engineer, US, remote" and then "engineer, DE, on-site" both produced
  // "engineer", so the second read as a duplicate of the first and the visitor
  // could not tell their alerts apart.
  const modes = (p.workMode ?? "")
    .split(",").map((m) => m.trim()).filter(Boolean)
    .map((m) => MODE_LABEL[m] ?? m).join("/");
  return (
    [
      p.q,
      categoryLabel ?? p.category,
      experienceLabel ?? p.experience,
      p.location,
      p.country,
      modes || (p.remote ? "remote" : ""),
      p.company,
      p.salaryFloor ? `$${Math.round(p.salaryFloor / 1000)}k+` : "",
      p.maxAgeDays ? `last ${p.maxAgeDays}d` : "",
      p.sendableOnly ? "agent-ready" : "",
    ]
      .map((s) => (s ?? "").toString().trim())
      .filter(Boolean)
      .join(" · ") || "All jobs"
  );
}

/** /jobs?… query string for a saved search (matches the board's URL sync). */
export function searchToQuery(p: JobSearchParams): string {
  // Parameter NAMES are the board's, not this file's: the board reads `mode`
  // for work mode, `inclUncat` and `agentOnly` — spelling them differently here
  // would round-trip to a filter the board never applies.
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.location) qs.set("location", p.location);
  if (p.remote) qs.set("remote", "1");
  if (p.workMode) qs.set("mode", p.workMode);
  if (p.company) qs.set("company", p.company);
  if (p.category) qs.set("category", p.category);
  if (p.category && p.includeUncategorised) qs.set("inclUncat", "1");
  if (p.sendableOnly) qs.set("agentOnly", "1");
  if (p.experience) qs.set("experience", p.experience);
  if (p.country) qs.set("country", p.country);
  if (p.salaryFloor) qs.set("salaryFloor", String(p.salaryFloor));
  // `fresh`, which is what the board reads (Jobs.tsx:925) — not "freshness",
  // and not "maxAgeDays". A saved-search link that spells a parameter the board
  // does not read reopens WITHOUT that filter, silently, which is the whole
  // defect this file had.
  if (p.maxAgeDays) qs.set("fresh", String(p.maxAgeDays));
  const s = qs.toString();
  return s ? `/jobs?${s}` : "/jobs";
}
