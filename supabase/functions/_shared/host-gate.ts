/**
 * ITEM 18 (board .103): A HOST'S STATED CRAWL-DELAY IS HONOURED BY EVERY LANE.
 *
 * api.lever.co and api.eu.lever.co state `Crawl-delay: 1`; careers.84lumber.com,
 * careers.petsmart.com and careers.aarp.org state 5 (robots read 2026-11-15/16,
 * legal-max carried/raw), and every other iCIMS tenant is paced at 5 until its
 * own robots is read (legal-max's default for a tenant not yet read). One
 * isolate's clock is not enough: the chain's hop, the description sweep, the
 * pass-end steps and a visitor's detail read run in different isolates at
 * once. So each paced host has one job_board_meta row, `host_gate:<host>`,
 * whose v.next_at is the earliest start of the next request to it. A request
 * takes the slot by a conditional update on the row's updated_at as it read
 * it; a lane that loses reads again and waits out the remainder, and past its
 * wall budget gives up (the caller defers the board, never fails it). The row
 * is created on first use by an insert whose conflict means another lane took
 * it first, so no table is added. Inside one isolate requests to a host queue
 * behind each other, so only one at a time contends for the row. If the row
 * cannot be read or written, the isolate's own clock still paces it.
 *
 * The row also keeps the pacing figures status shows: reads, the smallest gap
 * between two starts (minGapMs), since and last. Pure but for the store, so
 * vitest walks it.
 */

/** Each paced host's stated delay. The robots ledger extends it build by build; a host it does not name is paced only when the caller names it. */
export const HOST_DELAY_MS: Readonly<Record<string, number>> = {
  "api.lever.co": 1_000,
  "api.eu.lever.co": 1_000,
  "careers.84lumber.com": 5_000,
  "careers.petsmart.com": 5_000,
  "careers.aarp.org": 5_000,
};
/** An iCIMS tenant whose robots no ledger has read yet. */
export const ICIMS_DEFAULT_DELAY_MS = 5_000;
/** Added to every delay, so two isolates' clocks a few ms apart still leave the stated gap. */
export const GATE_PAD_MS = 50;

export type GateStats = { next_at?: string; reads?: number; minGapMs?: number; since?: string; last?: string };
export type GateStore = {
  /** The row's v and updated_at, or null when it does not exist yet. Throws when unreadable. */
  read(host: string): Promise<{ stamp: string; v: GateStats } | null>;
  /** Creates the row: false when another lane created it first. */
  create(host: string, v: GateStats): Promise<boolean>;
  /** Moves the row on only while its updated_at is still `stamp`: false when another lane took the slot first. */
  take(host: string, stamp: string, v: GateStats): Promise<boolean>;
};
export type GateDeps = {
  store: GateStore | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** This isolate's next start per host. */
  local: Map<string, number>;
  /** This isolate's queue per host. */
  queue: Map<string, Promise<unknown>>;
  maxWaitMs: number;
  /** A host the table does not name, paced at the delay this returns (an iCIMS tenant). */
  extra?: (host: string) => number | undefined;
};

/** The host a URL names and its delay, or null when it is not paced. */
export function hostDelayOf(url: string, extra?: (host: string) => number | undefined): { host: string; ms: number } | null {
  let host = "";
  try { host = new URL(url).host.toLowerCase(); } catch { return null; }
  const ms = HOST_DELAY_MS[host] ?? extra?.(host);
  return typeof ms === "number" && ms > 0 ? { host, ms } : null;
}

/**
 * Waits for the host's slot and takes it. true: start the request now. false:
 * the slot did not come inside `maxWaitMs`, counted from the call, queueing
 * included (the caller defers: a 429 to the slice, never a failure).
 */
export async function awaitHostSlot(url: string, deps: GateDeps): Promise<boolean> {
  const d = hostDelayOf(url, deps.extra);
  if (!d) return true;
  const t0 = deps.now();
  const prev = deps.queue.get(d.host) ?? Promise.resolve();
  let release = () => {};
  const mine = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => mine);
  deps.queue.set(d.host, tail);
  try {
    await prev;
    return await takeSlot(d, t0, deps);
  } finally {
    release();
    if (deps.queue.get(d.host) === tail) deps.queue.delete(d.host);
  }
}

async function takeSlot(d: { host: string; ms: number }, t0: number, deps: GateDeps): Promise<boolean> {
  const gap = d.ms + GATE_PAD_MS;
  let store = deps.store; // this request's: a store that failed it is still tried by the next one
  for (;;) {
    const now = deps.now();
    let wait = Math.max(0, (deps.local.get(d.host) ?? 0) - now);
    if (!wait && store) {
      try {
        const row = await store.read(d.host);
        const at = deps.now();
        const v = row?.v ?? {};
        const due = Date.parse(v.next_at ?? "");
        if (Number.isFinite(due) && due > at) wait = due - at;
        else {
          const last = Date.parse(v.last ?? "");
          const minGapMs = Number.isFinite(last) ? Math.min(v.minGapMs ?? Infinity, at - last) : v.minGapMs;
          const next: GateStats = {
            next_at: new Date(at + gap).toISOString(), reads: (v.reads ?? 0) + 1, since: v.since ?? new Date(at).toISOString(),
            last: new Date(at).toISOString(), ...(minGapMs !== undefined ? { minGapMs } : {}),
          };
          if (row ? await store.take(d.host, row.stamp, next) : await store.create(d.host, next)) { deps.local.set(d.host, at + gap); return true; }
          wait = 25; // another lane took it between our read and our write: read again
        }
      } catch {
        store = null; // unreadable: this isolate's clock alone paces, never faster than the delay
      }
    }
    if (!wait && !store) { deps.local.set(d.host, now + gap); return true; }
    if (!wait) continue;
    if (deps.now() + wait - t0 > deps.maxWaitMs) return false;
    await deps.sleep(wait);
  }
}

/** The gate rows on job_board_meta, through a service client. */
export function metaGateStore(client: { from: (t: string) => any }): GateStore {
  const k = (h: string) => `host_gate:${h}`;
  return {
    async read(h) {
      const { data, error } = await client.from("job_board_meta").select("v, updated_at").eq("k", k(h)).maybeSingle();
      if (error) throw error;
      return data ? { stamp: String(data.updated_at), v: (data.v ?? {}) as GateStats } : null;
    },
    async create(h, v) {
      const { error } = await client.from("job_board_meta").insert({ k: k(h), v, updated_at: new Date().toISOString() });
      if (error && error.code !== "23505") throw error;
      return !error;
    },
    async take(h, stamp, v) {
      const { data, error } = await client.from("job_board_meta").update({ v, updated_at: new Date().toISOString() }).eq("k", k(h)).eq("updated_at", stamp).select("k");
      if (error) throw error;
      return Array.isArray(data) && data.length === 1;
    },
  };
}

/** status.pacing: {host: {reads, minGapMs, since}} from the gate rows. */
export function pacingOf(rows: ReadonlyArray<{ k: string; v: unknown }> | null | undefined): Record<string, { reads: number; minGapMs: number | null; since: string | null }> {
  const out: Record<string, { reads: number; minGapMs: number | null; since: string | null }> = {};
  for (const r of rows ?? []) {
    if (!r.k.startsWith("host_gate:")) continue;
    const v = (r.v ?? {}) as GateStats;
    out[r.k.slice("host_gate:".length)] = { reads: v.reads ?? 0, minGapMs: typeof v.minGapMs === "number" ? v.minGapMs : null, since: v.since ?? null };
  }
  return out;
}
