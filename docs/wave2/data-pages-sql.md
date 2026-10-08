# Wave 2 — data pages and their SQL (deploy note)

Group `data-pages-sql` of the 2026-10-04 platform sweep. Branch
`wave2/data-pages-sql`. Twelve register items: eleven fixed, one fixed in part
(see the table at the foot). Verifier: `scripts/verify-deploy.d/64-wave2-data-pages-sql.sh`.

## What ships

### Edge functions

None. No edge function changed in this group, so no `FN_BUILD` moves and
nothing is deployed through the functions path.

### Migrations, in apply order

All eight are new files; none edits an existing migration. Each re-issues one
function (the hiring-trends file re-issues two, together, because a guard
requires the weekly series and the ticker to move in one file), ends with a
`DO` block that raises unless the change landed, and is safe to re-run.

| # | file | function(s) | register |
|---|------|-------------|----------|
| 1 | `20261008110000_a_role_is_counted_once_and_a_posting_seen_again_never_came_down.sql` | `get_company_fill_curve(text[])` — drop by name + re-create (two columns appended); appends one sentence to `get_actively_hiring_companies`' COMMENT (no code change) | L11-02, L13-12 |
| 2 | `20261008110500_a_field_pools_a_posting_seen_again_after_a_dark_batch_once.sql` | `get_category_fill_curve(int,int)` — create or replace; withholds the cached field pool | L13-12 |
| 3 | `20261008111000_a_week_the_fence_already_emptied_is_not_drawn_and_today_is_the_last_24_hours.sql` | `get_hiring_trends()` — drop by name + re-create (`live_new` appended); `get_takedowns_today()` — replace | L2-06, L2-21, L11-06 |
| 4 | `20261008111500_a_field_is_compared_with_its_own_week_before_anything_closed.sql` | `get_trending_categories()` — replace, header 20s → 60s | L11-10 |
| 5 | `20261008112000_the_real_users_score_benchmark_counts_only_real_users.sql` | `get_public_scan_insights()` — replace | L11-04 |
| 6 | `20261008112500_the_closure_rollup_rolls_whole_months_and_rolls_them_when_nothing_is_pruned.sql` | `roll_up_and_prune_closures(int)` — replace, header 10min; rewrites the `job-board-closures-rollup-retention` cron command in place | L13-16 |
| 7 | `20261008113000_the_exit_rollup_rolls_its_ended_months_when_nothing_is_pruned.sql` | `roll_up_and_prune_exits(int)` — replace, header 300s → 10min; rewrites the `job-board-exits-rollup-retention` command in place | L13-16 (same defect, same file as the closure rollup) |
| 8 | `20261008113500_a_filing_month_is_rolled_whole_and_counted_once.sql` | `roll_up_and_prune_layoff_filings(int)` — replace | L13-16 |

**Grants and census status.** Every re-issued function keeps the reachable set
it has today: the six readers stay client-callable and allowlisted
(`src/test/helpers/client-callable-allowlist.ts` is unchanged), the three
rollups stay service-role only. Each file restates `REVOKE ALL … FROM PUBLIC,
anon, authenticated` then `GRANT EXECUTE` to exactly the roles it had. One
difference worth knowing: `get_hiring_trends` previously carried an implicit
`PUBLIC` grant (its 20261002113617 drop/re-create never revoked it); it is now
revoked from `PUBLIC` and granted to anon, authenticated and service_role by
name — the census reads the same. **No new SECURITY DEFINER function** is
added and nothing new becomes anon-callable.

### Frontend

`src/pages/Jobs.tsx`, `src/pages/Account.tsx`, `src/pages/HiringTrends.tsx`,
`src/pages/PayTransparencyIndex.tsx`, `src/pages/EntryLevelIndex.tsx`,
`src/components/jobs/CompanyIntelPanel.tsx`, `src/lib/hiring-trends-trust.ts`,
`src/lib/tracked-employer-chip.ts` (new), `src/integrations/supabase/types.ts`
(two columns, by hand), and `jobsPage.takedownsToday` → `jobsPage.takedownsLast24h`
in all nine locales.

## Deploy order

