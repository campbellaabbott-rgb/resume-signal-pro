# Hiring health: the measurement model

Status: design, 2026-09-06. Replaces `median_days_to_close` / `p50_days_open`
everywhere they are published (`get_company_hiring_health`,
`get_category_fill_speed`, `get_actively_hiring_companies`).

## 1. The current number does not measure the labour market

Live production, `get_category_fill_speed`, ~600k closures, 18 categories:

| category | closures | median_days_open | p75 |
|---|---|---|---|
| healthcare | 101,638 | 14.9 | 21.3 |
| finance | 39,850 | 15.2 | 21.9 |
| design | 3,775 | 15.2 | 22.1 |
| legal | 7,006 | 15.8 | 22.7 |
| engineering | 68,055 | 16.2 | 23.1 |
| sales | 64,184 | 16.3 | 22.8 |

Eighteen categories spanning nursing, law, retail and ML research agree to
within **1.4 days**. At these sample sizes the standard error on each median is
well under a day, so the agreement is not sampling noise — it is structural.

The cause is that the observable support is **[7, 30] days by construction**:

* the ingest ages a posting out at `FRESH_WINDOW_DAYS = 30`
  (`job-board/index.ts:1704`), so no posting can ever be *observed* to close
  later than ~30 days after its stated post date;
* every fill surface then applies
  `closed_at - COALESCE(posted_at, first_seen) >= interval '7 days'`, deleting
  the entire left tail.

A median drawn from a window of [7, 30] lands near 15 whatever the underlying
distribution is. We are publishing half our own retention cap and calling it
time-to-fill.

## 2. Six biases, named

1. **Right-censoring ignored.** `median_days_to_close` uses only postings that
   have already closed. Roles still open are excluded, and long-open roles are
   disproportionately still open, so the estimate is pulled down.
2. **Administrative truncation.** Age-outs are not censored observations in the
   estimator — they are *absent* from it (they go to `job_board_exits`, which no
   published stat reads). That converts censoring into truncation, which is the
   bias in §1.
3. **A 7-day floor deletes fast fills.** It was added to suppress relist churn.
   The `superseded` flag already does that job; the floor removes real signal.
4. **Mixed origin basis.** `COALESCE(posted_at, first_seen)` silently changes
   what the number measures per row. A role that was up for 60 days before we
   found it reads as newborn. Same failure mode as the 2.8-day-median incident.
5. **Denominator mismatch.** `closed_90d` counts closures on the COALESCE basis;
   `median_days_to_close` covers only closures with a stated `posted_at` — a
   strict subset. They are rendered side by side as one fact. Live proof:
   `gici~wd5~Careers` returns `closed_90d: 41, median_days_to_close: null`.
6. **Feed-dark mass closure.** The `windowed` guard suppresses logging on a
   *truncated* fetch, but a board that returns a valid near-empty feed logs
   every posting as a removal in the same second. A collection failure is
   recorded as several hundred fills.

Also: `superseded_90d` is a **floor, not a count** — the collector logs only the
first superseded closure per title per 24h
(`job-board/index.ts:3566`). Publishing it as a count overstates precision.

## 3. Event taxonomy

Exactly one terminal state per posting at analysis time.

| state | condition | role in the estimator |
|---|---|---|
| `FILL` | `closures`, `NOT superseded`, complete fetch, not suspect, not in a feed-dark batch | event of interest |
| `RELIST` | `closures`, `superseded` | **competing event** |
| `CAP` | `exits.exit_reason IN ('aged_out','board_dormant','untracked')` | right-censored at `exited_at − exits.posted_at` |
| `LIVE` | `postings.missing_since IS NULL` | right-censored at `now − posted_at` |
| `DROP` | truncated fetch, `exit_reason = 'backdated'`, `exit_reason = 'removed'`, suspect batch, feed-dark batch | removed from the risk set |

