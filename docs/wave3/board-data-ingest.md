# Wave 3: board, data pages and ingest parsers (group board-data-ingest)

> **Integrated 2026-10-10 on `wave3/integration`.** The builds this note names
> are this branch's own strings. Several were reused by other wave-3 branches on
> different code, so every function the integration changed answers a later
> build: see the stamp table in [README.md](README.md). Deploy from the ledger
> (`node scripts/deploy-ledger.mjs --message` at the merge commit), never from
> the tables below.

Branch `wave3/board-data-ingest`, from `12a37285` (wave 2, PR #24). Sources: the
S8 debug-sweep register of 2026-10-08 (every item with fix_group
`frontend-board`, `data-pages-sql`, `ingest-parsers`), the 2026-10-04
register's open `ingest-parsers` items, the wave-2 frontend handoffs
(docs/job-board-deploy-notes.md `.91`, "FRONTEND HANDOFFS"), and the
commercial-readiness plan's board items (visit source on every page, the free
score on job pages, a phone menu, the first job above the fold).

## What ships

| Piece | Build / file | Order |
|---|---|---|
| Frontend | the same commit | any time; reads the new reader column when it exists and keeps the old sentence when it does not |
| layoff-filings | `2026-10-09.1` (GET returns `version`) | before migration 160100 |
| agent-runner | `agent-runner.2026-10-09.1` | any time (fit clamp) |
| public-api | `public-api.2026-10-09.1` | any time (fit clamp) |
| send-search-digest | `send-search-digest.2026-10-09.1` | any time (fit clamp) |
| agent-mcp | `agent-mcp.2026-10-09.1` | any time (fit clamp) |
| job-fit | `job-fit.2026-10-09.1` (new marker, review 2026-10-10) | any time (fit clamp) |
| application-fit | `application-fit.2026-10-09.1` (new marker) | any time (fit clamp) |
| job-board | **no bump here**: rides the job-board group's `.92` (see "Paste into the .92 section") | the job-board group's order |

`_shared/fit-score.ts` changed, so every importer above is rebuilt. If another
wave-3 group also bumped agent-mcp, public-api, agent-runner or
send-search-digest, keep the later build string; the code changes do not
overlap.

### Migrations, in apply order

All four are new files in 20261009160000-169999, self-verifying (a DO block
RAISEs if the change did not land) and safe to re-run. None adds a SECURITY
DEFINER function a stranger can call: two readers are re-created with the same
signature and the same grants, two definitions are rewritten from the catalogue.

1. `20261009160000_an_exit_cost_filing_is_not_printed_as_a_workforce_reduction.sql`
   DROP + CREATE `get_employer_layoff_filings(text[])` and
   `get_employer_layoff_filings_all(text)` with one more OUT column
   (`lf_workforce` / `la_workforce`), bodies otherwise those of 20260918100500 /
   100600, REVOKE FROM PUBLIC, anon, authenticated, then GRANT anon,
   authenticated, service_role exactly as before (both are on the census
   allowlist; neither gains a caller). Rewrites `refresh_layoff_partition()`
   from `pg_get_functiondef` so the filed arm admits an 8-K only when
   `is_workforce_event IS TRUE`. No dependency.
2. `20261009160100_an_illinois_notice_dated_after_its_stamp_is_not_a_notice_date.sql`
   Supersedes every active state_warn row whose notice date is later than its
   own stamp (37 IL rows on 2026-10-08), and rewrites the partition's stamp-lag
   query to active, correctly dated notices. **Apply after layoff-filings
   2026-10-09.1 serves**: the old build would re-upsert the same ids as active
   on its next nightly read. Ideally after one nightly WARN run of the new
   build, which re-creates each notice under its true date and a stable id.
3. `20261009160200_a_company_lander_reads_only_its_own_employer.sql`
   Rewrites `get_company_intel(text)` and `get_similar_companies(text,int)`
   from the catalogue: a Workday token groups with its tenant's Workday sites,
   every other token is its own employer (two index-served arms, never a
   CASE). Refuses to run if the live bodies drifted from 20260827140000. No
   dependency.
