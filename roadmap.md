# Deployment checklist 6dff19e95
- [x] Checkout matches 6dff19e95f457fb74d97365eae8237323497a323; replacement checklist supersedes earlier requests.
- [ ] STOPPED at first file, 20261109120000_the_facets_cron_rebuilds_only_a_row_the_board_pass_left_old.sql: unchanged SQL including its full marker block was refused. Tool requires the exact first-line format `-- lovable-cron-fallback-reviewed: <reason>`; owner forbids editing. No migration applied or later step executed.
- [ ] Verify required cron-health and read-only cost checks; leave the owner-only aggregate writer unscheduled.
- [ ] Deploy free-keyword-scan, job-board, and layoff-filings and verify their expected OPTIONS x-fn-build values.
- [ ] Verify job-board status sliceStats.build is 2026-09-09.102 or later, then apply 20261111110000 and 20261111120000 in order under their supplied conditions.
- [ ] Verify live frontend commit; publish only if it does not serve this commit.
- [ ] Apply 20261109122000 only after frontend verification.
- [x] Previously applied 0226–0227 and never-apply files are excluded; preserve all committed migration and function sources.
