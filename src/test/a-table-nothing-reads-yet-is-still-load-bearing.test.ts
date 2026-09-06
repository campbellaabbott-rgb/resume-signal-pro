import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A TABLE NOTHING READS YET IS STILL LOAD-BEARING.
 *
 * WHAT WAS NOT BEING WRITTEN DOWN. The .61 collection pass added the write
 * halves of eight longitudinal assets that this codebase was computing and
 * then discarding on every rotation: the old value of every field an employer
 * edits on a live requisition (job_board_field_changes), the employer's own
 * advertised posting count as a dated series rather than a single overwritten
 * scalar (job_board_board_state), the pay/team/geography/level facets of a
 * role at the moment it ends (job_board_closures and job_board_exits widened),
 * which clock a stored duration was measured from (origin_basis), the company
 * behind every search click, what was SHOWN alongside what was clicked, who
 * asked (caller), and the segmented daily company snapshot.
 *
 * WHY IT CAN NEVER BE BACKFILLED. Every one of these is an observation, not a
 * derivation. The posting row is HARD-DELETED at closure, so the instant a
 * role ends is the last instant its salary, department, work mode and region
 * exist anywhere; the previous title of a repriced requisition exists only in
 * the diff the ingest pass computed and threw away; a feed_total that was
 * overwritten is simply gone. A competitor starting tomorrow cannot recover
 * yesterday, and neither can we. Each day the write is broken is a day
 * permanently missing.
 *
 * THE PROPERTY THIS GUARD STATES. None of these tables has a reader yet — no
 * RPC, no UI, no API surface queries them, deliberately so. That is exactly
 * what makes a broken write invisible: nothing goes red, no page 500s, no
 * number moves. The failure mode is a silent, permanent hole discovered months
 * later by whoever finally builds the reader. So the writes are guarded
 * STRUCTURALLY, from the source, on four properties that do not need a reader:
 *
 *   1. Every insert into a table this pass writes CHECKS ITS { error } — and
 *      so does every call to the shared helper that now owns the exit insert,
 *      because it RETURNS the error rather than raising it. supabase-js
 *      RETURNS errors, it never throws — an unchecked insert is
 *      indistinguishable from a successful one at the call site.
 *   2. Every column name any of those inserts NAMES exists in the migrations.
 *      Both sides are derived by parsing, so a rename on either side fails
 *      here. Three builders working independently on the same pass makes this
 *      cross-artifact mismatch the single most likely defect, and PostgREST
 *      fails the WHOLE statement on one unknown column — an un-tolerated
 *      rename does not degrade a row, it deletes the event.
 *   3. The exit ledger's prune REFUSES to delete a period it has not already
 *      summarised, mirroring roll_up_and_prune_closures. job_board_exits was
 *      on a bare DELETE at 90 days with no rollup, and its oldest rows date
 *      from 2026-07-26 — THE FIRST IRREVERSIBLE LOSS WAS DATED 2026-10-24.
 *   4. Every new table has RLS enabled and no anon grant. The lifecycle log
 *      was anon-readable for its first 35 days; that was an incident.
 *
 * WHERE THE EXIT LEDGER'S WRITES LIVE NOW. Two branches fixed the same
 * mixed-clock defect at the same four exit write sites, and the merge kept the
 * union: a tenureDays() helper that returns {days, basis} so days_on_board no
 * longer coalesces, four ROW BUILDERS (exitRow, agedExitRow, removedExitRow,
 * sweptExitRow), and ONE insertExits() helper carrying the strip-and-retry that
 * every site now calls. So the file holds exactly ONE literal
 * `.from("job_board_exits").insert(` — inside that helper, over an opaque
 * `rows` parameter. Counting literal inserts, which is what this file used to
 * do, would now find one site whose columns cannot be read: a guard reporting
 * nothing. The obligation did not move, the place to read it did — from the
 * insert statement to the builder the call site hands the helper. Properties 1
 * and 2 are therefore evaluated over EXIT WRITE PATHS: every insertExits(...)
 * call site, plus any literal insert that BYPASSES the helper, which is the
 * pre-merge shape and must still be caught if it returns.
 *
 * CODE IS ASSERTED AGAINST COMMENT-STRIPPED SOURCE, PROSE AGAINST RAW. This
 * repo has shipped a guard that passed because the spelling it pinned lived in
 * a comment while the code beneath it was dead — seven times. Every structural
 * check below reads CODE; the two narrative checks read RAW and say so.
 */

const ROOT = resolve(__dirname, "../..");
const INDEX_PATH = resolve(ROOT, "supabase/functions/job-board/index.ts");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

const RAW = readFileSync(INDEX_PATH, "utf8");
/** The prescribed stripper: block comments, plus lines that are ONLY a comment
 *  (so an `https://` inside a string literal survives). */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** CODE with TRAILING `//` comments blanked out too (see
 *  blankTrailingLineComments): same length, same offsets, no live code inside a
 *  changelog note. Everything that scans for a call or follows a declaration
 *  reads this; the two narrative checks read RAW and say so. */
const LIVE = blankTrailingLineComments(CODE);

const MIGRATION_FILES = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const SQL_RAW = MIGRATION_FILES.map((f) => readFileSync(resolve(MIGRATIONS, f), "utf8"));
/** SQL with `--` line comments removed. Kept per-file so a failure can name one. */
const SQL_CODE = SQL_RAW.map((s) => s.replace(/^[ \t]*--.*$/gm, ""));

/* ────────────────────────── tiny source scanners ─────────────────────────
 * Deliberately hand-rolled rather than a parser dependency: these run over two
 * artifacts in two languages and only ever need to find balanced brackets
 * outside of strings. Everything here is string-aware, because the row objects
 * being read contain "apply", 'US-CA' and `${token}`.
 * ─────────────────────────────────────────────────────────────────────────*/

/** Index just past the bracket matching the opener at `open`, string-aware. */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const close = pairs[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return src.length; continue; }
    if (c === src[open]) depth++;
    else if (c === close) { depth--; if (depth === 0) return i + 1; }
  }
  return src.length;
}

/** Index of the closing quote of the string starting at `i`. */
function skipString(src: string, i: number): number {
  const quote = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (quote === "`" && src[j] === "$" && src[j + 1] === "{") { j = matchBracket(src, j + 1) - 1; continue; }
    if (src[j] === quote) return j;
  }
  return src.length;
}

/**
 * Remove `//` comments that TRAIL code on a line, string-aware so an
 * `https://` inside a literal survives. The prescribed stripper deliberately
 * leaves these (it only drops whole-comment lines); one check below needs them
 * gone, because a dead spelling in a changelog note is not live code.
 */
function stripTrailingLineComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { const e = skipString(src, i); out += src.slice(i, e + 1); i = e; continue; }
    if (c === "/" && src[i + 1] === "/") { const n = src.indexOf("\n", i); if (n < 0) break; i = n - 1; continue; }
    out += c;
  }
  return out;
}

/**
 * The same, but BLANKED rather than removed: every comment character becomes a
 * space, so `LIVE` below indexes identically to `CODE` while no expression
 * inside a trailing comment can be read as live code. Offsets have to survive,
 * because the resolvers below follow an identifier back to the declaration that
 * most recently precedes a write site's offset.
 */
function blankTrailingLineComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { const e = skipString(src, i); out += src.slice(i, e + 1); i = e; continue; }
    if (c === "/" && src[i + 1] === "/") {
      const n = src.indexOf("\n", i);
      const end = n < 0 ? src.length : n;
      out += " ".repeat(end - i);
      i = end - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Split the inside of a bracketed span into top-level comma-separated pieces. */
function topLevelPieces(inner: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(inner, i); continue; }
    if (c === "/" && inner[i + 1] === "/") { const n = inner.indexOf("\n", i); i = n < 0 ? inner.length : n; continue; }
    if (c === "(" || c === "{" || c === "[") { i = matchBracket(inner, i) - 1; continue; }
    if (c === ",") { out.push(inner.slice(start, i)); start = i + 1; }
  }
  out.push(inner.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/* ───────────────────── side A: the columns the migrations declare ─────────*/

/**
 * Every column each table has, unioned across CREATE TABLE bodies and every
 * ALTER TABLE ... ADD COLUMN in the whole migration directory. A column added
 * by a later migration counts, which is how took_ms and origin_basis are here.
 */
function migrationColumns(): Map<string, Set<string>> {
  const cols = new Map<string, Set<string>>();
  const add = (t: string, c: string) => {
    if (!cols.has(t)) cols.set(t, new Set());
    cols.get(t)!.add(c);
  };
  const SKIP = /^(primary|constraint|unique|check|foreign|exclude|like)$/i;

  for (const sql of SQL_CODE) {
    const create = /CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)\s*\(/g;
    for (let m = create.exec(sql); m; m = create.exec(sql)) {
      const open = sql.indexOf("(", m.index + m[0].length - 1);
      const body = sql.slice(open + 1, matchBracket(sql, open) - 1);
      for (const piece of topLevelPieces(body)) {
        const name = /^(\w+)/.exec(piece.replace(/^[\s\r\n]*/, ""))?.[1];
        if (name && !SKIP.test(name)) add(m[1], name);
      }
    }
    // One ALTER TABLE statement can carry many ADD COLUMNs, on one table.
    const alter = /ALTER TABLE (?:ONLY )?public\.(\w+)([\s\S]*?);/g;
    for (let m = alter.exec(sql); m; m = alter.exec(sql)) {
      const addcol = /ADD COLUMN (?:IF NOT EXISTS )?(\w+)/g;
      for (let a = addcol.exec(m[2]); a; a = addcol.exec(m[2])) add(m[1], a[1]);
    }
  }
  return cols;
}

const COLUMNS = migrationColumns();

/* ────────────── side B: the columns index.ts actually names in a write ────*/

type Site = {
  table: string;
  op: "insert" | "upsert";
  at: number;
  /** [statement start, statement end] — the error check may sit just after. */
  window: string;
  /** The first argument to insert()/upsert(): the row or rows expression. */
  rowExpr: string;
};

/** The tables the .61 collection pass writes from job-board/index.ts. */
const WRITTEN_TABLES = [
  "job_board_field_changes",
  "job_board_board_state",
  "job_board_exits",
  "job_board_closures",
  "job_board_search_clicks",
  "job_board_search_events",
] as const;

/** Tables created by this pass; these carry the RLS / no-anon obligation. */
const NEW_TABLES = [
  "job_board_field_changes",
  "job_board_board_state",
  "job_board_company_dim_snapshots",
  "job_board_exit_rollup",
  "job_board_search_rollup",
  "job_board_click_rollup",
] as const;

/**
 * A write site is `.from("<table>")` followed by `.insert(` or `.upsert(`.
 * Found in CODE, so a call that only exists in a comment is not a site — the
 * exact confusion that has made seven guards in this repo pass over dead code.
 */
function writeSites(src: string, table: string): Site[] {
  const sites: Site[] = [];
  // QUOTE-AGNOSTIC. This keyed on the double-quoted spelling alone, so an insert
  // written .from('job_board_exits') was not a write path AT ALL — invisible to
  // the origin_basis check, the column check and the error check simultaneously.
  // Proved by mutation: a single-quoted bypass insert with no origin_basis, no
  // helper and no strip-and-retry left this suite fully green. There is no
  // formatter gate in package.json or CI to make the double quote inevitable,
  // so the quote style is a convention, and a guard must not depend on one.
  const fromRe = new RegExp(`\\.from\\(\\s*["'\`]${table.replace(/[.*+?^$\\{}()|[\]]/g, "\\$&")}["'\`]\\s*\\)`, "g");
  for (const fm of src.matchAll(fromRe)) {
    const i = fm.index!;
    const from = fm[0];
    const after = src.slice(i + from.length, i + from.length + 40);
    const m = /^\s*\.(insert|upsert)\s*\(/.exec(after);
    if (!m) continue;
    const callOpen = i + from.length + m[0].length - 1;
    const callEnd = matchBracket(src, callOpen);
    const rowExpr = topLevelPieces(src.slice(callOpen + 1, callEnd - 1))[0] ?? "";
    sites.push({ table, op: m[1] as "insert" | "upsert", at: i, window: statementWindow(src, i, callEnd), rowExpr });
  }
  return sites;
}

/**
 * The text a write's error check can live in: from the start of the LINE the
 * call sits on, through the end of its statement, plus a short tail.
 *
 * Shared with the insertExits(...) call sites, whose error arrives as a
 * RETURNED value exactly like an insert's and can go unchecked exactly as
 * silently.
 */
function statementWindow(src: string, at: number, callEnd: number): string {
  {
    // Back up to the start of the LINE the `.from(` sits on, not to the
    // nearest `;`/`{`/`}`. The shape this file uses most is
    // `const { error: rawErr } = await client.from(t).insert(rows);` — every
    // one of those characters appears inside the destructuring pattern itself,
    // so a bracket-based clamp lands past the very binding being looked for,
    // and a line is a tighter window than any of them anyway.
    const start = src.lastIndexOf("\n", at) + 1;
    // Forward to the end of the statement, then a little further — the check
    // can be a `.then(({ error }) => ...)` inside the same statement, or an
    // `if (insErr)` on the line below it after the error is handed to
    // settleInsertError. The tail STOPS AT THE NEXT ERROR DESTRUCTURE outside
    // this statement, whatever the 400-character budget says. Verified by
    // mutation: without that cut, deleting the field-change site's own
    // `if (error) console.warn(...)` still passed, because the very next
    // statement is `let { error } = await client.from("job_board_postings")`
    // and its binding drifted into the window and answered for a site that had
    // swallowed its error — the exact failure this test exists to catch.
    let end = callEnd;
    for (let j = callEnd; j < src.length && j < callEnd + 4000; j++) {
      const c = src[j];
      if (c === '"' || c === "'" || c === "`") { j = skipString(src, j); continue; }
      if (c === "(" || c === "{" || c === "[") { j = matchBracket(src, j) - 1; continue; }
      if (c === ";") { end = j; break; }
    }
    const foreign = /\{\s*error\s*(?::\s*[A-Za-z_$][\w$]*)?\s*[,}]/g;
    foreign.lastIndex = end;
    const next = foreign.exec(src)?.index ?? -1;
    const tail = Math.min(end + 400, next < 0 ? src.length : next);
    return src.slice(start, Math.max(tail, callEnd));
  }
}

/** Top-level keys of the object literal whose `{` is at `open`, plus spreads. */
function literalKeys(src: string, open: number): { keys: string[]; spreads: string[] } {
  const keys: string[] = [];
  const spreads: string[] = [];
  for (const piece of topLevelPieces(src.slice(open + 1, matchBracket(src, open) - 1))) {
    if (piece.startsWith("...")) { spreads.push(piece.slice(3).trim()); continue; }
    const k = /^(?:"([\w$]+)"|'([\w$]+)'|([\w$]+))\s*(?::|$)/.exec(piece);
    const name = k?.[1] ?? k?.[2] ?? k?.[3];
    if (name) keys.push(name);
  }
  return { keys, spreads };
}

/** Union the keys of every object literal appearing anywhere in `expr`. */
function keysOfEveryLiteralIn(expr: string, sink: Set<string>, unresolved: Set<string>) {
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(expr, i); continue; }
    if (c === "{") {
      const { keys, spreads } = literalKeys(expr, i);
      keys.forEach((k) => sink.add(k));
      spreads.forEach((s) => unresolved.add(s));
      i = matchBracket(expr, i) - 1;
    }
  }
}

