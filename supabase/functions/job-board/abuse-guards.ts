/**
 * WHAT AN ANONYMOUS REQUEST MAY NOT DO TO THE BOARD (.88). Pure apart from the
 * rpc and the database client it is handed, so vitest imports it. Why, with the numbers:
 * docs/job-board-deploy-notes.md (2026-09-09.88); defect-sweep 2026-10-02
 * items 2.12 and 2.24.
 *
 *   THE DEMAND LANE. `verify` used to queue the board of every id it was handed
 *   -- before probing, for ids that were never postings -- and the refresh put
 *   up to five queued boards at the head of EVERY cold slice for twenty
 *   minutes, never removing one. One anonymous request every twenty minutes
 *   could spend most of each slice's 1,500-posting budget on boards it chose.
 *   Now a board is queued only for a posting the board actually holds, a slice
 *   takes at most one, a taken board waits a cooldown before it can be taken
 *   again, the lane takes a fixed number of boards an hour, whoever asks, and
 *   what it served is kept in a row verify cannot write.
 *
 *   THE INCIDENT RECORD. One overwritable row held the board's last
 *   filter-integrity incident together with the caller's own filters; any
 *   request that tripped the sensor replaced it. Now each field has its own row
 *   and nothing the caller wrote is stored in it.
 *
 *   PER-ADDRESS ALLOWANCES for the actions that write or fetch on a caller's
 *   behalf, keyed on the platform's address (never the first forwarded hop),
 *   counted by the hour because that is the longest window the limiter keeps.
 */
import { clientAddress } from "../_shared/client-address.ts";
import { addressKey, exemptKind } from "./anon-budget.ts";

// ── the demand lane ─────────────────────────────────────────────────────────
//
// TWO ROWS, ONE WRITER EACH. `demand` is the queue and verify is the only code
// that writes it. `demand_served` is what the lane served and the refresh is
// the only code that writes it. With one row written by both, a verify that
// read the row before a slice consumed a board and wrote after it put the
// board back and erased its served stamp, so the cooldown and the hourly count
// lost an entry each time the race was won. Now nothing verify writes can
// touch a served stamp: a board it re-queues is still cooling, and cooling
// outlasts a queue entry (DEMAND_COOLDOWN_MS > DEMAND_TTL_MS), so the refresh
// never removes a taken board from the queue at all -- it lapses.

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

/**
 * verify: the next queue, adding the boards of postings the board holds. A
 * board already queued keeps its place (a repeat request cannot keep it fresh
 * forever); a board the lane served inside the cooldown is not queued. null
 * when nothing changed, so the caller writes nothing. The result is a queue
 * only: verify never writes a served stamp.
 */
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

/**
 * refresh (a cold slice): the boards to put first, at most DEMAND_PER_SLICE and
 * only while the lane has taken fewer than DEMAND_PER_HOUR in the last hour.
 * `eligible` says which tokens this slice may take (a catalogued cold board not
 * already in the slice). `served` is the next served row; write it only once
 * the slice is admitted, or a declined slice would spend the request without
 * fetching the board.
 */
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

/**
 * status.demandLane: the lane's rules as deployed and how much of them was
 * used, counts only -- never a board token, so status does not publish what
 * readers are looking at. `queued` counts requests still waiting (a served
 * board's request lapses in the queue, cooling). servedLastHour above perHour
 * cannot happen with one writer; seeing it means a second writer of the row.
 */
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

/**
 * Stamp what an admitted slice took from the demand lane (.88). Only the
 * refresh writes this row, and it writes conditionally on the stamp it read,
 * merging onto a fresh read when another slice wrote first, so neither a
 * verify nor an overlapping slice can erase a served stamp. Three tries, then
 * an unconditional write merged onto the last row read: a stamp must land. A
 * row that could never be read is never overwritten blind (that would erase
 * every other stamp); the board then goes unstamped, which costs at most one
 * repeat of it while its request is queued.
 */
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
/**
 * A field's incident row is rewritten at most this often. Whatever
 * disagreement remains between a list read and its sensor is then at most one
 * write per field per interval, not one per request, and a repeat cannot keep
 * a stale incident looking current minute by minute.
 */
export const INCIDENT_REWRITE_MS = 10 * 60_000;

/**
 * One row per field that a page violated, keyed by that field. A field name
 * comes from the closed set filterViolations emits, and the sample keeps only
 * the served row's own value (`got`, the database's word), never `want` and
 * never the request's filters: those are the caller's text, and a sensor
 * record must not be something a request can write into.
 */
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

/**
 * Write filter-integrity incident rows, each at most once per
 * INCIDENT_REWRITE_MS (.88): a conditional update of a row older than the
 * interval, else an insert of a row that does not exist yet (a row that exists
 * and is fresh refuses the insert, which is the throttle answering).
 */
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

/**
 * AN HOUR, BECAUSE AN HOUR IS THE LONGEST WINDOW THE LIMITER KEEPS.
 * check_rate_limit (20251219200654, still the live definition) deletes, on one
 * call in a hundred, every rate_limits row older than the CALLING function's
 * window, whatever function wrote it. Every caller passes 60 minutes or more,
 * and track-ab-event calls it on every analytics event with a key the client
 * chooses, so a 1,440-minute row is deleted about an hour after it starts and
 * a "daily" allowance is an hourly one that can be reset on demand. A
 * 60-minute row is never older than the shortest sweep, so an hourly count is
 * one the database actually keeps. The day-equivalent of each cap is 24x it.
 */
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

/**
 * An hourly allowance for one action, on its own rate_limits row (a function
 * name outside check_global_rate_limit's budgeted set, so it never spends the
 * upload/checkout budget). Keyed on the platform's address, normalised like the
 * board meter (an IPv6 host is its /64). The service key and our servers'
 * reader proof are never refused; neither is a request with no public address
 * (a shared 'unknown' row would refuse everyone behind a gateway), nor one
 * whose check errors: an allowance must never take the board down. false only
 * on the limiter's explicit no. The cap sent is held inside the limiter's
 * bound, so a constant raised past it stays a cap instead of an error.
 */
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
