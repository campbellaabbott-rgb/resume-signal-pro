/**
 * A SHORTLIST ROLE IS READ BY ITS ROLE, IN PAGES, AND A FAILED READ IS SAID
 * (S14X-075).
 *
 * The page used to read a role's candidates in one request (PostgREST answers
 * at most 1,000 rows) and their decisions with .in() over every candidate id,
 * a URL that outgrows the gateway past about six hundred ids. The decision
 * read then failed, its error was dropped, and an alternative-review
 * candidate was ranked by the AI score it must not be ranked by. Here every
 * read is scoped by the role (decisions through their candidate's role_id),
 * paged with range() until a short page, and answers {rows, error}: a caller
 * shows the error and renders nothing it could not read in full.
 */

export const SHORTLIST_PAGE = 1000;
/** One account holds at most 10,000 evaluations (shortlist-evaluate's cap), so twenty pages read any role. */
const MAX_PAGES = 20;

export type ShortlistRead<T> = { rows: T[]; error: string | null };

type PageResult = { data: unknown; error: { message?: string } | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a supabase-js client or a test double
type Client = { from: (table: string) => any };

/** Every row a query returns, a page at a time, until a short page. */
export async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<ShortlistRead<T>> {
  const rows: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const from = p * SHORTLIST_PAGE;
    let res: PageResult;
    try {
      res = await page(from, from + SHORTLIST_PAGE - 1);
    } catch (e) {
      return { rows, error: e instanceof Error ? e.message : "the read failed" };
    }
    if (res.error) return { rows, error: res.error.message || "the read failed" };
    const list = Array.isArray(res.data) ? (res.data as T[]) : [];
    rows.push(...list);
    if (list.length < SHORTLIST_PAGE) return { rows, error: null };
  }
  return { rows, error: null };
}

/** The columns the ranked list shows; the scored text is read per candidate when it is opened. */
export const CANDIDATE_LIST_COLUMNS =
  "id, file_name, score, flags, signals, interview_questions, level_read, exclusions_applied, status, model_version, created_at, jd_version, jd_text_scored, parsed_fields";

export function readRoleCandidates<T>(client: Client, roleId: string, columns = CANDIDATE_LIST_COLUMNS) {
  return readAllPages<T>((from, to) => client.from("shortlist_candidates").select(columns)
    .eq("role_id", roleId).order("score", { ascending: false }).order("id").range(from, to));
}

/** A role's decisions, through each decision's candidate: no id list ever travels in the URL. */
export function readRoleDecisions<T>(client: Client, roleId: string, actions?: string[]) {
  return readAllPages<T>((from, to) => {
    let q = client.from("shortlist_decisions")
      .select("id, candidate_id, owner_id, actor_email, action, old_value, new_value, reason, created_at, shortlist_candidates!inner(role_id)")
      .eq("shortlist_candidates.role_id", roleId);
    if (actions) q = q.in("action", actions);
    return q.order("created_at").order("id").range(from, to);
  });
}

/** A role's logged notices. select("*"): logged_at and recipients exist only once their migration has applied. */
export function readRoleNotices<T>(client: Client, roleId: string) {
  return readAllPages<T>((from, to) => client.from("shortlist_notices").select("*")
    .eq("role_id", roleId).order("sent_at", { ascending: false }).range(from, to));
}

/** The embedded role filter, dropped before a decision row is shown or exported. */
export function withoutEmbed<T extends Record<string, unknown>>(row: T): Omit<T, "shortlist_candidates"> {
  const { shortlist_candidates: _embed, ...rest } = row;
  return rest;
}
