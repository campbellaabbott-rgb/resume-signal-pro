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
  normalizeIcims,
  normalizeRippling,
  normalizePinpoint,
  extractRipplingJobPosts,
  normalizeWorkday,
  normalizeOracle,
  detectCountry,
  type JobPosting,
} from "./normalize.ts";
import { categorize, CATEGORIZE_VERSION, JOB_CATEGORIES } from "./categories.ts";
import { computeFit } from "../_shared/fit-score.ts";
import { extractSalary, parseSalaryStructured } from "../_shared/salary-extract.ts";
import { classifyDormancy, updateBoardFailures, type BoardFailureState } from "./dormancy.ts";
import { advanceProgress, isPassDone, type RefreshProgress } from "./rotation.ts";
import { CANARIES, rawItemCount, aggregateVendorHealth, type CanaryResult } from "./vendor-canary.ts";
import { detectExperience, isExperienceBand } from "./experience.ts";
import { expandQuery } from "./search-alias.ts";
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
// NOTE: a change to ../_shared/* alone does NOT get this function redeployed —
// the deploy only picks up functions whose OWN directory changed, so the stale
// bundle keeps its old copy of the shared module (confirmed twice, 2026-07-24:
// two classifier fixes in _shared/application-questions.ts never reached prod
// while this file was untouched). Always bump BUILD_VERSION here when a shared
// module this function imports changes — it forces the diff AND gives the
// deploy a verifiable tell.
// Sitemap pagination unit: one file per day of the 30-day freshness window.
// Matches the window the board itself serves, and keeps every page an indexed
// range scan rather than a deep OFFSET.
const SITEMAP_DAYS = 30;
const BUILD_VERSION = "2026-07-29.6";

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
const DESC_SWEEP_CONCURRENCY = 8;
// Slice sizes are calibrated to the per-invocation compute budget. Hot
// slices are UNIFORMLY giant boards (that's what makes them hot), so they
// must be much smaller than the old mixed slices: the first tiered deploy
// died mid-slice at HOT=30 (one upsert chunk of carvana landed, then the
// worker hit the ceiling and the cron retried the same slice forever).
const HOT_SLICE = 10;
const COLD_SLICE = 80; // cold boards are small (that's why they're cold); 80/hop at CONCURRENCY=8 is 10 sequential rounds — well under the edge wall-time limit. Rotation speed comes from concurrency + hops-per-pass, never bigger slices (proven-safe size).
const BOOTSTRAP_PER_SLICE = 25; // zero-row boards prepended per cold slice after a deploy — +31% slice load, still ~3 rounds under the wall-time margin; a 1,900-board merge drains in ~1.5 passes instead of waiting a full rotation for its FIRST ingest
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

const listUrl = (s: JobSource) =>
  s.source === "greenhouse"
    // content=true costs a bigger payload but delivers every description in
    // ONE call — fit-ranking coverage for GH boards, plus real departments.
    ? (({ host, token }) => `https://${host}/v1/boards/${token}/jobs${isLight(s.token) ? "" : "?content=true"}`)(greenhouseApi(s.token))
    : s.source === "lever"
      ? `https://api.lever.co/v0/postings/${s.token}?mode=json`
      : s.source === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${s.token}?includeCompensation=true`
        : s.source === "smartrecruiters"
          ? `https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100`
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
// tail regardless). List-only, so no description at this stage — but NOT
// undated: the relative list age converts to a real date when <= 30 days, and
// the CXS detail payload later supplies an exact startDate that replaces it.
// (The "like BambooHR" that used to sit here was wrong on both counts.)
const WORKDAY_PAGE_CAP = 25; // 25 × 20 = up to 500 postings/board/pass
// Oracle CE REST accepts a larger page than Workday; 20 × 100 = up to 2000
// postings/board/pass, which exhausts every tenant in the first tranche.
const ORACLE_PAGE_SIZE = 100;
const ORACLE_PAGE_CAP = 20;
async function fetchWorkday(s: JobSource): Promise<{ jobPostings: unknown[]; raw: unknown; windowed: boolean; feedTotal: number }> {
  const [tenant, dc, site] = s.token.split("~");
  if (!tenant || !dc || !site) throw new Error("bad workday token");
  const url = `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const all: unknown[] = [];
  let feedTotal = 0;
  for (let page = 0; page < WORKDAY_PAGE_CAP; page++) {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ limit: 20, offset: page * 20, searchText: "", appliedFacets: {} }),
    });
    if (!res.ok) { if (page === 0) throw new Error(`HTTP ${res.status}`); break; }
    const body = await res.json();
    if (page === 0) feedTotal = Number((body as { total?: number }).total ?? 0) || 0;
    const items = Array.isArray((body as { jobPostings?: unknown[] }).jobPostings) ? (body as { jobPostings: unknown[] }).jobPostings : [];
    all.push(...items);
    if (items.length < 20) break; // last page
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
  return { jobPostings: all, raw: { jobPostings: all }, windowed: feedTotal > all.length, feedTotal };
}

// Oracle Recruiting Cloud: paginated public CE REST. The finder carries the
// site number and paging; items[0].TotalJobsCount is the tenant's own advertised
// total, so (like Workday) we can tell a windowed fetch from an exhaustive one
// and refuse to prune on a partial read.
async function fetchOracle(s: JobSource): Promise<{ items: unknown[]; raw: unknown; windowed: boolean; feedTotal: number }> {
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
    const finder = `findReqs;siteNumber=${site},limit=${ORACLE_PAGE_SIZE},offset=${page * ORACLE_PAGE_SIZE},sortBy=POSTING_DATES_DESC`;
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
  return { items: all, raw: { items: all }, windowed: !exhausted, feedTotal };
}

