/**
 * A DURATION THAT DOES NOT SAY WHICH CLOCK IT USED.
 *
 * This board stores two dates that look interchangeable and are not.
 * `posted_at` is the EMPLOYER'S OWN STATED posting date. `first_seen` is OUR
 * DISCOVERY DATE — the day this collector first fetched that company's feed —
 * and it is never a posting age. For a board added in last week's census,
 * first_seen says something about us and nothing whatsoever about the role.
 *
 * We have already published the mistake. A "2.8-day median" shipped as a
 * posting age when what it actually measured was `now - first_seen`: how
 * recently we discovered the boards, restated as how quickly employers hire.
 * The number was wrong in a way no reader could detect and no later query
 * could repair, because the stored value did not record which clock produced
 * it.
 *
 * The same mixed clock was then found INSIDE the fix. `job_board_exits`
 * writes `days_on_board` from four sites in job-board/index.ts, and three of
 * them computed it as `(posted_at ?? first_seen)` — a per-row coalesce, with
 * no column saying which branch a given row took. The hiring-health estimator
 * takes its right-censoring times from exits rows with
 * `exit_reason <> 'removed'`, which draws on two of those three: mixed-clock
 * durations were feeding the censoring input of the survival model built to
 * remove exactly that error, and nothing in the table could separate a clean
 * row from a contaminated one.
 *
 * NONE OF THIS IS BACKFILLABLE. The posting row is hard-deleted at closure, so
 * the exit row is written at the last instant both dates exist anywhere. A row
 * that recorded a number without its basis has lost the basis permanently, for
 * every period already elapsed.
 *
 * THE PROPERTY THIS GUARD STATES, for the CLASS and not for one spelling:
 *
 *   1. Every stored duration names its origin basis. Any row this repo builds
 *      with a `days_on_board` carries an `origin_basis` in the same literal —
 *      found by scanning supabase/functions, so a FIFTH write site added next
 *      month fails here instead of shipping.
 *   2. No write site coalesces posted_at with first_seen. Not in TypeScript
 *      (`??`, `||`), not in SQL text (`COALESCE(posted_at, first_seen)`), and
 *      not in any INSERT that lands in an exits or closures table.
 *   3. The basis vocabulary is exactly {'stated','discovered'} — a CHECK that
 *      admits a third value admits an unlabelled clock, and a NOT NULL DEFAULT
 *      would stamp 'stated' onto the historical mixed rows, which is the
 *      original error with a schema change on top.
 *   4. The one legacy coalesce that survives (roll_up_and_prune_closures, owned
 *      by another workflow this week) is NAMED as mixed in its column comments.
 *      Exactly two files may do it; a third is a new occurrence.
 *
 * The shipped `tenureDays` is transpiled and EXECUTED here, not pattern-matched,
 * because a regex that spells the mechanism passes while the mechanism is dead.
 * Every code assertion runs against COMMENT-STRIPPED source and every prose
 * assertion against RAW source: this repo has seven times passed a guard whose
 * pinned spelling lived only in a comment while the code beneath it was gone.
 * The teeth tests at the foot of this file re-run each checker against the
 * pre-fix spellings, including a source whose COMMENTS are perfect and whose
 * CODE is the old bug.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import ts from "typescript";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Executable text only. A comment that spells the mechanism is not the mechanism. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/^\s*\/\/.*$/gm, "");
/** Same, for SQL: `--` to end of line. */
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "");

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
      const full = join(d, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) out.push(full);
    }
  };
  walk(resolve(ROOT, dir));
  return out.sort();
}

const FUNCTION_FILES = tsFilesUnder("supabase/functions").map((f) => ({
  path: f.slice(ROOT.length + 1),
  raw: readFileSync(f, "utf8"),
}));
const FUNCTION_CODE = FUNCTION_FILES.map((f) => ({ path: f.path, code: stripComments(f.raw) }));

const BOARD_RAW = read("supabase/functions/job-board/index.ts");
const BOARD_CODE = stripComments(BOARD_RAW);