**`days_on_board` is never a censored time.** The collector writes it from
`COALESCE(posted_at, first_seen)` at three of its four exit write sites —
including the freshness sweep, which is the main producer of age-outs — so
censoring at it puts our discovery time into the estimator on the majority of
censored rows. That is bias 4 above, in the one place it would never show up as
a published number: it only shifts censored times. `job_board_exits.posted_at`
(added 2026-09-06) is the origin the censored arm uses, and a row without one
contributes to counts alone.

**`board_dormant` and `untracked` are censored, not dropped**, against what this
section said before. They are our fetch failing and our dropping a board, not
the employer stopping; the role's fate after that date is genuinely unknown,
which is the definition of censoring. Excluding them would delete observations
rather than censor them — the same truncation this model exists to remove.
`ageouts_90d` counts `'aged_out'` alone, because that column is published as an
age-out count.

**`'removed'` must be excluded.** Every closure row is mirrored into the exit
ledger with that reason; admitting them double-counts every fill.

**`backdated` is excluded** for the opposite reason to the others: those
postings' stated dates precede our first sighting by more than the serving
window (measured median tenure 174 days, oldest 8.7 years). They are LEFT-
truncated — never at risk from `t = 0` — and admitting them inflates `n_j` at
every day inside our horizon with observations that cannot produce an event
there, which depresses the hazard and pulls the fill rate down.

The two upgrades that matter: **age-outs and live roles become censored
observations instead of absences** (kills bias 1 and 2), and **relists become a
competing event instead of censoring** (a relist is evidence the role did *not*
fill; censoring it assumes it would have filled at the same rate as the rest,
which is exactly backwards).

## 4. The equation

Origin `u_i` = employer-stated `posted_at`. Lifetime `t_i = exit − u_i` in days.
Distinct exit times `t_1 < t_2 < … < t_k`. At each:

* `d_j^fill`  = fills at `t_j`
* `d_j^relist` = relists at `t_j`
* `n_j` = at risk just before `t_j` = every posting not yet filled, relisted,
  aged out, or censored

**Event-free survival** (both competing events):

```
S(t) = ∏ ( 1 − (d_j^fill + d_j^relist) / n_j )
      t_j ≤ t
```

**Cumulative incidence** (Aalen–Johansen) — the published numbers:

```
R(t) = Σ  S(t_{j−1}) · d_j^fill  / n_j      ← genuine fill rate by day t
      t_j ≤ t

X(t) = Σ  S(t_{j−1}) · d_j^relist / n_j     ← relist rate by day t (a floor)
      t_j ≤ t
```

By construction, for every t:

```
R(t) + X(t) + S(t) = 1
```

Every role is accounted for — filled, recycled, or still open. That closure
property is what the current model lacks in every direction at once.

**Headline horizon t = 14 days.** It sits strictly inside the observable window
for every dated posting, so `R(14)` needs no extrapolation. Publish `R(7)`,
`R(14)`, and `R(30)` only where support reaches it.

**Do not publish a median unless it exists.** The published median is
`min{ t ≤ 30 : R(t) ≥ 0.5 }`. If `R(30) < 0.5` it is not reached inside our
window, `median_days_to_fill` is NULL and `median_censored` is TRUE; the honest
output is `> 30 days`, never a number and never an interpolation. The code this
replaces manufactured a median from a window that could not contain one.

**The median is read off `R`, not off `S`, and that is a deliberate departure
from the contract this document first froze.** The original form was
`min{ t ≤ 30 : S(t) ≤ 0.5 }`. `S` is the survival free of *both* competing
events, so the day it crosses one half is the day half the roles have filled
**or** been re-listed: a field with `R(8) = 0.28` and `X(8) = 0.24` crosses at
`t = 8` while only 28% has actually filled, which publishes a fill median set by
churn beside a near-zero fill rate. Both estimators therefore compute
`min(tt) FILTER (WHERE tt ≤ 30 AND r_cif ≥ 0.5)`
(`20260906091000_censoring_is_not_truncation.sql:490`,
`20260906092000_a_median_from_a_window_that_cannot_hold_one.sql:377`). The
column keeps its name and its type; what changed is that the name is now true.

