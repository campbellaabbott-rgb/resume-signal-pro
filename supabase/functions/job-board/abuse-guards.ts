/**
 * WHAT AN ANONYMOUS REQUEST MAY NOT DO TO THE BOARD (.88). Pure apart from the
 * rpc it is handed, so vitest imports it. Why, with the numbers:
 * docs/job-board-deploy-notes.md (2026-09-09.88); defect-sweep 2026-10-02
 * items 2.12 and 2.24.
 *
 *   THE DEMAND LANE. `verify` used to queue the board of every id it was handed
 *   -- before probing, for ids that were never postings -- and the refresh put
 *   up to five queued boards at the head of EVERY cold slice for twenty
 *   minutes, never removing one. One anonymous request every twenty minutes
 *   could spend most of each slice's 1,500-posting budget on boards it chose.
 *   Now a board is queued only for a posting the board actually holds, a slice
 *   takes at most one, a taken board leaves the queue and waits a cooldown
 *   before it can be asked for again, and the lane takes a fixed number of
 *   boards an hour, whoever asks.
 *
 *   THE INCIDENT RECORD. One overwritable row held the board's last
 *   filter-integrity incident together with the caller's own filters; any
 *   request that tripped the sensor replaced it. Now each field has its own row
 *   and nothing the caller wrote is stored in it.
 *
 *   PER-ADDRESS ALLOWANCES for the actions that write or fetch on a caller's
 *   behalf, keyed on the platform's address (never the first forwarded hop).
 */
import { clientAddress } from "../_shared/client-address.ts";
import { addressKey, exemptKind } from "./anon-budget.ts";

// ── the demand lane ─────────────────────────────────────────────────────────

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

export type DemandEntry = { t: string; at: number };
export type DemandRow = { tokens?: DemandEntry[]; served?: DemandEntry[] };

const entries = (x: unknown): DemandEntry[] =>
  Array.isArray(x)
    ? x.filter((e): e is DemandEntry => !!e && typeof (e as DemandEntry).t === "string" && Number.isFinite((e as DemandEntry).at))
    : [];

/** Served stamps still inside the cooldown (the longest window anything reads them for). */
const liveServed = (row: DemandRow | null | undefined, now: number): DemandEntry[] =>
  entries(row?.served).filter((e) => now - e.at < DEMAND_COOLDOWN_MS);

/**
 * verify: queue the boards of postings the board holds. A board already queued
 * keeps its place (a repeat request cannot keep it fresh forever); a board the
 * lane served inside the cooldown is not queued. null when nothing changed, so
 * the caller writes nothing.
 */
export function admitDemand(row: DemandRow | null | undefined, tokens: readonly string[], now: number): DemandRow | null {
  const queued = entries(row?.tokens).filter((e) => now - e.at < DEMAND_TTL_MS);
  const served = liveServed(row, now);
  const have = new Set(queued.map((e) => e.t));
  const cooling = new Set(served.map((e) => e.t));
  const add = [...new Set(tokens)].filter((t) => !have.has(t) && !cooling.has(t));
  if (!add.length) return null;
  return { tokens: [...queued, ...add.map((t) => ({ t, at: now }))].slice(-DEMAND_QUEUE_MAX), served };
}

/**
 * refresh (a cold slice): the boards to put first, at most DEMAND_PER_SLICE and
 * only while the lane has taken fewer than DEMAND_PER_HOUR in the last hour.
 * `eligible` says which tokens this slice may take (a catalogued cold board not
 * already in the slice). `next` removes what was taken and stamps it served;
 * write it only once the slice is admitted, or a declined slice would spend
 * the request without fetching the board.
 */
export function takeDemand(
  row: DemandRow | null | undefined,
  now: number,
  eligible: (token: string) => boolean,
): { take: string[]; next: DemandRow | null } {
  const queued = entries(row?.tokens).filter((e) => now - e.at < DEMAND_TTL_MS);
  const served = liveServed(row, now);
  const room = Math.max(0, Math.min(DEMAND_PER_SLICE, DEMAND_PER_HOUR - served.filter((e) => now - e.at < 3_600_000).length));
  const cooling = new Set(served.map((e) => e.t));
  const take = queued.filter((e) => !cooling.has(e.t) && eligible(e.t)).slice(0, room).map((e) => e.t);
  if (!take.length) return { take, next: null };
  const taken = new Set(take);
  return {
    take,
    next: { tokens: queued.filter((e) => !taken.has(e.t)), served: [...served, ...take.map((t) => ({ t, at: now }))] },
  };
}

/**
 * status.demandLane: the lane's rules as deployed and how much of them was
 * used, counts only -- never a board token, so status does not publish what
 * readers are looking at. servedLastHour above perHour cannot happen; seeing
 * it means a second writer of the row.
 */
export function demandLaneStatus(row: DemandRow | null | undefined, now: number): Record<string, number> {
  return {
    queued: entries(row?.tokens).filter((e) => now - e.at < DEMAND_TTL_MS).length,
    servedLastHour: entries(row?.served).filter((e) => now - e.at < 3_600_000).length,
    cooling: liveServed(row, now).length,
    perSlice: DEMAND_PER_SLICE,
    perHour: DEMAND_PER_HOUR,
    cooldownMin: DEMAND_COOLDOWN_MS / 60_000,
  };
}

// ── the filter-integrity incident record ────────────────────────────────────

export const INCIDENT_KEY_PREFIX = "filter_integrity_incident.";

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

// ── per-address allowances ──────────────────────────────────────────────────

export type RateRpc = (
  name: "check_rate_limit",
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

/**
 * A daily allowance for one action, on its own rate_limits row (a function
 * name outside check_global_rate_limit's budgeted set, so it never spends the
 * upload/checkout budget). Keyed on the platform's address, normalised like the
 * board meter (an IPv6 host is its /64). The service key and our servers'
 * reader proof are never refused; neither is a request with no public address
 * (a shared 'unknown' row would refuse everyone behind a gateway), nor one
 * whose check errors: an allowance must never take the board down. false only
 * on the limiter's explicit no.
 */
export async function addressAllowance(
  rpc: RateRpc,
  h: Headers,
  serviceKey: string,
  fn: string,
  perDay: number,
): Promise<boolean> {
  try {
    if (await exemptKind(h, serviceKey)) return true;
    const key = addressKey(clientAddress(h).address);
    if (!key) return true;
    const { data } = await rpc("check_rate_limit", { p_function: fn, p_ip: key, p_max_requests: perDay, p_window_minutes: 1440 });
    return data !== false;
  } catch {
    return true;
  }
}
