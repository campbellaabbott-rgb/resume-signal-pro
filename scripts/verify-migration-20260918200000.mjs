// Runs the eleven layoff-filings migrations (20260918100000 .. 20260918101000)
// and then the alias seed (20260918200000) in pglite and proves:
//   * the seed applies after lane A's files, and applies AGAIN with no change
//     (one decision per pair; a re-run never overturns a hand-changed row);
//   * batch 1 is what the header says: every accepted row is cik-keyed, has no
//     alias_norm, carries the company_financials evidence, and no accepted
//     (cik, token) pair is also rejected;
//   * every alias_norm the seed carries is what layoff_norm yields for a filer
//     string a lane recorded -- the SQL function decides, never a JS port;
//   * the matcher, run over filings planted for every rejected pair against a
//     mirror holding those very tokens under their real display names, writes
//     ZERO match rows for them, and honours a rejected pair even when the
//     names would satisfy the exact multi-token rule;
//   * a batch-1 filer reaches its board by cik (Zscaler, Nike, Blackstone's
//     two workday sites) and never the token a read refused (the shooting
//     range, the astrology app, the mutual insurer's tenant);
//   * a control multi-token pair still matches, so the refusals are not a
//     dead matcher;
//   * mutation teeth: flipping the seed's rejected rows to accepted on a
//     string copy makes Emerson, Wise, Mosaic, Block and Frontier LEAK; deleting
//     one rejected row lets the exact rule through on the planted names.
// Usage: node scripts/verify-migration-20260918200000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const LANE_A = readdirSync("supabase/migrations").filter((f) => /^202609181\d{5}_/.test(f) && f.endsWith(".sql")).sort();
const SEED = "supabase/migrations/20260918200000_an_alias_is_read_from_the_tenants_own_postings_first.sql";
const mig = (f) => readFileSync(f.startsWith("supabase/") ? f : `supabase/migrations/${f}`, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};

const BOARD_STANDINS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz, country text, region_code text
  );
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text
  );
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
  );
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now()
  );
