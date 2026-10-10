# Wave 3: tests-ci

Branch `wave3/tests-ci`, based on `origin/main` at 31647d4c (PR #25). No
migrations. Seven edge functions get a build stamp, and nothing else in them
changes. Four GitHub workflows change; they take effect when the branch is
merged, with no deploy. Verifier section: `scripts/verify-deploy.d/78-wave3-tests-ci.sh`.

## Why: main's CI, measured

The last 20 CI runs on main (2026-10-04 to 2026-10-10, `gh run list
--workflow ci.yml --branch main`) had **5 green and 15 red, a 25% pass rate**.
Every red run had at least one of these causes:

| Cause | Red main runs | Fixed by |
|---|---|---|
| `an-uncounted-industry-is-not-an-empty-one`: waited for the request, read the rail before the reply | 6 | this branch (L12-04) |
| `a-figure-that-left-its-window-behind`: waited for the heading, read tiles before the facet | 4 | this branch (L12-04) |
| `a-default-view-that-reached-two-tenths-of-a-percent`: same race (the latest run, 31647d4c) | 1 | this branch (L12-04) |
| `a-light-list-too-big-to-hold…`: one case over the 5 s budget | 4 (one alone) | wave 2, d3d23f52 (S8-036) |
| `newest-first-must-order-by-date`: read text while loading | 2 | wave 2, ffc95454 (L12-05) |
| `a-five-dollar-analysis…` race: 200 event-loop turns as a time budget | 1 | this branch |
| Success.tsx timer after teardown ("window is not defined"), beside a figure-test failure | 1 | already clears its timers (payments) |

A PR-run-only failure, the confirmation page's `location.hash` read (run
37707420206, S8-130), is fixed here too, along with the same race in the
paused-board test (L12-04 (5)).

**What to expect after merge:** none of the 15 red runs would fail on these
causes now, so the `test` job should be green on every push unless a commit
breaks something. The new `deno-tests` job passes locally (62 of 62). The new
`built-output` job is expected to be **red** at first, on a real finding (see
"Hand-offs"). Re-measure with section 78 after 20 runs on main.

## What changed

