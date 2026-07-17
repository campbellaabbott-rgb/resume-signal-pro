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
import {
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
  normalizeRippling,
  extractRipplingJobPosts,
  normalizeWorkday,
  detectCountry,
  type JobPosting,
} from "./normalize.ts";
import { categorize, CATEGORIZE_VERSION, JOB_CATEGORIES } from "./categories.ts";
import { computeFit } from "../_shared/fit-score.ts";
import { extractSalary, parseSalaryStructured } from "../_shared/salary-extract.ts";
import { classifyDormancy, updateBoardFailures, type BoardFailureState } from "./dormancy.ts";
import { CANARIES, rawItemCount, aggregateVendorHealth, type CanaryResult } from "./vendor-canary.ts";
import { detectExperience, isExperienceBand } from "./experience.ts";
import { classifyQuestion } from "../_shared/application-questions.ts";

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
const BUILD_VERSION = "2026-07-16.7";

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
// Slice sizes are calibrated to the per-invocation compute budget. Hot
// slices are UNIFORMLY giant boards (that's what makes them hot), so they
// must be much smaller than the old mixed slices: the first tiered deploy
// died mid-slice at HOT=30 (one upsert chunk of carvana landed, then the
// worker hit the ceiling and the cron retried the same slice forever).
const HOT_SLICE = 10;
const COLD_SLICE = 80; // cold boards are small (that's why they're cold); 80/hop at CONCURRENCY=8 is 10 sequential rounds — well under the edge wall-time limit. Rotation speed comes from concurrency + hops-per-pass, never bigger slices (proven-safe size).
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

const listUrl = (s: JobSource) =>
  s.source === "greenhouse"
    // content=true costs a bigger payload but delivers every description in
    // ONE call — fit-ranking coverage for GH boards, plus real departments.
    ? `https://boards-api.greenhouse.io/v1/boards/${s.token}/jobs${isLight(s.token) ? "" : "?content=true"}`
    : s.source === "lever"
      ? `https://api.lever.co/v0/postings/${s.token}?mode=json`
      : s.source === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${s.token}?includeCompensation=true`
        : s.source === "smartrecruiters"
          ? `https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100`
          : s.source === "workable"
            ? `https://apply.workable.com/api/v1/widget/accounts/${s.token}?details=false`
            : s.source === "recruitee"
              ? `https://${s.token}.recruitee.com/api/offers/`
              : s.source === "breezy"
                ? `https://${s.token}.breezy.hr/json`
                : s.source === "teamtailor"
                  ? `https://${s.token}.teamtailor.com/jobs.rss`
                  : `https://${s.token}.bamboohr.com/careers/list`;

