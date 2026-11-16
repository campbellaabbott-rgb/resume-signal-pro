/**
 * "DOWNLOAD ALL MY DATA" (platform sweep L3-14).
 *
 * The export read four tables. It left out what the apply agent sent to
 * employers in the member's name (agent_submissions), the answers it learned,
 * the questions waiting on them, its saved searches, the account's passes, the
 * Shortlist workspace, and the CV files in storage; its scans and tracker
 * rows were the page's first 50 and 100. It now reads every table a member can
 * read by their own id (OWNER_TABLES; a test holds the list equal to the
 * migrations' owner policies), all of each, a page at a time, and the CV
 * files under the account's folder: each with a signed link to the file
 * itself (CV_LINK_SECONDS), since the CV is the personal data, not its name.
 *
 * WHAT ONLY THE SERVER CAN READ (S14X-100). The documents made for the
 * account's purchases, the Full Analyses they point to, its Pro grants, API
 * keys (by prefix), key requests, mailbox proofs, writing tool uses, checkout
 * records and the lists its address is on are service-role only, so the
 * browser cannot read them; get-account-data's export action does
 * (collectServerExport). When that call fails, or the function answers without
 * them, the file says so and why, rather than leaving them out silently.
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
  { table: "shortlist_deletions", key: "owner_id", as: "shortlistDeletions" },
] as const;

/** Rows per request: PostgREST answers at most this many, so a longer table is paged. */
export const EXPORT_PAGE = 1000;

/** How long each CV link in the export works: a day, so a forwarded file stops exposing the CV. */
export const CV_LINK_SECONDS = 86_400;

type Res = { data: unknown[] | null; error: { message: string } | null };
type Query = {
  select: (cols: string) => Query;
  eq: (col: string, v: string) => Query;
  range: (from: number, to: number) => PromiseLike<Res>;
};
type Signed = { data: Array<{ path?: string | null; signedUrl?: string | null; error?: string | null }> | null; error: { message: string } | null };
export type ExportClient = {
  from: (table: string) => unknown;
  storage: {
    from: (bucket: string) => {
      list: (path: string, opts?: Record<string, unknown>) => PromiseLike<Res>;
      createSignedUrls: (paths: string[], expiresIn: number) => PromiseLike<Signed>;
    };
  };
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

/** Every record the account can read about itself, plus its stored CV files with a link to each. */
export async function collectAccountExport(client: ExportClient, uid: string, now = Date.now()): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(OWNER_TABLES.map(async ({ table, key, as }) => {
    out[as] = await readAll(client, table, key, uid);
  }));
  const bucket = client.storage.from("resumes");
  const { data: files, error } = await bucket.list(uid, { limit: 1000 });
  if (error) {
    out.cvFiles = { error: error.message };
    return out;
  }
  const rows = (files ?? []).map((f) => f as { name?: string; created_at?: string; updated_at?: string; metadata?: { size?: number } | null });
  // The owner's read policy covers their own folder, so the member signs these themselves.
  const links = new Map<string, string>();
  let linkError: string | null = null;
  if (rows.length) {
    try {
      const { data: signed, error: signErr } = await bucket.createSignedUrls(rows.map((o) => `${uid}/${o.name}`), CV_LINK_SECONDS);
      if (signErr) linkError = signErr.message;
      for (const s of signed ?? []) if (s?.path && s.signedUrl && !s.error) links.set(s.path, s.signedUrl);
    } catch (e) {
      linkError = e instanceof Error ? e.message : String(e);
    }
  }
  const expires = new Date(now + CV_LINK_SECONDS * 1000).toISOString();
  out.cvFiles = rows.map((o) => {
    const url = links.get(`${uid}/${o.name}`) ?? null;
    return {
      name: o.name, createdAt: o.created_at ?? null, updatedAt: o.updated_at ?? null, bytes: o.metadata?.size ?? null,
      downloadUrl: url,
      downloadUrlExpiresAt: url ? expires : null,
      ...(url ? {} : { downloadError: linkError ?? "no link was issued for this file" }),
    };
  });
  return out;
}

/** The server's records for the file, or why they are not in it. */
export type ServerExport = Record<string, unknown> | { notIncluded: true; reason: string };
type Invoke = (fn: string, opts: { body: unknown }) => PromiseLike<{ data: unknown; error: unknown }>;

/** The rows only the server can read about the account (get-account-data, action "export"). */
export async function collectServerExport(invoke: Invoke): Promise<ServerExport> {
  try {
    const { data, error } = await invoke("get-account-data", { body: { action: "export" } });
    if (error) return { notIncluded: true, reason: "the server could not be asked for them; download again in a minute" };
    const records = (data as { serverRecords?: unknown } | null)?.serverRecords;
    if (!records || typeof records !== "object" || Array.isArray(records)) {
      return { notIncluded: true, reason: "the server did not send them; download again later" };
    }
    return records as Record<string, unknown>;
  } catch {
    return { notIncluded: true, reason: "the server could not be reached; download again in a minute" };
  }
}
