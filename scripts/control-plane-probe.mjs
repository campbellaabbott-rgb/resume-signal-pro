#!/usr/bin/env node
/**
 * THE INGEST CONTROL PLANE, CHECKED THE WAY IT ACTUALLY FAILS.
 *
 * 2026-09-04: a deploy shipped a heap stamp into the payload of both
 * slice_stats writers. The runtime has no Deno.memoryUsage, so both writes
 * threw inside their own swallow-everything catch and the row froze at the
 * deploy instant. Every other check was green — the function answered, the
 * version was right, search worked, freshness looked fine for half an hour.
 * Thirty minutes later shedSignal read the untouched row as `stale` and
 * floored the fleet at L1 for three hours: cold slices 80 -> 48, no chain
 * kicks, p50 403 -> 511.
 *
 * Nothing in the battery or the other probes could have caught that, because
 * they all ask "does it answer?" and the answer was yes. This asks the only
 * question that mattered: IS THE ROTATION'S OWN BOOKKEEPING STILL MOVING?
 *
 * Read-only. Two samples, INTERVAL seconds apart (default 200s — one slice at
 * L1 takes longer than one at L0, and the check must not fail on cadence).
 *   node scripts/control-plane-probe.mjs [expectedVersion] [intervalSeconds]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envFile = readFileSync(resolve(import.meta.dirname, "../.env"), "utf8");
const env = (k) => (envFile.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").replace(/^"|"$/g, "").trim();
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY");
if (!URL_ || !ANON) { console.error("missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in .env"); process.exit(2); }

const expectVersion = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : null;
const intervalS = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a)) ?? 200);

const status = async () => {
  const r = await fetch(`${URL_}/functions/v1/job-board`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status" }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`status HTTP ${r.status}`);
  return await r.json();
};

let failed = 0, warned = 0;
const ok = (cond, label, detail = "") => {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const warn = (cond, label, detail = "") => {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  else { warned++; console.log(`  WARN  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const ageMin = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 60_000 : Infinity);

console.log(`[control plane] ${new Date().toISOString()}  interval ${intervalS}s`);
const a = await status();
const ssA = a.sliceStats ?? {};
console.log(`\n[1] the row the shed signal reads`);
if (expectVersion) ok(a.version === expectVersion, `version is ${expectVersion}`, a.version);
else console.log(`  INFO  version ${a.version}`);

// THE CHECK THIS PROBE EXISTS FOR. shedSignal calls the row stale at 30 minutes
// and floors the fleet at L1, so 30 is not a round number — it is the cliff.
ok(ageMin(ssA.at) < 30, "slice_stats terminal write is younger than the 30-minute stale cliff",
  `${ageMin(ssA.at).toFixed(1)}m old (at ${ssA.at})`);
ok(ageMin(ssA.workAt) < 30, "slice_stats liveness stamp is younger than the stale cliff",
  `${ageMin(ssA.workAt).toFixed(1)}m old (workAt ${ssA.workAt})`);
// .37 surfaces the reason a stamp could not land. Anything here is the bug.
ok(!ssA.stampError, "no stamp error recorded", ssA.stampError ?? "none");

console.log(`\n[2] the fleet is not shedding`);
const drained = a.bootstrapQueue?.lastSlice?.drained;
warn(drained === undefined || drained === 25, "bootstrap drain is L0 (25 per slice)",
  drained === 10 ? "10 — SHEDDING AT L1" : drained === 0 ? "0 — SHEDDING AT L2" : String(drained));
warn(ageMin(a.chainKick?.at) < 15, "the chain kicked recently",
  `${ageMin(a.chainKick?.at).toFixed(1)}m old, outcome ${a.chainKick?.outcome}, hop ${a.chainKick?.fromHop}, status ${a.chainKick?.status ?? "-"}`);
warn((a.freshness?.p50_min ?? Infinity) <= 480, "freshness p50 is inside the published 480-minute promise",
  `${a.freshness?.p50_min}m (p95 ${a.freshness?.p95_min}m)`);

console.log(`\n[3] second sample in ${intervalS}s — does the bookkeeping MOVE?`);
await new Promise((r) => setTimeout(r, intervalS * 1000));
const b = await status();
const ssB = b.sliceStats ?? {};
const dWorks = (Number(ssB.works) || 0) - (Number(ssA.works) || 0);
const dSlices = (Number(ssB.slices) || 0) - (Number(ssA.slices) || 0);
const dCold = (Number(b.cursor?.cold) || 0) - (Number(a.cursor?.cold) || 0);
ok(dWorks > 0 || dSlices > 0 || ssB.at !== ssA.at,
  "the slice_stats row advanced between samples",
  `works +${dWorks}, slices +${dSlices}, at ${ssA.at} -> ${ssB.at}`);
warn(dCold > 0, "the cold cursor advanced", `+${dCold}${dCold === 48 ? " (48 = the L1 slice size)" : dCold === 80 ? " (80 = the L0 slice size)" : ""}`);
// A cursor that moves while the row does not is the exact 2026-09-04 signature.
if (dCold > 0 && dWorks === 0 && dSlices === 0) {
  failed++;
  console.log(`  FAIL  the cursor is advancing while the stamp writers are frozen — this is the .36 signature: a write that throws inside its own catch`);
}

console.log(`\n${"=".repeat(66)}`);
console.log(failed ? `FAILED (${failed})${warned ? ` + ${warned} warning(s)` : ""}` : warned ? `PASSED with ${warned} warning(s)` : "ALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
