// Runs the eleven layoff-filings migrations (20260918100000 .. 20260918101000)
// in pglite, in filename order, against stand-ins for the board tables they
// read, and proves:
//   * every file applies, and applies AGAIN unchanged (idempotent re-apply);
//   * layoff_norm strips both sides the same way on the names lane 3 named;
//   * the matcher joins an exact two-or-more-token name, refuses a single
//     token, refuses a name two employers share, refuses a WARN match with no
//     live posting in the notice's state, honours a rejected alias, accepts a
//     curated alias by name and by CIK, and matches every site of a
//     multi-site tenant;
//   * the per-token reader answers ONE ROW PER TOKEN with a NULL source on an
//     empty table and for every refused, out-of-window, under-the-bar or
//     amended filing, and the newest qualifying filing with lf_more_n otherwise;
//   * the upsert refuses a future date, an http URL and an 8-K/A that is not an
//     amendment, row by row, without losing the batch;
//   * the partition writer answers two rows with a reason on an empty board,
//     'employers' on a thin filed arm, 'share' when one board holds the arm,
//     and hand-worked S(30), R(30), X(30) and intervals on a synthetic cohort
//     that clears every gate -- with a windowed board contributing nothing;
//   * the partition reader turns an old computed_at into reason 'stale';
//   * the rollup prunes only what it has counted and the match rows go with
//     their filing;
//   * anon and authenticated cannot execute any writer or select any table;
//     the readers are anon-callable; every function has exactly one signature;
//   * the writer's chain passes the estimator-mirror spellings on
//     comment-stripped code.
// Usage: node scripts/verify-migration-20260918100000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const db = new PGlite();
const FILES = readdirSync("supabase/migrations").filter((f) => /^202609181\d{5}_/.test(f) && f.endsWith(".sql")).sort();
const mig = (f) => readFileSync(`supabase/migrations/${f}`, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 1e-3) => a !== null && a !== undefined && Math.abs(Number(a) - Number(b)) <= eps;
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const isoDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

check("eleven lane-A migrations found", FILES.length === 11, FILES.join(", "));

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz, country text, region_code text
  );
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer,
    absence_basis text
  );
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
  );
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date)
  );
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now()
  );
`);

// ── apply, in order ──────────────────────────────────────────────────────────
for (const f of FILES) {
  try {
    await db.exec(mig(f));
    check(`applied ${f}`, true);
  } catch (e) {
    check(`applied ${f}`, false, String(e.message ?? e));
  }
}

// ── the normaliser, executed ─────────────────────────────────────────────────
for (const [raw, want] of [
  ["WELLS FARGO & COMPANY/DE/", "wells fargo"],
  ["The Trade Desk, Inc.", "trade desk"],
  ["Estée Lauder Companies Inc", "estee lauder companies"],
  ["Wood Group USA", "wood group usa"],
  ["International Motors, LLC", "international motors"],
  ["Emerson", "emerson"],
  ["Wise Company LLC", "wise"],
  ["Block, Inc.", "block"],
  ["Frontier Group Holdings, Inc.", "frontier group holdings"],
  ["FMC CORP", "fmc"],
  ["Owens & Minor, Inc.", "owens and minor"],
  ["Kohl's Corp", "kohl s"],
  ["Trifecta JLS, Inc./Plank", "trifecta jls inc plank"],
  ["Turn/River", "turn river"],
  ["KEURIG DR PEPPER INC/DE", "keurig dr pepper"],
]) {
  const got = (await one(`SELECT public.layoff_norm($1) AS n`, [raw])).n;
  check(`layoff_norm(${JSON.stringify(raw)}) = ${JSON.stringify(want)}`, got === want, got);
}

// ── readers on an empty table: one row per token, NULL source ────────────────
const empty = await q(`SELECT * FROM public.get_employer_layoff_filings(ARRAY['a', 'b', 'a'])`);
check("per-token reader on an empty table: two rows for two distinct tokens, both lf_source NULL, lf_more_n 0",
  empty.length === 2 && empty.every((r) => r.lf_source === null && r.lf_more_n === 0), JSON.stringify(empty.map((r) => [r.lf_company_token, r.lf_source])));
const emptyAll = await q(`SELECT * FROM public.get_employer_layoff_filings_all('a')`);
check("lander reader on an empty table: zero rows (the card prints no line and no absence)", emptyAll.length === 0);
const part0 = await q(`SELECT * FROM public.get_layoff_partition()`);
check("partition reader after the seed: two rows, filed then control, both insufficient with reason n",
  part0.length === 2 && part0[0].lp_arm === "filed" && part0[1].lp_arm === "control"
    && part0.every((r) => r.lp_sufficient_30 === false && r.lp_reason === "n" && r.lp_computed_at !== null),
  JSON.stringify(part0.map((r) => [r.lp_arm, r.lp_sufficient_30, r.lp_reason])));
check("partition reader carries the gate thresholds", part0[0].lp_min_n === 25 && near(part0[0].lp_max_half_width, 0.15) && part0[0].lp_min_employers === 10 && near(part0[0].lp_max_employer_share_cap, 0.4) && part0[0].lp_stale_hours === 48);

// ── the mirror: ten board names ──────────────────────────────────────────────
const boards = [
  ["workday", "tysonfoods~wd5", "Tyson Foods"],
  ["lever", "cambiumnetworks", "Cambium Networks"],
  ["greenhouse", "blockhq", "Block"],
  ["workday", "wf~wd1", "Wf"],
  ["workday", "emerson~wd5~Emerson_College_Staff", "Emerson"],
  ["workday", "owens~wd1~OCC", "Owens Corning"],
  ["greenhouse", "owenscorning", "Owens Corning"],
  ["greenhouse", "blueprint-health", "Blueprint Medicines"],
  ["workday", "fedex~wd1~FXE-Canada_External_Career_Site", "Fedex Express"],
  ["workday", "fedex~wd1~FXE_APAC_External", "Fedex Express"],
  ["greenhouse", "acmewidgets", "Acme Widgets"],
  // Two UKG clients under one vendor path, sharing a two-token display name:
  // the vendor path is the first '~' segment, the client the second.
  ["ukg", "recruiting~SUR1004SRGY~aaaa", "Surgery Partners"],
  ["ukg", "recruiting~XYZ9999OTHER~bbbb", "Surgery Partners"],
  // A possessive brand: one word plus an "s" the punctuation pass split off.
  ["oracle", "kohls~us2~CX_1", "Kohl's"],
  ["lever", "gone-token", "Gone Employer"],
];
const stillCatalogued = boards.filter(([, token]) => token !== "gone-token");
const run0 = "2026-09-18T00:00:00Z";
const mirr = await one(`SELECT * FROM public.layoff_board_names_mirror($1::jsonb, $2::timestamptz, false)`,
  [JSON.stringify(boards.map(([vendor, company_token, display_name]) => ({ vendor, company_token, display_name }))), run0]);
check("mirror upserts fifteen rows", mirr.lb_upserted === 15 && mirr.lb_total === 15, JSON.stringify(mirr));
const normed = await one(`SELECT display_norm FROM public.layoff_board_names WHERE company_token = 'owens~wd1~OCC'`);
check("mirror computes display_norm with layoff_norm", normed.display_norm === "owens corning", normed.display_norm);
const run1 = "2026-09-18T01:00:00Z";
const mirr2 = await one(`SELECT * FROM public.layoff_board_names_mirror($1::jsonb, $2::timestamptz, true)`,
  [JSON.stringify(stillCatalogued.map(([vendor, company_token, display_name]) => ({ vendor, company_token, display_name }))), run1]);
check("a later run with p_prune drops the token the catalogue no longer carries", mirr2.lb_pruned === 1 && mirr2.lb_total === 14, JSON.stringify(mirr2));

// ── aliases: accepted by name, accepted by cik, rejected ─────────────────────
await db.exec(`
  INSERT INTO public.layoff_employer_aliases (alias_norm, cik, company_token, relation, state_scope, decision, evidence, decided_by) VALUES
    ('wells fargo', NULL, 'wf~wd1', 'filer', NULL, 'accepted', 'three posting titles read on the tenant: Branch Manager, Teller, Financial Advisor', 'harness'),
    (NULL, 12345, 'blockhq', 'filer', NULL, 'accepted', 'company_financials 20260722234500', 'harness'),
    ('blueprint medicines', NULL, 'blueprint-health', 'filer', NULL, 'rejected', 'blueprint-health is a clinic staffing board, not the biotech', 'harness');