4. `20261009160300_a_federal_wage_filing_needs_an_employer_hiring_in_the_us.sql`
   Rewrites `get_employer_lca_wages` from the catalogue: answers only for a
   token with a live US posting. No dependency.

## Item by item

### Frontend (board, header, pages)

| Item | Fix |
|---|---|
| visit source on every page (commercial plan) | `VisitSource` in App records utm/referrer/landing on whatever page the visit starts on (job pages, data pages, /agents, /r/<code> before its redirect), through the one transport and visitor id; guarded so blocked storage cannot take the app down |
| free score on job pages (commercial plan) | "Score my résumé against this job (free)" beside Apply hands the posting to the scanner (rb_jd_handoff, src/lib/jd-handoff.ts); `job_page/posting_view` and `job_page/score_against_job` give the experiment its ratio |
| wave-2 handoff: sortUnavailable | an empty pay-sorted page says no match states pay (or the pay read failed) and offers "Show them newest first"; the screen-reader status agrees |
| wave-2 handoff: facetSource "withheld" | the rail says why a text search's fields carry no counts |
| wave-2 handoff: intentFilters undo | "Search those words as text instead" re-sends the same query with `noIntent: true` (list, field probe, both count probes), keyed to that query; undoable |
| wave-2 handoff: lifted pay figure undo | **not possible client-side**: filters.ts lifts a pay figure whenever no positive slider floor is sent (`hasExplicit`) and takes no flag to stop it. Handoff to job-board: a `noPayLift: true` (or honouring `salaryFloor: 0` as explicit) so the page can offer the same undo |
| phone menu + S8-093 | under 640px one menu button holds the nav and Sign in; the /agents icon and the bar's Sign in moved into it; the wordmark gives way under 375px. Local build at 375x812: Start's right edge 364px, no horizontal overflow; at 360x740: 344px |
| first job above the fold | below sm only: the tracked-corpus stats line and the agent pitch hidden, the date chips one scrolling row, "Send this search to my agent" icon-only. Live /jobs at 375x812: first card at 1,006px; local build: 684px (title ends 722px); 360x740: 688px |
| S8-094 | Start scrolls to the page's own uploader on the scanner landers instead of navigating to /#upload |
| S8-095 | a press on the skip link lands on the page's `<main>` (or first `<h1>`) wherever the page has no #main-content |
| S8-028 | the "posted before your last visit" divider only where the order is the stated date newest first; undated postings neither place it nor count as old |
| S8-091 | board scroll offsets are kept per address and restored only on Back/Forward onto that address |
| S8-092 | the card and the company lander ask `relistCaution` (the drawer's and pane's rule); a caution can never sit beside a "closes" verdict |

### Data pages and their SQL

| Item | Fix |
|---|---|
| S8-021 | migration 160200 + `src/lib/employer-group.ts` for the two client caches (getEmployerCtx, compare drawer) |
| S8-026 | migration 160000; the page prints an exit-cost 8-K as "filed an 8-K under Item 2.05 (costs of exiting or disposing of an activity)" with a neutral chip; layoff-filings marks a progress report on a previously announced plan as no workforce event (narrow: none of the 28 saved filings flips), but never a section that commits to new, additional, expanded or second-phase reductions ("an expansion of the previously announced plan ... 300 additional employees" stays a workforce event with its headcount; review 2026-10-10). A headcount alone does not make a section new: a progress report restates the cut it reports on. Stored rows: `edgar_reread` (owner step) |
| S8-096 | the Ghost Index says "State agencies stamp a notice a median N days after its notice date ...; when it reaches us after that is not measured" (nine locales) |

### Ingest: layoff-filings 2026-10-09.1

