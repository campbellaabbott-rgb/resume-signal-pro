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
  `src/lib/match/session.ts` keeps it in sessionStorage, and its synced shape has
  no work-authorisation field.
- **A posting whose requirements were not read is capped at Good** and labelled
  `requirements not read`.
- **The anonymous site path:** job-board's own meter first
  (`job_board_anon_check`: the same blocked networks and countries, one read of
  the address's board day), then 30 calls an hour per network bucket
  (`_shared/network-bucket.ts`: a keyed hash of the caller's /24 or /48, so a
  campus or carrier NAT shares it). Requirement quotes are cut to about 160
  characters.
- **Wording.** Nothing implies a chance of being hired: "jobs you could apply
  for", never "jobs you can take", never "verified". `BANNED_MATCH_WORDS` in
  `_shared/match-tiers.ts` holds the list, and `src/test/match-wording.test.ts`
  scans every sentence the engine and the device modules can show.

## Files

| file | what it does |
|---|---|
| `supabase/functions/_shared/resume-profile.ts` | Reads the facts a recruiter reads off the top of a résumé (home, where they would move, the countries they say they can work in, target titles, level, the years their dates show, licences, explicit authorisation lines), each with the line it came from. Authorisation is never inferred. Runs in the browser (dynamic import) and, for mcp/v1 only, on the server. |
| `supabase/functions/_shared/title-families.ts` | 109 occupation families: core and near title patterns, a not-list, a head noun, the next rung, whether the job is on site, whether it is licensed. Version 1 is the prototype's 22 families plus common occupations written the same way; the spec's target of about 300, mined from the board's titles, is not done (it needs the title census). An occupation with no family falls back to the reader's own titles with a generic not-list, and the answer says `family: null`. |
| `supabase/functions/_shared/posting-requirements.ts` | Reads what a posting asks for, quoted from the posting: required and preferred lines, the stated minimum years, a licence and where it must be held, sponsorship, citizenship, an active clearance, degree. A stored `min_years` of 16 or more is treated as unknown (stale values the current parser no longer produces); when the description is read, the value read from the text wins. |
| `supabase/functions/_shared/licence-rules.ts` | Licence kinds, jurisdictions, the nurse licensure compact and the clearance-as-credential rule. |
| `supabase/functions/_shared/match-tiers.ts` | Gates, tiers, order, collapse and caps, and every sentence the list shows. |
| `supabase/functions/resume-match/index.ts`, `handler.ts`, `pipeline.ts` | The function: the door (who may call, with what, how often) and the pipeline. |
| `supabase/functions/resume-match/index_test.ts` | The Deno test: a canary résumé and canary profile values reach no log line, no write and no echo; the limiter order; the follow-up token; one automatic widening step; no statement after a missed deadline. |
| `src/lib/match/**` | Pure modules a later page uses (request body, keyword overlap, re-tiering from facets, the "Not for me" chips, stable insertion, the session profile, the strip as data). No component imports them yet. |
| `scripts/match/build-geo-seed.mjs` | Turns the GeoNames files into the `geo_places` seed chunks. |
| `scripts/match-bench/**`, `src/test/fixtures/match-bench/**` | The offline bench: the 24 dev résumés, the 60 held-out résumés written blind, two frozen corpora, two judges (rm/bench's v2 rubric, which the gate uses, and rm/engine's port of the 2026-10-12 judge), the baselines. `scripts/match-bench/README.md` says which does what. |
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
   a journalist).
3. **Place ring.** `metro_ring` answers the most populous places within the
   reader's radius (15, 40 or 80 km), each with its own region, so Columbus,
   OH reaches Westerville and never Columbus, GA. Until the GeoNames seed is
   applied `geo_places` is empty, the ring is the reader's own city, and the
   answer says so (`ringSource: "city-only"` and a note).
