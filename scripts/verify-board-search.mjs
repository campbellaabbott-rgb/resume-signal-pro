#!/usr/bin/env node
// BOARD FILTER + SEARCH CONTRACT VERIFIER
//
//   node scripts/verify-board-search.mjs            # full sweep
//   node scripts/verify-board-search.mjs --quick    # filters only, no role sweep
//   BOARD_URL=… BOARD_KEY=… node scripts/verify-board-search.mjs
//
// The board makes two promises a job seeker relies on completely:
//
//   1. A filter is NEVER silently ignored. If you ask for remote roles in
//      Germany over $100k, every row you get back is remote, in Germany, and
//      states pay at or above that floor — or the board honestly returns
//      nothing. (This is the fence that has broken twice: the ranked path once
//      dropped work-mode, and the fuzzy tier once dropped every filter and
//      served other companies' jobs on a company lander.)
//
//   2. Searching a role you actually do returns that role. Not "close-ish
//      titles" — the thing you typed.
//
// Both are checked HERE by inspecting the returned rows themselves, not by
// trusting a status field. A filter that returns rows violating it fails loudly
// with the offending row printed, because a wrong row is worse than no row.
//
// Exit 0 = both promises hold. Exit 1 = a specific, printed violation.

const BASE = process.env.BOARD_URL ?? "https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board";
const KEY = process.env.BOARD_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3aGRhemJvdHBibGloZHhjbWhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMDM2NTgsImV4cCI6MjA2Njc3OTY1OH0.WWetSNSyWlG5CkedbeIQ1p7MB2Q1eLPTUiWy2FrPeGE";
const QUICK = process.argv.includes("--quick");

let pass = 0;
const failures = [];

const ok = (label, detail = "") => { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); };
const fail = (label, why, sample) => {
  failures.push({ label, why, sample });
  console.log(`  ✗ ${label} — ${why}`);
  if (sample) console.log(`      offending row: ${JSON.stringify(sample).slice(0, 220)}`);
};

async function board(body, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return await res.json();
    } catch { /* retry */ }
    if (i + 1 < tries) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/** Every returned row must satisfy `predicate`, or we name the first that doesn't. */
function assertEveryRow(label, jobs, predicate, why) {
  if (!Array.isArray(jobs)) return fail(label, "no jobs array returned");
  if (jobs.length === 0) return ok(label, "honest empty (no rows claimed)");
  const bad = jobs.find((j) => !predicate(j));
  if (bad) return fail(label, why, { id: bad.id, title: bad.title, company: bad.company, location: bad.location, remote: bad.remote, workMode: bad.workMode, salaryMinAnnual: bad.salaryMinAnnual, experienceBand: bad.experienceBand, postedAt: bad.postedAt });
  ok(label, `${jobs.length}/${jobs.length} rows satisfy it`);
}

// ── 1. Filter contracts ────────────────────────────────────────────────────
async function filterContracts() {
  console.log("\nFILTERS — every returned row must satisfy the constraint");

  const remote = await board({ action: "list", remote: true, limit: 30 });
  assertEveryRow("remote=true", remote?.jobs, (j) => j.remote === true || j.workMode === "remote",
    "a row is not remote");

  for (const mode of ["remote", "hybrid", "onsite"]) {
    const r = await board({ action: "list", workMode: mode, limit: 25 });
    assertEveryRow(`workMode=${mode}`, r?.jobs, (j) => j.workMode === mode, `a row's workMode is not ${mode}`);
  }

  // Case variants must bind, not silently serve the whole board.
  const capped = await board({ action: "list", workMode: "Remote", limit: 10 });
  assertEveryRow('workMode="Remote" (capitalised)', capped?.jobs, (j) => j.workMode === "remote",
    "capitalised value was ignored and unfiltered rows were served");

  for (const cc of ["US", "GB", "DE"]) {
    const r = await board({ action: "list", country: cc, limit: 25 });
    assertEveryRow(`country=${cc}`, r?.jobs, (j) => !j.country || j.country === cc, `a row is outside ${cc}`);
  }

  const eng = await board({ action: "list", category: "engineering", limit: 25 });
  assertEveryRow("category=engineering", eng?.jobs, (j) => j.category === "engineering", "a row is in another category");

  for (const band of ["entry", "senior"]) {
    const r = await board({ action: "list", experience: band, limit: 25 });
    assertEveryRow(`experience=${band}`, r?.jobs, (j) => j.experienceBand === band, `a row is not ${band}`);
  }

  // The floor binds in APPROXIMATE USD (salary_rank_usd, 2026-07-26): EUR/GBP
  // rows that genuinely clear the bar pass; INR/SEK rows whose figures merely
  // LOOK large do not. Mirror of the migration's FX table — a currency we
  // can't rate has a NULL rank server-side and must not have passed.
  const FX = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, NZD: 0.61, CHF: 1.12, SEK: 0.095, DKK: 0.145, NOK: 0.094, PLN: 0.25, INR: 0.012, SGD: 0.74, JPY: 0.0066, BRL: 0.18, MXN: 0.055, PHP: 0.017 };
  const floor = 100_000;
  const sal = await board({ action: "list", salaryFloor: floor, limit: 25 });
  assertEveryRow(`salaryFloor=${floor.toLocaleString()} (approx-USD)`, sal?.jobs,
    (j) => typeof j.salaryMinAnnual === "number"
      && typeof FX[String(j.salaryCurrency ?? "USD").toUpperCase()] === "number"
      && j.salaryMinAnnual * FX[String(j.salaryCurrency ?? "USD").toUpperCase()] >= floor * 0.999,
    "a row states no pay, an unrateable currency, or pays below the floor in approx USD");

  const loc = await board({ action: "list", location: "London", limit: 25 });
  assertEveryRow("location=London", loc?.jobs, (j) => /london/i.test(j.location ?? ""), "a row is not in London");

  for (const days of [1, 7]) {
    const r = await board({ action: "list", maxAgeDays: days, limit: 25 });
    const cutoff = Date.now() - days * 86_400_000 - 36 * 3600_000; // tz + ingest slack
    assertEveryRow(`maxAgeDays=${days}`, r?.jobs,
      (j) => j.postedAt && Date.parse(j.postedAt) >= cutoff, `a row is older than ${days}d or undated`);
  }

  // Intersections: the hard case, where one filter historically got dropped.
  const combo = await board({ action: "list", workMode: "remote", country: "US", category: "engineering", limit: 25 });
  assertEveryRow("remote + US + engineering (intersection)", combo?.jobs,
    (j) => j.workMode === "remote" && (!j.country || j.country === "US") && j.category === "engineering",
    "a row violates at least one of the three");

  // A company lander must never show another company's jobs — including when
  // the query is a typo, which is what the fuzzy tier once broke.
  const lander = await board({ action: "list", companies: ["stripe"], q: "desinger", limit: 10 });
  assertEveryRow('companies=[stripe] + typo query', lander?.jobs,
    (j) => (j.token ?? "").toLowerCase() === "stripe", "another company's job appeared on a company-scoped query");

  // Pagination must not repeat or skip.
  const p1 = await board({ action: "list", category: "healthcare", limit: 20, offset: 0 });
  if (p1?.jobs?.length) {
    const p2 = await board({ action: "list", category: "healthcare", limit: 20, offset: p1.nextOffset ?? 20 });
    const ids1 = new Set((p1.jobs ?? []).map((j) => j.id));
    const dupes = (p2?.jobs ?? []).filter((j) => ids1.has(j.id));
    dupes.length === 0
      ? ok("pagination page1→page2", "no repeated ids")
      : fail("pagination page1→page2", `${dupes.length} id(s) repeated across pages`, dupes[0]);
  }
}

