import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { JOB_CATEGORIES } from "../../supabase/functions/_shared/board-domains";

/**
 * A PROPOSAL IS NOT A MOVE.
 *
 * The Other-bucket plan (journal wf_ae544b66-955) sorts ~26% of 172,619
 * unclassified postings by three mechanisms -- rule, employer default, embed
 * -- and its first rule is that NO PASS WRITES `category`. A classifier writes
 * a PROPOSAL into six shadow columns (20260909224000); a human audits a drawn
 * sample per key and lists the (basis, key, target) triple by hand; then
 * promote_category (20260909225500), the ONLY writer, moves the rows and
 * leaves every shadow column as it was, so revert_category (20260909226000)
 * can put them back with ONE statement and Explore can count inferred rows
 * apart from rule-filed ones.
 *
 * Every assertion here is a PROPERTY of comment-stripped code: the migration
 * that owns the columns adds all six with the declared types and writes no
 * row; the promoter's SET clause names `category` and nothing else; it
 * refuses before it moves; its bar is four named constants with the plan's
 * values; the reverter's SET clause withdraws the proposal and never touches
 * basis or key; no migration at or after the shadow stamp, and no new
 * job-board module, sets `category` anywhere else. The teeth block at the
 * foot runs the same checkers over pre-fix copies -- a promoter that clears
 * the basis, one that never refuses, one revoked only FROM PUBLIC, a reverter
 * that erases the trail, a copy whose only correct spellings live in comments
 * (the guard-literals trap: a literal in a COMMENT has failed a guard here
 * four times) -- and watches each one fire.
 */
const MIG = resolve(__dirname, "../../supabase/migrations");
const JOB_BOARD = resolve(__dirname, "../../supabase/functions/job-board");
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");

const SHADOW_STAMP = "20260909224000";
const PROMOTE_FN = "promote_category";
const REVERT_FN = "revert_category";
const LOADER_FN = "load_category_anchors";
/** The fields a promotion may move a row into: every served field, never 'other'. */
const SERVED_FIELDS = (JOB_CATEGORIES as readonly string[]).filter((c) => c !== "other");

/** SQL comments out: prose about a spelling is never the spelling. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
/** TS comments out, URLs in strings left alone. */
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");

/** The newest migration whose text carries a spelling unique to the file. */
function newestWith(needle: string | RegExp): { file: string; sql: string } {
  const hit = FILES.filter((f) => (typeof needle === "string" ? read(f).includes(needle) : needle.test(read(f)))).pop() ?? "";
  return { file: hit, sql: hit ? read(hit) : "" };
}

/** The plpgsql body of a function in comment-stripped code, and its header. */
function fnParts(code: string, fn: string): { header: string; body: string } {
  const i = code.indexOf(`FUNCTION public.${fn}(`);
  if (i < 0) return { header: "", body: "" };
  const a = code.indexOf("AS $$", i);
  const b = a < 0 ? -1 : code.indexOf("$$;", a + 5);
  if (a < 0 || b < 0) return { header: code.slice(i), body: "" };
  return { header: code.slice(i, a), body: code.slice(a + 5, b) };
}

/* ───────────────────────────── the checkers ──────────────────────────────
   Pure over comment-stripped text, so the teeth block can run them against
   pre-fix copies and watch them fire. Each returns the violations it found. */

const SHADOW_COLUMNS: Array<[string, string]> = [
  ["category_proposed", "text"],
  ["category_basis", "text"],
  ["category_key", "text"],
  ["category_confidence", "real"],
  ["category_proposed_at", "timestamptz"],
  ["category_proposed_v", "integer"],
];