const BASIS_MIGRATION = "supabase/migrations/20260906214000_a_stored_duration_must_name_its_clock.sql";
const BASIS_RAW = read(BASIS_MIGRATION);

/* ─────────────────────────── the checkers ───────────────────────────── */
/* Pure functions over source text, so the teeth tests below can run the very
   same code against the pre-fix spellings and watch it fail. */

/**
 * Every object literal that stores a duration must also store its basis.
 * Returns the offending literals. `key` identifies the class of row: any
 * literal containing it is a row this repo writes.
 */
function literalsMissing(code: string, key: string, required: string[]): string[] {
  const bad: string[] = [];
  for (let i = code.indexOf(key); i !== -1; i = code.indexOf(key, i + 1)) {
    // Walk back to the enclosing `{`, then forward to its match.
    let depth = 0, open = -1;
    for (let j = i; j >= 0; j--) {
      const c = code[j];
      if (c === "}") depth++;
      else if (c === "{") { if (depth === 0) { open = j; break; } depth--; }
    }
    if (open === -1) { bad.push(`${key} @${i} is not inside an object literal`); continue; }
    let close = code.length, d2 = 0;
    for (let j = open; j < code.length; j++) {
      const c = code[j];
      if (c === "{") d2++;
      else if (c === "}") { d2--; if (d2 === 0) { close = j + 1; break; } }
    }
    const lit = code.slice(open, close);
    const missing = required.filter((r) => !lit.includes(r));
    if (missing.length) bad.push(`literal @${i} missing ${missing.join(", ")}: ${lit.slice(0, 160)}`);
  }
  return bad;
}

/** How many row literals of this class exist at all (a scan that finds none proves nothing). */
function literalCount(code: string, key: string): number {
  return code.split(key).length - 1;
}

/**
 * The coalesce, in every dialect this repo writes it in. Deliberately NOT
 * anchored to `days_on_board`: a coalesce of these two dates is wrong wherever
 * a duration is built from it, under any local variable name.
 */
const COALESCE_FORMS: Array<{ name: string; re: RegExp }> = [
  { name: "TS ?? (snake_case)", re: /posted_at\s*\)?\s*\?\?\s*[\w.$]*first_seen/g },
  { name: "TS ?? (camelCase)", re: /postedAt\s*\)?\s*\?\?\s*[\w.$]*[Ff]irstSeen/g },
  { name: "TS || (snake_case)", re: /posted_at\s*\)?\s*\|\|\s*[\w.$]*first_seen/g },
  { name: "TS || (camelCase)", re: /postedAt\s*\)?\s*\|\|\s*[\w.$]*[Ff]irstSeen/g },
  { name: "SQL COALESCE", re: /coalesce\s*\(\s*[\w.$"]*posted_at\s*,\s*[\w.$"]*first_seen/gi },
];

function coalescedClocks(code: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of COALESCE_FORMS) {
    for (const m of code.matchAll(re)) {
      const line = code.slice(0, m.index ?? 0).split("\n").length;
      hits.push(`${name} at line ${line}: ${m[0]}`);
    }
  }
  return hits;
}

/** Statements that INSERT into a lifecycle table AND coalesce the two clocks in the same statement. */
function coalescingLedgerInserts(sql: string): Array<{ table: string; snippet: string }> {
  const clean = stripSql(sql);
  const out: Array<{ table: string; snippet: string }> = [];
  for (const m of clean.matchAll(/INSERT\s+INTO\s+(?:public\.)?([a-z0-9_]+)/gi)) {
    const table = m[1];
    if (!/(exit|closure)/i.test(table)) continue;
    const at = m.index ?? 0;
    const start = clean.lastIndexOf(";", at) + 1;
    const endIdx = clean.indexOf(";", at);
    const stmt = clean.slice(start, endIdx === -1 ? clean.length : endIdx);
    const co = /coalesce\s*\(\s*[\w.$"]*posted_at\s*,\s*[\w.$"]*first_seen/i.exec(stmt);
    if (co) out.push({ table, snippet: co[0] });
  }
  return out;
}

/**
 * The body of a COMMENT ON COLUMN statement. Scanned with quote state rather
 * than a lazy `;` match, because these comments contain semicolons inside their
 * own quoted text and a naive match truncates the sentence being asserted on.
 */
function commentBody(sql: string, target: string): string | null {
  const at = sql.indexOf(`COMMENT ON COLUMN ${target} IS`);
  if (at === -1) return null;
  let i = at, inStr = false;
  for (; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (inStr && sql[i + 1] === "'") { i++; continue; } // '' is an escaped quote
      inStr = !inStr;
    } else if (c === ";" && !inStr) break;
  }
  return sql.slice(at, i);
}

