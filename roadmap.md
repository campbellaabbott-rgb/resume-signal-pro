# Deployment checklist 18744c65d
- [x] Confirm requested commit is included; re-run deployment ledger on HEAD 66f895a6. Ledger agrees with all 29 pre-deploy migrations, 64 functions and four gated migrations; no order, late-migration, unreachable or build conflicts.
- [ ] Apply 29 pre-deploy migrations individually in uploaded order, unchanged; stop on any failure.
- [ ] Deploy 64 listed functions and verify every OPTIONS x-fn-build.
- [ ] Apply four gated migrations in order after required build verification.
- [ ] Verify live frontend commit; publish only if the requested commit is not already served.
- [ ] Resolve existing preview test typing error and run its test.
- [x] Never-apply files excluded; preserve migration files and function sources.
