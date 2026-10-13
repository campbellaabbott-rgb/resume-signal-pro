// DESCRIPTIONS FOR THE ROWS A RUN SHOWS: what the rubric reads sponsorship,
// citizenship, clearance and licence wording from, and what a hand review needs.
//
// Spec §19.2: BEFORE and AFTER are judged with full descriptions for every
// top-20 row. The frozen corpus holds 618; the rest come, in order, from
//   1. the corpus (src/test/fixtures/match-bench/corpus.json.gz),
//   2. this bench's cache (cache/board/detail-*.json),
//   3. a live job-board `detail` call, read-only, from a named ledger (live.ts).
// `detail` returns the stored description, or fetches and stores one when none
// is stored; the two cannot be told apart from outside.
//
// usage:
//   ./node_modules/.bin/tsx scripts/match-bench/describe.ts --after out/after-extract.json
//   ./node_modules/.bin/tsx scripts/match-bench/describe.ts --before heldout
//   MATCH_LEDGER=after-2026-10 MATCH_PROBE_CAP=900 ... (to go live)
//   ... --freeze   add what was read (and, for --before, the pool rows) to the corpus under a new
//                  version; then re-record the baselines (report.ts --save-before / --save-after)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { FIX, OUT, ROOT } from "./paths.ts";
import { board, ledger, probesUsed } from "./live.ts";
import { loadCorpus } from "../../src/test/fixtures/match-bench/corpus.ts";
import { scrubPersonal } from "../../src/test/fixtures/match-bench/scrub.ts";

const DESC_CHARS = 20_000;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const afterFile = arg("--after");
const beforeSet = arg("--before");
if (!afterFile && !beforeSet) throw new Error("usage: describe.ts --after out/after-extract.json | --before dev|heldout [--freeze]");

const want: Array<{ id: string; row?: Record<string, unknown> }> = [];
let tag: string;
if (afterFile) {
  const shown = JSON.parse(readFileSync(resolve(ROOT, afterFile), "utf8")) as Record<string, string[]>;
  for (const ids of Object.values(shown)) for (const id of ids.slice(0, 20)) want.push({ id });
  tag = "after";
} else {
  const r = JSON.parse(readFileSync(join(OUT, `before-${beforeSet}-retrieval.json`), "utf8"));
  for (const p of Object.values<any>(r.pools)) for (const row of p.rows) want.push({ id: row.id, row });
  tag = `before-${beforeSet}`;
}
const unique = [...new Map(want.map((w) => [w.id, w])).values()];

const corpus = loadCorpus();
const outFile = join(OUT, `descriptions-${tag}.json`);
const descs: Record<string, { text: string | null; source: string; status?: number }> = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
let fromCorpus = 0, fromCache = 0, live = 0, failed = 0;
for (const { id } of unique) {
  if (descs[id]?.text) continue;
  const c = corpus.description(id);
  if (c) { descs[id] = { text: c, source: `corpus:${corpus.descriptionSource(id)}` }; fromCorpus++; continue; }
  const cached = await board({ action: "detail", id }, { offline: true });
  if (cached.data) { descs[id] = { text: (cached.data as any).description ?? null, source: "bench-cache", status: cached.status }; fromCache++; continue; }
  const L = ledger();
  if (!L || process.env.MATCH_OFFLINE === "1") continue;
  if (probesUsed(L.file) >= L.cap) { console.log(`stopping: ledger ${L.name} has spent its ${L.cap}`); break; }
  const res = await board({ action: "detail", id });
  live++;
  if (res.status === 200) descs[id] = { text: (res.data as any)?.description ?? null, source: `live:${L.name}`, status: 200 };
  else { failed++; descs[id] = { text: null, source: `live-failed:${L.name}`, status: res.status }; }
  writeFileSync(outFile, JSON.stringify(descs));
}
writeFileSync(outFile, JSON.stringify(descs));
const have = unique.filter((w) => descs[w.id]?.text).length;
console.log(`${tag}: ${unique.length} rows, ${have} with a description (corpus ${fromCorpus}, cache ${fromCache}, live ${live}, failed ${failed}); wrote ${outFile}`);

if (process.argv.includes("--freeze")) {
  const file = join(FIX, "corpus.json.gz");
  const raw = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  const ids = new Set(raw.rows.map((r: { id: string }) => r.id));
  let rowsAdded = 0, descAdded = 0;
  for (const w of unique) {
    if (!ids.has(w.id) && w.row) {
      const j = w.row;
      raw.rows.push({
        id: w.id, source: j.source ?? null, token: j.token ?? null, company: j.company ?? null, title: j.title ?? null, location: j.location ?? null,
        country: j.country ?? null, remote: j.remote ?? null, workMode: j.workMode ?? null, employmentType: j.employmentType ?? null,
        department: j.department ?? null, category: j.category ?? null, postedAt: j.postedAt ?? null, lastSeen: j.lastSeen ?? null,
        missingSince: j.missingSince ?? null, salary: j.salary ?? null, salaryMinAnnual: j.salaryMinAnnual ?? null, salaryMaxAnnual: j.salaryMaxAnnual ?? null,
        salaryPeriod: j.salaryPeriod ?? null, salaryCurrency: j.salaryCurrency ?? null, experienceBand: j.experienceBand ?? null,
        minYears: j.minYears ?? null, agency: j.agency ?? null, origin: tag,
      });
      ids.add(w.id);
      rowsAdded++;
    }
    const d = descs[w.id];
    if (ids.has(w.id) && d?.text && !raw.descriptions[w.id]) {
      raw.descriptions[w.id] = { text: scrubPersonal(d.text.slice(0, DESC_CHARS)), source: d.source };
      descAdded++;
    }
  }
  const n = Number(String(raw.version).split(".").pop()) + 1;
  raw.version = String(raw.version).replace(/\.\d+$/, `.${n}`);
  writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(raw)), { level: 9 }));
  console.log(`froze ${rowsAdded} rows and ${descAdded} descriptions into ${raw.version}; re-record the baselines next`);
}