**So every renderer must say FILLED.** *"Half of these roles are filled by day
{d}"*, never *"half are off the board by day {d}"* — the latter is the sentence
for `1 − S(14)`, which is a different figure rendered beside this one. This
shipped wrong once, in all nine locales (`jobsPage.fieldMedian` and
`jobsPage.hhMedian`) and in `/v1/stats`, which published the column as
`medianDaysOffBoard` with a basis string claiming it was read off the event-free
survival. Both are corrected; the API field is `medianDaysToFill`. Any new
mirror of the column moves with it.

**Precision.** Greenwood on `S`:

```
Var(S(t)) = S(t)² · Σ  d_j / ( n_j (n_j − d_j) ) ,  d_j = d_j^fill + d_j^relist
                  t_j ≤ t
```

CI on the complementary log-log scale (stays inside [0,1] at small n). Write it
with the Greenwood *sum* rather than with `√Var(S)`, and take the absolute value
of `ln S`:

```
gw(t) = Σ  d_j / ( n_j (n_j − d_j) )        ← Var(S) = S² · gw
       t_j ≤ t

v(t)  = gw(t) / ( ln S(t) )²

S(t) ^ exp( ± 1.96 · √v(t) )
```

Because `S ^ a` is *decreasing* in `a` for `0 < S < 1`, and `exp(+1.96·√v) > 1`,
the `+1.96` branch is the LOWER bound on `S` and the `−1.96` branch the upper.
That is what the SQL implements.

This section used to write the exponent as `√Var(S) / (S · ln S)`. With
`Var(S) = S²·gw` that quotient is `√gw / ln S`, which is **negative**, because
`ln S < 0` for `0 < S < 1` — so the `+1.96` branch gave an exponent below 1 and
therefore the UPPER bound, the exact opposite of the sentence beneath it. Anyone
porting the interval from the formula rather than from the SQL shipped `[hi, lo]`
and the sign-trap paragraph did not save them, because the paragraph and the
formula disagreed. Squaring `ln S` (equivalently, dividing by `|ln S|`) is what
makes the written sign the implemented one.

The `ln` inside `S` is clamped: implement `S` as
`exp(Σ ln(GREATEST(1 − d_j/n_j, 1e-12)))`. Without the clamp, a day where every
remaining posting resolves at once (`n_j = d_j`) gives `ln(0) = −Infinity` and
NULLs the whole row.

**Precision on `R(14)` — the closed form, not a bootstrap.** The exact
Aalen–Johansen variance is impractical in SQL, and the earlier plan here was a
200-draw bootstrap computed once daily into a rollup table. That plan is
withdrawn: it needs a table, a cron, and a staleness disclosure, all to widen an
interval we can bound directly. What ships instead is the closed form

```
f    = fills_le_14 / (fills_le_14 + relists_le_14)      ← observed fill share
R_lo = f · (1 − S_hi)
R_hi = f · (1 − S_lo)
```

**This is an approximation and must be published as one** — in the RPC's
`COMMENT ON` and anywhere the interval is rendered. It is EXACT only when the
fill share `f` is constant over `t`, because then
`R(t) = f · (1 − S(t))` identically and the interval on `R` is just the interval
on `1 − S` scaled by `f`. When the fill share drifts with `t` — early exits
skewing toward relists, say — the mapping is no longer exact, and the interval
is approximate rather than guaranteed-conservative. Do not present it as an
exact Aalen–Johansen interval; it is a Greenwood interval on `S` carried across
by the observed fill share.

## 5. Honesty gates

Two separate decisions, deliberately not one gate. `sufficient` says whether the
estimate is stable enough to show at all; `dated_coverage` says how much of the
employer's board the estimate speaks for. Folding coverage into `sufficient`
(as this section used to) throws away the middle case, where the number is
sound and simply needs to name its population.

