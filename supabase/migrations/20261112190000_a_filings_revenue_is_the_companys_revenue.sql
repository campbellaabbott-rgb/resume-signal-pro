-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the bug round A integration).
--
-- A FILING'S REVENUE IS THE COMPANY'S REVENUE (S14X-026).
--
-- company_financials was seeded (20260722234500, copied in 20260723021844)
-- with each filer's ASC 606 contract-revenue line,
-- us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax, read as if it
-- were the company's revenue. For a filer whose total revenue includes lines
-- that are not contracts with customers (premiums, interest, rental income,
-- financing income), that line is a fraction of the total, and the employer
-- page printed it under "Figures as filed":
--   Oscar Health FY2025      $28.6M     (total revenues $11.70B)
--   M&T Bank FY2025          $1.657B    beside net income $2.851B
--   U-Haul FY2026            $761M      (total revenues $6.04B)
--   Affirm FY2025            $1.11B     (total revenues $3.22B)
--   Sunbelt Rentals FY2026   $2.509B    beside net income $1.325B
-- and Centene, General Motors, Pfizer (FY2023) and Unisys (FY2023) printed a
-- part of their revenue in the same way.
--
-- Each corrected figure below is the filing's total-revenue concept,
-- us-gaap:Revenues, for the same fiscal period (the period whose
-- us-gaap:NetIncomeLoss equals the stored net income), read from SEC's XBRL
-- company facts on 2026-11-16, as stated in the filer's latest 10-K that
-- reports the period. The accession number is written into the entry it
-- corrects (revenue_basis), so every figure carries its own citation. M&T
-- Bank tags no total-revenue concept for FY2024 or FY2025 (no
-- us-gaap:Revenues, no us-gaap:RevenuesNetOfInterestExpense), so those years
-- store no revenue at all rather than a part of one; FY2023 was already
-- empty. Net income is not touched anywhere.
--
-- A NEGATIVE NET INCOME LARGER THAN REVENUE IS NOT AN ERROR and is left
-- alone: Revolution Medicines reported no revenue in FY2024 and FY2025 with a
-- loss, and Sunrun's FY2024 loss includes an impairment larger than its
-- revenue. What cannot be true is a positive net income above revenue, so
-- the self-check refuses that on every row of the table, not only on the
-- rows this file changes.
--
-- Rows not named here are not changed. A seeded year with no revenue stays
-- empty: this file corrects figures, it does not add ones the seed lacked.
-- get_company_financials passes the series through unchanged, so the
-- corrected figures reach the employer page, the company context line and
-- the compare view with no function change. Safe to run twice: an entry is
-- rewritten only while its stored revenue differs from the filing's.

DO $fix$
DECLARE
  -- One entry per corrected fiscal year: the filing's total revenue (or none)
  -- and the filing it is read from.
  v_fix  jsonb := '[
    {"slug": "affirm", "fy": 2025, "revenue": 3224412000, "basis": "10-K 0001628280-26-059279 us-gaap:Revenues"},
    {"slug": "affirm", "fy": 2024, "revenue": 2322999000, "basis": "10-K 0001628280-26-059279 us-gaap:Revenues"},
    {"slug": "affirm", "fy": 2023, "revenue": 1587985000, "basis": "10-K 0001820953-25-000080 us-gaap:Revenues"},
    {"slug": "centene", "fy": 2025, "revenue": 194777000000, "basis": "10-K 0001071739-26-000049 us-gaap:Revenues"},
    {"slug": "centene", "fy": 2024, "revenue": 163071000000, "basis": "10-K 0001071739-26-000049 us-gaap:Revenues"},
    {"slug": "centene", "fy": 2023, "revenue": 153999000000, "basis": "10-K 0001071739-26-000049 us-gaap:Revenues"},
    {"slug": "generalmotors", "fy": 2025, "revenue": 185019000000, "basis": "10-K 0001467858-26-000013 us-gaap:Revenues"},
    {"slug": "generalmotors", "fy": 2024, "revenue": 187442000000, "basis": "10-K 0001467858-26-000013 us-gaap:Revenues"},
    {"slug": "generalmotors", "fy": 2023, "revenue": 171842000000, "basis": "10-K 0001467858-26-000013 us-gaap:Revenues"},
    {"slug": "mtb", "fy": 2025, "revenue": null, "basis": "10-K 0000036270-26-000010 tags no total-revenue concept"},
    {"slug": "mtb", "fy": 2024, "revenue": null, "basis": "10-K 0000036270-26-000010 tags no total-revenue concept"},
    {"slug": "oscar", "fy": 2025, "revenue": 11701427000, "basis": "10-K 0001568651-26-000011 us-gaap:Revenues"},
    {"slug": "oscar", "fy": 2024, "revenue": 9177564000, "basis": "10-K 0001568651-26-000011 us-gaap:Revenues"},
    {"slug": "oscar", "fy": 2023, "revenue": 5862869000, "basis": "10-K 0001568651-26-000011 us-gaap:Revenues"},
    {"slug": "pfizer", "fy": 2023, "revenue": 59553000000, "basis": "10-K 0000078003-26-000026 us-gaap:Revenues"},
    {"slug": "sunbeltrentals", "fy": 2026, "revenue": 11154000000, "basis": "10-K 0001628280-26-044888 us-gaap:Revenues"},
    {"slug": "uhaul", "fy": 2026, "revenue": 6037819000, "basis": "10-K 0001193125-26-241850 us-gaap:Revenues"},
    {"slug": "uhaul", "fy": 2025, "revenue": 5828665000, "basis": "10-K 0001193125-26-241850 us-gaap:Revenues"},
    {"slug": "uhaul", "fy": 2024, "revenue": 5625674000, "basis": "10-K 0001193125-26-241850 us-gaap:Revenues"},
    {"slug": "unisys", "fy": 2023, "revenue": 2015400000, "basis": "10-K 0000746838-26-000006 us-gaap:Revenues"}
  ]';
  v_bad  text;
  v_miss text;
  v_rev  numeric;
