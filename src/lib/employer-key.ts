/**
 * WHICH BOARDS ARE ONE EMPLOYER: the hiring system plus the board.
 *
 * The mirror of public.employer_segment(text) and public.employer_key(text,
 * text) (migration 20261012100000). Every per-employer read that pools boards
 * pools them under this key and nothing looser, and the pglite test
 * src/test/an-employer-is-named-by-its-hiring-system-and-its-board.test.ts
 * runs both spellings over the whole catalogue and holds them equal.
 *
 * THE SEGMENT is the layoff/LCA matcher's rule (20260918100400, "WHO IS ONE
 * EMPLOYER"): a token's first '~' segment (the tenant on Workday and Oracle,
 * the client id on ADP, the slug itself on every plain-slug vendor), except
 * where that first segment is a vendor path every client shares. UKG tokens
 * are recruiting~CLIENT~uuid and recruiting2~CLIENT~uuid, so their segment is
 * the path plus the client; the EU pods of Greenhouse and Lever are eu~slug,
 * so their segment is the whole token.
 *
 * THE SEGMENT ALONE IS NOT AN EMPLOYER. It does not know the vendor: the
 * Workable board "blackstone" (Blackstone Shooting Sports) and the Workday
 * tenant blackstone~wd1~... (Blackstone Inc.) share the segment "blackstone",
 * and so do the Greenhouse board "costar" (Co-Star, the astrology app) and the
 * Workday tenant costar~wd1~... (CoStar Group). So the key carries the source:
 * `workable:blackstone` and `workday:blackstone` are two employers.
 *
 * NO SOURCE, NO POOLING. A caller that does not know which hiring system a
 * row came from must not pool it with anything: boardIdentity() falls back to
 * the token itself, which is never shared with another board.
 */

/** split_part(s, '~', n) as PostgreSQL computes it: '' past the last field. */
const segment = (token: string, n: number): string => token.split("~")[n - 1] ?? "";

/** public.employer_segment(token), character for character. */
export function employerSegment(token: string): string {
  const first = segment(token, 1);
  if (first === "recruiting" || first === "recruiting2") return `${first}~${segment(token, 2)}`;
  if (first === "eu") return token;
  return first;
}

/** public.employer_key(source, token) = source || ':' || employer_segment(token). */
export function employerKey(source: string, token: string): string {
  return `${source}:${employerSegment(token)}`;
}

/**
 * The key a client cache may pool a board under. With the source known it is
 * the employer key; without it, the token alone (a key no other board can
 * share), so a row of unknown origin is never handed another employer's facts.
 */
export function boardIdentity(source: string | null | undefined, token: string): string {
  return source ? employerKey(source, token) : `?:${token}`;
}

/**
 * Which hiring system a posting came from. Rows carry `source`; a row whose
 * shape predates it still has an id of the form source:token:externalId.
 */
export function postingSource(job: { source?: string | null; id?: string | null }): string | null {
  if (job.source) return job.source;
  const head = typeof job.id === "string" ? job.id.split(":")[0] : "";
  return head && /^[a-z]+$/.test(head) ? head : null;
}