4. **One statement.** `match_candidates` runs one dynamic UNION ALL of lanes,
   each title-only with its own LIMIT 120:
   - **ring**: one constant location arm per place, as `search_jobs` builds
     them, so the trigram index answers every arm. A row with no country is
     kept for the TypeScript check, which keeps it only when it names a ring
     place and that place's state.
   - **remote**: the countries the reader said they can work in. Not
     `work_mode` alone (null on 65% of rows): `work_mode = 'remote'`, or the
     board's remote flag, or the location saying remote. A "remote" row of an
     on-site occupation is kept only when its title or location says remote.
   - **region**: regions the reader said they would move to.
   - **country**: only when the reader would move anywhere in the country.

   The base predicate is `search_jobs`' own (`effective_posted` inside the
   30-day window, `missing_since IS NULL`); a pglite test holds the two to the
   same rows by behaviour. The mcp and v1 surfaces pass `excludeSources`
   (usajobs, smartrecruiters); `src/test/match-serving-parity.test.ts` holds
   that list equal to public-api's and agent-mcp's `NO_REDISTRIBUTION_SOURCES`,
   and the 30-day window equal to the board's and /v1's.
5. **Checks on each row** (TypeScript, null-tolerant): the place verdict, the
   title rank (core, near, not this occupation), level words, licence
   jurisdiction.
6. **Requirements.** The top 40 candidates' descriptions are read
   (`READ_TOP = 40`) and cached by posting in `job_posting_requirements` for 30
   days. At most 6 uncached posting-term walks or 40,000 description characters
   per call; the rest say `keywords pending`.
7. **Gates.** A row is set aside, counted under its reason and shown on "Show
   anyway": outside the countries the reader said they can work in, beyond the
   commute area and where they would move, place not stated, a licence held in
   another state, a different occupation, the previous field, an internship
   (unless a student), a level above or below, and, only for rows whose
   description was read, "says it won't sponsor" (for a reader who needs
   sponsorship), "says citizenship required" (only for a reader who declared
   they are not a citizen of that country), an active clearance, or a licence
   not listed. Every count names its basis ("of the 40 postings we read").
8. **Tiers.** Strong: meets every stated requirement that could be read. Good:
   one gap, or requirements not read. Stretch: a bigger gap, or two or more
   smaller ones. Never Strong without reading the requirements, and never
   Strong on a near title.
9. **Order, collapse and cap.** Within a tier: lane, freshness by the
   employer's own date (re-dating sources such as Ashby count as unknown),
   several openings, keyword overlap last, then the server's order. Sibling
   postings collapse into one row with an openings count; at most two rows per
   employer in the top 20.
10. **Widening.** At most one automatic step per request (any word order), and
    only when fewer than 20 rows pass and less than 1 s has gone by. Steps 2-6
    (the head noun, the next rung, 80 km, elsewhere in the region, the previous
    field) are follow-up calls whose rows a page appends below. A follow-up
    carrying the first answer's `followUp` token (bound to that search, 30
    minutes) is not counted against the 30 an hour; it spends a separate 150
    an hour per network.

## The function

**Request.** Site: `{"action":"match","profile":{...},"widen":0..6,"followUp":"..."}`.
Server surfaces: `{"action":"match","surface":"mcp"|"v1","resumeText":"...","overrides":{...}}`,
accepted only with the service-role key. Strings up to 120 characters, arrays
up to 20, `resumeText` 100 to 50,000 characters, a body up to 128 KB.

**Response.** `rows[]` (each with `tier`, `gaps`, `requirements` or
`"not read"`, `postingTerms` or `"pending"`, `placeLine`, `facets`),
`setAside{reason: {count, basis, label}}`, `setAsideRows`, `summary`,
`searched` (what was searched: titles, places, ring source, countries, lanes,
order, excluded sources), `steps`, `nextWiden`, `thin`, `notes`, `basis`,
`phaseMs{anon, ring, candidates, requirements, terms, total}`, `cpuMs`,
`build`, `footer`, `followUp`. Nothing about the reader beyond what was
searched comes back.

