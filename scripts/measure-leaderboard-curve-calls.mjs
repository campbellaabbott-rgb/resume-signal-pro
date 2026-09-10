// Measures, in pglite, how many times get_actively_hiring_companies evaluates
// get_company_fill_curve, and what share of the leaderboard's wall time the
// curve is, on a synthetic 2,000-token board (300 eligible employers, every
// branch of the leaderboard's classification exercised by residue class).
//
// WHAT IT SETTLED, 2026-09-10. The leaderboard answered in 15.9s live and the
// diagnosis on offer was that its body "references get_company_fill_curve
// FIVE times", so 20260909217000's heavier curve was being paid fivefold.
// A grep does count five. Four are comments. Executed:
//   * the body the database runs (sliced from 20260909201000 exactly as
//     a-median-drawn's liveFunctions() slices it) enters the curve ONCE --
//     a wrapper's call log holds one row, at p_limit 20 and at p_limit 2000
//     alike, and EXPLAIN ANALYZE over the body shows one Function Scan node
//     with one loop -- because the call sits in a single CTE whose token
//     array is an uncorrelated subquery (an InitPlan, evaluated once);
//   * on this fixture the curve alone, on the same 200 tokens the leaderboard
//     hands it, is ~75% of the leaderboard's wall time, and the SAME curve as
//     20260909200000 defined it (before the day-30 arms) runs in under half
//     the time on identical tokens. The cost is one curve over 200 tokens,
//     not a call multiplier, and a "call it once" restructure of the
//     leaderboard had nothing to restructure. The lever is inside the curve
//     (a day-30 chain computed for 200 employers whose day-30 columns the
//     leaderboard never reads) or upstream of the call (a cached read), and
//     neither is a change to this function.
// src/test/the-leaderboard-reads-the-curve-once.test.ts pins the one-call
// property against the live body, counting code and not comments.
// Usage: node scripts/measure-leaderboard-curve-calls.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const mig = (f) => readFileSync(`supabase/migrations/${f}`, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};

