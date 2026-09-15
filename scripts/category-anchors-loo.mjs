// THE LEAVE-ONE-OUT GATE for the embed classifier's anchor set.
//
// Embeds every anchor title in data/category-anchors.json with gte-small under
// the SAME recipe the edge runtime uses (index.ts embedText: mean pooling,
// L2-normalised, 384 dims), scores each anchor against all the others with the
// module's own kNN vote (embed-classify.ts looAgreement — the code that ships),
// and requires the agreement to land within EMBED_LOO_TOLERANCE of the audited
// EMBED_LOO_REFERENCE (other-bucket/mechA: 1,959 / 2,272 = 0.8622). Only then
// does --write stamp the JSON — with the module's own computeLooStamp, so the
// stamp on disk is the stamp the runtime loader would write; resolveEmbed
// refuses to score against a stored anchor set without a passing stamp, so an
// anchor list that was embedded differently from the audited one can never
// reach a row.
//
// --compare <mechA/embeddings.json> additionally asserts the pooling matches:
// every anchor's vector must be cosine >= 0.9999 to mechA's for the same title.
// --vectors <out.json> saves the embeddings ({id, field, title, embedding}[]) so
// scripts/verify-migration-20260909224500.mjs can load the real set into
// pglite and reproduce the figure THROUGH category_knn.
//
// The model runs through @xenova/transformers, which is not a dependency of
// this repo: point GTE_TRANSFORMERS_ROOT at a directory whose node_modules has
// it (the other-bucket scratchpad does) and GTE_MODEL_CACHE at a cache holding
// Xenova/gte-small (the same scratchpad's mechA/model-cache), or install it.
//
// Usage: node scripts/category-anchors-loo.mjs [--write] [--compare <embeddings.json>] [--vectors <out.json>]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ANCHORS = "scripts/data/category-anchors.json";
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const WRITE = args.includes("--write");
const COMPARE = flag("--compare");
const VECTORS = flag("--vectors");

const mod = await import(pathToFileURL(resolve("supabase/functions/job-board/embed-classify.ts")).href);
const {
  EMBED_K, EMBED_LOO_REFERENCE, EMBED_LOO_TOLERANCE, EMBED_ANCHOR_VERSION, EMBED_ANCHOR_COUNT, EMBED_ANCHORS_SHA256,
  EMBED_MODEL, EMBED_POOLING, EMBED_NORMALIZE, EMBED_DIM, computeLooStamp, assertAnchorStamp, dot,
} = mod;

async function loadTransformers() {
  try { return await import("@xenova/transformers"); } catch { /* not installed here */ }
  const root = process.env.GTE_TRANSFORMERS_ROOT;
  if (!root) throw new Error("@xenova/transformers is not installed; set GTE_TRANSFORMERS_ROOT to a directory whose node_modules has it");
  const entry = resolve(root, "node_modules/@xenova/transformers/src/transformers.js");
  if (!existsSync(entry)) throw new Error(`no @xenova/transformers under ${root}`);
  return await import(pathToFileURL(entry).href);
}

const doc = JSON.parse(readFileSync(ANCHORS, "utf8"));
const sha = createHash("sha256").update(JSON.stringify(doc.anchors)).digest("hex");
if (sha !== doc.anchors_sha256) throw new Error(`anchors_sha256 in the file (${doc.anchors_sha256}) does not match its anchors (${sha}); rebuild with build-category-anchors.mjs`);
if (sha !== EMBED_ANCHORS_SHA256) throw new Error(`the file's anchors hash ${sha}, EMBED_ANCHORS_SHA256 pins ${EMBED_ANCHORS_SHA256}: a changed list needs a new EMBED_ANCHOR_VERSION and a new pin`);
if (doc.version !== EMBED_ANCHOR_VERSION) throw new Error(`file version ${doc.version} != EMBED_ANCHOR_VERSION ${EMBED_ANCHOR_VERSION}`);
if (doc.anchors.length !== EMBED_ANCHOR_COUNT) throw new Error(`file holds ${doc.anchors.length} anchors, EMBED_ANCHOR_COUNT is ${EMBED_ANCHOR_COUNT}`);
if (doc.model !== EMBED_MODEL || doc.pooling !== EMBED_POOLING || doc.normalize !== EMBED_NORMALIZE || doc.dim !== EMBED_DIM) throw new Error("the file's recipe is not the module's");

