// Rationale: docs/job-board-index-notes.md#n1336-import-job_categories-from-_shared-board
import { JOB_CATEGORIES } from "../_shared/board-domains.ts";
import type { JobCategory } from "./categories.ts";
import {
  EMBED_ANCHOR_VERSION,
  EMBED_BARRED_TARGETS,
  EMBED_K,
  EMBED_LOO_REFERENCE,
  EMBED_LOO_TOLERANCE,
  EMBED_MIN_NN1,
  EMBED_MIN_SHARE,
  EMBED_REQUIRE_CENTROID_AGREE,
} from "./shadow.ts";

// The gates, re-exported from their one home so a caller of this module sees
// one surface. Not a second declaration: see the header.
export {
  EMBED_ANCHOR_VERSION,
  EMBED_BARRED_TARGETS,
  EMBED_K,
  EMBED_LOO_REFERENCE,
  EMBED_LOO_TOLERANCE,
  EMBED_MIN_NN1,
  EMBED_MIN_SHARE,
  EMBED_REQUIRE_CENTROID_AGREE,
} from "./shadow.ts";

/** The seventeen fields an anchor may carry; 'other' is never a target. */
export const EMBED_FIELDS: ReadonlySet<string> = new Set(
  (JOB_CATEGORIES as readonly string[]).filter((c) => c !== "other"),
);

export const EMBED_BASIS = "embed" as const;

/** The embedding recipe the anchors were built with and the runtime must match (index.ts embedText: gte-small, mean_pool: true, normalize: true, 384 dims). */
export const EMBED_MODEL = "gte-small";
export const EMBED_POOLING = "mean";
export const EMBED_NORMALIZE = true;
export const EMBED_DIM = 384;

// Rationale: docs/job-board-index-notes.md#n1337-export-const-embed_anchor_count
export const EMBED_ANCHOR_COUNT = 2272;
export const EMBED_ANCHORS_SHA256 = "e1773494f9b12ffbb8ad87ee5feb6ffdc8ea0ee60de4108c4297f7e787e38b86";

// Rationale: docs/job-board-index-notes.md#n1338-one-neighbour-as-category_knn-returns-it

/** One neighbour as category_knn returns it: (id, field, title, sim). */
export interface KnnRow {
  id?: string | null;
  field: string;
  title?: string | null;
  sim: number;
}

/** The vote over the K nearest anchors — mechA/classify.mjs knnPred, verbatim in semantics. */
export interface KnnScore {
  top1: string;
  share1: number;
  votes1: number;
  top2: string | null;
  share2: number;
  nn1: number;
  nn1Title: string | null;
  k: number;
}

/** The LOO stamp: computed by computeLooStamp over the embedded anchors, stored by the loader. */
export interface AnchorLooStamp {
  agreement: number;
  agree?: number;
  n: number;
  k: number;
  passed: boolean;
  reference?: number;
  tolerance?: number;
  model?: string;
  pooling?: string;
  normalize?: boolean;
  computed_at?: string;
  anchors_sha256?: string;
}

/** job_board_meta.category_anchor_version, as load_category_anchors writes it. */
export interface AnchorStamp {
  version: string;
  n?: number;
  anchors_sha256?: string | null;
  loo: AnchorLooStamp | null;
}

export interface EmbedProposal {
  field: string;
  basis: typeof EMBED_BASIS;
  key: string;
  /** The similarity-weighted share — what the audit was gated on. */
  confidence: number;
  share: number;
  nn1: number;
  centroid: string | null;
}

export class AnchorStampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorStampError";
  }
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// Rationale: docs/job-board-index-notes.md#n1339-export-function-withinlootolerance-agree
export function withinLooTolerance(agreement: number): boolean {
  return Number.isFinite(agreement) && Math.abs(agreement - EMBED_LOO_REFERENCE) <= EMBED_LOO_TOLERANCE + 1e-9;
}