// SmartRecruiters paginates 100/page. With ~1,000 SR boards now in the pool, an
// unbounded cap could let one giant board's pagination wedge a cold hop under
// the edge wall-time limit. Bound it so no single board costs more than ~8
// sequential pages — the vast majority of boards hold fewer than this, and the
// 30-day freshness cap discards most of a mega-board's inventory anyway. Big
// boards still get full coverage once the self-tuning hot tier promotes them
// (fetched alone in small hot slices).
const SR_CAP = 800;
async function fetchSmartRecruiters(s: JobSource): Promise<{ content: unknown[] }> {
  const first = await fetchWithTimeout(listUrl(s));
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  const page1 = await first.json();
  const total = Math.min(Number(page1.totalFound) || 0, SR_CAP);
  const content: unknown[] = [...(page1.content ?? [])];
  for (let offset = 100; offset < total; offset += 100) {
    const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100&offset=${offset}`);
    if (!res.ok) break; // partial page set is fine — prune guard keys off success of THIS board overall
    const page = await res.json();
    content.push(...(page.content ?? []));
  }
  return { content };
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
  for (const host of ["jobs.personio.de", "jobs.personio.com"]) {
    try {
      const res = await fetchWithTimeout(`https://${s.token}.${host}/xml`);
      if (res.ok) {
        const xml = await res.text();
        if (xml.includes("<position")) return { xml, host };
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
async function fetchRippling(s: JobSource): Promise<{ items: unknown[]; raw: string }> {
  const first = await fetchWithTimeout(`https://ats.rippling.com/${s.token}/jobs`);
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  const html = await first.text();
  const page0 = extractRipplingJobPosts(html);
  if (!page0) throw new Error("rippling payload shape unrecognized");
  const items = [...page0.items];
  const pages = Math.min(page0.totalPages, RIPPLING_PAGE_CAP);
  for (let p = 1; p < pages; p++) {
    const res = await fetchWithTimeout(`https://ats.rippling.com/${s.token}/jobs?page=${p}`);
    if (!res.ok) break;
    const more = extractRipplingJobPosts(await res.text());
    if (!more || more.items.length === 0) break;
    items.push(...more.items);
  }
  return { items, raw: html };
}

// Workday CXS: POST-paginated first-party list endpoint. Compound token
// tenant~dc~site. Bounded to WORKDAY_PAGE_CAP pages (enterprise tenants can
// hold thousands; the cap keeps one board's fetch from monopolizing a slice —
// the rest rotate in on later passes, and the freshness filter drops the aged
// tail regardless). Undated, description-less (list-only), like BambooHR.
const WORKDAY_PAGE_CAP = 25; // 25 × 20 = up to 500 postings/board/pass
async function fetchWorkday(s: JobSource): Promise<{ jobPostings: unknown[]; raw: unknown }> {
  const [tenant, dc, site] = s.token.split("~");
  if (!tenant || !dc || !site) throw new Error("bad workday token");
  const url = `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const all: unknown[] = [];
  for (let page = 0; page < WORKDAY_PAGE_CAP; page++) {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ limit: 20, offset: page * 20, searchText: "", appliedFacets: {} }),
    });
    if (!res.ok) { if (page === 0) throw new Error(`HTTP ${res.status}`); break; }
    const body = await res.json();
    const items = Array.isArray((body as { jobPostings?: unknown[] }).jobPostings) ? (body as { jobPostings: unknown[] }).jobPostings : [];
    all.push(...items);
    if (items.length < 20) break; // last page
  }
  return { jobPostings: all, raw: { jobPostings: all } };
}

async function fetchBoard(s: JobSource): Promise<{ jobs: JobPosting[]; raw: unknown } | null> {
  try {
    if (s.source === "rippling") {
      const { items, raw } = await fetchRippling(s);
      return { jobs: normalizeRippling(items as never, s.name, s.token), raw };
    }
    if (s.source === "workday") {
      const { jobPostings, raw } = await fetchWorkday(s);
      return { jobs: normalizeWorkday(jobPostings as never, s.name, s.token), raw };
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
    const raw = s.source === "smartrecruiters" ? await fetchSmartRecruiters(s) : await (async () => {
      const res = await fetchWithTimeout(listUrl(s));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    return { jobs, raw };
  } catch (e) {
    console.warn(`[JOB-BOARD] board ${s.source}:${s.token} failed:`, String(e).slice(0, 100));
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
// 80×48 = 3,840 cold boards/pass: at the 14.9k-board catalog (rung 3) the
// tail rotates in ~3.9 passes, and doubling cold hops per pass halves how
// often the ~10-min hot phase interrupts the tail. Combined with CONCURRENCY
// 4→8 this targets a measured full-tail rotation under ~2h (it had drifted
// to ~3h, past the published claim). Slice size stays the proven-safe 80 —
// more hops, never bigger hops. SR_CAP still bounds any single board's fetch.
const COLD_SLICES_PER_PASS = 48;

// Dormancy skip-list (throughput): a feed dead for DEAD_BOARD_THRESHOLD straight
// rotations has its postings pruned and is marked dormant — future cold slices
// SKIP fetching it (a dead feed would otherwise burn the full FETCH_TIMEOUT every
// rotation for nothing) and only recheck it once per DORMANT_RECHECK_MS so a feed
// that comes back rejoins on its own. The board stays in COLD_LIST, so the
// rotation cursor and sweep coverage are untouched — only the wasted fetch is
// removed. DORMANT_CAP bounds the meta row against a mass die-off.
const DEAD_BOARD_THRESHOLD = 6; // consecutive failures before prune + dormancy (unchanged bar from the prior prune)
const DORMANT_RECHECK_MS = 12 * 60 * 60_000; // recovery probe cadence for a dormant board
const DORMANT_CAP = 3_000; // max tracked dormant boards (keeps most-recently-detected)

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
const SALARY_PARSE_VERSION = 4; // v4: $-variant currencies (MX$/R$/HK$/S$/NZ$) + parity monthly cap — full re-parse corrects mislabeled rows
const COUNTRY_VERSION = 1; // v1: deterministic country from location text (names + US/CA state patterns)
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
const CORPUS_CEILING = 500_000; // arm eviction above this
const CORPUS_TARGET = 480_000;  // evict down to this

// Freshness cap: the board shows only roles posted within this window. Dated
// postings past it are dropped at ingestion (never stored) and swept from the
// stored corpus each pass; the id-diff prune then keeps them out for good.
// Nearly 100% of feed postings carry a real date, so this is churn-free — a
// dropped dated posting can't re-enter. One constant to dial (30d ≈ 31k live
// board, 45d ≈ 43k, 60d ≈ 50k on the current selection).
const FRESH_WINDOW_DAYS = 30;
const FRESH_PRUNE_MAX = 6_000; // cap the aged-tail sweep per pass so a big backlog drains without a giant delete

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

function chainNextSlice(hop: number) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
  waitUntil(chainKey().then((key) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "refresh", force: true, chain: hop + 1, chainKey: key }),
  })).then((r) => r.text()).catch(() => {}));
}

// Two-tier refresh: HOT boards (heavy inventory) re-verify on every chain
// pass (~10 min); the long tail rotates through cold slices across passes
// (full rotation bounded by tail size / slices-per-pass). Facets come from
// the get_job_board_facets() RPC at pass end — always DB-true, no
// accumulator bookkeeping.
async function runRefresh(client: SupabaseClient, force = false, chainHop = 0): Promise<{ ok: boolean; detail: string }> {
  const { data: prog } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle();
  if (!force && prog && Date.now() - new Date(prog.updated_at).getTime() < SLICE_LOCK_MS) {
    return { ok: true, detail: "skipped — a slice ran moments ago" };
  }
  const { hotList: HOT_LIST, coldList: COLD_LIST } = await tierLists(client);
  await loadDynamicLight(client); // auto-enrolled giant boards fetch without content
  const pv = (prog?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[] };
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
  const slice = [...demandBoards, ...baseSlice];
  const startIso = new Date().toISOString();
  const freshCutoffMs = Date.now() - FRESH_WINDOW_DAYS * 86_400_000; // roles older than this are dropped

  // Board-failure state (streaks + dormancy) drives both the consecutive-failure
  // prune and the dormancy skip-list. Read once here so hot and cold hops share a
  // single read/write, and so cold slices know which dead boards to skip BEFORE
  // fetching. Demand-injected boards are never skipped (a user just opened them).
  const { data: bfMeta } = await client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle();
  const bfV = (bfMeta?.v ?? {}) as Partial<BoardFailureState>;
  const boardFailures: BoardFailureState = { streaks: { ...(bfV.streaks ?? {}) }, dormant: { ...(bfV.dormant ?? {}) } };

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

  // Cursors advance BEFORE processing (optimistic): if this invocation dies
  // on the resource ceiling, the next attempt continues with the NEXT
  // slice — a died slice's boards go one rotation stale instead of wedging
  // the whole pipeline. Failure accounting is finalized after the slice.
  {
    const nextHot = inHotPhase ? hot + HOT_SLICE : hot;
    // Advance by the COLD_LIST boards actually consumed (baseSlice) — NOT
    // slice.length, which includes prepended demand boards. Counting the demand
    // extras would skip that many cold boards each demand-injected hop, so the
    // long tail would rotate unevenly (some boards re-checked late).
    const nextCold = inHotPhase ? cold : (cold + baseSlice.length) % Math.max(1, COLD_LIST.length);
    const nextColdDone = inHotPhase ? coldDone : coldDone + 1;
    await client.from("job_board_meta").upsert(
      { k: "refresh_progress", v: { hot: nextHot, cold: nextCold, coldDone: nextColdDone, failedAcc: Array.isArray(pv.failedAcc) ? pv.failedAcc : [] }, updated_at: new Date().toISOString() },
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
        const r = await fetchBoard(s);
        if (!r) {
          failed.push(s.name);
          continue;
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
            if (text) descs.set(`lever:${s.token}:${j.id}`, text.slice(0, 4000));
          }
        } else if (s.source === "ashby") {
          for (const j of ((r.raw as { jobs?: Array<{ id: string; descriptionPlain?: string; descriptionHtml?: string }> }).jobs ?? [])) {
            const text = (j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : "")).trim();
            if (text) descs.set(`ashby:${s.token}:${j.id}`, text.slice(0, 4000));
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
              const text = j.content ? htmlToText(String(j.content).slice(0, 12000)).trim() : "";
              if (text) descs.set(`greenhouse:${s.token}:${j.id}`, text.slice(0, 4000));
            }
          }
        } else if (s.source === "recruitee") {
          for (const o of ((r.raw as { offers?: Array<{ id: string | number; description?: string; requirements?: string }> }).offers ?? [])) {
            const text = htmlToText([o.description, o.requirements].filter(Boolean).join("\n").slice(0, 12000)).trim();
            if (text) descs.set(`recruitee:${s.token}:${o.id}`, text.slice(0, 4000));
          }
        } else if (s.source === "breezy") {
          for (const p of ((Array.isArray(r.raw) ? r.raw : []) as Array<{ id?: string; friendly_id?: string; description?: string }>)) {
            const externalId = p.friendly_id || p.id || "";
            const text = p.description ? htmlToText(String(p.description).slice(0, 12000)).trim() : "";
            if (externalId && text) descs.set(`breezy:${s.token}:${externalId}`, text.slice(0, 4000));
          }
        } else if (s.source === "personio" && typeof r.raw === "string") {
          for (const block of xmlBlocks(r.raw, "position")) {
            const pid = xmlValue(block, "id");
            const text = htmlToText(xmlBlocks(block, "jobDescription").map((d) => xmlValue(d, "value") ?? "").join("\n").slice(0, 12000)).trim();
            if (pid && text) descs.set(`personio:${s.token}:${pid}`, text.slice(0, 4000));
          }
        } else if (s.source === "teamtailor" && typeof r.raw === "string") {
          for (const item of xmlBlocks(r.raw, "item")) {
            const link = xmlValue(item, "link") ?? "";
            const idMatch = link.match(/\/jobs\/(\d+)/);
            const text = htmlToText((xmlValue(item, "description") ?? "").slice(0, 12000)).trim();
            if (idMatch && text) descs.set(`teamtailor:${s.token}:${idMatch[1]}`, text.slice(0, 4000));
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
              const p = parseSalaryStructured(salaryText);
              return { salary_min_annual: p?.annualMin ?? null, salary_currency: p?.currency ?? null };
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
        const existingRows: Array<{ id: string; missing_since: string | null }> = [];
        let missingColUnknown = false; // pre-migration: column absent → legacy single-pass behavior
        for (let from = 0; ; from += 1000) {
          let res = await client
            .from("job_board_postings")
            .select("id,missing_since")
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
          existingRows.push(...((page ?? []) as Array<{ id: string; missing_since?: string | null }>).map((r) => ({ id: r.id, missing_since: r.missing_since ?? null })));
          if (!page || page.length < 1000) break;
        }
        if (!boardOk) {
          failed.push(s.name);
          continue;
        }
        const prefix = `${s.source}:`;
        const missingSinceById = new Map(existingRows.filter((r) => r.id.startsWith(prefix)).map((r) => [r.id, r.missing_since]));
        const existing = new Set(missingSinceById.keys());
        const liveIds = new Set(rowsById.keys());
        const newRows = rows.filter((r) => !existing.has(r.id as string));
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
          vanished = [];
          for (const id of vanishedAll) {
            if (agedOutIds.has(id)) { vanished.push(id); continue; } // freshness cap — no grace, no log
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
          failed.push(s.name);
          continue;
        }
        // Log closures BEFORE deleting: the live table hard-deletes, so this is
        // the only record these roles were ever open — it powers per-company
        // hiring-health. Best-effort per chunk: the prune (and board freshness)
        // must never be blocked by the history write, so a failed log still deletes.
        //
        // Accuracy guards — a "closure" must mean the company took the role down:
        //  (a) truncated fetches log NOTHING: an SR board at the SR_CAP ceiling has
        //      postings displaced past the cap "vanish" while still live;
        //  (b) age-outs are skipped: a posting crossing the 30-day freshness window
        //      is dropped at ingest and lands in `vanished` — we removed it, nobody
        //      filled it;
        //  (c) a closure whose exact title is still live at the same company is
        //      marked superseded (repost/relisting churn, not a fill) and excluded
        //      from hiring-health stats.
        const truncatedFetch = s.source === "smartrecruiters" && rowsById.size >= SR_CAP;
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
              const rows = ((toLog ?? []) as Array<Record<string, unknown>>).filter((r) => {
                const posted = r.posted_at ? new Date(String(r.posted_at)).getTime() : NaN;
                if (Number.isFinite(posted) && posted < freshCutoffMs) return false; // (b) aged out, not closed
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
              }
            } catch (e) {
              console.warn(`[JOB-BOARD] closure log failed for ${s.token} (non-fatal):`, String(e).slice(0, 150));
            }
            await client.from("job_board_postings").delete().in("id", chunk);
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
          const { error: stampErr } = await client.from("job_board_verifications").upsert(
            { company_token: s.token, verified_at: new Date().toISOString() },
            { onConflict: "company_token" },
          );
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

  // Advance cursors. Cold advances by the ACTUAL slice length — the tail
  // slice is short, and advancing by a full COLD_SLICE would skip the boards
  // just past the wrap point on every rotation.
  if (inHotPhase) hot += HOT_SLICE;
  else {
    const before = cold;
    cold = (cold + slice.length) % Math.max(1, COLD_LIST.length);
    coldDone += 1;
    // The cold cursor just wrapped past the end → the ENTIRE cold tail has
    // now been re-verified. Stamp it: this is the direct measurement of
    // freshness (max staleness of any cold posting = time since this stamp).
    // The heartbeat alerts if it ever falls behind the SLA.
    if (cold < before) {
      await client.from("job_board_meta").upsert(
        { k: "cold_rotation", v: { completedAt: new Date().toISOString(), coldBoards: COLD_LIST.length }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
    }
  }
  const passDone = hot >= HOT_LIST.length && coldDone >= COLD_SLICES_PER_PASS;

  const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);
  await client.from("job_board_meta").upsert(
    { k: "refresh_progress", v: { hot, cold, coldDone, failedAcc }, updated_at: new Date().toISOString() },
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
      const { streaks, dormant, toPrune } = updateBoardFailures({
        okTokens,
        failedTokens,
        recheckTokens,
        streaks: boardFailures.streaks,
        dormant: boardFailures.dormant,
        deadThreshold: DEAD_BOARD_THRESHOLD,
        dormantCap: DORMANT_CAP,
        now: Date.now(),
      });
      for (const tk of toPrune) {
        await client.from("job_board_postings").delete().eq("company_token", tk);
        console.warn(`[JOB-BOARD] board ${tk} dormant after ${DEAD_BOARD_THRESHOLD} consecutive failures (postings pruned; fetch skipped until recheck)`);
      }
      await client.from("job_board_meta").upsert({ k: "board_failures", v: { streaks, dormant }, updated_at: new Date().toISOString() }, { onConflict: "k" });
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
    // Facets from the database — always true to what the board serves. If
    // the RPC isn't migrated yet (function published before migration ran),
    // keep the previous meta instead of clobbering it with zeros.
    const { data: facets, error: facetsErr } = await client.rpc("get_job_board_facets");
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
        for (const tk of orphanTokens) {
          await client.from("job_board_postings").delete().eq("company_token", tk);
        }
        console.log(`[JOB-BOARD] orphan-pruned ${orphanTokens.length} removed board(s): ${orphanTokens.slice(0, 8).join(", ")}`);
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
      let dropped = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await client.from("job_board_postings").delete().in("id", ids.slice(i, i + 200));
        if (error) { console.warn("[JOB-BOARD] freshness sweep delete error:", error.message); break; }
        dropped += Math.min(200, ids.length - i);
      }
      if (dropped > 0) console.log(`[JOB-BOARD] freshness cap: dropped ${dropped} postings older than ${FRESH_WINDOW_DAYS}d`);
    }

    // Capacity governor (see CORPUS_CEILING). Accurate post-prune count — this
    // gates a destructive op, so don't reuse the orphan-inflated facet total.
    const { count: corpusSize } = await client.from("job_board_postings").select("id", { count: "exact", head: true });
    if ((corpusSize ?? 0) > CORPUS_CEILING) {
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
        { k: "capacity", v: { at: nowIso, corpusBefore: corpusSize, ceiling: CORPUS_CEILING, target: CORPUS_TARGET, evicted, active: true }, updated_at: nowIso },
        { onConflict: "k" },
      );
      console.warn(`[JOB-BOARD] capacity governor: corpus ${corpusSize} > ${CORPUS_CEILING} — evicted ${evicted} stalest postings toward ${CORPUS_TARGET}`);
    } else {
      // Record headroom each pass so the heartbeat can watch the corpus trend
      // toward the ceiling before it ever binds.
      await client.from("job_board_meta").upsert(
        { k: "capacity", v: { at: nowIso, corpus: corpusSize ?? 0, ceiling: CORPUS_CEILING, headroom: CORPUS_CEILING - (corpusSize ?? 0), evicted: 0, active: false }, updated_at: nowIso },
        { onConflict: "k" },
      );
    }

    const v = {
      total: f.total, // includes just-pruned orphans until the next pass recomputes — harmless
      boards: companies.length,
      failedSources: failedAcc,
      companiesFacet: companies,
      categoriesFacet: f.categoriesFacet ?? {},
      refreshedAt: startIso,
    };
    await client.from("job_board_meta").upsert({ k: "refresh", v, updated_at: new Date().toISOString() }, { onConflict: "k" });
    // Re-rank the hot tier from what the corpus actually holds now.
    const ranked = [...companies]
      .filter((c): c is { token: string; count: number } => typeof (c as { token?: unknown }).token === "string" && typeof (c as { count?: unknown }).count === "number")
      .sort((a, b) => b.count - a.count)
      .slice(0, HOT_SIZE)
      .map((c) => c.token);
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
    // One-time name sync: ~48 rung-3 census names shipped HTML-escaped
    // ("Bob's Main Street Auto &amp; Towing") and were decoded in the catalog —
    // but the refresh is INSERT-ONLY by design (existing rows are never
    // rewritten), so stored rows can never heal on their own. Find rows still
    // carrying escaped names and sync them (postings + closures, which feed
    // the actively-hiring leaderboard) to the decoded catalog name. Stamped.
    const { data: nsVer } = await client.from("job_board_meta").select("v").eq("k", "name_sync_version").maybeSingle();
    if ((nsVer?.v as { version?: number } | null)?.version !== 1) {
      try {
        const tokens = new Set<string>();
        for (const pat of ["%&amp;%", "%&#039;%"]) {
          const { data: escRows } = await client.from("job_board_postings").select("company_token").like("company", pat).limit(1000);
          for (const r of escRows ?? []) tokens.add(r.company_token as string);
        }
        let fixed = 0;
        for (const tk of tokens) {
          const src = JOB_SOURCES.find((s) => s.token === tk);
          if (!src) continue;
          const { error: e1 } = await client.from("job_board_postings").update({ company: src.name }).eq("company_token", tk);
          const { error: e2 } = await client.from("job_board_closures").update({ company: src.name }).eq("company_token", tk);
          if (!e1 && !e2) fixed++;
        }
        await client.from("job_board_meta").upsert(
          { k: "name_sync_version", v: { version: 1, fixed, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        if (fixed > 0) console.log(`[JOB-BOARD] name sync: decoded stored names for ${fixed} boards`);
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

    // Categorization rules changed since the corpus was stamped? Sweep the
    // stored "other" rows through the current rules in a fresh invocation
    // (own compute budget). Idempotent: the stamp is written only when the
    // sweep completes, so a died sweep retries after the next pass.
    const { data: catVer } = await client.from("job_board_meta").select("v").eq("k", "category_rules_version").maybeSingle();
    if ((catVer?.v as { version?: number } | null)?.version !== CATEGORIZE_VERSION) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recategorize", chainKey: key }),
      })).then((r) => r.text()).catch(() => {}));
    }
    // Feature 1: refresh the light boards' descriptions daily (they arrive
    // description-less on the refresh path). Only when the last backfill is
    // stale, and never concurrent with recategorize — stagger by requiring
    // the category stamp to be current first.
    else {
      const { data: bf } = await client.from("job_board_meta").select("v, updated_at").eq("k", "desc_backfill").maybeSingle();
      const bfAge = bf ? Date.now() - new Date(bf.updated_at).getTime() : Infinity;
      const bfIncomplete = !!(bf?.v as { incompleteAt?: string } | null)?.incompleteAt;
      // Self-healing override: if meaningful description coverage is still
      // missing on the light boards, run regardless of the stamp — this
      // recovers from a stamp written by an older/buggy sweep without any
      // manual reset. One cheap capped count per pass (indexed).
      const lightTokens = JOB_SOURCES.filter((s) => isLight(s.token)).map((s) => s.token); // static + auto-enrolled (loaded at runRefresh start)
      let missingCoverage = false;
      if (lightTokens.length > 0 && bfAge > 30 * 60_000) {
        const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).in("company_token", lightTokens).is("description", null);
        missingCoverage = (count ?? 0) > 50;
      }
      // Incomplete sweeps (a board failed) retry within the hour; complete
      // ones wait a day (descriptions persist, so only the delta needs work).
      if (missingCoverage || bfAge > (bfIncomplete ? 60 * 60_000 : 24 * 60 * 60_000)) {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill-desc", chainKey: key, ti: 0, off: 0 }),
        })).then((r) => r.text()).catch(() => {}));
      }
    }
    return { ok: true, detail: `pass complete — corpus ${f.total} postings from ${companies.length} boards; cold rotation at ${cold}/${COLD_LIST.length}${lastUpsertError ? ` — last upsert error: ${String(lastUpsertError).slice(0, 120)}` : ""}` };
  }

  if (chainHop < CHAIN_CAP) chainNextSlice(chainHop);
  const phase = inHotPhase ? `hot ${Math.min(hot, HOT_LIST.length)}/${HOT_LIST.length}` : `cold slice ${coldDone}/${COLD_SLICES_PER_PASS} (rotation ${cold}/${COLD_LIST.length})`;
  return { ok: true, detail: `slice done (${sliceTotal} postings, ${failed.length} failed) — ${phase}` };
}

// ── detail: one posting's description (bounded memo, no bulk caching) ─────

const detailCache = new Map<string, { at: number; text: string }>();
const DETAIL_TTL_MS = 60 * 60_000;

// Single-posting liveness against the vendor RIGHT NOW — the moment-of-apply
// freshness check. Uses cheap per-job endpoints where they exist (never the
// 20-36 MB whole-board payload for the light giants); falls back to board
// membership for vendors without one. Returns true=live, false=confirmed gone,
// null=couldn't tell (transient) so callers don't wrongly mark a job closed.
const liveBoardMemo = new Map<string, Set<string>>();
async function checkLive(src: JobSource, externalId: string): Promise<boolean | null> {
  try {
    if (src.source === "greenhouse") {
      const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${src.token}/jobs/${externalId}?questions=false`);
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
    if (src.source === "workday") {
      // Cheap per-job detail: 200 live / 404 gone. externalId is the reqId; the
      // detail path needs the full externalPath, so probe the tenant search for
      // the reqId instead — a targeted list query returns it iff still posted.
      const [tenant, dc, site] = src.token.split("~");
      if (!tenant || !dc || !site) return null;
      const res = await fetchWithTimeout(`https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ limit: 20, offset: 0, searchText: externalId, appliedFacets: {} }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      const items = (body as { jobPostings?: Array<{ externalPath?: string; bulletFields?: string[] }> }).jobPostings ?? [];
      return items.some((j) => String(j.externalPath ?? "").includes(externalId) || (j.bulletFields ?? []).includes(externalId));
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

async function getDescription(src: JobSource, id: string, externalId: string): Promise<string | null> {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.text;
  let text: string | null = null;
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
  } else if (src.source === "bamboohr") {
    text = null; // detail endpoint is unreliable (observed 500s) — honest null
  } else if (src.source === "greenhouse") {
    const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${src.token}/jobs/${externalId}?questions=false`);
    if (res.ok) {
      const j = await res.json();
      text = htmlToText(String(j.content ?? "")).slice(0, DESC_CAP) || null;
    }
  } else {
    // Lever/Ashby ship descriptions in the board payload — fetch the board,
    // extract the one posting, keep nothing else in memory.
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
  if (text) {
    if (detailCache.size > 300) detailCache.clear();
    detailCache.set(id, { at: Date.now(), text });
  }
  return text;
}

// ── list: SQL reads + SWR background refresh ───────────────────────────────

// PostgREST or() syntax breaks on these — strip rather than reject.
const sanitizeTerm = (t: string) => t.replace(/[,()%\\]/g, "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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
    if (action === "status") {
      // Deploy + health introspection. Read-only, zero-cost (meta rows only — no
      // feed fetches, no AI). BUILD_VERSION and catalogSize come from the DEPLOYED
      // bundle, so a stale/failed publish is visible in ONE call instead of being
      // inferred from posting counts over hours (the rung-2 "did it deploy?" pain).
      // Also the source of truth for the heartbeat's job_board_deploy check.
      const [prog, rot, refreshMeta, bf, hotMeta, fresh, breaker, dateCov] = await Promise.all([
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "cold_rotation").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "hot_tokens").maybeSingle(),
        // Measured re-verification age distribution (null until the migration lands)
        client.rpc("get_freshness_stats").then((r) => r, () => ({ data: null })),
        client.from("job_board_meta").select("v").eq("k", "vendor_breaker").maybeSingle(),
        // Per-vendor stated-date coverage (null until the migration lands)
        client.rpc("get_date_coverage").then((r) => r, () => ({ data: null })),
      ]);
      const pgV = (prog.data?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[] };
      const rotV = (rot.data?.v ?? {}) as { completedAt?: string; coldBoards?: number };
      const rfV = (refreshMeta.data?.v ?? {}) as { total?: number };
      const dormant = ((bf.data?.v ?? {}) as { dormant?: Record<string, number> }).dormant ?? {};
      const hotTokens = ((hotMeta.data?.v ?? {}) as { tokens?: unknown[] }).tokens;
      const now = Date.now();
      const ageMin = (ts?: string | null) => (ts ? Math.round((now - new Date(ts).getTime()) / 60000) : null);
      return json({
        // deployed build identity (constants baked into THIS bundle)
        version: BUILD_VERSION,
        catalogSize: JOB_SOURCES.length,
        categorizeVersion: CATEGORIZE_VERSION,
        hotTier: Array.isArray(hotTokens) && hotTokens.length >= 50 ? hotTokens.length : HOT_SIZE,
        // live pipeline health (meta-derived)
        totalPostings: rfV.total ?? null,
        coldBoards: rotV.coldBoards ?? null,
        dormantBoards: Object.keys(dormant).length,
        cursor: { hot: pgV.hot ?? 0, cold: pgV.cold ?? 0, coldDone: pgV.coldDone ?? 0 },
        lastSliceAgeMin: ageMin(prog.data?.updated_at),
        lastRotationAgeMin: ageMin(rotV.completedAt ?? rot.data?.updated_at ?? null),
        recentFailures: Array.isArray(pgV.failedAcc) ? pgV.failedAcc.slice(-10) : [],
        // Measured freshness: re-verification age across all stamped boards.
        // THE number behind the public "within a few hours" claim.
        freshness: Array.isArray((fresh as { data?: unknown }).data) && ((fresh as { data: unknown[] }).data)[0]
          ? ((fresh as { data: unknown[] }).data)[0]
          : null,
        quarantinedVendors: (((breaker.data?.v ?? {}) as { quarantined?: string[] }).quarantined ?? []),
        // Which hiring systems state posting dates, and for what share of
        // their postings — the measured basis behind every age stat.
        dateCoverage: Array.isArray((dateCov as { data?: unknown }).data)
          ? ((dateCov as { data: Array<{ source: string; total: number; dated: number }> }).data).map((r) => ({
              source: r.source,
              total: Number(r.total),
              datedPct: Math.round(100 * Number(r.dated) / Math.max(Number(r.total), 1)),
            }))
          : null,
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

    if (action === "recategorize") {
      // Maintenance sweep, self-invoked at pass end (chainKey-gated like
      // force-refresh). Re-runs the CURRENT rules over stored "other" rows
      // — the only bucket new rules can rescue — updating rows whose
      // category changes. Pages by id cursor; self-chains past the budget.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "recategorize is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
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
          body: JSON.stringify({ action: "recategorize", chainKey: key, cursor }),
        })).then((r) => r.text()).catch(() => {}));
        return json({ ok: true, scanned, updated, nextCursor: cursor });
      }
      await client.from("job_board_meta").upsert(
        { k: "category_rules_version", v: { version: CATEGORIZE_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
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

    if (action === "backfill-country") {
      // Fill country on rows that predate the column — chainKey-gated,
      // self-chaining, stamped on completion (same shape as backfill-salary).
      // Rows whose location we can't place stay NULL; the cursor walks past
      // them and the stamp stops re-scans.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-country is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      let scanned = 0;
      const groups = new Map<string, string[]>(); // country -> ids
      const PAGES = 6;
      for (let page = 0; page < PAGES; page++) {
        let q = client
          .from("job_board_postings")
          .select("id,location")
          .is("country", null)
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const c = detectCountry((r as { location?: string | null }).location);
          if (!c) continue;
          const g = groups.get(c) ?? [];
          g.push(r.id as string);
          groups.set(c, g);
        }
        if (!rows || rows.length < 1000) { cursor = ""; break; }
        cursor = rows[rows.length - 1].id as string;
      }
      let updated = 0;
      for (const [c, ids] of groups) {
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await client.from("job_board_postings")
            .update({ country: c }).in("id", ids.slice(i, i + 200));
          if (error) throw error;
          updated += Math.min(200, ids.length - i);
        }
      }
      if (cursor) {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill-country", chainKey: key, cursor }),
        })).then((r) => r.text()).catch(() => {}));
        return json({ ok: true, scanned, updated, cursor });
      }
      await client.from("job_board_meta").upsert(
        { k: "country_version", v: { version: COUNTRY_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] country backfill complete: ${scanned} scanned, ${updated} filled (v${COUNTRY_VERSION})`);
      return json({ ok: true, scanned, updated, done: true });
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
      const groups = new Map<string, { annualMin: number | null; currency: string | null; ids: string[] }>();
      const PAGES = 6;
      for (let page = 0; page < PAGES; page++) {
        let q = client
          .from("job_board_postings")
          .select("id,salary,salary_min_annual,salary_currency")
          .not("salary", "is", null)
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const row = r as { id: string; salary?: string | null; salary_min_annual?: number | string | null; salary_currency?: string | null };
          const p = parseSalaryStructured(row.salary);
          const nextMin = p?.annualMin ?? null;
          const nextCur = p?.currency ?? null;
          const curMin = row.salary_min_annual == null ? null : Number(row.salary_min_annual);
          const curCur = row.salary_currency ?? null;
          if (nextMin === curMin && nextCur === curCur) continue; // already correct — no write
          const key = `${nextMin ?? ""}|${nextCur ?? ""}`;
          const g = groups.get(key) ?? { annualMin: nextMin, currency: nextCur, ids: [] };
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
            .update({ salary_min_annual: g.annualMin, salary_currency: g.currency })
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
      const { data: meta } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle();

      if (!meta) {
        // First boot (migration just applied, no pass yet): one blocking
        // refresh seeds the table; afterwards this path never runs again.
        const seeded = await runRefresh(client, true);
        if (!seeded.ok) return json({ error: "Job board is initializing — try again shortly" }, 503);
        return await serveList(client, body);
      }
      if (Date.now() - new Date(meta.updated_at).getTime() > STALE_MS) {
        waitUntil(runRefresh(client)); // serve stale, refresh behind the scenes
      }
      return await serveList(client, body, meta);
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
      for (const r of rows ?? []) {
        if (r.description && r.description.length > 150) {
          const f = computeFit(r.description, resumeText, 40);
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
      const BOARDS = JOB_SOURCES.filter((s) => isLight(s.token));
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
        .select("id")
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
          const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${s.token}/jobs/${ghId}?questions=false`);
          if (!res.ok) continue;
          const job = (await res.json()) as { content?: string };
          const text = job.content ? clean(htmlToText(String(job.content).slice(0, 12000)).trim()).slice(0, 4000) : "";
          if (text) {
            // Backfilled description is also the salary source for these boards
            // (GH giants fetch without content, so ingest-time mining never saw
            // it). Only set when extraction finds the company's own pay text.
            const minedSalary = extractSalary(text);
            const minedParse = minedSalary ? parseSalaryStructured(minedSalary) : null;
            const { error } = await client.from("job_board_postings")
              .update({
                description: text,
                ...(minedSalary ? { salary: minedSalary, salary_min_annual: minedParse?.annualMin ?? null, salary_currency: minedParse?.currency ?? null } : {}),
              })
              .eq("id", row.id);
            if (!error) updated++;
          }
        } catch { /* transient — row stays null, retried next run */ }
      }
      // Fewer than a full page means this board has no more null rows to
      // fill — advance to the next board. A full page means keep going here.
      if (!rows || rows.length < PER_HOP) ti += 1;
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-desc", chainKey: key, ti }),
      })).then((rr) => rr.text()).catch(() => {}));
      return json({ ok: true, board: s.token, updated, remaining: (rows ?? []).length === PER_HOP ? "more" : "board-done", nextTi: ti });
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
      const note = String(body.note ?? "").replace(/ /g, "").slice(0, 280);
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
      for (const id of ids) {
        const [source, token, ...rest] = id.split(":");
        const externalId = rest.join(":");
        const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
        if (!src || !externalId) { liveMap[id] = false; deadIds.push(id); continue; }
        demandTokens.add(src.token);
        const live = await checkLive(src, externalId);
        if (live === false) { liveMap[id] = false; deadIds.push(id); }
        else liveMap[id] = true; // true OR null(unknown) → keep showing, never a false close
      }
      if (deadIds.length > 0) {
        for (let i = 0; i < deadIds.length; i += 50) {
          await client.from("job_board_postings").delete().in("id", deadIds.slice(i, i + 50));
        }
      }
      // Demand signal: boards a user just looked at jump the refresh queue.
      if (demandTokens.size > 0) {
        const { data: dm } = await client.from("job_board_meta").select("v").eq("k", "demand").maybeSingle();
        const prev = ((dm?.v as { tokens?: Array<{ t: string; at: number }> } | null)?.tokens ?? []).filter((x) => Date.now() - x.at < 20 * 60_000);
        const merged = [...prev.filter((x) => !demandTokens.has(x.t)), ...[...demandTokens].map((t) => ({ t, at: Date.now() }))].slice(-60);
        await client.from("job_board_meta").upsert({ k: "demand", v: { tokens: merged }, updated_at: new Date().toISOString() }, { onConflict: "k" });
      }
      return json({ live: liveMap, pruned: deadIds.length });
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
      const { count: totalRows } = await client.from("job_board_postings").select("id", { count: "exact", head: true });
      const corpus = totalRows ?? 0;
      const VENDORS = [...new Set(JOB_SOURCES.map((s) => s.source))];
      const PER_VENDOR = Math.max(4, Math.floor(AUDIT_SAMPLE / Math.max(1, VENDORS.length)));
      const sampleIds: string[] = [];
      for (const v of VENDORS) {
        const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).eq("source", v);
        const n = count ?? 0;
        if (n === 0) continue;
        const want = Math.min(PER_VENDOR, n);
        const pages = want > 4 ? 2 : 1; // two random offsets per vendor beats one cluster
        const per = Math.ceil(want / pages);
        for (let p = 0; p < pages; p++) {
          const off = Math.floor(Math.random() * Math.max(1, n - per));
          const { data: page } = await client.from("job_board_postings").select("id").eq("source", v).order("id").range(off, off + per - 1);
          for (const r of page ?? []) if (!sampleIds.includes(r.id as string)) sampleIds.push(r.id as string);
        }
      }
      let live = 0, gone = 0, unknown = 0;
      const byVendor: Record<string, { sampled: number; live: number; gone: number; unknown: number; accuracyPct: number | null }> = {};
      liveBoardMemo.clear();
      // Small parallel batches: bounded fan-out, memoized board fetches.
      for (let i = 0; i < sampleIds.length; i += 8) {
        const batch = sampleIds.slice(i, i + 8);
        const results = await Promise.all(batch.map(async (id) => {
          const [source, token, ...rest] = id.split(":");
          const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
          if (!src || rest.length === 0) return null; // deselected board — can't ground-truth
          return await checkLive(src, rest.join(":"));
        }));
        results.forEach((r, j) => {
          const v = batch[j].split(":")[0];
          const bucket = byVendor[v] ?? (byVendor[v] = { sampled: 0, live: 0, gone: 0, unknown: 0, accuracyPct: null });
          bucket.sampled++;
          if (r === true) { live++; bucket.live++; }
          else if (r === false) { gone++; bucket.gone++; }
          else { unknown++; bucket.unknown++; }
        });
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
            .update({ remote: false }).in("id", remoteDemote.slice(i, i + 100));
          if (!dErr) labelAudit.demoted += Math.min(100, remoteDemote.length - i);
        }
      } catch (e) {
        console.warn("[JOB-BOARD] label audit failed (liveness audit unaffected):", String(e).slice(0, 150));
      }

      const prevHistory = ((prevAudit?.v as { history?: Array<Record<string, unknown>> } | null)?.history ?? []).slice(-29);
      const result = { at: new Date().toISOString(), sampled: sampleIds.length, live, gone, unknown, accuracyPct, corpus, byVendor, labelAudit };
      await client.from("job_board_meta").upsert(
        { k: "audit", v: { ...result, history: [...prevHistory, result] }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] audit: ${live}/${decided} live (${accuracyPct}%), ${unknown} unknown of ${sampleIds.length} sampled`);
      return json(result);
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

    if (action === "detail") {
      const id = String(body.id ?? "");
      const [source, token, ...rest] = id.split(":");
      const externalId = rest.join(":");
      // Allowlist gate — the token must be one of ours (no SSRF via crafted ids).
      const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
      if (!src || !externalId) return json({ error: "Unknown job id" }, 404);
      const { data: jobRow } = await client.from("job_board_postings").select("*").eq("id", id).maybeSingle();
      // Stored description first (Lever/Ashby); live fetch covers the rest.
      const description = (jobRow?.description && jobRow.description.length > 200)
        ? jobRow.description
        : await getDescription(src, id, externalId);
      if (!description && !jobRow) return json({ error: "Posting not found (it may have closed)" }, 404);
      return json({ job: jobRow ? rowToJob(jobRow) : null, description });
    }

    if (action === "application-questions") {
      // Apply agent: fetch a posting's REAL application questions. Only Greenhouse
      // exposes them publicly (?questions=true); other vendors return supported:
      // false so the client falls back to JD-inferred questions. Each question is
      // classified so the UI/answer-drafter knows what may be auto-drafted vs. what
      // the candidate must answer (identity, demographics, work-auth, salary).
      const id = String(body.id ?? "");
      const [source, token, ...rest] = id.split(":");
      const externalId = rest.join(":");
      const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
      if (!src || !externalId) return json({ error: "Unknown job id" }, 404);
      if (source !== "greenhouse") return json({ vendor: source, supported: false, questions: [] });
      const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${externalId}?questions=true`);
      if (!res.ok) return json({ vendor: source, supported: false, questions: [] });
      const gh = await res.json() as { questions?: Array<{ label?: string; required?: boolean; fields?: Array<{ type?: string }> }> };
      const questions = (gh.questions ?? [])
        .map((q) => {
          const label = (q.label ?? "").trim();
          const type = q.fields?.[0]?.type ?? "";
          return { label, required: !!q.required, type, class: classifyQuestion(label, type) };
        })
        .filter((q) => q.label);
      return json({ vendor: source, supported: true, questions });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[JOB-BOARD] error:", e);
    return json({ error: "Job board temporarily unavailable" }, 500);
  }
});