const { pipeline, env } = await loadTransformers();
if (process.env.GTE_MODEL_CACHE) env.cacheDir = process.env.GTE_MODEL_CACHE;
const t0 = Date.now();
const extract = await pipeline("feature-extraction", "Xenova/gte-small", { quantized: false });
console.log(`gte-small loaded in ${Date.now() - t0} ms`);

const titles = doc.anchors.map((a) => a.title);
const vectors = new Array(titles.length);
const B = 64;
for (let i = 0; i < titles.length; i += B) {
  const batch = titles.slice(i, i + B);
  const res = await extract(batch, { pooling: EMBED_POOLING, normalize: EMBED_NORMALIZE });
  const dim = res.dims[1];
  if (dim !== EMBED_DIM) throw new Error(`model produced ${dim} dims, expected ${EMBED_DIM}`);
  for (let j = 0; j < batch.length; j++) vectors[i + j] = Array.from(res.data.slice(j * dim, (j + 1) * dim));
}
console.log(`embedded ${vectors.length} anchors in ${Date.now() - t0} ms`);
// L2 check: every vector unit-length (normalize: true), the recipe index.ts uses.
let worstNorm = 0;
for (const v of vectors) worstNorm = Math.max(worstNorm, Math.abs(Math.sqrt(dot(v, v)) - 1));
console.log(`max |norm - 1| = ${worstNorm.toExponential(2)}`);
if (worstNorm > 1e-3) throw new Error("vectors are not L2-normalised");

if (COMPARE) {
  const ref = JSON.parse(readFileSync(COMPARE, "utf8"));
  const refVectors = ref.vectors ?? ref;
  let minCos = 1, missing = 0;
  for (let i = 0; i < titles.length; i++) {
    const r = refVectors[titles[i]];
    if (!r) { missing++; continue; }
    minCos = Math.min(minCos, dot(vectors[i], r));
  }
  console.log(`pooling check vs ${COMPARE}: min cosine ${minCos.toFixed(6)} over ${titles.length - missing} shared titles (${missing} missing)`);
  if (missing > 0 || minCos < 0.9999) throw new Error("the embeddings do not match mechA's: pooling or normalisation differs");
}

const anchors = doc.anchors.map((a, i) => ({ field: a.field, embedding: vectors[i] }));
const t1 = Date.now();
const stamp = computeLooStamp(anchors, sha);
console.log(`LOO kNN agreement at k=${EMBED_K}: ${stamp.agree}/${stamp.n} = ${stamp.agreement.toFixed(4)} (expected ${EMBED_LOO_REFERENCE} +/- ${EMBED_LOO_TOLERANCE}) -> ${stamp.passed ? "PASS" : "FAIL"} in ${Date.now() - t1} ms`);

if (VECTORS) {
  writeFileSync(VECTORS, JSON.stringify({ version: doc.version, anchors_sha256: sha, model: EMBED_MODEL, pooling: EMBED_POOLING, normalize: EMBED_NORMALIZE, dim: EMBED_DIM, rows: doc.anchors.map((a, i) => ({ id: a.id, field: a.field, title: a.title, embedding: vectors[i].map((x) => +x.toFixed(6)) })) }));
  console.log(`wrote ${VECTORS}`);
}

if (!stamp.passed) process.exit(1);
// The stamp must satisfy the runtime's own reader before it is written.
assertAnchorStamp({ version: doc.version, n: doc.anchors.length, anchors_sha256: sha, loo: stamp });
if (WRITE) {
  doc.loo = { ...stamp, runtime: "node:@xenova/transformers Xenova/gte-small (unquantized)" };
  const { anchors: list, ...head } = doc;
  writeFileSync(ANCHORS, JSON.stringify({ ...head, anchors: list }, null, 0).replace(/\{"id"/g, '\n{"id"') + "\n");
  console.log(`stamped ${ANCHORS}`);
}