/**
 * Resolve a row expression to the set of column names it will POST. Handles
 * the four shapes this file uses — an inline literal, `rows.map(builder)`, a
 * bare identifier, and a spread of a helper — by following the identifier back
 * to the `const` that most recently precedes the write site.
 *
 * Anything it cannot follow is reported in `unresolved` rather than silently
 * skipped, and the test pins that set: a new unfollowable shape fails here
 * instead of quietly shrinking the guard's coverage to nothing.
 */
function resolveRowColumns(expr: string, before: number, seen = new Set<string>()): {
  keys: Set<string>;
  unresolved: Set<string>;
} {
  const keys = new Set<string>();
  const unresolved = new Set<string>();
  const e = expr.trim();

  const absorb = (r: { keys: Set<string>; unresolved: Set<string> }) => {
    r.keys.forEach((k) => keys.add(k));
    r.unresolved.forEach((u) => unresolved.add(u));
  };

  if (e.startsWith("{")) {
    const { keys: ks, spreads } = literalKeys(e, 0);
    ks.forEach((k) => keys.add(k));
    for (const s of spreads) absorb(resolveRowColumns(s, before, seen));
    return { keys, unresolved };
  }

  // `rows.map(exitRow)` / `agedRows.map(agedExitRow)`
  const mapped = /^[\w$.]+\.map\(\s*([\w$]+)\s*\)$/.exec(e);
  if (mapped) return resolveRowColumns(mapped[1], before, seen);

  // `lifecycleFacets(r)` — a call to a helper that returns the row fragment.
  const called = /^([\w$]+)\s*\(/.exec(e);
  const bare = /^[\w$]+$/.test(e) ? e : null;
  const ident = bare ?? (called && called[0].length === e.indexOf("(") + 1 ? called[1] : null);

  if (ident) {
    if (seen.has(ident)) return { keys, unresolved };
    seen.add(ident);
    const decl = declarationOf(ident, before);
    if (!decl) { unresolved.add(ident); return { keys, unresolved }; }
    absorb(resolveRowColumns(decl, before, seen));
    return { keys, unresolved };
  }

  // A parenthesised expression that contains literals, e.g.
  // `...(caller ? { caller } : {})`.
  if (e.includes("{")) {
    const sink = new Set<string>();
    const spreads = new Set<string>();
    keysOfEveryLiteralIn(e, sink, spreads);
    sink.forEach((k) => keys.add(k));
    for (const s of spreads) absorb(resolveRowColumns(s, before, seen));
    return { keys, unresolved };
  }

  unresolved.add(e);
  return { keys, unresolved };
}

/**
 * The initializer expression of `ident`, taken from the `const`/`function`
 * declaration that most recently precedes `before`. Returns the object literal
 * for an arrow that returns one, the `return {...}` of a block-bodied arrow or
 * function, or — for `const chunk = changeLog.slice(...)` — the literal that
 * the array is `push`ed with.
 */
function declarationOf(ident: string, before: number): string | null {
  const src = LIVE;
  const decl = new RegExp(`(?:const|let)\\s+${ident}\\s*(?::[^=\\n]+)?=`, "g");
  let best = -1;
  for (let m = decl.exec(src); m; m = decl.exec(src)) {
    if (m.index < before) best = m.index + m[0].length; else break;
  }
  if (best < 0) {
    const fn = new RegExp(`function\\s+${ident}\\s*\\(`, "g");
    for (let m = fn.exec(src); m; m = fn.exec(src)) {
      if (m.index < before) best = m.index + m[0].length - 1; else break;
    }
    if (best < 0) return null;
    const body = src.indexOf("{", matchBracket(src, best));
    return body < 0 ? null : returnedLiteral(src, body);
  }

  const rest = src.slice(best).replace(/^\s+/, "");
  const at = best + (src.slice(best).length - rest.length);
  if (rest.startsWith("{")) return src.slice(at, matchBracket(src, at));

  // An arrow: `(r: T) => ({...})` or `(r: T) => { ... return {...} }`
  if (rest.startsWith("(")) {
    const paramsEnd = matchBracket(src, at);
    const afterArrow = src.slice(paramsEnd).replace(/^\s*(?::[^=]*?)?=>\s*/, "");
    if (afterArrow !== src.slice(paramsEnd)) {
      const bodyAt = paramsEnd + (src.slice(paramsEnd).length - afterArrow.length);
      if (src[bodyAt] === "(") {
        const inner = src.indexOf("{", bodyAt);
        return inner < 0 ? null : src.slice(inner, matchBracket(src, inner));
      }
      if (src[bodyAt] === "{") return returnedLiteral(src, bodyAt);
    }
  }

  // `const closureRows = rows.map((r) => ({...}))` — the builder is INLINE in
  // the map rather than named, so the row shape is the literal that arrow
  // returns. (The exit ledger's four builders are named; the closure log's is
  // not, and a resolver that cannot read one of the two shapes reports nothing
  // for that table while staying green.)
  const inlineMap = /^[\w$.]+\.map\s*\(/.exec(rest);
  if (inlineMap) {
    const open = at + inlineMap[0].length - 1;
    const inner = src.slice(open + 1, matchBracket(src, open) - 1);
    const arrow = inner.indexOf("=>");
    if (arrow >= 0) {
      const tailRel = inner.slice(arrow + 2);
      const trimmed = tailRel.replace(/^\s*/, "");
      const bodyAt = open + 1 + arrow + 2 + (tailRel.length - trimmed.length);
      if (src[bodyAt] === "(") {
        const b = src.indexOf("{", bodyAt);
        return b < 0 ? null : src.slice(b, matchBracket(src, b));
      }
      if (src[bodyAt] === "{") return returnedLiteral(src, bodyAt);
    }
  }

  // `const chunk = changeLog.slice(i, i + 200)` — the shape of the rows is the
  // shape of what was pushed onto the array.
  const sliced = /^([\w$]+)\.(?:slice|concat)\(/.exec(rest);
  if (sliced) {
    const push = src.lastIndexOf(`${sliced[1]}.push(`, before);
    if (push >= 0) {
      const open = src.indexOf("{", push);
      if (open >= 0 && open < push + 40) return src.slice(open, matchBracket(src, open));
    }
  }
  return null;
}

/** The first `return {...}` inside the block whose `{` is at `blockAt`. */
function returnedLiteral(src: string, blockAt: number): string | null {
  const end = matchBracket(src, blockAt);
  const body = src.slice(blockAt, end);
  const r = /\breturn\s*\{/.exec(body);
  if (!r) return null;
  const open = blockAt + r.index + r[0].length - 1;
  return src.slice(open, matchBracket(src, open));
}

/* ────────── side B′: the exit ledger, after its four inserts became one ────
 *
 * The four inline inserts are gone; four ROW BUILDERS and one insertExits()
 * helper took their place (see the header). An exit write PATH is therefore
 * either:
 *
 *   - a call to insertExits(client, <rows>, <where>) — the shape all four
 *     sites now use, whose columns are read from the builder it hands over; or
 *   - a literal `.from("job_board_exits").insert(` that does NOT sit inside
 *     that helper — i.e. a site that bypassed the shared retry, which is the
 *     pre-merge shape and is still scanned so it cannot come back unnoticed.
 *
 * The helper's OWN insert is deliberately not a path: its row expression is the
 * parameter `rows`, and reading columns off it is what "found nothing" looks
 * like. It is asserted, separately and by count, to be the only one.
 */

const EXIT_HELPER = "insertExits";

type ExitPath = {
  /** "helper" — through insertExits; "bypass" — a literal insert that is not. */
  kind: "helper" | "bypass";
  /** The row builder's name where there is one, for failure messages. */
  label: string;
  /** Offset of the call, so a builder resolves against what precedes IT. */
  at: number;
  /** The rows expression handed to the write: `rows.map(exitRow)`, a literal… */
  rowExpr: string;
  /** Line-anchored window in which this write's error must be checked. */
  window: string;
};

/**
 * Span of a TOP-LEVEL `function <name>(` — from the declaration to the closing
 * brace in column 0. Not bracket-matched from the parameter list, because the
 * return type annotation of this very helper (`Promise<{ error: … }>`) contains
 * a brace that a naive "first `{` after the parameters" would land on.
 */
function topLevelFunctionSpan(name: string, src: string): { start: number; end: number } | null {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return null;
  const close = src.indexOf("\n}", m.index);
  return { start: m.index, end: close < 0 ? src.length : close + 2 };
}

/** Every path that puts a row into job_board_exits. */
function exitWritePaths(src: string = LIVE): ExitPath[] {
  const paths: ExitPath[] = [];
  const span = topLevelFunctionSpan(EXIT_HELPER, src);

  const call = new RegExp(`\\b${EXIT_HELPER}\\s*\\(`, "g");
  for (let m = call.exec(src); m; m = call.exec(src)) {
    // The declaration itself is not a call site.
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, m.index - 24), m.index))) continue;
    const open = m.index + m[0].length - 1;
    const end = matchBracket(src, open);
    const args = topLevelPieces(src.slice(open + 1, end - 1));
    const rowExpr = args[1] ?? "";
    paths.push({
      kind: "helper",
      label: /\.map\(\s*([\w$]+)\s*\)$/.exec(rowExpr.trim())?.[1] ?? rowExpr.slice(0, 40),
      at: m.index,
      rowExpr,
      window: statementWindow(src, m.index, end),
    });
  }

  for (const site of writeSites(src, "job_board_exits")) {
    if (span && site.at > span.start && site.at < span.end) continue; // the helper's own
    paths.push({
      kind: "bypass",
      label: /\.map\(\s*([\w$]+)\s*\)$/.exec(site.rowExpr.trim())?.[1] ?? site.rowExpr.slice(0, 40),
      at: site.at,
      rowExpr: site.rowExpr,
      window: site.window,
    });
  }
  return paths;
}

