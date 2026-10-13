// BEFORE, STEP 2: RETRIEVAL EXACTLY AS TODAY'S "FOR YOU" PATH DOES IT.
//
// src/pages/Jobs.tsx retrieveForResume():
//   job-fit {action:"fit-terms"} -> resumeRoleTerms(text, 4) -> setQ(terms[0])
// and the list fetch the query change triggers (fetchJobs, offset 0):
//   { action:"list", q, limit: 60, offset: 0, includeFacets: false }
//   - no sort, no location, no country, no work mode: the résumé never reaches filters;
//   - hasDescription only when there is NO query.
// fit-terms is pure CPU, so it runs here from the product's own module (the
// résumé never leaves this machine).
//
// The dev set's BEFORE result is frozen in src/test/fixtures/match-bench/
// before/ranked.json; this step exists to measure BEFORE on the HELD-OUT set
// with the same rubric as AFTER (spec §19.2), from a named ledger:
//   MATCH_LEDGER=after-2026-10 MATCH_PROBE_CAP=900 ./node_modules/.bin/tsx scripts/match-bench/before-retrieve.ts --set heldout
//   MATCH_OFFLINE=1 ... (cache only)
// Writes out/before-<set>-retrieval.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIX, OUT } from "./paths.ts";
import { board } from "./live.ts";
import { RESUMES } from "../../src/test/fixtures/match-bench/dev/manifest.ts";
import { HELDOUT } from "../../src/test/fixtures/match-bench/heldout/manifest.ts";
import { resumeRoleTerms } from "../../supabase/functions/_shared/fit-score.ts";

const PAGE = 60;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SET = (arg("--set") ?? "heldout") as "dev" | "heldout";
const items = SET === "dev" ? RESUMES : HELDOUT;
mkdirSync(OUT, { recursive: true });

export function listBody(q: string | null): Record<string, unknown> {
  return q
    ? { action: "list", q, limit: PAGE, offset: 0, includeFacets: false }
    : { action: "list", hasDescription: true, limit: PAGE, offset: 0, includeFacets: false };
}

const pools: Record<string, any> = {};
const perResume: any[] = [];
for (const r of items) {
  const text = readFileSync(join(FIX, SET, "parsed", `${r.id}.pdf.txt`), "utf8");
  const t0 = performance.now();
  const terms: string[] = resumeRoleTerms(text, 4);
  const termsMs = performance.now() - t0;
  const q = terms[0] ?? null;
  const body = listBody(q);
  const sig = JSON.stringify(body);
  if (!pools[sig]) {
    const res = await board(body);
    const d = res.data as any;
    pools[sig] = {
      q, body, status: res.status, ms: res.ms, cached: res.cached, build: res.build, at: res.at,
      total: d?.total ?? null, rows: (d?.jobs ?? []).map((j: any, i: number) => ({ rank: i + 1, ...j })),
    };
    console.log(`${String(q).padEnd(28)} status ${res.status} ${res.cached ? "(cache)" : `${res.ms} ms`} rows ${pools[sig].rows.length}`);
  }
  perResume.push({ id: r.id, terms, q, sig, termsMs: Math.round(termsMs * 10) / 10 });
}
writeFileSync(join(OUT, `before-${SET}-retrieval.json`), JSON.stringify({ set: SET, perResume, pools }, null, 1));
console.log(`\n${Object.keys(pools).length} distinct list bodies; wrote out/before-${SET}-retrieval.json`);
