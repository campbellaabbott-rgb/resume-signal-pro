# Résumé matching: phase 0

Résumé matching finds jobs a reader could apply for, starting from a confirmed
profile rather than from the résumé's words. Today's "For you" searches with no
place at all: on the match bench (2026-10-12, 11 résumés with exact pools) 85.5%
of its top-20 rows were in places the reader could not reach, and its fit order
was no better than chance (exact-set P@10 14.5%). This phase builds the engine
and the `resume-match` function **behind no UI**: nothing on the site calls
them yet.

The design is the revised spec of 2026-10-12 (the "accuracy-first",
requirements-first prototype, ported with every review correction applied). The
full record, with the three prototypes and the judges, is
`reports/resume-matching-full-2026-10-12.json` in the design worktree.

- Reservation `resume-match`: branches `rm/`, migrations `20261016*`, function
  build `resume-match.2026-10-16.1`, verify section 97, deployOrder 5 (after
  wave 4, profiles and design, and R1). The integrator records it in
  `docs/deploy-ledger.json`.
- Deploy steps and the claims verify 97 checks: `docs/resume-match-deploy-notes.md`.

## Owner decisions applied

- **No employer-level outcome rates, ever.** A reader sees only their own
  history, as counts with n (phase 4).
- **Free** gets every gate, tier and requirement checklist, with the top 20 per
  run (`TOP_N = 20`). Pro gets more than 20, alerts, a synced profile,
  tailoring and interview prep (phases 1-4).
- **Work authorisation never syncs in v1.** It stays on the device:
  `src/lib/match/session.ts` keeps it in sessionStorage, and the synced shape
  (`syncableProfile`) is built from an allow-list that names no
  work-authorisation field, no line quoted from the résumé (no basis, no
  licence's own line, no headline as written) and no held security clearance.
  By default the site's request carries no work authorisation and no clearance
  either (`src/lib/match/request.ts`).
- **A posting whose requirements were not read is capped at Good** and labelled
  `requirements not read`. The label is added where the tiers are computed
  (`tierFor`), which the server and the device share, so a re-tier on the
  device keeps it.
- **The anonymous site path:** job-board's own meter first
  (`job_board_anon_check`: the same blocked networks and countries, one read of
  the address's board day), then 30 calls an hour per network bucket
  (`_shared/network-bucket.ts`: a keyed hash of the caller's /24 or /48, so a
  campus or carrier NAT shares it), counted atomically
  (`resume_match_rate_take`). Requirement quotes are cut to about 160
  characters, and the site's answer carries at most 4 required and 4 preferred
  lines per posting.
- **Wording.** Nothing implies a chance of being hired: "jobs you could apply
  for", never "jobs you can take", never "verified". `BANNED_MATCH_WORDS` in
  `_shared/match-tiers.ts` holds the list, and `src/test/match-wording.test.ts`
  scans every sentence the engine and the device modules can show. When the
  reader never named the countries searched (the résumé's home country stood
  in), the footer and the set-aside label say "the country your résumé says you
  live in", never "where you said you can work".

## Files

| file | what it does |
|---|---|
| `supabase/functions/_shared/resume-profile.ts` | Reads the facts a recruiter reads off the top of a résumé (home, where they would move, the countries they say they can work in, target titles, level, the years their dates show, licences, explicit authorisation lines), each with the line it came from. Authorisation is never inferred. A career changer whose years in the new field are not stated is read as entry, never as the old career's level. Runs in the browser (dynamic import) and, for mcp/v1 only, on the server. |
| `supabase/functions/_shared/title-families.ts` | 109 occupation families: core and near title patterns, a not-list, a head noun, the next rung, whether the job is on site, whether it is licensed. Version 1 is the prototype's 22 families plus common occupations written the same way; the spec's target of about 300, mined from the board's titles, is not done (it needs the title census). An occupation with no family falls back to the reader's own titles (query syntax stripped, at most six words each, always quoted) with a generic not-list, and the answer says `family: null`. |
| `supabase/functions/_shared/posting-requirements.ts` | Reads what a posting asks for, quoted from the posting: required and preferred lines, the stated minimum years, a licence and where it must be held, sponsorship, citizenship (alone, or with permanent residents), an active clearance (never one to obtain, one preferred or one "not required"), degree. A minimum of 16 or more, stored or re-read, is treated as unknown, and a sentence about the employer's own years is not a requirement. |
| `supabase/functions/_shared/licence-rules.ts` | Licence kinds, jurisdictions, the nurse licensure compact, "RN or LPN" lists, preferred licences (no ask), the licences bound to a state of practice, and the clearance-as-credential rule. |
| `supabase/functions/_shared/match-tiers.ts` | Gates, tiers, order, collapse and caps, and every sentence the list shows. |
| `supabase/functions/resume-match/index.ts`, `handler.ts`, `pipeline.ts` | The function: the door (who may call, with what, how often) and the pipeline. |
| `supabase/functions/resume-match/index_test.ts` | The Deno test: a canary résumé and canary profile values (an answer to a requirement line included) reach no log line, no write and no echo; the limiter order; the step-bound, one-use follow-up token; one automatic widening step; no statement after a missed candidates deadline, and requirements still read after a missed ring deadline; the overall budget; the notes. |
| `src/lib/match/**` | Pure modules a later page uses (request body, keyword overlap, re-tiering from facets, the "Not for me" chips, stable insertion, the session profile, the strip as data). No component imports them yet. |
| `scripts/match/build-geo-seed.mjs` | Turns the GeoNames files into the `geo_places` seed chunks. |
| `scripts/match-bench/**`, `src/test/fixtures/match-bench/**` | The offline bench: the 24 dev résumés, the 60 held-out résumés written blind, two frozen corpora, two judges (rm/bench's v2 rubric, which the gate uses, and rm/engine's port of the 2026-10-12 judge), the hand reviews, the baselines. `scripts/match-bench/README.md` says which does what. |
| `src/test/match-*.test.ts` | The regression gate (below). |
| `scripts/verify-deploy.d/97-resume-match.sh` | The live, read-only proof after deploy. |

## The pipeline

1. **Profile.** On the site the device reads the résumé, the reader confirms
   it on the strip ("We read you as ..."), and only the confirmed profile and
   up to three titles are sent. Résumé text sent from the site is refused
   (400 `resume_text_refused`). The mcp and v1 surfaces send résumé text, and
   only a caller holding the service-role key may (agent-mcp and public-api,
   in phase 2); the text is read in memory and dropped.
2. **Occupation.** The titles map to a family (`familyForTitles`). A résumé
   title the family's own not-list names maps to none (a court reporter is not
   a journalist); no family's not-list refuses one of its own query phrases (a
   test holds that). With no family, the reader's own words are the query:
   websearch syntax (a leading "-", a bare "or", quotes) is stripped, each
   phrase keeps at most six words and is always quoted, and the
   any-word-order step never runs on them.