`;

async function freshDb(seedSql) {
  const db = new PGlite();
  await db.exec(BOARD_STANDINS);
  for (const f of LANE_A) await db.exec(mig(f));
  await db.exec(seedSql);
  return db;
}

check("eleven lane-A migrations found", LANE_A.length === 11, LANE_A.join(", "));
const seedSql = mig(SEED);
check("the seed stamp is outside the lane-A harness's own file glob (a 1xxxxx stamp would break its count)", !/^202609181\d{5}_/.test(SEED.split("/").pop()));

const db = new PGlite();
await db.exec(BOARD_STANDINS);
for (const f of LANE_A) {
  try { await db.exec(mig(f)); } catch (e) { check(`applied ${f}`, false, String(e.message ?? e)); }
}
try {
  await db.exec(seedSql);
  check("applied 20260918200000 after lane A", true);
} catch (e) {
  check("applied 20260918200000 after lane A", false, String(e.message ?? e));
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── counts and shape ─────────────────────────────────────────────────────────
const c0 = await one(`SELECT count(*) FILTER (WHERE decision = 'accepted')::int acc, count(*) FILTER (WHERE decision = 'rejected')::int rej,
                             count(*) FILTER (WHERE decision = 'accepted' AND (cik IS NULL OR alias_norm IS NOT NULL))::int acc_not_cik,
                             count(*) FILTER (WHERE decision = 'accepted' AND evidence NOT LIKE 'company\\_financials 20260722234500%')::int acc_no_cf,
                             count(*) FILTER (WHERE decision = 'accepted' AND relation <> 'filer')::int acc_not_filer,
                             count(DISTINCT cik) FILTER (WHERE decision = 'accepted')::int acc_ciks
                        FROM public.layoff_employer_aliases WHERE decided_by = 'seed-20260918200000'`);
console.log("  seed:", JSON.stringify(c0));
check("batch 1: 238 accepted rows over 173 CIKs (177 slugs resolve; four keep only withheld or rejected tokens), every one cik-keyed, alias_norm NULL, company_financials evidence, 32 of them subsidiary_site",
  c0.acc === 238 && c0.acc_ciks === 173 && c0.acc_not_cik === 0 && c0.acc_no_cf === 0 && c0.acc_not_filer === 32, JSON.stringify(c0));
const subEv = await one(`SELECT count(*)::int n FROM public.layoff_employer_aliases WHERE decided_by = 'seed-20260918200000' AND decision = 'accepted' AND relation = 'subsidiary_site' AND evidence NOT LIKE '%subsidiary\\_site: the tenant path names %'`);
check("every subsidiary_site row's evidence names the brand its tenant path carries", subEv.n === 0, `${subEv.n}`);
check("52 rejected rows, each with a non-blank reason", c0.rej === 52
  && (await one(`SELECT count(*)::int n FROM public.layoff_employer_aliases WHERE decision = 'rejected' AND length(btrim(evidence)) < 20`)).n === 0);
check("no (cik, token) pair is both accepted and rejected", (await one(`SELECT count(*)::int n FROM public.layoff_employer_aliases a JOIN public.layoff_employer_aliases r ON r.cik = a.cik AND r.company_token = a.company_token WHERE a.decision = 'accepted' AND r.decision = 'rejected'`)).n === 0);
check("the seven pairs the never-surface guard plants are rejected rows",
  (await one(`SELECT count(DISTINCT company_token)::int n FROM public.layoff_employer_aliases WHERE decision = 'rejected' AND company_token = ANY($1::text[])`,
    [["emerson~wd5~Emerson_College_Staff", "Wise", "mosaic", "benchmark~wd1~PGH_Careers", "block-llp", "the-block", "eu~frontier", "fmc~wd12~FMC"]])).n === 8);

// ── idempotent re-apply ──────────────────────────────────────────────────────
await db.exec(`UPDATE public.layoff_employer_aliases SET decision = 'rejected', evidence = evidence || ' (owner flipped by hand)' WHERE cik = 1713683 AND company_token = 'zscaler'`);
await db.exec(seedSql);
const c1 = await one(`SELECT count(*)::int n, count(*) FILTER (WHERE decision = 'accepted')::int acc FROM public.layoff_employer_aliases`);
check("re-applying the seed inserts nothing and does not overturn a decision the owner changed by hand", c1.n === c0.acc + c0.rej && c1.acc === c0.acc - 1, JSON.stringify(c1));
await db.exec(`UPDATE public.layoff_employer_aliases SET decision = 'accepted', evidence = replace(evidence, ' (owner flipped by hand)', '') WHERE cik = 1713683 AND company_token = 'zscaler'`);

// ── every alias_norm is what layoff_norm yields for a recorded filer string ──
const RAW_FOR_NORM = {
  "emerson": "Emerson",
  "wise": "Wise Company LLC",
  "mosaic": "Mosaic Company",
  "fmc": "FMC",
  "owens and minor": "Owens & Minor",                       // WARN pre-pass drops "(Avid Medical LLC)" before the norm
  "blueprint medicines": "Blueprint Medicines",
  "universal city studios productions lllp": "Universal City Studios Productions LLLP",
  "compass group usa": "Compass Group USA",
  "chase": "Chase Corporation",
  "amazon": "Amazon",
  "hyatt": "Hyatt Corporation",
  "phillips 66": "Phillips 66",
  "vistra": "Vistra Corp.",
  "liberty healthcare": "Liberty Healthcare Corporation",
  "wisconsin green": "Wisconsin Green, LLC",
  "linkedin": "LinkedIn Corporation",                        // WARN pre-pass drops "(Home Office)"
  "oliver": "Oliver Inc.",
  "apple": "Apple Inc.",
  "block": "Block, Inc.",
};
const norms = (await q(`SELECT DISTINCT alias_norm FROM public.layoff_employer_aliases WHERE alias_norm IS NOT NULL ORDER BY 1`)).map((r) => r.alias_norm);
let normDrift = [];
for (const n of norms) {
  const raw = RAW_FOR_NORM[n];
  if (!raw) { normDrift.push(`${n}: no recorded raw string`); continue; }
  const got = (await one(`SELECT public.layoff_norm($1) AS n`, [raw])).n;
  if (got !== n) normDrift.push(`${n}: layoff_norm(${JSON.stringify(raw)}) = ${JSON.stringify(got)}`);
}
check(`every alias_norm in the seed (${norms.length}) is layoff_norm of the filer string the lane recorded`, norms.length === Object.keys(RAW_FOR_NORM).length && normDrift.length === 0, normDrift.join("; "));

// ── the behavioural negative test: plant every rejected pair and match ──────
// The mirror holds the wrong tokens under their REAL catalogue display names,
// plus a control pair; the postings give every WARN state a live posting so
// the state gate is not what refuses them.
const rejected = await q(`SELECT alias_norm, cik, company_token FROM public.layoff_employer_aliases WHERE decision = 'rejected' ORDER BY company_token, alias_norm, cik`);
const DISPLAY = {
  "emerson~wd5~Emerson_College_Staff": ["workday", "Emerson"], "emerson~wd5~Emerson_College_FT_Faculty": ["workday", "Emerson"],
  "Wise": ["smartrecruiters", "Wise"], "mosaic": ["ashby", "Mosaic"], "benchmark~wd1~PGH_Careers": ["workday", "Benchmark"],
  "block-llp": ["workable", "Block LLP"], "the-block": ["rippling", "The Block"], "eu~frontier": ["lever", "Frontier"], "fmc~wd12~FMC": ["workday", "Fmc"],
  "owens~wd1~OCC": ["workday", "Owens"], "blueprint-health": ["workable", "Blueprint"], "19bf8fca-e2be-49f1-82b2-79850867f105": ["paylocity", "Universal"],
  // urbancompass's real display name is "Compass"; the harness plants the spelling that WOULD
  // satisfy the exact multi-token rule so that the rejected row is provably what refuses it.
  "urbancompass": ["greenhouse", "Compass Group USA"], "chase-design-group": ["workable", "Chase Design Group"], "rivr": ["lever", "Amazon RIVR"],
  "1c7fb0ee-a452-42a0-bb0d-786747fc0bb0": ["adp", "The Hyatt Regency Denver Tech Center"], "phillips-corporation": ["workable", "Phillips Corporation"],
  "2716b08b-489f-42d9-926c-2496cab8e3a2": ["paylocity", "Vistra Communications LLC"], "liberty~wd5~lu_job_board_faculty": ["workday", "Liberty"],
  "wisconsin~wd1~UW_Comprehensives": ["workday", "Wisconsin"], "obsidiansecuritycareers": ["greenhouse", "LinkedIn"],
  "oliver": ["greenhouse", "OLIVER Agency"], "oliverseapac": ["greenhouse", "OLIVER Agency - APAC"], "oliverusa": ["greenhouse", "OLIVER Agency - North America"],
  "oliverargentina": ["greenhouse", "OLIVER Agency - Argentina"], "oliverbrazil": ["greenhouse", "OLIVER Agency - Brasil"],
  "752b499c-ac88-482a-8637-81a8e8fe3fd8": ["paylocity", "Oliver Wine Company Inc"], "d3d6d2fb-98a3-4faa-ae48-d79e7cb0cb9e": ["paylocity", "Oliver Mechanical Inc"],
  "appletreedental": ["lever", "Apple Tree Dental"], "apple-roofing": ["ashby", "Apple Roofing"], "apple-tree-global-consulting-llc": ["breezy", "Apple Tree Global Consulting"],
  "f68070b1-5d83-4080-8248-9c7b654d0259": ["paylocity", "Apple Door Career Page"],
  "city~wd1~CityUS": ["workday", "City"], "city~wd1~CFM": ["workday", "City"], "hashtagpaid": ["lever", "#paid"], "star-sa": ["workable", "Star"],
  "wearenoble": ["workable", "Noble"], "werkenbijorion": ["recruitee", "Orion"], "spire": ["greenhouse", "Spire"], "fuse": ["ashby", "Fuse"], "icon": ["ashby", "Icon"],
  "disco": ["greenhouse", "DISCO"], "kaya": ["personio", "Kaya"], "fa-euqk-saasfaprod1~ocs~CX_1": ["oracle", "NI"], "wf~wd1~wellsfargojobs": ["workday", "Wf"],
  "wf~wd1~wellsfargojobstargeted": ["workday", "Wf"], "thepeoplegroup": ["workable", "The People Group"], "brunswickgroup": ["greenhouse", "Brunswick Group"],
  "blackstone": ["workable", "Blackstone Shooting Sports"], "costar": ["greenhouse", "Co–Star"],
  "trustmark~wd1~healthfitnesscareers": ["workday", "Trustmark"], "trustmark~wd1~trustmarkcareers": ["workday", "Trustmark"],
};
const missingDisplay = rejected.map((r) => r.company_token).filter((t) => !DISPLAY[t]);
check("the harness knows the real display name of every rejected token", missingDisplay.length === 0, missingDisplay.join(", "));
const mirrorRows = Object.entries(DISPLAY).map(([company_token, [vendor, display_name]]) => ({ vendor, company_token, display_name }));
mirrorRows.push(
  { vendor: "lever", company_token: "cambiumnetworks", display_name: "Cambium Networks" },
  { vendor: "greenhouse", company_token: "zscaler", display_name: "Zscaler" },
  { vendor: "workday", company_token: "nike~wd1~nke", display_name: "Nike" },
  { vendor: "workday", company_token: "blackstone~wd1~blackstone_careers", display_name: "Blackstone" },
  { vendor: "workday", company_token: "blackstone~wd1~Blackstone_Campus_Careers", display_name: "Blackstone" },
  { vendor: "workday", company_token: "costar~wd1~CoStarCareers", display_name: "Costar" },
  { vendor: "workday", company_token: "costar~wd1~broadbean_external", display_name: "Costar" },
);
const mirr = await one(`SELECT * FROM public.layoff_board_names_mirror($1::jsonb, now(), false)`, [JSON.stringify(mirrorRows)]);
check("mirror holds every rejected token plus the controls", mirr.lb_total === Object.keys(DISPLAY).length + 7, JSON.stringify(mirr));

const d = (daysAgo) => { const t = new Date(); t.setUTCDate(t.getUTCDate() - daysAgo); return t.toISOString().slice(0, 10); };
const WARN_FILERS = [
  ["Emerson", "VA"], ["Wise Company LLC", "TN"], ["Mosaic Company", "LA"], ["FMC", "AL"], ["Owens & Minor", "VA"],
  ["Blueprint Medicines", "MA"], ["Universal City Studios Productions LLLP", "CA"], ["Compass Group USA", "CA"], ["Chase Corporation", "MA"],
  ["Amazon", "WA"], ["Hyatt Corporation", "CO"], ["Phillips 66", "CA"], ["Vistra Corp.", "IL"], ["Liberty Healthcare Corporation", "CA"],
  ["Wisconsin Green, LLC", "WI"], ["LinkedIn Corporation", "CA"], ["Oliver Inc.", "VA"], ["Apple Inc.", "CA"],
];
const SEC_FILERS = [
  ["Emerson Electric Co", 32604], ["Block, Inc.", 1512673], ["Frontier Group Holdings, Inc.", 1670076], ["Benchmark Electronics Inc", 863436], ["FMC CORP", 37785],
  ["MOSAIC CO", 1285785], ["Owens & Minor, Inc.", 75252], ["Amazon.com, Inc.", 1018724], ["Vistra Corp.", 1692819], ["Apple Inc.", 320193],
  ["CITY HOLDING CO", 726854], ["PAID INC", 1017655], ["Star Holdings", 1953366], ["Noble Corp plc", 1895262], ["Orion Group Holdings Inc", 1402829],
  ["SPIRE INC", 1126956], ["FUSE GROUP HOLDING INC.", 1636051], ["ICON PLC", 1060955], ["Disco Corporation/ADR", 1671750], ["Kaya Holdings, Inc.", 1530746],
  ["NI Holdings, Inc.", 1681206], ["WF Holding Ltd", 1980210], ["People Inc", 1800227], ["BRUNSWICK CORP", 14930],
  ["Blackstone Inc.", 1393818], ["COSTAR GROUP, INC.", 1057352], ["TRUSTMARK CORP", 36146],
  // controls
  ["Zscaler, Inc.", 1713683], ["NIKE, Inc.", 320187], ["Cambium Networks Corp", 1738177],
];
const vals = [];
WARN_FILERS.forEach(([filer, state], i) => vals.push(`('warn:r${i}', 'state_warn', ${sqlq(filer)}, public.layoff_norm(${sqlq(filer)}), '${d(30)}', 'warn_notice_date', '${d(28)}', 'state_received', now(), 'https://example.invalid/${state}', '${state} agency', 'active', NULL, NULL, NULL, NULL, '${state}', 'bln_raw', 'layoff', 120)`));
SEC_FILERS.forEach(([filer, cik], i) => vals.push(`('sec:r${i}', 'sec_8k_205', ${sqlq(filer)}, public.layoff_norm(${sqlq(filer)}), '${d(30)}', 'sec_report_date', '${d(28)}', 'sec_filed', now(), 'https://www.sec.gov/x/${cik}', 'SEC EDGAR', 'active', ${cik}, '0000000000-26-${String(i).padStart(6, "0")}', '8-K', 'Item 2.05 ...', NULL, NULL, NULL, NULL)`));
function sqlq(s) { return `'${String(s).replace(/'/g, "''")}'`; }
await db.exec(`INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis, source_read_at, source_url, source_name, status, cik, adsh, form, section_text, state, feed, event_type, workers) VALUES ${vals.join(",\n")}`);
// a live posting in every WARN state for every mirrored token, so the state gate is never the reason
const postings = [];
for (const tok of [...Object.keys(DISPLAY), "cambiumnetworks"]) for (const st of ["VA", "TN", "LA", "AL", "MA", "CA", "WA", "CO", "IL", "WI"]) postings.push(`('${tok}:${st}', 'x', ${sqlq(tok)}, now() - interval '5 days', now() - interval '5 days', 'US', 'US-${st}')`);
await db.exec(`INSERT INTO public.job_board_postings (id, source, company_token, posted_at, effective_posted, country, region_code) VALUES ${postings.join(",")}`);

