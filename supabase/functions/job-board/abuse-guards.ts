// Rationale: docs/job-board-index-notes.md#n1347-import-clientaddress-from-_shared-client
import { clientAddress } from "../_shared/client-address.ts";
import { addressKey, exemptKind } from "./anon-budget.ts";

// Rationale: docs/job-board-index-notes.md#n1348-a-request-older-than-this-is

/** A request older than this is dropped unserved: the reader has moved on. */
export const DEMAND_TTL_MS = 20 * 60_000;
/** A board the lane served is not taken again for this long (about one cold lap). */
export const DEMAND_COOLDOWN_MS = 3 * 3_600_000;
/** Boards a cold slice takes from the lane. Was five, every slice. */
export const DEMAND_PER_SLICE = 1;
/** Boards the lane takes in any hour, whoever asks: ~300 slices an hour run, so this is at most 4% of them. */
export const DEMAND_PER_HOUR = 12;
/** Queue length kept (newest). */
export const DEMAND_QUEUE_MAX = 60;
/** The queue's meta row; verify is its only writer. */
export const DEMAND_QUEUE_KEY = "demand";
/** The served stamps' meta row; the refresh is its only writer. */
export const DEMAND_SERVED_KEY = "demand_served";

export type DemandEntry = { t: string; at: number };
export type DemandQueue = { tokens?: DemandEntry[] };
export type DemandServed = { served?: DemandEntry[] };

const entries = (x: unknown): DemandEntry[] =>
  Array.isArray(x)
    ? x.filter((e): e is DemandEntry => !!e && typeof (e as DemandEntry).t === "string" && Number.isFinite((e as DemandEntry).at))
    : [];

const queuedNow = (queue: DemandQueue | null | undefined, now: number): DemandEntry[] =>
  entries(queue?.tokens).filter((e) => now - e.at < DEMAND_TTL_MS);

/** Served stamps still inside the cooldown (the longest window anything reads them for). */
const liveServed = (served: DemandServed | null | undefined, now: number): DemandEntry[] =>
  entries(served?.served).filter((e) => now - e.at < DEMAND_COOLDOWN_MS);

// Rationale: docs/job-board-index-notes.md#n1349-export-function-admitdemand
export function admitDemand(
  queue: DemandQueue | null | undefined,
  served: DemandServed | null | undefined,
  tokens: readonly string[],
  now: number,
): DemandQueue | null {
  const queued = queuedNow(queue, now);
  const have = new Set(queued.map((e) => e.t));
  const cooling = new Set(liveServed(served, now).map((e) => e.t));
  const add = [...new Set(tokens)].filter((t) => !have.has(t) && !cooling.has(t));
  if (!add.length) return null;
  return { tokens: [...queued, ...add.map((t) => ({ t, at: now }))].slice(-DEMAND_QUEUE_MAX) };
}

/** The served row with `take` stamped at `now`: a board already cooling keeps its stamp. Also how a retried write merges onto a fresher read. */
export function recordServed(served: DemandServed | null | undefined, take: readonly string[], now: number): DemandServed {
  const live = liveServed(served, now);
  const have = new Set(live.map((e) => e.t));
  return { served: [...live, ...[...new Set(take)].filter((t) => !have.has(t)).map((t) => ({ t, at: now }))] };
}

// Rationale: docs/job-board-index-notes.md#n1350-export-function-takedemand
export function takeDemand(
  queue: DemandQueue | null | undefined,
  served: DemandServed | null | undefined,
  now: number,
  eligible: (token: string) => boolean,
): { take: string[]; served: DemandServed | null } {
  const live = liveServed(served, now);
  const room = Math.max(0, Math.min(DEMAND_PER_SLICE, DEMAND_PER_HOUR - live.filter((e) => now - e.at < 3_600_000).length));
  const cooling = new Set(live.map((e) => e.t));
  const take = queuedNow(queue, now).filter((e) => !cooling.has(e.t) && eligible(e.t)).slice(0, room).map((e) => e.t);
  return { take, served: take.length ? recordServed(served, take, now) : null };
}

