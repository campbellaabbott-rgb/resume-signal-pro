/**
 * ONE STRIPPER, BECAUSE A GUARD THAT READS A COMMENT IS NOT A GUARD.
 *
 * Every assertion in this repository that pins a SPELLING has to read the code
 * with its comments gone. Comments are part of a file, a docblock explaining
 * which identifier a line uses necessarily contains that identifier, and a
 * guard matching the literal is then satisfied by the explanation while the
 * code says something else. That has shipped here several times over -- a
 * neutered migration naming its own parameter in prose, a test whose header
 * named the crash string it forbade, a docblock quoting the import line the
 * page no longer had.
 *
 * Four near-copies of this had grown across src/test/ in one build, and three
 * of them cut only a comment that STARTS a line -- so a trailing `// was: ...`
 * satisfied the very assertion the file's own docblock said it was avoiding.
 * This module is the one implementation, and each function says what it is
 * safe over.
 */

/**
 * TypeScript or JavaScript with its comments removed and its strings intact.
 *
 * A trailing `//` is cut too, which is the half the line-start strippers
 * missed -- but only when the quote characters before it on that line are
 * balanced, so `https://` and every other URL inside a string literal
 * survives. Block comments go first; JSX comment braces go before those, or
 * the closing brace survives as code and the next block comment swallows real
 * markup with it.
 */
export function codeOf(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      for (let i = 0; i + 1 < line.length; i++) {
        if (line[i] !== "/" || line[i + 1] !== "/") continue;
        const before = line.slice(0, i);
        const even = (ch: string) => (before.split(ch).length - 1) % 2 === 0;
        if (even('"') && even("'") && even("`")) return before;
      }
      return line;
    })
    .join("\n");
}

/**
 * SQL with its comments removed.
 *
 * Both forms, and a trailing `--` as well: the migrations in this repository
 * routinely explain a predicate on the same line they write it. String
 * literals are NOT protected here, because SQL's own quote is `'` and a `--`
 * inside one is vanishingly rare next to a `--` explaining the line beside it;
 * a guard that needs the literal intact should assert on the raw text and say
 * so.
 */
export function sqlCodeOf(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Only the comment text of a TS/JS file: what a guard must NOT have read a literal out of. */
export function commentsOf(src: string): string {
  return [
    ...[...src.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => m[0]),
    ...[...src.matchAll(/^[^\n]*?\/\/[^\n]*/gm)].map((m) => m[0]),
  ].join("\n");
}