const m = await one(`SELECT * FROM public.layoff_matches_rebuild()`);
console.log("  matcher:", JSON.stringify(m));
const rows = await q(`SELECT filing_id, company_token, matched_via FROM public.layoff_matches ORDER BY 1, 2`);
const leaked = rows.filter((r) => rejected.some((x) => x.company_token === r.company_token));
check("ZERO match rows for any rejected token, over filings planted for every rejected pair", leaked.length === 0, JSON.stringify(leaked));
check("the planted name that satisfies the exact rule (Compass Group USA -> a mirror row spelled that way) is refused by the rejected row and counted", m.lm_refused_rejected >= 1 && !rows.some((r) => r.company_token === "urbancompass"), JSON.stringify(m));
check("control: Cambium Networks Corp still joins cambiumnetworks by the exact rule", rows.some((r) => r.company_token === "cambiumnetworks" && r.matched_via === "exact_multitoken"));
check("batch 1 by cik: Zscaler -> zscaler, Nike -> nike~wd1~nke (alias)", rows.some((r) => r.company_token === "zscaler" && r.matched_via === "alias") && rows.some((r) => r.company_token === "nike~wd1~nke" && r.matched_via === "alias"));
const bx = rows.filter((r) => r.filing_id === `sec:r${SEC_FILERS.findIndex(([, c]) => c === 1393818)}`).map((r) => r.company_token).sort();
check("Blackstone Inc. reaches its two workday sites and never the shooting range", JSON.stringify(bx) === JSON.stringify(["blackstone~wd1~Blackstone_Campus_Careers", "blackstone~wd1~blackstone_careers"]), JSON.stringify(bx));
const cs = rows.filter((r) => r.filing_id === `sec:r${SEC_FILERS.findIndex(([, c]) => c === 1057352)}`).map((r) => r.company_token).sort();
check("CoStar Group reaches both workday sites and never the astrology app", JSON.stringify(cs) === JSON.stringify(["costar~wd1~CoStarCareers", "costar~wd1~broadbean_external"]), JSON.stringify(cs));
check("Trustmark Corp reaches nothing (both tenant sites rejected)", !rows.some((r) => r.filing_id === `sec:r${SEC_FILERS.findIndex(([, c]) => c === 36146)}`));
check("Emerson Electric (SEC) and Emerson (WARN) reach nothing", !rows.some((r) => r.company_token.startsWith("emerson~")));
const rd = await q(`SELECT lf_company_token, lf_source FROM public.get_employer_layoff_filings($1::text[])`, [rejected.map((r) => r.company_token)]);
check("the per-token reader answers NULL lf_source for every rejected token", rd.length > 0 && rd.every((r) => r.lf_source === null), JSON.stringify(rd.filter((r) => r.lf_source !== null)));

