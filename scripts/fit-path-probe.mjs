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
// Read-only, sequential, against live production. Exits non-zero on failure
// so it can gate a deploy.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const BOARD = `${env.VITE_SUPABASE_URL}/functions/v1/job-board`;
const FNS = `${env.VITE_SUPABASE_URL}/functions/v1/`;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

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

async function board(body, ms = 60_000) {
  const res = await fetch(BOARD, {
    method: "POST", headers: { "Content-Type": "application/json", ...H },
    body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

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
  const fb = await board({ action: "fit-batch", resumeText: cv, ids });
  const f = fb?.fits ?? {};
  const vals = Object.values(f).filter((v) => typeof v === "number");
  return { vals, scoreable: ids.length ? vals.length / ids.length : 0,
           mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
};

for (const [career, spec] of Object.entries(CVS)) {
  console.log(`\n[2-5] ${career}`);
  let terms = [];
  try {
    terms = (await board({ action: "fit-terms", resumeText: spec.cv }))?.terms ?? [];
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

console.log("\n" + "=".repeat(66));
console.log(fails.length ? `FAILED (${fails.length}): ${fails.join("; ")}` : "ALL CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
