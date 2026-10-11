# Wave 3: tests-ci

> **Integrated 2026-10-10 on `wave3/integration`.** The builds this note names
> are this branch's own strings. Several were reused by other wave-3 branches on
> different code, so every function the integration changed answers a later
> build: see the stamp table in [README.md](README.md). Deploy from the ledger
> (`node scripts/deploy-ledger.mjs --message` at the merge commit), never from
> the tables below.

Branch `wave3/tests-ci`, based on `origin/main` at 31647d4c (PR #25). No
migrations. Five edge functions get a build stamp, and nothing else in them
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
cannot compare fails, including a version that is not `YYYY-MM-DD.N` (a
letter-led value such as `degraded` sorted after every date and passed,
89a9a159). The comparison is "this build or later".

It is **red on every push to main while production serves an older job-board
build than main**, whatever that push changed: the step compares the live
build with the repo's BUILD_VERSION and never looks at the diff. On
2026-10-10 production serves `.90` (live OPTIONS: `x-fn-build:
job-board.2026-09-09.90`) and main carries `.91`, so from the merge of this
branch every push gets a red Deploy run, and GitHub emails the owner, until
job-board is deployed (owner step 1). Re-run the job after the deploy.

**Vacuous guards (L12-12).** Three guards were sliced on anchors that no longer
exist. They were re-anchored on code with bounds, or removed along with what
they tested. A planted mutant (a `return` in the headline track, the /jobs link
moved below the panels) passes the old guards and fails the new ones.

**setup.ts (L12-13).** The cleanup now deletes only PDFs that appeared after the
setup loaded. Before, it deleted every `*.pdf` in the project root. The test
runs the real setup: a child vitest on the suite's own config, started in a
scratch directory that already holds a PDF (df5dedee).

**The verifier (S8-124 to S8-129, L1-06).** See commit 3b78a7a5:
- **Probes:** `probe` is a read-only GET. Sections 63 and 65 call it for
  their writers too (payment_revoke, payment_revoke_credits, agent_pass_settle,
  search_digest_record_sent). They had kept their own POST through `R` until
  07001b9f. No section POSTs a writer now: a test runs 63 and 65, reads every
  literal `R` call site, and checks each target against its migration body.
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

## Functions (deploy all five together, in one Lovable publish)

| Function | Build its OPTIONS must answer (this or later) |
|---|---|
| create-test-coupon | `create-test-coupon.2026-10-09.1` |
| generate-cohort-report | `generate-cohort-report.2026-10-09.1` |
| scrape-linkedin | `scrape-linkedin.2026-10-09.1` |
| warm-up | `warm-up.2026-10-09.1` |
| layoff-filings | `layoff-filings.2026-10-09.2` (BUILD_VERSION 2026-10-09.2) |

**Two functions dropped, one at `.2`.** e65930d8 stamped seven functions it
called untouched by other groups. Three are not:
- wave3/job-board changes job-fit and application-fit and stamps both
  `<fn>.2026-10-09.1`, with `x-fn-build` in their corsHeaders.
- wave3/board-data-ingest changes layoff-filings and sets its BUILD_VERSION
  to `2026-10-09.1`.

This branch used the same three strings, so each branch's code could ship
under a build the other had already made live.

Bumping job-fit and application-fit to `.2` was not enough. Merged with
wave3/job-board, job-fit conflicts, and application-fit merges with **no
conflict** but declares `const FN_BUILD` twice, a module that does not
compile (`git merge-file`, 2026-10-10). So this branch leaves both to
job-board (dae8cb4f): they are back to main's source here, listed in the
guard's owner list, and judged by job-board's section 71.

layoff-filings stays stamped here, because board-data-ingest's version sends
no header. It is at `.2`, and section 78 judges it from `.2`, so a live `.1`
reads FAIL. Its merge conflicts are textual (the import line and
BUILD_VERSION); the rule is under "Hand-offs".

They are wrapped in `_shared/fn-build.ts` `stamped()`, a new file that only these
five import. Status, body and the other headers are unchanged. Before this,
each answered no `x-fn-build` (live OPTIONS, 2026-10-10). Every one passes
`deno check`.

**Migrations:** none.

**Sections 63, 65 and 78 against production, 2026-10-10 (before any wave-2
or wave-3 deploy).** Read-only, and it did not crash:
- **78:** the five stamps FAIL (no header yet; layoff-filings wants `.2`).
  The alarm's inputs PASS. The Deploy line FAILs, because main still runs
  the old verify step.
- **63 and 65:** the writer probes now go out as GETs. The four wave-2
  functions not yet created answer PGRST202 and FAIL as "migration not
  applied". `email_delivery_health`, which exists, answers 42501 on the GET
  and PASSes. So a revoked function refuses a GET exactly as it refused the
  POST.

## Owner steps

1. **Before merging, deploy job-board at main's BUILD_VERSION** (today
   `2026-09-09.91`, live `.90`; `.92` once wave3/job-board is merged). The
   alternative is a red Deploy run, with an email, on every push to main
   until you do (see deploy.yml above).
   Then merge. The workflows take effect on main at once. Within 30 minutes,
   board-health shows a scheduled run. If the board is unhealthy, it opens or
   updates an issue labelled `board-health` and emails you.