| Item | Fix |
|---|---|
| S8-025 | Illinois' notice is the earliest date in "Notification Date(s)"; any state's notice date later than its stamp is refused as a notice date (`notice_after_stamp=N` in the feed note); migration 160100 for stored rows |
| S8-106 | Oregon map pinned to the live header (WARN#, Company Name, Location, Layoff Date, Laid Off, Layoff Type, Received Date; read 2026-10-10, 1,374 rows, saved as `scripts/data/layoff-samples/bln-raw-or.csv` and tested); lines fold only where WARN# AND Location agree (9556 is 105 at New York, not 106; 9509's five sites stay five), because the card says "N positions at SITE" against a single-site bar; "Company - Site" filers match on the company (Amentum, PacificSource, Wells Fargo); an unverified map whose count resolves to nothing is refused. **Counts only**: Oregon names many notices by facility ("Medford Delivery Facility" 170, "Portland Truck Manufacturing Facility" 387, "Tualatin Oregon Facility" 87, "Lombard Street Facility" 80); those now carry their counts but match no board until a facility-to-employer alias exists, so the two notices the register named still reach no card |
| S8-107 | a validator is stored only for an ok read; a feed whose last read was refused is fetched without If-None-Match |
| S8-108 | a primary-document GET that answers 429/408/425/5xx/nothing stores no row (`document_<status>_retry`), so the next run reads it; 404/410 stored as before. Stored placeholders: `edgar_reread` |
| S8-026 + S8-108, rows already stored | `POST {action:"edgar_reread"}` (one-shot, cron key): re-reads active `sec_8k_205` rows inside the 90-day window that are a "(document not read)" placeholder, or a workforce event whose stored section is a status update; replaces a row only when the document was read (a failed read never overwrites a good row); chunked by filing_id with a self-kick; logged under the `edgar_backfill` read-log kind (`reread ... replaced= flipped= unread=`), because the kind check admits no new kind without a migration |
| S8-109 | Massachusetts' "*Updated* <employer>" is an amendment (affix wrapped in punctuation) |
| S8-024 | lca_wages refuses the rejected-pair ledger (`LCA_REFUSED_TOKENS`: socialfinance, sigmasoftware2); migration 160300 (a live US posting); scripts/load-oflc-lca.mjs refuses a name two filers stand behind (two legal forms or two EMPLOYER_FEIN values, `two_filers_one_name=`) |
| S8-105 (wage side only) | lca_wages posts no cell for a token the catalogue carries under two vendors (139 tokens; 4 carry cells: sunday, echo, roadrunner, lockwood). Over the embedded payload: 5,534 cells, 5,460 posted (65 ledger, 9 twin). **The layoff side is still open**: `layoff_matches_rebuild` (SQL) does not refuse twin tokens, so a filing matched to one (sunday, echo) would print on both vendors' boards. Latent today; see "Not fixed here" |

### Ingest: job-board parsers (ride `.92`)

| Item | Fix |
|---|---|
| L13-19 | NT$/AR$/CL$/COL$/RD$/$U are those currencies and a bare $ in Taiwan is TWD. A bare $ in AR/CL/CO/DO/UY is the peso only when, read as dollars, it would pay a million a year or more (figure x period multiplier, the top of a range); otherwise USD, because most bare-$ pay placed there is a remote job paid in dollars (review 2026-10-10: the first cut moved 20 of 34 CO and 27 of 32 AR stated-pay rows to a peso, e.g. LawnStarter "$75,000–$100,000" in Bogotá; now 0 of the dollar-magnitude rows, and AR "$900,000 - $1,000,000" is ARS). A figure in millions/billions is no wage. These six currencies have no `salary_rank_usd` arm, so they rank NULL instead of ranking as US dollars at ~30x; the arms are the same column rewrite HKD waits for. Known residue: a DOP/UYU monthly wage of 35,000-83,000 written with a bare $ reads as USD, and the parity cap then refuses its annual figure (no false rank, a wrong label) |
| L7-06 | "Up to $X" alone sets no floor; the miner keeps the qualifier |
| L7-07 | a period after each figure keeps the whole range (miner and parser) |
| L7-04 | Recruitee pay reads `salary.period` |
| L7-05 | Lever pay keeps exact figures (statedPayText); a one-time payment is not a rate |
| L7-14 | a trailing ", XX" that is the leading city's own country wins; an upper-case trailing state code beats a country word earlier in the string, unless that word names the same code ("India, IN", "Remote (Canada), CA", "Frankfurt am Main, Germany, DE" keep their country; review 2026-10-10); COUNTRY_MAP_VERSION 7 -> 8 |
| L7-15 | iCIMS' country_code gives way to a location that plainly names another country |
| L7-08 / L7-09 / L8-15 | staff/lead/partner rungs only where they are rungs; a minimum age is not a requirement wherever "of age", "old" or "older" sits between the number and the experience word, and "to work" is availability, not experience ("Must be 18 years or older and able to work weekends"); a company's age is refused only in a company clause ("for over 15 years, Acme has been", "we've been ... for nearly 10 years"), so "Over 10 years of experience" reads 10; a version number between the years and the word ("Python 3", "Office 365", "HTML5") no longer drops the requirement, only a second "<n> years" does; nothing above 20 years is one |
| L13-22 | clusterKey keeps letters and digits of every script |
| L8-13 | fit precision capped at 1, the score at 100 (`_shared/fit-score.ts`) |

### Not fixed here, and why

| Item | Why |
|---|---|
| L7-03 (duplicate tokens: 8 iCIMS pairs, eu~imc, ADP shared requisitions) | removing catalogue tokens moves the orphan-prune highwater (`orphanPruneBlocked`) and needs the census-merge protocol; a job-board/owner decision |
| L7-12 (14 boards named "Jobs"/"Job Board") | each name has to be read from the employer's own page, then RENAMED_TOKENS + NAME_SYNC_VERSION in job-board/index.ts; the job-board group's catalogue lane |
| L7-16 (six vendors without a drift canary, UKG/Paylocity raw counts 0, oversize canaries) | needs live in-budget board picks per vendor and the UKG/Paylocity raw shapes; job-board's health lane |
| S8-024, per-cell state check | `region_code` is not stated on enough postings to tell "no posting in that state" from "the location named no state" |
| S8-105, (vendor, token) keys, and the layoff side of the twin refusal | schema work on oflc_lca_wages and layoff_matches; the twin-token refusal stands in for wage cells only. Refusing twin tokens in `layoff_matches_rebuild` needs a rewrite of that SQL function (layoff_board_names carries vendor, so the rule is expressible) and a live check of what it un-matches; not safe without production access. Latent: measured 2026-10-10, `get_employer_layoff_filings` (anon) over all 139 twin tokens answers 0 filings |
| Oregon facility-named filers | need a facility-to-employer alias table (e.g. "Portland Truck Manufacturing Facility" to its employer); nothing here invents one |
| L7-08/09, L8-15 on stored rows | backfill-experience fills NULL bands only; a re-derive sweep for title-only rows and min_years > 20 or age sentences is a job-board handoff. New rows are right from `.92` |
| the lifted pay figure's undo | needs a server flag (above) |

## Paste into the `.92` section (job-board deploy notes)

> ALSO IN .92 (wave 3, board-data-ingest; docs/wave3/board-data-ingest.md):
> normalize.ts, experience.ts, descriptions.ts, `_shared/salary-extract.ts`,
> `_shared/fit-score.ts`, and three index.ts lines. SALARY_PARSE_VERSION 9 -> 10
> (backfill-salary re-reads stored text: dollar currencies of TW/AR/CL/CO/DO/UY,
> millions refused, "up to" ceilings, per-figure periods); COUNTRY_MAP_VERSION
> 7 -> 8 (trailing city country / trailing state code; stored rows correct on
> re-read, and a re-derived country is no longer logged as an employer edit:
> DERIVED_NOT_EMPLOYER_EDITS gains `country`); Recruitee period and exact Lever
> figures, with OUR_PAY_REWRITE = lever, recruitee **ONE-SHOT: remove in the
> first build after one full cold rotation of .92**, until then a genuine pay
> edit on those two vendors is patched without a field-change row; iCIMS
> country; seniority words and year sentences (new rows only); clusterKey in
> every script; fit capped at 100. Review fixes (2026-10-10): a bare $ in
> AR/CL/CO/DO/UY is the peso only at a million a year or more; age sentences
> and "to work" are not experience, "over 10 years of experience" and
> "Python 3 experience" read again; a country word beats its own code read as
> a state. Source +11,777 bytes (job-board + _shared .ts 4,112,395 ->
> 4,124,172).

## Owner steps

- After layoff-filings 2026-10-09.1 serves: run `POST {action:"lca_wages"}`
  (the quarterly load, cron key) so the swap removes the ledger and twin-token
  cells; until then `get_employer_lca_wages(['socialfinance','sunday'])` still
  answers cells (section 77 prints them, INFO). Migration 160300 already hides
  sigmasoftware2 (no live US posting).
- Apply 160100 only after the new layoff-filings serves (above).
- After layoff-filings 2026-10-09.1 serves (and ideally after 160000, whose
  readers print the flag it corrects): run `POST {action:"edgar_reread"}`
  once with the cron key. It self-kicks until done; read the
  `edgar_backfill` read-log rows whose note starts `reread`. Expect
  `flipped` to count stored status updates (Freshworks 2026-08-04 if its
  section is one) and `replaced` to include every placeholder SEC now
  serves; `unread` rows keep their old reading.
- In the job-board build after `.92` has done one cold rotation: delete
  `OUR_PAY_REWRITE` (job-board/index.ts).
- Nothing in Stripe, nothing in auth settings.

## Rollback

- Frontend: revert the branch's src commits and republish.
- layoff-filings: redeploy 2026-09-25.1. Rows the new build wrote stay valid
  (the IL rows carry their true dates). Expect the old build's next nightly
  read to upsert the misdated IL ids as active again, which undoes 160100's
  supersede for those rows by itself; nothing to run.
- 160000: re-apply 20260918100500 and 20260918100600 bodies after `DROP
  FUNCTION` of both (the OUT list shrinks), then their grants; re-apply
  20261002122309's refresh_layoff_partition.
- 160100: `UPDATE layoff_filings SET status='active' WHERE status='superseded'
  AND source='state_warn' AND event_basis='warn_notice_date' AND event_date >
  public_date` (only rows this migration touched have that shape), and
  re-apply 20261002122309's refresh_layoff_partition.
- 160200: re-apply 20260827140000's two function definitions.
- 160300: re-apply 20260925150733's get_employer_lca_wages (DROP + CREATE +
  its grants).
