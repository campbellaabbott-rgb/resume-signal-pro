# Deployment checklist e919377b
- [x] Verify synced commit contains e919377b and re-run deployment ledger.
- [ ] Apply the 14 listed migrations individually and unchanged; stop on failure.
- [ ] Deploy the 61 listed functions and verify each OPTIONS build header.
- [ ] Verify held migration sections 82 and 86; release its ledger hold only if proven, without applying it.
- [ ] Verify live frontend commit; publish only if needed.
- [ ] Resolve existing spreadsheet-test compile error and run its tests.