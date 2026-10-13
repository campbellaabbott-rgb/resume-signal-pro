// ONE-TIME: DISTIL THE 2026-10-12 BENCH CACHES INTO THE COMMITTED FIXTURES.
//
// The BEFORE bench and the two prototypes each kept a cache of the read-only
// job-board answers they used (list and detail, anon key, x-rb-budget: probe).
// This turns those caches into what the regression gate needs, and nothing
// else:
//
//   src/test/fixtures/match-bench/corpus.json.gz
//       every posting any of the three runs saw (list rows, plus each list
//       row's collapsed sibling postings as rows of their own), with the
//       fields match_candidates returns, and every description any run read
//       (cut at 20,000 characters, the length fit-batch and the requirement
//       reader use). Emails, phone numbers and profile URLs inside a
//       description are replaced with [email] / [phone] / [profile]. No
//       apply URLs, no tracking fields.
//   src/test/fixtures/match-bench/before/ranked.json
//       the BEFORE measurement frozen: per résumé, the query it ran, the pool
//       in the server's order and the order fit put it in, with each row's
//       metadata exactly as the judge saw it.
//   src/test/fixtures/match-bench/baselines/proto-top20.json
//       the Requirements-First prototype's shown rows per résumé (extractor
//       profile and reader-confirmed "oracle" profile), ids in order.
//
// Run once, from the repo root, pointing at the directory that holds
// match-baseline-1012/, match-acc-1012/ and match-instant-1012/:
//   ./node_modules/.bin/tsx scripts/match-bench/build-corpus.ts --from <dir>
// It never touches the network.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { scrubPersonal } from "../../src/test/fixtures/match-bench/scrub.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "src/test/fixtures/match-bench");
const fromIdx = process.argv.indexOf("--from");
if (fromIdx < 0) throw new Error("usage: build-corpus.ts --from <dir holding match-baseline-1012/>");
const FROM = resolve(process.argv[fromIdx + 1]);
const RUNS = ["match-baseline-1012", "match-acc-1012", "match-instant-1012"];
const DESC_CHARS = 20_000;

type Row = Record<string, unknown> & { id: string };
const KEEP = [
  "id", "source", "token", "company", "title", "location", "country", "remote", "workMode", "employmentType",
  "department", "category", "postedAt", "lastSeen", "missingSince", "salary", "salaryMinAnnual", "salaryMaxAnnual",
  "salaryPeriod", "salaryCurrency", "experienceBand", "minYears", "agency",
] as const;
const pick = (j: Record<string, unknown>): Row => {
  const o: Row = { id: String(j.id) };
  for (const k of KEEP) if (k !== "id") o[k] = j[k] ?? null;
  return o;
};

const rows = new Map<string, Row>();
const origin = new Map<string, string>();
const descriptions = new Map<string, { text: string; source: string }>();
const addDesc = (id: unknown, text: unknown, source: string) => {
  if (typeof id !== "string" || typeof text !== "string" || !text.trim() || descriptions.has(id)) return;
  descriptions.set(id, { text: scrubPersonal(text.slice(0, DESC_CHARS)), source });
};
const addRow = (j: Record<string, unknown>, from: string) => {
  const id = String(j.id ?? "");
  if (!id || rows.has(id)) return;
  rows.set(id, pick(j));
  origin.set(id, from);
  for (const s of (j.siblings as Array<Record<string, unknown>> | undefined) ?? []) {
    const sid = String(s.id ?? "");
    if (!sid || rows.has(sid)) continue;
    rows.set(sid, { ...pick(j), id: sid, location: (s.location as string) ?? null, postedAt: (s.postedAt as string) ?? j.postedAt ?? null, siblingOf: id });
    origin.set(sid, `${from}:sibling`);
  }
};

// 1. BEFORE's own pool rows first: the judge saw exactly these.
const B = join(FROM, "match-baseline-1012");
const scored = JSON.parse(readFileSync(join(B, "out/scored.json"), "utf8"));
for (const s of scored) for (const x of s.ranked) addRow(x.row, "before-pool");
const bdesc = JSON.parse(readFileSync(join(B, "out/descriptions.json"), "utf8")) as Record<string, { text: string | null; source: string }>;
for (const [id, v] of Object.entries(bdesc)) addDesc(id, v.text, `before:${v.source.startsWith("prior") ? "prior" : v.source}`);

