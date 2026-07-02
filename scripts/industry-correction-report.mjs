// Industry correction-pair report — turns the user-feedback loop from
// "stored" into "actionable". Prints the most-confused industry pairs from
// real user corrections so keyword-table work is guided by data, not guesses.
//
// Usage:
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   node scripts/industry-correction-report.mjs [days=30]
//
// Reads via the get_industry_correction_stats RPC (service role required).

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const days = parseInt(process.argv[2] ?? "30", 10);

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (dashboard → Settings → API).");
  process.exit(1);
}

const rpc = async (fn, body = {}) => {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} failed: ${res.status} ${await res.text()}`);
  return res.json();
};

const stats = await rpc("get_industry_correction_stats", { p_days: days }).catch(async (e) => {
  // Older signature without p_days
  console.warn(`(${e.message.split(":")[0]} with p_days — retrying without args)`);
  return rpc("get_industry_correction_stats");
});

if (!Array.isArray(stats) || stats.length === 0) {
  console.log(`No corrections recorded in the last ${days} days. Either detection is doing well or volume is low.`);
  process.exit(0);
}

// Normalize rows: expect { original_industry, corrected_industry, correction_count } or similar
const rows = stats.map((r) => ({
  from: r.original_industry ?? r.from_industry ?? "?",
  to: r.corrected_industry ?? r.to_industry ?? "?",
  count: r.correction_count ?? r.count ?? 0,
  confidence: r.original_confidence ?? "",
}));

const confirmed = rows.filter((r) => r.from === r.to);
const wrong = rows.filter((r) => r.from !== r.to).sort((a, b) => b.count - a.count);

const totalConfirmed = confirmed.reduce((s, r) => s + r.count, 0);
const totalWrong = wrong.reduce((s, r) => s + r.count, 0);
const accuracy = totalConfirmed + totalWrong > 0
  ? ((totalConfirmed / (totalConfirmed + totalWrong)) * 100).toFixed(1)
  : "n/a";

console.log(`\nIndustry detection feedback — last ${days} days`);
console.log(`Confirmed correct: ${totalConfirmed}  ·  Corrected (wrong): ${totalWrong}  ·  User-confirmed accuracy: ${accuracy}%\n`);

if (wrong.length === 0) {
  console.log("No wrong-detection pairs. 🎉");
} else {
  console.log("Top confused pairs (fix keyword tables here first):");
  console.log("  detected            → user said            count");
  console.log("  " + "-".repeat(52));
  for (const r of wrong.slice(0, 20)) {
    console.log(`  ${r.from.padEnd(20)}→ ${r.to.padEnd(20)}${String(r.count).padStart(5)}`);
  }
  console.log("\nSuggested actions:");
  const top = wrong[0];
  console.log(`  1. Add a golden fixture reproducing "${top.from}" → should be "${top.to}"`);
  console.log(`  2. Check DISAMBIGUATION_RULES for a missing "${top.to}" guard against "${top.from}"`);
  console.log(`  3. Reinforce ${top.to}'s titles/primary keywords in INDUSTRY_KEYWORDS`);
}