async function fetchBoard(s: JobSource): Promise<{ jobs: JobPosting[]; raw: unknown; windowed?: boolean; feedTotal?: number } | null> {
  try {
    if (s.source === "oracle") {
      const { items, raw, windowed, feedTotal } = await fetchOracle(s);
      return { jobs: normalizeOracle(items as never, s.name, s.token), raw, windowed, feedTotal };
    }
    if (s.source === "icims") {
      // The employer's own career-site JSON (token IS the host). Paginated at
      // 100/page; bounded so one giant board can't wedge a refresh slice.
      const ICIMS_PAGE = 100, ICIMS_MAX_PAGES = 12;
      const all: unknown[] = [];
      let feedTotal = 0, exhausted = false;
      for (let page = 1; page <= ICIMS_MAX_PAGES; page++) {
        const res = await fetchWithTimeout(`https://${s.token}/api/jobs?page=${page}&limit=${ICIMS_PAGE}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { jobs?: unknown[]; totalCount?: number };
        const batch = Array.isArray(body.jobs) ? body.jobs : [];
        if (page === 1) feedTotal = Number(body.totalCount) || 0;
        all.push(...batch);
        if (batch.length < ICIMS_PAGE) { exhausted = true; break; }
      }
      // Same guard as the other paginated vendors: a page-1 failure that
      // returns empty while the feed claims postings must NOT read as "board
      // emptied" (the orphan prune would delete a live tenant).
      if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
      return { jobs: normalizeIcims(all as never, s.name, s.token), raw: { items: all }, windowed: !exhausted, feedTotal };
    }
    if (s.source === "rippling") {
      const { items, raw } = await fetchRippling(s);
      return { jobs: normalizeRippling(items as never, s.name, s.token), raw };
    }
    if (s.source === "pinpoint") {
      // Documented public JSON — single unpaginated list.
      const res = await fetchWithTimeout(`https://${s.token}.pinpointhq.com/postings.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const data = Array.isArray((body as { data?: unknown[] }).data) ? (body as { data: unknown[] }).data : [];
      return { jobs: normalizePinpoint(data as never, s.name, s.token), raw: body };
    }
    if (s.source === "workday") {
      const { jobPostings, raw, windowed, feedTotal } = await fetchWorkday(s);
      return { jobs: normalizeWorkday(jobPostings as never, s.name, s.token), raw, windowed, feedTotal };
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
const COLD_SLICES_PER_PASS = 120;

// Dormancy skip-list (throughput): a feed dead for DEAD_BOARD_THRESHOLD straight
// rotations has its postings pruned and is marked dormant — future cold slices
// SKIP fetching it (a dead feed would otherwise burn the full FETCH_TIMEOUT every
// rotation for nothing) and only recheck it once per DORMANT_RECHECK_MS so a feed
// that comes back rejoins on its own. The board stays in COLD_LIST, so the
// rotation cursor and sweep coverage are untouched — only the wasted fetch is
// removed. DORMANT_CAP bounds the meta row against a mass die-off.
const DEAD_BOARD_THRESHOLD = 6; // consecutive failures before prune + dormancy (unchanged bar from the prior prune)
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
const SALARY_PARSE_VERSION = 5; // v5: annualMax + period stored (full range display) — re-sweep fills salary_max_annual/salary_period on stored rows
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
const POSTED_BACKFILL_VERSION = 5;

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
const POSTED_BACKFILL_REARM_MS = 7 * 86_400_000;
function postedBackfillDue(v: { version?: number; sweptAt?: string }): boolean {
  if (v.version !== POSTED_BACKFILL_VERSION) return true;
  const swept = v.sweptAt ? Date.parse(v.sweptAt) : NaN;
  return !Number.isFinite(swept) || Date.now() - swept > POSTED_BACKFILL_REARM_MS;
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
      let bs = (bsMeta?.v ?? {}) as { queue?: string[]; version?: string };
      if (bs.version !== BUILD_VERSION) {
        const { data: empty, error } = await client.rpc("get_empty_boards", { p_tokens: JOB_SOURCES.map((s) => s.token) });
        if (error) throw error;
        bs = { queue: Array.isArray(empty) ? empty : [], version: BUILD_VERSION };
      }
      const queue = Array.isArray(bs.queue) ? bs.queue : [];
      if (queue.length > 0) {
        const sliceTokens = new Set([...baseSlice, ...demandBoards].map((s) => s.token));
        bootstrapBoards = queue
          .slice(0, BOOTSTRAP_PER_SLICE)
          .filter((t) => !sliceTokens.has(t))
          .map((t) => JOB_SOURCES.find((s) => s.token === t))
          .filter((s): s is JobSource => !!s);
      }
      if (queue.length > 0 || bs.version !== (bsMeta?.v as { version?: string } | null)?.version) {
        // Optimistic drain (same rule as the cursors): a died slice skips
        // ahead rather than wedging on the same bootstrap boards.
        await client.from("job_board_meta").upsert(
          { k: "bootstrap", v: { queue: queue.slice(BOOTSTRAP_PER_SLICE), version: bs.version }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
      }
    } catch { /* bootstrap is an accelerator — on any error the rotation still reaches every board */ }
  }
  const slice = [...demandBoards, ...bootstrapBoards, ...baseSlice];
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
        const r = await fetchBoard(s);
        if (!r) {
          failed.push(`${s.name} (vendor)`);
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
        // Breezy has NO description field on its /json list (verified against the
        // live API 2026-07-24) — the branch that used to sit here could never
        // fire, which is why every Breezy row stored null. Its text lives only on
        // the posting page, so it is a backfill-sweep vendor now.
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
              const p = parseSalaryStructured(salaryText, j.country ?? detectCountry(j.location));
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
        for (let i = 0; i < corrections.length; i += 200) {
          const chunk = corrections.slice(i, i + 200);
          for (const c of chunk) {
            const { id, ...patch } = c as { id: string };
            const { error: cErr } = await client.from("job_board_postings").update(patch).eq("id", id);
            if (cErr) { lastUpsertError = `${s.token} correct ${String(id).slice(0, 40)}: ${cErr.message}`; break; }
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
        const truncatedFetch = (s.source === "smartrecruiters" && rowsById.size >= SR_CAP) || r.windowed === true;
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
              const agedRows = ((toLog ?? []) as Array<Record<string, unknown>>).filter((r) => {
                const posted = r.posted_at ? new Date(String(r.posted_at)).getTime() : NaN;
                return Number.isFinite(posted) && posted < freshCutoffMs;
              });
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
  const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);
  const { next: progressAfter, wrapped } = advanceProgress({
    prev: { ...progressBefore, failedAcc },
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
      // Ledger BEFORE deleting: this sweep runs every pass while a board is only
      // re-fetched on rotation, so it wins the race for most age-outs. Writing
      // nothing here meant the aged_out side of the ghost-rate stat counted a
      // small minority of real events (bug sweep 2026-07-26). Best-effort: the
      // prune itself must never fail because the ledger did.
      if (ids.length > 0) {
        const exitedAt = new Date().toISOString();
        for (let i = 0; i < ids.length; i += 200) {
          const slice = ids.slice(i, i + 200);
          const { data: agedRows } = await client
            .from("job_board_postings")
            .select("id, source, company_token, category, posted_at, first_seen")
            .in("id", slice);
          if (!agedRows?.length) continue;
          waitUntil(Promise.resolve(client.from("job_board_exits").insert(
            agedRows.map((r) => ({
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
    // Re-rank the hot tier from what the corpus actually holds now: velocity
    // leaders (most postings first_seen inside the window — the boards where
    // new jobs actually appear) take guaranteed slots, size leaders fill the
    // rest. RPC missing (migration lag) degrades to pure size ranking.
    const sizeRanked = [...companies]
      .filter((c): c is { token: string; count: number } => typeof (c as { token?: unknown }).token === "string" && typeof (c as { count?: unknown }).count === "number")
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
    // Undated rows whose vendor feed DOES carry dates? Date them once.
    // The kick now (a) stands down while a chain is demonstrably alive
    // (hop stamp < 5 min old) instead of spawning a concurrent duplicate,
    // and (b) revives a DEAD chain at its stored phase+cursor rather than
    // from the beginning — restart-from-scratch is why v2's late phases
    // never ran.
    const { data: pbVer } = await client.from("job_board_meta").select("v").eq("k", "posted_backfill").maybeSingle();
    const pbV = (pbVer?.v ?? {}) as { version?: number; resumeVersion?: number; phase?: string; cursor?: string; at?: string };
    const pbAlive = typeof pbV.at === "string" && Date.now() - Date.parse(pbV.at) < 5 * 60_000;
    if (postedBackfillDue(pbV) && !pbAlive) {
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
  if (chainHop < CHAIN_CAP) chainNextSlice(chainHop);
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
    const pbv = (pb.v ?? {}) as { version?: number; sweptAt?: string; resumeVersion?: number; phase?: string; cursor?: string };
    if (!pb.alive && postedBackfillDue(pbv)) {
      const pbResume = pbv.resumeVersion === POSTED_BACKFILL_VERSION
        && typeof pbv.phase === "string" && typeof pbv.cursor === "string"
        ? { phase: pbv.phase, cursor: pbv.cursor }
        : {};
      await kick("backfill-posted", pbResume);
    }

    // Categorization rules changed since the corpus was stamped? Sweep the
    // stored "other" rows through the current rules in a fresh invocation
    // (own compute budget). Idempotent: the stamp is written only when the
    // sweep completes, so a died sweep retries later.
    const { data: catVer } = await client.from("job_board_meta").select("v").eq("k", "category_rules_version").maybeSingle();
    if ((catVer?.v as { version?: number } | null)?.version !== CATEGORIZE_VERSION) {
      const prog = await alive("recategorize_progress");
      if (!prog.alive) {
        // Resume from the dead chain's frontier — but ONLY if that frontier was
        // cut under the CURRENT rules. A leftover stamp from a v(N-1) sweep that
        // never completed would otherwise make the v(N) sweep skip everything
        // before its cursor, leaving rows judged only by the old rules.
        const sameVersion = Number(prog.v?.version) === CATEGORIZE_VERSION;
        const cursor = sameVersion && typeof prog.v?.cursor === "string" ? prog.v.cursor as string : "";
        await kick("recategorize", cursor ? { cursor } : {});
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
    if (!ds.alive && !settled) await kick("desc-sweep", { vi: 0 });
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
async function checkLive(src: JobSource, externalId: string): Promise<boolean | null> {
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
      const text = j.description ? htmlToText(String(j.description).slice(0, 12000)).trim() : "";
      if (ext && text) out.set(`workable:${s.token}:${ext}`, text.slice(0, 4000));
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
      const text = html ? htmlToText(html.slice(0, 12000)).trim() : "";
      if (ext && text) out.set(`icims:${s.token}:${ext}`, text.slice(0, 4000));
    }
  } else if (s.source === "pinpoint") {
    for (const p of (((raw as { data?: Array<Record<string, unknown>> }).data) ?? [])) {
      const ext = p.id == null ? "" : String(p.id);
      const html = [p.description, p.key_responsibilities, p.skills_knowledge_expertise]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join("\n");
      const text = html ? htmlToText(html.slice(0, 12000)).trim() : "";
      if (ext && text) out.set(`pinpoint:${s.token}:${ext}`, text.slice(0, 4000));
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
        const rt = String(j?.jobPostingInfo?.remoteType ?? "").toLowerCase();
        workMode = rt.includes("remote") && !rt.includes("hybrid") ? "remote"
          : rt.includes("hybrid") ? "hybrid"
          : rt.includes("on-site") || rt.includes("onsite") || rt.includes("on site") ? "onsite"
          : null;
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
const sanitizeTerm = (t: string) => t.replace(/[,()%\\]/g, "").trim();

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
    if (action === "status") {
      // Deploy + health introspection. Read-only, zero-cost (meta rows only — no
      // feed fetches, no AI). BUILD_VERSION and catalogSize come from the DEPLOYED
      // bundle, so a stale/failed publish is visible in ONE call instead of being
      // inferred from posting counts over hours (the rung-2 "did it deploy?" pain).
      // Also the source of truth for the heartbeat's job_board_deploy check.
      const [prog, pbMeta, rot, refreshMeta, bf, hotMeta, fresh, breaker, dateCov, bsMeta, dsMeta, esMeta] = await Promise.all([
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
        // Per-vendor stated-date coverage (null until the migration lands)
        withDeadline(client.rpc("get_date_coverage"), 2_500),
        client.from("job_board_meta").select("v").eq("k", "bootstrap").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "desc_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "embed_sweep").maybeSingle(),
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
        // Per-posting description sweep: which vendor it's on, and how long
        // since it last moved. Lets a deploy be verified without waiting a day
        // for coverage numbers to shift.
        descSweep: {
          vendor: ((dsMeta.data?.v ?? {}) as { vendor?: string }).vendor ?? null,
          doneAt: ((dsMeta.data?.v ?? {}) as { doneAt?: string }).doneAt ?? null,
          ageMin: dsMeta.data?.updated_at ? Math.round((Date.now() - new Date(dsMeta.data.updated_at).getTime()) / 60000) : null,
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
        postedBackfill: (() => {
          const v = (pbMeta.data?.v ?? {}) as { version?: number; sweptAt?: string; phase?: string; cursor?: string; datedTotal?: number; scannedTotal?: number; note?: string };
          return {
            version: v.version ?? null,
            sweptAt: v.sweptAt ?? null,
            phase: v.phase ?? null,
            cursor: typeof v.cursor === "string" ? v.cursor.slice(0, 60) : null,
            datedTotal: v.datedTotal ?? null,
            note: v.note ?? null,
            scannedTotal: v.scannedTotal ?? null,
            ageMin: pbMeta.data?.updated_at ? Math.round((Date.now() - new Date(pbMeta.data.updated_at).getTime()) / 60000) : null,
            due: postedBackfillDue(v),
          };
        })(),
        // live pipeline health (meta-derived)
        totalPostings: rfV.total ?? null,
        coldBoards: rotV.coldBoards ?? null,
        dormantBoards: Object.keys(dormant).length,
        cursor: { hot: pgV.hot ?? 0, cold: pgV.cold ?? 0, coldDone: pgV.coldDone ?? 0 },
        bootstrapQueue: (() => { const b = (bsMeta.data?.v ?? {}) as { queue?: unknown[]; version?: string }; return { pending: Array.isArray(b.queue) ? b.queue.length : 0, forVersion: b.version ?? null }; })(),
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
        { k: "recategorize_progress", v: { cursor, version: CATEGORIZE_VERSION, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
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
          body: JSON.stringify({ action: "recategorize", chainKey: key, cursor }),
        })).then((r) => r.text()).catch(() => {}));
        return json({ ok: true, scanned, updated, nextCursor: cursor });
      }
      await client.from("job_board_meta").upsert(
        { k: "category_rules_version", v: { version: CATEGORIZE_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
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
      const phase = ["greenhouse", "rippling"].includes(String(body.phase)) ? String(body.phase) as "greenhouse" | "rippling" : "bamboohr";
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
      let cursor = typeof body.cursor === "string" && body.cursor.startsWith(`${phase}:`) ? body.cursor : "";
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
      const NEXT_PHASE: Record<string, string> = { bamboohr: "rippling", rippling: "greenhouse" }; // greenhouse is terminal — the workday phase is retired (see POSTED_BACKFILL_VERSION)
      if (NEXT_PHASE[phase]) {
        chain({ phase: NEXT_PHASE[phase], datedTotal, scannedTotal, note: lastBoardError ? `board ${lastBoardError}` : `phase done: ${datedTotal}/${scannedTotal}` }); // fresh cursor for the next source
        return json({ ok: true, phase, scanned, dated, datedTotal, scannedTotal, next: NEXT_PHASE[phase] });
      }
      await client.from("job_board_meta").upsert(
        { k: "posted_backfill", v: { version: POSTED_BACKFILL_VERSION, sweptAt: new Date().toISOString(), datedTotal, scannedTotal }, updated_at: new Date().toISOString() },
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
          .select("id,salary,country,salary_min_annual,salary_max_annual,salary_period,salary_currency")
          .not("salary", "is", null)
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const row = r as { id: string; salary?: string | null; country?: string | null; salary_min_annual?: number | string | null; salary_max_annual?: number | string | null; salary_period?: string | null; salary_currency?: string | null };
          const p = parseSalaryStructured(row.salary, row.country);
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
        .select("id, country")
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
          const text = job.content ? clean(htmlToText(String(job.content).slice(0, 12000)).trim()).slice(0, 4000) : "";
          if (text) {
            // Backfilled description is also the salary source for these boards
            // (GH giants fetch without content, so ingest-time mining never saw
            // it). Only set when extraction finds the company's own pay text.
            const minedSalary = extractSalary(text);
            const minedParse = minedSalary ? parseSalaryStructured(minedSalary, (row as { country?: string | null }).country ?? undefined) : null;
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
            { k: "desc_sweep", v: { doneAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
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
          .select("id, country") // country → correct bare-$ currency (see backfill-desc)
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
                const clean = text.replace(/\u0000/g, "").slice(0, 4000);
                if (!clean) continue;
                const minedSalary = extractSalary(clean);
                const minedParse = minedSalary ? parseSalaryStructured(minedSalary, (row as { country?: string | null }).country ?? undefined) : null;
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
          body: JSON.stringify({ action: "desc-sweep", chainKey: key, vi, bi }),
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
            if (!text) continue;
            const clean = text.replace(/\u0000/g, "").slice(0, 4000);
            if (!clean) continue;
            // Same rule as ingest: the description is also the salary source
            // where the vendor gave us no structured pay field. Only ever the
            // company's own words — never an estimate.
            const minedSalary = extractSalary(clean);
            const minedParse = minedSalary ? parseSalaryStructured(minedSalary, (row as { country?: string | null }).country) : null;
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
            const wm = wmVendor ?? (row.work_mode ? null : detectWorkMode(row.location, row.title, clean));
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
      if (exhausted) vi += 1;
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "desc-sweep", chainKey: key, vi }),
      })).then((rr) => rr.text()).catch(() => {}));
      return json({ ok: true, vendor, scanned: queue.length, updated, nextVi: vi });
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
      // NEVER delete on a single probe. Measured 2026-07-28: checkLive reported
      // GONE for 7 of 50 randomly sampled LIVE Workday postings — Workday's
      // search index does not contain every externalId its own detail pages
      // still serve, so one miss is not evidence of closure. This branch used to
      // DELETE unconditionally, which is silent destruction of open jobs, and it
      // contradicted the published audit that reports workday accuracy 100%
      // (gone: 0). A user clicking Apply was the thing destroying the row.
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
      const { count: totalRows } = await client.from("job_board_postings").select("id", { count: "exact", head: true });
      const corpus = totalRows ?? 0;
      const VENDORS = [...new Set(JOB_SOURCES.map((s) => s.source))];
      const PER_VENDOR = Math.max(4, Math.floor(AUDIT_SAMPLE / Math.max(1, VENDORS.length)));
      const sampleIds: string[] = [];
      // Per-vendor corpus sizes, kept so an omitted stratum can be reported
      // with its real weight rather than just disappearing.
      const vendorRows: Record<string, number> = {};
      const drawErrors: Record<string, string> = {};
      for (const v of VENDORS) {
        const { count, error: cErr } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).eq("source", v);
        if (cErr) { drawErrors[v] = `count: ${cErr.message}`; continue; }
        const n = count ?? 0;
        vendorRows[v] = n;
        if (n === 0) continue;
        const want = Math.min(PER_VENDOR, n);
        const pages = want > 4 ? 2 : 1;
        const per = Math.ceil(want / pages);
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
        const toks = JOB_SOURCES.filter((s) => s.source === v);
        for (let p = 0; p < pages && toks.length > 0; p++) {
          const anchor = toks[Math.floor(Math.random() * toks.length)];
          let q = client.from("job_board_postings").select("id").eq("source", v)
            .gt("id", `${v}:${anchor.token}:`).order("id").limit(per);
          let { data: page, error: pErr } = await q;
          // A board at the end of the id range yields nothing; wrap to the
          // vendor's start rather than silently contributing zero.
          if (!pErr && (!page || page.length === 0)) {
            ({ data: page, error: pErr } = await client.from("job_board_postings")
              .select("id").eq("source", v).order("id").limit(per));
          }
          if (pErr) { drawErrors[v] = `draw: ${pErr.message}`; continue; }
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
      const missingSources = Object.entries(vendorRows)
        .filter(([v, n]) => n > 0 && !sampledSources.has(v))
        .map(([v, n]) => ({
          source: v,
          postings: n,
          sharePct: corpus > 0 ? Math.round((n / corpus) * 1000) / 10 : null,
          reason: drawErrors[v] ?? "no rows drawn",
        }))
        .sort((a, b) => b.postings - a.postings);
      const coveredPostings = Object.entries(vendorRows)
        .filter(([v, n]) => n > 0 && sampledSources.has(v))
        .reduce((t, [, n]) => t + n, 0);
      const coverage = {
        coveredSharePct: corpus > 0 ? Math.round((coveredPostings / corpus) * 1000) / 10 : null,
        sourcesSampled: sampledSources.size,
        sourcesWithRows: Object.values(vendorRows).filter((n) => n > 0).length,
        missingSources,
      };
      const result = { at: new Date().toISOString(), sampled: sampleIds.length, live, gone, unknown, accuracyPct, corpus, byVendor, coverage, labelAudit };
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
        const minedParse = minedSalary ? parseSalaryStructured(minedSalary, jobRow.country as string | null) : null;
        // Same re-derivation as the sweep: these fields come from description
        // text, so a row that gains a description here should gain them too,
        // rather than waiting for the sweep to reach it. Fill-only for work
        // mode — a vendor's structured field always outranks inference.
        const expRead = detectExperience(String(jobRow.title ?? ""), description);
        const wmRead = jobRow.work_mode ? null : detectWorkMode(jobRow.location as string | null, jobRow.title as string | null, description);
        waitUntil((async () => {
          try {
            await client.from("job_board_postings").update({
              description: description.replace(/\u0000/g, "").slice(0, 4000),
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
      return json({ job: jobRow ? rowToJob(jobRow) : null, description });
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
async function attachRecheckedAt(
  client: SupabaseClient,
  jobs: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const tokens = [...new Set(jobs.map((j) => String(j.companyToken ?? "")).filter(Boolean))].slice(0, 80);
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
    const v = byToken.get(String(j.companyToken ?? ""));
    // verified_at says the FEED was fetched, not that this posting was in it.
    if (v && !j.missingSince) j.recheckedAt = v;
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
});

// One employer's role, reposted per location, was eating up to 35% of a
// results page (measured 2026-07-25). Collapse those into a single result that
// says how many locations it covers, instead of spending 13 slots on it.
const GROUP_OVERFETCH = 3;
const GROUP_SAMPLE_LOCATIONS = 6;

/**
 * Fold rows sharing a cluster key into one, carrying a location count.
 *
 * `rawConsumed` is the number of SOURCE rows this page swallowed, which is what
 * the next page must offset by — the displayed row count no longer equals the
 * rows read, so paginating by jobs.length would re-show siblings as if they
 * were new results. Consumption deliberately continues past the limit for rows
 * that join an ALREADY-emitted cluster, and stops at the first row that would
 * open a new one, so no row is ever skipped or shown twice.
 */
// "Newest first" was, on the default board, one refresh batch sorted
// alphabetically by employer.
//
// The serving sort is `effective_posted DESC, id ASC`. effective_posted is
// coalesce(posted_at, first_seen), and first_seen defaults to now() — which is
// transaction-stable, so every row in a 250-row upsert chunk shares one
// timestamp. Ingest runs per board, so a tie group is ONE employer's postings.
// The id tie-break is `source:token:externalId`, which then walks those
// employers in alphabetical order.
//
// Measured 2026-07-29: 13 of the 60 first-page slots (22%) were taken by two
// employers, in runs of 7 and 6. The data underneath is accurate; the page just
// looks like a low-quality board, and page 1 is what every visitor judges us on.
//
// This does not re-sort — reordering by recency would be a lie about data whose
// recency genuinely ties. It caps how many CONSECUTIVE cards one employer may
// hold, deferring the overflow a little further down. Every posting still
// appears, in the same tie group, so pagination stays stable and no card claims
// to be newer than it is.
const MAX_CONSECUTIVE_PER_COMPANY = 2;

function interleaveByCompany(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let deferred: Array<Record<string, unknown>> = [];
  let runKey = "";
  let runLen = 0;
  const keyOf = (r: Record<string, unknown>) => String(r.company ?? r.company_token ?? "");
  // The TIE GROUP a row belongs to. Reordering is only honest inside one:
  // rows sharing an effective_posted are genuinely equally recent, so their
  // relative order carries no information and may be permuted freely. Moving a
  // row ACROSS groups would make the page claim a recency it does not have —
  // which the previous version did, inverting 22 of 59 adjacent pairs (max
  // 55.3s) while its own comment promised the opposite.
  const tieOf = (r: Record<string, unknown>) => String(r.postedAt ?? r.effective_posted ?? r.firstSeen ?? "");
  let tie = rows.length ? tieOf(rows[0]) : "";
  const flush = () => { out.push(...deferred); deferred = []; runKey = ""; runLen = 0; };
  for (const r of rows) {
    const t = tieOf(r);
    if (t !== tie) { flush(); tie = t; }   // group boundary: nothing crosses it
    const k = keyOf(r);
    if (k && k === runKey && runLen >= MAX_CONSECUTIVE_PER_COMPANY) { deferred.push(r); continue; }
    // A deferred row is eligible again as soon as a different employer breaks
    // the run, so nothing is pushed to the end of the group wholesale.
    if (k === runKey) runLen++; else { runKey = k; runLen = 1; }
    out.push(r);
    if (deferred.length) {
      const i = deferred.findIndex((d) => keyOf(d) !== runKey);
      if (i >= 0) {
        const [d] = deferred.splice(i, 1);
        runKey = keyOf(d); runLen = 1;
        out.push(d);
      }
    }
  }
  flush();
  return out;
}

function collapseClusters(
  rows: Array<Record<string, unknown>>,
  limit: number,
): { jobs: Array<Record<string, unknown>>; rawConsumed: number } {
  const out: Array<Record<string, unknown>> = [];
  const byKey = new Map<string, Record<string, unknown>>();
  let rawConsumed = 0;
  for (const r of rows) {
    // Keyed on the display NAME, not the feed token: PwC's five sub-boards
    // must fold together. Two different employers sharing an identical display
    // name AND an identical title is the residual risk, accepted — users could
    // not tell those cards apart anyway.
    const key = clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""));
    const hit = byKey.get(key);
    if (!hit && out.length >= limit) break; // next page starts exactly here
    rawConsumed++;
    if (hit) {
      hit.locationCount = (Number(hit.locationCount) || 1) + 1;
      const locs = hit.otherLocations as string[];
      const loc = typeof r.location === "string" ? r.location.trim() : "";
      // Distinct locations only — the same town genuinely recurs (one employer
      // had the same role twice in Pueblo, CO), and listing it twice would be
      // noise. locationCount above still counts every posting.
      if (loc && loc !== hit.location && locs.length < GROUP_SAMPLE_LOCATIONS && !locs.includes(loc)) locs.push(loc);
      continue;
    }
    const row = { ...r, locationCount: 1, otherLocations: [] as string[] };
    byKey.set(key, row);
    out.push(row);
  }
  // Only surface the grouping fields when there is actually a group.
  for (const row of out) {
    if ((Number(row.locationCount) || 1) < 2) {
      delete row.locationCount;
      delete row.otherLocations;
    }
  }
  return { jobs: out, rawConsumed };
}

// One employer, several feed tokens (PwC ships five Workday sub-sites; 76 such
// employers in the top 1,500 alone, 43k postings). Serving the facet raw put
// "PwC" in the company dropdown five times, each filtering to a fifth of the
// real roles. Merge by display name: one row, counts summed, every token
// carried so the filter can cover them all. The primary token is the largest
// sub-board's (stable for links).
function mergeCompanyFacet(rows: Array<{ token?: string; name?: string; count?: number }>): Array<{ token?: string; name?: string; count?: number; tokens?: string[] }> {
  const byName = new Map<string, { token?: string; name?: string; count: number; tokens: string[]; top: number }>();
  const out: Array<{ token?: string; name?: string; count?: number; tokens?: string[] }> = [];
  for (const r of rows) {
    const key = (r.name ?? "").trim().toLowerCase();
    if (!key) { out.push(r); continue; }
    const hit = byName.get(key);
    const n = r.count ?? 0;
    if (!hit) {
      byName.set(key, { token: r.token, name: r.name, count: n, tokens: r.token ? [r.token] : [], top: n });
    } else {
      hit.count += n;
      if (r.token) hit.tokens.push(r.token);
      if (n > hit.top) { hit.top = n; hit.token = r.token; }
    }
  }
  for (const v of byName.values()) {
    out.push(v.tokens.length > 1 ? { token: v.token, name: v.name, count: v.count, tokens: v.tokens } : { token: v.token, name: v.name, count: v.count });
  }
  return out;
}

async function serveList(
  client: SupabaseClient,
  body: Record<string, unknown>,
  meta?: { v: Record<string, unknown>; updated_at: string } | null,
) {
  const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const countOnly = body.countOnly === true;
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
  if (typeof body.category === "string") body.category = body.category.toLowerCase();
  if (typeof body.workMode === "string") body.workMode = body.workMode.toLowerCase();
  const unfiltered =
    !String(body.q ?? "").trim() &&
    !String(body.location ?? "").trim() &&
    !/^[A-Za-z]{2}$/.test(String(body.country ?? "")) &&
    body.remote !== true &&
    !["remote", "hybrid", "onsite"].includes(String(body.workMode ?? "")) &&
    !(JOB_CATEGORIES as readonly string[]).includes(String(body.category ?? "")) &&
    !String(body.experience ?? "").trim() &&
    !(Number(body.salaryFloor) > 0) &&
    !(Array.isArray(body.companies) && body.companies.length) &&
    !(Number(body.maxAgeDays) >= 1) &&
    typeof body.postedAfter !== "string";
  const wantCount = !(unfiltered && Number.isFinite(metaTotal) && metaTotal > 0);
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
  const buildQuery = (dateCol: string, withCount = wantCount) => {
    let q = client
      .from("job_board_postings")
      .select(
        "id,source,company_token,company,title,location,remote,work_mode,department,category,posted_at,apply_url,salary,salary_min_annual,salary_max_annual,salary_period,salary_currency,experience_band,min_years,last_seen,missing_since",
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
    const terms = String(body.q ?? "").toLowerCase().split(/\s+/).map(sanitizeTerm).filter(Boolean).slice(0, 8);
    for (const t of terms) q = q.or(`title.ilike.%${t}%,company.ilike.%${t}%,department.ilike.%${t}%`);
    const loc = sanitizeTerm(String(body.location ?? ""));
    if (loc) q = q.ilike("location", `%${loc}%`);
    // An explicit workMode WINS over the legacy `remote` boolean. These are not
    // independent predicates: remote=true is a strict SUBSET of
    // work_mode='remote' (normalize.ts:1069), so ANDing them equals the
    // stricter one and silently narrows the user's own choice. Measured:
    // {workMode:remote,country:GB} 1,518 vs 1,403 UI-shaped (7.6% lost),
    // design 614 -> 582 (5.2%), data_ai 848 -> 752 (11.3%).
    if (body.remote === true && !["remote", "hybrid", "onsite"].includes(String(body.workMode ?? "").toLowerCase())) {
      q = q.eq("remote", true);
    }
    // Work-mode filter: definitive vendor/text-stated tags only. Postings that
    // don't state a mode have work_mode NULL and are excluded by the filter —
    // honestly, never guessed (the UI says so).
    // Case-normalized (audit: {workMode:"Remote"} silently served the full
    // unfiltered board to API callers — the fence says filters are never
    // silently ignored, so at minimum every casing of a real value binds).
    const wm = String(body.workMode ?? "").toLowerCase();
    if (wm === "remote" || wm === "hybrid" || wm === "onsite") q = q.eq("work_mode", wm);
    // Country filter: exact match on the deterministically extracted code.
    // Postings whose location we couldn't place have country NULL and are
    // excluded by the filter — honestly, never guessed (the UI says so).
    const country = String(body.country ?? "").toUpperCase();
    if (/^[A-Z]{2}$/.test(country)) q = q.eq("country", country);
    const category = String(body.category ?? "").toLowerCase();
    if ((JOB_CATEGORIES as readonly string[]).includes(category)) q = q.eq("category", category);
    // Experience filter: one of entry/mid/senior/expert. "unspecified" rows are
    // never returned by a band filter — we only surface postings we can honestly
    // place. Accepts a comma list so a user can widen (e.g. "senior,expert").
    const expParam = String(body.experience ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(isExperienceBand);
    if (expParam.length === 1) q = q.eq("experience_band", expParam[0]);
    else if (expParam.length > 1) q = q.in("experience_band", expParam);
    // Salary floor filters the annualized lower bound of the posting's OWN
    // stated pay, compared in APPROXIMATE USD via salary_rank_usd — the same
    // generated column salary sorting uses. The raw-number comparison this
    // replaced passed SEK/JPY rows whose figures merely LOOK large (SEK 1M ≈
    // $95k cleared a $100k floor) and failed EUR/GBP rows that genuinely
    // clear it. Postings without a stated salary, or whose currency we can't
    // identify (rank NULL), are excluded by the filter, honestly, not
    // guessed at. Displayed salaries stay exactly as the posting states them.
    const floor = Number(body.salaryFloor);
    if (Number.isFinite(floor) && floor > 0) q = q.gte("salary_rank_usd", Math.min(floor, 2_000_000));
    if (Array.isArray(body.companies)) {
      const tokens = body.companies.filter((c): c is string => typeof c === "string").slice(0, JOB_SOURCES.length);
      if (tokens.length) q = q.in("company_token", tokens);
    }
    // Saved searches ask "how many NEW since I last looked" — a cheap count.
    if (typeof body.postedAfter === "string" && !Number.isNaN(Date.parse(body.postedAfter))) {
      q = q.gt(dateCol, body.postedAfter);
    }
    // "Posted this week" quick filter: company-stated dates ONLY (posted_at,
    // never first_seen — our discovery time can't make a posting fresh).
    // Undated postings are excluded by the filter, honestly; the UI says so.
    const maxAge = Number(body.maxAgeDays);
    if (Number.isFinite(maxAge) && maxAge >= 1) {
      q = q.gte("posted_at", new Date(Date.now() - Math.min(maxAge, 30) * 86_400_000).toISOString());
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
    const expArr = String(body.experience ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(isExperienceBand);
    const compArr = Array.isArray(body.companies)
      ? body.companies.filter((c): c is string => typeof c === "string").slice(0, JOB_SOURCES.length)
      : [];
    const maxAgeNum = Number(body.maxAgeDays);
    const wm = String(body.workMode ?? "").toLowerCase(); // normalised at the door too; belt and braces
    // Multi-term queries: the page ANDs each term (any of title/company/dept per
    // term) while the RPC treats p_q as ONE contiguous ILIKE. "senior nurse"
    // matches "Senior Registered Nurse" on the page but not in that count — the
    // summary could read "Showing 60 of 12". Only single terms match the page's
    // semantics; multi-term falls back (null) to the inline exact count, which
    // uses the identical buildQuery filter. Rare path: it is reached only when
    // the ranked search (which carries its own total) has already failed.
    const qTerms = String(body.q ?? "").toLowerCase().split(/\s+/).map(sanitizeTerm).filter(Boolean);
    if (qTerms.length > 1) return null;
    try {
      const { data, error } = await client.rpc("count_jobs_capped", {
        p_fresh_cutoff: freshCutoffIso,
        p_q: qTerms.length === 1 ? qTerms[0] : null,
        p_location: sanitizeTerm(String(body.location ?? "")) || null,
        p_remote: body.remote === true ? true : null,
        p_country: /^[A-Za-z]{2}$/.test(String(body.country ?? "")) ? String(body.country).toUpperCase() : null,
        p_category: (JOB_CATEGORIES as readonly string[]).includes(String(body.category ?? "").toLowerCase()) ? String(body.category).toLowerCase() : null,
        p_experience: expArr.length ? expArr : null,
        p_salary_floor: Number(body.salaryFloor) > 0 ? Math.min(Number(body.salaryFloor), 2_000_000) : null,
        p_companies: compArr.length ? compArr : null,
        p_posted_after: typeof body.postedAfter === "string" && !Number.isNaN(Date.parse(body.postedAfter)) ? body.postedAfter : null,
        p_max_age_days: Number.isFinite(maxAgeNum) && maxAgeNum >= 1 ? Math.min(maxAgeNum, 30) : null,
        p_work_mode: ["remote", "hybrid", "onsite"].includes(wm) ? wm : null,
        p_cap: COUNT_CAP,
      });
      if (error || !Array.isArray(data) || !data.length) return null;
      const row = data[0] as { n?: number | string; capped?: boolean };
      const n = Number(row.n);
      return Number.isFinite(n) ? { n, capped: row.capped === true } : null;
    } catch {
      return null; // RPC missing — caller keeps the old exact-count behaviour
    }
  };

  if (countOnly) {
    if (!wantCount) return json({ total: metaTotal }); // unfiltered — the maintained catalog total
    // With a query present, count what the LIST path would actually serve —
    // the FTS ranked tiers — not the ILIKE approximation. Measured
    // 2026-07-25: the two disagreed up to 4.3x on the same body, so
    // relaxation buttons advertised counts that clicking couldn't reproduce
    // and the disclosure denominator went negative.
    const qTextC = String(body.q ?? "").trim().slice(0, 200);
    if (qTextC && body.sort !== "salary" && body.sort !== "newest") {
      try {
        const expArrC = String(body.experience ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(isExperienceBand);
        const compArrC = Array.isArray(body.companies)
          ? body.companies.filter((c): c is string => typeof c === "string").slice(0, JOB_SOURCES.length)
          : [];
        const maxAgeC = Number(body.maxAgeDays);
        const wmC = String(body.workMode ?? "").toLowerCase();
        const { q: expQC } = expandQuery(qTextC);
        const { data: rc, error: ec } = await client.rpc("search_jobs", {
          p_q: expQC,
          p_fresh_cutoff: freshCutoffIso,
          p_location: sanitizeTerm(String(body.location ?? "")) || null,
          p_remote: body.remote === true ? true : null,
          p_country: /^[A-Za-z]{2}$/.test(String(body.country ?? "")) ? String(body.country).toUpperCase() : null,
          p_category: (JOB_CATEGORIES as readonly string[]).includes(String(body.category ?? "").toLowerCase()) ? String(body.category).toLowerCase() : null,
          p_experience: expArrC.length ? expArrC : null,
          p_salary_floor: Number(body.salaryFloor) > 0 ? Math.min(Number(body.salaryFloor), 2_000_000) : null,
          p_companies: compArrC.length ? compArrC : null,
          p_posted_after: typeof body.postedAfter === "string" && !Number.isNaN(Date.parse(body.postedAfter)) ? body.postedAfter : null,
          p_max_age_days: Number.isFinite(maxAgeC) && maxAgeC >= 1 ? Math.min(maxAgeC, 30) : null,
          ...(["remote", "hybrid", "onsite"].includes(wmC) ? { p_work_mode: wmC } : {}),
          p_limit: 1,
          p_offset: 0,
        });
        if (!ec && Array.isArray(rc)) {
          const tC = rc.length ? Number((rc[0] as { total_rows?: number }).total_rows) || rc.length : 0;
          // Tier-aware ceiling, same contract as the list path: the description
          // tier caps at 3,000, so a bare "3000" here was presented as an exact
          // figure when the truth is higher (bug sweep 2026-07-26).
          const tier2C = (rc as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string" && r.snippet.length > 0);
          return json({ total: tC, ...(tC >= (tier2C ? 3_000 : 10_000) ? { countCapped: true } : {}) });
        }
      } catch { /* migration lag or malformed query — the capped/ILIKE path below still answers */ }
    }
    const capped = await cappedCount();
    if (capped) return json({ total: capped.n, ...(capped.capped ? { countCapped: true } : {}) });
    let { count, error } = await buildQuery("effective_posted").range(0, 0);
    if (missingColumn(error)) ({ count, error } = await buildQuery("posted_at").range(0, 0));
    // Same rule as the list path: a count that can't be computed is reported as
    // unknown, never as 0. Callers (the disclosure hook, saved-search "new
    // since" badges) treat a non-number as "no answer" and show nothing, which
    // is right — a 0 here would claim the filter matches nothing.
    if (error) return json({ total: null, countUnavailable: true });
    return json({ total: count ?? 0 });
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
  const qText = String(body.q ?? "").trim().slice(0, 200);
  if (qText && body.sort !== "salary" && body.sort !== "newest" && !countOnly) {
    try {
      const expArr = String(body.experience ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(isExperienceBand);
      const compArr = Array.isArray(body.companies)
        ? body.companies.filter((c): c is string => typeof c === "string").slice(0, JOB_SOURCES.length)
        : [];
      const maxAgeNum = Number(body.maxAgeDays);
      const wmParam = String(body.workMode ?? "").toLowerCase();
      // Role-alias expansion (disclosed): "swe" also searches "software
      // engineer" etc. The expanded websearch string keeps the original
      // spelling as its own OR-branch, and the response names every added
      // phrase so the UI can show "also matching: …".
      const { q: expandedQ, expansions } = expandQuery(qText);
      const { data: ranked, error: rankErr } = await client.rpc("search_jobs", {
        p_q: expandedQ,
        p_fresh_cutoff: freshCutoffIso,
        p_location: sanitizeTerm(String(body.location ?? "")) || null,
        p_remote: body.remote === true ? true : null,
        p_country: /^[A-Za-z]{2}$/.test(String(body.country ?? "")) ? String(body.country).toUpperCase() : null,
        p_category: (JOB_CATEGORIES as readonly string[]).includes(String(body.category ?? "").toLowerCase()) ? String(body.category).toLowerCase() : null,
        p_experience: expArr.length ? expArr : null,
        p_salary_floor: Number(body.salaryFloor) > 0 ? Math.min(Number(body.salaryFloor), 2_000_000) : null,
        p_companies: compArr.length ? compArr : null,
        p_posted_after: typeof body.postedAfter === "string" && !Number.isNaN(Date.parse(body.postedAfter)) ? body.postedAfter : null,
        p_max_age_days: Number.isFinite(maxAgeNum) && maxAgeNum >= 1 ? Math.min(maxAgeNum, 30) : null,
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
        ...(["remote", "hybrid", "onsite"].includes(wmParam) ? { p_work_mode: wmParam } : {}),
        p_limit: fetchLimit,
        p_offset: offset,
      });
      if (!rankErr && Array.isArray(ranked)) {
        // A load-more just past an exactly-full final page must not overwrite
        // the client's header with 0 — null is "count unavailable", which the
        // client already renders honestly (2026-07-25 audit: a 180-match
        // search flipped to "0 matching" above 180 visible results).
        const total = ranked.length ? Number((ranked[0] as { total_rows?: number }).total_rows) || ranked.length : (offset > 0 ? null : 0);
        // search_jobs counts inside a LIMIT — 10,000 on the title tier, 3,000 on
        // the sampled description tier — so a broad term like "engineer" or
        // "nurse" comes back as EXACTLY the ceiling. Reported bare that reads as
        // an exact figure ("10000 matching openings") when the truth is higher.
        // Flag it so the client renders "10,000+", same contract the recency
        // path already uses. Tier is inferred from the snippet column, which
        // only the description tier populates.
        const rankedTier2 = (ranked as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string" && r.snippet.length > 0);
        const rankedCap = rankedTier2 ? 3_000 : 10_000;
        const rankedCapped = (total ?? 0) >= rankedCap;
        const v0 = (meta?.v ?? {}) as Record<string, unknown>;
        // FILTER GATE — shared by every rescue tier (fuzzy replacement,
        // semantic, and the low-result fuzzy augmentation below). None of the
        // rescue RPCs carry filter parameters, so with any restrictive filter
        // active they all stand down: the filtered (possibly empty) answer IS
        // the honest answer. This gate is the fence that once broke on a
        // company lander serving other companies' jobs for a typo'd query.
        const filtersActive =
          !!sanitizeTerm(String(body.location ?? "")) ||
          body.remote === true ||
          ["remote", "hybrid", "onsite"].includes(String(body.workMode ?? "").toLowerCase()) ||
          /^[A-Za-z]{2}$/.test(String(body.country ?? "")) ||
          (JOB_CATEGORIES as readonly string[]).includes(String(body.category ?? "").toLowerCase()) ||
          String(body.experience ?? "").trim() !== "" ||
          Number(body.salaryFloor) > 0 ||
          (Array.isArray(body.companies) && body.companies.length > 0) ||
          Number(body.maxAgeDays) >= 1 ||
          typeof body.postedAfter === "string";
        // Empty ranked result: try the FAST trigram fuzzy fallback right here
        // ("desinger" → designer), then return an honest empty. Critically we
        // do NOT fall through to the recency path — its OR-of-ILIKE with an
        // exact count seq-scans 550k rows for a no-match term and times out
        // (measured 9.7s → "temporarily unavailable"). The ranked + fuzzy
        // paths are both index-backed and fast.
        // `total === 0` only — a null total means "count unavailable", which is
        // not the same claim as "nothing matches" (see the recency-path twin).
        if (total === 0 && offset === 0 && !countOnly) {
          // Demand telemetry, ranked path — logged AT EACH TERMINAL with its
          // rescue outcome. The single up-front insert counted typo queries
          // that fuzzy then rescued as if they were catalog gaps, so the
          // steering signal conflated "we lack this" with "they misspelled
          // this". `rescued` tells the census which is which: 'none' is a real
          // gap; 'fuzzy'/'semantic' means the user was served something and
          // the gap is softer.
          const logMiss = (rescued: "none" | "fuzzy" | "semantic") => {
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
                  category: String(body.category ?? "") || undefined,
                  experience: String(body.experience ?? "") || undefined,
                  remote: body.remote === true || undefined,
                  workMode: ["remote", "hybrid", "onsite"].includes(wmParam) ? wmParam : undefined,
                  country: /^[A-Za-z]{2}$/.test(String(body.country ?? "")) ? String(body.country).toUpperCase() : undefined,
                },
              }),
            ).then(() => {}).catch(() => {}));
          };
          // (filtersActive hoisted above — shared with the augmentation tier.)
          if (!filtersActive) try {
            const { data: fuzzy, error: fErr } = await client.rpc("fuzzy_title_search", {
              p_q: qText, p_fresh_cutoff: freshCutoffIso, p_limit: limit,
            });
            if (!fErr && Array.isArray(fuzzy) && fuzzy.length > 0) {
              // Same-company+title clones flood trigram results exactly like
              // the other tiers — collapse them the same way (audit: adjacent
              // duplicate cards were measured on typo queries).
              const fuzzyRows = (fuzzy as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              const fuzzyGrouped = groupSimilar
                ? collapseClusters(fuzzyRows, limit)
                : { jobs: fuzzyRows.slice(0, limit), rawConsumed: Math.min(fuzzyRows.length, limit) };
              logMiss("fuzzy");
              return json({
                jobs: await attachRecheckedAt(client, fuzzyGrouped.jobs),
                total: Number((fuzzy[0] as { total_rows?: number }).total_rows) || fuzzyGrouped.jobs.length,
                totalAllCompanies: (v0.total as number) ?? 0,
                companies: [],
                companiesCount: ((v0.companiesFacet as unknown[]) ?? []).length,
                // Board-wide, from the cached facet row — CORRECT only on the unfiltered
          // view. Rendered inside a filtered view it overstated by 15.7x to 45x
          // (sum 587,793 shown beside a filtered total of 10,000 or less), which
          // is a wrong number on every filtered session. Omit rather than
          // mislead: the UI already handles an absent facet, and a count we
          // cannot scope to the query is a count we should not publish.
          categories: unfiltered ? ((v0.categoriesFacet as Record<string, number>) ?? {}) : undefined,
                failedSources: (v0.failedSources as string[]) ?? [],
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
          if (qText.length >= 3 && !filtersActive) {
            try {
              const qVec = await embedText(qText);
              if (qVec) {
                const { data: sem, error: sErr } = await client.rpc("search_jobs_semantic", {
                  p_embedding: JSON.stringify(qVec),
                  p_limit: fetchLimit,
                });
                if (!sErr && Array.isArray(sem) && sem.length > 0) {
                  // Same-role-many-locations clones are mutually nearest in
                  // embedding space, so the top-k is especially prone to being
                  // one job repeated — collapse exactly like the other tiers.
                  const semRows = (sem as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
                  const semGrouped = groupSimilar
                    ? collapseClusters(semRows, limit)
                    : { jobs: semRows.slice(0, limit), rawConsumed: Math.min(semRows.length, limit) };
                  logMiss("semantic");
                  return json({
                    jobs: await attachRecheckedAt(client, semGrouped.jobs),
                    total: semGrouped.jobs.length,
                    hasMore: false,
                    totalAllCompanies: (v0.total as number) ?? 0,
                    companies: [],
                    companiesCount: ((v0.companiesFacet as unknown[]) ?? []).length,
                    // Board-wide, from the cached facet row — CORRECT only on the unfiltered
          // view. Rendered inside a filtered view it overstated by 15.7x to 45x
          // (sum 587,793 shown beside a filtered total of 10,000 or less), which
          // is a wrong number on every filtered session. Omit rather than
          // mislead: the UI already handles an absent facet, and a count we
          // cannot scope to the query is a count we should not publish.
          categories: unfiltered ? ((v0.categoriesFacet as Record<string, number>) ?? {}) : undefined,
                    failedSources: (v0.failedSources as string[]) ?? [],
                    refreshedAt: (v0.refreshedAt as string) ?? null,
                    semantic: qText,
                  });
                }
              }
            } catch { /* semantic is a bonus — the honest empty below stands */ }
          }
          // Neither rescue tier answered (or filters kept them fenced out):
          // this is the real "we lack it" signal the census steers by.
          logMiss("none");
        }
        const includeFacets0 = (body as { includeFacets?: boolean }).includeFacets !== false;
        const fullCompanies0 = (v0.companiesFacet as Array<{ count?: number }>) ?? [];
        const rankedRows = (ranked as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
        const rankedGrouped = groupSimilar
          ? collapseClusters(rankedRows, limit)
          : { jobs: rankedRows.slice(0, limit), rawConsumed: Math.min(rankedRows.length, limit) };
        // LOW-RESULT AUGMENTATION. The rescue tiers used to fire only on
        // total === 0, so ONE posting that happened to share the user's typo
        // ("desinger" appearing verbatim in a single title) suppressed the
        // hundreds of corrected matches fuzzy would have found. When a typed
        // query lands 1-4 exact matches unfiltered, run the trigram tier too
        // and APPEND its novel rows — each marked closeMatch:true and the
        // response carrying fuzzyExtra, so the client labels them as close
        // matches instead of passing them off as exact ones. Exact matches
        // keep their position; nothing is reordered or replaced.
        let fuzzyExtraOut: { q: string; count: number } | null = null;
        if (total !== null && total > 0 && total < 5 && offset === 0 && !countOnly && !filtersActive && qText.length >= 3) {
          try {
            const { data: fz, error: fzErr } = await client.rpc("fuzzy_title_search", {
              p_q: qText, p_fresh_cutoff: freshCutoffIso, p_limit: limit,
            });
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
                rankedGrouped.jobs.push(...extra);
                fuzzyExtraOut = { q: qText, count: extra.length };
              }
            }
          } catch { /* augmentation is a bonus — exact matches alone stand */ }
        }
        return json({
          jobs: rankedGrouped.jobs,
          nextOffset: offset + rankedGrouped.rawConsumed,
          hasMore: rankedRows.length > rankedGrouped.rawConsumed || rankedRows.length === fetchLimit,
          total,
          ...(rankedCapped ? { countCapped: true } : {}),
          totalAllCompanies: (v0.total as number) ?? total,
          companies: includeFacets0
            ? mergeCompanyFacet([...fullCompanies0].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 1_500) as Array<{ token?: string; name?: string; count?: number }>)
                .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
            : [],
          companiesCount: fullCompanies0.length,
          // Board-wide, from the cached facet row — CORRECT only on the unfiltered
          // view. Rendered inside a filtered view it overstated by 15.7x to 45x
          // (sum 587,793 shown beside a filtered total of 10,000 or less), which
          // is a wrong number on every filtered session. Omit rather than
          // mislead: the UI already handles an absent facet, and a count we
          // cannot scope to the query is a count we should not publish.
          categories: unfiltered ? ((v0.categoriesFacet as Record<string, number>) ?? {}) : undefined,
          failedSources: (v0.failedSources as string[]) ?? [],
          refreshedAt: (v0.refreshedAt as string) ?? null,
          ranked: true,
          ...(expansions.length ? { aliases: expansions } : {}),
          ...(fuzzyExtraOut ? { fuzzyExtra: fuzzyExtraOut } : {}),
        });
      }
    } catch { /* fall through to recency path */ }
  }
  const sortSalary = body.sort === "salary";
  const pageWith = (dateCol: string, salaryCol: string, withCount: boolean) =>
    (sortSalary
      ? buildQuery(dateCol, withCount).order(salaryCol, { ascending: false, nullsFirst: false })
      : buildQuery(dateCol, withCount).order(dateCol, { ascending: false, nullsFirst: false })
    )
      .order("id", { ascending: true })
      .range(offset, offset + fetchLimit - 1);

  // Page and count run CONCURRENTLY and independently: the page never waits on
  // a count, and a count that fails can't take the page down with it. The page
  // is consistently ~0.3s; it was the exact count riding the same query that
  // made broad filters take 3-9s.
  const [firstPage, cappedRes] = await Promise.all([
    pageWith("effective_posted", "salary_rank_usd", false),
    wantCount ? cappedCount() : Promise.resolve(null),
  ]);
  // Only fall back to the old inline exact count when the capped RPC isn't
  // there (migration not applied yet).
  const needInlineCount = wantCount && !cappedRes;
  const page = (dateCol: string, salaryCol: string) => pageWith(dateCol, salaryCol, needInlineCount);
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
  let countUnavailable = false;
  if (error && wantCount) {
    const noCount = (dateCol: string, salaryCol: string) =>
      (sortSalary
        ? buildQuery(dateCol, false).order(salaryCol, { ascending: false, nullsFirst: false })
        : buildQuery(dateCol, false).order(dateCol, { ascending: false, nullsFirst: false })
      ).order("id", { ascending: true }).range(offset, offset + fetchLimit - 1);
    let retry = await noCount("effective_posted", "salary_rank_usd");
    if (sortSalary && retry.error?.message?.includes("salary_rank_usd")) retry = await noCount("effective_posted", "salary_min_annual");
    if (missingColumn(retry.error)) retry = await noCount("posted_at", "salary_min_annual");
    if (!retry.error) {
      data = retry.data;
      error = null;
      count = null;
      countUnavailable = true;
      console.warn(`[JOB-BOARD] exact count timed out; served page without it (maxAgeDays=${String(body.maxAgeDays ?? "")} category=${String(body.category ?? "")})`);
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
          category: String(body.category ?? "") || undefined,
          experience: String(body.experience ?? "") || undefined,
          remote: body.remote === true || undefined,
          salaryFloor: Number(body.salaryFloor) || undefined,
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
  const FACET_COMPANY_LIMIT = 1_500;
  const fullCompanies = (v.companiesFacet as Array<{ count?: number }>) ?? [];
  const servedCompanies = includeFacets
    ? mergeCompanyFacet([...fullCompanies].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, FACET_COMPANY_LIMIT) as Array<{ token?: string; name?: string; count?: number }>)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    : [];
  const mappedRows = (data ?? []).map(rowToJob) as Array<Record<string, unknown>>;
  const grouped = groupSimilar
    ? collapseClusters(mappedRows, limit)
    : { jobs: mappedRows.slice(0, limit), rawConsumed: Math.min(mappedRows.length, limit) };
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
  return json({
    jobs: await attachRecheckedAt(client, grouped.jobs),
    // Raw rows this page swallowed. The client MUST page by this rather than by
    // jobs.length once clusters are folded, or the siblings of a collapsed
    // result reappear on the next page as if they were new.
    nextOffset: offset + grouped.rawConsumed,
    // null (not 0) when the count timed out — 0 would read as "no matches" and
    // trip the zero-state on a page that is visibly full of results.
    total: countUnavailable ? null : (wantCount ? (count ?? 0) : metaTotal),
    ...(countUnavailable ? { countUnavailable: true } : {}),
    // The count stopped at the cap: the real figure is higher, so the client
    // renders "10,000+" rather than presenting the cap as an exact total.
    ...(cappedRes?.capped ? { countCapped: true } : {}),
    // A full page means there is at least one more; the client needs this to
    // keep "load more" alive when it has no total to compare against.
    hasMore: (data ?? []).length > grouped.rawConsumed || (data ?? []).length === fetchLimit,
    totalAllCompanies: (v.total as number) ?? count ?? 0,
    companies: servedCompanies,
    companiesCount: fullCompanies.length,
    categories: (v.categoriesFacet as Record<string, number>) ?? {},
    failedSources: (v.failedSources as string[]) ?? [],
    refreshedAt: (v.refreshedAt as string) ?? null,
  });
}
