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
 * IT IS ONE LEFT-TO-RIGHT PASS, AND THAT ORDERING IS THE WHOLE CORRECTNESS
 * ARGUMENT. This used to run the block-comment regex over the whole file
 * FIRST and only then cut trailing `//`. A `/*` that appears inside a LINE
 * comment is not a block-comment opener -- but to a block-first pass it is,
 * and the strip then runs to the next `*\/` anywhere below, deleting every
 * line in between. That is not a hypothetical: supabase/functions/job-board/
 * index.ts:106 says
 *
 *     // NOTE: a change to ../_shared/* alone does NOT get this function ...
 *
 * and the `/*` in that path swallowed a 16,390-character region, taking the
 * real declarations `SITEMAP_DAYS`, `BUILD_VERSION`, `NAME_SYNC_VERSION` and
 * `FRESH_WINDOW_DAYS` out of the output with it. Every guard reading that
 * output was inspecting a file with a hole in it and could not tell: a guard
 * that reads nothing passes against anything, which is strictly worse than no
 * guard at all. Two guards in this build had been pointed at a second,
 * near-duplicate stripper to work around it; the stripper is fixed here
 * instead, because a repository with two comment strippers has the bug in
 * whichever one it is not looking at.
 *
 * WHAT THE SCANNER KNOWS, and why each one has to be known to get the others
 * right. A single pass cannot skip any of them: whichever construct it fails
 * to recognise, it re-enters in the middle of and mis-reads everything after.
 *
 *   STRINGS AND TEMPLATES  `"..."`, `'...'`, `` `...` ``, escapes honoured.
 *                          A `//` inside one is a URL, not a comment.
 *   REGEX LITERALS         `/.../flags`, including a `/` or a quote inside a
 *                          character class. Required, not a refinement: once
 *                          this is a character scanner, the `"` in `/["]/`
 *                          would otherwise open a string that runs to the
 *                          next quote in the file. A regex is told from a
 *                          division by the last significant character before
 *                          it -- after a value (`)`, `]`, an identifier, a
 *                          number) a `/` divides; anywhere else it opens a
 *                          literal.
 *   JSX COMMENT BRACES     `{\/* ... *\/}` collapse whole, or the closing
 *                          brace survives as code.
 *
 * WHAT IT PRESERVES OF THE OLD OUTPUT SHAPE, deliberately, so that assertions
 * written against it keep meaning what they meant: a block comment collapses
 * to a single space and a line comment is REMOVED to the end of its line
 * rather than blanked. Several guards here match across a bounded gap
 * (`[\s\S]{0,120}`), and padding comments out to their original width would
 * push the two halves of such a pattern apart and fail it for a reason that
 * has nothing to do with the property being guarded.
 */
export function codeOf(src: string): string {
  const out: string[] = [];
  /** The last significant character emitted -- what decides regex from divide. */
  let prev = "";
  let i = 0;

  const copyThrough = (open: string, close: string, classed: boolean): void => {
    out.push(src[i]);
    i++;
    let inClass = false;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "\\") {
        out.push(ch, src[i + 1] ?? "");
        i += 2;
        continue;
      }
      // A newline ends an unterminated string rather than running away with
      // the rest of the file -- a malformed line should cost its own line.
      if (ch === "\n" && open !== "`") break;
      out.push(ch);
      i++;
      if (classed && ch === "[") inClass = true;
      else if (classed && ch === "]") inClass = false;
      else if (ch === close && !inClass) break;
    }
  };

  while (i < src.length) {
    const c = src[i];

    // JSX comment braces, whole -- and matched WITHOUT BACKTRACKING, which is
    // the second half of the same bug. The rule used to be the lazy regex
    // `/^\{\s*\/\*[\s\S]*?\*\/\s*\}/`. Lazy still backtracks: when the nearest
    // `*\/` is not followed by `}` -- which is every ordinary `} catch { /* …
    // *\/ handled(); }` in the file -- it goes looking for a LATER one and
    // matches across everything in between. In index.ts that swallowed 800
    // lines from line 1991 and took `const FRESH_WINDOW_DAYS = 30;` with it,
    // the same silent hole by a different door. The close is the FIRST `*\/`
    // after the opener or this is not a JSX comment at all, in which case the
    // brace is ordinary code and the block comment inside it is handled by the
    // block-comment rule below on the next pass.
    if (c === "{") {
      const open = /^\{\s*\/\*/.exec(src.slice(i));
      if (open) {
        const from = i + open[0].length;
        const close = src.indexOf("*/", from);
        const tail = close === -1 ? null : /^\s*\}/.exec(src.slice(close + 2));
        if (tail) {
          out.push(" ");
          i = close + 2 + tail[0].length;
          prev = " ";
          continue;
        }
      }
    }

    if (c === '"' || c === "'" || c === "`") {
      copyThrough(c, c, false);
      prev = c;
      continue;
    }

    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close === -1 ? src.length : close + 2;
      out.push(" ");
      prev = " ";
      continue;
    }

    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl; // the newline itself is emitted next
      continue;
    }

    if (c === "/" && startsRegex(prev)) {
      copyThrough("/", "/", true);
      // Trailing flags are ordinary identifier characters; leave them be.
      prev = "/";
      continue;
    }

    out.push(c);
    if (!/\s/.test(c)) prev = c;
    i++;
  }

  return out.join("");
}

/**
 * Does a `/` here open a regex literal rather than divide?
 *
 * After something that can END a value -- a closing bracket, an identifier
 * character, or nothing at all because the expression is complete -- a slash
 * is division. Everywhere else it opens a literal. The keyword cases that
 * would fool this (`return /re/`, `typeof /re/`) end in an identifier
 * character and so read as division; they are accepted as a known limit
 * because the failure is confined to that one literal rather than, as with
 * the block-comment bug above, to everything after it.
 */
function startsRegex(prev: string): boolean {
  if (prev === "") return true;
  return !/[A-Za-z0-9_$)\]]/.test(prev);
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