- Fit-clamp functions: redeploy the previous builds.

## Measure

- `scripts/verify-deploy.d/77-wave3-board-data-ingest.sh`. Pre-deploy run
  2026-10-10: every build line FAIL (agent-runner .10-05.2, public-api
  .10-05.1, send-search-digest .10-04.1, agent-mcp .10-05.2, layoff-filings
  2026-09-25.1), every bundle literal FAIL, eu~lookers / eu~rubyhotels both
  usd_n 249, sigmasoftware2 TX 105976-134971, no lf_workforce; the stamp lag
  0 (PASS); job-board serving .90; "Bangalore" list 2 of 60 rows ", IN"
  stored US. Re-run after the review fixes (2026-10-10): job-fit and
  application-fit FAIL (no x-fn-build yet), the peso line PASS (0 of 47
  bare-$ CO/AR rows under a million labelled in pesos; production labels
  every bare $ USD until v10).
- Analytics: `job_page/score_against_job` over `job_page/posting_view`; the
  funnel's referred landings should rise from the floor of 37/month now that
  job pages, data pages, /agents and /r/ record (read in the owner's SQL
  editor, never anon).
- After the job-board build: `field_changes` rows for lever/recruitee salary
  should NOT spike (OUR_PAY_REWRITE); country=US rows ending ", IN"/", DE"
  should fall as boards are re-read.
- layoff_feed_health for OR: rows_last_run > 0 with workers; IA/MD/GA/AZ/VA
  keep their header notes on 304 nights. OR filers with "Facility" in the
  name stay unmatched (expected; no alias).
- Section 77's peso line: bare-$ CO/AR pay under a million labelled COP/ARS
  must stay 0 after the v10 re-read (it is 0 before, when every bare $ is USD).