/** The body of one function, sliced the way a-median-drawn's liveFunctions() slices it. */
function sliceFunction(sql, name) {
  const m = sql.match(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, "i"));
  if (!m) throw new Error(`${name} not in file`);
  const open = sql.indexOf("$$", m.index);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(m.index, close + 2) + ";";
}

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz
  );
  CREATE INDEX ON public.job_board_postings (company_token);
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    posting_id text, source text, company_token text, company text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer,
    absence_basis text
  );
  CREATE INDEX ON public.job_board_closures (company_token, closed_at);
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
  );
  CREATE INDEX ON public.job_board_exits (company_token, exited_at);
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date)
  );
  CREATE TABLE public.job_board_verifications (
    company_token text PRIMARY KEY, verified_at timestamptz NOT NULL DEFAULT now(), feed_total integer
  );
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY, reason text NOT NULL DEFAULT '');
`);

// ── the synthetic board: 2,000 tokens, 300 of them big enough to be eligible ──
// Token i (1..300) is "big": 110 live postings posted (i % 20 + 5) days ago,
// 40 single-closure dated fills, 4 superseded relists, 3 roles that are live
// again today, 2 roles closed twice, 20 age-outs. Branch coverage by residue:
//   i % 10 = 0   a suspect batch (10 rows, one closed_at)
//   i % 13 = 0   an unstamped batch of 60 against an era snapshot of 100 -> dark
//   i % 17 = 0   30 lap_backfill rows, which every count must ignore
//   i % 23 = 0   30 superseded events over 3 titles -> get_repost_index's gate
//   i % 29 = 0   28 extra relists -> relist share over a fifth -> HAVING fails
//   i in (5, 6)  showcase_excluded
// Tokens 301..2000 are small: 5 live postings, 2 closures.
await db.exec(`
  INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
  SELECT 't'||i||':live:'||g, 'greenhouse', 't'||i, 'engineering',
         now() - make_interval(days => (i % 20) + 5), now() - interval '3 days',
         now() - make_interval(days => (i % 20) + 5), now()
  FROM generate_series(1, 300) i, generate_series(1, 110) g;
  INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
  SELECT 't'||i||':live:'||g, 'greenhouse', 't'||i, 'engineering',
         now() - make_interval(days => (i % 20) + 5), now() - interval '3 days',
         now() - make_interval(days => (i % 20) + 5), now()
  FROM generate_series(301, 2000) i, generate_series(1, 5) g;

  -- fills: one closure each, dated, stamped batch (batch_live_before set)
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':fill:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Role '||(g % 7),
         now() - make_interval(days => (g % 60) + 1) - make_interval(days => (g % 20) + 1),
         now() - make_interval(days => (g % 60) + 1), false, 500, 'full_read'
  FROM generate_series(1, 300) i, generate_series(1, 40) g;
  -- relists: superseded
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':relist:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Relist '||g,
         now() - interval '20 days', now() - make_interval(days => g + 2), true, 500, 'full_read'
  FROM generate_series(1, 300) i, generate_series(1, 4) g;
  -- roles serving again today (posting_id is live)
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':live:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Back '||g,
         now() - interval '30 days', now() - interval '12 days', false, 500, 'full_read'
  FROM generate_series(1, 300) i, generate_series(1, 3) g;
  -- roles closed twice
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':twice:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Twice '||g,
         now() - interval '40 days', now() - make_interval(days => 8 + k), false, 500, 'full_read'
  FROM generate_series(1, 300) i, generate_series(1, 2) g, generate_series(0, 1) k;
  -- suspect batch
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, suspect, batch_live_before, absence_basis)
  SELECT 't'||i||':sus:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Sus '||g,
         now() - interval '25 days', now() - interval '6 days', false, true, 500, 'full_read'
  FROM generate_series(1, 300) i, generate_series(1, 10) g WHERE i % 10 = 0;
  -- unstamped dark batch: 60 removed on one closed_at against era 100
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':dark:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Dark '||(g % 5),
         now() - interval '50 days', now() - interval '20 days', false, NULL, NULL
  FROM generate_series(1, 300) i, generate_series(1, 60) g WHERE i % 13 = 0;
  -- lap_backfill rows: late closed_at, must be ignored everywhere
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':lap:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Lap '||g,
         now() - interval '60 days', now() - interval '2 days', false, 500, 'lap_backfill'
  FROM generate_series(1, 300) i, generate_series(1, 30) g WHERE i % 17 = 0;
  -- get_repost_index's gate: 30 superseded events over 3 titles
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':churn:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Churn '||(g % 3),
         now() - interval '15 days', now() - make_interval(days => (g % 10) + 1), true, 500, 'full_read'
  FROM generate_series(1, 300) i, generate_series(1, 30) g WHERE i % 23 = 0;
  -- relist share over a fifth
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':share:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Share '||g,
         now() - interval '15 days', now() - make_interval(days => (g % 10) + 1), true, 500, 'full_read'
  FROM generate_series(1, 300) i, generate_series(1, 28) g WHERE i % 29 = 0;
  -- small boards
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, superseded, batch_live_before, absence_basis)
  SELECT 't'||i||':fill:'||g, 'greenhouse', 't'||i, 'Company '||i, 'Role '||g,
         now() - interval '20 days', now() - make_interval(days => g + 3), false, 500, 'full_read'
  FROM generate_series(301, 2000) i, generate_series(1, 2) g;

  INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
  SELECT 't'||i||':age:'||g, 'greenhouse', 't'||i, 'engineering', 'aged_out', now() - interval '10 days', now() - interval '40 days'
  FROM generate_series(1, 300) i, generate_series(1, 20) g;

  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles)
  SELECT 't'||i, current_date - 30, 100 FROM generate_series(1, 300) i;
  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles)
  SELECT 't'||i, current_date - 5, 110 FROM generate_series(1, 300) i;
  INSERT INTO public.job_board_verifications (company_token, verified_at, feed_total)
  SELECT 't'||i, now() - interval '1 hour', CASE WHEN i % 2 = 0 THEN 120 + i END FROM generate_series(1, 2000) i;
  INSERT INTO public.showcase_excluded (company_token) VALUES ('t5'), ('t6');
`);
const sizes = (await db.query(`SELECT (SELECT count(*) FROM public.job_board_postings)::int p, (SELECT count(*) FROM public.job_board_closures)::int c, (SELECT count(DISTINCT company_token) FROM public.job_board_postings)::int toks`)).rows[0];
console.log(`fixture: ${sizes.toks} tokens, ${sizes.p} postings, ${sizes.c} closures`);

// ── the curve BEFORE the day-30 arms (200000), kept under another name ───────
await db.exec(mig("20260909200000_a_closed_at_that_is_known_to_be_late.sql"));
await db.exec(`ALTER FUNCTION public.get_company_fill_curve(text[]) RENAME TO get_company_fill_curve_prior;`);

// ── the live curve (217000), then its observability rows ─────────────────────
await db.exec(mig("20260909217000_a_role_still_up_at_day_thirty_is_a_share_not_a_verdict.sql"));
await db.exec(`
  INSERT INTO public.job_board_board_observability (company_token, bucket)
  SELECT 't'||i, (ARRAY['full_read','lap_proven','unprovable'])[(i % 3) + 1] FROM generate_series(1, 2000) i;