3. **Place ring.** `metro_ring` answers the most populous places within the
   reader's radius (15, 40 or 80 km), each with its own region and its ASCII
   name, so Columbus, OH reaches Westerville and never Columbus, GA, and the
   ring searches both Montréal and Montreal. Until the GeoNames seed is
   applied `geo_places` is empty, the ring is the reader's own city, and the
   answer says so (`ringSource: "city-only"` and a note).
4. **One statement.** `match_candidates` runs one dynamic UNION ALL of lanes,
   each title-only with its own LIMIT 120:
   - **ring**: one constant location arm per place spelling, as `search_jobs`
     builds them, so the trigram index answers every arm. A row with no
     country is kept for the TypeScript check, which keeps it only when it
     names a ring place and that place's state.
   - **remote**: the countries the reader said they can work in. Not
     `work_mode` alone (null on 65% of rows): `work_mode = 'remote'`, or the
     board's remote flag, or the location saying remote. A "remote" row of an
     on-site occupation is kept only when its title or location says remote.
   - **region**: regions the reader said they would move to (an Australian
     reader's WA is Western Australia).
   - **country**: only when the reader would move anywhere in the country, and
     over the first three countries the reader can work in, the home country
     first.

   The builder refuses a query no index can answer: a negation alone
   (querytree 'T'), one of more than 64 nodes (the widest family query has
   47) and a query text over 400 characters build no statement. The base
   predicate is `search_jobs`' own (`effective_posted` inside the 30-day
   window, `missing_since IS NULL`); a pglite test holds the two to the same
   rows by behaviour. The mcp and v1 surfaces pass `excludeSources`
   (usajobs, smartrecruiters); `src/test/match-serving-parity.test.ts` holds
   that list equal to public-api's and agent-mcp's `NO_REDISTRIBUTION_SOURCES`,
   and the 30-day window equal to the board's and /v1's.
