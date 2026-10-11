/**
 * EVERY MIGRATION SELF-CHECK THAT RAISES WHEN A CLIENT ROLE HOLDS A TABLE
 * PRIVILEGE, EVALUATED AGAINST WHAT THE LANE HAD DONE WHEN IT RAN.
 *
 * Lovable's staged runner refused 20261008132000 twice: its self-check raises
 * when the signed-in role can write one column of agent_passes, and live it
 * could, because Supabase gives every new public table ALL for anon,
 * authenticated and service_role, and the table's creating migration only
 * revoked from PUBLIC and anon. The pglite stand-ins never had those default
 * grants, so every local test passed. This module asks the question the live
 * database asks, without a database: replay the lane (table-acl.ts, which
 * starts every table from Supabase's defaults) up to the statement that holds
 * the check, then decide whether the role still holds the privilege.
 *
 * WHAT COUNTS AS A CHECK. A call to the table, column or any-column privilege
 * function, inside a DO block, that is a whole OR-disjunct of an IF/ELSIF
 * condition whose branch raises an exception -- directly, or by adding to an
 * accumulator that a later IF raises on. Its role must be anon or
 * authenticated. A negated call asserts the role DOES hold the privilege and
 * is skipped; so is a call under RAISE NOTICE, and one inside a function body
 * (it runs when called, not when the migration applies).
 *
 * WHAT IT RESOLVES. String literals, `'public.' || t` concatenations, and the
 * loop variables these migrations write: FOREACH over an ARRAY literal (or a
 * declared text[] holding one), FOR ... IN SELECT over unnest(ARRAY[...])
 * aliases (cross joins included), and FOR ... IN SELECT attname FROM
 * pg_attribute (every column of the table). A check whose arguments cannot be
 * resolved is reported as `unresolved`, never as passing: a guard that reads
 * nothing passes against anything.
 *
 * Comments are removed with the repository's one SQL stripper before anything
 * is read, because a migration that fixes a hole describes it in prose.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATIONS_DIR, arrayLiteralAt } from "./function-acl";
import { sqlCodeOf } from "./strip-comments";
import { PRIVS, holdsOnColumn, holdsOnTable, replayTables, type Priv, type TableState } from "./table-acl";

export type ClientRole = "anon" | "authenticated";
const CLIENT_ROLES: ClientRole[] = ["anon", "authenticated"];
const CHECK_FN = /^has_(table|column|any_column)_privilege$/i;

export type SiteKind =
  /** A raising check on a client role, every argument resolved and every table known. */
  | "evaluated"
  /** `NOT has_..._privilege(...)`: asserts the role holds it. */
  | "negated"
  /** Every role it can name is outside anon/authenticated (or the two-argument form). */
  | "not-a-client-role"
  /** Its IF branch does not raise an exception. */
  | "does-not-raise"
  /** Not a condition of an IF/ELSIF (a catalogue query, an assignment). */
  | "outside-an-if"
  /** One operand of an AND or a larger expression: holding it alone does not raise. */
  | "compound"
  /** A raising client-role check the guard could not decide. */
  | "unresolved";

export interface Combo {
  role: ClientRole;
  table: string;
  /** As written, e.g. `UPDATE` or `SELECT, INSERT` (true when any is held). */
  privilege: string;
  /** null for the table form; `*` when the check loops over every column. */
  column: string | null;
  holds: boolean;
}

export interface Site {
  file: string;
  /** The call, comments removed. */
  call: string;
  kind: SiteKind;
  reason?: string;
  combos: Combo[];
}

export interface Raise {
  file: string;
  table: string;
  role: ClientRole;
  privilege: string;
  column: string | null;
  /** The grant history of the table up to that statement. */
  history: string[];
}