1. **Migrations 1–8 first.** The board's hiring verdict now reads
   `filled_roles_90d` / `relisted_roles_90d`; a frontend that lands before
   migration 1 reads every employer's record as *unknown* ("No closure record")
   until it applies. It fails safe — it says "we cannot say", never "not
   hiring" — but it is a visible regression for the window.
2. **Frontend publish.**
3. **Wait for the next `:27` stats-cache run** (and the `:07` explore run).
   Migration 2 removes the cached field pool (as 20261002121843 did), so the
   pages that read the field curve say "not yet computed" until the `:27` run
   writes it under the new rule; the weekly series gains `live_new` on the same
   run.
4. **Prerender rebuild after that run** — it reads the cache at build time.

## What to tell the owner

- **Employer pages count roles, not closure events.** Every "Filled N roles …
  taken down for good", "we watched N of its roles come off the board and stay
  off" and the account tracker's chip (which said "genuinely fills roles (N)";
  it now uses the board's sentence) print `filled_roles_90d`. Johnson &
  Johnson read 2,687 fill events on 2026-10-08; the register measured at most
  1,799 roles that stayed down and 403 that came back. **Employers can move
  either way on "Actively hiring".** Some lose it: more of their roles came
  back than stayed down, which the event counts never showed (J&J read 0
  same-title re-list events). Some gain it: a posting re-listed under the same
  title three times was three re-list events against its fills and is one
  re-listed role now, so an employer with 10 roles down and 4 postings
  superseded three times each moves from "no pattern" (12 events against 10)
  to a closer (4 roles against 10).
- **Two pages can print two filled-role counts for one employer.** On a
  board with dark batches the employer page counts a role that flapped and
  then came down for real; /explore and the hiring index (the leaderboard)
  still leave it out, so they can print fewer. Both functions' descriptions
  now say so; aligning them is a separate change (see "For the integrator").
- **The fill curves stop double-counting postings that survived a dark
  batch.** A doubted closure (suspect or dark proxy) and the age-out its bad
  batch logged now leave the risk set when the same posting_id was seen again
  afterwards; only never-seen-again ids stay censored — the rule the owner
  approved. Expect `dated_n` to fall and `fill_rate_14` to rise a little on
  boards with Workday-flap batches; `still_open_30` falls on the same boards.
  Fields move the same way.
- **/hiring-trends** draws four weeks from Wednesday to Sunday (five on Monday
  and Tuesday): a week whose Monday is past the 30-day fence is no longer
  drawn, because it had already lost its aged-out postings (the 211,810 bar for
  the week of 09-07 on 2026-10-08). Week labels no longer slip a day for
  readers in the Americas. The remote tile is now the share of the week's
  roles still on the board (`remote_new / live_new`), and says so.
- **"Which fields are hiring"** stops reading nearly every field as up (14 of
  15 on 2026-10-08): both windows now include their closed postings.
- **The /jobs ticker** is the last 24 hours, not "today since 00:00 UTC".
- **The ATS-score benchmark** drops our own synthetic test scans (about 22 of
  375 rows).
- **The closure, exit and layoff rollups** now actually roll. The closure job
  (03:17 UTC) and exit job (04:17 UTC) roll one whole ended month per night —
  July, August and September over the first three nights after apply, then
  each month on the first night after it ends; a run never reads more than a
  month of the ledger. Nothing is pruned: both crons still pass `NULL`. Both jobs had been re-scheduled bare by
  20261001090000 (applied after 20261004010000), so they were held to the
  session's two minutes; the commands now set the ten-minute header.
- **/pay-transparency** says "could not read this figure just now" instead of
  "Loading…" for ever when its cache read fails; **/entry-level-index** prints
  when it counted ("Counted <the cache's hour>, refreshed hourly"), names a
  stale part, and no longer claims to count live at page load; the **company
  lander's intel strip** no longer prints "+N net-new roles this week" (the
  Hiring Health card's gated growth line is the reading).

## What to measure

Run `bash scripts/verify-deploy.sh` (section 64). Pre-deploy (2026-10-08
~03:45Z, and again ~12:40Z with the latency and role-caution lines) it
printed FAIL on (a) (a2) (b) (c) (h ×2) and (i1–i8), PASS on (a4) (a5), INFO
elsewhere, no crash. After the deploy and one `:27` tick every line should be
PASS or INFO. Also watch:

