// Runs 20260909224000 (the shadow columns), 20260909224500 (the anchor table
// and its loader), 20260909225000 (category_knn), 20260909225500
// (promote_category) and 20260909226000 (revert_category) in pglite with
// pgvector loaded into an `extensions` schema, as production has it, and
// proves:
//   * the anchor table is RLS-on with no policy, anon and authenticated can
//     neither read nor write it, service_role can; the vector column carries
//     NO index and the migration refuses one;
//   * category_knn RAISES with no stamp rather than answering empty;
//   * the loader refuses a malformed version, a non-array payload, a row filed
//     under 'other', a 383-dim vector, a non-numeric vector, a row carrying a
//     company token or department, and a LOO stamp whose n is not the rows
//     loaded -- and the table is still empty after every refusal;
//   * a chunked load (p_final false, then true) stamps job_board_meta.
//     category_anchor_version with {version, n, anchors_sha256, loo,
//     previous_version} and drops every other version's rows;
//   * category_knn's answers equal a plain JavaScript cosine over the same
//     vectors, row for row and in order, for twenty random queries; k and
//     dimension bounds raise;
//   * TEETH: a category_knn copy without the version filter serves a stale
//     row planted under another version; the shipped text does not;
//   * a reload under a NEW version de-lists every embed-basis promotion whose
//     key is not the new version, leaves rule/employer entries alone, logs the
//     removal, and promote_category then refuses the old embed triple it had
//     just honoured; TEETH: a loader copy without the de-list block leaves the
//     stale embed promotion listed;
//   * the schema's conflict rule holds for an embed proposal (no proposal on a
//     'conflict' row) and an embed proposal never touches `category`;
//   * with CATEGORY_ANCHOR_VECTORS=<file from category-anchors-loo.mjs
//     --vectors>, the real 2,272 anchors load in chunks, computeLooStamp
//     passes on them, assertAnchorStamp accepts what the loader stored, and
//     the leave-one-out vote computed THROUGH category_knn equals the module's
//     own vote on every sampled anchor (FULL_LOO=1 runs all 2,272 and
//     reports 1,959 agreements); resolveEmbed runs end to end on those rows;
//   * anon and authenticated cannot execute either function; one signature
//     each in pg_proc.
// Usage: node scripts/verify-migration-20260909224500.mjs   (from the repo root)
//        CATEGORY_ANCHOR_VECTORS=/path/vectors.json [FULL_LOO=1] node scripts/verify-migration-20260909224500.mjs
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const mod = await import(pathToFileURL(resolve("supabase/functions/job-board/embed-classify.ts")).href);
const { EMBED_K, EMBED_ANCHOR_VERSION, EMBED_ANCHOR_COUNT, EMBED_ANCHORS_SHA256, EMBED_LOO_REFERENCE, computeLooStamp, assertAnchorStamp, readAnchorStamp, resolveEmbed, scoreKnn, buildCentroids, centroidTop1, dot } = mod;

const db = new PGlite({ extensions: { vector } });
const mig = (f) => readFileSync(`supabase/migrations/${f}`, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};
const SHADOW = "20260909224000_a_proposal_is_not_a_move.sql";
const ANCHORS = "20260909224500_an_anchor_is_a_title_and_a_field_and_nothing_else.sql";
const KNN = "20260909225000_the_neighbours_are_exact_and_the_reader_is_not_public.sql";
const PROMOTE = "20260909225500_the_only_hand_that_moves_a_row_reads_the_audit_list_first.sql";
const REVERT = "20260909226000_one_statement_puts_the_row_back.sql";

async function refused(sql, params) {
  try { await db.query(sql, params); return ""; } catch (e) { return String(e?.message ?? e) + (e?.hint ? "  HINT: " + e.hint : ""); }
}
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];
const vec = (v) => "[" + v.join(",") + "]";
const setList = async (list) => db.query(`UPDATE public.job_board_meta SET v = $1::jsonb WHERE k = 'category_promotions'`, [JSON.stringify({ list })]);
const getList = async () => (await one(`SELECT v -> 'list' AS l FROM public.job_board_meta WHERE k = 'category_promotions'`)).l;

