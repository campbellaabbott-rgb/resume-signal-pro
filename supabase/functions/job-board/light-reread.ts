// An oversize greenhouse board that enrols in light mode reads its light list in the same visit.
// Rationale: docs/job-board-index-notes.md#n081-light-reread-in-the-same-visit

/** One slice's outcomes: enrolled = reread + deferred; reread - ok = light reads that also failed. */
export interface LightRereadStats { enrolled: number; reread: number; ok: number; deferred: number }

export const lightRereadStats = (): LightRereadStats => ({ enrolled: 0, reread: 0, ok: 0, deferred: 0 });

/** The only vendor whose re-read differs from the read that failed: its list drops ?content=true. */
const REREAD_VENDOR = "greenhouse";

export interface LightRereadInput<R> {
  board: { source: string; token: string };
  /** The first read's verdict. */
  failReason: string;
  /** The vendor has a light form and a filler (LIGHT_CAPABLE_VENDORS). */
  lightCapable: boolean;
  /** Already light before this visit: the read that failed was the light list. */
  light: boolean;
  enrol: () => Promise<boolean>;
  /** The start gate, without the board count. */
  canStart: () => boolean;
  /** The board's list again, under its reservation. */
  read: () => Promise<{ r: R | null; failReason: string }>;
  /** Boards re-read this slice. */
  done: Set<string>;
  stats: LightRereadStats;
}

/**
 * After a failed first read. Returns the read that landed, or null with the verdict the oversize
 * branch defers on: the light read's own oversize verdict, else the first read's, so a re-read
 * never turns a deferral into a vendor failure.
 */
export async function lightReread<R>(v: LightRereadInput<R>): Promise<{ r: R | null; failReason: string }> {
  const kept = { r: null, failReason: v.failReason };
  if (!v.failReason.startsWith("oversize") || !v.lightCapable || v.light) return kept;
  if (!(await v.enrol())) return kept;
  v.stats.enrolled++;
  const key = `${v.board.source}:${v.board.token}`;
  if (v.board.source !== REREAD_VENDOR || v.done.has(key) || !v.canStart()) {
    v.stats.deferred++;
    return kept;
  }
  v.done.add(key);
  v.stats.reread++;
  let x: { r: R | null; failReason: string };
  try { x = await v.read(); } catch (e) { x = { r: null, failReason: String((e as Error)?.message ?? e) }; }
  if (x.r) {
    v.stats.ok++;
    return { r: x.r, failReason: "" };
  }
  return { r: null, failReason: x.failReason.startsWith("oversize") ? x.failReason : v.failReason };
}

/** slice_stats.lightReread: running totals across slices, from the first slice that wrote them. */
export function addLightReread(prev: unknown, add: LightRereadStats, now: string): LightRereadStats & { since: string } {
  const p = prev && typeof prev === "object" ? prev as Record<string, unknown> : {};
  const n = (k: keyof LightRereadStats) => {
    const was = Number(p[k]);
    return (Number.isFinite(was) && was > 0 ? Math.floor(was) : 0) + add[k];
  };
  return { enrolled: n("enrolled"), reread: n("reread"), ok: n("ok"), deferred: n("deferred"), since: typeof p.since === "string" ? p.since : now };
}
