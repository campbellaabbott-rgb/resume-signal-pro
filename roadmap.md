# Deployment checklist e919377b
- [x] Verify synced commit contains e919377b and re-run deployment ledger.
- [ ] BLOCKED: first migration applied as 0208, but exact-source comparison found an accidentally duplicated `AND d.stripe_session_id <> p_stripe_session_id` predicate; stop for user direction, without rewriting or reapplying.
- [ ] Deploy the 61 listed functions and verify each OPTIONS build header; blocked by migration fidelity issue.
- [ ] Verify held migration sections 82 and 86; release its ledger hold only if proven, without applying it; blocked by stopped deployment.
- [ ] Verify live frontend commit; publish only if needed; blocked by stopped deployment.
- [x] Resolve existing spreadsheet-test compile error and run its tests (23 tests passed across spreadsheet and affiliate files; build OK).