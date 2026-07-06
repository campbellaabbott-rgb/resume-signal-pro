// Scan-corpus trend snapshot — prints real production aggregates via the
// anon-callable metrics RPCs (no service key needed). The volume trend uses
// scan_type='free-stream' (the real UI path) because 'free' is polluted by
// the smoke/load-test scripts, which hit the non-stream endpoint.
//
// Usage: node scripts/scan-trends.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env"), "utf8");
const BASE = env.match(/^VITE_SUPABASE_URL\s*=\s*"?([^"\s]+)/m)?.[1];
const KEY = env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY\s*=\s*"?([^"\s]+)/m)?.[1];
if (!BASE || !KEY) { console.error("No Supabase creds in .env"); process.exit(1); }

const rpc = async (fn, body = {}) => {
  const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return res.json();
};

const WINDOWS = [["24h", 24], ["7d", 168], ["30d", 720], ["90d", 2160], ["180d", 4320]];

console.log("== Real user scan volume (free-stream) ==");
let prev = null;
for (const [label, hours] of WINDOWS) {
  const [d] = await rpc("get_scan_success_rate", { p_hours_back: hours, p_scan_type: "free-stream" });
  const rate = (d.total_scans / (hours / 24)).toFixed(1);
  console.log(`  last ${label.padEnd(4)} total=${String(d.total_scans).padStart(4)}  (${rate}/day)  success=${d.success_rate}%  p50=${d.p50_duration_ms}ms  p95=${d.p95_duration_ms}ms  cache=${d.cache_hit_rate}%`);
  prev = d;
}

console.log("\n== Synthetic/legacy 'free' type (includes smoke + load tests) ==");
for (const [label, hours] of WINDOWS) {
  const [d] = await rpc("get_scan_success_rate", { p_hours_back: hours, p_scan_type: "free" });
  console.log(`  last ${label.padEnd(4)} total=${d.total_scans}`);
}

console.log("\n== Score distribution by industry (180d, all scan types) ==");
const { execSync } = await import("node:child_process");
execSync(`npx esbuild --bundle --format=esm --log-level=error --outfile=/tmp/.industry-slugs.mjs ${join(root, "supabase/functions/free-keyword-scan/industry-detection.ts").replace(/ /g, "\\ ")}`, { cwd: root });
const { INDUSTRY_KEYWORDS } = await import("/tmp/.industry-slugs.mjs");
const slugs = Object.keys(INDUSTRY_KEYWORDS).sort();
const rows = [];
for (let i = 0; i < slugs.length; i += 8) {
  const batch = slugs.slice(i, i + 8);
  const res = await Promise.all(batch.map((s) => rpc("get_real_score_distribution", { p_industry: s }).catch(() => null)));
  batch.forEach((s, j) => { const r = res[j]?.[0]; if (r && r.n > 0) rows.push({ industry: s, ...r }); });
}
rows.sort((a, b) => b.n - a.n);
for (const r of rows) {
  console.log(`  ${r.industry.padEnd(24)} n=${String(r.n).padStart(3)}  median=${r.median}  IQR=${r.p25}–${r.p75}`);
}

console.log("\n== Geo (180d) ==");
for (const g of await rpc("get_scan_geo_stats", { p_hours_back: 4320 })) {
  console.log(`  ${g.country.padEnd(8)} ${String(g.total_scans).padStart(4)} scans  fail=${g.failure_rate}%`);
}

console.log("\n== Industry corrections (90d) ==");
const corr = await rpc("get_industry_correction_stats", { p_days: 90 }).catch((e) => e.message);
if (Array.isArray(corr)) for (const c of corr) console.log(`  ${c.detected} → ${c.corrected} ×${c.corrections} (last ${c.last_seen?.slice(0, 10)})`);
else console.log(`  ${corr}`);
