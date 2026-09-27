// @vitest-environment node
/**
 * A FUNNEL STAGE IS NOT A REPEAT OF THE LANDING.
 *
 * WHAT THIS GUARDS. track_ab_event_optimized is the only writer to
 * ab_test_events, and it refuses an event it has already seen within a window
 * (24 hours for a view, 90 days for anything else). The key it used to decide
 * "already seen" named the test, the visitor and the event type -- and not the
 * variant. The conversion funnel is one test name whose STAGES travel in the
 * variant column, and every stage but the purchase is a view. So after a
 * visitor's landing was recorded, every later stage they reached was answered
 * as a duplicate and never inserted; the edge function reports success either
 * way. Measured live 2026-09-27 (anon RPC get_funnel_cohort_stats, 30 days):
 * 136,064 landing visitors, zero at every later stage, against 26 completed
 * scans in the same window.
 *
 * THE PROPERTY, NOT THE SPELLING. The live definition of a function is the
 * LAST migration that defines it. This file finds every terminated definition
 * of the writer, takes the newest, parses the duplicate check's predicate into
 * its conjuncts and asserts that each column of an event's identity -- the
 * test, the variant, the visitor, the type -- is bound there to the very same
 * expression the INSERT writes into that column. The expected right-hand side
 * is READ FROM THE INSERT, not pinned as a parameter name; a definition that
 * renamed its parameters consistently would still pass, and one that bound
 * `variant` to something other than what it stores would not.
 *
 * NOTHING ELSE MOVED, AT THE STEP THAT ADDED THE KEY. The definition that
 * introduced the whole key -- the DEDUP STEP -- is found by that property, not
 * by its place in the list: the first definition, by stamp, whose duplicate
 * check binds every identity column. The definition before it is re-read from
 * its own migration and compared: same parameter list (so PostgREST keeps
 * resolving the edge function's named-argument call, and no second overload
 * appears -- the 2025-12-24 history of this function is exactly that
 * accident), identical text outside the predicate once comments and
 * whitespace are gone, and a conjunct set that differs by exactly the one
 * binding the step exists to add.
 *
 * AND NO LATER REWRITE UNDID IT. The function has been redefined since (the
 * window fix of 20260927202451 moves one statement of the rate-limit step and
 * nothing else -- its own guard sits in the budget test). Every definition from
 * the dedup step to the live one must still bind the whole key and keep the
 * same parameter list, and every file that redefines a locked-down function
 * must restate the lockdown.
 *
 * TEETH. The definition before the dedup step must FAIL the check, by exactly
 * the `variant` column. A copy of the live definition with that conjunct
 * removed must fail it too. And a real Postgres (pglite) is booted twice, once
 * with only the pre-step writer and once with the whole chain from the step
 * onward applied on top: under the old writer a visitor's second stage is
 * refused and the table holds one row; under the live one two events that
 * differ only in variant are both stored, the same event twice is stored once,
 * both windows still hold, the rate limit still bites, and anon can no longer
 * execute the function.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";

// PGLITE BOOTS A POSTGRES AND REPLAYS MIGRATIONS, SO ITS HOOK IS NOT A UNIT
// TEST. The boot budget is the hook's; a hanging QUERY still fails on the
// smaller test budget.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const read = (name: string) => readFileSync(resolve(MIGRATIONS, name), "utf8");

const FN = "track_ab_event_optimized";
const TABLE = "ab_test_events";
/** The columns that make one event distinct from another. Metadata is payload, not identity. */
const IDENTITY = ["test_name", "variant", "visitor_id", "event_type"] as const;

// ---------------------------------------------------------------------------
// Reading a definition out of a migration.
// ---------------------------------------------------------------------------

type Param = { name: string; type: string };
type Definition = {
  file: string;
  /** From CREATE to the closing dollar-quote, comments gone. */
  text: string;
  params: Param[];
  /** Between the parameter list and the body: RETURNS, LANGUAGE, SECURITY, SET. */
  header: string;
  body: string;
};

/** Spelling variants Postgres treats as the same type, so a signature compare is semantic. */
function canonicalType(t: string): string {
  const k = t.trim().toLowerCase().replace(/\s+/g, " ");
  return ({ int: "integer", int4: "integer", bool: "boolean", "timestamp with time zone": "timestamptz" } as Record<string, string>)[k] ?? k;
}

