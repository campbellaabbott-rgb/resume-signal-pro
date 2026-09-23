-- A FILED WAGE IS A CELL THAT CARRIES THE FILE IT CAME FROM.
--
-- The US Department of Labor's Office of Foreign Labor Certification
-- publishes one disclosure file per fiscal quarter listing every Labor
-- Condition Application it decided. One row of that file is one application:
-- an employer, an occupation (SOC), a worksite state, and the wage range the
-- employer FILED for it. This table holds those rows folded to one cell per
-- (board token, SOC code, worksite state), which is the smallest unit a
-- surface may honestly print -- a single application is a number, not a
-- range, and a number with no occupation and no state beside it is not about
-- any job anyone is looking at.
--
-- WHAT A ROW IS NOT. It is not what the employer pays; it is not what the
-- employer will pay; it is not a salary for any posting on this board. It is
-- what was filed, in one quarter, for applications the Department certified.
-- Every column that could be mistaken for a promise is therefore stored with
-- the two things that date it: the file it was read from and that file's
-- publication date. A surface that prints a figure from here and does not
-- print those two has invented a basis (project_stat_provenance).
--
-- THE STATUS BAR IS AN EQUALITY, AND IT IS APPLIED BEFORE THIS TABLE. Only
-- applications whose decision equals the certified status reach a cell. The
-- loader refuses the longer status that begins with the same word -- the
-- withdrawn-after-certification decision, 26,303 rows of the quarter measured
-- on 2026-09-22 -- and counts them rather than dropping them silently. A
-- prefix test there would raise every employer's filed ceiling with
-- applications the employer itself pulled.
--
-- HOW A NAME BECAME A TOKEN. The same way a layoff filing does, by the same
-- normaliser and against the same mirrored board names, under the same
-- two-token / one-employer rule. There is one matcher and one alias ledger
-- for filings and for these cells; the join is done by the operator loader
-- (scripts/load-oflc-lca.mjs), which reads this database not at all.
--
-- LICENCE. dol.gov/general/aboutdol/copyright: a work of the US government,
-- public domain and redistributable. Two obligations ride along and are
-- carried by the copy, not by this table: the source is named wherever a
-- number from it is printed, and nothing may suggest the Department endorses
-- this site.
--
-- NO POLICY, BY DESIGN. Row-level security is on and no policy is written:
-- every read goes through the SECURITY DEFINER reader, which is where the
-- minimum-filings bar and the one-row-per-asked-token rule live. A client
-- that could read the table directly could print a cell the bar refuses.

SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.oflc_lca_wages (
  company_token      text        NOT NULL,
  soc_code           text        NOT NULL,
  worksite_state     text        NOT NULL,
  soc_title          text,
  wage_low_annual    numeric(14, 2) NOT NULL,
  wage_high_annual   numeric(14, 2) NOT NULL,
  wage_median_annual numeric(14, 2) NOT NULL,
  filings_n          integer     NOT NULL,
  source_file        text        NOT NULL,
  source_url         text        NOT NULL,
  fiscal_quarter     text        NOT NULL,
  published_on       date        NOT NULL,
  loaded_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oflc_lca_wages_pkey PRIMARY KEY (company_token, soc_code, worksite_state),
  -- A SOC code is two digits, a dash and four digits. The file spells some of
  -- them with a trailing detail code; the loader cuts to the six-digit form so
  -- one occupation is one cell.
  CONSTRAINT oflc_lca_wages_soc_shape CHECK (soc_code ~ '^[0-9]{2}-[0-9]{4}$'),
  -- A worksite state is a two-letter code, upper case, never a spelled-out name.
  CONSTRAINT oflc_lca_wages_state_shape CHECK (worksite_state ~ '^[A-Z]{2}$'),
  -- A range is two numbers in order, both above zero: a zero wage is a cell
  -- the file did not state, and an unstated figure is never stored as nought.
  CONSTRAINT oflc_lca_wages_low_positive CHECK (wage_low_annual > 0),
  CONSTRAINT oflc_lca_wages_ordered CHECK (wage_high_annual >= wage_low_annual),
  CONSTRAINT oflc_lca_wages_median_inside CHECK (wage_median_annual >= wage_low_annual AND wage_median_annual <= wage_high_annual),
  -- A cell exists because applications are behind it; a cell claiming none is
  -- a cell with no basis.
  CONSTRAINT oflc_lca_wages_counted CHECK (filings_n > 0),
  -- The provenance a surface must be able to print. A link that is not https
  -- is refused at the table, not only at the writer.
  CONSTRAINT oflc_lca_wages_source_https CHECK (source_url LIKE 'https://%'),
  CONSTRAINT oflc_lca_wages_file_named CHECK (btrim(source_file) <> ''),
  CONSTRAINT oflc_lca_wages_quarter_named CHECK (btrim(fiscal_quarter) <> '')
);

COMMENT ON TABLE public.oflc_lca_wages IS
  'Certified Labor Condition Application wage cells from the US Department of Labor OFLC quarterly '
  'disclosure file, folded to one row per (board token, SOC code, worksite state). Filed wages for '
  'certified applications in one quarter; never what an employer pays, will pay, or offers for a '
  'posting. Every row carries the file it was read from and that file public date so no surface can '
  'print a figure without its basis. Loaded by the operator script; read only through the SECURITY '
  'DEFINER reader, which holds the minimum-filings bar.';

COMMENT ON COLUMN public.oflc_lca_wages.filings_n IS
  'Certified applications behind this cell. The reader refuses a cell below the minimum bar: a range '
  'drawn from one or two applications is two numbers, not a range.';
COMMENT ON COLUMN public.oflc_lca_wages.published_on IS
  'The date the Department published the source file. Not in the file itself; supplied by the '
  'operator, required, and printed beside every figure.';

-- The reader asks by token, then narrows by occupation and state; the primary
-- key already leads with the token. This second index serves the reader's
-- OTHER predicate: every one of its reads is scoped to a single fiscal
-- quarter and then to the asked tokens, which is exactly this pair in this
-- order.
--
-- THE WRITER'S SWEEP IS NOT INDEXED, AND THAT IS A DECISION. It deletes by
-- the run stamp, which has no index; the whole table is one quarter's
-- printable cells -- a few thousand rows, measured at 6,218 for the quarter
-- this was built against -- so the sweep is a sequential scan over a table
-- small enough that an index on it would cost more on every load than it
-- saved once a quarter. An index whose comment describes a query nobody
-- wrote is worse than no index, so this one names the query it is for.
CREATE INDEX IF NOT EXISTS oflc_lca_wages_quarter_idx ON public.oflc_lca_wages (fiscal_quarter, company_token);

ALTER TABLE public.oflc_lca_wages ENABLE ROW LEVEL SECURITY;

-- Not readable and not writable by any client role by name: the definer
-- reader is the only door, and the loader posts through the definer writer.
REVOKE ALL ON TABLE public.oflc_lca_wages FROM PUBLIC;
REVOKE ALL ON TABLE public.oflc_lca_wages FROM anon;
REVOKE ALL ON TABLE public.oflc_lca_wages FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oflc_lca_wages TO service_role;