**Budgets.** Overall deadline 2.5 s; `match_candidates` 1.2 s; at most one
automatic widening statement; after any missed deadline no further statement
in that request (a race cannot cancel SQL). resume-match never runs
`computeFit`: in phase 2, agent-mcp and public-api keep calling job-fit's
fit-batch on the ids it returns.

**Limits and failures.** A limiter that cannot answer is a 503, never a pass.
The board's refusal is passed through as the board words it. Over the bucket:
429 `rate_limited`, `limit: 30`, `scope: "network"`, `Retry-After: 3600`.

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
| `match-profile.test.ts` | the profile reader on the dev résumés and its edge cases (German, Spanish and numeric dates; non-English section headings) |
| `match-families.test.ts` | families, not-lists, near lists in any order |
| `match-requirements.test.ts` | the requirement reader, quotes cut to about 160 characters, stored minimums of 16+ unknown |
| `match-tiers.test.ts` | gates, tiers, the Good cap on unread requirements, order, collapse |
| `match-place.test.ts` | place verdicts: null-country rows, state checks, the country lane |
| `match-candidates.test.ts` | the migrations in pglite from Supabase's default grants: the Columbus ring, parity with `search_jobs`, the lanes, both orders, the exclusions, the timing gate's explain, who may call, applying twice |
| `match-endpoint.test.ts` | the shipped function end to end on pglite: résumé text refused from the site, 30 an hour per network with follow-ups apart, a limiter that cannot answer is a 503 |
| `match-serving-parity.test.ts` | excluded sources and the 30-day window equal to the board's and /v1's; no scorer call |
| `match-wording.test.ts` | no banned word in any sentence, with a positive control |
| `match-device.test.ts` | the device modules |
| `match-bench-gate.test.ts` | **the accuracy gate**, never skipped: the engine offline over the 4,684-posting corpus, judged by the v2 rubric, against `baselines/v1.json`: exact-11 P@10 within 5 points, top-20 location mismatch within 2 points, no résumé newly at zero, still beating BEFORE; the held-out reader within 5 points, authorisation precision not falling at all; no network call |
| `match-bench-before.test.ts`, `match-bench-rubric.test.ts`, `match-bench-fixtures.test.ts` | BEFORE replays to 14.5 / 10.0 / 85.5% under the legacy rubric (the positive control); every v2 rule; the held-out set's coverage and blindness, nothing personal, corpus integrity |
| `match-bench.test.ts` | rm/engine's judge replays BEFORE to exactly 14.5 / 10.0; over all 24 dev résumés, sent the way the device sends them, no deadline is missed, an unread row is never Strong and there is one widening step at most. It holds no accuracy figure (one gate per metric). |
| `match-geo-seed.test.ts` | the seed builder's chunks apply twice and check their ring |
| `match-verify-section-97.test.ts` | section 97 can fail every claim it makes, and sends no résumé |

## What was measured locally (2026-10-24)

All offline: pglite with the shipped migrations, the frozen corpus of 2,731
postings (492 with a description) the BEFORE bench read on 2026-10-12, the 24
synthetic dev résumés. `npx tsx scripts/match-bench/run.ts --cpu`.

**Accuracy (dev set, auto-judged, licence rule on).** v1 exact-11 P@10 87.3,
P@20 85.9; all-24 P@10 73.3, P@20 69.0; 0 of 361 shown rows in a place the
reader cannot reach; seniority mismatch 7.1% (27 of 358); 7 of 24 résumés
under 20 rows and 3 at zero. BEFORE on the same judge: exact-11 P@10 14.5,
P@20 10.0, location mismatch 85.5%. This is a floor, not a verdict: the
AFTER probe budget and the same hand review BEFORE had are still owed (spec
19.2). The bench seeds `geo_places` with the prototype's hand-written rings
until the GeoNames seed lands.