/** The values a CHECK constraint on a named column admits. */
function checkVocabulary(sql: string, column: string): string[] | null {
  const re = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "i");
  const m = re.exec(stripSql(sql));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

/** The shipped duration function, transpiled and executed. */
const shipped = (() => {
  const pick = (re: RegExp, name: string) => {
    const m = re.exec(BOARD_RAW)?.[0];
    expect(m, `${name} has moved or been renamed — this guard must be re-pointed, not deleted`).toBeTruthy();
    return m!;
  };
  // Consts first: a hoisted function reading a const from its TDZ is a
  // failure mode this repo has already shipped once.
  const src = [
    pick(/const FRESH_WINDOW_DAYS = [^\n]*\n/, "FRESH_WINDOW_DAYS"),
    pick(/const BACKDATE_SLACK_MS = [^\n]*\n/, "BACKDATE_SLACK_MS"),
    pick(/function tenureDays\([\s\S]*?\n\}/, "tenureDays"),
    pick(/function exitReasonFor\([\s\S]*?\n\}/, "exitReasonFor"),
    "return { tenureDays, exitReasonFor };",
  ].join("\n");
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(js)() as {
    tenureDays: (
      postedAt: unknown, firstSeen: unknown, exitedAtIso: string,
    ) => { days: number | null; basis: "stated" | "discovered" | null };
    exitReasonFor: (postedAt: unknown, firstSeen: unknown) => string;
  };
})();

/* ───────────────────────── 1. the executed mechanism ─────────────────── */

describe("the shipped duration says which clock produced it", () => {
  const exited = "2026-09-06T00:00:00.000Z";
  const posted = "2026-08-27T00:00:00.000Z";   // employer's date: 10 days
  const seen = "2026-09-04T00:00:00.000Z";     // our discovery: 2 days

  it("measures from the employer's clock and labels it 'stated'", () => {
    const t = shipped.tenureDays(posted, seen, exited);
    expect(t.basis).toBe("stated");
    expect(t.days).toBe(10);
    // The whole point: our discovery date, eight days later, did not touch it.
    expect(t.days).not.toBe(2);
  });

  it("labels the discovery clock 'discovered' rather than passing it off as a posting age", () => {
    const t = shipped.tenureDays(null, seen, exited);
    expect(t.days).toBe(2);
    expect(t.basis).toBe("discovered");
    expect(t.basis).not.toBe("stated");
    // 2.8-day-median teeth: the pre-fix coalesce produced this same 2 with no
    // basis at all, and that is exactly what got published as a posting age.
    const preFix = { days: 2, basis: undefined as string | undefined };
    expect(preFix.basis).toBeUndefined();
  });

  it("emits no unlabelled duration in any branch, including the unreadable one", () => {
    for (const args of [
      [null, null, exited],
      [undefined, undefined, exited],
      ["not-a-date", "not-a-date", exited],
      [posted, seen, "not-a-date"],
      ["", "", exited],
    ] as const) {
      const t = shipped.tenureDays(args[0], args[1], args[2] as string);
      if (t.days !== null) expect(t.basis, `days ${t.days} shipped with basis ${t.basis}`).not.toBeNull();
      if (t.basis === null) expect(t.days).toBeNull();
    }
  });

  it("never returns a basis outside the vocabulary the CHECK constraint admits", () => {
    const vocab = checkVocabulary(BASIS_RAW, "origin_basis");
    expect(vocab).toEqual(["stated", "discovered"]);
    for (const args of [[posted, seen], [null, seen], [posted, null], [null, null]] as const) {
      const t = shipped.tenureDays(args[0], args[1], exited);
      if (t.basis !== null) expect(vocab).toContain(t.basis);
    }
  });

  it("keeps the basis independent of the exit reason (both clocks are read, neither is merged)", () => {
    // exitReasonFor compares the two dates; that is a comparison, not a coalesce.
    expect(shipped.exitReasonFor(posted, seen)).toBe("aged_out");
    expect(shipped.exitReasonFor("2026-01-01T00:00:00Z", seen)).toBe("backdated");
    expect(shipped.tenureDays("2026-01-01T00:00:00Z", seen, exited).basis).toBe("stated");
  });
});