2. Deploy the five functions above (Lovable), then run
   `bash scripts/verify-deploy.sh` (section 78, and section 49's ledger).
3. **Owner decision (L12-02), not made here:** once `test` and `deno-tests` are
   green on main, require those two jobs in main's branch protection, and have
   agent flows merge with `gh pr merge --auto`. Do not require `built-output`
   until the duplicate-title finding below is fixed. This branch changes no
   repository setting.
4. After each Lovable deploy, re-run the Deploy workflow's verify job. Green
   means production serves that commit's job-board build or a later one.

## Rollback

Revert the branch's commits. The workflows revert with the merge. For the five
functions, redeploying the previous source removes only the header. There is
nothing to undo in the database.

## What to measure

- **CI:** the pass rate of the next 20 CI runs on main. Expected: `test` green
  on every push that does not break something. Section 78 prints the count.
- **board-health:** scheduled runs every 30 minutes (section 78). The first
  one ever is the proof that the file now parses.
- **Deploy verify:** red on every push while production lags main's job-board
  build; green after a re-run once job-board is deployed. A red run naming
  "not a YYYY-MM-DD.N build" means job-board's status changed shape.
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
- **Integrator: job-fit and application-fit (wave3/job-board).** This branch
  no longer changes them: its diff for both is empty, so job-board's version
  merges as it is. Ignore the job-board note's "keep the later of the two if
  both groups add it", because only one group stamps them now.
- **Integrator: layoff-filings (wave3/board-data-ingest).** Two textual
  conflicts:
  - the import line: keep both, this branch's `stamped` import and
    board-data-ingest's `refuseLcaCells`, `twinVendorTokens` and
    `JOB_SOURCES`;
  - BUILD_VERSION: this branch has `.2`, board-data-ingest `.1`.

  The merge must carry a build neither branch shipped alone,
  `BUILD_VERSION = "2026-10-09.3"`. Then:
  - update `PINNED.version` in
    `a-copy-of-the-catalogue-drifts-the-day-the-catalogue-moves.test.ts`
    to `.3`;
  - raise both floors to `.3`: section 78's `layoff-filings:2` and section
    77's `build_ge "lf" "lf.$W77_LF" "2026-10-09" "1"`.

  "This build or later" assumes one line of history. Across two branches,
  either branch's number passes the other's floor. If both branches merge
  before the next Lovable deploy, no half-merged build ever goes live, but
  raise the floors anyway.
- **Integrator: `STAMPED_BY_ITS_OWNER`.** All six listed functions are already
  stamped on their owners' branches:
  - create-test-checkout and delete-account on wave3/payments-account;
  - recover-purchase and save-lead on wave3/email-ops;
  - job-fit and application-fit on wave3/job-board.

  The guard no longer fails when a listed function is stamped. A listed
  function is excused only while it is wholly unstamped (70e93956). In the
  wave merge commit, empty the list, so that a stamp lost later is caught.
  Main stays green either way.
- **agents-api:** `scripts/verify-deploy.d/45-agents-api.sh` had two probe
  arguments changed from null to typed values (`probe` is a GET now and a GET
  cannot carry null). Expect a merge conflict if you edited those lines.
- **job-board / board-data-ingest:** when `job-board/sources.ts` changes (neither
  wave-3 branch changes it today):
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
| L12-08 deploy verify never compared | fixed (0a21c37d); a letter-led version no longer passes (89a9a159) |
| L12-10 dist guards skipped | fixed (7ef8edba, the built-output job) |
| L12-11 Deno tests never run | fixed (7ef8edba) |
| L12-12 vacuous slices | fixed (56fed3a1) |
| L12-13 setup deletes PDFs | fixed (02b765ec); the test now runs the real setup (df5dedee) |
| L1-06 verifier false FAILs | (a) DAY30 default and (c) the lock fixed (3b78a7a5). (b) was already fixed in dba7eafa. |
| S8-036 light-list timeout | already fixed by wave 2 (d3d23f52) |
| S8-124 no or stale x-fn-build | Fixed: the verifier side, 5 functions and the layoff-filings tie (3b78a7a5, e65930d8). layoff-filings moved to `.2`, above a sibling's `.1` (eeb4f33c). job-fit and application-fit are left to wave3/job-board, which stamps them (dae8cb4f). PR #25 (8c43aa16) bumped the 13 stale stamps. The 6 owner-listed functions are stamped on their owners' branches, and the guard accepts either state (70e93956). |
| S8-125 writer probes | fixed: `probe` (3b78a7a5), sections 63 and 65 (07001b9f) |
| S8-126 45-scan-ai date pattern | fixed (3b78a7a5) |
| S8-127 PASS with no positive control | fixed (3b78a7a5) |
| S8-128 5u newest posting | fixed (3b78a7a5) |
| S8-129 7i `vendors` key | fixed (3b78a7a5) |
| S8-130 confirmation hash race | fixed (1135c820) |
| (unregistered) paid-analysis race tests | fixed (31ae6b6b) |