// Rationale: docs/job-board-index-notes.md#n1351-export-function-demandlanestatus
export function demandLaneStatus(
  queue: DemandQueue | null | undefined,
  served: DemandServed | null | undefined,
  now: number,
): Record<string, number> {
  const live = liveServed(served, now);
  const cooling = new Set(live.map((e) => e.t));
  return {
    queued: queuedNow(queue, now).filter((e) => !cooling.has(e.t)).length,
    servedLastHour: live.filter((e) => now - e.at < 3_600_000).length,
    cooling: live.length,
    perSlice: DEMAND_PER_SLICE,
    perHour: DEMAND_PER_HOUR,
    cooldownMin: DEMAND_COOLDOWN_MS / 60_000,
  };
}

/**
 * The database these helpers are handed: the service client, structurally (the
 * Supabase client's builder types do not cross from esm.sh into vitest).
 */
// deno-lint-ignore no-explicit-any
export type MetaDb = { from: (table: string) => any };

/** The demand lane's two rows in one read (.88): the queue verify writes, the served stamps the refresh writes. */
export async function readDemand(client: MetaDb): Promise<{ queue: DemandQueue | null; served: DemandServed | null }> {
  const { data } = await client.from("job_board_meta").select("k, v").in("k", [DEMAND_QUEUE_KEY, DEMAND_SERVED_KEY]);
  const rows = Array.isArray(data) ? data as Array<{ k: string; v: unknown }> : [];
  const v = (k: string) => (rows.find((r) => r.k === k)?.v ?? null) as Record<string, unknown> | null;
  return { queue: v(DEMAND_QUEUE_KEY) as DemandQueue | null, served: v(DEMAND_SERVED_KEY) as DemandServed | null };
}

// Rationale: docs/job-board-index-notes.md#n1352-export-async-function-stampdemandserved
export async function stampDemandServed(client: MetaDb, take: readonly string[], now: number): Promise<void> {
  let last: DemandServed | null = null;
  let read = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error } = await client.from("job_board_meta").select("v, updated_at").eq("k", DEMAND_SERVED_KEY).maybeSingle();
    if (error) break;
    read = true;
    last = (row?.v ?? null) as DemandServed | null;
    const v = recordServed(last, take, now);
    const at = new Date().toISOString();
    if (!row) {
      const { error: insErr } = await client.from("job_board_meta").insert({ k: DEMAND_SERVED_KEY, v, updated_at: at });
      if (!insErr) return;
      if (insErr.code !== "23505") break;
      continue;
    }
    const { data: hit, error: upErr } = await client.from("job_board_meta").update({ v, updated_at: at })
      .eq("k", DEMAND_SERVED_KEY).eq("updated_at", (row as { updated_at: string }).updated_at).select("k");
    if (upErr) break;
    if (Array.isArray(hit) && hit.length === 1) return;
  }
  if (!read) return;
  await Promise.resolve(client.from("job_board_meta").upsert(
    { k: DEMAND_SERVED_KEY, v: recordServed(last, take, now), updated_at: new Date().toISOString() },
    { onConflict: "k" },
  )).catch(() => {});
}

// ── the filter-integrity incident record ────────────────────────────────────

export const INCIDENT_KEY_PREFIX = "filter_integrity_incident.";
// Rationale: docs/job-board-index-notes.md#n1353-export-const-incident_rewrite_ms-_000
export const INCIDENT_REWRITE_MS = 10 * 60_000;

// Rationale: docs/job-board-index-notes.md#n1354-export-function-incidentrows
export function incidentRows(
  violations: ReadonlyArray<{ field: string; got: string }>,
  rows: number,
  stamp: string,
): Array<{ k: string; v: Record<string, unknown>; updated_at: string }> {
  const byField = new Map<string, string[]>();
  for (const x of violations) {
    if (!/^[A-Za-z]{1,40}$/.test(x.field)) continue;
    const list = byField.get(x.field) ?? [];
    list.push(String(x.got).slice(0, 80));
    byField.set(x.field, list);
  }
  return [...byField].map(([field, got]) => ({
    k: `${INCIDENT_KEY_PREFIX}${field}`,
    v: { at: stamp, field, violations: got.length, rows, sample: got.slice(0, 3) },
    updated_at: stamp,
  }));
}

/**
 * status.filterContract from the per-field rows. The fields of the last
 * incident are those stamped with its instant (one page writes one stamp to
 * every field it violated), which is what the single row used to report.
 */
