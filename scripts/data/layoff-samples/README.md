# Layoff-filing samples (test fixtures)

Real documents fetched read-only on 2026-09-18 by the layoff-filings research
pass, kept so the poller's Deno tests (supabase/functions/layoff-filings/*_test.ts)
run from the repository with no network and no environment variable.

- `docs/`, `holdout/`, `sub_*.json`, `submissions_*.json`, `getcurrent_8k*.atom`,
  `efts_*.json` — SEC EDGAR documents, submissions JSON, the latest-filings Atom
  feed and full-text-search responses. Public domain (17 U.S.C. § 105).
- `bln-*.csv`, `bln-jobs.json`, `bln-runs.json` — Big Local News `warn-github-flow`
  raw per-state files and workflow status. Apache-2.0; see BLN-LICENSE.
- `ca-warn_report1.xlsx`, `tx-2026.xlsx`, `il-export.xlsx`, `fl-2026.html`,
  `ny-tableau.csv`, `oh-2026.csv`, `wa-search.html` — state workforce-agency
  WARN publications, fetched directly. Public records.
- `parse205_v2_*.json` — the hand labels the parser is scored against.

These live under scripts/data, not under supabase/functions: the deploy runner
moves anything that is not TypeScript out of a function directory. To run the
same tests against a fresh capture, set LAYOFF_SAMPLES_DIR.