**`dated_coverage` is not a validity check, and the three bands are not one.**
It is easy to read it as "the employer discloses dates on 64% of its roles, so
the estimate covers 64% of the board". That reading is wrong in a way that
matters: several vendors stamp `posted_at` only while a posting is inside a
rolling window and stop stamping it — or re-stamp it on a repost — once the role
is older (`20260721190000_company_snapshots_netnew.sql`). Undatedness is
therefore **correlated with posting age**, so the roles the duration arm drops
are disproportionately the long-open ones, which is the same right-tail loss
this model exists to remove, wearing a coverage label. Read the bands as *"how
much of the board this number speaks for, with the missing part skewed old"* —
never as *"the estimate is fine above 0.60"*. See §11.

**`sufficient` — the RPC's own gate.** True only when all three hold:

* `n_at_risk_14 ≥ 25` — roles at risk at the horizon
* `fills_le_14 ≥ 5` — actual observed fills
* CI half-width on `R(14)` ≤ 0.15 (15 percentage points)

Below any of them: "not enough history yet", with the tracking span. Never a
number.

**`dated_coverage` — returned separately, banded by the UI.** It is
`dated / (dated + undated)` for that employer, and it is NOT part of
`sufficient`. Three bands:

| coverage | render |
|---|---|
| `≥ 0.60` | plain — the estimate speaks for the board |
| `0.30 – 0.60` | with the qualifier "across the N% of this employer's roles that carry a posted date" |
| `< 0.30` | suppress the duration claim entirely; counts only |

**Never coalesce the origin.** Durations come from the stated cohort only.
Undated postings still contribute to *counts* (openings, closings, live), never
to *durations*. Coverage is disclosed on the surface, per the stat-provenance
rule.

## 6. Feed-dark guard

A closure batch is marked `suspect` when

```
removed_in_batch > max(5, 0.30 × live_count_before)
```

The batch is still **written** — the closure log is the one asset here that
cannot be re-derived later — and carries `suspect`, `batch_removed` and
`batch_live_before` so the call is auditable and can be overturned. Exclusion
happens at READ time, in the estimator.

**There is no promotion path, and this section used to promise one.** It said a
suspect batch is promoted back to counted after a later successful fetch
declines to restore the postings. Nothing implements that, so `suspect` is
permanent. The collector's two-pass grace and its 6h shrink ratchet deliver most
of what promotion would; a promoter that nobody wrote is worse than one nobody
promised. Either implement it or leave this paragraph as the record that it was
considered and dropped.

**The retroactive proxy keys on `(company_token, closed_at)` exactly**, not on
`date_trunc('hour', closed_at)` as this section first proposed. No proxy for a
batch id is needed: the collector computes one `closedAt` per board pass and
reuses it for every chunk of that pass, so the timestamp *is* the batch id. Hour
bucketing would be strictly worse — the hot lane runs several passes an hour,
and merging distinct passes lets a run of small legitimate takedowns add up past
the threshold and delete real fills. The proxy applies only to rows with
`batch_live_before IS NULL` (written before the collector stamped its batches),
so it retires itself as stamped history accumulates.

**Its threshold has a known defect: it is keyed to the board's CURRENT open-role
count**, `max(5, 0.30 × open_roles_now)`, not to the board's size at the time of
the batch. An employer that filled 300 roles in July and serves none today gets
a threshold of 5, and every historical pass above five rows is dropped. See
§11.

## 7. Board-level indicators

Over a trailing 90-day window for company `c`, with `F` fills, `R` relists, `A`
age-outs, `L₀` live at window start, and `L*` live roles whose origin is at
least 14 days old:

**Fill-through** — of everything that has had a fair chance, what resolved:

```
Φ = F / ( F + R + A + L* )
```

`L*` excludes newborn postings; counting them would punish an employer for
posting 100 roles yesterday.

**Churn** — how much of the board recycles rather than resolves:

```
X_board = R / (F + R)          reported as "≥", because R is deduped
```

**Absorption** — is the board growing or shrinking:

```
Δ = ( O − F − R − A ) / max(L₀, 1)      O = openings observed in the window
```

**Shipped as the snapshot difference, which is the same quantity.** Openings are
not logged anywhere we can read — exit-ledger rows carry no `first_seen`, so
counting arrivals would undercount by exactly the roles that left. The identity
`O − F − R − A = (live now) − (live then)` makes the difference of two snapshots
the same number without inventing one, so the RPC computes
`(open_roles_now − L₀) / max(L₀, 1)` against the earliest company snapshot inside
the window. Snapshots are pruned at 35 days, so **absorption's basis is shorter
than 90 days** and is NULL where no snapshot survives; both facts must be stated
wherever it is rendered.

## 8. The single sortable index

Resist collapsing: the four indicators move independently, and one score hides
which one is bad. Where a sort key is unavoidable, use within-peer-group
percentiles (same category, same size band) so the number cannot be misread as
an absolute quality claim:

```
H = 0.40·z(R(14)) + 0.30·z(Φ) − 0.20·z(X_board) + 0.10·z(Δ)
```

`z` = percentile within peer group, not a raw z-score.

## 9. Change list

1. Migration: add `suspect`, `batch_removed`, `batch_live_before` to
   `job_board_closures`.
2. Collector: compute the batch guard, stamp the three columns.
3. New RPC `get_company_fill_curve(text[])` implementing §4 with the §5 gates,
   reading closures ∪ exits ∪ live postings.
4. New RPC `get_category_fill_curve(p_days int, p_min_n int)` — the same
   estimator grouped by category, replacing what `get_category_fill_speed`
   published. **Delete the 7-day floor from every surviving read path.**
5. ~~Daily rollup for the bootstrap CI.~~ **Dropped.** §4 now uses the
   closed-form `R_lo = f·(1 − S_hi)`, `R_hi = f·(1 − S_lo)`, so no rollup table
   and no cron exist for this. Nothing is missing; the plan changed.
6. UI: replace "median days to fill" with `R(14)` + coverage; show `> 30 days`
   where the median is not reached; label `X_board` with `≥`. **`R(14)` is the
   fill arm alone** — it holds re-listings out as a competing event, so it is
   smaller than the share of roles that left the board by exactly `X(14)`. Copy
   that says "off the board" or "come down" is naming `1 − S(14)` and must
   either render that quantity or say "taken down for good, not re-listed".
7. `dated_coverage` is returned by both RPCs and is NOT folded into
   `sufficient` (§5). The three-band treatment is the caller's, applied
   identically on every surface that renders a duration.

## 10. What this cannot fix

Total lifecycle history is ~54 days (`tracking_days` maxes at 52 live). `R(30)`
will be thin for months. The 30-day serving cap means anything about lifetimes
past 30 days is unmeasurable from this data at any sample size — the correct
response is to say so, not to extrapolate.

## 11. Known defects in the shipped estimator

Recorded here because the estimator is honest arithmetic over a sample that is
not yet the cohort the arithmetic assumes. None of these is a reason to keep the
old median; all of them bound what the new numbers may be said to mean.

**1. The three arms are selected on different rules, so they are not one
cohort.** Events are selected by *event date* over a trailing 90 days
(`closed_at >= now() − 90d`, `exited_at >= now() − 90d`) while censored live
observations are selected by *current status* (`missing_since IS NULL`), with no
predicate on origin. `n_j` is then not the number at risk in any single
population. Worked example, steady state, 100 postings a day, half filling at
exactly day 10 and half ageing out at exactly day 30: the correct staggered-entry
cohort gives `n₁₀ = 8000`, `d_fill = 4000`, `R(10) = 0.500`; the shipped
selection gives `n₁₀ = 10000` and `R(10) = 0.45`, because the future age-outs of
recent entrants appear twice — once as live censored rows now, once as age-outs
when they resolve. At the log's real depth of ~54 days the understatement is
about 16% relative. **The fix is to select all three arms on ORIGIN** — add
`posted_at >= now() − make_interval(days => W)` to each arm and keep the event-
date predicate only as an index filter.

