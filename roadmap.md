# Deployment checklist 1c0c217d
- [x] Synced checkout is exactly 1c0c217dd390776b106d79e50ebfbd334bc3dda4.
- [ ] Re-run deploy ledger without editing docs/deploy-ledger.json.
- [x] Do not attempt user-applied 20261103120000 or 20261103221000; no vault access.
- [ ] Apply the ten uploaded-list migrations individually in exact order and compare each applied file byte-for-byte; stop on difference or refusal.
- [ ] Deploy all 61 listed functions and verify every OPTIONS x-fn-build.
- [ ] Verify frontend serves this commit; publish only if older.
- [x] Keep 20261011103000 held and docs/deploy-ledger.json untouched; never apply 20260928003117.