// Job board aggregator, DB-backed. Postings come from each company's
// OFFICIAL public job-board API (Greenhouse / Lever / Ashby); a refresh
// pass normalizes them into public.job_board_postings, where list queries
// run in SQL. "Apply" always points at the company's own posting page.
//
//   POST { action: "list", q?, location?, remote?, category?, companies?, limit?, offset? }
//   POST { action: "detail", id }      // full description text for the fit scan
//   POST { action: "refresh" }         // fan-out -> upsert -> prune; cron + SWR call this
//
// Freshness model: pg_cron hits refresh every 10 minutes; list also fires a
// background refresh (EdgeRuntime.waitUntil) when data is older than the
// TTL, so the board self-heals even if cron dies. Postings that vanish from
// a company's feed are pruned on the next successful pass — dead listings
// never linger. A refresh lock in job_board_meta stops stampedes.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HOT_TOKENS, JOB_SOURCES, LIGHT_DESC_TOKENS, ORACLE_CANONICAL_SITES, type JobSource } from "./sources.ts";
import { BOARD_DESC_SOURCES, buildEmbedInput, DETAIL_DESC_SOURCES, jobPostingLd, workdayCxsUrl } from "./descriptions.ts";
import { fetchJazzhr, jazzhrPostingUrl, parseJazzhrDetail } from "./vendors/jazzhr.ts";
import { uncarriedCompanies, uncarriedListReply } from "./uncarried.ts";
import {
  COUNTRY_MAP_VERSION,
  detectWorkMode,
  htmlToText,
  normalizeAshby,
  normalizeBambooHR,
  normalizeBreezy,
  normalizeGreenhouse,
  normalizeLever,
  normalizePersonio,
  normalizeRecruitee,
  normalizeSmartRecruiters,
  normalizeTeamtailor,
  normalizeWorkable,
  xmlBlocks,
  xmlValue,
  POSTED_AT_GARBAGE_FLOOR_MS,
  sanePostedAt,
  isDatedBefore,
  normalizeCloseTitle,
  normalizeIcims, normalizeUsajobs, usajobsDescriptions,
  normalizeRippling,
  normalizePinpoint,
  normalizePaylocity,
  extractPaylocityPageData,
  normalizeAdp,
  adpBoardParams,
  extractRipplingJobPosts,
  normalizeWorkday,
  normalizeOracle,
  type OracleHolderRow,
  oracleReqIdOfId,
  oracleReqKey,
  oracleReqKeyOfId,
  planOracleSubsiteVisit,
  rankOracleSites,
  detectCountry,
  detectRegion,
  greenhouseApi,
  leverApi,
  ldBaseSalaryText,
  statesTheSameMoney,
  sweepRefusesAnnual,
  type JobPosting,
  NEGATED_REMOTE_SOURCE,
  normalizeUkg,
  ukgBoardParams,
  workdayDetailPlace,
  isPlacelessLocation,
  listMayRewriteMode,
} from "./normalize.ts";
import { categorize, CATEGORIZE_VERSION, JOB_CATEGORIES } from "./categories.ts";
import { computeFit, resumeRoleTerms, scanResume } from "../_shared/fit-score.ts";
import { METRO_ALIASES, sanitizeTerm, STATE_ALIASES } from "../_shared/location-terms.ts";
// The board's place terms: _shared's aliases, and "City, ST" as the city in that state (query-place.ts).
import { liftTrailingPlace, placeTerms as locationTerms, rankedPlaceParam as rankedLocationParam } from "./query-place.ts";
import { askedByName, resolveCompanyNames, type CompanyScope } from "./company-names.ts";
import { nextPassEndStep, PASS_END_RETRIES, PASS_END_STEPS, stalledPassEndStep, withStepReceipt, isPassEndStep, type PassEndRow, type PassEndStep, type StepReceipt } from "./pass-end.ts";
import {
  POSTED_BACKFILL_VERSION,
  postedBackfillDue,
  backlogFromCoverage,
} from "../_shared/posted-backfill.ts";
import { extractSalary, minedSalaryRefused, parseSalaryStructured } from "../_shared/salary-extract.ts";
import { boardKey, classifyDormancy, DB_FAIL_ALARM_VISITS, dbFailingBoards, dropBareSharedKeys, foldDbFailures, keySource, keyToken, rearmIncompletePrunes, selectRetries, updateBoardFailures, type BoardFailureState } from "./dormancy.ts";
import { STALE_LANE_MIN_AGE_H, STALE_PER_SLICE, bumpStaleTries, classifyStale, countByClass, keysOf, readStaleTries, selectStaleLane, staleExclusion, unresolvedTokens, writeStaleTries, type StaleClass, type StaleRow, type StaleVerdict } from "./stale-lane.ts";
import { tokenMapFromRecord, tokenMapToRecord } from "./token-map.ts";
import { decideRekick } from "./chain-watchdog.ts";
import { advanceProgress, baseConsumedPrefix, isPassDone, type RefreshProgress } from "./rotation.ts";
import { CANARIES, rawItemCount, aggregateVendorHealth, type CanaryResult } from "./vendor-canary.ts";
import { detectExperience, isExperienceBand } from "./experience.ts";
import { ageCutoffMs, textFieldShape, categoryParam, COMPANY_TOKEN_SHAPE, extraFilterParams, filterViolations, isUnfiltered, normalizeFilters, payParams, rpcBlindFilters, rescueVendorsParam, SALARIED_PERIODS, sendableSourcesParam, splitPage, salaryFromQueryText, salaryTokenInQuery, WIDENING_FILTERS } from "./filters.ts";
import { foldName, foldTypeahead, pickRoute, rerankWindow, RETRIEVER_FOR, ringWordPattern, simpleRouteFilters, singularReading, splitExclusions, startsWithWord, stopwordTokens, titleExcluded, withLiveBrands, type TitleFilter } from "./search-routing.ts";
import { planRankedPage, RANKED_WINDOW, RING_WINDOW, rowsReached, symbolLiteralRows } from "./paging.ts";
import { collapseClusters, GROUP_OVERFETCH, interleaveByCompany, rowClusterKey, visibleCategories, mergeCompanyFacet } from "./clusters.ts";
import { EMPLOYER_ALIASES } from "./employer-aliases.ts";
import { expandQuery, ROLE_ALIASES } from "./search-alias.ts";
import { rankedWithDeadline } from "./ranked-deadline.ts";
import { classifyQuestion } from "../_shared/application-questions.ts";
import { parseBreezyQuestions, parsePinpointQuestions, breezyApplyUrl, pinpointApplyUrl } from "../_shared/vendor-questions.ts";
import { realQuestionVendors, SENDABLE_VENDORS } from "../_shared/apply-automation.ts";
import { beforeDeadline, SLIM_SPECS, streamSlim } from "./slim-stream.ts";
import { withWorkdayLanguage } from "./request-headers.ts";
import { ANON_OFFSET_CEILING, anonBudgetGate, anonBudgetStatus, budgetEcho, BUDGETED_ACTIONS, callerAddress, exemptKind, offsetCeiling, pageCeiling } from "./anon-budget.ts";
import { boardPassAction } from "./board-pass.ts";
import {
  addressAllowance, admitDemand, CLICK_PER_ADDRESS_HOUR, DEMAND_QUEUE_KEY, demandLaneStatus, FIT_PER_ADDRESS_HOUR, incidentRows, readDemand,
  REPORT_PER_ADDRESS_HOUR, stampDemandServed, summariseIncidents, takeDemand, VERIFY_PER_ADDRESS_HOUR, writeIncidents,
} from "./abuse-guards.ts";
import { splitTombstoned, type Tombstone } from "./tombstone.ts";
import { laneRows, stampKeyOfJob, stampPlan, stampRows } from "./verification-stamp.ts";
import { isStateCodeAlias, locationBranch, partMatchesTerm } from "./location-match.ts";
import { cursorAfterFailure, emptyFirstPage, emptyInsideLapTotal, lapTotal, stampFeedTotal, workdayWindowed } from "./read-window.ts";
import { clearOversize, heldOversize, loadOversizeEntries, noteOversize, oversizeStatusRows } from "./oversize-registry.ts";
import { startGate } from "./start-gate.ts";
import { addLightReread, lightReread, lightRereadStats, type LightRereadStats } from "./light-reread.ts";
import { selectDeepLane } from "./deep-lane.ts";
import { nameSyncQueue, nameSyncTarget, overrideFor, overrideTable, type NameSyncProgress } from "./name-sync.ts";
import { foldApostrophes, foldTypedText, sameButApostrophes } from "./typed-text.ts";
import { carriedCountsAt } from "./facet-carry.ts";

// .88 (abuse-guards.ts): what one anonymous call may cost. verify fans out to
// vendors, report and click each write a row; a person never needs more.
const VERIFY_MAX_IDS = 5;
/** semantic-search is a diagnostic no page calls: ten rows unless the caller is ours. */
const SEMANTIC_PROBE_ROWS = 10;

// x-rb-pass is the browser's board pass (board-pass.ts). Our tooling's budget
// and reader headers stay off this list, so a page cannot send them.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-rb-pass",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Rationale: docs/job-board-index-notes.md#n001-sitemap-days
// RETAINED WITH NO READER, ON PURPOSE. Its one consumer — the live sitemap
// index — was retired on 2026-10-01 (see the 410 in the GET handler). Four
// guards read this declaration as a comment-stripper canary, asserting it
// survives codeOf: a stripper that eats a region of this file is invisible
// unless something named is known to live there. Deleting it would blind
// them rather than tidy the file. See
// a-stripper-that-loses-real-code-passes-every-guard-that-reads-it.test.ts.
const SITEMAP_DAYS = 30;
// Rationale: docs/job-board-index-notes.md#n002-build-version
const BUILD_VERSION = "2026-09-09.93"; // per-version deploy notes: docs/job-board-deploy-notes.md (kept out of the bundle; see the 4.5MB cap note there)
// Rationale: docs/job-board-index-notes.md#n003-stored-names-do-not-heal-themselves-the-refr

// Rationale: docs/job-board-index-notes.md#n483-const-name_sync_version
const NAME_SYNC_VERSION = 4;
// Rationale: docs/job-board-index-notes.md#n484-boards-whose-catalog-display-name-was

// Rationale: docs/job-board-index-notes.md#n1135-const-renamed_tokens-readonly-string
const RENAMED_TOKENS: readonly string[] = [
  "analogdevices~wd1~External",
  "broadviewfcu~wd1~broadviewfcucareers",
  "hdsupply~wd1~external",
  "ncsecu~wd1~SECU",
  "norgesgruppen~wd3~karriere",
  "nyp~wd1~nypcareers",
  "umd~wd1~UMCP",
  "ummh~wd1~Careers",
  "uobgroup~wd3~UOBExternal",
  "weis~wd108~Careers",
  "albanymed~wd5~Albany_Med",
  "thehartford~wd5~Careers_External",
  "extraspace~wd5~ESS_External",
  "extraspace~wd5~ESS_Acquisitions",
  "elevancehealth~wd1~ANT",
  "elevancehealth~wd1~carelonglobal_in",
  "dinebrands~wd503~DineCareers",
  "dinebrands~wd503~RestaurantCareerSite",
  "sunking",
  "bpinternational~wd3~bpcareers",
  "bpinternational~wd3~bpcwcareerssite",
  "bpinternational~wd3~bpEarlyCareers",
  "justfab~wd1~fabletics",
  "justfab~wd1~savagex",
  "justfab~wd1~justfab",
  "integritymarketing~wd1~Integrity",
  "integritymarketing~wd1~PHPAgency",
  "integritymarketing~wd1~RitterInsuranceMarketing",
  "integritymarketing~wd1~connexionpoint",

  // Rationale: docs/job-board-index-notes.md#n004-nfamilyclub
  "nfamilyclub",
  "gianttiger~wd3~gianttiger",
  "picknpay~wd3~PNP_Careers",
  "alignmenthealthcare~wd12~ahc_external",
  // Rationale: docs/job-board-index-notes.md#n485-embryriddle-wd1-external
  "embryriddle~wd1~External",
  "embryriddle~wd1~AdjunctFacultyOpportunities",
  "standoutforgood~wd12~StandOutForGood",
  "trilongroup",
  "exactcare~wd1~AnewHealth_Career_Site",
];

const STALE_MS = 12 * 60_000; // SWR threshold — cron target is 10 min
const LOCK_MS = 5 * 60_000; // min gap between refresh passes
// Rationale: docs/job-board-index-notes.md#n486-const-fetch_timeout_ms-_000
const FETCH_TIMEOUT_MS = 20_000;
// Rationale: docs/job-board-index-notes.md#n005-concurrency
const CONCURRENCY = 5;
const HOT_CONCURRENCY = 2; // hot boards are giants — two multi-MB parses at once is the memory ceiling
// Rationale: docs/job-board-index-notes.md#n487-const-desc_sweep_per_hop
const DESC_SWEEP_PER_HOP = 120;
// Rationale: docs/job-board-index-notes.md#n006-stored-desc-cap
const STORED_DESC_CAP = 12_000;
const RAW_HTML_CAP = 24_000;
const DESC_SWEEP_CONCURRENCY = 8;
// Rationale: docs/job-board-index-notes.md#n007-structured-sweep-sources
const STRUCTURED_SWEEP_SOURCES: readonly string[] = ["workday"];
// Rationale: docs/job-board-index-notes.md#n008-structured-sweep-per-hop
const STRUCTURED_SWEEP_PER_HOP = 24;
// Rationale: docs/job-board-index-notes.md#n488-const-hot_slice
const HOT_SLICE = 10;
// Rationale: docs/job-board-index-notes.md#n1136-const-slice_posting_budget-_500
// SET FROM THE MEASUREMENT, SO IT CAN ACTUALLY BIND.
//
// This bound was in the right unit from the day it was written and never fired
// once, because 12,000 postings is ~1.23GB at the measured ~105KB a posting —
// five times the isolate ceiling. Every slice death this file has chased for
// six versions happened with the posting budget sitting there, unreachable.
//
// 1,400 postings is ~144MB, which leaves headroom under a ceiling near 256 for
// the row-building and upserts that follow the fetch. The reserve constants
// move with it: reservations alone must stay under the budget or the check
// trips with nothing landed, which is the .32 defect, and (CONCURRENCY-1) x
// COLD_BOARD_RESERVE + DEEP_PER_SLICE x MAX_POSTINGS_PER_VISIT is pinned below
// it by a guard.
// THE 105KB-A-POSTING MODEL WAS RIGHT. THE SAMPLE THAT OVERTURNED IT WAS ONE
// READING TAKEN AT THE WRONG MOMENT.
//
// .57 raised this to 4,000 (and the .34 revert then took it to 12,000) on the
// strength of a single trace reading 41MB at board 35, concluding that the
// 2,002-posting/206MB board had been an outlier and typical boards cost a
// fraction of it. That inference was wrong, and the way it was wrong is worth
// keeping: a slice's heap is not a property you can sample once. It RAMPS.
//
// Measured 2026-09-06 by sampling slice_trace every 20s for nine minutes
// against production — five distinct in-flight slices:
//
//     boards   fetched   heapMb
//        7       357        35
//       28      1,194      187
//       44      1,529      202
//       57      1,554      208
//       51      1,641      231
//
//   heapMb ~= 0.146 x postings_fetched - 10        (r ~ 0.98)
//
// Heap per BOARD is noise (3.6-6.7, no trend); heap per POSTING is 100-160KB.
// So the original ~105KB estimate was, if anything, generous, and the 41MB
// reading was simply an early board in a slice that had not yet ramped — the
// same slice would have been at 200MB forty boards later.
//
// This is also why five separate sizing knobs each "measured on both sides"
// and each read as refuted: every one of them was tested at values that never
// bound. A refutation only refutes the values you tried.
//
// 1,200 postings WAS ~165MB at that fitted cost, which left headroom under a
// ceiling near 256 for the row-building and upserts that follow the fetch, plus
// one board's worth of overshoot past the check (MAX_POSTINGS_PER_VISIT x
// 146KB ~= 58MB). The reservation logic below is what stops all eight workers
// overshooting at once; without it that budget would not have been enough.
//
// The cost was real and accepted at the time: the slice stopped at roughly 55
// cold boards rather than 80 — in practice 24. That was the right trade while
// slices were dying, because a slice that DIES loses its bookkeeping AND stops
// the chain, so each cron tick produced exactly one slice instead of a ~17-hop
// chain — measured at ~960 boards/hour, a 46-hour lap over 44,424 cold boards,
// which is the 56-hour p50 freshness observed on 2026-09-06 against a 6.7-hour
// baseline. Completing is worth more than size. It stopped being the right
// trade the moment the thing killing the slices was fixed:
//
// 1,200 -> 1,500: THE BUDGET WAS STILL THROTTLING FOR A PROBLEM THAT IS FIXED.
//
// The 0.146MB-a-posting fit that set 1,200 this morning was fitted on a LEAK.
// The chunked pagers abandoned unread page responses without cancelling them,
// so heap tracked every posting the slice had ever read — a coefficient in
// postings, produced by a defect in pages. `discardRest` closed it; heap p50
// fell 176MB -> 36MB. The number this budget was derived from does not
// describe this code any more.
//
// MEASURED ON THE LIVE .63 SLICE, which is the reading that decides it:
//     budgetHit    TRUE     budgetFetched 1,216 / budget 1,200
//     heapStopped  false     35MB against HEAP_SOFT_LIMIT_MB 150
//     wallStopped  false     51,027ms of SLICE_WALL_BUDGET_MS 120,000
//     sizeStopped  false    ~24 boards against a boardBudget of 80
// One of four bounds fired and the other three were not close: 23% of the heap
// gate, 43% of the wall, 30% of the board budget. Charge that whole 35MB to
// postings — an overstatement, since it includes the runtime and the module —
// the cost is ~29KB a posting, against the 146KB the leak was producing. At this
// budget the residual is ~42MB, which is why HEAP_SOFT_LIMIT_MB (150) has room
// left over for the in-flight bodies the byte budget sizes separately. A bound that stops a slice at
// a third of the work it was handed is not a safeguard, it is the throughput
// ceiling — the same defect as a budget too high to ever fire, pointing the
// other way.
//
// SIZED FROM THE WALL CLOCK, NOT FROM A MEMORY MODEL. Bounding memory is
// HEAP_SOFT_LIMIT_MB's job: it measures the quantity that actually runs out, it
// is checked before every board, and it stops a slice cleanly. What this
// constant owes the rotation is the largest slice that still FINISHES, and at
// the .63 per-worker rate that is arithmetic rather than a guess:
//
//     1,216 postings / 51.027s / 4 workers = 5.96 postings/s a worker
//     24 boards      / 51.027s / 4 workers = 8.5s a board a worker
//     1,216 / 24                           = 50.7 postings a board
//
//     at CONCURRENCY 5:  1,500 / (5 x 5.96) = 50.4s of loop
//                        1,500 / 50.7       = ~29.6 boards
//                        + one straggler (FETCH_TIMEOUT_MS 20s + its upsert)
//                                           = ~70s, + the post-loop tail
//
// The comparison that matters is against SLICE END, not loop end: the tail
// after `loop-done` — stampSliceWork, the cursor advance, updateBoardFailures
// and its per-token exits, the deep-cursor and oversize writes,
// maybeKickMaintenance, chainNextSlice, recordSliceStats — is real, scales
// with boardsDone, and is not in the 70s above. Even charging it a generous
// 15s the slice lands ~85s, inside the 128s in which every slice that ever
// wrote a terminal stamp finished. In the pessimistic branch where the fifth
// worker buys nothing (parsing is serial — see MAX_RESPONSE_BYTES) the loop is
// 62.9s and the slice lands ~98s, still inside it.
//
// MEASURE THAT TAIL rather than budgeting for it: slice_stats `lastMs` minus
// the `loop-done` breadcrumb's `elapsedMs` is the number, and both are already
// recorded on every slice. It is the one term in this arithmetic nobody has
// ever read, and it is what stands between the loop end and the envelope.
//
// 2,600 was refused: 87s of loop at C=5 (109s if parse-bound), a slice landing
// ~122-145s against that same envelope, and — the bound that actually decides
// it — a coldEmaMs past the load shedder's absolute cold thresholds, which
// answers a longer healthy slice by cutting CONCURRENCY to 3. See the sizing
// rule below. 4,000 needs 134s of loop and does not fit at five workers at all.
// The board budget of 80 would need 4,056 postings and CANNOT be the binding
// constraint at this concurrency — that would take 8 workers, which the byte
// arithmetic at CONCURRENCY refuses.
//
// WHAT TO EXPECT, stated so it can be checked rather than believed: ~30 boards
// a slice against ~24, in the same ~51s, so ~0.59 boards/s within a slice
// against 0.47. That is +25%, and it is +25% in BOTH branches — if the fifth
// worker buys nothing the slice takes 62.9s for the same 30 boards, which is
// still +3% on throughput and never a regression. On a ~19h lap that is
// 15-16h, NOT the 5.4h design target: 5.4h needs ~100 eighty-board slices an
// hour, which this per-worker rate cannot produce at any budget. Saying so is
// the point — the next lever is per-board latency or the per-response byte
// cap, not this constant.
//
// RE-MEASURE THE CURSOR RATE after this deploys (deepCursor.lane and excess,
// never maxOffset) — a lane change has cost this rotation 4x before.
//
// ── AND THE NUMBER IS 1,500, NOT 2,600. THE THIRD BOUND WAS NOT ON THE LIST. ──
//
// The brief listed five interlocks and this constant clears all five at 2,600.
// It does not clear the sixth, which nothing had written down: THE ADAPTIVE
// LOAD SHEDDER READS SLICE DURATION, AND SLICE DURATION IS A FUNCTION OF THIS
// CONSTANT. `coldEmaMs` is the EMA of the WHOLE slice (recordSliceStats:
// `Date.now() - sliceWallStart`), and the cold shed thresholds are ABSOLUTE
// milliseconds. Raise the budget and every healthy slice gets longer; past the
// line, the shedder reads "distress" and cuts — and at level 2 it cuts
// CONCURRENCY to 3, BELOW the 4 this change replaced, with the bootstrap,
// retry and deep lanes at zero. It then latches, because the shed slice is
// still budget-bound and still long. A throughput raise that ends in a ~25%
// throughput REGRESSION is not a throughput raise.
//
// THE SIZING RULE THAT AVOIDS ALL OF THAT: scale the budget WITH concurrency
// and hold slice duration constant.
//
//     .63 measured:  1,216 postings · 24 boards · 51,027ms · 4 workers
//                    -> 5.957 postings/s/worker, 50.7 postings a board
//     .64 at C=5:    1,500 / (5.957 x 5) = 50.4s of loop
//
// 50.4s against .63's 51.0s — the slice takes the SAME time and does 25% more
// work (29.6 boards against 24). coldEmaMs stays where it is (36.2s), so the
// shed thresholds keep exactly the headroom they have today, the wall clock
// keeps its 57s of slack, and the survival envelope is untouched. Nothing
// downstream has to be re-derived, which is the point: the constants that
// bound this one were calibrated against a slice of a particular size, and the
// cheapest way to keep them true is not to change the size.
//
// WHAT IT COSTS: +25%, not the +117% that 2,600 modelled. The honest reason to
// take it anyway is that 2,600's extra gain was never real — it was borrowed
// from the shedder, which would have taken it back with interest the same hour.
//
// THE PESSIMISTIC BRANCH, because the 5-worker figure is an extrapolation.
// This file's own byte-budget note says parsing is serial (one thread), so if
// the .63 slice was parse-bound rather than I/O-bound, a fifth worker buys
// nothing and 1,500 postings take 1,500/23.83 = 62.9s. That still leaves 57s
// under SLICE_WALL_BUDGET_MS and still lands the slice inside the envelope; it
// pushes coldEmaMs to ~44.6s, which is why the cold shed lines were re-derived
// in the same commit instead of being left at a threshold calibrated for a 26s
// slice that has not existed for weeks. At 2,600 the same branch is 109s of
// loop — 11s from the wall, with a 20s straggler still to come.
const SLICE_POSTING_BUDGET = 1_500;
// Rationale: docs/job-board-index-notes.md#n009-hot-posting-budget
const HOT_POSTING_BUDGET = 1_200;
// Rationale: docs/job-board-index-notes.md#n010-cold-board-reserve
const COLD_BOARD_RESERVE = 200;
// Twenty yields is five seconds of waiting for a board that is not coming.
const YIELD_SPIN_LIMIT = 20;
// Rationale: docs/job-board-index-notes.md#n011-heap-soft-limit-mb
const HEAP_SOFT_LIMIT_MB = 150;
// AND THE ONE THAT ACTUALLY RUNS OUT: WALL TIME.
//
// .41 bounded heap because the breadcrumbs showed 200MB at the moment of
// death. That reading was real but it was not the cause: on .41 slices went on
// dying at heap 70 and 132, far below both the 150MB bound and the ~256MB
// ceiling, so the bound never even fired. Recorded here because I shipped that
// theory to production and it was wrong.
//
// What separates the slices cleanly is DURATION. Every slice that ever wrote
// its terminal stamp finished inside 128s — 85.9, 93.3, 97.0, 102.8, 108.5,
// 109.5, 115.0, 127.8 — and the one recorded death ran 158.3s. The isolate has
// a wall-clock ceiling and the slice had no clock: the only time bound in the
// whole loop was FETCH_TIMEOUT_MS on a single fetch.
//
// THE PROSE SAID 90s AND THE CONSTANT SAID 120s, FOR WEEKS. Corrected here
// rather than quietly, because the derivation the old sentence gave is the
// derivation that makes 120s frightening, and it was landing on a different
// number than the code.
//
// 120s to STOP TAKING new boards. A board already in flight can add, per
// request, FETCH_TIMEOUT_MS (20s) for headers and as much for the body
// (bodyDeadline since .92; before it the body had no clock, S8-030) plus its
// upsert, and then the post-loop tail —
// stampSliceWork, the cursor advance, updateBoardFailures with its per-token
// exits and deletes, the deep-cursor and oversize meta writes,
// maybeKickMaintenance, chainNextSlice, recordSliceStats — runs on top. A
// slice that actually reaches this bound therefore lands somewhere around
// 145-155s: OUTSIDE the 128s in which every slice that ever wrote a terminal
// stamp finished, and next to the 158.3s of the one recorded death.
//
// SO A WALL-STOPPED SLICE IS AN ALARM, NOT A MODE OF OPERATION. `wallStopped`
// riding true on slice_stats means the slice is expected to die: it loses its
// bookkeeping AND stops the chain, which turns one cron tick into a single
// slice instead of a ~17-hop chain — the ~960 boards/hour, 46-hour-lap
// regression of 2026-09-06. The bound that is supposed to stop the loop is
// SLICE_POSTING_BUDGET, and it is sized so that it fires with ~57s of this
// wall unspent even if a fifth worker buys nothing (see the arithmetic there;
// a guard pins it). This constant exists for the case where that sizing is
// wrong about a particular draw — it is a backstop, and a backstop being
// reached is news.
//
// WHY IT IS NOT SIMPLY LOWERED TO THE 90s THE OLD COMMENT CLAIMED, which would
// land a wall-stopped slice at ~115s and inside the envelope: the HOT phase
// shares this bound, and hotEmaMs is 100,554 today. A 90s wall would start
// truncating hot slices that currently complete — deferring giants and
// changing hot-cursor behaviour — to fix a case that the posting budget is
// already sized to prevent. That trade needs the hot-slice measurement this
// file does not yet take (see the shed thresholds), so the wall stays where it
// is and the sentence describing it is made true instead.
const SLICE_WALL_BUDGET_MS = 120_000;
// Rationale: docs/job-board-index-notes.md#n012-min-boards-per-slice
const MIN_BOARDS_PER_SLICE = 80;
// MEASURED, AT LAST. The .47 ramp was built to find this number and it found
// it within four minutes of deploying:
//     budget  8  slice completes   (works 3121 -> 3123)
//     budget 16  slice completes   (works 3123 -> 3125)
//     budget 24  slice DIES        (chainKick http_error, trace frozen at
//                                   "loop 24", works stops at 3125)
// So the threshold this file has chased through five versions — the posting
// budget, heap, wall time, and two cap guesses — sits between 16 and 24
// boards. The cause is still unknown; the boundary is not.
//
// The ceiling is the last value observed to SURVIVE, not the first to die. A
// ceiling of 80 left the ramp oscillating 8 -> 16 -> 24 -> death -> 8, and a
// death costs the whole chain plus a wait for the next cron tick, which is
// strictly worse than simply running at 16. So the ramp now climbs 8 -> 16 and
// holds there, and the machinery stays: raise this to 20 and the ramp will
// tell us within minutes whether 20 lives, without another guess.
// RAISED BACK, BECAUSE THE MEASUREMENT THAT SET IT WAS TAKEN ON BROKEN CODE.
//
// 16 was the last budget observed to survive — measured on .47, while BOTH the
// 105KB-a-posting memory blowout (.51/.52 capped it) and the yield that could
// never end (.53 fixed it) were still live. Every death that produced that
// number had one of those two causes, so the number describes the bugs, not
// the platform.
//
// And the cost of keeping it is now the larger problem: a budget of 16 splits
// to ~9 cold boards a slice, which is 4,889 slices for one pass over 44,000
// boards. Freshness has gone 403 -> 2,291 minutes across today while the
// rotation became steadily more correct — the slices complete, they are simply
// far too small. Correct and too slow is still broken.
//
// The ramp is the right instrument and it is already built: it climbs while
// hops complete and resets to the floor when one dies, so restoring the
// ceiling lets it re-find the real limit under the fixed code instead of me
// guessing a second number. The posting budget — 1,400, set from the measured
// per-posting cost — is what actually bounds a slice now; the board count only
// stops a slice made entirely of tiny boards from running long.
const MAX_BOARDS_PER_SLICE = 80;
const BOARDS_RAMP_STEP = 8;
const CAPPED_VISIT_VENDORS = new Set(["workday", "oracle", "icims", "smartrecruiters", "rippling", "usajobs", "teamtailor"]);
const COLD_SLICE = 80; // cold boards are small (that's why they're cold); 80/hop at CONCURRENCY=5 is 16 sequential rounds, and SLICE_POSTING_BUDGET stops the loop near 51 boards long before the list is exhausted — the list size is a ceiling, not a plan. Rotation speed comes from concurrency + hops-per-pass, never bigger slices (proven-safe size).
const BOOTSTRAP_PER_SLICE = 25; // zero-row boards prepended per cold slice after a deploy — +31% slice load, still ~3 rounds under the wall-time margin; a 1,900-board merge drains in ~1.5 passes instead of waiting a full rotation for its FIRST ingest
// Rationale: docs/job-board-index-notes.md#n013-
// Rationale: docs/job-board-index-notes.md#n1137-const-deep_volume_per_slice
// Rationale: docs/job-board-index-notes.md#n014-deep-volume-per-slice
const DEEP_VOLUME_PER_SLICE = 500;
const DEEP_PER_SLICE = 2; // = floor(DEEP_VOLUME_PER_SLICE / MAX_POSTINGS_PER_VISIT); pinned by test
// Rationale: docs/job-board-index-notes.md#n426-deep-lane-ahead-of-base
const DEEP_LANE_TAKE = 1; // deep boards a cold slice takes at rest, out of the bootstrap take; 0 turns the lane off
// Rationale: docs/job-board-index-notes.md#n015-retry-per-slice
const RETRY_PER_SLICE = 5;
// Rationale: docs/job-board-index-notes.md#n016-stale-rpc-limit
const STALE_RPC_LIMIT = 60;
const STALE_RPC_DEADLINE_MS = 4_000;
/** Every catalogued token, once: the demand lane's test. A Set, so a token named 'constructor' is a real member. */
const CATALOGUE_TOKENS: ReadonlySet<string> = new Set(JOB_SOURCES.map((s) => s.token));
/** Tokens carried by more than one vendor (139 on 2026-10-05): their boards are failure-tracked by `source:token` (n417). */
const SHARED_TOKENS: ReadonlySet<string> = (() => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of JOB_SOURCES) { if (seen.has(s.token)) dup.add(s.token); else seen.add(s.token); }
  return dup;
})();
/** A board's key in board_failures: its bare token, or `source:token` when the token is shared. */
const boardKeyOf = (s: { source: string; token: string }) => boardKey(s.source, s.token, SHARED_TOKENS);
let boardsByKey: Map<string, JobSource> | null = null;
/** The catalog board a board_failures key names, if it is still catalogued. */
const boardByKey = (key: string): JobSource | undefined => {
  boardsByKey ??= new Map(JOB_SOURCES.map((s) => [boardKeyOf(s), s]));
  return boardsByKey.get(key);
};
/** Every catalogued board's key, once: the stale lane's 'uncatalogued' test (n428). */
const CATALOGUE_KEYS: ReadonlySet<string> = new Set(JOB_SOURCES.map(boardKeyOf));
/** One cold hop's stale-lane run, as persisted under meta k = "stale_lane" beside `tries`, and as status reads it. */
interface StaleLaneRun {
  at: string;
  /** ok = rows came back; error = PostgREST answered an error (an absent RPC in the deploy window lands here) OR the request rejected outright (network/TLS — the message says which); timeout = the deadline won. */
  rpc: "ok" | "error" | "timeout";
  asked: number;
  /** The RPC returned a full window AFTER the exclusion and none of it was fetchable: something outside the excluded classes fills it and the tail behind row STALE_RPC_LIMIT goes unexamined. Also a warn line. */
  windowFull: boolean;
  /** Tokens sent as p_exclude (prototype names ∪ oversize ∪ unresolved, ≤ STALE_EXCLUDE_MAX); 0 when the RPC predates the arm (PGRST202 fallback) or was not asked. */
  excluded: number;
  classes: Record<StaleClass, number> | null;
  selected: string[];
  /** Selected boards the loop actually attempted (not deferred by the posting budget). */
  fetched: number;
  /** Attempted boards that STAMPED — the lane's job for them is done and they leave `tries`. */
  resolved: number;
  unresolved: string[];
  prototypeNames: string[];
}
/** The slice's stale-lane outcome, written onto slice_stats by recordSliceStats beside the budget note. */
let sliceStaleNote: { tries: number; resolved: number } | null = null;
/** This cold slice's cursor bookkeeping: admitted by the whole base slice, then corrected to the boards started (n434). */
let sliceCursorNote: { from: number; admitted: number; to: number; base: number; started: number } | null = null;
const HEADLINE_MAX_AGE_MS = 15 * 60_000; // how stale the published board total may get before it is recounted; the count itself measured 0.63s, so this is cadence, not cost
const SLICE_LOCK_MS = 3 * 60_000; // min gap between slices
const DESC_CAP = 14_000; // matches the scanner's own input bounds

const db = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const waitUntil = (p: Promise<unknown>) => {
  const guarded = p.catch((e) => console.warn("[JOB-BOARD] background task failed:", e));
  try {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(guarded);
  } catch {
    /* fire-and-forget fallback */
  }
};

// ── board fetching ─────────────────────────────────────────────────────────

// Rationale: docs/job-board-index-notes.md#n017-light-capable-vendors
const LIGHT_CAPABLE_VENDORS = new Set(["greenhouse"]);

/** The light set's key: one BOARD (`source:token`), so a shared token's greenhouse board can go light alone (n415). */
const lightKey = (s: { source: string; token: string }) => `${s.source}:${s.token}`;

// Rationale: docs/job-board-index-notes.md#n018-lighttokenrefusal
// Rationale: docs/job-board-index-notes.md#n415-light-mode-is-per-board
const lightBoardRefusal = (key: string): string | null => {
  const at = key.indexOf(":");
  if (at <= 0) return "not a source:token key";
  const source = key.slice(0, at);
  const token = key.slice(at + 1);
  let seen = false;
  for (const s of JOB_SOURCES) {
    if (s.token === token && s.source === source) { seen = true; break; }
  }
  if (!seen) return "not in the catalog";
  if (!LIGHT_CAPABLE_VENDORS.has(source)) return `vendor ${source}`;
  return null;
};

// Rationale: docs/job-board-index-notes.md#n1138-class-lightcapableonly-extends-set-strin
class LightCapableOnly extends Set<string> {
  override add(key: string): this {
    const refusal = lightBoardRefusal(key);
    if (refusal) {
      console.warn(`[JOB-BOARD] light mode REFUSED for ${key} (${refusal}): no filler can refill a light board on that vendor, so its descriptions would be deleted rather than deferred`);
      return this;
    }
    return super.add(key);
  }
}

// Rationale: docs/job-board-index-notes.md#n019-dynamic-light
const DYNAMIC_LIGHT: Set<string> = new LightCapableOnly();
const AUTO_LIGHT_THRESHOLD_CHARS = 2_500_000; // ~2.5MB of raw content HTML
const AUTO_LIGHT_CAP = 500; // 107 greenhouse boards needed a slot on 2026-10-01, and 50 made every one of them miss; see n019
const isLight = (s: { source: string; token: string }) => LIGHT_DESC_TOKENS.has(s.token) || DYNAMIC_LIGHT.has(lightKey(s));

// Rationale: docs/job-board-index-notes.md#n1139-const-desc_backfill_vendor-greenhouse-ba
const DESC_BACKFILL_VENDOR = "greenhouse"; // backfill-desc hits the GH per-JOB endpoint and only that
const descBackfillBoards = (): JobSource[] =>
  JOB_SOURCES.filter((s) => s.source === DESC_BACKFILL_VENDOR && isLight(s));

// Rationale: docs/job-board-index-notes.md#n421-a-row-not-read-is-not-written
const META_READ = { light: false, oversize: false };
async function readMetaRow(client: SupabaseClient, k: string): Promise<{ read: true; v: unknown } | { read: false; why: string }> {
  try {
    const { data, error } = await client.from("job_board_meta").select("v").eq("k", k).maybeSingle();
    return error ? { read: false, why: String(error.message ?? error).slice(0, 120) } : { read: true, v: data?.v ?? null };
  } catch (e) {
    return { read: false, why: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

async function loadDynamicLight(client: SupabaseClient): Promise<void> {
  const row = await readMetaRow(client, "light_desc_dynamic");
  META_READ.light = row.read;
  if (!row.read) {
    console.warn(`[JOB-BOARD] light set unread (${row.why}): previous set kept, nothing persisted this slice`);
    return;
  }
  try {
    const tokens = (row.v as { tokens?: unknown } | null)?.tokens;
    DYNAMIC_LIGHT.clear();
    // Rationale: docs/job-board-index-notes.md#n489-const-refused-string
    const refused: string[] = [];
    // Rationale: docs/job-board-index-notes.md#n490-let-converted
    let converted = 0;
    if (Array.isArray(tokens)) {
      for (const t of tokens) {
        if (typeof t !== "string") continue;
        const keys = t.includes(":") ? [t] : JOB_SOURCES.filter((s) => s.token === t && LIGHT_CAPABLE_VENDORS.has(s.source)).map(lightKey);
        if (!t.includes(":")) converted++;
        if (keys.length === 0) refused.push(t);
        for (const k of keys) {
          DYNAMIC_LIGHT.add(k);
          if (!DYNAMIC_LIGHT.has(k)) refused.push(k);
        }
      }
    }
    if (refused.length > 0 || converted > 0) {
      // Rationale: docs/job-board-index-notes.md#n491-if-refused-length-console-warn-job
      if (refused.length > 0) console.warn(`[JOB-BOARD] light_desc_dynamic swept: ${refused.length} non-light-capable board(s) removed (${refused.slice(0, 10).join(", ")})`);
      await client.from("job_board_meta").upsert(
        {
          k: "light_desc_dynamic",
          v: {
            tokens: [...DYNAMIC_LIGHT].slice(-AUTO_LIGHT_CAP),
            updatedAt: new Date().toISOString(),
            keyedBy: "source:token",
            ...(refused.length > 0 ? { strandedRemovedAt: new Date().toISOString(), strandedRemoved: refused.slice(0, AUTO_LIGHT_CAP) } : {}),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "k" },
      );
    }
  } catch { /* the row was read; a failed sweep write retries on the next load */ }
}

// Rationale: docs/job-board-index-notes.md#n020-oversize-boards
const OVERSIZE_BOARDS = new Map<string, { source: string; mb: number; at: string }>();
const OVERSIZE_CAP = 200;
async function loadOversizeBoards(client: SupabaseClient): Promise<void> {
  const row = await readMetaRow(client, "oversize_boards");
  META_READ.oversize = row.read;
  if (!row.read) {
    console.warn(`[JOB-BOARD] oversize registry unread (${row.why}): previous registry kept, not persisted, and the freshness sweep skipped this slice`);
    return;
  }
  loadOversizeEntries(OVERSIZE_BOARDS, (row.v as { boards?: unknown } | null)?.boards, SHARED_TOKENS);
}
async function persistOversizeBoards(client: SupabaseClient): Promise<void> {
  if (!META_READ.oversize) return;
  try {
    // Newest last, oldest dropped: a board that stopped being oversize ages
    // out of the registry instead of being asserted forever.
    const entries = [...OVERSIZE_BOARDS.entries()].slice(-OVERSIZE_CAP);
    OVERSIZE_BOARDS.clear();
    for (const [k, v] of entries) OVERSIZE_BOARDS.set(k, v);
    const { error } = await client.from("job_board_meta").upsert(
      { k: "oversize_boards", v: { boards: Object.fromEntries(entries), updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
    if (error) console.warn("[JOB-BOARD] oversize registry persist failed (non-fatal):", error.message?.slice(0, 120));
  } catch { /* diagnostic — never blocks a slice */ }
}

// Once per isolate: a board on a shared token with no stamp of its own gets the token's (n428).
let BOARD_STAMPS_SEEDED = false;
async function seedBoardStamps(client: SupabaseClient): Promise<void> {
  if (BOARD_STAMPS_SEEDED) return;
  try {
    const read = <T,>(q: PromiseLike<T>) => withDeadline(q, 3_000) as Promise<{ data: unknown[] | null; error?: unknown }>;
    const keyed = await read(client.from("job_board_verifications").select("company_token").like("company_token", "%:%"));
    if (keyed.error || !Array.isArray(keyed.data)) return;
    const have = keyed.data.map((r) => String((r as { company_token?: unknown }).company_token ?? ""));
    const bare = SHARED_TOKENS.size ? await read(client.from("job_board_verifications").select("company_token,verified_at").in("company_token", [...SHARED_TOKENS])) : { data: [] };
    if (bare.error || !Array.isArray(bare.data)) return;
    const plan = stampPlan(have, bare.data, JOB_SOURCES, SHARED_TOKENS);
    if (plan.seed.length) {
      const { error: wErr } = await client.from("job_board_verifications").upsert(plan.seed, { onConflict: "company_token", ignoreDuplicates: true });
      if (wErr) { console.warn("[JOB-BOARD] board stamp seed failed (retries next slice):", wErr.message?.slice(0, 120)); return; }
    }
    if (plan.remove.length) {
      const { error: dErr } = await client.from("job_board_verifications").delete().in("company_token", plan.remove.slice(0, 200));
      if (dErr) { console.warn("[JOB-BOARD] stale board stamps not removed (retries next slice):", dErr.message?.slice(0, 120)); return; }
    }
    if (plan.seed.length || plan.remove.length) console.log(`[JOB-BOARD] board stamps: ${plan.seed.length} seeded from the token's stamp, ${plan.remove.length} removed (token no longer shared)`);
    BOARD_STAMPS_SEEDED = true;
  } catch { /* the stamps seed on the next slice */ }
}

// Rationale: docs/job-board-index-notes.md#n1140-async-function-enroldynamiclight-client
async function enrolDynamicLight(client: SupabaseClient, board: Pick<JobSource, "source" | "token">, why: string): Promise<boolean> {
  const key = lightKey(board);
  DYNAMIC_LIGHT.add(key);
  if (!DYNAMIC_LIGHT.has(key)) return false;
  console.warn(`[JOB-BOARD] auto-light: ${key} ${why} — enrolled in light mode (descs via backfill)${META_READ.light ? "" : "; not persisted, the row was unread this slice"}`);
  if (!META_READ.light) return true;
  try {
    const { error: alErr } = await client.from("job_board_meta").upsert(
      { k: "light_desc_dynamic", v: { tokens: [...DYNAMIC_LIGHT].slice(-AUTO_LIGHT_CAP), updatedAt: new Date().toISOString(), keyedBy: "source:token" }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
    if (alErr) console.warn(`[JOB-BOARD] auto-light persist failed for ${key} (re-enrolls next fetch):`, alErr.message?.slice(0, 120));
  } catch { /* re-enrolls on the next fetch — never blocks the slice */ }
  return true;
}

// Rationale: docs/job-board-index-notes.md#n021-startoffset-is-honoured-only-by-the-paginatin

// startOffset is honoured only by the paginating vendors; every other branch
// fetches a whole feed and ignores it.
const listUrl = (s: JobSource, startOffset = 0) =>
  s.source === "greenhouse"
    // content=true costs a bigger payload but delivers every description in
    // ONE call — fit-ranking coverage for GH boards, plus real departments.
    ? (({ host, token }) => `https://${host}/v1/boards/${token}/jobs${isLight(s) ? "" : "?content=true"}`)(greenhouseApi(s.token))
    : s.source === "lever"
      ? (({ host, token }) => `https://${host}/v0/postings/${token}?mode=json`)(leverApi(s.token))
      : s.source === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${s.token}?includeCompensation=true`
        : s.source === "smartrecruiters"
          ? `https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100${startOffset ? `&offset=${startOffset}` : ""}`
          : s.source === "workable"
            // Rationale: docs/job-board-index-notes.md#n492-https-apply-workable-com-api-v1
            ? `https://apply.workable.com/api/v1/widget/accounts/${s.token}?details=${isLight(s) ? "false" : "true"}`
            : s.source === "recruitee"
              ? `https://${s.token}.recruitee.com/api/offers/`
              : s.source === "breezy"
                ? `https://${s.token}.breezy.hr/json`
                : s.source === "teamtailor"
                  // Rationale: docs/job-board-index-notes.md#n493-https-s-host-s-token-teamtailor
                  ? `https://${s.host ?? `${s.token}.teamtailor.com`}/jobs.rss`
                  : `https://${s.token}.bamboohr.com/careers/list`;

// Rationale: docs/job-board-index-notes.md#n022-sr-page
const SR_PAGE = 100;
const SR_PAGE_CAP = 20;
const SR_CAP = SR_PAGE * SR_PAGE_CAP; // 2,000/board/pass
async function fetchSmartRecruiters(s: JobSource, startOffset = 0): Promise<{ content: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  // Rationale: docs/job-board-index-notes.md#n494-const-first-await-fetchwithtimeout-listu
  const first = await fetchWithTimeout(listUrl(s, startOffset));
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  const page1 = await first.json();
  // Rationale: docs/job-board-index-notes.md#n495-const-feedtotal-number-page1-totalfound
  const feedTotal = Number(page1.totalFound) || 0;
  const total = Math.min(feedTotal, SR_CAP);
  const content: unknown[] = [...(page1.content ?? [])];
  // Rationale: docs/job-board-index-notes.md#n496-let-srended-page1-content-length-sr_page
  let srEnded = (page1.content ?? []).length < SR_PAGE;
  // The visit stops at MAX_POSTINGS_PER_VISIT (the slice reserves that for a
  // CAPPED_VISIT_VENDOR; this used to run to SR_CAP), srEnded false, so it resumes.
  for (let offset = SR_PAGE; !srEnded && offset < total && content.length < MAX_POSTINGS_PER_VISIT; offset += SR_PAGE) {
    const want = Math.min(SR_PAGE, MAX_POSTINGS_PER_VISIT - content.length);
    const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=${want}&offset=${startOffset + content.length}`);
    if (!res.ok) { discardBody(res); break; } // partial page set: windowed below, so nothing is pruned on it
    const page = await res.json();
    const batch = (page.content ?? []) as unknown[];
    content.push(...batch);
    // RECORD the ending; a short page is the only end-of-feed observation.
    if (batch.length < want) { srEnded = true; break; }
  }
  // Rationale: docs/job-board-index-notes.md#n497-const-advancedsr-startoffset-content-len
  const advancedSr = startOffset + content.length;
  const nextOffset = srEnded || content.length === 0 || (feedTotal > 0 && advancedSr >= feedTotal) ? 0 : advancedSr;
  return { content, windowed: feedTotal > content.length || startOffset > 0, feedTotal, nextOffset, feedEnded: srEnded || content.length === 0, endOffset: advancedSr };
}

/**
 * NOTHING BOUNDED A RESPONSE BODY, AND THAT IS WHAT KILLED THE ISOLATE.
 *
 * Five sizing knobs — posting budget, board count, concurrency, wall clock,
 * heap ceiling — were each measured on both sides and each refuted, and a
 * sixth model (heap linear in postings fetched) died on its own samples:
 *
 *     heap  41MB  fetched 1,184  boards 23   (clearwaygroup)
 *     heap 101MB  fetched 1,088  boards 22   (mchapusa~wd5)
 *     heap 190MB  fetched 1,010  boards 23   (medcan~wd10, 23 rows STORED)
 *
 * More postings at a quarter of the heap, and a board that stored twenty-three
 * rows while heap read 190MB. None of that can be the slice's accumulation —
 * 41MB at 1,184 postings is the floor, so there is no retention leak. What the
 * breadcrumb records is the token of the board that just FINISHED, so a heap
 * reading is the SUM of what all CONCURRENCY workers hold, dominated by the
 * largest response in flight. The memory is whole HTTP response bodies, and
 * until this constant nothing bounded them:
 *
 *   - MAX_POSTINGS_PER_VISIT binds only CAPPED_VISIT_VENDORS — seven of twenty (usajobs .89, teamtailor .92).
 *     The other thirteen fetch an entire board in ONE request.
 *   - greenhouse asks for ?content=true, which inlines every description.
 *   - AUTO_LIGHT_THRESHOLD_CHARS measures contentChars AFTER the body is
 *     parsed, so it can only ever protect the NEXT pass. The one volume guard
 *     that existed fires too late BY CONSTRUCTION.
 *
 * A bound that acts after `await res.json()` is not a bound; the allocation it
 * is meant to prevent already happened. So the budget is enforced BEFORE the
 * body is read: cheaply from Content-Length when the vendor declares one, and
 * otherwise by a counting stream that aborts mid-transfer. Chunked responses
 * carry no Content-Length and a declared length can lie, so the streaming read
 * is the one that actually holds; the header check just saves the transfer.
 *
 * THE ARITHMETIC. Ceiling ~256MB (WORKER_RESOURCE_LIMIT, HTTP 546).
 *
 *   baseline: runtime + module + slice accumulation      ~64MB
 *     (measured floor: 41MB holding 1,184 postings)
 *   reserve kept clear of the ceiling                    ~64MB
 *   left for in-flight response bodies and their parse   ~128MB
 *   / PEAK BOARD WORKERS x BODIES READ AT ONCE PER WORKER
 *   / parse amplification (JSON -> JS objects, ~6x:
 *     UTF-16 strings plus per-key object overhead)
 *
 * BOTH factors in that denominator are load-bearing and BOTH were wrong in the
 * first draft of this comment, which divided by CONCURRENCY and stopped:
 *
 *  - PEAK WORKERS IS NOT ALWAYS `CONCURRENCY`. effConcurrency shed level 1 read
 *    5 — a literal written when CONCURRENCY was 8, where it was a cut, and left
 *    behind when CONCURRENCY became 4, where it was a 25% RAISE on the exact
 *    signal that means the database is already struggling. It is clamped at the
 *    definition now (`Math.min(CONCURRENCY, …)`), so peak workers is
 *    max(CONCURRENCY, HOT_CONCURRENCY) = 5 and the guard re-derives that from
 *    the expression rather than trusting this sentence. (It read 4 while
 *    CONCURRENCY was 4; the number in a sentence is exactly what goes stale,
 *    which is why the guard reads the expression.)
 *  - BODIES READ AT ONCE PER WORKER IS NOT ALWAYS 1. Five vendors page a board
 *    in a CHUNK: ukg/adp/workday/oracle 4 wide, icims 5. They used to
 *    `Promise.all(pages.map(… await res.json()))`, so one worker held a whole
 *    chunk of PARSED pages at once and a per-response bound of 4MB permitted
 *    4 x 5 x 4MB = 80MB of wire, ~480MB parsed — the isolate dies with every
 *    individual response comfortably in budget. Measured live: one iCIMS
 *    page-of-100 is 2.0-3.3MB (AccentCare 2.0MB, AMD 3.3MB), so five held at
 *    once is ~16MB of wire per worker, triple its whole allotment, without any
 *    response coming near the bound. The chunks still FETCH concurrently — the
 *    round trips are the point — but their bodies are now read ONE AT A TIME,
 *    in page order. Parsing was always serial (one thread); only the retention
 *    was concurrent, and that is what is gone.
 *
 *   128MB / (5 workers x 1 body) = 25.6MB a worker
 *   25.6MB / 6x parse amplification = 4.3MB of wire
 *
 * Round DOWN to 4MB: five workers each at the ceiling cost 5 x 4MB x 6 = 120MB
 * against the 128MB allotment. The unread responses of a chunk sit under
 * TransformStream backpressure (readable HWM 0) plus one transport window —
 * order 100KB each, so 5 workers x 4 unread is ~2MB, noise against the
 * reserve. The desc sweep runs DESC_SWEEP_CONCURRENCY wide but fetches ONE
 * posting per response — tens of KB — so the binding case is the list path,
 * which is where every giant lives.
 *
 * READ IN THE OTHER DIRECTION, THIS SUM IS THE CAP ON CONCURRENCY: 128 / 24 =
 * 5.33 workers, so 4 fits, 5 fits, 6 (144MB) does not and 8 (192MB) is half as
 * much again as the whole allotment. Going wider means cutting
 * MAX_RESPONSE_BYTES or spending the reserve — see CONCURRENCY.
 *
 * WHERE 4MB SITS, measured 2026-09-06 against the requests this code actually
 * issues (not against stripe/zscaler: they are LIGHT_DESC_TOKENS, so listUrl
 * has not sent them ?content=true in months — stripe's real list fetch is
 * 385KB, and the 3.9MB/4.9MB figures that first justified this constant are
 * contentChars of a request shape no longer issued):
 *
 *   greenhouse gitlab, heavy   3.6MB   under, ingests whole
 *   lever palantir             6.0MB   over
 *   lever veeva               12.8MB   over
 *   ashby openai              13.6MB   over
 *   recruitee livezoku        15.0MB   over
 *
 * Nothing measured sits AT the line: ordinary boards are an order of magnitude
 * under it (p90 by vendor: ashby 245KB, lever 936KB, recruitee 343KB, personio
 * 88KB, breezy 36KB) and the ~1% that cross it are 1.5-3.8x above. That gap is
 * the honest shape of this bound — it does not trim giants, it excludes them —
 * and because the crossers are concentrated on vendors with no light form,
 * OVERSIZE_BOARDS exists to keep them nameable rather than silent.
 */
const MAX_RESPONSE_BYTES = 4_000_000;
// The second read of a lever/ashby board (or a light greenhouse list) the bound refused, one posting at a time.
// Rationale: docs/job-board-index-notes.md#n411-streamed-oversize-read
const STREAM_WIRE_BYTES = 64_000_000;
const STREAM_READ_BUDGET_MS = 30_000;
const SLIM_ELEMENT_BYTES = 1_000_000;
const SLIM_RETAINED_BYTES = 3_000_000;
const SLIM_DESC_CEILING = 2_500_000;
// Our own function answering our own chain kick / maintenance probe. Status
// and list payloads, not vendor feeds, so the ceiling is a tenth of a board's.
const SELF_RESPONSE_BYTES = 400_000;
// Rationale: docs/job-board-index-notes.md#n498-const-max_request_bytes-_000_000
const MAX_REQUEST_BYTES = 2_000_000;
// Carried in the thrown message because fetchBoard's classifier reads message
// text; the worker keys the DEFERRAL on it, and a deferral is not a failure.
const OVERSIZE_MARKER = "OVERSIZE_BODY";

// Rationale: docs/job-board-index-notes.md#n1141-function-discardbody-src-body-readablest
function discardBody(src: { body: ReadableStream<Uint8Array> | null } | null | undefined): void {
  try {
    void src?.body?.cancel().catch(() => {});
  } catch { /* already consumed, locked, or no body — nothing to release */ }
}

// Rationale: docs/job-board-index-notes.md#n1142-function-discardrest-rs-array-response-n
function discardRest(rs: Array<Response | null>, from: number): void {
  for (let k = from; k < rs.length; k++) discardBody(rs[k]);
}

// Rationale: docs/job-board-index-notes.md#n1143-const-isoversize-e-unknown-string-e
/** The byte bound refusing a body — declared length or running total. */
const isOversize = (e: unknown) => String((e as Error)?.message ?? e).includes(OVERSIZE_MARKER);

// Rationale: docs/job-board-index-notes.md#n1144-function-chunkpagerefusal-e-unknown-isfi
function chunkPageRefusal(e: unknown, isFirstPage: boolean): null {
  if (!isFirstPage && isOversize(e)) return null;
  throw e;
}

async function readChunkPage(res: Response): Promise<{ body: unknown; over: boolean; late?: Error }> {
  try {
    return { body: await boundBody(res, MAX_RESPONSE_BYTES).json(), over: false };
  } catch (e) {
    if (isOversize(e)) return { body: undefined, over: true };
    // A body past its clock (bodyDeadline): the walk's first page throws it as a timeout, a later page ends the walk.
    if (isLate(e)) return { body: undefined, over: false, late: e as Error };
    return { body: undefined, over: false };
  }
}

// The body's clock (S8-030): FETCH_TIMEOUT_MS covers only the wait for headers.
// Rationale: docs/job-board-index-notes.md#n438-a-body-has-a-clock
const BODY_LATE_MARKER = "BODY_DEADLINE";
const isLate = (e: unknown) => String((e as Error)?.message ?? e).includes(BODY_LATE_MARKER);
function bodyDeadline(res: Response, ms: number): Response {
  const body = res.body;
  if (!body || ms <= 0 || res.status === 204 || res.status === 205 || res.status === 304) return res;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clocked = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    start(ctrl) {
      // Erroring the stream cancels the source body, so the connection is released (as boundBody's bound does).
      timer = setTimeout(() => { try { ctrl.error(new Error(`${BODY_LATE_MARKER}: body not finished ${ms}ms after its headers (deadline)`)); } catch { /* already done */ } }, ms);
    },
    flush() { clearTimeout(timer); },
  }));
  const out = new Response(clocked, { status: res.status, statusText: res.statusText, headers: res.headers });
  try { Object.defineProperty(out, "url", { value: res.url || "", configurable: true }); } catch { /* diagnostics only */ }
  return out;
}

// Rationale: docs/job-board-index-notes.md#n1145-function-boundbody-src-response-request
function boundBody(src: Response | Request, limit = MAX_RESPONSE_BYTES): Response {
  const declared = Number(src.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    discardBody(src);
    throw new Error(`${OVERSIZE_MARKER} declared ${declared} > ${limit}`);
  }
  const status = (src as Response).status || 200;
  const body = src.body;
  // 204/205/304 may not carry a body at all; constructing one with a stream
  // throws. Nothing to bound either way.
  if (!body || status === 204 || status === 205 || status === 304) return src as Response;
  let seen = 0;
  const bounded = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        seen += chunk.byteLength;
        if (seen > limit) {
          ctrl.error(new Error(`${OVERSIZE_MARKER} streamed ${seen} > ${limit}`));
          return;
        }
        ctrl.enqueue(chunk);
      },
    }),
  );
  const out = new Response(bounded, { status, statusText: (src as Response).statusText || "", headers: src.headers });
  // Rationale: docs/job-board-index-notes.md#n499-try
  try {
    Object.defineProperty(out, "url", { value: (src as Response).url || "", configurable: true });
  } catch { /* diagnostics only — never worth failing a fetch over */ }
  return out;
}

async function fetchWithTimeout(url: string, init?: RequestInit, limit = MAX_RESPONSE_BYTES, bodyMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const send = async (lang: Record<string, string>) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)", ...lang, ...(init?.headers ?? {}) },
      });
    } finally {
      clearTimeout(t);
    }
    return bodyDeadline(res, bodyMs);
  };
  // Workday: English only where the runtime's language is refused (S8-003, n437).
  const once = () => withWorkdayLanguage(url, init?.headers, send, discardBody);
  const res = await once();
  // Rationale: docs/job-board-index-notes.md#n500-if-res-status
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 4000) : 1500;
    // The 429's own body is never read. Release it rather than leave the
    // connection hanging while we sleep out the Retry-After.
    discardBody(res);
    await new Promise((r) => setTimeout(r, waitMs));
    return boundBody(await once(), limit);
  }
  return boundBody(res, limit);
}

// Rationale: docs/job-board-index-notes.md#n501-async-function-fetchpersonio-s-jobsource
async function fetchPersonio(s: JobSource): Promise<{ xml: string; host: string }> {
  // Rationale: docs/job-board-index-notes.md#n023-for-const-host-of-jobs-personio-de-jobs-pe
  for (const host of ["jobs.personio.de", "jobs.personio.com"]) {
    try {
      const res = await fetchWithTimeout(`https://${s.token}.${host}/xml`);
      if (res.ok) {
        const xml = await res.text();
        if (xml.includes("<workzag-jobs") || xml.includes("<position")) return { xml, host };
      } else discardBody(res);
    } catch (e) {
      // Rationale: docs/job-board-index-notes.md#n024-string-e-as-error-message-e-inclu
      if (String((e as Error)?.message ?? e).includes(OVERSIZE_MARKER)) throw e;
      /* otherwise: try the other host */
    }
  }
  throw new Error("personio feed unavailable on .de/.com");
}

/** Fetch + normalize one board. Returns null on failure (caller decides). */
// Rationale: docs/job-board-index-notes.md#n502-const-rippling_page_cap
const RIPPLING_PAGE_CAP = 10;
// Rationale: docs/job-board-index-notes.md#n503-async-function-fetchrippling-s-jobsource
async function fetchRippling(s: JobSource, startOffset = 0): Promise<{ items: unknown[]; raw: string; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  const RIPPLING_PER_PAGE = 20;
  const startPage = Math.max(0, Math.floor(startOffset / RIPPLING_PER_PAGE));
  const pageUrl = (p: number) => `https://ats.rippling.com/${s.token}/jobs${p ? `?page=${p}` : ""}`;
  const first = await fetchWithTimeout(pageUrl(startPage));
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  const html = await first.text();
  const page0 = extractRipplingJobPosts(html);
  if (!page0) throw new Error("rippling payload shape unrecognized");
  const items = [...page0.items];
  const totalPages = Math.max(1, page0.totalPages);
  // Walk at most RIPPLING_PAGE_CAP pages from wherever we started.
  const lastPage = Math.min(totalPages, startPage + RIPPLING_PAGE_CAP);
  let ranOut = items.length === 0;
  // A later page that fails or will not parse (a 200 bot wall) is a window, not
  // the feed ending; only a parsed, empty page is (register L13-54).
  let brokeAt = -1;
  for (let p = startPage + 1; p < lastPage; p++) {
    const res = await fetchWithTimeout(pageUrl(p));
    if (!res.ok) { discardBody(res); brokeAt = p; break; }
    const more = extractRipplingJobPosts(await res.text());
    if (!more) { brokeAt = p; break; }
    if (more.items.length === 0) { ranOut = true; break; }
    items.push(...more.items);
  }
  const broke = brokeAt >= 0;
  const reachedEnd = !broke && (ranOut || lastPage >= totalPages);
  const feedTotal = totalPages * RIPPLING_PER_PAGE; // pages is all the vendor tells us
  // Windowed boards resume at the broken page; one inside the cap restarts at the top.
  const brokeResume = startPage > 0 || totalPages > RIPPLING_PAGE_CAP ? brokeAt * RIPPLING_PER_PAGE : 0;
  return {
    items,
    raw: html,
    // A board inside the cap read from the top, all the way down, is read
    // whole, so absence IS provable and the prune must stay on for it.
    windowed: totalPages > RIPPLING_PAGE_CAP || startPage > 0 || broke,
    feedTotal,
    nextOffset: broke ? brokeResume : reachedEnd ? 0 : lastPage * RIPPLING_PER_PAGE,
    // Rationale: docs/job-board-index-notes.md#n025-feedended-ranout
    feedEnded: ranOut,
    endOffset: startPage * RIPPLING_PER_PAGE + items.length,
  };
}

// Rationale: docs/job-board-index-notes.md#n026-fetchpaylocity
async function fetchPaylocity(s: JobSource): Promise<{ items: unknown[]; raw: string }> {
  const res = await fetchWithTimeout(`https://recruiting.paylocity.com/recruiting/jobs/All/${s.token}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const page = extractPaylocityPageData(html);
  if (!page) throw new Error("paylocity payload shape unrecognized");
  return { items: page.items, raw: html };
}

// Rationale: docs/job-board-index-notes.md#n504-const-ukg_page
const UKG_PAGE = 50;
const UKG_PAGE_CAP = 12; // 12 × 50 = 600 postings/board/pass
const UKG_CHUNK = 4;     // same politeness ceiling as oracle/icims/adp
async function fetchUkg(s: JobSource): Promise<{ items: unknown[]; raw: unknown; windowed: boolean; feedTotal: number }> {
  const parts = ukgBoardParams(s.token);
  if (!parts) throw new Error("bad ukg token");
  const url = `https://${parts.pod}.ultipro.com/${parts.tenant}/JobBoard/${parts.board}/JobBoardView/LoadSearchResults`;
  const pageCap = Math.max(1, s.pages ?? UKG_PAGE_CAP);
  const all: unknown[] = [];
  let feedTotal = 0;
  let exhausted = false;
  outer: for (let start = 0; start < pageCap; start += UKG_CHUNK) {
    const pages: number[] = [];
    for (let p = start; p < Math.min(start + UKG_CHUNK, pageCap); p++) pages.push(p);
    // Rationale: docs/job-board-index-notes.md#n505-const-responses-await-promise-all-pages
    const responses = await Promise.all(pages.map(async (page) => {
      try {
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ opportunitySearch: { Top: UKG_PAGE, Skip: page * UKG_PAGE, QueryString: "", OrderBy: [], Filters: [] } }),
        });
        if (!res.ok) { discardBody(res); if (page === 0) throw new Error(`HTTP ${res.status}`); return null; }
        return res;
      } catch (e) { return chunkPageRefusal(e, page === 0); }
    }));
    let read = 0;
    try {
      for (let i = 0; i < responses.length; i++) {
        const res = responses[i];
        read = i + 1;
        if (res === null) break outer; // mid-walk HTTP failure — keep what we have
        const { body, over, late } = await readChunkPage(res);
        if (late && all.length === 0) throw late;
        if (over) { if (all.length === 0) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${pages[i]}`); break outer; }
        const ops = (body as { opportunities?: unknown[] } | undefined)?.opportunities;
        // A 200 that is not the opportunity envelope is drift or a bot-wall: a
        // FAILED fetch, never an empty board. Only page 0 can prove the shape.
        if (!Array.isArray(ops)) {
          if (pages[i] === 0) throw new Error("ukg payload shape unrecognized");
          break outer;
        }
        if (pages[i] === 0) feedTotal = Number((body as { totalCount?: number }).totalCount ?? 0) || 0;
        all.push(...ops);
        if (ops.length < UKG_PAGE) { exhausted = true; break outer; } // feed ran out
      }
    } finally { discardRest(responses, read); }
  }
  // Same refusal guard as every other vendor: an empty read against a non-zero
  // advertised total is a rate-limit or a bot-wall, not an empty board.
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  return { items: all, raw: { opportunities: all }, windowed: !exhausted, feedTotal };
}

// Rationale: docs/job-board-index-notes.md#n027-adp-page
const ADP_PAGE = 20;
const ADP_PAGE_CAP = 15; // 15 × 20 = 300 postings/board/pass
// Four concurrent page fetches per board, matching the census tooling's
// politeness ceiling — same chunking rationale as oracle and icims.
const ADP_CHUNK = 4;
async function fetchAdp(s: JobSource): Promise<{ items: unknown[]; raw: unknown; windowed: boolean; feedTotal: number }> {
  const { cid, ccId } = adpBoardParams(s.token);
  if (!cid) throw new Error("bad adp token");
  const base = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions";
  const pageUrl = (p: number) =>
    `${base}?cid=${cid}&ccId=${ccId}&timeStamp=${Date.now()}&lang=en_US&locale=en_US&$top=${ADP_PAGE}&$skip=${1 + p * ADP_PAGE}`;
  const pageCap = Math.max(1, s.pages ?? ADP_PAGE_CAP);
  const all: unknown[] = [];
  let feedTotal = 0;
  let exhausted = false;
  outer: for (let start = 0; start < pageCap; start += ADP_CHUNK) {
    const pages: number[] = [];
    for (let p = start; p < Math.min(start + ADP_CHUNK, pageCap); p++) pages.push(p);
    // Fetch concurrently, read one at a time — see MAX_RESPONSE_BYTES.
    const responses = await Promise.all(pages.map(async (page) => {
      try {
        const res = await fetchWithTimeout(pageUrl(page), { headers: { Accept: "application/json" } });
        if (!res.ok) { discardBody(res); if (page === 0) throw new Error(`HTTP ${res.status}`); return null; }
        return res;
      } catch (e) { return chunkPageRefusal(e, page === 0); }
    }));
    let read = 0;
    try {
      for (let i = 0; i < responses.length; i++) {
        const res = responses[i];
        read = i + 1;
        if (res === null) break outer; // mid-walk HTTP failure — keep what we have
        // undefined = body unreadable, distinct from a mid-walk HTTP miss; `over`
        // = the byte bound aborted it, which ends the walk, never fails the board.
        const { body, over, late } = await readChunkPage(res);
        if (late && all.length === 0) throw late;
        if (over) { if (all.length === 0) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${pages[i]}`); break outer; }
        const reqs = (body as { jobRequisitions?: unknown[] } | undefined)?.jobRequisitions;
        // Rationale: docs/job-board-index-notes.md#n506-if-array-isarray-reqs
        if (!Array.isArray(reqs)) {
          if (pages[i] === 0) throw new Error("adp payload shape unrecognized");
          break outer;
        }
        if (pages[i] === 0) feedTotal = Number((body as { meta?: { totalNumber?: number } }).meta?.totalNumber ?? 0) || 0;
        all.push(...reqs);
        if (reqs.length < ADP_PAGE) { exhausted = true; break outer; } // feed ran out
      }
    } finally { discardRest(responses, read); }
  }
  // Rationale: docs/job-board-index-notes.md#n507-if-all-length-feedtotal-throw-new
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  return { items: all, raw: { jobRequisitions: all }, windowed: !exhausted, feedTotal };
}

// Rationale: docs/job-board-index-notes.md#n028-
// Rationale: docs/job-board-index-notes.md#n1146-const-max_postings_per_visit
// MEASURED AT LAST: ~105KB OF HEAP PER POSTING HELD.
//
// The .40 breadcrumbs finally caught a slice at the moment it died, and the
// number that matters was never the board count:
//     hop 0 · boardsDone 8 · fetched 2,002 postings · heap 206MB · 11.2s
// Eight boards — but one of them returned the whole per-visit cap, and 2,002
// postings in flight cost 206MB against a ceiling near 256. The isolate was
// killed by ONE board, not by eight.
//
// That reconciles every earlier reading. Board count never predicted death
// because a slice of 24 small boards is cheap and a slice of 8 containing one
// giant is fatal; heap at death ranged 70-206MB because it tracks postings
// held, not boards processed; and the posting budget could never fire because
// 12,000 postings is ~1.2GB, five times the ceiling — a bound written in the
// right unit and set an order of magnitude too high to ever bind.
//
// 400 caps one board's contribution at roughly 41MB, which leaves room for the
// others in flight. A board with more than 600 postings is not truncated: it
// returns nextOffset and resumes exactly where it stopped on its next visit,
// which is the mechanism the deep lane has always used.
const MAX_POSTINGS_PER_VISIT = 250;

// Rationale: docs/job-board-index-notes.md#n1147-type-lapstate
type LapState = {
  // Rationale: docs/job-board-index-notes.md#n1148-e-number
  e: number;
  // Rationale: docs/job-board-index-notes.md#n1149-s-number
  s: number;
  /** When the lap opened (ours, not any employer date). */
  t: string;
  /** 1 = an epoch write failed somewhere in this lap, so it can never prove absence. */
  f: 0 | 1;
  // Rationale: docs/job-board-index-notes.md#n1150-t0-number
  t0: number;
  /** When this board last COMPLETED a provable lap. Absent = it never has. */
  w?: string;
  // Rationale: docs/job-board-index-notes.md#n1151-w0-string
  w0?: string;
};

// Rationale: docs/job-board-index-notes.md#n1152-const-lap_coverage_min
const LAP_COVERAGE_MIN = 0.9;

// Rationale: docs/job-board-index-notes.md#n1153-const-lap_tail_slack
const LAP_TAIL_SLACK = 100;

/** fit-batch bounds — see the action. 20 ids survives the shared worker pool; 60 did not. */
const FIT_BATCH_MAX = 20;
const FIT_DESC_CHARS = 20_000;

const WORKDAY_PAGE_CAP = 25; // 25 × 20 = up to 500 postings/board/pass
// Oracle CE REST accepts a larger page than Workday; 20 × 100 = up to 2000
// postings/board/pass, which exhausts every tenant in the first tranche.
const ORACLE_PAGE_SIZE = 100;
const ORACLE_PAGE_CAP = 20;
// Rationale: docs/job-board-index-notes.md#n508-const-oracle_site_rank-readonlymap-strin
const ORACLE_SITE_RANK: ReadonlyMap<string, number> = rankOracleSites(JOB_SOURCES, ORACLE_CANONICAL_SITES);
// Rationale: docs/job-board-index-notes.md#n509-let-oraclereqkeymissinguntil
let oracleReqKeyMissingUntil = 0;
const ORACLE_REQ_KEY_BACKOFF_MS = 10 * 60_000;
// Rationale: docs/job-board-index-notes.md#n029-fetchworkday
async function fetchWorkday(s: JobSource, startOffset = 0): Promise<{ jobPostings: unknown[]; raw: unknown; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  const [tenant, dc, site] = s.token.split("~");
  if (!tenant || !dc || !site) throw new Error("bad workday token");
  const url = `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const all: unknown[] = [];
  let feedTotal = 0;
  let exhausted = false;
  // Rationale: docs/job-board-index-notes.md#n510-const-workdaypagecap-math-max-s-pages
  const workdayPageCap = Math.max(1, s.pages ?? WORKDAY_PAGE_CAP);
  const WORKDAY_CHUNK = 4;
  outer: for (let start = 0; start < workdayPageCap; start += WORKDAY_CHUNK) {
    const pages: number[] = [];
    for (let p = start; p < Math.min(start + WORKDAY_CHUNK, workdayPageCap); p++) pages.push(p);
    // Fetch concurrently, read one at a time — see MAX_RESPONSE_BYTES.
    const responses = await Promise.all(pages.map(async (page) => {
      try {
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ limit: 20, offset: startOffset + page * 20, searchText: "", appliedFacets: {} }),
        });
        if (!res.ok) { discardBody(res); if (page === 0) throw new Error(`HTTP ${res.status}`); return null; }
        return res;
      } catch (e) { return chunkPageRefusal(e, page === 0); }
    }));
    let read = 0;
    try {
      for (let i = 0; i < responses.length; i++) {
        const res = responses[i];
        read = i + 1;
        if (res === null) break outer; // mid-walk HTTP failure — keep what we have
        const { body, over, late } = await readChunkPage(res);
        if (late && all.length === 0) throw late;
        if (over) { if (all.length === 0) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${pages[i]}`); break outer; }
        // Rationale: docs/job-board-index-notes.md#n511-if-body-undefined
        if (body === undefined) {
          if (pages[i] === 0) throw new Error("workday payload unreadable");
          break outer;
        }
        if (pages[i] === 0) feedTotal = Number((body as { total?: number }).total ?? 0) || 0;
        const items = Array.isArray((body as { jobPostings?: unknown[] }).jobPostings) ? (body as { jobPostings: unknown[] }).jobPostings : [];
        all.push(...items);
        if (items.length < 20) { exhausted = true; break outer; } // last page — wrap next pass
        // Rationale: docs/job-board-index-notes.md#n512-if-all-length-max_postings_per_visit-bre
        if (all.length >= MAX_POSTINGS_PER_VISIT) break outer;
      }
    } finally { discardRest(responses, read); }
  }
  // Empty page with a non-zero advertised total = the tenant refused/failed us
  // (rate-limit, transient) — NOT an empty board. Throwing marks the board
  // failed so nothing is pruned. Without this, persistent empty responses
  // eventually pass the two-pass + shrink-ratchet guards and delete the whole
  // board (live case: Four Seasons pruned to 0 while advertising 1,963 jobs).
  // Past the top an empty page wraps instead: the feed ended before the
  // cursor, or will not serve that deep (n420).
  const empty = emptyFirstPage(startOffset, all.length, feedTotal);
  if (empty === "refused") throw new Error(`empty page but total=${feedTotal}`);
  if (empty) exhausted = empty === "ended";
  // Rationale: docs/job-board-index-notes.md#n030-advanced
  const advanced = startOffset + all.length;
  const nextOffset = exhausted || empty === "restart" || (feedTotal > 0 && advanced >= feedTotal) ? 0 : advanced;
  // Rationale: docs/job-board-index-notes.md#n031-return-jobpostings-all-raw-jobpostings-a
  // Rationale: docs/job-board-index-notes.md#n413-workday-total-past-offset-zero
  return { jobPostings: all, raw: { jobPostings: all }, windowed: workdayWindowed(startOffset, feedTotal, all.length, exhausted), feedTotal, nextOffset, feedEnded: exhausted, endOffset: advanced };
}

// Rationale: docs/job-board-index-notes.md#n032-fetchoracle
async function fetchOracle(s: JobSource, startOffset = 0): Promise<{ items: unknown[]; raw: unknown; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  const [tenant, region, site] = s.token.split("~");
  if (!tenant || !region || !site) throw new Error("bad oracle token");
  const base = `https://${tenant}.fa.${region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
  const all: unknown[] = [];
  let feedTotal = 0;
  // Rationale: docs/job-board-index-notes.md#n513-let-exhausted-false
  let exhausted = false;
  // Rationale: docs/job-board-index-notes.md#n514-const-oraclepagecap-math-max-s-pages
  const oraclePageCap = Math.max(1, s.pages ?? ORACLE_PAGE_CAP);
  // Rationale: docs/job-board-index-notes.md#n033-oracle-chunk
  const ORACLE_CHUNK = 4;
  outer: for (let start = 0; start < oraclePageCap; start += ORACLE_CHUNK) {
    const pages: number[] = [];
    for (let p = start; p < Math.min(start + ORACLE_CHUNK, oraclePageCap); p++) pages.push(p);
    // Fetch concurrently, read one at a time — see MAX_RESPONSE_BYTES.
    const responses = await Promise.all(pages.map(async (page) => {
      try {
        const finder = `findReqs;siteNumber=${site},limit=${ORACLE_PAGE_SIZE},offset=${startOffset + page * ORACLE_PAGE_SIZE},sortBy=POSTING_DATES_DESC`;
        const res = await fetchWithTimeout(`${base}?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`);
        if (!res.ok) { discardBody(res); if (page === 0) throw new Error(`HTTP ${res.status}`); return null; }
        return res;
      } catch (e) { return chunkPageRefusal(e, page === 0); }
    }));
    let read = 0;
    try {
      for (let i = 0; i < responses.length; i++) {
        const res = responses[i];
        read = i + 1;
        if (res === null) break outer; // mid-walk HTTP failure — keep what we have, same as the serial loop's break
        const { body, over, late } = await readChunkPage(res);
        if (late && all.length === 0) throw late;
        if (over) { if (all.length === 0) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${pages[i]}`); break outer; }
        if (body === undefined) {
          if (pages[i] === 0) throw new Error("oracle payload unreadable");
          break outer;
        }
        const item = (Array.isArray((body as { items?: unknown[] }).items) ? (body as { items: Record<string, unknown>[] }).items[0] : null) ?? null;
        if (!item) { exhausted = true; break outer; }
        if (pages[i] === 0) feedTotal = Number(item.TotalJobsCount ?? 0) || 0;
        const reqs = Array.isArray(item.requisitionList) ? item.requisitionList as unknown[] : [];
        all.push(...reqs);
        if (reqs.length < ORACLE_PAGE_SIZE) { exhausted = true; break outer; } // last page
        // Same ceiling, same reason, same resume contract as Workday above.
        if (all.length >= MAX_POSTINGS_PER_VISIT) break outer;
      }
    } finally { discardRest(responses, read); }
  }
  // Rationale: docs/job-board-index-notes.md#n515-const-empty-emptyfirstpage-startoffset-a
  const empty = emptyFirstPage(startOffset, all.length, feedTotal);
  if (empty === "refused") throw new Error(`empty page but total=${feedTotal}`);
  if (empty) exhausted = empty === "ended";
  const advancedOr = startOffset + all.length;
  const nextOffset = exhausted || empty === "restart" || (feedTotal > 0 && advancedOr >= feedTotal) ? 0 : advancedOr;
  // Rationale: docs/job-board-index-notes.md#n034-return-items-all-raw-items-all-window
  return { items: all, raw: { items: all }, windowed: !exhausted || startOffset > 0, feedTotal, nextOffset, feedEnded: exhausted, endOffset: advancedOr };
}

/** iCIMS page sizes, largest first: a first page over the byte bound is retried smaller (n414). */
const ICIMS_PAGE_SIZES: readonly number[] = [100, 50, 25];
const ICIMS_SIZE_HINT = new Map<string, number>();

// Rationale: docs/job-board-index-notes.md#n516-async-function-fetchicims-s-jobsource-st
async function fetchIcims(s: JobSource, startOffset: number, pageSize: number): Promise<{ items: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  const ICIMS_MAX_PAGES = Math.max(1, s.pages ?? 12), ICIMS_CHUNK = 5;
  const startPage = Math.floor(startOffset / pageSize) + 1;
  // Where the first page really starts: a cursor from another page size may fall inside one.
  const base = (startPage - 1) * pageSize;
  const lastPage = startPage + ICIMS_MAX_PAGES - 1;
  const all: unknown[] = [];
  let feedTotal = 0, exhausted = false;
  // Rationale: docs/job-board-index-notes.md#n517-const-fetchpage-async-page-number
  const fetchPage = async (page: number) => {
    try {
      const res = await fetchWithTimeout(`https://${s.token}/api/jobs?page=${page}&limit=${pageSize}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) { discardBody(res); throw new Error(`HTTP ${res.status}`); }
      return res;
    } catch (e) { return chunkPageRefusal(e, page === startPage); }
  };
  outer: for (let start = startPage; start <= lastPage; start += ICIMS_CHUNK) {
    const pages: number[] = [];
    for (let p = start; p <= Math.min(start + ICIMS_CHUNK - 1, lastPage); p++) pages.push(p);
    const responses = await Promise.all(pages.map(fetchPage));
    let read = 0;
    try {
      for (let i = 0; i < responses.length; i++) {
        read = i + 1;
        // null = a page refused before it could be read (see
        // chunkPageRefusal) — end the walk with what landed.
        if (responses[i] === null) break outer;
        const { body, over, late } = await readChunkPage(responses[i]!);
        if (late && all.length === 0) throw late;
        // Rationale: docs/job-board-index-notes.md#n518-if-over-if-all-length-throw
        if (over) { if (all.length === 0) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${pages[i]}`); break outer; }
        const page = body as { jobs?: unknown[]; totalCount?: number } | undefined;
        if (!page) { if (all.length === 0) throw new Error("icims payload unreadable"); break outer; }
        const batch = Array.isArray(page.jobs) ? page.jobs! : [];
        if (feedTotal === 0) feedTotal = Number(page.totalCount) || 0; // first page fetched, whichever it is
        all.push(...batch);
        // A short page inside a chunk ends the walk — later chunk members
        // past the end return empty and must not be treated as data.
        if (batch.length < pageSize) { exhausted = true; break outer; }
        // Memory ceiling, not end-of-feed: `exhausted` stays false so
        // nextOffset resumes here rather than wrapping to the top.
        if (all.length >= MAX_POSTINGS_PER_VISIT) break outer;
      }
    } finally { discardRest(responses, read); }
  }
  // Rationale: docs/job-board-index-notes.md#n519-const-empty-emptyfirstpage-base-all-leng
  const empty = emptyFirstPage(base, all.length, feedTotal);
  if (empty === "refused") throw new Error(`empty page but total=${feedTotal}`);
  if (empty) exhausted = empty === "ended";
  const advancedIc = base + all.length;
  const nextOffset = exhausted || empty === "restart" || (feedTotal > 0 && advancedIc >= feedTotal) ? 0 : advancedIc;
  // A resumed read is windowed by definition — see the note in fetchOracle.
  return { items: all, windowed: !exhausted || startOffset > 0, feedTotal, nextOffset, feedEnded: exhausted, endOffset: advancedIc };
}

// Rationale: docs/job-board-index-notes.md#n1154-async-function-fetchicimssized-s-jobsour
async function fetchIcimsSized(s: JobSource, startOffset: number): Promise<Awaited<ReturnType<typeof fetchIcims>> & { pageSize: number }> {
  let hint = ICIMS_PAGE_SIZES.indexOf(ICIMS_SIZE_HINT.get(s.token) ?? ICIMS_PAGE_SIZES[0]);
  if (hint < 0) hint = 0;
  for (let k = hint; ; k++) {
    try {
      const r = await fetchIcims(s, startOffset, ICIMS_PAGE_SIZES[k]);
      if (k !== hint) ICIMS_SIZE_HINT.set(s.token, ICIMS_PAGE_SIZES[k]);
      return { ...r, pageSize: ICIMS_PAGE_SIZES[k] };
    } catch (e) {
      if (!isOversize(e) || k + 1 >= ICIMS_PAGE_SIZES.length) throw e;
      console.warn(`[JOB-BOARD] icims ${s.token}: page of ${ICIMS_PAGE_SIZES[k]} over the byte bound — retrying at ${ICIMS_PAGE_SIZES[k + 1]}`);
    }
  }
}

// Rationale: docs/job-board-index-notes.md#n1155-const-usajobs_result_cap-_000
const USAJOBS_RESULT_CAP = 10_000;

// Rationale: docs/job-board-index-notes.md#n520-async-function-fetchusajobs-s-jobsource
async function fetchUsajobs(s: JobSource, startOffset: number, key: string, ua: string): Promise<{ items: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  const PAGE = 100, MAX_PAGES = Math.max(1, s.pages ?? 40);
  const startPage = Math.floor(startOffset / PAGE) + 1;
  const base = (startPage - 1) * PAGE;
  // Past the deepest page the API serves nothing is asked: the walk restarts
  // the lap below without claiming the feed's end (n420).
  const pastCap = base >= USAJOBS_RESULT_CAP;
  const lastPage = pastCap ? startPage - 1 : Math.min(startPage + MAX_PAGES - 1, USAJOBS_RESULT_CAP / PAGE);
  const all: unknown[] = [];
  let feedTotal = 0, exhausted = false;
  for (let page = startPage; page <= lastPage; page++) {
    const first = page === startPage;
    const url = `https://data.usajobs.gov/api/search?ResultsPerPage=${PAGE}&Page=${page}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        headers: { Host: "data.usajobs.gov", "User-Agent": ua, "Authorization-Key": key },
      });
    } catch (e) { if (chunkPageRefusal(e, first) === null) break; throw e; }
    if (!res.ok) { discardBody(res); if (first) throw new Error(`HTTP ${res.status}`); break; }
    const { body, over, late } = await readChunkPage(res);
    if (late && first) throw late;
    if (over) { if (first) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${page}`); break; }
    const sr = (body as { SearchResult?: { SearchResultCountAll?: number; SearchResultItems?: unknown[] } } | undefined)?.SearchResult;
    if (!sr) { if (first) throw new Error("usajobs payload unreadable"); break; }
    const batch = Array.isArray(sr.SearchResultItems) ? sr.SearchResultItems : [];
    if (first) feedTotal = Number(sr.SearchResultCountAll) || 0;
    all.push(...batch);
    if (batch.length < PAGE) { exhausted = true; break; }
    // Memory ceiling, not end-of-feed: resume here next visit.
    if (all.length >= MAX_POSTINGS_PER_VISIT) break;
  }
  // From the top, an empty read against a stated total is a refusal; past it,
  // the feed ended before the cursor or will not serve that deep (n420).
  const empty = pastCap ? "restart" : emptyFirstPage(base, all.length, feedTotal);
  if (empty === "refused") throw new Error(`empty page but total=${feedTotal}`);
  if (empty) exhausted = empty === "ended";
  const advancedUs = base + all.length;
  const nextOffset = exhausted || empty === "restart" || advancedUs >= USAJOBS_RESULT_CAP || (feedTotal > 0 && advancedUs >= feedTotal) ? 0 : advancedUs;
  return { items: all, windowed: !exhausted || startOffset > 0, feedTotal, nextOffset, feedEnded: exhausted, endOffset: advancedUs };
}

/** Items on one page of a Teamtailor jobs.rss; `?offset=N` pages it (S8-002). */
const TT_PAGE = 100;
// A page of exactly TT_PAGE is never the whole board. Rationale: docs/job-board-index-notes.md#n439-teamtailor-pages
async function fetchTeamtailor(s: JobSource, startOffset = 0): Promise<{ jobs: JobPosting[]; raw: string; windowed: boolean; feedTotal?: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  const url = listUrl(s);
  // Whole pages inside the visit's reservation (MAX_POSTINGS_PER_VISIT): two.
  const pageCap = Math.max(1, Math.min(s.pages ?? Infinity, Math.floor(MAX_POSTINGS_PER_VISIT / TT_PAGE)));
  const jobs: JobPosting[] = [];
  const pages: string[] = [];
  const seen = new Set<string>();
  let read = 0, ended = false, ignored = false;
  for (let p = 0; p < pageCap; p++) {
    const offset = startOffset + p * TT_PAGE;
    let rss: string;
    try {
      const res = await fetchWithTimeout(offset ? `${url}?offset=${offset}` : url);
      if (!res.ok) { discardBody(res); throw new Error(`HTTP ${res.status}`); }
      rss = await res.text();
    } catch (e) {
      if (p === 0) throw e;
      break; // a later page refused (403 when throttled) or late: a window
    }
    // A 200 that is not the feed (a bot wall) is a failed fetch, never an empty board or the feed's end.
    if (!/<channel[\s>]/.test(rss)) { if (p === 0) throw new Error("teamtailor answer is not an RSS channel"); break; }
    const count = xmlBlocks(rss, "item").length;
    const batch = normalizeTeamtailor(rss, s.name, s.token);
    // A host that ignores ?offset serves its first page again.
    if (p > 0 && batch.length > 0 && batch.every((j) => seen.has(j.id))) { ignored = true; break; }
    for (const j of batch) seen.add(j.id);
    jobs.push(...batch);
    pages.push(rss);
    read += count;
    if (count < TT_PAGE) { ended = true; break; }
    if (jobs.length >= MAX_POSTINGS_PER_VISIT) break;
  }
  const endOffset = startOffset + read;
  return {
    jobs,
    raw: pages.join("\n"),
    windowed: ignored || !ended || startOffset > 0,
    // The feed states no total; where a resumed walk found its end is the lap's measure (lapTotal). From the top, none (n130).
    feedTotal: ended && startOffset > 0 ? endOffset : undefined,
    nextOffset: ended || ignored ? 0 : endOffset,
    feedEnded: ended,
    endOffset,
  };
}

// Rationale: docs/job-board-index-notes.md#n411-streamed-oversize-read
async function readOversizeBoard(s: JobSource, deadlineAt: number, freshCutoffMs: number): Promise<{ jobs: JobPosting[]; raw: unknown } | null> {
  const spec = SLIM_SPECS[s.source];
  if (!spec) return null;
  try {
    const res = await beforeDeadline(fetchWithTimeout(listUrl(s), undefined, STREAM_WIRE_BYTES, STREAM_READ_BUDGET_MS), deadlineAt, discardBody);
    if (!res.ok || !res.body || !/json/i.test(res.headers.get("content-type") ?? "")) {
      discardBody(res);
      throw new Error(`HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`);
    }
    const { raw, stats } = await streamSlim(res.body, spec, {
      freshCutoffMs,
      maxBytes: SLIM_RETAINED_BYTES,
      maxElementBytes: SLIM_ELEMENT_BYTES,
      descKeepChars: 2 * STORED_DESC_CAP,
      descCeiling: SLIM_DESC_CEILING,
      deadlineAt,
    });
    const jobs = s.source === "lever" ? normalizeLever(raw as never, s.name, s.token)
      : s.source === "ashby" ? normalizeAshby(raw as never, s.name, s.token)
      : s.source === "greenhouse" ? normalizeGreenhouse(raw as never, s.name, s.token)
      : null;
    if (!jobs) throw new Error(`no normaliser for ${s.source}`);
    console.warn(`[JOB-BOARD] streamed ${s.source}:${s.token}: ${(stats.bytes / 1e6).toFixed(1)}MB read, ${(stats.slimBytes / 1e6).toFixed(1)}MB kept, ${stats.descDropped} description(s) dropped`);
    return { jobs, raw };
  } catch (e) {
    console.warn(`[JOB-BOARD] streamed read of ${s.source}:${s.token} failed, stays deferred:`, String((e as Error)?.message ?? e).slice(0, 120));
    return null;
  }
}

// Rationale: docs/job-board-index-notes.md#n521-async-function-fetchboard
async function fetchBoard(
  s: JobSource,
  onFail?: (reason: string) => void,
  // Rationale: docs/job-board-index-notes.md#n522-startoffset
  startOffset = 0,
): Promise<{ jobs: JobPosting[]; raw: unknown; windowed?: boolean; feedTotal?: number; nextOffset?: number; feedEnded?: boolean; endOffset?: number } | null> {
  try {
    if (s.source === "oracle") {
      const { items, raw, windowed, feedTotal, nextOffset, feedEnded, endOffset } = await fetchOracle(s, startOffset);
      return { jobs: normalizeOracle(items as never, s.name, s.token), raw, windowed, feedTotal, nextOffset, feedEnded, endOffset };
    }
    if (s.source === "icims") {
      // Rationale: docs/job-board-index-notes.md#n035-icims-page
      const r = await fetchIcimsSized(s, startOffset);
      return { jobs: normalizeIcims(r.items as never, s.name, s.token), raw: { items: r.items }, windowed: r.windowed, feedTotal: r.feedTotal, nextOffset: r.nextOffset, feedEnded: r.feedEnded, endOffset: r.endOffset };
    }
    if (s.source === "usajobs") {
      // Rationale: docs/job-board-index-notes.md#n523-const-key-deno-env-get-usajobs_api_key
      const key = Deno.env.get("USAJOBS_API_KEY") ?? "";
      const ua = Deno.env.get("USAJOBS_USER_AGENT") ?? "";
      if (!key || !ua) {
        console.warn("[JOB-BOARD] usajobs: USAJOBS_API_KEY/USAJOBS_USER_AGENT unset — skipping (not a board failure)");
        return { jobs: [], raw: { items: [] }, windowed: true, feedTotal: 0 };
      }
      const r = await fetchUsajobs(s, startOffset, key, ua);
      return { jobs: normalizeUsajobs(r.items as never, s.name, s.token), raw: { items: r.items }, windowed: r.windowed, feedTotal: r.feedTotal, nextOffset: r.nextOffset, feedEnded: r.feedEnded, endOffset: r.endOffset };
    }
    if (s.source === "rippling") {
      const { items, raw, windowed, feedTotal, nextOffset, feedEnded, endOffset } = await fetchRippling(s, startOffset);
      return { jobs: normalizeRippling(items as never, s.name, s.token), raw, windowed, feedTotal, nextOffset, feedEnded, endOffset };
    }
    if (s.source === "pinpoint") {
      // Rationale: docs/job-board-index-notes.md#n036-pinpointhost
      const pinpointHost = s.token.includes(".") ? s.token : `${s.token}.pinpointhq.com`;
      const res = await fetchWithTimeout(`https://${pinpointHost}/postings.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const data = Array.isArray((body as { data?: unknown[] }).data) ? (body as { data: unknown[] }).data : [];
      return { jobs: normalizePinpoint(data as never, s.name, s.token), raw: body };
    }
    if (s.source === "jazzhr") {
      // HTML career page, one unpaginated list. The adapter owns the parse,
      // the row cap and the notfound-at-200 guard (vendors/jazzhr.ts).
      const { jobs, raw, windowed, feedTotal } = await fetchJazzhr(s, fetchWithTimeout);
      return { jobs, raw, windowed, feedTotal };
    }
    if (s.source === "ukg") {
    const { items, raw, windowed, feedTotal } = await fetchUkg(s);
    return { jobs: normalizeUkg(items as never, s.name, s.token), raw, windowed, feedTotal };
  }
  if (s.source === "paylocity") {
      const { items, raw } = await fetchPaylocity(s);
      return { jobs: normalizePaylocity(items as never, s.name, s.token), raw };
    }
    if (s.source === "adp") {
      const { items, raw, windowed, feedTotal } = await fetchAdp(s);
      return { jobs: normalizeAdp(items as never, s.name, s.token), raw, windowed, feedTotal };
    }
    if (s.source === "workday") {
      const { jobPostings, raw, windowed, feedTotal, nextOffset, feedEnded, endOffset } = await fetchWorkday(s, startOffset);
      return { jobs: normalizeWorkday(jobPostings as never, s.name, s.token), raw, windowed, feedTotal, nextOffset, feedEnded, endOffset };
    }
    // XML vendors first — their raw payload is text, not JSON.
    if (s.source === "personio") {
      const { xml, host } = await fetchPersonio(s);
      return { jobs: normalizePersonio(xml, s.name, s.token, host), raw: xml };
    }
    if (s.source === "teamtailor") return await fetchTeamtailor(s, startOffset);
    const raw = s.source === "smartrecruiters" ? await fetchSmartRecruiters(s, startOffset) : await (async () => {
      const res = await fetchWithTimeout(listUrl(s));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Rationale: docs/job-board-index-notes.md#n037-ct
      const ct = res.headers.get("content-type") ?? "";
      if (!/json/i.test(ct)) {
        const where = (() => { try { return new URL(res.url).pathname; } catch { return res.url; } })();
        throw new Error(
          /login|signin|auth/i.test(where)
            ? `careers list is not public (redirected to ${where})`
            : `non-JSON response (${ct.split(";")[0] || "unknown"}) at ${where}`,
        );
      }
      return await res.json();
    })();
    const jobs =
      s.source === "greenhouse"
        ? normalizeGreenhouse(raw, s.name, s.token)
        : s.source === "lever"
          ? normalizeLever(raw, s.name, s.token)
          : s.source === "ashby"
            ? normalizeAshby(raw, s.name, s.token)
            : s.source === "smartrecruiters"
              ? normalizeSmartRecruiters(raw, s.name, s.token)
              : s.source === "workable"
                ? normalizeWorkable(raw, s.name, s.token)
                : s.source === "recruitee"
                  ? normalizeRecruitee(raw, s.name, s.token)
                  : s.source === "breezy"
                    ? normalizeBreezy(raw, s.name, s.token)
                    : normalizeBambooHR(raw, s.name, s.token);
    // Rationale: docs/job-board-index-notes.md#n524-if-s-source-smartrecruiters
    if (s.source === "smartrecruiters") {
      const sr = raw as { windowed?: boolean; feedTotal?: number; nextOffset?: number; feedEnded?: boolean; endOffset?: number };
      return { jobs, raw, windowed: sr.windowed === true, feedTotal: sr.feedTotal ?? 0, nextOffset: sr.nextOffset, feedEnded: sr.feedEnded === true, endOffset: sr.endOffset };
    }
    return { jobs, raw };
  } catch (e) {
    const raw = String((e as Error)?.message ?? e);
    // Rationale: docs/job-board-index-notes.md#n525-const-http-raw-match-http-d
    const http = raw.match(/HTTP (\d{3})/)?.[1];
    // Rationale: docs/job-board-index-notes.md#n526-const-over-raw-match-oversize_body-w
    const over = raw.match(/OVERSIZE_BODY \w+ (\d+)/);
    const reason = over
      ? `oversize ${(Number(over[1]) / 1e6).toFixed(1)}MB`
      : http
      ? `HTTP ${http}`
      : /abort|timed? ?out|deadline/i.test(raw)
        ? "timeout"
        : /dns|resolve|certificate|tls|connection|network/i.test(raw)
          ? "network"
          : raw.slice(0, 40);
    console.warn(`[JOB-BOARD] board ${s.source}:${s.token} failed:`, raw.slice(0, 100));
    onFail?.(reason);
    return null;
  }
}

// ── refresh: fan-out → upsert → prune (only successful boards) ─────────────

// Rationale: docs/job-board-index-notes.md#n038-interleavebyvendor
const interleaveByVendor = (list: JobSource[]): JobSource[] => {
  const buckets = new Map<string, JobSource[]>();
  for (const s of list) {
    if (!buckets.has(s.source)) buckets.set(s.source, []);
    buckets.get(s.source)!.push(s);
  }
  const out: JobSource[] = [];
  const qs = [...buckets.values()];
  for (let i = 0; out.length < list.length; i++) {
    for (const q of qs) if (q[i]) out.push(q[i]);
  }
  return out;
};
const HOT_SIZE = 120;
const FALLBACK_HOT_LIST = interleaveByVendor(JOB_SOURCES.filter((s) => HOT_TOKENS.has(s.token)));
// Rationale: docs/job-board-index-notes.md#n527-const-fallback_cold_list-interleavebyven
const FALLBACK_COLD_LIST = interleaveByVendor(JOB_SOURCES.filter((s) => !HOT_TOKENS.has(s.token)));

// Rationale: docs/job-board-index-notes.md#n528-async-function-tierlists-client-supabase
async function tierLists(client: SupabaseClient): Promise<{ hotList: JobSource[]; coldList: JobSource[] }> {
  const { data } = await client.from("job_board_meta").select("v").eq("k", "hot_tokens").maybeSingle();
  const tokens = (data?.v as { tokens?: unknown } | null)?.tokens;
  if (!Array.isArray(tokens) || tokens.length < 50) {
    return { hotList: FALLBACK_HOT_LIST, coldList: FALLBACK_COLD_LIST };
  }
  const hot = new Set(tokens.filter((x): x is string => typeof x === "string"));
  return {
    hotList: interleaveByVendor(JOB_SOURCES.filter((s) => hot.has(s.token))),
    coldList: interleaveByVendor(JOB_SOURCES.filter((s) => !hot.has(s.token))),
  };
}
// Rationale: docs/job-board-index-notes.md#n039-cold-slices-per-pass
const COLD_SLICES_PER_PASS = 160;

// Rationale: docs/job-board-index-notes.md#n040-dead-board-threshold
const DEAD_BOARD_THRESHOLD = 6; // consecutive failures before prune + dormancy (unchanged bar from the prior prune)
// Rationale: docs/job-board-index-notes.md#n041-dead-board-min-failing-ms
const DEAD_BOARD_MIN_FAILING_MS = 40 * 60 * 60_000;
const DORMANT_RECHECK_MS = 12 * 60 * 60_000; // recovery probe cadence for a dormant board
const DORMANT_CAP = 8_000; // max tracked dormant boards (raised with the 26k-board catalog — census waves include older-crawl boards that die over time)

// Rationale: docs/job-board-index-notes.md#n042-vendor-zero-trip
const VENDOR_ZERO_TRIP = 0.5; // zero-feed fraction that trips the breaker
const VENDOR_ZERO_RESET = 0.3; // hysteresis: quarantine lifts below this
const VENDOR_MIN_ATTEMPTS = 20; // never judge a vendor on a handful of fetches
const VENDOR_STATS_DECAY = 0.8; // per-slice decay — recent slices dominate

// Experience-band rules version. A bump re-derives EVERY stored row from its
// title and stored description (backfill-experience, progress in
// job_board_meta experience_backfill) and writes the rows whose band or
// minimum changed, "unspecified"/NULL included.
// v2 (S12-013): v1 only filled NULL bands, so the L8-15/L7-09 parser fixes
// reached new rows and nothing else: 0 of 24 stored minimum-age figures
// reproduced, and Domino's served 4,018 Expert rows against 1,359 Entry.
const EXPERIENCE_VERSION = 2;
// Rationale: docs/job-board-index-notes.md#n043-salary-parse-version
const SALARY_PARSE_VERSION = 11; // v11 (S12-019, wave 4 round 2): the miner reads every money range in the text and refuses one whose sentence names a business figure (portfolio, fleet, P&L, worth, costs) unless a pay word stands right before it, preferring a range whose sentence names pay; the re-sweep re-mines a stored mined figure the current rules refuse (minedSalaryRefused), so the £350K-£800K Airbus placement and the portfolio "salaries" leave the pay sort. // v10 (2026-10-09, wave 3 board-data-ingest, docs/wave3/board-data-ingest.md): NT$/AR$/CL$/COL$/RD$/$U and a bare $ in TW/AR/CL/CO/DO/UY are not USD; a figure in millions is no wage; "up to X" alone is no floor; "$17/hr - $38/hr" is a range. // v9 (2026-09-27): A COMMA IS A DECIMAL POINT IN MOST OF EUROPE and the money pattern read it as a thousands group, so the figure split in half: P_RANGE is two money patterns with a dash between them, and on "€14,61 — €14,61" (ouihelp's own greenhouse pay footer) the grouped alternative could not match a 2-digit group, the plain one matched the bare "14", no separator followed, and the engine restarted INSIDE the number — taking the decimal tail 61 as the low end and the next figure's 14 as the high end. A €14.61/hour rate was read as a range from 61 down to 14. Where the halves descended, annualisation refused and the columns stored NULL (643 of 684 rows); where they ascended, the WRONG pair annualised cleanly — smartrecruiters/Securitas "€ 18,10 – € 19,51" stored 20,800-39,520 and workday/Assurant "$ 19,08 - $ 30,53" stored a floor of 16,640 against a true 39,686, 58% low, in the column salary_rank_usd is generated from (41 rows). Worst single shape: smartrecruiters/Flink "€15,96 - €17,14 per hour" read min 96 WITH a stated period and annualised to 199,680 — a €33k job published as a €200k one at the top of the pay sort. THE TAIL LENGTH DECIDES, NOT THE SEPARATOR AND NOT THE LOCALE: no thousands group has two digits, while three genuinely is ambiguous, so the v8 rule below and parseMoney's European reading are untouched (1,715 dot-3 rows in the census, zero changed) and the fix is unconditional — 29 of the 74 shape-carrying rows found by the country census have country NULL, so a locale-gated rule would have missed most of the population. Lookaheads refuse a tail followed by another separator (ashby/Oscilar's Indian lakh grouping "₹66,21,800") or by a period and a digit. MEASURED LIVE 2026-09-27 with the anon key: 684 rows carry the shape on NINE boards (greenhouse ouihelp 550 / joya 114, smartrecruiters Securitas 8 / Flink 5, workday Ia 2 / Assurant 2 / Enzazaden 1, oracle CareOne 1 / IHG 1), found by censusing every servable posting placed in any of the 64 comma-decimal countries the board holds (80,006 rows, cluster fold off) and then walking each discovered board to its exact countOnly total; an independent 60,000-row offset sample of the whole board found one further board and nothing else. Re-parsing 178,591 real stored salary strings with the old reader and the new one: 683 rows change, 638 NULL to a value, 45 a wrong value to a right one, ZERO a value to NULL. Boards, not one board, and never a token condition — the same lesson as v8. // v8 (2026-09-26): a 3-decimal HOURLY rate was read as a thousands group — Saskatchewan Health Authority's own field says "RequisitionType": "Hourly" beside "Pay Band 12 $23.170 to $24.840", and the board stored $23.17/hr as a $23,170 ANNUAL salary (under SK minimum wage, ~29% of real pay). Measured live over 176,575 rows: 1,404 rows on FIVE boards / two vendors — oracle HealthCareersInSask.ca 1,294, oracle DPS 96, workday Scarborough Health Network 11, workday Richmond University Medical Center 2, oracle Northwell 1 — of which 1,323 hold a wrong stored annual and 81 stored NULL. Every salary floor, ceiling and the pay sort read salary_rank_usd off salary_min_annual, so all of them filtered and sorted at ~half their true pay. See readsDotThreeAsRate: the European thousands reading ('€45.000' = 45,000) is deliberately kept, so the re-read is conditioned on the posting's locale, not the separator. // v7 (2026-08-25): day rates (x260) + a part-time/casual guard that REFUSES to annualise a load-dependent rate — {"q":"teacher","salaryFloor":90000} was serving 14 hourly part-timers out of 15, incl. $44/hr read as 91,520 and a $160/day substitute read as 332,800
// v6 (2026-08-24): // v6 (2026-08-24): "an hour"/"a year" vocabulary + unambiguous-hourly inference for parity currencies in [7,200) — 17,641 workday vendor-stated ranges sat unannualized; whole-dollar rounding
const COUNTRY_VERSION = 1; // v1: deterministic country from location text (names + US/CA state patterns)
// Rationale: docs/job-board-index-notes.md#n044-the-completion-stamp-expires-without-this-th

// Rationale: docs/job-board-index-notes.md#n045-
// Rationale: docs/job-board-index-notes.md#n1156-async-function-undatedbacklog-client-sup
// Rationale: docs/job-board-index-notes.md#n529-async-function-undatedbacklog-client-sup
// deno-lint-ignore no-explicit-any
async function undatedBacklog(client: SupabaseClient<any, any, any>): Promise<number | null> {
  try {
    const { data } = await client.from("job_board_stats_rollup").select("v").eq("k", "date_coverage").maybeSingle();
    return backlogFromCoverage((data as { v?: unknown } | null)?.v ?? null);
  } catch {
    return null;
  }
}

const BACKFILL_HOP_PAUSE_MS = 3_000;
// Rationale: docs/job-board-index-notes.md#n530-const-velocity_hot_slots
const VELOCITY_HOT_SLOTS = 40;
const VELOCITY_WINDOW_DAYS = 7;
// Rationale: docs/job-board-index-notes.md#n1157-const-hot_step_floor-math-min-math-max
const HOT_STEP_FLOOR = Math.min(3, Math.max(1, Math.floor(HOT_POSTING_BUDGET / MAX_POSTINGS_PER_VISIT)));
const CHAIN_CAP = Math.ceil(HOT_SIZE / HOT_STEP_FLOOR) + COLD_SLICES_PER_PASS + 4; // pass length at the slowest hot step + stall headroom

// Rationale: docs/job-board-index-notes.md#n046-corpus-ceiling
const CORPUS_CEILING = 1_200_000; // arm eviction above this
const CORPUS_TARGET = 1_150_000;  // evict down to this

// Rationale: docs/job-board-index-notes.md#n531-const-fresh_window_days
const FRESH_WINDOW_DAYS = 30;

// Rationale: docs/job-board-index-notes.md#n047-backdate-slack-ms
const BACKDATE_SLACK_MS = FRESH_WINDOW_DAYS * 86_400_000;
function exitReasonFor(postedAt: unknown, firstSeen: unknown): "aged_out" | "backdated" {
  const p = postedAt ? Date.parse(String(postedAt)) : NaN;
  const f = firstSeen ? Date.parse(String(firstSeen)) : NaN;
  if (!Number.isFinite(p) || !Number.isFinite(f)) return "aged_out";
  return p < f - BACKDATE_SLACK_MS ? "backdated" : "aged_out";
}

/**
 * HOW LONG THE ROLE WAS UP, AND WHICH CLOCK SAID SO.
 *
 * days_on_board was written at four sites as
 * `(posted_at ?? first_seen)` — a PER-ROW MIXED CLOCK with nothing in the
 * table to say which one a given row used. posted_at is the EMPLOYER'S OWN
 * STATED posting date; first_seen is OUR DISCOVERY DATE and is never a
 * posting age. Coalescing them silently turns "we found this board last
 * Tuesday" into "this role was open for six days", and this repo has already
 * shipped one number (the 2.8-day median) built exactly that way.
 *
 * It matters right now because the hiring-health estimator takes its
 * right-censoring times from exits rows, so two of the four write sites were
 * feeding mixed-clock durations into the censoring input of the model built
 * to remove that error.
 *
 * THE CHOICE MADE HERE, applied identically at all four sites: always emit a
 * duration when one can be computed, and always say which clock produced it.
 *   origin_basis 'stated'     — measured from the employer's posted_at.
 *                               Clean; this is the only population an
 *                               estimator should use without thinking.
 *   origin_basis 'discovered' — posted_at was null, so this is measured from
 *                               OUR first_seen. It is a lower bound on the
 *                               real tenure, NOT a posting age.
 *   days null, basis null     — neither clock was readable.
 * Writing the discovered value rather than null keeps the row usable for
 * coverage/volume work while `WHERE origin_basis = 'stated'` recovers exactly
 * the clean series. The reverse (null) would have destroyed information that
 * cannot be recollected.
 */
function tenureDays(
  postedAt: unknown,
  firstSeen: unknown,
  exitedAtIso: string,
): { days: number | null; basis: "stated" | "discovered" | null } {
  const end = Date.parse(exitedAtIso);
  if (!Number.isFinite(end)) return { days: null, basis: null };
  const stated = postedAt ? Date.parse(String(postedAt)) : NaN;
  if (Number.isFinite(stated)) return { days: Math.round((end - stated) / 8_640_000) / 10, basis: "stated" };
  const seen = firstSeen ? Date.parse(String(firstSeen)) : NaN;
  if (Number.isFinite(seen)) return { days: Math.round((end - seen) / 8_640_000) / 10, basis: "discovered" };
  return { days: null, basis: null };
}

// Rationale: docs/job-board-index-notes.md#n1158-async-function-settleinserterror
async function settleInsertError(
  client: SupabaseClient,
  table: string,
  error: { message?: string } | null | undefined,
  rebuild: () => Array<Record<string, unknown>>,
  optional: readonly string[],
  where: string,
): Promise<{ message?: string } | null> {
  if (!error) return null;
  const dropped = new Set<string>();
  let err: { message?: string } | null | undefined = error;
  // At most one iteration per optional column: every lap must name at least
  // one column it has not already dropped, or it stops.
  for (let attempt = 0; attempt < optional.length; attempt++) {
    const msg = String(err?.message ?? "");
    const named = optional.filter((c) => msg.includes(c) && !dropped.has(c));
    if (named.length === 0) break; // not a missing-column error we can settle
    for (const c of named) dropped.add(c);
    const stripped = rebuild().map((r) => {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(r)) if (!dropped.has(k)) out[k] = r[k];
      return out;
    });
    const { error: retryErr } = await client.from(table).insert(stripped);
    if (!retryErr) {
      console.warn(`[JOB-BOARD] ${table} wrote without ${[...dropped].join(",")} for ${where} — migration not applied yet`);
      return null;
    }
    err = retryErr;
  }
  return err ?? null;
}

// Rationale: docs/job-board-index-notes.md#n1159-const-exit_optional_cols
const EXIT_OPTIONAL_COLS = [
  "posted_at",
  "origin_basis", "title", "company", "department", "country", "region_code",
  "work_mode", "employment_type", "experience_band", "min_years",
  "salary_min_annual", "salary_max_annual", "salary_period", "salary_currency",
] as const;

// Rationale: docs/job-board-index-notes.md#n1160-const-closure_optional_cols
const CLOSURE_OPTIONAL_COLS = [
  "suspect", "batch_removed", "batch_live_before", "absence_basis",
  "department", "country", "region_code", "work_mode", "employment_type",
  "experience_band", "min_years",
  "salary_min_annual", "salary_max_annual", "salary_period", "salary_currency",
] as const;

// Rationale: docs/job-board-index-notes.md#n1161-function-lifecyclefacets-r-record-string
function lifecycleFacets(r: Record<string, unknown>): Record<string, unknown> {
  return {
    department: r.department ?? null,
    country: r.country ?? null,
    region_code: r.region_code ?? null,
    work_mode: r.work_mode ?? null,
    employment_type: r.employment_type ?? null,
    experience_band: r.experience_band ?? null,
    min_years: r.min_years ?? null,
    salary_min_annual: r.salary_min_annual ?? null,
    salary_max_annual: r.salary_max_annual ?? null,
    salary_period: r.salary_period ?? null,
    salary_currency: r.salary_currency ?? null,
  };
}

// Rationale: docs/job-board-index-notes.md#n1162-const-derived_feed_total_sources-new-set
const DERIVED_FEED_TOTAL_SOURCES = new Set(["rippling", "jazzhr", "teamtailor"]);

/** The widened posting select both delete paths now read before pruning. */
const LIFECYCLE_SELECT =
  "id, source, company_token, company, title, category, first_seen, posted_at, " +
  "department, country, region_code, work_mode, employment_type, experience_band, min_years, " +
  "salary_min_annual, salary_max_annual, salary_period, salary_currency";

// Rationale: docs/job-board-index-notes.md#n1163-const-search_callers-new-set-web-api

// Rationale: docs/job-board-index-notes.md#n1164-const-search_callers-new-set-web-api
const SEARCH_CALLERS = new Set(["web", "api", "mcp", "digest", "maintenance"]);
function resolveCaller(req: Request, body: Record<string, unknown>): string | null {
  const declared = String(
    body.caller ?? req.headers.get("x-rsp-caller") ?? req.headers.get("x-rb-caller") ?? "",
  ).toLowerCase();
  if (SEARCH_CALLERS.has(declared)) return declared;
  const auth = req.headers.get("authorization") ?? "";
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // A LABEL, not an authorisation decision — the platform already
  // authenticated whatever this token is before the request reached us.
  if (svc && (auth === `Bearer ${svc}` || req.headers.get("apikey") === svc)) return "maintenance";
  if (req.headers.get("origin") || req.headers.get("referer")) return "web";
  return null;
}

// Rationale: docs/job-board-index-notes.md#n048-insertexits
async function insertExits(
  client: SupabaseClient,
  rows: Array<Record<string, unknown>>,
  where = "exit-log",
): Promise<{ error: { message?: string } | null }> {
  const { error } = await client.from("job_board_exits").insert(rows);
  return {
    error: await settleInsertError(
      client, "job_board_exits", error, () => rows, EXIT_OPTIONAL_COLS, where,
    ),
  };
}

// Rationale: docs/job-board-index-notes.md#n049-logwholeboardexit
// Rationale: docs/job-board-index-notes.md#n1165-async-function-logwholeboardexit
async function logWholeBoardExit(
  client: SupabaseClient,
  token: string,
  source: string | null,
  reason: "board_dormant" | "untracked",
): Promise<{ logged: number; complete: boolean; loggedIds: string[] }> {
  const exitedAt = new Date().toISOString();
  let logged = 0;
  let complete = false;
  const loggedIds: string[] = [];
  // One vendor's board when `source` is given, so a token's twin keeps its rows (n417).
  const board: Record<string, string> = source ? { company_token: token, source } : { company_token: token };
  try {
    for (let from = 0; ; from += 500) {
      // Rationale: docs/job-board-index-notes.md#n532-let-res-await-client
      let res = await client
        .from("job_board_postings")
        .select(LIFECYCLE_SELECT)
        .match(board)
        .order("id")
        .range(from, from + 499);
      // Rationale: docs/job-board-index-notes.md#n533-if-res-error
      if (res.error) {
        res = (await client
          .from("job_board_postings")
          .select("id, source, company_token, company, title, category, posted_at, first_seen")
          .match(board)
          .order("id")
          .range(from, from + 499)) as typeof res;
      }
      const { data: page, error } = res;
      if (error) { console.warn(`[JOB-BOARD] exit-log read failed for ${token} (board kept, nothing deleted):`, error.message?.slice(0, 120)); break; }
      const rows = (page ?? []) as unknown as Array<Record<string, unknown>>;
      if (!rows.length) { complete = true; break; }
      // Rationale: docs/job-board-index-notes.md#n534-const-exitrow-r-record-string-unknown
      const exitRow = (r: Record<string, unknown>) => {
        const t = tenureDays(r.posted_at, r.first_seen, exitedAt);
        return {
          posting_id: String(r.id),
          source: String(r.source ?? ""),
          company_token: String(r.company_token ?? token),
          company: (r.company as string | null) ?? null,
          title: (r.title as string | null) ?? null,
          category: String(r.category ?? "other"),
          exit_reason: reason,
          posted_at: r.posted_at ?? null,
          days_on_board: t.days,
          origin_basis: t.basis,
          exited_at: exitedAt,
          ...lifecycleFacets(r),
        };
      };
      const { error: insErr } = await insertExits(client, rows.map(exitRow), token);
      // supabase-js RETURNS errors rather than throwing. An unchecked insert is
      // how lifecycle history goes missing without anyone noticing.
      if (insErr) { console.warn(`[JOB-BOARD] exit-log insert failed for ${token} (unlogged rows kept):`, insErr.message?.slice(0, 120)); break; }
      logged += rows.length;
      for (const r of rows) loggedIds.push(String(r.id));
      if (rows.length < 500) { complete = true; break; }
    }
  } catch (e) {
    complete = false;
    console.warn(`[JOB-BOARD] exit-log threw for ${token} (unlogged rows kept):`, String(e).slice(0, 120));
  }
  return { logged, complete, loggedIds };
}

// Rationale: docs/job-board-index-notes.md#n1166-async-function-prunewholeboard
async function pruneWholeBoard(
  client: SupabaseClient,
  token: string,
  reason: "board_dormant" | "untracked",
  source: string | null,
): Promise<{ logged: number; complete: boolean }> {
  const { logged, complete, loggedIds } = await logWholeBoardExit(client, token, source, reason);
  if (complete) {
    let q = client.from("job_board_postings").delete().eq("company_token", token);
    if (source) q = q.eq("source", source);
    const { error } = await q;
    if (error) console.warn(`[JOB-BOARD] whole-board delete failed for ${token} (rows stay, already logged):`, error.message?.slice(0, 120));
    else dropTombstones(client, loggedIds);
  } else {
    for (let i = 0; i < loggedIds.length; i += 200) {
      const { error } = await client.from("job_board_postings").delete().in("id", loggedIds.slice(i, i + 200));
      if (!error) dropTombstones(client, loggedIds.slice(i, i + 200));
    }
  }
  return { logged, complete };
}

// Rationale: docs/job-board-index-notes.md#n1167-async-function-closevanishedchunk
async function closeVanishedChunk(
  client: SupabaseClient,
  s: { source: string; token: string },
  chunk: string[],
  ctx: {
    closedAt: string;
    agedOutIds: ReadonlySet<string>;
    freshCutoffMs: number;
    liveTitles: ReadonlySet<string>;
    recentSuperseded: ReadonlySet<string>;
    batchSuspect: boolean;
    absentInPass: number;
    removableBefore: number;
    lapMode: boolean;
    lapBackfillUntil: string;
    missingSinceById: ReadonlyMap<string, string | null | undefined>;
    startIso: string;
  },
): Promise<string[]> {
  const { closedAt, agedOutIds, freshCutoffMs, liveTitles, recentSuperseded, batchSuspect, absentInPass, removableBefore, lapMode, lapBackfillUntil, missingSinceById, startIso } = ctx;
  const keep = new Set<string>();
  const agedIds = new Set<string>(agedOutIds);
  try {
    // Rationale: docs/job-board-index-notes.md#n122-logres
    let logRes = await client
      .from("job_board_postings")
      .select(LIFECYCLE_SELECT)
      .in("id", chunk);
    // Rationale: docs/job-board-index-notes.md#n535-if-logres-error
    if (logRes.error) {
      logRes = (await client
        .from("job_board_postings")
        .select("id, source, company_token, company, title, category, first_seen, posted_at")
        .in("id", chunk)) as typeof logRes;
    }
    if (logRes.error) {
      for (const id of chunk) keep.add(id);
      console.warn(`[JOB-BOARD] closure-log read failed for ${s.token} (chunk kept, retried next visit):`, String(logRes.error.message ?? "").slice(0, 150));
    }
    const toLog = logRes.data as unknown as Array<Record<string, unknown>> | null;
    // Rationale: docs/job-board-index-notes.md#n123-isagedout
    const isAgedOut = (r: Record<string, unknown>) => {
      if (agedOutIds.has(String(r.id))) return true;
      const posted = r.posted_at ? new Date(String(r.posted_at)).getTime() : NaN;
      return Number.isFinite(posted) && posted < freshCutoffMs;
    };
    const agedRows = ((toLog ?? []) as Array<Record<string, unknown>>).filter(isAgedOut);
    for (const r of agedRows) agedIds.add(String(r.id));
    if (agedRows.length) {
      // Rationale: docs/job-board-index-notes.md#n124-agedexitrow
      const agedExitRow = (r: Record<string, unknown>) => {
        const t = tenureDays(r.posted_at, r.first_seen, closedAt);
        return {
          posting_id: String(r.id),
          source: String(r.source ?? s.source),
          company_token: String(r.company_token ?? s.token),
          company: (r.company as string | null) ?? null,
          title: (r.title as string | null) ?? null,
          category: String(r.category ?? "other"),
          exit_reason: exitReasonFor(r.posted_at, r.first_seen),
          posted_at: r.posted_at ?? null,
          days_on_board: t.days,
          origin_basis: t.basis,
          exited_at: closedAt,
          ...lifecycleFacets(r),
        };
      };
      // Rationale: docs/job-board-index-notes.md#n536-const-error-agederr-await-insertexits-cl
      const { error: agedErr } = await insertExits(client, agedRows.map(agedExitRow), s.token);
      if (agedErr) {
        for (const r of agedRows) keep.add(String(r.id));
        console.warn(`[JOB-BOARD] aged-exit insert failed for ${s.token} (${agedRows.length} kept, retried next visit):`, String(agedErr.message ?? agedErr).slice(0, 150));
      }
    }
    const rows = ((toLog ?? []) as Array<Record<string, unknown>>).filter((r) => {
      if (isAgedOut(r)) return false; // (b) aged out, not closed
      const norm = normalizeCloseTitle(String(r.title ?? ""));
      return !(liveTitles.has(norm) && recentSuperseded.has(norm)); // superseded repeat within 24h — skip
    });
    if (rows.length) {
      // Rationale: docs/job-board-index-notes.md#n125-closurerows
      const closureRows = rows.map((r) => ({
        posting_id: r.id,
        source: r.source,
        company_token: r.company_token,
        company: r.company ?? "",
        title: r.title ?? "",
        category: r.category ?? "other",
        // Rationale: docs/job-board-index-notes.md#n537-first_seen-r-first_seen-null
        first_seen: r.first_seen ?? null,
        posted_at: r.posted_at ?? null,
        closed_at: closedAt,
        superseded: liveTitles.has(normalizeCloseTitle(String(r.title ?? ""))), // (c)
        suspect: batchSuspect,
        batch_removed: absentInPass,
        batch_live_before: removableBefore,
        // Rationale: docs/job-board-index-notes.md#n538-absence_basis-lapmode
        absence_basis: lapMode
          ? (lapBackfillUntil && (missingSinceById.get(String(r.id)) ?? startIso) <= lapBackfillUntil ? "lap_backfill" : "lap")
          : "full_read",
        ...lifecycleFacets(r),
      }));
      // Rationale: docs/job-board-index-notes.md#n126-const-error-rawclerr-await-client-from-j
      const { error: rawClErr } = await client.from("job_board_closures").insert(closureRows);
      const clErr = await settleInsertError(client, "job_board_closures", rawClErr, () => closureRows, CLOSURE_OPTIONAL_COLS, s.token);
      if (clErr) {
        // Keep exactly the rows whose closures did not land; an aged row
        // above may go only if its exit landed (kept above otherwise).
        for (const r of rows) keep.add(String(r.id));
        console.warn(`[JOB-BOARD] closure insert failed for ${s.token} (${rows.length} kept, retried next visit):`, clErr.message?.slice(0, 150));
      }
      // Rationale: docs/job-board-index-notes.md#n127-removedexitrow
      const removedExitRow = (r: Record<string, unknown>) => {
        const t = tenureDays(r.posted_at, r.first_seen, closedAt);
        return {
          posting_id: r.id,
          source: r.source,
          company_token: r.company_token,
          company: r.company ?? null,
          title: r.title ?? null,
          category: r.category ?? "other",
          exit_reason: "removed",
          posted_at: r.posted_at ?? null,
          days_on_board: t.days,
          origin_basis: t.basis,
          exited_at: closedAt,
          ...lifecycleFacets(r),
        };
      };
      // Only beside a closure that landed: a kept row comes back next
      // visit and would otherwise write its exit twice.
      if (!clErr) waitUntil(Promise.resolve(insertExits(
        client, rows.map(removedExitRow), s.token,
      )).then(({ error }) => {
        if (error) console.warn(`[JOB-BOARD] removed-exit insert failed for ${s.token} (non-fatal):`, String(error.message ?? error).slice(0, 150));
      }).catch(() => {}));
    }
  } catch (e) {
    for (const id of chunk) keep.add(id);
    console.warn(`[JOB-BOARD] closure log failed for ${s.token} (chunk kept, retried next visit):`, String(e).slice(0, 150));
  }
  const doomed = keep.size > 0 ? chunk.filter((id) => !keep.has(id)) : chunk;
  if (doomed.length === 0) return [];
  const { error: delErr } = await client.from("job_board_postings").delete().in("id", doomed);
  if (delErr) { console.warn(`[JOB-BOARD] closure prune delete failed for ${s.token} (non-fatal):`, delErr.message?.slice(0, 150)); return []; }
  dropTombstones(client, doomed.filter((id) => !agedIds.has(id)));
  return doomed;
}

// Rationale: docs/job-board-index-notes.md#n1168-function-droptombstones-client-supabasec
function dropTombstones(client: SupabaseClient, ids: readonly string[]): void {
  for (let i = 0; i < ids.length; i += 200) {
    waitUntil(Promise.resolve(client.from("job_board_aged_out").delete().in("id", ids.slice(i, i + 200))).then(({ error }) => {
      if (error) console.warn("[JOB-BOARD] tombstone drop failed (non-fatal):", String(error.message ?? error).slice(0, 120));
    }).catch(() => {}));
  }
}

// Rationale: docs/job-board-index-notes.md#n539-const-fresh_prune_max-_000
const FRESH_PRUNE_MAX = 15_000;
// Rationale: docs/job-board-index-notes.md#n1169-const-pass_end_sweep_until_ms-_000
const PASS_END_SWEEP_UNTIL_MS = 90_000;
/** The name-sync lane takes no new board after this, from its own hop's start (S11-133); a board not reached waits a pass. */
const NAME_SYNC_UNTIL_MS = 90_000;

// Rationale: docs/job-board-index-notes.md#n540-let-chainkeypromise-promise-string-null
let chainKeyPromise: Promise<string> | null = null;
function chainKey(): Promise<string> {
  chainKeyPromise ??= (async () => {
    const seed = `${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}:board-chain`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  })();
  return chainKeyPromise;
}

// Rationale: docs/job-board-index-notes.md#n1170-const-status_memo_ms-_000
const STATUS_MEMO_MS = 30_000;
let statusMemo: { at: number; text: string } | null = null;
/** host_sweep without a maintenance credential: one sweep per this gap, arrival to arrival (the cron's is 60 minutes). */
const HOST_SWEEP_ANON_GAP_MS = 50 * 60_000;
// Rationale: docs/job-board-index-notes.md#n1171-const-suggest_memo_ms-_000
const SUGGEST_MEMO_MS = 60_000;
let suggestMemo: { at: number; facet: unknown; open: unknown; merged?: ReturnType<typeof mergeCompanyFacet> } | null = null;
/** company-suggest's employers, one row per employer with its open count; the list resolves names from the same rows. */
async function suggestEmployers(client: SupabaseClient): Promise<ReturnType<typeof mergeCompanyFacet>> {
  // Rationale: docs/job-board-index-notes.md#n273-const-data-metarow-await-client-from-job
  // .88: the two keys this needs, by JSON path, and this isolate's copy for
  // SUGGEST_MEMO_MS -- an autocomplete re-read the whole refresh row per keystroke.
  let suggestV: Record<string, unknown>;
  if (suggestMemo && Date.now() - suggestMemo.at < SUGGEST_MEMO_MS) {
    // The merged list too, so company-names' folded index lives as long as the memo.
    if (suggestMemo.merged) return suggestMemo.merged;
    suggestV = { companiesFacet: suggestMemo.facet, companiesOpen: suggestMemo.open };
  } else {
    const { data: metaRow, error: metaErr } = await client.from("job_board_meta")
      .select("companiesFacet:v->companiesFacet, companiesOpen:v->companiesOpen").eq("k", "refresh").maybeSingle();
    const row = (metaRow ?? {}) as { companiesFacet?: unknown; companiesOpen?: unknown };
    // Only a readable list is kept: an error or an absent row is asked again next call.
    suggestMemo = !metaErr && Array.isArray(row.companiesFacet) ? { at: Date.now(), facet: row.companiesFacet, open: row.companiesOpen } : null;
    suggestV = { companiesFacet: row.companiesFacet, companiesOpen: row.companiesOpen };
  }
  const facet = (Array.isArray(suggestV.companiesFacet) ? suggestV.companiesFacet : []) as Array<{ token?: string; name?: string; count?: number }>;
  const openRaw = suggestV.companiesOpen;
  const openMap = openRaw && typeof openRaw === "object" && !Array.isArray(openRaw) ? openRaw as Record<string, number> : null;
  // Rationale: docs/job-board-index-notes.md#n541-const-fold
  const fold = () => {
    return mergeCompanyFacet(
      openMap
        ? facet.map((c) => ({ ...c, open: typeof c.token === "string" && Object.prototype.hasOwnProperty.call(openMap, c.token) ? openMap[c.token] : 0 }))
        : facet,
    );
  };
  const merged = fold();
  if (suggestMemo) suggestMemo.merged = merged;
  return merged;
}

// Rationale: docs/job-board-index-notes.md#n1172-const-route_alias_deadline_ms
const ROUTE_ALIAS_DEADLINE_MS = 800;
/** Words no live employer key may claim: role abbreviations, places, filler, and the job acronyms people type. */
const LIVE_KEY_REFUSE: ReadonlySet<string> = new Set([
  ...Object.keys(ROLE_ALIASES), ...Object.keys(STATE_ALIASES), ...Object.keys(METRO_ALIASES).map((k) => foldName(k)),
  "cna", "lpn", "lvn", "rn", "np", "pa", "cpa", "cdl", "hvac", "emt", "pta", "ota", "slp", "bcba", "rbt", "csr", "sdr",
  "bdr", "qc", "dba", "cfo", "ceo", "cto", "coo", "cmo", "vp", "gm", "crna", "cst", "phd", "mba", "aws", "sap", "erp",
  "crm", "seo", "ehs", "hse", "osha", "dot", "cad", "plc", "rf", "mep", "bim", "cnc", "pmp", "lmsw", "lcsw", "msw",
]);
async function routeAliasesFor(client: SupabaseClient): Promise<typeof EMPLOYER_ALIASES> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), ROUTE_ALIAS_DEADLINE_MS); });
    const merged = await Promise.race([suggestEmployers(client), late]).finally(() => clearTimeout(timer));
    if (!merged || merged.length === 0) return EMPLOYER_ALIASES;
    return withLiveBrands(EMPLOYER_ALIASES, merged, LIVE_KEY_REFUSE);
  } catch {
    return EMPLOYER_ALIASES;
  }
}

/** The longest id `exists` reads (S12-123): every posting id is source:token:externalId, well under this. */
const EXISTS_ID_MAX = 300;

/** A maintenance credential (.88): the chain secret in the body, or the service key itself. */
async function isMaintenance(req: Request, body: Record<string, unknown>): Promise<boolean> {
  if (typeof body.chainKey === "string" && body.chainKey === await chainKey()) return true;
  return (await exemptKind(req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")) === "service";
}

// Rationale: docs/job-board-index-notes.md#n1173-async-function-claimrun-client-supabasec
async function claimRun(client: SupabaseClient, key: string, holdMs: number): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await client.from("job_board_meta").update({ v: { at: now }, updated_at: now })
    .eq("k", key).lt("updated_at", new Date(Date.now() - holdMs).toISOString()).select("k");
  if (error) return true;
  if (Array.isArray(data) && data.length === 1) return true;
  const { error: insErr } = await client.from("job_board_meta").insert({ k: key, v: { at: now }, updated_at: now });
  return insErr?.code !== "23505";
}

// Rationale: docs/job-board-index-notes.md#n050-isingestpaused
async function isIngestPaused(client: SupabaseClient): Promise<boolean> {
  // Rationale: docs/job-board-index-notes.md#n542-const-readonce-async-promise-boolean-nul
  const readOnce = async (): Promise<boolean | null> => {
    try {
      const res = await Promise.race([
        client.from("job_board_meta").select("v").eq("k", "ingest_paused").maybeSingle()
          .then((r) => r, () => ({ data: null, error: { message: "rejected" } })),
        new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 800)),
      ]);
      if (res === "timeout" || (res as { error?: unknown }).error) return null;
      return ((res as { data?: { v?: { paused?: boolean } } }).data?.v)?.paused === true;
    } catch {
      return null;
    }
  };
  const first = await readOnce();
  if (first !== null) return first;
  const second = await readOnce();
  if (second !== null) return second;
  console.warn("[JOB-BOARD] ingest_paused UNREADABLE twice — proceeding as unpaused (fail-open); an operator pause may not be honoured this hop");
  return false;
}

// Rationale: docs/job-board-index-notes.md#n1174-function-chainnextslice-hop-number-clien
function chainNextSlice(hop: number, client?: SupabaseClient, nextBoards?: number) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
  const stamp = async (v: Record<string, unknown>) => {
    if (!client) return;
    try {
      await client.from("job_board_meta").upsert(
        { k: "chain_kick", v: { at: new Date().toISOString(), fromHop: hop, ...v }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
    } catch { /* instrumentation must never be the thing that breaks the chain */ }
  };
  waitUntil((async () => {
    if (client && await isIngestPaused(client)) {
      console.warn(`[JOB-BOARD] ingest PAUSED — chain stopping at hop ${hop}; unset job_board_meta.ingest_paused to resume`);
      await stamp({ outcome: "paused", note: "deliberate stop — ingest_paused is set" });
      return;
    }
    // Rationale: docs/job-board-index-notes.md#n543-await-stamp-outcome-kicked
    await stamp({ outcome: "kicked" });
    const key = await chainKey();
    try {
      const r = boundBody(await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", force: true, chain: hop + 1, chainKey: key, ...(nextBoards ? { boards: nextBoards } : {}) }),
      }), SELF_RESPONSE_BYTES);
      const body = (await r.text()).slice(0, 300);
      // A 200 is not proof the chain continued. The child returns 200 for every
      // early exit, so the DETAIL is what says whether a slice actually ran.
      const declined = /skipped|paused|unknown action|chainkey|not authori/i.test(body);
      const outcome = !r.ok ? "http_error" : declined ? "declined" : "continued";
      if (outcome !== "continued") {
        console.error(`[JOB-BOARD] chain did NOT continue past hop ${hop}: ${outcome} status=${r.status} body=${body}`);
      }
      await stamp({ outcome, status: r.status, detail: body });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error(`[JOB-BOARD] chain kick threw at hop ${hop}: ${msg}`);
      await stamp({ outcome: "threw", detail: msg.slice(0, 300) });
    }
  })().catch((e) => {
    // Was `() => {}`. A swallowed rejection here is the failure mode that made
    // the previous three invisible.
    console.error("[JOB-BOARD] chain kick failed outside its own handler:", e);
  }));
}

// Rationale: docs/job-board-index-notes.md#n544-const-slice_stats_write_ms-_000

// Slice-duration recorder — called at runRefresh's TERMINAL returns so the
// wall time covers everything a slice actually does: the fetch loop AND the
// tail (dormancy pruning, deep-cursor writes, and on pass-end the facets
// recompute + headline recount — measured 0.63s+ on its own). The first
// version stamped before that tail and undercounted ~27% on pass-end slices;
// a review caught it. EMA alpha 0.2, per phase. Fire-and-forget by design.
//
// KNOWN, ACCEPTED RACE (review finding, low): chain hops force past the slice
// lock, so two near-simultaneous slices can interleave this read-modify-write
// — the `slices` counter undercounts by one and the OTHER phase's EMA reverts
// by one sample (self-correcting). Instrumentation-grade data; the wrapMin
// stamp remains the load-bearing freshness measurement.
const SLICE_STATS_WRITE_MS = 5_000;

// Rationale: docs/job-board-index-notes.md#n1175-async-function-stampslicework-client-sup
async function stampSliceWork(client: SupabaseClient, inHotPhase: boolean, sliceWallStart: number): Promise<void> {
  const workMs = Date.now() - sliceWallStart;
  const phase = inHotPhase ? "hot" : "cold";
  const mem = memStamp();
  const write = (async () => {
    const { data: prev } = await client.from("job_board_meta").select("v").eq("k", "slice_stats").maybeSingle();
    const pv = (prev?.v ?? {}) as { works?: number; workHotEmaMs?: number; workColdEmaMs?: number; build?: unknown; buildSince?: unknown };
    // Rationale: docs/job-board-index-notes.md#n545-const-key-phase-hot-workhotemams-workcol
    const key = phase === "hot" ? "workHotEmaMs" : "workColdEmaMs";
    const prevEma = typeof pv[key] === "number" ? pv[key]! : workMs;
    await client.from("job_board_meta").upsert({
      k: "slice_stats",
      v: {
        ...pv,
        workAt: new Date().toISOString(),
        workPhase: phase,
        workMs,
        [key]: Math.round(prevEma * 0.8 + workMs * 0.2),
        works: (Number(pv.works) || 0) + 1,
        workHop: currentHop,
        ...(mem.heapMb !== undefined ? { workHeapMb: mem.heapMb } : {}),
        ...(mem.rssMb !== undefined ? { workRssMb: mem.rssMb } : {}),
        ...firstSliceOf(pv, sliceWallStart),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "k" });
  })().catch((e) => { sliceStampError = `work: ${String(e).slice(0, 160)}`; });
  await Promise.race([write, new Promise<void>((res) => setTimeout(res, SLICE_STATS_WRITE_MS))]);
}

/** slice_stats.build/buildSince: this bundle and the earliest start of a slice it fetched in; repairs bound on it (n439). */
function firstSliceOf(pv: { build?: unknown; buildSince?: unknown }, sliceWallStart: number): { build: string; buildSince: string } {
  const start = new Date(sliceWallStart).toISOString();
  const since = pv.build === BUILD_VERSION && typeof pv.buildSince === "string" && pv.buildSince < start ? pv.buildSince : start;
  return { build: BUILD_VERSION, buildSince: since };
}

// Rationale: docs/job-board-index-notes.md#n1176-let-slicebudgetnote-fetched-number-skipp
// Rationale: docs/job-board-index-notes.md#n546-let-slicebudgetnote-fetched-number-skipp
let sliceBudgetNote: { fetched: number; skipped: number; hit: boolean; lastUpsertError: string | null; heapStopped: boolean; wallStopped: boolean; sizeStopped: boolean; boardBudget: number } | null = null;
// This slice's light re-reads (n081), added to the row's running totals by the recorder.
let sliceLightReread: LightRereadStats | null = null;
// This slice's boards whose feed read but whose rows our database would not read or store (S11-023).
let sliceDbFailNote: { boards: number; alarm: number } | null = null;
// Rationale: docs/job-board-index-notes.md#n547-let-currenthop
let currentHop = 0;
// Rationale: docs/job-board-index-notes.md#n051-slicestamperror
let sliceStampError: string | null = null;
// Rationale: docs/job-board-index-notes.md#n052-traceseq
let traceSeq = 0;
async function breadcrumb(client: SupabaseClient, mark: string, extra?: Record<string, unknown>): Promise<void> {
  const write = (async () => {
    await client.from("job_board_meta").upsert({
      k: "slice_trace",
      v: { at: new Date().toISOString(), hop: currentHop, seq: ++traceSeq, mark, ...memStamp(), ...(extra ?? {}) },
      updated_at: new Date().toISOString(),
    }, { onConflict: "k" });
  })().catch(() => { /* never break the thing it measures */ });
  await Promise.race([write, new Promise<void>((r) => setTimeout(r, 600))]);
}
// Rationale: docs/job-board-index-notes.md#n1177-async-function-stamppassend-client-supab
async function stampPassEnd(client: SupabaseClient, v: Record<string, unknown>): Promise<void> {
  const write = (async () => {
    const { error } = await client.from("job_board_meta").upsert(
      { k: "pass_end", v: { build: BUILD_VERSION, ...v }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
    if (error) console.warn("[JOB-BOARD] pass_end stamp failed (non-fatal):", String(error.message ?? error).slice(0, 120));
  })().catch(() => { /* never break the thing it measures */ });
  await Promise.race([write, new Promise<void>((r) => setTimeout(r, 2_000))]);
}
function memStamp(): { heapMb?: number; rssMb?: number } {
  try {
    const mu = (Deno as unknown as { memoryUsage?: () => { heapUsed?: number; rss?: number } }).memoryUsage;
    if (typeof mu !== "function") return {};
    const u = mu.call(Deno) ?? {};
    const out: { heapMb?: number; rssMb?: number } = {};
    if (typeof u.heapUsed === "number") out.heapMb = Math.round(u.heapUsed / 1048576);
    if (typeof u.rss === "number") out.rssMb = Math.round(u.rss / 1048576);
    return out;
  } catch { return {}; }
}

async function recordSliceStats(client: SupabaseClient, sliceWallStart: number, inHotPhase: boolean): Promise<void> {
  const sliceMs = Date.now() - sliceWallStart;
  const phase = inHotPhase ? "hot" : "cold";
  const mem = memStamp();
  // Rationale: docs/job-board-index-notes.md#n548-const-write-async
  const write = (async () => {
    const { data: prevSs } = await client.from("job_board_meta").select("v").eq("k", "slice_stats").maybeSingle();
    const pv = (prevSs?.v ?? {}) as { hotEmaMs?: number; coldEmaMs?: number; slices?: number };
    const key = phase === "hot" ? "hotEmaMs" : "coldEmaMs";
    const prevEma = typeof pv[key] === "number" ? pv[key]! : sliceMs;
    await client.from("job_board_meta").upsert({
      k: "slice_stats",
      v: {
        ...pv,
        at: new Date().toISOString(),
        lastMs: sliceMs,
        lastPhase: phase,
        [key]: Math.round(prevEma * 0.8 + sliceMs * 0.2),
        slices: (Number(pv.slices) || 0) + 1,
        hop: currentHop,
        ...(mem.heapMb !== undefined ? { heapMb: mem.heapMb } : {}),
        ...(mem.rssMb !== undefined ? { rssMb: mem.rssMb } : {}),
        // The budget outcome rides on the row status already exposes.
        ...(sliceBudgetNote ? { budgetFetched: sliceBudgetNote.fetched, budgetSkipped: sliceBudgetNote.skipped, budgetHit: sliceBudgetNote.hit, heapStopped: sliceBudgetNote.heapStopped, wallStopped: sliceBudgetNote.wallStopped, sizeStopped: sliceBudgetNote.sizeStopped, boardBudget: sliceBudgetNote.boardBudget, lastUpsertError: sliceBudgetNote.lastUpsertError ? sliceBudgetNote.lastUpsertError.slice(0, 200) : null } : {}),
        stampError: sliceStampError,
        // null on a hot slice, so a cold slice's step never outlives it on the row.
        cursorStep: sliceCursorNote,
        // Saturation of the persisted light set, whose own row anon cannot read (n019).
        lightSet: DYNAMIC_LIGHT.size,
        lightCap: AUTO_LIGHT_CAP,
        // The stale lane's slice outcome rides the same row: how many stale
        // boards this slice tried, and how many of those stamped.
        ...(sliceStaleNote ? { staleTries: sliceStaleNote.tries, staleResolved: sliceStaleNote.resolved } : {}),
        // Boards our own database failed this slice, and how many have failed DB_FAIL_ALARM_VISITS running (S11-023).
        ...(sliceDbFailNote ? { dbFailed: sliceDbFailNote } : {}),
        ...(sliceLightReread ? { lightReread: addLightReread((pv as { lightReread?: unknown }).lightReread, sliceLightReread, new Date().toISOString()) } : {}),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "k" });
  })().catch((e) => { sliceStampError = `slice: ${String(e).slice(0, 160)}`; });
  await Promise.race([write, new Promise<void>((res) => setTimeout(res, SLICE_STATS_WRITE_MS))]);
}

// Rationale: docs/job-board-index-notes.md#n1178-async-function-admitslice
async function admitSlice(
  client: SupabaseClient,
  next: RefreshProgress,
  ctx: { force: boolean; prog: { updated_at: string } | null },
): Promise<boolean> {
  const updated_at = new Date().toISOString();
  if (ctx.force) {
    await client.from("job_board_meta").upsert({ k: "refresh_progress", v: next, updated_at }, { onConflict: "k" });
    return true;
  }
  if (!ctx.prog) {
    const { error } = await client.from("job_board_meta").insert({ k: "refresh_progress", v: next, updated_at });
    return !(error && error.code === "23505");
  }
  const { data, error } = await client.from("job_board_meta")
    .update({ v: next, updated_at })
    .eq("k", "refresh_progress")
    .eq("updated_at", ctx.prog.updated_at)
    .select("k");
  if (!error && Array.isArray(data) && data.length === 1) return true;
  const { data: again } = await client.from("job_board_meta").select("updated_at").eq("k", "refresh_progress").maybeSingle();
  if (again && again.updated_at !== ctx.prog.updated_at) return false;
  console.warn(`[JOB-BOARD] slice admission: conditional write matched no row though the stamp is unchanged (${error?.message ?? "0 rows"}) — admitting unconditionally`);
  await client.from("job_board_meta").upsert({ k: "refresh_progress", v: next, updated_at }, { onConflict: "k" });
  return true;
}

async function runRefresh(client: SupabaseClient, force = false, chainHop = 0, boardBudget = MIN_BOARDS_PER_SLICE): Promise<{ ok: boolean; detail: string }> {
  currentHop = chainHop;
  // Checked at the ENTRY too, not only at the hop: pausing must also stop a
  // fresh chain started by pg_cron, a manual refresh, or any other trigger.
  // `force` does NOT override this — force exists to bypass the slice lock, and
  // an operator stopping a struggling database means it.
  if (await isIngestPaused(client)) {
    return { ok: true, detail: "ingest paused — set job_board_meta.ingest_paused.paused=false to resume" };
  }
  const { data: prog } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle();
  if (!force && prog && Date.now() - new Date(prog.updated_at).getTime() < SLICE_LOCK_MS) {
    return { ok: true, detail: "skipped — a slice ran moments ago" };
  }
  // Rationale: docs/job-board-index-notes.md#n549-const-slicewallstart-date-now
  const sliceWallStart = Date.now();
  // Rationale: docs/job-board-index-notes.md#n550-slicestalenote-null
  sliceStaleNote = null;
  sliceCursorNote = null;
  sliceLightReread = null;
  sliceDbFailNote = null;
  const { hotList: HOT_LIST, coldList: COLD_LIST } = await tierLists(client);
  await loadDynamicLight(client); // auto-enrolled giant boards fetch without content
  // Rationale: docs/job-board-index-notes.md#n551-await-loadoversizeboards-client
  await loadOversizeBoards(client);
  await seedBoardStamps(client);
  const pv = (prog?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[]; failedTotal?: number };
  let hot = Math.max(0, Number(pv.hot) || 0);
  let cold = Math.max(0, Number(pv.cold) || 0) % Math.max(1, COLD_LIST.length);
  let coldDone = Math.max(0, Number(pv.coldDone) || 0);
  // Rationale: docs/job-board-index-notes.md#n552-if-chainhop
  if (chainHop === 0) {
    const progAge = prog ? Date.now() - new Date(prog.updated_at).getTime() : Infinity;
    const storedDone = hot >= HOT_LIST.length && coldDone >= COLD_SLICES_PER_PASS;
    if (storedDone || progAge > 45 * 60_000) {
      // Rationale: docs/job-board-index-notes.md#n553-const-diedmidhot-storeddone-hot-hot-hot_
      const diedMidHot = !storedDone && hot > 0 && hot < HOT_LIST.length;
      if (!diedMidHot) hot = 0;
      coldDone = 0;
      pv.failedAcc = [];
      pv.failedTotal = 0;
    }
  }

  const inHotPhase = hot < HOT_LIST.length;

  // Rationale: docs/job-board-index-notes.md#n053-shed-read-timeout
  const SHED_READ_TIMEOUT = Symbol("shed-read-timeout");
  const shedSignal = await (async () => {
    try {
      const res = await Promise.race([
        client.from("job_board_meta").select("v, updated_at").eq("k", "slice_stats").maybeSingle()
          .then((r) => r, () => ({ data: null, error: { message: "read rejected" } })),
        new Promise<typeof SHED_READ_TIMEOUT>((res) => setTimeout(() => res(SHED_READ_TIMEOUT), 500)),
      ]);
      if (res === SHED_READ_TIMEOUT) return { kind: "unreadable" as const };
      if ((res as { error?: unknown }).error) return { kind: "unreadable" as const };
      const row = (res as { data?: { v?: unknown; updated_at?: string } }).data ?? null;
      const v = (row?.v ?? null) as { hotEmaMs?: number; coldEmaMs?: number } | null;
      if (v === null) return { kind: "absent" as const };
      // Rationale: docs/job-board-index-notes.md#n054-rowage
      const rowAge = row?.updated_at ? Date.now() - new Date(row.updated_at).getTime() : 0;
      if (rowAge > 30 * 60_000) return { kind: "stale" as const };
      const n = Number(inHotPhase ? v.hotEmaMs : v.coldEmaMs);
      return Number.isFinite(n) && n > 0 ? { kind: "ema" as const, ms: n } : { kind: "absent" as const };
    } catch {
      return { kind: "unreadable" as const };
    }
  })();
  // Rationale: docs/job-board-index-notes.md#n055-hotphase
  const hotPhase = inHotPhase;
  const l1 = hotPhase ? 95_000 : 92_000;
  const l2 = hotPhase ? 150_000 : 125_000;
  const shedLevel = shedSignal.kind === "unreadable" ? 2
    : shedSignal.kind === "absent" ? 1
    : shedSignal.kind === "stale" ? 1
    : shedSignal.ms > l2 ? 2
    : shedSignal.ms > l1 ? 1
    : 0;
  const shedEma = shedSignal.kind === "ema" ? shedSignal.ms : 0;
  const shedColdSlice = shedLevel === 2 ? 24 : shedLevel === 1 ? 48 : COLD_SLICE;
  // Rationale: docs/job-board-index-notes.md#n056-effconcurrency
  const effConcurrency = Math.min(CONCURRENCY, shedLevel === 2 ? 3 : CONCURRENCY);
  // The deep lane is the most expensive work a hop does and the least urgent —
  // it re-pages boards we already carry. It is the first thing to go.
  const effDeepPerSlice = shedLevel === 2 ? 0 : Math.min(DEEP_LANE_TAKE, shedLevel === 1 ? 1 : DEEP_PER_SLICE);
  // Rationale: docs/job-board-index-notes.md#n057-hotbybudget
  const hotByBudget = Math.max(1, Math.floor(HOT_POSTING_BUDGET / MAX_POSTINGS_PER_VISIT));
  const effHotSlice = Math.min(shedLevel === 2 ? 3 : shedLevel === 1 ? 5 : HOT_SLICE, hotByBudget);
  // Rationale: docs/job-board-index-notes.md#n058-effbootstrapperslice
  const effBootstrapPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 10 : BOOTSTRAP_PER_SLICE;
  const shedRetryPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 2 : RETRY_PER_SLICE;
  // Rationale: docs/job-board-index-notes.md#n554-const-effstaleperslice-shedlevel-shedlev
  const effStalePerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 1 : STALE_PER_SLICE;
  const shedBootstrapPerSlice = effBootstrapPerSlice;
  const shedDeepPerSlice = effDeepPerSlice;

  // Rationale: docs/job-board-index-notes.md#n059-deeptake
  const deepTake = shedDeepPerSlice;
  const retryTake = shedRetryPerSlice;
  // The deep take comes out of the bootstrap take, so the lanes ahead of base hold as many boards as before (n426).
  const bootstrapTake = Math.max(0, shedBootstrapPerSlice - deepTake);
  const effColdSlice = shedColdSlice;
  const effRetryPerSlice = retryTake;
  if (shedLevel > 0) {
    console.warn(`[JOB-BOARD] load shedding L${shedLevel}: ${inHotPhase ? "hot" : "cold"} EMA ${Math.round(shedEma / 1000)}s -> ${inHotPhase ? `hotSlice ${effHotSlice}` : `slice ${effColdSlice}, concurrency ${effConcurrency}, deep ${effDeepPerSlice}, bootstrap ${bootstrapTake}, retry ${effRetryPerSlice}`}`);
  }

  let baseSlice = inHotPhase
    ? HOT_LIST.slice(hot, hot + effHotSlice)
    : COLD_LIST.slice(cold, cold + effColdSlice);
  // Rationale: docs/job-board-index-notes.md#n555-let-demandboards-jobsource
  let demandBoards: JobSource[] = [];
  // Rationale: docs/job-board-index-notes.md#n556-let-demandtaken-string
  let demandTaken: string[] = [];
  if (!inHotPhase) {
    const sliceTokens = new Set(baseSlice.map((s) => s.token));
    const hotTokens = new Set(HOT_LIST.map((s) => s.token));
    const demand = await readDemand(client);
    const pick = takeDemand(demand.queue, demand.served, Date.now(), (t) => CATALOGUE_TOKENS.has(t) && !sliceTokens.has(t) && !hotTokens.has(t));
    demandBoards = pick.take.map((t) => JOB_SOURCES.find((s) => s.token === t)).filter((s): s is JobSource => !!s);
    demandTaken = demandBoards.map((s) => s.token);
    // Rationale: docs/job-board-index-notes.md#n060-
  }
  // Rationale: docs/job-board-index-notes.md#n557-let-bootstrapboards-jobsource
  let bootstrapBoards: JobSource[] = [];
  if (!inHotPhase) {
    try {
      // Rationale: docs/job-board-index-notes.md#n061-bootstrapviarpc
      let bootstrapViaRpc = false;
      {
        const rpcAbsent = (e: { code?: string; message?: string } | null | undefined) =>
          !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? ""));
        const sliceTokens = new Set([...baseSlice, ...demandBoards].map((s) => s.token));
        // The stored version only — one text field, never the array.
        const { data: verRow, error: verErr } = await client.from("job_board_meta").select("v->>version").eq("k", "bootstrap").maybeSingle();
        if (!verErr) {
          const storedVersion = (verRow as { version?: string } | null)?.version ?? "";
          let appendDone = true;
          const seed = async (why: string) => {
            const { data: empty, error: ebErr } = await client.rpc("get_empty_boards", { p_tokens: JOB_SOURCES.map((s) => s.token) });
            if (ebErr) throw new Error(ebErr.message ?? "get_empty_boards error");
            const { data: len, error: apErr } = await client.rpc("bootstrap_queue_append", { p_tokens: Array.isArray(empty) ? empty : [] });
            if (apErr) throw apErr;
            console.log(`[JOB-BOARD] bootstrap: ${why} — appended empties server-side (queue now ${len})`);
          };
          try {
            if (storedVersion !== BUILD_VERSION) {
              try { await seed("version change"); } catch (e) {
                if (rpcAbsent(e as { code?: string; message?: string })) throw e;
                appendDone = false;
                console.error(`[JOB-BOARD] bootstrap version-append failed (will retry next slice): ${e instanceof Error ? e.message.slice(0, 120) : e}`);
              }
            }
            const takeArgs = { p_n: bootstrapTake, p_skip: [...sliceTokens], p_version: BUILD_VERSION, p_stamp_version: appendDone };
            let take = await client.rpc("bootstrap_queue_take", takeArgs);
            if (take.error) throw take.error;
            let res = take.data as { taken?: string[]; drained?: number; remaining?: number } | null;
            if ((res?.drained ?? 0) === 0 && (res?.remaining ?? 0) === 0 && storedVersion === BUILD_VERSION) {
              // Empty on an unchanged version: seed once, take again.
              await seed("empty queue");
              take = await client.rpc("bootstrap_queue_take", takeArgs);
              if (take.error) throw take.error;
              res = take.data as { taken?: string[]; drained?: number; remaining?: number } | null;
            }
            const taken = Array.isArray(res?.taken) ? (res!.taken as string[]) : [];
            bootstrapBoards = taken
              .map((t) => JOB_SOURCES.find((s) => s.token === t))
              .filter((s): s is JobSource => !!s);
            await client.rpc("bootstrap_queue_stamp", { p_selected: bootstrapBoards.length });
            bootstrapViaRpc = true;
          } catch (e) {
            // Rationale: docs/job-board-index-notes.md#n558-if-rpcabsent-e-as-code-string
            if (!rpcAbsent(e as { code?: string; message?: string })) throw e;
          }
        }
      }
      if (!bootstrapViaRpc) {
      const { data: bsMeta } = await client.from("job_board_meta").select("v").eq("k", "bootstrap").maybeSingle();
      const bs = (bsMeta?.v ?? {}) as { queue?: string[]; version?: string };
      let queue = Array.isArray(bs.queue) ? bs.queue : [];
      // Rationale: docs/job-board-index-notes.md#n062-queue-length-0
      if (queue.length === 0) {
        const { data: empty, error } = await client.rpc("get_empty_boards", { p_tokens: JOB_SOURCES.map((s) => s.token) });
        if (error) throw error;
        queue = Array.isArray(empty) ? empty : [];
      }
      let bootstrapAppendDone = true;
      if (queue.length > 0 && bs.version !== BUILD_VERSION) {
        // Rationale: docs/job-board-index-notes.md#n063-try
        try {
          const { data: empty, error: ebErr } = await client.rpc("get_empty_boards", { p_tokens: JOB_SOURCES.map((s) => s.token) });
          if (ebErr) throw new Error(ebErr.message ?? "get_empty_boards error");
          const have = new Set(queue);
          const fresh = (Array.isArray(empty) ? (empty as string[]) : []).filter((t) => !have.has(t));
          if (fresh.length > 0) {
            queue = [...queue, ...fresh];
            console.log(`[JOB-BOARD] bootstrap: appended ${fresh.length} empty board(s) on version change (queue ${have.size} -> ${queue.length})`);
          }
        } catch (e) {
          // Rationale: docs/job-board-index-notes.md#n559-bootstrapappenddone-false
          bootstrapAppendDone = false;
          console.error(`[JOB-BOARD] bootstrap version-append failed (will retry next slice): ${e instanceof Error ? e.message.slice(0, 120) : e}`);
        }
      }
      if (queue.length > 0) {
        const sliceTokens = new Set([...baseSlice, ...demandBoards].map((s) => s.token));
        bootstrapBoards = queue
          .slice(0, bootstrapTake)
          .filter((t) => !sliceTokens.has(t))
          .map((t) => JOB_SOURCES.find((s) => s.token === t))
          .filter((s): s is JobSource => !!s);
      }
      if (queue.length > 0) {
        // Rationale: docs/job-board-index-notes.md#n064-await-client-from-job-board-meta-upsert
        await client.from("job_board_meta").upsert(
          {
            k: "bootstrap",
            v: {
              // Rationale: docs/job-board-index-notes.md#n560-queue-queue-slice-bootstraptake
              queue: queue.slice(bootstrapTake),
              version: bootstrapAppendDone ? BUILD_VERSION : (bs.version ?? ""),
              lastSlice: {
                at: new Date().toISOString(),
                drained: Math.min(bootstrapTake, queue.length),
                selected: bootstrapBoards.length,
              },
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "k" },
        );
      }
      } // !bootstrapViaRpc
    } catch { /* bootstrap is an accelerator — on any error the rotation still reaches every board */ }
  }
  // Rationale: docs/job-board-index-notes.md#n065-deepcursorrow
  const deepCursorRow: Record<string, unknown> = await (async () => {
    try {
      const { data } = await client.from("job_board_meta").select("v").eq("k", "deep_cursor").maybeSingle();
      return (data?.v ?? {}) as Record<string, unknown>;
    } catch { return {}; } // a missing cursor costs one restart, never a failure
  })();
  // Rationale: docs/job-board-index-notes.md#n561-const-deepcursors-map-string-number-toke
  const deepCursors: Map<string, number> = tokenMapFromRecord(deepCursorRow);
  // Rationale: docs/job-board-index-notes.md#n066-deeplaps
  const deepLaps: Record<string, LapState> = (() => {
    const out: Record<string, LapState> = {};
    const raw = deepCursorRow.__laps;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const o = v as Partial<LapState> | null;
        if (!o || typeof o !== "object") continue;
        if (!Number.isInteger(o.e) || (o.e as number) <= 0) continue;
        // Rationale: docs/job-board-index-notes.md#n562-if-k-includes-continue
        if (!k.includes(":")) continue;
        out[k] = {
          e: o.e as number,
          s: Number.isFinite(o.s) ? Number(o.s) : 0,
          t: typeof o.t === "string" ? o.t : "",
          f: o.f === 1 ? 1 : 0,
          t0: Number.isFinite(o.t0) ? Number(o.t0) : 0,
          ...(typeof o.w === "string" ? { w: o.w } : {}),
          ...(typeof o.w0 === "string" ? { w0: o.w0 } : {}),
        };
      }
    }
    return out;
  })();
  let deepCursorsDirty = false;

  // Rationale: docs/job-board-index-notes.md#n067-deepboards
  let deepBoards: JobSource[] = [];
  let deepLane: { at: string; candidates: number; selected: number; visited: number; start: number } | null = null;
  if (!inHotPhase) {
    try {
      const tokens = [...deepCursors.keys()];
      if (tokens.length > 0) {
        const taken = new Set([...baseSlice, ...demandBoards, ...bootstrapBoards].map((s) => s.token));
        const { start, picked } = selectDeepLane(tokens, { cold, coldListLen: COLD_LIST.length, take: deepTake, taken });
        deepBoards = picked
          .map((t) => JOB_SOURCES.find((s) => s.token === t))
          .filter((s): s is JobSource => !!s);
        // Rationale: docs/job-board-index-notes.md#n068-deeplane-at-new-date-toisostring-candi
        deepLane = { at: new Date().toISOString(), candidates: tokens.length, selected: deepBoards.length, visited: 0, start };
      }
    } catch { /* accelerator only — on any error the cold rotation still reaches every board */ }
  }
  // Rationale: docs/job-board-index-notes.md#n069-const-data-bfmeta-await-client-from-job
  const { data: bfMeta } = await client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle();
  const bfV = (bfMeta?.v ?? {}) as Partial<BoardFailureState>;
  // Entries an older build keyed by a bare shared token go: their boards are
  // tracked per `source:token` now (n417).
  const boardFailures: BoardFailureState = dropBareSharedKeys({
    streaks: { ...(bfV.streaks ?? {}) },
    dormant: { ...(bfV.dormant ?? {}) },
    failedAt: { ...(bfV.failedAt ?? {}) },
    firstFailedAt: { ...(bfV.firstFailedAt ?? {}) },
  }, SHARED_TOKENS).state;

  // Rationale: docs/job-board-index-notes.md#n563-let-retryboards-jobsource
  let retryBoards: JobSource[] = [];
  let retryLane: { at: string; candidates: number; selected: number } | null = null;
  if (!inHotPhase) {
    try {
      const taken = new Set([...baseSlice, ...demandBoards, ...bootstrapBoards, ...deepBoards].map(boardKeyOf));
      const dueKeys = selectRetries({
        streaks: boardFailures.streaks,
        failedAt: boardFailures.failedAt ?? {},
        dormant: boardFailures.dormant,
        exclude: taken,
        now: Date.now(),
        cap: effRetryPerSlice,
      });
      // By board key, so a shared token retries the twin that failed (n417).
      retryBoards = dueKeys
        .map(boardByKey)
        .filter((s): s is JobSource => !!s);
      // Rationale: docs/job-board-index-notes.md#n564-retrylane
      retryLane = {
        at: new Date().toISOString(),
        candidates: Object.keys(boardFailures.failedAt ?? {}).length,
        selected: retryBoards.length,
      };
    } catch { /* accelerator only — the rotation still reaches every board if this throws */ }
  }
  // Rationale: docs/job-board-index-notes.md#n070-const-data-vhmeta-await-client-from-job
  const { data: vhMeta } = await client.from("job_board_meta").select("v").eq("k", "vendor_breaker").maybeSingle();
  const vhV = (vhMeta?.v ?? {}) as { vendors?: Record<string, { a: number; z: number }>; quarantined?: string[] };
  const vendorPrev: Record<string, { a: number; z: number }> = { ...(vhV.vendors ?? {}) };
  const quarantinedVendors = new Set<string>(Array.isArray(vhV.quarantined) ? vhV.quarantined.filter((x): x is string => typeof x === "string") : []);

  // Rationale: docs/job-board-index-notes.md#n071-staleboards
  let staleBoards: JobSource[] = [];
  let staleTries: Map<string, number> = new Map();
  let staleLane: StaleLaneRun | null = null;
  if (!inHotPhase && effStalePerSlice > 0) {
    try {
      const { data: slMeta } = await client.from("job_board_meta").select("v").eq("k", "stale_lane").maybeSingle();
      staleTries = readStaleTries(slMeta?.v);
      // By board key since .91 (n428): a shared token's bare entry names no board.
      for (const k of [...staleTries.keys()]) if (SHARED_TOKENS.has(k)) staleTries.delete(k);
      // Rationale: docs/job-board-index-notes.md#n072-staleexclude
      const staleExclude = staleExclusion({ oversize: OVERSIZE_BOARDS.keys(), tries: staleTries });
      const askStale = (exclude: readonly string[] | null) => withDeadline(
        client.rpc("get_stalest_boards", { p_limit: STALE_RPC_LIMIT, p_min_age_hours: STALE_LANE_MIN_AGE_H, ...(exclude ? { p_exclude: exclude } : {}) })
          .abortSignal(AbortSignal.timeout(STALE_RPC_DEADLINE_MS + 500))
          .then((r) => r, (e: unknown) => ({ data: null, error: { code: "rejected", message: String(e).slice(0, 160) } })),
        STALE_RPC_DEADLINE_MS,
      );
      const errOf = (r: unknown) => (r as { error?: { code?: string; message?: string } | null }).error ?? null;
      let rpc = await askStale(staleExclude);
      let excluded = staleExclude.length;
      let rpcErr = errOf(rpc);
      // Rationale: docs/job-board-index-notes.md#n565-if-rpcerr-code-pgrst202
      if (rpcErr?.code === "PGRST202") {
        console.warn(`[JOB-BOARD] stale lane: get_stalest_boards has no p_exclude arm yet (apply migration 20260909222000) — asking unexcluded (${(rpcErr.message ?? "").slice(0, 120)})`);
        rpc = await askStale(null);
        excluded = 0;
        rpcErr = errOf(rpc);
      }
      const rows = !rpcErr && Array.isArray(rpc.data) ? (rpc.data as StaleRow[]) : null;
      if (!rows) {
        const why = rpcErr ? `${rpcErr.code ?? ""} ${rpcErr.message ?? ""}`.trim().slice(0, 160) : "deadline";
        console.warn(`[JOB-BOARD] stale lane: get_stalest_boards unavailable — no lane this hop (${why})`);
        staleLane = { at: new Date().toISOString(), rpc: rpcErr ? "error" : "timeout", asked: 0, windowFull: false, excluded: 0, classes: null, selected: [], fetched: 0, resolved: 0, unresolved: [], prototypeNames: [] };
      } else {
        // Rows and every set by board key (n428): a stamp row names a board, not a token.
        const verdicts: StaleVerdict[] = classifyStale(laneRows(rows, SHARED_TOKENS), {
          catalogued: CATALOGUE_KEYS,
          quarantinedVendors,
          oversize: new Set(OVERSIZE_BOARDS.keys()),
          dormant: keysOf(boardFailures.dormant),
          failing: new Set([...keysOf(boardFailures.failedAt), ...keysOf(boardFailures.streaks)]),
          tries: staleTries,
        });
        const taken = new Set([...baseSlice, ...demandBoards, ...bootstrapBoards, ...retryBoards, ...deepBoards].map(boardKeyOf));
        staleBoards = selectStaleLane(verdicts, { perSlice: effStalePerSlice, exclude: taken })
          .map(boardByKey)
          .filter((s): s is JobSource => !!s);
        const classes = countByClass(verdicts);
        staleLane = {
          at: new Date().toISOString(),
          rpc: "ok",
          asked: rows.length,
          // Rationale: docs/job-board-index-notes.md#n566-windowfull-rows-length-stale_rpc_limit-c
          windowFull: rows.length >= STALE_RPC_LIMIT && classes.unexplained === 0 && staleBoards.length === 0,
          excluded,
          classes,
          selected: staleBoards.map(boardKeyOf),
          fetched: 0,
          resolved: 0,
          unresolved: verdicts.filter((v) => v.cls === "unresolved").map((v) => v.token),
          prototypeNames: verdicts.filter((v) => v.cls === "prototype_name").map((v) => v.token),
        };
        if (staleLane.windowFull) {
          const filled = (Object.entries(classes) as Array<[StaleClass, number]>).filter(([, n]) => n > 0).map(([c, n]) => `${c} ${n}`).join(", ");
          console.warn(`[JOB-BOARD] stale lane: window STILL full after excluding ${excluded} tokens — ${rows.length} rows, none fetchable (${filled}); the tail behind row ${STALE_RPC_LIMIT} is unexamined`);
        }
      }
    } catch (e) {
      // accelerator only — the rotation still reaches every board if this throws
      console.warn("[JOB-BOARD] stale lane threw (no lane this hop):", String(e).slice(0, 160));
      staleBoards = [];
    }
  }
  // Base LAST: a base board the budget defers heads the next slice (the cursor counts only base boards started); n426.
  const slice = [...demandBoards, ...bootstrapBoards, ...retryBoards, ...staleBoards, ...deepBoards, ...baseSlice];
  const startIso = new Date().toISOString();
  const freshCutoffMs = Date.now() - FRESH_WINDOW_DAYS * 86_400_000; // roles older than this are dropped

  const vendorStats = new Map<string, { a: number; z: number }>();
  const quarantineSkipped = new Set<string>();
  let skipTokens = new Set<string>();
  let recheckTokens = new Set<string>();
  if (!inHotPhase) {
    // Board keys, not tokens (n417): skipTokens/recheckTokens hold boardKeyOf(s).
    const demandSet = new Set(demandBoards.map(boardKeyOf));
    const eligible = baseSlice.map(boardKeyOf).filter((k) => !demandSet.has(k));
    ({ skip: skipTokens, recheck: recheckTokens } = classifyDormancy(eligible, boardFailures.dormant, Date.now(), DORMANT_RECHECK_MS));
  }
  // Rationale: docs/job-board-index-notes.md#n073-the-cursor-rule-advanceprogress-is-shared-w

  // Rationale: docs/job-board-index-notes.md#n567-const-advanceargs
  const advanceArgs = {
    inHotPhase,
    // Rationale: docs/job-board-index-notes.md#n568-hotslice-effhotslice
    hotSlice: effHotSlice,
    baseSliceLen: baseSlice.length,
    coldListLen: COLD_LIST.length,
  };
  const progressBefore: RefreshProgress = {
    hot, cold, coldDone,
    failedAcc: Array.isArray(pv.failedAcc) ? pv.failedAcc : [],
    failedTotal: Number(pv.failedTotal) || 0,
  };

  // Rationale: docs/job-board-index-notes.md#n569-block
  {
    const { next } = advanceProgress({ prev: progressBefore, ...advanceArgs });
    // Rationale: docs/job-board-index-notes.md#n074-await-admitslice-client-next-force
    if (!(await admitSlice(client, next, { force, prog: (prog as { updated_at: string } | null) ?? null }))) {
      return { ok: true, detail: "skipped — a slice was admitted moments ago" };
    }
  }
  // The demand board this admitted slice took starts its cooldown and counts
  // against the hour, in the row only the refresh writes.
  if (demandTaken.length) await stampDemandServed(client, demandTaken, Date.now()).catch(() => {});

  const queue = [...slice];
  // Boards that read, by board key (n417): the failure state and, since .91, the stale lane (n428).
  const okKeys: string[] = [];
  // Boards whose feed read but whose rows OUR database would not read or
  // store (S11-023): neither a vendor failure nor a stored visit.
  const dbFailedKeys: string[] = [];
  const failed: string[] = [];
  let sliceTotal = 0;
  let fetchedInSlice = 0;
  // Rationale: docs/job-board-index-notes.md#n075-inflightreserve
  let inFlightReserve = 0;
  let boardsDone = 0;
  // Rationale: docs/job-board-index-notes.md#n570-const-basetokens-new-set-baseslice-map
  const baseTokens = new Set(baseSlice.map((b) => b.token));
  let baseAttempted = 0;
  // Board keys started or skipped as dormant: the cursor passes a prefix of these (n446).
  const baseConsumed = new Set<string>();
  // A yield is a wait for somebody else to finish. Counted per board so a
  // wait that cannot end becomes a deferral instead of a spin.
  const yieldsByToken = new Map<string, number>();
  let heapStopped = false;
  let wallStopped = false;
  let sizeStopped = false;
  // Also the set `deepLane.visited` is counted from below: SELECTED IS NOT
  // VISITED, and this is the only thing that can tell them apart.
  const deepTokens = new Set(deepBoards.map((b) => b.token));
  await breadcrumb(client, "slice-start", { boards: queue.length, budget: boardBudget, phase: inHotPhase ? "hot" : "cold", elapsedMs: Date.now() - sliceWallStart });
  const budgetSkipped: string[] = [];
  // Rationale: docs/job-board-index-notes.md#n571-const-oversized-string
  const oversized: string[] = [];
  // Written once per slice, and only when the registry actually changed — a
  // permanently oversize board must not cost a meta write every ten minutes.
  let oversizeDirty = false;
  let lastUpsertError: string | null = null;
  // Rationale: docs/job-board-index-notes.md#n423-one-start-gate
  const canStart = (newBoard: boolean) => startGate({
    fetched: fetchedInSlice, inFlight: inFlightReserve, postingBudget: SLICE_POSTING_BUDGET,
    elapsedMs: Date.now() - sliceWallStart, wallBudgetMs: SLICE_WALL_BUDGET_MS,
    heapMb: memStamp().heapMb, heapLimitMb: HEAP_SOFT_LIMIT_MB,
    ...(newBoard ? { boards: { done: boardsDone, budget: boardBudget } } : {}),
  });
  const lightStats = lightRereadStats();
  const lightRereadDone = new Set<string>();
  sliceLightReread = lightStats;

  await Promise.all(
    Array.from({ length: inHotPhase ? HOT_CONCURRENCY : effConcurrency }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        // Dormant, not due for recheck: skip the dead fetch (no postings to gain,
        // ~20s of FETCH_TIMEOUT to lose). Not counted as attempted below.
        if (skipTokens.has(boardKeyOf(s))) { baseConsumed.add(boardKeyOf(s)); continue; }
        // Checked before STARTING a board: landed postings, board count, wall and heap defer it; a full reservation waits.
        const gate = canStart(true);
        // Rationale: docs/job-board-index-notes.md#n076-fetchedinslice-inflightreserve-slic
        if (gate === "reserve") {
          // Rationale: docs/job-board-index-notes.md#n077-spins
          const spins = (yieldsByToken.get(s.token) ?? 0) + 1;
          yieldsByToken.set(s.token, spins);
          if (inFlightReserve === 0 || spins > YIELD_SPIN_LIMIT) {
            budgetSkipped.push(s.token);
            continue;
          }
          queue.unshift(s);
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        if (gate !== "ok") {
          if (gate === "boards") sizeStopped = true;
          else if (gate === "wall") wallStopped = true;
          else if (gate === "heap") heapStopped = true;
          budgetSkipped.push(s.token);
          continue;
        }
        let failReason = "";
        // Rationale: docs/job-board-index-notes.md#n078-reserve
        const reserve = inHotPhase || deepTokens.has(s.token) || CAPPED_VISIT_VENDORS.has(s.source) || !!s.pages ? MAX_POSTINGS_PER_VISIT : COLD_BOARD_RESERVE;
        if (baseTokens.has(s.token)) baseAttempted++;
        baseConsumed.add(boardKeyOf(s));
        inFlightReserve += reserve;
        let r: Awaited<ReturnType<typeof fetchBoard>>;
        try { r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors.get(s.token) ?? 0); }
        finally { inFlightReserve -= reserve; }
        // Rationale: docs/job-board-index-notes.md#n081-light-reread-in-the-same-visit
        let lightOversize = false;
        if (!r) ({ r, failReason, lightOversize } = await lightReread({
          board: s, failReason, lightCapable: LIGHT_CAPABLE_VENDORS.has(s.source), light: isLight(s),
          enrol: () => enrolDynamicLight(client, s, `list response ${failReason} — over the byte budget`),
          canStart: () => canStart(false) === "ok",
          read: async () => {
            let why = "";
            inFlightReserve += reserve;
            try { return { r: await fetchBoard(s, (m) => { why = m; }, 0), failReason: why }; }
            finally { inFlightReserve -= reserve; }
          },
          done: lightRereadDone, stats: lightStats,
        }));
        // Rationale: docs/job-board-index-notes.md#n411-streamed-oversize-read, #n424-greenhouse-streamed-light-read
        if (!r && failReason.startsWith("oversize") && SLIM_SPECS[s.source] && (s.source !== "greenhouse" || (lightOversize && isLight(s))) && Date.now() - sliceWallStart + STREAM_READ_BUDGET_MS <= SLICE_WALL_BUDGET_MS && (memStamp().heapMb ?? 0) < HEAP_SOFT_LIMIT_MB) {
          inFlightReserve += reserve;
          try { r = await readOversizeBoard(s, Date.now() + STREAM_READ_BUDGET_MS, freshCutoffMs); }
          finally { inFlightReserve -= reserve; }
        }
        if (r) fetchedInSlice += r.jobs.length;
        // Rationale: docs/job-board-index-notes.md#n079-boardsdone
        ++boardsDone;
        await breadcrumb(client, "board-fetched", { boardsDone, token: s.token, got: r ? r.jobs.length : 0, fetched: fetchedInSlice, inFlight: inFlightReserve, elapsedMs: Date.now() - sliceWallStart });
        // Rationale: docs/job-board-index-notes.md#n572-if-deeplane-deeptokens-has-s-token
        if (deepLane && deepTokens.has(s.token)) deepLane.visited++;
        if (!r) {
          // Rationale: docs/job-board-index-notes.md#n080-failreason-startswith-oversize
          if (failReason.startsWith("oversize")) {
            oversized.push(s.token);
            const mb = Number(failReason.match(/([\d.]+)MB/)?.[1]) || 0;
            // Rationale: docs/job-board-index-notes.md#n573-if-noteoversize-oversize_boards-s-mb-sha
            if (noteOversize(OVERSIZE_BOARDS, s, mb, SHARED_TOKENS)) oversizeDirty = true;
            budgetSkipped.push(s.token);
            continue;
          }
          failed.push(`${s.name} (vendor${failReason ? `: ${failReason}` : ""})`);
          // Rationale: docs/job-board-index-notes.md#n082-waituntil-promise-resolve-client-from-job-board
          waitUntil(Promise.resolve(client.from("job_board_board_state").upsert(
            {
              company_token: s.token,
              source: s.source,
              observed_at: new Date().toISOString(),
              live_count: null,
              stored_count: null,
              feed_total: null,
              state: "error",
            },
            { onConflict: "company_token,observed_on", ignoreDuplicates: true },
          )).then(({ error }) => {
            if (error) console.warn(`[JOB-BOARD] board-state error write failed for ${s.token} (non-fatal):`, String(error.message ?? error).slice(0, 150));
          }).catch(() => {}));
          // A deep visit failing for hours starts the next from the top (n420, S8-086).
          {
            const cur = deepCursors.get(s.token) ?? 0;
            const streak = Object.prototype.hasOwnProperty.call(boardFailures.streaks, boardKeyOf(s)) ? Number(boardFailures.streaks[boardKeyOf(s)]) || 0 : 0;
            const ff = boardFailures.firstFailedAt ?? {};
            const since = Object.prototype.hasOwnProperty.call(ff, boardKeyOf(s)) ? Number(ff[boardKeyOf(s)]) : undefined;
            if (cursorAfterFailure(cur, streak, since, Date.now()) !== cur) { deepCursors.delete(s.token); deepCursorsDirty = true; }
          }
          continue;
        }
        // Rationale: docs/job-board-index-notes.md#n574-const-cursorbefore-deepcursors-get-s-tok
        const cursorBefore = deepCursors.get(s.token) ?? 0;
        if (typeof r.nextOffset === "number") {
          const prev = cursorBefore;
          if (r.nextOffset > 0) { if (prev !== r.nextOffset) { deepCursors.set(s.token, r.nextOffset); deepCursorsDirty = true; } }
          else if (prev !== 0) { deepCursors.delete(s.token); deepCursorsDirty = true; }
        }

        // Rationale: docs/job-board-index-notes.md#n083-lapepoch
        let lapEpoch = 0;
        let lapProven = false;
        let lapSeen = 0;
        // See LapState: token-keyed would let a same-token board on ANOTHER
        // vendor read and delete this board's lap.
        const lapKey = `${s.source}:${s.token}`;
        // Rationale: docs/job-board-index-notes.md#n084-lapopens
        const lapOpens = cursorBefore === 0 && typeof r.nextOffset === "number" && r.nextOffset > 0;
        if (r.windowed === true && typeof r.nextOffset === "number") {
          let rec: LapState | undefined = deepLaps[lapKey];
          if (lapOpens) {
            // Rationale: docs/job-board-index-notes.md#n085-rec
            rec = {
              e: Math.max(Math.floor(Date.now() / 1000) - 1_600_000_000, (rec?.e ?? 0) + 1),
              s: 0, t: startIso, f: 0, t0: Math.max(0, Math.trunc(r.feedTotal ?? 0)),
              ...(rec?.w ? { w: rec.w } : {}), ...(rec?.w0 ? { w0: rec.w0 } : {}),
            };
            deepLaps[lapKey] = rec;
            deepCursorsDirty = true;
          } else if (cursorBefore === 0 && rec) {
            // Read whole in one visit (see lapOpens): retire the entry rather
            // than leave a lap that can never close sitting in the meta row.
            delete deepLaps[lapKey];
            deepCursorsDirty = true;
            rec = undefined;
          }
          if (rec) {
            // Rationale: docs/job-board-index-notes.md#n575-const-reached-typeof-r-endoffset-number
            const reached = typeof r.endOffset === "number" && r.endOffset > 0
              ? r.endOffset
              : (typeof r.nextOffset === "number" && r.nextOffset > 0 ? r.nextOffset : cursorBefore + r.jobs.length);
            if (reached > rec.s) { rec.s = reached; deepCursorsDirty = true; }
          }
          if (rec) {
            lapEpoch = rec.e;
            lapSeen = rec.s;
            // Rationale: docs/job-board-index-notes.md#n086-totalnow
            // A mid-feed visit on a tenant that states its total only at offset 0 is judged against the lap's t0 (n413).
            const totalNow = lapTotal(r.feedTotal, cursorBefore, rec.t0);
            const totalRef = Math.max(totalNow, 0);
            const tailSlack = Math.min(LAP_TAIL_SLACK, Math.floor((1 - LAP_COVERAGE_MIN) * totalRef));
            if (r.nextOffset === 0 && cursorBefore > 0 && rec.f === 0 &&
                r.feedEnded === true && !emptyInsideLapTotal(cursorBefore, r.endOffset, rec.t0) &&
                totalRef > 0 && totalNow >= LAP_COVERAGE_MIN * rec.t0 &&
                lapSeen >= totalRef - tailSlack) {
              lapProven = true;
            }
          }
        } else if (deepLaps[lapKey]) {
          // Rationale: docs/job-board-index-notes.md#n576-delete-deeplaps-lapkey
          delete deepLaps[lapKey];
          deepCursorsDirty = true;
        }
        // Rationale: docs/job-board-index-notes.md#n1179-const-faillap
        const failLap = () => {
          const rec = deepLaps[lapKey];
          if (rec && rec.f !== 1) { rec.f = 1; deepCursorsDirty = true; }
        };
        // Rationale: docs/job-board-index-notes.md#n087-s-source-workday-r-jobs-length
        if (s.source === "workday" && r.jobs.length > 0) {
          const tenant = s.token.split("~")[0];
          const isSuffixed = (req: string) => {
            const m = /-\d{1,2}$/.exec(req);
            return !!m && /\d{3}/.test(req.slice(0, m.index));
          };
          // Rationale: docs/job-board-index-notes.md#n577-const-bases-new-set
          const bases = [...new Set(
            r.jobs.map((j) => j.id.split(":")[2] ?? "")
              .filter(isSuffixed)
              .map((req) => req.replace(/-\d{1,2}$/, ""))
              .filter((base) => /^[A-Za-z0-9_-]+$/.test(base)),
          )];
          // Rationale: docs/job-board-index-notes.md#n578-if-bases-length-bases-length-try
          if (bases.length > 0 && bases.length <= 120) try {
            const { data: hits } = await client.from("job_board_postings")
              .select("id")
              .eq("source", "workday")
              .like("company_token", `${tenant}~%`)
              .or(bases.map((base) => `id.like.workday:${tenant}~%:${base}`).join(","))
              .limit(bases.length * 4);
            const held = new Set((hits ?? []).map((h) => String((h as { id: string }).id).split(":")[2] ?? ""));
            if (held.size > 0) {
              // Rationale: docs/job-board-index-notes.md#n088-suffixedids
              const suffixedIds = r.jobs
                .map((j) => j.id)
                .filter((id) => isSuffixed(id.split(":")[2] ?? ""));
              const { data: own } = suffixedIds.length
                ? await client.from("job_board_postings").select("id").in("id", suffixedIds)
                : { data: [] as Array<{ id: string }> };
              const alreadyStored = new Set((own ?? []).map((o) => String((o as { id: string }).id)));
              const before = r.jobs.length;
              r.jobs = r.jobs.filter((j) => {
                const req = j.id.split(":")[2] ?? "";
                if (!isSuffixed(req)) return true;
                if (alreadyStored.has(j.id)) return true; // never route a stored row into the prune
                return !held.has(req.replace(/-\d{1,2}$/, ""));
              });
              const dropped = before - r.jobs.length;
              if (dropped > 0) console.log(`[JOB-BOARD] workday cross-site dedupe: ${s.token} skipped ${dropped} new requisition copies already held by ${tenant}'s other sites`);
            }
          } catch { /* dedupe is an optimisation — the board must still refresh without it */ }
        }
        // Rationale: docs/job-board-index-notes.md#n579-block
        {
          const vs = vendorStats.get(s.source) ?? { a: 0, z: 0 };
          vs.a += 1;
          if (r.jobs.length === 0) vs.z += 1;
          vendorStats.set(s.source, vs);
          if (r.jobs.length === 0 && quarantinedVendors.has(s.source)) {
            quarantineSkipped.add(s.token); // excluded from failure streaks below
            continue;
          }
        }
        const descs = new Map<string, string>();
        // Rationale: docs/job-board-index-notes.md#n580-let-descsdeferred-false
        let descsDeferred = false;
        if (s.source === "lever") {
          for (const j of (Array.isArray(r.raw) ? r.raw : []) as Array<{ id: string; descriptionPlain?: string; descriptionBodyPlain?: string }>) {
            const text = ((j.descriptionPlain ?? "") + (j.descriptionBodyPlain ? `\n${j.descriptionBodyPlain}` : "")).trim();
            if (text) descs.set(`lever:${s.token}:${j.id}`, text.slice(0, STORED_DESC_CAP));
          }
        } else if (s.source === "ashby") {
          for (const j of ((r.raw as { jobs?: Array<{ id: string; descriptionPlain?: string; descriptionHtml?: string }> }).jobs ?? [])) {
            const text = (j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : "")).trim();
            if (text) descs.set(`ashby:${s.token}:${j.id}`, text.slice(0, STORED_DESC_CAP));
          }
        } else if (s.source === "greenhouse" && !isLight(s)) {
          const ghJobs = (r.raw as { jobs?: Array<{ id: number; content?: string }> }).jobs ?? [];
          // Rationale: docs/job-board-index-notes.md#n581-const-contentchars-ghjobs-reduce-n-j
          const contentChars = ghJobs.reduce((n, j) => n + (j.content?.length ?? 0), 0);
          if (contentChars >= AUTO_LIGHT_THRESHOLD_CHARS) {
            // Rationale: docs/job-board-index-notes.md#n089-await-enroldynamiclight-client-s-token
            if (!await enrolDynamicLight(client, s, `content payload ${(contentChars / 1e6).toFixed(1)}MB >= threshold`)) descsDeferred = true;
          } else {
            for (const j of ghJobs) {
              const text = j.content ? htmlToText(String(j.content).slice(0, RAW_HTML_CAP)).trim() : "";
              if (text) descs.set(`greenhouse:${s.token}:${j.id}`, text.slice(0, STORED_DESC_CAP));
            }
          }
        } else if (s.source === "recruitee") {
          for (const o of ((r.raw as { offers?: Array<{ id: string | number; description?: string; requirements?: string }> }).offers ?? [])) {
            const text = htmlToText([o.description, o.requirements].filter(Boolean).join("\n").slice(0, RAW_HTML_CAP)).trim();
            if (text) descs.set(`recruitee:${s.token}:${o.id}`, text.slice(0, STORED_DESC_CAP));
          }
        } else if (s.source === "workable" && !isLight(s)) {
          // Rationale: docs/job-board-index-notes.md#n582-const-wkjobs-r-raw-as-jobs
          const wkJobs = (r.raw as { jobs?: Array<{ shortcode?: string; description?: string }> }).jobs ?? [];
          const contentChars = wkJobs.reduce((n, j) => n + (j.description?.length ?? 0), 0);
          if (contentChars >= AUTO_LIGHT_THRESHOLD_CHARS) {
            // Rationale: docs/job-board-index-notes.md#n090-await-enroldynamiclight-client-s-token
            if (!await enrolDynamicLight(client, s, `workable payload ${(contentChars / 1e6).toFixed(1)}MB >= threshold`)) descsDeferred = true;
          } else {
            for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
          }
        } else if (s.source === "pinpoint") {
          // Rationale: docs/job-board-index-notes.md#n583-for-const-k-v-of-listpayloaddescriptions
          for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
        } else if (s.source === "icims") {
          // Rationale: docs/job-board-index-notes.md#n584-for-const-k-v-of-listpayloaddescriptions
          for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
        // Rationale: docs/job-board-index-notes.md#n585-else-if-s-source-personio-typeof
        } else if (s.source === "personio" && typeof r.raw === "string") {
          for (const block of xmlBlocks(r.raw, "position")) {
            const pid = xmlValue(block, "id");
            const text = htmlToText(xmlBlocks(block, "jobDescription").map((d) => xmlValue(d, "value") ?? "").join("\n").slice(0, RAW_HTML_CAP)).trim();
            if (pid && text) descs.set(`personio:${s.token}:${pid}`, text.slice(0, STORED_DESC_CAP));
          }
        } else if (s.source === "teamtailor" && typeof r.raw === "string") {
          for (const item of xmlBlocks(r.raw, "item")) {
            const link = xmlValue(item, "link") ?? "";
            const idMatch = link.match(/\/jobs\/(\d+)/);
            const text = htmlToText((xmlValue(item, "description") ?? "").slice(0, RAW_HTML_CAP)).trim();
            if (idMatch && text) descs.set(`teamtailor:${s.token}:${idMatch[1]}`, text.slice(0, STORED_DESC_CAP));
          }
        } else if (s.source === "usajobs") {
          // The summary and duties sit under UserArea.Details (S8-023); every federal row stored none before .92.
          for (const [k, v] of usajobsDescriptions((r.raw as { items?: unknown[] }).items, s.token)) descs.set(k, v.slice(0, STORED_DESC_CAP));
        }
        const clean = (x: string | null | undefined) => (x == null ? null : x.replace(/\u0000/g, ""));
        // Rationale: docs/job-board-index-notes.md#n586-const-lightdescs-islight-s-descsdeferred
        const lightDescs = isLight(s) || descsDeferred;
        const rowsById = new Map<string, Record<string, unknown>>();
        // Rationale: docs/job-board-index-notes.md#n091-schedulewordsbyid
        const scheduleWordsById = new Map<string, string>();
        // Rationale: docs/job-board-index-notes.md#n587-const-agedoutids-new-set-string
        const agedOutIds = new Set<string>();
        for (const j of r.jobs) {
          const posted = sanePostedAt(j.postedAt); // reject garbage feed dates at the door
          // Salary resolves once — vendor text wins, else description mining —
          // and the structured parse feeds the salary-floor filter/benchmarks.
          const salaryText = (clean(j.salary?.slice(0, 200) ?? null) || null) ?? (lightDescs ? null : extractSalary(descs.get(j.id) ?? null));
          // Rationale: docs/job-board-index-notes.md#n588-if-isdatedbefore-posted-freshcutoffms-ag
          if (isDatedBefore(posted, freshCutoffMs)) { agedOutIds.add(j.id); continue; }
          // Experience band from the best text we have this pass (title + the
          // fetched description where the vendor provides one). null → "unspecified".
          const exp = detectExperience(j.title ?? "", lightDescs ? null : (descs.get(j.id) ?? null));
          const rowCountry = j.country ?? detectCountry(j.location);
          if (j.employmentTypeText) scheduleWordsById.set(j.id, j.employmentTypeText);
          rowsById.set(j.id, {
            id: j.id,
            source: j.source,
            company_token: j.token,
            // Rationale: docs/job-board-index-notes.md#n589-j-source-oracle-req_key-oraclereqkeyofid
            ...(j.source === "oracle" ? { req_key: oracleReqKeyOfId(j.id) } : {}),
            company: j.company,
            // One apostrophe in what we store, the one a search folds to (S11-021).
            title: clean(foldApostrophes(j.title.trim()).slice(0, 300)),
            location: clean(foldApostrophes(j.location.trim()).slice(0, 300)),
            country: rowCountry,
            // Rationale: docs/job-board-index-notes.md#n590-region_code-detectregion-j-location-rowc
            region_code: detectRegion(j.location, rowCountry),
            remote: j.remote,
            work_mode: j.workMode ?? null,
      employment_type: j.employmentType ?? null,
            // Rationale: docs/job-board-index-notes.md#n591-agency-s-agency-true
            agency: s.agency === true,
            department: clean(j.department?.slice(0, 200) ?? null),
            category: j.category,
            posted_at: posted,
            apply_url: j.applyUrl,
            // Rationale: docs/job-board-index-notes.md#n592-salary-salarytext
            salary: salaryText,
            ...(() => {
              // Rationale: docs/job-board-index-notes.md#n092-p
              const p = parseSalaryStructured(salaryText, j.country ?? detectCountry(j.location), { title: j.title ?? null, description: lightDescs ? null : (descs.get(j.id) ?? null), employmentType: scheduleWordsById.get(j.id) ?? null });
              return {
                salary_min_annual: p?.annualMin ?? null,
                salary_max_annual: p?.annualMax ?? null,
                salary_period: p?.period ?? null,
                salary_currency: p?.currency ?? null,
              };
            })(),
            experience_band: exp.band ?? "unspecified",
            min_years: exp.minYears,
            // Light boards omit the column so previously stored descriptions
            // survive the upsert instead of being nulled.
            ...(lightDescs ? {} : { description: clean(descs.get(j.id) ?? null) }),
            last_seen: startIso, // set at INSERT only — semantically first_seen; rows are never rewritten
          });
        }
        const rows = [...rowsById.values()];

        // Rationale: docs/job-board-index-notes.md#n593-let-boardok-true
        let boardOk = true;
        // Rationale: docs/job-board-index-notes.md#n594-type-existingrow
        type ExistingRow = {
          id: string; missing_since: string | null;
          title?: string | null; location?: string | null; country?: string | null;
          apply_url?: string | null; work_mode?: string | null; remote?: boolean | null;
          salary?: string | null; agency?: boolean | null; employment_type?: string | null;
          region_code?: string | null; first_seen?: string | null;
          /** Which lap last SERVED this row. See deepLaps. Absent/NULL = never, or not read this visit. */
          lap_epoch?: number | null;
        };
        const existingRows: Array<ExistingRow> = [];
        let missingColUnknown = false; // pre-migration: column absent → legacy single-pass behavior
        // pre-migration: region_code absent → never patch it, or every visited
        // row of every board queues a no-op correction forever (below).
        let regionColUnknown = false;
        // Rationale: docs/job-board-index-notes.md#n093-lapcolunknown
        let lapColUnknown = false;
        for (let from = 0; ; from += 1000) {
          // Rationale: docs/job-board-index-notes.md#n094-res
          let res = await client
            .from("job_board_postings")
            .select("id,lap_epoch,missing_since,title,location,country,region_code,apply_url,work_mode,employment_type,remote,salary,agency,first_seen")
            .eq("company_token", s.token)
            .order("id")
            .range(from, from + 999);
          // The lap column's own deploy window, FIRST because its fallback is
          // the exact select the other three already know how to degrade.
          if (res.error?.message?.includes("lap_epoch")) {
            lapColUnknown = true;
            res = (await client
              .from("job_board_postings")
              .select("id,missing_since,title,location,country,region_code,apply_url,work_mode,employment_type,remote,salary,agency,first_seen")
              .eq("company_token", s.token)
              .order("id")
              .range(from, from + 999)) as typeof res;
          }
          // Rationale: docs/job-board-index-notes.md#n595-if-res-error-message-includes-region_cod
          if (res.error?.message?.includes("region_code")) {
            regionColUnknown = true;
            lapColUnknown = true; // the narrower list below does not carry it
            res = (await client
              .from("job_board_postings")
              .select("id,missing_since,title,location,country,apply_url,work_mode,employment_type,remote,salary,agency,first_seen")
              .eq("company_token", s.token)
              .order("id")
              .range(from, from + 999)) as typeof res;
          }
          // Rationale: docs/job-board-index-notes.md#n596-if-res-error-message-includes-agency
          if (res.error?.message?.includes("agency")) {
            lapColUnknown = true; // as above: this list does not carry it either
            res = (await client
              .from("job_board_postings")
              .select("id,missing_since,title,location,country,apply_url,work_mode,employment_type,remote,salary,first_seen")
              .eq("company_token", s.token)
              .order("id")
              .range(from, from + 999)) as typeof res;
          }
          if (res.error?.message?.includes("missing_since")) {
            missingColUnknown = true;
            lapColUnknown = true; // an id-only read carries no lap evidence
            res = (await client
              .from("job_board_postings")
              .select("id")
              .eq("company_token", s.token)
              .order("id")
              .range(from, from + 999)) as typeof res;
          }
          const { data: page, error: readErr } = res;
          if (readErr) {
            boardOk = false;
            lastUpsertError = `${s.token}: ${readErr.message}`;
            break;
          }
          existingRows.push(...((page ?? []) as Array<ExistingRow>).map((r) => ({
            id: r.id, missing_since: r.missing_since ?? null,
            title: r.title ?? null, location: r.location ?? null, country: r.country ?? null,
            apply_url: r.apply_url ?? null, work_mode: r.work_mode ?? null,
            remote: r.remote ?? null, salary: r.salary ?? null,
            // Rationale: docs/job-board-index-notes.md#n095-agency-r-agency-null-employment-type-r-emp
            agency: r.agency ?? null, employment_type: r.employment_type ?? null,
            region_code: r.region_code ?? null,
            // Rationale: docs/job-board-index-notes.md#n597-first_seen-r-as-first_seen-string-null
            first_seen: (r as { first_seen?: string | null }).first_seen ?? null,
            // Rationale: docs/job-board-index-notes.md#n598-lap_epoch-r-as-lap_epoch-number-null
            lap_epoch: (r as { lap_epoch?: number | null }).lap_epoch ?? null,
          })));
          if (!page || page.length < 1000) break;
        }
        if (!boardOk) {
          failed.push(`${s.name} (db-read)`);
          // Rationale: docs/job-board-index-notes.md#n599-faillap
          failLap();
          // Our read failed, not the vendor's feed (S11-023).
          dbFailedKeys.push(boardKeyOf(s));
          continue;
        }
        // Rationale: docs/job-board-index-notes.md#n096-servedthisvisit
        const servedThisVisit = rowsById.size;
        if (s.source === "oracle" && ORACLE_SITE_RANK.has(s.token) && Date.now() >= oracleReqKeyMissingUntil) {
          const myRank = ORACLE_SITE_RANK.get(s.token)!;
          const stored = new Map<string, string>(); // reqId -> id, this site's own rows
          for (const ex of existingRows) {
            if (!ex.id.startsWith(`oracle:${s.token}:`)) continue;
            const rq = oracleReqIdOfId(ex.id);
            if (rq) stored.set(rq, ex.id);
          }
          const fetched: string[] = [];
          for (const id of rowsById.keys()) { const rq = oracleReqIdOfId(id); if (rq) fetched.push(rq); }
          const keys = [...new Set([...fetched, ...stored.keys()].map((rq) => oracleReqKey(s.token, rq)).filter((k): k is string => !!k))];
          const holders = new Map<string, OracleHolderRow[]>();
          const holderRows = new Map<string, Record<string, unknown>>();
          let lookupOk = keys.length > 0;
          // Rationale: docs/job-board-index-notes.md#n097-holder-keys-per-query
          const HOLDER_KEYS_PER_QUERY = 100;
          lookup: for (let i = 0; i < keys.length; i += HOLDER_KEYS_PER_QUERY) {
            const chunk = keys.slice(i, i + HOLDER_KEYS_PER_QUERY);
            for (let from = 0; ; from += 1000) {
              const { data, error } = await client
                .from("job_board_postings")
                .select(`${LIFECYCLE_SELECT}, req_key, missing_since`)
                .in("req_key", chunk)
                .order("id")
                .range(from, from + 999);
              if (error) {
                lookupOk = false;
                if (error.message?.includes("req_key")) {
                  oracleReqKeyMissingUntil = Date.now() + ORACLE_REQ_KEY_BACKOFF_MS;
                  console.warn(`[JOB-BOARD] oracle sub-site dedupe OFF for ${ORACLE_REQ_KEY_BACKOFF_MS / 60_000} min: job_board_postings.req_key absent (migration 20260909216000 not applied yet)`);
                } else {
                  console.warn(`[JOB-BOARD] ${s.token}: oracle holder lookup failed (dedupe skipped this visit):`, String(error.message ?? "").slice(0, 120));
                }
                break lookup;
              }
              const page = (data ?? []) as Array<Record<string, unknown>>;
              for (const row of page) {
                const key = String(row.req_key ?? "");
                const tok = String(row.company_token ?? "");
                const id = String(row.id ?? "");
                if (!key || !id) continue;
                const list = holders.get(key) ?? [];
                list.push({ id, token: tok, rank: ORACLE_SITE_RANK.get(tok) ?? null, missing: row.missing_since != null });
                holders.set(key, list);
                holderRows.set(id, row);
              }
              if (page.length < 1000) break;
              if (from + 1000 >= 100_000) { // a runaway read is not a holder set
                lookupOk = false;
                console.warn(`[JOB-BOARD] ${s.token}: oracle holder lookup exceeded 100k rows for ${chunk.length} keys (dedupe skipped this visit)`);
                break lookup;
              }
            }
          }
          if (lookupOk) {
            // Rationale: docs/job-board-index-notes.md#n098-windowedread
            const windowedRead = r.windowed === true;
            const plan = planOracleSubsiteVisit({ token: s.token, rank: myRank, fetched, stored, holders, fullRead: !windowedRead });
            for (const rq of plan.dropReqIds) rowsById.delete(`oracle:${s.token}:${rq}`);
            // `rows` was materialised from rowsById above and feeds newRows; keep the two in step.
            if (plan.dropReqIds.size) rows.splice(0, rows.length, ...rows.filter((row) => rowsById.has(String(row.id))));
            const shed = [...plan.shedMineIds, ...plan.shedSiblingIds];
            if (shed.length) {
              // Rationale: docs/job-board-index-notes.md#n600-const-exitedat-new-date-toisostring
              const exitedAt = new Date().toISOString();
              // Rationale: docs/job-board-index-notes.md#n601-const-unread-shed-filter-id-holderrows
              const unread = shed.filter((id) => !holderRows.has(id));
              for (let i = 0; i < unread.length; i += 200) {
                const { data: byId, error: byIdErr } = await client
                  .from("job_board_postings")
                  .select(LIFECYCLE_SELECT)
                  .in("id", unread.slice(i, i + 200));
                if (byIdErr) { console.warn(`[JOB-BOARD] ${s.token}: oracle dedupe could not read ${unread.length} shed row(s) by id (exit rows degrade to id-only):`, String(byIdErr.message ?? "").slice(0, 120)); break; }
                for (const row of (byId ?? []) as unknown as Array<Record<string, unknown>>) holderRows.set(String(row.id), row);
              }
              const shedRows = shed.map((id) => holderRows.get(id) ?? { id, source: "oracle", company_token: s.token });
              const exitRow = (r: Record<string, unknown>) => {
                const t = tenureDays(r.posted_at, r.first_seen, exitedAt);
                return {
                  posting_id: String(r.id),
                  source: String(r.source ?? "oracle"),
                  company_token: String(r.company_token ?? s.token),
                  company: (r.company as string | null) ?? null,
                  title: (r.title as string | null) ?? null,
                  category: String(r.category ?? "other"),
                  exit_reason: "untracked",
                  posted_at: r.posted_at ?? null,
                  days_on_board: t.days,
                  origin_basis: t.basis,
                  exited_at: exitedAt,
                  ...lifecycleFacets(r),
                };
              };
              const { error: exErr } = await insertExits(client, shedRows.map(exitRow), s.token);
              // No exit rows, no delete (n416): the copies stay one more visit and the shed retries.
              if (exErr) console.warn(`[JOB-BOARD] oracle dedupe exit-log insert failed for ${s.token} (${shed.length} row(s) kept, retried next visit):`, String(exErr.message ?? "").slice(0, 120));
              else for (let i = 0; i < shed.length; i += 200) {
                const { error: delErr } = await client.from("job_board_postings").delete().in("id", shed.slice(i, i + 200));
                if (delErr) console.warn(`[JOB-BOARD] oracle dedupe delete failed for ${s.token} (retries next visit):`, String(delErr.message ?? "").slice(0, 120));
              }
              // Shed rows leave this visit's stored set here, before the
              // absence logic reads it, so they are neither stamped nor closed.
              const shedMine = new Set(plan.shedMineIds);
              if (shedMine.size) existingRows.splice(0, existingRows.length, ...existingRows.filter((ex) => !shedMine.has(ex.id)));
            }
            if (plan.dropReqIds.size || shed.length) {
              console.log(`[JOB-BOARD] ${s.token}: oracle sub-site dedupe — ${plan.dropReqIds.size} served req(s) left to a better-ranked site, ${plan.shedMineIds.length} own row(s) and ${plan.shedSiblingIds.length} sibling row(s) exited untracked`);
            }
          }
        }
        const prefix = `${s.source}:`;
        const existingById = new Map(existingRows.filter((r) => r.id.startsWith(prefix)).map((r) => [r.id, r]));
        const missingSinceById = new Map([...existingById].map(([k, v]) => [k, v.missing_since]));
        const existing = new Set(missingSinceById.keys());
        const liveIds = new Set(rowsById.keys());
        let newRows = rows.filter((r) => !existing.has(r.id as string));
        // Rationale: docs/job-board-index-notes.md#n099-newrows-length-0
        // Tombstoned ids the feed has since re-dated; their tombstones move only after the insert lands.
        // Rationale: docs/job-board-index-notes.md#n412-redated-past-tombstone
        let readmitted: Array<Record<string, unknown>> = [];
        if (newRows.length > 0) {
          try {
            const tombs: Tombstone[] = [];
            const ids = newRows.map((r) => String(r.id));
            for (let i = 0; i < ids.length; i += 200) {
              const { data: tomb, error: tErr } = await client
                .from("job_board_aged_out")
                .select("id, posted_at, aged_at")
                .in("id", ids.slice(i, i + 200));
              if (tErr) throw tErr;
              tombs.push(...((tomb ?? []) as Tombstone[]));
            }
            const verdict = splitTombstoned(newRows, tombs, { cutoffMs: freshCutoffMs });
            const blocked = verdict.refused;
            readmitted = verdict.readmitted;
            if (blocked.size > 0) {
              newRows = newRows.filter((r) => !blocked.has(String(r.id)));
              console.log(`[JOB-BOARD] ${s.token}: ${blocked.size} aged-out posting(s) refused re-entry`);
            }
            if (readmitted.length > 0) {
              console.log(`[JOB-BOARD] ${s.token}: ${readmitted.length} aged-out posting(s) re-admitted — the feed re-dated them past their tombstone`);
            }
          } catch (e) {
            console.warn(`[JOB-BOARD] aged-out check skipped for ${s.token}:`, String((e as Error)?.message ?? e).slice(0, 120));
          }
        }
        const vanishedAll = [...existing].filter((id) => !liveIds.has(id));

        // Rationale: docs/job-board-index-notes.md#n100-grace-ms
        const GRACE_MS = 5 * 60 * 1000;
        const RATCHET_MS = 6 * 60 * 60 * 1000;
        const SHRINK_RATIO = 0.6;
        const nowMs = Date.now();
        let vanished: string[];
        const toStamp: string[] = [];
        let toUnstamp: string[] = [];
        // Rationale: docs/job-board-index-notes.md#n602-const-lapmark-missingcolunknown-lapcolun
        const lapMark = missingColUnknown || lapColUnknown ? 0 : lapEpoch;
        // Rationale: docs/job-board-index-notes.md#n101-lapmark-0-faillap
        if (lapMark === 0) failLap();
        // The one visit per lap that may conclude a posting is gone.
        const lapMode = r.windowed === true && lapProven && lapMark > 0;
        // Rationale: docs/job-board-index-notes.md#n102-lapbackfilluntil
        const lapBackfillUntil = lapMode ? (deepLaps[lapKey]?.w0 ?? startIso) : "";
        // Rationale: docs/job-board-index-notes.md#n603-if-lapmode
        if (lapMode) {
          const lrec = deepLaps[lapKey];
          if (lrec) {
            lrec.w = startIso;
            if (!lrec.w0) lrec.w0 = startIso;
            deepCursorsDirty = true; // the receipt must survive the hop, even if no offset moved
          }
        }
        // Rationale: docs/job-board-index-notes.md#n604-let-absencecount
        let absenceCount = 0;
        if (missingColUnknown) {
          vanished = vanishedAll; // legacy behavior until the migration applies
          for (const id of vanishedAll) if (!agedOutIds.has(id)) absenceCount++;
        } else {
          const partialRead = r.windowed === true;
          // Rationale: docs/job-board-index-notes.md#n103-for-const-id-of-vanishedall
          for (const id of vanishedAll) {
            if (agedOutIds.has(id)) continue;
            if (partialRead && !(lapMode && existingById.get(id)?.lap_epoch !== lapMark)) continue;
            absenceCount++;
          }
          const shrinkNumerator = partialRead ? absenceCount : vanishedAll.length;
          const bigShrink = existing.size >= 20 && shrinkNumerator > SHRINK_RATIO * existing.size;
          const needMs = bigShrink ? RATCHET_MS : GRACE_MS;
          if (bigShrink && shrinkNumerator) {
            console.warn(`[JOB-BOARD] ${s.token}: ${shrinkNumerator}/${existing.size} postings vanished in one ${partialRead ? "lap" : "pass"} — shrink ratchet holds closures for 6h`);
          }
          // A stamp written since this lap opened is this lap's own first miss, even on a replayed proof (n440).
          const lapOpenMs = lapMode ? Date.parse(deepLaps[lapKey]?.t ?? "") : NaN;
          // Rationale: docs/job-board-index-notes.md#n104-vanished
          vanished = [];
          for (const id of vanishedAll) {
            if (agedOutIds.has(id)) { vanished.push(id); continue; } // freshness cap — no grace, no log
            if (partialRead && !(lapMode && existingById.get(id)?.lap_epoch !== lapMark)) continue; // absence unprovable — do not stamp, do not delete
            const stamp = missingSinceById.get(id);
            const stampMs = stamp ? new Date(stamp).getTime() : NaN;
            if (stamp && nowMs - stampMs >= needMs && !(lapMode && stampMs >= lapOpenMs)) vanished.push(id); // confirmed gone
            else if (!stamp) toStamp.push(id); // first miss — stamp only
            // recent stamp → still in grace, leave as-is
          }
          // Rationale: docs/job-board-index-notes.md#n105-tounstamp-liveids-filter-id
          toUnstamp = [...liveIds].filter((id) => {
            const ex = existingById.get(id);
            if (!ex) return false; // inserted this visit — it carries the epoch already
            if (ex.missing_since) return true;
            return lapMark > 0 && ex.lap_epoch !== lapMark;
          });
        }
        for (let i = 0; i < toStamp.length; i += 200) {
          const { error: stErr } = await client.from("job_board_postings")
            .update({ missing_since: startIso }).in("id", toStamp.slice(i, i + 200));
          if (stErr) console.warn(`[JOB-BOARD] missing-stamp failed for ${s.token} (retries next pass):`, stErr.message?.slice(0, 120));
        }
        for (let i = 0; i < toUnstamp.length; i += 200) {
          const { error: unErr } = await client.from("job_board_postings")
            .update({ missing_since: null, ...(lapMark > 0 ? { lap_epoch: lapMark } : {}) })
            .in("id", toUnstamp.slice(i, i + 200));
          if (unErr) {
            console.warn(`[JOB-BOARD] missing-unstamp failed for ${s.token} (harmless until next miss):`, unErr.message?.slice(0, 120));
            // Rationale: docs/job-board-index-notes.md#n605-if-lapmark-faillap
            if (lapMark > 0) failLap();
          }
        }

        // Rationale: docs/job-board-index-notes.md#n106-corrections
        const corrections: Array<Record<string, unknown>> = [];
        // Rationale: docs/job-board-index-notes.md#n606-const-changemarks-number
        const changeMarks: number[] = [];
        // Rationale: docs/job-board-index-notes.md#n107-derived-not-employer-edits
        // country too (wave 3, L7-14/L7-15): a COUNTRY_MAP_VERSION change re-derives it on
        // the next read with the location unchanged, and an employer's own move logs as location.
        const DERIVED_NOT_EMPLOYER_EDITS = new Set(["region_code", "country"]);
        // Rationale: docs/job-board-index-notes.md#n108-vendor-field-first-read
        const VENDOR_FIELD_FIRST_READ = new Set(["personio:salary"]);
        // .92 changed how these federal fields are read (S8-023, S8-083): the patches land, unlogged. Remove after 2026-11-09 (n444).
        const OUR_READING_CHANGED = new Set(["usajobs:country", "usajobs:work_mode", "usajobs:remote", "usajobs:salary"]);
        // ONE-SHOT, REMOVE AFTER ONE COLD ROTATION (wave 3, L7-04/L7-05): the Lever and
        // Recruitee pay text is re-formatted (exact figures, the stated period), so the
        // first rewrite of a stored figure is our correction, not an employer edit.
        // Remove after 2026-11-09: a dated test fails from that day while this set exists
        // (S11-136), since an employer's real pay edit on these vendors goes unlogged.
        const OUR_PAY_REWRITE = new Set(["lever", "recruitee"]);
        const FIELD_CHANGES_PER_VISIT = 500;
        const VALUE_CAP = 1_000; // salary strings and titles both fit generously
        const changeLog: Array<Record<string, unknown>> = [];
        const changeAt = new Date().toISOString();
        let changesDropped = 0;
        // Rationale: docs/job-board-index-notes.md#n109-changecapat
        let changeCapAt = -1;
        let changeCapLogAt = -1;
        // Rationale: docs/job-board-index-notes.md#n607-let-changecutat
        let changeCutAt = -1;
        // Rationale: docs/job-board-index-notes.md#n608-const-corrections_per_visit-_000
        const CORRECTIONS_PER_VISIT = 1_000;
        for (const [id, row] of rowsById) {
          const prev = existingById.get(id);
          if (!prev) continue; // brand new — handled by newRows below
          const patch: Record<string, unknown> = {};
          // Where this posting's notes begin, so the cap can cut on a whole
          // posting rather than between two of its fields.
          const logMark = changeLog.length;
          // A NUL byte is legal in a JS string and illegal in a Postgres text
          // value: one would fail the entire batched insert.
          const capped = (v: unknown): string | null =>
            v === null || v === undefined ? null : String(v).replace(/\u0000/g, "").slice(0, VALUE_CAP);
          const note = (field: string, oldV: unknown, newV: unknown) => {
            if (DERIVED_NOT_EMPLOYER_EDITS.has(field) || OUR_READING_CHANGED.has(`${s.source}:${field}`)) return;
            // Ingest folding a stored curly apostrophe is our reading changing,
            // not the employer editing the posting (S11-021): patched, unlogged.
            if (sameButApostrophes(oldV, newV)) return;
            if (changeLog.length >= FIELD_CHANGES_PER_VISIT) {
              // Rationale: docs/job-board-index-notes.md#n609-if-changecapat-changecapat-corrections-l
              if (changeCapAt < 0) { changeCapAt = corrections.length; changeCapLogAt = logMark; }
              changesDropped++;
              return;
            }
            changeLog.push({
              posting_id: id,
              company_token: s.token,
              source: s.source,
              field,
              old_value: capped(oldV),
              new_value: capped(newV),
              observed_at: changeAt,
            });
          };
          const put = (k: string, next: unknown, cur: unknown, allowNull: boolean) => {
            if (next === null || next === undefined || next === "") { if (!allowNull) return; }
            if (next !== cur) { patch[k] = next ?? null; note(k, cur, next ?? null); }
          };
          // The list's weaker reading never overwrites what the detail sweep filled.
          // Rationale: docs/job-board-index-notes.md#n419-two-readers-one-posting
          const listPlaceholder = isPlacelessLocation(row.location as string | null) && !isPlacelessLocation(prev.location as string | null);
          const keepStoredMode = !listMayRewriteMode(s.source, prev as { work_mode?: string | null; location?: string | null; title?: string | null }, row as { location?: string | null; title?: string | null });
          // Vendor-authoritative on every fetch: correct these even to null.
          put("title", row.title, prev.title, false);
          if (!listPlaceholder) put("location", row.location, prev.location, false);
          put("apply_url", row.apply_url, prev.apply_url, false);
          put("country", row.country, prev.country, false);
          // Rationale: docs/job-board-index-notes.md#n110-regioncolunknown
          if (!regionColUnknown) {
            const nextRegion = ((row as Record<string, unknown>).region_code as string | null) ?? null;
            put("region_code", nextRegion, prev.region_code, false);
            // Rationale: docs/job-board-index-notes.md#n111-nextregion-null-prev-region-code
            if (nextRegion === null && prev.region_code != null && (patch.location !== undefined || patch.country !== undefined)) {
              patch.region_code = null;
            }
          }
          // Stated-only: silence from the vendor must not erase enrichment.
          if (!keepStoredMode) put("work_mode", row.work_mode, prev.work_mode, false);
          put("employment_type", (row as Record<string, unknown>).employment_type, (prev as Record<string, unknown>).employment_type, false);
          // Rationale: docs/job-board-index-notes.md#n112-nextpay
          const nextPay = (row.salary ?? null) as string | null;
          const curPay = (prev.salary ?? null) as string | null;
          const payCountry = ((row.country ?? prev.country) ?? null) as string | null;
          const sameMoney = statesTheSameMoney(nextPay, curPay, payCountry);
          // Rationale: docs/job-board-index-notes.md#n610-const-firstvendorread-curpay-null-nextpa
          const firstVendorRead = curPay === null && nextPay !== null && VENDOR_FIELD_FIRST_READ.has(`${s.source}:salary`);
          // Only a CHANGED text is a rewrite: the same string patched every salaried
          // Lever and Recruitee row on every visit (S11-136).
          const ourRewrite = curPay !== null && nextPay !== null && curPay !== nextPay && OUR_PAY_REWRITE.has(s.source);
          if (sameMoney || firstVendorRead || ourRewrite) patch.salary = nextPay;
          else put("salary", row.salary, prev.salary, false);
          // Rationale: docs/job-board-index-notes.md#n113-patch-salary-undefined
          if (patch.salary !== undefined) {
            const rp = parseSalaryStructured(
              row.salary as string | null,
              (patch.country ?? row.country ?? prev.country) as string | null | undefined,
              // Rationale: docs/job-board-index-notes.md#n114-title-row-title-as-string-null-null-d
              { title: (row.title as string | null) ?? null, description: lightDescs ? null : (descs.get(id) ?? null), employmentType: scheduleWordsById.get(id) ?? null },
            );
            patch.salary_min_annual = rp?.annualMin ?? null;
            patch.salary_max_annual = rp?.annualMax ?? null;
            patch.salary_period = rp?.period ?? null;
            patch.salary_currency = rp?.currency ?? null;
          }
          // Rationale: docs/job-board-index-notes.md#n115-nextmode
          if (typeof row.remote === "boolean" && !keepStoredMode) {
            if (row.remote !== prev.remote) {
              patch.remote = row.remote;
              note("remote", prev.remote, row.remote);
            }
            // A REFUSAL THAT CANNOT BE WRITTEN IS NOT A REFUSAL. This used to
            // sit INSIDE the `row.remote !== prev.remote` test above, so the
            // trinary could only move when the boolean moved with it — and
            // remote is false for hybrid, for onsite AND for null, so every
            // transition inside that set was unwritable. put() above cannot
            // carry them either: it is stated-only and returns on a null.
            //
            // Net effect, measured live 2026-10-01 on
            // ukg:…:692bd5bf-2be4-4ddd-9e24-e32c507bb43f: a UKG dropdown
            // reading On-site under the title "Pre-Visit Specialist I - Call
            // Center *Hybrid*". normalizeUkg refuses that contradiction and
            // answers null, as .78 intended — and the row still served
            // "hybrid", because hybrid→null leaves remote false→false and
            // nothing wrote it. The fabrication .78 was shipped to remove
            // outlived the bundle that removed it, on every row where the
            // correction did not happen to flip the boolean.
            //
            // The pair is ONE fact (every normalizer derives
            // `remote: workMode === "remote"` from the one trinary), so the
            // gate is "did the normalizer compute the pair at all", not "did
            // the boolean change". A null under that gate is this visit's
            // computed answer, not vendor silence — which is the distinction
            // the stated-only put() cannot make.
            const nextMode = ((row as Record<string, unknown>).work_mode ?? null) as string | null;
            // Rationale: docs/job-board-index-notes.md#n611-if-nextmode-prev-work_mode-patch-work_mo
            if (nextMode !== prev.work_mode && patch.work_mode === undefined) {
              patch.work_mode = nextMode;
              note("work_mode", prev.work_mode, nextMode);
            }
          }
          // Rationale: docs/job-board-index-notes.md#n612-if-typeof-row-agency-boolean-typeof
          if (typeof row.agency === "boolean" && typeof prev.agency === "boolean" && row.agency !== prev.agency) {
            patch.agency = row.agency;
          }
          if (Object.keys(patch).length) corrections.push({ id, ...patch });
          // Keep the marks index-aligned with the array above: one entry per
          // queued patch, holding the log length at that moment.
          if (changeMarks.length < corrections.length) changeMarks.push(changeLog.length);
          // The change log's high-water mark at the moment the cap is reached.
          // Everything after this index belongs to a patch the cap will drop.
          if (changeCutAt < 0 && corrections.length === CORRECTIONS_PER_VISIT) changeCutAt = changeLog.length;
        }
        // Rationale: docs/job-board-index-notes.md#n116-changecapat-0
        if (changeCapAt >= 0) {
          if (corrections.length > changeCapAt) {
            console.log(`[JOB-BOARD] field-change log filled for ${s.token}: deferring ${corrections.length - changeCapAt} correction(s) to the next rotation visit so their history is not lost`);
            corrections.length = changeCapAt;
            changeMarks.length = changeCapAt;
          }
          // Drop the partially-noted posting's rows with its patch.
          if (changeCapLogAt >= 0 && changeLog.length > changeCapLogAt) changeLog.length = changeCapLogAt;
        }
        if (corrections.length > CORRECTIONS_PER_VISIT) {
          console.log(`[JOB-BOARD] corrections capped for ${s.token}: applying ${CORRECTIONS_PER_VISIT} of ${corrections.length} (remainder on next rotation visit)`);
          corrections.length = CORRECTIONS_PER_VISIT;
          changeMarks.length = CORRECTIONS_PER_VISIT;
          // Rationale: docs/job-board-index-notes.md#n613-if-changecutat-changelog-length-changecu
          if (changeCutAt >= 0) changeLog.length = changeCutAt;
        }
        // Rationale: docs/job-board-index-notes.md#n117-appliedthrough
        let appliedThrough = corrections.length;
        for (let i = 0; i < corrections.length; i += 200) {
          const chunk = corrections.slice(i, i + 200);
          const { error: cErr } = await client.rpc("apply_posting_corrections", { p_patches: chunk });
          if (cErr) {
            // Rationale: docs/job-board-index-notes.md#n614-if-cerr-message-includes-apply_posting_c
            if (cErr.message?.includes("apply_posting_corrections") || (cErr as { code?: string }).code === "PGRST202") {
              let rowsDone = 0;
              for (const c of chunk) {
                const { id, ...patch } = c as { id: string };
                const { error: rowErr } = await client.from("job_board_postings").update(patch).eq("id", id);
                if (rowErr) {
                  lastUpsertError = `${s.token} correct ${String(id).slice(0, 40)}: ${rowErr.message}`;
                  appliedThrough = Math.min(appliedThrough, i + rowsDone);
                  break;
                }
                rowsDone++;
              }
            } else {
              lastUpsertError = `${s.token} correct batch: ${cErr.message}`;
              appliedThrough = Math.min(appliedThrough, i);
              break;
            }
          }
        }
        if (corrections.length) {
          // Say how many actually landed, not how many were queued: the line
          // above is the only place a failed batch is visible per board.
          if (appliedThrough < corrections.length) console.log(`[JOB-BOARD] ${s.token}: corrected ${appliedThrough} of ${corrections.length} existing rows (batch failed partway)`);
          else console.log(`[JOB-BOARD] ${s.token}: corrected ${corrections.length} existing rows`);
        }

        // Rationale: docs/job-board-index-notes.md#n118-appliedthrough-corrections-length
        if (appliedThrough < corrections.length) {
          const keep = appliedThrough > 0 ? (changeMarks[appliedThrough - 1] ?? 0) : 0;
          if (changeLog.length > keep) {
            console.warn(`[JOB-BOARD] ${s.token}: ${changeLog.length - keep} field-change row(s) dropped — their corrections did not land, so the edits they describe are not true yet (they recompute next visit)`);
            changeLog.length = keep;
          }
        }
        if (changeLog.length) {
          if (changesDropped) {
            console.log(`[JOB-BOARD] field-change log capped for ${s.token}: kept ${changeLog.length}, deferred ${changesDropped} note(s) with their patches to the next visit`);
          }
          for (let i = 0; i < changeLog.length; i += 200) {
            const chunk = changeLog.slice(i, i + 200);
            waitUntil(Promise.resolve(client.from("job_board_field_changes").insert(chunk))
              .then(({ error }) => {
                // supabase-js RETURNS errors — an unchecked insert is how a
                // history table records nothing while everything reads healthy.
                if (error) console.warn(`[JOB-BOARD] field-change insert failed for ${s.token} (non-fatal):`, String(error.message ?? error).slice(0, 150));
              })
              .catch(() => {}));
          }
        }

        // Rationale: docs/job-board-index-notes.md#n119-lapmark-0-for-const-nr-of-newrows
        if (lapMark > 0) for (const nr of newRows) (nr as Record<string, unknown>).lap_epoch = lapMark;
        for (let i = 0; i < newRows.length; i += 250) {
          let { error } = await client.from("job_board_postings").upsert(newRows.slice(i, i + 250), { onConflict: "id" });
          // Rationale: docs/job-board-index-notes.md#n615-if-error-message-includes-country
          if (error?.message?.includes("country")) {
            const stripped = newRows.slice(i, i + 250).map((r) => { const { country: _c, ...rest } = r as Record<string, unknown>; return rest; });
            ({ error } = await client.from("job_board_postings").upsert(stripped, { onConflict: "id" }));
          }
          // Rationale: docs/job-board-index-notes.md#n616-if-error-message-includes-agency
          if (error?.message?.includes("agency")) {
            // Rationale: docs/job-board-index-notes.md#n617-const-stripped-newrows-slice-i-i
            const stripped = newRows.slice(i, i + 250).map((r) => { const { agency: _a, country: _c, ...rest } = r as Record<string, unknown>; return rest; });
            ({ error } = await client.from("job_board_postings").upsert(stripped, { onConflict: "id" }));
          }
          // Rationale: docs/job-board-index-notes.md#n618-if-error-message-includes-region_code
          if (error?.message?.includes("region_code")) {
            const stripped = newRows.slice(i, i + 250).map((r) => { const { region_code: _r, ...rest } = r as Record<string, unknown>; return rest; });
            ({ error } = await client.from("job_board_postings").upsert(stripped, { onConflict: "id" }));
          }
          // Rationale: docs/job-board-index-notes.md#n619-if-error-message-includes-req_key
          if (error?.message?.includes("req_key")) {
            const stripped = newRows.slice(i, i + 250).map((r) => { const { req_key: _k, ...rest } = r as Record<string, unknown>; return rest; });
            ({ error } = await client.from("job_board_postings").upsert(stripped, { onConflict: "id" }));
          }
          if (error) {
            boardOk = false;
            lastUpsertError = `${s.token}: ${error.message}`;
            console.warn(`[JOB-BOARD] insert failed for ${s.token}:`, error.message.slice(0, 200));
            break;
          }
        }
        if (!boardOk) {
          failed.push(`${s.name} (db-write)`);
          dbFailedKeys.push(boardKeyOf(s));
          continue;
        }
        // The re-admitted rows are stored, so their tombstones now record the date they came back on.
        if (readmitted.length > 0) {
          const { error: rdErr } = await client.from("job_board_aged_out").upsert(
            readmitted.map((r) => ({ id: String(r.id), source: String(r.source), company_token: String(r.company_token), posted_at: r.posted_at as string })),
            { onConflict: "id" },
          );
          if (rdErr) console.warn(`[JOB-BOARD] ${s.token}: re-admitted tombstones not moved (a re-dated row may re-enter once more):`, String(rdErr.message ?? "").slice(0, 120));
        }
        // Rationale: docs/job-board-index-notes.md#n120-truncatedfetch
        const truncatedFetch = r.windowed === true;
        // ── FEED-DARK GUARD ──────────────────────────────────────────────────
        // THE HOLE truncatedFetch LEAVES IS THE WHOLE POINT. `windowed` is the
        // vendor's own advertised total against what we fetched, so it catches
        // a PARTIAL read. It cannot catch the other failure: a feed that
        // answers 200 with a valid, nearly empty list. feedTotal then equals
        // what we got, windowed is false, and every stored posting for that
        // board falls through this branch and is logged as an employer
        // takedown in a single second — a collection failure written into the
        // one table that means "the company took the role down", where nothing
        // downstream can tell it from 400 real fills.
        //
        // Marked, never suppressed. The closure log is the asset that cannot be
        // re-derived; a batch we doubt is still INSERTED, carrying the numbers
        // that produced the doubt so a reader can recompute the decision or
        // overturn it. Exclusion happens at READ time, in the estimator.
        //
        // A FALSE POSITIVE HERE COSTS MORE THAN A FALSE NEGATIVE, and the two
        // are not symmetric. A missed dark feed writes closures we later doubt.
        // A wrongly-marked batch is DELETED FROM THE ESTIMATOR — the closure
        // row is excluded by every reader and the posting itself is already
        // hard-deleted, so the cohort does not fall back to being censored: it
        // leaves the risk set entirely. That is truncation, the exact defect
        // this whole change exists to remove, and there is no promotion path
        // (nothing ever clears `suspect`). So the guard fires only when TWO
        // independent things are true at once.
        //
        // (1) THE SHARE THAT WENT ABSENT IS IMPLAUSIBLE. Measured on the pass's
        // RAW absence, not on the grace-confirmed subset. `vanished` only holds
        // ids stamped on an EARLIER pass and still missing now, so an outage
        // that widens across passes never trips a threshold read off it: 400
        // stored, 100 absent on pass 1 (all newly stamped, `vanished` empty,
        // ratio 0), 200 absent on pass 2 of which only the first 100 are
        // confirmed — 100 against a 120 threshold, no fire, and 100 false
        // closures land clean. `vanishedAll` is what actually measures this
        // pass's darkness, and it is the same variable the 6h shrink ratchet
        // one screen up already reads.
        //
        // Both terms of the ratio exclude agedOutIds, because they must count
        // the SAME population. A freshness-cap wave inflates absence while
        // producing ZERO closures (those route to the exit ledger). Excluding
        // them from the numerator alone is not "merely cautious" — it is
        // one-sided the wrong way: a 1,000-posting board that ages out 600 and
        // simultaneously loses 250 others to a dark feed scores 250/1000 = 25%
        // and stays clean, where against the 400 that could actually be removed
        // it is 62%. Both counts now run over the removable population.
        // (The per-row isAgedOut fallback below still catches rows whose STORED
        // posted_at is stale, which this pre-loop count cannot see without
        // reading them; that residual makes the guard more cautious, and it
        // applies to numerator and denominator alike.)
        //
        // (2) THE FEED ITSELF CAME BACK SHORT. This is the term that separates
        // a collection failure from an employer, and it is the one the first
        // cut of this guard was missing. A dark feed serves nothing; a board
        // doing something dramatic serves a full list. Without it, three
        // ordinary events are silently deleted from the estimator:
        //   - an ATS recycling requisition ids: 100 served against 100 stored,
        //     35 ids rotated. 35 > 0.30 x 100 — and the rows deleted are the
        //     RELIST arm the competing-risk estimator depends on, so the board
        //     that churns hardest reports churn = NULL;
        //   - an employer filling a hiring class: 60 stored, 19 filled, the
        //     feed still serving the other 41. 19 > max(5, 18) — and those are
        //     precisely the fastest fills, the same cohort the deleted 7-day
        //     floor removed, pushing R(14) the same way;
        //   - a small board on the cold lane, where one "pass" is a rotation
        //     visit hours to days apart: 16 stored, 6 genuinely closed.
        //     6 > max(5, 4.8) fires on the absolute floor alone.
        // Served count is `r.jobs.length` — the vendor's normalised postings
        // BEFORE our freshness cap, so a dating sweep cannot fake it (rowsById
        // would, since the cap removes rows from it). At 0.6 the three cases
        // above all serve too much to qualify (100/100, 41/60, 10/16) while the
        // incident this exists for (400 stored, a near-empty list) and the
        // widening half-board outage (200 served of 400) both do.
        //
        // No small-board exemption, deliberately, though the shrink ratchet has
        // one. The ratchet exempts boards under 20 because a share alone is
        // noisy at small n and it has no second signal; term (2) IS that second
        // signal, and a 16-posting board whose feed truly returns nothing is a
        // dark feed that should be marked.
        //
        // Marked, never suppressed. The closure log is the asset that cannot be
        // re-derived; a batch we doubt is still INSERTED, carrying the numbers
        // that produced the doubt so a reader can recompute the decision or
        // overturn it. Exclusion happens at READ time, in the estimator.
        // Term (1)'s two numbers are stamped on every row; term (2)'s served
        // count has no column yet (20260906090000 added three), so a reader can
        // recompute the share but must take the feed-health half on the log
        // line below. Adding batch_served is the follow-up.
        //
        // Denominators are prefix-filtered to this source, exactly like
        // `vanished`, so a multi-source token compares like with like;
        // existingRows.length would silently deflate the ratio.
        //
        // Computed ONCE per board pass, before the 200-id chunk loop: chunks
        // are smaller than the threshold on any board over ~667 stored rows, so
        // a per-chunk guard would never fire on exactly the large boards a dark
        // feed hurts most, and would split one 400-removal event into two 200s.
        //
        // Composition with what is already here: this branch is only reached
        // when !truncatedFetch, so a windowed board never gets stamped at all;
        // the two-pass grace and the 6h shrink ratchet DELAY rather than
        // suppress, so during a hold nothing is written while the absence count
        // keeps its full value; and the 24h superseded dedupe decides whether a
        // row EXISTS, where this decides whether an existing row is ADMISSIBLE.
        // Three orthogonal protections, none substituting for another. The 0.30
        // share intentionally fires inside the 30-60% band the ratchet's 0.6
        // lets through.
        //
        // BOTH TERMS MUST BE READ AT THE SCALE OF THE EVIDENCE. On a lap-proven
        // windowed board the unit of evidence is the LAP, not the visit, and
        // feeding visit-scale numbers to these two tests inverts both of them:
        // the numerator would be "everything outside a 250-row window" (always
        // implausible) and `servedInPass` would be the last window's remainder,
        // perhaps 27 rows against 16,000 stored (always short). Every
        // lap-proven closure batch would be stamped suspect — and a suspect
        // batch is EXCLUDED by every reader, so the cohort leaves the risk set
        // entirely. That is truncation wearing the mark's clothes, and it would
        // have made this whole fix write closures nothing is allowed to count.
        // So on a lap the numerator is the lap's absence and the served count
        // is the lap's own total, measured against the same stored population.
        const FEED_SHORT_RATIO = 0.6;
        let removableBefore = 0; // = existing.size minus this pass's freshness-cap age-outs
        for (const id of existing) if (!agedOutIds.has(id)) removableBefore += 1;
        const absentInPass = absenceCount;
        const removedInBatch = vanished.reduce((n, id) => n + (agedOutIds.has(id) ? 0 : 1), 0);
        const servedInPass = lapMode ? lapSeen : r.jobs.length;
        const shareImplausible = absentInPass > Math.max(5, 0.30 * removableBefore);
        const feedCameBackShort = servedInPass < FEED_SHORT_RATIO * removableBefore;
        // Rationale: docs/job-board-index-notes.md#n121-batchsuspect
        const batchSuspect = shareImplausible && feedCameBackShort;
        if ((!truncatedFetch || lapMode) && (batchSuspect || (shareImplausible && vanished.length))) {
          console.warn(
            `[JOB-BOARD] ${s.token}: ${absentInPass}/${removableBefore} absent this ${lapMode ? "lap" : "pass"} ` +
            `(${removedInBatch} confirmed, feed served ${servedInPass}) — ` +
            (batchSuspect
              ? "closures logged but marked suspect (possible dark feed)"
              : "feed served a full list, so this reads as a real takedown — logged unmarked"),
          );
        }
        // Rationale: docs/job-board-index-notes.md#n620-if-vanished-length-truncatedfetch-lapmod
        if (vanished.length && (!truncatedFetch || lapMode)) {
          const closedAt = new Date().toISOString();
          const liveTitles = new Set(
            [...rowsById.values()].map((r) => normalizeCloseTitle(String(r.title ?? ""))).filter(Boolean),
          );
          // Rationale: docs/job-board-index-notes.md#n621-let-recentsuperseded-new-set-string
          let recentSuperseded = new Set<string>();
          try {
            const { data: recent } = await client
              .from("job_board_closures")
              .select("title")
              .eq("company_token", s.token)
              .eq("superseded", true)
              .gt("closed_at", new Date(nowMs - 24 * 3600_000).toISOString())
              .limit(1000);
            recentSuperseded = new Set(((recent ?? []) as Array<{ title: string }>).map((r) => normalizeCloseTitle(r.title)));
          } catch { /* dedupe is best-effort — worst case we log the duplicate */ }
          for (let i = 0; i < vanished.length; i += 200) {
            // The ledger before the delete (n416).
            await closeVanishedChunk(client, s, vanished.slice(i, i + 200), {
              closedAt, agedOutIds, freshCutoffMs, liveTitles, recentSuperseded, batchSuspect,
              absentInPass, removableBefore, lapMode, lapBackfillUntil, missingSinceById, startIso,
            });
          }
        } else if (vanished.length) {
          // Rationale: docs/job-board-index-notes.md#n622-const-aged-vanished-filter-id-agedoutids
          const aged = vanished.filter((id) => agedOutIds.has(id));
          const closedAt = new Date().toISOString();
          for (let i = 0; i < aged.length; i += 200) {
            await closeVanishedChunk(client, s, aged.slice(i, i + 200), {
              closedAt, agedOutIds, freshCutoffMs, liveTitles: new Set(), recentSuperseded: new Set(), batchSuspect,
              absentInPass, removableBefore, lapMode, lapBackfillUntil, missingSinceById, startIso,
            });
          }
          // Only before the missing_since column existed can anything else be here; that path is unchanged.
          const rest = vanished.filter((id) => !agedOutIds.has(id));
          for (let i = 0; i < rest.length; i += 200) {
            await client.from("job_board_postings").delete().in("id", rest.slice(i, i + 200));
          }
        }
        okKeys.push(boardKeyOf(s));
        // Rationale: docs/job-board-index-notes.md#n623-if-clearoversize-oversize_boards-s-share
        if (clearOversize(OVERSIZE_BOARDS, s, SHARED_TOKENS)) oversizeDirty = true;
        // Rationale: docs/job-board-index-notes.md#n624-try
        try {
          // Rationale: docs/job-board-index-notes.md#n625-const-stamptotal-stampfeedtotal-r-feedto
          const stampTotal = stampFeedTotal(r.feedTotal, cursorBefore, deepLaps[lapKey]?.t0);
          // The board's own key, and the bare token too on a shared one (n428).
          let { error: stampErr } = await client.from("job_board_verifications").upsert(
            stampRows(s, SHARED_TOKENS, { verified_at: new Date().toISOString(), ...(stampTotal === undefined ? {} : { feed_total: stampTotal }) }),
            { onConflict: "company_token" },
          );
          if (stampErr?.message?.includes("feed_total")) {
            ({ error: stampErr } = await client.from("job_board_verifications").upsert(
              stampRows(s, SHARED_TOKENS, { verified_at: new Date().toISOString() }),
              { onConflict: "company_token" },
            ));
          }
          if (stampErr) {
            console.warn(`[JOB-BOARD] stamp failed for ${s.token} (non-fatal):`, stampErr.message?.slice(0, 120));
            await client.from("job_board_meta").upsert(
              { k: "verification_stamp_error", v: { at: new Date().toISOString(), token: s.token, message: String(stampErr.message ?? stampErr).slice(0, 300) }, updated_at: new Date().toISOString() },
              { onConflict: "k" },
            );
          }
        } catch { /* never blocks the slice */ }

        // Rationale: docs/job-board-index-notes.md#n128-
        {
          // Rationale: docs/job-board-index-notes.md#n129-livecount
          let liveCount = 0;
          for (const row of rows) {
            const posted = row.posted_at ? Date.parse(String(row.posted_at)) : NaN;
            if (Number.isFinite(posted)) { if (posted >= freshCutoffMs) liveCount++; continue; }
            // Undated: effective_posted is first_seen — ours for a row we
            // already hold, and now for one this pass is inserting.
            const seen = existingById.get(String(row.id))?.first_seen;
            const fs = seen ? Date.parse(String(seen)) : NaN;
            if (!Number.isFinite(fs) || fs >= freshCutoffMs) liveCount++;
          }
          const storedCount = Math.max(0, existingById.size + newRows.length - vanished.length);
          waitUntil(Promise.resolve(client.from("job_board_board_state").upsert(
            {
              company_token: s.token,
              source: s.source,
              observed_at: new Date().toISOString(),
              live_count: liveCount,
              stored_count: storedCount,
              // Rationale: docs/job-board-index-notes.md#n130-feed-total-derived-feed-total-sources-has-s-sou
              feed_total: DERIVED_FEED_TOTAL_SOURCES.has(s.source)
                ? null
                : (typeof r.feedTotal === "number" && Number.isFinite(r.feedTotal) && r.feedTotal > 0 ? r.feedTotal : null),
              // Rationale: docs/job-board-index-notes.md#n131-state-r-windowed-true
              state: r.windowed === true
                ? "truncated"
                : (servedThisVisit === 0 ? (existingById.size > 0 ? "dark" : "empty") : "ok"),
            },
            { onConflict: "company_token,observed_on" },
          )).then(({ error }) => {
            if (error) console.warn(`[JOB-BOARD] board-state write failed for ${s.token} (non-fatal):`, String(error.message ?? error).slice(0, 150));
          }).catch(() => {}));
        }
        sliceTotal += rows.length;
        // Rationale: docs/job-board-index-notes.md#n626-await-breadcrumb-client-board-stored-boa
        await breadcrumb(client, "board-stored", { boardsDone, token: s.token, rows: rows.length, fetched: fetchedInSlice });
      }
    }),
  );

  // Rationale: docs/job-board-index-notes.md#n132-slicebudgetnote-fetched-fetchedinslice-ski
  sliceBudgetNote = { fetched: fetchedInSlice, skipped: budgetSkipped.length, hit: budgetSkipped.length > 0, lastUpsertError, heapStopped, wallStopped, sizeStopped, boardBudget };
  if (budgetSkipped.length) console.warn(`[JOB-BOARD] slice budget hit: ${fetchedInSlice} postings fetched, ${budgetSkipped.length} board(s) deferred to next pass`);
  if (oversized.length) console.warn(`[JOB-BOARD] byte budget: ${oversized.length} board(s) over ${MAX_RESPONSE_BYTES} bytes and deferred — ${oversized.slice(0, 10).join(", ")}`);
  if (lightStats.enrolled) console.warn(`[JOB-BOARD] light re-read: ${lightStats.enrolled} enrolled, ${lightStats.reread} read again (${lightStats.ok} ok), ${lightStats.deferred} deferred`);
  if (oversizeDirty) await persistOversizeBoards(client);
  await breadcrumb(client, "loop-done", { boardsDone, fetched: fetchedInSlice, skipped: budgetSkipped.length, heapStopped, wallStopped, sizeStopped, elapsedMs: Date.now() - sliceWallStart });
  await stampSliceWork(client, inHotPhase, sliceWallStart);

  // Rationale: docs/job-board-index-notes.md#n133-failedacc
  const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);
  const failedTotal = (Number(pv.failedTotal) || 0) + failed.length;
  // Rationale: docs/job-board-index-notes.md#n627-const-next-progressafter-wrapped-advance
  const { next: progressAfter, wrapped } = advanceProgress({
    prev: { ...progressBefore, failedAcc, failedTotal },
    ...advanceArgs,
    baseSliceLen: baseConsumedPrefix(baseSlice.map(boardKeyOf), baseConsumed),
  });
  hot = progressAfter.hot;
  // Admitted at +base, written back at +started: a "step back" a poll sees is this correction (n434).
  if (!inHotPhase) {
    const len = Math.max(1, COLD_LIST.length);
    sliceCursorNote = { from: progressBefore.cold, admitted: (progressBefore.cold + baseSlice.length) % len, to: progressAfter.cold, base: baseSlice.length, started: baseAttempted };
  }
  cold = progressAfter.cold;
  coldDone = progressAfter.coldDone;
  // Rationale: docs/job-board-index-notes.md#n628-if-wrapped
  if (wrapped) {
    // Rationale: docs/job-board-index-notes.md#n134-const-data-prevrot-error-prevroterr-awa
    const { data: prevRot, error: prevRotErr } = await client.from("job_board_meta")
      .select("v").eq("k", "cold_rotation").maybeSingle();
    if (prevRotErr) {
      console.error(`[JOB-BOARD] cold_rotation pre-wrap read failed (${prevRotErr.code ?? ""} ${String(prevRotErr.message ?? "").slice(0, 100)}) — this wrap's duration will not be stamped`);
    }
    const prevAt = Date.parse(String((prevRot?.v as { completedAt?: string } | null)?.completedAt ?? ""));
    // Rationale: docs/job-board-index-notes.md#n629-const-rawwrap-number-isfinite-prevat-mat
    const rawWrap = Number.isFinite(prevAt) ? Math.round((Date.now() - prevAt) / 60_000) : 0;
    const wrapMin = !prevRotErr && rawWrap >= 1 ? rawWrap : null;
    await client.from("job_board_meta").upsert(
      {
        k: "cold_rotation",
        v: { completedAt: new Date().toISOString(), coldBoards: COLD_LIST.length, ...(wrapMin !== null ? { wrapMin } : {}) },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "k" },
    );
  }
  const passDone = isPassDone(progressAfter, HOT_LIST.length, COLD_SLICES_PER_PASS);

  await client.from("job_board_meta").upsert(
    { k: "refresh_progress", v: progressAfter, updated_at: new Date().toISOString() },
    { onConflict: "k" },
  );


  // Rationale: docs/job-board-index-notes.md#n135-
  {
    // Rationale: docs/job-board-index-notes.md#n630-const-budgetskippedset-new-set-budgetski
    const budgetSkippedSet = new Set(budgetSkipped);
    // BY BOARD KEY (n417): on a shared token the twin that read no longer
    // clears the failing twin's streak. The deferral sets stay token-keyed.
    const okKeySet = new Set(okKeys);
    const failedTokens = [...new Set(slice
      .filter((s) => !skipTokens.has(boardKeyOf(s)) && !quarantineSkipped.has(s.token) && !budgetSkippedSet.has(s.token) && !okKeySet.has(boardKeyOf(s)))
      .map(boardKeyOf))];
    // A board whose rows we could not read or store, visit after visit, is our
    // bug, not the employer's: counted, named, and never pruned for it.
    const sliceDbStreaks = foldDbFailures(bfV.dbStreaks, dbFailedKeys, okKeys, DORMANT_CAP);
    const dbAlarm = dbFailingBoards(sliceDbStreaks);
    sliceDbFailNote = { boards: dbFailedKeys.length, alarm: dbAlarm.length };
    if (dbAlarm.length > 0) {
      console.error(`[JOB-BOARD] DB FAILURES: ${dbAlarm.length} board(s) whose feed reads but whose rows our database would not read or store for ${DB_FAIL_ALARM_VISITS}+ visits running: ${dbAlarm.slice(0, 8).map((b) => `${b.key} x${b.visits}`).join(", ")}${lastUpsertError ? ` — last: ${String(lastUpsertError).slice(0, 160)}` : ""}`);
    }
    if (okKeys.length > 0 || failedTokens.length > 0 || recheckTokens.size > 0 || dbFailedKeys.length > 0) {
      const folded = updateBoardFailures({
        okTokens: okKeys,
        // Our database failing is not the vendor failing (S11-023): these
        // feeds answered, so they clear and leave dormancy, never re-arm it.
        answeredTokens: dbFailedKeys,
        failedTokens,
        recheckTokens,
        streaks: boardFailures.streaks,
        dormant: boardFailures.dormant,
        failedAt: boardFailures.failedAt ?? {},
        firstFailedAt: boardFailures.firstFailedAt ?? {},
        deadThreshold: DEAD_BOARD_THRESHOLD,
        minFailureAgeMs: DEAD_BOARD_MIN_FAILING_MS,
        dormantCap: DORMANT_CAP,
        now: Date.now(),
      });
      const pruneUnfinished: string[] = [];
      for (const key of folded.toPrune) {
        // One board: its own vendor's rows only, never a twin's (n417), and
        // only what the exit ledger recorded (n416).
        const board = boardByKey(key);
        const tk = board?.token ?? keyToken(key);
        const { logged: n, complete } = await pruneWholeBoard(client, tk, "board_dormant", board?.source ?? keySource(key));
        if (!complete) pruneUnfinished.push(key);
        console.warn(`[JOB-BOARD] board ${key} dormant after ${DEAD_BOARD_THRESHOLD} consecutive failures spanning at least ${Math.round(DEAD_BOARD_MIN_FAILING_MS / 3_600_000)}h (${n} postings pruned and logged as board_dormant${complete ? "; fetch skipped until recheck" : "; the exit log broke, unlogged rows kept and the board left one failure short of the prune, which retries on its next failing visit"})`);
      }
      // A prune the exit log broke is retried, not left dormant (n416).
      const { streaks, dormant, failedAt, firstFailedAt } = rearmIncompletePrunes(folded, pruneUnfinished, boardFailures, DEAD_BOARD_THRESHOLD, Date.now());
      await client.from("job_board_meta").upsert(
        { k: "board_failures", v: { streaks, dormant, failedAt, firstFailedAt, dbStreaks: sliceDbStreaks, ...(retryLane ? { lastRetryLane: retryLane } : {}) }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      if (deepCursorsDirty || deepLane) {
        // Rationale: docs/job-board-index-notes.md#n136-lapcutoff
        const lapCutoff = Date.now() - 45 * 86_400_000;
        const lapsOut: Record<string, LapState> = {};
        for (const [tok, rec] of Object.entries(deepLaps)) {
          const t = rec.t ? new Date(rec.t).getTime() : NaN;
          if (Number.isFinite(t) && t < lapCutoff) continue;
          lapsOut[tok] = rec;
        }
        // Rationale: docs/job-board-index-notes.md#n137-try
        try {
          const { data: fresh } = await client.from("job_board_meta").select("v").eq("k", "deep_cursor").maybeSingle();
          const stored = (fresh?.v as Record<string, unknown> | null | undefined)?.__laps;
          if (stored && typeof stored === "object" && !Array.isArray(stored)) {
            for (const [k, v] of Object.entries(stored as Record<string, Partial<LapState> | null>)) {
              const o = v;
              if (!o || typeof o !== "object" || !Number.isInteger(o.e) || (o.e as number) <= 0) continue;
              const mine = lapsOut[k];
              if (!mine) continue; // not a board this isolate touched — the upsert below keeps it only if we hold it
              if ((o.e as number) > mine.e) { lapsOut[k] = o as LapState; continue; }
              if ((o.e as number) === mine.e && o.f === 1) mine.f = 1;
            }
            // Rationale: docs/job-board-index-notes.md#n631-block
          }
        } catch { /* fold is best-effort; the write below still lands */ }
        await client.from("job_board_meta")
          .upsert({ k: "deep_cursor", v: { ...tokenMapToRecord(deepCursors), ...(deepLane ? { __lane: deepLane } : {}), ...(Object.keys(lapsOut).length ? { __laps: lapsOut } : {}) }, updated_at: new Date().toISOString() }, { onConflict: "k" })
          .then(({ error }) => { if (error) console.warn("[JOB-BOARD] deep_cursor write failed:", error.message?.slice(0, 120)); });
      }
    }
    // Rationale: docs/job-board-index-notes.md#n138-stalelane
    if (staleLane) {
      try {
        const attempted = staleBoards.filter((s) => !budgetSkippedSet.has(s.token)).map(boardKeyOf);
        const resolved = attempted.filter((k) => okKeySet.has(k)).length;
        const nextTries = bumpStaleTries(staleTries, attempted, okKeySet);
        staleLane.fetched = attempted.length;
        staleLane.resolved = resolved;
        sliceStaleNote = { tries: attempted.length, resolved };
        await client.from("job_board_meta").upsert(
          { k: "stale_lane", v: { ...staleLane, tries: writeStaleTries(nextTries) }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        if (attempted.length) console.log(`[JOB-BOARD] stale lane: asked ${staleLane.asked}, fetched ${attempted.length} (${attempted.join(", ")}), stamped ${resolved}`);
      } catch (e) {
        console.warn("[JOB-BOARD] stale lane fold failed (non-fatal):", String(e).slice(0, 150));
      }
    }
  }

  // Rationale: docs/job-board-index-notes.md#n632-if-vendorstats-size-quarantinedvendors-s
  if (vendorStats.size > 0 || quarantinedVendors.size > 0) {
    const merged: Record<string, { a: number; z: number }> = {};
    const names = new Set([...Object.keys(vendorPrev), ...vendorStats.keys()]);
    for (const v of names) {
      const prev = vendorPrev[v] ?? { a: 0, z: 0 };
      const cur = vendorStats.get(v) ?? { a: 0, z: 0 };
      merged[v] = {
        a: Math.round(prev.a * VENDOR_STATS_DECAY) + cur.a,
        z: Math.round(prev.z * VENDOR_STATS_DECAY) + cur.z,
      };
    }
    const nextQuarantined: string[] = [];
    for (const [v, st] of Object.entries(merged)) {
      const rate = st.a > 0 ? st.z / st.a : 0;
      const wasQ = quarantinedVendors.has(v);
      const isQ = st.a >= VENDOR_MIN_ATTEMPTS && rate >= (wasQ ? VENDOR_ZERO_RESET : VENDOR_ZERO_TRIP);
      if (isQ) nextQuarantined.push(v);
      if (isQ && !wasQ) console.error(`[JOB-BOARD] VENDOR QUARANTINE: ${v} feed-zero rate ${(rate * 100).toFixed(0)}% over ${st.a} recent fetches — zero-feed boards skipped (no prunes) until it recovers`);
      if (!isQ && wasQ) console.log(`[JOB-BOARD] vendor ${v} left quarantine (feed-zero rate ${(rate * 100).toFixed(0)}%)`);
    }
    const { error: vhErr } = await client.from("job_board_meta").upsert(
      { k: "vendor_breaker", v: { vendors: merged, quarantined: nextQuarantined, updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
    if (vhErr) console.warn("[JOB-BOARD] vendor_breaker write failed (non-fatal):", vhErr.message?.slice(0, 120));
  }

  if (passDone) {
    // Rationale: docs/job-board-index-notes.md#n633-const-passendstartedat-new-date-toisostr
    const passEndStartedAt = new Date().toISOString();
    const ctx: PassEndCtx = { startedAt: passEndStartedAt, hop: chainHop, refreshedAt: startIso, freshCutoffMs, failedSources: failedAcc, failedCount: failedTotal };
    const { error: ctxErr } = await client.from("job_board_meta").upsert({ k: "pass_end_ctx", v: ctx, updated_at: passEndStartedAt }, { onConflict: "k" });
    if (ctxErr) console.error("[JOB-BOARD] pass_end_ctx write failed: the tail's steps will not run:", String(ctxErr.message ?? ctxErr).slice(0, 160));
    await breadcrumb(client, "pass-end", { elapsedMs: Date.now() - sliceWallStart });
    await stampPassEnd(client, { startedAt: passEndStartedAt, hop: chainHop, refreshedAt: startIso, steps: {}, next: PASS_END_STEPS[0], nextKickedAt: passEndStartedAt });
    kickPassEndStep(PASS_END_STEPS[0], passEndStartedAt);
    await recordSliceStats(client, sliceWallStart, inHotPhase);
    return { ok: true, detail: `pass complete — cold rotation at ${cold}/${COLD_LIST.length}; the pass-end tail runs as its own hops from "${PASS_END_STEPS[0]}"${lastUpsertError ? ` — last upsert error: ${String(lastUpsertError).slice(0, 120)}` : ""}` };
  }

  // Rationale: docs/job-board-index-notes.md#n166-await-maybekickmaintenance-client
  await maybeKickMaintenance(client);
  // Rationale: docs/job-board-index-notes.md#n634-if-chainhop-chain_cap-chainnextslice-cha
  if (chainHop < CHAIN_CAP) chainNextSlice(chainHop, client, Math.min(MAX_BOARDS_PER_SLICE, boardBudget + BOARDS_RAMP_STEP));
  const phase = inHotPhase ? `hot ${Math.min(hot, HOT_LIST.length)}/${HOT_LIST.length}` : `cold slice ${coldDone}/${COLD_SLICES_PER_PASS} (rotation ${cold}/${COLD_LIST.length})`;
  await recordSliceStats(client, sliceWallStart, inHotPhase);
  // The shed level rides the summary, because a rotation that is deliberately
  // running small must not look like a rotation that is mysteriously slow.
  return { ok: true, detail: `slice done (${sliceTotal} postings, ${failed.length} failed) — ${phase}${shedLevel > 0 ? ` [shedding L${shedLevel}]` : ""}${budgetSkipped.length ? ` [budget: ${fetchedInSlice} fetched, ${budgetSkipped.length} deferred]` : ""}` };
}

// ── THE PASS-END TAIL, ONE HOP PER STEP (S11-001, .93; pass-end.ts) ─────────

/** What a pass hands its tail. Kept in pass_end_ctx: a re-kicked step reads it too. */
type PassEndCtx = { startedAt: string; hop: number; refreshedAt: string; freshCutoffMs: number; failedSources: unknown[]; failedCount: number };

/** One pass-end step as its own request. The step answers after its work, so only this isolate's background waits. */
function kickPassEndStep(step: PassEndStep, startedAt: string): void {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
  waitUntil(chainKey().then((key) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "pass-end", step, startedAt, chainKey: key }),
  })).then((r) => discardBody(r)).catch((e) => console.error(`[JOB-BOARD] pass-end kick (${step}) failed:`, String(e).slice(0, 160))));
}

/** One step's receipt on pass_end, read-modify-write. superseded: a newer pass owns the row. */
async function passEndReceipt(client: SupabaseClient, startedAt: string, step: PassEndStep, patch: StepReceipt, top: Record<string, unknown> = {}): Promise<{ superseded: boolean; prior: StepReceipt }> {
  const row = await readMetaRow(client, "pass_end");
  if (!row.read) return { superseded: false, prior: {} };
  let v = (row.v && typeof row.v === "object" ? row.v : {}) as PassEndRow;
  if (v.startedAt !== startedAt) {
    if (Date.parse(String(v.startedAt)) > Date.parse(startedAt)) return { superseded: true, prior: {} };
    v = { startedAt, steps: {} }; // the pass's opening receipt never landed: open it here
  }
  await stampPassEnd(client, withStepReceipt(v, step, patch, top));
  return { superseded: false, prior: v.steps?.[step] ?? {} };
}

/** {action:"pass-end"}: one step, inside this request and on its own clock, then its receipt and the next kick. */
async function runPassEndStep(client: SupabaseClient, step: PassEndStep, startedAt: string): Promise<Record<string, unknown>> {
  const ctxRow = await readMetaRow(client, "pass_end_ctx");
  const ctx = (ctxRow.read ? ctxRow.v : null) as PassEndCtx | null;
  if (!ctx || ctx.startedAt !== startedAt) return { ok: false, step, detail: "not run: a newer pass owns the tail, or its context is unreadable" };
  const t0 = Date.now();
  const begun = await passEndReceipt(client, startedAt, step, { startedAt: new Date(t0).toISOString() });
  if (begun.superseded) return { ok: false, step, detail: "not run: a newer pass owns the tail" };
  await breadcrumb(client, `pass-end-${step}`, {});
  let r: { ok: boolean; detail: string; swept?: number; stop?: string };
  try {
    r = step === "serve" ? await passEndServe(client, ctx, t0)
      : step === "kicks" ? await passEndKicks(client)
      : step === "hygiene" ? await passEndHygiene(client)
      : step === "sweep" ? await (async () => {
        await loadOversizeBoards(client);
        const sw = await freshnessSweep(client, ctx.freshCutoffMs, t0);
        return { ok: !/error|unread/.test(sw.stop), detail: `dropped ${sw.swept} (stopped: ${sw.stop})`, swept: sw.swept, stop: sw.stop };
      })()
      : step === "capacity" ? await passEndCapacity(client)
      : await passEndNames(client, t0);
  } catch (e) {
    r = { ok: false, detail: `threw: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
  const hops = step === "sweep" || step === "names" ? (begun.prior.hops ?? 0) + 1 : undefined;
  const next = nextPassEndStep(step, hops !== undefined && r.stop !== undefined ? { stop: r.stop, hops } : undefined);
  const doneAt = new Date().toISOString();
  await passEndReceipt(
    client, startedAt, step,
    { doneAt, ms: Date.now() - t0, ok: r.ok, detail: r.detail.slice(0, 200), ...(hops !== undefined ? { hops, ...(step === "sweep" ? { dropped: (begun.prior.dropped ?? 0) + (r.swept ?? 0) } : {}) } : {}) },
    next ? { next, nextKickedAt: doneAt } : { next: null, refreshedAt: ctx.refreshedAt, doneAt, ms: Date.now() - Date.parse(startedAt) },
  );
  console.log(`[JOB-BOARD] pass-end ${step}: ${r.detail}${next ? ` -> ${next}` : " (tail finished)"}`);
  if (next) kickPassEndStep(next, startedAt);
  else await maybeKickMaintenance(client);
  return { ok: r.ok, step, next, detail: r.detail };
}

/** A step whose request died leaves its receipt open; re-kick it (pass-end.ts), looking once a minute per isolate. */
let passEndCheckedAt = 0;
async function maybeResumePassEnd(client: SupabaseClient): Promise<void> {
  if (Date.now() - passEndCheckedAt < 60_000) return;
  passEndCheckedAt = Date.now();
  try {
    const row = await readMetaRow(client, "pass_end");
    const v = (row.read ? row.v : null) as PassEndRow | null;
    const step = stalledPassEndStep(v, Date.now());
    if (!step || !v || typeof v.startedAt !== "string") return;
    const tries = (v.steps?.[step]?.tries ?? 0) + 1;
    await stampPassEnd(client, withStepReceipt(v, step, { tries }, { nextKickedAt: new Date().toISOString() }));
    console.warn(`[JOB-BOARD] pass-end step ${step} stalled: re-kick ${tries} of ${PASS_END_RETRIES}`);
    kickPassEndStep(step, v.startedAt);
  } catch { /* the open receipt is what the heartbeat reads */ }
}

/** Step "serve": what the board serves (facets, refresh, refresh_head, hot_tokens). `sliceWallStart` is this step's start. */
async function passEndServe(client: SupabaseClient, ctx: PassEndCtx, sliceWallStart: number): Promise<{ ok: boolean; detail: string }> {
  const startIso = ctx.refreshedAt;
  const failedAcc = ctx.failedSources;
  const failedTotal = ctx.failedCount;
  // Rationale: docs/job-board-index-notes.md#n139-
  {
    const { data: sampled, error: sErr } = await client.rpc("record_board_pool_sample");
    if (sErr) console.warn("[JOB-BOARD] pool sample failed (non-fatal):", sErr.message?.slice(0, 140));
    else console.log(`[JOB-BOARD] pool sample recorded: serving=${sampled}`);

    // Rationale: docs/job-board-index-notes.md#n140-const-data-flow-error-ferr-await-client
    const { data: flow, error: fErr } = await client.rpc("get_board_flow", { p_hours: 24 });
    if (fErr) console.warn("[JOB-BOARD] board flow cache failed (non-fatal):", fErr.message?.slice(0, 140));
    else {
      const row = Array.isArray(flow) ? flow[0] : flow;
      if (row && typeof row === "object") {
        await client.from("job_board_meta").upsert(
          { k: "board_flow_cache", v: row, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
      }
    }
  }

  // Rationale: docs/job-board-index-notes.md#n141-const-data-facets-error-facetserr-await
  const { data: facets, error: facetsErr } = await client.rpc("refresh_job_board_facets");
  let f = (facets ?? {}) as Record<string, unknown>;
  const facetsOk = !facetsErr && !!f.total;
  // Rationale: docs/job-board-index-notes.md#n142-facetscarried
  let facetsCarried = false;
  // When the carried counts were counted, not when this pass ran (facet-carry.ts).
  let facetsCountedAt: string | null = null;
  if (!facetsOk) {
    console.warn("[JOB-BOARD] facets RPC unavailable — carrying previous facets, maintenance continues:", facetsErr?.message ?? "empty result");
    // Attempt receipt: without it, "the cron ran and the aggregate failed"
    // and "nothing ever fired" are indistinguishable from meta alone.
    waitUntil(Promise.resolve(client.from("job_board_meta").upsert(
      { k: "facets_attempt", v: { at: new Date().toISOString(), error: String(facetsErr?.message ?? "empty result").slice(0, 200) }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    )).then(() => {}).catch(() => {}));
    const { data: prevRefresh } = await client.from("job_board_meta").select("v").eq("k", "refresh").maybeSingle();
    const pv = (prevRefresh?.v ?? {}) as Record<string, unknown>;
    if (pv.total) {
      f = {
        total: pv.total,
        companiesFacet: pv.companiesFacet ?? [],
        categoriesFacet: pv.categoriesFacet ?? {},
        // Rationale: docs/job-board-index-notes.md#n143-pv-companiesopen-typeof-pv-companiesopen
        ...(pv.companiesOpen && typeof pv.companiesOpen === "object"
          ? { companiesOpen: pv.companiesOpen, companiesOpenCount: pv.companiesOpenCount }
          : {}),
        // Rationale: docs/job-board-index-notes.md#n635-pv-sourcesfacet-typeof-pv-sourcesfacet-o
        ...(pv.sourcesFacet && typeof pv.sourcesFacet === "object" && !Array.isArray(pv.sourcesFacet)
          ? { sourcesFacet: pv.sourcesFacet }
          : {}),
      };
      facetsCarried = true;
      facetsCountedAt = carriedCountsAt(pv);
    } else {
      // Rationale: docs/job-board-index-notes.md#n636-return-ok-true-detail-pass-complete
      return { ok: true, detail: `pass complete but facets RPC unavailable (${facetsErr?.message ?? "empty result"}) and no previous facets to carry` };
    }
  }
  let companies = Array.isArray(f.companiesFacet) ? f.companiesFacet : [];

  // Rationale: docs/job-board-index-notes.md#n144-try
  try {
    const ranks = Object.fromEntries(ORACLE_SITE_RANK);
    const rankJson = JSON.stringify(ranks);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rankJson));
    const rankHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
    const { data: rankRow } = await client.from("job_board_meta").select("v").eq("k", "oracle_site_rank").maybeSingle();
    // Rationale: docs/job-board-index-notes.md#n637-const-rankstored-rankrow-v-null-as
    const rankStored = (rankRow?.v ?? null) as { hash?: string; version?: string } | null;
    if (rankStored?.hash !== rankHash || rankStored?.version !== BUILD_VERSION) {
      await client.from("job_board_meta").upsert(
        { k: "oracle_site_rank", v: { hash: rankHash, sites: ORACLE_SITE_RANK.size, ranks, canonical: ORACLE_CANONICAL_SITES, version: BUILD_VERSION, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] oracle site-rank table published: ${ORACLE_SITE_RANK.size} ranked sites (hash ${rankHash})`);
    }
  } catch (e) {
    console.warn("[JOB-BOARD] oracle site-rank publish failed (non-fatal):", String((e as Error)?.message ?? e).slice(0, 120));
  }
  const validTokens = new Set(JOB_SOURCES.map((s) => s.token));
  const { data: hwRow } = await client.from("job_board_meta").select("v").eq("k", "catalog_highwater").maybeSingle();
  const highwater = Number((hwRow?.v as { size?: number } | null)?.size) || 0;
  if (!facetsOk) {
    // Rationale: docs/job-board-index-notes.md#n638-console-warn-job-board-orphan-prune
    console.warn("[JOB-BOARD] orphan prune SKIPPED: facets carried, not computed — no deletions from a stale company list");
  } else if (JOB_SOURCES.length < highwater) {
    console.warn(`[JOB-BOARD] orphan prune SKIPPED: bundle catalog ${JOB_SOURCES.length} < high-water ${highwater} — stale deploy must not wipe newer boards`);
  } else {
    if (JOB_SOURCES.length > highwater) {
      await client.from("job_board_meta").upsert(
        { k: "catalog_highwater", v: { size: JOB_SOURCES.length, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
    }
    const orphanTokens = companies
      .map((c) => (c as { token?: string }).token)
      .filter((tk): tk is string => typeof tk === "string" && !validTokens.has(tk));
    if (orphanTokens.length > 0) {
      let orphanLogged = 0;
      for (const tk of orphanTokens) {
        // Deletes only what the exit ledger recorded (n416); the token is in
        // no catalog entry, so no vendor's twin can be standing on it.
        orphanLogged += (await pruneWholeBoard(client, tk, "untracked", null)).logged;
      }
      console.log(`[JOB-BOARD] orphan-pruned ${orphanTokens.length} removed board(s), ${orphanLogged} postings logged as untracked: ${orphanTokens.slice(0, 8).join(", ")}`);
      companies = companies.filter((c) => !orphanTokens.includes((c as { token?: string }).token ?? ""));
    }
    await breadcrumb(client, "pass-end-pruned", { orphans: orphanTokens.length, elapsedMs: Date.now() - sliceWallStart });
  }

  // Rationale: docs/job-board-index-notes.md#n149-coverage
  const coverage = await (async () => {
    // Rationale: docs/job-board-index-notes.md#n639-const-freshiso-new-date-date-now
    const freshIso = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString();
    // Rationale: docs/job-board-index-notes.md#n150-coveragefailed
    const coverageFailed: string[] = [];
    const one = async (col: string, op: "not.is.null" | "neq.unspecified") => {
      const q = client.from("job_board_postings").select("id", { count: "exact", head: true })
        .is("missing_since", null).gte("effective_posted", freshIso);
      const { count, error } = op === "not.is.null" ? await q.not(col, "is", null) : await q.neq(col, "unspecified");
      if (error) {
        coverageFailed.push(col);
        console.error(`[JOB-BOARD] filter coverage count failed for ${col}: ${error.code ?? ""} ${String(error.message ?? "").slice(0, 120)}`);
      }
      return count ?? null;
    };
    // The previous figures, read by JSON PATH so this costs a few bytes rather
    // than the 1.3-1.6MB the whole meta row weighs.
    const prevCoverage = await (async () => {
      try {
        const { data } = await client.from("job_board_meta")
          .select("coverage:v->coverage").eq("k", "refresh").maybeSingle();
        const c = (data as { coverage?: unknown } | null)?.coverage;
        return c && typeof c === "object" ? c as Record<string, unknown> : null;
      } catch { return null; }
    })();
    // Rationale: docs/job-board-index-notes.md#n151-try
    try {
      const { data: fcRaw, error: fcErr } = await client.rpc("get_filter_coverage");
      const fc = fcRaw as Record<string, unknown> | null;
      if (!fcErr && fc && typeof fc === "object" && typeof fc.open === "number" && (fc.open as number) > 0) {
        const open = fc.open as number;
        const frac = (n: unknown) => (typeof n === "number" ? Math.round((n / open) * 1000) / 1000 : null);
        const prevCov = (prevCoverage ?? {}) as Record<string, unknown>;
        // Rationale: docs/job-board-index-notes.md#n640-const-keep-name-string
        const keep = (name: string) => {
          const f = frac(fc[name]);
          if (f !== null) return f;
          coverageFailed.push(name);
          const old = prevCov[name];
          return typeof old === "number" ? old : null;
        };
        return {
          open,
          salaryFloor: keep("salaryFloor"),
          workMode: keep("workMode"),
          experience: keep("experience"),
          country: keep("country"),
          // The five that were pinned constants until this scan existed.
          payBasis: keep("payBasis"),
          hasStatedPay: keep("hasStatedPay"),
          // Rationale: docs/job-board-index-notes.md#n641-salarytext-keep-salarytext
          salaryText: keep("salaryText"),
          maxYears: keep("maxYears"),
          department: keep("department"),
          employmentType: keep("employmentType"),
          // Rationale: docs/job-board-index-notes.md#n152-annualwithouttext-typeof-fc-annual-without-text
          annualWithoutText: typeof fc.annual_without_text === "number" ? fc.annual_without_text : null,
          ...(coverageFailed.length ? { staleParts: coverageFailed } : {}),
        };
      }
      if (fcErr) {
        console.warn(`[JOB-BOARD] get_filter_coverage unavailable (${fcErr.code ?? ""} ${String(fcErr.message ?? "").slice(0, 80)}) — falling back to per-column counts`);
      }
      // Rationale: docs/job-board-index-notes.md#n153-const-count-open-await-client-from-job-b
      const { count: open } = await client.from("job_board_postings")
        .select("id", { count: "exact", head: true }).is("missing_since", null)
        .gte("effective_posted", new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString());
      if (!open) return undefined;
      // Rationale: docs/job-board-index-notes.md#n154-const-sal-wm-exp-ctry-await-promise-all
      const [sal, wm, exp, ctry] = await Promise.all([
        one("salary_rank_usd", "not.is.null"),
        one("work_mode", "not.is.null"),
        one("experience_band", "neq.unspecified"),
        // Rationale: docs/job-board-index-notes.md#n155-one-country-not-is-null
        one("country", "not.is.null"),
      ]);
      const frac = (n: number | null) => (n === null ? null : Math.round((n / open) * 1000) / 1000);
      // Rationale: docs/job-board-index-notes.md#n642-const-prevcov-prevcoverage-as-record-str
      const prevCov = (prevCoverage ?? {}) as Record<string, unknown>;
      const keep = (name: string, n: number | null) => {
        const f = frac(n);
        if (f !== null) return f;
        const old = prevCov[name];
        return typeof old === "number" ? old : null;
      };
      if (coverageFailed.length) {
        console.warn(`[JOB-BOARD] filter coverage carried forward for: ${coverageFailed.join(", ")}`);
      }
      // Rationale: docs/job-board-index-notes.md#n643-const-carrylive-name-string
      const carryLive = (name: string) => {
        const old = (prevCoverage ?? {} as Record<string, unknown>)[name];
        if (typeof old === "number") { coverageFailed.push(name); return old; }
        return null;
      };
      return {
        open,
        salaryFloor: keep("salaryFloor", sal),
        workMode: keep("workMode", wm),
        experience: keep("experience", exp),
        country: keep("country", ctry),
        payBasis: carryLive("payBasis"),
        hasStatedPay: carryLive("hasStatedPay"),
        // Rationale: docs/job-board-index-notes.md#n644-salarytext-carrylive-salarytext
        salaryText: carryLive("salaryText"),
        maxYears: carryLive("maxYears"),
        department: carryLive("department"),
        employmentType: carryLive("employmentType"),
        // Rationale: docs/job-board-index-notes.md#n645-annualwithouttext-carrylive-annualwithou
        annualWithoutText: carryLive("annualWithoutText"),
        ...(coverageFailed.length ? { staleParts: coverageFailed } : {}),
      };
      // Rationale: docs/job-board-index-notes.md#n646-catch-return-undefined
    } catch { return undefined; }
  })();

  const v = {
    total: f.total, // includes just-pruned orphans until the next pass recomputes — harmless
    boards: companies.length,
    failedSources: failedAcc,
    // How many actually failed, versus how many fit in the sample above.
    failedCount: failedTotal,
    companiesFacet: companies,
    // Rationale: docs/job-board-index-notes.md#n156-f-companiesopen-typeof-f-companiesopen
    ...(f.companiesOpen && typeof f.companiesOpen === "object" ? { companiesOpen: f.companiesOpen } : {}),
    ...(typeof f.companiesOpenCount === "number" ? { companiesOpenCount: f.companiesOpenCount } : {}),
    categoriesFacet: f.categoriesFacet ?? {},
    // Rationale: docs/job-board-index-notes.md#n647-f-sourcesfacet-typeof-f-sourcesfacet-obj
    ...(f.sourcesFacet && typeof f.sourcesFacet === "object" && !Array.isArray(f.sourcesFacet)
      ? { sourcesFacet: f.sourcesFacet }
      : {}),
    // Rationale: docs/job-board-index-notes.md#n157-coverage-coverage-coverage-at-st
    ...(coverage ? { coverage: { ...coverage, at: startIso } } : {}),
    // Rationale: docs/job-board-index-notes.md#n648-facetscarried-facetscarried-true
    ...(facetsCarried ? { facetsCarried: true } : {}),
    // When those carried counts were counted, so the next carry keeps it (facet-carry.ts).
    ...(facetsCarried ? { facetsCarriedAt: facetsCountedAt ?? startIso } : {}),
    refreshedAt: startIso,
  };
  await client.from("job_board_meta").upsert({ k: "refresh", v, updated_at: new Date().toISOString() }, { onConflict: "k" });
  // Rationale: docs/job-board-index-notes.md#n158-vhead
  const vHead = {
    total: v.total,
    boards: v.boards,
    failedSources: v.failedSources,
    failedCount: v.failedCount,
    categoriesFacet: v.categoriesFacet,
    // Rationale: docs/job-board-index-notes.md#n159-coverage-coverage-coverage-tracke
    ...(coverage ? { coverage: { ...coverage, tracked: v.total, at: v.refreshedAt } } : {}),
    // Rationale: docs/job-board-index-notes.md#n649-facetscarried-facetscarried-true-facetsc
    ...(facetsCarried ? { facetsCarried: true, facetsCarriedAt: facetsCountedAt ?? v.refreshedAt } : {}),
    refreshedAt: v.refreshedAt,
    companiesCount: companies.length,
    // Rationale: docs/job-board-index-notes.md#n160-typeof-v-as-companiesopencount-number
    ...(typeof (v as { companiesOpenCount?: number }).companiesOpenCount === "number"
      ? { companiesOpenCount: (v as { companiesOpenCount?: number }).companiesOpenCount }
      : {}),
    // Rationale: docs/job-board-index-notes.md#n161-v-as-sourcesfacet-unknown-sourcesfac
    ...((v as { sourcesFacet?: unknown }).sourcesFacet
        && typeof (v as { sourcesFacet?: unknown }).sourcesFacet === "object"
        && !Array.isArray((v as { sourcesFacet?: unknown }).sourcesFacet)
      ? { sourcesFacet: (v as { sourcesFacet?: Record<string, number> }).sourcesFacet }
      : {}),
    // Rationale: docs/job-board-index-notes.md#n650-companiesfacet
    companiesFacet: (() => {
      const om = (v as { companiesOpen?: Record<string, number> }).companiesOpen;
      const withOpen = (companies as Array<{ token?: string; name?: string; count?: number }>).map((c) =>
        om && typeof c.token === "string" ? { ...c, open: om[c.token] ?? 0 } : c
      ) as Array<{ token?: string; name?: string; count?: number; open?: number }>;
      return withOpen
        .sort((a, b) => (b.open ?? b.count ?? 0) - (a.open ?? a.count ?? 0))
        .slice(0, 200);
    })(),
  };
  await client.from("job_board_meta").upsert({ k: "refresh_head", v: vHead, updated_at: new Date().toISOString() }, { onConflict: "k" });
  // Rationale: docs/job-board-index-notes.md#n162-hotexcluded
  const hotExcluded = new Set<string>();
  try {
    const { data: ex } = await client.from("showcase_excluded").select("company_token");
    for (const r of (ex ?? []) as Array<{ company_token?: string }>) {
      if (typeof r.company_token === "string") hotExcluded.add(r.company_token);
    }
  } catch { /* keep the previous behaviour rather than an empty hot tier */ }

  const sizeRanked = [...companies]
    .filter((c): c is { token: string; count: number } => typeof (c as { token?: unknown }).token === "string" && typeof (c as { count?: unknown }).count === "number")
    .filter((c) => !hotExcluded.has(c.token))
    .sort((a, b) => b.count - a.count)
    .map((c) => c.token);
  const hotSet = new Set<string>();
  try {
    const { data: velo, error: veloErr } = await client.rpc("get_board_velocity", { days: VELOCITY_WINDOW_DAYS, top_n: VELOCITY_HOT_SLOTS });
    if (!veloErr && Array.isArray(velo)) {
      for (const r of velo as Array<{ company_token?: string }>) {
        if (typeof r.company_token === "string" && hotSet.size < VELOCITY_HOT_SLOTS) hotSet.add(r.company_token);
      }
    }
  } catch { /* velocity unavailable — size-only ranking */ }
  for (const t of sizeRanked) {
    if (hotSet.size >= HOT_SIZE) break;
    hotSet.add(t);
  }
  const ranked = [...hotSet];
  // Rationale: docs/job-board-index-notes.md#n651-if-ranked-length
  if (ranked.length >= 50) {
    await client.from("job_board_meta").upsert(
      { k: "hot_tokens", v: { tokens: ranked }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
  }
  console.log(`[JOB-BOARD] pass-end serve: corpus total ${f.total}`);
  return { ok: true, detail: `corpus ${f.total} postings from ${companies.length} boards` };
}

/** Step "kicks": the backfill sweeps and the filter audit, each only when due. */
async function passEndKicks(client: SupabaseClient): Promise<{ ok: boolean; detail: string }> {
  // Rationale: docs/job-board-index-notes.md#n652-const-data-expver-await-client-from
  const { data: expVer } = await client.from("job_board_meta").select("v").eq("k", "experience_version").maybeSingle();
  if ((expVer?.v as { version?: number } | null)?.version !== EXPERIENCE_VERSION) {
    const { data: xb } = await client.from("job_board_meta").select("v, updated_at").eq("k", "experience_backfill").maybeSingle();
    const xbv = (xb?.v ?? {}) as { startedUnder?: number; cursor?: string };
    const xbAlive = !!xb?.updated_at && Date.now() - Date.parse(String(xb.updated_at)) < MAINTENANCE_STALL_MS;
    const resume = Number(xbv.startedUnder) === EXPERIENCE_VERSION && typeof xbv.cursor === "string" ? xbv.cursor : "";
    if (!xbAlive) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-experience", chainKey: key, rulesVersion: EXPERIENCE_VERSION, ...(resume ? { cursor: resume } : {}) }),
      })).then((r) => discardBody(r)).catch(() => {}));
    }
  }
  // Country not yet backfilled (fresh column on existing rows)? Same
  // self-chaining sweep pattern; new rows carry country from ingestion.
  const { data: coVer } = await client.from("job_board_meta").select("v").eq("k", "country_version").maybeSingle();
  if ((coVer?.v as { version?: number } | null)?.version !== COUNTRY_VERSION) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
    waitUntil(chainKey().then((key) => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "backfill-country", chainKey: key }),
    })).then((r) => discardBody(r)).catch(() => {}));
  }
  // Rationale: docs/job-board-index-notes.md#n163-filter-audit-every-ms
  const FILTER_AUDIT_EVERY_MS = 6 * 60 * 60_000;
  const { data: faRow } = await client.from("job_board_meta").select("updated_at").eq("k", "filter_audit").maybeSingle();
  const faAge = faRow?.updated_at ? Date.now() - Date.parse(faRow.updated_at) : Infinity;
  if (faAge > FILTER_AUDIT_EVERY_MS) {
    const faUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
    waitUntil(chainKey().then((key) =>
      fetch(faUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "filter-audit", chainKey: key }),
      })
    ).then((r) => discardBody(r)).catch(() => {}));
  }

  // Rationale: docs/job-board-index-notes.md#n653-const-data-pbver-await-client-from
  const { data: pbVer } = await client.from("job_board_meta").select("v").eq("k", "posted_backfill").maybeSingle();
  const pbV = (pbVer?.v ?? {}) as { version?: number; resumeVersion?: number; phase?: string; cursor?: string; at?: string; sweptAt?: string; backlogAtSweep?: number };
  const pbAlive = typeof pbV.at === "string" && Date.now() - Date.parse(pbV.at) < 5 * 60_000;
  // Read the backlog only when the cheap checks have not already decided, so
  // the common "not due" path costs no extra query.
  const pbBacklog = pbAlive ? null : await undatedBacklog(client);
  if (postedBackfillDue(pbV, pbBacklog) && !pbAlive) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
    // Rationale: docs/job-board-index-notes.md#n164-resume
    const resume = pbV.resumeVersion === POSTED_BACKFILL_VERSION
      && typeof pbV.phase === "string" && typeof pbV.cursor === "string"
      ? { phase: pbV.phase, cursor: pbV.cursor }
      : {};
    waitUntil(chainKey().then((key) => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "backfill-posted", chainKey: key, ...resume }),
    })).then((r) => discardBody(r)).catch(() => {}));
  }
  // Same deal for salary_min_annual: rows are insert-only, so postings that
  // predate the structured parser need one sweep. Stamped on completion.
  const { data: salVer } = await client.from("job_board_meta").select("v").eq("k", "salary_parse_version").maybeSingle();
  if ((salVer?.v as { version?: number } | null)?.version !== SALARY_PARSE_VERSION) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
    waitUntil(chainKey().then((key) => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "backfill-salary", chainKey: key }),
    })).then((r) => discardBody(r)).catch(() => {}));
  }
  return { ok: true, detail: "due sweeps kicked" };
}

/** Step "hygiene": stated dates that cannot be true are cleared. */
async function passEndHygiene(client: SupabaseClient): Promise<{ ok: boolean; detail: string }> {
  {
    const futureIso = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const garbageIso = new Date(POSTED_AT_GARBAGE_FLOOR_MS).toISOString();
    const { error: e1 } = await client.from("job_board_postings").update({ posted_at: null }).gt("posted_at", futureIso);
    const { error: e2 } = await client.from("job_board_postings").update({ posted_at: null }).lt("posted_at", garbageIso);
    if (e1 || e2) console.warn("[JOB-BOARD] date-hygiene error:", (e1 ?? e2)?.message);
  }
  return { ok: true, detail: "dates checked" };
}

// Freshness cap sweep: drop the aged tail (effective_posted past the window)
// so the corpus reclaims itself immediately rather than waiting a full cold
// rotation for the per-board prune. Bounded per pass (a single delete of the
// ~65k initial backlog risks a statement timeout on the free tier); the
// ingestion filter keeps dated-old postings from re-entering, so this
// converges within a few passes and then only trims the daily trickle.
//
// ONE CHUNK AT A TIME, ON A CLOCK (S11-001). It used to read all 15,000
// ids, then every chunk's rows, and delete only at the very end, so a tail
// that died anywhere in the reads deleted nothing at all: the aged
// backlog grew from 20.5k to 36.6k while the sweep ran every pass. Each
// chunk is now read, tombstoned, logged and deleted before the next is
// taken, so whatever a pass gets through stays done. Since every chunk
// is gone before the next read, the next chunk is always the oldest 200
// again: no offset to drift. No new chunk starts once the pass-end hop is
// PASS_END_SWEEP_UNTIL_MS old, and the cap still bounds a pass.
async function freshnessSweep(client: SupabaseClient, freshCutoffMs: number, sliceWallStart: number): Promise<{ swept: number; stop: string }> {
  const freshCutoffIso = new Date(freshCutoffMs).toISOString();
  const sweepUntil = sliceWallStart + PASS_END_SWEEP_UNTIL_MS;
  let swept = 0;
  let sweepStop = "done";
  // Rationale: docs/job-board-index-notes.md#n421-a-row-not-read-is-not-written
  if (!META_READ.oversize) {
    sweepStop = "registry-unread";
    console.warn("[JOB-BOARD] freshness sweep skipped: the oversize registry was unread this slice, so aged rows wait for the next pass (the list already hides them)");
  }
  while (META_READ.oversize) {
    if (swept >= FRESH_PRUNE_MAX) { sweepStop = "cap"; break; }
    if (Date.now() >= sweepUntil) { sweepStop = "clock"; break; }
    const take = Math.min(200, FRESH_PRUNE_MAX - swept);
    const { data: page, error: pageErr } = await client
      .from("job_board_postings")
      .select("id")
      .lt("effective_posted", freshCutoffIso)
      .order("effective_posted", { ascending: true })
      .range(0, take - 1);
    if (pageErr) { console.warn("[JOB-BOARD] freshness sweep select error:", pageErr.message); sweepStop = "select-error"; break; }
    const ids: string[] = (page ?? []).map((r) => r.id as string);
    if (ids.length === 0) break;
    // Rationale: docs/job-board-index-notes.md#n146-alreadytombstoned
    const alreadyTombstoned = new Set<string>();
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const { data: t, error: tErr } = await client
          .from("job_board_aged_out").select("id").in("id", ids.slice(i, i + 200));
        if (tErr) throw tErr;
        for (const r of t ?? []) alreadyTombstoned.add(String((r as { id: string }).id));
      }
    } catch (e) {
      console.warn("[JOB-BOARD] aged-out read failed (exits may double-count this pass):", String((e as Error)?.message ?? e).slice(0, 120));
    }
    const exitedAt = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      // Rationale: docs/job-board-index-notes.md#n654-let-agedres-await-client
      let agedRes = await client
        .from("job_board_postings")
        .select(`${LIFECYCLE_SELECT}, effective_posted`)
        .in("id", slice);
      if (agedRes.error) {
        agedRes = (await client
          .from("job_board_postings")
          .select("id, source, company_token, company, title, category, posted_at, first_seen, effective_posted")
          .in("id", slice)) as typeof agedRes;
      }
      const agedRows = agedRes.data as unknown as Array<Record<string, unknown>> | null;
      if (!agedRows?.length) continue;
      // Write the tombstone for every aged row not already tombstoned —
      // this is what keeps it from coming back. An existing tombstone keeps
      // its date: a re-admitted row's records the date it came back on.
      // AWAITED, because the chunk's delete now follows at once: a
      // tombstone still in flight when its row is deleted leaves a window
      // in which ingest can insert the row again.
      // Rationale: docs/job-board-index-notes.md#n412-redated-past-tombstone
      const untombstoned = agedRows.filter((r) => !alreadyTombstoned.has(String(r.id)));
      if (untombstoned.length > 0) {
        const { error: tombErr } = await client.from("job_board_aged_out").upsert(
          untombstoned.map((r) => ({
            id: r.id as string,
            source: r.source as string,
            company_token: r.company_token as string,
            posted_at: (r.effective_posted ?? r.posted_at) as string | null,
          })),
          // ignoreDuplicates holds the rule even when the read above failed and the set is empty.
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (tombErr) console.warn("[JOB-BOARD] freshness sweep tombstone write failed (non-fatal):", String(tombErr.message ?? tombErr).slice(0, 120));
      }
      // Rationale: docs/job-board-index-notes.md#n147-oversizeheld
      const oversizeHeld = agedRows.filter((r) => heldOversize(OVERSIZE_BOARDS, r, SHARED_TOKENS) && !alreadyTombstoned.has(String(r.id)));
      for (const r of oversizeHeld) alreadyTombstoned.add(String(r.id));
      if (oversizeHeld.length > 0) {
        console.warn(`[JOB-BOARD] freshness sweep: ${oversizeHeld.length} aged posting(s) on ${new Set(oversizeHeld.map((r) => String(r.company_token))).size} OVERSIZE board(s) dropped without a closure-log entry — the board is deferred by the byte budget, not closed`);
      }
      const freshlyDead = agedRows.filter((r) => !alreadyTombstoned.has(String(r.id)));
      if (freshlyDead.length === 0) continue;
      // Rationale: docs/job-board-index-notes.md#n655-const-sweptexitrow-r-record-string-unkno
      const sweptExitRow = (r: Record<string, unknown>) => {
        const t = tenureDays(r.posted_at, r.first_seen, exitedAt);
        return {
          posting_id: r.id as string,
          source: r.source as string,
          company_token: r.company_token as string,
          company: (r.company as string | null) ?? null,
          title: (r.title as string | null) ?? null,
          category: (r.category as string) ?? "other",
          exit_reason: exitReasonFor(r.posted_at, r.first_seen),
          posted_at: (r.posted_at as string | null) ?? null,
          days_on_board: t.days,
          origin_basis: t.basis,
          exited_at: exitedAt,
          ...lifecycleFacets(r),
        };
      };
      waitUntil(Promise.resolve(insertExits(
        client, freshlyDead.map(sweptExitRow), "freshness-sweep",
      )).then(({ error }) => {
        if (error) console.warn("[JOB-BOARD] freshness-sweep exit insert failed (non-fatal):", String(error.message ?? error).slice(0, 150));
      }).catch(() => {}));
    }
    let dropped = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await client.from("job_board_postings").delete().in("id", ids.slice(i, i + 200));
      if (error) { console.warn("[JOB-BOARD] freshness sweep delete error:", error.message); break; }
      dropped += Math.min(200, ids.length - i);
    }
    swept += dropped;
    // A chunk that would not delete is read again first next time: stop
    // rather than spin on it until the clock runs out.
    if (dropped < ids.length) { sweepStop = "delete-error"; break; }
    if (ids.length < take) break;
  }
  if (swept > 0) console.log(`[JOB-BOARD] freshness cap: dropped ${swept} postings older than ${FRESH_WINDOW_DAYS}d (stopped: ${sweepStop})`);
  await breadcrumb(client, "pass-end-swept", { dropped: swept, stop: sweepStop, elapsedMs: Date.now() - sliceWallStart });
  // Rationale: docs/job-board-index-notes.md#n656-try
  try {
    await client.from("job_board_aged_out").delete()
      .lt("aged_at", new Date(Date.now() - 180 * 86_400_000).toISOString());
  } catch { /* bounded cleanup — never worth failing a pass over */ }
  return { swept, stop: sweepStop };
}

/** Step "capacity": the corpus against its ceiling. */
async function passEndCapacity(client: SupabaseClient): Promise<{ ok: boolean; detail: string }> {
  const nowIso = new Date().toISOString();
  // Rationale: docs/job-board-index-notes.md#n148-const-count-plannedsize-await-client-from
  const { count: plannedSize } = await client.from("job_board_postings").select("id", { count: "planned", head: true });
  const estimate = typeof plannedSize === "number" ? plannedSize : null;
  let corpusSize: number | null = null;
  let corpusBasis: "exact" | "planner estimate" | "unmeasured" = "unmeasured";
  if (estimate !== null && estimate > CORPUS_CEILING * 0.95) {
    const { count: exactSize } = await client.from("job_board_postings").select("id", { count: "exact", head: true });
    if (typeof exactSize === "number") { corpusSize = exactSize; corpusBasis = "exact"; }
  }
  if (corpusSize === null && estimate !== null) { corpusSize = estimate; corpusBasis = "planner estimate"; }
  if (corpusBasis === "unmeasured") {
    console.error("[JOB-BOARD] capacity governor: corpus size unmeasurable (planned count failed) — eviction skipped and headroom unknown");
  }
  if (corpusBasis === "exact" && (corpusSize as number) > CORPUS_CEILING) {
    const overflow = (corpusSize as number) - CORPUS_TARGET;
    // Page the oldest ids (PostgREST caps a response at 1,000 rows) so a big
    // jump — e.g. a wider board selection — can be shed in one pass.
    const ids: string[] = [];
    for (let from = 0; ids.length < overflow; from += 1000) {
      const take = Math.min(1000, overflow - ids.length);
      const { data: page, error } = await client
        .from("job_board_postings")
        .select("id")
        .order("effective_posted", { ascending: true })
        .range(from, from + take - 1);
      if (error) { console.warn("[JOB-BOARD] capacity select error:", error.message); break; }
      ids.push(...(page ?? []).map((r) => r.id as string));
      if (!page || page.length < take) break;
    }
    let evicted = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await client.from("job_board_postings").delete().in("id", ids.slice(i, i + 200));
      if (error) { console.warn("[JOB-BOARD] capacity evict error:", error.message); break; }
      evicted += Math.min(200, ids.length - i);
    }
    await client.from("job_board_meta").upsert(
      { k: "capacity", v: { at: nowIso, corpusBefore: corpusSize, basis: corpusBasis, ceiling: CORPUS_CEILING, target: CORPUS_TARGET, evicted, active: true }, updated_at: nowIso },
      { onConflict: "k" },
    );
    console.warn(`[JOB-BOARD] capacity governor: corpus ${corpusSize} > ${CORPUS_CEILING} — evicted ${evicted} stalest postings toward ${CORPUS_TARGET}`);
  } else {
    // Rationale: docs/job-board-index-notes.md#n657-await-client-from-job_board_meta-upsert
    await client.from("job_board_meta").upsert(
      {
        k: "capacity",
        v: {
          at: nowIso,
          corpus: corpusSize,
          basis: corpusBasis,
          ceiling: CORPUS_CEILING,
          headroom: corpusSize === null ? null : CORPUS_CEILING - corpusSize,
          evicted: 0,
          active: false,
        },
        updated_at: nowIso,
      },
      { onConflict: "k" },
    );
  }
  return { ok: corpusBasis !== "unmeasured", detail: `corpus ${corpusSize ?? "unmeasured"} (${corpusBasis})` };
}

/** Step "names": the name-sync lane, a board at a time on this step's clock. */
async function passEndNames(client: SupabaseClient, sliceWallStart: number): Promise<{ ok: boolean; detail: string; stop?: string }> {
  // One-time name sync: ~48 rung-3 census names shipped HTML-escaped
  // ("Bob's Main Street Auto &amp; Towing") and were decoded in the catalog —
  // but the refresh is INSERT-ONLY by design (existing rows are never
  // rewritten), so stored rows can never heal on their own. Find rows still
  // carrying escaped names and sync them (postings + closures, which feed
  // the actively-hiring leaderboard) to the decoded catalog name. Stamped.
  //
  // AND EVERY BOARD AN EMPLOYER-NAME OVERRIDE NAMES (S11-133, v4). Wave 3's
  // 179 names rename about 80,800 stored postings and their closures on 216
  // boards; the migration that adds them used to do that in one
  // transaction. The lane does it here instead, a board at a time, by the
  // trigger's own precedence over company_name_overrides (name-sync.ts),
  // into the closure rollup as well (S11-135). It runs LAST in the tail and
  // stops taking boards at NAME_SYNC_UNTIL_MS from the hop's start.
  //
  // S12-015, S12-084: A CURSOR, AND NO GREEN RECEIPT WHILE BOARDS WAIT. The
  // lane walked every token from the first each pass, so it re-read 444 boards
  // it had already renamed and never reached the m's (Loblaw's tenant still
  // read "Myview" on 7,312 rows), and it answered ok:true with 90 s a pass.
  // name_sync_progress keeps the last token it finished and the tokens that
  // failed; a hop resumes after the one and retries the others first. While a
  // board waits the step answers ok:false with stop "clock" and runs again
  // (pass-end.ts PASS_END_NAME_HOPS), and the receipt says how far it got.
  const { data: nsVer } = await client.from("job_board_meta").select("v").eq("k", "name_sync_version").maybeSingle();
  if ((nsVer?.v as { version?: number } | null)?.version !== NAME_SYNC_VERSION) {
  try {
    const { data: ovRows, error: ovErr } = await client.from("company_name_overrides").select("slug, display_name");
    if (ovErr) throw new Error(`company_name_overrides unreadable: ${ovErr.message}`);
    const overrides = overrideTable(ovRows as Array<{ slug?: unknown; display_name?: unknown }> | null);
    const tokens = new Set<string>();
    for (const pat of ["%&amp;%", "%&#039;%"]) {
      const { data: escRows } = await client.from("job_board_postings").select("company_token").like("company", pat).limit(1000);
      for (const r of escRows ?? []) tokens.add(r.company_token as string);
    }
    // Rationale: docs/job-board-index-notes.md#n658-for-const-tk-of-renamed_tokens-tokens
    for (const tk of RENAMED_TOKENS) tokens.add(tk);
    for (const s of JOB_SOURCES) if (overrideFor(s.token, overrides) !== null) tokens.add(s.token);
    const { data: progRow } = await client.from("job_board_meta").select("v").eq("k", "name_sync_progress").maybeSingle();
    const prior = (progRow?.v ?? null) as NameSyncProgress | null;
    const queue = nameSyncQueue([...tokens], prior, NAME_SYNC_VERSION);
    const nameSyncUntil = sliceWallStart + NAME_SYNC_UNTIL_MS;
    // Rationale: docs/job-board-index-notes.md#n165-fixed
    let fixed = 0, failed = 0, already = 0, waiting = 0;
    const failedTokens: string[] = [];
    let after = queue.resumeAfter;
    for (const tk of queue.tokens) {
      if (Date.now() >= nameSyncUntil) { waiting += JOB_SOURCES.filter((s) => s.token === tk).length || 1; continue; }
      let tokenFailed = false;
      // Each board on the token, by its own vendor: a twin never takes the
      // other vendor's name (n417).
      for (const src of JOB_SOURCES.filter((s) => s.token === tk)) {
        const target = nameSyncTarget(src, overrides);
        // Rationale: docs/job-board-index-notes.md#n659-const-data-stale-await-client-from
        const { data: stale } = await client.from("job_board_postings")
          .select("company_token").eq("company_token", tk).eq("source", src.source).neq("company", target).limit(1);
        const { data: staleClosed } = await client.from("job_board_closures")
          .select("company_token").eq("company_token", tk).eq("source", src.source).neq("company", target).limit(1);
        if (!stale?.length && !staleClosed?.length) { already++; continue; }
        // (b) NARROW THE UPDATE to rows that actually differ.
        const { error: e1 } = await client.from("job_board_postings")
          .update({ company: target }).eq("company_token", tk).eq("source", src.source).neq("company", target);
        const { error: e2 } = await client.from("job_board_closures")
          .update({ company: target }).eq("company_token", tk).eq("source", src.source).neq("company", target);
        // The snapshots and the closure rollup are keyed by token alone, so
        // a token another vendor shares keeps what its rows already say.
        let e3: { message?: string } | null = null;
        let e4: { message?: string } | null = null;
        if (!SHARED_TOKENS.has(tk)) {
          ({ error: e3 } = await client.from("job_board_company_snapshots")
            .update({ company: target }).eq("company_token", tk).neq("company", target));
          ({ error: e4 } = await client.from("job_board_closure_rollup")
            .update({ company: target }).eq("company_token", tk).neq("company", target));
        }
        if (e1 || e2 || e3 || e4) {
          failed++;
          tokenFailed = true;
          console.warn(`[JOB-BOARD] name sync: ${src.source}:${tk} failed:`, (e1 ?? e2 ?? e3 ?? e4)?.message?.slice(0, 120));
        } else fixed++;
      }
      if (tokenFailed) failedTokens.push(tk);
      if (!queue.retry.has(tk) && tk > after) after = tk;
    }
    const doneAt = new Date().toISOString();
    // Rationale: docs/job-board-index-notes.md#n660-if-waiting-failed
    if (waiting > 0 || failed > 0) {
      const progress: NameSyncProgress = { version: NAME_SYNC_VERSION, after, retry: failedTokens.slice(0, 200), at: doneAt };
      await client.from("job_board_meta").upsert({ k: "name_sync_progress", v: progress, updated_at: doneAt }, { onConflict: "k" });
      const detail = `name sync v${NAME_SYNC_VERSION}: ${fixed} renamed, ${already} already correct, ${failed} failed, ${waiting} waiting (resumes after ${after || "the first board"})`;
      console.log(`[JOB-BOARD] ${detail}`);
      return { ok: false, detail, stop: waiting > 0 ? "clock" : "failed" };
    } else if (failed === 0) {
      await client.from("job_board_meta").upsert(
        { k: "name_sync_version", v: { version: NAME_SYNC_VERSION, fixed, already, sweptAt: doneAt }, updated_at: doneAt },
        { onConflict: "k" },
      );
      await client.from("job_board_meta").delete().eq("k", "name_sync_progress");
      console.log(`[JOB-BOARD] name sync v${NAME_SYNC_VERSION} complete: ${fixed} renamed, ${already} already correct`);
      return { ok: true, detail: `name sync v${NAME_SYNC_VERSION} complete: ${fixed} renamed, ${already} already correct`, stop: "done" };
    }
  } catch (e) {
    console.warn("[JOB-BOARD] name sync failed (retries next pass):", String(e).slice(0, 150));
    return { ok: false, detail: `name sync failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`, stop: "error" };
  }
  }
  return { ok: true, detail: `name sync v${NAME_SYNC_VERSION} done`, stop: "done" };
}

// Rationale: docs/job-board-index-notes.md#n167-verify-grace-ms

const MAINTENANCE_ANY_GAP_MS = 10 * 60_000; // floor between any two kicks
// Rationale: docs/job-board-index-notes.md#n168-maintenance-stall-ms
const MAINTENANCE_STALL_MS = 12 * 60_000;

// Rationale: docs/job-board-index-notes.md#n1180-async-function-mayberekickdeadchain-clie
async function maybeRekickDeadChain(client: SupabaseClient, opts: { inHop?: boolean } = {}): Promise<Record<string, unknown> | null> {
  try {
    const { data: rows } = await client.from("job_board_meta").select("k, v, updated_at").in("k", ["slice_stats", "chain_kick", "chain_watchdog", "slice_trace", "refresh_progress"]);
    const byKey = new Map<string, { v: unknown; updated_at: string }>();
    for (const r of (rows ?? []) as Array<{ k: string; v: unknown; updated_at: string }>) byKey.set(r.k, r);
    const ss = (byKey.get("slice_stats")?.v ?? {}) as { workAt?: string; at?: string; coldEmaMs?: unknown };
    const ckRow = byKey.get("chain_kick") ?? null;
    const ck = (ckRow?.v ?? {}) as { outcome?: unknown };
    const wd = byKey.get("chain_watchdog") ?? null;
    const now = Date.now();
    const verdict = decideRekick({
      now,
      workAt: ss.workAt,
      sliceAt: ss.at,
      traceAt: byKey.get("slice_trace")?.updated_at ?? null,
      progressAt: byKey.get("refresh_progress")?.updated_at ?? null,
      coldEmaMs: ss.coldEmaMs,
      chainOutcome: ck.outcome,
      chainAt: ckRow?.updated_at ?? null,
      watchdogAt: wd?.updated_at ?? null,
      sliceLockMs: SLICE_LOCK_MS,
    });
    const lastKick = wd
      ? { ...((wd.v ?? {}) as Record<string, unknown>), ageMin: Math.round((now - new Date(wd.updated_at).getTime()) / 60_000) }
      : null;
    const report = { at: new Date(now).toISOString(), ...verdict, kicked: false, lastKick };
    if (verdict.decision !== "rekick") return report;
    if (opts.inHop) {
      console.warn(`[JOB-BOARD] chain watchdog (in-hop, observing only): pulse ${Math.round((verdict.pulseAgeMs ?? 0) / 1000)}s old (> ${Math.round(verdict.thresholdMs / 1000)}s) from ${verdict.pulse ?? "none"} while this hop runs — a tail outlasted the window; no kick`);
      return { ...report, decision: "in_hop" };
    }
    // Rationale: docs/job-board-index-notes.md#n661-if-await-isingestpaused-client-return-re
    if (await isIngestPaused(client)) return { ...report, decision: "paused" };
    // Rationale: docs/job-board-index-notes.md#n662-const-stampv-at-report-at-pulseagems
    const stampV = { at: report.at, pulseAgeMs: verdict.pulseAgeMs, pulse: verdict.pulse, thresholdMs: verdict.thresholdMs, chainOutcome: verdict.chainOutcome, stampSuperseded: verdict.stampSuperseded, hop: 0 };
    const { data: taken } = await client.from("job_board_meta")
      .update({ v: stampV, updated_at: report.at })
      .eq("k", "chain_watchdog")
      .lt("updated_at", new Date(now - SLICE_LOCK_MS).toISOString())
      .select("k");
    let stamped = Array.isArray(taken) && taken.length === 1;
    if (!stamped) {
      const { error: insErr } = await client.from("job_board_meta").insert({ k: "chain_watchdog", v: stampV, updated_at: report.at });
      stamped = !insErr;
    }
    if (!stamped) return { ...report, decision: "throttled", note: "another caller took the stamp inside the lock" };
    console.warn(`[JOB-BOARD] chain watchdog: pulse ${Math.round((verdict.pulseAgeMs ?? 0) / 1000)}s old (> ${Math.round(verdict.thresholdMs / 1000)}s) from ${verdict.pulse ?? "none"}, chainKick ${verdict.chainOutcome ?? "none"}${verdict.stampSuperseded ? " (superseded)" : ""} — re-kicking hop 0`);
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
    waitUntil(fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh" }),
    }).then((r) => discardBody(r)));
    return { ...report, kicked: true };
  } catch (e) {
    console.warn("[JOB-BOARD] chain watchdog failed (non-fatal):", String(e).slice(0, 150));
    return null;
  }
}

async function maybeKickMaintenance(client: SupabaseClient): Promise<void> {
  try {
    // Rationale: docs/job-board-index-notes.md#n663-await-mayberekickdeadchain-client-inhop
    await maybeRekickDeadChain(client, { inHop: true });
    await maybeResumePassEnd(client);
    const { data: mk } = await client.from("job_board_meta").select("v, updated_at").eq("k", "maintenance_kick").maybeSingle();
    const lastAge = mk ? Date.now() - new Date(mk.updated_at).getTime() : Infinity;
    if (lastAge < MAINTENANCE_ANY_GAP_MS) return;
    // Fresh progress on a chain's own stamp = it is alive; leave it alone.
    const alive = async (k: string): Promise<{ alive: boolean; v: Record<string, unknown> | null }> => {
      const { data } = await client.from("job_board_meta").select("v, updated_at").eq("k", k).maybeSingle();
      if (!data) return { alive: false, v: null };
      return { alive: Date.now() - new Date(data.updated_at).getTime() < MAINTENANCE_STALL_MS, v: (data.v as Record<string, unknown>) ?? null };
    };
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
    const kick = async (action: string, extra: Record<string, unknown> = {}) => {
      await client.from("job_board_meta").upsert(
        { k: "maintenance_kick", v: { action, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, chainKey: key, ...extra }),
      })).then((r) => discardBody(r)).catch(() => {}));
    };

    // Rationale: docs/job-board-index-notes.md#n169-try
    try {
      const { data: rfRow } = await client.from("job_board_meta").select("v").eq("k", "refresh").maybeSingle();
      const cov = ((rfRow?.v ?? {}) as { coverage?: { openAt?: string } }).coverage;
      const openAge = cov?.openAt ? Date.now() - new Date(cov.openAt).getTime() : Infinity;
      if (openAge > HEADLINE_MAX_AGE_MS) {
        waitUntil((async () => {
          try {
            const { error } = await client.rpc("refresh_headline_open");
            if (error) console.warn("[JOB-BOARD] headline refresh failed:", error.message?.slice(0, 120));
          } catch (e) {
            console.warn("[JOB-BOARD] headline refresh threw:", e instanceof Error ? e.message.slice(0, 120) : String(e));
          }
        })());
      }
    } catch { /* a stale headline is a worse number, never a broken request */ }

    // Rationale: docs/job-board-index-notes.md#n170-cb
    const cb = await alive("country_backfill");
    const cbDone = Number(cb.v?.mapVersion) === COUNTRY_MAP_VERSION && typeof cb.v?.doneAt === "string";
    if (!cbDone && !cb.alive) {
      const cbCursor = Number(cb.v?.mapVersion) === COUNTRY_MAP_VERSION && typeof cb.v?.cursor === "string" ? cb.v.cursor as string : "";
      await kick("backfill-country", cbCursor ? { cursor: cbCursor } : {});
    }

    // Rationale: docs/job-board-index-notes.md#n664-const-es-await-alive-embed_sweep
    const es = await alive("embed_sweep");
    const esDoneAt = typeof es.v?.doneAt === "string" ? Date.parse(es.v.doneAt as string) : NaN;
    const esSettled = Number.isFinite(esDoneAt) && Date.now() - esDoneAt < 60 * 60_000;
    if (!es.alive && !esSettled) {
      await kick("embed-sweep");
    }

    // Rationale: docs/job-board-index-notes.md#n171-pb
    const pb = await alive("posted_backfill");
    const pbv = (pb.v ?? {}) as { version?: number; sweptAt?: string; resumeVersion?: number; phase?: string; cursor?: string; backlogAtSweep?: number };
    if (!pb.alive && postedBackfillDue(pbv, await undatedBacklog(client))) {
      const pbResume = pbv.resumeVersion === POSTED_BACKFILL_VERSION
        && typeof pbv.phase === "string" && typeof pbv.cursor === "string"
        ? { phase: pbv.phase, cursor: pbv.cursor }
        : {};
      await kick("backfill-posted", pbResume);
    }

    // Rationale: docs/job-board-index-notes.md#n172-ss
    const ss = await alive("structured_sweep");
    const ssDone = typeof ss.v?.doneAt === "string" ? Date.parse(ss.v.doneAt as string) : NaN;
    // 24h, not desc-sweep's 6: a posting's remoteType does not change, so
    // re-walking sooner buys nothing but vendor requests.
    const ssSettled = Number.isFinite(ssDone) && Date.now() - ssDone < 24 * 60 * 60_000;
    // Rationale: docs/job-board-index-notes.md#n173-sszeropasses
    const ssZeroPasses = Number((ss.v as { zeroFilledPasses?: number } | null)?.zeroFilledPasses ?? 0);
    const ssBackoffH = ssZeroPasses >= 2 ? Math.min(24 * Math.pow(2, ssZeroPasses - 1), 168) : 24;
    const ssBackedOff = Number.isFinite(ssDone) && Date.now() - ssDone < ssBackoffH * 60 * 60_000;
    if (!ss.alive && !ssSettled && !ssBackedOff) {
      const ssCursor = typeof ss.v?.cursor === "string" ? ss.v.cursor as string : "";
      await kick("structured-sweep", { vi: 0, cursor: ssCursor });
    }

    // Rationale: docs/job-board-index-notes.md#n665-const-data-catver-await-client-from
    const { data: catVer } = await client.from("job_board_meta").select("v").eq("k", "category_rules_version").maybeSingle();
    const cv = (catVer?.v ?? null) as { version?: number; startedUnder?: number } | null;
    // Rationale: docs/job-board-index-notes.md#n666-if-cv-version-categorize_version-number
    if (cv?.version !== CATEGORIZE_VERSION || Number(cv?.startedUnder) !== CATEGORIZE_VERSION) {
      const prog = await alive("recategorize_progress");
      if (!prog.alive) {
        // Rationale: docs/job-board-index-notes.md#n667-const-sameversion-number-prog-v-startedu
        const sameVersion = Number(prog.v?.startedUnder) === CATEGORIZE_VERSION;
        const cursor = sameVersion && typeof prog.v?.cursor === "string" ? prog.v.cursor as string : "";
        await kick("recategorize", { ...(cursor ? { cursor } : {}), rulesVersion: CATEGORIZE_VERSION });
      }
      return;
    }
    // Rationale: docs/job-board-index-notes.md#n668-const-data-bf-await-client-from
    const { data: bf } = await client.from("job_board_meta").select("v, updated_at").eq("k", "desc_backfill").maybeSingle();
    const bfAge = bf ? Date.now() - new Date(bf.updated_at).getTime() : Infinity;
    const bfIncomplete = !!(bf?.v as { incompleteAt?: string } | null)?.incompleteAt;
    // Rationale: docs/job-board-index-notes.md#n174-lighttokens
    const lightTokens = descBackfillBoards().map((s) => s.token);
    let missingCoverage = false;
    if (lightTokens.length > 0 && bfAge > 30 * 60_000) {
      const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).in("company_token", lightTokens).eq("source", DESC_BACKFILL_VENDOR).is("description", null);
      missingCoverage = (count ?? 0) > 50;
    }
    // Rationale: docs/job-board-index-notes.md#n175-missingcoverage-bfage-bfincomplete
    if (missingCoverage || bfAge > (bfIncomplete ? 60 * 60_000 : 24 * 60 * 60_000)) {
      await kick("backfill-desc", { ti: 0, off: 0 });
    }
    // Rationale: docs/job-board-index-notes.md#n176-ds
    const ds = await alive("desc_sweep");
    const doneAt = typeof ds.v?.doneAt === "string" ? Date.parse(ds.v.doneAt as string) : NaN;
    // Rationale: docs/job-board-index-notes.md#n669-const-settled-number-isfinite-doneat-dat
    const settled = Number.isFinite(doneAt) && Date.now() - doneAt < 6 * 60 * 60_000;
    if (!ds.alive && !settled) {
      // Rationale: docs/job-board-index-notes.md#n177-len
      const LEN = DETAIL_DESC_SOURCES.length;
      const dsv = (ds.v ?? {}) as { nextStartVi?: number; runningVi?: number };
      const startVi = Number.isFinite(Number(dsv.nextStartVi))
        ? Math.max(0, Number(dsv.nextStartVi)) % LEN
        : Number.isFinite(Number(dsv.runningVi)) ? (Math.max(0, Number(dsv.runningVi)) + 1) % LEN : 0;
      await kick("desc-sweep", { vi: startVi, vstart: startVi });
    }
  } catch (e) {
    // Maintenance is best-effort; it must never break a refresh slice.
    console.warn("[JOB-BOARD] maintenance kick skipped:", String(e).slice(0, 120));
  }
}

// Rationale: docs/job-board-index-notes.md#n1181-function-withdeadline-t-p-promiselike-t
function withDeadline<T>(p: PromiseLike<T>, ms: number): Promise<T | { data: null }> {
  return Promise.race([
    Promise.resolve(p).then((r) => r, () => ({ data: null } as { data: null })),
    new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), ms)),
  ]);
}

// ── detail: one posting's description (bounded memo, no bulk caching) ─────

/**
 * IN-ISOLATE STATE DOES NOT SURVIVE BETWEEN REQUESTS HERE. DO NOT ADD A CACHE.
 *
 * Two were added on 2026-08-27 and both were inert: a 60s TTL cache of the
 * 1.3-1.6MB facet row, and a 10-minute cooldown that was meant to stand the
 * semantic tier down after an infrastructure failure. Neither ever fired.
 *
 * Measured on the offset-ceiling exit, which reads the meta row and runs no
 * query of its own: fourteen consecutive requests — six of them issued on ONE
 * TCP connection less than a second apart — cost 452-1,034ms each against a
 * 60,000ms TTL. Zero hits out of fourteen. The cache was provably being SEEDED
 * on those same requests (the responses carried totals read off the row), so
 * this is a demonstration, not an inference: the module is warm, its heap is not.
 *
 * The facet read is fixed by not reading the fat row at all — see `refresh_head`
 * at the writer and the read site. The semantic cooldown is simply removed: it
 * guarded against a dead ANN, the ANN is fixed, each attempt is still bounded by
 * its own 5s deadline, and semanticDegraded reports it from outside. A guard
 * that cannot fire is worse than no guard, because it reads as protection.
 */

// Rationale: docs/job-board-index-notes.md#n670-const-detailcache-new-map-string-at
const detailCache = new Map<string, { at: number; text: string; pay: string | null }>();
const DETAIL_TTL_MS = 60 * 60_000;

// Rationale: docs/job-board-index-notes.md#n178-embed-per-hop
const EMBED_PER_HOP = 6;
const EMBED_HOP_WALL_MS = 1_100; // inference is synchronous CPU, so wall ~ CPU here
// Rationale: docs/job-board-index-notes.md#n179-embed-hop-pause-ms
const EMBED_HOP_PAUSE_MS = 4_000;
let aiSession: { run: (input: string, opts: Record<string, unknown>) => Promise<unknown> } | null = null;
async function embedText(text: string): Promise<number[] | null> {
  try {
    if (!aiSession) {
      const S = (globalThis as unknown as { Supabase?: { ai?: { Session?: new (m: string) => NonNullable<typeof aiSession> } } }).Supabase;
      if (!S?.ai?.Session) return null; // runtime without inference — callers degrade
      aiSession = new S.ai.Session("gte-small");
    }
    const out = await aiSession.run(text, { mean_pool: true, normalize: true });
    return Array.isArray(out) && out.length === 384 ? out as number[] : null;
  } catch {
    return null;
  }
}

// Rationale: docs/job-board-index-notes.md#n180-liveboardmemo
const liveBoardMemo = new Map<string, { ids: Set<string>; windowed: boolean }>();
// Rationale: docs/job-board-index-notes.md#n181-checklive
async function checkLive(src: JobSource, externalId: string, applyUrl?: string | null, note?: { pageCapped: boolean }): Promise<boolean | null> {
  try {
    if (src.source === "greenhouse") {
      const gh = greenhouseApi(src.token);
      const res = await fetchWithTimeout(`https://${gh.host}/v1/boards/${gh.token}/jobs/${externalId}?questions=false`);
      return res.status === 404 ? false : res.ok ? true : null;
    }
    if (src.source === "lever") {
      const lv = leverApi(src.token);
      const res = await fetchWithTimeout(`https://${lv.host}/v0/postings/${lv.token}/${externalId}?mode=json`);
      return res.status === 404 ? false : res.ok ? true : null;
    }
    if (src.source === "smartrecruiters") {
      const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${src.token}/postings/${externalId}`);
      return res.status === 404 ? false : res.ok ? true : null;
    }
    if (src.source === "oracle") {
      // Rationale: docs/job-board-index-notes.md#n671-const-tenant-region-site-src-token
      const [tenant, region, site] = src.token.split("~");
      if (!tenant || !region || !site) return null;
      const finder = `ById;Id=${externalId},siteNumber=${site}`;
      const res = await fetchWithTimeout(
        `https://${tenant}.fa.${region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=${encodeURIComponent(finder)}`,
      );
      if (res.status === 404) return false;
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      const items = (body as { items?: unknown[] } | null)?.items;
      return Array.isArray(items) ? items.length > 0 : null;
    }
    if (src.source === "workday") {
      // Rationale: docs/job-board-index-notes.md#n182-const-tenant-dc-site-src-token-split
      const [tenant, dc, site] = src.token.split("~");
      if (!tenant || !dc || !site) return null;
      const search = async (q: string): Promise<Array<{ externalPath?: string; bulletFields?: string[] }> | null> => {
        const res = await fetchWithTimeout(`https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ limit: 20, offset: 0, searchText: q, appliedFacets: {} }),
        });
        if (!res.ok) return null;
        const body = await res.json();
        return (body as { jobPostings?: Array<{ externalPath?: string; bulletFields?: string[] }> }).jobPostings ?? [];
      };
      // The FULL stored id must appear, even when the base id is what we asked
      // for — a sibling `JR3085-2` being open says nothing about `JR3085-1`.
      const holds = (items: Array<{ externalPath?: string; bulletFields?: string[] }>) =>
        items.some((j) => String(j.externalPath ?? "").includes(externalId) || (j.bulletFields ?? []).includes(externalId));

      const first = await search(externalId);
      if (first === null) return null;
      if (holds(first)) return true;
      const base = externalId.replace(/-\d+$/, "");
      if (base && base !== externalId) {
        const second = await search(base);
        if (second === null) return null;
        if (second.some((j) => String(j.externalPath ?? "").includes(externalId))) return true;
      }
      // Rationale: docs/job-board-index-notes.md#n672-const-cxs-applyurl-workdaycxsurl-applyur
      const cxs = applyUrl ? workdayCxsUrl(applyUrl) : null;
      if (cxs) {
        const det = await fetchWithTimeout(cxs);
        if (det.status === 404) return false;
        if (!det.ok) return null;
        const body = await det.json().catch(() => null) as { jobPostingInfo?: unknown } | null;
        return !!body?.jobPostingInfo;
      }
      return false;
    }
    // The remaining vendors have no cheap per-job endpoint — fetch the board
    // once (memoized per request) and check membership.
    const memoKey = `${src.source}:${src.token}`;
    let memo = liveBoardMemo.get(memoKey);
    if (!memo) {
      // The memo keeps only boards that answered; a board the byte bound
      // refused is remembered across ids and requests by the reader instead.
      const r = await readBoardForDetail(src);
      if (!r) return null;
      // FIFTEEN vendors reach here, not three. Only greenhouse / lever /
      // smartrecruiters / oracle / workday return above; everything else in
      // JobSourceKind falls through to membership — ashby, workable, bamboohr,
      // recruitee, teamtailor, personio, breezy, pinpoint, paylocity, rippling,
      // icims, adp, ukg, jazzhr, usajobs. The old comment here still named the
      // original three, and that staleness is exactly what hid the missing
      // windowed guard below: the vendors that CAN window (icims, rippling,
      // adp, ukg, usajobs, jazzhr) all arrived after the comment was written.
      const ids = new Set<string>();
      if (src.source === "ashby") for (const j of ((r.raw as { jobs?: Array<{ id: string }> }).jobs ?? [])) ids.add(String(j.id));
      else for (const j of r.jobs) ids.add(j.id.split(":").slice(2).join(":")); // `source:token:externalId` — strip our prefix
      memo = { ids, windowed: r.windowed === true };
      liveBoardMemo.set(memoKey, memo);
    }
    // ── WINDOWED-ABSENCE RULE ────────────────────────────────────────────────
    // The SAME rule the refresh prune applies at `truncatedFetch`
    // (`r.windowed === true`), stated here because this is the second place a
    // posting's absence gets turned into a closure — and until now the only one
    // that did it WITHOUT the rule.
    //
    // `windowed` means the vendor's OWN advertised total exceeded what we could
    // fetch. A posting displaced past the page cap is absent from `ids` while
    // being perfectly live on the employer's site: measured 2026-07-21, 7 of 8
    // sampled "closures" on a windowed board were still open. ~4,348 of 44,542
    // boards sit on capped fetchers, so this is not a corner.
    //
    // Reading absence as `false` here told a user "{{company}} took this one
    // down" about a live role at a NAMED employer, stamped the posting
    // missing_since so it vanished for everyone, and then DELETEd it with no
    // closure row — a hole in the lifecycle log, the one asset that cannot be
    // re-derived.
    //
    // Three states, and `null` is not a hedge: the verify action already treats
    // null as "keep showing" (it is what the catch below returns for a network
    // hiccup), and the audit counts it as `unknown` rather than scoring it
    // against vendor accuracy. Absent + windowed is genuinely UNKNOWN.
    // Spelled `X.windowed === true`, the SAME four tokens as the prune's
    // `truncatedFetch` and the closure log's `partialRead`. Not a style
    // preference: the guard asserts all three derivations are spelled
    // identically, because three sites that mean the same thing and say it
    // three ways are three sites that drift apart one edit at a time. The
    // branch that turns this flag into a user-visible verdict is the LAST one
    // that should be exempt from that rule.
    const truncatedFetch = memo.windowed === true;
    if (memo.ids.has(externalId)) return true;
    if (truncatedFetch) { if (note) note.pageCapped = true; return null; }
    return false;
  } catch {
    return null; // network hiccup — unknown, never a false "closed"
  }
}

// Rationale: docs/job-board-index-notes.md#n1182-async-function-getdescription-src-jobsou
async function getDescription(src: JobSource, id: string, externalId: string, applyUrl?: string | null): Promise<{ text: string | null; pay: string | null }> {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return { text: hit.text, pay: hit.pay };
  const { text, pay } = await fetchVendorDetail(src, id, externalId, applyUrl);
  if (text) {
    if (detailCache.size > 300) detailCache.clear();
    detailCache.set(id, { at: Date.now(), text, pay });
  }
  return { text, pay };
}

// Rationale: docs/job-board-index-notes.md#n1183-function-listpayloaddescriptions-s-jobso
function listPayloadDescriptions(s: JobSource, raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (s.source === "workable") {
    for (const j of ((raw as { jobs?: Array<{ shortcode?: string; description?: string }> }).jobs ?? [])) {
      const ext = j.shortcode ?? "";
      const text = j.description ? htmlToText(String(j.description).slice(0, RAW_HTML_CAP)).trim() : "";
      if (ext && text) out.set(`workable:${s.token}:${ext}`, text.slice(0, STORED_DESC_CAP));
    }
  } else if (s.source === "icims") {
    // iCIMS ships the full description (plus responsibilities/qualifications)
    // on every LIST item — no per-posting fetch is ever needed for this vendor.
    for (const it of (((raw as { items?: Array<{ data?: Record<string, unknown> }> }).items) ?? [])) {
      const d = it?.data ?? {};
      const ext = String(d.req_id ?? d.slug ?? "").trim();
      const html = [d.description, d.responsibilities, d.qualifications]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join("\n");
      const text = html ? htmlToText(html.slice(0, RAW_HTML_CAP)).trim() : "";
      if (ext && text) out.set(`icims:${s.token}:${ext}`, text.slice(0, STORED_DESC_CAP));
    }
  } else if (s.source === "pinpoint") {
    for (const p of (((raw as { data?: Array<Record<string, unknown>> }).data) ?? [])) {
      const ext = p.id == null ? "" : String(p.id);
      const html = [p.description, p.key_responsibilities, p.skills_knowledge_expertise]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join("\n");
      const text = html ? htmlToText(html.slice(0, RAW_HTML_CAP)).trim() : "";
      if (ext && text) out.set(`pinpoint:${s.token}:${ext}`, text.slice(0, STORED_DESC_CAP));
    }
  }
  return out;
}

// A board the byte bound refuses answers neither a lever/ashby detail read nor
// checkLive's membership check, and asking again per view or per verify id
// repeats the refused download (up to 4 MB for ashby). Only the oversize
// verdict is remembered, per board, per isolate, for a few hours.
// Rationale: docs/job-board-index-notes.md#n411-streamed-oversize-read
const DETAIL_BOARD_REFUSED = new Map<string, number>();
const DETAIL_BOARD_REFUSED_TTL_MS = 6 * 3_600_000;
async function readBoardForDetail(src: JobSource): Promise<Awaited<ReturnType<typeof fetchBoard>>> {
  const key = `${src.source}:${src.token}`;
  const at = DETAIL_BOARD_REFUSED.get(key);
  if (at !== undefined && Date.now() - at < DETAIL_BOARD_REFUSED_TTL_MS) return null;
  let reason = "";
  const r = await fetchBoard(src, (m) => { reason = m; });
  if (!r && reason.startsWith("oversize")) {
    if (DETAIL_BOARD_REFUSED.size > 500) DETAIL_BOARD_REFUSED.clear();
    DETAIL_BOARD_REFUSED.set(key, Date.now());
  }
  return r;
}

// Rationale: docs/job-board-index-notes.md#n1184-async-function-fetchvendordetail
async function fetchVendorDetail(
  src: JobSource,
  id: string,
  externalId: string,
  applyUrl?: string | null,
): Promise<{
  text: string | null;
  postedAt: string | null;
  workMode: "remote" | "hybrid" | "onsite" | null;
  country: string | null;
  location: string | null;
  /** Sites the requisition lists BESIDES `location`. 0 means the place is the whole answer. */
  additionalSites: number;
  // Rationale: docs/job-board-index-notes.md#n1185-pay-string-null
  pay: string | null;
}> {
  let text: string | null = null;
  // Rationale: docs/job-board-index-notes.md#n183-country
  let country: string | null = null;
  let location: string | null = null;
  let additionalSites = 0;
  // Rationale: docs/job-board-index-notes.md#n673-let-workmode-remote-hybrid-onsite-null
  let workMode: "remote" | "hybrid" | "onsite" | null = null;
  // Rationale: docs/job-board-index-notes.md#n674-let-postedat-string-null-null
  let postedAt: string | null = null;
  // The employer's own stated pay, formatted and gated. Populated only by the
  // two vendors whose page carries the structured node (see the return type).
  let pay: string | null = null;
  if (src.source === "smartrecruiters") {
    const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${src.token}/postings/${externalId}`);
    if (res.ok) {
      const j = await res.json();
      const s = j.jobAd?.sections ?? {};
      const html = [s.jobDescription?.text, s.qualifications?.text, s.additionalInformation?.text].filter(Boolean).join("\n");
      text = htmlToText(html).slice(0, DESC_CAP) || null;
    }
  } else if (src.source === "workable") {
    const res = await fetchWithTimeout(`https://apply.workable.com/api/v1/widget/accounts/${src.token}?details=true`);
    if (res.ok) {
      const j = await res.json();
      const job = (j.jobs ?? []).find((x: { shortcode: string }) => x.shortcode === externalId);
      if (job?.description) text = htmlToText(String(job.description)).slice(0, DESC_CAP) || null;
    }
  } else if (src.source === "oracle") {
    // Per-requisition detail carries the full posting: description +
    // qualifications + responsibilities as separate HTML fields.
    const [tenant, region, site] = src.token.split("~");
    if (tenant && region && site) {
      const finder = `ById;Id=${externalId},siteNumber=${site}`;
      const res = await fetchWithTimeout(
        `https://${tenant}.fa.${region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(finder)}`,
      );
      if (res.ok) {
        const j = await res.json().catch(() => null);
        const it = (j as { items?: Array<Record<string, unknown>> } | null)?.items?.[0] ?? null;
        if (it) {
          const html = ["ExternalDescriptionStr", "ExternalResponsibilitiesStr", "ExternalQualificationsStr"]
            .map((k) => (typeof it[k] === "string" ? it[k] as string : ""))
            .filter(Boolean)
            .join("\n");
          text = htmlToText(html).slice(0, DESC_CAP) || null;
        }
      }
    }
  } else if (src.source === "workday") {
    // Rationale: docs/job-board-index-notes.md#n675-const-cxs-applyurl-workdaycxsurl-applyur
    const cxs = applyUrl ? workdayCxsUrl(applyUrl) : null;
    if (cxs) {
      const res = await fetchWithTimeout(cxs);
      if (res.ok) {
        const j = await res.json().catch(() => null) as { jobPostingInfo?: { jobDescription?: string; startDate?: string; remoteType?: string } } | null;
        const html = j?.jobPostingInfo?.jobDescription ?? "";
        text = html ? htmlToText(String(html)).slice(0, DESC_CAP) || null : null;
        postedAt = isoDateOnly(j?.jobPostingInfo?.startDate);
        // Rationale: docs/job-board-index-notes.md#n676-country-location-additionalcount-additio
        ({ country, location, additionalCount: additionalSites } = workdayDetailPlace(j));
        // Rationale: docs/job-board-index-notes.md#n184-rt
        const rt = String(j?.jobPostingInfo?.remoteType ?? "").toLowerCase().trim();
        workMode = !rt ? null
          : /\bnon[-\s]?remote\b|\bnot remote\b|\bno remote\b|\bnon[-\s]?rem\b/.test(rt) ? "onsite"
          : /hybrid|hybride|flex/.test(rt) ? "hybrid"
          : /on[-\s]?site|in[-\s]?person|on[-\s]?campus|campus[-\s]?based|on[-\s]?premise|fully on|field[-\s]?based/.test(rt) ? "onsite"
          : /remote|work from home|wfh|telework|virtual|distributed/.test(rt) ? "remote"
          : null;
        // The next unknown label should be visible, not silent — that is the
        // whole reason this was broken for so long.
        if (rt && !workMode) console.log(`[JOB-BOARD] unclassified remoteType: ${JSON.stringify(rt).slice(0, 80)}`);
      }
    }
  } else if (src.source === "bamboohr") {
    // Rationale: docs/job-board-index-notes.md#n677-const-res-await-fetchwithtimeout-https-s
    const res = await fetchWithTimeout(`https://${src.token}.bamboohr.com/careers/${externalId}/detail`);
    if (res.ok) {
      const j = await res.json().catch(() => null) as { result?: { jobOpening?: { description?: string; datePosted?: string } } } | null;
      const html = j?.result?.jobOpening?.description ?? "";
      text = html ? htmlToText(String(html)).slice(0, DESC_CAP) || null : null;
      postedAt = isoDateOnly(j?.result?.jobOpening?.datePosted);
    }
  } else if (src.source === "breezy") {
    // No description on the /json list — it only exists on the posting page,
    // as the schema.org JobPosting block Breezy emits for Google Jobs.
    const url = applyUrl || `https://${src.token}.breezy.hr/p/${externalId}`;
    const res = await fetchWithTimeout(url);
    if (res.ok) {
      const ld = jobPostingLd(await res.text());
      text = ld.description ? htmlToText(ld.description).slice(0, DESC_CAP) || null : null;
      pay = ldBaseSalaryText(ld.pay);
    }
  } else if (src.source === "jazzhr") {
    // Rationale: docs/job-board-index-notes.md#n678-const-res-await-fetchwithtimeout-applyur
    const res = await fetchWithTimeout(applyUrl || jazzhrPostingUrl(src, externalId));
    if (res.ok) {
      const d = parseJazzhrDetail(await res.text());
      text = d.description ? htmlToText(d.description).slice(0, DESC_CAP) || null : null;
      postedAt = d.postedAt;
      workMode = d.workMode;
    }
  } else if (src.source === "ukg") {
    // Rationale: docs/job-board-index-notes.md#n679-const-parts-ukgboardparams-src-token
    const parts = ukgBoardParams(src.token);
    if (parts) {
      const res = await fetchWithTimeout(
        `https://${parts.pod}.ultipro.com/${parts.tenant}/JobBoard/${parts.board}/OpportunityDetail?opportunityId=${externalId}`,
      );
      if (res.ok) {
        const m = /CandidateOpportunityDetail\((\{[\s\S]*?\})\);/.exec(await res.text());
        if (m) {
          const j = JSON.parse(m[1]) as { Description?: string } | null;
          const html = typeof j?.Description === "string" ? j.Description : "";
          text = html ? htmlToText(html).slice(0, DESC_CAP) || null : null;
        }
      }
    }
  } else if (src.source === "paylocity") {
    // Rationale: docs/job-board-index-notes.md#n680-const-res-await-fetchwithtimeout-https-r
    const res = await fetchWithTimeout(`https://recruiting.paylocity.com/recruiting/jobs/Details/${externalId}`);
    if (res.ok) {
      const ld = jobPostingLd(await res.text());
      text = ld.description ? htmlToText(ld.description).slice(0, DESC_CAP) || null : null;
      pay = ldBaseSalaryText(ld.pay);
    }
  } else if (src.source === "adp") {
    // Rationale: docs/job-board-index-notes.md#n681-const-cid-ccid-adpboardparams-src-token
    const { cid, ccId } = adpBoardParams(src.token);
    const res = await fetchWithTimeout(
      `https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions/${externalId}?cid=${cid}&ccId=${ccId}&timeStamp=${Date.now()}&lang=en_US&locale=en_US`,
    );
    if (res.ok) {
      const j = await res.json().catch(() => null) as { requisitionDescription?: string } | null;
      const html = j?.requisitionDescription ?? "";
      text = html ? htmlToText(String(html)).slice(0, DESC_CAP) || null : null;
    }
  } else if (src.source === "rippling") {
    // Rationale: docs/job-board-index-notes.md#n682-const-res-await-fetchwithtimeout-https-a
    const res = await fetchWithTimeout(`https://api.rippling.com/platform/api/ats/v1/board/${src.token}/jobs/${externalId}`);
    if (res.ok) {
      const body = await res.json() as { description?: { company?: string; role?: string } };
      const html = [body?.description?.role, body?.description?.company]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join("\n");
      text = html ? htmlToText(html).slice(0, DESC_CAP) || null : null;
    }
  } else if (src.source === "pinpoint") {
    // Descriptions ship in the list payload — one board fetch, extract the row.
    const r = await fetchBoard(src);
    const data = ((r?.raw as { data?: Array<{ id?: string | number; description?: string; skills_knowledge_expertise?: string }> })?.data) ?? [];
    const job = data.find((x) => `pinpoint:${src.token}:${x.id}` === id);
    if (job) {
      const html = [job.description, job.skills_knowledge_expertise].filter(Boolean).join("\n");
      text = htmlToText(html).slice(0, DESC_CAP) || null;
    }
  } else if (src.source === "greenhouse") {
    const gh = greenhouseApi(src.token);
    const res = await fetchWithTimeout(`https://${gh.host}/v1/boards/${gh.token}/jobs/${externalId}?questions=false`);
    if (res.ok) {
      const j = await res.json();
      text = htmlToText(String(j.content ?? "")).slice(0, DESC_CAP) || null;
    }
  } else if (src.source === "lever" || src.source === "ashby") {
    // Rationale: docs/job-board-index-notes.md#n683-const-r-await-readboardfordetail-src
    const r = await readBoardForDetail(src);
    if (r) {
      if (src.source === "lever") {
        const raw = (Array.isArray(r.raw) ? r.raw : []) as Array<{ id: string; descriptionPlain?: string; descriptionBodyPlain?: string }>;
        const job = raw.find((x) => `lever:${src.token}:${x.id}` === id);
        if (job) text = ((job.descriptionPlain ?? "") + (job.descriptionBodyPlain ? `\n${job.descriptionBodyPlain}` : "")).slice(0, DESC_CAP) || null;
      } else {
        const raw = (r.raw as { jobs?: Array<{ id: string; descriptionPlain?: string; descriptionHtml?: string }> }).jobs ?? [];
        const job = raw.find((x) => `ashby:${src.token}:${x.id}` === id);
        if (job) text = (job.descriptionPlain ?? (job.descriptionHtml ? htmlToText(job.descriptionHtml) : "")).slice(0, DESC_CAP) || null;
      }
    }
  }
  // Everything else — rippling today — has no public description source.
  // Returning null here is a measured fact, not an unfinished branch.
  return { text, postedAt, workMode, country, location, additionalSites, pay };
}

// Rationale: docs/job-board-index-notes.md#n1186-function-placewrite
function placeWrite(
  row: { location: string | null; country: string | null },
  vendorCountry: string | null,
  vendorLocation: string | null,
  additionalSites: number,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (vendorCountry) patch.country = vendorCountry;
  if (vendorLocation && isPlacelessLocation(row.location)) patch.location = vendorLocation;
  if (!patch.country && !patch.location) return patch;
  const oneOfMany = patch.location !== undefined && additionalSites > 0;
  patch.region_code = oneOfMany
    ? null
    : detectRegion(
      (patch.location as string | null) ?? row.location,
      (patch.country as string | null) ?? row.country,
    );
  return patch;
}

// Rationale: docs/job-board-index-notes.md#n1187-function-isodateonly-v-unknown-string-nu
function isoDateOnly(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v.length <= 10 ? `${v}T00:00:00Z` : v);
  if (!Number.isFinite(t)) return null;
  // Not in the future, not absurdly old.
  if (t > Date.now() + 86_400_000 || t < Date.now() - 400 * 86_400_000) return null;
  return new Date(t).toISOString();
}

// ── list: SQL reads + SWR background refresh ───────────────────────────────

// Rationale: docs/job-board-index-notes.md#n185-

// Rationale: docs/job-board-index-notes.md#n1188-const-query_filler-new-set
const QUERY_FILLER = new Set([
  // the search itself
  "job", "jobs", "career", "careers", "vacancy", "vacancies", "opening",
  "openings", "position", "positions", "employment", "hiring", "listing",
  "listings", "opportunity", "opportunities",
  // proximity phrasing — the location filter is the honest home for this
  "near", "nearby", "me", "around", "close",
  // grammatical glue
  "in", "at", "for", "the", "a", "an", "of", "and", "or", "to", "with", "my",
]);


// Rationale: docs/job-board-index-notes.md#n1189-const-intent_filters-array-re-regexp-lab
// Rationale: docs/job-board-index-notes.md#n1190-const-intent_filters-array-re-regexp-lab
// Rationale: docs/job-board-index-notes.md#n1191-const-intent_filters-array-re-regexp-lab
// Rationale: docs/job-board-index-notes.md#n1192-const-intent_filters-array-re-regexp-lab
const INTENT_FILTERS: Array<{ re: RegExp; label: string; patch: Record<string, unknown> }> = [
  // Rationale: docs/job-board-index-notes.md#n186-re-new-regexp-negated-remote-source-i-la
  { re: new RegExp(NEGATED_REMOTE_SOURCE, "i"), label: "not remote", patch: {} },
  // Phrases first: a bare word below must never shred a longer phrase above it.
  { re: /\bwork(?:ing)? from home\b/i, label: "work from home", patch: { workMode: "remote" } },
  { re: /\bwfh\b/i, label: "wfh", patch: { workMode: "remote" } },
  { re: /\btele(?:commut|work)\w*\b/i, label: "telecommute", patch: { workMode: "remote" } },
  { re: /\bhome[- ]based\b/i, label: "home based", patch: { workMode: "remote" } },
  { re: /\bremote(?:ly)? only\b/i, label: "remote only", patch: { workMode: "remote" } },
  // The bare work-mode words, per the measurement above.
  // Not the first word of a trade term: "Remote Sensing Analyst", "Hybrid Vehicle Technician" (L8-06).
  { re: /\bremote(?:ly)?\b(?!\s+(?:sensing|pilots?|patient|monitoring|operated)\b)/i, label: "remote", patch: { workMode: "remote" } },
  { re: /\bhybrid\b(?!\s+(?:vehicles?|electric|cars?|cloud|powertrains?|engines?)\b)/i, label: "hybrid", patch: { workMode: "hybrid" } },
  { re: /\bon[- ]?site\b/i, label: "onsite", patch: { workMode: "onsite" } },
  // Seniority phrases map onto the experience band the board already stores.
  { re: /\bno experience(?: (?:required|needed|necessary))?\b/i, label: "no experience", patch: { experience: ["entry"] } },
  { re: /\bentry[- ]level\b/i, label: "entry level", patch: { experience: ["entry"] } },
  { re: /\bgraduate scheme\b/i, label: "graduate scheme", patch: { experience: ["entry"] } },
  // Rationale: docs/job-board-index-notes.md#n187-re-bpart-time-b-i-label-part-time
  { re: /\bpart[- ]?time\b/i, label: "part time", patch: { employmentType: "part_time" } },
  { re: /\bfull[- ]?time\b/i, label: "full time", patch: { employmentType: "full_time" } },
  { re: /\binternships?\b/i, label: "internship", patch: { employmentType: "internship" } },
  { re: /\binterns?\b/i, label: "intern", patch: { employmentType: "internship" } },
  { re: /\btemporary\b/i, label: "temporary", patch: { employmentType: "temporary" } },
  { re: /\bcontract(?:or|ing)? (?:role|position|work|job)s?\b/i, label: "contract role", patch: { employmentType: "contract" } },
  // Freshness phrasing — maxAgeDays is an existing, indexed predicate.
  { re: /\bhiring (?:now|immediately)\b/i, label: "hiring now", patch: { maxAgeDays: 7 } },
  { re: /\bimmediate start\b/i, label: "immediate start", patch: { maxAgeDays: 7 } },
  { re: /\bposted today\b/i, label: "posted today", patch: { maxAgeDays: 1 } },
];

// Rationale: docs/job-board-index-notes.md#n1193-const-intent_conflicts-record-string-str
const INTENT_CONFLICTS: Record<string, string[]> = {
  remote: ["remote", "workMode"],
  workMode: ["remote", "workMode"],
  experience: ["experience"],
  maxAgeDays: ["maxAgeDays", "postedAfter"],
  employmentType: ["employmentType"],
};

// Rationale: docs/job-board-index-notes.md#n1194-function-liftintentfilters
function liftIntentFilters(
  rawQ: unknown,
  body: Record<string, unknown>,
): { patch: Record<string, unknown>; labels: string[]; residualQ: string } | null {
  const q = String(rawQ ?? "");
  // noIntent: the caller (the page's undo) asked for every word as search text (L8-06).
  if (!q.trim() || body.noIntent === true) return null;
  // A balanced "…" pair is an exact phrase, never a filter: masked while the rules run.
  const quoted: string[] = [];
  let residual = q.replace(/"[^"]*"/g, (m) => `\u0001${quoted.push(m) - 1}\u0001`);
  const patch: Record<string, unknown> = {};
  const labels: string[] = [];
  for (const { re, label, patch: p } of INTENT_FILTERS) {
    if (!re.test(residual)) continue;
    // Rationale: docs/job-board-index-notes.md#n684-if-object-keys-p-some-k
    if (Object.keys(p).some((k) => (INTENT_CONFLICTS[k] ?? [k]).some((f) => body[f] !== undefined && body[f] !== null))) continue;
    // Rationale: docs/job-board-index-notes.md#n188-clash
    const clash = Object.keys(p).find((k) => k in patch && patch[k] !== p[k]);
    if (clash) continue;
    residual = residual.replace(re, " ");
    // Rationale: docs/job-board-index-notes.md#n685-const-restates-object-keys-p-every
    const restates = Object.keys(p).every((k) => k in patch && patch[k] === p[k]);
    Object.assign(patch, p);
    if (!restates) labels.push(label);
  }
  // "nurse jobs in Texas": a trailing place the board knows becomes the
  // location filter (query-place.ts), unless the caller already set one.
  const place = ["location", "country"].some((f) => sanitizeTerm(String(body[f] ?? ""))) ? null : liftTrailingPlace(residual, QUERY_FILLER);
  if (place) {
    residual = place.head;
    Object.assign(patch, place.patch);
    labels.push(place.label);
  }
  if (labels.length === 0) return null;
  residual = residual.replace(/\u0001(\d+)\u0001/g, (_m, i) => quoted[Number(i)] ?? "").replace(/\s+/g, " ").trim();
  return { patch, labels, residualQ: residual };
}

// Rationale: docs/job-board-index-notes.md#n1195-function-ftssafe-t-string-string
function ftsSafe(t: string): string {
  if (((t.match(/"/g) ?? []).length & 1) === 1) t = t.replace(/"/g, " ");
  // Rationale: docs/job-board-index-notes.md#n189-t-t-replace-s-s-g
  t = t.replace(/(^|\s)[-&/–—]+(\s|$)/g, " ");
  return t.replace(/[(),.'\\:]/g, " ").replace(/\s+/g, " ").trim();
}

// Rationale: docs/job-board-index-notes.md#n1196-function-ftsquery-raw-string-string
function ftsQuery(raw: string): string {
  const safe = ftsSafe(raw);
  // Length floor keeps it off short plurals where the split half is noise.
  // Quoted: unquoted, websearch read the variant as 'x' & 's' (n445).
  if (/^[a-z0-9]+s$/i.test(safe) && safe.length >= 5) {
    return `${safe} or "${safe.slice(0, -1)} s"`;
  }
  return safe;
}

// Rationale: docs/job-board-index-notes.md#n1197-function-titlestemmed-t-extends-textsear
// deno-lint-ignore no-explicit-any
function titleStemmed<T extends { textSearch: (...a: any[]) => T }>(qb: T, q: string): T {
  return qb.textSearch("title_tsv", q, { type: "websearch", config: "english" })
    .textSearch("title", q, { type: "websearch", config: "english" });
}

/** The SIMPLE route's split title match, one wfts filter each (search-routing.ts simpleRouteFilters; n481). */
// deno-lint-ignore no-explicit-any
function titleFilters<T extends { textSearch: (...a: any[]) => T; or: (f: string) => T }>(qb: T, filters: readonly TitleFilter[]): T {
  const quoted = (v: string) => `"${v.replace(/["\\]/g, "")}"`;
  return filters.reduce((b, f) => f.orCompanyTokens?.length
    // S12-014: the title words OR the employer's own boards, one indexed arm each.
    ? b.or(`${f.column}.wfts(${f.config}).${quoted(f.query)},company_token.in.(${f.orCompanyTokens.map(quoted).join(",")})`)
    : b.textSearch(f.column, f.query, { type: "websearch", config: f.config }), qb);
}

// Rationale: docs/job-board-index-notes.md#n1198-function-queryterms-raw-unknown-terms-st
function queryTerms(raw: unknown): { terms: string[]; dropped: string[]; liftedSalary: boolean } {
  const all = (String(raw ?? "").toLowerCase().match(/"[^"]*"|\S+/g) ?? [])
    .map((t) => t.length >= 2 && t.startsWith('"') && t.endsWith('"')
      ? t.slice(1, -1).split(/\s+/).map(sanitizeTerm).filter(Boolean).join(" ")
      : sanitizeTerm(t))
    // Rationale: docs/job-board-index-notes.md#n686-filter-x-a-z0-i-test
    .filter((x) => /[a-z0-9]/i.test(x));
  // Rationale: docs/job-board-index-notes.md#n687-const-money-salarytokeninquery-raw-token
  const money = salaryTokenInQuery(raw)?.token ?? null;
  // "or" between two real words is the searcher's OR, not filler: "welder or fabricator" (L8-07).
  const real = (t: string | undefined) => t !== undefined && !QUERY_FILLER.has(t) && t !== money;
  const isOr = (t: string, i: number) => t === "or" && real(all[i - 1]) && real(all[i + 1]);
  const kept = all.filter((t, i) => (!QUERY_FILLER.has(t) && t !== money) || isOr(t, i));
  if (kept.length === 0) {
    // Rationale: docs/job-board-index-notes.md#n190-money-null-return-terms-drop
    if (money !== null) return { terms: [], dropped: all.filter((t) => QUERY_FILLER.has(t)), liftedSalary: true };
    return { terms: all, dropped: [], liftedSalary: false };
  }
  return { terms: kept, dropped: all.filter((t, i) => QUERY_FILLER.has(t) && !isOr(t, i)), liftedSalary: money !== null };
}

// Rationale: docs/job-board-index-notes.md#n1199-const-place_qualifiers-readonlyset-strin
const PLACE_QUALIFIERS: ReadonlySet<string> = new Set([
  "united", "states", "state", "kingdom", "county", "remote", "republic", "city", "north", "south",
  "east", "west", "new", "greater", "central", "area", "region", "metro", "district", "province",
]);

/** Terms as OR groups: "welder or fabricator" is [[welder], [fabricator]] (L8-07). */
function orGroups(terms: readonly string[]): string[][] {
  const groups: string[][] = [[]];
  for (const t of terms) {
    if (t === "or") groups.push([]);
    else groups[groups.length - 1].push(t);
  }
  return groups.filter((g) => g.length > 0);
}

// Rationale: docs/job-board-index-notes.md#n1200-function-phrasetext-terms-readonly-strin
function phraseText(terms: readonly string[]): string {
  return terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" ");
}

// Rationale: docs/job-board-index-notes.md#n1201-function-within2edits-a-string-b-string
// Rationale: docs/job-board-index-notes.md#n191-bounded-levenshtein-true-when-edit-distance
/** Bounded Levenshtein: true when edit distance <= 2. Early-exits on length
 *  gap; the full matrix on two short words is ~100 cells, nothing more. */
function within2Edits(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > 2) return false;
    prev = cur;
  }
  return prev[n] <= 2;
}

const DID_YOU_MEAN: Record<string, string> = {
  // Rationale: docs/job-board-index-notes.md#n688-krankenschwester-pflegefachkraft
  "krankenschwester": "pflegefachkraft",
  // Rationale: docs/job-board-index-notes.md#n689-manger-manager
  "manger": "manager",
};

/** The words a search ignored: filler, plus the stopwords an english tsquery served it discarded (S11-004, n481). */
function droppedTermsOf(body: Record<string, unknown>, englishDropped: readonly string[] = []): string[] {
  return [...new Set([...queryTerms(body.q).dropped, ...englishDropped])];
}

// Rationale: docs/job-board-index-notes.md#n1202-function-englishdropdisclosure-body-reco
function englishDropDisclosure(body: Record<string, unknown>, englishDropped: readonly string[]): Record<string, unknown> {
  return englishDropped.length ? { droppedTerms: droppedTermsOf(body, englishDropped) } : {};
}

function searchDisclosures(
  body: Record<string, unknown>,
  applied: { salaryFloor?: number | null; postedAfter?: string | null; newSince?: string | null; excludeAgencies?: boolean; hasDescription?: boolean },
  maxAgeClamped = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Words removed because they cannot be part of a job title ("jobs", "near",
  // "me"). Reported rather than silently swallowed.
  const dropped = droppedTermsOf(body);
  if (dropped.length) out.droppedTerms = dropped;
  // Rationale: docs/job-board-index-notes.md#n690-const-fromquery-salaryfromquerytext-body
  const fromQuery = salaryFromQueryText(body.q);
  if (fromQuery !== null && applied.salaryFloor === fromQuery) out.salaryFromQuery = fromQuery;
  // Rationale: docs/job-board-index-notes.md#n691-const-l-locationterms-body-location
  const l = locationTerms(body.location);
  if (l.expandedFrom) { out.locationExpandedFrom = l.expandedFrom; out.locationSearched = l.terms; }
  // Rationale: docs/job-board-index-notes.md#n692-if-maxageclamped-out-maxageclampedto
  if (maxAgeClamped) out.maxAgeClampedTo = 30;
  // Rationale: docs/job-board-index-notes.md#n693-if-applied-postedafter-out-postedafterus
  if (applied.postedAfter) out.postedAfterUsesStatedDate = true;
  // The digest's window, echoed: send-search-digest refuses an answer without it.
  if (applied.newSince) out.newSince = applied.newSince;
  // Rationale: docs/job-board-index-notes.md#n694-if-applied-excludeagencies-out-agenciese
  if (applied.excludeAgencies) out.agenciesExcluded = true;
  // NO describedOnly DISCLOSURE FLAG. A filtered page must say so — but the
  // only caller that sets hasDescription is the client's own résumé browse, so
  // it already knows, and a server flag telling it what it just asked for
  // would be an emitter with no reader (the defect
  // a-disclosure-nobody-renders-is-not-a-disclosure.test.ts exists to catch).
  // If this filter ever gains a caller that is NOT the thing rendering the
  // copy, it needs a real disclosure here and a reader for it.
  // A typo that exactly matches other people's typos defeats every rescue
  // tier — the exact hits are real rows, just not what the searcher meant.
  const dym = DID_YOU_MEAN[String(body.q ?? "").trim().toLowerCase()];
  if (dym) out.didYouMean = dym;
  return out;
}

// Rationale: docs/job-board-index-notes.md#n1203-function-intentdisclosure-r-labels-strin
function intentDisclosure(r: { labels: string[] } | null): Record<string, unknown> {
  return r && r.labels.length ? { intentFilters: r.labels } : {};
}

// Rationale: docs/job-board-index-notes.md#n1204-function-exclusiondisclosure-excluded-re
function exclusionDisclosure(excluded: readonly string[]): Record<string, unknown> {
  return excluded.length ? { excludedTerms: [...excluded] } : {};
}

// Rationale: docs/job-board-index-notes.md#n1205-function-exclusioncountscaveat-excluded
function exclusionCountsCaveat(excluded: readonly string[]): Record<string, unknown> {
  return excluded.length
    ? { total: null, countUnavailable: true, totalAtLeast: undefined, relatedTotal: undefined }
    : {};
}

// Rationale: docs/job-board-index-notes.md#n1206-function-exclusionceiling-excluded-reado
function exclusionCeiling(excluded: readonly string[], ceiling: number | null): Record<string, unknown> {
  return excluded.length && typeof ceiling === "number" && Number.isFinite(ceiling) && ceiling >= 0
    ? { totalBeforeExclusions: ceiling }
    : {};
}

// Rationale: docs/job-board-index-notes.md#n1207-const-measured_coverage
const MEASURED_COVERAGE = {
  payBasis: 0.106,
  // The verbatim pay field, 2026-09-27 — NOT the 0.201 annualised reading above.
  hasStatedPay: 0.283,
  maxYears: 0.289,
  department: 0.405,
  vendor: 1,
} as const;

// Rationale: docs/job-board-index-notes.md#n1208-function-coveragedisclosure
function coverageDisclosure(
  applied: {
    salaryFloor?: number | null;
    workMode?: string | null;
    experience?: string[];
    country?: string | null;
    salaryCeiling?: number | null;
    payBasis?: string | null;
    hasStatedPay?: boolean;
    maxYears?: number | null;
    department?: string | null;
    vendors?: string[];
    employmentType?: string | null;
    remote?: boolean;
  },
  meta?: { v: Record<string, unknown> } | null,
): Record<string, unknown> {
  const cov = (meta?.v as Record<string, unknown> | undefined)?.coverage as
    | {
      salaryFloor?: number | null;
      workMode?: number | null;
      experience?: number | null;
      country?: number | null;
      payBasis?: number | null;
      hasStatedPay?: number | null;
      // Rationale: docs/job-board-index-notes.md#n192-salarytext-number-null
      salaryText?: number | null;
      maxYears?: number | null;
      department?: number | null;
      employmentType?: number | null;
    }
    | undefined;
  // Rationale: docs/job-board-index-notes.md#n193-cov-return
  if (!cov) return {};
  // Rationale: docs/job-board-index-notes.md#n194-covat
  const covAt = (cov as { at?: unknown }).at;
  if (typeof covAt !== "string" || !covAt) return {};
  const out: Record<string, number> = {};
  // Rationale: docs/job-board-index-notes.md#n195-pinnedused
  let pinnedUsed = false;
  const liveOr = (live: unknown, pinned: number) => {
    if (typeof live === "number") return live;
    pinnedUsed = true;
    return pinned;
  };
  if (applied.payBasis) out.payBasis = liveOr(cov.payBasis, MEASURED_COVERAGE.payBasis);
  // Rationale: docs/job-board-index-notes.md#n196-applied-hasstatedpay-out-hasstatedpay
  if (applied.hasStatedPay) out.hasStatedPay = liveOr(cov.salaryText, MEASURED_COVERAGE.hasStatedPay);
  if (applied.maxYears != null) out.maxYears = liveOr(cov.maxYears, MEASURED_COVERAGE.maxYears);
  if (applied.department) out.department = liveOr(cov.department, MEASURED_COVERAGE.department);
  if (applied.vendors?.length) out.vendor = MEASURED_COVERAGE.vendor;
  // New with the filter itself — live-only, no pinned constant: a snapshot
  // for a filter that has never shipped would be an invented number.
  if (applied.employmentType && typeof cov.employmentType === "number") out.employmentType = cov.employmentType;
  if (applied.salaryFloor != null && typeof cov.salaryFloor === "number") out.salaryFloor = cov.salaryFloor;
  // Rationale: docs/job-board-index-notes.md#n695-if-applied-salaryceiling-null-typeof-cov
  if (applied.salaryCeiling != null && typeof cov.salaryFloor === "number") out.salaryCeiling = cov.salaryFloor;
  // Rationale: docs/job-board-index-notes.md#n696-if-applied-workmode-null-applied-remote
  if ((applied.workMode != null || applied.remote === true) && typeof cov.workMode === "number") out.workMode = cov.workMode;
  if (applied.experience?.length && typeof cov.experience === "number") out.experience = cov.experience;
  // Rationale: docs/job-board-index-notes.md#n197-applied-country-typeof-cov-country
  if (applied.country && typeof cov.country === "number") out.country = cov.country;
  // Rationale: docs/job-board-index-notes.md#n697-if-object-keys-out-length-return
  if (!Object.keys(out).length) return {};
  return pinnedUsed ? { filterCoverage: out } : { filterCoverage: out, filterCoverageAt: covAt };
}


async function handleRequest(req: Request): Promise<Response> {
  // The preflight names the deployed bundle, so a deploy is provable without a read or a write.
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...corsHeaders, "x-fn-build": `job-board.${BUILD_VERSION}` } });
  // Rationale: docs/job-board-index-notes.md#n198-req-method-get
  if (req.method === "GET") {
    const u = new URL(req.url);
    // THE SITEMAP THIS SERVED IS GONE, AND 410 IS HOW A CRAWLER LEARNS THAT.
    //
    // On 2026-09-23 the second sitemap line was taken out of robots.txt because
    // the index behind it asked crawlers to index 767,391 board URLs that every
    // one of them served the same bytes for. Only the ADVERTISEMENT was removed.
    // This endpoint kept serving, and a crawler does not need robots.txt to
    // reach a URL it already has.
    //
    // Measured 2026-10-01, a week after that change: the index still answered
    // with its 30 pages, page 0 still listed 24,449 URLs in 3.3 MB, uncached at
    // the edge, 7.4 s a page, and 200 to Bytespider, Baiduspider, PetalBot and
    // curl alike. A full walk is ~733,000 URLs at ~81 KB each: about 59 GB of
    // uncached egress, per crawler, as often as each one cares to repeat it.
    // That is what the owner saw as a flood of foreign traffic, and none of it
    // was anybody attacking us — we were handing it out.
    //
    // The guard written at the time pins robots.txt, reasoning that the lever
    // behind the 767,391 was one line in a text file and not code. The lever
    // was the road, not the sign. the-sitemap-never-advertises-a-posting-url-
    // with-no-page.test.ts now holds both.
    //
    // 410 and not 404, deliberately: a 404 says "not here, maybe later" and
    // crawlers retry it for months, while 410 is the terminal one that drops
    // the URL from the queue. Nothing in this repo calls this action — no code,
    // no robots line, no test asserting it exists — so there is no caller to
    // break. Cached for a week so the refusal does not become its own traffic.
    if (u.searchParams.get("action") === "sitemap") {
      return new Response(
        "Gone. Individual openings have their own pages; the sitemap that lists "
          + "them is https://resumebooster.work/sitemap.xml",
        {
          status: 410,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=604800",
          },
        },
      );
    }
    return json({ error: "POST only" }, 405);
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    // Rationale: docs/job-board-index-notes.md#n698-body-await-boundbody-req-max_request_byt
    body = await boundBody(req, MAX_REQUEST_BYTES).json();
  } catch (e) {
    // Rationale: docs/job-board-index-notes.md#n699-if-string-e-as-error-message
    if (String((e as Error)?.message ?? e).includes(OVERSIZE_MARKER)) {
      return json({ error: `Request body too large (limit ${MAX_REQUEST_BYTES} bytes)` }, 413);
    }
    return json({ error: "Invalid JSON" }, 400);
  }
  // S12-123: JSON that is not an object (null, a number, a list) is a malformed
  // request, not a server fault: it reached body.action and answered 500.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "The request body must be a JSON object" }, 400);
  }
  const action = String(body.action ?? "list");
  const client = db();

  // Rationale: docs/job-board-index-notes.md#n700-if-budgeted_actions-has-action
  if (BUDGETED_ACTIONS.has(action)) {
    const refused = await anonBudgetGate(req, action, {
      rpc: (args, signal) => client.rpc("job_board_anon_check", args).abortSignal(signal),
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      cors: corsHeaders,
      passSecret: Deno.env.get("TURNSTILE_SECRET_KEY") ?? "",
    });
    if (refused) return refused;
  }
  if (action === "budget-echo") {
    // Uncounted, zero database: what the gate sees of this caller's own request.
    return json(await budgetEcho(req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", Deno.env.get("TURNSTILE_SECRET_KEY") ?? ""));
  }
  if (action === "board-pass") {
    // Uncounted, zero database: a Turnstile token in, a half-hour pass out (board-pass.ts).
    const r = await boardPassAction(body, {
      secret: Deno.env.get("TURNSTILE_SECRET_KEY") ?? "",
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      remoteip: callerAddress(req.headers).address,
    });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  try {
    if (action === "searchQuality") {
      // Rationale: docs/job-board-index-notes.md#n701-if-await-ismaintenance-req-body-return
      if (!(await isMaintenance(req, body))) return json({ error: "searchQuality is a maintenance action" }, 403);
      // Rationale: docs/job-board-index-notes.md#n199-days
      const days = Math.min(Math.max(Number(body.days) || 7, 1), 90);
      const { data, error } = await client.rpc("get_search_quality", { p_days: days });
      if (error) return json({ error: error.message, code: error.code ?? null }, 500);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      return json({
        days,
        // An empty array here means "nothing recorded", and it is reported as
        // exactly that rather than as a zeroed summary that reads like health.
        recording: rows.length > 0,
        byDay: rows,
      });
    }

    if (action === "host_sweep") {
      // Rationale: docs/job-board-index-notes.md#n200-slice
      const SLICE = 200;
      const state = await client.from("job_board_meta").select("v, updated_at").eq("k", "host_sweep").maybeSingle();
      // The stampede lock: no sweep inside 5 minutes of the row's last write,
      // for anyone. The cron fires hourly (:07) and posts no credential, so
      // anyone can send this action, and that guard alone let a loop run a
      // sweep of 200 outbound probes every 5 minutes, twelve times the cron.
      // .88 also holds a caller without a maintenance credential to one sweep
      // per HOST_SWEEP_ANON_GAP_MS counted from the last ARRIVAL, never from
      // completion: arrival to arrival is the cron's own hour, while a slow
      // sweep's completion stamp lands minutes later and would make the next
      // tick look early.
      const lockAge = state.data?.updated_at ? Date.now() - new Date(state.data.updated_at).getTime() : Infinity;
      if (lockAge < 5 * 60_000) return json({ skipped: "a sweep ran moments ago" });
      const arrivedMs = Date.parse(String((state.data?.v as { lastArrivedAt?: unknown } | null)?.lastArrivedAt ?? ""));
      const sinceArrival = Number.isFinite(arrivedMs) ? Date.now() - arrivedMs : lockAge;
      if (sinceArrival < HOST_SWEEP_ANON_GAP_MS && !(await isMaintenance(req, body))) return json({ skipped: "a sweep ran moments ago" });
      // Stamp ARRIVAL before probing, not only completion. Overnight
      // 2026-08-23→24 the cursor advanced once in ten-plus cron ticks and
      // there was no way to tell arrivals-that-died from ticks-that-never-
      // fired. The arrival stamp also moves the stampede lock to entry time,
      // where a lock belongs. CONDITIONAL since .88, on the stamp just read
      // (or on the row not existing yet): callers arriving together all read
      // an expired lock, and exactly one of them may sweep.
      const svArrive = { ...(state.data?.v as Record<string, unknown> ?? {}), lastArrivedAt: new Date().toISOString() };
      const arriveAt = new Date().toISOString();
      if (state.data?.updated_at) {
        const { data: took, error: takeErr } = await client.from("job_board_meta").update({ v: svArrive, updated_at: arriveAt })
          .eq("k", "host_sweep").eq("updated_at", state.data.updated_at).select("k");
        if (!takeErr && !(Array.isArray(took) && took.length === 1)) return json({ skipped: "another caller took this sweep" });
      } else {
        const { error: insErr } = await client.from("job_board_meta").insert({ k: "host_sweep", v: svArrive, updated_at: arriveAt });
        if (insErr?.code === "23505") return json({ skipped: "another caller took this sweep" });
      }
      const sv = (state.data?.v ?? {}) as { cursor?: number; hosts?: Record<string, { fails: number; postings: number; lastAt: string; lastErr?: string }>; cycleAt?: string; list?: Array<{ host: string; postings: number }> };
      let list = Array.isArray(sv.list) ? sv.list : [];
      let cursor = Number(sv.cursor) || 0;
      const hosts = sv.hosts ?? {};
      if (cursor === 0 || list.length === 0) {
        // Rationale: docs/job-board-index-notes.md#n201-seen
        const seen = new Map<string, { host: string; postings: number }>();
        for (let from = 0; from < 20_000; from += 1_000) {
          const { data: page, error: cErr } = await client.rpc("get_apply_hosts").range(from, from + 999);
          if (cErr || !Array.isArray(page)) {
            if (from === 0) return json({ error: "host census unavailable" }, 503);
            console.log(`[JOB-BOARD] host census truncated at ${seen.size} hosts: ${cErr?.message ?? "non-array page"}`);
            break;
          }
          for (const h of page as Array<{ host: string; postings: number }>) {
            if (h.host && h.host.includes(".")) seen.set(h.host, h);
          }
          if (page.length < 1_000) break;
        }
        const census = [...seen.values()];
        list = census;
        cursor = 0;
      }
      const slice = list.slice(cursor, cursor + SLICE);
      const CONC = 8;
      for (let i = 0; i < slice.length; i += CONC) {
        await Promise.all(slice.slice(i, i + CONC).map(async ({ host, postings }) => {
          const prev = hosts[host] ?? { fails: 0, postings, lastAt: "" };
          prev.postings = postings;
          prev.lastAt = new Date().toISOString();
          try {
            // Rationale: docs/job-board-index-notes.md#n702-const-ctrl-new-abortcontroller
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 6_000);
            try {
              await fetch(`https://${host}/`, { method: "HEAD", signal: ctrl.signal, redirect: "manual" });
            } finally {
              clearTimeout(t);
            }
            prev.fails = 0;
            delete prev.lastErr;
          } catch (e) {
            prev.fails = (Number(prev.fails) || 0) + 1;
            prev.lastErr = String((e as Error)?.message ?? e).slice(0, 120);
          }
          hosts[host] = prev;
        }));
      }
      cursor += slice.length;
      const wrapped = cursor >= list.length;
      if (wrapped) {
        // Rationale: docs/job-board-index-notes.md#n703-const-incensus-new-set-list-map
        const inCensus = new Set(list.map((l) => l.host));
        for (const h of Object.keys(hosts)) if (!inCensus.has(h)) delete hosts[h]; // census churn, not death
        const failing = Object.entries(hosts).filter(([, v]) => v.fails >= 2);
        const postingsOnFailing = failing.reduce((n, [, v]) => n + (v.postings || 0), 0);
        // Rationale: docs/job-board-index-notes.md#n704-await-client-from-job_board_stats_rollup
        await client.from("job_board_stats_rollup").upsert({
          k: "reachability",
          v: {
            hosts_checked: list.length,
            hosts_failing: failing.length,
            postings_on_failing: postingsOnFailing,
            at: new Date().toISOString(),
          },
          computed_at: new Date().toISOString(),
        }, { onConflict: "k" });
        const worst = failing.sort((a, b) => (b[1].postings || 0) - (a[1].postings || 0)).slice(0, 5)
          .map(([h, v]) => `${h} (${v.postings} postings, ${v.lastErr ?? "?"})`).join("; ");
        console.log(`[JOB-BOARD] host sweep cycle complete: ${list.length} hosts, ${failing.length} failing (${postingsOnFailing} postings)${worst ? " — worst: " + worst : ""}`);
      }
      // Rationale: docs/job-board-index-notes.md#n705-const-error-persisterr-await-client-from
      const { error: persistErr } = await client.from("job_board_meta").upsert(
        { k: "host_sweep", v: { cursor: wrapped ? 0 : cursor, hosts, list: wrapped ? [] : list, cycleAt: wrapped ? new Date().toISOString() : sv.cycleAt ?? null, lastArrivedAt: svArrive.lastArrivedAt, lastTick: { at: new Date().toISOString(), swept: slice.length, wrapped } }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      if (persistErr) console.log(`[JOB-BOARD] host sweep persist FAILED: ${persistErr.message}`);
      return json({ swept: slice.length, cursor: wrapped ? 0 : cursor, of: list.length, wrapped, persisted: !persistErr });
    }

    if (action === "status") {
      // .88: a caller without a credential gets this isolate's last answer
      // while it is under STATUS_MEMO_MS old; ours and maintenance read fresh.
      const statusFresh = (await exemptKind(req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")) !== null || await isMaintenance(req, body);
      if (!statusFresh && statusMemo && Date.now() - statusMemo.at < STATUS_MEMO_MS) {
        return new Response(statusMemo.text, { headers: { ...corsHeaders, "Content-Type": "application/json", "x-status-age-ms": String(Date.now() - statusMemo.at) } });
      }
      // Rationale: docs/job-board-index-notes.md#n202-try
      try {
      // Rationale: docs/job-board-index-notes.md#n706-const-anonbudgetread-promise-resolve
      const anonBudgetRead = Promise.resolve(
        client.from("job_board_meta").select("v").eq("k", "anon_board_budget").maybeSingle(),
      ).catch(() => null);
      // .88: the demand lane's use, as counts (abuse-guards.ts demandLaneStatus).
      const demandRead = readDemand(client).catch(() => ({ queue: null, served: null }));
      // Rationale: docs/job-board-index-notes.md#n707-const-passendread-promise-resolve
      const passEndRead = Promise.resolve(
        client.from("job_board_meta").select("v").eq("k", "pass_end").maybeSingle(),
      ).catch(() => null);
      const [prog, pbMeta, rot, refreshMeta, bf, hotMeta, fresh, breaker, dateCov, boardFlow, ingestPaused, dcCache, bsMeta, dsMeta, ssMeta, esMeta, fiOk, fiBad, faMeta, aaMeta, arMeta, rsRun, rsCron, hsMeta, rcProg, rcVer, hwMeta, deepCur, chainKick, sliceStatsRow, descCov, traceRow, overMeta, closurePop, oracleRepair, staleMeta, freshRow] = await Promise.all([
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "posted_backfill").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "cold_rotation").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n708-client-from-job_board_meta-select-total
        client.from("job_board_meta").select("total:v->total, updated_at").eq("k", "refresh").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "hot_tokens").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n203-withdeadline-client-rpc-get-freshness-stats
        withDeadline(client.rpc("get_freshness_stats"), 2_500),
        client.from("job_board_meta").select("v").eq("k", "vendor_breaker").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n204-withdeadline-client-rpc-get-date-coverage-2
        withDeadline(client.rpc("get_date_coverage"), 2_500),
        // Rationale: docs/job-board-index-notes.md#n205-client-from-job-board-meta-select-v-updated
        client.from("job_board_meta").select("v, updated_at").eq("k", "board_flow_cache").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n709-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "ingest_paused").maybeSingle(),
        // Last good coverage, so a timeout serves stale numbers with their age
        // attached instead of nothing at all.
        client.from("job_board_meta").select("v, updated_at").eq("k", "date_coverage_cache").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "bootstrap").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "desc_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "structured_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "embed_sweep").maybeSingle(),
              // Rationale: docs/job-board-index-notes.md#n710-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "filter_integrity_ok").maybeSingle(),
        client.from("job_board_meta").select("k, v, updated_at").like("k", "filter_integrity_incident.%").limit(40),
        client.from("job_board_meta").select("v, updated_at").eq("k", "filter_audit").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n711-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "apply_agent_run").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n712-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "agent_runner_run").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n713-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "reconcile_stripe_run").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "reconcile_stripe_cron").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n714-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "host_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "recategorize_progress").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "category_rules_version").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n206-client-from-job-board-meta-select-v-eq-k
        client.from("job_board_meta").select("v").eq("k", "catalog_highwater").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n715-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "deep_cursor").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n716-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "chain_kick").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "slice_stats").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n207-client-from-job-board-stats-rollup-select-v
        client.from("job_board_stats_rollup").select("v, computed_at").eq("k", "desc_coverage").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "slice_trace").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n717-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "oversize_boards").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n208-client-rpc-get-closure-population-maybesingle
        client.rpc("get_closure_population").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n718-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "oracle_subsite_repair").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n719-client-from-job_board_meta-select-v-upda
        client.from("job_board_meta").select("v, updated_at").eq("k", "stale_lane").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n720-client-from-job_board_stats_rollup-selec
        client.from("job_board_stats_rollup").select("v, computed_at").eq("k", "freshness").maybeSingle(),
      ]);
      // Rationale: docs/job-board-index-notes.md#n721-const-anonbudgetrow-await-anonbudgetread
      const anonBudgetRow = await anonBudgetRead;
      const demandRow = await demandRead;
      const passEndRow = await passEndRead;
      const pgV = (prog.data?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[]; failedTotal?: number };
      const rotV = (rot.data?.v ?? {}) as { completedAt?: string; coldBoards?: number };
      const rfV = { total: (refreshMeta.data as { total?: unknown } | null)?.total as number | undefined };
      const dormant = ((bf.data?.v ?? {}) as { dormant?: Record<string, number> }).dormant ?? {};
      const hotTokens = ((hotMeta.data?.v ?? {}) as { tokens?: unknown[] }).tokens;
      const now = Date.now();
      const ageMin = (ts?: string | null) => (ts ? Math.round((now - new Date(ts).getTime()) / 60000) : null);

      // Rationale: docs/job-board-index-notes.md#n209-array-isarray-datecov-as-data-unkno
      if (Array.isArray((dateCov as { data?: unknown }).data)) {
        void client.from("job_board_meta").upsert({
          k: "date_coverage_cache",
          v: (dateCov as { data: unknown[] }).data,
          updated_at: new Date().toISOString(),
        }, { onConflict: "k" }).then(() => {}, () => {});
      }
      // Rationale: docs/job-board-index-notes.md#n722-const-pbbacklognow-await-undatedbacklog
      const pbBacklogNow = await undatedBacklog(client);
      // Rationale: docs/job-board-index-notes.md#n210-chainwatchdog
      const chainWatchdog = await maybeRekickDeadChain(client);
      // Serialised once, here, so the memo holds the exact bytes this caller gets.
      const statusText = JSON.stringify({
        statusDegraded: false,
        // deployed build identity (constants baked into THIS bundle)
        version: BUILD_VERSION,
        // The anonymous budget's setting row and the code's default caps.
        anonBudget: anonBudgetStatus((anonBudgetRow as { data?: { v?: unknown } | null } | null)?.data?.v ?? null, { passConfigured: !!Deno.env.get("TURNSTILE_SECRET_KEY") }),
        demandLane: demandLaneStatus(demandRow.queue, demandRow.served, now),
        // Rationale: docs/job-board-index-notes.md#n211-questionvendors-realquestionvendors
        questionVendors: realQuestionVendors(),
        // Rationale: docs/job-board-index-notes.md#n212-applyagent-aameta-data-v
        applyAgent: aaMeta.data?.v
          ? (() => {
              const v = aaMeta.data.v as Record<string, unknown>;
              const cronAt = typeof v.lastCronAt === "string" ? v.lastCronAt : null;
              return {
                lastRunAt: v.at ?? null,
                lastRunTrigger: v.trigger ?? null,
                lastCronAt: cronAt,
                cronAgeMin: ageMin(cronAt),
                buildVersion: v.buildVersion ?? null,
                senderOnline: v.senderOnline ?? null,
                resumesBucket: v.resumesBucket ?? null,
                // Rationale: docs/job-board-index-notes.md#n723-wakeconfig-v-wakeconfig-null
                wakeConfig: v.wakeConfig ?? null,
                mandates: v.mandates ?? null,
                prepared: v.prepared ?? null,
                released: v.released ?? null,
                // Rationale: docs/job-board-index-notes.md#n724-scheduleproven-cronat-null-agemin-cronat
                scheduleProven: cronAt !== null && (ageMin(cronAt) ?? 1e9) < 120,
              };
            })()
          : null,
        // Rationale: docs/job-board-index-notes.md#n213-agentrunner-armeta-data-v
        agentRunner: arMeta.data?.v
          ? (() => {
              const v = arMeta.data.v as {
                at?: string; trigger?: string; lastCronAt?: string | null;
                buildVersion?: string; mandates?: number; prepared?: number; released?: number;
              };
              const cronAt = v.lastCronAt ?? null;
              return {
                lastRunAt: v.at ?? null,
                lastRunTrigger: v.trigger ?? null,
                lastCronAt: cronAt,
                cronAgeMin: ageMin(cronAt),
                buildVersion: v.buildVersion ?? null,
                mandates: v.mandates ?? null,
                // `prepared` is searches run, `released` is picks queued — the
                // runner's two counts, under the stamp's shared field names.
                searches: v.prepared ?? null,
                picked: v.released ?? null,
                // Nightly, so a full day of slack before this cries wolf.
                scheduleProven: cronAt !== null && (ageMin(cronAt) ?? 1e9) < 1500,
              };
            })()
          : null,
        // Rationale: docs/job-board-index-notes.md#n214-paymentreconcile
        paymentReconcile: (() => {
          const run = (rsRun.data?.v ?? {}) as {
            at?: string; buildVersion?: string; checkedPaid?: number;
            orphans?: number; alerted?: boolean | null; lookbackHours?: number;
          };
          const cron = (rsCron.data?.v ?? {}) as { lastCronAt?: string };
          const cronAt = typeof cron.lastCronAt === "string" ? cron.lastCronAt : null;
          return {
            lastRunAt: run.at ?? null,
            buildVersion: run.buildVersion ?? null,
            // Rationale: docs/job-board-index-notes.md#n215-lastcronat-cronat
            lastCronAt: cronAt,
            cronAgeMin: ageMin(cronAt),
            checkedPaid: run.checkedPaid ?? null,
            // The number that matters: paid sessions with no delivery marker.
            orphans: run.orphans ?? null,
            // Rationale: docs/job-board-index-notes.md#n725-alerted-run-alerted-null
            alerted: run.alerted ?? null,
            // Rationale: docs/job-board-index-notes.md#n726-scheduleproven-cronat-null-agemin-cronat
            scheduleProven: cronAt !== null && (ageMin(cronAt) ?? 1e9) < 1500,
          };
        })(),
        // Rationale: docs/job-board-index-notes.md#n216-sendable
        sendable: (() => {
          const cov = Array.isArray((dateCov as { data?: unknown }).data)
            ? (dateCov as { data: Array<{ source: string; total: number }> }).data
            : ((dcCache.data?.v as Array<{ source: string; total: number }> | undefined) ?? null);
          if (!cov) return null;
          const set = new Set(SENDABLE_VENDORS);
          let send = 0, all = 0;
          for (const r of cov) { all += Number(r.total); if (set.has(r.source)) send += Number(r.total); }
          return {
            vendors: SENDABLE_VENDORS.length,
            postings: send,
            ofTotal: all,
            pct: all ? Math.round(1000 * send / all) / 10 : null,
          };
        })(),
        catalogSize: JOB_SOURCES.length,
        catalogHighwater: Number((hwMeta.data?.v as { size?: number } | null)?.size) || null,
        // true = every refresh pass is skipping the orphan prune, so a board
        // removed from the catalog keeps serving its postings.
        orphanPruneBlocked: JOB_SOURCES.length < (Number((hwMeta.data?.v as { size?: number } | null)?.size) || 0),
        categorizeVersion: CATEGORIZE_VERSION,
        hotTier: Array.isArray(hotTokens) && hotTokens.length >= 50 ? hotTokens.length : HOT_SIZE,
        // Rationale: docs/job-board-index-notes.md#n727-descsweep
        descSweep: {
          vendor: ((dsMeta.data?.v ?? {}) as { vendor?: string }).vendor ?? null,
          doneAt: ((dsMeta.data?.v ?? {}) as { doneAt?: string }).doneAt ?? null,
          ageMin: dsMeta.data?.updated_at ? Math.round((Date.now() - new Date(dsMeta.data.updated_at).getTime()) / 60000) : null,
        },
        // Rationale: docs/job-board-index-notes.md#n217-slicestats-slicestatsrow-data-v-null
        sliceStats: (sliceStatsRow?.data?.v ?? null),
        deepCursor: (() => {
          const v = (deepCur.data?.v ?? {}) as Record<string, number>;
          const entries = Object.entries(v).filter(([, n]) => typeof n === "number" && n > 0);
          entries.sort((a, b) => b[1] - a[1]);
          return {
            boards: entries.length,
            maxOffset: entries.length ? entries[0][1] : 0,
            sumOffset: entries.reduce((t, [, n]) => t + n, 0),
            updatedAt: deepCur.data?.updated_at ?? null,
            // The deepest few, so a stuck cursor is visible as an offset that
            // does not move between two reads of this field.
            top: entries.slice(0, 8).map(([token, offset]) => ({ token, offset })),
            // Rationale: docs/job-board-index-notes.md#n728-lane
            lane: (() => {
              const l = (deepCur.data?.v as Record<string, unknown> | null | undefined)?.__lane;
              return l && typeof l === "object" && !Array.isArray(l) ? l as Record<string, unknown> : null;
            })(),
            // Rationale: docs/job-board-index-notes.md#n218-laps
            laps: (() => {
              const raw = (deepCur.data?.v as Record<string, unknown> | null | undefined)?.__laps;
              if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { tracking: 0, proven: 0, disarmed: 0, lastProvenAt: null as string | null, firstLapAt: null as string | null };
              const recs = Object.values(raw as Record<string, { f?: number; w?: string; w0?: string }>);
              let proven = 0, disarmed = 0, last: string | null = null, first: string | null = null;
              for (const rec of recs) {
                if (!rec || typeof rec !== "object") continue;
                if (rec.f === 1) disarmed++;
                if (typeof rec.w === "string") { proven++; if (!last || rec.w > last) last = rec.w; }
                // Rationale: docs/job-board-index-notes.md#n729-if-typeof-rec-w0-string-first
                if (typeof rec.w0 === "string" && (!first || rec.w0 < first)) first = rec.w0;
              }
              return { tracking: recs.length, proven, disarmed, lastProvenAt: last, firstLapAt: first };
            })(),
          };
        })(),
        // Rationale: docs/job-board-index-notes.md#n730-closurepopulation-closurepop-error-null
        closurePopulation: (closurePop.error ? null : (closurePop.data ?? null)),
        // Rationale: docs/job-board-index-notes.md#n731-oraclesubsiterepair-oraclerepair-error
        oracleSubsiteRepair: oracleRepair.error
          ? null
          : (oracleRepair.data ? { ...(oracleRepair.data.v as Record<string, unknown>), updatedAt: oracleRepair.data.updated_at } : null),
        oracleRankedSites: ORACLE_SITE_RANK.size,
        hostSweep: {
          cursor: ((hsMeta.data?.v ?? {}) as { cursor?: number }).cursor ?? null,
          of: Array.isArray(((hsMeta.data?.v ?? {}) as { list?: unknown[] }).list) ? (((hsMeta.data?.v ?? {}) as { list?: unknown[] }).list as unknown[]).length : null,
          cycleAt: ((hsMeta.data?.v ?? {}) as { cycleAt?: string }).cycleAt ?? null,
          lastArrivedAt: ((hsMeta.data?.v ?? {}) as { lastArrivedAt?: string }).lastArrivedAt ?? null,
          lastTick: ((hsMeta.data?.v ?? {}) as { lastTick?: unknown }).lastTick ?? null,
          ageMin: hsMeta.data?.updated_at ? Math.round((Date.now() - new Date(hsMeta.data.updated_at).getTime()) / 60_000) : null,
        },
        recategorize: {
          rulesVersion: CATEGORIZE_VERSION,
          cursor: ((rcProg.data?.v ?? {}) as { cursor?: string }).cursor ?? null,
          startedUnder: ((rcProg.data?.v ?? {}) as { startedUnder?: number }).startedUnder ?? null,
          progressAgeMin: rcProg.data?.updated_at ? Math.round((Date.now() - new Date(rcProg.data.updated_at).getTime()) / 60_000) : null,
          stampedVersion: ((rcVer.data?.v ?? {}) as { version?: number }).version ?? null,
          stampedStartedUnder: ((rcVer.data?.v ?? {}) as { startedUnder?: number }).startedUnder ?? null,
          sweptAt: ((rcVer.data?.v ?? {}) as { sweptAt?: string }).sweptAt ?? null,
        },
        structuredSweep: {
          vendor: ((ssMeta.data?.v ?? {}) as { vendor?: string }).vendor ?? null,
          cursor: ((ssMeta.data?.v ?? {}) as { cursor?: string }).cursor ?? null,
          scanned: ((ssMeta.data?.v ?? {}) as { scanned?: number }).scanned ?? null,
          filled: ((ssMeta.data?.v ?? {}) as { filled?: number }).filled ?? null,
          doneAt: ((ssMeta.data?.v ?? {}) as { doneAt?: string }).doneAt ?? null,
          // The final page's id window — the forensic detail the 17:50 pass
          // lacked. Readable from outside without SQL access.
          firstId: ((ssMeta.data?.v ?? {}) as { firstId?: string }).firstId ?? null,
          lastId: ((ssMeta.data?.v ?? {}) as { lastId?: string }).lastId ?? null,
          pageLen: ((ssMeta.data?.v ?? {}) as { pageLen?: number }).pageLen ?? null,
          ageMin: ssMeta.data?.updated_at ? Math.round((Date.now() - new Date(ssMeta.data.updated_at).getTime()) / 60000) : null,
        },
        // Rationale: docs/job-board-index-notes.md#n732-embedsweep
        embedSweep: {
          doneAt: ((esMeta.data?.v ?? {}) as { doneAt?: string }).doneAt ?? null,
          note: ((esMeta.data?.v ?? {}) as { note?: string }).note ?? null,
          ageMin: esMeta.data?.updated_at ? Math.round((Date.now() - new Date(esMeta.data.updated_at).getTime()) / 60000) : null,
        },
        // Rationale: docs/job-board-index-notes.md#n219-filtercontract
        filterContract: (() => {
          const okAt = fiOk.data?.updated_at ? new Date(fiOk.data.updated_at).getTime() : null;
          // .88: per-field rows; the last incident is the newest stamp across them.
          const bad = summariseIncidents(Array.isArray(fiBad.data) ? fiBad.data : null, Date.now());
          return {
            // Rationale: docs/job-board-index-notes.md#n733-okagemin-okat-null-null-math-round
            okAgeMin: okAt === null ? null : Math.round((Date.now() - okAt) / 60000),
            ...bad,
            // An incident row is a tombstone, not a live state — it persists
            // after the fault is fixed. Age is what tells you which.
            note: okAt === null
              ? "self-check has never recorded a clean page — treat as unverified, not as healthy"
              : null,
          };
        })(),
        filterAudit: (() => {
          const v = (faMeta.data?.v ?? {}) as { at?: string; clean?: boolean; incomplete?: boolean; cases?: number; findings?: unknown[]; p95Ms?: number | null; slowCases?: number; throttledCases?: number };
          return {
            at: v.at ?? null,
            ageMin: faMeta.data?.updated_at ? Math.round((Date.now() - new Date(faMeta.data.updated_at).getTime()) / 60000) : null,
            clean: v.clean ?? null,
            // Every finding a refusal: not measured, rather than measured broken (L1-07; absent before .91).
            incomplete: v.incomplete ?? null,
            cases: v.cases ?? null,
            findings: Array.isArray(v.findings) ? v.findings.slice(0, 12) : null,
            findingCount: Array.isArray(v.findings) ? v.findings.length : null,
            // "could not measure" vs "measured broken", visible where red is
            // actually read — the stored payload had this and status hid it.
            throttledCases: v.throttledCases ?? null,
            p95Ms: v.p95Ms ?? null,
            slowCases: v.slowCases ?? null,
          };
        })(),
        postedBackfill: (() => {
          const v = (pbMeta.data?.v ?? {}) as { version?: number; sweptAt?: string; phase?: string; cursor?: string; datedTotal?: number; scannedTotal?: number; note?: string; backlogAtSweep?: number };
          return {
            version: v.version ?? null,
            sweptAt: v.sweptAt ?? null,
            phase: v.phase ?? null,
            cursor: typeof v.cursor === "string" ? v.cursor.slice(0, 60) : null,
            datedTotal: v.datedTotal ?? null,
            note: v.note ?? null,
            scannedTotal: v.scannedTotal ?? null,
            ageMin: pbMeta.data?.updated_at ? Math.round((Date.now() - new Date(pbMeta.data.updated_at).getTime()) / 60000) : null,
            // Rationale: docs/job-board-index-notes.md#n734-backlog-pbbacklognow
            backlog: pbBacklogNow,
            backlogAtSweep: v.backlogAtSweep ?? null,
            backlogGrowth: typeof pbBacklogNow === "number" && typeof v.backlogAtSweep === "number"
              ? pbBacklogNow - v.backlogAtSweep
              : null,
            due: postedBackfillDue(v, pbBacklogNow),
          };
        })(),
        // live pipeline health (meta-derived)
        totalPostings: rfV.total ?? null,
        coldBoards: rotV.coldBoards ?? null,
        dormantBoards: Object.keys(dormant).length,
        // Boards whose feed reads but whose rows our database would not read or
        // store, DB_FAIL_ALARM_VISITS visits running or more (S11-023).
        dbFailingBoards: dbFailingBoards(((bf.data?.v ?? {}) as { dbStreaks?: Record<string, number> }).dbStreaks).slice(0, 20),
        // Rationale: docs/job-board-index-notes.md#n220-chainkick
        chainKick: (() => {
          const v = (chainKick.data?.v ?? {}) as Record<string, unknown>;
          const at = chainKick.data?.updated_at ?? null;
          return {
            outcome: v.outcome ?? null,       // continued | declined | http_error | threw | paused
            at: (v.at as string | undefined) ?? at ?? null,
            fromHop: v.fromHop ?? null,
            status: v.status ?? null,
            detail: typeof v.detail === "string" ? v.detail.slice(0, 160) : null,
            ageMin: at ? Math.round((Date.now() - new Date(at).getTime()) / 60_000) : null,
          };
        })(),
        retryLane: (() => {
          const v = (bf.data?.v ?? {}) as { failedAt?: Record<string, number>; lastRetryLane?: unknown };
          return {
            failing: Object.keys(v.failedAt ?? {}).length,
            last: v.lastRetryLane ?? null,
          };
        })(),

        cursor: { hot: pgV.hot ?? 0, cold: pgV.cold ?? 0, coldDone: pgV.coldDone ?? 0 },
        // pending alone says only that the cursor moved. lastSlice says
        // whether the drained tokens ever became boards to fetch.
        bootstrapQueue: (() => {
          const b = (bsMeta.data?.v ?? {}) as { queue?: unknown[]; version?: string; lastSlice?: unknown };
          return {
            pending: Array.isArray(b.queue) ? b.queue.length : 0,
            forVersion: b.version ?? null,
            lastSlice: b.lastSlice ?? null,
          };
        })(),
        lastSliceAgeMin: ageMin(prog.data?.updated_at),
        lastRotationAgeMin: ageMin(rotV.completedAt ?? rot.data?.updated_at ?? null),
        recentFailures: Array.isArray(pgV.failedAcc) ? pgV.failedAcc.slice(-10) : [],
        // The sample above is capped at 120 and these ten are its tail; this
        // is the population it was drawn from.
        failedCount: Number(pgV.failedTotal) || 0,
        // Measured freshness: re-verification age across all stamped boards.
        // THE number behind the public "within a few hours" claim.
        freshness: (() => {
          const row = Array.isArray((fresh as { data?: unknown }).data) && ((fresh as { data: unknown[] }).data)[0]
            ? ((fresh as { data: unknown[] }).data)[0] as Record<string, unknown>
            : null;
          if (!row) return null;
          // Rationale: docs/job-board-index-notes.md#n735-const-v-freshrow-data-v-as
          const v = (freshRow.data?.v ?? {}) as { dark_boards?: unknown; dark_max_min?: unknown; population?: unknown };
          return {
            ...row,
            ...(v.dark_boards !== undefined
              ? { dark_boards: Number(v.dark_boards) || 0, dark_max_min: v.dark_max_min ?? null, population: typeof v.population === "string" ? v.population : null }
              : {}),
          };
        })(),
        // Rationale: docs/job-board-index-notes.md#n736-stalelane
        staleLane: (() => {
          const v = (staleMeta.data?.v ?? null) as (Partial<StaleLaneRun> & { tries?: unknown }) | null;
          if (!v) return null;
          const tries = v.tries && typeof v.tries === "object" && !Array.isArray(v.tries) ? Object.keys(v.tries as Record<string, unknown>).length : 0;
          const ss = (sliceStatsRow?.data?.v ?? {}) as { staleTries?: unknown; staleResolved?: unknown };
          return {
            at: v.at ?? null,
            ageMin: ageMin(staleMeta.data?.updated_at ?? null),
            rpc: v.rpc ?? null,
            asked: Number(v.asked) || 0,
            // The window is clogged with boards no fetch can move; the stale
            // tail behind it is going unexamined. Absent on a pre-.69 row.
            windowFull: typeof v.windowFull === "boolean" ? v.windowFull : null,
            // Rationale: docs/job-board-index-notes.md#n737-excluded-typeof-v-excluded-number-v
            excluded: typeof v.excluded === "number" ? v.excluded : null,
            classes: v.classes ?? null,
            selected: Array.isArray(v.selected) ? v.selected : [],
            fetched: Number(v.fetched) || 0,
            resolved: Number(v.resolved) || 0,
            unresolved: Array.isArray(v.unresolved) ? v.unresolved : [],
            prototypeNames: Array.isArray(v.prototypeNames) ? v.prototypeNames : [],
            // Rationale: docs/job-board-index-notes.md#n738-excludedunresolved-unresolvedtokens-read
            excludedUnresolved: unresolvedTokens(readStaleTries(v)),
            triesPending: tries,
            lastSlice: ss.staleTries !== undefined ? { tries: ss.staleTries, resolved: ss.staleResolved ?? null } : null,
          };
        })(),
        // Rationale: docs/job-board-index-notes.md#n739-chainwatchdog
        chainWatchdog,
        quarantinedVendors: (((breaker.data?.v ?? {}) as { quarantined?: string[] }).quarantined ?? []),
        // Rationale: docs/job-board-index-notes.md#n221-boardflow
        boardFlow: (() => {
          const r = (boardFlow as { data?: { v?: unknown } } | null)?.data?.v;
          const row = Array.isArray(r) ? r[0] : r;
          return row && typeof row === "object" ? row : null;
        })(),
        // The cache's own age, so a stale flow number is never read as current.
        boardFlowAgeMin: ageMin(
          (boardFlow as { data?: { updated_at?: string } } | null)?.data?.updated_at ?? null,
        ),
        // Rationale: docs/job-board-index-notes.md#n740-ingestpaused-ingestpaused-as-data-v-paus
        ingestPaused: ((ingestPaused as { data?: { v?: { paused?: boolean } } } | null)?.data?.v?.paused === true) || false,
        ingestPausedAgeMin: ageMin(
          (ingestPaused as { data?: { updated_at?: string } } | null)?.data?.updated_at ?? null,
        ),
        dateCoverageSource: Array.isArray((dateCov as { data?: unknown }).data)
          ? "rollup"
          : (dcCache.data?.v ? "cache" : "unavailable"),
        dateCoverageAgeMin: Array.isArray((dateCov as { data?: unknown }).data)
          ? ageMin((((dateCov as { data: Array<{ computed_at?: string }> }).data)[0]?.computed_at) ?? null)
          : ageMin(dcCache.data?.updated_at ?? null),
        // The last thing a slice said before it stopped saying anything.
        sliceTrace: ((traceRow as { data?: { v?: unknown } } | null)?.data?.v ?? null) as Record<string, unknown> | null,
        // The pass-end tail's receipt (S11-001): a startedAt with no later doneAt
        // past half an hour is a tail that died (scan-heartbeat job_board_pass_end).
        passEnd: ((passEndRow as { data?: { v?: unknown } } | null)?.data?.v ?? null) as Record<string, unknown> | null,
        // Rationale: docs/job-board-index-notes.md#n741-oversizeboards-oversizestatusrows-overme
        oversizeBoards: oversizeStatusRows((overMeta as { data?: { v?: { boards?: unknown } } } | null)?.data?.v?.boards),
        oversizeBoardCount: Object.keys(((overMeta as { data?: { v?: { boards?: Record<string, unknown> } } } | null)?.data?.v?.boards) ?? {}).length,
        descCoverageAgeMin: ageMin((descCov as { data?: { computed_at?: string } } | null)?.data?.computed_at ?? null),
        descCoverage: Array.isArray((descCov as { data?: { v?: unknown } } | null)?.data?.v)
          ? ((descCov as { data: { v: Array<{ source: string; total: number; described: number }> } }).data.v).map((r) => ({
              source: r.source,
              total: Number(r.total),
              described: Number(r.described),
              describedPct: Number(r.total) ? Math.round((100 * Number(r.described)) / Number(r.total)) : 0,
            }))
          : null,
        dateCoverage: Array.isArray((dateCov as { data?: unknown }).data)
          ? ((dateCov as { data: Array<{ source: string; total: number; dated: number }> }).data).map((r) => ({
              source: r.source,
              total: Number(r.total),
              datedPct: Math.round(100 * Number(r.dated) / Math.max(Number(r.total), 1)),
            }))
          // Rationale: docs/job-board-index-notes.md#n742-dccache-data-v-as-unknown-undefined
          : ((dcCache.data?.v as unknown[] | undefined) ?? null),
        at: new Date().toISOString(),
      });
      statusMemo = { at: Date.now(), text: statusText };
      return new Response(statusText, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (statusErr) {
        // Rationale: docs/job-board-index-notes.md#n743-console-error-job-board-status-degraded
        console.error("[JOB-BOARD] status degraded:", statusErr);
        return json({
          version: BUILD_VERSION,
          catalogSize: JOB_SOURCES.length,
          statusDegraded: true,
          statusError: String((statusErr as { message?: unknown })?.message ?? statusErr).slice(0, 300),
          at: new Date().toISOString(),
        });
      }
    }

    if (action === "vendor-health") {
      // Rationale: docs/job-board-index-notes.md#n744-const-ttl_ms-_000
      const TTL_MS = 30 * 60_000;
      const { data: cached } = await client.from("job_board_meta").select("v, updated_at").eq("k", "vendor_health").maybeSingle();
      // force re-probes every canary vendor: maintenance only (.88), or any
      // anonymous loop could make each request a dozen vendor fetches.
      const vhForced = body.force === true && await isMaintenance(req, body);
      if (cached && !vhForced && Date.now() - new Date(cached.updated_at).getTime() < TTL_MS) {
        return json({ ...(cached.v as Record<string, unknown>), cached: true });
      }
      if (!vhForced && !(await claimRun(client, "vendor_health_run", 5 * 60_000))) {
        return json({ ...((cached?.v ?? {}) as Record<string, unknown>), cached: true, running: true });
      }
      const results: CanaryResult[] = await Promise.all(CANARIES.map(async (c) => {
        const r = await fetchBoard({ name: c.name, source: c.vendor, token: c.token });
        return { vendor: c.vendor, token: c.token, fetchOk: r !== null, raw: r ? rawItemCount(c.vendor, r.raw) : 0, normalized: r?.jobs.length ?? 0 };
      }));
      const health = aggregateVendorHealth(results);
      const payload = { ...health, at: new Date().toISOString() };
      await client.from("job_board_meta").upsert({ k: "vendor_health", v: payload, updated_at: new Date().toISOString() }, { onConflict: "k" });
      return json(payload);
    }

    if (action === "pass-end") {
      // One step of the pass-end tail, inside this request (pass-end.ts, S11-001).
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "pass-end is a maintenance action" }, 403);
      }
      if (!isPassEndStep(body.step) || typeof body.startedAt !== "string") return json({ error: "pass-end needs a step and its pass's startedAt" }, 400);
      return json(await runPassEndStep(client, body.step, body.startedAt));
    }

    if (action === "filter-audit") {
      // Rationale: docs/job-board-index-notes.md#n222-typeof-body-chainkey-string-bod
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "filter-audit is a maintenance action" }, 403);
      }
      const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      // Rationale: docs/job-board-index-notes.md#n223-probe
      const probe = async (payload: Record<string, unknown>) => {
        const started = Date.now();
        try {
          // Rationale: docs/job-board-index-notes.md#n745-const-body-json-stringify-action-list
          const body = JSON.stringify({ action: "list", limit: 60, groupSimilar: false, caller: "maintenance", ...payload });
          // IN-PROCESS (.93): this bundle's own handler, not the network, whose
          // per-trace cap on self-calls left the audit incomplete on 2026-10-12.
          const send = () => handleRequest(new Request(self, {
            method: "POST",
            headers: { "content-type": "application/json", apikey: svc, Authorization: `Bearer ${svc}` },
            body,
          }));
          // The runtime refuses a self-call by THROWING RateLimitError, and answers
          // 503/546 under load: throttling, not a board defect (L1-07).
          const attempt = () => send().then((res) => ({ res, err: null as unknown }), (err: unknown) => ({ res: null, err }));
          const refused = (a: { res: Response | null; err: unknown }) =>
            a.res ? [429, 503, 546].includes(a.res.status) : /RateLimitError|rate limit/i.test(`${(a.err as Error)?.name ?? ""} ${String(a.err)}`);
          let a = await attempt();
          if (refused(a)) {
            const ra = Number(a.res?.headers.get("retry-after"));
            await a.res?.body?.cancel().catch(() => {});
            await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2_000, 5_000)));
            a = await attempt();
          }
          if (!a.res) return { ok: false, throttled: refused(a), ms: Date.now() - started, body: { error: String(a.err).slice(0, 80) } };
          const j = await boundBody(a.res, SELF_RESPONSE_BYTES).json().catch(() => ({}));
          return { ok: a.res.ok, throttled: refused(a), ms: Date.now() - started, body: j as Record<string, unknown> };
        } catch (e) {
          return { ok: false, throttled: false, ms: Date.now() - started, body: { error: String(e).slice(0, 80) } };
        }
      };
      const cutoff = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString();
      // Recall ground truth, straight at the table with the serving rule.
      const exactCount = async (col: string, val: string) => {
        const { count, error } = await client
          .from("job_board_postings")
          .select("id", { count: "exact", head: true })
          .is("missing_since", null)
          .gte("effective_posted", cutoff)
          .eq(col, val);
        return error ? null : (count ?? null);
      };

      const FILTER_CASES: Array<{ name: string; body: Record<string, unknown>; col?: string; val?: string }> = [
        { name: "country=DE", body: { country: "DE" }, col: "country", val: "DE" },
        { name: "country=GB", body: { country: "GB" }, col: "country", val: "GB" },
        { name: "category=design", body: { category: "design" }, col: "category", val: "design" },
        { name: "category=legal", body: { category: "legal" }, col: "category", val: "legal" },
        { name: "workMode=hybrid", body: { workMode: "hybrid" }, col: "work_mode", val: "hybrid" },
        { name: "experience=senior", body: { experience: ["senior"] } },
        { name: "remote=true", body: { remote: true } },
        { name: "maxAgeDays=7", body: { maxAgeDays: 7 } },
        { name: "salaryFloor=100k", body: { salaryFloor: 100_000 } },
        // Mixed casing and array shapes — the two forms that actually broke.
        { name: "category=Design (case)", body: { category: "Design" }, col: "category", val: "design" },
        { name: "workMode=HYBRID (case)", body: { workMode: "HYBRID" }, col: "work_mode", val: "hybrid" },
        { name: "combo DE+design", body: { country: "DE", category: "design" } },
        // Rationale: docs/job-board-index-notes.md#n746-name-excludeagencies-true-body-excludeag
        { name: "excludeAgencies=true", body: { excludeAgencies: true } },
      ];
      // Filter values we must NEVER honour silently. The fence is that a filter
      // is named or applied, never dropped — experience:["bogus"] breached it.
      const IGNORE_CASES: Array<{ name: string; body: Record<string, unknown>; expect: string }> = [
        { name: "country=USA", body: { country: "USA" }, expect: "country" },
        { name: "experience=bogus", body: { experience: "bogus" }, expect: "experience" },
        { name: "experience=[bogus]", body: { experience: ["bogus"] }, expect: "experience" },
        { name: "experience=[senior,bogus]", body: { experience: ["senior", "bogus"] }, expect: "experience" },
        { name: "category=nonsense", body: { category: "nonsense" }, expect: "category" },
        { name: "workMode=hovering", body: { workMode: "hovering" }, expect: "workMode" },
        // The query-string boolean shape — the exact sendableOnly:"true"
        // silence, pointed at the newest strict-boolean filter.
        { name: 'excludeAgencies="true"', body: { excludeAgencies: "true" }, expect: "excludeAgencies" },
      ];
      // Rationale: docs/job-board-index-notes.md#n747-const-query_cases-array-q-string-mintota
      const QUERY_CASES: Array<{ q: string; minTotal: number; note: string }> = [
        { q: "registered nurse", minTotal: 200, note: "common clinical" },
        { q: "software engineer", minTotal: 200, note: "common technical" },
        { q: "data scientist", minTotal: 50, note: "common technical" },
        { q: "occupational therapist", minTotal: 20, note: "mid-frequency" },
        { q: "veterinary technician", minTotal: 5, note: "niche" },
        { q: "patient services assistant", minTotal: 5, note: "niche multi-word" },
        { q: "barista", minTotal: 5, note: "single word" },
        { q: "swe", minTotal: 50, note: "alias expansion" },
        { q: "nurse practicioner", minTotal: 1, note: "TYPO — fuzzy augmentation" },
        { q: "zzzqqxnonsensequery", minTotal: 0, note: "must be empty, not padded" },
      ];

      const findings: Array<{ case: string; kind: string; detail: string }> = [];
      const timings: Array<{ case: string; ms: number }> = [];

      // Rationale: docs/job-board-index-notes.md#n748-const-inbatches-async-t-r-items
      const inBatches = async <T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
        const out: R[] = [];
        for (let i = 0; i < items.length; i += size) {
          out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
          // Rationale: docs/job-board-index-notes.md#n749-if-i-size-items-length-await
          if (i + size < items.length) await new Promise((r) => setTimeout(r, 500));
        }
        return out;
      };
      const BATCH = 2;

      await inBatches(FILTER_CASES, BATCH, async (c) => {
        const r = await probe(c.body);
        timings.push({ case: c.name, ms: r.ms });
        if (!r.ok) { findings.push({ case: c.name, kind: r.throttled ? "throttled" : "request-failed", detail: String(r.body.error ?? "").slice(0, 80) }); return; }
        const jobs = Array.isArray(r.body.jobs) ? r.body.jobs as Array<Record<string, unknown>> : [];
        // PRECISION — reuse the SAME predicate the live self-check uses, so the
        // audit and the request agree by construction rather than by discipline.
        const { applied: ap } = normalizeFilters(c.body, JOB_SOURCES.length);
        const bad = filterViolations(jobs, ap);
        if (bad.length) {
          findings.push({ case: c.name, kind: "precision", detail: `${bad.length}/${jobs.length} rows violate ${[...new Set(bad.map((b) => b.field))].join(",")}` });
        }
        if (!jobs.length) findings.push({ case: c.name, kind: "empty-page", detail: "a filter with matches returned no rows" });
        // The response must never claim a filter applied that it dropped.
        if (Array.isArray(r.body.ignoredFilters) && (r.body.ignoredFilters as string[]).length) {
          findings.push({ case: c.name, kind: "unexpected-ignored", detail: (r.body.ignoredFilters as string[]).join(",") });
        }
        if (r.body.filterIntegrity) {
          findings.push({ case: c.name, kind: "self-check-fired", detail: JSON.stringify(r.body.filterIntegrity).slice(0, 90) });
        }
        // Rationale: docs/job-board-index-notes.md#n224-c-col-c-val-r-body-countcapped
        if (c.col && c.val && r.body.countCapped === true) {
          const truth = await exactCount(c.col, c.val);
          if (truth !== null && truth < 10_000) {
            findings.push({ case: c.name, kind: "false-cap", detail: `reported capped (10,000+) but the true count is ${truth}` });
          }
        }
        if (c.col && c.val && r.body.countCapped !== true && typeof r.body.total === "number") {
          const truth = await exactCount(c.col, c.val);
          // Rows shift under the maintenance track between the two reads, so a
          // small delta is the measurement, not a defect. 1% or 50 rows.
          if (truth !== null) {
            const slack = Math.max(50, Math.round(truth * 0.01));
            if (Math.abs(truth - (r.body.total as number)) > slack) {
              findings.push({ case: c.name, kind: "recall", detail: `reported ${r.body.total} vs exact ${truth}` });
            }
          }
        }
      });

      await inBatches(IGNORE_CASES, BATCH, async (c) => {
        const r = await probe(c.body);
        // A refused probe measured nothing; it is not a silent drop.
        if (!r.ok) { findings.push({ case: c.name, kind: r.throttled ? "throttled" : "request-failed", detail: String(r.body.error ?? "").slice(0, 80) }); return; }
        const ig = Array.isArray(r.body.ignoredFilters) ? r.body.ignoredFilters as string[] : [];
        if (!ig.includes(c.expect)) {
          findings.push({ case: c.name, kind: "silent-drop", detail: `expected "${c.expect}" in ignoredFilters, got [${ig.join(",")}]` });
        }
      });

      await inBatches(QUERY_CASES, BATCH, async (c) => {
        const r = await probe({ q: c.q, limit: 10 });
        timings.push({ case: `q=${c.q}`, ms: r.ms });
        if (!r.ok) { findings.push({ case: `q=${c.q}`, kind: r.throttled ? "throttled" : "request-failed", detail: String(r.body.error ?? "").slice(0, 80) }); return; }
        const jobs = Array.isArray(r.body.jobs) ? r.body.jobs as unknown[] : [];
        const total = typeof r.body.total === "number" ? r.body.total : null;
        if (c.minTotal === 0) {
          if (jobs.length > 0) findings.push({ case: `q=${c.q}`, kind: "nonsense-padded", detail: `${jobs.length} rows for a nonsense query` });
        } else if (!jobs.length) {
          findings.push({ case: `q=${c.q}`, kind: "no-results", detail: `${c.note}: returned nothing` });
        } else if (total !== null && r.body.countCapped !== true && total < c.minTotal) {
          findings.push({ case: `q=${c.q}`, kind: "thin-results", detail: `${c.note}: total ${total} < floor ${c.minTotal}` });
        }
      });

      // Rationale: docs/job-board-index-notes.md#n750-for-const-shape-of-category-design
      for (const shape of [{}, { category: "design" }, { q: "nurse" }] as Array<Record<string, unknown>>) {
        const seen: string[] = [];
        const label = Object.keys(shape).length ? JSON.stringify(shape) : "no-filter";
        for (let off = 0; off < 240; off += 60) {
          if (off > 0 || seen.length > 0) await new Promise((r) => setTimeout(r, 500));
          const r = await probe({ ...shape, offset: off });
          // Rationale: docs/job-board-index-notes.md#n751-if-r-ok
          if (!r.ok) {
            findings.push({ case: `paging ${label}`, kind: r.throttled ? "throttled" : "request-failed", detail: `offset ${off}: ${String(r.body.error ?? "").slice(0, 60)}` });
            break;
          }
          const jobs = Array.isArray(r.body.jobs) ? r.body.jobs as Array<Record<string, unknown>> : [];
          if (!jobs.length) break;
          seen.push(...jobs.map((j) => String(j.id ?? "")));
        }
        const dupes = seen.length - new Set(seen).size;
        if (dupes > 0) findings.push({ case: `paging ${label}`, kind: "duplicate-rows", detail: `${dupes} of ${seen.length} repeated across pages` });
      }

      const slow = timings.filter((t) => t.ms > 15_000);
      const payload = {
        at: new Date().toISOString(),
        version: BUILD_VERSION,
        cases: FILTER_CASES.length + IGNORE_CASES.length + QUERY_CASES.length + 3,
        findings,
        clean: findings.length === 0,
        // Rationale: docs/job-board-index-notes.md#n752-throttledcases-findings-filter-f-f-kind
        throttledCases: findings.filter((f) => f.kind === "throttled").length,
        // Nothing measured broken, something not measured: the audit did not finish (L1-07).
        incomplete: findings.length > 0 && findings.every((f) => f.kind === "throttled"),
        p95Ms: (() => {
          const xs = timings.map((t) => t.ms).sort((a, b) => a - b);
          return xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : null;
        })(),
        slowest: timings.sort((a, b) => b.ms - a.ms).slice(0, 3),
        slowCases: slow.length,
      };
      await client.from("job_board_meta").upsert(
        { k: "filter_audit", v: payload, updated_at: payload.at },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] filter-audit: ${findings.length} finding(s) across ${payload.cases} cases`);
      return json(payload);
    }

    if (action === "recategorize") {
      // Rationale: docs/job-board-index-notes.md#n753-if-typeof-body-chainkey-string-body
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "recategorize is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      // Rationale: docs/job-board-index-notes.md#n225-hopversion
      const hopVersion = Number(body.rulesVersion);
      if ((Number.isFinite(hopVersion) && hopVersion !== CATEGORIZE_VERSION) || (!Number.isFinite(hopVersion) && cursor)) {
        return json({ ok: false, superseded: true, current: CATEGORIZE_VERSION });
      }
      // Rationale: docs/job-board-index-notes.md#n226-await-client-from-job-board-meta-upsert
      await client.from("job_board_meta").upsert(
        { k: "recategorize_progress", v: { cursor, version: CATEGORIZE_VERSION, startedUnder: CATEGORIZE_VERSION, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      let scanned = 0;
      const changed = new Map<string, string[]>(); // new category -> ids
      const PAGES = 8;
      for (let page = 0; page < PAGES; page++) {
        let q = client
          .from("job_board_postings")
          .select("id,title,department")
          .eq("category", "other")
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const cat = categorize(r.title ?? "", r.department ?? null);
          if (cat !== "other") {
            if (!changed.has(cat)) changed.set(cat, []);
            changed.get(cat)!.push(r.id as string);
          }
        }
        if (!rows || rows.length < 1000) { cursor = ""; break; }
        cursor = rows[rows.length - 1].id as string;
      }
      let updated = 0;
      for (const [cat, ids] of changed) {
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await client.from("job_board_postings").update({ category: cat }).in("id", ids.slice(i, i + 200));
          if (error) throw error;
          updated += Math.min(200, ids.length - i);
        }
      }
      if (cursor) {
        // more pages remain — continue in a fresh invocation
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recategorize", chainKey: key, cursor, rulesVersion: CATEGORIZE_VERSION }),
        })).then((r) => discardBody(r)).catch(() => {}));
        return json({ ok: true, scanned, updated, nextCursor: cursor });
      }
      await client.from("job_board_meta").upsert(
        { k: "category_rules_version", v: { version: CATEGORIZE_VERSION, startedUnder: CATEGORIZE_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      await client.from("job_board_meta").delete().eq("k", "recategorize_progress");
      console.log(`[JOB-BOARD] recategorize sweep complete: ${scanned} scanned, ${updated} refiled (rules v${CATEGORIZE_VERSION})`);
      return json({ ok: true, scanned, updated, done: true });
    }

    if (action === "backfill-experience") {
      // Rationale: docs/job-board-index-notes.md#n754-if-typeof-body-chainkey-string-body
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-experience is a maintenance action" }, 403);
      }
      const hopVersion = Number(body.rulesVersion);
      if (Number.isFinite(hopVersion) && hopVersion !== EXPERIENCE_VERSION) {
        return json({ ok: false, superseded: true, current: EXPERIENCE_VERSION });
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      const { data: xbRow } = await client.from("job_board_meta").select("v").eq("k", "experience_backfill").maybeSingle();
      const xbPrev = (xbRow?.v ?? {}) as { startedUnder?: number; scanned?: number; updated?: number };
      const carried = Number(xbPrev.startedUnder) === EXPERIENCE_VERSION && cursor ? xbPrev : { scanned: 0, updated: 0 };
      const progress = (v: Record<string, unknown>) => client.from("job_board_meta").upsert(
        { k: "experience_backfill", v: { version: EXPERIENCE_VERSION, startedUnder: EXPERIENCE_VERSION, at: new Date().toISOString(), ...v }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      await progress({ cursor, scanned: Number(carried.scanned) || 0, updated: Number(carried.updated) || 0 });
      let scanned = 0;
      const groups = new Map<string, string[]>(); // "band|minYears" -> ids
      const PAGES = 6;
      for (let page = 0; page < PAGES; page++) {
        let q = client
          .from("job_board_postings")
          .select("id,title,description,experience_band,min_years")
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const row = r as { id: string; title?: string | null; description?: string | null; experience_band?: string | null; min_years?: number | string | null };
          const exp = detectExperience(row.title ?? "", row.description ?? null);
          const band = exp.band ?? "unspecified";
          const min = exp.minYears ?? null;
          if (row.experience_band === band && (row.min_years == null ? null : Number(row.min_years)) === min) continue;
          const key = `${band}|${min ?? ""}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(row.id);
        }
        if (!rows || rows.length < 1000) { cursor = ""; break; }
        cursor = rows[rows.length - 1].id as string;
      }
      let updated = 0;
      for (const [key, ids] of groups) {
        const [band, minStr] = key.split("|");
        const patch = { experience_band: band, min_years: minStr === "" ? null : Number(minStr) };
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await client.from("job_board_postings").update(patch).in("id", ids.slice(i, i + 200));
          if (error) throw error;
          updated += Math.min(200, ids.length - i);
        }
      }
      const totals = { scanned: (Number(carried.scanned) || 0) + scanned, updated: (Number(carried.updated) || 0) + updated };
      if (cursor) {
        await progress({ cursor, ...totals });
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill-experience", chainKey: key, cursor, rulesVersion: EXPERIENCE_VERSION }),
        })).then((r) => discardBody(r)).catch(() => {}));
        return json({ ok: true, scanned, updated, nextCursor: cursor });
      }
      const doneAt = new Date().toISOString();
      await progress({ cursor: "", ...totals, doneAt });
      await client.from("job_board_meta").upsert(
        { k: "experience_version", v: { version: EXPERIENCE_VERSION, sweptAt: doneAt, ...totals }, updated_at: doneAt },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] experience re-derive complete: ${totals.scanned} scanned, ${totals.updated} rewritten (v${EXPERIENCE_VERSION})`);
      return json({ ok: true, scanned, updated, done: true });
    }

    if (action === "backfill-posted") {
      // Rationale: docs/job-board-index-notes.md#n227-typeof-body-chainkey-string-bod
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-posted is a maintenance action" }, 403);
      }
      // Rationale: docs/job-board-index-notes.md#n228-phase
      const phase = ["greenhouse", "rippling", "pinpoint"].includes(String(body.phase))
        ? String(body.phase) as "greenhouse" | "rippling" | "pinpoint"
        : "bamboohr";
      // Rationale: docs/job-board-index-notes.md#n755-const-perposting-phase-bamboohr-phase-ri
      const perPosting = phase === "bamboohr" || phase === "rippling";
      const BOARDS_PER_HOP = 40; // workday (the 8-board case) is retired
      const IDS_PER_HOP = 120;
      // Rationale: docs/job-board-index-notes.md#n229-cursor
      let cursor = typeof body.cursor === "string" && body.cursor.startsWith(`${phase}:`) ? body.cursor : `${phase}:`;
      // Rationale: docs/job-board-index-notes.md#n756-const-data-pbprev-await-client-from
      const { data: pbPrev } = await client.from("job_board_meta").select("v").eq("k", "posted_backfill").maybeSingle();
      const pbDone = (pbPrev?.v as { version?: number } | null)?.version;
      await client.from("job_board_meta").upsert(
        { k: "posted_backfill", v: { ...(typeof pbDone === "number" ? { version: pbDone } : {}), resumeVersion: POSTED_BACKFILL_VERSION, phase, cursor, datedTotal: (typeof body.datedTotal === "number" ? body.datedTotal : 0), note: typeof body.note === "string" ? body.note.slice(0, 200) : null, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      const byBoard = new Map<string, { company: string; ids: string[] }>();
      let scanned = 0;
      let exhausted = false;
      // Rationale: docs/job-board-index-notes.md#n757-let-drawfailed-false
      let drawFailed = false;
      // Rationale: docs/job-board-index-notes.md#n230-lastcursor
      let lastCursor = "";
      while ((perPosting ? scanned < IDS_PER_HOP : byBoard.size < BOARDS_PER_HOP) && !exhausted) {
        let q = client
          .from("job_board_postings")
          .select("id,company_token,company")
          .eq("source", phase)
          .is("posted_at", null)
          .order("id")
          .limit(500);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) {
          // Rationale: docs/job-board-index-notes.md#n231-await-client-from-job-board-meta-upsert
          await client.from("job_board_meta").upsert(
            { k: "posted_backfill", v: { resumeVersion: POSTED_BACKFILL_VERSION, phase, cursor, note: `draw: ${error.message ?? error}`.slice(0, 200), at: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: "k" });
          // Rationale: docs/job-board-index-notes.md#n232-drawfailed-true
          drawFailed = true;
          exhausted = true;
          break;
        }
        let brokeEarly = false;
        for (const r of rows ?? []) {
          const tk = r.company_token as string;
          if (!perPosting && !byBoard.has(tk) && byBoard.size >= BOARDS_PER_HOP) continue; // next hop
          if (perPosting && scanned >= IDS_PER_HOP) { brokeEarly = true; break; }
          scanned++;
          const g = byBoard.get(tk) ?? { company: (r.company as string) ?? tk, ids: [] };
          g.ids.push(r.id as string);
          byBoard.set(tk, g);
          cursor = r.id as string;
        }
        // A short page only exhausts the phase if we CONSUMED it fully — a
        // budget break mid-page must leave the remainder for the next hop.
        if (!brokeEarly && (!rows || rows.length < 500)) exhausted = true;
        // Made no forward progress on this page? Then another draw cannot help.
        if (cursor === lastCursor && !brokeEarly) exhausted = true;
        lastCursor = cursor;
      }
      let dated = 0;
      let lastBoardError = "";
      // Rationale: docs/job-board-index-notes.md#n233-beacon
      const beacon = async (n: string) => {
        await client.from("job_board_meta").upsert(
          { k: "posted_backfill", v: {
              resumeVersion: POSTED_BACKFILL_VERSION, phase, cursor,
              datedTotal: (typeof body.datedTotal === "number" ? body.datedTotal : 0),
              note: n.slice(0, 200), at: new Date().toISOString(),
            }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
      };
      await beacon(`drew ${scanned} ids across ${byBoard.size} boards`);
      let boardsDone = 0;
      for (const [tk, { company, ids }] of byBoard) {
        try {
          const dates = new Map<string, string>();
          if (phase === "greenhouse") {
            const gh = greenhouseApi(tk);
            const res = await fetchWithTimeout(`https://${gh.host}/v1/boards/${encodeURIComponent(gh.token)}/jobs`);
            if (!res.ok) { await res.body?.cancel(); continue; }
            const feed = await res.json() as { jobs?: Array<{ id?: number | string; first_published?: string }> };
            for (const j of feed.jobs ?? []) {
              const iso = sanePostedAt(j.first_published ?? null);
              if (j.id != null && iso) dates.set(`greenhouse:${tk}:${j.id}`, iso);
            }
          } else if (phase === "pinpoint") {
            // Rationale: docs/job-board-index-notes.md#n234-psrc
            const psrc = JOB_SOURCES.find((s) => s.source === "pinpoint" && s.token === tk);
            if (!psrc) continue;
            const r = await fetchBoard(psrc);
            const data = ((r?.raw as { data?: Array<{ id?: string | number; url?: string }> })?.data) ?? [];
            const urlById = new Map<string, string>();
            for (const it of data) if (it?.id != null && it.url) urlById.set(String(it.id), String(it.url));
            // Same pool of 5 the bamboohr/rippling branch uses — the hop budget
            // is already sized for per-posting work on those phases.
            const ppool = 5;
            for (let i = 0; i < ids.length; i += ppool) {
              await Promise.all(ids.slice(i, i + ppool).map(async (rowId) => {
                const ext = rowId.slice(rowId.lastIndexOf(":") + 1);
                const url = urlById.get(ext);
                if (!url) return;
                try {
                  const pr = await fetchWithTimeout(url);
                  if (!pr.ok) { await pr.body?.cancel(); return; }
                  const html = await pr.text();
                  // Rationale: docs/job-board-index-notes.md#n758-const-m-dateposted-s-s-exec
                  const m = /"datePosted"\s*:\s*"([^"]+)"/.exec(html);
                  const iso = sanePostedAt(m?.[1] ?? null);
                  if (iso) dates.set(rowId, iso);
                } catch { /* row stays NULL */ }
              }));
            }
          } else if (phase === "bamboohr" || phase === "rippling") {
            // Rationale: docs/job-board-index-notes.md#n759-const-pool
            const pool = 5;
            for (let i = 0; i < ids.length; i += pool) {
              await Promise.all(ids.slice(i, i + pool).map(async (rowId) => {
                const pid = rowId.split(":")[2];
                if (!pid) return;
                try {
                  const url = phase === "bamboohr"
                    ? `https://${tk}.bamboohr.com/careers/${encodeURIComponent(pid)}/detail`
                    : `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(tk)}/jobs/${encodeURIComponent(pid)}`;
                  const res = await fetchWithTimeout(url);
                  if (!res.ok) { await res.body?.cancel(); return; }
                  const j = await res.json() as { result?: { jobOpening?: { datePosted?: string } }; createdOn?: string };
                  const iso = sanePostedAt(phase === "bamboohr" ? j.result?.jobOpening?.datePosted ?? null : j.createdOn ?? null);
                  if (iso) dates.set(rowId, iso);
                } catch { /* row stays NULL */ }
              }));
            }
          } else {
            // Rationale: docs/job-board-index-notes.md#n760-const-jobpostings-await-fetchworkday-nam
            const { jobPostings } = await fetchWorkday({ name: company, source: "workday", token: tk } as JobSource);
            for (const p of normalizeWorkday(jobPostings as never, company, tk)) {
              if (p.postedAt) dates.set(p.id, p.postedAt);
            }
          }
          for (const id of ids) {
            const iso = dates.get(id);
            if (!iso) continue;
            const { error } = await client.from("job_board_postings").update({ posted_at: iso }).eq("id", id);
            // Rationale: docs/job-board-index-notes.md#n761-if-error-dated
            if (!error) dated++;
            else if (!lastBoardError) lastBoardError = `update ${id.slice(0, 40)}: ${error.message ?? error}`.slice(0, 160);
          }
          boardsDone++;
          if (boardsDone % 10 === 0) {
            await beacon(`boards ${boardsDone}/${byBoard.size} dated=${dated}${lastBoardError ? ` last=${lastBoardError}` : ""}`);
          }
        } catch (e) {
          // Rationale: docs/job-board-index-notes.md#n762-lastboarderror-tk-e-instanceof-error-e
          lastBoardError = `${tk}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
        }
      }
      // Rationale: docs/job-board-index-notes.md#n763-const-datedtotal-typeof-body-datedtotal
      const datedTotal = (typeof body.datedTotal === "number" ? body.datedTotal : 0) + dated;
      const scannedTotal = (typeof body.scannedTotal === "number" ? body.scannedTotal : 0) + scanned;
      // Rationale: docs/job-board-index-notes.md#n235-await-client-from-job-board-meta-upsert
      await client.from("job_board_meta").upsert(
        { k: "posted_backfill", v: {
            resumeVersion: POSTED_BACKFILL_VERSION, phase, cursor, datedTotal, scannedTotal,
            note: `hop: ${dated}/${scanned} boards=${byBoard.size}${lastBoardError ? ` last=${lastBoardError}` : ""}`.slice(0, 200),
            at: new Date().toISOString(),
          }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      const chain = (nextBody: Record<string, unknown>) => {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        // Paced like the embed chain: back-to-back per-posting hops are a
        // burst the vendors' CDNs eventually answer with throttling.
        waitUntil(new Promise((r) => setTimeout(r, BACKFILL_HOP_PAUSE_MS))
          .then(() => chainKey())
          .then((key) => fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "backfill-posted", chainKey: key, ...nextBody }),
          })).then((r) => discardBody(r)).catch(() => {}));
      };
      if (!exhausted) {
        chain({ phase, cursor, datedTotal, scannedTotal, note: lastBoardError ? `board ${lastBoardError}` : `hop ok: ${dated}/${scanned}` });
        return json({ ok: true, phase, scanned, dated, datedTotal, scannedTotal, cursor });
      }
      const NEXT_PHASE: Record<string, string> = { bamboohr: "rippling", rippling: "pinpoint", pinpoint: "greenhouse" }; // greenhouse is terminal — the workday phase is retired (see POSTED_BACKFILL_VERSION)
      if (NEXT_PHASE[phase]) {
        chain({ phase: NEXT_PHASE[phase], datedTotal, scannedTotal, note: lastBoardError ? `board ${lastBoardError}` : `phase done: ${datedTotal}/${scannedTotal}` }); // fresh cursor for the next source
        return json({ ok: true, phase, scanned, dated, datedTotal, scannedTotal, next: NEXT_PHASE[phase] });
      }
      // Rationale: docs/job-board-index-notes.md#n236-drawfailed-scannedtotal-0
      if (drawFailed || scannedTotal <= 0) {
        await client.from("job_board_meta").upsert(
          { k: "posted_backfill", v: {
            resumeVersion: POSTED_BACKFILL_VERSION,
            phase, cursor, datedTotal, scannedTotal,
            note: `vacuous sweep: ${scannedTotal} scanned${drawFailed ? " (draw failed)" : ""}${lastBoardError ? ` last=${lastBoardError}` : ""}`.slice(0, 200),
            at: new Date().toISOString(),
          }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        console.log(`[JOB-BOARD] posted-date backfill VACUOUS: ${scannedTotal} scanned, drawFailed=${drawFailed} — not stamping completion`);
        return json({ ok: false, vacuous: true, phase, drawFailed, scannedTotal });
      }
      const backlogAtSweep = await undatedBacklog(client);
      await client.from("job_board_meta").upsert(
        { k: "posted_backfill", v: { version: POSTED_BACKFILL_VERSION, sweptAt: new Date().toISOString(), datedTotal, scannedTotal, ...(backlogAtSweep === null ? {} : { backlogAtSweep }), note: lastBoardError ? `last=${lastBoardError}`.slice(0, 200) : null }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] posted-date backfill complete: ${scanned} scanned, ${dated} dated (v${POSTED_BACKFILL_VERSION})`);
      return json({ ok: true, phase, scanned, dated, done: true });
    }

    if (action === "backfill-salary") {
      // Rationale: docs/job-board-index-notes.md#n764-if-typeof-body-chainkey-string-body
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-salary is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      let scanned = 0;
      // Rationale: docs/job-board-index-notes.md#n765-const-groups-new-map-string-annualmin
      const groups = new Map<string, { annualMin: number | null; annualMax: number | null; period: string | null; currency: string | null; ids: string[] }>();
      const remined: Array<{ id: string; fields: Record<string, unknown> }> = [];
      const PAGES = 6;
      for (let page = 0; page < PAGES; page++) {
        let q = client
          .from("job_board_postings")
          // Rationale: docs/job-board-index-notes.md#n766-select-id-source-salary-country-title
          .select("id,source,salary,country,title,description,employment_type,salary_min_annual,salary_max_annual,salary_period,salary_currency")
          .not("salary", "is", null)
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const row = r as { id: string; source?: string | null; salary?: string | null; country?: string | null; employment_type?: string | null; salary_min_annual?: number | string | null; salary_max_annual?: number | string | null; salary_period?: string | null; salary_currency?: string | null };
          // Rationale: docs/job-board-index-notes.md#n767-const-rowdesc-r-as-description-string
          const rowDesc = (r as { description?: string | null }).description ?? null;
          if (minedSalaryRefused(rowDesc, row.salary)) {
            const reMined = extractSalary(rowDesc);
            const parsed = reMined ? parseSalaryStructured(reMined, row.country, { title: (r as { title?: string | null }).title ?? null, description: rowDesc, employmentType: row.employment_type ?? null }) : null;
            // The same refusal the column sweep honours: no annual this lane cannot see the schedule for.
            const rp = parsed && sweepRefusesAnnual(row.source, null, parsed.annualMin ?? null, parsed.period ?? null) ? null : parsed;
            remined.push({ id: row.id, fields: { salary: reMined, salary_min_annual: rp?.annualMin ?? null, salary_max_annual: rp?.annualMax ?? null, salary_period: rp?.period ?? null, salary_currency: rp?.currency ?? null } });
            continue;
          }
          // Rationale: docs/job-board-index-notes.md#n768-const-p-parsesalarystructured-row-salary
          const p = parseSalaryStructured(row.salary, row.country, { title: (row as { title?: string | null }).title ?? null, description: (row as { description?: string | null }).description ?? null, employmentType: row.employment_type ?? null });
          const nextMin = p?.annualMin ?? null;
          const nextMax = p?.annualMax ?? null;
          const nextPer = p?.period ?? null;
          const nextCur = p?.currency ?? null;
          const curMin = row.salary_min_annual == null ? null : Number(row.salary_min_annual);
          const curMax = row.salary_max_annual == null ? null : Number(row.salary_max_annual);
          const curPer = row.salary_period ?? null;
          const curCur = row.salary_currency ?? null;
          if (nextMin === curMin && nextMax === curMax && nextPer === curPer && nextCur === curCur) continue; // already correct — no write
          // Rationale: docs/job-board-index-notes.md#n769-if-sweeprefusesannual-row-source-curmin
          if (sweepRefusesAnnual(row.source, curMin, nextMin, nextPer)) continue;
          const key = `${nextMin ?? ""}|${nextMax ?? ""}|${nextPer ?? ""}|${nextCur ?? ""}`;
          const g = groups.get(key) ?? { annualMin: nextMin, annualMax: nextMax, period: nextPer, currency: nextCur, ids: [] };
          g.ids.push(row.id);
          groups.set(key, g);
        }
        if (!rows || rows.length < 1000) { cursor = ""; break; }
        cursor = rows[rows.length - 1].id as string;
      }
      let updated = 0;
      for (const g of groups.values()) {
        for (let i = 0; i < g.ids.length; i += 200) {
          const { error } = await client.from("job_board_postings")
            .update({ salary_min_annual: g.annualMin, salary_max_annual: g.annualMax, salary_period: g.period, salary_currency: g.currency })
            .in("id", g.ids.slice(i, i + 200));
          if (error) throw error;
          updated += Math.min(200, g.ids.length - i);
        }
      }
      for (const m of remined) {
        const { error } = await client.from("job_board_postings").update(m.fields).eq("id", m.id);
        if (error) throw error;
        updated++;
      }
      if (cursor) {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill-salary", chainKey: key, cursor }),
        })).then((r) => discardBody(r)).catch(() => {}));
        return json({ ok: true, scanned, updated, nextCursor: cursor });
      }
      await client.from("job_board_meta").upsert(
        { k: "salary_parse_version", v: { version: SALARY_PARSE_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] salary backfill complete: ${scanned} scanned, ${updated} parsed (v${SALARY_PARSE_VERSION})`);
      return json({ ok: true, scanned, updated, done: true });
    }

    if (action === "refresh") {
      const hop = Number.isFinite(Number(body.chain)) ? Math.max(0, Number(body.chain)) : 0;
      const keyOk = typeof body.chainKey === "string" && body.chainKey === await chainKey();
      // Rationale: docs/job-board-index-notes.md#n770-if-body-resetcataloghighwater-true
      if (body.resetCatalogHighwater === true) {
        if (!keyOk) return json({ error: "resetCatalogHighwater is a maintenance action" }, 403);
        await client.from("job_board_meta").upsert(
          { k: "catalog_highwater", v: { size: JOB_SOURCES.length, at: new Date().toISOString(), reset: true }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        return json({ ok: true, detail: `catalog high-water reset to ${JOB_SOURCES.length}` });
      }
      const force = body.force === true && keyOk;
      // Clamped on the way in: the budget arrives over the wire from a sibling
      // isolate, and an unbounded one would undo the bound entirely.
      const boards = Number.isFinite(Number(body.boards))
        ? Math.min(MAX_BOARDS_PER_SLICE, Math.max(MIN_BOARDS_PER_SLICE, Math.floor(Number(body.boards))))
        : MIN_BOARDS_PER_SLICE;
      const r = await runRefresh(client, force, force ? hop : 0, force ? boards : MIN_BOARDS_PER_SLICE);
      return json(r, r.ok ? 200 : 502);
    }

    // Rationale: docs/job-board-index-notes.md#n1209-if-action-facets
    if (action === "facets") {
      const { data: fRow } = await client
        .from("job_board_meta").select("v").eq("k", "refresh_head").maybeSingle();
      const fv = ((fRow?.v ?? null) as Record<string, unknown> | null);
      if (!fv) return json({ categories: undefined, refreshedAt: null }, 200);
      return json({
        categories: visibleCategories(fv.categoriesFacet as Record<string, number> | undefined, true, null),
        refreshedAt: (fv.refreshedAt as string) ?? null,
        // Rationale: docs/job-board-index-notes.md#n771-fv-facetscarried-facetscarried-true-face
        ...(fv.facetsCarried ? { facetsCarried: true, facetsCarriedAt: (fv.facetsCarriedAt as string) ?? null } : {}),
        totalAllCompanies: ((fv.coverage as { open?: number } | undefined)?.open ?? null),
        // Rationale: docs/job-board-index-notes.md#n237-sources-fv-sourcesfacet-typeof-fv-sourcesfa
        sources: (fv.sourcesFacet && typeof fv.sourcesFacet === "object" && !Array.isArray(fv.sourcesFacet))
          ? (fv.sourcesFacet as Record<string, number>)
          : null,
        sourcesAt: (fv.refreshedAt as string) ?? null,
      }, 200);
    }

    if (action === "list") {
      // Rationale: docs/job-board-index-notes.md#n238-t-entry
      const t_entry = Date.now();
      // An employer asked for by NAME resolves to its boards, or is named as
      // unresolved with candidates (company-names.ts); only a name costs a read.
      let named: CompanyScope | null = null;
      const askedNames = askedByName(body, CATALOGUE_TOKENS);
      if (askedNames) {
        named = resolveCompanyNames(askedNames, CATALOGUE_TOKENS, await suggestEmployers(client));
        if (named.resolved.length || named.unresolved.length || named.skipped.length) body = { ...body, companies: named.companies };
        // Every name refused and nothing else asked: the empty scope, never the whole board. A value no
        // token could be (a space, a quote) is a refused filter value, named as normalizeFilters names it.
        if ((named.unresolved.length || named.skipped.length) && !named.companies.length) {
          const notToken = named.skipped.length > 0 || named.unresolved.some((u) => !COMPANY_TOKEN_SHAPE.test(u.asked));
          return json({ ...uncarriedListReply(named.unresolved.map((u) => u.asked)), ...companyNameNotes(named), ...(notToken ? { ignoredFilters: ["companies"] } : {}) });
        }
      }
      // An employer scope the catalogue does not carry is named, never read
      // as an employer with no openings (uncarried.ts, sweep S11-020).
      const uncarried = uncarriedCompanies(normalizeFilters(body, JOB_SOURCES.length).applied.companies, CATALOGUE_TOKENS);
      if (uncarried) return json({ ...uncarriedListReply(uncarried), ...(named ? companyNameNotes(named) : {}) });
      // Rationale: docs/job-board-index-notes.md#n239-meta-deadline-ms
      const META_DEADLINE_MS = 3_000;
      const t_meta = Date.now();
      // Rationale: docs/job-board-index-notes.md#n772-const-meta_timeout-symbol-meta-timeout
      const META_TIMEOUT = Symbol("meta-timeout");
      // Rationale: docs/job-board-index-notes.md#n773-const-racemeta-async-q-promiselike-data
      const raceMeta = async (q: PromiseLike<{ data: unknown; error?: unknown }>): Promise<{ data: unknown } | typeof META_TIMEOUT> =>
        await Promise.race([
          Promise.resolve(q).then(
            (r): { data: unknown } | typeof META_TIMEOUT =>
              ((r as { error?: unknown }).error ? META_TIMEOUT : (r as { data: unknown })),
            (): typeof META_TIMEOUT => META_TIMEOUT,
          ),
          new Promise<typeof META_TIMEOUT>((res) =>
            setTimeout(() => res(META_TIMEOUT), Math.max(150, META_DEADLINE_MS - (Date.now() - t_meta)))
          ),
        ]);

      let metaTimedOut = false;
      const headRes = await raceMeta(
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_head").maybeSingle(),
      );
      if (headRes === META_TIMEOUT) metaTimedOut = true;
      const headRow = headRes === META_TIMEOUT
        ? null
        : (headRes.data as { v: Record<string, unknown>; updated_at: string } | null);
      let meta = (headRow && typeof (headRow.v as Record<string, unknown> | null)?.companiesCount === "number"
        ? headRow
        : null) as { v: Record<string, unknown>; updated_at: string } | null;
      if (!meta && !metaTimedOut) {
        // Rationale: docs/job-board-index-notes.md#n774-const-fatres-await-racemeta
        const fatRes = await raceMeta(
          client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle(),
        );
        if (fatRes === META_TIMEOUT) metaTimedOut = true;
        meta = (fatRes === META_TIMEOUT
          ? null
          : (fatRes.data ?? null)) as { v: Record<string, unknown>; updated_at: string } | null;
      }
      const preMs: Record<string, number> = { meta_read: Date.now() - t_meta };

      // Rationale: docs/job-board-index-notes.md#n775-body-caller-resolvecaller-req-body-undef
      body.caller = resolveCaller(req, body) ?? undefined;
      // Rationale: docs/job-board-index-notes.md#n776-body-nolog-body-nolog-true-await
      body.noLog = body.noLog === true && (await exemptKind(req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")) === "reader" ? true : undefined;
      // .88: no more rows a call than the page holds -- 60, whatever limit is
      // sent, for anyone without a secret (anon-budget.ts pageCeiling).
      const rowCap = await pageCeiling(req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
      if (Number(body.limit) > rowCap) body.limit = rowCap;
      // S12-122: no raw offset past ANON_OFFSET_CEILING without a secret (anon-budget.ts offsetCeiling).
      if (Number(body.offset) > await offsetCeiling(req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")) {
        return json({
          error: "offset_too_deep",
          maxOffset: ANON_OFFSET_CEILING,
          message: `Pages past the first ${ANON_OFFSET_CEILING.toLocaleString("en-US")} results are not served by offset: narrow the search, or page on with the nextCursor a browse response carries.`,
        }, 400);
      }

      if (!meta) {
        // Rationale: docs/job-board-index-notes.md#n240-metatimedout-waituntil-runrefresh-clie
        if (!metaTimedOut) waitUntil(runRefresh(client, true));
        else console.warn(`[JOB-BOARD] meta read expired after ${Date.now() - t_meta}ms — serving without the headline, NOT seeding`);
        return withCompanyNames(await serveList(client, body, undefined, t_entry, preMs), named);
      }
      if (Date.now() - new Date(meta.updated_at).getTime() > STALE_MS) {
        waitUntil(runRefresh(client)); // serve stale, refresh behind the scenes
      }
      return withCompanyNames(await serveList(client, body, meta, t_entry, preMs), named);
    }

    if (action === "fit-terms") {
      // Rationale: docs/job-board-index-notes.md#n241-resumetext
      const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";
      if (resumeText.trim().length < 100) {
        return json({ error: "resumeText (100+ chars) is required" }, 400);
      }
      // An empty list is a real answer — "no occupation I recognise" — and the
      // caller keeps browsing normally rather than being shown zero results.
      return json({ terms: resumeRoleTerms(resumeText, 4) });
    }

    // Rationale: docs/job-board-index-notes.md#n777-if-action-fit-batch
    if (action === "fit-batch") {
      const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";
      // Rationale: docs/job-board-index-notes.md#n778-const-ids-array-isarray-body-ids
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, FIT_BATCH_MAX) : [];
      if (resumeText.trim().length < 100 || ids.length === 0) {
        return json({ error: "resumeText (100+ chars) and ids are required" }, 400);
      }
      // Deterministic compute, but still rate-limited -- on the platform's
      // address (.88), never the first forwarded hop, which the caller writes.
      if (!(await addressAllowance((n, a) => client.rpc(n, a), req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", "job-board-fit", FIT_PER_ADDRESS_HOUR))) {
        return json({ error: "Fit-ranking limit reached for now; try again within the hour.", rateLimited: true }, 429);
      }

      const { data: rows, error } = await client
        .from("job_board_postings")
        .select("id, description, min_years")
        .in("id", ids);
      if (error) throw error;
      const fits: Record<string, number | null> = {};
      // Top missing keywords per posting — the "add these to compete" signal
      // that turns a bare score into an actionable one on each card.
      const missing: Record<string, string[]> = {};
      // Top MATCHED keywords — the "why you fit" half, so the score is explainable
      // ("you already have: React, TypeScript") not just a bare number.
      const matched: Record<string, string[]> = {};
      let scored = 0;
      // Rationale: docs/job-board-index-notes.md#n779-const-resumescan-scanresume-resumetext
      const resumeScan = scanResume(resumeText);
      for (const r of rows ?? []) {
        if (r.description && r.description.length > 150) {
          // Rationale: docs/job-board-index-notes.md#n242-minyears
          const minYears = typeof (r as { min_years?: unknown }).min_years === "number" ? (r as { min_years: number }).min_years : null;
          const f = computeFit(r.description.slice(0, FIT_DESC_CHARS), resumeScan, 40, minYears);
          fits[r.id] = f.pct;
          if (f.missing.length > 0) missing[r.id] = f.missing.slice(0, 4);
          if (f.matched.length > 0) matched[r.id] = f.matched.slice(0, 6);
          scored++;
        } else {
          fits[r.id] = null; // no stored description — honest null
        }
      }
      return json({ fits, missing, matched, scored, of: ids.length });
    }

    if (action === "backfill-desc") {
      // Rationale: docs/job-board-index-notes.md#n243-typeof-body-chainkey-string-bod
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-desc is a maintenance action" }, 403);
      }
      await loadDynamicLight(client); // fresh invocation — auto-enrolled boards need their descs filled too
      // Rationale: docs/job-board-index-notes.md#n780-const-boards-descbackfillboards
      const BOARDS = descBackfillBoards();
      const PER_HOP = 50; // small per-job fetches; keeps each invocation light
      let ti = Math.max(0, Number(body.ti) || 0);
      // Touch meta each hop so the 24h staleness trigger can't spawn an
      // overlapping sweep while this one is chaining.
      await client.from("job_board_meta").upsert(
        { k: "desc_backfill", v: { runningTi: ti }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      if (ti >= BOARDS.length) {
        // Rationale: docs/job-board-index-notes.md#n781-let-remaining
        let remaining = 0;
        for (const b of BOARDS) {
          const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).eq("company_token", b.token).eq("source", b.source).is("description", null);
          remaining += count ?? 0;
        }
        const incomplete = remaining > 50;
        await client.from("job_board_meta").upsert(
          { k: "desc_backfill", v: incomplete ? { incompleteAt: new Date().toISOString(), remaining } : { doneAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        return json({ ok: true, done: true, remaining });
      }
      const s = BOARDS[ti];
      // Next PER_HOP postings for this board that still lack a description.
      const { data: rows, error: readErr } = await client
        .from("job_board_postings")
        // Rationale: docs/job-board-index-notes.md#n782-select-id-country-title
        .select("id, country, title")
        .eq("company_token", s.token)
        .eq("source", s.source)
        .is("description", null)
        .order("id")
        .limit(PER_HOP);
      if (readErr) throw readErr;
      let updated = 0;
      const clean = (x: string) => x.replace(/\u0000/g, "");
      for (const row of rows ?? []) {
        const ghId = String(row.id).split(":")[2] ?? "";
        if (!ghId) continue;
        try {
          const gh = greenhouseApi(s.token); // eu~ boards live on a different host under a stripped token
          const res = await fetchWithTimeout(`https://${gh.host}/v1/boards/${gh.token}/jobs/${ghId}?questions=false`);
          if (!res.ok) continue;
          const job = (await res.json()) as { content?: string };
          const text = job.content ? clean(htmlToText(String(job.content).slice(0, RAW_HTML_CAP)).trim()).slice(0, STORED_DESC_CAP) : "";
          if (text) {
            // Rationale: docs/job-board-index-notes.md#n783-const-minedsalary-extractsalary-text
            const minedSalary = extractSalary(text);
            const minedParse = minedSalary ? parseSalaryStructured(minedSalary, (row as { country?: string | null }).country ?? undefined, { title: (row as { title?: string | null }).title ?? null, description: text }) : null;
            const { error } = await client.from("job_board_postings")
              .update({
                description: text,
                ...(minedSalary ? {
                  salary: minedSalary,
                  salary_min_annual: minedParse?.annualMin ?? null,
                  salary_max_annual: minedParse?.annualMax ?? null,
                  salary_period: minedParse?.period ?? null,
                  salary_currency: minedParse?.currency ?? null,
                } : {}),
              })
              .eq("id", row.id);
            if (!error) updated++;
          }
        } catch { /* transient — row stays null, retried next run */ }
      }
      // Rationale: docs/job-board-index-notes.md#n784-if-rows-rows-length-per_hop-updated
      if (!rows || rows.length < PER_HOP || updated === 0) ti += 1;
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-desc", chainKey: key, ti }),
      })).then((rr) => discardBody(rr)).catch(() => {}));
      return json({ ok: true, board: s.token, updated, remaining: (rows ?? []).length === PER_HOP ? "more" : "board-done", nextTi: ti });
    }

    if (action === "embed-sweep") {
      // Rationale: docs/job-board-index-notes.md#n785-if-typeof-body-chainkey-string-body
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "embed-sweep is a maintenance action" }, 403);
      }
      // Liveness restamp; resume is data-driven (embedded rows leave the batch).
      await client.from("job_board_meta").upsert(
        { k: "embed_sweep", v: { at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      // Rationale: docs/job-board-index-notes.md#n244-const-data-seedmeta-await-client-from-jo
      const { data: seedMeta } = await client.from("job_board_meta").select("v").eq("k", "embed_seed").maybeSingle();
      const seedV = (seedMeta?.v ?? {}) as { cursor?: string; done?: boolean };
      let seeded = 0;
      if (!seedV.done) {
        try {
          const { data: cand } = await client
            .from("job_board_postings")
            .select("id, effective_posted")
            .gt("id", seedV.cursor ?? "")
            .order("id", { ascending: true })
            .limit(1_000);
          const ids = (cand ?? []).map((r) => String(r.id));
          if (ids.length === 0) {
            await client.from("job_board_meta").upsert(
              { k: "embed_seed", v: { done: true, doneAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
              { onConflict: "k" },
            );
          } else {
            const { data: have } = await client.from("job_board_embeddings").select("id").in("id", ids);
            const haveSet = new Set((have ?? []).map((r) => String(r.id)));
            const missing = (cand ?? []).filter((r) => !haveSet.has(String(r.id)));
            if (missing.length > 0) {
              const { error: insErr } = await client.from("job_board_embeddings").upsert(
                missing.map((r) => ({ id: String(r.id), embedding: null, embedded_desc: false, updated_at: (r.effective_posted as string | null) ?? new Date().toISOString() })),
                { onConflict: "id", ignoreDuplicates: true },
              );
              if (!insErr) seeded = missing.length;
              // Rationale: docs/job-board-index-notes.md#n786-if-inserr-console-warn-job-board
              if (insErr) console.warn(`[JOB-BOARD] embed seed insert failed: ${insErr.message?.slice(0, 100)}`);
            }
            if (!(missing.length > 0) || seeded > 0) {
              await client.from("job_board_meta").upsert(
                { k: "embed_seed", v: { cursor: ids[ids.length - 1] }, updated_at: new Date().toISOString() },
                { onConflict: "k" },
              );
            }
          }
        } catch { /* seeding is best-effort; the embed batch below still runs */ }
      }

      const { data: batch, error: bErr } = await client.rpc("get_embed_batch", { p_limit: EMBED_PER_HOP });
      if (bErr) {
        // Rationale: docs/job-board-index-notes.md#n787-if-seedv-done-seeded
        if (!seedV.done && seeded > 0) {
          const url0 = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
          waitUntil(new Promise((r) => setTimeout(r, EMBED_HOP_PAUSE_MS))
            .then(() => chainKey())
            .then((key) => fetch(url0, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "embed-sweep", chainKey: key }),
            })).then((rr) => discardBody(rr)).catch(() => {}));
          return json({ ok: true, seeding: true, seeded });
        }
        await client.from("job_board_meta").upsert(
          { k: "embed_sweep", v: { doneAt: new Date().toISOString(), note: `batch error: ${bErr.message?.slice(0, 80)}` }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        return json({ ok: false, error: "get_embed_batch unavailable" });
      }
      const rows = (batch ?? []) as Array<{ id: string; title: string | null; company: string | null; location: string | null; descr: string | null; has_desc: boolean }>;
      if (rows.length === 0) {
        // Same guard on the empty path: an empty batch during seeding just
        // means the queue hasn't caught up to the picker yet.
        if (!seedV.done && seeded > 0) {
          const url0 = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
          waitUntil(new Promise((r) => setTimeout(r, EMBED_HOP_PAUSE_MS))
            .then(() => chainKey())
            .then((key) => fetch(url0, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "embed-sweep", chainKey: key }),
            })).then((rr) => discardBody(rr)).catch(() => {}));
          return json({ ok: true, seeding: true, seeded });
        }
        await client.from("job_board_meta").upsert(
          { k: "embed_sweep", v: { doneAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        return json({ ok: true, done: true });
      }
      let embedded = 0;
      const hopStart = Date.now();
      for (const r of rows) {
        // Rationale: docs/job-board-index-notes.md#n788-if-date-now-hopstart-embed_hop_wall_ms-b
        if (Date.now() - hopStart > EMBED_HOP_WALL_MS) break;
        const input = buildEmbedInput(r.title, r.company, r.location, r.descr);
        if (!input) continue;
        const vec = await embedText(input);
        if (!vec) continue; // inference unavailable/failed — row retried next batch
        const { error: uErr } = await client.from("job_board_embeddings").upsert(
          // pgvector accepts the bracketed text form; PostgREST casts on write.
          { id: r.id, embedding: JSON.stringify(vec), embedded_desc: r.has_desc === true, updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );
        if (!uErr) embedded++;
      }
      // Zero embedded from a non-empty batch means inference is unavailable in
      // this runtime — settle instead of chaining a no-op loop forever.
      if (embedded === 0) {
        await client.from("job_board_meta").upsert(
          { k: "embed_sweep", v: { doneAt: new Date().toISOString(), note: "inference unavailable" }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        return json({ ok: false, embedded: 0, note: "inference unavailable" });
      }
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      // Rationale: docs/job-board-index-notes.md#n789-waituntil-new-promise-r-settimeout-r
      waitUntil(new Promise((r) => setTimeout(r, EMBED_HOP_PAUSE_MS))
        .then(() => chainKey())
        .then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "embed-sweep", chainKey: key }),
        })).then((rr) => discardBody(rr)).catch(() => {}));
      return json({ ok: true, embedded, batch: rows.length });
    }

    if (action === "backfill-country") {
      // Rationale: docs/job-board-index-notes.md#n790-if-typeof-body-chainkey-string-body
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-country is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      // Liveness restamp every invocation; cursor lets a dead chain resume.
      await client.from("job_board_meta").upsert(
        { k: "country_backfill", v: { cursor, mapVersion: COUNTRY_MAP_VERSION, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      const PAGES = 4;
      let scanned = 0, updated = 0;
      for (let page = 0; page < PAGES; page++) {
        let q = client.from("job_board_postings")
          .select("id,location")
          .is("country", null)
          .order("id")
          .limit(2000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        const byCountry = new Map<string, string[]>();
        for (const r of rows ?? []) {
          scanned++;
          const c = detectCountry(r.location as string | null);
          if (c) {
            if (!byCountry.has(c)) byCountry.set(c, []);
            byCountry.get(c)!.push(r.id as string);
          }
        }
        for (const [c, ids] of byCountry) {
          for (let i = 0; i < ids.length; i += 200) {
            const { error: uErr } = await client.from("job_board_postings").update({ country: c }).in("id", ids.slice(i, i + 200));
            if (!uErr) updated += Math.min(200, ids.length - i);
          }
        }
        if (!rows || rows.length < 2000) { cursor = ""; break; }
        cursor = rows[rows.length - 1].id as string;
      }
      if (cursor) {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill-country", chainKey: key, cursor }),
        })).then((rr) => discardBody(rr)).catch(() => {}));
        return json({ ok: true, scanned, updated, nextCursor: cursor });
      }
      await client.from("job_board_meta").upsert(
        { k: "country_backfill", v: { doneAt: new Date().toISOString(), mapVersion: COUNTRY_MAP_VERSION }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      // Rationale: docs/job-board-index-notes.md#n791-await-client-from-job_board_meta-upsert
      await client.from("job_board_meta").upsert(
        { k: "country_version", v: { version: COUNTRY_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] country backfill complete: ${scanned} scanned, ${updated} filled (map v${COUNTRY_MAP_VERSION})`);
      return json({ ok: true, scanned, updated, done: true });
    }

    if (action === "desc-sweep") {
      // Rationale: docs/job-board-index-notes.md#n245-typeof-body-chainkey-string-bod
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "desc-sweep is a maintenance action" }, 403);
      }
      let vi = Math.max(0, Number(body.vi) || 0);
      const vstart = Math.max(0, Number(body.vstart) || 0) % DETAIL_DESC_SOURCES.length;
      // Rationale: docs/job-board-index-notes.md#n792-const-desccursor-typeof-body-cursor-stri
      const descCursor = typeof body.cursor === "string" && body.cursor ? body.cursor : null;
      if (vi >= DETAIL_DESC_SOURCES.length) {
        // Rationale: docs/job-board-index-notes.md#n793-const-boards-job_sources-filter-s-board_
        const BOARDS = JOB_SOURCES.filter((s) => (BOARD_DESC_SOURCES as readonly string[]).includes(s.source));
        let bi = Math.max(0, Number(body.bi) || 0);
        if (bi >= BOARDS.length) {
          await client.from("job_board_meta").upsert(
            { k: "desc_sweep", v: { doneAt: new Date().toISOString(), nextStartVi: (vstart + 1) % DETAIL_DESC_SOURCES.length }, updated_at: new Date().toISOString() },
            { onConflict: "k" },
          );
          return json({ ok: true, done: true });
        }
        const b = BOARDS[bi];
        await client.from("job_board_meta").upsert(
          { k: "desc_sweep", v: { phase: "boards", bi, token: b.token }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        // Rationale: docs/job-board-index-notes.md#n794-const-data-nullrows-await-client
        const { data: nullRows } = await client
          .from("job_board_postings")
          .select("id, country, title") // country → correct bare-$ currency (see backfill-desc)
          .eq("company_token", b.token)
          .is("description", null)
          .limit(DESC_SWEEP_PER_HOP);
        let filled = 0;
        if ((nullRows ?? []).length > 0) {
          try {
            const r = await fetchBoard(b);
            if (r) {
              const map = listPayloadDescriptions(b, r.raw);
              for (const row of nullRows ?? []) {
                const text = map.get(String(row.id));
                if (!text) continue;
                const clean = text.replace(/\u0000/g, "").slice(0, STORED_DESC_CAP);
                if (!clean) continue;
                const minedSalary = extractSalary(clean);
                const minedParse = minedSalary ? parseSalaryStructured(minedSalary, (row as { country?: string | null }).country ?? undefined, { title: (row as { title?: string | null }).title ?? null, description: clean }) : null;
                const { error } = await client.from("job_board_postings")
                  .update({
                    description: clean,
                    ...(minedSalary ? {
                      salary: minedSalary,
                      salary_min_annual: minedParse?.annualMin ?? null,
                      salary_max_annual: minedParse?.annualMax ?? null,
                      salary_period: minedParse?.period ?? null,
                      salary_currency: minedParse?.currency ?? null,
                    } : {}),
                  })
                  .eq("id", row.id)
                  .is("description", null);
                if (!error) filled++;
              }
            }
          } catch { /* transient — rows stay null and are retried next sweep */ }
        }
        // Always advance: a board whose feed is down must not stall the lane.
        bi += 1;
        const bUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(bUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "desc-sweep", chainKey: key, vi, bi, vstart }),
        })).then((rr) => discardBody(rr)).catch(() => {}));
        return json({ ok: true, phase: "boards", token: b.token, filled, nextBi: bi });
      }
      const vendor = DETAIL_DESC_SOURCES[vi];
      await client.from("job_board_meta").upsert(
        { k: "desc_sweep", v: { runningVi: vi, vendor, cursor: descCursor }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      // Rationale: docs/job-board-index-notes.md#n246-sel
      let sel = client
        .from("job_board_postings")
        // Rationale: docs/job-board-index-notes.md#n795-select-id-source-company_token-apply_url
        .select("id, source, company_token, apply_url, title, location, country, posted_at, work_mode, first_seen, salary")
        .in("source", [...DETAIL_DESC_SOURCES])
        .is("description", null)
        .is("missing_since", null);
      if (descCursor) sel = sel.lt("first_seen", descCursor);
      const { data: rows, error: readErr } = await sel
        .order("first_seen", { ascending: false, nullsFirst: false })
        .limit(DESC_SWEEP_PER_HOP);
      if (readErr) throw readErr;
      const queue = [...(rows ?? [])] as Array<{
        id: string; source: string; company_token: string; apply_url: string | null;
        title: string | null; location: string | null; posted_at: string | null; work_mode: string | null; first_seen: string | null;
        country: string | null; salary: string | null;
      }>;
      const pending = [...queue];
      let updated = 0;
      await Promise.all(Array.from({ length: DESC_SWEEP_CONCURRENCY }, async () => {
        for (;;) {
          const row = pending.shift();
          if (!row) return;
          const src = JOB_SOURCES.find((s) => s.source === row.source && s.token === row.company_token);
          if (!src) continue; // board left the catalog — leave the row alone
          const externalId = String(row.id).split(":").slice(2).join(":");
          if (!externalId) continue;
          try {
            const { text, postedAt, workMode: wmVendor, country: vCountry, location: vLocation, additionalSites, pay: vendorPay } =
              await fetchVendorDetail(src, row.id, externalId, row.apply_url);
            // Rationale: docs/job-board-index-notes.md#n796-const-placepatch-placewrite-row-vcountry
            const placePatch = placeWrite(row, vCountry, vLocation, additionalSites);
            if (!text) {
              // Rationale: docs/job-board-index-notes.md#n247-salv
              const salv: Record<string, unknown> = { ...placePatch };
              if (wmVendor && row.work_mode === null) { salv.work_mode = wmVendor; salv.remote = wmVendor === "remote"; }
              if (postedAt && (row.source === "workday" || !row.posted_at)) salv.posted_at = postedAt;
              // Rationale: docs/job-board-index-notes.md#n248-vendorpay-row-salary
              if (vendorPay && !row.salary) {
                const salvParse = parseSalaryStructured(vendorPay, (placePatch.country as string | null) ?? row.country, { title: row.title ?? null, description: null });
                salv.salary = vendorPay;
                salv.salary_min_annual = salvParse?.annualMin ?? null;
                salv.salary_max_annual = salvParse?.annualMax ?? null;
                salv.salary_period = salvParse?.period ?? null;
                salv.salary_currency = salvParse?.currency ?? null;
              }
              if (Object.keys(salv).length) {
                // Rationale: docs/job-board-index-notes.md#n797-const-q0-client-from-job_board_postings
                const q0 = client.from("job_board_postings").update(salv).eq("id", row.id);
                const q = salv.salary ? q0.is("salary", null) : q0;
                await (salv.work_mode ? q.is("work_mode", null) : q);
              }
              continue;
            }
            const clean = text.replace(/\u0000/g, "").slice(0, STORED_DESC_CAP);
            if (!clean) continue;
            // Rationale: docs/job-board-index-notes.md#n798-const-minedsalary-extractsalary-clean
            const minedSalary = extractSalary(clean);
            // Rationale: docs/job-board-index-notes.md#n249-salarycountry
            const salaryCountry = (placePatch.country as string | null) ?? (row as { country?: string | null }).country;
            // Rationale: docs/job-board-index-notes.md#n250-statedpay
            const statedPay = minedSalary ?? (row.salary ? null : vendorPay);
            // Rationale: docs/job-board-index-notes.md#n251-statedparse
            const statedParse = statedPay ? parseSalaryStructured(statedPay, salaryCountry, { title: (row as { title?: string | null }).title ?? null, description: clean }) : null;
            // Rationale: docs/job-board-index-notes.md#n799-const-exp-detectexperience-row-title-cle
            const exp = detectExperience(row.title ?? "", clean);
            // Rationale: docs/job-board-index-notes.md#n252-wm
            const wm = wmVendor ?? (row.work_mode ? null : detectWorkMode(row.location, row.title));
            // Rationale: docs/job-board-index-notes.md#n800-const-betterdate-postedat-row-source-wor
            const betterDate = postedAt && (row.source === "workday" || !row.posted_at) ? postedAt : null;
            const { error } = await client.from("job_board_postings")
              .update({
                description: clean,
                ...placePatch,
                ...(exp.band ? { experience_band: exp.band, min_years: exp.minYears } : {}),
                // Rationale: docs/job-board-index-notes.md#n253-wm-work-mode-wm-remote-wm-remote
                ...(wm ? { work_mode: wm, remote: wm === "remote" } : {}),
                ...(betterDate ? { posted_at: betterDate } : {}),
                ...(statedPay ? {
                  salary: statedPay,
                  salary_min_annual: statedParse?.annualMin ?? null,
                  salary_max_annual: statedParse?.annualMax ?? null,
                  salary_period: statedParse?.period ?? null,
                  salary_currency: statedParse?.currency ?? null,
                } : {}),
              })
              .eq("id", row.id)
              .is("description", null); // never clobber a description a reader already stored
            if (!error) updated++;
          } catch { /* transient — the row stays null and is retried next sweep */ }
        }
      }));
      // Rationale: docs/job-board-index-notes.md#n801-const-exhausted-queue-length-desc_sweep_
      const exhausted = queue.length < DESC_SWEEP_PER_HOP;
      const nextCursor = exhausted ? null : (queue[queue.length - 1]?.first_seen ?? null);
      if (exhausted) {
        // Rationale: docs/job-board-index-notes.md#n802-const-next-vi-detail_desc_sources-length
        const next = (vi + 1) % DETAIL_DESC_SOURCES.length;
        vi = next === vstart ? DETAIL_DESC_SOURCES.length : next;
      }
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "desc-sweep", chainKey: key, vi, vstart, ...(nextCursor ? { cursor: nextCursor } : {}) }),
      })).then((rr) => discardBody(rr)).catch(() => {}));
      return json({ ok: true, vendor, scanned: queue.length, updated, nextVi: vi, cursor: nextCursor });
    }

    if (action === "structured-sweep") {
      // Rationale: docs/job-board-index-notes.md#n254-typeof-body-chainkey-string-bod
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "structured-sweep is a maintenance action" }, 403);
      }
      let vi = Math.max(0, Number(body.vi) || 0);
      // Rationale: docs/job-board-index-notes.md#n255-passscanned
      const passScanned = Math.max(0, Number(body.passScanned) || 0);
      const passFilled = Math.max(0, Number(body.passFilled) || 0);
      if (vi >= STRUCTURED_SWEEP_SOURCES.length) {
        // Rationale: docs/job-board-index-notes.md#n256-prevzero
        const prevZero = ((await client.from("job_board_meta").select("v").eq("k", "structured_sweep").maybeSingle())
          .data?.v as { zeroFilledPasses?: number } | null)?.zeroFilledPasses ?? 0;
        await client.from("job_board_meta").upsert(
          {
            k: "structured_sweep",
            v: {
              doneAt: new Date().toISOString(),
              scanned: passScanned, filled: passFilled,
              lastVendor: STRUCTURED_SWEEP_SOURCES[STRUCTURED_SWEEP_SOURCES.length - 1] ?? null,
              lastCursor: typeof body.cursor === "string" ? body.cursor : null,
              zeroFilledPasses: passFilled > 0 ? 0 : prevZero + 1,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "k" },
        );
        return json({ ok: true, done: true, scanned: passScanned, filled: passFilled });
      }
      const sVendor = STRUCTURED_SWEEP_SOURCES[vi];
      // Rationale: docs/job-board-index-notes.md#n257-cursor
      const cursor = String(body.cursor ?? "") || `${sVendor}:`;
      // Rationale: docs/job-board-index-notes.md#n803-await-client-from-job_board_meta-upsert
      await client.from("job_board_meta").upsert(
        { k: "structured_sweep", v: { vendor: sVendor, running: true, cursor, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      // Rationale: docs/job-board-index-notes.md#n804-let-sel-client
      let sel = client
        .from("job_board_postings")
        .select("id, company_token, apply_url, posted_at, work_mode, location, country")
        .eq("source", sVendor)
        .not("description", "is", null)
        .is("work_mode", null)
        .order("id", { ascending: true })
        // Rationale: docs/job-board-index-notes.md#n258-lt-id-svendor
        .lt("id", `${sVendor}~`)
        .limit(STRUCTURED_SWEEP_PER_HOP);
      if (cursor) sel = sel.gt("id", cursor);
      const { data: sRows, error: sErr } = await sel;
      if (sErr) throw sErr;
      const sQueue = [...(sRows ?? [])] as Array<{
        id: string; company_token: string; apply_url: string | null;
        posted_at: string | null; work_mode: string | null; location: string | null; country: string | null;
      }>;
      const sPending = [...sQueue];
      let sFilled = 0;
      let sSeen = 0;
      await Promise.all(Array.from({ length: DESC_SWEEP_CONCURRENCY }, async () => {
        for (;;) {
          const row = sPending.shift();
          if (!row) return;
          sSeen++;
          const src = JOB_SOURCES.find((s) => s.source === sVendor && s.token === row.company_token);
          if (!src) continue;
          const externalId = String(row.id).split(":").slice(2).join(":");
          if (!externalId) continue;
          try {
            const { postedAt, workMode, country: vCountry, location: vLocation, additionalSites } =
              await fetchVendorDetail(src, row.id, externalId, row.apply_url);
            // Rationale: docs/job-board-index-notes.md#n805-const-patch-record-string-unknown
            const patch: Record<string, unknown> = {};
            // Rationale: docs/job-board-index-notes.md#n806-if-workmode-patch-work_mode-workmode-pat
            if (workMode) { patch.work_mode = workMode; patch.remote = workMode === "remote"; }
            // Rationale: docs/job-board-index-notes.md#n807-if-postedat-row-posted_at-patch-posted_a
            if (postedAt && !row.posted_at) patch.posted_at = postedAt;
            // Rationale: docs/job-board-index-notes.md#n259-object-assign-patch-placewrite-row-vcountry-v
            Object.assign(patch, placeWrite(row, vCountry, vLocation, additionalSites));
            if (!Object.keys(patch).length) continue;
            // Rationale: docs/job-board-index-notes.md#n260-upd
            const upd = client.from("job_board_postings").update(patch).eq("id", row.id);
            const { data: wrote, error } = await (patch.work_mode ? upd.is("work_mode", null) : upd).select("id");
            if (!error) sFilled += (wrote?.length ?? 0);
          } catch { /* transient — the row keeps its place in the cursor order */ }
        }
      }));
      // Rationale: docs/job-board-index-notes.md#n808-const-nextcursor-squeue-length-squeue-sq
      const nextCursor = sQueue.length ? sQueue[sQueue.length - 1].id : "";
      const sDone = sQueue.length < STRUCTURED_SWEEP_PER_HOP;
      if (sDone) vi += 1;
      // Rationale: docs/job-board-index-notes.md#n809-const-cumscanned-passscanned-sseen
      const cumScanned = passScanned + sSeen;
      const cumFilled = passFilled + sFilled;
      await client.from("job_board_meta").upsert({
        k: "structured_sweep",
        v: {
          vendor: sVendor, cursor: sDone ? "" : nextCursor,
          scanned: cumScanned, filled: cumFilled, at: new Date().toISOString(),
          // Rationale: docs/job-board-index-notes.md#n810-firstid-squeue-id-null-lastid-nextcursor
          firstId: sQueue[0]?.id ?? null, lastId: nextCursor || null,
          pageLen: sQueue.length,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "k" });
      const sUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(sUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "structured-sweep", chainKey: key, vi,
          cursor: sDone ? "" : nextCursor,
          passScanned: cumScanned, passFilled: cumFilled,
        }),
      })).then((rr) => discardBody(rr)).catch(() => {}));
      return json({ ok: true, vendor: sVendor, scanned: cumScanned, filled: cumFilled, nextCursor: sDone ? "" : nextCursor, nextVi: vi });
    }

    if (action === "report") {
      // Rationale: docs/job-board-index-notes.md#n811-const-id-string-body-id-slice
      const id = String(body.id ?? "").slice(0, 200);
      const reason = String(body.reason ?? "");
      if (!id || !["gone", "misleading", "other"].includes(reason)) {
        return json({ error: "id and a valid reason are required" }, 400);
      }
      const note = String(body.note ?? "").replace(/\u0000/g, "").slice(0, 280);
      // .88: a person reports a handful; a loop must not fill the log.
      if (!(await addressAllowance((n, a) => client.rpc(n, a), req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", "job-board-report", REPORT_PER_ADDRESS_HOUR))) {
        return json({ error: "Too many reports from this address; try again within the hour.", rateLimited: true }, 429);
      }
      const { data: row } = await client.from("job_board_postings").select("id,company_token").eq("id", id).maybeSingle();
      const { error: repErr } = await client.from("job_board_posting_reports").insert({
        posting_id: id,
        company_token: (row?.company_token as string | undefined) ?? "",
        reason,
        note,
      });
      if (repErr) {
        console.warn("[JOB-BOARD] report insert failed:", repErr.message);
        return json({ error: "report could not be recorded" }, 500);
      }
      return json({ ok: true, known: !!row });
    }

    if (action === "click") {
      // Rationale: docs/job-board-index-notes.md#n261-postingid
      const postingId = String(body.postingId ?? "").slice(0, 200);
      if (!postingId) return json({ ok: false, reason: "postingId required" }, 400);
      const rawSid = String(body.searchId ?? "");
      // Rationale: docs/job-board-index-notes.md#n812-const-sid-a-f-a-f
      const sid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSid) ? rawSid : null;
      const posN = Number(body.position);
      // Rationale: docs/job-board-index-notes.md#n262-clickcore
      const clickCore = {
        search_id: sid,
        posting_id: postingId,
        q: String(body.q ?? "").slice(0, 200),
        position: Number.isFinite(posN) && posN > 0 ? Math.min(Math.trunc(posN), 100000) : null,
        kind: body.kind === "apply" ? "apply" : "open",
      };
      // Rationale: docs/job-board-index-notes.md#n813-const-clickstamps-promise-resolve
      const clickStamps = Promise.resolve(
        client
          .from("job_board_postings")
          .select("company_token, category, salary_min_annual")
          .eq("id", postingId)
          .maybeSingle(),
      ).then(({ data: p }) =>
        p
          ? {
            company_token: (p.company_token as string | null) ?? null,
            category: (p.category as string | null) ?? null,
            // Rationale: docs/job-board-index-notes.md#n263-salary-present-p-salary-min-annual-null
            salary_present: p.salary_min_annual != null,
          }
          : { company_token: null, category: null, salary_present: null }
      ).catch(() => ({ company_token: null, category: null, salary_present: null }));
      // .88: past an hour's allowance per address the beacon still answers,
      // and records nothing (abuse-guards.ts addressAllowance).
      const clickAllowed = addressAllowance((n, a) => client.rpc(n, a), req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", "job-board-click", CLICK_PER_ADDRESS_HOUR);
      waitUntil(Promise.all([clickStamps, clickAllowed]).then(([stamps, ok]) => !ok ? undefined :
        client.from("job_board_search_clicks").insert({
          ...clickCore,
          ...stamps,
        }).then(({ error }) => {
          if (!error) return;
          const msg = String(error.message ?? "");
          if (msg.includes("company_token") || msg.includes("salary_present") || msg.includes("category")) {
            return client.from("job_board_search_clicks").insert(clickCore).then(({ error: e2 }) => {
              if (e2) console.warn("[JOB-BOARD] click insert failed:", e2.message);
            });
          }
          console.warn("[JOB-BOARD] click insert failed:", error.message);
        })
      ).catch(() => {}));
      // Rationale: docs/job-board-index-notes.md#n814-return-json-ok-true
      return json({ ok: true });
    }

    if (action === "verify") {
      // Rationale: docs/job-board-index-notes.md#n815-const-ids-array-isarray-body-ids
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, VERIFY_MAX_IDS) : [];
      if (ids.length === 0) return json({ live: {} });
      // Its own allowance on top of the board meter, because a call fans out to
      // vendors. No answer is not a closure: both callers keep the posting.
      if (!(await addressAllowance((n, a) => client.rpc(n, a), req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", "job-board-verify", VERIFY_PER_ADDRESS_HOUR))) {
        return json({ error: "Too many live checks from this address; try again within the hour.", rateLimited: true }, 429);
      }
      // Rationale: docs/job-board-index-notes.md#n264-livemap
      const liveMap: Record<string, boolean | null> = {};
      const deadIds: string[] = [];
      const demandTokens = new Set<string>();
      liveBoardMemo.clear();
      // Rationale: docs/job-board-index-notes.md#n816-const-data-applyrows-await-client
      const { data: applyRows } = await client
        .from("job_board_postings").select("id, apply_url").in("id", ids);
      const applyBy = new Map((applyRows ?? []).map((r) => [String(r.id), (r.apply_url as string | null) ?? null]));
      for (const id of ids) {
        const [source, token, ...rest] = id.split(":");
        const externalId = rest.join(":");
        const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
        // A board we no longer catalogue was asked nothing, so nothing was
        // learned: undecidable, never dead (n418). The orphan prune owns it.
        if (!src || !externalId) { liveMap[id] = null; continue; }
        // Only a posting the board holds asks for its board: an id we never
        // stored is not a reader looking at that employer.
        if (applyBy.has(id)) demandTokens.add(src.token);
        const live = await checkLive(src, externalId, applyBy.get(id) ?? null);
        if (live === false) { liveMap[id] = false; deadIds.push(id); }
        else liveMap[id] = live; // true = confirmed at the source; null = undecidable (page-capped feed). Both keep showing; only one is a confirmation.
      }
      // Rationale: docs/job-board-index-notes.md#n265-deadids-length-0
      // Verify stamps and never deletes (n418): only the refresh, which writes the ledger, removes a row.
      if (deadIds.length > 0) {
        const { data: stamps } = await client
          .from("job_board_postings").select("id, missing_since").in("id", deadIds);
        const firstMiss = (stamps ?? []).filter((r) => !r.missing_since).map((r) => String(r.id));
        const stampIso = new Date().toISOString();
        for (let i = 0; i < firstMiss.length; i += 50) {
          await client.from("job_board_postings")
            .update({ missing_since: stampIso }).in("id", firstMiss.slice(i, i + 50));
        }
      }
      // Rationale: docs/job-board-index-notes.md#n817-if-demandtokens-size
      if (demandTokens.size > 0) {
        const demand = await readDemand(client);
        const next = admitDemand(demand.queue, demand.served, [...demandTokens], Date.now());
        if (next) await client.from("job_board_meta").upsert({ k: DEMAND_QUEUE_KEY, v: next, updated_at: new Date().toISOString() }, { onConflict: "k" });
      }
      return json({ live: liveMap, flagged: deadIds.length });
    }

    if (action === "audit") {
      // Rationale: docs/job-board-index-notes.md#n266-audit-sample
      const AUDIT_SAMPLE = 100;
      const { data: prevAudit } = await client.from("job_board_meta").select("v, updated_at").eq("k", "audit").maybeSingle();
      const prevAge = prevAudit ? Date.now() - new Date(prevAudit.updated_at).getTime() : Infinity;
      // force (100 live probes and the demotions they write) is maintenance
      // only (.88); an expired cache starts one audit, not one per caller.
      const auditForced = body.force === true && await isMaintenance(req, body);
      if (prevAge < 20 * 3600_000 && !auditForced) {
        return json({ ...(prevAudit?.v as Record<string, unknown>), cached: true });
      }
      if (!auditForced && !(await claimRun(client, "audit_run", 30 * 60_000))) {
        return json({ ...((prevAudit?.v ?? {}) as Record<string, unknown>), cached: true, running: true });
      }
      // Rationale: docs/job-board-index-notes.md#n267-const-count-totalrows-await-client-from
      const { count: totalRows } = await client.from("job_board_postings").select("id", { count: "planned", head: true });
      const corpus = totalRows ?? 0;
      const VENDORS = [...new Set(JOB_SOURCES.map((s) => s.source))];
      const PER_VENDOR = Math.max(4, Math.floor(AUDIT_SAMPLE / Math.max(1, VENDORS.length)));
      const sampleIds: string[] = [];
      // Rationale: docs/job-board-index-notes.md#n818-const-applyby-new-map-string-string
      const applyBy = new Map<string, string | null>();
      // Rationale: docs/job-board-index-notes.md#n819-const-vendorrows-record-string-number-nu
      const vendorRows: Record<string, number | null> = {};
      const drawErrors: Record<string, string> = {};
      // Rationale: docs/job-board-index-notes.md#n268-drawids
      const drawIds = async (v: string, want: number): Promise<string[]> => {
        const drawn: string[] = [];
        const pages = want > 4 ? 2 : 1;
        const per = Math.ceil(want / pages);
        const toks = JOB_SOURCES.filter((s) => s.source === v);
        for (let p = 0; p < pages && toks.length > 0; p++) {
          const anchor = toks[Math.floor(Math.random() * toks.length)];
          let q = client.from("job_board_postings").select("id, apply_url").eq("source", v)
            .gt("id", `${v}:${anchor.token}:`).order("id").limit(per);
          let { data: page, error: pErr } = await q;
          // A board at the end of the id range yields nothing; wrap to the
          // vendor's start rather than silently contributing zero.
          if (!pErr && (!page || page.length === 0)) {
            ({ data: page, error: pErr } = await client.from("job_board_postings")
              .select("id, apply_url").eq("source", v).order("id").limit(per));
          }
          if (pErr) { drawErrors[v] = `draw: ${pErr.message}`; continue; }
          for (const r of page ?? []) {
            const id = String(r.id);
            applyBy.set(id, (r.apply_url as string | null) ?? null);
            if (!sampleIds.includes(id) && !drawn.includes(id)) drawn.push(id);
          }
        }
        return drawn;
      };
      for (const v of VENDORS) {
        const { count, error: cErr } = await client.from("job_board_postings").select("id", { count: "planned", head: true }).eq("source", v);
        if (cErr) drawErrors[v] = `count: ${cErr.message}`;
        const n = typeof count === "number" ? count : null;
        vendorRows[v] = n;
        // Rationale: docs/job-board-index-notes.md#n820-if-n-continue
        if (n === 0) continue;
        sampleIds.push(...await drawIds(v, Math.min(PER_VENDOR, n ?? PER_VENDOR)));
      }
      // Rationale: docs/job-board-index-notes.md#n821-let-live-gone-unknown-pagecappedunknown
      let live = 0, gone = 0, unknown = 0, pageCappedUnknown = 0;
      const byVendor: Record<string, { sampled: number; live: number; gone: number; unknown: number; pageCapped: number; accuracyPct: number | null; deepened?: boolean }> = {};
      liveBoardMemo.clear();
      // Rationale: docs/job-board-index-notes.md#n822-const-probeall-async-ids-string-headline
      const probeAll = async (ids: string[], headline: boolean) => {
        // Small parallel batches: bounded fan-out, memoized board fetches.
        for (let i = 0; i < ids.length; i += 8) {
          const batch = ids.slice(i, i + 8);
          const results = await Promise.all(batch.map(async (id) => {
            const [source, token, ...rest] = id.split(":");
            const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
            if (!src || rest.length === 0) return { v: null, capped: false }; // deselected board — can't ground-truth
            const note = { pageCapped: false };
            const v = await checkLive(src, rest.join(":"), applyBy.get(id) ?? null, note);
            return { v, capped: note.pageCapped };
          }));
          results.forEach((r, j) => {
            const v = batch[j].split(":")[0];
            const bucket = byVendor[v] ?? (byVendor[v] = { sampled: 0, live: 0, gone: 0, unknown: 0, pageCapped: 0, accuracyPct: null });
            bucket.sampled++;
            if (r.v === true) { if (headline) live++; bucket.live++; }
            else if (r.v === false) { if (headline) gone++; bucket.gone++; }
            else {
              if (headline) unknown++;
              bucket.unknown++;
              if (r.capped) { if (headline) pageCappedUnknown++; bucket.pageCapped++; }
            }
          });
        }
      };
      await probeAll(sampleIds, true);
      const headlineSampled = sampleIds.length;

      // Rationale: docs/job-board-index-notes.md#n269-suspect-pct
      const SUSPECT_PCT = 90;
      const DEEPEN_TO = 30;
      const deepened: Array<{ source: string; firstPassPct: number; added: number }> = [];
      for (const [v, b] of Object.entries(byVendor)) {
        const d = b.live + b.gone;
        if (d === 0 || (b.live / d) * 100 >= SUSPECT_PCT) continue;
        if (d >= DEEPEN_TO) continue;
        const firstPassPct = Math.round((b.live / d) * 1000) / 10;
        // An unknown vendor size must not block the re-draw — the draw itself
        // will simply return what exists.
        const room = vendorRows[v];
        const headroom = room === null || room === undefined ? DEEPEN_TO : Math.max(0, room - b.sampled);
        const extra = await drawIds(v, Math.min(DEEPEN_TO - d, headroom));
        if (extra.length === 0) continue;
        sampleIds.push(...extra);
        b.deepened = true;
        await probeAll(extra, false);
        deepened.push({ source: v, firstPassPct, added: extra.length });
        console.log(`[JOB-BOARD] audit: ${v} looked low (${firstPassPct}% on ${d} probes) — re-drew ${extra.length} more`);
      }

      for (const b of Object.values(byVendor)) {
        const d = b.live + b.gone;
        b.accuracyPct = d > 0 ? Math.round((b.live / d) * 1000) / 10 : null;
      }
      const decided = live + gone;
      const accuracyPct = decided > 0 ? Math.round((live / decided) * 1000) / 10 : null;

      // Rationale: docs/job-board-index-notes.md#n823-const-labelaudit-sampled-entrychecked-en
      const labelAudit = { sampled: 0, entryChecked: 0, entryContradicted: 0, remoteChecked: 0, remoteContradicted: 0, categoryChecked: 0, categoryMismatched: 0, demoted: 0 };
      try {
        const LABEL_PAGES = 3;
        const rows: Array<{ id: string; title: string; description: string; experience_band: string; remote: boolean; category: string; department: string | null }> = [];
        const { count: descCount } = await client.from("job_board_postings")
          .select("id", { count: "exact", head: true }).not("description", "is", null);
        const nDesc = descCount ?? 0;
        for (let p = 0; p < LABEL_PAGES && nDesc > 0; p++) {
          const off = Math.floor(Math.random() * Math.max(1, nDesc - 100));
          const { data: page } = await client.from("job_board_postings")
            .select("id,title,description,experience_band,remote,category,department")
            .not("description", "is", null).order("id").range(off, off + 99);
          for (const r of (page ?? []) as typeof rows) if (!rows.some((x) => x.id === r.id)) rows.push(r);
        }
        labelAudit.sampled = rows.length;
        const entryDemote: string[] = [];
        const remoteDemote: string[] = [];
        // "N+ years required" in the posting's own words contradicts an entry label.
        const P_YEARS = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:['’]?\s*of)?\s+(?:relevant |related |professional |industry |work(?:ing)? )?experience/i;
        const P_ONSITE = /\b(?:on-?site only|not a remote (?:role|position)|no remote work|100% on-?site|fully on-?site)\b/i;
        for (const r of rows) {
          const desc = String(r.description ?? "");
          if (r.experience_band === "entry") {
            labelAudit.entryChecked++;
            const m = desc.match(P_YEARS);
            if (m && Number(m[1]) >= 3) { labelAudit.entryContradicted++; entryDemote.push(r.id); }
          }
          if (r.remote === true) {
            labelAudit.remoteChecked++;
            if (P_ONSITE.test(desc)) { labelAudit.remoteContradicted++; remoteDemote.push(r.id); }
          }
          labelAudit.categoryChecked++;
          if (categorize(r.title ?? "", r.department ?? undefined) !== r.category) labelAudit.categoryMismatched++;
        }
        for (let i = 0; i < entryDemote.length; i += 100) {
          const { error: dErr } = await client.from("job_board_postings")
            .update({ experience_band: "unspecified" }).in("id", entryDemote.slice(i, i + 100));
          if (!dErr) labelAudit.demoted += Math.min(100, entryDemote.length - i);
        }
        for (let i = 0; i < remoteDemote.length; i += 100) {
          const { error: dErr } = await client.from("job_board_postings")
            .update({ remote: false, work_mode: null }).in("id", remoteDemote.slice(i, i + 100));
          if (!dErr) labelAudit.demoted += Math.min(100, remoteDemote.length - i);
        }
      } catch (e) {
        console.warn("[JOB-BOARD] label audit failed (liveness audit unaffected):", String(e).slice(0, 150));
      }

      const prevHistory = ((prevAudit?.v as { history?: Array<Record<string, unknown>> } | null)?.history ?? []).slice(-29);
      // Rationale: docs/job-board-index-notes.md#n270-sampledsources
      const sampledSources = new Set(Object.keys(byVendor));
      // A vendor whose count is unknown (null) is treated as POSSIBLY having
      // postings, so it is reported missing rather than quietly written off.
      const missingSources = Object.entries(vendorRows)
        .filter(([v, n]) => (n === null || n > 0) && !sampledSources.has(v))
        .map(([v, n]) => ({
          source: v,
          postings: n,
          sharePct: n !== null && corpus > 0 ? Math.round((n / corpus) * 1000) / 10 : null,
          reason: drawErrors[v] ?? (n === null ? "posting count unavailable" : "no rows drawn"),
        }))
        .sort((a, b) => (b.postings ?? 0) - (a.postings ?? 0));
      const coveredPostings = Object.entries(vendorRows)
        .filter(([v, n]) => n !== null && n > 0 && sampledSources.has(v))
        .reduce((t, [, n]) => t + (n as number), 0);
      const countsUnavailable = Object.entries(vendorRows).filter(([, n]) => n === null).map(([v]) => v);
      const coverage = {
        coveredSharePct: corpus > 0 ? Math.round((coveredPostings / corpus) * 1000) / 10 : null,
        // Coverage shares are planner estimates, not a census — named here so a
        // reader is never left to assume the stronger claim.
        basis: "planner estimate" as const,
        sourcesSampled: sampledSources.size,
        sourcesWithRows: Object.values(vendorRows).filter((n) => n === null || n > 0).length,
        missingSources,
        countsUnavailable,
      };
      // Rationale: docs/job-board-index-notes.md#n271-decidedpct
      const decidedPct = headlineSampled > 0 ? Math.round((decided / headlineSampled) * 1000) / 10 : null;
      const result = { at: new Date().toISOString(), sampled: headlineSampled, probed: sampleIds.length, live, gone, unknown, pageCapped: pageCappedUnknown, unreachable: unknown - pageCappedUnknown, decided, decidedPct, accuracyPct, corpus, byVendor, coverage, deepened, labelAudit };
      await client.from("job_board_meta").upsert(
        { k: "audit", v: { ...result, history: [...prevHistory, result] }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] audit: ${live}/${decided} live (${accuracyPct}%), ${unknown} unknown of ${sampleIds.length} sampled; covered ${coverage.coveredSharePct}% of corpus across ${coverage.sourcesSampled}/${coverage.sourcesWithRows} sources`);
      if (missingSources.length > 0) {
        console.error(`[JOB-BOARD] audit COVERAGE GAP: ${missingSources.map((m) => `${m.source} (${m.sharePct}%, ${m.reason})`).join("; ")}`);
      }
      return json(result);
    }

    if (action === "company-suggest") {
      // Rationale: docs/job-board-index-notes.md#n272-q
      const q = String(body.q ?? "").trim().toLowerCase().slice(0, 80);
      if (q.length < 2) return json({ companies: [] });
      const merged = await suggestEmployers(client);
      // Folded both sides: "dominos" finds Domino's, "att" AT&T, "당근" 당근마켓 (L8-08).
      const fq = foldTypeahead(q);
      if (!fq) return json({ companies: [] });
      const hit = merged.filter((c) => foldTypeahead(String(c.name ?? "")).includes(fq));
      // Rationale: docs/job-board-index-notes.md#n824-hit-sort-a-b
      hit.sort((a, b) => {
        const ap = foldTypeahead(String(a.name ?? "")).startsWith(fq) ? 0 : 1;
        const bp = foldTypeahead(String(b.name ?? "")).startsWith(fq) ? 0 : 1;
        return ap - bp || (b.open ?? b.count ?? 0) - (a.open ?? a.count ?? 0);
      });
      return json({
        // Rationale: docs/job-board-index-notes.md#n825-companies-hit-slice-map-c
        companies: hit.slice(0, 12).map((c) => ({
          token: c.token,
          name: c.name,
          ...(typeof c.open === "number" ? { open: c.open } : {}),
          ...(Array.isArray(c.tokens) && c.tokens.length > 1 ? { tokens: c.tokens } : {}),
        })),
      });
    }

    if (action === "exists") {
      // Rationale: docs/job-board-index-notes.md#n826-const-asked-array-isarray-body-ids
      const asked = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
      if (asked.length === 0) return json({ open: {} });
      const openMap: Record<string, boolean> = {};
      for (const id of asked) openMap[id] = false;
      // S12-123: no posting id is longer than EXISTS_ID_MAX; a longer one is
      // not open and is never put in the read (a 100 KB id answered 500).
      const ids = asked.filter((id) => id.length <= EXISTS_ID_MAX);
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await client
          .from("job_board_postings")
          .select("id")
          .in("id", ids.slice(i, i + 200));
        if (error) throw error;
        for (const r of data ?? []) openMap[r.id as string] = true;
      }
      return json({ open: openMap });
    }

    if (action === "semantic-search") {
      // Rationale: docs/job-board-index-notes.md#n827-const-q-string-body-q-trim
      const q = String(body.q ?? "").trim().slice(0, 200);
      if (q.length < 3) return json({ error: "q too short" }, 400);
      const qVec = await embedText(q);
      if (!qVec) return json({ error: "inference unavailable in this runtime" }, 503);
      const semCap = (await exemptKind(req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")) ? 30 : SEMANTIC_PROBE_ROWS;
      const { data: sem, error: sErr } = await client.rpc("search_jobs_semantic", {
        p_embedding: JSON.stringify(qVec),
        p_limit: Math.min(Math.max(Number(body.limit) || 10, 1), semCap),
      });
      if (sErr) return json({ error: `semantic search unavailable: ${sErr.message?.slice(0, 80)}` }, 503);
      return json({
        q,
        results: (sem as Array<Record<string, unknown>> ?? []).map((r) => ({
          ...rowToJob(r),
          similarity: typeof r.similarity === "number" ? r.similarity : Number(r.similarity),
        })),
      });
    }

    if (action === "detail") {
      const id = String(body.id ?? "");
      const [source, token, ...rest] = id.split(":");
      const externalId = rest.join(":");
      // Allowlist gate — the token must be one of ours (no SSRF via crafted ids).
      const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
      if (!src || !externalId) return json({ error: "Unknown job id" }, 404);
      // Rationale: docs/job-board-index-notes.md#n828-const-data-jobrow-await-client-from
      const { data: jobRow } = await client.from("job_board_postings").select("*").eq("id", id).is("missing_since", null).maybeSingle();
      // Rationale: docs/job-board-index-notes.md#n274-detailcutoffms
      const detailCutoffMs = Date.now() - FRESH_WINDOW_DAYS * 86_400_000;
      if (jobRow) {
        const eff = (jobRow as Record<string, unknown>).effective_posted
          ?? (jobRow as Record<string, unknown>).posted_at
          ?? (jobRow as Record<string, unknown>).first_seen;
        const effMs = eff ? Date.parse(String(eff)) : NaN;
        if (Number.isFinite(effMs) && effMs < detailCutoffMs) {
          return json({
            job: null,
            agedOut: {
              title: (jobRow.title as string) ?? null,
              company: (jobRow.company as string) ?? null,
              postedAt: (jobRow.posted_at as string) ?? null,
              capDays: FRESH_WINDOW_DAYS,
            },
          });
        }
      }
      const stored = (jobRow?.description && jobRow.description.length > 200) ? jobRow.description as string : null;
      // Still only fetched when the row holds no usable description; the pay comes
      // back from the same call rather than a second one.
      const fetched = stored ? null : await getDescription(src, id, externalId, jobRow?.apply_url as string | undefined);
      const description = stored ?? fetched?.text ?? null;
      const vendorPay = fetched?.pay ?? null;
      if (!description && !jobRow) {
        // Dead deep link. Before answering with a bare 404 (which the client
        // can only render as a shrug), check the closure log: if we WATCHED
        // this posting close, we know its title and company and when — enough
        // for the client to say what happened and offer a search for similar
        // live roles instead of a silent dead end.
        // BY THE BOARD FIRST (S11-024): the ledger has no posting_id index, so
        // the posting id alone read ~5M rows (7 s cold, 1.5 s warm on an
        // unknown id). The token, already checked against the catalogue above,
        // reaches job_board_closures_curve_idx (company_token, closed_at DESC).
        const { data: closure } = await client
          .from("job_board_closures")
          .select("title, company, closed_at")
          .eq("company_token", token)
          .eq("posting_id", id)
          .order("closed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (closure?.title) {
          return json({
            job: null,
            closed: { title: closure.title, company: closure.company || null, closedAt: closure.closed_at },
          });
        }
        return json({ error: "Posting not found (it may have closed)" }, 404);
      }
      // Rationale: docs/job-board-index-notes.md#n829-if-stored-description-jobrow
      if (!stored && description && jobRow) {
        const minedSalary = jobRow.salary ? null : extractSalary(description);
        // Rationale: docs/job-board-index-notes.md#n830-const-statedpay-minedsalary-jobrow-salar
        const statedPay = minedSalary ?? (jobRow.salary ? null : vendorPay);
        const statedParse = statedPay ? parseSalaryStructured(statedPay, jobRow.country as string | null, { title: jobRow.title as string | null, description }) : null;
        // Rationale: docs/job-board-index-notes.md#n831-const-expread-detectexperience-string-jo
        const expRead = detectExperience(String(jobRow.title ?? ""), description);
        // Description deliberately NOT passed — see the note at the desc-sweep
        // call site. detectWorkMode is title/location only, by contract.
        const wmRead = jobRow.work_mode ? null : detectWorkMode(jobRow.location as string | null, jobRow.title as string | null);
        waitUntil((async () => {
          try {
            await client.from("job_board_postings").update({
              description: description.replace(/\u0000/g, "").slice(0, STORED_DESC_CAP),
              ...(expRead.band ? { experience_band: expRead.band, min_years: expRead.minYears } : {}),
              // Same invariant — see the desc-sweep write above.
              ...(wmRead ? { work_mode: wmRead, remote: wmRead === "remote" } : {}),
              ...(statedPay ? {
                salary: statedPay,
                salary_min_annual: statedParse?.annualMin ?? null,
                salary_max_annual: statedParse?.annualMax ?? null,
                salary_period: statedParse?.period ?? null,
                salary_currency: statedParse?.currency ?? null,
              } : {}),
            }).eq("id", id).is("description", null);
          } catch { /* best effort - a failed write must never break the read */ }
        })());
      }
      // Rationale: docs/job-board-index-notes.md#n832-const-detailjobs-jobrow-await-attachrech
      const detailJobs = jobRow ? await attachRecheckedAt(client, [rowToJob(jobRow) as unknown as Record<string, unknown>]) : [];
      return json({ job: detailJobs[0] ?? null, description });
    }

    if (action === "application-questions") {
      // Rationale: docs/job-board-index-notes.md#n275-id
      const id = String(body.id ?? "");
      const [source, token, ...rest] = id.split(":");
      const externalId = rest.join(":");
      const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
      if (!src || !externalId) return json({ error: "Unknown job id" }, 404);
      const unsupported = () => json({ vendor: source, supported: false, questions: [] });
      type Q = { label: string; required: boolean; type: string; class: string };
      const docsFrom = (questions: Q[]) =>
        questions.filter((q) => q.class === "file").map((q) => `${q.label}${q.required ? " (required)" : " (optional)"}`);

      if (source === "greenhouse") {
        // Rationale: docs/job-board-index-notes.md#n833-const-api-greenhouseapi-token
        const api = greenhouseApi(token);
        const res = await fetchWithTimeout(`https://${api.host}/v1/boards/${api.token}/jobs/${externalId}?questions=true`);
        if (!res.ok) return unsupported();
        const gh = await res.json() as { questions?: Array<{ label?: string; required?: boolean; fields?: Array<{ type?: string }> }> };
        const questions: Q[] = (gh.questions ?? [])
          .map((q) => {
            const label = (q.label ?? "").trim();
            const type = q.fields?.[0]?.type ?? "";
            return { label, required: !!q.required, type, class: classifyQuestion(label, type) };
          })
          .filter((q) => q.label);
        return json({ vendor: source, supported: true, questions, requirements: docsFrom(questions) });
      }

      if (source === "ashby") {
        // token = the org's hosted-jobs-page name, externalId = posting UUID —
        // the same pair the apply URL uses (jobs.ashbyhq.com/{token}/{id}).
        const res = await fetchWithTimeout("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationName: "ApiJobPosting",
            variables: { organizationHostedJobsPageName: token, jobPostingId: externalId },
            query: "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id applicationForm { sections { title fieldEntries { isRequired field } } } } }",
          }),
        });
        if (!res.ok) return unsupported();
        // deno-lint-ignore no-explicit-any
        const gql = await res.json() as any;
        const sections = gql?.data?.jobPosting?.applicationForm?.sections;
        if (!Array.isArray(sections)) return unsupported();
        const questions: Q[] = [];
        for (const s of sections) {
          for (const fe of (s?.fieldEntries ?? [])) {
            const f = fe?.field ?? {};
            const label = String(f.title ?? "").trim();
            if (!label) continue;
            const type = String(f.type ?? "");
            questions.push({ label, required: !!fe?.isRequired, type, class: classifyQuestion(label, type) });
          }
        }
        if (questions.length === 0) return unsupported();
        return json({ vendor: source, supported: true, questions, requirements: docsFrom(questions) });
      }

      if (source === "recruitee") {
        const res = await fetchWithTimeout(`https://${token}.recruitee.com/api/offers/${externalId}`);
        if (!res.ok) return unsupported();
        // deno-lint-ignore no-explicit-any
        const rec = await res.json() as any;
        const offer = rec?.offer ?? rec;
        if (!offer || typeof offer !== "object") return unsupported();
        const questions: Q[] = (Array.isArray(offer.open_questions) ? offer.open_questions : [])
          // deno-lint-ignore no-explicit-any
          .map((q: any) => {
            const label = String(q?.body ?? "").trim();
            const type = String(q?.kind ?? "");
            return { label, required: !!q?.required, type, class: classifyQuestion(label, type) };
          })
          .filter((q: Q) => q.label);
        // Document config lives beside the questions ("required"/"optional"/"off").
        const requirements: string[] = [];
        for (const [key, name] of [["options_cv", "Resume / CV"], ["options_cover_letter", "Cover letter"], ["options_photo", "Photo"]] as const) {
          const v = String(offer[key] ?? "off");
          if (v === "required" || v === "optional") requirements.push(`${name} (${v})`);
        }
        // supported means "we saw the real form" — a form with no custom
        // questions is still real, and its document list still helps.
        return json({ vendor: source, supported: true, questions, requirements });
      }

      // Rationale: docs/job-board-index-notes.md#n276-source-breezy-source-pinpo
      if (source === "breezy" || source === "pinpoint") {
        // Rationale: docs/job-board-index-notes.md#n834-const-data-row-await-client
        const { data: row } = await client
          .from("job_board_postings").select("apply_url").eq("id", id).maybeSingle();
        const postingUrl = String((row as { apply_url?: string } | null)?.apply_url ?? "");
        if (!postingUrl) return unsupported();
        const url = source === "breezy" ? breezyApplyUrl(postingUrl) : pinpointApplyUrl(postingUrl);
        const res = await fetchWithTimeout(url);
        if (!res.ok) return unsupported();
        const html = await res.text();
        const raw = source === "breezy" ? parseBreezyQuestions(html) : parsePinpointQuestions(html);
        // Rationale: docs/job-board-index-notes.md#n835-if-raw-length-return-unsupported
        if (raw.length === 0) return unsupported();
        const questions: Q[] = raw.map((q) => ({
          label: q.label,
          required: q.required,
          type: q.type,
          class: classifyQuestion(q.label, q.type),
        }));
        return json({ vendor: source, supported: true, questions, requirements: docsFrom(questions) });
      }

      return unsupported();
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[JOB-BOARD] error:", e);
    return json({ error: "Job board temporarily unavailable" }, 500);
  }
}
Deno.serve(handleRequest);

// Rationale: docs/job-board-index-notes.md#n277-attachmsaccum
let attachMsAccum = 0;

async function attachRecheckedAt(
  client: SupabaseClient,
  jobs: Array<Record<string, unknown>>,
  // Rationale: docs/job-board-index-notes.md#n1210-excluded-readonly-string
  excluded: readonly string[] = [],
): Promise<Array<Record<string, unknown>>> {
  const tAttach = Date.now();
  try {
    const kept = excluded.length
      ? jobs.filter((j) => !titleExcluded(String((j as { title?: unknown }).title ?? ""), excluded))
      : jobs;
    return await attachRecheckedAtInner(client, kept);
  } finally {
    attachMsAccum += Date.now() - tAttach;
  }
}

async function attachRecheckedAtInner(
  client: SupabaseClient,
  jobs: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  // Rationale: docs/job-board-index-notes.md#n278-tokens
  // By board key: a shared token's job reads its own board's stamp, never its twin's (n428).
  const keys = [...new Set(jobs.map((j) => stampKeyOfJob(j, SHARED_TOKENS)).filter(Boolean))].slice(0, 80);
  if (keys.length === 0) return jobs;
  // Rationale: docs/job-board-index-notes.md#n279-const-data-error-await-withdeadline
  const { data, error } = await withDeadline(
    client.from("job_board_verifications").select("company_token,verified_at").in("company_token", keys),
    1_500,
  ) as { data: unknown[] | null; error?: unknown };
  // On failure leave the field ABSENT. Falling back to last_seen would restore
  // the exact bug this removes.
  if (error || !Array.isArray(data)) return jobs;
  const byKey = new Map<string, string>();
  for (const r of data) {
    const t = (r as { company_token?: string }).company_token;
    const v = (r as { verified_at?: string }).verified_at;
    if (t && v) byKey.set(t, v);
  }
  for (const j of jobs) {
    const v = byKey.get(stampKeyOfJob(j, SHARED_TOKENS));
    // verified_at says the FEED was fetched, not that this posting was in it.
    if (v && !j.missingSince) j.recheckedAt = v;
  }
  return jobs;
}

// Rationale: docs/job-board-index-notes.md#n1211-function-prefermatchedlocation
function preferMatchedLocation(
  jobs: Array<Record<string, unknown>>,
  locTerms: string[],
): Array<Record<string, unknown>> {
  // The filter's own rule: a ", XX" code at a boundary, never "or" inside "New York" (n429).
  const needles = locTerms.filter((t) => t.trim().length > 0);
  if (needles.length === 0) return jobs;
  for (const j of jobs) {
    const loc = typeof j.location === "string" ? j.location : "";
    // Multi-location postings use ";" or "/" — measured on live rows.
    const parts = loc.split(/\s*[;/]\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const hit = parts.findIndex((part) => needles.some((n) => partMatchesTerm(part, n)));
    if (hit <= 0) continue; // already first, or this row matched on something else
    j.location = [parts[hit], ...parts.filter((_, i) => i !== hit)].join("; ");
    j.locationMatchedIndex = hit;
    j.otherLocationCount = parts.length - 1;
  }
  return jobs;
}

const rowToJob = (r: any) => ({
  id: r.id,
  source: r.source,
  token: r.company_token,
  company: r.company,
  title: r.title,
  location: r.location,
  remote: r.remote,
  workMode: r.work_mode ?? null,
  employmentType: r.employment_type ?? null,
  // Rationale: docs/job-board-index-notes.md#n836-country-r-country-null
  country: r.country ?? null,
  department: r.department,
  category: r.category,
  postedAt: r.posted_at,
  applyUrl: r.apply_url,
  salary: r.salary ?? null,
  salaryMinAnnual: typeof r.salary_min_annual === "number" ? r.salary_min_annual : (r.salary_min_annual != null ? Number(r.salary_min_annual) : null),
  salaryMaxAnnual: typeof r.salary_max_annual === "number" ? r.salary_max_annual : (r.salary_max_annual != null ? Number(r.salary_max_annual) : null),
  salaryPeriod: r.salary_period ?? null,
  salaryCurrency: r.salary_currency ?? null,
  experienceBand: r.experience_band && r.experience_band !== "unspecified" ? r.experience_band : null,
  minYears: typeof r.min_years === "number" ? r.min_years : null,
  lastSeen: r.last_seen ?? null,
  // Rationale: docs/job-board-index-notes.md#n837-missingsince-r-missing_since-null
  missingSince: r.missing_since ?? null,
  // Rationale: docs/job-board-index-notes.md#n838-typeof-r-agency-boolean
  ...(typeof r.agency === "boolean"
    ? {
      agency: r.agency,
    }
    : {}),
  // Tier-2 ranked searches only: the ts_headline fragment showing WHERE a
  // description-matched result matched ([[ ]] delimiters, client-rendered).
  ...(typeof r.snippet === "string" && r.snippet.includes("[[") ? { snippet: r.snippet } : {}),
  // Rationale: docs/job-board-index-notes.md#n839-typeof-r-title_match-boolean
  ...(typeof r.title_match === "boolean"
    ? { matchScope: r.title_match ? ("title" as const) : ("description" as const) }
    : {}),
});

// Cluster folding lives in ./clusters.ts so a test can WALK it — see the
// header there for the phantom-location incident that forced the move.

// mergeCompanyFacet lives in ./clusters.ts with the other page-shaping folds.

/** What a name scope did, for the answer: resolved names, and refused ones with their candidates. */
function companyNameNotes(n: CompanyScope): Record<string, unknown> {
  return {
    ...(n.resolved.length ? { companiesResolved: n.resolved } : {}),
    ...(n.unresolved.length ? { companiesUnresolved: n.unresolved } : {}),
    ...(n.skipped.length ? { companiesNotLookedUp: n.skipped } : {}),
  };
}

/** A list answer with the name scope said on it; a refused name is a dropped filter value, so "companies" is ignored too. */
async function withCompanyNames(res: Response, n: CompanyScope | null): Promise<Response> {
  if (!n || (!n.resolved.length && !n.unresolved.length && !n.skipped.length)) return res;
  const out = await boundBody(res.clone(), MAX_REQUEST_BYTES).json().catch(() => null) as Record<string, unknown> | null;
  if (!out || typeof out !== "object") return res;
  const ig = Array.isArray(out.ignoredFilters) ? out.ignoredFilters as string[] : [];
  return json({
    ...out,
    ...companyNameNotes(n),
    ...(n.unresolved.length || n.skipped.length ? { ignoredFilters: [...new Set([...ig, "companies"])] } : {}),
  }, res.status);
}

async function serveList(
  client: SupabaseClient,
  body: Record<string, unknown>,
  meta?: { v: Record<string, unknown>; updated_at: string } | null,
  /** When the request actually entered the function — see the two clocks below. */
  entryAt?: number,
  /** Phases measured BEFORE serveList was called (the meta read), so work done
   *  outside this function still appears in phaseMs instead of vanishing. */
  pre?: Record<string, number>,
) {
  // The curly apostrophe a phone types reads as the ASCII one stored (S11-021).
  body = foldTypedText(body);
  // S12-124: q and location are text, NUL-free, and named when dropped (filters.ts textFieldShape).
  const textShape = textFieldShape(body, locationTerms);
  body = textShape.body;
  // Rationale: docs/job-board-index-notes.md#n280-limitraw
  const limitRaw = Number(body.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 200) : 60;
  const offsetRaw = Number(body.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  const countOnly = body.countOnly === true;
  // Rationale: docs/job-board-index-notes.md#n281-cursor
  const cursor = (() => {
    const c = body.cursor as { ep?: unknown; id?: unknown; k?: unknown } | undefined;
    if (!c || typeof c !== "object") return null;
    const ep = typeof c.ep === "string" ? c.ep : "";
    const id = typeof c.id === "string" ? c.id : "";
    // Rationale: docs/job-board-index-notes.md#n282-wantk
    const wantK = body.sort === "newest" ? "pa" : "ep";
    // Absent means "ep": a cursor issued by the previous deploy, which only ever
    // issued them for the effective_posted walk, still seeks instead of 500ing.
    const k = c.k === undefined ? "ep" : typeof c.k === "string" ? c.k : "";
    if (!ep || !id || id.length > 200) return null;
    if (k !== wantK) return null;
    if (!/^\d{4}-\d{2}-\d{2}T[0-9:.+]+$/.test(ep)) return null;
    if (/[",()\\]/.test(id)) return null;
    return { ep, id, k };
  })();
  // Rationale: docs/job-board-index-notes.md#n840-const-groupsimilar-body-groupsimilar-fal
  const groupSimilar = body.groupSimilar !== false && !countOnly;
  const fetchLimit = groupSimilar ? Math.min(limit * GROUP_OVERFETCH, 200) : limit;

  // Rationale: docs/job-board-index-notes.md#n283-freshcutoffiso
  const freshCutoffIso = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString();
  // Rationale: docs/job-board-index-notes.md#n284-metatotal
  const metaTotal = Number((meta?.v as Record<string, unknown> | undefined)?.total);
  // Rationale: docs/job-board-index-notes.md#n285-prefilters
  const preFilters = normalizeFilters(body, JOB_SOURCES.length);
  // Rationale: docs/job-board-index-notes.md#n286-exclusion
  const exclusion = splitExclusions(String(body.q ?? ""));
  const excludedTerms = exclusion.excluded;
  if (excludedTerms.length) body = { ...body, q: exclusion.positive };
  // Rationale: docs/job-board-index-notes.md#n287-etcovraw
  const etCovRaw = ((meta?.v as Record<string, unknown> | undefined)?.coverage as { employmentType?: unknown } | undefined)?.employmentType;
  const etLiftArmed = typeof etCovRaw === "number" && etCovRaw >= 0.25;
  const liftView = etLiftArmed || (body.employmentType != null && body.employmentType !== "") ? body : { ...body, employmentType: "__uncovered" };
  const intentLift = liftIntentFilters(body.q, liftView);
  if (intentLift) {
    body = { ...body, ...intentLift.patch, q: intentLift.residualQ };
  }
  const { applied, ignored: ignoredFilters, maxAgeClamped } = (intentLift || excludedTerms.length)
    ? normalizeFilters(body, JOB_SOURCES.length)
    : preFilters;
  for (const f of textShape.ignored) if (!ignoredFilters.includes(f)) ignoredFilters.push(f);
  // Rationale: docs/job-board-index-notes.md#n841-const-agecutoff-applied-maxagedays-null
  const ageCutoff = applied.maxAgeDays === null ? null : ageCutoffMs(applied.maxAgeDays, Date.now(), body.tzOffset);
  const ageCutoffIso = ageCutoff === null ? null : new Date(ageCutoff).toISOString();
  const postedAfterBound = ((): string | null => {
    const age = ageCutoff === null ? null : new Date(ageCutoff - 1).toISOString();
    if (!applied.postedAfter) return age;
    if (!age) return applied.postedAfter;
    return Date.parse(applied.postedAfter) > Date.parse(age) ? applied.postedAfter : age;
  })();

  // Rationale: docs/job-board-index-notes.md#n842-const-searchid-crypto-randomuuid
  const searchId = crypto.randomUUID();
  // Rationale: docs/job-board-index-notes.md#n843-const-rawcaller-string-body-as-record
  const rawCaller = String((body as Record<string, unknown>).caller ?? "").toLowerCase();
  const caller = SEARCH_CALLERS.has(rawCaller) ? rawCaller : null;
  // Set only by the list dispatch, after the reader proof: nothing below writes the query.
  const noLog = body.noLog === true;
  // Rationale: docs/job-board-index-notes.md#n1212-const-shown_n
  // Rationale: docs/job-board-index-notes.md#n1213-const-shown_n
  const SHOWN_N = 20;
  const shownSet = (jobs?: Array<Record<string, unknown>>) =>
    jobs ? jobs.slice(0, SHOWN_N).map((j) => String(j.id ?? "").slice(0, 200)) : null;
  const logSearch = (
    route: "recency" | "ranked" | "fuzzy" | "semantic",
    results: number,
    total: number | null,
    rescued: "fuzzy" | "semantic" | null = null,
    /** The page this response is about to return, for the shown-set above.
     *  Optional so a route that somehow has no rows still logs the event. */
    shownJobs?: Array<Record<string, unknown>>,
  ) => {
    if (noLog) return;
    const core = {
      search_id: searchId,
      q: String(body.q ?? "").slice(0, 200),
      location: sanitizeTerm(String(body.location ?? "")).slice(0, 120),
      filters: {
        category: applied.category ?? undefined,
        experience: applied.experience.join(",") || undefined,
        remote: body.remote === true || undefined,
        workMode: applied.workMode ?? undefined,
        country: applied.country ?? undefined,
        salaryFloor: applied.salaryFloor ?? undefined,
        sendableOnly: applied.sendableOnly || undefined,
      },
      route,
      took_ms: Date.now() - reqStart,
      rescued,
      results,
      total,
      offset_n: offset,
    };
    waitUntil(Promise.resolve(
      client.from("job_board_search_events").insert({
        ...core,
        // Rationale: docs/job-board-index-notes.md#n844-caller-caller
        ...(caller ? { caller } : {}),
        // The denominator: the head of the page this response returns. Never
        // for an AI's search (owner, 2026-10-11): MCP rows keep the query only.
        ...(caller === "mcp" ? {} : { shown: shownSet(shownJobs) }),
      }).then(({ error }) => {
        if (!error) return;
        // Rationale: docs/job-board-index-notes.md#n845-const-msg-string-error-message
        const msg = String(error.message ?? "");
        if (msg.includes("caller") || msg.includes("shown")) {
          return client.from("job_board_search_events").insert(core).then(({ error: e2 }) => {
            if (e2) console.warn("[JOB-BOARD] search-event insert failed:", e2.message);
          });
        }
        console.warn("[JOB-BOARD] search-event insert failed:", error.message);
      }),
    ));
  };
  // Rationale: docs/job-board-index-notes.md#n288-reqstart
  const reqStart = entryAt ?? Date.now();
  const budgetStart = Date.now();
  // Rationale: docs/job-board-index-notes.md#n289-phase
  const phase: Record<string, number> = { ...(pre ?? {}) };
  attachMsAccum = 0;
  // Rationale: docs/job-board-index-notes.md#n846-const-phaseoutcome-record-string-string
  const phaseOutcome: Record<string, string> = {};
  const markFrom = (name: string, t0: number, outcome?: "ok" | "deadline" | "error" | "declined") => {
    phase[name] = (phase[name] ?? 0) + (Date.now() - t0);
    if (outcome) phaseOutcome[name] = outcome;
  };

  // Rationale: docs/job-board-index-notes.md#n290-request-budget-ms
  const REQUEST_BUDGET_MS = 9_000;
  const budgetLeft = () => Math.max(300, REQUEST_BUDGET_MS - (Date.now() - budgetStart));
  const honesty = (jobs: Array<Record<string, unknown>>): Record<string, unknown> => {
    const v = filterViolations(jobs, applied, ageCutoff ?? undefined);
    if (v.length) {
      console.error(
        `[JOB-BOARD] filter integrity: ${v.length} violation(s) on ${jobs.length} rows ` +
          `— ${JSON.stringify(v.slice(0, 3))}`,
      );
    }
    // Both outcomes recorded, and the asymmetry is the point: if only failures
    // were written, "no incidents" and "the check stopped running" would look
    // identical. Clean pages sampled ~2% so a healthy board pays almost nothing;
    // violations unsampled, because they should be zero.
    // .88: an incident is one row PER FIELD (filter_integrity_incident.<field>),
    // so a page tripping one field cannot erase another field's record, and
    // nothing the caller wrote -- its filters, the `want` text -- is stored.
    // Each field's row is rewritten at most once per INCIDENT_REWRITE_MS, so
    // a request that trips the sensor is not a write per request.
    if (v.length) {
      waitUntil(writeIncidents(client, incidentRows(v, jobs.length, new Date().toISOString())).catch(() => {}));
    } else if (Math.random() < 0.02) {
      const stamp = new Date().toISOString();
      waitUntil(Promise.resolve(
        client.from("job_board_meta").upsert({ k: "filter_integrity_ok", v: { at: stamp, rows: jobs.length }, updated_at: stamp }, { onConflict: "k" }),
      ).then(() => {}).catch(() => {}));
    }
    // Rationale: docs/job-board-index-notes.md#n291-paycontrolactive
    const payControlActive = applied.hasStatedPay === true
      || applied.salaryFloor !== null
      || applied.salaryCeiling !== null
      || body.sort === "salary";
    const notAnnualised = !payControlActive ? 0 : jobs.filter((j) =>
      typeof j.salary === "string" && j.salary.trim() !== "" && j.salaryMinAnnual == null
    ).length;
    return {
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(v.length
        ? { filterIntegrity: { violations: v.length, rows: jobs.length, fields: [...new Set(v.map((x) => x.field))] } }
        : {}),
      ...(notAnnualised > 0 ? { payTextWithoutAnnual: { rows: notAnnualised, of: jobs.length } } : {}),
      // Rationale: docs/job-board-index-notes.md#n847-tookms-date-now-reqstart
      tookMs: Date.now() - reqStart,
      phaseMs: { ...phase, attachRecheckedAt: attachMsAccum },
      ...(Object.keys(phaseOutcome).length ? { phaseOutcome: { ...phaseOutcome } } : {}),
    };
  };
  const unfiltered = isUnfiltered(applied);
  // Rationale: docs/job-board-index-notes.md#n292-wantcount
  const wantCount = !unfiltered;
  // Rationale: docs/job-board-index-notes.md#n293-opentotal
  const openTotal = (() => {
    const cov = (meta?.v as Record<string, unknown> | undefined)?.coverage as { open?: unknown } | undefined;
    const n = Number(cov?.open);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const safeMetaTotal = openTotal ?? (Number.isFinite(metaTotal) && metaTotal > 0 ? metaTotal : null);
  // Rationale: docs/job-board-index-notes.md#n294-trackedtotal
  const trackedTotal = (() => {
    const cov = (meta?.v as Record<string, unknown> | undefined)?.coverage as { tracked?: unknown } | undefined;
    const n = Number(cov?.tracked);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // Rationale: docs/job-board-index-notes.md#n295-offset-ceiling
  const OFFSET_CEILING = 1_000_000;
  if (!countOnly && (offset >= OFFSET_CEILING || (safeMetaTotal !== null && offset >= safeMetaTotal))) {
    return json({
      // Rationale: docs/job-board-index-notes.md#n848-jobs-total-unfiltered-safemetatotal-null
      jobs: [], total: unfiltered ? safeMetaTotal : null, hasMore: false, nextOffset: offset,
      ...(!unfiltered || safeMetaTotal === null ? { countUnavailable: true } : {}),
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(maxAgeClamped ? { maxAgeClampedTo: 30 } : {}),
      ...exclusionDisclosure(excludedTerms),
      ...exclusionCountsCaveat(excludedTerms),
      // Rationale: docs/job-board-index-notes.md#n849-searchid-totalallcompanies-safemetatotal
      searchId, totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
      companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0,
      refreshedAt: null,
      // Rationale: docs/job-board-index-notes.md#n850-tookms-date-now-reqstart
      tookMs: Date.now() - reqStart,
      phaseMs: { ...phase },
      ...(Object.keys(phaseOutcome).length ? { phaseOutcome: { ...phaseOutcome } } : {}),
    });
  }
  // Rationale: docs/job-board-index-notes.md#n296-buildquery
  const buildQuery = (
    dateCol: string,
    withCount = wantCount,
    categoryOverride?: string,
    // Rationale: docs/job-board-index-notes.md#n851-opts-skipterms-boolean
    opts?: { skipTerms?: boolean },
  ) => {
    let q = client
      .from("job_board_postings")
      .select(
        "id,source,company_token,company,title,location,country,remote,work_mode,employment_type,department,category,posted_at,apply_url,salary,salary_min_annual,salary_max_annual,salary_period,salary_currency,experience_band,min_years,agency,last_seen,missing_since,effective_posted",
        withCount ? { count: "exact" } : {},
      )
      .gte(dateCol, freshCutoffIso)
      // Rationale: docs/job-board-index-notes.md#n297-is-missing-since-null
      .is("missing_since", null);
    const terms = queryTerms(body.q).terms.slice(0, 8);
    // Rationale: docs/job-board-index-notes.md#n298-opts-skipterms-for-const-t-of-terms
    const termOr = (t: string) => `title.ilike."%${t}%",company.ilike."%${t}%",department.ilike."%${t}%"`;
    const groups = orGroups(terms);
    // One group: every term ANDed, as always. Several: the searcher's OR (L8-07).
    if (!opts?.skipTerms && groups.length === 1) for (const t of groups[0]) q = q.or(termOr(t));
    else if (!opts?.skipTerms && groups.length > 1) q = q.or(groups.map((g) => g.length === 1 ? termOr(g[0]) : `and(${g.map((t) => `or(${termOr(t)})`).join(",")})`).join(","));
    // Rationale: docs/job-board-index-notes.md#n852-const-locterms-locationterms-body-locati
    const locTerms = locationTerms(body.location).terms;
    // A state code binds at a boundary, on a US/CA/unplaced row (n429).
    if (locTerms.length === 1 && !isStateCodeAlias(locTerms[0])) q = q.ilike("location", `%${locTerms[0]}%`);
    // Rationale: docs/job-board-index-notes.md#n853-else-if-locterms-length-q-q
    else if (locTerms.length > 0) q = q.or(locTerms.map(locationBranch).join(","));
    // Rationale: docs/job-board-index-notes.md#n299-applied-remote
    if (applied.remote) {
      q = q.eq("remote", true);
    }
    // Rationale: docs/job-board-index-notes.md#n300-applied-workmode-q-q-in-work-mode
    if (applied.workMode) q = q.in("work_mode", applied.workMode.split(","));
    if (applied.employmentType) q = q.in("employment_type", applied.employmentType.split(","));
    // Rationale: docs/job-board-index-notes.md#n854-if-applied-country
    if (applied.country) {
      const cs = applied.country.split(",").filter(Boolean);
      q = cs.length > 1 ? q.in("country", cs) : q.eq("country", cs[0]);
    }
    // Rationale: docs/job-board-index-notes.md#n301-categoryoverride
    if (categoryOverride) {
      const ov = categoryOverride.split(",").filter(Boolean);
      q = ov.length > 1 ? q.in("category", ov) : q.eq("category", ov[0]);
    } else if (applied.category) {
      const cats = applied.category.split(",").filter(Boolean);
      const wanted = applied.includeUncategorised ? [...cats, "other"] : cats;
      q = wanted.length > 1 ? q.in("category", wanted) : q.eq("category", wanted[0]);
    }
    // Rationale: docs/job-board-index-notes.md#n855-if-applied-sendableonly-q-q-in
    if (applied.sendableOnly) q = q.in("source", [...SENDABLE_VENDORS]);
    // Rationale: docs/job-board-index-notes.md#n856-if-applied-experience-length-q-q
    if (applied.experience.length === 1) q = q.eq("experience_band", applied.experience[0]);
    else if (applied.experience.length > 1) q = q.in("experience_band", applied.experience);
    // Rationale: docs/job-board-index-notes.md#n302-applied-salaryfloor-null
    if (applied.salaryFloor !== null) {
      // Rationale: docs/job-board-index-notes.md#n857-q-applied-includeunstatedpay
      q = applied.includeUnstatedPay
        ? q.or(`salary_rank_usd.gte.${applied.salaryFloor},salary_rank_usd.is.null`)
        : q.gte("salary_rank_usd", applied.salaryFloor);
    }
    // Rationale: docs/job-board-index-notes.md#n303-applied-salaryceiling-null
    if (applied.salaryCeiling !== null) {
      q = applied.includeUnstatedPay
        ? q.or(`salary_rank_usd.lte.${applied.salaryCeiling},salary_rank_usd.is.null`)
        : q.lte("salary_rank_usd", applied.salaryCeiling);
    }
    // Rationale: docs/job-board-index-notes.md#n304-applied-hasstatedpay-q-q-not-salary
    if (applied.hasStatedPay) q = q.not("salary", "is", null);
    // Rationale: docs/job-board-index-notes.md#n858-if-applied-hasdescription-q-q-not
    if (applied.hasDescription) q = q.not("description", "is", null);
    // Rationale: docs/job-board-index-notes.md#n859-if-applied-paybasis-hourly-q-q
    if (applied.payBasis === "hourly") q = q.eq("salary_period", "hour");
    else if (applied.payBasis === "salaried") q = q.in("salary_period", [...SALARIED_PERIODS]);
    // Rationale: docs/job-board-index-notes.md#n860-if-applied-maxyears-null-q-q
    if (applied.maxYears !== null) q = q.lte("min_years", applied.maxYears);
    // Rationale: docs/job-board-index-notes.md#n861-if-applied-department-q-q-ilike
    if (applied.department) q = q.ilike("department", `%${applied.department}%`);
    // Rationale: docs/job-board-index-notes.md#n862-if-applied-vendors-length-q-q
    if (applied.vendors.length) q = q.in("source", applied.vendors);
    if (applied.companies.length) q = q.in("company_token", applied.companies);
    // Rationale: docs/job-board-index-notes.md#n305-applied-excludeagencies-q-q-eq-agenc
    if (applied.excludeAgencies) q = q.eq("agency", false);
    // Rationale: docs/job-board-index-notes.md#n306-applied-postedafter-q-q-gt-posted-at
    if (applied.postedAfter) q = q.gt("posted_at", applied.postedAfter);
    // Rationale: docs/job-board-index-notes.md#n306b-applied-newsince
    if (applied.newSince) q = q.or(`posted_at.gt."${applied.newSince}",first_seen.gt."${applied.newSince}"`);
    // Rationale: docs/job-board-index-notes.md#n863-if-agecutoffiso-null-q-q-gte
    if (ageCutoffIso !== null) q = q.gte("posted_at", ageCutoffIso);
    return q;
  };
  const missingColumn = (e: { message?: string } | null) => !!e?.message?.includes("effective_posted");

  // Rationale: docs/job-board-index-notes.md#n864-const-count_cap-_000
  const COUNT_CAP = 10_000;
  const cappedCount = async (): Promise<{ n: number; capped: boolean } | null> => {
    // Rationale: docs/job-board-index-notes.md#n307-applied-country-applied-country-inclu
    if (applied.country && applied.country.includes(",")) return null;
    // Rationale: docs/job-board-index-notes.md#n308-rpcblindfilters-applied-length-return
    if (rpcBlindFilters(applied).length) return null;
    // Rationale: docs/job-board-index-notes.md#n309-qterms
    const qTerms = queryTerms(body.q).terms;
    if (qTerms.length > 1) return null;
    try {
      const t_count_jobs_capped_6 = Date.now();
      const { data, error } = await client.rpc("count_jobs_capped", {
        p_fresh_cutoff: freshCutoffIso,
        p_q: qTerms.length === 1 ? qTerms[0] : null,
        p_location: rankedLocationParam(applied.location),
        p_remote: applied.remote ? true : null,
        p_country: applied.country,
        p_category: categoryParam(applied),
        // Spread-omitted when off: including the key (even null) against the
        // pre-p_sources SQL would 404 the whole RPC during the deploy window.
        ...sendableSourcesParam(applied),
        p_experience: applied.experience.length ? applied.experience : null,
        p_salary_floor: applied.salaryFloor,
        p_companies: applied.companies.length ? applied.companies : null,
        p_posted_after: postedAfterBound,
        p_max_age_days: null,
        ...payParams(applied),
        ...extraFilterParams(applied),
        p_work_mode: applied.workMode,
          ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
          ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
        p_cap: COUNT_CAP,
      });
      markFrom("count_jobs_capped_settle", t_count_jobs_capped_6);
      if (error || !Array.isArray(data) || !data.length) return null;
      const row = data[0] as { n?: number | string; capped?: boolean };
      const n = Number(row.n);
      if (!Number.isFinite(n)) return null;
      // The .77 stated-pay stand-down is gone: 20260927034117 is live (n310, S8-089).
      return { n, capped: row.capped === true };
    } catch {
      return null; // RPC missing — caller keeps the old exact-count behaviour
    }
  };

  // Rationale: docs/job-board-index-notes.md#n311-qt
  const qt = queryTerms(body.q);
  // phraseText, not a plain join: a quoted phrase is one term here and must
  // reach the tsquery parser back inside its quotes, or the tip is a lie.
  const qText = phraseText(qt.terms).slice(0, 200) || (qt.liftedSalary ? "" : String(body.q ?? "").trim().slice(0, 200));
  // The router's employer keys: the table, plus the live employer list's (S12-014).
  const routeAliases = qText ? await routeAliasesFor(client) : EMPLOYER_ALIASES;
  /** The SIMPLE route's split title match, with an employer's boards beside its key (S12-014). */
  const simpleSplit = (q: string) => simpleRouteFilters(ftsSafe(q), ROLE_ALIASES, routeAliases);

  if (body.facetCounts === true) {
    // Rationale: docs/job-board-index-notes.md#n865-const-facetroute-qtext-pickroute-qtext-r
    const facetRoute = qText ? pickRoute(qText, routeAliases, QUERY_FILLER) : null;
    const facetTokens = facetRoute?.route === "EMPLOYER" && facetRoute.tokens?.length ? facetRoute.tokens : null;
    if (!facetTokens && qText) {
      return json({
        categories: {},
        facetSource: "withheld",
        appliedSignature: JSON.stringify(applied),
        ...(ignoredFilters.length ? { ignoredFilters } : {}),
      });
    }
    // Rationale: docs/job-board-index-notes.md#n312-facet-chunk
    const FACET_CHUNK = 6;
    // Rationale: docs/job-board-index-notes.md#n313-facet-deadline
    const FACET_DEADLINE = Date.now() + (qText ? 1_500 : 4_000);
    const counts: Record<string, number> = {};
    let facetCapped = false;
    const cats = [...JOB_CATEGORIES];
    for (let i = 0; i < cats.length; i += FACET_CHUNK) {
      if (Date.now() > FACET_DEADLINE) break;
      const chunk = cats.slice(i, i + FACET_CHUNK);
      // Rationale: docs/job-board-index-notes.md#n314-chunkbudget
      const chunkBudget = Math.max(250, FACET_DEADLINE - Date.now());
      const chunkWork = Promise.all(chunk.map(async (c) => {
        try {
          const base = facetTokens
            ? buildQuery("effective_posted", true, c, { skipTerms: true }).in("company_token", facetTokens)
            : buildQuery("effective_posted", true, c);
          const r = await base.range(0, 0);
          if (r.error) return [c, null, false] as const;
          // Capped to the SAME ceiling the list uses, so the two numbers on
          // screen are the same kind of number.
          const n = r.count ?? 0;
          return [c, Math.min(n, COUNT_CAP), n > COUNT_CAP] as const;
        } catch {
          return [c, null, false] as const;
        }
      }));
      // Rationale: docs/job-board-index-notes.md#n866-const-raced-await-withdeadline-chunkwork
      const raced = await withDeadline(chunkWork, chunkBudget);
      const settled = Array.isArray(raced) ? raced : [];
      for (const [c, n, capped] of settled) {
        if (typeof n === "number") counts[c] = n;
        if (capped) facetCapped = true;
      }
    }
    return json({
      categories: counts,
      // Said out loud for the same reason the list says it: a capped figure
      // presented as exact is a number that cannot be checked.
      ...(facetCapped ? { countCapped: true } : {}),
      // Which matcher produced these: the employer's tokens (the list's own), or the filters alone.
      facetSource: facetTokens ? "employer" : "filters",
      // Rationale: docs/job-board-index-notes.md#n867-appliedsignature-json-stringify-applied
      appliedSignature: JSON.stringify(applied),
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
    });
  }

  // Rationale: docs/job-board-index-notes.md#n318-qclass
  const qClass = qText ? pickRoute(qText, routeAliases, QUERY_FILLER) : null;
  const qClassRetriever = qClass ? RETRIEVER_FOR[qClass.route] : null;
  const onlyQuery = isUnfiltered({ ...applied, q: "" });
  // Rationale: docs/job-board-index-notes.md#n868-const-routedecision-qtext-qclass
  const routeDecision = qText && qClass
    ? qClass
    : { route: "BROWSE" as const, reason: "not routable", tokens: undefined as string[] | undefined, matchedName: undefined as string | undefined };
  const routedRetriever = RETRIEVER_FOR[routeDecision.route];
  // Rationale: docs/job-board-index-notes.md#n869-const-route_window
  const ROUTE_WINDOW = 400;
  // Rationale: docs/job-board-index-notes.md#n319-routedquerytokens
  const routedQueryTokens = qText.split(/\s+/).filter(Boolean).length;
  const ROUTED_DEADLINE_MS = routedQueryTokens >= 3 ? 2_500 : 7_000;

  if (countOnly) {
    // Rationale: docs/job-board-index-notes.md#n320-counthonesty
    const countHonesty = {
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(applied.newSince ? { newSince: applied.newSince } : {}),
      ...(maxAgeClamped ? { maxAgeClampedTo: 30 } : {}),
      // Rationale: docs/job-board-index-notes.md#n870-exclusiondisclosure-excludedterms
      ...exclusionDisclosure(excludedTerms),
      ...exclusionCountsCaveat(excludedTerms),
    };
    if (!wantCount) return json({ total: safeMetaTotal, ...(safeMetaTotal === null ? { countUnavailable: true } : {}), ...countHonesty }); // unfiltered — the maintained catalog total, degraded to null when the cache is unreadable
    // Rationale: docs/job-board-index-notes.md#n321-qtext-body-sort-salary-rout
    // The pay-ordered list publishes no total (stated pay only), so neither does its count;
    // it fell to the substring count, which the list no longer uses (L8-01).
    if (body.sort === "salary" && qText) return json({ total: null, countUnavailable: true, ...countHonesty });
    if (qText && body.sort !== "salary" && (routedRetriever === "company" || routedRetriever === "simple")) {
      try {
        let rqC = buildQuery("effective_posted", false, undefined, { skipTerms: true });
        // Rationale: docs/job-board-index-notes.md#n871-const-rcexpand-routedretriever-company-q
        const rcExpand = routedRetriever === "company" ? { q: qText, expansions: [] as string[] } : expandQuery(qText);
        // The list's own split title match (S11-004, n481), or its whole-query one.
        const rcSplit = routedRetriever === "simple" ? simpleSplit(qText) : null;
        rqC = routedRetriever === "company" && routeDecision.tokens?.length
          ? rqC.in("company_token", routeDecision.tokens)
          : rcSplit
          ? titleFilters(rqC, rcSplit.filters)
          : rqC.textSearch(
            "title",
            rcExpand.expansions.length ? ftsSafe(rcExpand.q) : ftsQuery(qText),
            { type: "websearch", config: "simple" },
          );
        const t_related_count = Date.now();
        const { data: rcRows, error: rcErr } = await withDeadline(
          rqC.order("effective_posted", { ascending: false }).order("id", { ascending: true })
            .range(0, ROUTE_WINDOW - 1),
          // The shared shape-sized deadline, clamped to the request budget —
          // the count mirrors the list, and that includes how long it may run.
          Math.min(ROUTED_DEADLINE_MS, budgetLeft()),
        ) as { data: unknown[] | null; error?: unknown };
        markFrom("related_count", t_related_count);
        if (rcRows === null) console.warn(`[JOB-BOARD] routed count (${routeDecision.route}) hit its deadline for q=${JSON.stringify(qText)}`);
        // Empty window falls through, because the LIST falls through on an empty
        // window too — matching its behaviour is the whole point of this block.
        if (!rcErr && Array.isArray(rcRows) && rcRows.length > 0) {
          const rcCapped = rcRows.length >= ROUTE_WINDOW;
          // Rationale: docs/job-board-index-notes.md#n872-return-json-total-rccapped-null-rcrows
          return json({ total: rcCapped ? null : rcRows.length, ...(rcCapped ? { countUnavailable: true, totalAtLeast: rcRows.length } : {}), ...countHonesty });
        }
      } catch { /* fall through to the search_jobs count below — the same path the list falls through to */ }
    }
    // Rationale: docs/job-board-index-notes.md#n322-qtc
    const qtC = queryTerms(body.q);
    const qTextC = phraseText(qtC.terms).slice(0, 200) || (qtC.liftedSalary ? "" : String(body.q ?? "").trim().slice(0, 200));
    // Rationale: docs/job-board-index-notes.md#n323-qtextc-body-sort-salary-rpc
    if (qTextC && body.sort !== "salary" && !rpcBlindFilters(applied).length) {
      try {
        const { q: expQC } = expandQuery(qTextC);
        const t_search_jobs_4 = Date.now();
        // On a clock: a missed full call is answered by the title tier (S11-009, n482).
        const rcAnswer = await rankedWithDeadline((titleOnly) => client.rpc("search_jobs", {
          p_q: expQC,
          p_fresh_cutoff: freshCutoffIso,
          p_location: rankedLocationParam(applied.location),
          p_remote: applied.remote ? true : null,
          p_country: applied.country,
          p_category: categoryParam(applied),
          ...sendableSourcesParam(applied),
          p_experience: applied.experience.length ? applied.experience : null,
          p_salary_floor: applied.salaryFloor,
          p_companies: applied.companies.length ? applied.companies : null,
          p_posted_after: postedAfterBound,
          p_max_age_days: null,
          ...payParams(applied),
          ...extraFilterParams(applied),
          ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
        ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
        ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
          p_limit: 1,
          p_offset: 0,
          ...(titleOnly ? { p_title_only: true } : {}),
        }), budgetLeft);
        const { data: rc, error: ec } = rcAnswer;
        markFrom("search_jobs", t_search_jobs_4);
        if (!ec && Array.isArray(rc)) {
          // Rationale: docs/job-board-index-notes.md#n324-trc
          const trC = Number((rc[0] as { total_rows?: number } | undefined)?.total_rows);
          const tC = rc.length ? (Number.isFinite(trC) ? trC : rc.length) : 0;
          // Rationale: docs/job-board-index-notes.md#n325-rrc
          const rrC = Number((rc[0] as { related_rows?: number | null } | undefined)?.related_rows);
          const relC = rc.length && Number.isFinite(rrC) ? rrC : null;
          const tier2C = (rc as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string");
          // Rationale: docs/job-board-index-notes.md#n873-const-cappedc-relc-null-tc-tier2c
          const cappedC = relC === null ? tC >= (tier2C ? 3_000 : 10_000) : tC >= 10_000;
          // "c#" and "c++" parse to the bare letter: that count is not this query's (L8-17, n430).
          if (qClass?.route === "SYMBOL") return json({ total: null, countUnavailable: true, ...countHonesty });
          return json({
            total: tC,
            ...(cappedC ? { countCapped: true } : {}),
            // Rationale: docs/job-board-index-notes.md#n874-relc-null-relc
            ...(relC === null || relC === 0
              ? {}
              : { relatedTotal: relC, ...(tC + relC >= 3_000 ? { relatedCapped: true } : {}) }),
            // The description tier missed its clock: not looked at, so not zero.
            ...(rcAnswer.cut ? { relatedUnavailable: true } : {}),
            ...countHonesty,
          });
        }
      } catch { /* migration lag or malformed query — the capped/ILIKE path below still answers */ }
    }
    const t_count_direct = Date.now();
    const capped = await cappedCount();
    markFrom("count_jobs_capped", t_count_direct);
    if (capped) return json({ total: capped.n, ...(capped.capped ? { countCapped: true } : {}), ...countHonesty });
    let { count, error } = await buildQuery("effective_posted").range(0, 0);
    if (missingColumn(error)) ({ count, error } = await buildQuery("posted_at").range(0, 0));
    // Rationale: docs/job-board-index-notes.md#n875-if-error-return-json-total-null
    if (error) return json({ total: null, countUnavailable: true, ...countHonesty });
    return json({ total: count ?? 0, ...countHonesty });
  }

  // Rationale: docs/job-board-index-notes.md#n326-newestfirst
  const newestFirst = body.sort === "newest";
  // Rationale: docs/job-board-index-notes.md#n876-const-scoreranked-newestfirst-body-sort
  const scoreRanked = !newestFirst && body.sort !== "salary" && !countOnly;
  // Rationale: docs/job-board-index-notes.md#n877-const-headtermring
  const headTermRing = (() => {
    const toks = qText.trim().split(/\s+/).filter(Boolean);
    return toks.length >= 1 && toks.length <= 2 && qText.trim().length >= 3;
  })();
  // Rationale: docs/job-board-index-notes.md#n327-deeppageable
  const deepPageable = scoreRanked
    && routedRetriever !== "company" && routedRetriever !== "simple"
    && routeDecision.route !== "SYMBOL";
  // Rationale: docs/job-board-index-notes.md#n328-ringmerged
  const ringMerged = scoreRanked && headTermRing && deepPageable;
  const pagePlan = planRankedPage({ offset, fetchLimit, scoreRanked, newestFirst, deepPageable, ringMerged });
  const deepPage = pagePlan.deepPage;
  const metaV = (meta?.v ?? {}) as Record<string, unknown>;

  // Rationale: docs/job-board-index-notes.md#n329-body-explain-true
  if (body.explain === true) {
    const { expansions } = expandQuery(qText);
    return json({
      diagnose: true,
      query: {
        raw: String(body.q ?? ""),
        parsed: qText,
        terms: qt.terms,
        droppedTerms: qt.dropped ?? [],
        liftedSalary: qt.liftedSalary ?? null,
        exclusions: [...excludedTerms],
        intentLifts: intentLift?.labels ?? [],
        intentPatch: intentLift?.patch ?? {},
        aliasExpansions: expansions,
      },
      filters: {
        applied,
        ignored: ignoredFilters,
        // Rationale: docs/job-board-index-notes.md#n878-rpcblind-rpcblindfilters-applied
        rpcBlind: rpcBlindFilters(applied),
        unfiltered: isUnfiltered(applied),
        maxAgeClamped,
        coverage: coverageDisclosure(applied, meta),
      },
      routing: {
        route: routeDecision.route,
        reason: routeDecision.reason,
        retriever: routedRetriever,
        onlyQuery,
        matchedCompany: routeDecision.matchedName ?? null,
      },
      ranking: {
        sort: String(body.sort ?? "relevance"),
        newestFirst,
        scoreRanked,
        headTermRing,
        deepPageable,
        ringMerged,
        deepPage,
        seam: ringMerged ? RING_WINDOW : RANKED_WINDOW,
        plan: pagePlan,
        offset,
        limit,
        fetchLimit,
      },
      disclosures: searchDisclosures(body, applied, maxAgeClamped),
      note:
        "Decision trace only — no search was executed. Re-send this body without `explain` to run it; the response's searchRoute, phaseMs, rankedFellBack, total and hasMore are the OUTCOME. The debug_search MCP tool and /v1/explain merge both halves.",
    });
  }

  // Rationale: docs/job-board-index-notes.md#n330-salarytextsort
  // Every text query under the pay order, filtered or not: the recency path's
  // ILIKE served "rn" as NorthwesteRN (L8-01). An employer route binds its
  // tokens, never the name as title text (L8-02); the title match takes the
  // same alias expansion the other title tiers do.
  const salaryTextSort = !countOnly && !!qText && body.sort === "salary";
  const salaryEmployer = qClass?.route === "EMPLOYER" && !!qClass.tokens?.length ? qClass.tokens : null;
  const salaryExpand = salaryEmployer ? { q: qText, expansions: [] as string[] } : expandQuery(qText);
  const salarySplit = qClass?.route === "SIMPLE" && !salaryEmployer ? simpleSplit(qText) : null;

  if (salaryTextSort) {
    const t_salary_sorted = Date.now();
    let salRows: unknown[] | null = null;
    try {
      const salBase = buildQuery("effective_posted", false, undefined, { skipTerms: true });
      const res = await withDeadline(
        (salaryEmployer
          ? salBase.in("company_token", salaryEmployer)
          : qClass?.route === "RANKED"
          ? titleStemmed(salBase, ftsSafe(salaryExpand.q))
          : salarySplit
          ? titleFilters(salBase, salarySplit.filters)
          : salBase.textSearch("title", salaryExpand.expansions.length ? ftsSafe(salaryExpand.q) : ftsQuery(qText), { type: "websearch", config: "simple" }))
          .not("salary_rank_usd", "is", null)
          .order("salary_rank_usd", { ascending: false })
          .order("id", { ascending: true })
          // S12-035: over-fetched like every other folding route; a page of exactly
          // `limit` rows folded to a quarter-to-half-empty page ("cashier" 44 of 60).
          .range(offset, offset + fetchLimit - 1),
        7_000,
      ) as { data: unknown[] | null; error?: unknown };
      if (!res.error && Array.isArray(res.data)) salRows = res.data;
    } catch { /* answered below as unavailable, never by the substring path */ }
    markFrom("salary_sorted", t_salary_sorted);
    if (salRows === null) console.warn(`[JOB-BOARD] salary-sorted search failed or hit its deadline for q=${JSON.stringify(qText)}`);
    {
      // No pay-ordered row on page one is said out loud; the recency ILIKE never stands in (L8-01, L8-02).
      const salJobs = ((salRows ?? []) as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
      const salGrouped = groupSimilar
        ? collapseClusters(salJobs, limit)
        : { jobs: salJobs.slice(0, limit), rawConsumed: Math.min(salJobs.length, limit) };
      const salServed = preferMatchedLocation(await attachRecheckedAt(client, salGrouped.jobs, excludedTerms), locationTerms(body.location).terms);
      logSearch("ranked", salGrouped.jobs.length, null, null, salServed);
      return json({
        jobs: salServed,
        searchId,
        ...searchDisclosures(body, applied, maxAgeClamped),
        ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
        ...coverageDisclosure(applied, meta),
        ...honesty(salGrouped.jobs),
        // Ordered in SQL over the whole match set, so paging is a plain offset
        // into one stable ordering — no window to fall off the end of.
        total: null,
        countUnavailable: true,
        hasMore: salJobs.length >= fetchLimit || salGrouped.rawConsumed < salJobs.length,
        nextOffset: offset + salGrouped.rawConsumed,
        searchRoute: "SALARY",
        searchRouteReason: salaryEmployer
          ? "salary-sorted employer search, ordered on the indexed pay column"
          : "salary-sorted text search, ordered on the indexed pay column",
        ...(salaryExpand.expansions.length ? { aliases: salaryExpand.expansions } : {}),
        // The split match binds its own alias phrases, and only those (n481).
        ...(salarySplit ? { aliases: salarySplit.expansions.length ? salarySplit.expansions : undefined } : {}),
        ...(salaryEmployer && qClass?.matchedName ? { companyMatched: qClass.matchedName } : {}),
        ...(salJobs.length === 0 && offset === 0 ? { sortUnavailable: salRows === null ? "unavailable" : "no-stated-pay" } : {}),
        // Said out loud: this page deliberately shows only postings that state
        // pay, which is about an eighth of the board.
        salaryStatedOnly: true,
        // Rationale: docs/job-board-index-notes.md#n879-exclusioncountscaveat-excludedterms
        ...exclusionCountsCaveat(excludedTerms),
        totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
        companies: [],
        companiesCount: ((metaV.companiesCount as number | undefined) ?? ((metaV.companiesFacet as unknown[]) ?? []).length),
        // Rationale: docs/job-board-index-notes.md#n331-typeof-metav-companiesopencount-number
        ...(typeof metaV.companiesOpenCount === "number" ? { companiesOpenCount: metaV.companiesOpenCount } : {}),
        // Rationale: docs/job-board-index-notes.md#n332-categories
        categories: {},
        failedSources: [], failedCount: 0,
        refreshedAt: (metaV.refreshedAt as string) ?? null,
      });
    }
  }

  // Rationale: docs/job-board-index-notes.md#n333-newesttextsort
  const newestTextSort = !countOnly && !!qText && newestFirst
    && qClassRetriever !== "company" && qClass?.route !== "SYMBOL";

  if (newestTextSort) try {
    const t_newest_sorted = Date.now();
    const newestExpand = expandQuery(qText);
    const newestSplit = qClass?.route === "SIMPLE" ? simpleSplit(qText) : null;
    const newestBase = buildQuery("effective_posted", false, undefined, { skipTerms: true });
    const { data: newRows, error: newErr } = await withDeadline(
      (qClass?.route === "RANKED"
        ? titleStemmed(newestBase, ftsSafe(newestExpand.q))
        : newestSplit
        ? titleFilters(newestBase, newestSplit.filters)
        : newestBase.textSearch(
          "title",
          newestExpand.expansions.length ? ftsSafe(newestExpand.q) : ftsQuery(qText),
          { type: "websearch", config: "simple" },
        ))
        // Rationale: docs/job-board-index-notes.md#n880-order-posted_at-ascending-false-nullsfir
        .order("posted_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        // Rationale: docs/job-board-index-notes.md#n881-range-offset-offset-fetchlimit
        .range(offset, offset + fetchLimit - 1),
      Math.min(7_000, budgetLeft()),
    ) as { data: unknown[] | null; error?: unknown };
    markFrom("newest_sorted", t_newest_sorted);
    if (newRows === null) console.warn(`[JOB-BOARD] newest-sorted search hit its deadline for q=${JSON.stringify(qText)}`);
    if (!newErr && Array.isArray(newRows) && newRows.length > 0) {
      const newJobs = (newRows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
      const newGrouped = groupSimilar
        ? collapseClusters(newJobs, limit)
        : { jobs: newJobs.slice(0, limit), rawConsumed: Math.min(newJobs.length, limit) };
      const newServed = preferMatchedLocation(await attachRecheckedAt(client, newGrouped.jobs, excludedTerms), locationTerms(body.location).terms);
      // Rationale: docs/job-board-index-notes.md#n334-logsearch-ranked-newgrouped-jobs-length-null
      logSearch("ranked", newGrouped.jobs.length, null, null, newServed);
      return json({
        jobs: newServed,
        searchId,
        ...searchDisclosures(body, applied, maxAgeClamped),
        ...intentDisclosure(intentLift),
        ...exclusionDisclosure(excludedTerms),
        ...coverageDisclosure(applied, meta),
        ...honesty(newGrouped.jobs),
        // Rationale: docs/job-board-index-notes.md#n335-sortscope-matchset
        sortScope: "matchSet",
        sortMatcher: "title",
        // The alias expansion is part of what was matched, so it is disclosed
        // the same way the ranked path discloses it.
        ...(newestExpand.expansions.length ? { aliases: newestExpand.expansions } : {}),
        // The split match binds its own alias phrases, and only those (n481).
        ...(newestSplit ? { aliases: newestSplit.expansions.length ? newestSplit.expansions : undefined } : {}),
        // Rationale: docs/job-board-index-notes.md#n336-total-null
        total: null,
        countUnavailable: true,
        // Raw rows left over the page could not fold, or a full read: either
        // way there is another page. Same arithmetic as the recency exit.
        hasMore: newJobs.length > newGrouped.rawConsumed || newJobs.length >= fetchLimit,
        nextOffset: offset + newGrouped.rawConsumed,
        searchRoute: "NEWEST",
        searchRouteReason: "date-sorted text search, ordered on posted_at over the whole title-match set",
        ...exclusionCountsCaveat(excludedTerms),
        // The SERVABLE board-wide count, beside the withheld per-search one —
        // the same figure `total` publishes on the unfiltered browse.
        totalAllCompanies: safeMetaTotal ?? 0,
        ...(trackedTotal !== null ? { trackedTotal } : {}),
        companies: [],
        companiesCount: ((metaV.companiesCount as number | undefined) ?? ((metaV.companiesFacet as unknown[]) ?? []).length),
        ...(typeof metaV.companiesOpenCount === "number" ? { companiesOpenCount: metaV.companiesOpenCount } : {}),
        // Rationale: docs/job-board-index-notes.md#n337-categories-visiblecategories-metav-categoriesfa
        categories: visibleCategories(metaV.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
        failedSources: (metaV.failedSources as string[]) ?? [],
        failedCount: (metaV.failedCount as number | undefined) ?? 0,
        refreshedAt: (metaV.refreshedAt as string) ?? null,
      });
    }
  } catch { /* fall through to the ranked path, which owns the description tier and the rescue ladder */ }

  // Rationale: docs/job-board-index-notes.md#n338-routedservesthisorder
  const routedServesThisOrder = body.sort !== "salary" && (routedRetriever === "company" || !newestFirst);
  if (!countOnly && routedServesThisOrder && (routedRetriever === "company" || routedRetriever === "simple")) try {
    // Rationale: docs/job-board-index-notes.md#n339-blockstart
    const blockStart = Math.floor(offset / ROUTE_WINDOW) * ROUTE_WINDOW;
    const routedExpand = routedRetriever === "company" ? { q: qText, expansions: [] as string[] } : expandQuery(qText);
    // Short and stop tokens literal, the rest stemmed (S11-004, n481); null keeps the whole-query match.
    const routedSplit = routedRetriever === "simple" ? simpleSplit(qText) : null;
    const routedAliases = routedSplit ? routedSplit.expansions : routedExpand.expansions;
    let rq = buildQuery("effective_posted", false, undefined, { skipTerms: true });
    rq = routedRetriever === "company" && routeDecision.tokens?.length
      ? rq.in("company_token", routeDecision.tokens)
      : routedSplit
      ? titleFilters(rq, routedSplit.filters)
      : rq.textSearch(
        "title",
        routedExpand.expansions.length ? ftsSafe(routedExpand.q) : ftsQuery(qText),
        { type: "websearch", config: "simple" },
      );
    const t_routed_retriever = Date.now();
    // Rationale: docs/job-board-index-notes.md#n340-routedread
    const routedRead = newestFirst && routedRetriever === "company"
      ? rq.order("posted_at", { ascending: false, nullsFirst: false })
      : rq.order("effective_posted", { ascending: false });
    const { data: routedRows, error: rErr } = await withDeadline(
      routedRead.order("id", { ascending: true })
        .range(blockStart, blockStart + ROUTE_WINDOW - 1),
      // Rationale: docs/job-board-index-notes.md#n882-math-min-routed_deadline_ms-budgetleft
      Math.min(ROUTED_DEADLINE_MS, budgetLeft()),
    ) as { data: unknown[] | null; error?: unknown };
    markFrom("routed_retriever", t_routed_retriever);
    if (routedRows === null) {
      console.warn(`[JOB-BOARD] routed retrieval (${routeDecision.route}) hit its deadline for q=${JSON.stringify(qText)}`);
    }
    if (!rErr && Array.isArray(routedRows) && routedRows.length > 0) {
      const mapped = (routedRows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
      // Rationale: docs/job-board-index-notes.md#n883-const-orderreadings-qtext-routedsplit-si
      const orderReadings = [qText, ...(routedSplit ? [singularReading(qText)] : []), ...routedAliases];
      const ordered = routedRetriever === "company" ? mapped : rerankWindow(mapped, orderReadings);
      // Sliced INSIDE the block: `offset` is a global position, the window is
      // now a block of it.
      const inBlock = offset - blockStart;
      const page = ordered.slice(inBlock, inBlock + limit);
      // A full block means there is more behind it; a short one means the block
      // IS the tail, so blockStart + its length is a real total.
      const blockFull = ordered.length >= ROUTE_WINDOW;
      const knownTotal = blockFull ? null : blockStart + ordered.length;
      const routedGrouped = groupSimilar
        ? collapseClusters(page, limit)
        : { jobs: page.slice(0, limit), rawConsumed: Math.min(page.length, limit) };
      if (routedGrouped.jobs.length > 0) {
        const routedServed = preferMatchedLocation(await attachRecheckedAt(client, routedGrouped.jobs, excludedTerms), locationTerms(body.location).terms);
        logSearch("ranked", routedGrouped.jobs.length, knownTotal, null, routedServed);
        return json({
          jobs: routedServed,
          searchId,
          ...searchDisclosures(body, applied, maxAgeClamped),
          ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
          ...coverageDisclosure(applied, meta),
          ...honesty(routedGrouped.jobs),
          // Rationale: docs/job-board-index-notes.md#n884-total-knowntotal
          total: knownTotal,
          // Rationale: docs/job-board-index-notes.md#n341-blockfull-countunavailable-true-totala
          ...(blockFull ? { countUnavailable: true, totalAtLeast: blockStart + ordered.length } : {}),
          hasMore: blockFull || inBlock + limit < ordered.length,
          // Rationale: docs/job-board-index-notes.md#n342-nextoffset-blockfull
          nextOffset: blockFull
            ? Math.min(offset + limit, blockStart + ROUTE_WINDOW)
            : Math.min(offset + limit, blockStart + ordered.length),
          searchRoute: routeDecision.route,
          searchRouteReason: routeDecision.reason,
          // Rationale: docs/job-board-index-notes.md#n885-routedretriever-company-ranked-true
          ...(routedRetriever === "company" ? {} : { ranked: true }),
          // Rationale: docs/job-board-index-notes.md#n343-newestfirst-routedretriever-company
          ...(newestFirst && routedRetriever === "company"
            ? { sortScope: "matchSet", sortMatcher: "company" }
            : {}),
          // Rationale: docs/job-board-index-notes.md#n886-routedexpand-expansions-length-aliases-r
          ...(routedExpand.expansions.length ? { aliases: routedExpand.expansions } : {}),
          // The split match binds its own alias phrases, and only those (n481).
          ...(routedSplit ? { aliases: routedSplit.expansions.length ? routedSplit.expansions : undefined } : {}),
          ...(routeDecision.matchedName ? { companyMatched: routeDecision.matchedName } : {}),
          ...exclusionCountsCaveat(excludedTerms),
          // The pre-exclusion figure, republished as the labelled ceiling it
          // is. knownTotal is null at the cap, so a full block offers nothing.
          ...exclusionCeiling(excludedTerms, knownTotal),
          totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
          companies: [],
          companiesCount: ((metaV.companiesCount as number | undefined) ?? ((metaV.companiesFacet as unknown[]) ?? []).length),
          ...(typeof metaV.companiesOpenCount === "number" ? { companiesOpenCount: metaV.companiesOpenCount } : {}),
          // Same core shape as every other exit — see the SALARY exit above.
          categories: {},
          failedSources: [], failedCount: 0,
          refreshedAt: (metaV.refreshedAt as string) ?? null,
        });
      }
    }
  } catch { /* fall through to the path this query would have taken anyway */ }

  // Rationale: docs/job-board-index-notes.md#n887-let-rankedfellback-string-null-null
  let rankedFellBack: string | null = null;
  // Rationale: docs/job-board-index-notes.md#n344-semanticdegraded
  let semanticDegraded: "embed" | "ann_deadline" | "ann_error" | "refilter_deadline" | null = null;
  // Rationale: docs/job-board-index-notes.md#n345-facet-company-limit
  const FACET_COMPANY_LIMIT = 150;
  // Rationale: docs/job-board-index-notes.md#n346-facetopen
  const facetOpen = (metaV as { companiesOpen?: Record<string, number> }).companiesOpen;
  const facetOpenMap = facetOpen && typeof facetOpen === "object" ? facetOpen : null;
  function facetHead(list: Array<{ token?: string; name?: string; count?: number; open?: number; tokens?: string[] }>) {
    // Rationale: docs/job-board-index-notes.md#n888-const-withopen-list-map-c
    const withOpen = list.map((c) =>
      typeof c.open === "number"
        ? c
        : (facetOpenMap && typeof c.token === "string" ? { ...c, open: facetOpenMap[c.token] ?? 0 } : c)
    );
    const merged = mergeCompanyFacet(
      withOpen.sort((a, b) => (b.open ?? b.count ?? 0) - (a.open ?? a.count ?? 0)),
    );
    const head = merged.slice(0, FACET_COMPANY_LIMIT);
    if (applied.companies.length) {
      const have = new Set(head.map((c) => c.token));
      for (const c of merged) {
        if (applied.companies.includes(String(c.token)) && !have.has(c.token)) head.push(c);
      }
    }
    // Rationale: docs/job-board-index-notes.md#n347-return-head-map-c
    return head.map((c) => ({
      token: c.token,
      name: c.name,
      ...(typeof c.open === "number" ? { open: c.open } : {}),
      ...(Array.isArray(c.tokens) && c.tokens.length > 1 ? { tokens: c.tokens } : {}),
    }));
  }
  // Same gate as the count above: a filter search_jobs cannot bind must not be
  // answered by search_jobs. buildQuery binds all six.
  if (qText && body.sort !== "salary" && !countOnly && !rpcBlindFilters(applied).length) {
    try {
      // Rationale: docs/job-board-index-notes.md#n889-const-q-expandedq-expansions-expandquery
      const { q: expandedQ, expansions } = expandQuery(qText);

      // Rationale: docs/job-board-index-notes.md#n348-headringp
      const headRingP: Promise<{ data: unknown[] | null }> | null =
        (scoreRanked && headTermRing && (!deepPage || ringMerged))
          ? (withDeadline(
              buildQuery("effective_posted", false, undefined, { skipTerms: true })
                .ilike("title", `${sanitizeTerm(qText)}%`)
                // The prefix ends at a word: "nurse" is not "Nursery" (L8-05).
                .filter("title", "imatch", ringWordPattern(sanitizeTerm(qText).toLowerCase()))
                .order("effective_posted", { ascending: false })
                .order("id", { ascending: true })
                .range(0, 199),
              Math.min(4_000, budgetLeft()),
            ) as Promise<{ data: unknown[] | null }>)
              .catch(() => ({ data: null }))
          : null;
      const t_head_ring_started = Date.now();

      const t_search_jobs_3 = Date.now();
      // On a clock: a missed full call is answered by the title tier (S11-009, n482).
      const rankedAnswer = await rankedWithDeadline(async (titleOnly) => await client.rpc("search_jobs", {
        p_q: expandedQ,
        p_fresh_cutoff: freshCutoffIso,
        p_location: rankedLocationParam(applied.location),
        p_remote: applied.remote ? true : null,
        p_country: applied.country,
        p_category: categoryParam(applied),
        // Spread-omitted when off: including the key (even null) against the
        // pre-p_sources SQL would 404 the whole RPC during the deploy window.
        ...sendableSourcesParam(applied),
        p_experience: applied.experience.length ? applied.experience : null,
        p_salary_floor: applied.salaryFloor,
        p_companies: applied.companies.length ? applied.companies : null,
        p_posted_after: postedAfterBound,
        p_max_age_days: null,
        ...payParams(applied),
        ...extraFilterParams(applied),
        // Rationale: docs/job-board-index-notes.md#n349-applied-workmode-p-work-mode-applied-wo
        ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
        ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
        ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
        // Rationale: docs/job-board-index-notes.md#n350-p-limit-pageplan-plimit
        p_limit: pagePlan.pLimit,
        p_offset: pagePlan.pOffset,
        ...(titleOnly ? { p_title_only: true } : {}),
      }), budgetLeft);
      const { data: ranked, error: rankErr } = rankedAnswer;
      markFrom("search_jobs", t_search_jobs_3);
      if (rankedAnswer.timedOut) {
        rankedFellBack = "deadline: search_jobs answered neither the full call nor the title tier in time";
        console.error(`[JOB-BOARD] ranked search missed both clocks for q=${JSON.stringify(qText)}`);
      }
      // Rationale: docs/job-board-index-notes.md#n890-if-rankerr
      if (rankErr) {
        rankedFellBack = (rankErr.code ? `${rankErr.code}: ` : "") +
          String(rankErr.message ?? rankErr).slice(0, 160);
        console.error(`[JOB-BOARD] ranked search failed for q=${JSON.stringify(qText)}: ${rankedFellBack}`);
      }
      if (!rankErr && Array.isArray(ranked)) {
        // Rationale: docs/job-board-index-notes.md#n891-const-trr-number-ranked-as-total_rows
        const trR = Number((ranked[0] as { total_rows?: number } | undefined)?.total_rows);
        const total = ranked.length ? (Number.isFinite(trR) ? trR : ranked.length) : (offset > 0 ? null : 0);
        // Rationale: docs/job-board-index-notes.md#n892-const-rrr-number-ranked-as-related_rows
        const rrR = Number((ranked[0] as { related_rows?: number | null } | undefined)?.related_rows);
        const related = ranked.length && Number.isFinite(rrR) ? rrR : null;
        // Rationale: docs/job-board-index-notes.md#n893-const-pagetotal-total-null-null-total
        const pageTotal = total === null ? null : total + (related ?? 0);
        // Rationale: docs/job-board-index-notes.md#n351-rankedtier2
        const rankedTier2 = (ranked as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string");
        const rankedCapped = related === null
          ? (total ?? 0) >= (rankedTier2 ? 3_000 : 10_000)
          : (total ?? 0) >= 10_000;
        // Rationale: docs/job-board-index-notes.md#n894-const-relatedcapped-related-null-total-r
        const relatedCapped = related !== null && (total ?? 0) + related >= 3_000;
        const v0 = (meta?.v ?? {}) as Record<string, unknown>;
        // Rationale: docs/job-board-index-notes.md#n352-non-narrowing
        const NON_NARROWING = new Set([...WIDENING_FILTERS, "sort", "q"]);
        const filtersActive =
          !!sanitizeTerm(String(body.location ?? "")) ||
          body.remote === true ||
          Object.entries(applied).some(([k, v]) => {
            if (NON_NARROWING.has(k)) return false;
            if (v === null || v === undefined || v === false || v === "") return false;
            if (Array.isArray(v)) return v.length > 0;
            return true;
          });
        // Rationale: docs/job-board-index-notes.md#n353-semanticrows
        const semanticRows = async (
          want: number,
          embedBudgetMs: number,
          exclude?: { ids: Set<string>; keys: Set<string> },
        ): Promise<Array<Record<string, unknown>>> => {
          // Rationale: docs/job-board-index-notes.md#n354-qtokens
          const qTokens = qText.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);
          if (qTokens.length === 0) return [];

          const t_embed_query = Date.now();
          const qVecRaw = await withDeadline(embedText(qText), Math.min(embedBudgetMs, budgetLeft()));
          markFrom("embed_query", t_embed_query);
          const qVec = Array.isArray(qVecRaw) ? qVecRaw as number[] : null;
          if (!qVec) {
            semanticDegraded = "embed";
            console.warn(`[JOB-BOARD] query embedding unavailable or past deadline for q=${JSON.stringify(qText)}`);
            return [];
          }
          const t_semantic = Date.now();
          const annMs = Math.min(5_000, budgetLeft());
          const { data: sem, error: sErr } = await withDeadline(
            client.rpc("search_jobs_semantic", { p_embedding: JSON.stringify(qVec), p_limit: want }),
            annMs,
          ) as { data: unknown; error: { code?: string; message?: string } | null | undefined };
          markFrom("semantic", t_semantic);
          // Rationale: docs/job-board-index-notes.md#n355-sem-null-serr
          if (sem === null && !sErr) {
            semanticDegraded = "ann_deadline";
            markFrom("semantic", t_semantic, "deadline");
            console.warn(`[JOB-BOARD] semantic ANN missed its ${annMs}ms deadline (or threw) for q=${JSON.stringify(qText)}`);
            return [];
          }
          if (sErr) {
            semanticDegraded = "ann_error";
            markFrom("semantic", t_semantic, "error");
            console.error(`[JOB-BOARD] semantic ANN failed for q=${JSON.stringify(qText)}: ${sErr.code ?? ""} ${String(sErr.message ?? sErr).slice(0, 120)}`);
            return [];
          }

          let semSource = Array.isArray(sem) ? (sem as Array<Record<string, unknown>>) : [];
          // Rationale: docs/job-board-index-notes.md#n356-semsource-length-0
          if (semSource.length > 0) {
            const semIds = semSource.map((r) => String(r.id ?? "")).filter(Boolean);
            const semRank = new Map(semIds.map((id, i) => [id, i]));
            const t_semantic_filtered = Date.now();
            const { data: semFiltered } = await withDeadline(
              buildQuery("effective_posted", false, undefined, { skipTerms: true })
                .in("id", semIds)
                .range(0, Math.max(semIds.length - 1, 0)),
              Math.min(4_000, budgetLeft()),
            ) as { data: unknown[] | null };
            markFrom("semantic_filtered", t_semantic_filtered);
            // Rationale: docs/job-board-index-notes.md#n895-if-semfiltered-null
            if (semFiltered === null) {
              semanticDegraded = "refilter_deadline";
              console.warn(`[JOB-BOARD] semantic re-filter exceeded its deadline for q=${JSON.stringify(qText)}`);
            }
            semSource = Array.isArray(semFiltered)
              ? (semFiltered as Array<Record<string, unknown>>)
                .sort((a, b) => (semRank.get(String(a.id)) ?? 0) - (semRank.get(String(b.id)) ?? 0))
              : [];
          }

          // Exclusion BEFORE the anchor, so the rows judged are the rows served.
          if (exclude) {
            semSource = semSource.filter((r) =>
              !exclude.ids.has(String(r.id ?? "")) &&
              !exclude.keys.has(rowClusterKey(r)));
          }
          const anchored = semSource.some((r) => {
            const hay = `${String(r.title ?? "")} ${String(r.company ?? "")}`.toLowerCase();
            return qTokens.some((w) => hay.includes(w));
          });
          return anchored ? semSource : [];
        };

        const rescueFilterParams = (): Record<string, unknown> => filtersActive ? {
          // Rationale: docs/job-board-index-notes.md#n357-applied-excludeagencies-p-exclude-agenci
          ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
          p_location: rankedLocationParam(applied.location),
          p_remote: applied.remote ? true : null,
          p_country: applied.country,
          p_category: categoryParam(applied),
          p_experience: applied.experience.length ? applied.experience : null,
          p_salary_floor: applied.salaryFloor,
          p_companies: applied.companies.length ? applied.companies : null,
          p_posted_after: postedAfterBound,
          p_max_age_days: null,
          ...payParams(applied),
          ...extraFilterParams(applied),
          p_work_mode: applied.workMode,
          ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
          // One producer for the vendor list; this function spells the parameter
          // differently for the reason recorded in the migration.
          ...rescueVendorsParam(applied),
        } : {};
        // Rationale: docs/job-board-index-notes.md#n358-if
        if (
          total !== null && total < 30 && ranked.length > 0 && offset === 0 && !countOnly &&
          !applied.location && !newestFirst
        ) {
          try {
            const words = qText.trim().split(/\s+/).filter(Boolean);
            const splits: Array<{ head: string; place: string }> = [];
            for (const n of [2, 1]) {
              if (words.length <= n) continue;
              const place = words.slice(-n).join(" ");
              // Rationale: docs/job-board-index-notes.md#n896-if-p-l-p-l-s
              if (!/^[\p{L}][\p{L}\s.'-]*$/u.test(place)) continue;
              // A word that qualifies a place never names one: "pilot united" became pilots anywhere "United" appears (L8-09).
              if (n === 1 && PLACE_QUALIFIERS.has(place.toLowerCase())) continue;
              splits.push({ head: words.slice(0, -n).join(" "), place });
            }
            if (splits.length > 0) {
              const t_location_split = Date.now();
              const probes = await Promise.all(splits.map((sp) =>
                (withDeadline(
                  client.rpc("search_jobs", {
                    p_q: sp.head,
                    p_fresh_cutoff: freshCutoffIso,
                    p_location: rankedLocationParam(sp.place),
                    p_remote: applied.remote ? true : null,
                    p_country: applied.country,
                    p_category: categoryParam(applied),
                    ...sendableSourcesParam(applied),
                    p_experience: applied.experience.length ? applied.experience : null,
                    p_salary_floor: applied.salaryFloor,
                    p_companies: applied.companies.length ? applied.companies : null,
                    p_posted_after: postedAfterBound,
                    p_max_age_days: null,
                    ...payParams(applied),
                    ...extraFilterParams(applied),
                    ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
        ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
        ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
                    p_limit: Math.max(limit * 2, 40),
                    p_offset: 0,
                  }),
                  // Rationale: docs/job-board-index-notes.md#n897-math-min-_500-budgetleft
                  Math.min(3_500, budgetLeft()),
                ) as Promise<{ data: unknown[] | null }>)
                  .catch(() => ({ data: null }))
              ));
              markFrom("location_split", t_location_split);
              // Rationale: docs/job-board-index-notes.md#n898-let-won-rows-array-record-string
              let won: { rows: Array<Record<string, unknown>>; head: string; place: string; hits: number } | null = null;
              for (let i = 0; i < splits.length && !won; i++) {
                const rows = probes[i]?.data;
                if (!Array.isArray(rows) || rows.length === 0) continue;
                const hits = Number((rows[0] as { total_rows?: number } | undefined)?.total_rows);
                // Rationale: docs/job-board-index-notes.md#n359-number-isfinite-hits-hits-math-ma
                if (!Number.isFinite(hits) || hits < Math.max(2 * total, 15)) continue;
                won = {
                  rows: (rows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>,
                  head: splits[i].head,
                  place: splits[i].place,
                  hits,
                };
              }
              if (won) {
                // Rationale: docs/job-board-index-notes.md#n899-const-splitjobs-excludedterms-length
                const splitJobs = excludedTerms.length
                  ? won.rows.filter((r) => !titleExcluded(String(r.title ?? ""), excludedTerms))
                  : won.rows;
                const splitScored = rerankWindow(splitJobs, [won.head]);
                const splitGrouped = groupSimilar
                  ? collapseClusters(splitScored, limit)
                  : { jobs: splitScored.slice(0, limit), rawConsumed: Math.min(splitScored.length, limit) };
                if (splitGrouped.jobs.length > 0) {
                  const splitServed = preferMatchedLocation(
                    await attachRecheckedAt(client, splitGrouped.jobs, excludedTerms),
                    locationTerms(won.place).terms,
                  );
                  logSearch("ranked", splitGrouped.jobs.length, won.hits, "fuzzy", splitServed);
                  return json({
                    jobs: splitServed,
                    searchId,
                    ...searchDisclosures(body, applied, maxAgeClamped),
                    ...englishDropDisclosure(body, stopwordTokens(won.head)),
                    ...intentDisclosure(intentLift),
                    ...exclusionDisclosure(excludedTerms),
                    ...coverageDisclosure(applied, meta),
                    ...honesty(splitGrouped.jobs),
                    // Rationale: docs/job-board-index-notes.md#n900-locationsplit-q-won-head-location-won
                    locationSplit: { q: won.head, location: won.place },
                    ranked: true,
                    // Rationale: docs/job-board-index-notes.md#n901-total-won-hits
                    total: won.hits,
                    ...(won.hits >= 10_000 ? { countCapped: true } : {}),
                    // Rationale: docs/job-board-index-notes.md#n902-hasmore-false
                    hasMore: false,
                    nextOffset: offset + splitGrouped.rawConsumed,
                    ...exclusionCountsCaveat(excludedTerms),
                    totalAllCompanies: safeMetaTotal ?? 0,
                    ...(trackedTotal !== null ? { trackedTotal } : {}),
                    companies: [],
                    companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
                    ...(typeof v0.companiesOpenCount === "number" ? { companiesOpenCount: v0.companiesOpenCount } : {}),
                    categories: {},
                    failedSources: [], failedCount: 0,
                    refreshedAt: (v0.refreshedAt as string) ?? null,
                  });
                }
              }
            }
          } catch { /* the description-only page below is still a page */ }
        }

        // Rationale: docs/job-board-index-notes.md#n360-ranked-length-0-offset-0
        if (ranked.length === 0 && offset === 0 && !countOnly) {
          // Rationale: docs/job-board-index-notes.md#n361-logmiss
          const logMiss = (rescued: "none" | "fuzzy" | "semantic" | "degraded") => {
            const missQ0 = qText.slice(0, 120);
            const missLoc0 = sanitizeTerm(String(body.location ?? "")).slice(0, 120);
            if (noLog || (!missQ0 && !missLoc0)) return;
            waitUntil(Promise.resolve(
              client.from("job_board_search_misses").insert({
                q: missQ0,
                location: missLoc0,
                filters: {
                  route: "ranked",
                  rescued,
                  category: applied.category ?? undefined,
                  experience: applied.experience.join(",") || undefined,
                  remote: body.remote === true || undefined,
                  workMode: applied.workMode ?? undefined,
                  country: applied.country ?? undefined,
                },
              }),
            ).then(() => {}).catch(() => {}));
          };
          // Rationale: docs/job-board-index-notes.md#n362-simpletierprovedempty
          let simpleTierProvedEmpty = false;
          let fuzzyTierProvedEmpty = false;
          // Rationale: docs/job-board-index-notes.md#n363-qtext-length-2-try
          if (qText.length >= 2) try {
            // Rationale: docs/job-board-index-notes.md#n903-const-t_simple_config-date-now
            const t_simple_config = Date.now();
            const { data: simpleRows, error: sErr2 } = await withDeadline(
              // Rationale: docs/job-board-index-notes.md#n364-promise-allsettled
              Promise.allSettled([
                buildQuery("effective_posted", false, undefined, { skipTerms: true })
                  .textSearch("title", ftsQuery(qText), { type: "websearch", config: "simple" })
                  .order("effective_posted", { ascending: false, nullsFirst: false })
                  .order("id", { ascending: true })
                  .range(0, Math.max(limit * 2 - 1, 0)),
                // Rationale: docs/job-board-index-notes.md#n365-buildquery-effective-posted-false-undefined
                buildQuery("effective_posted", false, undefined, { skipTerms: true })
                  .textSearch("company", ftsQuery(qText), { type: "websearch", config: "simple" })
                  .order("effective_posted", { ascending: false })
                  .order("id", { ascending: true })
                  .range(0, Math.max(limit * 2 - 1, 0)),
              ]).then((settled) => {
                // Rationale: docs/job-board-index-notes.md#n904-const-halves-settled-map-r
                const halves = settled.map((r) =>
                  r.status === "fulfilled" ? r.value as { data?: unknown[] | null; error?: unknown } : null);
                // Rationale: docs/job-board-index-notes.md#n366-simpletierprovedempty-halves-every-h
                simpleTierProvedEmpty = halves.every((h) =>
                  h && !h.error && Array.isArray(h.data) && h.data.length === 0);
                return {
                  data: halves.flatMap((h) => (h?.data ?? []) as unknown[]),
                  error: null,
                };
              }),
              // Rationale: docs/job-board-index-notes.md#n367-math-min-7-000-budgetleft
              Math.min(7_000, budgetLeft()),
            ) as { data: unknown[] | null; error?: unknown };
            markFrom("simple_config", t_simple_config);
            // Rationale: docs/job-board-index-notes.md#n905-if-simplerows-null
            if (simpleRows === null) {
              console.warn(`[JOB-BOARD] exact-word tier exceeded its deadline for q=${JSON.stringify(qText)}`);
            }
            if (!sErr2 && Array.isArray(simpleRows) && simpleRows.length > 0) {
              // Rationale: docs/job-board-index-notes.md#n906-const-seensimple-new-set-string
              const seenSimple = new Set<string>();
              const simpleJobs = ((simpleRows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>)
                .filter((r) => {
                  const id = String(r.id ?? "");
                  if (!id || seenSimple.has(id)) return false;
                  seenSimple.add(id);
                  return true;
                });
              const simpleGrouped = groupSimilar
                ? collapseClusters(simpleJobs, limit)
                : { jobs: simpleJobs.slice(0, limit), rawConsumed: Math.min(simpleJobs.length, limit) };
              logMiss("fuzzy");
              const simpleServed = preferMatchedLocation(await attachRecheckedAt(client, simpleGrouped.jobs, excludedTerms), locationTerms(body.location).terms);
              logSearch("ranked", simpleGrouped.jobs.length, null, "fuzzy", simpleServed);
              return json({
                jobs: simpleServed,
                searchId,
                ...searchDisclosures(body, applied, maxAgeClamped),
                ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
                ...coverageDisclosure(applied, meta),
                ...honesty(simpleGrouped.jobs),
                // Rationale: docs/job-board-index-notes.md#n907-total-null
                total: null,
                countUnavailable: true,
                hasMore: false,
                // Rationale: docs/job-board-index-notes.md#n908-nextoffset-offset-simplegrouped-jobs-len
                nextOffset: offset + simpleGrouped.jobs.length,
                // Rationale: docs/job-board-index-notes.md#n909-exactwordmatch-qtext
                exactWordMatch: qText,
                // Rationale: docs/job-board-index-notes.md#n368-exclusioncountscaveat-excludedterms
                ...exclusionCountsCaveat(excludedTerms),
                totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                companies: [],
                companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
                ...(typeof v0.companiesOpenCount === "number" ? { companiesOpenCount: v0.companiesOpenCount } : {}),
                categories: {},
                failedSources: [], failedCount: 0,
                refreshedAt: (v0.refreshedAt as string) ?? null,
              });
            }
          } catch { /* the empty page the visitor already had */ }

          // Rationale: docs/job-board-index-notes.md#n369-qtext-length-3-try
          if (qText.length >= 3) try {
            const t_fuzzy_title_search_2 = Date.now();
            // Rationale: docs/job-board-index-notes.md#n910-const-data-fuzzy-error-ferr-await
            const { data: fuzzy, error: fErr } = await withDeadline(
              client.rpc("fuzzy_title_search", {
                p_q: qText, p_fresh_cutoff: freshCutoffIso, p_limit: limit,
                ...rescueFilterParams(),
              }),
              Math.min(4_000, budgetLeft()),
            ) as { data: unknown[] | null; error?: unknown };
            markFrom("fuzzy_title_search", t_fuzzy_title_search_2);
            // Rationale: docs/job-board-index-notes.md#n911-if-ferr-array-isarray-fuzzy-fuzzytierpro
            if (!fErr && Array.isArray(fuzzy)) fuzzyTierProvedEmpty = fuzzy.length === 0;
            if (!fErr && Array.isArray(fuzzy) && fuzzy.length > 0) {
              // Rationale: docs/job-board-index-notes.md#n912-const-fuzzyrows-fuzzy-as-unknown-map
              const fuzzyRows = (fuzzy as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              const fuzzyGrouped = groupSimilar
                ? collapseClusters(fuzzyRows, limit)
                : { jobs: fuzzyRows.slice(0, limit), rawConsumed: Math.min(fuzzyRows.length, limit) };
              logMiss("fuzzy");
              // Rationale: docs/job-board-index-notes.md#n370-fuzzy-rpc-cap
              const FUZZY_RPC_CAP = 60;
              const fzCap = Math.min(limit, FUZZY_RPC_CAP);
              const fzTotal = Number((fuzzy[0] as { total_rows?: number }).total_rows);
              const fzKnown = Number.isFinite(fzTotal) && fzTotal > 0 && fzTotal < fzCap;
              const fuzzyServed = preferMatchedLocation(await attachRecheckedAt(client, fuzzyGrouped.jobs, excludedTerms), locationTerms(body.location).terms);
              logSearch("fuzzy", fuzzyGrouped.jobs.length, fzKnown ? fzTotal : null, "fuzzy", fuzzyServed);
              return json({
                jobs: fuzzyServed,
                searchId,
                ...searchDisclosures(body, applied, maxAgeClamped),
                ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
                ...coverageDisclosure(applied, meta),
                ...honesty(fuzzyGrouped.jobs),
                // Rationale: docs/job-board-index-notes.md#n371-hasmore-false
                hasMore: false,
                // Rationale: docs/job-board-index-notes.md#n913-nextoffset-offset-fuzzygrouped-jobs-leng
                nextOffset: offset + fuzzyGrouped.jobs.length,
                total: fzKnown ? fzTotal : null,
                // Rationale: docs/job-board-index-notes.md#n914-fzknown
                ...(fzKnown ? {} : {
                  countUnavailable: true,
                  totalAtLeast: Number.isFinite(fzTotal) && fzTotal >= fzCap ? fzTotal : fuzzyGrouped.jobs.length,
                }),
                ...exclusionCountsCaveat(excludedTerms),
                totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                companies: [],
                companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
                ...(typeof v0.companiesOpenCount === "number" ? { companiesOpenCount: v0.companiesOpenCount } : {}),
                // Rationale: docs/job-board-index-notes.md#n915-categories-visiblecategories-v0-categori
          categories: visibleCategories(v0.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
                failedSources: (v0.failedSources as string[]) ?? [],
          failedCount: (v0.failedCount as number | undefined) ?? 0,
                refreshedAt: (v0.refreshedAt as string) ?? null,
                fuzzy: qText,
              });
            }
          } catch { /* fuzzy is a bonus — fall to the honest empty below */ }
          // Rationale: docs/job-board-index-notes.md#n372-qtokencount
          const qTokenCount = qText.trim().split(/\s+/).filter(Boolean).length;
          if (qText.length >= 3 && !(simpleTierProvedEmpty && fuzzyTierProvedEmpty && qTokenCount <= 1)) {
            try {
              // Rationale: docs/job-board-index-notes.md#n916-const-semsource-await-semanticrows-fetch
              const semSource = await semanticRows(fetchLimit, 2_500);
                if (semSource.length > 0) {
                  // Rationale: docs/job-board-index-notes.md#n917-const-semrows-semsource-as-unknown-map
                  const semRows = (semSource as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
                  const semGrouped = groupSimilar
                    ? collapseClusters(semRows, limit)
                    : { jobs: semRows.slice(0, limit), rawConsumed: Math.min(semRows.length, limit) };
                  logMiss("semantic");
                  const semServed = preferMatchedLocation(await attachRecheckedAt(client, semGrouped.jobs, excludedTerms), locationTerms(body.location).terms);
                  logSearch("semantic", semGrouped.jobs.length, semGrouped.jobs.length, "semantic", semServed);
                  return json({
                    jobs: semServed,
                    searchId,
                    ...searchDisclosures(body, applied, maxAgeClamped),
                    ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
                    ...coverageDisclosure(applied, meta),
                    ...honesty(semGrouped.jobs),
                    total: semGrouped.jobs.length,
                    hasMore: false,
                    // Rationale: docs/job-board-index-notes.md#n918-nextoffset-offset-semgrouped-jobs-length
                    nextOffset: offset + semGrouped.jobs.length,
                    ...exclusionCountsCaveat(excludedTerms),
                    totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                    companies: [],
                    companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
                    ...(typeof v0.companiesOpenCount === "number" ? { companiesOpenCount: v0.companiesOpenCount } : {}),
                    // Rationale: docs/job-board-index-notes.md#n919-categories-visiblecategories-v0-categori
          categories: visibleCategories(v0.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
                    failedSources: (v0.failedSources as string[]) ?? [],
          failedCount: (v0.failedCount as number | undefined) ?? 0,
                    refreshedAt: (v0.refreshedAt as string) ?? null,
                    semantic: qText,
                  });
                }
            } catch { /* semantic is a bonus — the honest empty below stands */ }
          }
          // Neither rescue tier answered (or filters kept them fenced out):
          // this is the real "we lack it" signal the census steers by.
          logMiss(semanticDegraded ? "degraded" : "none");
        }
        const includeFacets0 = (body as { includeFacets?: boolean }).includeFacets !== false;
        const fullCompanies0 = (v0.companiesFacet as Array<{ count?: number }>) ?? [];
        const rankedRows = (ranked as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
        // Rationale: docs/job-board-index-notes.md#n373-newestfirst
        if (newestFirst) {
          rankedRows.sort((a, b) => {
            const da = Date.parse(String(a.postedAt ?? "")) || 0;
            const db = Date.parse(String(b.postedAt ?? "")) || 0;
            return db - da;
          });
        }
        // Rationale: docs/job-board-index-notes.md#n374-headrows
        let headRows: Array<Record<string, unknown>> = [];
        // Rationale: docs/job-board-index-notes.md#n375-ringresolved
        let ringResolved = headRingP === null; // no ring wanted == trivially "known: nothing"
        if (headRingP) {
          try {
            // Rationale: docs/job-board-index-notes.md#n920-const-data-hr-await-headringp
            const { data: hr } = await headRingP;
            markFrom("head_ring", t_head_ring_started);
            if (Array.isArray(hr)) {
              headRows = (hr as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              ringResolved = true;
            } else {
              console.warn(`[JOB-BOARD] head-term ring missed its deadline for q=${JSON.stringify(qText)}`);
            }
          } catch { /* the ranked window alone is still a valid page */ }
        }
        // Rationale: docs/job-board-index-notes.md#n921-const-mergedseen-new-set-string
        const mergedSeen = new Set<string>();
        let mergedRows: Array<Record<string, unknown>>;
        // Rationale: docs/job-board-index-notes.md#n922-let-deepringrawused-consumedsurvivors-nu
        let deepRingRawUsed: ((consumedSurvivors: number) => number) | null = null;
        if (deepPage && ringMerged) {
          // Rationale: docs/job-board-index-notes.md#n376-ringids
          const ringIds = ringResolved
            ? new Set(headRows.map((r) => String((r as Record<string, unknown>).id ?? "")).filter(Boolean))
            : null;
          const ringPrefix = sanitizeTerm(qText).toLowerCase();
          const excluded = (r: Record<string, unknown>) =>
            ringIds
              ? ringIds.has(String(r.id ?? ""))
              : ringPrefix.length > 0 && startsWithWord(String(r.title ?? "").toLowerCase(), ringPrefix);
          const rawIndexOfSurvivor: number[] = [];
          mergedRows = rankedRows.filter((r, i) => {
            const keep = !excluded(r as Record<string, unknown>);
            if (keep) rawIndexOfSurvivor.push(i);
            return keep;
          });
          deepRingRawUsed = (n) =>
            // Rationale: docs/job-board-index-notes.md#n923-n
            n <= 0
              ? (mergedRows.length === 0 ? rankedRows.length : 0)
              : n >= rawIndexOfSurvivor.length
              ? rankedRows.length
              : rawIndexOfSurvivor[n - 1] + 1;
        } else {
          mergedRows = [...headRows, ...rankedRows].filter((r) => {
            const id = String((r as Record<string, unknown>).id ?? "");
            if (!id || mergedSeen.has(id)) return false;
            mergedSeen.add(id);
            return true;
          });
        }
        // Rationale: docs/job-board-index-notes.md#n377-rankedscored
        const rankedScored = pagePlan.rerank ? rerankWindow(mergedRows, [qText, ...expansions]) : mergedRows;
        // Rationale: docs/job-board-index-notes.md#n378-rankedwindow
        const rankedWindow = rankedScored.slice(pagePlan.sliceStart, pagePlan.sliceEnd);
        const rankedSequence = rankedWindow;
        let rankedGrouped = groupSimilar
          ? collapseClusters(rankedWindow, limit)
          : { jobs: rankedWindow.slice(0, limit), rawConsumed: Math.min(rankedWindow.length, limit) };
        // Ring-merged deep page: convert rawConsumed from survivor units to
        // RAW SQL rows so nextOffset keeps walking SQL rank — see the mapper.
        if (deepRingRawUsed) {
          rankedGrouped = { ...rankedGrouped, rawConsumed: deepRingRawUsed(rankedGrouped.rawConsumed) };
        }
        // Rationale: docs/job-board-index-notes.md#n379-poolexhausted
        const poolExhausted = ringMerged && !deepPage && (
          ringResolved
            ? offset + rankedGrouped.rawConsumed >= rankedScored.length
            : offset + rankedGrouped.rawConsumed >= RANKED_WINDOW
        );
        // Rationale: docs/job-board-index-notes.md#n380-deeppage-scoreranked-rankedgrouped
        if (deepPage && scoreRanked && rankedGrouped.jobs.length > 1) {
          rankedGrouped = { ...rankedGrouped, jobs: rerankWindow(rankedGrouped.jobs, [qText, ...expansions]) };
        }

        // Rationale: docs/job-board-index-notes.md#n381-fuzzy-augment-below
        const FUZZY_AUGMENT_BELOW = 20;
        let fuzzyTitlesForDym: string[] | null = null;
        let fuzzyExtraOut: { q: string; count: number } | null = null;
        let semanticExtraOut: { q: string; count: number } | null = null;
        // Rationale: docs/job-board-index-notes.md#n382-pagetotal-null-pagetotal-0-p
        if (pageTotal !== null && pageTotal > 0 && pageTotal < FUZZY_AUGMENT_BELOW && offset === 0 && !countOnly && !newestFirst && qText.length >= 3 && budgetLeft() > 2_000) {
          try {
            const t_fuzzy_title_search_0 = Date.now();
            const { data: fz, error: fzErr } = await withDeadline(
              client.rpc("fuzzy_title_search", {
                p_q: qText, p_fresh_cutoff: freshCutoffIso, p_limit: limit,
                ...rescueFilterParams(),
              }),
              Math.min(2_000, budgetLeft()),
            ) as { data: unknown[] | null; error?: unknown };
            markFrom("fuzzy_title_search", t_fuzzy_title_search_0);
            // Rationale: docs/job-board-index-notes.md#n924-if-fzerr-array-isarray-fz-fuzzytitlesfor
            if (!fzErr && Array.isArray(fz)) fuzzyTitlesForDym = (fz as Array<{ title?: unknown }>).map((r) => String(r.title ?? ""));
            if (!fzErr && Array.isArray(fz) && fz.length > 0) {
              // Rationale: docs/job-board-index-notes.md#n925-const-havekeys-new-set-rankedgrouped-job
              const haveKeys = new Set(rankedGrouped.jobs.map((j) => {
                const r = j as Record<string, unknown>;
                return rowClusterKey(r);
              }));
              const fuzzyRows = (fz as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              const room = Math.max(0, limit - rankedGrouped.jobs.length);
              // Rationale: docs/job-board-index-notes.md#n926-const-novel-fuzzyrows-filter-r
              const novel = fuzzyRows.filter((r) =>
                !haveKeys.has(rowClusterKey(r)) &&
                !(excludedTerms.length && titleExcluded(String(r.title ?? ""), excludedTerms)));
              const extra = (groupSimilar ? collapseClusters(novel, room).jobs : novel.slice(0, room))
                .map((j) => ({ ...(j as Record<string, unknown>), closeMatch: true }));
              if (extra.length > 0) {
                // Rationale: docs/job-board-index-notes.md#n383-terms
                const terms = queryTerms(qText).terms.map((t) => t.toLowerCase()).filter((t) => t && t !== "or");
                const inTitle = (r: unknown) => {
                  const t = String((r as Record<string, unknown>).title ?? "").toLowerCase();
                  return terms.length > 0 && terms.some((term) => t.includes(term));
                };
                const titleHits = rankedGrouped.jobs.filter(inTitle);
                const bodyOnly = rankedGrouped.jobs.filter((j) => !inTitle(j));
                rankedGrouped.jobs = [...titleHits, ...extra, ...bodyOnly];
                fuzzyExtraOut = { q: qText, count: extra.length };
              }
            }
          } catch { /* augmentation is a bonus — exact matches alone stand */ }
        }
        // Rationale: docs/job-board-index-notes.md#n384-if
        if (
          semanticExtraOut === null &&
          pageTotal !== null && pageTotal > 0 && pageTotal < FUZZY_AUGMENT_BELOW &&
          // Rationale: docs/job-board-index-notes.md#n927-offset-countonly-newestfirst-qtext-lengt
          offset === 0 && !countOnly && !newestFirst && qText.length >= 3 &&
          rankedGrouped.jobs.length < limit && budgetLeft() > 3_000
        ) {
          try {
            const room = Math.max(0, limit - rankedGrouped.jobs.length);
            // Rationale: docs/job-board-index-notes.md#n928-const-haveids-new-set-rankedgrouped-jobs
            const haveIds = new Set(rankedGrouped.jobs.map((j) => String((j as Record<string, unknown>).id ?? "")));
            const haveKeys2 = new Set(rankedGrouped.jobs.map((j) =>
              rowClusterKey(j as Record<string, unknown>)));
            const semSource = await semanticRows(Math.min(room * 3, 60), 1_500, { ids: haveIds, keys: haveKeys2 });
            if (semSource.length > 0) {
              // Rationale: docs/job-board-index-notes.md#n929-const-novelsem-semsource-as-unknown-map
              const novelSem = ((semSource as unknown[]).map(rowToJob) as Array<Record<string, unknown>>)
                .filter((r) => !(excludedTerms.length && titleExcluded(String(r.title ?? ""), excludedTerms)));
              const semExtra = (groupSimilar ? collapseClusters(novelSem, room).jobs : novelSem.slice(0, room))
                .map((j) => ({ ...(j as Record<string, unknown>), semanticMatch: true }));
              if (semExtra.length > 0) {
                rankedGrouped = { ...rankedGrouped, jobs: [...rankedGrouped.jobs, ...semExtra] };
                semanticExtraOut = { q: qText, count: semExtra.length };
              }
            }
          } catch { /* an augmentation is a bonus — the page it already has is correct */ }
        }
        // Rationale: docs/job-board-index-notes.md#n930-const-augmented-fuzzyextraout-null-seman
        const augmented = fuzzyExtraOut !== null || semanticExtraOut !== null;
        // Rationale: docs/job-board-index-notes.md#n931-const-countedreached-rowsreached
        const countedReached = rowsReached({
          deepPage, pOffset: pagePlan.pOffset, offset, rawConsumed: rankedGrouped.rawConsumed,
          poolLength: rankedScored.length, sqlRowsOnPage: rankedRows.length,
        });
        const totalUnderstated = !augmented && typeof pageTotal === "number" && countedReached > pageTotal;
        // "c#" and "c++" parse to the bare letter, so search_jobs' count is not this query's (L8-17).
        const symbolQuery = qClass?.route === "SYMBOL";
        const symbolFloor = symbolQuery ? symbolLiteralRows(rankedScored, qText) : 0;
        const countWithheld = augmented || totalUnderstated || symbolQuery;
        // Rationale: docs/job-board-index-notes.md#n385-earneddym
        let earnedDym: string | null = null;
        if (
          fuzzyTitlesForDym && fuzzyTitlesForDym.length >= 5 && !newestFirst &&
          !DID_YOU_MEAN[String(body.q ?? "").trim().toLowerCase()]
        ) {
          try {
            const titles = fuzzyTitlesForDym.map((t) => t.toLowerCase());
            // Unicode letters, not [a-z]: splitting on ä/é shatters a word and
            // then "corrects" the fragment inside it.
            const titleWords = titles.map((t) => new Set(t.split(/[^\p{L}]+/u).filter((w) => w.length >= 4)));
            const allWords = new Set(titleWords.flatMap((ws) => [...ws]));
            const tokens = qText.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
            for (const tok of tokens) {
              // Rationale: docs/job-board-index-notes.md#n386-toksupport
              const tokSupport = titleWords.filter((ws) => ws.has(tok)).length;
              for (const w of allWords) {
                if (w === tok || !within2Edits(tok, w)) continue;
                // Rationale: docs/job-board-index-notes.md#n932-const-support-titlewords-filter-ws-ws
                const support = titleWords.filter((ws) => ws.has(w)).length;
                if (support >= 3 && support >= tokSupport * 3) {
                  // Rationale: docs/job-board-index-notes.md#n933-earneddym-qtext-tolowercase-replace-new
                  earnedDym = qText.toLowerCase().replace(new RegExp(`(?<=^|[^\\p{L}])${tok}(?=$|[^\\p{L}])`, "u"), w);
                  break;
                }
              }
              if (earnedDym) break;
            }
          } catch { /* a suggestion is a bonus — the thin page stands */ }
        }

        // Rationale: docs/job-board-index-notes.md#n387-rankedserved
        const rankedServed = preferMatchedLocation(await attachRecheckedAt(client, rankedGrouped.jobs, excludedTerms), locationTerms(body.location).terms);
        logSearch("ranked", rankedGrouped.jobs.length, countWithheld ? null : total, null, rankedServed);
        return json({
          jobs: rankedServed,
          searchId,
          ...searchDisclosures(body, applied, maxAgeClamped),
          ...englishDropDisclosure(body, stopwordTokens(qText)),
          ...(earnedDym ? { didYouMean: earnedDym } : {}),
          ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
          ...coverageDisclosure(applied, meta),
          ...honesty(rankedGrouped.jobs),
          ...(augmented || symbolQuery ? { countUnavailable: true } : {}),
          ...(symbolQuery && !totalUnderstated && symbolFloor > 0 ? { totalAtLeast: symbolFloor } : {}),
          // Rationale: docs/job-board-index-notes.md#n388-newestfirst
          ...(newestFirst
            ? { sortScope: "relevanceWindow", sortScopeRows: ringMerged ? RING_WINDOW : RANKED_WINDOW }
            : {}),
          // Rationale: docs/job-board-index-notes.md#n934-nextoffset-poolexhausted-ring_window-off
          nextOffset: poolExhausted ? RING_WINDOW : offset + rankedGrouped.rawConsumed,
          // Rationale: docs/job-board-index-notes.md#n389-hasmore-deeppage
          hasMore: deepPage
            ? (rankedSequence.length > rankedGrouped.rawConsumed || rankedRows.length >= fetchLimit)
            : ringMerged
            ? (rankedSequence.length > rankedGrouped.rawConsumed
              || (pageTotal !== null && pageTotal > RANKED_WINDOW))
            : (newestFirst || scoreRanked)
            ? (rankedSequence.length > rankedGrouped.rawConsumed
              || (deepPageable && pageTotal !== null && offset + rankedGrouped.rawConsumed < pageTotal))
            : (rankedSequence.length > rankedGrouped.rawConsumed || rankedSequence.length >= fetchLimit),
          // Rationale: docs/job-board-index-notes.md#n390-total-augmented-totalunderstated-null-to
          total: countWithheld ? null : total,
          ...(totalUnderstated ? { countUnavailable: true, totalAtLeast: countedReached } : {}),
          // Rationale: docs/job-board-index-notes.md#n391-augmented-totalunderstated-related
          ...(countWithheld || related === null || related === 0
            ? {}
            : { relatedTotal: related, ...(relatedCapped ? { relatedCapped: true } : {}) }),
          // The description tier missed its clock: not looked at, so not zero.
          ...(rankedAnswer.cut ? { relatedUnavailable: true } : {}),
          ...(rankedCapped && !symbolQuery ? { countCapped: true } : {}),
          ...exclusionCountsCaveat(excludedTerms),
          // Rationale: docs/job-board-index-notes.md#n392-augmented-totalunderstated-exclusi
          ...(countWithheld ? {} : exclusionCeiling(excludedTerms, total)),
          totalAllCompanies: safeMetaTotal ?? total,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
          companies: includeFacets0
            // Rationale: docs/job-board-index-notes.md#n935-facethead-fullcompanies0-as-array-token
            ? facetHead(fullCompanies0 as Array<{ token?: string; name?: string; count?: number; open?: number }>)
                .sort((a, b) => (b.open ?? 0) - (a.open ?? 0))
            : [],
          // Rationale: docs/job-board-index-notes.md#n936-companiescount-v0-companiescount-as-numb
          companiesCount: ((v0.companiesCount as number | undefined) ?? fullCompanies0.length),
          ...(typeof v0.companiesOpenCount === "number" ? { companiesOpenCount: v0.companiesOpenCount } : {}),
          // Rationale: docs/job-board-index-notes.md#n937-categories-visiblecategories-v0-categori
          categories: visibleCategories(v0.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
          failedSources: (v0.failedSources as string[]) ?? [],
          failedCount: (v0.failedCount as number | undefined) ?? 0,
          refreshedAt: (v0.refreshedAt as string) ?? null,
          ranked: true,
          // Rationale: docs/job-board-index-notes.md#n938-semanticdegraded-semanticdegraded
          ...(semanticDegraded ? { semanticDegraded } : {}),
          ...(expansions.length ? { aliases: expansions } : {}),
          ...(fuzzyExtraOut ? { fuzzyExtra: fuzzyExtraOut } : {}),
          // Rationale: docs/job-board-index-notes.md#n939-semanticextraout-semanticextra-semantice
          ...(semanticExtraOut ? { semanticExtra: semanticExtraOut } : {}),
        });
      }
    } catch (e) {
      // Rationale: docs/job-board-index-notes.md#n940-console-error-job-board-ranked-path
      console.error(`[JOB-BOARD] ranked path failed, serving recency instead: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
      rankedFellBack = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 160) : String(e).slice(0, 160);
    }
  }
  const sortSalary = body.sort === "salary";
  // Rationale: docs/job-board-index-notes.md#n393-twosubset
  const twoSubset = !!applied.category && applied.includeUncategorised;
  // Rationale: docs/job-board-index-notes.md#n394-twosubsetlimit
  const twoSubsetLimit = Math.min(fetchLimit, limit);
  const fetchUsed = twoSubset ? twoSubsetLimit : fetchLimit;

  // Rationale: docs/job-board-index-notes.md#n395-ordered
  const ordered = (q: any, dateCol: string, salaryCol: string) =>
    (sortSalary
      ? q.order(salaryCol, { ascending: false, nullsFirst: false })
      : newestFirst
        ? q.order("posted_at", { ascending: false, nullsFirst: false })
        : q.order(dateCol, { ascending: false, nullsFirst: false })
    ).order("id", { ascending: true });

  // Rationale: docs/job-board-index-notes.md#n396-pagewith
  const pageWith = async (dateCol: string, salaryCol: string, withCount: boolean) => {
    const t0 = Date.now();
    try { return await pageWithInner(dateCol, salaryCol, withCount); }
    finally { markFrom("page_query", t0); }
  };
  const pageWithInner = async (dateCol: string, salaryCol: string, withCount: boolean) => {
    if (!twoSubset) {
      // Rationale: docs/job-board-index-notes.md#n397-cursor-sortsalary-newestfirst
      if (cursor && !sortSalary && !newestFirst) {
        return await ordered(buildQuery(dateCol, withCount), dateCol, salaryCol)
          .or(`${dateCol}.lt."${cursor.ep}",and(${dateCol}.eq."${cursor.ep}",id.gt."${cursor.id}")`)
          .limit(fetchLimit);
      }
      // Rationale: docs/job-board-index-notes.md#n398-cursor-cursor-k-pa-sortsala
      if (cursor && cursor.k === "pa" && !sortSalary && newestFirst) {
        const seek = await ordered(buildQuery(dateCol, withCount), dateCol, salaryCol)
          .or(`posted_at.lt."${cursor.ep}",and(posted_at.eq."${cursor.ep}",id.gt."${cursor.id}")`)
          .limit(fetchLimit);
        if (seek.error || ((seek.data ?? []) as unknown[]).length >= fetchLimit) return seek;
        return await ordered(buildQuery(dateCol, withCount), dateCol, salaryCol)
          .range(offset, offset + fetchLimit - 1);
      }
      return await ordered(buildQuery(dateCol, withCount), dateCol, salaryCol)
        .range(offset, offset + fetchLimit - 1);
    }
    // Rationale: docs/job-board-index-notes.md#n941-const-acount-await-buildquery-datecol-tr
    const aCount = await buildQuery(dateCol, true, applied.category!).range(0, 0);
    if (aCount.error) return aCount;
    const countA = aCount.count ?? 0;
    // NO GROUPING OVER-FETCH ON THIS PATH, and the cliff is steep.
    //
    // `fetchLimit` is 3x `limit` when grouping is on, so it asks the `other`
    // half for a much wider range. Measured on legal+DE at offset 60:
    //
    //     fetchLimit 180   500 after 43s
    //     fetchLimit  60   200 in   5.1s
    //
    // Reading the unsorted bucket is simply expensive — it is 162,800 rows with
    // no index supporting this shape — and the over-fetch multiplies exactly
    // the query that cannot afford it. Grouping still runs, with `limit`
    // candidates instead of 3x; slightly less clustering on a rare opt-in path
    // is worth incomparably more than a 43-second 500 on page two.
    //
    // This BOUNDS the cost, it does not fix it: ~5s against a normal ~0.3s
    // page. The real fix is an index for (category, country, effective_posted),
    // which is a migration and a separate decision.
    const s = splitPage(offset, twoSubsetLimit, countA);

    const [ra, rb] = await Promise.all([
      s.aLimit > 0
        ? ordered(buildQuery(dateCol, false, applied.category!), dateCol, salaryCol)
            .range(s.aOffset, s.aOffset + s.aLimit - 1)
        : Promise.resolve({ data: [], error: null }),
      s.bLimit > 0
        ? ordered(buildQuery(dateCol, false, "other"), dateCol, salaryCol)
            .range(s.bOffset, s.bOffset + s.bLimit - 1)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (ra.error) return ra;
    if (rb.error) return rb;

    // Rationale: docs/job-board-index-notes.md#n942-let-count-number-null-null
    let count: number | null = null;
    if (withCount) {
      const bCount = await buildQuery(dateCol, true, "other").range(0, 0);
      count = bCount.error ? null : countA + (bCount.count ?? 0);
    }
    return { data: [...(ra.data ?? []), ...(rb.data ?? [])], error: null, count };
  };

  // Rationale: docs/job-board-index-notes.md#n399-count-deadline-ms
  const COUNT_DEADLINE_MS = 1_500;
  // Rationale: docs/job-board-index-notes.md#n400-counttimedout
  let countTimedOut = false;
  const t_count_raced = Date.now();
  // Rationale: docs/job-board-index-notes.md#n943-const-racedcount-promise-n-number-capped
  const racedCount: Promise<{ n: number; capped?: boolean } | null> = wantCount
    ? Promise.race([
      (cappedCount() as unknown as PromiseLike<{ n: number; capped?: boolean } | null>)
        .then((r) => ({ kind: "settled" as const, r })),
      new Promise<{ kind: "timeout" }>((res) => setTimeout(() => res({ kind: "timeout" }), COUNT_DEADLINE_MS)),
    ]).then((outcome) => {
      const r = outcome.kind === "settled" ? outcome.r : null;
      if (outcome.kind === "timeout") countTimedOut = true;
      // Rationale: docs/job-board-index-notes.md#n944-markfrom-count_jobs_capped-t_count_raced
      markFrom("count_jobs_capped", t_count_raced);
      return r && typeof (r as { n?: number }).n === "number" ? r as { n: number; capped?: boolean } : null;
    })
    : Promise.resolve(null);
  const [firstPage, cappedRes] = await Promise.all([
    pageWith("effective_posted", "salary_rank_usd", false),
    racedCount,
  ]);
  // Rationale: docs/job-board-index-notes.md#n945-const-needinlinecount-wantcount-cappedre
  const needInlineCount = wantCount && !cappedRes && !countTimedOut;
  if (countTimedOut) {
    // Rationale: docs/job-board-index-notes.md#n946-console-warn-job-board-capped-count
    console.warn(`[JOB-BOARD] capped count exceeded ${COUNT_DEADLINE_MS}ms — serving the page without a total`);
  }
  const page = (dateCol: string, salaryCol: string) => pageWith(dateCol, salaryCol, needInlineCount);
  // firstPage was fetched concurrently and successfully; reusing it is the
  // whole point of racing the count beside it rather than before it.
  let { data, error, count } = needInlineCount
    ? await page("effective_posted", "salary_rank_usd")
    : { data: firstPage.data, error: firstPage.error, count: cappedRes?.n ?? null };
  // Graceful degrade until the rank-column migration applies: raw numeric order.
  if (sortSalary && error?.message?.includes("salary_rank_usd")) {
    ({ data, error, count } = await page("effective_posted", "salary_min_annual"));
  }
  if (missingColumn(error)) ({ data, error, count } = await page("posted_at", "salary_min_annual"));
  // Rationale: docs/job-board-index-notes.md#n401-countunavailable
  let countUnavailable = countTimedOut || (wantCount && count === null);
  if (error && wantCount) {
    // Rationale: docs/job-board-index-notes.md#n947-const-nocount-datecol-string-salarycol-s
    const noCount = (dateCol: string, salaryCol: string) => pageWith(dateCol, salaryCol, false);
    let retry = await noCount("effective_posted", "salary_rank_usd");
    if (sortSalary && retry.error?.message?.includes("salary_rank_usd")) retry = await noCount("effective_posted", "salary_min_annual");
    if (missingColumn(retry.error)) retry = await noCount("posted_at", "salary_min_annual");
    if (!retry.error) {
      data = retry.data;
      error = null;
      count = null;
      countUnavailable = true;
      console.warn(`[JOB-BOARD] exact count timed out; served page without it (maxAgeDays=${String(applied.maxAgeDays ?? "")} category=${String(applied.category ?? "")})`);
    }
  }
  if (error) throw error;

  // Rationale: docs/job-board-index-notes.md#n948-const-missq-string-body-q-slice
  const missQ = String(body.q ?? "").slice(0, 120).trim();
  const missLoc = String(body.location ?? "").slice(0, 120).trim();
  // Rationale: docs/job-board-index-notes.md#n949-if-count-offset-missq-missloc-nolog
  if (count === 0 && offset === 0 && (missQ || missLoc) && !noLog) {
    waitUntil(Promise.resolve(
      client.from("job_board_search_misses").insert({
        q: missQ,
        location: missLoc,
        filters: {
          category: applied.category ?? undefined,
          experience: applied.experience.join(",") || undefined,
          remote: body.remote === true || undefined,
          salaryFloor: applied.salaryFloor ?? undefined,
        },
        src: "list",
      }).then(({ error: e }) => { if (e) console.warn("[JOB-BOARD] search-miss log failed:", e.message); }),
    ));
  }

  // Rationale: docs/job-board-index-notes.md#n950-const-v-meta-v-as-record

  const v = (meta?.v ?? {}) as Record<string, unknown>;
  // Rationale: docs/job-board-index-notes.md#n951-const-includefacets-body-as-includefacet
  const includeFacets = (body as { includeFacets?: boolean }).includeFacets !== false;
  // Rationale: docs/job-board-index-notes.md#n952-const-fullcompanies-v-companiesfacet-as
  const fullCompanies = (v.companiesFacet as Array<{ count?: number }>) ?? [];
  const servedCompanies = includeFacets
    // Ordered by the SERVABLE count — see facetHead; `count` never reaches
    // these rows.
    ? facetHead(fullCompanies as Array<{ token?: string; name?: string; count?: number; open?: number }>)
        .sort((a, b) => (b.open ?? 0) - (a.open ?? 0))
    : [];
  const mappedRows = (data ?? []).map(rowToJob) as Array<Record<string, unknown>>;
  // Rationale: docs/job-board-index-notes.md#n953-let-rawsequence-mappedrows
  let rawSequence = mappedRows;
  // Rationale: docs/job-board-index-notes.md#n402-rawkeys
  let rawKeys = (data ?? []) as Array<{ effective_posted?: string; id?: string }>;
  let grouped = groupSimilar
    ? collapseClusters(mappedRows, limit)
    : { jobs: mappedRows.slice(0, limit), rawConsumed: Math.min(mappedRows.length, limit) };

  // Rationale: docs/job-board-index-notes.md#n403-if
  if (
    groupSimilar && !twoSubset && !sortSalary && !countOnly &&
    grouped.jobs.length < limit &&
    mappedRows.length >= fetchLimit          // the buffer was exhausted, not just short
  ) {
    // Rationale: docs/job-board-index-notes.md#n404-anchorcol
    const anchorCol = newestFirst ? "posted_at" : "effective_posted";
    const lastRaw = rawKeys[rawKeys.length - 1] as { effective_posted?: string; posted_at?: string; id?: string } | undefined;
    const anchorVal = newestFirst ? lastRaw?.posted_at : lastRaw?.effective_posted;
    if (anchorVal && lastRaw?.id) {
      try {
        // Rationale: docs/job-board-index-notes.md#n405-t-topup
        const t_topup = Date.now();
        const topUp = await withDeadline(
          ordered(
            buildQuery("effective_posted", false).or(
              `${anchorCol}.lt."${anchorVal}",and(${anchorCol}.eq."${anchorVal}",id.gt."${lastRaw.id}")`,
            ),
            "effective_posted",
            "salary_rank_usd",
          ).limit(fetchLimit),
          Math.min(1_500, budgetLeft()),
        ) as { data: unknown[] | null };
        markFrom("page_topup", t_topup);
        const extra = (topUp.data ?? []).map(rowToJob) as Array<Record<string, unknown>>;
        if (extra.length) {
          rawSequence = [...mappedRows, ...extra];
          // Kept index-aligned with rawSequence, or the cursor would name a row
          // from the first fetch while the page ended inside the second.
          rawKeys = [...rawKeys, ...((topUp.data ?? []) as typeof rawKeys)];
          const merged = collapseClusters(rawSequence, limit);
          // Rationale: docs/job-board-index-notes.md#n954-grouped-merged
          grouped = merged;
        }
      } catch { /* the page we already have is still correct — serve it */ }
    }
  }
  // Rationale: docs/job-board-index-notes.md#n406-sortsalary-grouped-jobs-interleaveby
  if (!sortSalary) grouped.jobs = interleaveByCompany(grouped.jobs);
  // Rationale: docs/job-board-index-notes.md#n407-recencyserved
  const recencyServed = preferMatchedLocation(await attachRecheckedAt(client, grouped.jobs, excludedTerms), locationTerms(body.location).terms);
  logSearch("recency", grouped.jobs.length, countUnavailable ? null : (wantCount ? (count ?? 0) : safeMetaTotal), null, recencyServed);
  return json({
    jobs: recencyServed,
    searchId,
    ...honesty(grouped.jobs),
    // Rationale: docs/job-board-index-notes.md#n955-nextoffset-offset-grouped-rawconsumed
    nextOffset: offset + grouped.rawConsumed,
    ...searchDisclosures(body, applied, maxAgeClamped),
    ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
    ...coverageDisclosure(applied, meta),
    // Rationale: docs/job-board-index-notes.md#n408-rankedfellback-rankedfellback
    ...(rankedFellBack ? { rankedFellBack } : {}),
    ...(semanticDegraded ? { semanticDegraded } : {}),
    nextCursor: (() => {
      // Rationale: docs/job-board-index-notes.md#n409-twosubset-sortsalary-newestfirst
      if (!twoSubset && !sortSalary && newestFirst) {
        const rp = rawKeys[Math.max(0, grouped.rawConsumed - 1)] as { posted_at?: string; id?: string } | undefined;
        return rp?.posted_at && rp?.id ? { ep: rp.posted_at, id: rp.id, k: "pa" } : null;
      }
      // The SAME condition the cursor READER uses, for the discovery order:
      // (effective_posted, id), untagged, unchanged.
      if (twoSubset || sortSalary || newestFirst) return null;
      const r = rawKeys[Math.max(0, grouped.rawConsumed - 1)];
      return r?.effective_posted && r?.id ? { ep: r.effective_posted, id: r.id } : null;
    })(),
    // null (not 0) when the count timed out — 0 would read as "no matches" and
    // trip the zero-state on a page that is visibly full of results.
    total: countUnavailable ? null : (wantCount ? (count ?? 0) : safeMetaTotal),
    ...(countUnavailable || (!wantCount && safeMetaTotal === null) ? { countUnavailable: true } : {}),
    // The count stopped at the cap: the real figure is higher, so the client
    // renders "10,000+" rather than presenting the cap as an exact total.
    ...(cappedRes?.capped ? { countCapped: true } : {}),
    // Rationale: docs/job-board-index-notes.md#n956-hasmore-data-length-grouped-rawconsumed
    hasMore: (data ?? []).length > grouped.rawConsumed || (data ?? []).length === fetchUsed,
    // Rationale: docs/job-board-index-notes.md#n410-twosubset-bucketedorder-true
    ...(twoSubset ? { bucketedOrder: true } : {}),
    ...exclusionCountsCaveat(excludedTerms),
    totalAllCompanies: safeMetaTotal ?? count ?? 0,
    ...(trackedTotal !== null ? { trackedTotal } : {}),
    companies: servedCompanies,
    // Same rule as the ranked sites: the head row's facet is a 200-row slice.
    companiesCount: ((v.companiesCount as number | undefined) ?? fullCompanies.length),
    ...(typeof v.companiesOpenCount === "number" ? { companiesOpenCount: v.companiesOpenCount } : {}),
    // Rationale: docs/job-board-index-notes.md#n957-categories-visiblecategories-v-categorie
    categories: visibleCategories(v.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
    failedSources: (v.failedSources as string[]) ?? [],
    failedCount: (v.failedCount as number | undefined) ?? 0,
    refreshedAt: (v.refreshedAt as string) ?? null,
  });
}

