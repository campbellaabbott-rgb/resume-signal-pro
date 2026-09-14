// The embed basis of the Other-bucket classifier: a title-only k-nearest-
// neighbour vote over a FROZEN anchor list, gated so tightly that a row moves
// only when the neighbourhood, the field centroid and the audited target set
// all agree. Pure module — no I/O, no Supabase client, no writes. Unit-tested
// from vitest; the leave-one-out script (scripts/category-anchors-loo.mjs)
// imports the same scorer so the gate that is audited is the gate that ships.
//
// WHAT IT IS NOT. It never writes `category`. It proposes: the caller stores
// category_proposed / category_basis='embed' / category_key=EMBED_ANCHOR_VERSION
// / category_confidence=share on a stored-'other' row, and only
// promote_category() (migration 20260909225500), reading a hand-written
// promotion list after a written audit, ever moves a row. It also never uses
// the job_board_embeddings vectors: those embed title + company + description
// slice and were never audited; the method below was validated on the TITLE
// ALONE (other-bucket/mechA), and the company name would leak the employer
// into the basis.
//
// WHERE THE GATES LIVE. Every gate constant (EMBED_K, EMBED_MIN_SHARE,
// EMBED_MIN_NN1, EMBED_REQUIRE_CENTROID_AGREE, EMBED_BARRED_TARGETS,
// EMBED_ANCHOR_VERSION, EMBED_LOO_REFERENCE, EMBED_LOO_TOLERANCE) is declared
// ONCE, in shadow.ts, beside its measurement. This file imports them and
// re-exports them; it declares no gate literal of its own, so the number the
// first-claim resolver checks and the number this scorer applies cannot drift
// apart (the "no subscriptions" incident: copy went false when the thing it
// described moved). What this file owns is the ANCHOR SET's identity: its
// count, its content hash, and the embedding recipe it was built under.
//
// HOW THE HOP USES IT (phase 2 wires this; phase 1 ships the module dormant):
//   vec   = await embedText(title)                 // index.ts, gte-small,
//                                                  // mean_pool + normalize
//   rows  = rpc category_knn(vec, EMBED_K)         // 20260909225000, exact
//                                                  // cosine over the anchors
//   c     = centroidTop1(vec, centroids)           // 17 centroids held in
//                                                  // memory from the anchors
//   stamp = readAnchorStamp(job_board_meta.category_anchor_version)
//                                                  // written by
//                                                  // load_category_anchors
//                                                  // (20260909224500)
//   resolveEmbed(rows, c?.field ?? null, stamp)    // proposal or null; THROWS
//                                                  // if the stamp is missing
//                                                  // or its LOO did not pass
// and the loader path, before any scoring: embed every anchor title with the
// same embedText, computeLooStamp(vectors) — which MUST come back passed —
// then load_category_anchors(version, rows, stamp, sha).
// Cost per row: one embed (~100-200 ms of CPU on a warm session; EMBED_PER_HOP=6
// and the 2 s CPU budget in index.ts are the hop's problem, not this file's),
// one exact scan over ~2.3k vectors (~1-2 ms), and this arithmetic (µs).
//
// PROVENANCE. Every figure below is measured in other-bucket/mechA
// (2026-09-10): 2,576-row stratified Other sample (top-25 employers 1,500 /
// tail 1,076); anchors = the 3,060 hand-labelled rows minus the 410 whose
// category was decided by the department, not the title (basis in {title,
// title+dept} leaves 2,650), deduped on (lower(title), field) = 2,272; 200
// rows hand-judged at the loose draw gate (judged.jsonl) plus a 60-row blind
// holdout at the shipping gate (holdout-judged.jsonl); 2,318 title decisions
// in all across the three mechanisms (judgments.json).
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

/**
 * The frozen anchor set: data/category-anchors.json, built by
 * scripts/build-category-anchors.mjs from other-bucket/labelled-basis.jsonl
 * (3,060 labelled rows, 2,650 title-decided, 2,272 distinct (title, field)).
 * EMBED_ANCHORS_SHA256 is sha256(JSON.stringify(anchors)) of that file's
 * list. ANY change to the list changes the hash; the frozen-anchors guard
 * (src/test) fails until BOTH this pin and EMBED_ANCHOR_VERSION (shadow.ts)
 * move together — and a new version carries no audit, so every embed
 * promotion listed under the old key matches nothing and the loader
 * (20260909224500) de-lists them.
 */
export const EMBED_ANCHOR_COUNT = 2272;
export const EMBED_ANCHORS_SHA256 = "e1773494f9b12ffbb8ad87ee5feb6ffdc8ea0ee60de4108c4297f7e787e38b86";

