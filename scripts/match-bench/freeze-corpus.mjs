#!/usr/bin/env node
// FREEZE THE MATCH BENCH'S CORPUS: every posting the BEFORE bench and the
// accuracy prototype read from the live board on 2026-10-12 (read-only list and
// detail calls, already cached), into one gzipped file the CI gate replays.
//
//   node scripts/match-bench/freeze-corpus.mjs <before-bench-dir> <prototype-bench-dir>
//     -> src/test/fixtures/match-bench/corpus.json.gz
//
// Each bench dir is the one the 2026-10-12 design work left (README.md,
// cache/board/list-*.json and detail-*.json, out/scored.json,
// out/descriptions.json). Nothing is fetched: this reads the caches only.
//
// What goes in:
//   postings     the union of every list row, BEFORE's own rows first so its
//                replay sees exactly the metadata it judged
//   descriptions the stored description text for the rows that have one,
//                BEFORE's own descriptions.json first (same reason)
//   before       per résumé, BEFORE's display order (rank, fit) and which rows
//                its judge had a description for: replaying this through the
//                ported judge must reproduce P@10 14.5 / P@20 10.0 exactly
//
// Postings are employers' public job ads. No résumé text is in the corpus.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [beforeDir, protoDir] = process.argv.slice(2);
if (!beforeDir || !protoDir) {
  console.error("usage: node scripts/match-bench/freeze-corpus.mjs <before-bench-dir> <prototype-bench-dir>");
  process.exit(2);
}
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/test/fixtures/match-bench/corpus.json.gz");
const NOW = "2026-10-12T12:00:00Z";
const KEEP = ["id", "source", "token", "company", "title", "location", "remote", "workMode", "employmentType", "country", "category",
  "postedAt", "lastSeen", "experienceBand", "minYears", "agency", "salary", "salaryMinAnnual", "salaryMaxAnnual", "salaryPeriod", "salaryCurrency"];
const pick = (r) => Object.fromEntries(KEEP.map((k) => [k, r[k] ?? null]));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const textOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? (v.text ?? v.description ?? null) : null);

const postings = new Map();
const descriptions = new Map();
const putDesc = (id, v) => { const t = textOf(v); if (t && typeof t === "string" && !descriptions.has(id)) descriptions.set(id, t); };

// 1. BEFORE's own rows and descriptions, first.
const scored = readJson(join(beforeDir, "out/scored.json"));
const beforeDescs = readJson(join(beforeDir, "out/descriptions.json"));
for (const s of scored) for (const x of s.ranked) if (!postings.has(x.row.id)) postings.set(x.row.id, pick(x.row));
for (const [id, v] of Object.entries(beforeDescs)) putDesc(id, v);

// 2. Every cached list row and detail description, both benches.
for (const dir of [beforeDir, protoDir]) {
  const cache = join(dir, "cache/board");
  for (const f of readdirSync(cache).sort()) {
    const j = readJson(join(cache, f));
    const data = j?.data ?? {};
    if (f.startsWith("list-")) for (const r of data.jobs ?? []) { if (r?.id && !postings.has(r.id)) postings.set(r.id, pick(r)); }
    if (f.startsWith("detail-") && data.job?.id) {
      if (!postings.has(data.job.id)) postings.set(data.job.id, pick(data.job));
      putDesc(data.job.id, data.description ?? data.job.description);
    }
  }
  const d = join(dir, "out/descriptions.json");
  if (existsSync(d)) for (const [id, v] of Object.entries(readJson(d))) putDesc(id, v);
}
const prior = join(beforeDir, "cache/prior-descriptions.json");
if (existsSync(prior)) for (const [id, v] of Object.entries(readJson(prior))) putDesc(id, v);
for (const id of [...descriptions.keys()]) if (!postings.has(id)) descriptions.delete(id);

const before = scored.map((s) => ({
  id: s.id, q: s.q, exact: s.exact, poolSize: s.poolSize,
  ranked: s.ranked.map((x) => ({ id: x.row.id, fit: typeof x.fit === "number" ? x.fit : null })),
  judgeHadDescription: s.ranked.map((x) => x.row.id).filter((id) => !!textOf(beforeDescs[id])),
}));

const corpus = {
  version: 1,
  now: NOW,
  note: "Postings the 2026-10-12 match bench read from the live board (read-only list/detail, cached). Employers' public job ads; no résumé text.",
  postings: [...postings.values()].sort((a, b) => a.id.localeCompare(b.id)),
  descriptions: Object.fromEntries([...descriptions.entries()].sort(([a], [b]) => a.localeCompare(b))),
  before,
};
const gz = gzipSync(Buffer.from(JSON.stringify(corpus)), { level: 9 });
if (gz.length > 4 * 1024 * 1024) { console.error(`corpus is ${gz.length} bytes, over the 4 MB the spec allows`); process.exit(1); }
writeFileSync(OUT, gz);
console.log(`postings ${corpus.postings.length}, descriptions ${descriptions.size}, BEFORE résumés ${before.length}, ${(gz.length / 1e6).toFixed(2)} MB -> ${OUT}`);
