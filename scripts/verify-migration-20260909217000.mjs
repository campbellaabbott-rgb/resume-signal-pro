// Runs 20260909200000 (the prior curves), 20260909210000 (the prior refresh),
// then 20260909217000 / 217500 / 217800 in pglite against a synthetic board
// whose day-30 answers are worked out by hand below, and proves:
//   * every pre-existing column of both curves is unchanged, row for row;
//   * S(30), R(30), X(30) and their identity match hand arithmetic;
//   * the day-30 columns are NULL on a board whose bucket is not admitted, and
//     NULL everywhere before the observability table has been written;
//   * the field curve admits only gated boards and publishes the share;
//   * the day-30 cohort lives inside the event window: at p_days 60 the field
//     curve's day-30 columns equal the p_days-90 answer, at p_days 30 they are
//     NULL, and the lane's first draft (cohort on a fixed 90 days, arms on
//     p_days) is shown to publish S(30) = 1.0 at p_days 30 on a board whose
//     true S(30) is 0.5 -- the accusing direction, with sufficient_30 intact;
//   * our sweep's age-out is censored on the same suspect-or-dark batch at
//     both grains (ageouts_at_30 agrees, employer and field);
//   * refresh_closure_population() writes the table from the same pass as the
//     counts, prunes boards that left the window, and get_closure_population()
//     agrees with the table;
//   * one signature per function, grants re-issued after the catalog drop.
// Usage: node scripts/verify-migration-20260909217000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const mig = (f) => readFileSync(`supabase/migrations/${f}`, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 1e-3) => a !== null && Math.abs(Number(a) - Number(b)) <= eps;

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz
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
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on)
  );
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_stats_rollup (k text PRIMARY KEY, v jsonb NOT NULL, computed_at timestamptz NOT NULL DEFAULT now());
`);

// ── the synthetic board, worked by hand ──────────────────────────────────────
// Every posting is dated 33 days ago: inside the day-30 cohort
// [GREATEST(today-90, 2026-08-07), today-30] whenever today is on or after
// 2026-09-09, and inside the 90-day cohort of the day-14 curve.
// Per board, 80 dated postings:
//   day  5:  10 re-listed        n(5)=80  S(5)=70/80=0.875   X(5)=0.125
//   day 10:  20 taken down       n(10)=70 S(10)=0.875*50/70=0.625  R(10)=0.875*20/70=0.25
//   day 30:  40 aged out (censored at the cap, at risk at 30)
//   day 31:  10 still live (clamped)      n(30)=50
// S(30)=0.625, R(30)=0.25, X(30)=0.125, R+X+S=1.  n_at_risk_30=50, ageouts_at_30=40.
// Greenwood: 10/(80*70) + 20/(70*50) = 0.0017857 + 0.0057143 = 0.0075
//   v = 0.0075 / ln(0.625)^2 = 0.0075/0.22090 = 0.033952; sqrt = 0.18426
//   lo = 0.625^exp(+0.36115) = 0.625^1.4350 = 0.5093
//   hi = 0.625^exp(-0.36115) = 0.625^0.6969 = 0.7208    half-width 0.1058 <= 0.15
// Day 14 (all rows have the same shape as the prior curve saw): unchanged.
async function seedBoard(tok, cat) {
  await db.exec(`
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
    SELECT '${tok}:relist:'||g, 'greenhouse', '${tok}', '${cat}', now() - interval '33 days', now() - interval '33 days' + interval '5 days', true, 'full_read'
    FROM generate_series(1,10) g;
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
    SELECT '${tok}:fill:'||g, 'greenhouse', '${tok}', '${cat}', now() - interval '33 days', now() - interval '33 days' + interval '10 days', false, 'full_read'
    FROM generate_series(1,20) g;
    INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
    SELECT '${tok}:age:'||g, 'greenhouse', '${tok}', '${cat}', 'aged_out', now() - interval '33 days' + interval '30 days', now() - interval '33 days'
    FROM generate_series(1,40) g;
    INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
    SELECT '${tok}:live:'||g, 'greenhouse', '${tok}', '${cat}', now() - interval '33 days', now() - interval '3 days', now() - interval '33 days', now()
    FROM generate_series(1,10) g;
    INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES ('${tok}', current_date - 40, 80);
  `);
}
await seedBoard("A", "engineering"); // full_read
await seedBoard("B", "engineering"); // truncated, never lapped -> unprovable
await seedBoard("C", "design");      // truncated, lap proven
await seedBoard("D", "science");     // truncated, never lapped -> a field with NOTHING admitted

// ── prior definitions, and their answers ─────────────────────────────────────
await db.exec(mig("20260909200000_a_closed_at_that_is_known_to_be_late.sql"));
await db.exec(mig("20260909210000_a_disclosure_that_cannot_load_discloses_nothing.sql"));
const priorCompany = (await db.query(`SELECT * FROM public.get_company_fill_curve(ARRAY['A','B','C','D','ZZ']) ORDER BY company_token`)).rows;
const priorCategory = (await db.query(`SELECT * FROM public.get_category_fill_curve(90, 25) ORDER BY category`)).rows;
check("prior company curve answered", priorCompany.length === 5, `${priorCompany.length} rows`);
check("prior category curve answered", priorCategory.length === 3, `${priorCategory.length} rows`);

// ── the three migrations, in filename order ──────────────────────────────────
await db.exec(mig("20260909217000_a_role_still_up_at_day_thirty_is_a_share_not_a_verdict.sql"));
await db.exec(mig("20260909217500_a_field_is_only_as_open_as_the_boards_we_can_read.sql"));

// Before the table has a single row, every day-30 column must be NULL.
const empty = (await db.query(`SELECT company_token, observability_bucket, still_open_30, sufficient_30, cohort_from, cohort_to FROM public.get_company_fill_curve(ARRAY['A']) `)).rows[0];
check("empty observability table admits nothing: still_open_30 NULL", empty.still_open_30 === null && empty.observability_bucket === null && empty.sufficient_30 === false, JSON.stringify(empty));

// Board ledger + lap map, then the writer.
await db.exec(`
  INSERT INTO public.job_board_board_state (company_token, observed_on, state, stored_count) VALUES
    ('A', current_date, 'ok', 80), ('B', current_date, 'truncated', 80), ('C', current_date, 'truncated', 80), ('D', current_date, 'truncated', 80),
    ('E', current_date, 'error', NULL), ('F', current_date - 20, 'ok', 5);
  INSERT INTO public.job_board_meta (k, v) VALUES ('deep_cursor', '{"__laps": {"greenhouse:C": {"w": "2026-09-09T20:00:00.000Z", "w0": "2026-09-09T15:09:37.655Z"}}}'::jsonb);
