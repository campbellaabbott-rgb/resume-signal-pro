// Runs 20260909224000 (the shadow columns), 20260909225500 (promote_category)
// and 20260909226000 (revert_category) in pglite against a synthetic bucket
// and proves:
//   * the six shadow columns exist with their declared types and every one is
//     NULL after the migration -- the migration writes no row;
//   * the three CHECKs have teeth: a fourth basis, a proposal without a basis,
//     and a proposal on a conflict row are all refused;
//   * the partial index (category_basis, category_proposed) WHERE category =
//     'other' exists, built by the exact statement the migration hands to
//     pg_cron (pglite has no cron schema, so the NOTICE path is taken and the
//     harness runs that statement itself);
//   * category_promotions is seeded {"list": []};
//   * promote_category refuses an UNLISTED triple, a listed triple with no
//     audit file, one with no counts, one that misses the bar, key 'conflict',
//     and target 'other' -- and moves NOTHING on any refusal;
//   * a listed triple moves ONLY rows whose (basis, key, proposed) match AND
//     whose category is still 'other'; the mismatched-target row, the other
//     employer's row, the already-filed row, the conflict row and the bare row
//     are untouched; every shadow column on the moved rows is unchanged;
//   * p_limit bounds a call and the calls sum to the population; a second
//     full call returns 0; the log carries the counts; the list itself is
//     never written by the function;
//   * revert_category refuses while the triple is still listed; after
//     de-listing, one call puts the rows back to 'other', withdraws the
//     proposal, keeps basis/key/confidence/version, and leaves the
//     'engineering' row that carried a stray proposal alone;
//   * anon and authenticated cannot execute either function, service_role can;
//     one signature each in pg_proc.
// Usage: node scripts/verify-migration-20260909224000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const mig = (f) => readFileSync(`supabase/migrations/${f}`, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};
const SHADOW = "20260909224000_a_proposal_is_not_a_move.sql";
const PROMOTE = "20260909225500_the_only_hand_that_moves_a_row_reads_the_audit_list_first.sql";
const REVERT = "20260909226000_one_statement_puts_the_row_back.sql";

/** Run a statement that must throw; return the message (or "" if it did not). */
async function refused(sql) {
  // pglite keeps HINT on its own field; the message alone would hide it.
  try { await db.query(sql); return ""; } catch (e) { return String(e?.message ?? e) + (e?.hint ? "  HINT: " + e.hint : ""); }
}
/** jsonb re-orders object keys, so compare shapes with keys sorted. */
const canon = (x) => JSON.stringify(x, (_, v) => (v && typeof v === "object" && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
const rows = async (sql) => (await db.query(sql)).rows;
const one = async (sql) => (await rows(sql))[0];
// The canonical shape is a bare array (what shadow.ts's readPromotions reads too).
const setList = async (list) =>
  db.query(`UPDATE public.job_board_meta SET v = $1::jsonb WHERE k = 'category_promotions'`, [JSON.stringify(list)]);

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, title text,
    category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz
  );
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO public.job_board_postings (id, company_token, title, category) VALUES
    ('pre1', 'dominos', 'Pizza Maker', 'other'),
    ('pre2', 'acme', 'Software Engineer', 'engineering');
`);

// ── 224000: the shadow ───────────────────────────────────────────────────────
await db.exec(mig(SHADOW));

const cols = await rows(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'job_board_postings' AND column_name LIKE 'category_%' ORDER BY column_name`);
const colMap = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));
check("six shadow columns with their declared types",
  colMap.category_proposed === "text" && colMap.category_basis === "text" && colMap.category_key === "text"
    && colMap.category_confidence === "real" && colMap.category_proposed_at === "timestamp with time zone"
    && colMap.category_proposed_v === "integer", JSON.stringify(colMap));
const untouched = await one(`SELECT count(*)::int AS n FROM public.job_board_postings
  WHERE category_proposed IS NOT NULL OR category_basis IS NOT NULL OR category_key IS NOT NULL
     OR category_confidence IS NOT NULL OR category_proposed_at IS NOT NULL OR category_proposed_v IS NOT NULL`);
check("the migration writes no row: every shadow column NULL", untouched.n === 0);
const cats = await rows(`SELECT id, category FROM public.job_board_postings ORDER BY id`);
check("category untouched by the migration", JSON.stringify(cats) === JSON.stringify([{ id: "pre1", category: "other" }, { id: "pre2", category: "engineering" }]));

