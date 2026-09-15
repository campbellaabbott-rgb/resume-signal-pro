/**
 * AN ANCHOR SET IS FROZEN UNDER ITS VERSION.
 *
 * The embed classifier votes over data/category-anchors.json: 2,272 (title,
 * field) pairs whose leave-one-out kNN agreement (1,959 / 2,272 = 86.2%) and
 * F2 precision (141R / 5W / 14A of 160 judged draws) were measured on THAT
 * list (scratchpad/other-bucket/mechA, 2026-09-10). Every embed promotion is
 * keyed by the anchor version (category_key = 'embed_knn_v1'); the audit that
 * lets promote_category move a row was done against this neighbourhood and
 * no other. So the list must not change under a version that has an audit:
 * any edit is a NEW anchor set, which means a new EMBED_ANCHOR_VERSION
 * (shadow.ts), a new EMBED_ANCHORS_SHA256 (embed-classify.ts), a re-run of
 * scripts/category-anchors-loo.mjs, and a new pin in PINNED below -- and the
 * loader (20260909224500) de-lists every embed promotion under the old key.
 *
 * Property-over-spelling: the guard recomputes the list's hash and compares it
 * to the file's own stamp, the module's pin and this file's pin; it checks the
 * list's construction as PROPERTIES (title-only, no 'other', deduped, hashed
 * ids, sorted) rather than by re-reading the labelled rows; and it proves its
 * teeth on three mutated copies -- one anchor dropped, one title edited, the
 * version bumped without a new pin -- each of which must fail.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { JOB_CATEGORIES } from "../../supabase/functions/_shared/board-domains";
import {
  EMBED_ANCHOR_COUNT,
  EMBED_ANCHOR_VERSION,
  EMBED_ANCHORS_SHA256,
  EMBED_DIM,
  EMBED_K,
  EMBED_LOO_REFERENCE,
  EMBED_LOO_TOLERANCE,
  EMBED_MODEL,
  EMBED_NORMALIZE,
  EMBED_POOLING,
  assertAnchorStamp,
} from "../../supabase/functions/job-board/embed-classify";

const ROOT = resolve(__dirname, "../..");
const ANCHORS_PATH = resolve(ROOT, "scripts/data/category-anchors.json");
const BUILD_SCRIPT = resolve(ROOT, "scripts/build-category-anchors.mjs");

/**
 * The pin: every anchor version that has ever shipped, with the sha256 of
 * its list. A version present here has (or is getting) an audit; the list
 * under it may never change. Adding a version is the deliberate ceremony.
 */
const PINNED: Record<string, { sha256: string; n: number }> = {
  embed_knn_v1: { sha256: "e1773494f9b12ffbb8ad87ee5feb6ffdc8ea0ee60de4108c4297f7e787e38b86", n: 2272 },
};

interface Anchor { id: string; field: string; title: string }
interface AnchorsDoc {
  version: string; model: string; pooling: string; normalize: boolean; dim: number;
  labelled_rows: number; eligible_rows: number; n: number; anchors_sha256: string;
  loo: Record<string, unknown> | null; anchors: Anchor[];
}

const shaOf = (list: readonly Anchor[]) => createHash("sha256").update(JSON.stringify(list)).digest("hex");
const idOf = (a: Anchor) => createHash("sha1").update(a.title.toLowerCase() + "|" + a.field).digest("hex").slice(0, 16);
const FIELDS = new Set((JOB_CATEGORIES as readonly string[]).filter((c) => c !== "other"));

/** Every way the shipped file can be wrong, as a list of reasons (empty = frozen and sound). */
function audit(doc: AnchorsDoc): string[] {
  const out: string[] = [];
  const pin = PINNED[doc.version];
  if (!pin) out.push(`version ${doc.version} has no pin in PINNED`);
  const sha = shaOf(doc.anchors);
  if (sha !== doc.anchors_sha256) out.push("the file's anchors_sha256 is not the hash of its anchors");
  if (pin && sha !== pin.sha256) out.push(`the list under ${doc.version} hashes ${sha.slice(0, 12)}, the pin says ${pin.sha256.slice(0, 12)}`);
  if (pin && doc.anchors.length !== pin.n) out.push(`the list has ${doc.anchors.length} anchors, the pin says ${pin.n}`);
  if (doc.version === EMBED_ANCHOR_VERSION && sha !== EMBED_ANCHORS_SHA256) out.push("the module's EMBED_ANCHORS_SHA256 is not the file's hash");
  if (doc.anchors.length !== doc.n) out.push("n is not the list length");
  const seenId = new Set<string>();
  const seenPair = new Set<string>();
  let prev: Anchor | null = null;
  for (const a of doc.anchors) {
    const keys = Object.keys(a).sort().join(",");
    if (keys !== "field,id,title") { out.push(`anchor ${a.id} carries ${keys} -- an anchor is a title and a field and nothing else`); break; }
    if (a.field === "other") { out.push(`anchor ${a.id} is filed under other`); break; }
    if (!FIELDS.has(a.field)) { out.push(`anchor ${a.id} names a field the board does not serve: ${a.field}`); break; }
    if (a.title !== a.title.trim() || !a.title) { out.push(`anchor ${a.id} has an untrimmed or empty title`); break; }
    if (a.id !== idOf(a)) { out.push(`anchor ${a.id} is not the content hash of its (title, field)`); break; }
    if (seenId.has(a.id)) { out.push(`anchor id ${a.id} appears twice`); break; }
    seenId.add(a.id);
    const pair = a.title.toLowerCase() + "|" + a.field;
    if (seenPair.has(pair)) { out.push(`(${a.title}, ${a.field}) appears twice -- cloned postings would stack votes`); break; }
    seenPair.add(pair);
    if (prev && (prev.field.localeCompare(a.field) > 0 || (prev.field === a.field && prev.title.localeCompare(a.title) > 0))) { out.push("the list is not sorted by (field, title) -- the hash would depend on build order"); break; }
    prev = a;
  }
  return out;
}