`);
await db.exec(mig("20260909217800_the_bucket_we_computed_and_threw_away.sql"));

const obs = (await db.query(`SELECT company_token, bucket, lap_w0 FROM public.job_board_board_observability ORDER BY company_token`)).rows;
check("observability table written by the seed", JSON.stringify(obs.map((r) => [r.company_token, r.bucket])) === JSON.stringify([["A","full_read"],["B","unprovable"],["C","lap_proven"],["D","unprovable"],["E","unobserved"]]), JSON.stringify(obs));
check("lap_w0 parsed from __laps.w0", obs.find((r) => r.company_token === "C").lap_w0 instanceof Date && obs.find((r) => r.company_token === "A").lap_w0 === null);
check("board outside the seven-day window is absent", !obs.some((r) => r.company_token === "F"));
const pop = (await db.query(`SELECT * FROM public.get_closure_population()`)).rows[0];
check("get_closure_population agrees with the table", pop.boards_full_read === 1 && pop.boards_lap_proven === 1 && pop.boards_unprovable === 2 && pop.boards_unobserved === 1 && pop.boards_lap_pending === 0, JSON.stringify(pop));

// ── the company curve, after ─────────────────────────────────────────────────
const after = (await db.query(`SELECT * FROM public.get_company_fill_curve(ARRAY['A','B','C','D','ZZ']) ORDER BY company_token`)).rows;
const oldCols = Object.keys(priorCompany[0]);
let identical = true;
for (let i = 0; i < priorCompany.length; i++) for (const c of oldCols) {
  if (JSON.stringify(priorCompany[i][c]) !== JSON.stringify(after[i][c])) { identical = false; console.log("  drift:", after[i].company_token, c, priorCompany[i][c], "->", after[i][c]); }
}
check(`company: all ${oldCols.length} pre-existing columns identical across 5 rows`, identical);
const A = after.find((r) => r.company_token === "A");
const B = after.find((r) => r.company_token === "B");
const C = after.find((r) => r.company_token === "C");
const ZZ = after.find((r) => r.company_token === "ZZ");
check("A (full_read): still_open_30 = 0.625", near(A.still_open_30, 0.625), `${A.still_open_30}`);
check("A: taken_down_30 = 0.25, relist_rate_30 = 0.125", near(A.taken_down_30, 0.25) && near(A.relist_rate_30, 0.125), `${A.taken_down_30} ${A.relist_rate_30}`);
check("A: R + X + S = 1 checked", near(A.sum_check_30, 1, 1e-6), `${A.sum_check_30}`);
check("A: n_at_risk_30 = 50, ageouts_at_30 = 40", A.n_at_risk_30 === 50 && A.ageouts_at_30 === 40, `${A.n_at_risk_30} ${A.ageouts_at_30}`);
check("A: cll interval [0.5093, 0.7208] by hand", near(A.still_open_30_lo, 0.5093, 2e-3) && near(A.still_open_30_hi, 0.7208, 2e-3), `${A.still_open_30_lo} ${A.still_open_30_hi}`);
check("A: sufficient_30 true, bucket full_read", A.sufficient_30 === true && A.observability_bucket === "full_read");
check("A: fill_rate_30 (old, 90d cohort, no gate) still 0.25 -- a different number on purpose", near(A.fill_rate_30, 0.25), `${A.fill_rate_30}`);
check("B (unprovable): every day-30 column NULL, not 1.0", B.still_open_30 === null && B.still_open_30_lo === null && B.taken_down_30 === null && B.n_at_risk_30 === null && B.sum_check_30 === null && B.sufficient_30 === false && B.observability_bucket === "unprovable", JSON.stringify({ s: B.still_open_30, n: B.n_at_risk_30, b: B.observability_bucket }));
check("B: day-14 columns still answer", B.still_open_14 !== null && B.fill_rate_14 !== null);
check("C (lap_proven): admitted, same arithmetic", near(C.still_open_30, 0.625) && C.sufficient_30 === true && C.observability_bucket === "lap_proven");
check("ZZ (unknown token): NULLs, sufficient_30 false, cohort dates still returned", ZZ.still_open_30 === null && ZZ.sufficient_30 === false && ZZ.cohort_from !== null);
// "Today" is the DATABASE's current_date (production runs in UTC; this
// process's clock and zone are not the function's).
const clock = (await db.query(`SELECT (current_date - 90)::text AS d90, (current_date - 30)::text AS d30`)).rows[0];
const isoDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const d89 = (await db.query(`SELECT ((now() - interval '90 days')::date + 1)::text AS d`)).rows[0].d;
const floorExpected = d89 > "2026-08-07" ? d89 : "2026-08-07";
check(`cohort_from = GREATEST(first whole day after now()-90d, 2026-08-07) = ${floorExpected}`, isoDate(A.cohort_from) === floorExpected, isoDate(A.cohort_from));
check(`cohort_to = current_date - 30 = ${clock.d30}`, isoDate(A.cohort_to) === clock.d30, isoDate(A.cohort_to));

// ── the field curve, after ───────────────────────────────────────────────────
const catAfter = (await db.query(`SELECT * FROM public.get_category_fill_curve(90, 25) ORDER BY category`)).rows;
const oldCatCols = Object.keys(priorCategory[0]);
let catIdentical = catAfter.length === priorCategory.length;
for (let i = 0; i < priorCategory.length && catIdentical; i++) for (const c of oldCatCols) {
  if (JSON.stringify(priorCategory[i][c]) !== JSON.stringify(catAfter[i][c])) { catIdentical = false; console.log("  drift:", catAfter[i].category, c, priorCategory[i][c], "->", catAfter[i][c]); }
}
check(`category: all ${oldCatCols.length} pre-existing columns identical across ${priorCategory.length} rows`, catIdentical);
const eng = catAfter.find((r) => r.category === "engineering");
const des = catAfter.find((r) => r.category === "design");
const sci = catAfter.find((r) => r.category === "science");
check("engineering (A admitted, B not): gate_share_30 = 0.5", near(eng.gate_share_30, 0.5), `${eng.gate_share_30}`);
check("engineering: still_open_30 = 0.625 over the admitted board alone", near(eng.still_open_30, 0.625) && eng.n_at_risk_30 === 50 && near(eng.sum_check_30, 1, 1e-6), `${eng.still_open_30} n=${eng.n_at_risk_30}`);
check("engineering: sufficient_30 true", eng.sufficient_30 === true);
check("design (C lap_proven): gate_share_30 = 1, still_open_30 = 0.625", near(des.gate_share_30, 1) && near(des.still_open_30, 0.625));
check("science (D unprovable only): gate_share_30 = 0 and the day-30 columns NULL, not 1.0", near(sci.gate_share_30, 0) && sci.still_open_30 === null && sci.n_at_risk_30 === null && sci.sufficient_30 === false, JSON.stringify({ g: sci.gate_share_30, s: sci.still_open_30 }));
check("science: day-14 columns still answer", sci.still_open_14 !== null);

// ── the refresh prunes what left the window; board G joins as full_read ──────
// G (field 'legal'), dated 33 days ago: 30 taken down at day 1 (now()-32d,
// OUTSIDE a 30-day event window), 30 aged out at day 30 (now()-3d), and ONE
// closure the collector stamped `suspect` at that same closed_at -- the batch
// key the age-outs share. By hand: n(1)=61, 30 fills at day 1 -> S(30)=31/61=
// 0.5082, R(30)=0.4918, X=0; n_at_risk_30=31; ageouts_at_30 = 0 at BOTH grains
// (the batch is suspect, so the sweep's takedowns are censored, not counted).
// The era snapshot is 200 so the thirty takedowns on one closed_at are NOT a
// feed-dark batch (30 <= 0.30 * 200); and 30 live postings dated 20 days ago
// give the field a day-14 cohort inside a 30-day window, so the row exists at
// p_days 30 and the day-30 NULLs are a row's columns, not a missing row.
await db.exec(`
  INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
  SELECT 'G:fill:'||g, 'greenhouse', 'G', 'legal', now() - interval '33 days', now() - interval '32 days', false, 'full_read' FROM generate_series(1,30) g;
  INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, suspect, absence_basis)
  VALUES ('G:suspect:1', 'greenhouse', 'G', 'legal', now() - interval '33 days', now() - interval '3 days', false, true, 'full_read');
  INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
  SELECT 'G:age:'||g, 'greenhouse', 'G', 'legal', 'aged_out', now() - interval '3 days', now() - interval '33 days' FROM generate_series(1,30) g;
  INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
  SELECT 'G:recent:'||g, 'greenhouse', 'G', 'legal', now() - interval '20 days', now() - interval '20 days', now() - interval '20 days', now() FROM generate_series(1,30) g;
  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES ('G', current_date - 40, 200);
  INSERT INTO public.job_board_board_state (company_token, observed_on, state, stored_count) VALUES ('G', current_date, 'ok', 0);
