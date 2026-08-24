-- A PLACE NAME IS NOT A LATITUDE.
--
-- Some Greenhouse employers append the geocode to the location string, and
-- the board rendered it verbatim on the card:
--
--     BAYADA Home Health Care · Waipahu, HI 96797 | 21.396369637 | -158.01142287
--
-- Measured 2026-08-24: of 1,000 sampled servable postings whose location
-- contains a pipe, 398 carry this coordinate suffix — every one of them
-- Greenhouse, no other vendor affected.
--
-- THE PATTERN IS NARROW ON PURPOSE. A pipe in a location is usually real and
-- must survive: "Latin & South America | Remote", "San Francisco, CA | New
-- York City, NY", "3 Locations   |   PT-Orlando - South". Only a TRAILING run
-- of one or two decimal numbers is removed, and only when each has at least
-- three decimal places — a postcode, a street number or a site code cannot
-- match, and the separator itself is never touched.
--
-- The normalizer applies the same rule at ingest from this commit, so newly
-- fetched rows arrive clean; this corrects the rows already stored. Trailing
-- whitespace left by the strip is trimmed in the same pass. Idempotent: a
-- corrected row no longer matches the predicate.

UPDATE public.job_board_postings
SET location = btrim(regexp_replace(
      location,
      '\s*\|\s*-?[0-9]{1,3}\.[0-9]{3,}(\s*\|\s*-?[0-9]{1,3}\.[0-9]{3,})?\s*$',
      ''
    ))
WHERE source = 'greenhouse'
  AND location ~ '\|\s*-?[0-9]{1,3}\.[0-9]{3,}\s*(\|\s*-?[0-9]{1,3}\.[0-9]{3,}\s*)?$';