/** The literal `.from("job_board_exits").insert(` sites INSIDE the helper. */
function centralisedExitInserts(src: string = LIVE): Site[] {
  const span = topLevelFunctionSpan(EXIT_HELPER, src);
  if (!span) return [];
  return writeSites(src, "job_board_exits").filter((s) => s.at > span.start && s.at < span.end);
}

/**
 * The full initializer of `const <ident> = …` — the arrow INCLUDING its body,
 * not just the literal it returns. The duration checks need the body: the rule
 * is that the days and the basis come out of ONE computation, and that
 * computation is a statement above the row literal, not part of it.
 */
function initializerOf(ident: string, before: number, src: string = LIVE): string | null {
  const decl = new RegExp(`(?:const|let)\\s+${ident}\\s*(?::[^=\\n]+)?=`, "g");
  let best = -1;
  for (let m = decl.exec(src); m; m = decl.exec(src)) {
    if (m.index < before) best = m.index + m[0].length; else break;
  }
  if (best < 0) return null;
  const rest = src.slice(best).replace(/^\s+/, "");
  const at = best + (src.slice(best).length - rest.length);
  if (rest.startsWith("{")) return src.slice(at, matchBracket(src, at));
  if (rest.startsWith("(")) {
    const paramsEnd = matchBracket(src, at);
    const after = src.slice(paramsEnd).replace(/^\s*(?::[^=]*?)?=>\s*/, "");
    if (after === src.slice(paramsEnd)) return null;
    const bodyAt = paramsEnd + (src.slice(paramsEnd).length - after.length);
    if (src[bodyAt] === "{" || src[bodyAt] === "(") return src.slice(at, matchBracket(src, bodyAt));
  }
  return null;
}