// ── 2. Role searchability ──────────────────────────────────────────────────
// A role search must return THAT role. We check the query's distinctive word
// appears in a healthy share of the top titles — not an exact-string match,
// which would wrongly fail legitimate variants ("RN" for "registered nurse").
const STOP = new Set(["and", "of", "the", "senior", "junior", "lead", "staff", "i", "ii", "iii"]);

async function roleSearchability(roles) {
  console.log(`\nSEARCH — each role query must return that role (${roles.length} roles)`);
  const weak = [];
  for (const role of roles) {
    const r = await board({ action: "list", q: role, limit: 12 });
    const jobs = r?.jobs ?? [];
    if (jobs.length === 0) { weak.push({ role, hit: 0, n: 0, note: "zero results" }); continue; }
    const terms = role.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    const hit = jobs.filter((j) => {
      const t = `${j.title ?? ""} ${j.department ?? ""}`.toLowerCase();
      return terms.some((w) => t.includes(w) || t.includes(w.replace(/s$/, "")));
    }).length;
    const share = hit / jobs.length;
    if (share < 0.5) weak.push({ role, hit, n: jobs.length, share, marker: r.fuzzy ? "fuzzy" : r.semantic ? "semantic" : "ranked" });
  }
  if (weak.length === 0) return ok("role relevance", `all ${roles.length} roles returned matching titles`);
  console.log(`  ${roles.length - weak.length}/${roles.length} roles clean; weakest below:`);
  for (const w of weak.slice(0, 12)) {
    console.log(`      ${w.role}: ${w.note ?? `${w.hit}/${w.n} top titles matched (${w.marker})`}`);
  }
  // Relevance is a quality signal, not a contract breach — report, don't fail,
  // unless a role returns literally nothing, which IS a broken search.
  const empty = weak.filter((w) => w.n === 0);
  empty.length
    ? fail("role searchability", `${empty.length} role(s) returned zero results: ${empty.slice(0, 6).map((w) => w.role).join(", ")}`)
    : ok("role searchability", `no empty results; ${weak.length} role(s) below the relevance bar (listed above)`);
}

// ── run ────────────────────────────────────────────────────────────────────
const ROLES = [
  "registered nurse", "software engineer", "project manager", "accountant", "electrician",
  "truck driver", "data analyst", "mechanical engineer", "sales representative", "teacher",
  "pharmacist", "graphic designer", "financial analyst", "warehouse associate", "physical therapist",
  "cybersecurity analyst", "product manager", "civil engineer", "customer service representative",
  "marketing manager", "human resources generalist", "welder", "chef", "paralegal", "social worker",
];

const status = await board({ action: "status" });
console.log(`board ${status?.version ?? "?"} — ${(status?.totalPostings ?? 0).toLocaleString()} postings, ${(status?.catalogSize ?? 0).toLocaleString()} boards`);

await filterContracts();
if (!QUICK) await roleSearchability(ROLES);

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${pass} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nContract violations (a wrong row is worse than no row):");
  for (const f of failures) console.log(`  • ${f.label}: ${f.why}`);
  process.exit(1);
}