`);
await db.exec(`UPDATE public.job_board_board_state SET observed_on = current_date - 10 WHERE company_token = 'B'`);
await db.exec(`SELECT public.refresh_closure_population()`);
const afterPrune = (await db.query(`SELECT company_token FROM public.job_board_board_observability ORDER BY 1`)).rows.map((r) => r.company_token);
check("a board that left the seven-day window leaves the table (and G arrives)", JSON.stringify(afterPrune) === JSON.stringify(["A","C","D","E","G"]), JSON.stringify(afterPrune));

// ── one age-out, one verdict; the cohort inside the window ───────────────────
const Gco = (await db.query(`SELECT still_open_30, taken_down_30, n_at_risk_30, ageouts_at_30, observability_bucket FROM public.get_company_fill_curve(ARRAY['G'])`)).rows[0];
check("G (employer grain): S(30)=31/61, n_at_risk_30=31, age-outs in the suspect batch censored -> ageouts_at_30 = 0", Gco.observability_bucket === "full_read" && near(Gco.still_open_30, 31 / 61) && Gco.n_at_risk_30 === 31 && Gco.ageouts_at_30 === 0, JSON.stringify(Gco));
const legalAt = async (days) => (await db.query(`SELECT still_open_30, taken_down_30, relist_rate_30, n_at_risk_30, ageouts_at_30, sum_check_30, cohort_from, cohort_to, gate_share_30, sufficient_30 FROM public.get_category_fill_curve(${days}, 25) WHERE category = 'legal'`)).rows[0];
const legal90 = await legalAt(90);
check("legal (field grain, p_days 90): S(30)=31/61 and ageouts_at_30 = 0 -- the same verdict as the employer grain", legal90 && near(legal90.still_open_30, 31 / 61) && legal90.n_at_risk_30 === 31 && legal90.ageouts_at_30 === 0 && Gco.ageouts_at_30 === legal90.ageouts_at_30, JSON.stringify(legal90));
const legal60 = await legalAt(60);
const dayThirty = (r) => JSON.stringify([r.still_open_30, r.taken_down_30, r.relist_rate_30, r.n_at_risk_30, r.ageouts_at_30, r.sum_check_30, isoDate(r.cohort_from), isoDate(r.cohort_to), r.gate_share_30, r.sufficient_30]);
check("legal at p_days 60: every day-30 column identical to p_days 90 (same cohort, window still holds it)", dayThirty(legal60) === dayThirty(legal90), `${dayThirty(legal60)} vs ${dayThirty(legal90)}`);
const legal30 = await legalAt(30);
check("legal at p_days 30: cohort empty by construction -> day-30 columns NULL, sufficient_30 false, cohort_from > cohort_to", legal30 && legal30.still_open_30 === null && legal30.n_at_risk_30 === null && legal30.sufficient_30 === false && isoDate(legal30.cohort_from) > isoDate(legal30.cohort_to), JSON.stringify(legal30));

// TEETH, executed: the lane's first draft cut the cohort on a fixed 90 days
// while the arms were cut on p_days. Re-issue the field curve with only that
// line reverted and watch it publish S(30) = 1.0 at p_days 30 on G, whose true
// S(30) is 0.5082 -- the thirty day-1 takedowns fell out of the closure arm,
// the thirty-one censored observations stayed.
const catSql = mig("20260909217500_a_field_is_only_as_open_as_the_boards_we_can_read.sql");
const draftLine = "GREATEST((now() - make_interval(days => (SELECT w.d FROM win w)))::date + 1,";
check("the draft fixture differs from the shipped text by exactly the cohort edge", catSql.split(draftLine).length === 2);
await db.exec(catSql.replace(draftLine, "GREATEST((now() - interval '90 days')::date,"));
const draft30 = await legalAt(30);
check("DRAFT at p_days 30 publishes S(30) = 1.0 with cohort_from still 2026-08-07 (the leak the repair closes)", draft30 && near(draft30.still_open_30, 1.0) && draft30.n_at_risk_30 === 31 && near(draft30.taken_down_30, 0), JSON.stringify(draft30));
await db.exec(catSql); // the shipped text back in place
const shipped30 = await legalAt(30);
check("shipped text at p_days 30 is NULL again", shipped30.still_open_30 === null);
const pop2 = (await db.query(`SELECT boards_unprovable FROM public.get_closure_population()`)).rows[0];
check("and the cached count moved with it", pop2.boards_unprovable === 1, `${pop2.boards_unprovable}`);
const Bnow = (await db.query(`SELECT still_open_30, observability_bucket FROM public.get_company_fill_curve(ARRAY['B'])`)).rows[0];
check("B now has no row: bucket NULL, still_open_30 NULL", Bnow.still_open_30 === null && Bnow.observability_bucket === null);

// ── catalogue: one signature each, grants re-issued after the drop ───────────
for (const fn of ["get_company_fill_curve", "get_category_fill_curve", "refresh_closure_population"]) {
  const n = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1`, [fn])).rows[0].n;
  check(`${fn}: exactly one signature`, n === 1, `${n}`);
}
const g = (await db.query(`SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') anon, has_function_privilege('service_role', oid, 'EXECUTE') svc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_company_fill_curve','get_category_fill_curve','refresh_closure_population') ORDER BY 1`)).rows;
check("curves anon-callable, refresh not", g.every((r) => r.svc) && g.filter((r) => r.proname !== "refresh_closure_population").every((r) => r.anon) && !g.find((r) => r.proname === "refresh_closure_population").anon, JSON.stringify(g));
const t = (await db.query(`SELECT has_table_privilege('anon', 'public.job_board_board_observability', 'SELECT') anon, has_table_privilege('service_role', 'public.job_board_board_observability', 'SELECT') svc`)).rows[0];
check("table: anon cannot SELECT, service_role can", t.anon === false && t.svc === true, JSON.stringify(t));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
