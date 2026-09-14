/**
 * AN EMBED VOTE MOVES NOTHING IT CANNOT EXPLAIN.
 *
 * embed-classify.ts is the third classifier of the Other bucket: a title-only
 * kNN vote over a frozen anchor set. It PROPOSES; it never writes `category`.
 * Its gate (F2) was measured on 160 hand-judged draws (scratchpad/other-
 * bucket/mechA, 2026-09-10; fixtures/embed-judged-rows.json mirrors the 260
 * judged rows): share >= 0.60, nearest anchor >= 0.85, the field centroid
 * agreeing, and four targets barred outright -- 141 right / 5 wrong / 14
 * ambiguous, 3.1% wrong. Loosening any one of those was measured and refused.
 *
 * This file pins, as PROPERTIES:
 *   - every gate has exactly one declaration (shadow.ts) and this module
 *     imports it -- no second literal that can drift;
 *   - the gate constants are the ones the judged rows justify: the barred set
 *     is exactly the fields whose strict precision at the loose gate fell
 *     under one half, and the shipped gate is the only one of the measured
 *     variants that clears shadow.ts's own promotion bar (1 wrong per 30);
 *   - the scorer is mechA's vote, verbatim in semantics (a port of knnPred is
 *     fuzzed against it);
 *   - the resolver refuses to run against an anchor set without a passing
 *     leave-one-out stamp, and returns null on every failed gate;
 *   - the proposal is the shape shadow.ts's first-claim resolver takes, and
 *     shadow.ts re-refuses a barred target;
 *   - the module performs no write and imports no client.
 * Every source assertion runs over comment-stripped code (a literal in a
 * comment must not pass a guard), and the teeth are shown on pre-fix copies.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as embed from "../../supabase/functions/job-board/embed-classify";
import * as shadow from "../../supabase/functions/job-board/shadow";
import type { AnchorStamp, KnnRow } from "../../supabase/functions/job-board/embed-classify";

const {
  EMBED_K, EMBED_MIN_SHARE, EMBED_MIN_NN1, EMBED_REQUIRE_CENTROID_AGREE, EMBED_BARRED_TARGETS, EMBED_ANCHOR_VERSION,
  EMBED_LOO_REFERENCE, EMBED_LOO_TOLERANCE, EMBED_ANCHOR_COUNT, EMBED_ANCHORS_SHA256,
  resolveEmbed, scoreKnn, looAgreement, computeLooStamp, buildCentroids, centroidTop1, readAnchorStamp, assertAnchorStamp, AnchorStampError, dot,
} = embed;

const ROOT = resolve(__dirname, "../..");
const MODULE_PATH = resolve(ROOT, "supabase/functions/job-board/embed-classify.ts");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const moduleSrc = stripComments(readFileSync(MODULE_PATH, "utf8"));

/** A stamp the audited anchor set would carry (what load_category_anchors stores after a passing LOO). */
const GOOD_STAMP: AnchorStamp = {
  version: EMBED_ANCHOR_VERSION,
  n: EMBED_ANCHOR_COUNT,
  anchors_sha256: EMBED_ANCHORS_SHA256,
  loo: { agreement: 0.8622, agree: 1959, n: EMBED_ANCHOR_COUNT, k: EMBED_K, passed: true, model: "gte-small", pooling: "mean", normalize: true, anchors_sha256: EMBED_ANCHORS_SHA256 },
};

