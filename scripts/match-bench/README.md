# Résumé-matching bench

The bench measures what résumé matching shows a job seeker, judged by a written
recruiter rubric, so BEFORE (today's "For you" path) and AFTER (the résumé
matcher, spec `reports/resume-matching-2026-10-12.md` §19) can be compared on
the same résumés with the same rubric. It is also a CI gate:
`src/test/match-bench-gate.test.ts`.

Every person in the fixtures is invented: example.com addresses and fictional
phone ranges. Résumé text never leaves the machine. Parsing, role terms, fit
scoring and the matcher all run locally from the product's own modules. The
only network calls any script can make are job-board `list` and `detail`,
read-only, with the anon key and `x-rb-budget: probe`, from a named,
budgeted ledger (`live.ts`). The CI gate makes none.

## Fixtures (`src/test/fixtures/match-bench/`)

| path | what |
|---|---|
| `dev/*.txt`, `dev/manifest.ts` | The 24 dev résumés BEFORE measured, with their ground truth. Ported unchanged from the 2026-10-12 bench. The prototypes and the engine were tuned on these. |
| `dev/parsed/*.pdf.txt` | Each résumé rendered to PDF and read back through parse-pdf's own core. This is the text the BEFORE run used and the input every pipeline reads. |
| `heldout/*.txt`, `heldout/manifest.ts`, `heldout/parsed/` | **60 held-out résumés, written blind.** See below. |
| `postings.json.gz` | The frozen corpus (1.35 MB). It holds all 4,684 postings the BEFORE run and the two prototypes saw through job-board's read-only calls, plus the 618 descriptions any of them read. Descriptions are cut at 20,000 characters, and emails, phones and profile links are replaced. It contains no apply URLs and nothing about any person. |
| `before/ranked.json` | The BEFORE measurement, frozen. For each résumé: its query, its 60-row pool in fit order, and each row's metadata as the judge saw it. |
| `baselines/proto-top20.json` | The Requirements-First prototype's shown rows (extractor profile and confirmed "oracle" profile). |
| `baselines/before.json` | BEFORE and the prototype, under both rubrics (`report.ts --save-before`). |
| `baselines/v1.json` | The AFTER baseline the CI gate holds (`report.ts --save-after`). |
| `hand-review/overrides.json`, `hand-review/posting-facts.json` | The hand review: 14 pair corrections and 121 posting facts. They apply to every rubric and every pipeline. |
| `rubric.ts` | The rubric (below). |
| `metrics.ts`, `gate.ts`, `reader-score.ts` | The numbers, the gate's rule and its tolerance, and the held-out reader score. |
| `after-pipeline.ts`, `metro-rings.ts`, `corpus.ts`, `scrub.ts` | The offline AFTER run (below), the commute rings it answers `metro_ring` from, the corpus loader, and the contact-detail scrubber. |

### The held-out set was written blind

On 2026-10-12, the 60 held-out résumés and `heldout/manifest.ts` were written
before their author read any of the following:
- `_shared/title-families.ts`;
- the engine's gate or tier rules;
- the prototype's families, profile or match code.

They were also written before any job was retrieved for them. The author had
read only the spec's prose (§5-§9).

The set covers:
- 15 occupations × 4;
- US 24, CA 9, GB 9, DE 6, AU 6, IN 6;
- entry, mid and senior levels;
- 10 career changers, 6 gaps or returners, 14 new grads;
- 6 non-English date formats (de, fr, es);
- 6 two-column layouts;
- 6 headers with no location or authorisation line;
- 4 people needing sponsorship, 4 licensed in another state.

In the two-column résumés, each line is written as `LEFT || RIGHT`.
`01-parse.ts` lays these out as a sidebar and a main column on the same
baseline, and the parser's multi-column check flags all 6.

Two résumés carry a character outside jsPDF's
WinAnsi Helvetica (the ł in Wrocław, the ı in Yılmaz). Those lines come back letter-spaced, as they would from a
tool that does not embed fonts. That is kept as a hazard.

**Do not tune the engine on the held-out set.** The CI gate prints only its
aggregates. `report.ts --verbose` lists the misses for the bench owner.

## The rubric (`rubric.ts`)

"Would a recruiter shortlist this candidate for this job?" The answer is yes
only when all of these hold:
- role is target or adjacent;
- seniority fits;
- the candidate can take it from where they are or will move to;
- they may work in that country;
- they hold every licence and credential it requires.

An unknown location counts in the candidate's favour.