/** Split on commas that sit outside any parentheses or quotes. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    const here = s.slice(i, i + sep.length).toUpperCase() === sep.toUpperCase();
    const wordBounded = sep.length === 1 || (/\s/.test(s[i - 1] ?? " ") && /\s/.test(s[i + sep.length] ?? " "));
    if (depth === 0 && here && wordBounded) {
      out.push(cur);
      cur = "";
      i += sep.length - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseParams(list: string): Param[] {
  return splitTopLevel(list, ",").map((p) => {
    const m = /^([A-Za-z_]\w*)\s+([A-Za-z_][\w ]*?)(?:\s+DEFAULT\b[\s\S]*)?$/i.exec(p.trim());
    if (!m) throw new Error(`cannot parse parameter: ${JSON.stringify(p)}`);
    return { name: m[1].toLowerCase(), type: canonicalType(m[2]) };
  });
}

/** Every terminated definition of FN in a file's code, in file order. */
function definitionsIn(file: string): Definition[] {
  const code = sqlCodeOf(read(file));
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${FN}\\s*\\(([\\s\\S]*?)\\)\\s*(RETURNS[\\s\\S]*?)\\bAS\\s+\\$([A-Za-z_]*)\\$([\\s\\S]*?)\\$\\3\\$`,
    "gi",
  );
  const out: Definition[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out.push({ file, text: m[0], params: parseParams(m[1]), header: m[2], body: m[4] });
  }
  return out;
}

/** Every definition across the migration set, oldest first. The last one is what the database holds. */
function allDefinitions(): Definition[] {
  return FILES.flatMap(definitionsIn);
}

type Conjunct = { col: string; op: string; rhs: string };

/** The WHERE text of the duplicate check: the EXISTS over the events table that guards the INSERT. */
function dedupPredicate(body: string): string {
  const re = new RegExp(
    `EXISTS\\s*\\(\\s*SELECT\\s+1\\s+FROM\\s+(?:public\\.)?${TABLE}(?:\\s+(?:AS\\s+)?[A-Za-z_]\\w*)?\\s+WHERE\\s+([\\s\\S]*?)\\)\\s*THEN`,
    "i",
  );
  const m = re.exec(body);
  if (!m) throw new Error(`no duplicate check over ${TABLE} found in the body -- the parser or the function has drifted`);
  return m[1].replace(/\bLIMIT\s+\d+\s*$/i, "").trim();
}

/** A predicate as the list of `column op expression` it ANDs together. */
function conjunctsOf(where: string): Conjunct[] {
  return splitTopLevel(where, "AND").map((c) => {
    const m = /^(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*(>=|<=|<>|!=|=|>|<)\s*([\s\S]+)$/.exec(c.trim());
    if (!m) throw new Error(`cannot parse conjunct: ${JSON.stringify(c)}`);
    return { col: m[1].toLowerCase(), op: m[2], rhs: m[3].trim().replace(/\s+/g, " ") };
  });
}

/** What the INSERT writes into each column of the events table: column -> expression. */
function insertBindings(body: string): Record<string, string> {
  const re = new RegExp(`INSERT\\s+INTO\\s+(?:public\\.)?${TABLE}\\s*\\(([^)]*)\\)\\s*VALUES\\s*\\(([\\s\\S]*?)\\)\\s*;`, "i");
  const m = re.exec(body);
  if (!m) throw new Error(`no INSERT into ${TABLE} found in the body`);
  const cols = splitTopLevel(m[1], ",").map((c) => c.toLowerCase());
  const vals = splitTopLevel(m[2], ",").map((v) => v.replace(/\s+/g, " "));
  if (cols.length !== vals.length) throw new Error("INSERT column and value counts differ");
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
}

/**
 * THE PROPERTY. Which identity columns does the duplicate check NOT bind, with
 * an equality, to the expression the INSERT stores in that column? An empty
 * answer is a key that names the whole event.
 */
function unboundIdentity(def: Definition): string[] {
  const conj = conjunctsOf(dedupPredicate(def.body));
  const stored = insertBindings(def.body);
  return IDENTITY.filter((col) => {
    if (!(col in stored)) throw new Error(`the INSERT does not write ${col}`);
    return !conj.some((c) => c.col === col && c.op === "=" && c.rhs === stored[col]);
  });
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A definition's text with its predicate replaced by a marker, whitespace collapsed: everything that is NOT the key. */
function outsideThePredicate(def: Definition): string {
  const where = dedupPredicate(def.body);
  const i = def.text.indexOf(where);
  if (i < 0) throw new Error("predicate text not found in its own definition");
  return squash(def.text.slice(0, i) + " <predicate> " + def.text.slice(i + where.length));
}

// ---------------------------------------------------------------------------
// Static: the live definition, its predecessor, and the file that carries it.
// ---------------------------------------------------------------------------

/**
 * The chain as the database replays it: every definition oldest first, the
 * index of the step that introduced the whole key, and the definition before
 * that step. Found by property, so a later redefinition of the function (a
 * window fix, a grant restatement) does not move which definition is "the fix".
 */
function chain(): { defs: Definition[]; stepIndex: number; step: Definition; before: Definition; live: Definition } {
  const defs = allDefinitions();
  const stepIndex = defs.findIndex((d) => unboundIdentity(d).length === 0);
  if (stepIndex < 1) throw new Error(`no definition after the first binds the whole key (stepIndex ${stepIndex})`);
  return { defs, stepIndex, step: defs[stepIndex], before: defs[stepIndex - 1], live: defs[defs.length - 1] };
}

describe("the live duplicate check names the whole event", () => {
  const { defs, stepIndex, step, before, live } = chain();
  const since = defs.slice(stepIndex);

  it("finds a history of definitions, newest last, with the key introduced somewhere after the first", () => {
    expect(defs.length, "expected a history of definitions").toBeGreaterThanOrEqual(2);
    for (let i = 1; i < defs.length; i++) expect(defs[i].file > defs[i - 1].file, "definitions must be ordered by migration stamp").toBe(true);
    expect(step.file > before.file).toBe(true);
    expect(live.file >= step.file).toBe(true);
  });

  it("binds every identity column -- test, variant, visitor, type -- to what the INSERT stores, in the live definition and every one since the step", () => {
    for (const d of since) expect(unboundIdentity(d), `${d.file}: identity columns the duplicate check leaves out`).toEqual([]);
    expect(since[since.length - 1]).toBe(live);
  });

  it("still windows the check on created_at", () => {
    const conj = conjunctsOf(dedupPredicate(live.body));
    expect(conj.some((c) => c.col === "created_at" && c.op === ">=")).toBe(true);
  });

  it("TEETH: the definition before the step fails this check by exactly the variant column", () => {
    expect(unboundIdentity(before)).toEqual(["variant"]);
  });

  it("TEETH: the live definition with its variant conjunct removed fails the same check", () => {
    const where = dedupPredicate(live.body);
    const kept = splitTopLevel(where, "AND").filter((c) => !/^\s*(?:\w+\.)?variant\b/i.test(c));
    expect(kept.length, "the mutation must remove exactly one conjunct").toBe(splitTopLevel(where, "AND").length - 1);
    const mutated: Definition = { ...live, body: live.body.replace(where, kept.join("\n      AND ")) };
    expect(unboundIdentity(mutated)).toEqual(["variant"]);
  });

  it("the step changed nothing but the key: same parameters, same text outside the predicate, one extra conjunct", () => {
    expect(step.params).toEqual(before.params);
    expect(outsideThePredicate(step)).toBe(outsideThePredicate(before));
    const b = conjunctsOf(dedupPredicate(before.body));
    const a = conjunctsOf(dedupPredicate(step.body));
    const added = a.filter((x) => !b.some((y) => y.col === x.col && y.op === x.op && y.rhs === x.rhs));
    const removed = b.filter((x) => !a.some((y) => y.col === x.col && y.op === x.op && y.rhs === x.rhs));
    expect(removed).toEqual([]);
    expect(added.map((c) => c.col)).toEqual(["variant"]);
  });

  it("every definition since the step keeps the step's parameter list and predicate -- no overload, no later rewrite of the key", () => {
    for (const d of since) {
      expect(d.params, `${d.file}: parameter list drifted`).toEqual(step.params);
      expect(conjunctsOf(dedupPredicate(d.body)), `${d.file}: the key changed after the step`).toEqual(conjunctsOf(dedupPredicate(step.body)));
    }
  });

  it("each redefinition since the step is carried by its own migration under a unique, non-round stamp, one definition per file", () => {
    for (const d of since) {
      const stamp = d.file.slice(0, 14);
      expect(stamp).toMatch(/^\d{14}$/);
      expect(stamp.slice(12), `${d.file}: a round second collides with the runner's own stamps`).not.toBe("00");
      expect(FILES.filter((n) => n.slice(0, 14) === stamp), `${d.file}: stamp is not unique`).toHaveLength(1);
      expect(definitionsIn(d.file), `${d.file}: holds more than one definition`).toHaveLength(1);
    }
  });

  it("each file since the step restates the lockdown: revoked from PUBLIC, anon and authenticated by name, granted to service_role only", () => {
    for (const d of since) {
      const code = sqlCodeOf(read(d.file));
      const sig = d.params.map((p) => p.type).join(",\\s*");
      expect(code, d.file).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${FN}\\(${sig}\\) FROM PUBLIC, anon, authenticated;`, "i"));
      expect(code, d.file).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${FN}\\(${sig}\\) TO service_role;`, "i"));
      expect(code, d.file).not.toMatch(new RegExp(`GRANT [^;]*ON FUNCTION public\\.${FN}\\([^)]*\\) TO [^;]*\\b(anon|authenticated)\\b`, "i"));
    }
  });
});

