/**
 * A FUNCTION DEFINITION FROM THE MIGRATION LANE, RUN AT A FIXED INSTANT.
 *
 * Several data-page functions decide what to return from now(): which weeks
 * exist, which day "today" is. A guard that ran them on the real clock would
 * pass on some weekdays and fail on others. definitionAt lifts one function's
 * definition out of a migration file and replaces every now() in it with a
 * literal instant, so the lifted body answers exactly as the shipped one would
 * at that moment, on any day the suite runs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");
export const migFile = (f: string) => readFileSync(resolve(MIGRATIONS, f), "utf8");
export const migFiles = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/** One function's definition, from its CREATE to the close of the dollar tag it opened with. */
export function definitionOf(sql: string, fn: string): string {
  const m = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").exec(sql);
  if (!m) throw new Error(`no definition of ${fn}`);
  const tag = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(sql.slice(m.index));
  if (!tag) throw new Error(`no body opener for ${fn}`);
  const open = m.index + tag.index + tag[0].indexOf(tag[1]);
  const close = sql.indexOf(tag[1], open + tag[1].length);
  if (close < 0) throw new Error(`unterminated body for ${fn}`);
  return sql.slice(m.index, close + tag[1].length) + ";";
}

/** The definition with every now() and current_date pinned to `at` (an ISO
 *  instant, read in UTC), and the function renamed with `suffix`. */
export function definitionAt(file: string, fn: string, at: string, suffix: string): string {
  const def = definitionOf(migFile(file), fn);
  const pinned = def
    .split("now()").join(`'${at}'::timestamptz`)
    .replace(/\bcurrent_date\b/g, `('${at}'::timestamptz AT TIME ZONE 'UTC')::date`);
  if (pinned === def) throw new Error(`${file}: ${fn} never reads the clock, so pinning it proves nothing`);
  return pinned.replace(new RegExp(`(FUNCTION\\s+public\\.${fn})(\\s*\\()`, "i"), `$1_${suffix}$2`);
}
