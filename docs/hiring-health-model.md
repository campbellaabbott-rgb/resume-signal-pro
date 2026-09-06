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
| `FILL` | `closures`, `NOT superseded`, complete fetch, not suspect | event of interest |
| `RELIST` | `closures`, `superseded` | **competing event** |
| `CAP` | `exits.exit_reason = 'aged_out'` | right-censored at `days_on_board` |
| `LIVE` | `postings.missing_since IS NULL` | right-censored at `now − origin` |
| `DROP` | truncated fetch, `backdated`, suspect batch | removed from the risk set |

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

**Do not publish a median unless it exists.** The median time-to-fill is
`min{ t : S(t) ≤ 0.5 }`. If `S(30) > 0.5` the median is not reached inside our
window and the honest output is `> 30 days`, not a number. The present code
manufactures a median from a window that cannot contain one.

**Precision.** Greenwood on `S`:

```
Var(S(t)) = S(t)² · Σ  d_j / ( n_j (n_j − d_j) ) ,  d_j = d_j^fill + d_j^relist
                  t_j ≤ t
```

CI on the complementary log-log scale (stays inside [0,1] at small n):

```
S(t) ^ exp( ± 1.96 · √Var(S) / ( S(t) · ln S(t) ) )
```

For `R(t)` itself the Aalen–Johansen variance is impractical in plpgsql; take
the interval from a 200-draw bootstrap computed once daily into a rollup table,
never per request.

## 5. Honesty gates

Render nothing unless all hold:

* `n(14) ≥ 25` — roles at risk at the horizon
* `d^fill(≤14) ≥ 5` — actual observed fills
* CI half-width on `R(14)` ≤ 15 percentage points
* stated-date coverage `≥ 0.60`, where
  `coverage = dated / (dated + undated)` for that employer

Below any gate: "not enough history yet", with the tracking span. Between 0.30
and 0.60 coverage, render with the qualifier "across the N% of this employer's
roles that carry a posted date."

**Never coalesce the origin.** Durations come from the stated cohort only.
Undated postings still contribute to *counts* (openings, closings, live), never
to *durations*. Coverage is disclosed on the surface, per the stat-provenance
rule.

## 6. Feed-dark guard

A closure batch is marked `suspect` when

```
removed_in_batch > max(5, 0.30 × live_count_before)
```

and is promoted to counted only after the same board produces a successful
fetch on a later day that does not restore those postings. A genuine takedown
survives the next fetch; a feed blip does not.

Going forward this needs `job_board_closures.suspect boolean default false`
plus `batch_removed int` and `batch_live_before int` so the guard is auditable
and recomputable. For the ~54 days of existing history there is no batch id, so
apply the retroactive proxy at read time: group by
`(company_token, date_trunc('hour', closed_at))` and drop any hour whose count
exceeds `max(5, 0.30 × open_roles)`.

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
4. Rewrite `get_category_fill_speed` and `get_actively_hiring_companies` on the
   same estimator; **delete the 7-day floor from all three**.
5. Daily rollup for the bootstrap CI.
6. UI: replace "median days to fill" with `R(14)` + coverage; show `> 30 days`
   where the median is not reached; label `X_board` with `≥`.

## 10. What this cannot fix

Total lifecycle history is ~54 days (`tracking_days` maxes at 52 live). `R(30)`
will be thin for months. The 30-day serving cap means anything about lifetimes
past 30 days is unmeasurable from this data at any sample size — the correct
response is to say so, not to extrapolate.