export interface LaneVerdict {
  sites: Site[];
  /** Each self-check that WILL raise live: the role still holds the privilege. */
  raises: Raise[];
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** `pos` is the token's offset in the text it was read from. */
interface Tok { text: string; up: string; kind: "word" | "str" | "num" | "punct"; value: string; pos: number }

const WORD = /[A-Za-z_][\w$]*/y;
const NUM = /\d+(?:\.\d+)?/y;
const DOLLAR = /\$([A-Za-z_]\w*)?\$/y;

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  // Every push happens while `i` still points at the token's first character.
  const push = (text: string, kind: Tok["kind"], value = text) =>
    out.push({ text, up: kind === "word" ? text.toUpperCase() : text, kind, value, pos: i });
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      const prev = out[out.length - 1];
      const escaped = !!prev && prev.kind === "word" && /^[eE]$/.test(prev.text) && /[eE]/.test(s[i - 1] ?? "");
      let j = i + 1;
      let value = "";
      while (j < s.length) {
        if (escaped && s[j] === "\\") { value += s[j + 1] ?? ""; j += 2; continue; }
        if (s[j] === "'") {
          if (s[j + 1] === "'") { value += "'"; j += 2; continue; }
          break;
        }
        value += s[j];
        j++;
      }
      if (escaped) out.pop();
      push(s.slice(i, j + 1), "str", value);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      DOLLAR.lastIndex = i;
      const m = DOLLAR.exec(s);
      if (m) {
        const close = s.indexOf(m[0], i + m[0].length);
        const stop = close < 0 ? s.length : close + m[0].length;
        push(s.slice(i, stop), "str", s.slice(i + m[0].length, close < 0 ? s.length : close));
        i = stop;
        continue;
      }
    }
    if (c === '"') {
      const close = s.indexOf('"', i + 1);
      const stop = close < 0 ? s.length : close + 1;
      const name = s.slice(i + 1, stop - 1);
      out.push({ text: s.slice(i, stop), up: name.toUpperCase(), kind: "word", value: name, pos: i });
      i = stop;
      continue;
    }
    WORD.lastIndex = i;
    const w = WORD.exec(s);
    if (w) { push(w[0], "word"); i += w[0].length; continue; }
    NUM.lastIndex = i;
    const n = NUM.exec(s);
    if (n) { push(n[0], "num"); i += n[0].length; continue; }
    const two = s.slice(i, i + 2);
    if ([":=", "||", "::", "<>", ">=", "<=", "!=", "<<", ">>"].includes(two)) { push(two, "punct"); i += 2; continue; }
    push(c, "punct");
    i++;
  }
  return out;
}

const join = (ts: Tok[]) => ts.map((t) => t.text).join(" ").replace(/\s*([(),.])\s*/g, "$1").replace(/,/g, ", ");

/** Index of the `)` closing the `(` at `open`. */
function closeParen(ts: Tok[], open: number): number {
  let depth = 0;
  for (let i = open; i < ts.length; i++) {
    if (ts[i].up === "(") depth++;
    else if (ts[i].up === ")") { depth--; if (depth === 0) return i; }
  }
  return ts.length;
}