function shadowViolations(code: string): string[] {
  const v: string[] = [];
  for (const [col, type] of SHADOW_COLUMNS) {
    if (!new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\s+${type}\\b`).test(code)) v.push(`column:${col}`);
  }
  if (!/CHECK \(category_basis IS NULL OR category_basis IN \('rule', 'employer', 'embed'\)\)/.test(code)) v.push("check:basis");
  if (!/CHECK \(category_proposed IS NULL OR category_basis IS NOT NULL\)/.test(code)) v.push("check:proposal-names-basis");
  if (!/CHECK \(category_key IS DISTINCT FROM 'conflict' OR category_proposed IS NULL\)/.test(code)) v.push("check:conflict-has-no-proposal");
  if (!/VALIDATE CONSTRAINT job_board_postings_category_basis_chk/.test(code)) v.push("validate");
  if (!/CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_category_shadow_idx ON public\.job_board_postings \(category_basis, category_proposed\) WHERE category = ''other''/.test(code)) v.push("partial-index");
  // A bare array: the one shape promote_category AND shadow.ts's readPromotions both read.
  if (!/'category_promotions', '\[\]'::jsonb[\s\S]*?ON CONFLICT \(k\) DO NOTHING/.test(code)) v.push("seed-empty-list");
  // The shadow writes NO row and never touches category.
  if (/UPDATE\s+public\.job_board_postings|DELETE\s+FROM\s+public\.job_board_postings|INSERT\s+INTO\s+public\.job_board_postings/.test(code)) v.push("writes-postings");
  if (/\bSET\s+category\s*=/.test(code)) v.push("sets-category");
  return v;
}

const PROMOTE_CONSTANTS: Array<[string, number]> = [
  // PROMOTE_MIN_JUDGED_PER_KEY / PROMOTE_MAX_WRONG, rule and employer keys:
  // the v9 bar of 8/8 hand-judged matches (journal guards #4, #8).
  ["c_min_judged_rule", 8],
  ["c_max_wrong_rule", 0],
  // Per embed target: 30 judged, <= 1 wrong (F2 measured 3.1% wrong on 160).
  ["c_min_judged_embed", 30],
  ["c_max_wrong_embed", 1],
];

function promoteViolations(code: string): string[] {
  const v: string[] = [];
  const { header, body } = fnParts(code, PROMOTE_FN);
  if (!header) return ["no-definition"];
  if (!/SECURITY DEFINER/.test(header)) v.push("definer");
  if (!/SET search_path = public, pg_temp/.test(header)) v.push("search_path");
  for (const [name, val] of PROMOTE_CONSTANTS) {
    if (!new RegExp(`${name}\\s+constant integer := ${val};`).test(body)) v.push(`constant:${name}`);
  }
  // The move: ONE update of postings, whose SET clause names category alone.
  const updates = [...body.matchAll(/UPDATE\s+public\.job_board_postings\s+(\w+)\s+SET\s+([\s\S]*?)\s+(?:FROM|WHERE|RETURNING)\b/g)];
  if (updates.length !== 1) v.push(`one-update:${updates.length}`);
  for (const u of updates) {
    if (!/^\s*category\s*=\s*p_target\s*$/.test(u[2])) v.push("set-only-category");
  }
  const updateAt = body.search(/UPDATE\s+public\.job_board_postings/);
  // The selection: still other, and all three shadow columns equal the triple.
  for (const w of ["p.category = 'other'", "p.category_basis = p_basis", "p.category_key = p_key", "p.category_proposed = p_target"]) {
    if (!body.includes(w)) v.push(`where:${w}`);
  }
  // Refusals come BEFORE the move.
  const unlistedAt = body.search(/RAISE EXCEPTION '[^']*not listed in job_board_meta\.category_promotions/);
  if (unlistedAt < 0 || updateAt < 0 || unlistedAt > updateAt) v.push("refuses-unlisted-before-move");
  if (!/k = 'category_promotions'/.test(body)) v.push("reads-list");
  if (body.search(/p_key = 'conflict'[\s\S]{0,80}RAISE EXCEPTION/) < 0) v.push("refuses-conflict");
  if (body.search(/p_target = 'other'[\s\S]{0,80}RAISE EXCEPTION/) < 0) v.push("refuses-target-other");
  // The target must be a SERVED field: the constant is JOB_CATEGORIES minus
  // 'other', and the refusal sits before the move.
  const targets = /c_targets\s+constant text\[\] := ARRAY\[([^\]]*)\];/.exec(body)?.[1];
  const served = targets ? [...targets.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
  if (JSON.stringify(served) !== JSON.stringify(SERVED_FIELDS)) v.push(`constant:c_targets:${served.join(",") || "missing"}`);
  const unservedAt = body.search(/p_target <> ALL \(c_targets\)[\s\S]{0,40}RAISE EXCEPTION '[^']*not a served field/);
  if (unservedAt < 0 || updateAt < 0 || unservedAt > updateAt) v.push("refuses-unserved-target-before-move");
  if (!/names no audit file/.test(body)) v.push("requires-audit");
  if (!/COALESCE\(v_entry ->> 'judged', ''\) !~/.test(body)) v.push("missing-count-is-not-null-true");
  // The list is the human's: no statement writes it.
  for (const stmt of body.split(";")) {
    if (/(INSERT\s+INTO|UPDATE)\s+public\.job_board_meta/.test(stmt) && /'category_promotions'/.test(stmt)) v.push("writes-list");
  }
  if (!/'category_promotion_log'/.test(body)) v.push("logs-count");
  if (!/REVOKE ALL ON FUNCTION public\.promote_category\(text, text, text, integer\) FROM PUBLIC, anon, authenticated;/.test(code)) v.push("revoke-by-name");
  if (!/GRANT EXECUTE ON FUNCTION public\.promote_category\(text, text, text, integer\) TO service_role;/.test(code)) v.push("grant-service-role");
  return v;
}

function revertViolations(code: string): string[] {
  const v: string[] = [];
  const { header, body } = fnParts(code, REVERT_FN);
  if (!header) return ["no-definition"];
  if (!/SECURITY DEFINER/.test(header)) v.push("definer");
  if (!/SET search_path = public, pg_temp/.test(header)) v.push("search_path");
  const updates = [...body.matchAll(/UPDATE\s+public\.job_board_postings\s+(\w+)\s+SET\s+([\s\S]*?)\s+WHERE\b/g)];
  if (updates.length !== 1) v.push(`one-statement:${updates.length}`);
  for (const u of updates) {
    const set = u[2];
    if (!/category\s*=\s*'other'/.test(set)) v.push("set:category-other");
    if (!/category_proposed\s*=\s*NULL/.test(set)) v.push("set:proposal-withdrawn");
    for (const kept of ["category_basis", "category_key", "category_confidence", "category_proposed_v"]) {
      if (new RegExp(`\\b${kept}\\s*=`).test(set)) v.push(`clears-trail:${kept}`);
    }
  }
  // Scoped by the promotion's own columns, narrowed to one target when given
  // (an embed key spans every target field; its audit and revert are per target).
  for (const w of ["p.category_basis = p_basis", "p.category_key = p_key", "p_target IS NULL OR p.category_proposed = p_target", "p.category = 'other' OR p.category IS NOT DISTINCT FROM p.category_proposed"]) {
    if (!body.includes(w)) v.push(`where:${w}`);
  }
  const updateAt = body.search(/UPDATE\s+public\.job_board_postings/);
  const listedAt = body.search(/RAISE EXCEPTION '[^']*still listed in job_board_meta\.category_promotions/);
  if (listedAt < 0 || updateAt < 0 || listedAt > updateAt) v.push("refuses-while-listed-before-move");
  if (!/p_target IS NULL OR e ->> 'target' = p_target/.test(body)) v.push("delist-check-scoped-to-target");
  for (const stmt of body.split(";")) {
    if (/(INSERT\s+INTO|UPDATE)\s+public\.job_board_meta/.test(stmt) && /'category_promotions'/.test(stmt)) v.push("writes-list");
  }
  if (!/REVOKE ALL ON FUNCTION public\.revert_category\(text, text, text\) FROM PUBLIC, anon, authenticated;/.test(code)) v.push("revoke-by-name");
  if (!/GRANT EXECUTE ON FUNCTION public\.revert_category\(text, text, text\) TO service_role;/.test(code)) v.push("grant-service-role");
  return v;
}

/**
 * The one expression that turns job_board_meta.category_promotions into the
 * list, as each reader spells it (the variable name normalised). Three readers
 * -- the promoter, the reverter, the anchor loader's de-list -- must agree, or
 * a shape one honours is invisible to another (a {promotions} wrapper the
 * promoter moved on and the loader never de-listed).
 */
function listExpression(code: string, fn: string): string {
  const { body } = fnParts(code, fn);
  const m = /v_list\s*:=\s*(CASE jsonb_typeof\([\s\S]*?END);/.exec(body);
  return m ? m[1].replace(/v_list_raw/g, "v_list").replace(/\s+/g, " ") : "";
}

/** Every statement in a migration that SETs `category` on job_board_postings. */
function categoryWriters(code: string): string[] {
  const hits: string[] = [];
  for (const m of code.matchAll(/UPDATE\s+public\.job_board_postings\b[\s\S]*?\bSET\s+([\s\S]*?)(?:\bWHERE\b|\bFROM\b|\bRETURNING\b|;|$)/g)) {
    if (/(^|,)\s*(\w+\.)?category\s*=/.test(m[1])) hits.push(m[0].slice(0, 80).replace(/\s+/g, " "));
  }
  for (const m of code.matchAll(/INSERT\s+INTO\s+public\.job_board_postings\b[\s\S]*?DO UPDATE SET\s+([\s\S]*?)(?:\bWHERE\b|;|$)/g)) {
    if (/(^|,)\s*(\w+\.)?category\s*=/.test(m[1])) hits.push(m[0].slice(0, 80).replace(/\s+/g, " "));
  }
  return hits;
}

/** Every supabase-js write in a TS module that carries a `category:` key, and every raw SET category. */
function edgeCategoryWriters(ts: string): string[] {
  const hits: string[] = [];
  for (const m of ts.matchAll(/\.(update|upsert)\(\s*\{([\s\S]*?)\}\s*[,)]/g)) {
    if (/(^|[\s,{])category\s*:/.test(m[2])) hits.push(m[0].slice(0, 80).replace(/\s+/g, " "));
  }
  for (const m of ts.matchAll(/\bSET\s+category\s*=/gi)) hits.push(ts.slice(m.index!, m.index! + 40));
  return hits;
}

/* ───────────────────────────── the live files ──────────────────────────── */
const shadow = newestWith("ADD COLUMN IF NOT EXISTS category_proposed");
const promote = newestWith(new RegExp(`FUNCTION public\\.${PROMOTE_FN}\\s*\\(`));
const revert = newestWith(new RegExp(`FUNCTION public\\.${REVERT_FN}\\s*\\(`));
const loader = newestWith(new RegExp(`FUNCTION public\\.${LOADER_FN}\\s*\\(`));

describe("the shadow migration proposes and never moves", () => {
  it("is the file at the shadow stamp", () => {
    expect(shadow.file.startsWith(SHADOW_STAMP), `expected ${SHADOW_STAMP}_..., got ${shadow.file}`).toBe(true);
  });
  it("adds the six columns, the three checks, the partial index, the empty list -- and writes no row", () => {
    expect(shadowViolations(strip(shadow.sql))).toEqual([]);
  });
});

describe("promote_category is the only writer, and reads the audit list first", () => {
  it("is defined once, after the shadow", () => {
    expect(promote.file > shadow.file, `${promote.file} must sort after ${shadow.file}`).toBe(true);
    expect(FILES.filter((f) => new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${PROMOTE_FN}\\(`).test(strip(read(f)))).length).toBe(1);
  });
  it("sets category alone, only for the listed triple, only while other; bar in constants; grants by name", () => {
    expect(promoteViolations(strip(promote.sql))).toEqual([]);
  });
});