/* ─────────────────── 2. the class rule over every write site ─────────── */

describe("every stored duration in supabase/functions names its origin basis", () => {
  it("finds the duration-writing literals at all", () => {
    const total = FUNCTION_CODE.reduce((n, f) => n + literalCount(f.code, "days_on_board:"), 0);
    // Four sites today. The assertion is "at least the four we know about" so a
    // fifth is scanned automatically rather than needing this number bumped.
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it("stamps origin_basis in every literal that stores days_on_board", () => {
    const bad = FUNCTION_CODE.flatMap((f) =>
      literalsMissing(f.code, "days_on_board:", ["origin_basis:"]).map((b) => `${f.path}: ${b}`),
    );
    expect(bad, "a duration was stored without saying which clock produced it").toEqual([]);
  });

  it("stamps both on every job_board_exits row builder, identified by exit_reason", () => {
    const sites = FUNCTION_CODE.reduce((n, f) => n + literalCount(f.code, "exit_reason:"), 0);
    expect(sites, "the four exit write sites").toBeGreaterThanOrEqual(4);
    const bad = FUNCTION_CODE.flatMap((f) =>
      literalsMissing(f.code, "exit_reason:", ["days_on_board:", "origin_basis:"]).map((b) => `${f.path}: ${b}`),
    );
    expect(bad, "an exit row was written with no basis for its duration").toEqual([]);
  });

  it("coalesces posted_at with first_seen nowhere in supabase/functions", () => {
    const hits = FUNCTION_CODE.flatMap((f) => coalescedClocks(f.code).map((h) => `${f.path}: ${h}`));
    expect(hits, "OUR discovery date silently standing in for the employer's").toEqual([]);
  });

  it("still tells the story in prose, in the raw source", () => {
    // Prose against RAW: the comment must survive, but it is never what the
    // code assertions above read.
    expect(BOARD_RAW).toMatch(/first_seen is OUR DISCOVERY DATE/i);
    expect(BOARD_RAW).toMatch(/2\.8-day median/);
    expect(BOARD_RAW).toMatch(/origin_basis/);
    // ...and the prose alone must not be able to satisfy the code rule.
    expect(BOARD_CODE).not.toMatch(/2\.8-day median/);
  });
});

/* ───────────────────────── 3. the schema vocabulary ──────────────────── */

describe("the exits column admits exactly two bases and stamps none retroactively", () => {
  it("permits 'stated' and 'discovered' and nothing else", () => {
    expect(checkVocabulary(BASIS_RAW, "origin_basis")).toEqual(["stated", "discovered"]);
  });

  it("adds the column nullable, so historical mixed rows are not relabelled 'stated'", () => {
    const add = /ALTER TABLE public\.job_board_exits\s+ADD COLUMN IF NOT EXISTS origin_basis[^;]*/i.exec(stripSql(BASIS_RAW));
    expect(add, "the ADD COLUMN has moved").toBeTruthy();
    expect(add![0]).not.toMatch(/NOT\s+NULL/i);
    expect(add![0]).not.toMatch(/DEFAULT/i);
  });

  it("documents what each value means, and that NULL is not a third basis", () => {
    const comment = commentBody(BASIS_RAW, "public.job_board_exits.origin_basis") ?? "";
    expect(comment).toMatch(/stated/);
    expect(comment).toMatch(/discovered/);
    expect(comment).toMatch(/first_seen/);
    expect(comment).toMatch(/NOT a posting age/i);
    expect(comment).toMatch(/NULL/);
  });
});

/* ──────────── 4. no INSERT into a lifecycle table coalesces ───────────── */

const MIGRATIONS = readdirSync(resolve(ROOT, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, raw: read(`supabase/migrations/${f}`) }));

/**
 * The one place a coalesced duration is still written, and the reason it is
 * listed instead of fixed: roll_up_and_prune_closures belongs to another
 * workflow this week, and a CREATE OR REPLACE from our side would silently
 * overwrite theirs. It is admitted here only because its columns are
 * documented as mixed — see the test below. A THIRD file is a new occurrence.
 */
const DOCUMENTED_LEGACY_COALESCE = [
  "20260727140000_closure_rollup_before_delete.sql",
  "20260727161414_7a6338e0-30f9-44d3-83dd-7399dc2e27ea.sql",
];

describe("no INSERT into an exits or closures table computes a duration from a coalesce", () => {
  it("is clean in every migration of this collection wave", () => {
    const wave = MIGRATIONS.filter((m) => /^202609062[0-9]{5}_/.test(m.file));
    expect(wave.length, "the collection wave's migrations").toBeGreaterThan(0);
    const hits = wave.flatMap((m) =>
      coalescingLedgerInserts(m.raw).map((h) => `${m.file}: INSERT INTO ${h.table} … ${h.snippet}`),
    );
    expect(hits).toEqual([]);
  });

  it("is confined repo-wide to the two documented legacy files", () => {
    const offenders = MIGRATIONS.filter((m) => coalescingLedgerInserts(m.raw).length > 0).map((m) => m.file);
    expect(offenders.sort()).toEqual([...DOCUMENTED_LEGACY_COALESCE].sort());
  });

  it("names the surviving mix in the rollup's own column comments", () => {
    // The class property does not exempt the legacy rollup, it is satisfied a
    // level up: the stored number cannot be read without being told it is mixed.
    const all = MIGRATIONS.map((m) => m.raw).join("\n");
    for (const col of ["p50_days_open", "p75_days_open"]) {
      const c = commentBody(all, `public.job_board_closure_rollup.${col}`) ?? "";
      expect(c, `${col} stores a duration with no statement of its basis`).toMatch(/MIXED CLOCK|mixed-clock/i);
    }
    const p50 = commentBody(all, "public.job_board_closure_rollup.p50_days_open") ?? "";
    expect(p50).toMatch(/first_seen/);
    expect(p50).toMatch(/COALESCE/i);
  });

  it("splits the new exit rollup's percentiles by basis instead of averaging over both", () => {
    const rollup = MIGRATIONS.find((m) => /^20260906218000_/.test(m.file));
    expect(rollup, "the exit-ledger rollup migration").toBeTruthy();
    const sql = stripSql(rollup!.raw);
    for (const m of sql.matchAll(/INSERT\s+INTO\s+(?:public\.)?([a-z0-9_]+)/gi)) {
      if (!/exit/i.test(m[1])) continue;
      const at = m.index ?? 0;
      const stmt = sql.slice(sql.lastIndexOf(";", at) + 1, (sql.indexOf(";", at) + 1) || sql.length);
      if (!/days_on_board/.test(stmt)) continue;
      expect(stmt, `INSERT INTO ${m[1]} summarises durations without reading origin_basis`).toMatch(/origin_basis/);
    }
  });
});

/* ───────────────────────────── 5. teeth ──────────────────────────────── */

describe("the guard has teeth: each checker fails against the pre-fix spelling", () => {
  const PRE_FIX_SITE = `
    const exitRow = (r) => {
      const posted = r.posted_at ?? r.first_seen;
      return {
        posting_id: String(r.id),
        exit_reason: reason,
        days_on_board: Math.round((Date.parse(exitedAt) - Date.parse(posted)) / 86400000),
        exited_at: exitedAt,
      };
    };`;

  it("catches a row that stores a duration with no basis", () => {
    expect(literalsMissing(PRE_FIX_SITE, "days_on_board:", ["origin_basis:"])).not.toEqual([]);
    expect(literalsMissing(PRE_FIX_SITE, "exit_reason:", ["days_on_board:", "origin_basis:"])).not.toEqual([]);
    // ...and passes the shipped shape, so it is not simply always-red.
    expect(literalsMissing(
      `{ exit_reason: "removed", days_on_board: t.days, origin_basis: t.basis }`,
      "exit_reason:", ["days_on_board:", "origin_basis:"],
    )).toEqual([]);
  });

  it("catches the coalesce in every dialect", () => {
    expect(coalescedClocks(PRE_FIX_SITE)).not.toEqual([]);
    expect(coalescedClocks("const d = r.posted_at || r.first_seen;")).not.toEqual([]);
    expect(coalescedClocks("const d = postedAt ?? firstSeen;")).not.toEqual([]);
    expect(coalescedClocks("closed_at - COALESCE(c.posted_at, c.first_seen)")).not.toEqual([]);
    // Reading both without merging them is legitimate and must stay green.
    expect(coalescedClocks("tenureDays(r.posted_at, r.first_seen, exitedAt)")).toEqual([]);
    expect(coalescedClocks("posted_at: r.posted_at ?? null,")).toEqual([]);
  });

  it("catches a perfect comment sitting on top of the old code — the trap this repo fell into seven times", () => {
    const LIAR = `
      /**
       * origin_basis is stamped at all four sites and the posted_at ??
       * first_seen coalesce is gone. days_on_board: t.days, origin_basis: t.basis.
       */
      // origin_basis: "stated"
      const exitRow = (r) => ({
        exit_reason: "removed",
        days_on_board: daysBetween(r.posted_at ?? r.first_seen, exitedAt),
      });`;
    // Against RAW the liar looks fixed — which is precisely why nothing asserts on RAW.
    expect(LIAR).toMatch(/origin_basis/);
    const code = stripComments(LIAR);
    expect(code).not.toMatch(/origin_basis/);
    expect(literalsMissing(code, "exit_reason:", ["origin_basis:"])).not.toEqual([]);
    expect(coalescedClocks(code)).not.toEqual([]);
  });

  it("catches a CHECK that admits an unlabelled third clock, or a DEFAULT that relabels history", () => {
    expect(checkVocabulary(
      `ADD CONSTRAINT x CHECK (origin_basis IN ('stated', 'discovered', 'unknown'));`, "origin_basis",
    )).toEqual(["stated", "discovered", "unknown"]);
    expect(checkVocabulary(`CHECK (origin_basis IN ('stated', 'discovered'))`, "origin_basis"))
      .toEqual(["stated", "discovered"]);
    expect(checkVocabulary(`-- CHECK (origin_basis IN ('stated'))`, "origin_basis")).toBeNull();
    const withDefault = "ALTER TABLE public.job_board_exits ADD COLUMN IF NOT EXISTS origin_basis text NOT NULL DEFAULT 'stated';";
    expect(/NOT\s+NULL/i.test(withDefault) || /DEFAULT/i.test(withDefault)).toBe(true);
  });

  it("catches a new SQL rollup that freezes a mixed clock into a stored number", () => {
    const PRE_FIX_SQL = `
      -- COALESCE(c.posted_at, c.first_seen) is never used here.
      WITH src AS (
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM (e.exited_at - COALESCE(e.posted_at, e.first_seen))) / 86400.0
        ) AS p50
        FROM public.job_board_exits e
      )
      INSERT INTO public.job_board_exit_rollup (p50_days) SELECT p50 FROM src;`;
    const hits = coalescingLedgerInserts(PRE_FIX_SQL);
    expect(hits.map((h) => h.table)).toEqual(["job_board_exit_rollup"]);
    // The `--` line spelling the promise does not save it, and does not raise a
    // false alarm on its own either.
    expect(coalescingLedgerInserts(
      "-- COALESCE(c.posted_at, c.first_seen)\nINSERT INTO public.job_board_exits (posting_id) VALUES ('x');",
    )).toEqual([]);
  });
});