/** Split a token run on a separator at paren depth 0 (and CASE depth 0). */
function splitTop(ts: Tok[], sep: (t: Tok) => boolean): Tok[][] {
  const parts: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  let cased = 0;
  for (const t of ts) {
    if (t.up === "(") depth++;
    else if (t.up === ")") depth--;
    else if (t.kind === "word" && t.up === "CASE") cased++;
    else if (t.kind === "word" && t.up === "END" && cased > 0) cased--;
    if (depth === 0 && cased === 0 && sep(t)) { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  parts.push(cur);
  return parts;
}

function stripParens(ts: Tok[]): Tok[] {
  let r = ts;
  while (r.length >= 2 && r[0].up === "(" && closeParen(r, 0) === r.length - 1) r = r.slice(1, -1);
  return r;
}

// ---------------------------------------------------------------------------
// IF arms
// ---------------------------------------------------------------------------

/** Tokens after which a word begins a new PL/pgSQL statement. */
const STMT_START = new Set([";", "BEGIN", "THEN", "ELSE", "LOOP", ">>", "DECLARE"]);

interface Arm { condFrom: number; condTo: number; branchFrom: number; branchTo: number }

const isControlIf = (ts: Tok[], i: number) =>
  ts[i].kind === "word" && ts[i].up === "IF" && (i === 0 || STMT_START.has(ts[i - 1].up));

function arms(ts: Tok[]): Arm[] {
  const out: Arm[] = [];
  for (let i = 0; i < ts.length; i++) {
    const isElsif = ts[i].kind === "word" && (ts[i].up === "ELSIF" || ts[i].up === "ELSEIF");
    if (!isControlIf(ts, i) && !isElsif) continue;
    let j = i + 1;
    let depth = 0;
    let cased = 0;
    for (; j < ts.length; j++) {
      const u = ts[j].kind === "punct" ? ts[j].up : ts[j].kind === "word" ? ts[j].up : "";
      if (u === "(") depth++;
      else if (u === ")") depth--;
      else if (u === "CASE") cased++;
      else if (u === "END" && cased > 0) cased--;
      else if (u === "THEN" && depth === 0 && cased === 0) break;
    }
    if (j >= ts.length) continue;
    let k = j + 1;
    let level = 0;
    cased = 0;
    for (; k < ts.length; k++) {
      if (ts[k].kind !== "word") continue;
      const u = ts[k].up;
      const prev = ts[k - 1]?.up;
      if (u === "IF" && prev === "END") { if (level === 0) break; level--; continue; }
      if (isControlIf(ts, k)) { level++; continue; }
      if (u === "CASE" && prev !== "END") { cased++; continue; }
      if (u === "END" && cased > 0 && ts[k + 1]?.up !== "IF" && ts[k + 1]?.up !== "LOOP") { cased--; continue; }
      if (level === 0 && cased === 0 && (u === "ELSIF" || u === "ELSEIF" || u === "ELSE")) break;
    }
    const endIf = ts[k]?.up === "IF" && ts[k - 1]?.up === "END";
    out.push({ condFrom: i + 1, condTo: j, branchFrom: j + 1, branchTo: endIf ? k - 1 : k });
  }
  return out;
}

const QUIET = new Set(["NOTICE", "WARNING", "INFO", "LOG", "DEBUG"]);

/** Does the branch raise an exception at its own level (not inside a nested IF)? */
function branchRaises(ts: Tok[], a: Arm): boolean {
  let level = 0;
  for (let k = a.branchFrom; k < a.branchTo; k++) {
    const t = ts[k];
    if (t.kind !== "word") continue;
    if (t.up === "IF" && ts[k - 1]?.up === "END") { level--; continue; }
    if (isControlIf(ts, k)) { level++; continue; }
    if (level === 0 && t.up === "RAISE" && !QUIET.has(ts[k + 1]?.up ?? "")) return true;
  }
  return false;
}

/** Variables the branch assigns at its own level. */
function branchAssigns(ts: Tok[], a: Arm): string[] {
  const out: string[] = [];
  for (let k = a.branchFrom; k + 1 < a.branchTo; k++) {
    if (ts[k].kind === "word" && ts[k + 1].up === ":=") out.push(ts[k].up);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Variable domains
// ---------------------------------------------------------------------------

/** "ANY" is every column of the table being checked. */
type Domain = string[] | "ANY";

/** A variable's values over a stretch of the body: a loop's, or a declared constant's. */
interface Binding { name: string; domain: Domain; from: number; to: number }

class Scope {
  constructor(private readonly bindings: Binding[]) {}
  /** The innermost binding of `name` that encloses `pos`. */
  lookup(name: string, pos: number): Domain | null {
    const inside = this.bindings
      .filter((b) => b.name === name && b.from <= pos && pos < b.to)
      .sort((a, b) => (a.to - a.from) - (b.to - b.from));
    return inside[0]?.domain ?? null;
  }
}

/** Offset of the END LOOP closing the first loop that opens at or after `from`. */
function loopEnd(ts: Tok[], from: number): number {
  const open = ts.findIndex((t, k) => t.pos >= from && t.kind === "word" && t.up === "LOOP" && ts[k - 1]?.up !== "END");
  if (open < 0) return Infinity;
  let depth = 0;
  for (let k = open; k < ts.length; k++) {
    if (ts[k].kind !== "word" || ts[k].up !== "LOOP") continue;
    if (ts[k - 1]?.up === "END") { depth--; if (depth === 0) return ts[k].pos; }
    else depth++;
  }
  return Infinity;
}

function scopeOf(body: string, ts: Tok[]): Scope {
  const out: Binding[] = [];
  const add = (name: string, domain: Domain, from: number, to: number) =>
    out.push({ name: name.toUpperCase(), domain, from, to });
  const declared = new Map<string, string[]>();
  for (const m of body.matchAll(/\b(\w+)\s+(?:CONSTANT\s+)?(?:text|name|regclass)\s*\[\]\s*(?::=|DEFAULT)\s*ARRAY\s*\[/gi)) {
    declared.set(m[1].toUpperCase(), arrayLiteralAt(body, m.index! + m[0].length - 1));
  }
  for (const m of body.matchAll(/\b(\w+)\s+(?:CONSTANT\s+)?(?:text|name|regclass)\s*(?::=|DEFAULT)\s*'((?:[^']|'')*)'/gi)) {
    add(m[1], [m[2].replace(/''/g, "'")], 0, Infinity);
  }
  for (const m of body.matchAll(/\bFOREACH\s+(\w+)\s+IN\s+ARRAY\s+(ARRAY\s*\[|\w+)/gi)) {
    const to = loopEnd(ts, m.index!);
    if (/^ARRAY/i.test(m[2])) add(m[1], arrayLiteralAt(body, m.index! + m[0].length - 1), m.index!, to);
    else if (declared.has(m[2].toUpperCase())) add(m[1], declared.get(m[2].toUpperCase())!, m.index!, to);
  }
  for (const m of body.matchAll(/\bFOR\s+(\w+(?:\s*,\s*\w+)*)\s+IN\s+SELECT\b([\s\S]*?)\bLOOP\b/gi)) {
    const from = m.index!;
    const to = loopEnd(ts, from);
    const vars = m[1].split(",").map((v) => v.trim());
    const sel = m[2];
    const fromKw = /\bFROM\b/i.exec(sel);
    if (!fromKw) continue;
    const items = sel.slice(0, fromKw.index).split(",").map((x) => x.trim());
    const fromText = sel.slice(fromKw.index);
    // unnest(ARRAY[...]) [AS] alias(col) | [AS] alias
    const cols = new Map<string, string[]>();
    for (const u of fromText.matchAll(/\bunnest\s*\(\s*ARRAY\s*\[/gi)) {
      const at = u.index! + u[0].length - 1;
      const values = arrayLiteralAt(fromText, at);
      // Past the array and the unnest's closing paren.
      let depth = 0;
      let p = u.index! + u[0].indexOf("(");
      for (; p < fromText.length; p++) {
        if (fromText[p] === "(") depth++;
        else if (fromText[p] === ")") { depth--; if (depth === 0) break; }
        else if (fromText[p] === "'") p = fromText.indexOf("'", p + 1);
      }
      const after = /^\s*(?:AS\s+)?(\w+)\s*(?:\(\s*(\w+)\s*\))?/i.exec(fromText.slice(p + 1));
      if (after) cols.set((after[2] ?? after[1]).toUpperCase(), values);
    }
    const everyColumn = /\bpg_attribute\b/i.test(fromText) || /\binformation_schema\s*\.\s*columns\b/i.test(fromText);
    const domainOf = (item: string): Domain | null => {
      const im = /^(?:\w+\s*\.\s*)?(\w+)(?:\s*::\s*\w+)?(?:\s+AS\s+(\w+))?$/i.exec(item);
      if (!im) return null;
      const col = im[1].toUpperCase();
      if (everyColumn && (col === "ATTNAME" || col === "COLUMN_NAME")) return "ANY";
      return cols.get(col) ?? null;
    };
    if (vars.length === items.length) {
      vars.forEach((v, i) => { const dm = domainOf(items[i]); if (dm) add(v, dm, from, to); });
    }
    if (vars.length === 1) {
      // A record variable: r.field is the item aliased `field`.
      for (const item of items) {
        const im = /^(?:\w+\s*\.\s*)?(\w+)(?:\s*::\s*\w+)?(?:\s+AS\s+(\w+))?$/i.exec(item);
        if (!im) continue;
        const dm = domainOf(item);
        if (dm) add(`${vars[0]}.${im[2] ?? im[1]}`, dm, from, to);
      }
    }
  }
  return new Scope(out);
}

/** The values one argument at offset `pos` can take, or null when it cannot be read. */
function resolveArg(ts: Tok[], scope: Scope, pos: number): Domain | null {
  let parts: Domain[] = [];
  for (const raw of splitTop(ts, (t) => t.up === "||")) {
    let p = stripParens(raw);
    // Casts: 'x'::regclass, t::text
    const cast = p.findIndex((t) => t.up === "::");
    if (cast > 0) p = p.slice(0, cast);
    // to_regclass('x') / format-free wrappers of one argument
    if (p.length >= 3 && p[0].kind === "word" && /^TO_REGCLASS$/.test(p[0].up) && p[1].up === "(" && p[p.length - 1].up === ")") p = p.slice(2, -1);
    if (p.length === 1 && p[0].kind === "str") { parts.push([p[0].value]); continue; }
    const name = p.length === 1 && p[0].kind === "word" ? p[0].up
      : p.length === 3 && p[0].kind === "word" && p[1].up === "." && p[2].kind === "word" ? `${p[0].up}.${p[2].up}` : null;
    const bound = name ? scope.lookup(name, pos) : null;
    if (bound) { parts.push(bound); continue; }
    return null;
  }
  if (parts.length === 1) return parts[0];
  if (parts.some((x) => x === "ANY")) return null;
  let acc: string[] = [""];
  for (const v of parts as string[][]) acc = acc.flatMap((a) => v.map((b) => a + b));
  return acc;
}

function tableKey(v: string): string | null {
  const m = /^\s*(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?\s*$/.exec(v);
  if (!m) return null;
  if (m[1] && m[1].toLowerCase() !== "public") return null;
  return m[2].toLowerCase();
}

function privList(v: string): Priv[] | null {
  const ps = v.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!ps.length || ps.some((p) => !(PRIVS as string[]).includes(p))) return null;
  return ps as Priv[];
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

interface Pending { site: Site; tables: string[]; snapshot: string }

const snapshotOf = (tables: Map<string, TableState>, names: string[]) =>
  JSON.stringify(names.map((n) => {
    const t = tables.get(n);
    if (!t) return null;
    const cols = Object.fromEntries(Object.entries(t.columnGrants).map(([r, byPriv]) =>
      [r, Object.fromEntries(Object.entries(byPriv).map(([p, s]) => [p, [...(s ?? [])].sort()]))]));
    return { grants: t.grants, cols };
  }));

export function readLane(dir = MIGRATIONS_DIR): Array<{ file: string; text: string }> {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((file) => ({ file, text: readFileSync(resolve(dir, file), "utf8") }));
}

/**
 * Replay `files` in order and evaluate every privilege self-check in every DO
 * block against the state the lane had reached just before that block.
 */
export function evaluateClientHoldChecks(files: Array<{ file: string; text: string }> = readLane()): LaneVerdict {
  const sites: Site[] = [];
  const raises: Raise[] = [];
  let pending: Pending[] = [];

  const before = (stmt: string, file: string, tables: Map<string, TableState>) => {
    pending = [];
    const doM = /^DO\s*(?:LANGUAGE\s+\w+\s*)?(\$[A-Za-z_]*\$)([\s\S]*?)\1/i.exec(stmt);
    if (!doM) return;
    const body = sqlCodeOf(doM[2]);
    const ts = tokenize(body);
    const allArms = arms(ts);
    const scope = scopeOf(body, ts);

    const raisesVia = (a: Arm): boolean => {
      if (branchRaises(ts, a)) return true;
      const vars = branchAssigns(ts, a);
      return vars.some((v) => allArms.some((b) =>
        b.condFrom > a.branchTo && ts.slice(b.condFrom, b.condTo).some((t) => t.kind === "word" && t.up === v) && branchRaises(ts, b)));
    };

    for (let i = 0; i + 1 < ts.length; i++) {
      if (ts[i].kind !== "word" || !CHECK_FN.test(ts[i].text) || ts[i + 1].up !== "(") continue;
      const close = closeParen(ts, i + 1);
      const callToks = ts.slice(i, close + 1);
      const site: Site = { file, call: join(callToks), kind: "evaluated", combos: [] };
      sites.push(site);
      const done = (kind: SiteKind, reason?: string) => { site.kind = kind; site.reason = reason; };

      const arm = allArms.find((a) => i >= a.condFrom && i < a.condTo);
      if (!arm) { done("outside-an-if"); continue; }
      const disjunct = splitTop(ts.slice(arm.condFrom, arm.condTo), (t) => t.kind === "word" && t.up === "OR")
        .find((d) => d.includes(ts[i]))!;
      const bare = stripParens(disjunct);
      if (bare[0]?.up === "NOT") { done("negated"); continue; }
      if (bare.length !== callToks.length || bare[0] !== ts[i]) { done("compound", `inside: ${join(disjunct)}`); continue; }
      if (!raisesVia(arm)) { done("does-not-raise"); continue; }

      const form = CHECK_FN.exec(ts[i].text)![1].toLowerCase();
      const args = splitTop(ts.slice(i + 2, close), (t) => t.up === ",");
      const wantArgs = form === "column" ? 4 : 3;
      if (args.length !== wantArgs) { done("not-a-client-role", "the form without a role checks the migration's own user"); continue; }

      const at = ts[i].pos;
      const roleD = resolveArg(args[0], scope, at);
      if (!roleD || roleD === "ANY") { done("unresolved", `role: ${join(args[0])}`); continue; }
      const roles = roleD.map((r) => r.toLowerCase()).filter((r): r is ClientRole => (CLIENT_ROLES as string[]).includes(r));
      if (!roles.length) { done("not-a-client-role"); continue; }
      const tableD = resolveArg(args[1], scope, at);
      if (!tableD || tableD === "ANY") { done("unresolved", `table: ${join(args[1])}`); continue; }
      const privD = resolveArg(args[args.length - 1], scope, at);
      if (!privD || privD === "ANY") { done("unresolved", `privilege: ${join(args[args.length - 1])}`); continue; }
      let colD: Domain | null = null;
      if (form === "column") {
        colD = resolveArg(args[2], scope, at);
        if (!colD) { done("unresolved", `column: ${join(args[2])}`); continue; }
      }
      const columns: Array<string | null> = form === "table" ? [null] : form === "any_column" || colD === "ANY" ? ["*"] : (colD as string[]);

      const names: string[] = [];
      for (const tv of tableD) {
        const key = tableKey(tv);
        if (!key) { done("unresolved", `table outside public: ${tv}`); break; }
        const t = tables.get(key);
        if (!t) { done("unresolved", `the replay does not know a table named ${key} at this point`); break; }
        names.push(key);
        for (const role of roles) {
          for (const pv of privD) {
            const ps = privList(pv);
            if (!ps) { done("unresolved", `privilege: ${pv}`); break; }
            for (const col of columns) {
              const holds = ps.some((p) => (col === null ? holdsOnTable(t, role, p) : holdsOnColumn(t, role, col === "*" ? null : col, p)));
              site.combos.push({ role, table: key, privilege: pv, column: col, holds });
            }
          }
        }
      }
      if (site.kind !== "evaluated") { site.combos = []; continue; }
      pending.push({ site, tables: names, snapshot: snapshotOf(tables, names) });
    }
  };

  const after = (_stmt: string, file: string, tables: Map<string, TableState>) => {
    for (const p of pending) {
      // A block that grants or revokes on the table it checks: the order
      // inside the block decides, and this guard does not model it.
      if (snapshotOf(tables, p.tables) !== p.snapshot) {
        p.site.kind = "unresolved";
        p.site.reason = "the DO block itself changes the grants it checks";
        p.site.combos = [];
        continue;
      }
      for (const c of p.site.combos) {
        if (!c.holds) continue;
        if (raises.some((r) => r.file === file && r.table === c.table && r.role === c.role && r.privilege === c.privilege && r.column === c.column)) continue;
        raises.push({ file, table: c.table, role: c.role, privilege: c.privilege, column: c.column, history: [...tables.get(c.table)!.history] });
      }
    }
    pending = [];
  };

  replayTables(files, { before, after });
  return { sites, raises };
}

/** One line per raise, for failure messages. */
export function describeRaise(r: Raise): string {
  const col = r.column === null ? "" : r.column === "*" ? " (on some column)" : ` (column ${r.column})`;
  return `${r.file}: ${r.role} still holds ${r.privilege} on ${r.table}${col}, so its self-check raises live.\n    grant history: ${r.history.slice(-6).join(" | ")}`;
}
