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
import { BOARD_DESC_SOURCES, buildEmbedInput, DETAIL_DESC_SOURCES, clusterKey, jobPostingLd, workdayCxsUrl } from "./descriptions.ts";
import { fetchJazzhr, jazzhrPostingUrl, parseJazzhrDetail } from "./vendors/jazzhr.ts";
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
  normalizeIcims, normalizeUsajobs,
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
} from "./normalize.ts";
import { categorize, CATEGORIZE_VERSION, JOB_CATEGORIES } from "./categories.ts";
import { computeFit, resumeRoleTerms, scanResume } from "../_shared/fit-score.ts";
import { locationTerms, rankedLocationParam, sanitizeTerm } from "../_shared/location-terms.ts";
import {
  POSTED_BACKFILL_VERSION,
  postedBackfillDue,
  backlogFromCoverage,
} from "../_shared/posted-backfill.ts";
import { extractSalary, parseSalaryStructured } from "../_shared/salary-extract.ts";
import { classifyDormancy, selectRetries, updateBoardFailures, type BoardFailureState } from "./dormancy.ts";
import { STALE_LANE_MIN_AGE_H, STALE_PER_SLICE, bumpStaleTries, classifyStale, countByClass, readStaleTries, selectStaleLane, staleExclusion, tokensOf, unresolvedTokens, writeStaleTries, type StaleClass, type StaleRow, type StaleVerdict } from "./stale-lane.ts";
import { tokenMapFromRecord, tokenMapToRecord } from "./token-map.ts";
import { decideRekick } from "./chain-watchdog.ts";
import { advanceProgress, isPassDone, type RefreshProgress } from "./rotation.ts";
import { CANARIES, rawItemCount, aggregateVendorHealth, type CanaryResult } from "./vendor-canary.ts";
import { detectExperience, isExperienceBand } from "./experience.ts";
import { categoryParam, extraFilterParams, filterViolations, isUnfiltered, normalizeFilters, payParams, rpcBlindFilters, rescueVendorsParam, SALARIED_PERIODS, sendableSourcesParam, splitPage, salaryFromQueryText, SALARY_IN_QUERY, WIDENING_FILTERS } from "./filters.ts";
import { pickRoute, rerankWindow, RETRIEVER_FOR, splitExclusions, titleExcluded } from "./search-routing.ts";
import { planRankedPage, RANKED_WINDOW, RING_WINDOW } from "./paging.ts";
import { collapseClusters, GROUP_OVERFETCH, interleaveByCompany, visibleCategories, mergeCompanyFacet } from "./clusters.ts";
import { EMPLOYER_ALIASES } from "./employer-aliases.ts";
import { expandQuery } from "./search-alias.ts";
import { classifyQuestion } from "../_shared/application-questions.ts";
import { parseBreezyQuestions, parsePinpointQuestions, breezyApplyUrl, pinpointApplyUrl } from "../_shared/vendor-questions.ts";
import { realQuestionVendors, SENDABLE_VENDORS } from "../_shared/apply-automation.ts";
import { beforeDeadline, SLIM_SPECS, streamSlim } from "./slim-stream.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
const BUILD_VERSION = "2026-09-09.84"; // per-version deploy notes: docs/job-board-deploy-notes.md (kept out of the bundle; see the 4.5MB cap note there)
// Rationale: docs/job-board-index-notes.md#n003-stored-names-do-not-heal-themselves-the-refr

// STORED NAMES DO NOT HEAL THEMSELVES. The refresh is insert-only by design, so
// correcting a display name in sources.ts changes what NEW postings get and
// nothing else — every existing row keeps the old name indefinitely. The
// version-stamped sweep below is the only path that rewrites them, so a rename
// must arrive with a bump here or it is invisible on the site.
const NAME_SYNC_VERSION = 3;

/** Boards whose catalog display name was corrected, for the v2 sweep.
 *
 *  Two kinds. Most were the slug title-cased — "Thehartford", "Hdsupply",
 *  "Nyp", "Umd" — which is what a reader saw on the company card. The rest were
 *  worse than cosmetic: several DISTINCT employers shared one parent slug, so
 *  Fabletics, Savage X Fenty and JustFab all rendered as "Justfab", and
 *  get_size_segments (which merges boards by display name) counted them as one
 *  company. Naming them correctly separates them again.
 *
 *  Adding a rename later means editing sources.ts, appending the token here,
 *  and bumping NAME_SYNC_VERSION. */
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
  // Both Embry-Riddle boards, confirmed linked from careers.erau.edu: External
  // is staff/faculty, AdjunctFacultyOpportunities is adjunct hiring. Same
  // employer, so the same name — they are not separate companies.
  "embryriddle~wd1~External",
  "embryriddle~wd1~AdjunctFacultyOpportunities",
  "standoutforgood~wd12~StandOutForGood",
  "trilongroup",
  "exactcare~wd1~AnewHealth_Career_Site",
];

const STALE_MS = 12 * 60_000; // SWR threshold — cron target is 10 min
const LOCK_MS = 5 * 60_000; // min gap between refresh passes
// 8s was too tight for large boards: Greenhouse content=true payloads run
// 3–4 MB and Ashby 2.5 MB, which from the edge can exceed 8s and fail the fetch
// — repeatedly, so ~100 boards with hundreds of fresh postings each (stone, pei,
// bridgebio, deliveroo…) never ingested at all. A worker only blocks on the
// slow board, and the queue keeps a hop well under the invocation wall-time, so
// a wider ceiling is safe. Descriptions are preserved (unlike light-desc).
const FETCH_TIMEOUT_MS = 20_000;
// Rationale: docs/job-board-index-notes.md#n005-concurrency
const CONCURRENCY = 5;
const HOT_CONCURRENCY = 2; // hot boards are giants — two multi-MB parses at once is the memory ceiling
// desc-sweep: per-posting description backfill. 8 concurrent detail fetches
// matches CONCURRENCY for board fetches; 120/hop keeps a hop well inside the
// edge wall-time limit while still clearing ~406k rows in a few thousand hops.
const DESC_SWEEP_PER_HOP = 120;
// Rationale: docs/job-board-index-notes.md#n006-stored-desc-cap
const STORED_DESC_CAP = 12_000;
const RAW_HTML_CAP = 24_000;
const DESC_SWEEP_CONCURRENCY = 8;
// Rationale: docs/job-board-index-notes.md#n007-structured-sweep-sources
const STRUCTURED_SWEEP_SOURCES: readonly string[] = ["workday"];
// Rationale: docs/job-board-index-notes.md#n008-structured-sweep-per-hop
const STRUCTURED_SWEEP_PER_HOP = 24;
// Slice sizes are calibrated to the per-invocation compute budget. Hot
// slices are UNIFORMLY giant boards (that's what makes them hot), so they
// must be much smaller than the old mixed slices: the first tiered deploy
// died mid-slice at HOT=30 (one upsert chunk of carvana landed, then the
// worker hit the ceiling and the cron retried the same slice forever).
const HOT_SLICE = 10;
/**
 * THE SLICE HAS A BUDGET IN POSTINGS, BECAUSE NOTHING ELSE BOUNDS THE SLICE.
 *
 * Every shed lever cuts how MANY boards a slice takes; .27 cut how big one
 * VISIT can be. Neither bounds the sum. Measured 2026-09-03 at L0 post-cap: ~5
 * capped giants among the 80 base boards (~10,300 postings) plus the deep lane
 * (then 16,000) in one invocation — and the invocation died on
 * WORKER_RESOURCE_LIMIT inside its fetch loop, exactly as it had on one
 * 20,800-posting board before the cap. A death skips EVERY remaining board in
 * the slice (the cursor already advanced), records nothing, and floors the
 * fleet at L1 via the stale-row rule.
 *
 * The budget stops STARTING fetches once the slice has accumulated this many
 * postings. Boards not started skip this pass — one rotation stale, which is
 * precisely what a death already costs them — but the slice COMPLETES: stats
 * record, the shed reads a live row, and `budgetHit` becomes the first signal
 * that measures the thing actually killing slices. The slice order puts the
 * deep lane LAST so the budget protects the cursor-bearing rotation first;
 * the deep lane filling slowly is the .21 trade made deliberately this time.
 *
 * Counted from r.jobs.length — normalised postings, before the freshness
 * filter — because that is what was held in memory, not what was stored.
 */
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
// 120s to STOP TAKING new boards. A board already in flight can add at most
// FETCH_TIMEOUT_MS (20s) plus its upsert, and then the post-loop tail —
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
const CAPPED_VISIT_VENDORS = new Set(["workday", "oracle", "icims", "smartrecruiters", "rippling"]);
const COLD_SLICE = 80; // cold boards are small (that's why they're cold); 80/hop at CONCURRENCY=5 is 16 sequential rounds, and SLICE_POSTING_BUDGET stops the loop near 51 boards long before the list is exhausted — the list size is a ceiling, not a plan. Rotation speed comes from concurrency + hops-per-pass, never bigger slices (proven-safe size).
const BOOTSTRAP_PER_SLICE = 25; // zero-row boards prepended per cold slice after a deploy — +31% slice load, still ~3 rounds under the wall-time margin; a 1,900-board merge drains in ~1.5 passes instead of waiting a full rotation for its FIRST ingest
// Rationale: docs/job-board-index-notes.md#n013-
/**
 * A DEEP BOARD IS EXACTLY 2,000 POSTINGS NOW, SO THE LANE IS SIZED IN POSTINGS.
 *
 * Before .27 a deep board was "whatever its page budget allowed", 500 to a few
 * thousand, and 8 per slice was tuned against that (cut from 25 in .21 after
 * it cost 4x rotation speed). .27 capped every visit at MAX_POSTINGS_PER_VISIT
 * and left nextOffset set for every board that hit it — which is CORRECT, the
 * lane is the only thing that resumes a capped board, gate it out and the cap
 * becomes a truncation — but it changed what a deep board is: every one now
 * contributes exactly 2,000. Measured 2026-09-03: the lane went from 3 boards
 * to 16 in ten hours, selected 8 per slice, and 8 x 2,000 = 16,000 postings was
 * 61% of a cold slice's giant volume. Slices died inside the fetch loop on the
 * same WORKER_RESOURCE_LIMIT as before; the per-board cap had redistributed
 * the volume, not bounded the slice.
 *
 * So the count is derived from a VOLUME allowance, and the guard pins the
 * arithmetic so the constant stays tied to what it counts — the rule .21 was
 * paid for: never copy a cap without matching what it measures.
 */
// Rationale: docs/job-board-index-notes.md#n014-deep-volume-per-slice
const DEEP_VOLUME_PER_SLICE = 500;
const DEEP_PER_SLICE = 2; // = floor(DEEP_VOLUME_PER_SLICE / MAX_POSTINGS_PER_VISIT); pinned by test
// Rationale: docs/job-board-index-notes.md#n015-retry-per-slice
const RETRY_PER_SLICE = 5;
// Rationale: docs/job-board-index-notes.md#n016-stale-rpc-limit
const STALE_RPC_LIMIT = 60;
const STALE_RPC_DEADLINE_MS = 4_000;
/** Every catalogued token, once: the stale lane's 'uncatalogued' test. A Set, so a token named 'constructor' is a real member. */
const CATALOGUE_TOKENS: ReadonlySet<string> = new Set(JOB_SOURCES.map((s) => s.token));
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

// Rationale: docs/job-board-index-notes.md#n018-lighttokenrefusal
const lightTokenRefusal = (token: string): string | null => {
  let seen = 0;
  let blocker = "";
  for (const s of JOB_SOURCES) {
    if (s.token !== token) continue;
    seen++;
    if (!LIGHT_CAPABLE_VENDORS.has(s.source) && !blocker) blocker = s.source;
  }
  if (seen === 0) return "not in the catalog";
  if (blocker) return seen > 1 ? `token shared with ${blocker}` : `vendor ${blocker}`;
  return null;
};

/**
 * A set that can only ever hold a token every one of whose boards is
 * light-capable.
 *
 * Refusing inside `add` covers every writer at once — today's two
 * content-volume enrolments and the byte-budget bound, tomorrow's third one,
 * and the meta reload that replays whatever an older build persisted.
 *
 * A refusal is a no-op plus a log line, never a throw. Light mode is an
 * optimisation; failing a refresh slice over one board would trade a
 * description problem for an ingest outage.
 */
class LightCapableOnly extends Set<string> {
  override add(token: string): this {
    const refusal = lightTokenRefusal(token);
    if (refusal) {
      console.warn(`[JOB-BOARD] light mode REFUSED for ${token} (${refusal}): no filler can refill a light board on that vendor, so its descriptions would be deleted rather than deferred`);
      return this;
    }
    return super.add(token);
  }
}

// Rationale: docs/job-board-index-notes.md#n019-dynamic-light
const DYNAMIC_LIGHT: Set<string> = new LightCapableOnly();
const AUTO_LIGHT_THRESHOLD_CHARS = 2_500_000; // ~2.5MB of raw content HTML
const AUTO_LIGHT_CAP = 500; // 107 greenhouse boards needed a slot on 2026-10-01, and 50 made every one of them miss; see n019
const isLight = (token: string) => LIGHT_DESC_TOKENS.has(token) || DYNAMIC_LIGHT.has(token);

/**
 * THE BOARDS backfill-desc CAN ACTUALLY FILL — one predicate, two readers.
 *
 * The maintenance ladder built its own list (JOB_SOURCES filtered by isLight,
 * vendor-agnostic) and counted description-nulls across it, while the filler
 * selected greenhouse light boards only. A null on a non-greenhouse light
 * token was therefore COUNTED by the trigger and UNREACHABLE by the filler:
 * the count could never fall, missingCoverage was permanently true, and the
 * rung's `return` sat directly in front of desc-sweep — the only lane that
 * fills workday, oracle, smartrecruiters, bamboohr, breezy, rippling, adp, ukg
 * and jazzhr. Workday description coverage fell 98% -> 90% (~23,035 workday
 * plus 5,772 oracle live postings served with no text) because the trigger
 * meant to protect descriptions was starving the lane that writes them.
 *
 * Both readers call THIS function. A trigger that measures a population its
 * filler cannot reach is a trigger that can never be satisfied.
 */
const DESC_BACKFILL_VENDOR = "greenhouse"; // backfill-desc hits the GH per-JOB endpoint and only that
const descBackfillBoards = (): JobSource[] =>
  JOB_SOURCES.filter((s) => s.source === DESC_BACKFILL_VENDOR && isLight(s.token));

async function loadDynamicLight(client: SupabaseClient): Promise<void> {
  try {
    const { data } = await client.from("job_board_meta").select("v").eq("k", "light_desc_dynamic").maybeSingle();
    const tokens = (data?.v as { tokens?: unknown } | null)?.tokens;
    DYNAMIC_LIGHT.clear();
    // SWEEP THE ROW, don't merely filter the read. Tokens an older build
    // persisted without a vendor test are refused by the set above, which is
    // enough to stop them going light again — but leaving them in the row means
    // every isolate re-reads and re-refuses them forever, and nobody reading
    // the row can tell which boards were stranded. Rewrite it ONCE, naming the
    // removals, so the row says what happened and stops repeating itself.
    const refused: string[] = [];
    if (Array.isArray(tokens)) {
      for (const t of tokens) {
        if (typeof t !== "string") continue;
        DYNAMIC_LIGHT.add(t);
        if (!DYNAMIC_LIGHT.has(t)) refused.push(t);
      }
    }
    if (refused.length > 0) {
      // One write, and only on a dirty row: the next load finds nothing to
      // refuse. The stranded boards recover on their own — listUrl stops
      // emitting the light form for them, so new postings carry descriptions
      // again, and rows already stored NULL are refilled by the desc-sweep
      // BOARD lane (workable is in BOARD_DESC_SOURCES), which is the lane the
      // maintenance-ladder fix below un-starves.
      console.warn(`[JOB-BOARD] light_desc_dynamic swept: ${refused.length} non-light-capable token(s) removed (${refused.slice(0, 10).join(", ")})`);
      await client.from("job_board_meta").upsert(
        {
          k: "light_desc_dynamic",
          v: {
            tokens: [...DYNAMIC_LIGHT].slice(-AUTO_LIGHT_CAP),
            updatedAt: new Date().toISOString(),
            strandedRemovedAt: new Date().toISOString(),
            strandedRemoved: refused.slice(0, AUTO_LIGHT_CAP),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "k" },
      );
    }
  } catch { /* meta unreadable — static set still applies */ }
}

// Rationale: docs/job-board-index-notes.md#n020-oversize-boards
const OVERSIZE_BOARDS = new Map<string, { source: string; mb: number; at: string }>();
const OVERSIZE_CAP = 200;
async function loadOversizeBoards(client: SupabaseClient): Promise<void> {
  try {
    const { data } = await client.from("job_board_meta").select("v").eq("k", "oversize_boards").maybeSingle();
    const rec = (data?.v as { boards?: Record<string, { source?: string; mb?: number; at?: string }> } | null)?.boards;
    OVERSIZE_BOARDS.clear();
    if (rec && typeof rec === "object") {
      for (const [tk, e] of Object.entries(rec)) {
        if (typeof tk === "string" && e && typeof e === "object") {
          OVERSIZE_BOARDS.set(tk, { source: String(e.source ?? ""), mb: Number(e.mb) || 0, at: String(e.at ?? "") });
        }
      }
    }
  } catch { /* meta unreadable — the registry is diagnostic, never a gate */ }
}
async function persistOversizeBoards(client: SupabaseClient): Promise<void> {
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

/**
 * Enrol a token in DYNAMIC_LIGHT and persist it the way the auto-light
 * measurement already does, so the NEXT pass fetches the board light.
 *
 * Extracted so the byte bound can reuse the machinery rather than grow a
 * second, differently-spelled copy of it — the mistake DEEP_PER_SLICE paid
 * for: never copy a cap without matching what it measures. It is now the ONLY
 * writer of DYNAMIC_LIGHT outside the meta reload, and the only writer of the
 * light_desc_dynamic row outside that reload's sweep.
 *
 * Returns whether the board is now light. FALSE means the set refused the
 * vendor (it logs why), and the caller must take the deferral path instead of
 * reporting an enrolment that did not happen — nothing may be persisted, and
 * at the byte bound no board slot may be handed back for a re-fetch that would
 * be byte-for-byte identical to the one that just failed.
 */
async function enrolDynamicLight(client: SupabaseClient, token: string, why: string): Promise<boolean> {
  DYNAMIC_LIGHT.add(token);
  if (!DYNAMIC_LIGHT.has(token)) return false;
  console.warn(`[JOB-BOARD] auto-light: ${token} ${why} — enrolled in light mode (descs via backfill)`);
  try {
    const { error: alErr } = await client.from("job_board_meta").upsert(
      { k: "light_desc_dynamic", v: { tokens: [...DYNAMIC_LIGHT].slice(-AUTO_LIGHT_CAP), updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
    if (alErr) console.warn(`[JOB-BOARD] auto-light persist failed for ${token} (re-enrolls next fetch):`, alErr.message?.slice(0, 120));
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
    ? (({ host, token }) => `https://${host}/v1/boards/${token}/jobs${isLight(s.token) ? "" : "?content=true"}`)(greenhouseApi(s.token))
    : s.source === "lever"
      ? (({ host, token }) => `https://${host}/v0/postings/${token}?mode=json`)(leverApi(s.token))
      : s.source === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${s.token}?includeCompensation=true`
        : s.source === "smartrecruiters"
          ? `https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100${startOffset ? `&offset=${startOffset}` : ""}`
          : s.source === "workable"
            // details=true returns every posting's FULL description in the SAME
            // single call (measured 2026-07-24: 88KB vs 8KB on a 20-job board) —
            // complete coverage for Workable boards at zero extra requests.
            // Light boards fall back for the same reason Greenhouse giants drop
            // content=true: the bulk htmlToText pass is what wedges the isolate.
            // Their descriptions arrive via the backfill sweep instead.
            ? `https://apply.workable.com/api/v1/widget/accounts/${s.token}?details=${isLight(s.token) ? "false" : "true"}`
            : s.source === "recruitee"
              ? `https://${s.token}.recruitee.com/api/offers/`
              : s.source === "breezy"
                ? `https://${s.token}.breezy.hr/json`
                : s.source === "teamtailor"
                  // `host` serves the board from the employer's own domain.
                  // Teamtailor exposes the identical /jobs.rss there, and it is
                  // the ONLY reachable route for the 364 custom-domain boards
                  // whose tenant token no reverse lookup can recover.
                  ? `https://${s.host ?? `${s.token}.teamtailor.com`}/jobs.rss`
                  : `https://${s.token}.bamboohr.com/careers/list`;

// Rationale: docs/job-board-index-notes.md#n022-sr-page
const SR_PAGE = 100;
const SR_PAGE_CAP = 20;
const SR_CAP = SR_PAGE * SR_PAGE_CAP; // 2,000/board/pass
async function fetchSmartRecruiters(s: JobSource, startOffset = 0): Promise<{ content: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  // Same rotation as Workday: a board bigger than SR_CAP is read a tranche per
  // pass instead of the same first tranche forever. Measured 2026-08-25: one
  // board (dominos, 2,080 rows) sits at this cap today, so the win here is
  // small — but a ceiling that only bites on the largest employers is exactly
  // the one nobody notices until an employer grows into it.
  const first = await fetchWithTimeout(listUrl(s, startOffset));
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  const page1 = await first.json();
  // The vendor's own advertised count, kept whole — NOT clamped to the cap.
  // It rides the verification stamp so the UI can say "4,887 advertised"
  // instead of publishing the cap as though it were the company's size, which
  // is the false-precision trap Workday's feedTotal was added to close.
  const feedTotal = Number(page1.totalFound) || 0;
  const total = Math.min(feedTotal, SR_CAP);
  const content: unknown[] = [...(page1.content ?? [])];
  // DID THE FEED RUN OUT, or did we merely stop where `total` told us to? This
  // loop is bounded by the advertised total, so without watching page sizes it
  // has no way to tell the two apart and would report every stop as an ending.
  // A short page is the only end-of-feed observation SmartRecruiters offers.
  let srEnded = (page1.content ?? []).length < SR_PAGE;
  for (let offset = SR_PAGE; offset < total; offset += SR_PAGE) {
    const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=${SR_PAGE}&offset=${startOffset + offset}`);
    if (!res.ok) break; // partial page set is fine — prune guard keys off success of THIS board overall
    const page = await res.json();
    const batch = (page.content ?? []) as unknown[];
    content.push(...batch);
    // RECORD the ending; do not act on it. Breaking here would leave a
    // non-zero nextOffset where the loop used to run to `total` and wrap, which
    // changes this lane's cursor rate — a thing this repo re-measures on
    // purpose rather than changes in passing. Pages past the end return
    // nothing, so `content` (and therefore nextOffset) is unaffected either way.
    if (batch.length < SR_PAGE) srEnded = true;
  }
  // windowed, reported the same way Workday and Oracle report it: the company
  // holds more than we fetched, so a posting's ABSENCE from our copy proves
  // nothing about it being filled. Downstream this suppresses closure logging
  // and guards the prune. SR previously had no feedTotal at all, so truncation
  // was inferred from `rowsById.size >= SR_CAP` — a proxy that cannot tell a
  // board of exactly 2,000 from one of 24,566.
  const advancedSr = startOffset + content.length;
  const nextOffset = content.length === 0 || (feedTotal > 0 && advancedSr >= feedTotal) ? 0 : advancedSr;
  return { content, windowed: feedTotal > content.length, feedTotal, nextOffset, feedEnded: srEnded || content.length === 0, endOffset: advancedSr };
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
 *   - MAX_POSTINGS_PER_VISIT binds only CAPPED_VISIT_VENDORS — five of twenty.
 *     The other fifteen fetch an entire board in ONE request.
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
// The second read of a lever/ashby board the bound refused, one posting at a time.
// Rationale: docs/job-board-index-notes.md#n411-streamed-oversize-read
const STREAM_WIRE_BYTES = 64_000_000;
const STREAM_READ_BUDGET_MS = 30_000;
const SLIM_ELEMENT_BYTES = 1_000_000;
const SLIM_RETAINED_BYTES = 3_000_000;
const SLIM_DESC_CEILING = 2_500_000;
// Our own function answering our own chain kick / maintenance probe. Status
// and list payloads, not vendor feeds, so the ceiling is a tenth of a board's.
const SELF_RESPONSE_BYTES = 400_000;
// The inbound request. The largest real body is a fit-batch (FIT_BATCH_MAX ids
// x FIT_DESC_CHARS ~= 400KB) or a chain kick carrying a slice's tokens, so 2MB
// is generous against anything this API legitimately receives.
const MAX_REQUEST_BYTES = 2_000_000;
// Carried in the thrown message because fetchBoard's classifier reads message
// text; the worker keys the DEFERRAL on it, and a deferral is not a failure.
const OVERSIZE_MARKER = "OVERSIZE_BODY";

/**
 * A bound of zero: a body we are never going to read. Cancelling releases the
 * connection instead of leaving it hanging, and allocates nothing — which is
 * strictly better than the `.text()` these call sites used to do purely to
 * drain the socket.
 */
function discardBody(src: { body: ReadableStream<Uint8Array> | null } | null | undefined): void {
  try {
    void src?.body?.cancel().catch(() => {});
  } catch { /* already consumed, locked, or no body — nothing to release */ }
}

/**
 * Release the tail of a page chunk we are not going to read.
 *
 * A chunked fetcher issues its pages concurrently and then reads them one at a
 * time; any walk-ending condition (short page, shape drift, posting cap, a
 * page over the byte budget) leaves the rest unread. Unread is cheap — the
 * counting transform is never pulled, so each holds a chunk plus a transport
 * window — but leaving four connections open per board across a slice is not,
 * and a cancelled body is the same "bound of zero" discardBody gives a 429.
 */
function discardRest(rs: Array<Response | null>, from: number): void {
  for (let k = from; k < rs.length; k++) discardBody(rs[k]);
}

/**
 * Read ONE page of a chunk, keeping the two failures apart.
 *
 * `over` means the byte bound aborted this page — a WALK-ENDING condition, not
 * a vendor failure, and the caller must be able to see it. The three vendors
 * that wrote `await res.json().catch(() => undefined)` here turned an oversize
 * abort into "payload shape unrecognized", which fetchBoard's classifier reads
 * as a vendor failure: board_state 'error', a consecutive-failure streak, and
 * after DEAD_BOARD_THRESHOLD failures over DEAD_BOARD_MIN_FAILING_MS the
 * dormancy prune DELETES every posting on a live employer and logs a whole-
 * board exit into the closure log. A board being large must never be able to
 * spell itself as a board being dead.
 *
 * `body: undefined` with `over: false` is the old meaning, untouched: a body
 * that is present and unreadable, which each caller's own shape check owns.
 *
 * The bound is re-installed here rather than assumed from the caller. Every
 * caller does route through fetchWithTimeout, and wrapping an already-bounded
 * response costs one transform holding one chunk (verified: the marker
 * propagates intact through both, header path and streamed path alike) — but
 * a helper that reads a body handed to it is exactly where the next unbounded
 * read gets in, and the guard proves the bound at the read, not by tracing an
 * argument through a call graph.
 */
/** The byte bound refusing a body — declared length or running total. */
const isOversize = (e: unknown) => String((e as Error)?.message ?? e).includes(OVERSIZE_MARKER);

/**
 * A page refused on its DECLARED Content-Length never reaches the read loop:
 * boundBody throws inside the concurrent fetch, which rejects the whole chunk.
 * So the walk-ending decision has to exist here too, and it is the same one
 * the read loop makes — mid-walk it is a WINDOW (keep the pages that landed,
 * resume next pass), and on the walk's first page it is the board's deferral.
 * `null` already means exactly that to every one of these consume loops.
 */
function chunkPageRefusal(e: unknown, isFirstPage: boolean): null {
  if (!isFirstPage && isOversize(e)) return null;
  throw e;
}

async function readChunkPage(res: Response): Promise<{ body: unknown; over: boolean }> {
  try {
    return { body: await boundBody(res, MAX_RESPONSE_BYTES).json(), over: false };
  } catch (e) {
    if (isOversize(e)) return { body: undefined, over: true };
    return { body: undefined, over: false };
  }
}

/**
 * Install the byte bound on a body BEFORE anything reads it.
 *
 * The returned Response behaves exactly like the one handed in — same status,
 * same headers, same `.json()`/`.text()` — except that reading it past `limit`
 * throws instead of allocating. Two layers, because either alone has a hole:
 *
 *  1. Content-Length, when present: refuse before a single byte is
 *     transferred. Present on FAR less than it looks — Deno's fetch strips the
 *     header once it decompresses a response, so every gzip/br vendor arrives
 *     with content-length null (measured: ashby openai `br`, null; greenhouse
 *     gitlab `gzip`, null; lever palantir uncompressed, 5,978,887). This layer
 *     is an optimisation for the uncompressed minority, not the guard.
 *     It is also absent on any chunked response, and a vendor can lie.
 *  2. A counting TransformStream: the running total is checked per chunk and
 *     the stream is errored past the budget. `pipeThrough` propagates that
 *     error backwards and CANCELS the source body, so an aborted read does not
 *     leave the connection hanging.
 *
 * Memory: the transform enqueues each chunk and hands it straight to the
 * consumer under the default TransformStream backpressure (readable HWM 0), so
 * it holds one chunk, never a copy of the body. What the consumer accumulates
 * is bounded by `limit` by construction — that is the whole point, and it is
 * why this can be added to a function that already dies on memory.
 */
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
  // `url` is a getter with no setter on a constructed Response, and the
  // BambooHR login-page branch reads it to say WHERE a board redirected to.
  // Shadow it so that diagnostic survives the wrap.
  try {
    Object.defineProperty(out, "url", { value: (src as Response).url || "", configurable: true });
  } catch { /* diagnostics only — never worth failing a fetch over */ }
  return out;
}

async function fetchWithTimeout(url: string, init?: RequestInit, limit = MAX_RESPONSE_BYTES): Promise<Response> {
  const once = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)", ...(init?.headers ?? {}) },
      });
    } finally {
      clearTimeout(t);
    }
  };
  const res = await once();
  // Rate limits: honor Retry-After with one short, capped retry (personio
  // 429s observed under burst; vendor interleaving spreads the load but a
  // vendor can still throttle). Waits longer than 4s aren't worth a slice's
  // budget — the board simply retries next rotation.
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

// Personio publishes the same official feed on two hosts depending on the
// company's region setup — try .de first (the majority), fall back to .com.
// The winning host is carried so Apply links land on the right domain.
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
// Rippling: the board page embeds page 0 of the job list as structured JSON;
// further pages come from the same page URL with ?page=N. Capped at 10 pages
// (200 jobs) — Rippling boards are small-company boards; a board past the cap
// still ingests its first 200 postings rather than failing.
const RIPPLING_PAGE_CAP = 10;
// startOffset is in ITEMS and converts to Rippling's page number. Measured
// 2026-08-25 across 198 of 1,051 boards, one exceeds the 10-page cap —
// medcbo-inc at 64 pages, which loses 1,080 postings, roughly 5,700 across the
// catalogue. Concentrated in a handful of large boards rather than spread.
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
  for (let p = startPage + 1; p < lastPage; p++) {
    const res = await fetchWithTimeout(pageUrl(p));
    if (!res.ok) break;
    const more = extractRipplingJobPosts(await res.text());
    if (!more || more.items.length === 0) { ranOut = true; break; }
    items.push(...more.items);
  }
  const reachedEnd = ranOut || lastPage >= totalPages;
  const feedTotal = totalPages * RIPPLING_PER_PAGE; // pages is all the vendor tells us
  return {
    items,
    raw: html,
    // A board inside the cap is read whole, so absence IS provable and the
    // prune must stay on for it. Only a genuinely deeper board is windowed.
    windowed: totalPages > RIPPLING_PAGE_CAP,
    feedTotal,
    nextOffset: reachedEnd ? 0 : lastPage * RIPPLING_PER_PAGE,
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

// UKG Pro Recruiting: the candidate portal's own list endpoint, unauthenticated
// (verified live 2026-09-01 on Sub-Zero Group — no cookie, no CSRF token, no
// account). POST { opportunitySearch: { Top, Skip, ... } } answers
// { opportunities[], totalCount }, so paging is Top/Skip and the board's own
// advertised size arrives on the first page.
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
    // FETCH concurrently, READ one at a time — see MAX_RESPONSE_BYTES. The
    // round trips are what chunking buys; holding four PARSED pages at once
    // was memory the per-response bound could never see.
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
        const { body, over } = await readChunkPage(res);
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
        const { body, over } = await readChunkPage(res);
        if (over) { if (all.length === 0) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${pages[i]}`); break outer; }
        const reqs = (body as { jobRequisitions?: unknown[] } | undefined)?.jobRequisitions;
        // A 200 whose body isn't the requisition envelope is drift or a
        // bot-wall — the personio/rippling/paylocity line: a FAILED fetch,
        // never an empty board. Only page 0 can prove the shape; a later page
        // going strange ends the walk with what we already hold.
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
  // Same guard as workday/oracle/icims: an empty read against a non-zero
  // advertised total is a refusal, not an empty board — throwing keeps the
  // orphan prune away from a live tenant.
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  return { items: all, raw: { jobRequisitions: all }, windowed: !exhausted, feedTotal };
}

// Rationale: docs/job-board-index-notes.md#n028-
/**
 * A SHED LEVER CUTS HOW MANY BOARDS A SLICE TAKES. NOTHING CUT HOW BIG ONE IS.
 *
 * Every paginated fetcher accumulates a whole board into one array before it
 * returns, so per-board memory is O(board), not O(page). That was harmless
 * while the caps were small; the `pages` overrides added 2026-08-31 made 315
 * boards deep-pageable and 77 of them able to pull 2,000+ postings in a single
 * visit — up to 20,800 for an iCIMS giant and 13,000 for an Oracle one.
 *
 * MEASURED 2026-09-02, the failure that produced: slices died INSIDE the fetch
 * loop with WORKER_RESOURCE_LIMIT, advancing the cursor and draining the
 * bootstrap queue optimistically on the way in and never reaching
 * stampSliceWork. The fleet then read its own stats row as stale and floored
 * itself at L1 — where it could not recover, because every shed lever cuts the
 * NUMBER of boards per slice (80->48, concurrency 8->5, hot 10->5) and none of
 * them cuts the SIZE of any one board. Shedding cannot stop a single giant
 * from exhausting an invocation, which is exactly why L1 held for hours while
 * the cold tail fell 3,765 minutes behind its SLA.
 *
 * So a visit is bounded by POSTINGS now, not by pages. 2,000 is Oracle's own
 * long-tolerated default (20 pages x 100), so no board that was already safe
 * changes behaviour — only the overridden giants do, and they RESUME: breaking
 * out without setting `exhausted` leaves nextOffset = startOffset + all.length,
 * which the deep cursor already persists and hands back on the next visit.
 * Coverage is unchanged; it arrives over more visits instead of one that dies.
 *
 * `windowed` stays true for a capped board, which is what keeps the closure
 * prune off a board that is still filling — the Four Seasons rule.
 *
 * Only the fetchers that carry startOffset/nextOffset are capped. UKG, ADP,
 * iCIMS and USAJOBS cannot resume, so a cap there would silently truncate a
 * board rather than defer it; those need offset support before they can be
 * bounded, and iCIMS is the one that most needs it.
 */
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

/**
 * PER-BOARD LAP STATE — see the block comment where deepLaps is loaded.
 *
 * One of these per WINDOWED, CURSOR-CARRYING board, carried inside the
 * deep_cursor meta row under `__laps` (a non-token key, which both readers of
 * that row already ignore). Seven small scalars: no per-posting allocation, and
 * the map is bounded by the number of boards still paging, exactly like
 * deepCursors beside it, deleted the moment a board stops being windowed.
 *
 * KEYED BY `source:token`, NOT BY TOKEN. deepCursors beside it is token-keyed
 * and stays that way (re-keying it would reset every cursor in the rotation),
 * but the catalog is not token-unique — 139 tokens carry two or three vendors —
 * and six of the collisions pair a windowed rippling board with a non-windowed
 * greenhouse/workable/pinpoint twin (`nve`, `pdq`, `excel`, `mozn-ai`,
 * `booknook-inc`, `lineleap`). Under a token key the twin's visit takes the
 * `else` branch and DELETES the rippling board's open lap, while leaving its
 * cursor alone: the board then stamps nothing for the rest of the pass, proves
 * nothing at the wrap, and re-opens at epoch 1 — matching stamps left by the
 * aborted lap, so those rows read as served forever and a real takedown on them
 * can never be logged. Silently, while `status.deepCursor.laps.tracking` counts
 * the board as tracked.
 */
type LapState = {
  /**
   * Epoch number: which lap stamped a row. Non-zero ONLY for a lap that opened
   * at offset 0 under this build.
   *
   * MONOTONIC IN TIME, never a counter restarting at 1. If the record is ever
   * lost (a dropped meta write, a key that changed shape, a 45-day prune), a
   * counter would hand the next lap an epoch that stale rows already carry, and
   * those rows would read as "served by the current lap" forever — absence
   * unprovable on exactly the rows most likely to be gone. Seconds since
   * 2020-09-13 fits `integer` until 2088 and cannot repeat a value, so a lost
   * record costs one lap and nothing else.
   */
  e: number;
  /**
   * How deep into the feed this lap has reached, in the vendor's own offsets —
   * a MAXIMUM, never a running sum. Within a lap the cursor only ever advances
   * by what it served, so the windows are contiguous from 0 and this number is
   * exactly the covered prefix. A sum would double-count a window re-read after
   * a lost slice and could certify a lap whose tail was never fetched.
   */
  s: number;
  /** When the lap opened (ours, not any employer date). */
  t: string;
  /** 1 = an epoch write failed somewhere in this lap, so it can never prove absence. */
  f: 0 | 1;
  /**
   * The employer's advertised total AT LAP OPEN, pinned so it cannot move with
   * the wrap it is supposed to certify. Zero = the vendor stated none, which
   * can never prove.
   */
  t0: number;
  /** When this board last COMPLETED a provable lap. Absent = it never has. */
  w?: string;
  /**
   * When this board completed its FIRST provable lap. Absent = never.
   *
   * The first proven lap of a big board stamps up to 30 days of accumulated
   * absence at once — every takedown since 2026-09-06 that the page cap made
   * unobservable — and the second one closes it. Those closures carry a
   * `closed_at` of now(), so their durations are inflated by up to a month and
   * they arrive as a spike that reads like the employer's behaviour changing.
   * They are logged as `absence_basis = 'lap_backfill'` so a duration statistic
   * can exclude them by name instead of silently absorbing them.
   */
  w0?: string;
};

/**
 * THE ADVERTISED TOTAL MAY NOT BE ITS OWN DENOMINATOR.
 *
 * A wrap is derived from feedTotal (`advanced >= feedTotal` in every paginated
 * fetcher), so testing coverage against the SAME visit's feedTotal is a test
 * that always passes: numerator and denominator move together and any
 * understatement certifies itself. This bounds how far the total may fall
 * DURING a lap before the lap forfeits its power to prove — the total is
 * pinned at lap open (LapState.t0) and a collapse below this share of it means
 * we walked a feed that is no longer the feed we started walking. A genuine
 * mass takedown fails this once and proves on the very next lap, which opens
 * against the new total.
 *
 * Not 1.0: a live board loses postings while we walk it, so the feed
 * legitimately ends a little short of the total advertised at open. Not lower
 * than this either — at 0.5 a board serving half its feed would be allowed to
 * declare the other half closed.
 */
const LAP_COVERAGE_MIN = 0.9;

/**
 * How far short of the feed's advertised end a lap may stop and still claim it
 * read the whole thing, in the vendor's own offsets.
 *
 * `LapState.s` is an OFFSET, not a sum of rows, so a shortfall here is
 * literally territory that was never requested — not churn. A 10% ratio on a
 * 16,027-posting board is 1,600 unfetched offsets, and a single short page
 * (any transient hiccup: Workday treats <20 items as the last page) inside
 * that band would certify a lap whose whole tail was never asked for, then
 * convert that tail into logged takedowns. So the tolerance is ABSOLUTE and
 * small, and only ever narrower than the ratio: shortfall <= min(this, (1 -
 * LAP_COVERAGE_MIN) * total), which leaves small boards their proportional
 * slack and gives big ones a bound that does not grow with them.
 */
const LAP_TAIL_SLACK = 100;

/** fit-batch bounds — see the action. 20 ids survives the shared worker pool; 60 did not. */
const FIT_BATCH_MAX = 20;
const FIT_DESC_CHARS = 20_000;

const WORKDAY_PAGE_CAP = 25; // 25 × 20 = up to 500 postings/board/pass
// Oracle CE REST accepts a larger page than Workday; 20 × 100 = up to 2000
// postings/board/pass, which exhausts every tenant in the first tranche.
const ORACLE_PAGE_SIZE = 100;
const ORACLE_PAGE_CAP = 20;
// Every Oracle site of every multi-site tenant, ranked (0 = canonical). The
// ingest stores one row per tenant requisition under the best-ranked site that
// lists it; see normalize.ts (the rule, its measurement) and sources.ts
// ORACLE_CANONICAL_SITES (the overrides). Single-site tenants are absent and
// pay nothing. The same table is published to job_board_meta each pass so the
// repair SQL (migration 20260909216000) keeps exactly this rule.
const ORACLE_SITE_RANK: ReadonlyMap<string, number> = rankOracleSites(JOB_SOURCES, ORACLE_CANONICAL_SITES);
// Deploy-before-migration: until job_board_postings.req_key exists the holder
// lookup fails naming the column. Back off for ten minutes rather than for the
// isolate's life, so the dedupe switches itself on once the migration lands.
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
  // Chunked like oracle/icims, for the same wall-time reason: at one POST per
  // RTT a 220-page giant would hold a slice for minutes. A per-board pages
  // override (the PetSmart contract) widens named giants — a 24-board sample
  // measured ~276k postings living past the default window, CVS Health alone
  // serving 19,265 against 678 stored. Results consume IN ORDER; a short page
  // or shape-drift anywhere in a chunk ends the walk.
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
        const { body, over } = await readChunkPage(res);
        if (over) { if (all.length === 0) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${pages[i]}`); break outer; }
        // An unreadable body used to reject the whole chunk and fail the
        // board. Same verdict, kept where it belongs: page 0 proves the shape,
        // a later page going strange ends the walk with what we hold.
        if (body === undefined) {
          if (pages[i] === 0) throw new Error("workday payload unreadable");
          break outer;
        }
        if (pages[i] === 0) feedTotal = Number((body as { total?: number }).total ?? 0) || 0;
        const items = Array.isArray((body as { jobPostings?: unknown[] }).jobPostings) ? (body as { jobPostings: unknown[] }).jobPostings : [];
        all.push(...items);
        if (items.length < 20) { exhausted = true; break outer; } // last page — wrap next pass
        // Memory ceiling, NOT an end-of-feed signal: leave `exhausted` false so
        // nextOffset resumes here rather than wrapping to 0 and re-reading the
        // board from the top.
        if (all.length >= MAX_POSTINGS_PER_VISIT) break outer;
      }
    } finally { discardRest(responses, read); }
  }
  // Empty page with a non-zero advertised total = the tenant refused/failed us
  // (rate-limit, transient) — NOT an empty board. Throwing marks the board
  // failed so nothing is pruned. Without this, persistent empty responses
  // eventually pass the two-pass + shrink-ratchet guards and delete the whole
  // board (live case: Four Seasons pruned to 0 while advertising 1,963 jobs).
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  // Rationale: docs/job-board-index-notes.md#n030-advanced
  const advanced = startOffset + all.length;
  const nextOffset = exhausted || (feedTotal > 0 && advanced >= feedTotal) ? 0 : advanced;
  // Rationale: docs/job-board-index-notes.md#n031-return-jobpostings-all-raw-jobpostings-a
  return { jobPostings: all, raw: { jobPostings: all }, windowed: feedTotal > all.length, feedTotal, nextOffset, feedEnded: exhausted, endOffset: advanced };
}

// Rationale: docs/job-board-index-notes.md#n032-fetchoracle
async function fetchOracle(s: JobSource, startOffset = 0): Promise<{ items: unknown[]; raw: unknown; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number }> {
  const [tenant, region, site] = s.token.split("~");
  if (!tenant || !region || !site) throw new Error("bad oracle token");
  const base = `https://${tenant}.fa.${region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
  const all: unknown[] = [];
  let feedTotal = 0;
  // Exhaustive = we stopped because the feed ran out (a short page), not because
  // we hit OUR page cap. This is the honest windowing signal: measured live,
  // tenants advertise a TotalJobsCount 1 higher than they actually serve
  // (Fortinet 918 advertised / 917 returned, DTCC 406/405), so comparing counts
  // would mark a fully-read board "windowed" forever — and windowed boards are
  // barred from closure logging, so they'd never contribute fill data.
  let exhausted = false;
  // Per-board pages override, same contract as icims (the PetSmart precedent):
  // named giants get a window sized to what they advertise, everyone else
  // keeps the proven default. Kroger advertises 12,350 against the default
  // window's 500 (measured 2026-08-30) — the deep cursor alone needs ~25
  // passes to see the tail once, and the 30-day sweep is faster than that.
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
        const { body, over } = await readChunkPage(res);
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
  // Same guard as Workday: an empty read against a non-zero advertised total is
  // a refusal (rate-limit/transient), NOT an empty board. Throwing marks the
  // board failed so the orphan prune never deletes a live tenant.
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  const advancedOr = startOffset + all.length;
  const nextOffset = exhausted || (feedTotal > 0 && advancedOr >= feedTotal) ? 0 : advancedOr;
  // Rationale: docs/job-board-index-notes.md#n034-return-items-all-raw-items-all-window
  return { items: all, raw: { items: all }, windowed: !exhausted || startOffset > 0, feedTotal, nextOffset, feedEnded: exhausted, endOffset: advancedOr };
}

// Rationale: docs/job-board-index-notes.md#n411-streamed-oversize-read
async function readOversizeBoard(s: JobSource, deadlineAt: number, freshCutoffMs: number): Promise<{ jobs: JobPosting[]; raw: unknown } | null> {
  const spec = SLIM_SPECS[s.source];
  if (!spec) return null;
  try {
    const res = await beforeDeadline(fetchWithTimeout(listUrl(s), undefined, STREAM_WIRE_BYTES), deadlineAt, discardBody);
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
      : null;
    if (!jobs) throw new Error(`no normaliser for ${s.source}`);
    console.warn(`[JOB-BOARD] streamed ${s.source}:${s.token}: ${(stats.bytes / 1e6).toFixed(1)}MB read, ${(stats.slimBytes / 1e6).toFixed(1)}MB kept, ${stats.descDropped} description(s) dropped`);
    return { jobs, raw };
  } catch (e) {
    console.warn(`[JOB-BOARD] streamed read of ${s.source}:${s.token} failed, stays deferred:`, String((e as Error)?.message ?? e).slice(0, 120));
    return null;
  }
}

// onFail receives a COMPACT reason. The reason was already known here and
// thrown away by `return null`, so every failure reached the operator as the
// bare word "(vendor)" — 110 boards reported identically whether they were
// deleted, rate-limited or slow. Diagnosing that cost an afternoon of probing
// each board by hand against its own API, to recover information this
// function had already computed and discarded.
async function fetchBoard(
  s: JobSource,
  onFail?: (reason: string) => void,
  // Where the previous pass stopped on this board. Only the capped vendors read
  // it; everyone else fetches whole feeds and ignores it. `nextOffset` comes
  // back on the same shape so the caller can persist it without knowing which
  // vendor paginates.
  startOffset = 0,
): Promise<{ jobs: JobPosting[]; raw: unknown; windowed?: boolean; feedTotal?: number; nextOffset?: number; feedEnded?: boolean; endOffset?: number } | null> {
  try {
    if (s.source === "oracle") {
      const { items, raw, windowed, feedTotal, nextOffset, feedEnded, endOffset } = await fetchOracle(s, startOffset);
      return { jobs: normalizeOracle(items as never, s.name, s.token), raw, windowed, feedTotal, nextOffset, feedEnded, endOffset };
    }
    if (s.source === "icims") {
      // Rationale: docs/job-board-index-notes.md#n035-icims-page
      const ICIMS_PAGE = 100, ICIMS_MAX_PAGES = Math.max(1, s.pages ?? 12), ICIMS_CHUNK = 5;
      // RESUMABLE SINCE .28. iCIMS pages 1-based by `page`, so the deep
      // cursor's posting offset maps to a starting page; the visit then covers
      // its page budget FROM there and reports nextOffset like Workday and
      // Oracle do — which is what lets MAX_POSTINGS_PER_VISIT bound it without
      // truncating the board. Before this, iCIMS held the single largest
      // per-visit fetch on the board (20,800 postings) and could not be capped.
      const startPage = Math.floor(startOffset / ICIMS_PAGE) + 1;
      const lastPage = startPage + ICIMS_MAX_PAGES - 1;
      const all: unknown[] = [];
      let feedTotal = 0, exhausted = false;
      // Fetch the chunk concurrently; READ the bodies one at a time. An iCIMS
      // page of 100 carries description, qualifications and responsibilities
      // per item — measured 2.0MB (AccentCare) to 3.3MB (AMD) — so holding
      // five parsed pages at once was ~16MB of wire per worker, three times a
      // worker's whole allotment, with no single response near the bound. See
      // MAX_RESPONSE_BYTES.
      const fetchPage = async (page: number) => {
        try {
          const res = await fetchWithTimeout(`https://${s.token}/api/jobs?page=${page}&limit=${ICIMS_PAGE}`, {
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
            const { body, over } = await readChunkPage(responses[i]!);
            // Over the byte budget mid-walk is a WINDOW, not a failure: keep
            // the pages that landed and leave `exhausted` false so nextOffset
            // resumes here. Only a first page bigger than an isolate can hold
            // reaches the caller as a deferral.
            if (over) { if (all.length === 0) throw new Error(`${OVERSIZE_MARKER} over ${MAX_RESPONSE_BYTES} on page ${pages[i]}`); break outer; }
            const page = body as { jobs?: unknown[]; totalCount?: number } | undefined;
            if (!page) { if (all.length === 0) throw new Error("icims payload unreadable"); break outer; }
            const batch = Array.isArray(page.jobs) ? page.jobs! : [];
            if (feedTotal === 0) feedTotal = Number(page.totalCount) || 0; // first page fetched, whichever it is
            all.push(...batch);
            // A short page inside a chunk ends the walk — later chunk members
            // past the end return empty and must not be treated as data.
            if (batch.length < ICIMS_PAGE) { exhausted = true; break outer; }
            // Memory ceiling, not end-of-feed: `exhausted` stays false so
            // nextOffset resumes here rather than wrapping to the top.
            if (all.length >= MAX_POSTINGS_PER_VISIT) break outer;
          }
        } finally { discardRest(responses, read); }
      }
      // Same guard as the other paginated vendors: a page-1 failure that
      // returns empty while the feed claims postings must NOT read as "board
      // emptied" (the orphan prune would delete a live tenant).
      if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
      const advancedIc = startOffset + all.length;
      const nextOffset = exhausted || (feedTotal > 0 && advancedIc >= feedTotal) ? 0 : advancedIc;
      // A resumed read is windowed by definition — see the note in fetchOracle.
      return { jobs: normalizeIcims(all as never, s.name, s.token), raw: { items: all }, windowed: !exhausted || startOffset > 0, feedTotal, nextOffset, feedEnded: exhausted, endOffset: advancedIc };
    }
    if (s.source === "usajobs") {
      // Single national feed, paged 500 at a time. The key lives in secrets;
      // a MISSING key returns empty rather than throwing, because throwing
      // marks the board failed and the dormancy prune would eventually delete
      // every federal posting over a config gap.
      const key = Deno.env.get("USAJOBS_API_KEY") ?? "";
      const ua = Deno.env.get("USAJOBS_USER_AGENT") ?? "";
      if (!key || !ua) {
        console.warn("[JOB-BOARD] usajobs: USAJOBS_API_KEY/USAJOBS_USER_AGENT unset — skipping (not a board failure)");
        return { jobs: [], raw: { items: [] }, windowed: true, feedTotal: 0 };
      }
      const PAGE = 500, MAX_PAGES = Math.max(1, s.pages ?? 40);
      const all: unknown[] = [];
      let feedTotal = 0, exhausted = false;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `https://data.usajobs.gov/api/search?ResultsPerPage=${PAGE}&Page=${page}`;
        const res = await fetchWithTimeout(url, {
          headers: { Host: "data.usajobs.gov", "User-Agent": ua, "Authorization-Key": key },
        });
        if (!res.ok) { if (page === 1) throw new Error(`HTTP ${res.status}`); break; }
        const body = await res.json() as { SearchResult?: { SearchResultCountAll?: number; SearchResultItems?: unknown[] } };
        const sr = body.SearchResult ?? {};
        const batch = Array.isArray(sr.SearchResultItems) ? sr.SearchResultItems : [];
        if (page === 1) feedTotal = Number(sr.SearchResultCountAll) || 0;
        all.push(...batch);
        if (batch.length < PAGE) { exhausted = true; break; }
      }
      if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
      return { jobs: normalizeUsajobs(all as never, s.name, s.token), raw: { items: all }, windowed: !exhausted, feedTotal };
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
    if (s.source === "teamtailor") {
      const res = await fetchWithTimeout(listUrl(s));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rss = await res.text();
      return { jobs: normalizeTeamtailor(rss, s.name, s.token), raw: rss };
    }
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
    // SmartRecruiters now reports truncation the way Workday and Oracle do.
    // Without this the honest `windowed`/`feedTotal` computed in the fetcher
    // died here at the return, and downstream kept inferring truncation from a
    // row-count proxy.
    if (s.source === "smartrecruiters") {
      const sr = raw as { windowed?: boolean; feedTotal?: number; nextOffset?: number; feedEnded?: boolean; endOffset?: number };
      return { jobs, raw, windowed: sr.windowed === true, feedTotal: sr.feedTotal ?? 0, nextOffset: sr.nextOffset, feedEnded: sr.feedEnded === true, endOffset: sr.endOffset };
    }
    return { jobs, raw };
  } catch (e) {
    const raw = String((e as Error)?.message ?? e);
    // Classify into something countable. An operator needs to tell "the board
    // is gone" from "the vendor throttled us" at a glance, because those have
    // opposite remedies: one is a registry removal, the other a backoff.
    const http = raw.match(/HTTP (\d{3})/)?.[1];
    // OVERSIZE IS ITS OWN VERDICT, not a vendor failure. The board answered
    // us; its answer was simply bigger than an isolate can hold. The caller
    // reads this prefix to DEFER the board (and to enrol a light-capable
    // vendor), because a board that is too big this pass is not a board that
    // is gone — and the catalog is the product.
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
// Cold list interleaved too: census merges append same-vendor blocks
// (rung 3 added ~3k recruitee/teamtailor/personio/breezy in runs), so an
// uninterleaved 80-board slice can be one vendor end-to-end — burst
// rate-limits (personio 429s observed) and clustered heavy parses. The
// rotation cursor indexes this list, so order changes cost one transient
// partial rotation; the nightly stale-board sweep covers any laggards.
const FALLBACK_COLD_LIST = interleaveByVendor(JOB_SOURCES.filter((s) => !HOT_TOKENS.has(s.token)));

// Self-tuning tiers: each completed pass writes the current top boards by
// live posting count (meta k=hot_tokens), so a board that grows gets hot
// cadence automatically instead of drifting from the static snapshot the
// catalog shipped with. The static HOT_TOKENS set stays as the fallback
// for a fresh deploy or a glitched meta row.
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

// Experience-band rules version: bump to re-derive bands from richer text later.
// The one-time backfill fills existing rows (experience_band IS NULL) once; new
// rows carry a band from ingestion, so this only fires the sweep on first deploy.
const EXPERIENCE_VERSION = 1;
// Rationale: docs/job-board-index-notes.md#n043-salary-parse-version
const SALARY_PARSE_VERSION = 9; // v9 (2026-09-27): A COMMA IS A DECIMAL POINT IN MOST OF EUROPE and the money pattern read it as a thousands group, so the figure split in half: P_RANGE is two money patterns with a dash between them, and on "€14,61 — €14,61" (ouihelp's own greenhouse pay footer) the grouped alternative could not match a 2-digit group, the plain one matched the bare "14", no separator followed, and the engine restarted INSIDE the number — taking the decimal tail 61 as the low end and the next figure's 14 as the high end. A €14.61/hour rate was read as a range from 61 down to 14. Where the halves descended, annualisation refused and the columns stored NULL (643 of 684 rows); where they ascended, the WRONG pair annualised cleanly — smartrecruiters/Securitas "€ 18,10 – € 19,51" stored 20,800-39,520 and workday/Assurant "$ 19,08 - $ 30,53" stored a floor of 16,640 against a true 39,686, 58% low, in the column salary_rank_usd is generated from (41 rows). Worst single shape: smartrecruiters/Flink "€15,96 - €17,14 per hour" read min 96 WITH a stated period and annualised to 199,680 — a €33k job published as a €200k one at the top of the pay sort. THE TAIL LENGTH DECIDES, NOT THE SEPARATOR AND NOT THE LOCALE: no thousands group has two digits, while three genuinely is ambiguous, so the v8 rule below and parseMoney's European reading are untouched (1,715 dot-3 rows in the census, zero changed) and the fix is unconditional — 29 of the 74 shape-carrying rows found by the country census have country NULL, so a locale-gated rule would have missed most of the population. Lookaheads refuse a tail followed by another separator (ashby/Oscilar's Indian lakh grouping "₹66,21,800") or by a period and a digit. MEASURED LIVE 2026-09-27 with the anon key: 684 rows carry the shape on NINE boards (greenhouse ouihelp 550 / joya 114, smartrecruiters Securitas 8 / Flink 5, workday Ia 2 / Assurant 2 / Enzazaden 1, oracle CareOne 1 / IHG 1), found by censusing every servable posting placed in any of the 64 comma-decimal countries the board holds (80,006 rows, cluster fold off) and then walking each discovered board to its exact countOnly total; an independent 60,000-row offset sample of the whole board found one further board and nothing else. Re-parsing 178,591 real stored salary strings with the old reader and the new one: 683 rows change, 638 NULL to a value, 45 a wrong value to a right one, ZERO a value to NULL. Boards, not one board, and never a token condition — the same lesson as v8. // v8 (2026-09-26): a 3-decimal HOURLY rate was read as a thousands group — Saskatchewan Health Authority's own field says "RequisitionType": "Hourly" beside "Pay Band 12 $23.170 to $24.840", and the board stored $23.17/hr as a $23,170 ANNUAL salary (under SK minimum wage, ~29% of real pay). Measured live over 176,575 rows: 1,404 rows on FIVE boards / two vendors — oracle HealthCareersInSask.ca 1,294, oracle DPS 96, workday Scarborough Health Network 11, workday Richmond University Medical Center 2, oracle Northwell 1 — of which 1,323 hold a wrong stored annual and 81 stored NULL. Every salary floor, ceiling and the pay sort read salary_rank_usd off salary_min_annual, so all of them filtered and sorted at ~half their true pay. See readsDotThreeAsRate: the European thousands reading ('€45.000' = 45,000) is deliberately kept, so the re-read is conditioned on the posting's locale, not the separator. // v7 (2026-08-25): day rates (x260) + a part-time/casual guard that REFUSES to annualise a load-dependent rate — {"q":"teacher","salaryFloor":90000} was serving 14 hourly part-timers out of 15, incl. $44/hr read as 91,520 and a $160/day substitute read as 332,800
// v6 (2026-08-24): // v6 (2026-08-24): "an hour"/"a year" vocabulary + unambiguous-hourly inference for parity currencies in [7,200) — 17,641 workday vendor-stated ranges sat unannualized; whole-dollar rounding
const COUNTRY_VERSION = 1; // v1: deterministic country from location text (names + US/CA state patterns)
// Rationale: docs/job-board-index-notes.md#n044-the-completion-stamp-expires-without-this-th

// Rationale: docs/job-board-index-notes.md#n045-
/**
 * The sweep's cadence rule now lives in _shared/posted-backfill.ts so it can be
 * tested against the real function rather than a copy of it. `undatedBacklog`
 * stays here because it does IO; the counting itself is the shared pure helper.
 */
// `SupabaseClient` untyped-generic, not a hand-written structural type: the
// structural version tripped TS2589 ("type instantiation is excessively deep")
// against the real client, which the deno gate caught and tsc never would have
// — this file is not in the frontend project.
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
// Velocity tier: boards that ADDED postings recently earn hot cadence even if
// small — a 40-role startup posting daily deserves faster revisits than a
// 4,000-role giant that hasn't posted in a month. Blend: velocity leaders get
// guaranteed slots, size leaders fill the rest of HOT_SIZE.
const VELOCITY_HOT_SLOTS = 40;
const VELOCITY_WINDOW_DAYS = 7;
const CHAIN_CAP = Math.ceil(HOT_SIZE / HOT_SLICE) + COLD_SLICES_PER_PASS + 4; // pass length + stall headroom

// Rationale: docs/job-board-index-notes.md#n046-corpus-ceiling
const CORPUS_CEILING = 1_200_000; // arm eviction above this
const CORPUS_TARGET = 1_150_000;  // evict down to this

// Freshness cap: the board shows only roles posted within this window. Dated
// postings past it are dropped at ingestion (never stored) and swept from the
// stored corpus each pass; the id-diff prune then keeps them out for good.
// Nearly 100% of feed postings carry a real date, so this is churn-free — a
// dropped dated posting can't re-enter. One constant to dial (30d ≈ 31k live
// board, 45d ≈ 43k, 60d ≈ 50k on the current selection).
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

/**
 * The country-column rule, generalised for the lifecycle tables.
 *
 * These writes are the only record their events ever get — a closure, an exit,
 * a field change — and every one of them now names columns that ship in a
 * migration this function can be deployed AHEAD of. A PostgREST insert naming
 * one absent column fails the WHOLE statement, so an un-tolerated new field
 * would not degrade the row, it would delete the event.
 *
 * So: if the error names one of the columns we declared optional, strip those
 * and insert again, and say so in the logs — a deploy window should be
 * visible, not silently narrower data forever.
 *
 * IT KEEPS STRIPPING. PostgREST reports ONE missing column per PGRST204
 * response ("Could not find the 'origin_basis' column of 'job_board_exits'"),
 * and this pass added fourteen optional columns to the exit ledger and eleven
 * to the closure log. A single strip-and-retry therefore only survives a
 * schema that is short exactly one of them: the second missing column came
 * back as an error nobody could act on, the call site console.warn'd it as
 * non-fatal, and the whole 200-row chunk of closures or exits — the one asset
 * that cannot be backfilled — was dropped instead of degraded. So it loops,
 * accumulating the named columns, bounded by the size of the optional set.
 *
 * Memory: the strip allocates one extra copy of a chunk that is already capped
 * at 200 rows, only on the error path, and it is released with the chunk.
 *
 * Takes the error the insert ALREADY returned (so the call site keeps its own
 * plain `client.from(table).insert(...)` spelling, which several guards read
 * and which is the shape everyone recognises) plus a thunk that rebuilds the
 * rows. The thunk runs only on the failure path, so the happy path allocates
 * nothing extra. Returns whichever error survives — the caller still checks it.
 */
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

/**
 * Every optional column the exit ledger gained in the .62 pass.
 *
 * posted_at LEADS THE LIST and is not an afterthought: the two branches that
 * merged here added their columns independently, and the retry that protected
 * posted_at named only posted_at while the retry that protected the rest named
 * only the rest. Either one alone leaves a deploy window in which the FIRST
 * missing column the database names is one the retry does not strip, the
 * whole 200-row statement fails, the call site logs it as non-fatal, and the
 * ledger goes silently empty — the exact failure both retries were written to
 * prevent, reintroduced by the merge. One list, every new column, one path.
 */
const EXIT_OPTIONAL_COLS = [
  "posted_at",
  "origin_basis", "title", "company", "department", "country", "region_code",
  "work_mode", "employment_type", "experience_band", "min_years",
  "salary_min_annual", "salary_max_annual", "salary_period", "salary_currency",
] as const;

/**
 * Same, for the closure log — including the feed-dark batch stamps, which
 * arrived on the other branch behind a retry of their own. They are folded in
 * here for the same reason posted_at is folded into the exit list above: two
 * narrow retries cover strictly less than one wide one.
 */
const CLOSURE_OPTIONAL_COLS = [
  "suspect", "batch_removed", "batch_live_before", "absence_basis",
  "department", "country", "region_code", "work_mode", "employment_type",
  "experience_band", "min_years",
  "salary_min_annual", "salary_max_annual", "salary_period", "salary_currency",
] as const;

/**
 * THE COLUMNS THAT MAKE A LIFECYCLE ROW CUTTABLE.
 *
 * job_board_closures and job_board_exits both recorded WHICH role ended and
 * WHEN, and nothing about what kind of role it was. That is not a reporting
 * gap — the posting row is hard-deleted at closure, so the moment the event is
 * logged is the last moment pay, team, geography and level exist anywhere.
 * No fill rate, churn rate or ghost rate for any elapsed period can EVER be
 * cut by them retroactively.
 *
 * The collector already SELECTs the posting before deleting it, so this is one
 * wider row read on a query that was going to run anyway: no extra round trip,
 * no new array, nothing retained per posting.
 */
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

/**
 * VENDORS WHOSE feedTotal IS OURS, NOT THE EMPLOYER'S.
 *
 * job_board_board_state.feed_total is documented as "the employer's own
 * advertised count, verbatim from their feed, unmodified — the only figure
 * here we did not derive", and the whole reason to keep a per-day history of
 * it is that it is ground truth nobody derived. Two fetchers hand back a
 * number that does not meet that bar: Rippling's is pageCount * 20 (an upper
 * bound from the page count, so a 3-role tenant reports 20 and crossing a page
 * boundary reads as the employer doubling their hiring), and JazzHR's is the
 * length of the list we just fetched (which would make the coverage ratio a
 * constant 1.0 by construction). For these the honest value is NULL — the
 * documented "the vendor did not state one" — not a derived stand-in.
 *
 * The live verification stamp keeps whatever it always kept; this rule applies
 * to the append-only history, where a number is permanent.
 */
const DERIVED_FEED_TOTAL_SOURCES = new Set(["rippling", "jazzhr"]);

/** The widened posting select both delete paths now read before pruning. */
const LIFECYCLE_SELECT =
  "id, source, company_token, company, title, category, first_seen, posted_at, " +
  "department, country, region_code, work_mode, employment_type, experience_band, min_years, " +
  "salary_min_annual, salary_max_annual, salary_period, salary_currency";

/**
 * WHICH US STATE OR CANADIAN PROVINCE, kept instead of thrown away.
 *
 * normalize.ts already runs state/province patterns on every row — but only to
 * decide `country`, after which the state itself is discarded. Pay-disclosure
 * law is STATE-level (CO, CA, NY, WA, IL...), so without this the board can
 * only ever score compliance per country, and the jurisdiction is recoverable
 * only while the posting row is still live.
 *
 * THE PARSER IS normalize.ts's `detectRegion`, IMPORTED, NOT COPIED. This file
 * briefly carried its own copy of the patterns, and the copy got the two hard
 * cases wrong in the one direction that matters for a column whose whole
 * purpose is naming a legal jurisdiction: ", CA" is California in a US string
 * and Canada in a Canadian one, so "Toronto, ON, CA" (which detectCountry
 * resolves to US on exactly that token) was stored as US-CA, and a bare
 * leading code filed "DE - Berlin" as Delaware. detectRegion refuses both —
 * it suppresses a US "CA" match when the same string also names a Canadian
 * province, and it reads a bare leading code only from a deliberately short
 * list, last. It also carries REGION_MAP_VERSION, so a stored region_code
 * stays interpretable against the rules that produced it, and it is the
 * version the tests exercise. One column, one implementation.
 *
 * Stored ISO 3166-2 style ("US-CO", "CA-ON") so the value names its own
 * country and can never be read as a bare ambiguous two-letter code.
 *
 * Memory: pure string work returning a ≤5-char string that is stamped onto a
 * row the ingest was already building. Nothing retained per posting.
 */

/**
 * WHO ASKED. Until now, nothing in job_board_search_events could tell a
 * candidate apart from our own monitoring.
 *
 * logSearch fires unconditionally, and action:'list' is called by far more
 * than the website: the filter audit's self-calls (~31 a day), scan-heartbeat's
 * probe battery (including a literal {salaryFloor:100000} query that is not a
 * person wanting a six-figure job), send-search-digest, agent-mcp, and every
 * paying /v1 customer, because public-api proxies straight through to this
 * action. There was no bot flag, no visitor id, no UA, no source column — so
 * every "candidates search for X" number is contaminated in a way no filter can
 * retroactively separate. This is a WRITE-side fix; nothing can recover the
 * attribution of a row already written without it.
 *
 * THE ORDER, most trustworthy first:
 *  1. An explicit caller the request declares — body.caller or an x-rsp-caller
 *     header — checked against the enum. Internal callers say who they are;
 *     this is how public-api ('api'), agent-mcp ('mcp') and send-search-digest
 *     ('digest') attribute themselves with a one-line change on their side.
 *  2. A service-role bearer token: only our own infrastructure holds it. That
 *     is scan-heartbeat's battery and this function's own filter audit —
 *     'maintenance', and the largest single contaminant.
 *  3. A browser-shaped request (an Origin, or a Referer): 'web'.
 *  4. Otherwise NULL — meaning "this resolver did not attribute it". The column
 *     default takes over from there and the row lands as 'web', which is the
 *     schema's documented and deliberately CONSERVATIVE choice: mislabelling
 *     real demand as maintenance would delete the very signal the column exists
 *     to protect, while the reverse only dilutes it. A stored NULL means
 *     something else entirely — "written before this column existed" — so this
 *     function never writes one, it omits the key.
 *
 * TWO HEADER SPELLINGS ARE READ ON PURPOSE. The column comment
 * (20260906216000) documents `x-rb-caller`; _shared/search-caller.ts sends
 * `x-rsp-caller` AND `x-rb-caller` while the two are reconciled. Reading both
 * costs nothing and means the reconciliation cannot silently strand a whole
 * caller class as unattributed — and unattributed days cannot be recovered.
 *
 * IT IS A SELF-DECLARED HINT, NOT AN AUTHENTICATED IDENTITY. The anon key is
 * public and any client can send any header, so this answers "who says they
 * are calling". That is exactly enough to stop our own monitoring being
 * invisible, and nothing is authorised on the strength of it.
 */
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
async function logWholeBoardExit(
  client: SupabaseClient,
  token: string,
  reason: "board_dormant" | "untracked",
): Promise<number> {
  const exitedAt = new Date().toISOString();
  let logged = 0;
  try {
    for (let from = 0; ; from += 500) {
      // Widened with the row's facets (see lifecycleFacets): after the delete
      // below there is no other copy of this posting's pay, team, geography or
      // level anywhere, and this select was already running.
      let res = await client
        .from("job_board_postings")
        .select(LIFECYCLE_SELECT)
        .eq("company_token", token)
        .range(from, from + 499);
      // Deploy-before-migration: a select naming an absent column fails the
      // WHOLE read, which would stop the ledger writing at all. Fall back to
      // the pre-.61 column list — a thinner row still beats no row.
      if (res.error) {
        res = (await client
          .from("job_board_postings")
          .select("id, source, company_token, company, title, category, posted_at, first_seen")
          .eq("company_token", token)
          .range(from, from + 499)) as typeof res;
      }
      const { data: page, error } = res;
      if (error) { console.warn(`[JOB-BOARD] exit-log read failed for ${token} (non-fatal):`, error.message?.slice(0, 120)); break; }
      const rows = (page ?? []) as unknown as Array<Record<string, unknown>>;
      if (!rows.length) break;
      // origin_basis, not a coalesce: this was one of the two sites feeding
      // mixed-clock durations into the hiring-health model's censoring input.
      // posted_at rides along verbatim so the employer's own date survives the
      // hard delete a few lines below, whatever a reader thinks of our maths.
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
      if (insErr) { console.warn(`[JOB-BOARD] exit-log insert failed for ${token} (non-fatal):`, insErr.message?.slice(0, 120)); break; }
      logged += rows.length;
      if (rows.length < 500) break;
    }
  } catch (e) {
    console.warn(`[JOB-BOARD] exit-log threw for ${token} (non-fatal):`, String(e).slice(0, 120));
  }
  return logged;
}

// Cap the aged-tail sweep per pass so a big backlog drains without a giant
// delete (still batched 200/delete below). Raised 6k→15k with
// COLD_SLICES_PER_PASS 48→120: the sweep is per-PASS, so a 2.5x longer pass
// would otherwise cut the drain rate 2.5x and let the >30d tail accumulate.
const FRESH_PRUNE_MAX = 15_000;

// force=true bypasses the slice lock, so it must not be reachable from the
// open internet (the function serves anonymous traffic): chain hops carry a
// secret derived from the service-role key, and refresh demotes force to a
// lock-guarded run when the secret doesn't match.
let chainKeyPromise: Promise<string> | null = null;
function chainKey(): Promise<string> {
  chainKeyPromise ??= (async () => {
    const seed = `${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}:board-chain`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  })();
  return chainKeyPromise;
}

// Rationale: docs/job-board-index-notes.md#n050-isingestpaused
async function isIngestPaused(client: SupabaseClient): Promise<boolean> {
  // Fail-open is DELIBERATE here (a transient meta error must never silently
  // stop the ingest for hours) — but an un-honoured operator pause is its own
  // incident, so the open must be OBSERVABLE and earned: bounded read, one
  // retry, loud warning. On the distressed database where the operator most
  // needs the pause, a hung read no longer holds a hop hostage either.
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

/**
 * A CHAIN WHOSE LIVENESS IS NOT IN STATUS IS A CHAIN WHOSE DEATH IS A RESEARCH
 * PROJECT — this file's own words, about its OTHER chains.
 *
 * Every maintenance track here got a liveness stamp and MAINTENANCE_STALL_MS
 * detection after two of them stalled invisibly overnight and could only be
 * diagnosed by inference from posting counts. The refresh chain — the one
 * carrying the freshness SLA — got neither, and it showed: deciding whether
 * cold slices were chaining at all took an hour of cursor sampling, and the
 * first answer was wrong.
 *
 * THREE WAYS A HOP DIED SILENTLY, all now recorded:
 *
 *  1. `.catch(() => {})` swallowed everything, and because it was applied
 *     BEFORE waitUntil received the promise, waitUntil's own console.warn
 *     could never fire either. A DNS failure, a TLS error or an abort from
 *     isolate teardown produced zero log lines in either isolate.
 *  2. `r.ok` was never checked. A 500, or a chainKey rejection, is not a
 *     rejected fetch promise — it is a perfectly ordinary Response.
 *  3. WORST, because it looks healthiest: a 200 that DECLINED. The child can
 *     answer "skipped — a slice ran moments ago" or "ingest paused" and the
 *     chain simply stops, with a success status and no error anywhere.
 *
 * One writer, one key: `chain_kick`. The parent stamps what happened to its own
 * kick, so the row can never diverge the way a meta row written from two sites
 * does (this schema lost a whole lane to that once).
 */
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
    // Stamped BEFORE the fetch, from the same single writer. The outcome
    // stamp below requires this parent isolate to survive the child's ENTIRE
    // slice (the awaited body), which after a pause is exactly when slices
    // run longest — operators watched a stale "paused" for 70 minutes while
    // the cursor advanced. "kicked" is overwritten by the real outcome when
    // the parent lives to see it, and is honest on its own when it does not.
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

// Two-tier refresh: HOT boards (heavy inventory) re-verify on every chain
// pass (~10 min); the long tail rotates through cold slices across passes
// (full rotation bounded by tail size / slices-per-pass). Facets come from
// the get_job_board_facets() RPC at pass end — always DB-true, no
// accumulator bookkeeping.

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

/**
 * LIVENESS AND TIMING ARE TWO FACTS, AND ONE ROW WAS ANSWERING FOR BOTH.
 *
 * `shedSignal` asks the slice_stats row two different questions: "is the
 * rotation alive" (row age) and "what does a slice cost" (the EMA). Only
 * recordSliceStats wrote it, and that runs at the TERMINAL return — after
 * chainNextSlice, after maybeKickMaintenance, after the pass-end facets and
 * dormancy work. So a slice that fetched every board it was given, upserted
 * every posting, and then died in the tail answered "no" to BOTH questions.
 *
 * MEASURED 2026-09-02 across a 37-minute window on .24, then again on .25:
 * 12 slices STARTED (cold cursor +576, exactly 12 x the L1 take of 48) and
 * ZERO recorded. Yet the fetching plainly worked — a 41.2h full cold cycle
 * predicts a ~20h median and the measured p50 was 22.6h. The work was landing;
 * only the report of it was lost.
 *
 * The consequence was a throttle aimed at the wrong half. A stale row floors
 * the fleet at L1, which cuts FETCH capacity (cold slice 80 -> 48, concurrency
 * 8 -> 5) in response to a TAIL that is dying — and cutting the fetch cannot
 * repair the tail, which is why L1 held for over two hours without recovering
 * while freshness climbed at 1.18x wall clock.
 *
 * THIS IS THE FIX THE BOARD-VERIFICATION STAMPS ALREADY GOT. That stamp moved
 * to per-board and immediate for this exact reason — "heavy hot hops can die
 * post-processing (WORKER_RESOURCE_LIMIT) before hop-end code runs", the
 * 397-stale-boards incident. The slice's own pulse was still at hop end.
 *
 * So the fetch phase stamps its own completion here, the moment the last board
 * is in, and the EMA stays at the terminal return where it still measures the
 * whole slice INCLUDING the tail — the property its own guard pins. Both
 * writers touch one row, so `updated_at` now means "a slice finished
 * FETCHING", which is the honest liveness question. Total distress — dying
 * mid-fetch — still touches nothing, still goes stale, still sheds.
 *
 * `works` counts fetch phases and `slices` counts whole slices, so the GAP
 * between them is the tail-death rate: a number that was previously
 * unobservable and is the thing actually worth alarming on.
 */
async function stampSliceWork(client: SupabaseClient, inHotPhase: boolean, sliceWallStart: number): Promise<void> {
  const workMs = Date.now() - sliceWallStart;
  const phase = inHotPhase ? "hot" : "cold";
  const mem = memStamp();
  const write = (async () => {
    const { data: prev } = await client.from("job_board_meta").select("v").eq("k", "slice_stats").maybeSingle();
    const pv = (prev?.v ?? {}) as { works?: number; workHotEmaMs?: number; workColdEmaMs?: number };
    // A SEPARATE EMA, because it measures a different span. The hot/cold EMAs
    // are whole-slice and their thresholds were calibrated against that; fetch
    // time is a strict subset and must never be compared to those numbers.
    // This one is collected now so a future calibration has real data instead
    // of an estimate — no lever reads it yet.
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
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "k" });
  })().catch((e) => { sliceStampError = `work: ${String(e).slice(0, 160)}`; });
  await Promise.race([write, new Promise<void>((res) => setTimeout(res, SLICE_STATS_WRITE_MS))]);
}

/**
 * THE SHED SIGNAL WAS WRITTEN ON A PATH THE RUNTIME IS ALLOWED TO DROP.
 *
 * This row is not instrumentation. `shedSignal` READS it, and a row untouched
 * for 30 minutes returns `stale`, which floors the entire fleet at L1: cold
 * slice 80 -> 48, concurrency 8 -> 5, deep 8 -> 4, bootstrap 25 -> 10, hot
 * 10 -> 5. It is a control input wearing a statistic's clothes — and it was
 * being written inside waitUntil, i.e. deliberately after the response, where
 * the isolate can be reclaimed before the write lands.
 *
 * MEASURED LIVE 2026-09-02 on .24. The row sat at 11:47:35Z for over two hours
 * while the fleet ran pinned at L1 the whole time — `drained: 10` and a cold
 * cursor advancing by exactly 48 are that level's fingerprints — with
 * freshness p50 at 1312 min against a 480 bound. Every write that DID land in
 * that window was an early awaited one (the optimistic cursor, the bootstrap
 * drain); the one deferred write did not. A throttle that cannot be lifted
 * because the evidence for lifting it is the thing being dropped.
 *
 * WHAT IS NOT CHANGED. A slice that dies before reaching these terminal
 * returns still records nothing, so a genuinely dying rotation still goes
 * stale and still sheds. That survivor-bias protection was always right; what
 * was wrong was letting a COMPLETED slice fail to say so.
 *
 * The race is bounded, not removed: the rotation must never wedge on its own
 * bookkeeping, so a write that cannot finish inside the budget is abandoned
 * exactly as the old catch abandoned it — one slice of EMA, never a hop.
 */
// Set by runRefresh the instant its fetch loop closes; read by the recorder
// below in the same invocation. Module state rather than a parameter because a
// guard counts the recorder's exact call literal at its three terminal returns.
let sliceBudgetNote: { fetched: number; skipped: number; hit: boolean; lastUpsertError: string | null; heapStopped: boolean; wallStopped: boolean; sizeStopped: boolean; boardBudget: number } | null = null;
// WHERE A CHAIN DIES IS A NUMBER, NOT A GUESS. Three 546 deaths on 2026-09-03
// sat at hops 6, 7 and 6 while chains otherwise reach hop 9, and the slice
// that died last was a small cold one (6,386 postings, 39s). That is the
// shape of pressure accumulating across hops on a reused isolate, not of one
// heavy slice — and it is a hypothesis until the row carries the hop and the
// heap. Both writers below stamp them; no lever reads them yet.
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
  // Settled, never rejecting: the timeout below may win the race, and a
  // rejection landing after that would surface as an unhandled rejection in a
  // hop that has already returned.
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
        // Saturation of the persisted light set, whose own row anon cannot read (n019).
        lightSet: DYNAMIC_LIGHT.size,
        lightCap: AUTO_LIGHT_CAP,
        // The stale lane's slice outcome rides the same row: how many stale
        // boards this slice tried, and how many of those stamped.
        ...(sliceStaleNote ? { staleTries: sliceStaleNote.tries, staleResolved: sliceStaleNote.resolved } : {}),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "k" });
  })().catch((e) => { sliceStampError = `slice: ${String(e).slice(0, 160)}`; });
  await Promise.race([write, new Promise<void>((res) => setTimeout(res, SLICE_STATS_WRITE_MS))]);
}

/**
 * The optimistic cursor advance as a compare-and-set. A forced hop (the
 * chain's own, carrying a chainKey) writes unconditionally, as it always
 * did. A non-forced hop 0 — cron, watchdog, manual — takes the row only if
 * its updated_at is still the one the slice lock read: an UPDATE filtered
 * on that stamp, or an INSERT when the lock saw no row (a second INSERT
 * fails on the key). Zero rows means another kick was admitted in the gap.
 *
 * NEVER STALLS THE ROTATION. If the conditional write matches nothing while
 * a re-read shows the stamp unchanged — the timestamp did not round-trip
 * through the filter — this degrades to the unconditional write the code
 * had before, with a warning, rather than declining every hop 0 forever.
 * The failure mode of this function is therefore the old behaviour, never
 * a dark rotation.
 */
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
  // Wall clock for THIS invocation — one slice. Written to slice_stats below;
  // the rotation-tuning rule (memory: judge by measurement, never a window
  // inside a hot phase) has so far required hand-run cursor snapshots to get
  // this number. Starts after the lock check so skipped invocations record
  // nothing.
  const sliceWallStart = Date.now();
  // Reset per slice, like sliceBudgetNote: it is assigned only inside the
  // stale lane's fold, so an isolate that served a cold hop and then a hot one
  // would otherwise write the cold hop's staleTries onto the hot hop's row.
  sliceStaleNote = null;
  const { hotList: HOT_LIST, coldList: COLD_LIST } = await tierLists(client);
  await loadDynamicLight(client); // auto-enrolled giant boards fetch without content
  // Loaded in the same invocation that runs the freshness sweep, because the
  // sweep reads it: a board we are too small to hold must not have its live
  // postings written into the closure log as an employer's closures.
  await loadOversizeBoards(client);
  const pv = (prog?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[]; failedTotal?: number };
  let hot = Math.max(0, Number(pv.hot) || 0);
  let cold = Math.max(0, Number(pv.cold) || 0) % Math.max(1, COLD_LIST.length);
  let coldDone = Math.max(0, Number(pv.coldDone) || 0);
  // Hop 0 RESUMES a recent incomplete pass rather than resetting: when a
  // slice dies on the resource ceiling, the re-run must move FORWARD, not
  // re-die on the same boards (the 13:04-13:38 wedge re-ran slice 0
  // forever). A completed or stale (>45 min) pass starts fresh.
  if (chainHop === 0) {
    const progAge = prog ? Date.now() - new Date(prog.updated_at).getTime() : Infinity;
    const storedDone = hot >= HOT_LIST.length && coldDone >= COLD_SLICES_PER_PASS;
    if (storedDone || progAge > 45 * 60_000) {
      // A stale pass that died MID-HOT keeps its hot cursor. Zeroing it sent
      // every 45-minute death back to hot board #0, so under sustained
      // distress the rotation re-entered the one phase whose slices could not
      // complete, forever — the post-pause "cursor advancing, nothing
      // completing" signature. A finished pass still resets fully.
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
  const effDeepPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 1 : DEEP_PER_SLICE;
  // Rationale: docs/job-board-index-notes.md#n057-hotbybudget
  const hotByBudget = Math.max(1, Math.floor(HOT_POSTING_BUDGET / MAX_POSTINGS_PER_VISIT));
  const effHotSlice = Math.min(shedLevel === 2 ? 3 : shedLevel === 1 ? 5 : HOT_SLICE, hotByBudget);
  // Rationale: docs/job-board-index-notes.md#n058-effbootstrapperslice
  const effBootstrapPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 10 : BOOTSTRAP_PER_SLICE;
  const shedRetryPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 2 : RETRY_PER_SLICE;
  // The stale lane sheds on the retry lane's ladder, one step smaller (3 ->
  // 1 -> 0): it fetches boards the rotation has not stamped in three days,
  // the least urgent fetch on the slice after the deep lane, and a stale board
  // that fails again costs a full FETCH_TIMEOUT exactly as a retry does.
  const effStalePerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 1 : STALE_PER_SLICE;
  const shedBootstrapPerSlice = effBootstrapPerSlice;
  const shedDeepPerSlice = effDeepPerSlice;

  // Rationale: docs/job-board-index-notes.md#n059-deeptake
  const deepTake = shedDeepPerSlice;
  const retryTake = shedRetryPerSlice;
  const bootstrapTake = shedBootstrapPerSlice;
  const effColdSlice = shedColdSlice;
  const effRetryPerSlice = retryTake;
  if (shedLevel > 0) {
    console.warn(`[JOB-BOARD] load shedding L${shedLevel}: ${inHotPhase ? "hot" : "cold"} EMA ${Math.round(shedEma / 1000)}s -> ${inHotPhase ? `hotSlice ${effHotSlice}` : `slice ${effColdSlice}, concurrency ${effConcurrency}, deep ${effDeepPerSlice}, bootstrap ${bootstrapTake}, retry ${effRetryPerSlice}`}`);
  }

  let baseSlice = inHotPhase
    ? HOT_LIST.slice(hot, hot + effHotSlice)
    : COLD_LIST.slice(cold, cold + effColdSlice);
  // Feature 3 (demand-driven freshness): boards a user just opened/verified
  // jump the queue. Injected only on COLD slices — hot boards already
  // re-check every pass (~10 min), and cold slices have the compute headroom
  // that hot slices of giants do not. So a takedown on a viewed cold-board
  // job disappears within one pass instead of waiting for its rotation.
  let demandBoards: JobSource[] = [];
  if (!inHotPhase) {
    const sliceTokens = new Set(baseSlice.map((s) => s.token));
    const { data: demandMeta } = await client.from("job_board_meta").select("v").eq("k", "demand").maybeSingle();
    demandBoards = (((demandMeta?.v as { tokens?: Array<{ t: string; at: number }> } | null)?.tokens ?? [])
      .filter((x) => Date.now() - x.at < 20 * 60_000 && !sliceTokens.has(x.t))
      .slice(0, 5)
      .map((x) => JOB_SOURCES.find((s) => s.token === x.t))
      .filter((s): s is JobSource => !!s));
    // Rationale: docs/job-board-index-notes.md#n060-
  }
  // Bootstrap lane: boards with ZERO rows (fresh catalog merges) jump the
  // queue instead of waiting a full rotation at the catalog tail. The queue
  // is computed once per deploy (keyed on BUILD_VERSION) via get_empty_boards
  // and drained BOOTSTRAP_PER_SLICE per cold slice through the same prepend
  // path as demand boards — so failure streaks, the vendor breaker, and
  // cursor accounting (advance by baseSlice only) all apply unchanged.
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
            // Absent RPC -> legacy path below. Anything else is a real failure
            // and belongs to the outer catch: the lane is an accelerator and
            // must never break the rotation.
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
          // RETRY NEXT SLICE, LOUDLY. The first version swallowed this and let
          // the drain write stamp BUILD_VERSION anyway — one failed RPC (the
          // token payload is ~550KB) and the merge's boards silently never
          // entered the lane, with nothing logged. Holding the version back
          // makes the next slice try again until one append lands.
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
              // bootstrapTake, NOT the constant: the drain must equal
              // what was actually SELECTED above or the lane discards boards it
              // never fetched — the "drained without being filled" failure this
              // block's own comment documents, which shedding would otherwise
              // reintroduce every hop.
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
  // A MAP, NOT A RECORD (2026-09-10). Keyed by board token, and a token can be
  // a property name of Object.prototype: 'constructor' is a catalogued ashby
  // board, and `rec[token] ?? 0` read a FUNCTION for it. token-map.ts is the
  // one bridge to the JSON shape the row stores; both directions walk own
  // keys, so 'constructor' round-trips as a real entry.
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
        // Pre-rename entries were keyed by bare token (see LapState). They are
        // dropped rather than migrated: a lap is only meaningful together with
        // the cursor position it was opened at, and a token key cannot say
        // which vendor's board that was. The affected boards re-lap on their
        // next wrap and prove one lap later, which is the same cost as any
        // disarm. Nothing is deleted from job_board_postings by dropping them.
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
        const start = cold % tokens.length;
        // Dedupe BEFORE the cap, so a board already in this slice does not
        // spend one of the lane's places on a fetch that will not happen.
        deepBoards = [...tokens.slice(start), ...tokens.slice(0, start)]
          .filter((t) => !taken.has(t))
          .slice(0, effDeepPerSlice)
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
  const boardFailures: BoardFailureState = {
    streaks: { ...(bfV.streaks ?? {}) },
    dormant: { ...(bfV.dormant ?? {}) },
    failedAt: { ...(bfV.failedAt ?? {}) },
    firstFailedAt: { ...(bfV.firstFailedAt ?? {}) },
  };

  // THE RETRY LANE. A board that failed gets another attempt in minutes rather
  // than in a full rotation — which is the only thing that moves the freshness
  // p95, because that tail is failed fetches waiting their turn, not slow
  // rotation. Backoff lives in dormancy.ts and recedes per streak, so a feed
  // that is genuinely dead walks itself out of this lane and into dormancy
  // instead of burning a timeout here every few minutes.
  let retryBoards: JobSource[] = [];
  let retryLane: { at: string; candidates: number; selected: number } | null = null;
  if (!inHotPhase) {
    try {
      const taken = new Set([...baseSlice, ...demandBoards, ...bootstrapBoards, ...deepBoards].map((s) => s.token));
      const dueTokens = selectRetries({
        streaks: boardFailures.streaks,
        failedAt: boardFailures.failedAt ?? {},
        dormant: boardFailures.dormant,
        exclude: taken,
        now: Date.now(),
        cap: effRetryPerSlice,
      });
      retryBoards = dueTokens
        .map((t) => JOB_SOURCES.find((s) => s.token === t))
        .filter((s): s is JobSource => !!s);
      // Instrumented for the reason every lane here is: "ran and selected none"
      // and "never ran" are otherwise the same observation, and this file has
      // guessed at that fork more than once.
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
      // A bundle that lands BEFORE the migration meets the (integer, integer)
      // signature, and PostgREST answers a named argument no signature takes
      // with PGRST202 — not a failure of the lane, a deploy-order gap. Ask
      // once more the .70 way (same single call site) so the lane is never
      // worse than .70's during the gap; `excluded: 0` on status names it.
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
        const verdicts: StaleVerdict[] = classifyStale(rows, {
          catalogued: CATALOGUE_TOKENS,
          quarantinedVendors,
          oversize: new Set(OVERSIZE_BOARDS.keys()),
          dormant: tokensOf(boardFailures.dormant),
          failing: new Set([...tokensOf(boardFailures.failedAt), ...tokensOf(boardFailures.streaks)]),
          tries: staleTries,
        });
        const taken = new Set([...baseSlice, ...demandBoards, ...bootstrapBoards, ...retryBoards, ...deepBoards].map((s) => s.token));
        staleBoards = selectStaleLane(verdicts, { perSlice: effStalePerSlice, exclude: taken })
          .map((t) => JOB_SOURCES.find((s) => s.token === t))
          .filter((s): s is JobSource => !!s);
        const classes = countByClass(verdicts);
        staleLane = {
          at: new Date().toISOString(),
          rpc: "ok",
          asked: rows.length,
          // A full window with nothing fetchable in it is the clogged state,
          // named: the tail behind row STALE_RPC_LIMIT is going unexamined.
          // Since .71 the window is read AFTER p_exclude, so this can only be
          // a class the exclusion does not cover (uncatalogued, quarantined,
          // dormant, failing) filling sixty rows — worth a human's eyes, hence
          // the warn line below as well as the field.
          windowFull: rows.length >= STALE_RPC_LIMIT && classes.unexplained === 0 && staleBoards.length === 0,
          excluded,
          classes,
          selected: staleBoards.map((s) => s.token),
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
  // Deep lane LAST: under SLICE_POSTING_BUDGET the tail of this list is what
  // gets skipped, and the rotation's freshness claim outranks the lane's fill
  // rate — see SLICE_POSTING_BUDGET.
  const slice = [...demandBoards, ...bootstrapBoards, ...retryBoards, ...staleBoards, ...baseSlice, ...deepBoards];
  const startIso = new Date().toISOString();
  const freshCutoffMs = Date.now() - FRESH_WINDOW_DAYS * 86_400_000; // roles older than this are dropped

  const vendorStats = new Map<string, { a: number; z: number }>();
  const quarantineSkipped = new Set<string>();
  let skipTokens = new Set<string>();
  let recheckTokens = new Set<string>();
  if (!inHotPhase) {
    const demandSet = new Set(demandBoards.map((s) => s.token));
    const eligible = baseSlice.map((s) => s.token).filter((t) => !demandSet.has(t));
    ({ skip: skipTokens, recheck: recheckTokens } = classifyDormancy(eligible, boardFailures.dormant, Date.now(), DORMANT_RECHECK_MS));
  }
  // Rationale: docs/job-board-index-notes.md#n073-the-cursor-rule-advanceprogress-is-shared-w

  // The cursor rule (advanceProgress) is shared with the post-slice write
  // below — see rotation.ts for why it is one function and not two hand-kept
  // copies. Both writes emit the WHOLE row it returns.
  const advanceArgs = {
    inHotPhase,
    // The EFFECTIVE hot take, never the constant: advancing by 10 while
    // shedding took 3 would skip 7 giants' freshness every shed hop — the
    // same skip-by-constant defect rotation.ts documents for the cold side.
    hotSlice: effHotSlice,
    baseSliceLen: baseSlice.length,
    coldListLen: COLD_LIST.length,
  };
  const progressBefore: RefreshProgress = {
    hot, cold, coldDone,
    failedAcc: Array.isArray(pv.failedAcc) ? pv.failedAcc : [],
    failedTotal: Number(pv.failedTotal) || 0,
  };

  // Cursors advance BEFORE processing (optimistic): if this invocation dies
  // on the resource ceiling, the next attempt continues with the NEXT
  // slice — a died slice's boards go one rotation stale instead of wedging
  // the whole pipeline. Failure accounting is finalized after the slice.
  {
    const { next } = advanceProgress({ prev: progressBefore, ...advanceArgs });
    // Rationale: docs/job-board-index-notes.md#n074-await-admitslice-client-next-force
    if (!(await admitSlice(client, next, { force, prog: (prog as { updated_at: string } | null) ?? null }))) {
      return { ok: true, detail: "skipped — a slice was admitted moments ago" };
    }
  }

  const queue = [...slice];
  const okTokens: string[] = [];
  const failed: string[] = [];
  let sliceTotal = 0;
  let fetchedInSlice = 0;
  // Rationale: docs/job-board-index-notes.md#n075-inflightreserve
  let inFlightReserve = 0;
  let boardsDone = 0;
  // The cold cursor advances by THIS, not by the composed length. A board the
  // posting budget stopped us reaching was never read, and a cursor that moves
  // past it marks it verified when nothing verified it.
  const baseTokens = new Set(baseSlice.map((b) => b.token));
  let baseAttempted = 0;
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
  // Boards whose response exceeded MAX_RESPONSE_BYTES this pass — this
  // slice's names, for the log line at the end of the loop. The DURABLE record
  // is OVERSIZE_BOARDS: slice_stats is one row overwritten every ten minutes,
  // which cannot answer "which boards have been too big for a month?", and a
  // truncated list on a row like that was the only trace a permanently
  // oversize board left.
  const oversized: string[] = [];
  // Written once per slice, and only when the registry actually changed — a
  // permanently oversize board must not cost a meta write every ten minutes.
  let oversizeDirty = false;
  let lastUpsertError: string | null = null;

  await Promise.all(
    Array.from({ length: inHotPhase ? HOT_CONCURRENCY : effConcurrency }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        // Dormant, not due for recheck: skip the dead fetch (no postings to gain,
        // ~20s of FETCH_TIMEOUT to lose). Not counted as attempted below.
        if (skipTokens.has(s.token)) continue;
        // Deferred only on what has LANDED. When it is the reservation that
        // fills the budget, this worker retires and hands the board back to a
        // worker still in flight — concurrency shrinks, the queue does not.
        if (fetchedInSlice >= SLICE_POSTING_BUDGET) { budgetSkipped.push(s.token); continue; }
        // Checked before STARTING a board, so whatever is already in flight
        // has headroom to land.
        if (boardsDone >= boardBudget) {
          sizeStopped = true;
          budgetSkipped.push(s.token);
          continue;
        }
        if (Date.now() - sliceWallStart >= SLICE_WALL_BUDGET_MS) {
          wallStopped = true;
          budgetSkipped.push(s.token);
          continue;
        }
        const heapNow = memStamp().heapMb;
        if (heapNow !== undefined && heapNow >= HEAP_SOFT_LIMIT_MB) {
          heapStopped = true;
          budgetSkipped.push(s.token);
          continue;
        }
        // Rationale: docs/job-board-index-notes.md#n076-fetchedinslice-inflightreserve-slic
        if (fetchedInSlice + inFlightReserve >= SLICE_POSTING_BUDGET) {
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
        let failReason = "";
        // Rationale: docs/job-board-index-notes.md#n078-reserve
        const reserve = inHotPhase || deepTokens.has(s.token) || CAPPED_VISIT_VENDORS.has(s.source) || !!s.pages ? MAX_POSTINGS_PER_VISIT : COLD_BOARD_RESERVE;
        if (baseTokens.has(s.token)) baseAttempted++;
        inFlightReserve += reserve;
        let r: Awaited<ReturnType<typeof fetchBoard>>;
        try { r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors.get(s.token) ?? 0); }
        finally { inFlightReserve -= reserve; }
        // Rationale: docs/job-board-index-notes.md#n411-streamed-oversize-read
        if (!r && failReason.startsWith("oversize") && SLIM_SPECS[s.source] && Date.now() - sliceWallStart + STREAM_READ_BUDGET_MS <= SLICE_WALL_BUDGET_MS && (memStamp().heapMb ?? 0) < HEAP_SOFT_LIMIT_MB) {
          inFlightReserve += reserve;
          try { r = await readOversizeBoard(s, Date.now() + STREAM_READ_BUDGET_MS, freshCutoffMs); }
          finally { inFlightReserve -= reserve; }
        }
        if (r) fetchedInSlice += r.jobs.length;
        // Rationale: docs/job-board-index-notes.md#n079-boardsdone
        ++boardsDone;
        await breadcrumb(client, "board-fetched", { boardsDone, token: s.token, got: r ? r.jobs.length : 0, fetched: fetchedInSlice, inFlight: inFlightReserve, elapsedMs: Date.now() - sliceWallStart });
        // AFTER the breadcrumb, deliberately: a-slice-with-no-clock pins
        // `++boardsDone` and the stamp as adjacent, because a board counted but
        // not stamped is the shape a dying slice leaves behind.
        if (deepLane && deepTokens.has(s.token)) deepLane.visited++;
        if (!r) {
          // Rationale: docs/job-board-index-notes.md#n080-failreason-startswith-oversize
          if (failReason.startsWith("oversize")) {
            oversized.push(s.token);
            const mb = Number(failReason.match(/([\d.]+)MB/)?.[1]) || 0;
            // The durable record. slice_stats is one row overwritten every ten
            // minutes; a board that is permanently past the budget has to be
            // nameable long after that.
            const prev = OVERSIZE_BOARDS.get(s.token);
            // Dirty on a new board, a materially different size, or a stamp
            // that has gone stale — so `at` keeps meaning "last seen oversize"
            // without costing a meta write every ten minutes for a board that
            // is simply always too big.
            const prevAge = prev ? Date.now() - new Date(prev.at).getTime() : Infinity;
            if (!prev || Math.abs(prev.mb - mb) >= 0.1 || !(prevAge < 12 * 3_600_000)) oversizeDirty = true;
            OVERSIZE_BOARDS.delete(s.token); // re-insert so the cap keeps the most RECENT
            OVERSIZE_BOARDS.set(s.token, { source: s.source, mb, at: new Date().toISOString() });
            // Rationale: docs/job-board-index-notes.md#n081-light-capable-vendors-has-s-source
            if (LIGHT_CAPABLE_VENDORS.has(s.source) && !isLight(s.token)) {
              const enrolled = await enrolDynamicLight(client, s.token, `list response ${failReason} — over the byte budget`);
              if (enrolled && baseTokens.has(s.token) && baseAttempted > 0) baseAttempted--;
            }
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
          continue;
        }
        // Advance (or wrap) this board's cursor. Written only for boards that
        // actually paginate, and cleared the moment one wraps, so the row does
        // not accumulate an entry per board in the catalogue.
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
            // The offset this visit reached. `endOffset` is the vendor's own
            // `startOffset + items fetched`, exact and independent of the wrap;
            // the fallback (older shapes, and any vendor that reports no
            // endOffset) uses our normalised count, which can only UNDERSTATE
            // coverage — a normaliser may drop a malformed entry the cursor
            // counted — and therefore fails closed.
            const reached = typeof r.endOffset === "number" && r.endOffset > 0
              ? r.endOffset
              : (typeof r.nextOffset === "number" && r.nextOffset > 0 ? r.nextOffset : cursorBefore + r.jobs.length);
            if (reached > rec.s) { rec.s = reached; deepCursorsDirty = true; }
          }
          if (rec) {
            lapEpoch = rec.e;
            lapSeen = rec.s;
            // Rationale: docs/job-board-index-notes.md#n086-totalnow
            const totalNow = Math.max(0, Math.trunc(r.feedTotal ?? 0));
            const totalRef = Math.max(totalNow, 0);
            const tailSlack = Math.min(LAP_TAIL_SLACK, Math.floor((1 - LAP_COVERAGE_MIN) * totalRef));
            if (r.nextOffset === 0 && cursorBefore > 0 && rec.f === 0 &&
                r.feedEnded === true &&
                totalRef > 0 && totalNow >= LAP_COVERAGE_MIN * rec.t0 &&
                lapSeen >= totalRef - tailSlack) {
              lapProven = true;
            }
          }
        } else if (deepLaps[lapKey]) {
          // The board stopped being windowed (or lost its cursor): it is read in
          // full now and proves absence within a single visit, so the lap entry
          // is deleted rather than left to accumulate one row per catalogue board.
          delete deepLaps[lapKey];
          deepCursorsDirty = true;
        }
        /**
         * A LAP WITH A HOLE IN ITS INSTRUMENTATION PROVES NOTHING.
         *
         * The epoch write is best-effort like every other write on this path,
         * and a failed chunk leaves rows that WERE served carrying the previous
         * epoch — indistinguishable, at the wrap, from rows nobody served. That
         * would turn a transient database error into logged employer takedowns,
         * which is precisely the failure this whole mechanism exists to
         * prevent. So any failure disarms the lap for its whole remaining
         * length; the board simply re-laps and proves absence one pass later.
         */
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
          // Distinct bases, restricted to characters a PostgREST or() pattern
          // can carry verbatim — a requisition id with anything stranger is
          // left alone rather than escaped creatively.
          const bases = [...new Set(
            r.jobs.map((j) => j.id.split(":")[2] ?? "")
              .filter(isSuffixed)
              .map((req) => req.replace(/-\d{1,2}$/, ""))
              .filter((base) => /^[A-Za-z0-9_-]+$/.test(base)),
          )];
          // The or() is bounded: over 120 branches means an unusually suffixed
          // page, and skipping the check for one pass only delays the dedupe —
          // the same rows return next refresh. Never a tenant-wide read.
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
        // Vendor circuit breaker: count every feed observation (quarantined or
        // not — the rate must keep updating so recovery lifts the quarantine),
        // then gate zero-feeds of quarantined vendors out of ALL processing.
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
        // Set when a board is over the content threshold but its vendor has no
        // filler, so light mode is refused. The volume that would wedge the
        // isolate is the same either way, so the parse is still skipped — but
        // for THIS PASS ONLY, with nothing persisted, and the description
        // column omitted from the row (see lightDescs) so stored text survives.
        // One boolean per board iteration; no allocation, no round trip.
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
        } else if (s.source === "greenhouse" && !isLight(s.token)) {
          const ghJobs = (r.raw as { jobs?: Array<{ id: number; content?: string }> }).jobs ?? [];
          // Self-tuning light mode: measure the raw content volume BEFORE the
          // htmlToText pass — that pass is what kills the isolate on giants.
          // Past the threshold: enroll the board (persisted), skip extraction
          // this pass; postings land desc-less and backfill-desc fills them.
          const contentChars = ghJobs.reduce((n, j) => n + (j.content?.length ?? 0), 0);
          if (contentChars >= AUTO_LIGHT_THRESHOLD_CHARS) {
            // Rationale: docs/job-board-index-notes.md#n089-await-enroldynamiclight-client-s-token
            if (!await enrolDynamicLight(client, s.token, `content payload ${(contentChars / 1e6).toFixed(1)}MB >= threshold`)) descsDeferred = true;
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
        } else if (s.source === "workable" && !isLight(s.token)) {
          // Same self-tuning guard as Greenhouse: details=true payloads are ~10x
          // bigger, and it's the bulk htmlToText pass — not the fetch — that kills
          // the isolate on a giant board. Measure first, enroll, fill via backfill.
          const wkJobs = (r.raw as { jobs?: Array<{ shortcode?: string; description?: string }> }).jobs ?? [];
          const contentChars = wkJobs.reduce((n, j) => n + (j.description?.length ?? 0), 0);
          if (contentChars >= AUTO_LIGHT_THRESHOLD_CHARS) {
            // Rationale: docs/job-board-index-notes.md#n090-await-enroldynamiclight-client-s-token
            if (!await enrolDynamicLight(client, s.token, `workable payload ${(contentChars / 1e6).toFixed(1)}MB >= threshold`)) descsDeferred = true;
          } else {
            for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
          }
        } else if (s.source === "pinpoint") {
          // postings.json — which we already fetch for the listing — carries the
          // full posting body. We were parsing it for titles and throwing the
          // description away, storing null on every row.
          for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
        } else if (s.source === "icims") {
          // Same shape as pinpoint, found the same way a year of nulls later:
          // the list payload carries description+qualifications on every item
          // and the parser was already written — nothing ever called it at
          // ingest. Salary mining and experience detection start working on
          // these rows in the same statement (lines below read descs).
          for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
        // Breezy has NO description field on its /json list (verified against the
        // live API 2026-07-24) — the branch that used to sit here could never
        // fire, which is why every Breezy row stored null. Its text lives only on
        // the posting page, so it is a backfill-sweep vendor now.
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
        }
        const clean = (x: string | null | undefined) => (x == null ? null : x.replace(/\u0000/g, ""));
        // isLight covers the static set, prior auto-enrollments, AND a board
        // enrolled seconds ago in this very iteration (descs skipped above).
        // descsDeferred covers the board whose enrolment was REFUSED: its descs
        // were skipped too, and writing the column would null out text we
        // already hold. Omitting it is what makes a deferral recoverable.
        const lightDescs = isLight(s.token) || descsDeferred;
        const rowsById = new Map<string, Record<string, unknown>>();
        // Rationale: docs/job-board-index-notes.md#n091-schedulewordsbyid
        const scheduleWordsById = new Map<string, string>();
        // Ids the feed still serves but whose REAL stated date crossed the
        // 30-day window — our freshness cap, not a feed absence. They bypass
        // the two-pass grace below and delete this pass, unlogged, as always.
        const agedOutIds = new Set<string>();
        for (const j of r.jobs) {
          const posted = sanePostedAt(j.postedAt); // reject garbage feed dates at the door
          // Salary resolves once — vendor text wins, else description mining —
          // and the structured parse feeds the salary-floor filter/benchmarks.
          const salaryText = (clean(j.salary?.slice(0, 200) ?? null) || null) ?? (lightDescs ? null : extractSalary(descs.get(j.id) ?? null));
          // Freshness cap: a posting with a REAL date older than the window is
          // dropped here — left out of rowsById, so the id-diff prune deletes it
          // if we already had it and never re-adds it (churn-free because it
          // won't reappear as "new"). Undated / garbage-dated postings can't be
          // judged old, so they're kept and simply carry no displayed date.
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
            // The tenant-level identity of an Oracle requisition, `oracle:<tenant>:<reqId>`,
            // which the sub-site dedupe below and the repair SQL both key on. Only
            // Oracle rows carry it; the column ships in migration 20260909216000 and
            // the upsert strips it until then.
            ...(j.source === "oracle" ? { req_key: oracleReqKeyOfId(j.id) } : {}),
            company: j.company,
            title: clean(j.title.trim().slice(0, 300)),
            location: clean(j.location.trim().slice(0, 300)),
            country: rowCountry,
            // THE JURISDICTION, which the country patterns already found and
            // then dropped on the floor. Pay-disclosure law is state-level, so
            // this is the difference between a country-level compliance score
            // and one that can name Colorado. Only recoverable while the row is
            // live — a closed posting takes its location with it.
            region_code: detectRegion(j.location, rowCountry),
            remote: j.remote,
            work_mode: j.workMode ?? null,
      employment_type: j.employmentType ?? null,
            // AGENCY DISCLOSURE (2026-08-31 charter): the flag rides the
            // CATALOG entry, stamped here onto every row — never inferred
            // per posting, because a staffing agency is one on all of its
            // postings or none. Absent on the entry means false.
            agency: s.agency === true,
            department: clean(j.department?.slice(0, 200) ?? null),
            category: j.category,
            posted_at: posted,
            apply_url: j.applyUrl,
            // Salary: the vendor's structured field when present, else mined from
            // the posting's own description text (pay-transparency prose) — always
            // the company's verbatim words, never an estimate. `|| null` (not ??):
            // an empty-string vendor salary must not block extraction.
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

        // Postings are immutable in practice (companies repost rather than
        // edit), so unchanged rows are never rewritten: insert only ids the
        // DB doesn't have, delete ids the feed no longer serves. The old
        // upsert-everything design rewrote all ~91k rows every pass
        // (~450k dead tuples/hour) — enough table bloat that aggregates
        // started hitting statement timeouts.
        let boardOk = true;
        // Paginated: PostgREST caps responses at 1,000 rows, and the biggest
        // boards hold 3,000+ — a truncated id set would re-insert live rows
        // and never delete old ones.
        // Mutable fields come back with the id diff so an existing row can be
        // CORRECTED rather than frozen at the moment it was first inserted.
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
          // Same deploy-window rule as the two below, and it must come FIRST so
          // its fallback still carries agency: a select naming an absent column
          // fails the whole board read.
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
          // Deploy-window tolerance for the disclosure column (20260831120000):
          // a select naming a column the migration has not created yet fails the
          // WHOLE board read, which is a full ingest outage from one optional
          // field. Retry without it; the correction guard already treats an
          // absent prev value as "do not patch", so the window is quiet.
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
            // OUR DISCOVERY DATE, and never a posting age: it rides along only
            // so the board-state write below can apply the SAME serving fence
            // the site applies (coalesce(posted_at, first_seen) within the
            // window). ~24 bytes on a row already carrying title, location and
            // salary, bounded by this board's stored size and released with it.
            first_seen: (r as { first_seen?: string | null }).first_seen ?? null,
            // The lap marker. One integer, read only on boards that have a lap
            // open, and the sole thing that lets a wrap tell "absent from every
            // window of a full pass" from "displaced past this visit's window".
            lap_epoch: (r as { lap_epoch?: number | null }).lap_epoch ?? null,
          })));
          if (!page || page.length < 1000) break;
        }
        if (!boardOk) {
          failed.push(`${s.name} (db-read)`);
          // The cursor already advanced past this window, but nothing here got
          // an epoch: those rows would read as never-seen at the wrap. Disarm
          // the lap rather than let a database blip become takedowns.
          failLap();
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
              // Ledger BEFORE delete, awaited: after the delete there is nothing to read.
              // A shed row is OUR action — the employer still lists the
              // requisition, on the sibling site we now store it under — so it
              // leaves under the same reason as a board dropped from the
              // catalog, never as a closure, and never reaches the closure log.
              const exitedAt = new Date().toISOString();
              // A shed row of THIS site that carries no req_key yet (stored
              // before the backfill reached its token) is absent from the
              // holder lookup; read it by id so its exit row keeps the title,
              // date and facets the ledger exists to keep.
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
              if (exErr) console.warn(`[JOB-BOARD] oracle dedupe exit-log insert failed for ${s.token} (non-fatal):`, String(exErr.message ?? "").slice(0, 120));
              for (let i = 0; i < shed.length; i += 200) {
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
        if (newRows.length > 0) {
          try {
            const blocked = new Set<string>();
            const ids = newRows.map((r) => String(r.id));
            for (let i = 0; i < ids.length; i += 200) {
              const { data: tomb, error: tErr } = await client
                .from("job_board_aged_out")
                .select("id")
                .in("id", ids.slice(i, i + 200));
              if (tErr) throw tErr;
              for (const t of tomb ?? []) blocked.add(String((t as { id: string }).id));
            }
            if (blocked.size > 0) {
              newRows = newRows.filter((r) => !blocked.has(String(r.id)));
              console.log(`[JOB-BOARD] ${s.token}: ${blocked.size} aged-out posting(s) refused re-entry`);
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
        // The epoch this visit's rows are stamped with, and the ONLY value a
        // wrap compares against. Zero disables every lap behaviour — no
        // stamping, no proof, no closures — which is what a board without a
        // cursor, without an open lap, or read before the migration applied
        // gets, byte for byte the behaviour that shipped before this change.
        const lapMark = missingColUnknown || lapColUnknown ? 0 : lapEpoch;
        // Rationale: docs/job-board-index-notes.md#n101-lapmark-0-faillap
        if (lapMark === 0) failLap();
        // The one visit per lap that may conclude a posting is gone.
        const lapMode = r.windowed === true && lapProven && lapMark > 0;
        // Rationale: docs/job-board-index-notes.md#n102-lapbackfilluntil
        const lapBackfillUntil = lapMode ? (deepLaps[lapKey]?.w0 ?? startIso) : "";
        // THE COVERAGE RECEIPT, written where the proof is actually USED rather
        // than where it is computed. `lapProven` is decided before the existing
        // -rows read, so a wrap that then turned out to be unstampable (lapMark
        // 0) would otherwise stamp `w` and tell the population function this
        // board completed a provable pass on a visit that proved nothing.
        if (lapMode) {
          const lrec = deepLaps[lapKey];
          if (lrec) {
            lrec.w = startIso;
            if (!lrec.w0) lrec.w0 = startIso;
            deepCursorsDirty = true; // the receipt must survive the hop, even if no offset moved
          }
        }
        // Hoisted: the feed-dark guard further down measures the SAME
        // population this block prunes on, and the two disagreeing is how a
        // stored ratio ends up not matching the verdict it justified.
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
          // Rationale: docs/job-board-index-notes.md#n104-vanished
          vanished = [];
          for (const id of vanishedAll) {
            if (agedOutIds.has(id)) { vanished.push(id); continue; } // freshness cap — no grace, no log
            if (partialRead && !(lapMode && existingById.get(id)?.lap_epoch !== lapMark)) continue; // absence unprovable — do not stamp, do not delete
            const stamp = missingSinceById.get(id);
            if (stamp && nowMs - new Date(stamp).getTime() >= needMs) vanished.push(id); // confirmed gone
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
            // Harmless for the stamp; NOT harmless for the lap. Rows that were
            // served keep an older epoch and would read as never-seen at the
            // wrap, so this lap forfeits its power to prove absence.
            if (lapMark > 0) failLap();
          }
        }

        // Rationale: docs/job-board-index-notes.md#n106-corrections
        const corrections: Array<Record<string, unknown>> = [];
        // changeMarks[k] is how long the change log was once corrections[k] was
        // queued, so a failure at correction k can cut the log at exactly the
        // patches that did not land. One integer per correction — capped by
        // CORRECTIONS_PER_VISIT, never by postings fetched — and released with
        // the board's scope.
        const changeMarks: number[] = [];
        // Rationale: docs/job-board-index-notes.md#n107-derived-not-employer-edits
        const DERIVED_NOT_EMPLOYER_EDITS = new Set(["region_code"]);
        // Rationale: docs/job-board-index-notes.md#n108-vendor-field-first-read
        const VENDOR_FIELD_FIRST_READ = new Set(["personio:salary"]);
        const FIELD_CHANGES_PER_VISIT = 500;
        const VALUE_CAP = 1_000; // salary strings and titles both fit generously
        const changeLog: Array<Record<string, unknown>> = [];
        const changeAt = new Date().toISOString();
        let changesDropped = 0;
        // Rationale: docs/job-board-index-notes.md#n109-changecapat
        let changeCapAt = -1;
        let changeCapLogAt = -1;
        // Corrections are capped per board visit (see CORRECTIONS_PER_VISIT
        // below). The change log has to be cut by the SAME decision, or it
        // records an edit that was never applied — and records it a second time
        // next visit, when the patch finally lands. Both arrays are built in
        // one pass in the same order, so remembering how long the log was when
        // the thousandth correction was queued is enough to cut them together.
        let changeCutAt = -1;
        // CAPPED PER BOARD-VISIT, because a backfill wave is a denial of
        // service against your own database — see the note at the truncation
        // below. Declared here so the diff loop can mark the cut point as it
        // goes; the truncation itself still happens after the loop.
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
            if (DERIVED_NOT_EMPLOYER_EDITS.has(field)) return;
            if (changeLog.length >= FIELD_CHANGES_PER_VISIT) {
              // corrections.length is the count of COMPLETED postings: this
              // posting's patch has not been pushed yet, so cutting here drops
              // it whole rather than half-logging it.
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
          // Vendor-authoritative on every fetch: correct these even to null.
          put("title", row.title, prev.title, false);
          put("location", row.location, prev.location, false);
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
          put("work_mode", row.work_mode, prev.work_mode, false);
          put("employment_type", (row as Record<string, unknown>).employment_type, (prev as Record<string, unknown>).employment_type, false);
          // Rationale: docs/job-board-index-notes.md#n112-nextpay
          const nextPay = (row.salary ?? null) as string | null;
          const curPay = (prev.salary ?? null) as string | null;
          const payCountry = ((row.country ?? prev.country) ?? null) as string | null;
          const sameMoney = statesTheSameMoney(nextPay, curPay, payCountry);
          // The first figure a newly-read vendor field hands us: our reading gained
          // an answer, the employer did nothing. See VENDOR_FIELD_FIRST_READ, which
          // is a one-shot list and names why it must be removed.
          const firstVendorRead = curPay === null && nextPay !== null && VENDOR_FIELD_FIRST_READ.has(`${s.source}:salary`);
          if (sameMoney || firstVendorRead) patch.salary = nextPay;
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
          if (typeof row.remote === "boolean") {
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
            // `patch.work_mode === undefined` keeps this from re-noting a
            // non-null change put() already wrote: two change-log rows for one
            // edit would overstate the employer's own edits.
            if (nextMode !== prev.work_mode && patch.work_mode === undefined) {
              patch.work_mode = nextMode;
              note("work_mode", prev.work_mode, nextMode);
            }
          }
          // Catalog-authoritative on every fetch, in BOTH directions: this is
          // how the 226 boards tagged on 2026-08-31 reach their EXISTING rows
          // (one rotation, capped per visit like any correction wave), and
          // how an un-tagged board's rows shed the flag. prev.agency is null
          // only in the deploy window before the column exists — no patch
          // then, so the window costs nothing.
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
          // Cut the change log at the same place. A history row for a patch we
          // did not send would claim an edit that never reached the posting,
          // and the same edit would be logged a second time on the next visit
          // when the patch finally goes through.
          if (changeCutAt >= 0) changeLog.length = changeCutAt;
        }
        // Rationale: docs/job-board-index-notes.md#n117-appliedthrough
        let appliedThrough = corrections.length;
        for (let i = 0; i < corrections.length; i += 200) {
          const chunk = corrections.slice(i, i + 200);
          const { error: cErr } = await client.rpc("apply_posting_corrections", { p_patches: chunk });
          if (cErr) {
            // Deploy-before-migration window: the frontend/function can ship
            // ahead of the RPC. Fall back to the old per-row path rather than
            // silently dropping corrections — slow beats wrong, and the next
            // pass picks up the batched path once the migration lands.
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
          // Deploy-before-migration window: the country column may not exist
          // yet. Ingestion must NEVER stall on a new optional column — retry
          // the chunk without it; the version-gated backfill fills it later.
          if (error?.message?.includes("country")) {
            const stripped = newRows.slice(i, i + 250).map((r) => { const { country: _c, ...rest } = r as Record<string, unknown>; return rest; });
            ({ error } = await client.from("job_board_postings").upsert(stripped, { onConflict: "id" }));
          }
          // Same deploy-window tolerance for the disclosure flag: the column
          // ships in 20260831120000, and until it applies the insert must
          // proceed without the field — the corrections path stamps it on the
          // board's first post-migration visit, so nothing is lost but time.
          if (error?.message?.includes("agency")) {
            // Compose with the country retry: strip BOTH optional columns, so
            // a database missing the pair still takes the chunk — mapping the
            // original slice here would re-introduce country after its own
            // retry already removed it.
            const stripped = newRows.slice(i, i + 250).map((r) => { const { agency: _a, country: _c, ...rest } = r as Record<string, unknown>; return rest; });
            ({ error } = await client.from("job_board_postings").upsert(stripped, { onConflict: "id" }));
          }
          // Same rule again for the jurisdiction column (.61). It strips ONLY
          // region_code, unlike the pair above: PostgREST names the offending
          // column in the message, country and agency have both been applied
          // for weeks, and stripping them here as well would silently drop two
          // shipped fields from every new row for the length of this window.
          if (error?.message?.includes("region_code")) {
            const stripped = newRows.slice(i, i + 250).map((r) => { const { region_code: _r, ...rest } = r as Record<string, unknown>; return rest; });
            ({ error } = await client.from("job_board_postings").upsert(stripped, { onConflict: "id" }));
          }
          // And once more for req_key (migration 20260909216000): only Oracle
          // rows carry it, only that column is stripped, and the repair
          // function backfills it from the id once the column exists.
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
          continue;
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
        // A TRUNCATED FETCH STILL LOGS NOTHING; A PROVEN LAP DOES.
        // `truncatedFetch` is a property of the VISIT and has not changed
        // meaning. `lapMode` is the strictly stronger evidence assembled across
        // visits, and it is the only thing that opens this branch for a board
        // over the page cap.
        if (vanished.length && (!truncatedFetch || lapMode)) {
          const closedAt = new Date().toISOString();
          const liveTitles = new Set(
            [...rowsById.values()].map((r) => normalizeCloseTitle(String(r.title ?? ""))).filter(Boolean),
          );
          // Relisting-spam dedupe: boards whose automation cycles req ids close
          // the SAME title dozens of times a day (live case: one board logged
          // "Behavior Technician" 89 times, every one correctly superseded).
          // The first superseded closure per title per 24h carries all the
          // signal; the rest are noise that bloats the lifecycle table. Real
          // fills (non-superseded) always log.
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
            const chunk = vanished.slice(i, i + 200);
            try {
              // Rationale: docs/job-board-index-notes.md#n122-logres
              let logRes = await client
                .from("job_board_postings")
                .select(LIFECYCLE_SELECT)
                .in("id", chunk);
              // Deploy-before-migration: a select naming an absent column fails
              // the WHOLE read, and a failed read here means the closure log —
              // the one asset nobody can reproduce — records nothing. Fall back
              // to the pre-.61 columns; a thinner row beats no row.
              if (logRes.error) {
                logRes = (await client
                  .from("job_board_postings")
                  .select("id, source, company_token, company, title, category, first_seen, posted_at")
                  .in("id", chunk)) as typeof logRes;
              }
              if (logRes.error) {
                console.warn(`[JOB-BOARD] closure-log read failed for ${s.token} (non-fatal):`, String(logRes.error.message ?? "").slice(0, 150));
              }
              const toLog = logRes.data as unknown as Array<Record<string, unknown>> | null;
              // Rationale: docs/job-board-index-notes.md#n123-isagedout
              const isAgedOut = (r: Record<string, unknown>) => {
                if (agedOutIds.has(String(r.id))) return true;
                const posted = r.posted_at ? new Date(String(r.posted_at)).getTime() : NaN;
                return Number.isFinite(posted) && posted < freshCutoffMs;
              };
              const agedRows = ((toLog ?? []) as Array<Record<string, unknown>>).filter(isAgedOut);
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
                // Through insertExits: one write path for the ledger, so this
                // site cannot end up with a narrower deploy-window retry than
                // the other three.
                waitUntil(Promise.resolve(insertExits(
                  client, agedRows.map(agedExitRow), s.token,
                )).then(({ error }) => {
                  if (error) console.warn(`[JOB-BOARD] aged-exit insert failed for ${s.token} (non-fatal):`, String(error.message ?? error).slice(0, 150));
                }).catch(() => {}));
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
                  // first_seen is OUR DISCOVERY DATE, posted_at the EMPLOYER'S
                  // STATED one. Both ride raw and separate, which is why this
                  // table needs no origin_basis: a reader derives whatever
                  // duration it wants and can always see which clock it used.
                  // Nothing here coalesces them.
                  first_seen: r.first_seen ?? null,
                  posted_at: r.posted_at ?? null,
                  closed_at: closedAt,
                  superseded: liveTitles.has(normalizeCloseTitle(String(r.title ?? ""))), // (c)
                  suspect: batchSuspect,
                  batch_removed: absentInPass,
                  batch_live_before: removableBefore,
                  // WHAT KIND OF EVIDENCE ENDED THIS POSTING. 'full_read' is a
                  // board we can read in one visit, where absence is a fact
                  // about one fetch; 'lap' is a board over the page cap, where
                  // it is a fact about a complete pass assembled across visits.
                  // The two populations are not interchangeable and no
                  // published number may pool them without saying so.
                  absence_basis: lapMode
                    ? (lapBackfillUntil && (missingSinceById.get(String(r.id)) ?? startIso) <= lapBackfillUntil ? "lap_backfill" : "lap")
                    : "full_read",
                  ...lifecycleFacets(r),
                }));
                // Rationale: docs/job-board-index-notes.md#n126-const-error-rawclerr-await-client-from-j
                const { error: rawClErr } = await client.from("job_board_closures").insert(closureRows);
                const clErr = await settleInsertError(client, "job_board_closures", rawClErr, () => closureRows, CLOSURE_OPTIONAL_COLS, s.token);
                if (clErr) console.warn(`[JOB-BOARD] closure insert failed for ${s.token} (non-fatal):`, clErr.message?.slice(0, 150));
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
                waitUntil(Promise.resolve(insertExits(
                  client, rows.map(removedExitRow), s.token,
                )).then(({ error }) => {
                  if (error) console.warn(`[JOB-BOARD] removed-exit insert failed for ${s.token} (non-fatal):`, String(error.message ?? error).slice(0, 150));
                }).catch(() => {}));
              }
            } catch (e) {
              console.warn(`[JOB-BOARD] closure log failed for ${s.token} (non-fatal):`, String(e).slice(0, 150));
            }
            const { error: delErr } = await client.from("job_board_postings").delete().in("id", chunk);
            if (delErr) console.warn(`[JOB-BOARD] closure prune delete failed for ${s.token} (non-fatal):`, delErr.message?.slice(0, 150));
          }
        } else if (vanished.length) {
          // Truncated fetch with NO completed lap behind it: prune without
          // logging — this visit still cannot distinguish closed from
          // displaced. On a windowed board `vanished` holds only ids the
          // freshness cap aged out, which is our own rule and no employer
          // event; everything else waited above for a wrap to speak for it.
          for (let i = 0; i < vanished.length; i += 200) {
            await client.from("job_board_postings").delete().in("id", vanished.slice(i, i + 200));
          }
        }
        okTokens.push(s.token);
        // A BOARD THAT READ IS NOT AN OVERSIZE BOARD ANY MORE. An enrolled
        // greenhouse giant reads fine on its very next visit, and a vendor
        // trimming its payload heals the same way. Left in the registry the
        // token would keep this board's genuinely aged-out postings out of the
        // closure log forever — the suppression that protects a live board
        // would start hiding real exits.
        if (OVERSIZE_BOARDS.delete(s.token)) oversizeDirty = true;
        // Stamp verification IMMEDIATELY, per board — not at hop end. Heavy hot
        // hops can die post-processing (WORKER_RESOURCE_LIMIT) before hop-end
        // code runs, which silently starved every hot board of stamps while the
        // light cold hops stamped fine (the 397-stale-boards incident). One tiny
        // upsert per successful board; failure is surfaced but never blocks.
        try {
          // feed_total: the company's own advertised count (Workday), so the UI
          // can render floors as "N+". Deploy-before-migration tolerance: if
          // the column doesn't exist yet, retry without it — the stamp itself
          // must never be lost to a new optional column (country-column rule).
          let { error: stampErr } = await client.from("job_board_verifications").upsert(
            { company_token: s.token, verified_at: new Date().toISOString(), feed_total: r.feedTotal ?? null },
            { onConflict: "company_token" },
          );
          if (stampErr?.message?.includes("feed_total")) {
            ({ error: stampErr } = await client.from("job_board_verifications").upsert(
              { company_token: s.token, verified_at: new Date().toISOString() },
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
        // THE BOARD IS FULLY STORED. The fetch mark above fires 760 lines
        // earlier, before the existing-rows paging, the upserts and the
        // verification stamp — so a trace that shows "board" and never
        // "board-stored" places the death inside a board's DB work rather
        // than in its fetch or in the loop's structure, which is the half
        // this instrumentation could not previously tell apart.
        await breadcrumb(client, "board-stored", { boardsDone, token: s.token, rows: rows.length, fetched: fetchedInSlice });
      }
    }),
  );

  // Rationale: docs/job-board-index-notes.md#n132-slicebudgetnote-fetched-fetchedinslice-ski
  sliceBudgetNote = { fetched: fetchedInSlice, skipped: budgetSkipped.length, hit: budgetSkipped.length > 0, lastUpsertError, heapStopped, wallStopped, sizeStopped, boardBudget };
  if (budgetSkipped.length) console.warn(`[JOB-BOARD] slice budget hit: ${fetchedInSlice} postings fetched, ${budgetSkipped.length} board(s) deferred to next pass`);
  if (oversized.length) console.warn(`[JOB-BOARD] byte budget: ${oversized.length} board(s) over ${MAX_RESPONSE_BYTES} bytes and deferred — ${oversized.slice(0, 10).join(", ")}`);
  if (oversizeDirty) await persistOversizeBoards(client);
  await breadcrumb(client, "loop-done", { boardsDone, fetched: fetchedInSlice, skipped: budgetSkipped.length, heapStopped, wallStopped, sizeStopped, elapsedMs: Date.now() - sliceWallStart });
  await stampSliceWork(client, inHotPhase, sliceWallStart);

  // Rationale: docs/job-board-index-notes.md#n133-failedacc
  const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);
  const failedTotal = (Number(pv.failedTotal) || 0) + failed.length;
  // CORRECTED HERE. The pre-loop write advanced optimistically by the composed
  // length, which is what stops a dying slice from wedging the rotation on the
  // same boards forever. This write happens only when the slice SURVIVED, so
  // it can tell the truth: the cursor moves by the boards this slice actually
  // started, and boards the posting budget kept us from are left for the next
  // slice rather than marked verified.
  const { next: progressAfter, wrapped } = advanceProgress({
    prev: { ...progressBefore, failedAcc, failedTotal },
    ...advanceArgs,
    baseSliceLen: baseAttempted,
  });
  hot = progressAfter.hot;
  cold = progressAfter.cold;
  coldDone = progressAfter.coldDone;
  // The cold cursor just wrapped past the end → the ENTIRE cold tail has now
  // been re-verified. Stamp it: this is the direct measurement of freshness
  // (max staleness of any cold posting = time since this stamp). The heartbeat
  // alerts if it ever falls behind the SLA.
  if (wrapped) {
    // Rationale: docs/job-board-index-notes.md#n134-const-data-prevrot-error-prevroterr-awa
    const { data: prevRot, error: prevRotErr } = await client.from("job_board_meta")
      .select("v").eq("k", "cold_rotation").maybeSingle();
    if (prevRotErr) {
      console.error(`[JOB-BOARD] cold_rotation pre-wrap read failed (${prevRotErr.code ?? ""} ${String(prevRotErr.message ?? "").slice(0, 100)}) — this wrap's duration will not be stamped`);
    }
    const prevAt = Date.parse(String((prevRot?.v as { completedAt?: string } | null)?.completedAt ?? ""));
    // >= 1, not merely finite: chain hops run with force=true past the slice
    // lock, so two chains wrapping within a minute could stamp wrapMin 0 —
    // which the reader would discard anyway. Better never to write it.
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
    const okSet = new Set(okTokens);
    // A DEFERRED BOARD WAS NEVER ATTEMPTED. Budget-deferred tokens were
    // counted here as consecutive failures — streak, failedAt and
    // firstFailedAt advanced for boards no fetch ever touched, feeding the
    // retry lane and, sustained, the prune. Reviewed 2026-09-03.
    const budgetSkippedSet = new Set(budgetSkipped);
    const failedTokens = slice
      .map((s) => s.token)
      .filter((tk) => !skipTokens.has(tk) && !quarantineSkipped.has(tk) && !budgetSkippedSet.has(tk) && !okSet.has(tk));
    if (okTokens.length > 0 || failedTokens.length > 0 || recheckTokens.size > 0) {
      const { streaks, dormant, failedAt, firstFailedAt, toPrune } = updateBoardFailures({
        okTokens,
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
      for (const tk of toPrune) {
        const n = await logWholeBoardExit(client, tk, "board_dormant");
        await client.from("job_board_postings").delete().eq("company_token", tk);
        console.warn(`[JOB-BOARD] board ${tk} dormant after ${DEAD_BOARD_THRESHOLD} consecutive failures spanning at least ${Math.round(DEAD_BOARD_MIN_FAILING_MS / 3_600_000)}h (${n} postings pruned and logged as board_dormant; fetch skipped until recheck)`);
      }
      await client.from("job_board_meta").upsert(
        { k: "board_failures", v: { streaks, dormant, failedAt, firstFailedAt, ...(retryLane ? { lastRetryLane: retryLane } : {}) }, updated_at: new Date().toISOString() },
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
            // Deliberately NOT restoring keys we do not hold. `mine` is absent
            // for two different reasons — a board another isolate added since
            // our read, and a board THIS isolate retired because it stopped
            // being windowed — and the fold cannot tell them apart. Resurrecting
            // a retired lap is the worse error (it re-arms stamping on a board
            // that is read in full), and the cost of the other is one lap.
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
        const attempted = staleBoards.map((s) => s.token).filter((tk) => !budgetSkippedSet.has(tk));
        const resolved = attempted.filter((tk) => okSet.has(tk)).length;
        const nextTries = bumpStaleTries(staleTries, attempted, okSet);
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

  // Vendor circuit-breaker bookkeeping: decay-merge this slice's feed counts
  // and recompute the quarantine set (trip at VENDOR_ZERO_TRIP, lift below
  // VENDOR_ZERO_RESET). Hop-end placement is fine HERE — losing a heavy hop's
  // counters delays the trend by a slice, it never corrupts per-board state
  // (which is why stamps write at the success site but this doesn't have to).
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
    // THE TAIL PULSES TOO. The dead-chain watchdog judges the freshest stamp
    // on slice_trace / slice_stats / refresh_progress, and this block is the
    // longest silence a live hop can show after its loop-done mark: facets,
    // orphan prune and the freshness sweep page the table for minutes. Three
    // coarse marks per PASS (never per slice) bound that silence at one block
    // and keep a status call during the tail inside the window.
    await breadcrumb(client, "pass-end", { elapsedMs: Date.now() - sliceWallStart });
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
          // The per-source map rides the carry by the same rule: present only
          // when the previous row had it, absent otherwise, so the vendor
          // dropdown falls silent rather than printing a stale-or-empty map.
          ...(pv.sourcesFacet && typeof pv.sourcesFacet === "object" && !Array.isArray(pv.sourcesFacet)
            ? { sourcesFacet: pv.sourcesFacet }
            : {}),
        };
        facetsCarried = true;
      } else {
        // Cold database AND a failed aggregate: nothing to carry, nothing the
        // maintenance below could safely stand on. The original early return
        // is still right for exactly this corner.
        await recordSliceStats(client, sliceWallStart, inHotPhase);
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
      // Written when the hash differs OR the stamped bundle version differs:
      // the migration's seed carries the same hash and no version, and the
      // repair SQL refuses its delete phase until a bundle that dedupes at
      // ingest (this one or later) has stamped `version` here. Without that
      // proof the pre-.68 bundle re-inserts every copy the repair deletes.
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
      // Carried facets are yesterday's company list — good enough to SERVE,
      // never good enough to DELETE by. A destructive path computes its own
      // input (the rule stated on the RPC call above), and a carried input is
      // not its own.
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
          orphanLogged += await logWholeBoardExit(client, tk, "untracked");
          await client.from("job_board_postings").delete().eq("company_token", tk);
        }
        console.log(`[JOB-BOARD] orphan-pruned ${orphanTokens.length} removed board(s), ${orphanLogged} postings logged as untracked: ${orphanTokens.slice(0, 8).join(", ")}`);
        companies = companies.filter((c) => !orphanTokens.includes((c as { token?: string }).token ?? ""));
      }
      await breadcrumb(client, "pass-end-pruned", { orphans: orphanTokens.length, elapsedMs: Date.now() - sliceWallStart });
    }

    // Rationale: docs/job-board-index-notes.md#n145-nowiso
    const nowIso = new Date().toISOString();
    {
      const futureIso = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const garbageIso = new Date(POSTED_AT_GARBAGE_FLOOR_MS).toISOString();
      const { error: e1 } = await client.from("job_board_postings").update({ posted_at: null }).gt("posted_at", futureIso);
      const { error: e2 } = await client.from("job_board_postings").update({ posted_at: null }).lt("posted_at", garbageIso);
      if (e1 || e2) console.warn("[JOB-BOARD] date-hygiene error:", (e1 ?? e2)?.message);
    }

    // Freshness cap sweep: drop the aged tail (effective_posted past the window)
    // so the corpus reclaims itself immediately rather than waiting a full cold
    // rotation for the per-board prune. Bounded per pass (a single delete of the
    // ~65k initial backlog risks a statement timeout on the free tier); the
    // ingestion filter keeps dated-old postings from re-entering, so this
    // converges within a few passes and then only trims the daily trickle.
    {
      const freshCutoffIso = new Date(freshCutoffMs).toISOString();
      const ids: string[] = [];
      for (let from = 0; ids.length < FRESH_PRUNE_MAX; from += 1000) {
        const take = Math.min(1000, FRESH_PRUNE_MAX - ids.length);
        const { data: page, error } = await client
          .from("job_board_postings")
          .select("id")
          .lt("effective_posted", freshCutoffIso)
          .order("effective_posted", { ascending: true })
          .range(from, from + take - 1);
        if (error) { console.warn("[JOB-BOARD] freshness sweep select error:", error.message); break; }
        ids.push(...(page ?? []).map((r) => r.id as string));
        if (!page || page.length < take) break;
      }
      // Rationale: docs/job-board-index-notes.md#n146-alreadytombstoned
      const alreadyTombstoned = new Set<string>();
      if (ids.length > 0) {
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
      }
      if (ids.length > 0) {
        const exitedAt = new Date().toISOString();
        for (let i = 0; i < ids.length; i += 200) {
          const slice = ids.slice(i, i + 200);
          // Widened with the lifecycle facets and effective_posted (which the
          // tombstone below needs). Same read that was already running; the
          // posting is deleted a few lines further on, so this is the last
          // moment its pay, team, geography and level exist.
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
          // Write the tombstone for every aged row, whether or not it is new
          // to us — this is what keeps it from coming back.
          waitUntil(Promise.resolve(client.from("job_board_aged_out").upsert(
            agedRows.map((r) => ({
              id: r.id as string,
              source: r.source as string,
              company_token: r.company_token as string,
              posted_at: (r.effective_posted ?? r.posted_at) as string | null,
            })),
            { onConflict: "id" },
          )).then(() => {}).catch(() => {}));
          // Rationale: docs/job-board-index-notes.md#n147-oversizeheld
          const oversizeHeld = agedRows.filter((r) => OVERSIZE_BOARDS.has(String(r.company_token)) && !alreadyTombstoned.has(String(r.id)));
          for (const r of oversizeHeld) alreadyTombstoned.add(String(r.id));
          if (oversizeHeld.length > 0) {
            console.warn(`[JOB-BOARD] freshness sweep: ${oversizeHeld.length} aged posting(s) on ${new Set(oversizeHeld.map((r) => String(r.company_token))).size} OVERSIZE board(s) dropped without a closure-log entry — the board is deferred by the byte budget, not closed`);
          }
          const freshlyDead = agedRows.filter((r) => !alreadyTombstoned.has(String(r.id)));
          if (freshlyDead.length === 0) continue;
          // The other site the hiring-health estimator draws censoring times
          // from (exit_reason <> 'removed'), and the other one that was
          // coalescing posted_at with first_seen per row with no flag. Same
          // rule as everywhere else now: emit the duration, name its clock.
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
      }
      let dropped = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await client.from("job_board_postings").delete().in("id", ids.slice(i, i + 200));
        if (error) { console.warn("[JOB-BOARD] freshness sweep delete error:", error.message); break; }
        dropped += Math.min(200, ids.length - i);
      }
      if (dropped > 0) console.log(`[JOB-BOARD] freshness cap: dropped ${dropped} postings older than ${FRESH_WINDOW_DAYS}d`);
      await breadcrumb(client, "pass-end-swept", { dropped, elapsedMs: Date.now() - sliceWallStart });
      // Tombstones expire, so the table stays bounded and a vendor that
      // recycles posting ids eventually gets a second chance. 180 days is far
      // past any window in which a re-fetched id could still be the same
      // aged-out job.
      try {
        await client.from("job_board_aged_out").delete()
          .lt("aged_at", new Date(Date.now() - 180 * 86_400_000).toISOString());
      } catch { /* bounded cleanup — never worth failing a pass over */ }
    }

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
      // Record headroom each pass so the heartbeat can watch the corpus trend
      // toward the ceiling before it ever binds. `basis` travels with it: an
      // unmeasured corpus must NOT be published as a healthy headroom, which is
      // exactly what `corpusSize ?? 0` used to do.
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

    // Rationale: docs/job-board-index-notes.md#n149-coverage
    const coverage = await (async () => {
      // The numerator must stand on the SAME population as the denominator.
      // `open` below applies the freshness window; this did not, so every
      // published fraction was a count over one population divided by the
      // size of a smaller one — inflating each by 1.5-3%. A coverage figure
      // whose two halves disagree about what the board is cannot be right
      // even when it looks plausible.
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
          // Same carry-forward contract as the fallback path: a figure the
          // scan could not produce keeps last pass's value rather than
          // deleting the disclosure.
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
            // THE COLUMN THE STATES-PAY FILTER BINDS, carried through because
            // the disclosure has to read it. get_filter_coverage has counted it
            // on this same scan since 20260909100000 and nothing stored it, so
            // the sentence under a stated-pay page had no way to describe the
            // population that page was actually narrowed to. Cost: zero extra
            // work — the count was already in the payload being discarded.
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
        // A STALE-BUT-REAL FIGURE BEATS AN ABSENT ONE. Overwriting a working
        // number with null on a transient failure deletes the caveat entirely,
        // and the filter it describes keeps hiding the same share of the board
        // with nothing on screen to say so. Coverage moves by fractions of a
        // percent between passes, so last pass's figure is still true enough to
        // warn with — and it is replaced the moment a count succeeds again.
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
        // THE FIVE LIVE FIGURES THE ONE-SCAN RPC PRODUCES must survive a pass
        // where the RPC fails and this fallback runs — the upsert replaces v
        // whole, so leaving them out of this return DELETES them and the
        // disclosure silently reverts to the dated pinned constants. Carried
        // from prevCoverage exactly like a failed count's own figure is.
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
          // Carried for the same reason as its four neighbours: the upsert
          // replaces the whole block, so omitting the figure the states-pay
          // disclosure reads deletes it and that sentence goes silent until the
          // next successful scan.
          salaryText: carryLive("salaryText"),
          maxYears: carryLive("maxYears"),
          department: carryLive("department"),
          employmentType: carryLive("employmentType"),
          // Carried for the same reason, and it is a COUNT rather than a
          // fraction: this path runs when the one-scan RPC failed, so there is
          // nothing to re-measure it from, and dropping it would delete the only
          // external evidence for the invariant the states-pay widening rests on.
          annualWithoutText: carryLive("annualWithoutText"),
          ...(coverageFailed.length ? { staleParts: coverageFailed } : {}),
        };
        // `open` doubles as the honest board total — see the headline note in
        // serveList. It is an EXACT count of exactly the rows a visitor can
        // page to, taken in the same pass, so it costs nothing extra.
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
      // source -> servable count, same pass, same two serving predicates as
      // categoriesFacet (migration 20260909214000). Spread only when the pass
      // produced it: an absent key is what the vendor dropdown reads as
      // "publish no number", and an empty map would read as twenty zeros.
      ...(f.sourcesFacet && typeof f.sourcesFacet === "object" && !Array.isArray(f.sourcesFacet)
        ? { sourcesFacet: f.sourcesFacet }
        : {}),
      // Rationale: docs/job-board-index-notes.md#n157-coverage-coverage-coverage-at-st
      ...(coverage ? { coverage: { ...coverage, at: startIso } } : {}),
      // Facet fields above are LAST pass's, carried through an aggregate
      // failure so the upsert-replaces-whole-v write cannot clobber them —
      // named so a reader of this row can tell a carried total from a fresh one.
      ...(facetsCarried ? { facetsCarried: true } : {}),
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
      // The carried-facets marker must ride the SERVED row, not only the fat
      // one — serving reads refresh_head. Stamped here it left no trace on the
      // row anyone actually reads, so a carried (stale) total served as current
      // was indistinguishable from a freshly computed one. Now the served row
      // says which it is.
      ...(facetsCarried ? { facetsCarried: true, facetsCarriedAt: v.refreshedAt } : {}),
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
      // ORDERED BY WHAT IS OPEN, once we know it. The old ordering (raw facet
      // count) put a board with 4,000 withdrawn postings and none open at the
      // top of the employer dropdown. `count` stays ON the entry — it is what
      // mergeCompanyFacet folds sub-boards by and what picks the stable
      // primary token for links — but serveList strips it before it reaches
      // the wire, so no client can render it.
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
    // (The quiet-set refresh that used to live here went with the quiet lane —
    // see the removal note in the cold-phase skip logic. One fewer heavy RPC
    // per pass.)
    if (ranked.length >= 50) {
      await client.from("job_board_meta").upsert(
        { k: "hot_tokens", v: { tokens: ranked }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
    }
    console.log(`[JOB-BOARD] pass complete: hot ${HOT_LIST.length} boards + ${COLD_SLICES_PER_PASS} cold slices; corpus total ${f.total}`);
    // Experience bands not yet backfilled (fresh column on existing rows)? Fill
    // the NULL tail in a self-chaining sweep with its own compute budget. Stamped
    // on completion so it runs once; new rows already carry a band from ingestion.
    const { data: expVer } = await client.from("job_board_meta").select("v").eq("k", "experience_version").maybeSingle();
    if ((expVer?.v as { version?: number } | null)?.version !== EXPERIENCE_VERSION) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-experience", chainKey: key }),
      })).then((r) => discardBody(r)).catch(() => {}));
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

    // Undated rows whose vendor feed DOES carry dates? Date them once.
    // The kick now (a) stands down while a chain is demonstrably alive
    // (hop stamp < 5 min old) instead of spawning a concurrent duplicate,
    // and (b) revives a DEAD chain at its stored phase+cursor rather than
    // from the beginning — restart-from-scratch is why v2's late phases
    // never ran.
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
    // One-time name sync: ~48 rung-3 census names shipped HTML-escaped
    // ("Bob's Main Street Auto &amp; Towing") and were decoded in the catalog —
    // but the refresh is INSERT-ONLY by design (existing rows are never
    // rewritten), so stored rows can never heal on their own. Find rows still
    // carrying escaped names and sync them (postings + closures, which feed
    // the actively-hiring leaderboard) to the decoded catalog name. Stamped.
    const { data: nsVer } = await client.from("job_board_meta").select("v").eq("k", "name_sync_version").maybeSingle();
    if ((nsVer?.v as { version?: number } | null)?.version !== NAME_SYNC_VERSION) {
      try {
        const tokens = new Set<string>();
        for (const pat of ["%&amp;%", "%&#039;%"]) {
          const { data: escRows } = await client.from("job_board_postings").select("company_token").like("company", pat).limit(1000);
          for (const r of escRows ?? []) tokens.add(r.company_token as string);
        }
        // Boards whose catalog display name was CORRECTED rather than merely
        // escaped. Same insert-only problem, same cure: stored rows keep the
        // old name forever unless something rewrites them, so a rename in
        // sources.ts is invisible on the site without this sweep.
        for (const tk of RENAMED_TOKENS) tokens.add(tk);
        // Rationale: docs/job-board-index-notes.md#n165-fixed
        let fixed = 0, failed = 0, already = 0;
        for (const tk of tokens) {
          const src = JOB_SOURCES.find((s) => s.token === tk);
          if (!src) continue;
          // (a) SKIP BOARDS ALREADY CORRECT. Makes every retry cheaper than the
          //     last, so successive passes get further instead of re-doing the
          //     same expensive updates and dying in the same place.
          const { data: stale } = await client.from("job_board_postings")
            .select("company_token").eq("company_token", tk).neq("company", src.name).limit(1);
          if (!stale?.length) { already++; continue; }
          // (b) NARROW THE UPDATE to rows that actually differ. The old
          //     statement rewrote every row for the token including ones already
          //     carrying the right name, which is what made the big boards time
          //     out in the first place.
          const { error: e1 } = await client.from("job_board_postings")
            .update({ company: src.name }).eq("company_token", tk).neq("company", src.name);
          const { error: e2 } = await client.from("job_board_closures")
            .update({ company: src.name }).eq("company_token", tk).neq("company", src.name);
          if (e1 || e2) {
            failed++;
            console.warn(`[JOB-BOARD] name sync: ${tk} failed:`, (e1 ?? e2)?.message?.slice(0, 120));
          } else fixed++;
        }
        // (c) STAMP ONLY ON A CLEAN RUN. Leaving it unstamped costs one more
        //     pass; stamping over failures costs the rename permanently.
        if (failed === 0) {
          await client.from("job_board_meta").upsert(
            { k: "name_sync_version", v: { version: NAME_SYNC_VERSION, fixed, already, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
            { onConflict: "k" },
          );
          console.log(`[JOB-BOARD] name sync v${NAME_SYNC_VERSION} complete: ${fixed} renamed, ${already} already correct`);
        } else {
          console.warn(`[JOB-BOARD] name sync v${NAME_SYNC_VERSION} INCOMPLETE: ${fixed} renamed, ${failed} failed, ${already} already correct — version left unstamped so the next pass resumes`);
        }
      } catch (e) {
        console.warn("[JOB-BOARD] name sync failed (retries next pass):", String(e).slice(0, 150));
      }
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

    await maybeKickMaintenance(client);
    await recordSliceStats(client, sliceWallStart, inHotPhase);
    return { ok: true, detail: `pass complete — corpus ${f.total} postings from ${companies.length} boards; cold rotation at ${cold}/${COLD_LIST.length}${lastUpsertError ? ` — last upsert error: ${String(lastUpsertError).slice(0, 120)}` : ""}` };
  }

  // Rationale: docs/job-board-index-notes.md#n166-await-maybekickmaintenance-client
  await maybeKickMaintenance(client);
  // Earned, not assumed: this hop reached its terminal write, so the next may
  // try more. A hop that dies never gets here, and the cron's fresh chain
  // carries no budget, so the ramp restarts at the floor.
  if (chainHop < CHAIN_CAP) chainNextSlice(chainHop, client, Math.min(MAX_BOARDS_PER_SLICE, boardBudget + BOARDS_RAMP_STEP));
  const phase = inHotPhase ? `hot ${Math.min(hot, HOT_LIST.length)}/${HOT_LIST.length}` : `cold slice ${coldDone}/${COLD_SLICES_PER_PASS} (rotation ${cold}/${COLD_LIST.length})`;
  await recordSliceStats(client, sliceWallStart, inHotPhase);
  // The shed level rides the summary, because a rotation that is deliberately
  // running small must not look like a rotation that is mysteriously slow.
  return { ok: true, detail: `slice done (${sliceTotal} postings, ${failed.length} failed) — ${phase}${shedLevel > 0 ? ` [shedding L${shedLevel}]` : ""}${budgetSkipped.length ? ` [budget: ${fetchedInSlice} fetched, ${budgetSkipped.length} deferred]` : ""}` };
}

// Rationale: docs/job-board-index-notes.md#n167-verify-grace-ms
const VERIFY_GRACE_MS = 6 * 60 * 60_000;

const MAINTENANCE_ANY_GAP_MS = 10 * 60_000; // floor between any two kicks
// Rationale: docs/job-board-index-notes.md#n168-maintenance-stall-ms
const MAINTENANCE_STALL_MS = 12 * 60_000;

/**
 * THE DEAD-CHAIN WATCHDOG. Decision in chain-watchdog.ts (pure, tested); this
 * is the I/O half: one read of five meta rows, and — on "rekick" only, from a
 * status call only — one conditional stamp and one plain, NON-forced
 * {action:"refresh"}, the body pg_cron sends. Non-forced means runRefresh's
 * SLICE_LOCK_MS check still guards it, so a live chain that merely looked
 * quiet answers "skipped" and no second chain starts.
 *
 * THE PULSE IS THE FRESHEST OF FOUR STAMPS, not slice_stats.workAt alone:
 * refresh_progress.updated_at (hop start and end), slice_trace.updated_at
 * (every board fetched and stored), slice_stats.workAt (loop end) and
 * slice_stats.at (hop end). The first cut read only workAt and would have
 * called a live hot slice dead: hot slices run 341s and workAt is silent for
 * the whole loop, while the window at the live cold EMA is ~4 min. A live
 * loop now pulses per board, so its longest silence is one board's
 * FETCH_TIMEOUT_MS and the cold-EMA window holds in both phases.
 *
 * THE chain_kick ROW IS ONE HOP BEHIND (chain-watchdog.ts header): 'continued'
 * is the grandparent's verdict on the parent, stamped while the child runs,
 * and if the child then dies with its parent the row stays 'continued'
 * forever. So 'continued' proves the chain alive only while nothing has
 * pulsed since it was stamped; a later pulse supersedes it and the window
 * rule decides. Judge this watchdog, after deploy, on deaths of EITHER shape.
 *
 * FALLS THROUGH, and takes its own stamp (`chain_watchdog`, floor SLICE_LOCK_MS)
 * rather than the exclusive ladder's `maintenance_kick` and its ten-minute
 * floor — the desc-sweep rule: a kick that consumed the ladder's stamp would
 * starve the tracks behind it, and a ten-minute floor here would recreate the
 * wait 20260909219000 exists to remove. The stamp is a CONDITIONAL write
 * (update where the row is older than the lock, else insert): the decision's
 * throttle is read-then-write across two round trips, and two status calls a
 * few hundred milliseconds apart both passed it. Only the call whose write
 * lands sends the kick; the other reads "throttled".
 *
 * NEVER on an unsuperseded 'continued', and never inside 2 x coldEmaMs +
 * SLICE_LOCK_MS of the freshest pulse — both decided in decideRekick and
 * pinned by its test; this function sends nothing on any other verdict.
 *
 * NEVER FROM INSIDE A HOP. maybeKickMaintenance calls this with inHop, from a
 * hop that is itself the chain's pulse — at pass end it runs AFTER a tail
 * (facets, orphan prune, freshness sweep) that can outlast the window, and a
 * kick from there would start a second chain beside the one evaluating. The
 * in-hop path observes, logs a would-have-fired as the measurement of how
 * often a tail exceeds the window, and returns "in_hop". The status action is
 * the path monitors hit while nothing else runs; a dead chain is observed
 * there, and that is where the re-kick actually shortens dark time. Returns
 * the verdict so status can publish the decision it just made.
 */
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
    // A paused ingest is a chain that is SUPPOSED to be silent. runRefresh
    // would decline the kick at its own pause check, but a kick every
    // SLICE_LOCK_MS on every status call while an operator holds the pause is
    // noise dressed as recovery. One bounded meta read, only on this branch.
    if (await isIngestPaused(client)) return { ...report, decision: "paused" };
    // Stamp BEFORE the kick, the order every chain hop uses: a kick whose
    // stamp is lost is a kick that happened, so the throttle reads what was
    // sent, not what landed. CONDITIONAL: the row is taken only if it is older
    // than the lock (or absent), so of two callers racing here exactly one
    // sends.
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
    // The dead-chain watchdog first, and it falls through: its own stamp, its
    // own SLICE_LOCK_MS floor, never this function's ten-minute gap. In-hop it
    // OBSERVES only — this hop is the chain's pulse, and at pass end it is
    // reached after a tail that can outlast the window.
    await maybeRekickDeadChain(client, { inHop: true });
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

    // Embedding sweep — the second independent track. In-runtime inference +
    // DB writes, no vendor fetches. "Done" only means the backlog is empty
    // RIGHT NOW (new postings arrive around the clock, and desc-sweep keeps
    // upgrading title-only rows), so a completed sweep re-kicks on a
    // 60-minute cadence rather than settling for good.
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

    // Categorization rules changed since the corpus was stamped? Sweep the
    // stored "other" rows through the current rules in a fresh invocation
    // (own compute budget). Idempotent: the stamp is written only when the
    // sweep completes, so a died sweep retries later.
    const { data: catVer } = await client.from("job_board_meta").select("v").eq("k", "category_rules_version").maybeSingle();
    const cv = (catVer?.v ?? null) as { version?: number; startedUnder?: number } | null;
    // startedUnder is required, not optional: a completion stamp without it
    // may have been written by a chain that STARTED under the previous rules
    // and straddled the deploy (measured 2026-08-23, v8→v9) — its "done" is
    // a lie about every id before its deploy-time cursor. Such stamps re-arm
    // one full sweep and are then re-written with provenance.
    if (cv?.version !== CATEGORIZE_VERSION || Number(cv?.startedUnder) !== CATEGORIZE_VERSION) {
      const prog = await alive("recategorize_progress");
      if (!prog.alive) {
        // Resume from the dead chain's frontier — but ONLY if that chain
        // STARTED under the CURRENT rules. A frontier cut by a v(N-1) chain
        // (or by a straddling chain, whose per-hop stamps claim the new
        // version) would make the v(N) sweep skip everything before its
        // cursor, leaving rows judged only by the old rules.
        const sameVersion = Number(prog.v?.startedUnder) === CATEGORIZE_VERSION;
        const cursor = sameVersion && typeof prog.v?.cursor === "string" ? prog.v.cursor as string : "";
        await kick("recategorize", { ...(cursor ? { cursor } : {}), rulesVersion: CATEGORIZE_VERSION });
      }
      return;
    }
    // Light boards' descriptions (they arrive description-less on the refresh
    // path). Only when the last backfill is stale, and never concurrent with
    // recategorize — staggered by requiring the category stamp to be current.
    const { data: bf } = await client.from("job_board_meta").select("v, updated_at").eq("k", "desc_backfill").maybeSingle();
    const bfAge = bf ? Date.now() - new Date(bf.updated_at).getTime() : Infinity;
    const bfIncomplete = !!(bf?.v as { incompleteAt?: string } | null)?.incompleteAt;
    // Rationale: docs/job-board-index-notes.md#n174-lighttokens
    const lightTokens = descBackfillBoards().map((s) => s.token);
    let missingCoverage = false;
    if (lightTokens.length > 0 && bfAge > 30 * 60_000) {
      const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).in("company_token", lightTokens).is("description", null);
      missingCoverage = (count ?? 0) > 50;
    }
    // Rationale: docs/job-board-index-notes.md#n175-missingcoverage-bfage-bfincomplete
    if (missingCoverage || bfAge > (bfIncomplete ? 60 * 60_000 : 24 * 60 * 60_000)) {
      await kick("backfill-desc", { ti: 0, off: 0 });
    }
    // Rationale: docs/job-board-index-notes.md#n176-ds
    const ds = await alive("desc_sweep");
    const doneAt = typeof ds.v?.doneAt === "string" ? Date.parse(ds.v.doneAt as string) : NaN;
    // Completed runs settle to a 6-hour cadence (only the delta needs work);
    // a dead chain — stale stamp, no doneAt — re-kicks within minutes. vi:0 is
    // self-resuming: filled rows have left the description-is-null filter.
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

/** Resolve to `{ data: null }` if a query outruns its deadline. Used for the
 *  optional analytics on the status action: a stat that is slow to compute is
 *  worth omitting, never worth delaying the deploy answer for.
 *
 *  TWO THINGS A CALLER MUST KNOW. (1) A REJECTED promise also resolves to
 *  `{ data: null }` — indistinguishable from a timeout here; a caller that
 *  publishes the reason maps rejections to an error object BEFORE handing
 *  the promise in (the stale lane does). (2) This is a race, not a cancel:
 *  the losing query keeps running and its response is abandoned unread. A
 *  caller on a hot path attaches its own abort at the deadline. */
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

// The pay rides in the cache beside the text because a cache HIT must answer the
// same question a miss does. Cached without it, the demand-weighted lane would
// keep the description and lose the employer's stated pay on the second reader of
// the same posting — the leak below, reproduced silently and only sometimes,
// which is worse than the leak.
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
      // Per-requisition detail: a pulled posting returns an empty items array
      // rather than a 404, so treat "no item" as gone and a bad status as
      // unknown (never as closed).
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
      // Last word: the CXS detail endpoint, which is authoritative rather than
      // index-backed — 200 with a jobPostingInfo is live, 404 is gone. It needs
      // the full externalPath, which only apply_url carries, so callers pass it.
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
      const r = await fetchBoard(src);
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

/**
 * BOTH HALVES OF THE PAYLOAD, BECAUSE THROWING ONE AWAY HERE IS PERMANENT.
 *
 * This used to destructure `{ text }` and drop the pay — and every writer that can
 * fill a Paylocity or Breezy description is gated on `description IS NULL`, so the
 * row this lane persists never re-enters the desc sweep, the only other lane wired
 * to the vendor's pay. The SALARY_PARSE_VERSION re-sweep cannot recover it either:
 * that lane re-reads stored salary TEXT and this row's salary is null. So a posting
 * that any reader opened before the sweep reached it lost its vendor-stated figure
 * for good, on exactly the rows with the most demand, and the prose miner finds pay
 * on 0 of them. Measured backlog 2026-09-27 (anon key, countOnly): paylocity 43,042
 * rows / 40,464 described = 2,578 null; breezy 14,580 / 14,068 = 512 null.
 *
 * Two lanes reading the SAME downloaded bytes must produce the same answer, which
 * is the argument for one reader returning both halves, one level up.
 */
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

/**
 * Descriptions carried in a board's LIST payload, keyed by our posting id.
 *
 * Used by BOTH the ingest path (which stores them on insert) and the board-level
 * lane of desc-sweep (which fills rows inserted before the extraction existed),
 * so the two can never disagree about how a vendor's payload is read.
 */
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

// A lever/ashby board the byte bound refuses cannot answer a detail read, and
// asking again on every view repeats the refused download (up to 4 MB for
// ashby). The refusal is remembered per board, per isolate, for a few hours —
// the oversize verdict only, never a failure that may be transient.
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

/**
 * One posting's description straight from the vendor. Shared by the on-demand
 * `detail` read and the backfill sweep so the two can never drift apart.
 *
 * Every vendor is matched EXPLICITLY and anything unrecognised returns null.
 * The previous shape ended in a bare `else` that assumed the Ashby payload, so
 * workday/breezy/rippling silently parsed the wrong structure and always
 * returned null — which is why ~313k Workday postings had no description on the
 * detail panel, not just in storage.
 */
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
  /**
   * THE EMPLOYER'S OWN PAY, OFF THE SAME BYTES AS THE DESCRIPTION.
   *
   * Paylocity and Breezy server-render a schema.org JobPosting node on the
   * posting page this function already downloads and already parses for the
   * description, and the pay half of that node was read by nothing. Rates, each
   * with its own denominator and never merged: PAYLOCITY 90 of 240 pages (37.5%)
   * and 46 of 150 on an independent draw (30.7%); BREEZY 33 of 60 (55.0%) and 33
   * of 80 (41.3%), where 29 of the 33 are ONE tenant's duplicate subcontractor
   * postings, so the Breezy figure describes an employer and not a vendor — and
   * that tenant's WEEK label is refused by this reader anyway. The repo's own
   * prose miner finds pay on 0 of those 240 rows, so none of it is cannibalised
   * by what we already do.
   *
   * Already formatted and already REFUSED where the vendor's period label
   * contradicts its own magnitude — ldBaseSalaryText owns those rules. null
   * means "no publishable figure", which includes "the vendor stated one we
   * will not stand behind", and callers must treat the two identically.
   *
   * NOT FREE FOR THE ROWS THAT ALREADY HAVE A DESCRIPTION. Every caller of this
   * function that writes salary is gated on description being null, so a row is
   * fetched once, when it is new, and this field accrues forward with the
   * rotation instead of back-filling the rows already described.
   */
  pay: string | null;
}> {
  let text: string | null = null;
  // Rationale: docs/job-board-index-notes.md#n183-country
  let country: string | null = null;
  let location: string | null = null;
  let additionalSites = 0;
  // Vendor-STRUCTURED work mode, when the same detail payload states one
  // (today: workday remoteType). Callers write it as authoritative — a
  // structured field always outranks text inference. null = not stated.
  let workMode: "remote" | "hybrid" | "onsite" | null = null;
  // Absolute posting date, where the SAME payload happens to carry one. Free:
  // no extra request. Workday's list only exposes a relative bucket ("Posted
  // 30+ Days Ago") which floors at 30 days — measured as an exactly-30.0-day
  // median gap for Workday against ~18 for every other vendor — so its
  // absolute startDate is strictly better than what we store. BambooHR's
  // 43,943 postings are 0% dated and its detail carries datePosted.
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
    // The list payload has no description and the stored id is a bare
    // requisition number, so the CXS detail endpoint is derived from the
    // apply_url. Sampled 2026-07-24: 30/30 boards returned a real body,
    // median 5,731 chars.
    const cxs = applyUrl ? workdayCxsUrl(applyUrl) : null;
    if (cxs) {
      const res = await fetchWithTimeout(cxs);
      if (res.ok) {
        const j = await res.json().catch(() => null) as { jobPostingInfo?: { jobDescription?: string; startDate?: string; remoteType?: string } } | null;
        const html = j?.jobPostingInfo?.jobDescription ?? "";
        text = html ? htmlToText(String(html)).slice(0, DESC_CAP) || null : null;
        postedAt = isoDateOnly(j?.jobPostingInfo?.startDate);
        // The place, out of bytes this lane has always downloaded and dropped.
        // The parse is workdayDetailPlace in normalize.ts, where a guard walks
        // real captured payloads against it — the field path is one level
        // shallower than it looks and a wrong path fails silently, returning
        // undefined on every posting with every local check still green.
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
    // Was hard-coded to null on a note that the detail endpoint threw 500s.
    // Re-measured 2026-07-24 across 40 distinct boards: 40/40 succeeded,
    // median 6,271 chars. The note was stale; 43,956 postings were being
    // written off on it.
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
    // The list carries no description and no date; the posting page carries
    // both — a schema.org JobPosting JSON-LD on most boards (datePosted +
    // description) and a #job-description container on all of them (8/8
    // probed 2026-09-04). TELECOMMUTE in the JSON-LD is the only structured
    // work mode the vendor states; nothing is inferred from prose here.
    const res = await fetchWithTimeout(applyUrl || jazzhrPostingUrl(src, externalId));
    if (res.ok) {
      const d = parseJazzhrDetail(await res.text());
      text = d.description ? htmlToText(d.description).slice(0, DESC_CAP) || null : null;
      postedAt = d.postedAt;
      workMode = d.workMode;
    }
  } else if (src.source === "ukg") {
    // The detail page embeds CandidateOpportunityDetail({...}) — the full JD
    // and the structured pay the list withholds (4,794 chars on the posting
    // this was verified against, 2026-09-01).
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
    // The list payload's Description is a ~110-char teaser; the Details page
    // server-renders the full JD in its schema.org JobPosting block (read
    // live 2026-08-30: 3,264 of 3,491 chars against the 110-char stub).
    const res = await fetchWithTimeout(`https://recruiting.paylocity.com/recruiting/jobs/Details/${externalId}`);
    if (res.ok) {
      const ld = jobPostingLd(await res.text());
      text = ld.description ? htmlToText(ld.description).slice(0, DESC_CAP) || null : null;
      pay = ldBaseSalaryText(ld.pay);
    }
  } else if (src.source === "adp") {
    // The list payload carries no description at all; the per-requisition
    // detail on the same public endpoint serves the full HTML JD (measured
    // live 2026-08-31: 6,928 chars on a sampled retail posting against
    // nothing in the list row). The requisition id in the posting id is
    // exactly what the detail path takes; cid/ccId ride in the token.
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
    // The list payload carries no JD (re-verified 2026-08-24: __NEXT_DATA__
    // job-posts items hold only [department, id, language, locations, name,
    // url]) — but the official per-posting API this codebase ALREADY calls
    // for createdOn in the posted-date backfill serves the full text:
    // description.{company,role}, measured 20-30KB across 3 boards, no auth.
    // role is the JD, company is the employer blurb; role leads.
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
    // Both ship descriptions in the board payload — fetch the board, extract
    // the one posting, keep nothing else in memory. A board the byte bound
    // refuses answers null here without being asked again (see above).
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

/**
 * THE PLACE PATCH BOTH DETAIL SWEEPS WRITE — one rule, in one function, so the
 * two lanes cannot drift apart. Three columns and three different rules:
 *
 *   country      REPLACES. It is the employer's own structured field and what
 *                it replaces is our text inference over a location string —
 *                the same precedence work_mode already takes. workdayDetailPlace
 *                has already refused it where the payload contradicts itself or
 *                where another site of the same requisition is in another
 *                country.
 *   location     FILLS ONLY a stored string that names nowhere ("52 Locations",
 *                empty). Writing the vendor's display location over a real one
 *                would narrow a multi-site posting to one site the employer did
 *                not single out.
 *   region_code  MOVES WITH THE PAIR, and is REFUSED where the pair cannot
 *                support it.
 *
 * WHY REGION_CODE IS THE ONE THAT GETS REFUSED. On a multi-site requisition
 * the vendor hands us one display location out of N, and a subdivision derived
 * from it is a claim about one site written into a longitudinal series that
 * outlives the posting. Measured on the review walk of 2026-09-23: of 68
 * unplaced rows this fill would touch, 60 are multi-site; 23 of them would
 * have gained a region_code and 12 of those 23 — 52% — are contradicted by
 * another site the SAME requisition lists. The worst live case is a RELX
 * requisition stored as "52 Locations" which became location "Ohio", country
 * US, region US-OH while its own additionalLocations name fifty-one other
 * states. So when the location we are deriving from is the vendor's
 * one-of-N string, the subdivision is written as NULL: null is recoverable and
 * a wrong subdivision in a series is not. Where the stored location is kept —
 * a real place the seeker can already read — the site count says nothing about
 * it and the region is re-derived as usual, because a derived column that does
 * not move with what it is derived from is the drift this same rule exists to
 * stop.
 */
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

/**
 * A vendor date string accepted ONLY if it parses to a sane absolute date
 * inside the window we serve. Anything ambiguous is dropped rather than
 * guessed — a wrong posting date is worse than no posting date.
 */
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

/**
 * Words a person types around a job title that are not part of any job title.
 *
 * MEASURED 2026-08-20 on the live board:
 *   "electrician"                979 results, top hit a real electrician role
 *   "electrician jobs near me"    44 results, top hit "Maintenance II-ARP"
 *
 * A 95% collapse AND a wrong top result, from words that carry no information
 * about the role. Two things combine to cause it. The terms are ANDed, so each
 * extra word can only ever shrink the set — and they are matched as
 * SUBSTRINGS, so `%me%` matches "Maintenance", "Management", "Commercial".
 * Filler does not merely narrow the results, it actively poisons them with
 * whatever happens to contain those letters.
 *
 * This is the single most common way a real person phrases a job search, so
 * the board was at its worst exactly when someone typed naturally.
 *
 * WHAT IS NOT HERE, deliberately: "remote", "senior", "junior", "lead",
 * "part", "time", "contract", "intern". Every one appears in real job titles,
 * and dropping them would silently widen a search the person meant to narrow —
 * the mirror of the bug being fixed. Only words that cannot be part of a title
 * qualify.
 *
 * Dropped terms are REPORTED to the caller, never silently swallowed: the
 * board tells the visitor which words it ignored, the same way it names a
 * filter it could not honour.
 */
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


/**
 * Metro shorthand, and why a plain substring search cannot serve it.
 *
 * MEASURED on the live board 2026-08-20, typing what people actually type:
 *   "NYC"     356 hits — misses all 10,000 "New York" postings
 *   "SF"    1,427 hits — top result "Innisfil, Ontario"  (Inni-SF-il)
 *   "LA"   10,000 hits — top result "Plain City, Ohio"   (P-LA-in)
 *   "Philly"   13 hits — top result "Philly - Ontario, CA"
 *
 * Two different failures wearing one coat. The long forms are simply missing:
 * nothing connects "NYC" to "New York". The short forms are worse than
 * missing — a two-letter substring matches inside ordinary words, so "LA"
 * returns ten thousand rows of Ohio. Same root cause as the query-filler bug:
 * ILIKE %x% has no idea what a word is.
 *
 * So each alias declares whether its RAW form is safe to keep searching:
 *   keepRaw true  — the token is distinctive ("NYC", "Philly" appear in real
 *                   location strings and match little else), so search BOTH
 *                   and the visitor gets the union.
 *   keepRaw false — the token is two or three letters that occur inside
 *                   common words ("LA", "SF"), so searching it at all is
 *                   noise. The canonical name REPLACES it.
 *
 * Encoded per-alias rather than by a length rule, because the property is
 * about the specific letters, not their count: "DC" is two letters and is
 * perfectly safe, since it is how the location is actually written.
 */
/**
 * US states and Canadian provinces — and why the abbreviation needs a comma.
 *
 * MEASURED 2026-08-20, and both directions were broken:
 *   "Texas"       7,788 rows   misses the 16,234 written "TX"
 *   "California" 10,106 rows   misses most of the state
 *   "CA"        113,223 rows   of which ~70% are NOT California — it matches
 *                              "CAnada", "3 LoCAtions", "TransCAnada"
 *
 * A bare two-letter code cannot be substring-matched. Many are ordinary
 * English: %IN% matches 129,229 rows, %OR% matches 109,393. Anchoring on the
 * comma that precedes a state in real location strings fixes it exactly —
 * %, IN% is 14,071 and %, OR% is 3,265, and "CAN - Quebec" no longer matches
 * ", CA".
 *
 * So every state maps to BOTH forms: the spelled-out name and ", ST". Typing
 * either reaches the union, which is the whole point — the data uses both
 * ("Dallas, Texas" and "Austin, TX" are the same state to a job seeker).
 *
 * keepRaw is false everywhere here: the spelled-out name is already in the
 * list, and the bare code is precisely the poison being removed.
 */
/**
 * Split a query into title terms, dropping filler.
 *
 * FALLS BACK TO THE ORIGINAL when filler is all there was ("jobs near me"):
 * an empty term list would return the entire board, which reads as the search
 * box being broken. Better to run the poor query the person typed than to
 * silently ignore them.
 */
/**
 * INTENT PHRASES THAT ARE FILTERS, NOT SEARCH TEXT.
 *
 * "work from home" is the most common consumer phrasing for remote work, and it
 * MEASURED at 287 results against 43,929 postings flagged remote — 0.7% of the
 * inventory — because it was matched as literal title text. The remote filter
 * already exists, is already indexed, and is already bound by every path. The
 * phrase simply never reached it.
 *
 * Each entry rewrites a phrase into a predicate the board ALREADY SERVES. This
 * adds no scan, no column and no index: it routes an intent to a filter that
 * was there the whole time. That is also the limit of the idea — nothing is
 * added here that cannot be expressed with an existing filter.
 *
 * WORDS AS WELL AS PHRASES, and the reversal is MEASURED. This block used to
 * exclude the bare word "remote" on the theory that a searcher might mean a job
 * title ("Remote Support Technician") and that lifting it would "discard the
 * 70% of the board with no work_mode recorded". Both halves were wrong. The
 * 70% figure describes work_mode being NULL, but the lift patches a WORK-MODE
 * EQUALITY, and the ambiguity it feared is a rounding error. Counted live on
 * 2026-08-27 over the servable board (open, inside the freshness window):
 *
 *   title contains        total   of which NOT that work_mode   ambiguous
 *   remote                6,119                           168        2.7%
 *   hybrid                2,093                            41        2.0%
 *   onsite                1,790                            69        3.9%
 *   on-site                 416                            15        3.6%
 *
 * Meanwhile the AND-against-title that the exclusion preserved was discarding
 * far more than it protected. Exact title-tier counts, same day, the word left
 * in the query versus the word lifted to the filter:
 *
 *   "remote python"          3   ->  "python"        + remote    200
 *   "remote data analyst"    8   ->  "data analyst"  + remote    197
 *   "remote nurse"         162   ->  "nurse"         + remote    415
 *   "remote accountant"    238   ->  "accountant"    + remote    242
 *
 * Never fewer, and up to 66x more. The SPREAD is the argument: the literal
 * match only looks respectable for job families that habitually spell "Remote"
 * in the title, and collapses for the ones that do not — so the searcher could
 * not tell from the result count whether they had seen the market or 1.5% of
 * it. The 2-4% residue above is the price and it is worth paying.
 *
 * WHAT MAKES THAT HONEST IS THE DISCLOSURE, NOT THE ODDS. Every lift is named
 * in `intentFilters` and rendered on the page ("Read "remote" as a filter and
 * applied it, rather than searching for those words"), so a searcher who did
 * mean the title text can see what happened and say otherwise. A silent lift
 * would still be the wrong trade at 2.7%.
 *
 * workMode, NEVER THE remote BOOLEAN, for every one of these. filters.ts
 * computes `remote: body.remote === true && !workMode`, so the mode is the
 * field that wins, and it is also strictly wider: work_mode='remote' is 43,773
 * rows where remote=true is 40,325, and remote=true with work_mode NULL is
 * ZERO. Binding the boolean threw away 3,504 postings the board itself calls
 * remote. Two spellings of "remote" on two routes is the drift that makes
 * counts disagree, so there is one.
 */
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
  { re: /\bremote(?:ly)?\b/i, label: "remote", patch: { workMode: "remote" } },
  { re: /\bhybrid\b/i, label: "hybrid", patch: { workMode: "hybrid" } },
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

/**
 * Which request fields ALSO speak for a lifted patch key.
 *
 * `remote` and `workMode` are the same question asked two ways, and workMode is
 * the one that WINS — filters.ts computes `remote: body.remote === true &&
 * !workMode`. Checking only the patch's own key let the lift fire anyway:
 * q="work from home nurse" with workMode=onsite stripped the phrase from the
 * query AND had its remote:true discarded downstream, returning 2,205 rows
 * identical to q="nurse"+onsite while the payload claimed it had applied
 * "work from home". The phrase was deleted from the search and its filter
 * thrown away, and the response asserted the opposite of both.
 *
 * maxAgeDays and postedAfter are likewise one question — a caller who sent a
 * watermark has already said how fresh they want it.
 */
const INTENT_CONFLICTS: Record<string, string[]> = {
  remote: ["remote", "workMode"],
  workMode: ["remote", "workMode"],
  experience: ["experience"],
  maxAgeDays: ["maxAgeDays", "postedAfter"],
  employmentType: ["employmentType"],
};

/**
 * Lift any intent phrases out of the query and into filters.
 *
 * Returns the patch to apply, the phrases recognised (for disclosure), and the
 * query with those phrases REMOVED — leaving them in would re-impose the
 * literal-text match the rewrite exists to escape, so "work from home nurse"
 * searches for "nurse" among remote roles rather than for the whole string.
 *
 * A CALLER'S OWN FILTER ALWAYS WINS. Someone who set remote=false and typed
 * "work from home" has contradicted themselves, and the explicit control is the
 * one they can see and change.
 */
function liftIntentFilters(
  rawQ: unknown,
  body: Record<string, unknown>,
): { patch: Record<string, unknown>; labels: string[]; residualQ: string } | null {
  const q = String(rawQ ?? "");
  if (!q.trim()) return null;
  let residual = q;
  const patch: Record<string, unknown> = {};
  const labels: string[] = [];
  for (const { re, label, patch: p } of INTENT_FILTERS) {
    if (!re.test(residual)) continue;
    // Skip when the caller already spoke for this field — BY ANY OF ITS NAMES.
    // Leaving the phrase in the query is the honest outcome: the words then go
    // through queryTerms like any others and, when they do not appear in job
    // titles, come back as droppedTerms, which the page already renders.
    if (Object.keys(p).some((k) => (INTENT_CONFLICTS[k] ?? [k]).some((f) => body[f] !== undefined && body[f] !== null))) continue;
    // Rationale: docs/job-board-index-notes.md#n188-clash
    const clash = Object.keys(p).find((k) => k in patch && patch[k] !== p[k]);
    if (clash) continue;
    residual = residual.replace(re, " ");
    // A rule that only RESTATES a lift already made (q="wfh remote") still has
    // its words removed — leaving them would re-impose the literal-text match —
    // but must not be named twice in the disclosure.
    const restates = Object.keys(p).every((k) => k in patch && patch[k] === p[k]);
    Object.assign(patch, p);
    if (!restates) labels.push(label);
  }
  if (labels.length === 0) return null;
  residual = residual.replace(/\s+/g, " ").trim();
  return { patch, labels, residualQ: residual };
}

/**
 * Make a term safe to embed in a PostgREST or() filter.
 *
 * or() is parsed as a comma-separated list of dotted expressions, so a comma or
 * a parenthesis inside a value ends the branch early and the rest is read as
 * another filter — silently, producing a query nobody wrote. A location or()
 * already shipped that bug here by splitting on ", TX".
 *
 * BALANCED "…" PAIRS PASS THROUGH. They are websearch_to_tsquery's phrase
 * syntax — the one thing the search tip promises — and every caller of this
 * function binds a plain wfts() filter, never an or() branch, so PostgREST
 * reads the value verbatim and a quote cannot close anything early. Only an
 * ODD quote count is stripped, and then all of them: measured in pglite,
 * websearch_to_tsquery('simple', '"registered nurse') does NOT error — it
 * quietly reads a phrase running to the end of the query, which is a
 * different search from the one typed. (The old note here, that a half-open
 * phrase is a parse error, was wrong: it is a silent one.)
 */
function ftsSafe(t: string): string {
  if (((t.match(/"/g) ?? []).length & 1) === 1) t = t.replace(/"/g, " ");
  // Rationale: docs/job-board-index-notes.md#n189-t-t-replace-s-s-g
  t = t.replace(/(^|\s)[-&/–—]+(\s|$)/g, " ");
  return t.replace(/[(),.'\\:]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The websearch query for the simple-config tiers, with the possessive variant.
 *
 * A possessive employer is stored as TWO tokens: to_tsvector('simple',
 * "Domino's") is 'domino':1 's':2, because the parser splits on the apostrophe.
 * Someone typing the apostrophe is fine — ftsSafe turns it into a space and the
 * phrase matches. Someone typing "dominos" produces the single token 'dominos',
 * which matches neither, and gets nothing.
 *
 * MEASURED against the company index:
 *   dominos              -> 0 rows
 *   Domino's / domino s  -> 2,002 rows
 *   dominos or domino s  -> 2,002 rows, 0.22s
 * That is Domino's, McDonald's, Macy's, Kohl's, Lowe's — a whole retail class
 * failing on one apostrophe nobody types into a search box.
 *
 * The variant is free on ordinary words: "engineers or engineer s" returns the
 * same 622 rows as "engineers", because the phrase 'engineer' <-> 's' matches
 * almost nothing that the plain token does not.
 *
 * Only single tokens are rewritten. A multi-word query containing an apostrophe
 * has already been split into the matching shape by ftsSafe.
 */
function ftsQuery(raw: string): string {
  const safe = ftsSafe(raw);
  // Length floor keeps it off short plurals where the split half is noise.
  if (/^[a-z0-9]+s$/i.test(safe) && safe.length >= 5) {
    return `${safe} or ${safe.slice(0, -1)} s`;
  }
  return safe;
}

/**
 * A balanced "…" pair is ONE term: its words, in order, joined by single
 * spaces. Everything outside the pairs tokenises exactly as before, and a
 * stray unpaired quote is stripped by sanitizeTerm as it always was.
 *
 * WHY HERE AND NOT IN sanitizeTerm. The tip under the search box has promised
 * '"quotes" match exact phrases' since 2026-07-18, and since 2026-08-20 the
 * quote has been in sanitizeTerm's strip class — rightly, because a typed
 * quote inside a quoted or() value closes it early (a-state-is-not-a-substring
 * pins that). So the promise was false for six weeks: search_jobs received
 * `product designer` and websearch_to_tsquery read it as product AND designer.
 * Tokenising the pairs BEFORE the per-token sanitiser keeps both facts true:
 * the phrase survives as a multi-word term, and no quote ever reaches an ILIKE.
 *
 * Every ILIKE consumer of `terms` — the browse or(), count_jobs_capped, the
 * close-match title check — gets the phrase unquoted, and a contiguous
 * substring match on "registered nurse" already IS an adjacency match. The
 * tsquery consumers take phraseText(), which puts the quotes back so the
 * parser emits 'regist' <-> 'nurs'. A single quoted word is just a word.
 */
function queryTerms(raw: unknown): { terms: string[]; dropped: string[]; liftedSalary: boolean } {
  const all = (String(raw ?? "").toLowerCase().match(/"[^"]*"|\S+/g) ?? [])
    .map((t) => t.length >= 2 && t.startsWith('"') && t.endsWith('"')
      ? t.slice(1, -1).split(/\s+/).map(sanitizeTerm).filter(Boolean).join(" ")
      : sanitizeTerm(t))
    // A TOKEN WITH NO LETTER OR DIGIT CANNOT MATCH ANYTHING, and every term
    // here is ANDed against title/company/department — so a stray "-" or "&"
    // from a pasted job title made the whole query unsatisfiable. See ftsSafe
    // above for the measurement.
    .filter((x) => /[a-z0-9]/i.test(x));
  // The money token is lifted into the salary filter by normalizeFilters, so
  // it must not also be ANDed against every title — that returned zero for
  // "100k engineer".
  const money = salaryFromQueryText(raw) !== null
    ? String(raw ?? "").toLowerCase().split(/\s+/).find((t) => SALARY_IN_QUERY.test(t)) ?? null
    : null;
  const kept = all.filter((t) => !QUERY_FILLER.has(t) && t !== money);
  if (kept.length === 0) {
    // Rationale: docs/job-board-index-notes.md#n190-money-null-return-terms-drop
    if (money !== null) return { terms: [], dropped: all.filter((t) => QUERY_FILLER.has(t)), liftedSalary: true };
    return { terms: all, dropped: [], liftedSalary: false };
  }
  return { terms: kept, dropped: all.filter((t) => QUERY_FILLER.has(t)), liftedSalary: money !== null };
}

/**
 * The query as the tsquery parser must see it: each multi-word term back in
 * its quotes, so websearch_to_tsquery reads it as a phrase ('regist' <->
 * 'nurs' & 'chicago', verified in pglite against the live search_jobs body).
 * Single-word terms are untouched, so an unquoted query round-trips
 * byte-for-byte and nothing about it changes.
 */
function phraseText(terms: readonly string[]): string {
  return terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" ");
}

/**
 * Everything the board changed about what was asked, said out loud.
 *
 * SHARED BECAUSE IT KEPT NOT BEING. These three disclosures lived inline at the
 * recency return only, so a visitor who BROWSED was told what had been dropped,
 * expanded or lifted and a visitor who SEARCHED was told nothing — measured:
 * q="100k engineer" narrowed 10,000 results to 4,944 with no salaryFromQuery in
 * the payload, and q="engineer jobs near me" dropped three words with no
 * droppedTerms. That is the FIFTH fix in two days to land on one of the four
 * query paths and silently miss the rest. A single helper spread at every list
 * return is the only version of this that stays true.
 */
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
  // 2026-08-24, live: 1 literal match board-wide; the German nursing pool is
  // pflegefachkraft 55 + krankenpfleger|pflegekraft 13. The #1 "related" row
  // was a medical-device sales rep.
  "krankenschwester": "pflegefachkraft",
  // 2026-08-24, live: 101 exact rows, every one an EMPLOYER's typo ("Manger
  // Trainee") suppressing the fuzzy tier; the manager pool is ~100x larger.
  // A genuine manger search loses nothing — its rows render unchanged.
  "manger": "manager",
};

function searchDisclosures(
  body: Record<string, unknown>,
  applied: { salaryFloor?: number | null; postedAfter?: string | null; excludeAgencies?: boolean; hasDescription?: boolean },
  maxAgeClamped = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Words removed because they cannot be part of a job title ("jobs", "near",
  // "me"). Reported rather than silently swallowed.
  const dropped = queryTerms(body.q).dropped;
  if (dropped.length) out.droppedTerms = dropped;
  // Pay lifted out of the search box into the filter. Read off the DERIVED
  // filter, never the raw body — normalizeFilters is the only place that reads
  // it, and an explicit slider beats a typed figure, so the two can differ.
  const fromQuery = salaryFromQueryText(body.q);
  if (fromQuery !== null && applied.salaryFloor === fromQuery) out.salaryFromQuery = fromQuery;
  // We guessed on the visitor's behalf: someone who typed "SF" and gets San
  // Francisco results should know why, and someone who meant somewhere else
  // needs to see that we substituted.
  const l = locationTerms(body.location);
  if (l.expandedFrom) { out.locationExpandedFrom = l.expandedFrom; out.locationSearched = l.terms; }
  // The board looked at a narrower window than it was asked for. Silent
  // narrowing reads as "there is nothing older", which is a different claim
  // from "we only keep 30 days".
  if (maxAgeClamped) out.maxAgeClampedTo = 30;
  // "Posted after X" now means the EMPLOYER posted after X, so postings with no
  // stated date are outside the window rather than treated as brand new. Said
  // out loud because it changes what the filter returns: the same 24-hour
  // question was 467 rows on crawl time and 90 on the company date.
  if (applied.postedAfter) out.postedAfterUsesStatedDate = true;
  // The agency opt-out, named back like every other row-selecting choice: a
  // filter the page cannot show is one the reader cannot take off, and a
  // total that quietly omits the disclosed-agency inventory reads as "the
  // market has no such openings" — the postedAfter lesson with a charter
  // attached. Read off the DERIVED filter, so a refused non-boolean (named
  // in ignoredFilters) never claims here to have applied.
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

/**
 * The board turned words the visitor typed into filters. It has to say so, for
 * the same reason it names a dropped word or an expanded location: someone who
 * meant "work from home" as a job title needs to see that it became a filter,
 * and be able to take it off.
 */
function intentDisclosure(r: { labels: string[] } | null): Record<string, unknown> {
  return r && r.labels.length ? { intentFilters: r.labels } : {};
}

/** Terms the searcher asked NOT to see, named on the response so the page can
 *  say what it removed — a filter the visitor cannot see is one they cannot
 *  undo, which is the same rule intentFilters follows. */
function exclusionDisclosure(excluded: readonly string[]): Record<string, unknown> {
  return excluded.length ? { excludedTerms: [...excluded] } : {};
}

/**
 * NO COUNT SURVIVES AN EXCLUSION, because none of them ever saw one.
 *
 * splitExclusions strips "-travel" / "not manager" from q BEFORE any SQL, and
 * the excluded titles are pruned per page in attachRecheckedAt AFTER every
 * tier has computed its total, its floor and its related count. So every
 * number those tiers publish counts rows the pages will then hide —
 * "engineer -senior" advertised every Senior Engineer it would never show,
 * and each page quietly ran short of its own header. Until the predicate
 * reaches SQL, the honest total under an exclusion is "we don't know":
 * countUnavailable already has a rendering contract ("Showing N matching
 * openings"), and the excludedTerms chip says why.
 *
 * Spread AFTER the exit's own total/countUnavailable/totalAtLeast fields so it
 * wins; `undefined` values serialize to absent keys. Every list exit that
 * spreads exclusionDisclosure must spread this too — the battery greps for the
 * pairing.
 */
function exclusionCountsCaveat(excluded: readonly string[]): Record<string, unknown> {
  return excluded.length
    ? { total: null, countUnavailable: true, totalAtLeast: undefined, relatedTotal: undefined }
    : {};
}

/**
 * THE ONE FIGURE AN EXCLUSION LEAVES STANDING, under a name that cannot lie.
 *
 * MEASURED 2026-08-31 (battery): q="engineer not manager" served a full page
 * with no number anywhere on it — the caveat above rightly withdrew `total`,
 * but the positive query's count had been COMPUTED and was then thrown away.
 * Removing rows can only shrink a set, so that count is a true CEILING of the
 * post-exclusion matches; what it must never be is the total, which is exactly
 * the field the caveat withdraws. Named for what it counts, the client can say
 * "of up to N before exclusions" instead of saying nothing.
 *
 * Spread AFTER exclusionCountsCaveat at the exits that have an honest ceiling
 * to offer — it adds a labelled bound beside the withdrawal, never in place of
 * it. Exits whose figure is a window size or an already-disproven count pass
 * null and publish nothing, same rule as everywhere else in this file: a
 * number we cannot stand behind is a number we do not print.
 */
function exclusionCeiling(excluded: readonly string[], ceiling: number | null): Record<string, unknown> {
  return excluded.length && typeof ceiling === "number" && Number.isFinite(ceiling) && ceiling >= 0
    ? { totalBeforeExclusions: ceiling }
    : {};
}

/**
 * Coverage for filters whose column the refresh pass does NOT count.
 *
 * FRACTIONS, NOT PERCENTAGES. The cached figures are frac() = n/open rounded to
 * three decimals, and Jobs.tsx renders them with Math.round(x * 100). A 10.6
 * written here would reach the screen as "pay basis stated on 1,060% of
 * postings" — the unit is the whole contract, so these are 0.106, never 10.6.
 *
 * MEASURED 2026-08-25 against the 559,805 rows the board can serve (open,
 * inside the freshness window — the same population the cached figures use):
 *
 *   salary_period      59,505  10.6%   hour 41,542 | year 17,312 | month 627
 *   salary_min_annual 112,524  20.1%
 *   min_years         162,032  28.9%
 *   department        226,631  40.5%
 *   source            559,805  100%
 *
 * hasStatedPay NO LONGER COUNTS salary_min_annual, so its constant was
 * RE-MEASURED rather than carried over. The filter binds the verbatim pay text
 * now (see the predicate's own note in buildQuery), and the honest fraction for
 * it is the widest of the three pay columns: 206,996 of 732,018 servable rows,
 * 28.3%, from the hourly per-field scan stamped 2026-09-27T01:07:00Z — the same
 * serving population every figure above uses (present on the feed, inside the
 * freshness window). The old 0.201 is left in the table above as the 2026-08-25
 * reading OF A DIFFERENT COLUMN, because a constant that silently changes which
 * column it describes is how a number stays plausible while going wrong.
 *
 * Constants rather than live counts because each one is a full count over a
 * partly-populated column, and the pass that could take them cheaply already
 * takes four and is the pass that once bound its results to the wrong names.
 * The DATE is part of the number: these are a snapshot, and a snapshot with no
 * date is what turns a measurement into a claim.
 */
const MEASURED_COVERAGE = {
  payBasis: 0.106,
  // The verbatim pay field, 2026-09-27 — NOT the 0.201 annualised reading above.
  hasStatedPay: 0.283,
  maxYears: 0.289,
  department: 0.405,
  vendor: 1,
} as const;

/**
 * How much of the board each ACTIVE filter can even see.
 *
 * Emitted only for filters the caller actually set — coverage for a filter
 * nobody applied is noise. NOTHING is emitted when the cache has no coverage
 * block — not the cached figures and not the measured constants above —
 * because showing an invented fraction would be worse than showing none: a
 * number on screen gets believed, and a page that publishes five pinned
 * constants while four live figures are missing is claiming a measurement it
 * did not take.
 *
 * MEASURED ON 2026-08-27 against 599,316 open postings: salary stated on 12.9%,
 * work mode on 29.9%, experience on 40.4%. A searcher who sets a salary floor is
 * seeing an eighth of the market and currently has no way to know it.
 *
 * AND THAT 29.9% IS ABOUT TO MOVE TOO, for the same reason the pay figure did
 * and with the same remedy: date it rather than quietly carry it. The bundle this
 * paragraph ships in reads UKG's own JobLocationType, which is expected to take
 * roughly 15,000-20,000 of that vendor's 33,617 no-mode rows to a stated one as
 * the rotation laps — around +2 points board-wide against ~734,000 servable rows.
 * MEASURED_COVERAGE does not pin workMode, so no SERVED percentage is affected;
 * these two sentences are prose a reader takes on trust, which is exactly why
 * they name their date. Re-measure the work-mode share from the facet once the
 * fill has lapped, never from a capped list total.
 *
 * THAT 12.9% IS A 2026-08-27 READING AND THE FLOOR'S REACH HAS SINCE MOVED, so
 * do not reuse it: on one scan over 733,190 servable rows at
 * 2026-09-27T02:07:00Z, 173,826 carry a figure a floor can compare (23.71%),
 * 173,868 carry an annualised figure at all (23.72% — the two are 42 rows apart,
 * so the unconvertible-currency slice is now tiny) and 207,108 carry pay text
 * the employer published (28.25%). "An eighth of the market" was true of the
 * older reading and is about a quarter today. The live figures are what this
 * function publishes; these lines are history with dates on them, which is the
 * only form a superseded measurement may survive in.
 */
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
  // The ceiling compares against salary_rank_usd, the column the floor uses, so
  // its coverage IS the floor's — read live rather than pinned as a sixth
  // constant. Two constants for one column is how a number goes stale on one of
  // its two readers.
  if (applied.salaryCeiling != null && typeof cov.salaryFloor === "number") out.salaryCeiling = cov.salaryFloor;
  // THE LEGACY remote=1 IS A WORK-MODE FILTER TOO. It binds `remote = true`,
  // which is NULL-false for every posting that states no mode — the same
  // rows the mode filter hides — so an old saved search or a digest link
  // narrowed the board to the stated-mode slice and got no coverage sentence
  // for it. Same column, same figure, same disclosure.
  if ((applied.workMode != null || applied.remote === true) && typeof cov.workMode === "number") out.workMode = cov.workMode;
  if (applied.experience?.length && typeof cov.experience === "number") out.experience = cov.experience;
  // Rationale: docs/job-board-index-notes.md#n197-applied-country-typeof-cov-country
  if (applied.country && typeof cov.country === "number") out.country = cov.country;
  // THE BASIS DATE RIDES WITH THE FIGURES OR THEY DO NOT GO OUT. Same reply, so
  // a stamp cannot be paired with another pass's numbers by a caller — and the
  // client withholds every percentage when this key is absent, which is how an
  // older deployed bundle degrades to silence rather than to an undated claim
  // (this project's >4.5MB deploy serves the previous version while reporting
  // success), and how the pinned-fallback pass above degrades too.
  if (!Object.keys(out).length) return {};
  return pinnedUsed ? { filterCoverage: out } : { filterCoverage: out, filterCoverageAt: covAt };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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
    // Bounded like every other body this function reads. The inbound request
    // is the one allocation a caller controls directly, so it gets the same
    // treatment as a vendor feed rather than an exemption.
    body = await boundBody(req, MAX_REQUEST_BYTES).json();
  } catch (e) {
    // TOO BIG IS NOT MALFORMED. Answering 400 "Invalid JSON" to a well-formed
    // 3MB body tells the caller to go looking at their serializer, and nothing
    // anywhere records that a size limit was the reason.
    if (String((e as Error)?.message ?? e).includes(OVERSIZE_MARKER)) {
      return json({ error: `Request body too large (limit ${MAX_REQUEST_BYTES} bytes)` }, 413);
    }
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "list");
  const client = db();

  try {
    if (action === "searchQuality") {
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
      // Same stampede lock as the refresh slice: the cron fires hourly, so a
      // second invocation inside 5 minutes is an overlap, not a schedule.
      const lockAge = state.data?.updated_at ? Date.now() - new Date(state.data.updated_at).getTime() : Infinity;
      if (lockAge < 5 * 60_000) return json({ skipped: "a sweep ran moments ago" });
      // Stamp ARRIVAL before probing, not only completion. Overnight
      // 2026-08-23→24 the cursor advanced once in ten-plus cron ticks and
      // there was no way to tell arrivals-that-died from ticks-that-never-
      // fired. The arrival stamp also moves the stampede lock to entry time,
      // where a lock belongs.
      const svArrive = { ...(state.data?.v as Record<string, unknown> ?? {}), lastArrivedAt: new Date().toISOString() };
      await client.from("job_board_meta").upsert(
        { k: "host_sweep", v: svArrive, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
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
            // Any response is life — a 403, a 429, a rejected HEAD are all
            // responses. Only a thrown error (DNS, TLS, timeout) counts.
            // Deliberately NOT fetchWithTimeout: its 20s budget and 429 retry
            // are feed-fetch behavior; a liveness probe wants 6s and no retry.
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
        // Publish the dated figure the way freshness already is: sample size,
        // basis and timestamp — never a bare number (stat-provenance rule).
        // Two consecutive failures is the bar: one can be a blip; two, a full
        // sweep cycle apart (hours), is a host that is down.
        const inCensus = new Set(list.map((l) => l.host));
        for (const h of Object.keys(hosts)) if (!inCensus.has(h)) delete hosts[h]; // census churn, not death
        const failing = Object.entries(hosts).filter(([, v]) => v.fails >= 2);
        const postingsOnFailing = failing.reduce((n, [, v]) => n + (v.postings || 0), 0);
        // The rollup row is WORLD-READABLE (published stats). Aggregates only:
        // naming the failing hosts there would publish the reconnaissance
        // surface the census RPC was revoked from anon to protect. Host-level
        // detail stays in job_board_meta (service-role-only since 2026-07-22)
        // and in the function log below.
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
      // An unchecked persist is a tick that silently never happened: the
      // response reports the COMPUTED cursor either way, so a failed upsert
      // here is indistinguishable from success to every caller. Check it,
      // log it, and say so in the response.
      const { error: persistErr } = await client.from("job_board_meta").upsert(
        { k: "host_sweep", v: { cursor: wrapped ? 0 : cursor, hosts, list: wrapped ? [] : list, cycleAt: wrapped ? new Date().toISOString() : sv.cycleAt ?? null, lastArrivedAt: svArrive.lastArrivedAt, lastTick: { at: new Date().toISOString(), swept: slice.length, wrapped } }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      if (persistErr) console.log(`[JOB-BOARD] host sweep persist FAILED: ${persistErr.message}`);
      return json({ swept: slice.length, cursor: wrapped ? 0 : cursor, of: list.length, wrapped, persisted: !persistErr });
    }

    if (action === "status") {
      // Rationale: docs/job-board-index-notes.md#n202-try
      try {
      // Deploy + health introspection. Read-only, zero-cost (meta rows only — no
      // feed fetches, no AI). BUILD_VERSION and catalogSize come from the DEPLOYED
      // bundle, so a stale/failed publish is visible in ONE call instead of being
      // inferred from posting counts over hours (the rung-2 "did it deploy?" pain).
      // Also the source of truth for the heartbeat's job_board_deploy check.
      const [prog, pbMeta, rot, refreshMeta, bf, hotMeta, fresh, breaker, dateCov, boardFlow, ingestPaused, dcCache, bsMeta, dsMeta, ssMeta, esMeta, fiOk, fiBad, faMeta, aaMeta, arMeta, rsRun, rsCron, hsMeta, rcProg, rcVer, hwMeta, deepCur, chainKick, sliceStatsRow, descCov, traceRow, overMeta, closurePop, oracleRepair, staleMeta, freshRow] = await Promise.all([
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "posted_backfill").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "cold_rotation").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "hot_tokens").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n203-withdeadline-client-rpc-get-freshness-stats
        withDeadline(client.rpc("get_freshness_stats"), 2_500),
        client.from("job_board_meta").select("v").eq("k", "vendor_breaker").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n204-withdeadline-client-rpc-get-date-coverage-2
        withDeadline(client.rpc("get_date_coverage"), 2_500),
        // Rationale: docs/job-board-index-notes.md#n205-client-from-job-board-meta-select-v-updated
        client.from("job_board_meta").select("v, updated_at").eq("k", "board_flow_cache").maybeSingle(),
        // A pause nobody can see is its own outage: without this, "the ingest
        // is off" and "the ingest is broken" look identical from status, and
        // stale data gets diagnosed for hours before anyone checks the flag.
        client.from("job_board_meta").select("v, updated_at").eq("k", "ingest_paused").maybeSingle(),
        // Last good coverage, so a timeout serves stale numbers with their age
        // attached instead of nothing at all.
        client.from("job_board_meta").select("v, updated_at").eq("k", "date_coverage_cache").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "bootstrap").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "desc_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "structured_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "embed_sweep").maybeSingle(),
              // The filter self-check's two halves. BOTH are read, because reading
        // only incidents makes silence ambiguous: "no violations" and "the check
        // stopped running" would be indistinguishable, and this board has
        // already shipped one diagnostic whose delivery depended on the very
        // thing it was diagnosing. `okAgeMin` is the proof of life.
        client.from("job_board_meta").select("v, updated_at").eq("k", "filter_integrity_ok").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "filter_integrity_incident").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "filter_audit").maybeSingle(),
        // Has the apply agent ever actually run, and was it the SCHEDULE that
        // ran it? See the applyAgent block in the response for why that second
        // half is the whole question.
        client.from("job_board_meta").select("v, updated_at").eq("k", "apply_agent_run").maybeSingle(),
        // And the same question for the RUNNER, which is now gated: its cron is
        // the only caller holding a key, so a silent schedule failure would
        // otherwise look exactly like a quiet night with no queued picks.
        client.from("job_board_meta").select("v, updated_at").eq("k", "agent_runner_run").maybeSingle(),
        // And the same question for the one job where the answer is money: the
        // Stripe reconciliation sweep. Two rows because they answer different
        // questions and only one of them is trustworthy about the schedule —
        // see the paymentReconcile block below.
        client.from("job_board_meta").select("v, updated_at").eq("k", "reconcile_stripe_run").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "reconcile_stripe_cron").maybeSingle(),
        // The two maintenance chains that stalled invisibly overnight
        // 2026-08-23→24: the recategorize sweep died at a cursor wall and the
        // host sweep lost nine of ten cron ticks, and BOTH could only be
        // diagnosed by inference from posting counts. A chain whose liveness
        // is not in status is a chain whose death is a research project.
        client.from("job_board_meta").select("v, updated_at").eq("k", "host_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "recategorize_progress").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "category_rules_version").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n206-client-from-job-board-meta-select-v-eq-k
        client.from("job_board_meta").select("v").eq("k", "catalog_highwater").maybeSingle(),
        // APPENDED AT THE END ON PURPOSE. This array is positionally destructured
        // into 28 names; a query added in the MIDDLE silently shifts every
        // variable after it onto the wrong result. It did exactly that here, and
        // the typechecker only caught it by luck on an unrelated field. A new
        // read goes last, next to the name it feeds.
        client.from("job_board_meta").select("v, updated_at").eq("k", "deep_cursor").maybeSingle(),
        // APPENDED AT THE END, like the one above it and for the same reason:
        // this array is positionally destructured, so a read inserted in the
        // middle silently shifts every variable after it onto the wrong result.
        client.from("job_board_meta").select("v, updated_at").eq("k", "chain_kick").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "slice_stats").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n207-client-from-job-board-stats-rollup-select-v
        client.from("job_board_stats_rollup").select("v, computed_at").eq("k", "desc_coverage").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "slice_trace").maybeSingle(),
        // Boards the byte budget defers. On a light-capable vendor that is one
        // pass; on the fifteen with no light form it is every pass until the
        // vendor grows pagination here, and this is the only place an operator
        // can see it — the board never enters failedSources, board_failures or
        // job_board_board_state, by design (it did not fail).
        client.from("job_board_meta").select("v, updated_at").eq("k", "oversize_boards").maybeSingle(),
        // Rationale: docs/job-board-index-notes.md#n208-client-rpc-get-closure-population-maybesingle
        client.rpc("get_closure_population").maybeSingle(),
        // APPENDED AT THE END, same rule: the Oracle sub-site repair's own
        // progress row (migration 20260909216000), so the sweep can be
        // verified from outside without a service key.
        client.from("job_board_meta").select("v, updated_at").eq("k", "oracle_subsite_repair").maybeSingle(),
        // APPENDED AT THE END, same rule. The stale lane's last run: verdict
        // counts by class, what it fetched, what stamped, and the tries map
        // it is carrying — the two classes no fetch can fix (prototype_name,
        // unresolved) named here so nobody has to grep a log for them.
        client.from("job_board_meta").select("v, updated_at").eq("k", "stale_lane").maybeSingle(),
        // The 'freshness' rollup ROW, beside the RPC that projects four keys
        // from it: migration 20260909221000 added dark_boards / dark_max_min
        // (stamps whose token holds rows but none live) and the row is the
        // only place they exist — get_freshness_stats keeps its signature.
        client.from("job_board_stats_rollup").select("v, computed_at").eq("k", "freshness").maybeSingle(),
      ]);
      const pgV = (prog.data?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[]; failedTotal?: number };
      const rotV = (rot.data?.v ?? {}) as { completedAt?: string; coldBoards?: number };
      const rfV = (refreshMeta.data?.v ?? {}) as { total?: number };
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
      // Undated rows on the vendors the posted-date sweep can fix, and the
      // floor it last left behind. `due` below is computed WITH this, so the
      // status endpoint answers "is the sweep behind, and will it re-arm" in
      // one place instead of leaving it to be inferred from two percentages.
      const pbBacklogNow = await undatedBacklog(client);
      // Rationale: docs/job-board-index-notes.md#n210-chainwatchdog
      const chainWatchdog = await maybeRekickDeadChain(client);
      return json({
        statusDegraded: false,
        // deployed build identity (constants baked into THIS bundle)
        version: BUILD_VERSION,
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
                // Whether a wake is configured at all. Without it the Actions
                // cron is the only path to a sender, which is a ~6h worst case
                // when the other host is asleep — and wakeSender never even
                // reads the secret unless work is already waiting, so this was
                // unobservable until it was too late to matter.
                wakeConfig: v.wakeConfig ?? null,
                mandates: v.mandates ?? null,
                prepared: v.prepared ?? null,
                released: v.released ?? null,
                // The verdict, so nobody has to re-derive the rule above. Two
                // hours of slack on an hourly job absorbs one missed tick
                // without crying wolf.
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
            // Whether the owner alert actually went out. null = nothing to send.
            // false = orphans were found and the email did NOT leave — the worst
            // state this system can be in, and previously a console.error.
            alerted: run.alerted ?? null,
            // Daily at 15:17 UTC, so 25h means one missed run shows up rather
            // than being absorbed. Deliberately tighter in spirit than the
            // hourly job's two-hour slack: this one guards money, and a day of
            // unrecovered payments is worth a false alarm.
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
        // Per-posting description sweep: which vendor it's on, and how long
        // since it last moved. Lets a deploy be verified without waiting a day
        // for coverage numbers to shift.
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
            // Did the fast lane actually run last cold slice, and how many
            // boards did it put in? maxOffset stuck at 500 with a lane that
            // selected nothing is a different bug from one that selected 25.
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
                // The earliest board-level observability boundary. Any closure
                // cohort whose window spans this date measures a population
                // that changed mid-window, and the closures the first laps
                // wrote carry a knowingly-late closed_at (absence_basis
                // 'lap_backfill'). It is the date to exclude around, not a
                // health number.
                if (typeof rec.w0 === "string" && (!first || rec.w0 < first)) first = rec.w0;
              }
              return { tracking: recs.length, proven, disarmed, lastProvenAt: last, firstLapAt: first };
            })(),
          };
        })(),
        // See the RPC's own COMMENT: buckets (3), (4) and (5) are the boards
        // whose silence is NOT evidence about the employer, and any number on
        // this board derived from job_board_closures describes (1)+(2) only.
        // `closuresLapBackfill` is the first laps' thirty-day backlog, whose
        // closed_at is knowingly late — a count of events, never a duration.
        closurePopulation: (closurePop.error ? null : (closurePop.data ?? null)),
        // The Oracle sub-site repair (migration 20260909216000): phase,
        // counts and the duplicates it still finds, written by the function
        // itself each run. null until the migration applies; `phase: "done"`
        // with `duplicates_remaining: 0` is the sweep's completion receipt.
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
        // Embedding sweep liveness — same shape as descSweep. Added 2026-07-25
        // when the corpus fill had NO anon-visible progress signal (the meta
        // row and the embeddings table are both RLS-hidden), so "is it
        // filling?" needed dashboard SQL. A fresh ageMin = chain alive.
        embedSweep: {
          doneAt: ((esMeta.data?.v ?? {}) as { doneAt?: string }).doneAt ?? null,
          note: ((esMeta.data?.v ?? {}) as { note?: string }).note ?? null,
          ageMin: esMeta.data?.updated_at ? Math.round((Date.now() - new Date(esMeta.data.updated_at).getTime()) / 60000) : null,
        },
        // Rationale: docs/job-board-index-notes.md#n219-filtercontract
        filterContract: (() => {
          const okAt = fiOk.data?.updated_at ? new Date(fiOk.data.updated_at).getTime() : null;
          const badAt = fiBad.data?.updated_at ? new Date(fiBad.data.updated_at).getTime() : null;
          const bad = (fiBad.data?.v ?? {}) as { at?: string; violations?: number; fields?: string[] };
          return {
            // Minutes since a page was checked and found clean. Sampled ~2% of
            // requests, so on a live board this stays small; a large or null
            // value means the check is NOT running, which is not the same as
            // "no problems found".
            okAgeMin: okAt === null ? null : Math.round((Date.now() - okAt) / 60000),
            lastIncidentAt: bad.at ?? null,
            lastIncidentAgeMin: badAt === null ? null : Math.round((Date.now() - badAt) / 60000),
            lastIncidentFields: bad.fields ?? null,
            lastIncidentViolations: bad.violations ?? null,
            // An incident row is a tombstone, not a live state — it persists
            // after the fault is fixed. Age is what tells you which.
            note: okAt === null
              ? "self-check has never recorded a clean page — treat as unverified, not as healthy"
              : null,
          };
        })(),
        filterAudit: (() => {
          const v = (faMeta.data?.v ?? {}) as { at?: string; clean?: boolean; cases?: number; findings?: unknown[]; p95Ms?: number | null; slowCases?: number; throttledCases?: number };
          return {
            at: v.at ?? null,
            ageMin: faMeta.data?.updated_at ? Math.round((Date.now() - new Date(faMeta.data.updated_at).getTime()) / 60000) : null,
            clean: v.clean ?? null,
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
            // Undated rows on bamboohr/rippling/greenhouse right now, the
            // residue the last completed sweep could not date, and the growth
            // between them — which is what actually arms the sweep early.
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
          // POPULATION SINCE 20260909221000: stamps whose token holds at least
          // one LIVE posting row. Stamps whose token holds rows but none live
          // are the dark bucket, counted separately with their own max, so
          // the excluded population is a number on this page and not a
          // silence. Absent on a rollup row written before that migration.
          const v = (freshRow.data?.v ?? {}) as { dark_boards?: unknown; dark_max_min?: unknown; population?: unknown };
          return {
            ...row,
            ...(v.dark_boards !== undefined
              ? { dark_boards: Number(v.dark_boards) || 0, dark_max_min: v.dark_max_min ?? null, population: typeof v.population === "string" ? v.population : null }
              : {}),
          };
        })(),
        // THE STALE LANE, VISIBLE. `classes` says why the oldest stamps are
        // old — prototype_name and unresolved are the two no fetch can fix —
        // `fetched`/`resolved` say what the last cold hop did about the rest,
        // and `triesPending` is how many boards it is still spending fetches
        // on. rpc != "ok" is the deploy window (migration 20260909218000 not
        // yet applied) or a slow read; either way the hop was untouched.
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
            // Tokens sent as p_exclude on that hop (.71): 0 means the RPC
            // predated the arm and the lane fell back to the unexcluded ask.
            // Absent on a pre-.71 row.
            excluded: typeof v.excluded === "number" ? v.excluded : null,
            classes: v.classes ?? null,
            selected: Array.isArray(v.selected) ? v.selected : [],
            fetched: Number(v.fetched) || 0,
            resolved: Number(v.resolved) || 0,
            unresolved: Array.isArray(v.unresolved) ? v.unresolved : [],
            prototypeNames: Array.isArray(v.prototypeNames) ? v.prototypeNames : [],
            // Since .71 the tokens at STALE_TRIES_MAX are sent as p_exclude and
            // never occupy a window row, so `unresolved` above reads [] once the
            // exclusion works. This is the list it hides, read from the tries
            // the fold wrote: the boards a human should look at. An entry leaves
            // on the slice that stamps its board, whichever lane stamps it.
            excludedUnresolved: unresolvedTokens(readStaleTries(v)),
            triesPending: tries,
            lastSlice: ss.staleTries !== undefined ? { tries: ss.staleTries, resolved: ss.staleResolved ?? null } : null,
          };
        })(),
        // The watchdog's verdict for THIS call (decision, workAgeMs against
        // thresholdMs, the chainKick outcome it judged) and the last kick it
        // actually sent, so "did it fire" and "why not" are both one read.
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
        // Is the ingest deliberately stopped? Without this, "paused" and
        // "broken" are indistinguishable from status, and stale data gets
        // diagnosed for hours before anyone thinks to check a meta row.
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
        // Boards past MAX_RESPONSE_BYTES: named, sized and dated, largest
        // first. A deferral is not a failure, so nothing else on this page
        // would ever mention them.
        oversizeBoards: (() => {
          const rec = ((overMeta as { data?: { v?: { boards?: Record<string, { source?: string; mb?: number; at?: string }> } } } | null)?.data?.v?.boards) ?? {};
          return Object.entries(rec)
            .map(([token, e]) => ({ token, source: String(e?.source ?? ""), mb: Number(e?.mb) || 0, at: String(e?.at ?? "") }))
            .sort((a, b) => b.mb - a.mb)
            .slice(0, 50);
        })(),
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
          // Serve the last good copy rather than nothing. Its age is reported
          // above, so a reader can decide whether stale is good enough — which
          // is a judgement they can only make if they are told.
          : ((dcCache.data?.v as unknown[] | undefined) ?? null),
        at: new Date().toISOString(),
      });
      } catch (statusErr) {
        // The skeleton always answers, because "which bundle is deployed?" is
        // a constant in this file and needs no database. Reported at 200 with
        // the reason attached: a 500 here tells a caller nothing except that
        // something broke in the place built to explain what broke.
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
      // Schema-drift canary: probe stable reference boards per vendor through the
      // real fetch+normalize path and compare raw feed items to normalized
      // postings. Raw present but normalized zero ⇒ that vendor changed its API
      // and is silently draining off the board. Result cached 30 min so the
      // heartbeat (every ~10 min) doesn't re-probe vendor APIs each run; force
      // bypasses the cache for manual checks.
      const TTL_MS = 30 * 60_000;
      const { data: cached } = await client.from("job_board_meta").select("v, updated_at").eq("k", "vendor_health").maybeSingle();
      if (cached && body.force !== true && Date.now() - new Date(cached.updated_at).getTime() < TTL_MS) {
        return json({ ...(cached.v as Record<string, unknown>), cached: true });
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
          // caller:'maintenance' — these ~31 daily self-calls are the audit
          // checking the board's own filters, not people looking for work, and
          // they used to land in job_board_search_events indistinguishable from
          // real demand. (The service-role Authorization below would label them
          // anyway; saying it explicitly means the attribution does not depend
          // on which credential this probe happens to use.)
          const body = JSON.stringify({ action: "list", limit: 60, groupSimilar: false, caller: "maintenance", ...payload });
          const send = () => fetch(self, {
            method: "POST",
            headers: { "content-type": "application/json", apikey: svc, Authorization: `Bearer ${svc}` },
            body,
          });
          let res = await send();
          if (res.status === 429) {
            const ra = Number(res.headers.get("retry-after"));
            await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2_000, 5_000)));
            res = await send();
          }
          const j = await boundBody(res, SELF_RESPONSE_BYTES).json().catch(() => ({}));
          return { ok: res.ok, throttled: res.status === 429, ms: Date.now() - started, body: j as Record<string, unknown> };
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
        // The agency opt-out. No col/val recall pair (exactCount compares
        // string equality and this column is boolean); precision is the check
        // that matters — a tagged row leaking under the opt-out is the
        // violation filterViolations now names.
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
      // Relevance corpus. Asserted as PROPERTIES, never as literal substrings:
      // `swe` legitimately returns "Software Engineer" through alias expansion,
      // and scoring that by looking for the token "swe" in the title graded a
      // working feature 0/10 during the manual audit. `minTotal` is a floor a
      // healthy catalogue clears, not an exact figure that would go stale.
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

      // BOUNDED PARALLELISM, not a nicety. Sequentially this issues ~40 HTTP
      // probes at the 2-5s each measured on this board — 80-200s, past the
      // wall clock, so the audit would die before writing its result and the
      // status row would sit stale while looking merely "not run yet". Four at
      // a time brings it to roughly 25-35s while keeping the synthetic load on
      // the board it is watching modest.
      const inBatches = async <T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
        const out: R[] = [];
        for (let i = 0; i < items.length; i += size) {
          out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
          // Pace between batches: the 4-wide unpaced burst is what the gateway
          // was throttling. ~500ms x ~18 batches adds ~9s of wall to a
          // maintenance action; a red-every-day audit cost more.
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

      // PAGINATION INTEGRITY — the interleave regression duplicated rows onto
      // page 2 and dropped others forever, and no unit test could see it because
      // it only exists across two requests.
      // Offsets within one shape must stay ordered; the three shapes are
      // independent, so they walk concurrently.
      await Promise.all([{}, { category: "design" }, { q: "nurse" }].map(async (shape) => {
        const seen: string[] = [];
        const label = Object.keys(shape).length ? JSON.stringify(shape) : "no-filter";
        for (let off = 0; off < 240; off += 60) {
          const r = await probe({ ...shape, offset: off });
          // Fail LOUD, not open. Without this an outage reads as a clean walk:
          // every request errors, jobs is [], the loop breaks at offset 0, the
          // duplicate check trivially passes and the audit writes clean:true —
          // a green light during exactly the failure it exists to catch.
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
      }));

      const slow = timings.filter((t) => t.ms > 15_000);
      const payload = {
        at: new Date().toISOString(),
        version: BUILD_VERSION,
        cases: FILTER_CASES.length + IGNORE_CASES.length + QUERY_CASES.length + 3,
        findings,
        clean: findings.length === 0,
        // Distinct from a defect count: probes the gateway refused even after
        // the paced retry. clean stays false (the audit did not finish), but
        // "could not measure" and "measured broken" are different alarms.
        throttledCases: findings.filter((f) => f.kind === "throttled").length,
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
      // Maintenance sweep, self-invoked at pass end (chainKey-gated like
      // force-refresh). Re-runs the CURRENT rules over stored "other" rows
      // — the only bucket new rules can rescue — updating rows whose
      // category changes. Pages by id cursor; self-chains past the budget.
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
      // One-time sweep populating experience_band on rows that predate the column
      // (experience_band IS NULL). chainKey-gated + self-chaining like
      // recategorize; stamps experience_version when the NULL tail is exhausted.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-experience is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      let scanned = 0;
      const groups = new Map<string, string[]>(); // "band|minYears" -> ids
      const PAGES = 6;
      for (let page = 0; page < PAGES; page++) {
        let q = client
          .from("job_board_postings")
          .select("id,title,description")
          .is("experience_band", null)
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const exp = detectExperience(
            (r as { title?: string }).title ?? "",
            (r as { description?: string | null }).description ?? null,
          );
          const key = `${exp.band ?? "unspecified"}|${exp.minYears ?? ""}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r.id as string);
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
      if (cursor) {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill-experience", chainKey: key, cursor }),
        })).then((r) => discardBody(r)).catch(() => {}));
        return json({ ok: true, scanned, updated, nextCursor: cursor });
      }
      await client.from("job_board_meta").upsert(
        { k: "experience_version", v: { version: EXPERIENCE_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] experience backfill complete: ${scanned} scanned, ${updated} filled (v${EXPERIENCE_VERSION})`);
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
      // Workday hops fetch up to WORKDAY_PAGE_CAP list pages per board — keep
      // the per-hop board count low so a hop stays inside the compute budget.
      // BambooHR/Rippling date via ONE detail call PER POSTING (their list
      // feeds are dateless, but /careers/{id}/detail states datePosted and
      // /jobs/{uuid} states createdOn — both official, both company-stated),
      // so those hops budget by posting count, not board count.
      const perPosting = phase === "bamboohr" || phase === "rippling";
      const BOARDS_PER_HOP = 40; // workday (the 8-board case) is retired
      const IDS_PER_HOP = 120;
      // Rationale: docs/job-board-index-notes.md#n229-cursor
      let cursor = typeof body.cursor === "string" && body.cursor.startsWith(`${phase}:`) ? body.cursor : `${phase}:`;
      // Resume state, stamped EVERY hop. Without it a died chain restarted the
      // whole phase sequence from scratch on the next maintenance kick, and the
      // long phases never finished. `at` doubles as the liveness signal the
      // kick uses to avoid spawning a second concurrent chain.
      const { data: pbPrev } = await client.from("job_board_meta").select("v").eq("k", "posted_backfill").maybeSingle();
      const pbDone = (pbPrev?.v as { version?: number } | null)?.version;
      await client.from("job_board_meta").upsert(
        { k: "posted_backfill", v: { ...(typeof pbDone === "number" ? { version: pbDone } : {}), resumeVersion: POSTED_BACKFILL_VERSION, phase, cursor, datedTotal: (typeof body.datedTotal === "number" ? body.datedTotal : 0), note: typeof body.note === "string" ? body.note.slice(0, 200) : null, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      const byBoard = new Map<string, { company: string; ids: string[] }>();
      let scanned = 0;
      let exhausted = false;
      // Set when the DRAW itself failed (statement timeout), as opposed to the
      // phase genuinely running out of rows. The two look identical downstream
      // and must not: only the second may write a completion stamp.
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
                  // The employer's OWN stated date, never our first_seen. A
                  // posting that dates older than the 30-day serving window is
                  // a CORRECT outcome and a desirable one: the freshness cap
                  // then drops it instead of serving it ageless. Do not null a
                  // too-old date — that is exactly the laundering the Lever
                  // incident note in normalize.ts warns about.
                  const m = /"datePosted"\s*:\s*"([^"]+)"/.exec(html);
                  const iso = sanePostedAt(m?.[1] ?? null);
                  if (iso) dates.set(rowId, iso);
                } catch { /* row stays NULL */ }
              }));
            }
          } else if (phase === "bamboohr" || phase === "rippling") {
            // Per-posting official detail endpoints (both company-stated):
            //   bamboohr: /careers/{id}/detail → result.jobOpening.datePosted
            //   rippling: /jobs/{uuid} → createdOn (uuid verified == board id)
            // Small concurrent pool; a 404/parse miss leaves the row NULL.
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
            // Production fetcher + normalizer: emits dated postings from the
            // stated relative age; stale (>30d) come back undated and are
            // skipped here — those rows age out via the freshness cap anyway.
            const { jobPostings } = await fetchWorkday({ name: company, source: "workday", token: tk } as JobSource);
            for (const p of normalizeWorkday(jobPostings as never, company, tk)) {
              if (p.postedAt) dates.set(p.id, p.postedAt);
            }
          }
          for (const id of ids) {
            const iso = dates.get(id);
            if (!iso) continue;
            const { error } = await client.from("job_board_postings").update({ posted_at: iso }).eq("id", id);
            // The error was DISCARDED. If every update failed — a constraint, a
            // type coercion, anything — `dated` stayed 0 and nothing anywhere
            // recorded why, which is indistinguishable from "the vendor gave us
            // no dates". Capture the first one; it costs a string.
            if (!error) dated++;
            else if (!lastBoardError) lastBoardError = `update ${id.slice(0, 40)}: ${error.message ?? error}`.slice(0, 160);
          }
          boardsDone++;
          if (boardsDone % 10 === 0) {
            await beacon(`boards ${boardsDone}/${byBoard.size} dated=${dated}${lastBoardError ? ` last=${lastBoardError}` : ""}`);
          }
        } catch (e) {
          // Was silent. Keep the sweep resilient per board, but record the LAST
          // failure so "dated 0 of 120" can be told apart from "every vendor
          // call threw".
          lastBoardError = `${tk}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
        }
      }
      // Cumulative across the whole chain, threaded hop to hop. Without this a
      // completion stamp records only the LAST hop's numbers, so a chain that
      // walked 43,687 rows and dated none is indistinguishable from one that
      // dated thousands — which is exactly the ambiguity that let this sweep
      // look "done" while bamboohr sat at 0% dated for weeks.
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
      // One-time sweep parsing stored salary text into salary_min_annual for
      // rows that predate the structured parser. chainKey-gated + self-chaining
      // like backfill-experience; stamps salary_parse_version when done.
      // Unparseable rows stay NULL — the id cursor walks past them, and the
      // completion stamp keeps the sweep from re-scanning them every pass.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-salary is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      let scanned = 0;
      // Group by the (annualMin, currency) pair so each distinct patch is one
      // chunked update. v4 re-parses EVERY salaried row (not just currency-NULL
      // ones): earlier detector versions mislabeled MX$/R$/HK$ postings as USD
      // and annualized mislabeled monthlies — those rows hold wrong values, not
      // NULLs. Rows whose stored values already match the current parse are
      // skipped, so a re-sweep only writes actual corrections.
      const groups = new Map<string, { annualMin: number | null; annualMax: number | null; period: string | null; currency: string | null; ids: string[] }>();
      const PAGES = 6;
      for (let page = 0; page < PAGES; page++) {
        let q = client
          .from("job_board_postings")
          // `source` and `employment_type` ride along because THE SWEEP'S PARSE
          // CONTEXT HAS TO MATCH THE INGEST PARSE'S, or a version bump republishes
          // a figure the ingest path deliberately refused. employment_type is the
          // only stored record of a posting's schedule, and the part-time guard now
          // reads its underscore spelling; `source` is what says whether even that
          // is enough (see sweepRefusesAnnual).
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
          // THE SAME CONTEXT THE TWO INGEST PARSES GET, as far as a row can carry
          // it. title and description were always passed; employment_type was not,
          // and it is the only column that records a posting's schedule — so this
          // sweep recomputed the full-time-load annual on every part-time row whose
          // words live in a vendor field and not in its prose.
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
          // AND WHERE THIS LANE CANNOT SEE WHAT INGEST SAW, IT WRITES NOTHING. The
          // rule is stated and argued at sweepRefusesAnnual; here it is one call,
          // placed after the no-change skip so a row it protects is not even
          // grouped. It refuses only NULL -> a number, only on a load-dependent
          // period, only for a source whose schedule words no column carries.
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
      // Escape hatch for the stale-bundle guard: an INTENTIONAL catalog shrink
      // must lower the high-water mark or the orphan prune stays disabled.
      // Maintenance-gated — the mark protects real postings from stale deploys.
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

    /* THE FIELD-COUNT READ, WITHOUT THE BROWSE IT WAS PRETENDING TO BE.
     *
     * /explore renders eighteen tiles whose numbers must come from the SAME
     * stored row the destination prints, so it read them the only way one could
     * be reached: {action:"list", limit:1, includeFacets:false}, taking
     * `categories` off an otherwise-discarded list reply. Three costs came with
     * that, and this exit removes all three.
     *
     *   1. IT LOGGED A SEARCH NOBODY PERFORMED. An unfiltered, q-less list
     *      falls to the recency exit, which calls logSearch immediately before
     *      returning -- inserting a job_board_search_events row with q:"",
     *      empty filters, offset_n:0, results:1 and a shown-set of the one job
     *      it served, under the column's 'web' default. /explore is
     *      prerendered, sitemapped daily at 0.8 and the default landing intent,
     *      so every view of it appended one synthetic zero-query browse to the
     *      table whose stated purpose (see the comment at the recency exit) is
     *      an unbiased browse denominator. The zero-result rate, the
     *      results-per-search distribution and the shown-set click attribution
     *      were all skewed by /explore's traffic, with no field in the row that
     *      could filter it back out.
     *
     *   2. IT PAID FOR A PAGE IT THREW AWAY. serveList runs page_query and
     *      attachRecheckedAt before it can return anything; a {limit:1} list
     *      call was measured at 30,728ms during the 2026-08-30 saturation
     *      incident. Eighteen tiles render no numbers until this resolves.
     *
     *   3. IT COULD NOT SAY THE COUNTS WERE CARRIED. facetsCarried rides the
     *      refresh_head row but was in no list response, so when
     *      refresh_job_board_facets fails the page stamped hours-old integers
     *      with the current pass time and told the reader they were "counted
     *      {{time}} in the board's own scan". Measured failure mode: facets
     *      timed out for 4+ hours on 2026-08-29.
     *
     * IT IS THE SAME ROW AND THE SAME RULE, which is the property that must not
     * be lost. It reads job_board_meta k='refresh_head' -- the row serveList
     * serves from -- and hands the facet through visibleCategories with
     * unfiltered=true, exactly as the list exits do. It is NOT rpc(
     * "get_job_board_facets"): that reads k='facets', a DIFFERENT row, and
     * would reintroduce the two-scans-for-one-quantity failure this whole pass
     * removed. */
    if (action === "facets") {
      const { data: fRow } = await client
        .from("job_board_meta").select("v").eq("k", "refresh_head").maybeSingle();
      const fv = ((fRow?.v ?? null) as Record<string, unknown> | null);
      if (!fv) return json({ categories: undefined, refreshedAt: null }, 200);
      return json({
        categories: visibleCategories(fv.categoriesFacet as Record<string, number> | undefined, true, null),
        refreshedAt: (fv.refreshedAt as string) ?? null,
        // Present ONLY when the counts are last pass's, carried through a
        // failed aggregate. Absence is the healthy state, so a normal reply
        // publishes nothing -- the same shape rankedFellBack uses.
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
      // Rationale: docs/job-board-index-notes.md#n239-meta-deadline-ms
      const META_DEADLINE_MS = 3_000;
      const t_meta = Date.now();
      // A TIMEOUT AND AN ABSENT ROW MUST NOT LOOK THE SAME. withDeadline
      // resolves {data:null} on expiry, which is byte-identical to "this row
      // does not exist" — and the branch below treats the latter as first boot
      // and seeds the table. Conflating them is what turned a slow database
      // into a self-inflicted refresh storm, so the marker is explicit.
      const META_TIMEOUT = Symbol("meta-timeout");
      // A rejected promise AND a resolved-with-.error read both mean "we do
      // not know", exactly like a timeout — the .4 fix mapped rejections to
      // {data:null}, which is byte-identical to "no such row", so an errored
      // read still fell into the first-boot seed the fix existed to stop.
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
        // The fat row (1.3-1.6MB) gets what is LEFT of the one budget — never a
        // second full one. Skipped entirely if the head read already expired:
        // a database too slow to answer the small row will not answer the big
        // one, and asking is another second of a visitor's time.
        const fatRes = await raceMeta(
          client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle(),
        );
        if (fatRes === META_TIMEOUT) metaTimedOut = true;
        meta = (fatRes === META_TIMEOUT
          ? null
          : (fatRes.data ?? null)) as { v: Record<string, unknown>; updated_at: string } | null;
      }
      const preMs: Record<string, number> = { meta_read: Date.now() - t_meta };

      // ATTRIBUTE THE REQUEST ONCE, HERE, and carry it on the body serveList
      // already receives — resolveCaller needs the REQUEST (its headers are
      // most of the evidence) and serveList only ever sees the body. Writing
      // the resolution back over the caller hint the client may have sent is
      // the point: from this line on, body.caller is the answer, not a claim.
      body.caller = resolveCaller(req, body) ?? undefined;

      if (!meta) {
        // Rationale: docs/job-board-index-notes.md#n240-metatimedout-waituntil-runrefresh-clie
        if (!metaTimedOut) waitUntil(runRefresh(client, true));
        else console.warn(`[JOB-BOARD] meta read expired after ${Date.now() - t_meta}ms — serving without the headline, NOT seeding`);
        return await serveList(client, body, undefined, t_entry, preMs);
      }
      if (Date.now() - new Date(meta.updated_at).getTime() > STALE_MS) {
        waitUntil(runRefresh(client)); // serve stale, refresh behind the scenes
      }
      return await serveList(client, body, meta, t_entry, preMs);
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

    // KEPT FOR OLDER BUNDLES. The scorer moved to its own function (job-fit,
    // 2026-09-03) so a reader's score never competes with the ingest for a
    // worker; the site and MCP call job-fit. This copy answers clients that
    // have not reloaded yet, with identical semantics.
    if (action === "fit-batch") {
      const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";
      // TWENTY PER CALL. This action runs inside the same function as the
      // ingest and shares its worker pool; at 60 ids it failed 2 of 4 live
      // calls with WORKER_RESOURCE_LIMIT while 20 succeeded 2 of 2. The client
      // sends 20 since the same day; the cap here keeps an older bundle from
      // asking for a batch that dies.
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, FIT_BATCH_MAX) : [];
      if (resumeText.trim().length < 100 || ids.length === 0) {
        return json({ error: "resumeText (100+ chars) and ids are required" }, 400);
      }
      // Deterministic compute, but still rate-limited (it reads 60 rows a call).
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const { data: allowed } = await client.rpc("check_rate_limit", {
        p_function: "job-board-fit", p_ip: clientIp, p_max_requests: 120, p_window_minutes: 1440,
      });
      if (allowed === false) return json({ error: "Daily fit-ranking limit reached.", rateLimited: true }, 429);

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
      // ONE résumé scan for the whole batch. computeFit(desc, resumeText) in
      // this loop re-walked the entire dictionary against the same 50KB résumé
      // per posting — the expensive half of the scorer, repeated sixty times
      // for an input that cannot change mid-batch.
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
      // Greenhouse ONLY: this lane fetches the GH per-job endpoint, so a non-GH
      // board here would 404 forever. That is not a filter written twice — it
      // is descBackfillBoards(), the same call the maintenance trigger makes,
      // so the population measured and the population filled are one
      // population. Other vendors fill via the desc-sweep board lane, which
      // uses their own list payloads.
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
        // How much is still missing? A whole failed board (transient) should
        // retry within the hour; a handful of permanently-broken jobs should
        // not thrash the sweep — settle to the daily cadence for those.
        let remaining = 0;
        for (const b of BOARDS) {
          const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).eq("company_token", b.token).is("description", null);
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
        // country rides along: parseSalaryStructured resolves a bare "$" by
        // country, so without it a Toronto posting saying "$120,000" is stored
        // as USD — inflating its rank ~1.37x and misstating the offer.
        .select("id, country, title")
        .eq("company_token", s.token)
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
            // Backfilled description is also the salary source for these boards
            // (GH giants fetch without content, so ingest-time mining never saw
            // it). Only set when extraction finds the company's own pay text.
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
      // Advance when the board is drained (short page) OR when a full page
      // produced nothing: those rows are permanently unfillable (deleted from
      // the vendor, wrong id shape), and staying put re-fetched the same 50
      // dead ids every hop forever — a livelock that stalled the whole sweep.
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
      // Vector fill for semantic search. Reads its batch from get_embed_batch
      // (description-bearing rows first, newest first, including rows whose
      // description arrived AFTER a title-only embedding), embeds in-runtime,
      // upserts. Ten per hop: each embedding costs ~100-200ms of the 2-second
      // per-request CPU budget, and blowing that budget kills the isolate
      // mid-batch rather than failing politely.
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
              // A NOT NULL violation here means the embedding-nullable ALTER
              // itself never applied — nothing to do function-side; leave the
              // cursor so the seed retries after the migration truly lands.
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
        // While the seed is still filling the queue, a batch error (the empty
        // queue's phase-2 timeout) must NOT settle the chain for an hour —
        // keep chaining so the seed finishes; the settle only happens once
        // seeding is complete and the batch still errors.
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
        // Budget guard: stop BEFORE the embed that would blow the CPU cap.
        // A partial batch still chains below; unfinished rows simply remain
        // in the queue for the next hop.
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
      // Paced chain: sleep BEFORE the next hop. Back-to-back hops turned this
      // sweep into a continuous DB load (2026-07-26 saturation incident) —
      // the pause caps the duty cycle so user queries always outrank the fill.
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
      // Country for rows whose location never carried one (61.7% coverage when
      // built; the country filter was blind to 218k postings). Pure DB work —
      // read location, run the same detectCountry ingest uses (now with the
      // exact-segment city table), write back. No network, so it is allowed to
      // run alongside desc-sweep instead of queueing behind it.
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
      // Also satisfy the LEGACY pass-complete watcher (country_version): the
      // original rollout's handler stamped that key, this handler replaced it
      // (2026-07-25 — two handlers shared the action name; the legacy one
      // shadowed this one AND stamped a key this track never read, which kept
      // re-kicking country and starving desc-sweep of its recovery kicks).
      // Stamping both keys settles every watcher.
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
      // A WATERMARK, NOT A ROTATION. Newest-first across vendors (.33) made
      // the vendor slot meaningless as a selector: a page whose rows all fail
      // permanently stays null and comes straight back next hop, walling off
      // every vendor's backlog behind it (reviewed 2026-09-03). Each hop now
      // walks first_seen downward from the cursor the previous hop handed on;
      // failed rows are revisited on the next PASS, after the wrap.
      const descCursor = typeof body.cursor === "string" && body.cursor ? body.cursor : null;
      if (vi >= DETAIL_DESC_SOURCES.length) {
        // ── Phase 2: board-level lane ────────────────────────────────────────
        // workable/pinpoint carry their descriptions in the LIST payload, so
        // ingest stores them on insert — but ingest is INSERT-ONLY, so the ~25k
        // rows that predate the extraction keep their null forever. One board
        // fetch fills every null row on that board, where routing them through
        // the per-posting phase would re-fetch the whole board PER ROW.
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
        // Cheap check first: no null rows means no board fetch at all. After the
        // initial fill that's the case for nearly every board, so a full pass
        // over ~1,700 boards costs almost nothing.
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
        // `salary` rides along so the vendor-pay write below can be FILL-ONLY
        // against what the row already holds, not only against what this hop
        // mines. Without it the fill-only rule would be an inference about
        // which writers can reach a description-less row rather than a fact
        // about this one.
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
            // Same rules as structured-sweep, stated once here and applied in
            // both of this lane's write paths: the vendor's structured country
            // replaces our text inference, the vendor's display location only
            // fills a placeholder that names nowhere, and a SUBDIVISION is
            // written only for a requisition that names one site.
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
                // The salary guard is added the same way the work-mode one is and
                // for the same reason — a fill is only a fill if the row still
                // lacks the field when the statement runs — and only when the
                // patch actually carries pay, so a row that gains nothing here
                // does not gain a predicate that could match nothing.
                const q0 = client.from("job_board_postings").update(salv).eq("id", row.id);
                const q = salv.salary ? q0.is("salary", null) : q0;
                await (salv.work_mode ? q.is("work_mode", null) : q);
              }
              continue;
            }
            const clean = text.replace(/\u0000/g, "").slice(0, STORED_DESC_CAP);
            if (!clean) continue;
            // Same rule as ingest: the description is also the salary source
            // where the vendor gave us no structured pay field. Only ever the
            // company's own words — never an estimate.
            const minedSalary = extractSalary(clean);
            // Rationale: docs/job-board-index-notes.md#n249-salarycountry
            const salaryCountry = (placePatch.country as string | null) ?? (row as { country?: string | null }).country;
            // Rationale: docs/job-board-index-notes.md#n250-statedpay
            const statedPay = minedSalary ?? (row.salary ? null : vendorPay);
            // Rationale: docs/job-board-index-notes.md#n251-statedparse
            const statedParse = statedPay ? parseSalaryStructured(statedPay, salaryCountry, { title: (row as { title?: string | null }).title ?? null, description: clean }) : null;
            // The three fields below are DERIVED FROM DESCRIPTION TEXT but were
            // only ever computed at ingest, so the description backfill left
            // them stale — measured coverage was experience 26.4%, work mode
            // 9.7%, salary 4.0%. Re-deriving here costs nothing: the text is
            // already in hand.
            const exp = detectExperience(row.title ?? "", clean);
            // Rationale: docs/job-board-index-notes.md#n252-wm
            const wm = wmVendor ?? (row.work_mode ? null : detectWorkMode(row.location, row.title));
            // Dates: Workday's stored value is a relative bucket floored at 30
            // days, so an absolute startDate is strictly better and replaces
            // it. For every other vendor we only fill a gap.
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
      // Advance when this vendor has no more null rows (short page), OR when a
      // full page yielded nothing. Without that second condition a vendor whose
      // rows all fail permanently would re-select the same page forever: failed
      // rows stay null, so they'd come straight back on the next hop.
      const exhausted = queue.length < DESC_SWEEP_PER_HOP;
      const nextCursor = exhausted ? null : (queue[queue.length - 1]?.first_seen ?? null);
      if (exhausted) {
        // Wrap: the rotation is complete when it comes back around to the
        // vendor it STARTED at, whatever that was; the length sentinel still
        // means "enter the boards phase".
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
      // The start-stamp CARRIES ITS CURSOR. Without it, a hop that dies
      // mid-flight leaves a row with no cursor, the re-kick reads "" and the
      // next attempt restarts from the RANGE START — measured: two dead hops
      // in a row both began again at workday:2020companies. With it, a death
      // resumes from the hop it died in.
      await client.from("job_board_meta").upsert(
        { k: "structured_sweep", v: { vendor: sVendor, running: true, cursor, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      // description IS NOT NULL is the POINT, not an optimisation: those are
      // exactly the rows desc-sweep can never revisit. Rows still lacking a
      // description are already its job and will pick up the same structured
      // fields on the way past, so scanning them here would duplicate a
      // per-posting vendor fetch for no gain.
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
            // NO `if (!text) continue` HERE. desc-sweep drops the whole row
            // when the description comes back empty (:4485) and throws away a
            // remoteType and a startDate it successfully parsed on the way. In
            // this lane the description is not the payload — the structured
            // fields are — so an empty body is not a reason to discard them.
            const patch: Record<string, unknown> = {};
            // `remote` moves WITH work_mode or the two columns drift: ingest
            // sets remote = (workMode === "remote") and the board's Remote
            // filter reads the boolean, so writing one without the other makes
            // a row that says remote and cannot be found by asking for remote.
            if (workMode) { patch.work_mode = workMode; patch.remote = workMode === "remote"; }
            // Fill-only. A stored date here came from the vendor's own list
            // payload and this lane has no standing to overwrite it; the
            // Workday floored-bucket replacement is desc-sweep's call, made
            // where the description write already justifies the fetch.
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
      // Advance the cursor to the LAST id we selected, never to the last one we
      // filled: a page where nothing had a remoteType must still move, or the
      // lane re-reads the same page forever. This is the same failure desc-sweep
      // guards with `updated === 0`, in the form a keyset walk takes.
      const nextCursor = sQueue.length ? sQueue[sQueue.length - 1].id : "";
      const sDone = sQueue.length < STRUCTURED_SWEEP_PER_HOP;
      if (sDone) vi += 1;
      // Totals are CUMULATIVE across the pass, not per-hop: the progress row
      // and the done-stamp both report what the whole pass has done so far, so
      // finishing no longer erases the evidence of what finished.
      const cumScanned = passScanned + sSeen;
      const cumFilled = passFilled + sFilled;
      await client.from("job_board_meta").upsert({
        k: "structured_sweep",
        v: {
          vendor: sVendor, cursor: sDone ? "" : nextCursor,
          scanned: cumScanned, filled: cumFilled, at: new Date().toISOString(),
          // The hop's actual id window, kept for the forensics the 17:50 pass
          // forced: it "completed" against 148,776 eligible rows, the id
          // format assumption checked out, and the only remaining way to see
          // WHERE the walk really went is for the walk to say so. firstId and
          // lastId of the final page pin the range the select returned; a
          // page that comes back short mid-range names its own boundary.
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
      // Report-a-posting: a user flags a listing as gone/misleading/other.
      // We log it (service-role-only table, no client write surface) and the
      // frontend follows a "gone" report with the existing verify action —
      // a confirmed-dead posting is pruned for everyone on the spot.
      const id = String(body.id ?? "").slice(0, 200);
      const reason = String(body.reason ?? "");
      if (!id || !["gone", "misleading", "other"].includes(reason)) {
        return json({ error: "id and a valid reason are required" }, 400);
      }
      const note = String(body.note ?? "").replace(/\u0000/g, "").slice(0, 280);
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
      // Validated, not trusted: a malformed uuid would make the INSERT fail as
      // a whole and lose the click entirely. Anything that is not a uuid is
      // stored as null, which still counts the click.
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
      // ONE lookup, and it runs INSIDE waitUntil — never before the response.
      // It resolves to nulls on any failure, because an un-stamped click still
      // counts and dropping it would bias every rate.
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
      waitUntil(clickStamps.then((stamps) =>
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
      // Answers immediately. The caller is a beacon fired as someone navigates
      // away to an employer's site; making it wait on a write would cost the
      // click it is trying to record.
      return json({ ok: true });
    }

    if (action === "verify") {
      // Live-now liveness for a batch of posting ids (verify-on-apply,
      // surfaced-match re-check). Confirms against the vendor, prunes ids
      // confirmed gone from the DB so they vanish for everyone, and records
      // the boards touched as a demand signal for prioritized refresh.
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
      if (ids.length === 0) return json({ live: {} });
      // Rationale: docs/job-board-index-notes.md#n264-livemap
      const liveMap: Record<string, boolean | null> = {};
      const deadIds: string[] = [];
      const demandTokens = new Set<string>();
      liveBoardMemo.clear();
      // apply_url is what lets the workday probe reach its authoritative detail
      // endpoint instead of stopping at the search index; read it once here so
      // the per-id probe never has to go back to the DB.
      const { data: applyRows } = await client
        .from("job_board_postings").select("id, apply_url").in("id", ids);
      const applyBy = new Map((applyRows ?? []).map((r) => [String(r.id), (r.apply_url as string | null) ?? null]));
      for (const id of ids) {
        const [source, token, ...rest] = id.split(":");
        const externalId = rest.join(":");
        const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
        if (!src || !externalId) { liveMap[id] = false; deadIds.push(id); continue; }
        demandTokens.add(src.token);
        const live = await checkLive(src, externalId, applyBy.get(id) ?? null);
        if (live === false) { liveMap[id] = false; deadIds.push(id); }
        else liveMap[id] = live; // true = confirmed at the source; null = undecidable (page-capped feed). Both keep showing; only one is a confirmation.
      }
      // Rationale: docs/job-board-index-notes.md#n265-deadids-length-0
      if (deadIds.length > 0) {
        const { data: stamps } = await client
          .from("job_board_postings").select("id, missing_since").in("id", deadIds);
        const stampBy = new Map((stamps ?? []).map((r) => [String(r.id), r.missing_since as string | null]));
        const nowMs = Date.now();
        const confirmed: string[] = [];
        const firstMiss: string[] = [];
        for (const id of deadIds) {
          const st = stampBy.get(id);
          if (st && nowMs - Date.parse(st) >= VERIFY_GRACE_MS) confirmed.push(id);
          else if (!st) firstMiss.push(id);
          // stamped but still inside the grace window → leave it, re-probe later
        }
        const stampIso = new Date().toISOString();
        for (let i = 0; i < firstMiss.length; i += 50) {
          await client.from("job_board_postings")
            .update({ missing_since: stampIso }).in("id", firstMiss.slice(i, i + 50));
        }
        for (let i = 0; i < confirmed.length; i += 50) {
          await client.from("job_board_postings").delete().in("id", confirmed.slice(i, i + 50));
        }
      }
      // Demand signal: boards a user just looked at jump the refresh queue.
      if (demandTokens.size > 0) {
        const { data: dm } = await client.from("job_board_meta").select("v").eq("k", "demand").maybeSingle();
        const prev = ((dm?.v as { tokens?: Array<{ t: string; at: number }> } | null)?.tokens ?? []).filter((x) => Date.now() - x.at < 20 * 60_000);
        const merged = [...prev.filter((x) => !demandTokens.has(x.t)), ...[...demandTokens].map((t) => ({ t, at: Date.now() }))].slice(-60);
        await client.from("job_board_meta").upsert({ k: "demand", v: { tokens: merged }, updated_at: new Date().toISOString() }, { onConflict: "k" });
      }
      return json({ live: liveMap, flagged: deadIds.length });
    }

    if (action === "audit") {
      // Rationale: docs/job-board-index-notes.md#n266-audit-sample
      const AUDIT_SAMPLE = 100;
      const { data: prevAudit } = await client.from("job_board_meta").select("v, updated_at").eq("k", "audit").maybeSingle();
      const prevAge = prevAudit ? Date.now() - new Date(prevAudit.updated_at).getTime() : Infinity;
      if (prevAge < 20 * 3600_000 && body.force !== true) {
        return json({ ...(prevAudit?.v as Record<string, unknown>), cached: true });
      }
      // Rationale: docs/job-board-index-notes.md#n267-const-count-totalrows-await-client-from
      const { count: totalRows } = await client.from("job_board_postings").select("id", { count: "planned", head: true });
      const corpus = totalRows ?? 0;
      const VENDORS = [...new Set(JOB_SOURCES.map((s) => s.source))];
      const PER_VENDOR = Math.max(4, Math.floor(AUDIT_SAMPLE / Math.max(1, VENDORS.length)));
      const sampleIds: string[] = [];
      // apply_url rides along with every drawn id: the workday probe needs it to
      // reach its authoritative detail endpoint, and a liveness audit that can't
      // get an authoritative answer is measuring its own search index.
      const applyBy = new Map<string, string | null>();
      // Per-vendor corpus sizes, kept so an omitted stratum can be reported
      // with its real weight rather than just disappearing. `null` means the
      // count was unavailable — deliberately distinct from 0, because "this
      // vendor has no postings" and "we could not find out" are opposite facts
      // about coverage and collapsing them is what hid nine vendors.
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
        // Draw even when the count is unavailable. The draw is a cheap keyset
        // read and it — not the count — is what establishes whether this vendor
        // can be sampled at all. Letting a failed count skip the draw is the
        // precise mechanism that silently dropped nine strata.
        if (n === 0) continue;
        sampleIds.push(...await drawIds(v, Math.min(PER_VENDOR, n ?? PER_VENDOR)));
      }
      // `unknown` is the whole undecided bucket and stays the total so nothing
      // downstream changes meaning; `windowed` is the share of it that was
      // fetched successfully and simply read short of the vendor's own
      // advertised total. The page prints both, because after .64 the second
      // is the LARGER one on capped vendors and calling it "unreachable" would
      // be a false statement about a vendor that answered every request.
      let live = 0, gone = 0, unknown = 0, pageCappedUnknown = 0;
      const byVendor: Record<string, { sampled: number; live: number; gone: number; unknown: number; pageCapped: number; accuracyPct: number | null; deepened?: boolean }> = {};
      liveBoardMemo.clear();
      // `headline` distinguishes the even base draw from the follow-up draws
      // below. The published sentence says the sample was "drawn evenly across
      // hiring systems", and that is only true of the base draw — folding a
      // 24-probe re-draw of one vendor into the headline would silently make it
      // a differently-weighted number than the one the page describes.
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

      // ── Label audit: do our OWN labels survive contact with the posting's
      // text? Cross-checks stored experience_band / remote / category against
      // the stored description — no network, pure measurement, published
      // alongside the liveness number. Contradicted entry labels are demoted
      // to "unspecified" (we can't honestly place them); remote flips only on
      // the strongest explicit pattern — mislabeled is worse than unlabeled.
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
      // Rationale: docs/job-board-index-notes.md#n273-const-data-metarow-await-client-from-job
      const { data: metaRow } = await client.from("job_board_meta").select("v").eq("k", "refresh").maybeSingle();
      const suggestV = (metaRow?.v ?? {}) as Record<string, unknown>;
      const facet = (suggestV.companiesFacet ?? []) as Array<{ token?: string; name?: string; count?: number }>;
      const openRaw = suggestV.companiesOpen;
      const openMap = openRaw && typeof openRaw === "object" && !Array.isArray(openRaw) ? openRaw as Record<string, number> : null;
      // OWN keys only: the map is keyed by board token, and a token named
      // 'constructor' (a real ashby board) reads Object.prototype.constructor
      // from a bare bracket — a function served as an open-roles count.
      const merged = mergeCompanyFacet(
        openMap
          ? facet.map((c) => ({ ...c, open: typeof c.token === "string" && Object.prototype.hasOwnProperty.call(openMap, c.token) ? openMap[c.token] : 0 }))
          : facet,
      );
      const hit = merged.filter((c) => String(c.name ?? "").toLowerCase().includes(q));
      // A name that STARTS with what was typed is what the reader meant; the
      // servable count breaks ties beneath that (the raw facet count only when
      // there is no servable one to rank by, and it is never published).
      hit.sort((a, b) => {
        const ap = String(a.name ?? "").toLowerCase().startsWith(q) ? 0 : 1;
        const bp = String(b.name ?? "").toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || (b.open ?? b.count ?? 0) - (a.open ?? a.count ?? 0);
      });
      return json({
        // `tokens` for the same reason facetHead ships it: `open` here is the
        // SUM over a merged employer's sub-boards, and a filter set to the
        // primary token alone would serve less than the number promised.
        companies: hit.slice(0, 12).map((c) => ({
          token: c.token,
          name: c.name,
          ...(typeof c.open === "number" ? { open: c.open } : {}),
          ...(Array.isArray(c.tokens) && c.tokens.length > 1 ? { tokens: c.tokens } : {}),
        })),
      });
    }

    if (action === "exists") {
      // Feature 7: the tracker asks which of a user's saved/applied job ids
      // are still live. A missing id means the company took the posting down
      // (refresh deletes vanished ids within the hour). Read-only, cheap.
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
      if (ids.length === 0) return json({ open: {} });
      const openMap: Record<string, boolean> = {};
      for (const id of ids) openMap[id] = false;
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
      // Read-only probe of the semantic tier, used to verify result quality
      // against real queries before (and after) the tier is user-visible.
      // Bounded and cache-free; returns similarity scores so quality is
      // inspectable, not guessed at.
      const q = String(body.q ?? "").trim().slice(0, 200);
      if (q.length < 3) return json({ error: "q too short" }, 400);
      const qVec = await embedText(q);
      if (!qVec) return json({ error: "inference unavailable in this runtime" }, 503);
      const { data: sem, error: sErr } = await client.rpc("search_jobs_semantic", {
        p_embedding: JSON.stringify(qVec),
        p_limit: Math.min(Math.max(Number(body.limit) || 10, 1), 30),
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
      // missing_since IS NULL here too. 20260728120000 patched buildQuery and both
      // search RPCs and its header claimed that "covers every query shape" — it
      // did not cover this one, so a Google-indexed deep link to a posting the
      // employer's feed already dropped still rendered as a live listing with a
      // working apply button. That is precisely the posting the Ghost Job Index
      // exists to name.
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
        const { data: closure } = await client
          .from("job_board_closures")
          .select("title, company, closed_at")
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
      // Demand-weighted fill: a posting someone actually opened is worth more
      // than a random row in the sweep, and we've already paid for the fetch.
      // Persisting it means the next reader (and fit scoring, and the apply kit)
      // gets it for free instead of re-fetching forever. Best-effort — a failed
      // write must never break the read.
      if (!stored && description && jobRow) {
        const minedSalary = jobRow.salary ? null : extractSalary(description);
        // THE SAME FILL-ONLY EXPRESSION AS THE DESC SWEEP, because this is the
        // same payload and the same field. The prose this hop mined wins, then the
        // pay the row already holds silences both, and only then the vendor's
        // structured node — the precedence inversion is argued at the sweep's own
        // write site and is not restated here. Without this the figure was fetched
        // and dropped, and the row was then closed to the only lane that reads it.
        const statedPay = minedSalary ?? (jobRow.salary ? null : vendorPay);
        const statedParse = statedPay ? parseSalaryStructured(statedPay, jobRow.country as string | null, { title: jobRow.title as string | null, description }) : null;
        // Same re-derivation as the sweep: these fields come from description
        // text, so a row that gains a description here should gain them too,
        // rather than waiting for the sweep to reach it. Fill-only for work
        // mode — a vendor's structured field always outranks inference.
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
      // The pane needs the stamp too — it is where the apply decision is made,
      // and until now only the list paths attached it. attachRecheckedAt takes
      // an array, so the single row goes through as one.
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
        // The id's token half carries the EU routing prefix, and the questions
        // endpoint only answers on the tenant's own side — route through the
        // helper or every EU posting reads as "no public form".
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
        // The posting's OWN url, not one rebuilt from the id. Pinpoint's id is
        // a numeric key while its apply path is an unrelated UUID — composing
        // the path 404'd on 8 of 8 live boards.
        const { data: row } = await client
          .from("job_board_postings").select("apply_url").eq("id", id).maybeSingle();
        const postingUrl = String((row as { apply_url?: string } | null)?.apply_url ?? "");
        if (!postingUrl) return unsupported();
        const url = source === "breezy" ? breezyApplyUrl(postingUrl) : pinpointApplyUrl(postingUrl);
        const res = await fetchWithTimeout(url);
        if (!res.ok) return unsupported();
        const html = await res.text();
        const raw = source === "breezy" ? parseBreezyQuestions(html) : parsePinpointQuestions(html);
        // No questions found is NOT the same as "this form has none" — it is
        // equally consistent with the markup having changed under us. Reporting
        // supported:false keeps the caller on its inferred-question fallback
        // rather than asserting an empty form.
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
});

// Rationale: docs/job-board-index-notes.md#n277-attachmsaccum
let attachMsAccum = 0;

async function attachRecheckedAt(
  client: SupabaseClient,
  jobs: Array<Record<string, unknown>>,
  /**
   * Terms the searcher asked NOT to see ("engineer not manager", "nurse
   * -travel"). Applied HERE because this is the one function every path that
   * returns postings already calls — the ranked tier, the routed tier, fuzzy and
   * semantic all pass through it, so one filter covers them without any tier
   * having to know exclusions exist.
   *
   * AN EXPLICIT PARAMETER, never a module-scoped request variable like
   * attachMsAccum above. Two requests can be in flight in one isolate, and a
   * leaked telemetry counter is a wrong number while a leaked FILTER is one
   * visitor's exclusions silently applied to another's results.
   */
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
  const tokens = [...new Set(jobs.map((j) => String(j.token ?? "")).filter(Boolean))].slice(0, 80);
  if (tokens.length === 0) return jobs;
  // Rationale: docs/job-board-index-notes.md#n279-const-data-error-await-withdeadline
  const { data, error } = await withDeadline(
    client.from("job_board_verifications").select("company_token,verified_at").in("company_token", tokens),
    1_500,
  ) as { data: unknown[] | null; error?: unknown };
  // On failure leave the field ABSENT. Falling back to last_seen would restore
  // the exact bug this removes.
  if (error || !Array.isArray(data)) return jobs;
  const byToken = new Map<string, string>();
  for (const r of data) {
    const t = (r as { company_token?: string }).company_token;
    const v = (r as { verified_at?: string }).verified_at;
    if (t && v) byToken.set(t, v);
  }
  for (const j of jobs) {
    const v = byToken.get(String(j.token ?? ""));
    // verified_at says the FEED was fetched, not that this posting was in it.
    if (v && !j.missingSince) j.recheckedAt = v;
  }
  return jobs;
}

/**
 * Show the location the visitor actually searched for.
 *
 * FOUND while verifying the metro-alias fix: a search for SF returned a card
 * reading "New York, New York, Un…" and looked like a broken filter. It was
 * not — the posting's location field is
 *   "New York, New York, United States; Remote; San Francisco, California, United States"
 * and it genuinely matched. Ungrouped, 19 of 19 rows were correct.
 *
 * That is worse than a real bug in one specific way: the filter works, and the
 * card says it does not. A visitor cannot verify a filter whose evidence
 * contradicts it, and this board asks to be verified.
 *
 * So when a location filter is active and the posting lists several places,
 * the matched one is shown first. Nothing is hidden — the others still travel
 * in the same string after it, and the count of remaining places is exposed so
 * the UI can say "+2 more" without inventing a number.
 */
function preferMatchedLocation(
  jobs: Array<Record<string, unknown>>,
  locTerms: string[],
): Array<Record<string, unknown>> {
  if (locTerms.length === 0) return jobs;
  const needles = locTerms.map((t) => t.toLowerCase().replace(/^,\s*/, "")).filter(Boolean);
  if (needles.length === 0) return jobs;
  for (const j of jobs) {
    const loc = typeof j.location === "string" ? j.location : "";
    // Multi-location postings use ";" or "/" — measured on live rows.
    const parts = loc.split(/\s*[;/]\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const hit = parts.findIndex((part) => needles.some((n) => part.toLowerCase().includes(n)));
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
  // Filterable since the country filter shipped, never returned: 0 of 21
  // emitted fields carried it, so the JSON-LD could not state
  // applicantLocationRequirements and no card could show where a role is.
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
  // Set when the employer's feed stopped listing this posting. Such a row must
  // never show a "re-checked" chip: the feed WAS re-checked and the posting
  // was not in it.
  missingSince: r.missing_since ?? null,
  // AGENCY DISCLOSURE (2026-08-31 charter): true when the posting's board is
  // a tagged staffing agency — the card badge and the opt-out filter both
  // read this. OMITTED when the row does not carry the column, exactly like
  // matchScope below: the ranked search_jobs exit serves RPC rows whose
  // shape predates the column (and the deploy window has no column at all),
  // and a hard-coded false there would be a claim, not a disclosure.
  ...(typeof r.agency === "boolean"
    ? {
      agency: r.agency,
    }
    : {}),
  // Tier-2 ranked searches only: the ts_headline fragment showing WHERE a
  // description-matched result matched ([[ ]] delimiters, client-rendered).
  ...(typeof r.snippet === "string" && r.snippet.includes("[[") ? { snippet: r.snippet } : {}),
  // WHICH SEGMENT THIS ROW IS IN, straight from the predicate rather than from
  // a substring test on the title. Present only on the ranked path — the browse
  // and rescue retrievers do not select the column. OMITTED rather than
  // defaulted to "title", which is also the deploy-window tolerance: if this
  // function ships before the migration applies, the column is absent, the key
  // is absent, and the client renders exactly today's page.
  ...(typeof r.title_match === "boolean"
    ? { matchScope: r.title_match ? ("title" as const) : ("description" as const) }
    : {}),
});

// Cluster folding lives in ./clusters.ts so a test can WALK it — see the
// header there for the phantom-location incident that forced the move.

// mergeCompanyFacet lives in ./clusters.ts with the other page-shaping folds.

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
  // Location-cluster collapsing is on unless a caller opts out (the lander and
  // company views WANT every location listed). Over-fetch so there is material
  // to fold: a page of 25 reads up to 75 rows, which is still one indexed page.
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

  // SEARCH TELEMETRY. One id per list response, echoed back by the client on a
  // click, which is the only thing that makes position-aware relevance
  // measurable at all. Without it a click can say "someone clicked something"
  // and nothing more.
  const searchId = crypto.randomUUID();
  // WHO ASKED, resolved once by resolveCaller in the `list` dispatch and
  // carried here on the body. Re-checked against the closed set rather than
  // trusted: this function is also reachable with a body nobody resolved (an
  // older bundle, a direct call), and an unrecognised value must read as "not
  // attributed" rather than reach a CHECK constraint and lose the whole event.
  const rawCaller = String((body as Record<string, unknown>).caller ?? "").toLowerCase();
  const caller = SEARCH_CALLERS.has(rawCaller) ? rawCaller : null;
  /**
   * Records this response. FIRE AND FORGET, BUT NOT SILENT.
   *
   * Behind waitUntil so a visitor never waits on telemetry and never loses
   * results to it. The failure is logged rather than swallowed: this repo's
   * most repeated defect is a telemetry table that records nothing while every
   * dashboard reads healthy — the checkout funnel captured NOTHING for weeks
   * because bad-visitorId 400s were caught and dropped on the floor.
   *
   * `total` is passed through as null when the board does not know. Coercing
   * unknown to 0 would silently inflate the zero-result rate, which is the one
   * number this table exists to produce.
   */
  /**
   * WHAT WAS SHOWN, not only what was clicked.
   *
   * Click-through had no denominator: search_clicks records the row a visitor
   * opened, and nothing recorded the rows they were offered and passed over. So
   * every employer-level demand number was confounded by our own ranking —
   * which changed materially several times last month — and there is no way to
   * tell "nobody wants this company" from "we stopped putting it on page one".
   *
   * TWENTY IDS, A BARE JSON ARRAY, IN SERVED ORDER — and "served" means the
   * array the response actually carries, which every call site therefore
   * builds BEFORE it logs. The page handed to json() is
   * preferMatchedLocation(await attachRecheckedAt(..., excludedTerms)): the
   * first drops every row whose title matched a "-manager" style exclusion and
   * the second reorders on location match. Logging the pre-filter grouping
   * would put ids in the impression list that the visitor never saw AND shift
   * every index out of step with the 1-based rank the click beacon reports —
   * so the denominator would not join to its own numerator, which is the whole
   * point of collecting it. The shape is the column's,
   * not this function's: job_board_search_events.shown is documented as an
   * array of up to 20 posting ids whose POSITION IS THE ARRAY INDEX — absolute
   * rank is offset_n + index + 1, and offset_n is already its own column, so no
   * per-row position is stored. A posting id is source:company_token:externalId,
   * so the employer of every impression is derivable without a second column,
   * and a trigger truncates anything longer (and NULLs anything that is not an
   * array, which is why this returns an array or nothing at all).
   *
   * An EMPTY array is a real value — a search that genuinely showed nothing —
   * and is not the same as null, which means the response predates the column.
   *
   * MEMORY: this runs on the SERVING path, not in the board loop, and walks at
   * most 20 elements of an array the response already built. Bounded, retains
   * nothing.
   */
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
        // Which surface asked. The key is OMITTED when the resolver could not
        // attribute the request, so the column's own DEFAULT ('web', the
        // schema's deliberate conservative choice) applies. Writing an explicit
        // NULL would be a different claim entirely — the column comment reserves
        // NULL for rows that predate it.
        ...(caller ? { caller } : {}),
        // The denominator: the head of the page this response returns.
        shown: shownSet(shownJobs),
      }).then(({ error }) => {
        if (!error) return;
        // Deploy-before-migration: an insert naming an absent column loses the
        // EVENT itself, and this table is the search log's only record. Write
        // the pre-.61 row rather than none; the columns resume on the next
        // request once the migration lands.
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
  // A DURATION ALONE CANNOT TELL A SUCCESS FROM A DEADLINE. `semantic: 5002`
  // and `semantic: 5002` look identical whether the tier answered in five
  // seconds or was cut off at its five-second deadline having answered nothing —
  // which is how "the rescue ladder was never the cost" got recorded as settled
  // while a tier was returning [] on every query. The outcome rides alongside.
  const phaseOutcome: Record<string, string> = {};
  const markFrom = (name: string, t0: number, outcome?: "ok" | "deadline" | "error" | "declined") => {
    phase[name] = (phase[name] ?? 0) + (Date.now() - t0);
    if (outcome) phaseOutcome[name] = outcome;
  };

  // Rationale: docs/job-board-index-notes.md#n290-request-budget-ms
  const REQUEST_BUDGET_MS = 9_000;
  const budgetLeft = () => Math.max(300, REQUEST_BUDGET_MS - (Date.now() - budgetStart));
  const honesty = (jobs: Array<Record<string, unknown>>): Record<string, unknown> => {
    const v = filterViolations(jobs, applied);
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
    if (v.length || Math.random() < 0.02) {
      const stamp = new Date().toISOString();
      waitUntil(Promise.resolve(
        client.from("job_board_meta").upsert({
          k: v.length ? "filter_integrity_incident" : "filter_integrity_ok",
          v: v.length
            ? {
              at: stamp,
              violations: v.length,
              rows: jobs.length,
              fields: [...new Set(v.map((x) => x.field))],
              sample: v.slice(0, 5),
              filters: applied,
            }
            : { at: stamp, rows: jobs.length },
          updated_at: stamp,
        }, { onConflict: "k" }),
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
      // Every list exit spreads this helper, so one line gives all seven of
      // them a server-side timing that can be read from outside without DB
      // access.
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
      // The board-wide count answers the BARE board's question only. This exit
      // fired for ANY offset past safeMetaTotal, filtered or not — so
      // {"q":"welder","country":"USA","offset":900000} answered an empty page
      // under total: 601,760, a headline about a different query. Filtered
      // requests get null + countUnavailable, and the disclosure fields ride
      // along: the fence holds on every exit or it holds on none.
      jobs: [], total: unfiltered ? safeMetaTotal : null, hasMore: false, nextOffset: offset,
      ...(!unfiltered || safeMetaTotal === null ? { countUnavailable: true } : {}),
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(maxAgeClamped ? { maxAgeClampedTo: 30 } : {}),
      ...exclusionDisclosure(excludedTerms),
      ...exclusionCountsCaveat(excludedTerms),
      // The empty page past the end is still a LIST response, and the client
      // renders the same chrome around it. Shipping a short shape here is the
      // same defect as the SALARY exit, just on a page with no rows to hide it.
      searchId, totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
      companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0,
      refreshedAt: null,
      // TIMED, BECAUSE THIS IS THE EXIT THAT ISOLATES THE META READ. It does no
      // query of its own, so tookMs here is almost entirely the facet-row fetch
      // plus transport — the cleanest measurement of the gap the two clocks
      // above were split to expose, and it was the one exit reporting nothing.
      // honesty() is deliberately not spread: it fires a 2% filter-integrity
      // meta upsert, which has no business running on an empty page.
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
    // skipTerms leaves the free-text predicate OFF so a caller can supply its
    // own matcher while still getting every FILTER — country, category,
    // experience, salary, companies, work mode, the freshness window and the
    // missing_since fence — from this one place. Added for the simple-config
    // tier; the alternative was a fifth query path with its own filter binding,
    // and this file has five defects in two days that are all that mistake.
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
    if (!opts?.skipTerms) for (const t of terms) q = q.or(`title.ilike."%${t}%",company.ilike."%${t}%",department.ilike."%${t}%"`);
    // Metro shorthand expands to the names that actually appear in the data,
    // and a noisy two-letter form is REPLACED rather than ORed in — searching
    // %LA% returns Plain City, Ohio.
    const locTerms = locationTerms(body.location).terms;
    if (locTerms.length === 1) q = q.ilike("location", `%${locTerms[0]}%`);
    // QUOTED, because a state alias contains a comma. PostgREST separates
    // or() branches on commas, so an unquoted `location.ilike.%, TX%` splits
    // into two malformed branches — the filter would silently stop meaning
    // what it says. Quoting the value is the documented escape for exactly
    // this, and sanitizeTerm already removes the characters that could close
    // the quote early.
    else if (locTerms.length > 1) q = q.or(locTerms.map((t) => `location.ilike."%${t}%"`).join(","));
    // Rationale: docs/job-board-index-notes.md#n299-applied-remote
    if (applied.remote) {
      q = q.eq("remote", true);
    }
    // Rationale: docs/job-board-index-notes.md#n300-applied-workmode-q-q-in-work-mode
    if (applied.workMode) q = q.in("work_mode", applied.workMode.split(","));
    if (applied.employmentType) q = q.in("employment_type", applied.employmentType.split(","));
    // Country filter: exact match on the deterministically extracted code.
    // Postings whose location we couldn't place have country NULL and are
    // excluded by the filter — honestly, never guessed (the UI says so).
    // Split here too: the RPC splits, and a browse page that binds equality
    // against "DE,GB" serves zero rows under a headline that counted both.
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
    // "Only jobs the agent can apply to" — a FILTER on source, composing with
    // the date-index ORDER BY. Never a sort: ranking by sendability is the
    // .order("category") timeout with a different column. The list comes from
    // the same SENDABLE_VENDORS mirror the badges and the worker share.
    if (applied.sendableOnly) q = q.in("source", [...SENDABLE_VENDORS]);
    // Experience filter: one of entry/mid/senior/expert. "unspecified" rows are
    // never returned by a band filter — we only surface postings we can honestly
    // place. Accepts a comma list or an array so a user can widen; anything that
    // does not resolve to a real band is reported in ignoredFilters rather than
    // dropped, which is the defect this normalisation exists to close.
    if (applied.experience.length === 1) q = q.eq("experience_band", applied.experience[0]);
    else if (applied.experience.length > 1) q = q.in("experience_band", applied.experience);
    // Rationale: docs/job-board-index-notes.md#n302-applied-salaryfloor-null
    if (applied.salaryFloor !== null) {
      // WIDENED ON REQUEST. NULL fails every comparison, so a bare floor also
      // discards the ~80% of the board that states no pay — disclosed by
      // coverageDisclosure, but until now not declinable. Only fires when the
      // caller opts in, so the ordinary floor keeps its single indexed
      // predicate rather than paying for an OR arm it does not need.
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
    // "Only postings we can actually score." See the field's own note in
    // filters.ts: in résumé mode an undescribed row can only ever say "no
    // score", and the newest rows — the default browse — are exactly those.
    if (applied.hasDescription) q = q.not("description", "is", null);
    // Hourly vs salaried. Rows with NO stated period are excluded, exactly as
    // work mode excludes rows with no stated mode — 10.6% coverage, published by
    // coverageDisclosure whenever this is set, because a scalpel that is not
    // named as one gets read as a census.
    if (applied.payBasis === "hourly") q = q.eq("salary_period", "hour");
    else if (applied.payBasis === "salaried") q = q.in("salary_period", [...SALARIED_PERIODS]);
    // "Does not demand more than n years" — min_years <= n. Rows that never
    // stated a requirement are excluded by the comparison (NULL <= n is not
    // true), honestly rather than guessed: a posting that named no requirement
    // cannot be shown to satisfy one. Note 0 IS a stated requirement and passes
    // every ceiling, which is the correct reading for a job-seeker.
    if (applied.maxYears !== null) q = q.lte("min_years", applied.maxYears);
    // Department as its OWN predicate. It has always been reachable through the
    // free-text `q` above — which ORs it with title and company — so asking for
    // the Legal department also returned every Legal Assistant and every
    // company with Legal in its name, with nothing in the response saying which
    // matched. Wildcards were stripped in normalizeFilters, so the `%` either
    // side are ours.
    if (applied.department) q = q.ilike("department", `%${applied.department}%`);
    // Hiring-system filter. ANDs with the sendableOnly .in() above rather than
    // replacing it — two .in()s on one column intersect, so {sendableOnly:true,
    // vendor:"breezy,greenhouse"} is breezy alone, which is the honest reading
    // of both requests at once and not a widening of either.
    if (applied.vendors.length) q = q.in("source", applied.vendors);
    if (applied.companies.length) q = q.in("company_token", applied.companies);
    // Rationale: docs/job-board-index-notes.md#n305-applied-excludeagencies-q-q-eq-agenc
    if (applied.excludeAgencies) q = q.eq("agency", false);
    // Rationale: docs/job-board-index-notes.md#n306-applied-postedafter-q-q-gt-posted-at
    if (applied.postedAfter) q = q.gt("posted_at", applied.postedAfter);
    // "Posted this week" quick filter: company-stated dates ONLY (posted_at,
    // never first_seen — our discovery time can't make a posting fresh).
    // Undated postings are excluded by the filter, honestly; the UI says so.
    if (applied.maxAgeDays !== null) {
      q = q.gte("posted_at", new Date(Date.now() - applied.maxAgeDays * 86_400_000).toISOString());
    }
    return q;
  };
  const missingColumn = (e: { message?: string } | null) => !!e?.message?.includes("effective_posted");

  // Capped count: stops at COUNT_CAP+1 rows, so cost is bounded by the cap
  // instead of by how many rows match. Replaces the exact count that was
  // costing 3-9s on broad filters (page itself: ~0.3s) and exceeding the
  // statement timeout outright between roughly 150k and 190k matches.
  // Returns null when the RPC isn't available (migration not applied), which
  // leaves the existing exact-count path in charge.
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
        p_posted_after: applied.postedAfter,
        p_max_age_days: applied.maxAgeDays,
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
      // Rationale: docs/job-board-index-notes.md#n310-applied-hasstatedpay-row-capped-t
      if (applied.hasStatedPay && row.capped !== true) return null;
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

  if (body.facetCounts === true) {
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
      // Rationale: docs/job-board-index-notes.md#n315-facetq
      const facetQ = queryTerms(body.q).terms;
      const facetUseRpc = qText && facetQ.length <= 1;
      // Rationale: docs/job-board-index-notes.md#n316-facetpaywindow
      const facetPayWindow = applied.hasStatedPay === true;
      const chunkWork = Promise.all(chunk.map(async (c) => {
        try {
          if (facetUseRpc && facetPayWindow) return [c, null, false] as const;
          if (facetUseRpc) {
            // Rationale: docs/job-board-index-notes.md#n317-t-count-jobs-capped-5
            const t_count_jobs_capped_5 = Date.now();
            const { data, error } = await client.rpc("count_jobs_capped", {
              p_fresh_cutoff: freshCutoffIso,
              // count_jobs_capped is a contiguous ILIKE, which already reads a
              // phrase as adjacent words; the quotes are tsquery syntax and
              // would be matched as literal characters here. Same text as
              // facetQ[0] for a one-term query — the branch this gate admits.
              p_q: qText.replace(/"/g, ""),
              ...(applied.location ? { p_location: rankedLocationParam(applied.location) } : {}),
              ...(applied.remote ? { p_remote: true } : {}),
              ...(applied.country ? { p_country: applied.country } : {}),
              p_category: c,
              ...sendableSourcesParam(applied),
              ...(applied.experience.length ? { p_experience: applied.experience } : {}),
              ...(applied.salaryFloor !== null ? { p_salary_floor: applied.salaryFloor } : {}),
              ...(applied.companies.length ? { p_companies: applied.companies } : {}),
              p_posted_after: applied.postedAfter,
              p_max_age_days: applied.maxAgeDays,
              ...payParams(applied),
              ...extraFilterParams(applied),
              ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
              ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
              ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
              p_cap: COUNT_CAP,
            });
            markFrom("count_jobs_capped_settle", t_count_jobs_capped_5);
            if (error) return [c, null, false] as const;
            const row = Array.isArray(data) ? data[0] as { n?: number; capped?: boolean } : null;
            return [c, Number(row?.n ?? 0), !!row?.capped] as const;
          }
          const r = await buildQuery("effective_posted", true, c).range(0, 0);
          if (r.error) return [c, null, false] as const;
          // Capped to the SAME ceiling the list uses, so the two numbers on
          // screen are the same kind of number.
          const n = r.count ?? 0;
          return [c, Math.min(n, COUNT_CAP), n > COUNT_CAP] as const;
        } catch {
          return [c, null, false] as const;
        }
      }));
      // withDeadline resolves { data: null } on a miss, not null — the shape
      // its other callers destructure. Anything that is not the array we
      // awaited means the budget won, and the chunk's categories go unnumbered.
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
      // Which matcher produced these. With a query they come from the same
      // count the list uses; without one, from the filter query directly.
      facetSource: qText ? "ranked" : "filters",
      // Says which filters these counts are FOR, so a stale response arriving
      // after the visitor changed a filter can be discarded rather than
      // painted over the new selection.
      appliedSignature: JSON.stringify(applied),
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
    });
  }

  // Rationale: docs/job-board-index-notes.md#n318-qclass
  const qClass = qText ? pickRoute(qText, EMPLOYER_ALIASES) : null;
  const qClassRetriever = qClass ? RETRIEVER_FOR[qClass.route] : null;
  const onlyQuery = isUnfiltered({ ...applied, q: "" });
  const routeDecision = qText && onlyQuery && qClass
    ? qClass
    : { route: "BROWSE" as const, reason: "not routable", tokens: undefined as string[] | undefined, matchedName: undefined as string | undefined };
  const routedRetriever = RETRIEVER_FOR[routeDecision.route];
  // ONE window constant for both the routed count and the routed list. Two
  // copies would drift, and the count would then say countUnavailable at a
  // different size than the list slices.
  const ROUTE_WINDOW = 400;
  // Rationale: docs/job-board-index-notes.md#n319-routedquerytokens
  const routedQueryTokens = qText.split(/\s+/).filter(Boolean).length;
  const ROUTED_DEADLINE_MS = routedQueryTokens >= 3 ? 2_500 : 7_000;

  if (countOnly) {
    // Rationale: docs/job-board-index-notes.md#n320-counthonesty
    const countHonesty = {
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(maxAgeClamped ? { maxAgeClampedTo: 30 } : {}),
      // Spread LAST in every count exit, so under an exclusion it overrides the
      // exit's own total — a count never sees the exclusion predicate (see
      // exclusionCountsCaveat), and a relaxation button quoting an unexcluded
      // number promises rows the click then hides.
      ...exclusionDisclosure(excludedTerms),
      ...exclusionCountsCaveat(excludedTerms),
    };
    if (!wantCount) return json({ total: safeMetaTotal, ...(safeMetaTotal === null ? { countUnavailable: true } : {}), ...countHonesty }); // unfiltered — the maintained catalog total, degraded to null when the cache is unreadable
    // Rationale: docs/job-board-index-notes.md#n321-qtext-body-sort-salary-rout
    if (qText && body.sort !== "salary" && (routedRetriever === "company" || routedRetriever === "simple")) {
      try {
        let rqC = buildQuery("effective_posted", false, undefined, { skipTerms: true });
        // THE SAME EXPANSION THE LIST BINDS, or the two answer different
        // questions: the routed list searches "k8s OR kubernetes" while this
        // count searched the literal token alone — a small exact number
        // published over a many-times-larger list, the one-body-two-answers
        // defect this block exists to prevent. Mirrors the routed list's
        // ternary exactly, including the ftsSafe/ftsQuery split.
        const rcExpand = routedRetriever === "company" ? { q: qText, expansions: [] as string[] } : expandQuery(qText);
        rqC = routedRetriever === "company" && routeDecision.tokens?.length
          ? rqC.in("company_token", routeDecision.tokens)
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
          // A full window is a FLOOR, and a floor is a fact even when the
          // total is not — the fuzzy tier's own contract, mirrored here so the
          // count answers exactly what the list's capped page answers.
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
        const { data: rc, error: ec } = await client.rpc("search_jobs", {
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
          p_posted_after: applied.postedAfter,
          p_max_age_days: applied.maxAgeDays,
          ...payParams(applied),
          ...extraFilterParams(applied),
          ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
        ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
        ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
          p_limit: 1,
          p_offset: 0,
        });
        markFrom("search_jobs", t_search_jobs_4);
        if (!ec && Array.isArray(rc)) {
          // Rationale: docs/job-board-index-notes.md#n324-trc
          const trC = Number((rc[0] as { total_rows?: number } | undefined)?.total_rows);
          const tC = rc.length ? (Number.isFinite(trC) ? trC : rc.length) : 0;
          // Rationale: docs/job-board-index-notes.md#n325-rrc
          const rrC = Number((rc[0] as { related_rows?: number | null } | undefined)?.related_rows);
          const relC = rc.length && Number.isFinite(rrC) ? rrC : null;
          const tier2C = (rc as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string");
          // The headline's ceiling is the title ceiling once the migration is
          // live, because the headline is now always the title count. The
          // tier-sniff branch is deploy-window cover only — delete it after the
          // SQL is verified.
          const cappedC = relC === null ? tC >= (tier2C ? 3_000 : 10_000) : tC >= 10_000;
          return json({
            total: tC,
            ...(cappedC ? { countCapped: true } : {}),
            // Omitted when the segment was not built, and omitted when it is
            // empty. An absent field is "we did not look"; a zero segment header
            // over an empty segment is noise.
            ...(relC === null || relC === 0
              ? {}
              : { relatedTotal: relC, ...(tC + relC >= 3_000 ? { relatedCapped: true } : {}) }),
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
    // Same rule as the list path: a count that can't be computed is reported as
    // unknown, never as 0. Callers (the disclosure hook, saved-search "new
    // since" badges) treat a non-number as "no answer" and show nothing, which
    // is right — a 0 here would claim the filter matches nothing.
    if (error) return json({ total: null, countUnavailable: true, ...countHonesty });
    return json({ total: count ?? 0, ...countHonesty });
  }

  // Rationale: docs/job-board-index-notes.md#n326-newestfirst
  const newestFirst = body.sort === "newest";
  // Score a relevance-ordered text search. Not when the reader asked for a
  // date or pay order — they chose that ordering and it is not ours to
  // override — and not on an empty query, which has nothing to score against.
  const scoreRanked = !newestFirst && body.sort !== "salary" && !countOnly;
  // The stuffing defect lives in short queries: one or two words, where a
  // title can repeat the term and outrank an exact match. Longer queries carry
  // enough signal that ts_rank finds the right rows on its own.
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
        // rpcBlind: filters search_jobs has no parameter for, which force the
        // buildQuery path — the single most common "why did my filter behave
        // oddly" cause.
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
  const salaryTextSort = !countOnly && !!qText && body.sort === "salary" && onlyQuery;

  if (salaryTextSort) try {
    const t_salary_sorted = Date.now();
    const { data: salRows, error: salErr } = await withDeadline(
      buildQuery("effective_posted", false, undefined, { skipTerms: true })
        .textSearch("title", ftsQuery(qText), { type: "websearch", config: "simple" })
        .not("salary_rank_usd", "is", null)
        .order("salary_rank_usd", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1),
      7_000,
    ) as { data: unknown[] | null; error?: unknown };
    markFrom("salary_sorted", t_salary_sorted);
    if (salRows === null) console.warn(`[JOB-BOARD] salary-sorted search hit its deadline for q=${JSON.stringify(qText)}`);
    if (!salErr && Array.isArray(salRows) && salRows.length > 0) {
      const salJobs = (salRows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
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
        hasMore: salJobs.length >= limit,
        nextOffset: offset + salGrouped.rawConsumed,
        searchRoute: "SALARY",
        searchRouteReason: "salary-sorted text search, ordered on the indexed pay column",
        // Said out loud: this page deliberately shows only postings that state
        // pay, which is about an eighth of the board.
        salaryStatedOnly: true,
        // The SERVABLE board-wide count — the same figure `total` publishes.
        // meta.v.total is the pre-sweep refresh counter: it still holds
        // missing_since-stamped and aged-out rows, and measured 615,366 against
        // a table of 606,295 and a servable set of 601,760. A board-wide number
        // larger than the table it describes cannot be true.
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
  } catch { /* fall through to the substring path this query used before */ }

  // Rationale: docs/job-board-index-notes.md#n333-newesttextsort
  const newestTextSort = !countOnly && !!qText && newestFirst
    && qClassRetriever !== "company" && qClass?.route !== "SYMBOL";

  if (newestTextSort) try {
    const t_newest_sorted = Date.now();
    const newestExpand = expandQuery(qText);
    const { data: newRows, error: newErr } = await withDeadline(
      buildQuery("effective_posted", false, undefined, { skipTerms: true })
        .textSearch(
          "title",
          newestExpand.expansions.length ? ftsSafe(newestExpand.q) : ftsQuery(qText),
          { type: "websearch", config: "simple" },
        )
        // posted_at with NULLS LAST, not effective_posted: an undated posting
        // takes our crawl stamp there, and 57 of 60 rows on the old browse sort
        // were undated rows claiming to be the newest thing on the board. The
        // FRESHNESS WINDOW stays on effective_posted (buildQuery's dateCol), so
        // an undated posting is still served — it just cannot lead a page
        // labelled with the employer's own date.
        .order("posted_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        // fetchLimit, not limit: clustering folds same-role rows, and a page
        // that reads only `limit` raw rows hands back 3 cards for 60 rows read.
        // rawConsumed below is what advances the offset, so nothing is skipped.
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
  const routedServesThisOrder = routedRetriever === "company" || !newestFirst;
  if (!countOnly && routedServesThisOrder && (routedRetriever === "company" || routedRetriever === "simple")) try {
    // Rationale: docs/job-board-index-notes.md#n339-blockstart
    const blockStart = Math.floor(offset / ROUTE_WINDOW) * ROUTE_WINDOW;
    const routedExpand = routedRetriever === "company" ? { q: qText, expansions: [] as string[] } : expandQuery(qText);
    let rq = buildQuery("effective_posted", false, undefined, { skipTerms: true });
    rq = routedRetriever === "company" && routeDecision.tokens?.length
      ? rq.in("company_token", routeDecision.tokens)
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
      // Shape-sized (see ROUTED_DEADLINE_MS) and clamped to the request
      // budget, like every sibling on the serving path — a bare deadline here
      // sums with the entire fall-through pipeline behind it.
      Math.min(ROUTED_DEADLINE_MS, budgetLeft()),
    ) as { data: unknown[] | null; error?: unknown };
    markFrom("routed_retriever", t_routed_retriever);
    if (routedRows === null) {
      console.warn(`[JOB-BOARD] routed retrieval (${routeDecision.route}) hit its deadline for q=${JSON.stringify(qText)}`);
    }
    if (!rErr && Array.isArray(routedRows) && routedRows.length > 0) {
      const mapped = (routedRows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
      // An EMPLOYER page is already exactly that employer's jobs, so scoring it
      // by title similarity would demote roles for not repeating the company
      // name. Recency is the honest order there; every other route is scored.
      // Scored against the typed query AND every alias it was expanded to —
      // otherwise the rows the expansion just fetched are sorted below the ones
      // that literally spell the abbreviation, and the widening is invisible.
      const orderReadings = [qText, ...routedExpand.expansions];
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
          // A REAL count whenever the window came back short of the cap, because
          // then the window IS the result set. At the cap it is only a floor, and
          // saying "unavailable" beats publishing a window size as a total —
          // the defect the fuzzy tier still carries.
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
          // THE PAGE WAS APOLOGISING FOR WORK IT HAD DONE.
          // `ordered` above is rerankWindow(mapped, qText) for every non-company
          // route — these rows ARE relevance-sorted. Omitting `ranked` made the
          // client fall to "Sorted by newest first (relevance ranking briefly
          // unavailable)" on every short query: rn, swe, qa, pm, sde. A false
          // apology is still a false statement about what the board did.
          ...(routedRetriever === "company" ? {} : { ranked: true }),
          // Rationale: docs/job-board-index-notes.md#n343-newestfirst-routedretriever-company
          ...(newestFirst && routedRetriever === "company"
            ? { sortScope: "matchSet", sortMatcher: "company" }
            : {}),
          // Say which alias phrases were also searched, exactly as the ranked
          // path does. Emitted only when an expansion actually bound, so the
          // line can never claim a phrase the query did not look for.
          ...(routedExpand.expansions.length ? { aliases: routedExpand.expansions } : {}),
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

  // Surfaced on the response so a fallback is observable from outside without
  // shell access to the function logs — the same reason `status` echoes the
  // deployed bundle. Null on every healthy ranked search.
  let rankedFellBack: string | null = null;
  // Rationale: docs/job-board-index-notes.md#n344-semanticdegraded
  let semanticDegraded: "embed" | "ann_deadline" | "ann_error" | "refilter_deadline" | null = null;
  // Rationale: docs/job-board-index-notes.md#n345-facet-company-limit
  const FACET_COMPANY_LIMIT = 150;
  // Rationale: docs/job-board-index-notes.md#n346-facetopen
  const facetOpen = (metaV as { companiesOpen?: Record<string, number> }).companiesOpen;
  const facetOpenMap = facetOpen && typeof facetOpen === "object" ? facetOpen : null;
  function facetHead(list: Array<{ token?: string; name?: string; count?: number; open?: number; tokens?: string[] }>) {
    // The head row already folds `open` into its 200 entries; the fat-row
    // fallback carries the whole map instead, so fill from it when the entry
    // has none of its own. Neither present means neither measured.
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
      // Role-alias expansion (disclosed): "swe" also searches "software
      // engineer" etc. The expanded websearch string keeps the original
      // spelling as its own OR-branch, and the response names every added
      // phrase so the UI can show "also matching: …".
      const { q: expandedQ, expansions } = expandQuery(qText);

      // Rationale: docs/job-board-index-notes.md#n348-headringp
      const headRingP: Promise<{ data: unknown[] | null }> | null =
        (scoreRanked && headTermRing && (!deepPage || ringMerged))
          ? (withDeadline(
              buildQuery("effective_posted", false, undefined, { skipTerms: true })
                .ilike("title", `${sanitizeTerm(qText)}%`)
                .order("effective_posted", { ascending: false })
                .order("id", { ascending: true })
                .range(0, 199),
              Math.min(4_000, budgetLeft()),
            ) as Promise<{ data: unknown[] | null }>)
              .catch(() => ({ data: null }))
          : null;
      const t_head_ring_started = Date.now();

      const t_search_jobs_3 = Date.now();
      const { data: ranked, error: rankErr } = await client.rpc("search_jobs", {
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
        p_posted_after: applied.postedAfter,
        p_max_age_days: applied.maxAgeDays,
        ...payParams(applied),
        ...extraFilterParams(applied),
        // Rationale: docs/job-board-index-notes.md#n349-applied-workmode-p-work-mode-applied-wo
        ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
        ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
        ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
        // Rationale: docs/job-board-index-notes.md#n350-p-limit-pageplan-plimit
        p_limit: pagePlan.pLimit,
        p_offset: pagePlan.pOffset,
      });
      markFrom("search_jobs", t_search_jobs_3);
      // A RETURNED ERROR WAS CHECKED AND THROWN AWAY. `rankErr` gated the happy
      // path and was never read again, so a ranked search that TIMED OUT looked
      // exactly like one that was never attempted: rankedFellBack stayed null,
      // nothing was logged, and the request quietly served the recency page.
      // The catch below already reports thrown failures this way; a RESOLVED
      // error is the more common shape and had no reporting at all.
      if (rankErr) {
        rankedFellBack = (rankErr.code ? `${rankErr.code}: ` : "") +
          String(rankErr.message ?? rankErr).slice(0, 160);
        console.error(`[JOB-BOARD] ranked search failed for q=${JSON.stringify(qText)}: ${rankedFellBack}`);
      }
      if (!rankErr && Array.isArray(ranked)) {
        // A load-more just past an exactly-full final page must not overwrite
        // the client's header with 0 — null is "count unavailable", which the
        // client already renders honestly (2026-07-25 audit: a 180-match
        // search flipped to "0 matching" above 180 visible results).
        // Finiteness, not truthiness — see the note on the countOnly probe
        // above. A real zero must survive; only an absent total falls back.
        const trR = Number((ranked[0] as { total_rows?: number } | undefined)?.total_rows);
        const total = ranked.length ? (Number.isFinite(trR) ? trR : ranked.length) : (offset > 0 ? null : 0);
        // THE SECOND SEGMENT. `total` above is now the EXACT (title) count on
        // every path; this is the description-only count beside it. NULL is
        // load-bearing three ways and none of them is zero: the title tier did
        // not build the segment, the migration has not applied yet, or the count
        // was not computed. Finiteness, not truthiness — a real zero must
        // survive, same reason as the line above it.
        const rrR = Number((ranked[0] as { related_rows?: number | null } | undefined)?.related_rows);
        const related = ranked.length && Number.isFinite(rrR) ? rrR : null;
        // THE PAGINATION FIGURE, WHICH IS NOT THE PUBLISHED FIGURE. Every
        // arithmetic use below — has-more, the augmentation gate — asks "how many
        // rows can this query reach", and the answer is both segments. Only the
        // HEADLINE is the exact count. Conflating the two is how a page of 39
        // related rows would report itself finished at row zero.
        const pageTotal = total === null ? null : total + (related ?? 0);
        // Rationale: docs/job-board-index-notes.md#n351-rankedtier2
        const rankedTier2 = (ranked as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string");
        const rankedCapped = related === null
          ? (total ?? 0) >= (rankedTier2 ? 3_000 : 10_000)
          : (total ?? 0) >= 10_000;
        // The related segment reads the newest 3,000 description matches, so a
        // related count that fills what is left of that window is a FLOOR, not a
        // total, and has to say so.
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
            // withDeadline is Promise.race and resolves { data: null }, which is
            // indistinguishable from "the filters removed everything". A tier
            // that degrades silently is the bug this codebase keeps finding.
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
              !exclude.keys.has(clusterKey(String(r.company ?? ""), String(r.title ?? ""))));
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
          p_posted_after: applied.postedAfter,
          p_max_age_days: applied.maxAgeDays,
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
              // Letters, spaces and the punctuation real place names carry.
              // A tail with digits or symbols is not a city and probing it is
              // a wasted round trip.
              if (!/^[\p{L}][\p{L}\s.'-]*$/u.test(place)) continue;
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
                    p_posted_after: applied.postedAfter,
                    p_max_age_days: applied.maxAgeDays,
                    ...payParams(applied),
                    ...extraFilterParams(applied),
                    ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
        ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
        ...(applied.excludeAgencies ? { p_exclude_agencies: true } : {}),
                    p_limit: Math.max(limit * 2, 40),
                    p_offset: 0,
                  }),
                  // Half the exact-word tier's budget. This is a bonus on a page
                  // that already has rows to serve, so it must never be the
                  // reason a response is slow — if it does not finish, the
                  // description-only page below stands.
                  Math.min(3_500, budgetLeft()),
                ) as Promise<{ data: unknown[] | null }>)
                  .catch(() => ({ data: null }))
              ));
              markFrom("location_split", t_location_split);
              // LONGEST SPLIT FIRST, and the acceptance test is TITLE matches —
              // total_rows, not row count. A head with only description matches
              // inside the location is the same guessing this tier exists to
              // replace, so it is not an improvement and is not taken.
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
                // Exclusions pruned HERE, before the gate and the collapse —
                // not left to attachRecheckedAt. Pruning after the
                // jobs.length>0 gate let a split whose page was entirely
                // excluded ship jobs:[] under total: won.hits ("Showing 0 of
                // 40") with hasMore:false. attachRecheckedAt still re-filters
                // idempotently, so the one spelling of the rule still holds.
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
                    ...intentDisclosure(intentLift),
                    ...exclusionDisclosure(excludedTerms),
                    ...coverageDisclosure(applied, meta),
                    ...honesty(splitGrouped.jobs),
                    // A GUESS THE READER CAN SEE AND UNDO. The board changed
                    // what was asked, so it says so in the same shape
                    // intentFilters and excludedTerms already use — the rule
                    // being that a filter nobody can see is a filter nobody can
                    // remove.
                    locationSplit: { q: won.head, location: won.place },
                    ranked: true,
                    // The title count for the SPLIT query, which is the query
                    // these rows answer. Publishing the original query's zero
                    // beside a full page is the contradiction this whole tier
                    // is here to end.
                    total: won.hits,
                    ...(won.hits >= 10_000 ? { countCapped: true } : {}),
                    // ONE PAGE, HONESTLY. This tier fires only at offset 0, so a
                    // pager following nextOffset would be answered by the
                    // ORIGINAL query's ranked path — a different row set wearing
                    // page two's clothing. Same contract as the exact-word tier:
                    // no second page rather than an incoherent one. The searcher
                    // who wants more can accept the split the disclosure offers.
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
            if (!missQ0 && !missLoc0) return;
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
            // NOTE: withDeadline is Promise.race — on timeout it resolves
            // { data: null } and the SQL KEEPS RUNNING server-side. That is why
            // the window is bounded to limit*2 rows and why this only fires on
            // an already-empty page: an abandoned query still costs the
            // database, so it must be small and rare.
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
                // A failure on EITHER side is survivable — the other still
                // answers. The company index may not exist yet, and a tier that
                // dies entirely because half of it is unindexed would be worse
                // than the empty page it replaces.
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
            // A deadline miss now leaves a trace. withDeadline resolves
            // { data: null }, which is indistinguishable from "no matches" —
            // and a tier that silently degrades is exactly the failure this
            // codebase keeps rediscovering. The warning is the only way to tell
            // "the exact-word tier found nothing" from "it never finished".
            if (simpleRows === null) {
              console.warn(`[JOB-BOARD] exact-word tier exceeded its deadline for q=${JSON.stringify(qText)}`);
            }
            if (!sErr2 && Array.isArray(simpleRows) && simpleRows.length > 0) {
              // Title first, then company, then dedupe by id — concatenating two
              // result sets means a posting matching BOTH appears twice, and the
              // ordering above is per-query so the merged list is not sorted as
              // a whole. Title leads because a role in the title is what the
              // searcher asked for; the employer match is the fallback that
              // makes "AT&T" reach AT&T.
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
                // No total: this tier reads a bounded window, so any figure it
                // could publish would be the window size wearing a total's
                // clothing — the defect the fuzzy tier already carries.
                total: null,
                countUnavailable: true,
                hasMore: false,
                // A position that EXISTS. This was 0, which points a pager
                // following nextOffset back to the top of the feed — measured
                // live on 4 of 6 misspelled queries, each returning a full page
                // alongside it. The web client happens to be saved by its
                // hasMore gate; an API consumer paging on nextOffset loops.
                nextOffset: offset + simpleGrouped.jobs.length,
                // Named so the client can say WHY these matched, and so the
                // tier is visible in telemetry rather than being mistaken for
                // the ranked path.
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
            // Bounded like every sibling on this ladder (simple_config, embed,
            // semantic, head_ring all clamp to budgetLeft). This tier sits
            // AFTER the exact-word tier's measured 7s, and unbounded deadlines
            // SUM — the exact failure REQUEST_BUDGET_MS was introduced to cap.
            // A miss resolves {data:null}; Array.isArray already treats that as
            // "no rescue rows" and the honest empty page below stands.
            const { data: fuzzy, error: fErr } = await withDeadline(
              client.rpc("fuzzy_title_search", {
                p_q: qText, p_fresh_cutoff: freshCutoffIso, p_limit: limit,
                ...rescueFilterParams(),
              }),
              Math.min(4_000, budgetLeft()),
            ) as { data: unknown[] | null; error?: unknown };
            markFrom("fuzzy_title_search", t_fuzzy_title_search_2);
            // A resolved, error-free empty answer is a finding: no title on
            // the board is even trigram-NEAR the query. A deadline miss
            // resolves {data:null} and proves nothing.
            if (!fErr && Array.isArray(fuzzy)) fuzzyTierProvedEmpty = fuzzy.length === 0;
            if (!fErr && Array.isArray(fuzzy) && fuzzy.length > 0) {
              // Same-company+title clones flood trigram results exactly like
              // the other tiers — collapse them the same way (audit: adjacent
              // duplicate cards were measured on typo queries).
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
                // A position that EXISTS. This was 0, which points a pager
                // following nextOffset back to the top of the feed — measured
                // live on 4 of 6 misspelled queries, each returning a full page
                // alongside it. The web client happens to be saved by its
                // hasMore gate; an API consumer paging on nextOffset loops.
                nextOffset: offset + fuzzyGrouped.jobs.length,
                total: fzKnown ? fzTotal : null,
                // A FLOOR IS A FACT EVEN WHEN THE TOTAL IS NOT. total_rows at
                // the cap proves "at least this many match" — measured live,
                // 3 of 5 typo queries rendered no denominator at all while
                // the RPC had proven one. totalAtLeast is never a total and
                // countUnavailable still says so; the client renders "N+".
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
                // Board-wide, from the cached facet row — CORRECT only on the unfiltered
          // view. Rendered inside a filtered view it overstated by 15.7x to 45x
          // (sum 587,793 shown beside a filtered total of 10,000 or less), which
          // is a wrong number on every filtered session. Omit rather than
          // mislead: the UI already handles an absent facet, and a count we
          // cannot scope to the query is a count we should not publish.
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
              // Retrieval is the shared helper above; this block owns only what
              // an EMPTY page should answer with. fetchLimit because a rescue
              // that fires on nothing may as well fill the page.
              const semSource = await semanticRows(fetchLimit, 2_500);
                if (semSource.length > 0) {
                  // Same-role-many-locations clones are mutually nearest in
                  // embedding space, so the top-k is especially prone to being
                  // one job repeated — collapse exactly like the other tiers.
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
                    // Present even though hasMore is false: a client that pages
                    // on nextOffset rather than hasMore would otherwise read
                    // undefined and restart at the top of the feed.
                    nextOffset: offset + semGrouped.jobs.length,
                    ...exclusionCountsCaveat(excludedTerms),
                    totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                    companies: [],
                    companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
                    ...(typeof v0.companiesOpenCount === "number" ? { companiesOpenCount: v0.companiesOpenCount } : {}),
                    // Board-wide, from the cached facet row — CORRECT only on the unfiltered
          // view. Rendered inside a filtered view it overstated by 15.7x to 45x
          // (sum 587,793 shown beside a filtered total of 10,000 or less), which
          // is a wrong number on every filtered session. Omit rather than
          // mislead: the UI already handles an absent facet, and a count we
          // cannot scope to the query is a count we should not publish.
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
            // Started before search_jobs — see the comment there. By the time we
            // get here it has usually already resolved, so this await is free.
            // markFrom still measures from when the query was ISSUED, not from
            // here, or the phase record would report ~0ms for a real round trip
            // and hide the cost it exists to expose.
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
        // Deduped by id, prefix first. If the ring fails the page degrades to
        // exactly today's ranked result rather than to something incoherent —
        // which is the difference between this and the multi-arm fusion three
        // judges rejected.
        const mergedSeen = new Set<string>();
        let mergedRows: Array<Record<string, unknown>>;
        // Ring-merged DEEP page: the ring is an EXCLUSION set, not a merge.
        // Every ring row is served below the RING_WINDOW seam, so a deep page
        // that kept them would re-serve page-one cards as apparent new results
        // — the measured seam-duplicate defect. Dropped rows still occupied
        // SQL ranks, so nextOffset must advance by RAW rows consumed, dropped
        // ones included; this maps "survivors consumed" back to that number.
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
              : ringPrefix.length > 0 && String(r.title ?? "").toLowerCase().startsWith(ringPrefix);
          const rawIndexOfSurvivor: number[] = [];
          mergedRows = rankedRows.filter((r, i) => {
            const keep = !excluded(r as Record<string, unknown>);
            if (keep) rawIndexOfSurvivor.push(i);
            return keep;
          });
          deepRingRawUsed = (n) =>
            // Consumed nothing with survivors available: the walk has not
            // advanced. Consumed everything (or the fetch was all ring rows):
            // skip past the whole raw fetch — trailing dropped rows must not
            // be re-fetched just to be dropped again.
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
            // Captured for the earned did-you-mean below: the derivation reads
            // THESE rows instead of paying a second identical RPC (a review
            // caught the duplicate call, and with it the class mismatch — this
            // block's own pageTotal gate IS the thin-page contract the
            // suggestion claims).
            if (!fzErr && Array.isArray(fz)) fuzzyTitlesForDym = (fz as Array<{ title?: unknown }>).map((r) => String(r.title ?? ""));
            if (!fzErr && Array.isArray(fz) && fz.length > 0) {
              // Dedupe by CLUSTER, not by id. An id-only check let a fuzzy row
              // that is a collapsed sibling of an exact match through (different
              // id, same company+title), re-showing a job the grouped card above
              // already represents — and the appended rows themselves were never
              // collapsed, so one role reposted per location could fill the page
              // with near-identical closeMatch cards.
              const haveKeys = new Set(rankedGrouped.jobs.map((j) => {
                const r = j as Record<string, unknown>;
                return clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""));
              }));
              const fuzzyRows = (fz as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              const room = Math.max(0, limit - rankedGrouped.jobs.length);
              // Excluded titles pruned BEFORE the extras are counted, or the
              // fuzzyExtra banner claims close matches attachRecheckedAt then
              // deletes — "10 close-match titles below" over 6 surviving cards.
              const novel = fuzzyRows.filter((r) =>
                !haveKeys.has(clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""))) &&
                !(excludedTerms.length && titleExcluded(String(r.title ?? ""), excludedTerms)));
              const extra = (groupSimilar ? collapseClusters(novel, room).jobs : novel.slice(0, room))
                .map((j) => ({ ...(j as Record<string, unknown>), closeMatch: true }));
              if (extra.length > 0) {
                // Rationale: docs/job-board-index-notes.md#n383-terms
                const terms = queryTerms(qText).terms.map((t) => t.toLowerCase()).filter(Boolean);
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
          // Same !newestFirst as the fuzzy augment above: appending
          // meaning-matches to page one of a date walk inserts undated rows
          // mid-sequence — page two continues in dates the extras never had.
          offset === 0 && !countOnly && !newestFirst && qText.length >= 3 &&
          rankedGrouped.jobs.length < limit && budgetLeft() > 3_000
        ) {
          try {
            const room = Math.max(0, limit - rankedGrouped.jobs.length);
            // The exclusion set goes IN, so the helper anchors on what survives
            // it. Filtering the result afterwards is what let a page of
            // unanchored rows ship under an anchored claim.
            const haveIds = new Set(rankedGrouped.jobs.map((j) => String((j as Record<string, unknown>).id ?? "")));
            const haveKeys2 = new Set(rankedGrouped.jobs.map((j) =>
              clusterKey(String((j as Record<string, unknown>).company ?? ""), String((j as Record<string, unknown>).title ?? ""))));
            const semSource = await semanticRows(Math.min(room * 3, 60), 1_500, { ids: haveIds, keys: haveKeys2 });
            if (semSource.length > 0) {
              // Same pre-count prune as the fuzzy extras above: the
              // semanticExtra count must describe rows that survive the
              // exclusion filter, not rows it is about to delete.
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
        // `total` counts EXACT matches, and the page now holds exact + close +
        // meaning. Rather than inventing a combined number — they are not the
        // same kind of match and adding them would assert they are — the page
        // reports that it has no single honest total, exactly as it already
        // does for the close matches.
        const augmented = fuzzyExtraOut !== null || semanticExtraOut !== null;
        // The count and the retriever do not always share a predicate — see
        // the note on `total` below. Computed once here so every field in this
        // response argues from the same row count.
        const shownRowCount = rankedGrouped.jobs.length;
        const totalUnderstated = !augmented && typeof total === "number" && (offset + shownRowCount) > total;
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
                // Consistency bar: the correction must appear across the pool,
                // not in one lucky title — and must outweigh the typo's own
                // corroboration by 3x.
                const support = titleWords.filter((ws) => ws.has(w)).length;
                if (support >= 3 && support >= tokSupport * 3) {
                  // Word-boundary, not substring: replace("art", ...) on
                  // "cart art designer" corrupts "cart" first. \p{L} tokens
                  // are regex-safe by construction.
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
        logSearch("ranked", rankedGrouped.jobs.length, augmented ? null : total, null, rankedServed);
        return json({
          jobs: rankedServed,
          searchId,
          ...searchDisclosures(body, applied, maxAgeClamped),
          ...(earnedDym ? { didYouMean: earnedDym } : {}),
          ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
          ...coverageDisclosure(applied, meta),
          ...honesty(rankedGrouped.jobs),
          ...(augmented ? { countUnavailable: true } : {}),
          // Rationale: docs/job-board-index-notes.md#n388-newestfirst
          ...(newestFirst
            ? { sortScope: "relevanceWindow", sortScopeRows: ringMerged ? RING_WINDOW : RANKED_WINDOW }
            : {}),
          // A ring-merged page that exhausts its pool hands the walk to the SQL
          // regime at the FIXED seam — offset+rawConsumed is a pool position,
          // and the deep regime would misread it as SQL rank (the hole half of
          // the seam defect: SQL ranks between the pool's end and the number it
          // happened to reach were skipped forever).
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
          total: augmented || totalUnderstated ? null : total,
          ...(totalUnderstated ? { countUnavailable: true, totalAtLeast: offset + shownRowCount } : {}),
          // Rationale: docs/job-board-index-notes.md#n391-augmented-totalunderstated-related
          ...(augmented || totalUnderstated || related === null || related === 0
            ? {}
            : { relatedTotal: related, ...(relatedCapped ? { relatedCapped: true } : {}) }),
          ...(rankedCapped ? { countCapped: true } : {}),
          ...exclusionCountsCaveat(excludedTerms),
          // Rationale: docs/job-board-index-notes.md#n392-augmented-totalunderstated-exclusi
          ...(augmented || totalUnderstated ? {} : exclusionCeiling(excludedTerms, total)),
          totalAllCompanies: safeMetaTotal ?? total,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
          companies: includeFacets0
            // Ordered by the SERVABLE count (facetHead already ranks on it and
            // the merge preserves that order); `count` is not on these rows —
            // see facetHead. Re-stated here so the ordering is visible at the
            // exit that publishes it.
            ? facetHead(fullCompanies0 as Array<{ token?: string; name?: string; count?: number; open?: number }>)
                .sort((a, b) => (b.open ?? 0) - (a.open ?? 0))
            : [],
          // NEVER the slice's length. The serving row is refresh_head now,
          // whose companiesFacet is deliberately truncated to 200 — deriving
          // the count from it published "200 companies" on the homepage the
          // first evening the head row qualified. The stored count first, the
          // length only for the fat-row fallback whose facet is complete.
          companiesCount: ((v0.companiesCount as number | undefined) ?? fullCompanies0.length),
          ...(typeof v0.companiesOpenCount === "number" ? { companiesOpenCount: v0.companiesOpenCount } : {}),
          // Board-wide, from the cached facet row — CORRECT only on the unfiltered
          // view. Rendered inside a filtered view it overstated by 15.7x to 45x
          // (sum 587,793 shown beside a filtered total of 10,000 or less), which
          // is a wrong number on every filtered session. Omit rather than
          // mislead: the UI already handles an absent facet, and a count we
          // cannot scope to the query is a count we should not publish.
          categories: visibleCategories(v0.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
          failedSources: (v0.failedSources as string[]) ?? [],
          failedCount: (v0.failedCount as number | undefined) ?? 0,
          refreshedAt: (v0.refreshedAt as string) ?? null,
          ranked: true,
          // Spread only when set, exactly like rankedFellBack: null on every
          // healthy search, so its mere presence is the signal. This is the exit
          // a silently-failed rescue actually lands on.
          ...(semanticDegraded ? { semanticDegraded } : {}),
          ...(expansions.length ? { aliases: expansions } : {}),
          ...(fuzzyExtraOut ? { fuzzyExtra: fuzzyExtraOut } : {}),
          // Named separately from fuzzyExtra because they are different claims:
          // a close match is "you may have misspelled this", a meaning match is
          // "nothing else matched, these are about the same thing". Passing the
          // second off as the first would be the tier lying about its evidence.
          ...(semanticExtraOut ? { semanticExtra: semanticExtraOut } : {}),
        });
      }
    } catch (e) {
      // NOT SILENT ANY MORE. This catch is correct — a broken ranked path must
      // still serve the reader from the recency path — but for as long as it
      // said nothing, a total ranked-search outage was indistinguishable from
      // "that query genuinely has no matches". It hid a ReferenceError for an
      // unknown number of days. The fallback stays; the silence does not.
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
    // The chosen category's exact size decides where this page crosses into the
    // bucket. EXACT, never estimated: an approximate pivot skips or repeats
    // rows at the boundary, which reads as the board simply not having a job.
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

    // The total is A + B. Only computed when a count was asked for, and a
    // failure degrades to null — the client already renders "Showing N" without
    // a denominator rather than a wrong one.
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
  // Hoisted out of the Promise.all below rather than nested inside it. A nested
  // array literal there also breaks the guard that checks every destructured
  // Promise.all binds every promise it awaits — and that guard exists because
  // an unnamed entry silently re-labels every value after it.
  const racedCount: Promise<{ n: number; capped?: boolean } | null> = wantCount
    ? Promise.race([
      (cappedCount() as unknown as PromiseLike<{ n: number; capped?: boolean } | null>)
        .then((r) => ({ kind: "settled" as const, r })),
      new Promise<{ kind: "timeout" }>((res) => setTimeout(() => res({ kind: "timeout" }), COUNT_DEADLINE_MS)),
    ]).then((outcome) => {
      const r = outcome.kind === "settled" ? outcome.r : null;
      if (outcome.kind === "timeout") countTimedOut = true;
      // MARK THE RACE, NOT THE RPC. The mark inside cappedCount() keeps running
      // after this deadline is lost, because a race does not cancel. Recording
      // that settle time under the same name put up to 6.7s of phase against a
      // request that waited 1.5s.
      markFrom("count_jobs_capped", t_count_raced);
      return r && typeof (r as { n?: number }).n === "number" ? r as { n: number; capped?: boolean } : null;
    })
    : Promise.resolve(null);
  const [firstPage, cappedRes] = await Promise.all([
    pageWith("effective_posted", "salary_rank_usd", false),
    racedCount,
  ]);
  // Only fall back to the old inline exact count when the capped RPC ISN'T
  // THERE (migration not applied yet) — never because it was merely slow. A
  // count that could not be produced inside 1.5s is answered with "no count",
  // which the client already renders honestly as "Showing 60 of 60+", not by
  // going and fetching a slower one.
  const needInlineCount = wantCount && !cappedRes && !countTimedOut;
  if (countTimedOut) {
    // Not silent: a deadline that fires regularly is a signal about the
    // database, and the old code left it indistinguishable from a healthy
    // response except by tookMs.
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
    // Same path as the page above, count suppressed — a second hand-written
    // builder here is how the retry ends up filtering differently from the
    // query it is retrying.
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

  // Zero-result telemetry: a first-page search that found nothing is the
  // honest demand signal for what the catalog lacks. Logged fire-and-forget
  // into a service-role-only table (30-day retention) — never blocks the
  // response, and only when the user actually typed something.
  const missQ = String(body.q ?? "").slice(0, 120).trim();
  const missLoc = String(body.location ?? "").slice(0, 120).trim();
  // `count === 0`, never `count ?? 0`: null means the exact count timed out
  // (see the countUnavailable branch above), and calling that "zero results"
  // logged a catalog-gap miss for searches that served a full page —
  // poisoning the demand census the pool is steered by (bug sweep 2026-07-26).
  if (count === 0 && offset === 0 && (missQ || missLoc)) {
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

  // (Typo-tolerant fuzzy fallback lives in the ranked path above, where an
  // empty result is caught on the fast index-backed path — never here, since
  // reaching this point for a no-match term already means the recency
  // ILIKE-count is in play, which is exactly what times out.)

  const v = (meta?.v ?? {}) as Record<string, unknown>;
  // The company facet grows with the catalog (~60 bytes/company); refetches
  // that already hold it can opt out instead of re-downloading it per filter
  // change. Absent/true keeps the old contract for deployed frontends.
  const includeFacets = (body as { includeFacets?: boolean }).includeFacets !== false;
  // At the scaled-up pool (~8.7k companies) the full facet is ~500KB per list
  // response and thousands of dropdown nodes — serve the top slice by count and
  // report the full number separately so stat displays stay exact. The facets
  // RPC (used by prerender/SEO) still returns the complete set.
  const fullCompanies = (v.companiesFacet as Array<{ count?: number }>) ?? [];
  const servedCompanies = includeFacets
    // Ordered by the SERVABLE count — see facetHead; `count` never reaches
    // these rows.
    ? facetHead(fullCompanies as Array<{ token?: string; name?: string; count?: number; open?: number }>)
        .sort((a, b) => (b.open ?? 0) - (a.open ?? 0))
    : [];
  const mappedRows = (data ?? []).map(rowToJob) as Array<Record<string, unknown>>;
  // The raw, in-order rows the collapse walked. After a top-up this spans BOTH
  // fetches, and it is what nextOffset and nextCursor must be derived from —
  // reading them off the first fetch alone would send the next page back over
  // rows this one already served.
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
          // rawConsumed must stay in the ORIGINAL row space for nextOffset to
          // mean anything, so it is capped at what the first fetch held plus
          // however far into the top-up the collapse actually reached.
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
    // Raw rows this page swallowed. The client MUST page by this rather than by
    // jobs.length once clusters are folded, or the siblings of a collapsed
    // result reappear on the next page as if they were new.
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
    // A full page means there is at least one more; the client needs this to
    // keep "load more" alive when it has no total to compare against.
    // Compared against fetchUsed, not fetchLimit: the two-subset path fetches
    // fewer rows by design, and measuring "was the page full?" against a size
    // it never requests answers no every time.
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
    // Gated like the other three. A board-wide facet printed beside a FILTERED
    // result set promises more jobs than the filter can deliver — "Engineering
    // 67,898" next to a country=GB page whose entire scope is 19,633. Today's fix
    // covered three of the four response sites and its commit message claimed
    // all of them; this is the fourth.
    categories: visibleCategories(v.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
    failedSources: (v.failedSources as string[]) ?? [],
    failedCount: (v.failedCount as number | undefined) ?? 0,
    refreshedAt: (v.refreshedAt as string) ?? null,
  });
}