// ── What the measurements said, so the imported gates can be read here ─────
// EMBED_K = 15: mechA/classify.mjs K = 15; every audited figure is at this K.
// EMBED_MIN_SHARE = 0.60: mechA/score.mjs on the 200 judged rows — share >=
//   0.5 alone (the draw gate) is 19% wrong (38/200); share >= 0.6 with nn1 >=
//   0.85 is 15% wrong (20/133) BEFORE the centroid and target bars; with both
//   (F2) 5 wrong of 160 = 3.1% on the first-draw F2 subset (88R/4W/8A, n=100)
//   plus the blind holdout (53R/1W/6A, n=60) — 141R/5W/14A, strict 88.1%.
//   Loosening to 0.5 was measured and refused (journal dontDo).
// EMBED_MIN_NN1 = 0.85: the nearest anchor's cosine; the draw was gated here
//   (mechA/draw.mjs) and the holdout's minimum nn1 was 0.8513.
// EMBED_REQUIRE_CENTROID_AGREE = true: 18 of the 38 loose-gate misses had the
//   nearest of the 17 L2-normalised field centroids disagreeing with the vote
//   (mechA/score.mjs, "W rows where centroid disagreed"). The centroid is a
//   veto, never a vote — a row never moves on a centroid alone.
// EMBED_BARRED_TARGETS = {product, design, legal, data_ai}: strict precision
//   at the loose gate on the judged rows (R/(R+W+A)): product 2/15 = 13%,
//   design 1/9 = 11%, legal 1/8 = 12.5%, data_ai 5/14 = 36%. "Manager
//   Programs 3" went to product at share 1.00. Their vocabulary is corporate-
//   generic; the rule basis owns them.
// EMBED_LOO_REFERENCE = 0.862, tolerance 0.02: leave-one-out kNN agreement of
//   the anchor set with its own labels at K — mechA/loo-anchors.jsonl 1,959 /
//   2,272 = 0.8622. A stored anchor set whose in-runtime LOO does not land
//   within the tolerance was embedded differently from the audited one
//   (pooling, normalisation, a different model build) and the F2 audit does
//   not transfer to it — so resolveEmbed refuses to score until it does.

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

/**
 * "Within two points" of the reference, inclusive. Compared with a 1e-9
 * slack because 0.862 - 0.842 is 0.020000000000000018 in binary floating
 * point: an agreement exactly two points off is inside the audited tolerance
 * and must not be refused by the representation.
 */
export function withinLooTolerance(agreement: number): boolean {
  return Number.isFinite(agreement) && Math.abs(agreement - EMBED_LOO_REFERENCE) <= EMBED_LOO_TOLERANCE + 1e-9;
}

function l2(v: ArrayLike<number>): number[] {
  const n = Math.sqrt(dot(v, v)) || 1;
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/**
 * Score the neighbourhood: sort by similarity, keep the K nearest, weight each
 * neighbour's vote by its similarity, and rank fields by their share of the
 * total weight. Returns null on an empty list. Does NOT gate — see resolveEmbed.
 */
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

/**
 * Parse the job_board_meta.category_anchor_version value defensively. Returns
 * null for anything that is not an object with a string version — the caller
 * hands that to assertAnchorStamp, which throws the readable reason.
 */
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

/**
 * Refuse to score against an anchor set that is not the audited one. Throws
 * AnchorStampError — a hop that runs into this must stop, not degrade: a null
 * here would read as "nothing matched" and silently ship an un-audited gate.
 */
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

/**
 * The F2 gate. A proposal needs, all at once: the K nearest anchors' weighted
 * share >= EMBED_MIN_SHARE, the nearest anchor >= EMBED_MIN_NN1, the nearest
 * field centroid equal to the vote, and a target outside EMBED_BARRED_TARGETS.
 * Anything less is null — the row stays in the bucket. Throws when the stamp
 * is not the audited one or fewer than K neighbours were handed over.
 */
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

// A proposal from resolveEmbed is already the shape shadow.ts's first-claim
// resolver takes (resolveShadowRow({ ..., embed: proposal }) / embedToShadow:
// {field, key, confidence}); shadow.ts re-checks the barred targets, the
// anchor version and the share there, so a loosened scorer still cannot file
// into a barred field or under a stale anchor set.

/**
 * Leave-one-out kNN agreement over an embedded anchor set: each anchor is
 * scored against all the others, and it agrees when the vote's top field is
 * its own label. This is the number EMBED_LOO_REFERENCE pins; the local script
 * and the in-runtime check both compute it here, so they cannot drift apart.
 */
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

/**
 * The LOO gate as a stamp: run looAgreement over the embedded anchors and say
 * whether the figure reproduces the audited one. The loader stores exactly
 * this object; assertAnchorStamp reads it back. `passed` is computed here and
 * nowhere else — a caller cannot stamp a set as passing by hand.
 */
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