- **The company curve's latency, on the board and in the cache.**
  `get_company_fill_curve` is the RPC `/jobs` calls for every visible
  employer (26 tokens a batch, 25 s header); section 64 lines (a4) and (a5)
  time it on a heavy 16-board batch and on the board's own first page, PASS
  under 12.5 s. Pre-deploy (old body, 2026-10-08 ~08:00Z and ~12:00Z, cold /
  warm): (a4) 1.9–2.0 s / 1.0 s; (a5) 1.9–2.2 s / 0.5 s. The new body costs
  1.4–1.6× the old in pglite (below), so expect roughly 3 s cold on the heavy
  batch. There is **no server-side count of the board's `healthFailed`**
  state — it is client state only — so (a4)/(a5) failing, or an HTTP 500 on
  either, is the signal; a `healthFailed` event would need a `trackBoard`
  call in `Jobs.tsx` (not added here).
- **Already over its header before this change:** a live anon call of
  `get_actively_hiring_companies(20)` answered HTTP 500 after 25.3 s on
  2026-10-08 (old body). The hourly cache path is unaffected (the cron
  command's own timeout governs), and the cached section was written at
  11:27Z. The curve call inside it (≤ 200 tokens) grows by the same
  1.4–1.6×; watch `refresh-stats-cache` and `refresh-explore-cache` below.
- `get_cron_health`: `refresh-stats-cache` ran 166 s last / 208 s max on
  2026-10-08 (header 600 s). The field curve costs 1.2× its old body in a
  660k-closure pglite model with 156k doubted rows (3.0 s → 3.7 s; the first
  draft of migration 2 was 4.3 s, and 2× in an earlier 465k-closure model),
  1.15× with none (2.2 s → 2.6 s); its share of the run was roughly 40–80 s,
  so expect the run to land near 175–230 s with zero timeouts. Migration 2
  withholds the cached field pool, so the first `:27` run after apply must
  succeed for the pages to leave "not yet computed".
  `refresh-explore-cache` (95–131 s, header 900 s) also calls the curves.
- The two rollup jobs: `ch_timeout = 10min`, and their nightly runs
  succeeding (INFO lines (h2)), one ended month each. A failed run rolls back
  whole, deletes nothing, and the next night retries that one month.
- J&J (`jj~wd5~JJ`) on the employer page: the "Filled N roles" figure should
  sit well under the 2,687 events.

### What the company curve costs (pglite, measured 2026-10-08)

26 tokens, each with 4,000 closures, 1,200 exits and 1,500 served roles,
three runs, the same database for every body; "filler" adds 200 other boards
(400k closures, 200k postings) so every read is an index read, as in
production. Seconds:

| doubted rows per board | old (20261002121417) | first draft of 110000 | shipped 110000 |
|---|---|---|---|
| 6,000 (four flap batches) | 0.90 | 1.64 | 1.35 |
| 6,000, filler | 1.04 | 2.04 | 1.48 |
| 500 | 0.52 | 0.99 | 0.92 |
| 500, filler | 0.69 | 1.38 | 1.07 |
| none | 0.42 | 0.70 | 0.68 |
| none, filler | 0.65 | 1.06 | 0.90 |

The shipped body reads each ledger exactly as the old one did (counted from
Postgres's own statistics in
`src/test/the-seen-again-test-re-read-both-ledgers-and-joined-a-batch-onto-itself.test.ts`):
the first draft read the closure log twice more and the exit ledger twice
more, and looked up `job_board_postings` by key for every doubted row and
every role (165 lookups in the guard's fixture, against 5 now — the five
doubted rows never seen again). It also joined the doubted rows back on
(board, posting, instant), which without a hash join merged on
(board, instant) alone: two boards with 2,000-row flap batches discarded
16.4 million rows (4.4 s against the old body's 0.1 s). What remains of the
overhead is the role counts themselves (one aggregate per posting) and the
seen-again aggregate on boards that have a doubted batch.

**The field curve (migration 2) had the same three costs and the same
join**, and is restructured the same way: under a plan without hash joins its
first draft discarded 9.0 million rows on two small flap boards (2.5 s)
where the previous body discarded 9 thousand (0.06 s). Same guard file,
second `describe`. The first drafts and the shipped bodies return identical
rows when run in one statement (same `now()`) over a 28-board model that
includes never-seen-again doubted rows and postings stored again then
stamped missing.

**Not measured: `EXPLAIN ANALYZE` in production.** No service key is
available to this group. If the owner can run SQL, the statement to run
before and after migration 1 is
`EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.get_company_fill_curve(ARRAY['jj~wd5~JJ','dominos','target~wd5~targetcareers','sysco~wd5~syscocareers','careers.ulta.com','AbbVie'])`;
the number to compare is the total, and the line to look for is any join
whose "Rows Removed by Join Filter" runs into the millions.

## Rollback

Every change is a function re-issue; rolling back is re-applying the previous
definition, newest first. None of these migrations changes a table or deletes
a row (the field-pool cache key is withheld, and is rewritten by the next
`:27` run either way).

- 8 → re-run the function block of `20260918100900_a_filing_is_pruned_only_after_its_month_is_counted.sql`.
- 7, 6 → re-run the two function blocks of `20261001090000_the_closure_ledger_is_the_asset_stop_deleting_it.sql`
  (not its cron `DO` blocks, which re-schedule the jobs without a header).
- 5 → re-run `20260727201433_b00cf43f-49dd-4bc6-aeca-43b15b9a5e5d.sql`.
- 4 → re-run the `get_trending_categories` block of `20260909201000_the_same_late_date_in_thirteen_more_places.sql`.
- 3 → re-run `20261002113617_a_week_of_takedowns_is_counted_on_the_filter_its_quarter_uses.sql` whole (it drops by name).
- 2 → re-run `20261002121843_a_field_pools_only_the_roles_whose_whole_thirty_days_we_could_see.sql` whole.
- 1 → re-run `20261002121417_a_board_is_judged_at_day_thirty_only_on_roles_posted_while_we_were_reading_it_in_full.sql`
  whole (it drops by name), **and roll the frontend back with it**: without the
  role columns the verdict reads every employer as unknown. The sentence
  migration 1 appended to `get_actively_hiring_companies`' COMMENT would then
  describe columns that no longer exist: re-run that function's `COMMENT ON`
  statement from `20260909201000_the_same_late_date_in_thirteen_more_places.sql`.
- Frontend: restore the frontend files listed under "Frontend" (and the nine
  locale files) to `acd64c4c`, the commit this branch started from.

## For the integrator

- **Same defect, outside this group's files, not changed:**
  `supabase/functions/agent-runner/index.ts` still gives the apply queue a
  `fills` reason from `fills_90d` (`{ k: "fills", n: h.fills_90d }`), and
  `src/components/account/MorningQueuePanel.tsx` renders it as "we watched
  {{n}} of its roles come off the board and stay off". The fix is one line
  (`n: h.filled_roles_90d`, gated the same way) plus an agent-runner
  `FN_BUILD` bump; it belongs with whichever group owns agent-runner.
  `src/pages/Explore.tsx` `closureRecordOf` also counts closers from
  `fills_90d` / `relists_90d` (event counts; the register did not name it).
- **A third chain with the L13-12 shape, not changed:** `refresh_layoff_partition`
  (20261002122309) builds its day-30 arms from the same closure / exit arms and
  censors doubted rows the same way, without the seen-again test. The register
  named the two fill curves; the partition is the layoff page's filed-vs-control
  comparison, and applying the same rule there is a re-issue of that function
  (and a move of the pins in a-day-thirty-share-needs-thirty-days-of-reading-in-full).
- **The employer page and the leaderboard now publish different role counts
  for a board with dark batches, by one rule, and both contracts say so.**
  `get_company_fill_curve` removes a doubted closure whose posting was seen
  again before it counts roles; `get_actively_hiring_companies` (unchanged,
  20260909201000) still drops a role on ANY doubted closure in the window. A
  role that flapped in a dark batch and then came down for real is in
  `filled_roles_90d` on the employer page and in neither of
  `filled_roles_ceiling` / `relisted_roles_floor` on /explore and the hiring
  index, so those pages can print fewer filled roles for the same employer
  (largest on Workday tenants such as `jj~wd5~JJ`). Migration 1 corrects the
  curve's COMMENT (it said "built as get_actively_hiring_companies builds")
  and appends one sentence to the leaderboard's COMMENT (which said the two
  "cannot publish different fill counts"); executed in
  `src/test/two-role-counts-built-differently-claimed-to-be-built-alike.test.ts`.
  Aligning them is a re-issue of the leaderboard — either apply the
  seen-again rule there, or have it publish the curve's role counts for the
  ≤ 200 tokens it already measures — and was not done here: that function
  already answers 500 at its 25 s header when called live (see "What to
  measure"), so it wants its own change and its own measurement.
- **agent-mcp needs no change**: `employer_hiring_record` reads
  `get_company_hiring_health`, and its basis already says `closed_90d` counts
  takedown events, not distinct postings.
- **Locales**: `jobsPage.repostTipRoles` is new in all nine files (the card's
  role-caution tooltip). `jobsPage.takedownsToday` is renamed `jobsPage.takedownsLast24h`
  in all nine files; another group editing those files may conflict on that
  line. `jobsPage.verdictFills` and `jobsPage.intel.net7d` are now unused and
  were left in place.
- **Guards whose pins moved** (MOVED, NOT DROPPED, each with its reason in
  place): a-median-drawn-from-a-window-that-cannot-hold-one,
  a-role-still-up-at-day-thirty-is-a-share-not-a-verdict,
  a-day-thirty-share-needs-thirty-days-of-reading-in-full (its floor checks now
  read the newest definition), a-week-of-takedowns-cannot-outnumber-its-own-quarter
  (flagged era 25 → 22 days so the fenced series covers it on every weekday),
  its page test (cache stamp moved to 09-29), instrument-recovery (pins the
  fallback's absence), a-collection-failure-is-not-four-hundred-fills
  (`get_trending_categories` added to its ledger with the reason it is not a
  fill statistic), we-could-not-observe-it-is-not-they-are-not-hiring and four
  Jobs render tests (fixtures carry the role columns).
- **Section 7h / 4** of `scripts/verify-deploy.sh` read the cached field pool;
  migration 2 withholds it until the next `:27` run, so a verifier run inside
  that hour reads it absent.
- **types.ts** was edited by hand for the two new columns; a Lovable
  regeneration should produce the same lines.

## Register items

| id | outcome |
|----|---------|
| L11-02 | fixed: role columns (migration 1), Jobs.tsx lander / posting verdict / badge tip / compare drawer / card slot (the "Fills fast" branch asks `hiringRecordVerdict`, and the role caution `relistCaution` the pane prints takes the slot — new `jobsPage.repostTipRoles` in nine locales), `hiringRecordVerdict`, Account.tsx tracker chip. agent-runner + MorningQueuePanel listed above, not changed. |
| L13-12 | fixed at both grains (migrations 1, 2), pglite invariance test. |
| L2-06 | fixed: SQL fence (migration 3) and the page drops a cached week past the fence at the cache's stamp. |
| L2-21 | fixed: `live_new` (migration 3), tile divides by it. |
| L2-22 | fixed: `timeZone: "UTC"` in `weekLabel`. |
| L11-10 | fixed (migration 4). |
| L11-06 | fixed: rolling 24 h (migration 3) + copy in nine locales. |
| L11-04 | fixed (migration 5) + guard on every published score statistic's allowlist. |
| L13-16 | fixed for closures, exits and layoff filings (migrations 6–8). The `NULL` argument both crons pass is written by 20261008112500 / 20261008113000 into the job commands and checked by their own `DO` blocks after apply; `get_cron_health` cannot confirm it (it reports the header, `ch_timeout`, and never the command text) — it confirms only that both jobs ran bare before apply (timeout null) and carry `10min` after. |
| L11-03 | fixed by not rendering `net_7d` (the RPC is unchanged). |
| L2-10 | fixed: dead fallback removed, explicit unread state. |
| L2-11 | fixed: stamp, stale parts, reworded claims. |
