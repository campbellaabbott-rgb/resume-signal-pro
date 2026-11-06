# Deployment checklist 91b20f5c
- [x] Verify synced commit is 91b20f5c and re-run deployment ledger.
- [x] Leave migration 0208 as applied, per user instruction; do not reapply it.
- [ ] Apply remaining 13 migrations individually in order: 20261103110000 applied as 0209 and byte-identical; BLOCKED at 20261103120000 with "Agent access to secrets is not allowed." No changes from the refused migration were found; remaining 11 migrations not attempted.
- [ ] Deploy the 61 listed functions and verify each OPTIONS build header; blocked by refused second migration.
- [x] Leave 20261011103000 held and docs/deploy-ledger.json unchanged; never apply 20260928003117.
- [x] Live frontend HTML serves full commit 91b20f5c0d4ee91f269d8ae3cac769dc4855cd93; no republish needed.
- [x] Resolve existing spreadsheet-test compile error and run its tests (23 tests passed across spreadsheet and affiliate files; build OK).