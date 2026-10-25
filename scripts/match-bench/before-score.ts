// BEFORE, STEP 4: SCORE AND ORDER EXACTLY AS TODAY'S PRODUCT DOES, LOCALLY.
//
// job-fit fit-batch, per call of <=20 ids: scan = scanResume(text) once per
// call; a row with description.length > 150 gets
// computeFit(description.slice(0, 20000), scan, 40, min_years).pct, else null.
// The client sends the 60-row page as three sequential calls of 20 and orders
// it with a STABLE partition: scored rows by fit descending, then every
// unscored row in the server's order. job-fit itself is never called.
//
// Row status: scored | null (text held, <=150 chars) | unknown (never read:
// the pool is then bounded, not exact, and the report says so).
//
// Reads out/before-<set>-retrieval.json and out/descriptions-before-<set>.json;
// writes out/before-<set>-scored.json, the shape of the frozen dev result.
// usage: ./node_modules/.bin/tsx scripts/match-bench/before-score.ts --set heldout
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIX, OUT } from "./paths.ts";
import { computeFit, resumeYears, scanResume } from "../../supabase/functions/_shared/fit-score.ts";

const FIT_BATCH = 20, FIT_DESC_CHARS = 20_000;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SET = (arg("--set") ?? "heldout") as "dev" | "heldout";
const r = JSON.parse(readFileSync(join(OUT, `before-${SET}-retrieval.json`), "utf8"));
const descs: Record<string, { text: string | null; source: string }> = JSON.parse(readFileSync(join(OUT, `descriptions-before-${SET}.json`), "utf8"));

const out: any[] = [];
for (const pr of r.perResume) {
  const text = readFileSync(join(FIX, SET, "parsed", `${pr.id}.pdf.txt`), "utf8");
  const rows = r.pools[pr.sig].rows as any[];
  const scored: any[] = [];
  const batchMs: number[] = [];
  for (let i = 0; i < rows.length; i += FIT_BATCH) {
    const t0 = performance.now();
    const scan = scanResume(text);
    for (const row of rows.slice(i, i + FIT_BATCH)) {
      const d = descs[row.id];
      if (!d) { scored.push({ row, status: "unknown", fit: null }); continue; }
      if (d.text && d.text.length > 150) {
        const f = computeFit(d.text.slice(0, FIT_DESC_CHARS), scan, 40, typeof row.minYears === "number" ? row.minYears : null);
        scored.push({ row, status: f.pct == null ? "null" : "scored", fit: f.pct });
      } else {
        scored.push({ row, status: "null", fit: null });
      }
    }
    batchMs.push(Math.round((performance.now() - t0) * 10) / 10);
  }
  const withScore = scored.filter((s) => typeof s.fit === "number").sort((a, b) => b.fit - a.fit);
  const without = scored.filter((s) => typeof s.fit !== "number");
  const ranked = [...withScore, ...without].map((s, i) => ({ rank: i + 1, poolRank: s.row.rank, status: s.status, fit: s.fit, row: s.row }));
  const unknown = scored.filter((s) => s.status === "unknown").length;
  out.push({
    id: pr.id, q: pr.q, terms: pr.terms, poolSize: rows.length, exact: unknown === 0,
    counts: { scored: withScore.length, null: scored.filter((s) => s.status === "null").length, unknown },
    resumeYears: resumeYears(text), fitCpuMsPerBatch: batchMs, termsCpuMs: pr.termsMs, listMs: r.pools[pr.sig].ms, ranked,
  });
  console.log(`${pr.id.padEnd(42)} q=${String(pr.q).padEnd(24)} exact=${unknown === 0 ? "Y" : "n"} scored ${withScore.length} unknown ${unknown}`);
}
writeFileSync(join(OUT, `before-${SET}-scored.json`), JSON.stringify(out, null, 1));
console.log(`wrote out/before-${SET}-scored.json`);