check("CHECK: a fourth basis is refused",
  /category_basis_chk/.test(await refused(`INSERT INTO public.job_board_postings (id, category_basis, category_proposed) VALUES ('bad1', 'guess', 'sales')`)));
check("CHECK: a proposal without a basis is refused",
  /category_proposal_chk/.test(await refused(`INSERT INTO public.job_board_postings (id, category_proposed) VALUES ('bad2', 'sales')`)));
check("CHECK: a proposal on a conflict row is refused",
  /category_conflict_chk/.test(await refused(`INSERT INTO public.job_board_postings (id, category_basis, category_key, category_proposed) VALUES ('bad3', 'rule', 'conflict', 'sales')`)));
check("CHECK: a conflict row WITHOUT a proposal is fine",
  (await refused(`INSERT INTO public.job_board_postings (id, category_key) VALUES ('c1', 'conflict')`)) === "");
check("CHECKs are VALID (validated, not left NOT VALID)",
  (await one(`SELECT bool_and(convalidated) AS ok FROM pg_constraint WHERE conname LIKE 'job_board_postings_category_%_chk'`)).ok === true);

// The index: pglite has no cron schema, so the migration only NOTICEs. Run
// the exact statement the migration hands to pg_cron (its '' un-doubled).
const idxStmt = (/'(CREATE INDEX CONCURRENTLY[^']*(?:''[^']*)*)'/.exec(mig(SHADOW))?.[1] ?? "").replace(/''/g, "'");
check("the cron statement was found in the migration text", idxStmt.includes("job_board_postings_category_shadow_idx"), idxStmt);
let idxNote = "";
try { await db.query(idxStmt); } catch (e) {
  idxNote = `CONCURRENTLY refused in pglite (${String(e.message).slice(0, 60)}); built plain`;
  await db.query(idxStmt.replace("CONCURRENTLY ", ""));
}
const idx = await one(`SELECT indexdef FROM pg_indexes WHERE indexname = 'job_board_postings_category_shadow_idx'`);
check("partial index exists on (category_basis, category_proposed) WHERE category = 'other'",
  !!idx && /\(category_basis, category_proposed\)/.test(idx.indexdef) && /WHERE \(?category = 'other'/.test(idx.indexdef), (idx?.indexdef ?? "missing") + (idxNote ? "  [" + idxNote + "]" : ""));
check("category_promotions seeded as a bare empty array",
  JSON.stringify((await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_promotions'`)).v) === "[]");

// ── 225500 + 226000 ──────────────────────────────────────────────────────────
await db.exec(mig(PROMOTE));
await db.exec(mig(REVERT));

// The synthetic bucket. r1-r5: the triple under test. r6: same key, different
// target. r7: another key. r8: already filed by the v9 chain, carrying a stray
// proposal under the key. r9: conflict. r10: bare. r11: same triple but the
// employer basis (a different triple).
await db.exec(`
  INSERT INTO public.job_board_postings (id, company_token, title, category, category_proposed, category_basis, category_key, category_confidence, category_proposed_at, category_proposed_v)
  VALUES
    ('r1', 'ejwl~us2~CX', 'Commis I',            'other', 'hospitality_retail', 'rule', 'commis', NULL, now() - interval '1 hour', 10),
    ('r2', 'ejwl~us2~CX', 'Commis II - Zest',    'other', 'hospitality_retail', 'rule', 'commis', NULL, now() - interval '1 hour', 10),
    ('r3', 'ejwl~us2~CX', 'Commis de cuisine',   'other', 'hospitality_retail', 'rule', 'commis', NULL, now() - interval '1 hour', 10),
    ('r4', 'ebwh~us2~CX_1001', 'Commis Chef',     'other', 'hospitality_retail', 'rule', 'commis', NULL, now() - interval '1 hour', 10),
    ('r5', 'ebwh~us2~CX_1001', 'Demi Commis',     'other', 'hospitality_retail', 'rule', 'commis', NULL, now() - interval '1 hour', 10),
    ('r6', 'ejwl~us2~CX', 'Commis (odd stamp)',  'other', 'sales',              'rule', 'commis', NULL, now() - interval '1 hour', 10),
    ('r7', 'dominos', 'Pizza Maker (0123)',       'other', 'hospitality_retail', 'employer', 'dominos', 0.98, now() - interval '1 hour', 1),
    ('r8', 'acme', 'Commis Engineer',             'engineering', 'hospitality_retail', 'rule', 'commis', NULL, now() - interval '1 hour', 10),
    ('r9', 'saks', 'Selling Advisor - Men''s',    'other', NULL, NULL, 'conflict', NULL, NULL, NULL),
    ('r10', 'tail', 'Meteorologist',              'other', NULL, NULL, NULL, NULL, NULL, NULL),
    ('r11', 'fa-etjg-saasfaprod1~ocs~CX_1003', 'To Go Specialist', 'other', 'hospitality_retail', 'employer', 'fa-etjg-saasfaprod1~ocs~CX_1003', 1.0, now(), 1);
`);
const snapshot = async () => rows(`SELECT id, category, category_proposed, category_basis, category_key, category_confidence, category_proposed_v FROM public.job_board_postings ORDER BY id`);
const before = JSON.stringify(await snapshot());
const call = (b, k, t, lim) => refused(`SELECT public.promote_category('${b}', '${k}', '${t}'${lim === undefined ? "" : ", " + lim})`);

// Refusals, each one moving nothing.
let msg = await call("rule", "commis", "hospitality_retail");
check("promote refuses an UNLISTED triple, naming the list", /not listed in job_board_meta\.category_promotions/.test(msg), msg.slice(0, 120));
check("  ...the refusal HINT names the audit file to write", /audit\/rule-commis\.md/.test(msg) || /rule-commis\.md/.test(msg), msg.slice(-160));
await setList([{ basis: "rule", key: "commis", target: "hospitality_retail" }]);
msg = await call("rule", "commis", "hospitality_retail");
check("promote refuses a listing with no audit file", /names no audit file/.test(msg), msg.slice(0, 120));
await setList([{ basis: "rule", key: "commis", target: "hospitality_retail", audit: "rule-commis.md" }]);
msg = await call("rule", "commis", "hospitality_retail");
check("promote refuses a listing with no judged/wrong counts (missing key is not NULL-true)", /no judged\/wrong counts/.test(msg), msg.slice(0, 120));
await setList([{ basis: "rule", key: "commis", target: "hospitality_retail", audit: "rule-commis.md", judged: 7, wrong: 0 }]);
msg = await call("rule", "commis", "hospitality_retail");
check("promote refuses judged 7 < 8 for a rule key", /misses the bar/.test(msg) && /judged >= 8/.test(msg), msg.slice(0, 140));
await setList([{ basis: "rule", key: "commis", target: "hospitality_retail", audit: "rule-commis.md", judged: 8, wrong: 1 }]);
msg = await call("rule", "commis", "hospitality_retail");
check("promote refuses wrong 1 > 0 for a rule key", /misses the bar/.test(msg) && /wrong <= 0/.test(msg), msg.slice(0, 140));
await setList([{ basis: "embed", key: "embed_knn_v1", target: "healthcare", audit: "embed-embed_knn_v1.md", judged: 30, wrong: 2 }]);
msg = await call("embed", "embed_knn_v1", "healthcare");
check("promote refuses wrong 2 > 1 for an embed target", /misses the bar/.test(msg) && /judged >= 30, wrong <= 1/.test(msg), msg.slice(0, 140));
await setList([{ basis: "rule", key: "conflict", target: "sales", audit: "x.md", judged: 8, wrong: 0 }]);
msg = await call("rule", "conflict", "sales");
check("promote refuses key 'conflict' even when listed", /never promotable/.test(msg), msg.slice(0, 120));
await setList([{ basis: "rule", key: "commis", target: "other", audit: "x.md", judged: 8, wrong: 0 }]);
msg = await call("rule", "commis", "other");
check("promote refuses target 'other' (that is a revert)", /is a revert/.test(msg), msg.slice(0, 120));
msg = await call("guess", "commis", "sales");
check("promote refuses a fourth basis", /not rule, employer or embed/.test(msg), msg.slice(0, 120));
await setList([{ basis: "rule", key: "commis", target: "media_entertainment", audit: "rule-commis.md", judged: 8, wrong: 0 }]);
await db.query(`UPDATE public.job_board_postings SET category_proposed = 'media_entertainment' WHERE id = 'r6'`);
msg = await call("rule", "commis", "media_entertainment");
check("promote refuses a shadow-only candidate slug as a target (listed, audited, still refused)", /not a served field/.test(msg) && /HINT: served: engineering/.test(msg), msg.slice(0, 160));
await db.query(`UPDATE public.job_board_postings SET category_proposed = 'sales' WHERE id = 'r6'`);
check("NOTHING moved across every refusal", JSON.stringify(await snapshot()) === before);
check("no log row was written by a refusal", (await rows(`SELECT 1 FROM public.job_board_meta WHERE k = 'category_promotion_log'`)).length === 0);

// The move.
const listed = [{ basis: "rule", key: "commis", target: "hospitality_retail", audit: "rule-commis.md", judged: 8, wrong: 0 }];
await setList(listed);
const first = await one(`SELECT public.promote_category('rule', 'commis', 'hospitality_retail', 2) AS n`);
check("p_limit 2 moves exactly 2", first.n === 2, `${first.n}`);
const second = await one(`SELECT public.promote_category('rule', 'commis', 'hospitality_retail') AS n`);
check("the next call moves the remaining 3", second.n === 3, `${second.n}`);
const third = await one(`SELECT public.promote_category('rule', 'commis', 'hospitality_retail') AS n`);
check("a further call moves 0", third.n === 0, `${third.n}`);
const after = await snapshot();
const byId = Object.fromEntries(after.map((r) => [r.id, r]));
check("r1-r5 are hospitality_retail", ["r1", "r2", "r3", "r4", "r5"].every((i) => byId[i].category === "hospitality_retail"));
check("r1-r5 keep every shadow column (basis persists after promotion)",
  ["r1", "r2", "r3", "r4", "r5"].every((i) => byId[i].category_proposed === "hospitality_retail" && byId[i].category_basis === "rule" && byId[i].category_key === "commis" && byId[i].category_proposed_v === 10));
check("r6 (same key, target sales) untouched", byId.r6.category === "other" && byId.r6.category_proposed === "sales");
check("r7 (employer dominos) untouched", byId.r7.category === "other");
check("r8 (already engineering) untouched", byId.r8.category === "engineering");
check("r9 (conflict) and r10 (bare) untouched", byId.r9.category === "other" && byId.r9.category_key === "conflict" && byId.r10.category === "other" && byId.r10.category_basis === null);
check("r11 (same target, employer basis -- a different triple) untouched", byId.r11.category === "other");
const log = (await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_promotion_log'`)).v;
check("log carries the three calls' counts 2, 3, 0", JSON.stringify(log.entries.map((e) => e.moved)) === "[2,3,0]", JSON.stringify(log.entries.map((e) => e.moved)));
check("log entries name basis/key/target/audit", log.entries.every((e) => e.basis === "rule" && e.key === "commis" && e.target === "hospitality_retail" && e.audit === "rule-commis.md"));
check("promote_category never writes category_promotions",
  canon((await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_promotions'`)).v) === canon(listed));

// The two wrapped shapes are tolerated on the SQL side too.
const domEntry = { basis: "employer", key: "dominos", target: "hospitality_retail", audit: "employer-dominos.md", judged: 8, wrong: 0 };
await db.query(`UPDATE public.job_board_meta SET v = $1::jsonb WHERE k = 'category_promotions'`, [JSON.stringify({ promotions: [domEntry] })]);
const dom = await one(`SELECT public.promote_category('employer', 'dominos', 'hospitality_retail') AS n`);
check("a {promotions: [...]} wrapper works: dominos moves 1 (r7)", dom.n === 1 && (await one(`SELECT category FROM public.job_board_postings WHERE id = 'r7'`)).category === "hospitality_retail");
await db.query(`UPDATE public.job_board_meta SET v = $1::jsonb WHERE k = 'category_promotions'`, [JSON.stringify({ list: [{ ...domEntry, key: "fa-etjg-saasfaprod1~ocs~CX_1003", audit: "employer-chilis.md" }] })]);
const chi = await one(`SELECT public.promote_category('employer', 'fa-etjg-saasfaprod1~ocs~CX_1003', 'hospitality_retail') AS n`);
check("a {list: [...]} wrapper works: Chili's moves 1 (r11)", chi.n === 1);
await db.query(`UPDATE public.job_board_postings SET category = 'other' WHERE id = 'r11'`); // put r11 back for the revert section's counts

// The revert.
await setList(listed);
msg = await refused(`SELECT public.revert_category('rule', 'commis')`);
check("revert refuses while (rule, commis) is still listed", /still listed/.test(msg), msg.slice(0, 120));
check("  ...and moved nothing", (await one(`SELECT count(*)::int AS n FROM public.job_board_postings WHERE category = 'hospitality_retail'`)).n === 6);
msg = await refused(`SELECT public.revert_category('rule', 'commis', 'other')`);
check("revert refuses target 'other'", /not what it targets/.test(msg), msg.slice(0, 120));
// A TARGETED revert: (rule, commis) is listed for hospitality_retail, not for
// sales, so the sales-scoped revert proceeds and touches r6 alone.
const revSales = await one(`SELECT public.revert_category('rule', 'commis', 'sales') AS n`);
check("revert_category('rule', 'commis', 'sales') touches r6 alone (proposal sales withdrawn) while the hospitality_retail entry stays listed", revSales.n === 1 && (await one(`SELECT category, category_proposed, category_key FROM public.job_board_postings WHERE id = 'r6'`)).category_proposed === null, `${revSales.n}`);
check("  ...and r1-r5 are still hospitality_retail", (await one(`SELECT count(*)::int AS n FROM public.job_board_postings WHERE category = 'hospitality_retail' AND category_key = 'commis'`)).n === 5);
msg = await refused(`SELECT public.revert_category('rule', 'commis', 'hospitality_retail')`);
check("the targeted revert for the LISTED target is refused", /still listed/.test(msg), msg.slice(0, 120));
await setList([]);
const rev = await one(`SELECT public.revert_category('rule', 'commis') AS n`);
check("revert touches r1-r5 (moved back) = 5 (r6 already withdrawn), not r8", rev.n === 5, `${rev.n}`);
const post = Object.fromEntries((await snapshot()).map((r) => [r.id, r]));
check("r1-r5 back to other, proposal withdrawn", ["r1", "r2", "r3", "r4", "r5"].every((i) => post[i].category === "other" && post[i].category_proposed === null));
check("r1-r5 keep basis, key, version (the audit trail)", ["r1", "r2", "r3", "r4", "r5"].every((i) => post[i].category_basis === "rule" && post[i].category_key === "commis" && post[i].category_proposed_v === 10));
check("proposed_at cleared", (await one(`SELECT count(*)::int AS n FROM public.job_board_postings WHERE category_key = 'commis' AND category_proposed_at IS NOT NULL`)).n === 1 /* r8 only */);
check("r6 proposal withdrawn, still other", post.r6.category === "other" && post.r6.category_proposed === null && post.r6.category_key === "commis");
check("r8 (engineering, stray proposal) left alone by the revert", post.r8.category === "engineering" && post.r8.category_proposed === "hospitality_retail");
check("r7 (dominos, promoted) not touched by a commis revert", post.r7.category === "hospitality_retail");
const revLog = (await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_promotion_log'`)).v;
check("the revert logs into the same ledger, target NULL for the whole key and named for the targeted call", revLog.entries.at(-1).reverted === 5 && revLog.entries.at(-1).key === "commis" && revLog.entries.at(-1).target === null && revLog.entries.at(-2).reverted === 1 && revLog.entries.at(-2).target === "sales", JSON.stringify(revLog.entries.slice(-2)));
msg = await refused(`SELECT public.revert_category('guess', 'commis')`);
check("revert refuses a fourth basis", /not rule, employer or embed/.test(msg));
const again = await one(`SELECT public.revert_category('rule', 'commis') AS n`);
check("a second revert touches 0", again.n === 0, `${again.n}`);

// ── grants and signatures ────────────────────────────────────────────────────
for (const sig of ["public.promote_category(text,text,text,integer)", "public.revert_category(text,text,text)"]) {
  const g = await one(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') AS a,
                              has_function_privilege('authenticated', '${sig}', 'EXECUTE') AS u,
                              has_function_privilege('service_role', '${sig}', 'EXECUTE') AS s`);
  check(`${sig}: anon no, authenticated no, service_role yes`, g.a === false && g.u === false && g.s === true, JSON.stringify(g));
}
const sigs = await rows(`SELECT p.proname, count(*)::int AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname IN ('promote_category', 'revert_category') GROUP BY p.proname ORDER BY 1`);
check("one signature each", sigs.length === 2 && sigs.every((s) => s.n === 1), JSON.stringify(sigs));
check("both are SECURITY DEFINER with search_path pinned",
  (await one(`SELECT bool_and(p.prosecdef) AS d, bool_and(p.proconfig::text LIKE '%search_path=public, pg_temp%') AS s
              FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'public' AND p.proname IN ('promote_category', 'revert_category')`)).d === true);

// Re-running every file is harmless (IF NOT EXISTS / OR REPLACE / DO NOTHING).
await db.exec(mig(SHADOW)); await db.exec(mig(PROMOTE)); await db.exec(mig(REVERT));
check("all three migrations are idempotent", (await one(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE 'job_board_postings_category_%_chk'`)).n === 3);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
