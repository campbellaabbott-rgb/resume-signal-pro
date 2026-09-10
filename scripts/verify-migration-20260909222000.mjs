// Runs 20260909218000 and then 20260909222000 in pglite against the two real
// table shapes (job_board_verifications, job_board_postings, the postings
// company index) and proves, by executing the plpgsql rather than reading it:
//   * after 222000 pg_proc holds exactly ONE get_stalest_boards, identity
//     (p_limit integer, p_min_age_hours integer, p_exclude text[]); the
//     (integer, integer) shape is gone, and a two-argument call still resolves;
//   * the live shape (constructor + 59 oversize + 4 unexplained): unexcluded,
//     the 60-row window is the residents and the four are invisible; excluded,
//     the window is the four, oldest first;
//   * the exclusion is INSIDE the capped scan: 2,000 excluded stamps older than
//     five live ones (= c_scan_cap exactly, so a post-filter on the capped set
//     would return zero) and the five come back;
//   * past c_exclude_cap the array is sliced, not rejected: the tokens beyond
//     the 2,000th re-enter the window;
//   * a NULL element does not blank the window; a NULL array reads as empty;
//   * p_min_age_hours still floors, p_limit still clamps at 200;
//   * a second application is a no-op; the self-check RAISES when a second
//     signature is planted after it.
// Usage: node scripts/verify-migration-20260909222000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const PRIOR = "supabase/migrations/20260909218000_every_stale_board_is_named_and_classified.sql";
const FILE = "supabase/migrations/20260909222000_the_stale_window_fills_with_what_it_cannot_fix.sql";
const prior = readFileSync(PRIOR, "utf8");
const sql = readFileSync(FILE, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, verified_at timestamptz NOT NULL, feed_total integer);
  CREATE TABLE public.job_board_postings (id bigserial PRIMARY KEY, source text, company_token text NOT NULL, missing_since timestamptz, effective_posted timestamptz);
  CREATE INDEX job_board_postings_company_idx ON public.job_board_postings (company_token);
