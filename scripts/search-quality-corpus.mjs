// Relevance + filter-correctness corpus — the evidence a quality judgement
// needs, collected once, judged offline.
//
// The snapshot harness answers "did anything CHANGE". It cannot answer "is
// this any GOOD": every metric in it is mechanical (latency, totals, top-10
// churn), and a board can serve fast, stable, well-counted garbage. This
// collects the two things a quality verdict actually needs:
//
//   1. RELEVANCE CORPUS — top-20 results for queries spanning the intent
//      types the board serves (exact title, role family, skill, seniority,
//      abbreviation, employer, location-scoped, natural language, typo,
//      niche). Judged offline, per result, against the query's intent.
//   2. FILTER MATRIX — each filter alone and composed with a query, with the
//      unfiltered control taken IMMEDIATELY BEFORE so corpus growth cannot be
//      mistaken for a widening filter. A filter that widens is the documented
//      tier-escalation defect class; only a same-moment control can catch it.
//
// SEQUENTIAL BY CONTRACT. Parallel probing of production has hurt real users
// on this board; every request here waits for the last one.
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const URL_ = `${env.VITE_SUPABASE_URL}/functions/v1/job-board`;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function call(body) {
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
    ms, total: d.total ?? null, totalAtLeast: d.totalAtLeast ?? null,
    totalBeforeExclusions: d.totalBeforeExclusions ?? null,
    countUnavailable: d.countUnavailable ?? null, ranked: d.ranked ?? null,
    returned: (d.jobs ?? []).length,
    jobs: (d.jobs ?? []).slice(0, 20).map((j) => ({
      title: j.title ?? "", company: j.company ?? "", location: j.location ?? "",
      workMode: j.workMode ?? null, salary: j.salary ?? null, agency: j.agency ?? null,
      category: j.category ?? null, source: String(j.id ?? "").split(":")[0],
    })),
  };
}

// Intent-typed queries. `intent` is what a person typing this WANTS — the
// judge scores each result against it, so the taxonomy has to be honest about
// the ask rather than describing the string.
const QUERIES = [
  { q: "software engineer", type: "exact-title", intent: "software engineering roles, any seniority" },
  { q: "registered nurse", type: "exact-title", intent: "RN clinical nursing roles" },
  { q: "truck driver", type: "exact-title", intent: "commercial driving roles" },
  { q: "barista", type: "exact-title", intent: "coffee-shop service roles" },
  { q: "data analyst", type: "role-family", intent: "analytics roles working with data" },
  { q: "project manager", type: "role-family", intent: "project/program management roles" },
  { q: "python", type: "skill", intent: "roles where Python programming is the work" },
  { q: "welding", type: "skill", intent: "roles doing welding/fabrication" },
  { q: "excel", type: "skill", intent: "roles where spreadsheet work is central" },
  { q: "senior software engineer", type: "seniority", intent: "SENIOR-level software roles, not junior/entry" },
  { q: "entry level marketing", type: "seniority", intent: "marketing roles open to little/no experience" },
  { q: "RN", type: "abbreviation", intent: "registered nurse roles (not unrelated words containing rn)" },
  { q: "SDR", type: "abbreviation", intent: "sales development representative roles" },
  { q: "CDL", type: "abbreviation", intent: "roles requiring a commercial drivers license" },
  { q: "Costco", type: "employer", intent: "jobs AT Costco, not jobs mentioning Costco" },
  { q: "Mayo Clinic", type: "employer", intent: "jobs at Mayo Clinic" },
  { q: "remote customer support", type: "natural-language", intent: "customer support roles that are remote" },
  { q: "part time evenings retail", type: "natural-language", intent: "part-time evening retail work" },
  { q: "nurse practicioner", type: "typo", intent: "nurse practitioner roles despite the misspelling" },
  { q: "acountant", type: "typo", intent: "accountant roles despite the misspelling" },
  { q: "perfusionist", type: "niche", intent: "cardiovascular perfusion roles" },
  { q: "actuary", type: "niche", intent: "actuarial roles" },
  { q: "c++", type: "punctuation", intent: "C++ programming roles" },
  { q: "front-end", type: "punctuation", intent: "front-end web development roles" },
];

// Each filter, alone and composed. `expect` is the invariant the judge/report
// checks — narrowing filters must never return MORE than their control.
const FILTERS = [
  { label: "workMode remote", body: { workMode: "remote" }, expect: "narrow" },
  { label: "workMode onsite", body: { workMode: "onsite" }, expect: "narrow" },
  { label: "country US", body: { country: "US" }, expect: "narrow" },
  { label: "minSalary 100k", body: { minSalary: 100000 }, expect: "narrow" },
  { label: "maxYears 2", body: { maxYears: 2 }, expect: "narrow" },
  { label: "employmentType full_time", body: { employmentType: "full_time" }, expect: "narrow" },
  { label: "category healthcare", body: { category: "healthcare" }, expect: "narrow" },
  { label: "excludeAgencies", body: { excludeAgencies: true }, expect: "narrow" },
  { label: "freshness 7d", body: { maxAgeDays: 7 }, expect: "narrow" },
  { label: "agentOnly", body: { agentReadyOnly: true }, expect: "narrow" },
  // WIDENING by contract — these exist to include more, and must not be
  // judged against the narrowing rule (the isUnfiltered exemption pair).
  { label: "includeUncategorised", body: { includeUncategorised: true }, expect: "widen-ok" },
  { label: "includeUnstatedPay", body: { includeUnstatedPay: true }, expect: "widen-ok" },
];

const out = { at: new Date().toISOString(), relevance: [], filters: [] };

console.log(`relevance corpus: ${QUERIES.length} queries`);
for (const spec of QUERIES) {
  const r = await call({ q: spec.q, limit: 20 });
  out.relevance.push({ ...spec, ...r });
  console.log(`  ${spec.q.padEnd(26)} ${String(r.total).padEnd(7)} ${r.returned} rows ${r.ms}ms`);
  await new Promise((res) => setTimeout(res, 500));
}

console.log(`\nfilter matrix: ${FILTERS.length} filters x (alone, composed)`);
for (const f of FILTERS) {
  // Control FIRST and adjacent, so corpus growth between requests cannot be
  // read as a filter that widened.
  const bare = await call({ limit: 5 });
  await new Promise((res) => setTimeout(res, 400));
  const alone = await call({ ...f.body, limit: 5 });
  await new Promise((res) => setTimeout(res, 400));
  const qControl = await call({ q: "nurse", limit: 5 });
  await new Promise((res) => setTimeout(res, 400));
  const composed = await call({ q: "nurse", ...f.body, limit: 5 });
  out.filters.push({ ...f, bare, alone, qControl, composed });
  const wid = (alone.total ?? 0) > (bare.total ?? 0);
  console.log(`  ${f.label.padEnd(26)} bare=${String(bare.total).padEnd(7)} alone=${String(alone.total).padEnd(7)} q=${String(qControl.total).padEnd(6)} q+f=${String(composed.total).padEnd(6)}${wid && f.expect === "narrow" ? "  ** WIDENED **" : ""}`);
  await new Promise((res) => setTimeout(res, 500));
}

writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(`\n-> ${process.argv[2]}`);
