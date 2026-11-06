# Deployment checklist 91b20f5c
- [x] Verify synced commit is 91b20f5c and re-run deployment ledger.
- [x] Leave migration 0208 as applied, per user instruction; do not reapply it.
- [ ] Apply remaining 13 migrations individually in order; compare each applied SQL with its original and stop on failure or difference.
- [ ] Deploy the 61 listed functions and verify each OPTIONS build header.
- [x] Leave 20261011103000 held and docs/deploy-ledger.json unchanged; never apply 20260928003117.
- [ ] Verify live frontend commit; publish only if needed.
- [x] Resolve existing spreadsheet-test compile error and run its tests (23 tests passed across spreadsheet and affiliate files; build OK).