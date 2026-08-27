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
import { HOT_TOKENS, JOB_SOURCES, LIGHT_DESC_TOKENS, type JobSource } from "./sources.ts";
import { BOARD_DESC_SOURCES, buildEmbedInput, DETAIL_DESC_SOURCES, clusterKey, jobPostingLdDescription, workdayCxsUrl } from "./descriptions.ts";
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
  extractRipplingJobPosts,
  normalizeWorkday,
  normalizeOracle,
  detectCountry,
  type JobPosting,
} from "./normalize.ts";
import { categorize, CATEGORIZE_VERSION, JOB_CATEGORIES } from "./categories.ts";
import { computeFit, scanResume } from "../_shared/fit-score.ts";
import {
  POSTED_BACKFILL_VERSION,
  postedBackfillDue,
  backlogFromCoverage,
} from "../_shared/posted-backfill.ts";
import { extractSalary, parseSalaryStructured } from "../_shared/salary-extract.ts";
import { classifyDormancy, selectRetries, updateBoardFailures, type BoardFailureState } from "./dormancy.ts";
import { advanceProgress, isPassDone, type RefreshProgress } from "./rotation.ts";
import { CANARIES, rawItemCount, aggregateVendorHealth, type CanaryResult } from "./vendor-canary.ts";
import { detectExperience, isExperienceBand } from "./experience.ts";
import { categoryParam, extraFilterParams, filterViolations, isUnfiltered, normalizeFilters, payParams, rpcBlindFilters, rescueVendorsParam, SALARIED_PERIODS, sendableSourcesParam, splitPage, salaryFromQueryText, SALARY_IN_QUERY } from "./filters.ts";
import { pickRoute, rerankWindow, RETRIEVER_FOR, splitExclusions, titleExcluded } from "./search-routing.ts";
import { planRankedPage } from "./paging.ts";
import { collapseClusters, GROUP_OVERFETCH, interleaveByCompany, visibleCategories, mergeCompanyFacet } from "./clusters.ts";
import { EMPLOYER_ALIASES } from "./employer-aliases.ts";
import { expandQuery } from "./search-alias.ts";
import { classifyQuestion } from "../_shared/application-questions.ts";
import { parseBreezyQuestions, parsePinpointQuestions, breezyApplyUrl, pinpointApplyUrl } from "../_shared/vendor-questions.ts";
import { realQuestionVendors, SENDABLE_VENDORS } from "../_shared/apply-automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Deploy identity. BUMP THIS whenever you ship a code change you want to confirm
// went live — the `status` action echoes it straight from the DEPLOYED bundle, so
// "did my publish take?" is one call instead of hours of inferring it from posting
// counts. catalogSize (JOB_SOURCES.length) is the automatic companion signal: it
// moves with every catalog change with no discipline required. Sortable string so
// a future check can tell "prod is behind" from "prod is ahead".
// NOTE: a change to ../_shared/* alone does NOT get this function redeployed —
// the deploy only picks up functions whose OWN directory changed, so the stale
// bundle keeps its old copy of the shared module (confirmed twice, 2026-07-24:
// two classifier fixes in _shared/application-questions.ts never reached prod
// while this file was untouched). Always bump BUILD_VERSION here when a shared
// module this function imports changes — it forces the diff AND gives the
// deploy a verifiable tell.
//
// AND WHEN sources.ts CHANGES, which this comment used to omit and which cost
// us a day. 22 verified Pinpoint boards were merged on 2026-08-01 and reached
// the deployed catalog, then sat there invisible: the bootstrap lane that jumps
// brand-new boards ahead of the 28k cold rotation is KEYED ON BUILD_VERSION, so
// with the version unchanged it never recomputed and the new boards queued
// behind everything else. The catalog was right and the board was empty, which
// is the hardest kind of wrong to notice.
//
// src/test/build-version-guard.test.ts now fails if sources.ts changes without
// this constant changing, so the rule does not depend on anyone reading this.
// Sitemap pagination unit: one file per day of the 30-day freshness window.
// Matches the window the board itself serves, and keeps every page an indexed
// range scan rather than a deep OFFSET.
const SITEMAP_DAYS = 30;
const BUILD_VERSION = "2026-08-27.39"; // .39: the five blind filters (ceiling, basis, maxYears, department, vendors) ride the ranked path; .38: location-split tier

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

  // v3, added 2026-08-11. These surfaced only AFTER the Explore fixes landed:
  // "Transparent about pay" rendered for the first time and the size bands
  // re-cut on served counts, so cards that had never been visible came into
  // view carrying slug names. Fixing one instrument exposed the next.
  //
  // Every name below was verified against the employer's own board or careers
  // site rather than guessed. Two came back different from the obvious guess:
  //   alignmenthealthcare -> "Alignment Health", not "Alignment Healthcare".
  //     Healthcare is the SEC registrant; the board's own og:description and
  //     every posting body say Alignment Health.
  //   exactcare -> "AnewHealth", not ExactCare. The slug is the old subsidiary;
  //     the board is a shared career site for the merged organisation and every
  //     job page on it is titled "Careers at AnewHealth". Calling it ExactCare
  //     would attribute the whole board to one of its pharmacy brands.
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
// Refresh budget: a single edge invocation cannot afford the CPU of
// converting the whole corpus's HTML to text (WORKER_RESOURCE_LIMIT, seen
// live twice). So refresh is CURSOR-SLICED: each call processes one slice of
// boards and advances a cursor in job_board_meta; the 10-minute cron and
// read-triggered SWR calls walk the full list continuously. Facets swap in
// when a cycle completes; until then the previous complete cycle serves.
// Cold-slice concurrency: cold boards are SMALL feeds (the giants are all
// hot-tier, fetched at HOT_CONCURRENCY), so eight concurrent light fetches
// stay far from the memory ceiling that limits hot slices. Raised 4→8
// 2026-07-15: measured full-tail rotation had drifted to ~3h at 14.9k boards
// (9,014 boards >1h stale) while the public copy said "about an hour" —
// halving cold hop wall-time is the honest fix's first half; the second is
// measured, not aspirational, copy. Vendor interleaving bounds any single
// vendor to ~1 in-flight fetch per hop at this width.
const CONCURRENCY = 8;
const HOT_CONCURRENCY = 2; // hot boards are giants — two multi-MB parses at once is the memory ceiling
// desc-sweep: per-posting description backfill. 8 concurrent detail fetches
// matches CONCURRENCY for board fetches; 120/hop keeps a hop well inside the
// edge wall-time limit while still clearing ~406k rows in a few thousand hops.
const DESC_SWEEP_PER_HOP = 120;
// STORED DESCRIPTION CAP — raised 4,000 → 12,000 on 2026-08-24, measured
// first: 21/24 sampled at-cap postings were cut mid-content, and every tail
// over 1,000 chars held requirements/qualifications or salary figures (the
// greenhouse/lever pay-transparency block sits at the BOTTOM, so the old cap
// systematically amputated exactly what salary mining reads; one sampled
// range existed ONLY beyond char 4000). 12k captures 87.5% of postings
// whole; the residue beyond it was legal boilerplate in every observed
// case. ~120MB across the four worst vendors. The embed input slices to
// 1,200 chars on its own, so ranking is untouched. RAW_HTML_CAP bounds the
// per-item htmlToText cost and must stay ~2x the text cap or tag overhead
// re-truncates below it. Ingest, list-payload and backfill paths share
// these constants BECAUSE they must agree — two caps is how the 4,000
// number would creep back.
const STORED_DESC_CAP = 12_000;
const RAW_HTML_CAP = 24_000;
const DESC_SWEEP_CONCURRENCY = 8;
// structured-sweep: vendors whose PER-POSTING DETAIL states a work mode the
// list payload does not. Only Workday qualifies today — fetchVendorDetail
// reads its `remoteType` — and Workday is half the board, so this one entry is
// 306,186 postings whose work mode is otherwise text-inferred or absent.
//
// Not the same question as DETAIL_DESC_SOURCES. That list is "whose text needs
// a per-posting fetch"; this is "whose STRUCTURED fields do". A vendor belongs
// here only if fetchVendorDetail sets `workMode` for it, so adding one means
// writing that branch first — an entry without one would walk the vendor's
// whole corpus fetching details and filling nothing.
const STRUCTURED_SWEEP_SOURCES: readonly string[] = ["workday"];
// 24, NOT desc-sweep's 120 — and the difference is the walk order, measured
// the hard way. desc-sweep orders by posted_at DESC, so every hop mixes
// tenants and one dead board costs a few of its 120 fetches. This lane walks
// by id, and ids cluster BY TENANT — a hop parked on one hanging Workday
// board serializes into ceil(120/8) waves x FETCH_TIMEOUT_MS (20s) = 300+
// seconds, past the isolate's wall clock. Two live passes died exactly this
// way (start-stamp at 21:23 and 21:44, no end-of-hop report either time).
// At 24 rows the worst case is 3 waves x 20s = ~60s: the hop survives a
// fully dead tenant, skips it, and the cursor moves on.
const STRUCTURED_SWEEP_PER_HOP = 24;
// Slice sizes are calibrated to the per-invocation compute budget. Hot
// slices are UNIFORMLY giant boards (that's what makes them hot), so they
// must be much smaller than the old mixed slices: the first tiered deploy
// died mid-slice at HOT=30 (one upsert chunk of carvana landed, then the
// worker hit the ceiling and the cron retried the same slice forever).
const HOT_SLICE = 10;
const COLD_SLICE = 80; // cold boards are small (that's why they're cold); 80/hop at CONCURRENCY=8 is 10 sequential rounds — well under the edge wall-time limit. Rotation speed comes from concurrency + hops-per-pass, never bigger slices (proven-safe size).
const BOOTSTRAP_PER_SLICE = 25; // zero-row boards prepended per cold slice after a deploy — +31% slice load, still ~3 rounds under the wall-time margin; a 1,900-board merge drains in ~1.5 passes instead of waiting a full rotation for its FIRST ingest
// MEASURED DOWN FROM 25 — 25 COST THE ROTATION FOUR TIMES ITS SPEED.
//
// The cap was set to match BOOTSTRAP_PER_SLICE on the reasoning that its load
// was "already proven safe". That reasoning was wrong, and the error is that a
// bootstrap board and a deep board are not the same unit of work: a bootstrap
// board is a zero-row board that usually returns almost nothing, while a deep
// board is a 500-posting Workday window WITH descriptions — the most expensive
// fetch this function makes. Twenty-five of those tripled the real cost of an
// 80-board slice.
//
// Measured live on .20, two cold-cursor samples 422s apart:
//   before the lane   46.0 boards/min   full cycle 11.4 h
//   at DEEP_PER_SLICE=25   11.4 boards/min   full cycle 46.2 h
// +80 in 422s is exactly ONE slice, so slices had gone from ~1.7 min to ~7.
//
// A 46-hour cold cycle is not a tuning question, it is a broken promise: the
// board publishes that every feed is re-verified within a few hours, and
// freshness p95 had already reached 357 min against that claim. Depth bought
// with the freshness budget is the same mistake the removed "quiet lane" made,
// recorded in this file's own history.
//
// 8 keeps the lane working — the backlog it exists to drain has already fallen
// from 123 boards to 44, and 8/slice still sweeps that map in ~6 slices — while
// returning the per-slice cost to roughly a third of what the regression added.
// RE-MEASURE the cursor rate after any change to this number; it is the only
// thing that shows the cost.
const DEEP_PER_SLICE = 8;
// RETRY LANE — deliberately the smallest lane on the slice.
//
// A board only gets a verification stamp when its fetch SUCCEEDS, so one failed
// fetch used to cost it a full rotation (8.2h measured) before anything tried
// again. Measured 2026-08-26: 82.5% of boards sat inside one rotation while the
// 5% tail sat at 12-25h — freshness p95 20.7h against a healthy p50 of 4.9h.
// That tail was never a rotation-speed problem; it was boards waiting a whole
// rotation for a second chance.
//
// FIVE, NOT TWENTY-FIVE, and the arithmetic is the lesson from DEEP_PER_SLICE
// three commits ago. A retry is the most expensive fetch there is when it fails
// again: a dead feed burns the full ~20s FETCH_TIMEOUT, which is precisely the
// cost dormancy exists to stop paying. Five at CONCURRENCY 8 is one extra
// round, bounded at ~20s worst case on a ~75s slice. Exponential backoff then
// keeps the pool small in steady state, so the lane is usually far under its
// cap. RE-MEASURE the cold-cursor rate after changing this number.
const RETRY_PER_SLICE = 5;
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

// Self-tuning light mode: the static LIGHT_DESC_TOKENS set plus a dynamic,
// meta-persisted set of Greenhouse boards whose content payloads measured
// past the auto-enroll threshold. stripe (3.9MB) and zscaler (4.9MB) were
// hardcoded only after their heavy parses starved them of verification
// stamps for days — the NEXT giant enrolls itself the first time its volume
// is measured instead of waiting for a human to notice missing stamps.
// Descriptions for light boards arrive via the daily backfill-desc sweep
// (Greenhouse per-job endpoint, its own compute budget).
const DYNAMIC_LIGHT = new Set<string>();
const AUTO_LIGHT_THRESHOLD_CHARS = 2_500_000; // ~2.5MB of raw content HTML
const AUTO_LIGHT_CAP = 50; // bound the meta row; realistically a handful
const isLight = (token: string) => LIGHT_DESC_TOKENS.has(token) || DYNAMIC_LIGHT.has(token);
async function loadDynamicLight(client: SupabaseClient): Promise<void> {
  try {
    const { data } = await client.from("job_board_meta").select("v").eq("k", "light_desc_dynamic").maybeSingle();
    const tokens = (data?.v as { tokens?: unknown } | null)?.tokens;
    DYNAMIC_LIGHT.clear();
    if (Array.isArray(tokens)) for (const t of tokens) if (typeof t === "string") DYNAMIC_LIGHT.add(t);
  } catch { /* meta unreadable — static set still applies */ }
}

// Greenhouse runs separate EU infrastructure (job-boards.eu.greenhouse.io)
// with its own API host. EU boards carry an `eu~` token prefix (compound
// token, same pattern as workday's `tenant~dc~site`); everything downstream
// (ids, catalog, closure log) keeps the full prefixed token.
export function greenhouseApi(token: string): { host: string; token: string } {
  return token.startsWith("eu~")
    ? { host: "boards.eu.greenhouse.io", token: token.slice(3) }
    : { host: "boards-api.greenhouse.io", token };
}

// startOffset is honoured only by the paginating vendors; every other branch
// fetches a whole feed and ignores it.
const listUrl = (s: JobSource, startOffset = 0) =>
  s.source === "greenhouse"
    // content=true costs a bigger payload but delivers every description in
    // ONE call — fit-ranking coverage for GH boards, plus real departments.
    ? (({ host, token }) => `https://${host}/v1/boards/${token}/jobs${isLight(s.token) ? "" : "?content=true"}`)(greenhouseApi(s.token))
    : s.source === "lever"
      ? `https://api.lever.co/v0/postings/${s.token}?mode=json`
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

// SmartRecruiters paginates 100/page. With ~1,000 SR boards now in the pool, an
// unbounded cap could let one giant board's pagination wedge a cold hop under
// the edge wall-time limit. Bound it so no single board costs more than ~8
// sequential pages — the vast majority of boards hold fewer than this, and the
// 30-day freshness cap discards most of a mega-board's inventory anyway. Big
// boards still get full coverage once the self-tuning hot tier promotes them
// (fetched alone in small hot slices).
// SR_CAP 800 -> 2000, and the reason is measured rather than tuned.
//
// The SmartRecruiters feed is ordered NEWEST FIRST — verified on AECOM
// 2026-08-10: offset 0 = today, offset 800 = 10 days old, offset 2000 = 34
// days, offset 4000 = 3.5 months. So the cap never dropped random postings; it
// cut the tail, and most of that tail is already past the board's own 30-day
// serving window and would be filtered out regardless. The old cap was not
// losing 22,617 servable roles, which is what the raw feed-vs-live gap looks
// like until you check the ordering.
//
// What it WAS losing is the part of the window it could not reach. Measured by
// binary-searching each feed for the 30-day crossover:
//   AECOM      1,793 postings inside 30 days — 800 covered 44%
//   Bosch      1,815 inside 30 days          — 800 covered 44%
//   Domino's  >6,000 inside 30 days          — 800 covered <13%
// 2,000 therefore covers ten of the eleven currently-capped boards in FULL,
// and triples the giants.
//
// 2,000 is not an arbitrary ceiling either: it is exactly Oracle's per-pass
// budget in this same file (ORACLE_PAGE_SIZE 100 × ORACLE_PAGE_CAP 20), a page
// shape and request count already proven in production here. Workday runs 500.
// The cap exists so one board cannot monopolise a slice, and that constraint is
// unchanged — 20 requests, not 246, which is what an uncapped Domino's would
// cost every pass.
const SR_PAGE = 100;
const SR_PAGE_CAP = 20;
const SR_CAP = SR_PAGE * SR_PAGE_CAP; // 2,000/board/pass
async function fetchSmartRecruiters(s: JobSource, startOffset = 0): Promise<{ content: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number }> {
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
  for (let offset = SR_PAGE; offset < total; offset += SR_PAGE) {
    const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=${SR_PAGE}&offset=${startOffset + offset}`);
    if (!res.ok) break; // partial page set is fine — prune guard keys off success of THIS board overall
    const page = await res.json();
    content.push(...(page.content ?? []));
  }
  // windowed, reported the same way Workday and Oracle report it: the company
  // holds more than we fetched, so a posting's ABSENCE from our copy proves
  // nothing about it being filled. Downstream this suppresses closure logging
  // and guards the prune. SR previously had no feedTotal at all, so truncation
  // was inferred from `rowsById.size >= SR_CAP` — a proxy that cannot tell a
  // board of exactly 2,000 from one of 24,566.
  const advancedSr = startOffset + content.length;
  const nextOffset = content.length === 0 || (feedTotal > 0 && advancedSr >= feedTotal) ? 0 : advancedSr;
  return { content, windowed: feedTotal > content.length, feedTotal, nextOffset };
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
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
    await new Promise((r) => setTimeout(r, waitMs));
    return await once();
  }
  return res;
}

// Personio publishes the same official feed on two hosts depending on the
// company's region setup — try .de first (the majority), fall back to .com.
// The winning host is carried so Apply links land on the right domain.
async function fetchPersonio(s: JobSource): Promise<{ xml: string; host: string }> {
  // AN EMPTY BOARD IS NOT AN OUTAGE.
  //
  // This accepted a response only if it contained "<position", so an employer
  // with no open roles — a perfectly healthy feed answering
  // `<workzag-jobs></workzag-jobs>` in 72 bytes — was reported as
  // "personio feed unavailable on .de/.com". Measured 2026-08-24, the first
  // day failure reasons were visible: 41 of 120 board failures were personio,
  // and probing all 41 found 32 answering HTTP 200 with a valid empty feed.
  // A third of the board's entire failure list was employers who simply
  // weren't hiring.
  //
  // The consequence is worse than the noise. A failed fetch means the board
  // is skipped by the prune, so a personio employer who closes their last
  // role would keep those postings on a board that advertises zero ghost
  // jobs — indefinitely, but for the 30-day freshness cap catching them
  // later. Three such postings were being served when this was found.
  //
  // The document root is the health signal; the positions inside it are the
  // inventory. Those are different questions and this asked the wrong one.
  for (const host of ["jobs.personio.de", "jobs.personio.com"]) {
    try {
      const res = await fetchWithTimeout(`https://${s.token}.${host}/xml`);
      if (res.ok) {
        const xml = await res.text();
        if (xml.includes("<workzag-jobs") || xml.includes("<position")) return { xml, host };
      }
    } catch { /* try the other host */ }
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
async function fetchRippling(s: JobSource, startOffset = 0): Promise<{ items: unknown[]; raw: string; windowed: boolean; feedTotal: number; nextOffset: number }> {
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
  };
}

// Workday CXS: POST-paginated first-party list endpoint. Compound token
// tenant~dc~site. Bounded to WORKDAY_PAGE_CAP pages (enterprise tenants can
// hold thousands; the cap keeps one board's fetch from monopolizing a slice —
// the rest rotate in on later passes, and the freshness filter drops the aged
// tail regardless). List-only, so no description at this stage — but NOT
// undated: the relative list age converts to a real date when <= 30 days, and
// the CXS detail payload later supplies an exact startDate that replaces it.
// (The "like BambooHR" that used to sit here was wrong on both counts.)
const WORKDAY_PAGE_CAP = 25; // 25 × 20 = up to 500 postings/board/pass
// Oracle CE REST accepts a larger page than Workday; 20 × 100 = up to 2000
// postings/board/pass, which exhausts every tenant in the first tranche.
const ORACLE_PAGE_SIZE = 100;
const ORACLE_PAGE_CAP = 20;
// A CAP THAT ALWAYS RESTARTS AT ZERO IS NOT A CAP, IT IS A CEILING.
//
// Every pass fetched pages 0..24 — the same 500 postings, forever. A tenant
// with more than 500 could never be read past the first 500, no matter how
// many times we visited it. Measured 2026-08-25 against the four largest
// at-cap boards: we hold 2,404 of 41,221 live postings, 6%. CVS Health serves
// 19,265 and we store 678. Across the 160 Workday boards sitting at the cap,
// a 24-board sample says roughly 276,000 postings were never fetched — and
// that is a LOWER bound, because several tenants report exactly 2000, which is
// Workday's own reporting cap rather than a count.
//
// `startOffset` continues where the previous pass stopped, so the SAME
// per-pass cost walks the whole board over successive passes and wraps at the
// end. Raising the cap instead would slow every pass and shrink how many
// boards the rotation reaches, which is the trade the cap was chosen to make.
//
// This only works because a windowed board no longer absence-prunes (see the
// partialRead branch in the ingest): otherwise each pass would delete the
// window the previous pass just stored, and the board would churn instead of
// filling. The two changes are one change.
async function fetchWorkday(s: JobSource, startOffset = 0): Promise<{ jobPostings: unknown[]; raw: unknown; windowed: boolean; feedTotal: number; nextOffset: number }> {
  const [tenant, dc, site] = s.token.split("~");
  if (!tenant || !dc || !site) throw new Error("bad workday token");
  const url = `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const all: unknown[] = [];
  let feedTotal = 0;
  let exhausted = false;
  for (let page = 0; page < WORKDAY_PAGE_CAP; page++) {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ limit: 20, offset: startOffset + page * 20, searchText: "", appliedFacets: {} }),
    });
    if (!res.ok) { if (page === 0) throw new Error(`HTTP ${res.status}`); break; }
    const body = await res.json();
    if (page === 0) feedTotal = Number((body as { total?: number }).total ?? 0) || 0;
    const items = Array.isArray((body as { jobPostings?: unknown[] }).jobPostings) ? (body as { jobPostings: unknown[] }).jobPostings : [];
    all.push(...items);
    if (items.length < 20) { exhausted = true; break; } // last page — wrap next pass
  }
  // Empty page with a non-zero advertised total = the tenant refused/failed us
  // (rate-limit, transient) — NOT an empty board. Throwing marks the board
  // failed so nothing is pruned. Without this, persistent empty responses
  // eventually pass the two-pass + shrink-ratchet guards and delete the whole
  // board (live case: Four Seasons pruned to 0 while advertising 1,963 jobs).
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  // windowed: the tenant holds more postings than the page cap lets us fetch.
  // Membership then ROTATES — newer postings push older ones past the window,
  // and a role "vanishing" proves nothing about it being filled (verified live:
  // 7 of 8 sampled Caterpillar "closures" were still open on the company site).
  // feedTotal is the company's own advertised count — stored on the
  // verification stamp so the UI can say "500+" instead of a false-precision
  // floor (Caterpillar showed "503 open" while advertising 942).
  // Wrap when the feed ran out OR when the next offset would pass the tenant's
  // own advertised total — otherwise a board whose total shrinks between passes
  // would page forever into empty responses.
  const advanced = startOffset + all.length;
  const nextOffset = exhausted || (feedTotal > 0 && advanced >= feedTotal) ? 0 : advanced;
  // windowed compares the WHOLE feed against this pass's slice, not against the
  // running total, so it stays true for every pass of a multi-pass board — which
  // is what keeps the prune off while the board fills.
  return { jobPostings: all, raw: { jobPostings: all }, windowed: feedTotal > all.length, feedTotal, nextOffset };
}

// Oracle Recruiting Cloud: paginated public CE REST. The finder carries the
// site number and paging; items[0].TotalJobsCount is the tenant's own advertised
// total, so (like Workday) we can tell a windowed fetch from an exhaustive one
// and refuse to prune on a partial read.
// startOffset rotates a tenant bigger than ORACLE_PAGE_CAP x ORACLE_PAGE_SIZE
// across passes. No oracle board sits at that 2,000 ceiling today (measured
// 2026-08-25: zero), so this is a ceiling being removed before an employer
// grows into it rather than a backlog being drained.
async function fetchOracle(s: JobSource, startOffset = 0): Promise<{ items: unknown[]; raw: unknown; windowed: boolean; feedTotal: number; nextOffset: number }> {
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
  for (let page = 0; page < ORACLE_PAGE_CAP; page++) {
    const finder = `findReqs;siteNumber=${site},limit=${ORACLE_PAGE_SIZE},offset=${startOffset + page * ORACLE_PAGE_SIZE},sortBy=POSTING_DATES_DESC`;
    const res = await fetchWithTimeout(`${base}?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`);
    if (!res.ok) { if (page === 0) throw new Error(`HTTP ${res.status}`); break; }
    const body = await res.json();
    const item = (Array.isArray((body as { items?: unknown[] }).items) ? (body as { items: Record<string, unknown>[] }).items[0] : null) ?? null;
    if (!item) { exhausted = true; break; }
    if (page === 0) feedTotal = Number(item.TotalJobsCount ?? 0) || 0;
    const reqs = Array.isArray(item.requisitionList) ? item.requisitionList as unknown[] : [];
    all.push(...reqs);
    if (reqs.length < ORACLE_PAGE_SIZE) { exhausted = true; break; } // last page
  }
  // Same guard as Workday: an empty read against a non-zero advertised total is
  // a refusal (rate-limit/transient), NOT an empty board. Throwing marks the
  // board failed so the orphan prune never deletes a live tenant.
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  const advancedOr = startOffset + all.length;
  const nextOffset = exhausted || (feedTotal > 0 && advancedOr >= feedTotal) ? 0 : advancedOr;
  return { items: all, raw: { items: all }, windowed: !exhausted, feedTotal, nextOffset };
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
): Promise<{ jobs: JobPosting[]; raw: unknown; windowed?: boolean; feedTotal?: number; nextOffset?: number } | null> {
  try {
    if (s.source === "oracle") {
      const { items, raw, windowed, feedTotal, nextOffset } = await fetchOracle(s, startOffset);
      return { jobs: normalizeOracle(items as never, s.name, s.token), raw, windowed, feedTotal, nextOffset };
    }
    if (s.source === "icims") {
      // The employer's own career-site JSON (token IS the host). Paginated at
      // 100/page; bounded so one giant board can't wedge a refresh slice.
      //
      // s.pages overrides the budget for NAMED giants only (PetSmart holds
      // 10,911 — the default would window it at 11% forever), and pages fetch
      // in chunks of 5 so the giant costs ~23 sequential rounds, the same
      // order as Oracle's tolerated 20 — not 110 serial round trips.
      const ICIMS_PAGE = 100, ICIMS_MAX_PAGES = Math.max(1, s.pages ?? 12), ICIMS_CHUNK = 5;
      const all: unknown[] = [];
      let feedTotal = 0, exhausted = false;
      const fetchPage = async (page: number) => {
        const res = await fetchWithTimeout(`https://${s.token}/api/jobs?page=${page}&limit=${ICIMS_PAGE}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { jobs?: unknown[]; totalCount?: number };
        return body;
      };
      outer: for (let start = 1; start <= ICIMS_MAX_PAGES; start += ICIMS_CHUNK) {
        const pages: number[] = [];
        for (let p = start; p <= Math.min(start + ICIMS_CHUNK - 1, ICIMS_MAX_PAGES); p++) pages.push(p);
        const bodies = await Promise.all(pages.map(fetchPage));
        for (let i = 0; i < bodies.length; i++) {
          const batch = Array.isArray(bodies[i].jobs) ? bodies[i].jobs! : [];
          if (pages[i] === 1) feedTotal = Number(bodies[i].totalCount) || 0;
          all.push(...batch);
          // A short page inside a chunk ends the walk — later chunk members
          // past the end return empty and must not be treated as data.
          if (batch.length < ICIMS_PAGE) { exhausted = true; break outer; }
        }
      }
      // Same guard as the other paginated vendors: a page-1 failure that
      // returns empty while the feed claims postings must NOT read as "board
      // emptied" (the orphan prune would delete a live tenant).
      if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
      return { jobs: normalizeIcims(all as never, s.name, s.token), raw: { items: all }, windowed: !exhausted, feedTotal };
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
      const { items, raw, windowed, feedTotal, nextOffset } = await fetchRippling(s, startOffset);
      return { jobs: normalizeRippling(items as never, s.name, s.token), raw, windowed, feedTotal, nextOffset };
    }
    if (s.source === "pinpoint") {
      // Documented public JSON — single unpaginated list.
      //
      // A DOTTED TOKEN IS A CUSTOM DOMAIN, and custom domains are most of why
      // Pinpoint — the top-yield drivable vendor at 29.7 postings/board — was
      // nearly invisible to discovery: careers.riverisland.com CNAMEs to
      // CloudFront, not to anything pinpoint-named, and its DERIVED tenant
      // (riverisland.pinpointhq.com) answers 200 with {"data":[]} while the
      // custom host serves 62 postings. Measured 2026-08-07. So the subdomain
      // template only fits subdomain tenants; a token containing a dot is used
      // as the host itself.
      const pinpointHost = s.token.includes(".") ? s.token : `${s.token}.pinpointhq.com`;
      const res = await fetchWithTimeout(`https://${pinpointHost}/postings.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const data = Array.isArray((body as { data?: unknown[] }).data) ? (body as { data: unknown[] }).data : [];
      return { jobs: normalizePinpoint(data as never, s.name, s.token), raw: body };
    }
    if (s.source === "workday") {
      const { jobPostings, raw, windowed, feedTotal, nextOffset } = await fetchWorkday(s, startOffset);
      return { jobs: normalizeWorkday(jobPostings as never, s.name, s.token), raw, windowed, feedTotal, nextOffset };
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
      // A LOGIN PAGE IS NOT A PARSE ERROR. When an employer turns their public
      // careers list off, the vendor answers 302 -> /login.php and serves HTML;
      // res.json() then failed with `Unexpected token '<', "<!DOCTYPE "...`,
      // which reads like our bug and is actually the board being private.
      // Measured 2026-08-24: 11 of 120 board failures were exactly this, every
      // one a BambooHR tenant redirected to a login page.
      //
      // We use public feeds only and never authenticate, so this is a terminal
      // state for the board, not a transient error — and it deserves to say so
      // in one line rather than be diagnosed from a JSON parser's complaint.
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
      const sr = raw as { windowed?: boolean; feedTotal?: number; nextOffset?: number };
      return { jobs, raw, windowed: sr.windowed === true, feedTotal: sr.feedTotal ?? 0, nextOffset: sr.nextOffset };
    }
    return { jobs, raw };
  } catch (e) {
    const raw = String((e as Error)?.message ?? e);
    // Classify into something countable. An operator needs to tell "the board
    // is gone" from "the vendor throttled us" at a glance, because those have
    // opposite remedies: one is a registry removal, the other a backoff.
    const http = raw.match(/HTTP (\d{3})/)?.[1];
    const reason = http
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

// Two-tier cadence: HOT boards (heaviest inventory) re-verify on every
// chain pass (~10 min); the long tail rotates through a fixed budget of
// cold slices per pass, so a full tail rotation is bounded regardless of
// how many boards the catalog grows to. Pass length is therefore FIXED:
// ceil(hot/HOT_SLICE) hot hops + COLD_SLICES_PER_PASS cold hops.
// Hot boards interleaved round-robin by vendor: Greenhouse giants fetch as
// multi-MB JSON (content=true), and a slice whose first concurrent fetches
// are ALL Greenhouse blew the isolate's memory ceiling instantly (the
// 13:04 + 13:20 WORKER_RESOURCE_LIMITs — carvana froze at one 250-row
// chunk). Spreading vendors bounds concurrent heavy parses.
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
// 80×120 = 9,600 cold boards/pass. Slice size stays the proven-safe 80 — more
// hops, never bigger hops. SR_CAP still bounds any single board's fetch.
//
// Sized from measurement, not intuition (2026-07-25, 28,055-board catalog):
// a cold hop takes ~12-18s, so 48 hops is only ~12 min of work — yet a full
// pass measured ~46 min end to end. The other ~34 min is FIXED per-pass cost:
// the 12-hop hot phase (giants at HOT_CONCURRENCY=2), the pass-end block
// (facets RPC, orphan prune, freshness sweep, exact-count capacity governor),
// and the idle gap after the chain returns at pass end until the next cron
// kick lands (the crons are 10 min apart, offset 5). That overhead is paid per
// PASS, not per board, so the cold tail was getting ~26% of the wall clock.
// 48→120 pays it 2.5x less often: ~64 min per pass covering 9,600 boards =
// ~187 min for the full 28k wrap, against ~333 min at 48 (after the cursor fix
// below stopped over-advancing). The cost is hot-tier cadence going ~46→~64
// min, which the giants can afford; the claim is bounded by the COLD tail.
// 120 -> 160 (2026-08-19): the capacity lever funding the census program. The
// per-PASS overhead (hot phase, pass-end block, idle gap to next cron kick) is
// large and fixed, so more cold slices per pass amortizes it further — the
// same measured logic as the 48->120 raise. Absorbs ~3,700 more boards per
// rotation ahead of the Oracle/iCIMS census merges. Watch one full wrap after
// deploy: freshness p95 and lastRotationAgeMin must stay near current values.
const COLD_SLICES_PER_PASS = 160;

// Dormancy skip-list (throughput): a feed dead for DEAD_BOARD_THRESHOLD straight
// rotations has its postings pruned and is marked dormant — future cold slices
// SKIP fetching it (a dead feed would otherwise burn the full FETCH_TIMEOUT every
// rotation for nothing) and only recheck it once per DORMANT_RECHECK_MS so a feed
// that comes back rejoins on its own. The board stays in COLD_LIST, so the
// rotation cursor and sweep coverage are untouched — only the wasted fetch is
// removed. DORMANT_CAP bounds the meta row against a mass die-off.
const DEAD_BOARD_THRESHOLD = 6; // consecutive failures before prune + dormancy (unchanged bar from the prior prune)
// THE PRUNE BAR IN THE UNIT IT WAS ACTUALLY CALIBRATED IN.
//
// DEAD_BOARD_THRESHOLD was set when attempts arrived once per rotation, so "6
// consecutive failures" meant "dead for roughly 41 hours". The count was never
// the point; the DURATION was — it is the whole protection between a transient
// vendor blip and deleting a company's corpus (an exit row per posting, every
// row for the token deleted, a 12h blackout, and first_seen reset on re-ingest).
//
// The retry lane decouples attempts from time: six attempts now fit inside
// 7h45m. Shipping that without this floor would have cut a 41-hour guard to
// under eight, and a Workday CDN throttle of the kind already recorded in this
// file (boards answering fine from outside, blocked only for our egress IPs)
// would have pruned boards that were never dead. An adversarial review caught
// it before it shipped.
//
// 40h keeps the bar where it was measured. Both conditions must hold, so adding
// an even faster lane later cannot erode it — which is the property that was
// missing, not the number.
const DEAD_BOARD_MIN_FAILING_MS = 40 * 60 * 60_000;
const DORMANT_RECHECK_MS = 12 * 60 * 60_000; // recovery probe cadence for a dormant board
const DORMANT_CAP = 8_000; // max tracked dormant boards (raised with the 26k-board catalog — census waves include older-crawl boards that die over time)

// Vendor circuit breaker: a vendor-wide API/shape change can make every board
// return 200-with-empty — which per-board looks like "this company has zero
// jobs" and would prune the vendor's whole corpus in one rotation while
// flooding the closure log with fake closures. We track FEED-level zero rates
// per vendor (decayed across slices; feed-level, before the freshness window,
// because a healthy board's feed almost never goes empty — catalog admission
// required >=3 postings). Past the trip threshold, zero-feed boards of that
// vendor are skipped entirely: no prune, no closure, no stamp, and no failure
// streak (a long quarantine must not convert into streak-prunes). Fail-safe
// direction: a few stale postings beat mass-deleting live ones. Boards that
// still return jobs keep processing, so a recovering vendor resumes itself.
const VENDOR_ZERO_TRIP = 0.5; // zero-feed fraction that trips the breaker
const VENDOR_ZERO_RESET = 0.3; // hysteresis: quarantine lifts below this
const VENDOR_MIN_ATTEMPTS = 20; // never judge a vendor on a handful of fetches
const VENDOR_STATS_DECAY = 0.8; // per-slice decay — recent slices dominate

// Experience-band rules version: bump to re-derive bands from richer text later.
// The one-time backfill fills existing rows (experience_band IS NULL) once; new
// rows carry a band from ingestion, so this only fires the sweep on first deploy.
const EXPERIENCE_VERSION = 1;
// Bump when parseSalaryStructured's rules change — re-sweeps stored salary
// text into salary_min_annual + salary_currency (rows are insert-only, so
// ingest alone never reaches postings that predate the parser). v2: currency
// capture — the sweep targets salary_currency IS NULL, which also re-covers
// rows v1 already parsed (they have a floor but no currency).
const SALARY_PARSE_VERSION = 7; // v7 (2026-08-25): day rates (x260) + a part-time/casual guard that REFUSES to annualise a load-dependent rate — {"q":"teacher","salaryFloor":90000} was serving 14 hourly part-timers out of 15, incl. $44/hr read as 91,520 and a $160/day substitute read as 332,800
// v6 (2026-08-24): // v6 (2026-08-24): "an hour"/"a year" vocabulary + unambiguous-hourly inference for parity currencies in [7,200) — 17,641 workday vendor-stated ranges sat unannualized; whole-dollar rounding
const COUNTRY_VERSION = 1; // v1: deterministic country from location text (names + US/CA state patterns)
// Date-the-undated sweep: greenhouse rows predating first_published capture
// (insert-only rows never re-see the feed). Vendors whose feeds carry no date
// at all (bamboohr/rippling) are structurally undated — no sweep can date
// them; provenance labels stay the honest treatment. Measured backlog at v1:
// ~480 greenhouse rows.
// v4 (2026-07-26): the WORKDAY PHASE IS GONE. v3 fixed the chain so the
// phases actually ran — and the workday phase's burst of full list re-fetches
// (8 boards/hop of paginated CXS lists, on top of the normal refresh cadence)
// got Supabase's egress IPs throttled by Workday's CDN: the vendor breaker
// measured 34% zero feeds and QUARANTINED workday — half the corpus in safe
// mode. Verified from an outside network at the same minute: 6/6 boards
// answered normally, so the block was on our IPs, self-inflicted. Workday
// rows are already 75% dated and dated-ingest has been live for a week; the
// marginal dates were not worth half the catalog. The remaining phases also
// gain an inter-hop pause — the embed-sweep lesson, applied before it bites.
// v5 (2026-07-28): v4's guards stop the replay bug recurring but cannot free
// the rows it already stranded. The broken v4 chain walked to completion and
// wrote {version: 4}, and the maintenance kick fires only on
// `pbV.version !== POSTED_BACKFILL_VERSION` — so 4 === 4 meant the sweep was
// permanently, silently "done" with bamboohr 43,687/43,687 and rippling
// 8,991/8,991 undated. Bumping the version is the ONLY thing that re-arms the
// kick; it is what this constant is for. On the next kick the stored
// resumeVersion (4, or absent) also fails the new match, so the chain starts
// clean at bamboohr with an empty cursor rather than inheriting v4 state.

// The completion stamp EXPIRES. Without this the sweep is strictly one-shot:
// it stamps {version: 5} when the last phase drains, and both kicks test
// `version !== POSTED_BACKFILL_VERSION`, so it can never run again — while
// BambooHR and Rippling keep ingesting undated postings every day, forever.
// The 43,687-row backlog this sweep is about to clear would simply regrow, and
// the only way to date the new arrivals would be a human remembering to bump
// the version constant. That is not a mechanism, it is a chore.
//
// Re-running is cheap precisely because the draw is `.is("posted_at", null)`:
// after the first pass the population is one week's inflow, not 43,687 rows.
//
// A missing or unparseable sweptAt reads as DUE. It is the conservative
// direction (one cheap extra sweep) and it self-corrects, because completing
// writes a fresh stamp.
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

// Capacity governor: keep the corpus under a ceiling with headroom; when a
// hiring surge or a wider board selection pushes past it, shed the STALEST
// postings (oldest effective_posted — the exact rows sitting last on the
// board) so the slots we keep are the freshest. Dormant while supply is under
// the ceiling, so it costs nothing until it's actually needed. Hysteresis
// (evict down to TARGET, arm at CEILING) keeps it from thrashing every pass
// once it does engage.
//
// Ceiling sizing (2026-07-13): the database moved off the free tier to an 8GB
// plan (~6.6GB free at the time of the raise). A posting row costs ~5-6KB all
// in (≤4KB description + metadata + indexes), so 300k rows ≈ ~1.7GB — well
// inside headroom while leaving most of the disk for everything else. Stepped
// 97k → 300k → 500k, each raise on measured evidence (runbook bar). The 500k
// step (2026-07-16): corpus at 202k with point-reads 0.44-0.58s, writes
// flowing, insert-only design (no dead-tuple bloat), and the storage heartbeat
// passing well under 75% of the 8GB plan — 500k ≈ ~2.75GB ≈ 34% of plan. The
// vendor pipeline (Workday #12 + ongoing census yields) needs the headroom;
// eviction was about to bind at 300k and cap net growth. Next stop (1M) only
// after a bigger DB plan — the storage check will flag the ceiling first.
// 750k step (2026-07-17): the snapshot 7-14 census wave (5-7k verified new
// boards incl. two Workday batches) projects the corpus into the 420-500k+
// range — at 500k the governor would evict fresh inventory on arrival. Row
// math: ~5-6KB all-in → 750k ≈ 4.1GB ≈ 51% of the 8GB plan; the storage
// heartbeat (75% alarm) passes at 307k and flags the true ceiling before it
// binds. Next stop (1M) only after a bigger DB plan.
const CORPUS_CEILING = 750_000; // arm eviction above this
const CORPUS_TARGET = 720_000;  // evict down to this

// Freshness cap: the board shows only roles posted within this window. Dated
// postings past it are dropped at ingestion (never stored) and swept from the
// stored corpus each pass; the id-diff prune then keeps them out for good.
// Nearly 100% of feed postings carry a real date, so this is churn-free — a
// dropped dated posting can't re-enter. One constant to dial (30d ≈ 31k live
// board, 45d ≈ 43k, 60d ≈ 50k on the current selection).
const FRESH_WINDOW_DAYS = 30;

// Which exit did this posting actually experience?
//
// 'aged_out' means what the exit ledger's header says it means: STILL
// ADVERTISED WHEN IT CROSSED OUR 30-DAY CAP — a tenure our board watched
// elapse. That is the event the ghost-rate stat counts.
//
// A posting whose employer-stated date predates our FIRST SIGHTING by more
// than the serving window never gave us that observation. It was already old
// when it arrived, or (the case that forces this) it sat here undated for
// weeks and a later backfill told us its real date. We did not watch it age;
// we found out it was aged. Calling that 'aged_out' would let a dating sweep
// manufacture ghost-rate evidence out of nothing but our own late knowledge —
// and it would land as a one-day spike, because a sweep drains in hours what
// the board would otherwise emit over months.
//
// So: 'backdated'. Same row, same days_on_board (which is defined off the
// employer's date and is still the employer's true tenure), different claim.
// Written as a property of the DATA, not as a flag the dating sweep sets, so
// every future backfill inherits it without anyone remembering this cohort.
const BACKDATE_SLACK_MS = FRESH_WINDOW_DAYS * 86_400_000;
function exitReasonFor(postedAt: unknown, firstSeen: unknown): "aged_out" | "backdated" {
  const p = postedAt ? Date.parse(String(postedAt)) : NaN;
  const f = firstSeen ? Date.parse(String(firstSeen)) : NaN;
  if (!Number.isFinite(p) || !Number.isFinite(f)) return "aged_out";
  return p < f - BACKDATE_SLACK_MS ? "backdated" : "aged_out";
}

// WHOLE-BOARD PRUNES USED TO LEAVE NO TRACE AT ALL.
//
// Two paths delete by company_token rather than by id — a board going dormant
// after repeated fetch failures, and a board removed from sources.ts — so
// neither passes through the per-posting closure path below. Audited
// 2026-08-17: they wrote to job_board_closures AND job_board_exits zero times.
// Every other delete site writes at least one of them.
//
// They are NOT closures and must never be logged as such: a dead feed is our
// fetch failing, and an orphan is us dropping the board. In both cases the
// employer may still be hiring, and job_board_closures is the table that means
// "the company took the role down" — the one asset here nobody can reproduce,
// and worth exactly as much as its precision. They belong in the exit ledger,
// under a reason that says what actually happened.
//
// Reads before deleting, because after the delete there is nothing to read. Best
// effort throughout: a prune must never fail because bookkeeping did.
async function logWholeBoardExit(
  client: SupabaseClient,
  token: string,
  reason: "board_dormant" | "untracked",
): Promise<number> {
  const exitedAt = new Date().toISOString();
  let logged = 0;
  try {
    for (let from = 0; ; from += 500) {
      const { data: page, error } = await client
        .from("job_board_postings")
        .select("id, source, company_token, category, posted_at, first_seen")
        .eq("company_token", token)
        .range(from, from + 499);
      if (error) { console.warn(`[JOB-BOARD] exit-log read failed for ${token} (non-fatal):`, error.message?.slice(0, 120)); break; }
      const rows = (page ?? []) as Array<Record<string, unknown>>;
      if (!rows.length) break;
      const { error: insErr } = await client.from("job_board_exits").insert(rows.map((r) => ({
        posting_id: String(r.id),
        source: String(r.source ?? ""),
        company_token: String(r.company_token ?? token),
        category: String(r.category ?? "other"),
        exit_reason: reason,
        days_on_board: (r.posted_at ?? r.first_seen)
          ? Math.round((Date.parse(exitedAt) - Date.parse(String(r.posted_at ?? r.first_seen))) / 8_640_000) / 10
          : null,
        exited_at: exitedAt,
      })));
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

// THE INGEST HAD NO OFF SWITCH, AND ON 2026-08-17 THAT MATTERED.
//
// The database degraded to the point that `select id limit 1` took 20-30s and
// action=list timed out outright. The operator response was to disable the four
// pg_cron jobs that start a refresh. Sixty-six minutes later the ingest was
// STILL RUNNING — status reported lastSliceAgeMin 0, and the cold cursor had
// reset from 30000 to 640, meaning a fresh pass had begun after the pause.
//
// Because pg_cron only ever STARTS a chain. chainNextSlice re-invokes this
// function for the next slice, up to CHAIN_CAP hops (a full pass), and a
// completed pass wraps the cursor and begins another. Once a chain is in flight
// it sustains itself, so pausing the scheduler quiesces nothing. There was no
// lever anywhere that stopped work already moving.
//
// isIngestPaused is that lever. It is checked HERE, at the hop boundary, so an
// in-flight chain DRAINS — the current slice finishes its writes and simply does
// not schedule a successor. Nothing is killed mid-write, no partial state is
// left behind, and the pass resumes from its stored cursor when unpaused.
//
// Failure is deliberately asymmetric: if the flag cannot be read, the chain
// CONTINUES. A transient meta read error must never silently stop the ingest —
// that failure mode is invisible for hours and is precisely what today's
// incident was made of. Pausing requires a positive, readable `true`.
async function isIngestPaused(client: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("job_board_meta").select("v").eq("k", "ingest_paused").maybeSingle();
    if (error) return false;
    return (data?.v as { paused?: boolean } | null)?.paused === true;
  } catch {
    return false;
  }
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
function chainNextSlice(hop: number, client?: SupabaseClient) {
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
    const key = await chainKey();
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", force: true, chain: hop + 1, chainKey: key }),
      });
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
async function runRefresh(client: SupabaseClient, force = false, chainHop = 0): Promise<{ ok: boolean; detail: string }> {
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
  const { hotList: HOT_LIST, coldList: COLD_LIST } = await tierLists(client);
  await loadDynamicLight(client); // auto-enrolled giant boards fetch without content
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
      hot = 0;
      coldDone = 0;
      pv.failedAcc = [];
      pv.failedTotal = 0;
    }
  }

  const inHotPhase = hot < HOT_LIST.length;
  const baseSlice = inHotPhase
    ? HOT_LIST.slice(hot, hot + HOT_SLICE)
    : COLD_LIST.slice(cold, cold + COLD_SLICE);
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
      const { data: bsMeta } = await client.from("job_board_meta").select("v").eq("k", "bootstrap").maybeSingle();
      const bs = (bsMeta?.v ?? {}) as { queue?: string[]; version?: string };
      let queue = Array.isArray(bs.queue) ? bs.queue : [];
      // REFUTED, 2026-08-25 — DO NOT "FIX" THIS LANE AGAIN ON THE SAME
      // REASONING. An audit and then I myself read the ~21-27% of registry
      // boards holding zero rows as recoverable inventory, on the strength of
      // probing seven of them and finding their vendor APIs serving live
      // items (zencoder 5, helm-ai 9, integrate 9, and others). The claim was
      // "tens of thousands of postings from employers already admitted".
      //
      // It was wrong, and the error was counting feed ITEMS without reading
      // their DATES. Re-probed with dates: zencoder's 5 items are all 36 days
      // old, helm-ai's 9 run 188 and 348 days old, integrate's 9 are 80-118
      // days old. Every one is past the 30-day cap, so the correct number of
      // rows to store from those boards is ZERO. The boards are empty by
      // POLICY, not by failure.
      //
      // The lane itself is healthy: instrumented per slice, it reports
      // drained 25 / selected 25 — the tokens resolve, the boards are
      // fetched, and nothing is stored because nothing qualifies. The
      // zero-row share RISING from 21% to 27% across that day is the
      // freshness enforcement working (including the multilingual Workday
      // parser shipped the same day), not a regression.
      //
      // Before treating an empty board as recoverable, check the AGE of what
      // its feed carries. A board of 30+ day-old listings is a board this
      // product deliberately does not serve.
      //
      // A DEPLOY MUST NOT RESTART THIS QUEUE. It re-seeded whenever
      // BUILD_VERSION changed, and get_empty_boards returns a stable order —
      // so every deploy sent the drain back to the front of the same list
      // while the tail was never reached. The comment further down this file
      // already warned that "every deploy resets the bootstrap lane"; what it
      // did not say is that the lane therefore never finishes.
      //
      // Measured 2026-08-24, after twelve deploys in one day: 7,564 boards
      // pending, and 21% of a stratified sample of the registry serving ZERO
      // postings. Probing seven of those zero-row boards against their own
      // vendor APIs, SEVEN returned live jobs — 110 openings across them,
      // none genuinely empty. At roughly ten postings each that is tens of
      // thousands of jobs the board has the right to serve and has never
      // fetched.
      //
      // The queue now refills only when it is EMPTY, so progress survives a
      // deploy and the tail is eventually reached. Boards filled in the
      // meantime drop out naturally, because the refill asks which boards are
      // still empty. The cold rotation remains the guarantee — this lane is
      // only an accelerator — so a slow refill costs nothing but time.
      if (queue.length === 0) {
        const { data: empty, error } = await client.rpc("get_empty_boards", { p_tokens: JOB_SOURCES.map((s) => s.token) });
        if (error) throw error;
        queue = Array.isArray(empty) ? empty : [];
      }
      if (queue.length > 0) {
        const sliceTokens = new Set([...baseSlice, ...demandBoards].map((s) => s.token));
        bootstrapBoards = queue
          .slice(0, BOOTSTRAP_PER_SLICE)
          .filter((t) => !sliceTokens.has(t))
          .map((t) => JOB_SOURCES.find((s) => s.token === t))
          .filter((s): s is JobSource => !!s);
      }
      if (queue.length > 0) {
        // Optimistic drain (same rule as the cursors): a died slice skips
        // ahead rather than wedging on the same bootstrap boards.
        // WHAT THE LANE ACTUALLY DID, not what it was asked to do.
        //
        // The queue drains 25 tokens per slice unconditionally, so "pending
        // is falling" proves only that the cursor moved. Measured across a
        // day: the queue fell 7,564 -> 386, refilled to 7,767, drained again
        // at ~80/min — and the share of registry boards with zero rows ROSE
        // from 21% to 27%. Boards are being drained without being filled, and
        // with only ~5 failures per ~80 drained they are not failing either.
        //
        // Three states are indistinguishable from outside: the token never
        // resolved to a JobSource, it resolved and was never fetched, or it
        // was fetched and legitimately had nothing. `selected` separates the
        // first from the rest, which is the fork I have guessed at twice.
        await client.from("job_board_meta").upsert(
          {
            k: "bootstrap",
            v: {
              queue: queue.slice(BOOTSTRAP_PER_SLICE),
              version: BUILD_VERSION,
              lastSlice: {
                at: new Date().toISOString(),
                drained: Math.min(BOOTSTRAP_PER_SLICE, queue.length),
                selected: bootstrapBoards.length,
              },
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "k" },
        );
      }
    } catch { /* bootstrap is an accelerator — on any error the rotation still reaches every board */ }
  }
  // DEEP CURSORS — where each capped board's last pass stopped.
  //
  // One small meta row, token -> offset, only ever holding entries for boards
  // the vendor says are bigger than one pass can read. A board that wraps is
  // deleted from the map rather than stored as 0, so the row tracks the boards
  // still filling and nothing else.
  //
  // Read BEFORE the slice is sealed (moved up here in .19) so the lane below
  // can use the map as its work list. Nothing between the old site and this
  // one touched it, so the move is positional only.
  const deepCursors: Record<string, number> = await (async () => {
    try {
      const { data } = await client.from("job_board_meta").select("v").eq("k", "deep_cursor").maybeSingle();
      const v = (data?.v ?? {}) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, n] of Object.entries(v)) if (Number.isInteger(n) && (n as number) > 0) out[k] = n as number;
      return out;
    } catch { return {}; } // a missing cursor costs one restart, never a failure
  })();
  let deepCursorsDirty = false;

  // FAST LANE FOR BOARDS STILL FILLING (.19) — a cadence fix, not a logic fix.
  //
  // The cursor plumbing works and is not touched here. What did not work was
  // how often a windowed board came round again. Measured 2026-08-26: the cold
  // cursor advances 46 boards/min across 31,501 cold boards, so a board is
  // revisited about every 11.4 hours. Workday serves 500 per visit, so CVS
  // Health (19,253 advertised) needs 39 visits = 18.5 DAYS to be read once,
  // against a 30-day freshness cap — it can never be complete and fresh at the
  // same time. Live proof the second window was never reached: the status
  // bundle read boards 66 / sumOffset 33,000, which is exactly 66 x 500.
  //
  // deepCursors IS the work list, and it maintains itself — an entry appears
  // when a board reports a non-zero next offset and is deleted the moment it
  // wraps. So this lane needs no queue of its own, nothing to seed, and
  // nothing to drain: it empties itself as boards finish. That is what makes
  // it safe to run every cold slice.
  //
  // Round-robin phased on the cold cursor so a board deeper in the map is not
  // starved by the ones ahead of it, deduped against everything already in the
  // slice so no board is fetched twice in one pass, and capped at the size the
  // bootstrap lane already proved fits the wall-time budget.
  let deepBoards: JobSource[] = [];
  let deepLane: { at: string; candidates: number; selected: number; start: number } | null = null;
  if (!inHotPhase) {
    try {
      const tokens = Object.keys(deepCursors);
      if (tokens.length > 0) {
        const taken = new Set([...baseSlice, ...demandBoards, ...bootstrapBoards].map((s) => s.token));
        const start = cold % tokens.length;
        // Dedupe BEFORE the cap, so a board already in this slice does not
        // spend one of the lane's places on a fetch that will not happen.
        deepBoards = [...tokens.slice(start), ...tokens.slice(0, start)]
          .filter((t) => !taken.has(t))
          .slice(0, DEEP_PER_SLICE)
          .map((t) => JOB_SOURCES.find((s) => s.token === t))
          .filter((s): s is JobSource => !!s);
        // Instrumented for exactly the reason the bootstrap lane is: selected
        // vs candidates separates a token that never resolved to a JobSource
        // from one that was fetched and had nothing left to give. Without that
        // split, an offset that does not move has two indistinguishable causes
        // and gets guessed at — which is how this rotation was misread three
        // times before it carried a number.
        deepLane = { at: new Date().toISOString(), candidates: tokens.length, selected: deepBoards.length, start };
      }
    } catch { /* accelerator only — on any error the cold rotation still reaches every board */ }
  }
  // Board-failure state (streaks + dormancy + last-failure stamps) drives the
  // consecutive-failure prune, the dormancy skip-list AND the retry lane below.
  // Read once here so hot and cold hops share a single read/write, and so cold
  // slices know which dead boards to skip BEFORE fetching. Demand-injected
  // boards are never skipped (a user just opened them).
  //
  // Read BEFORE the slice is sealed (moved up with the retry lane) so the lane
  // can use the failure stamps as its work list.
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
        cap: RETRY_PER_SLICE,
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
  const slice = [...demandBoards, ...bootstrapBoards, ...deepBoards, ...retryBoards, ...baseSlice];
  const startIso = new Date().toISOString();
  const freshCutoffMs = Date.now() - FRESH_WINDOW_DAYS * 86_400_000; // roles older than this are dropped


  // Vendor circuit-breaker state (see constants above): decayed per-vendor
  // feed-zero counters + the currently quarantined vendor set. Key is
  // vendor_breaker — vendor_health belongs to the schema-drift canary action.
  const { data: vhMeta } = await client.from("job_board_meta").select("v").eq("k", "vendor_breaker").maybeSingle();
  const vhV = (vhMeta?.v ?? {}) as { vendors?: Record<string, { a: number; z: number }>; quarantined?: string[] };
  const vendorPrev: Record<string, { a: number; z: number }> = { ...(vhV.vendors ?? {}) };
  const quarantinedVendors = new Set<string>(Array.isArray(vhV.quarantined) ? vhV.quarantined.filter((x): x is string => typeof x === "string") : []);
  const vendorStats = new Map<string, { a: number; z: number }>();
  const quarantineSkipped = new Set<string>();
  let skipTokens = new Set<string>();
  let recheckTokens = new Set<string>();
  if (!inHotPhase) {
    const demandSet = new Set(demandBoards.map((s) => s.token));
    const eligible = baseSlice.map((s) => s.token).filter((t) => !demandSet.has(t));
    ({ skip: skipTokens, recheck: recheckTokens } = classifyDormancy(eligible, boardFailures.dormant, Date.now(), DORMANT_RECHECK_MS));
  }
  // REMOVED 2026-07-25 — the "quiet lane" (boards with no new posting in 14d
  // skip every other rotation, keyed on a `rot` parity counter). Two reasons,
  // either one sufficient:
  //   1. It never ran. The post-slice refresh_progress write omitted `rot`, and
  //      an upsert replaces the whole v JSON — so `rot` was wiped every hop and
  //      read back as 0. The parity test was never true in production.
  //   2. It must not run. It doubles re-verification age for "most of the
  //      catalog at any moment", and the published claim ("every feed
  //      re-verified within a few hours") is an ABSOLUTE bound on P95, not a
  //      median. At any wrap time that keeps the claim true, 2x the wrap
  //      breaks it — the lane can only ever buy throughput by spending the
  //      exact budget the claim owns.
  // Throughput now comes from covering the tail faster (COLD_SLICES_PER_PASS),
  // which costs no board its cadence. get_quiet_boards stays in the DB, unused.

  // The cursor rule (advanceProgress) is shared with the post-slice write
  // below — see rotation.ts for why it is one function and not two hand-kept
  // copies. Both writes emit the WHOLE row it returns.
  const advanceArgs = {
    inHotPhase,
    hotSlice: HOT_SLICE,
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
    await client.from("job_board_meta").upsert(
      { k: "refresh_progress", v: next, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
  }

  const queue = [...slice];
  const okTokens: string[] = [];
  const failed: string[] = [];
  let sliceTotal = 0;
  let lastUpsertError: string | null = null;

  await Promise.all(
    Array.from({ length: inHotPhase ? HOT_CONCURRENCY : CONCURRENCY }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        // Dormant, not due for recheck: skip the dead fetch (no postings to gain,
        // ~20s of FETCH_TIMEOUT to lose). Not counted as attempted below.
        if (skipTokens.has(s.token)) continue;
        let failReason = "";
        // ROTATION PARKED AT ZERO — 2026-08-25, after one deploy.
        //
        // Measured before: CVS Health 678 stored against 19,265 advertised.
        // Measured after a completed pass on .16: exactly 500, and still
        // exactly 500 eleven minutes and one refresh later. O'Reilly 571 -> 500,
        // Trinity 570 -> 500, Wells Fargo 585 -> 498. Every at-cap board
        // converged on one window and LOST rows it previously held.
        //
        // Rows are not churning wholesale — CVS's 500 carry first_seen spread
        // across four different hours today, so they survive passes. But the
        // count is pinned at exactly the window size and 178 rows are gone, so
        // whatever the cursor is doing it is not accumulating, and I could not
        // read job_board_meta as anon to see whether it advanced at all.
        //
        // I promised to park this rather than let it run on a live board while
        // I guessed. The plumbing stays because it is correct and tested; only
        // the non-zero start is withdrawn, which restores exactly the previous
        // fetch behaviour. Re-arming needs the cursor readable first — a
        // deepCursor summary on the status action — so the next attempt can be
        // told apart from this one by a number instead of an inference.
        const r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors[s.token] ?? 0);
        if (!r) {
          failed.push(`${s.name} (vendor${failReason ? `: ${failReason}` : ""})`);
          continue;
        }
        // Advance (or wrap) this board's cursor. Written only for boards that
        // actually paginate, and cleared the moment one wraps, so the row does
        // not accumulate an entry per board in the catalogue.
        if (typeof r.nextOffset === "number") {
          const prev = deepCursors[s.token] ?? 0;
          if (r.nextOffset > 0) { if (prev !== r.nextOffset) { deepCursors[s.token] = r.nextOffset; deepCursorsDirty = true; } }
          else if (prev !== 0) { delete deepCursors[s.token]; deepCursorsDirty = true; }
        }
        // ONE REQUISITION, ONE POSTING — ACROSS A TENANT'S CAREER SITES.
        //
        // A Workday tenant runs several sites (external, subsidiary, campus,
        // per-language) and the same requisition appears on more than one, with
        // Workday's own "-1"/"-2" discriminator making the ids differ so nothing
        // upstream dedupes them. Measured 2026-08-23: 8,993 requisition groups
        // spanned sites, 9,246 redundant postings, 99.9% with byte-identical
        // titles — up to 54% of a single employer's board was the same jobs
        // twice (Boeing JR2025489859 on two sites; one Allegion requisition on
        // five language sites).
        //
        // THE DISCRIMINATOR IS THE CHEAP TELL: the duplicate copy carries the
        // suffix, the original does not. So the check is one small query over
        // only THIS board's suffixed ids — never a tenant-wide scan on the hot
        // path — asking whether the unsuffixed requisition already exists
        // anywhere in the tenant. The stem must keep >=3 digits before the
        // suffix is treated as a discriminator: a naive strip turns
        // Brighthorizons' JR-134112 into "JR" and over-merges 60k rows.
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
              // ONLY ROWS WE HAVE NEVER STORED MAY BE SKIPPED. Filtering a row
              // that is already in the table would make it feed-absent to the
              // prune, which two-passes it into missing_since AND WRITES A
              // CLOSURE EVENT — 9,246 fictional takedowns into the one log
              // this board treats as its uncopyable asset. Stored duplicates
              // are removed by the one-off migration instead, which deletes
              // without touching the closure machinery.
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
            DYNAMIC_LIGHT.add(s.token);
            console.warn(`[JOB-BOARD] auto-light: ${s.token} content payload ${(contentChars / 1e6).toFixed(1)}MB >= threshold — enrolled in light mode (descs via backfill)`);
            try {
              const { error: alErr } = await client.from("job_board_meta").upsert(
                { k: "light_desc_dynamic", v: { tokens: [...DYNAMIC_LIGHT].slice(-AUTO_LIGHT_CAP), updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
                { onConflict: "k" },
              );
              if (alErr) console.warn(`[JOB-BOARD] auto-light persist failed for ${s.token} (re-enrolls next fetch):`, alErr.message?.slice(0, 120));
            } catch { /* re-enrolls on the next fetch — never blocks the slice */ }
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
            DYNAMIC_LIGHT.add(s.token);
            console.warn(`[JOB-BOARD] auto-light: ${s.token} workable payload ${(contentChars / 1e6).toFixed(1)}MB >= threshold — enrolled (descs via backfill)`);
            try {
              const { error: alErr } = await client.from("job_board_meta").upsert(
                { k: "light_desc_dynamic", v: { tokens: [...DYNAMIC_LIGHT].slice(-AUTO_LIGHT_CAP), updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
                { onConflict: "k" },
              );
              if (alErr) console.warn(`[JOB-BOARD] auto-light persist failed for ${s.token}:`, alErr.message?.slice(0, 120));
            } catch { /* re-enrolls on the next fetch — never blocks the slice */ }
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
        const lightDescs = isLight(s.token);
        const rowsById = new Map<string, Record<string, unknown>>();
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
          rowsById.set(j.id, {
            id: j.id,
            source: j.source,
            company_token: j.token,
            company: j.company,
            title: clean(j.title.trim().slice(0, 300)),
            location: clean(j.location.trim().slice(0, 300)),
            country: j.country ?? detectCountry(j.location),
            remote: j.remote,
            work_mode: j.workMode ?? null,
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
              const p = parseSalaryStructured(salaryText, j.country ?? detectCountry(j.location), { title: j.title ?? null, description: lightDescs ? null : (descs.get(j.id) ?? null) });
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
          salary?: string | null;
        };
        const existingRows: Array<ExistingRow> = [];
        let missingColUnknown = false; // pre-migration: column absent → legacy single-pass behavior
        for (let from = 0; ; from += 1000) {
          let res = await client
            .from("job_board_postings")
            .select("id,missing_since,title,location,country,apply_url,work_mode,remote,salary")
            .eq("company_token", s.token)
            .order("id")
            .range(from, from + 999);
          if (res.error?.message?.includes("missing_since")) {
            missingColUnknown = true;
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
          })));
          if (!page || page.length < 1000) break;
        }
        if (!boardOk) {
          failed.push(`${s.name} (db-read)`);
          continue;
        }
        const prefix = `${s.source}:`;
        const existingById = new Map(existingRows.filter((r) => r.id.startsWith(prefix)).map((r) => [r.id, r]));
        const missingSinceById = new Map([...existingById].map(([k, v]) => [k, v.missing_since]));
        const existing = new Set(missingSinceById.keys());
        const liveIds = new Set(rowsById.keys());
        let newRows = rows.filter((r) => !existing.has(r.id as string));
        // AN AGED-OUT POSTING MUST NOT WALK BACK IN. "Already stored" was the
        // only thing suppressing an insert, so a row the freshness sweep had
        // just deleted came straight back on the next rotation — and for the
        // vendors whose list payload carries no date (bamboohr, rippling)
        // ingest cannot tell it is stale, because isDatedBefore only drops a
        // date it KNOWS. Measured 2026-08-24: ~20,600 rows in that loop, a
        // 2014 posting among them with a first_seen of that morning, and an
        // exit ledgered on every lap.
        //
        // An ATS posting id and its posting date are both stable, so the
        // tombstone answers this without re-deriving anything. Best-effort by
        // design: if the table is missing (function deployed ahead of its
        // migration) or the read fails, ingest proceeds exactly as before
        // rather than dropping a board's whole intake.
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

        // ── Two-pass closure confirmation ────────────────────────────────────
        // A posting absent from ONE successful fetch is stamped, not closed: a
        // feed that transiently returns a partial list (HTTP 200, half the
        // jobs) must not mass-log false closures or reset first_seen through
        // delete+reinsert churn. Absent again after the grace window → real.
        //  - reappeared rows get their stamp cleared (flicker fully absorbed);
        //  - EXCEPT rows already past the freshness cap: those delete
        //    immediately, unlogged, exactly as before (and the list query
        //    filters by date anyway, so a stamped row never serves stale).
        //  - shrink ratchet: when a board loses >60% of stored postings in one
        //    pass, closures need a 6h-old stamp — a partial feed outage heals
        //    invisibly; a genuine mass takedown still closes, just later.
        const GRACE_MS = 5 * 60 * 1000;
        const RATCHET_MS = 6 * 60 * 60 * 1000;
        const SHRINK_RATIO = 0.6;
        const nowMs = Date.now();
        let vanished: string[];
        const toStamp: string[] = [];
        let toUnstamp: string[] = [];
        if (missingColUnknown) {
          vanished = vanishedAll; // legacy behavior until the migration applies
        } else {
          const bigShrink = existing.size >= 20 && vanishedAll.length > SHRINK_RATIO * existing.size;
          const needMs = bigShrink ? RATCHET_MS : GRACE_MS;
          if (bigShrink && vanishedAll.length) {
            console.warn(`[JOB-BOARD] ${s.token}: ${vanishedAll.length}/${existing.size} postings vanished in one pass — shrink ratchet holds closures for 6h`);
          }
          // A PARTIAL READ CANNOT PROVE ABSENCE.
          //
          // `windowed` means the vendor advertises more postings than our page
          // cap let us fetch, so every id past the window is "missing" from
          // this pass for a reason that has nothing to do with the employer.
          // Closure LOGGING was already suppressed for exactly this (see
          // truncatedFetch below, and the 2026-07-21 finding that 7 of 8 sampled
          // "closures" on a windowed board were still live) — but the DELETE was
          // not: the `else if (vanished.length)` branch culls them anyway, just
          // silently. With GRACE_MS at five minutes that is close to immediate.
          //
          // Measured 2026-08-25 on the four largest at-cap Workday boards: we
          // hold 2,404 of 41,221 live postings, 6%. CVS Health serves 19,265 and
          // we store 678. A board can only reach 500-a-pass and then lose the
          // overflow, which is why they all sit just above the cap.
          //
          // Age-outs still go, because those are OUR freshness rule and we can
          // prove the date. Everything else on a windowed board waits for the
          // 30-day cap. The cost is that a genuinely closed role on a big board
          // can linger; the alternative is serving 6% of the employer's jobs.
          const partialRead = r.windowed === true;
          vanished = [];
          for (const id of vanishedAll) {
            if (agedOutIds.has(id)) { vanished.push(id); continue; } // freshness cap — no grace, no log
            if (partialRead) continue; // absence unprovable — do not stamp, do not delete
            const stamp = missingSinceById.get(id);
            if (stamp && nowMs - new Date(stamp).getTime() >= needMs) vanished.push(id); // confirmed gone
            else if (!stamp) toStamp.push(id); // first miss — stamp only
            // recent stamp → still in grace, leave as-is
          }
          toUnstamp = [...liveIds].filter((id) => missingSinceById.get(id));
        }
        for (let i = 0; i < toStamp.length; i += 200) {
          const { error: stErr } = await client.from("job_board_postings")
            .update({ missing_since: startIso }).in("id", toStamp.slice(i, i + 200));
          if (stErr) console.warn(`[JOB-BOARD] missing-stamp failed for ${s.token} (retries next pass):`, stErr.message?.slice(0, 120));
        }
        for (let i = 0; i < toUnstamp.length; i += 200) {
          const { error: unErr } = await client.from("job_board_postings")
            .update({ missing_since: null }).in("id", toUnstamp.slice(i, i + 200));
          if (unErr) console.warn(`[JOB-BOARD] missing-unstamp failed for ${s.token} (harmless until next miss):`, unErr.message?.slice(0, 120));
        }

        // UNFREEZE. Until now a row was written once and never corrected:
        // `newRows` filters to ids we do not already hold, so a title the
        // employer edited, a location they fixed, or an apply_url they moved
        // kept our first-ever value forever. Measured 2026-07-29 against live
        // vendor payloads: 1.16% of titles and 0.57% of locations disagree —
        // ~6,800 and ~3,350 rows at current size. The larger cost was
        // structural: every normaliser improvement only ever reached rows
        // inserted after it shipped, which is the same insert-only behaviour
        // that left 70k Workday rows undated.
        //
        // THE SAFETY RULE, and the reason this is narrow: an ingest-time NULL
        // must never overwrite an enriched value. posted_at belongs to the
        // dating sweep, category to the categoriser, description and
        // experience_band to the description fills — none of them appear here
        // at all. work_mode, remote and salary DO appear, but only when the
        // vendor states a value this pass; when the vendor is silent we keep
        // whatever enrichment already found. Overwriting with null would have
        // undone the sweep that took two weeks to get running.
        const corrections: Array<Record<string, unknown>> = [];
        for (const [id, row] of rowsById) {
          const prev = existingById.get(id);
          if (!prev) continue; // brand new — handled by newRows below
          const patch: Record<string, unknown> = {};
          const put = (k: string, next: unknown, cur: unknown, allowNull: boolean) => {
            if (next === null || next === undefined || next === "") { if (!allowNull) return; }
            if (next !== cur) patch[k] = next ?? null;
          };
          // Vendor-authoritative on every fetch: correct these even to null.
          put("title", row.title, prev.title, false);
          put("location", row.location, prev.location, false);
          put("apply_url", row.apply_url, prev.apply_url, false);
          put("country", row.country, prev.country, false);
          // Stated-only: silence from the vendor must not erase enrichment.
          put("work_mode", row.work_mode, prev.work_mode, false);
          put("salary", row.salary, prev.salary, false);
          if (typeof row.remote === "boolean" && row.remote !== prev.remote) patch.remote = row.remote;
          if (Object.keys(patch).length) corrections.push({ id, ...patch });
        }
        // ONE ROUND TRIP PER CHUNK, not per row. This loop used to issue a
        // sequentially-awaited UPDATE for every corrected posting — the only
        // unbatched write in an otherwise consistently 200-250-batched ingest,
        // and hundreds of serial round trips per pass on a churny giant. That
        // time comes straight out of the freshness budget that decides how
        // fast the whole catalog rotates.
        //
        // The patches are PARTIAL and differ per row, so this cannot be a bulk
        // PostgREST update: apply_posting_corrections tests key PRESENCE per
        // column and leaves anything the patch did not mention untouched. A
        // plain bulk update would null out an employer's real salary because a
        // different row's title moved.
        for (let i = 0; i < corrections.length; i += 200) {
          const chunk = corrections.slice(i, i + 200);
          const { error: cErr } = await client.rpc("apply_posting_corrections", { p_patches: chunk });
          if (cErr) {
            // Deploy-before-migration window: the frontend/function can ship
            // ahead of the RPC. Fall back to the old per-row path rather than
            // silently dropping corrections — slow beats wrong, and the next
            // pass picks up the batched path once the migration lands.
            if (cErr.message?.includes("apply_posting_corrections") || (cErr as { code?: string }).code === "PGRST202") {
              for (const c of chunk) {
                const { id, ...patch } = c as { id: string };
                const { error: rowErr } = await client.from("job_board_postings").update(patch).eq("id", id);
                if (rowErr) { lastUpsertError = `${s.token} correct ${String(id).slice(0, 40)}: ${rowErr.message}`; break; }
              }
            } else {
              lastUpsertError = `${s.token} correct batch: ${cErr.message}`;
              break;
            }
          }
        }
        if (corrections.length) console.log(`[JOB-BOARD] ${s.token}: corrected ${corrections.length} existing rows`);

        for (let i = 0; i < newRows.length; i += 250) {
          let { error } = await client.from("job_board_postings").upsert(newRows.slice(i, i + 250), { onConflict: "id" });
          // Deploy-before-migration window: the country column may not exist
          // yet. Ingestion must NEVER stall on a new optional column — retry
          // the chunk without it; the version-gated backfill fills it later.
          if (error?.message?.includes("country")) {
            const stripped = newRows.slice(i, i + 250).map((r) => { const { country: _c, ...rest } = r as Record<string, unknown>; return rest; });
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
        // Log closures BEFORE deleting: the live table hard-deletes, so this is
        // the only record these roles were ever open — it powers per-company
        // hiring-health. Best-effort per chunk: the prune (and board freshness)
        // must never be blocked by the history write, so a failed log still deletes.
        //
        // Accuracy guards — a "closure" must mean the company took the role down:
        //  (a) truncated fetches log NOTHING: an SR board at the SR_CAP ceiling, or
        //      a Workday tenant whose feed total exceeds the page cap (windowed),
        //      has postings displaced past the cap "vanish" while still live —
        //      proven live 2026-07-21: 7/8 sampled "closures" on a windowed board
        //      were still open on the company's own site;
        //  (b) age-outs are skipped: a posting crossing the 30-day freshness window
        //      is dropped at ingest and lands in `vanished` — we removed it, nobody
        //      filled it;
        //  (c) a closure whose exact title is still live at the same company is
        //      marked superseded (repost/relisting churn, not a fill) and excluded
        //      from hiring-health stats.
        // `r.windowed` alone now — the SmartRecruiters row-count proxy is gone.
        //
        // It read `rowsById.size >= SR_CAP`, which cannot tell a board holding
        // exactly the cap from one holding twelve times it, so a company with
        // precisely SR_CAP live postings would have had closure logging
        // suppressed forever. The closure log is the one asset here that cannot
        // be re-derived later, so quietly never writing it for a board is a
        // real cost, not a safe default.
        //
        // The replacement is strictly better informed: `windowed` is computed
        // from the vendor's OWN advertised total against what we actually
        // fetched (feedTotal > content.length), for SmartRecruiters exactly as
        // for Workday and Oracle. A partial fetch — cap hit, or a mid-loop page
        // failure — still reports windowed and still suppresses closures.
        const truncatedFetch = r.windowed === true;
        if (vanished.length && !truncatedFetch) {
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
              const { data: toLog } = await client
                .from("job_board_postings")
                .select("id, source, company_token, company, title, category, first_seen, posted_at")
                .in("id", chunk);
              // (b) aged out, not closed — excluded from the CLOSURE log, but
              // recorded in the EXIT ledger: "still advertised at our 30-day
              // cap" is exactly the event the ghost-rate stat counts, and it
              // was previously deleted without any trace.
              // AN ID WE AGED OUT IS NEVER AN EMPLOYER TAKEDOWN, whatever the
              // stored row says. This filter read the STORED posted_at, which
              // is null for every posting whose vendor states its age only in
              // prose — so a row the ingest filter had just aged out failed
              // the test and fell through to the closure log as a real
              // takedown. agedOutIds is the ingest's own record of what it
              // dropped this pass and is therefore authoritative here.
              const isAgedOut = (r: Record<string, unknown>) => {
                if (agedOutIds.has(String(r.id))) return true;
                const posted = r.posted_at ? new Date(String(r.posted_at)).getTime() : NaN;
                return Number.isFinite(posted) && posted < freshCutoffMs;
              };
              const agedRows = ((toLog ?? []) as Array<Record<string, unknown>>).filter(isAgedOut);
              if (agedRows.length) {
                waitUntil(Promise.resolve(client.from("job_board_exits").insert(
                  agedRows.map((r) => ({
                    posting_id: String(r.id),
                    source: String(r.source ?? s.source),
                    company_token: String(r.company_token ?? s.token),
                    category: String(r.category ?? "other"),
                    exit_reason: exitReasonFor(r.posted_at, r.first_seen),
                    days_on_board: r.posted_at
                      ? Math.round((Date.now() - new Date(String(r.posted_at)).getTime()) / 8_640_000) / 10
                      : null,
                    exited_at: closedAt,
                  })),
                )).then(() => {}).catch(() => {}));
              }
              const rows = ((toLog ?? []) as Array<Record<string, unknown>>).filter((r) => {
                if (isAgedOut(r)) return false; // (b) aged out, not closed
                const norm = normalizeCloseTitle(String(r.title ?? ""));
                return !(liveTitles.has(norm) && recentSuperseded.has(norm)); // superseded repeat within 24h — skip
              });
              if (rows.length) {
                // supabase-js RETURNS errors (never throws) — check it, or a
                // failing insert silently loses lifecycle history (the same
                // blind spot that hid the verification-stamp failures).
                const { error: clErr } = await client.from("job_board_closures").insert(
                  rows.map((r) => ({
                    posting_id: r.id,
                    source: r.source,
                    company_token: r.company_token,
                    company: r.company ?? "",
                    title: r.title ?? "",
                    category: r.category ?? "other",
                    first_seen: r.first_seen ?? null,
                    posted_at: r.posted_at ?? null,
                    closed_at: closedAt,
                    superseded: liveTitles.has(normalizeCloseTitle(String(r.title ?? ""))), // (c)
                  })),
                );
                if (clErr) console.warn(`[JOB-BOARD] closure insert failed for ${s.token} (non-fatal):`, clErr.message?.slice(0, 150));
                // Exit ledger, 'removed' side: the same events, tagged, into the
                // table the ghost-rate stat will read once accrual clears its
                // floor. Best-effort — the closures row above is the record of
                // record; this must never make a prune fail.
                waitUntil(Promise.resolve(client.from("job_board_exits").insert(
                  rows.map((r) => ({
                    posting_id: r.id,
                    source: r.source,
                    company_token: r.company_token,
                    category: r.category ?? "other",
                    exit_reason: "removed",
                    days_on_board: (r.posted_at ?? r.first_seen)
                      ? Math.round((Date.parse(closedAt) - Date.parse(String(r.posted_at ?? r.first_seen))) / 8_640_000) / 10
                      : null,
                    exited_at: closedAt,
                  })),
                )).then(() => {}).catch(() => {}));
              }
            } catch (e) {
              console.warn(`[JOB-BOARD] closure log failed for ${s.token} (non-fatal):`, String(e).slice(0, 150));
            }
            const { error: delErr } = await client.from("job_board_postings").delete().in("id", chunk);
            if (delErr) console.warn(`[JOB-BOARD] closure prune delete failed for ${s.token} (non-fatal):`, delErr.message?.slice(0, 150));
          }
        } else if (vanished.length) {
          // Truncated fetch: prune without logging — can't distinguish closed from displaced.
          for (let i = 0; i < vanished.length; i += 200) {
            await client.from("job_board_postings").delete().in("id", vanished.slice(i, i + 200));
          }
        }
        okTokens.push(s.token);
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
        sliceTotal += rows.length;
      }
    }),
  );

  // Advance cursors — SAME rule as the optimistic write above, because it is
  // literally the same function (rotation.ts). This write lands last and wins,
  // so any divergence here is what production actually does: on 2026-07-25 this
  // site advanced by `slice.length` (base 80 + up to 25 bootstrap + 5 demand
  // boards, which come from elsewhere in the catalog and consume no cursor),
  // skipping 24% of the cold list every rotation and pushing measured P95
  // re-verification past the published claim while the median looked healthy.
  // A CAP IS NOT A COUNT. This kept the last 120 entries, and every consumer
  // — the list response, status, and a whole day of my own analysis — read
  // that 120 as "the number of boards failing". It is the ceiling. The real
  // figure was never published, so a pass failing 120 boards and one failing
  // 3,000 were indistinguishable, and the class breakdown computed from the
  // retained window is a sample of the pass's TAIL, not of the population.
  //
  // The array stays bounded (it lives in a meta row), but the count travels
  // with it now.
  const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);
  const failedTotal = (Number(pv.failedTotal) || 0) + failed.length;
  const { next: progressAfter, wrapped } = advanceProgress({
    prev: { ...progressBefore, failedAcc, failedTotal },
    ...advanceArgs,
  });
  hot = progressAfter.hot;
  cold = progressAfter.cold;
  coldDone = progressAfter.coldDone;
  // The cold cursor just wrapped past the end → the ENTIRE cold tail has now
  // been re-verified. Stamp it: this is the direct measurement of freshness
  // (max staleness of any cold posting = time since this stamp). The heartbeat
  // alerts if it ever falls behind the SLA.
  if (wrapped) {
    await client.from("job_board_meta").upsert(
      { k: "cold_rotation", v: { completedAt: new Date().toISOString(), coldBoards: COLD_LIST.length }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
  }
  const passDone = isPassDone(progressAfter, HOT_LIST.length, COLD_SLICES_PER_PASS);

  await client.from("job_board_meta").upsert(
    { k: "refresh_progress", v: progressAfter, updated_at: new Date().toISOString() },
    { onConflict: "k" },
  );

  // Consecutive-failure pruning + dormancy: a feed that stops responding keeps its
  // postings (a transient blip must not wipe a company), but a feed dead for
  // DEAD_BOARD_THRESHOLD straight attempts is gone for good — prune its stale
  // postings AND mark it dormant so future rotations skip the dead fetch (see the
  // dormancy skip-list at the top of the slice). okTokens clear both streak and
  // dormancy; a failed recheck probe stays dormant with a refreshed timer. Skipped
  // dormant boards weren't attempted, so they don't count as failures here.
  // (Verification stamping happens per-board inside the slice loop — hop-end
  // code is unreliable on heavy hops; see the stamp at okTokens.push.)
  {
    const okSet = new Set(okTokens);
    const failedTokens = slice
      .map((s) => s.token)
      .filter((tk) => !skipTokens.has(tk) && !quarantineSkipped.has(tk) && !okSet.has(tk));
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
        // Best-effort: losing this costs a board one restarted pass, never a row.
        //
        // The lane's own counters ride in this same row under a key that is not
        // a token, so they need no second meta key and no extra read in the
        // status bundle. Both readers of this row keep only positive integer
        // values, so a nested object here is inert to them: it cannot enter the
        // cursor map, and it cannot disturb boards/maxOffset/sumOffset. Written
        // when the lane ran even if no cursor moved — "ran and selected none"
        // is precisely the state that has to be distinguishable.
        await client.from("job_board_meta")
          .upsert({ k: "deep_cursor", v: { ...deepCursors, ...(deepLane ? { __lane: deepLane } : {}) }, updated_at: new Date().toISOString() }, { onConflict: "k" })
          .then(({ error }) => { if (error) console.warn("[JOB-BOARD] deep_cursor write failed:", error.message?.slice(0, 120)); });
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
    // ONE POOL SAMPLE PER COMPLETED PASS. This is the entire basis for the
    // board's published growth number, which is now OBSERVED (sample at the
    // window start differenced against the pool now) rather than inferred from
    // `intake - closed`. That inference shipped twice today and was wrong both
    // times, most recently by 2.8x measured against this very quantity.
    //
    // BEFORE the facets call, not after: facets returns early when its RPC is
    // unavailable, and a growth series that quietly stops accruing whenever a
    // different RPC is down is a series that reads "flat" for the wrong reason.
    // Best-effort — never fail a pass for a metric.
    {
      const { data: sampled, error: sErr } = await client.rpc("record_board_pool_sample");
      if (sErr) console.warn("[JOB-BOARD] pool sample failed (non-fatal):", sErr.message?.slice(0, 140));
      else console.log(`[JOB-BOARD] pool sample recorded: serving=${sampled}`);

      // AND CACHE THE FLOW HERE, so status never computes it per request.
      // withDeadline is a Promise.race: losing the race abandons the promise but
      // the statement keeps running to its 15s statement_timeout. Calling this
      // from status meant every status hit paid for the counts and usually
      // displayed null anyway — measured during the 2026-08-17 22:07Z outage,
      // when freshness, dateCoverage and boardFlow were all null together while
      // ordinary reads timed out. Once per pass, read from meta thereafter.
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

    // Facets from the database — always true to what the board serves. If
    // the RPC isn't migrated yet (function published before migration ran),
    // keep the previous meta instead of clobbering it with zeros.
    // refresh_job_board_facets, NOT get_job_board_facets. The read function now
    // serves a CACHED row so page views stop timing out over 584k rows — and the
    // orphan prune below DELETES postings from the company list it gets back. A
    // destructive path computes its own input rather than trusting a cache.
    const { data: facets, error: facetsErr } = await client.rpc("refresh_job_board_facets");
    const f = (facets ?? {}) as Record<string, unknown>;
    if (facetsErr || !f.total) {
      console.warn("[JOB-BOARD] facets RPC unavailable — previous refresh meta kept:", facetsErr?.message ?? "empty result");
      return { ok: true, detail: `pass complete but facets RPC unavailable (${facetsErr?.message ?? "empty result"}) — run migration 20260712080000` };
    }
    let companies = Array.isArray(f.companiesFacet) ? f.companiesFacet : [];

    // Orphan prune: a board removed from sources.ts is never fetched again, so
    // its postings would linger forever. Diff the DB's live company list
    // (from the facets we just computed) against the source of truth and
    // delete any token no longer aboard — so a removal actually disappears.
    //
    // STALE-BUNDLE GUARD (2026-07-15 incident): a re-deploy that ships an OLDER
    // bundle sees every board added since as an "orphan" and wipes its real
    // postings — a stale pre-Rung-3 bundle deleted the new vendors' entire
    // ingestion this way, silently. A catalog high-water mark in meta makes the
    // prune refuse to run from any bundle smaller than the largest ever deployed;
    // an intentional catalog SHRINK must lower the mark via {action:"refresh",
    // resetCatalogHighwater:true} with the chain key.
    const validTokens = new Set(JOB_SOURCES.map((s) => s.token));
    const { data: hwRow } = await client.from("job_board_meta").select("v").eq("k", "catalog_highwater").maybeSingle();
    const highwater = Number((hwRow?.v as { size?: number } | null)?.size) || 0;
    if (JOB_SOURCES.length < highwater) {
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
    }

    // Date hygiene: repair any stored posted_at that's junk (future, or
    // pre-2000 epoch-zero/typo territory). New inserts are already sanitized
    // at ingestion; this fixes rows stored before that guard. UPDATE, not
    // delete — the posting is still live, only its date was junk. Real-but-old
    // dates are NOT nulled here: nulling a 3-year-old evergreen's date is what
    // used to keep it alive undated past the 30-day promise — those rows now
    // age out at ingest instead. Self-terminating: once nulled a row stops
    // matching, so later passes update nothing.
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
      // Ledger BEFORE deleting: this sweep runs every pass while a board is only
      // re-fetched on rotation, so it wins the race for most age-outs. Writing
      // nothing here meant the aged_out side of the ghost-rate stat counted a
      // small minority of real events (bug sweep 2026-07-26). Best-effort: the
      // prune itself must never fail because the ledger did.
      // TOMBSTONE BEFORE LEDGERING, and ledger only what is newly dead.
      //
      // Deleting alone did not stick: the next rotation re-inserted every row
      // (ingest suppresses on "already stored", and the row was no longer
      // stored), so the same postings aged out again and again — ~20,600 of
      // them, each lap writing another exit. "Roles filled or closed today"
      // was counting the loop. The tombstone both stops the re-entry and
      // tells us which ids have already been counted: an id we have seen die
      // before is not news.
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
          const { data: agedRows } = await client
            .from("job_board_postings")
            .select("id, source, company_token, category, posted_at, first_seen, effective_posted")
            .in("id", slice);
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
          const freshlyDead = agedRows.filter((r) => !alreadyTombstoned.has(String(r.id)));
          if (freshlyDead.length === 0) continue;
          waitUntil(Promise.resolve(client.from("job_board_exits").insert(
            freshlyDead.map((r) => ({
              posting_id: r.id as string,
              source: r.source as string,
              company_token: r.company_token as string,
              category: (r.category as string) ?? "other",
              exit_reason: exitReasonFor(r.posted_at, r.first_seen),
              days_on_board: (r.posted_at ?? r.first_seen)
                ? Math.round((Date.parse(exitedAt) - Date.parse(String(r.posted_at ?? r.first_seen))) / 8_640_000) / 10
                : null,
              exited_at: exitedAt,
            })),
          )).then(() => {}).catch(() => {}));
        }
      }
      let dropped = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await client.from("job_board_postings").delete().in("id", ids.slice(i, i + 200));
        if (error) { console.warn("[JOB-BOARD] freshness sweep delete error:", error.message); break; }
        dropped += Math.min(200, ids.length - i);
      }
      if (dropped > 0) console.log(`[JOB-BOARD] freshness cap: dropped ${dropped} postings older than ${FRESH_WINDOW_DAYS}d`);
      // Tombstones expire, so the table stays bounded and a vendor that
      // recycles posting ids eventually gets a second chance. 180 days is far
      // past any window in which a re-fetched id could still be the same
      // aged-out job.
      try {
        await client.from("job_board_aged_out").delete()
          .lt("aged_at", new Date(Date.now() - 180 * 86_400_000).toISOString());
      } catch { /* bounded cleanup — never worth failing a pass over */ }
    }

    // Capacity governor (see CORPUS_CEILING). This gates a destructive op, so
    // don't reuse the orphan-inflated facet total — and don't evict on an
    // estimate either.
    //
    // The exact count stopped fitting the statement timeout as the table grew
    // past ~590k (measured 2026-08-06). `corpusSize ?? 0` then read as a corpus
    // of ZERO, which is not merely wrong but wrong in the safe-looking
    // direction: eviction never fires, and the meta row below published
    // `headroom = ceiling`, so the heartbeat's capacity check saw maximum
    // headroom and passed. The guard had switched itself off and reported
    // healthy while doing it.
    //
    // So: the planner estimate is the routine watch signal (0.1s), and the
    // expensive exact count is attempted ONLY when that estimate says we are
    // near the ceiling and the answer could actually authorize a deletion.
    // Eviction still requires an exact number — never an estimate.
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

    // WHAT EACH FILTER WOULD COST THE SEARCHER, computed once per pass.
    //
    // A filter here is honest — it excludes rows whose value we genuinely do
    // not know — but it is silent, and the silence is the problem. MEASURED
    // against 599,316 open postings: salary is stated on 12.9%, so setting a
    // salary floor discards 87% of the board; work mode on 29.9%; experience on
    // 40.4%. Someone who sets a floor believes they are looking at the market
    // and is looking at an eighth of it, with nothing on screen to say so.
    //
    // Counted HERE rather than per request: four exact counts on a 600k table
    // is nothing once an ingest pass, and unaffordable on every search. head:true
    // sends no rows. A failure leaves coverage absent, and the UI shows nothing
    // rather than a wrong fraction — an invented coverage number would be worse
    // than none, since it would be believed.
    const coverage = await (async () => {
      // The numerator must stand on the SAME population as the denominator.
      // `open` below applies the freshness window; this did not, so every
      // published fraction was a count over one population divided by the
      // size of a smaller one — inflating each by 1.5-3%. A coverage figure
      // whose two halves disagree about what the board is cannot be right
      // even when it looks plausible.
      const freshIso = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString();
      // A FAILED COUNT WAS INDISTINGUISHABLE FROM A COLUMN NOBODY POPULATES.
      //
      // This discarded the error and returned null, and null is published as
      // "no figure" — so a count that timed out deleted a disclosure instead of
      // reporting a problem. Measured live 2026-08-27: filterCoverage was
      // publishing ONE of its four figures ({"experience":0.394}), meaning a
      // searcher who set a pay floor was seeing ~20% of the board and being
      // told nothing, and one who set a work mode was seeing ~28% and being
      // told nothing. These disclosures are the whole reason a NULL-discarding
      // filter is allowed to exist here.
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
      try {
        // THE HEADLINE MUST COUNT WHAT THE BOARD CAN SERVE. This counted
        // missing_since alone, while the read path also requires
        // effective_posted within the freshness window — so the published
        // total ran 6,809 HIGH (582,839 published, 576,030 servable, measured
        // 2026-08-23). Three consequences from one missing predicate: the
        // homepage claimed a 30-day-filtered count while showing an unfiltered
        // one, with client comments asserting the opposite; the pagination
        // fence, fed this number, admitted 6,809 offsets that each walk the
        // whole index for ~4s and return zero rows; and the "servable postings
        // unreachable behind the fence" defect reported earlier today was this
        // same gap, read in the wrong direction — nothing was ever fenced off.
        const { count: open } = await client.from("job_board_postings")
          .select("id", { count: "exact", head: true }).is("missing_since", null)
          .gte("effective_posted", new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString());
        if (!open) return undefined;
        // ONE PROMISE MORE THAN THERE WERE NAMES TO BIND IT TO, AND EVERY
        // NUMBER AFTER IT SHIFTED. A fourth count (salary_max_annual) was
        // added here for a pay-CEILING filter that was subsequently refused
        // with data, and it was inserted SECOND in the array while the
        // destructuring still read [sal, wm, exp]. So the board published the
        // salary-ceiling coverage as its work-mode figure and the work-mode
        // coverage as its experience figure, and the experience count was
        // computed and thrown away. Measured live 2026-08-24: the page said
        // work mode 14% (really 29.1%) and experience 30% (really 42.1%) —
        // the board was understating its own coverage by half while the
        // caveat text told readers to trust exactly those numbers.
        //
        // The ceiling count is deleted rather than bound: its only consumer
        // was a refused feature, and a live count with no reader is what
        // caused this.
        const [sal, wm, exp, ctry] = await Promise.all([
          one("salary_rank_usd", "not.is.null"),
          one("work_mode", "not.is.null"),
          one("experience_band", "neq.unspecified"),
          // Country had NO caveat at all while pay, work mode and experience
          // each had one — and it is the thinnest of the four on some
          // vendors. Teamtailor used to be the worst of them at 0 rows, but
          // that was OUR parser discarding tt:country, not the vendor
          // withholding it — fixed 2026-08-25, so those 10,858 rows resolve a
          // country as they re-ingest. The caveat stands on its own merits: a
          // filter
          // that silently hides a quarter of the board is exactly what this
          // disclosure exists to prevent.
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
        return {
          open,
          salaryFloor: keep("salaryFloor", sal),
          workMode: keep("workMode", wm),
          experience: keep("experience", exp),
          country: keep("country", ctry),
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
      categoriesFacet: f.categoriesFacet ?? {},
      ...(coverage ? { coverage } : {}),
      refreshedAt: startIso,
    };
    await client.from("job_board_meta").upsert({ k: "refresh", v, updated_at: new Date().toISOString() }, { onConflict: "k" });
    // THE SERVING PATH GETS ITS OWN SMALL ROW.
    //
    // `v` above is 1.3-1.6MB, essentially all of it companiesFacet — one entry
    // per employer, ~23,500 of them. Every list request read the whole thing to
    // use two things from it: the LENGTH, and the top handful for the employer
    // chips. Measured on the offset-ceiling exit (which does this read and no
    // query of its own): median ~700ms, 55-70% of a plain browse.
    //
    // An in-isolate TTL cache was tried first and does NOT work: module-level
    // state does not survive between requests in this runtime. Fourteen
    // consecutive offset-ceiling requests, six of them on one TCP connection
    // less than a second apart, all cost 452-1,034ms against a 60s TTL — zero
    // hits. So the fat row is not cached; it is simply not read.
    //
    // companiesCount is stored EXPLICITLY rather than left to be derived from
    // the truncated head, because a length taken from a 200-row slice would
    // publish "200 employers" as a fact. Its presence is also what the reader
    // uses to tell this shape from the old one — see the read site.
    const vHead = {
      total: v.total,
      boards: v.boards,
      failedSources: v.failedSources,
      failedCount: v.failedCount,
      categoriesFacet: v.categoriesFacet,
      ...(coverage ? { coverage } : {}),
      refreshedAt: v.refreshedAt,
      companiesCount: companies.length,
      companiesFacet: [...companies].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 200),
    };
    await client.from("job_board_meta").upsert({ k: "refresh_head", v: vHead, updated_at: new Date().toISOString() }, { onConflict: "k" });
    // Re-rank the hot tier from what the corpus actually holds now: velocity
    // leaders (most postings first_seen inside the window — the boards where
    // new jobs actually appear) take guaranteed slots, size leaders fill the
    // rest. RPC missing (migration lag) degrades to pure size ranking.
    // HOT-TIER EXCLUSIONS. get_board_velocity filters showcase_excluded, but
    // the SIZE ranking below is a second, independent door into the hot tier —
    // and the board this exists for (Domino's, 24,566 postings) would top it
    // outright. Filtering one door and not the other would have let it in
    // anyway, which is the kind of half-fix that reads as done and is not.
    //
    // Cadence only, never coverage: an excluded board keeps full cold-tier
    // refresh. The hot tier re-fetches every ~10-15 min at HOT_CONCURRENCY=2
    // because its members are giants; a per-store delivery-driver vacancy does
    // not need that, and the slot goes to a board where a stale posting costs
    // someone a real application.
    //
    // A failed read yields an EMPTY set — the previous behaviour, one giant in
    // the hot tier — rather than an empty hot tier. Degrading to "slightly
    // expensive" beats degrading to "nothing gets refreshed often".
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
      })).then((r) => r.text()).catch(() => {}));
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
      })).then((r) => r.text()).catch(() => {}));
    }
    // FILTER AUDIT KICK — the scheduled half of the filter contract.
    //
    // Self-invoked from the refresh path rather than driven by pg_cron, for a
    // concrete reason: filter-audit is chainKey-gated, and chainKey is derived
    // inside the function, so a cron row in Postgres cannot produce one. The
    // sweeps here already solve that by having the function call itself with its
    // own key, and reusing that path means the audit inherits a scheduler that
    // is already proven to fire.
    //
    // Once every 6 hours is deliberate. The audit issues ~30 real HTTP requests
    // against this same function, including a 4-page pagination walk; running it
    // per refresh would put a measurable synthetic load on the board it is
    // supposed to be watching. Six hours is frequent enough that a filter
    // regression is caught the same day it ships — the defects it was built from
    // had been live for an unknown period because nothing asked.
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
      ).then((r) => r.text()).then(() => {}).catch(() => {}));
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
      // Resume ONLY state written by this sweep version. v4 retired the
      // "workday" phase, but the stored v3 state was replayed verbatim:
      // line ~2486 coerced the unknown phase to "bamboohr" while the cursor
      // below stayed "workday:..." — so hop 1 queried
      //   source=bamboohr AND id > 'workday:...'
      // and since 'b' < 'w' it matched 0 rows, was declared exhausted, and the
      // sweep stamped itself complete having dated nothing. Measured
      // 2026-07-28, 37h after v4 shipped: bamboohr 43,687/43,687 undated and
      // rippling 8,991/8,991 undated (100%), against greenhouse 0.8% and
      // ashby 0.0%. 52,678 postings that no freshness filter or day-partitioned
      // sitemap can ever see.
      const resume = pbV.resumeVersion === POSTED_BACKFILL_VERSION
        && typeof pbV.phase === "string" && typeof pbV.cursor === "string"
        ? { phase: pbV.phase, cursor: pbV.cursor }
        : {};
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-posted", chainKey: key, ...resume }),
      })).then((r) => r.text()).catch(() => {}));
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
        // THE v2 RUN GOT FOURTEEN BOARDS IN AND STOPPED, AND ALMOST SAID IT WAS DONE.
        //
        // Measured against production after the v2 sweep: tokens 1-14 of
        // RENAMED_TOKENS were renamed and 15-29 were untouched, plus two
        // individual failures inside that prefix (hdsupply, weis — both boards
        // with large historical row counts). Two distinct faults:
        //   1. individual UPDATEs time out on boards with many rows, and the
        //      old loop recorded that only by not incrementing `fixed`;
        //   2. the run itself ran out of budget partway down the list.
        //
        // And the stamp was UNCONDITIONAL. A run that reached the end having
        // failed every single update still wrote its version and was never
        // retried — the sweep would report success forever having changed
        // nothing. That is the same failure this whole week has been about.
        //
        // Three changes, all aimed at "a partial run must be resumable and must
        // not claim completion":
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
      })).then((r) => r.text()).catch(() => {}));
    }

    await maybeKickMaintenance(client);
    return { ok: true, detail: `pass complete — corpus ${f.total} postings from ${companies.length} boards; cold rotation at ${cold}/${COLD_LIST.length}${lastUpsertError ? ` — last upsert error: ${String(lastUpsertError).slice(0, 120)}` : ""}` };
  }

  // Maintenance also gets a chance on EVERY slice, not only at pass end.
  // Measured 2026-07-25: desc-sweep and the v5 recategorise had never run once,
  // because both were gated behind a completed cold rotation — 27,997 boards,
  // many hours — and every deploy resets the bootstrap lane that runs ahead of
  // it. The result was ~460k postings still without descriptions and ~81k still
  // in "other" despite the work being built and deployed. maybeKickMaintenance
  // throttles itself, so a slice cadence costs one small meta read per slice.
  await maybeKickMaintenance(client);
  if (chainHop < CHAIN_CAP) chainNextSlice(chainHop, client);
  const phase = inHotPhase ? `hot ${Math.min(hot, HOT_LIST.length)}/${HOT_LIST.length}` : `cold slice ${coldDone}/${COLD_SLICES_PER_PASS} (rotation ${cold}/${COLD_LIST.length})`;
  return { ok: true, detail: `slice done (${sliceTotal} postings, ${failed.length} failed) — ${phase}` };
}

// ── maintenance kicks ──────────────────────────────────────────────────────
// Same rules as before, just reachable. Called from BOTH the pass-complete path
// and every slice, so it carries its own throttle: without one, recategorize —
// which has no age gate of its own and re-fires until its stamp is written at
// COMPLETION — would spawn a new chain on every slice.
// Grace before a verify-on-apply miss is allowed to destroy a row. Deliberately
// longer than the refresh prune's 5-minute GRACE_MS: that one corroborates a
// miss against a FULL feed re-read, while this one has only a single-posting
// probe whose false-negative rate is measured at 14% on Workday. One cold
// rotation must be able to clear the stamp before anything is deleted.
const VERIFY_GRACE_MS = 6 * 60 * 60_000;

const MAINTENANCE_ANY_GAP_MS = 10 * 60_000; // floor between any two kicks
// A maintenance chain restamps its progress row every invocation/hop. If that
// row hasn't moved in this long, the chain is DEAD (waitUntil self-invocation
// is best-effort; measured 2026-07-25 when the v5 recategorise died ~15.5k rows
// in and, under the old flat 2-hour same-action gap, would have restarted from
// scratch hours later — putting desc-sweep's ~460k rows weeks out). Liveness by
// stamp age means: fresh stamp -> chain alive, skip; stale -> re-kick NOW and
// resume from stored progress. Recovery rides the refresh heartbeat, which is
// the one reliably-scheduled thing in this system.
const MAINTENANCE_STALL_MS = 12 * 60_000;

async function maybeKickMaintenance(client: SupabaseClient): Promise<void> {
  try {
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
      })).then((r) => r.text()).catch(() => {}));
    };

    // HEADLINE COUNT — the cheapest independent track there is.
    //
    // The published board total used to move only when a rotation pass ended,
    // so it was as stale as the pass was long: measured 2026-08-26, a pass that
    // had just finished had STARTED 6.7 hours earlier, and the headline was
    // still quoting that start. While the at-cap lane was adding twelve
    // thousand postings to a single employer, the number on the page could not
    // say so for most of a day.
    //
    // One RPC, one statement, 0.63s measured against 550,227 rows. It patches
    // only the count and its own timestamp — never the whole meta row — so it
    // cannot race the pass-end writer into dropping a facet.
    //
    // Kicks and FALLS THROUGH, and does not even take the kick stamp: it is a
    // single query rather than a chain, so it cannot starve the exclusive
    // ladder the way a returning track would. waitUntil keeps it off the
    // response path entirely.
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

    // Country backfill runs as an INDEPENDENT track: it is pure DB work (no
    // vendor fetches), so it does not queue behind the fetch-heavy ladder.
    // Re-runs when the city table version bumps; resumes a dead chain from its
    // cursor.
    //
    // Track kicks are NON-EXCLUSIVE — kick and fall through, never return.
    // The original return-after-kick was framed as "a bounded politeness
    // cost", and for country (hours of DB work) it was. The embed track
    // broke the bound: its chain is days of CPU-heavy inference whose hops
    // die on every isolate recycle, so it needed a revival on essentially
    // every 10-minute cycle — and each revival returned, starving desc-sweep
    // of its own recovery kicks. Measured 2026-07-25: desc_sweep stamp went
    // 150 minutes stale mid-workday (refresh loop alive the whole time)
    // starting exactly at the deploy that introduced the embed track. A track
    // revival is one waitUntil fetch; running it alongside a ladder kick is
    // exactly the concurrency these tracks were designed for.
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

    // Posted-date backfill — the SAME starvation desc-sweep and recategorise
    // hit on 2026-07-25, except this one was left behind when they were moved
    // to the slice cadence. Its only kick still sits in the FULL-PASS branch,
    // which requires a completed 120-slice cold rotation, so in practice it
    // never ran: measured 2026-07-28, bamboohr dated = 0 AND rippling dated = 0
    // for 3h09 straight after the sweep was deliberately re-armed at
    // POSTED_BACKFILL_VERSION 5 and confirmed deployed. The code was correct
    // and simply unreachable.
    //
    // Independent track: it does fetch vendors, but self-paces at one detail
    // call per posting with IDS_PER_HOP=120 and BACKFILL_HOP_PAUSE_MS between
    // hops, so it must not queue behind the fetch-heavy exclusive ladder.
    // Resume state is version-keyed (see the kick in runRefresh) so stale v4
    // state can never be replayed.
    const pb = await alive("posted_backfill");
    const pbv = (pb.v ?? {}) as { version?: number; sweptAt?: string; resumeVersion?: number; phase?: string; cursor?: string; backlogAtSweep?: number };
    if (!pb.alive && postedBackfillDue(pbv, await undatedBacklog(client))) {
      const pbResume = pbv.resumeVersion === POSTED_BACKFILL_VERSION
        && typeof pbv.phase === "string" && typeof pbv.cursor === "string"
        ? { phase: pbv.phase, cursor: pbv.cursor }
        : {};
      await kick("backfill-posted", pbResume);
    }

    // Work-mode recovery — the fourth INDEPENDENT track, and it sits up here
    // with the others for a reason I got wrong the first time.
    //
    // It was originally placed at the very end of this function, after the
    // desc_sweep kick. It never fired: measured over 13 minutes across four
    // status polls, `structuredSweep` stayed all-null while every other chain
    // ran. Two branches below — the recategorise sweep and backfill-desc —
    // `return` after kicking, so anything after them only runs on cycles where
    // neither fires, and the last position in the sequence is the most starved
    // one available. That is the same starvation the note at the top of this
    // block records for desc-sweep, reproduced by adding a track without
    // reading its own warning.
    //
    // RESUMES, never restarts. desc-sweep re-kicks at vi:0 safely because its
    // predicate is self-clearing; this one's is not. Rows still work_mode-null
    // after a pass are the ones whose detail states no remoteType, permanently,
    // so restarting at cursor "" would re-fetch every one of them.
    const ss = await alive("structured_sweep");
    const ssDone = typeof ss.v?.doneAt === "string" ? Date.parse(ss.v.doneAt as string) : NaN;
    // 24h, not desc-sweep's 6: a posting's remoteType does not change, so
    // re-walking sooner buys nothing but vendor requests.
    const ssSettled = Number.isFinite(ssDone) && Date.now() - ssDone < 24 * 60 * 60_000;
    // BACK OFF WHEN THE LANE IS PRODUCING NOTHING.
    //
    // The classifier bug meant every pass wrote 0 rows — and the lane happily
    // re-issued ~154,000 Workday detail fetches every 24 hours to keep doing
    // it, indefinitely. A cadence that ignores its own output is a cadence that
    // cannot notice it has stopped working. Two consecutive zero-write passes
    // now stretch the interval geometrically (24h, 48h, 96h, capped at a week)
    // instead of hammering vendors for nothing. Any pass that writes a single
    // row resets it, so the fixed classifier restores the 24h cadence on its
    // first successful pass without anyone intervening.
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
    // Self-healing override: if meaningful description coverage is still
    // missing on the light boards, run regardless of the stamp — recovers from
    // a stamp written by an older/buggy sweep without a manual reset.
    const lightTokens = JOB_SOURCES.filter((s) => isLight(s.token)).map((s) => s.token);
    let missingCoverage = false;
    if (lightTokens.length > 0 && bfAge > 30 * 60_000) {
      const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).in("company_token", lightTokens).is("description", null);
      missingCoverage = (count ?? 0) > 50;
    }
    if (missingCoverage || bfAge > (bfIncomplete ? 60 * 60_000 : 24 * 60 * 60_000)) {
      await kick("backfill-desc", { ti: 0, off: 0 });
      return;
    }
    // desc-sweep: the per-posting vendors (workday/SR/bamboohr/oracle/breezy).
    // Every hop restamps desc_sweep, so a live chain keeps the age small and
    // can't be double-started; a chain that dies is picked up after six hours.
    //
    // Restarting from vi:0 is deliberate — rows filled since last time have
    // dropped out of the `description is null` filter, so a fresh run resumes
    // where the DATA left off rather than where a cursor did.
    const ds = await alive("desc_sweep");
    const doneAt = typeof ds.v?.doneAt === "string" ? Date.parse(ds.v.doneAt as string) : NaN;
    // Completed runs settle to a 6-hour cadence (only the delta needs work);
    // a dead chain — stale stamp, no doneAt — re-kicks within minutes. vi:0 is
    // self-resuming: filled rows have left the description-is-null filter.
    const settled = Number.isFinite(doneAt) && Date.now() - doneAt < 6 * 60 * 60_000;
    if (!ds.alive && !settled) {
      // ROTATE THE STARTING VENDOR. vi:0 on every revival was measured
      // starving the tail of DETAIL_DESC_SOURCES (2026-08-24): chains die on
      // isolate recycles, every revival restarted at workday's 36k
      // permanent-failure nulls, and breezy — 5th of 6 — had received ~10
      // lifetime hops against an 11.6k backlog its endpoint serves fine
      // (probed 12/12 HTTP 200). Each revival now starts one vendor past
      // where the last chain stood; the action wraps a full rotation, so no
      // vendor is skipped and every vendor leads eventually. Still no row
      // cursor — the description-is-null filter remains the resume point
      // (the original vi:0 rationale, kept for what it was right about).
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
 *  worth omitting, never worth delaying the deploy answer for. */
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

const detailCache = new Map<string, { at: number; text: string }>();
const DETAIL_TTL_MS = 60 * 60_000;

// ── semantic embeddings (gte-small, in-runtime) ────────────────────────────
// One session per isolate, created lazily: the docs' own examples construct it
// at module scope for reuse, and the defensive global access means local
// tooling (deno check, vitest) that lacks the Supabase global still parses.
// Each embedding costs ~100-200ms of the 2s per-request CPU budget — that cap,
// not wall time, is what sizes EMBED_PER_HOP.
// Review-corrected from 10: ten embeddings at the stated ~200ms worst case is
// 100% of the 2s CPU cap — zero headroom, and an over-budget hop is killed
// mid-loop with its chain continuation never issued. Six embeds plus an
// in-loop elapsed guard keeps the worst case near half the budget.
const EMBED_PER_HOP = 6;
const EMBED_HOP_WALL_MS = 1_100; // inference is synchronous CPU, so wall ~ CPU here
// Pause between chain hops. Without it the sweep ran back-to-back around the
// clock, and with the old corpus-scanning batch picker that held a continuous
// full-table load on Postgres — the 2026-07-26 board saturation (filtered
// lists and search timing out at 25s+ while unfiltered status still answered).
// The picker is now O(batch) off a seeded queue, but the pause stays: a fill
// that takes days at low duty is invisible; a fill that takes hours by
// monopolizing the DB is an outage. ~570k rows / 6 per hop at ~5s cadence
// ≈ 5-6 days to full fill, then the hourly settle cadence takes over.
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

// Single-posting liveness against the vendor RIGHT NOW — the moment-of-apply
// freshness check. Uses cheap per-job endpoints where they exist (never the
// 20-36 MB whole-board payload for the light giants); falls back to board
// membership for vendors without one. Returns true=live, false=confirmed gone,
// null=couldn't tell (transient) so callers don't wrongly mark a job closed.
const liveBoardMemo = new Map<string, Set<string>>();
async function checkLive(src: JobSource, externalId: string, applyUrl?: string | null): Promise<boolean | null> {
  try {
    if (src.source === "greenhouse") {
      const gh = greenhouseApi(src.token);
      const res = await fetchWithTimeout(`https://${gh.host}/v1/boards/${gh.token}/jobs/${externalId}?questions=false`);
      return res.status === 404 ? false : res.ok ? true : null;
    }
    if (src.source === "lever") {
      const res = await fetchWithTimeout(`https://api.lever.co/v0/postings/${src.token}/${externalId}?mode=json`);
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
      // Workday has no by-id endpoint, so liveness is probed in three escalating
      // steps and only the last one is allowed to say "gone".
      //
      // WHY THREE. The stored externalId is the externalPath's `_`-suffix, and
      // when a requisition is posted to several locations Workday appends a
      // DEDUPE DISCRIMINATOR to that suffix — `..._JR3085-1`. The req id its
      // search index actually holds is the base, `JR3085`. Searching the stored
      // id therefore returns zero hits for a perfectly live posting, and the old
      // single-step version read that empty result as a confirmed closure.
      // Measured 2026-08-06 over 172 postings seen live in the feed that same
      // second: 5 were reported GONE, every one of them a `-N` id. That is the
      // "search index does not contain every externalId" note on the verify
      // branch — it was never the index being incomplete, it was us searching
      // for an id that does not exist.
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
    // ashby / workable / bamboohr have no cheap per-job endpoint — fetch the
    // board once (memoized per request) and check membership.
    const memoKey = `${src.source}:${src.token}`;
    let ids = liveBoardMemo.get(memoKey);
    if (!ids) {
      const r = await fetchBoard(src);
      if (!r) return null;
      // Only ashby / workable / bamboohr reach here (gh/lever/SR return above).
      ids = new Set<string>();
      if (src.source === "ashby") for (const j of ((r.raw as { jobs?: Array<{ id: string }> }).jobs ?? [])) ids.add(String(j.id));
      else for (const j of r.jobs) ids.add(j.id.split(":").slice(2).join(":")); // workable/bamboohr composite ids
      liveBoardMemo.set(memoKey, ids);
    }
    return ids.has(externalId);
  } catch {
    return null; // network hiccup — unknown, never a false "closed"
  }
}

async function getDescription(src: JobSource, id: string, externalId: string, applyUrl?: string | null): Promise<string | null> {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.text;
  const { text } = await fetchVendorDetail(src, id, externalId, applyUrl);
  if (text) {
    if (detailCache.size > 300) detailCache.clear();
    detailCache.set(id, { at: Date.now(), text });
  }
  return text;
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
): Promise<{ text: string | null; postedAt: string | null; workMode: "remote" | "hybrid" | "onsite" | null }> {
  let text: string | null = null;
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
        // Workday's LIST payload carries no work-mode field, so every workday
        // row's work_mode is text-inferred at ingest — but the detail we're
        // already holding states remoteType outright. The vendor's structured
        // field always outranks inference, so carry it back to the caller for
        // the same free-ride treatment startDate gets.
        //
        // remoteType IS TENANT-AUTHORED FREE TEXT, NOT A WORKDAY ENUM, and
        // that is why this lane wrote nothing for months. The previous test
        // looked for five substrings — "remote", "hybrid", "on-site", "onsite",
        // "on site". Measured across 154 live postings drawn from the exact
        // eligible predicate: only 8 carried remoteType at all, and ZERO of
        // those 8 matched any of the five. Every observed value was an onsite
        // label the classifier had never heard of — "In-Person Working",
        // "Campus based", "Fully on premise", "Field Based", "On Campus".
        //
        // So workMode came back null for 100% of eligible rows, the patch
        // stayed empty, and the sweep reported 154,003 scanned / 0 filled. With
        // work_mode null corpus-wide the board's Hybrid and On-site filters
        // both degraded to "not remote" — two different labels over one
        // identical result set.
        //
        // ORDER IS LOAD-BEARING. Hybrid first: "Hybrid: Remote and Office"
        // contains "remote" and is not remote (the old code got that right only
        // by accident, via its `&& !includes("hybrid")` guard). The in-person
        // family must precede remote for the same reason — "Remote or On
        // Campus" style labels lead with the exception.
        //
        // THE NEGATION ARM COMES FIRST, AND IT IS NOT OPTIONAL. Nike's live
        // tenant publishes the literal string "Non-Remote Posting". A substring
        // test for /remote/ matches it and writes work_mode = "remote" — the
        // exact inversion of what the employer said. "Not Remote" and "No
        // Remote" are the same trap. This was caught by an audit AFTER the
        // rewrite had been committed and pushed, and before it was deployed:
        // without this arm, structured-sweep would have written "remote" onto
        // every Non-Remote Posting row at Workday scale (half the board) the
        // first time it ran.
        //
        // A classifier built from substrings has to answer the negations before
        // the positives, always. Ordering below: negated -> hybrid -> onsite
        // family -> remote.
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
      const html = jobPostingLdDescription(await res.text());
      text = html ? htmlToText(html).slice(0, DESC_CAP) || null : null;
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
    // the one posting, keep nothing else in memory.
    const r = await fetchBoard(src);
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
  return { text, postedAt, workMode };
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

// PostgREST or() syntax breaks on these — strip rather than reject.
// Strips ONLY the characters that are ILIKE metacharacters. It used to strip
// commas and parentheses as well, which silently rewrote the user's location
// into a different question:
//   "San Francisco, CA" -> the literal substring "San Francisco CA"
// and almost no stored location contains that, because they are stored WITH the
// comma. Measured live 2026-07-29 against the true count under the serving rule:
//   "San Francisco, CA"   38 served / 2,978 real   (1.3%)
//   "New York, NY"        18 served / 3,070 real   (0.6%)
//   "Berlin, Germany"      1 served /   438 real   (0.2%)
// Proof it was the comma: "San Francisco, CA" and "San Francisco CA" both
// returned exactly 38, byte for byte. Nothing appeared in ignoredFilters, so the
// filter was neither honoured nor named — it was ALTERED, which is the fence
// breach the other two cases cannot be excused as.
//
// "City, ST" is the format the board itself prints on every card, and the
// natural-language parser emits it too (Jobs.tsx:376), so this was reachable
// from the headline search bar.
//
// Commas and parens never needed stripping: the term is BOUND (.ilike() and a $3
// parameter), never concatenated into SQL, so they are literal characters. Only
// % _ and \ carry meaning to ILIKE.
// "|" joins the RANKED path is now a delimiter (search_jobs splits p_location
// on it so one metro alias can match any of its canonical names), so it is
// stripped here for the same reason % and _ are: a value the caller controls
// must never be able to change the shape of the query. Real locations in this
// corpus DO contain pipes — BAYADA publishes "Philadelphia | 39.95 | -75.16" —
// so this is a live concern, not a theoretical one.
// Strips every character that could change the SHAPE of a query rather than
// its content: % and _ are ILIKE wildcards, \ escapes them, | is the metro/state
// alias delimiter search_jobs splits on, and " delimits a value inside a
// PostgREST or() branch — a typed quote could otherwise close the quoting early
// and inject filter syntax. The quote became load-bearing when state aliases
// (", TX") forced the browse path to quote its or() values.
const sanitizeTerm = (t: string) => t.replace(/[%_\\|"]/g, "").trim();

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
const STATE_ALIASES: Record<string, { names: string[]; keepRaw: boolean }> = {
  "alabama": { names: ["Alabama", ", AL"], keepRaw: false },
  "al": { names: ["Alabama", ", AL"], keepRaw: false },
  "alaska": { names: ["Alaska", ", AK"], keepRaw: false },
  "ak": { names: ["Alaska", ", AK"], keepRaw: false },
  "arizona": { names: ["Arizona", ", AZ"], keepRaw: false },
  "az": { names: ["Arizona", ", AZ"], keepRaw: false },
  "arkansas": { names: ["Arkansas", ", AR"], keepRaw: false },
  "ar": { names: ["Arkansas", ", AR"], keepRaw: false },
  "california": { names: ["California", ", CA"], keepRaw: false },
  "ca": { names: ["California", ", CA"], keepRaw: false },
  "colorado": { names: ["Colorado", ", CO"], keepRaw: false },
  "co": { names: ["Colorado", ", CO"], keepRaw: false },
  "connecticut": { names: ["Connecticut", ", CT"], keepRaw: false },
  "ct": { names: ["Connecticut", ", CT"], keepRaw: false },
  "delaware": { names: ["Delaware", ", DE"], keepRaw: false },
  "de": { names: ["Delaware", ", DE"], keepRaw: false },
  "florida": { names: ["Florida", ", FL"], keepRaw: false },
  "fl": { names: ["Florida", ", FL"], keepRaw: false },
  "georgia": { names: ["Georgia", ", GA"], keepRaw: false },
  "ga": { names: ["Georgia", ", GA"], keepRaw: false },
  "hawaii": { names: ["Hawaii", ", HI"], keepRaw: false },
  "hi": { names: ["Hawaii", ", HI"], keepRaw: false },
  "idaho": { names: ["Idaho", ", ID"], keepRaw: false },
  "id": { names: ["Idaho", ", ID"], keepRaw: false },
  "illinois": { names: ["Illinois", ", IL"], keepRaw: false },
  "il": { names: ["Illinois", ", IL"], keepRaw: false },
  "indiana": { names: ["Indiana", ", IN"], keepRaw: false },
  "in": { names: ["Indiana", ", IN"], keepRaw: false },
  "iowa": { names: ["Iowa", ", IA"], keepRaw: false },
  "ia": { names: ["Iowa", ", IA"], keepRaw: false },
  "kansas": { names: ["Kansas", ", KS"], keepRaw: false },
  "ks": { names: ["Kansas", ", KS"], keepRaw: false },
  "kentucky": { names: ["Kentucky", ", KY"], keepRaw: false },
  "ky": { names: ["Kentucky", ", KY"], keepRaw: false },
  "louisiana": { names: ["Louisiana", ", LA"], keepRaw: false },
  "la": { names: ["Louisiana", ", LA"], keepRaw: false },
  "maine": { names: ["Maine", ", ME"], keepRaw: false },
  "me": { names: ["Maine", ", ME"], keepRaw: false },
  "maryland": { names: ["Maryland", ", MD"], keepRaw: false },
  "md": { names: ["Maryland", ", MD"], keepRaw: false },
  "massachusetts": { names: ["Massachusetts", ", MA"], keepRaw: false },
  "ma": { names: ["Massachusetts", ", MA"], keepRaw: false },
  "michigan": { names: ["Michigan", ", MI"], keepRaw: false },
  "mi": { names: ["Michigan", ", MI"], keepRaw: false },
  "minnesota": { names: ["Minnesota", ", MN"], keepRaw: false },
  "mn": { names: ["Minnesota", ", MN"], keepRaw: false },
  "mississippi": { names: ["Mississippi", ", MS"], keepRaw: false },
  "ms": { names: ["Mississippi", ", MS"], keepRaw: false },
  "missouri": { names: ["Missouri", ", MO"], keepRaw: false },
  "mo": { names: ["Missouri", ", MO"], keepRaw: false },
  "montana": { names: ["Montana", ", MT"], keepRaw: false },
  "mt": { names: ["Montana", ", MT"], keepRaw: false },
  "nebraska": { names: ["Nebraska", ", NE"], keepRaw: false },
  "ne": { names: ["Nebraska", ", NE"], keepRaw: false },
  "nevada": { names: ["Nevada", ", NV"], keepRaw: false },
  "nv": { names: ["Nevada", ", NV"], keepRaw: false },
  "new hampshire": { names: ["New Hampshire", ", NH"], keepRaw: false },
  "nh": { names: ["New Hampshire", ", NH"], keepRaw: false },
  "new jersey": { names: ["New Jersey", ", NJ"], keepRaw: false },
  "nj": { names: ["New Jersey", ", NJ"], keepRaw: false },
  "new mexico": { names: ["New Mexico", ", NM"], keepRaw: false },
  "nm": { names: ["New Mexico", ", NM"], keepRaw: false },
  "new york": { names: ["New York", ", NY"], keepRaw: false },
  "ny": { names: ["New York", ", NY"], keepRaw: false },
  "north carolina": { names: ["North Carolina", ", NC"], keepRaw: false },
  "nc": { names: ["North Carolina", ", NC"], keepRaw: false },
  "north dakota": { names: ["North Dakota", ", ND"], keepRaw: false },
  "nd": { names: ["North Dakota", ", ND"], keepRaw: false },
  "ohio": { names: ["Ohio", ", OH"], keepRaw: false },
  "oh": { names: ["Ohio", ", OH"], keepRaw: false },
  "oklahoma": { names: ["Oklahoma", ", OK"], keepRaw: false },
  "ok": { names: ["Oklahoma", ", OK"], keepRaw: false },
  "oregon": { names: ["Oregon", ", OR"], keepRaw: false },
  "or": { names: ["Oregon", ", OR"], keepRaw: false },
  "pennsylvania": { names: ["Pennsylvania", ", PA"], keepRaw: false },
  "pa": { names: ["Pennsylvania", ", PA"], keepRaw: false },
  "rhode island": { names: ["Rhode Island", ", RI"], keepRaw: false },
  "ri": { names: ["Rhode Island", ", RI"], keepRaw: false },
  "south carolina": { names: ["South Carolina", ", SC"], keepRaw: false },
  "sc": { names: ["South Carolina", ", SC"], keepRaw: false },
  "south dakota": { names: ["South Dakota", ", SD"], keepRaw: false },
  "sd": { names: ["South Dakota", ", SD"], keepRaw: false },
  "tennessee": { names: ["Tennessee", ", TN"], keepRaw: false },
  "tn": { names: ["Tennessee", ", TN"], keepRaw: false },
  "texas": { names: ["Texas", ", TX"], keepRaw: false },
  "tx": { names: ["Texas", ", TX"], keepRaw: false },
  "utah": { names: ["Utah", ", UT"], keepRaw: false },
  "ut": { names: ["Utah", ", UT"], keepRaw: false },
  "vermont": { names: ["Vermont", ", VT"], keepRaw: false },
  "vt": { names: ["Vermont", ", VT"], keepRaw: false },
  "virginia": { names: ["Virginia", ", VA"], keepRaw: false },
  "va": { names: ["Virginia", ", VA"], keepRaw: false },
  "washington": { names: ["Washington", ", WA"], keepRaw: false },
  "wa": { names: ["Washington", ", WA"], keepRaw: false },
  "west virginia": { names: ["West Virginia", ", WV"], keepRaw: false },
  "wv": { names: ["West Virginia", ", WV"], keepRaw: false },
  "wisconsin": { names: ["Wisconsin", ", WI"], keepRaw: false },
  "wi": { names: ["Wisconsin", ", WI"], keepRaw: false },
  "wyoming": { names: ["Wyoming", ", WY"], keepRaw: false },
  "wy": { names: ["Wyoming", ", WY"], keepRaw: false },
  "district of columbia": { names: ["District of Columbia", ", DC"], keepRaw: false },
  "dc": { names: ["District of Columbia", ", DC"], keepRaw: false },
  "alberta": { names: ["Alberta", ", AB"], keepRaw: false },
  "ab": { names: ["Alberta", ", AB"], keepRaw: false },
  "british columbia": { names: ["British Columbia", ", BC"], keepRaw: false },
  "bc": { names: ["British Columbia", ", BC"], keepRaw: false },
  "manitoba": { names: ["Manitoba", ", MB"], keepRaw: false },
  "mb": { names: ["Manitoba", ", MB"], keepRaw: false },
  "new brunswick": { names: ["New Brunswick", ", NB"], keepRaw: false },
  "nb": { names: ["New Brunswick", ", NB"], keepRaw: false },
  "newfoundland and labrador": { names: ["Newfoundland and Labrador", ", NL"], keepRaw: false },
  "nl": { names: ["Newfoundland and Labrador", ", NL"], keepRaw: false },
  "nova scotia": { names: ["Nova Scotia", ", NS"], keepRaw: false },
  "ns": { names: ["Nova Scotia", ", NS"], keepRaw: false },
  "ontario": { names: ["Ontario", ", ON"], keepRaw: false },
  "on": { names: ["Ontario", ", ON"], keepRaw: false },
  "prince edward island": { names: ["Prince Edward Island", ", PE"], keepRaw: false },
  "pe": { names: ["Prince Edward Island", ", PE"], keepRaw: false },
  "quebec": { names: ["Quebec", ", QC"], keepRaw: false },
  "qc": { names: ["Quebec", ", QC"], keepRaw: false },
  "saskatchewan": { names: ["Saskatchewan", ", SK"], keepRaw: false },
  "sk": { names: ["Saskatchewan", ", SK"], keepRaw: false },
};

const METRO_ALIASES: Record<string, { names: string[]; keepRaw: boolean }> = {
  nyc: { names: ["New York"], keepRaw: true },
  "new york city": { names: ["New York"], keepRaw: false },
  sf: { names: ["San Francisco"], keepRaw: false },
  "bay area": { names: ["San Francisco", "Oakland", "San Jose"], keepRaw: false },
  la: { names: ["Los Angeles"], keepRaw: false },
  philly: { names: ["Philadelphia"], keepRaw: false },
  atl: { names: ["Atlanta"], keepRaw: false },
  dfw: { names: ["Dallas", "Fort Worth"], keepRaw: false },
  nola: { names: ["New Orleans"], keepRaw: false },
  "the city": { names: ["New York"], keepRaw: false },

  // A CITY WRITTEN IN ITS OWN LANGUAGE IS A DIFFERENT STRING, AND SUBSTRING
  // MATCHING CANNOT BRIDGE THAT. Nothing connects "Munich" to "München" — a
  // visitor sees whichever spelling their own vocabulary happens to share with
  // the employer's HR system, and never learns the rest exists.
  //
  // MEASURED LIVE 2026-08-22 (fresh, present postings), English form vs local:
  //   Bangalore  3,074  /  Bengaluru 3,181   — either speller misses about half
  //   Munich       966  /  München     757
  //   Warsaw     1,017  /  Warszawa    265
  //   Milan        642  /  Milano      240
  //   Lisbon       535  /  Lisboa      163
  //   Prague       449  /  Praha       113
  //   Florence     425  /  Firenze      17
  //   Geneva       351  /  Genève       48
  //   Brussels     314  /  Bruxelles   124
  //   Vienna       294  /  Wien        193
  //   Zurich       288  /  Zürich      178
  //   Copenhagen   206  /  København    39
  //   Cologne      119  /  Köln        346   — the English speller sees 26%
  //   Krakow       398  /  Kraków      148
  //   Gothenburg    42  /  Göteborg     18
  //
  // EVERY LOCAL FORM WAS CHECKED FOR SUBSTRING POISON before being listed, the
  // same test that keeps "LA" from matching "Plain City". Each of the forms
  // below returns only its own city.
  //
  // ROME IS DELIBERATELY ABSENT. "%Roma%" looked like the biggest win in the
  // set at 1,270 hits and is almost entirely ROMANIA — Bucharest, Cluj-Napoca,
  // Timișoara. Anchoring it as "Roma," survives Romania but still collects
  // "Roma, QLD, Australia" and "VIA ROMA," in Talamona, for 70 hits. A filter
  // that answers "Rome" with Bucharest is worse than one that answers with
  // less, so Rome keeps the plain substring it already had.
  //
  // Mumbai/Bombay and The Hague/Den Haag are absent for the opposite reason:
  // the alternate spelling returns ZERO postings, so the entry would be dead
  // weight pretending to be coverage.
  munich: { names: ["Munich", "München"], keepRaw: false },
  "münchen": { names: ["Munich", "München"], keepRaw: false },
  muenchen: { names: ["Munich", "München"], keepRaw: false },
  cologne: { names: ["Cologne", "Köln"], keepRaw: false },
  "köln": { names: ["Cologne", "Köln"], keepRaw: false },
  koeln: { names: ["Cologne", "Köln"], keepRaw: false },
  vienna: { names: ["Vienna", "Wien"], keepRaw: false },
  wien: { names: ["Vienna", "Wien"], keepRaw: false },
  prague: { names: ["Prague", "Praha"], keepRaw: false },
  praha: { names: ["Prague", "Praha"], keepRaw: false },
  lisbon: { names: ["Lisbon", "Lisboa"], keepRaw: false },
  lisboa: { names: ["Lisbon", "Lisboa"], keepRaw: false },
  milan: { names: ["Milan", "Milano"], keepRaw: false },
  milano: { names: ["Milan", "Milano"], keepRaw: false },
  florence: { names: ["Florence", "Firenze"], keepRaw: false },
  firenze: { names: ["Florence", "Firenze"], keepRaw: false },
  zurich: { names: ["Zurich", "Zürich"], keepRaw: false },
  "zürich": { names: ["Zurich", "Zürich"], keepRaw: false },
  geneva: { names: ["Geneva", "Genève"], keepRaw: false },
  "genève": { names: ["Geneva", "Genève"], keepRaw: false },
  geneve: { names: ["Geneva", "Genève"], keepRaw: false },
  copenhagen: { names: ["Copenhagen", "København"], keepRaw: false },
  "københavn": { names: ["Copenhagen", "København"], keepRaw: false },
  kobenhavn: { names: ["Copenhagen", "København"], keepRaw: false },
  gothenburg: { names: ["Gothenburg", "Göteborg"], keepRaw: false },
  "göteborg": { names: ["Gothenburg", "Göteborg"], keepRaw: false },
  goteborg: { names: ["Gothenburg", "Göteborg"], keepRaw: false },
  warsaw: { names: ["Warsaw", "Warszawa"], keepRaw: false },
  warszawa: { names: ["Warsaw", "Warszawa"], keepRaw: false },
  krakow: { names: ["Krakow", "Kraków"], keepRaw: false },
  "kraków": { names: ["Krakow", "Kraków"], keepRaw: false },
  cracow: { names: ["Krakow", "Kraków"], keepRaw: false },
  brussels: { names: ["Brussels", "Bruxelles", "Brussel"], keepRaw: false },
  bruxelles: { names: ["Brussels", "Bruxelles", "Brussel"], keepRaw: false },
  bangalore: { names: ["Bangalore", "Bengaluru"], keepRaw: false },
  bengaluru: { names: ["Bangalore", "Bengaluru"], keepRaw: false },
};

/**
 * Expand a typed location into the strings actually worth searching.
 *
 * Returns the alias that fired so the board can SAY it expanded the search —
 * a visitor who typed "SF" and sees San Francisco results deserves to know
 * why, and a visitor who meant something else needs to see that we guessed.
 */
/**
 * The location for search_jobs — ONE name, not a delimited list.
 *
 * The pipe-delimited version was correct and is reverted, because the
 * migration that taught search_jobs to split on "|" created a fourteen-
 * parameter OVERLOAD of a fifteen-parameter function and broke ranked search
 * outright (PGRST203). Dropping that overload restores the real definition —
 * which matches ONE substring — so sending "Philly|Philadelphia" here would
 * now match nothing at all. Worse than the bug it fixed.
 *
 * INTERIM, and still better than before: send the first CANONICAL name rather
 * than what the visitor typed. "Philly" searches Philadelphia (1,541 rows
 * instead of 13) and "NYC" searches New York. The union across every alias
 * name is lost on this path until the split lands on the real definition —
 * the browse path keeps it, because it builds its own or() and never touches
 * this RPC.
 *
 * Prefers a canonical name over the raw token deliberately: for "NYC" the
 * names are ["NYC", "New York"], and New York is 12,168 rows against 344.
 */
function rankedLocationParam(raw: unknown): string | null {
  const { terms } = locationTerms(raw);
  if (terms.length === 0) return null;
  // EVERY NAME, NOT THE BEST SINGLE GUESS.
  //
  // This used to pick one canonical name because the RPC took a single text
  // parameter and matched it with one ILIKE. The browse path had no such limit
  // — it ORs every expanded name — so the two paths answered the same request
  // differently, and the difference was invisible: measured live, "bay area"
  // alone returned San Francisco 40 / San Jose 10 / Oakland 5, while adding
  // q=engineer returned San Francisco 54 / Oakland 1 / San Jose ZERO. Typing a
  // job title shrank the metro.
  //
  // Worse once the disclosure shipped: both paths emit the same
  // locationSearched list, so the page printed "Searched 'bay area' as San
  // Francisco, Oakland, San Jose" over results that had only ever been matched
  // against San Francisco.
  //
  // The RPC splits this on "|" as of 20260823010000. A pipe is the separator
  // because state aliases deliberately CONTAIN commas (", TX" is what stops a
  // bare code matching inside ordinary words) and because sanitizeTerm strips
  // pipes from anything a visitor types — so the only source of one is this
  // table. A single-name location produces no pipe and behaves exactly as it
  // always did.
  const joined = terms.map((t) => sanitizeTerm(t)).filter(Boolean).join("|");
  return joined || null;
}

function locationTerms(raw: unknown): { terms: string[]; expandedFrom: string | null } {
  const clean = sanitizeTerm(String(raw ?? ""));
  if (!clean) return { terms: [], expandedFrom: null };
  // Metro first: "NYC" and "LA" are cities, not states, and must not be
  // shadowed by a same-spelled code.
  const hit = METRO_ALIASES[clean.toLowerCase()] ?? STATE_ALIASES[clean.toLowerCase()];
  if (!hit) return { terms: [clean], expandedFrom: null };
  return {
    terms: hit.keepRaw ? [clean, ...hit.names] : [...hit.names],
    expandedFrom: clean,
  };
}



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
    // AND A LIFT ALREADY MADE CANNOT BE OVERWRITTEN BY A LATER ONE. Now that
    // the bare work-mode words are lifted, one query can trigger two rules that
    // write the SAME key: q="remote hybrid analyst" matches both, and a plain
    // Object.assign would let "hybrid" silently replace "remote" while the
    // disclosure listed both — the response asserting two filters it did not
    // apply. First rule wins; the loser's words stay in the query, where they
    // go through queryTerms and come back as droppedTerms the page renders.
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
 * Quotes are stripped rather than escaped because websearch_to_tsquery treats
 * them as phrase syntax, and a half-open phrase from a stray quote is a parse
 * error rather than a search.
 */
function ftsSafe(t: string): string {
  return t.replace(/[(),."'\\:]/g, " ").replace(/\s+/g, " ").trim();
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

function queryTerms(raw: unknown): { terms: string[]; dropped: string[]; liftedSalary: boolean } {
  const all = String(raw ?? "").toLowerCase().split(/\s+/).map(sanitizeTerm).filter(Boolean);
  // The money token is lifted into the salary filter by normalizeFilters, so
  // it must not also be ANDed against every title — that returned zero for
  // "100k engineer".
  const money = salaryFromQueryText(raw) !== null
    ? String(raw ?? "").toLowerCase().split(/\s+/).find((t) => SALARY_IN_QUERY.test(t)) ?? null
    : null;
  const kept = all.filter((t) => !QUERY_FILLER.has(t) && t !== money);
  if (kept.length === 0) {
    // NOTHING LEFT — and WHY it is empty decides what to do next.
    //
    // If a pay figure was lifted out, the figure WAS the whole query and the
    // floor alone is the search. Returning `all` here put the money token back
    // as a required title word, which is why the plainest possible use of the
    // feature failed: q="120000" returned ZERO while the same floor on its own
    // counted 13,381, and q="80k" returned 88 — literal matches on titles like
    // "Senior Product Engineer (£80k-125k + Equity)" — while the floor counted
    // 25,896. The board answered a text question nobody asked instead of the
    // pay question they did.
    //
    // If it is empty because every word was filler ("jobs near me"), the raw
    // string is still the best guess and the caller falls back to it. That is
    // what liftedSalary distinguishes; without the flag the two cases are
    // indistinguishable downstream and one of them has to be answered wrongly.
    if (money !== null) return { terms: [], dropped: all.filter((t) => QUERY_FILLER.has(t)), liftedSalary: true };
    return { terms: all, dropped: [], liftedSalary: false };
  }
  return { terms: kept, dropped: all.filter((t) => QUERY_FILLER.has(t)), liftedSalary: money !== null };
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
// Curated, MEASURED did-you-mean pairs. Each entry is verified live before it
// enters: the key's exact results are junk or near-zero while the value's
// pool is orders of magnitude larger. This is a DISCLOSURE, not an expansion
// — the results themselves are untouched (no re-ranking, no filter widening,
// none of the tier-escalation traps), the client renders a one-click
// suggestion above them. Query-side only: it never classifies or relabels a
// posting, so the frozen classifier stays frozen.
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
  applied: { salaryFloor?: number | null; postedAfter?: string | null },
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
 * Constants rather than live counts because each one is a full count over a
 * partly-populated column, and the pass that could take them cheaply already
 * takes four and is the pass that once bound its results to the wrong names.
 * The DATE is part of the number: these are a snapshot, and a snapshot with no
 * date is what turns a measurement into a claim.
 */
const MEASURED_COVERAGE = {
  payBasis: 0.106,
  hasStatedPay: 0.201,
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
 * MEASURED against 599,316 open postings: salary stated on 12.9%, work mode on
 * 29.9%, experience on 40.4%. A searcher who sets a salary floor is seeing an
 * eighth of the market and currently has no way to know it.
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
  },
  meta?: { v: Record<string, unknown> } | null,
): Record<string, unknown> {
  const cov = (meta?.v as Record<string, unknown> | undefined)?.coverage as
    | { salaryFloor?: number | null; workMode?: number | null; experience?: number | null; country?: number | null }
    | undefined;
  // NO CACHE, NO NUMBERS — INCLUDING THE MEASURED ONES, and this early return
  // stays exactly where it was. It is pinned by name in
  // src/test/intent-is-a-filter-and-a-filter-says-what-it-hides.test.ts, and
  // reordering it so the constants below survive a cold cache was how this
  // change first went in: 630 tests passed and that one guard went red.
  //
  // The guard is right, and not only about invented fractions. The cached block
  // is the freshest evidence the board has that its own coverage figures are
  // being recomputed at all; with it missing, publishing five pinned constants
  // beside four absent live figures says "we measured this today" on the one
  // request where nothing was measured. Live 2026-08-25 the cache is present
  // (filterCoverage {salaryFloor 0.201, workMode 0.281} on a real probe), so
  // this costs the new filters nothing in practice — it only decides the cold
  // case, and the cold case is the one where silence is honest.
  if (!cov) return {};
  const out: Record<string, number> = {};
  // The five filters over partly-populated columns the refresh pass does not
  // count. `vendor` is complete and still reported: silence on one active
  // filter while four others carry a number reads as "we don't know", and for
  // this one we do.
  if (applied.payBasis) out.payBasis = MEASURED_COVERAGE.payBasis;
  if (applied.hasStatedPay) out.hasStatedPay = MEASURED_COVERAGE.hasStatedPay;
  if (applied.maxYears != null) out.maxYears = MEASURED_COVERAGE.maxYears;
  if (applied.department) out.department = MEASURED_COVERAGE.department;
  if (applied.vendors?.length) out.vendor = MEASURED_COVERAGE.vendor;
  if (applied.salaryFloor != null && typeof cov.salaryFloor === "number") out.salaryFloor = cov.salaryFloor;
  // The ceiling compares against salary_rank_usd, the column the floor uses, so
  // its coverage IS the floor's — read live rather than pinned as a sixth
  // constant. Two constants for one column is how a number goes stale on one of
  // its two readers.
  if (applied.salaryCeiling != null && typeof cov.salaryFloor === "number") out.salaryCeiling = cov.salaryFloor;
  if (applied.workMode != null && typeof cov.workMode === "number") out.workMode = cov.workMode;
  if (applied.experience?.length && typeof cov.experience === "number") out.experience = cov.experience;
  // Country was the one filter of the four with no caveat, and it is the
  // thinnest on several vendors. Teamtailor was cited here as stating a
  // country on 0 of its 10,412 rows; that number was real but the cause was
  // ours — the RSS carries tt:city and tt:country on every item and the
  // parser dropped both. Fixed 2026-08-25; the rows resolve a country as they
  // re-ingest, so do not quote the zero as a vendor property. Measured the
  // same day, 156,672 of 559,854 servable rows (28%) still name no country,
  // so filtering to one does silently drop them — which is what this
  // disclosure is for.
  if (applied.country && typeof cov.country === "number") out.country = cov.country;
  return Object.keys(out).length ? { filterCoverage: out } : {};
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // GET sitemap route — the ONE crawler-facing surface this function serves.
  // Google accepts cross-host sitemaps when robots.txt on the target host
  // references them, which resumebooster.work's robots.txt now does. Each
  // page lists up to 10,000 posting deep links (/jobs?job=<id>) restricted to
  // rows with a COMPANY-STATED posting date inside the serving window — the
  // same honesty bar the maxAgeDays filter uses; discovery-time freshness is
  // never presented to a crawler as a posting date. Page 0 with no results
  // still returns a valid empty urlset (never a 500 to a crawler).
  if (req.method === "GET") {
    const u = new URL(req.url);
    // No page param → a sitemapindex with one entry per day of the freshness
    // window. Coverage still tracks the dated corpus (every dated posting
    // falls in exactly one day), but the page count no longer depends on a
    // live COUNT and no page depends on a deep OFFSET.
    if (u.searchParams.get("action") === "sitemap" && !u.searchParams.has("page")) {
      // One page per DAY of the freshness window, not count/10k. Offset-based
      // paging made page N cost a scan of N*10,000 rows, and the deep pages
      // timed out — silently, see the page handler below. A day is a bounded,
      // indexed slice that never gets more expensive as the corpus grows.
      const pages = SITEMAP_DAYS;
      const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      const entries = Array.from({ length: pages }, (_, i) =>
        `<sitemap><loc>${self}?action=sitemap&amp;page=${i}</loc></sitemap>`).join("");
      const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=21600" },
      });
    }
    if (u.searchParams.get("action") === "sitemap") {
      const page = Math.max(0, Math.min(SITEMAP_DAYS - 1, Number(u.searchParams.get("page")) || 0));
      const client = db();
      // Page N = postings whose COMPANY-STATED date falls in day N of the
      // window. Bounded by an indexed range instead of a growing OFFSET, so
      // every page costs the same and the last page is as cheap as the first.
      const dayEnd = new Date(Date.now() - page * 86_400_000).toISOString();
      const dayStart = new Date(Date.now() - (page + 1) * 86_400_000).toISOString();
      // PostgREST caps any single select at 1,000 rows regardless of range()
      // — measured live: the first ship of this route silently served 1,000
      // URLs per "10k" page. Page through with a KEYSET cursor on id: no
      // offset ever, so a deep chunk is no more expensive than the first.
      const rows: Array<{ id: string; posted_at: string }> = [];
      let lastId = "";
      for (let c = 0; c < 50; c++) { // 50k = the sitemap-protocol ceiling per file
        let q = client
          .from("job_board_postings")
          .select("id, posted_at")
          // Never submit a dropped posting to a search engine — the sitemap is
          // the other surface 20260728120000 missed.
          .is("missing_since", null)
          .gte("posted_at", dayStart)
          .lt("posted_at", dayEnd)
          .order("id", { ascending: true })
          .limit(1_000);
        if (lastId) q = q.gt("id", lastId);
        const { data: chunk, error: chunkErr } = await q;
        // NEVER swallow this. The old code destructured the error away, so a
        // failed read was indistinguishable from "no more rows" — it broke the
        // loop and served a PARTIAL or EMPTY urlset as a confident 200 with an
        // hour of caching. Measured 2026-07-27: the same page returned 10,000,
        // 8,000 and 0 URLs on consecutive requests. Telling a crawler "this
        // site has no jobs" is the same class of lie as a wrong count.
        if (chunkErr) {
          console.error("[JOB-BOARD] sitemap page", page, "read failed:", chunkErr.message);
          return new Response("sitemap temporarily unavailable", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
          });
        }
        if (!chunk?.length) break;
        rows.push(...(chunk as Array<{ id: string; posted_at: string }>));
        lastId = String(chunk[chunk.length - 1].id);
        if (chunk.length < 1_000) break;
      }
      const urls = rows.map((r) =>
        `<url><loc>https://resumebooster.work/jobs?job=${encodeURIComponent(String(r.id))}</loc><lastmod>${String(r.posted_at).slice(0, 10)}</lastmod></url>`
      ).join("");
      const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    }
    return json({ error: "POST only" }, 405);
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "list");
  const client = db();

  try {
    if (action === "searchQuality") {
      // MAKES THE TELEMETRY VERIFIABLE FROM OUTSIDE, which it otherwise is not.
      //
      // get_search_quality is granted to service_role only, and the two tables
      // behind it are RLS-locked with no policy — correctly, because they hold
      // visitor behaviour. But that combination meant the one check that
      // matters ("is it actually recording?") could not be run with the anon
      // key, and a telemetry table nobody can read is indistinguishable from a
      // telemetry table that records nothing. That is the exact failure this
      // feature exists to prevent, so it would have been an absurd one to ship.
      //
      // This reads through the service-role client and returns ONLY the
      // aggregate — the same line the closure log draws. RAW QUERY STRINGS ARE
      // DELIBERATELY NOT EXPOSED HERE: people type their own names, employers
      // and locations into a search box, so the aggregate over raw query text
      // stays service-role-only. Counts and rates carry no such risk.
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
      // NO ONE CHECKED THAT AN APPLY LINK RESOLVES. Feed membership is blind
      // to host rot: 23,347 servable postings sit on hosts the EMPLOYER owns,
      // and when one lapses the feed keeps listing the job while the board
      // serves a button that cannot load — the 233-posting Recruitee incident,
      // as a standing class. This sweep is DETECTION ONLY. The verdict traps
      // are measured and severe (Workday answers 200 with a 136-byte stub;
      // vendors ship "no longer available" in i18n bundles on LIVE pages;
      // 403/429 is a CDN), so: any HTTP response means the host is ALIVE, and
      // only DNS/TLS/network failures count against it. It never demotes a
      // row and never touches missing_since.
      //
      // Bounded per tick — a cursor walks ~200 hosts an hour, so a full cycle
      // over the ~1,400 exposed hosts completes in a few hours and the tick
      // never approaches the function's wall clock. The host census comes from
      // an RPC because the group-by cannot be expressed over PostgREST.
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
        // PAGED, because the 1,000-row ceiling is the SERVER's, not the
        // client's. The first live tick returned exactly 1,000 of the
        // ~1,400-host census and I read that as supabase-js's un-ranged
        // default, so range(0, 4999) went out as the fix. It changed nothing:
        // PostgREST enforces its own max-rows on every response, RPCs
        // included, and asking a 570k-row table for 2,000 rows still returns
        // 1,000 (measured 2026-08-24). A round number that survives a fix is
        // the fix being wrong, not the number being real. The bottom ~400
        // hosts — the smallest employers, the ones likeliest to let a domain
        // lapse — were still never swept.
        //
        // Pages until a short one arrives. The RPC's ORDER BY carries a
        // tiebreak on host so the page boundary is deterministic; the Map
        // dedupes anyway, because a census that shifts under paging must
        // cost a duplicate probe, never a silently skipped host.
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
      // Deploy + health introspection. Read-only, zero-cost (meta rows only — no
      // feed fetches, no AI). BUILD_VERSION and catalogSize come from the DEPLOYED
      // bundle, so a stale/failed publish is visible in ONE call instead of being
      // inferred from posting counts over hours (the rung-2 "did it deploy?" pain).
      // Also the source of truth for the heartbeat's job_board_deploy check.
      const [prog, pbMeta, rot, refreshMeta, bf, hotMeta, fresh, breaker, dateCov, boardFlow, ingestPaused, dcCache, bsMeta, dsMeta, ssMeta, esMeta, fiOk, fiBad, faMeta, aaMeta, arMeta, rsRun, rsCron, hsMeta, rcProg, rcVer, hwMeta, deepCur, chainKick] = await Promise.all([
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "posted_backfill").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "cold_rotation").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "hot_tokens").maybeSingle(),
        // Measured re-verification age distribution (null until the migration lands)
        // BOUNDED (2026-07-26): these two aggregate over the whole 569k-row
        // postings table while the sweeps write to it continuously, and status
        // had degraded to a measured 17-19s — long enough that the heartbeat's
        // own deploy check ABORTED and reported the board unreachable. That is
        // a false alarm on the one endpoint whose job is answering "did my
        // deploy land?", and a slow status also masks a real outage behind an
        // ambiguous timeout. Both fields are already documented as null-until-
        // available and every consumer renders nothing for null, so a slow
        // stat is simply omitted rather than allowed to stall the answer.
        withDeadline(client.rpc("get_freshness_stats"), 2_500),
        client.from("job_board_meta").select("v").eq("k", "vendor_breaker").maybeSingle(),
        // Per-vendor stated-date coverage. This deadline went 2_500 → 8_000 on
        // 2026-08-03 to clear a ~3.5s aggregate over 562k rows, and by
        // 2026-08-06 that aggregate had outgrown its own 20s STATEMENT timeout
        // and failed outright on every call — so the 8s bought nothing and cost
        // this endpoint an 8-second floor on every request. Status measured
        // 8.5-26s, which is what pushed the heartbeat's 15s deploy check into
        // flapping "board unreachable" at a healthy board.
        //
        // Both stats are precomputed into job_board_stats_rollup every 15
        // minutes now, so the RPC is a single indexed row read and the deadline
        // goes back to being a guard rather than a budget. The result is still
        // cached below, so a bad day degrades to "slightly stale" not "gone".
        withDeadline(client.rpc("get_date_coverage"), 2_500),
        // INTAKE vs OUTTAKE — the one number that says whether the board is
        // growing or quietly draining. Every count on the serving path caps at
        // 10,000 for a filtered query, so asking the API for "postings added in
        // the last day" and "in the last week" BOTH returned 10,000 — the cap,
        // not a measurement. There was no way to see it.
        //
        // Deadlined like the coverage RPC and simply OMITTED when slow: a
        // status payload that waits on an analytics count is a status payload
        // that stops answering the question it exists for.
        //
        // NOW READ FROM CACHE, NOT COMPUTED PER REQUEST — because withDeadline
        // DOES NOT CANCEL THE QUERY. It is a Promise.race: losing the race
        // abandons the JS promise while the statement keeps running server-side
        // to its 15s statement_timeout. So the 3_000 -> 8_000 change earlier
        // today bought nothing except a longer wait for a value that was still
        // usually null, and every status call went on paying for a full 572k-row
        // count regardless.
        //
        // Measured 2026-08-17 22:07Z during a live board outage: freshness,
        // dateCoverage and boardFlow were ALL null in the same payload, meaning
        // all three analytics RPCs blew their deadlines — and all three still
        // ran to completion in Postgres. The board was paying full price for
        // three heavy scans per status call and displaying none of them, while
        // ordinary reads timed out and the ingest failed with (db-write).
        //
        // The pass computes it once and stores it, exactly as date_coverage
        // already does. A status call now costs one indexed meta read.
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
        // The stale-bundle guard's own state. It is a STRICT less-than against
        // this number, so a mark ONE above the real catalog does not degrade
        // the orphan prune, it disables it — and the only evidence was a log
        // line nobody reads. That shipped on 2026-08-24 (31,709 clamped
        // against a 31,708 catalog) and could not be confirmed from outside at
        // all, because job_board_meta is service-role-only. Published here as
        // a derived boolean plus the two numbers behind it.
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
]);
      const pgV = (prog.data?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[]; failedTotal?: number };
      const rotV = (rot.data?.v ?? {}) as { completedAt?: string; coldBoards?: number };
      const rfV = (refreshMeta.data?.v ?? {}) as { total?: number };
      const dormant = ((bf.data?.v ?? {}) as { dormant?: Record<string, number> }).dormant ?? {};
      const hotTokens = ((hotMeta.data?.v ?? {}) as { tokens?: unknown[] }).tokens;
      const now = Date.now();
      const ageMin = (ts?: string | null) => (ts ? Math.round((now - new Date(ts).getTime()) / 60000) : null);

      // SELF-POPULATING CACHE. Whenever the live query beats its deadline, its
      // answer is stored, so the next caller that does not is served real
      // numbers with an age rather than a null. No cron to schedule, nothing
      // else to keep alive — the cache is a by-product of the reads that
      // already succeed, and the first successful read after a deploy fills it.
      //
      // Fire-and-forget: a status page must never fail because it could not
      // write its own cache.
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
      return json({
        // deployed build identity (constants baked into THIS bundle)
        version: BUILD_VERSION,
        // WHICH VENDORS THIS BUNDLE CAN HARVEST REAL QUESTIONS FOR.
        //
        // Derived from the automation facts rather than hand-maintained, so it
        // moves on its own whenever that map does. It exists because
        // BUILD_VERSION could not answer "did the edge functions deploy?": it
        // is keyed to sources.ts and to the bootstrap lane, so a change that
        // touches neither leaves it identical — the status field read the same
        // whether the new code had shipped or not, which is not a measurement.
        //
        // Bumping BUILD_VERSION to make it one would be worse: it would
        // re-trigger the bootstrap queue across 28k boards to answer a
        // yes/no question.
        questionVendors: realQuestionVendors(),
        // HAS THE APPLY AGENT EVER RUN, AND DID THE SCHEDULE RUN IT?
        //
        // apply-agent is scheduled hourly at :23, but the cron body is wrapped
        // in `WHERE EXISTS (... vault.decrypted_secrets WHERE name =
        // 'apply_agent_maintenance_key')`. With no key in the vault it fires
        // NOTHING — deliberately, because a cron that collects a 403 twenty-four
        // times a day is indistinguishable from a working one until somebody
        // reads the logs.
        //
        // The cost of that good decision was that "armed and working" and
        // "never armed at all" produced byte-identical evidence from outside:
        // no packets, no errors, nothing. Answering it required the Supabase
        // dashboard, which is exactly the sort of question this endpoint exists
        // to make answerable without one.
        //
        // READ IT LIKE THIS — four states, not two, and the first two are
        // different questions that a single `null` would have merged:
        //   key ABSENT from the response -> THIS bundle has not deployed
        //   key present, value null      -> deployed; apply-agent has not run
        //                                   since the stamping build shipped
        //   lastCronAt null, an hour on  -> the vault key is MISSING; the job
        //                                   fires nothing, exactly as designed
        //   lastCronAt recent            -> key present, schedule firing
        //
        // lastCronAt only advances on a real cron firing. A hand invocation
        // must not be able to make the schedule look alive.
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
        // THE RUNNER'S OWN SCHEDULE. agent-runner is gated as of 2026-08-03.1,
        // and its cron is the only caller that holds a key — so if that
        // schedule breaks, nothing else changes shape. No queued picks looks
        // identical to a quiet night. This is the only thing that separates
        // them, and it is anon-readable on purpose: the question "is the agent
        // still being run" should not require a service key to answer.
        //
        // Deliberately NOT reporting senderOnline or resumesBucket here. The
        // runner has no sender and touches no bucket; the stamp omits them
        // rather than defaulting, so this reports what the job actually knows.
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
        // THE PAYMENT SAFETY NET. reconcile-stripe finds customers who PAID and
        // received nothing, and emails the owner to recover them. It emails only
        // when it finds something, so a healthy day and a dead cron are both
        // silent — which made the highest-stakes job here the least observable.
        //
        // NOT `? … : null` like the two blocks above. This object is always
        // emitted, because the state worth shouting about is "has never run",
        // and a block that disappears in exactly that case would report the
        // alarming answer by vanishing. Nulls inside a present object say "never
        // happened"; an absent object says nothing at all.
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
            // Written by reconcile_stripe_tick(), which pg_cron calls.
            //
            // THIS COMMENT USED TO CLAIM THE VALUE COULD NOT BE FORGED, and it
            // was wrong for a day. The design intent was right — a stamp
            // written from inside the database rather than derived from a
            // request body, precisely so an open endpoint could not fake it —
            // but the implementation revoked the function from PUBLIC only.
            // This database grants EXECUTE to anon on newly created functions,
            // and a grant held directly by anon survives a PUBLIC revoke, so
            // `POST /rpc/reconcile_stripe_tick` returned 204 to an anonymous
            // caller and stamped this field. Measured 2026-08-08; closed in
            // 20260808134902 by revoking anon and authenticated BY NAME.
            //
            // Now genuinely unreachable over HTTP. Stated as a fact that was
            // checked rather than one that was assumed, because it was
            // assumed once already.
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
        // HOW MUCH OF THE BOARD THE AGENT CAN ACTUALLY SUBMIT TO, computed
        // from the same live per-vendor totals above rather than asserted.
        //
        // Three separate code comments claimed "about 2%" and "~3.4%". Both
        // were written when three adapters existed; there are four, and the
        // real figure measured 2026-08-03 is 5.3%. Nobody lied — the number
        // simply had no way to move, which is what a hardcoded measurement is.
        // Engineers reason from these comments when deciding whether the
        // sendable boost is worth its query, so a 2.6x understatement is a
        // decision input, not a cosmetic error.
        //
        // The ceiling itself is structural and documented in worker/RECON.md:
        // every other major vendor was measured and refused for a stated
        // reason — BambooHR reCAPTCHA v2 visible on 24/24 pages, Ashby v3,
        // Lever/Rippling/Workable bot detection, SmartRecruiters 403 headless
        // AND headed, Oracle re-checked. Raising it means defeating bot
        // protection, which is not on the table.
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
        // Work-mode recovery lane. `filled` is the number that matters and the
        // reason it is published: this lane exists because the structured
        // remoteType parsing could not reach rows that already had a
        // description, and a lane that walks its whole corpus filling nothing
        // looks identical to one that never ran. cursor advancing with filled
        // at 0 is the honest reading of "scanning, nothing to state here".
        // THE ROTATION'S ONLY WINDOW. Deep cursors say where each capped board
        // stopped last pass. job_board_meta is not anon-readable, so before this
        // existed the rotation could only be judged by watching row counts and
        // guessing — and on 2026-08-25 I read two samples eleven minutes apart
        // on a system whose passes run ~90 minutes, concluded it was pinned, and
        // parked a rotation that was in fact climbing (CVS 500 -> 630 within the
        // hour). `boards` is the count still filling; an entry is deleted when
        // its board wraps, so a healthy steady state trends DOWN, not up.
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
          };
        })(),
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
        // Posted-date backfill liveness. Added 2026-07-28 after the sweep sat
        // at bamboohr 0% dated for 2h15m on a confirmed-live deploy and there
        // was NO way to tell which of three very different causes it was:
        // already-stamped-complete (so not due), a chain alive but dating
        // nothing, or a kick that never fired. job_board_meta is RLS-hidden
        // (42501 for anon), so diagnosing it needed dashboard SQL — the exact
        // gap embedSweep was added to close for the embedding chain.
        // `due` mirrors the kick's own predicate, so this cannot drift from it.
        // FILTER CONTRACT — the self-check on every page, plus the scheduled
        // audit. Published here because job_board_meta is RLS-hidden (anon gets
        // 42501), so without this the sensor exists and nobody can read it.
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
        // THE RETRY LANE, VISIBLE. `failing` is the pre-dormancy backlog — boards
        // that failed and are waiting out their backoff — and `lastRetryLane` says
        // whether the lane actually ran and how many it took. Without both, a p95
        // that does not move has two indistinguishable causes.
        // CHAIN LIVENESS — the thing this endpoint could not answer.
        //
        // `cursor` and `lastSliceAgeMin` look identical whether slices arrive
        // from a self-sustaining chain or from one cron kick every ten minutes,
        // which is a 5-8x throughput difference reported as the same numbers.
        // Deciding which it was cost an hour of cursor sampling, and the first
        // answer was wrong. Now it is one read: `outcome` says what happened to
        // the most recent kick, and `ageMin` says whether kicks are still
        // happening at all. "continued" and fresh = the chain is alive.
        chainKick: (() => {
          const v = (chainKick.data?.v ?? {}) as Record<string, unknown>;
          const at = chainKick.data?.updated_at ?? null;
          return {
            outcome: v.outcome ?? null,       // continued | declined | http_error | threw | paused
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
        freshness: Array.isArray((fresh as { data?: unknown }).data) && ((fresh as { data: unknown[] }).data)[0]
          ? ((fresh as { data: unknown[] }).data)[0]
          : null,
        quarantinedVendors: (((breaker.data?.v ?? {}) as { quarantined?: string[] }).quarantined ?? []),
        // Which hiring systems state posting dates, and for what share of
        // their postings — the measured basis behind every age stat.
        // WHY THIS WAS NULL FOR WEEKS. The deadline was 2_500ms and the query
        // measures ~3.5s over 562k rows, so it timed out on every call —
        // and withDeadline returns { data: null } for a timeout, for an error,
        // and there is no separate signal for an empty result. One value, three
        // states, and the one that was actually happening was invisible.
        //
        // Now: live if it answers, last good cached copy WITH ITS AGE if it
        // does not, and a stated reason if neither exists. A number with no age
        // beside it cannot be told from a fresh one, so the age is not optional.
        // "live" now means "read the rollup successfully", NOT "computed this
        // instant" — the aggregate runs on a 15-minute cron. Reporting age 0 for
        // it would be the same false-freshness move this block exists to
        // prevent, so the age comes from the rollup's own computed_at.
        // Intake vs outtake over the last 24h. Null when the RPC was slow or
        // the migration has not landed — never a zero, which would read as
        // "nothing came in today" on a board taking thousands.
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
      // The audit I ran by hand on 2026-07-29, turned into something that runs
      // itself. It found four real defects that 1,010 unit tests were green
      // through, because every one of them lived in the gap between the code and
      // the database: a case-folded filter the count didn't fold, a column the
      // mapper emitted and the SELECT never fetched, an array shape the gate
      // never inspected, and a page cut that dropped rows. None of those are
      // visible to a test that imports a module — only to one that asks
      // production a question and checks the bytes that come back.
      //
      // Two things it deliberately does NOT do:
      //
      // 1. It does not rebuild the query. Each case is a real HTTP request to
      //    this function's own `list` action, so it exercises the same path a
      //    user hits — normalisation, filters, count, grouping, mapping. An
      //    audit that reimplemented buildQuery would agree with itself and prove
      //    nothing, which is the same error as a mapper test that passes while
      //    the column is missing from the database.
      //
      // 2. It does not use count=estimated for recall. PostgREST's estimate
      //    returned a fabricated uniform figure on this table (22.1% where exact
      //    showed 100%), so a recall comparison built on it would invent
      //    disagreements. Exact only, with the serving rule applied.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "filter-audit is a maintenance action" }, 403);
      }
      const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      // THE AUDIT SPENT A DAY REPORTING ITS OWN THROTTLING AS FILTER FAILURES.
      // 2026-08-17: every finding it produced was kind "request-failed" with
      // "RateLimitError ... for trace" — the GATEWAY refusing the audit's own
      // burst of self-calls, recorded as if the filters were broken. A
      // guardrail that is red every day trains everyone to ignore the day it
      // is right. So: one paced retry honouring Retry-After (capped — a lying
      // header must not stall the audit), and a residual 429 is reported as
      // `throttled`, a different kind from a filter defect, because "the
      // gateway was busy" and "the board lies about filters" must never be
      // the same alarm.
      const probe = async (payload: Record<string, unknown>) => {
        const started = Date.now();
        try {
          const body = JSON.stringify({ action: "list", limit: 60, groupSimilar: false, ...payload });
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
          const j = await res.json().catch(() => ({}));
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
        // RECALL — only where the count is exact. A capped total is honestly
        // "10,000+", so comparing it to a true figure would manufacture a
        // finding rather than detect one.
        // A capped total was skipped entirely, so a count too LARGE by more than
        // the cap went unreported — including the shape of the founding defect,
        // where a filtered page published the whole catalogue's figure. Capped
        // still cannot be compared to an exact number, but it CAN be falsified:
        // if the true count is below the cap, the total had no business being
        // capped at all.
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
      // A CHAIN THAT STRADDLES A DEPLOY MUST DIE, NOT CONTINUE. Measured
      // 2026-08-23: the v8 sweep was mid-flight when v9 deployed; its
      // post-deploy hops ran the new code, which stamped the progress row
      // with the NEW version — so the chain kept its mid-alphabet cursor,
      // judged only the late ids under v9, and would have stamped the
      // completion row as a finished v9 sweep with everything before
      // "personio:" never seen by the v9 rules. Every hop now names the
      // version its chain started under; a hop landing on newer code
      // aborts silently and maybeKickMaintenance restarts from "" under
      // the current rules. A hop with a cursor but no version is a
      // pre-provenance chain — same verdict.
      const hopVersion = Number(body.rulesVersion);
      if ((Number.isFinite(hopVersion) && hopVersion !== CATEGORIZE_VERSION) || (!Number.isFinite(hopVersion) && cursor)) {
        return json({ ok: false, superseded: true, current: CATEGORIZE_VERSION });
      }
      // Liveness + resume point. Measured 2026-07-25: the v5 sweep chain died
      // silently ~15.5k rows in (waitUntil self-invocation is best-effort, not
      // guaranteed), and with no stamp a dead chain looked identical to a live
      // one — so the re-kick waited hours and then STARTED OVER. Stamping the
      // cursor each invocation lets maybeKickMaintenance both detect death
      // within minutes and resume from the frontier instead of rescanning.
      // Rows before the cursor were already judged by the CURRENT rules
      // (updates remove them from the 'other' pile; survivors stay judged), so
      // resuming is correct, not just cheap.
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
        })).then((r) => r.text()).catch(() => {}));
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
        })).then((r) => r.text()).catch(() => {}));
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
      // Date the undated (see POSTED_BACKFILL_VERSION): re-fetch each board's
      // official feed once and stamp posted_at from the feed's own date. Two
      // phases — greenhouse (first_published from the list API), then workday
      // (~79k rows ingested before dated-ingest shipped; the CXS relative age
      // via the production fetcher+normalizer). Rows the feed no longer lists
      // (or that carry no date) stay NULL; the id cursor walks past them and
      // the completion stamp stops re-scans.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-posted is a maintenance action" }, 403);
      }
      // Phase order is cheap-first (2026-07-26 fix): bamboohr → rippling →
      // greenhouse → workday. It used to START with greenhouse and put the
      // per-posting phases after the workday wall (~75k rows at 8 boards/hop),
      // and the chain never survived long enough to reach them — measured in
      // production as bamboohr 0% dated of 43,813 rows while workday sat at
      // 75%. The bounded phases now run first, so a chain that dies mid-wall
      // has already banked the cheap wins — and the hop-persisted cursor below
      // means a revival resumes inside the wall instead of at the start.
      // The accepted list and the type must move together: `deno check` caught
      // the pinpoint branch as unreachable ("no overlap") when only the type
      // was widened, which is the whole reason edge functions carry their own
      // gate — tsc does not see this directory.
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
      // A cursor belongs to the phase that produced it. Ids are
      // `source:token:externalId`, so a cursor from another source can only
      // ever sort the whole phase out of range — silently, as an empty page
      // that reads exactly like a finished one.
      //
      // AND IT SEEDS TO THE PHASE PREFIX, NOT "". This one line is why the
      // backfill did no work for 4.9 days. With an empty cursor the draw below
      // runs `source=eq.X & posted_at is null ORDER BY id LIMIT 500` with NO id
      // predicate, so Postgres cannot use the primary key for a bounded range
      // scan and walks from the top of a 594k-row table. Measured live on
      // bamboohr: 3.1-3.3s against a ~3s statement timeout, so it returned
      // 57014 roughly two times in three. With `id > 'bamboohr:'` the identical
      // query returns in 0.23s — 13x — because the id predicate makes it a
      // range scan. Tokens are never empty, so the prefix sorts below every row
      // of the phase and excludes nothing (first row back is
      // "bamboohr:100percentgroup:26").
      //
      // The `if (cursor)` guard on the draw means an empty string disables the
      // predicate entirely, which is exactly the branch that was firing.
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
      // `<`, NOT `<=`. This was an INFINITE LOOP and it is why bamboohr and
      // rippling sat at 0% dated while greenhouse reached 99.2%.
      //
      // Trace with IDS_PER_HOP = 120: iteration 1 consumes exactly 120 ids,
      // the 121st row trips `scanned >= IDS_PER_HOP`, sets brokeEarly and
      // breaks. brokeEarly then SUPPRESSES the `exhausted` flag below (by
      // design — a budget break mid-page must leave the remainder for the next
      // hop). The while test is now `120 <= 120`, still true, so it draws
      // again; iteration 2 breaks on its FIRST row without advancing `scanned`
      // or `cursor`; and it spins forever, issuing one 500-row query per turn
      // until the isolate is killed.
      //
      // Everything measured follows from this and nothing else does: the hop
      // stamped, the draw never errored, no vendor call was ever made, no row
      // was ever written, the chain never fired, and the after-draw beacon
      // never printed. The two phases that use this branch (perPosting =
      // bamboohr, rippling) are precisely the two vendors at 0% dated;
      // greenhouse takes the board-based branch and worked all along.
      //
      // The `noProgress` guard is the belt to that braces: the board-based
      // branch can wedge the same way if a whole 500-row page is new tokens
      // beyond BOARDS_PER_HOP, because those rows `continue` without advancing
      // the cursor. A page that advances nothing can never advance anything.
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
          // Surface it. A thrown draw error left NO trace anywhere anon-visible:
          // the hop stamped, died, and the next kick 10 minutes later repeated
          // the whole thing, which is indistinguishable from "ran and found
          // nothing to do". Measured 2026-07-28: 40 consecutive samples over
          // 2h40m with bamboohr dated = 0, while the draw returns 500 rows in
          // 0.23s and 6/6 vendor detail probes answered 200 with real dates —
          // so the failure is inside the hop and nothing recorded which line.
          await client.from("job_board_meta").upsert(
            { k: "posted_backfill", v: { resumeVersion: POSTED_BACKFILL_VERSION, phase, cursor, note: `draw: ${error.message ?? error}`.slice(0, 200), at: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: "k" });
          // Do NOT throw. A draw timeout used to kill the hop, and because the
          // resume stamp pins the chain to its phase, every kick then retried
          // the same doomed query forever — leaving the EARLIER phases' rows
          // untouched behind it.
          //
          // Measured 2026-07-29: greenhouse times out at 3.2s while the
          // identical query shape on rippling returns in 0.34s. The reason is
          // the opposite of intuition — greenhouse is 99.2% already dated, so
          // `posted_at IS NULL ORDER BY id LIMIT 500` has to scan all 59,878
          // rows to find its 482 matches, while rippling's undated rows are
          // dense enough that the planner fills a page immediately. A phase
          // gets EXPENSIVE precisely as it approaches done.
          //
          // So a draw failure means "this phase can give no more", not "the
          // sweep is over": mark it exhausted and let the normal path advance
          // to the next phase (or complete the sweep, which re-arms in 7 days
          // and starts again at bamboohr). The note above survives for the
          // operator either way.
          //
          // BUT IT MUST NOT COUNT AS A COMPLETED SWEEP. That reasoning was
          // written for greenhouse, which is 99% dated and genuinely near-done.
          // Applied to bamboohr — 20% dated, ~35,916 undated rows, 77% of the
          // whole backlog — it declared the largest phase exhausted on hop 1
          // having scanned ZERO rows, then wrote a completion stamp recording
          // `backlogAtSweep: 43,118`. That field is documented as the
          // IRREDUCIBLE RESIDUE — rows proven undatable — and it became the
          // floor the +5,000 growth re-arm measures against. So the sweep
          // disarmed itself for 7 days on the strength of work it never did,
          // and each repeat would raise the floor further: a ratchet.
          //
          // A phase that could not be READ has proven nothing about whether its
          // rows are datable. drawFailed keeps the completion stamp away.
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
      // Progress beacon, written BEFORE any vendor call and again as the loop
      // advances. Two rounds of end-of-hop instrumentation reported nothing,
      // because the hop never reaches its end: measured on 2026-07-28.12, note
      // stayed null while the draw is proven good (500 rows in 0.23s, and the
      // draw-error path writes directly and never fired) and ZERO writes have
      // ever landed (0 dated across bamboohr, rippling and pinpoint, all
      // count=exact). A diagnostic that only speaks at the finish line cannot
      // describe a run that never finishes.
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
            // ONE BOARD FETCH, THEN THE POSTING PAGES.
            //
            // postings.json carries no date — that part of the 2026-08-08 note
            // was right, and it is why this phase did not exist. What it missed
            // is that every Pinpoint posting PAGE carries an employer-stated
            // `datePosted` in its schema.org JSON-LD, and the list payload
            // already hands us the URL. 9,805 rows sat at exactly 0% dated on
            // that inference.
            //
            // Same shape as the description sweep: fetch the board list once to
            // map id -> url, then walk only the ids this hop drew.
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
      // END-OF-HOP stamp, written DIRECTLY rather than forwarded through
      // chain(). The previous commit only passed the outcome to the NEXT hop —
      // which is useless for diagnosing a chain that never reaches hop 2, and
      // that is the exact failure being diagnosed. A diagnostic whose delivery
      // depends on the thing it is diagnosing reports nothing: measured
      // 2026-07-28 on 2026-07-28.10, note stayed null while the sweep sat at
      // bamboohr 0% dated.
      //
      // What note=null DID prove is worth keeping: the draw-error path writes
      // its note directly, so a null note means the draw did not throw —
      // matching the direct measurement of 500 rows in 0.23s. The failure is
      // therefore in the vendor/update stage, which this stamp now records.
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
          })).then((r) => r.text()).catch(() => {}));
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
      // backlogAtSweep is the IRREDUCIBLE RESIDUE — what remains undated after
      // a full sweep, because those rows carry no vendor date or are no longer
      // listed. Recording it here is what lets the growth re-arm measure new
      // intake instead of re-running forever against rows already proven
      // undatable. Null (rollup unreadable) simply omits the key, and the next
      // sweep is then timer-driven, which is the behaviour before this existed.
      // A SWEEP THAT SCANNED NOTHING IS NOT A COMPLETED SWEEP.
      //
      // This stamp was unconditional, and that is how the lane disarmed itself
      // for 4.9 days: the terminal phase's draw timed out, `exhausted` was set,
      // control fell straight through to here, and a run with scannedTotal:0
      // and datedTotal:0 wrote `{version, sweptAt, backlogAtSweep: 43118}`. The
      // stamp is indistinguishable from a real sweep, so postedBackfillDue went
      // false for a week AND the growth floor was poisoned with 43,118 rows
      // nothing had touched.
      //
      // This file already documents the identical failure for the name-sync
      // lane: "the stamp was UNCONDITIONAL. A run that reached the end having
      // failed every single update still wrote its version and was never
      // retried." Same treatment here — leave `version` unwritten so
      // postedBackfillDue stays true and the next kick retries.
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
          .select("id,salary,country,title,description,salary_min_annual,salary_max_annual,salary_period,salary_currency")
          .not("salary", "is", null)
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const row = r as { id: string; salary?: string | null; country?: string | null; salary_min_annual?: number | string | null; salary_max_annual?: number | string | null; salary_period?: string | null; salary_currency?: string | null };
          const p = parseSalaryStructured(row.salary, row.country, { title: (row as { title?: string | null }).title ?? null, description: (row as { description?: string | null }).description ?? null });
          const nextMin = p?.annualMin ?? null;
          const nextMax = p?.annualMax ?? null;
          const nextPer = p?.period ?? null;
          const nextCur = p?.currency ?? null;
          const curMin = row.salary_min_annual == null ? null : Number(row.salary_min_annual);
          const curMax = row.salary_max_annual == null ? null : Number(row.salary_max_annual);
          const curPer = row.salary_period ?? null;
          const curCur = row.salary_currency ?? null;
          if (nextMin === curMin && nextMax === curMax && nextPer === curPer && nextCur === curCur) continue; // already correct — no write
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
        })).then((r) => r.text()).catch(() => {}));
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
      const r = await runRefresh(client, force, force ? hop : 0);
      return json(r, r.ok ? 200 : 502);
    }

    if (action === "list") {
      // THE CLOCK STARTS HERE, NOT INSIDE serveList.
      //
      // reqStart was assigned AFTER this meta read, so the ~1.3-1.6MB facet row
      // fetched on the line below was outside every number the function
      // publishes about itself. Measured against a probe that does the same read
      // and nothing else, a median ~958ms of a list request was invisible —
      // tookMs and phaseMs were reporting roughly a quarter of real server time,
      // and two previous latency fixes were aimed with that instrument.
      const t_entry = Date.now();
      // THE SMALL ROW FIRST — see the writer. `refresh_head` carries exactly what
      // this path reads, with companiesFacet truncated to the top 200 and the
      // true employer count stored beside it.
      //
      // FALLING BACK ON companiesCount, not on the row's existence, and that is
      // the whole safety of the deploy window: between this code shipping and
      // the next refresh pass writing the row, refresh_head is absent — and if a
      // partially-written or older-shaped row ever appeared, deriving the count
      // from a 200-row slice would publish "200 employers" as a fact. Requiring
      // the explicit number means the only rows accepted are ones that carry it.
      const { data: headRow } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_head").maybeSingle();
      let meta = (headRow && typeof (headRow.v as Record<string, unknown> | null)?.companiesCount === "number"
        ? headRow
        : null) as { v: Record<string, unknown>; updated_at: string } | null;
      if (!meta) {
        const { data: metaRow } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle();
        meta = (metaRow ?? null) as { v: Record<string, unknown>; updated_at: string } | null;
      }

      if (!meta) {
        // First boot (migration just applied, no pass yet): one blocking
        // refresh seeds the table; afterwards this path never runs again.
        const seeded = await runRefresh(client, true);
        if (!seeded.ok) return json({ error: "Job board is initializing — try again shortly" }, 503);
        return await serveList(client, body, undefined, t_entry);
      }
      if (Date.now() - new Date(meta.updated_at).getTime() > STALE_MS) {
        waitUntil(runRefresh(client)); // serve stale, refresh behind the scenes
      }
      return await serveList(client, body, meta, t_entry);
    }

    if (action === "fit-batch") {
      const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 60) : [];
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
        .select("id, description")
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
          const f = computeFit(r.description, resumeScan, 40);
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
      // Feature 1: the four Greenhouse giants fetch WITHOUT content on the
      // refresh path (bulk htmlToText wedged the pipeline — see
      // LIGHT_DESC_TOKENS), so their postings land description-less. This
      // maintenance sweep fills the gaps using Greenhouse's PER-JOB endpoint
      // (tiny payloads) — never the 20-36 MB whole-board content payload,
      // which OOM'd/timed out when re-fetched per slice. It targets only
      // rows still missing a description, so after the initial fill the
      // daily delta is near-zero and transient per-job failures self-heal
      // (the row stays null and is retried next run). chainKey-gated.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-desc is a maintenance action" }, 403);
      }
      await loadDynamicLight(client); // fresh invocation — auto-enrolled boards need their descs filled too
      // Greenhouse ONLY: this lane fetches the GH per-job endpoint, and the
      // light set is vendor-agnostic (Workable boards auto-enrol into
      // DYNAMIC_LIGHT), so every non-GH board here 404s forever. Other
      // vendors fill via the desc-sweep board lane, which uses their own
      // list payloads.
      const BOARDS = JOB_SOURCES.filter((s) => s.source === "greenhouse" && isLight(s.token));
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
      })).then((rr) => rr.text()).catch(() => {}));
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
      // QUEUE SELF-SEED. The migration's one-shot seed INSERT (a full anti-join
      // in one statement) evidently never completed in the hosted migration
      // runner — measured live 2026-07-26: the sweep settling on "batch error:
      // canceling statement due to statement timeout", the signature of an
      // EMPTY fill queue pushing get_embed_batch into its heavy phase-2 walk.
      // So the seed happens HERE instead, in bounded chunks riding the same
      // paced chain: 2,000 candidate ids per hop by id-cursor, an .in() lookup
      // to skip already-present rows, plain inserts of the rest. No anti-join
      // ever runs on a request path. ~570k rows / 2k per ~5s hop ≈ 25 minutes
      // to fully seed, once. Harmless when the queue is healthy (one cheap
      // no-op read once done=true).
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
            })).then((rr) => rr.text()).catch(() => {}));
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
            })).then((rr) => rr.text()).catch(() => {}));
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
        })).then((rr) => rr.text()).catch(() => {}));
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
        })).then((rr) => rr.text()).catch(() => {}));
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
      // Bulk description fill for the vendors whose text needs a PER-POSTING
      // fetch. Measured 2026-07-24: workday, smartrecruiters, bamboohr, oracle
      // and breezy held ~406k of the ~457k postings with no description — all
      // of them at exactly 0% coverage, because nothing had ever fetched them.
      // (backfill-desc above is a different job: Greenhouse giants that skip
      // content=true on the refresh path.)
      //
      // Ordered NEWEST-FIRST so the postings people actually see fill first.
      // The `detail` read path fills anything a user opens ahead of the sweep,
      // so this is the tail, not the primary mechanism.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "desc-sweep is a maintenance action" }, 403);
      }
      let vi = Math.max(0, Number(body.vi) || 0);
      const vstart = Math.max(0, Number(body.vstart) || 0) % DETAIL_DESC_SOURCES.length;
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
        })).then((rr) => rr.text()).catch(() => {}));
        return json({ ok: true, phase: "boards", token: b.token, filled, nextBi: bi });
      }
      const vendor = DETAIL_DESC_SOURCES[vi];
      await client.from("job_board_meta").upsert(
        { k: "desc_sweep", v: { runningVi: vi, vendor }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      const { data: rows, error: readErr } = await client
        .from("job_board_postings")
        .select("id, company_token, apply_url, title, location, country, posted_at, work_mode")
        .eq("source", vendor)
        .is("description", null)
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(DESC_SWEEP_PER_HOP);
      if (readErr) throw readErr;
      const queue = [...(rows ?? [])] as Array<{
        id: string; company_token: string; apply_url: string | null;
        title: string | null; location: string | null; posted_at: string | null; work_mode: string | null;
      }>;
      const pending = [...queue];
      let updated = 0;
      await Promise.all(Array.from({ length: DESC_SWEEP_CONCURRENCY }, async () => {
        for (;;) {
          const row = pending.shift();
          if (!row) return;
          const src = JOB_SOURCES.find((s) => s.source === vendor && s.token === row.company_token);
          if (!src) continue; // board left the catalog — leave the row alone
          const externalId = String(row.id).split(":").slice(2).join(":");
          if (!externalId) continue;
          try {
            const { text, postedAt, workMode: wmVendor } = await fetchVendorDetail(src, row.id, externalId, row.apply_url);
            if (!text) {
              // AN EMPTY BODY IS NOT AN EMPTY PAYLOAD. This was a bare
              // `continue`, which discarded a remoteType and a startDate that
              // had ALREADY been parsed out of the same response: the fetch was
              // paid for, the vendor stated both facts, and they were dropped
              // because a different field of that payload came back blank.
              //
              // Salvage them on the way past. The row keeps its null
              // description and is retried for that next sweep — this only
              // stops the structured half being collateral damage.
              const salv: Record<string, unknown> = {};
              if (wmVendor) { salv.work_mode = wmVendor; salv.remote = wmVendor === "remote"; }
              if (postedAt && (vendor === "workday" || !row.posted_at)) salv.posted_at = postedAt;
              if (Object.keys(salv).length) {
                // The work_mode IS NULL guard applies ONLY when this patch
                // actually writes a work mode. Attaching it unconditionally
                // would mean a row that already HAS a work mode and is missing
                // a date matches nothing — silently dropping the very date this
                // block exists to rescue.
                const q = client.from("job_board_postings").update(salv).eq("id", row.id);
                await (wmVendor ? q.is("work_mode", null) : q);
              }
              continue;
            }
            const clean = text.replace(/\u0000/g, "").slice(0, STORED_DESC_CAP);
            if (!clean) continue;
            // Same rule as ingest: the description is also the salary source
            // where the vendor gave us no structured pay field. Only ever the
            // company's own words — never an estimate.
            const minedSalary = extractSalary(clean);
            const minedParse = minedSalary ? parseSalaryStructured(minedSalary, (row as { country?: string | null }).country, { title: (row as { title?: string | null }).title ?? null, description: clean }) : null;
            // The three fields below are DERIVED FROM DESCRIPTION TEXT but were
            // only ever computed at ingest, so the description backfill left
            // them stale — measured coverage was experience 26.4%, work mode
            // 9.7%, salary 4.0%. Re-deriving here costs nothing: the text is
            // already in hand.
            const exp = detectExperience(row.title ?? "", clean);
            // Work-mode precedence: a vendor's own STRUCTURED field (workday
            // remoteType, arriving with the same detail payload) outranks
            // everything, including a previously stored inferred value —
            // workday rows only ever had text inference at ingest, so the
            // structured statement corrects them. Prose inference stays
            // fill-only: it never overwrites.
            // NO DESCRIPTION ARGUMENT. detectWorkMode's contract is stated at
            // normalize.ts:156 — "clear words only; descriptions are never
            // inferred from" — and every call site in normalize.ts obeys it.
            // This one passed the 4,000-char description as a third part, and
            // P_REMOTE is a bare /\bremote\b/, so one incidental use of the
            // word in prose tagged the posting remote. Live examples pulled
            // from employers' own payloads: "due to the remote location of this
            // site, there are no public transport links", "a major civil
            // earthworks project in remote Northern Saskatchewan", "the
            // technical component of remote cardiac device monitoring", and —
            // best of all — "There is no option for this position to be
            // remote." All four were being served under the Remote filter.
            const wm = wmVendor ?? (row.work_mode ? null : detectWorkMode(row.location, row.title));
            // Dates: Workday's stored value is a relative bucket floored at 30
            // days, so an absolute startDate is strictly better and replaces
            // it. For every other vendor we only fill a gap.
            const betterDate = postedAt && (vendor === "workday" || !row.posted_at) ? postedAt : null;
            const { error } = await client.from("job_board_postings")
              .update({
                description: clean,
                ...(exp.band ? { experience_band: exp.band, min_years: exp.minYears } : {}),
                // `remote` moves WITH work_mode, or the columns drift apart.
                // normalize.ts:1069 sets remote = (workMode === "remote") at
                // ingest and normalize.ts:17 documents it as "true only when
                // workMode is definitively remote". These re-derive writes
                // updated one and not the other, leaving 32/616 design,
                // 43/479 security and 56/790 legal rows work_mode='remote'
                // with remote=false — invisible to the board's Remote filter.
                ...(wm ? { work_mode: wm, remote: wm === "remote" } : {}),
                ...(betterDate ? { posted_at: betterDate } : {}),
                ...(minedSalary ? {
                  salary: minedSalary,
                  salary_min_annual: minedParse?.annualMin ?? null,
                  salary_max_annual: minedParse?.annualMax ?? null,
                  salary_period: minedParse?.period ?? null,
                  salary_currency: minedParse?.currency ?? null,
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
      const exhausted = queue.length < DESC_SWEEP_PER_HOP || updated === 0;
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
        body: JSON.stringify({ action: "desc-sweep", chainKey: key, vi, vstart }),
      })).then((rr) => rr.text()).catch(() => {}));
      return json({ ok: true, vendor, scanned: queue.length, updated, nextVi: vi });
    }

    if (action === "structured-sweep") {
      // THE WORK-MODE RECOVERY LANE, AND WHY desc-sweep COULD NOT BE IT.
      //
      // fetchVendorDetail already parses Workday's `remoteType` into a
      // structured work mode (:2596) and its `startDate` into a real posting
      // date. That code is correct. It simply cannot reach the rows that need
      // it, because desc-sweep selects
      //
      //     .eq("source", vendor).is("description", null)
      //
      // and writes through `.is("description", null)` as well. Both are right
      // for descriptions and fatal for everything else: the moment a posting
      // has a description — stored by the on-demand `detail` read at :2466, or
      // by a sweep that ran before the remoteType parsing existed — it becomes
      // permanently invisible to the only code that could state its work mode.
      //
      // Measured 2026-08-12: work_mode is set on 29% of served postings.
      // Workday is 306,186 of them, half the board, and its LIST payload
      // carries no work-mode field at all — so every Workday row is
      // text-inferred or nothing, and the structured statement sitting in a
      // detail payload we already know how to fetch never lands.
      //
      // KEYSET PAGINATION, NOT "SELECT WHERE STILL NULL". desc-sweep can
      // re-select its gaps every hop because filling one removes it from the
      // predicate. Here the predicate cannot be self-clearing: a posting whose
      // detail genuinely states no remoteType stays work_mode IS NULL forever
      // and would be re-fetched on every hop, so the lane would spend its
      // entire budget on the rows it has already proven have nothing to give.
      // A cursor over `id` visits each row once per pass instead.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "structured-sweep is a maintenance action" }, 403);
      }
      let vi = Math.max(0, Number(body.vi) || 0);
      // Cumulative pass totals, carried THROUGH THE CHAIN body. Each hop's
      // progress stamp used to hold only that hop's numbers, and the done
      // branch then overwrote the row with a bare {doneAt} — so a completed
      // pass ERASED its own evidence. Measured 2026-08-12: the first real
      // pass finished in ~7 minutes and left {doneAt} and nothing else, which
      // made "the eligible set was genuinely small" and "the walk terminated
      // early" indistinguishable from the outside. A pass that cannot report
      // what it did forces exactly the forensics it exists to prevent.
      const passScanned = Math.max(0, Number(body.passScanned) || 0);
      const passFilled = Math.max(0, Number(body.passFilled) || 0);
      if (vi >= STRUCTURED_SWEEP_SOURCES.length) {
        // THE TERMINAL STAMP KEEPS THE WINDOW IT WALKED.
        //
        // It used to write only {doneAt, scanned, filled} and drop the
        // vendor/cursor/lastId/pageLen the per-hop stamp carries — so a
        // completed pass erased the only evidence that distinguishes "walked
        // the whole range" from "the select came back short". That is precisely
        // the shape of the ";"-truncation incident this lane already survived
        // once, where two passes stamped doneAt over 148,776 untouched rows.
        //
        // `zeroFilledPasses` is what stops the lane re-walking ~154,000 Workday
        // detail fetches every 24 hours to write nothing: see the re-kick gate.
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
      // STAMP BEFORE THE WORK, NOT AFTER.
      //
      // This lane originally wrote its meta row only at the END of a
      // successful hop, so a hop that died left status all-null — identical to
      // "never kicked". It cost two deploys to tell those apart: the kick is
      // fire-and-forget through waitUntil with a `.catch(() => {})`, so a
      // failing action is invisible from both ends at once. desc-sweep stamps
      // `runningVi` up front for exactly this reason.
      // SEED THE CURSOR TO THE VENDOR'S RANGE, and this is why the first hop
      // kept dying.
      //
      // `id` is `source:token:externalId`, so ordering by id orders by vendor
      // first — and every vendor we carry sorts BEFORE "workday": ashby,
      // bamboohr, breezy, greenhouse, icims, lever, oracle, personio, pinpoint,
      // recruitee, rippling, smartrecruiters, teamtailor, workable. Starting an
      // empty cursor at the beginning of the table meant the first hop had to
      // walk roughly 300,000 rows that fail `source = 'workday'` before
      // reaching a single candidate, and it timed out every time.
      //
      // Every LATER hop was fine, because by then the cursor was already inside
      // the vendor's range — which is the nastiest shape for this: the lane
      // would have worked perfectly from hop two onward and could never reach
      // hop two.
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
        .select("id, company_token, apply_url, posted_at, work_mode")
        .eq("source", sVendor)
        .not("description", "is", null)
        .is("work_mode", null)
        .order("id", { ascending: true })
        // BOUNDED AT BOTH ENDS. `gt` seeds the walk at this vendor's range;
        // `lt` stops it leaving.
        //
        // THE SENTINEL IS "~", NOT ";" — and that one character cost two full
        // passes. ";" is the byte after ":", the theoretically-tight bound,
        // and it DIES IN TRANSIT: proven live 2026-08-12 against the REST
        // layer, `id=lt.workday;` matches ZERO rows while the identical query
        // with `~` returns them — the semicolon is truncated somewhere in the
        // query-string path (semicolons are a legacy query-param separator),
        // leaving `lt.'workday'`, which excludes every `workday:` id. The
        // sweep's select came back empty, sDone fired, and the pass stamped
        // doneAt with 148,776 eligible rows untouched — twice.
        //
        // "~" (0x7E) sorts above ":" (0x3A), every id is `{vendor}:...`, and
        // vendor names are lowercase ASCII, so `{vendor}~` is a correct upper
        // bound for every vendor and survives the URL.
        //
        // Without SOME upper bound the final hop of a vendor walks the entire
        // remainder of the table — every row failing `source = ?` — to prove
        // there is nothing left. Today workday sorts last so that remainder is
        // empty and the bug would not show; add one vendor after it and the
        // lane inherits the same timeout that the missing lower bound caused.
        .lt("id", `${sVendor}~`)
        .limit(STRUCTURED_SWEEP_PER_HOP);
      if (cursor) sel = sel.gt("id", cursor);
      const { data: sRows, error: sErr } = await sel;
      if (sErr) throw sErr;
      const sQueue = [...(sRows ?? [])] as Array<{
        id: string; company_token: string; apply_url: string | null;
        posted_at: string | null; work_mode: string | null;
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
            const { postedAt, workMode } = await fetchVendorDetail(src, row.id, externalId, row.apply_url);
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
            if (!Object.keys(patch).length) continue;
            // `filled` MUST MEAN ROWS WRITTEN, NOT UPDATES ATTEMPTED.
            //
            // PostgREST returns no error when an update matches zero rows, so
            // `if (!error) sFilled++` counted attempts. Once the classifier
            // starts producing work modes that distinction becomes the whole
            // question: without it you cannot tell "wrote 6,700 rows" from
            // "matched nothing 6,700 times", which is exactly the ambiguity
            // that let 154,003 scanned / 0 filled sit unexplained.
            const { data: wrote, error } = await client.from("job_board_postings")
              .update(patch)
              .eq("id", row.id)
              // Gap-fill only, and it is what makes a concurrent desc-sweep
              // write safe: if that lane set a work mode between our select and
              // our update, this update matches nothing rather than racing it.
              .is("work_mode", null)
              .select("id");
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
      })).then((rr) => rr.text()).catch(() => {}));
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
      // THE OTHER HALF OF THE LOOP. A search event says what was shown; this
      // says what was chosen. Neither is worth much alone — zero-result rate
      // without click-through tells you people got results, not that the
      // results were right.
      //
      // Deliberately permissive about what it accepts. A click that arrives
      // without a searchId (browse, a restored tab, a client that lost the id)
      // is still recorded, because dropping those would bias every rate toward
      // people who searched. posting_id is the only hard requirement.
      const postingId = String(body.postingId ?? "").slice(0, 200);
      if (!postingId) return json({ ok: false, reason: "postingId required" }, 400);
      const rawSid = String(body.searchId ?? "");
      // Validated, not trusted: a malformed uuid would make the INSERT fail as
      // a whole and lose the click entirely. Anything that is not a uuid is
      // stored as null, which still counts the click.
      const sid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSid) ? rawSid : null;
      const posN = Number(body.position);
      waitUntil(Promise.resolve(
        client.from("job_board_search_clicks").insert({
          search_id: sid,
          posting_id: postingId,
          q: String(body.q ?? "").slice(0, 200),
          position: Number.isFinite(posN) && posN > 0 ? Math.min(Math.trunc(posN), 100000) : null,
          kind: body.kind === "apply" ? "apply" : "open",
        }).then(({ error }) => {
          if (error) console.warn("[JOB-BOARD] click insert failed:", error.message);
        }),
      ));
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
      const liveMap: Record<string, boolean> = {};
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
        else liveMap[id] = true; // true OR null(unknown) → keep showing, never a false close
      }
      // NEVER delete on a single probe. Measured 2026-07-28: checkLive reported
      // GONE for 7 of 50 randomly sampled LIVE Workday postings. That was read
      // at the time as Workday's search index being incomplete; the real cause,
      // found 2026-08-06, is that we were searching for an id Workday never
      // indexes — see the `-N` discriminator note in checkLive. The probe now
      // corroborates against the CXS detail endpoint before returning false, so
      // this branch sees far fewer misses, but the rule below is unchanged and
      // deliberately so: it is what made a probe bug survivable instead of
      // destructive. This branch used to DELETE unconditionally, which is silent
      // destruction of open jobs, and it contradicted the published audit that
      // reports workday accuracy 100% (gone: 0). A user clicking Apply was the
      // thing destroying the row.
      //
      // Same two-pass rule the refresh prune already uses (VERIFY_GRACE_MS):
      // stamp missing_since on the first miss; only remove a row whose stamp has
      // already survived the window. Rows that come back have the stamp cleared
      // by the normal refresh, and missing_since is excluded from every serving
      // path, so the user stops seeing it immediately either way — we just no
      // longer destroy the evidence on one bad probe.
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
      // Ground-truth audit: sample ~100 random served postings and confirm each
      // is still live at the vendor SOURCE. Produces the measured accuracy stat
      // ("X% of sampled listings confirmed live") published on the Ghost Job
      // Index and watched by the heartbeat — the board grading its own honesty.
      // Pure measurement: confirmed-gone ids are left for the normal refresh
      // prune (which owns closure logging). Self-throttled to ~1/day; a public
      // trigger just gets the cached result back.
      const AUDIT_SAMPLE = 100;
      const { data: prevAudit } = await client.from("job_board_meta").select("v, updated_at").eq("k", "audit").maybeSingle();
      const prevAge = prevAudit ? Date.now() - new Date(prevAudit.updated_at).getTime() : Infinity;
      if (prevAge < 20 * 3600_000 && body.force !== true) {
        return json({ ...(prevAudit?.v as Record<string, unknown>), cached: true });
      }
      // STRATIFIED sample: ~equal draws per vendor, not pure random. A pure
      // random sample is dominated by the biggest vendors — a small vendor
      // could serve 100% dead listings and barely dent the blended number.
      // Stratifying makes any single vendor's break visible within one audit,
      // and produces the per-vendor accuracy published alongside the headline.
      // PLANNED, not EXACT. An exact count is a full scan of every matching row,
      // and at ~590k postings that no longer fits the statement timeout —
      // measured 2026-08-06, the corpus count AND all 15 per-vendor counts each
      // came back 500 "canceling statement due to statement timeout" in 3.2s.
      //
      // The failure mode is what makes this urgent rather than slow: a dead
      // count left the vendor at n = 0, `n === 0` skipped it before it could be
      // drawn, and a vendor with no rows is not a "missing source" — so it
      // vanished from coverage too. The audit published a figure covering 6 of
      // 15 hiring systems while its own coverage line read "reached every
      // hiring system with postings on the board". That is the 2026-07-27
      // omission again, walking in through the one door the coverage instrument
      // did not watch.
      //
      // The planner estimate answers in 0.1s and was within 0.4% of the exact
      // count the same morning (592,860 vs 590,501) — far more precision than a
      // stratification weight or a coverage share needs. It IS an estimate, and
      // the payload and the page both say so rather than implying a census.
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
      // KEYSET, not OFFSET. The old draw was
      //   .order("id").range(off, off+per-1)  with off up to n-per
      // which is a deep OFFSET. On workday — 303,098 rows, 52.1% of the
      // whole board — that query never returned, and because `error` was
      // destructured away the failure read as an empty page. Workday
      // therefore contributed ZERO ids and vanished from byVendor entirely,
      // while the blended headline still published as the board's accuracy.
      // Verified live 2026-07-27: 14 strata present, workday absent.
      // Same fix already applied to the sitemap today: anchor on a random
      // board for this vendor and seek forward on the indexed id.
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
      let live = 0, gone = 0, unknown = 0;
      const byVendor: Record<string, { sampled: number; live: number; gone: number; unknown: number; accuracyPct: number | null; deepened?: boolean }> = {};
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
            if (!src || rest.length === 0) return null; // deselected board — can't ground-truth
            return await checkLive(src, rest.join(":"), applyBy.get(id) ?? null);
          }));
          results.forEach((r, j) => {
            const v = batch[j].split(":")[0];
            const bucket = byVendor[v] ?? (byVendor[v] = { sampled: 0, live: 0, gone: 0, unknown: 0, accuracyPct: null });
            bucket.sampled++;
            if (r === true) { if (headline) live++; bucket.live++; }
            else if (r === false) { if (headline) gone++; bucket.gone++; }
            else { if (headline) unknown++; bucket.unknown++; }
          });
        }
      };
      await probeAll(sampleIds, true);
      const headlineSampled = sampleIds.length;

      // ESCALATE BEFORE ACCUSING. A stratified draw gives each vendor ~6 ids, so
      // a single dead listing moves that vendor from 100% to 83% and two move it
      // to 67% — under the 80% floor the heartbeat pages on. At a true 3% death
      // rate, 2-of-6 comes up on some vendor roughly one day in six, so the alarm
      // was firing mostly on sampling noise (2026-08-06: workday 66.7% = 4 live,
      // 2 gone) and a real vendor break would have looked identical. A number
      // that thin is not evidence either way, so any vendor that looks bad gets
      // re-drawn deeper and is judged on the combined sample instead.
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
      // COVERAGE. A stratified audit that silently drops a stratum publishes a
      // number about a different board than the one it names. On 2026-07-27 the
      // stored result carried 14 strata and no workday — 303,098 postings,
      // 52.1% of the corpus — because the deep-OFFSET draw above failed and
      // its error was discarded. The headline still read "98.8% confirmed
      // live". Coverage is computed here so the omission travels WITH the
      // number and the page can disclose it instead of the reader having to
      // notice a missing table row.
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
      // `sampled` is the EVEN draw the headline describes; `probed` is every
      // probe including the follow-up re-draws. Publishing sampleIds.length as
      // `sampled` would state a sample size the headline was not computed from.
      const result = { at: new Date().toISOString(), sampled: headlineSampled, probed: sampleIds.length, live, gone, unknown, accuracyPct, corpus, byVendor, coverage, deepened, labelAudit };
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
      // THE EMPLOYER TYPEAHEAD WAS COSTING EVERY VISITOR 99KB.
      //
      // The list response shipped the whole employer facet — measured
      // 2026-08-24: 99,237 of 141,196 bytes, 70.3% of the payload, 1,433
      // entries — so that a typeahead most visitors never open could filter
      // it locally and show twelve rows. On mobile the control is hidden
      // behind a "Filters" tap, and the facet is 2.6x the size of the jobs it
      // decorates.
      //
      // The suggestions come from the same cached facet the list used, so
      // this costs one indexed meta read and no table work at all. The list
      // now ships a short head of that facet and asks here for the rest.
      const q = String(body.q ?? "").trim().toLowerCase().slice(0, 80);
      if (q.length < 2) return json({ companies: [] });
      const { data: metaRow } = await client.from("job_board_meta").select("v").eq("k", "refresh").maybeSingle();
      const facet = ((metaRow?.v as Record<string, unknown> | undefined)?.companiesFacet ?? []) as Array<{ token?: string; name?: string; count?: number }>;
      const merged = mergeCompanyFacet(facet);
      const hit = merged.filter((c) => String(c.name ?? "").toLowerCase().includes(q));
      // A name that STARTS with what was typed is what the reader meant;
      // count breaks ties beneath that.
      hit.sort((a, b) => {
        const ap = String(a.name ?? "").toLowerCase().startsWith(q) ? 0 : 1;
        const bp = String(b.name ?? "").toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || (b.count ?? 0) - (a.count ?? 0);
      });
      return json({ companies: hit.slice(0, 12).map((c) => ({ token: c.token, name: c.name, count: c.count })) });
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
      // THE 30-DAY CAP WAS A PROPERTY OF THE LIST PATH ONLY.
      //
      // Every serving route binds `.gte("effective_posted", freshCutoffIso)`
      // through buildQuery — every route except this one. This action's 78
      // lines contained no freshness predicate at all, so anyone holding an id
      // (a bookmark, a sitemap entry, a crawler, a shared link) got a past-cap
      // posting rendered in full, with a working apply button, under a board
      // that advertises a 30-day cap. The apply button is the harm: the whole
      // point of the cap is not to send someone at a role that is gone.
      //
      // effective_posted is coalesce(posted_at, first_seen), so this is the
      // SAME rule the list applies — undated rows age out 30 days after we
      // first saw them, dated rows 30 days after the employer's date. Using
      // any other definition here would just relocate the inconsistency.
      //
      // Answered like the closure case below rather than with a bare 404: we
      // know the title and the date, so the client can say what happened and
      // offer live alternatives instead of a dead end. Checked BEFORE the
      // description fetch so an aged-out row never costs a vendor round trip.
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
      const description = stored ?? await getDescription(src, id, externalId, jobRow?.apply_url as string | undefined);
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
        const minedParse = minedSalary ? parseSalaryStructured(minedSalary, jobRow.country as string | null, { title: jobRow.title as string | null, description }) : null;
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
              ...(minedSalary ? {
                salary: minedSalary,
                salary_min_annual: minedParse?.annualMin ?? null,
                salary_max_annual: minedParse?.annualMax ?? null,
                salary_period: minedParse?.period ?? null,
                salary_currency: minedParse?.currency ?? null,
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
      // Apply agent: fetch a posting's REAL application questions where the ATS
      // exposes its form publicly — Greenhouse (?questions=true), Ashby (the
      // public GraphQL endpoint its own hosted apply pages call; `field` is a
      // raw JSON scalar), and Recruitee (open_questions + document config on
      // the offers API). Everything else returns supported:false so the client
      // falls back to JD-inferred questions. Each question is classified so the
      // UI/answer-drafter knows what may be auto-drafted vs. what the candidate
      // must answer (identity, demographics, work-auth, salary). `requirements`
      // lists the documents the form demands, so the candidate can have them
      // ready BEFORE they start.
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
        const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${externalId}?questions=true`);
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

      // Breezy and Pinpoint both SERVER-RENDER their apply route, so the real
      // form is readable without a browser. Added 2026-08-01 after a live dry
      // run showed these two were the only remaining blocker class on drivable
      // vendors — and that we were harvesting questions for Ashby and
      // Greenhouse, which are both NO-BUILD on CAPTCHA, while harvesting none
      // for three of the four vendors the worker can actually drive.
      //
      // The URLs come from vendor-questions.ts, which is also what the tests
      // pin against the worker's adapters: harvesting one form and filling a
      // different one would put confident answers to unasked questions into a
      // packet, which is worse than harvesting nothing.
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

// deno-lint-ignore no-explicit-any
// last_seen is written at INSERT ONLY and never rewritten, so it is
// semantically first_seen — two greenhouse rows measured 2026-07-28 carry a
// last_seen 5s and 3s BEFORE their own first_seen. The UI rendered it as
// "re-checked {ago}" under a tooltip claiming "last re-verified against the
// company's own feed": the banned first_seen-as-freshness pattern, stated in
// words. It also understated us ~100x — 92.6% of postings read as older than
// 24h while the true feed p50 is ~83 minutes.
//
// job_board_verifications.verified_at is the honest value: when we last fetched
// THAT BOARD's feed. Keyed by company_token, so one .in() over a page's
// distinct tokens covers the page on the primary key.
// Time spent inside attachRecheckedAt on the current request. A module-level
// accumulator because this helper is called from eight list exits and adding a
// parameter to each is more edit surface than the measurement is worth; the
// handler zeroes it per request.
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
  // `token`, NOT `companyToken`. rowToJob emits the field as `token`; this read
  // `j.companyToken`, which is undefined on every row, so the token list was
  // always empty and this function returned early on every single call. The
  // board's strongest per-posting sentence — "re-checked N minutes ago", about
  // THIS job rather than about 24,934 boards in aggregate — has therefore never
  // rendered to a single visitor, on any of the three UI surfaces built to show
  // it. Verified live before the fix: 0 of 60 served rows carried recheckedAt,
  // and the payload key list contains `token` and no `companyToken`.
  //
  // A typo, and invisible precisely because the failure was silent: an empty
  // token list is indistinguishable from "no stamps available", which is a
  // legitimate state this function is designed to degrade into.
  const tokens = [...new Set(jobs.map((j) => String(j.token ?? "")).filter(Boolean))].slice(0, 80);
  if (tokens.length === 0) return jobs;
  const { data, error } = await client
    .from("job_board_verifications")
    .select("company_token,verified_at")
    .in("company_token", tokens);
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
) {
  // WHOLE ROWS, OR THE PAGER HANDS BACK A POSITION THAT CANNOT EXIST.
  //
  // These were `Number(x) || default` clamps, which coerce anything rather than
  // rejecting it, and one of the things they coerced was a FRACTION. Measured:
  // offset=1.5 returned rows and echoed nextOffset 7.5, a fractional offset
  // handed straight back to the client to resend into a PostgREST range() call;
  // following that chain never advances past the first few rows. offset="abc"
  // and offset=-100 both silently became 0, so a broken pager looked like a
  // working one parked on page one. limit=0 became 60 because zero is falsy.
  //
  // Coercion stays — a 400 here would break live callers that have always been
  // tolerated, and the data API is used by people who are not watching. But the
  // value is now floored to a whole row, so whatever we accept, we can serve,
  // and nextOffset is always a position that exists.
  const limitRaw = Number(body.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 200) : 60;
  const offsetRaw = Number(body.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  const countOnly = body.countOnly === true;
  // KEYSET CURSOR — a page anchored to the last row read, not to a row count.
  //
  // Measured 2026-08-18 03:0xZ, ingest active: 4 of 8 offset-paged page-1 ->
  // page-2 transitions OVERLAPPED; the worst pair duplicated 9 of 60 rows and
  // silently hid 9 others (union 111/120). Offset pagination cannot be stable
  // over a table inserting ~70k rows/day above the reader: every insert shifts
  // the window. The cursor is the (effective_posted, id) of the last raw row
  // the previous page consumed; the next page starts strictly after it, so
  // inserts above cost nothing and no row is shown twice or skipped.
  //
  // VALIDATED, NOT TRUSTED: both values are interpolated into a PostgREST
  // or() filter tree, so anything that could not have come from our own
  // nextCursor is rejected and the request falls back to offset paging —
  // fail open to the old behaviour, never a 500 on a stale bookmark.
  const cursor = (() => {
    const c = body.cursor as { ep?: unknown; id?: unknown } | undefined;
    if (!c || typeof c !== "object") return null;
    const ep = typeof c.ep === "string" ? c.ep : "";
    const id = typeof c.id === "string" ? c.id : "";
    if (!ep || !id || id.length > 200) return null;
    if (!/^\d{4}-\d{2}-\d{2}T[0-9:.+]+$/.test(ep)) return null;
    if (/[",()\\]/.test(id)) return null;
    return { ep, id };
  })();
  // Location-cluster collapsing is on unless a caller opts out (the lander and
  // company views WANT every location listed). Over-fetch so there is material
  // to fold: a page of 25 reads up to 75 rows, which is still one indexed page.
  const groupSimilar = body.groupSimilar !== false && !countOnly;
  const fetchLimit = groupSimilar ? Math.min(limit * GROUP_OVERFETCH, 200) : limit;

  // effective_posted = coalesce(posted_at, first_seen): undated feeds
  // (BambooHR) participate in freshness filters and recency sort. If the
  // function deploys before its migration, the column is missing — fall
  // back to posted_at for that window instead of 500ing the board.
  //
  // Freshness guarantee (read side of the 30-day cap): the board NEVER serves a
  // posting past the window, independent of how far the bounded background sweep
  // has drained. This decouples what users see from refresh timing — during the
  // initial drain, or in the gap between a posting aging out and the next sweep,
  // the list and its headline count stay ≤ the cap. effective_posted is NOT NULL
  // (coalesces to first-seen), so undated postings are correctly included.
  const freshCutoffIso = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString();
  // The exact count over the filtered set rides the page query and DOMINATES
  // list latency on broad queries (measured: raw page 0.4s, with exact count
  // 1.6-2.2s warm / 5-9s cold at 186k rows). The unfiltered total is already
  // maintained by the refresh loop in meta (the same figure the homepage
  // shows), so the default view — the most common request — skips the count
  // entirely. Filtered queries keep exact counts: their sets are small and
  // the zero-state logic depends on them.
  const metaTotal = Number((meta?.v as Record<string, unknown> | undefined)?.total);
  // Case-fold the two enum-valued filters ONCE, before anything reads them.
  //
  // These were normalised at every site that BINDS the predicate (:4365, :4372,
  // :4422 via its own path, the ranked paths) but NOT at the `unfiltered` gate
  // below. So `category=Engineering` filtered the page correctly and then took
  // the unfiltered branch, which returns the cached board-wide total: a page of
  // 10 engineering jobs under a headline of 587,793 — 8.8x the true 66,842, and
  // reachable from the URL, because Jobs.tsx passes ?category= through raw.
  // workMode=Remote did the same. A second, independent instance lived in
  // cappedCount, which dropped the work-mode predicate entirely unless the
  // caller happened to send lowercase (design+Remote reported 3,940 instead of
  // 616 — exactly the count with the predicate missing).
  //
  // Normalising at the door instead of at each use is the only version of this
  // fix that cannot rot: a future filter site cannot bind a value the gate
  // never saw, because there is now one value.
  // Reject-by-reporting. A value we cannot honour must never pass silently:
  // country="USA" (3 letters, not ISO-3166-alpha-2) and experience="bogus" were
  // both dropped on the floor, and the board then answered the UNFILTERED
  // question — 3,939 results, the entire design category, presented as though
  // the filter had applied. The fence in this codebase is that a filter is
  // never silently ignored, so anything we drop is named back to the caller in
  // `ignoredFilters` and the UI can tell the user which constraint did nothing.
  // ONE normalisation, in filters.ts, feeding the gate, the row query, the count
  // and the per-page self-check. Three hand-maintained copies of this list used
  // to exist — the validation ifs, the `unfiltered` conjunction, and buildQuery —
  // and every filter bug shipped so far was two of them disagreeing:
  //   * `unfiltered` compared the RAW casing while buildQuery lower-cased, so
  //     category=Engineering published 587,793 over a filtered page.
  //   * the gate read `typeof experience === "string"` while buildQuery read
  //     String(experience).split(","), so experience=["bogus"] bound no
  //     predicate AND reported nothing — the unfiltered board dressed as a
  //     filtered one. Verified live before this change; see filters.ts.
  // A fourth site could not be kept in sync by discipline, so there is one.
  // EMPLOYER-NAME ROUTING, applied to the BODY before filters are derived, so
  // every downstream path sees one already-normalised request. Injecting it
  // into `applied` afterwards would mean the count probe, the facet query and
  // the list each had to remember to honour it — the four-path divergence that
  // has caused five defects in two days.
  //
  // "Did the caller already pick a company?" is answered from the DERIVED
  // filter, never from the raw request field. Reading a filter off the request is
  // what board-filter-contract forbids, and it forbids it because the two
  // derivations drift until the count answers a different question from the
  // page. So the request is normalised once to ask, rewritten if it routes, and
  // normalised again — one derivation feeds the board, and it is the last one.
  const preFilters = normalizeFilters(body, JOB_SOURCES.length);
  // Intent phrases run AFTER employer routing, so "AT&T work from home" keeps
  // both: the employer takes the name prefix, the phrase is lifted from what
  // remains. Both rewrites happen HERE and nowhere else, ahead of the single
  // filter derivation, so the count probe, the facet query and the list all see
  // the same normalised request.
  // EXCLUSIONS COME OUT BEFORE ANYTHING IS SEARCHED, next to the intent lift and
  // for the same reason: one rewrite of the request, ahead of the single filter
  // derivation, so the count probe, the facet query and the list all see the
  // same query text.
  const exclusion = splitExclusions(String(body.q ?? ""));
  const excludedTerms = exclusion.excluded;
  if (excludedTerms.length) body = { ...body, q: exclusion.positive };
  const intentLift = liftIntentFilters(body.q, body);
  if (intentLift) {
    body = { ...body, ...intentLift.patch, q: intentLift.residualQ };
  }
  const { applied, ignored: ignoredFilters, maxAgeClamped } = intentLift
    ? normalizeFilters(body, JOB_SOURCES.length)
    : preFilters;

  // SEARCH TELEMETRY. One id per list response, echoed back by the client on a
  // click, which is the only thing that makes position-aware relevance
  // measurable at all. Without it a click can say "someone clicked something"
  // and nothing more.
  const searchId = crypto.randomUUID();
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
  const logSearch = (
    route: "recency" | "ranked" | "fuzzy" | "semantic",
    results: number,
    total: number | null,
    rescued: "fuzzy" | "semantic" | null = null,
  ) => {
    waitUntil(Promise.resolve(
      client.from("job_board_search_events").insert({
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
      }).then(({ error }) => {
        if (error) console.warn("[JOB-BOARD] search-event insert failed:", error.message);
      }),
    ));
  };
  // ONE honesty block, attached to EVERY exit from the list action.
  //
  // It used to live only at the recency path's return, so the three earlier
  // exits — ranked search, the fuzzy rescue, and semantic — returned before it
  // and carried neither ignoredFilters nor filterIntegrity. Search is the
  // board's primary surface, so the guarantee "a filter is never silently
  // ignored" held on the path users take least and not on the one they take
  // most. Making it a helper called at each `return` is the same move as the
  // filter normalisation itself: the property cannot hold in three places and
  // lapse in a fourth if there is only one implementation of it.
  // WHERE THE TIME GOES ON THE HOTTEST PATH. Measured 2026-08-25 from outside:
  // a trivial action on this function answers in ~300ms and a plain REST round
  // trip is ~200-400ms, so there is no cold-start floor to blame — but
  // q=nurse costs 2.8-3.0s warm, and the twelve-query battery ran p50 3.8s /
  // p90 5.3s. Search is the product's core interaction and it is spending
  // roughly 2.4 seconds of its own somewhere.
  //
  // The search-events log already records which route answered and how many
  // rows it returned, but never how long it took, so no one could see WHICH
  // tier is expensive across real traffic. One clock read, carried into the
  // log and the response.
  // TWO CLOCKS, BECAUSE reqStart WAS DOING TWO JOBS.
  //
  // It fed both the REPORTING numbers (tookMs, the search-event log) and the
  // request BUDGET — budgetLeft(), which sizes six downstream deadlines: the
  // embed, the semantic ANN, the semantic re-filter, the simple_config tier, the
  // head ring and the fuzzy augment gate. Simply moving reqStart earlier, which
  // is what "start the clock at entry" sounds like, would silently shorten all
  // six by ~958ms — and the 7s at the simple_config tier is explicitly sized
  // against a measured 7.9s cold spike. Fixing an instrument must not move the
  // thing it measures.
  //
  // So: reporting counts the meta read, and the budget still starts where the
  // work does.
  const reqStart = entryAt ?? Date.now();
  const budgetStart = Date.now();
  // PER-PHASE, because the total pointed at the wrong thing. Measured
  // 2026-08-25: search_jobs — the ranked RPC that computes BOTH capped counts
  // — answers in 230-465ms when called directly, while this function reports
  // tookMs of 1,745-2,624ms for the same query. The database is not the
  // bottleneck; the missing 1.3-2.2s is spent around it, and one total cannot
  // say where. Recorded as point marks rather than by wrapping calls: these
  // awaits sit inside ternaries and destructurings where an extra paren is
  // how you break a hot path at 2am.
  const phase: Record<string, number> = {};
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

  // ONE BUDGET FOR THE REQUEST, because the rescue tiers run in SEQUENCE and
  // their deadlines therefore SUM.
  //
  // The ladder is: exact-word (7s) -> fuzzy RPC -> embed + semantic (5s, plus
  // 4s to re-filter when a filter is active) -> head-term ring (4s). Each
  // budget is defensible alone; in series they permit twenty seconds, and a
  // query that finds nothing pays ALL of them before being told nothing was
  // found. Measured live on 2026-08-25.6:
  //
  //   q=zzzqqq (0 results)  22.9s wall, 21.9s tookMs, 2.9s marked -> 19.0s in tiers
  //   q=krankenschwester    24.1s wall, 23.0s tookMs, 4.4s marked -> 18.6s
  //   q=enfermera           22.9-24.9s, and one run returned no response at all
  //   q=zzzqqq + remote      3.6s wall — the SAME query with a filter, which
  //                          changes which tiers are reachable
  //
  // A user who searches a Spanish or German job title, or makes a typo, waits
  // twenty-three seconds to be told there is nothing. That is the whole defect.
  //
  // 9_000 is chosen to sit ABOVE the exact-word tier's measured 7s need, so
  // that tier — the first to run, and the one pinned by its own determinism
  // test — keeps its full deadline in the normal case and the clamp only bites
  // on tiers that come AFTER seven seconds have already been spent. A smaller
  // whole-request budget would starve the semantic rescue on exactly the empty
  // pages it exists to serve.
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
    return {
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(v.length
        ? { filterIntegrity: { violations: v.length, rows: jobs.length, fields: [...new Set(v.map((x) => x.field))] } }
        : {}),
      // Every list exit spreads this helper, so one line gives all seven of
      // them a server-side timing that can be read from outside without DB
      // access.
      tookMs: Date.now() - reqStart,
      phaseMs: { ...phase, attachRecheckedAt: attachMsAccum },
      ...(Object.keys(phaseOutcome).length ? { phaseOutcome: { ...phaseOutcome } } : {}),
    };
  };
  const unfiltered = isUnfiltered(applied);
  // THE UNFILTERED VIEW NEVER COUNTS — even when the cached total is missing.
  //
  // The old gate skipped the count only WHEN the cached facets total was
  // readable. So the moment that cache became unreadable (facets RPC 503ing
  // with PGRST002 during the 2026-08-18 00:20Z incident), every unfiltered
  // page view ESCALATED to an exact count over 584k rows — the single most
  // expensive query in this codebase, issued by the most common request, at
  // precisely the moment the database was least able to serve it. The
  // instance logged 88,674 rolled-back transactions, one per cancelled count.
  //
  // A missing headline number must degrade the HEADLINE ("many jobs"), never
  // the page. safeMetaTotal is null when the cache is unreadable, and the
  // response carries countUnavailable so the client renders its fallback
  // instead of a zero-state.
  const wantCount = !unfiltered;
  // THE HEADLINE COUNTED ROWS NOBODY CAN REACH.
  //
  // Three numbers for the same board, measured within one minute:
  //   headline `total` (meta.total)      615,914
  //   direct count on job_board_postings 608,453
  //   filter-aware facet sum             603,377
  // The headline exceeded the servable set by 12,537 (2.1%) — it carries rows
  // stamped missing_since and rows pruned since the last pass, neither of which
  // a visitor can page to. A total larger than the table it describes is not a
  // rounding difference, it is a number that cannot be true.
  //
  // The facet sum is already computed, already cached and already correct: it
  // is the same aggregate the category rail is drawn from, so publishing it
  // makes the headline equal what a searcher can actually reach AND agree with
  // the counts beside it. Falls back to meta.total when the facet is missing,
  // because a stale headline still beats none.
  // Published figure = the SERVABLE count, taken as an exact count of rows with
  // no missing_since stamp during the refresh pass (it is the same count the
  // coverage fractions are computed against, so it is free).
  //
  // I first reached for the cached category-facet sum, which the audit measured
  // at 603,377 against a headline of 615,914. I could not verify what that sum
  // currently holds — job_board_meta is not anon-readable, correctly — and the
  // on-demand facet came back 14k BELOW the open-row count, which would have
  // traded an overcount for an undercount. An unverifiable swap between two
  // wrong numbers is not an improvement. The open-row count can be checked from
  // outside against the table itself, which is why it is the one used.
  const openTotal = (() => {
    const cov = (meta?.v as Record<string, unknown> | undefined)?.coverage as { open?: unknown } | undefined;
    const n = Number(cov?.open);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const safeMetaTotal = openTotal ?? (Number.isFinite(metaTotal) && metaTotal > 0 ? metaTotal : null);
  // THE SECOND TRUE NUMBER: the corpus INCLUDING postings that have closed.
  //
  // safeMetaTotal above is what a visitor can page to and stays the headline —
  // publishing this one in its place would overstate searchable jobs by the
  // ~91k withdrawn postings the table still holds, and "no ghost jobs" is the
  // claim the whole page rests on. Published BESIDE it, labelled, it is the
  // thing this product actually owns: a live feed cannot tell you what closed
  // last week, and this corpus can.
  //
  // Null rather than a fallback when absent. A tracked figure that silently
  // degrades to the servable count would quietly assert the two are equal,
  // which is the exact shape of claim drift this file keeps being bitten by.
  const trackedTotal = (() => {
    const cov = (meta?.v as Record<string, unknown> | undefined)?.coverage as { tracked?: unknown } | undefined;
    const n = Number(cov?.tracked);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // AN OFFSET PAST THE END MUST BE AN EMPTY PAGE, NOT A TABLE SCAN.
  //
  // Measured 2026-08-18, minutes after the outage recovery: offset=583921 and
  // offset=999999999 both returned 500 after ~9.1s. Postgres implements OFFSET
  // by walking and discarding every skipped row, so a caller paginating one
  // page past the end spent nine seconds of the same database the outage was
  // made of — and got an error for it. The board UI cannot reach this (60 per
  // page); it is purely API/scraper traffic, which is exactly the traffic that
  // retries on a 500.
  //
  // Two bounds, both cheap: the maintained catalog total is an upper bound for
  // EVERY query (a filtered set cannot outnumber the corpus), and a hard
  // ceiling catches the case where the cached total is unreadable. countOnly is
  // exempt — it ignores offset and must keep returning totals.
  const OFFSET_CEILING = 1_000_000;
  if (!countOnly && (offset >= OFFSET_CEILING || (safeMetaTotal !== null && offset >= safeMetaTotal))) {
    return json({
      jobs: [], total: safeMetaTotal, hasMore: false, nextOffset: offset,
      ...(safeMetaTotal === null ? { countUnavailable: true } : {}),
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
  // withCount is separable from wantCount so a page can be re-run WITHOUT the
  // count when the count is what failed. Measured 2026-07-25 on the 570k table:
  // the page itself returns in 0.2-0.4s, while the exact count over a broad
  // window takes 3.2s+ and trips the statement timeout. Because both rode the
  // same query, that timeout 500'd the whole request — "Posted this week"
  // (maxAgeDays=7) was hard-broken, along with maxAgeDays=5. The failure is a
  // planner crossover, not size: 1-3d and 10-30d both plan well, the middle
  // band (~150-190k rows) picks an index scan with random heap access and
  // crawls. Dropping the redundant effective_posted predicate was measured and
  // does NOT help, so the fix is to never let the count kill the page.
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
        "id,source,company_token,company,title,location,country,remote,work_mode,department,category,posted_at,apply_url,salary,salary_min_annual,salary_max_annual,salary_period,salary_currency,experience_band,min_years,last_seen,missing_since,effective_posted",
        withCount ? { count: "exact" } : {},
      )
      .gte(dateCol, freshCutoffIso)
      // A posting stamped missing_since failed to appear in a SUCCESSFUL fetch
      // of its own company's feed (two-pass confirmed). Nothing in the serving
      // path filtered it, so the postings the Ghost Job Index exists to name
      // were being served as live results. Measured precision: of 1,000
      // stamped ids, 117 confirmed deleted at the vendor within 21 minutes and
      // only 2 flickered back (98.3%) — and a row that returns has the stamp
      // cleared by the normal refresh, so this self-heals.
      // Cheap here: it filters rows already fetched via the effective_posted
      // index, and ~99% pass.
      .is("missing_since", null);
    const terms = queryTerms(body.q).terms.slice(0, 8);
    if (!opts?.skipTerms) for (const t of terms) q = q.or(`title.ilike.%${t}%,company.ilike.%${t}%,department.ilike.%${t}%`);
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
    // An explicit workMode WINS over the legacy `remote` boolean. These are not
    // independent predicates: remote=true is a strict SUBSET of
    // work_mode='remote' (normalize.ts:1069), so ANDing them equals the
    // stricter one and silently narrows the user's own choice. Measured:
    // {workMode:remote,country:GB} 1,518 vs 1,403 UI-shaped (7.6% lost),
    // design 614 -> 582 (5.2%), data_ai 848 -> 752 (11.3%).
    // The remote/workMode precedence now lives in normalizeFilters, so this is a
    // plain read. It used to be decided HERE and nowhere else, which meant the
    // count RPCs and the self-check each answered a different question:
    // {remote:true, workMode:"hybrid"} returned 60 hybrid rows under a total of
    // 36 (the count of hybrid AND remote), and the integrity sensor then flagged
    // all 60 as violating a filter the query had deliberately dropped.
    if (applied.remote) {
      q = q.eq("remote", true);
    }
    // Work-mode filter: definitive vendor/text-stated tags only. Postings that
    // don't state a mode have work_mode NULL and are excluded by the filter —
    // honestly, never guessed (the UI says so).
    // Case-normalized (audit: {workMode:"Remote"} silently served the full
    // unfiltered board to API callers — the fence says filters are never
    // silently ignored, so at minimum every casing of a real value binds).
    // Multi-select: applied.workMode is a comma-joined subset of the closed
    // domain, so .in() is the binding and a single value still yields one-element
    // behaviour identical to the .eq() this replaces.
    if (applied.workMode) q = q.in("work_mode", applied.workMode.split(","));
    // Country filter: exact match on the deterministically extracted code.
    // Postings whose location we couldn't place have country NULL and are
    // excluded by the filter — honestly, never guessed (the UI says so).
    // Split here too: the RPC splits, and a browse page that binds equality
    // against "DE,GB" serves zero rows under a headline that counted both.
    if (applied.country) {
      const cs = applied.country.split(",").filter(Boolean);
      q = cs.length > 1 ? q.in("country", cs) : q.eq("country", cs[0]);
    }
    // ONE DERIVED VALUE FOR ALL THREE CALL SITES.
    //
    // A category becomes a query in three places here — this direct filter and
    // two RPCs — and widening one of them is how a feature ends up working
    // while you browse and silently absent the moment you type a search term.
    // `categoryParam` is computed once, above, and every site uses it.
    // `categoryOverride` is how the two-subset pager asks for ONE category at a
    // time. It matters that this is an .eq(): the widened `.in()` below loses
    // the date index on a large bucket, which is what made ordering across both
    // subsets time out.
    // EQUALITY CANNOT EXPRESS A SELECTION. `applied.category` is comma-joined
    // (it always was, for the unsorted bucket), so an .eq() against it asks the
    // database for a posting whose single category is the literal string
    // "design,legal" — no rows, under a headline computed by the RPC, which
    // DOES split. Both sides must ask the same question.
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
    // Salary floor filters the annualized lower bound of the posting's OWN
    // stated pay, compared in APPROXIMATE USD via salary_rank_usd — the same
    // generated column salary sorting uses. The raw-number comparison this
    // replaced passed SEK/JPY rows whose figures merely LOOK large (SEK 1M ≈
    // $95k cleared a $100k floor) and failed EUR/GBP rows that genuinely
    // clear it. Postings without a stated salary, or whose currency we can't
    // identify (rank NULL), are excluded by the filter, honestly, not
    // guessed at. Displayed salaries stay exactly as the posting states them.
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
    // The CEILING, on the same approximate-USD column and therefore with the
    // same NULL exclusion the floor has. Symmetry is the point: a band whose two
    // ends compared different columns would return rows that clear the floor in
    // USD and the ceiling in SEK. normalizeFilters has already refused a ceiling
    // below the floor, so this can never bind an empty band.
    // THE CEILING MUST SHARE THE FLOOR'S WIDENING, or it silently cancels it.
    //
    // includeUnstatedPay widens an active floor by ORing `salary_rank_usd IS
    // NULL` back in. The ceiling shipped one commit later as a plain .lte(),
    // which PostgREST ANDs — and NULL fails `<=`, so every unpriced row the OR
    // arm had just re-admitted was thrown straight back out. Set a floor, a
    // ceiling and the toggle and you got exactly the floor-only result, with all
    // three controls lit.
    //
    // Measured live 2026-08-27, category=design at a $100k floor:
    //   floor only ....................... 405
    //   + includeUnstatedPay ............. 3,375   (the toggle works: +2,970)
    //   + a $300k ceiling as well ........ 404     (the toggle contributes ZERO)
    //
    // This is the pay-floor NULL discard — the bug includeUnstatedPay exists to
    // fix — re-armed by a second predicate. Two ANDed OR-arms give
    // (in band) OR (unpriced), which is what the three lit controls claim.
    if (applied.salaryCeiling !== null) {
      q = applied.includeUnstatedPay
        ? q.or(`salary_rank_usd.lte.${applied.salaryCeiling},salary_rank_usd.is.null`)
        : q.lte("salary_rank_usd", applied.salaryCeiling);
    }
    // "Only postings that state pay at all." salary_min_annual, NOT
    // salary_rank_usd: the rank column additionally requires a currency we can
    // identify, so binding it here would answer a narrower question than the
    // filter's name — 20.1% of the board states a figure, and fewer than that
    // state one we can convert. Anyone who sets salaryFloor is inside this
    // population already; this is the filter that lets them say so on purpose.
    if (applied.hasStatedPay) q = q.not("salary_min_annual", "is", null);
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
    // Saved searches ask "how many NEW since I last looked" — a cheap count.
    // COMPANY-STATED DATE, not our crawl time. dateCol is effective_posted =
    // coalesce(posted_at, first_seen), so binding postedAfter to it answered
    // "we FOUND this recently" while the visitor asked "the employer POSTED
    // this recently". maxAgeDays has always used posted_at, so the board had
    // two time filters answering the same question on opposite axes.
    //
    // MEASURED, same instant, same 24-hour question, category=design:
    //   postedAfter -> 467      maxAgeDays:1 -> 90
    // and 60 of 60 rows postedAfter returned had NO company-stated date at all.
    // This is the filter behind the saved-search "new since you last looked"
    // badge, so that badge was inflated roughly fivefold by postings whose age
    // nobody knows.
    //
    // The repo already carries this lesson from a previous incident —
    // first_seen is never a posting age — and it was reintroduced on a
    // different filter.
    //
    // Undated rows now fall OUT of a postedAfter window rather than counting as
    // brand new. That is the honest reading of "posted after X" and it is
    // disclosed, not silent.
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
    // A MULTI-COUNTRY REQUEST DOES NOT ASK THIS RPC, AND THAT IS A DEPLOY GUARD.
    //
    // The comma split for the country parameter lives in a migration that is
    // not applied yet. Against the SQL currently live, a joined value is an
    // equality against the literal string and returns ZERO — so a function
    // deployed ahead of its migration would serve a full page of real German
    // and British rows under a headline of 0, and write a false catalogue-gap
    // row into job_board_search_misses on the way. filterViolations cannot
    // catch it: every row genuinely is in a selected country.
    //
    // Returning null is not a degradation. The caller falls through to an exact
    // count through buildQuery, which splits the list in JS and is therefore
    // correct against BOTH versions of the SQL. It costs one count query on a
    // filter nothing can send yet. Single-country requests are untouched.
    if (applied.country && applied.country.includes(",")) return null;
    // AND NEITHER DOES A FILTER THIS RPC CANNOT SEE. Same shape, same reason.
    //
    // Six filters landed on 2026-08-25 — payBasis, hasStatedPay, salaryCeiling,
    // maxYears, department, vendors — and they bind in buildQuery, which this
    // RPC is not. count_jobs_capped has no parameter for any of them, so it
    // would count the UNFILTERED population and headline a number several times
    // the page. That is the 2026-07-25 p_work_mode defect exactly.
    //
    // Returning null is not a degradation: the caller falls through to an exact
    // count through buildQuery, which binds all six. It costs one count query on
    // requests that carry one.
    if (rpcBlindFilters(applied).length) return null;
    // Bound from `applied`, the same object buildQuery reads. These four used to
    // be re-derived here with their own expressions; when one of those drifted
    // from the query's, the count described a different question than the page.
    // Multi-term queries: the page ANDs each term (any of title/company/dept per
    // term) while the RPC treats p_q as ONE contiguous ILIKE. "senior nurse"
    // matches "Senior Registered Nurse" on the page but not in that count — the
    // summary could read "Showing 60 of 12". Only single terms match the page's
    // semantics; multi-term falls back (null) to the inline exact count, which
    // uses the identical buildQuery filter. Rare path: it is reached only when
    // the ranked search (which carries its own total) has already failed.
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
        p_cap: COUNT_CAP,
      });
      markFrom("count_jobs_capped_settle", t_count_jobs_capped_6);
      if (error || !Array.isArray(data) || !data.length) return null;
      const row = data[0] as { n?: number | string; capped?: boolean };
      const n = Number(row.n);
      return Number.isFinite(n) ? { n, capped: row.capped === true } : null;
    } catch {
      return null; // RPC missing — caller keeps the old exact-count behaviour
    }
  };

  // ---- FILTER-AWARE CATEGORY COUNTS -------------------------------------
  //
  // The dropdown already renders "Sales (62,871)" — and those numbers VANISH
  // the moment any filter is applied. Measured: unfiltered returns 18
  // populated categories; with country=US it returns 0.
  //
  // That was deliberate and it was right. The cached facet is board-wide, so
  // under country=US "Design (4,320)" would be a global number wearing a
  // filtered label. visibleCategories suppresses rather than lies.
  //
  // But counts matter MOST while narrowing — that is the whole job of a filter
  // UI, and a visitor who has picked United States currently cannot tell
  // whether Design holds 4,000 US roles or 4. So instead of removing the
  // guard, compute the honest number: the same filters, once per category.
  //
  // REUSES buildQuery WITH ITS EXISTING categoryOverride, which is why this is
  // ~15 lines and not a second implementation of the filter semantics. Every
  // predicate — country, work mode, experience, salary floor, freshness,
  // sendable, the serving window — binds exactly as it does for the list. A
  // hand-rolled facet query would drift from the list the first time a filter
  // changed, and the counts would quietly stop matching the results.
  //
  // COST, measured before building: a single filtered category count runs
  // 0.27-0.43s (US+engineering 24,713 rows in 0.30s). Affordable — but 18 at
  // once is precisely the request-amplification shape that took this board
  // down on 2026-08-17, so it is bounded three ways: its own ACTION (never
  // riding the list request), chunked concurrency, and a hard deadline after
  // which it returns what it has.
  //
  // PARTIAL RESULTS ARE HONEST HERE. A category that did not answer in time is
  // simply absent, and an absent count renders as no count at all — the state
  // the dropdown is already in today. It never renders a zero it did not
  // measure.
  // DERIVED ONCE, HERE, because the facet counts need it too and a second
  // derivation is what the filter contract forbids — two copies drift until the
  // sidebar answers a different question from the page.
  const qt = queryTerms(body.q);
  const qText = qt.terms.join(" ").slice(0, 200) || (qt.liftedSalary ? "" : String(body.q ?? "").trim().slice(0, 200));

  if (body.facetCounts === true) {
    // THE COUNTS BESIDE THE RESULTS HAVE TO BE THE SAME KIND OF NUMBER.
    //
    // Measured live, same request body:
    //   country=US   list total 10,000   facet sum 264,893
    //   q="IT"       list total (none)   facet sum 128,186
    //   q="welder"   list total 417      facet sum 465
    // Two independent defects were producing that.
    //
    // 1. SCALE. The list caps at COUNT_CAP and says so; the facets counted
    //    exactly and without a cap. A sidebar promising 264,893 next to a
    //    header saying 10,000 is not a rounding difference, and the visitor has
    //    no way to know which to believe.
    // 2. ENGINE. With a text query the list is served by the tsquery RPC while
    //    the facets used buildQuery's substring ILIKE — different matchers, and
    //    the audit measured them 7,343x apart on q="IT". The facets were
    //    answering a question the page never asked.
    //
    // With a query present the facets now go through the SAME count the list
    // uses. Measured at the existing chunk size: 6 concurrent count_jobs_capped
    // calls run 0.62-1.13s, so 18 categories in three chunks fits the budget.
    const FACET_CHUNK = 6;
    // THE BUDGET NEVER FIRED, SO IT NEVER BOUNDED ANYTHING.
    //
    // Measured 2026-08-25 with per-RPC timings: on a text query these
    // per-category counts are the single largest cost of the whole request —
    // count_jobs_capped totalled 2,238-2,489ms across the 18 categories for
    // q=camarero, against 156-291ms for search_jobs, the call that actually
    // produces the rows. Three chunks of six finish in ~2.4s, comfortably
    // inside a 6s budget, so the deadline was never reached and every text
    // search paid the full price to number the category rail.
    //
    // 1.5s buys roughly the first chunk. Categories past it keep their chip
    // and lose their number, which is a degradation this loop already
    // performs (it breaks between chunks) and which the rail already renders.
    // A number nobody waited two seconds for beats a complete set nobody
    // stayed to read.
    //
    // NOT lowering the facet cap instead: a guard requires facet and list to
    // share COUNT_CAP so the sidebar cannot contradict the page, and that
    // invariant is worth more than the milliseconds a smaller cap would save.
    const FACET_DEADLINE = Date.now() + (qText ? 1_500 : 4_000);
    const counts: Record<string, number> = {};
    let facetCapped = false;
    const cats = [...JOB_CATEGORIES];
    for (let i = 0; i < cats.length; i += FACET_CHUNK) {
      if (Date.now() > FACET_DEADLINE) break;
      const chunk = cats.slice(i, i + FACET_CHUNK);
      // BETWEEN chunks was never a bound, because the FIRST chunk always runs
      // in full. Measured 2026-08-25 after tightening the between-chunk
      // budget: q=camarero still spent 2,257-2,314ms here and still took
      // 5.7s, because six concurrent counts are issued before the deadline is
      // consulted again. The comment above this loop claims 0.62-1.13s per
      // chunk; that number is stale.
      //
      // So the chunk itself races the remaining budget. withDeadline does not
      // cancel the query — the established pattern in this file — so a slow
      // count finishes server-side while the reader gets their rows, and the
      // category simply arrives without a number, which the rail already
      // renders for every category past the budget.
      const chunkBudget = Math.max(250, FACET_DEADLINE - Date.now());
      const chunkWork = Promise.all(chunk.map(async (c) => {
        try {
          if (qText) {
            const t_count_jobs_capped_5 = Date.now();
            const { data, error } = await client.rpc("count_jobs_capped", {
              p_fresh_cutoff: freshCutoffIso,
              p_q: qText,
              ...(applied.location ? { p_location: rankedLocationParam(body.location) } : {}),
              ...(applied.remote ? { p_remote: true } : {}),
              ...(applied.country ? { p_country: applied.country } : {}),
              p_category: c,
              ...(applied.experience.length ? { p_experience: applied.experience } : {}),
              ...(applied.salaryFloor !== null ? { p_salary_floor: applied.salaryFloor } : {}),
              ...(applied.companies.length ? { p_companies: applied.companies } : {}),
              ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
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

  // ── ROUTED RETRIEVAL ──────────────────────────────────────────────────────
  //
  // ONE retriever per search, decided before any SQL is issued, and ONE exit for
  // all of them. This supersedes the tier shipped this morning, whose fatal
  // design was running only when the primary path returned ZERO rows — so
  // queries returning a full page of WRONG answers, the larger class, could
  // never reach it.
  //
  // Every route binds through buildQuery with skipTerms, so freshness,
  // missing_since, country, category, experience, salary and companies bind in
  // the ONE place they are bound and only the matcher differs. A route with its
  // own PostgREST chain is the mistake behind five defects in two days.
  //
  // MEASURED UNDER CONCURRENCY 4, the only measurement that counts here —
  // everything looks fine one request at a time, and that is exactly how a
  // sequential scan reached production this morning:
  //     company_token=in.(...)     0.67s x4, all 200
  //     wfts(simple) on title      0.36-0.59s x4, all 200
  // Rejected under the same conditions: ilike contains 1.9-2.7s, imatch regex
  // 3.1-3.5s — and the regex is 0.35s SERIALLY, which is the whole trap.
  //
  // Standing down when a filter is active is deliberate: the routed window is
  // capped, so a filter applied on top of a capped window would silently answer
  // from a subset. The ranked path below binds filters in SQL and is correct.
  // "No filters BESIDES the query." isUnfiltered() counts q itself as a filter —
  // it is asking "is this the bare board?" — so gating on it meant the router
  // stood down on EVERY search, which is every case it exists for. Verified
  // live: AT&T and IT both came back with no searchRoute at all.
  const onlyQuery = applied.country === null && applied.category === null
    && applied.workMode === null && applied.salaryFloor === null
    && applied.maxAgeDays === null && applied.postedAfter === null
    && !applied.remote && !applied.sendableOnly
    && applied.experience.length === 0 && applied.companies.length === 0
    && applied.location === "";
  const routeDecision = qText && onlyQuery
    ? pickRoute(qText, EMPLOYER_ALIASES)
    : { route: "BROWSE" as const, reason: "not routable", tokens: undefined as string[] | undefined, matchedName: undefined as string | undefined };
  const routedRetriever = RETRIEVER_FOR[routeDecision.route];
  // ONE window constant for both the routed count and the routed list. Two
  // copies would drift, and the count would then say countUnavailable at a
  // different size than the list slices.
  const ROUTE_WINDOW = 400;

  if (countOnly) {
    // countOnly is the FIFTH exit, and I missed it when wiring the honesty
    // helper into the other four. Verified live on .10: {remote:"true"} returned
    // ignoredFilters correctly on the list path and NOTHING on this one, so the
    // caller most likely to be a machine — countOnly exists for the relaxation
    // buttons and the data API — was the caller least likely to be told a filter
    // had been dropped. It publishes only a number, which makes naming the
    // filters that number does not honour more important here, not less.
    // The clamp is a narrowing, and this is the exit where it hurts most: a
    // countOnly response is a NUMBER and nothing else, so {country:IE,
    // maxAgeDays:90} publishing 2,178 is read as "90 days of Ireland" when it
    // is 30 days of it. The list exits already say so through
    // searchDisclosures; this one ships no rows and does not call that helper,
    // so the single field it owes the caller is spread here rather than adding
    // an eighth searchDisclosures(body, applied, maxAgeClamped) call site —
    // three tests assert that count is exactly 7.
    const countHonesty = {
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(maxAgeClamped ? { maxAgeClampedTo: 30 } : {}),
    };
    if (!wantCount) return json({ total: safeMetaTotal, ...(safeMetaTotal === null ? { countUnavailable: true } : {}), ...countHonesty }); // unfiltered — the maintained catalog total, degraded to null when the cache is unreadable
    // ONE BODY, ONE ANSWER — the count asks the SAME retriever the list used.
    //
    // MEASURED before this: the router carried `!countOnly`, so a routed query
    // was counted by search_jobs instead of by the retriever that produced the
    // page. {"q":"sql developer"} listed 30 rows under searchRoute SIMPLE and
    // counted 3,000 through the description tier; {"q":"Domino's"} listed
    // countUnavailable and counted 2,206. Two shapes, one defect.
    //
    // This is the routed list block's query, verbatim, through the same
    // buildQuery binder and the same hoisted ROUTE_WINDOW — so the number IS the
    // window the list slices and is reachable by paging. At the cap the window is
    // a floor, not a total, and says so exactly as the list does.
    //
    // sort=salary stands down. A salary-sorted text search is served by
    // salaryTextSort (buildQuery + salary_rank_usd, .not("salary_rank_usd","is",
    // null)), NOT by the routed window — counting it here would publish 31 for a
    // page that shows 1, which is this very defect with the signs reversed.
    //
    // MEASURED AT CONCURRENCY 4 on production: wfts(simple) over a 400-row window
    // 0.34-0.46s, company_token IN 0.62-0.78s, 4/4 HTTP 200 — the same query and
    // budget the routed LIST path already pays on every search.
    if (qText && body.sort !== "salary" && (routedRetriever === "company" || routedRetriever === "simple")) {
      try {
        let rqC = buildQuery("effective_posted", false, undefined, { skipTerms: true });
        rqC = routedRetriever === "company" && routeDecision.tokens?.length
          ? rqC.in("company_token", routeDecision.tokens)
          : rqC.textSearch("title", ftsQuery(qText), { type: "websearch", config: "simple" });
        const t_related_count = Date.now();
        const { data: rcRows, error: rcErr } = await withDeadline(
          rqC.order("effective_posted", { ascending: false }).order("id", { ascending: true })
            .range(0, ROUTE_WINDOW - 1),
          7_000,
        ) as { data: unknown[] | null; error?: unknown };
        markFrom("related_count", t_related_count);
        if (rcRows === null) console.warn(`[JOB-BOARD] routed count (${routeDecision.route}) hit its deadline for q=${JSON.stringify(qText)}`);
        // Empty window falls through, because the LIST falls through on an empty
        // window too — matching its behaviour is the whole point of this block.
        if (!rcErr && Array.isArray(rcRows) && rcRows.length > 0) {
          const rcCapped = rcRows.length >= ROUTE_WINDOW;
          return json({ total: rcCapped ? null : rcRows.length, ...(rcCapped ? { countUnavailable: true } : {}), ...countHonesty });
        }
      } catch { /* fall through to the search_jobs count below — the same path the list falls through to */ }
    }
    // With a query present, count what the LIST path would actually serve —
    // the FTS ranked tiers — not the ILIKE approximation. Measured
    // 2026-07-25: the two disagreed up to 4.3x on the same body, so
    // relaxation buttons advertised counts that clicking couldn't reproduce
    // and the disclosure denominator went negative.
    // Same strip as the main ranked path — the count probe must ask the same
    // question the page asks, or the total disagrees with the results.
    // The `|| raw` fallback must NOT fire when the query was only a pay figure —
    // it would put "120000" straight back as search text and undo the lift.
    const qtC = queryTerms(body.q);
    const qTextC = qtC.terms.join(" ").slice(0, 200) || (qtC.liftedSalary ? "" : String(body.q ?? "").trim().slice(0, 200));
    // Kept in step with the row query's guard above, which no longer excludes
    // "newest". If only one of the two had been changed, the count and the rows
    // would answer DIFFERENT questions for a newest-sorted search — the count
    // from a substring ILIKE and the rows from the FTS engine. That divergence
    // is the shape of the incident where 60 rows rendered under a total of 36.
    // The salary sort no longer drops the search engine. Kept in step with the
    // row query below — if only one of these changes, the count and the rows
    // answer different questions, which is the 60-rows-under-a-total-of-36
    // incident.
    // rpcBlindFilters: search_jobs takes no parameter for the six filters added
    // 2026-08-25, so a request carrying one must take the buildQuery path or the
    // filter is silently dropped from the rows we serve.
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
          p_limit: 1,
          p_offset: 0,
        });
        markFrom("search_jobs", t_search_jobs_4);
        if (!ec && Array.isArray(rc)) {
          // `|| rc.length`, which this used to be, treats a legitimate ZERO
          // total as absent and substitutes the row count. It cannot fire today
          // — total_rows counts the same predicate that produced the rows, so a
          // zero total means zero rows — but it is a loaded gun aimed at the
          // next change to search_jobs. Any edit that makes total_rows a
          // NARROWER count than the rows (counting title matches while serving
          // title-or-description, the shape every proposed tier fix has) turns
          // a filtered query with no title match into "the window size", and
          // adding a filter would multiply the reported count by 8.5. Guard on
          // finiteness, which is what the fallback was actually for: an absent
          // or non-numeric total_rows gives NaN, not 0.
          const trC = Number((rc[0] as { total_rows?: number } | undefined)?.total_rows);
          const tC = rc.length ? (Number.isFinite(trC) ? trC : rc.length) : 0;
          // Tier-aware ceiling, same contract as the list path: the description
          // tier caps at 3,000, so a bare "3000" here was presented as an exact
          // figure when the truth is higher (bug sweep 2026-07-26).
          // THE TIER IS A TYPE, NOT A CONTENT LENGTH.
          //
          // search_jobs sets snippet to NULL::text on the title tier and to a
          // ts_headline STRING on the description tier, so `typeof === "string"`
          // separates them exactly. The `.length > 0` this used to carry turned
          // the type test into a content test, and ts_headline over
          // left(coalesce(description,''),4000) returns the EMPTY STRING for a
          // posting with no description. This probe passes p_limit:1, so ONE
          // row with an empty description sniffed a description-tier count as
          // title tier, raised the ceiling from 3,000 to 10,000, and published
          // the 3,000 cap as an exact figure. Proven at the RPC: loan officer,
          // sql developer and php developer all return snippet as a
          // zero-length string at p_limit 1.
          // TWO SEGMENTS HERE TOO. The probe sends a page size of 1 and that is
          // fine: both figures are computed independently of the page and ride
          // on the first row. Leaving this single-segment would make "Remove
          // country — N openings" promise a number the resulting page does not
          // show, which is the 4.3x disagreement this file has had once already.
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

  // Stable pagination: recency desc (nulls last) by default, or highest
  // STATED salary first. Salary ordering uses salary_rank_usd — an
  // approximate-FX rank column that exists only so ₹2M/yr doesn't outrank
  // $300k by raw digits; displayed salaries stay the posting's own text.
  // Unranked postings (no identifiable currency) sort after ranked ones —
  // never excluded, never estimated. id tiebreaker so equal keys can't
  // shuffle between "load more" pages.
  // Relevance-ranked search: with a query present (and not salary-sorted),
  // the search_jobs RPC orders by ts_rank (title > company > department),
  // recency as tiebreak — composed with every active filter. Any error
  // (migration lag, malformed query) falls back to the recency path below.
// FILLER-STRIPPED, because the ranked path is where the damage actually was.
// queryTerms() was wired into the two ILIKE term-builders, and MEASURED after
// deploy that fixed nothing a searcher would notice: "electrician jobs near
// me" still returned 44 rows topped by "Maintenance II-ARP", because a query
// goes through the RANKED path and this is the string it tsquery-ises. The
// browse path I had fixed is the one nobody types filler into.
// Falls back to the raw text when filler was all there was, same rule as
// queryTerms itself.
  // Kept deliberately identical to qTextC above, including the liftedSalary
  // guard. If only one of the two changes, the count and the rows answer
  // DIFFERENT questions — that divergence is the shape of the incident where
  // 60 rows rendered under a total of 36.
  // (qText is derived above the facet block — see the note there.)
  // "NEWEST" USED TO DROP THE ENTIRE SEARCH ENGINE.
  //
  // The guard excluded sort==="newest", so choosing Newest from the sort
  // dropdown routed a query to the recency path's substring ILIKE at :6051:
  //   title.ilike.%rn%  ->  matches inteRNship, PRN, oveRNight
  // and, because "registered nurse" contains no "rn" substring, the spelled-out
  // title became UNREACHABLE — alias expansion never ran on that path either.
  // Measured live: q="RN" relevance-sorted returned 10/10 nursing roles; the
  // same query newest-sorted returned substring artifacts and carried neither
  // `ranked` nor `aliases`.
  //
  // It was also the slow path, not just the wrong one. `%term%` cannot use an
  // index, so on 594k rows a rare term seq-scans: q="k8s" + newest returned
  // HTTP 500 after 25.47s. Routing through search_jobs moves the work onto the
  // GIN index, so this change makes the query FASTER as well as correct.
  //
  // Newest still means newest — the ranked path selects WHICH rows match, and
  // the page is then ordered by date below (see `newestFirst`). That is
  // "newest among the postings that actually match", which is what the control
  // promises; the alternative was "oldest artifacts of a substring collision".
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
  // SORTING BY SALARY USED TO DROP THE SEARCH ENGINE ENTIRELY.
  //
  // This guard excluded sort==="salary", so a salary-sorted search never
  // reached search_jobs and fell through to the browse path's OR-of-ILIKE.
  // MEASURED: q="nurse" sorted by salary returned "Unqualified Nursery
  // Practitioner" at position one — matched on the substring "Nurser" — with no
  // `ranked` key and no alias expansion. q="swe" returned 10,000 ranked
  // Software Engineer roles under relevance and 1,101 substring artifacts under
  // salary, topped by "Roswell Full-Time General CRNA" (Ro-SWE-ll) and
  // "SWEPCO". A sort control was changing WHICH JOBS MATCH, by up to 5x.
  //
  // This is the identical defect that was found and fixed for sort==="newest"
  // — the fix landed on one of the two sort values and the other was missed.
  // The remedy is the same one newest already uses: let the RPC pick the rows
  // by relevance, then order the page the reader is looking at.
  // The routing gate, the chosen route and its retriever are decided ABOVE the
  // countOnly exit now — see the note there. They used to be decided HERE,
  // behind a `!countOnly` term, which is why a count and a list ran different
  // retrievers for one body: {"q":"sql developer"} listed 31 rows through the
  // routed window and counted 3,000 through search_jobs' description tier.
  // PAST THE RE-RANKED WINDOW, PAGE IN SQL.
  //
  // The scored path anchored search_jobs at p_offset 0 and applied the caller's
  // offset in JS, so the reachable set ENDED at the in-memory pool. Measured
  // live 2026-08-22: q="loan officer", limit 100, groupSimilar false — offset
  // 100 returns 100 rows with hasMore:false, offset 200 returns 0, against a
  // published total of 201. limit=60 with grouping walked 118 cards and stopped.
  //
  // TWO REGIMES, ONE SEAM AT RANKED_WINDOW. Below the seam the page is served
  // exactly as before — window, head-term ring, scorer, slice — and is CLAMPED
  // to end at the seam. At or above it, search_jobs pages itself with p_offset
  // in ts_rank_cd order and nothing is re-ranked, so `offset` means SQL rank and
  // the regimes meet at rank 200 with no overlap and no hole. The seam CANNOT be
  // the pool length: the pool is 200 plus whatever novel rows the head-term ring
  // found (measured 200 / 293 / 399 for different queries) and it moves with
  // whether the ring made its 4s deadline. RANKED_WINDOW is a constant known
  // before any SQL is issued, which is also what lets ONE query serve a deep page.
  //
  // NOT FOR sort=newest — its rows are date-permuted, so a relevance-ordered
  // continuation would not be "newer than page three".
  // NOT FOR THE EMPLOYER/SIMPLE ROUTES — they retrieve a different set in a
  // different order through their own 400-row window.
  // NOT FOR SYMBOL. RETRIEVER_FOR.SYMBOL is "ranked" (search-routing.ts:78) and
  // search-routing.ts:125-146 says outright that a symbol query has no retriever
  // of its own — it is separated ONLY by the scorer's literal-substring rule,
  // which is off past the seam. Measured: q="c++" and q="c#" produce the
  // identical tsquery ('c') and the identical total (1682); at p_offset 200 the
  // raw ts_rank_cd order returns "Analista de P&C Cluster", "Lead P&C
  // Operations", "C&I Sales Executive II" — 2 of 10 rows contain the literal.
  // The 200-row wall is currently the only thing hiding that; opening it without
  // this exclusion reintroduces the defect the SYMBOL route exists to prevent.
  const deepPageable = scoreRanked
    && routedRetriever !== "company" && routedRetriever !== "simple"
    && routeDecision.route !== "SYMBOL";
  // The seam arithmetic lives in paging.ts so a test can walk every offset
  // across it and prove no rank is served twice or skipped. It used to be
  // inline, which is why the 200-row wall was never caught.
  const pagePlan = planRankedPage({ offset, fetchLimit, scoreRanked, newestFirst, deepPageable });
  const deepPage = pagePlan.deepPage;
  const metaV = (meta?.v ?? {}) as Record<string, unknown>;

  // A SALARY-SORTED SEARCH CAN HAVE BOTH CORRECT MATCHING AND A GLOBAL ORDER.
  //
  // Until now it had neither. The ranked path is bypassed for sort=salary, so
  // the query fell to substring ILIKE and q="nurse" returned "Unqualified
  // Nursery Practitioner" at #1. I tried routing it through search_jobs and
  // REVERTED that the same day: only 16 of the 180 relevance rows carry a
  // stated salary, so 44 of 60 cards on a "highest paid" page had no pay at
  // all, page 1 topped out at $214,800 where the browse path starts at
  // $650,000, and page 2 led higher than page 1. The note left behind said the
  // real fix was a sort parameter on the RPC.
  //
  // There is a third option that note did not consider: order in SQL on a
  // DIFFERENT query. buildQuery can match with the simple-config index and sort
  // on salary_rank_usd, which is indexed — so the database orders the whole
  // match set, not a window, and the matcher has word boundaries. MEASURED at
  // concurrency 4: nurse 0.34-0.46s, engineer 0.25-0.42s, all 200. The page it
  // produces for q="nurse" is $300,000 Nurse Practitioner, $290,000 CRNA,
  // $270,000 CRNA — against "Unqualified Nursery Practitioner" today.
  //
  // Rows with no stated pay are EXCLUDED rather than sorted last. On a
  // highest-paid-first page they are not an answer to the question, they are
  // 87% of the board — and the browse path's partial index already takes the
  // same view.
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
      logSearch("ranked", salGrouped.jobs.length, null);
      return json({
        jobs: preferMatchedLocation(await attachRecheckedAt(client, salGrouped.jobs, excludedTerms), locationTerms(body.location).terms),
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
        totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
        companies: [],
        companiesCount: ((metaV.companiesCount as number | undefined) ?? ((metaV.companiesFacet as unknown[]) ?? []).length),
        // THE SHAPE IS PART OF THE CONTRACT, NOT JUST THE VALUES.
        //
        // This exit shipped without these two and CRASHED THE WHOLE JOBS PAGE:
        // Jobs.tsx read `data.failedSources.length` with no guard — correctly,
        // as far as TypeScript could see, because the client type declared the
        // field non-optional and every other exit sends it. Measured on
        // production 2026-08-22: resumebooster.work/jobs?q=nurse&sort=salary
        // rendered "Something went wrong" and nothing else. Every pay-sorted
        // keyword search was a dead page, on the exact surface the last release
        // note advertised as fixed.
        //
        // An exit that omits a field the contract promises is a breaking change
        // that no type checker on either side can see: the server is untyped
        // against the client, and the client's own type says the field is always
        // there. Emit the full shape.
        categories: {},
        failedSources: [], failedCount: 0,
        refreshedAt: (metaV.refreshedAt as string) ?? null,
      });
    }
  } catch { /* fall through to the substring path this query used before */ }

  if (!countOnly && (routedRetriever === "company" || routedRetriever === "simple")) try {
    // Window anchored at rank 0 and sliced AFTER scoring, so `offset` is a
    // position inside ONE stable ordering. Paging a re-ranked list by a
    // retriever-ordered offset is what made sorted page two repeat page one.
    // ROLE ALIASES REACH THE SIMPLE ROUTE, WHICH IS WHERE THEY LIVE.
    //
    // expandQuery ran ~60 lines below this block, on the RANKED path only, and
    // this block returns before it. But pickRoute sends a query to SIMPLE
    // precisely when a token is <= 3 characters — and 37 of the 57 ROLE_ALIASES
    // keys are <= 3 characters: swe, sde, sre, qa, ml, ai, ux, ui, pm, rn, lpn,
    // cna, np, pa, emt, dba, ba, ae, hr, k8s, js and the rest. The abbreviations
    // the alias table exists FOR were the exact set it could never serve.
    // Measured live 2026-08-22: q="swe" returned 8 literal "SWE" titles and no
    // aliases key, while ~70,000 "Software Engineer" postings sat unreachable.
    //
    // Never for the EMPLOYER route: those tokens are company names, and
    // expanding "pa" to "physician assistant" inside a company match is wrong.
    // ftsSafe keeps " OR " intact (it strips only (),."'\:), so the expanded
    // websearch string passes through unchanged.
    // THE WINDOW FOLLOWS THE PAGE. It used to be anchored at rank 0 always, so
    // everything past row 400 was unreachable — on exactly the query shapes this
    // route exists for. Measured live 2026-08-27, paging q="cdl": offset 380
    // still returns rows and says hasMore, offset 400 returns ZERO jobs and
    // suddenly reports total 2,646. So 2,246 of 2,646 CDL postings (84.9%) were
    // unreachable, 4,842 of 5,242 sales-rep (92.4%), and >9,600 SWE — and the
    // searcher was told "no more results" while the count that proved otherwise
    // appeared only on the empty page.
    //
    // Blocks are disjoint because the retriever's order key is TOTAL and stable
    // (effective_posted DESC, id ASC), so a block boundary cannot drop or repeat
    // a row. Re-ranking still happens within a block, which means relevance
    // restarts at each boundary — a real trade, and the honest one against
    // "there is nothing here".
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
    const { data: routedRows, error: rErr } = await withDeadline(
      rq.order("effective_posted", { ascending: false }).order("id", { ascending: true })
        .range(blockStart, blockStart + ROUTE_WINDOW - 1),
      7_000,
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
        logSearch("ranked", routedGrouped.jobs.length, knownTotal);
        return json({
          jobs: preferMatchedLocation(await attachRecheckedAt(client, routedGrouped.jobs, excludedTerms), locationTerms(body.location).terms),
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
          ...(blockFull ? { countUnavailable: true } : {}),
          hasMore: blockFull || inBlock + limit < ordered.length,
          // Clamped to the window, so a caller cannot step past it. Unclamped,
          // paging one page beyond the 400-row window re-entered this block at
          // an offset the slice cannot serve — and the abbreviation queries
          // this route exists for (emt, ux, dba) are exactly the ones that walk
          // several pages.
          nextOffset: blockFull ? offset + limit : Math.min(offset + limit, blockStart + ordered.length),
          searchRoute: routeDecision.route,
          searchRouteReason: routeDecision.reason,
          // THE PAGE WAS APOLOGISING FOR WORK IT HAD DONE.
          // `ordered` above is rerankWindow(mapped, qText) for every non-company
          // route — these rows ARE relevance-sorted. Omitting `ranked` made the
          // client fall to "Sorted by newest first (relevance ranking briefly
          // unavailable)" on every short query: rn, swe, qa, pm, sde. A false
          // apology is still a false statement about what the board did.
          ...(routedRetriever === "company" ? {} : { ranked: true }),
          // Say which alias phrases were also searched, exactly as the ranked
          // path does. Emitted only when an expansion actually bound, so the
          // line can never claim a phrase the query did not look for.
          ...(routedExpand.expansions.length ? { aliases: routedExpand.expansions } : {}),
          ...(routeDecision.matchedName ? { companyMatched: routeDecision.matchedName } : {}),
          totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
          companies: [],
          companiesCount: ((metaV.companiesCount as number | undefined) ?? ((metaV.companiesFacet as unknown[]) ?? []).length),
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
  // The same idea for the rescue tier below, and declared up here for the same
  // reason — a declaration sited below its use is how this file took a TDZ
  // outage that hid the ranked path being down for an unknown period.
  //
  // NAMES INFRASTRUCTURE FAILURES ONLY. "The tier looked and found nothing" is
  // an honest answer and leaves this null; a non-null value always means the
  // retrieval did not happen, so the page cannot claim it searched everything.
  //
  // This is not hypothetical: search_jobs_semantic is answering 57014
  // "canceling statement due to statement timeout" on real query embeddings
  // right now, and the tier returns [] for it — indistinguishable from a
  // genuine no-match, on every affected search, with nothing anywhere saying so.
  let semanticDegraded: "embed" | "ann_deadline" | "ann_error" | "refilter_deadline" | null = null;
  // DECLARED HERE, ABOVE THE RANKED PATH, AND THAT POSITION IS THE FIX.
  //
  // RANKED SEARCH WAS DOWN IN PRODUCTION AND NOTHING SAID SO. Every typed
  // search silently fell through to the recency/ILIKE path; measured live on
  // .19, no response on any query carried `ranked: true`.
  //
  // `facetHead` is a function DECLARATION, so it hoists and the ranked return
  // below could name it — tsc and the deno gate both accept the call, which is
  // why this shipped. But it closes over `FACET_COMPANY_LIMIT`, a `const` that
  // used to be declared ~300 lines BELOW the ranked return, next to the recency
  // path that also calls it. A hoisted function can be CALLED before a `const`
  // it closes over is initialised; dereferencing that const then throws
  // ReferenceError from the temporal dead zone. The enclosing
  // `catch { /* fall through to recency path */ }` swallowed it, so the failure
  // presented as "ranked search returns nothing" rather than as an error.
  //
  // The symptom that made it visible: a query whose TITLE tier matches nothing
  // but whose description tier matches plenty served an EMPTY page —
  // q="forklift certified" had 741 description matches in the RPC and returned
  // 0 rows on the board. Queries with zero ranked rows were unaffected, because
  // the rescue ladder returns before ever reaching this call, which is why
  // typo rescue ("nurrse") kept working and hid the outage.
  //
  // Keep this above the first `facetHead(` call. A guard test pins the order.
  // A HEAD, NOT A CENSUS. This was 1,500 entries and 70% of the response
  // body. The typeahead reaches the rest through action:company-suggest,
  // which reads the same cached facet, so nothing became unsearchable — and
  // the selected employer is appended below whatever its rank, or its own
  // filter chip would lose its label.
  const FACET_COMPANY_LIMIT = 150;
  // The selected employer must survive the cut whatever its rank, or its own
  // filter chip renders with no label and the reader cannot see what they
  // filtered to.
  function facetHead(list: Array<{ token?: string; name?: string; count?: number }>) {
    const merged = mergeCompanyFacet([...list].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)));
    const head = merged.slice(0, FACET_COMPANY_LIMIT);
    if (applied.companies.length) {
      const have = new Set(head.map((c) => c.token));
      for (const c of merged) {
        if (applied.companies.includes(String(c.token)) && !have.has(c.token)) head.push(c);
      }
    }
    return head;
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

      // THE HEAD-TERM RING STARTS HERE AND IS AWAITED ~700 LINES BELOW.
      //
      // It is an independent query — a title prefix scan that ADDS candidates
      // to the ranked window — and it was issued only after search_jobs had
      // already returned, so the two ran back to back for no reason. Measured
      // at roughly 473ms of the pair, about 18% of felt latency on the hottest
      // path in the function.
      //
      // NOT Promise.all, and that is the whole point. Racing them together
      // would let a ring rejection take down the ranked call with it, and the
      // request would demote to the recency path — trading 473ms for a strictly
      // worse page. The promise is started, its failure is neutralised AT
      // CREATION, and it is awaited on its own. An unawaited promise that
      // rejects before anyone looks at it is an unhandled rejection in this
      // runtime, so the catch cannot wait until the await site.
      //
      // Gated exactly as the await site is gated, so nothing new fires. The one
      // cost: on a query whose ranked window comes back empty the code takes a
      // rescue path and never awaits this, so the round trip is spent for
      // nothing. It is bounded — the ring only ever runs for SHORT queries,
      // which are the ones least likely to come back empty.
      const headRingP: Promise<{ data: unknown[] | null }> | null =
        (scoreRanked && headTermRing && !deepPage)
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
        // Measured 2026-07-25: without this the ranked path silently dropped
        // the work-mode filter — workMode=remote + q=engineer returned 30 rows
        // that ALL had work_mode NULL, the exact opposite of the request.
        //
        // Sent ONLY when a work mode is actually selected. That matters while
        // the migration adding p_work_mode may not have applied yet: omitting
        // the argument keeps every ordinary search working against the OLD
        // function signature, and the one case that would error (a work-mode
        // filter against an old signature) falls through to the recency path
        // below, which filters work mode correctly. The filter is honoured on
        // every route; it is never quietly ignored again.
        ...(applied.workMode ? { p_work_mode: applied.workMode } : {}),
        // A SORTED MODE READS A FIXED WINDOW, NOT A MOVING ONE.
        //
        // The in-memory sort permutes these rows, so a p_offset that advances in
        // RELEVANCE order no longer describes where the reader is. Measured on
        // production: q="nurse" sort=newest limit=20 returned nextOffset 25 and
        // page 2 REPEATED 17 OF 20 ROWS, while other rows became unreachable.
        //
        // Anchoring the window at rank 0 makes `offset` a position INSIDE the
        // sorted window, which is stable across calls because the window is
        // always the same rows in the same order. RANKED_WINDOW is 200 because
        // search_jobs caps there internally — measured, p_limit 400 and 600 both
        // return exactly 200 — so paging a sorted search ends honestly at the
        // window edge instead of continuing with duplicates.
        // A SCORED page needs the same fixed window a SORTED one does: the
        // scorer permutes the rows, so an offset that advances in relevance
        // order stops describing where the reader is. Anchoring at rank 0 makes
        // `offset` a position inside one stable ordering.
        // A deep page is an ordinary offset page: search_jobs already orders by
        // ts_rank_cd with a total tiebreak (effective_posted DESC, id ASC), so
        // p_offset walks one stable sequence. Verified live: p_offset=200 twice
        // returned an identical id list in an identical order for all four
        // probe queries.
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
        // search_jobs counts inside a LIMIT — 10,000 on the title tier, 3,000 on
        // the sampled description tier — so a broad term like "engineer" or
        // "nurse" comes back as EXACTLY the ceiling. Reported bare that reads as
        // an exact figure ("10000 matching openings") when the truth is higher.
        // Flag it so the client renders "10,000+", same contract the recency
        // path already uses. Tier is inferred from the snippet column, which
        // only the description tier populates.
        // Same correction as the countOnly probe above: the tier is the snippet
        // column's TYPE (NULL on the title tier, a ts_headline string on the
        // description tier), not its length. This site only appeared healthy
        // because it samples 200 rows instead of 1 — a description-tier query
        // whose whole window has empty descriptions would under-report here too.
        // Leaving one of the two sniffs wrong is how the count and the list
        // start disagreeing again.
        // THE HEADLINE'S CEILING IS NOW ALWAYS THE TITLE CEILING, because the
        // headline is now always the title count — the snippet sniff no longer
        // decides which cap applies to it. Applying the description tier's 3,000
        // ceiling to a title count would flag a 3,000-exact-match query as capped
        // when it is not. The old branch is deploy-window cover ONLY; delete it
        // once the migration is verified.
        const rankedTier2 = (ranked as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string");
        const rankedCapped = related === null
          ? (total ?? 0) >= (rankedTier2 ? 3_000 : 10_000)
          : (total ?? 0) >= 10_000;
        // The related segment reads the newest 3,000 description matches, so a
        // related count that fills what is left of that window is a FLOOR, not a
        // total, and has to say so.
        const relatedCapped = related !== null && (total ?? 0) + related >= 3_000;
        const v0 = (meta?.v ?? {}) as Record<string, unknown>;
        // FILTER GATE — shared by every rescue tier (fuzzy replacement,
        // semantic, and the low-result fuzzy augmentation below). None of the
        // rescue RPCs carry filter parameters, so with any restrictive filter
        // active they all stand down: the filtered (possibly empty) answer IS
        // the honest answer. This gate is the fence that once broke on a
        // company lander serving other companies' jobs for a typo'd query.
        //
        // THIS WAS A HAND-MAINTAINED LIST OF TEN FIELDS AND IT WENT STALE.
        //
        // `sendableOnly` — the "Agent can apply" filter, i.e. the filter for the
        // product that costs $99/mo — was never added. None of the three rescue
        // RPCs below takes filter params, so with the agent filter as the ONLY
        // active filter, `filtersActive` read false and all three fired
        // unfiltered.
        //
        // Proven live: {"q":"nurse practicioner","sendableOnly":true} returned
        // 13 rows of which 1 was sendable, with filterIntegrity reporting 12
        // violations — and the unfiltered control returned an IDENTICAL id set.
        // The predicate was absent, not loose.
        //
        // Derived MECHANICALLY from `applied` now, the way filters.ts's own
        // isUnfiltered already does. A conjunction that must be edited every
        // time a filter is added is a conjunction that will go stale again —
        // filters.ts's header documents that exact failure, and this is it.
        // includeUnstatedPay joins the widening set for the same reason
        // includeUncategorised is in it: this gate asks "did the caller NARROW
        // anything", and a toggle that only ever ADMITS more rows must not
        // fence off the rescue tiers.
        const NON_NARROWING = new Set(["includeUncategorised", "includeUnstatedPay", "sort", "q"]);
        const filtersActive =
          !!sanitizeTerm(String(body.location ?? "")) ||
          body.remote === true ||
          Object.entries(applied).some(([k, v]) => {
            if (NON_NARROWING.has(k)) return false;
            if (v === null || v === undefined || v === false || v === "") return false;
            if (Array.isArray(v)) return v.length > 0;
            return true;
          });
        // THE RESCUE TIERS NOW CARRY THE FILTERS INSTEAD OF STANDING DOWN.
        //
        // The flag above used to mean "no rescue runs at all". Measured live
        // 2026-08-22 on the deployed board: q="nurrse" alone returned 17 close
        // matches, and the SAME query with country=US, category=healthcare or
        // workMode=remote each returned zero rows with no disclosure. One typo
        // plus any filter emptied the board.
        //
        // Standing down was right only while the RPCs could not filter. That is
        // no longer the shared situation:
        //   * the exact-word tier binds through buildQuery and always carried
        //     every filter — it never needed the fence;
        //   * the trigram rescue takes the filters as parameters as of
        //     20260822040000 and applies them BEFORE its own cap;
        //   * the semantic RPC still cannot, so it hydrates its ids back through
        //     buildQuery below.
        //
        // SPREAD-OMITTED WHEN NOTHING IS NARROWED, and that is deploy-window
        // tolerance rather than tidiness: sending these arguments to the OLD
        // three-argument function makes PostgREST answer a no-such-function code
        // and the tier returns nothing. While the migration is unapplied, an
        // unfiltered typo query keeps its old call shape and keeps working, and a
        // filtered one degrades to the empty page it already shows today — no
        // regression in either deploy order.
        // ONE SEMANTIC RETRIEVAL, TWO ENTRY POINTS.
        //
        // The vector tier is now reachable from two places — the empty-page
        // rescue below, and the low-result augmentation further down — and the
        // four properties that make it safe are subtle enough that a second
        // copy would drift from this one within a change or two:
        //
        //   1. bounded: a cold isolate loads a gte-small session on first use,
        //      so the embed is deadlined or it sets the floor on how long the
        //      whole request takes;
        //   2. filter-SAFE, never filter-aware: the ANN scan cannot take
        //      predicates, so its ids are hydrated back through buildQuery —
        //      the one filter binder — and re-sorted into embedding order.
        //      Pushing predicates into an HNSW scan is filtered-ANN, a
        //      different and riskier problem;
        //   3. ANCHORED: the vector tier always returns something — it has no
        //      notion of "nothing is close" — so 'zzzqqxwv' came back with one
        //      confident unrelated job, 2/2. At least one row that will SHIP
        //      must share a real token with the query. A rescue that cannot
        //      say no is worse than no rescue;
        //   4. anchored on the rows that SURVIVE the filters, not the
        //      candidates, or the tier answers on evidence it is not showing.
        //
        // Returns null when it declines for any reason. Callers treat null and
        // empty identically — neither is an answer.
        const semanticRows = async (
          want: number,
          embedBudgetMs: number,
          exclude?: { ids: Set<string>; keys: Set<string> },
        ): Promise<Array<Record<string, unknown>>> => {
          // THE ANCHOR IS DECIDED ON WHAT SHIPS, SO EXCLUSION HAPPENS IN HERE.
          //
          // An adversarial review caught this before it shipped, and the shape
          // is worth keeping in front of whoever adds the third caller. The
          // augmenting caller drops candidates already on the page — and those
          // are exactly the rows most likely to be carrying the anchor, because
          // a thin page's rows are lexical matches whose titles contain the
          // query token by construction. Anchoring outside, then excluding
          // outside, produced: q="sommelier" with 4 exact rows on the page, ANN
          // returns those 4 plus 56 hospitality neighbours, `anchored` is
          // satisfied by the 4, the 4 are then dropped as duplicates, and 56
          // rows containing no "sommelier" anywhere ship under a claim that
          // they are about the same thing. That is the 'zzzqqxwv' failure with
          // a non-empty page in front of it.
          //
          // Taking the exclusion set as a PARAMETER makes "anchored on the rows
          // that ship" an invariant of this function rather than a rule each
          // caller has to remember.
          //
          // Cheap refusal first: the anchor needs a token of 3+ characters, so
          // a query that has none (q="ai ml") can never satisfy it. Deciding
          // that here costs nothing; deciding it after the embed costs a model
          // load, an HNSW scan and a hydration round trip for a guaranteed [].
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
          // TWO DIFFERENT SILENCES, AND ONLY ONE OF THEM USED TO BE LOGGED.
          //
          // withDeadline is a Promise.race that RESOLVES `{ data: null }` both
          // when the deadline passes and when the call rejects — it never
          // throws — so on a deadline miss `error` is undefined and the sErr
          // guard below never sees one. `data === null && !error` is exactly and
          // only that sentinel: a successful RPC returns an array (possibly
          // empty), a failed one returns { data: null, error }.
          //
          // The trailing `.catch(() => ({ data: null, error: ... }))` that used
          // to sit here could therefore never fire, which is why a tier that had
          // stopped answering still looked like a tier that had nothing to say.
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
          // HYDRATED UNCONDITIONALLY, not just when a filter is narrowing.
          //
          // This used to be gated on filtersActive, which was defensible while
          // the tier only ever answered an EMPTY page: with nothing else on
          // screen, raw ANN rows were the whole response and their shape was
          // self-consistent. The augmenting caller appends them to rows that
          // came through buildQuery, and search_jobs_semantic does not return
          // `country` at all — so an unfiltered thin page would mix rows that
          // have a country with rows whose country is silently null, on the
          // same list. Hydrating always costs one indexed id-lookup and makes
          // every served row come from the one binder.
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
          // One producer for the vendor list; this function spells the parameter
          // differently for the reason recorded in the migration.
          ...rescueVendorsParam(applied),
        } : {};
        // ── THE LOCATION SPLIT TIER ───────────────────────────────────
        //
        // "nurse london" RETURNED A SCHOOL NURSE IN NEW SOUTH WALES.
        //
        // MEASURED live 2026-08-27:
        //   q="nurse"                        title matches 10,000 (capped)
        //   q="nurse london"                 title matches 0, 121 description
        //   q="nurse" + location=london      title matches 30, 105 description
        //
        // Typing the city into the search box does not search that city. The
        // words are ANDed against title_tsv, no title contains both, and the
        // function escalates to search_tsv — so "london" is matched wherever it
        // appears in four thousand characters of description. The top three
        // results for "nurse london" were London Ontario, MARSDEN PARK NEW SOUTH
        // WALES, and London Kentucky. "software engineer austin" is the same
        // shape: 0 title matches against 116 with the location filter set.
        //
        // Putting the place in the box is the most ordinary thing a searcher
        // does, and it was the query most likely to be answered with noise.
        //
        // NO GAZETTEER. The board decides what a place is, by asking: split the
        // query, treat the tail as a location, and see whether the head has real
        // TITLE matches inside it. That test is self-validating and it is what
        // makes this safe on queries that merely look like they end in a place:
        //   "drive a truck at night"     location "night"   -> no such place
        //   "help old people at home"    location "at home" -> head "help old
        //                                people" has no title matches anyway
        // Both fall through untouched. A static city list would need maintaining
        // and would still be wrong about Reading, Mobile and Jordan; this asks
        // the corpus instead, and the corpus is the thing being searched.
        //
        // COSTS NOTHING ON A HEALTHY SEARCH. It runs only where the title count
        // is ZERO and the page is therefore description-only guessing — the
        // state this fixes. A search with title matches never reaches here.
        //
        // TWO SPLITS, LONGEST FIRST, so "new york" and "san francisco" are tried
        // whole before "york" and "francisco". Issued concurrently: the pair
        // costs one round trip, and the two-word answer wins when both hit.
        if (
          total === 0 && ranked.length > 0 && offset === 0 && !countOnly &&
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
                if (!Number.isFinite(hits) || hits <= 0) continue;
                won = {
                  rows: (rows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>,
                  head: splits[i].head,
                  place: splits[i].place,
                  hits,
                };
              }
              if (won) {
                // Exclusions ("nurse not travel") are applied by
                // attachRecheckedAt below, the same seam every other tier on
                // this route uses — one filter, one spelling of the rule.
                const splitJobs = won.rows;
                const splitScored = rerankWindow(splitJobs, [won.head]);
                const splitGrouped = groupSimilar
                  ? collapseClusters(splitScored, limit)
                  : { jobs: splitScored.slice(0, limit), rawConsumed: Math.min(splitScored.length, limit) };
                if (splitGrouped.jobs.length > 0) {
                  logSearch("ranked", splitGrouped.jobs.length, won.hits, "fuzzy");
                  return json({
                    jobs: preferMatchedLocation(
                      await attachRecheckedAt(client, splitGrouped.jobs, excludedTerms),
                      locationTerms(won.place).terms,
                    ),
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
                    totalAllCompanies: safeMetaTotal ?? 0,
                    ...(trackedTotal !== null ? { trackedTotal } : {}),
                    companies: [],
                    companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
                    categories: {},
                    failedSources: [], failedCount: 0,
                    refreshedAt: (v0.refreshedAt as string) ?? null,
                  });
                }
              }
            }
          } catch { /* the description-only page below is still a page */ }
        }

        // Empty ranked result: try the FAST trigram fuzzy fallback right here
        // ("desinger" → designer), then return an honest empty. Critically we
        // do NOT fall through to the recency path — its OR-of-ILIKE with an
        // exact count seq-scans 550k rows for a no-match term and times out
        // (measured 9.7s → "temporarily unavailable"). The ranked + fuzzy
        // paths are both index-backed and fast.
        // `total === 0` only — a null total means "count unavailable", which is
        // not the same claim as "nothing matches" (see the recency-path twin).
        // ROWS, NOT THE HEADLINE. This gate guards the rescue tiers — exact word,
        // trigram fuzzy, semantic — and every one of them RETURNS EARLY with its
        // own result set. Under two segments a query with zero title matches and
        // 39 description matches has a total of 0 and a full page of rows, and
        // this gate would have thrown those rows away and served a typo
        // correction of a query that needed none. Twenty of forty measured
        // country x skill combinations are exactly that shape.
        // `total === 0` implied `ranked.length === 0` before this change, so the
        // rewrite is behaviour-preserving against today's SQL and correct after.
        if (ranked.length === 0 && offset === 0 && !countOnly) {
          // Demand telemetry, ranked path — logged AT EACH TERMINAL with its
          // rescue outcome. The single up-front insert counted typo queries
          // that fuzzy then rescued as if they were catalog gaps, so the
          // steering signal conflated "we lack this" with "they misspelled
          // this". `rescued` tells the census which is which: 'none' is a real
          // gap; 'fuzzy'/'semantic' means the user was served something and
          // the gap is softer.
          // AND 'degraded' IS A FOURTH ANSWER, because a rescue tier that could not
          // run is not evidence of a catalog gap. Filing a failed retrieval as
          // 'none' quietly poisons the demand census with queries the board may
          // well be able to answer — and the census steers what gets added to
          // the board next, so a broken tier would have argued for sourcing
          // jobs the board already had.
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
          // ── THE SIMPLE-CONFIG TIER ────────────────────────────────────
          //
          // Runs FIRST among the rescues, because it is exact word matching and
          // therefore more precise than trigram similarity or embeddings.
          //
          // WHY IT EXISTS. Every tsvector in this schema is built with the
          // 'english' configuration, which discards stopwords before storing
          // anything — so "it" is not in the index at all and no query-side
          // rewrite can retrieve it. Measured through PostgREST against live
          // production: title=wfts(english).IT matches NOTHING, while
          // title=wfts(simple).IT returns 4,072 rows. The board serves about 18
          // for q="IT" against 4,145 postings carrying it as a title word.
          // Simple also stops the stemmer conflating words: "intern" matches
          // 7,280 under english (Internal, International) and 4,907 under
          // simple, which is the precise set.
          //
          // It reuses buildQuery with skipTerms, so every filter — freshness,
          // missing_since, country, category, experience, salary, companies —
          // binds in the ONE place they are bound, and only the matcher differs.
          //
          // ONLY ON AN EMPTY PAGE, and that bound is deliberate. The visitor is
          // already looking at zero results, so the worst case this can add is
          // a wait before the same empty page. It cannot make a working query
          // slower because it never runs on one.
          //
          // IT DEPENDS ON AN INDEX THAT MUST EXIST FIRST. Measured WITHOUT
          // job_board_postings_title_simple_fts_idx, this filter is a
          // sequential scan over 602,880 rows: q="IT" took 2.1s and q="ux" and
          // q="qa" both returned HTTP 500 (statement timeout) at ~3.2s. Deploy
          // the index migration and verify it BEFORE this function. The catch
          // below means a failure degrades to the empty page the visitor
          // already had rather than an error, but that is a safety net, not a
          // licence to ship the two out of order.
          // THE SHARED RESCUE FENCE DOES NOT APPLY TO THIS TIER, AND NEVER DID.
          // The fence exists because the other two rescue RPCs cannot filter.
          // This one is not an RPC — it is buildQuery with a different matcher,
          // so freshness, presence, country, work mode, field, experience,
          // salary, companies and both date filters were already binding on every
          // call. Standing it down under a narrowing threw away an answer that
          // was already correct. Nor is there a cost argument: the literal query
          // shape under adversarial filters at concurrency 4 measured 0.22-0.51s
          // across a dozen combinations, and it still only fires on an already
          // empty page.
          if (qText.length >= 2) try {
            // NOTE: withDeadline is Promise.race — on timeout it resolves
            // { data: null } and the SQL KEEPS RUNNING server-side. That is why
            // the window is bounded to limit*2 rows and why this only fires on
            // an already-empty page: an abandoned query still costs the
            // database, so it must be small and rare.
            const t_simple_config = Date.now();
            const { data: simpleRows, error: sErr2 } = await withDeadline(
              // TWO INDEXED QUERIES, NOT ONE or(). An employer name lives in
              // company, and leaving company out is why q="AT&T" reached the 23
              // postings with AT&T in their TITLE — a Busser at the AT&T
              // Discovery District — and none of the 493 whose EMPLOYER is AT&T.
              //
              // The obvious form, or=(title.wfts,company.wfts), was written and
              // MEASURED FIRST, and it is a trap: an OR across two columns plus
              // ORDER BY effective_posted cannot be served by one index, so the
              // planner gathers every match and sorts. Timed with the tier's
              // real column list and ordering:
              //   or() AT&T    2.23s        or() dominos  HTTP 500 at 3.24s
              // That is the "ORDER BY the date index does not serve" shape this
              // board already took a 17s outage from.
              //
              // Split in two, each side hits its own gin index and returns in
              // about a quarter of a second, and the merge happens here over at
              // most a few hundred rows. Issued CONCURRENTLY so the pair costs
              // one round trip, not two.
              // allSettled, NOT all. supabase-js resolves an HTTP error into
              // { data: null, error } rather than rejecting, but a network
              // throw WOULD reject — and with Promise.all one rejection
              // discards the other side's results. MEASURED right now, before
              // the company index exists: the title side answers in 0.21-0.27s
              // while company 500s at 3.31s on "dominos". The half that works
              // must still answer.
              Promise.allSettled([
                buildQuery("effective_posted", false, undefined, { skipTerms: true })
                  .textSearch("title", ftsQuery(qText), { type: "websearch", config: "simple" })
                  .order("effective_posted", { ascending: false, nullsFirst: false })
                  .order("id", { ascending: true })
                  .range(0, Math.max(limit * 2 - 1, 0)),
                // COMPANY HALF RE-ENABLED — its index exists now, verified at
                // concurrency rather than serially.
                //
                // I disabled this when four concurrent callers got
                // 500 500 500 500 from an unindexed sequential scan I had
                // shipped. With job_board_postings_company_simple_fts_idx
                // built, the same four now return 200 in 0.21-0.47s across
                // "IT", "dominos" and "nurse". The stub said to re-enable only
                // after that check passed; it has.
                buildQuery("effective_posted", false, undefined, { skipTerms: true })
                  .textSearch("company", ftsQuery(qText), { type: "websearch", config: "simple" })
                  .order("effective_posted", { ascending: false })
                  .order("id", { ascending: true })
                  .range(0, Math.max(limit * 2 - 1, 0)),
              ]).then((settled) => ({
                // A failure on EITHER side is survivable — the other still
                // answers. The company index may not exist yet, and a tier that
                // dies entirely because half of it is unindexed would be worse
                // than the empty page it replaces.
                data: settled.flatMap((r) =>
                  r.status === "fulfilled"
                    ? ((r.value as { data?: unknown[] })?.data ?? [])
                    : []
                ),
                error: null,
              })),
              // 7s, not 4s. MEASURED: the pair costs ~1.3s warm (title 0.25s,
              // company 1.13s, issued concurrently), but eight identical calls
              // to q="IT" produced 7.9s, 6.5s, then six between 2.6s and 3.0s —
              // cold-start spikes. Under the old 4s budget the two slow calls
              // blew the deadline and fell through to the fuzzy tier, so the
              // SAME QUERY returned 60 rows or 19 depending on the call.
              //
              // Non-determinism is worse than either answer. It makes the
              // telemetry unreadable — a zero-result rate that depends on
              // warm-up cannot be compared week to week — and it makes every
              // relevance measurement a coin toss, which is how "IT is fixed"
              // got reported off a lucky draw.
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
              logSearch("ranked", simpleGrouped.jobs.length, null, "fuzzy");
              return json({
                jobs: preferMatchedLocation(await attachRecheckedAt(client, simpleGrouped.jobs, excludedTerms), locationTerms(body.location).terms),
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
                totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                companies: [],
                companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
                categories: {},
                failedSources: [], failedCount: 0,
                refreshedAt: (v0.refreshedAt as string) ?? null,
              });
            }
          } catch { /* the empty page the visitor already had */ }

          // FILTERS BOUND, NOT FENCED OUT — AND A THREE-CHARACTER FLOOR, which
          // this tier never had and the other two always did.
          //
          // The floor is the whole reason this ungating is not a regression.
          // Degenerate queries are this RPC's worst case by a wide margin:
          // measured at concurrency 4, q='a' 3.07-3.36s, q='++' 3.94-3.96s,
          // q='  ' 2.64-2.72s, against 1.65s for the worst real misspelling.
          // End to end, {"q":"++"} costs 5.08-5.25s today while
          // {"q":"++","country":"US"} costs 1.10-1.33s precisely because the
          // fence keeps it out. Ungating without a floor moves every filtered
          // two-character query onto the expensive path and holds a database
          // connection for four to five seconds to return nothing.
          //
          // The filters themselves apply BEFORE the ORDER BY and the cap, which
          // is why this is a signature change rather than an id hydration:
          // hydrating the unfiltered top 60 and narrowing after kept 2 of 60 GB
          // rows for q=nurrse, where the complete trigram set is about 28% GB.
          if (qText.length >= 3) try {
            const t_fuzzy_title_search_2 = Date.now();
            const { data: fuzzy, error: fErr } = await client.rpc("fuzzy_title_search", {
              p_q: qText, p_fresh_cutoff: freshCutoffIso, p_limit: limit,
              ...rescueFilterParams(),
            });
            markFrom("fuzzy_title_search", t_fuzzy_title_search_2);
            if (!fErr && Array.isArray(fuzzy) && fuzzy.length > 0) {
              // Same-company+title clones flood trigram results exactly like
              // the other tiers — collapse them the same way (audit: adjacent
              // duplicate cards were measured on typo queries).
              const fuzzyRows = (fuzzy as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              const fuzzyGrouped = groupSimilar
                ? collapseClusters(fuzzyRows, limit)
                : { jobs: fuzzyRows.slice(0, limit), rawConsumed: Math.min(fuzzyRows.length, limit) };
              logMiss("fuzzy");
              // The reported total here was the REQUEST LIMIT wearing a total's
              // clothing. fuzzy_title_search computes total_rows inside its own
              // LIMIT, so at p_limit=60 it returns 60 whenever 60 or more rows
              // match, and the `|| jobs.length` fallback echoes the page size
              // when it returns nothing at all. Measured on the live board:
              //   q="nurse practicioner"  limit=5  -> total 5
              //                           limit=20 -> total 20
              //                           limit=60 -> total 60, 38 rows shown
              // so the header read "Showing 38 of 60" — a figure that is neither
              // the number of close matches nor anything else about the data,
              // and that MOVES when the caller changes its page size. That is
              // the same defect class as publishing 587,793 over a filtered
              // page: a number presented as a total that is not one.
              //
              // total_rows is only trustworthy BELOW the cap. At or above it the
              // honest answer is that we don't know, which the response already
              // has a contract for — countUnavailable renders "Showing N
              // matching openings" with no total rather than inventing one.
              const fzTotal = Number((fuzzy[0] as { total_rows?: number }).total_rows);
              const fzKnown = Number.isFinite(fzTotal) && fzTotal > 0 && fzTotal < limit;
              logSearch("fuzzy", fuzzyGrouped.jobs.length, fzKnown ? fzTotal : null, "fuzzy");
              return json({
                jobs: preferMatchedLocation(await attachRecheckedAt(client, fuzzyGrouped.jobs, excludedTerms), locationTerms(body.location).terms),
                searchId,
                ...searchDisclosures(body, applied, maxAgeClamped),
                ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
                ...coverageDisclosure(applied, meta),
                ...honesty(fuzzyGrouped.jobs),
                // This page is a RESCUE, not page 1 of a result set. It omitted
                // hasMore/nextOffset, so the client's "Load more" issued the
                // ordinary query at offset 60 — which returns the exact-match
                // path (empty, since total was 0), and the merge dropped the
                // closeMatch flags, re-labelling the rescued rows as exact
                // matches. Saying there is no more explicitly keeps the
                // disclosure attached to the only page that carries it.
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
                  totalAtLeast: Number.isFinite(fzTotal) && fzTotal >= limit ? fzTotal : fuzzyGrouped.jobs.length,
                }),
                totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                companies: [],
                companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
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
          // Tier 3 — semantic. Only reachable when BOTH full-text tiers and the
          // trigram fuzzy fallback found nothing, so it strictly ADDS results
          // where the user currently gets an empty page. The response carries
          // `semantic: <query>` and the client shows a disclosure line (like
          // the fuzzy one) — these are nearest-by-meaning, never passed off as
          // keyword matches. Every failure falls through to the honest empty.
          //
          // FILTER GATE (review finding): search_jobs_semantic carries no
          // filter parameters, so firing it while any filter is active would
          // silently ignore that filter — a company lander would show OTHER
          // companies' jobs under "open roles at Acme". This file's own
          // invariant is that a filter is honoured on every route, so with any
          // restrictive filter active the semantic tier stands down and the
          // honest empty (which respects the filters) is the answer.
          // (filtersActive computed once above, shared with the fuzzy tier.)
          if (qText.length >= 3) {
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
                  logSearch("semantic", semGrouped.jobs.length, semGrouped.jobs.length, "semantic");
                  return json({
                    jobs: preferMatchedLocation(await attachRecheckedAt(client, semGrouped.jobs, excludedTerms), locationTerms(body.location).terms),
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
                    totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                    companies: [],
                    companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
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
        // Newest-first over the MATCHING set. The RPC picked the rows by
        // relevance (that is what makes them matches at all); this orders the
        // page the reader is looking at by date, which is what the control they
        // chose promises. Undated rows sort last rather than first — an absent
        // date is not evidence of newness, and treating it as such is how a
        // board ends up leading with rows whose age it does not know.
        if (newestFirst) {
          rankedRows.sort((a, b) => {
            const da = Date.parse(String(a.postedAt ?? "")) || 0;
            const db = Date.parse(String(b.postedAt ?? "")) || 0;
            return db - da;
          });
        }
        // The window is anchored at rank 0 for sorted modes, so the caller's
        // offset is a position within it and has to be applied HERE, after the
        // sort. Everything downstream — clustering, rawConsumed, nextOffset —
        // then advances inside one stable ordering.
        // THE SCORER, ON THE PATH THAT SERVES MOST SEARCHES.
        //
        // This is what q="sales" actually needed. All 959 postings titled
        // exactly "Sales Associate" are already IN this window — verified by
        // intersection, 959/959 — and never surface, because ts_rank's default
        // normalization applies no length penalty so a title repeating "sales"
        // four times outranks the exact match. It is also what separates c++
        // from c#: 38 of these 200 rows contain the literal "c++" and 25
        // contain "c#", and only the literal-substring rule can tell them apart
        // once the parser has destroyed both.
        //
        // The candidate set is the RELEVANCE top-200, not a recency slice. A
        // review killed the recency version of this idea outright — its pool
        // spanned two hours of ingest and held 3 of the 959 exact titles. This
        // one starts from what the engine already judged most relevant and only
        // reorders it.
        // THE HEAD-TERM RING. A scorer cannot rank what the retriever never
        // fetched, and for a one- or two-word query ts_rank never fetches the
        // right rows.
        //
        // MEASURED for q="sales": of the 200 rows search_jobs returns, ZERO are
        // titled exactly "Sales Associate" and ZERO are three words or shorter,
        // against 958 such postings on the board. ts_rank's default
        // normalization rewards repetition, so "Sales Director - Sales" and
        // "Corporate Sales ... Sales Section ... Sales Department" outrank the
        // exact match — and push it past rank 200, out of reach of any
        // re-ranking. Scoring the window fixed c++ (38 of its 200 rows carried
        // the literal string) and could never fix sales.
        //
        // A prefix scan supplies exactly what is missing. Same query, 400-row
        // window: 27 exact "Sales Associate", median title THREE words, and the
        // top five are that title verbatim. Measured under concurrency 4, which
        // is the only measurement that counts here: sales 0.41-0.59s, nurse
        // 0.42-0.55s, engineer 0.75s, manager 0.82-0.93s, all 200.
        //
        // It ADDS candidates, it does not replace them: prefix alone would lose
        // every "Software Engineer" for q="engineer" (2,313 prefix rows against
        // a far larger real set). The two are merged, deduped, and the scorer
        // decides.
        //
        // Only for SHORT queries. A three-word query already carries enough
        // signal for ts_rank, and this is one extra round trip on the hottest
        // path in the function — it is not free and should not fire when it
        // cannot help.
        let headRows: Array<Record<string, unknown>> = [];
        if (headRingP) {
          try {
            // Started before search_jobs — see the comment there. By the time we
            // get here it has usually already resolved, so this await is free.
            // markFrom still measures from when the query was ISSUED, not from
            // here, or the phase record would report ~0ms for a real round trip
            // and hide the cost it exists to expose.
            const { data: hr } = await headRingP;
            markFrom("head_ring", t_head_ring_started);
            if (Array.isArray(hr)) headRows = (hr as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
            else console.warn(`[JOB-BOARD] head-term ring missed its deadline for q=${JSON.stringify(qText)}`);
          } catch { /* the ranked window alone is still a valid page */ }
        }
        // Deduped by id, prefix first. If the ring fails the page degrades to
        // exactly today's ranked result rather than to something incoherent —
        // which is the difference between this and the multi-arm fusion three
        // judges rejected.
        const mergedSeen = new Set<string>();
        const mergedRows = [...headRows, ...rankedRows].filter((r) => {
          const id = String((r as Record<string, unknown>).id ?? "");
          if (!id || mergedSeen.has(id)) return false;
          mergedSeen.add(id);
          return true;
        });
        // A deep page is served in the RPC's own ts_rank_cd order. This is a
        // REAL quality drop and it should be said plainly rather than called
        // noise: index.ts:8290-8320 documents that without rerankWindow all 959
        // postings titled exactly "Sales Associate" sit inside the window and ts_rank
        // rewards repetition. Past the seam the tail is served PRE-SCORER. It is
        // not re-enabled here because rerankWindow permutes the fetched window
        // while nextOffset advances by rankedGrouped.rawConsumed, which is the
        // "sorted page two repeated 17 of 20 rows" incident at index.ts:7845-7855.
        // The pagination-safe form is to reorder rankedGrouped.jobs AFTER
        // collapseClusters (the shape the fuzzy augment at :8480-8488 already
        // uses); that is a follow-up, deliberately not in this patch.
        // mergedRows is the SQL page here, the ring having stood down above.
        const rankedScored = pagePlan.rerank ? rerankWindow(mergedRows, [qText, ...expansions]) : mergedRows;
        // CLAMPED TO THE SEAM before the offset is applied, but ONLY for queries
        // that have a seam. Without the clamp a page STARTING below the seam runs
        // past it — offset 150 + limit 100 served pool positions 150-249 — and the
        // next request, now in the SQL regime, begins at rank 250 and silently
        // skips 200-249. COST, said out loud: for a deep-pageable query at
        // limit >= 67 the clamp caps page one's raw intake at 200 where it could
        // previously consume the whole ~400-row merged pool, so page one returns
        // fewer CARDS than today (measured pre-patch: 189 cards at limit 200 from
        // a 293-row pool). Non-deep-pageable queries — sort=newest, EMPLOYER,
        // SIMPLE, SYMBOL — are not clamped and behave exactly as today.
        const rankedWindow = rankedScored.slice(pagePlan.sliceStart, pagePlan.sliceEnd);
        let rankedSequence = rankedWindow;
        let rankedGrouped = groupSimilar
          ? collapseClusters(rankedWindow, limit)
          : { jobs: rankedWindow.slice(0, limit), rawConsumed: Math.min(rankedWindow.length, limit) };
        // DEEP PAGES ARE SCORED NOW — the follow-up the comment above promised.
        //
        // Past the 200-row seam the tail was served in the RPC's raw ts_rank_cd
        // order, and ts_rank rewards repetition: "Sales Director - Sales" beats
        // the posting titled exactly "Sales Associate". The scorer could not be
        // applied to the WINDOW because rerankWindow permutes rows while
        // nextOffset advances by rawConsumed — that mismatch is the "sorted page
        // two repeated 17 of 20 rows" incident.
        //
        // Applying it to the CARDS instead is pagination-safe by construction:
        // this reorders only the rows already selected for this page, after
        // clustering has chosen them. rawConsumed is untouched, so the next page
        // starts exactly where it would have, and no row moves between pages.
        //
        // HONEST LIMIT: it reorders within a page and cannot pull a better row
        // forward from a later one. Page 3 is ordered well; a row that belongs
        // on page 3 but sits on page 5 still sits on page 5. That is inherent to
        // offset paging and is why the seam exists at all.
        if (deepPage && scoreRanked && rankedGrouped.jobs.length > 1) {
          rankedGrouped = { ...rankedGrouped, jobs: rerankWindow(rankedGrouped.jobs, [qText, ...expansions]) };
        }

        // THE SAME TOP-UP THE BROWSE PATH GOT, because this is the path that
        // actually needed it. The first version shipped only on the recency
        // path, and MEASURED after deploy it changed nothing: "retail sales"
        // still returned 37 cards of 60 and "customer service" 41, because a
        // typed query is served HERE and returns long before that code. The
        // browse path I fixed is the one people do not type into.
        //
        // Same three bounds as the other one: fires only when the buffer was
        // genuinely exhausted, runs EXACTLY once (a loop is the amplification
        // shape that took the board down on 2026-08-17), and serves the page
        // it already has if the second call fails. Paged by p_offset, which is
        // how this RPC has always paged, so there is no cursor arithmetic to
        // get wrong.
        // NOT ON A SORTED PAGE. The top-up pages from `offset + rankedRows.length`,
        // which is relevance-order arithmetic — the same coordinate mix-up that
        // made sorted page two repeat page one. A sorted mode has already read
        // the RPC's entire 200-row cap as one window, so there is nothing behind
        // it to top up with: the correct behaviour is a short final page, not a
        // second fetch appended in a different ordering.
        if (!newestFirst && !scoreRanked && groupSimilar && rankedGrouped.jobs.length < limit && rankedRows.length >= fetchLimit) {
          try {
            const t_search_jobs_1 = Date.now();
            const { data: more, error: moreErr } = await client.rpc("search_jobs", {
              p_q: expandedQ,
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
              p_limit: fetchLimit,
              p_offset: offset + rankedRows.length,
            });
            markFrom("search_jobs", t_search_jobs_1);
            if (!moreErr && Array.isArray(more) && more.length) {
              rankedSequence = [...rankedRows, ...(more as unknown[]).map(rowToJob) as Array<Record<string, unknown>>];
              rankedGrouped = collapseClusters(rankedSequence, limit);
            }
          } catch { /* the page we already have is correct — serve it */ }
        }
        // LOW-RESULT AUGMENTATION. The rescue tiers used to fire only on
        // total === 0, so ONE posting that happened to share the user's typo
        // ("desinger" appearing verbatim in a single title) suppressed the
        // hundreds of corrected matches fuzzy would have found. When a typed
        // query lands 1-4 exact matches unfiltered, run the trigram tier too
        // and APPEND its novel rows — each marked closeMatch:true and the
        // response carrying fuzzyExtra, so the client labels them as close
        // matches instead of passing them off as exact ones. Exact matches
        // keep their position; nothing is reordered or replaced.
        //
        // Raised from 5 to 20. THE ORIGINAL JUSTIFICATION FOR THIS WAS WRONG and
        // the correction is worth keeping, because it nearly shipped as fact.
        //
        // I measured "nurse practicioner" returning EXACTLY 5 against 1,771 for
        // the correct spelling, and concluded the gate `total < 5` was missing it
        // by one. It was not. Every probe used limit=5, and for a query the
        // EMPTY-path rescue handles, `total` was the fuzzy tier's row count —
        // which is capped at p_limit. Re-measured across limits:
        //   "nurse practicioner"  limit=5 -> 5   limit=20 -> 20   limit=60 -> 60
        // The total tracked my page size. That query returns ZERO exact matches,
        // the empty-path rescue already fires, and this gate never applied to it.
        // A number that moves with the request is not a measurement of the data.
        //
        // What the change DOES reach are queries with genuinely low real totals —
        // measured stable across limits: "bioinformatician" 18, "adminstrative
        // assistant" 19. Those got no close matches before and do now. That is a
        // real but modest win, and a weaker case than the one I first wrote down.
        //
        // 20 is where exact matches start filling a 60-row page. The trigram tier
        // is index-backed (gin on title) and offset-0 only, so the extra reach is
        // cheap. It no longer stands down under a narrowing: the RPC takes the
        // filters now, so a lightly-matched FILTERED query gets correctly-filtered
        // close matches appended instead of nothing. Reproduced live before the
        // change: {"q":"desinger","country":"US"} returned exactly 1 exact row —
        // inside the augmentation band — and the visitor saw that single junk
        // result with no close matches offered.
        const FUZZY_AUGMENT_BELOW = 20;
        let fuzzyExtraOut: { q: string; count: number } | null = null;
        let semanticExtraOut: { q: string; count: number } | null = null;
        // GATED ON THE WHOLE PAGE, NOT ON THE EXACT SEGMENT, and no longer fenced
        // by a narrowing. A query with 2 exact and 300 related matches has a full
        // page already; padding it would dilute a result set that does not need
        // rescuing and push close matches above 300 legitimate description hits.
        if (pageTotal !== null && pageTotal > 0 && pageTotal < FUZZY_AUGMENT_BELOW && offset === 0 && !countOnly && qText.length >= 3) {
          try {
            const t_fuzzy_title_search_0 = Date.now();
            const { data: fz, error: fzErr } = await client.rpc("fuzzy_title_search", {
              p_q: qText, p_fresh_cutoff: freshCutoffIso, p_limit: limit,
              ...rescueFilterParams(),
            });
            markFrom("fuzzy_title_search", t_fuzzy_title_search_0);
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
              const novel = fuzzyRows.filter((r) =>
                !haveKeys.has(clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""))));
              const extra = (groupSimilar ? collapseClusters(novel, room).jobs : novel.slice(0, room))
                .map((j) => ({ ...(j as Record<string, unknown>), closeMatch: true }));
              if (extra.length > 0) {
                // ORDER BY MATCH STRENGTH, NOT BY WHICH TIER ARRIVED FIRST.
                //
                // Appending put the close matches BELOW every exact row, and on
                // a misspelling the exact rows are the junk. Measured live the
                // hour this shipped, q="maneger", limit=60: SEVEN Dutch care
                // postings (Slaapwacht, Woonbegeleider, Persoonlijk begeleider)
                // above THIRTY-NINE Managers. None of the seven has "maneger"
                // in its title — they matched on description text — while all
                // thirty-nine are what the searcher meant. Same shape on
                // q="nures": "CARE NOW FULL TIME REGISTER NURE" first, five
                // Nurses beneath it, the one row on top matching a typo in the
                // employer's own posting.
                //
                // The rule is the ordinary one this path had inverted: A TITLE
                // MATCH BEATS A DESCRIPTION-ONLY MATCH. A close title match is
                // stronger evidence of intent than a body-text coincidence, so
                // it sits above it — and below a real title hit, which is
                // stronger still. On q="profesor" every exact row DOES carry
                // the term in its title, so that query is untouched: the
                // Spanish teaching posts stay on top, correctly.
                //
                // ROOM IS DELIBERATELY UNCHANGED. Only the order moves. The
                // close matches were already being fetched, already collapsed,
                // already counted — nothing enters or leaves the page here, so
                // rawConsumed, nextOffset and hasMore keep describing exactly
                // what they described before. A version that let close matches
                // DISPLACE exact rows would have to answer where the displaced
                // rows go on page two, and this fix does not need to ask.
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
        // Appending close matches makes `total` stop describing this page: it
        // counts EXACT matches only, while the page now holds exact + close. The
        // header rendered that as "Showing 40 of 18" — a shown figure larger
        // than the total it is shown against, which is not a rounding problem
        // but a claim that cannot be true. Raising FUZZY_AUGMENT_BELOW from 5 to
        // 20 today widened the band this is reachable in, so it is partly mine.
        //
        // Rather than inventing a combined number (exact + close are not the same
        // kind of match and adding them would assert they are), the page reports
        // that it has no single honest total. countUnavailable already renders
        // "Showing N matching openings" with no total, and fuzzyExtra still tells
        // the client how many of the N are close matches.
        // Setting countUnavailable while STILL publishing total:18 is a payload
        // that contradicts itself: the frontend reads countUnavailable first and
        // renders no total, so a user is unaffected, but an API consumer reading
        // `total` sees a number the same response has just declared unknown.
        // Verified live on .10 — rows=60 alongside total=18. Null it.
        // SEMANTIC ON A THIN PAGE, NOT ONLY ON AN EMPTY ONE.
        //
        // The vector tier used to be reachable only when BOTH lexical tiers
        // returned nothing. A query landing three weak matches therefore got no
        // help at all, even though three results is the case where a searcher
        // most obviously wanted more — an empty page at least tells them to
        // rephrase. This is the same widening the trigram tier already got when
        // FUZZY_AUGMENT_BELOW went from 5 to 20.
        //
        // Retrieval is the SHARED helper, so the four properties that make the
        // vector tier safe — bounded, filter-safe, lexically anchored, anchored
        // on rows that survive the filters — hold here by construction rather
        // than by a second implementation agreeing with the first.
        //
        // APPENDED LAST, BELOW THE CLOSE MATCHES. The ordering rule this file
        // arrived at is that a title match beats a description-only match; a
        // MEANING match is weaker still, so it sits under both. Nothing is
        // displaced: exact rows keep their positions, and a version that let
        // meaning-matches push exact rows off the page would have to answer
        // where the displaced rows go on page two.
        //
        // BUDGET GATE. An embed is a model load on a cold isolate. Starting one
        // with two seconds left would spend the remaining request budget and
        // still miss, so the tier declines rather than making a thin page slow
        // as well as thin.
        if (
          semanticExtraOut === null &&
          pageTotal !== null && pageTotal > 0 && pageTotal < FUZZY_AUGMENT_BELOW &&
          offset === 0 && !countOnly && qText.length >= 3 &&
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
              const novelSem = (semSource as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
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
        logSearch("ranked", rankedGrouped.jobs.length, augmented ? null : total);
        // The count and the retriever do not always share a predicate — see
        // the note on `total` below. Computed once here so every field in this
        // response argues from the same row count.
        const shownRowCount = rankedGrouped.jobs.length;
        const totalUnderstated = !augmented && typeof total === "number" && (offset + shownRowCount) > total;
        return json({
          // attachRecheckedAt was MISSING here: the per-posting "re-checked N
          // minutes ago" receipt reached people who browsed and not people who
          // searched — the fourth thing today to be wired into the recency
          // path and skipped on the ranked one.
          jobs: preferMatchedLocation(await attachRecheckedAt(client, rankedGrouped.jobs, excludedTerms), locationTerms(body.location).terms),
          searchId,
          ...searchDisclosures(body, applied, maxAgeClamped),
          ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
          ...coverageDisclosure(applied, meta),
          ...honesty(rankedGrouped.jobs),
          ...(augmented ? { countUnavailable: true } : {}),
          nextOffset: offset + rankedGrouped.rawConsumed,
          // On a sorted search the window is finite and known, so "more" means
          // more rows LEFT IN IT — never the fetch-size heuristic, which would
          // promise a page four that cannot exist.
          // In the SQL regime "more" is the ordinary fetch-size heuristic: a
          // full page back from the RPC means there is another behind it, and a
          // short one is the true end of the match set (verified: "warehouse
          // associate" p_offset 3000 returns 0 rows, "loan officer" p_offset
          // 3000 returns 32 and then nothing).
          //
          // Below the seam it is "more rows left in the clamped window, OR the
          // match count says there is more behind the window". That second
          // clause is the other half of the defect: rankedSequence goes to zero
          // at the window edge while `total` is still advertising 1,417, and
          // reporting hasMore:false there is what ended the walk. It is gated on
          // deepPageable so sort=newest and the EMPLOYER/SIMPLE routes — whose
          // windows genuinely end at their edge — never promise a page that
          // would come back empty.
          hasMore: deepPage
            ? (rankedSequence.length > rankedGrouped.rawConsumed || rankedRows.length >= fetchLimit)
            : (newestFirst || scoreRanked)
            ? (rankedSequence.length > rankedGrouped.rawConsumed
              || (deepPageable && pageTotal !== null && offset + rankedGrouped.rawConsumed < pageTotal))
            : (rankedSequence.length > rankedGrouped.rawConsumed || rankedSequence.length >= fetchLimit),
          // null once close matches are appended: `total` counts EXACT matches,
          // and the page now holds exact + close, so it no longer describes what
          // is on screen. Leaving it in beside countUnavailable published a
          // payload that contradicted itself (rows=60, total=18).
          //
          // AND null WHENEVER THE PAGE ALREADY DISPROVES THE COUNT. The same
          // contradiction returned by another road: the counter asks the FTS
          // predicate while the retriever ALSO runs a prefix scan, so any
          // title the parser welded into one lexeme is served but never
          // counted. Measured live 2026-08-24: q=camarero published total 3
          // above 60 delivered rows, 57 of them titled "Camarero/a"
          // ("Camarero/a" indexes as a single lexeme, so the plain word cannot
          // count it); cocinero published 10 above 50. The rows were right —
          // recall is NOT the defect here, the arithmetic is.
          //
          // A number the page it labels already disproves cannot be repaired
          // by a better count; it can only be withdrawn. The floor is
          // publishable and true, and the client renders "60+".
          total: augmented || totalUnderstated ? null : total,
          ...(totalUnderstated ? { countUnavailable: true, totalAtLeast: offset + shownRowCount } : {}),
          // THE SECOND SEGMENT, PUBLISHED AS ITS OWN FIELD RATHER THAN FOLDED
          // INTO THE FIRST. Omitted — not zeroed — when the description segment
          // was not built, and omitted when it is EMPTY. An absent field is "we
          // did not look"; a zero is "we looked and there are none"; and a
          // segment header over an empty segment is neither. Suppressed under
          // augmentation for the same reason `total` is: once close matches are
          // appended, no published figure describes what is on screen.
          ...(augmented || related === null || related === 0
            ? {}
            : { relatedTotal: related, ...(relatedCapped ? { relatedCapped: true } : {}) }),
          ...(rankedCapped ? { countCapped: true } : {}),
          totalAllCompanies: safeMetaTotal ?? total,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
          companies: includeFacets0
            ? facetHead(fullCompanies0 as Array<{ token?: string; name?: string; count?: number }>)
                .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
            : [],
          companiesCount: fullCompanies0.length,
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
  // NO CATEGORY ORDERING HERE, AND THE ATTEMPT IS WORTH RECORDING.
  //
  // With the unsorted opt-in on, page one of `legal + country=DE` was entirely
  // `other` — the second bucket is 27x larger and date ordering does the rest,
  // so the field the person picked disappeared. The fix looked free: the result
  // set holds exactly two category values, so `.order("category", …)` puts the
  // chosen one first deterministically.
  //
  // It shipped and broke production. Ordering by category stops Postgres using
  // the date index, so the whole widened set has to be sorted:
  //
  //     sales + DE    + opt-in   500 after 17.5s (statement timeout)
  //     engineering   + opt-in   200 but 4.3s
  //     legal         + opt-in   200 but 1.6s     (normally ~0.3s)
  //
  // Only the largest combination actually 500s, which is why the first probe —
  // one narrow category — looked like a clean success. Reverted.
  //
  // The problem is real and unsolved: opting in still buries the chosen field.
  // A correct fix pages the two subsets SEPARATELY (chosen category first, then
  // `other`, each on its own date index) and stitches them with the offset
  // arithmetic, rather than asking the database to sort across both. That needs
  // care around count/hasMore and is not a one-liner — which is exactly why the
  // one-liner was tempting.
  // TWO SUBSETS, FETCHED SEPARATELY, ONLY ON THE OPT-IN PATH.
  //
  // Everything below is bypassed unless somebody chose a field AND opted into
  // the unsorted bucket, so ordinary browsing runs the exact query it always
  // did. That containment is deliberate: this is the second attempt at the
  // problem and the first one reached production.
  const twoSubset = !!applied.category && applied.includeUncategorised;
  // THE SIZE THIS REQUEST ACTUALLY FETCHES, which is not always fetchLimit.
  //
  // The two-subset pager caps its own fetch at `limit` so the two category
  // queries stay bounded, while hasMore asked whether the page came back equal
  // to fetchLimit — 3x limit when grouping is on. That comparison can never be
  // true on this path, so Load More died on page ONE. Measured live:
  //   category=engineering                        50 rows, hasMore TRUE
  //   category=engineering + includeUncategorised 48 rows, hasMore FALSE
  // both under a total of 10,000. Opting in to see uncategorised jobs cost the
  // visitor every page after the first.
  const twoSubsetLimit = Math.min(fetchLimit, limit);
  const fetchUsed = twoSubset ? twoSubsetLimit : fetchLimit;

  // deno-lint-ignore no-explicit-any
  // "NEWEST" MEANT "MOST RECENTLY CRAWLED", WHICH IS NOT WHAT ANYONE ASKS FOR.
  //
  // dateCol is effective_posted = coalesce(posted_at, first_seen), so a posting
  // with no company-stated date takes our crawl time and sorts to the very top.
  // MEASURED on the live board: 57 of 60 rows on sort=newest had postedAt=null,
  // 95% of the page. The 10% of the corpus with no date was crowding out the
  // 540,437 postings that DO carry one.
  //
  // Ordering on posted_at with nulls last is both honest and CHEAPER — measured
  // at concurrency 4: posted_at 0.20-0.37s against effective_posted 1.03-1.23s,
  // five times faster, because it uses a plain column instead of a coalesce.
  //
  // The freshness WINDOW still uses effective_posted. That is deliberate: an
  // undated posting should still be served, it just should not claim to be the
  // newest thing on the board.
  const ordered = (q: any, dateCol: string, salaryCol: string) =>
    (sortSalary
      ? q.order(salaryCol, { ascending: false, nullsFirst: false })
      : newestFirst
        ? q.order("posted_at", { ascending: false, nullsFirst: false })
        : q.order(dateCol, { ascending: false, nullsFirst: false })
    ).order("id", { ascending: true });

  // THE QUERY THAT FETCHES THE ROWS THE READER SEES, AND IT WAS NEVER MARKED.
  //
  // Deployed 2026-08-25.12 and measured: every rescue tier is fast —
  // simple_config 146-188ms, semantic 166-455ms, head_ring 122-245ms,
  // embed_query 95-98ms, fuzzy 133-264ms — and count_jobs_capped is bounded at
  // its 1.5s deadline. Yet q=camarero limit=20 still took 5.7-8.2s with
  // 3.2-5.5s unaccounted, and q=zzzqqq 6.3-13.3s with 2.6-9.3s unaccounted.
  //
  // So the rescue ladder was never the cost. I concluded twice that it was —
  // once from the count, once from the tier deadlines summing — and the marks
  // I added to settle the question refute both. What the instrument never
  // covered is this function: three call sites, every one of them an awaited
  // buildQuery, none of them timed.
  //
  // A wrapper rather than marks at each site, so a fourth call site cannot be
  // added untimed.
  const pageWith = async (dateCol: string, salaryCol: string, withCount: boolean) => {
    const t0 = Date.now();
    try { return await pageWithInner(dateCol, salaryCol, withCount); }
    finally { markFrom("page_query", t0); }
  };
  const pageWithInner = async (dateCol: string, salaryCol: string, withCount: boolean) => {
    if (!twoSubset) {
      // Keyset: WHERE ep < X OR (ep = X AND id > Y) — the exact successor set
      // of the ORDER BY (ep DESC, id ASC). Only on the date sort: the salary
      // sort orders by a different column and keeps offset until it needs its
      // own cursor.
      // The keyset cursor is written in terms of dateCol, so it cannot describe
      // a posted_at ordering — pairing them would page through one order using
      // another's coordinates, which is the exact defect that made sorted page
      // two repeat page one.
      if (cursor && !sortSalary && !newestFirst) {
        return await ordered(buildQuery(dateCol, withCount), dateCol, salaryCol)
          .or(`${dateCol}.lt."${cursor.ep}",and(${dateCol}.eq."${cursor.ep}",id.gt."${cursor.id}")`)
          .limit(fetchLimit);
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

  // Page and count run CONCURRENTLY and independently: the page never waits on
  // a count, and a count that fails can't take the page down with it. The page
  // is consistently ~0.3s; it was the exact count riding the same query that
  // made broad filters take 3-9s.
  // The count gets a HARD deadline. Running it concurrently was never enough:
  // Promise.all still waits, so a slow count holds the entire response and then
  // takes it down with it — measured HTTP 500 at 35-79s on 24 of ~40 searches,
  // and 20-29s with total:null on 3 of 4 broad queries under sort=newest, while
  // the page half is consistently ~0.3s.
  //
  // A missing total is a small, honest degradation the client already handles
  // (countUnavailable -> "Showing N" without a denominator). A 46-second wait
  // ending in 500 is not. 4s is chosen above the measured p95 for counts that
  // DO succeed (~1-3s) and far below the ceiling where they stop being useful.
  // 4s was chosen when nobody could see what the count actually cost. Now we
  // can: measured 2026-08-25 with per-RPC timings on the live board,
  // count_jobs_capped is the dominant phase of a text search — 817-870ms for
  // q=nurse and 2,336ms for q=camarero, which is 70% of that request — while
  // search_jobs, the call that actually produces the rows, is ~300ms. It
  // already runs in parallel with the page fetch, so it is not sequencing that
  // hurts; the count is simply the critical path.
  //
  // And on q=camarero the board waited those 2.3 seconds for a number it then
  // WITHDREW, because the page held more rows than the count claimed (the
  // slash-title case fixed earlier today). Paying two seconds of every
  // searcher's time for a figure that is often a bare ceiling ("10,000+") and
  // occasionally untrue is the wrong trade.
  //
  // 1.5s keeps every count that lands inside the measured normal range and
  // drops the tail. The degradation is one the client already renders well:
  // countUnavailable becomes "Showing 60 of 60+ matching openings" rather than
  // a blank, since the floor shipped this week. Rows are never delayed by it.
  const COUNT_DEADLINE_MS = 1_500;
  // A DEADLINE THAT ESCALATES IS NOT A DEADLINE.
  //
  // withDeadline resolves { data: null } for a timeout, an error AND a missing
  // RPC alike, and the code below read that single sentinel as "the migration
  // has not applied yet" — then fell back to the UNBOUNDED inline exact count,
  // the very query the capped RPC exists to replace, while throwing away the
  // page it had already fetched.
  //
  // So missing the 1.5s deadline made the request dramatically slower, not
  // faster. Reproduced live on an ordinary two-filter browse:
  //   healthy run   count 210ms   page 139ms   tookMs 359
  //   race lost     count 1503ms  page 3755ms  tookMs 5448   (settle: 1693ms)
  // The count was 190ms from landing. Losing it by that margin cost 5 seconds.
  //
  // Tracked separately now: `timedOut` is the timeout, `null` after settling is
  // the genuinely-missing RPC. Only the second may escalate.
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
  // Last resort before failing the board: if the query still errored AND we
  // asked for an exact count, re-run the identical page with the count OFF.
  // The count is the expensive half (0.3s page vs 3.2s+ count), so this turns
  // a 500 into a served page with an honest "we don't know the total".
  // countUnavailable tells the client to stop trusting `total` rather than
  // render a wrong number, and hasMore keeps pagination working without it.
  // Seeded from the raced deadline, and this is load-bearing. Downstream,
  // `total` is published as `countUnavailable ? null : (count ?? 0)` — so a
  // null count with this flag still false publishes ZERO, which the comment on
  // that line already warns "would read as no matches and trip the zero-state
  // on a page that is visibly full of results". Not escalating on a timeout is
  // only safe because the timeout is declared here.
  let countUnavailable = countTimedOut;
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
    ? facetHead(fullCompanies as Array<{ token?: string; name?: string; count?: number }>)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    : [];
  const mappedRows = (data ?? []).map(rowToJob) as Array<Record<string, unknown>>;
  // The raw, in-order rows the collapse walked. After a top-up this spans BOTH
  // fetches, and it is what nextOffset and nextCursor must be derived from —
  // reading them off the first fetch alone would send the next page back over
  // rows this one already served.
  let rawSequence = mappedRows;
  // THE KEYSET LIVES ON THE RAW ROW, AND rowToJob DOES NOT CARRY IT.
  //
  // Both keyset readers below took (effective_posted, id) off `mappedRows`,
  // which is `data.map(rowToJob)` — a mapper that emits 21 camelCase fields and
  // no `effective_posted` at all. So both read `undefined`, every single time:
  //   * nextCursor was null on EVERY response since the keyset shipped
  //     (2026-08-17, "Load more showed the same job twice"). Every client fell
  //     back to offset paging and the duplicates the commit was written to kill
  //     came straight back — measured 2026-08-22, 6 pages of 20 on the default
  //     feed: 0%, 0%, 5.0% repeats across three trials.
  //   * the grouping top-up below is gated on `lastRaw?.effective_posted`, so
  //     it has NEVER ONCE RUN. Pages starved by clustering were served short.
  // A fix that reads a field the row does not have is not a fix; it is the same
  // outage with a passing build. These keys are kept out of the response on
  // purpose — effective_posted coalesces first_seen, which is our DISCOVERY
  // time and must never reach a client that could read it as a posting date.
  let rawKeys = (data ?? []) as Array<{ effective_posted?: string; id?: string }>;
  let grouped = groupSimilar
    ? collapseClusters(mappedRows, limit)
    : { jobs: mappedRows.slice(0, limit), rawConsumed: Math.min(mappedRows.length, limit) };

  // ONE TOP-UP WHEN CLUSTERING ATE THE WHOLE BUFFER.
  //
  // MEASURED 2026-08-20, and the signature is exact — nextOffset === fetchLimit
  // on every case, meaning all 180 raw rows were consumed and still did not
  // yield a full page:
  //     "retail sales"       39 cards under a total of 3,437
  //     "customer service"   42 cards under a total of 9,846
  //     "physical therapist" 55 cards under a total of 2,675
  // A visitor sees a third of a page under a headline promising thousands, and
  // the page simply looks broken. The 3x over-fetch is a guess about how much
  // clustering will fold, and on searches where one employer posts the same
  // title in dozens of towns the guess is wrong.
  //
  // Bounded to a SINGLE extra round trip, deliberately. Looping until the page
  // fills would turn a heavy search into an unbounded fan of queries — the
  // exact shape that took the board down two days ago. One top-up converts the
  // common case (a third of a page) into a full or nearly-full one; the rare
  // residue is honest and cheap.
  //
  // Only on the plain date-sorted path: the ranked, two-subset and salary paths
  // have their own offset arithmetic, and a top-up that ignored it would move
  // rows across a page boundary the cursor does not know about.
  if (
    groupSimilar && !twoSubset && !sortSalary && !countOnly &&
    grouped.jobs.length < limit &&
    mappedRows.length >= fetchLimit          // the buffer was exhausted, not just short
  ) {
    const lastRaw = rawKeys[rawKeys.length - 1];
    if (lastRaw?.effective_posted && lastRaw?.id) {
      try {
        // Keyset-anchored, exactly like page 2: start strictly after the last
        // raw row this page read, so the top-up cannot repeat or skip.
        const topUp = await ordered(
          buildQuery("effective_posted", false).or(
            `effective_posted.lt."${lastRaw.effective_posted}",and(effective_posted.eq."${lastRaw.effective_posted}",id.gt."${lastRaw.id}")`,
          ),
          "effective_posted",
          "salary_rank_usd",
        ).limit(fetchLimit);
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
  // Interleave the RETURNED page only, never the pre-slice buffer.
  //
  // The first version of this ran before the cut, which read as the careful
  // choice — cap what the user actually sees rather than an already-truncated
  // slice. It was wrong, and a filter audit caught it: nextOffset advances in
  // DB order (grouped.rawConsumed), so permuting the buffer BEFORE the cut
  // moves rows across the page boundary that the cursor knows nothing about.
  // Measured on a frozen snapshot: 1-2 postings duplicated onto page 2 and 1
  // silently dropped FOREVER per boundary, where the control run scored 0/0.
  // A cosmetic variety tweak was quietly costing users jobs.
  //
  // Permuting only the emitted array is a pure reordering of rows already
  // committed to this page: rawConsumed is untouched, so no row can be skipped
  // or repeated. Runs spanning a boundary are no longer capped — that is the
  // honest trade, and it is worth strictly less than never losing a posting.
  //
  // Salary sort is EXEMPT, and the previous comment claimed that while the code
  // did the opposite: it ties on money, not on ingest batch, so reordering
  // there produced 8 inversions in 59 adjacent pairs, up to $70k out of order,
  // directly contradicting "highest stated pay first".
  if (!sortSalary) grouped.jobs = interleaveByCompany(grouped.jobs);
  // Self-check EVERY page against the filters we just told the caller we applied.
  //
  // The rows are already in memory, so this costs one pass over at most 60
  // objects and no query — cheap enough to run on every request rather than in
  // a nightly job that discovers yesterday's breakage tomorrow.
  //
  // This is the check the unit suite could not be: 1,010 tests were green while
  // production returned country=null on every row, because the test asserted
  // that rowToJob emits `country` and never that the SELECT fetches it. It
  // proved the last link of the chain and nothing about the first. A predicate
  // evaluated against the bytes actually being returned cannot be fooled that
  // way — if the column stops arriving, or a filter silently stops binding,
  // the very next request says so.
  //
  // It reports rather than throws: a caller with a full page of usable results
  // should not get a 500 because a badge field regressed. The count is surfaced
  // in the response so the property is externally testable, and logged so it is
  // visible without a client.
  // The RECENCY path, logged last and named explicitly because it is the one
  // that has been forgotten five times in two days — filler stripping,
  // clustering, metro aliases, attachRecheckedAt and the disclosures each
  // shipped to one path and silently skipped the others. A telemetry table
  // missing this path would under-count every browse and quietly bias the
  // denominator toward searchers.
  logSearch("recency", grouped.jobs.length, countUnavailable ? null : (wantCount ? (count ?? 0) : safeMetaTotal));
  return json({
    jobs: preferMatchedLocation(await attachRecheckedAt(client, grouped.jobs, excludedTerms), locationTerms(body.location).terms),
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
    // The keyset successor: (effective_posted, id) of the last RAW row this
    // page consumed — from `data`, never from grouped.jobs, because grouping
    // folds clusters and its last visible card is not the last row read.
    // Null on the paths that still page by offset.
    // Present ONLY when the ranked path threw and this response is the
    // fallback. Its absence is the healthy state, so nothing is published on a
    // normal search; when it IS present, one curl says which error demoted the
    // search instead of leaving it to look like an empty catalog.
    ...(rankedFellBack ? { rankedFellBack } : {}),
    ...(semanticDegraded ? { semanticDegraded } : {}),
    nextCursor: (() => {
      if (twoSubset || sortSalary) return null;
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
    totalAllCompanies: safeMetaTotal ?? count ?? 0,
    ...(trackedTotal !== null ? { trackedTotal } : {}),
    companies: servedCompanies,
    companiesCount: fullCompanies.length,
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