BEGIN
  UPDATE public.company_financials f
     SET series = (
           SELECT jsonb_agg(
                    CASE WHEN x.slug IS NULL THEN s.e
                         ELSE jsonb_set(s.e, '{revenue}', COALESCE(to_jsonb(x.revenue), 'null'::jsonb))
                              || jsonb_build_object('revenue_basis', x.basis)
                    END
                    ORDER BY s.ord)
             FROM jsonb_array_elements(f.series) WITH ORDINALITY AS s(e, ord)
             LEFT JOIN jsonb_to_recordset(v_fix) AS x(slug text, fy int, revenue bigint, basis text)
                    ON x.slug = f.slug AND x.fy = (s.e->>'fy')::int
         ),
         updated_at = now()
   WHERE EXISTS (
           SELECT 1
             FROM jsonb_array_elements(f.series) AS s(e)
             JOIN jsonb_to_recordset(v_fix) AS x(slug text, fy int, revenue bigint, basis text)
               ON x.slug = f.slug AND x.fy = (s.e->>'fy')::int
            WHERE (s.e->>'revenue')::numeric IS DISTINCT FROM x.revenue::numeric
               OR s.e->>'revenue_basis' IS DISTINCT FROM x.basis
         );

  -- Every correction landed, on the year it names.
  SELECT string_agg(x.slug || ' FY' || x.fy, ', ') INTO v_miss
    FROM jsonb_to_recordset(v_fix) AS x(slug text, fy int, revenue bigint, basis text)
   WHERE EXISTS (SELECT 1 FROM public.company_financials f WHERE f.slug = x.slug)
     AND NOT EXISTS (
           SELECT 1
             FROM public.company_financials f, jsonb_array_elements(f.series) AS s(e)
            WHERE f.slug = x.slug
              AND (s.e->>'fy')::int = x.fy
              AND (s.e->>'revenue')::numeric IS NOT DISTINCT FROM x.revenue::numeric
              AND s.e->>'revenue_basis' = x.basis);
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION 'company_financials: the filing''s total revenue did not land for %', v_miss;
  END IF;

  -- No row anywhere states a positive net income above its revenue.
  SELECT string_agg(f.slug || ' FY' || (s.e->>'fy'), ', ') INTO v_bad
    FROM public.company_financials f, jsonb_array_elements(f.series) AS s(e)
   WHERE (s.e->>'net_income')::numeric > 0
     AND (s.e->>'revenue')::numeric < (s.e->>'net_income')::numeric;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'company_financials: a positive net income above revenue remains for %', v_bad;
  END IF;

  -- The losses larger than revenue are genuine and stay as filed.
  SELECT (s.e->>'revenue')::numeric INTO v_rev
    FROM public.company_financials f, jsonb_array_elements(f.series) AS s(e)
   WHERE f.slug = 'revolutionmedicines' AND (s.e->>'fy')::int = 2025;
  IF FOUND AND v_rev IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'company_financials: revolutionmedicines FY2025 revenue moved to %', v_rev;
  END IF;
  SELECT (s.e->>'revenue')::numeric INTO v_rev
    FROM public.company_financials f, jsonb_array_elements(f.series) AS s(e)
   WHERE f.slug = 'sunrun' AND (s.e->>'fy')::int = 2024;
  IF FOUND AND v_rev IS DISTINCT FROM 2037719000 THEN
    RAISE EXCEPTION 'company_financials: sunrun FY2024 revenue moved to %', v_rev;
  END IF;
END $fix$;
