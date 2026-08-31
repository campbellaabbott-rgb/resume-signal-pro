// Search before/after snapshots — the regression camera for a moving corpus.
//
// The catalog doubled in a weekend (2026-08-30/31: +9k boards, two new
// vendors, and a charter change that admits staffing agencies), and search
// quality claims were previously judged by memory and anecdote. This captures
// a golden-query battery as a timestamped JSON so any change — a merge, a
// ranking edit, a vendor's postings arriving — can be judged as a DIFF
// against the last snapshot instead of a feeling.
//
//   snapshot: node scripts/search-snapshot.mjs snap out/snap-<label>.json
//   compare:  node scripts/search-snapshot.mjs compare before.json after.json
//
// Queries run SEQUENTIALLY against production (probe discipline: one at a
// time, this script is the only caller). The publishable key comes from .env
// and is never printed.
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const URL_ = `${env.VITE_SUPABASE_URL}/functions/v1/job-board`;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The battery: each entry is a body the board's own UI could send. Coverage:
// high-volume titles (agency-dilution watch), niche titles (description
// tier), abbreviations (routing), metro shorthand (alias expansion),
// exclusions, filters that must not widen, employer browse, and the
// charter-sensitive titles where staffing inventory concentrates.
const BATTERY = [
  { label: "browse", body: { limit: 10 } },
  { label: "software engineer", body: { q: "software engineer", limit: 10 } },
  { label: "registered nurse", body: { q: "registered nurse", limit: 10 } },
  { label: "data analyst", body: { q: "data analyst", limit: 10 } },
  { label: "warehouse", body: { q: "warehouse", limit: 10 } },
  { label: "customer service", body: { q: "customer service", limit: 10 } },
  { label: "c++", body: { q: "c++", limit: 10 } },
  { label: "rn abbreviation", body: { q: "RN", limit: 10 } },
  { label: "nyc metro", body: { q: "nurse", location: "NYC", limit: 10 } },
  { label: "sf metro", body: { q: "engineer", location: "SF", limit: 10 } },
  { label: "exclusion", body: { q: "engineer not manager", limit: 10 } },
  { label: "not-for-profit trap", body: { q: "director not for profit", limit: 10 } },
  { label: "remote filter", body: { q: "accountant", workMode: "remote", limit: 10 } },
  { label: "salary floor", body: { q: "developer", minSalary: 100000, limit: 10 } },
  { label: "recency sort", body: { sort: "newest", limit: 10 } },
  { label: "employer costco", body: { q: "Costco", limit: 10 } },
  { label: "employer cvs", body: { q: "CVS", limit: 10 } },
  { label: "agency collabera", body: { q: "Collabera", limit: 10 } },
  { label: "truck driver", body: { q: "truck driver", limit: 10 } },
  { label: "receptionist", body: { q: "receptionist", limit: 10 } },
  { label: "wisconsin guard", body: { q: "wisconsin", limit: 10 } },
  { label: "niche title", body: { q: "perfusionist", limit: 10 } },
  { label: "teacher k8", body: { q: "teacher", limit: 10 } },
  { label: "government", body: { q: "city of", limit: 10 } },
];

async function callBoard(body) {
  const t0 = Date.now();
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40_000),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { error: `HTTP ${res.status}`, ms };
  const d = await res.json();
  return {
    ms,
    tookMs: d.tookMs ?? null,
    total: d.total ?? null,
    ranked: d.ranked ?? null,
    disclosures: {
      locationExpandedFrom: d.locationExpandedFrom ?? null,
      excludedTerms: d.excludedTerms ?? null,
      maxAgeClamped: d.maxAgeClamped ?? null,
    },
    top: (d.jobs ?? []).slice(0, 10).map((j) => ({
      id: j.id, company: j.company, title: (j.title ?? "").slice(0, 60),
    })),
  };
}

const [, , mode, a, b] = process.argv;

if (mode === "snap") {
  const out = { at: new Date().toISOString(), results: {} };
  for (const c of BATTERY) {
    out.results[c.label] = await callBoard(c.body);
    const r = out.results[c.label];
    console.log(`  ${c.label.padEnd(22)} total=${String(r.total).padEnd(7)} ${r.ms}ms${r.error ? " " + r.error : ""}`);
    await new Promise((res) => setTimeout(res, 400));
  }
  writeFileSync(a, JSON.stringify(out, null, 1));
  console.log(`\nsnapshot -> ${a}`);
} else if (mode === "compare") {
  const A = JSON.parse(readFileSync(a, "utf8")), B = JSON.parse(readFileSync(b, "utf8"));
  console.log(`before ${A.at}  ->  after ${B.at}\n`);
  for (const label of Object.keys(B.results)) {
    const x = A.results[label], y = B.results[label];
    if (!x) { console.log(`  ${label}: NEW in after`); continue; }
    const dTotal = (y.total ?? 0) - (x.total ?? 0);
    const beforeIds = new Set((x.top ?? []).map((t) => t.id));
    const churn = (y.top ?? []).filter((t) => !beforeIds.has(t.id)).length;
    const flags = [];
    if (Math.abs(dTotal) > Math.max(50, (x.total ?? 0) * 0.15)) flags.push(`TOTAL ${x.total}->${y.total}`);
    if (churn >= 7) flags.push(`TOP10 CHURN ${churn}/10`);
    if ((y.ms ?? 0) > 3 * Math.max(500, x.ms ?? 0)) flags.push(`LATENCY ${x.ms}->${y.ms}ms`);
    if (x.ranked !== y.ranked) flags.push(`ranked ${x.ranked}->${y.ranked}`);
    if (y.error) flags.push(y.error);
    console.log(`  ${label.padEnd(22)} ${flags.length ? "⚠ " + flags.join("; ") : `ok (Δtotal ${dTotal >= 0 ? "+" : ""}${dTotal}, churn ${churn}/10)`}`);
  }
}
