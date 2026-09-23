-- A POSTING IS QUOTED, NEVER JUDGED.
--
-- Ontario's Employment Standards Act, 2000 gained Part III.1 on 1 January
-- 2026: some publicly advertised job postings must now state the expected
-- compensation or a range (s. 8.2(1)) and must state whether the posting is
-- for an existing vacancy (s. 8.5(1)(a)); an employer that uses artificial
-- intelligence to screen, assess or select applicants must disclose that
-- (s. 8.4(1)); and no posting may require Canadian experience (s. 8.3(1)).
--
-- THIS READER RETURNS EVIDENCE. It hands back the posting's own words for
-- each of those four clauses and nothing else -- no verdict, no score, no
-- share, no count. The reason is not squeamishness, it is that the statute's
-- own trigger is invisible to us: O. Reg. 476/24 s.1 exempts an employer with
-- a headcount under the regulation's threshold, and this board holds no
-- headcount column for any employer, on any row, from any vendor. A surface
-- that turned "the text does not state pay" into "this employer did not
-- comply" would be asserting the one fact we cannot observe. So the clause is
-- cited, the posting's words are quoted, and the reader joins them.
--
-- TWO OF THE FOUR ARE NOT AFFIRMATIVE DUTIES, and the shape of the return
-- says so. s. 8.4(1) binds only an employer that actually uses the technology
-- to screen applicants -- silence is full compliance for everyone else -- and
-- s. 8.3(1) is a prohibition, observable only when it is breached. Those two
-- fields are therefore PRESENT-ONLY: null means nothing was found, never that
-- something is missing. Only the pay and vacancy clauses are unconditional,
-- and only those two carry an "absent" meaning at all.
--
-- WHY THE PAY READ IS NOT THE BOARD'S PAY FILTER. The board's stated-pay
-- filter reads the parsed annual floor column, and the structured parser
-- deliberately refuses to annualise a load-dependent rate (an hourly figure
-- at an unknown weekly load cannot be annualised honestly). That is correct
-- for a pay-floor filter and wrong for this clause: an hourly rate IS
-- information about expected compensation. Measured over 2,000 sampled
-- Ontario rows on 2026-09-22, the annual-floor column sees roughly 30% of
-- them while the employer's own pay text carries a figure on roughly 54%,
-- rising further once the description body is read. Building this on the
-- filter would have printed several thousand postings that plainly quote an
-- hourly range as saying nothing. So the pay read goes to the employer's pay
-- text first, and only then to a currency figure standing near a pay word in
-- the description body; the basis it used is returned beside the evidence.
--
-- THE SCREENING READ IS PROXIMITY-BOUND, NOT A PHRASE COUNT. One sampled
-- posting matched the bare phrase inside its job DUTIES (a legal co-op asked
-- to work with the technology), which is not a disclosure about recruitment
-- at all. The pattern therefore requires the phrase to stand within a small
-- character window of a screening verb or of the applicant noun, and the
-- window is a named constant here so the client that re-checks the returned
-- evidence can be pinned to the same number. A known and stated under-read
-- rides with it: a posting that discloses the practice using only the
-- two-letter abbreviation is not matched, because a bare two-letter token
-- matches far too much else. Under-reading prints nothing; over-reading
-- prints a false disclosure, and only one of those is recoverable.
--
-- SCOPE AND THE EXCLUSIONS, EACH NAMED AS THE THING THAT WAS ACTUALLY
-- APPLIED. Rows are taken by the stored ISO subdivision code, never by a
-- fuzzy location term -- the public board's location filter expands to a term
-- list that also catches Ontario, California and Ontario, Ohio. Rows dropped
-- from the employer's own feed are excluded.
--
--   * THE COMPENSATION CEILING (O. Reg. 476/24 s.3) IS A CANADIAN-DOLLAR
--     NUMBER AND IS ONLY EVER COMPARED WITH ONE. The board's annual columns
--     are NOT converted -- each holds the figure as the posting stated it, in
--     the posting's own currency -- so comparing a ceiling in one currency
--     against a figure in another is not a comparison at all. It was claimed
--     here that the error direction was always exclusion; that is true only
--     for currencies weaker than the Canadian dollar. A stronger one states a
--     SMALLER number for the same money, so a posting above the real ceiling
--     passed the test and was surfaced. The ceiling is therefore applied only
--     where the posting's currency is Canadian dollars or unstated, and a
--     posting that states a figure in any other currency is DROPPED rather
--     than judged against a number it is not denominated in. The panel prints
--     the ceiling in Canadian dollars, and that is now the same quantity the
--     predicate applies.
--   * WORK PERFORMED OUTSIDE ONTARIO (s.2(1)(d)) IS NOT WHAT THE REMOTE FLAG
--     SAYS, and the copy no longer pretends otherwise. What is applied is the
--     employer feed's own remote flag: a role worked remotely FROM Ontario is
--     work performed in Ontario and the statute reaches it, so dropping those
--     rows under-reads. It is kept because the board stores no work location
--     for a remote posting at all, and the copy names the flag rather than
--     the clause.
--
-- Both exclusions therefore run in the direction that says LESS: an exclusion
-- is silence, and silence is the recoverable error. The regulation's cap on
-- how wide a stated range may be is NOT applied: judging a range's width is a
-- verdict, which this reader does not return.
--
-- THE PAY FIELD IS NOT QUOTED JUST BECAUSE IT CARRIES A DIGIT. The currency
-- pattern below catches the measured shapes, and the fallback that quotes the
-- employer's whole pay field exists because plenty of feeds state a rate with
-- no currency mark at all. A bare digit is a wider door than the clause
-- needs: a field holding a pay grade, a band or a requisition number would be
-- printed as what the posting states for expected compensation. So the
-- fallback requires a digit to stand within the pay window of a pay word, and
-- the client mirror applies the same rule to the evidence it is handed.