There are two rubrics, and the v2 rubric is the one every comparison uses from
now on:
- `legacy` is the 2026-10-12 rubric byte for byte. It hard-coded `licence = "ok"`
  and read authorisation wording only from the descriptions the BEFORE run held.
  It is kept so the positive control replays BEFORE to the decimal.
- `v2` is the legacy rubric with three holes closed:
  1. **Licences are checked.** A posting fails if it requires a licence family
     the candidate lacks, or names a jurisdiction their licence does not cover.
     It still passes when it says the licence may follow hire ("or eligible",
     "within 90 days", "upon hire"). A multistate RN licence covers the compact
     states. A national register (NMC, AHPRA) covers its country. Electrician
     grades and CDL classes are read. A licensed title with no description is
     checked for the licence family.
  2. **A clearance is a credential.** "Active / current / required" fails anyone
     without one, citizen or not. "Able to obtain" fails only a non-citizen, and
     only for clearances that need citizenship.
  3. **Authorisation wording is read wherever a description exists**, for every
     pipeline's rows. That includes UK and German refusals, "U.S." with its dots,
     and "citizens or permanent residents". Every verdict records whether a
     description was read.

The rubric never imports the engine, so the matcher is never graded by its own
rules.

## The numbers, like with like (`metrics.ts`)

- P@10 and P@20 count an empty slot as a miss.
- Location mismatch means "cannot take it": wrong place, or no right to work in
  that country.
- Seniority is counted over in-field rows.

BEFORE's exact set is the 11 résumés whose pools had every description read.
AFTER is always reported on those same 11 ids, and separately on all 24. Each
rate is given with its denominator. BEFORE's all-24 figure is a [low, high]
bound.

BEFORE and the prototype were recorded on 2026-10-12. The AFTER column was
first recorded on 2026-10-24 from `rm/engine` d549462d, offline, then on
2026-10-25 on `rm/integration` (rm/engine f5c2d151 merged with rm/bench
1b275429; every figure the same), and RE-RECORDED on 2026-10-25 after the
fixer's round, with the AFTER hand review folded in.

THE HAND REVIEW IS NOW TWO ROUNDS. `hand-review/overrides.json` holds the 14
pair reviews of 2026-10-12 and 462 of the measurer's AFTER review of
2026-10-25 (each marked `"review": "after-2026-10-25"`; the 25 of its verdicts
that fell on BEFORE's own rows, and one the first round already held, were
left out). The legacy rubric, the 2026-10-12 judge as it ran, applies only the
first round, so BEFORE and the prototype replay their as-run figures; the v2
rubric applies both rounds to every column alike. One dev manifest rule was
fixed in the same round: the Atlanta retail supervisor's "too senior" pattern
matched "store manager" inside "Assistant Store Manager", a title its own
target names.

| metric | BEFORE legacy (as run) | BEFORE v2 | proto v2 | AFTER v2 extract |
|---|---|---|---|---|
| P@10 / P@20, exact 11 | 14.5 / 10.0 | 14.5 / 10.0 | 77.3 / 79.1 | 77.3 / 76.8 |
| P@10 / P@20, all 24 | [6.7, 17.1] / [4.6, 9.8] | same | 68.8 / 66.0 | 68.8 / 65.4 |
| location mismatch, exact-11 top 20 | 85.5% (188/220) | 85.0% (187/220) | 3.5% (7/200) | 1.0% (2/200) |
| location mismatch, all-24 top 20 | pool 90.6% | pool 90.4% | 1.9% (7/364) | 0.5% (2/373) |
| seniority mismatch, exact 11 | 15.9% (35/220) | 15.9% (35/220) | 7.1% (14/196) | 11.2% (22/197) |
| licence fails shown, exact 11 | 0 (never checked) | 14 | 0 | 2 |
| rows with a description read, exact 11 | 220/220 | 220/220 | 67/200 | 75/200 |
| rows with a hand review, exact 11 | 10/220 | 10/220 | 108/200 | 166/200 |
| résumés under 10 rows / at zero, all 24 | - | - | 7 / 3 | 6 / 3 |

Before the second round the AFTER column read exact-11 85.5 / 81.8, auto-judged:
the hand review takes about 8 points off on this corpus, and about 11 once
every row's description is read too (`docs/resume-match.md`, "What was
measured").

**Caveats, which hold until the AFTER benchmark is repeated on the fixed
engine with its own budget and hand review (owner decision 8):**
- The prototype and AFTER columns are on the dev set they were tuned on. AFTER's
  reviewed rows are pairs one of the two rounds covered; 34 of its exact-11
  rows have no review.
- The offline AFTER run is a closed world. It finds only postings an earlier run
  retrieved, and reads requirements only where one of them read a description.