`);
let dupRefused = false;
try {
  await db.exec(`INSERT INTO public.layoff_employer_aliases (alias_norm, cik, company_token, relation, decision, evidence, decided_by) VALUES (NULL, 12345, 'blockhq', 'filer', 'rejected', 'x', 'harness')`);
} catch { dupRefused = true; }
check("one decision per (name, cik, token): a second row for the same cik-keyed pair is refused", dupRefused);

// ── live postings for the state gate ─────────────────────────────────────────
await db.exec(`
  INSERT INTO public.job_board_postings (id, source, company_token, posted_at, effective_posted, country, region_code) VALUES
    ('tyson:il:1', 'workday', 'tysonfoods~wd5', now() - interval '5 days', now() - interval '5 days', 'US', 'US-IL'),
    ('tyson:ar:1', 'workday', 'tysonfoods~wd5', now() - interval '5 days', now() - interval '5 days', 'US', 'US-AR'),
    ('fedex:ca:1', 'workday', 'fedex~wd1~FXE-Canada_External_Career_Site', now() - interval '5 days', now() - interval '5 days', 'US', 'US-TN'),
    ('fedex:ap:1', 'workday', 'fedex~wd1~FXE_APAC_External', now() - interval '5 days', now() - interval '5 days', 'US', 'US-TN'),
    ('acme:ca:1', 'greenhouse', 'acmewidgets', now() - interval '5 days', now() - interval '5 days', 'US', 'US-CA'),
    ('owens:oh:1', 'workday', 'owens~wd1~OCC', now() - interval '5 days', now() - interval '5 days', 'US', 'US-OH'),
    ('owens2:oh:1', 'greenhouse', 'owenscorning', now() - interval '5 days', now() - interval '5 days', 'US', 'US-OH'),
    ('bp:ma:1', 'greenhouse', 'blueprint-health', now() - interval '5 days', now() - interval '5 days', 'US', 'US-MA'),
    ('emerson:va:1', 'workday', 'emerson~wd5~Emerson_College_Staff', now() - interval '5 days', now() - interval '5 days', 'US', 'US-VA'),
    ('sp1:tn:1', 'ukg', 'recruiting~SUR1004SRGY~aaaa', now() - interval '5 days', now() - interval '5 days', 'US', 'US-TN'),
    ('sp2:tn:1', 'ukg', 'recruiting~XYZ9999OTHER~bbbb', now() - interval '5 days', now() - interval '5 days', 'US', 'US-TN'),
    ('kohls:wi:1', 'oracle', 'kohls~us2~CX_1', now() - interval '5 days', now() - interval '5 days', 'US', 'US-WI'),
    ('tyson:il:gone', 'workday', 'tysonfoods~wd5', now() - interval '50 days', now() - interval '50 days', 'US', 'US-WY');
  UPDATE public.job_board_postings SET missing_since = now() - interval '1 day' WHERE id = 'tyson:il:gone';
`);

// ── synthetic filings through the upsert ─────────────────────────────────────
const d = (daysAgo) => {
  const t = new Date(); t.setUTCDate(t.getUTCDate() - daysAgo); return t.toISOString().slice(0, 10);
};
const readAt = new Date().toISOString();
const sec = (id, filer, cik, extra = {}) => ({
  filing_id: `sec:${id}`, source: "sec_8k_205", filer_raw: filer, event_date: d(40), event_basis: "sec_report_date",
  public_date: d(37), public_basis: "sec_filed", source_read_at: readAt, source_url: `https://www.sec.gov/Archives/edgar/data/${cik}/${id}/x.htm`,
  source_name: "SEC EDGAR", status: "active", cik, adsh: id, form: "8-K", section_text: "Item 2.05 Costs Associated with Exit or Disposal Activities ...", ...extra,
});
const warn = (id, filer, state, workers, extra = {}) => ({
  filing_id: `warn:${id}`, source: "state_warn", filer_raw: filer, event_date: d(40), event_basis: "warn_notice_date",
  public_date: d(35), public_basis: "state_received", source_read_at: readAt, source_url: `https://example.invalid/${state}/warn`,
  source_name: `${state} workforce agency`, status: "active", state, feed: "bln_raw", workers, event_type: "layoff", site_raw: `${filer} - plant 1`, ...extra,
});
const batch = [
  sec("0001-1", "Cambium Networks Corp", 1, { pct: 53.6 }),
  sec("0001-2", "Cambium Networks Corp", 1, { form: "8-K/A", status: "amendment", amends_adsh: "0001-1", event_date: d(30), public_date: d(30) }),
  sec("0002-1", "Block, Inc.", 12345, { headcount: 900 }),
  sec("0003-1", "Emerson Electric Co", 3),
  warn("w1", "Tyson Foods Inc", "IL", 120),
  warn("w2", "Tyson Foods Inc", "WY", 80),
  warn("w3", "Wells Fargo & Company", "IA", 200, { filer_for_norm: "Wells Fargo & Company" }),
  warn("w4", "Owens Corning", "OH", 60),
  warn("w5", "Blueprint Medicines", "MA", 75),
  warn("w6", "FedEx Express Corp", "TN", 100),
  warn("w7", "Acme Widgets", "CA", 49),
  warn("w8", "Emerson", "VA", 139),
  warn("w9", "Tyson Foods Inc", "IL", 90, { event_date: d(120), public_date: d(118) }),
  warn("w10", "Tyson Foods Inc", "IL", 60, { event_date: d(10), public_date: d(8) }),
  warn("w11", "Tyson Foods Inc", "IL", null, { event_date: d(3), public_date: d(2) }),
  warn("w12", "Surgery Partners, Inc.", "TN", 110),
  warn("w13", "Kohl's", "WI", 210),
  // refused, one by one:
  warn("bad-future", "Tyson Foods Inc", "IL", 70, { event_date: "2099-12-31", public_date: "2099-12-31" }),
  warn("bad-http", "Tyson Foods Inc", "IL", 70, { source_url: "http://example.invalid/warn" }),
  sec("bad-amend", "Cambium Networks Corp", 1, { form: "8-K/A", status: "active" }),
  { filing_id: "bad-source", source: "press_release", filer_raw: "X", event_date: d(1), public_date: d(1), source_url: "https://x" },
];
const up = await one(`SELECT * FROM public.layoff_filings_upsert($1::jsonb)`, [JSON.stringify(batch)]);
check("upsert: 17 inserted, 4 refused, each refused row named with a reason", up.lu_inserted === 17 && up.lu_updated === 0 && up.lu_refused === 4
  && JSON.stringify(up.lu_refused_ids) === JSON.stringify(["warn:bad-future", "warn:bad-http", "sec:bad-amend", "bad-source"]), JSON.stringify(up));
