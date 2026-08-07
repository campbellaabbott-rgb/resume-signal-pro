/**
 * How far a mandate reaches: posting age, and whether the uncategorised bucket
 * is in scope.
 *
 * IN _shared RATHER THAN IN agent-runner, and for one reason: agent-runner
 * imports from `https://deno.land/...`, so a vitest suite cannot import it at
 * all — the Node ESM loader refuses an https specifier. Every test of that file
 * is therefore a regex over its source text, which can check that a line exists
 * and can never check what it does.
 *
 * These two rules are worth more than that. `applyCategory` decides whether a
 * subscriber sees 27.6% of the board, and `applyMaxAge` is the difference
 * between "posted this week" and "we noticed it this week" — a distinction this
 * codebase has already published a false public statistic by blurring. Pure,
 * dependency-free, and directly executable by a test.
 */

/**
 * The board's clamp, not a second opinion about it.
 *
 * job-board's filters.ts: `Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : null`.
 * Two definitions of "how fresh is fresh" over one corpus is how two surfaces
 * start disagreeing about the same posting.
 */
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
}

/**
 * The category filter, and the bucket it used to remove without saying so.
 *
 * `other` is not a junk drawer — it is where a posting lands when the title
 * classifier could not place it, which happens to ordinary engineering,
 * operations and healthcare roles all day. It held 162,800 of 590,808 postings
 * on 2026-08-05, so `.eq("category", …)` cost a subscriber 27.6% of the board
 * the moment they chose a field, invisibly, and the symptom was a thin morning
 * queue with no explanation anywhere.
 *
 * OPT-IN, and off is the old behaviour exactly. `other` genuinely does mix
 * fields, so widening it for everybody would put warehouse roles in an
 * engineering queue. Alongside title terms it costs almost nothing, because
 * then the title filter is doing the work and the category filter can only ever
 * REMOVE postings whose title already matched — which is what the UI says.
 *
 * Absent or null behaves as false, which is what lets the runner deploy before
 * the migration that adds the column.
 */
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

/**
 * The posting-age floor, on the date the EMPLOYER stated.
 *
 * Distinct from the runner's 36-hour `first_seen` lookback, which is about when
 * WE saw a posting. A feed routinely surfaces a role posted five months ago and
 * it arrived in the queue as today's find.
 *
 * Undated postings fall outside this because `gte` cannot be satisfied by NULL.
 * That exclusion is deliberate and is exactly what the board does: "posted
 * within 7 days" is not a claim available about a posting carrying no date, and
 * we never substitute a guess for one.
 */
export function applyMaxAge<T extends Filterable>(
  qb: T,
  m: { max_age_days?: number | null },
  now: number = Date.now(),
): T {
  const days = clampAge(m.max_age_days);
  if (days === null) return qb;
  return qb.gte("posted_at", new Date(now - days * 86_400_000).toISOString());
}

/**
 * WHICH COUNTRIES THE AGENT MAY APPLY IN — and why `location` could not say it.
 *
 * A mandate matched place by substring on the posting's own location TEXT.
 * Measured against production 2026-08-07:
 *
 *     country = DE          11,511 postings   what the board can express
 *     location ~ "Germany"   7,594            what a mandate could express
 *     location ~ "Berlin"    2,604
 *
 *     country = GB          21,126
 *     location ~ "London"   10,195
 *
 * So a person who wants "anywhere in Germany" had no way to say it: a third of
 * German postings never spell the country in their location line — they say
 * "Berlin" or "Munich, Bavaria" — and naming cities means naming every city or
 * losing the rest. The board has had a normalised `country` column all along
 * and the mandate simply had no field for it. This is that field.
 *
 * ISO-3166-1 alpha-2, VALIDATED, because an unrecognised code must not become a
 * filter. `country.in.(GERMANY)` matches no row, and a mandate that silently
 * matches nothing is indistinguishable from a quiet job market — the exact
 * shape of failure this project keeps writing post-mortems about. Anything that
 * is not two letters is dropped here, and the UI only ever emits codes the
 * board's own facet returned.
 *
 * Absent, null or empty means NO country predicate — every posting stays in
 * scope, which is precisely today's behaviour. That is what lets the runner
 * ship before the migration lands.
 */
export function parseCountries(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))
    // Deduped: `in.(DE,DE)` is harmless but a repeated code in the UI's chips
    // reads as a bug in the thing the person just typed.
    .filter((c, i, all) => all.indexOf(c) === i)
    // Same bound as splitTerms uses for titles and places. Nobody job-hunts in
    // 30 countries, and the URL PostgREST builds has a length limit.
    .slice(0, 12);
}

export function applyCountries<T extends Filterable>(
  qb: T,
  m: { countries?: string | null },
): T {
  const codes = parseCountries(m.countries);
  return codes.length ? qb.in("country", codes) : qb;
}