// deno-lint-ignore no-explicit-any
const rowToJob = (r: any) => ({
  id: r.id,
  source: r.source,
  token: r.company_token,
  company: r.company,
  title: r.title,
  location: r.location,
  remote: r.remote,
  department: r.department,
  category: r.category,
  postedAt: r.posted_at,
  applyUrl: r.apply_url,
  salary: r.salary ?? null,
  experienceBand: r.experience_band && r.experience_band !== "unspecified" ? r.experience_band : null,
  minYears: typeof r.min_years === "number" ? r.min_years : null,
});

async function serveList(
  client: SupabaseClient,
  body: Record<string, unknown>,
  meta?: { v: Record<string, unknown>; updated_at: string } | null,
) {
  const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const countOnly = body.countOnly === true;

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
  const unfiltered =
    !String(body.q ?? "").trim() &&
    !String(body.location ?? "").trim() &&
    !/^[A-Za-z]{2}$/.test(String(body.country ?? "")) &&
    body.remote !== true &&
    !(JOB_CATEGORIES as readonly string[]).includes(String(body.category ?? "")) &&
    !String(body.experience ?? "").trim() &&
    !(Number(body.salaryFloor) > 0) &&
    !(Array.isArray(body.companies) && body.companies.length) &&
    typeof body.postedAfter !== "string";
  const wantCount = !(unfiltered && Number.isFinite(metaTotal) && metaTotal > 0);
  const buildQuery = (dateCol: string) => {
    let q = client
      .from("job_board_postings")
      .select(
        "id,source,company_token,company,title,location,remote,department,category,posted_at,apply_url,salary,experience_band,min_years",
        wantCount ? { count: "exact" } : {},
      )
      .gte(dateCol, freshCutoffIso);
    const terms = String(body.q ?? "").toLowerCase().split(/\s+/).map(sanitizeTerm).filter(Boolean).slice(0, 8);
    for (const t of terms) q = q.or(`title.ilike.%${t}%,company.ilike.%${t}%,department.ilike.%${t}%`);
    const loc = sanitizeTerm(String(body.location ?? ""));
    if (loc) q = q.ilike("location", `%${loc}%`);
    if (body.remote === true) q = q.eq("remote", true);
    // Country filter: exact match on the deterministically extracted code.
    // Postings whose location we couldn't place have country NULL and are
    // excluded by the filter — honestly, never guessed (the UI says so).
    const country = String(body.country ?? "").toUpperCase();
    if (/^[A-Z]{2}$/.test(country)) q = q.eq("country", country);
    const category = String(body.category ?? "");
    if ((JOB_CATEGORIES as readonly string[]).includes(category)) q = q.eq("category", category);
    // Experience filter: one of entry/mid/senior/expert. "unspecified" rows are
    // never returned by a band filter — we only surface postings we can honestly
    // place. Accepts a comma list so a user can widen (e.g. "senior,expert").
    const expParam = String(body.experience ?? "").split(",").map((s) => s.trim()).filter(isExperienceBand);
    if (expParam.length === 1) q = q.eq("experience_band", expParam[0]);
    else if (expParam.length > 1) q = q.in("experience_band", expParam);
    // Salary floor filters the annualized lower bound of the posting's OWN
    // stated pay (no estimates, no currency conversion) — postings without a
    // stated salary are excluded by the filter, honestly, not guessed at.
    const floor = Number(body.salaryFloor);
    if (Number.isFinite(floor) && floor > 0) q = q.gte("salary_min_annual", Math.min(floor, 2_000_000));
    if (Array.isArray(body.companies)) {
      const tokens = body.companies.filter((c): c is string => typeof c === "string").slice(0, JOB_SOURCES.length);
      if (tokens.length) q = q.in("company_token", tokens);
    }
    // Saved searches ask "how many NEW since I last looked" — a cheap count.
    if (typeof body.postedAfter === "string" && !Number.isNaN(Date.parse(body.postedAfter))) {
      q = q.gt(dateCol, body.postedAfter);
    }
    return q;
  };
  const missingColumn = (e: { message?: string } | null) => !!e?.message?.includes("effective_posted");

  if (countOnly) {
    if (!wantCount) return json({ total: metaTotal }); // unfiltered — the maintained catalog total
    let { count, error } = await buildQuery("effective_posted").range(0, 0);
    if (missingColumn(error)) ({ count, error } = await buildQuery("posted_at").range(0, 0));
    if (error) throw error;
    return json({ total: count ?? 0 });
  }

  // Stable pagination: recency desc (nulls last) by default, or highest
  // STATED salary first. Salary ordering uses salary_rank_usd — an
  // approximate-FX rank column that exists only so ₹2M/yr doesn't outrank
  // $300k by raw digits; displayed salaries stay the posting's own text.
  // Unranked postings (no identifiable currency) sort after ranked ones —
  // never excluded, never estimated. id tiebreaker so equal keys can't
  // shuffle between "load more" pages.
  const sortSalary = body.sort === "salary";
  const page = (dateCol: string, salaryCol: string) =>
    (sortSalary
      ? buildQuery(dateCol).order(salaryCol, { ascending: false, nullsFirst: false })
      : buildQuery(dateCol).order(dateCol, { ascending: false, nullsFirst: false })
    )
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
  let { data, error, count } = await page("effective_posted", "salary_rank_usd");
  // Graceful degrade until the rank-column migration applies: raw numeric order.
  if (sortSalary && error?.message?.includes("salary_rank_usd")) {
    ({ data, error, count } = await page("effective_posted", "salary_min_annual"));
  }
  if (missingColumn(error)) ({ data, error, count } = await page("posted_at", "salary_min_annual"));
  if (error) throw error;

  // Zero-result telemetry: a first-page search that found nothing is the
  // honest demand signal for what the catalog lacks. Logged fire-and-forget
  // into a service-role-only table (30-day retention) — never blocks the
  // response, and only when the user actually typed something.
  const missQ = String(body.q ?? "").slice(0, 120).trim();
  const missLoc = String(body.location ?? "").slice(0, 120).trim();
  if ((count ?? 0) === 0 && offset === 0 && (missQ || missLoc)) {
    waitUntil(Promise.resolve(
      client.from("job_board_search_misses").insert({
        q: missQ,
        location: missLoc,
        filters: {
          category: String(body.category ?? "") || undefined,
          experience: String(body.experience ?? "") || undefined,
          remote: body.remote === true || undefined,
          salaryFloor: Number(body.salaryFloor) || undefined,
        },
        src: "list",
      }).then(({ error: e }) => { if (e) console.warn("[JOB-BOARD] search-miss log failed:", e.message); }),
    ));
  }

  const v = (meta?.v ?? {}) as Record<string, unknown>;
  // The company facet grows with the catalog (~60 bytes/company); refetches
  // that already hold it can opt out instead of re-downloading it per filter
  // change. Absent/true keeps the old contract for deployed frontends.
  const includeFacets = (body as { includeFacets?: boolean }).includeFacets !== false;
  // At the scaled-up pool (~8.7k companies) the full facet is ~500KB per list
  // response and thousands of dropdown nodes — serve the top slice by count and
  // report the full number separately so stat displays stay exact. The facets
  // RPC (used by prerender/SEO) still returns the complete set.
  const FACET_COMPANY_LIMIT = 1_500;
  const fullCompanies = (v.companiesFacet as Array<{ count?: number }>) ?? [];
  const servedCompanies = includeFacets
    ? [...fullCompanies].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, FACET_COMPANY_LIMIT)
    : [];
  return json({
    jobs: (data ?? []).map(rowToJob),
    total: wantCount ? (count ?? 0) : metaTotal,
    totalAllCompanies: (v.total as number) ?? count ?? 0,
    companies: servedCompanies,
    companiesCount: fullCompanies.length,
    categories: (v.categoriesFacet as Record<string, number>) ?? {},
    failedSources: (v.failedSources as string[]) ?? [],
    refreshedAt: (v.refreshedAt as string) ?? null,
  });
}