check("upsert reasons name the rule", /after today/.test(up.lu_refused_reasons[0]) && /https/.test(up.lu_refused_reasons[1]) && /amendment/.test(up.lu_refused_reasons[2]) && /source/.test(up.lu_refused_reasons[3]), JSON.stringify(up.lu_refused_reasons));
const up2 = await one(`SELECT * FROM public.layoff_filings_upsert($1::jsonb)`, [JSON.stringify([batch[0]])]);
check("re-seen row updates, never duplicates", up2.lu_inserted === 0 && up2.lu_updated === 1 && up2.lu_refused === 0, JSON.stringify(up2));
const normRow = await one(`SELECT filer_norm FROM public.layoff_filings WHERE filing_id = 'warn:w3'`);
check("filer_norm is computed in SQL from filer_for_norm", normRow.filer_norm === "wells fargo", normRow.filer_norm);
let futureRefused = false;
try {
  await db.exec(`INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis, source_read_at, source_url, source_name, state, feed, event_type)
                 VALUES ('warn:direct-future', 'state_warn', 'X', 'x', current_date + 1, 'warn_notice_date', current_date, 'state_received', now(), 'https://x', 'x', 'CA', 'bln_raw', 'layoff')`);
} catch { futureRefused = true; }
check("the table's own CHECK refuses a future-dated notice even on a direct insert", futureRefused);

// ── the matcher ──────────────────────────────────────────────────────────────
const m = await one(`SELECT * FROM public.layoff_matches_rebuild()`);
console.log("  matcher:", JSON.stringify(m));
const rows = await q(`SELECT filing_id, company_token, matched_via, matched_norm, relation FROM public.layoff_matches ORDER BY filing_id, company_token`);
const has = (fid, tok, via) => rows.some((r) => r.filing_id === fid && r.company_token === tok && (via ? r.matched_via === via : true));
check("exact two-token SEC filer joins its board (Cambium Networks Corp -> cambiumnetworks)", has("sec:0001-1", "cambiumnetworks", "exact_multitoken"));
check("the 8-K/A is matched too (so it can resolve to its original) but never surfaces (asserted below)", has("sec:0001-2", "cambiumnetworks", "exact_multitoken"));
check("a single-token SEC filer reaches a board ONLY through a cik alias (Block, Inc. -> blockhq)", has("sec:0002-1", "blockhq", "alias") && rows.filter((r) => r.filing_id === "sec:0002-1").length === 1);
check("a two-token name with no mirrored board is unmatched (Emerson Electric Co)", !rows.some((r) => r.filing_id === "sec:0003-1"));
check("WARN exact match with a live posting in the state (Tyson Foods Inc, IL -> tysonfoods~wd5)", has("warn:w1", "tysonfoods~wd5", "exact_multitoken"));
check("WARN exact match REFUSED by the state gate (Tyson Foods Inc, WY: no live WY posting -- the missing one does not count)", !rows.some((r) => r.filing_id === "warn:w2"));
check("WARN alias by name (Wells Fargo & Company -> wf~wd1), relation copied", has("warn:w3", "wf~wd1", "alias") && rows.find((r) => r.filing_id === "warn:w3").relation === "filer");
check("a norm two employers share is refused (Owens Corning: owens~wd1~OCC vs owenscorning)", !rows.some((r) => r.filing_id === "warn:w4"));
check("a human-rejected pair is refused whatever the names say (Blueprint Medicines -> blueprint-health)", !rows.some((r) => r.filing_id === "warn:w5"));
check("every site of one tenant matches (FedEx Express Corp -> both fedex~wd1 sites)", has("warn:w6", "fedex~wd1~FXE-Canada_External_Career_Site") && has("warn:w6", "fedex~wd1~FXE_APAC_External") && rows.filter((r) => r.filing_id === "warn:w6").length === 2);
check("a 49-worker notice is matched (the READER hides it; the matcher decides who, not what)", has("warn:w7", "acmewidgets"));
check("a single-token WARN filer is refused (Emerson -> Emerson College never)", !rows.some((r) => r.filing_id === "warn:w8"));
check("two UKG clients under one vendor path sharing a name are TWO employers: Surgery Partners gets no row on either", !rows.some((r) => r.filing_id === "warn:w12"));
check("a possessive is one word: Kohl's (norm 'kohl s') is refused as single-token, live WI posting or not", !rows.some((r) => r.filing_id === "warn:w13"));
check("matcher counts: alias 2, exact 9 (cambium x2, tyson IL x4, fedex x2, acme), refused_single 2, refused_ambiguous 2, refused_state_gate 1, refused_rejected 1",
  m.lm_alias === 2 && m.lm_exact_multitoken === 9 && m.lm_refused_single === 2 && m.lm_refused_ambiguous === 2 && m.lm_refused_state_gate === 1 && m.lm_refused_rejected === 1, JSON.stringify(m));
