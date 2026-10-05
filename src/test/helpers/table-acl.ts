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
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATIONS_DIR, splitStatements } from "./function-acl";

export type TRole = "PUBLIC" | "anon" | "authenticated" | "service_role";
export type Cmd = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
const ROLES: TRole[] = ["PUBLIC", "anon", "authenticated", "service_role"];
const CMDS: Cmd[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

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
  grants: Record<TRole, Record<Cmd, boolean>>;
  policies: Map<string, Policy>;
  createdIn: string;
  history: string[];
}

const fullGrants = () =>
  Object.fromEntries(ROLES.map((r) => [r, Object.fromEntries(CMDS.map((c) => [c, r !== "PUBLIC"]))])) as Record<TRole, Record<Cmd, boolean>>;

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

function privsIn(list: string): Cmd[] {
  if (/\bALL\b/i.test(list)) return [...CMDS];
  return CMDS.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(list));
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

export function replayTables(files?: Array<{ file: string; text: string }>): TableReplay {
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
      tables.set(n, { name: n, rls: false, grants: fullGrants(), policies: new Map(), createdIn: file, history: [`${file}: CREATE`] });
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
    if ((m = /^(GRANT|REVOKE)\s+([\w\s,()]+?)\s+ON\s+(TABLE\s+|ALL\s+TABLES\s+IN\s+SCHEMA\s+)?([\s\S]+?)\s+(TO|FROM)\s+([\s\S]+?)(\s+CASCADE|\s+RESTRICT|\s+WITH\s+GRANT\s+OPTION)?$/i.exec(stmt))) {
      if (/^\s*(FUNCTION|ROUTINE|SEQUENCE|SCHEMA|ALL\s+FUNCTIONS|ALL\s+SEQUENCES|ALL\s+ROUTINES|TYPE|DOMAIN)\b/i.test(m[4]) && !m[3]) return;
      if (/^(FUNCTION|ROUTINE|SEQUENCE|SCHEMA|TYPE|DOMAIN)\b/i.test(m[4].trim())) return;
      const grant = m[1].toUpperCase() === "GRANT";
      const privs = privsIn(m[2]);
      const roles = rolesIn(m[6]);
      const targets = m[3] && /^ALL/i.test(m[3])
        ? [...tables.values()]
        : m[4].split(",").map((r) => get(tableName(r))).filter((t): t is TableState => !!t);
      for (const t of targets) {
        for (const r of roles) for (const c of privs) t.grants[r][c] = grant;
        t.history.push(`${file}: ${grant ? "GRANT" : "REVOKE"} ${privs.join(",")} ${roles.join(",")}`);
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

  for (const { file, text } of list) for (const stmt of splitStatements(text)) dispatch(stmt, file);
  return { tables };
}

const appliesTo = (p: Policy, role: "anon" | "authenticated") =>
  p.roles.includes("public") || p.roles.includes(role);

/**
 * For one role and command: "none" (no privilege or no policy lets rows
 * through), "all-rows" (RLS off, or a permissive `USING (true)` policy) or
 * "policy" (some permissive policy applies; read its USING to judge).
 */
export function access(t: TableState, role: "anon" | "authenticated", cmd: Cmd): { level: "none" | "all-rows" | "policy"; via: string[] } {
  const priv = t.grants[role][cmd] || t.grants.PUBLIC[cmd];
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
