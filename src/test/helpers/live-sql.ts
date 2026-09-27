/**
 * THE LIVE DEFINITION OF A SQL FUNCTION, READ ONCE PER PROCESS.
 *
 * WHY THIS EXISTS AS A HELPER. Two guards need the same three things and both
 * got them subtly wrong on their own.
 *
 *   1. THE LAST MIGRATION THAT DEFINES A FUNCTION IS THE LIVE DEFINITION OF IT.
 *      Reading "the migration that introduced X" is migration archaeology and it
 *      has already cost this project a silently reverted location fix — the rule
 *      20260901200000 exists to record. Sorting the directory and taking the LAST
 *      match is the only reading that matches what the database holds.
 *   2. SQL COMMENTS ARE PART OF THE FILE. A migration that explains its own
 *      predicate satisfies a search for that predicate, which is the trap this
 *      repository has hit seven times. Comment lines are stripped before any
 *      literal is looked for.
 *   3. IT MUST NOT COST 697 FILE READS PER CALL. Each caller was re-reading the
 *      whole migrations directory for every function in every test, under 16
 *      parallel workers — hundreds of full-directory scans per run. One of those
 *      runs produced a failure in the cross-runtime case that did not reproduce
 *      on the identical tree, five further runs passed, and no cause was ever
 *      captured. The scan is cached here at module scope so the work happens once
 *      and the hypothesis stops being plausible.
 *
 * AND IT THROWS RATHER THAN RETURNING "". The shape it replaced returned an empty
 * string whenever a read failed, so a filesystem problem arrived at the caller
 * wearing the same clothes as a deleted function and the assertion message named
 * the wrong defect. A named error says which of the two happened.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");

/** Every migration, newest last, read once. */
let cache: Array<{ file: string; text: string }> | null = null;
function migrations(): Array<{ file: string; text: string }> {
  if (cache) return cache;
  let names: string[];
  try {
    names = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  } catch (e) {
    throw new Error(`live-sql: cannot read ${MIGRATIONS} (${(e as Error).message})`);
  }
  if (!names.length) throw new Error(`live-sql: no .sql files under ${MIGRATIONS}`);
  cache = names.map((file) => {
    try {
      return { file, text: readFileSync(resolve(MIGRATIONS, file), "utf8") };
    } catch (e) {
      throw new Error(`live-sql: cannot read migration ${file} (${(e as Error).message})`);
    }
  });
  return cache;
}

/** Drop `--` comment lines. The literal a guard looks for must come from CODE. */
export const sqlCodeOf = (t: string): string =>
  t.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

/**
 * The body of `fn` as the database holds it, plus the file it came from (for an
 * assertion message that names the file a reader has to open).
 *
 * Throws when no migration defines the function — that is a different fact from
 * "the definition no longer contains X" and deserves its own message.
 */
export function liveDefinitionOf(fn: string): { file: string; body: string } {
  const needle = `FUNCTION public.${fn}(`;
  const hits = migrations().filter((m) => m.text.includes(needle));
  if (!hits.length) throw new Error(`live-sql: no migration defines ${fn} — searched ${migrations().length} files`);
  const { file, text } = hits[hits.length - 1];
  const i = text.indexOf(needle);
  const j = text.indexOf("\n$$;", i);
  if (j <= i) {
    // A COMMENT ON FUNCTION mentions the signature without a body; so does a
    // DROP. Fall back to the last file that actually holds a terminated body.
    for (let k = hits.length - 1; k >= 0; k--) {
      const a = hits[k].text.indexOf(needle);
      const b = hits[k].text.indexOf("\n$$;", a);
      if (b > a) return { file: hits[k].file, body: sqlCodeOf(hits[k].text.slice(a, b)) };
    }
    throw new Error(`live-sql: ${fn} is named in ${file} but no migration holds a terminated body for it`);
  }
  return { file, body: sqlCodeOf(text.slice(i, j)) };
}

/**
 * The COMMENT ON FUNCTION text the catalogue holds for `fn`, from the last
 * migration that sets one. The catalogue is the authority a reader gets from the
 * live database, so a guard that checks a function's behaviour and not its
 * published description can pass while the database forbids what ships.
 */
export function liveCommentOn(fn: string): { file: string; comment: string } {
  const needle = `COMMENT ON FUNCTION public.${fn}(`;
  const hits = migrations().filter((m) => m.text.includes(needle));
  if (!hits.length) throw new Error(`live-sql: no migration comments on ${fn}`);
  const { file, text } = hits[hits.length - 1];
  // ENDS AT THE STATEMENT, NOT AT THE FIRST SEMICOLON. These descriptions are
  // multi-line single-quoted prose and the prose itself contains semicolons —
  // slicing at the first one returned the first two sentences and an assertion
  // about anything further down failed while the text was right there.
  const lines = text.slice(text.indexOf(needle)).split("\n");
  const out: string[] = [];
  for (const l of lines) {
    out.push(l);
    if (l.trimEnd().endsWith(";")) break;
  }
  return { file, comment: out.join("\n") };
}