// 2. Every cached list and detail answer of the three runs.
for (const run of RUNS) {
  const dir = join(FROM, run, "cache", "board");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).sort()) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (f.startsWith("list-")) for (const j of c.data?.jobs ?? []) addRow(j, run);
    else if (f.startsWith("detail-")) {
      if (c.data?.job) addRow(c.data.job, `${run}:detail`);
      addDesc(c.data?.job?.id, c.data?.description, `${run}:detail`);
    }
  }
}

// A sibling posting carries its parent's text: the same requisition at another
// location. Marked so a reader can discount it.
let inherited = 0;
for (const r of rows.values()) {
  const parent = r.siblingOf as string | undefined;
  if (parent && !descriptions.has(r.id) && descriptions.has(parent)) {
    descriptions.set(r.id, { text: descriptions.get(parent)!.text, source: `sibling-of:${parent}` });
    inherited++;
  }
}

const corpus = {
  version: "match-bench-corpus.2026-10-12.1",
  frozenAt: "2026-10-12T12:00:00Z",
  note: "Read-only job-board answers cached by the BEFORE bench and the two prototypes on 2026-10-11/12. Descriptions cut at 20,000 characters; emails, phones and profile URLs scrubbed.",
  rows: [...rows.values()].map((r) => ({ ...r, origin: origin.get(r.id) })),
  descriptions: Object.fromEntries([...descriptions.entries()].sort(([a], [b]) => a.localeCompare(b))),
};
const gz = gzipSync(Buffer.from(JSON.stringify(corpus)), { level: 9 });
writeFileSync(join(FIX, "corpus.json.gz"), gz);
console.log(`corpus: ${corpus.rows.length} rows (${[...origin.values()].filter((o) => o.endsWith(":sibling")).length} siblings), ${descriptions.size} descriptions (${inherited} from a parent), ${(gz.length / 1e6).toFixed(2)} MB gzipped`);

// 3. The BEFORE measurement, frozen.
const JUDGED = ["id", "title", "company", "location", "country", "workMode", "remote", "minYears", "experienceBand", "category", "agency"] as const;
const before = scored.map((s: any) => ({
  id: s.id, q: s.q, terms: s.terms, poolSize: s.poolSize, exact: s.exact, counts: s.counts,
  resumeYears: s.resumeYears, listMs: s.listMs, fitCpuMsPerBatch: s.cpu.batchMs, termsCpuMs: s.cpu.termsMs,
  ranked: s.ranked.map((x: any) => ({
    rank: x.rank, poolRank: x.poolRank, status: x.status, fit: x.fit ?? null,
    row: Object.fromEntries(JUDGED.map((k) => [k, x.row[k] ?? null])),
  })),
}));
mkdirSync(join(FIX, "before"), { recursive: true });
writeFileSync(join(FIX, "before", "ranked.json"), JSON.stringify(before));
console.log(`before/ranked.json: ${before.length} résumés, ${before.filter((b: any) => b.exact).length} exact`);

// 4. The prototype's shown rows.
const proto: Record<string, { extract: string[]; oracle: string[] }> = {};
for (const kind of ["extract", "oracle"] as const) {
  const f = join(FROM, "match-acc-1012", "out", `proto-${kind}.json`);
  for (const r of JSON.parse(readFileSync(f, "utf8"))) {
    proto[r.id] ??= { extract: [], oracle: [] };
    proto[r.id][kind] = (r.top ?? []).map((t: any) => t.id);
  }
}
mkdirSync(join(FIX, "baselines"), { recursive: true });
writeFileSync(join(FIX, "baselines", "proto-top20.json"), JSON.stringify(proto, null, 1));
const missing = Object.values(proto).flatMap((p) => [...p.extract, ...p.oracle]).filter((id) => !rows.has(id));
console.log(`baselines/proto-top20.json: ${Object.keys(proto).length} résumés; shown ids not in the corpus: ${missing.length}`);

// 5. The hand judgments travel with the corpus (first run only: later hand
// reviews are recorded in the repo copy and must not be overwritten).
mkdirSync(join(FIX, "judgments"), { recursive: true });
for (const f of ["overrides.json", "posting-facts.json"]) {
  const to = join(FIX, "judgments", f);
  if (existsSync(to)) { console.log(`judgments/${f} kept (already in the repo)`); continue; }
  writeFileSync(to, readFileSync(join(B, "judgments", f), "utf8"));
  console.log(`judgments/${f} copied`);
}