`;

async function fresh() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(prior);
  return db;
}
const sigs = async (db) => (await db.query(
  `SELECT pg_get_function_identity_arguments(pr.oid) AS args FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
   WHERE ns.nspname = 'public' AND pr.proname = 'get_stalest_boards' ORDER BY 1`)).rows.map((r) => r.args);
/** Seed one stamp `daysAgo` days old, with `rows` posting rows (0 = a stamp the EXISTS test drops). */
async function stamp(db, token, daysAgo, rows = 1, source = "ashby") {
  await db.query(`INSERT INTO public.job_board_verifications (company_token, verified_at, feed_total) VALUES ($1, now() - ($2::float8 * interval '1 day'), $3)`, [token, daysAgo, rows]);
  for (let i = 0; i < rows; i++) {
    await db.query(`INSERT INTO public.job_board_postings (source, company_token, missing_since, effective_posted) VALUES ($1, $2, NULL, now() - interval '1 day')`, [source, token]);
  }
}
const ask = async (db, limit, ageH, exclude) => (await db.query(
  exclude === undefined
    ? `SELECT stale_token, age_min FROM public.get_stalest_boards($1, $2)`
    : `SELECT stale_token, age_min FROM public.get_stalest_boards($1, $2, $3)`,
  exclude === undefined ? [limit, ageH] : [limit, ageH, exclude])).rows;

// 1. Signature: one before, one after, the right one, and the two-arg call still resolves.
{
  const db = await fresh();
  check("218000 leaves one (integer, integer) signature", JSON.stringify(await sigs(db)) === JSON.stringify(["p_limit integer, p_min_age_hours integer"]), JSON.stringify(await sigs(db)));
  await db.exec(sql);
  const after = await sigs(db);
  check("222000 leaves exactly ONE signature, with p_exclude text[]", JSON.stringify(after) === JSON.stringify(["p_limit integer, p_min_age_hours integer, p_exclude text[]"]), JSON.stringify(after));
  await stamp(db, "alpha", 10);
  const two = await ask(db, 20, 72);
  check("a two-argument call (the .70 bundle's) resolves through the DEFAULT", two.length === 1 && two[0].stale_token === "alpha", JSON.stringify(two));
  await db.exec(sql);
  check("a second application is a no-op (still one signature)", JSON.stringify(await sigs(db)) === JSON.stringify(after));
  // The self-check has teeth: plant a second signature and run the DO block alone.
  await db.exec(`CREATE FUNCTION public.get_stalest_boards(p_limit integer, p_min_age_hours integer) RETURNS void LANGUAGE sql AS 'SELECT 1';`);
  const doBlock = sql.slice(sql.indexOf("DO $$"), sql.indexOf("END $$;") + "END $$;".length);
  let raised = "";
  try { await db.exec(doBlock); } catch (e) { raised = String(e.message ?? e); }
  check("the self-check RAISES on a planted second signature", /2 signatures in pg_proc/.test(raised), raised.slice(0, 120));
  await db.close();
}

// 2. The live shape: 'constructor' oldest, 59 oversize, then four unexplained.
{
  const db = await fresh();
  await db.exec(sql);
  await stamp(db, "constructor", 15);
  const oversize = [];
  for (let i = 0; i < 59; i++) { oversize.push(`oversize-${i}`); await stamp(db, `oversize-${i}`, 14 - i * 0.05, 2, "lever"); }
  for (const [t, d] of [["applied", 11], ["duravermeer", 10.5], ["aloyoga", 10.2], ["feverup", 10.1]]) await stamp(db, t, d);
  await stamp(db, "zero-rows", 20, 0);      // older than everything, no rows: never returned
  await stamp(db, "too-young", 1);          // under the 72h floor
  const unexcluded = await ask(db, 60, 72, []);
  check("unexcluded, p_limit 60: the window is constructor + 59 oversize and the four are invisible",
    unexcluded.length === 60 && unexcluded[0].stale_token === "constructor" && !unexcluded.some((r) => ["applied", "duravermeer", "aloyoga", "feverup"].includes(r.stale_token)),
    `${unexcluded.length} rows, first ${unexcluded[0]?.stale_token}`);
  const excluded = await ask(db, 60, 72, ["constructor", ...oversize]);
  check("excluded (constructor ∪ oversize): the window is exactly the four unexplained, oldest first",
    JSON.stringify(excluded.map((r) => r.stale_token)) === JSON.stringify(["applied", "duravermeer", "aloyoga", "feverup"]),
    JSON.stringify(excluded.map((r) => r.stale_token)));
  check("zero-row stamps and stamps under the age floor never appear", !unexcluded.concat(excluded).some((r) => r.stale_token === "zero-rows" || r.stale_token === "too-young"));
  const withNull = await ask(db, 60, 72, ["constructor", null]);
  check("a NULL element is removed, not propagated: the window is not blanked", withNull.length === 60 && withNull[0].stale_token === "oversize-0", `${withNull.length} rows`);
  const nullArr = await ask(db, 60, 72, null);
  check("a NULL array reads as '{}'", nullArr.length === 60 && nullArr[0].stale_token === "constructor");
  const floor = await ask(db, 200, 24 * 12, []);
  check("p_min_age_hours still floors (12 days -> constructor and the oldest oversize only)", floor.every((r) => r.age_min >= 12 * 24 * 60) && floor[0].stale_token === "constructor", `${floor.length} rows`);
  await db.close();
}

// 3. INSIDE the cap: exactly c_scan_cap excluded stamps older than five live ones.
{
  const db = await fresh();
  await db.exec(sql);
  await db.exec(`
    INSERT INTO public.job_board_verifications (company_token, verified_at, feed_total)
      SELECT 'x' || g, now() - interval '30 days' + (g || ' minutes')::interval, 1 FROM generate_series(1, 2000) g;
    INSERT INTO public.job_board_postings (source, company_token, missing_since, effective_posted)
      SELECT 'ashby', 'x' || g, NULL, now() FROM generate_series(1, 2000) g;
  `);
  const live = ["live-a", "live-b", "live-c", "live-d", "live-e"];
  for (let i = 0; i < live.length; i++) await stamp(db, live[i], 20 - i);
  const ex = Array.from({ length: 2000 }, (_, i) => `x${i + 1}`);
  const before = await ask(db, 200, 72, []);
  check("unexcluded: the 2,000 residents fill the capped scan and none of the five live boards is reachable at p_limit 200",
    before.length === 200 && !before.some((r) => live.includes(r.stale_token)), `${before.length} rows`);
  const after = await ask(db, 200, 72, ex);
  check("excluded: the five come back — the arm is inside the cap (a post-filter on the capped 2,000 would return zero)",
    JSON.stringify(after.map((r) => r.stale_token)) === JSON.stringify(live), JSON.stringify(after.map((r) => r.stale_token)));
  // Past c_exclude_cap: the array is sliced. Put the ten OLDEST residents past position 2,000.
  const overflow = [...ex.slice(10), ...Array.from({ length: 10 }, (_, i) => `pad-${i}`), ...ex.slice(0, 10)]; // 2,010 long: the ten OLDEST residents sit past position 2,000
  const sliced = await ask(db, 200, 72, overflow);
  check("an exclusion list longer than c_exclude_cap (2,000) is sliced: the ten tokens past it re-enter the window, the five live boards still return",
    sliced.length === 15 && sliced.slice(0, 10).every((r) => /^x([1-9]|10)$/.test(r.stale_token)) && live.every((t) => sliced.some((r) => r.stale_token === t)),
    `${sliced.length} rows: ${sliced.map((r) => r.stale_token).join(",")}`);
  const clamp = await ask(db, 9999, 72, []);
  check("p_limit still clamps at 200", clamp.length === 200);
  await db.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
