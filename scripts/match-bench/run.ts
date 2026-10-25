// THE MATCH BENCH, FROM THE COMMAND LINE.
//
//   npx tsx scripts/match-bench/run.ts            BEFORE replayed + v1 on the frozen corpus, printed
//   npx tsx scripts/match-bench/run.ts --save     also writes src/test/fixtures/match-bench/baseline.v1.json
//   npx tsx scripts/match-bench/run.ts --cpu      v1 with the real clock: per-call CPU and wall time
//   npx tsx scripts/match-bench/run.ts --rows     prints each résumé's top 20 with its verdict
//   npx tsx scripts/match-bench/run.ts --only=rn-mid-chicago,mk-ng-boston   just those résumés
//
// Offline: the corpus is frozen (scripts/match-bench/freeze-corpus.mjs), the
// database is pglite with the shipped migrations, résumés are the synthetic
// fixtures. Nothing here touches production or sends a résumé anywhere.
//
// What the numbers are: the v1 figures are DEV SET and AUTO-JUDGED (see
// src/test/fixtures/match-bench/bench.ts). BEFORE is hand-reviewed. No claim
// that v1 is better rests on these: that needs the held-out set, the AFTER
// probe budget and the same hand review (spec 19.2, owner decision 8).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootBenchDb, replayBefore, runV1 } from "../../src/test/fixtures/match-bench/bench";

const args = new Set(process.argv.slice(2));
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const OUT = resolve(process.cwd(), "src/test/fixtures/match-bench/baseline.v1.json");

async function main() {
  const b0 = replayBefore({ licences: false });
  const b1 = replayBefore({ licences: true });
  console.log("BEFORE (hand-reviewed, frozen display order)");
  console.log(`  licence unchecked (the 2026-10-12 judge): exact-11 P@10 ${b0.exactSet.p10} P@20 ${b0.exactSet.p20} location ${b0.exactSet.location}% seniority ${b0.exactSet.seniority}%; all-24 P@10 [${b0.allSet.p10Lower}, ${b0.allSet.p10Upper}] P@20 [${b0.allSet.p20Lower}, ${b0.allSet.p20Upper}]`);
  console.log(`  licence rule on:                          exact-11 P@10 ${b1.exactSet.p10} P@20 ${b1.exactSet.p20}; all-24 P@20 [${b1.allSet.p20Lower}, ${b1.allSet.p20Upper}]; licence fails ${b1.per.reduce((a, r) => a + r.licenceFails, 0)}`);

  const db = await bootBenchDb();
  for (const oracle of [false, true]) {
    const { per, summary: s } = await runV1(db, { licences: true, oracle, frozenClock: !args.has("--cpu"), only });
    console.log(`\nv1 (${oracle ? "strip corrected to the manifest" : "profile as the reader read it"}; dev set, auto-judged, licence rule on)`);
    console.log(`  exact-11 P@10 ${s.exact11.p10} P@20 ${s.exact11.p20}  location ${s.exact11.location}% (${s.exact11.locationPooled.join("/")} rows)  seniority ${s.exact11.seniority}% (${s.exact11.seniorityPooled.join("/")})`);
    console.log(`  all-24   P@10 ${s.all24.p10} P@20 ${s.all24.p20}  location ${s.all24.location}% (${s.all24.locationPooled.join("/")} rows)  seniority ${s.all24.seniority}% (${s.all24.seniorityPooled.join("/")})`);
    console.log(`  shown ${s.rows} rows; <10 shown ${s.under10}/24, <20 ${s.under20}/24, P@20 = 0 for ${s.zero}/24; hand-reviewed rows ${s.reviewed}; requirements not read ${s.notRead}; tiers ${JSON.stringify(s.tiers)}; licence fails ${s.licenceFails}`);
    if (args.has("--cpu")) console.log(`  cpu ms per call p50 ${s.cpuMs.p50} p90 ${s.cpuMs.p90} max ${s.cpuMs.max}; wall ms (pglite, local) p50 ${s.wallMs.p50} p90 ${s.wallMs.p90} max ${s.wallMs.max}`);
    for (const p of per) {
      console.log(`    ${p.id.padEnd(34)} ${String(p.p10).padStart(5)} ${String(p.p20).padStart(5)}  shown ${String(p.shown).padStart(2)} found ${String(p.found).padStart(3)} read ${String(p.read).padStart(2)} steps ${p.steps.join(">")} family ${p.family ?? "-"} ring ${p.ringSource}${p.deadlineMissed ? ` MISSED ${p.deadlineMissed}` : ""}${args.has("--cpu") ? ` cpu ${p.cpuMs} wall ${p.wallMs}` : ""}`);
      if (args.has("--rows")) for (const r of p.rows) console.log(`        ${r.verdict.shortlist ? "+" : "-"} ${r.tier.padEnd(7)} ${r.lane.padEnd(6)} ${r.title.slice(0, 48).padEnd(48)} ${(r.location ?? "").slice(0, 34).padEnd(34)} ${r.verdict.reasons.join("; ")}`);
    }
    if (args.has("--save") && !oracle) {
      writeFileSync(OUT, JSON.stringify({
        note: "v1 on the frozen corpus: dev set, auto-judged, licence rule on, profile as read. A regression floor, not a verdict (spec 19.2).",
        judge: { licences: true }, summary: s,
        per: per.map((p) => ({ id: p.id, exact: p.exact, p10: p.p10, p20: p.p20, shown: p.shown })),
      }, null, 2) + "\n");
      console.log(`  saved ${OUT}`);
    }
  }
  await db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