/** The builder source behind an exit path's rows expression. */
function rowBuilderOf(path: ExitPath, src: string = LIVE): { name: string; body: string } | null {
  const e = path.rowExpr.trim();
  const mapped = /^[\w$.]+\.map\(\s*([\w$]+)\s*\)$/.exec(e);
  if (mapped) {
    const body = initializerOf(mapped[1], path.at, src);
    return body ? { name: mapped[1], body } : null;
  }
  // `…map((r) => ({…}))` — an inline builder is still a builder.
  const inline = /^[\w$.]+\.map\s*\(/.exec(e);
  if (inline && e.includes("=>")) {
    const open = inline[0].length - 1;
    return { name: "inline builder", body: e.slice(open + 1, matchBracket(e, open) - 1) };
  }
  if (e.startsWith("{") || e.startsWith("[")) return { name: "inline literal", body: e };
  const bare = /^[\w$]+$/.test(e) ? initializerOf(e, path.at, src) : null;
  return bare ? { name: e, body: bare } : null;
}

/**
 * `key: value` of the row literal a builder produces — the VALUE expressions,
 * which is what separates `days_on_board: t.days` from the coalesce this whole
 * pass exists to have removed. Keys alone cannot tell those apart.
 */
function rowEntries(builderBody: string): Map<string, string> {
  const r = /\breturn\s*\{/.exec(builderBody);
  let open: number;
  if (r) open = r.index + r[0].length - 1;
  else {
    const arrow = builderBody.indexOf("=>");
    open = builderBody.indexOf("{", arrow < 0 ? 0 : arrow);
  }
  if (open < 0) return new Map();
  const out = new Map<string, string>();
  for (const piece of topLevelPieces(builderBody.slice(open + 1, matchBracket(builderBody, open) - 1))) {
    const k = /^(?:"([\w$]+)"|'([\w$]+)'|([\w$]+))\s*:/.exec(piece);
    const name = k?.[1] ?? k?.[2] ?? k?.[3];
    if (name) out.set(name, piece.slice(k![0].length).trim());
  }
  return out;
}

/**
 * THE PROPERTY, NOT THE SPELLING. A row's duration and its basis must be two
 * reads of ONE computation bound in the builder — `const t = tenureDays(…)`
 * today — and the duration must not be assembled from the raw clocks at the
 * row literal, which is exactly what `(posted_at ?? first_seen)` was.
 *
 * Nothing here pins the helper's name: a builder that computes both from some
 * other single call passes, and one that hardcodes `origin_basis: 'stated'`
 * beside a duration measured from something else does not.
 */
function durationVerdict(body: string): { ok: boolean; why: string } {
  const e = rowEntries(body);
  const days = e.get("days_on_board");
  const basis = e.get("origin_basis");
  if (days === undefined) return { ok: false, why: "the row names no days_on_board" };
  if (basis === undefined) return { ok: false, why: "the row names no origin_basis" };
  if (/\?\?|\bcoalesce\b/i.test(days)) {
    return { ok: false, why: `days_on_board coalesces: \`${days}\`` };
  }
  if (/\b(posted_at|first_seen)\b/.test(days)) {
    return { ok: false, why: `days_on_board reads a raw clock instead of a stamped duration: \`${days}\`` };
  }
  const root = /^([\w$]+)\s*\./.exec(days)?.[1];
  const basisRoot = /^([\w$]+)\s*\./.exec(basis)?.[1];
  if (!root || !basisRoot) {
    return { ok: false, why: `days_on_board (\`${days}\`) and origin_basis (\`${basis}\`) must each read a field off the duration this row computed` };
  }
  if (root !== basisRoot) {
    return { ok: false, why: `days_on_board reads \`${root}\` but origin_basis reads \`${basisRoot}\` — the duration and the clock it was measured from must come from one computation, or the flag can disagree with the number it labels` };
  }
  if (!new RegExp(`(?:const|let)\\s+${root}\\s*=\\s*[\\w$.]+\\s*\\(`).test(body)) {
    return { ok: false, why: `\`${root}\` is not bound in this builder from a single call` };
  }
  return { ok: true, why: "" };
}

/* ─────────────────────── property 1: the error is checked ─────────────────*/

/**
 * supabase-js RETURNS errors rather than throwing, so `client.from(t).insert(x)`
 * with no destructure is a no-op that reads exactly like a success. A checked
 * site declares an error binding — `{ error }` or `{ error: rawErr }` — and
 * then USES that binding: a destructure nobody reads is the same silence.
 */
function errorIsChecked(window: string): { ok: boolean; bindings: string[] } {
  const bindings: string[] = [];
  const re = /\{\s*error\s*(?::\s*([A-Za-z_$][\w$]*))?\s*[,}]/g;
  for (let m = re.exec(window); m; m = re.exec(window)) bindings.push(m[1] ?? "error");
  const used = bindings.filter((b) => {
    const uses = window.match(new RegExp(`\\b${b}\\b`, "g"))?.length ?? 0;
    return uses >= 2;
  });
  return { ok: used.length > 0, bindings };
}

/* ──────────────────────────────── the tests ──────────────────────────────*/

describe("a table nothing reads yet is still load-bearing", () => {
  it("the source scanners actually found the collection writes", () => {
    // If the parsers silently matched nothing, every property below would pass
    // vacuously — the exact way a structural guard rots into decoration.
    const found = WRITTEN_TABLES.map((t) => [t, writeSites(LIVE, t).length] as const);
    for (const [table, n] of found) {
      expect(n, `no ${table} insert/upsert found in the COMMENT-STRIPPED source of job-board/index.ts. Either the write was removed, or it now only exists in a comment.`).toBeGreaterThan(0);
    }

    // THE EXIT LEDGER, IN ITS POST-MERGE SHAPE. One literal insert, inside the
    // shared helper; four call sites reaching it. Both halves are pinned,
    // because either one alone can rot into a guard that reads nothing: a
    // helper with no callers, or callers whose helper stopped inserting.
    expect(
      topLevelFunctionSpan(EXIT_HELPER, LIVE),
      `no top-level ${EXIT_HELPER}() in job-board/index.ts. The exit ledger's four write sites share one insert (and one strip-and-retry) through it; if that helper is gone, this whole scanner is looking for a shape that no longer exists — re-point it at the shape that replaced it rather than deleting the property.`,
    ).toBeTruthy();
    expect(
      centralisedExitInserts(LIVE).length,
      "the shared exit helper must hold exactly one literal insert into job_board_exits — it is the single write path, and its retry is the only thing standing between a not-yet-applied migration and a silently empty ledger.",
    ).toBe(1);

    const paths = exitWritePaths(LIVE);
    // The four exit write sites are the ones item 4 exists for: three of them
    // were feeding mixed-clock durations into a censoring input. A FLOOR, not
    // an equality: a fifth path is not a defect by itself, and pinning the
    // count would make the per-path checks below report the wrong failure for
    // one. Dropping below four IS a defect — a path stopped logging exits.
    expect(
      paths.length,
      `the exit ledger is written from four paths (whole-board, aged-out, removed, freshness sweep); ${paths.length} found. A path that stops writing loses censoring observations that cannot be recollected — the posting row is hard-deleted moments later.`,
    ).toBeGreaterThanOrEqual(4);
    // Four DISTINCT builders: four call sites all handing over the same rows
    // would satisfy a bare count while three paths log nothing.
    expect(
      new Set(paths.map((p) => p.label)).size,
      `the four exit paths must hand over four distinct row builders; saw [${paths.map((p) => p.label).join(", ")}]`,
    ).toBeGreaterThanOrEqual(4);
    // ...and every one of them must be READABLE. A path whose builder cannot be
    // followed is checked by nothing below, which is how this class of guard
    // dies: green, and blind.
    for (const p of paths) {
      const builder = rowBuilderOf(p, LIVE);
      expect(
        builder,
        `the rows handed to the exit write at offset ${p.at} (\`${p.rowExpr.slice(0, 60)}\`) resolve to no row builder this scanner can read, so origin_basis and the column names at that path are checked by nothing. Extend rowBuilderOf for the new shape — a path it cannot read must never be a path it ignores.`,
      ).toBeTruthy();
      expect(
        rowEntries(builder!.body).size,
        `the exit row builder ${p.label} produced no columns`,
      ).toBeGreaterThan(5);
    }
    for (const t of NEW_TABLES) {
      expect(COLUMNS.get(t)?.size ?? 0, `no CREATE TABLE for ${t} was parsed out of supabase/migrations`).toBeGreaterThan(2);
    }
  });

  it("every insert into a table this pass writes checks its { error }", () => {
    for (const table of WRITTEN_TABLES) {
      for (const site of writeSites(LIVE, table)) {
        const { ok, bindings } = errorIsChecked(site.window);
        expect(
          ok,
          `an unchecked ${site.op} into ${table}. supabase-js RETURNS errors — it never throws — so this write can fail forever and read as a success. ` +
            `Bindings seen: [${bindings.join(", ")}]. Destructure the error and act on it (log it; these are best-effort writes and must never fail the pass).\n` +
            `--- site ---\n${site.window.slice(0, 400)}`,
        ).toBe(true);
      }
    }
    // The exit helper RETURNS the error its insert (and its retry) ended with,
    // so a call site that ignores it is the same silence one indirection out —
    // and after centralising, every exit write in the file is such a call.
    for (const p of exitWritePaths(LIVE)) {
      if (p.kind !== "helper") continue;
      const { ok, bindings } = errorIsChecked(p.window);
      expect(
        ok,
        `the ${EXIT_HELPER}(…) call at offset ${p.at} (${p.label}) never reads the error it returns. The helper strips optional columns and retries, then hands back whatever survived; dropping that is how the ledger goes empty for a deploy window with nothing in the logs. ` +
          `Bindings seen: [${bindings.join(", ")}].\n--- site ---\n${p.window.slice(0, 400)}`,
      ).toBe(true);
    }
  });

  it("every column an insert names exists in the migrations", () => {
    // BOTH SIDES ARE PARSED. The left comes from the object literals index.ts
    // posts; the right from CREATE TABLE and ADD COLUMN across every
    // migration. Rename either and this fails — which is the cross-artifact
    // mismatch three independent builders are most likely to leave behind,
    // and PostgREST fails the WHOLE statement on one unknown column, so the
    // event is not degraded, it is deleted.
    const unresolved = new Set<string>();
    let checked = 0;
    for (const table of WRITTEN_TABLES) {
      const declared = COLUMNS.get(table);
      expect(declared, `no migration declares columns for ${table}`).toBeTruthy();
      // For job_board_exits the columns live in the four ROW BUILDERS, not in
      // the one literal insert, whose row expression is the helper's `rows`
      // parameter. Reading that parameter is how this check would find nothing
      // and pass — so the paths replace the site here.
      const reads = table === "job_board_exits"
        ? exitWritePaths(LIVE).map((p) => ({ what: `${p.kind} exit write via ${p.label}`, at: p.at, rowExpr: p.rowExpr }))
        : writeSites(LIVE, table).map((s) => ({ what: `${s.op}`, at: s.at, rowExpr: s.rowExpr }));
      for (const site of reads) {
        const r = resolveRowColumns(site.rowExpr, site.at);
        r.unresolved.forEach((u) => unresolved.add(u));
        expect(
          r.keys.size,
          `could not resolve any column for the ${table} ${site.what} at offset ${site.at} (row expression: \`${site.rowExpr.slice(0, 80)}\`). The guard must not pass by seeing nothing.`,
        ).toBeGreaterThan(0);
        for (const key of r.keys) {
          checked++;
          expect(
            declared!.has(key),
            `job-board/index.ts writes "${key}" into ${table} (${site.what}), and no migration declares that column. ` +
              `PostgREST rejects the whole statement on an unknown column, so this does not write a thinner row — it writes nothing, silently, into a table nothing reads yet. ` +
              `Declared: ${[...declared!].sort().join(", ")}`,
          ).toBe(true);
        }
      }
    }
    // 165 column names across every write path this scans, over the same six
    // tables the pre-merge shape checked 147 across: the exit ledger's four
    // builders now resolve through their call sites rather than through four
    // inline inserts, and the closure log's inline `rows.map((r) => ({…}))`
    // builder resolves at all. The floor is not a target — it is here so a
    // resolver that quietly stops following a shape cannot turn this test green
    // by checking nothing.
    expect(checked, "the column check verified almost nothing — the resolver stopped following the row shapes").toBeGreaterThan(140);

    // THE ONE SHAPE THE RESOLVER CANNOT FOLLOW, PINNED. `stamps` is the
    // parameter of the arrow the click stamps resolve into, so it has no
    // declaration to follow. It is allowed BY NAME and its columns are checked
    // explicitly below; anything else appearing here is a new blind spot and
    // must fail rather than quietly shrink this test's reach.
    expect(
      [...unresolved].sort(),
      "a row expression this guard cannot follow was added. Extend resolveRowColumns (or add an explicit check like the click stamps below) — do not widen the allowlist and move on.",
    ).toEqual(["stamps"]);
  });

  it("the click stamps name real columns, and stamp what the column means", () => {
    // Checked by hand because they are built inside a promise chain rather
    // than a row literal — the one hole in the resolver above.
    const decl = CODE.indexOf("const clickStamps");
    expect(decl, "the click-stamp lookup is gone").toBeGreaterThan(0);
    const region = CODE.slice(decl, CODE.indexOf('.from("job_board_search_clicks")', decl) + 800);
    const declared = COLUMNS.get("job_board_search_clicks")!;
    for (const col of ["company_token", "category", "salary_present"]) {
      expect(region, `the click no longer stamps ${col}. Posting rows are DELETED at closure, so a click on a role that closes tonight loses its company forever.`).toContain(`${col}:`);
      expect(declared.has(col), `job_board_search_clicks.${col} is written but not declared`).toBe(true);
    }
    // salary_present means "this listing disclosed pay" — the structured
    // column, not the free-text one, or "Competitive" counts as disclosure and
    // an immutable rollup freezes that in.
    expect(
      region,
      "salary_present must be derived from salary_min_annual (the disclosure the column claims), not from the free-text salary string.",
    ).toMatch(/salary_present:\s*[\w.]*salary_min_annual\s*!=\s*null/);
  });

  it("the exit ledger's prune refuses to delete a period it has not summarised", () => {
    // job_board_exits was on a bare DELETE at 90 days with no rollup, while
    // job_board_closures had had roll-up-before-prune since 20260727. The
    // ledger's oldest rows are from 2026-07-26, so the FIRST IRREVERSIBLE LOSS
    // WAS DATED 2026-10-24: age-outs are both the ghost rate's numerator and
    // the hiring-health model's censoring observations.
    const live = liveDefinitionOf("roll_up_and_prune_exits");
    expect(live.body, "roll_up_and_prune_exits has no definition in supabase/migrations").not.toBe("");
    expect(guardsPruneWithRollup(live.body, "job_board_exits", "job_board_exit_rollup"), `${live.file}: the prune must delete only rows that already have a summary row — DELETE ... WHERE EXISTS (SELECT 1 FROM the rollup ...). Without the EXISTS this is the bare delete again, and the ledger dies ahead of its summary.`).toBe(true);

    // MIRRORING THE CLOSURE PATTERN IS THE POINT, so the pattern it mirrors is
    // asserted too: if roll_up_and_prune_closures ever loses the property, the
    // instruction "mirror it" stops meaning anything.
    const closures = liveDefinitionOf("roll_up_and_prune_closures");
    expect(guardsPruneWithRollup(closures.body, "job_board_closures", "job_board_closure_rollup"), `${closures.file}: the closure prune lost its roll-up-first guard`).toBe(true);

    // The bare cron job must be UNSCHEDULED, not merely joined by a safe one:
    // leaving it installed keeps the 2026-10-24 deadline exactly where it was.
    const all = SQL_CODE.join("\n");
    expect(all, "the bare 90-day delete job on job_board_exits must be unscheduled by name").toContain("cron.unschedule('job-board-exits-retention')");
    // ...and nothing may reinstate a delete that has no summary behind it.
    const bare = /cron\.schedule\(\s*'[^']*'[^)]*?\$job\$\s*DELETE FROM public\.job_board_exits\b/gi;
    const reinstated = MIGRATION_FILES.filter((f, i) => bare.test(SQL_CODE[i]) && f > "20260906218000");
    expect(reinstated, "a bare DELETE on job_board_exits was scheduled after the rollup landed").toEqual([]);
  });

  it("every table this pass created has RLS on and no anon grant", () => {
    // The lifecycle log was anon-readable for its first 35 days. These tables
    // hold employer-level history nobody else has; the default is no access.
    const all = SQL_CODE.join("\n");
    for (const table of NEW_TABLES) {
      expect(all, `${table} must ENABLE ROW LEVEL SECURITY`).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
      const grants = grantsOn(all, table);
      const leaked = grants.filter((g) => /\b(anon|authenticated|public)\b/i.test(g.to));
      expect(leaked.map((g) => g.to), `${table} is granted to a public role. New collection tables are service_role only — the closure log's 35 anon-readable days were an incident.`).toEqual([]);
      expect(grants.some((g) => /service_role/.test(g.to)), `${table} has no service_role grant, so the collector cannot write it`).toBe(true);
      // RLS with no policy denies everyone; a policy would have to be read.
      expect(all, `${table} gained an RLS policy — a new collection table should have none`).not.toMatch(new RegExp(`CREATE POLICY[^;]*ON public\\.${table}\\b`));
    }
  });

  it("the durations and the diffs say, in prose, which clock they came from", () => {
    // ASSERTED AGAINST RAW SQL ON PURPOSE: these are column comments, and a
    // column comment is prose that ships to the database. A stored duration
    // must NAME its origin basis — a "2.8-day median" once shipped measured
    // from our own discovery date.
    const rawAll = SQL_RAW.join("\n");
    expect(rawAll, "job_board_exits.origin_basis needs a comment saying what 'stated' and 'discovered' are measured from").toMatch(/COMMENT ON COLUMN public\.job_board_exits\.origin_basis IS[\s\S]{0,900}?discovered/);
    expect(rawAll, "the origin_basis comment must say what a NULL means — it is not a third basis").toMatch(/COMMENT ON COLUMN public\.job_board_exits\.origin_basis IS[\s\S]{0,900}?NULL/);
    expect(rawAll, "job_board_field_changes.observed_at is OUR observation time and its comment must say so — it is not when the employer made the edit").toMatch(/COMMENT ON COLUMN public\.job_board_field_changes\.observed_at IS[\s\S]{0,600}?(OUR OBSERVATION TIME|our observation)/i);

    // And the code side of the same rule, at every exit write path: every row
    // carries origin_basis, and none of them rebuilds the coalesce. Read off
    // the ROW BUILDERS, because that is where a row is now assembled — the one
    // insert left in the file names no column at all.
    const paths = exitWritePaths(LIVE);
    expect(
      paths.length,
      "no exit write path was found at all — this check must never pass by scanning nothing",
    ).toBeGreaterThanOrEqual(4);
    for (const p of paths) {
      const cols = resolveRowColumns(p.rowExpr, p.at).keys;
      expect(
        cols.has("origin_basis"),
        `the exit row built by ${p.label} (${p.kind} path at offset ${p.at}) does not stamp origin_basis. Three of these four paths were writing (posted_at ?? first_seen) into days_on_board with no flag, and those rows are the censoring input of the hiring-health model built to remove exactly that error.`,
      ).toBe(true);
      expect(cols.has("days_on_board"), `an exit row without a duration (${p.label})`).toBe(true);

      // The KEYS only prove both names are present. The VALUES prove they mean
      // what the columns claim: one duration, one clock, computed together.
      const builder = rowBuilderOf(p, LIVE);
      expect(builder, `the row builder behind ${p.label} could not be read`).toBeTruthy();
      const verdict = durationVerdict(builder!.body);
      expect(
        verdict.ok,
        `the exit row built by ${p.label} does not measure its duration and name its clock in one place — ${verdict.why}. ` +
          `A days_on_board that coalesces posted_at with first_seen is unrecoverable once the posting row is deleted, and a basis that comes from anywhere but the same computation can label the number wrongly, which is worse than no label.`,
      ).toBe(true);
    }
    // THE COALESCE ITSELF, ASSERTED AGAINST A HARDER STRIP THAN THE PRESCRIBED
    // ONE. `posted_at ?? first_seen` still appears three times in this file:
    // twice in comments the standard stripper removes, and once in a TRAILING
    // comment on the BUILD_VERSION line, which it does not — that line starts
    // with `const`. Checking CODE would fail on a changelog note; checking RAW
    // would fail on prose. Only a string-aware strip of trailing comments
    // leaves the actual expression, which is the thing that must be gone.
    expect(
      stripTrailingLineComments(CODE),
      "the per-row mixed clock is back: a duration is being measured from posted_at-or-first_seen with nothing recording which. Compute it through tenureDays, which returns the basis alongside the days.",
    ).not.toMatch(/posted_at\s*\?\?\s*[\w.]*first_seen/);
  });
});

/* ───────────────────────────── shared helpers ────────────────────────────*/

/** The last migration that defines a function is its live definition. */
function liveDefinitionOf(fn: string): { file: string; body: string } {
  let file = "";
  let body = "";
  MIGRATION_FILES.forEach((f, i) => {
    const idx = SQL_CODE[i].indexOf(`FUNCTION public.${fn}(`);
    if (idx < 0) return;
    const end = SQL_CODE[i].indexOf("\n$$;", idx);
    file = f;
    body = end > idx ? SQL_CODE[i].slice(idx, end) : SQL_CODE[i].slice(idx);
  });
  return { file, body };
}

/**
 * True when every DELETE the body issues against `table` is gated on an EXISTS
 * over `rollup` — i.e. it can only remove rows a summary already covers.
 */
function guardsPruneWithRollup(body: string, table: string, rollup: string): boolean {
  const re = new RegExp(`DELETE FROM (?:public\\.)?${table}\\b`, "g");
  let any = false;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    any = true;
    const stmt = body.slice(m.index, body.indexOf(";", m.index) + 1 || body.length);
    if (!/\bEXISTS\s*\(/i.test(stmt)) return false;
    if (!new RegExp(`FROM\\s+public\\.${rollup}\\b`, "i").test(stmt)) return false;
  }
  return any;
}

/** Every GRANT in `sql` whose object is exactly `public.<table>`. */
function grantsOn(sql: string, table: string): Array<{ priv: string; to: string }> {
  const out: Array<{ priv: string; to: string }> = [];
  const re = new RegExp(`GRANT\\s+([\\s\\S]*?)\\s+ON\\s+(?:TABLE\\s+)?public\\.${table}\\s+TO\\s+([^;]+);`, "gi");
  for (let m = re.exec(sql); m; m = re.exec(sql)) out.push({ priv: m[1].trim(), to: m[2].trim() });
  return out;
}

/* ─────────────────────────────── has teeth ───────────────────────────────
 * Every check above is run against a source that carries the PRE-FIX spelling,
 * and must fail. A guard that has never been seen to fail is a guard nobody
 * knows the polarity of.
 * ─────────────────────────────────────────────────────────────────────────*/

describe("a table nothing reads yet is still load-bearing — has teeth", () => {
  it("the error check fails on the unchecked insert this repo used to write", () => {
    const unchecked = `
      const rows = vanished.map(exitRow);
      waitUntil(client.from("job_board_exits").insert(rows).catch(() => {}));
    `;
    const site = writeSites(unchecked, "job_board_exits")[0];
    expect(site, "the scanner failed to see a plain insert").toBeTruthy();
    expect(errorIsChecked(site.window).ok, "an insert with no error destructure must be reported").toBe(false);

    // A destructure nobody reads is the same silence, and must also fail.
    const destructuredButIgnored = `
      const { error } = await client.from("job_board_exits").insert(rows);
      logged += rows.length;
    `;
    expect(errorIsChecked(writeSites(destructuredButIgnored, "job_board_exits")[0].window).ok).toBe(false);

    // ...and the real, checked shape passes, so the check is not just strict.
    const checked = `
      const { error: rawErr } = await client.from("job_board_exits").insert(rows);
      if (rawErr) console.warn("nope", rawErr.message);
    `;
    expect(errorIsChecked(writeSites(checked, "job_board_exits")[0].window).ok).toBe(true);
  });

  it("the exit scan sees a path that bypasses the shared helper", () => {
    // The pre-merge shape: a literal insert that is not inside insertExits.
    // Centralising is better, but the guard's job is the property, not the
    // centralisation — a new site that writes the ledger directly must still be
    // scanned, not skipped for having the wrong shape.
    const bypass = `
      const { error } = await client.from("job_board_exits").insert(vanished.map(exitRow));
      if (error) console.warn(error.message);
    `;
    const seen = exitWritePaths(bypass);
    expect(seen.length, "a direct insert into the exit ledger must be seen as a write path").toBe(1);
    expect(seen[0].kind).toBe("bypass");
    expect(seen[0].label, "the builder behind the bypassing insert must be named").toBe("exitRow");

    // And a call through the helper is a path too, with the builder it hands over.
    const viaHelper = `
      waitUntil(Promise.resolve(insertExits(client, agedRows.map(agedExitRow), s.token)).then(({ error }) => {
        if (error) console.warn(error.message);
      }));
    `;
    const helperPaths = exitWritePaths(viaHelper);
    expect(helperPaths.map((p) => [p.kind, p.label])).toEqual([["helper", "agedExitRow"]]);
    expect(errorIsChecked(helperPaths[0].window).ok, "the returned error IS read here").toBe(true);

    // ...and the same call with the error thrown away must be reported.
    const swallowed = `
      waitUntil(Promise.resolve(insertExits(client, agedRows.map(agedExitRow), s.token)).catch(() => {}));
    `;
    expect(errorIsChecked(exitWritePaths(swallowed)[0].window).ok, "an insertExits call that never reads its returned error must fail").toBe(false);
  });

  it("the duration check fails on the mixed clock the four sites used to write", () => {
    // The exact pre-fix builder: a coalesce, and no column saying which clock
    // won. This is the row that fed the hiring-health model's censoring input.
    const preFix = `(r) => {
      return {
        posting_id: String(r.id),
        days_on_board: r.posted_at ?? r.first_seen,
        exited_at: exitedAt,
      };
    }`;
    expect(durationVerdict(preFix).ok, "a row with no origin_basis must be rejected").toBe(false);
    expect(durationVerdict(preFix).why).toContain("origin_basis");

    // Stamped, but still coalesced — the half-fix, which reads clean and is not.
    const stamped = `(r) => {
      const t = tenureDays(r.posted_at, r.first_seen, exitedAt);
      return { days_on_board: r.posted_at ?? r.first_seen, origin_basis: t.basis };
    }`;
    expect(durationVerdict(stamped).ok, "a coalesced duration beside a basis flag must be rejected").toBe(false);
    expect(durationVerdict(stamped).why).toContain("coalesces");

    // A basis that does not come from the computation that produced the number:
    // the flag would say 'stated' for a row measured from first_seen.
    const disagreeing = `(r) => {
      const t = tenureDays(r.posted_at, r.first_seen, exitedAt);
      return { days_on_board: t.days, origin_basis: "stated" };
    }`;
    expect(durationVerdict(disagreeing).ok, "a hardcoded basis must be rejected").toBe(false);

    // ...and the shipped shape passes, so the check is not merely strict.
    const real = `(r) => {
      const t = tenureDays(r.posted_at, r.first_seen, exitedAt);
      return { days_on_board: t.days, origin_basis: t.basis, exited_at: exitedAt };
    }`;
    expect(durationVerdict(real).ok, durationVerdict(real).why).toBe(true);
  });

  it("the column check fails when either artifact renames a column", () => {
    // The real field-change row, with one key renamed the way a builder who
    // never opened the migration would spell it.
    const site = writeSites(CODE, "job_board_field_changes")[0];
    const real = resolveRowColumns(site.rowExpr, site.at).keys;
    expect(real.has("old_value"), "the field-change row no longer names old_value").toBe(true);

    const declared = COLUMNS.get("job_board_field_changes")!;
    const renamed = new Set([...real].map((k) => (k === "old_value" ? "oldValue" : k)));
    const missed = [...renamed].filter((k) => !declared.has(k));
    expect(missed, "a renamed column must be reported as absent from the migrations").toEqual(["oldValue"]);

    // And the other direction: a migration that drops the column.
    const shrunk = new Set([...declared].filter((c) => c !== "old_value"));
    expect([...real].filter((k) => !shrunk.has(k)), "a column dropped on the SQL side must surface as an unknown column").toEqual(["old_value"]);
  });

  it("the prune check fails against the bare delete that shipped in 20260726052000", () => {
    const preFix = `
      FUNCTION public.roll_up_and_prune_exits(p_keep_days integer)
      BEGIN
        DELETE FROM public.job_board_exits WHERE exited_at < now() - interval '90 days';
      END;
    `;
    expect(guardsPruneWithRollup(preFix, "job_board_exits", "job_board_exit_rollup"), "the bare 90-day delete must be rejected — it is the shape that made 2026-10-24 a deadline").toBe(false);

    // A delete gated on the WRONG table's rollup is still a bare delete.
    const wrongRollup = `
      DELETE FROM public.job_board_exits e
      WHERE e.exited_at < v_cutoff
        AND EXISTS (SELECT 1 FROM public.job_board_closure_rollup rr WHERE rr.month = x);
    `;
    expect(guardsPruneWithRollup(wrongRollup, "job_board_exits", "job_board_exit_rollup")).toBe(false);

    // A function with no delete at all is not a passing prune either.
    expect(guardsPruneWithRollup("SELECT 1;", "job_board_exits", "job_board_exit_rollup")).toBe(false);
  });

  it("the RLS check fails against the anon grant the lifecycle log shipped with", () => {
    const leaky = `
      CREATE TABLE IF NOT EXISTS public.job_board_field_changes (id bigint);
      ALTER TABLE public.job_board_field_changes ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.job_board_field_changes TO anon;
      GRANT ALL ON public.job_board_field_changes TO service_role;
    `;
    const grants = grantsOn(leaky, "job_board_field_changes");
    expect(grants.length, "the grant scanner saw nothing").toBe(2);
    expect(grants.filter((g) => /\banon\b/.test(g.to)).length, "an anon grant on a collection table must be reported").toBe(1);
  });
});