const doc: AnchorsDoc = JSON.parse(readFileSync(ANCHORS_PATH, "utf8"));

describe("the shipped anchor list", () => {
  it("is the pinned list under the pinned version, and the module pins the same hash", () => {
    expect(audit(doc)).toEqual([]);
    expect(doc.version).toBe(EMBED_ANCHOR_VERSION);
    expect(doc.anchors.length).toBe(EMBED_ANCHOR_COUNT);
    expect(PINNED[EMBED_ANCHOR_VERSION].n).toBe(EMBED_ANCHOR_COUNT);
  });

  it("was built under the recipe the module and the runtime share (gte-small, mean pooling, L2, 384)", () => {
    expect([doc.model, doc.pooling, doc.normalize, doc.dim]).toEqual([EMBED_MODEL, EMBED_POOLING, EMBED_NORMALIZE, EMBED_DIM]);
    expect([EMBED_MODEL, EMBED_POOLING, EMBED_NORMALIZE, EMBED_DIM]).toEqual(["gte-small", "mean", true, 384]);
  });

  it("records its construction: 3,060 labelled rows, 2,650 title-decided, 2,272 distinct pairs", () => {
    // The 410 excluded rows are the department-decided ones (basis dept-only
    // and dept-over-<field> in labelled-basis.jsonl); a change here is a
    // different anchor set even if the hash were somehow kept.
    expect([doc.labelled_rows, doc.eligible_rows, doc.n]).toEqual([3060, 2650, 2272]);
    const labelled = JSON.parse(readFileSync(resolve(__dirname, "fixtures/other-bucket-labelled.json"), "utf8"));
    expect(labelled.length).toBe(doc.labelled_rows);
  });

  it("covers every one of the seventeen fields, none of them thinly", () => {
    const per = new Map<string, number>();
    for (const a of doc.anchors) per.set(a.field, (per.get(a.field) ?? 0) + 1);
    expect([...per.keys()].sort()).toEqual([...FIELDS].sort());
    for (const [f, n] of per) expect(n, `${f} has ${n} anchors; fewer than K would make its vote impossible`).toBeGreaterThanOrEqual(EMBED_K);
  });
});

describe("the leave-one-out stamp", () => {
  it("is present, passed, at the audited K over the audited count, within tolerance of the audited figure, over this exact list", () => {
    const loo = doc.loo as Record<string, unknown>;
    expect(loo).toBeTruthy();
    expect(loo.passed).toBe(true);
    expect(loo.k).toBe(EMBED_K);
    expect(loo.n).toBe(EMBED_ANCHOR_COUNT);
    expect(Math.abs((loo.agreement as number) - EMBED_LOO_REFERENCE)).toBeLessThanOrEqual(EMBED_LOO_TOLERANCE);
    expect(loo.agree).toBe(1959);
    expect(loo.anchors_sha256).toBe(doc.anchors_sha256);
    expect([loo.model, loo.pooling, loo.normalize]).toEqual([EMBED_MODEL, EMBED_POOLING, EMBED_NORMALIZE]);
  });

  it("is accepted by the runtime's own reader -- the same check resolveEmbed makes before scoring", () => {
    expect(() => assertAnchorStamp({ version: doc.version, n: doc.n, anchors_sha256: doc.anchors_sha256, loo: doc.loo as never })).not.toThrow();
  });

  it("pins the audited figure: 0.862 ± 0.02, k = 15", () => {
    expect(EMBED_LOO_REFERENCE).toBe(0.862);
    expect(EMBED_LOO_TOLERANCE).toBe(0.02);
    expect(EMBED_K).toBe(15);
  });
});