export function summariseIncidents(
  rows: ReadonlyArray<{ k?: unknown; v?: unknown; updated_at?: unknown }> | null | undefined,
  now: number,
): {
  lastIncidentAt: string | null;
  lastIncidentAgeMin: number | null;
  lastIncidentFields: string[] | null;
  lastIncidentViolations: number | null;
  incidents: Record<string, { at: string; ageMin: number; violations: number | null; rows: number | null }>;
} {
  const incidents: Record<string, { at: string; ageMin: number; violations: number | null; rows: number | null }> = {};
  for (const r of rows ?? []) {
    const k = typeof r.k === "string" ? r.k : "";
    const v = (r.v && typeof r.v === "object" ? r.v : {}) as { at?: unknown; violations?: unknown; rows?: unknown };
    const at = typeof v.at === "string" ? v.at : typeof r.updated_at === "string" ? r.updated_at : "";
    const ms = Date.parse(at);
    if (!k.startsWith(INCIDENT_KEY_PREFIX) || !Number.isFinite(ms)) continue;
    incidents[k.slice(INCIDENT_KEY_PREFIX.length)] = {
      at,
      ageMin: Math.round((now - ms) / 60000),
      violations: typeof v.violations === "number" ? v.violations : null,
      rows: typeof v.rows === "number" ? v.rows : null,
    };
  }
  const fields = Object.keys(incidents);
  if (!fields.length) return { lastIncidentAt: null, lastIncidentAgeMin: null, lastIncidentFields: null, lastIncidentViolations: null, incidents };
  const lastMs = Math.max(...fields.map((f) => Date.parse(incidents[f].at)));
  const last = fields.filter((f) => Date.parse(incidents[f].at) === lastMs).sort();
  return {
    lastIncidentAt: incidents[last[0]].at,
    lastIncidentAgeMin: incidents[last[0]].ageMin,
    lastIncidentFields: last,
    lastIncidentViolations: last.reduce((n, f) => n + (incidents[f].violations ?? 0), 0),
    incidents,
  };
}

// Rationale: docs/job-board-index-notes.md#n1355-export-async-function-writeincidents-cli
export async function writeIncidents(client: MetaDb, rows: ReturnType<typeof incidentRows>): Promise<void> {
  const cutoff = new Date(Date.now() - INCIDENT_REWRITE_MS).toISOString();
  await Promise.all(rows.map(async (row) => {
    const { data, error } = await client.from("job_board_meta").update({ v: row.v, updated_at: row.updated_at })
      .eq("k", row.k).lt("updated_at", cutoff).select("k");
    if (error || (Array.isArray(data) && data.length === 1)) return;
    await client.from("job_board_meta").insert(row);
  }));
}

// ── per-address allowances ──────────────────────────────────────────────────

export type RateRpc = (
  name: "check_rate_limit",
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

// Rationale: docs/job-board-index-notes.md#n1356-export-const-allowance_window_minutes
export const ALLOWANCE_WINDOW_MINUTES = 60;
/** check_rate_limit raises above this, and an error is answered as allowed, so a larger cap would switch itself off. */
export const LIMITER_MAX_REQUESTS = 1000;
/** verify: /jobs re-checks one posting on open (and one on apply), LiveMatches its top five. Two a minute for an hour. */
export const VERIFY_PER_ADDRESS_HOUR = 120;
/** report: a person flags a posting now and then. */
export const REPORT_PER_ADDRESS_HOUR = 10;
/** click: an open and an apply per posting; five a minute for an hour. */
export const CLICK_PER_ADDRESS_HOUR = 300;
/** fit-batch (older bundles; the site calls job-fit): twenty ids a call. */
export const FIT_PER_ADDRESS_HOUR = 60;

// Rationale: docs/job-board-index-notes.md#n1357-export-async-function-addressallowance
export async function addressAllowance(
  rpc: RateRpc,
  h: Headers,
  serviceKey: string,
  fn: string,
  perHour: number,
): Promise<boolean> {
  try {
    if (await exemptKind(h, serviceKey)) return true;
    const key = addressKey(clientAddress(h).address);
    if (!key) return true;
    const cap = Math.min(LIMITER_MAX_REQUESTS, Math.max(1, Math.floor(perHour)));
    const { data } = await rpc("check_rate_limit", { p_function: fn, p_ip: key, p_max_requests: cap, p_window_minutes: ALLOWANCE_WINDOW_MINUTES });
    return data !== false;
  } catch {
    return true;
  }
}