check("matcher counts: filings 17, unmatched 7 (Emerson Electric, Tyson WY, Owens, Blueprint, Emerson, Surgery Partners, Kohl's, and no others)", m.lm_filings === 17 && m.lm_unmatched === 7, JSON.stringify([m.lm_filings, m.lm_unmatched]));
const mlog = await one(`SELECT kind, ok, note FROM public.layoff_read_log WHERE kind = 'matcher' ORDER BY id DESC LIMIT 1`);
check("the matcher leaves a read-log row", mlog && mlog.ok === true && /alias=2/.test(mlog.note), JSON.stringify(mlog));

// ── the readers, on the matched set ──────────────────────────────────────────
const toks = ["tysonfoods~wd5", "cambiumnetworks", "blockhq", "wf~wd1", "emerson~wd5~Emerson_College_Staff", "owens~wd1~OCC", "nothere", "acmewidgets", "fedex~wd1~FXE_APAC_External", "blueprint-health"];
const rd = await q(`SELECT * FROM public.get_employer_layoff_filings($1::text[])`, [toks]);
const by = Object.fromEntries(rd.map((r) => [r.lf_company_token, r]));
check("one row per token asked, in token order", rd.length === toks.length && rd.map((r) => r.lf_company_token).join() === [...toks].sort().join(), rd.map((r) => r.lf_company_token).join());
check("tyson: newest qualifying is w10 (10 d), lf_more_n 1 (w1 at 40 d; w9 outside the window; w11 NULL workers never prints)",
  by["tysonfoods~wd5"].lf_source === "state_warn" && isoDate(by["tysonfoods~wd5"].lf_event_date) === d(10) && by["tysonfoods~wd5"].lf_workers === 60 && by["tysonfoods~wd5"].lf_more_n === 1,
  JSON.stringify([by["tysonfoods~wd5"].lf_event_date, by["tysonfoods~wd5"].lf_workers, by["tysonfoods~wd5"].lf_more_n]));
check("tyson row prints the filer verbatim, both dates with their bases, the state, the site and our read",
  by["tysonfoods~wd5"].lf_filer === "Tyson Foods Inc" && by["tysonfoods~wd5"].lf_event_basis === "warn_notice_date" && by["tysonfoods~wd5"].lf_public_basis === "state_received"
    && by["tysonfoods~wd5"].lf_state === "IL" && /plant 1/.test(by["tysonfoods~wd5"].lf_site) && by["tysonfoods~wd5"].lf_read_at instanceof Date);
check("cambium: the 8-K row with its pct, lf_more_n 0 -- the 8-K/A never carries a line", by["cambiumnetworks"].lf_source === "sec_8k_205" && near(by["cambiumnetworks"].lf_pct, 53.6) && by["cambiumnetworks"].lf_form === "8-K" && by["cambiumnetworks"].lf_more_n === 0, JSON.stringify(by["cambiumnetworks"]));
check("block: via cik alias, headcount 900, filer 'Block, Inc.' verbatim", by["blockhq"].lf_source === "sec_8k_205" && by["blockhq"].lf_headcount === 900 && by["blockhq"].lf_filer === "Block, Inc.");
check("wf~wd1: via name alias, 200 workers, relation filer", by["wf~wd1"].lf_source === "state_warn" && by["wf~wd1"].lf_workers === 200 && by["wf~wd1"].lf_relation === "filer");
check("emerson, owens, blueprint, nothere: a row each with NULL source (refused, ambiguous, rejected, unknown)",
  ["emerson~wd5~Emerson_College_Staff", "owens~wd1~OCC", "blueprint-health", "nothere"].every((t) => by[t] && by[t].lf_source === null && by[t].lf_more_n === 0));
check("acmewidgets: matched but 49 workers is under the bar -> NULL source, never 49 and never 0", by["acmewidgets"].lf_source === null && by["acmewidgets"].lf_workers === null);
check("fedex APAC site: the parent's WARN notice, printed as the filer names itself", by["fedex~wd1~FXE_APAC_External"].lf_filer === "FedEx Express Corp" && by["fedex~wd1~FXE_APAC_External"].lf_workers === 100);
const all = await q(`SELECT * FROM public.get_employer_layoff_filings_all('tysonfoods~wd5')`);
check("lander reader: the two qualifying tyson rows newest first, la_total_n 2", all.length === 2 && isoDate(all[0].la_event_date) === d(10) && isoDate(all[1].la_event_date) === d(40) && all.every((r) => r.la_total_n === 2), JSON.stringify(all.map((r) => r.la_event_date)));
const cap = await q(`SELECT count(*)::int n FROM public.get_employer_layoff_filings((SELECT array_agg('t' || g) FROM generate_series(1, 260) g))`);
check("the token list is capped at 200", cap[0].n === 200, `${cap[0].n}`);

