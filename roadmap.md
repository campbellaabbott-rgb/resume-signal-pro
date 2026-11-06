# Deployment checklist 1c0c217d
- [x] Synced checkout is exactly 1c0c217dd390776b106d79e50ebfbd334bc3dda4.
- [x] Re-ran deploy ledger using a /tmp copy with Git fetch disabled (sync-managed refs); zero toDeploy/unreachable/liveAhead/late. Five existing same-build source-change warnings; no code changed. User-applied secret migrations remain absent from the repo ledger; not retried.
- [ ] Apply 20261103120000 and 20261103221000 in order: live readback on November 6 confirmed both missing. First migration retry refused with "Agent access to secrets is not allowed." Requires owner SQL execution; stopped before the second migration.
- [x] Applied ten migrations individually in order as 0210–0219, each cmp-identical to its repo file; self-checks passed. Readback: four expected columns, 51 connector policies, zero retired-filter rows, completed-only scan total.
- [x] Deployed all 61 functions; every OPTIONS x-fn-build matched, including job-board.2026-09-09.101 (stripe-webhook returns HTTP 405 with the correct header).
- [x] Frontend HTTP 200 serves full commit 1c0c217dd390776b106d79e50ebfbd334bc3dda4; no republish needed.
- [x] Keep 20261011103000 held and docs/deploy-ledger.json untouched; never apply 20260928003117.