SET LOCAL statement_timeout = '1min';

CREATE OR REPLACE FUNCTION public.get_ontario_posting_disclosures(p_id text)
RETURNS TABLE (
  od_id                            text,
  od_read_at                       timestamptz,
  od_pay_evidence                  text,
  od_pay_basis                     text,
  od_vacancy_evidence              text,
  od_ai_evidence                   text,
  od_canadian_experience_evidence  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $fn$
  WITH k AS (
    SELECT 'CA-ON'::text   AS region_scope,
           200000::numeric AS comp_exempt_annual,
           40::int         AS ai_near_chars,
           80::int         AS pay_near_chars,
           240::int        AS evidence_cap
  ),
  fig AS (
    SELECT '(?:CAD|CDN|USD|C\$|\$)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?(?:\s*(?:-|to|and)\s*(?:CAD|CDN|USD|C\$|\$)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?)?(?:\s*(?:per|an|a|/)\s*(?:hour|hr|year|yr|annum|week|wk|day|month|mo)[a-z]*)?'::text AS core
  ),
  pat AS (
    SELECT
      '(' || fig.core || ')'                                                                                  AS salary_figure,
      format('((?:salary|compensation|wage|pay|rate).{0,%s}?%s)', k.pay_near_chars, fig.core)                  AS pay_fwd,
      format('(%s.{0,%s}?(?:salary|compensation|wage|pay|rate))', fig.core, k.pay_near_chars)                  AS pay_rev,
      format('\y(?:salary|compensation|wage|pay|rate|hour|hourly|annually)\y.{0,%s}?[0-9]', k.pay_near_chars)  AS pay_word_fwd,
      format('[0-9].{0,%s}?\y(?:salary|compensation|wage|pay|rate|hour|hourly|annually)\y', k.pay_near_chars)  AS pay_word_rev,
      format('(artificial intelligence.{0,%s}?(?:screen|assess|select|applicant))', k.ai_near_chars)           AS ai_fwd,
      format('((?:screen|assess|select|applicant).{0,%s}?artificial intelligence)', k.ai_near_chars)           AS ai_rev,
      format('(.{0,%s}existing vacanc.{0,%s})', k.pay_near_chars, k.pay_near_chars)                            AS vacancy,
      format('(.{0,%s}canadian experience.{0,%s})', k.pay_near_chars, k.pay_near_chars)                        AS canadian_exp
    FROM k, fig
  ),
  src AS (
    SELECT p.id, p.last_seen, p.salary, p.description
    FROM public.job_board_postings p, k
    WHERE p.id = p_id
      AND p.region_code = k.region_scope
      AND p.missing_since IS NULL
      AND (COALESCE(p.salary_max_annual, p.salary_min_annual) IS NULL
           OR (upper(btrim(COALESCE(p.salary_currency, 'CAD'))) = 'CAD'
               AND COALESCE(p.salary_max_annual, p.salary_min_annual) <= k.comp_exempt_annual))
      AND p.remote IS NOT TRUE
  ),
  ev AS (
    SELECT
      s.id,
      s.last_seen,
      k.evidence_cap                                                                    AS cap,
      (regexp_match(s.salary, pat.salary_figure, 'i'))[1]                               AS pay_field_hit,
      CASE WHEN s.salary ~* pat.pay_word_fwd OR s.salary ~* pat.pay_word_rev
           THEN btrim(s.salary) END                                                     AS pay_field_whole,
      COALESCE((regexp_match(s.description, pat.pay_fwd, 'i'))[1],
               (regexp_match(s.description, pat.pay_rev, 'i'))[1])                      AS pay_body,
      (regexp_match(s.description, pat.vacancy, 'i'))[1]                                AS vacancy_hit,
      COALESCE((regexp_match(s.description, pat.ai_fwd, 'i'))[1],
               (regexp_match(s.description, pat.ai_rev, 'i'))[1])                       AS ai_hit,
      (regexp_match(s.description, pat.canadian_exp, 'i'))[1]                           AS canadian_hit
    FROM src s, pat, k
  )
  SELECT
    ev.id                                                                               AS od_id,
    ev.last_seen                                                                        AS od_read_at,
    left(btrim(COALESCE(ev.pay_field_hit, ev.pay_field_whole, ev.pay_body)), ev.cap)    AS od_pay_evidence,
    CASE
      WHEN COALESCE(ev.pay_field_hit, ev.pay_field_whole) IS NOT NULL THEN 'salary_field'
      WHEN ev.pay_body IS NOT NULL                                    THEN 'description'
    END                                                                                 AS od_pay_basis,
    left(btrim(ev.vacancy_hit), ev.cap)                                                 AS od_vacancy_evidence,
    left(btrim(ev.ai_hit), ev.cap)                                                      AS od_ai_evidence,
    left(btrim(ev.canadian_hit), ev.cap)                                                AS od_canadian_experience_evidence
  FROM ev;
$fn$;

COMMENT ON FUNCTION public.get_ontario_posting_disclosures(text) IS
  'Per-posting EVIDENCE for the four Ontario ESA Part III.1 job-posting clauses (ss. 8.2(1), 8.3(1), '
  '8.4(1), 8.5(1)(a), in force 2026-01-01), scoped to one posting id whose stored subdivision code is '
  'CA-ON and which the employer''s feed still lists. Returns the posting''s own words and NOTHING ELSE: '
  'no verdict, no score, no percentage, no count. O. Reg. 476/24 s.1 exempts an employer below its '
  'headcount threshold and this database holds no headcount for any employer, so whether Part III.1 '
  'applied to a given posting at all IS NOT KNOWABLE FROM OUR DATA. No surface built on this reader may '
  'ever say that an employer broke the law, failed to comply, or is in violation; it may say only what '
  'the posting does and does not state, with the section cited. The AI and Canadian-experience fields '
  'are PRESENT-ONLY (s. 8.4 binds only an employer that screens with the technology, and s. 8.3 is a '
  'prohibition): null there means nothing was found, never that something is missing. Pay evidence '
  'comes from the employer''s pay text first and the description body second, because an hourly rate is '
  'a s. 8.2 disclosure even though the annual-floor column cannot hold one; od_pay_basis names which. '
  'The pay field is quoted whole only when a digit in it stands within the pay window of a pay word, so '
  'a grade, a band or a requisition number is not printed as expected compensation. Exclusions applied '
  'inside, each named as what it actually is: O. Reg. 476/24 s.3, the compensation ceiling, applied only '
  'where the posting''s currency is CAD or unstated and dropping any posting that states a figure in '
  'another currency (the annual columns are not converted, so a ceiling in one currency cannot judge a '
  'figure in another); and the employer feed''s own remote flag, which is NOT the same fact as s.2(1)(d) '
  'work performed outside Ontario and is applied as an under-read. Zero rows means the posting is out of '
  'scope or excluded, and prints nothing -- never an absence.';

-- A GRANT is not a restriction: PostgreSQL grants EXECUTE to PUBLIC by
-- default, so the revoke has to come first and has to name the roles.
REVOKE ALL ON FUNCTION public.get_ontario_posting_disclosures(text) FROM PUBLIC, anon, authenticated;

-- anon DOES need this one, and that is a decision, not an oversight. The
-- surface is a panel on the public board, which signed-out visitors read; the
-- payload is a strict subset of what the board's own detail action already
-- serves for the same id (the employer's pay text and description body),
-- capped to short substrings, one row per call, with an exact id required and
-- no offset, no listing and no pattern argument -- so unlike the search
-- readers it cannot be walked to reconstitute the corpus. It returns neither
-- the apply URL nor the title nor the company, so a row is worthless to
-- anyone who does not already hold the posting.
GRANT EXECUTE ON FUNCTION public.get_ontario_posting_disclosures(text) TO anon, authenticated, service_role;

-- A security migration that quietly did nothing is worse than one that fails,
-- so it proves its own end state from the catalog rather than assuming it.
DO $verify$
DECLARE
  fn_oid oid;
BEGIN
  SELECT p.oid INTO fn_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_ontario_posting_disclosures';
  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'the Ontario disclosure reader was not created';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn_oid) THEN
    RAISE EXCEPTION 'the Ontario disclosure reader is not running as its owner; under the corpus lockdown it would return zero rows to anon instead of raising';
  END IF;
  -- PUBLIC is grantee 0 in the ACL and has no role row to ask about, so the
  -- check reads the ACL itself. A null ACL is the dangerous case, not the
  -- safe one: it means the built-in default (which includes PUBLIC) stands.
  IF (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = fn_oid) THEN
    RAISE EXCEPTION 'the Ontario disclosure reader still carries default privileges, so PUBLIC can execute it';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
    WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'the default grant to PUBLIC survived the revoke on the Ontario disclosure reader';
  END IF;
  IF NOT has_function_privilege('anon', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'the Ontario disclosure reader is unreachable from the public board';
  END IF;
END
$verify$;