/** n rows of one field at one similarity. */
const rowsOf = (field: string, n: number, sim: number, from = 0): KnnRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${field}${from + i}`, field, title: `${field} ${from + i}`, sim }));

let seed = 20260914;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const FIELDS = ["engineering", "finance", "healthcare", "operations", "customer", "hospitality_retail", "sales", "science", "product", "design", "legal", "data_ai", "admin"];
const randomNeighbourhood = (n = 15): KnnRow[] => {
  const dominant = FIELDS[Math.floor(rnd() * FIELDS.length)];
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, field: rnd() < 0.55 ? dominant : FIELDS[Math.floor(rnd() * FIELDS.length)], title: `t${i}`, sim: +(0.75 + rnd() * 0.25).toFixed(4) }));
};

// ── the judged rows ─────────────────────────────────────────────────────────
interface Judged { title: string; top: string; share: number; nn1: number; centroid: string; v: "R" | "W" | "A"; expected: string | null; stratum: string; set: "draw" | "holdout" }
const judged: Judged[] = (JSON.parse(readFileSync(resolve(__dirname, "fixtures/embed-judged-rows.json"), "utf8")).rows as unknown[][])
  .map((r) => ({ title: r[0] as string, top: r[1] as string, share: r[2] as number, nn1: r[3] as number, centroid: r[4] as string, v: r[5] as Judged["v"], expected: r[6] as string | null, stratum: r[7] as string, set: r[8] as Judged["set"] }));
const draw = judged.filter((r) => r.set === "draw");
const holdout = judged.filter((r) => r.set === "holdout");
const tally = (rows: Judged[]) => rows.reduce((c, r) => { c[r.v]++; c.n++; return c; }, { R: 0, W: 0, A: 0, n: 0 });
/** The gate as a predicate over a judged row, parameterised so the refused variants can be scored too. */
const gate = (o: { share: number; nn1: number; centroid: boolean; barred: ReadonlySet<string> }) => (r: Judged) =>
  r.share >= o.share && r.nn1 >= o.nn1 && (!o.centroid || r.centroid === r.top) && !o.barred.has(r.top);
const SHIPPED = { share: EMBED_MIN_SHARE, nn1: EMBED_MIN_NN1, centroid: EMBED_REQUIRE_CENTROID_AGREE, barred: EMBED_BARRED_TARGETS as ReadonlySet<string> };
/** The bar a promotion must clear, from shadow.ts: at most 1 wrong per 30 judged. */
const PROMOTE_WRONG_RATE = shadow.PROMOTE_MAX_WRONG_PER_EMBED_TARGET / shadow.PROMOTE_MIN_JUDGED_PER_EMBED_TARGET;

describe("the gates have one home and this module imports them", () => {
  it("the shipped values", () => {
    expect([EMBED_K, EMBED_MIN_SHARE, EMBED_MIN_NN1, EMBED_REQUIRE_CENTROID_AGREE, EMBED_ANCHOR_VERSION]).toEqual([15, 0.6, 0.85, true, "embed_knn_v1"]);
    expect([...EMBED_BARRED_TARGETS].sort()).toEqual(["data_ai", "design", "legal", "product"]);
    expect([EMBED_LOO_REFERENCE, EMBED_LOO_TOLERANCE]).toEqual([0.862, 0.02]);
  });

  const GATES = ["EMBED_K", "EMBED_MIN_SHARE", "EMBED_MIN_NN1", "EMBED_REQUIRE_CENTROID_AGREE", "EMBED_BARRED_TARGETS", "EMBED_ANCHOR_VERSION", "EMBED_LOO_REFERENCE", "EMBED_LOO_TOLERANCE"];
  const redeclared = (src: string) => GATES.filter((g) => new RegExp(`\\b(const|let|var)\\s+${g}\\b`).test(src));

  it("embed-classify.ts declares no gate of its own (comment-stripped)", () => {
    expect(redeclared(moduleSrc)).toEqual([]);
    const importBlock = moduleSrc.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/shadow\.ts"/);
    expect(importBlock, "the gates are imported from shadow.ts").toBeTruthy();
    for (const g of GATES) expect(importBlock![1], `${g} imported from shadow.ts`).toMatch(new RegExp(`\\b${g}\\b`));
  });

  it("the two modules hold the SAME values (identity for the set, equality for the numbers)", () => {
    expect(embed.EMBED_BARRED_TARGETS).toBe(shadow.EMBED_BARRED_TARGETS);
    expect([embed.EMBED_K, embed.EMBED_MIN_SHARE, embed.EMBED_MIN_NN1, embed.EMBED_ANCHOR_VERSION, embed.EMBED_LOO_REFERENCE]).toEqual([shadow.EMBED_K, shadow.EMBED_MIN_SHARE, shadow.EMBED_MIN_NN1, shadow.EMBED_ANCHOR_VERSION, shadow.EMBED_LOO_REFERENCE]);
  });

  it("teeth: a copy that re-declares a gate is caught, and a literal in a comment is not a declaration", () => {
    expect(redeclared(moduleSrc + "\nexport const EMBED_MIN_SHARE = 0.5;\n")).toEqual(["EMBED_MIN_SHARE"]);
    expect(redeclared(stripComments(moduleSrc + "\n// const EMBED_MIN_SHARE = 0.5;\n"))).toEqual([]);
  });
});

describe("the gates are the ones the judged rows justify", () => {
  it("the barred set is exactly the fields whose strict precision at the loose gate fell under one half (with >= 8 judged rows)", () => {
    const per = new Map<string, { R: number; W: number; A: number }>();
    for (const r of draw) { const c = per.get(r.top) ?? { R: 0, W: 0, A: 0 }; c[r.v]++; per.set(r.top, c); }
    const derived = [...per.entries()].filter(([, c]) => c.R + c.W + c.A >= shadow.PROMOTE_MIN_JUDGED_PER_KEY && c.R / (c.R + c.W + c.A) < 0.5).map(([f]) => f).sort();
    expect(derived).toEqual([...EMBED_BARRED_TARGETS].sort());
    // the four, as measured: product 2/15, design 1/9, legal 1/8, data_ai 5/14
    expect(per.get("product")).toEqual({ R: 2, W: 12, A: 1 });
    expect(per.get("design")).toEqual({ R: 1, W: 5, A: 3 });
    expect(per.get("legal")).toEqual({ R: 1, W: 5, A: 2 });
    expect(per.get("data_ai")).toEqual({ R: 5, W: 5, A: 4 });
  });

  it("at the shipped gate: 160 judged (100 draw + 60 holdout), 141 right, 5 wrong -- under the promotion bar", () => {
    const f2 = [...draw.filter(gate(SHIPPED)), ...holdout];
    expect(tally(f2)).toEqual({ R: 141, W: 5, A: 14, n: 160 });
    expect(5 / 160).toBeLessThanOrEqual(PROMOTE_WRONG_RATE);
    expect(PROMOTE_WRONG_RATE).toBeCloseTo(1 / 30, 10);
  });

  it("the blind holdout was drawn AT the shipped gate: every holdout row clears every constant", () => {
    expect(holdout.length).toBe(60);
    for (const r of holdout) {
      expect(r.share).toBeGreaterThanOrEqual(EMBED_MIN_SHARE);
      expect(r.nn1).toBeGreaterThanOrEqual(EMBED_MIN_NN1);
      expect(r.centroid).toBe(r.top);
      expect(EMBED_BARRED_TARGETS.has(r.top as never)).toBe(false);
    }
    expect(Math.min(...holdout.map((r) => r.nn1))).toBeCloseTo(0.8513, 4);
    expect(Math.min(...holdout.map((r) => r.share))).toBeCloseTo(0.6002, 4);
  });

  it("dontDo, with teeth: every measured loosening breaks the promotion bar", () => {
    const rate = (o: Parameters<typeof gate>[0]) => { const t = tally([...draw.filter(gate(o)), ...holdout]); return t.W / t.n; };
    expect(rate(SHIPPED)).toBeLessThanOrEqual(PROMOTE_WRONG_RATE);
    expect(rate({ ...SHIPPED, share: 0.5 })).toBeGreaterThan(PROMOTE_WRONG_RATE);                 // 8/199
    expect(rate({ ...SHIPPED, centroid: false })).toBeGreaterThan(PROMOTE_WRONG_RATE);           // no centroid veto
    expect(rate({ ...SHIPPED, barred: new Set() })).toBeGreaterThan(PROMOTE_WRONG_RATE);          // barred targets allowed
    expect(rate({ ...SHIPPED, share: 0.5, centroid: false, barred: new Set() })).toBeGreaterThan(2 * PROMOTE_WRONG_RATE);
  });
});

describe("resolveEmbed: the F2 gate, hand-checked", () => {
  it("a unanimous neighbourhood with the centroid agreeing proposes {field, basis embed, key = anchor version, confidence = share}", () => {
    const p = resolveEmbed(rowsOf("finance", 15, 0.9), "finance", GOOD_STAMP);
    expect(p).toMatchObject({ field: "finance", basis: "embed", key: EMBED_ANCHOR_VERSION, centroid: "finance", nn1: 0.9 });
    expect(p!.confidence).toBeCloseTo(1, 10);
    expect(p!.share).toBe(p!.confidence);
  });

  it("the share is similarity-WEIGHTED: 9 finance @0.9 + 6 operations @0.8 -> 8.1 / 12.9 = 0.6279 -> proposes", () => {
    const p = resolveEmbed([...rowsOf("finance", 9, 0.9), ...rowsOf("operations", 6, 0.8)], "finance", GOOD_STAMP);
    expect(p?.field).toBe("finance");
    expect(p!.confidence).toBeCloseTo(8.1 / 12.9, 6);
  });

  it("a count majority that loses on weight is withheld: 8 finance @0.86 + 7 operations @0.9 -> 6.88 / 13.18 = 0.522 -> null", () => {
    expect(resolveEmbed([...rowsOf("finance", 8, 0.86), ...rowsOf("operations", 7, 0.9)], "finance", GOOD_STAMP)).toBeNull();
  });

  it("each gate withholds on its own", () => {
    const strong = [...rowsOf("finance", 12, 0.9), ...rowsOf("operations", 3, 0.9)]; // share 0.8, nn1 0.9
    expect(resolveEmbed(strong, "finance", GOOD_STAMP)).not.toBeNull();
    expect(resolveEmbed(strong, "operations", GOOD_STAMP), "centroid disagrees").toBeNull();
    expect(resolveEmbed(strong, null, GOOD_STAMP), "no centroid at all").toBeNull();
    expect(resolveEmbed([...rowsOf("finance", 12, 0.849), ...rowsOf("operations", 3, 0.84)], "finance", GOOD_STAMP), "nn1 below 0.85").toBeNull();
    expect(resolveEmbed([...rowsOf("finance", 9, 0.85), ...rowsOf("operations", 6, 0.85)], "finance", GOOD_STAMP), "share 0.6 exactly passes").not.toBeNull();
    expect(resolveEmbed([...rowsOf("finance", 8, 0.85), ...rowsOf("operations", 7, 0.85)], "finance", GOOD_STAMP), "share 0.533").toBeNull();
    expect(resolveEmbed(rowsOf("other", 15, 0.99), "other", GOOD_STAMP), "other is never a target").toBeNull();
    expect(resolveEmbed(rowsOf("media_entertainment", 15, 0.99), "media_entertainment", GOOD_STAMP), "a field the board does not serve").toBeNull();
  });

  it("the barred targets are withheld even unanimous at sim 1.0 with the centroid agreeing", () => {
    for (const f of EMBED_BARRED_TARGETS) expect(resolveEmbed(rowsOf(f, 15, 1), f, GOOD_STAMP), f).toBeNull();
  });

  it("scores the K NEAREST regardless of input order, and ignores rows beyond K", () => {
    const near = [...rowsOf("finance", 15, 0.92)];
    const far = rowsOf("operations", 10, 0.88, 100);
    const shuffled = [...far, ...near].sort(() => rnd() - 0.5);
    const p = resolveEmbed(shuffled, "finance", GOOD_STAMP);
    expect(p?.field).toBe("finance");
    expect(p!.confidence).toBeCloseTo(1, 10);
  });

  it("fewer than K neighbours is an error, not a null -- the gate is audited over 15", () => {
    expect(() => resolveEmbed(rowsOf("finance", 14, 0.95), "finance", GOOD_STAMP)).toThrow(AnchorStampError);
  });

  it("fuzz: a proposal always names the top field, at share >= 0.6, nn1 >= 0.85, centroid equal, never barred", () => {
    let proposals = 0;
    for (let i = 0; i < 3000; i++) {
      const rows = randomNeighbourhood();
      const s = scoreKnn(rows, EMBED_K)!;
      const centroid = rnd() < 0.7 ? s.top1 : FIELDS[Math.floor(rnd() * FIELDS.length)];
      const p = resolveEmbed(rows, centroid, GOOD_STAMP);
      const should = s.share1 >= EMBED_MIN_SHARE && s.nn1 >= EMBED_MIN_NN1 && centroid === s.top1 && !EMBED_BARRED_TARGETS.has(s.top1 as never);
      expect(p !== null).toBe(should);
      if (p) { proposals++; expect(p.field).toBe(s.top1); expect(p.confidence).toBe(s.share1); }
    }
    expect(proposals).toBeGreaterThan(100);
  });
});

describe("resolveEmbed refuses to run against an anchor set that is not the audited one", () => {
  const refuses = (stamp: unknown, why: RegExp) => {
    let err: unknown = null;
    try { resolveEmbed(rowsOf("finance", 15, 0.95), "finance", stamp as AnchorStamp); } catch (e) { err = e; }
    expect(err, `expected a refusal: ${why}`).toBeInstanceOf(AnchorStampError);
    expect(String((err as Error).message)).toMatch(why);
  };
  const good = () => JSON.parse(JSON.stringify(GOOD_STAMP)) as AnchorStamp;

  it("no stamp / not the version / not the count / not the list", () => {
    refuses(null, /no anchor version stamp/);
    refuses(undefined, /no anchor version stamp/);
    refuses({ ...good(), version: "embed_knn_v2" }, /not the audited embed_knn_v1/);
    refuses({ ...good(), n: 2271 }, /2271 rows/);
    refuses({ ...good(), anchors_sha256: "0000" }, /hashing 0000/);
  });

  it("no LOO / failed LOO / wrong k / wrong n / outside tolerance / another recipe / another list", () => {
    refuses({ ...good(), loo: null }, /no leave-one-out stamp/);
    refuses({ ...good(), loo: { ...good().loo!, passed: false } }, /did not pass/);
    refuses({ ...good(), loo: { ...good().loo!, k: 10 } }, /k=10/);
    refuses({ ...good(), loo: { ...good().loo!, n: 2000 } }, /covered 2000/);
    refuses({ ...good(), loo: { ...good().loo!, agreement: 0.841 } }, /not within 0.02 of 0.862/);
    refuses({ ...good(), loo: { ...good().loo!, agreement: 0.883 } }, /not within 0.02 of 0.862/);
    refuses({ ...good(), loo: { ...good().loo!, model: "gte-base" } }, /gte-base/);
    refuses({ ...good(), loo: { ...good().loo!, pooling: "cls" } }, /pooled by cls/);
    refuses({ ...good(), loo: { ...good().loo!, normalize: false } }, /not L2-normalised/);
    refuses({ ...good(), loo: { ...good().loo!, anchors_sha256: "beef" } }, /hashing beef/);
  });

  it("the edges of the tolerance are inside it (0.842 and 0.882 pass; 0.8622 passes)", () => {
    for (const a of [0.842, 0.8622, 0.882]) expect(() => assertAnchorStamp({ ...good(), loo: { ...good().loo!, agreement: a } })).not.toThrow();
  });

  it("readAnchorStamp parses the meta value defensively", () => {
    expect(readAnchorStamp(null)).toBeNull();
    expect(readAnchorStamp("embed_knn_v1")).toBeNull();
    expect(readAnchorStamp([])).toBeNull();
    expect(readAnchorStamp({ n: 5 })).toBeNull();
    expect(readAnchorStamp({ version: "embed_knn_v1", n: 2272, anchors_sha256: "ab", loo: { passed: true } })).toEqual({ version: "embed_knn_v1", n: 2272, anchors_sha256: "ab", loo: { passed: true } });
    expect(readAnchorStamp({ version: "embed_knn_v1", loo: "yes" })).toEqual({ version: "embed_knn_v1", n: undefined, anchors_sha256: null, loo: null });
  });
});

describe("the scorer is mechA's vote (other-bucket/mechA/classify.mjs knnPred), verbatim in semantics", () => {
  /** knnPred as it ran in the audit, over a pre-scored neighbourhood (sims given, no self-skip). */
  function knnPred(rows: KnnRow[], k: number) {
    const sims = rows.map((r, i) => [r.sim, i] as const);
    sims.sort((a, b) => b[0] - a[0]);
    const top = sims.slice(0, k);
    const share: Record<string, number> = {}, votes: Record<string, number> = {}; let tot = 0;
    for (const [s, i] of top) { const f = rows[i].field; share[f] = (share[f] || 0) + s; votes[f] = (votes[f] || 0) + 1; tot += s; }
    const ranked = Object.entries(share).map(([f, s]) => [f, s / tot] as const).sort((a, b) => b[1] - a[1]);
    const t1 = ranked[0][0];
    return { k_top1: t1, k_share1: +ranked[0][1].toFixed(4), k_votes1: votes[t1], k_top2: ranked[1]?.[0] ?? null, k_share2: +(ranked[1]?.[1] ?? 0).toFixed(4), k_nn1sim: +top[0][0].toFixed(4) };
  }

  it("agrees on top1, share (4 dp), votes, runner-up and nn1 across 2,000 seeded neighbourhoods of 15-40 rows", () => {
    for (let i = 0; i < 2000; i++) {
      const rows = randomNeighbourhood(15 + Math.floor(rnd() * 26));
      const a = scoreKnn(rows, EMBED_K)!;
      const b = knnPred(rows, EMBED_K);
      expect(a.top1).toBe(b.k_top1);
      expect(+a.share1.toFixed(4)).toBe(b.k_share1);
      expect(a.votes1).toBe(b.k_votes1);
      expect(+a.nn1.toFixed(4)).toBe(b.k_nn1sim);
      if (b.k_top2 !== null && Math.abs(b.k_share2 - (a.share2 ?? 0)) > 1e-4) throw new Error("runner-up share drifted");
      expect(a.k).toBe(EMBED_K);
    }
  });

  it("empty input, a bad k, and non-finite sims score to null / are dropped", () => {
    expect(scoreKnn([], 15)).toBeNull();
    expect(scoreKnn(rowsOf("finance", 3, 0.9), 0)).toBeNull();
    expect(scoreKnn([{ field: "finance", sim: Number.NaN }, { field: "sales", sim: 0.9 }], 15)?.top1).toBe("sales");
  });
});

describe("leave-one-out and the stamp it produces", () => {
  const unit = (v: number[]) => { const n = Math.sqrt(dot(v, v)) || 1; return v.map((x) => x / n); };
  const tiny = () => {
    const out: { field: string; embedding: number[] }[] = [];
    for (const [f, dim] of [["finance", 0], ["sales", 1], ["admin", 2]] as const) {
      for (let i = 0; i < 20; i++) { const v = new Array(8).fill(0); v[dim] = 1; v[3 + (i % 3)] = 0.2; out.push({ field: f, embedding: unit(v) }); }
    }
    return out;
  };

  it("three tight clusters of twenty agree 60/60; one planted stranger disagrees exactly once", () => {
    expect(looAgreement(tiny(), EMBED_K)).toEqual({ agreement: 1, agree: 60, n: 60, k: EMBED_K });
    const planted = tiny(); planted[0] = { field: "sales", embedding: planted[0].embedding }; // a finance vector labelled sales
    const r = looAgreement(planted, EMBED_K);
    expect(r.agree).toBe(59);
  });

  it("computeLooStamp never says passed for a set that is not the audited count, whatever its agreement", () => {
    const s = computeLooStamp(tiny(), "abc");
    expect(s).toMatchObject({ agreement: 1, agree: 60, n: 60, k: EMBED_K, passed: false, reference: EMBED_LOO_REFERENCE, tolerance: EMBED_LOO_TOLERANCE, model: "gte-small", pooling: "mean", normalize: true, anchors_sha256: "abc" });
    expect(() => assertAnchorStamp({ version: EMBED_ANCHOR_VERSION, n: 60, anchors_sha256: EMBED_ANCHORS_SHA256, loo: s })).toThrow(AnchorStampError);
  });

  it("computeLooStamp at the audited count says passed only inside the tolerance (2,272 identical-per-field vectors agree 100%: not passed)", () => {
    const set: { field: string; embedding: number[] }[] = [];
    for (let i = 0; i < EMBED_ANCHOR_COUNT; i++) { const f = i % 17; const v = new Array(20).fill(0); v[f] = 1; v[17 + (i % 3)] = 0.1; set.push({ field: `f${f}`, embedding: unit(v) }); }
    const s = computeLooStamp(set, "abc");
    expect(s.n).toBe(EMBED_ANCHOR_COUNT);
    expect(s.agreement).toBe(1);
    expect(s.passed).toBe(false);
  });
});

describe("centroids: a veto, never a vote", () => {
  it("buildCentroids L2-normalises the per-field mean; centroidTop1 returns the nearest and its margin", () => {
    const c = buildCentroids([
      { field: "finance", embedding: [1, 0, 0] }, { field: "finance", embedding: [1, 1, 0] },
      { field: "sales", embedding: [0, 0, 1] },
    ]);
    const fin = c.get("finance")!;
    expect(Math.sqrt(dot(fin, fin))).toBeCloseTo(1, 10);
    expect(fin[0]).toBeCloseTo(2 / Math.sqrt(5), 10);
    const t = centroidTop1([1, 0, 0], c)!;
    expect(t.field).toBe("finance");
    expect(t.margin).toBeCloseTo(2 / Math.sqrt(5) - 0, 10);
    expect(centroidTop1([0, 0, 1], new Map())).toBeNull();
  });
});

describe("the proposal is what shadow.ts's first-claim resolver takes, and shadow.ts re-refuses a barred target", () => {
  it("embedToShadow accepts a resolveEmbed proposal as an embed-basis proposal under the anchor version", () => {
    const p = resolveEmbed([...rowsOf("finance", 12, 0.9), ...rowsOf("operations", 3, 0.9)], "finance", GOOD_STAMP)!;
    expect(shadow.embedToShadow(p)).toEqual({ basis: "embed", key: EMBED_ANCHOR_VERSION, target: "finance", confidence: p.confidence });
  });

  it("resolveShadowRow on a title the rules and the employer table are silent on claims by embed alone", () => {
    const p = resolveEmbed(rowsOf("finance", 15, 0.9), "finance", GOOD_STAMP)!;
    const res = shadow.resolveShadowRow({ title: "Zqxv Wbrt Plmn", embed: p });
    expect(res.kind).toBe("claim");
    if (res.kind === "claim") expect(res.proposal).toMatchObject({ basis: "embed", key: EMBED_ANCHOR_VERSION, target: "finance" });
  });

  it("a proposal forged with a barred target, a stale key or a share under the gate is refused by shadow.ts too", () => {
    expect(shadow.embedToShadow({ field: "product", key: EMBED_ANCHOR_VERSION, confidence: 1 })).toBeNull();
    expect(shadow.embedToShadow({ field: "finance", key: "embed_knn_v0", confidence: 1 })).toBeNull();
    expect(shadow.embedToShadow({ field: "finance", key: EMBED_ANCHOR_VERSION, confidence: 0.59 })).toBeNull();
    expect(shadow.embedToShadow({ field: "other", key: EMBED_ANCHOR_VERSION, confidence: 1 })).toBeNull();
  });

  it("fuzz: every resolveEmbed proposal is accepted by embedToShadow with the same target and confidence", () => {
    let n = 0;
    for (let i = 0; i < 2000 && n < 200; i++) {
      const rows = randomNeighbourhood();
      const s = scoreKnn(rows, EMBED_K)!;
      const p = resolveEmbed(rows, s.top1, GOOD_STAMP);
      if (!p) continue;
      n++;
      expect(shadow.embedToShadow(p)).toEqual({ basis: "embed", key: EMBED_ANCHOR_VERSION, target: p.field, confidence: p.confidence });
    }
    expect(n).toBe(200);
  });
});

describe("the module is pure: no client, no write, no `category`", () => {
  it("imports only board-domains, categories (types) and shadow", () => {
    const imports = [...moduleSrc.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(imports)).toEqual(new Set(["../_shared/board-domains.ts", "./categories.ts", "./shadow.ts"]));
  });

  it("performs no database or network call and names no shadow or category column (comment-stripped)", () => {
    for (const bad of [/\.from\(/, /supabase/i, /\bfetch\(/, /\.rpc\(/, /upsert/i, /\bUPDATE\b/, /\bDeno\b/, /category_proposed/, /category_basis/, /category_key/, /\bcategory\b/]) {
      expect(moduleSrc, `module must not contain ${bad}`).not.toMatch(bad);
    }
  });

  it("teeth: the same checks catch a copy that grew a write", () => {
    const grown = moduleSrc + `\nexport async function write(db: { from: (t: string) => { update: (p: unknown) => unknown } }) { return db.from("job_board_postings").update({ category: "finance" }); }\n`;
    expect(grown).toMatch(/\.from\(/);
    expect(grown).toMatch(/\bcategory\b/);
  });
});