// ---------------------------------------------------------------------------
// Behavioural: a real Postgres, before and after.
// ---------------------------------------------------------------------------

/** The real CREATE TABLE for a table, lifted from the migration that created it. */
function tableDdl(stampPrefix: string, table: string): string {
  const file = FILES.find((n) => n.startsWith(stampPrefix));
  if (!file) throw new Error(`no migration starts with ${stampPrefix}`);
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${table} \\([\\s\\S]*?\\);`).exec(sqlCodeOf(read(file)));
  if (!m) throw new Error(`${file} does not create ${table}`);
  return m[0];
}

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

/** The two tables the writer touches, then the given definitions in order. */
async function boot(defs: Definition[]): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(tableDdl("20251216002238", "rate_limits"));
  await db.exec(tableDdl("20251217181914", TABLE));
  for (const d of defs) await db.exec(read(d.file));
  return db;
}

type Call = { test?: string; variant: string; type?: string; visitor: string; ip?: string; max?: number };

/** One call to the writer, as the edge function makes it, answered by its status word. */
async function track(db: PGlite, c: Call): Promise<string> {
  const r = await db.query<{ status: string }>(
    `SELECT public.${FN}($1, $2, $3, $4, '{}'::jsonb, $5, $6, 60)->>'status' AS status`,
    [c.test ?? "conversion_funnel", c.variant, c.type ?? "view", c.visitor, c.ip ?? "203.0.113.1", c.max ?? 50],
  );
  return r.rows[0].status;
}

async function rows(db: PGlite, visitor: string): Promise<Array<{ variant: string; event_type: string }>> {
  const r = await db.query<{ variant: string; event_type: string }>(
    `SELECT variant, event_type FROM public.${TABLE} WHERE visitor_id = $1 ORDER BY variant`,
    [visitor],
  );
  return r.rows;
}

/** A row planted directly with a chosen age, to probe the windows. */
async function plant(db: PGlite, visitor: string, variant: string, type: string, age: string): Promise<void> {
  await db.query(
    `INSERT INTO public.${TABLE} (test_name, variant, event_type, visitor_id, created_at) VALUES ('conversion_funnel', $1, $2, $3, now() - $4::interval)`,
    [variant, type, visitor, age],
  );
}

async function anonMayExecute(db: PGlite, sig: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(`SELECT has_function_privilege('anon', 'public.${FN}(${sig})', 'EXECUTE') AS ok`);
  return r.rows[0].ok;
}

describe("under the writer before the step (pglite)", () => {
  const { before: prev } = chain();
  let db: PGlite;
  beforeAll(async () => { db = await boot([prev]); });

  it("TEETH: a visitor's second stage is refused as a duplicate and the table holds one row", async () => {
    expect(await track(db, { variant: "landing_view", visitor: "v-old" })).toBe("recorded");
    expect(await track(db, { variant: "upload_started", visitor: "v-old" })).toBe("duplicate");
    expect(await rows(db, "v-old")).toEqual([{ variant: "landing_view", event_type: "view" }]);
  });

  it("TEETH: with no lockdown applied, anon could execute it", async () => {
    expect(await anonMayExecute(db, prev.params.map((p) => p.type).join(","))).toBe(true);
  });
});

describe("under the live writer (pglite): the pre-step writer, then the whole chain from the step onward", () => {
  const { defs, stepIndex, before: prev, live } = chain();
  let db: PGlite;
  beforeAll(async () => { db = await boot([prev, ...defs.slice(stepIndex)]); });

  it("stores two events that differ only in variant, and the same event twice only once", async () => {
    expect(await track(db, { variant: "landing_view", visitor: "v-new" })).toBe("recorded");
    expect(await track(db, { variant: "upload_started", visitor: "v-new" })).toBe("recorded");
    expect(await track(db, { variant: "landing_view", visitor: "v-new" })).toBe("duplicate");
    expect(await rows(db, "v-new")).toEqual([
      { variant: "landing_view", event_type: "view" },
      { variant: "upload_started", event_type: "view" },
    ]);
  });

  it("keeps the 24-hour window for a view", async () => {
    await plant(db, "v-view-25h", "landing_view", "view", "25 hours");
    await plant(db, "v-view-23h", "landing_view", "view", "23 hours");
    expect(await track(db, { variant: "landing_view", visitor: "v-view-25h" })).toBe("recorded");
    expect(await track(db, { variant: "landing_view", visitor: "v-view-23h" })).toBe("duplicate");
  });

  it("keeps the 90-day window for a conversion", async () => {
    await plant(db, "v-conv-91d", "purchase_completed", "conversion", "91 days");
    await plant(db, "v-conv-89d", "purchase_completed", "conversion", "89 days");
    expect(await track(db, { variant: "purchase_completed", type: "conversion", visitor: "v-conv-91d" })).toBe("recorded");
    expect(await track(db, { variant: "purchase_completed", type: "conversion", visitor: "v-conv-89d" })).toBe("duplicate");
  });

  it("still keys the window on the variant too: a fresh view under another variant is not held by an old one", async () => {
    // The 23-hour landing row above is inside the window; a different stage for the same visitor is not the same event.
    expect(await track(db, { variant: "results_viewed", visitor: "v-view-23h" })).toBe("recorded");
  });

  it("keeps the rate limit: the call past the cap is refused before it reaches the check", async () => {
    // The counter's window is the sixty-minute bucket the call falls in, so
    // three calls that straddle its boundary would legitimately see it reset.
    // Each attempt uses a fresh IP and is kept only if the bucket did not
    // change under it; a boundary falls inside a few milliseconds almost
    // never, and three tries make "never" the practical answer.
    const bucket = async () => (await db.query<{ b: number }>("SELECT floor(EXTRACT(EPOCH FROM now()) / 3600)::int AS b")).rows[0].b;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ip = `198.51.100.${attempt}`;
      const before = await bucket();
      const answers = [
        await track(db, { variant: "landing_view", visitor: `v-rl-${attempt}-1`, ip, max: 2 }),
        await track(db, { variant: "landing_view", visitor: `v-rl-${attempt}-2`, ip, max: 2 }),
        await track(db, { variant: "landing_view", visitor: `v-rl-${attempt}-3`, ip, max: 2 }),
      ];
      if ((await bucket()) !== before && attempt < 3) continue;
      expect(answers).toEqual(["recorded", "recorded", "rate_limited"]);
      expect(await rows(db, `v-rl-${attempt}-3`)).toEqual([]);
      return;
    }
  });

  it("leaves exactly one function of this name -- no overload was created", async () => {
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = '${FN}'`);
    expect(r.rows[0].n).toBe(1);
  });

  it("closes the function to anon and opens it to service_role", async () => {
    const sig = live.params.map((p) => p.type).join(",");
    expect(await anonMayExecute(db, sig)).toBe(false);
    const r = await db.query<{ ok: boolean }>(`SELECT has_function_privilege('service_role', 'public.${FN}(${sig})', 'EXECUTE') AS ok`);
    expect(r.rows[0].ok).toBe(true);
  });
});
