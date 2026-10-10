/**
 * company_name_overrides AS THE MIGRATIONS LEAVE IT, rebuilt by replaying every
 * migration's writes to it in file order: INSERT ... VALUES (with ON CONFLICT
 * DO UPDATE / DO NOTHING / none) and UPDATE ... SET display_name WHERE slug.
 *
 * Used by the mirror test of supabase/functions/_shared/employer-names.ts. A
 * statement shape this reader does not know THROWS, naming the file, so a new
 * way of writing the table cannot quietly drop out of the comparison.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const defaultDir = () => (typeof __dirname === "string" ? resolve(__dirname, "../../../supabase/migrations") : resolve(process.cwd(), "supabase/migrations"));

/** SQL with -- comments removed (outside string literals). */
function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const lit = (s: string) => s.slice(1, -1).replace(/''/g, "'");
const PAIR = /\(\s*('(?:[^']|'')*')\s*,\s*('(?:[^']|'')*')\s*\)/g;

export function replayNameOverrides(DIR: string = defaultDir()): Map<string, string> {
  const table = new Map<string, string>();
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(resolve(DIR, f), "utf8"));
    if (!/company_name_overrides/.test(sql)) continue;
    // Statements, split on semicolons outside literals (none of these files put one inside a $$ body near the table).
    const stmts: string[] = [];
    let cur = "";
    let inLit = false;
    for (let i = 0; i < sql.length; i++) {
      const c = sql[i];
      if (c === "'") inLit = !inLit;
      if (c === ";" && !inLit) { stmts.push(cur); cur = ""; continue; }
      cur += c;
    }
    stmts.push(cur);
    for (const st of stmts) {
      const s = st.trim();
      if (/^INSERT\s+INTO\s+(public\.)?company_name_overrides\b/i.test(s)) {
        const m = /^INSERT\s+INTO\s+(?:public\.)?company_name_overrides\s*\(\s*slug\s*,\s*display_name\s*\)\s*VALUES([\s\S]*?)(ON\s+CONFLICT[\s\S]*)?$/i.exec(s);
        if (!m) throw new Error(`${f}: an INSERT into company_name_overrides this reader does not know`);
        const tail = (m[2] ?? "").replace(/\s+/g, " ").trim();
        const fixed = /DO UPDATE SET display_name = ('(?:[^']|'')*')/i.exec(tail);
        const mode = !tail ? "plain" : /DO NOTHING/i.test(tail) ? "nothing" : /DO UPDATE SET display_name = EXCLUDED\.display_name/i.test(tail) ? "update" : fixed ? "fixed" : "unknown";
        if (mode === "unknown") throw new Error(`${f}: ON CONFLICT clause this reader does not know: ${tail.slice(0, 80)}`);
        const pairs = [...m[1].matchAll(PAIR)];
        if (!pairs.length) throw new Error(`${f}: an INSERT with no (slug, name) pairs this reader can see`);
        for (const p of pairs) {
          const slug = lit(p[1]);
          const name = mode === "fixed" ? lit(fixed![1]) : lit(p[2]);
          if (mode === "nothing" && table.has(slug)) continue;
          table.set(slug, name);
        }
        continue;
      }
      if (/^UPDATE\s+(public\.)?company_name_overrides\b/i.test(s)) {
        const m = /^UPDATE\s+(?:public\.)?company_name_overrides\s+SET\s+display_name\s*=\s*('(?:[^']|'')*')\s+WHERE\s+slug\s*=\s*('(?:[^']|'')*')\s*$/i.exec(s);
        if (!m) throw new Error(`${f}: an UPDATE of company_name_overrides this reader does not know`);
        if (table.has(lit(m[2]))) table.set(lit(m[2]), lit(m[1]));
        continue;
      }
      if (/^DELETE\s+FROM\s+(public\.)?company_name_overrides\b/i.test(s)) throw new Error(`${f}: a DELETE from company_name_overrides; teach this reader`);
    }
  }
  return table;
}
