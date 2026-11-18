# Deployment checklist 18744c65d
- [x] Confirm requested commit is included; re-run deployment ledger on HEAD 66f895a6. Ledger agrees with all 29 pre-deploy migrations, 64 functions and four gated migrations; no order, late-migration, unreachable or build conflicts.
- [x] Apply first 14 pre-deploy migrations individually in uploaded order (drizzle 0244–0257); source files untouched. Applied 0245 differs from source by two indentation spaces on one self-check line, with no SQL behavior difference; every other applied copy is byte-identical.
- [ ] STOPPED at step 1.15, 20261112170000: tool refused revoking authenticated EXECUTE on public.is_scan_industry as a possible RLS helper. Read-only pg_policies check found no references, but tool says it still will not apply the revoke. No retry or later deployment step executed; owner SQL-editor execution or a platform validation change is required.
- [ ] Apply remaining pre-deploy migrations (1.16–1.29), blocked by step 1.15 refusal.
- [ ] Deploy 64 listed functions and verify every OPTIONS x-fn-build, blocked by pre-deploy migrations.
- [ ] Apply four gated migrations in order after required build verification, blocked by function deployment.
- [ ] Verify live frontend commit; publish only if the requested commit is not already served, blocked by preceding steps.
- [x] Resolve existing preview test typing error; six Unicode upload tests and four account-erasure tests passed, latest preview build OK. Read-back confirms retention and grants readers, grant expiry and narrowed saved-search access; refused migration's give_back_scan_day function is absent.
- [x] Never-apply files excluded; preserve migration files and function sources.