// ── seeded synthetic anchors: six fields, each a random direction plus noise ─
let seed = 20260914;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const unit = (v) => { const n = Math.sqrt(dot(v, v)) || 1; return v.map((x) => +(x / n).toFixed(6)); };
const randVec = () => unit(Array.from({ length: 384 }, gauss));
const FIELDS = ["engineering", "finance", "healthcare", "operations", "customer", "hospitality_retail"];
const centres = Object.fromEntries(FIELDS.map((f) => [f, randVec()]));
const synth = [];
for (let i = 0; i < 300; i++) {
  const field = FIELDS[i % FIELDS.length];
  const c = centres[field];
  const noise = Array.from({ length: 384 }, gauss);
  synth.push({ id: `syn${String(i).padStart(4, "0")}`, field, title: `${field} title ${i}`, embedding: unit(c.map((x, j) => x * 3 + noise[j] * 0.5)) });
}
const jsKnn = (q, set, k) => set.map((a) => ({ id: a.id, field: a.field, title: a.title, sim: dot(q, a.embedding) })).sort((a, b) => b.sim - a.sim || (a.id < b.id ? -1 : 1)).slice(0, k);

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA extensions;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, title text,
    category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz
  );
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO public.job_board_postings (id, company_token, title, category) VALUES
    ('r1', 'acme', 'Financial Analyst', 'other'),
    ('r2', 'acme', 'Software Engineer', 'engineering'),
    ('r3', 'acme', 'Something', 'other');
