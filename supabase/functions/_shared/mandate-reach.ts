export function clampAge(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 30) : null;
}
export interface Filterable {
  eq(col: string, v: any): this;
  in(col: string, v: any[]): this;
  gte(col: string, v: any): this;
  is(col: string, v: any): this;
}
export function applyServingFences<T extends Filterable>(qb: T, now: number = Date.now()): T {
  return qb
    .is("missing_since", null)
    .gte("effective_posted", new Date(now - 30 * 86_400_000).toISOString());
}
export function applyCategory<T extends Filterable>(
  qb: T,
  m: { category: string; include_uncategorised?: boolean | null },
): T {
  if (!m.category) return qb;
  if (m.category === "other") return qb.eq("category", "other");
  return m.include_uncategorised === true
    ? qb.in("category", [m.category, "other"])
    : qb.eq("category", m.category);
}
export function applyMaxAge<T extends Filterable>(
  qb: T,
  m: { max_age_days?: number | null },
  now: number = Date.now(),
): T {
  const days = clampAge(m.max_age_days);
  if (days === null) return qb;
  return qb.gte("posted_at", new Date(now - days * 86_400_000).toISOString());
}
export function parseCountries(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))
    .filter((c, i, all) => all.indexOf(c) === i)
    .slice(0, 12);
}
export function applyCountries<T extends Filterable>(
  qb: T,
  m: { countries?: string | null },
): T {
  const codes = parseCountries(m.countries);
  return codes.length ? qb.in("country", codes) : qb;
}