5. **Checks on each row** (TypeScript, null-tolerant): the place verdict, the
   title rank (core, near, not this occupation), level words, licence
   jurisdiction. Regions are read for the row's own country: "Pune, IN",
   "Munich, DE", "Toronto, CA" and a "DE1" postcode are not Indiana, Delaware or
   California. Place names are compared without accents or typed apostrophes,
   and never as a street ("801 S Milwaukee Ave" is not Milwaukee). Anywhere in
   the country takes a city named alone; a location naming only a country is
   "place not stated". A remote row naming a state other than the reader's
   says so ("Remote (lists North Carolina)") and carries the gap "remote within
   North Carolina". The remote lane checks a licence only where practice is
   bound to the state (nurse, therapist, pharmacist, teacher), counts a
   licence naming no state as covering, and ignores states after "excluding".
6. **Requirements.** The top 40 candidates' descriptions are read
   (`READ_TOP = 40`) and cached by posting in `job_posting_requirements` for 30
   days. At most 6 uncached posting-term walks or 40,000 description characters
   per call; the rest say `keywords pending`, and a cached row is fetched again
   only when this call will walk it.
7. **Gates.** A row is set aside, counted under its reason and shown on "Show
   anyway": outside the countries the reader said they can work in, beyond the
   commute area and where they would move, place not stated, a licence held in
   another state, a different occupation, the previous field, an internship
   (unless a student), a level above or below, and, only for rows whose
   description was read, "says it won't sponsor" (for a reader who needs
   sponsorship), "says citizenship required" (only for a reader who declared
   they are not a citizen of that country), "says citizens or permanent
   residents only" (only for a reader who declared a work or student visa), an
   active clearance (only for a reader known to hold none: a request that sent
   no clearance sets nothing aside, the row carries "asks for an active
   clearance" and the device re-gates it), or a licence not listed. Level
   words gate every family; where the level is the job (product manager,
   controller, staff engineer), only the family's own noun is left out, so
   Director, VP and Principal are still above a mid reader. Every count names
   its basis ("of the 40 postings we read").
8. **Tiers.** Strong: meets every stated requirement that could be read and
   compared. Good: one gap, or requirements not read. Stretch: a bigger gap, or
   two or more smaller ones. A stated requirement whose reader side is unknown
   (years not read, no degree on the résumé, a clearance never sent) is a
   smaller gap, never a silent pass. Never Strong without reading the
   requirements, and never Strong on a near title.
9. **Order, collapse and cap.** Within a tier: lane, freshness by the
   employer's own date (re-dating sources such as Ashby count as unknown),
   several openings, keyword overlap last, then the server's order. Sibling
   postings collapse into one row with an openings count; at most two rows per
   employer in the top 20.
10. **Widening.** At most one automatic step per request (any word order), and
    only when fewer than 20 rows pass, less than 1 s has gone by and the
    occupation is a family. Steps 2-6 (the head noun, the next rung, 80 km,
    elsewhere in the region, the previous field) are follow-up calls whose
    rows a page appends below. The next rung is not refused by the rung words
    it contains (Assistant Store Manager for a store manager). Step 5 places
    the reader's own region and says "elsewhere in Ohio" with the gap "found by
    a wider search". Each answer issues a `followUp` token for the one step it
    offers (`nextWiden`), bound to that search and that step for 30 minutes;
    its first use rides a separate 150 an hour per network, and a replay
    counts against the 30 like a new search.

## The function

**Request.** Site: `{"action":"match","profile":{...},"widen":0..6,"followUp":"..."}`.
Server surfaces: `{"action":"match","surface":"mcp"|"v1","resumeText":"...","overrides":{...}}`,
accepted only with the service-role key. Strings up to 120 characters, arrays
up to 20, `resumeText` 100 to 50,000 characters, a body up to 128 KB.

**Response.** `rows[]` (each with `tier`, `gaps`, `requirements` (`"read"` or
`"not read"`), `postingTerms` or `"pending"`, `placeLine`, and `facets`, which
carry what the posting asks, quoted, once), `setAside{reason: {count, basis,
label}}`, `setAsideRows`, `summary`, `searched` (what was searched: titles,
places, ring source, countries, lanes, order, excluded sources), `steps`,
`nextWiden`, `thin`, `notes`, `basis`, `phaseMs{anon, ring, candidates,
requirements, terms, total}`, `cpuMs`, `build`, `footer`, `followUp`. Nothing
about the reader beyond what was searched comes back.

**Budgets.** Every step's deadline is the smaller of its own and what is left
of 2.5 s from the request's start (the limiters included): `match_candidates`
1.2 s, the ring 400 ms, each read 700 ms. At most one automatic widening
statement. After a missed candidates, widening or requirements deadline no
further statement runs in that request (a race cannot cancel SQL); a missed
ring deadline falls back to the city alone and the request goes on. The
description read starts only while 800 ms are left, the description fetch
only while 400 ms are left, and the cache write runs after the answer
(`EdgeRuntime.waitUntil`), or not at all under 400 ms. `cpuMs` counts the final
sort and the row mapping too. resume-match never runs `computeFit`: in phase
2, agent-mcp and public-api keep calling job-fit's fit-batch on the ids it
returns.

**Limits and failures.** A limiter that cannot answer is a 503, never a pass.
The board's refusal is passed through as the board words it. Over the bucket:
429 `rate_limited`, `limit: 30`, `scope: "network"`, `Retry-After: 3600`. The
bucket is `resume_match_rate_take`: one `INSERT ... ON CONFLICT DO UPDATE
... RETURNING`, so a burst sent at once is counted call by call
(`check_rate_limit` read before it wrote, and a fresh-window burst all
passed).

**Logging.** One line per call with counts and timings. No profile value, no
résumé text, no address.

**Build stamp.** Every response, the preflight included, carries
`x-fn-build: resume-match.2026-10-16.1`.

**Switch.** `RESUME_MATCH_ORDER=recent` (a function secret, no code deploy)
orders each lane by the employer's date instead of title rank, the timing
gate's fallback.

## The regression gate

| test | holds |
|---|---|
| `match-profile.test.ts` | the profile reader on the dev résumés and its edge cases (German, Spanish and numeric dates; non-English section headings; a career changer with no stated years in the new field) |
| `match-families.test.ts` | families, not-lists, near lists in any order, the fallback's stripped and quoted words, each family's own phrases, the next rung |
| `match-requirements.test.ts` | the requirement reader, quotes cut to about 160 characters, minimums of 16+ unknown stored or re-read, clearance and citizenship wording, licence or-lists and preferred licences |
| `match-tiers.test.ts` | gates, tiers, the Good cap and label on unread requirements, unknown reader sides as gaps, level words where the level is the job, order, collapse |
| `match-place.test.ts` | place verdicts: null-country rows, state checks read for the row's country, the country lane, accents and streets, the remote lane's licence and residence |
| `match-candidates.test.ts` | the migrations in pglite from Supabase's default grants: the Columbus ring, parity with `search_jobs`, the lanes, both orders, the exclusions, the refusals and the three-country lane, the timing gate's explain, the atomic limiter, who may call, applying twice |
| `match-endpoint.test.ts` | the shipped function end to end on pglite: résumé text refused from the site, 30 an hour per network with follow-ups apart, a token used once and for its step, step 5, a limiter that cannot answer is a 503 |
| `match-serving-parity.test.ts` | excluded sources and the 30-day window equal to the board's and /v1's; no scorer call |
| `match-wording.test.ts` | no banned word in any sentence, with a positive control |
| `match-device.test.ts` | the device modules, the synced allow-list, the clearance on the default request |
| `match-bench-gate.test.ts` | **the accuracy gate**, never skipped: the engine offline over the 4,684-posting corpus, judged by the v2 rubric with every hand review, against `baselines/v1.json`: exact-11 P@10 within 5 points, top-20 location mismatch within 2 points, exact-11 seniority mismatch and wrong field within 3 points each, no résumé newly at zero, still beating BEFORE; the held-out reader within 5 points, authorisation precision not falling at all; no network call |
| `match-bench-before.test.ts`, `match-bench-rubric.test.ts`, `match-bench-fixtures.test.ts` | BEFORE replays to 14.5 / 10.0 / 85.5% under the legacy rubric (the positive control, which applies only the 2026-10-12 hand reviews); every v2 rule; the held-out set's coverage and blindness, nothing personal (example.com mail, reserved profile handles), corpus integrity |
| `match-bench.test.ts` | rm/engine's judge replays BEFORE to exactly 14.5 / 10.0; over all 24 dev résumés, sent the way the device sends them, no deadline is missed, an unread row is never Strong and there is one widening step at most. It holds no accuracy figure (one gate per metric). |
| `match-geo-seed.test.ts` | the seed builder's chunks apply twice and check their ring |
| `match-verify-section-97.test.ts` | section 97 can fail every claim it makes (a page of no rows, a missed deadline, the slowest candidates statement, a refused follow-up included), and sends no résumé |

The gate does not see everything: the frozen corpus holds descriptions for
few of the rows the engine shows (75 of 200 on the exact 11), no row that
exercises the remote lane of an on-site family, and no career changer's
previous field among the shown rows. The reviewer planted nine regressions on
2026-10-25 and the bench failed four; the unit tests failed for every one of
the other five. Those regressions are guarded by the unit tests, and
`gate.ts` says so.

## What was measured (2026-10-25)

### BEFORE and AFTER, like with like (the measurer, on rm/integration 7af55e52)

The measurer ran the engine on 7af55e52 against the dev set (the 24 synthetic
résumés; "exact 11" are the 11 whose BEFORE pool was complete) and the 60
held-out résumés written blind, read every top-20 row's description where the
board had one, and hand-reviewed the AFTER rows the way BEFORE was reviewed
(424 dev pairs; 69 automatic verdicts corrected: role 30, seniority 27,
location 10, licence 5, authorisation 4). P@k is the share of a reader's top k
a recruiter would shortlist (an empty slot is a miss). "Place or auth" is the
share of shown rows in a place the reader cannot reach or a country they
cannot work in.

**Dev set.** BEFORE is wave-3 main 65f7e5bc (2026-10-12), every exact-11 row's
description read.

| | BEFORE | AFTER, auto-judged | AFTER, hand-reviewed |
|---|---|---|---|
| exact-11 P@10 / P@20 | 14.5 / 10.0 (n=11, 220 rows) | 83.6 / 80.0 (200 rows, 160 with a description) | **74.5 / 73.2** (200 of 200 rows reviewed) |
| exact-11 place or auth | 85.0% (187 of 220) | 1.0% (2 of 200) | 3.0% (6 of 200) |
| exact-11 seniority mismatch (in-field rows) | 15.9% (35 of 220) | 7.6% (15 of 197) | 11.2% (22 of 196) |
| exact-11 wrong field | 0 of 220 | 1.5% (3 of 200) | 2.0% (4 of 200) |
| all-24 P@10 / P@20 | bounds [6.7, 17.1] / [4.6, 9.8] | 72.5 / 66.0 (364 rows) | **66.7 / 61.9** (246 of 364 reviewed) |
| all-24 place or auth | pool 90.4% | 0.5% (2 of 364) | 1.6% (6 of 364) |
| pages under 10 rows / at zero (of 24) | 0 / 0 | 6 / 3 | 6 / 3 |

The recorded gate baseline (85.5 / 81.8, auto-judged on the frozen corpus's
descriptions alone) overstated exact-11 precision by about 11 points against
the hand-reviewed 74.5 / 73.2, and the auto-judged figure is an upper bound,
not a floor. AFTER still beats BEFORE by a wide margin on the same 11 résumés.

**Held-out set** (60 résumés written blind; BEFORE is the live list call the
product made, 2026-10-25, judged without descriptions, so every BEFORE figure
is an upper bound on BEFORE).

| | BEFORE, server order top 20 | AFTER, the reader's own profile | AFTER, the confirmed profile |
|---|---|---|---|
| P@10 / P@20 | 1.8 / 2.1 (1,200 rows; any order could reach P@10 [0, 24]) | 18.8 / 13.5 (287 rows, 89 reviewed) | 34.7 / 27.6 (571 rows, 167 reviewed) |
| place or auth | 94.6% (1,135 of 1,200) | 1.0% (3 of 287) | 1.2% (7 of 571) |
| seniority mismatch | 11.7% (123 rows) | 27.0% (66 rows) | 22.2% (106 rows) |
| wrong field | 12.3% (147 rows) | 15.0% (43 rows) | 16.5% (94 rows) |
| pages under 10 rows / at zero (of 60) | 0 / 0 | 48 / 29 | 33 / 14 |
| auto-judged P@10 / P@20, seniority, wrong field | | 19.7 / 14.1, 24.8%, 15.7% | 35.7 / 28.5, 20.9%, 18.7% |

On the held-out set AFTER all but ends the place problem and lifts precision
from almost nothing, but shows few rows: the reader found no home city on 23
of 59 résumés, so no lane ran (7 résumés are newly at zero where BEFORE's top
20 held a hand-confirmed shortlistable row; with the profile confirmed only 1
is). Seniority and wrong field are worse than BEFORE's: career changers read
as mid or senior, entry readers shown rows asking 3+ years (years never gate,
by design), and families that took the wrong title (an assistant store manager
mapped to sales, a district manager to retail supervisor, the controller
family admitting "ITSM Process Controller"). The fixer's round addresses the
causes it names; the held-out run has not been repeated on it.

**Latency** (the measurer, local pglite, real clock): dev, wall p50 28 ms, p90
280 ms, max 423 ms, `cpuMs` p50 2 and p90 242; held-out, wall p50 34 ms, p90
182 ms, max 396 ms; no deadline missed. BEFORE's live list call: p50 1,075 ms,
p90 1,825 ms (n=38).

### The fixer's round on the gate (this branch)

The review of 7af55e52 confirmed 16 defects and 22 smaller ones; each fix has
a test that failed on that commit. To measure them like with like, the gate's
bench now applies the measurer's hand review: 462 of its 488 verdicts are
folded into `hand-review/overrides.json` (marked `"review":
"after-2026-10-25"`; the 25 that fell on BEFORE's own rows and one the
2026-10-12 review already held are left out, and the legacy rubric applies
only the 2026-10-12 reviews), so BEFORE replays to 14.5 / 10.0 / 85.5%
unchanged. One manifest rule was fixed: the Atlanta retail supervisor's
"too senior" pattern matched "store manager" inside the "Assistant Store
Manager" its own target names. Both engines, the same bench, the same
judgements (v2 rubric, every hand review, the frozen corpus's descriptions
only):

| | 7af55e52 | this branch |
|---|---|---|
| exact-11 P@10 / P@20 | 77.3 / 75.5 | 77.3 / 76.8 |
| exact-11 place or auth | 2.5% (5 of 200) | 1.0% (2 of 200) |
| exact-11 seniority mismatch | 11.2% (22 of 196) | 11.2% (22 of 197) |
| all-24 P@10 / P@20 | 67.9 / 63.1 (364 rows) | 68.8 / 65.4 (373 rows) |
| all-24 place or auth | 1.4% (5 of 364) | 0.5% (2 of 373) |
| all-24 seniority mismatch | 12.5% (45 of 359) | 12.5% (46 of 369) |
| held-out reader: entry recall | 59.1% (13 of 22) | 68.2% (15 of 22), 0 false positives |

The 7af55e52 run was measured before the manifest fix, which touches only
rows 7af55e52 did not show. `baselines/v1.json` is re-recorded from this
branch (exact-11 166 of 200 rows hand-reviewed, 75 with a description) with
the new seniority and wrong-field tolerances, and `baselines/before.json`'s
prototype v2 column is re-recorded because v2 now applies the later review to
the prototype's rows too (exact-11 77.3 / 79.1, was 85.5 / 84.5 auto-judged).
These are dev-set figures the engine was tuned on; the held-out AFTER run and
its hand review are the verdict, and they have not been repeated on this
branch.

**CPU and wall, this branch** (`scripts/match-bench/run.ts --cpu`: 24 dev
résumés, the real clock, local pglite, load average 16 to 30 on this Mac):
`cpuMs` p50 6 ms, p90 346 ms, max 389 ms; wall p50 31 ms, p90 385 ms, max 507
ms; no deadline missed. CPU follows the descriptions read (the two slowest
calls read 7 and 10). These are local figures: the edge is several times this
Mac for the term walk, and verify 97 is the gate on the edge (wall p50 ≤2.5 s,
p90 ≤4 s over ten profiles, `cpuMs` max ≤2 s, the slowest candidates
statement ≤1.2 s).

**`match_candidates` in pglite: correctness only.** Its live speed is the
timing gate's and verify 97's job.

## The timing gate (spec 6.5), before phase 1 wires anything

Run in the deploy session, which has SQL access, after the migrations apply.
`match_candidates_explain` takes the same arguments as `match_candidates` and
answers `EXPLAIN (ANALYZE, BUFFERS)` of exactly the statement it would run (an
EXPLAIN of the outer call would show only a function scan).

1. Record `SELECT rolconfig FROM pg_roles WHERE rolname = 'service_role';`
   (the statement timeout that bounds a call; a statement a race abandons runs
   until it).
2. For 10 bench profiles, 3 runs each, per lane and for the union, with both
   orders, read the plan. One lane at a time:

   ```sql
   -- ring
   SELECT * FROM public.match_candidates_explain(
     '"registered nurse" OR "staff nurse"', NULL, now() - interval '30 days', ARRAY['US'],
     ARRAY['Chicago', 'Evanston', 'Oak Park', 'Cicero', 'Skokie'], false, ARRAY[]::text[], false,
     NULL, 120, 'rank', ARRAY['US']);
   -- remote: p_ring empty, p_remote true; region: p_regions ARRAY['Illinois', ', IL'];
   -- country: p_country_lane true; the union: all of them; then each again with 'recent'.
   ```

3. **The adversarial shapes**, the ones the bench profiles never send:
   - a negation alone, `'-zzz'`: must answer `no lane to run`;
   - the widest family query (rn_icu's eight phrases, 47 nodes) on the ring,
     remote and country lanes at once;
   - a fallback reader's words as resume-match now sends them, one quoted
     phrase of six words (`'"worker staff team crew clerk aide"'`);
   - a head noun alone (`'manager'`, widening step 2) on the remote lane over
     20 countries and the country lane (held to three).
4. Pass needs every place arm on `job_board_postings_location_trgm_idx`, the
   title arm on `title_tsv` or `title_simple_fts` GIN, no Seq Scan on
   `job_board_postings`, and a union p90 of 700 ms or less, the adversarial
   shapes included.
5. If a 20-place ring fails, cut `RING_MAX_PLACES` to 12 (a code deploy). If
   the remote lane fails on rank ordering, set `RESUME_MATCH_ORDER=recent`.
6. Record the plans and timings here.

Not run yet: phase 0 has not deployed.

## Not done in phase 0

- **The GeoNames seed rows.** `scripts/match/build-geo-seed.mjs` writes them
  from `cities5000.txt` and `admin1CodesASCII.txt` (CC BY 4.0), stamped
  20261016101100 onward, after `metro_ring`, so the last chunk checks the
  Columbus, OH ring and RAISEs if it lacks Westerville or reaches Georgia.
  Downloading the files is an owner step; until then the ring is the reader's
  own city.
- **The held-out AFTER run on this branch.** The measurer's held-out run
  (above) is on 7af55e52. Repeating it with its own probe budget and hand
  review on the fixed engine, and the two-rater agreement check, are owed
  (`scripts/match-bench/README.md`, "The AFTER benchmark"). No claim that v1
  beats BEFORE on the held-out set rests on the dev-set figures.
- **The reader's home city.** It finds none on about a third of the held-out
  résumés (city 61%, country 63%), and a page with no home city searches no
  commute area (the answer now says so). That, not the matching, is the main
  cause of empty held-out pages, and the main gap before phase 1.
- **Residuals the measurer saw that this round does not close:** state teaching
  certificate wording in a description ("MUST hold a New Jersey ... CE, CEAS or
  Standard Certificate") read as no licence; clearance titles with no
  description ("active top secret clearance required" in the title) reach the
  page; unmapped titles ("Retail and Customer Assistant", "Marketing
  Graduate", "Schichtleiter Logistik", a head of maths written as "teacher")
  and résumés whose roles the reader leaves empty; a residence rule written
  only in a description ("must reside in or around Edmonton"); EU-wide remote
  rows that name other countries. The held-out manifest's Melbourne returner
  (ho-rt-gap-melbourne) carries the same "store manager inside Assistant Store
  Manager" pattern the dev one did; the held-out set is blind and was left as
  written.
- **Family mining** to about 300 occupations from the board's titles.
- **The parse-pdf and parse-docx logging fix.** Wave 4's second round owns
  those files (S12 routing sends parse-pdf and parse-docx items to job-board),
  so this phase did not touch them. Upload privacy copy waits for that fix.
- **A blocked-network check in verify 97** (spec 97h). The verifier cannot
  call from a blocked network. The Deno test pins that the board's meter runs
  before any work and that its refusal is passed through, and the pglite
  endpoint test runs it against a blocked bucket.
- Phases 1-4: the LiveMatches switch (after wave 4 merges and the timing gate
  passes), mcp and /v1 delegation, the For-you fold, the synced profile and
  alerts, outcome check-ins.