// ── the partition: hand-worked arms ──────────────────────────────────────────
// Every posting dated 33 days ago: inside the day-30 cohort. Filings dated 40
// days ago sit inside the 90-day lookback before posting.
// FILED shape, per board (20 postings): day 5: 2 re-listed; day 10: 8 taken
// down; day 30: 8 aged out; 2 still live. n(5)=20 S(5)=0.9 X=0.1; n(10)=18
// S(10)=0.9*10/18=0.5 R=0.9*8/18=0.4; n30=10. Pooled over N boards: S=0.5,
// R=0.4, X=0.1, n30=10N. Greenwood pooled over 12: 24/(240*216)+96/(216*120)
// = 0.0041667; v=0.0041667/ln(0.5)^2=0.0086724; lo=0.5^exp(+0.18253)=0.4352,
// hi=0.5^exp(-0.18253)=0.5613, half-width 0.0630.
// CONTROL shape, per board (20): day 10: 6 taken down; day 30: 12 aged out; 2
// live. S=0.7, R=0.3, X=0, n30=14/board. Pooled over 5: n30=70; Greenwood
// 30/(100*70)=0.0042857; v=0.033688; lo=0.5999, hi=0.7797, half-width 0.0899.
// Three filed boards alone: n30=30, half-width 0.1248 (passes n and width),
// fails employers. A giant with 200 postings pushes the largest share to
// 200/440 = 0.4545 > 0.40 -> share.
async function seedBoard(tok, shape, sfx = "") {
  const p = "now() - interval '33 days'";
  const n = shape === "filed" ? { relist: 2, fill: 8, age: 8, live: 2 } : { relist: 0, fill: 6, age: 12, live: 2 };
  await db.exec(`
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
    SELECT '${tok}:relist${sfx}:'||g, 'workday', '${tok}', 'engineering', ${p}, ${p} + interval '5 days', true, 'full_read' FROM generate_series(1, ${n.relist}) g;
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
    SELECT '${tok}:fill${sfx}:'||g, 'workday', '${tok}', 'engineering', ${p}, ${p} + interval '10 days', false, 'full_read' FROM generate_series(1, ${n.fill}) g;
    INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
    SELECT '${tok}:age${sfx}:'||g, 'workday', '${tok}', 'engineering', 'aged_out', ${p} + interval '30 days', ${p} FROM generate_series(1, ${n.age}) g;
    INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen, country, region_code)
    SELECT '${tok}:live${sfx}:'||g, 'workday', '${tok}', 'engineering', ${p}, now() - interval '3 days', ${p}, now(), 'US', 'US-TX' FROM generate_series(1, ${n.live}) g;
    INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES ('${tok}', current_date - 40, 200) ON CONFLICT DO NOTHING;
    INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('${tok}', 'full_read') ON CONFLICT DO NOTHING;
  `);
}
async function filedBoard(i, tok) {
  await db.exec(`INSERT INTO public.layoff_board_names (vendor, company_token, display_name, display_norm, mirrored_at)
                 VALUES ('workday', '${tok}', 'Filed Employer ${i}', public.layoff_norm('Filed Employer ${i}'), now())`);
  await q(`SELECT * FROM public.layoff_filings_upsert($1::jsonb)`, [JSON.stringify([sec(`f${i}`, `Filed Employer ${i} Inc`, 1000 + i)])]);
  await seedBoard(tok, "filed");
}
for (let i = 1; i <= 5; i++) await seedBoard(`ctrl${i}`, "control");
for (let i = 1; i <= 3; i++) await filedBoard(i, `filed${i}`);
// A windowed board with a filing and everything aged out: must count for nothing.
await db.exec(`INSERT INTO public.layoff_board_names (vendor, company_token, display_name, display_norm, mirrored_at) VALUES ('oracle', 'wind~us2~CX_1', 'Windowed Giant', 'windowed giant', now())`);
await q(`SELECT * FROM public.layoff_filings_upsert($1::jsonb)`, [JSON.stringify([sec("wind", "Windowed Giant Corp", 2000)])]);
await db.exec(`
  INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
  SELECT 'wind:age:'||g, 'oracle', 'wind~us2~CX_1', 'engineering', 'aged_out', now() - interval '3 days', now() - interval '33 days' FROM generate_series(1, 500) g;
  INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('wind~us2~CX_1', 'unprovable');
`);
// A filing dated AFTER the postings keeps its employer in the control arm:
// the question is what was on record when the role was posted.
await db.exec(`INSERT INTO public.layoff_board_names (vendor, company_token, display_name, display_norm, mirrored_at) VALUES ('workday', 'ctrl1', 'Control One', 'control one', now())`);
await q(`SELECT * FROM public.layoff_filings_upsert($1::jsonb)`, [JSON.stringify([sec("late", "Control One Inc", 3000, { event_date: d(20), public_date: d(18) })])]);

await q(`SELECT * FROM public.layoff_matches_rebuild()`);
const mm = await q(`SELECT filing_id, company_token FROM public.layoff_matches WHERE filing_id IN ('sec:f1','sec:f2','sec:f3','sec:wind','sec:late') ORDER BY 1`);
check("the three filed boards, the windowed giant and the late filer all matched", mm.length === 5, JSON.stringify(mm));

let w = await q(`SELECT * FROM public.refresh_layoff_partition()`);
console.log("  writer (3 filed):", JSON.stringify(w));
let filed = w.find((r) => r.lw_arm === "filed");
let ctrl = w.find((r) => r.lw_arm === "control");
check("thin filed arm: n30 = 30 clears n, width clears, employers 3 < 10 -> reason employers", filed.lw_sufficient_30 === false && filed.lw_insufficient_reason === "employers" && filed.lw_n_at_risk_30 === 30 && filed.lw_employers_n === 3, JSON.stringify(filed));
check("thin filed arm: S(30) = 0.5, R(30) = 0.4 by hand", near(filed.lw_still_open_30, 0.5) && near(filed.lw_taken_down_30, 0.4));
check("control arm: n30 = 70 (5 boards x 14; the late filer's board stays control), S(30) = 0.7, sufficient", ctrl.lw_sufficient_30 === true && ctrl.lw_n_at_risk_30 === 70 && near(ctrl.lw_still_open_30, 0.7) && ctrl.lw_insufficient_reason === null, JSON.stringify(ctrl));
let tbl = await q(`SELECT * FROM public.job_board_layoff_partition ORDER BY arm`);
const fRow = tbl.find((r) => r.arm === "filed");
check("filed row: half-width 0.1248 by hand, sum_check 1, employers_n 3, max_employer_share 1/3", near(fRow.half_width_30, 0.1248, 2e-3) && near(fRow.sum_check_30, 1, 1e-6) && near(fRow.max_employer_share, 1 / 3, 1e-3), JSON.stringify(fRow));
check("the windowed board counts for nothing: n30 unchanged by its 500 age-outs", filed.lw_n_at_risk_30 === 30 && ctrl.lw_n_at_risk_30 === 70);
check("newest_filing_event_date and filings_read_at are stamped", isoDate(fRow.newest_filing_event_date) === d(3) && fRow.filings_read_at !== null, isoDate(fRow.newest_filing_event_date));
check("warn lag p50 = public_date - event_date over the last 90 days of notice-dated rows (ten 5s, a 2 and a 1 -> 5; the 120-day row excluded)", near(fRow.warn_lag_p50_days, 5, 1e-6) && fRow.warn_lag_n === 12, JSON.stringify([fRow.warn_lag_p50_days, fRow.warn_lag_n]));

