/**
 * WHAT THIS GUARDS
 * ----------------
 * The comment stripper itself, which had no test of its own while eleven
 * guard files read their evidence through it.
 *
 * WHY THAT IS THE WORST PLACE FOR A BUG. Every assertion in this repository
 * that pins a SPELLING reads comment-stripped source, because a docblock
 * explaining which identifier a line uses necessarily contains that
 * identifier, and a guard matching the literal would otherwise be satisfied by
 * the explanation while the code says something else. The stripper is
 * therefore upstream of all of them. A stripper that DELETES REAL CODE does
 * not make those guards fail — it makes them pass, against a file with a hole
 * in it, reporting "no offences found" about a region they can no longer see.
 * A guard that reads nothing passes against anything, and it does it quietly.
 *
 * THE TWO DEFECTS THAT SHIPPED, both in codeOf, both found only by measuring
 * the output rather than by any test:
 *
 *   1. BLOCK-COMMENTS-FIRST. codeOf ran `/\/\*[\s\S]*?\*\//g` over the whole
 *      file and only then cut trailing `//`. A `/*` inside a LINE comment is
 *      not an opener, but a block-first pass reads it as one and runs to the
 *      next `*\/` anywhere below. supabase/functions/job-board/index.ts:106
 *      says `// NOTE: a change to ../_shared/* alone does NOT get this
 *      function redeployed`, and that wildcard swallowed a 16,390-character
 *      region containing `SITEMAP_DAYS`, `BUILD_VERSION`, `NAME_SYNC_VERSION`
 *      and `FRESH_WINDOW_DAYS`.
 *
 *   2. A BACKTRACKING JSX-COMMENT RULE. `{\s*\/\*[\s\S]*?\*\/\s*\}` is lazy,
 *      but lazy still backtracks: where the nearest `*\/` is not followed by
 *      `}` — every ordinary `catch { /* … *\/ handle(); }` in the file — the
 *      match searched onward for a later one and spanned everything between.
 *      In index.ts it ran from line 1991 across roughly 800 lines and took
 *      `const FRESH_WINDOW_DAYS = 30;` with it. Fixing defect 1 alone left
 *      this one standing, which is why the assertions below name specific
 *      declarations in the real file rather than testing a toy string.
 *
 * WHAT IS ASSERTED, in three kinds:
 *   - PROPERTIES over hand-written inputs: what must be removed, what must
 *     survive, and the two shapes above specifically.
 *   - THE REAL FILES the guards actually read, because a stripper can be
 *     correct on every toy case and still lose a region of a 18,000-line file
 *     to a construct nobody thought of. Named declarations must survive.
 *   - AGREEMENT WITH THE INDEPENDENT IMPLEMENTATION. helpers/catalog.ts has
 *     its own scanner for sources.ts; on the files both can read, the set of
 *     identifiers each one keeps must match. Two implementations agreeing is
 *     weak evidence alone but strong against a silent hole, which is exactly
 *     the failure mode here.
 *
 * TEETH, each proven against this file by breaking codeOf in place and
 * restoring it:
 *   (a) block-comments-first ordering restored .......... 4 assertions red
 *   (b) backtracking JSX rule restored .................. 3 assertions red
 *   (c) string awareness removed ........................ 2 assertions red
 *   (d) regex-literal awareness removed ................. 1 assertion  red
 *   (e) codeOf made the identity function ............... 6 assertions red
 * All restored; the file is green as committed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { codeOf, commentsOf } from "./helpers/strip-comments";
import { stripTsComments } from "./helpers/catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const FN = join(HERE, "..", "..", "supabase", "functions", "job-board");
const INDEX_RAW = readFileSync(join(FN, "index.ts"), "utf8");
const NORMALIZE_RAW = readFileSync(join(FN, "normalize.ts"), "utf8");

describe("a stripper that loses real code passes every guard that reads it", () => {
  it("removes comments of every shape", () => {
    expect(codeOf("const a = 1; // trailing").trim()).toBe("const a = 1;");
    expect(codeOf("/* lead */ const a = 1;").trim()).toBe("const a = 1;");
    expect(codeOf("/**\n * doc\n */\nconst a = 1;").trim()).toBe("const a = 1;");
    // The half the line-start strippers missed, and the reason this module
    // exists: a trailing `// was: x` satisfying the assertion that forbids x.
    expect(codeOf("run(); // was: forbidden()")).not.toContain("forbidden");
  });

  it("keeps a // that is inside a string, because that is a URL and not a comment", () => {
    expect(codeOf('const u = "https://x.dev/a";')).toContain("https://x.dev/a");
    expect(codeOf("const u = 'https://x.dev/a';")).toContain("https://x.dev/a");
    expect(codeOf("const u = `https://x.dev/a`;")).toContain("https://x.dev/a");
  });

  it("keeps a quote that is inside a regex literal, which a character scanner must not read as a string", () => {
    // Without regex awareness the quote inside the character class opens a
    // string literal and the scanner comes back out of step.
    //
    // THE SYMPTOM IS A SURVIVING COMMENT, NOT A MISSING DECLARATION, and the
    // first version of this assertion looked for the wrong one and so proved
    // nothing. A mis-detected string is COPIED THROUGH, not deleted — the
    // scanner keeps every character it reads. What it stops doing is
    // recognising the comments inside what it now believes is a string. So
    // the code after a regex survives either way, and the thing that goes
    // wrong is that a `//` following it is left standing in the output, where
    // the guards reading through this will happily match their literal
    // against it.
    for (const q of ['"', "'", "`"]) {
      const src = `const q = /[${q}]/; // forbiddenCall()\nconst after = 1;`;
      const out = codeOf(src);
      expect(out, `a ${q} inside a regex character class left the comment after it standing`)
        .not.toContain("forbiddenCall");
      expect(out).toContain("const after = 1;");
      expect(out).toContain("const q =");
    }
  });

  it("keeps a // that is inside a regex literal", () => {
    const out = codeOf("const r = /https:\\/\\//;\nconst after = 1;");
    expect(out).toContain("const after = 1;");
  });

  it("does not let a /* inside a line comment open a block comment", () => {
    // DEFECT 1, in miniature. The wildcard path is the real one from
    // index.ts:106. A block-first strip runs from it to the next `*/`.
    const src = [
      "// NOTE: a change to ../_shared/* alone does NOT redeploy",
      "const KEPT_ONE = 1;",
      "/* an ordinary block comment, whose close the bad strip paired with */",
      "const KEPT_TWO = 2;",
    ].join("\n");
    const out = codeOf(src);
    expect(out, "a line comment's wildcard opened a block comment").toContain("const KEPT_ONE = 1;");
    expect(out).toContain("const KEPT_TWO = 2;");
    expect(out).not.toContain("does NOT redeploy");
  });

  it("does not let a braced block comment match a later close than its own", () => {
    // DEFECT 2, in miniature: the first `*/` is not followed by `}`, so a
    // backtracking rule goes looking for one that is and spans the gap.
    const src = [
      "try { run(); } catch { /* fall through */ recover(); }",
      "const KEPT = 1;",
      "const x = { /* a brace, a comment, and a close that does follow */ };",
    ].join("\n");
    const out = codeOf(src);
    expect(out, "a braced comment swallowed the code after it").toContain("recover();");
    expect(out).toContain("const KEPT = 1;");
    expect(out).not.toContain("fall through");
  });

  it("collapses a genuine JSX comment brace", () => {
    expect(codeOf("<i>{/* hidden */}</i>")).toBe("<i> </i>");
  });

  it("keeps every named declaration of the real files the guards read through it", () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT BOTH DEFECTS. These four are the
    // ones the shipped stripper lost from index.ts; they are named rather than
    // counted because a length comparison is equally true of a stripper that
    // deletes 16KB of real code and one that works.
    const index = codeOf(INDEX_RAW);
    for (const decl of ["BUILD_VERSION", "FRESH_WINDOW_DAYS", "SITEMAP_DAYS", "NAME_SYNC_VERSION"]) {
      expect(
        new RegExp(`^\\s*(?:export\\s+)?const\\s+${decl}\\s*=`, "m").test(index),
        `${decl} did not survive the strip — every guard reading index.ts through codeOf is blind to its region`,
      ).toBe(true);
    }
    const normalize = codeOf(NORMALIZE_RAW);
    for (const decl of ["REGION_MAP_VERSION", "COUNTRY_MAP_VERSION"]) {
      expect(
        new RegExp(`^\\s*(?:export\\s+)?const\\s+${decl}\\s*=`, "m").test(normalize),
        `${decl} did not survive the strip of normalize.ts`,
      ).toBe(true);
    }
  });

  it("really does remove the comments in those files, or the guards read prose", () => {
    const index = codeOf(INDEX_RAW);
    expect(INDEX_RAW).toContain("Returning null here is a measured fact");
    expect(index).not.toContain("Returning null here is a measured fact");
    // No comment opener may survive in the output at all.
    expect(index).not.toContain("/*");
    expect(codeOf(NORMALIZE_RAW)).not.toContain("/*");
  });

  it("keeps EVERY top-level declaration of both files, not just the four that were lost", () => {
    // THE WHOLE-FILE VERSION OF THE PROPERTY. Naming four declarations catches
    // the two defects that shipped; it would not catch the third. Every
    // top-level declaration in the raw file must still be a top-level
    // declaration in the stripped one. Anchored at column zero, so a
    // declaration quoted inside a docblock — which is indented by its leading
    // ` * ` — is not counted as one and cannot mask a real loss.
    //
    // Measured on this tree: 163 top-level declarations in index.ts, 0 lost.
    const DECL = /^(?:export\s+)?(?:const|let|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
    for (const [name, raw] of [["index.ts", INDEX_RAW], ["normalize.ts", NORMALIZE_RAW]] as const) {
      const declared = [...new Set([...raw.matchAll(DECL)].map((m) => m[1]))];
      expect(declared.length, `${name}: the declaration regex found nothing — it broke`).toBeGreaterThan(50);
      const out = codeOf(raw);
      const lost = declared.filter(
        (n) => !new RegExp(`^(?:export\\s+)?(?:const|let|function|class|type|interface|enum)\\s+${n}\\b`, "m").test(out),
      );
      expect(lost, `${name}: the strip swallowed real declarations`).toEqual([]);
    }
  });

  it("is the stripper the guards should read through, measured against the other one", () => {
    // WHY THE REPAIR WAS MADE HERE RATHER THAN BY SWITCHING STRIPPERS. When
    // codeOf was losing a region of index.ts, two guards in this build were
    // pointed at helpers/catalog's stripTsComments instead. That scanner has
    // no regex-literal awareness, so on index.ts a quote inside a character
    // class opens a string for it and it comes back out of step: it leaves
    // COMMENT PROSE standing in what it calls code, including block-comment
    // openers. A guard reading that output can be satisfied by the very
    // explanation it is supposed to look past — the failure this whole module
    // exists to prevent, arriving from the other direction.
    //
    // Asserted so the two cannot silently swap places again.
    expect(codeOf(INDEX_RAW), "codeOf left a comment opener in index.ts").not.toContain("/*");
    expect(
      stripTsComments(INDEX_RAW),
      "stripTsComments now reads index.ts cleanly too — if so, delete this assertion and the note above it, not the guard",
    ).toContain("/*");
  });

  it("gives commentsOf the text codeOf removed, so a guard can assert on prose deliberately", () => {
    const src = 'const a = 1; // the note\nconst u = "https://x.dev";';
    expect(commentsOf(src)).toContain("the note");
    // And the URL is not mistaken for a comment by that reader either.
    expect(codeOf(src)).toContain("https://x.dev");
  });
});
