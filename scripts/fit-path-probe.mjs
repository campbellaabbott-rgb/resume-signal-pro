// The drop-a-résumé path, probed end to end — the harness that would have
// caught the bug a reader reported.
//
// WHY THIS EXISTS. The board had two search harnesses and neither touched this
// path. search-snapshot answers "did anything CHANGE" and search-quality-corpus
// answers "is the ranking any GOOD", but both speak only to queries a reader
// TYPES. The résumé drop is a different entry point with its own chain —
// parse-pdf/parse-docx, then fit-terms to read the occupation out of the CV,
// then the ordinary search, then fit-batch to score what came back — and every
// link was unmonitored.
//
// So a reader dropped a CV and got nothing useful, twice over, and no harness
// went red. The first fault: fitRanking only re-ORDERED the postings already
// loaded, and on the default browse those are the newest few dozen of eight
// hundred thousand — chosen by recency, related to nobody's career (fixed in
// .24 by making the drop RETRIEVE). The second: measured 2026-09-02, the
// default browse scores 0 of 20 rows, because the newest postings have no
// stored description yet — so the fallback branch, "ranking what you're
// browsing by fit", is a no-op exactly where it is most likely to be hit.
//
// WHAT IT CHECKS, and why each is here rather than in a unit test:
//   1. PARSE — the two edge functions the button actually calls first. A
//      unit test cannot tell you parse-pdf is deployed and answering.
//   2. TERMS — does fit-terms read the right occupation out of a real CV.
//   3. RETRIEVAL — do the rows that come back belong to that occupation.
//      This is the half that was missing entirely before .24: ranking is not
//      finding, and a perfect scorer over the wrong candidate set is useless.
//   4. SCOREABILITY — what SHARE of the page can be ranked at all. A null is
//      an honest "no description stored", but a page that is mostly nulls is
//      a fit ranking in name only, and nothing else reports it.
//   5. SEPARATION — the control. A nurse CV must beat a software CV on
//      nursing rows. Without it, a scorer that returns a constant passes
//      every other check here.
//
//   6. FALLBACK — what the no-query browse can score at all (informational).
//   7. EXTRACTOR — two résumés with a KNOWN right answer, sent to the deployed
//      extractor: a title the vocabulary carries on the headline's second
//      line, and a title it does not carry that the headline rule must coin.
//      The three-career check above only asks "is the term in the right
//      field"; this asks "is it the exact term the source says", which is
//      what catches a bundle deployed from an older fit-score.ts.
//   8. REACH — the same two-year résumé, once as written and once with a
//      2010-2026 range added, against listed rows that state eight or more
//      years. The demotion has to be visible from outside: if the deployed
//      scorer ignores min_years, the two copies score the same.
//   9. LATENCY — the drop's own call shape, timed: list 60, then 20-id
//      batches three times, on page one and again at offset 120. The client
//      is about to widen its pool to three pages under a wall-clock budget,
//      and that budget has to be set from a measurement, not a guess.
//
// THE PROBE HIT THE COPY THE SITE NO LONGER CALLS. fit-terms and fit-batch
// moved out of job-board into their own isolate (job-fit) on 2026-09-03
// because sharing the ingest's worker pool answered 546 to readers; Jobs.tsx
// has invoked job-fit since. This script went on posting {action:"fit-terms"}
// to job-board — the legacy copy kept for older bundles — so every number it
// printed was about a code path no visitor was on. It now posts to job-fit,
// and a guard reads this file to keep it there.
//
// Read-only, sequential, against live production. Exits non-zero on failure
// so it can gate a deploy.

import { readFileSync } from "node:fs";
import {
  CHIEF_OF_STAFF, COURT_REPORTER, COURT_REPORTER_EXPECTED,
  TWO_YEAR_ENGINEER, SIXTEEN_YEAR_ENGINEER, REACH_MIN_YEARS,
} from "./fit-path-fixtures.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const BOARD = `${env.VITE_SUPABASE_URL}/functions/v1/job-board`;
const FNS = `${env.VITE_SUPABASE_URL}/functions/v1/`;
/** The scorer's own isolate — where Jobs.tsx sends fit-terms and fit-batch. */
const FIT = `${FNS}job-fit`;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
/** Every live request, counted, so "bounded" is a printed number. */
let calls = 0;

