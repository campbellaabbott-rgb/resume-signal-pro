// Rationale: docs/job-board-index-notes.md#n1585-export-const-host_delay_ms-readonly-reco

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

// Rationale: docs/job-board-index-notes.md#n1586-export-async-function-awaithostslot-url
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
