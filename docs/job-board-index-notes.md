# job-board/index.ts — the rationale that lived beside the code

Every block here was a comment run of more than six lines in
`supabase/functions/job-board/index.ts`, moved out on 2026-09-27 because the
deploy-upload cap (~4.5 MB) counts raw source bytes, comments included, and the
prose had grown to 686 KB of a 1.2 MB file. Each block keeps its place: the
pointer left in the code names the section, and each section quotes the code
line it stood above. Short comments (six lines or fewer) stayed in the file, and
so did every block a guard requires to stay written down beside its code.
Nothing here is executable; the code was proven byte-identical after stripping
comments on both sides.

## n001-sitemap-days

Above: `const SITEMAP_DAYS = 30;`

Deploy identity. BUMP THIS whenever you ship a code change you want to confirm
went live — the `status` action echoes it straight from the DEPLOYED bundle, so
"did my publish take?" is one call instead of hours of inferring it from posting
counts. catalogSize (JOB_SOURCES.length) is the automatic companion signal: it
moves with every catalog change with no discipline required. Sortable string so
a future check can tell "prod is behind" from "prod is ahead".
NOTE: a change to ../_shared/* alone does NOT get this function redeployed —
the deploy only picks up functions whose OWN directory changed, so the stale
bundle keeps its old copy of the shared module (confirmed twice, 2026-07-24:
two classifier fixes in _shared/application-questions.ts never reached prod
while this file was untouched). Always bump BUILD_VERSION here when a shared
module this function imports changes — it forces the diff AND gives the
deploy a verifiable tell.

AND WHEN sources.ts CHANGES, which this comment used to omit and which cost
us a day. 22 verified Pinpoint boards were merged on 2026-08-01 and reached
the deployed catalog, then sat there invisible: the bootstrap lane that jumps
brand-new boards ahead of the 28k cold rotation is KEYED ON BUILD_VERSION, so
with the version unchanged it never recomputed and the new boards queued
behind everything else. The catalog was right and the board was empty, which
is the hardest kind of wrong to notice.

src/test/build-version-guard.test.ts now fails if sources.ts changes without
this constant changing, so the rule does not depend on anyone reading this.
Sitemap pagination unit: one file per day of the 30-day freshness window.
Matches the window the board itself serves, and keeps every page an indexed
range scan rather than a deep OFFSET.

## n002-build-version

Above: `const BUILD_VERSION = "2026-09-09.80"; // per-version deploy notes: docs/job-board-deploy-notes.md (kept out of the bund`

.64: (1) checkLive returns THREE states — a posting absent from a WINDOWED
(page-capped) board fetch is null/unknown, never "the employer took it down",
which is the same rule the refresh prune has applied at `truncatedFetch` for
weeks and the verify-on-apply path never had — and the third state now
SURVIVES THE WIRE (`live` is boolean|null) instead of being collapsed back
to `true`, which was making the app tell a user who correctly reported a
posting gone that the employer's own board still lists it; (2) the audit
splits its undecided bucket into unreachable vs page-capped, because the
Ghost Job Index was about to publish the second as the first; (3) the slice
is un-throttled — SLICE_POSTING_BUDGET 1,200 -> 1,500 and CONCURRENCY 4 -> 5
— because the budget was sized against a heap model fitted on the
unread-page leak that `discardRest` has since closed (heap p50 176MB ->
36MB). NOT 4,000/8 (the byte budget pays for 5.33 workers at a 4MB
per-response cap) and NOT 2,600/5 either: the budget scales WITH concurrency
so slice duration is held constant, because the adaptive load shedder reads
slice duration in absolute milliseconds and would have read the longer
healthy slice as distress, cutting concurrency to 3 — below where .63 had
it. The cold shed lines are re-derived in the same commit.

## n003-stored-names-do-not-heal-themselves-the-refr

Above: `// STORED NAMES DO NOT HEAL THEMSELVES. The refresh is insert-only by design, so`

.67: A NON-LOGGING `facets` EXIT, so /explore can read the eighteen field
counts off the SAME refresh_head row the field landers print from without
(a) writing a synthetic zero-query browse into job_board_search_events on
every page view — a prerendered, daily-sitemapped page biasing the very
denominator that table exists to produce — (b) paying page_query and
attachRecheckedAt for a one-row page it discards, and (c) losing the
facetsCarried marker, which rides refresh_head but appeared in no list
response, so carried counts served under a fresh refreshedAt stamp were
indistinguishable from freshly scanned ones.
.65: A BOARD OVER THE PAGE CAP CAN PRODUCE A CLOSURE AGAIN, WITHOUT EVER
LOGGING A DISPLACED POSTING AS A TAKEDOWN. MAX_POSTINGS_PER_VISIT is 250, so
every board whose feed advertises more is permanently `windowed`, and the
prune's `partialRead` branch refused to stamp or log any of them — correct
(7/8 sampled closures on a windowed board were still live, 2026-07-21) and
also the reason ~36% of inventory, every employer above the cap, was
structurally incapable of appearing in the one table nobody can rebuild.
Absence is now proved ACROSS visits instead of within one: the deep cursor
already walks a big board from offset 0 to a wrap, so each such board carries
a lap epoch, every posting a lap serves is stamped with it, and only an id
that reached a fully-covered, fully-instrumented wrap without the epoch is
treated as gone — then still through the same two-pass grace, one lap per
pass. Closure rows carry `absence_basis` ('full_read' | 'lap') so no
published number can pool the two populations without saying so.
.61: A BATCH THAT WENT DARK NOW SAYS SO IN THE ROW ITSELF. `windowed` only
catches a TRUNCATED fetch — a feed that answers 200 with a valid, nearly
empty list is not windowed, so every stored posting for that board vanished
in one pass and was logged as an employer takedown. A collection failure
recorded as 400 fills, indistinguishable at read time from 400 real ones.
Each closure row now carries the batch that produced it (suspect,
batch_removed, batch_live_before) so the estimator can exclude it and a
human can recompute the decision. The rows are still INSERTED: the closure
log is the one asset here nobody can re-derive, so a doubt is marked, never
dropped. The mark needs TWO signals, because a wrong mark is worse than a
missed one: the closure row is excluded by every reader and the posting is
already hard-deleted, so a false positive removes the cohort from the risk
set instead of censoring it. So it fires only when an implausible share of
the removable board went absent THIS pass (raw absence, not the grace-
confirmed subset, or a widening outage never trips it) AND the feed itself
came back short. Share alone marks an ATS rotating requisition ids, an
employer filling a hiring class, and any small board on the cold lane.
Also stamps posted_at on every job_board_exits write, so a censored
observation's origin is the employer's own date instead of days_on_board's
COALESCE(posted_at, first_seen) — the coalesce that made time-to-fill flat.
.62: SIZING SET FROM A LIVE FIT OF THE ISOLATE, NOT FROM A GUESS.
Five in-flight slices sampled off slice_trace give
heapMb ~= 0.146 x postings_fetched - 10 (heap per BOARD is noise; heap per
POSTING is 100-160KB), so the ceiling lands near 1,800 postings. The budget
was 12,000 — an order of magnitude past anything reachable, which is why it
never fired and why five sizing knobs each "measured on both sides" read as
refuted: every one was tested at a value that could not bind. Budget 1,200,
per-visit cap 250, concurrency 4 (the reservation invariant makes 8
arithmetically impossible at this budget), heap soft limit 150 after
202/208/231MB were observed above the old 200. A slice that DIES loses its
bookkeeping AND stops the chain, which is what turned one cron tick into a
single slice instead of a ~17-hop chain.
.62 ALSO CARRIES THE COLLECTION PASS (merged from collect-now, which had
numbered it .61 against an older base — one version line, not two). That
pass stopped throwing away what the rotation had already computed:
job_board_field_changes at the unfreeze site (with the salary re-parse fix
that left corrected rows carrying stale structured pay); closures and exits
widened to department/country/region_code/work_mode/employment_type/
experience_band/min_years/salary_*, plus title+company on exits;
origin_basis stamped at all four exit write sites with the
posted_at-or-first_seen coalesce REMOVED (tenureDays below now returns the
duration and the clock that produced it, so posted_at and days_on_board no
longer disagree about what a row means); an append-only
job_board_board_state so feed_total stops being overwritten; company_token/
category/salary_present on every search click and the top-20 shown ids on
every search event; a caller enum separating our own monitoring from real
demand; region_code (US state / CA province) stored instead of discarded.
.36: JazzHR joins as vendor #20 (vendors/jazzhr.ts; a verified sample of boards enters sources.ts, so the bump is load-bearing for the bootstrap lane). .33: (1) descCoverage per vendor in status (rollup 20260903210000) and the desc sweep now fills NEWEST postings first across vendors; (2) lastUpsertError rides slice_stats and chainKick exposes `at`; (3) location aliases lifted to _shared/location-terms.ts (unchanged behaviour here) so /v1's default engine can mean the same place; (4) fit-terms/fit-batch kept for older bundles — the scorer now lives in job-fit.
.23: bug-sweep round — the agency opt-out reaches the rescue tiers (it was bound in search_jobs only, so a rescue served the rows the caller hid, undisclosed); the per-company cap stops swallowing the employer it just surfaced; a withdrawn count no longer prints "not hiring"; the reverted pipe fix is restored

## n004-nfamilyclub

Above: `"nfamilyclub",`

v3, added 2026-08-11. These surfaced only AFTER the Explore fixes landed:
"Transparent about pay" rendered for the first time and the size bands
re-cut on served counts, so cards that had never been visible came into
view carrying slug names. Fixing one instrument exposed the next.

Every name below was verified against the employer's own board or careers
site rather than guessed. Two came back different from the obvious guess:
  alignmenthealthcare -> "Alignment Health", not "Alignment Healthcare".
    Healthcare is the SEC registrant; the board's own og:description and
    every posting body say Alignment Health.
  exactcare -> "AnewHealth", not ExactCare. The slug is the old subsidiary;
    the board is a shared career site for the merged organisation and every
    job page on it is titled "Careers at AnewHealth". Calling it ExactCare
    would attribute the whole board to one of its pharmacy brands.

## n005-concurrency

Above: `const CONCURRENCY = 5;`

Refresh budget: a single edge invocation cannot afford the CPU of
converting the whole corpus's HTML to text (WORKER_RESOURCE_LIMIT, seen
live twice). So refresh is CURSOR-SLICED: each call processes one slice of
boards and advances a cursor in job_board_meta; the 10-minute cron and
read-triggered SWR calls walk the full list continuously. Facets swap in
when a cycle completes; until then the previous complete cycle serves.
Cold-slice concurrency: cold boards are SMALL feeds (the giants are all
hot-tier, fetched at HOT_CONCURRENCY), so eight concurrent light fetches
stay far from the memory ceiling that limits hot slices. Raised 4→8
2026-07-15: measured full-tail rotation had drifted to ~3h at 14.9k boards
(9,014 boards >1h stale) while the public copy said "about an hour" —
halving cold hop wall-time is the honest fix's first half; the second is
measured, not aspirational, copy. Vendor interleaving bounds any single
vendor to ~1 in-flight fetch per hop at this width.
MEMORY SCALES WITH CONCURRENCY, NOT WITH SLICE SIZE.

This is the lever a day of slice-shrinking never touched. Measured on .58,
with the .34 sizing restored: a slice reached board 82 holding 2,429
postings across 8 workers and sat at 214MB, hard against a ~256MB ceiling —
then died before its terminal stamp, every time. That also settles which of
today's two contradictory readings was representative: 105KB a posting was
right, and the 37MB trace came from a slice the board budget never let grow.

Each worker holds one board's raw payload, its parsed rows and a page of
existing rows. So peak memory is (workers x per-board cost) and has nothing
to do with how many boards the slice will eventually cover. Halving the
workers halves the peak and costs only wall time per slice — while a slice
that SURVIVES stamps and chains immediately, and a slice that dies waits for
the next cron tick. That trade is why 4 workers over 80 boards beats 8
workers over 80 boards that never finish.
AND THAT MODEL WAS WRONG TOO. Halving the workers did not halve the peak:
.59 measured 136-213MB at board 34 with FOUR workers, where .58 reached
214MB at board 82 with eight — fewer boards to the same ceiling, with half
the concurrency. Peak heap is therefore not the in-flight working set, and
throughput fell from 1,800 boards an hour to 640. Back to 8.

What is established after a day of this: slices die before their terminal
stamp, they have done so since before any of today's changes, heap at death
is 200MB+ but does not track workers OR boards in any stable way, and the
posting budget, wall clock, board count, per-visit cap and concurrency have
each been measured on both sides and each refuted. The next honest step is
not another constant — it is the function's own logs, which say what the
runtime killed and why, and which nothing in this repo can reach.
4 -> 5, WHICH IS THE MOST THE BYTE ARITHMETIC ALLOWS. NOT 8.

Two things changed under this constant today. First, the reason for 4 is
gone: every measurement above was taken while the chunked pagers were
LEAKING — a pager that stopped early abandoned its unread page responses
without cancelling them, so heap grew with every page the slice had ever
read, and grew faster the more workers read at once. That is why both
directions looked bad. Eight workers reached the ceiling in fewer boards;
four reached it anyway, slower, at a third of the throughput. Neither
reading was about concurrency; both were about the leak, multiplied by it.
`discardRest` closed it: heap p50 fell 176MB -> 36MB, and the .63 slice held
1,216 postings in 35MB where the fitted 0.146MB-a-posting model predicts
~168MB. That model described the leak.

Second, and this is what stops the obvious answer: A WORKER IS NOT FREE, AND
ITS PRICE IS ALREADY WRITTEN DOWN. The byte budget below divides the
in-flight allotment by PEAK WORKERS:

    ceiling 256MB - baseline ~64MB - reserve ~64MB   = 128MB in flight
    MAX_RESPONSE_BYTES 4MB x ~6x parse amplification =  24MB a worker
    128 / 24                                         = 5.33 workers

    4 workers -> 96MB  fits        6 workers -> 144MB over
    5 workers -> 120MB fits        8 workers -> 192MB 50% over

So 8 is refused here, and refused by arithmetic a guard already enforces
(a-body-read-before-anything-counted-it: peak workers x one body must fit
the allotment), not by preference. Reaching 8 would mean cutting
MAX_RESPONSE_BYTES to ~2.6MB, which trades a MODELLED memory risk for a
MEASURED coverage loss — greenhouse/gitlab is 3.6MB and ingests whole today
— or spending the reserve that exists because this function has been killed
by overshoot repeatedly. Five is the honest ceiling until the per-response
cost changes.

WHAT 5 BUYS, at the .63 per-worker rate (8.5s a board, 5.96 postings/s):
~30 boards in the same 51s a slice already takes, against 24 — the
arithmetic is at SLICE_POSTING_BUDGET, and the budget is scaled to 1,500 to
spend the fifth worker on MORE BOARDS rather than on a SHORTER SLICE, which
is worth more because the per-slice tail amortises over them. That is +25%,
not the ~2x an unbounded budget models and not the 3.4x an 80-board slice
would give: the shedder reads slice duration, so buying boards by making the
slice longer is borrowing from a mechanism that takes it back with interest.
The remaining lever is per-board latency or the per-response byte cap, NOT
the posting budget.

THE HYPOTHESIS, WRITTEN DOWN SO IT CAN BE FALSIFIED. 8 was the configuration
running while the isolate was dying, and the claim above is that it died of
the leak, which concurrency multiplied, rather than of concurrency itself.
That is a hypothesis, not a measurement, and this raise deliberately does
not bet the isolate on it. IF HEAP CLIMBS BACK TOWARD HEAP_SOFT_LIMIT_MB,
CONCURRENCY IS THE SUSPECT, NOT THE POSTING BUDGET: the budget bounds
cumulative postings, and cumulative postings are exactly what stopped
costing memory when the leak closed. Put this back to 4 first, re-measure,
and only then look at the budget.

## n006-stored-desc-cap

Above: `const STORED_DESC_CAP = 12_000;`

STORED DESCRIPTION CAP — raised 4,000 → 12,000 on 2026-08-24, measured
first: 21/24 sampled at-cap postings were cut mid-content, and every tail
over 1,000 chars held requirements/qualifications or salary figures (the
greenhouse/lever pay-transparency block sits at the BOTTOM, so the old cap
systematically amputated exactly what salary mining reads; one sampled
range existed ONLY beyond char 4000). 12k captures 87.5% of postings
whole; the residue beyond it was legal boilerplate in every observed
case. ~120MB across the four worst vendors. The embed input slices to
1,200 chars on its own, so ranking is untouched. RAW_HTML_CAP bounds the
per-item htmlToText cost and must stay ~2x the text cap or tag overhead
re-truncates below it. Ingest, list-payload and backfill paths share
these constants BECAUSE they must agree — two caps is how the 4,000
number would creep back.

## n007-structured-sweep-sources

Above: `const STRUCTURED_SWEEP_SOURCES: readonly string[] = ["workday"];`

structured-sweep: vendors whose PER-POSTING DETAIL states a work mode the
list payload does not. Only Workday qualifies today — fetchVendorDetail
reads its `remoteType` — and Workday is half the board, so this one entry is
306,186 postings whose work mode is otherwise text-inferred or absent.

Not the same question as DETAIL_DESC_SOURCES. That list is "whose text needs
a per-posting fetch"; this is "whose STRUCTURED fields do". A vendor belongs
here only if fetchVendorDetail sets `workMode` for it, so adding one means
writing that branch first — an entry without one would walk the vendor's
whole corpus fetching details and filling nothing.

## n008-structured-sweep-per-hop

Above: `const STRUCTURED_SWEEP_PER_HOP = 24;`

24, NOT desc-sweep's 120 — and the difference is the walk order, measured
the hard way. desc-sweep orders by posted_at DESC, so every hop mixes
tenants and one dead board costs a few of its 120 fetches. This lane walks
by id, and ids cluster BY TENANT — a hop parked on one hanging Workday
board serializes into ceil(120/8) waves x FETCH_TIMEOUT_MS (20s) = 300+
seconds, past the isolate's wall clock. Two live passes died exactly this
way (start-stamp at 21:23 and 21:44, no end-of-hop report either time).
At 24 rows the worst case is 3 waves x 20s = ~60s: the hop survives a
fully dead tenant, skips it, and the cursor moves on.

## n009-hot-posting-budget

Above: `const HOT_POSTING_BUDGET = 1_200;`

THE HOT LANE NO LONGER MATCHES THE COLD ONE, and it is a separate constant
rather than an alias precisely so the two can diverge on evidence.

Everything above is measured on a COLD slice. Hot boards are the giants —
the population every at-cap memory reading has ever come from — and they run
at HOT_CONCURRENCY 2, so the wall-clock argument for a bigger budget does not
transfer: nothing measured says the hot lane is being throttled by this
number. It stays where it was until a hot-slice measurement says otherwise.
The interlocks it must keep: HOT_POSTING_BUDGET <= SLICE_POSTING_BUDGET
(1,200 <= 2,600) and HOT_CONCURRENCY x MAX_POSTINGS_PER_VISIT <
SLICE_POSTING_BUDGET (2 x 250 = 500 < 2,600), both pinned by guards.

## n010-cold-board-reserve

Above: `const COLD_BOARD_RESERVE = 200;`

WHAT ONE IN-FLIGHT BOARD CAN STILL ADD. Only a hot-phase board or a
deep-lane board can return the per-visit cap in one visit; a cold board
is small by definition (that is why it is cold), and reserving the cap
for each of them was measured on 2026-09-03 20:19Z: a cold slice fetched
178 postings and deferred 111 boards, because the first worker to return
saw seven others reserving 2,000 each, judged the budget spent, and
drained the whole remaining queue — while the cursor had already moved
past every one of those boards. Arithmetic that a guard pins: with every
cold worker reserving this and both deep boards reserving the cap, the
reservation alone stays under the budget, so an empty-handed slice can
never retire a worker, let alone drop a board.

## n011-heap-soft-limit-mb

Above: `const HEAP_SOFT_LIMIT_MB = 150;`

"A cold board is small by definition" was false for this catalog: 1,367
Oracle boards page 20 x 100 by default, iCIMS and Workday page to the same
cap, and 315 boards carry a `pages` override — none of them hot unless in
the 120-slot tier. Reviewed 2026-09-03: six such boards in flight at 500
each let a cold slice hold ~21,000 against a 12,000 budget. A board whose
visit can return the cap reserves the cap; with retire-not-skip that only
lowers concurrency on giant-heavy slices, it never drops a board.
THE BUDGET COUNTED POSTINGS; THE ISOLATE RUNS OUT OF BYTES.

Measured 2026-09-04 with the .40 breadcrumbs, three samples across two
slices:
    24 boards   250 postings   heap 101MB   in flight 2500
    48 boards   540 postings   heap 200MB   in flight 4500
    72 boards  2316 postings   heap 196MB   in flight  500

Two things fall out of that. Heap tracks BOARDS PROCESSED, not postings —
540 postings were being held in 200MB — and it does not fall when the
in-flight reservation drains to a single small board, so it is not the
concurrent payloads either. And the posting budget could never fire: the
slice that died at 200MB had spent 540 of its 12,000 postings, 4.5% of a
bound that was supposed to protect it.

So the slice now stops on the quantity that actually runs out. At ~4MB a
board and a ceiling around 256MB, 150MB leaves room for the boards already
in flight to land, and a slice that stops here STOPS CLEANLY: it writes its
stamps, chains to the next hop, and its unvisited boards are deferred, not
failed. That is worth more than a bigger slice, because a slice that dies
loses its work AND stops the chain, which is what has pinned freshness at
755 minutes against a 480-minute promise.
LOWERED TO 150 FROM 200 BECAUSE 200 WAS OBSERVED BEING EXCEEDED.
Live readings on 2026-09-06: 202, 208 and 231MB. This gate is checked before
STARTING a board, so with CONCURRENCY workers it can overshoot by whatever
the boards already in flight go on to allocate. 150 leaves that overshoot
somewhere to land instead of pretending the check is a ceiling.

## n012-min-boards-per-slice

Above: `const MIN_BOARDS_PER_SLICE = 80;`

AND NEITHER OF THOSE IS THE CAUSE EITHER. STOP THEORISING; BOUND WHAT IS
KNOWN TO SURVIVE.

.42 measured a slice on the way down: 24 boards, elapsed 12.3s, heap 155MB,
one small board in flight — and it died before board 48. Twelve seconds is
nowhere near the wall budget, so duration is not it; and it died at 155MB
where earlier slices reached 200MB, so a fixed heap ceiling is not it
either. Two theories, two deploys, both wrong, and the honest position is
that I do not know what kills the isolate.

What IS known, from the breadcrumbs rather than from reasoning: a slice
reliably reaches 24 boards and writes that mark, and frequently does not
reach 48. So the slice is bounded at a size that has been observed to
survive, and the cause stays under measurement.

.44 BISECTS RATHER THAN THEORISES. On .43, with the cap at 24, a slice was
caught at 16 boards / 9.2s / 132MB and still never completed — and in every
trace ever recorded, across four versions, a `loop-done` mark has NEVER
appeared. The loop itself never ends. So the death is inside a board's own
fetch-and-process, and it is not board count, not elapsed time and not a
fixed heap ceiling, all three of which have now been measured on both sides.

The cap therefore halves twice, to 8, as an EXPERIMENT with a reading either
way: if slices start completing, per-invocation work is the axis and the cap
can be tuned back up; if they still die at 8, the axis is something a single
board does, and the 8-board marks will name the board it dies on.

This is not a smaller rotation. A slice that COMPLETES chains straight into
the next hop — a 24-board slice takes ~12s, so the chain runs several a
minute — while a slice that dies stops the chain entirely and waits for the
ten-minute cron. Today's freshness collapse, 403 -> 804 minutes, is the cost
of dying slices, not of small ones.
A CAP THAT SAVED THE CHAIN IS NOW THE BOTTLENECK, SO IT FINDS ITS OWN
CEILING.

.44's cap of 8 did what it was for: slices complete and the chain runs
again (works 2110 -> 2984 in two hours, chainKick "continued", a full cold
pass wrapped). But 8 boards a slice cannot hold the published promise —
44,000 cold boards at 8 per slice is 5,500 slices, which at the observed 3-5
slices a minute is 18 to 30 hours per pass against a bound of 8. Freshness
went on climbing, 863 -> 997 minutes, while the rotation was healthy. Small
and completing beat large and dying; small and completing does not beat the
promise.

I do not know where the death threshold is — 24 died at board 16, 8 lives —
and one constant chosen from two data points would be another guess. So the
budget RIDES THE CHAIN: each hop that completes hands the next hop a larger
one, and a hop that dies hands on nothing, so the cron's fresh chain starts
at the floor again. The rotation walks up to just under whatever the real
threshold is, backs off by itself when it hits it, and re-finds it after a
deploy or a change in board mix — without me picking a number.

## n013-

Above: `/**`

MEASURED DOWN FROM 25 — 25 COST THE ROTATION FOUR TIMES ITS SPEED.

The cap was set to match BOOTSTRAP_PER_SLICE on the reasoning that its load
was "already proven safe". That reasoning was wrong, and the error is that a
bootstrap board and a deep board are not the same unit of work: a bootstrap
board is a zero-row board that usually returns almost nothing, while a deep
board is a 500-posting Workday window WITH descriptions — the most expensive
fetch this function makes. Twenty-five of those tripled the real cost of an
80-board slice.

Measured live on .20, two cold-cursor samples 422s apart:
  before the lane   46.0 boards/min   full cycle 11.4 h
  at DEEP_PER_SLICE=25   11.4 boards/min   full cycle 46.2 h
+80 in 422s is exactly ONE slice, so slices had gone from ~1.7 min to ~7.

A 46-hour cold cycle is not a tuning question, it is a broken promise: the
board publishes that every feed is re-verified within a few hours, and
freshness p95 had already reached 357 min against that claim. Depth bought
with the freshness budget is the same mistake the removed "quiet lane" made,
recorded in this file's own history.

8 keeps the lane working — the backlog it exists to drain has already fallen
from 123 boards to 44, and 8/slice still sweeps that map in ~6 slices — while
returning the per-slice cost to roughly a third of what the regression added.
RE-MEASURE the cursor rate after any change to this number; it is the only
thing that shows the cost.

## n014-deep-volume-per-slice

Above: `const DEEP_VOLUME_PER_SLICE = 500;`

AND THE DEEP LANE WAS SIZED IN THE SAME WRONG UNIT. 4,000 postings is ~420MB
at the measured ~105KB a posting — the deep lane alone could exceed the
isolate's whole ceiling before the cold rotation fetched a single board.
800 keeps the lane to two at-cap boards a slice, ~84MB, and the boards it
serves are precisely the giants that resume via nextOffset, so a smaller
take costs coverage speed and never coverage.

TWO, not one. Dropping the deep take to a single board looked safer and
broke a fairness property an existing guard proves: the deep start derives
from the cold cursor, which steps 80 per slice, and 80 mod a 66-board list
is 14 — sharing a factor of two with 66, so a take of one visits only the
even positions and starves half the lane forever. The take stays at two and
the per-visit cap carries the memory reduction instead.

.90: the take APPLIED is one again (DEEP_LANE_TAKE; DEEP_PER_SLICE stays 2
as the memory ceiling), and the fairness property is kept by the start rule
instead of the take: the start is the cold cursor's place in its rotation
mapped onto the list, so a step sharing a factor with the list's length
starves nothing (n426).

## n015-retry-per-slice

Above: `const RETRY_PER_SLICE = 5;`

RETRY LANE — deliberately the smallest lane on the slice.

A board only gets a verification stamp when its fetch SUCCEEDS, so one failed
fetch used to cost it a full rotation (8.2h measured) before anything tried
again. Measured 2026-08-26: 82.5% of boards sat inside one rotation while the
5% tail sat at 12-25h — freshness p95 20.7h against a healthy p50 of 4.9h.
That tail was never a rotation-speed problem; it was boards waiting a whole
rotation for a second chance.

FIVE, NOT TWENTY-FIVE, and the arithmetic is the lesson from DEEP_PER_SLICE
three commits ago. A retry is the most expensive fetch there is when it fails
again: a dead feed burns the full ~20s FETCH_TIMEOUT, which is precisely the
cost dormancy exists to stop paying. Five at CONCURRENCY 5 is one extra
round, bounded at ~20s worst case on a ~87s slice. Exponential backoff then
keeps the pool small in steady state, so the lane is usually far under its
cap. RE-MEASURE the cold-cursor rate after changing this number.

## n016-stale-rpc-limit

Above: `const STALE_RPC_LIMIT = 60;`

THE STALE LANE'S TWO NON-THROUGHPUT NUMBERS. Its size is STALE_PER_SLICE in
stale-lane.ts (pinned there); these bound the one RPC it issues per cold hop.
The RPC's own statement_timeout is 5s; the deadline sits under it so a slow
read costs the lane one hop and the hop nothing. 20 rows is the RPC default:
the classifier needs to see past the classes no fetch can fix (the live tail
was 1 prototype name + 7 oversize before the first 'unexplained' board).
THE CANDIDATE WINDOW, and why it is wider than the lane. get_stalest_boards
returns the oldest stamps that hold any row, and the head of that list is
where the PERMANENT residents live: oversize boards never stamp (seven of
the twelve oldest on 2026-09-10), and a token at STALE_TRIES_MAX stays
where it is. At 20 rows the window clogged silently — selectStaleLane
returned [] every hop while status read "asked 20 / unexplained 0", which
looks like "nothing stale left". 60 rows is three times the room at the
same bounded cost (one index probe per row under the RPC's 5s timeout,
200 its cap); `windowFull` on status names the clogged state when it
arrives anyway. And it arrived anyway: the first live pass after .70 read
asked 60 / oversize 59 / prototype_name 1 / unexplained 0, windowFull,
fetched 0 — 145 boards in the registry outnumber any window. Since .71 the
call passes p_exclude (migration 20260909222000, evaluated INSIDE the RPC's
capped scan): staleExclusion() = the Object.prototype names ∪
OVERSIZE_BOARDS ∪ the unresolved tokens, at most STALE_EXCLUDE_MAX (400)
of them, so `windowFull` now means "60 rows AFTER exclusion and still
nothing unexplained" and is also written as a warn line when it happens.

## n017-light-capable-vendors

Above: `const LIGHT_CAPABLE_VENDORS = new Set(["greenhouse"]);`

LIGHT IS ONLY AN ESCAPE WHERE THE DESCRIPTIONS CAN COME BACK.

Two vendors have a light LIST form: greenhouse drops ?content=true and
workable drops details=true (see listUrl). Only ONE of them has a filler
that works while the board is light. backfill-desc selects
descBackfillBoards() — greenhouse boards that are light — and hits
greenhouse's per-JOB endpoint; workable is absent from DETAIL_DESC_SOURCES,
so its only filler is the desc-sweep BOARD lane — which calls fetchBoard(),
which goes through listUrl, which for an enrolled token emits details=false.
The sweep would re-fetch the board in the very mode that omits the
descriptions it is trying to recover, fill 0 rows, and report it handled.

So enrolling a workable board in light mode does not defer its descriptions,
it DELETES them: every posting ingests with description null, permanently,
scoring null in fit-batch and invisible to the sampled description tier,
with nothing in any counter saying so. A deferral is recoverable and loud;
that is not. Workable oversize boards take the plain deferral path with the
other eighteen vendors until a per-posting workable filler exists.

THIS SET WAS TRUE AND UNENFORCED FOR ITS WHOLE LIFE. It was consulted at
exactly ONE call site — the byte-budget bound — while the two content-volume
enrolments (greenhouse and workable, in the ingest loop) added their token to
DYNAMIC_LIGHT with no vendor test at all. 2,925 workable boards could enrol
themselves into the mode this comment exists to keep them out of, and the
enrolment is PERSISTED to job_board_meta, so the destruction outlived the
isolate that chose it and reloaded into every isolate after.

A rule written in prose beside a set that anything may write to is not a
rule. The membership test now lives INSIDE the set (LightCapableOnly below),
so the property holds for the class: there is no call site that can forget
to ask, because asking is what `add` does.

## n018-lighttokenrefusal

Above: `const lightTokenRefusal = (token: string): string | null => {`

A TOKEN IS THE UNIT LIGHT MODE ACTS ON, AND A TOKEN IS NOT A BOARD.

isLight() and listUrl() are keyed by TOKEN, not by (vendor, token), and the
catalog is not token-unique: 139 tokens are carried by two or three vendors
at once (measured against sources.ts, 44,542 entries / 44,402 distinct
tokens). Enrolling "the greenhouse board" therefore enrols every board that
shares its token — `antenna`, `mcs` and `lockwood` are greenhouse+workable
pairs, and `echo`, `dispatch`, `vmax`, `pulse`, `pdq`, `excel`, `tdg`,
`cabrillohospice`, `playonsports` and `ism` pair greenhouse with a vendor
that has no light form at all.

So the question this must answer is NOT "what vendor is this token" — that
question has no single answer and a first-match lookup silently invents one,
which is defect B intact for the exact vendor the fix was written about
(first match on `antenna` is greenhouse, so the workable board goes light and
its descriptions are deleted forever). The question is "would going light be
safe for EVERY board this token turns light", and the answer is yes only when
every catalog entry carrying it is light-capable. UNKNOWN IS REFUSED, NOT
ASSUMED: a token the catalog no longer carries gets no promise either.

Linear over JOB_SOURCES and deliberately un-indexed, with no early return
(the whole point is that the FIRST match is not the answer). A token→vendors
Map is ~1MB retained for the life of every isolate — against a 36MB heap p50
— to serve a call that happens at most a few dozen times per isolate:
admission only, never per board, never per posting. Two integers of state.

## n019-dynamic-light

Above: `const DYNAMIC_LIGHT: Set<string> = new LightCapableOnly();`

Self-tuning light mode: the static LIGHT_DESC_TOKENS set plus a dynamic,
meta-persisted set of Greenhouse boards whose content payloads measured
past the auto-enroll threshold. stripe (3.9MB) and zscaler (4.9MB) were
hardcoded only after their heavy parses starved them of verification
stamps for days — the NEXT giant enrolls itself the first time its volume
is measured instead of waiting for a human to notice missing stamps.
Descriptions for light boards arrive via the daily backfill-desc sweep
(Greenhouse per-job endpoint, its own compute budget).

THE CAP WAS 50 AND 107 BOARDS NEEDED A SLOT (2026-10-01, .84). The dynamic
set is persisted as its newest AUTO_LIGHT_CAP entries and reloaded at the
start of every slice, so the row is the truth and it behaves as a FIFO. A
FIFO smaller than the population a cyclic rotation feeds it misses on EVERY
visit: by the time the cold cursor returns to a board, the other boards that
enrolled since have pushed it out. Census of all 5,130 catalogue greenhouse
boards that day: 81 whose ?content=true list is over MAX_RESPONSE_BYTES and
26 more that enrol through the content-volume path — 107 competing for 50
slots. Every one of them tripped the byte bound on every cold visit, was
deferred with no rows and no verification stamp, and after 48 hours the
nightly verification sweep stamped missing_since on everything it held. Only
a revisit from outside the rotation (hot tier, demand, bootstrap) ever read
one light, so serving counts were bimodal: Anthropic, Databricks, Cloudflare,
MongoDB, Okta and SpaceX served 0 (Okta 103 at the 02:30 snapshot, 0 after
the 03:41 sweep) while Stripe and Anduril served their full in-window counts.

500, not 1,000: both cover 107 four times over, but the maintenance count
sends every light token in one URL IN-list and backfill-desc's done-check
runs one count query per light board, so the cap is also a cost. Four of the
107 never take a slot at all — lush, samsara, pulse and helsing share their
token with a vendor that has no light form, and the set refuses them (n018);
lush, samsara and pulse are over the bound and stay deferred until a
follow-up gives shared-token boards a light read of their own.

SATURATION IS NOW VISIBLE. job_board_meta is not anon-readable, which is what
hid this for weeks, so every terminal slice_stats write carries `lightSet`
(DYNAMIC_LIGHT.size in this isolate) beside `lightCap`. The in-isolate size can
read one or two past the cap when a slice enrols into a full row, and any
reading at or past the cap means the FIFO is thrashing again.

## n020-oversize-boards

Above: `const OVERSIZE_BOARDS = new Map<string, { source: string; mb: number; at: string }>();`

PERMANENTLY OVERSIZE BOARDS MUST BE NAMEABLE THREE MONTHS LATER.

A vendor with no light form (ashby, lever, recruitee, breezy, personio,
teamtailor, pinpoint, paylocity, bamboohr…) fetches its whole board in one
request, so a board past the byte budget is deferred on EVERY pass with
nothing about the next pass differing. Deferral deliberately keeps it out of
failedTokens, the failure streak, job_board_board_state and the dormancy
classifier — which is right (the vendor answered us; the board is not dead)
and is exactly what makes it invisible.

Measured live 2026-09-06 against the production endpoints: ashby `openai`
13.6MB, lever `veeva` 12.8MB, lever `paytmpayments` 11.2MB, recruitee
`livezoku` 15.0MB, lever `palantir` 6.0MB. A random 125-board sample across
the light-incapable vendors trips the budget at ~1% (p90: ashby 245KB, lever
936KB, recruitee 343KB, personio 88KB, breezy 36KB) — ordinary boards are
nowhere near it, but the ~1% that trip are the largest employers we carry
and two of them are vendor-health canaries.

This registry is the durable record of that: it ACCUMULATES (unlike
slice_stats, which is one row overwritten every ten minutes), it rides the
status payload, and the freshness sweep reads it so a live board that we are
simply too small to hold is never written into the lifecycle closure log as
an employer's closure. It is not an ingest path; it is the thing that stops
them leaving silently.

SINCE .84, LEVER AND ASHBY ARE READ IN THE SAME VISIT (n411). A board of
either vendor that the bound refuses is re-read a posting at a time, and a
successful read deletes its entry here exactly as any successful read does.
What remains in this registry for those two vendors is therefore the boards
that read too slowly to finish inside STREAM_READ_BUDGET_MS (large lever feeds
from a slow edge: cgsfederal was 36.5 MB in 32 s from a desktop), boards whose
metadata alone is over SLIM_RETAINED_BYTES (ashby bjakcareer), and boards the
slice clock or the heap gate kept from starting the retry this visit. For
greenhouse, after the n019 cap raise, expect only the shared-token boards and
the two whose light list is itself over the bound (liquidpersonnel, pulse);
since .90 those two stream their light list (n424), so expect a greenhouse
entry only while a streamed read fails or the gates keep it from starting.
The other vendors without a light form (teamtailor, workable, recruitee,
pinpoint and the rest) are unchanged and still defer here.

SINCE .90 a slice that could not read this row neither writes it nor lets the
freshness sweep log any closure (n421), and the registry is keyed by BOARD:
the bare token, or `source:token` on a shared token (n422).

## n021-startoffset-is-honoured-only-by-the-paginatin

Above: `// startOffset is honoured only by the paginating vendors; every other branch`

Greenhouse and Lever EU tenants live on separate infrastructure with its
own API hosts, and the routing lives in greenhouseApi/leverApi — moved to
normalize.ts (2026-08-31, when the routing grew a second vendor) so the
fetch paths, the applyUrl rebuild, the tests, and the census tooling's live
probes all derive hosts from the same two functions. EU boards carry the
same compound-token prefix pattern as workday's `tenant~dc~site`;
everything downstream (ids, catalog, closure log) keeps the full prefixed
token, and only the helpers strip it.

## n022-sr-page

Above: `const SR_PAGE = 100;`

SmartRecruiters paginates 100/page. With ~1,000 SR boards now in the pool, an
unbounded cap could let one giant board's pagination wedge a cold hop under
the edge wall-time limit. Bound it so no single board costs more than ~8
sequential pages — the vast majority of boards hold fewer than this, and the
30-day freshness cap discards most of a mega-board's inventory anyway. Big
boards still get full coverage once the self-tuning hot tier promotes them
(fetched alone in small hot slices).
SR_CAP 800 -> 2000, and the reason is measured rather than tuned.

The SmartRecruiters feed is ordered NEWEST FIRST — verified on AECOM
2026-08-10: offset 0 = today, offset 800 = 10 days old, offset 2000 = 34
days, offset 4000 = 3.5 months. So the cap never dropped random postings; it
cut the tail, and most of that tail is already past the board's own 30-day
serving window and would be filtered out regardless. The old cap was not
losing 22,617 servable roles, which is what the raw feed-vs-live gap looks
like until you check the ordering.

What it WAS losing is the part of the window it could not reach. Measured by
binary-searching each feed for the 30-day crossover:
  AECOM      1,793 postings inside 30 days — 800 covered 44%
  Bosch      1,815 inside 30 days          — 800 covered 44%
  Domino's  >6,000 inside 30 days          — 800 covered <13%
2,000 therefore covers ten of the eleven currently-capped boards in FULL,
and triples the giants.

2,000 is not an arbitrary ceiling either: it is exactly Oracle's per-pass
budget in this same file (ORACLE_PAGE_SIZE 100 × ORACLE_PAGE_CAP 20), a page
shape and request count already proven in production here. Workday runs 500.
The cap exists so one board cannot monopolise a slice, and that constraint is
unchanged — 20 requests, not 246, which is what an uncapped Domino's would
cost every pass.

## n023-for-const-host-of-jobs-personio-de-jobs-pe

Above: `for (const host of ["jobs.personio.de", "jobs.personio.com"]) {`

AN EMPTY BOARD IS NOT AN OUTAGE.

This accepted a response only if it contained "<position", so an employer
with no open roles — a perfectly healthy feed answering
`<workzag-jobs></workzag-jobs>` in 72 bytes — was reported as
"personio feed unavailable on .de/.com". Measured 2026-08-24, the first
day failure reasons were visible: 41 of 120 board failures were personio,
and probing all 41 found 32 answering HTTP 200 with a valid empty feed.
A third of the board's entire failure list was employers who simply
weren't hiring.

The consequence is worse than the noise. A failed fetch means the board
is skipped by the prune, so a personio employer who closes their last
role would keep those postings on a board that advertises zero ghost
jobs — indefinitely, but for the 30-day freshness cap catching them
later. Three such postings were being served when this was found.

The document root is the health signal; the positions inside it are the
inventory. Those are different questions and this asked the wrong one.

## n024-string-e-as-error-message-e-inclu

Above: `if (String((e as Error)?.message ?? e).includes(OVERSIZE_MARKER)) throw e;`

OVERSIZE IS NOT "UNAVAILABLE". Swallowing it here re-transferred the
same too-big feed against the other host and then reported "personio
feed unavailable on .de/.com" — a message the classifier reads as a
vendor failure, which is a failure streak and, at DEAD_BOARD_THRESHOLD,
the dormancy prune deleting every posting on a live employer and
writing a whole-board exit into the closure log. A board being large
must never spell itself as a board being dead.

## n025-feedended-ranout

Above: `feedEnded: ranOut,`

`ranOut` ONLY, never `reachedEnd`. reachedEnd folds in `lastPage >=
totalPages`, and totalPages is the same number feedTotal is derived from
(totalPages * 20) — so a lap that wrapped on it would be testing our own
arithmetic against itself, which is DERIVED_FEED_TOTAL_SOURCES' whole
point. A rippling board therefore proves absence only when a page came
back with nothing in it, and otherwise sits in boards_unprovable, which
is what the population function already tells readers it is.

## n026-fetchpaylocity

Above: `async function fetchPaylocity(s: JobSource): Promise<{ items: unknown[]; raw: string }> {`

Paylocity: the board page embeds the whole job list as first-party JSON in
a page-global pageData assignment (a Rippling-class channel — the vendor's
own data, undocumented, so the canary/breaker discipline applies if it ever
gets reference boards). ONE page, no pagination: the payload carries every
posting the board serves, so a successful read is a full read and the prune
may run — no windowed flag, like pinpoint.

An HTML shell WITHOUT a parseable payload is a FAILED fetch, never an empty
board. The extractor draws the same line personio and rippling learned the
hard way: a parsed payload whose job array is empty is an employer not
hiring (honest zero, prune runs); an unrecognizable page is drift or a
bot-wall, and throwing here keeps the prune away from a live board.

## n027-adp-page

Above: `const ADP_PAGE = 20;`

ADP Workforce Now: the career-center SPA's own public JSON list endpoint
(…/careercenter/public/events/staffing/v1/job-requisitions), paginated.
Measured live 2026-08-31: the server caps every page at 20 rows no matter
what the page-size argument asks for, the skip argument is a 1-BASED start
sequence, pages past the end answer an object whose requisition array is
empty and whose meta is ABSENT, and meta.totalNumber on a populated page is
the tenant's own advertised total. Boards observed are SMB-sized (largest
live sample 82), so the default window reads nearly every board whole; the
per-board pages override keeps the icims/PetSmart contract for any giant a
census later finds. windowed is honest: false only when the feed itself ran
out, so a fully-read board absence-prunes and a deeper one never does.

## n028-

Above: `/**`

Workday CXS: POST-paginated first-party list endpoint. Compound token
tenant~dc~site. Bounded to WORKDAY_PAGE_CAP pages (enterprise tenants can
hold thousands; the cap keeps one board's fetch from monopolizing a slice —
the rest rotate in on later passes, and the freshness filter drops the aged
tail regardless). List-only, so no description at this stage — but NOT
undated: the relative list age converts to a real date when <= 30 days, and
the CXS detail payload later supplies an exact startDate that replaces it.
(The "like BambooHR" that used to sit here was wrong on both counts.)

## n029-fetchworkday

Above: `async function fetchWorkday(s: JobSource, startOffset = 0): Promise<{ jobPostings: unknown[]; raw: unknown; windowed: bo`

A CAP THAT ALWAYS RESTARTS AT ZERO IS NOT A CAP, IT IS A CEILING.

Every pass fetched pages 0..24 — the same 500 postings, forever. A tenant
with more than 500 could never be read past the first 500, no matter how
many times we visited it. Measured 2026-08-25 against the four largest
at-cap boards: we hold 2,404 of 41,221 live postings, 6%. CVS Health serves
19,265 and we store 678. Across the 160 Workday boards sitting at the cap,
a 24-board sample says roughly 276,000 postings were never fetched — and
that is a LOWER bound, because several tenants report exactly 2000, which is
Workday's own reporting cap rather than a count.

`startOffset` continues where the previous pass stopped, so the SAME
per-pass cost walks the whole board over successive passes and wraps at the
end. Raising the cap instead would slow every pass and shrink how many
boards the rotation reaches, which is the trade the cap was chosen to make.

This only works because a windowed board no longer absence-prunes (see the
partialRead branch in the ingest): otherwise each pass would delete the
window the previous pass just stored, and the board would churn instead of
filling. The two changes are one change.

## n030-advanced

Above: `const advanced = startOffset + all.length;`

windowed: the tenant holds more postings than the page cap lets us fetch.
Membership then ROTATES — newer postings push older ones past the window,
and a role "vanishing" proves nothing about it being filled (verified live:
7 of 8 sampled Caterpillar "closures" were still open on the company site).
feedTotal is the company's own advertised count — stored on the
verification stamp so the UI can say "500+" instead of a false-precision
floor (Caterpillar showed "503 open" while advertising 942).
Wrap when the feed ran out OR when the next offset would pass the tenant's
own advertised total — otherwise a board whose total shrinks between passes
would page forever into empty responses.

## n031-return-jobpostings-all-raw-jobpostings-a

Above: `return { jobPostings: all, raw: { jobPostings: all }, windowed: feedTotal > all.length, feedTotal, nextOffset, feedEnded`

windowed compares the WHOLE feed against this pass's slice, not against the
running total, so it stays true for every pass of a multi-pass board — which
is what keeps the prune off while the board fills.
feedEnded/endOffset are the lap's evidence, and they are NOT recoverable
from nextOffset: `exhausted || advanced >= feedTotal` collapses "the feed
ran out" and "our arithmetic reached the number the tenant printed" into
one zero. Only the first is an observation about the employer's feed; the
second is an observation about feedTotal, which is the very number the
coverage test is supposed to check. See the lap proof gate.

## n032-fetchoracle

Above: `async function fetchOracle(s: JobSource, startOffset = 0): Promise<{ items: unknown[]; raw: unknown; windowed: boolean; `

Oracle Recruiting Cloud: paginated public CE REST. The finder carries the
site number and paging; items[0].TotalJobsCount is the tenant's own advertised
total, so (like Workday) we can tell a windowed fetch from an exhaustive one
and refuse to prune on a partial read.
startOffset rotates a tenant bigger than ORACLE_PAGE_CAP x ORACLE_PAGE_SIZE
across passes. No oracle board sits at that 2,000 ceiling today (measured
2026-08-25: zero), so this is a ceiling being removed before an employer
grows into it rather than a backlog being drained.

## n033-oracle-chunk

Above: `const ORACLE_CHUNK = 4;`

Chunked like icims, and for the same reason at the other end of the wire:
one-request-per-RTT made a 130-page giant a 160-second hot slice
(measured 2026-08-31 — the shed pinned at level 2 and the bootstrap
drain stalled behind two supermarket chains). Four concurrent per host
matches the census tooling's politeness; results are consumed IN ORDER,
and a short page or empty item anywhere in a chunk ends the walk so a
chunk member past the feed's end is never read as data.

## n034-return-items-all-raw-items-all-window

Above: `return { items: all, raw: { items: all }, windowed: !exhausted || startOffset > 0, feedTotal, nextOffset, feedEnded: exh`

A RESUMED READ IS WINDOWED BY DEFINITION. `windowed` tells the upsert that
this visit saw only part of the board, which is what stops the absence
prune deleting everything it did not see. On the deep cursor's WRAP visit
a giant board reads its last page, sets exhausted, and reported
windowed:false — so one partial read absence-pruned the whole employer.
Kroger (12,350 postings via pages:130), Costco, AutoZone, PetSmart, Ulta
and JCPenney all lose almost everything the moment their cursor wraps.

## n035-icims-page

Above: `const ICIMS_PAGE = 100, ICIMS_MAX_PAGES = Math.max(1, s.pages ?? 12), ICIMS_CHUNK = 5;`

The employer's own career-site JSON (token IS the host). Paginated at
100/page; bounded so one giant board can't wedge a refresh slice.

s.pages overrides the budget for NAMED giants only (PetSmart holds
10,911 — the default would window it at 11% forever), and pages fetch
in chunks of 5 so the giant costs ~23 sequential rounds, the same
order as Oracle's tolerated 20 — not 110 serial round trips.

## n036-pinpointhost

Above: `const pinpointHost = s.token.includes(".") ? s.token : `${s.token}.pinpointhq.com`;`

Documented public JSON — single unpaginated list.

A DOTTED TOKEN IS A CUSTOM DOMAIN, and custom domains are most of why
Pinpoint — the top-yield drivable vendor at 29.7 postings/board — was
nearly invisible to discovery: careers.riverisland.com CNAMEs to
CloudFront, not to anything pinpoint-named, and its DERIVED tenant
(riverisland.pinpointhq.com) answers 200 with {"data":[]} while the
custom host serves 62 postings. Measured 2026-08-07. So the subdomain
template only fits subdomain tenants; a token containing a dot is used
as the host itself.

## n037-ct

Above: `const ct = res.headers.get("content-type") ?? "";`

A LOGIN PAGE IS NOT A PARSE ERROR. When an employer turns their public
careers list off, the vendor answers 302 -> /login.php and serves HTML;
res.json() then failed with `Unexpected token '<', "<!DOCTYPE "...`,
which reads like our bug and is actually the board being private.
Measured 2026-08-24: 11 of 120 board failures were exactly this, every
one a BambooHR tenant redirected to a login page.

We use public feeds only and never authenticate, so this is a terminal
state for the board, not a transient error — and it deserves to say so
in one line rather than be diagnosed from a JSON parser's complaint.

## n038-interleavebyvendor

Above: `const interleaveByVendor = (list: JobSource[]): JobSource[] => {`

Two-tier cadence: HOT boards (heaviest inventory) re-verify on every
chain pass (~10 min); the long tail rotates through a fixed budget of
cold slices per pass, so a full tail rotation is bounded regardless of
how many boards the catalog grows to. Pass length is therefore FIXED:
ceil(hot/HOT_SLICE) hot hops + COLD_SLICES_PER_PASS cold hops.
Hot boards interleaved round-robin by vendor: Greenhouse giants fetch as
multi-MB JSON (content=true), and a slice whose first concurrent fetches
are ALL Greenhouse blew the isolate's memory ceiling instantly (the
13:04 + 13:20 WORKER_RESOURCE_LIMITs — carvana froze at one 250-row
chunk). Spreading vendors bounds concurrent heavy parses.

## n039-cold-slices-per-pass

Above: `const COLD_SLICES_PER_PASS = 160;`

80x160 = 12,800 cold boards/pass (the header said 9,600 for a week after the
160 raise — stale wrap math is how rotation health gets misjudged, so the
arithmetic lives next to the constant it describes). Slice size stays the
proven-safe 80 — more hops, never bigger hops. SR_CAP still bounds any
single board's fetch.

MEASURED 2026-08-27 at 31.5k cold boards, two windows: the pure cold-phase
rate is ~52 boards/min (one 80-board slice per ~1.5 min) — AT the 46/min
benchmark — while the wrap in flight was already ~16h old, half again the
~11.4h a benchmark wrap takes. Slice throughput is healthy; the missing
time is BETWEEN slices and passes: hot phases (~110 giants at ~13s each,
~24 min/pass), pass-end blocks, idle gaps to the next cron kick, and any
mid-wrap chain death the backup cron had to recover. Judge wraps by the
wrapMin stamp (written at wrap since .41), never by a rate window inside a
hot phase — the cold cursor legitimately parks for ~25 minutes there.

Sized from measurement, not intuition (2026-07-25, 28,055-board catalog):
a cold hop takes ~12-18s, so 48 hops is only ~12 min of work — yet a full
pass measured ~46 min end to end. The other ~34 min is FIXED per-pass cost:
the 12-hop hot phase (giants at HOT_CONCURRENCY=2), the pass-end block
(facets RPC, orphan prune, freshness sweep, exact-count capacity governor),
and the idle gap after the chain returns at pass end until the next cron
kick lands (the crons are 10 min apart, offset 5). That overhead is paid per
PASS, not per board, so the cold tail was getting ~26% of the wall clock.
48→120 pays it 2.5x less often: ~64 min per pass covering 9,600 boards =
~187 min for the full 28k wrap, against ~333 min at 48 (after the cursor fix
below stopped over-advancing). The cost is hot-tier cadence going ~46→~64
min, which the giants can afford; the claim is bounded by the COLD tail.
120 -> 160 (2026-08-19): the capacity lever funding the census program. The
per-PASS overhead (hot phase, pass-end block, idle gap to next cron kick) is
large and fixed, so more cold slices per pass amortizes it further — the
same measured logic as the 48->120 raise. Absorbs ~3,700 more boards per
rotation ahead of the Oracle/iCIMS census merges. Watch one full wrap after
deploy: freshness p95 and lastRotationAgeMin must stay near current values.

## n040-dead-board-threshold

Above: `const DEAD_BOARD_THRESHOLD = 6; // consecutive failures before prune + dormancy (unchanged bar from the prior prune)`

Dormancy skip-list (throughput): a feed dead for DEAD_BOARD_THRESHOLD straight
rotations has its postings pruned and is marked dormant — future cold slices
SKIP fetching it (a dead feed would otherwise burn the full FETCH_TIMEOUT every
rotation for nothing) and only recheck it once per DORMANT_RECHECK_MS so a feed
that comes back rejoins on its own. The board stays in COLD_LIST, so the
rotation cursor and sweep coverage are untouched — only the wasted fetch is
removed. DORMANT_CAP bounds the meta row against a mass die-off.

## n041-dead-board-min-failing-ms

Above: `const DEAD_BOARD_MIN_FAILING_MS = 40 * 60 * 60_000;`

THE PRUNE BAR IN THE UNIT IT WAS ACTUALLY CALIBRATED IN.

DEAD_BOARD_THRESHOLD was set when attempts arrived once per rotation, so "6
consecutive failures" meant "dead for roughly 41 hours". The count was never
the point; the DURATION was — it is the whole protection between a transient
vendor blip and deleting a company's corpus (an exit row per posting, every
row for the token deleted, a 12h blackout, and first_seen reset on re-ingest).

The retry lane decouples attempts from time: six attempts now fit inside
7h45m. Shipping that without this floor would have cut a 41-hour guard to
under eight, and a Workday CDN throttle of the kind already recorded in this
file (boards answering fine from outside, blocked only for our egress IPs)
would have pruned boards that were never dead. An adversarial review caught
it before it shipped.

40h keeps the bar where it was measured. Both conditions must hold, so adding
an even faster lane later cannot erode it — which is the property that was
missing, not the number.

## n042-vendor-zero-trip

Above: `const VENDOR_ZERO_TRIP = 0.5; // zero-feed fraction that trips the breaker`

Vendor circuit breaker: a vendor-wide API/shape change can make every board
return 200-with-empty — which per-board looks like "this company has zero
jobs" and would prune the vendor's whole corpus in one rotation while
flooding the closure log with fake closures. We track FEED-level zero rates
per vendor (decayed across slices; feed-level, before the freshness window,
because a healthy board's feed almost never goes empty — catalog admission
required >=3 postings). Past the trip threshold, zero-feed boards of that
vendor are skipped entirely: no prune, no closure, no stamp, and no failure
streak (a long quarantine must not convert into streak-prunes). Fail-safe
direction: a few stale postings beat mass-deleting live ones. Boards that
still return jobs keep processing, so a recovering vendor resumes itself.

## n043-salary-parse-version

Above: `const SALARY_PARSE_VERSION = 9; // v9 (2026-09-27): A COMMA IS A DECIMAL POINT IN MOST OF EUROPE and the money pattern r`

Bump when parseSalaryStructured's rules change — re-sweeps stored salary
text into salary_min_annual + salary_currency (rows are insert-only, so
ingest alone never reaches postings that predate the parser). v2 widened the
re-cover to rows v1 had already parsed (they held a floor but no currency).
WHAT THE SWEEP ACTUALLY SELECTS, since two comments in this file described a
predicate it has not had since v4: every row holding salary TEXT, with no
currency condition and no servable condition, skipping rows whose stored
values already match the current parse. A row with a currency and the wrong
amount IS reachable — which is why the comma-decimal rows, almost all of
which hold a currency beside a null or wrong annual, are repaired by a bump.

## n044-the-completion-stamp-expires-without-this-th

Above: `// The completion stamp EXPIRES. Without this the sweep is strictly one-shot:`

Date-the-undated sweep: greenhouse rows predating first_published capture
(insert-only rows never re-see the feed). Vendors whose feeds carry no date
at all (bamboohr/rippling) are structurally undated — no sweep can date
them; provenance labels stay the honest treatment. Measured backlog at v1:
~480 greenhouse rows.
v4 (2026-07-26): the WORKDAY PHASE IS GONE. v3 fixed the chain so the
phases actually ran — and the workday phase's burst of full list re-fetches
(8 boards/hop of paginated CXS lists, on top of the normal refresh cadence)
got Supabase's egress IPs throttled by Workday's CDN: the vendor breaker
measured 34% zero feeds and QUARANTINED workday — half the corpus in safe
mode. Verified from an outside network at the same minute: 6/6 boards
answered normally, so the block was on our IPs, self-inflicted. Workday
rows are already 75% dated and dated-ingest has been live for a week; the
marginal dates were not worth half the catalog. The remaining phases also
gain an inter-hop pause — the embed-sweep lesson, applied before it bites.
v5 (2026-07-28): v4's guards stop the replay bug recurring but cannot free
the rows it already stranded. The broken v4 chain walked to completion and
wrote {version: 4}, and the maintenance kick fires only on
`pbV.version !== POSTED_BACKFILL_VERSION` — so 4 === 4 meant the sweep was
permanently, silently "done" with bamboohr 43,687/43,687 and rippling
8,991/8,991 undated. Bumping the version is the ONLY thing that re-arms the
kick; it is what this constant is for. On the next kick the stored
resumeVersion (4, or absent) also fails the new match, so the chain starts
clean at bamboohr with an empty cursor rather than inheriting v4 state.

## n045-

Above: `/**`

The completion stamp EXPIRES. Without this the sweep is strictly one-shot:
it stamps {version: 5} when the last phase drains, and both kicks test
`version !== POSTED_BACKFILL_VERSION`, so it can never run again — while
BambooHR and Rippling keep ingesting undated postings every day, forever.
The 43,687-row backlog this sweep is about to clear would simply regrow, and
the only way to date the new arrivals would be a human remembering to bump
the version constant. That is not a mechanism, it is a chore.

Re-running is cheap precisely because the draw is `.is("posted_at", null)`:
after the first pass the population is one week's inflow, not 43,687 rows.

A missing or unparseable sweptAt reads as DUE. It is the conservative
direction (one cheap extra sweep) and it self-corrects, because completing
writes a fresh stamp.

## n046-corpus-ceiling

Above: `const CORPUS_CEILING = 1_200_000; // arm eviction above this`

Capacity governor: keep the corpus under a ceiling with headroom; when a
hiring surge or a wider board selection pushes past it, shed the STALEST
postings (oldest effective_posted — the exact rows sitting last on the
board) so the slots we keep are the freshest. Dormant while supply is under
the ceiling, so it costs nothing until it's actually needed. Hysteresis
(evict down to TARGET, arm at CEILING) keeps it from thrashing every pass
once it does engage.

Ceiling sizing (2026-07-13): the database moved off the free tier to an 8GB
plan (~6.6GB free at the time of the raise). A posting row costs ~5-6KB all
in (≤4KB description + metadata + indexes), so 300k rows ≈ ~1.7GB — well
inside headroom while leaving most of the disk for everything else. Stepped
97k → 300k → 500k, each raise on measured evidence (runbook bar). The 500k
step (2026-07-16): corpus at 202k with point-reads 0.44-0.58s, writes
flowing, insert-only design (no dead-tuple bloat), and the storage heartbeat
passing well under 75% of the 8GB plan — 500k ≈ ~2.75GB ≈ 34% of plan. The
vendor pipeline (Workday #12 + ongoing census yields) needs the headroom;
eviction was about to bind at 300k and cap net growth. Next stop (1M) only
after a bigger DB plan — the storage check will flag the ceiling first.
750k step (2026-07-17): the snapshot 7-14 census wave (5-7k verified new
boards incl. two Workday batches) projects the corpus into the 420-500k+
range — at 500k the governor would evict fresh inventory on arrival. Row
math THEN: ~5-6KB all-in → 750k ≈ 4.1GB ≈ 51% of the 8GB plan.
800k step (2026-08-28): the Oracle tranche (39 boards, ~82k postings behind
resolved names — Kroger 12.5k, AutoZone 11.2k) lands with the corpus at
~696k; at 750k the governor would evict ~28k of the freshest inventory on
arrival, through the one delete path that leaves no lifecycle trace. Row
math REDONE from live bytes, not the stale 5-6KB estimate: measured
2026-08-27, postings table 6.4GB at 683k rows = ~9.4KB/row all-in (the
4k→12k description-cap raise is most of the difference). 800k ≈ 7.5GB
postings + 1.36GB everything else ≈ 8.9GB ≈ 74% of the 12GB plan (the plan
size is the plan_disk_gb meta row now) — inside the storage alarm's 75%
line, which remains the tripwire that flags the true ceiling before it
binds. Next stop only after a wider plan or a byte-diet on descriptions.
1M step (2026-08-30): the disk was resized 12GB -> 20GB for exactly this.
Inbound at the time of the step: ~741k tracked after the .8 deploy, plus the
Oracle remainder (~85k across direct-resolved boards and the per-site split
of multi-brand tenants) and the first Paylocity tranche. At 800k the
governor would have evicted the freshest of that inventory on arrival. Same
measured row math as the 800k step (9.4KB/row all-in, 2026-08-27): 1M ~=
9.4GB postings + ~1.4GB everything else ~= 54% of the 20GB plan
(plan_disk_gb meta row, updated by migration 20260830260000 in this same
commit) — well inside the storage alarm's 75% line, which stays the
tripwire that flags the true ceiling before it binds.
1.2M step (2026-08-31): the operator widened the BOARD's charter — staffing
agencies and government employers join the corpus — and the room already
exists: same measured row math (9.4KB all-in), 1.2M ~= 11.3GB postings +
~2.5GB everything-else-grown-with-churn ~= 69% of the 20GB plan, inside the
storage alarm's 75% line. The earlier belief that 1.2M+ needed a disk
resize was arithmetic timidity, not arithmetic. Next stop (1.5M) does need
the wider disk.

## n047-backdate-slack-ms

Above: `const BACKDATE_SLACK_MS = FRESH_WINDOW_DAYS * 86_400_000;`

Which exit did this posting actually experience?

'aged_out' means what the exit ledger's header says it means: STILL
ADVERTISED WHEN IT CROSSED OUR 30-DAY CAP — a tenure our board watched
elapse. That is the event the ghost-rate stat counts.

A posting whose employer-stated date predates our FIRST SIGHTING by more
than the serving window never gave us that observation. It was already old
when it arrived, or (the case that forces this) it sat here undated for
weeks and a later backfill told us its real date. We did not watch it age;
we found out it was aged. Calling that 'aged_out' would let a dating sweep
manufacture ghost-rate evidence out of nothing but our own late knowledge —
and it would land as a one-day spike, because a sweep drains in hours what
the board would otherwise emit over months.

So: 'backdated'. Same row, same days_on_board (which is defined off the
employer's date and is still the employer's true tenure), different claim.
Written as a property of the DATA, not as a flag the dating sweep sets, so
every future backfill inherits it without anyone remembering this cohort.

## n048-insertexits

Above: `async function insertExits(`

THE EXIT LEDGER CARRIES THE EMPLOYER'S OWN DATE, AND SURVIVES ITS OWN DEPLOY.

Every exit row stamps posted_at verbatim — NULL where the employer published
no date, which is the honest answer and drops that row out of the dated
cohort instead of inventing an origin for it. It rides ALONGSIDE
days_on_board/origin_basis (tenureDays above), not instead of them: the
duration says which clock produced it, and posted_at lets a reader recompute
it without trusting us. Nothing here coalesces the two clocks any more.

DEPLOY-WINDOW TOLERANCE (the country-column rule). A statement naming a
column whose migration has not applied yet fails the WHOLE insert, and these
are best-effort writes that swallow their errors — the ledger would go
silently empty for the length of the deploy window, in the one table that
cannot be backfilled because the posting row is hard-deleted moments later.

THE RETRY IS AS WIDE AS THE ROW. It used to strip only posted_at, from a
time when posted_at was the only new column; the row now also carries
origin_basis, title, company and the lifecycle facets. PostgREST names ONE
missing column per response, so a retry that strips only what was named
dies on the second one — settleInsertError therefore accumulates the named
columns and re-inserts, bounded by the size of EXIT_OPTIONAL_COLS, until it
lands or the error stops naming a column we declared optional. Every exit
write site goes through here, so no site can be protected by a narrower
list than any other.

## n049-logwholeboardexit

Above: `async function logWholeBoardExit(`

WHOLE-BOARD PRUNES USED TO LEAVE NO TRACE AT ALL.

Two paths delete by company_token rather than by id — a board going dormant
after repeated fetch failures, and a board removed from sources.ts — so
neither passes through the per-posting closure path below. Audited
2026-08-17: they wrote to job_board_closures AND job_board_exits zero times.
Every other delete site writes at least one of them.

They are NOT closures and must never be logged as such: a dead feed is our
fetch failing, and an orphan is us dropping the board. In both cases the
employer may still be hiring, and job_board_closures is the table that means
"the company took the role down" — the one asset here nobody can reproduce,
and worth exactly as much as its precision. They belong in the exit ledger,
under a reason that says what actually happened.

Reads before deleting, because after the delete there is nothing to read. Best
effort throughout: a prune must never fail because bookkeeping did.

## n050-isingestpaused

Above: `async function isIngestPaused(client: SupabaseClient): Promise<boolean> {`

THE INGEST HAD NO OFF SWITCH, AND ON 2026-08-17 THAT MATTERED.

The database degraded to the point that `select id limit 1` took 20-30s and
action=list timed out outright. The operator response was to disable the four
pg_cron jobs that start a refresh. Sixty-six minutes later the ingest was
STILL RUNNING — status reported lastSliceAgeMin 0, and the cold cursor had
reset from 30000 to 640, meaning a fresh pass had begun after the pause.

Because pg_cron only ever STARTS a chain. chainNextSlice re-invokes this
function for the next slice, up to CHAIN_CAP hops (a full pass), and a
completed pass wraps the cursor and begins another. Once a chain is in flight
it sustains itself, so pausing the scheduler quiesces nothing. There was no
lever anywhere that stopped work already moving.

isIngestPaused is that lever. It is checked HERE, at the hop boundary, so an
in-flight chain DRAINS — the current slice finishes its writes and simply does
not schedule a successor. Nothing is killed mid-write, no partial state is
left behind, and the pass resumes from its stored cursor when unpaused.

Failure is deliberately asymmetric: if the flag cannot be read, the chain
CONTINUES. A transient meta read error must never silently stop the ingest —
that failure mode is invisible for hours and is precisely what today's
incident was made of. Pausing requires a positive, readable `true`.

## n051-slicestamperror

Above: `let sliceStampError: string | null = null;`

A CONTROL INPUT MUST NOT CARRY A PASSENGER THAT CAN THROW.

.36 put `Deno.memoryUsage()` inside the payload of both slice_stats writers.
The Supabase edge runtime does not provide it, so every write threw while it
was being constructed — inside the `.catch(() => {})` each writer wraps
around itself, which was written for a lost EMA sample, not for a payload
that can never succeed. MEASURED: the row froze at 2026-09-04T10:50:48Z, the
deploy instant, and stayed frozen for three hours while refresh_progress in
the same function kept advancing and bootstrap slices kept stamping. Thirty
minutes in, shedSignal called the row stale and floored the fleet at L1
(`drained: 10` on the live status), which is how a statistic nobody reads
took the whole rotation down to 48 boards a slice.

So: the probe is TOTAL — it answers {} rather than throwing, whatever the
runtime provides — and the fields it produces are spread in, never called
in place. And the writers below no longer swallow their failures silently;
`sliceStampError` carries the reason onto the status action, so the next
write that cannot land says so instead of going quiet.

## n052-traceseq

Above: `let traceSeq = 0;`

WHERE THE SLICE DIES, WRITTEN WHILE IT IS STILL ALIVE.

Three fixes have now been aimed at the chain dying with 546, and the row
that was supposed to explain it only lands if the slice SURVIVES — so it
records every death as silence and every theory as plausible. Measured
2026-09-04 18:16Z: the cursor and the bootstrap stamp (both written BEFORE
the fetch loop) were minutes old while the terminal stamp was 163 minutes
old, which places the death inside the loop but says nothing about where or
at what cost.

This overwrites ONE row as the slice proceeds, so whatever it last said is
where the isolate got to. Bounded and swallowed: a breadcrumb must never be
the thing that breaks what it measures.

## n053-shed-read-timeout

Above: `const SHED_READ_TIMEOUT = Symbol("shed-read-timeout");`

── ADAPTIVE LOAD SHEDDING ────────────────────────────────────────────────

The ingest and the people using the board share one small database, and
when it saturates the ingest is what pushes it over. MEASURED 2026-08-30:
a bare {limit:1} browse — the cheapest query the board has — took 30.2s
(page_query 29,455ms) while sliceStats read lastMs 184,951 and hotEma
176,371 against a healthy ~20-25s. Both numbers are the same event, and
rotation kept demanding its full slice the whole way down.

So the rotation now reads its OWN measurement and stands down. The EMA it
already records per slice is the signal; when it climbs, each hop takes
fewer boards, runs fewer workers, and stops paying for the deep lane. When
it recovers the levels lift on their own — nothing to remember to undo,
which is the failure mode of every static "temporary" cut.

GRADUATED rather than on/off, and stateless: the level is a pure function
of the EMA the last hop wrote. The EMA is 0.8/0.2 smoothed, so it cannot
whipsaw between levels hop to hop, and a request that lands exactly on a
boundary just alternates between two adjacent levels — harmless.

SAFE FOR THE CURSOR, and that is not an assumption: rotation.ts's
advanceProgress takes `baseSliceLen` — "the number of COLD_LIST boards
this hop consumed" — and its own docs say the caller must NOT substitute
the COLD_SLICE constant because the tail slice is already shorter. A
variable slice is the case that arithmetic was written for. What shedding
costs is rotation SPEED (fewer boards per hop → a longer full wrap), which
is the right thing to trade for a board people can actually use.
FAIL CLOSED. The first version returned 0 ("healthy, full size") when this
read errored or the row was missing — so on the MOST distressed database,
where meta reads themselves start failing, shedding switched itself OFF
and a full-throttle rotation piled onto the saturation (measured in the
second spiral of 2026-08-30: browse latency RISING 27s->42s->66s with
shedding "on"). An unreadable pulse is evidence of distress, not health:
a read that errors or cannot answer inside 500ms sheds to L2; a row that
is genuinely absent (fresh deploy, first-ever slice) sheds to L1, which
costs one mild hop before the first real measurement exists.

## n054-rowage

Above: `const rowAge = row?.updated_at ? Date.now() - new Date(row.updated_at).getTime() : 0;`

A FROZEN EMA IS SURVIVOR BIAS, and this row has TWO writers because a
slice can fail in two different places. stampSliceWork stamps the
moment the last board is fetched; recordSliceStats stamps the terminal
return, after the tail. So row age answers "has any slice finished
FETCHING recently" — a rotation dying mid-fetch touches neither writer,
goes stale, and is floored at L1 exactly as before.

What no longer trips it is a slice that fetched everything and then
died in the tail. That was measured for hours on .24/.25 — 12 slices
started, 0 recorded, while the fetching demonstrably worked — and it
shed FETCH capacity (cold 80 -> 48, concurrency 8 -> 5) to treat a tail
failure, which is why L1 held without ever recovering.

The EMA read below can therefore be OLDER than the row, and that is
deliberate: it is the last measured cost of a whole slice, which is
what these thresholds are calibrated against. The `works` minus
`slices` gap is how far behind it is, and is the tail-death rate.

## n055-hotphase

Above: `const hotPhase = inHotPhase;`

0 = healthy, 1 = strained, 2 = distressed. Thresholds are multiples of the
healthy slice — and the two phases stopped costing the same, so one pair
of absolute numbers could no longer serve both.

WHAT A SINGLE PAIR COST, measured 2026-09-01 from the heartbeat's own
alert: hot EMA sat at 46.5s against a 40s L1 line while cold sat at
25.7s, so the hot phase shed CONTINUOUSLY and the cold phase never did.
Permanent L1 halves the hot slice (10 -> 5), cuts concurrency (8 -> 5),
the deep lane (8 -> 4) and the bootstrap lane (25 -> 10) — a brownout with
no incident behind it. The cold tail fell to a 1,595-minute wrap against a
1,392 SLA and the published freshness claim went false with it.

Hot slices are expensive BY DESIGN now: 305 giant boards were given wider
fetch windows on 2026-08-31, which is the whole point of the deep lane, and
reading that deliberate work as database distress throttles the fleet for
doing what it was told. Real distress looks nothing like it — the
2026-08-30 incident ran a 219s hot EMA with 27s page queries, while today's
pages serve in ~0.4s.

So each phase is judged against its own healthy cost: hot ~46s, cold ~26s,
L1 at roughly double and L2 at roughly triple. The fail-closed kinds above
are untouched — an unreadable or frozen signal still sheds without asking
what phase it is.
── .64: THE COLD LINES MOVE WITH THE SLICE, AND THAT IS NOW WRITTEN DOWN ──

THESE ARE NOT DISTRESS THRESHOLDS. They are absolute slice durations, and
a slice's duration is set as much by SLICE_POSTING_BUDGET and CONCURRENCY
as by how the database is feeling. So every change to those two constants
is a change to what these numbers mean, and nothing said so: the pair
below was calibrated on "cold ~26s" and the live cold EMA is 36.2s, so the
cold phase had already drifted to 1.24x its L1 line — one bad hour from a
brownout — without anyone choosing that.

Re-derived — and the honest part is that the healthy cost is uncertain by
a factor of two, because it depends on whether a fifth worker raises the
aggregate rate at all (parsing is serial; see MAX_RESPONSE_BYTES):

    if concurrency scales:   loop 50.4s, coldEmaMs stays ~36.2s
    if it does not:          loop 62.9s, slice ~78s with the tail

"L1 at roughly double the healthy cost" therefore spans 72-156s, and the
line is placed to clear the PESSIMISTIC branch rather than the flattering
one — a threshold that sheds on a healthy slice is the failure this
comment already records twice, and it costs a permanent brownout, while a
threshold set 30s high costs one extra slice of lateness before it fires.

    L1 92s · L2 125s

The 2026-08-30 incident (lastMs 184,951, 27s page queries) is past both, so
the thing these lines exist for is still caught. A guard pins L1 against
the pessimistic slice (loop + tail) with margin, so this pair cannot be
left behind by the next budget change the way the 45s line was — and pins
L2 under what a wall-stopped slice reaches, because a threshold above that
is a shedder that is still read, still there, and cannot fire.

WHAT THIS RAISE COSTS, stated rather than buried: the cold phase now
tolerates a 2.5x slowdown before shedding where it tolerated 1.24x. That is
deliberate. At 45s against a 63-78s healthy slice the shedder would have
fired on healthy slices FOREVER — a certain brownout — while the cost of
the higher line is one extra slice of lateness at the start of a real
incident, and the incident still trips L2.

AND THE PAIR IS NOW UPSIDE DOWN, WHICH IS A FINDING, NOT A TYPO: cold L1
(92s) has nearly caught hot L1 (95s), even though hot boards are the
giants. The hot pair is what is stale — it describes a 46s hot slice that
has not existed since the 305 giants were widened on 2026-08-31, and the
live hotEmaMs is 100,554, ABOVE its own 95,000 L1. The hot phase is
therefore shedding continuously on duration alone right now, which is the
same no-incident brownout described above, reached from the other side.

It is not fixed here because the fix is not a bigger number. At a ~100s
healthy hot slice against a ~155s ceiling (the wall plus one straggler
plus the tail), the band between "healthy" and "cannot be distinguished
from healthy" is 1.55x, and no duration threshold splits that. The real
choice is whether hot slices should be SMALLER, or whether the hot signal
should stop being duration and become cost per posting (sliceMs / fetched,
which does not move when the slice size does). Deciding needs a per-phase
cost measurement this file does not take: hot boards fetched and hot slice
ms, recorded separately. Three theories have been shipped and retracted on
this signal already, so it is measured next, not guessed at now.

AND THERE IS A CEILING ON THESE NUMBERS, WHICH IS THE OTHER HALF OF WHY
2,600 WAS REFUSED. The loop stops taking boards at SLICE_WALL_BUDGET_MS,
so a slice cannot run much past 120s + one FETCH_TIMEOUT_MS straggler +
the tail — call it ~150s. A duration threshold set above that can never
fire: the shedder would still be here, still read, and structurally dead.
L2 at 115s leaves that headroom. Push the budget until a healthy slice
needs an L2 above ~150s and the choice stops being "which threshold" and
becomes "shedding or throughput", which is not a trade this file gets to
make quietly.

THE HOT PAIR IS UNTOUCHED AND IS ALREADY WRONG. Measured today: hotEmaMs
100,554 against a hot L1 of 95,000 — the hot phase is shedding
CONTINUOUSLY on duration alone, which is the same "brownout with no
incident behind it" the note above describes, arrived at from the other
direction. Either the 305 giants widened on 2026-08-31 ARE the new healthy
hot cost and this line should move with them, or hot slices are genuinely
running close enough to the survival envelope that shedding them is right.
Those need a hot-slice cost measurement (hot boards fetched vs hot slice
ms, which nothing records per phase today) and not another guess — three
theories have already been shipped and retracted on this exact signal, so
it is left alone and named instead of adjusted.

## n056-effconcurrency

Above: `const effConcurrency = Math.min(CONCURRENCY, shedLevel === 2 ? 3 : CONCURRENCY);`

SHEDDING MUST NEVER RAISE CONCURRENCY — and the byte budget is derived
from the number this expression can produce.

These literals were written when CONCURRENCY was 8, where 5 was a cut.
After the cut to 4 the same literal silently RAISED the worker count by
25% on the exact signals that mean the database is already struggling
(shed 1 = the cold-page EMA past 45s, or a signal that is absent/stale) —
load shedding that adds load. It also put five workers, not four, at the
per-response ceiling MAX_RESPONSE_BYTES is divided by, spending the
headroom that arithmetic reserves. Clamped, so level 1 can only ever hold
or reduce, and so peak board workers is provably max(CONCURRENCY,
HOT_CONCURRENCY).

Level 1 now HOLDS the worker count — its cuts are the cold slice size, the
deep lane, the bootstrap take and the retry lane, which is a coherent
ladder — and level 2 still cuts to 3. The clamp stays even though the
literals no longer need it: it is what makes the byte budget's denominator
a property of this line rather than a number a later edit can invalidate.

.64: CONCURRENCY is 5, so level 2's literal 3 is a cut of two workers and
the clamp is doing nothing at either level. It stays for the same reason as
before — the next edit to CONCURRENCY must not be able to turn a shed into
a raise, and that has already happened once.

## n057-hotbybudget

Above: `const hotByBudget = Math.max(1, Math.floor(HOT_POSTING_BUDGET / MAX_POSTINGS_PER_VISIT));`

THE HOT PHASE GETS A LEVER TOO. The signal reads hotEmaMs when inHotPhase,
but every knob above is cold-only — so the exact phase whose EMA trips the
shedder ran at full size regardless (measured live during the post-pause
catch-up: hot slices at 341s, hotEma 283s, shedLevel 2, and the hop took
its full 10 giants anyway while browse latency climbed 1s -> 3.6s). Fewer
giants per hop is the one cut that shortens a hot slice.
THE HOT SIDE NEEDED THE SAME TREATMENT AS THE COLD SIDE, AND DID NOT GET
IT IN .50. Hot boards ARE the giants: each can return the whole per-visit
cap, so ten of them is ten times the cap in postings — far past the
ceiling — while the hot cursor advanced by ten regardless of how many were
actually read. That is the same "cursor outran the read" defect .50 fixed
for the cold lane, and it is why slices went on dying in the hot phase
after that fix (reported live: heap ~90MB mid-loop, EMA ~88s, still no
loop-done mark).

A hot board can hold up to the cap, so the number of hot boards a slice
may take is the posting budget divided by the cap. Nothing is skipped: a
hot board resumes at its own offset next visit like every other capped
board.

## n058-effbootstrapperslice

Above: `const effBootstrapPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 10 : BOOTSTRAP_PER_SLICE;`

THE ACCELERATOR LANES SHED TOO, or shedding inverts the slice. The first
version cut only the cursor-bearing baseSlice: at L2 that left 24 rotation
boards beside a 25-board bootstrap lane and a 5-board retry lane, so the
lanes that consume NO cursor became more than half the hop while the part
carrying the freshness claim took the entire cut. Retries are also the most
expensive fetch there is when they fail again — a dead feed burns the full
FETCH_TIMEOUT — which is why they go first and completely.

## n059-deeptake

Above: `const deepTake = shedDeepPerSlice;`

THE CURSOR MUST NOT ADVANCE PAST A BOARD NOBODY READ.

The slice is [demand, bootstrap, retry, COLD ROTATION, deep] and the board
budget stops the loop after N boards in that order — so with a budget of
16 and a bootstrap lane of 25, bootstrap consumed the whole budget and the
cold rotation got NOTHING. Meanwhile the cursor advances by
baseSlice.length, which was still the full 80. Measured over ten minutes
on .47: the cold cursor moved 16,720 -> 17,760, past 1,040 boards, while
at most ~336 could have been fetched. Two thirds of the rotation was being
marked visited without being read, which is why freshness kept climbing
while every other signal said the chain was healthy.

This file already documents the same defect for load shedding, a few lines
up: "advancing by 10 while shedding took 3 would skip 7 giants' freshness
every shed hop". The board budget was a second way for the take to fall
short of the composed slice, and the cursor never learned about it.

So every lane is now sized to FIT the budget before the slice is composed,
and the cold rotation — the lane the freshness promise is measured on —
is served last but reserved first. A lane that gets 0 takes 0 boards and
moves no cursor, which is honest; the previous behaviour was not.
THE LANES GO BACK TO THEIR OWN SIZES, AND THE CURSOR IS CORRECTED INSTEAD.

.50 shrank every lane to fit a board budget so the composed length would
equal the length the loop could reach. It worked, and it throttled the
rotation to ~9 cold boards a slice: 4,889 slices a pass, freshness 403 ->
2,320 minutes. Shrinking the slice was the wrong side of the trade.

The real tension is that a MEMORY-bounded slice necessarily fetches fewer
boards than it composes — the posting budget stops it partway, by design.
So the fix belongs on the cursor, not the slice: compose a full-sized
slice, let the posting budget stop it wherever memory says, and advance
the cold cursor after the loop by the base-slice boards ACTUALLY
ATTEMPTED. Nothing is skipped and nothing is throttled.

.90: the deep lane now runs before the cold rotation (n426); the cursor rule
is unchanged, and it is why base can be the tail.

## n060-

Above: `}`

AND THE DEMAND LANE IS PAID FOR OUT OF THE SAME BUDGET. It is capped at
five and sits AHEAD of the cold rotation in the slice, so without this
the five it takes would come straight out of the cold lane's share while
the cursor still advanced by the untrimmed length — the very gap the
lane sizing above closes. Trimmed here rather than earlier because the
demand count is not known until now, and `advanceArgs` reads
baseSlice.length below, after this point.

## n061-bootstrapviarpc

Above: `let bootstrapViaRpc = false;`

── THE QUEUE STAYS IN THE ROW; THE EDGE STOPS LOADING IT (20260903150000) ──

Every slice used to read this row's ENTIRE queue array, take a few
tokens off the front, and write the entire remainder back — half a
megabyte parsed and re-serialised per slice once a deploy's re-append
had refilled it to 8,453 tokens, inside the same invocation that is
fetching up to eighty feeds. Measured 2026-09-03: after .27 capped
per-board fetch size, twelve slices completed in the window between
deploy and that re-append, then none — `works` froze while the cursor
kept advancing, an invocation dying in its fetch loop.

bootstrap_queue_take/append/stamp do the same three things inside one
row lock and return only what was asked for. Semantics are the legacy
path's, unchanged: take() removes the first n whether or not they are
in this slice (that is what slice(0, n) did) and returns the ones that
are not; lastSlice.selected is stamped AFTER resolution because a token
that resolves to no board is the fork this lane's own comment says it
needs to see. Status still reads pending as the array's length.

DEPLOY-BEFORE-MIGRATION: when the RPCs do not exist yet the call fails
with PGRST202 and everything falls through to the legacy block below,
byte-for-byte as before. In that window a version change pays
get_empty_boards once here and once again in the fallback — bounded to
the gap between function deploy and migration apply, and correct.

## n062-queue-length-0

Above: `if (queue.length === 0) {`

REFUTED, 2026-08-25 — DO NOT "FIX" THIS LANE AGAIN ON THE SAME
REASONING. An audit and then I myself read the ~21-27% of registry
boards holding zero rows as recoverable inventory, on the strength of
probing seven of them and finding their vendor APIs serving live
items (zencoder 5, helm-ai 9, integrate 9, and others). The claim was
"tens of thousands of postings from employers already admitted".

It was wrong, and the error was counting feed ITEMS without reading
their DATES. Re-probed with dates: zencoder's 5 items are all 36 days
old, helm-ai's 9 run 188 and 348 days old, integrate's 9 are 80-118
days old. Every one is past the 30-day cap, so the correct number of
rows to store from those boards is ZERO. The boards are empty by
POLICY, not by failure.

The lane itself is healthy: instrumented per slice, it reports
drained 25 / selected 25 — the tokens resolve, the boards are
fetched, and nothing is stored because nothing qualifies. The
zero-row share RISING from 21% to 27% across that day is the
freshness enforcement working (including the multilingual Workday
parser shipped the same day), not a regression.

Before treating an empty board as recoverable, check the AGE of what
its feed carries. A board of 30+ day-old listings is a board this
product deliberately does not serve.

A DEPLOY MUST NOT RESTART THIS QUEUE. It re-seeded whenever
BUILD_VERSION changed, and get_empty_boards returns a stable order —
so every deploy sent the drain back to the front of the same list
while the tail was never reached. The comment further down this file
already warned that "every deploy resets the bootstrap lane"; what it
did not say is that the lane therefore never finishes.

Measured 2026-08-24, after twelve deploys in one day: 7,564 boards
pending, and 21% of a stratified sample of the registry serving ZERO
postings. Probing seven of those zero-row boards against their own
vendor APIs, SEVEN returned live jobs — 110 openings across them,
none genuinely empty. At roughly ten postings each that is tens of
thousands of jobs the board has the right to serve and has never
fetched.

The queue now refills only when it is EMPTY, so progress survives a
deploy and the tail is eventually reached. Boards filled in the
meantime drop out naturally, because the refill asks which boards are
still empty. The cold rotation remains the guarantee — this lane is
only an accelerator — so a slow refill costs nothing but time.

## n063-try

Above: `try {`

A MERGE MUST NOT WAIT FOR THE TAIL OF A 7.5K BACKLOG. Refill-on-empty
(the 2026-08-24 fix) stopped deploys from restarting the drain — and
quietly meant a freshly merged board waits for the whole cycle: the
Oracle tranche sat at zero for 2+ hours while eight of its boards
were probed live and verified fetchable. On a version change, the
empties NOT already queued are APPENDED AT THE BACK: the drain
position is preserved (no restart pathology), nothing is re-ordered,
and the merge's boards are reached within this cycle instead of the
next one. Already-drained empties re-enter at the back too — that is
the lane re-verifying them once per deploy at its normal 25/slice
budget, which is what the lane is for.

## n064-await-client-from-job-board-meta-upsert

Above: `await client.from("job_board_meta").upsert(`

Optimistic drain (same rule as the cursors): a died slice skips
ahead rather than wedging on the same bootstrap boards.
WHAT THE LANE ACTUALLY DID, not what it was asked to do.

The queue drains 25 tokens per slice unconditionally, so "pending
is falling" proves only that the cursor moved. Measured across a
day: the queue fell 7,564 -> 386, refilled to 7,767, drained again
at ~80/min — and the share of registry boards with zero rows ROSE
from 21% to 27%. Boards are being drained without being filled, and
with only ~5 failures per ~80 drained they are not failing either.

Three states are indistinguishable from outside: the token never
resolved to a JobSource, it resolved and was never fetched, or it
was fetched and legitimately had nothing. `selected` separates the
first from the rest, which is the fork I have guessed at twice.

## n065-deepcursorrow

Above: `const deepCursorRow: Record<string, unknown> = await (async () => {`

DEEP CURSORS — where each capped board's last pass stopped.

One small meta row, token -> offset, only ever holding entries for boards
the vendor says are bigger than one pass can read. A board that wraps is
deleted from the map rather than stored as 0, so the row tracks the boards
still filling and nothing else.

Read BEFORE the slice is sealed (moved up here in .19) so the lane below
can use the map as its work list. Nothing between the old site and this
one touched it, so the move is positional only.

## n066-deeplaps

Above: `const deepLaps: Record<string, LapState> = (() => {`

── LAP EPOCHS: HOW A BIG BOARD PROVES A POSTING IS GONE ────────────────

A windowed board reads 250 postings a visit, so absence WITHIN a visit
says nothing: an id we did not see may be sitting at offset 9,000. That
is why `partialRead` suppresses stamping and closure logging, and the
suppression is right — 7 of 8 sampled "closures" on a windowed board were
still live on the employer's site (2026-07-21). It is also why CVS Health
(16,027 postings), Marriott, Albertsons and every other board over the cap
has been STRUCTURALLY INCAPABLE of producing a closure, which quietly
excludes ~36% of inventory from the one asset nobody can rebuild.

Absence is provable across visits instead. The deep cursor already walks a
big board from offset 0 to a wrap; the union of the windows in one such
LAP is the whole feed. So each board carries an epoch:
  - a lap OPENS at a visit whose cursor was 0, with a fresh epoch number;
  - every posting the lap serves is stamped with that epoch (one row-write
    per posting per lap, folded into the unstamp write already here);
  - at the wrap, a stored id still not carrying the epoch was absent from
    EVERY window of a complete pass — gone, not displaced.

Six things must hold before a wrap is allowed to prove anything, and any
one of them missing drops the board back to today's behaviour:
  `e` the epoch, non-zero only if the lap OPENED under this code at an
      offset that left work to resume (so the first partial lap after a
      deploy proves nothing and cannot mass-stamp a board out of the
      serving fence, and a board read whole in one visit never opens one);
  `f` no epoch write failed anywhere in the lap — including a visit that
      could not stamp at all, which is what the deploy-before-migration
      window looks like from in here;
  the FEED must have ended: a short or empty page, observed. Every fetcher
      also wraps on `advanced >= feedTotal`, which is not an observation
      about the employer's feed but about feedTotal itself — the number a
      coverage ratio would then be checking against;
  `t0` the advertised total pinned AT OPEN, so a total that collapses
      mid-lap cannot relax the test it is the denominator of;
  `s` the offset the lap reached, which must land within LAP_TAIL_SLACK of
      that total — an offset shortfall is unfetched territory, not churn.
`w` is the last wrap this board actually proved — the coverage signal the
published population reads — and `w0` the first one ever, which is what
separates the 30-day backlog the first laps drain (logged
absence_basis='lap_backfill', its closed_at knowingly late) from ordinary
churn. Both are inert to the two other readers of this row.

## n067-deepboards

Above: `let deepBoards: JobSource[] = [];`

FAST LANE FOR BOARDS STILL FILLING (.19) — a cadence fix, not a logic fix.

The cursor plumbing works and is not touched here. What did not work was
how often a windowed board came round again. Measured 2026-08-26: the cold
cursor advances 46 boards/min across 31,501 cold boards, so a board is
revisited about every 11.4 hours. Workday serves 500 per visit, so CVS
Health (19,253 advertised) needs 39 visits = 18.5 DAYS to be read once,
against a 30-day freshness cap — it can never be complete and fresh at the
same time. Live proof the second window was never reached: the status
bundle read boards 66 / sumOffset 33,000, which is exactly 66 x 500.

deepCursors IS the work list, and it maintains itself — an entry appears
when a board reports a non-zero next offset and is deleted the moment it
wraps. So this lane needs no queue of its own, nothing to seed, and
nothing to drain: it empties itself as boards finish. That is what makes
it safe to run every cold slice.

Round-robin phased on the cold cursor so a board deeper in the map is not
starved by the ones ahead of it, deduped against everything already in the
slice so no board is fetched twice in one pass, and capped at the size the
bootstrap lane already proved fits the wall-time budget.

.90 (n426): the lane runs AHEAD of the base rotation, one board a slice
(DEEP_LANE_TAKE) taken out of the bootstrap take; until then it sat last and
visited nothing. The start is no longer `cold % candidates` but the cursor's
place in its rotation mapped onto the map (selectDeepLane, deep-lane.ts).

## n068-deeplane-at-new-date-toisostring-candi

Above: `deepLane = { at: new Date().toISOString(), candidates: tokens.length, selected: deepBoards.length, visited: 0, start };`

Instrumented for exactly the reason the bootstrap lane is: selected
vs candidates separates a token that never resolved to a JobSource
from one that was fetched and had nothing left to give. Without that
split, an offset that does not move has two indistinguishable causes
and gets guessed at — which is how this rotation was misread three
times before it carried a number.
`visited` is filled after the loop. SELECTED IS NOT VISITED, and the
gap was the whole point: until .90 the deep lane was LAST in the composed
slice (index >= COLD_SLICE + the other lanes), and the posting budget stopped
the loop around 30 boards, so nothing in this lane had been fetched
in a very long time (visited 0 in 16 of 16 cold slices sampled on .89,
2026-10-06). Since .90 it runs ahead of base (n426), so `visited` should
equal `selected` on nearly every cold slice; a gap now means the start gate
(posting budget, board budget, wall, heap) deferred the deep board.
The history, as written then: `selected: 2` standing alone reported the lane
as working — the wrong side of exactly the fork this instrumentation
was added to resolve, and the dial the runbook tells an operator to
judge rotation by. (At-cap boards still advance their own deepCursor
whenever the BASE rotation reaches them, so this starves the lane, it
does not stop the paging.)

## n069-const-data-bfmeta-await-client-from-job

Above: `const { data: bfMeta } = await client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle();`

Board-failure state (streaks + dormancy + last-failure stamps) drives the
consecutive-failure prune, the dormancy skip-list AND the retry lane below.
Read once here so hot and cold hops share a single read/write, and so cold
slices know which dead boards to skip BEFORE fetching. Demand-injected
boards are never skipped (a user just opened them).

Read BEFORE the slice is sealed (moved up with the retry lane) so the lane
can use the failure stamps as its work list.

## n070-const-data-vhmeta-await-client-from-job

Above: `const { data: vhMeta } = await client.from("job_board_meta").select("v").eq("k", "vendor_breaker").maybeSingle();`

Vendor circuit-breaker state (see constants above): decayed per-vendor
feed-zero counters + the currently quarantined vendor set. Key is
vendor_breaker — vendor_health belongs to the schema-drift canary action.

Read BEFORE the slice is sealed (moved up in .69) because the stale lane
below classifies against the quarantine set. Positional only: nothing
between the old site and this one touched it.

## n071-staleboards

Above: `let staleBoards: JobSource[] = [];`

THE STALE LANE (stale-lane.ts, wired in .69). The freshness rollup's
max_min sat at 14.6 days and named nobody; get_stalest_boards
(20260909218000) names the tail and classifyStale says why each board is
there. Only the 'unexplained' class — catalogued, vendor healthy, no
failure/dormancy/oversize record, simply not reached — is fetched; every
other class is another lane's, or nobody's, to fetch.

COLD SLICES ONLY, on the retry lane's ladder (effStalePerSlice), one RPC
and one meta read per hop, at most STALE_PER_SLICE boards through the
ordinary fetch path with the ordinary reservation, budget and failure
fold. The lane sits ahead of the base slice for the reason the retry lane
does: under SLICE_POSTING_BUDGET the tail of the composed slice is what
gets deferred (budgetHit was true on the live sample this was designed
against), and a lane that is only ever deferred is the "selected is not
visited" starvation the deep lane's instrumentation exists to expose. The
cold cursor still advances by baseAttempted, so no rotation board is
marked visited unread; on a budget-hit hop the lane displaces at most
STALE_PER_SLICE base fetches to the next hop.

THE RPC MAY BE ABSENT — a deploy that lands before migration 20260909218000
— and PostgREST answers that as an error object, not a throw. Either way
the lane is a no-op with a warning and the hop is untouched; a missing
accelerator is never a failed slice.

## n072-staleexclude

Above: `const staleExclude = staleExclusion({ oversize: oversizeTokens(OVERSIZE_BOARDS), tries: staleTries });`
(since .90 the registry is keyed by board, so its keys go as tokens; n422)

Cancelled, not abandoned: the request carries its own abort at the
deadline, so a slow RPC does not sit unread past the race (the
abandoned-response class that leaked the heap in .28-.38). A rejected
request (network, TLS, abort) is mapped to an error OBJECT here so it
publishes as rpc:"error" with the cause — withDeadline alone would
have read it as "timeout" and sent an operator to the RPC's plan
instead of the network.

THE EXCLUSION (.71, migration 20260909222000). The window's permanent
residents — the OVERSIZE registry, the tokens this lane already gave
up on, the Object.prototype names — are the lane's own state, so it
hands them to the RPC as p_exclude and they never occupy a row. Built
by staleExclusion() from Sets/Maps only, bounded at STALE_EXCLUDE_MAX.

## n073-the-cursor-rule-advanceprogress-is-shared-w

Above: `// The cursor rule (advanceProgress) is shared with the post-slice write`

REMOVED 2026-07-25 — the "quiet lane" (boards with no new posting in 14d
skip every other rotation, keyed on a `rot` parity counter). Two reasons,
either one sufficient:
  1. It never ran. The post-slice refresh_progress write omitted `rot`, and
     an upsert replaces the whole v JSON — so `rot` was wiped every hop and
     read back as 0. The parity test was never true in production.
  2. It must not run. It doubles re-verification age for "most of the
     catalog at any moment", and the published claim ("every feed
     re-verified within a few hours") is an ABSOLUTE bound on P95, not a
     median. At any wrap time that keeps the claim true, 2x the wrap
     breaks it — the lane can only ever buy throughput by spending the
     exact budget the claim owns.
Throughput now comes from covering the tail faster (COLD_SLICES_PER_PASS),
which costs no board its cadence. get_quiet_boards stays in the DB, unused.

## n074-await-admitslice-client-next-force

Above: `if (!(await admitSlice(client, next, { force, prog: (prog as { updated_at: string } | null) ?? null }))) {`

ADMISSION IS COMPARE-AND-SET. The slice lock above is read-then-write
with every read between here and there in the gap — tier lists, the
shed signal, the lanes, on cold hops the stale lane's RPC under a 4s
deadline — and two non-forced kicks inside that gap both passed it.
Before .69 the only non-forced kicks were the two crons five minutes
apart; the dead-chain watchdog fires from status calls at random times,
and a chain hop is forced, so two admitted hop-0s are two chains for the
rest of the pass — twice CONCURRENCY against the database, the load the
shed ladder exists to prevent. The write now lands only if the row is
still the one the lock read; a loser answers "skipped", the word the
parent's declined-regex and the cron already read.

## n075-inflightreserve

Above: `let inFlightReserve = 0;`

IN FLIGHT COUNTS. The budget used to compare only what had LANDED, so with
concurrency 8 and a 2,000-per-visit cap, up to 16,000 more postings could
already be held past the check — and a slice that read 10,402 landed and
"under budget" was, in memory, anything up to 26,000. Measured 2026-09-03:
the chain died three times in an hour on WORKER_RESOURCE_LIMIT with
budgetHit=false every time, the last completed slice at 10,402. Each
started board reserves its worst case until it returns.

## n076-fetchedinslice-inflightreserve-slic

Above: `if (gate === "reserve") {` (until .90 the check was spelled inline as
landed plus in-flight against SLICE_POSTING_BUDGET; it is the `reserve`
verdict of start-gate.ts now, n423)

YIELDS, DOES NOT EXIT. `return` ended the worker for the rest of the
slice, so every reservation trip permanently removed one of the eight
— concurrency ratcheted monotonically down to 1 in the tail of every
cold slice, and a rotation whose speed buys the published 480-minute
freshness promise ran several times slower than its measured ~26s.
It cannot spin: the landed check above already handles the budget
being genuinely spent, so reaching here means another worker is in
flight and will lower the reservation when it returns.

## n077-spins

Above: `const spins = (yieldsByToken.get(s.token) ?? 0) + 1;`

NOTHING IN FLIGHT MEANS NOTHING WILL CHANGE.

This branch waits for an in-flight board to land and lower the
reservation. But `inFlightReserve` only falls when a board
returns, and `fetchedInSlice` only rises — so when the reservation
is already zero and the sum still exceeds the budget, the worker
is waiting for an event that cannot happen. Every worker reaching
it spins on a 250ms timer until the platform kills the isolate,
which is why `loop-done` had NEVER appeared in any trace since
.39 introduced this yield, and why six versions of memory fixes
changed nothing: the loop was not dying, it was never exiting.

It was nearly unreachable at the old 12,000-posting budget — the
window is fetchedInSlice within one board's reservation of the
budget — and .52's measured budget of 1,400 made it ordinary.

So: if nothing is in flight, defer the board rather than wait for
it. The spin cap is the backstop for anything this reasoning has
not anticipated; a deferred board is not a failed one, and the
slice finishes, stamps, and chains.

## n078-reserve

Above: `const reserve = inHotPhase || deepTokens.has(s.token) || CAPPED_VISIT_VENDORS.has(s.source) || !!s.pages ? MAX_POSTINGS_`

ROTATION PARKED AT ZERO — 2026-08-25, after one deploy.

Measured before: CVS Health 678 stored against 19,265 advertised.
Measured after a completed pass on .16: exactly 500, and still
exactly 500 eleven minutes and one refresh later. O'Reilly 571 -> 500,
Trinity 570 -> 500, Wells Fargo 585 -> 498. Every at-cap board
converged on one window and LOST rows it previously held.

Rows are not churning wholesale — CVS's 500 carry first_seen spread
across four different hours today, so they survive passes. But the
count is pinned at exactly the window size and 178 rows are gone, so
whatever the cursor is doing it is not accumulating, and I could not
read job_board_meta as anon to see whether it advanced at all.

I promised to park this rather than let it run on a live board while
I guessed. The plumbing stays because it is correct and tested; only
the non-zero start is withdrawn, which restores exactly the previous
fetch behaviour. Re-arming needs the cursor readable first — a
deepCursor summary on the status action — so the next attempt can be
told apart from this one by a number instead of an inference.

## n079-boardsdone

Above: `++boardsDone;`

Every 24th board, so the row names the neighbourhood of the death
rather than the exact board — two or three writes on a cold slice.
Every 8th now, not every 24th: the slice that died had written one
mark and then nothing, which located the death within a 24-board
window. Eight narrows it without making the write itself the cost.
EVERY board now, not every eighth. The budget is 8, so this is at
most eight writes a slice, and "always 8" was exactly the reading
that hid which board the slice was on when it died.

## n080-failreason-startswith-oversize

Above: `if (failReason.startsWith("oversize")) {`

AN OVERSIZE BODY IS A DEFERRAL, NOT A FAILURE.

The byte bound aborted this board's response before the allocation
existed, which is the whole point, but the board must still come
back, so this must not reach `failed` (a failed board feeds the
failure streak, the dormancy prune and the operator's list, and
none of those is true here: the vendor answered us).

By the time a board gets here the visit has already tried what it
can (since .90): a greenhouse board enrolled in light mode and, gate
permitting, read its light list in the same visit (n081), and a
vendor with a slim spec was streamed (n411). What reaches this branch
is the board neither could read. It is registered by board (n422),
named in this slice's log line, and pushed onto `budgetSkipped`, the
channel the failure accounting already excludes. A board whose light
re-read also crossed the bound is registered at the light list's
size, which is the size its next visit will meet.

UNTIL .90 THIS BRANCH ALSO "GAVE THE SLOT BACK". On an enrolment it
took one off `baseAttempted`, meaning to re-offer the board on the
next slice. But the cold cursor moves by POSITION (`cold + baseAttempted`,
rotation.ts), so one fewer only started the next slice one place
earlier: it re-read whichever base board started last in this slice,
never the board just enrolled, and every board enrolled at the byte
bound waited a full cold rotation for its light read. Measured on .89
(2026-10-05/06): speechify enrolled 19:47Z and read light at 01:44Z
(5h57m), samsara 21:22Z to 02:59Z (5h37m), lush (73 of ~212 in-window
postings served, 19 of them closed upstream) still waiting. The
decrement is gone: the enrolled board was started, and the cursor
counts it.

## n081-light-reread-in-the-same-visit

Above: `if (!r) ({ r, failReason } = await lightReread({` and light-reread.ts.

READ THE LIGHT LIST IN THE VISIT THAT FOUND THE CONTENT LIST TOO BIG.
After the first read fails, `lightReread` decides:

- Only an `oversize` verdict, on a LIGHT_CAPABLE_VENDORS board that
  was not already light, is offered to the set at all (an already-light
  board's failed read WAS its light list, so another read would be the
  same bytes). The enrolment is the existing writer, enrolDynamicLight,
  under the existing cap (AUTO_LIGHT_CAP 500, `slice(-500)`): F1 adds
  no enrolment path and changes only when the read happens.
- If the set refuses the board, nothing is read: the re-fetch would be
  byte-for-byte identical. If it enrols, the board is read again only
  when it is greenhouse (the one vendor whose light list differs: it
  drops ?content=true), not already re-read this slice, and the start
  gate passes (n423, without the board count: it is the same board, so
  no second `++boardsDone`). The read takes the board's reservation
  again and releases it, so other workers see it in flight, and its
  rows land through the ordinary success path (descriptions omitted,
  then filled by backfill-desc, as on any light visit).
- A refused gate defers the board: it stays enrolled, so its next
  visit reads light, a rotation later. That is the `deferred` count.
  If it is regularly above zero, .91 adds a one-shot re-offer keyed by
  board; not now.
- A light read that fails is never a vendor failure: an oversize
  verdict replaces the first one (the light list is itself over the
  bound: liquidpersonnel 13.9 MB, pulse 20.6 MB, which the streamed
  light read heals in the same visit, n424), any other failure (timeout,
  5xx, 429) keeps the first verdict, and a board neither read reaches is
  deferred by n080. `lightOversize` says which: true only when the list
  the bound refused was the light list (light at the start, or the
  re-read's own verdict), the one case the greenhouse stream may read.

recruitee, workable, teamtailor and pinpoint boards in the registry are
never re-offered: none has a light form a filler can refill, so their
abort would repeat identically.

`slice_stats.lightReread` keeps running totals {enrolled, reread, ok,
deferred, since}, added each slice by the recorder (read-modify-write
like `slices`, so two concurrent slices can lose an increment):
enrolled = reread + deferred, and reread - ok counts light reads that
also failed. A per-slice count would read zero on almost every poll.

## n082-waituntil-promise-resolve-client-from-job-board

Above: `waitUntil(Promise.resolve(client.from("job_board_board_state").upsert(`

A BOARD THAT DIED MUST LEAVE A ROW, or `state = 'error'` — half of
the ATS-migration signal the board-state ledger exists for — can
never appear in it: the write below this block is only reached by
boards that fetched. Boards rotate, so a plain gap in the series is
normal and cannot stand in for a failure.

ignoreDuplicates, NOT an overwrite: a board that succeeded earlier
today already has its real counts in today's row and a later
failure must not replace them with nulls. First observation of the
day wins; a later success still overwrites this one, because that
write is an ordinary upsert.

Counts are NULL, never 0 — the column comments say zero is a
measurement and null is the absence of one. One tiny fixed-size
write per failed board, behind waitUntil, nothing retained.

## n083-lapepoch

Above: `let lapEpoch = 0;`

── LAP BOOKKEEPING ──────────────────────────────────────────────
Runs for windowed boards that carry a cursor, which is the only set
that can complete a lap: workday, oracle, smartrecruiters, icims and
rippling. UKG, ADP, JazzHR and USAJobs report `windowed` with no
offset to resume from, so they have no lap, prove nothing, and are
counted as uncovered rather than silently treated as covered.

`lapEpoch` is what the rows of THIS visit get stamped with, and 0
means "no stamping, no proof" — the pre-lap behaviour, byte for byte.
`lapProven` is true only on the visit that closes a fully-covered,
fully-instrumented lap, which is the one visit allowed to conclude a
posting is gone.

## n084-lapopens

Above: `const lapOpens = cursorBefore === 0 && typeof r.nextOffset === "number" && r.nextOffset > 0;`

A BOARD THAT STARTS AND ENDS A VISIT AT OFFSET 0 WAS READ WHOLE.
`windowed` is `feedTotal > all.length`, so a tenant that advertises
140 and serves 137 reports windowed with nextOffset 0 — common on
Workday (the file's own Caterpillar note: 503 served against 942
advertised). Under the plain `cursorBefore === 0` open, such a board
opened a FRESH lap on every single visit, which can never satisfy the
wrap's `cursorBefore > 0` and therefore proves nothing ever — while
re-stamping its whole row set on the hottest table in the system
every visit and growing a permanent `__laps` entry the 45-day prune
never reaches (its `t` is refreshed each visit). All cost, no
evidence. A lap may only open on a visit that leaves work to resume.

## n085-rec

Above: `rec = {`

A LAP OPENS. Everything served from here to the wrap carries this
epoch, so an id that reaches the wrap without it was served in no
window at all. Opening only at offset 0 is what makes the first
lap after a deploy honest: a board caught mid-pass has no epoch,
proves nothing, and cannot stamp rows out of the serving fence.

`t0` pins the advertised total HERE, at the open, so the wrap
cannot be certified by a total that moved with it.

## n086-totalnow

Above: `const totalNow = Math.max(0, Math.trunc(r.feedTotal ?? 0));`

── THE WRAP, AND WHAT IT IS ALLOWED TO CONCLUDE ──────────────

(1) It must be a wrap of a lap that opened here: nextOffset back
    to 0 from a non-zero cursor, with no failed epoch write.

(2) THE FEED MUST HAVE ACTUALLY RUN OUT. Every paginated fetcher
    wraps on `exhausted || advanced >= feedTotal`, and the second
    disjunct is not an observation about the employer's feed — it
    is an observation about feedTotal, the very number a coverage
    ratio would then check itself against. A tenant that
    understates its total (this file's own note: "several tenants
    report exactly 2000, which is Workday's own reporting cap
    rather than a count") wraps there with full pages while the
    feed keeps serving, so every stored row past that offset is
    unreachable, unstamped, and — without this term — a logged
    takedown on a live role. `feedEnded` is set only by a short or
    empty page: the feed telling us it ended. It is also what
    keeps rippling honest, whose feedTotal is our own arithmetic.

(3) THE TOTAL MAY NOT HAVE COLLAPSED UNDER US. Pinned at open in
    `t0`; if the tenant now advertises less than
    LAP_COVERAGE_MIN of it, we finished walking a different feed
    from the one we started. Fails closed for one lap; the next
    lap opens against the new total and proves normally.

(4) THE TAIL MUST NOT BE UNFETCHED TERRITORY. `s` is an OFFSET,
    so a shortfall against the advertised end is not churn — it
    is offsets never requested. The tolerance is absolute and
    small (LAP_TAIL_SLACK), never the 10% a ratio would allow on
    a 16,000-posting board, because a single transient short page
    inside that band would certify a lap whose last 1,500 offsets
    were never asked for and then close every one of them.

A board that states no total can never satisfy (3)/(4) and stays
suppressed, which is the correct answer rather than a guess.

## n087-s-source-workday-r-jobs-length

Above: `if (s.source === "workday" && r.jobs.length > 0) {`

ONE REQUISITION, ONE POSTING — ACROSS A TENANT'S CAREER SITES.

A Workday tenant runs several sites (external, subsidiary, campus,
per-language) and the same requisition appears on more than one, with
Workday's own "-1"/"-2" discriminator making the ids differ so nothing
upstream dedupes them. Measured 2026-08-23: 8,993 requisition groups
spanned sites, 9,246 redundant postings, 99.9% with byte-identical
titles — up to 54% of a single employer's board was the same jobs
twice (Boeing JR2025489859 on two sites; one Allegion requisition on
five language sites).

THE DISCRIMINATOR IS THE CHEAP TELL: the duplicate copy carries the
suffix, the original does not. So the check is one small query over
only THIS board's suffixed ids — never a tenant-wide scan on the hot
path — asking whether the unsuffixed requisition already exists
anywhere in the tenant. The stem must keep >=3 digits before the
suffix is treated as a discriminator: a naive strip turns
Brighthorizons' JR-134112 into "JR" and over-merges 60k rows.

## n088-suffixedids

Above: `const suffixedIds = r.jobs`

ONLY ROWS WE HAVE NEVER STORED MAY BE SKIPPED. Filtering a row
that is already in the table would make it feed-absent to the
prune, which two-passes it into missing_since AND WRITES A
CLOSURE EVENT — 9,246 fictional takedowns into the one log
this board treats as its uncopyable asset. Stored duplicates
are removed by the one-off migration instead, which deletes
without touching the closure machinery.

## n089-await-enroldynamiclight-client-s-token

Above: `if (!await enrolDynamicLight(client, s.token, `content payload ${(contentChars / 1e6).toFixed(1)}MB >= threshold`)) desc`

Through the one door: enrolDynamicLight owns the set and the meta
row, and the set owns the token test. This branch used to write
both by hand, which is how a rule stated at the byte bound never
reached the site that actually enrols most boards.

A GREENHOUSE BOARD CAN BE REFUSED HERE, and what that costs is
stated rather than discovered: eleven greenhouse tokens are also
carried by a vendor with no light form (`echo`, `dispatch`,
`vmax`, `pulse`, `tdg`, `cabrillohospice`, `pdq`, `excel`,
`playonsports`, `ism`, `mercari`), and since isLight is keyed by
token, enrolling one would flip that twin to a light form its own
vendor has no filler for. So the giant takes the deferral: the
parse is skipped, its NEW rows store no description, and — unlike
the light path — backfill-desc will not reach it, because that
lane selects light boards. It is the smaller loss (one board's new
descriptions against two boards' entire description columns), it
affects only a board that is BOTH oversize AND on a colliding
token, and the way out is to make light mode keyed by
(source, token) rather than to relax this test.

## n090-await-enroldynamiclight-client-s-token

Above: `if (!await enrolDynamicLight(client, s.token, `workable payload ${(contentChars / 1e6).toFixed(1)}MB >= threshold`)) des`

THIS IS THE SITE THE GUARD ABOVE WAS WRITTEN FOR AND NEVER
REACHED. workable is not light-capable, so the set refuses it and
this returns false.

WHAT THAT ACTUALLY BUYS, stated exactly, because the deferral is
NOT one pass long. The threshold measures the board's own
steady-state payload, so a board that reaches this branch reaches
it on every pass: the bulk parse is skipped every time and every
NEW row inserts with no description, for as long as the board
stays oversize. What the refusal preserves is (a) the listUrl
stays details=true, so the text is still on the wire and still
recoverable, and (b) `lightDescs` omits the column rather than
nulling it, so text we already hold survives. The text is put
back by the desc-sweep BOARD lane (workable is in
BOARD_DESC_SOURCES), which re-fetches the board through the same
details=true url — a different lane on a different cadence, and
the lane the maintenance-ladder fix below exists to un-starve.
That is why fix B is worth nothing without fix C.

## n091-schedulewordsbyid

Above: `const scheduleWordsById = new Map<string, string>();`

THE VENDOR'S SCHEDULE WORDS, BESIDE THE ROWS AND NOT IN THEM. The
part-time guard reads words and our stored enum is not in its
vocabulary, so the salary parse needs the vendor's own phrasing — and
both the insert parse and the CORRECTION re-parse below have to get
the same value or a corrected row disagrees with a new one about the
same pay text. It cannot ride the row object: every key of that
object is sent to PostgREST as a column.

## n092-p

Above: `const p = parseSalaryStructured(salaryText, j.country ?? detectCountry(j.location), { title: j.title ?? null, descriptio`

employmentTypeText is the VENDOR'S OWN WORDS, and it is here
because the part-time guard could not be reached from anything
else this row carries. detectPartTime refuses the full-time-load
annualisation of an hourly, daily or weekly rate, and its
vocabulary is the phrasing a posting uses — "part-time",
"full-or-part-time". Our own normalised enum spells that state
with an underscore, which matches none of those forms, so
passing the enum would have read as wired and done nothing.
Only a vendor that states a schedule beside a pay figure sets
the field (Personio today), so no other vendor's numbers move;
for Personio it is the difference between publishing a
part-time hourly wage as an annual salary and refusing to.

## n093-lapcolunknown

Above: `let lapColUnknown = false;`

lap_epoch rides the SELECT unconditionally, as a LITERAL column list
like every other read here. It was briefly conditional on whether the
board had a lap open, but a template literal over two possible column
lists makes the PostgREST select overload resolve both shapes and the
union exceeds the compiler's budget (TS2590) — so the honest form is
the fixed one. The cost is one nullable integer per already-stored row
on boards that will never use it: bounded by the board's stored size,
on an array already carrying title, location, salary and first_seen,
and released with the board's scope.

ANY read that came back without the column sets this, including the
three fallbacks below, whose narrower column lists do not carry it.
The flag then blocks stamping AND proving for the visit, so a board
degrades to today's behaviour instead of reading `undefined` as
"not seen this lap" and closing a live posting.

## n094-res

Above: `let res = await client`

region_code rides the SELECT (.61) so the corrections path can tell
"already stamped" from "never stamped". It costs a ≤6-char string
per already-stored row of THIS board — the array is bounded by the
board's stored size, not by postings fetched, and it is the same
array that already carries title/location/salary. Without it, prev
reads undefined on every visit and the patch re-fires forever: the
write-amplification hole employment_type fell into below.

## n095-agency-r-agency-null-employment-type-r-emp

Above: `agency: r.agency ?? null, employment_type: r.employment_type ?? null,`

The prev value MUST ride along or every visited row of a tagged
board reads prev undefined, the patch fires on every visit, and
the corrections wave never converges — the write-amplification
incident. employment_type had fallen into exactly that hole:
the SELECT above carried it (and a test pins that) but this
mapping dropped it, so put() compared every typed row against
undefined and re-patched it each rotation visit. The select is
only half the chain; the mapping is the half nothing pinned.

## n096-servedthisvisit

Above: `const servedThisVisit = rowsById.size;`

── ORACLE SUB-SITE DEDUPE: one stored row per tenant requisition ──

An Oracle tenant lists the same requisition on several career sites
and each site is its own token here, so a French mirror or an
audience view used to store a full second copy of every row (the
rule, its live measurement and the pure planner live in
normalize.ts). This visit asks the database who holds each
requisition this site served or stores, by req_key, and then:
  - a requisition a BETTER-ranked sibling holds is not stored by this
    site, and a stale copy this site already holds is shed;
  - a requisition this site owns has its LOWER-ranked siblings'
    copies shed (only for requisitions this visit actually served).
Both sheds are OUR action, never the employer's: they go to the exit
ledger under the untracked reason, exactly like a board leaving the
catalog, and they are removed from this visit's stored set BEFORE
the absence logic below so a shed row can never be stamped, closed,
or written to the closure log. A sub-site-only requisition has no
better-ranked holder and is kept: nothing here can lose it.

Single-site tenants are not ranked and skip this block entirely.
The lookup is bounded by this visit's own rows (100 keys per query,
paged), and a plan is only ever made about requisitions the visit
fetched or this site stores, so a partial read decides nothing about
the rest.

What the site SERVED, before the dedupe leaves any of it to a
sibling: the board-state row below reads its state from this, so a
mirror whose every requisition is stored under its canonical site
is recorded as a board that answered ('ok', stored_count 0), never
as one that served nothing ('empty' beside a feed_total of 703).

## n097-holder-keys-per-query

Above: `const HOLDER_KEYS_PER_QUERY = 100;`

PAGINATED, like the existing-rows read above: PostgREST caps a
response at 1,000 rows and says nothing. A key can have as many
holders as the tenant has sites (Cummins 10, eexs 109), so 100
keys is not 100 rows; every chunk pages by id until a short page,
and a chunk that cannot be completed skips the plan rather than
deciding from the holders it happened to see. missing_since rides
the select because a stamped holder does not own a requisition.

## n098-windowedread

Above: `const windowedRead = r.windowed === true;`

A windowed read (the freshness cursor, a page cap, a resumed read)
cannot conclude that a stored requisition is no longer served here.
A FULL READ IS THE COMPLEMENT OF THE ONE FLAG, DERIVED THE ONE WAY.
Every reader of `windowed` spells it `X.windowed === true` — the
window guard (a-window-of-ours-is-not-a-closure-of-theirs) pins
that so three derivations cannot drift into three meanings. The
planner's parameter is the complement, so it is the complement
OF that expression, never a second spelling like `!== true`.

## n099-newrows-length-0

Above: `if (newRows.length > 0) {`

AN AGED-OUT POSTING MUST NOT WALK BACK IN. "Already stored" was the
only thing suppressing an insert, so a row the freshness sweep had
just deleted came straight back on the next rotation — and for the
vendors whose list payload carries no date (bamboohr, rippling)
ingest cannot tell it is stale, because isDatedBefore only drops a
date it KNOWS. Measured 2026-08-24: ~20,600 rows in that loop, a
2014 posting among them with a first_seen of that morning, and an
exit ledgered on every lap.

An ATS posting id and its posting date are both stable, so the
tombstone answers this without re-deriving anything. (2026-10-03: the
date is NOT stable on Ashby, which re-dates under the same id; see
n412-redated-past-tombstone for the re-entry rule.) Best-effort by
design: if the table is missing (function deployed ahead of its
migration) or the read fails, ingest proceeds exactly as before
rather than dropping a board's whole intake.

## n100-grace-ms

Above: `const GRACE_MS = 5 * 60 * 1000;`

── Two-pass closure confirmation ────────────────────────────────────
A posting absent from ONE successful fetch is stamped, not closed: a
feed that transiently returns a partial list (HTTP 200, half the
jobs) must not mass-log false closures or reset first_seen through
delete+reinsert churn. Absent again after the grace window → real.
 - reappeared rows get their stamp cleared (flicker fully absorbed);
 - EXCEPT rows already past the freshness cap: those delete
   immediately, unlogged, exactly as before (and the list query
   filters by date anyway, so a stamped row never serves stale).
 - shrink ratchet: when a board loses >60% of stored postings in one
   pass, closures need a 6h-old stamp — a partial feed outage heals
   invisibly; a genuine mass takedown still closes, just later.

## n101-lapmark-0-faillap

Above: `if (lapMark === 0) failLap();`

A VISIT THAT COULD NOT STAMP MUST NOT LEAVE THE LAP ARMED.

lapMark 0 suppresses stamping and proving FOR THIS VISIT — which is
the whole of what the flags above claimed — but the lap bookkeeping
ran before the SELECT and has already credited this window's offsets
to `rec.s`. So the lap goes on believing it covered ground it never
stamped, and the wrap converts every row served in those visits into
a `missing_since` stamp: out of the serving fence (buildQuery, every
published statistic, the detail page) for up to a full lap, and into
real closures if the next lap is holed too.

This is not a rare path. It is GUARANTEED on the deploy that ships
the lap columns, because the function deploys before the migration
applies and this file already carries three deploy-window fallbacks
for exactly that ordering; every board mid-lap when the column
appears would mass-stamp the rows it served before it. The two
transient fallbacks (region_code, agency) reach it outside any deploy
window at all.

failLap is the contract that already exists for "this lap has a hole
in its instrumentation": forfeit the lap, re-lap cleanly, prove one
pass later. One line, no write, no round trip.

## n102-lapbackfilluntil

Above: `const lapBackfillUntil = lapMode ? (deepLaps[lapKey]?.w0 ?? startIso) : "";`

THE FIRST PROVEN LAP CARRIES A BACKLOG, AND ITS closed_at IS A LIE.
Read BEFORE the receipt below writes w0, so the lap that establishes
observability is itself inside the backfill window. Any row whose
missing_since predates the board's first proven lap was absent for an
unknown part of the preceding 30 days — the page cap made it
unobservable — so its closed_at of now() overstates its life by up to
a month. Those rows are logged under their own absence_basis so a
duration statistic can drop them by name.

## n103-for-const-id-of-vanishedall

Above: `for (const id of vanishedAll) {`

WHAT THIS PASS CAN ACTUALLY SPEAK TO, excluding the freshness cap
(an age-out is our rule, produces no closure, and routes to the
exit ledger). On a board read in full this is vanishedAll minus
age-outs — the number that has always driven these guards. On a
windowed board it is the LAP's absence, not the visit's: the visit
is "missing" ~everything outside its 250-row window, and feeding
that to a shrink ratchet or a share threshold produces a verdict
about our page cap rather than about the employer.

## n104-vanished

Above: `vanished = [];`

A PARTIAL READ CANNOT PROVE ABSENCE.

`windowed` means the vendor advertises more postings than our page
cap let us fetch, so every id past the window is "missing" from
this pass for a reason that has nothing to do with the employer.
Closure LOGGING was already suppressed for exactly this (see
truncatedFetch below, and the 2026-07-21 finding that 7 of 8 sampled
"closures" on a windowed board were still live) — but the DELETE was
not: the `else if (vanished.length)` branch culls them anyway, just
silently. With GRACE_MS at five minutes that is close to immediate.

Measured 2026-08-25 on the four largest at-cap Workday boards: we
hold 2,404 of 41,221 live postings, 6%. CVS Health serves 19,265 and
we store 678. A board can only reach 500-a-pass and then lose the
overflow, which is why they all sit just above the cap.

Age-outs still go, because those are OUR freshness rule and we can
prove the date. Everything else on a windowed board waits for the
30-day cap. The cost is that a genuinely closed role on a big board
can linger; the alternative is serving 6% of the employer's jobs.

...AND A COMPLETED LAP CAN. The suppression above is not lifted, it
is given a second kind of evidence. Within a visit nothing changes:
an id we did not see may be at offset 9,000 and is skipped exactly
as before. At a WRAP — a pass that opened at offset 0 under this
code, covered LAP_COVERAGE_MIN of the employer's own advertised
total, and stamped every row it served without a single failed
write — an id that never received the epoch was absent from EVERY
window of the whole feed. That is absence, not displacement, and it
is the only thing on this path that promotes a windowed board's
vanished id past this line.

It then re-enters the SAME two-pass grace as everything else, where
one "pass" is one lap: the first proven wrap stamps, the second
closes. A posting skipped because a takedown above the cursor
shifted the feed under us would have to be skipped in two
consecutive laps, at independent positions, to be logged.

## n105-tounstamp-liveids-filter-id

Above: `toUnstamp = [...liveIds].filter((id) => {`

SEEN THIS VISIT — one write, two meanings, no new round trip.

This list was "served rows carrying a stale missing_since", cleared
so a flicker heals. It now also carries "served rows not yet marked
for this lap", and the update sets both columns at once. A posting
is therefore written at most ONCE PER LAP (the cursor passes each
offset once), not once per visit: across the whole windowed
population that is roughly 179,000 rows per lap, ~5k row-writes an
hour at the measured lap length — three orders below the 450k/hour
that bloated this table when every row was rewritten every pass.

## n106-corrections

Above: `const corrections: Array<Record<string, unknown>> = [];`

UNFREEZE. Until now a row was written once and never corrected:
`newRows` filters to ids we do not already hold, so a title the
employer edited, a location they fixed, or an apply_url they moved
kept our first-ever value forever. Measured 2026-07-29 against live
vendor payloads: 1.16% of titles and 0.57% of locations disagree —
~6,800 and ~3,350 rows at current size. The larger cost was
structural: every normaliser improvement only ever reached rows
inserted after it shipped, which is the same insert-only behaviour
that left 70k Workday rows undated.

THE SAFETY RULE, and the reason this is narrow: an ingest-time NULL
must never overwrite an enriched value. posted_at belongs to the
dating sweep, category to the categoriser, description and
experience_band to the description fills — none of them appear here
at all. work_mode, remote and salary DO appear, but only when the
vendor states a value this pass; when the vendor is silent we keep
whatever enrichment already found. Overwriting with null would have
undone the sweep that took two weeks to get running.

## n107-derived-not-employer-edits

Above: `const DERIVED_NOT_EMPLOYER_EDITS = new Set(["region_code"]);`

THE EDIT HISTORY WE WERE COMPUTING AND THEN DELETING.

This block already knows, per field, that the employer's live value
moved: it compares next against cur and writes next. The old value
was then overwritten and gone — no history table existed anywhere in
the repo. Every rotation we watched employers reprice live
requisitions and flip live reqs remote->hybrid, and recorded none of
it. Nobody else holds this: it is only visible to something that had
the previous value in hand at the moment the new one arrived.

observed_at below is OUR OBSERVATION TIME — the moment this pass saw
the two values differ. It is NOT when the employer made the edit
(we cannot know that; it happened somewhere between this fetch and
the previous one) and it is NOT a posting age.

MEMORY: capped hard. `corrections` is already capped per board visit,
and this array is capped independently below, so neither grows with
postings fetched — a churny board logs its first N changes and the
remainder ride the next rotation visit, exactly like corrections.

"RIDE THE NEXT ROTATION" IS ONLY TRUE IF THE PATCH RIDES WITH IT.
A correction re-fires next visit because it did NOT land: prev still
differs from next. A change note does not — once the patch lands,
prev equals next and the diff is never computed again. So a log cut
that is not matched by a patch cut does not defer the history, it
destroys it, and it does so on exactly the bulk repricing and
re-titling events this table exists to record. FIELD_CHANGES_PER_VISIT
(500) is well below CORRECTIONS_PER_VISIT (1,000) and a single
posting can note up to eight fields, so the log fills FIRST on any
churny board. Both cuts below are therefore made at a POSTING
BOUNDARY: whichever cap is reached first truncates the other array to
the same posting, so a dropped note always means a deferred patch.

WHAT IS DELIBERATELY NOT LOGGED: region_code. It is OUR derivation
from the location string, not a value an employer typed, so a change
in it is a change in our own parser and belongs in a deploy note, not
in a table whose entire claim is "the employer edited this". It is
also the one field a stalled backfill would re-queue on every
rotation, which would bury the real edits under our own noise.

## n108-vendor-field-first-read

Above: `const VENDOR_FIELD_FIRST_READ = new Set(["personio:salary"]);`

AND WHAT IS NOT LOGGED ONCE, FOR ONE ROLLOUT: the FIRST value a vendor
field ever hands us.

`statesTheSameMoney` below stops our own reformatting of the same money
being recorded as a pay edit, and that catches 16 Personio rows. The far
larger case in the same rollout is null -> a figure: ~700 served Personio
rows hold no pay text today (21 of 4,252 state any) and gain the
employer's own range the first time their board rotates through refresh.
Every one of those is a real change to the ROW and not one of them is an
employer editing their posting — they are all us starting to read an
element that has been in the feed the whole time. Logged as edits, that
is ~700 fictions in job_board_field_changes, 44x the number the
reformatting predicate was built to prevent, in the one table here whose
contents cannot be re-derived.

ONE SHOT, AND IT HAS TO BE DELETED. The entry below is scoped to the
source and the field, and it suppresses ONLY the null -> value note; a
later change to a figure already read logs exactly as before, which is
what keeps this from being a permanent hole. It covers the rotation that
follows this deploy (Personio boards are small and numerous — 1,373
tokens — so one full rotation is the horizon) and the next bundle that
touches this file should remove it. A real employer adding a range after
that rotation must be logged, so leaving this in place indefinitely
trades a burst of fiction for a permanent blind spot.

## n109-changecapat

Above: `let changeCapAt = -1;`

How many corrections were queued when the change log filled, and how
long the log was when that POSTING started. Read as a posting
boundary: everything after it is a patch we must NOT send this visit
(or its history is lost for good) and a note we must NOT keep (or it
claims an edit whose patch we deliberately held back). The pair
matters because the cap can trip mid-posting — title noted at 499,
salary dropped at 500 — and keeping that half would be the exact
"logged an edit that never landed" defect in miniature.

## n110-regioncolunknown

Above: `if (!regionColUnknown) {`

The jurisdiction moves with the location, so it is corrected in the
same breath — and this is also how the ~989k rows already stored
acquire one, over a rotation, like every other correction wave.

GUARDED ON THE COLUMN EXISTING, exactly as agency is below. In the
window where this function is deployed ahead of its migration the
board read falls back to a column list without region_code, so
prev.region_code reads null for EVERY row, the patch fires on every
row of every board, and the RPC executes one no-op UPDATE per row
against a 12-index table on every rotation, forever. That is the
employment_type write-amplification incident verbatim: cold slices
23s -> 99s, the facets cron 8 ticks behind.

## n111-nextregion-null-prev-region-code

Above: `if (nextRegion === null && prev.region_code != null && (patch.location !== undefined || patch.country !== undefined)) {`

AND IT MUST BE CLEARABLE. Unlike country, whose null means "the
vendor said nothing", region_code is OUR derivation from the
location string we just re-read — so a null after that string
moved is knowledge, not silence. Without this a posting that
moves from "Austin, TX" to "London, United Kingdom" stores
country=GB with region_code=US-TX, and item 3 copies that
contradiction into closures and exits when the role ends.

## n112-nextpay

Above: `const nextPay = (row.salary ?? null) as string | null;`

A REFORMATTING IS NOT A PAY CHANGE, AND THE CHANGE LOG IS NOT OURS
TO WRITE FICTION INTO.

The log beside this patch is a record of what the EMPLOYER changed,
and it is the one asset here that cannot be re-derived. This line
will happily write into it whenever OUR reading of the same pay
changes shape — which is exactly what happens the first time a
vendor arm starts reading a structured compensation field that the
description miner had been covering in prose. Measured on Personio,
2026-09-27: of 26 served rows that already state pay, 16 carry the
newly-read vendor block, and all 16 texts differ while naming the
SAME money ("€63,000–€95,000" mined from the body against the
vendor's own 63,000 to 95,000 per year). Logged as-is, that is 16
employers recorded as having changed their pay on a day none of them
did.

The patch itself is still worth making — the vendor states the PERIOD
the prose never did, so salary_period moves from null to the
employer's own answer through the re-parse below. What is refused is
the note: when the floor, the ceiling and the currency all agree, the
employer changed nothing and the log must stay silent. A real pay
change moves one of those three and is logged exactly as before.

The two parses cost nothing on a steady-state board: they run only
where the text ALREADY differs, which is the same handful of rows
this block was about to patch and log anyway.

## n113-patch-salary-undefined

Above: `if (patch.salary !== undefined) {`

RE-PARSE WHEN THE PAY TEXT MOVES. A LIVE CORRECTNESS BUG, not just
a logging concern: this path patched the `salary` TEXT and left
salary_min_annual / salary_max_annual / salary_period /
salary_currency frozen at whatever the FIRST-EVER text parsed to.
A corrected row therefore served, filtered and benchmarked on a
stale number. The re-sweep is not a substitute for fixing it here:
it runs only when SALARY_PARSE_VERSION moves, so between bumps a
corrected row keeps the stale columns indefinitely — and it reads
the ROW, so it cannot see the vendor context this path has (see
sweepRefusesAnnual). An earlier version of this comment said the
sweep targets salary_currency IS NULL and therefore could not see a
row with a currency and a wrong amount; that stopped being true at
v4, and the constant's own note now states the real predicate.

It also poisons the change log this block just started writing: a
logged salary change would be a comparison against a baseline the
structured columns never agreed with.

The parse is pure CPU over a ≤200-char string on rows that are
ALREADY being patched (steady state: a handful per board), and the
four values ride the patch object that was going to be sent anyway
— no new array, no extra round trip.

## n114-title-row-title-as-string-null-null-d

Above: `{ title: (row.title as string | null) ?? null, description: lightDescs ? null : (descs.get(id) ?? null), employmentType:`

THE SAME CONTEXT THE INGEST PARSE GETS, or the two disagree
about the same pay text. description is what detectPartTime
reads: without it an hourly rate on a posting whose prose says
"part-time, 20 hours per week" loses the load-dependent guard
and is annualized as a full-time salary — the number the ingest
path deliberately refuses to write (the 2026-08-25 $44/hr
incident). Same expression as the ingest site, light boards
included, so a corrected row parses exactly as a new one would.
employmentTypeText too, from the same map the insert parse reads,
or this path annualises a part-time hourly wage that the insert
path refuses to — and this is the path that fills the rows we
ALREADY hold, so it carries most of the vendor-pay gain.

## n115-nextmode

Above: `const nextMode = (row as Record<string, unknown>).work_mode ?? null;`

AND THE TRINARY MOVES WITH IT. `put("work_mode", …)` above is
stated-only (it refuses a null so vendor silence cannot erase
enrichment), but work_mode and remote are not two facts — every
normalizer computes `remote: workMode === "remote"` from the one
trinary. So a null here is not silence: it is the re-normalised
answer for THIS visit, and refusing it strands the pair in
disagreement.

THE ROW THAT PROVES IT, and it is the whole population the
negated-remote fix is for: an iCIMS row with location_type
"Non-Remote" and title "Staff Nurse" is stored today as
work_mode='remote', remote=true. The fixed bundle re-normalises
it to (null, false); without this line the diff loop writes ONLY
remote=false and work_mode stays 'remote'. filters.ts lets an
explicit workMode beat the boolean, so the row would still be
served under {"workMode":"remote"} while its own boolean says it
is not — the badge-vs-filter disagreement the normalizer change
removes at write time, reintroduced by the writer. The repair
migration does not reach it either: it reads title+location,
which carry no negated phrase here.

Gated on the boolean having MOVED, so this is not a new write on
every row of every rotation (the employment_type
write-amplification incident); and on the same
vendor-authoritative reasoning as region_code above, which is
this file's existing precedent for a derived field that must be
clearable.

## n116-changecapat-0

Above: `if (changeCapAt >= 0) {`

ONE ROUND TRIP PER CHUNK, not per row. This loop used to issue a
sequentially-awaited UPDATE for every corrected posting — the only
unbatched write in an otherwise consistently 200-250-batched ingest,
and hundreds of serial round trips per pass on a churny giant. That
time comes straight out of the freshness budget that decides how
fast the whole catalog rotates.

The patches are PARTIAL and differ per row, so this cannot be a bulk
PostgREST update: apply_posting_corrections tests key PRESENCE per
column and leaves anything the patch did not mention untouched. A
plain bulk update would null out an employer's real salary because a
different row's title moved.
CAPPED PER BOARD-VISIT, because a backfill wave is a denial of
service against your own database. When a new patched field ships
(employment_type, 2026-08-29), every typed row of every visited
board queues a correction in the same slice — and each row UPDATE
touches every index on a 12-index table. Measured live: cold slices
23s -> 99s, the facets cron 8 ticks behind, the heartbeat itself at
32-57s while the wave saturated writes. The cap bounds one slice's
write bill; rows beyond it are NOT lost — the same board's next
rotation visit patches the remainder, so the wave completes over
~a rotation instead of all at once. Steady-state (a handful of
genuine vendor edits per board) never hits the cap.
The log filled before the patch cap did: hold the untold patches
back to the next rotation visit, where they will be logged and
applied together. Steady state never reaches this.

## n117-appliedthrough

Above: `let appliedThrough = corrections.length;`

WHICH patches landed? The history below asserts "the stored value
moved from A to B", which is only true of a patch whose batch
succeeded. Logging a failed one records an edit that never reached
the posting — and records it AGAIN on every later rotation, because
prev still differs from next, so one stuck board manufactures an
unbounded repeat history nothing in the table can tell apart from a
real re-edit. Conservative and prefix-shaped: the index of the first
correction NOT known to have been applied, which only ever moves
DOWN, so a later chunk that happens to succeed after an earlier
failure drops its notes rather than claiming a gap it cannot prove.

## n118-appliedthrough-corrections-length

Above: `if (appliedThrough < corrections.length) {`

THE HISTORY, WRITTEN AFTER THE PATCHES LANDED — AND ONLY IF THEY DID.

Deliberately after: an entry claims "the stored value moved from A to
B", and the patch loop above is where that becomes true. Ordering it
first would log edits that a failed batch never applied — and so
would running it unconditionally after a batch that errored and
broke out, which is why appliedThrough trims it first. Dropping the
notes of a failed patch is the correct trade: the same diff
recomputes on the next visit, when it will be true.

ONE INSERT PER CHUNK, never one per row, and behind waitUntil with
the .then().catch() idiom — a best-effort collection write must never
be able to fail the ingest pass. The array is capped at
FIELD_CHANGES_PER_VISIT and released with the board's scope, so it
does not scale with postings fetched.

## n119-lapmark-0-for-const-nr-of-newrows

Above: `if (lapMark > 0) for (const nr of newRows) (nr as Record<string, unknown>).lap_epoch = lapMark;`

A ROW BORN MID-LAP HAS BEEN SEEN THIS LAP.

Without this it would insert with a NULL epoch, and the wrap a few
thousand postings later would read that NULL as "absent from every
window" — stamping a posting we ingested hours ago out of the serving
fence. The value is written here rather than in the row builder
because only the SELECT above can tell us the column exists: lapMark
is zero whenever the read did not carry it, so the deploy window
needs no strip retry of its own. One property write per NEW row (not
per posting fetched), on objects that already exist.

## n120-truncatedfetch

Above: `const truncatedFetch = r.windowed === true;`

Log closures BEFORE deleting: the live table hard-deletes, so this is
the only record these roles were ever open — it powers per-company
hiring-health. Best-effort per chunk: the prune (and board freshness)
must never be blocked by the history write, so a failed log still deletes.

Accuracy guards — a "closure" must mean the company took the role down:
 (a) truncated fetches log NOTHING: an SR board at the SR_CAP ceiling, or
     a Workday tenant whose feed total exceeds the page cap (windowed),
     has postings displaced past the cap "vanish" while still live —
     proven live 2026-07-21: 7/8 sampled "closures" on a windowed board
     were still open on the company's own site;
 (b) age-outs are skipped: a posting crossing the 30-day freshness window
     is dropped at ingest and lands in `vanished` — we removed it, nobody
     filled it;
 (c) a closure whose exact title is still live at the same company is
     marked superseded (repost/relisting churn, not a fill) and excluded
     from hiring-health stats;
 (d) a pass in which an implausible share of the board went absent AND
     the feed itself came back short is stamped suspect with the counts
     that decided it — logged either way, and excluded by the readers
     rather than by never being written. Both conditions are required:
     a share alone cannot tell a dark feed from an employer filling a
     hiring class or an ATS rotating requisition ids, and a wrong mark
     deletes the cohort from the estimator instead of censoring it.
`r.windowed` alone now — the SmartRecruiters row-count proxy is gone.

It read `rowsById.size >= SR_CAP`, which cannot tell a board holding
exactly the cap from one holding twelve times it, so a company with
precisely SR_CAP live postings would have had closure logging
suppressed forever. The closure log is the one asset here that cannot
be re-derived later, so quietly never writing it for a board is a
real cost, not a safe default.

The replacement is strictly better informed: `windowed` is computed
from the vendor's OWN advertised total against what we actually
fetched (feedTotal > content.length), for SmartRecruiters exactly as
for Workday and Oracle. A partial fetch — cap hit, or a mid-loop page
failure — still reports windowed and still suppresses closures.

## n121-batchsuspect

Above: `const batchSuspect = shareImplausible && feedCameBackShort;`

THE ONE RESIDUAL, NAMED RATHER THAN GUESSED AT.

A vendor that understates its total AND refuses to serve past it ends
the feed honestly at an offset the lap cannot see beyond, so a stored
row that has drifted past it is absent from every window while being
live. NOTHING ON THIS PATH CAN SEPARATE THAT FROM A TAKEDOWN, and a
guard was tried and rejected rather than shipped: any coverage floor
measured against what we HOLD refuses every board carrying
accumulated dead stock too, and dead stock is exactly the 30-day
backlog this mechanism exists to drain — such a floor would make the
fix a silent no-op on CVS-class boards while reporting coverage. The
same argument kills it as a suspect MARK: `removableBefore - lapSeen`
IS the absence being reported, so the mark would fire on every
closure batch and mean nothing.

What narrows it to almost nothing is the chunked walk. Pages are
requested four at a time and consumed in order, so a walk that stops
"at the advertised total" has usually already REQUESTED offsets past
it; a tenant that serves them returns full pages, `exhausted` stays
false, and the proof gate above refuses the lap outright. The residual
is only the tenant that refuses to serve past its own understated
total — a board no client can read whole by any means — and it is
disclosed as such by get_closure_population() rather than papered over
here.

## n122-logres

Above: `let logRes = await client`

WIDENED, NOT ADDED (.61). This select already ran before the
delete below; carrying eleven more columns off the same row
read costs one wider row and no extra query. It is the last
instant department, country, jurisdiction, work mode,
employment type, level and pay exist anywhere — the posting is
hard-deleted a few lines down — so without them no fill, churn
or ghost number can EVER be cut by pay, team, geography or
level for any period already elapsed.

## n123-isagedout

Above: `const isAgedOut = (r: Record<string, unknown>) => {`

(b) aged out, not closed — excluded from the CLOSURE log, but
recorded in the EXIT ledger: "still advertised at our 30-day
cap" is exactly the event the ghost-rate stat counts, and it
was previously deleted without any trace.
AN ID WE AGED OUT IS NEVER AN EMPLOYER TAKEDOWN, whatever the
stored row says. This filter read the STORED posted_at, which
is null for every posting whose vendor states its age only in
prose — so a row the ingest filter had just aged out failed
the test and fell through to the closure log as a real
takedown. agedOutIds is the ingest's own record of what it
dropped this pass and is therefore authoritative here.

## n124-agedexitrow

Above: `const agedExitRow = (r: Record<string, unknown>) => {`

This was the ONE clean site of the four: it used posted_at
alone and wrote null otherwise. It now says so explicitly
(origin_basis 'stated') and, where posted_at is null, writes
the discovered lower bound tagged as such instead of a null —
the same rule as the other three, so `WHERE origin_basis =
'stated'` selects exactly the population this site used to be
the only source of.

## n125-closurerows

Above: `const closureRows = rows.map((r) => ({`

supabase-js RETURNS errors (never throws) — check it, or a
failing insert silently loses lifecycle history (the same
blind spot that hid the verification-stamp failures).
(d) the batch's own alibi — see the feed-dark guard above.
Stamped on every row of the pass, suspect or not, so the
ratio is auditable after the fact and not just the verdict.
These are the numbers that DECIDED, which is why the
numerator is the pass's raw absence (absentInPass) and not
the smaller confirmed-and-written count: stamping the written
count would make the stored ratio disagree with the verdict on
any pass where the two-pass grace held some ids back. The
written count is recoverable by counting the rows of the batch
— (company_token, closed_at) is the batch key. Both counts
exclude ids the freshness cap aged out in this same pass, so
numerator and denominator span one population.

...and the row also carries WHAT KIND OF ROLE it was
(lifecycleFacets): the posting is hard-deleted a few lines
below, so this is the last instant its pay, team, geography
and level exist anywhere, and no fill or churn rate for an
elapsed period can ever be cut by them retroactively.

## n126-const-error-rawclerr-await-client-from-j

Above: `const { error: rawClErr } = await client.from("job_board_closures").insert(closureRows);`

Deploy-before-migration tolerance (the country-column rule),
over BOTH branches' new columns at once: naming a column the
migration has not created yet fails the WHOLE insert, and
losing a pass of closures to bookkeeping is a worse outcome
than losing the bookkeeping. settleInsertError strips only
what the database actually complains about, so a row is
degraded rather than deleted.

## n127-removedexitrow

Above: `const removedExitRow = (r: Record<string, unknown>) => {`

Exit ledger, 'removed' side: the same events, tagged, into the
table the ghost-rate stat will read once accrual clears its
floor. Best-effort — the closures row above is the record of
record; this must never make a prune fail.
Was `(posted_at ?? first_seen)` — a mixed clock with no flag.
This is the 'removed' path, which the hiring-health estimator
EXCLUDES from its censoring input, but it is the ghost/churn
numerator and had exactly the same defect.

## n128-

Above: `{`

THE EMPLOYER'S OWN ADVERTISED COUNT, KEPT INSTEAD OF OVERWRITTEN.

job_board_verifications is PRIMARY KEY (company_token), so the stamp
above REPLACES feed_total every visit and keeps zero history. That is
the most valuable number this function touches — it is ground truth
we did not derive, straight from the employer's own feed — and on a
windowed board it is the only meaningful one: CVS Health advertises
19,265 and we store 678, so our stored count measures our page cap,
not their hiring.

An append-only row per board per day gives three things nothing else
can: an employer-side hiring trend for boards whose stored count is
meaningless, an auditable coverage ratio to publish beside every
number we sell, and the ATS-migration signal (a feed that goes to
zero while another token's appears).

AT MOST ONE ROW PER BOARD PER DAY. The table's primary key is
(company_token, observed_on), and observed_on is derived from
observed_at by a BEFORE trigger — so this sends the REAL fetch time
and never has to keep a day column in step with it. A board fetched
five times today overwrites its own row four times; observed_at ends
up naming the last of those fetches, which is what it claims to be.

MEMORY: one upsert of one small object per SUCCESSFUL BOARD, behind
waitUntil so it adds no latency to the board loop and cannot fail the
pass. Nothing here scales with postings.

## n129-livecount

Above: `let liveCount = 0;`

Both counts come from values this pass already computed — no query.
live_count: what the site would SERVE for this board — the column
  claims the serving fence (missing_since IS NULL AND
  effective_posted >= now() - 30 days), so it applies it. `rows`
  alone is NOT that number: the ingest cannot age out an UNDATED
  posting (it only drops a date it knows), so a board whose vendor
  states no dates keeps serving rows in the feed whose
  effective_posted is first_seen — and once that is over 30 days
  old the site serves none of them. Counting `rows` there would
  publish a coverage ratio wrong in the direction that flatters us,
  on exactly the boards this table was added to measure.
  Pure CPU over an array already in hand; no query.
stored_count: what we HOLD, fenced or not — the rows we already had
  plus this pass's inserts minus this pass's prune.

## n130-feed-total-derived-feed-total-sources-has-s-sou

Above: `feed_total: DERIVED_FEED_TOTAL_SOURCES.has(s.source)`

What the EMPLOYER says they have, verbatim. null when the
vendor states no total — never coerced to our own count, which
would silently make every coverage ratio a constant 1.0.

AND NEVER THE NUMBER ZERO. Nine fetchers initialise feedTotal
to 0 and only overwrite it from page 0, and the fetchBoard tail
coerces a missing one with `?? 0` — so "the vendor stated no
total" and "the vendor stated zero" arrived here identical.
The column comment is explicit that NULL is the unstated case
and that zero is not it; a stored 0 would make the documented
feed-dark signal (feed_total = 0 while live_count > 0) fire on
thousands of healthy Workday and ADP boards and divide every
coverage ratio by zero. A board that genuinely advertises none
is already recorded by state = 'empty'/'dark'.

DERIVED TOTALS ARE NOT STATED TOTALS EITHER. Rippling's is
pageCount * 20 — our arithmetic, not the employer's number —
and the column's claim is "the only figure here we did not
derive". A 3-role Rippling tenant would otherwise publish 15%
coverage of a board we read completely, and crossing a page
boundary would read as the employer doubling their hiring.

## n131-state-r-windowed-true

Above: `state: r.windowed === true`

'truncated' is the table's word for what this file calls
windowed: the fetch was cut short, so both counts understate
and no closure may be inferred from this row.
'dark' is the vocabulary's word for a board that answered and
served nothing while we still hold rows for it — half of the
ATS-migration signal (a feed going to zero while another
token's appears). Without this it was indistinguishable from
an employer who genuinely advertises nothing.

## n132-slicebudgetnote-fetched-fetchedinslice-ski

Above: `sliceBudgetNote = { fetched: fetchedInSlice, skipped: budgetSkipped.length, hit: budgetSkipped.length > 0, lastUpsertErr`

Every board in this slice is now in. Say so BEFORE the tail — the cursor
write, the pass-end facets and the maintenance kicks all sit between here
and the terminal return, and a slice that dies among them has still done
the work the shedder is deciding about.
lastUpsertError rides the same note. 504 boards failed "(db-write)" on
2026-09-03 and nothing outside the function could say WHY: the message
lived in a local and reached only the pass-end detail string and the
console. Now it lands on the slice_stats row status already exposes.

## n133-failedacc

Above: `const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);`

Advance cursors — SAME rule as the optimistic write above, because it is
literally the same function (rotation.ts). This write lands last and wins,
so any divergence here is what production actually does: on 2026-07-25 this
site advanced by `slice.length` (base 80 + up to 25 bootstrap + 5 demand
boards, which come from elsewhere in the catalog and consume no cursor),
skipping 24% of the cold list every rotation and pushing measured P95
re-verification past the published claim while the median looked healthy.
A CAP IS NOT A COUNT. This kept the last 120 entries, and every consumer
— the list response, status, and a whole day of my own analysis — read
that 120 as "the number of boards failing". It is the ceiling. The real
figure was never published, so a pass failing 120 boards and one failing
3,000 were indistinguishable, and the class breakdown computed from the
retained window is a sample of the pass's TAIL, not of the population.

The array stays bounded (it lives in a meta row), but the count travels
with it now.

## n134-const-data-prevrot-error-prevroterr-awa

Above: `const { data: prevRot, error: prevRotErr } = await client.from("job_board_meta")`

wrapMin — how long THIS full rotation actually took (previous stamp to
now) — rides along for the heartbeat. Its SLA used to be computed from a
constant 0.95 min/hop, which reality outgrew: at 31.5k cold boards the
formula promised a 375-min wrap while the measured healthy rate
(46 boards/min, the fast-lane incident's own benchmark) takes ~685 min —
so the freshness check was structurally red on a healthy rotation, the
same disease as the disk alarm that divided by a plan we are not on.
Alarms compare against what rotations MEASURABLY take, not what a
constant hoped. lastWrapMin is null on the first wrap ever; the reader
falls back to the formula until one real duration exists.
ERROR-CHECKED, because this upsert replaces the whole v row: a read
that failed silently would write a stamp WITHOUT wrapMin and revert the
heartbeat to its fallback SLA for the entire next rotation, with the
failure indistinguishable from "first wrap ever". A review agent caught
exactly that — the discarded error — before it shipped.

## n135-

Above: `{`

Consecutive-failure pruning + dormancy: a feed that stops responding keeps its
postings (a transient blip must not wipe a company), but a feed dead for
DEAD_BOARD_THRESHOLD straight attempts is gone for good — prune its stale
postings AND mark it dormant so future rotations skip the dead fetch (see the
dormancy skip-list at the top of the slice). okTokens clear both streak and
dormancy; a failed recheck probe stays dormant with a refreshed timer. Skipped
dormant boards weren't attempted, so they don't count as failures here.
(Verification stamping happens per-board inside the slice loop — hop-end
code is unreliable on heavy hops; see the stamp at okTokens.push.)

## n136-lapcutoff

Above: `const lapCutoff = Date.now() - 45 * 86_400_000;`

Best-effort: losing this costs a board one restarted pass, never a row.

The lane's own counters ride in this same row under a key that is not
a token, so they need no second meta key and no extra read in the
status bundle. Both readers of this row keep only positive integer
values, so a nested object here is inert to them: it cannot enter the
cursor map, and it cannot disturb boards/maxOffset/sumOffset. Written
when the lane ran even if no cursor moved — "ran and selected none"
is precisely the state that has to be distinguishable.
The lap map rides the SAME row and the same write. It is a nested
object under a non-token key, so it is inert to both readers exactly
as __lane is, and it costs no second meta key, no second read and no
second round trip. Entries whose board has not been walked in 45 days
are dropped: the delete branch in the board loop retires a board that
stops being windowed, but a board that stops being VISITED (dormant,
removed from the catalogue) would otherwise sit here forever.

## n137-try

Above: `try {`

A DISARM MAY ONLY EVER BE ADDED BY THIS WRITE, NEVER REMOVED BY IT.

`f = 1` is the thing that stops a holed lap becoming logged
takedowns, and it lives in a whole-row, last-writer-wins meta row,
while the evidence it invalidates (lap_epoch) is committed per
posting and survives everything. Chain hops run past the slice lock
with force=true, so two isolates overlap: the one holding the older
copy writes last and reverts the other's disarm, leaving a lap that
proves over rows it never stamped.

So re-read the row and fold, in the fail-closed direction ONLY: a
stored lap on a NEWER epoch wins outright (that isolate has walked
further than we have), and a stored disarm on the SAME epoch is
OR'd in. Nothing here can clear an `f`, advance an `s`, or invent a
`w`. deepCursors itself is deliberately untouched — re-keying or
re-merging the cursor map is how rotation speed gets silently
changed, and that is a separate measurement.

One extra SELECT of one meta row, at hop end, OUTSIDE the board loop
— not per board and not per posting — and wrapped so a failed read
costs the fold and nothing else.

## n138-stalelane

Above: `if (staleLane) {`

THE STALE LANE'S FOLD. A selected board the loop attempted counts one
try unless it STAMPED (okSet), in which case it leaves the tries map —
the lane's job for it is done. So does ANY entry whose token stamped
this slice: okSet holds every stamp the slice landed, not only the
lane's, and since .71 a token at STALE_TRIES_MAX is excluded from the
window, so the rotation's stamp is the only way its entry can clear. A
board the posting budget deferred was never attempted and is untouched,
the same rule failedTokens follows above. Written whenever the lane ran, including an RPC-less hop, so
"ran and selected none", "could not ask" and "never ran" stay three
different readings on status. Best-effort: losing this costs one try's
worth of bookkeeping, never a row.

## n139-

Above: `{`

ONE POOL SAMPLE PER COMPLETED PASS. This is the entire basis for the
board's published growth number, which is now OBSERVED (sample at the
window start differenced against the pool now) rather than inferred from
`intake - closed`. That inference shipped twice today and was wrong both
times, most recently by 2.8x measured against this very quantity.

BEFORE the facets call, not after: facets returns early when its RPC is
unavailable, and a growth series that quietly stops accruing whenever a
different RPC is down is a series that reads "flat" for the wrong reason.
Best-effort — never fail a pass for a metric.

## n140-const-data-flow-error-ferr-await-client

Above: `const { data: flow, error: fErr } = await client.rpc("get_board_flow", { p_hours: 24 });`

AND CACHE THE FLOW HERE, so status never computes it per request.
withDeadline is a Promise.race: losing the race abandons the promise but
the statement keeps running to its 15s statement_timeout. Calling this
from status meant every status hit paid for the counts and usually
displayed null anyway — measured during the 2026-08-17 22:07Z outage,
when freshness, dateCoverage and boardFlow were all null together while
ordinary reads timed out. Once per pass, read from meta thereafter.

## n141-const-data-facets-error-facetserr-await

Above: `const { data: facets, error: facetsErr } = await client.rpc("refresh_job_board_facets");`

Facets from the database — always true to what the board serves. If
the RPC isn't migrated yet (function published before migration ran),
keep the previous meta instead of clobbering it with zeros.
refresh_job_board_facets, NOT get_job_board_facets. The read function now
serves a CACHED row so page views stop timing out over 584k rows — and the
orphan prune below DELETES postings from the company list it gets back. A
destructive path computes its own input rather than trusting a cache.

## n142-facetscarried

Above: `let facetsCarried = false;`

ONE FAILING AGGREGATE MUST NOT SWITCH OFF SIX UNRELATED DUTIES.

This used to `return` here, keeping the previous refresh meta — correct
for the meta, catastrophic for everything below it: the freshness sweep,
date hygiene, the capacity governor, coverage, and the refresh stamps
all sit downstream, so every pass while the facets RPC struggled skipped
ALL of them, with `ok: true`. Measured 2026-08-29: facets started timing
out at ~09:52Z under write pressure, the sweep stopped trimming the aged
tail, the table grew, the aggregate got heavier — a feedback loop that
held the whole pass-end hostage for 4+ hours and tripped
{facets_cache, freshness_cap} together on the heartbeat (that pairing IS
this return's signature). Now: carry the PREVIOUS facet fields forward —
the same contract coverage already uses for a failed count — and let the
maintenance run. Only the orphan prune stays gated on FRESH facets,
because it deletes rows based on the company list.

## n143-pv-companiesopen-typeof-pv-companiesopen

Above: `...(pv.companiesOpen && typeof pv.companiesOpen === "object"`

THE SERVABLE COMPANY NUMBERS RIDE THE CARRY, OR THEY VANISH.
Carried through exactly like companiesFacet and marked by
facetsCarried below. Carried ONLY when the previous row actually
had them: on the first pass after the migration deploys, and on
any pass that carries from a pre-migration row, they are absent —
and absent is the state every consumer reads as "publish no
number", which is the whole deploy-window contract.

## n144-try

Above: `try {`

Orphan prune: a board removed from sources.ts is never fetched again, so
its postings would linger forever. Diff the DB's live company list
(from the facets we just computed) against the source of truth and
delete any token no longer aboard — so a removal actually disappears.

STALE-BUNDLE GUARD (2026-07-15 incident): a re-deploy that ships an OLDER
bundle sees every board added since as an "orphan" and wipes its real
postings — a stale pre-Rung-3 bundle deleted the new vendors' entire
ingestion this way, silently. A catalog high-water mark in meta makes the
prune refuse to run from any bundle smaller than the largest ever deployed;
an intentional catalog SHRINK must lower the mark via {action:"refresh",
resetCatalogHighwater:true} with the chain key.
THE ORACLE SITE-RANK TABLE, PUBLISHED FOR THE REPAIR SQL. The repair
function (migration 20260909216000) keeps the same one-row-per-tenant-
requisition rule as the ingest, and it must keep it under the SAME
ranks or the two would move a tenant's rows back and forth between
sites. So this bundle's table is the source of truth: written to meta
whenever its hash differs from what is stored (one read per pass, a
write only when the catalog's Oracle sites changed), read by the
function at run time. The migration seeds the same key so the sweep
can start before this bundle serves.

## n145-nowiso

Above: `const nowIso = new Date().toISOString();`

Date hygiene: repair any stored posted_at that's junk (future, or
pre-2000 epoch-zero/typo territory). New inserts are already sanitized
at ingestion; this fixes rows stored before that guard. UPDATE, not
delete — the posting is still live, only its date was junk. Real-but-old
dates are NOT nulled here: nulling a 3-year-old evergreen's date is what
used to keep it alive undated past the 30-day promise — those rows now
age out at ingest instead. Self-terminating: once nulled a row stops
matching, so later passes update nothing.

## n146-alreadytombstoned

Above: `const alreadyTombstoned = new Set<string>();`

Ledger BEFORE deleting: this sweep runs every pass while a board is only
re-fetched on rotation, so it wins the race for most age-outs. Writing
nothing here meant the aged_out side of the ghost-rate stat counted a
small minority of real events (bug sweep 2026-07-26). Best-effort: the
prune itself must never fail because the ledger did.
TOMBSTONE BEFORE LEDGERING, and ledger only what is newly dead.

Deleting alone did not stick: the next rotation re-inserted every row
(ingest suppresses on "already stored", and the row was no longer
stored), so the same postings aged out again and again — ~20,600 of
them, each lap writing another exit. "Roles filled or closed today"
was counting the loop. The tombstone both stops the re-entry and
tells us which ids have already been counted: an id we have seen die
before is not news.

## n147-oversizeheld

Above: `const oversizeHeld = agedRows.filter((r) => heldOversize(OVERSIZE_BOARDS, r, SHARED_TOKENS) && ...`
(since .90 matched by the row's board, `source` + `company_token`, not its token; n422;
and the sweep runs only in a slice that read the registry, n421)

A BOARD WE CANNOT READ IS NOT A BOARD THAT CLOSED.

An oversize board on a vendor with no light form is deferred every
pass, so its postings are never re-verified and age past this
30-day window while the roles themselves may be perfectly open.
Deleting them is right — a posting nobody has verified in a month
is not servable — but LEDGERING them is a lie of exactly the kind
the closure log cannot take: it is the one asset here nobody else
can copy, and its value is that every row in it is a real exit.
~90 boards' worth of live postings recorded as ordinary
expirations would be indistinguishable from real ones forever
after. So they are dropped from the ledger and counted out loud.

Into `alreadyTombstoned` rather than a second filter, because that
set has exactly one consumer — the `freshlyDead` line below — and
in it both memberships mean the same single thing: this id must
not be written to the exit ledger as news. It is also literally
true by this point: the upsert immediately above has just
tombstoned every one of these ids.

## n148-const-count-plannedsize-await-client-from

Above: `const { count: plannedSize } = await client.from("job_board_postings").select("id", { count: "planned", head: true });`

Capacity governor (see CORPUS_CEILING). This gates a destructive op, so
don't reuse the orphan-inflated facet total — and don't evict on an
estimate either.

The exact count stopped fitting the statement timeout as the table grew
past ~590k (measured 2026-08-06). `corpusSize ?? 0` then read as a corpus
of ZERO, which is not merely wrong but wrong in the safe-looking
direction: eviction never fires, and the meta row below published
`headroom = ceiling`, so the heartbeat's capacity check saw maximum
headroom and passed. The guard had switched itself off and reported
healthy while doing it.

So: the planner estimate is the routine watch signal (0.1s), and the
expensive exact count is attempted ONLY when that estimate says we are
near the ceiling and the answer could actually authorize a deletion.
Eviction still requires an exact number — never an estimate.

## n149-coverage

Above: `const coverage = await (async () => {`

WHAT EACH FILTER WOULD COST THE SEARCHER, computed once per pass.

A filter here is honest — it excludes rows whose value we genuinely do
not know — but it is silent, and the silence is the problem. MEASURED ON
2026-08-27 against 599,316 open postings, and BOTH FIGURES HAVE SINCE MOVED — re-read
the dated paragraphs above MEASURED_COVERAGE before quoting either: salary
was stated on 12.9%, so setting a salary floor discarded 87% of the board,
and work mode on 29.9%; experience on 40.4%. The work-mode share is moving
in THIS bundle by design, because one vendor's employers answer that
question in a dropdown this function had never read. Someone who sets a
floor believes they are looking at the market and is looking at a fraction
of it, with nothing on screen to say so.

Counted HERE rather than per request: four exact counts on a 600k table
is nothing once an ingest pass, and unaffordable on every search. head:true
sends no rows. A failure leaves coverage absent, and the UI shows nothing
rather than a wrong fraction — an invented coverage number would be worse
than none, since it would be believed.

## n150-coveragefailed

Above: `const coverageFailed: string[] = [];`

A FAILED COUNT WAS INDISTINGUISHABLE FROM A COLUMN NOBODY POPULATES.

This discarded the error and returned null, and null is published as
"no figure" — so a count that timed out deleted a disclosure instead of
reporting a problem. Measured live 2026-08-27: filterCoverage was
publishing ONE of its four figures ({"experience":0.394}), meaning a
searcher who set a pay floor was seeing ~20% of the board and being
told nothing, and one who set a work mode was seeing ~28% and being
told nothing. These disclosures are the whole reason a NULL-discarding
filter is allowed to exist here.

## n151-try

Above: `try {`

ONE SCAN, NINE COUNTS — get_filter_coverage() (20260827230000). The
four separate PostgREST exact counts below are the reason three of the
four figures were dying: each is its own full scan against its own
statement budget. The SQL function computes all nine (the four here
plus the five that rode pinned constants) in a single pass over the
serving population. The old path is kept ONLY as the deploy-window
fallback for the bundle-before-migration ordering, and behaves exactly
as today when the RPC is absent.

## n152-annualwithouttext-typeof-fc-annual-without-text

Above: `annualWithoutText: typeof fc.annual_without_text === "number" ? fc.annual_without_text : null,`

THE PER-ROW INVARIANT THE STATES-PAY WIDENING RESTS ON, stored as
a RAW COUNT and not a fraction, because the only value that means
anything here is zero. The predicate that moved on 2026-09-27 is a
superset of the retired one only while every annualised figure has
the employer's text behind it; get_filter_coverage publishes the
count of rows that break that (20260927041903) and this is what
keeps it, so the invariant is checkable from outside instead of
being asserted in a comment. Absent from a pre-20260927041903
definition, in which case it is stored as null — "not measured",
never zero, which would be a claim.

## n153-const-count-open-await-client-from-job-b

Above: `const { count: open } = await client.from("job_board_postings")`

THE HEADLINE MUST COUNT WHAT THE BOARD CAN SERVE. This counted
missing_since alone, while the read path also requires
effective_posted within the freshness window — so the published
total ran 6,809 HIGH (582,839 published, 576,030 servable, measured
2026-08-23). Three consequences from one missing predicate: the
homepage claimed a 30-day-filtered count while showing an unfiltered
one, with client comments asserting the opposite; the pagination
fence, fed this number, admitted 6,809 offsets that each walk the
whole index for ~4s and return zero rows; and the "servable postings
unreachable behind the fence" defect reported earlier today was this
same gap, read in the wrong direction — nothing was ever fenced off.

## n154-const-sal-wm-exp-ctry-await-promise-all

Above: `const [sal, wm, exp, ctry] = await Promise.all([`

ONE PROMISE MORE THAN THERE WERE NAMES TO BIND IT TO, AND EVERY
NUMBER AFTER IT SHIFTED. A fourth count (salary_max_annual) was
added here for a pay-CEILING filter that was subsequently refused
with data, and it was inserted SECOND in the array while the
destructuring still read [sal, wm, exp]. So the board published the
salary-ceiling coverage as its work-mode figure and the work-mode
coverage as its experience figure, and the experience count was
computed and thrown away. Measured live 2026-08-24: the page said
work mode 14% (really 29.1%) and experience 30% (really 42.1%) —
the board was understating its own coverage by half while the
caveat text told readers to trust exactly those numbers.

The ceiling count is deleted rather than bound: its only consumer
was a refused feature, and a live count with no reader is what
caused this.

## n155-one-country-not-is-null

Above: `one("country", "not.is.null"),`

Country had NO caveat at all while pay, work mode and experience
each had one — and it is the thinnest of the four on some
vendors. Teamtailor used to be the worst of them at 0 rows, but
that was OUR parser discarding tt:country, not the vendor
withholding it — fixed 2026-08-25, so those 10,858 rows resolve a
country as they re-ingest. The caveat stands on its own merits: a
filter
that silently hides a quarter of the board is exactly what this
disclosure exists to prevent.

## n156-f-companiesopen-typeof-f-companiesopen

Above: `...(f.companiesOpen && typeof f.companiesOpen === "object" ? { companiesOpen: f.companiesOpen } : {}),`

THE SERVABLE SIBLING OF companiesFacet — see migration 20260909214000.
companiesFacet is the UNFILTERED prune input and must never reach a
reader; this map (company_token -> count under both serving
predicates, zero-open tokens absent) is what every reader surface
publishes. Spread only when the pass produced it, so an older row read
during the deploy window is missing the KEY rather than carrying a
misleading empty map — absence is what makes consumers fall silent.
Like `total` above, it includes any just-pruned orphan until the next
pass recomputes; the prune deletes at most a handful of removed boards.

## n157-coverage-coverage-coverage-at-st

Above: `...(coverage ? { coverage: { ...coverage, at: startIso } } : {}),`

STAMPED INSIDE THE BLOCK, not beside it. `refreshedAt` on this row is the
pass stamp and is patched between passes by refresh_headline_open, so a
reader pairing the coverage fractions with it can be told a figure was
measured by a pass that only touched the total. The date the page prints
has to be a property of the numbers it prints, so it travels in the same
object and cannot be moved without moving them — a figure whose basis
date can drift away from it is the claim-drift shape in a single row.

## n158-vhead

Above: `const vHead = {`

THE SERVING PATH GETS ITS OWN SMALL ROW.

`v` above is 1.3-1.6MB, essentially all of it companiesFacet — one entry
per employer, ~23,500 of them. Every list request read the whole thing to
use two things from it: the LENGTH, and the top handful for the employer
chips. Measured on the offset-ceiling exit (which does this read and no
query of its own): median ~700ms, 55-70% of a plain browse.

An in-isolate TTL cache was tried first and does NOT work: module-level
state does not survive between requests in this runtime. Fourteen
consecutive offset-ceiling requests, six of them on one TCP connection
less than a second apart, all cost 452-1,034ms against a 60s TTL — zero
hits. So the fat row is not cached; it is simply not read.

companiesCount is stored EXPLICITLY rather than left to be derived from
the truncated head, because a length taken from a 200-row slice would
publish "200 employers" as a fact. Its presence is also what the reader
uses to tell this shape from the old one — see the read site.

## n159-coverage-coverage-coverage-tracke

Above: `...(coverage ? { coverage: { ...coverage, tracked: v.total, at: v.refreshedAt } } : {}),`

tracked rides in coverage because that is where trackedTotal reads it.
refresh_headline_open patched ONLY the fat row, so the moment serving
preferred the head row the homepage lost its tracked figure — f.total
IS the tracked corpus (the unfiltered count this same pass took), and
20260828001000 teaches the patcher to keep both rows fresh between
passes.
The stamp rides the SERVED row too — serving reads refresh_head, and a
block with no `at` is one coverageDisclosure must publish without a date,
which means the page prints no percentage at all.

## n160-typeof-v-as-companiesopencount-number

Above: `...(typeof (v as { companiesOpenCount?: number }).companiesOpenCount === "number"`

THE FAT ROW GETS THE WHOLE MAP; THE HEAD ROW GETS THE SLICE AND THE
SCALAR, and that split is the size decision this row exists for.

companiesOpen is ~24k entries — the same order of magnitude as
companiesFacet, which is the 1.3-1.6MB this row was created to stop
serving. Putting it here would undo the whole measurement above. What
the serving path actually reads is (a) one number per employer for the
200 it shows, and (b) the board-wide servable count for the headline
pairing. So the open count is FOLDED INTO the 200 entries, and the
board-wide figure rides as an explicit scalar.

companiesOpenCount is stored EXPLICITLY for the same reason
companiesCount is: derived from a 200-row slice it would publish the
slice size as a fact about the board.

## n161-v-as-sourcesfacet-unknown-sourcesfac

Above: `...((v as { sourcesFacet?: unknown }).sourcesFacet`

sourcesFacet RIDES THE HEAD ROW WHOLE, and that is not a contradiction
of the size note above: it is one entry per SOURCE — twenty keys, a
few hundred bytes — not one per employer. It is the servable count
per vendor under the same two predicates as categoriesFacet, taken in
the same pass, and the facets action forwards it to the vendor
dropdown so each source can print its inventory. Spread only when the
fat row has it, so a pre-migration pass leaves the key absent rather
than publishing an empty map as twenty zeros.

## n162-hotexcluded

Above: `const hotExcluded = new Set<string>();`

Re-rank the hot tier from what the corpus actually holds now: velocity
leaders (most postings first_seen inside the window — the boards where
new jobs actually appear) take guaranteed slots, size leaders fill the
rest. RPC missing (migration lag) degrades to pure size ranking.
HOT-TIER EXCLUSIONS. get_board_velocity filters showcase_excluded, but
the SIZE ranking below is a second, independent door into the hot tier —
and the board this exists for (Domino's, 24,566 postings) would top it
outright. Filtering one door and not the other would have let it in
anyway, which is the kind of half-fix that reads as done and is not.

Cadence only, never coverage: an excluded board keeps full cold-tier
refresh. The hot tier re-fetches once per PASS (~60-90+ min at 160 cold
slices — the old "~10-15 min" here predates the 120/160 raises) at HOT_CONCURRENCY=2
because its members are giants; a per-store delivery-driver vacancy does
not need that, and the slot goes to a board where a stale posting costs
someone a real application.

A failed read yields an EMPTY set — the previous behaviour, one giant in
the hot tier — rather than an empty hot tier. Degrading to "slightly
expensive" beats degrading to "nothing gets refreshed often".

## n163-filter-audit-every-ms

Above: `const FILTER_AUDIT_EVERY_MS = 6 * 60 * 60_000;`

FILTER AUDIT KICK — the scheduled half of the filter contract.

Self-invoked from the refresh path rather than driven by pg_cron, for a
concrete reason: filter-audit is chainKey-gated, and chainKey is derived
inside the function, so a cron row in Postgres cannot produce one. The
sweeps here already solve that by having the function call itself with its
own key, and reusing that path means the audit inherits a scheduler that
is already proven to fire.

Once every 6 hours is deliberate. The audit issues ~30 real HTTP requests
against this same function, including a 4-page pagination walk; running it
per refresh would put a measurable synthetic load on the board it is
supposed to be watching. Six hours is frequent enough that a filter
regression is caught the same day it ships — the defects it was built from
had been live for an unknown period because nothing asked.

## n164-resume

Above: `const resume = pbV.resumeVersion === POSTED_BACKFILL_VERSION`

Resume ONLY state written by this sweep version. v4 retired the
"workday" phase, but the stored v3 state was replayed verbatim:
line ~2486 coerced the unknown phase to "bamboohr" while the cursor
below stayed "workday:..." — so hop 1 queried
  source=bamboohr AND id > 'workday:...'
and since 'b' < 'w' it matched 0 rows, was declared exhausted, and the
sweep stamped itself complete having dated nothing. Measured
2026-07-28, 37h after v4 shipped: bamboohr 43,687/43,687 undated and
rippling 8,991/8,991 undated (100%), against greenhouse 0.8% and
ashby 0.0%. 52,678 postings that no freshness filter or day-partitioned
sitemap can ever see.

## n165-fixed

Above: `let fixed = 0, failed = 0, already = 0;`

THE v2 RUN GOT FOURTEEN BOARDS IN AND STOPPED, AND ALMOST SAID IT WAS DONE.

Measured against production after the v2 sweep: tokens 1-14 of
RENAMED_TOKENS were renamed and 15-29 were untouched, plus two
individual failures inside that prefix (hdsupply, weis — both boards
with large historical row counts). Two distinct faults:
  1. individual UPDATEs time out on boards with many rows, and the
     old loop recorded that only by not incrementing `fixed`;
  2. the run itself ran out of budget partway down the list.

And the stamp was UNCONDITIONAL. A run that reached the end having
failed every single update still wrote its version and was never
retried — the sweep would report success forever having changed
nothing. That is the same failure this whole week has been about.

Three changes, all aimed at "a partial run must be resumable and must
not claim completion":

## n166-await-maybekickmaintenance-client

Above: `await maybeKickMaintenance(client);`

Maintenance also gets a chance on EVERY slice, not only at pass end.
Measured 2026-07-25: desc-sweep and the v5 recategorise had never run once,
because both were gated behind a completed cold rotation — 27,997 boards,
many hours — and every deploy resets the bootstrap lane that runs ahead of
it. The result was ~460k postings still without descriptions and ~81k still
in "other" despite the work being built and deployed. maybeKickMaintenance
throttles itself, so a slice cadence costs one small meta read per slice.

## n167-verify-grace-ms

Above: `const VERIFY_GRACE_MS = 6 * 60 * 60_000;`

── maintenance kicks ──────────────────────────────────────────────────────
Same rules as before, just reachable. Called from BOTH the pass-complete path
and every slice, so it carries its own throttle: without one, recategorize —
which has no age gate of its own and re-fires until its stamp is written at
COMPLETION — would spawn a new chain on every slice.
Grace before a verify-on-apply miss is allowed to destroy a row. Deliberately
longer than the refresh prune's 5-minute GRACE_MS: that one corroborates a
miss against a FULL feed re-read, while this one has only a single-posting
probe whose false-negative rate is measured at 14% on Workday. One cold
rotation must be able to clear the stamp before anything is deleted.

## n168-maintenance-stall-ms

Above: `const MAINTENANCE_STALL_MS = 12 * 60_000;`

A maintenance chain restamps its progress row every invocation/hop. If that
row hasn't moved in this long, the chain is DEAD (waitUntil self-invocation
is best-effort; measured 2026-07-25 when the v5 recategorise died ~15.5k rows
in and, under the old flat 2-hour same-action gap, would have restarted from
scratch hours later — putting desc-sweep's ~460k rows weeks out). Liveness by
stamp age means: fresh stamp -> chain alive, skip; stale -> re-kick NOW and
resume from stored progress. Recovery rides the refresh heartbeat, which is
the one reliably-scheduled thing in this system.

## n169-try

Above: `try {`

HEADLINE COUNT — the cheapest independent track there is.

The published board total used to move only when a rotation pass ended,
so it was as stale as the pass was long: measured 2026-08-26, a pass that
had just finished had STARTED 6.7 hours earlier, and the headline was
still quoting that start. While the at-cap lane was adding twelve
thousand postings to a single employer, the number on the page could not
say so for most of a day.

One RPC, one statement, 0.63s measured against 550,227 rows. It patches
only the count and its own timestamp — never the whole meta row — so it
cannot race the pass-end writer into dropping a facet.

Kicks and FALLS THROUGH, and does not even take the kick stamp: it is a
single query rather than a chain, so it cannot starve the exclusive
ladder the way a returning track would. waitUntil keeps it off the
response path entirely.

## n170-cb

Above: `const cb = await alive("country_backfill");`

Country backfill runs as an INDEPENDENT track: it is pure DB work (no
vendor fetches), so it does not queue behind the fetch-heavy ladder.
Re-runs when the city table version bumps; resumes a dead chain from its
cursor.

Track kicks are NON-EXCLUSIVE — kick and fall through, never return.
The original return-after-kick was framed as "a bounded politeness
cost", and for country (hours of DB work) it was. The embed track
broke the bound: its chain is days of CPU-heavy inference whose hops
die on every isolate recycle, so it needed a revival on essentially
every 10-minute cycle — and each revival returned, starving desc-sweep
of its own recovery kicks. Measured 2026-07-25: desc_sweep stamp went
150 minutes stale mid-workday (refresh loop alive the whole time)
starting exactly at the deploy that introduced the embed track. A track
revival is one waitUntil fetch; running it alongside a ladder kick is
exactly the concurrency these tracks were designed for.

## n171-pb

Above: `const pb = await alive("posted_backfill");`

Posted-date backfill — the SAME starvation desc-sweep and recategorise
hit on 2026-07-25, except this one was left behind when they were moved
to the slice cadence. Its only kick still sits in the FULL-PASS branch,
which requires a completed 120-slice cold rotation, so in practice it
never ran: measured 2026-07-28, bamboohr dated = 0 AND rippling dated = 0
for 3h09 straight after the sweep was deliberately re-armed at
POSTED_BACKFILL_VERSION 5 and confirmed deployed. The code was correct
and simply unreachable.

Independent track: it does fetch vendors, but self-paces at one detail
call per posting with IDS_PER_HOP=120 and BACKFILL_HOP_PAUSE_MS between
hops, so it must not queue behind the fetch-heavy exclusive ladder.
Resume state is version-keyed (see the kick in runRefresh) so stale v4
state can never be replayed.

## n172-ss

Above: `const ss = await alive("structured_sweep");`

Work-mode recovery — the fourth INDEPENDENT track, and it sits up here
with the others for a reason I got wrong the first time.

It was originally placed at the very end of this function, after the
desc_sweep kick. It never fired: measured over 13 minutes across four
status polls, `structuredSweep` stayed all-null while every other chain
ran. Two branches below — the recategorise sweep and backfill-desc —
`return` after kicking, so anything after them only runs on cycles where
neither fires, and the last position in the sequence is the most starved
one available. That is the same starvation the note at the top of this
block records for desc-sweep, reproduced by adding a track without
reading its own warning.

RESUMES, never restarts. desc-sweep re-kicks at vi:0 safely because its
predicate is self-clearing; this one's is not. Rows still work_mode-null
after a pass are the ones whose detail states no remoteType, permanently,
so restarting at cursor "" would re-fetch every one of them.

## n173-sszeropasses

Above: `const ssZeroPasses = Number((ss.v as { zeroFilledPasses?: number } | null)?.zeroFilledPasses ?? 0);`

BACK OFF WHEN THE LANE IS PRODUCING NOTHING.

The classifier bug meant every pass wrote 0 rows — and the lane happily
re-issued ~154,000 Workday detail fetches every 24 hours to keep doing
it, indefinitely. A cadence that ignores its own output is a cadence that
cannot notice it has stopped working. Two consecutive zero-write passes
now stretch the interval geometrically (24h, 48h, 96h, capped at a week)
instead of hammering vendors for nothing. Any pass that writes a single
row resets it, so the fixed classifier restores the 24h cadence on its
first successful pass without anyone intervening.

## n174-lighttokens

Above: `const lightTokens = descBackfillBoards().map((s) => s.token);`

Self-healing override: if meaningful description coverage is still
missing on the light boards, run regardless of the stamp — recovers from
a stamp written by an older/buggy sweep without a manual reset.
THE SAME PREDICATE THE FILLER USES — descBackfillBoards, one definition.
This list was built vendor-agnostically, so it counted nulls on boards
backfill-desc cannot touch; those nulls never fell, and the trigger below
was therefore permanently true.

## n175-missingcoverage-bfage-bfincomplete

Above: `if (missingCoverage || bfAge > (bfIncomplete ? 60 * 60_000 : 24 * 60 * 60_000)) {`

NON-EXCLUSIVE — kick and FALL THROUGH, like the country and embed tracks
at the top of this function. The `return` that used to sit here made this
rung a gate in front of desc-sweep, and a permanently-true trigger made
it a closed one: the July starvation recorded above, arriving through a
different door. The two lanes cannot collide — this one fetches the
greenhouse per-JOB endpoint for greenhouse light boards, desc-sweep
fetches DETAIL_DESC_SOURCES, and neither vendor set contains the other.

## n176-ds

Above: `const ds = await alive("desc_sweep");`

desc-sweep: the per-posting vendors (workday/SR/bamboohr/oracle/breezy).
Every hop restamps desc_sweep, so a live chain keeps the age small and
can't be double-started; a chain that dies is picked up after six hours.

Restarting from vi:0 is deliberate — rows filled since last time have
dropped out of the `description is null` filter, so a fresh run resumes
where the DATA left off rather than where a cursor did.

## n177-len

Above: `const LEN = DETAIL_DESC_SOURCES.length;`

ROTATE THE STARTING VENDOR. vi:0 on every revival was measured
starving the tail of DETAIL_DESC_SOURCES (2026-08-24): chains die on
isolate recycles, every revival restarted at workday's 36k
permanent-failure nulls, and breezy — 5th of 6 — had received ~10
lifetime hops against an 11.6k backlog its endpoint serves fine
(probed 12/12 HTTP 200). Each revival now starts one vendor past
where the last chain stood; the action wraps a full rotation, so no
vendor is skipped and every vendor leads eventually. Still no row
cursor — the description-is-null filter remains the resume point
(the original vi:0 rationale, kept for what it was right about).

## n178-embed-per-hop

Above: `const EMBED_PER_HOP = 6;`

── semantic embeddings (gte-small, in-runtime) ────────────────────────────
One session per isolate, created lazily: the docs' own examples construct it
at module scope for reuse, and the defensive global access means local
tooling (deno check, vitest) that lacks the Supabase global still parses.
Each embedding costs ~100-200ms of the 2s per-request CPU budget — that cap,
not wall time, is what sizes EMBED_PER_HOP.
Review-corrected from 10: ten embeddings at the stated ~200ms worst case is
100% of the 2s CPU cap — zero headroom, and an over-budget hop is killed
mid-loop with its chain continuation never issued. Six embeds plus an
in-loop elapsed guard keeps the worst case near half the budget.

## n179-embed-hop-pause-ms

Above: `const EMBED_HOP_PAUSE_MS = 4_000;`

Pause between chain hops. Without it the sweep ran back-to-back around the
clock, and with the old corpus-scanning batch picker that held a continuous
full-table load on Postgres — the 2026-07-26 board saturation (filtered
lists and search timing out at 25s+ while unfiltered status still answered).
The picker is now O(batch) off a seeded queue, but the pause stays: a fill
that takes days at low duty is invisible; a fill that takes hours by
monopolizing the DB is an outage. ~570k rows / 6 per hop at ~5s cadence
≈ 5-6 days to full fill, then the hourly settle cadence takes over.

## n180-liveboardmemo

Above: `const liveBoardMemo = new Map<string, { ids: Set<string>; windowed: boolean }>();`

Single-posting liveness against the vendor RIGHT NOW — the moment-of-apply
freshness check. Uses cheap per-job endpoints where they exist (never the
20-36 MB whole-board payload for the light giants); falls back to board
membership for vendors without one. Returns true=live, false=CONFIRMED gone,
null=couldn't tell so callers don't wrongly mark a job closed.

`false` is a claim about the EMPLOYER, not about our fetch: it is only ever
returned when the vendor itself said gone (404 / empty detail) or when a
board was read EXHAUSTIVELY and the id was not in it. Absent from a WINDOWED
(page-capped) read is null — see the WINDOWED-ABSENCE RULE at the bottom.
The memo carries `windowed` alongside the id set because ABSENCE ONLY MEANS
ANYTHING ON AN EXHAUSTIVE FETCH — see the WINDOWED-ABSENCE RULE below.

## n181-checklive

Above: `async function checkLive(src: JobSource, externalId: string, applyUrl?: string | null, note?: { pageCapped: boolean }): `

`note` distinguishes the TWO reasons this function returns null, because the
published audit says a word about them and the two words are opposite:
  * the fetch failed / the vendor answered badly  -> genuinely UNREACHABLE
  * the fetch SUCCEEDED, parsed, and was page-capped short of the vendor's
    own advertised total -> reached, answered, and still UNDECIDABLE
GhostJobIndex used to print the whole null bucket as "unreachable", which
after .64 is false for most of it: ~4,348 of 44,542 boards sit on capped
fetchers, so this is the common case, not the rounding error. Callers that
do not care pass nothing and see the same tri-state as before.

## n182-const-tenant-dc-site-src-token-split

Above: `const [tenant, dc, site] = src.token.split("~");`

Workday has no by-id endpoint, so liveness is probed in three escalating
steps and only the last one is allowed to say "gone".

WHY THREE. The stored externalId is the externalPath's `_`-suffix, and
when a requisition is posted to several locations Workday appends a
DEDUPE DISCRIMINATOR to that suffix — `..._JR3085-1`. The req id its
search index actually holds is the base, `JR3085`. Searching the stored
id therefore returns zero hits for a perfectly live posting, and the old
single-step version read that empty result as a confirmed closure.
Measured 2026-08-06 over 172 postings seen live in the feed that same
second: 5 were reported GONE, every one of them a `-N` id. That is the
"search index does not contain every externalId" note on the verify
branch — it was never the index being incomplete, it was us searching
for an id that does not exist.

## n183-country

Above: `let country: string | null = null;`

WHERE THE EMPLOYER SAYS THE JOB IS, from the same payload, for free.

Workday's list gives `locationsText`, which on a multi-site requisition is
the literal "2 Locations" — and the row is then stored with no country at
all. Measured 2026-09-23 on a 4,500-row cursor walk of live Workday rows:
43.6% carry no country, 11.0% carry an "N Locations" placeholder and 7.4%
carry an empty location string. Workday is 216,035 of the board's 770,705
servable rows (28.0%), and is where most of the board's unplaced set sits.

The detail payload this function already downloads states both outright.
null = the vendor did not state one, or stated two that disagree.

AND HOW MANY SITES THE REQUISITION LISTS, because without it the caller
cannot tell a place from one of fifty-two places. The vendor hands us ONE
display location whatever the count is; `additionalSites` is what lets the
write sites refuse a precision the requisition does not have.

## n184-rt

Above: `const rt = String(j?.jobPostingInfo?.remoteType ?? "").toLowerCase().trim();`

Workday's LIST payload carries no work-mode field, so every workday
row's work_mode is text-inferred at ingest — but the detail we're
already holding states remoteType outright. The vendor's structured
field always outranks inference, so carry it back to the caller for
the same free-ride treatment startDate gets.

remoteType IS TENANT-AUTHORED FREE TEXT, NOT A WORKDAY ENUM, and
that is why this lane wrote nothing for months. The previous test
looked for five substrings — "remote", "hybrid", "on-site", "onsite",
"on site". Measured across 154 live postings drawn from the exact
eligible predicate: only 8 carried remoteType at all, and ZERO of
those 8 matched any of the five. Every observed value was an onsite
label the classifier had never heard of — "In-Person Working",
"Campus based", "Fully on premise", "Field Based", "On Campus".

So workMode came back null for 100% of eligible rows, the patch
stayed empty, and the sweep reported 154,003 scanned / 0 filled. With
work_mode null corpus-wide the board's Hybrid and On-site filters
both degraded to "not remote" — two different labels over one
identical result set.

ORDER IS LOAD-BEARING. Hybrid first: "Hybrid: Remote and Office"
contains "remote" and is not remote (the old code got that right only
by accident, via its `&& !includes("hybrid")` guard). The in-person
family must precede remote for the same reason — "Remote or On
Campus" style labels lead with the exception.

THE NEGATION ARM COMES FIRST, AND IT IS NOT OPTIONAL. Nike's live
tenant publishes the literal string "Non-Remote Posting". A substring
test for /remote/ matches it and writes work_mode = "remote" — the
exact inversion of what the employer said. "Not Remote" and "No
Remote" are the same trap. This was caught by an audit AFTER the
rewrite had been committed and pushed, and before it was deployed:
without this arm, structured-sweep would have written "remote" onto
every Non-Remote Posting row at Workday scale (half the board) the
first time it ran.

A classifier built from substrings has to answer the negations before
the positives, always. Ordering below: negated -> hybrid -> onsite
family -> remote.

## n185-

Above: `/**`

PostgREST or() syntax breaks on these — strip rather than reject.
Strips ONLY the characters that are ILIKE metacharacters. It used to strip
commas and parentheses as well, which silently rewrote the user's location
into a different question:
  "San Francisco, CA" -> the literal substring "San Francisco CA"
and almost no stored location contains that, because they are stored WITH the
comma. Measured live 2026-07-29 against the true count under the serving rule:
  "San Francisco, CA"   38 served / 2,978 real   (1.3%)
  "New York, NY"        18 served / 3,070 real   (0.6%)
  "Berlin, Germany"      1 served /   438 real   (0.2%)
Proof it was the comma: "San Francisco, CA" and "San Francisco CA" both
returned exactly 38, byte for byte. Nothing appeared in ignoredFilters, so the
filter was neither honoured nor named — it was ALTERED, which is the fence
breach the other two cases cannot be excused as.

"City, ST" is the format the board itself prints on every card, and the
natural-language parser emits it too (Jobs.tsx:376), so this was reachable
from the headline search bar.

Commas and parens never needed stripping: the term is BOUND (.ilike() and a $3
parameter), never concatenated into SQL, so they are literal characters. Only
% _ and \ carry meaning to ILIKE.
"|" joins the RANKED path is now a delimiter (search_jobs splits p_location
on it so one metro alias can match any of its canonical names), so it is
stripped here for the same reason % and _ are: a value the caller controls
must never be able to change the shape of the query. Real locations in this
corpus DO contain pipes — BAYADA publishes "Philadelphia | 39.95 | -75.16" —
so this is a live concern, not a theoretical one.
Strips every character that could change the SHAPE of a query rather than
its content: % and _ are ILIKE wildcards, \ escapes them, | is the metro/state
alias delimiter search_jobs splits on, and " delimits a value inside a
PostgREST or() branch — a typed quote could otherwise close the quoting early
and inject filter syntax. The quote became load-bearing when state aliases
(", TX") forced the browse path to quote its or() values.

## n186-re-new-regexp-negated-remote-source-i-la

Above: `{ re: new RegExp(NEGATED_REMOTE_SOURCE, "i"), label: "not remote", patch: {} },`

NEGATIONS BEFORE POSITIVES — the third and last place this rule was
missing. `/\bremote(?:ly)?\b/i` matches INSIDE "non-remote", because the
hyphen is a word boundary: the identical mechanism as the 2026-08-17
title incident and the detectWorkMode defect fixed in the same deploy.
For q="non-remote nurse" with no workMode or remote field in the body,
INTENT_CONFLICTS does not suppress the lift, so this list patched
workMode:"remote", deleted the word from the query (residual "non-
nurse"), and DISCLOSED that it had applied a "remote" filter. A seeker who
asked for non-remote work was served remote roles and told so.

This rule consumes the phrase and patches NOTHING. Patching the negation
into a filter is not available: the board has no not-remote predicate
(work_mode is a trinary with a large NULL population, so "not remote"
is not expressible as an equality), and inventing one here would be a
second spelling of a filter that does not exist. Consuming without
patching is the honest outcome — the phrase stops inverting the search,
the words stop being matched as literal title text, and nothing is
claimed that the board cannot serve. The pattern is the SHARED one from
normalize.ts, so there is one definition of "negated remote" across the
writer, the repair and the reader.
Non-global: liftIntentFilters calls .test() then .replace() on the same
object, and a /g/ regex carries lastIndex between them.

## n187-re-bpart-time-b-i-label-part-time

Above: `{ re: /\bpart[- ]?time\b/i, label: "part time", patch: { employmentType: "part_time" } },`

Employment-type phrasing — the filter shipped 2026-08-28 and these are
among the most-typed qualifiers on any job board. Phrases before the bare
"intern" word, same ordering rule as the work-mode block; "temp" alone is
NOT lifted (too ambiguous — "temp agency", "temperature controlled").
\b ANCHORS, AS TWO-CHARACTER ESCAPES — NOT THE BYTES THEY NAME. These
six rules shipped carrying literal BACKSPACE characters (0x08) where \b
belonged: invisible in every editor and review, and a regex that matches
only queries containing actual backspaces — i.e. never. The most-typed
qualifiers on any job board ("part time nurse", "internship") lifted
nothing for a day while the code read correctly. And the obvious repair,
retyping the anchors as plain letters, would have been worse: unanchored,
/intern/i matches INSIDE "international sales manager", patching
employmentType=internship and deleting the letters from inside the word.
The guard test greps this file for raw 0x08 bytes now — fifth member of
the invisible-spelling class the guard-literals tests exist for.

## n188-clash

Above: `const clash = Object.keys(p).find((k) => k in patch && patch[k] !== p[k]);`

AND A LIFT ALREADY MADE CANNOT BE OVERWRITTEN BY A LATER ONE. Now that
the bare work-mode words are lifted, one query can trigger two rules that
write the SAME key: q="remote hybrid analyst" matches both, and a plain
Object.assign would let "hybrid" silently replace "remote" while the
disclosure listed both — the response asserting two filters it did not
apply. First rule wins; the loser's words stay in the query, where they
go through queryTerms and come back as droppedTerms the page renders.

## n189-t-t-replace-s-s-g

Above: `t = t.replace(/(^|\s)[-&/–—]+(\s|$)/g, " ");`

A HYPHEN BETWEEN WORDS IS PUNCTUATION, NOT SYNTAX. Job titles are full of
it — "Graduate Engineer - Civil", "Weekend LPN - Pediatric Clients",
"Service Manager - INFINITI Stuart!" — and websearch_to_tsquery reads a
leading "-" as NOT. Measured 2026-09-04 against the live board:
  "Graduate Engineer - Civil"     347 results, the posting NOT returned
  "Graduate Engineer Civil"        44 results, that posting ranked FIRST
  "Weekend LPN - Pediatric Clients"     not returned at all
  "Weekend LPN Pediatric Clients"  total 1, that posting ranked FIRST
A findability probe over 40 sampled postings found 5 unreachable by their
own title, and 4 of the 5 contained " - ". The board's deliberate
exclusion syntax is an ATTACHED "-term", which splitExclusions has already
consumed before this runs, so a hyphen still standing here is separator,
not intent. The same goes for a lone & or / between words.

## n190-money-null-return-terms-drop

Above: `if (money !== null) return { terms: [], dropped: all.filter((t) => QUERY_FILLER.has(t)), liftedSalary: true };`

NOTHING LEFT — and WHY it is empty decides what to do next.

If a pay figure was lifted out, the figure WAS the whole query and the
floor alone is the search. Returning `all` here put the money token back
as a required title word, which is why the plainest possible use of the
feature failed: q="120000" returned ZERO while the same floor on its own
counted 13,381, and q="80k" returned 88 — literal matches on titles like
"Senior Product Engineer (£80k-125k + Equity)" — while the floor counted
25,896. The board answered a text question nobody asked instead of the
pay question they did.

If it is empty because every word was filler ("jobs near me"), the raw
string is still the best guess and the caller falls back to it. That is
what liftedSalary distinguishes; without the flag the two cases are
indistinguishable downstream and one of them has to be answered wrongly.

## n191-bounded-levenshtein-true-when-edit-distance

Above: `/** Bounded Levenshtein: true when edit distance <= 2. Early-exits on length`

Curated, MEASURED did-you-mean pairs. Each entry is verified live before it
enters: the key's exact results are junk or near-zero while the value's
pool is orders of magnitude larger. This is a DISCLOSURE, not an expansion
— the results themselves are untouched (no re-ranking, no filter widening,
none of the tier-escalation traps), the client renders a one-click
suggestion above them. Query-side only: it never classifies or relabels a
posting, so the frozen classifier stays frozen.

## n192-salarytext-number-null

Above: `salaryText?: number | null;`

THE COLUMN hasStatedPay ACTUALLY BINDS. get_filter_coverage counts both
on the same scan: `hasStatedPay` is the annualised figure and
`salaryText` is the verbatim pay field. The filter moved to the pay
field, so the DISCLOSURE has to read salaryText or the sentence
describes a narrower population than the count printed above it — which
is the exact shape the coverage blocker names. The old key stays typed
because the floor's and the ceiling's figures still come off this block
and because a pass written before this bundle carries it and not the new
one.

## n193-cov-return

Above: `if (!cov) return {};`

NO CACHE, NO NUMBERS — INCLUDING THE MEASURED ONES, and this early return
stays exactly where it was. It is pinned by name in
src/test/intent-is-a-filter-and-a-filter-says-what-it-hides.test.ts, and
reordering it so the constants below survive a cold cache was how this
change first went in: 630 tests passed and that one guard went red.

The guard is right, and not only about invented fractions. The cached block
is the freshest evidence the board has that its own coverage figures are
being recomputed at all; with it missing, publishing five pinned constants
beside four absent live figures says "we measured this today" on the one
request where nothing was measured. Live 2026-08-25 the cache is present
(filterCoverage {salaryFloor 0.201, workMode 0.281} on a real probe), so
this costs the new filters nothing in practice — it only decides the cold
case, and the cold case is the one where silence is honest.

## n194-covat

Above: `const covAt = (cov as { at?: unknown }).at;`

AND NO STAMP, NO NUMBERS EITHER — the same rule as no cache, for the same
reason. Every figure in this block is a snapshot: the docblock's own
measurement is that the same probes read 0.235/0.232/0.452/0.928 and, two
hours later, 0.239/0.233/0.457/0.933. A percentage whose basis date the page
cannot print is a claim rather than a measurement (project_stat_provenance),
and the page interpolates this stamp into the sentence, so a block written
before the stamp existed must fall back to silence and not to an undated
figure. It self-heals on the next completed refresh pass, which is where the
stamp is written beside the numbers it describes.

## n195-pinnedused

Above: `let pinnedUsed = false;`

LIVE FIRST, SNAPSHOT AS FALLBACK. These four rode pinned constants because
the pass could not afford four more separate scans; get_filter_coverage()
(20260827230000) counts them in the same single pass as the original four,
so a cached live figure now exists on any pass that ran against the
migration. The dated constants remain ONLY for the deploy window where the
cache was written by an older pass — a 2026-08-25 snapshot beats silence
for a filter that is actively hiding rows, and it is replaced by the next
completed pass. `vendor` stays pinned at 1: source is complete by
construction and a count would be a scan proving a tautology.

THE FALLBACK IS NOW RECORDED, BECAUSE THE SENTENCE CARRIES A DATE. `covAt`
is the stamp of the pass that wrote this block, and printing a 2026-08-25
snapshot under it would date a measurement to a pass that did not take it —
the "right number under the wrong noun" shape, one field over. So a reply
that leaned on a pinned figure ships the figures WITHOUT the stamp, and the
client withholds every percentage when the stamp is absent. `vendor` is
exempt by construction, not by convenience: `source` is non-null on every
row, so that fraction is 1 on any date and no stamp can be wrong about it.

## n196-applied-hasstatedpay-out-hasstatedpay

Above: `if (applied.hasStatedPay) out.hasStatedPay = liveOr(cov.salaryText, MEASURED_COVERAGE.hasStatedPay);`

THE FRACTION FOLLOWS THE PREDICATE. hasStatedPay binds the verbatim pay
field, so the number under it is salaryText's — cov.hasStatedPay counts the
annualised column and would understate this control's reach by ~4.6 points
(23.7% against 28.3%, both read live 2026-09-27) while sitting directly
under a count taken with the wider predicate. A coverage pass written by a
bundle older than this one carries no salaryText, and that is exactly what
the pinned fallback is for: it ships the figure WITHOUT the stamp, and the
client withholds every percentage when the stamp is absent, so the deploy
window degrades to silence rather than to the wrong column.

## n197-applied-country-typeof-cov-country

Above: `if (applied.country && typeof cov.country === "number") out.country = cov.country;`

Country was the one filter of the four with no caveat, and it is the
thinnest on several vendors. Teamtailor was cited here as stating a
country on 0 of its 10,412 rows; that number was real but the cause was
ours — the RSS carries tt:city and tt:country on every item and the
parser dropped both. Fixed 2026-08-25; the rows resolve a country as they
re-ingest, so do not quote the zero as a vendor property. Measured the
same day, 156,672 of 559,854 servable rows (28%) still name no country,
so filtering to one does silently drop them — which is what this
disclosure is for.

## n198-req-method-get

Above: `if (req.method === "GET") {`

GET sitemap route — the ONE crawler-facing surface this function serves.
Google accepts cross-host sitemaps when robots.txt on the target host
references them, which resumebooster.work's robots.txt now does. Each
page lists up to 10,000 posting deep links (/jobs?job=<id>) restricted to
rows with a COMPANY-STATED posting date inside the serving window — the
same honesty bar the maxAgeDays filter uses; discovery-time freshness is
never presented to a crawler as a posting date. Page 0 with no results
still returns a valid empty urlset (never a 500 to a crawler).

## n199-days

Above: `const days = Math.min(Math.max(Number(body.days) || 7, 1), 90);`

MAKES THE TELEMETRY VERIFIABLE FROM OUTSIDE, which it otherwise is not.

get_search_quality is granted to service_role only, and the two tables
behind it are RLS-locked with no policy — correctly, because they hold
visitor behaviour. But that combination meant the one check that
matters ("is it actually recording?") could not be run with the anon
key, and a telemetry table nobody can read is indistinguishable from a
telemetry table that records nothing. That is the exact failure this
feature exists to prevent, so it would have been an absurd one to ship.

This reads through the service-role client and returns ONLY the
aggregate — the same line the closure log draws. RAW QUERY STRINGS ARE
DELIBERATELY NOT EXPOSED HERE: people type their own names, employers
and locations into a search box, so the aggregate over raw query text
stays service-role-only. Counts and rates carry no such risk.

## n200-slice

Above: `const SLICE = 200;`

NO ONE CHECKED THAT AN APPLY LINK RESOLVES. Feed membership is blind
to host rot: 23,347 servable postings sit on hosts the EMPLOYER owns,
and when one lapses the feed keeps listing the job while the board
serves a button that cannot load — the 233-posting Recruitee incident,
as a standing class. This sweep is DETECTION ONLY. The verdict traps
are measured and severe (Workday answers 200 with a 136-byte stub;
vendors ship "no longer available" in i18n bundles on LIVE pages;
403/429 is a CDN), so: any HTTP response means the host is ALIVE, and
only DNS/TLS/network failures count against it. It never demotes a
row and never touches missing_since.

Bounded per tick — a cursor walks ~200 hosts an hour, so a full cycle
over the ~1,400 exposed hosts completes in a few hours and the tick
never approaches the function's wall clock. The host census comes from
an RPC because the group-by cannot be expressed over PostgREST.

## n201-seen

Above: `const seen = new Map<string, { host: string; postings: number }>();`

PAGED, because the 1,000-row ceiling is the SERVER's, not the
client's. The first live tick returned exactly 1,000 of the
~1,400-host census and I read that as supabase-js's un-ranged
default, so range(0, 4999) went out as the fix. It changed nothing:
PostgREST enforces its own max-rows on every response, RPCs
included, and asking a 570k-row table for 2,000 rows still returns
1,000 (measured 2026-08-24). A round number that survives a fix is
the fix being wrong, not the number being real. The bottom ~400
hosts — the smallest employers, the ones likeliest to let a domain
lapse — were still never swept.

Pages until a short one arrives. The RPC's ORDER BY carries a
tiebreak on host so the page boundary is deterministic; the Map
dedupes anyway, because a census that shifts under paging must
cost a duplicate probe, never a silently skipped host.

## n202-try

Above: `try {`

ONE BAD READ MUST NOT COST THE WHOLE ANSWER.

2026-09-01: status began answering a bare 500 while every serving path
was healthy — search, faceted list, counts and vendor filters all fine,
the site rendering 819,374 openings. This endpoint's PRIMARY job is
answering "did my deploy land?", and it was failing at exactly that
while the board it reports on was working perfectly. Worse, the generic
catch discarded the reason, so the one endpoint built for diagnosis
became undiagnosable.

It gathers ~30 reads plus post-processing; anything that throws takes
all of it. The deploy identity is CONSTANT — baked into this bundle,
needing no database at all — so it is answered first and separately.
A failure below degrades to that skeleton plus the reason, at 200,
because a status page that cannot say what is wrong with it is worse
than one that says only a little.

## n203-withdeadline-client-rpc-get-freshness-stats

Above: `withDeadline(client.rpc("get_freshness_stats"), 2_500),`

Measured re-verification age distribution (null until the migration lands)
BOUNDED (2026-07-26): these two aggregate over the whole 569k-row
postings table while the sweeps write to it continuously, and status
had degraded to a measured 17-19s — long enough that the heartbeat's
own deploy check ABORTED and reported the board unreachable. That is
a false alarm on the one endpoint whose job is answering "did my
deploy land?", and a slow status also masks a real outage behind an
ambiguous timeout. Both fields are already documented as null-until-
available and every consumer renders nothing for null, so a slow
stat is simply omitted rather than allowed to stall the answer.

## n204-withdeadline-client-rpc-get-date-coverage-2

Above: `withDeadline(client.rpc("get_date_coverage"), 2_500),`

Per-vendor stated-date coverage. This deadline went 2_500 → 8_000 on
2026-08-03 to clear a ~3.5s aggregate over 562k rows, and by
2026-08-06 that aggregate had outgrown its own 20s STATEMENT timeout
and failed outright on every call — so the 8s bought nothing and cost
this endpoint an 8-second floor on every request. Status measured
8.5-26s, which is what pushed the heartbeat's 15s deploy check into
flapping "board unreachable" at a healthy board.

Both stats are precomputed into job_board_stats_rollup every 15
minutes now, so the RPC is a single indexed row read and the deadline
goes back to being a guard rather than a budget. The result is still
cached below, so a bad day degrades to "slightly stale" not "gone".

## n205-client-from-job-board-meta-select-v-updated

Above: `client.from("job_board_meta").select("v, updated_at").eq("k", "board_flow_cache").maybeSingle(),`

INTAKE vs OUTTAKE — the one number that says whether the board is
growing or quietly draining. Every count on the serving path caps at
10,000 for a filtered query, so asking the API for "postings added in
the last day" and "in the last week" BOTH returned 10,000 — the cap,
not a measurement. There was no way to see it.

Deadlined like the coverage RPC and simply OMITTED when slow: a
status payload that waits on an analytics count is a status payload
that stops answering the question it exists for.

NOW READ FROM CACHE, NOT COMPUTED PER REQUEST — because withDeadline
DOES NOT CANCEL THE QUERY. It is a Promise.race: losing the race
abandons the JS promise while the statement keeps running server-side
to its 15s statement_timeout. So the 3_000 -> 8_000 change earlier
today bought nothing except a longer wait for a value that was still
usually null, and every status call went on paying for a full 572k-row
count regardless.

Measured 2026-08-17 22:07Z during a live board outage: freshness,
dateCoverage and boardFlow were ALL null in the same payload, meaning
all three analytics RPCs blew their deadlines — and all three still
ran to completion in Postgres. The board was paying full price for
three heavy scans per status call and displaying none of them, while
ordinary reads timed out and the ingest failed with (db-write).

The pass computes it once and stores it, exactly as date_coverage
already does. A status call now costs one indexed meta read.

## n206-client-from-job-board-meta-select-v-eq-k

Above: `client.from("job_board_meta").select("v").eq("k", "catalog_highwater").maybeSingle(),`

The stale-bundle guard's own state. It is a STRICT less-than against
this number, so a mark ONE above the real catalog does not degrade
the orphan prune, it disables it — and the only evidence was a log
line nobody reads. That shipped on 2026-08-24 (31,709 clamped
against a 31,708 catalog) and could not be confirmed from outside at
all, because job_board_meta is service-role-only. Published here as
a derived boolean plus the two numbers behind it.

## n207-client-from-job-board-stats-rollup-select-v

Above: `client.from("job_board_stats_rollup").select("v, computed_at").eq("k", "desc_coverage").maybeSingle(),`

desc_coverage: written by refresh_job_board_stats (20260903210000,
predicate re-issued in 20260904090000) beside date_coverage. Per
vendor, how many live postings hold a stored description at all —
the complement of what the desc sweep selects, so total - described
is that vendor's sweep backlog. Not "scoreable": the scorer's own
longer bar is not one any writer selects on, and counting against
it opened every description on the board each tick.

## n208-client-rpc-get-closure-population-maybesingle

Above: `client.rpc("get_closure_population").maybeSingle(),`

THE POPULATION EVERY CLOSURE NUMBER ON THIS BOARD IS DRAWN FROM.

A statistic that names no population is a claim about employers made
from whichever boards happened to be readable, and until 2026-09-08
that was a small minority of inventory with nothing anywhere saying
so. This is the one artefact that states it, so it ships beside the
numbers rather than waiting for someone to run it by hand: aggregate
counts only, one function call, cached at the same cadence as the
rest of this bundle.

## n209-array-isarray-datecov-as-data-unkno

Above: `if (Array.isArray((dateCov as { data?: unknown }).data)) {`

SELF-POPULATING CACHE. Whenever the live query beats its deadline, its
answer is stored, so the next caller that does not is served real
numbers with an age rather than a null. No cron to schedule, nothing
else to keep alive — the cache is a by-product of the reads that
already succeed, and the first successful read after a deploy fills it.

Fire-and-forget: a status page must never fail because it could not
write its own cache.

## n210-chainwatchdog

Above: `const chainWatchdog = await maybeRekickDeadChain(client);`

THE DEAD-CHAIN WATCHDOG IS EVALUATED HERE ON PURPOSE. Inside the
refresh path it runs only from a hop that just stamped its pulse, so
it can never see a dead chain there; status is the path monitors hit
while nothing else runs. One read of three meta rows; a kick only on
"rekick", throttled by its own stamp, declined at the child's slice
lock if the chain was alive after all. The decision it just made is
published beside the last kick it sent.

## n211-questionvendors-realquestionvendors

Above: `questionVendors: realQuestionVendors(),`

WHICH VENDORS THIS BUNDLE CAN HARVEST REAL QUESTIONS FOR.

Derived from the automation facts rather than hand-maintained, so it
moves on its own whenever that map does. It exists because
BUILD_VERSION could not answer "did the edge functions deploy?": it
is keyed to sources.ts and to the bootstrap lane, so a change that
touches neither leaves it identical — the status field read the same
whether the new code had shipped or not, which is not a measurement.

Bumping BUILD_VERSION to make it one would be worse: it would
re-trigger the bootstrap queue across 28k boards to answer a
yes/no question.

## n212-applyagent-aameta-data-v

Above: `applyAgent: aaMeta.data?.v`

HAS THE APPLY AGENT EVER RUN, AND DID THE SCHEDULE RUN IT?

apply-agent is scheduled hourly at :23, but the cron body is wrapped
in `WHERE EXISTS (... vault.decrypted_secrets WHERE name =
'apply_agent_maintenance_key')`. With no key in the vault it fires
NOTHING — deliberately, because a cron that collects a 403 twenty-four
times a day is indistinguishable from a working one until somebody
reads the logs.

The cost of that good decision was that "armed and working" and
"never armed at all" produced byte-identical evidence from outside:
no packets, no errors, nothing. Answering it required the Supabase
dashboard, which is exactly the sort of question this endpoint exists
to make answerable without one.

READ IT LIKE THIS — four states, not two, and the first two are
different questions that a single `null` would have merged:
  key ABSENT from the response -> THIS bundle has not deployed
  key present, value null      -> deployed; apply-agent has not run
                                  since the stamping build shipped
  lastCronAt null, an hour on  -> the vault key is MISSING; the job
                                  fires nothing, exactly as designed
  lastCronAt recent            -> key present, schedule firing

lastCronAt only advances on a real cron firing. A hand invocation
must not be able to make the schedule look alive.

## n213-agentrunner-armeta-data-v

Above: `agentRunner: arMeta.data?.v`

THE RUNNER'S OWN SCHEDULE. agent-runner is gated as of 2026-08-03.1,
and its cron is the only caller that holds a key — so if that
schedule breaks, nothing else changes shape. No queued picks looks
identical to a quiet night. This is the only thing that separates
them, and it is anon-readable on purpose: the question "is the agent
still being run" should not require a service key to answer.

Deliberately NOT reporting senderOnline or resumesBucket here. The
runner has no sender and touches no bucket; the stamp omits them
rather than defaulting, so this reports what the job actually knows.

## n214-paymentreconcile

Above: `paymentReconcile: (() => {`

THE PAYMENT SAFETY NET. reconcile-stripe finds customers who PAID and
received nothing, and emails the owner to recover them. It emails only
when it finds something, so a healthy day and a dead cron are both
silent — which made the highest-stakes job here the least observable.

NOT `? … : null` like the two blocks above. This object is always
emitted, because the state worth shouting about is "has never run",
and a block that disappears in exactly that case would report the
alarming answer by vanishing. Nulls inside a present object say "never
happened"; an absent object says nothing at all.

## n215-lastcronat-cronat

Above: `lastCronAt: cronAt,`

Written by reconcile_stripe_tick(), which pg_cron calls.

THIS COMMENT USED TO CLAIM THE VALUE COULD NOT BE FORGED, and it
was wrong for a day. The design intent was right — a stamp
written from inside the database rather than derived from a
request body, precisely so an open endpoint could not fake it —
but the implementation revoked the function from PUBLIC only.
This database grants EXECUTE to anon on newly created functions,
and a grant held directly by anon survives a PUBLIC revoke, so
`POST /rpc/reconcile_stripe_tick` returned 204 to an anonymous
caller and stamped this field. Measured 2026-08-08; closed in
20260808134902 by revoking anon and authenticated BY NAME.

Now genuinely unreachable over HTTP. Stated as a fact that was
checked rather than one that was assumed, because it was
assumed once already.

## n216-sendable

Above: `sendable: (() => {`

HOW MUCH OF THE BOARD THE AGENT CAN ACTUALLY SUBMIT TO, computed
from the same live per-vendor totals above rather than asserted.

Three separate code comments claimed "about 2%" and "~3.4%". Both
were written when three adapters existed; there are four, and the
real figure measured 2026-08-03 is 5.3%. Nobody lied — the number
simply had no way to move, which is what a hardcoded measurement is.
Engineers reason from these comments when deciding whether the
sendable boost is worth its query, so a 2.6x understatement is a
decision input, not a cosmetic error.

The ceiling itself is structural and documented in worker/RECON.md:
every other major vendor was measured and refused for a stated
reason — BambooHR reCAPTCHA v2 visible on 24/24 pages, Ashby v3,
Lever/Rippling/Workable bot detection, SmartRecruiters 403 headless
AND headed, Oracle re-checked. Raising it means defeating bot
protection, which is not on the table.

## n217-slicestats-slicestatsrow-data-v-null

Above: `sliceStats: (sliceStatsRow?.data?.v ?? null),`

Work-mode recovery lane. `filled` is the number that matters and the
reason it is published: this lane exists because the structured
remoteType parsing could not reach rows that already had a
description, and a lane that walks its whole corpus filling nothing
looks identical to one that never ran. cursor advancing with filled
at 0 is the honest reading of "scanning, nothing to state here".
THE ROTATION'S ONLY WINDOW. Deep cursors say where each capped board
stopped last pass. job_board_meta is not anon-readable, so before this
existed the rotation could only be judged by watching row counts and
guessing — and on 2026-08-25 I read two samples eleven minutes apart
on a system whose passes run ~90 minutes, concluded it was pinned, and
parked a rotation that was in fact climbing (CVS 500 -> 630 within the
hour). `boards` is the count still filling; an entry is deleted when
its board wraps, so a healthy steady state trends DOWN, not up.
Live slice timing (EMA per phase) — the number every rotation-tuning
decision needs and used to require two hand-run cursor snapshots.

## n218-laps

Above: `laps: (() => {`

WHICH BIG BOARDS CAN PRODUCE A CLOSURE AT ALL.

A board over MAX_POSTINGS_PER_VISIT proves absence only across a
completed lap (see deepLaps). `proven` is the number that have
actually completed one — the honest population for any statistic
computed from closures on windowed boards. `tracking` minus
`proven` are boards being walked that have not yet closed a lap
and can therefore report nothing, and `disarmed` are laps that
lost an epoch write and will re-lap before they can prove
anything. None of these is "the employer had no closures".

## n219-filtercontract

Above: `filterContract: (() => {`

Posted-date backfill liveness. Added 2026-07-28 after the sweep sat
at bamboohr 0% dated for 2h15m on a confirmed-live deploy and there
was NO way to tell which of three very different causes it was:
already-stamped-complete (so not due), a chain alive but dating
nothing, or a kick that never fired. job_board_meta is RLS-hidden
(42501 for anon), so diagnosing it needed dashboard SQL — the exact
gap embedSweep was added to close for the embedding chain.
`due` mirrors the kick's own predicate, so this cannot drift from it.
FILTER CONTRACT — the self-check on every page, plus the scheduled
audit. Published here because job_board_meta is RLS-hidden (anon gets
42501), so without this the sensor exists and nobody can read it.

## n220-chainkick

Above: `chainKick: (() => {`

THE RETRY LANE, VISIBLE. `failing` is the pre-dormancy backlog — boards
that failed and are waiting out their backoff — and `lastRetryLane` says
whether the lane actually ran and how many it took. Without both, a p95
that does not move has two indistinguishable causes.
CHAIN LIVENESS — the thing this endpoint could not answer.

`cursor` and `lastSliceAgeMin` look identical whether slices arrive
from a self-sustaining chain or from one cron kick every ten minutes,
which is a 5-8x throughput difference reported as the same numbers.
Deciding which it was cost an hour of cursor sampling, and the first
answer was wrong. Now it is one read: `outcome` says what happened to
the most recent kick, and `ageMin` says whether kicks are still
happening at all. "continued" and fresh = the chain is alive.

## n221-boardflow

Above: `boardFlow: (() => {`

Which hiring systems state posting dates, and for what share of
their postings — the measured basis behind every age stat.
WHY THIS WAS NULL FOR WEEKS. The deadline was 2_500ms and the query
measures ~3.5s over 562k rows, so it timed out on every call —
and withDeadline returns { data: null } for a timeout, for an error,
and there is no separate signal for an empty result. One value, three
states, and the one that was actually happening was invisible.

Now: live if it answers, last good cached copy WITH ITS AGE if it
does not, and a stated reason if neither exists. A number with no age
beside it cannot be told from a fresh one, so the age is not optional.
"live" now means "read the rollup successfully", NOT "computed this
instant" — the aggregate runs on a 15-minute cron. Reporting age 0 for
it would be the same false-freshness move this block exists to
prevent, so the age comes from the rollup's own computed_at.
Intake vs outtake over the last 24h. Null when the RPC was slow or
the migration has not landed — never a zero, which would read as
"nothing came in today" on a board taking thousands.

## n222-typeof-body-chainkey-string-bod

Above: `if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {`

The audit I ran by hand on 2026-07-29, turned into something that runs
itself. It found four real defects that 1,010 unit tests were green
through, because every one of them lived in the gap between the code and
the database: a case-folded filter the count didn't fold, a column the
mapper emitted and the SELECT never fetched, an array shape the gate
never inspected, and a page cut that dropped rows. None of those are
visible to a test that imports a module — only to one that asks
production a question and checks the bytes that come back.

Two things it deliberately does NOT do:

1. It does not rebuild the query. Each case is a real HTTP request to
   this function's own `list` action, so it exercises the same path a
   user hits — normalisation, filters, count, grouping, mapping. An
   audit that reimplemented buildQuery would agree with itself and prove
   nothing, which is the same error as a mapper test that passes while
   the column is missing from the database.

2. It does not use count=estimated for recall. PostgREST's estimate
   returned a fabricated uniform figure on this table (22.1% where exact
   showed 100%), so a recall comparison built on it would invent
   disagreements. Exact only, with the serving rule applied.

## n223-probe

Above: `const probe = async (payload: Record<string, unknown>) => {`

THE AUDIT SPENT A DAY REPORTING ITS OWN THROTTLING AS FILTER FAILURES.
2026-08-17: every finding it produced was kind "request-failed" with
"RateLimitError ... for trace" — the GATEWAY refusing the audit's own
burst of self-calls, recorded as if the filters were broken. A
guardrail that is red every day trains everyone to ignore the day it
is right. So: one paced retry honouring Retry-After (capped — a lying
header must not stall the audit), and a residual 429 is reported as
`throttled`, a different kind from a filter defect, because "the
gateway was busy" and "the board lies about filters" must never be
the same alarm.

## n224-c-col-c-val-r-body-countcapped

Above: `if (c.col && c.val && r.body.countCapped === true) {`

RECALL — only where the count is exact. A capped total is honestly
"10,000+", so comparing it to a true figure would manufacture a
finding rather than detect one.
A capped total was skipped entirely, so a count too LARGE by more than
the cap went unreported — including the shape of the founding defect,
where a filtered page published the whole catalogue's figure. Capped
still cannot be compared to an exact number, but it CAN be falsified:
if the true count is below the cap, the total had no business being
capped at all.

## n225-hopversion

Above: `const hopVersion = Number(body.rulesVersion);`

A CHAIN THAT STRADDLES A DEPLOY MUST DIE, NOT CONTINUE. Measured
2026-08-23: the v8 sweep was mid-flight when v9 deployed; its
post-deploy hops ran the new code, which stamped the progress row
with the NEW version — so the chain kept its mid-alphabet cursor,
judged only the late ids under v9, and would have stamped the
completion row as a finished v9 sweep with everything before
"personio:" never seen by the v9 rules. Every hop now names the
version its chain started under; a hop landing on newer code
aborts silently and maybeKickMaintenance restarts from "" under
the current rules. A hop with a cursor but no version is a
pre-provenance chain — same verdict.

## n226-await-client-from-job-board-meta-upsert

Above: `await client.from("job_board_meta").upsert(`

Liveness + resume point. Measured 2026-07-25: the v5 sweep chain died
silently ~15.5k rows in (waitUntil self-invocation is best-effort, not
guaranteed), and with no stamp a dead chain looked identical to a live
one — so the re-kick waited hours and then STARTED OVER. Stamping the
cursor each invocation lets maybeKickMaintenance both detect death
within minutes and resume from the frontier instead of rescanning.
Rows before the cursor were already judged by the CURRENT rules
(updates remove them from the 'other' pile; survivors stay judged), so
resuming is correct, not just cheap.

## n227-typeof-body-chainkey-string-bod

Above: `if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {`

Date the undated (see POSTED_BACKFILL_VERSION): re-fetch each board's
official feed once and stamp posted_at from the feed's own date. Two
phases — greenhouse (first_published from the list API), then workday
(~79k rows ingested before dated-ingest shipped; the CXS relative age
via the production fetcher+normalizer). Rows the feed no longer lists
(or that carry no date) stay NULL; the id cursor walks past them and
the completion stamp stops re-scans.

## n228-phase

Above: `const phase = ["greenhouse", "rippling", "pinpoint"].includes(String(body.phase))`

Phase order is cheap-first (2026-07-26 fix): bamboohr → rippling →
greenhouse → workday. It used to START with greenhouse and put the
per-posting phases after the workday wall (~75k rows at 8 boards/hop),
and the chain never survived long enough to reach them — measured in
production as bamboohr 0% dated of 43,813 rows while workday sat at
75%. The bounded phases now run first, so a chain that dies mid-wall
has already banked the cheap wins — and the hop-persisted cursor below
means a revival resumes inside the wall instead of at the start.
The accepted list and the type must move together: `deno check` caught
the pinpoint branch as unreachable ("no overlap") when only the type
was widened, which is the whole reason edge functions carry their own
gate — tsc does not see this directory.

## n229-cursor

Above: `let cursor = typeof body.cursor === "string" && body.cursor.startsWith(`${phase}:`) ? body.cursor : `${phase}:`;`

A cursor belongs to the phase that produced it. Ids are
`source:token:externalId`, so a cursor from another source can only
ever sort the whole phase out of range — silently, as an empty page
that reads exactly like a finished one.

AND IT SEEDS TO THE PHASE PREFIX, NOT "". This one line is why the
backfill did no work for 4.9 days. With an empty cursor the draw below
runs `source=eq.X & posted_at is null ORDER BY id LIMIT 500` with NO id
predicate, so Postgres cannot use the primary key for a bounded range
scan and walks from the top of a 594k-row table. Measured live on
bamboohr: 3.1-3.3s against a ~3s statement timeout, so it returned
57014 roughly two times in three. With `id > 'bamboohr:'` the identical
query returns in 0.23s — 13x — because the id predicate makes it a
range scan. Tokens are never empty, so the prefix sorts below every row
of the phase and excludes nothing (first row back is
"bamboohr:100percentgroup:26").

The `if (cursor)` guard on the draw means an empty string disables the
predicate entirely, which is exactly the branch that was firing.

## n230-lastcursor

Above: `let lastCursor = "";`

`<`, NOT `<=`. This was an INFINITE LOOP and it is why bamboohr and
rippling sat at 0% dated while greenhouse reached 99.2%.

Trace with IDS_PER_HOP = 120: iteration 1 consumes exactly 120 ids,
the 121st row trips `scanned >= IDS_PER_HOP`, sets brokeEarly and
breaks. brokeEarly then SUPPRESSES the `exhausted` flag below (by
design — a budget break mid-page must leave the remainder for the next
hop). The while test is now `120 <= 120`, still true, so it draws
again; iteration 2 breaks on its FIRST row without advancing `scanned`
or `cursor`; and it spins forever, issuing one 500-row query per turn
until the isolate is killed.

Everything measured follows from this and nothing else does: the hop
stamped, the draw never errored, no vendor call was ever made, no row
was ever written, the chain never fired, and the after-draw beacon
never printed. The two phases that use this branch (perPosting =
bamboohr, rippling) are precisely the two vendors at 0% dated;
greenhouse takes the board-based branch and worked all along.

The `noProgress` guard is the belt to that braces: the board-based
branch can wedge the same way if a whole 500-row page is new tokens
beyond BOARDS_PER_HOP, because those rows `continue` without advancing
the cursor. A page that advances nothing can never advance anything.

## n231-await-client-from-job-board-meta-upsert

Above: `await client.from("job_board_meta").upsert(`

Surface it. A thrown draw error left NO trace anywhere anon-visible:
the hop stamped, died, and the next kick 10 minutes later repeated
the whole thing, which is indistinguishable from "ran and found
nothing to do". Measured 2026-07-28: 40 consecutive samples over
2h40m with bamboohr dated = 0, while the draw returns 500 rows in
0.23s and 6/6 vendor detail probes answered 200 with real dates —
so the failure is inside the hop and nothing recorded which line.

## n232-drawfailed-true

Above: `drawFailed = true;`

Do NOT throw. A draw timeout used to kill the hop, and because the
resume stamp pins the chain to its phase, every kick then retried
the same doomed query forever — leaving the EARLIER phases' rows
untouched behind it.

Measured 2026-07-29: greenhouse times out at 3.2s while the
identical query shape on rippling returns in 0.34s. The reason is
the opposite of intuition — greenhouse is 99.2% already dated, so
`posted_at IS NULL ORDER BY id LIMIT 500` has to scan all 59,878
rows to find its 482 matches, while rippling's undated rows are
dense enough that the planner fills a page immediately. A phase
gets EXPENSIVE precisely as it approaches done.

So a draw failure means "this phase can give no more", not "the
sweep is over": mark it exhausted and let the normal path advance
to the next phase (or complete the sweep, which re-arms in 7 days
and starts again at bamboohr). The note above survives for the
operator either way.

BUT IT MUST NOT COUNT AS A COMPLETED SWEEP. That reasoning was
written for greenhouse, which is 99% dated and genuinely near-done.
Applied to bamboohr — 20% dated, ~35,916 undated rows, 77% of the
whole backlog — it declared the largest phase exhausted on hop 1
having scanned ZERO rows, then wrote a completion stamp recording
`backlogAtSweep: 43,118`. That field is documented as the
IRREDUCIBLE RESIDUE — rows proven undatable — and it became the
floor the +5,000 growth re-arm measures against. So the sweep
disarmed itself for 7 days on the strength of work it never did,
and each repeat would raise the floor further: a ratchet.

A phase that could not be READ has proven nothing about whether its
rows are datable. drawFailed keeps the completion stamp away.

## n233-beacon

Above: `const beacon = async (n: string) => {`

Progress beacon, written BEFORE any vendor call and again as the loop
advances. Two rounds of end-of-hop instrumentation reported nothing,
because the hop never reaches its end: measured on 2026-07-28.12, note
stayed null while the draw is proven good (500 rows in 0.23s, and the
draw-error path writes directly and never fired) and ZERO writes have
ever landed (0 dated across bamboohr, rippling and pinpoint, all
count=exact). A diagnostic that only speaks at the finish line cannot
describe a run that never finishes.

## n234-psrc

Above: `const psrc = JOB_SOURCES.find((s) => s.source === "pinpoint" && s.token === tk);`

ONE BOARD FETCH, THEN THE POSTING PAGES.

postings.json carries no date — that part of the 2026-08-08 note
was right, and it is why this phase did not exist. What it missed
is that every Pinpoint posting PAGE carries an employer-stated
`datePosted` in its schema.org JSON-LD, and the list payload
already hands us the URL. 9,805 rows sat at exactly 0% dated on
that inference.

Same shape as the description sweep: fetch the board list once to
map id -> url, then walk only the ids this hop drew.

## n235-await-client-from-job-board-meta-upsert

Above: `await client.from("job_board_meta").upsert(`

END-OF-HOP stamp, written DIRECTLY rather than forwarded through
chain(). The previous commit only passed the outcome to the NEXT hop —
which is useless for diagnosing a chain that never reaches hop 2, and
that is the exact failure being diagnosed. A diagnostic whose delivery
depends on the thing it is diagnosing reports nothing: measured
2026-07-28 on 2026-07-28.10, note stayed null while the sweep sat at
bamboohr 0% dated.

What note=null DID prove is worth keeping: the draw-error path writes
its note directly, so a null note means the draw did not throw —
matching the direct measurement of 500 rows in 0.23s. The failure is
therefore in the vendor/update stage, which this stamp now records.

## n236-drawfailed-scannedtotal-0

Above: `if (drawFailed || scannedTotal <= 0) {`

backlogAtSweep is the IRREDUCIBLE RESIDUE — what remains undated after
a full sweep, because those rows carry no vendor date or are no longer
listed. Recording it here is what lets the growth re-arm measure new
intake instead of re-running forever against rows already proven
undatable. Null (rollup unreadable) simply omits the key, and the next
sweep is then timer-driven, which is the behaviour before this existed.
A SWEEP THAT SCANNED NOTHING IS NOT A COMPLETED SWEEP.

This stamp was unconditional, and that is how the lane disarmed itself
for 4.9 days: the terminal phase's draw timed out, `exhausted` was set,
control fell straight through to here, and a run with scannedTotal:0
and datedTotal:0 wrote `{version, sweptAt, backlogAtSweep: 43118}`. The
stamp is indistinguishable from a real sweep, so postedBackfillDue went
false for a week AND the growth floor was poisoned with 43,118 rows
nothing had touched.

This file already documents the identical failure for the name-sync
lane: "the stamp was UNCONDITIONAL. A run that reached the end having
failed every single update still wrote its version and was never
retried." Same treatment here — leave `version` unwritten so
postedBackfillDue stays true and the next kick retries.

## n237-sources-fv-sourcesfacet-typeof-fv-sourcesfa

Above: `sources: (fv.sourcesFacet && typeof fv.sourcesFacet === "object" && !Array.isArray(fv.sourcesFacet))`

THE PER-SOURCE INVENTORY, board-wide, under the SAME stamp as the
categories above (and the same carried flag when the pass failed).
Exact counts from jsonb_object_agg under both serving predicates —
never the 10,000 list cap, so no `capped` rides with them. Deploy
window: a head row written before this build has no sourcesFacet,
and the reply says NULL rather than {} — null is what the dropdown
reads as "print nothing", an empty map would read as twenty zeros.

## n238-t-entry

Above: `const t_entry = Date.now();`

THE CLOCK STARTS HERE, NOT INSIDE serveList.

reqStart was assigned AFTER this meta read, so the ~1.3-1.6MB facet row
fetched on the line below was outside every number the function
publishes about itself. Measured against a probe that does the same read
and nothing else, a median ~958ms of a list request was invisible —
tookMs and phaseMs were reporting roughly a quarter of real server time,
and two previous latency fixes were aimed with that instrument.

## n239-meta-deadline-ms

Above: `const META_DEADLINE_MS = 3_000;`

THE SMALL ROW FIRST — see the writer. `refresh_head` carries exactly what
this path reads, with companiesFacet truncated to the top 200 and the
true employer count stored beside it.

FALLING BACK ON companiesCount, not on the row's existence, and that is
the whole safety of the deploy window: between this code shipping and
the next refresh pass writing the row, refresh_head is absent — and if a
partially-written or older-shaped row ever appeared, deriving the count
from a 200-row slice would publish "200 employers" as a fact. Requiring
the explicit number means the only rows accepted are ones that carry it.
BOUNDED AND MEASURED, because this read is pure decoration and was
neither. MEASURED 2026-08-30 during the saturation incident: a
{limit:1} call took 30,728ms of which page_query was 2,015 and
attachRecheckedAt 15,104 — leaving ~13,600ms attributed to NOTHING.
These two reads are the only unmarked awaited I/O on that path, they
carry no deadline, and db() authenticates as service_role, which has no
statement_timeout — so a meta read can hang for thirteen seconds and
still return successfully, with no error and no log line.

Nothing in the ROWS depends on this row. Everything it feeds is a
nice-to-have — the headline total, trackedTotal, the category and
employer facets, refreshedAt, the coverage disclosure — and this file
already states the rule three lines from where it consumes it: "A
missing headline number must degrade the HEADLINE ('many jobs'), never
the page." serveList handles an absent meta end to end (safeMetaTotal
null publishes countUnavailable, facets come back empty). The read was
simply never held to the rule it feeds.
BOUNDED, MEASURED — AND WITH A BUDGET ABOVE THE MEASURED MEDIAN.

The first version of this set the deadline to 800ms. The comment forty
lines up records the median for this very read as ~958ms. So it expired
on a HEALTHY board, on most requests, and the consequences compounded:
meta went null, the page lost its headline, its employer count, its
categories and refreshedAt (measured live: totalAllCompanies 0,
companiesCount 0, categories 0) — and the "no meta means first boot"
branch below then fired a FORCED refresh on every one of those
requests. Traffic became load: more visitors, more forced passes, a
slower database, more expired reads. page_query went back to 27.5s.
Setting a timeout below the number the file already published as the
median was the whole mistake.

3s is well clear of that median and still a bound: it exists to stop a
hung service_role read (no statement_timeout) from holding a page for
thirteen seconds, which is the failure it was added for.

## n240-metatimedout-waituntil-runrefresh-clie

Above: `if (!metaTimedOut) waitUntil(runRefresh(client, true));`

A SEED ONLY WHEN WE KNOW THERE IS NOTHING TO READ.

`!meta` alone is not that knowledge — it is also every read that
expired. runRefresh(force=true) bypasses the slice lock, so firing it
from the serving path on a slow database means one forced pass PER
REQUEST. Gated on metaTimedOut, this fires only on a genuine empty
answer (true first boot), and a struggling board simply serves a page
with no headline instead of organising its own stampede.

## n241-resumetext

Above: `const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";`

WHAT THE RÉSUMÉ IS ASKING FOR, BEFORE WE ASK THE DATABASE ANYTHING.

fit-batch can only score ids it is handed, so a dropped résumé used to
rank the window the board had already loaded — the newest 60 of eight
hundred thousand — and never went looking. This turns the résumé into
the query the reader would have typed, and the ordinary search does the
retrieving from there.

Pure CPU: nothing is read, written or logged, and the résumé does not
outlive the isolate. That is also why it carries no rate-limit round
trip — it is cheaper than the search it precedes.

## n242-minyears

Above: `const minYears = typeof (r as { min_years?: unknown }).min_years === "number" ? (r as { min_years: number }).min_years :`

Bounded input: computeFit walks the whole dictionary against the
text, and a 60KB HTML-laden description costs proportionally.
Everything the scorer needs is in the first FIT_DESC_CHARS.
min_years, like job-fit. This copy exists only for bundles that
have not reloaded since the scorer moved out, and it was getting
the retrieval fixes for free (shared module) while silently
missing the seniority demotion — a reader on an old tab would
have seen a job asking eight years ranked above one asking two.
The posting's PRINTED number, never experience_band, which is
partly inferred from the title.

## n243-typeof-body-chainkey-string-bod

Above: `if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {`

Feature 1: the four Greenhouse giants fetch WITHOUT content on the
refresh path (bulk htmlToText wedged the pipeline — see
LIGHT_DESC_TOKENS), so their postings land description-less. This
maintenance sweep fills the gaps using Greenhouse's PER-JOB endpoint
(tiny payloads) — never the 20-36 MB whole-board content payload,
which OOM'd/timed out when re-fetched per slice. It targets only
rows still missing a description, so after the initial fill the
daily delta is near-zero and transient per-job failures self-heal
(the row stays null and is retried next run). chainKey-gated.

## n244-const-data-seedmeta-await-client-from-jo

Above: `const { data: seedMeta } = await client.from("job_board_meta").select("v").eq("k", "embed_seed").maybeSingle();`

QUEUE SELF-SEED. The migration's one-shot seed INSERT (a full anti-join
in one statement) evidently never completed in the hosted migration
runner — measured live 2026-07-26: the sweep settling on "batch error:
canceling statement due to statement timeout", the signature of an
EMPTY fill queue pushing get_embed_batch into its heavy phase-2 walk.
So the seed happens HERE instead, in bounded chunks riding the same
paced chain: 2,000 candidate ids per hop by id-cursor, an .in() lookup
to skip already-present rows, plain inserts of the rest. No anti-join
ever runs on a request path. ~570k rows / 2k per ~5s hop ≈ 25 minutes
to fully seed, once. Harmless when the queue is healthy (one cheap
no-op read once done=true).

## n245-typeof-body-chainkey-string-bod

Above: `if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {`

Bulk description fill for the vendors whose text needs a PER-POSTING
fetch. Measured 2026-07-24: workday, smartrecruiters, bamboohr, oracle
and breezy held ~406k of the ~457k postings with no description — all
of them at exactly 0% coverage, because nothing had ever fetched them.
(backfill-desc above is a different job: Greenhouse giants that skip
content=true on the refresh path.)

Ordered NEWEST-FIRST so the postings people actually see fill first.
The `detail` read path fills anything a user opens ahead of the sweep,
so this is the tail, not the primary mechanism.

## n246-sel

Above: `let sel = client`

NEWEST FIRST ACROSS VENDORS, not one vendor at a time. The default
browse is the newest rows on the whole board; measured 2026-09-03 it
was 0-30% scoreable because a per-vendor sweep spends a whole chain on
vendor A before touching vendor B's fresh rows. The hop still records
which vendor's turn it is, but it fills the rows a reader will see
first, whichever feed they came from. `source` rides along so each row
reaches its own adapter.

## n247-salv

Above: `const salv: Record<string, unknown> = { ...placePatch };`

AN EMPTY BODY IS NOT AN EMPTY PAYLOAD. This was a bare
`continue`, which discarded a remoteType and a startDate that
had ALREADY been parsed out of the same response: the fetch was
paid for, the vendor stated both facts, and they were dropped
because a different field of that payload came back blank.

Salvage them on the way past. The row keeps its null
description and is retried for that next sweep — this only
stops the structured half being collateral damage.
THE WORK_MODE GUARD IS ABOUT THE ROW, NOT ABOUT THE VENDOR —
and conditioning it on the vendor made the loss DETERMINISTIC
rather than a race. `.is("work_mode", null)` is there to lose a
race against a concurrent writer; there is no race to lose when
the row ALREADY HOLDS a work mode, and this lane's select does
not filter on work_mode at all (structured-sweep's does, which
is why the two are not "on the same terms" however similar the
statements look). So for a row that already has a work mode and
whose payload states a remoteType, the guard matched zero rows
every time and took the country, the location and the date in
the same patch with it — no error, no count, nothing to see.
Measured size: 127 of 3,841 sampled Workday rows (3.3%) already
carry a work mode and 51 of 253 fetched payloads (20%) state a
remoteType, so the intersection is small — but it is a
certainty whenever it occurs, not a probability.

A row that already has a work mode also has nothing to gain
from this write, so the work mode is simply left out of the
patch and the guard goes with it. The gap-fill semantics are
unchanged: work_mode is still only ever written where there was
none.

## n248-vendorpay-row-salary

Above: `if (vendorPay && !row.salary) {`

THE PAY IS SALVAGED ON THE SAME TERMS, for the same reason: it was
already parsed out of this response and already gated, and dropping
it because a DIFFERENT field came back blank is the collateral
damage this branch exists to stop. Fill-only against the row's own
stored text, exactly as below — the vendor's node never overwrites
pay we already hold. Measured 0 of 356 captured pages are in this
state (a pay node with no usable description), so this is a branch
with no known population, written because the loss would otherwise
be silent and permanent: the row keeps its null description and is
retried, but nothing re-reads a discarded figure.

## n249-salarycountry

Above: `const salaryCountry = (placePatch.country as string | null) ?? (row as { country?: string | null }).country;`

THE CURRENCY IS CHOSEN BY THE COUNTRY THIS STATEMENT IS ABOUT TO
STORE, not the one it is about to replace. salary-extract maps a
bare "$" to a currency through BARE_DOLLAR_BY_COUNTRY (CA, AU,
NZ, SG, MX, HK…), so a row whose country is corrected in the same
update was having its currency picked by the value being
discarded — the same "a derived column moves with what it is
derived from" rule the region_code re-derivation two lines above
already follows, applied to the other derived column in this
patch.

## n250-statedpay

Above: `const statedPay = minedSalary ?? (row.salary ? null : vendorPay);`

THE VENDOR'S STRUCTURED PAY FILLS; IT NEVER OVERWRITES — and that
inverts the house precedence on purpose.

work_mode and country let a vendor's structured field replace our
text inference because those fields are machine-generated enums and
measured to agree with us where we are right. This one is not: the
schema.org MonetaryAmount on a Paylocity page is a SECOND free-typed
box in the same employer form as the prose, and its error rate is
HIGHER than our parse of the prose. Measured on 90 rows that already
state pay: 47 carry the node, 38 agree, and of the 9 that disagree
two carry a period label that is simply wrong where our stored parse
is right (Purcell Tire's body says 24 to 28 per hour and the node
says annual; Valley Behavioral's says 94,244.88 annually and the
node says 45.31 to 56.64 annual) and three disagree on the figures
in both directions with no arbiter — a ceiling in no sentence of the
posting (Alliance For Choice 27 stored, 32.4 in the node) and two
rows where the body says "up to" a number the node exceeds. Blanket
precedence would rewrite 5 of 47 already-stated ranges on the
strength of a coin toss.

So: only where the row holds no pay text and this hop's own prose
mining found none either. Both halves are needed — the mining is
this payload's answer, `row.salary` is the row's. Do not "fix" this
to match work_mode's precedence; the two fields are not the same
kind of claim, and this comment is the arbiter's absence written
down.

## n251-statedparse

Above: `const statedParse = statedPay ? parseSalaryStructured(statedPay, salaryCountry, { title: (row as { title?: string | null`

ONE PARSE FOR WHICHEVER TEXT WON, and it is the shared parser's, not
arithmetic of ours: the vendor hands us a pair and a period label,
and multiplying them here would reimplement detectPartTime, the
per-period magnitude windows and the currency rules in a second
place. The description from the SAME page is the part-time context —
7 of 90 measured hourly nodes carry a part-time or casual signal, and
without it a 22.00-per-hour part-time cashier is published as a
45,760 salary, which is the exact defect detectPartTime exists for.

## n252-wm

Above: `const wm = wmVendor ?? (row.work_mode ? null : detectWorkMode(row.location, row.title));`

Work-mode precedence: a vendor's own STRUCTURED field (workday
remoteType, arriving with the same detail payload) outranks
everything, including a previously stored inferred value —
workday rows only ever had text inference at ingest, so the
structured statement corrects them. Prose inference stays
fill-only: it never overwrites.
NO DESCRIPTION ARGUMENT. detectWorkMode's contract is stated at
normalize.ts:156 — "clear words only; descriptions are never
inferred from" — and every call site in normalize.ts obeys it.
This one passed the 4,000-char description as a third part, and
P_REMOTE is a bare /\bremote\b/, so one incidental use of the
word in prose tagged the posting remote. Live examples pulled
from employers' own payloads: "due to the remote location of this
site, there are no public transport links", "a major civil
earthworks project in remote Northern Saskatchewan", "the
technical component of remote cardiac device monitoring", and —
best of all — "There is no option for this position to be
remote." All four were being served under the Remote filter.

## n253-wm-work-mode-wm-remote-wm-remote

Above: `...(wm ? { work_mode: wm, remote: wm === "remote" } : {}),`

`remote` moves WITH work_mode, or the columns drift apart.
normalize.ts:1069 sets remote = (workMode === "remote") at
ingest and normalize.ts:17 documents it as "true only when
workMode is definitively remote". These re-derive writes
updated one and not the other, leaving 32/616 design,
43/479 security and 56/790 legal rows work_mode='remote'
with remote=false — invisible to the board's Remote filter.

## n254-typeof-body-chainkey-string-bod

Above: `if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {`

THE WORK-MODE RECOVERY LANE, AND WHY desc-sweep COULD NOT BE IT.

fetchVendorDetail already parses Workday's `remoteType` into a
structured work mode (:2596) and its `startDate` into a real posting
date. That code is correct. It simply cannot reach the rows that need
it, because desc-sweep selects

    .eq("source", vendor).is("description", null)

and writes through `.is("description", null)` as well. Both are right
for descriptions and fatal for everything else: the moment a posting
has a description — stored by the on-demand `detail` read at :2466, or
by a sweep that ran before the remoteType parsing existed — it becomes
permanently invisible to the only code that could state its work mode.

Measured 2026-08-12: work_mode is set on 29% of served postings.
Workday is 306,186 of them, half the board, and its LIST payload
carries no work-mode field at all — so every Workday row is
text-inferred or nothing, and the structured statement sitting in a
detail payload we already know how to fetch never lands.

KEYSET PAGINATION, NOT "SELECT WHERE STILL NULL". desc-sweep can
re-select its gaps every hop because filling one removes it from the
predicate. Here the predicate cannot be self-clearing: a posting whose
detail genuinely states no remoteType stays work_mode IS NULL forever
and would be re-fetched on every hop, so the lane would spend its
entire budget on the rows it has already proven have nothing to give.
A cursor over `id` visits each row once per pass instead.

## n255-passscanned

Above: `const passScanned = Math.max(0, Number(body.passScanned) || 0);`

Cumulative pass totals, carried THROUGH THE CHAIN body. Each hop's
progress stamp used to hold only that hop's numbers, and the done
branch then overwrote the row with a bare {doneAt} — so a completed
pass ERASED its own evidence. Measured 2026-08-12: the first real
pass finished in ~7 minutes and left {doneAt} and nothing else, which
made "the eligible set was genuinely small" and "the walk terminated
early" indistinguishable from the outside. A pass that cannot report
what it did forces exactly the forensics it exists to prevent.

## n256-prevzero

Above: `const prevZero = ((await client.from("job_board_meta").select("v").eq("k", "structured_sweep").maybeSingle())`

THE TERMINAL STAMP KEEPS THE WINDOW IT WALKED.

It used to write only {doneAt, scanned, filled} and drop the
vendor/cursor/lastId/pageLen the per-hop stamp carries — so a
completed pass erased the only evidence that distinguishes "walked
the whole range" from "the select came back short". That is precisely
the shape of the ";"-truncation incident this lane already survived
once, where two passes stamped doneAt over 148,776 untouched rows.

`zeroFilledPasses` is what stops the lane re-walking ~154,000 Workday
detail fetches every 24 hours to write nothing: see the re-kick gate.

## n257-cursor

Above: `const cursor = String(body.cursor ?? "") || `${sVendor}:`;`

STAMP BEFORE THE WORK, NOT AFTER.

This lane originally wrote its meta row only at the END of a
successful hop, so a hop that died left status all-null — identical to
"never kicked". It cost two deploys to tell those apart: the kick is
fire-and-forget through waitUntil with a `.catch(() => {})`, so a
failing action is invisible from both ends at once. desc-sweep stamps
`runningVi` up front for exactly this reason.
SEED THE CURSOR TO THE VENDOR'S RANGE, and this is why the first hop
kept dying.

`id` is `source:token:externalId`, so ordering by id orders by vendor
first — and every vendor we carry sorts BEFORE "workday": ashby,
bamboohr, breezy, greenhouse, icims, lever, oracle, personio, pinpoint,
recruitee, rippling, smartrecruiters, teamtailor, workable. Starting an
empty cursor at the beginning of the table meant the first hop had to
walk roughly 300,000 rows that fail `source = 'workday'` before
reaching a single candidate, and it timed out every time.

Every LATER hop was fine, because by then the cursor was already inside
the vendor's range — which is the nastiest shape for this: the lane
would have worked perfectly from hop two onward and could never reach
hop two.

## n258-lt-id-svendor

Above: `.lt("id", `${sVendor}~`)`

BOUNDED AT BOTH ENDS. `gt` seeds the walk at this vendor's range;
`lt` stops it leaving.

THE SENTINEL IS "~", NOT ";" — and that one character cost two full
passes. ";" is the byte after ":", the theoretically-tight bound,
and it DIES IN TRANSIT: proven live 2026-08-12 against the REST
layer, `id=lt.workday;` matches ZERO rows while the identical query
with `~` returns them — the semicolon is truncated somewhere in the
query-string path (semicolons are a legacy query-param separator),
leaving `lt.'workday'`, which excludes every `workday:` id. The
sweep's select came back empty, sDone fired, and the pass stamped
doneAt with 148,776 eligible rows untouched — twice.

"~" (0x7E) sorts above ":" (0x3A), every id is `{vendor}:...`, and
vendor names are lowercase ASCII, so `{vendor}~` is a correct upper
bound for every vendor and survives the URL.

Without SOME upper bound the final hop of a vendor walks the entire
remainder of the table — every row failing `source = ?` — to prove
there is nothing left. Today workday sorts last so that remainder is
empty and the bug would not show; add one vendor after it and the
lane inherits the same timeout that the missing lower bound caused.

## n259-object-assign-patch-placewrite-row-vcountry-v

Above: `Object.assign(patch, placeWrite(row, vCountry, vLocation, additionalSites));`

THE COUNTRY REPLACES A STORED ONE; THE LOCATION ONLY FILLS A
PLACEHOLDER. Two different rules because the two fields are two
different kinds of claim.

The country here is the employer's own structured field, and the
stored value it replaces was text inference over a location
string — the same precedence the work mode above already takes,
for the same stated reason. It is not a guess that it is better:
measured 2026-09-23 against 136 Workday rows we had already
placed, the vendor's code agreed with ours on 136 of 136, and
the rows where the two disagree are rows where we are wrong
(14 of 14 "Beth Israel" rows stored IL, vendor says US).

The location is the opposite. On a multi-site requisition the
vendor's display string names ONE site, so writing it over a
real location a seeker can already read would narrow a posting
to a place the employer did not single out. It is therefore
written only where the stored string names nowhere at all —
"2 Locations", "3 sites", empty — a large and repeatedly measured
share of Workday rows (the placeless shapes and their bases are
enumerated on isPlacelessLocation in normalize.ts).

region_code MOVES WITH THE PAIR IT IS DERIVED FROM, for the same
reason `remote` moves with work_mode a few lines up — and is
REFUSED where the pair is one site out of several. Both rules,
and the measurements behind them, live on placeWrite so this
lane and desc-sweep cannot state them differently.

## n260-upd

Above: `const upd = client.from("job_board_postings").update(patch).eq("id", row.id);`

`filled` MUST MEAN ROWS WRITTEN, NOT UPDATES ATTEMPTED.

PostgREST returns no error when an update matches zero rows, so
`if (!error) sFilled++` counted attempts. Once the classifier
starts producing work modes that distinction becomes the whole
question: without it you cannot tell "wrote 6,700 rows" from
"matched nothing 6,700 times", which is exactly the ambiguity
that let 154,003 scanned / 0 filled sit unexplained.
THE WORK-MODE RACE GUARD APPLIES ONLY WHEN THIS PATCH WRITES A
WORK MODE. It used to ride every update unconditionally, which
was harmless while work_mode was the only column written here and
is a silent loss now that it is not: a row that gained a work
mode between our select and our update would match nothing, and
the country and location in the same patch would be dropped with
it — no error, no count, nothing to see. This is the correction
desc-sweep's own salvage block already documents; both lanes now
state the same rule.

A RESIDUAL REMAINS AND IS DELIBERATE. When the patch DOES write a
work mode (the fifth or so of Workday postings that state a
remoteType) the guard still covers the whole statement, so a
genuine race would drop that row's country too. Splitting the
write in two removes it and is the right end state.

EXACTLY ONE ASSERTION BLOCKS THE SPLIT, and an earlier draft of
this note named four. The one is in src/test/structured-sweep.ts,
in the group about what the lane writes: it requires the update
call and the race predicate to sit within 120 characters of each
other, which two statements cannot. The other three block
nothing — two of them pin DESC-SWEEP's salvage statement, which
is a different write, and the one in
backfill-cannot-stamp-vacuous pins the ROW-COUNT accumulator
expression, which a split write keeps unchanged. Naming four
where there is one is how a deferral outlives its reason, so it
is named precisely: re-point that single adjacency regex and the
split is free.

## n261-postingid

Above: `const postingId = String(body.postingId ?? "").slice(0, 200);`

THE OTHER HALF OF THE LOOP. A search event says what was shown; this
says what was chosen. Neither is worth much alone — zero-result rate
without click-through tells you people got results, not that the
results were right.

Deliberately permissive about what it accepts. A click that arrives
without a searchId (browse, a restored tab, a client that lost the id)
is still recorded, because dropping those would bias every rate toward
people who searched. posting_id is the only hard requirement.

## n262-clickcore

Above: `const clickCore = {`

STAMP WHAT THE CLICK WAS FOR, AT INSERT.

The row held search_id, posting_id, q, position and kind — nothing
about the JOB. Posting rows are HARD-DELETED at closure, so the moment
a role closed we permanently lost its company, category, work mode and
whether it disclosed pay for every click that ever landed on it. Demand
is measured against roles that end; the ones that end are exactly the
ones whose attributes disappear. Stamping here is the only chance.

The lookup runs INSIDE waitUntil, deliberately. This endpoint is a
beacon fired as the visitor navigates away to an employer's site, so a
read before the response would cost the click it exists to record. The
response below is already unconditional and immediate; this just makes
the write one round trip longer, after the answer is out.
(job_board_posting_reports already stamps company_token the same way.)
The pre-.61 row shape, so a deploy window that has not created the
three columns yet still records the CLICK rather than losing it.

## n263-salary-present-p-salary-min-annual-null

Above: `salary_present: p.salary_min_annual != null,`

"DID THIS LISTING CARRY A COMPARABLE YEARLY FIGURE" — the
annualised column, and since 2026-09-27 that is DELIBERATELY a
different question from the one the states-pay filter answers.

This rollup feeds `count(*) FILTER (WHERE salary_present)` into an
immutable summary the raw rows can no longer correct, so it is
pinned to the column whose meaning does not depend on how well we
parse: whether we hold a comparable yearly amount for the row a
searcher clicked. buildQuery's states-pay predicate, /v1's
has_stated_pay and the transparency surfaces all ask the WIDER
question — did the employer write a figure at all — off the
verbatim pay field (see the predicate's own note in buildQuery).
Two questions, two columns, named here so the next reader does not
take either for the definition.

THE JUSTIFICATION THAT USED TO STAND HERE WAS REFUTED, and it is
corrected rather than left, because it was the last place in this
repository claiming prose in the pay column. It said reading
`salary || min_annual` "counted 'Competitive' and 'DOE' as
disclosure". Measured: 0 of 5,472 stored pay texts carry no digit,
0 of 5,350 in a 12,000-row walk of the two vendors with structured
pay fields (2026-09-27T03:30Z), and not one "Competitive", "DOE" or
"negotiable" string in either. The column holds figures. What makes
the annualised one right HERE is the question, not the prose.

null, not false, when the posting is already gone: we cannot
observe what we no longer hold, and false would be a claim.

## n264-livemap

Above: `const liveMap: Record<string, boolean | null> = {};`

THREE STATES ON THE WIRE, NOT TWO. checkLive returns true / false /
null, and collapsing null into `true` here was the mirror image of the
bug .64 fixed in checkLive itself: a user who reports a posting gone on
a page-capped board got told "{{company}}'s own board still lists this
role as open" (Jobs.tsx reportCheckedBody) — a confident claim about a
NAMED employer, on the one path where the user has independent evidence
and is probably right. We read the first page of a board whose own
advertised total we could not reach; that is not a confirmation of
anything. `null` ships as `null` so the client can say what is true.

Pruning is unchanged and still gated on `=== false` — the only value
that means the employer's own feed answered in full and did not list it.

## n265-deadids-length-0

Above: `if (deadIds.length > 0) {`

NEVER delete on a single probe. Measured 2026-07-28: checkLive reported
GONE for 7 of 50 randomly sampled LIVE Workday postings. That was read
at the time as Workday's search index being incomplete; the real cause,
found 2026-08-06, is that we were searching for an id Workday never
indexes — see the `-N` discriminator note in checkLive. The probe now
corroborates against the CXS detail endpoint before returning false, so
this branch sees far fewer misses, but the rule below is unchanged and
deliberately so: it is what made a probe bug survivable instead of
destructive. This branch used to DELETE unconditionally, which is silent
destruction of open jobs, and it contradicted the published audit that
reports workday accuracy 100% (gone: 0). A user clicking Apply was the
thing destroying the row.

Same two-pass rule the refresh prune already uses (VERIFY_GRACE_MS):
stamp missing_since on the first miss; only remove a row whose stamp has
already survived the window. Rows that come back have the stamp cleared
by the normal refresh, and missing_since is excluded from every serving
path, so the user stops seeing it immediately either way — we just no
longer destroy the evidence on one bad probe.

## n266-audit-sample

Above: `const AUDIT_SAMPLE = 100;`

Ground-truth audit: sample ~100 random served postings and confirm each
is still live at the vendor SOURCE. Produces the measured accuracy stat
("X% of sampled listings confirmed live") published on the Ghost Job
Index and watched by the heartbeat — the board grading its own honesty.
Pure measurement: confirmed-gone ids are left for the normal refresh
prune (which owns closure logging). Self-throttled to ~1/day; a public
trigger just gets the cached result back.

## n267-const-count-totalrows-await-client-from

Above: `const { count: totalRows } = await client.from("job_board_postings").select("id", { count: "planned", head: true });`

STRATIFIED sample: ~equal draws per vendor, not pure random. A pure
random sample is dominated by the biggest vendors — a small vendor
could serve 100% dead listings and barely dent the blended number.
Stratifying makes any single vendor's break visible within one audit,
and produces the per-vendor accuracy published alongside the headline.
PLANNED, not EXACT. An exact count is a full scan of every matching row,
and at ~590k postings that no longer fits the statement timeout —
measured 2026-08-06, the corpus count AND all 15 per-vendor counts each
came back 500 "canceling statement due to statement timeout" in 3.2s.

The failure mode is what makes this urgent rather than slow: a dead
count left the vendor at n = 0, `n === 0` skipped it before it could be
drawn, and a vendor with no rows is not a "missing source" — so it
vanished from coverage too. The audit published a figure covering 6 of
15 hiring systems while its own coverage line read "reached every
hiring system with postings on the board". That is the 2026-07-27
omission again, walking in through the one door the coverage instrument
did not watch.

The planner estimate answers in 0.1s and was within 0.4% of the exact
count the same morning (592,860 vs 590,501) — far more precision than a
stratification weight or a coverage share needs. It IS an estimate, and
the payload and the page both say so rather than implying a census.

## n268-drawids

Above: `const drawIds = async (v: string, want: number): Promise<string[]> => {`

KEYSET, not OFFSET. The old draw was
  .order("id").range(off, off+per-1)  with off up to n-per
which is a deep OFFSET. On workday — 303,098 rows, 52.1% of the
whole board — that query never returned, and because `error` was
destructured away the failure read as an empty page. Workday
therefore contributed ZERO ids and vanished from byVendor entirely,
while the blended headline still published as the board's accuracy.
Verified live 2026-07-27: 14 strata present, workday absent.
Same fix already applied to the sitemap today: anchor on a random
board for this vendor and seek forward on the indexed id.

## n269-suspect-pct

Above: `const SUSPECT_PCT = 90;`

ESCALATE BEFORE ACCUSING. A stratified draw gives each vendor ~6 ids, so
a single dead listing moves that vendor from 100% to 83% and two move it
to 67% — under the 80% floor the heartbeat pages on. At a true 3% death
rate, 2-of-6 comes up on some vendor roughly one day in six, so the alarm
was firing mostly on sampling noise (2026-08-06: workday 66.7% = 4 live,
2 gone) and a real vendor break would have looked identical. A number
that thin is not evidence either way, so any vendor that looks bad gets
re-drawn deeper and is judged on the combined sample instead.

## n270-sampledsources

Above: `const sampledSources = new Set(Object.keys(byVendor));`

COVERAGE. A stratified audit that silently drops a stratum publishes a
number about a different board than the one it names. On 2026-07-27 the
stored result carried 14 strata and no workday — 303,098 postings,
52.1% of the corpus — because the deep-OFFSET draw above failed and
its error was discarded. The headline still read "98.8% confirmed
live". Coverage is computed here so the omission travels WITH the
number and the page can disclose it instead of the reader having to
notice a missing table row.

## n271-decidedpct

Above: `const decidedPct = headlineSampled > 0 ? Math.round((decided / headlineSampled) * 1000) / 10 : null;`

`sampled` is the EVEN draw the headline describes; `probed` is every
probe including the follow-up re-draws. Publishing sampleIds.length as
`sampled` would state a sample size the headline was not computed from.
`decidedPct` is the statistic the accuracy figure's own denominator
depends on and the page never used to state: accuracyPct = live/(live
+gone), so every undecidable probe silently leaves the denominator. It
is published beside the headline so a reader can see how much of the
sample the number is actually about.

## n272-q

Above: `const q = String(body.q ?? "").trim().toLowerCase().slice(0, 80);`

THE EMPLOYER TYPEAHEAD WAS COSTING EVERY VISITOR 99KB.

The list response shipped the whole employer facet — measured
2026-08-24: 99,237 of 141,196 bytes, 70.3% of the payload, 1,433
entries — so that a typeahead most visitors never open could filter
it locally and show twelve rows. On mobile the control is hidden
behind a "Filters" tap, and the facet is 2.6x the size of the jobs it
decorates.

The suggestions come from the same cached facet the list used, so
this costs one indexed meta read and no table work at all. The list
now ships a short head of that facet and asks here for the rest.

## n273-const-data-metarow-await-client-from-job

Above: `const { data: metaRow } = await client.from("job_board_meta").select("v").eq("k", "refresh").maybeSingle();`


AND IT RETURNED THE ONE NUMBER THE DATABASE REFUSES TO.

get_company_suggest — the SQL typeahead sitting beside this one — has
carried the rule in its COMMENT ON since 20260811223000: "NEVER
returns companiesFacet.count: that number applies NEITHER serving
predicate and would contradict the page each hit links to." This
action returned `count: c.count` verbatim, so the edge function's own
typeahead published exactly what the SQL one refused, into the /jobs
company dropdown. Measured 2026-09-09: median employer ~1% over, PwC
3,254 against a filtered 2,119.

Now it publishes `open` — the servable per-board count computed under
both serving predicates in the same pass as the facet (migration
20260909214000) — summed across a merged employer's sub-boards, which
is the same definition and the same summing get_company_suggest's
open_roles uses. When the cached row predates that migration the map
is absent and each row ships with NO number; the dropdown renders bare
names until the next refresh pass.

## n274-detailcutoffms

Above: `const detailCutoffMs = Date.now() - FRESH_WINDOW_DAYS * 86_400_000;`

THE 30-DAY CAP WAS A PROPERTY OF THE LIST PATH ONLY.

Every serving route binds `.gte("effective_posted", freshCutoffIso)`
through buildQuery — every route except this one. This action's 78
lines contained no freshness predicate at all, so anyone holding an id
(a bookmark, a sitemap entry, a crawler, a shared link) got a past-cap
posting rendered in full, with a working apply button, under a board
that advertises a 30-day cap. The apply button is the harm: the whole
point of the cap is not to send someone at a role that is gone.

effective_posted is coalesce(posted_at, first_seen), so this is the
SAME rule the list applies — undated rows age out 30 days after we
first saw them, dated rows 30 days after the employer's date. Using
any other definition here would just relocate the inconsistency.

Answered like the closure case below rather than with a bare 404: we
know the title and the date, so the client can say what happened and
offer live alternatives instead of a dead end. Checked BEFORE the
description fetch so an aged-out row never costs a vendor round trip.

## n275-id

Above: `const id = String(body.id ?? "");`

Apply agent: fetch a posting's REAL application questions where the ATS
exposes its form publicly — Greenhouse (?questions=true), Ashby (the
public GraphQL endpoint its own hosted apply pages call; `field` is a
raw JSON scalar), and Recruitee (open_questions + document config on
the offers API). Everything else returns supported:false so the client
falls back to JD-inferred questions. Each question is classified so the
UI/answer-drafter knows what may be auto-drafted vs. what the candidate
must answer (identity, demographics, work-auth, salary). `requirements`
lists the documents the form demands, so the candidate can have them
ready BEFORE they start.

## n276-source-breezy-source-pinpo

Above: `if (source === "breezy" || source === "pinpoint") {`

Breezy and Pinpoint both SERVER-RENDER their apply route, so the real
form is readable without a browser. Added 2026-08-01 after a live dry
run showed these two were the only remaining blocker class on drivable
vendors — and that we were harvesting questions for Ashby and
Greenhouse, which are both NO-BUILD on CAPTCHA, while harvesting none
for three of the four vendors the worker can actually drive.

The URLs come from vendor-questions.ts, which is also what the tests
pin against the worker's adapters: harvesting one form and filling a
different one would put confident answers to unasked questions into a
packet, which is worse than harvesting nothing.

## n277-attachmsaccum

Above: `let attachMsAccum = 0;`

deno-lint-ignore no-explicit-any
last_seen is written at INSERT ONLY and never rewritten, so it is
semantically first_seen — two greenhouse rows measured 2026-07-28 carry a
last_seen 5s and 3s BEFORE their own first_seen. The UI rendered it as
"re-checked {ago}" under a tooltip claiming "last re-verified against the
company's own feed": the banned first_seen-as-freshness pattern, stated in
words. It also understated us ~100x — 92.6% of postings read as older than
24h while the true feed p50 is ~83 minutes.

job_board_verifications.verified_at is the honest value: when we last fetched
THAT BOARD's feed. Keyed by company_token, so one .in() over a page's
distinct tokens covers the page on the primary key.
Time spent inside attachRecheckedAt on the current request. A module-level
accumulator because this helper is called from eight list exits and adding a
parameter to each is more edit surface than the measurement is worth; the
handler zeroes it per request.

## n278-tokens

Above: `const tokens = [...new Set(jobs.map((j) => String(j.token ?? "")).filter(Boolean))].slice(0, 80);`

`token`, NOT `companyToken`. rowToJob emits the field as `token`; this read
`j.companyToken`, which is undefined on every row, so the token list was
always empty and this function returned early on every single call. The
board's strongest per-posting sentence — "re-checked N minutes ago", about
THIS job rather than about 24,934 boards in aggregate — has therefore never
rendered to a single visitor, on any of the three UI surfaces built to show
it. Verified live before the fix: 0 of 60 served rows carried recheckedAt,
and the payload key list contains `token` and no `companyToken`.

A typo, and invisible precisely because the failure was silent: an empty
token list is indistinguishable from "no stamps available", which is a
legitimate state this function is designed to degrade into.

## n279-const-data-error-await-withdeadline

Above: `const { data, error } = await withDeadline(`

BOUNDED, BECAUSE A DECORATION MUST NEVER HOLD THE PAGE.

This is a primary-key probe on a ~24k-row table — microseconds when that
table is healthy. MEASURED 2026-08-30 when it was not:
phaseMs.attachRecheckedAt = 15,104ms of a 30,728ms response, for a lookup
of ONE token, on the cheapest call the board serves, while the rows
themselves came back in 2s. job_board_verifications is UPDATEd for every
board on every rotation pass, so it earns dead tuples faster than anything
else here (20260830210000 tunes its autovacuum) — but the deeper fault is
that a "re-checked N minutes ago" caption could hold a page hostage at all.

Same rule the public API already follows for its count: the rows are the
product, the stamp is a nice-to-have, and a nice-to-have that is late is
simply absent. withDeadline resolves {data:null} instead of throwing, and
the guard below already returns the jobs untouched on a non-array, so a
miss degrades to exactly the page this function exists to decorate.

## n280-limitraw

Above: `const limitRaw = Number(body.limit);`

WHOLE ROWS, OR THE PAGER HANDS BACK A POSITION THAT CANNOT EXIST.

These were `Number(x) || default` clamps, which coerce anything rather than
rejecting it, and one of the things they coerced was a FRACTION. Measured:
offset=1.5 returned rows and echoed nextOffset 7.5, a fractional offset
handed straight back to the client to resend into a PostgREST range() call;
following that chain never advances past the first few rows. offset="abc"
and offset=-100 both silently became 0, so a broken pager looked like a
working one parked on page one. limit=0 became 60 because zero is falsy.

Coercion stays — a 400 here would break live callers that have always been
tolerated, and the data API is used by people who are not watching. But the
value is now floored to a whole row, so whatever we accept, we can serve,
and nextOffset is always a position that exists.

## n281-cursor

Above: `const cursor = (() => {`

KEYSET CURSOR — a page anchored to the last row read, not to a row count.

Measured 2026-08-18 03:0xZ, ingest active: 4 of 8 offset-paged page-1 ->
page-2 transitions OVERLAPPED; the worst pair duplicated 9 of 60 rows and
silently hid 9 others (union 111/120). Offset pagination cannot be stable
over a table inserting ~70k rows/day above the reader: every insert shifts
the window. The cursor is the (effective_posted, id) of the last raw row
the previous page consumed; the next page starts strictly after it, so
inserts above cost nothing and no row is shown twice or skipped.

VALIDATED, NOT TRUSTED: both values are interpolated into a PostgREST
or() filter tree, so anything that could not have come from our own
nextCursor is rejected and the request falls back to offset paging —
fail open to the old behaviour, never a 500 on a stale bookmark.

## n282-wantk

Above: `const wantK = body.sort === "newest" ? "pa" : "ep";`

WHICH ORDERING THIS COORDINATE IS WRITTEN IN. The board has two date
orders and one pair of coordinate names: "ep" is effective_posted =
coalesce(posted_at, first_seen) — the discovery order — and "pa" is
posted_at DESC NULLS LAST, the employer's date, which is what every
"Newest first" page walks and what the ordinary browse now asks for.

A cursor of the wrong kind is DROPPED, not applied: interpolating one
order's coordinates into the other's successor predicate pages through one
ordering using another's coordinates, which is exactly the defect that
made sorted page two repeat page one, and it is silent. Dropping it falls
back to offset paging, the same fail-open every other check here takes.

`body.sort === "newest"` is spelled again here rather than read from
`newestFirst`, which is declared far below this point — a const read above
its own declaration is this repo's own live outage (the hoisted function
that read one from the TDZ and took ranked search down in silence). The
two spellings are pinned to agree by
src/test/newest-first-must-order-by-date.test.tsx.

## n283-freshcutoffiso

Above: `const freshCutoffIso = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString();`

effective_posted = coalesce(posted_at, first_seen): undated feeds
(BambooHR) participate in freshness filters and recency sort. If the
function deploys before its migration, the column is missing — fall
back to posted_at for that window instead of 500ing the board.

Freshness guarantee (read side of the 30-day cap): the board NEVER serves a
posting past the window, independent of how far the bounded background sweep
has drained. This decouples what users see from refresh timing — during the
initial drain, or in the gap between a posting aging out and the next sweep,
the list and its headline count stay ≤ the cap. effective_posted is NOT NULL
(coalesces to first-seen), so undated postings are correctly included.

## n284-metatotal

Above: `const metaTotal = Number((meta?.v as Record<string, unknown> | undefined)?.total);`

The exact count over the filtered set rides the page query and DOMINATES
list latency on broad queries (measured: raw page 0.4s, with exact count
1.6-2.2s warm / 5-9s cold at 186k rows). The unfiltered total is already
maintained by the refresh loop in meta (the same figure the homepage
shows), so the default view — the most common request — skips the count
entirely. Filtered queries keep exact counts: their sets are small and
the zero-state logic depends on them.

## n285-prefilters

Above: `const preFilters = normalizeFilters(body, JOB_SOURCES.length);`

Case-fold the two enum-valued filters ONCE, before anything reads them.

These were normalised at every site that BINDS the predicate (:4365, :4372,
:4422 via its own path, the ranked paths) but NOT at the `unfiltered` gate
below. So `category=Engineering` filtered the page correctly and then took
the unfiltered branch, which returns the cached board-wide total: a page of
10 engineering jobs under a headline of 587,793 — 8.8x the true 66,842, and
reachable from the URL, because Jobs.tsx passes ?category= through raw.
workMode=Remote did the same. A second, independent instance lived in
cappedCount, which dropped the work-mode predicate entirely unless the
caller happened to send lowercase (design+Remote reported 3,940 instead of
616 — exactly the count with the predicate missing).

Normalising at the door instead of at each use is the only version of this
fix that cannot rot: a future filter site cannot bind a value the gate
never saw, because there is now one value.
Reject-by-reporting. A value we cannot honour must never pass silently:
country="USA" (3 letters, not ISO-3166-alpha-2) and experience="bogus" were
both dropped on the floor, and the board then answered the UNFILTERED
question — 3,939 results, the entire design category, presented as though
the filter had applied. The fence in this codebase is that a filter is
never silently ignored, so anything we drop is named back to the caller in
`ignoredFilters` and the UI can tell the user which constraint did nothing.
ONE normalisation, in filters.ts, feeding the gate, the row query, the count
and the per-page self-check. Three hand-maintained copies of this list used
to exist — the validation ifs, the `unfiltered` conjunction, and buildQuery —
and every filter bug shipped so far was two of them disagreeing:
  * `unfiltered` compared the RAW casing while buildQuery lower-cased, so
    category=Engineering published 587,793 over a filtered page.
  * the gate read `typeof experience === "string"` while buildQuery read
    String(experience).split(","), so experience=["bogus"] bound no
    predicate AND reported nothing — the unfiltered board dressed as a
    filtered one. Verified live before this change; see filters.ts.
A fourth site could not be kept in sync by discipline, so there is one.
EMPLOYER-NAME ROUTING, applied to the BODY before filters are derived, so
every downstream path sees one already-normalised request. Injecting it
into `applied` afterwards would mean the count probe, the facet query and
the list each had to remember to honour it — the four-path divergence that
has caused five defects in two days.

"Did the caller already pick a company?" is answered from the DERIVED
filter, never from the raw request field. Reading a filter off the request is
what board-filter-contract forbids, and it forbids it because the two
derivations drift until the count answers a different question from the
page. So the request is normalised once to ask, rewritten if it routes, and
normalised again — one derivation feeds the board, and it is the last one.

## n286-exclusion

Above: `const exclusion = splitExclusions(String(body.q ?? ""));`

Intent phrases run AFTER employer routing, so "AT&T work from home" keeps
both: the employer takes the name prefix, the phrase is lifted from what
remains. Both rewrites happen HERE and nowhere else, ahead of the single
filter derivation, so the count probe, the facet query and the list all see
the same normalised request.
EXCLUSIONS COME OUT BEFORE ANYTHING IS SEARCHED, next to the intent lift and
for the same reason: one rewrite of the request, ahead of the single filter
derivation, so the count probe, the facet query and the list all see the
same query text.

## n287-etcovraw

Above: `const etCovRaw = ((meta?.v as Record<string, unknown> | undefined)?.coverage as { employmentType?: unknown } | undefined`

EMPLOYMENT-TYPE LIFTS ARM THEMSELVES ON COVERAGE. Lifting "part time"
out of the query and into the filter is only an upgrade once enough of
the corpus carries a typed value — against thin coverage it would REPLACE
a working literal-text search with a near-empty filter (the exact
downgrade the work-mode lifts were measured NOT to be). Below the floor,
a sentinel in the lift's view of the body trips the caller's-own-filter
conflict rule for exactly those lifts: the words stay in the query and
behaviour is byte-identical to before the lifts existed. The gate reads
the same cached coverage figure the disclosure serves, so the feature
switches on by itself as rotation types the corpus.

## n288-reqstart

Above: `const reqStart = entryAt ?? Date.now();`

ONE honesty block, attached to EVERY exit from the list action.

It used to live only at the recency path's return, so the three earlier
exits — ranked search, the fuzzy rescue, and semantic — returned before it
and carried neither ignoredFilters nor filterIntegrity. Search is the
board's primary surface, so the guarantee "a filter is never silently
ignored" held on the path users take least and not on the one they take
most. Making it a helper called at each `return` is the same move as the
filter normalisation itself: the property cannot hold in three places and
lapse in a fourth if there is only one implementation of it.
WHERE THE TIME GOES ON THE HOTTEST PATH. Measured 2026-08-25 from outside:
a trivial action on this function answers in ~300ms and a plain REST round
trip is ~200-400ms, so there is no cold-start floor to blame — but
q=nurse costs 2.8-3.0s warm, and the twelve-query battery ran p50 3.8s /
p90 5.3s. Search is the product's core interaction and it is spending
roughly 2.4 seconds of its own somewhere.

The search-events log already records which route answered and how many
rows it returned, but never how long it took, so no one could see WHICH
tier is expensive across real traffic. One clock read, carried into the
log and the response.
TWO CLOCKS, BECAUSE reqStart WAS DOING TWO JOBS.

It fed both the REPORTING numbers (tookMs, the search-event log) and the
request BUDGET — budgetLeft(), which sizes six downstream deadlines: the
embed, the semantic ANN, the semantic re-filter, the simple_config tier, the
head ring and the fuzzy augment gate. Simply moving reqStart earlier, which
is what "start the clock at entry" sounds like, would silently shorten all
six by ~958ms — and the 7s at the simple_config tier is explicitly sized
against a measured 7.9s cold spike. Fixing an instrument must not move the
thing it measures.

So: reporting counts the meta read, and the budget still starts where the
work does.

## n289-phase

Above: `const phase: Record<string, number> = { ...(pre ?? {}) };`

PER-PHASE, because the total pointed at the wrong thing. Measured
2026-08-25: search_jobs — the ranked RPC that computes BOTH capped counts
— answers in 230-465ms when called directly, while this function reports
tookMs of 1,745-2,624ms for the same query. The database is not the
bottleneck; the missing 1.3-2.2s is spent around it, and one total cannot
say where. Recorded as point marks rather than by wrapping calls: these
awaits sit inside ternaries and destructurings where an extra paren is
how you break a hot path at 2am.

## n290-request-budget-ms

Above: `const REQUEST_BUDGET_MS = 9_000;`

ONE BUDGET FOR THE REQUEST, because the rescue tiers run in SEQUENCE and
their deadlines therefore SUM.

The ladder is: exact-word (7s) -> fuzzy RPC -> embed + semantic (5s, plus
4s to re-filter when a filter is active) -> head-term ring (4s). Each
budget is defensible alone; in series they permit twenty seconds, and a
query that finds nothing pays ALL of them before being told nothing was
found. Measured live on 2026-08-25.6:

  q=zzzqqq (0 results)  22.9s wall, 21.9s tookMs, 2.9s marked -> 19.0s in tiers
  q=krankenschwester    24.1s wall, 23.0s tookMs, 4.4s marked -> 18.6s
  q=enfermera           22.9-24.9s, and one run returned no response at all
  q=zzzqqq + remote      3.6s wall — the SAME query with a filter, which
                         changes which tiers are reachable

A user who searches a Spanish or German job title, or makes a typo, waits
twenty-three seconds to be told there is nothing. That is the whole defect.

9_000 is chosen to sit ABOVE the exact-word tier's measured 7s need, so
that tier — the first to run, and the one pinned by its own determinism
test — keeps its full deadline in the normal case and the clamp only bites
on tiers that come AFTER seven seconds have already been spent. A smaller
whole-request budget would starve the semantic rescue on exactly the empty
pages it exists to serve.

## n291-paycontrolactive

Above: `const payControlActive = applied.hasStatedPay === true`

THE ROWS THE PAY FLOOR AND THE PAY SORT CANNOT COMPARE, COUNTED ON THIS
PAGE — because the only other figure available is board-wide.

"States pay" now admits every posting whose employer wrote a figure in the
pay field, while the floor, the ceiling and the sort still compare an
approximate-USD column that only exists where we were willing to
annualise. So the checkbox is a strict superset of the three, and the
reader has to be told the size of the gap on the page in front of them.
The board-wide coverage fractions cannot do that job: they read the same
on a filtered page as on the whole board, which is why they are withheld
under a narrowed body in the first place.

EXACT, AND A FLOOR RATHER THAN A TOTAL. Counted from the served rows, so
it is true of this page by construction and costs no query. It counts the
rows that print a rate with NO annualised figure behind them; a figure we
annualised but could not convert to dollars is also uncomparable and this
number cannot see it, because the mapped row carries no converted column.
So the copy above it must say "at least", never "all" — a count that
cannot see part of its own population must not be published as the total.
Emitted only when it is non-zero: a zero here is not news, and every list
exit spreads this helper.

THE SECOND REASON IT IS A FLOOR, AND IT IS NOT IN THE ARITHMETIC: `jobs`
is the array AFTER similar requisitions are folded into one card, which is
the default. A folded sibling is invisible to both halves of this fraction,
so the number counts CARDS and the copy that prints it says so — measured
live 2026-09-27T03:29Z, one IE stated-pay page served 60 cards standing for
68 postings. Counting raw rows instead would restore the word "postings"
and lose the correspondence with the page the reader is looking at, which
is the whole reason this figure exists.

ONLY UNDER A PAY CONTROL. This sentence describes the pay floor, the pay
ceiling and the pay order to a reader who may have touched none of them —
and the field was previously emitted whenever ANY served row had pay text
and no annual figure, which on an ordinary browse is most pages: measured
live 2026-09-27T03:29:49Z-03:30:23Z over 20 default-shape pages spread from
offset 0 to 494,000, 10 of the 20 carried at least one such row (24 rows of
1,176 served, worst page 4 of 60). A disclosure that prints where nothing
has been disclosed is the same defect as a board-wide percentage printed
under a narrowed count, and the client's own test forbids the zero case for
exactly this reason. The gate is the state in which the gap can actually
bite: the checkbox, either end of the band, or the pay order. The client
mirrors this gate rather than trusting the field's presence, because a
server older than this bundle sends it ungated.

## n292-wantcount

Above: `const wantCount = !unfiltered;`

THE UNFILTERED VIEW NEVER COUNTS — even when the cached total is missing.

The old gate skipped the count only WHEN the cached facets total was
readable. So the moment that cache became unreadable (facets RPC 503ing
with PGRST002 during the 2026-08-18 00:20Z incident), every unfiltered
page view ESCALATED to an exact count over 584k rows — the single most
expensive query in this codebase, issued by the most common request, at
precisely the moment the database was least able to serve it. The
instance logged 88,674 rolled-back transactions, one per cancelled count.

A missing headline number must degrade the HEADLINE ("many jobs"), never
the page. safeMetaTotal is null when the cache is unreadable, and the
response carries countUnavailable so the client renders its fallback
instead of a zero-state.

## n293-opentotal

Above: `const openTotal = (() => {`

THE HEADLINE COUNTED ROWS NOBODY CAN REACH.

Three numbers for the same board, measured within one minute:
  headline `total` (meta.total)      615,914
  direct count on job_board_postings 608,453
  filter-aware facet sum             603,377
The headline exceeded the servable set by 12,537 (2.1%) — it carries rows
stamped missing_since and rows pruned since the last pass, neither of which
a visitor can page to. A total larger than the table it describes is not a
rounding difference, it is a number that cannot be true.

The facet sum is already computed, already cached and already correct: it
is the same aggregate the category rail is drawn from, so publishing it
makes the headline equal what a searcher can actually reach AND agree with
the counts beside it. Falls back to meta.total when the facet is missing,
because a stale headline still beats none.
Published figure = the SERVABLE count, taken as an exact count of rows with
no missing_since stamp during the refresh pass (it is the same count the
coverage fractions are computed against, so it is free).

I first reached for the cached category-facet sum, which the audit measured
at 603,377 against a headline of 615,914. I could not verify what that sum
currently holds — job_board_meta is not anon-readable, correctly — and the
on-demand facet came back 14k BELOW the open-row count, which would have
traded an overcount for an undercount. An unverifiable swap between two
wrong numbers is not an improvement. The open-row count can be checked from
outside against the table itself, which is why it is the one used.

## n294-trackedtotal

Above: `const trackedTotal = (() => {`

THE SECOND TRUE NUMBER: the corpus INCLUDING postings that have closed.

safeMetaTotal above is what a visitor can page to and stays the headline —
publishing this one in its place would overstate searchable jobs by the
~91k withdrawn postings the table still holds, and "no ghost jobs" is the
claim the whole page rests on. Published BESIDE it, labelled, it is the
thing this product actually owns: a live feed cannot tell you what closed
last week, and this corpus can.

Null rather than a fallback when absent. A tracked figure that silently
degrades to the servable count would quietly assert the two are equal,
which is the exact shape of claim drift this file keeps being bitten by.

## n295-offset-ceiling

Above: `const OFFSET_CEILING = 1_000_000;`

AN OFFSET PAST THE END MUST BE AN EMPTY PAGE, NOT A TABLE SCAN.

Measured 2026-08-18, minutes after the outage recovery: offset=583921 and
offset=999999999 both returned 500 after ~9.1s. Postgres implements OFFSET
by walking and discarding every skipped row, so a caller paginating one
page past the end spent nine seconds of the same database the outage was
made of — and got an error for it. The board UI cannot reach this (60 per
page); it is purely API/scraper traffic, which is exactly the traffic that
retries on a 500.

Two bounds, both cheap: the maintained catalog total is an upper bound for
EVERY query (a filtered set cannot outnumber the corpus), and a hard
ceiling catches the case where the cached total is unreadable. countOnly is
exempt — it ignores offset and must keep returning totals.

## n296-buildquery

Above: `const buildQuery = (`

withCount is separable from wantCount so a page can be re-run WITHOUT the
count when the count is what failed. Measured 2026-07-25 on the 570k table:
the page itself returns in 0.2-0.4s, while the exact count over a broad
window takes 3.2s+ and trips the statement timeout. Because both rode the
same query, that timeout 500'd the whole request — "Posted this week"
(maxAgeDays=7) was hard-broken, along with maxAgeDays=5. The failure is a
planner crossover, not size: 1-3d and 10-30d both plan well, the middle
band (~150-190k rows) picks an index scan with random heap access and
crawls. Dropping the redundant effective_posted predicate was measured and
does NOT help, so the fix is to never let the count kill the page.

## n297-is-missing-since-null

Above: `.is("missing_since", null);`

A posting stamped missing_since failed to appear in a SUCCESSFUL fetch
of its own company's feed (two-pass confirmed). Nothing in the serving
path filtered it, so the postings the Ghost Job Index exists to name
were being served as live results. Measured precision: of 1,000
stamped ids, 117 confirmed deleted at the vendor within 21 minutes and
only 2 flickered back (98.3%) — and a row that returns has the stamp
cleared by the normal refresh, so this self-heals.
Cheap here: it filters rows already fetched via the effective_posted
index, and ~99% pass.

## n298-opts-skipterms-for-const-t-of-terms

Above: `if (!opts?.skipTerms) for (const t of terms) q = q.or(`title.ilike."%${t}%",company.ilike."%${t}%",department.ilike."%${`

QUOTED, like the location or() below. A PostgREST or() is a
comma-separated list wrapped in parentheses, so an unquoted value
containing a comma or a bracket is parsed as structure: "Manager,
Operations" became two broken conditions and "Engineer (Remote)" an
unbalanced group — an ordinary job title returning HTTP 500 and losing
every category count on the page. sanitizeTerm strips `"` (with % _ \ |),
so a quoted value cannot escape its own quotes.

## n299-applied-remote

Above: `if (applied.remote) {`

An explicit workMode WINS over the legacy `remote` boolean. These are not
independent predicates: remote=true is a strict SUBSET of
work_mode='remote' (normalize.ts:1069), so ANDing them equals the
stricter one and silently narrows the user's own choice. Measured:
{workMode:remote,country:GB} 1,518 vs 1,403 UI-shaped (7.6% lost),
design 614 -> 582 (5.2%), data_ai 848 -> 752 (11.3%).
The remote/workMode precedence now lives in normalizeFilters, so this is a
plain read. It used to be decided HERE and nowhere else, which meant the
count RPCs and the self-check each answered a different question:
{remote:true, workMode:"hybrid"} returned 60 hybrid rows under a total of
36 (the count of hybrid AND remote), and the integrity sensor then flagged
all 60 as violating a filter the query had deliberately dropped.

## n300-applied-workmode-q-q-in-work-mode

Above: `if (applied.workMode) q = q.in("work_mode", applied.workMode.split(","));`

Work-mode filter: definitive vendor/text-stated tags only. Postings that
don't state a mode have work_mode NULL and are excluded by the filter —
honestly, never guessed (the UI says so).
Case-normalized (audit: {workMode:"Remote"} silently served the full
unfiltered board to API callers — the fence says filters are never
silently ignored, so at minimum every casing of a real value binds).
Multi-select: applied.workMode is a comma-joined subset of the closed
domain, so .in() is the binding and a single value still yields one-element
behaviour identical to the .eq() this replaces.

## n301-categoryoverride

Above: `if (categoryOverride) {`

ONE DERIVED VALUE FOR ALL THREE CALL SITES.

A category becomes a query in three places here — this direct filter and
two RPCs — and widening one of them is how a feature ends up working
while you browse and silently absent the moment you type a search term.
`categoryParam` is computed once, above, and every site uses it.
`categoryOverride` is how the two-subset pager asks for ONE category at a
time. It matters that this is an .eq(): the widened `.in()` below loses
the date index on a large bucket, which is what made ordering across both
subsets time out.
EQUALITY CANNOT EXPRESS A SELECTION. `applied.category` is comma-joined
(it always was, for the unsorted bucket), so an .eq() against it asks the
database for a posting whose single category is the literal string
"design,legal" — no rows, under a headline computed by the RPC, which
DOES split. Both sides must ask the same question.

## n302-applied-salaryfloor-null

Above: `if (applied.salaryFloor !== null) {`

Salary floor filters the annualized lower bound of the posting's OWN
stated pay, compared in APPROXIMATE USD via salary_rank_usd — the same
generated column salary sorting uses. The raw-number comparison this
replaced passed SEK/JPY rows whose figures merely LOOK large (SEK 1M ≈
$95k cleared a $100k floor) and failed EUR/GBP rows that genuinely
clear it. Postings without a stated salary, or whose currency we can't
identify (rank NULL), are excluded by the filter, honestly, not
guessed at. Displayed salaries stay exactly as the posting states them.

## n303-applied-salaryceiling-null

Above: `if (applied.salaryCeiling !== null) {`

The CEILING, on the same approximate-USD column and therefore with the
same NULL exclusion the floor has. Symmetry is the point: a band whose two
ends compared different columns would return rows that clear the floor in
USD and the ceiling in SEK. normalizeFilters has already refused a ceiling
below the floor, so this can never bind an empty band.
THE CEILING MUST SHARE THE FLOOR'S WIDENING, or it silently cancels it.

includeUnstatedPay widens an active floor by ORing `salary_rank_usd IS
NULL` back in. The ceiling shipped one commit later as a plain .lte(),
which PostgREST ANDs — and NULL fails `<=`, so every unpriced row the OR
arm had just re-admitted was thrown straight back out. Set a floor, a
ceiling and the toggle and you got exactly the floor-only result, with all
three controls lit.

Measured live 2026-08-27, category=design at a $100k floor:
  floor only ....................... 405
  + includeUnstatedPay ............. 3,375   (the toggle works: +2,970)
  + a $300k ceiling as well ........ 404     (the toggle contributes ZERO)

This is the pay-floor NULL discard — the bug includeUnstatedPay exists to
fix — re-armed by a second predicate. Two ANDed OR-arms give
(in band) OR (unpriced), which is what the three lit controls claim.

## n304-applied-hasstatedpay-q-q-not-salary

Above: `if (applied.hasStatedPay) q = q.not("salary", "is", null);`

"ONLY POSTINGS THAT STATE PAY AT ALL" — THE VERBATIM PAY FIELD, and the
reason it is that column rather than either parsed one.

Three pay columns nest: the employer's raw pay text, the figure we parsed
and annualised out of it, and that figure converted to approximate USD.
This control was bound to the MIDDLE one, which made it ask "did the
employer state pay AND were we willing to multiply it into a year" while
its label asked only the first half. The card is gated on the TEXT
(Jobs.tsx renders the pay span whenever that text exists), so the board
printed the employer's wage in bold on rows this filter classified as
silent — and the rows it dropped are not a random slice: the shared
parser deliberately refuses a 2,080-hour year for a rate carrying a
part-time, casual, per-diem or on-call signal, so the dropped population
is exactly the part-time and casual work whose seekers most need a posted
wage.

MEASURED, anon key, through this function's own read paths, every figure
stamped because this corpus moves ~2% an hour. Two complete country
strata walked row by row, no sampling: IE 2,575 rows / 312 with pay text
/ 282 with an annual (2026-09-27T02:01:53Z), NZ 1,455 / 161 / 143
(02:02:42Z) — 30 and 18 postings printing a wage under a control calling
them silent, and both walks matched this function's own counted answer
for the same stratum exactly. The hourly slice alone, counted per country
at 02:00:55Z-02:01:10Z as hourly against hourly-and-flagged: CA
2,170/1,461, GB 1,875/905, AU 464/168, NL 24/13. Board-wide, two hourly
scans over the SAME serving predicates: 206,996 rows carry pay text
(28.28% of 732,018, stamped 01:07:00Z) against 23.7% carrying an annual
(02:00:18Z) — so this predicate admits on the order of 33,000-34,000
postings and moves the published reach by ~4.6 points.

THE PLAIN NULL TEST, AND NOT A CLEVERER ONE. An extra arm demanding a
nonzero DIGIT was measured and dropped because it would have excluded
nothing: this column holds no prose at all — 0 of 5,472 stored texts carry
no digit, 0 of the 473 pay-stating rows in the two walked strata, and 0 of
5,350 pay texts in a 12,000-row walk of the two vendors with structured pay
fields (2026-09-27T03:30:38Z-03:33:10Z), with no "competitive", "DOE" or
"negotiable" string in any of the three.

A ZERO-VALUED FIGURE IS A DIFFERENT QUESTION AND IS ACCEPTED, NOT ANSWERED.
The arm that would exclude a pay field reading "EUR 0 - 0" is a
nonzero-VALUE test; the digit measurement above says nothing about it,
because every such row carries digits. In the same walk, 11 of the 1,674
newly-admitted rows (0.66%) carry a figure whose every number is zero —
eight "EUR 0 - 0", one "GBP 0 - 0", one "USD 0 - 0", one "$0", each a
vendor's empty structured salary rendered as text — and 8 more carry a zero
lower bound beside a real upper one, which do state pay. That ~0.7% is
accepted against the 33,240 rows recovered, because the card prints the same
text: the reader sees "EUR 0 - 0" and can judge it, so the control and the
card agree about the row, which is the property this change is about.
Excluding them means a value test spelled once in PostgREST and three times
in plpgsql, on an unindexed column, and it must not land in one runtime
alone. A single NULL test cannot mean two different things in two runtimes.

THE FLOOR, THE CEILING AND THE SORT DO NOT MOVE WITH IT, so this control
is now a strict SUPERSET of what they can compare. That divergence is
disclosed per page by payTextWithoutAnnual in honesty() rather than left
for the reader to discover; annualising a part-time wage at 2,080 hours to
close it is how a $44/hr rate was once served at a $90k floor as 91,520.

MIRRORED IN SQL, and it has to be: p_pay_stated carries this same
question into the ranked search, the capped count and the rescue tier
(20260927034117). A count bound to one column under a page bound to the
other is the 2026-07-25 work-mode defect, and the cross-runtime guard in
src/test/the-pay-controls-say-what-they-compare.test.tsx fails if these
four ever name different columns again.

## n305-applied-excludeagencies-q-q-eq-agenc

Above: `if (applied.excludeAgencies) q = q.eq("agency", false);`

"Hide staffing agencies" — the opt-in decline of the 2026-08-31
charter's disclosed inventory. A NARROWING and only ever that: agency
is NOT NULL DEFAULT false, so this equality has 100% coverage (no
unstated population is silently discarded, unlike workMode) and its
absence is already the widest answer. No RPC binds it yet — the
blind-set gate routes every request carrying it through this builder,
so this .eq() is the single place the predicate exists.

## n306-applied-postedafter-q-q-gt-posted-at

Above: `if (applied.postedAfter) q = q.gt("posted_at", applied.postedAfter);`

Saved searches ask "how many NEW since I last looked" — a cheap count.
COMPANY-STATED DATE, not our crawl time. dateCol is effective_posted =
coalesce(posted_at, first_seen), so binding postedAfter to it answered
"we FOUND this recently" while the visitor asked "the employer POSTED
this recently". maxAgeDays has always used posted_at, so the board had
two time filters answering the same question on opposite axes.

MEASURED, same instant, same 24-hour question, category=design:
  postedAfter -> 467      maxAgeDays:1 -> 90
and 60 of 60 rows postedAfter returned had NO company-stated date at all.
This is the filter behind the saved-search "new since you last looked"
badge, so that badge was inflated roughly fivefold by postings whose age
nobody knows.

The repo already carries this lesson from a previous incident —
first_seen is never a posting age — and it was reintroduced on a
different filter.

Undated rows now fall OUT of a postedAfter window rather than counting as
brand new. That is the honest reading of "posted after X" and it is
disclosed, not silent.

## n307-applied-country-applied-country-inclu

Above: `if (applied.country && applied.country.includes(",")) return null;`

A MULTI-COUNTRY REQUEST DOES NOT ASK THIS RPC, AND THAT IS A DEPLOY GUARD.

The comma split for the country parameter lives in a migration that is
not applied yet. Against the SQL currently live, a joined value is an
equality against the literal string and returns ZERO — so a function
deployed ahead of its migration would serve a full page of real German
and British rows under a headline of 0, and write a false catalogue-gap
row into job_board_search_misses on the way. filterViolations cannot
catch it: every row genuinely is in a selected country.

Returning null is not a degradation. The caller falls through to an exact
count through buildQuery, which splits the list in JS and is therefore
correct against BOTH versions of the SQL. It costs one count query on a
filter nothing can send yet. Single-country requests are untouched.

## n308-rpcblindfilters-applied-length-return

Above: `if (rpcBlindFilters(applied).length) return null;`

AND NEITHER DOES A FILTER THIS RPC CANNOT SEE. Same shape, same reason.

Six filters landed on 2026-08-25 — payBasis, hasStatedPay, salaryCeiling,
maxYears, department, vendors — and they bind in buildQuery, which this
RPC is not. count_jobs_capped has no parameter for any of them, so it
would count the UNFILTERED population and headline a number several times
the page. That is the 2026-07-25 p_work_mode defect exactly.

Returning null is not a degradation: the caller falls through to an exact
count through buildQuery, which binds all six. It costs one count query on
requests that carry one.

## n309-qterms

Above: `const qTerms = queryTerms(body.q).terms;`

Bound from `applied`, the same object buildQuery reads. These four used to
be re-derived here with their own expressions; when one of those drifted
from the query's, the count described a different question than the page.
Multi-term queries: the page ANDs each term (any of title/company/dept per
term) while the RPC treats p_q as ONE contiguous ILIKE. "senior nurse"
matches "Senior Registered Nurse" on the page but not in that count — the
summary could read "Showing 60 of 12". Only single terms match the page's
semantics; multi-term falls back (null) to the inline exact count, which
uses the identical buildQuery filter. Rare path: it is reached only when
the ranked search (which carries its own total) has already failed.

## n310-applied-hasstatedpay-row-capped-t

Above: `if (applied.hasStatedPay && row.capped !== true) return null;`

DEPLOY-WINDOW COVER FOR THE ONE PREDICATE THAT MOVED IN TWO RUNTIMES.
Delete this block, and the same gate in the category rail below, once
verify-deploy 5y(c) reports the migration live (its own header says how).

This bundle binds the stated-pay question to the employer's verbatim pay
field; migration 20260927034117 moves the SAME question inside this RPC.
The two ship down DIFFERENT PIPES — a function publish and a staged SQL
apply, minutes to days apart, with publishes known to skip functions
outright — so for one release the page and its own headline can be taken
over populations 33,240 rows apart (207,108 pay-text rows against
173,868 annualised, one scan 2026-09-27T02:07:00Z). That is the
2026-07-25 p_work_mode defect arriving through the deploy rather than
through a missing parameter, and NOTHING would report it: the SQL has
accepted p_pay_stated since 20260826041500, so the old definition answers
200 with a narrower number and no error, no PGRST404, no fallback.
The cross-runtime guard cannot see this window at all — it reads source
files, not deployed versions.

WHY A CAPPED ANSWER NEEDS NO COVER, and this is what keeps the cover
cheap. A capped count is published as COUNT_CAP + countCapped, i.e.
"10,000+". The new predicate is a strict SUPERSET of the old one (every
annualised figure has the employer's text behind it — get_filter_coverage
publishes that nesting check on every pass), so if the OLD definition
already reached the cap the new one does too and the published payload is
byte-identical. Only an UNCAPPED answer can differ between the two
versions, and an uncapped answer means fewer than COUNT_CAP matches —
so the exact count the caller falls back to is bounded by the same
ceiling this RPC was introduced to respect. Board-wide the two columns
are 1.19x apart, so the fallback counts on the order of 12,000 rows at
worst, nowhere near the 150k-190k band where the exact count times out.
What it costs is named rather than hidden: on the list path the page is
re-read with the count attached, so a narrow stated-pay page pays one
extra bounded read for one release, and a broad one pays nothing at all.

Standing down here is exactly right for these callers and would be wrong
for the ranked exit: cappedCount answers the countOnly action and the
buildQuery browse, both of which SERVE buildQuery rows, so their count
belongs to buildQuery. The ranked exit takes its total from the same
search_jobs call that produced its rows, so it agrees with itself in
either version and is deliberately untouched. Adding hasStatedPay to
rpcBlindFilters would have been the blunt version of this and would also
strip the ranked, fuzzy and semantic tiers that 20260826041500 restored.

## n311-qt

Above: `const qt = queryTerms(body.q);`

---- FILTER-AWARE CATEGORY COUNTS -------------------------------------

The dropdown already renders "Sales (62,871)" — and those numbers VANISH
the moment any filter is applied. Measured: unfiltered returns 18
populated categories; with country=US it returns 0.

That was deliberate and it was right. The cached facet is board-wide, so
under country=US "Design (4,320)" would be a global number wearing a
filtered label. visibleCategories suppresses rather than lies.

But counts matter MOST while narrowing — that is the whole job of a filter
UI, and a visitor who has picked United States currently cannot tell
whether Design holds 4,000 US roles or 4. So instead of removing the
guard, compute the honest number: the same filters, once per category.

REUSES buildQuery WITH ITS EXISTING categoryOverride, which is why this is
~15 lines and not a second implementation of the filter semantics. Every
predicate — country, work mode, experience, salary floor, freshness,
sendable, the serving window — binds exactly as it does for the list. A
hand-rolled facet query would drift from the list the first time a filter
changed, and the counts would quietly stop matching the results.

COST, measured before building: a single filtered category count runs
0.27-0.43s (US+engineering 24,713 rows in 0.30s). Affordable — but 18 at
once is precisely the request-amplification shape that took this board
down on 2026-08-17, so it is bounded three ways: its own ACTION (never
riding the list request), chunked concurrency, and a hard deadline after
which it returns what it has.

PARTIAL RESULTS ARE HONEST HERE. A category that did not answer in time is
simply absent, and an absent count renders as no count at all — the state
the dropdown is already in today. It never renders a zero it did not
measure.
DERIVED ONCE, HERE, because the facet counts need it too and a second
derivation is what the filter contract forbids — two copies drift until the
sidebar answers a different question from the page.

## n312-facet-chunk

Above: `const FACET_CHUNK = 6;`

THE COUNTS BESIDE THE RESULTS HAVE TO BE THE SAME KIND OF NUMBER.

Measured live, same request body:
  country=US   list total 10,000   facet sum 264,893
  q="IT"       list total (none)   facet sum 128,186
  q="welder"   list total 417      facet sum 465
Two independent defects were producing that.

1. SCALE. The list caps at COUNT_CAP and says so; the facets counted
   exactly and without a cap. A sidebar promising 264,893 next to a
   header saying 10,000 is not a rounding difference, and the visitor has
   no way to know which to believe.
2. ENGINE. With a text query the list is served by the tsquery RPC while
   the facets used buildQuery's substring ILIKE — different matchers, and
   the audit measured them 7,343x apart on q="IT". The facets were
   answering a question the page never asked.

With a query present the facets now go through the SAME count the list
uses. Measured at the existing chunk size: 6 concurrent count_jobs_capped
calls run 0.62-1.13s, so 18 categories in three chunks fits the budget.

## n313-facet-deadline

Above: `const FACET_DEADLINE = Date.now() + (qText ? 1_500 : 4_000);`

THE BUDGET NEVER FIRED, SO IT NEVER BOUNDED ANYTHING.

Measured 2026-08-25 with per-RPC timings: on a text query these
per-category counts are the single largest cost of the whole request —
count_jobs_capped totalled 2,238-2,489ms across the 18 categories for
q=camarero, against 156-291ms for search_jobs, the call that actually
produces the rows. Three chunks of six finish in ~2.4s, comfortably
inside a 6s budget, so the deadline was never reached and every text
search paid the full price to number the category rail.

1.5s buys roughly the first chunk. Categories past it keep their chip
and lose their number, which is a degradation this loop already
performs (it breaks between chunks) and which the rail already renders.
A number nobody waited two seconds for beats a complete set nobody
stayed to read.

NOT lowering the facet cap instead: a guard requires facet and list to
share COUNT_CAP so the sidebar cannot contradict the page, and that
invariant is worth more than the milliseconds a smaller cap would save.

## n314-chunkbudget

Above: `const chunkBudget = Math.max(250, FACET_DEADLINE - Date.now());`

BETWEEN chunks was never a bound, because the FIRST chunk always runs
in full. Measured 2026-08-25 after tightening the between-chunk
budget: q=camarero still spent 2,257-2,314ms here and still took
5.7s, because six concurrent counts are issued before the deadline is
consulted again. The comment above this loop claims 0.62-1.13s per
chunk; that number is stale.

So the chunk itself races the remaining budget. withDeadline does not
cancel the query — the established pattern in this file — so a slow
count finishes server-side while the reader gets their rows, and the
category simply arrives without a number, which the rail already
renders for every category past the budget.

## n315-facetq

Above: `const facetQ = queryTerms(body.q).terms;`

ONE MATCHER FOR THE RAIL AND THE LIST. count_jobs_capped treats p_q as a
single contiguous ILIKE, but the list ANDs each query term (title OR
company OR department, per term). For a multi-word query the two
disagree — "senior nurse" matches "Senior Registered Nurse" on the page
but not in the RPC's count — so a category chip undercounts and clicking
it delivers MORE than the rail promised. cappedCount already stands down
to buildQuery for multi-term (its guard at the top of this file); the
rail must too. buildQuery's else-branch below IS that matcher, so send
multi-term queries down it rather than to the RPC.

## n316-facetpaywindow

Above: `const facetPayWindow = applied.hasStatedPay === true;`

A NUMBER TAKEN OVER A DIFFERENT POPULATION IS WITHHELD, NOT PRINTED.
Delete this with the matching block inside cappedCount once verify-deploy
5y(c) reports migration 20260927034117 live.

Same window, same cause: this rail's numbers come from the RPC whose
stated-pay predicate lands through the SQL pipe, while the page's rows
come from buildQuery, whose predicate lands with this bundle. Until both
have landed a stated-pay chip can be up to ~16% low against the page
clicking it delivers.

WITHHELD RATHER THAN RE-ROUTED, and the choice matters. The else-branch
below is buildQuery's substring ILIKE, and with a text query present that
is a DIFFERENT MATCHER from the one serving the list — measured 7,343x
apart on q="IT", the second of the two defects the comment above this
loop records. Trading a ~16% pay-column skew for that is not a fix. A
category that arrives without a number is a degradation this loop already
performs between chunks and the rail already renders, so for one release
a stated-pay text search numbers no chips instead of numbering them wrong.
Unaffected: every stated-pay browse with no query, which never reaches
this branch and counts through buildQuery already.

## n317-t-count-jobs-capped-5

Above: `const t_count_jobs_capped_5 = Date.now();`

EVERY predicate the list binds, or the rail promises a different
board than clicking delivers. This branch hand-picked nine of the
RPC's parameters and omitted freshness (p_max_age_days /
p_posted_after), the agent-ready set (sendableSourcesParam — a
~18x overstatement under agentOnly), the pay toggles and the
2026-08-25 extras — while the response stamped appliedSignature
as if all of them were bound. The binding below mirrors
cappedCount, the complete one, spread-idioms included.

## n318-qclass

Above: `const qClass = qText ? pickRoute(qText, EMPLOYER_ALIASES) : null;`

── ROUTED RETRIEVAL ──────────────────────────────────────────────────────

ONE retriever per search, decided before any SQL is issued, and ONE exit for
all of them. This supersedes the tier shipped this morning, whose fatal
design was running only when the primary path returned ZERO rows — so
queries returning a full page of WRONG answers, the larger class, could
never reach it.

Every route binds through buildQuery with skipTerms, so freshness,
missing_since, country, category, experience, salary and companies bind in
the ONE place they are bound and only the matcher differs. A route with its
own PostgREST chain is the mistake behind five defects in two days.

MEASURED UNDER CONCURRENCY 4, the only measurement that counts here —
everything looks fine one request at a time, and that is exactly how a
sequential scan reached production this morning:
    company_token=in.(...)     0.67s x4, all 200
    wfts(simple) on title      0.36-0.59s x4, all 200
Rejected under the same conditions: ilike contains 1.9-2.7s, imatch regex
3.1-3.5s — and the regex is 0.35s SERIALLY, which is the whole trap.

Standing down when a filter is active is deliberate: the routed window is
capped, so a filter applied on top of a capped window would silently answer
from a subset. The ranked path below binds filters in SQL and is correct.
"No filters BESIDES the query." isUnfiltered() counts q itself as a filter —
it is asking "is this the bare board?" — so gating on it meant the router
stood down on EVERY search, which is every case it exists for. Verified
live: AT&T and IT both came back with no searchRoute at all.
"No filters BESIDES the query", derived MECHANICALLY. The hand-written
conjunction here omitted the seven filters added after it was written
(vendors, payBasis, hasStatedPay, includeUnstatedPay, salaryCeiling,
maxYears, department, employmentType), so a filtered abbreviation or
employer search still routed through the recency-capped window and answered
from a subset — the very hand-maintained-list rot isUnfiltered exists to
end. isUnfiltered counts q itself as a filter, so blank q to ask "is this
the bare board plus a query?"; any real filter, present or future, trips it.
THE QUERY'S CLASS IS A PROPERTY OF THE QUERY, NOT OF THE FILTER BAR.

pickRoute reads the typed string and nothing else, so classifying it costs
one pure call and can be done unconditionally. `routeDecision` below still
stands the ROUTER down under any filter (a 400-row window cannot answer a
filtered query honestly — see the gate's own note), but the two exclusions
the date sort needs are not the router's decision, they are facts about the
query, and reading them off `routeDecision` made both of them DEAD CODE the
moment a filter was set: routeDecision is hardcoded to BROWSE there, and
RETRIEVER_FOR.BROWSE is "browse", so `!== "company"` and `!== "SYMBOL"` were
unconditionally true on exactly the bodies they had to exclude.

MEASURED live 2026-09-26, anon key: {"action":"list","limit":20,"q":"c++",
"country":"US","sort":"newest"} and the same body with q="c#" both return
total 1,430 with byte-identical title lists ("Material Operator C - 2nd
Shift", "P&C Insurance Sales Executive", …) — neither list contains the typed
symbol, because both queries collapse to the tsquery 'c'. Served by the date
branch below that set would have been published as sortScope matchSet +
sortMatcher title, which the page renders as "every posting whose title
matches": a false statement about the set, reachable with one filter on.

## n319-routedquerytokens

Above: `const routedQueryTokens = qText.split(/\s+/).filter(Boolean).length;`

ONE deadline for the pair too, and it is sized by the query's SHAPE.

MEASURED 2026-08-31 (search battery, snap-2026-08-31-pre-agency):
q="director not for profit" took 9,381ms. The stopword rule sends it down
the SIMPLE route, whose retriever builds a four-token AND — and a rare
multi-token conjunction under ORDER BY effective_posted is the planner
shape this file already documents: the date index is walked row by row
testing the match, the deadline expires having answered nothing, and the
request then STILL pays search_jobs and every decoration behind it,
because this route falls through rather than erroring. A deadline on the
primary path sums with the whole pipeline behind it, so a bare 7_000 here
ran the request past every decoration deadline and burned the entire
budget to serve a page the fall-through would have served at ~2s.

The 7s figure stays for the one- and two-token queries this route exists
for (rn, swe, it manager): it was sized against a measured cold-start
spike on exactly that shape, and shortening it would re-open the
same-query-two-answers coin toss the exact-word tier's own test pins. A
wide conjunction that has not answered in 2.5s is already degenerating —
the measured run spent its full seven seconds to return nothing — and
the english reading of the same words is one fall-through away.

## n320-counthonesty

Above: `const countHonesty = {`

countOnly is the FIFTH exit, and I missed it when wiring the honesty
helper into the other four. Verified live on .10: {remote:"true"} returned
ignoredFilters correctly on the list path and NOTHING on this one, so the
caller most likely to be a machine — countOnly exists for the relaxation
buttons and the data API — was the caller least likely to be told a filter
had been dropped. It publishes only a number, which makes naming the
filters that number does not honour more important here, not less.
The clamp is a narrowing, and this is the exit where it hurts most: a
countOnly response is a NUMBER and nothing else, so {country:IE,
maxAgeDays:90} publishing 2,178 is read as "90 days of Ireland" when it
is 30 days of it. The list exits already say so through
searchDisclosures; this one ships no rows and does not call that helper,
so the single field it owes the caller is spread here rather than adding
an eighth searchDisclosures(body, applied, maxAgeClamped) call site —
three tests assert that count is exactly 7.

## n321-qtext-body-sort-salary-rout

Above: `if (qText && body.sort !== "salary" && (routedRetriever === "company" || routedRetriever === "simple")) {`

ONE BODY, ONE ANSWER — the count asks the SAME retriever the list used.

MEASURED before this: the router carried `!countOnly`, so a routed query
was counted by search_jobs instead of by the retriever that produced the
page. {"q":"sql developer"} listed 30 rows under searchRoute SIMPLE and
counted 3,000 through the description tier; {"q":"Domino's"} listed
countUnavailable and counted 2,206. Two shapes, one defect.

This is the routed list block's query, verbatim, through the same
buildQuery binder and the same hoisted ROUTE_WINDOW — so the number IS the
window the list slices and is reachable by paging. At the cap the window is
a floor, not a total, and says so exactly as the list does.

sort=salary stands down. A salary-sorted text search is served by
salaryTextSort (buildQuery + salary_rank_usd, .not("salary_rank_usd","is",
null)), NOT by the routed window — counting it here would publish 31 for a
page that shows 1, which is this very defect with the signs reversed.

MEASURED AT CONCURRENCY 4 on production: wfts(simple) over a 400-row window
0.34-0.46s, company_token IN 0.62-0.78s, 4/4 HTTP 200 — the same query and
budget the routed LIST path already pays on every search.

## n322-qtc

Above: `const qtC = queryTerms(body.q);`

With a query present, count what the LIST path would actually serve —
the FTS ranked tiers — not the ILIKE approximation. Measured
2026-07-25: the two disagreed up to 4.3x on the same body, so
relaxation buttons advertised counts that clicking couldn't reproduce
and the disclosure denominator went negative.
Same strip as the main ranked path — the count probe must ask the same
question the page asks, or the total disagrees with the results.
The `|| raw` fallback must NOT fire when the query was only a pay figure —
it would put "120000" straight back as search text and undo the lift.

## n323-qtextc-body-sort-salary-rpc

Above: `if (qTextC && body.sort !== "salary" && !rpcBlindFilters(applied).length) {`

Kept in step with the row query's guard above, which no longer excludes
"newest". If only one of the two had been changed, the count and the rows
would answer DIFFERENT questions for a newest-sorted search — the count
from a substring ILIKE and the rows from the FTS engine. That divergence
is the shape of the incident where 60 rows rendered under a total of 36.
The salary sort no longer drops the search engine. Kept in step with the
row query below — if only one of these changes, the count and the rows
answer different questions, which is the 60-rows-under-a-total-of-36
incident.
rpcBlindFilters: search_jobs takes no parameter for the six filters added
2026-08-25, so a request carrying one must take the buildQuery path or the
filter is silently dropped from the rows we serve.

## n324-trc

Above: `const trC = Number((rc[0] as { total_rows?: number } | undefined)?.total_rows);`

`|| rc.length`, which this used to be, treats a legitimate ZERO
total as absent and substitutes the row count. It cannot fire today
— total_rows counts the same predicate that produced the rows, so a
zero total means zero rows — but it is a loaded gun aimed at the
next change to search_jobs. Any edit that makes total_rows a
NARROWER count than the rows (counting title matches while serving
title-or-description, the shape every proposed tier fix has) turns
a filtered query with no title match into "the window size", and
adding a filter would multiply the reported count by 8.5. Guard on
finiteness, which is what the fallback was actually for: an absent
or non-numeric total_rows gives NaN, not 0.

## n325-rrc

Above: `const rrC = Number((rc[0] as { related_rows?: number | null } | undefined)?.related_rows);`

Tier-aware ceiling, same contract as the list path: the description
tier caps at 3,000, so a bare "3000" here was presented as an exact
figure when the truth is higher (bug sweep 2026-07-26).
THE TIER IS A TYPE, NOT A CONTENT LENGTH.

search_jobs sets snippet to NULL::text on the title tier and to a
ts_headline STRING on the description tier, so `typeof === "string"`
separates them exactly. The `.length > 0` this used to carry turned
the type test into a content test, and ts_headline over
left(coalesce(description,''),4000) returns the EMPTY STRING for a
posting with no description. This probe passes p_limit:1, so ONE
row with an empty description sniffed a description-tier count as
title tier, raised the ceiling from 3,000 to 10,000, and published
the 3,000 cap as an exact figure. Proven at the RPC: loan officer,
sql developer and php developer all return snippet as a
zero-length string at p_limit 1.
TWO SEGMENTS HERE TOO. The probe sends a page size of 1 and that is
fine: both figures are computed independently of the page and ride
on the first row. Leaving this single-segment would make "Remove
country — N openings" promise a number the resulting page does not
show, which is the 4.3x disagreement this file has had once already.

## n326-newestfirst

Above: `const newestFirst = body.sort === "newest";`

Stable pagination: recency desc (nulls last) by default, or highest
STATED salary first. Salary ordering uses salary_rank_usd — an
approximate-FX rank column that exists only so ₹2M/yr doesn't outrank
$300k by raw digits; displayed salaries stay the posting's own text.
Unranked postings (no identifiable currency) sort after ranked ones —
never excluded, never estimated. id tiebreaker so equal keys can't
shuffle between "load more" pages.
Relevance-ranked search: with a query present (and not salary-sorted),
the search_jobs RPC orders by ts_rank (title > company > department),
recency as tiebreak — composed with every active filter. Any error
(migration lag, malformed query) falls back to the recency path below.
FILLER-STRIPPED, because the ranked path is where the damage actually was.
queryTerms() was wired into the two ILIKE term-builders, and MEASURED after
deploy that fixed nothing a searcher would notice: "electrician jobs near
me" still returned 44 rows topped by "Maintenance II-ARP", because a query
goes through the RANKED path and this is the string it tsquery-ises. The
browse path I had fixed is the one nobody types filler into.
Falls back to the raw text when filler was all there was, same rule as
queryTerms itself.
Kept deliberately identical to qTextC above, including the liftedSalary
guard. If only one of the two changes, the count and the rows answer
DIFFERENT questions — that divergence is the shape of the incident where
60 rows rendered under a total of 36.
(qText is derived above the facet block — see the note there.)
"NEWEST" USED TO DROP THE ENTIRE SEARCH ENGINE.

The guard excluded sort==="newest", so choosing Newest from the sort
dropdown routed a query to the recency path's substring ILIKE at :6051:
  title.ilike.%rn%  ->  matches inteRNship, PRN, oveRNight
and, because "registered nurse" contains no "rn" substring, the spelled-out
title became UNREACHABLE — alias expansion never ran on that path either.
Measured live: q="RN" relevance-sorted returned 10/10 nursing roles; the
same query newest-sorted returned substring artifacts and carried neither
`ranked` nor `aliases`.

It was also the slow path, not just the wrong one. `%term%` cannot use an
index, so on 594k rows a rare term seq-scans: q="k8s" + newest returned
HTTP 500 after 25.47s. Routing through search_jobs moves the work onto the
GIN index, so this change makes the query FASTER as well as correct.

Newest still means newest — the ranked path selects WHICH rows match, and
the page is then ordered by date below (see `newestFirst`). That is
"newest among the postings that actually match", which is what the control
promises; the alternative was "oldest artifacts of a substring collision".

## n327-deeppageable

Above: `const deepPageable = scoreRanked`

SORTING BY SALARY USED TO DROP THE SEARCH ENGINE ENTIRELY.

This guard excluded sort==="salary", so a salary-sorted search never
reached search_jobs and fell through to the browse path's OR-of-ILIKE.
MEASURED: q="nurse" sorted by salary returned "Unqualified Nursery
Practitioner" at position one — matched on the substring "Nurser" — with no
`ranked` key and no alias expansion. q="swe" returned 10,000 ranked
Software Engineer roles under relevance and 1,101 substring artifacts under
salary, topped by "Roswell Full-Time General CRNA" (Ro-SWE-ll) and
"SWEPCO". A sort control was changing WHICH JOBS MATCH, by up to 5x.

This is the identical defect that was found and fixed for sort==="newest"
— the fix landed on one of the two sort values and the other was missed.
The remedy is the same one newest already uses: let the RPC pick the rows
by relevance, then order the page the reader is looking at.
The routing gate, the chosen route and its retriever are decided ABOVE the
countOnly exit now — see the note there. They used to be decided HERE,
behind a `!countOnly` term, which is why a count and a list ran different
retrievers for one body: {"q":"sql developer"} listed 31 rows through the
routed window and counted 3,000 through search_jobs' description tier.
PAST THE RE-RANKED WINDOW, PAGE IN SQL.

The scored path anchored search_jobs at p_offset 0 and applied the caller's
offset in JS, so the reachable set ENDED at the in-memory pool. Measured
live 2026-08-22: q="loan officer", limit 100, groupSimilar false — offset
100 returns 100 rows with hasMore:false, offset 200 returns 0, against a
published total of 201. limit=60 with grouping walked 118 cards and stopped.

TWO REGIMES, ONE SEAM. Below the seam the page is served exactly as before
— window, head-term ring, scorer, slice — and is CLAMPED to end at the
seam. At or above it, search_jobs pages itself with p_offset in ts_rank_cd
order and nothing is re-ranked, so `offset` means SQL rank there.

THE SEAM IS 200 ONLY WHEN THE POOL IS THE SQL TOP-200. A ring-merged query
serves a pool of up to 400 rows (200 prefix + 200 ranked, deduped), and
clamping THAT pool at 200 broke the contract both ways at once: ring-only
rows (SQL rank >= 200) served below the seam were re-served by deep pages
as duplicates, and every one of them displaced an SQL top-200 row past
merged position 200 — unreachable at ANY offset while `total` counted it
(measured ~27 of each on q="sales"). So a ring-merged query's seam is
RING_WINDOW (400), the pool's MAXIMUM — still a constant known before any
SQL, which is what lets one request plan a deep page. The pool ends
wherever it ends; the page that exhausts it hands nextOffset=400, and the
deep regime maps offset back onto SQL rank 200 and drops the ring's ids,
which by then have all been served below. The seam still CANNOT be the
pool LENGTH — that moves with the ring's 4s deadline; the maximum doesn't.

NOT FOR sort=newest — its rows are date-permuted, so a relevance-ordered
continuation would not be "newer than page three".
NOT FOR THE EMPLOYER/SIMPLE ROUTES — they retrieve a different set in a
different order through their own 400-row window.
NOT FOR SYMBOL. RETRIEVER_FOR.SYMBOL is "ranked" (search-routing.ts:78) and
search-routing.ts:125-146 says outright that a symbol query has no retriever
of its own — it is separated ONLY by the scorer's literal-substring rule,
which is off past the seam. Measured: q="c++" and q="c#" produce the
identical tsquery ('c') and the identical total (1682); at p_offset 200 the
raw ts_rank_cd order returns "Analista de P&C Cluster", "Lead P&C
Operations", "C&I Sales Executive II" — 2 of 10 rows contain the literal.
The 200-row wall is currently the only thing hiding that; opening it without
this exclusion reintroduces the defect the SYMBOL route exists to prevent.

## n328-ringmerged

Above: `const ringMerged = scoreRanked && headTermRing && deepPageable;`

The seam arithmetic lives in paging.ts so a test can walk every offset
across it and prove no rank is served twice or skipped. It used to be
inline, which is why the 200-row wall was never caught.

ringMerged mirrors the ring's own firing condition (scoreRanked +
short-query shape) so the plan and the merge agree on what the pool holds.
It deliberately does NOT depend on whether the ring RESPONDS — a deep page
must dedupe against what sub-seam pages COULD have served, and the seam
position may not move with a deadline.

## n329-body-explain-true

Above: `if (body.explain === true) {`

── DIAGNOSE: the board explaining its own reasoning ──────────────────────

A read-only decision trace, returned BEFORE any search SQL runs. Every
variable it reports is the exact one the serving path below is about to
act on — the parsed query, the filters kept and the ones refused (with the
refusal named in `ignored`), the route and retriever chosen, and the
ranking regime (ring-merged? deep page? which seam?). Two adversarial
sweeps this week found their bugs by reconstructing this trace agent by
agent; this makes it a single call. It executes no query, so it cannot
perturb what it measures and costs nothing but the pure decision fns.
The OUTCOME half (searchRoute, phaseMs, rankedFellBack, total, hasMore)
comes from running the same body without `explain`; the debug tools merge
the two. Not offered on the countOnly/facetCounts branches, which returned
above — `explain` is for list queries.

## n330-salarytextsort

Above: `const salaryTextSort = !countOnly && !!qText && body.sort === "salary" && onlyQuery;`

A SALARY-SORTED SEARCH CAN HAVE BOTH CORRECT MATCHING AND A GLOBAL ORDER.

Until now it had neither. The ranked path is bypassed for sort=salary, so
the query fell to substring ILIKE and q="nurse" returned "Unqualified
Nursery Practitioner" at #1. I tried routing it through search_jobs and
REVERTED that the same day: only 16 of the 180 relevance rows carry a
stated salary, so 44 of 60 cards on a "highest paid" page had no pay at
all, page 1 topped out at $214,800 where the browse path starts at
$650,000, and page 2 led higher than page 1. The note left behind said the
real fix was a sort parameter on the RPC.

There is a third option that note did not consider: order in SQL on a
DIFFERENT query. buildQuery can match with the simple-config index and sort
on salary_rank_usd, which is indexed — so the database orders the whole
match set, not a window, and the matcher has word boundaries. MEASURED at
concurrency 4: nurse 0.34-0.46s, engineer 0.25-0.42s, all 200. The page it
produces for q="nurse" is $300,000 Nurse Practitioner, $290,000 CRNA,
$270,000 CRNA — against "Unqualified Nursery Practitioner" today.

Rows with no stated pay are EXCLUDED rather than sorted last. On a
highest-paid-first page they are not an answer to the question, they are
87% of the board — and the browse path's partial index already takes the
same view.

## n331-typeof-metav-companiesopencount-number

Above: `...(typeof metaV.companiesOpenCount === "number" ? { companiesOpenCount: metaV.companiesOpenCount } : {}),`

THE SERVABLE EMPLOYER DENOMINATOR, beside the unfiltered one.
companiesCount is the length of the UNFILTERED token grouping — it
counts boards whose every posting has been withdrawn or aged out —
and it was being printed next to a serving-filtered opening count in
one sentence. companiesOpenCount is boards with at least one open
posting, under the same two predicates as `total`. Spread only when
the pass computed it: absent, and every caller drops the clause.

## n332-categories

Above: `categories: {},`

THE SHAPE IS PART OF THE CONTRACT, NOT JUST THE VALUES.

This exit shipped without these two and CRASHED THE WHOLE JOBS PAGE:
Jobs.tsx read `data.failedSources.length` with no guard — correctly,
as far as TypeScript could see, because the client type declared the
field non-optional and every other exit sends it. Measured on
production 2026-08-22: resumebooster.work/jobs?q=nurse&sort=salary
rendered "Something went wrong" and nothing else. Every pay-sorted
keyword search was a dead page, on the exact surface the last release
note advertised as fixed.

An exit that omits a field the contract promises is a breaking change
that no type checker on either side can see: the server is untyped
against the client, and the client's own type says the field is always
there. Emit the full shape.

## n333-newesttextsort

Above: `const newestTextSort = !countOnly && !!qText && newestFirst`

"NEWEST FIRST" ON A SEARCH WAS THE NEWEST OF THE 200 MOST RELEVANT.

MEASURED live 2026-09-26 with the anon key against production:
  {"action":"list","limit":60,"q":"nurse","sort":"newest"} -> 3 cards,
  hasMore false, nextOffset 200, total 10000, countCapped true. The
  relevance top-200 for "nurse" was 199 requisitions from ONE employer
  under two titles, so date-sorting them folded to three cards and the
  list dead-ended under a headline of 10,000+.
  {"action":"list","limit":1,"q":"nurse","sort":"newest","postedAfter":
  <the newest row that page could serve>} counts 39 title matches STRICTLY
  NEWER than the top card; the same probe on q="engineer" counts 224.

WHY: sort=newest sets scoreRanked false, so deepPageable is false and
planRankedPage reads search_jobs at p_offset 0 with p_limit 200. The RPC
orders by ts_rank_cd and clamps its output at 200 rows, and the page is
then date-sorted IN MEMORY (see `newestFirst` below). So the rows a page
labelled "Newest first" could ever hold were the 200 most RELEVANT rows —
and the genuinely newest postings are the least likely to rank, which is
precisely why they were the ones missing.

THE THIRD OPTION THE SALARY SORT ALREADY TOOK, applied to the column this
control names: order in SQL on a DIFFERENT query. buildQuery matches titles
through the simple-config index — with the alias expansion the SIMPLE route
binds, so "rn" still reaches "Registered Nurse" — and orders on posted_at,
the plain column the no-query newest browse already orders on (measured 5x
cheaper than effective_posted's coalesce). The DATABASE orders the whole
match set, so `offset` is a position inside one stable ordering and there
is no window to fall off the end of.

WHAT IS KNOWN ABOUT THE PLAN, AND WHAT IS NOT. The ordering has an index
that matches it exactly — job_board_postings_posted_at_idx is
(posted_at DESC NULLS LAST, id), migration 20260711103500 — and the matcher
has one too (job_board_postings_title_simple_fts_idx, gin over
to_tsvector('simple', title)). The COMBINATION is new here: the shipped
twins pair that matcher with salary_rank_usd (salaryTextSort, measured
0.25-0.46s at concurrency 4) and with effective_posted (the routed window,
0.34-0.78s), and the no-query browse pairs posted_at with no matcher at all
(0.20-0.37s, five times cheaper than effective_posted's coalesce). Those are
proxies, not this query: the anon key cannot read the table or EXPLAIN, so
the plan for THIS pair is a post-deploy measurement — a timed
{"q":"engineer","sort":"newest"} and {"q":"nurse","sort":"newest","offset":
600} against the deployed function, and the branch must show searchRoute
NEWEST with sortScope matchSet. The deadline below falls through to the
ranked path rather than failing the request if that measurement is bad.

WHAT IT COSTS, SAID OUT LOUD ON THE RESPONSE rather than left for a reader
to discover: this matcher is TITLE-ONLY. It does not read the description
tier, and the rescue ladder does not run for it. So a page served here is
"every posting whose TITLE matches, newest first" — a narrower set than the
relevance page, and one that can be named in a single true sentence, where
the old page was a relevance window wearing a date-order label. sortScope
and sortMatcher carry that to the client, which prints the order claim from
them and NEVER from the requested sort (src/pages/Jobs.tsx).

NOT FOR THE EMPLOYER ROUTE: those tokens are company names, and a title
matcher returns nothing for q="Domino's".
NOT FOR SYMBOL: q="c++" and q="c#" produce the identical tsquery ('c') and
only the scorer's literal-substring rule separates them — that rule cannot
run in SQL, so this route would date-order rows that do not contain the
symbol at all. It is the same exclusion deepPageable makes, for the same
measured reason.

BOTH STAND-DOWNS READ `qClass`, NOT `routeDecision`. routeDecision is
BROWSE under any filter, so spelling these against it made them inert on
exactly the filtered bodies they exist to exclude — see qClass's own note
for the measured q="c++"/q="c#" collision that reached this branch with one
country filter set. qClass is the same pickRoute call, computed from the
query alone, so the exclusions hold filtered and unfiltered alike.
ZERO ROWS FALL THROUGH rather than ending the search: the ranked path below
owns the description tier and the fuzzy/semantic/location-split rescues,
and a title-only miss must not cost the reader any of them.

## n334-logsearch-ranked-newgrouped-jobs-length-null

Above: `logSearch("ranked", newGrouped.jobs.length, null, null, newServed);`

"ranked" IS A CLOSED SET, AND THIS ROUTE IS NOT ONE OF ITS MEMBERS.

The label vocabulary in job_board_search_events is pinned to exactly
["fuzzy","ranked","recency","semantic"] by
src/test/search-quality-needs-a-denominator.test.ts, so a fifth value
cannot be introduced here without moving that guard and whatever reads the
column. Until it is moved, three retrieval regimes share this bucket — the
relevance window, salaryTextSort and this date-ordered SQL route — so the
denominator CANNOT separate them, and nobody should read a per-route
conversion rate off it (project_partial_instrumentation: an instrument
that covers part of a thing reads as if it covered all of it). The wire
DOES separate them: `searchRoute` is NEWEST on this exit, SALARY on the
pay one, and absent from the relevance window.

## n335-sortscope-matchset

Above: `sortScope: "matchSet",`

THE ORDER CLAIM THE PAGE IS ALLOWED TO PRINT, as data.

"matchSet" means the database applied the requested order to every
row the matcher selected — not to a window of them — so "newest
first" is true of the whole set and a plain offset pages it.
sortMatcher names WHICH set that is, because the sentence on the page
has to name it too: title matches, not every posting the relevance
page would have shown.

## n336-total-null

Above: `total: null,`

Ordered in SQL over the whole match set, so paging is a plain offset
into one stable ordering. NO TOTAL: the count this page could publish
is search_jobs' title-tier count, which counts a DIFFERENT set (it
weights company and department into title_tsv and carries its own
description tier), and publishing it over these rows is the
one-body-two-answers defect the routed count block exists to prevent.
The client renders "Showing N matching openings" — no figure it
cannot stand behind, which is also what retires the "3 cards under a
headline of 10,000+" reading of this control.

## n337-categories-visiblecategories-metav-categoriesfa

Above: `categories: visibleCategories(metaV.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category)`

THE SHAPE IS PART OF THE CONTRACT, NOT JUST THE VALUES — the salary
exit shipped without these and every pay-sorted search rendered
"Something went wrong", because the client's type declares them
non-optional and no checker sees across the runtime boundary.

The industry rail keeps its numbers through the SAME gate every other
exit uses: visibleCategories withholds the board-wide facet under any
narrowing rather than printing it beside a narrowed page (the
"Engineering 67,898" over a 19,633-row country page defect). Choosing a
date order is not a reason for the rail to go blank — the salary exit
sends a bare {} and does blank it, which is a trade this one does not
have to repeat.

## n338-routedservesthisorder

Above: `const routedServesThisOrder = routedRetriever === "company" || !newestFirst;`

NOT UNDER A DATE SORT UNLESS IT CAN PRODUCE ONE, which is the company half
only. For every other routed retriever this block hands `mapped` to
rerankWindow — a RELEVANCE permutation of a block selected by
effective_posted — so a page it served under sort=newest was neither
date-ordered nor relevance-windowed, and it emitted nothing saying which.
MEASURED live 2026-09-26: q="accenture" + sort=newest took this exit with no
sortScope on the wire, and the client's absent-sortScope arm printed "Newest
first within the closest 200 matches" over rows ordered by our crawl stamp,
on a route whose window is 400. The SIMPLE route only reaches here under a
date sort when newestTextSort above already declined or fell through, and the
ranked path below serves that body with sortScope relevanceWindow and its
real seam — an honest windowed claim instead of an unlabelled one.

## n339-blockstart

Above: `const blockStart = Math.floor(offset / ROUTE_WINDOW) * ROUTE_WINDOW;`

Window anchored at rank 0 and sliced AFTER scoring, so `offset` is a
position inside ONE stable ordering. Paging a re-ranked list by a
retriever-ordered offset is what made sorted page two repeat page one.
ROLE ALIASES REACH THE SIMPLE ROUTE, WHICH IS WHERE THEY LIVE.

expandQuery ran ~60 lines below this block, on the RANKED path only, and
this block returns before it. But pickRoute sends a query to SIMPLE
precisely when a token is <= 3 characters — and 37 of the 57 ROLE_ALIASES
keys are <= 3 characters: swe, sde, sre, qa, ml, ai, ux, ui, pm, rn, lpn,
cna, np, pa, emt, dba, ba, ae, hr, k8s, js and the rest. The abbreviations
the alias table exists FOR were the exact set it could never serve.
Measured live 2026-08-22: q="swe" returned 8 literal "SWE" titles and no
aliases key, while ~70,000 "Software Engineer" postings sat unreachable.

Never for the EMPLOYER route: those tokens are company names, and
expanding "pa" to "physician assistant" inside a company match is wrong.
ftsSafe keeps " OR " intact (it strips only (),."'\:), so the expanded
websearch string passes through unchanged.
THE WINDOW FOLLOWS THE PAGE. It used to be anchored at rank 0 always, so
everything past row 400 was unreachable — on exactly the query shapes this
route exists for. Measured live 2026-08-27, paging q="cdl": offset 380
still returns rows and says hasMore, offset 400 returns ZERO jobs and
suddenly reports total 2,646. So 2,246 of 2,646 CDL postings (84.9%) were
unreachable, 4,842 of 5,242 sales-rep (92.4%), and >9,600 SWE — and the
searcher was told "no more results" while the count that proved otherwise
appeared only on the empty page.

Blocks are disjoint because the retriever's order key is TOTAL and stable
(effective_posted DESC, id ASC), so a block boundary cannot drop or repeat
a row. Re-ranking still happens within a block, which means relevance
restarts at each boundary — a real trade, and the honest one against
"there is nothing here".

## n340-routedread

Above: `const routedRead = newestFirst && routedRetriever === "company"`

THE EMPLOYER PAGE ORDERS BY WHICHEVER DATE IT IS ABOUT TO CLAIM.

An employer page applies no relevance scoring at all (`ordered` below is
`mapped` for this retriever), so the only thing the reader can be told
about its order is the column it came back in — and under sort=newest that
has to be the employer's own stated date, or the page claims a date order
over effective_posted = coalesce(posted_at, first_seen). MEASURED live
2026-09-26 on the old ordering: q="Spectrum Health" + sort=newest served
workday:spectrumhealth~wd5~CorewellHealthCareers:R228442 with postedAt null
at position 1, above seven rows stamped 2026-09-25.

The block arithmetic is untouched by the swap: (posted_at DESC NULLS LAST,
id ASC) is as total and as stable as (effective_posted DESC, id ASC), so
blocks stay disjoint and the undated tail is ordered last inside the
employer's own set rather than exiled behind the whole board.

## n341-blockfull-countunavailable-true-totala

Above: `...(blockFull ? { countUnavailable: true, totalAtLeast: blockStart + ordered.length } : {}),`

A full block withholds the total honestly — but it PROVES a floor,
and a floor is a fact even when the total is not (the fuzzy tier's
own words). MEASURED 2026-08-31: q="RN" served a full page under
no number at all, while the window in hand had just demonstrated
at least 400 matches. The client renders "N+"; under an exclusion
the caveat below still withdraws it, because a pre-exclusion floor
counts rows the pruning may then hide.

## n342-nextoffset-blockfull

Above: `nextOffset: blockFull`

Clamped to the window, so a caller cannot step past it. Unclamped,
paging one page beyond the 400-row window re-entered this block at
an offset the slice cannot serve — and the abbreviation queries
this route exists for (emt, ux, dba) are exactly the ones that walk
several pages.

CLAMPED ON THE blockFull BRANCH TOO. It wasn't, and whenever limit
does not divide ROUTE_WINDOW the walk overshot the boundary: q="cdl"
limit 60 at offset 360 served 40 rows and handed nextOffset 420, so
the next request entered block two at inBlock=20 — permanently
skipping the first 20 positions of the re-ranked block, which are
precisely its HIGHEST-scoring rows. Landing exactly on the boundary
makes the next request compute inBlock=0 and serve the block from
its top.

## n343-newestfirst-routedretriever-company

Above: `...(newestFirst && routedRetriever === "company"`

WHICH SET THE ORDER SAW, from the one exit that used to say nothing.

Only the company half can be reached under a date sort at all (see
routedServesThisOrder), and for it the whole employer set IS the set
the database ordered: the retriever's key is total and stable, blocks
are disjoint slices of that one ordering, and no scoring permutes it.
So "matchSet" is the honest value and sortMatcher names the set the
page has to name — this employer's postings, not title matches. The
client prints its sentence from these two and never from the sort it
asked for, so an exit that stays silent can only ever get the weaker
sentence.

## n344-semanticdegraded

Above: `let semanticDegraded: "embed" | "ann_deadline" | "ann_error" | "refilter_deadline" | null = null;`

The same idea for the rescue tier below, and declared up here for the same
reason — a declaration sited below its use is how this file took a TDZ
outage that hid the ranked path being down for an unknown period.

NAMES INFRASTRUCTURE FAILURES ONLY. "The tier looked and found nothing" is
an honest answer and leaves this null; a non-null value always means the
retrieval did not happen, so the page cannot claim it searched everything.

This is not hypothetical: search_jobs_semantic is answering 57014
"canceling statement due to statement timeout" on real query embeddings
right now, and the tier returns [] for it — indistinguishable from a
genuine no-match, on every affected search, with nothing anywhere saying so.

## n345-facet-company-limit

Above: `const FACET_COMPANY_LIMIT = 150;`

DECLARED HERE, ABOVE THE RANKED PATH, AND THAT POSITION IS THE FIX.

RANKED SEARCH WAS DOWN IN PRODUCTION AND NOTHING SAID SO. Every typed
search silently fell through to the recency/ILIKE path; measured live on
.19, no response on any query carried `ranked: true`.

`facetHead` is a function DECLARATION, so it hoists and the ranked return
below could name it — tsc and the deno gate both accept the call, which is
why this shipped. But it closes over `FACET_COMPANY_LIMIT`, a `const` that
used to be declared ~300 lines BELOW the ranked return, next to the recency
path that also calls it. A hoisted function can be CALLED before a `const`
it closes over is initialised; dereferencing that const then throws
ReferenceError from the temporal dead zone. The enclosing
`catch { /* fall through to recency path */ }` swallowed it, so the failure
presented as "ranked search returns nothing" rather than as an error.

The symptom that made it visible: a query whose TITLE tier matches nothing
but whose description tier matches plenty served an EMPTY page —
q="forklift certified" had 741 description matches in the RPC and returned
0 rows on the board. Queries with zero ranked rows were unaffected, because
the rescue ladder returns before ever reaching this call, which is why
typo rescue ("nurrse") kept working and hid the outage.

Keep this above the first `facetHead(` call. A guard test pins the order.
A HEAD, NOT A CENSUS. This was 1,500 entries and 70% of the response
body. The typeahead reaches the rest through action:company-suggest,
which reads the same cached facet, so nothing became unsearchable — and
the selected employer is appended below whatever its rank, or its own
filter chip would lose its label.

## n346-facetopen

Above: `const facetOpen = (metaV as { companiesOpen?: Record<string, number> }).companiesOpen;`

The selected employer must survive the cut whatever its rank, or its own
filter chip renders with no label and the reader cannot see what they
filtered to.

AND THE NUMBER ON THE WIRE IS THE SERVABLE ONE, OR THERE IS NO NUMBER.

companiesFacet.count is `count(*) GROUP BY company_token` with NEITHER
serving predicate (migration 20260825190000 leaves it unfiltered on
purpose: the orphan prune DELETES by it). Measured 2026-09-09 against the
board's own filtered count, the median employer was ~1% over and the tail
was not: PwC 3,254 against 2,119. Every reader-facing surface that printed
it — the /jobs dropdown, the detail panel's "N more open roles at X",
~500 prerendered SERP titles, /v1/companies' open_postings — was
contradicting the page it linked to.

So `count` DOES NOT LEAVE THIS FUNCTION. It is used here (ordering, and
mergeCompanyFacet's stable primary-token pick) and dropped from every
emitted row; what ships is `open`, the servable count computed under both
predicates in the same pass (migration 20260909214000). A row read from a
cached facet written before that migration carries no open count, and then
the entry ships with NO NUMBER AT ALL — the dropdown renders bare names
for one refresh interval. Silence beats a contradiction.

## n347-return-head-map-c

Above: `return head.map((c) => ({`

THE WIRE SHAPE. No `count` — see above.

`tokens` RIDES WITH THE SUM IT DESCRIBES. mergeCompanyFacet folds an
employer's sub-boards into one row (PwC ships five Workday sub-sites)
and SUMS `open` across them, but the row's `token` is only the largest
sub-board's. A client that showed the sum and then filtered on that one
token published a number its own link could not serve — the same defect
as the unfiltered count, one level up. clusters.ts already carries every
token for exactly this reason ("so the filter can cover them all"), so
it ships, and the filter takes the whole group. Present only where there
IS a group: a single-board employer needs no list.

## n348-headringp

Above: `const headRingP: Promise<{ data: unknown[] | null }> | null =`

THE HEAD-TERM RING STARTS HERE AND IS AWAITED ~700 LINES BELOW.

It is an independent query — a title prefix scan that ADDS candidates
to the ranked window — and it was issued only after search_jobs had
already returned, so the two ran back to back for no reason. Measured
at roughly 473ms of the pair, about 18% of felt latency on the hottest
path in the function.

NOT Promise.all, and that is the whole point. Racing them together
would let a ring rejection take down the ranked call with it, and the
request would demote to the recency path — trading 473ms for a strictly
worse page. The promise is started, its failure is neutralised AT
CREATION, and it is awaited on its own. An unawaited promise that
rejects before anyone looks at it is an unhandled rejection in this
runtime, so the catch cannot wait until the await site.

Gated exactly as the await site is gated, so nothing new fires. The one
cost: on a query whose ranked window comes back empty the code takes a
rescue path and never awaits this, so the round trip is spent for
nothing. It is bounded — the ring only ever runs for SHORT queries,
which are the ones least likely to come back empty.

ON DEEP PAGES TOO, as the EXCLUSION set rather than the merge: every
ring row is served below the RING_WINDOW seam, so a deep page must
drop them or re-serve them as apparent new results — the measured
"page-one cards repeat just past the seam" defect. A prefix ILIKE on
the title index for 200 rows is the cheap half of this pair.

## n349-applied-workmode-p-work-mode-applied-wo

Above: `...(applied.workMode ? { p_work_mode: applied.workMode } : {}),`

Measured 2026-07-25: without this the ranked path silently dropped
the work-mode filter — workMode=remote + q=engineer returned 30 rows
that ALL had work_mode NULL, the exact opposite of the request.

Sent ONLY when a work mode is actually selected. That matters while
the migration adding p_work_mode may not have applied yet: omitting
the argument keeps every ordinary search working against the OLD
function signature, and the one case that would error (a work-mode
filter against an old signature) falls through to the recency path
below, which filters work mode correctly. The filter is honoured on
every route; it is never quietly ignored again.

## n350-p-limit-pageplan-plimit

Above: `p_limit: pagePlan.pLimit,`

A SORTED MODE READS A FIXED WINDOW, NOT A MOVING ONE.

The in-memory sort permutes these rows, so a p_offset that advances in
RELEVANCE order no longer describes where the reader is. Measured on
production: q="nurse" sort=newest limit=20 returned nextOffset 25 and
page 2 REPEATED 17 OF 20 ROWS, while other rows became unreachable.

Anchoring the window at rank 0 makes `offset` a position INSIDE the
sorted window, which is stable across calls because the window is
always the same rows in the same order. RANKED_WINDOW is 200 because
search_jobs caps there internally — measured, p_limit 400 and 600 both
return exactly 200 — so paging a sorted search ends honestly at the
window edge instead of continuing with duplicates.
A SCORED page needs the same fixed window a SORTED one does: the
scorer permutes the rows, so an offset that advances in relevance
order stops describing where the reader is. Anchoring at rank 0 makes
`offset` a position inside one stable ordering.
A deep page is an ordinary offset page: search_jobs already orders by
ts_rank_cd with a total tiebreak (effective_posted DESC, id ASC), so
p_offset walks one stable sequence. Verified live: p_offset=200 twice
returned an identical id list in an identical order for all four
probe queries.

## n351-rankedtier2

Above: `const rankedTier2 = (ranked as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string");`

search_jobs counts inside a LIMIT — 10,000 on the title tier, 3,000 on
the sampled description tier — so a broad term like "engineer" or
"nurse" comes back as EXACTLY the ceiling. Reported bare that reads as
an exact figure ("10000 matching openings") when the truth is higher.
Flag it so the client renders "10,000+", same contract the recency
path already uses. Tier is inferred from the snippet column, which
only the description tier populates.
Same correction as the countOnly probe above: the tier is the snippet
column's TYPE (NULL on the title tier, a ts_headline string on the
description tier), not its length. This site only appeared healthy
because it samples 200 rows instead of 1 — a description-tier query
whose whole window has empty descriptions would under-report here too.
Leaving one of the two sniffs wrong is how the count and the list
start disagreeing again.
THE HEADLINE'S CEILING IS NOW ALWAYS THE TITLE CEILING, because the
headline is now always the title count — the snippet sniff no longer
decides which cap applies to it. Applying the description tier's 3,000
ceiling to a title count would flag a 3,000-exact-match query as capped
when it is not. The old branch is deploy-window cover ONLY; delete it
once the migration is verified.

## n352-non-narrowing

Above: `const NON_NARROWING = new Set([...WIDENING_FILTERS, "sort", "q"]);`

FILTER GATE — shared by every rescue tier (fuzzy replacement,
semantic, and the low-result fuzzy augmentation below). None of the
rescue RPCs carry filter parameters, so with any restrictive filter
active they all stand down: the filtered (possibly empty) answer IS
the honest answer. This gate is the fence that once broke on a
company lander serving other companies' jobs for a typo'd query.

THIS WAS A HAND-MAINTAINED LIST OF TEN FIELDS AND IT WENT STALE.

`sendableOnly` — the "Agent can apply" filter, i.e. the filter for the
product that costs $99/mo — was never added. None of the three rescue
RPCs below takes filter params, so with the agent filter as the ONLY
active filter, `filtersActive` read false and all three fired
unfiltered.

Proven live: {"q":"nurse practicioner","sendableOnly":true} returned
13 rows of which 1 was sendable, with filterIntegrity reporting 12
violations — and the unfiltered control returned an IDENTICAL id set.
The predicate was absent, not loose.

Derived MECHANICALLY from `applied` now, the way filters.ts's own
isUnfiltered already does. A conjunction that must be edited every
time a filter is added is a conjunction that will go stale again —
filters.ts's header documents that exact failure, and this is it.
includeUnstatedPay joins the widening set for the same reason
includeUncategorised is in it: this gate asks "did the caller NARROW
anything", and a toggle that only ever ADMITS more rows must not
fence off the rescue tiers.
Built FROM the shared set, not beside it: these two answers to "does
this key narrow anything" drifted once already (isUnfiltered counted
includeUnstatedPay as a narrowing while this gate did not), and the
bare board paid for it with a capped count.

## n353-semanticrows

Above: `const semanticRows = async (`

THE RESCUE TIERS NOW CARRY THE FILTERS INSTEAD OF STANDING DOWN.

The flag above used to mean "no rescue runs at all". Measured live
2026-08-22 on the deployed board: q="nurrse" alone returned 17 close
matches, and the SAME query with country=US, category=healthcare or
workMode=remote each returned zero rows with no disclosure. One typo
plus any filter emptied the board.

Standing down was right only while the RPCs could not filter. That is
no longer the shared situation:
  * the exact-word tier binds through buildQuery and always carried
    every filter — it never needed the fence;
  * the trigram rescue takes the filters as parameters as of
    20260822040000 and applies them BEFORE its own cap;
  * the semantic RPC still cannot, so it hydrates its ids back through
    buildQuery below.

SPREAD-OMITTED WHEN NOTHING IS NARROWED, and that is deploy-window
tolerance rather than tidiness: sending these arguments to the OLD
three-argument function makes PostgREST answer a no-such-function code
and the tier returns nothing. While the migration is unapplied, an
unfiltered typo query keeps its old call shape and keeps working, and a
filtered one degrades to the empty page it already shows today — no
regression in either deploy order.
ONE SEMANTIC RETRIEVAL, TWO ENTRY POINTS.

The vector tier is now reachable from two places — the empty-page
rescue below, and the low-result augmentation further down — and the
four properties that make it safe are subtle enough that a second
copy would drift from this one within a change or two:

  1. bounded: a cold isolate loads a gte-small session on first use,
     so the embed is deadlined or it sets the floor on how long the
     whole request takes;
  2. filter-SAFE, never filter-aware: the ANN scan cannot take
     predicates, so its ids are hydrated back through buildQuery —
     the one filter binder — and re-sorted into embedding order.
     Pushing predicates into an HNSW scan is filtered-ANN, a
     different and riskier problem;
  3. ANCHORED: the vector tier always returns something — it has no
     notion of "nothing is close" — so 'zzzqqxwv' came back with one
     confident unrelated job, 2/2. At least one row that will SHIP
     must share a real token with the query. A rescue that cannot
     say no is worse than no rescue;
  4. anchored on the rows that SURVIVE the filters, not the
     candidates, or the tier answers on evidence it is not showing.

Returns null when it declines for any reason. Callers treat null and
empty identically — neither is an answer.

## n354-qtokens

Above: `const qTokens = qText.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);`

THE ANCHOR IS DECIDED ON WHAT SHIPS, SO EXCLUSION HAPPENS IN HERE.

An adversarial review caught this before it shipped, and the shape
is worth keeping in front of whoever adds the third caller. The
augmenting caller drops candidates already on the page — and those
are exactly the rows most likely to be carrying the anchor, because
a thin page's rows are lexical matches whose titles contain the
query token by construction. Anchoring outside, then excluding
outside, produced: q="sommelier" with 4 exact rows on the page, ANN
returns those 4 plus 56 hospitality neighbours, `anchored` is
satisfied by the 4, the 4 are then dropped as duplicates, and 56
rows containing no "sommelier" anywhere ship under a claim that
they are about the same thing. That is the 'zzzqqxwv' failure with
a non-empty page in front of it.

Taking the exclusion set as a PARAMETER makes "anchored on the rows
that ship" an invariant of this function rather than a rule each
caller has to remember.

Cheap refusal first: the anchor needs a token of 3+ characters, so
a query that has none (q="ai ml") can never satisfy it. Deciding
that here costs nothing; deciding it after the embed costs a model
load, an HNSW scan and a hydration round trip for a guaranteed [].

## n355-sem-null-serr

Above: `if (sem === null && !sErr) {`

TWO DIFFERENT SILENCES, AND ONLY ONE OF THEM USED TO BE LOGGED.

withDeadline is a Promise.race that RESOLVES `{ data: null }` both
when the deadline passes and when the call rejects — it never
throws — so on a deadline miss `error` is undefined and the sErr
guard below never sees one. `data === null && !error` is exactly and
only that sentinel: a successful RPC returns an array (possibly
empty), a failed one returns { data: null, error }.

The trailing `.catch(() => ({ data: null, error: ... }))` that used
to sit here could therefore never fire, which is why a tier that had
stopped answering still looked like a tier that had nothing to say.

## n356-semsource-length-0

Above: `if (semSource.length > 0) {`

HYDRATED UNCONDITIONALLY, not just when a filter is narrowing.

This used to be gated on filtersActive, which was defensible while
the tier only ever answered an EMPTY page: with nothing else on
screen, raw ANN rows were the whole response and their shape was
self-consistent. The augmenting caller appends them to rows that
came through buildQuery, and search_jobs_semantic does not return
`country` at all — so an unfiltered thin page would mix rows that
have a country with rows whose country is silently null, on the
same list. Hydrating always costs one indexed id-lookup and makes
every served row come from the one binder.

## n357-applied-excludeagencies-p-exclude-agenci

Above: `...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),`

The opt-out reaches the rescue tiers as of 20260901200000. It was
absent here while excludeAgencies sat in RPC_BOUND_FILTERS, which
is the worst combination: the blind-set gate that used to route
such a request through buildQuery no longer fired, so the rescue
served the very rows the caller asked to hide — and served them
with no agency column, so neither the badge nor filterViolations
could see it happen.

## n358-if

Above: `if (`

── THE LOCATION SPLIT TIER ───────────────────────────────────

"nurse london" RETURNED A SCHOOL NURSE IN NEW SOUTH WALES.

MEASURED live 2026-08-27:
  q="nurse"                        title matches 10,000 (capped)
  q="nurse london"                 title matches 0, 121 description
  q="nurse" + location=london      title matches 30, 105 description

Typing the city into the search box does not search that city. The
words are ANDed against title_tsv, no title contains both, and the
function escalates to search_tsv — so "london" is matched wherever it
appears in four thousand characters of description. The top three
results for "nurse london" were London Ontario, MARSDEN PARK NEW SOUTH
WALES, and London Kentucky. "software engineer austin" is the same
shape: 0 title matches against 116 with the location filter set.

Putting the place in the box is the most ordinary thing a searcher
does, and it was the query most likely to be answered with noise.

NO GAZETTEER. The board decides what a place is, by asking: split the
query, treat the tail as a location, and see whether the head has real
TITLE matches inside it. That test is self-validating and it is what
makes this safe on queries that merely look like they end in a place:
  "drive a truck at night"     location "night"   -> no such place
  "help old people at home"    location "at home" -> head "help old
                               people" has no title matches anyway
Both fall through untouched. A static city list would need maintaining
and would still be wrong about Reading, Mobile and Jordan; this asks
the corpus instead, and the corpus is the thing being searched.

COSTS NOTHING ON A HEALTHY SEARCH. It runs only where the title count
is ZERO and the page is therefore description-only guessing — the
state this fixes. A search with title matches never reaches here.

TWO SPLITS, LONGEST FIRST, so "new york" and "san francisco" are tried
whole before "york" and "francisco". Issued concurrently: the pair
costs one round trip, and the two-word answer wins when both hit.
THIN, NOT EMPTY. This gate shipped as `total === 0` and was VERIFIED
DEAD on its own motivating examples the day it went live: "nurse
london" did not split, because "Registered Practical Nurse - AgeCare
London" matches the ANDed query — the company carries the city.
Measured live 2026-08-27: nurse chicago 10 combined-title matches,
accountant berlin 13, nurse london / software engineer austin 1-6.
The city leaks into titles, companies and departments just often
enough that the title count is almost never exactly zero, so the
only query the gate admitted was one where the place name appears
NOWHERE — "philly". Under 30 means the title segment cannot fill
half a default page and the rest is description guessing; the
acceptance bar below, not the gate, is what keeps the split honest.

## n359-number-isfinite-hits-hits-math-ma

Above: `if (!Number.isFinite(hits) || hits < Math.max(2 * total, 15)) continue;`

DECISIVELY better, not laterally different. The page being
replaced can hold real combined-title matches now (a "PMHNP
Nurse Practitioner - Chicago" IS a Chicago nurse job), so the
split must beat the current title segment by a clear margin —
twice the current count, and at least 15 rows — or the guess
is not worth overriding what the person literally typed.
(Those combined-title rows are located in the place they
name, so the winning split page retains them.)

## n360-ranked-length-0-offset-0

Above: `if (ranked.length === 0 && offset === 0 && !countOnly) {`

Empty ranked result: try the FAST trigram fuzzy fallback right here
("desinger" → designer), then return an honest empty. Critically we
do NOT fall through to the recency path — its OR-of-ILIKE with an
exact count seq-scans 550k rows for a no-match term and times out
(measured 9.7s → "temporarily unavailable"). The ranked + fuzzy
paths are both index-backed and fast.
`total === 0` only — a null total means "count unavailable", which is
not the same claim as "nothing matches" (see the recency-path twin).
ROWS, NOT THE HEADLINE. This gate guards the rescue tiers — exact word,
trigram fuzzy, semantic — and every one of them RETURNS EARLY with its
own result set. Under two segments a query with zero title matches and
39 description matches has a total of 0 and a full page of rows, and
this gate would have thrown those rows away and served a typo
correction of a query that needed none. Twenty of forty measured
country x skill combinations are exactly that shape.
`total === 0` implied `ranked.length === 0` before this change, so the
rewrite is behaviour-preserving against today's SQL and correct after.

## n361-logmiss

Above: `const logMiss = (rescued: "none" | "fuzzy" | "semantic" | "degraded") => {`

Demand telemetry, ranked path — logged AT EACH TERMINAL with its
rescue outcome. The single up-front insert counted typo queries
that fuzzy then rescued as if they were catalog gaps, so the
steering signal conflated "we lack this" with "they misspelled
this". `rescued` tells the census which is which: 'none' is a real
gap; 'fuzzy'/'semantic' means the user was served something and
the gap is softer.
AND 'degraded' IS A FOURTH ANSWER, because a rescue tier that could not
run is not evidence of a catalog gap. Filing a failed retrieval as
'none' quietly poisons the demand census with queries the board may
well be able to answer — and the census steers what gets added to
the board next, so a broken tier would have argued for sourcing
jobs the board already had.

## n362-simpletierprovedempty

Above: `let simpleTierProvedEmpty = false;`

PROOF OF ABSENCE, CARRIED DOWN THE LADDER. Reaching a tier because
the ones above found nothing and reaching it because they FAILED
are different facts, and only the first is evidence about the
corpus. Each flag is set exclusively on a resolved, error-free,
genuinely empty answer — a deadline miss, a thrown half or a
skipped tier leaves it false, so a degraded ladder keeps every
rescue it has today. What the pair eventually proves is that no
lexical engine can see the query anywhere: search_jobs already
said zero for title AND description (that is how this block was
entered), the exact-word pair adds title AND company under the
simple config, and the trigram tier adds "no title is even
NEAR it". The semantic gate below spends that proof.

## n363-qtext-length-2-try

Above: `if (qText.length >= 2) try {`

── THE SIMPLE-CONFIG TIER ────────────────────────────────────

Runs FIRST among the rescues, because it is exact word matching and
therefore more precise than trigram similarity or embeddings.

WHY IT EXISTS. Every tsvector in this schema is built with the
'english' configuration, which discards stopwords before storing
anything — so "it" is not in the index at all and no query-side
rewrite can retrieve it. Measured through PostgREST against live
production: title=wfts(english).IT matches NOTHING, while
title=wfts(simple).IT returns 4,072 rows. The board serves about 18
for q="IT" against 4,145 postings carrying it as a title word.
Simple also stops the stemmer conflating words: "intern" matches
7,280 under english (Internal, International) and 4,907 under
simple, which is the precise set.

It reuses buildQuery with skipTerms, so every filter — freshness,
missing_since, country, category, experience, salary, companies —
binds in the ONE place they are bound, and only the matcher differs.

ONLY ON AN EMPTY PAGE, and that bound is deliberate. The visitor is
already looking at zero results, so the worst case this can add is
a wait before the same empty page. It cannot make a working query
slower because it never runs on one.

IT DEPENDS ON AN INDEX THAT MUST EXIST FIRST. Measured WITHOUT
job_board_postings_title_simple_fts_idx, this filter is a
sequential scan over 602,880 rows: q="IT" took 2.1s and q="ux" and
q="qa" both returned HTTP 500 (statement timeout) at ~3.2s. Deploy
the index migration and verify it BEFORE this function. The catch
below means a failure degrades to the empty page the visitor
already had rather than an error, but that is a safety net, not a
licence to ship the two out of order.
THE SHARED RESCUE FENCE DOES NOT APPLY TO THIS TIER, AND NEVER DID.
The fence exists because the other two rescue RPCs cannot filter.
This one is not an RPC — it is buildQuery with a different matcher,
so freshness, presence, country, work mode, field, experience,
salary, companies and both date filters were already binding on every
call. Standing it down under a narrowing threw away an answer that
was already correct. Nor is there a cost argument: the literal query
shape under adversarial filters at concurrency 4 measured 0.22-0.51s
across a dozen combinations, and it still only fires on an already
empty page.

## n364-promise-allsettled

Above: `Promise.allSettled([`

TWO INDEXED QUERIES, NOT ONE or(). An employer name lives in
company, and leaving company out is why q="AT&T" reached the 23
postings with AT&T in their TITLE — a Busser at the AT&T
Discovery District — and none of the 493 whose EMPLOYER is AT&T.

The obvious form, or=(title.wfts,company.wfts), was written and
MEASURED FIRST, and it is a trap: an OR across two columns plus
ORDER BY effective_posted cannot be served by one index, so the
planner gathers every match and sorts. Timed with the tier's
real column list and ordering:
  or() AT&T    2.23s        or() dominos  HTTP 500 at 3.24s
That is the "ORDER BY the date index does not serve" shape this
board already took a 17s outage from.

Split in two, each side hits its own gin index and returns in
about a quarter of a second, and the merge happens here over at
most a few hundred rows. Issued CONCURRENTLY so the pair costs
one round trip, not two.
allSettled, NOT all. supabase-js resolves an HTTP error into
{ data: null, error } rather than rejecting, but a network
throw WOULD reject — and with Promise.all one rejection
discards the other side's results. MEASURED right now, before
the company index exists: the title side answers in 0.21-0.27s
while company 500s at 3.31s on "dominos". The half that works
must still answer.

## n365-buildquery-effective-posted-false-undefined

Above: `buildQuery("effective_posted", false, undefined, { skipTerms: true })`

COMPANY HALF RE-ENABLED — its index exists now, verified at
concurrency rather than serially.

I disabled this when four concurrent callers got
500 500 500 500 from an unindexed sequential scan I had
shipped. With job_board_postings_company_simple_fts_idx
built, the same four now return 200 in 0.21-0.47s across
"IT", "dominos" and "nurse". The stub said to re-enable only
after that check passed; it has.

## n366-simpletierprovedempty-halves-every-h

Above: `simpleTierProvedEmpty = halves.every((h) =>`

Proof, not absence-of-rows: only when BOTH halves resolved
as error-free arrays does an empty merge mean "the corpus
holds no such word". A rejected or errored half yields the
same [] downstream, and treating that as proof is how a
degraded tier gets mistaken for a decisive one. Set in this
closure so the fact lands even if the deadline race was
lost — late evidence is still evidence, and it is only ever
read further down the ladder.

## n367-math-min-7-000-budgetleft

Above: `Math.min(7_000, budgetLeft()),`

7s, not 4s. MEASURED: the pair costs ~1.3s warm (title 0.25s,
company 1.13s, issued concurrently), but eight identical calls
to q="IT" produced 7.9s, 6.5s, then six between 2.6s and 3.0s —
cold-start spikes. Under the old 4s budget the two slow calls
blew the deadline and fell through to the fuzzy tier, so the
SAME QUERY returned 60 rows or 19 depending on the call.

Non-determinism is worse than either answer. It makes the
telemetry unreadable — a zero-result rate that depends on
warm-up cannot be compared week to week — and it makes every
relevance measurement a coin toss, which is how "IT is fixed"
got reported off a lucky draw.

## n368-exclusioncountscaveat-excludedterms

Above: `...exclusionCountsCaveat(excludedTerms),`

NOT `ranked: true`. This tier concatenates two
`ORDER BY effective_posted DESC` reads and applies no
relevance scoring at all, so claiming it made the page say
"Sorted by relevance — title matches first" over rows that
were not. It also blinded the only detector for a ranked-path
outage, which is the failure that once left ranked search
fully down and silent. `exactWordMatch` is the honest marker
and the client can name this tier from it.

## n369-qtext-length-3-try

Above: `if (qText.length >= 3) try {`

FILTERS BOUND, NOT FENCED OUT — AND A THREE-CHARACTER FLOOR, which
this tier never had and the other two always did.

The floor is the whole reason this ungating is not a regression.
Degenerate queries are this RPC's worst case by a wide margin:
measured at concurrency 4, q='a' 3.07-3.36s, q='++' 3.94-3.96s,
q='  ' 2.64-2.72s, against 1.65s for the worst real misspelling.
End to end, {"q":"++"} costs 5.08-5.25s today while
{"q":"++","country":"US"} costs 1.10-1.33s precisely because the
fence keeps it out. Ungating without a floor moves every filtered
two-character query onto the expensive path and holds a database
connection for four to five seconds to return nothing.

The filters themselves apply BEFORE the ORDER BY and the cap, which
is why this is a signature change rather than an id hydration:
hydrating the unfiltered top 60 and narrowing after kept 2 of 60 GB
rows for q=nurrse, where the complete trigram set is about 28% GB.

## n370-fuzzy-rpc-cap

Above: `const FUZZY_RPC_CAP = 60;`

The reported total here was the REQUEST LIMIT wearing a total's
clothing. fuzzy_title_search computes total_rows inside its own
LIMIT, so at p_limit=60 it returns 60 whenever 60 or more rows
match, and the `|| jobs.length` fallback echoes the page size
when it returns nothing at all. Measured on the live board:
  q="nurse practicioner"  limit=5  -> total 5
                          limit=20 -> total 20
                          limit=60 -> total 60, 38 rows shown
so the header read "Showing 38 of 60" — a figure that is neither
the number of close matches nor anything else about the data,
and that MOVES when the caller changes its page size. That is
the same defect class as publishing 587,793 over a filtered
page: a number presented as a total that is not one.

total_rows is only trustworthy BELOW the cap. At or above it the
honest answer is that we don't know, which the response already
has a contract for — countUnavailable renders "Showing N
matching openings" with no total rather than inventing one.
AGAINST THE RPC'S OWN CAP, NOT THE CALLER'S LIMIT. The SQL
clamps p_limit to 60 (LIMIT GREATEST(LEAST(p_limit, 60), 1)),
so total_rows can never exceed 60 — and testing it against a
request limit of 100-200 (the public API allows up to 200)
declared 60 "below the limit, therefore exact" and published a
fabricated total:60 with hasMore:false over 200+ real matches.
The same trap this comment block already documents, one cap
deeper.

## n371-hasmore-false

Above: `hasMore: false,`

This page is a RESCUE, not page 1 of a result set. It omitted
hasMore/nextOffset, so the client's "Load more" issued the
ordinary query at offset 60 — which returns the exact-match
path (empty, since total was 0), and the merge dropped the
closeMatch flags, re-labelling the rescued rows as exact
matches. Saying there is no more explicitly keeps the
disclosure attached to the only page that carries it.

## n372-qtokencount

Above: `const qTokenCount = qText.trim().split(/\s+/).filter(Boolean).length;`

Tier 3 — semantic. Only reachable when BOTH full-text tiers and the
trigram fuzzy fallback found nothing, so it strictly ADDS results
where the user currently gets an empty page. The response carries
`semantic: <query>` and the client shows a disclosure line (like
the fuzzy one) — these are nearest-by-meaning, never passed off as
keyword matches. Every failure falls through to the honest empty.

FILTER GATE (review finding): search_jobs_semantic carries no
filter parameters, so firing it while any filter is active would
silently ignore that filter — a company lander would show OTHER
companies' jobs under "open roles at Acme". This file's own
invariant is that a filter is honoured on every route, so with any
restrictive filter active the semantic tier stands down and the
honest empty (which respects the filters) is the answer.
(filtersActive computed once above, shared with the fuzzy tier.)

EMPTINESS, ONCE PROVEN, IS AN ANSWER — STOP PAYING FOR IT.

MEASURED 2026-08-31 (battery): q="Collabera" returned zero results
in 6,489ms — the ladder walked every tier to concede what the
first ones had already demonstrated. This tier can only SHIP rows
that pass its lexical anchor: some served title or company must
contain a query token of 3+ characters as a substring. By the time
both proof flags are set, three engines have resolved empty on the
same corpus — search_jobs (title AND description words), the
exact-word pair (title AND company words), and the trigram tier —
so a title anchor cannot exist (a substring IS heavy trigram
overlap, which the fuzzy tier just searched for), and a company
anchor would need the token buried inside a longer word of a name
whose rows the ANN also happened to rank near a query no engine
can see. That residue is not worth an embed: deciding AFTER it
costs a cold-isolate model load, an HNSW scan and a hydration
round trip for a page the anchor then refuses — the helper's own
cheap-refusal rule, applied one fact earlier. A failed or
deadlined tier leaves its flag false, so a degraded ladder still
tries the rescue it has today.
The emptiness proofs are whole-query facts; for a multi-token query a
rescue could still match a subset, so the skip stays single-token
(the measured zero-result offender class: bare company names).

## n373-newestfirst

Above: `if (newestFirst) {`

NEWEST-FIRST OVER search_jobs' TOP `seam` BY RELEVANCE — a WINDOW, and
not the matching set. That distinction is the whole reason this exit
publishes sortScope "relevanceWindow" and sortScopeRows a few dozen
lines below: the rows reaching here were chosen by ts_rank_cd, so
date-ordering them produces "the newest of the closest matches", and
`total` beside them counts the match set. The only exit that orders the
match set itself is the newestTextSort branch above, which is why this
one may not borrow its sentence.

The sort stays — it is what makes the window date-ordered, and paging
is monotone because it runs before the offset slice. Undated rows sort
last rather than first: an absent date is not evidence of newness, and
treating it as such is how a board ends up leading with rows whose age
it does not know.

## n374-headrows

Above: `let headRows: Array<Record<string, unknown>> = [];`

The window is anchored at rank 0 for sorted modes, so the caller's
offset is a position within it and has to be applied HERE, after the
sort. Everything downstream — clustering, rawConsumed, nextOffset —
then advances inside one stable ordering.
THE SCORER, ON THE PATH THAT SERVES MOST SEARCHES.

This is what q="sales" actually needed. All 959 postings titled
exactly "Sales Associate" are already IN this window — verified by
intersection, 959/959 — and never surface, because ts_rank's default
normalization applies no length penalty so a title repeating "sales"
four times outranks the exact match. It is also what separates c++
from c#: 38 of these 200 rows contain the literal "c++" and 25
contain "c#", and only the literal-substring rule can tell them apart
once the parser has destroyed both.

The candidate set is the RELEVANCE top-200, not a recency slice. A
review killed the recency version of this idea outright — its pool
spanned two hours of ingest and held 3 of the 959 exact titles. This
one starts from what the engine already judged most relevant and only
reorders it.
THE HEAD-TERM RING. A scorer cannot rank what the retriever never
fetched, and for a one- or two-word query ts_rank never fetches the
right rows.

MEASURED for q="sales": of the 200 rows search_jobs returns, ZERO are
titled exactly "Sales Associate" and ZERO are three words or shorter,
against 958 such postings on the board. ts_rank's default
normalization rewards repetition, so "Sales Director - Sales" and
"Corporate Sales ... Sales Section ... Sales Department" outrank the
exact match — and push it past rank 200, out of reach of any
re-ranking. Scoring the window fixed c++ (38 of its 200 rows carried
the literal string) and could never fix sales.

A prefix scan supplies exactly what is missing. Same query, 400-row
window: 27 exact "Sales Associate", median title THREE words, and the
top five are that title verbatim. Measured under concurrency 4, which
is the only measurement that counts here: sales 0.41-0.59s, nurse
0.42-0.55s, engineer 0.75s, manager 0.82-0.93s, all 200.

It ADDS candidates, it does not replace them: prefix alone would lose
every "Software Engineer" for q="engineer" (2,313 prefix rows against
a far larger real set). The two are merged, deduped, and the scorer
decides.

Only for SHORT queries. A three-word query already carries enough
signal for ts_rank, and this is one extra round trip on the hottest
path in the function — it is not free and should not fire when it
cannot help.

## n375-ringresolved

Above: `let ringResolved = headRingP === null; // no ring wanted == trivially "known: nothing"`

WHETHER THE RING RESOLVED, distinct from whether it returned rows.
withDeadline resolves {data:null} on a timeout and the .catch maps a
rejection to the same shape, so an EMPTY result and a MISS look
identical downstream. They are not the same: an empty ring means
"there are no title-prefix rows", a missed ring means "we do not know
what the ring would have excluded". Treating a miss as empty is what
let a slow deep-page ring re-serve below-seam rows as duplicates
(2026-08-29 sweep #2). Tracked here so the exclusion path can fail
safe instead of silently proceeding with an empty exclusion set.

## n376-ringids

Above: `const ringIds = ringResolved`

FAIL SAFE WHEN THE EXCLUSION SET IS UNKNOWN. If the deep-page ring
re-fetch resolved, drop exactly the ids it names. If it MISSED, the
ids are unknown and proceeding with an empty set re-serves
below-seam rows as duplicates — so fall back to the ring's OWN
predicate (title starts with the query prefix, the exact ILIKE the
ring runs) evaluated in JS. That drops every possible collision; its
only cost is a rare over-drop for a query with >200 title-prefix
rows, which is a narrow, bounded hole and strictly better than
serving the same job twice. Only reachable on an actual ring miss.

## n377-rankedscored

Above: `const rankedScored = pagePlan.rerank ? rerankWindow(mergedRows, [qText, ...expansions]) : mergedRows;`

A deep page is served in the RPC's own ts_rank_cd order. This is a
REAL quality drop and it should be said plainly rather than called
noise: index.ts:8290-8320 documents that without rerankWindow all 959
postings titled exactly "Sales Associate" sit inside the window and ts_rank
rewards repetition. Past the seam the tail is served PRE-SCORER. It is
not re-enabled here because rerankWindow permutes the fetched window
while nextOffset advances by rankedGrouped.rawConsumed, which is the
"sorted page two repeated 17 of 20 rows" incident at index.ts:7845-7855.
The pagination-safe form is to reorder rankedGrouped.jobs AFTER
collapseClusters (the shape the fuzzy augment at :8480-8488 already
uses); that is a follow-up, deliberately not in this patch.
mergedRows is the SQL page here, the ring having stood down above.

## n378-rankedwindow

Above: `const rankedWindow = rankedScored.slice(pagePlan.sliceStart, pagePlan.sliceEnd);`

CLAMPED TO THE SEAM before the offset is applied, but ONLY for queries
that have a seam. Without the clamp a page STARTING below the seam runs
past it — offset 150 + limit 100 served pool positions 150-249 — and the
next request, now in the SQL regime, begins at rank 250 and silently
skips 200-249. COST, said out loud: for a deep-pageable query at
limit >= 67 the clamp caps page one's raw intake at 200 where it could
previously consume the whole ~400-row merged pool, so page one returns
fewer CARDS than today (measured pre-patch: 189 cards at limit 200 from
a 293-row pool). Non-deep-pageable queries — sort=newest, EMPLOYER,
SIMPLE, SYMBOL — are not clamped and behave exactly as today.

## n379-poolexhausted

Above: `const poolExhausted = ringMerged && !deepPage && (`

Ring-merged sub-seam page that exhausts the pool: the walk continues
in the SQL regime, which starts at the FIXED seam — never at
offset+rawConsumed, which is a position in pool coordinates that the
deep regime would misread as SQL rank.

rankedScored.length is the POOL length, and the pool moves with the
ring (measured 200/293/399) — so keying exhaustion off it is only
safe when the ring RESOLVED this request. If the ring MISSED, the
pool collapsed to the SQL top-200, and comparing a mid-walk offset
against that shrunk length would jump to the deep regime early and
skip rows (2026-08-29 sweep #2). When the ring missed, anchor the
handoff to the STABLE boundary instead: the reader belongs in the deep
regime exactly once they are past SQL rank 200 (RANKED_WINDOW), a
coordinate that does not move with the ring. Below it, keep serving
the SQL top-200 content the shrunk pool still holds.

## n380-deeppage-scoreranked-rankedgrouped

Above: `if (deepPage && scoreRanked && rankedGrouped.jobs.length > 1) {`

DEEP PAGES ARE SCORED NOW — the follow-up the comment above promised.

Past the 200-row seam the tail was served in the RPC's raw ts_rank_cd
order, and ts_rank rewards repetition: "Sales Director - Sales" beats
the posting titled exactly "Sales Associate". The scorer could not be
applied to the WINDOW because rerankWindow permutes rows while
nextOffset advances by rawConsumed — that mismatch is the "sorted page
two repeated 17 of 20 rows" incident.

Applying it to the CARDS instead is pagination-safe by construction:
this reorders only the rows already selected for this page, after
clustering has chosen them. rawConsumed is untouched, so the next page
starts exactly where it would have, and no row moves between pages.

HONEST LIMIT: it reorders within a page and cannot pull a better row
forward from a later one. Page 3 is ordered well; a row that belongs
on page 3 but sits on page 5 still sits on page 5. That is inherent to
offset paging and is why the seam exists at all.

## n381-fuzzy-augment-below

Above: `const FUZZY_AUGMENT_BELOW = 20;`

THE TOP-UP THAT USED TO SIT HERE WAS DEAD CODE, and it is deleted
rather than "revived". Its gate was `!newestFirst && !scoreRanked`,
and inside this block (sort !== "salary", !countOnly are the entry
guards) scoreRanked is exactly !newestFirst — the conjunction is
unsatisfiable, so the second fetch it promised for short pages never
ran once. Reviving it would need new offset arithmetic first: it
paged from `offset + rankedRows.length`, relevance-order coordinates
that are wrong in both the windowed and the deep regime — the
"sorted page two repeated 17 of 20 rows" incident shape. Until
someone does that work, a short page with a correct nextOffset is
the honest behaviour, and the client's Load More continues the walk.
LOW-RESULT AUGMENTATION. The rescue tiers used to fire only on
total === 0, so ONE posting that happened to share the user's typo
("desinger" appearing verbatim in a single title) suppressed the
hundreds of corrected matches fuzzy would have found. When a typed
query lands 1-4 exact matches unfiltered, run the trigram tier too
and APPEND its novel rows — each marked closeMatch:true and the
response carrying fuzzyExtra, so the client labels them as close
matches instead of passing them off as exact ones. Exact matches
keep their position; nothing is reordered or replaced.

Raised from 5 to 20. THE ORIGINAL JUSTIFICATION FOR THIS WAS WRONG and
the correction is worth keeping, because it nearly shipped as fact.

I measured "nurse practicioner" returning EXACTLY 5 against 1,771 for
the correct spelling, and concluded the gate `total < 5` was missing it
by one. It was not. Every probe used limit=5, and for a query the
EMPTY-path rescue handles, `total` was the fuzzy tier's row count —
which is capped at p_limit. Re-measured across limits:
  "nurse practicioner"  limit=5 -> 5   limit=20 -> 20   limit=60 -> 60
The total tracked my page size. That query returns ZERO exact matches,
the empty-path rescue already fires, and this gate never applied to it.
A number that moves with the request is not a measurement of the data.

What the change DOES reach are queries with genuinely low real totals —
measured stable across limits: "bioinformatician" 18, "adminstrative
assistant" 19. Those got no close matches before and do now. That is a
real but modest win, and a weaker case than the one I first wrote down.

20 is where exact matches start filling a 60-row page. The trigram tier
is index-backed (gin on title) and offset-0 only, so the extra reach is
cheap. It no longer stands down under a narrowing: the RPC takes the
filters now, so a lightly-matched FILTERED query gets correctly-filtered
close matches appended instead of nothing. Reproduced live before the
change: {"q":"desinger","country":"US"} returned exactly 1 exact row —
inside the augmentation band — and the visitor saw that single junk
result with no close matches offered.

## n382-pagetotal-null-pagetotal-0-p

Above: `if (pageTotal !== null && pageTotal > 0 && pageTotal < FUZZY_AUGMENT_BELOW && offset === 0 && !countOnly && !newestFirst`

GATED ON THE WHOLE PAGE, NOT ON THE EXACT SEGMENT, and no longer fenced
by a narrowing. A query with 2 exact and 300 related matches has a full
page already; padding it would dilute a result set that does not need
rescuing and push close matches above 300 legitimate description hits.
NOT ON sort=newest — the same exclusion the split tier and the earned
did-you-mean already carry, and this gate lacked. The augment
re-partitions the page into [title hits, close matches, body-only],
which destroys the date order the user explicitly chose: the newest
rows on the page (often description-matched) sank below appended
trigram matches that carry no date ordering at all, with nothing in
the response saying the chosen sort no longer held. A thin
newest-sorted page stays thin; the user asked for a date walk.
budgetLeft() > 2_000: this augment decorates a page that ALREADY has
1-19 real results — the only ranked-path decoration that had neither
a deadline nor a budget gate while both its siblings (location_split,
semantic extras) have both. A bonus must not outspend the page.

## n383-terms

Above: `const terms = queryTerms(qText).terms.map((t) => t.toLowerCase()).filter(Boolean);`

ORDER BY MATCH STRENGTH, NOT BY WHICH TIER ARRIVED FIRST.

Appending put the close matches BELOW every exact row, and on
a misspelling the exact rows are the junk. Measured live the
hour this shipped, q="maneger", limit=60: SEVEN Dutch care
postings (Slaapwacht, Woonbegeleider, Persoonlijk begeleider)
above THIRTY-NINE Managers. None of the seven has "maneger"
in its title — they matched on description text — while all
thirty-nine are what the searcher meant. Same shape on
q="nures": "CARE NOW FULL TIME REGISTER NURE" first, five
Nurses beneath it, the one row on top matching a typo in the
employer's own posting.

The rule is the ordinary one this path had inverted: A TITLE
MATCH BEATS A DESCRIPTION-ONLY MATCH. A close title match is
stronger evidence of intent than a body-text coincidence, so
it sits above it — and below a real title hit, which is
stronger still. On q="profesor" every exact row DOES carry
the term in its title, so that query is untouched: the
Spanish teaching posts stay on top, correctly.

ROOM IS DELIBERATELY UNCHANGED. Only the order moves. The
close matches were already being fetched, already collapsed,
already counted — nothing enters or leaves the page here, so
rawConsumed, nextOffset and hasMore keep describing exactly
what they described before. A version that let close matches
DISPLACE exact rows would have to answer where the displaced
rows go on page two, and this fix does not need to ask.

## n384-if

Above: `if (`

Appending close matches makes `total` stop describing this page: it
counts EXACT matches only, while the page now holds exact + close. The
header rendered that as "Showing 40 of 18" — a shown figure larger
than the total it is shown against, which is not a rounding problem
but a claim that cannot be true. Raising FUZZY_AUGMENT_BELOW from 5 to
20 today widened the band this is reachable in, so it is partly mine.

Rather than inventing a combined number (exact + close are not the same
kind of match and adding them would assert they are), the page reports
that it has no single honest total. countUnavailable already renders
"Showing N matching openings" with no total, and fuzzyExtra still tells
the client how many of the N are close matches.
Setting countUnavailable while STILL publishing total:18 is a payload
that contradicts itself: the frontend reads countUnavailable first and
renders no total, so a user is unaffected, but an API consumer reading
`total` sees a number the same response has just declared unknown.
Verified live on .10 — rows=60 alongside total=18. Null it.
SEMANTIC ON A THIN PAGE, NOT ONLY ON AN EMPTY ONE.

The vector tier used to be reachable only when BOTH lexical tiers
returned nothing. A query landing three weak matches therefore got no
help at all, even though three results is the case where a searcher
most obviously wanted more — an empty page at least tells them to
rephrase. This is the same widening the trigram tier already got when
FUZZY_AUGMENT_BELOW went from 5 to 20.

Retrieval is the SHARED helper, so the four properties that make the
vector tier safe — bounded, filter-safe, lexically anchored, anchored
on rows that survive the filters — hold here by construction rather
than by a second implementation agreeing with the first.

APPENDED LAST, BELOW THE CLOSE MATCHES. The ordering rule this file
arrived at is that a title match beats a description-only match; a
MEANING match is weaker still, so it sits under both. Nothing is
displaced: exact rows keep their positions, and a version that let
meaning-matches push exact rows off the page would have to answer
where the displaced rows go on page two.

BUDGET GATE. An embed is a model load on a cold isolate. Starting one
with two seconds left would spend the remaining request budget and
still miss, so the tier declines rather than making a thin page slow
as well as thin.

## n385-earneddym

Above: `let earnedDym: string | null = null;`

DID-YOU-MEAN, EARNED RATHER THAN CURATED — DERIVED, NEVER FETCHED.

The first version of this paid its own fuzzy_title_search call and
shipped DEAD: it gated on the RPC's total_rows >= 10, and total_rows
is capped by the call's own LIMIT of 8 — the exact "a count that
tracks p_limit" trap this file already documents. An adversarial
review caught that, the duplicate RPC (the augmentation above had
just fetched the same rows), the class mismatch (gating on the exact
segment fired the RPC on healthy 15-exact/300-related pages), and a
tokenizer that shattered "büroassistent" into a garbage correction.

Now: pure CPU over the rows the augmentation ALREADY fetched, so the
cost is zero and the class is exactly the augmentation's own
thin-PAGE gate. A query token within two edits of a word appearing
in >= 3 of >= 5 sampled titles is a misspelling with a measured
correction; the curated map keeps precedence, KEYED THE SAME WAY the
emitter keys it (body.q — qText has been through sanitization and
the exclusion split, and a mismatch here double-emits).

## n386-toksupport

Above: `const tokSupport = titleWords.filter((ws) => ws.has(tok)).length;`

SUPPORT RATIO, not presence: "recepcionist" appears verbatim in
three titles because three EMPLOYERS misspelled it the same
way, and a presence veto trusted them (measured live — no
suggestion on a 30-title correct pool). A token is only
"spelled right" when the pool actually corroborates it; a
correction must beat it three-to-one. This also generalises
the curated "manger" entry: 101 employer-typo rows lose to a
correction the pool overwhelmingly carries.

## n387-rankedserved

Above: `const rankedServed = preferMatchedLocation(await attachRecheckedAt(client, rankedGrouped.jobs, excludedTerms), locationT`

THE PAGE, BUILT BEFORE IT IS LOGGED. The impression list must be
the array this response actually carries — attachRecheckedAt drops
the rows a "-manager" style exclusion removed and
preferMatchedLocation reorders what is left — or `shown` names rows
nobody saw and its index no longer lines up with the rank the click
beacon sends back. Built exactly where it used to be built (inline
in the response below), so nothing runs any earlier than it did;
only the telemetry call moved.

attachRecheckedAt was once MISSING here entirely: the per-posting
"re-checked N minutes ago" receipt reached people who browsed and
not people who searched — the fourth thing that day to be wired
into the recency path and skipped on the ranked one.

## n388-newestfirst

Above: `...(newestFirst`

A DATE ORDER APPLIED TO A RELEVANCE WINDOW SAYS SO.

When newestTextSort declined this body (the EMPLOYER route, the
SYMBOL route) or its query found nothing and fell through, the rows
reaching this exit are search_jobs' top `seam` by ts_rank_cd, date-
sorted in memory a few lines above. That is "newest of the closest
matches", never "newest of the match set" — and `total` beside it
counts the match set, so the two can only coexist in one honest
sentence if the page is told which of them the ORDER saw.
sortScopeRows is that seam, so the sentence can carry the number
instead of hand-waving. Emitted only under the sort it describes: a
relevance page makes no order claim for this to qualify.

## n389-hasmore-deeppage

Above: `hasMore: deepPage`

On a sorted search the window is finite and known, so "more" means
more rows LEFT IN IT — never the fetch-size heuristic, which would
promise a page four that cannot exist.
In the SQL regime "more" is the ordinary fetch-size heuristic: a
full page back from the RPC means there is another behind it, and a
short one is the true end of the match set (verified: "warehouse
associate" p_offset 3000 returns 0 rows, "loan officer" p_offset
3000 returns 32 and then nothing).

Below the seam it is "more rows left in the clamped window, OR the
match count says there is more behind the window". That second
clause is the other half of the defect: rankedSequence goes to zero
at the window edge while `total` is still advertising 1,417, and
reporting hasMore:false there is what ended the walk. It is gated on
deepPageable so sort=newest and the EMPLOYER/SIMPLE routes — whose
windows genuinely end at their edge — never promise a page that
would come back empty.

Ring-merged sub-seam: "more behind the window" means the sequence
extends past SQL rank 200 (pageTotal counts the walkable set), not
a pool-coordinate comparison against pageTotal — the pool can hold
ring rows the count never counted, and the comparison of two
different coordinate systems is the class this seam fix retires.

## n390-total-augmented-totalunderstated-null-to

Above: `total: augmented || totalUnderstated ? null : total,`

null once close matches are appended: `total` counts EXACT matches,
and the page now holds exact + close, so it no longer describes what
is on screen. Leaving it in beside countUnavailable published a
payload that contradicted itself (rows=60, total=18).

AND null WHENEVER THE PAGE ALREADY DISPROVES THE COUNT. The same
contradiction returned by another road: the counter asks the FTS
predicate while the retriever ALSO runs a prefix scan, so any
title the parser welded into one lexeme is served but never
counted. Measured live 2026-08-24: q=camarero published total 3
above 60 delivered rows, 57 of them titled "Camarero/a"
("Camarero/a" indexes as a single lexeme, so the plain word cannot
count it); cocinero published 10 above 50. The rows were right —
recall is NOT the defect here, the arithmetic is.

A number the page it labels already disproves cannot be repaired
by a better count; it can only be withdrawn. The floor is
publishable and true, and the client renders "60+".

## n391-augmented-totalunderstated-related

Above: `...(augmented || totalUnderstated || related === null || related === 0`

THE SECOND SEGMENT, PUBLISHED AS ITS OWN FIELD RATHER THAN FOLDED
INTO THE FIRST. Omitted — not zeroed — when the description segment
was not built, and omitted when it is EMPTY. An absent field is "we
did not look"; a zero is "we looked and there are none"; and a
segment header over an empty segment is neither. Suppressed under
augmentation for the same reason `total` is: once close matches are
appended, no published figure describes what is on screen.
Stands down whenever `total` was WITHDRAWN, not only under
augmentation. When totalUnderstated nulls the exact count (the page
already disproves it — a welded-lexeme title served but not
counted), shipping relatedTotal beside a null total made the client
render "0 exact" over a page of exact matches: the segmented branch
read relatedTotal and reported the exact segment as zero. One
withdrawal, both fields.

## n392-augmented-totalunderstated-exclusi

Above: `...(augmented || totalUnderstated ? {} : exclusionCeiling(excludedTerms, total)),`

The exact-segment count the caveat just withdrew, republished as
the labelled ceiling it is — MEASURED 2026-08-31, q="engineer not
manager" shipped a full page with no figure at all. Withheld when
the page already disproved the count (totalUnderstated) or holds
appended close matches (augmented): a ceiling of the exact segment
over a mixed page is the "Showing 40 of 18" contradiction again.
countCapped above still rides along, so 10,000 reads as "10,000+".

## n393-twosubset

Above: `const twoSubset = !!applied.category && applied.includeUncategorised;`

NO CATEGORY ORDERING HERE, AND THE ATTEMPT IS WORTH RECORDING.

With the unsorted opt-in on, page one of `legal + country=DE` was entirely
`other` — the second bucket is 27x larger and date ordering does the rest,
so the field the person picked disappeared. The fix looked free: the result
set holds exactly two category values, so `.order("category", …)` puts the
chosen one first deterministically.

It shipped and broke production. Ordering by category stops Postgres using
the date index, so the whole widened set has to be sorted:

    sales + DE    + opt-in   500 after 17.5s (statement timeout)
    engineering   + opt-in   200 but 4.3s
    legal         + opt-in   200 but 1.6s     (normally ~0.3s)

Only the largest combination actually 500s, which is why the first probe —
one narrow category — looked like a clean success. Reverted.

The problem is real and unsolved: opting in still buries the chosen field.
A correct fix pages the two subsets SEPARATELY (chosen category first, then
`other`, each on its own date index) and stitches them with the offset
arithmetic, rather than asking the database to sort across both. That needs
care around count/hasMore and is not a one-liner — which is exactly why the
one-liner was tempting.
TWO SUBSETS, FETCHED SEPARATELY, ONLY ON THE OPT-IN PATH.

Everything below is bypassed unless somebody chose a field AND opted into
the unsorted bucket, so ordinary browsing runs the exact query it always
did. That containment is deliberate: this is the second attempt at the
problem and the first one reached production.

## n394-twosubsetlimit

Above: `const twoSubsetLimit = Math.min(fetchLimit, limit);`

THE SIZE THIS REQUEST ACTUALLY FETCHES, which is not always fetchLimit.

The two-subset pager caps its own fetch at `limit` so the two category
queries stay bounded, while hasMore asked whether the page came back equal
to fetchLimit — 3x limit when grouping is on. That comparison can never be
true on this path, so Load More died on page ONE. Measured live:
  category=engineering                        50 rows, hasMore TRUE
  category=engineering + includeUncategorised 48 rows, hasMore FALSE
both under a total of 10,000. Opting in to see uncategorised jobs cost the
visitor every page after the first.

## n395-ordered

Above: `const ordered = (q: any, dateCol: string, salaryCol: string) =>`

deno-lint-ignore no-explicit-any
"NEWEST" MEANT "MOST RECENTLY CRAWLED", WHICH IS NOT WHAT ANYONE ASKS FOR.

dateCol is effective_posted = coalesce(posted_at, first_seen), so a posting
with no company-stated date takes our crawl time and sorts to the very top.
MEASURED on the live board: 57 of 60 rows on sort=newest had postedAt=null,
95% of the page. The undated rows were crowding out every posting that does
carry a date.

THE SIZE OF THE UNDATED POPULATION, RE-MEASURED 2026-09-26, because the two
figures that used to sit in this paragraph ("the 10% of the corpus with no
date" and "the 540,437 postings that DO carry one") were an order of
magnitude stale and they mis-price this decision for the next reader: they
make burying the undated rows look ~13x more costly than it is. Counted at
the boundary of THIS order, which is the only stable instrument for it
(single-offset shares are not reproducible — the undated block is ordered by
first_seen and arrives in lumps): under sort=newest the first undated row
sits between offset 740,000 and 742,000 of a 746,300-row board, so undated
is roughly 4,300-6,300 rows, about 0.7% of the corpus. On the SAME day the
no-sort effective_posted order served 59 of 60 undated rows on page one —
0.7% of the board owning 98% of the first screen.

Ordering on posted_at with nulls last is both honest and CHEAPER — measured
at concurrency 4: posted_at 0.20-0.37s against effective_posted 1.03-1.23s,
five times faster, because it uses a plain column instead of a coalesce.

The freshness WINDOW still uses effective_posted. That is deliberate: an
undated posting should still be served, it just should not claim to be the
newest thing on the board.

WHICH IS WHY THE FALL-THROUGH BRANCH BELOW IS A NAMED ORDER, NOT A DEFAULT.
Ordering by dateCol is the DISCOVERY order — newest by when WE first saw a
posting, which for an undated row is all anyone knows about it — and
Jobs.tsx asks for it by name with sort:"discovered". It is the one place the
undated tail is reachable at page one instead of past offset 740,000, so the
page offers it beside the date claim rather than exiling those rows. Nothing
branches on the value: "discovered" is neither "newest" nor "salary", so it
arrives here, and src/test/newest-first-must-order-by-date.test.tsx pins that
this is still true of the expression below. A `sort` this function does not
know is served the same way — the honest reading of "no order asked for" is
still an order, and this is it.

## n396-pagewith

Above: `const pageWith = async (dateCol: string, salaryCol: string, withCount: boolean) => {`

THE QUERY THAT FETCHES THE ROWS THE READER SEES, AND IT WAS NEVER MARKED.

Deployed 2026-08-25.12 and measured: every rescue tier is fast —
simple_config 146-188ms, semantic 166-455ms, head_ring 122-245ms,
embed_query 95-98ms, fuzzy 133-264ms — and count_jobs_capped is bounded at
its 1.5s deadline. Yet q=camarero limit=20 still took 5.7-8.2s with
3.2-5.5s unaccounted, and q=zzzqqq 6.3-13.3s with 2.6-9.3s unaccounted.

So the rescue ladder was never the cost. I concluded twice that it was —
once from the count, once from the tier deadlines summing — and the marks
I added to settle the question refute both. What the instrument never
covered is this function: three call sites, every one of them an awaited
buildQuery, none of them timed.

A wrapper rather than marks at each site, so a fourth call site cannot be
added untimed.

## n397-cursor-sortsalary-newestfirst

Above: `if (cursor && !sortSalary && !newestFirst) {`

Keyset: WHERE ep < X OR (ep = X AND id > Y) — the exact successor set
of the ORDER BY (ep DESC, id ASC). Only on the date sort: the salary
sort orders by a different column and keeps offset until it needs its
own cursor.
The keyset cursor is written in terms of dateCol, so it cannot describe
a posted_at ordering — pairing them would page through one order using
another's coordinates, which is the exact defect that made sorted page
two repeat page one.

## n398-cursor-cursor-k-pa-sortsala

Above: `if (cursor && cursor.k === "pa" && !sortSalary && newestFirst) {`

THE SAME SEEK FOR THE ORDER THE ORDINARY BROWSE NOW WALKS.

"Newest first" orders by posted_at DESC NULLS LAST, id ASC (see
`ordered` below), and it had no cursor at all: every page after the
first was an OFFSET walk over a table taking ~70k inserts a day. That
cost little while only the sort control asked for this order. It is the
ordinary browse's order now — because it is the order the page CLAIMS —
and offset paging over it is the shape measured on 2026-08-18 before the
keyset shipped: 4 of 8 page-one-to-page-two transitions overlapped, the
worst pair repeating 9 of 60 rows and silently hiding 9 others.

Two arms, the same shape as the branch above, against an index that is
literally (posted_at DESC NULLS LAST, id): `lt` on the date, the id
tiebreak only inside the `eq` arm. The cursor's kind is already checked
where it is parsed, so a coordinate written in effective_posted cannot
arrive here; the `k` term is repeated for a reader.

A NULL COMPARISON IS UNKNOWN, SO THE SEEK CANNOT DESCRIBE THE UNDATED
TAIL — AND THE WALK MUST NOT END THERE.

Both arms compare posted_at, so neither can return a row whose posted_at
is NULL. On the unfiltered board that costs nothing a reader would ever
notice: the dated rows run to ~offset 741,000 of 746,300, which is
~12,350 "Load more" presses, and the tail is one click away in the
discovery order the page offers beside the claim. On a FILTERED newest
page it is a quarter of the answer. MEASURED live 2026-09-26, binary-
searching the first undated row under sort=newest:
    vendor=pinpoint + country=GB   total 860, dated 616, undated 244 (28.4%)
    vendor=pinpoint                total 3,554, dated 2,595, undated 959 (27.0%)
    vendor=bamboohr + country=US   109 of 6,322 (1.7%)
The seek came back short after ~10 presses, hasMore went false, and the
header went on printing "of 860" over 616 served rows.

So a SHORT seek is not the end of the set, it is the seam — and the read
that crosses it already exists and is already correct: `.range()` under
this same ordering includes the undated tail (posted_at DESC NULLS LAST
puts it last), which is why page one always served those rows. One extra
query, once per walk, at the one page where the keyset runs out; the
cursor emitter then finds no posted_at on the last raw row and hands back
null, so the tail pages by offset exactly as it did before the keyset
existed. Offset paging's drift is the documented cost of that one page
and is strictly smaller than dropping 27% of the matches.

## n399-count-deadline-ms

Above: `const COUNT_DEADLINE_MS = 1_500;`

Page and count run CONCURRENTLY and independently: the page never waits on
a count, and a count that fails can't take the page down with it. The page
is consistently ~0.3s; it was the exact count riding the same query that
made broad filters take 3-9s.
The count gets a HARD deadline. Running it concurrently was never enough:
Promise.all still waits, so a slow count holds the entire response and then
takes it down with it — measured HTTP 500 at 35-79s on 24 of ~40 searches,
and 20-29s with total:null on 3 of 4 broad queries under sort=newest, while
the page half is consistently ~0.3s.

A missing total is a small, honest degradation the client already handles
(countUnavailable -> "Showing N" without a denominator). A 46-second wait
ending in 500 is not. 4s is chosen above the measured p95 for counts that
DO succeed (~1-3s) and far below the ceiling where they stop being useful.
4s was chosen when nobody could see what the count actually cost. Now we
can: measured 2026-08-25 with per-RPC timings on the live board,
count_jobs_capped is the dominant phase of a text search — 817-870ms for
q=nurse and 2,336ms for q=camarero, which is 70% of that request — while
search_jobs, the call that actually produces the rows, is ~300ms. It
already runs in parallel with the page fetch, so it is not sequencing that
hurts; the count is simply the critical path.

And on q=camarero the board waited those 2.3 seconds for a number it then
WITHDREW, because the page held more rows than the count claimed (the
slash-title case fixed earlier today). Paying two seconds of every
searcher's time for a figure that is often a bare ceiling ("10,000+") and
occasionally untrue is the wrong trade.

1.5s keeps every count that lands inside the measured normal range and
drops the tail. The degradation is one the client already renders well:
countUnavailable becomes "Showing 60 of 60+ matching openings" rather than
a blank, since the floor shipped this week. Rows are never delayed by it.

## n400-counttimedout

Above: `let countTimedOut = false;`

A DEADLINE THAT ESCALATES IS NOT A DEADLINE.

withDeadline resolves { data: null } for a timeout, an error AND a missing
RPC alike, and the code below read that single sentinel as "the migration
has not applied yet" — then fell back to the UNBOUNDED inline exact count,
the very query the capped RPC exists to replace, while throwing away the
page it had already fetched.

So missing the 1.5s deadline made the request dramatically slower, not
faster. Reproduced live on an ordinary two-filter browse:
  healthy run   count 210ms   page 139ms   tookMs 359
  race lost     count 1503ms  page 3755ms  tookMs 5448   (settle: 1693ms)
The count was 190ms from landing. Losing it by that margin cost 5 seconds.

Tracked separately now: `timedOut` is the timeout, `null` after settling is
the genuinely-missing RPC. Only the second may escalate.

## n401-countunavailable

Above: `let countUnavailable = countTimedOut || (wantCount && count === null);`

Last resort before failing the board: if the query still errored AND we
asked for an exact count, re-run the identical page with the count OFF.
The count is the expensive half (0.3s page vs 3.2s+ count), so this turns
a 500 into a served page with an honest "we don't know the total".
countUnavailable tells the client to stop trusting `total` rather than
render a wrong number, and hasMore keeps pagination working without it.
Seeded from the raced deadline, and this is load-bearing. Downstream,
`total` is published as `countUnavailable ? null : (count ?? 0)` — so a
null count with this flag still false publishes ZERO, which the comment on
that line already warns "would read as no matches and trip the zero-state
on a page that is visibly full of results". Not escalating on a timeout is
only safe because the timeout is declared here.
A COUNT WE DO NOT HAVE IS "UNKNOWN", NEVER ZERO. countUnavailable was
seeded only from the raced deadline, but three paths above can leave
`count` null with NO error — the two-subset `other`-bucket count hitting
its statement timeout, and the two graceful-degrade re-runs that drop the
raced count. The published field is
`total: countUnavailable ? null : (count ?? 0)`, so a null count with the
flag still false publishes ZERO: measured shape is 48 real rows served
under "Showing 48 of 0 matching openings". The comment above already
reasoned about this and then did not guard it.

## n402-rawkeys

Above: `let rawKeys = (data ?? []) as Array<{ effective_posted?: string; id?: string }>;`

THE KEYSET LIVES ON THE RAW ROW, AND rowToJob DOES NOT CARRY IT.

Both keyset readers below took (effective_posted, id) off `mappedRows`,
which is `data.map(rowToJob)` — a mapper that emits 21 camelCase fields and
no `effective_posted` at all. So both read `undefined`, every single time:
  * nextCursor was null on EVERY response since the keyset shipped
    (2026-08-17, "Load more showed the same job twice"). Every client fell
    back to offset paging and the duplicates the commit was written to kill
    came straight back — measured 2026-08-22, 6 pages of 20 on the default
    feed: 0%, 0%, 5.0% repeats across three trials.
  * the grouping top-up below is gated on `lastRaw?.effective_posted`, so
    it has NEVER ONCE RUN. Pages starved by clustering were served short.
A fix that reads a field the row does not have is not a fix; it is the same
outage with a passing build. These keys are kept out of the response on
purpose — effective_posted coalesces first_seen, which is our DISCOVERY
time and must never reach a client that could read it as a posting date.

## n403-if

Above: `if (`

ONE TOP-UP WHEN CLUSTERING ATE THE WHOLE BUFFER.

MEASURED 2026-08-20, and the signature is exact — nextOffset === fetchLimit
on every case, meaning all 180 raw rows were consumed and still did not
yield a full page:
    "retail sales"       39 cards under a total of 3,437
    "customer service"   42 cards under a total of 9,846
    "physical therapist" 55 cards under a total of 2,675
A visitor sees a third of a page under a headline promising thousands, and
the page simply looks broken. The 3x over-fetch is a guess about how much
clustering will fold, and on searches where one employer posts the same
title in dozens of towns the guess is wrong.

Bounded to a SINGLE extra round trip, deliberately. Looping until the page
fills would turn a heavy search into an unbounded fan of queries — the
exact shape that took the board down two days ago. One top-up converts the
common case (a third of a page) into a full or nearly-full one; the rare
residue is honest and cheap.

Only on the plain date-sorted path: the ranked, two-subset and salary paths
have their own offset arithmetic, and a top-up that ignored it would move
rows across a page boundary the cursor does not know about.

## n404-anchorcol

Above: `const anchorCol = newestFirst ? "posted_at" : "effective_posted";`

THE GATE THAT SAID "a thin newest page stays thin" IS GONE, BECAUSE THE
ORDINARY BROWSE IS NOW A NEWEST PAGE.

That `!newestFirst` was written when newest was an opt-in sort, and its
stated reason was true of the anchor rather than of the order: the top-up
is a keyset continuation, and continuing an effective_posted coordinate
through a posted_at ordering would move rows across a page boundary the
cursor knows nothing about. Since Jobs.tsx asks for sort:"newest" on every
browse, keeping the gate would have retired the mechanism on the board's
single most common request — the one the starvation was measured on
("retail sales" 39 cards under a total of 3,437).

So the ANCHOR follows the order instead. It is the same two-arm seek the
keyset branch above uses, on the same column, against the same
(posted_at DESC NULLS LAST, id) index — the arithmetic carries over
unchanged. And it is skipped, not faked, when the last raw row carries no
posted_at: that is the undated tail, which a posted_at comparison cannot
describe, and a short page is the honest answer there.

## n405-t-topup

Above: `const t_topup = Date.now();`

Keyset-anchored, exactly like page 2: start strictly after the last
raw row this page read, so the top-up cannot repeat or skip.
Bounded and MARKED: this is a whole second page query, and it was the
only awaited query in serveList outside the pageWith wrapper — its
cost landed in the unaccounted bucket on the exact path the
2026-08-30 incident was measured on. A miss yields {data:null}, the
?? [] below serves the short page, and the catch's own words apply:
"the page we already have is still correct — serve it".

## n406-sortsalary-grouped-jobs-interleaveby

Above: `if (!sortSalary) grouped.jobs = interleaveByCompany(grouped.jobs);`

Interleave the RETURNED page only, never the pre-slice buffer.

The first version of this ran before the cut, which read as the careful
choice — cap what the user actually sees rather than an already-truncated
slice. It was wrong, and a filter audit caught it: nextOffset advances in
DB order (grouped.rawConsumed), so permuting the buffer BEFORE the cut
moves rows across the page boundary that the cursor knows nothing about.
Measured on a frozen snapshot: 1-2 postings duplicated onto page 2 and 1
silently dropped FOREVER per boundary, where the control run scored 0/0.
A cosmetic variety tweak was quietly costing users jobs.

Permuting only the emitted array is a pure reordering of rows already
committed to this page: rawConsumed is untouched, so no row can be skipped
or repeated. Runs spanning a boundary are no longer capped — that is the
honest trade, and it is worth strictly less than never losing a posting.

Salary sort is EXEMPT, and the previous comment claimed that while the code
did the opposite: it ties on money, not on ingest batch, so reordering
there produced 8 inversions in 59 adjacent pairs, up to $70k out of order,
directly contradicting "highest stated pay first".

## n407-recencyserved

Above: `const recencyServed = preferMatchedLocation(await attachRecheckedAt(client, grouped.jobs, excludedTerms), locationTerms(`

Self-check EVERY page against the filters we just told the caller we applied.

The rows are already in memory, so this costs one pass over at most 60
objects and no query — cheap enough to run on every request rather than in
a nightly job that discovers yesterday's breakage tomorrow.

This is the check the unit suite could not be: 1,010 tests were green while
production returned country=null on every row, because the test asserted
that rowToJob emits `country` and never that the SELECT fetches it. It
proved the last link of the chain and nothing about the first. A predicate
evaluated against the bytes actually being returned cannot be fooled that
way — if the column stops arriving, or a filter silently stops binding,
the very next request says so.

It reports rather than throws: a caller with a full page of usable results
should not get a 500 because a badge field regressed. The count is surfaced
in the response so the property is externally testable, and logged so it is
visible without a client.
The RECENCY path, logged last and named explicitly because it is the one
that has been forgotten five times in two days — filler stripping,
clustering, metro aliases, attachRecheckedAt and the disclosures each
shipped to one path and silently skipped the others. A telemetry table
missing this path would under-count every browse and quietly bias the
denominator toward searchers.

## n408-rankedfellback-rankedfellback

Above: `...(rankedFellBack ? { rankedFellBack } : {}),`

The keyset successor: (effective_posted, id) of the last RAW row this
page consumed — from `data`, never from grouped.jobs, because grouping
folds clusters and its last visible card is not the last row read.
Null on the paths that still page by offset.
Present ONLY when the ranked path threw and this response is the
fallback. Its absence is the healthy state, so nothing is published on a
normal search; when it IS present, one curl says which error demoted the
search instead of leaving it to look like an empty catalog.

## n409-twosubset-sortsalary-newestfirst

Above: `if (!twoSubset && !sortSalary && newestFirst) {`

THE DATED WALK NAMES ITS OWN COORDINATE, in the column it orders by.

This used to return null for sort=newest, and the reason given was
right: a cursor written in effective_posted cannot describe a posted_at
ordering, so issuing one promised a seek the next request would refuse.
The answer is to write the cursor in the column the order uses and SAY
which one it is (`k`), not to leave the order without a cursor — the
ordinary browse walks this order now, and an uncursored walk over an
inserting table repeats and hides rows (see the keyset branch above).

posted_at, never effective_posted, and null when the last raw row has no
date: that is the undated tail, which this order puts last and this
keyset cannot describe. A null cursor is the honest answer there — the
caller pages by offset, exactly as it did before this branch existed.

## n410-twosubset-bucketedorder-true

Above: `...(twoSubset ? { bucketedOrder: true } : {}),`

TWO BUCKETS CONCATENATED IS NOT ONE ORDERING, AND THE PAGE HAS TO SAY SO.

The includeUncategorised path returns the chosen field's rows followed by
the "other" rows (see pageWithInner's twoSubset branch) — each half
internally ordered by the requested key, the halves in sequence, because
splitPage walks bucket A to its end before it enters bucket B. The order
claim above the list says "newest by the date each employer states", which
is true INSIDE each group and false across the seam, and nothing on the
wire distinguished this page from a single ordering. One flag, so the page
can disclose the grouping the same way it discloses the employer weave and
the undated tail rather than making a claim it cannot support.

## n411-streamed-oversize-read

Above: `const STREAM_WIRE_BYTES = 64_000_000;`, `async function readOversizeBoard(`, the worker's retry after the pinned fetchBoard call, and `async function readBoardForDetail(`.

A LEVER OR ASHBY BOARD TOO BIG TO HOLD IS READ A POSTING AT A TIME. (Since
.90 a greenhouse LIGHT list too, never its content list: n424.)

Neither vendor has a lighter form or pagination: one request returns the
whole board. Since the byte bound shipped (2026-09-06) a feed over
MAX_RESPONSE_BYTES was deferred on every pass, forever — 13 ashby and 20
lever boards measured 2026-10-01, holding 3,527 and 3,843 postings inside
the 30-day window, OpenAI, Snowflake and Palantir among them. The bound is
right (memory is the binding constraint of this function, n005 and the
MAX_RESPONSE_BYTES arithmetic), so the fix is a second read that never
holds the document, not a bigger first one.

THE SHAPE. readOversizeBoard runs only after fetchBoard has already said
"oversize". It re-requests the same listUrl through fetchWithTimeout with a
64 MB wire bound, and hands the body to slim-stream.ts, which splits the
array a posting at a time with a byte-level depth / in-string / escape
scanner (the document never exists as one string), parses one element at a
time, and keeps ONLY the fields normalizeLever / normalizeAshby read — the
allowlist is a contract with normalize.ts, and the guard derives it from the
normaliser source so a field added there later goes red here instead of
going silently missing on streamed boards. Retained: at most
SLIM_RETAINED_BYTES of metadata and held descriptions together, plus one
element (SLIM_ELEMENT_BYTES), which sum to MAX_RESPONSE_BYTES, so the "five
workers at the ceiling" arithmetic above the bound still holds unchanged. The
element bound is checked as each chunk of a partial element arrives, not when
the element closes: one 60 MB posting is refused at 1 MB, not buffered whole.

THE RETAINED BOUND COVERS UNDATED TEXT TOO (review, 2026-10-01). The first cut
compared only metadata with SLIM_RETAINED_BYTES and, when metadata pressed on
the ceiling, gave up a held text only if it ranked strictly below Infinity. An
undated posting (the ingest keeps it, so it holds its text) is ranked AT
Infinity, so it could never be given up: 240 undated 10 KB texts
followed by 2.4 MB of aged metadata finished at 4.8 MB retained against the
3 MB budget, without a throw. Metadata now outranks EVERY held text, oldest
first and undated last, so retained is at most max(SLIM_DESC_CEILING, metadata)
and never passes SLIM_RETAINED_BYTES. Newest-first is unchanged for arrivals:
an arrival gives up only texts strictly older than itself, so an older posting
arriving after newer ones displaces nothing. Real lever and ashby feeds almost
always date their postings, so this was a bound with a hole rather than a
measured overrun, but the bound is the claim the memory arithmetic rests on.

DESCRIPTIONS ARE WRITTEN ONCE. Only new rows are upserted with a description;
existing rows get field patches that never carry the column, and neither
vendor is in DETAIL_DESC_SOURCES or BOARD_DESC_SOURCES. So a description the
budget drops stays NULL on that posting for good. Two consequences in the
code: (1) the text is pre-built in the stream exactly as the worker builds it
(lever: descriptionPlain + "\n" + descriptionBodyPlain; ashby:
descriptionPlain, else htmlToText(descriptionHtml)), cut at twice
STORED_DESC_CAP and stored as `descriptionPlain`, which both worker branches
read first — so the stored text is identical, one string per posting, and a
posting can never keep half its description. (2) Metadata and descriptions
share SLIM_DESC_CEILING and, when it binds, the OLDEST held description is
given up, never the newest arrival. First-come retention would null the same
newest tail on every pass, new postings included; newest-first is also what
lets bluelightconsulting (13.4 MB, 949 in-window) read at all, dropping its
280 oldest descriptions. Only postings the ingest will store hold text: the
in-window test is the ingest's own (sanePostedAt + isDatedBefore against the
worker's freshCutoffMs, passed in rather than recomputed).

EVERY FAILURE THROWS, AND THROWING IS SAFE. A document whose first byte is the
wrong shape, a jobs key that is absent or only nested, EOF before the array
or the document closes, one element over budget, metadata over budget, or a
read that misses the deadline — all throw, and readOversizeBoard turns every
throw into null. A partial board must never read as complete: with at least
60% of a feed served, the id-diff prune would write the rest into the closure
log as an employer's closures. The prototype this came from returned 2 of 4
elements on a truncated document, 0 on a lever object and {jobs:[]} on a
missing key; each of those is a red case in the guard.

THE DEADLINE BOUNDS EVERY WAIT. fetchWithTimeout clears its abort timer when
headers arrive and its 429 path can wait 20 + 4 + 20 s, so neither the
headers nor the body are bounded by it. beforeDeadline races the fetch and
then every reader.read() against deadlineAt (a response that lands late is
still released), and the reader is cancelled in a finally. Measured against a
local server: stalled body and stalled headers both returned at the deadline.

EVERY ABANDONED BODY IS CANCELLED. Uncancelled, abandoned response bodies were
the September slice deaths (n005: heap p50 176 MB, 36 once discardRest
cancelled them), and
every failed streamed read — slow, over a budget, wrong shape — abandons a body
with bytes unread. The guard asserts the cancel on the SOURCE stream for each
of those failures, directly and through boundBody's pipe, and for a late
response, a non-2xx and a non-JSON answer. (A truncated body has already been
read to its end; there is nothing left to release.) It also lifts
readOversizeBoard, boundBody and fetchWithTimeout out of index.ts and runs them
over stubbed feeds past MAX_RESPONSE_BYTES, and runs the worker's retry
statement itself, because an earlier version of the guard pinned their
spelling and stayed green with the retry dead or every streamed board empty.

THE RETRY IS A SEPARATE STATEMENT AND NEVER WRITES THE VERDICT. Three guards
pin the worker's fetchBoard call byte for byte, so the retry sits between that
call's finally and the landed-postings count. It starts only on an oversize
verdict, for a vendor with a spec, with STREAM_READ_BUDGET_MS still left on
the slice clock (a 30 s read started near the wall overruns the window every
surviving slice has finished in, and a slice that dies loses its bookkeeping
and stops the chain), and under HEAP_SOFT_LIMIT_MB. It never assigns
failReason: a failed retry leaves r null and the oversize branch runs exactly
as before — registered, enrolled where light-capable, deferred, never failed.
That matters because the classifier only maps text matching the oversize
marker to the deferral; a socket error or a deadline message would otherwise
read as a vendor failure, and six of those over 40 hours is the dormancy prune
deleting a live employer's board. A success runs the ordinary ingest, which
deletes the registry entry, stamps verification and un-stamps missing_since.

NEITHER A DETAIL VIEW NOR A LIVENESS CHECK REPEATS A REFUSED BOARD READ.
Neither vendor publishes one posting's text anywhere but in the board's list,
so the detail read of a lever or ashby row with no stored description fetches
the whole board through fetchBoard and picks one row out. On a streamed board
those rows are exactly the ones the retention ceiling gave up (4 of 281 on
openai, 280 of 949 on bluelightconsulting when measured), and fetchBoard
refuses the same document again: nothing for lever, which declares its length,
but up to 4 MB downloaded and thrown away for ashby, which compresses and
declares none. getDescription caches only text, so every view paid it again;
before .84 these boards served no rows and the path was unreachable.
readBoardForDetail remembers the oversize verdict per board, per isolate, for
DETAIL_BOARD_REFUSED_TTL_MS (6 h): the list is one document for every posting
on it, and a board that shrinks back under the bound answers again once the
entry lapses. A timeout or HTTP error may be transient and is asked again, as
before. Those rows show no description; that they stay NULL for good is the
write-once rule above, not this cache.

The same refusal reached checkLive (re-review, 2026-10-02). Every ashby
posting falls through to board membership, as do workable, teamtailor,
recruitee and pinpoint, which have oversize boards of their own. The
per-request memo keeps only boards that answered, and verify clears it and
probes up to twelve ids one after another, so each id on a refused board
repeated the refused read: LiveMatches awaits verify for its top five, the fit
check awaits it, and opening a detail panel or clicking apply fires it. The
answer was a correct null every time (nothing was falsely closed); the cost was
the download, read to the 4 MB bound and thrown away, once per id. checkLive's
membership fetch now goes through readBoardForDetail, so the oversize verdict
is remembered there too: five verify ids on a refused board make one read, and
the next request makes none until the entry lapses. A board that answers is
still read once per request and never carried across requests, and a transient
failure is still asked again. One residue: the audit probes in parallel
batches of eight, so its first batch can pay the read once per concurrent
probe before the first refusal lands, exactly as it already does for a board
that answers; every later batch reads the cache. The windowed-absence guard
(a-window-of-ours-is-not-a-closure-of-theirs) found its board fetchers by the
literal fetchBoard call, so this move would have taken checkLive out of the
class it polices; it now counts any function declared to return what
fetchBoard returns as the fetch itself, compiles the real reader into its
checkLive harness, and fails when checkLive reaches a dependency it does not
stub instead of letting checkLive's catch answer null.

COSTS. A board whose streamed read fails permanently now costs up to 30 s of
one worker and up to 64 MB of transfer per cold visit where the first read
alone was refused in milliseconds (~35 boards, once a rotation). Five
concurrent streams at the worst measured ~20 MB each would approach the heap
gate, which is why the retry checks it. Measured on five captured feeds:
normaliser output identical to the whole-body parse, every kept description
equal to the text the whole body would store, at most 160 ms of parse per
board. Lever transfer speed from the edge is the one unmeasured input.

## n412-redated-past-tombstone

Above: `let readmitted: Array<Record<string, unknown>> = [];` (ingest), the
re-admitted tombstone upsert after the insert loop, and the sweep's
`untombstoned` filter. Logic: `tombstone.ts`.

AN ID IS STABLE; ITS DATE IS NOT. n099 assumed both were, and that a genuine
re-post gets a new id. Ashby re-publishes under the SAME id and moves
publishedAt: of 424 ids in both the 2026-08-07 Wayback snapshot of the openai
feed and the 2026-10-03 live feed, 49 carried a later publishedAt, none an
earlier one. A posting we had stored past day 30 was tombstoned on the old
date, and when the employer re-dated it into the window the tombstone refused
it for 180 days. Measured 2026-10-03 after .85: 13 of snowflake's 118
in-window postings and 7 of openai's 266 had no row at all, every one
published before the board's last read; two of the openai seven are in the
08-07 snapshot on their old dates (1dade0fb 07-29 -> 09-24, 08e8d03a
07-30 -> 09-15). Greenhouse first_published did not move on any of
databricks' 808 ids over 11 days (09-22 snapshot), so this is the vendor, but
the rule is not vendor-specific.

THE RULE. A tombstoned id walks back in when the feed's own sanitised date is
later than the tombstone's posted_at by more than REDATE_MARGIN_MS (3 days).
Anything that reaches the check is already inside the window, and the
tombstone's date was outside it when written, so for a vendor whose stored
date IS its feed date, reaching the check already means a re-date: the
margin is for Workday,
dated from the fetch clock ("Posted N Days Ago"), where one unchanged posting
reads up to a day apart between visits. An undated feed row never qualifies
(the bamboohr/rippling loop n099 closed), nor does a tombstone with no date.

THE LOOP IT MUST NOT REOPEN. A Workday row can be stored on its list date
and then re-dated OLDER by the description filler (betterDate: the detail's
startDate replaces the list date). Its tombstone then records the old date,
the list date beats it, and without more it would come back every rotation.
So: after the insert lands, the re-admitted rows' tombstones move to the date
they came back on (AFTER, or a failed insert would lock the row out on a
date it never held), and the sweep no longer re-upserts a tombstone that
already exists, so nothing moves it back. Net cost for that case: one
re-entry per distinct list date. Failure of the move is logged and costs at
most one more re-entry. Since .89 the sweep's tombstone upsert also carries
ignoreDuplicates, so a failed alreadyTombstoned read can no longer move an
existing tombstone back (it used to degrade to the old upsert-everything).

LEDGER. Unchanged. A re-admitted row that ages out again is already
tombstoned, so the sweep writes no second aged_out exit for it; a re-admitted
row the employer takes down is a real closure and is logged as one.

NOT DONE. An existing row whose feed date moves later keeps its first
posted_at (rows are never re-dated in place), so it still ages out on the old
date and comes back on the next visit with a new first_seen. Correcting
posted_at in place would avoid that gap but moves the row between dated
cohorts in the S(30) estimator, and that is its own decision.

## n413-workday-total-past-offset-zero

Above: fetchWorkday's return (`windowed: workdayWindowed(startOffset, ...)`),
the lap proof's `const totalNow = lapTotal(r.feedTotal, cursorBefore, rec.t0);`
and the verification stamp's `stampFeedTotal(...)`. Logic: `read-window.ts`.

A ZERO FROM A MID-FEED PAGE IS THE TENANT NOT SAYING. Many Workday tenants
state `total` only on the offset-0 page and answer `total: 0` on every later
one. Measured 2026-10-05 against the tenants' own CXS lists: Adobe 526 at
offset 0, 0 at offsets 20, 250 and 500; Novartis 816 then 0; TD 1,521 then 0;
T-Mobile 2,000 then 0, and past offset 2,000 page 0 again with total 2,000
(Workday's reporting cap: nothing past offset 1,999 is reachable). Of the 689
Workday boards whose verification stamp read 0 or more than 250, 540 behave
this way (105 state the total on every page, 44 fit one visit).

With MAX_POSTINGS_PER_VISIT at 250 every such board is read over several
visits, and every visit after the first starts mid-feed and sees 0. The old
test `windowed: feedTotal > all.length` was then false, so the ingest took the
250-row slice for the whole board: every other stored row was stamped
missing_since (hidden at once), deleted after the grace or the 6h ratchet and
written to job_board_closures as a 'full_read' takedown; the lap entry was
dropped (the `else if (deepLaps[lapKey])` branch); the verification stamp
published feed_total 0, which get_company_fill_curve buckets as full_read.
On 2026-10-05 those 540 boards advertised 396,254 postings, held 238,780 inside
the 30-day window, and served 51,953; 207 served none.

THE RULE. A visit that did not start at the top is never whole, whatever the
page said; from the top, a stated total must not exceed what was read, and
with no stated total only a walk that reached the feed's end (a short page) is
whole. The wrap arithmetic (`nextOffset`) still uses the visit's own page-0
total, because that is what stops T-Mobile's walk at offset 2,000.

THE LAP. A wrap visit on such a tenant states 0, so the proof measures it
against the lap's t0 (the offset-0 total pinned when the lap opened): proven
only when the walk ended on a short page with `s >= t0 - slack`. The
collapse test is vacuous for those wraps (there is no later reading), and the
early-ending walk is what still catches a feed that shrank mid-lap.

THE STAMP. A mid-feed zero writes the lap's t0, or leaves feed_total out of the
upsert so the last stated total stands; a visit from the top still writes what
it read, including an honest 0 for an empty board. board_state.feed_total, the
append-only history of what the employer stated that day, is unchanged (null
on a day with no offset-0 read).

STORAGE (measured read-only 2026-10-05, scratch measure-l101.mjs): retaining
these boards' in-window postings adds at most 188,921 rows (sum over the 540
of in-window on the feed minus served now; an upper bound, since rows stamped
but not yet deleted are already stored). Corpus 836,035 + 188,921 = 1,024,956
against CORPUS_CEILING 1,200,000, so the capacity governor does not bind and
no flag was needed. The disk-size question (20 or 27 GB) is still open.

## n414-icims-page-size

Above: `const ICIMS_PAGE_SIZES: readonly number[] = [100, 50, 25];` and
fetchIcims. An iCIMS page of 100 carries full descriptions; three boards sent
page 1 at 4.05-4.73 MB (jobs.zs.com 278 live, jobs.qxo.com 330,
careers.ringpower.com 106) and were deferred as oversize on every visit. A
first page over the bound is now retried at 50, then 25, in the same visit;
the size that worked is remembered for the isolate's life. fetchIcims reports
every offset from where its first page really starts (`base`), because a cursor
left at another page size may fall inside a page: re-reading the head of that
page is harmless, overstating coverage to the lap is not.

## n415-light-mode-is-per-board

Above: `const lightKey = ...` and lightBoardRefusal. Light mode used to be
keyed by token, and 52 greenhouse tokens share their token with another
vendor, so admitting the greenhouse board would have flipped the twin to its
light list form (workable details=false) with no filler behind it; the gate
refused every shared token. A greenhouse ?content=true board over the byte
bound on a shared token was therefore deferred forever (lush 5.2 MB with
personio, samsara 4.1 MB with pinpoint, pulse 38.8 MB with ashby, helsing).
DYNAMIC_LIGHT now holds `source:token`, isLight takes the board, and
backfill-desc's count and fill read the greenhouse board only. Bare tokens a
pre-.89 build persisted convert to their greenhouse boards' keys on load (each
was admitted only when every board on it was light-capable) and the row is
rewritten once. A rollback to .88 would sweep the new keys as uncatalogued
and the boards would re-enrol on their next oversize read.

## n416-ledger-before-delete

Above: closeVanishedChunk (the refresh's closure prune, one 200-id chunk at a
time), pruneWholeBoard with rearmIncompletePrunes (dormancy.ts), and the Oracle
sub-site shed's `if (exErr)`. A closure read or insert that failed used to be
followed by the chunk's delete anyway; a whole-board exit log that broke on
page 1 was followed by a delete of the whole token. Every one of these rows was
already stamped missing (or is a duplicate), so keeping it loses nothing and
the next visit retries the ledger write. Now: a failed read keeps the chunk, a
failed closure insert keeps exactly the rows it was writing, an aged row's exit
insert is awaited and a failed one keeps the aged rows (it was fire-and-forget,
so they were deleted before anyone knew whether their exit landed), the
removed-exit row is only written beside a closure that landed, and a
whole-board prune deletes the board only when every row was logged, otherwise
exactly the logged ids. A dormant prune that did not finish puts its board back
one failure short of the threshold with its original streak start, so its next
failing visit prunes again; toPrune fires only on the visit a streak crosses
the threshold, and a dormant board is not fetched again until its recheck.

## n417-board-keys

Above: SHARED_TOKENS, boardKeyOf, boardByKey (index.ts) and boardKey /
dropBareSharedKeys (dormancy.ts). board_failures was keyed by token; on the 139
tokens carried by two or three vendors a twin that read cleared the failing
twin's streak every visit, so a dead board there was never pruned and served
under its sibling's stamp, and when both failed the prune deleted both
vendors' rows. A shared token's boards are now keyed `source:token`; every other
board keeps its bare token, so the persisted state of the other ~44,000 boards
did not move. Entries an older build wrote under a bare shared token are
dropped on load (forgetting a streak delays a prune, never causes one). The
stale lane's tokensOf maps a keyed entry back to its token. NOT DONE (they need
schema changes and serving-path readers): the verification stamp
(job_board_verifications PK company_token), job_board_board_state (PK
company_token, observed_on), attachRecheckedAt, OVERSIZE_BOARDS, and the orphan
prune, whose company list comes from a token-level facet. SINCE .90
OVERSIZE_BOARDS is keyed the same way (n422).

## n418-verify-stamps-never-deletes

Above: the verify action's dead-id block. verify used to delete a row whose
missing_since stamp was 6h old (VERIFY_GRACE_MS, removed) with no closure and no
exit row, and treated an uncatalogued source:token as dead without asking any
vendor. A re-listed id then came back with a new first_seen, and verify called
every few hours erased an employer's fills from the lifecycle log. It now only
stamps (the row is hidden at once); the refresh's absence path, which reads the
whole feed and writes the ledger, removes it. An uncatalogued board answers
null (undecidable), which both callers already keep showing.

## n419-two-readers-one-posting

Above: `const LIST_MODE_UNSTATED = new Set(["workday", "jazzhr"]);`,
listPlaceholder and keepStoredMode in the refresh diff loop. The detail sweeps
write Workday's structured remoteType and replace "8 Locations" with the
detail's place; the refresh then compared the stored row with the LIST
payload (work mode from title/location text only, usually null; location the
placeholder) and wrote it back, noting each undo as an employer edit, after
which the sweep (WHERE work_mode IS NULL) re-fetched the detail. Now a list
placeholder never replaces a real place, and on workday/jazzhr
`listMayRewriteMode` (normalize.ts) decides: an empty stored mode is the
list's to fill; with the list text unchanged (or a placeholder the stored
place outranks) the list has nothing new; when the employer changed the text,
a stored mode the OLD text reads as (detectWorkMode on the stored location and
title) came from the list and is re-read from the new text, even to null, and
one the old text does not explain came from the detail page and stays. The
first cut froze every stored mode, which also froze a mode the list had
guessed: "Remote - US" moved to "Austin, TX" kept the row under the remote
filter for good. No schema column tells the two writers apart; the stored text
does, without a deploy-before-migration window.

## n420-an-empty-page-past-the-top

Above: `emptyFirstPage` (read-window.ts) in fetchWorkday, fetchOracle,
fetchIcims and fetchUsajobs, and `cursorAfterFailure` at the refresh's failure
branch. An empty first page against a stated total threw `empty page but
total=N` at any offset. From the top that is right (a refusal; Four Seasons).
Past the top it stranded the board: a failed visit does not move the cursor, so
a cursor left beyond a feed that shrank asked the same empty page every visit
until six failures over 40 hours pruned the whole board. Now, past the top, an
empty page wraps: with no stated total reaching the page the feed ended
(feedEnded, as a short page says); with a total that says there is more, the
vendor will not serve that deep or refused once, and the walk wraps WITHOUT
feedEnded so no lap proves on it. USAJOBS also never asks past
USAJOBS_RESULT_CAP (10,000, recorded by third-party guides; the official
reference states none), and wraps there without feedEnded, so a 31,000-match
feed is read 10,000 deep and never closes what it cannot see. A deep visit that
fails twice running starts the next from the top, so an HTTP error at a
stranded cursor cannot reach the dormancy prune either.

## n421-a-row-not-read-is-not-written

Above: `META_READ`, `readMetaRow`, loadDynamicLight, loadOversizeBoards,
persistOversizeBoards, enrolDynamicLight and the freshness sweep's aged-row
select (`META_READ.oversize` in its loop condition). The light set and the
oversize registry are reloaded at every slice start and written back whole.
supabase-js returns a failed read as `{ data: null, error }`, and both loaders
read `data` only, so a timeout cleared the set and the slice's next enrolment
or dirty persist wrote the near-empty set over the row. Now a failed read
(error or throw) keeps the set the isolate already held and marks the row
unread until the next load; while unread, an enrolment is admitted in memory
but not persisted and the registry is not persisted at all. A missing row is a
read (empty set, writes resume). The sweep fails closed by not running: with
the registry unread it cannot tell an oversize board from a closed one, so it
selects no aged rows that pass, and writes no closure, no tombstone and no
delete. A false closure is permanent, and so is a true one lost: deleting every
aged row without its exit (the first .90 draft held them all) would have
dropped up to FRESH_PRUNE_MAX true exits across every board, to protect the ~37
oversize ones. Skipping loses nothing: the list already hides aged rows (it
filters `effective_posted` against the same cutoff the sweep selects on), and
the next pass with a readable registry sweeps them with their exits and the
oversize holds. A fresh isolate whose first light read fails holds an empty
set: its light boards fetch ?content=true, and one over the bound is
re-enrolled in memory and re-read light in the same visit (n081), one extra
aborted 4 MB fetch each, counted in lightReread.enrolled and reread although
the row already holds it. The two writers of light_desc_dynamic are still only
loadDynamicLight and enrolDynamicLight. Concurrent slices can still overwrite
each other (whole-row writes); that needs per-key storage.

## n422-oversize-registry-by-board

Above: oversize-registry.ts (loadOversizeEntries, noteOversize, clearOversize,
heldOversize, oversizeTokens, oversizeStatusRows) and its callers in index.ts:
loadOversizeBoards, the oversize branch, the success path, the freshness
sweep's `oversizeHeld`, the stale lane and status `oversizeBoards`.

The registry was keyed by bare token. On the 139 tokens two or three vendors
share, a twin reached the other board's entry: personio:lush's reads deleted
greenhouse:lush's entry on every success, and pulse's entry vanished from
status from 00:45 to 01:32Z on 2026-10-06 as ashby:pulse read. While the entry
was gone the freshness sweep had no record that greenhouse:lush is deferred,
so its aged rows would be written into the closure log as closures (n147).

Now keyed like board_failures (n417): `boardKey(source, token, SHARED_TOKENS)`,
so only shared tokens' keys change and every other key stays the bare token.
A row an older build wrote by bare token is re-keyed on load by the entry's
stored `source` (every entry since the registry began carries one), so every
board registered at deploy keeps its sweep protection; a `source:token` key
whose token is no longer shared goes back to bare the same way. When one board
appears under both spellings the later entry wins. The sweep matches a row by
`boardKey(r.source, r.company_token)`; both aged-row selects carry `source`.
The stale lane keeps speaking tokens: `get_stalest_boards`' p_exclude and
classifyStale compare tokens, so the keys go through `keyToken`, deduplicated.
Status rows keep `token` (the bare token the verifiers filter on) and add `key`.

NOT DONE: the verification stamp is still per token (.91, needs a migration),
so a twin's read still keeps a deferred board's rows "rechecked" and out of the
48h missing sweep. During the deploy overlap a .89 isolate still matches by
token: its success path cannot delete a `source:token` entry, and its sweep
cannot see one, for as long as a .89 isolate keeps running after the deploy
(its own oversize visits write bare keys, which .90 re-keys on its next load).

## n423-one-start-gate

Above: `const canStart = (newBoard: boolean) => startGate({` and start-gate.ts.

ONE GATE FOR STARTING A FETCH. The worker loop checked, in order,
landed postings against SLICE_POSTING_BUDGET, the board count against
the slice's boardBudget, wall time against SLICE_WALL_BUDGET_MS, heap
against HEAP_SOFT_LIMIT_MB (an unmeasurable heap never refuses), and
landed plus in-flight reservation against the posting budget. The
light re-read (n081) starts a fetch too, and a hand-copied second set
of checks drifts from the first, so both now call `startGate` through
the `canStart` closure, which reads the slice's live counters. The
order is unchanged, so every verdict the loop acted on before it acts
on the same way: `reserve` waits (n076, n077); the others defer the
board onto `budgetSkipped`, setting sizeStopped, wallStopped or
heapStopped as before. The re-read passes no board count, because it
is the board already started; it does not wait on `reserve`, it
defers, and it sets no stop flag, since those describe the loop.

## n424-greenhouse-streamed-light-read

Above: `SLIM_SPECS.greenhouse` (slim-stream.ts), the greenhouse branch of
`readOversizeBoard`, and the greenhouse clause of the worker's streamed-read
condition (`lightOversize`, from lightReread).

A GREENHOUSE LIGHT LIST TOO BIG TO HOLD IS READ A POSTING AT A TIME. Two
greenhouse boards were dark for good: their LIGHT lists, the form without
descriptions, are themselves over MAX_RESPONSE_BYTES (liquidpersonnel 13.9 MB,
pulse 20.6 MB on 2026-10-06), and the streamed reader (n411) had specs for
lever and ashby only. Both served 0 rows against ~204 and ~76 postings inside
the 30-day window. The bulk is `metadata`, the tenant's custom fields: on the
live pulse light list's first posting, 7,019 of 7,666 bytes (78 fields); the
fields kept are 405 bytes, so a 20.6 MB list keeps about 1.1 MB, well under
SLIM_RETAINED_BYTES.

THE SPEC. `arrayKey: "jobs"`. Kept: id, title, location, departments,
absolute_url, first_published, updated_at, requisition_id, internal_job_id,
company_name, language. `metadata` and `data_compliance` are dropped (nothing
reads them). `departments` is what normalizeGreenhouse reads for the
department; the light list does not carry it, so it costs nothing there, and
keeping it keeps the field contract the guard derives from normalize.ts
(every field the normaliser reads is kept). `postedAt` is first_published,
the date normalizeGreenhouse stores; `text` is empty, because a light board's
descriptions come from backfill-desc (n019) and the success path writes no
description column for a light board.

ONLY THE LIGHT LIST IS STREAMED, and only one this visit read under the start
gate. The streamed read re-requests `listUrl(s)`, which is the content list
(`?content=true`, every description) for a board that is not light, so the
worker streams a greenhouse board only when `isLight(s)` holds at that moment
AND the byte bound refused the light list itself in this visit: the board was
light at the start (the read that failed was the light list), or the light
re-read (n081) ran and its own verdict was oversize. The second half matters
twice. When the start gate refuses the re-read (posting budget, wall, heap),
the board is enrolled, so `isLight` is true, but no light read passed the
gate; the streamed read checks only wall and heap, so it would read the light
list in the re-read's place, past the posting budget. And when the light
re-read failed for another reason (a 20 s timeout, a 5xx, a 429), nothing
showed the light list over the bound; streaming it would be a third fetch of
an endpoint that just failed, up to 30 s of a worker, registered at the
content list's size. Either board stays deferred and reads light on its next
visit, as in n081.

Order on a failed greenhouse fetch: light re-read (n081), then the streamed
light read, then deferral (n080). For liquidpersonnel and pulse, already
light, that is one streamed read per visit. A board enrolled this visit whose
light list is also over the bound makes three requests in that visit (content,
light, streamed light), once.

WHOLE OR THROW, as for lever and ashby: truncation, a missing or nested
`jobs` key, kept fields past SLIM_RETAINED_BYTES, one posting past
SLIM_ELEMENT_BYTES, or the deadline all throw, readOversizeBoard returns null,
and the board is deferred and registered at the light list's size, never
failed. The light list is the whole board, so a completed read may drive the
id-diff prune and closures like any light read.


## n425-plural-vendor-key-is-named

Above (filters.ts, normalizeFilters): the line after the `vendor` check that
names the plural key.

The list's vendor filter is read from `vendor` (singular, CSV or array). On
2026-10-06 a diagnosis probe sent `vendors: ["personio"]` with
`companies: ["lush"]`: the key was never read, the response carried no
ignoredFilters, and lush's whole board came back (76 rows, 73 of them
greenhouse), which the probe read as personio's rows. That is the silent drop
this file's header forbids, for a key a caller can easily guess.

Named, not aliased. Treating `vendors` as `vendor` would change what every
existing caller that sends it receives, from the whole board to a filtered
page, with no notice; naming it tells the caller the filter did not apply and
changes no result. It is named only when `vendor` is not also sent: with both,
the singular key is read and applied, so nothing the caller asked for was
dropped. An empty plural key (`[]` or "") is not a request and is not named.
No first-party caller sends `vendors` (the page, nl-search, public-api and
agent-mcp all send `vendor`).

## n426-deep-lane-ahead-of-base

Above: `const DEEP_LANE_TAKE = 1;`, the bootstrap take (`bootstrapTake`), the
deep-lane block (`selectDeepLane`, deep-lane.ts) and the slice composition
(`const slice = [...]`).

THE DEEP LANE NEVER RAN. The lane (n067) resumes capped boards (Workday,
Oracle, iCIMS, SmartRecruiters, Rippling, USAJOBS) between their cold-rotation
turns. It sat last, [demand, bootstrap, retry, stale, base, deep]: a cold slice
at rest composed about 1 + 25 + 5 + 3 + 80 + 2 boards against a board budget of
80 and SLICE_POSTING_BUDGET 1,500, so the loop stopped before the tail. On .89
`deepCursor.lane` read visited 0 in all 16 cold slices sampled 00:53-01:16Z on
2026-10-06 (selected 2, candidates ~720) and again at 03:19Z; those slices had
budgetSkipped 24-28 with sizeStopped (the board budget) or 42-66 (the posting
budget). A capped cold board therefore moved one 260-row window per cold
rotation (~6h). pg~wd5~1000 holds its 471 in-window postings at feed positions
0-470 of 816, newest first; a visit starting at 520 or 780 stores nothing, and
pg served 0. The bootstrap lane that crowded it out is permanent, not a
post-deploy drain: it re-seeds whenever it empties on an unchanged version
(3,846 then 9,977 pending on .89).

WHY LAST WAS WRONG. .29 put the lane last so the posting budget would defer it
before base, on the premise that a deferred base board waits a rotation. Since
.56 (n059) the post-loop cursor write advances by the base boards started
(baseAttempted), so a base board the budget defers heads the next slice.
Position protected nothing, and it starved the lane.

WHAT IT DOES. The slice is [demand, bootstrap, retry, stale, deep, base]. The
deep take is DEEP_LANE_TAKE (1) at rest, 1 at L1 and 0 at L2, never above
DEEP_PER_SLICE (2, the memory ceiling, n014). It comes out of the bootstrap
take, `bootstrapTake = effBootstrapPerSlice - deepTake` (24 at rest, 9 at L1, 0
at L2), so the lanes ahead of base hold as many boards as before, and a slice
the board budget stops starts as many base boards as it did (46 with every lane
full: 80 - 1 - 25 - 5 - 3). The bootstrap queue drains what it selected (n064),
now 24. The cut uses the planned take, not the selected count, because the
bootstrap take runs before the lane is chosen (the lane dedupes against it).

WHAT IT COSTS. A deep visit reserves MAX_POSTINGS_PER_VISIT (250) and lands up
to ~260 postings of the 1,500 budget. On a slice the posting budget stops (most
cold slices on .89 read budgetFetched 1,502-1,951) that share comes out of the
base rotation: at ~60 postings a base board, about four fewer base boards that
slice. That is the cost to measure after deploy (the .90 deploy note, F7): the
cold cursor rate by cursor advance, never sliceStats.at, against the .89
baseline, rolled back if more than 10% slower. Rollback is DEEP_LANE_TAKE = 0:
no deep board and the bootstrap take back to 25, which is what .89 did in
effect (its lane at the tail visited nothing).

THE START. n014 recorded that a take of one with the start at `cold % L`
visited only the even positions when the cursor stepped 80 over 66 boards. The
cursor steps by baseAttempted, which varies, but a near-constant step sharing a
factor with L still starves the rest: a 55-board step over 700 candidates
reaches 140 of them in a rotation. selectDeepLane maps the cursor's place in its
rotation onto the list, `start = floor(cold x L / coldListLen)`. Within a
rotation the start only moves forward, by at most step x L / coldListLen per
slice, so while that is at most one (L up to coldListLen / step: about 800
candidates at a 55-board step) every candidate is selected at least once a
rotation, and above that as many distinct boards as there are slices. Below one,
consecutive slices can take the same board; each visit reads its next window,
so a capped board can finish its lap in one run. Dedupe before the cap against
base, demand and bootstrap is unchanged, and retry and stale still exclude the
board the lane took.

## n427-a-tombstone-a-readmission-wrote

Above: tombstone.ts (`splitTombstoned` with `cutoffMs`, `DATE_MOVES_AFTER_INSERT`)
and the ingest read of `id, posted_at, aged_at`.

Found while testing the SNOWFLAKE-3 hypothesis (three ashby:snowflake postings
of 2026-10-06 not stored by the 10-07 reads). The hypothesis itself fails twice:
no writer stores a tombstone without a date (the seed and the sweep write
effective_posted of rows selected by `effective_posted < cutoff`; a
re-admission writes the date it just parsed), and on 2026-10-08 the three were
inserted at 02:00:57Z with their feed dates unchanged, which a tombstone never
allows. Their cause is not established (the .91 deploy note says what read
settles it).

The defect fixed: a tombstone holding a date INSIDE the window, which only a
re-admission (n412) writes, refused the same id's next appearance within
REDATE_MARGIN_MS of that date, or on it, when the re-admitted row had left by a
closure or a prune, until it aged out. On a vendor whose stored date never moves
after insert (everything but Workday, whose filler moves it older: the loop n412
closed), such a row cannot have aged out since its re-admission, so coming back
on a date no older than the tombstone's is a live posting and is let in. A
tombstone with no date lets a dated row in when the row's date is past the
tombstone's own write (`aged_at`) by more than the margin. Undated rows still
never come back; a re-admission still moves the tombstone to the row's date once
the insert lands.

## n428-a-stamp-per-board-on-a-shared-token

Above: verification-stamp.ts (`stampRows`, `stampKeyOfJob`, `stampPlan`,
`laneRows`), the stamp upsert, `seedBoardStamps`, attachRecheckedAtInner, the
stale lane (CATALOGUE_KEYS, keysOf, boardByKey), migrations 20261008100000 (the
48h sweep) and 20261008100100 (get_stalest_boards).

The verification stamp was one row per company_token, and 139 tokens are
carried by two or three vendors. personio:lush's reads kept greenhouse:lush's
stamp fresh while greenhouse:lush was deferred by the byte bound, so the 48h
sweep never stamped its rows and 19 postings already gone from its feed were
served with a fresh recheckedAt (the .90 diagnosis).

A board on a shared token now stamps its own key, `source:token`
(boardKeyOf), AND the bare token, which the freshness rollup and the company
readers still join on (dual write: no legacy reader changes meaning). Once per
isolate the refresh reads the table's board keys and the shared tokens' bare
stamps and (stampPlan) seeds a key for every shared board that has none, at the
token's stamp, with ignoreDuplicates; a board that reads moves its own key, one
that cannot keeps the seed, which ages. Keys whose token is no longer shared are
deleted, or their aging stamp would sweep a board that reads. recheckedAt is
read by board key and never falls back to the twin's bare stamp (absent until
the key exists). The stale lane classifies, excludes (p_exclude now carries
registry keys, matched exactly) and folds tries by board key; a shared token's
bare row is dropped from the window (its boards' own, older-or-equal rows stand
for it).

The sweep (20261008100000) judges a row by its own board's key when one exists
and the per-board writer is alive (some key written in the last 48h), else by
the bare token as before: applied early, or after a rollback to .90, every key
ages past 48h together and the sweep falls back to bare stamps instead of
sweeping every shared board. It reads the stamp table once and joins the stale
set to postings. get_stalest_boards (20261008100100) resolves a key to its
vendor's rows; closed to client roles as the census left it.

NOT DONE: job_board_board_state is still keyed by company_token (day history of
a shared token's twins pools), and the orphan prune's token-level facet is
unchanged (L13-49's remainder; both need schema and serving-reader work).

## n429-a-state-code-is-not-a-substring

Above: location-match.ts (`isStateCodeAlias`, `partMatchesTerm`,
`locationBranch`), buildQuery's location binding, preferMatchedLocation, and
migration 20261008100200 (search_jobs, count_jobs_capped, fuzzy_title_search).

"Maine" expands to "Maine|, ME", and every alias was bound as location ILIKE
'%alias%': no case and nothing required after the code, so ", ME" matched ",
Mexico" (6,375 rows for Maine on .87, 32 of the first 60 Mexican), ", IN" India,
", DE" "Berlin, DE", ", CA" every ", Canada". A ", XX" alias now matches
case-sensitively, followed by the end of the field or a non-letter, on a US,
Canadian or unplaced row; the ILIKE stays first so the trigram index still finds
the rows. preferMatchedLocation used the same needles with the comma stripped,
so "or" matched inside "New York" and the searched state never moved first; it
now applies partMatchesTerm. The three RPC bodies are their 20260927034117
definitions with only the location clause changed.

## n430-a-pay-figure-must-be-unambiguous

Above: filters.ts (`salaryTokenInQuery`, `unambiguousMoney`), queryTerms' money
token, and the SYMBOL count in the ranked exit and countOnly.

Any token from 1,000 to 2,000,000 was a pay floor: "new grad 2026" ($2,026),
"401k" ($401,000), "1099 sales", a GPU model, a zip code. A figure lifts only
with a $, a thousands comma, a trailing +, a k (never 401k), or as a bare number
of six digits or more. queryTerms removed the first bare number in the query,
not the money token ("python 3 120k" lost the 3 and searched "120k"); it now
removes exactly the token the floor came from.

A SYMBOL query ("c#", "c++") parses to the bare letter, so search_jobs' count is
the letter's: both published 2,067 as exact. The ranked exit and countOnly
withhold it (total null, countUnavailable), with totalAtLeast the fetched rows
whose title carries every symbol token.

## n431-a-floor-counts-rows-not-positions

Above: paging.ts `rowsReached` and the ranked exit's `totalUnderstated`.

The ranked exit withdrew `total` whenever offset + cards shown exceeded it and
published that sum as totalAtLeast. Past a ring-merged pool the offset is the
400 seam the walk jumps to, not rows: q="nurse" GB said 314, then 460 at offset
400 and 512 at 497 after 207 distinct rows. The floor is now the rows provably
reached: below the seam the pool positions served (each a distinct row, never
past the pool's end); on a deep page the SQL rank reached, only when SQL
answered at that rank (an OFFSET returns rows only when that many exist). It is
set against both segments (total + related). Page one still withdraws a count
its own rows outrun (q=camarero: 3 counted, 60 delivered by the ring).

## n432-a-filter-keeps-the-route

Above: `const routeDecision = qText && qClass`, the SALARY branch
(`salaryTextSort`, `salaryEmployer`), `routedServesThisOrder`, and countOnly's
sort=salary exit.

n318 stood the router down under any filter on the premise that a filter over
the capped window answers from a subset. It does not: buildQuery binds every
filter in SQL before the window. Standing down sent q="it manager" + country GB
to the english tsquery, which drops "it" (5,649 rows identical to "manager").
The route now holds under filters.

The pay order: with any filter set it fell to the recency path's substring
ILIKE (q="rn" served NorthwesteRN), an employer search searched titles for the
brand (Domino's $85,000 manager rows excluded) or, through the routed branch,
ignored the order. The SALARY branch now serves every text query under the pay
order, with the title tiers' alias expansion, binds an employer route's tokens,
and never falls through: nothing pay-ordered on page one is said
(sortUnavailable "no-stated-pay" | "unavailable"). countOnly under sort=salary
mirrors the list's header (no total) instead of counting substrings.

## n433-chips-withheld-under-a-text-query

Above: the facetCounts block. Supersedes n315-n317.

A one-term query's chips came from count_jobs_capped (a contiguous ILIKE) and a
multi-term query's from buildQuery's ILIKE terms, while the list matches by FTS:
q="rn" US showed legal 1,159 over a legal list of 8. A text query now withholds
the per-category numbers (facetSource "withheld"); an employer query counts its
tokens per category through buildQuery, the routed list's own matcher
(facetSource "employer"); no query counts the filters, as before. Counting each
category with search_jobs would match the list but costs a ranked RPC per
category under a 1.5s facet budget; not done.

## n434-a-cold-cursor-that-steps-back

Above: `sliceCursorNote` (slice_stats.cursorStep).

The cold cursor read on .89/.90 stepped back (137 -> 104, 285 -> 212) and sat
still 6-7 minutes at a time. From code: every cold slice writes the cursor
twice, optimistically at admission by the whole base slice (80), then, if it
survives, corrected to the base boards it started (rotation.ts). A slice the
posting budget stops after 7-47 base boards therefore reads as a step back of
33-73: bookkeeping, no board skipped or repeated (the next slice starts at the
corrected cursor; a slice that dies keeps the optimistic one, a forward skip).
The stillness has two causes in code: the pass's last slice (coldDone 160)
returns without chaining, so the next pass waits for the cron (:x4/:x9) past the
3-minute lock (19:42:49 -> 19:50 on 2026-10-06); and a chain death waits the
same way (19:33 -> 19:39:40). Chaining the next pass directly would remove ~7
minutes a pass (~12% of the rotation) and add load; that is a decision, not
made here. cursorStep {from, admitted, to, base, started} on every cold slice
lets a poll tell the correction from any real regression.

## n435-what-the-board-read-into-the-words

Above: ringWordPattern / startsWithWord (search-routing.ts), INTENT_FILTERS'
trade-term lookaheads and liftIntentFilters' quoted-span mask and noIntent,
queryTerms' "or" and orGroups, company-suggest's foldName, PLACE_QUALIFIERS,
ISO_ALPHA2 / COUNTRY_ALIASES and the whole-day maxAgeDays (filters.ts), and the
filter audit's `refused` probe. One build of small readings, each measured in
the platform-debug register of 2026-10-04:

- L8-05: the head-term ring read titles by a bare prefix and scoreTitle gave
  any prefix +45, so "nurse" served ten Nursery rows on page one, outside the
  count. Ring and bonus now need the prefix to end at a word.
- L8-06: "hybrid vehicle technician", "remote sensing analyst" and quoted
  phrases were lifted into work-mode filters. Quoted spans are never lifted, the
  two bare work-mode words are not lifted as the first word of a trade term, and
  noIntent:true reads every word as text. The register's broader rule (no lift
  when any title word follows) would undo the measured "remote nurse" gain and is
  left for a decision.
- L8-07: "or" was filler, so "welder OR fabricator" was an AND (54 rows against
  684 + 547). Between two real words it is a term: the tsquery tiers read OR,
  the substring path binds OR groups.
- L8-08: the employer typeahead compared lowercase substrings ("dominos" found
  nothing); both sides are folded.
- L8-09: a one-word tail that only qualifies a place ("united", "county") is not
  tried as the location-split's place.
- L8-10: country takes ISO 3166-1 alpha-2 (plus XK), reads UK as GB, and names
  an unknown code instead of answering zero.
- L13-68: maxAgeDays must be whole days; 1.5 broke the ranked RPC's integer bind.
- L1-07: the runtime refuses a self-call by THROWING RateLimitError; the audit
  now calls that (and 429/503/546) a refusal, walks its pages one at a time, and
  says incomplete when every finding is a refusal.