for (let i = 4; i <= 12; i++) await filedBoard(i, `filed${i}`);
await q(`SELECT * FROM public.layoff_matches_rebuild()`);
w = await q(`SELECT * FROM public.refresh_layoff_partition()`);
console.log("  writer (12 filed):", JSON.stringify(w));
filed = w.find((r) => r.lw_arm === "filed");
ctrl = w.find((r) => r.lw_arm === "control");
tbl = await q(`SELECT * FROM public.job_board_layoff_partition ORDER BY arm`);
const F = tbl.find((r) => r.arm === "filed");
const C = tbl.find((r) => r.arm === "control");
check("twelve filed boards: sufficient_30 true, reason NULL, n30 = 120, employers 12, share 1/12", F.sufficient_30 === true && F.insufficient_reason === null && F.n_at_risk_30 === 120 && F.employers_n === 12 && near(F.max_employer_share, 1 / 12, 1e-3), JSON.stringify(F));
check("filed: S(30)=0.5, R(30)=0.4, X(30)=0.1, R+X+S=1 checked", near(F.still_open_30, 0.5) && near(F.taken_down_30, 0.4) && near(F.relist_rate_30, 0.1) && near(F.sum_check_30, 1, 1e-6));
check("filed: cll interval [0.4352, 0.5613] by hand, half-width 0.0630", near(F.still_open_30_lo, 0.4352, 2e-3) && near(F.still_open_30_hi, 0.5613, 2e-3) && near(F.half_width_30, 0.063, 2e-3), JSON.stringify([F.still_open_30_lo, F.still_open_30_hi, F.half_width_30]));
check("control: S(30)=0.7, R(30)=0.3, interval [0.5999, 0.7797], n30 = 70, sufficient", near(C.still_open_30, 0.7) && near(C.taken_down_30, 0.3) && near(C.still_open_30_lo, 0.5999, 2e-3) && near(C.still_open_30_hi, 0.7797, 2e-3) && C.n_at_risk_30 === 70 && C.sufficient_30 === true, JSON.stringify(C));
check("gate_share_30: the windowed giant's 500 dated roles sit in the filed arm's cohort and are NOT admitted -> filed 240/740 = 0.3243 published beside the figure; control 1.0", near(F.gate_share_30, 240 / 740, 1e-3) && near(C.gate_share_30, 1), JSON.stringify([F.gate_share_30, C.gate_share_30]));
const clock = await one(`SELECT (current_date - 30)::text AS d30, ((now() - interval '90 days')::date + 1)::text AS d89`);
const floorExpected = clock.d89 > "2026-08-07" ? clock.d89 : "2026-08-07";
check(`cohort_from = ${floorExpected}, cohort_to = ${clock.d30}`, isoDate(F.cohort_from) === floorExpected && isoDate(F.cohort_to) === clock.d30, `${isoDate(F.cohort_from)} ${isoDate(F.cohort_to)}`);
let pr = await q(`SELECT * FROM public.get_layoff_partition()`);
check("reader: both rows sufficient, lp_separated true (filed hi 0.5613 < control lo 0.5999), no ratio column anywhere",
  pr.every((r) => r.lp_sufficient_30 === true && r.lp_reason === null && r.lp_separated === true) && !Object.keys(pr[0]).some((k) => /ratio|score|rank/.test(k)), JSON.stringify(pr.map((r) => [r.lp_arm, r.lp_sufficient_30, r.lp_separated])));

// One board holding the arm: share fails.
await filedBoard(13, "giant13");
for (let k = 0; k < 9; k++) await seedBoard("giant13", "filed", `x${k}`);
await q(`SELECT * FROM public.layoff_matches_rebuild()`);
w = await q(`SELECT * FROM public.refresh_layoff_partition()`);
filed = w.find((r) => r.lw_arm === "filed");
tbl = await q(`SELECT * FROM public.job_board_layoff_partition WHERE arm = 'filed'`);
check("a giant holding 200 of 440 filed roles: share 0.4545 > 0.40 -> reason share, sufficient false", filed.lw_sufficient_30 === false && filed.lw_insufficient_reason === "share" && near(tbl[0].max_employer_share, 200 / 440, 1e-3), JSON.stringify([filed.lw_insufficient_reason, tbl[0].max_employer_share]));
pr = await q(`SELECT * FROM public.get_layoff_partition()`);
check("reader: the filed row now prints reason share; the control row is unchanged", pr[0].lp_reason === "share" && pr[0].lp_sufficient_30 === false && pr[1].lp_sufficient_30 === true);
await db.exec(`DELETE FROM public.job_board_closures WHERE company_token = 'giant13'; DELETE FROM public.job_board_exits WHERE company_token = 'giant13'; DELETE FROM public.job_board_postings WHERE company_token = 'giant13';`);
w = await q(`SELECT * FROM public.refresh_layoff_partition()`);
check("giant gone: the writer converges back to sufficient (idempotent over its inputs)", w.find((r) => r.lw_arm === "filed").lw_sufficient_30 === true);

// Stale: the reader decides from computed_at.
await db.exec(`UPDATE public.job_board_layoff_partition SET computed_at = now() - interval '3 days'`);
pr = await q(`SELECT * FROM public.get_layoff_partition()`);
check("a reading older than the stale bound reads stale on both rows and is not sufficient", pr.every((r) => r.lp_reason === "stale" && r.lp_sufficient_30 === false));
await q(`SELECT * FROM public.refresh_layoff_partition()`);
pr = await q(`SELECT * FROM public.get_layoff_partition()`);
check("recomputed: sufficient again", pr.every((r) => r.lp_sufficient_30 === true));
const plog = await one(`SELECT count(*)::int n FROM public.layoff_read_log WHERE kind = 'partition' AND ok`);
check("every partition refresh leaves a read-log row", plog.n >= 5, `${plog.n}`);

