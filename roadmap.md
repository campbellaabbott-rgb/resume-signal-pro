# Deployment checklist 2026-11-22 — waiting for requested source
- [ ] Make source from owner-identified GitHub branch `ship/1122-connector-and-fixes` available in the synced checkout. Branch is not present locally and the public GitHub API returned 404; waiting for the owner to merge it into the synced main branch and provide the merged commit.
- [ ] Apply 20261121130000, 20261206100000, 20261206110000, and 20261206130000 individually in that order. Blocked: all four source files are absent from checkout f95e92c582e5d2816805f2dbb94062898f6156cc; no migration attempted.
- [ ] Deploy agent-mcp, analyze-resume, generate-interview-coach, public-api, reconcile-stripe, recover-purchase, retry-failed-deliveries, and send-search-digest; verify the eight requested OPTIONS build markers. Blocked: checkout carries older function builds; do not deploy them in place of the requested versions.
- [ ] Check whether the live frontend serves the deployment commit; publish only if needed after migrations and function verification. Blocked: requested deployment source is not yet available.

# Deployment checklist dce1abd09
- [x] Apply eight unchanged migrations in uploaded order (drizzle 0275–0282); all self-checks passed, every copy byte-exact, no retries or staging. Never-apply list untouched.
- [x] Deploy all 14 functions and verify every requested OPTIONS build (all 200, all exact matches).
- [x] Status first reported sliceStats.build 2026-09-09.103 at 16:33 UTC; applied unchanged data-only 20261117110000 through the data query tool and recorded it in appliedOutsideDrizzle. Live read-back: catalogSize = catalogHighwater = 44163, orphanPruneBlocked = false.
- [x] Live homepage serves dce1abd09b80f9a0c5ae9c5165cd6a08eac90511; no redundant frontend publish. Checkout started at exactly requested commit; no fetch or pull needed.
- [x] Resolve carried-over preview test typing error; upload test passed 7 tests, six existing deployment-rule test files passed 39 tests. Latest preview build OK. Function and source migration folders unchanged.

# Previous deployment checklist 9c9234e9a — resumed round A
- [x] Confirm requested commit is included; re-run deployment ledger on HEAD 66f895a6. Ledger agrees with all 29 pre-deploy migrations, 64 functions and four gated migrations; no order, late-migration, unreachable or build conflicts.
- [x] Apply first 14 pre-deploy migrations individually in uploaded order (drizzle 0244–0257); source files untouched. Applied 0245 differs from source by two indentation spaces on one self-check line, with no SQL behavior difference; every other applied copy is byte-identical.
- [x] Confirm HEAD is exactly requested commit 9c9234e9a; corrected unapplied source now names scan_industry_known. Owner accepts applied 0245 whitespace difference.
- [x] Apply steps 1.1–1.7 in order: 20261112170000, 180000, 181000, 182000, 190000, 191000, 191500. Six schema migrations applied as drizzle 0258–0263, all byte-exact against source. Data-only 20261112190000 ran unchanged through the data query tool, passed its self-check, and is recorded in appliedOutsideDrizzle. Live read-back confirmed scan refund/helper, four refused wage tokens, retention, first-read preservation, revenue corrections, and both trend watch gates.
- [x] Continue at 1.8 through 20261112211000 under uploaded 2026-11-18 continuation, HEAD 4fe791740. Eight unchanged files applied individually as drizzle 0264–0271. Staged lengths and MD5 values matched every source byte, including both owner-specified large-file fingerprints. No failures or retries; live catalogue confirms returned-role rules, ghost window columns, scan floor, staffing exclusion, fit refund table and shortlist deletion functions.
- [x] Deploy all 64 listed functions in four batches; all 64 OPTIONS responses answer the exact requested x-fn-build. Stripe webhook OPTIONS is 405 with the correct build marker; other 63 are 200. Function source files untouched.
- [x] Apply four gated updates in order after required build verification: affiliate migrations as drizzle 0272–0274; data-only 20261112163000 executed unchanged through the data query tool and recorded in appliedOutsideDrizzle. All staged gated files match their source bytes, including affiliate sign-in length 39180 and MD5 f3fd812dedf9347deb8a9ef81f0216d4. Self-checks passed.
- [x] Live homepage serves data-commit-sha 4fe7917403ff8e1ce4ec468fdf2d3114d7cee40c; no redundant frontend publish.
- [x] Previous-turn preview test typing fix retained; current preview build OK. The previously refused give_back_scan_day function now exists, confirmed by live read-back this turn.
- [x] Never-apply files excluded; preserve migration files and function sources.