- `metro_ring` is answered from the prototype's hand-written rings (`metro-rings.ts`),
  not GeoNames.

### Held-out profile reader (the same engine, aggregates only)

| target (spec §5) | measured | basis |
|---|---|---|
| country ≥95% | 63.3% | 38/60 |
| city ≥90% | 61% | 36/59 |
| authorisation precision 100% | 97.1% | 33/34 declared statuses read right |
| years within 3 ≥85% | 86.7% | 52/60 |
| entry-level recall ≥90%, ≤1 false positive | 68.2%, 0 | 15/22 (59.1%, 13/22 before a career changer with no stated years in the new field was read as entry) |
| sponsorship need (no target) | 75% | 3/4 |

On the dev set, the reader reads every home. On the blind set it misses about a
third of them, and on this set it meets one of the spec's targets (years).

## The CI gate (`src/test/match-bench-gate.test.ts`)

The gate runs the engine's own code offline:
- `readProfile` on each dev résumé's parsed text;
- `runMatch` with `match_candidates` executed **from the migration's real
  plpgsql in pglite**, over the corpus loaded into a `job_board_postings` table
  whose generated columns are copied from production's migrations;
- `metro_ring` answered from `metro-rings.ts`;
- descriptions answered from the corpus.

It fails when any of these happens:
- exact-11 P@10 falls more than **5 points** below `baselines/v1.json`;
- top-20 location mismatch, exact 11 or all 24, rises more than **2 points**
  above it;
- exact-11 seniority mismatch or wrong field rises more than **3 points** above
  it (added 2026-10-25: five of nine regressions the reviewer planted passed
  the gate; the ones no figure here can see, on rows the frozen corpus does not
  hold, are left to the unit tests, as `gate.ts` says);
- a résumé shows zero rows that did not before;
- AFTER stops beating BEFORE (v2) on the same 11;
- the held-out reader falls more than **5 points** on country, city, years or
  entry recall;
- the held-out reader's authorisation precision falls at all.

The run is deterministic and makes no network call: `fetch` throws throughout
the measurement. It takes about 4 to 6 s with `--maxWorkers=2` (3.6 s measured
on 2026-10-24 against rm/engine d549462d; 3.2 s on rm/integration on
2026-10-25).

The gate **never skips**. The engine and the bench were merged together on
rm/integration, so a branch without spec §18's modules, or with only some of
them, fails, naming what is missing. To try another checkout's engine (it must
be whole too):

```
MATCH_ENGINE_ROOT=/path/to/checkout npx vitest run --maxWorkers=2 src/test/match-bench-gate.test.ts
```

When the engine improves, or changes on purpose, re-record the baseline and say
what was measured:

```
./node_modules/.bin/tsx scripts/match-bench/report.ts --save-after --ref "<branch> <sha>"
```

### Two benches, one gate (merged on rm/integration, 2026-10-25)

rm/engine's last commit (d549462d, seven minutes after this bench was
committed) added its own bench under the same folder. It has a 2,731-posting
corpus with 492 descriptions (`corpus.json.gz`), `baseline.v1.json`,
`bench.ts`, `judge.ts`, `rings.ts`, `scripts/match-bench/run.ts` and
`src/test/match-bench.test.ts`. Its own unit tests also read `db.ts`,
`endpoint.ts` and `manifest.ts` there.

When the two were merged on rm/integration:
- **`match-bench-gate.test.ts` is the one accuracy gate.** It holds exact-11
  P@10, top-20 location mismatch, résumés at zero and the held-out reader, and
  it never skips.