**Flaky tests (L12-04, S8-130).** Each test now waits for the state it asserts.
The three files with a late reply now answer 30 ms late on purpose, so the order
a loaded runner produced only sometimes is produced every time, and they carry
the mount-budget.ts budgets. The two paid-analysis race tests wait on a wall
clock (3 s) and always release their gate (one red main run, 37207688995).
How each was proven: the HEAD version of each test, with only the delay added
(or the effect's write delayed, or the handler started 10 ms late), fails with
the exact message CI printed. The new waits pass.

**ci.yml (L12-02 interim, L12-10, L12-11, L12-07).** Every check runs when its
installs succeeded, whatever an earlier check said, so a red test step no longer
hides the build and the apply-driver harness. The worker install is a strict
`npm ci`: its `|| npm install` fallback hid a lockfile drift for six weeks, and
the lockfile is regenerated (only @types/node 26.6.5 and undici-types 8.9.0
change). There are two new jobs:
- `deno-tests`, which runs `scripts/deno-tests.sh`. `check-functions.sh` runs it
  too.
- `built-output`, which builds first and then runs the five dist/ suites with
  `RB_REQUIRE_DIST=1`. Under that flag a missing dist/ fails instead of being
  skipped (`src/test/helpers/built-output.ts`).

`built-output` is a separate job because the prerender bakes live board data.
The header no longer claims a gate that main's settings do not provide.

**board-health.yml (L12-01).** It did not parse. An inline Python block started
at column 0, so GitHub never read the `*/30` schedule: 561 push-triggered
0-second failures, and no scheduled run since 2026-08-12. The fix uses jq
instead of Python. These conditions now fail the probe:
- a missing or non-numeric slice age (`[ None -gt 360 ]` used to read as a pass);
- a total of zero;
- a slice work stamp (`sliceStats.workAt`) older than 6 hours.

The label is created before the issue is filed, and a failing probe fails the
run, so GitHub emails the owner.

**botwall-sweep.yml (L12-07).** All 9 scheduled runs from 2026-08-10 to 10-05
failed. The URL and key are now read from the committed `.env` (they were read
from repo secrets that never existed), and the broker URL is derived from that
URL. **Behaviour change:** `APPLY_WORKER_SECRET` is set, so from the next
Monday run (06:12 UTC) the sweep persists wall observations through the
broker's `wall` action, as designed. Until now every run was either a failure or
a dry run.

**deploy.yml (L12-08).** The verify job read two secrets that were never set,
so it warned and exited 0 on every push. It now reads `.env`. Any run that
cannot compare fails, and the comparison is "this build or later". It is
**red on a push that bumps job-board until the Lovable deploy lands**. Re-run
the job after the deploy.

**Vacuous guards (L12-12).** Three guards were sliced on anchors that no longer
exist. They were re-anchored on code with bounds, or removed along with what
they tested. A planted mutant (a `return` in the headline track, the /jobs link
moved below the panels) passes the old guards and fails the new ones.

**setup.ts (L12-13).** The cleanup now deletes only PDFs that appeared after the
setup loaded. Before, it deleted every `*.pdf` in the project root.

**The verifier (S8-124 to S8-129, L1-06).** See commit 3b78a7a5:
- **Probes:** `probe` is a read-only GET.
- **Build checks:** every one is `build_ge` or numeric, and the two stale
  "FAIL by construction" lines are gone.
- **4c:** a refusal must name its reason, and the refusals count only beside a
  sufficient board (control).
- **Section 90:** 0 of 0 no longer passes.
- **5u:** asks about postings that are in the reader's scope.
- **7i:** sends `vendor`.
- **7h:** reads 10 boards a call. A call with 50 now times out (57014).
- **`DAY30_APPLIED_AT`:** defaults to the staged runner's journal time
  (2026-10-03T14:24:04Z).
- **Locking:** only one run can go at a time.
- **`catalogSize`:** judged against this checkout's catalogue.

## Functions (deploy all seven together, in one Lovable publish)

| Function | Build its OPTIONS must answer |
|---|---|
| application-fit | `application-fit.2026-10-09.1` |
| create-test-coupon | `create-test-coupon.2026-10-09.1` |
| generate-cohort-report | `generate-cohort-report.2026-10-09.1` |
| job-fit | `job-fit.2026-10-09.1` |
| scrape-linkedin | `scrape-linkedin.2026-10-09.1` |
| warm-up | `warm-up.2026-10-09.1` |
| layoff-filings | `layoff-filings.2026-10-09.1` (BUILD_VERSION 2026-10-09.1) |

They are wrapped in `_shared/fn-build.ts` `stamped()`, a new file that nothing
else imports. Status, body and the other headers are unchanged. Before this,
each answered no `x-fn-build` (live OPTIONS, 2026-10-10). Every one passes
`deno check`.

**Migrations:** none.

## Owner steps

1. Merge. The workflows take effect on main at once. Within 30 minutes,
   board-health shows a scheduled run. If the board is unhealthy, it opens or
   updates an issue labelled `board-health` and emails you.
2. Deploy the seven functions above (Lovable), then run
   `bash scripts/verify-deploy.sh` (section 78, and section 49's ledger).
3. **Owner decision (L12-02), not made here:** once `test` and `deno-tests` are
   green on main, require those two jobs in main's branch protection, and have
   agent flows merge with `gh pr merge --auto`. Do not require `built-output`
   until the duplicate-title finding below is fixed. This branch changes no
   repository setting.
4. After each Lovable deploy, re-run the Deploy workflow's verify job. Green
   means production serves that commit's job-board build or a later one.

## Rollback

Revert the branch's commits. The workflows revert with the merge. For the seven
functions, redeploying the previous source removes only the header. There is
nothing to undo in the database.

## What to measure

- **CI:** the pass rate of the next 20 CI runs on main. Expected: `test` green
  on every push that does not break something. Section 78 prints the count.
- **board-health:** scheduled runs every 30 minutes (section 78). The first
  one ever is the proof that the file now parses.
- **built-output:** stays red until seo-content fixes the duplicate titles.
  After that, a red run is a new finding about the site.
- **The bot-wall sweep:** the first green scheduled run, on Monday 06:12 UTC,
  and `persisted N wall observations` in its log.

## Hand-offs (cross-group)

- **seo-content-i18n:** the `built-output` job's first local run fails
  `sitemap-prerender-parity` "gives no two sitemap URLs the same <title>". Four
  pairs of posting pages share a title: two KnitWell "Sales Associate", two
  Tapestry roles, and two Paylocity tenants with the same requisition id. The
  posting page title needs a distinguishing part (location or requisition), or
  the sitemap should keep only one of each pair.
- **payments-account / email-ops:** `create-test-checkout` and `delete-account`
  (payments-account), and `save-lead` and `recover-purchase` (email-ops), still
  send no build. When you stamp them, remove them from `STAMPED_BY_ITS_OWNER` in
  `src/test/a-function-that-names-no-build-cannot-be-told-from-a-stale-deploy.test.ts`.
  That test fails until you do, because the list may only shrink.
- **agents-api:** `scripts/verify-deploy.d/45-agents-api.sh` had two probe
  arguments changed from null to typed values (`probe` is a GET now and a GET
  cannot carry null). Expect a merge conflict if you edited those lines.
- **job-board / board-data-ingest:** when `job-board/sources.ts` changes:
  1. Copy it into `layoff-filings/board-sources.ts`, as before.
  2. Bump layoff-filings' `BUILD_VERSION`.
  3. Update the pin in `a-copy-of-the-catalogue-drifts-the-day-the-catalogue-moves.test.ts`.

  The ledger only lists layoff-filings for redeploy when its build moves.
- **Anyone adding verifier probes:** use typed values and no nulls, and use
  `build_ge` for builds.
- **data-pages-sql (finding):** `get_company_fill_curve` on 50 tokens answered
  57014 at its 25 s header on 2026-10-10 (10 tokens: 1.7 to 6.7 s). Only one of
  the 150 largest boards is sufficient today (andurilindustries).
- **Integrator:** the tests that parse workflows import `yaml`. It is only a
  transitive dependency, pinned at top level in package-lock.json (2.6.0).
  Declaring it in devDependencies means a bun.lock update (Lovable).

## Register items

| Item | Status |
|---|---|
| L12-01 board-health never ran | fixed (caed0515) |
| L12-02 CI not a gate | interim fixed (every check runs). Branch protection is the owner's decision (above). |
| L12-04 five render races | (1)(2)(3) fixed (f9b5b24e). (5) fixed (1135c820). (4) already fixed by wave 2 (ffc95454). |
| L12-07 bot-wall sweep | fixed (7ef8edba lockfile and strict install, fc8cf5ed env) |
| L12-08 deploy verify never compared | fixed (0a21c37d) |
| L12-10 dist guards skipped | fixed (7ef8edba, the built-output job) |
| L12-11 Deno tests never run | fixed (7ef8edba) |
| L12-12 vacuous slices | fixed (56fed3a1) |
| L12-13 setup deletes PDFs | fixed (02b765ec) |
| L1-06 verifier false FAILs | (a) DAY30 default and (c) the lock fixed (3b78a7a5). (b) was already fixed in dba7eafa. |
| S8-036 light-list timeout | already fixed by wave 2 (d3d23f52) |
| S8-124 no or stale x-fn-build | the verifier side, 7 functions and the layoff-filings tie are fixed (3b78a7a5, e65930d8). PR #25 (8c43aa16) bumped the 13 stale stamps. 4 functions are left to their owners. |
| S8-125 writer probes | fixed (3b78a7a5) |
| S8-126 45-scan-ai date pattern | fixed (3b78a7a5) |
| S8-127 PASS with no positive control | fixed (3b78a7a5) |
| S8-128 5u newest posting | fixed (3b78a7a5) |
| S8-129 7i `vendors` key | fixed (3b78a7a5) |
| S8-130 confirmation hash race | fixed (1135c820) |
| (unregistered) paid-analysis race tests | fixed (31ae6b6b) |