function l2(v: ArrayLike<number>): number[] {
  const n = Math.sqrt(dot(v, v)) || 1;
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

// Rationale: docs/job-board-index-notes.md#n1340-export-function-scoreknn-rows-readonly-k
export function scoreKnn(rows: readonly KnnRow[], k: number = EMBED_K): KnnScore | null {
  if (!rows.length || k < 1) return null;
  const top = rows
    .filter((r) => typeof r.sim === "number" && Number.isFinite(r.sim) && typeof r.field === "string")
    .slice()
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
  if (!top.length) return null;
  const share = new Map<string, number>();
  const votes = new Map<string, number>();
  let tot = 0;
  for (const r of top) {
    share.set(r.field, (share.get(r.field) ?? 0) + r.sim);
    votes.set(r.field, (votes.get(r.field) ?? 0) + 1);
    tot += r.sim;
  }
  if (!(tot > 0)) return null;
  const ranked = [...share.entries()].map(([f, s]) => [f, s / tot] as const).sort((a, b) => b[1] - a[1]);
  const [top1, share1] = ranked[0];
  return {
    top1,
    share1,
    votes1: votes.get(top1) ?? 0,
    top2: ranked[1]?.[0] ?? null,
    share2: ranked[1]?.[1] ?? 0,
    nn1: top[0].sim,
    nn1Title: top[0].title ?? null,
    k: top.length,
  };
}

/** One L2-normalised mean vector per field, from the anchor vectors. */
export function buildCentroids(
  anchors: readonly { field: string; embedding: ArrayLike<number> }[],
): Map<string, number[]> {
  const sums = new Map<string, number[]>();
  for (const a of anchors) {
    let acc = sums.get(a.field);
    if (!acc) {
      acc = new Array<number>(a.embedding.length).fill(0);
      sums.set(a.field, acc);
    }
    for (let i = 0; i < acc.length; i++) acc[i] += a.embedding[i];
  }
  const out = new Map<string, number[]>();
  for (const [f, s] of sums) out.set(f, l2(s));
  return out;
}

/** The nearest centroid and its margin over the runner-up. */
export function centroidTop1(
  q: ArrayLike<number>,
  centroids: ReadonlyMap<string, ArrayLike<number>>,
): { field: string; sim: number; margin: number } | null {
  let best: { field: string; sim: number } | null = null;
  let second = -Infinity;
  for (const [f, c] of centroids) {
    const s = dot(q, c);
    if (!best || s > best.sim) {
      if (best) second = best.sim;
      best = { field: f, sim: s };
    } else if (s > second) second = s;
  }
  return best ? { ...best, margin: Number.isFinite(second) ? best.sim - second : best.sim } : null;
}

// Rationale: docs/job-board-index-notes.md#n1341-export-function-readanchorstamp-value-un
export function readAnchorStamp(value: unknown): AnchorStamp | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== "string") return null;
  const loo = v.loo && typeof v.loo === "object" && !Array.isArray(v.loo) ? (v.loo as AnchorLooStamp) : null;
  return {
    version: v.version,
    n: typeof v.n === "number" ? v.n : undefined,
    anchors_sha256: typeof v.anchors_sha256 === "string" ? v.anchors_sha256 : null,
    loo,
  };
}

// Rationale: docs/job-board-index-notes.md#n1342-export-function-assertanchorstamp-stamp
export function assertAnchorStamp(stamp: AnchorStamp | null | undefined): void {
  if (!stamp || typeof stamp !== "object") throw new AnchorStampError("no anchor version stamp: load_category_anchors has not run");
  if (stamp.version !== EMBED_ANCHOR_VERSION) {
    throw new AnchorStampError(`anchor version ${JSON.stringify(stamp.version)} is not the audited ${EMBED_ANCHOR_VERSION}`);
  }
  if (typeof stamp.n === "number" && stamp.n !== EMBED_ANCHOR_COUNT) {
    throw new AnchorStampError(`anchor table holds ${stamp.n} rows; the audited set has ${EMBED_ANCHOR_COUNT}`);
  }
  if (typeof stamp.anchors_sha256 === "string" && stamp.anchors_sha256 !== EMBED_ANCHORS_SHA256) {
    throw new AnchorStampError(`anchor table was loaded from a list hashing ${stamp.anchors_sha256}, not the audited ${EMBED_ANCHORS_SHA256}`);
  }
  const loo = stamp.loo;
  if (!loo || typeof loo !== "object") throw new AnchorStampError("anchor set carries no leave-one-out stamp: run the LOO check before scoring");
  if (loo.passed !== true) throw new AnchorStampError("anchor set's leave-one-out check did not pass");
  if (loo.k !== EMBED_K) throw new AnchorStampError(`LOO was computed at k=${loo.k}, the gate is audited at k=${EMBED_K}`);
  if (loo.n !== EMBED_ANCHOR_COUNT) throw new AnchorStampError(`LOO covered ${loo.n} anchors, the audited set has ${EMBED_ANCHOR_COUNT}`);
  if (typeof loo.agreement !== "number" || !withinLooTolerance(loo.agreement)) {
    throw new AnchorStampError(`LOO agreement ${loo.agreement} is not within ${EMBED_LOO_TOLERANCE} of ${EMBED_LOO_REFERENCE}: the runtime's embeddings are not the audited ones`);
  }
  if (typeof loo.anchors_sha256 === "string" && loo.anchors_sha256 !== EMBED_ANCHORS_SHA256) {
    throw new AnchorStampError(`LOO was computed over a list hashing ${loo.anchors_sha256}, not the audited ${EMBED_ANCHORS_SHA256}`);
  }
  if (loo.model !== undefined && loo.model !== EMBED_MODEL) throw new AnchorStampError(`LOO ran on ${loo.model}, not ${EMBED_MODEL}`);
  if (loo.pooling !== undefined && loo.pooling !== EMBED_POOLING) throw new AnchorStampError(`LOO pooled by ${loo.pooling}, not ${EMBED_POOLING}`);
  if (loo.normalize !== undefined && loo.normalize !== EMBED_NORMALIZE) throw new AnchorStampError("LOO vectors were not L2-normalised");
}

