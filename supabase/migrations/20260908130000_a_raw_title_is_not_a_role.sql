-- A RAW TITLE IS NOT A ROLE, AND GROUPING BY ONE INVERTS THE RANKING.
--
-- The collector already knows this. job_board_closures.title is written RAW
-- (job-board/index.ts, the closureRows mapper), but the two decisions that
-- MEAN anything about re-listing are both taken on a normalised form:
--
--   * `superseded` is liveTitles.has(normalizeCloseTitle(title)) — the flag
--     that says "the same role is still on the board", and
--   * the 24h dedupe skips a repeat when recentSuperseded.has(the same
--     normalised title) — the rule that makes every relist count a FLOOR.
--
-- So the stored column is the one spelling of the title that nothing in the
-- pipeline actually reasons about. Any surface that GROUPs BY it is counting
-- decoration: "Behavior Technician (R-48213)" and "Behavior Technician
-- (R-48307)" are two groups in SQL and one role everywhere else.
--
-- WHY THAT IS NOT A ROUNDING ERROR ONCE THE RANKING KEY IS A RATE. The
-- /explore section this file exists for ranks employers by re-list events PER
-- AFFECTED ROLE. Under raw-title grouping, an employer that stamps a fresh req
-- id on every repost splits its events across hundreds of one-event groups and
-- scores ~1.0 — the floor of the scale — while an employer that reposts a
-- stable, undecorated title concentrates its events into one group and tops
-- the list. The ranking would hand its worst verdict to whichever employer
-- varies its titles LEAST, which is the opposite of the conduct the heading
-- names, and it would do so under a comparative claim about that employer.
-- Live today, get_repost_churn_companies (raw grouping, ranked by raw event
-- count) reports T-Mobile at 3007 events across 67 raw titles with a single
-- title at 1616: the decoration is not hypothetical and neither is the split.
--
-- SO THE NORMALISATION MOVES INTO THE DATABASE, ported from
-- job-board/normalize.ts:128-136 rather than re-invented. The two regexes and
-- their order are the contract; a second, "improved" copy that strips one more
-- thing would silently disagree with the flag the rows were written under, and
-- the rate would then be a ratio of two different definitions. If normalize.ts
-- changes, this changes with it, and a mismatch is a defect in both
-- directions.
--
-- IT IS A PORT OF THE SEMANTICS, NOT OF THE CHARACTERS, AND THE DIFFERENCE IS
-- WHY THIS PARAGRAPH EXISTS. A first draft transcribed the two regexes
-- literally, `\s` and all, and that is not the same function: JavaScript's
-- `\s` and String.prototype.trim() are UNICODE-aware (U+00A0, U+1680,
-- U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF), while
-- PostgreSQL's `\s` is [[:space:]], which in every locale this database runs
-- is ASCII only. A single non-breaking space is enough to split one collector
-- key into two SQL groups -- and NBSP is demonstrably in this pipeline
-- (job-board/sources.ts carries a vendor-supplied company name containing one,
-- and worker/src/questions/match.ts:716 already had to write /[\s\u00a0]+/ because
-- `\s` alone was not enough). Under an events-per-affected-title RATE that
-- inflates the denominator and deflates the ranking key -- the same inversion
-- this file exists to prevent, driven by invisible whitespace instead of req
-- ids. So the function folds every character JS's `\s` matches down to U+0020
-- with a single translate() BEFORE the two id regexes run. That was chosen over
-- widening the three regex bracket expressions: one char-for-char mapping can
-- be checked by eye and cannot be got subtly wrong in one of three places, and
-- once it has run, the ASCII `\s` in those regexes and the one-argument btrim()
-- (which strips U+0020 alone) mean precisely what their JavaScript
-- counterparts mean.
--
-- ONE RESIDUAL DIVERGENCE IS KNOWN AND IS NOT PAPERED OVER: lower() is
-- glibc's towlower and .toLowerCase() is Unicode's full lowercase mapping, so
-- U+0130 (Turkish dotted capital I, which JS maps to "i" + U+0307) and Greek
-- final sigma (JS lowercases a word-final Sigma to U+03C2, glibc to U+03C3)
-- normalise differently in the two runtimes. Neither appears in the closure log
-- today; both would split one role into two groups if they did, in the
-- deflating direction. Stated rather than hidden, because a port that claims
-- exactness it does not have is worse than one that names its edge.
--
--   .toLowerCase()
--   .replace(/[([{][^)\]}]*\d[^)\]}]*[)\]}]/g, " ")          (R-48213), [Req 10422]
--   .replace(/\s*[-–—#·|]\s*(?:req|job|id|jr)?[\s#:-]*\d{3,}\s*$/i, " ")
--   .replace(/\s+/g, " ")
--   .trim()
--
-- NEVER STRIP WORDS — normalize.ts says so in as many words and this port
-- inherits the rule: a Senior Engineer closing while Engineer stays live is
-- not automatically a repost, and a normaliser that merged them would
-- manufacture the conduct it claims to measure.
--
-- The JS second replace carries an /i it does not need (the string is already
-- lowercased by then) and no /g (it is anchored at the end, so it can match at
-- most once). Neither is reproduced: /i is a no-op on an already-lowercased
-- string, and Postgres regexp_replace without the 'g' flag is already
-- match-once. What IS reproduced is everything that can change the output.
--
-- IMMUTABLE, and that word is load-bearing three ways: it lets the planner
-- fold the call, it lets a later migration build an expression index on it if
-- the grouped scan ever outgrows its budget, and it is a promise that the same
-- title always normalises to the same key — which is what makes a re-list
-- count comparable across employers and across hours.
--
-- No SET clause, deliberately. A SQL function carrying one cannot be inlined,
-- and this is called once per superseded closure row in a board-wide grouped
-- scan; the difference is a folded expression versus a function call per row.
-- Safety comes from schema-qualifying every builtin instead, and the function
-- is SECURITY INVOKER, so no search_path of a caller can borrow privilege
-- through it.
--
-- NO INDEX IS BUILT HERE, on purpose. An expression index on
-- job_board_closures would be a write-blocking build on the collector's
-- hottest insert path (200-row closure batches, already under resource-limit
-- pressure), and the reader that needs it groups the whole superseded set
-- anyway — an index would not be probed. If a later reader needs one, build it
-- CONCURRENTLY in its own migration, not inside a transaction with DDL.

CREATE OR REPLACE FUNCTION public.normalize_close_title(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          -- EVERY CHARACTER JAVASCRIPT'S \s MATCHES, FOLDED TO U+0020 FIRST.
          -- Done with translate() rather than by widening the three regex
          -- classes below: one char-for-char mapping is checkable by eye, and
          -- after it the ASCII \s in those regexes and the one-argument btrim()
          -- (which strips U+0020 alone) mean exactly what their JavaScript
          -- counterparts mean. The set is JS's \s minus the ASCII members
          -- Postgres already has: U+00A0 U+1680 U+2000..U+200A U+2028 U+2029
          -- U+202F U+205F U+3000 U+FEFF.
          pg_catalog.translate(
            pg_catalog.lower(COALESCE(p_title, '')),
            U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff',
            '                   '),
          '[([{][^)\]}]*\d[^)\]}]*[)\]}]', ' ', 'g'),
        '\s*[-–—#·|]\s*(?:req|job|id|jr)?[\s#:-]*\d{3,}\s*$', ' '),
      '\s+', ' ', 'g')
  );
