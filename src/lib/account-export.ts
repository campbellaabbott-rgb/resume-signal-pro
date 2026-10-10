/**
 * "DOWNLOAD ALL MY DATA" (platform sweep L3-14).
 *
 * The export read four tables. It left out what the apply agent sent to
 * employers in the member's name (agent_submissions), the answers it learned,
 * the questions waiting on them, its saved searches, the account's passes, the
 * Shortlist workspace, and the CV files in storage; its scans and tracker
 * rows were the page's first 50 and 100. It now reads every table a member can
 * read by their own id (OWNER_TABLES; a test holds the list equal to the
 * migrations' owner policies), all of each, a page at a time, and lists the
 * CV files under the account's folder.
 */

/** Every table with an owner read policy, the column it is keyed on, and its name in the file. */
export const OWNER_TABLES = [
  { table: "user_scans", key: "user_id", as: "scans" },
  { table: "user_applications", key: "user_id", as: "applications" },
  { table: "user_job_searches", key: "user_id", as: "savedSearches" },
  { table: "user_profiles", key: "user_id", as: "profile" },
  { table: "agent_mandates", key: "user_id", as: "agentMandates" },
  { table: "agent_queue", key: "user_id", as: "agentQueue" },
  { table: "agent_submissions", key: "user_id", as: "agentSubmissions" },
  { table: "agent_learned_answers", key: "user_id", as: "agentLearnedAnswers" },
  { table: "agent_pending_questions", key: "user_id", as: "agentPendingQuestions" },
  { table: "agent_searches", key: "user_id", as: "agentSearches" },
  { table: "agent_passes", key: "user_id", as: "agentPasses" },
  { table: "shortlist_roles", key: "owner_id", as: "shortlistRoles" },
  { table: "shortlist_candidates", key: "owner_id", as: "shortlistCandidates" },
  { table: "shortlist_decisions", key: "owner_id", as: "shortlistDecisions" },
  { table: "shortlist_demographics", key: "owner_id", as: "shortlistDemographics" },
  { table: "shortlist_notices", key: "owner_id", as: "shortlistNotices" },
] as const;

/** Rows per request: PostgREST answers at most this many, so a longer table is paged. */
export const EXPORT_PAGE = 1000;

type Res = { data: unknown[] | null; error: { message: string } | null };
type Query = {
  select: (cols: string) => Query;
  eq: (col: string, v: string) => Query;
  range: (from: number, to: number) => PromiseLike<Res>;
};
export type ExportClient = {
  from: (table: string) => unknown;
  storage: { from: (bucket: string) => { list: (path: string, opts?: Record<string, unknown>) => PromiseLike<Res> } };
};

/** All of one owner's rows in a table, a page at a time. A failed read is named, never silently empty. */
async function readAll(client: ExportClient, table: string, key: string, uid: string): Promise<unknown[] | { error: string }> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += EXPORT_PAGE) {
    const q = client.from(table) as Query;
    const { data, error } = await q.select("*").eq(key, uid).range(from, from + EXPORT_PAGE - 1);
    if (error) return { error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < EXPORT_PAGE) return rows;
  }
}

/** Every record the account can read about itself, plus the names of its stored CV files. */
export async function collectAccountExport(client: ExportClient, uid: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(OWNER_TABLES.map(async ({ table, key, as }) => {
    out[as] = await readAll(client, table, key, uid);
  }));
  const { data: files, error } = await client.storage.from("resumes").list(uid, { limit: 1000 });
  out.cvFiles = error
    ? { error: error.message }
    : (files ?? []).map((f) => {
      const o = f as { name?: string; created_at?: string; updated_at?: string; metadata?: { size?: number } | null };
      return { name: o.name, createdAt: o.created_at ?? null, updatedAt: o.updated_at ?? null, bytes: o.metadata?.size ?? null };
    });
  return out;
}