- **`match-bench.test.ts` no longer holds any accuracy figure.** It keeps
  rm/engine's positive control for its judge (BEFORE replays to 14.5 / 10.0)
  and the engine's promises over all 24 dev résumés, run the way the device
  calls it (`src/lib/match/request.ts`, then the handler's `siteInput`): no
  deadline missed, an unread row never Strong, one widening step at most.
- **`run.ts --cpu`** stays as the local CPU and wall-time measurement, and
  `baseline.v1.json` stays as its record. No test compares with it.
- **One copy of each shared fixture.** rm/engine's `resumes/`, `parsed/` and
  `judgments/` were byte-identical to `dev/`, `dev/parsed/` and
  `hand-review/`, so they were removed, and rm/engine's judge and tests read
  the shared copies. Hand corrections in `hand-review/` now reach both judges.

On 2026-10-24 this bench renamed its files whose paths collided with rm/engine's:
- `bench.ts` became `gate.ts`;
- `judge.ts` became `rubric.ts`;
- `rings.ts` became `metro-rings.ts`;
- `corpus.json.gz` became `postings.json.gz`;
- `judgments/` became `hand-review/`. Its two files were byte-identical to
  rm/engine's when they moved. Corrections from the AFTER hand review go here.

The two branches now share no file. A trial merge of rm/engine 9fa797f2 into
this branch on 2026-10-24 had no conflict. Both benches and the engine's
fixture tests passed on it: 9 files, 124 tests, and this gate ran in full in
3.0 s.

The two benches print different AFTER figures for the same engine. rm/engine's
reads exact-11 87.3 / 85.9. This one reads 85.5 / 81.8. The corpora differ
(2,731 postings with 492 descriptions, against 4,684 with 618), and so do the
rubrics. rm/engine's rubric counts a licence held in another state as a
transfer, not a fail. This one fails it unless the posting says the licence
may follow hire. rm/engine's sponsorship wording is US wording only. This one
also reads UK and German refusals. That is why only one of them gates: two
gates on one metric drift apart.

The other bench tests:

| test | what it holds |
|---|---|
| `src/test/match-bench-before.test.ts` | The positive control: BEFORE replays to 14.5 / 10.0 / 85.5%, the prototype to the spec table's figures, and comparisons stay like with like. |
| `src/test/match-bench-rubric.test.ts` | Every v2 rule. |
| `src/test/match-bench-fixtures.test.ts` | Coverage, blindness, nothing personal, and corpus integrity. |

## Scripts (run from the repo root with `./node_modules/.bin/tsx`)

| script | what | network |
|---|---|---|
| `01-parse.ts [--set dev\|heldout\|all]` | Renders each résumé to PDF (jsPDF) and DOCX, and reads both back through parse-pdf's and parse-docx's own cores. Writes `<set>/parsed/`. A dev parse that drifts from the BEFORE text is reported, not overwritten. | none |
| `report.ts` | The table above, the held-out reader, BEFORE on the held-out set once scored. Takes `--save-before`, `--save-after --ref`, `--gate` and `--verbose`. Writes `out/after-*.json`. | none |
| `review.ts --after out/after-extract.json` / `--before` | Review sheets with the v2 verdict and the phrases a reviewer checks. | none |
| `ovr.py` | Appends hand corrections (TSV on stdin) to `hand-review/overrides.json`. | none |
| `describe.ts --after <file>` / `--before heldout` [`--freeze`] | Descriptions for every shown row, from the corpus, then the cache, then live `detail`. `--freeze` adds them to the corpus under a new version. | `detail`, ledger only |
| `before-retrieve.ts --set heldout` | Today's "For you" retrieval: `resumeRoleTerms(text, 4)[0]`, then one 60-row `list`. | `list`, ledger only |
| `before-score.ts --set heldout` | fit-batch's call shape and the stable fit partition, locally. | none |
| `build-corpus.ts --from <dir>` | One time: distilled the 2026-10-12 caches into the fixtures. | none |
| `live.ts` | The only file that can reach production (below). | - |

### Live calls: a named ledger, or none

`live.ts` goes live only when both of these are set:
- `MATCH_LEDGER`, the ledger's name;
- `MATCH_PROBE_CAP`, its budget, summed over every run that ever used that
  ledger (`cache/ledger-<name>.jsonl`).

It sends only `list` and `detail`, paced at 1.5 s. Answers are cached in
`cache/board/`, so a re-run costs nothing. `MATCH_OFFLINE=1` never goes live.
`out/` and `cache/` are git-ignored.

### The AFTER benchmark (owner decision 8: its own budget, the same hand review)

Not run yet. The order:
1. Merge the engine.
2. `report.ts` writes `out/after-extract.json`.
3. `MATCH_LEDGER=after-2026-10 MATCH_PROBE_CAP=900 describe.ts --after out/after-extract.json`
   reads every AFTER top-20 description.
4. `review.ts --after ...` writes the sheets. A person reviews every row, and the
   corrections go through `ovr.py`.
5. Do the same for BEFORE on the held-out set: `before-retrieve.ts --set heldout`,
   `describe.ts --before heldout`, `before-score.ts --set heldout`, `review.ts`.
6. For the held-out AFTER run, call the deployed `resume-match` once per
   held-out profile. The offline corpus cannot serve it, because no posting was
   ever retrieved for those résumés.
7. `describe.ts --freeze`, then `report.ts --save-before` and
   `--save-after --ref ...`.

The v1-beats-BEFORE claim (spec §19.2: held-out exact P@20 and location
mismatch, no résumé newly at zero) waits for steps 1-6. Until then, every AFTER
figure above is auto-judged dev-set evidence.