describe("teeth: the guard fails on every way the list can drift", () => {
  it("one anchor dropped -- the hash no longer matches the stamp, the pin or the module", () => {
    const copy: AnchorsDoc = { ...doc, anchors: doc.anchors.slice(1) };
    const reasons = audit(copy);
    expect(reasons).toContain("the file's anchors_sha256 is not the hash of its anchors");
    expect(reasons.some((r) => r.includes("the pin says"))).toBe(true);
    expect(reasons).toContain("the module's EMBED_ANCHORS_SHA256 is not the file's hash");
  });

  it("one title edited in place -- the id no longer hashes and the list no longer matches the pin", () => {
    const anchors = doc.anchors.map((a, i) => (i === 100 ? { ...a, title: a.title + " II" } : a));
    const reasons = audit({ ...doc, anchors, anchors_sha256: shaOf(anchors) });
    expect(reasons.some((r) => r.includes("the pin says"))).toBe(true);
    expect(reasons.some((r) => r.includes("not the content hash"))).toBe(true);
  });

  it("the version bumped without a new pin -- an unpinned version has no audit", () => {
    const reasons = audit({ ...doc, version: "embed_knn_v2" });
    expect(reasons).toContain("version embed_knn_v2 has no pin in PINNED");
  });

  it("a company token smuggled onto an anchor -- title-only by construction", () => {
    const anchors = doc.anchors.map((a, i) => (i === 5 ? ({ ...a, company_token: "dominos" } as unknown as Anchor) : a));
    expect(audit({ ...doc, anchors, anchors_sha256: shaOf(anchors) }).some((r) => r.includes("nothing else"))).toBe(true);
  });

  it("a duplicate (title, field) pair -- cloned postings must not stack votes", () => {
    const anchors = [...doc.anchors, { ...doc.anchors[7], id: "ffffffffffffffff" }];
    expect(audit({ ...doc, anchors, anchors_sha256: shaOf(anchors) }).some((r) => r.includes("stack votes") || r.includes("not the content hash") || r.includes("not sorted"))).toBe(true);
  });
});

/**
 * THE ANCHOR SIDE'S POSTURE, AS CI PROPERTIES. RLS on with no policy, the
 * table revoked by name, category_knn a DEFINER with a pinned search_path, a
 * bounded k, a 384-dim check and the stamped-version filter, and the table's
 * identity (version, id) so a chunked reload cannot deplete the version being
 * served. Each of these lived only in the pglite script before (the 107-of-
 * 121 definer incident and the moat's 35 anon-readable days are what a
 * property in a script nobody re-runs buys); the teeth block mutates a copy
 * per property and watches it fire. Comment-stripped: a spelling in prose is
 * not the spelling.
 */
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const migrationWith = (needle: string) => {
  const hit = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort().filter((f) => readFileSync(resolve(MIG_DIR, f), "utf8").includes(needle)).pop() ?? "";
  return hit ? readFileSync(resolve(MIG_DIR, hit), "utf8") : "";
};
const ANCHORS_SQL = migrationWith("CREATE TABLE IF NOT EXISTS public.job_board_category_anchors");
const KNN_SQL = migrationWith("FUNCTION public.category_knn(");

function anchorTableViolations(code: string): string[] {
  const v: string[] = [];
  const t = "public\\.job_board_category_anchors";
  if (!new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).test(code)) v.push("rls-on");
  if (/CREATE POLICY[^;]*job_board_category_anchors/.test(code)) v.push("has-policy");
  if (!new RegExp(`REVOKE ALL ON ${t} FROM PUBLIC, anon, authenticated;`).test(code)) v.push("table-revoke-by-name");
  if (new RegExp(`GRANT [^;]* ON ${t} TO (anon|authenticated)\\b`).test(code)) v.push("table-granted-to-anon");
  if (!/PRIMARY KEY \(version, id\)/.test(code)) v.push("identity-is-version-id");
  if (!/ON CONFLICT \(version, id\) DO UPDATE/.test(code)) v.push("upsert-by-version-id");
  if (/\bid\s+text\s+PRIMARY KEY/.test(code)) v.push("identity-is-id-alone");
  if (!/REVOKE ALL ON FUNCTION public\.load_category_anchors\([^)]*\)\s*FROM PUBLIC, anon, authenticated;/.test(code)) v.push("loader-revoke-by-name");
  return v;
}

