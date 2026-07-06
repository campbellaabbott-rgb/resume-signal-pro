#!/usr/bin/env node
// Concurrency load test for the free scan — finds the real capacity ceiling
// (gateway 429s / load-shed activation) empirically instead of on launch day.
//
// COSTS REAL AI CALLS. Deliberately requires explicit opt-in:
//   RUN=1 CONCURRENCY=20 node scripts/load-test-scan.mjs
//
// Reads SUPABASE url/key from .env in the repo root. Each request uses a
// unique synthetic resume (cache-busting) so every scan genuinely hits the
// AI path. Reports per-request outcome and p50/p95/max durations.

import { readFileSync } from "node:fs";

if (process.env.RUN !== "1") {
  console.log("Refusing to run without RUN=1 (this test costs real AI calls).");
  console.log("Usage: RUN=1 CONCURRENCY=20 node scripts/load-test-scan.mjs");
  process.exit(1);
}

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const URL_ = env.match(/VITE_SUPABASE_URL="?([^"\n]+)/)?.[1];
const KEY = env.match(/VITE_SUPABASE_PUBLISHABLE_KEY="?([^"\n]+)/)?.[1];
if (!URL_ || !KEY) { console.error("Could not read Supabase creds from .env"); process.exit(1); }

const N = Number(process.env.CONCURRENCY ?? "20");

const ROLES = [
  ["Software Engineer", "Built REST APIs in Python serving [N]M requests/day", "technology"],
  ["Registered Nurse", "Provided ICU patient care and medication administration", "healthcare"],
  ["Accountant", "Closed monthly books and managed reconciliation for 200 accounts", "finance"],
  ["Marketing Manager", "Ran paid social campaigns with $[N]0k monthly budget", "marketing"],
  ["Electrician", "Completed residential and commercial wiring installs to code", "trades"],
];

const makeResume = (i) => {
  const [title, bullet] = ROLES[i % ROLES.length];
  return `Load Test ${i}-${Date.now()}\n${title}\nlt${i}@example.com\nPROFESSIONAL EXPERIENCE\n${title}, TestCo ${i} (2020-present)\n- ${bullet.replace("[N]", String((i % 9) + 1))}\n- Improved key metric ${10 + i}% year over year in run ${Date.now() % 1e6}\nSKILLS\nTeamwork, planning, unique-marker-${i}-${Date.now()}`;
};

console.log(`Firing ${N} concurrent scans at ${URL_} ...`);
const t0 = Date.now();

const results = await Promise.all(
  Array.from({ length: N }, async (_, i) => {
    const start = Date.now();
    try {
      const res = await fetch(`${URL_}/functions/v1/free-keyword-scan`, {
        method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        // synthetic:true → logged as scan_type='synthetic', kept out of the
        // published score stats (get_public_scan_insights and friends).
        body: JSON.stringify({ resumeText: makeResume(i), synthetic: true }),
        signal: AbortSignal.timeout(180_000),
      });
      const ms = Date.now() - start;
      let kind = `http_${res.status}`;
      if (res.ok) {
        const d = await res.json();
        kind = d.partialResults ? "shed_or_partial" : d.cachedReport ? "cached" : "full_report";
      }
      return { i, ms, kind };
    } catch (e) {
      return { i, ms: Date.now() - start, kind: `error_${e.name ?? "unknown"}` };
    }
  })
);

const durations = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))];
const byKind = {};
for (const r of results) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

console.log(`\nWall time: ${((Date.now() - t0) / 1000).toFixed(1)}s for ${N} scans`);
console.log("Outcomes:", byKind);
console.log(`Durations  p50: ${(pct(50) / 1000).toFixed(1)}s  p95: ${(pct(95) / 1000).toFixed(1)}s  max: ${(durations.at(-1) / 1000).toFixed(1)}s`);
console.log("\nInterpretation:");
console.log("- full_report for all + p95 under ~25s → capacity is above this concurrency");
console.log("- shed_or_partial appearing → the limiter is working as designed at this level");
console.log("- http_429 / errors → the gateway ceiling is BELOW the limiter; lower MAX_CONCURRENT_AI_SCANS");
