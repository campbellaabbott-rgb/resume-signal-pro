/**
 * ONE PAGE OF /v1/companies: ONE ORDER PER WALK, ONE COMPARATOR FOR SORT AND
 * SEEK (register 1.41 / L13-25).
 *
 * The walk skipped most of the directory and could loop forever, for two
 * reasons. The first page (no q, no cursor) was ordered by open postings but
 * issued a cursor holding only its last TOKEN, so page two re-sorted by token
 * and seeked past it — every employer alphabetically before the hundredth-
 * largest one, outside the top hundred, was never returned. And the token sort
 * used localeCompare (case-insensitive first) while the seek used `>` (code
 * units), so a page ending on a mixed-case token seeked backwards and served
 * the same nextCursor again, a quota call each time.
 *
 * Now a walk begun in count order STAYS in count order — its cursor carries
 * (open postings, token), and the seek is the same (count DESC, token ASC)
 * comparison the sort uses — and a q-filtered walk is in token order, with the
 * same plain code-unit comparison on both sides. Counts move between facet
 * refreshes, so a count-order walk spanning a refresh can see an employer
 * twice or not at all; a walk that must be exact passes q=. Neither order can
 * loop: every seek moves strictly forward in a total order.
 *
 * Pure and import-free: the Node test suite walks it, the function imports it.
 */
export type CompanyRow = { token?: string; name?: string; count?: number };

export interface CompanyPageInput<R extends CompanyRow> {
  rows: readonly R[];
  /** Lower-cased substring filter on name or token; empty = the whole directory. */
  term: string;
  /** The decoded cursor ({ep, id}) of the previous page, or null for the first. */
  cursor: { ep: string; id: string } | null;
  limit: number;
  /** The open-postings figure a row is ordered by. */
  countOf: (row: R) => number;
}

export interface CompanyPage<R extends CompanyRow> {
  window: R[];
  matched: number;
  hasMore: boolean;
  countMode: boolean;
  /** {ep, id} for the next page, or null when the walk is done. */
  next: { ep: string; id: string } | null;
}

const COUNT_EP = /^count:(\d+)$/;
const cmpTok = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function companyPage<R extends CompanyRow>(input: CompanyPageInput<R>): CompanyPage<R> {
  const { rows, term, cursor, limit, countOf } = input;
  const countMode = cursor ? COUNT_EP.test(cursor.ep) : !term;
  const tok = (r: R) => String(r.token ?? "");
  const matched = rows
    .filter((c) => !term || String(c.name ?? "").toLowerCase().includes(term) || tok(c).toLowerCase().includes(term))
    .slice()
    .sort((a, b) => countMode
      ? (countOf(b) - countOf(a)) || cmpTok(tok(a), tok(b))
      : cmpTok(tok(a), tok(b)));
  let startAt = 0;
  if (cursor) {
    const seekCount = countMode ? Number(COUNT_EP.exec(cursor.ep)?.[1] ?? 0) : 0;
    startAt = matched.findIndex((c) => {
      if (!countMode) return cmpTok(tok(c), cursor.id) > 0;
      const n = countOf(c);
      return n < seekCount || (n === seekCount && cmpTok(tok(c), cursor.id) > 0);
    });
  }
  const window = startAt < 0 ? [] : matched.slice(startAt, startAt + limit);
  const hasMore = startAt >= 0 && startAt + limit < matched.length;
  const last = window.length ? window[window.length - 1] : null;
  const next = hasMore && last && tok(last)
    ? { ep: countMode ? `count:${countOf(last)}` : "token", id: tok(last) }
    : null;
  return { window, matched: matched.length, hasMore, countMode, next };
}