// ── mutation teeth ───────────────────────────────────────────────────────────
// 1. every rejected row flipped to accepted on a string copy: the wrong pairs leak.
{
  const flipped = seedSql.replace(/'rejected'/g, "'accepted'").replace(/RAISE EXCEPTION[^;]*;/g, "NULL;").replace(/IF v_bad > 0 THEN[\s\S]*?END IF;/g, "");
  const db2 = await freshDb(flipped);
  await db2.exec(`INSERT INTO public.layoff_board_names (vendor, company_token, display_name, display_norm, mirrored_at) SELECT vendor, company_token, display_name, display_norm, now() FROM public.layoff_board_names LIMIT 0`);
  await db2.query(`SELECT public.layoff_board_names_mirror($1::jsonb, now(), false)`, [JSON.stringify(mirrorRows)]);
  await db2.exec(`INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis, source_read_at, source_url, source_name, status, cik, adsh, form, section_text, state, feed, event_type, workers) VALUES ${vals.join(",\n")}`);
  await db2.query(`SELECT * FROM public.layoff_matches_rebuild()`);
  const leak = (await db2.query(`SELECT company_token FROM public.layoff_matches WHERE company_token = ANY($1::text[])`, [["emerson~wd5~Emerson_College_Staff", "Wise", "mosaic", "block-llp", "eu~frontier", "benchmark~wd1~PGH_Careers", "fmc~wd12~FMC", "blackstone"]])).rows;
  check("TEETH: with the seed's rejected rows flipped to accepted, Emerson, Wise, Mosaic, Block, Frontier, Benchmark, FMC and the shooting range LEAK", leak.length >= 8, `${leak.length} leaked`);
  await db2.close();
}
// 2. one rejected row removed: the exact rule admits the planted Compass Group USA spelling.
{
  const without = seedSql.replace(/^\s*\('compass group usa'[^\n]*\n/m, "").replace(/RAISE EXCEPTION[^;]*;/g, "NULL;");
  const db3 = await freshDb(without);
  await db3.query(`SELECT public.layoff_board_names_mirror($1::jsonb, now(), false)`, [JSON.stringify(mirrorRows)]);
  await db3.exec(`INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis, source_read_at, source_url, source_name, status, cik, adsh, form, section_text, state, feed, event_type, workers) VALUES ${vals.join(",\n")}`);
  await db3.exec(`INSERT INTO public.job_board_postings (id, source, company_token, posted_at, effective_posted, country, region_code) VALUES ${postings.join(",")}`);
  await db3.query(`SELECT * FROM public.layoff_matches_rebuild()`);
  const leak = (await db3.query(`SELECT company_token FROM public.layoff_matches WHERE company_token = 'urbancompass'`)).rows;
  check("TEETH: without the Compass Group USA rejection row, the exact rule admits the planted spelling (so the row is what refuses it)", leak.length === 1, `${leak.length} rows`);
  await db3.close();
}

await db.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