function knnViolations(code: string): string[] {
  const v: string[] = [];
  const i = code.indexOf("FUNCTION public.category_knn(");
  if (i < 0) return ["no-definition"];
  const a = code.indexOf("AS $$", i);
  const b = code.indexOf("$$;", a + 5);
  const header = code.slice(i, a);
  const body = code.slice(a + 5, b);
  if (!/SECURITY DEFINER/.test(header)) v.push("definer");
  if (!/SET search_path = public, extensions, pg_temp/.test(header)) v.push("search_path");
  if (!/c_k_max\s+constant integer := 100;/.test(body)) v.push("k-max-constant");
  if (!/IF v_k < 1 OR v_k > c_k_max THEN/.test(body)) v.push("k-bounded");
  if (!/c_dim\s+constant integer := 384;/.test(body) || !/vector_dims\(q\) <> c_dim/.test(body)) v.push("dims-checked");
  if (!/WHERE a\.version = v_version/.test(body)) v.push("stamped-version-filter");
  if (!/IF v_version IS NULL THEN\s*RAISE EXCEPTION/.test(body)) v.push("raises-without-stamp");
  if (!/REVOKE ALL ON FUNCTION public\.category_knn\([^)]*\)\s*FROM PUBLIC, anon, authenticated;/.test(code)) v.push("revoke-by-name");
  if (/GRANT EXECUTE ON FUNCTION public\.category_knn\([^)]*\) TO (anon|authenticated)\b/.test(code)) v.push("granted-to-anon");
  return v;
}

describe("the anchor table and its reader are not public, exact, bounded and version-keyed (CI, not a script)", () => {
  it("the anchors migration: RLS on, no policy, revoked by name, keyed by (version, id)", () => {
    expect(ANCHORS_SQL, "no migration creates job_board_category_anchors").not.toBe("");
    expect(anchorTableViolations(stripSql(ANCHORS_SQL))).toEqual([]);
  });
  it("category_knn: DEFINER, search_path pinned, k in [1, 100], 384 dims, stamped-version filter, raises with no stamp, revoked by name", () => {
    expect(KNN_SQL, "no migration defines category_knn").not.toBe("");
    expect(knnViolations(stripSql(KNN_SQL))).toEqual([]);
  });
  it("teeth: each property fires on a mutated copy", () => {
    const A = stripSql(ANCHORS_SQL);
    const K = stripSql(KNN_SQL);
    expect(anchorTableViolations(A.replace("ALTER TABLE public.job_board_category_anchors ENABLE ROW LEVEL SECURITY;", ""))).toContain("rls-on");
    expect(anchorTableViolations(A.replace("REVOKE ALL ON public.job_board_category_anchors FROM PUBLIC, anon, authenticated;", "REVOKE ALL ON public.job_board_category_anchors FROM PUBLIC;"))).toContain("table-revoke-by-name");
    expect(anchorTableViolations(A + "\nGRANT SELECT ON public.job_board_category_anchors TO anon;")).toContain("table-granted-to-anon");
    expect(anchorTableViolations(A + "\nCREATE POLICY open ON public.job_board_category_anchors FOR SELECT TO anon USING (true);")).toContain("has-policy");
    const idAlone = A.replace("PRIMARY KEY (version, id)", "").replace("id         text NOT NULL,", "id         text PRIMARY KEY,").replace("ON CONFLICT (version, id) DO UPDATE", "ON CONFLICT (id) DO UPDATE");
    expect(anchorTableViolations(idAlone)).toEqual(expect.arrayContaining(["identity-is-version-id", "upsert-by-version-id", "identity-is-id-alone"]));
    expect(knnViolations(K.replace("IF v_k < 1 OR v_k > c_k_max THEN", "IF false THEN"))).toContain("k-bounded");
    expect(knnViolations(K.replace("WHERE a.version = v_version", ""))).toContain("stamped-version-filter");
    expect(knnViolations(K.replace("SET search_path = public, extensions, pg_temp", ""))).toContain("search_path");
    expect(knnViolations(K.replace("SECURITY DEFINER", ""))).toContain("definer");
    expect(knnViolations(K.replace("REVOKE ALL ON FUNCTION public.category_knn(extensions.vector, integer) FROM PUBLIC, anon, authenticated;", "REVOKE ALL ON FUNCTION public.category_knn(extensions.vector, integer) FROM PUBLIC;"))).toContain("revoke-by-name");
    expect(knnViolations(K + "\nGRANT EXECUTE ON FUNCTION public.category_knn(extensions.vector, integer) TO anon;")).toContain("granted-to-anon");
    // a copy whose only correct spellings live in comments
    expect(knnViolations(stripSql(KNN_SQL.split("\n").map((l) => "-- " + l).join("\n")))).toEqual(["no-definition"]);
    expect(anchorTableViolations(stripSql(ANCHORS_SQL.split("\n").map((l) => "-- " + l).join("\n")))).toContain("rls-on");
  });
});

describe("the builder never reads a company or a department", () => {
  it("scripts/build-category-anchors.mjs's code touches title, slug and basis only", () => {
    const src = readFileSync(BUILD_SCRIPT, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).not.toMatch(/\bcompany\b|company_token|\bdepartment\b/);
    expect(src).toMatch(/r\.title/);
    expect(src).toMatch(/r\.slug/);
  });
});
