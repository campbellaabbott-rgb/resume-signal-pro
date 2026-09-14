// Builds supabase/functions/job-board/data/category-anchors.json — the frozen
// anchor list the embed classifier votes over — from the hand-labelled pass
// (other-bucket/labelled-basis.jsonl, 3,060 rows whose stored category was
// re-derived and attributed to a basis).
//
// The list is exactly mechA's (other-bucket/mechA/classify.mjs): labelled rows
// whose basis is 'title' or 'title+dept' — the 415 department-decided rows are
// EXCLUDED, because they teach the classifier that 'Cashier' is customer and
// 'Software Engineer' is science — deduped on (lower(title), field) so cloned
// postings cannot stack kNN votes. 2,272 anchors across the 17 fields.
//
// Title-only by construction: neither company nor department reaches the file
// (the id is a content hash of the title+field pair, not a posting id, so no
// employer token rides along). Any change to the list is a new anchor set and
// must ship under a new EMBED_ANCHOR_VERSION (the guard
// an-anchor-set-is-frozen-under-its-version.test.ts pins the hash), and the
// LOO stamp is left null here: scripts/category-anchors-loo.mjs embeds the
// list and writes the stamp only when the leave-one-out figure reproduces.
//
// Usage: node scripts/build-category-anchors.mjs <path/to/labelled-basis.jsonl>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/build-category-anchors.mjs <labelled-basis.jsonl>"); process.exit(2); }
const OUT = "supabase/functions/job-board/data/category-anchors.json";
const VERSION = "embed_knn_v1";
const FIELDS = new Set(["engineering","data_ai","design","product","marketing","sales","customer","finance","legal","people_hr","operations","healthcare","science","education","hospitality_retail","security","admin"]);

const rows = readFileSync(src, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const eligible = rows.filter((r) => r.basis === "title" || r.basis === "title+dept");
const seen = new Set();
const anchors = [];
for (const r of eligible) {
  const title = String(r.title).trim();
  const field = String(r.slug);
  if (!FIELDS.has(field)) throw new Error(`labelled row in a non-field slug: ${field}`);
  const k = title.toLowerCase() + "|" + field;
  if (seen.has(k)) continue;
  seen.add(k);
  anchors.push({ id: createHash("sha1").update(k).digest("hex").slice(0, 16), field, title });
}
anchors.sort((a, b) => a.field.localeCompare(b.field) || a.title.localeCompare(b.title));
const sha = createHash("sha256").update(JSON.stringify(anchors)).digest("hex");
const doc = {
  version: VERSION,
  model: "gte-small",
  pooling: "mean",
  normalize: true,
  dim: 384,
  built_from: "other-bucket/labelled-basis.jsonl (basis in title, title+dept; deduped on lower(title), field)",
  labelled_rows: rows.length,
  eligible_rows: eligible.length,
  n: anchors.length,
  anchors_sha256: sha,
  loo: null,
  anchors,
};
writeFileSync(OUT, JSON.stringify(doc, null, 0).replace(/\{"id"/g, '\n{"id"') + "\n");
console.log(`labelled ${rows.length}, eligible ${eligible.length}, anchors ${anchors.length}, sha256 ${sha}`);
const perField = {};
for (const a of anchors) perField[a.field] = (perField[a.field] ?? 0) + 1;
console.log(JSON.stringify(perField));
console.log(`wrote ${OUT}`);
