# Deployment checklist 1e81bb81
- [x] Checkout matches 1e81bb81c7affe26fb01d3e7774cdaf95bdc9f5d.
- [ ] Apply twelve pre-deploy migrations: first two applied byte-identical as 0226–0227; third (20261109120000) refused for missing sub-hourly cron review marker. STOPPED; unchanged retry requires resolution of this platform requirement.
- [ ] Deploy all 72 listed functions and verify every OPTIONS x-fn-build.
- [ ] Apply 20261109121000 after public-api build verification.
- [x] Live frontend HTML already serves exact commit 1e81bb81c7affe26fb01d3e7774cdaf95bdc9f5d; no publish performed.
- [ ] Apply 20261109122000 after frontend verification.
- [ ] Run read-only db-heavy verification; leave owner-only aggregate writer unscheduled.
- [x] Never-apply files and existing function sources untouched; stopped before any deployments or later migrations.