**2. The LIVE censoring arm is keyed on a field that goes missing exactly when
the observation would be long.** Several vendors stamp `posted_at` only inside a
rolling ≤30-day window and re-stamp it on a repost. The long censored
observations this change exists to add are therefore largely absent (dropped by
`WHERE tt IS NOT NULL`) or age-reset (a role up 90 days whose date was re-stamped
three days ago enters censored at `t = 3`). The truncation is reduced, not
removed, and `dated_coverage` reports the loss as an employer disclosure gap
rather than as an age-correlated hole in our own instrument (§5). Until the
coverage figure is split into coverage-over-closures and coverage-over-live-
postings, the live-side share is the one that matters and is not separately
visible.

**3. The feed-dark guard is asymmetric across surfaces.** Both curve RPCs apply
the stamped `suspect` column *and* the retroactive proxy;
`get_company_hiring_health`, `get_actively_hiring_companies`,
`get_category_fill_speed` and `get_employer_benchmarks` apply only `suspect`,
which is false on every row written before the collector guard shipped. The same
employer can therefore publish one fill count on a leaderboard and a much
smaller one on its own page. `/explore` and `/ghost-job-index` work around this
client-side by re-reading the count through `get_company_fill_curve`; the RPCs
themselves still disagree, and the proxy belongs in a shared helper applied by
all of them.

**4. The proxy's threshold uses the board's size now, not at the time of the
batch** (§6). A wound-down seasonal employer has every historical pass above
five rows deleted, and a genuine hiring class of 200 against 600 open roles is
dropped as well. Keying it to postings live at `closed_at`
(`first_seen <= closed_at AND (missing_since IS NULL OR missing_since >
closed_at)`), with an absolute floor, is the fix.

**5. `median_censored` is two-valued where the answer has three states.** It
ships as `(med IS NULL)`, computed after a LEFT JOIN, so a token we hold no rows
for returns TRUE — an assertion that survival exceeded one half at 30 days,
published about an employer we have never tracked. It should be
`CASE WHEN no observations OR fills_le_14 = 0 THEN NULL ELSE (med IS NULL) END`,
with NULL meaning "no basis". Every consumer must check `sufficient` before
rendering it. Note this bites the per-company RPC only: `get_category_fill_curve`
is an inner join gated on `obs_n >= max(p_min_n, 25)`, so every row it returns is
backed by hundreds of observations and its `median_censored` is always a finding
— which is why `/v1/stats`, which serves the category curve and not the company
one, is not exposed to it.

**6. `/v1/stats.fillCurve` is served from a cache key nothing writes.** The
endpoint reads `stats_cache.fill_curve`; `refresh_stats_cache` builds a fixed key
set that does not include it. Until a migration adds the arm —
`payload := payload || jsonb_build_object('fill_curve', (SELECT
COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM
public.get_category_fill_curve() x));` in the same BEGIN/EXCEPTION idiom as
`date_coverage` — the field is null on every request, and the deprecation notice
on `medianDaysToClose` must not name it as the replacement.

**7. `ghost_stats.closed_90d` is the loosest closure count we publish.** It
filtered neither relists nor suspect batches — the one figure in the system that
did neither, and the most widely read one (`/ghost-job-index`'s headline and
`closuresLogged90d` on `/v1/stats`) — until `20260906094000` added
`AND NOT superseded AND NOT COALESCE(suspect, false)` to the arm that builds it.
It still cannot apply the retroactive feed-dark proxy, which needs a
per-employer open-roles denominator that a single board-wide count does not
have, so it stays larger than the curve figures by exactly the unstamped dark
batches. Both surfaces state that difference rather than leaving it to be found
by subtraction.
