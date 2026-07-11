// Saved-search plumbing shared by the board (save) and Account (reopen).
// Pure — unit tested.

export interface JobSearchParams {
  q?: string;
  category?: string;
  location?: string;
  remote?: boolean;
  company?: string;
}

/** Human name for a saved search, e.g. "nurse · Healthcare & Clinical · remote". */
export function searchName(p: JobSearchParams, categoryLabel?: string): string {
  return (
    [p.q, categoryLabel ?? p.category, p.location, p.remote ? "remote" : "", p.company]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join(" · ") || "All jobs"
  );
}

/** /jobs?… query string for a saved search (matches the board's URL sync). */
export function searchToQuery(p: JobSearchParams): string {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.location) qs.set("location", p.location);
  if (p.remote) qs.set("remote", "1");
  if (p.company) qs.set("company", p.company);
  if (p.category) qs.set("category", p.category);
  const s = qs.toString();
  return s ? `/jobs?${s}` : "/jobs";
}
