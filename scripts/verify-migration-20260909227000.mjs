// Runs 20260909227000 (get_company_growth) in pglite against boards worked
// out by hand -- one for every verdict and every unknown_reason -- and proves:
//   * the arithmetic: net and rate on the served series, baseline = the day's
//     count, on a global window anchored on the series' latest day;
//   * both bars must clear (net >= 4 AND rate >= 0.25), each alone is no-growth;
//   * every gate refuses with its named reason, in the documented precedence;
//   * a censored tenure passes as a floor and is flagged tenure_censored;
//   * our own untracked departures are summed, NULL when no flow row exists;
//   * a row comes back for every token asked, including one never snapshotted;
//   * the ledger is read one day EARLIER than the series: a 'truncated' or an
//     'error' read on baseline_day - 1 ALONE refuses the board (that read
//     produced the baseline count), and one on baseline_day - 2 alone does not;
//   * a pool that was replaced under us (removed departures over the window
//     >= the baseline served count) is unknown / pool_replaced, never grew;
//   * TEETH: a mutant that buckets read quality on `IS DISTINCT FROM
//     'truncated'` admits the board with no ledger row at all (the NULL trap
//     get_closure_population documents), and the shipped text refuses it;
//   * TEETH: with the series two days stale every token answers series_stale;
//   * one signature, anon EXECUTE granted, the source tables not anon-readable.
// Usage: node scripts/verify-migration-20260909227000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const MIG = "supabase/migrations/20260909227000_a_board_that_grew_is_a_rate_with_gates_not_a_count.sql";
const sql = readFileSync(MIG, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 1e-6) => a !== null && Math.abs(Number(a) - Number(b)) <= eps;
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_company_snapshots (
    company_token text NOT NULL, snapshot_date date NOT NULL, company text NOT NULL DEFAULT '',
    open_roles integer NOT NULL DEFAULT 0, open_roles_served integer,
    PRIMARY KEY (company_token, snapshot_date)
  );
  ALTER TABLE public.job_board_company_snapshots ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.job_board_company_snapshots FROM anon, authenticated;
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on)
  );
  ALTER TABLE public.job_board_board_state ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.job_board_board_state FROM anon, authenticated;
  CREATE TABLE public.job_board_company_flow (
    company_token text NOT NULL, flow_date date NOT NULL,
    arrivals_observed integer NOT NULL DEFAULT 0, departures_removed integer NOT NULL DEFAULT 0,
    departures_untracked integer NOT NULL DEFAULT 0, departures_total integer NOT NULL DEFAULT 0,
    PRIMARY KEY (company_token, flow_date)
  );
  ALTER TABLE public.job_board_company_flow ENABLE ROW LEVEL SECURITY;
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY, reason text NOT NULL DEFAULT '');
`);

// ── the boards, by hand ──────────────────────────────────────────────────────
// The window: latest_day = today (D0), baseline_day = D-7, eight served rows;
// the LEDGER window is D-8..D0, nine rows, because the snapshot dated D is the
// product of the read dated D-1. Every board below is snapshotted from `first`
// days ago to today unless told otherwise; served counts run linearly from `b`
// on D-7 to `l` on D0 (the interior days carry the baseline count, which the
// rate never reads). 'OLD' sets the table floor at D-60 with a pre-served-era
// NULL row. `removed`/`arrived` write one flow row on D-3.
async function board(tok, { b, l, first = 40, ledger = "ok", skipDay = null, ledgerDays = null, untracked = null, removed = null, arrived = 0, exclude = false }) {
  for (let d = first; d >= 0; d--) {
    if (skipDay !== null && d === skipDay) continue;
    const served = d === 0 ? l : b;
    await db.exec(`INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles, open_roles_served)
                   VALUES ('${tok}', current_date - ${d}, ${served + 5}, ${served});`);
  }
  const days = ledgerDays ?? [8, 7, 6, 5, 4, 3, 2, 1, 0];
  for (const d of days) {
    const state = typeof ledger === "string" ? ledger : (ledger[d] ?? "ok");
    await db.exec(`INSERT INTO public.job_board_board_state (company_token, observed_on, state, stored_count)
                   VALUES ('${tok}', current_date - ${d}, '${state}', ${b});`);
  }
  if (untracked !== null || removed !== null) {
    await db.exec(`INSERT INTO public.job_board_company_flow (company_token, flow_date, arrivals_observed, departures_removed, departures_untracked, departures_total)
                   VALUES ('${tok}', current_date - 3, ${arrived}, ${removed ?? 0}, ${untracked ?? 0}, ${(removed ?? 0) + (untracked ?? 0)});`);
  }
  if (exclude) await db.exec(`INSERT INTO public.showcase_excluded (company_token, reason) VALUES ('${tok}', 'test');`);
}
await db.exec(`INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles, open_roles_served)
               VALUES ('OLD', current_date - 60, 3, NULL);`);
await board("A",  { b: 10, l: 14 });                                   // grew: +4, +40%
await board("A2", { b: 20, l: 24 });                                   // net 4 but 20%: no-growth
await board("A3", { b: 10, l: 13 });                                   // 30% but net 3: no-growth
await board("A4", { b: 10, l: 15 });                                   // +5, +50%: grew
await board("B",  { b: 678, l: 2000, ledger: { 4: "truncated" } });    // windowed_read
// THE BASELINE'S OWN READ. The count dated D-7 was taken at 02:30 on D-7 from
// the read dated D-8. A cursor walk through D-8 and a whole read from D-7 on
// is exactly the transition that publishes as +N00% if the ledger is only
// read over the snapshot days.
await board("CAP",  { b: 600, l: 2600, ledger: { 8: "truncated" } });  // windowed_read (D-8 alone)
await board("CAP2", { b: 600, l: 2600, ledger: { 8: "error" } });      // failed_read (D-8 alone)
await board("CAP3", { b: 10, l: 14, ledger: { 9: "truncated" }, ledgerDays: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] }); // D-9 is outside: grew
await board("G2", { b: 10, l: 14, ledgerDays: [7, 6, 5, 4, 3, 2, 1, 0] }); // ledger_gap (D-8 unvisited)
// THE POOL WAS REPLACED. An undated board re-keyed by its vendor: 100 stored,
// 30 inside the first_seen fence, then every id new -> served 100. Every other
// gate passes; removed departures (100) >= baseline served (30) refuses it.
await board("P",  { b: 30, l: 100, removed: 100, arrived: 100 });      // pool_replaced
await board("P2", { b: 10, l: 14, removed: 9, arrived: 13 });          // removed 9 < baseline 10: still grew
await board("P3", { b: 5, l: 9, removed: 10 });                        // precedence: too_small before pool_replaced
await board("C",  { b: 5, l: 9 });                                     // too_small (+80% on 5)
await board("D",  { b: 10, l: 14, first: 17 });                        // too_new: first snapshot D-17, baseline D-7 -> 10 days
await board("D2", { b: 10, l: 14, first: 28 });                        // tenure exactly 21: passes
await board("E",  { b: 10, l: 14, skipDay: 3 });                       // series_gap (interior)
await board("E2", { b: 10, l: 14, skipDay: 7 });                       // series_gap (baseline endpoint)
await board("F",  { b: 10, l: 14, ledgerDays: [] });                   // not_in_ledger
await board("G",  { b: 10, l: 14, ledgerDays: [8, 7, 6, 5, 4, 3, 2, 0] }); // ledger_gap (D-1 unvisited)
await board("H",  { b: 10, l: 14, ledger: { 2: "error" } });           // failed_read
await board("K",  { b: 20, l: 30, ledger: { 5: "dark" } });            // failed_read ('dark' is not ok)
await board("K2", { b: 20, l: 30, ledger: { 5: "empty" } });           // failed_read ('empty' is not ok)
await board("I",  { b: 10, l: 14, exclude: true });                    // excluded
await board("J",  { b: 12, l: 17, first: 60 });                        // censored at the floor, grew
await board("L",  { b: 20, l: 12, untracked: 8 });                     // fell after OUR dedupe: no-growth, untracked 8
await board("M",  { b: 10, l: 14, ledger: { 4: "truncated", 2: "error" }, exclude: true }); // precedence: excluded first
await board("N",  { b: 5, l: 9, ledger: { 4: "truncated" } });         // precedence: too_small before windowed_read

await db.exec(sql);

const rows = (await db.query(`SELECT * FROM public.get_company_growth(ARRAY['A','A2','A3','A4','B','CAP','CAP2','CAP3','G2','P','P2','P3','C','D','D2','E','E2','F','G','H','K','K2','I','J','L','M','N','ZZ'])`)).rows;
const by = Object.fromEntries(rows.map((r) => [r.company_token, r]));
check("a row for every token asked, including one never snapshotted", rows.length === 28, `${rows.length}`);

const today = (await db.query(`SELECT current_date::text AS d0, (current_date - 7)::text AS d7`)).rows[0];
const A = by.A;
check("A: window anchored on the series' latest day, baseline seven days back", iso(A.latest_day) === today.d0 && iso(A.baseline_day) === today.d7 && A.window_days === 7 && A.days_expected === 8, `${iso(A.baseline_day)}..${iso(A.latest_day)}`);
check("A: 10 -> 14 is net 4, rate 0.4, grew", A.baseline_served === 10 && A.latest_served === 14 && A.net === 4 && near(A.rate, 0.4) && A.verdict === "grew" && A.unknown_reason === null, JSON.stringify({ n: A.net, r: A.rate, v: A.verdict }));
check("A: eight served days observed, nine ledger days (D-8..D0) ok, none bad", A.days_observed === 8 && A.ledger_days_expected === 9 && A.board_days_ok === 9 && A.board_days_bad === 0, JSON.stringify({ e: A.ledger_days_expected, ok: A.board_days_ok }));
check("A: no flow row -> removed_departures and observed_arrivals NULL too", A.removed_departures === null && A.observed_arrivals === null);
check("A: tenure 33 days from a first snapshot at D-40, not censored", A.tenure_days === 33 && A.tenure_censored === false && iso(A.first_snapshot_day) !== "", `${A.tenure_days}`);
check("A: no flow row -> untracked_departures NULL, never a fabricated 0", A.untracked_departures === null);
check("A2: net 4 at 20% is no-growth (the rate bar refuses)", by.A2.verdict === "no-growth" && by.A2.net === 4 && near(by.A2.rate, 0.2));
check("A3: 30% on net 3 is no-growth (the net-add bar refuses)", by.A3.verdict === "no-growth" && by.A3.net === 3 && near(by.A3.rate, 0.3));
check("A4: +5 / +50% grew", by.A4.verdict === "grew");
check("B: one truncated day refuses +195% as windowed_read", by.B.verdict === "unknown" && by.B.unknown_reason === "windowed_read" && by.B.net === 1322, `${by.B.unknown_reason}`);
check("CAP: a truncated read on baseline_day - 1 ALONE refuses +333% -- that read produced the baseline count", by.CAP.verdict === "unknown" && by.CAP.unknown_reason === "windowed_read" && by.CAP.net === 2000 && by.CAP.board_days_ok === 8, JSON.stringify({ v: by.CAP.verdict, r: by.CAP.unknown_reason, ok: by.CAP.board_days_ok }));
check("CAP2: an 'error' read on baseline_day - 1 alone is failed_read", by.CAP2.verdict === "unknown" && by.CAP2.unknown_reason === "failed_read" && by.CAP2.board_days_bad === 1);
check("CAP3: a truncated read on baseline_day - 2 is outside the ledger window -- the bound is one day, not open-ended", by.CAP3.verdict === "grew" && by.CAP3.board_days_ok === 9, JSON.stringify({ v: by.CAP3.verdict, ok: by.CAP3.board_days_ok }));
check("G2: eight ok days of nine (D-8 unvisited) is ledger_gap", by.G2.verdict === "unknown" && by.G2.unknown_reason === "ledger_gap" && by.G2.board_days_ok === 8);
check("P: 30 -> 100 with 100 removed over the window is pool_replaced, never grew (+233%)", by.P.verdict === "unknown" && by.P.unknown_reason === "pool_replaced" && near(by.P.rate, 2.3333) && by.P.removed_departures === 100 && by.P.observed_arrivals === 100, JSON.stringify({ v: by.P.verdict, r: by.P.unknown_reason, rm: by.P.removed_departures }));
check("P2: 9 removed against a baseline of 10 is under the line -- still grew", by.P2.verdict === "grew" && by.P2.removed_departures === 9);
check("P3: precedence -- too_small before pool_replaced", by.P3.unknown_reason === "too_small");
check("C: baseline 5 is too_small even at +80%", by.C.verdict === "unknown" && by.C.unknown_reason === "too_small" && near(by.C.rate, 0.8));
check("D: first snapshot ten days before the baseline is too_new", by.D.verdict === "unknown" && by.D.unknown_reason === "too_new" && by.D.tenure_days === 10);
check("D2: tenure exactly 21 passes (grew)", by.D2.verdict === "grew" && by.D2.tenure_days === 21);
check("E: a missing interior day is series_gap, never a shorter window", by.E.verdict === "unknown" && by.E.unknown_reason === "series_gap" && by.E.days_observed === 7 && by.E.days_expected === 8);
check("E2: a missing baseline endpoint is series_gap with baseline_served NULL", by.E2.verdict === "unknown" && by.E2.unknown_reason === "series_gap" && by.E2.baseline_served === null);
check("F: no ledger row at all is not_in_ledger", by.F.verdict === "unknown" && by.F.unknown_reason === "not_in_ledger" && by.F.board_days_ok === 0);
check("G: eight ok days of nine is ledger_gap", by.G.verdict === "unknown" && by.G.unknown_reason === "ledger_gap" && by.G.board_days_ok === 8 && by.G.board_days_bad === 0);
check("H: one 'error' day is failed_read", by.H.verdict === "unknown" && by.H.unknown_reason === "failed_read" && by.H.board_days_bad === 1);
check("K: 'dark' is not ok -> failed_read", by.K.unknown_reason === "failed_read");
check("K2: 'empty' is not ok -> failed_read", by.K2.unknown_reason === "failed_read");
check("I: showcase_excluded -> excluded", by.I.verdict === "unknown" && by.I.unknown_reason === "excluded");
check("J: first snapshot at the table floor is censored, tenure a floor of 53, and it still grew", by.J.tenure_censored === true && by.J.tenure_days === 53 && by.J.verdict === "grew", JSON.stringify({ t: by.J.tenure_days, c: by.J.tenure_censored, v: by.J.verdict }));
check("L: a fall after our own dedupe is no-growth with untracked_departures 8 -- never a verdict of shrinking", by.L.verdict === "no-growth" && by.L.net === -8 && by.L.untracked_departures === 8);
check("M: precedence -- excluded before windowed/failed", by.M.unknown_reason === "excluded");
check("N: precedence -- too_small before windowed_read", by.N.unknown_reason === "too_small");
check("ZZ: never snapshotted -> unknown / no_series, with the window dates still returned", by.ZZ.verdict === "unknown" && by.ZZ.unknown_reason === "no_series" && iso(by.ZZ.latest_day) === today.d0 && by.ZZ.first_snapshot_day === null);
check("no verdict outside the three", rows.every((r) => ["grew", "no-growth", "unknown"].includes(r.verdict)));
check("unknown always carries a reason; the other two never do", rows.every((r) => (r.verdict === "unknown") === (r.unknown_reason !== null)));

// ── the bars the page mirrors are the ones in the k CTE ─────────────────────
const k = sql.match(/k AS \(\s*SELECT\s+(\d+)\s+AS window_days,\s+(\d+)\s+AS min_baseline_served,\s+(\d+)\s+AS min_net_add,\s+([\d.]+)::numeric\s+AS min_rate,\s+(\d+)\s+AS min_tenure_days/);
check("the k CTE is parseable by the guard's regex", !!k && k[1] === "7" && k[2] === "10" && k[3] === "4" && k[4] === "0.25" && k[5] === "21", k ? k.slice(1).join("/") : "no match");

// ── TEETH 1: the NULL trap. Bucket read quality on IS DISTINCT FROM 'truncated'
//    and the board with no ledger row at all sails through. ─────────────────
const okLine = "count(bs.observed_on) FILTER (WHERE bs.state = k.read_state_ok)::int             AS board_days_ok,";
check("the mutant fixture differs from the shipped text by exactly the ok bucket", sql.split(okLine).length === 2);
// The trap's shape: "every day that is not truncated is ok". A day with no
// ledger row is NULL, NULL IS DISTINCT FROM 'truncated' is true, so the
// never-visited board counts nine ok days. (The not_in_ledger arm is removed
// with it, as a draft that bucketed this way would never have written one.)
const mutant = sql
  .replace(okLine, "(max(w.ledger_days_expected) - count(bs.observed_on) FILTER (WHERE NOT (bs.state IS DISTINCT FROM 'truncated')))::int AS board_days_ok,")
  .replace("WHEN c.board_days_any = 0                                      THEN 'not_in_ledger'\n", "");
await db.exec(mutant);
const mF = (await db.query(`SELECT verdict, unknown_reason, board_days_ok FROM public.get_company_growth(ARRAY['F'])`)).rows[0];
check("MUTANT admits the never-visited board F as a reading (the trap the header names)", mF.verdict !== "unknown" && mF.board_days_ok === 9, JSON.stringify(mF));
// ── TEETH 3: the ledger read over the snapshot days only. The shape the first
//    draft shipped: `BETWEEN w.baseline_day AND w.latest_day` with eight rows
//    expected. Board CAP -- cursor-walked through D-8, whole from D-7 -- then
//    publishes +333%. ──────────────────────────────────────────────────────
const ledgerLine = "AND bs.observed_on BETWEEN w.baseline_day - 1 AND w.latest_day";
check("the ledger mutant differs from the shipped text by exactly the join bound", sql.split(ledgerLine).length === 2 && sql.split("k.window_days + 2                             AS ledger_days_expected").length === 2);
const mutant2 = sql
  .replace(ledgerLine, "AND bs.observed_on BETWEEN w.baseline_day AND w.latest_day")
  .replace("k.window_days + 2                             AS ledger_days_expected", "k.window_days + 1                             AS ledger_days_expected");
await db.exec(mutant2);
const mCAP = (await db.query(`SELECT verdict, unknown_reason, net, rate FROM public.get_company_growth(ARRAY['CAP'])`)).rows[0];
check("MUTANT (ledger over the snapshot days only) publishes CAP's cursor walk as grew +333%", mCAP.verdict === "grew" && near(mCAP.rate, 3.3333), JSON.stringify(mCAP));
await db.exec(sql);
const sCAP = (await db.query(`SELECT verdict, unknown_reason FROM public.get_company_growth(ARRAY['CAP'])`)).rows[0];
check("shipped text refuses CAP again", sCAP.verdict === "unknown" && sCAP.unknown_reason === "windowed_read");
await db.exec(sql);
const sF = (await db.query(`SELECT verdict, unknown_reason FROM public.get_company_growth(ARRAY['F'])`)).rows[0];
check("shipped text refuses F again", sF.verdict === "unknown" && sF.unknown_reason === "not_in_ledger");

// ── TEETH 2: a stale series refuses everything, by name ──────────────────────
await db.exec(`DELETE FROM public.job_board_company_snapshots WHERE snapshot_date > current_date - 2`);
const stale = (await db.query(`SELECT company_token, verdict, unknown_reason FROM public.get_company_growth(ARRAY['A','J','ZZ'])`)).rows;
check("series two days stale: every token answers unknown / series_stale", stale.every((r) => r.verdict === "unknown" && r.unknown_reason === "series_stale"), JSON.stringify(stale));

// ── catalogue ────────────────────────────────────────────────────────────────
const n = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_company_growth'`)).rows[0].n;
check("get_company_growth: exactly one signature", n === 1, `${n}`);
const g = (await db.query(`SELECT has_function_privilege('anon', 'public.get_company_growth(text[])', 'EXECUTE') anon, has_function_privilege('service_role', 'public.get_company_growth(text[])', 'EXECUTE') svc`)).rows[0];
check("anon and service_role may EXECUTE (deliberate: aggregates only)", g.anon === true && g.svc === true, JSON.stringify(g));
const t = (await db.query(`SELECT has_table_privilege('anon', 'public.job_board_company_snapshots', 'SELECT') s, has_table_privilege('anon', 'public.job_board_board_state', 'SELECT') b`)).rows[0];
check("the source tables stay closed to anon (the function is the only door)", t.s === false && t.b === false, JSON.stringify(t));
const def = (await db.query(`SELECT prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_company_growth'`)).rows[0];
check("SECURITY DEFINER", def.prosecdef === true);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
