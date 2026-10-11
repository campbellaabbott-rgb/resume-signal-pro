/**
 * WHAT anon AND authenticated CAN DO TO EACH PUBLIC TABLE, REPLAYED FROM THE
 * MIGRATION LANE.
 *
 * The companion of function-acl.ts, and built on the same model: a fresh table
 * in `public` carries Supabase's default privileges (ALL to anon,
 * authenticated and service_role), so whether the publishable key can read or
 * write it comes down to two things replayed in file order --
 *
 *   1. the table privileges left after every GRANT and REVOKE, and
 *   2. row level security: off means every privileged role sees every row;
 *      on means a role sees what a PERMISSIVE policy that applies to it lets
 *      through, and nothing when no policy applies.
 *
 * A policy applies to anon when its TO list is empty/PUBLIC or names anon;
 * likewise for authenticated. The policy's USING text is kept so a census can
 * tell `USING (true)` (every row) from `USING (auth.uid() = user_id)` (own
 * rows) -- that judgement is the reader's, this file only reports.
 *
 * TABLE PRIVILEGES AND COLUMN PRIVILEGES ARE KEPT APART, because Postgres keeps
 * them apart and the difference is what a migration gets wrong:
 *
 *   - a GRANT never takes anything away;
 *   - a column-level GRANT gives that column only, never the table privilege
 *     that `has_table_privilege` reads;
 *   - a column-level REVOKE never removes a table-level grant: a role that
 *     holds UPDATE on the table still writes the column after one;
 *   - a table-level REVOKE removes the privilege on every column as well.
 *
 * The 2026-10 agent_passes failure was the first and third together: the
 * creating migration revoked from PUBLIC and anon and granted the signed-in
 * role SELECT, so that role kept Supabase's default ALL, and a self-check that
 * a signed-in account could not write one column raised live.
 *
 * `replayTables` takes hooks that see the state before and after every
 * top-level statement, so a reader can ask what the lane had done at the
 * moment a given statement ran -- not only at the end.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATIONS_DIR, splitStatements } from "./function-acl";

export type TRole = "PUBLIC" | "anon" | "authenticated" | "service_role";
export type Cmd = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
/** Every table privilege Postgres 15 has; Supabase's default ALL is all seven. */
export type Priv = Cmd | "TRUNCATE" | "REFERENCES" | "TRIGGER";
const ROLES: TRole[] = ["PUBLIC", "anon", "authenticated", "service_role"];
const CMDS: Cmd[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];
export const PRIVS: Priv[] = [...CMDS, "TRUNCATE", "REFERENCES", "TRIGGER"];
/** The privileges a single column can carry. */
const COLUMN_PRIVS: Priv[] = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];

export interface Policy {
  name: string;
  cmd: "ALL" | Cmd;
  roles: string[];
  permissive: boolean;
  using: string;
  check: string;
  file: string;
}

export interface TableState {
  name: string;
  rls: boolean;
  /** TABLE-level privileges: what `has_table_privilege` reads. */
  grants: Record<TRole, Record<Priv, boolean>>;
  /** Column-level privileges, by privilege: the columns granted on their own. */
  columnGrants: Record<TRole, Partial<Record<Priv, Set<string>>>>;
  policies: Map<string, Policy>;
  createdIn: string;
  history: string[];
}

const fullGrants = () =>
  Object.fromEntries(ROLES.map((r) => [r, Object.fromEntries(PRIVS.map((c) => [c, r !== "PUBLIC"]))])) as Record<TRole, Record<Priv, boolean>>;
const noColumnGrants = () =>
  Object.fromEntries(ROLES.map((r) => [r, {}])) as Record<TRole, Partial<Record<Priv, Set<string>>>>;

function tableName(ref: string): string | null {
  const m = /^(?:"?([A-Za-z_]\w*)"?\s*\.\s*)?"?([A-Za-z_]\w*)"?$/.exec(ref.trim());
  if (!m) return null;
  if (m[1] && m[1].toLowerCase() !== "public") return null;
  return m[2].toLowerCase();
}