const CVS = {
  "software engineer": {
    expectTerm: /engineer|developer/i, expectTitle: /engineer|developer|software/i,
    cv: `Jane Doe - Senior Software Engineer, Seattle WA
Senior Software Engineer, Stripe 2021-2026. Payment APIs in TypeScript and Go. Led a team of 5.
Software Engineer, Amazon 2018-2021. AWS Lambda tooling, Python, Kubernetes.
SKILLS: TypeScript, Go, Python, React, PostgreSQL, Kubernetes, AWS, distributed systems, API design
BS Computer Science, University of Washington 2018`,
  },
  "registered nurse": {
    expectTerm: /nurse/i, expectTitle: /nurse|rn\b|clinical/i,
    cv: `Sarah Nguyen, RN, BSN - Registered Nurse, Houston TX
Registered Nurse, Houston Methodist ICU 2020-2026. Critical care, ventilator management, patient assessment.
Staff Nurse, Memorial Hermann 2017-2020. Medical-surgical unit, medication administration, care plans.
SKILLS: ACLS, BLS, patient care, IV therapy, EMR charting, Epic, triage, wound care, phlebotomy
BSN University of Texas 2017. RN license active.`,
  },
  "accountant": {
    expectTerm: /account/i, expectTitle: /account|financ|audit|tax/i,
    cv: `Michael Reed - Senior Accountant, Chicago IL
Senior Accountant, Deloitte 2019-2026. Financial statements, month-end close, reconciliations.
Staff Accountant, Grant Thornton 2016-2019. Accounts payable, general ledger, audit support, tax returns.
SKILLS: GAAP, QuickBooks, Excel, financial reporting, accounts receivable, payroll, budgeting, SOX
CPA licensed. BS Accounting, University of Illinois 2016`,
  },
};

async function post(url, body, ms = 60_000) {
  calls++;
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", ...H },
    body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
/** list / browse — the board. */
const board = (body, ms) => post(BOARD, body, ms);
/** fit-terms / fit-batch — the scorer's isolate, the one the site calls. */
const fit = (body, ms) => post(FIT, body, ms);
/** Wall time of one call, in ms, alongside its answer. */
async function timed(fn) {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}
const p50 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };

/** A structurally valid one-page PDF with a real xref, built here so the
 *  fixture cannot drift away from what the parser is asked to read. */