// ── the estimator spellings, on comment-stripped code ────────────────────────
const RAW = mig(FILES.find((f) => f.startsWith("20260918100700")));
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const boundArm = (code, marker) => { const end = code.indexOf(marker); const start = code.lastIndexOf("CASE WHEN", end); return end < 0 || start < 0 ? "" : code.slice(start, end); };
const mirror = [];
if (!/lag\(\s*[\w.]+\s*,\s*1\s*,\s*1\.0\s*\)\s*OVER/.test(CODE)) mirror.push("lag");
if (!/ln\(\s*GREATEST\(\s*1\.0\s*-\s*[\w.]+\.d::numeric\s*\/\s*[\w.]+\.n\s*,\s*1e-12\s*\)\s*\)/.test(CODE)) mirror.push("clamp");
if (!/sum\(\s*[\w.]+\.cnt\s*\)\s*OVER\s*\(\s*PARTITION BY [\w.]+\.(?:tok|cat)\s+ORDER BY [\w.]+\.tt DESC\s+ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/.test(CODE)) mirror.push("risk-set-desc");
const lo = boundArm(CODE, "AS s30_lo"), hi = boundArm(CODE, "AS s30_hi");
if (!lo || !/exp\(1\.96 \* sqrt\(/.test(lo) || /exp\(-1\.96/.test(lo)) mirror.push("s_lo-branch");
if (!hi || !/exp\(-1\.96 \* sqrt\(/.test(hi)) mirror.push("s_hi-branch");
if (!/sum\(\s*[\w.]+\.s_prev \* [\w.]+\.d_fill::numeric \/ [\w.]+\.n\s*\)\s*OVER/.test(CODE)) mirror.push("r-uses-s_prev");
if (!/sum\(\s*[\w.]+\.s_prev \* [\w.]+\.d_relist::numeric \/ [\w.]+\.n\s*\)\s*OVER/.test(CODE)) mirror.push("x-uses-s_prev");
if (/COALESCE\(\s*[\w.]*posted_at\s*,\s*[\w.]*first_seen\s*\)/i.test(CODE)) mirror.push("coalesced-origin");
if (/interval\s+'7\s+days'/i.test(CODE)) mirror.push("seven-day-floor");
if (/first_seen|effective_posted/.test(CODE.replace(/effective_posted >= now\(\) - interval '30 days'/, ""))) mirror.push("origin-not-posted_at");
check("the writer spells the estimator the mirror guard expects (lag, clamp, DESC risk set, +1.96 lower, s_prev, no coalesced origin, no 7-day floor)", mirror.length === 0, mirror.join(", "));
check("the writer keys the arm on event_date and posted_at, never the read date", /x\.event_date <= c\.posted_at::date/.test(CODE) && !/source_read_at::date\s*<=\s*c\.posted_at/.test(CODE));
check("constants named once for the cross-runtime guard", /90\s+AS layoff_lookback_days/.test(CODE) && /50\s+AS layoff_warn_min_workers/.test(CODE) && /10\s+AS min_arm_employers/.test(CODE) && /0\.40::numeric\s+AS max_employer_share/.test(CODE));

// ── retention: rollup then prune, matches cascade ────────────────────────────
await q(`SELECT * FROM public.layoff_filings_upsert($1::jsonb)`, [JSON.stringify([warn("old", "Tyson Foods Inc", "IL", 300, { event_date: d(400), public_date: d(398) })])]);
await db.exec(`INSERT INTO public.layoff_matches (filing_id, company_token, matched_via, matched_norm, relation) VALUES ('warn:old', 'tysonfoods~wd5', 'exact_multitoken', 'tyson foods', 'filer')`);
await db.exec(`INSERT INTO public.layoff_read_log (kind, read_at, ok) VALUES ('warn', now() - interval '100 days', true)`);
const roll = await one(`SELECT * FROM public.roll_up_and_prune_layoff_filings(365)`);
const stillThere = await one(`SELECT count(*)::int n FROM public.layoff_filings WHERE filing_id = 'warn:old'`);
const rolled = await one(`SELECT filings, workers_sum FROM public.layoff_filing_rollup WHERE source = 'state_warn' AND state = 'IL'`);
const matchGone = await one(`SELECT count(*)::int n FROM public.layoff_matches WHERE filing_id = 'warn:old'`);
check("rollup: one month rolled (1 filing, 300 workers), the row pruned, its match row gone with it, one old log row trimmed",
  roll.lr_months_rolled === 1 && roll.lr_filings_pruned === 1 && roll.lr_log_rows_pruned === 1 && stillThere.n === 0 && rolled && rolled.filings === 1 && Number(rolled.workers_sum) === 300 && matchGone.n === 0, JSON.stringify([roll, rolled]));
const kept = await one(`SELECT count(*)::int n FROM public.layoff_filings`);
check("nothing inside the keep window was pruned", kept.n === 17 + 12 + 1 + 1 + 1, `${kept.n}`);
const floorKeep = await one(`SELECT * FROM public.roll_up_and_prune_layoff_filings(7)`);
check("the keep window floors at 180 days: a 7-day ask prunes nothing inside it", floorKeep.lr_filings_pruned === 0);

// ── privileges ───────────────────────────────────────────────────────────────
const fns = await q(`SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS authed, has_function_privilege('service_role', oid, 'EXECUTE') AS svc
                     FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('layoff_norm','layoff_board_names_mirror','layoff_filings_upsert','layoff_matches_rebuild','get_employer_layoff_filings','get_employer_layoff_filings_all','refresh_layoff_partition','get_layoff_partition','roll_up_and_prune_layoff_filings','layoff_cron_key_matches') ORDER BY 1`);
const writers = ["layoff_board_names_mirror", "layoff_filings_upsert", "layoff_matches_rebuild", "refresh_layoff_partition", "roll_up_and_prune_layoff_filings", "layoff_cron_key_matches"];
const readers = ["get_employer_layoff_filings", "get_employer_layoff_filings_all", "get_layoff_partition", "layoff_norm"];
check("all ten functions present", fns.length === 10, fns.map((f) => f.proname).join(","));
check("anon and authenticated cannot execute any writer; service_role can", writers.every((n) => { const f = fns.find((x) => x.proname === n); return f && !f.anon && !f.authed && f.svc; }), JSON.stringify(fns));
check("readers are anon-callable", readers.every((n) => { const f = fns.find((x) => x.proname === n); return f && f.anon && f.authed && f.svc; }));
for (const fn of fns) {
  const n = (await one(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = $1`, [fn.proname])).n;
  check(`${fn.proname}: exactly one signature`, n === 1, `${n}`);
}
const tables = ["layoff_filings", "layoff_employer_aliases", "layoff_board_names", "layoff_matches", "layoff_feed_health", "layoff_read_log", "layoff_filing_rollup", "job_board_layoff_partition"];
for (const t of tables) {
  const p = await one(`SELECT has_table_privilege('anon', 'public.${t}', 'SELECT') AS anon, has_table_privilege('authenticated', 'public.${t}', 'SELECT') AS authed, has_table_privilege('service_role', 'public.${t}', 'SELECT') AS svc,
                        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${t}'::regclass) AS rls, (SELECT count(*)::int FROM pg_policies WHERE tablename = '${t}') AS policies`);
  check(`${t}: RLS on, no policy, anon and authenticated cannot select, service_role can`, p.rls === true && p.policies === 0 && !p.anon && !p.authed && p.svc, JSON.stringify(p));
}
const key = await one(`SELECT public.layoff_cron_key_matches(repeat('x', 40)) AS ok, public.layoff_cron_key_matches('') AS empty, public.layoff_cron_key_matches(NULL) AS nul`);
check("cron key matcher: false without a vault, false on empty, false on NULL", key.ok === false && key.empty === false && key.nul === false);
const definers = await q(`SELECT proname, prosecdef, proconfig FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE '%layoff%' OR proname = 'layoff_norm' ORDER BY 1`);
check("every reader and writer over the locked tables is SECURITY DEFINER with search_path pinned",
  definers.filter((f) => f.proname !== "layoff_norm").every((f) => f.prosecdef && (f.proconfig ?? []).some((c) => /^search_path=/.test(c))), JSON.stringify(definers.map((f) => [f.proname, f.prosecdef])));

// ── idempotent re-apply ──────────────────────────────────────────────────────
const before = await one(`SELECT (SELECT count(*) FROM public.layoff_filings) f, (SELECT count(*) FROM public.layoff_matches) m, (SELECT count(*) FROM public.layoff_employer_aliases) a, (SELECT count(*) FROM public.layoff_board_names) b`);
for (const f of FILES) {
  try { await db.exec(mig(f)); check(`re-applied ${f}`, true); } catch (e) { check(`re-applied ${f}`, false, String(e.message ?? e)); }
}
const after = await one(`SELECT (SELECT count(*) FROM public.layoff_filings) f, (SELECT count(*) FROM public.layoff_matches) m, (SELECT count(*) FROM public.layoff_employer_aliases) a, (SELECT count(*) FROM public.layoff_board_names) b`);
check("re-apply changed no data", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
const rd2 = await q(`SELECT lf_company_token, lf_source FROM public.get_employer_layoff_filings(ARRAY['tysonfoods~wd5', 'nothere'])`);
check("readers still answer after re-apply (token order: nothere, then tyson)", rd2.length === 2 && rd2[0].lf_company_token === "nothere" && rd2[0].lf_source === null && rd2[1].lf_source === "state_warn", JSON.stringify(rd2));

// ── teeth: the two-token clause is what keeps Emerson out ────────────────────
// Re-issue the matcher from a string copy with the token floor lowered to one
// and watch the single-token WARN filer join Emerson College; then put the
// shipped text back and watch it leave again. A guard that cannot fire is
// decoration.
const MATCHER = mig(FILES.find((f) => f.startsWith("20260918100400")));
const clause = "(SELECT count(*) FROM unnest(string_to_array(f.filer_norm, ' ')) AS tk(t) WHERE length(tk.t) >= 2) >= 2";
check("the matcher spells the token floor where the mutation expects it (three sites: the insert and two counts)", MATCHER.split(clause).length === 4);
await db.exec(MATCHER.replaceAll(clause, "(SELECT count(*) FROM unnest(string_to_array(f.filer_norm, ' ')) AS tk(t) WHERE length(tk.t) >= 2) >= 1"));
await q(`SELECT * FROM public.layoff_matches_rebuild()`);
const leaked = await one(`SELECT lf_source, lf_filer FROM public.get_employer_layoff_filings(ARRAY['emerson~wd5~Emerson_College_Staff'])`);
check("MUTATED matcher leaks: Emerson (139 workers, VA) now prints on Emerson College's board", leaked.lf_source === "state_warn" && leaked.lf_filer === "Emerson", JSON.stringify(leaked));
const leakedKohls = await one(`SELECT lf_source, lf_filer FROM public.get_employer_layoff_filings(ARRAY['kohls~us2~CX_1'])`);
check("MUTATED matcher leaks: Kohl's (210 workers, WI) now prints too -- the floor is what keeps a possessive out", leakedKohls.lf_source === "state_warn" && leakedKohls.lf_filer === "Kohl's", JSON.stringify(leakedKohls));
await db.exec(MATCHER);
await q(`SELECT * FROM public.layoff_matches_rebuild()`);
const sealed = await one(`SELECT lf_source FROM public.get_employer_layoff_filings(ARRAY['emerson~wd5~Emerson_College_Staff'])`);
check("shipped matcher back in place: Emerson College's row is NULL again", sealed.lf_source === null);
// The employer key, the same way: count employers by the token's first
// segment alone and the two UKG clients collapse into one, so Surgery
// Partners prints on both of them.
const keyClause = `CASE WHEN split_part(b.company_token, '~', 1) IN ('recruiting', 'recruiting2')
                  THEN split_part(b.company_token, '~', 1) || '~' || split_part(b.company_token, '~', 2)
                WHEN split_part(b.company_token, '~', 1) = 'eu' THEN b.company_token
                ELSE split_part(b.company_token, '~', 1) END AS employer`;
check("the matcher spells the employer key where the mutation expects it (three sites)", MATCHER.split(keyClause).length === 4);
await db.exec(MATCHER.replaceAll(keyClause, "split_part(b.company_token, '~', 1) AS employer"));
const mKey = await one(`SELECT * FROM public.layoff_matches_rebuild()`);
const leakedUkg = await q(`SELECT lf_company_token, lf_source, lf_filer FROM public.get_employer_layoff_filings(ARRAY['recruiting~SUR1004SRGY~aaaa', 'recruiting~XYZ9999OTHER~bbbb'])`);
check("MUTATED employer key (first segment only) leaks: Surgery Partners prints on BOTH UKG clients and refused_ambiguous drops to 1",
  leakedUkg.length === 2 && leakedUkg.every((r) => r.lf_source === "state_warn" && r.lf_filer === "Surgery Partners, Inc.") && mKey.lm_refused_ambiguous === 1, JSON.stringify([leakedUkg, mKey.lm_refused_ambiguous]));
await db.exec(MATCHER);
const mSealed = await one(`SELECT * FROM public.layoff_matches_rebuild()`);
const sealedUkg = await q(`SELECT lf_source FROM public.get_employer_layoff_filings(ARRAY['recruiting~SUR1004SRGY~aaaa', 'recruiting~XYZ9999OTHER~bbbb'])`);
check("shipped matcher back in place: both UKG rows NULL, refused_ambiguous 2 again", sealedUkg.every((r) => r.lf_source === null) && mSealed.lm_refused_ambiguous === 2);
// And the reader's own predicates, the same way: drop the worker bar and the
// 49-worker notice prints; drop the status predicate and the 8-K/A prints.
const READER = mig(FILES.find((f) => f.startsWith("20260918100500")));
const workerBar = "AND (f.source <> 'state_warn' OR f.workers >= (SELECT kk.layoff_warn_min_workers FROM k kk))";
const amendBar = "AND f.form IS DISTINCT FROM '8-K/A'";
check("the reader spells both bars once each", READER.split(workerBar).length === 2 && READER.split(amendBar).length === 2);
await db.exec(READER.replace(workerBar, ""));
const under = await one(`SELECT lf_workers FROM public.get_employer_layoff_filings(ARRAY['acmewidgets'])`);
check("MUTATED reader without the worker bar prints the 49-worker notice", under.lf_workers === 49, JSON.stringify(under));
await db.exec(READER.replace(amendBar, "").replace("f.status = 'active'", "f.status IN ('active', 'amendment')"));
const amend = await one(`SELECT lf_form, lf_more_n FROM public.get_employer_layoff_filings(ARRAY['cambiumnetworks'])`);
check("MUTATED reader without the status and form bars lists the 8-K/A (lf_more_n 1)", amend.lf_more_n === 1, JSON.stringify(amend));
await db.exec(READER);
const sealed2 = await q(`SELECT lf_company_token, lf_workers, lf_more_n FROM public.get_employer_layoff_filings(ARRAY['acmewidgets', 'cambiumnetworks'])`);
check("shipped reader back in place: 49 hidden, 8-K/A hidden", sealed2[0].lf_workers === null && sealed2[1].lf_more_n === 0, JSON.stringify(sealed2));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
