/**
 * /v1 QUERY-STRING NUMBERS AND DATES, PARSED OR REFUSED — never dropped.
 *
 * Pure and import-free, so the Node test suite can call it and the Deno
 * function imports it unchanged. Each parser answers `null` for an absent (or
 * empty) parameter, a value, or `{ invalid: message }` that the endpoint turns
 * into its 400 invalid_value.
 *
 *   intParam  (register 1.69 / L9-24). limit and offset were clamped
 *             numerically and never made integers, so `limit=1.5` reached
 *             PostgREST as `limit=1.5`, which it ignores: the page came back
 *             uncapped (up to max-rows, descriptions included, for one metered
 *             call), page.nextCursor was null because rows.length !== 1.5, and
 *             /v1/changes reported hasMore:false over a window that was not
 *             drained. max_years binds a smallint and answered 2.5 with a 500.
 *   numParam  (L9-12). salary_min=100k failed Number(), bound nothing, and
 *             came back 200 with the unfiltered page and its total.
 *   isoParam  (L9-12, 2.26). posted_after=last-week was dropped silently, and
 *             posted_after=2026-09 passed Date.parse and reached a timestamptz
 *             the board refuses. Returned normalised to a full ISO timestamp.
 */
export type Parsed<T> = T | null | { invalid: string };

export const isInvalid = <T>(v: Parsed<T>): v is { invalid: string } =>
  typeof v === "object" && v !== null && "invalid" in (v as object);

export function intParam(p: URLSearchParams, name: string): Parsed<number> {
  const raw = p.get(name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return { invalid: `${name} must be a whole number, got "${raw}".` };
  return n;
}

export function numParam(p: URLSearchParams, name: string): Parsed<number> {
  const raw = p.get(name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return { invalid: `${name} must be a number of 0 or more (annual, USD-equivalent), got "${raw}".` };
  }
  return n;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function isoParam(p: URLSearchParams, name: string): Parsed<string> {
  const raw = p.get(name);
  if (raw === null || raw.trim() === "") return null;
  const s = raw.trim();
  if (!ISO_DATE.test(s) || !Number.isFinite(Date.parse(s))) {
    return { invalid: `${name} must be an ISO date such as 2026-09-01 (or a full ISO timestamp), got "${raw}".` };
  }
  return new Date(s).toISOString();
}

/** Seconds until the daily quota resets: it is counted per UTC day (L9-18). */
export function secondsToMidnightUtc(now: number = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}