`);
await db.exec(mig(SHADOW));
await db.exec(mig(ANCHORS));
await db.exec(mig(KNN));
await db.exec(mig(PROMOTE));
await db.exec(mig(REVERT));
console.log("all five migrations applied in order");

// ── the table ────────────────────────────────────────────────────────────────
const rel = await one(`SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c WHERE c.relname = 'job_board_category_anchors'`);
check("anchor table: RLS on, zero policies", rel && rel.rls === true && rel.policies === 0, JSON.stringify(rel));
const tp = await one(`SELECT has_table_privilege('anon', 'public.job_board_category_anchors', 'SELECT') a_sel, has_table_privilege('anon', 'public.job_board_category_anchors', 'INSERT') a_ins,
  has_table_privilege('authenticated', 'public.job_board_category_anchors', 'SELECT') u_sel, has_table_privilege('service_role', 'public.job_board_category_anchors', 'SELECT') s_sel, has_table_privilege('service_role', 'public.job_board_category_anchors', 'INSERT') s_ins`);
check("anchor table: anon/authenticated cannot read or write, service_role can", tp.a_sel === false && tp.a_ins === false && tp.u_sel === false && tp.s_sel === true && tp.s_ins === true, JSON.stringify(tp));
const embIdx = await one(`SELECT count(*)::int n FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey) WHERE t.relname = 'job_board_category_anchors' AND a.attname = 'embedding'`);
check("no index on the vector column (exact scan is the contract)", embIdx.n === 0, `${embIdx.n}`);
const pk = await one(`SELECT array_agg(a.attname ORDER BY k.ord)::text[] AS cols FROM pg_constraint c JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum WHERE c.conrelid = 'public.job_board_category_anchors'::regclass AND c.contype = 'p'`);
check("identity is (version, id): two versions of one title may coexist", JSON.stringify(pk.cols) === JSON.stringify(["version", "id"]), JSON.stringify(pk.cols));
const colTypes = await rows(`SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = 'job_board_category_anchors' ORDER BY ordinal_position`);
check("columns: id, version, field, title, embedding(vector), loaded_at -- no company, department or posting id",
  JSON.stringify(colTypes.map((c) => c.column_name)) === JSON.stringify(["id", "version", "field", "title", "embedding", "loaded_at"]) && colTypes.find((c) => c.column_name === "embedding").udt_name === "vector", JSON.stringify(colTypes));
// The migration's own refusal of a vector index, exercised: build one, re-run the DO block, expect the raise, drop it.
await db.exec(`CREATE INDEX tmp_ann ON public.job_board_category_anchors USING hnsw (embedding extensions.vector_cosine_ops)`);
const doBlock = mig(ANCHORS).match(/DO \$\$\nDECLARE v_idx text;[\s\S]*?END \$\$;/)[0];
check("the migration refuses to proceed over an ANN index on embedding", (await refused(doBlock)).includes("EXACT scan"));
await db.exec(`DROP INDEX public.tmp_ann`);

// ── no stamp: raise, not empty ───────────────────────────────────────────────
check("category_knn with no stamp RAISES", (await refused(`SELECT * FROM public.category_knn($1::extensions.vector(384), 15)`, [vec(synth[0].embedding)])).includes("no anchor set is stamped"));

// ── loader refusals, table still empty after each ───────────────────────────
const load = (version, list, loo = null, sha = null, final = true) =>
  db.query(`SELECT public.load_category_anchors($1, $2::jsonb, $3::jsonb, $4, $5) AS n`, [version, JSON.stringify(list), loo === null ? null : JSON.stringify(loo), sha, final]);
const loadRefused = async (label, needle, ...args) => {
  const msg = await refused(`SELECT public.load_category_anchors($1, $2::jsonb, $3::jsonb, $4, $5)`, [args[0], JSON.stringify(args[1]), args[2] === null || args[2] === undefined ? null : JSON.stringify(args[2]), args[3] ?? null, args[4] ?? true]);
  const empty = (await one(`SELECT count(*)::int n FROM public.job_board_category_anchors`)).n === 0;
  check(`loader refuses ${label} (table still empty)`, msg.includes(needle) && empty, msg.slice(0, 120));
};
await loadRefused("a malformed version", "lower-case identifier", "Embed KNN v1", synth.slice(0, 5));
await loadRefused("a non-array payload", "JSON array", "embed_knn_v1", { rows: [] });
await loadRefused("a row filed under other", "never an anchor", "embed_knn_v1", [{ ...synth[0], field: "other" }]);
await loadRefused("a 383-dim vector", "384 dims", "embed_knn_v1", [{ ...synth[0], embedding: synth[0].embedding.slice(0, 383) }]);
await loadRefused("a non-numeric vector", "non-number", "embed_knn_v1", [{ ...synth[0], embedding: [...synth[0].embedding.slice(0, 383), "x"] }]);
await loadRefused("a row carrying a company token", "no company or department", "embed_knn_v1", [{ ...synth[0], company_token: "dominos" }]);
await loadRefused("a row carrying a department", "no company or department", "embed_knn_v1", [{ ...synth[0], department: "Finance" }]);
await loadRefused("a row with an empty title", "missing title", "embed_knn_v1", [{ ...synth[0], title: "  " }]);
await loadRefused("a final call with nothing loaded", "nothing to stamp", "embed_knn_v1", []);
await loadRefused("a LOO stamp whose n is not the rows loaded", "different set", "embed_knn_v1", synth.slice(0, 10), { agreement: 0.9, n: 2272, k: 15, passed: true });
await db.exec(`DELETE FROM public.job_board_category_anchors`);

// ── a chunked load under embed_knn_v1 ────────────────────────────────────────
const c1 = (await load("embed_knn_v1", synth.slice(0, 120), null, null, false)).rows[0].n;
check("chunk 1 (p_final false) returns rows so far and stamps nothing", c1 === 120 && (await one(`SELECT count(*)::int n FROM public.job_board_meta WHERE k = 'category_anchor_version'`)).n === 0, `${c1}`);
check("category_knn still raises between chunks", (await refused(`SELECT * FROM public.category_knn($1::extensions.vector(384), 15)`, [vec(synth[0].embedding)])).includes("no anchor set is stamped"));
const synthLoo = { agreement: 0.99, agree: 297, n: 300, k: 15, passed: false, note: "synthetic" };
const c2 = (await load("embed_knn_v1", synth.slice(120), synthLoo, "deadbeef", true)).rows[0].n;
const stamp1 = (await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_anchor_version'`)).v;
check("chunk 2 (p_final true) returns the full count and stamps {version, n, anchors_sha256, loo, previous_version=null}",
  c2 === 300 && stamp1.version === "embed_knn_v1" && stamp1.n === 300 && stamp1.anchors_sha256 === "deadbeef" && stamp1.loo.n === 300 && stamp1.loo.passed === false && stamp1.previous_version === null && typeof stamp1.loaded_at === "string", JSON.stringify(stamp1).slice(0, 200));
