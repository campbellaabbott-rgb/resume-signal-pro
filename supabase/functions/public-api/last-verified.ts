/**
 * WHEN THE EMPLOYER'S FEED LAST LISTED A POSTING, NOT WHEN WE FIRST SAW IT
 * (sweep S12-121).
 *
 * /v1 published `last_seen`, which job-board writes once, at insert, and never
 * again: it is the discovery time under another name (job-board's own row
 * writer says so). A customer filtering on it for freshness dropped every
 * long-lived posting that is still live. The stamp that moves is the board's
 * verification row (job_board_verifications), written each time an employer's
 * feed is read; a posting /v1 serves has missing_since IS NULL, so the latest
 * read still listed it. That stamp is published as `last_verified_at`, and
 * `last_seen` now carries the same value, which is what its name always
 * claimed. Null when no stamp is known or the read failed: never the insert
 * time.
 *
 * KEYED AS job-board KEYS IT. A board on a token that several boards share
 * stamps its own key, `<source>:<token>`, and the bare token too; every other
 * board stamps the bare token. The board key, where one exists, wins.
 *
 * THE SAME READ NAMES AN EMPLOYER THE BOARD HAS NEVER READ (sweep S12-040):
 * a company_token with no verification row at all is not one the board
 * carries (or one it has never managed to read), so an empty page for it is
 * not that employer's hiring.
 *
 * Pure apart from the injected client, so the Node suite runs it on a fake.
 */

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

/** Keys per read: job-board reads at most 80 a call, and a URL of 200 long Workday tokens is too long. */
const KEYS_PER_READ = 80;
const READ_DEADLINE_MS = 1_500;

const keyOf = (source: unknown, token: unknown) => `${String(source ?? "")}:${String(token ?? "")}`;

/** verified_at by company_token key, or null when the read failed or ran out of time. */
async function stampsFor(client: Db, keys: readonly string[]): Promise<Map<string, string> | null> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return new Map();
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += KEYS_PER_READ) chunks.push(unique.slice(i, i + KEYS_PER_READ));
  const read = Promise.all(chunks.map(async (chunk) => {
    const { data, error } = await client.from("job_board_verifications").select("company_token,verified_at").in("company_token", chunk);
    if (error || !Array.isArray(data)) throw new Error(String(error?.message ?? "not an array"));
    return data as Array<{ company_token?: unknown; verified_at?: unknown }>;
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), READ_DEADLINE_MS); });
  try {
    const rows = await Promise.race([read, deadline]);
    if (!rows) return null;
    const out = new Map<string, string>();
    for (const r of rows.flat()) {
      if (typeof r.company_token === "string" && typeof r.verified_at === "string") out.set(r.company_token, r.verified_at);
    }
    return out;
  } catch (e) {
    console.warn("[PUBLIC-API] verification stamps unavailable:", String((e as Error)?.message ?? e).slice(0, 120));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Set `last_verified_at` and `last_seen` on every row (in place) from its
 * board's verification stamp; null where none is known. Rows carry `source`
 * and `company_token`, as JOB_FIELDS selects them.
 */
export async function attachLastVerified(client: Db, rows: Array<Record<string, unknown>>): Promise<void> {
  const keys: string[] = [];
  for (const r of rows) {
    if (!r.company_token) continue;
    keys.push(String(r.company_token), keyOf(r.source, r.company_token));
  }
  const stamps = keys.length ? await stampsFor(client, keys) : new Map<string, string>();
  for (const r of rows) {
    const at = stamps?.get(keyOf(r.source, r.company_token)) ?? stamps?.get(String(r.company_token ?? "")) ?? null;
    r.last_verified_at = at;
    r.last_seen = at;
  }
}

/**
 * The company_tokens of a scope the board has never read (no verification
 * row), or null when the read failed. Asked only for an empty page, so a
 * populated page costs nothing.
 */
export async function neverReadTokens(client: Db, tokens: readonly string[]): Promise<string[] | null> {
  if (!tokens.length) return [];
  const stamps = await stampsFor(client, tokens);
  if (!stamps) return null;
  return [...new Set(tokens)].filter((t) => !stamps.has(t));
}