`);

// ── wrap the curve so every evaluation is counted ────────────────────────────
const sig = (await db.query(`SELECT pg_get_function_result(oid) AS r FROM pg_proc WHERE proname = 'get_company_fill_curve' AND pronamespace = 'public'::regnamespace`)).rows[0].r;
await db.exec(`
  ALTER FUNCTION public.get_company_fill_curve(text[]) RENAME TO get_company_fill_curve_real;
  CREATE SEQUENCE public.curve_calls;
  CREATE TABLE public.curve_call_log (n bigint, ntok int, toks text[]);
  CREATE FUNCTION public.get_company_fill_curve(p_tokens text[])
  RETURNS ${sig}
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $w$
  BEGIN
    INSERT INTO public.curve_call_log (n, ntok, toks) VALUES (nextval('public.curve_calls'), cardinality(p_tokens), p_tokens);
    RETURN QUERY SELECT * FROM public.get_company_fill_curve_real(p_tokens);
  END $w$;
`);
const callsSoFar = async () => (await db.query(`SELECT count(*)::int n FROM public.curve_call_log`)).rows[0].n;
const resetCalls = async () => db.exec(`TRUNCATE public.curve_call_log`);

// ── the leaderboard as the database runs it (sliced from 201000) ─────────────
const OLD_FILE = "20260909201000_the_same_late_date_in_thirteen_more_places.sql";
const oldSql = sliceFunction(mig(OLD_FILE), "get_actively_hiring_companies");
check("old body sliced: one CREATE, one $$-body", (oldSql.match(/\$\$/g) || []).length === 2);
const oldMentions = (oldSql.match(/get_company_fill_curve/g) || []).length;
const oldCalls = (oldSql.match(/FROM\s+public\.get_company_fill_curve\s*\(/g) || []).length;
console.log(`old body: ${oldMentions} textual mentions of get_company_fill_curve, ${oldCalls} in FROM position (the rest are comments)`);
await db.exec(oldSql);

for (const limit of [20, 2000]) {
  await resetCalls();
  const t0 = performance.now();
  const rows = (await db.query(`SELECT * FROM public.get_actively_hiring_companies(${limit})`)).rows;
  const ms = performance.now() - t0;
  const n = await callsSoFar();
  const log = (await db.query(`SELECT ntok FROM public.curve_call_log ORDER BY n`)).rows.map((r) => r.ntok);
  check(`old body, p_limit ${limit}: get_company_fill_curve evaluated exactly once`, n === 1, `calls=${n} token sets=${JSON.stringify(log)} rows=${rows.length} ${ms.toFixed(0)}ms`);
}

// EXPLAIN ANALYZE the body itself: count Function Scan nodes on the curve and their loops.
const body = oldSql.slice(oldSql.indexOf("$$") + 2, oldSql.lastIndexOf("$$")).replace(/\bp_limit\b/g, "20");
await resetCalls();
const plan = (await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${body}`)).rows[0]["QUERY PLAN"][0];
const scans = [];
(function walk(node) {
  if (!node) return;
  if (node["Function Name"] === "get_company_fill_curve") scans.push({ loops: node["Actual Loops"], rows: node["Actual Rows"] });
  for (const c of node.Plans || []) walk(c);
})(plan.Plan);
const totalLoops = scans.reduce((a, s) => a + s.loops, 0);
check("EXPLAIN ANALYZE: one Function Scan on get_company_fill_curve, one loop", scans.length === 1 && totalLoops === 1, `nodes=${scans.length} loops=${totalLoops} counter=${await callsSoFar()}`);
console.log(`plan total ${plan["Execution Time"].toFixed(0)}ms`);

// ── the curve's share of the leaderboard's time on this fixture ──────────────
const tokens = (await db.query(`SELECT toks FROM public.curve_call_log ORDER BY n LIMIT 1`)).rows[0].toks;
const time = async (sql) => { const t0 = performance.now(); await db.query(sql); return performance.now() - t0; };
const reps = 3;
const arr = `ARRAY[${tokens.map((t) => `'${t}'`).join(",")}]::text[]`;
let tl = 0, tc = 0, tp = 0;
for (let r = 0; r < reps; r++) {
  tl += await time(`SELECT * FROM public.get_actively_hiring_companies(20)`);
  tc += await time(`SELECT * FROM public.get_company_fill_curve_real(${arr})`);
  tp += await time(`SELECT * FROM public.get_company_fill_curve_prior(${arr})`);
}
console.log(`fixture timing (mean of ${reps}): leaderboard ${(tl / reps).toFixed(0)}ms; curve (217000) alone on its ${tokens.length} tokens ${(tc / reps).toFixed(0)}ms = ${(100 * tc / tl).toFixed(0)}% of the leaderboard; the same curve before the day-30 arms (200000) ${(tp / reps).toFixed(0)}ms`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