function pdf(lines) {
  const txt = `BT /F1 11 Tf 50 750 Td 14 TL\n${lines.map((l) => `(${l.replace(/[()\\]/g, "")}) Tj T*\n`).join("")}ET`;
  const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${txt.length}>>\nstream\n${txt}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"];
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offs.forEach((o) => { out += `${String(o).padStart(10, "0")} 00000 n \n`; });
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function parse(fn, bytes, name, type) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  calls++;
  const res = await fetch(FNS + fn, { method: "POST", headers: H, body: fd, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const fails = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails.push(label);
};

console.log("=".repeat(66));
console.log("FIT PATH PROBE — the drop-résumé chain, end to end, live");
console.log("=".repeat(66));

// 1. PARSE — the button's actual first step.
console.log("\n[1] parse (the button's first call)");
const swe = CVS["software engineer"].cv.split("\n");
try {
  const p = await parse("parse-pdf", pdf(swe), "resume.pdf", "application/pdf");
  const t = (p?.text ?? "").trim();
  check(t.length >= 100, "parse-pdf returns usable text", `${t.length} chars (client rejects <100)`);
} catch (e) { check(false, "parse-pdf reachable", String(e).slice(0, 60)); }

// 2-5, per career.
const scoreRows = async (cv, ids) => {
  const fb = await fit({ action: "fit-batch", resumeText: cv, ids });
  const f = fb?.fits ?? {};
  const vals = Object.values(f).filter((v) => typeof v === "number");
  return { fits: f, vals, scoreable: ids.length ? vals.length / ids.length : 0,
           mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
};

for (const [career, spec] of Object.entries(CVS)) {
  console.log(`\n[2-5] ${career}`);
  let terms = [];
  try {
    terms = (await fit({ action: "fit-terms", resumeText: spec.cv }))?.terms ?? [];
  } catch (e) { check(false, `${career}: fit-terms answers`, String(e).slice(0, 50)); continue; }
  check(terms.length > 0 && spec.expectTerm.test(terms[0] ?? ""),
    `${career}: reads the occupation out of the CV`, JSON.stringify(terms));
  if (!terms.length) continue;

  const rows = (await board({ q: terms[0], limit: 20 }))?.jobs ?? [];
  const onTopic = rows.filter((r) => spec.expectTitle.test(r.title)).length;
  check(rows.length > 0, `${career}: retrieval returns rows`, `${rows.length} rows`);
  check(rows.length > 0 && onTopic / rows.length >= 0.6,
    `${career}: retrieved rows are on-topic`, `${onTopic}/${rows.length} titles match`);
  if (!rows.length) continue;

  const ids = rows.map((r) => r.id);
  const own = await scoreRows(spec.cv, ids);
  // SCOREABILITY IS A CORPUS PROPERTY, NOT A REGRESSION, so it warns rather
  // than gates. Description coverage varies by vendor and occupation —
  // measured 2026-09-02: accountant 75-80%, software 70%, nursing 35% — and
  // failing a deploy over the nursing corpus would be blaming the wrong
  // change. The hard floor is set where the number stops meaning "coverage is
  // thin here" and starts meaning "the scorer or the descriptions broke".
  const FLOOR = 0.15, THIN = 0.5;
  check(own.scoreable >= FLOOR, `${career}: page is scoreable at all`,
    `${(own.scoreable * 100).toFixed(0)}% have a description`);
  if (own.scoreable >= FLOOR && own.scoreable < THIN) {
    console.log(`  WARN  ${career}: only ${(own.scoreable * 100).toFixed(0)}% of the page can be ranked` +
      ` — the rest have no stored description and keep their relevance order`);
  }
  check(own.mean > 0, `${career}: own CV scores above zero`, `mean ${own.mean.toFixed(1)}`);

  // SEPARATION: a control CV from a different field must score lower on
  // these rows. Without this, a scorer returning a constant passes above.
  const controlName = Object.keys(CVS).find((k) => k !== career);
  const ctl = await scoreRows(CVS[controlName].cv, ids);
  check(own.mean > ctl.mean, `${career}: beats the ${controlName} control`,
    `${own.mean.toFixed(1)} vs ${ctl.mean.toFixed(1)}`);
}

// The fallback branch, measured. Not a hard failure — it is a real property
// of a recency-ordered board whose newest rows have no descriptions yet — but
// it decides whether "ranking what you're browsing" means anything.
console.log("\n[6] fallback branch (no query set — ranks what is on screen)");
const browse = (await board({ limit: 20 }))?.jobs ?? [];
const bs = await scoreRows(CVS["software engineer"].cv, browse.map((r) => r.id));
console.log(`  INFO  default browse scoreable: ${(bs.scoreable * 100).toFixed(0)}%` +
  `${bs.scoreable === 0 ? "  <-- the fallback cannot rank anything here" : ""}`);

// 7. EXTRACTOR — exact answers, not fields. The fixtures live in
// fit-path-fixtures.mjs so the offline test runs the SAME bytes through the
// local fit-score.ts; a mismatch here with the offline test green means the
// deployed bundle was built from a different extractor than the repo holds.
console.log("\n[7] extractor (deployed fit-terms against résumés with a known answer)");
try {
  const cos = (await fit({ action: "fit-terms", resumeText: CHIEF_OF_STAFF }))?.terms ?? [];
  check(cos[0] === "chief of staff", "headline title the vocabulary carries leads", JSON.stringify(cos));
  const cr = (await fit({ action: "fit-terms", resumeText: COURT_REPORTER }))?.terms ?? [];
  check(JSON.stringify(cr.slice(0, 2)) === JSON.stringify(COURT_REPORTER_EXPECTED),
    "coined headline compound leads, bare word follows", JSON.stringify(cr));
} catch (e) { check(false, "extractor answers", String(e).slice(0, 60)); }

// 8. LATENCY — the drop's call shape, timed. Page one is what a reader sees;
// offset 120 is the third page of the widened pool the client is about to
// score, and the two are reported separately because description coverage
// (the null share) is a property of WHERE in the ranking a row sits.
console.log("\n[8] latency (list 60, then fit-batch 20 ids x3 — page one, then offset 120)");
const NURSE = CVS["registered nurse"].cv;
const pages = {};
try {
  const l1 = await timed(() => board({ q: "registered nurse", limit: 60 }));
  const rows60 = l1.value?.jobs ?? [];
  console.log(`  INFO  list q="registered nurse" limit=60: ${l1.ms} ms, ${rows60.length} rows`);
  const l2 = await timed(() => board({ q: "registered nurse", limit: 20, offset: 120 }));
  const rows120 = l2.value?.jobs ?? [];
  console.log(`  INFO  list q="registered nurse" limit=20 offset=120: ${l2.ms} ms, ${rows120.length} rows`);
  for (const [label, rows] of [["page 1 (ids 0-19)", rows60.slice(0, 20)], ["offset 120 (ids 120-139)", rows120]]) {
    const ids = rows.map((r) => r.id);
    if (!ids.length) { check(false, `${label}: rows to score`, "0 rows"); continue; }
    const times = []; let last = null;
    for (let i = 0; i < 3; i++) {
      const t = await timed(() => scoreRows(NURSE, ids));
      times.push(t.ms); last = t.value;
    }
    const nulls = ids.filter((id) => last.fits[id] === null).length;
    const missing = ids.filter((id) => !(id in last.fits)).length;
    pages[label] = { ids, rows, times, nullShare: nulls / ids.length, fits: last.fits };
    console.log(`  INFO  ${label}: fit-batch ${ids.length} ids x3 = [${times.join(", ")}] ms, p50 ${p50(times)} ms;` +
      ` null-score share ${nulls}/${ids.length} = ${((nulls / ids.length) * 100).toFixed(0)}%` +
      `${missing ? `; ${missing} ids absent from the answer` : ""}`);
    check(missing === 0, `${label}: every id is answered`, `${missing} absent`);
  }
  pages.rows60 = rows60;
} catch (e) { check(false, "latency section completed", String(e).slice(0, 60)); }

// 9. REACH — visible from outside, or the deployed scorer is not reading
// min_years. Rows are taken from pages already fetched where they state the
// minimum; one more list call only if none of them do.
console.log(`\n[9] reach (two-year résumé vs the same with 2010-2026, on rows stating ${REACH_MIN_YEARS}+ years)`);
try {
  const demanding = (rows) => (rows ?? []).filter((r) => typeof r.minYears === "number" && r.minYears >= REACH_MIN_YEARS);
  let pool = demanding(pages.rows60);
  let where = 'the "registered nurse" page';
  if (pool.length < 3) {
    const sw = (await board({ q: "software engineer", limit: 60 }))?.jobs ?? [];
    pool = demanding(sw); where = 'the "software engineer" page';
  }
  if (pool.length < 3) {
    const sw = (await board({ q: "senior software engineer", limit: 60 }))?.jobs ?? [];
    pool = pool.concat(demanding(sw)); where += ' + "senior software engineer"';
  }
  const ids = pool.slice(0, 20).map((r) => r.id);
  console.log(`  INFO  ${pool.length} rows stating minYears>=${REACH_MIN_YEARS} on ${where}; scoring ${ids.length}` +
    ` (minYears ${JSON.stringify(pool.slice(0, 20).map((r) => r.minYears))})`);
  if (ids.length === 0) {
    check(false, "reach: a row stating 8+ years to score", "none listed");
  } else {
    const two = await scoreRows(TWO_YEAR_ENGINEER, ids);
    const sixteen = await scoreRows(SIXTEEN_YEAR_ENGINEER, ids);
    // A demoted 1 cannot go below 1 — the scorer's floor — so only rows whose
    // full score leaves room to fall can show the demotion.
    const comparable = ids.filter((id) => typeof sixteen.fits[id] === "number" && sixteen.fits[id] >= 2);
    const lower = comparable.filter((id) => typeof two.fits[id] === "number" && two.fits[id] < sixteen.fits[id]);
    const pairs = comparable.map((id) => `${two.fits[id]}<${sixteen.fits[id]}`).join(" ");
    console.log(`  INFO  scoreable ${sixteen.vals.length}/${ids.length}; comparable (16y score >= 2) ${comparable.length};` +
      ` mean 2y ${two.mean.toFixed(1)} vs 16y ${sixteen.mean.toFixed(1)}; pairs: ${pairs}`);
    check(comparable.length > 0, "reach: a comparable row exists", `${comparable.length} rows`);
    check(comparable.length > 0 && lower.length === comparable.length,
      "reach: two-year résumé scores strictly lower on every 8+-year row",
      `${lower.length}/${comparable.length} strictly lower`);
  }
} catch (e) { check(false, "reach section completed", String(e).slice(0, 60)); }

console.log("\n" + "=".repeat(66));
console.log(`live calls: ${calls}`);
console.log(fails.length ? `FAILED (${fails.length}): ${fails.join("; ")}` : "ALL CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