// Rationale: docs/job-board-index-notes.md#n1343-export-function-resolveembed
export function resolveEmbed(
  rows: readonly KnnRow[],
  centroidField: string | null,
  stamp: AnchorStamp | null | undefined,
): EmbedProposal | null {
  assertAnchorStamp(stamp);
  if (rows.length < EMBED_K) {
    throw new AnchorStampError(`category_knn returned ${rows.length} neighbours; the gate is audited over ${EMBED_K}`);
  }
  const s = scoreKnn(rows, EMBED_K);
  if (!s) return null;
  if (!EMBED_FIELDS.has(s.top1)) return null;
  if (EMBED_BARRED_TARGETS.has(s.top1 as JobCategory)) return null;
  if (!(s.share1 >= EMBED_MIN_SHARE)) return null;
  if (!(s.nn1 >= EMBED_MIN_NN1)) return null;
  if (EMBED_REQUIRE_CENTROID_AGREE && centroidField !== s.top1) return null;
  return {
    field: s.top1,
    basis: EMBED_BASIS,
    key: EMBED_ANCHOR_VERSION,
    confidence: s.share1,
    share: s.share1,
    nn1: s.nn1,
    centroid: centroidField,
  };
}

// Rationale: docs/job-board-index-notes.md#n1344-block

// Rationale: docs/job-board-index-notes.md#n1345-export-function-looagreement
export function looAgreement(
  anchors: readonly { field: string; embedding: ArrayLike<number> }[],
  k: number = EMBED_K,
): { agreement: number; agree: number; n: number; k: number } {
  const n = anchors.length;
  let agree = 0;
  const sims = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = anchors[i].embedding;
    for (let j = 0; j < n; j++) sims[j] = j === i ? -Infinity : dot(q, anchors[j].embedding);
    // partial selection of the k largest, then the same weighted vote as the runtime
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (idx.length < k) {
        idx.push(j);
        if (idx.length === k) idx.sort((a, b) => sims[b] - sims[a]);
      } else if (sims[j] > sims[idx[k - 1]]) {
        let p = k - 1;
        while (p > 0 && sims[idx[p - 1]] < sims[j]) { idx[p] = idx[p - 1]; p--; }
        idx[p] = j;
      }
    }
    if (idx.length < k) idx.sort((a, b) => sims[b] - sims[a]);
    const s = scoreKnn(idx.map((j) => ({ field: anchors[j].field, sim: sims[j] })), k);
    if (s && s.top1 === anchors[i].field) agree++;
  }
  return { agreement: n ? agree / n : 0, agree, n, k };
}

// Rationale: docs/job-board-index-notes.md#n1346-export-function-computeloostamp
export function computeLooStamp(
  anchors: readonly { field: string; embedding: ArrayLike<number> }[],
  anchorsSha256: string,
  now: Date = new Date(),
): AnchorLooStamp {
  const loo = looAgreement(anchors, EMBED_K);
  return {
    agreement: +loo.agreement.toFixed(4),
    agree: loo.agree,
    n: loo.n,
    k: loo.k,
    passed: loo.n === EMBED_ANCHOR_COUNT && withinLooTolerance(loo.agreement),
    reference: EMBED_LOO_REFERENCE,
    tolerance: EMBED_LOO_TOLERANCE,
    model: EMBED_MODEL,
    pooling: EMBED_POOLING,
    normalize: EMBED_NORMALIZE,
    computed_at: now.toISOString(),
    anchors_sha256: anchorsSha256,
  };
}
