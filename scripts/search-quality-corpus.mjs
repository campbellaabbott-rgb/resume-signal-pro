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
// WHAT THIS SCRIPT GOT WRONG ON ITS FIRST RUN, 2026-08-31 — read before
// trusting a finding from it. It reported four defects and ALL FOUR were
// artifacts of the instrument:
//   * "minSalary is ignored" — the API takes salaryFloor; minSalary was a
//     name this script invented, so the board correctly ignored it. Same for
//     agentReadyOnly, whose real name is sendableOnly, and companyTokens,
//     whose real name is companies. VERIFY A PARAMETER NAME AGAINST THE
//     SERVER before reporting that a filter does nothing.
//   * "10,000 is served as an exact total" — the response carries
//     countCapped:true beside it and the page renders "10,000+". The script
//     simply did not capture the disclosure field.
//   * "excludeAgencies widens" — comparing a capped ceiling (10,000) against
//     an exact count (22,467) from a different counting path. Two ceilings
//     from two paths cannot be ordered.
//   * "employer search is broken (Costco returns no Costco jobs)" — Costco's
//     board had merged but never been fetched; it had zero stored rows. No
//     ranking fix can conjure absent inventory.
// The instrument now captures the disclosure fields and refuses to call a
// capped comparison a widening. A measurement that convicts working code is
// worse than no measurement, because it spends real effort breaking things.
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
    // A capped count is a CEILING the server discloses; comparing it as if it
    // were exact manufactures phantom "the filter widened" findings — which is
    // exactly what happened on this script's first run (2026-08-31).
    countCapped: d.countCapped ?? null, relatedCapped: d.relatedCapped ?? null,
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
  { label: "salaryFloor 100k", body: { salaryFloor: 100000 }, expect: "narrow" },
  { label: "maxYears 2", body: { maxYears: 2 }, expect: "narrow" },
  { label: "employmentType full_time", body: { employmentType: "full_time" }, expect: "narrow" },
  { label: "category healthcare", body: { category: "healthcare" }, expect: "narrow" },
  { label: "excludeAgencies", body: { excludeAgencies: true }, expect: "narrow" },
  { label: "freshness 7d", body: { maxAgeDays: 7 }, expect: "narrow" },
  { label: "sendableOnly", body: { sendableOnly: true }, expect: "narrow" },
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
  // Only a comparison of two EXACT counts can prove widening. If either side
  // is capped, the numbers are ceilings from different counting paths and
  // their order says nothing.
  const comparable = !alone.countCapped && !bare.countCapped;
  const wid = comparable && (alone.total ?? 0) > (bare.total ?? 0);
  const cap = (r) => (r.countCapped ? "+" : " ");
  console.log(`  ${f.label.padEnd(26)} bare=${String(bare.total)+cap(bare)} alone=${String(alone.total)+cap(alone)} q=${String(qControl.total)+cap(qControl)} q+f=${String(composed.total)+cap(composed)}${wid && f.expect === "narrow" ? "  ** WIDENED (both exact) **" : ""}${qControl.ranked && !composed.ranked ? "  ** DROPS RANKED **" : ""}`);
  await new Promise((res) => setTimeout(res, 500));
}

writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(`\n-> ${process.argv[2]}`);