$$;

-- Callable by everyone: it is a pure string function over an argument the
-- caller already holds, it reads no table, and the aggregates that use it are
-- the ones carrying the access decision.
GRANT EXECUTE ON FUNCTION public.normalize_close_title(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.normalize_close_title(text) IS
  'The SQL port of job-board/normalize.ts normalizeCloseTitle, character for '
  'character. Lowercases, strips bracketed segments containing a digit '
  '((R-48213), [Req 10422]) and one trailing req/id number of three digits or '
  'more, then collapses whitespace. IT NEVER STRIPS WORDS: Senior Engineer and '
  'Engineer stay different roles. THIS IS THE KEY THE DATA WAS WRITTEN UNDER — '
  'job_board_closures.title is stored RAW, while both collector decisions that '
  'give a closure its meaning (the superseded flag, and the 24h dedupe that '
  'makes every relist count a floor) are taken on this normalised form. Any '
  'aggregate that groups closures by the raw column is counting req-id '
  'decoration as distinct roles, which under a per-role RATE ranks the '
  'employer with the most stable titles worst. NULL normalises to the empty '
  'string, matching the collector''s String(title ?? ""). UNICODE WHITESPACE IS '
  'FOLDED TO U+0020 FIRST, by translate(): JavaScript''s \s and .trim() cover '
  'U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000 and '
  'U+FEFF, and PostgreSQL''s \s ([[:space:]]) covers none of them, so without '
  'that fold a title carrying one non-breaking space would group as two roles '
  'here and one role in the collector -- inflating the denominator of an '
  'events-per-title rate. KNOWN '
  'RESIDUAL: lower() is glibc towlower, not Unicode full lowercasing, so U+0130 '
  'and Greek final sigma still normalise differently in the two runtimes; '
  'neither is present in the closure log. If normalize.ts changes, this must '
  'change with it; a divergence makes any events-per-title figure a ratio of '
  'two different definitions.';

NOTIFY pgrst, 'reload schema';