check("readAnchorStamp parses what the loader wrote", (() => { const s = readAnchorStamp(stamp1); return s && s.version === "embed_knn_v1" && s.n === 300 && s.loo && s.loo.passed === false; })());
check("resolveEmbed REFUSES this set (LOO not passed / not the audited count)", (() => { try { resolveEmbed(jsKnn(synth[0].embedding, synth, 15), "engineering", readAnchorStamp(stamp1)); return false; } catch (e) { return e.name === "AnchorStampError"; } })());
const held = (await one(`SELECT count(*)::int n, count(DISTINCT version)::int vs FROM public.job_board_category_anchors`));
check("table holds exactly the 300 rows under one version", held.n === 300 && held.vs === 1, JSON.stringify(held));
const upserted = (await load("embed_knn_v1", [{ ...synth[7], title: "renamed" }], synthLoo, "deadbeef", true)).rows[0].n;
check("re-sending an id upserts (no duplicate, title updated)", upserted === 300 && (await one(`SELECT title FROM public.job_board_category_anchors WHERE id = $1`, [synth[7].id])).title === "renamed");
await load("embed_knn_v1", [synth[7]], synthLoo, "deadbeef", true);

// ── a NEW version's chunk in flight must not deplete the version being served ─
// Anchor ids are content hashes with no version in them, so a v2 chunk re-sends
// v1's ids; with PRIMARY KEY (id) the upsert re-homed them and category_knn
// answered from a shrinking set under an intact stamp (measured: 20 -> 8).
const mid = (await load("embed_knn_v2", synth.slice(0, 120), null, null, false)).rows[0].n;
const midCounts = await one(`SELECT count(*) FILTER (WHERE version = 'embed_knn_v1')::int v1, count(*) FILTER (WHERE version = 'embed_knn_v2')::int v2 FROM public.job_board_category_anchors`);
const midStamp = (await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_anchor_version'`)).v;
const midKnn = await rows(`SELECT id FROM public.category_knn($1::extensions.vector(384), 15)`, [vec(synth[0].embedding)]);
check("a v2 chunk of 120 overlapping ids (p_final false) leaves all 300 v1 rows in place: v1 300 / v2 120, stamp still v1, category_knn still answers 15",
  mid === 120 && midCounts.v1 === 300 && midCounts.v2 === 120 && midStamp.version === "embed_knn_v1" && midStamp.n === 300 && midKnn.length === 15, JSON.stringify({ mid, midCounts, stamp: midStamp.version, knn: midKnn.length }));
// TEETH: the pre-fix identity (id alone) re-homes the shared ids out of v1.
const anchorsSqlForPk = mig(ANCHORS);
const pkLine = "  PRIMARY KEY (version, id)\n";
check("the draft fixture differs from the shipped table by exactly the identity", anchorsSqlForPk.split(pkLine).length === 2 && anchorsSqlForPk.includes("ON CONFLICT (version, id) DO UPDATE"));
await db.exec(`DROP TABLE public.job_board_category_anchors`);
await db.exec(anchorsSqlForPk.replace(pkLine, "").replace("DEFAULT now(),\n", "DEFAULT now()\n").replace("id         text NOT NULL,", "id         text PRIMARY KEY,").replace("ON CONFLICT (version, id) DO UPDATE\n     SET field = EXCLUDED.field,", "ON CONFLICT (id) DO UPDATE\n     SET version = EXCLUDED.version, field = EXCLUDED.field,"));
await load("embed_knn_v1", synth, synthLoo, "deadbeef", true);
await load("embed_knn_v2", synth.slice(0, 120), null, null, false);
const draftCounts = await one(`SELECT count(*) FILTER (WHERE version = 'embed_knn_v1')::int v1, count(*) FILTER (WHERE version = 'embed_knn_v2')::int v2 FROM public.job_board_category_anchors`);
check("DRAFT (PRIMARY KEY id): the same chunk strips 120 rows out of the stamped v1 while the stamp still says 300", draftCounts.v1 === 180 && draftCounts.v2 === 120 && (await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_anchor_version'`)).v.n === 300, JSON.stringify(draftCounts));
// restore the shipped table and the v1 scene
await db.exec(`DROP TABLE public.job_board_category_anchors`);
await db.exec(anchorsSqlForPk);
await load("embed_knn_v1", synth, synthLoo, "deadbeef", true);
check("shipped table restored: 300 rows under v1, stamp v1", (await one(`SELECT count(*)::int n FROM public.job_board_category_anchors WHERE version = 'embed_knn_v1'`)).n === 300 && (await one(`SELECT count(*)::int n FROM public.job_board_category_anchors`)).n === 300);

// ── exactness against JavaScript ─────────────────────────────────────────────
let exact = true, worst = 0;
for (let t = 0; t < 20; t++) {
  const q = t < 10 ? synth[Math.floor(rnd() * synth.length)].embedding : randVec();
  const sql = await rows(`SELECT id, field, title, sim FROM public.category_knn($1::extensions.vector(384), $2)`, [vec(q), 15]);
  const js = jsKnn(q, synth, 15);
  if (sql.length !== 15) { exact = false; continue; }
  for (let i = 0; i < 15; i++) {
    const d = Math.abs(sql[i].sim - js[i].sim); worst = Math.max(worst, d);
    // same ordered neighbourhood; an exact tie may legitimately swap ids, so compare by sim-then-id where sims differ
    if (sql[i].id !== js[i].id && Math.abs(js[i].sim - (js.find((r) => r.id === sql[i].id)?.sim ?? -2)) > 1e-6) exact = false;
    if (d > 1e-5) exact = false;
  }
}
check("category_knn == JavaScript exact cosine, row for row, twenty queries", exact, `worst |Δsim| ${worst.toExponential(2)}`);
const kDefault = await rows(`SELECT * FROM public.category_knn($1::extensions.vector(384))`, [vec(synth[0].embedding)]);
check("k defaults to 15 and the nearest of an anchor's own vector is itself at sim ~1", kDefault.length === 15 && kDefault[0].id === synth[0].id && Math.abs(kDefault[0].sim - 1) < 1e-5, `${kDefault[0]?.id} ${kDefault[0]?.sim}`);
check("k = 0 raises", (await refused(`SELECT * FROM public.category_knn($1::extensions.vector(384), 0)`, [vec(synth[0].embedding)])).includes("between 1 and 100"));
check("k = 101 raises", (await refused(`SELECT * FROM public.category_knn($1::extensions.vector(384), 101)`, [vec(synth[0].embedding)])).includes("between 1 and 100"));
check("a 383-dim query raises", (await refused(`SELECT * FROM public.category_knn($1::extensions.vector, 15)`, [vec(synth[0].embedding.slice(0, 383))])).length > 0);
check("a NULL query raises", (await refused(`SELECT * FROM public.category_knn(NULL::extensions.vector(384), 15)`)).includes("q is required"));

// ── TEETH: the version filter ────────────────────────────────────────────────
await db.query(`INSERT INTO public.job_board_category_anchors (id, version, field, title, embedding) VALUES ('stale', 'stale_v0', 'legal', 'stale anchor', $1::extensions.vector(384))`, [vec(synth[0].embedding)]);
const shippedTop = await one(`SELECT id FROM public.category_knn($1::extensions.vector(384), 1)`, [vec(synth[0].embedding)]);
check("shipped category_knn ignores a row planted under another version", shippedTop.id === synth[0].id, shippedTop.id);
const knnSql = mig(KNN);
const filterLine = "     WHERE a.version = v_version\n";
check("the draft fixture differs from the shipped text by exactly the version filter", knnSql.split(filterLine).length === 2);
await db.exec(knnSql.replace(filterLine, ""));
const draftRows = await rows(`SELECT id FROM public.category_knn($1::extensions.vector(384), 2)`, [vec(synth[0].embedding)]);
check("DRAFT without the filter serves the stale row (sim 1 ties with the real anchor)", draftRows.some((r) => r.id === "stale"), JSON.stringify(draftRows));
await db.exec(knnSql);
await db.exec(`DELETE FROM public.job_board_category_anchors WHERE id = 'stale'`);

// ── an embed proposal, the conflict rule, and promotion under the key ───────
await db.exec(`UPDATE public.job_board_postings SET category_proposed = 'finance', category_basis = 'embed', category_key = 'embed_knn_v1', category_confidence = 0.71, category_proposed_at = now(), category_proposed_v = 1 WHERE id = 'r1'`);
check("an embed proposal is written to the shadow columns and `category` is still other", (await one(`SELECT category FROM public.job_board_postings WHERE id = 'r1'`)).category === "other");
check("no proposal may sit on a conflict row (schema CHECK)", (await refused(`UPDATE public.job_board_postings SET category_proposed = 'finance', category_basis = 'embed', category_key = 'conflict' WHERE id = 'r3'`)).length > 0);
await setList([
  { basis: "embed", key: "embed_knn_v1", target: "finance", audit: "embed-embed_knn_v1.md", judged: "30", wrong: "1" },
  { basis: "rule", key: "commis", target: "hospitality_retail", audit: "rule-commis.md", judged: "8", wrong: "0" },
  { basis: "employer", key: "dominos", target: "hospitality_retail", audit: "employer-dominos.md", judged: "40", wrong: "0" },
]);
const moved = (await one(`SELECT public.promote_category('embed', 'embed_knn_v1', 'finance') AS n`)).n;
check("promote_category honours the listed embed triple (moves r1)", moved === 1 && (await one(`SELECT category, category_basis, category_key FROM public.job_board_postings WHERE id = 'r1'`)).category === "finance");
await db.exec(`UPDATE public.job_board_postings SET category = 'other' WHERE id = 'r1'`); // put it back for the reset scene

// ── a reload under a NEW version resets embed promotions ────────────────────
const c3 = (await load("embed_knn_v2", synth.slice(0, 200), { agreement: 0.98, n: 200, k: 15, passed: false }, "cafe", true)).rows[0].n;
const stamp2 = (await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_anchor_version'`)).v;
const listAfter = await getList();
const logAfter = (await one(`SELECT v -> 'entries' AS e FROM public.job_board_meta WHERE k = 'category_promotion_log'`)).e;
const reloadEntry = (logAfter ?? []).find((e) => e.event === "anchor_reload");
check("v2 load: 200 rows, v1 rows gone, stamp names previous_version embed_knn_v1", c3 === 200 && (await one(`SELECT count(*)::int n FROM public.job_board_category_anchors WHERE version <> 'embed_knn_v2'`)).n === 0 && stamp2.version === "embed_knn_v2" && stamp2.previous_version === "embed_knn_v1", JSON.stringify(stamp2).slice(0, 160));
check("the embed entry under the old key is de-listed; rule and employer entries stay", listAfter.length === 2 && listAfter.every((e) => e.basis !== "embed") && listAfter[0].key === "commis" && listAfter[1].key === "dominos", JSON.stringify(listAfter));
check("the removal is logged with what was removed", reloadEntry && reloadEntry.from === "embed_knn_v1" && reloadEntry.to === "embed_knn_v2" && reloadEntry.delisted.length === 1 && reloadEntry.delisted[0].key === "embed_knn_v1", JSON.stringify(reloadEntry));
check("promote_category now refuses the embed triple it honoured a moment ago", (await refused(`SELECT public.promote_category('embed', 'embed_knn_v1', 'finance')`)).includes("not listed") && (await one(`SELECT category FROM public.job_board_postings WHERE id = 'r1'`)).category === "other");
const c4 = (await load("embed_knn_v2", [synth[0]], { agreement: 0.98, n: 200, k: 15, passed: false }, "cafe", true)).rows[0].n;
check("a reload under the SAME version touches neither the list nor the log", c4 === 200 && (await getList()).length === 2 && (await one(`SELECT jsonb_array_length(v -> 'entries')::int n FROM public.job_board_meta WHERE k = 'category_promotion_log'`)).n === (logAfter ?? []).length);
// TEETH: the loader without the de-list block
await setList([{ basis: "embed", key: "embed_knn_v2", target: "finance", audit: "x.md", judged: "30", wrong: "0" }, { basis: "rule", key: "commis", target: "hospitality_retail", audit: "rule-commis.md", judged: "8", wrong: "0" }]);
const anchorsSql = mig(ANCHORS);
const delistStart = anchorsSql.indexOf("  IF v_old_ver IS DISTINCT FROM p_version THEN");
const delistEnd = anchorsSql.indexOf("  RETURN v_n;\nEND;");
check("the draft fixture is the shipped loader minus the de-list block", delistStart > 0 && delistEnd > delistStart);
await db.exec(anchorsSql.slice(0, delistStart) + anchorsSql.slice(delistEnd));
await load("embed_knn_v3", synth.slice(0, 50), { agreement: 0.9, n: 50, k: 15, passed: false }, null, true);
check("DRAFT loader: the embed_knn_v2 promotion survives a v3 reload (the leak the de-list closes)", (await getList()).some((e) => e.basis === "embed" && e.key === "embed_knn_v2"));
await db.exec(anchorsSql);
await load("embed_knn_v4", synth.slice(0, 50), { agreement: 0.9, n: 50, k: 15, passed: false }, null, true);
check("shipped loader: the same reload de-lists it", !(await getList()).some((e) => e.basis === "embed") && (await getList()).length === 1);
// The {promotions} wrapper: the promoter honours it, so the de-list must see it too, and keep the wrapper.
await db.query(`UPDATE public.job_board_meta SET v = $1::jsonb WHERE k = 'category_promotions'`, [JSON.stringify({ promotions: [{ basis: "embed", key: "embed_knn_v4", target: "finance", audit: "x.md", judged: "30", wrong: "0" }, { basis: "rule", key: "commis", target: "hospitality_retail", audit: "rule-commis.md", judged: "8", wrong: "0" }], note: "kept" })]);
await load("embed_knn_v5", synth.slice(0, 50), { agreement: 0.9, n: 50, k: 15, passed: false }, null, true);
const wrapped = (await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_promotions'`)).v;
check("a {promotions: [...]} list is de-listed too, and the wrapper (with its other keys) is preserved", Array.isArray(wrapped.promotions) && wrapped.promotions.length === 1 && wrapped.promotions[0].key === "commis" && wrapped.note === "kept" && !("list" in wrapped), JSON.stringify(wrapped));
await setList([]);

// ── the real anchors, when the vectors are on disk ───────────────────────────
const VEC = process.env.CATEGORY_ANCHOR_VECTORS;
if (VEC) {
  const file = JSON.parse(readFileSync(VEC, "utf8"));
  const real = file.rows;
  check(`real vectors: ${real.length} rows under ${file.version}, sha ${String(file.anchors_sha256).slice(0, 12)}…`, real.length === EMBED_ANCHOR_COUNT && file.version === EMBED_ANCHOR_VERSION && file.anchors_sha256 === EMBED_ANCHORS_SHA256);
  const t0 = Date.now();
  const stamp = computeLooStamp(real, file.anchors_sha256);
  check(`computeLooStamp on the real vectors passes: ${stamp.agree}/${stamp.n} = ${stamp.agreement} (expected ${EMBED_LOO_REFERENCE})`, stamp.passed === true && stamp.agree === 1959, `${Date.now() - t0} ms`);
  const CH = 400;
  for (let i = 0; i < real.length; i += CH) {
    const last = i + CH >= real.length;
    await load(EMBED_ANCHOR_VERSION, real.slice(i, i + CH), last ? stamp : null, file.anchors_sha256, last);
  }
  const realStamp = readAnchorStamp((await one(`SELECT v FROM public.job_board_meta WHERE k = 'category_anchor_version'`)).v);
  let accepted = true; try { assertAnchorStamp(realStamp); } catch (e) { accepted = false; console.log("  ", e.message); }
  check("assertAnchorStamp accepts the stamp the loader stored for the real set", accepted && realStamp.n === EMBED_ANCHOR_COUNT);
  check("the table holds exactly the audited count under the audited version", (await one(`SELECT count(*)::int n FROM public.job_board_category_anchors WHERE version = $1`, [EMBED_ANCHOR_VERSION])).n === EMBED_ANCHOR_COUNT);
  // LOO through SQL: for each sampled anchor, k+1 neighbours, drop self, the module's vote — must equal the module's vote over JS-computed neighbours.
  const full = process.env.FULL_LOO === "1";
  const idxs = full ? real.map((_, i) => i) : Array.from({ length: 300 }, () => Math.floor(rnd() * real.length));
  let same = 0, agreeSql = 0, agreeJs = 0;
  const t1 = Date.now();
  for (const i of idxs) {
    const q = real[i].embedding;
    const sql = (await rows(`SELECT id, field, title, sim FROM public.category_knn($1::extensions.vector(384), $2)`, [vec(q), EMBED_K + 1])).filter((r) => r.id !== real[i].id).slice(0, EMBED_K);
    const js = jsKnn(q, real.filter((_, j) => j !== i), EMBED_K);
    const a = scoreKnn(sql, EMBED_K), b = scoreKnn(js, EMBED_K);
    if (a.top1 === b.top1 && Math.abs(a.share1 - b.share1) < 1e-4 && Math.abs(a.nn1 - b.nn1) < 1e-5) same++;
    if (a.top1 === real[i].field) agreeSql++;
    if (b.top1 === real[i].field) agreeJs++;
  }
  check(`LOO through category_knn equals the module's vote on every sampled anchor (${idxs.length} anchors, ${Date.now() - t1} ms)`, same === idxs.length, `${same}/${idxs.length}; SQL agreement ${agreeSql}/${idxs.length}, JS ${agreeJs}/${idxs.length}`);
  if (full) check("FULL LOO through SQL reproduces 1,959 / 2,272", agreeSql === 1959, `${agreeSql}`);
  // end to end: the neighbourhood of a real anchor (excluding itself) through the F2 gate
  const centroids = buildCentroids(real);
  let proposals = 0, nulls = 0, barred = 0;
  for (const i of idxs.slice(0, 60)) {
    const q = real[i].embedding;
    const sql = (await rows(`SELECT id, field, title, sim FROM public.category_knn($1::extensions.vector(384), $2)`, [vec(q), EMBED_K + 1])).filter((r) => r.id !== real[i].id).slice(0, EMBED_K);
    const c = centroidTop1(q, centroids);
    const p = resolveEmbed(sql, c?.field ?? null, realStamp);
    if (p) { proposals++; if (["product", "design", "legal", "data_ai"].includes(p.field)) barred++; if (p.basis !== "embed" || p.key !== EMBED_ANCHOR_VERSION || typeof p.confidence !== "number") { proposals = -999; } } else nulls++;
  }
  check(`resolveEmbed end to end over category_knn rows: ${proposals} proposals, ${nulls} withheld, 0 barred targets`, proposals > 0 && barred === 0 && proposals + nulls === 60);
} else {
  console.log("SKIP  real-vector section (set CATEGORY_ANCHOR_VECTORS=<file from scripts/category-anchors-loo.mjs --vectors>)");
}

// ── catalogue: grants, one signature each ────────────────────────────────────
const g = await rows(`SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') anon, has_function_privilege('authenticated', oid, 'EXECUTE') auth, has_function_privilege('service_role', oid, 'EXECUTE') svc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('category_knn','load_category_anchors') ORDER BY 1`);
check("category_knn and load_category_anchors: anon and authenticated cannot execute, service_role can", g.length === 2 && g.every((r) => !r.anon && !r.auth && r.svc), JSON.stringify(g));
for (const fn of ["category_knn", "load_category_anchors"]) {
  const n = (await one(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1`, [fn])).n;
  check(`${fn}: exactly one signature`, n === 1, `${n}`);
}
const sd = await rows(`SELECT proname, prosecdef, provolatile FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('category_knn','load_category_anchors') ORDER BY 1`);
check("both SECURITY DEFINER; category_knn STABLE", sd.every((r) => r.prosecdef) && sd.find((r) => r.proname === "category_knn").provolatile === "s", JSON.stringify(sd));
check("no posting's `category` was written by anything but promote_category", JSON.stringify(await rows(`SELECT id, category FROM public.job_board_postings ORDER BY id`)) === JSON.stringify([{ id: "r1", category: "other" }, { id: "r2", category: "engineering" }, { id: "r3", category: "other" }]));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