**The gate's figures** (`match-bench-gate.test.ts`, `scripts/match-bench/report.ts`;
rm/bench's 4,684-posting corpus with 618 descriptions and its v2 rubric, which
fails a licence held in another state unless the posting says it may follow
hire and reads UK and German sponsorship refusals). Re-measured on
rm/integration on 2026-10-25, the same as rm/engine d549462d: exact-11 P@10
85.5, P@20 81.8, top-20 location mismatch 1.0% (2 of 200), seniority 7.6% (15
of 197), licence fails 0; all-24 P@10 73.3, P@20 67.1, location 0.5% (2 of
364), 6 résumés under 10 rows and 3 at zero. BEFORE under the same rubric:
exact-11 14.5 / 10.0, location 85.0% (187 of 220). The two benches differ
because their corpora and rubrics differ; only this one gates.

**The profile reader on the 60 held-out résumés** (written blind by the bench's
author, aggregates only, spec 5 targets): country 63.3% (38 of 60, target 95%),
city 61% (36 of 59, target 90%), authorisation precision 97.1% (33 of 34,
target 100%), years within 3 86.7% (52 of 60, target 85%, met), entry recall
59.1% (13 of 22, target 90%) with 0 false positives, sponsorship need 3 of 4.
On the dev set the reader reads every home; on the blind set it misses about a
third. That is the reader's main gap before phase 1.

**CPU per call** (the function's own `cpuMs`, this Mac under a load average of
about 7): p50 4 ms, p90 293 ms, max 380 ms on the first pass; p50 4, p90 256,
max 324 on the second. Wall time in pglite: p50 28 ms, p90 379 ms, max 411 ms.
Re-run on rm/integration on 2026-10-25 at a load average of about 2.9: p50 2
ms, p90 164 ms, max 165 ms; wall p50 12 ms, p90 174 ms, max 196 ms.
CPU follows the number of descriptions read: calls that read none cost 0-8 ms,
calls that read 7-36 cost 151-380 ms. The frozen corpus holds few
descriptions (300 of 361 shown rows were unread), so production calls will
read more. The spec's record puts the edge at several times this Mac for the
term walk, so a call that reads 30 or more descriptions may approach the
1.2 s p99 budget at the edge: verify 97 prints cpuMs p50, p90 and max over ten
live calls and fails over the 2 s cap.

**`match_candidates` in pglite: correctness only.** Its live speed is the
timing gate's and verify 97's job.

## The timing gate (spec 6.5), before phase 1 wires anything

Run in the deploy session, which has SQL access, after the migrations apply.
`match_candidates_explain` takes the same arguments as `match_candidates` and
answers `EXPLAIN (ANALYZE, BUFFERS)` of exactly the statement it would run (an
EXPLAIN of the outer call would show only a function scan).

1. Record `SELECT rolconfig FROM pg_roles WHERE rolname = 'service_role';`
   (the statement timeout that bounds a call).
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

3. Pass needs every place arm on `job_board_postings_location_trgm_idx`, the
   title arm on `title_tsv` or `title_simple_fts` GIN, no Seq Scan on
   `job_board_postings`, and a union p90 of 700 ms or less.
4. If a 20-place ring fails, cut `RING_MAX_PLACES` to 12 (a code deploy). If
   the remote lane fails on rank ordering, set `RESUME_MATCH_ORDER=recent`.
5. Record the plans and timings here.

Not run yet: phase 0 has not deployed.

## Not done in phase 0

- **The GeoNames seed rows.** `scripts/match/build-geo-seed.mjs` writes them
  from `cities5000.txt` and `admin1CodesASCII.txt` (CC BY 4.0), stamped
  20261016101100 onward, after `metro_ring`, so the last chunk checks the
  Columbus, OH ring and RAISEs if it lacks Westerville or reaches Georgia.
  Downloading the files is an owner step; until then the ring is the reader's
  own city.
- **The held-out AFTER run** (spec 19.2). The 60 held-out résumés exist,
  written blind, and the gate scores the profile reader on them. What is owed:
  calling the deployed resume-match once per held-out profile with its own
  probe budget, BEFORE on the held-out set, the same hand review for both, and
  the two-rater agreement check. The steps are in
  `scripts/match-bench/README.md`, "The AFTER benchmark". No claim that v1
  beats BEFORE rests on the dev-set figures.
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