describe("revert_category is one statement that keeps the trail", () => {
  it("is defined once, after the promoter", () => {
    expect(revert.file > promote.file).toBe(true);
    expect(FILES.filter((f) => new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${REVERT_FN}\\(`).test(strip(read(f)))).length).toBe(1);
  });
  it("one UPDATE: category -> other, proposal withdrawn, basis/key/confidence/version kept; refuses while listed", () => {
    expect(revertViolations(strip(revert.sql))).toEqual([]);
  });
});

describe("the three readers of the promotion list read the same shape", () => {
  it("promote_category, revert_category and load_category_anchors spell one list expression", () => {
    const p = listExpression(strip(promote.sql), PROMOTE_FN);
    const r = listExpression(strip(revert.sql), REVERT_FN);
    const l = listExpression(strip(loader.sql), LOADER_FN);
    expect(p, "promoter has no list expression").not.toBe("");
    expect(r).toBe(p);
    expect(l).toBe(p);
    // and the expression reads the bare array first, the two wrappers after
    expect(p).toMatch(/^CASE jsonb_typeof\(v_list\) WHEN 'array' THEN v_list ELSE COALESCE\(v_list -> 'list', v_list -> 'promotions', '\[\]'::jsonb\) END$/);
  });
  it("teeth: a loader that reads only {list} is reported", () => {
    const l = strip(loader.sql).replace("COALESCE(v_list_raw -> 'list', v_list_raw -> 'promotions', '[]'::jsonb)", "COALESCE(v_list_raw -> 'list', '[]'::jsonb)");
    expect(l).not.toBe(strip(loader.sql));
    expect(listExpression(l, LOADER_FN)).not.toBe(listExpression(strip(promote.sql), PROMOTE_FN));
  });
});

describe("nothing else sets category from the shadow", () => {
  it("no migration at or after the shadow stamp SETs job_board_postings.category except the promoter and the reverter", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (f < SHADOW_STAMP) continue;
      if (f === promote.file || f === revert.file) continue;
      for (const h of categoryWriters(strip(read(f)))) offenders.push(`${f}: ${h}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
  it("the promoter and the reverter each carry exactly one such statement", () => {
    expect(categoryWriters(fnParts(strip(promote.sql), PROMOTE_FN).body)).toHaveLength(1);
    expect(categoryWriters(fnParts(strip(revert.sql), REVERT_FN).body)).toHaveLength(1);
  });
  it("the classifier modules never write category through the client", () => {
    // categories.ts is pure today; shadow.ts and embed-classify.ts arrive with
    // the other lanes of this build and are checked the moment they exist.
    // index.ts's v9 sweep still writes category directly and is rewired in
    // phase 2 -- it is deliberately NOT in this list until that phase lands.
    for (const mod of ["categories.ts", "shadow.ts", "embed-classify.ts"]) {
      const p = resolve(JOB_BOARD, mod);
      if (!existsSync(p)) continue;
      const hits = edgeCategoryWriters(stripTs(readFileSync(p, "utf8")));
      expect(hits, `${mod} writes category: ${hits.join(" | ")}`).toEqual([]);
    }
  });
});

/* ───────────────────────────── teeth ─────────────────────────────────────
   The checkers re-run against pre-fix spellings. A guard that cannot be
   shown to fail is a guard nobody has tested. */
describe("the checkers can actually fail", () => {
  const P = strip(promote.sql);
  const R = strip(revert.sql);
  const S = strip(shadow.sql);
  const commentOut = (sql: string) => sql.split("\n").map((l) => "-- " + l).join("\n");

  it("a promoter that clears the basis in the same SET", () => {
    const bad = P.replace("SET category = p_target", "SET category = p_target, category_basis = NULL, category_key = NULL");
    expect(promoteViolations(bad)).toContain("set-only-category");
  });
  it("a promoter that never refuses an unlisted triple", () => {
    const bad = P.replace(/IF v_entry IS NULL THEN[\s\S]*?END IF;/, "");
    expect(promoteViolations(bad)).toContain("refuses-unlisted-before-move");
  });
  it("a promoter that refuses only AFTER it moved", () => {
    const m = /IF v_entry IS NULL THEN[\s\S]*?END IF;/.exec(P)![0];
    const bad = P.replace(m, "").replace("RETURN v_moved;", m + "\n  RETURN v_moved;");
    expect(promoteViolations(bad)).toContain("refuses-unlisted-before-move");
  });
  it("a promoter revoked only FROM PUBLIC", () => {
    const bad = P.replace("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC;");
    expect(promoteViolations(bad)).toContain("revoke-by-name");
  });
  it("a promoter whose bar drifted (wrong <= 1 for a rule key)", () => {
    const bad = P.replace("c_max_wrong_rule   constant integer := 0;", "c_max_wrong_rule   constant integer := 1;");
    expect(promoteViolations(bad)).toContain("constant:c_max_wrong_rule");
  });
  it("a promoter that moves rows another mechanism claimed (no basis in the WHERE)", () => {
    const bad = P.replace("AND p.category_basis = p_basis", "");
    expect(promoteViolations(bad)).toContain("where:p.category_basis = p_basis");
  });
  it("a promoter that writes the list it is supposed to read", () => {
    const bad = P.replace("RETURN v_moved;", "UPDATE public.job_board_meta SET v = '{}' WHERE k = 'category_promotions';\n  RETURN v_moved;");
    expect(promoteViolations(bad)).toContain("writes-list");
  });
  it("a promoter whose missing-count test is NULL-true (no COALESCE)", () => {
    const bad = P.replace("COALESCE(v_entry ->> 'judged', '') !~", "(v_entry ->> 'judged') !~");
    expect(promoteViolations(bad)).toContain("missing-count-is-not-null-true");
  });
  it("a promoter that would move rows into a slug the board never serves", () => {
    const noCheck = P.replace(/IF p_target <> ALL \(c_targets\) THEN[\s\S]*?END IF;/, "");
    expect(noCheck).not.toBe(P);
    expect(promoteViolations(noCheck)).toContain("refuses-unserved-target-before-move");
    const drifted = P.replace("'hospitality_retail', 'security', 'admin'", "'hospitality_retail', 'security', 'admin', 'media_entertainment'");
    expect(drifted).not.toBe(P);
    expect(promoteViolations(drifted).some((x) => x.startsWith("constant:c_targets:"))).toBe(true);
    const shrunk = P.replace("'engineering', 'data_ai', ", "'engineering', ");
    expect(promoteViolations(shrunk).some((x) => x.startsWith("constant:c_targets:"))).toBe(true);
  });
  it("a reverter that ignores the target it was given", () => {
    const bad = R.replace("AND (p_target IS NULL OR p.category_proposed = p_target)", "");
    expect(bad).not.toBe(R);
    expect(revertViolations(bad)).toContain("where:p_target IS NULL OR p.category_proposed = p_target");
    const unscoped = R.replace("AND (p_target IS NULL OR e ->> 'target' = p_target)", "");
    expect(revertViolations(unscoped)).toContain("delist-check-scoped-to-target");
  });
  it("a reverter that erases the trail", () => {
    const bad = R.replace("category_proposed = NULL,", "category_proposed = NULL,\n           category_basis = NULL, category_key = NULL,");
    const v = revertViolations(bad);
    expect(v).toContain("clears-trail:category_basis");
    expect(v).toContain("clears-trail:category_key");
  });
  it("a reverter that needs two statements", () => {
    const bad = R.replace("RETURN v_reverted;", "UPDATE public.job_board_postings p SET category_proposed = NULL WHERE p.category_key = p_key;\n  RETURN v_reverted;");
    expect(revertViolations(bad)).toContain("one-statement:2");
  });
  it("a reverter that would undo a row the v9 chain filed directly", () => {
    const bad = R.replace("AND (p.category = 'other' OR p.category IS NOT DISTINCT FROM p.category_proposed)", "");
    expect(revertViolations(bad)).toContain("where:p.category = 'other' OR p.category IS NOT DISTINCT FROM p.category_proposed");
  });
  it("a reverter that does not insist on de-listing first", () => {
    const bad = R.replace(/IF v_listed IS NOT NULL THEN[\s\S]*?END IF;/, "");
    expect(revertViolations(bad)).toContain("refuses-while-listed-before-move");
  });
  it("a shadow migration that backfills category as it goes", () => {
    const bad = S + "\nUPDATE public.job_board_postings SET category = category_proposed WHERE category_proposed IS NOT NULL;";
    const v = shadowViolations(bad);
    expect(v).toContain("writes-postings");
    expect(v).toContain("sets-category");
  });
  it("a shadow migration missing a column or a check", () => {
    expect(shadowViolations(S.replace("ADD COLUMN IF NOT EXISTS category_proposed_v  integer", ""))).toContain("column:category_proposed_v");
    expect(shadowViolations(S.replace("CHECK (category_key IS DISTINCT FROM 'conflict' OR category_proposed IS NULL)", "CHECK (true)"))).toContain("check:conflict-has-no-proposal");
  });
  it("copies whose only correct spellings live in comments fail every check", () => {
    expect(promoteViolations(strip(commentOut(promote.sql)))).toContain("no-definition");
    expect(revertViolations(strip(commentOut(revert.sql)))).toContain("no-definition");
    expect(shadowViolations(strip(commentOut(shadow.sql)))).toEqual(expect.arrayContaining(["column:category_proposed", "check:basis", "partial-index"]));
  });
  it("the cross-file writer scan fires on a later migration that sets category, and not on one that sets category_proposed", () => {
    expect(categoryWriters(strip("UPDATE public.job_board_postings p SET category = 'sales' WHERE p.id = 'x';"))).toHaveLength(1);
    expect(categoryWriters(strip("INSERT INTO public.job_board_postings (id) VALUES ('x') ON CONFLICT (id) DO UPDATE SET category = 'sales';"))).toHaveLength(1);
    expect(categoryWriters(strip("UPDATE public.job_board_postings p SET category_proposed = 'sales', category_basis = 'rule' WHERE p.category = 'other';"))).toHaveLength(0);
    expect(categoryWriters(strip("-- UPDATE public.job_board_postings SET category = 'sales';"))).toHaveLength(0);
  });
  it("the edge-module scan fires on a client write of category, and not on a proposal write or a comment", () => {
    expect(edgeCategoryWriters(stripTs(`await client.from("job_board_postings").update({ category: cat }).in("id", ids);`))).toHaveLength(1);
    expect(edgeCategoryWriters(stripTs(`await client.from("job_board_postings").update({ category_proposed: f, category_basis: "rule", category_key: term }).in("id", ids);`))).toHaveLength(0);
    expect(edgeCategoryWriters(stripTs(`// client.from("job_board_postings").update({ category: cat })\nconst x = 1;`))).toHaveLength(0);
    expect(edgeCategoryWriters(stripTs("await client.rpc('exec', { q: `UPDATE job_board_postings SET category = 'x'` });"))).toHaveLength(1);
  });
});