function rolesIn(list: string): TRole[] {
  return list.split(",").map((s) => s.replace(/"/g, "").trim().toLowerCase())
    .map((s) => ROLES.find((r) => r.toLowerCase() === s))
    .filter((r): r is TRole => !!r);
}

/** Split on commas outside parens: `SELECT, UPDATE (a, b)` is two items. */
function commaItems(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * A GRANT/REVOKE privilege list, item by item. `cols` is null for a
 * table-level item and the column list for a column-level one.
 */
export function privilegeItems(list: string): Array<{ priv: Priv; cols: string[] | null }> {
  const out: Array<{ priv: Priv; cols: string[] | null }> = [];
  for (const item of commaItems(list)) {
    const m = /^(ALL(?:\s+PRIVILEGES)?|SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\s*(?:\(([^)]*)\))?$/i.exec(item);
    if (!m) continue;
    const cols = m[2] === undefined ? null
      : m[2].split(",").map((c) => c.replace(/"/g, "").trim().toLowerCase()).filter(Boolean);
    const privs = /^ALL/i.test(m[1]) ? (cols ? COLUMN_PRIVS : PRIVS) : [m[1].toUpperCase() as Priv];
    for (const priv of privs) out.push({ priv, cols });
  }
  return out;
}

/** Balanced `( ... )` starting at the first paren at or after `from`. */
function parenAt(s: string, from: number): { inner: string; end: number } | null {
  const open = s.indexOf("(", from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 ? s.length : j; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return { inner: s.slice(open + 1, i), end: i + 1 }; }
  }
  return null;
}

export interface TableReplay { tables: Map<string, TableState> }

export interface ReplayHooks {
  /** Before each top-level statement: `tables` is everything the lane did up to it. */
  before?: (stmt: string, file: string, tables: Map<string, TableState>) => void;
  /** After each top-level statement has been applied. */
  after?: (stmt: string, file: string, tables: Map<string, TableState>) => void;
}

export function replayTables(files?: Array<{ file: string; text: string }>, hooks: ReplayHooks = {}): TableReplay {
  const list = files ?? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
    .map((file) => ({ file, text: readFileSync(resolve(MIGRATIONS_DIR, file), "utf8") }));
  const tables = new Map<string, TableState>();
  const get = (n: string | null) => (n ? tables.get(n) : undefined);

  const dispatch = (stmt: string, file: string) => {
    let m: RegExpExecArray | null;
    if ((m = /^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)/i.exec(stmt))) {
      const n = tableName(m[2]);
      if (!n) return;
      if (tables.has(n) && m[1]) return;
      tables.set(n, { name: n, rls: false, grants: fullGrants(), columnGrants: noColumnGrants(), policies: new Map(), createdIn: file, history: [`${file}: CREATE`] });
      return;
    }
    if ((m = /^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?([\s\S]+?)(\s+CASCADE|\s+RESTRICT)?$/i.exec(stmt))) {
      for (const ref of m[2].split(",")) { const n = tableName(ref); if (n) tables.delete(n); }
      return;
    }
    if ((m = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+([\s\S]+)$/i.exec(stmt))) {
      const t = get(tableName(m[1]));
      if (!t) return;
      const act = m[2];
      if (/^ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(act)) { t.rls = true; t.history.push(`${file}: RLS on`); }
      if (/^DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(act)) { t.rls = false; t.history.push(`${file}: RLS off`); }
      const rn = /^RENAME\s+TO\s+"?(\w+)"?/i.exec(act);
      if (rn) { tables.delete(t.name); t.name = rn[1].toLowerCase(); tables.set(t.name, t); }
      return;
    }
    if ((m = /^CREATE\s+POLICY\s+("[^"]+"|\w+)\s+ON\s+((?:"?\w+"?\.)?"?\w+"?)\s*([\s\S]*)$/i.exec(stmt))) {
      const t = get(tableName(m[2]));
      if (!t) return;
      const rest = m[3];
      const permissive = !/\bAS\s+RESTRICTIVE\b/i.test(rest);
      const cmd = (/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(rest)?.[1].toUpperCase() ?? "ALL") as Policy["cmd"];
      const toM = /\bTO\s+([\w\s,"]+?)(?=\s+USING\b|\s+WITH\s+CHECK\b|$)/i.exec(rest);
      const roles = toM ? toM[1].split(",").map((s) => s.replace(/"/g, "").trim().toLowerCase()) : ["public"];
      const ui = /\bUSING\b/i.exec(rest);
      const using = ui ? parenAt(rest, ui.index)?.inner.trim() ?? "" : "";
      const ci = /\bWITH\s+CHECK\b/i.exec(rest);
      const check = ci ? parenAt(rest, ci.index)?.inner.trim() ?? "" : "";
      const name = m[1].replace(/"/g, "");
      t.policies.set(name, { name, cmd, roles, permissive, using, check, file });
      t.history.push(`${file}: POLICY ${name} ${cmd} TO ${roles.join(",")} USING(${using.slice(0, 60)})`);
      return;
    }
    if ((m = /^DROP\s+POLICY\s+(IF\s+EXISTS\s+)?("[^"]+"|\w+)\s+ON\s+((?:"?\w+"?\.)?"?\w+"?)/i.exec(stmt))) {
      const t = get(tableName(m[3]));
      if (t) { t.policies.delete(m[2].replace(/"/g, "")); t.history.push(`${file}: DROP POLICY ${m[2]}`); }
      return;
    }
    if ((m = /^(GRANT|REVOKE)\s+([\w\s,()"]+?)\s+ON\s+(TABLE\s+|ALL\s+TABLES\s+IN\s+SCHEMA\s+)?([\s\S]+?)\s+(TO|FROM)\s+([\s\S]+?)(\s+CASCADE|\s+RESTRICT|\s+WITH\s+GRANT\s+OPTION)?$/i.exec(stmt))) {
      if (/^\s*(FUNCTION|ROUTINE|SEQUENCE|SCHEMA|ALL\s+FUNCTIONS|ALL\s+SEQUENCES|ALL\s+ROUTINES|TYPE|DOMAIN)\b/i.test(m[4]) && !m[3]) return;
      if (/^(FUNCTION|ROUTINE|SEQUENCE|SCHEMA|TYPE|DOMAIN)\b/i.test(m[4].trim())) return;
      // REVOKE GRANT OPTION FOR leaves the privilege itself in place.
      if (/^GRANT\s+OPTION\s+FOR\b/i.test(m[2])) return;
      const grant = m[1].toUpperCase() === "GRANT";
      const items = privilegeItems(m[2]);
      const roles = rolesIn(m[6]);
      const targets = m[3] && /^ALL/i.test(m[3])
        ? [...tables.values()]
        : m[4].split(",").map((r) => get(tableName(r))).filter((t): t is TableState => !!t);
      for (const t of targets) {
        for (const r of roles) {
          for (const { priv, cols } of items) {
            if (cols) {
              // Column level: those columns only. A column REVOKE leaves any
              // table-level grant exactly where it was.
              const set = (t.columnGrants[r][priv] ??= new Set());
              for (const c of cols) { if (grant) set.add(c); else set.delete(c); }
            } else {
              t.grants[r][priv] = grant;
              // A table-level REVOKE also revokes the privilege on every column.
              if (!grant) t.columnGrants[r][priv]?.clear();
            }
          }
        }
        const said = [...new Set(items.map((i) => (i.cols ? `${i.priv}(${i.cols.join(",")})` : i.priv)))];
        t.history.push(`${file}: ${grant ? "GRANT" : "REVOKE"} ${said.join(",")} ${roles.join(",")}`);
      }
      return;
    }
    const doM = /^DO\s*(?:LANGUAGE\s+\w+\s*)?(\$[A-Za-z_]*\$)([\s\S]*?)\1/i.exec(stmt);
    if (doM) {
      const body = doM[2];
      // FOREACH t IN ARRAY ARRAY['a','b'] LOOP ... EXECUTE format('... %I ...', t) ... END LOOP
      for (const loop of body.matchAll(/FOREACH\s+(\w+)\s+IN\s+ARRAY\s+ARRAY\s*\[([\s\S]*?)\]\s*LOOP([\s\S]*?)END\s+LOOP\s*;/gi)) {
        const names = [...loop[2].matchAll(/'(\w+)'/g)].map((q) => q[1]);
        const fmts = [...loop[3].matchAll(/EXECUTE\s+format\s*\(\s*'([^']*)'/gi)].map((q) => q[1]);
        for (const n of names) {
          for (const f of fmts) {
            if (/DROP\s+POLICY/i.test(f)) {
              const t = tables.get(n.toLowerCase());
              if (t) { t.policies.clear(); t.history.push(`${file}: DROP every policy (loop)`); }
              continue;
            }
            if (/%I.*%I/.test(f)) continue;
            dispatch(f.replace(/%I/g, n).trim(), file);
          }
        }
      }
      for (const frag of splitStatements(body)) {
        const sm = /(?:^|\bTHEN\b|\bELSE\b|\bBEGIN\b|\bLOOP\b)\s*((?:GRANT|REVOKE|ALTER\s+TABLE|CREATE\s+POLICY|DROP\s+POLICY)\b[\s\S]*)$/i.exec(frag);
        if (sm && !/%I|%s|\|\|/.test(sm[1])) dispatch(sm[1].trim(), file);
      }
    }
  };

  for (const { file, text } of list) {
    for (const stmt of splitStatements(text)) {
      hooks.before?.(stmt, file, tables);
      dispatch(stmt, file);
      hooks.after?.(stmt, file, tables);
    }
  }
  return { tables };
}

/** Does `role` hold `p` on the TABLE, directly or through PUBLIC? (`has_table_privilege`) */
export function holdsOnTable(t: TableState, role: TRole, p: Priv): boolean {
  return t.grants[role][p] || t.grants.PUBLIC[p];
}

/**
 * Does `role` hold `p` on column `col` (`has_column_privilege`)? A table-level
 * grant covers every column; otherwise a column grant to the role or PUBLIC.
 * `col === null` asks about ANY column (`has_any_column_privilege`, or a
 * self-check that loops over every column of the table).
 */
export function holdsOnColumn(t: TableState, role: TRole, col: string | null, p: Priv): boolean {
  if (holdsOnTable(t, role, p)) return true;
  return [t.columnGrants[role][p], t.columnGrants.PUBLIC[p]]
    .some((s) => !!s && (col === null ? s.size > 0 : s.has(col.toLowerCase())));
}

const appliesTo = (p: Policy, role: "anon" | "authenticated") =>
  p.roles.includes("public") || p.roles.includes(role);

/**
 * For one role and command: "none" (no privilege or no policy lets rows
 * through), "all-rows" (RLS off, or a permissive `USING (true)` policy) or
 * "policy" (some permissive policy applies; read its USING to judge).
 */
export function access(t: TableState, role: "anon" | "authenticated", cmd: Cmd): { level: "none" | "all-rows" | "policy"; via: string[] } {
  // A column grant still reaches rows (through those columns), so it counts
  // here exactly as a table grant does.
  const priv = holdsOnColumn(t, role, null, cmd);
  if (!priv) return { level: "none", via: [] };
  if (!t.rls) return { level: "all-rows", via: ["RLS off"] };
  const ps = [...t.policies.values()].filter((p) => p.permissive && appliesTo(p, role) && (p.cmd === "ALL" || p.cmd === cmd));
  if (!ps.length) return { level: "none", via: [] };
  const expr = (p: Policy) => (cmd === "INSERT" ? p.check || p.using : p.using || p.check);
  const open = ps.filter((p) => /^\(?\s*true\s*\)?$/i.test(expr(p)));
  if (open.length) return { level: "all-rows", via: open.map((p) => p.name) };
  return { level: "policy", via: ps.map((p) => `${p.name}: ${expr(p).slice(0, 120)}`) };
}

let cached: TableReplay | null = null;
export function tableReplay(): TableReplay {
  if (!cached) cached = replayTables();
  return cached;
}
