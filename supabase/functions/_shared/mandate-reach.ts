// How far a mandate reaches: ... docs/shared-notes.md#s87

// The board's clamp, not a ... docs/shared-notes.md#s88
export function clampAge(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 30) : null;
}

/** The subset of a PostgREST builder these rules touch. */
export interface Filterable {
  // deno-lint-ignore no-explicit-any
  eq(col: string, v: any): this;
  // deno-lint-ignore no-explicit-any
  in(col: string, v: any[]): this;
  // deno-lint-ignore no-explicit-any
  gte(col: string, v: any): this;
  // deno-lint-ignore no-explicit-any
  is(col: string, v: any): this;
}

// The two fences every read ... docs/shared-notes.md#s89
export function applyServingFences<T extends Filterable>(qb: T, now: number = Date.now()): T {
  return qb
    .is("missing_since", null)
    .gte("effective_posted", new Date(now - 30 * 86_400_000).toISOString());
}

// The category filter, and the ... docs/shared-notes.md#s90
export function applyCategory<T extends Filterable>(
  qb: T,
  m: { category: string; include_uncategorised?: boolean | null },
): T {
  if (!m.category) return qb;                     // "any field" already includes other
  if (m.category === "other") return qb.eq("category", "other");
  return m.include_uncategorised === true
    ? qb.in("category", [m.category, "other"])
    : qb.eq("category", m.category);
}

// The posting-age floor, on the ... docs/shared-notes.md#s91
export function applyMaxAge<T extends Filterable>(
  qb: T,
  m: { max_age_days?: number | null },
  now: number = Date.now(),
): T {
  const days = clampAge(m.max_age_days);
  if (days === null) return qb;
  return qb.gte("posted_at", new Date(now - days * 86_400_000).toISOString());
}

// WHICH COUNTRIES THE AGENT MAY ... docs/shared-notes.md#s92
export function parseCountries(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))
    // Deduped: `in.(DE,DE)` is harmless but ... docs/shared-notes.md#s93
    .filter((c, i, all) => all.indexOf(c) === i)
    // Same bound as splitTerms uses ... docs/shared-notes.md#s94
    .slice(0, 12);
}

export function applyCountries<T extends Filterable>(
  qb: T,
  m: { countries?: string | null },
): T {
  const codes = parseCountries(m.countries);
  return codes.length ? qb.in("country", codes) : qb;
}

// ONE SAVED SEARCH, RUN WITH ... docs/shared-notes.md#s95
export function searchRunRow<
  M extends { countries?: string | null; max_age_days?: number | null; include_uncategorised?: boolean | null },
  S extends {
    id: number; label: string; q: string; category: string; location: string;
    remote_only: boolean; salary_min: number | null; daily_count: number;
    max_age_days?: number | null; include_uncategorised?: boolean | null; countries?: string | null;
  },
>(m: M, s: S): M & {
  q: string; category: string; location: string; remote_only: boolean; salary_min: number | null;
  daily_count: number; search_id: number; search_label: string;
} {
  return {
    ...m,
    q: s.q, category: s.category, location: s.location,
    remote_only: s.remote_only, salary_min: s.salary_min,
    daily_count: s.daily_count,
    max_age_days: s.max_age_days, include_uncategorised: s.include_uncategorised,
    countries: s.countries !== undefined ? s.countries : m.countries,
    search_id: s.id, search_label: s.label,
  };
}
