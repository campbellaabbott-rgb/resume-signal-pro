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
  normalizePaylocity,
  extractPaylocityPageData,
  normalizeAdp,
  adpBoardParams,
  extractRipplingJobPosts,
  normalizeWorkday,
  normalizeOracle,
  detectCountry,
  greenhouseApi,
  leverApi,
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
import { categoryParam, extraFilterParams, filterViolations, isUnfiltered, normalizeFilters, payParams, rpcBlindFilters, rescueVendorsParam, SALARIED_PERIODS, sendableSourcesParam, splitPage, salaryFromQueryText, SALARY_IN_QUERY, WIDENING_FILTERS } from "./filters.ts";
import { pickRoute, rerankWindow, RETRIEVER_FOR, splitExclusions, titleExcluded } from "./search-routing.ts";
import { planRankedPage, RANKED_WINDOW, RING_WINDOW } from "./paging.ts";
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
const SITEMAP_DAYS = 30;
const BUILD_VERSION = "2026-08-30.18"; 
const NAME_SYNC_VERSION = 3;
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
  "nfamilyclub",
  "gianttiger~wd3~gianttiger",
  "picknpay~wd3~PNP_Careers",
  "alignmenthealthcare~wd12~ahc_external",
  "embryriddle~wd1~External",
  "embryriddle~wd1~AdjunctFacultyOpportunities",
  "standoutforgood~wd12~StandOutForGood",
  "trilongroup",
  "exactcare~wd1~AnewHealth_Career_Site",
];
const STALE_MS = 12 * 60_000; 
const LOCK_MS = 5 * 60_000; 
const FETCH_TIMEOUT_MS = 20_000;
const CONCURRENCY = 8;
const HOT_CONCURRENCY = 2; 
const DESC_SWEEP_PER_HOP = 120;
const STORED_DESC_CAP = 12_000;
const RAW_HTML_CAP = 24_000;
const DESC_SWEEP_CONCURRENCY = 8;
const STRUCTURED_SWEEP_SOURCES: readonly string[] = ["workday"];
const STRUCTURED_SWEEP_PER_HOP = 24;
const HOT_SLICE = 10;
const COLD_SLICE = 80; 
const BOOTSTRAP_PER_SLICE = 25; 
const DEEP_PER_SLICE = 8;
const RETRY_PER_SLICE = 5;
const HEADLINE_MAX_AGE_MS = 15 * 60_000; 
const SLICE_LOCK_MS = 3 * 60_000; 
const DESC_CAP = 14_000; 
const db = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const waitUntil = (p: Promise<unknown>) => {
  const guarded = p.catch((e) => console.warn("[JOB-BOARD] background task failed:", e));
  try {
    (globalThis as any).EdgeRuntime?.waitUntil?.(guarded);
  } catch {
  }
};
const DYNAMIC_LIGHT = new Set<string>();
const AUTO_LIGHT_THRESHOLD_CHARS = 2_500_000; 
const AUTO_LIGHT_CAP = 50; 
const isLight = (token: string) => LIGHT_DESC_TOKENS.has(token) || DYNAMIC_LIGHT.has(token);
async function loadDynamicLight(client: SupabaseClient): Promise<void> {
  try {
    const { data } = await client.from("job_board_meta").select("v").eq("k", "light_desc_dynamic").maybeSingle();
    const tokens = (data?.v as { tokens?: unknown } | null)?.tokens;
    DYNAMIC_LIGHT.clear();
    if (Array.isArray(tokens)) for (const t of tokens) if (typeof t === "string") DYNAMIC_LIGHT.add(t);
  } catch {  }
}
const listUrl = (s: JobSource, startOffset = 0) =>
  s.source === "greenhouse"
    ? (({ host, token }) => `https://${host}/v1/boards/${token}/jobs${isLight(s.token) ? "" : "?content=true"}`)(greenhouseApi(s.token))
    : s.source === "lever"
      ? (({ host, token }) => `https://${host}/v0/postings/${token}?mode=json`)(leverApi(s.token))
      : s.source === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${s.token}?includeCompensation=true`
        : s.source === "smartrecruiters"
          ? `https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100${startOffset ? `&offset=${startOffset}` : ""}`
          : s.source === "workable"
            ? `https://apply.workable.com/api/v1/widget/accounts/${s.token}?details=${isLight(s.token) ? "false" : "true"}`
            : s.source === "recruitee"
              ? `https://${s.token}.recruitee.com/api/offers/`
              : s.source === "breezy"
                ? `https://${s.token}.breezy.hr/json`
                : s.source === "teamtailor"
                  ? `https://${s.host ?? `${s.token}.teamtailor.com`}/jobs.rss`
                  : `https://${s.token}.bamboohr.com/careers/list`;
const SR_PAGE = 100;
const SR_PAGE_CAP = 20;
const SR_CAP = SR_PAGE * SR_PAGE_CAP; 
async function fetchSmartRecruiters(s: JobSource, startOffset = 0): Promise<{ content: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number }> {
  const first = await fetchWithTimeout(listUrl(s, startOffset));
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  const page1 = await first.json();
  const feedTotal = Number(page1.totalFound) || 0;
  const total = Math.min(feedTotal, SR_CAP);
  const content: unknown[] = [...(page1.content ?? [])];
  for (let offset = SR_PAGE; offset < total; offset += SR_PAGE) {
    const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=${SR_PAGE}&offset=${startOffset + offset}`);
    if (!res.ok) break; 
    const page = await res.json();
    content.push(...(page.content ?? []));
  }
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
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 4000) : 1500;
    await new Promise((r) => setTimeout(r, waitMs));
    return await once();
  }
  return res;
}
async function fetchPersonio(s: JobSource): Promise<{ xml: string; host: string }> {
  for (const host of ["jobs.personio.de", "jobs.personio.com"]) {
    try {
      const res = await fetchWithTimeout(`https://${s.token}.${host}/xml`);
      if (res.ok) {
        const xml = await res.text();
        if (xml.includes("<workzag-jobs") || xml.includes("<position")) return { xml, host };
      }
    } catch {  }
  }
  throw new Error("personio feed unavailable on .de/.com");
}
const RIPPLING_PAGE_CAP = 10;
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
  const feedTotal = totalPages * RIPPLING_PER_PAGE; 
  return {
    items,
    raw: html,
    windowed: totalPages > RIPPLING_PAGE_CAP,
    feedTotal,
    nextOffset: reachedEnd ? 0 : lastPage * RIPPLING_PER_PAGE,
  };
}
async function fetchPaylocity(s: JobSource): Promise<{ items: unknown[]; raw: string }> {
  const res = await fetchWithTimeout(`https://recruiting.paylocity.com/recruiting/jobs/All/${s.token}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const page = extractPaylocityPageData(html);
  if (!page) throw new Error("paylocity payload shape unrecognized");
  return { items: page.items, raw: html };
}
const ADP_PAGE = 20;
const ADP_PAGE_CAP = 15; 
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
    const bodies = await Promise.all(pages.map(async (page) => {
      const res = await fetchWithTimeout(pageUrl(page), { headers: { Accept: "application/json" } });
      if (!res.ok) { if (page === 0) throw new Error(`HTTP ${res.status}`); return null; }
      return await res.json().catch(() => undefined); 
    }));
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (body === null) break outer; 
      const reqs = (body as { jobRequisitions?: unknown[] } | undefined)?.jobRequisitions;
      if (!Array.isArray(reqs)) {
        if (pages[i] === 0) throw new Error("adp payload shape unrecognized");
        break outer;
      }
      if (pages[i] === 0) feedTotal = Number((body as { meta?: { totalNumber?: number } }).meta?.totalNumber ?? 0) || 0;
      all.push(...reqs);
      if (reqs.length < ADP_PAGE) { exhausted = true; break outer; } 
    }
  }
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  return { items: all, raw: { jobRequisitions: all }, windowed: !exhausted, feedTotal };
}
const WORKDAY_PAGE_CAP = 25; 
const ORACLE_PAGE_SIZE = 100;
const ORACLE_PAGE_CAP = 20;
async function fetchWorkday(s: JobSource, startOffset = 0): Promise<{ jobPostings: unknown[]; raw: unknown; windowed: boolean; feedTotal: number; nextOffset: number }> {
  const [tenant, dc, site] = s.token.split("~");
  if (!tenant || !dc || !site) throw new Error("bad workday token");
  const url = `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const all: unknown[] = [];
  let feedTotal = 0;
  let exhausted = false;
  const workdayPageCap = Math.max(1, s.pages ?? WORKDAY_PAGE_CAP);
  const WORKDAY_CHUNK = 4;
  outer: for (let start = 0; start < workdayPageCap; start += WORKDAY_CHUNK) {
    const pages: number[] = [];
    for (let p = start; p < Math.min(start + WORKDAY_CHUNK, workdayPageCap); p++) pages.push(p);
    const bodies = await Promise.all(pages.map(async (page) => {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ limit: 20, offset: startOffset + page * 20, searchText: "", appliedFacets: {} }),
      });
      if (!res.ok) { if (page === 0) throw new Error(`HTTP ${res.status}`); return null; }
      return await res.json();
    }));
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (body === null) break outer; 
      if (pages[i] === 0) feedTotal = Number((body as { total?: number }).total ?? 0) || 0;
      const items = Array.isArray((body as { jobPostings?: unknown[] }).jobPostings) ? (body as { jobPostings: unknown[] }).jobPostings : [];
      all.push(...items);
      if (items.length < 20) { exhausted = true; break outer; } 
    }
  }
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  const advanced = startOffset + all.length;
  const nextOffset = exhausted || (feedTotal > 0 && advanced >= feedTotal) ? 0 : advanced;
  return { jobPostings: all, raw: { jobPostings: all }, windowed: feedTotal > all.length, feedTotal, nextOffset };
}
async function fetchOracle(s: JobSource, startOffset = 0): Promise<{ items: unknown[]; raw: unknown; windowed: boolean; feedTotal: number; nextOffset: number }> {
  const [tenant, region, site] = s.token.split("~");
  if (!tenant || !region || !site) throw new Error("bad oracle token");
  const base = `https://${tenant}.fa.${region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
  const all: unknown[] = [];
  let feedTotal = 0;
  let exhausted = false;
  const oraclePageCap = Math.max(1, s.pages ?? ORACLE_PAGE_CAP);
  const ORACLE_CHUNK = 4;
  outer: for (let start = 0; start < oraclePageCap; start += ORACLE_CHUNK) {
    const pages: number[] = [];
    for (let p = start; p < Math.min(start + ORACLE_CHUNK, oraclePageCap); p++) pages.push(p);
    const bodies = await Promise.all(pages.map(async (page) => {
      const finder = `findReqs;siteNumber=${site},limit=${ORACLE_PAGE_SIZE},offset=${startOffset + page * ORACLE_PAGE_SIZE},sortBy=POSTING_DATES_DESC`;
      const res = await fetchWithTimeout(`${base}?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`);
      if (!res.ok) { if (page === 0) throw new Error(`HTTP ${res.status}`); return null; }
      return await res.json();
    }));
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (body === null) break outer; 
      const item = (Array.isArray((body as { items?: unknown[] }).items) ? (body as { items: Record<string, unknown>[] }).items[0] : null) ?? null;
      if (!item) { exhausted = true; break outer; }
      if (pages[i] === 0) feedTotal = Number(item.TotalJobsCount ?? 0) || 0;
      const reqs = Array.isArray(item.requisitionList) ? item.requisitionList as unknown[] : [];
      all.push(...reqs);
      if (reqs.length < ORACLE_PAGE_SIZE) { exhausted = true; break outer; } 
    }
  }
  if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
  const advancedOr = startOffset + all.length;
  const nextOffset = exhausted || (feedTotal > 0 && advancedOr >= feedTotal) ? 0 : advancedOr;
  return { items: all, raw: { items: all }, windowed: !exhausted, feedTotal, nextOffset };
}
async function fetchBoard(
  s: JobSource,
  onFail?: (reason: string) => void,
  startOffset = 0,
): Promise<{ jobs: JobPosting[]; raw: unknown; windowed?: boolean; feedTotal?: number; nextOffset?: number } | null> {
  try {
    if (s.source === "oracle") {
      const { items, raw, windowed, feedTotal, nextOffset } = await fetchOracle(s, startOffset);
      return { jobs: normalizeOracle(items as never, s.name, s.token), raw, windowed, feedTotal, nextOffset };
    }
    if (s.source === "icims") {
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
          if (batch.length < ICIMS_PAGE) { exhausted = true; break outer; }
        }
      }
      if (all.length === 0 && feedTotal > 0) throw new Error(`empty page but total=${feedTotal}`);
      return { jobs: normalizeIcims(all as never, s.name, s.token), raw: { items: all }, windowed: !exhausted, feedTotal };
    }
    if (s.source === "usajobs") {
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
      const pinpointHost = s.token.includes(".") ? s.token : `${s.token}.pinpointhq.com`;
      const res = await fetchWithTimeout(`https://${pinpointHost}/postings.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const data = Array.isArray((body as { data?: unknown[] }).data) ? (body as { data: unknown[] }).data : [];
      return { jobs: normalizePinpoint(data as never, s.name, s.token), raw: body };
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
      const { jobPostings, raw, windowed, feedTotal, nextOffset } = await fetchWorkday(s, startOffset);
      return { jobs: normalizeWorkday(jobPostings as never, s.name, s.token), raw, windowed, feedTotal, nextOffset };
    }
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
    if (s.source === "smartrecruiters") {
      const sr = raw as { windowed?: boolean; feedTotal?: number; nextOffset?: number };
      return { jobs, raw, windowed: sr.windowed === true, feedTotal: sr.feedTotal ?? 0, nextOffset: sr.nextOffset };
    }
    return { jobs, raw };
  } catch (e) {
    const raw = String((e as Error)?.message ?? e);
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
const FALLBACK_COLD_LIST = interleaveByVendor(JOB_SOURCES.filter((s) => !HOT_TOKENS.has(s.token)));
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
const COLD_SLICES_PER_PASS = 160;
const DEAD_BOARD_THRESHOLD = 6; 
const DEAD_BOARD_MIN_FAILING_MS = 40 * 60 * 60_000;
const DORMANT_RECHECK_MS = 12 * 60 * 60_000; 
const DORMANT_CAP = 8_000; 
const VENDOR_ZERO_TRIP = 0.5; 
const VENDOR_ZERO_RESET = 0.3; 
const VENDOR_MIN_ATTEMPTS = 20; 
const VENDOR_STATS_DECAY = 0.8; 
const EXPERIENCE_VERSION = 1;
const SALARY_PARSE_VERSION = 7; 
const COUNTRY_VERSION = 1; 
async function undatedBacklog(client: SupabaseClient<any, any, any>): Promise<number | null> {
  try {
    const { data } = await client.from("job_board_stats_rollup").select("v").eq("k", "date_coverage").maybeSingle();
    return backlogFromCoverage((data as { v?: unknown } | null)?.v ?? null);
  } catch {
    return null;
  }
}
const BACKFILL_HOP_PAUSE_MS = 3_000;
const VELOCITY_HOT_SLOTS = 40;
const VELOCITY_WINDOW_DAYS = 7;
const CHAIN_CAP = Math.ceil(HOT_SIZE / HOT_SLICE) + COLD_SLICES_PER_PASS + 4; 
const CORPUS_CEILING = 1_200_000; 
const CORPUS_TARGET = 1_150_000;  
const FRESH_WINDOW_DAYS = 30;
const BACKDATE_SLACK_MS = FRESH_WINDOW_DAYS * 86_400_000;
function exitReasonFor(postedAt: unknown, firstSeen: unknown): "aged_out" | "backdated" {
  const p = postedAt ? Date.parse(String(postedAt)) : NaN;
  const f = firstSeen ? Date.parse(String(firstSeen)) : NaN;
  if (!Number.isFinite(p) || !Number.isFinite(f)) return "aged_out";
  return p < f - BACKDATE_SLACK_MS ? "backdated" : "aged_out";
}
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
      if (insErr) { console.warn(`[JOB-BOARD] exit-log insert failed for ${token} (non-fatal):`, insErr.message?.slice(0, 120)); break; }
      logged += rows.length;
      if (rows.length < 500) break;
    }
  } catch (e) {
    console.warn(`[JOB-BOARD] exit-log threw for ${token} (non-fatal):`, String(e).slice(0, 120));
  }
  return logged;
}
const FRESH_PRUNE_MAX = 15_000;
let chainKeyPromise: Promise<string> | null = null;
function chainKey(): Promise<string> {
  chainKeyPromise ??= (async () => {
    const seed = `${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}:board-chain`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  })();
  return chainKeyPromise;
}
async function isIngestPaused(client: SupabaseClient): Promise<boolean> {
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
function chainNextSlice(hop: number, client?: SupabaseClient) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
  const stamp = async (v: Record<string, unknown>) => {
    if (!client) return;
    try {
      await client.from("job_board_meta").upsert(
        { k: "chain_kick", v: { at: new Date().toISOString(), fromHop: hop, ...v }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
    } catch {  }
  };
  waitUntil((async () => {
    if (client && await isIngestPaused(client)) {
      console.warn(`[JOB-BOARD] ingest PAUSED — chain stopping at hop ${hop}; unset job_board_meta.ingest_paused to resume`);
      await stamp({ outcome: "paused", note: "deliberate stop — ingest_paused is set" });
      return;
    }
    await stamp({ outcome: "kicked" });
    const key = await chainKey();
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", force: true, chain: hop + 1, chainKey: key }),
      });
      const body = (await r.text()).slice(0, 300);
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
    console.error("[JOB-BOARD] chain kick failed outside its own handler:", e);
  }));
}
function recordSliceStats(client: SupabaseClient, sliceWallStart: number, inHotPhase: boolean): void {
  waitUntil((async () => {
    try {
      const sliceMs = Date.now() - sliceWallStart;
      const phase = inHotPhase ? "hot" : "cold";
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
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "k" });
    } catch {  }
  })());
}
async function runRefresh(client: SupabaseClient, force = false, chainHop = 0): Promise<{ ok: boolean; detail: string }> {
  if (await isIngestPaused(client)) {
    return { ok: true, detail: "ingest paused — set job_board_meta.ingest_paused.paused=false to resume" };
  }
  const { data: prog } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle();
  if (!force && prog && Date.now() - new Date(prog.updated_at).getTime() < SLICE_LOCK_MS) {
    return { ok: true, detail: "skipped — a slice ran moments ago" };
  }
  const sliceWallStart = Date.now();
  const { hotList: HOT_LIST, coldList: COLD_LIST } = await tierLists(client);
  await loadDynamicLight(client); 
  const pv = (prog?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[]; failedTotal?: number };
  let hot = Math.max(0, Number(pv.hot) || 0);
  let cold = Math.max(0, Number(pv.cold) || 0) % Math.max(1, COLD_LIST.length);
  let coldDone = Math.max(0, Number(pv.coldDone) || 0);
  if (chainHop === 0) {
    const progAge = prog ? Date.now() - new Date(prog.updated_at).getTime() : Infinity;
    const storedDone = hot >= HOT_LIST.length && coldDone >= COLD_SLICES_PER_PASS;
    if (storedDone || progAge > 45 * 60_000) {
      const diedMidHot = !storedDone && hot > 0 && hot < HOT_LIST.length;
      if (!diedMidHot) hot = 0;
      coldDone = 0;
      pv.failedAcc = [];
      pv.failedTotal = 0;
    }
  }
  const inHotPhase = hot < HOT_LIST.length;
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
      const rowAge = row?.updated_at ? Date.now() - new Date(row.updated_at).getTime() : 0;
      if (rowAge > 30 * 60_000) return { kind: "stale" as const };
      const n = Number(inHotPhase ? v.hotEmaMs : v.coldEmaMs);
      return Number.isFinite(n) && n > 0 ? { kind: "ema" as const, ms: n } : { kind: "absent" as const };
    } catch {
      return { kind: "unreadable" as const };
    }
  })();
  const shedLevel = shedSignal.kind === "unreadable" ? 2
    : shedSignal.kind === "absent" ? 1
    : shedSignal.kind === "stale" ? 1
    : shedSignal.ms > 60_000 ? 2
    : shedSignal.ms > 40_000 ? 1
    : 0;
  const shedEma = shedSignal.kind === "ema" ? shedSignal.ms : 0;
  const effColdSlice = shedLevel === 2 ? 24 : shedLevel === 1 ? 48 : COLD_SLICE;
  const effConcurrency = shedLevel === 2 ? 3 : shedLevel === 1 ? 5 : CONCURRENCY;
  const effDeepPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 4 : DEEP_PER_SLICE;
  const effHotSlice = shedLevel === 2 ? 3 : shedLevel === 1 ? 5 : HOT_SLICE;
  const effBootstrapPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 10 : BOOTSTRAP_PER_SLICE;
  const effRetryPerSlice = shedLevel === 2 ? 0 : shedLevel === 1 ? 2 : RETRY_PER_SLICE;
  if (shedLevel > 0) {
    console.warn(`[JOB-BOARD] load shedding L${shedLevel}: ${inHotPhase ? "hot" : "cold"} EMA ${Math.round(shedEma / 1000)}s -> ${inHotPhase ? `hotSlice ${effHotSlice}` : `slice ${effColdSlice}, concurrency ${effConcurrency}, deep ${effDeepPerSlice}, bootstrap ${effBootstrapPerSlice}, retry ${effRetryPerSlice}`}`);
  }
  const baseSlice = inHotPhase
    ? HOT_LIST.slice(hot, hot + effHotSlice)
    : COLD_LIST.slice(cold, cold + effColdSlice);
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
  let bootstrapBoards: JobSource[] = [];
  if (!inHotPhase) {
    try {
      const { data: bsMeta } = await client.from("job_board_meta").select("v").eq("k", "bootstrap").maybeSingle();
      const bs = (bsMeta?.v ?? {}) as { queue?: string[]; version?: string };
      let queue = Array.isArray(bs.queue) ? bs.queue : [];
      if (queue.length === 0) {
        const { data: empty, error } = await client.rpc("get_empty_boards", { p_tokens: JOB_SOURCES.map((s) => s.token) });
        if (error) throw error;
        queue = Array.isArray(empty) ? empty : [];
      }
      let bootstrapAppendDone = true;
      if (queue.length > 0 && bs.version !== BUILD_VERSION) {
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
          bootstrapAppendDone = false;
          console.error(`[JOB-BOARD] bootstrap version-append failed (will retry next slice): ${e instanceof Error ? e.message.slice(0, 120) : e}`);
        }
      }
      if (queue.length > 0) {
        const sliceTokens = new Set([...baseSlice, ...demandBoards].map((s) => s.token));
        bootstrapBoards = queue
          .slice(0, effBootstrapPerSlice)
          .filter((t) => !sliceTokens.has(t))
          .map((t) => JOB_SOURCES.find((s) => s.token === t))
          .filter((s): s is JobSource => !!s);
      }
      if (queue.length > 0) {
        await client.from("job_board_meta").upsert(
          {
            k: "bootstrap",
            v: {
              queue: queue.slice(effBootstrapPerSlice),
              version: bootstrapAppendDone ? BUILD_VERSION : (bs.version ?? ""),
              lastSlice: {
                at: new Date().toISOString(),
                drained: Math.min(effBootstrapPerSlice, queue.length),
                selected: bootstrapBoards.length,
              },
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "k" },
        );
      }
    } catch {  }
  }
  const deepCursors: Record<string, number> = await (async () => {
    try {
      const { data } = await client.from("job_board_meta").select("v").eq("k", "deep_cursor").maybeSingle();
      const v = (data?.v ?? {}) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, n] of Object.entries(v)) if (Number.isInteger(n) && (n as number) > 0) out[k] = n as number;
      return out;
    } catch { return {}; } 
  })();
  let deepCursorsDirty = false;
  let deepBoards: JobSource[] = [];
  let deepLane: { at: string; candidates: number; selected: number; start: number } | null = null;
  if (!inHotPhase) {
    try {
      const tokens = Object.keys(deepCursors);
      if (tokens.length > 0) {
        const taken = new Set([...baseSlice, ...demandBoards, ...bootstrapBoards].map((s) => s.token));
        const start = cold % tokens.length;
        deepBoards = [...tokens.slice(start), ...tokens.slice(0, start)]
          .filter((t) => !taken.has(t))
          .slice(0, effDeepPerSlice)
          .map((t) => JOB_SOURCES.find((s) => s.token === t))
          .filter((s): s is JobSource => !!s);
        deepLane = { at: new Date().toISOString(), candidates: tokens.length, selected: deepBoards.length, start };
      }
    } catch {  }
  }
  const { data: bfMeta } = await client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle();
  const bfV = (bfMeta?.v ?? {}) as Partial<BoardFailureState>;
  const boardFailures: BoardFailureState = {
    streaks: { ...(bfV.streaks ?? {}) },
    dormant: { ...(bfV.dormant ?? {}) },
    failedAt: { ...(bfV.failedAt ?? {}) },
    firstFailedAt: { ...(bfV.firstFailedAt ?? {}) },
  };
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
      retryLane = {
        at: new Date().toISOString(),
        candidates: Object.keys(boardFailures.failedAt ?? {}).length,
        selected: retryBoards.length,
      };
    } catch {  }
  }
  const slice = [...demandBoards, ...bootstrapBoards, ...deepBoards, ...retryBoards, ...baseSlice];
  const startIso = new Date().toISOString();
  const freshCutoffMs = Date.now() - FRESH_WINDOW_DAYS * 86_400_000; 
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
  const advanceArgs = {
    inHotPhase,
    hotSlice: effHotSlice,
    baseSliceLen: baseSlice.length,
    coldListLen: COLD_LIST.length,
  };
  const progressBefore: RefreshProgress = {
    hot, cold, coldDone,
    failedAcc: Array.isArray(pv.failedAcc) ? pv.failedAcc : [],
    failedTotal: Number(pv.failedTotal) || 0,
  };
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
    Array.from({ length: inHotPhase ? HOT_CONCURRENCY : effConcurrency }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        if (skipTokens.has(s.token)) continue;
        let failReason = "";
        const r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors[s.token] ?? 0);
        if (!r) {
          failed.push(`${s.name} (vendor${failReason ? `: ${failReason}` : ""})`);
          continue;
        }
        if (typeof r.nextOffset === "number") {
          const prev = deepCursors[s.token] ?? 0;
          if (r.nextOffset > 0) { if (prev !== r.nextOffset) { deepCursors[s.token] = r.nextOffset; deepCursorsDirty = true; } }
          else if (prev !== 0) { delete deepCursors[s.token]; deepCursorsDirty = true; }
        }
        if (s.source === "workday" && r.jobs.length > 0) {
          const tenant = s.token.split("~")[0];
          const isSuffixed = (req: string) => {
            const m = /-\d{1,2}$/.exec(req);
            return !!m && /\d{3}/.test(req.slice(0, m.index));
          };
          const bases = [...new Set(
            r.jobs.map((j) => j.id.split(":")[2] ?? "")
              .filter(isSuffixed)
              .map((req) => req.replace(/-\d{1,2}$/, ""))
              .filter((base) => /^[A-Za-z0-9_-]+$/.test(base)),
          )];
          if (bases.length > 0 && bases.length <= 120) try {
            const { data: hits } = await client.from("job_board_postings")
              .select("id")
              .eq("source", "workday")
              .like("company_token", `${tenant}~%`)
              .or(bases.map((base) => `id.like.workday:${tenant}~%:${base}`).join(","))
              .limit(bases.length * 4);
            const held = new Set((hits ?? []).map((h) => String((h as { id: string }).id).split(":")[2] ?? ""));
            if (held.size > 0) {
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
                if (alreadyStored.has(j.id)) return true; 
                return !held.has(req.replace(/-\d{1,2}$/, ""));
              });
              const dropped = before - r.jobs.length;
              if (dropped > 0) console.log(`[JOB-BOARD] workday cross-site dedupe: ${s.token} skipped ${dropped} new requisition copies already held by ${tenant}'s other sites`);
            }
          } catch {  }
        }
        {
          const vs = vendorStats.get(s.source) ?? { a: 0, z: 0 };
          vs.a += 1;
          if (r.jobs.length === 0) vs.z += 1;
          vendorStats.set(s.source, vs);
          if (r.jobs.length === 0 && quarantinedVendors.has(s.source)) {
            quarantineSkipped.add(s.token); 
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
            } catch {  }
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
            } catch {  }
          } else {
            for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
          }
        } else if (s.source === "pinpoint") {
          for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
        } else if (s.source === "icims") {
          for (const [k, v] of listPayloadDescriptions(s, r.raw)) descs.set(k, v);
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
        const lightDescs = isLight(s.token);
        const rowsById = new Map<string, Record<string, unknown>>();
        const agedOutIds = new Set<string>();
        for (const j of r.jobs) {
          const posted = sanePostedAt(j.postedAt); 
          const salaryText = (clean(j.salary?.slice(0, 200) ?? null) || null) ?? (lightDescs ? null : extractSalary(descs.get(j.id) ?? null));
          if (isDatedBefore(posted, freshCutoffMs)) { agedOutIds.add(j.id); continue; }
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
      employment_type: j.employmentType ?? null,
            agency: s.agency === true,
            department: clean(j.department?.slice(0, 200) ?? null),
            category: j.category,
            posted_at: posted,
            apply_url: j.applyUrl,
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
            ...(lightDescs ? {} : { description: clean(descs.get(j.id) ?? null) }),
            last_seen: startIso, 
          });
        }
        const rows = [...rowsById.values()];
        let boardOk = true;
        type ExistingRow = {
          id: string; missing_since: string | null;
          title?: string | null; location?: string | null; country?: string | null;
          apply_url?: string | null; work_mode?: string | null; remote?: boolean | null;
          salary?: string | null; agency?: boolean | null; employment_type?: string | null;
        };
        const existingRows: Array<ExistingRow> = [];
        let missingColUnknown = false; 
        for (let from = 0; ; from += 1000) {
          let res = await client
            .from("job_board_postings")
            .select("id,missing_since,title,location,country,apply_url,work_mode,employment_type,remote,salary,agency")
            .eq("company_token", s.token)
            .order("id")
            .range(from, from + 999);
          if (res.error?.message?.includes("agency")) {
            res = (await client
              .from("job_board_postings")
              .select("id,missing_since,title,location,country,apply_url,work_mode,employment_type,remote,salary")
              .eq("company_token", s.token)
              .order("id")
              .range(from, from + 999)) as typeof res;
          }
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
            agency: r.agency ?? null, employment_type: r.employment_type ?? null,
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
        const GRACE_MS = 5 * 60 * 1000;
        const RATCHET_MS = 6 * 60 * 60 * 1000;
        const SHRINK_RATIO = 0.6;
        const nowMs = Date.now();
        let vanished: string[];
        const toStamp: string[] = [];
        let toUnstamp: string[] = [];
        if (missingColUnknown) {
          vanished = vanishedAll; 
        } else {
          const bigShrink = existing.size >= 20 && vanishedAll.length > SHRINK_RATIO * existing.size;
          const needMs = bigShrink ? RATCHET_MS : GRACE_MS;
          if (bigShrink && vanishedAll.length) {
            console.warn(`[JOB-BOARD] ${s.token}: ${vanishedAll.length}/${existing.size} postings vanished in one pass — shrink ratchet holds closures for 6h`);
          }
          const partialRead = r.windowed === true;
          vanished = [];
          for (const id of vanishedAll) {
            if (agedOutIds.has(id)) { vanished.push(id); continue; } 
            if (partialRead) continue; 
            const stamp = missingSinceById.get(id);
            if (stamp && nowMs - new Date(stamp).getTime() >= needMs) vanished.push(id); 
            else if (!stamp) toStamp.push(id); 
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
        const corrections: Array<Record<string, unknown>> = [];
        for (const [id, row] of rowsById) {
          const prev = existingById.get(id);
          if (!prev) continue; 
          const patch: Record<string, unknown> = {};
          const put = (k: string, next: unknown, cur: unknown, allowNull: boolean) => {
            if (next === null || next === undefined || next === "") { if (!allowNull) return; }
            if (next !== cur) patch[k] = next ?? null;
          };
          put("title", row.title, prev.title, false);
          put("location", row.location, prev.location, false);
          put("apply_url", row.apply_url, prev.apply_url, false);
          put("country", row.country, prev.country, false);
          put("work_mode", row.work_mode, prev.work_mode, false);
          put("employment_type", (row as Record<string, unknown>).employment_type, (prev as Record<string, unknown>).employment_type, false);
          put("salary", row.salary, prev.salary, false);
          if (typeof row.remote === "boolean" && row.remote !== prev.remote) patch.remote = row.remote;
          if (typeof row.agency === "boolean" && typeof prev.agency === "boolean" && row.agency !== prev.agency) {
            patch.agency = row.agency;
          }
          if (Object.keys(patch).length) corrections.push({ id, ...patch });
        }
        const CORRECTIONS_PER_VISIT = 1_000;
        if (corrections.length > CORRECTIONS_PER_VISIT) {
          console.log(`[JOB-BOARD] corrections capped for ${s.token}: applying ${CORRECTIONS_PER_VISIT} of ${corrections.length} (remainder on next rotation visit)`);
          corrections.length = CORRECTIONS_PER_VISIT;
        }
        for (let i = 0; i < corrections.length; i += 200) {
          const chunk = corrections.slice(i, i + 200);
          const { error: cErr } = await client.rpc("apply_posting_corrections", { p_patches: chunk });
          if (cErr) {
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
          if (error?.message?.includes("country")) {
            const stripped = newRows.slice(i, i + 250).map((r) => { const { country: _c, ...rest } = r as Record<string, unknown>; return rest; });
            ({ error } = await client.from("job_board_postings").upsert(stripped, { onConflict: "id" }));
          }
          if (error?.message?.includes("agency")) {
            const stripped = newRows.slice(i, i + 250).map((r) => { const { agency: _a, country: _c, ...rest } = r as Record<string, unknown>; return rest; });
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
        const truncatedFetch = r.windowed === true;
        if (vanished.length && !truncatedFetch) {
          const closedAt = new Date().toISOString();
          const liveTitles = new Set(
            [...rowsById.values()].map((r) => normalizeCloseTitle(String(r.title ?? ""))).filter(Boolean),
          );
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
          } catch {  }
          for (let i = 0; i < vanished.length; i += 200) {
            const chunk = vanished.slice(i, i + 200);
            try {
              const { data: toLog } = await client
                .from("job_board_postings")
                .select("id, source, company_token, company, title, category, first_seen, posted_at")
                .in("id", chunk);
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
                if (isAgedOut(r)) return false; 
                const norm = normalizeCloseTitle(String(r.title ?? ""));
                return !(liveTitles.has(norm) && recentSuperseded.has(norm)); 
              });
              if (rows.length) {
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
                    superseded: liveTitles.has(normalizeCloseTitle(String(r.title ?? ""))), 
                  })),
                );
                if (clErr) console.warn(`[JOB-BOARD] closure insert failed for ${s.token} (non-fatal):`, clErr.message?.slice(0, 150));
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
          for (let i = 0; i < vanished.length; i += 200) {
            await client.from("job_board_postings").delete().in("id", vanished.slice(i, i + 200));
          }
        }
        okTokens.push(s.token);
        try {
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
        } catch {  }
        sliceTotal += rows.length;
      }
    }),
  );
  const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);
  const failedTotal = (Number(pv.failedTotal) || 0) + failed.length;
  const { next: progressAfter, wrapped } = advanceProgress({
    prev: { ...progressBefore, failedAcc, failedTotal },
    ...advanceArgs,
  });
  hot = progressAfter.hot;
  cold = progressAfter.cold;
  coldDone = progressAfter.coldDone;
  if (wrapped) {
    const { data: prevRot, error: prevRotErr } = await client.from("job_board_meta")
      .select("v").eq("k", "cold_rotation").maybeSingle();
    if (prevRotErr) {
      console.error(`[JOB-BOARD] cold_rotation pre-wrap read failed (${prevRotErr.code ?? ""} ${String(prevRotErr.message ?? "").slice(0, 100)}) — this wrap's duration will not be stamped`);
    }
    const prevAt = Date.parse(String((prevRot?.v as { completedAt?: string } | null)?.completedAt ?? ""));
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
        await client.from("job_board_meta")
          .upsert({ k: "deep_cursor", v: { ...deepCursors, ...(deepLane ? { __lane: deepLane } : {}) }, updated_at: new Date().toISOString() }, { onConflict: "k" })
          .then(({ error }) => { if (error) console.warn("[JOB-BOARD] deep_cursor write failed:", error.message?.slice(0, 120)); });
      }
    }
  }
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
    {
      const { data: sampled, error: sErr } = await client.rpc("record_board_pool_sample");
      if (sErr) console.warn("[JOB-BOARD] pool sample failed (non-fatal):", sErr.message?.slice(0, 140));
      else console.log(`[JOB-BOARD] pool sample recorded: serving=${sampled}`);
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
    const { data: facets, error: facetsErr } = await client.rpc("refresh_job_board_facets");
    let f = (facets ?? {}) as Record<string, unknown>;
    const facetsOk = !facetsErr && !!f.total;
    let facetsCarried = false;
    if (!facetsOk) {
      console.warn("[JOB-BOARD] facets RPC unavailable — carrying previous facets, maintenance continues:", facetsErr?.message ?? "empty result");
      waitUntil(Promise.resolve(client.from("job_board_meta").upsert(
        { k: "facets_attempt", v: { at: new Date().toISOString(), error: String(facetsErr?.message ?? "empty result").slice(0, 200) }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      )).then(() => {}).catch(() => {}));
      const { data: prevRefresh } = await client.from("job_board_meta").select("v").eq("k", "refresh").maybeSingle();
      const pv = (prevRefresh?.v ?? {}) as Record<string, unknown>;
      if (pv.total) {
        f = { total: pv.total, companiesFacet: pv.companiesFacet ?? [], categoriesFacet: pv.categoriesFacet ?? {} };
        facetsCarried = true;
      } else {
        recordSliceStats(client, sliceWallStart, inHotPhase);
        return { ok: true, detail: `pass complete but facets RPC unavailable (${facetsErr?.message ?? "empty result"}) and no previous facets to carry` };
      }
    }
    let companies = Array.isArray(f.companiesFacet) ? f.companiesFacet : [];
    const validTokens = new Set(JOB_SOURCES.map((s) => s.token));
    const { data: hwRow } = await client.from("job_board_meta").select("v").eq("k", "catalog_highwater").maybeSingle();
    const highwater = Number((hwRow?.v as { size?: number } | null)?.size) || 0;
    if (!facetsOk) {
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
    }
    const nowIso = new Date().toISOString();
    {
      const futureIso = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const garbageIso = new Date(POSTED_AT_GARBAGE_FLOOR_MS).toISOString();
      const { error: e1 } = await client.from("job_board_postings").update({ posted_at: null }).gt("posted_at", futureIso);
      const { error: e2 } = await client.from("job_board_postings").update({ posted_at: null }).lt("posted_at", garbageIso);
      if (e1 || e2) console.warn("[JOB-BOARD] date-hygiene error:", (e1 ?? e2)?.message);
    }
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
      try {
        await client.from("job_board_aged_out").delete()
          .lt("aged_at", new Date(Date.now() - 180 * 86_400_000).toISOString());
      } catch {  }
    }
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
    const coverage = await (async () => {
      const freshIso = new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString();
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
      const prevCoverage = await (async () => {
        try {
          const { data } = await client.from("job_board_meta")
            .select("coverage:v->coverage").eq("k", "refresh").maybeSingle();
          const c = (data as { coverage?: unknown } | null)?.coverage;
          return c && typeof c === "object" ? c as Record<string, unknown> : null;
        } catch { return null; }
      })();
      try {
        const { data: fcRaw, error: fcErr } = await client.rpc("get_filter_coverage");
        const fc = fcRaw as Record<string, unknown> | null;
        if (!fcErr && fc && typeof fc === "object" && typeof fc.open === "number" && (fc.open as number) > 0) {
          const open = fc.open as number;
          const frac = (n: unknown) => (typeof n === "number" ? Math.round((n / open) * 1000) / 1000 : null);
          const prevCov = (prevCoverage ?? {}) as Record<string, unknown>;
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
            payBasis: keep("payBasis"),
            hasStatedPay: keep("hasStatedPay"),
            maxYears: keep("maxYears"),
            department: keep("department"),
            employmentType: keep("employmentType"),
            ...(coverageFailed.length ? { staleParts: coverageFailed } : {}),
          };
        }
        if (fcErr) {
          console.warn(`[JOB-BOARD] get_filter_coverage unavailable (${fcErr.code ?? ""} ${String(fcErr.message ?? "").slice(0, 80)}) — falling back to per-column counts`);
        }
        const { count: open } = await client.from("job_board_postings")
          .select("id", { count: "exact", head: true }).is("missing_since", null)
          .gte("effective_posted", new Date(Date.now() - FRESH_WINDOW_DAYS * 86_400_000).toISOString());
        if (!open) return undefined;
        const [sal, wm, exp, ctry] = await Promise.all([
          one("salary_rank_usd", "not.is.null"),
          one("work_mode", "not.is.null"),
          one("experience_band", "neq.unspecified"),
          one("country", "not.is.null"),
        ]);
        const frac = (n: number | null) => (n === null ? null : Math.round((n / open) * 1000) / 1000);
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
          maxYears: carryLive("maxYears"),
          department: carryLive("department"),
          employmentType: carryLive("employmentType"),
          ...(coverageFailed.length ? { staleParts: coverageFailed } : {}),
        };
      } catch { return undefined; }
    })();
    const v = {
      total: f.total, 
      boards: companies.length,
      failedSources: failedAcc,
      failedCount: failedTotal,
      companiesFacet: companies,
      categoriesFacet: f.categoriesFacet ?? {},
      ...(coverage ? { coverage } : {}),
      ...(facetsCarried ? { facetsCarried: true } : {}),
      refreshedAt: startIso,
    };
    await client.from("job_board_meta").upsert({ k: "refresh", v, updated_at: new Date().toISOString() }, { onConflict: "k" });
    const vHead = {
      total: v.total,
      boards: v.boards,
      failedSources: v.failedSources,
      failedCount: v.failedCount,
      categoriesFacet: v.categoriesFacet,
      ...(coverage ? { coverage: { ...coverage, tracked: v.total } } : {}),
      ...(facetsCarried ? { facetsCarried: true, facetsCarriedAt: v.refreshedAt } : {}),
      refreshedAt: v.refreshedAt,
      companiesCount: companies.length,
      companiesFacet: [...companies].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 200),
    };
    await client.from("job_board_meta").upsert({ k: "refresh_head", v: vHead, updated_at: new Date().toISOString() }, { onConflict: "k" });
    const hotExcluded = new Set<string>();
    try {
      const { data: ex } = await client.from("showcase_excluded").select("company_token");
      for (const r of (ex ?? []) as Array<{ company_token?: string }>) {
        if (typeof r.company_token === "string") hotExcluded.add(r.company_token);
      }
    } catch {  }
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
    } catch {  }
    for (const t of sizeRanked) {
      if (hotSet.size >= HOT_SIZE) break;
      hotSet.add(t);
    }
    const ranked = [...hotSet];
    if (ranked.length >= 50) {
      await client.from("job_board_meta").upsert(
        { k: "hot_tokens", v: { tokens: ranked }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
    }
    console.log(`[JOB-BOARD] pass complete: hot ${HOT_LIST.length} boards + ${COLD_SLICES_PER_PASS} cold slices; corpus total ${f.total}`);
    const { data: expVer } = await client.from("job_board_meta").select("v").eq("k", "experience_version").maybeSingle();
    if ((expVer?.v as { version?: number } | null)?.version !== EXPERIENCE_VERSION) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-experience", chainKey: key }),
      })).then((r) => r.text()).catch(() => {}));
    }
    const { data: coVer } = await client.from("job_board_meta").select("v").eq("k", "country_version").maybeSingle();
    if ((coVer?.v as { version?: number } | null)?.version !== COUNTRY_VERSION) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-country", chainKey: key }),
      })).then((r) => r.text()).catch(() => {}));
    }
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
    const { data: pbVer } = await client.from("job_board_meta").select("v").eq("k", "posted_backfill").maybeSingle();
    const pbV = (pbVer?.v ?? {}) as { version?: number; resumeVersion?: number; phase?: string; cursor?: string; at?: string; sweptAt?: string; backlogAtSweep?: number };
    const pbAlive = typeof pbV.at === "string" && Date.now() - Date.parse(pbV.at) < 5 * 60_000;
    const pbBacklog = pbAlive ? null : await undatedBacklog(client);
    if (postedBackfillDue(pbV, pbBacklog) && !pbAlive) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
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
    const { data: nsVer } = await client.from("job_board_meta").select("v").eq("k", "name_sync_version").maybeSingle();
    if ((nsVer?.v as { version?: number } | null)?.version !== NAME_SYNC_VERSION) {
      try {
        const tokens = new Set<string>();
        for (const pat of ["%&amp;%", "%&#039;%"]) {
          const { data: escRows } = await client.from("job_board_postings").select("company_token").like("company", pat).limit(1000);
          for (const r of escRows ?? []) tokens.add(r.company_token as string);
        }
        for (const tk of RENAMED_TOKENS) tokens.add(tk);
        let fixed = 0, failed = 0, already = 0;
        for (const tk of tokens) {
          const src = JOB_SOURCES.find((s) => s.token === tk);
          if (!src) continue;
          const { data: stale } = await client.from("job_board_postings")
            .select("company_token").eq("company_token", tk).neq("company", src.name).limit(1);
          if (!stale?.length) { already++; continue; }
          const { error: e1 } = await client.from("job_board_postings")
            .update({ company: src.name }).eq("company_token", tk).neq("company", src.name);
          const { error: e2 } = await client.from("job_board_closures")
            .update({ company: src.name }).eq("company_token", tk).neq("company", src.name);
          if (e1 || e2) {
            failed++;
            console.warn(`[JOB-BOARD] name sync: ${tk} failed:`, (e1 ?? e2)?.message?.slice(0, 120));
          } else fixed++;
        }
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
    recordSliceStats(client, sliceWallStart, inHotPhase);
    return { ok: true, detail: `pass complete — corpus ${f.total} postings from ${companies.length} boards; cold rotation at ${cold}/${COLD_LIST.length}${lastUpsertError ? ` — last upsert error: ${String(lastUpsertError).slice(0, 120)}` : ""}` };
  }
  await maybeKickMaintenance(client);
  if (chainHop < CHAIN_CAP) chainNextSlice(chainHop, client);
  const phase = inHotPhase ? `hot ${Math.min(hot, HOT_LIST.length)}/${HOT_LIST.length}` : `cold slice ${coldDone}/${COLD_SLICES_PER_PASS} (rotation ${cold}/${COLD_LIST.length})`;
  recordSliceStats(client, sliceWallStart, inHotPhase);
  return { ok: true, detail: `slice done (${sliceTotal} postings, ${failed.length} failed) — ${phase}${shedLevel > 0 ? ` [shedding L${shedLevel}]` : ""}` };
}
const VERIFY_GRACE_MS = 6 * 60 * 60_000;
const MAINTENANCE_ANY_GAP_MS = 10 * 60_000; 
const MAINTENANCE_STALL_MS = 12 * 60_000;
async function maybeKickMaintenance(client: SupabaseClient): Promise<void> {
  try {
    const { data: mk } = await client.from("job_board_meta").select("v, updated_at").eq("k", "maintenance_kick").maybeSingle();
    const lastAge = mk ? Date.now() - new Date(mk.updated_at).getTime() : Infinity;
    if (lastAge < MAINTENANCE_ANY_GAP_MS) return;
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
    } catch {  }
    const cb = await alive("country_backfill");
    const cbDone = Number(cb.v?.mapVersion) === COUNTRY_MAP_VERSION && typeof cb.v?.doneAt === "string";
    if (!cbDone && !cb.alive) {
      const cbCursor = Number(cb.v?.mapVersion) === COUNTRY_MAP_VERSION && typeof cb.v?.cursor === "string" ? cb.v.cursor as string : "";
      await kick("backfill-country", cbCursor ? { cursor: cbCursor } : {});
    }
    const es = await alive("embed_sweep");
    const esDoneAt = typeof es.v?.doneAt === "string" ? Date.parse(es.v.doneAt as string) : NaN;
    const esSettled = Number.isFinite(esDoneAt) && Date.now() - esDoneAt < 60 * 60_000;
    if (!es.alive && !esSettled) {
      await kick("embed-sweep");
    }
    const pb = await alive("posted_backfill");
    const pbv = (pb.v ?? {}) as { version?: number; sweptAt?: string; resumeVersion?: number; phase?: string; cursor?: string; backlogAtSweep?: number };
    if (!pb.alive && postedBackfillDue(pbv, await undatedBacklog(client))) {
      const pbResume = pbv.resumeVersion === POSTED_BACKFILL_VERSION
        && typeof pbv.phase === "string" && typeof pbv.cursor === "string"
        ? { phase: pbv.phase, cursor: pbv.cursor }
        : {};
      await kick("backfill-posted", pbResume);
    }
    const ss = await alive("structured_sweep");
    const ssDone = typeof ss.v?.doneAt === "string" ? Date.parse(ss.v.doneAt as string) : NaN;
    const ssSettled = Number.isFinite(ssDone) && Date.now() - ssDone < 24 * 60 * 60_000;
    const ssZeroPasses = Number((ss.v as { zeroFilledPasses?: number } | null)?.zeroFilledPasses ?? 0);
    const ssBackoffH = ssZeroPasses >= 2 ? Math.min(24 * Math.pow(2, ssZeroPasses - 1), 168) : 24;
    const ssBackedOff = Number.isFinite(ssDone) && Date.now() - ssDone < ssBackoffH * 60 * 60_000;
    if (!ss.alive && !ssSettled && !ssBackedOff) {
      const ssCursor = typeof ss.v?.cursor === "string" ? ss.v.cursor as string : "";
      await kick("structured-sweep", { vi: 0, cursor: ssCursor });
    }
    const { data: catVer } = await client.from("job_board_meta").select("v").eq("k", "category_rules_version").maybeSingle();
    const cv = (catVer?.v ?? null) as { version?: number; startedUnder?: number } | null;
    if (cv?.version !== CATEGORIZE_VERSION || Number(cv?.startedUnder) !== CATEGORIZE_VERSION) {
      const prog = await alive("recategorize_progress");
      if (!prog.alive) {
        const sameVersion = Number(prog.v?.startedUnder) === CATEGORIZE_VERSION;
        const cursor = sameVersion && typeof prog.v?.cursor === "string" ? prog.v.cursor as string : "";
        await kick("recategorize", { ...(cursor ? { cursor } : {}), rulesVersion: CATEGORIZE_VERSION });
      }
      return;
    }
    const { data: bf } = await client.from("job_board_meta").select("v, updated_at").eq("k", "desc_backfill").maybeSingle();
    const bfAge = bf ? Date.now() - new Date(bf.updated_at).getTime() : Infinity;
    const bfIncomplete = !!(bf?.v as { incompleteAt?: string } | null)?.incompleteAt;
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
    const ds = await alive("desc_sweep");
    const doneAt = typeof ds.v?.doneAt === "string" ? Date.parse(ds.v.doneAt as string) : NaN;
    const settled = Number.isFinite(doneAt) && Date.now() - doneAt < 6 * 60 * 60_000;
    if (!ds.alive && !settled) {
      const LEN = DETAIL_DESC_SOURCES.length;
      const dsv = (ds.v ?? {}) as { nextStartVi?: number; runningVi?: number };
      const startVi = Number.isFinite(Number(dsv.nextStartVi))
        ? Math.max(0, Number(dsv.nextStartVi)) % LEN
        : Number.isFinite(Number(dsv.runningVi)) ? (Math.max(0, Number(dsv.runningVi)) + 1) % LEN : 0;
      await kick("desc-sweep", { vi: startVi, vstart: startVi });
    }
  } catch (e) {
    console.warn("[JOB-BOARD] maintenance kick skipped:", String(e).slice(0, 120));
  }
}
function withDeadline<T>(p: PromiseLike<T>, ms: number): Promise<T | { data: null }> {
  return Promise.race([
    Promise.resolve(p).then((r) => r, () => ({ data: null } as { data: null })),
    new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), ms)),
  ]);
}
const detailCache = new Map<string, { at: number; text: string }>();
const DETAIL_TTL_MS = 60 * 60_000;
const EMBED_PER_HOP = 6;
const EMBED_HOP_WALL_MS = 1_100; 
const EMBED_HOP_PAUSE_MS = 4_000;
let aiSession: { run: (input: string, opts: Record<string, unknown>) => Promise<unknown> } | null = null;
async function embedText(text: string): Promise<number[] | null> {
  try {
    if (!aiSession) {
      const S = (globalThis as unknown as { Supabase?: { ai?: { Session?: new (m: string) => NonNullable<typeof aiSession> } } }).Supabase;
      if (!S?.ai?.Session) return null; 
      aiSession = new S.ai.Session("gte-small");
    }
    const out = await aiSession.run(text, { mean_pool: true, normalize: true });
    return Array.isArray(out) && out.length === 384 ? out as number[] : null;
  } catch {
    return null;
  }
}
const liveBoardMemo = new Map<string, Set<string>>();
async function checkLive(src: JobSource, externalId: string, applyUrl?: string | null): Promise<boolean | null> {
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
    const memoKey = `${src.source}:${src.token}`;
    let ids = liveBoardMemo.get(memoKey);
    if (!ids) {
      const r = await fetchBoard(src);
      if (!r) return null;
      ids = new Set<string>();
      if (src.source === "ashby") for (const j of ((r.raw as { jobs?: Array<{ id: string }> }).jobs ?? [])) ids.add(String(j.id));
      else for (const j of r.jobs) ids.add(j.id.split(":").slice(2).join(":")); 
      liveBoardMemo.set(memoKey, ids);
    }
    return ids.has(externalId);
  } catch {
    return null; 
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
function listPayloadDescriptions(s: JobSource, raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (s.source === "workable") {
    for (const j of ((raw as { jobs?: Array<{ shortcode?: string; description?: string }> }).jobs ?? [])) {
      const ext = j.shortcode ?? "";
      const text = j.description ? htmlToText(String(j.description).slice(0, RAW_HTML_CAP)).trim() : "";
      if (ext && text) out.set(`workable:${s.token}:${ext}`, text.slice(0, STORED_DESC_CAP));
    }
  } else if (s.source === "icims") {
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
async function fetchVendorDetail(
  src: JobSource,
  id: string,
  externalId: string,
  applyUrl?: string | null,
): Promise<{ text: string | null; postedAt: string | null; workMode: "remote" | "hybrid" | "onsite" | null }> {
  let text: string | null = null;
  let workMode: "remote" | "hybrid" | "onsite" | null = null;
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
    const cxs = applyUrl ? workdayCxsUrl(applyUrl) : null;
    if (cxs) {
      const res = await fetchWithTimeout(cxs);
      if (res.ok) {
        const j = await res.json().catch(() => null) as { jobPostingInfo?: { jobDescription?: string; startDate?: string; remoteType?: string } } | null;
        const html = j?.jobPostingInfo?.jobDescription ?? "";
        text = html ? htmlToText(String(html)).slice(0, DESC_CAP) || null : null;
        postedAt = isoDateOnly(j?.jobPostingInfo?.startDate);
        const rt = String(j?.jobPostingInfo?.remoteType ?? "").toLowerCase().trim();
        workMode = !rt ? null
          : /\bnon[-\s]?remote\b|\bnot remote\b|\bno remote\b|\bnon[-\s]?rem\b/.test(rt) ? "onsite"
          : /hybrid|hybride|flex/.test(rt) ? "hybrid"
          : /on[-\s]?site|in[-\s]?person|on[-\s]?campus|campus[-\s]?based|on[-\s]?premise|fully on|field[-\s]?based/.test(rt) ? "onsite"
          : /remote|work from home|wfh|telework|virtual|distributed/.test(rt) ? "remote"
          : null;
        if (rt && !workMode) console.log(`[JOB-BOARD] unclassified remoteType: ${JSON.stringify(rt).slice(0, 80)}`);
      }
    }
  } else if (src.source === "bamboohr") {
    const res = await fetchWithTimeout(`https://${src.token}.bamboohr.com/careers/${externalId}/detail`);
    if (res.ok) {
      const j = await res.json().catch(() => null) as { result?: { jobOpening?: { description?: string; datePosted?: string } } } | null;
      const html = j?.result?.jobOpening?.description ?? "";
      text = html ? htmlToText(String(html)).slice(0, DESC_CAP) || null : null;
      postedAt = isoDateOnly(j?.result?.jobOpening?.datePosted);
    }
  } else if (src.source === "breezy") {
    const url = applyUrl || `https://${src.token}.breezy.hr/p/${externalId}`;
    const res = await fetchWithTimeout(url);
    if (res.ok) {
      const html = jobPostingLdDescription(await res.text());
      text = html ? htmlToText(html).slice(0, DESC_CAP) || null : null;
    }
  } else if (src.source === "paylocity") {
    const res = await fetchWithTimeout(`https://recruiting.paylocity.com/recruiting/jobs/Details/${externalId}`);
    if (res.ok) {
      const html = jobPostingLdDescription(await res.text());
      text = html ? htmlToText(html).slice(0, DESC_CAP) || null : null;
    }
  } else if (src.source === "adp") {
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
    const res = await fetchWithTimeout(`https://api.rippling.com/platform/api/ats/v1/board/${src.token}/jobs/${externalId}`);
    if (res.ok) {
      const body = await res.json() as { description?: { company?: string; role?: string } };
      const html = [body?.description?.role, body?.description?.company]
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .join("\n");
      text = html ? htmlToText(html).slice(0, DESC_CAP) || null : null;
    }
  } else if (src.source === "pinpoint") {
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
  return { text, postedAt, workMode };
}
function isoDateOnly(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v.length <= 10 ? `${v}T00:00:00Z` : v);
  if (!Number.isFinite(t)) return null;
  if (t > Date.now() + 86_400_000 || t < Date.now() - 400 * 86_400_000) return null;
  return new Date(t).toISOString();
}
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
  const joined = terms.map((t) => sanitizeTerm(t)).filter(Boolean).join("|");
  return joined || null;
}
function locationTerms(raw: unknown): { terms: string[]; expandedFrom: string | null } {
  const clean = sanitizeTerm(String(raw ?? ""));
  if (!clean) return { terms: [], expandedFrom: null };
  const hit = METRO_ALIASES[clean.toLowerCase()] ?? STATE_ALIASES[clean.toLowerCase()];
  if (!hit) return { terms: [clean], expandedFrom: null };
  return {
    terms: hit.keepRaw ? [clean, ...hit.names] : [...hit.names],
    expandedFrom: clean,
  };
}
const INTENT_FILTERS: Array<{ re: RegExp; label: string; patch: Record<string, unknown> }> = [
  { re: /\bwork(?:ing)? from home\b/i, label: "work from home", patch: { workMode: "remote" } },
  { re: /\bwfh\b/i, label: "wfh", patch: { workMode: "remote" } },
  { re: /\btele(?:commut|work)\w*\b/i, label: "telecommute", patch: { workMode: "remote" } },
  { re: /\bhome[- ]based\b/i, label: "home based", patch: { workMode: "remote" } },
  { re: /\bremote(?:ly)? only\b/i, label: "remote only", patch: { workMode: "remote" } },
  { re: /\bremote(?:ly)?\b/i, label: "remote", patch: { workMode: "remote" } },
  { re: /\bhybrid\b/i, label: "hybrid", patch: { workMode: "hybrid" } },
  { re: /\bon[- ]?site\b/i, label: "onsite", patch: { workMode: "onsite" } },
  { re: /\bno experience(?: (?:required|needed|necessary))?\b/i, label: "no experience", patch: { experience: ["entry"] } },
  { re: /\bentry[- ]level\b/i, label: "entry level", patch: { experience: ["entry"] } },
  { re: /\bgraduate scheme\b/i, label: "graduate scheme", patch: { experience: ["entry"] } },
  { re: /\bpart[- ]?time\b/i, label: "part time", patch: { employmentType: "part_time" } },
  { re: /\bfull[- ]?time\b/i, label: "full time", patch: { employmentType: "full_time" } },
  { re: /\binternships?\b/i, label: "internship", patch: { employmentType: "internship" } },
  { re: /\binterns?\b/i, label: "intern", patch: { employmentType: "internship" } },
  { re: /\btemporary\b/i, label: "temporary", patch: { employmentType: "temporary" } },
  { re: /\bcontract(?:or|ing)? (?:role|position|work|job)s?\b/i, label: "contract role", patch: { employmentType: "contract" } },
  { re: /\bhiring (?:now|immediately)\b/i, label: "hiring now", patch: { maxAgeDays: 7 } },
  { re: /\bimmediate start\b/i, label: "immediate start", patch: { maxAgeDays: 7 } },
  { re: /\bposted today\b/i, label: "posted today", patch: { maxAgeDays: 1 } },
];
const INTENT_CONFLICTS: Record<string, string[]> = {
  remote: ["remote", "workMode"],
  workMode: ["remote", "workMode"],
  experience: ["experience"],
  maxAgeDays: ["maxAgeDays", "postedAfter"],
  employmentType: ["employmentType"],
};
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
    if (Object.keys(p).some((k) => (INTENT_CONFLICTS[k] ?? [k]).some((f) => body[f] !== undefined && body[f] !== null))) continue;
    const clash = Object.keys(p).find((k) => k in patch && patch[k] !== p[k]);
    if (clash) continue;
    residual = residual.replace(re, " ");
    const restates = Object.keys(p).every((k) => k in patch && patch[k] === p[k]);
    Object.assign(patch, p);
    if (!restates) labels.push(label);
  }
  if (labels.length === 0) return null;
  residual = residual.replace(/\s+/g, " ").trim();
  return { patch, labels, residualQ: residual };
}
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
  "manger": "manager",
};
function searchDisclosures(
  body: Record<string, unknown>,
  applied: { salaryFloor?: number | null; postedAfter?: string | null; excludeAgencies?: boolean },
  maxAgeClamped = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const dropped = queryTerms(body.q).dropped;
  if (dropped.length) out.droppedTerms = dropped;
  const fromQuery = salaryFromQueryText(body.q);
  if (fromQuery !== null && applied.salaryFloor === fromQuery) out.salaryFromQuery = fromQuery;
  const l = locationTerms(body.location);
  if (l.expandedFrom) { out.locationExpandedFrom = l.expandedFrom; out.locationSearched = l.terms; }
  if (maxAgeClamped) out.maxAgeClampedTo = 30;
  if (applied.postedAfter) out.postedAfterUsesStatedDate = true;
  if (applied.excludeAgencies) out.agenciesExcluded = true;
  const dym = DID_YOU_MEAN[String(body.q ?? "").trim().toLowerCase()];
  if (dym) out.didYouMean = dym;
  return out;
}
function intentDisclosure(r: { labels: string[] } | null): Record<string, unknown> {
  return r && r.labels.length ? { intentFilters: r.labels } : {};
}
function exclusionDisclosure(excluded: readonly string[]): Record<string, unknown> {
  return excluded.length ? { excludedTerms: [...excluded] } : {};
}
function exclusionCountsCaveat(excluded: readonly string[]): Record<string, unknown> {
  return excluded.length
    ? { total: null, countUnavailable: true, totalAtLeast: undefined, relatedTotal: undefined }
    : {};
}
function exclusionCeiling(excluded: readonly string[], ceiling: number | null): Record<string, unknown> {
  return excluded.length && typeof ceiling === "number" && Number.isFinite(ceiling) && ceiling >= 0
    ? { totalBeforeExclusions: ceiling }
    : {};
}
const MEASURED_COVERAGE = {
  payBasis: 0.106,
  hasStatedPay: 0.201,
  maxYears: 0.289,
  department: 0.405,
  vendor: 1,
} as const;
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
      maxYears?: number | null;
      department?: number | null;
      employmentType?: number | null;
    }
    | undefined;
  if (!cov) return {};
  const out: Record<string, number> = {};
  const liveOr = (live: unknown, pinned: number) => (typeof live === "number" ? live : pinned);
  if (applied.payBasis) out.payBasis = liveOr(cov.payBasis, MEASURED_COVERAGE.payBasis);
  if (applied.hasStatedPay) out.hasStatedPay = liveOr(cov.hasStatedPay, MEASURED_COVERAGE.hasStatedPay);
  if (applied.maxYears != null) out.maxYears = liveOr(cov.maxYears, MEASURED_COVERAGE.maxYears);
  if (applied.department) out.department = liveOr(cov.department, MEASURED_COVERAGE.department);
  if (applied.vendors?.length) out.vendor = MEASURED_COVERAGE.vendor;
  if (applied.employmentType && typeof cov.employmentType === "number") out.employmentType = cov.employmentType;
  if (applied.salaryFloor != null && typeof cov.salaryFloor === "number") out.salaryFloor = cov.salaryFloor;
  if (applied.salaryCeiling != null && typeof cov.salaryFloor === "number") out.salaryCeiling = cov.salaryFloor;
  if (applied.workMode != null && typeof cov.workMode === "number") out.workMode = cov.workMode;
  if (applied.experience?.length && typeof cov.experience === "number") out.experience = cov.experience;
  if (applied.country && typeof cov.country === "number") out.country = cov.country;
  return Object.keys(out).length ? { filterCoverage: out } : {};
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("action") === "sitemap" && !u.searchParams.has("page")) {
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
      const dayEnd = new Date(Date.now() - page * 86_400_000).toISOString();
      const dayStart = new Date(Date.now() - (page + 1) * 86_400_000).toISOString();
      const rows: Array<{ id: string; posted_at: string }> = [];
      let lastId = "";
      for (let c = 0; c < 50; c++) { 
        let q = client
          .from("job_board_postings")
          .select("id, posted_at")
          .is("missing_since", null)
          .gte("posted_at", dayStart)
          .lt("posted_at", dayEnd)
          .order("id", { ascending: true })
          .limit(1_000);
        if (lastId) q = q.gt("id", lastId);
        const { data: chunk, error: chunkErr } = await q;
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
      const days = Math.min(Math.max(Number(body.days) || 7, 1), 90);
      const { data, error } = await client.rpc("get_search_quality", { p_days: days });
      if (error) return json({ error: error.message, code: error.code ?? null }, 500);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      return json({
        days,
        recording: rows.length > 0,
        byDay: rows,
      });
    }
    if (action === "host_sweep") {
      const SLICE = 200;
      const state = await client.from("job_board_meta").select("v, updated_at").eq("k", "host_sweep").maybeSingle();
      const lockAge = state.data?.updated_at ? Date.now() - new Date(state.data.updated_at).getTime() : Infinity;
      if (lockAge < 5 * 60_000) return json({ skipped: "a sweep ran moments ago" });
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
        const inCensus = new Set(list.map((l) => l.host));
        for (const h of Object.keys(hosts)) if (!inCensus.has(h)) delete hosts[h]; 
        const failing = Object.entries(hosts).filter(([, v]) => v.fails >= 2);
        const postingsOnFailing = failing.reduce((n, [, v]) => n + (v.postings || 0), 0);
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
      const { error: persistErr } = await client.from("job_board_meta").upsert(
        { k: "host_sweep", v: { cursor: wrapped ? 0 : cursor, hosts, list: wrapped ? [] : list, cycleAt: wrapped ? new Date().toISOString() : sv.cycleAt ?? null, lastArrivedAt: svArrive.lastArrivedAt, lastTick: { at: new Date().toISOString(), swept: slice.length, wrapped } }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      if (persistErr) console.log(`[JOB-BOARD] host sweep persist FAILED: ${persistErr.message}`);
      return json({ swept: slice.length, cursor: wrapped ? 0 : cursor, of: list.length, wrapped, persisted: !persistErr });
    }
    if (action === "status") {
      const [prog, pbMeta, rot, refreshMeta, bf, hotMeta, fresh, breaker, dateCov, boardFlow, ingestPaused, dcCache, bsMeta, dsMeta, ssMeta, esMeta, fiOk, fiBad, faMeta, aaMeta, arMeta, rsRun, rsCron, hsMeta, rcProg, rcVer, hwMeta, deepCur, chainKick, sliceStatsRow] = await Promise.all([
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "posted_backfill").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "cold_rotation").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "hot_tokens").maybeSingle(),
        withDeadline(client.rpc("get_freshness_stats"), 2_500),
        client.from("job_board_meta").select("v").eq("k", "vendor_breaker").maybeSingle(),
        withDeadline(client.rpc("get_date_coverage"), 2_500),
        client.from("job_board_meta").select("v, updated_at").eq("k", "board_flow_cache").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "ingest_paused").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "date_coverage_cache").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "bootstrap").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "desc_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "structured_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "embed_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "filter_integrity_ok").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "filter_integrity_incident").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "filter_audit").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "apply_agent_run").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "agent_runner_run").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "reconcile_stripe_run").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "reconcile_stripe_cron").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "host_sweep").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "recategorize_progress").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "category_rules_version").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "catalog_highwater").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "deep_cursor").maybeSingle(),
        client.from("job_board_meta").select("v, updated_at").eq("k", "chain_kick").maybeSingle(),
        client.from("job_board_meta").select("v").eq("k", "slice_stats").maybeSingle(),
      ]);
      const pgV = (prog.data?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[]; failedTotal?: number };
      const rotV = (rot.data?.v ?? {}) as { completedAt?: string; coldBoards?: number };
      const rfV = (refreshMeta.data?.v ?? {}) as { total?: number };
      const dormant = ((bf.data?.v ?? {}) as { dormant?: Record<string, number> }).dormant ?? {};
      const hotTokens = ((hotMeta.data?.v ?? {}) as { tokens?: unknown[] }).tokens;
      const now = Date.now();
      const ageMin = (ts?: string | null) => (ts ? Math.round((now - new Date(ts).getTime()) / 60000) : null);
      if (Array.isArray((dateCov as { data?: unknown }).data)) {
        void client.from("job_board_meta").upsert({
          k: "date_coverage_cache",
          v: (dateCov as { data: unknown[] }).data,
          updated_at: new Date().toISOString(),
        }, { onConflict: "k" }).then(() => {}, () => {});
      }
      const pbBacklogNow = await undatedBacklog(client);
      return json({
        version: BUILD_VERSION,
        questionVendors: realQuestionVendors(),
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
                wakeConfig: v.wakeConfig ?? null,
                mandates: v.mandates ?? null,
                prepared: v.prepared ?? null,
                released: v.released ?? null,
                scheduleProven: cronAt !== null && (ageMin(cronAt) ?? 1e9) < 120,
              };
            })()
          : null,
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
                searches: v.prepared ?? null,
                picked: v.released ?? null,
                scheduleProven: cronAt !== null && (ageMin(cronAt) ?? 1e9) < 1500,
              };
            })()
          : null,
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
            lastCronAt: cronAt,
            cronAgeMin: ageMin(cronAt),
            checkedPaid: run.checkedPaid ?? null,
            orphans: run.orphans ?? null,
            alerted: run.alerted ?? null,
            scheduleProven: cronAt !== null && (ageMin(cronAt) ?? 1e9) < 1500,
          };
        })(),
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
        orphanPruneBlocked: JOB_SOURCES.length < (Number((hwMeta.data?.v as { size?: number } | null)?.size) || 0),
        categorizeVersion: CATEGORIZE_VERSION,
        hotTier: Array.isArray(hotTokens) && hotTokens.length >= 50 ? hotTokens.length : HOT_SIZE,
        descSweep: {
          vendor: ((dsMeta.data?.v ?? {}) as { vendor?: string }).vendor ?? null,
          doneAt: ((dsMeta.data?.v ?? {}) as { doneAt?: string }).doneAt ?? null,
          ageMin: dsMeta.data?.updated_at ? Math.round((Date.now() - new Date(dsMeta.data.updated_at).getTime()) / 60000) : null,
        },
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
            top: entries.slice(0, 8).map(([token, offset]) => ({ token, offset })),
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
          firstId: ((ssMeta.data?.v ?? {}) as { firstId?: string }).firstId ?? null,
          lastId: ((ssMeta.data?.v ?? {}) as { lastId?: string }).lastId ?? null,
          pageLen: ((ssMeta.data?.v ?? {}) as { pageLen?: number }).pageLen ?? null,
          ageMin: ssMeta.data?.updated_at ? Math.round((Date.now() - new Date(ssMeta.data.updated_at).getTime()) / 60000) : null,
        },
        embedSweep: {
          doneAt: ((esMeta.data?.v ?? {}) as { doneAt?: string }).doneAt ?? null,
          note: ((esMeta.data?.v ?? {}) as { note?: string }).note ?? null,
          ageMin: esMeta.data?.updated_at ? Math.round((Date.now() - new Date(esMeta.data.updated_at).getTime()) / 60000) : null,
        },
        filterContract: (() => {
          const okAt = fiOk.data?.updated_at ? new Date(fiOk.data.updated_at).getTime() : null;
          const badAt = fiBad.data?.updated_at ? new Date(fiBad.data.updated_at).getTime() : null;
          const bad = (fiBad.data?.v ?? {}) as { at?: string; violations?: number; fields?: string[] };
          return {
            okAgeMin: okAt === null ? null : Math.round((Date.now() - okAt) / 60000),
            lastIncidentAt: bad.at ?? null,
            lastIncidentAgeMin: badAt === null ? null : Math.round((Date.now() - badAt) / 60000),
            lastIncidentFields: bad.fields ?? null,
            lastIncidentViolations: bad.violations ?? null,
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
            backlog: pbBacklogNow,
            backlogAtSweep: v.backlogAtSweep ?? null,
            backlogGrowth: typeof pbBacklogNow === "number" && typeof v.backlogAtSweep === "number"
              ? pbBacklogNow - v.backlogAtSweep
              : null,
            due: postedBackfillDue(v, pbBacklogNow),
          };
        })(),
        totalPostings: rfV.total ?? null,
        coldBoards: rotV.coldBoards ?? null,
        dormantBoards: Object.keys(dormant).length,
        chainKick: (() => {
          const v = (chainKick.data?.v ?? {}) as Record<string, unknown>;
          const at = chainKick.data?.updated_at ?? null;
          return {
            outcome: v.outcome ?? null,       
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
        failedCount: Number(pgV.failedTotal) || 0,
        freshness: Array.isArray((fresh as { data?: unknown }).data) && ((fresh as { data: unknown[] }).data)[0]
          ? ((fresh as { data: unknown[] }).data)[0]
          : null,
        quarantinedVendors: (((breaker.data?.v ?? {}) as { quarantined?: string[] }).quarantined ?? []),
        boardFlow: (() => {
          const r = (boardFlow as { data?: { v?: unknown } } | null)?.data?.v;
          const row = Array.isArray(r) ? r[0] : r;
          return row && typeof row === "object" ? row : null;
        })(),
        boardFlowAgeMin: ageMin(
          (boardFlow as { data?: { updated_at?: string } } | null)?.data?.updated_at ?? null,
        ),
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
          : ((dcCache.data?.v as unknown[] | undefined) ?? null),
        at: new Date().toISOString(),
      });
    }
    if (action === "vendor-health") {
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
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "filter-audit is a maintenance action" }, 403);
      }
      const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
        { name: "category=Design (case)", body: { category: "Design" }, col: "category", val: "design" },
        { name: "workMode=HYBRID (case)", body: { workMode: "HYBRID" }, col: "work_mode", val: "hybrid" },
        { name: "combo DE+design", body: { country: "DE", category: "design" } },
        { name: "excludeAgencies=true", body: { excludeAgencies: true } },
      ];
      const IGNORE_CASES: Array<{ name: string; body: Record<string, unknown>; expect: string }> = [
        { name: "country=USA", body: { country: "USA" }, expect: "country" },
        { name: "experience=bogus", body: { experience: "bogus" }, expect: "experience" },
        { name: "experience=[bogus]", body: { experience: ["bogus"] }, expect: "experience" },
        { name: "experience=[senior,bogus]", body: { experience: ["senior", "bogus"] }, expect: "experience" },
        { name: "category=nonsense", body: { category: "nonsense" }, expect: "category" },
        { name: "workMode=hovering", body: { workMode: "hovering" }, expect: "workMode" },
        { name: 'excludeAgencies="true"', body: { excludeAgencies: "true" }, expect: "excludeAgencies" },
      ];
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
      const inBatches = async <T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
        const out: R[] = [];
        for (let i = 0; i < items.length; i += size) {
          out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
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
        const { applied: ap } = normalizeFilters(c.body, JOB_SOURCES.length);
        const bad = filterViolations(jobs, ap);
        if (bad.length) {
          findings.push({ case: c.name, kind: "precision", detail: `${bad.length}/${jobs.length} rows violate ${[...new Set(bad.map((b) => b.field))].join(",")}` });
        }
        if (!jobs.length) findings.push({ case: c.name, kind: "empty-page", detail: "a filter with matches returned no rows" });
        if (Array.isArray(r.body.ignoredFilters) && (r.body.ignoredFilters as string[]).length) {
          findings.push({ case: c.name, kind: "unexpected-ignored", detail: (r.body.ignoredFilters as string[]).join(",") });
        }
        if (r.body.filterIntegrity) {
          findings.push({ case: c.name, kind: "self-check-fired", detail: JSON.stringify(r.body.filterIntegrity).slice(0, 90) });
        }
        if (c.col && c.val && r.body.countCapped === true) {
          const truth = await exactCount(c.col, c.val);
          if (truth !== null && truth < 10_000) {
            findings.push({ case: c.name, kind: "false-cap", detail: `reported capped (10,000+) but the true count is ${truth}` });
          }
        }
        if (c.col && c.val && r.body.countCapped !== true && typeof r.body.total === "number") {
          const truth = await exactCount(c.col, c.val);
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
      await Promise.all([{}, { category: "design" }, { q: "nurse" }].map(async (shape) => {
        const seen: string[] = [];
        const label = Object.keys(shape).length ? JSON.stringify(shape) : "no-filter";
        for (let off = 0; off < 240; off += 60) {
          const r = await probe({ ...shape, offset: off });
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
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "recategorize is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      const hopVersion = Number(body.rulesVersion);
      if ((Number.isFinite(hopVersion) && hopVersion !== CATEGORIZE_VERSION) || (!Number.isFinite(hopVersion) && cursor)) {
        return json({ ok: false, superseded: true, current: CATEGORIZE_VERSION });
      }
      await client.from("job_board_meta").upsert(
        { k: "recategorize_progress", v: { cursor, version: CATEGORIZE_VERSION, startedUnder: CATEGORIZE_VERSION, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      let scanned = 0;
      const changed = new Map<string, string[]>(); 
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
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-experience is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      let scanned = 0;
      const groups = new Map<string, string[]>(); 
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
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-posted is a maintenance action" }, 403);
      }
      const phase = ["greenhouse", "rippling", "pinpoint"].includes(String(body.phase))
        ? String(body.phase) as "greenhouse" | "rippling" | "pinpoint"
        : "bamboohr";
      const perPosting = phase === "bamboohr" || phase === "rippling";
      const BOARDS_PER_HOP = 40; 
      const IDS_PER_HOP = 120;
      let cursor = typeof body.cursor === "string" && body.cursor.startsWith(`${phase}:`) ? body.cursor : `${phase}:`;
      const { data: pbPrev } = await client.from("job_board_meta").select("v").eq("k", "posted_backfill").maybeSingle();
      const pbDone = (pbPrev?.v as { version?: number } | null)?.version;
      await client.from("job_board_meta").upsert(
        { k: "posted_backfill", v: { ...(typeof pbDone === "number" ? { version: pbDone } : {}), resumeVersion: POSTED_BACKFILL_VERSION, phase, cursor, datedTotal: (typeof body.datedTotal === "number" ? body.datedTotal : 0), note: typeof body.note === "string" ? body.note.slice(0, 200) : null, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      const byBoard = new Map<string, { company: string; ids: string[] }>();
      let scanned = 0;
      let exhausted = false;
      let drawFailed = false;
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
          await client.from("job_board_meta").upsert(
            { k: "posted_backfill", v: { resumeVersion: POSTED_BACKFILL_VERSION, phase, cursor, note: `draw: ${error.message ?? error}`.slice(0, 200), at: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: "k" });
          drawFailed = true;
          exhausted = true;
          break;
        }
        let brokeEarly = false;
        for (const r of rows ?? []) {
          const tk = r.company_token as string;
          if (!perPosting && !byBoard.has(tk) && byBoard.size >= BOARDS_PER_HOP) continue; 
          if (perPosting && scanned >= IDS_PER_HOP) { brokeEarly = true; break; }
          scanned++;
          const g = byBoard.get(tk) ?? { company: (r.company as string) ?? tk, ids: [] };
          g.ids.push(r.id as string);
          byBoard.set(tk, g);
          cursor = r.id as string;
        }
        if (!brokeEarly && (!rows || rows.length < 500)) exhausted = true;
        if (cursor === lastCursor && !brokeEarly) exhausted = true;
        lastCursor = cursor;
      }
      let dated = 0;
      let lastBoardError = "";
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
            const psrc = JOB_SOURCES.find((s) => s.source === "pinpoint" && s.token === tk);
            if (!psrc) continue;
            const r = await fetchBoard(psrc);
            const data = ((r?.raw as { data?: Array<{ id?: string | number; url?: string }> })?.data) ?? [];
            const urlById = new Map<string, string>();
            for (const it of data) if (it?.id != null && it.url) urlById.set(String(it.id), String(it.url));
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
            if (!error) dated++;
            else if (!lastBoardError) lastBoardError = `update ${id.slice(0, 40)}: ${error.message ?? error}`.slice(0, 160);
          }
          boardsDone++;
          if (boardsDone % 10 === 0) {
            await beacon(`boards ${boardsDone}/${byBoard.size} dated=${dated}${lastBoardError ? ` last=${lastBoardError}` : ""}`);
          }
        } catch (e) {
          lastBoardError = `${tk}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
        }
      }
      const datedTotal = (typeof body.datedTotal === "number" ? body.datedTotal : 0) + dated;
      const scannedTotal = (typeof body.scannedTotal === "number" ? body.scannedTotal : 0) + scanned;
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
      const NEXT_PHASE: Record<string, string> = { bamboohr: "rippling", rippling: "pinpoint", pinpoint: "greenhouse" }; 
      if (NEXT_PHASE[phase]) {
        chain({ phase: NEXT_PHASE[phase], datedTotal, scannedTotal, note: lastBoardError ? `board ${lastBoardError}` : `phase done: ${datedTotal}/${scannedTotal}` }); 
        return json({ ok: true, phase, scanned, dated, datedTotal, scannedTotal, next: NEXT_PHASE[phase] });
      }
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
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-salary is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      let scanned = 0;
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
          if (nextMin === curMin && nextMax === curMax && nextPer === curPer && nextCur === curCur) continue; 
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
      const t_entry = Date.now();
      const META_DEADLINE_MS = 3_000;
      const t_meta = Date.now();
      const META_TIMEOUT = Symbol("meta-timeout");
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
        const fatRes = await raceMeta(
          client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle(),
        );
        if (fatRes === META_TIMEOUT) metaTimedOut = true;
        meta = (fatRes === META_TIMEOUT
          ? null
          : (fatRes.data ?? null)) as { v: Record<string, unknown>; updated_at: string } | null;
      }
      const preMs: Record<string, number> = { meta_read: Date.now() - t_meta };
      if (!meta) {
        if (!metaTimedOut) waitUntil(runRefresh(client, true));
        else console.warn(`[JOB-BOARD] meta read expired after ${Date.now() - t_meta}ms — serving without the headline, NOT seeding`);
        return await serveList(client, body, undefined, t_entry, preMs);
      }
      if (Date.now() - new Date(meta.updated_at).getTime() > STALE_MS) {
        waitUntil(runRefresh(client)); 
      }
      return await serveList(client, body, meta, t_entry, preMs);
    }
    if (action === "fit-batch") {
      const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 60) : [];
      if (resumeText.trim().length < 100 || ids.length === 0) {
        return json({ error: "resumeText (100+ chars) and ids are required" }, 400);
      }
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
      const missing: Record<string, string[]> = {};
      const matched: Record<string, string[]> = {};
      let scored = 0;
      const resumeScan = scanResume(resumeText);
      for (const r of rows ?? []) {
        if (r.description && r.description.length > 150) {
          const f = computeFit(r.description, resumeScan, 40);
          fits[r.id] = f.pct;
          if (f.missing.length > 0) missing[r.id] = f.missing.slice(0, 4);
          if (f.matched.length > 0) matched[r.id] = f.matched.slice(0, 6);
          scored++;
        } else {
          fits[r.id] = null; 
        }
      }
      return json({ fits, missing, matched, scored, of: ids.length });
    }
    if (action === "backfill-desc") {
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-desc is a maintenance action" }, 403);
      }
      await loadDynamicLight(client); 
      const BOARDS = JOB_SOURCES.filter((s) => s.source === "greenhouse" && isLight(s.token));
      const PER_HOP = 50; 
      let ti = Math.max(0, Number(body.ti) || 0);
      await client.from("job_board_meta").upsert(
        { k: "desc_backfill", v: { runningTi: ti }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      if (ti >= BOARDS.length) {
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
      const { data: rows, error: readErr } = await client
        .from("job_board_postings")
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
          const gh = greenhouseApi(s.token); 
          const res = await fetchWithTimeout(`https://${gh.host}/v1/boards/${gh.token}/jobs/${ghId}?questions=false`);
          if (!res.ok) continue;
          const job = (await res.json()) as { content?: string };
          const text = job.content ? clean(htmlToText(String(job.content).slice(0, RAW_HTML_CAP)).trim()).slice(0, STORED_DESC_CAP) : "";
          if (text) {
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
        } catch {  }
      }
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
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "embed-sweep is a maintenance action" }, 403);
      }
      await client.from("job_board_meta").upsert(
        { k: "embed_sweep", v: { at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
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
              if (insErr) console.warn(`[JOB-BOARD] embed seed insert failed: ${insErr.message?.slice(0, 100)}`);
            }
            if (!(missing.length > 0) || seeded > 0) {
              await client.from("job_board_meta").upsert(
                { k: "embed_seed", v: { cursor: ids[ids.length - 1] }, updated_at: new Date().toISOString() },
                { onConflict: "k" },
              );
            }
          }
        } catch {  }
      }
      const { data: batch, error: bErr } = await client.rpc("get_embed_batch", { p_limit: EMBED_PER_HOP });
      if (bErr) {
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
        if (Date.now() - hopStart > EMBED_HOP_WALL_MS) break;
        const input = buildEmbedInput(r.title, r.company, r.location, r.descr);
        if (!input) continue;
        const vec = await embedText(input);
        if (!vec) continue; 
        const { error: uErr } = await client.from("job_board_embeddings").upsert(
          { id: r.id, embedding: JSON.stringify(vec), embedded_desc: r.has_desc === true, updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );
        if (!uErr) embedded++;
      }
      if (embedded === 0) {
        await client.from("job_board_meta").upsert(
          { k: "embed_sweep", v: { doneAt: new Date().toISOString(), note: "inference unavailable" }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        return json({ ok: false, embedded: 0, note: "inference unavailable" });
      }
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
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
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-country is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
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
      await client.from("job_board_meta").upsert(
        { k: "country_version", v: { version: COUNTRY_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] country backfill complete: ${scanned} scanned, ${updated} filled (map v${COUNTRY_MAP_VERSION})`);
      return json({ ok: true, scanned, updated, done: true });
    }
    if (action === "desc-sweep") {
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "desc-sweep is a maintenance action" }, 403);
      }
      let vi = Math.max(0, Number(body.vi) || 0);
      const vstart = Math.max(0, Number(body.vstart) || 0) % DETAIL_DESC_SOURCES.length;
      if (vi >= DETAIL_DESC_SOURCES.length) {
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
        const { data: nullRows } = await client
          .from("job_board_postings")
          .select("id, country, title") 
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
          } catch {  }
        }
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
          if (!src) continue; 
          const externalId = String(row.id).split(":").slice(2).join(":");
          if (!externalId) continue;
          try {
            const { text, postedAt, workMode: wmVendor } = await fetchVendorDetail(src, row.id, externalId, row.apply_url);
            if (!text) {
              const salv: Record<string, unknown> = {};
              if (wmVendor) { salv.work_mode = wmVendor; salv.remote = wmVendor === "remote"; }
              if (postedAt && (vendor === "workday" || !row.posted_at)) salv.posted_at = postedAt;
              if (Object.keys(salv).length) {
                const q = client.from("job_board_postings").update(salv).eq("id", row.id);
                await (wmVendor ? q.is("work_mode", null) : q);
              }
              continue;
            }
            const clean = text.replace(/\u0000/g, "").slice(0, STORED_DESC_CAP);
            if (!clean) continue;
            const minedSalary = extractSalary(clean);
            const minedParse = minedSalary ? parseSalaryStructured(minedSalary, (row as { country?: string | null }).country, { title: (row as { title?: string | null }).title ?? null, description: clean }) : null;
            const exp = detectExperience(row.title ?? "", clean);
            const wm = wmVendor ?? (row.work_mode ? null : detectWorkMode(row.location, row.title));
            const betterDate = postedAt && (vendor === "workday" || !row.posted_at) ? postedAt : null;
            const { error } = await client.from("job_board_postings")
              .update({
                description: clean,
                ...(exp.band ? { experience_band: exp.band, min_years: exp.minYears } : {}),
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
              .is("description", null); 
            if (!error) updated++;
          } catch {  }
        }
      }));
      const exhausted = queue.length < DESC_SWEEP_PER_HOP || updated === 0;
      if (exhausted) {
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
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "structured-sweep is a maintenance action" }, 403);
      }
      let vi = Math.max(0, Number(body.vi) || 0);
      const passScanned = Math.max(0, Number(body.passScanned) || 0);
      const passFilled = Math.max(0, Number(body.passFilled) || 0);
      if (vi >= STRUCTURED_SWEEP_SOURCES.length) {
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
      const cursor = String(body.cursor ?? "") || `${sVendor}:`;
      await client.from("job_board_meta").upsert(
        { k: "structured_sweep", v: { vendor: sVendor, running: true, cursor, at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      let sel = client
        .from("job_board_postings")
        .select("id, company_token, apply_url, posted_at, work_mode")
        .eq("source", sVendor)
        .not("description", "is", null)
        .is("work_mode", null)
        .order("id", { ascending: true })
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
            const patch: Record<string, unknown> = {};
            if (workMode) { patch.work_mode = workMode; patch.remote = workMode === "remote"; }
            if (postedAt && !row.posted_at) patch.posted_at = postedAt;
            if (!Object.keys(patch).length) continue;
            const { data: wrote, error } = await client.from("job_board_postings")
              .update(patch)
              .eq("id", row.id)
              .is("work_mode", null)
              .select("id");
            if (!error) sFilled += (wrote?.length ?? 0);
          } catch {  }
        }
      }));
      const nextCursor = sQueue.length ? sQueue[sQueue.length - 1].id : "";
      const sDone = sQueue.length < STRUCTURED_SWEEP_PER_HOP;
      if (sDone) vi += 1;
      const cumScanned = passScanned + sSeen;
      const cumFilled = passFilled + sFilled;
      await client.from("job_board_meta").upsert({
        k: "structured_sweep",
        v: {
          vendor: sVendor, cursor: sDone ? "" : nextCursor,
          scanned: cumScanned, filled: cumFilled, at: new Date().toISOString(),
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
      const postingId = String(body.postingId ?? "").slice(0, 200);
      if (!postingId) return json({ ok: false, reason: "postingId required" }, 400);
      const rawSid = String(body.searchId ?? "");
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
      return json({ ok: true });
    }
    if (action === "verify") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
      if (ids.length === 0) return json({ live: {} });
      const liveMap: Record<string, boolean> = {};
      const deadIds: string[] = [];
      const demandTokens = new Set<string>();
      liveBoardMemo.clear();
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
        else liveMap[id] = true; 
      }
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
      if (demandTokens.size > 0) {
        const { data: dm } = await client.from("job_board_meta").select("v").eq("k", "demand").maybeSingle();
        const prev = ((dm?.v as { tokens?: Array<{ t: string; at: number }> } | null)?.tokens ?? []).filter((x) => Date.now() - x.at < 20 * 60_000);
        const merged = [...prev.filter((x) => !demandTokens.has(x.t)), ...[...demandTokens].map((t) => ({ t, at: Date.now() }))].slice(-60);
        await client.from("job_board_meta").upsert({ k: "demand", v: { tokens: merged }, updated_at: new Date().toISOString() }, { onConflict: "k" });
      }
      return json({ live: liveMap, flagged: deadIds.length });
    }
    if (action === "audit") {
      const AUDIT_SAMPLE = 100;
      const { data: prevAudit } = await client.from("job_board_meta").select("v, updated_at").eq("k", "audit").maybeSingle();
      const prevAge = prevAudit ? Date.now() - new Date(prevAudit.updated_at).getTime() : Infinity;
      if (prevAge < 20 * 3600_000 && body.force !== true) {
        return json({ ...(prevAudit?.v as Record<string, unknown>), cached: true });
      }
      const { count: totalRows } = await client.from("job_board_postings").select("id", { count: "planned", head: true });
      const corpus = totalRows ?? 0;
      const VENDORS = [...new Set(JOB_SOURCES.map((s) => s.source))];
      const PER_VENDOR = Math.max(4, Math.floor(AUDIT_SAMPLE / Math.max(1, VENDORS.length)));
      const sampleIds: string[] = [];
      const applyBy = new Map<string, string | null>();
      const vendorRows: Record<string, number | null> = {};
      const drawErrors: Record<string, string> = {};
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
        if (n === 0) continue;
        sampleIds.push(...await drawIds(v, Math.min(PER_VENDOR, n ?? PER_VENDOR)));
      }
      let live = 0, gone = 0, unknown = 0;
      const byVendor: Record<string, { sampled: number; live: number; gone: number; unknown: number; accuracyPct: number | null; deepened?: boolean }> = {};
      liveBoardMemo.clear();
      const probeAll = async (ids: string[], headline: boolean) => {
        for (let i = 0; i < ids.length; i += 8) {
          const batch = ids.slice(i, i + 8);
          const results = await Promise.all(batch.map(async (id) => {
            const [source, token, ...rest] = id.split(":");
            const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
            if (!src || rest.length === 0) return null; 
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
      const SUSPECT_PCT = 90;
      const DEEPEN_TO = 30;
      const deepened: Array<{ source: string; firstPassPct: number; added: number }> = [];
      for (const [v, b] of Object.entries(byVendor)) {
        const d = b.live + b.gone;
        if (d === 0 || (b.live / d) * 100 >= SUSPECT_PCT) continue;
        if (d >= DEEPEN_TO) continue;
        const firstPassPct = Math.round((b.live / d) * 1000) / 10;
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
      const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
      if (!src || !externalId) return json({ error: "Unknown job id" }, 404);
      const { data: jobRow } = await client.from("job_board_postings").select("*").eq("id", id).is("missing_since", null).maybeSingle();
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
      if (!stored && description && jobRow) {
        const minedSalary = jobRow.salary ? null : extractSalary(description);
        const minedParse = minedSalary ? parseSalaryStructured(minedSalary, jobRow.country as string | null, { title: jobRow.title as string | null, description }) : null;
        const expRead = detectExperience(String(jobRow.title ?? ""), description);
        const wmRead = jobRow.work_mode ? null : detectWorkMode(jobRow.location as string | null, jobRow.title as string | null);
        waitUntil((async () => {
          try {
            await client.from("job_board_postings").update({
              description: description.replace(/\u0000/g, "").slice(0, STORED_DESC_CAP),
              ...(expRead.band ? { experience_band: expRead.band, min_years: expRead.minYears } : {}),
              ...(wmRead ? { work_mode: wmRead, remote: wmRead === "remote" } : {}),
              ...(minedSalary ? {
                salary: minedSalary,
                salary_min_annual: minedParse?.annualMin ?? null,
                salary_max_annual: minedParse?.annualMax ?? null,
                salary_period: minedParse?.period ?? null,
                salary_currency: minedParse?.currency ?? null,
              } : {}),
            }).eq("id", id).is("description", null);
          } catch {  }
        })());
      }
      const detailJobs = jobRow ? await attachRecheckedAt(client, [rowToJob(jobRow) as unknown as Record<string, unknown>]) : [];
      return json({ job: detailJobs[0] ?? null, description });
    }
    if (action === "application-questions") {
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
        const rec = await res.json() as any;
        const offer = rec?.offer ?? rec;
        if (!offer || typeof offer !== "object") return unsupported();
        const questions: Q[] = (Array.isArray(offer.open_questions) ? offer.open_questions : [])
          .map((q: any) => {
            const label = String(q?.body ?? "").trim();
            const type = String(q?.kind ?? "");
            return { label, required: !!q?.required, type, class: classifyQuestion(label, type) };
          })
          .filter((q: Q) => q.label);
        const requirements: string[] = [];
        for (const [key, name] of [["options_cv", "Resume / CV"], ["options_cover_letter", "Cover letter"], ["options_photo", "Photo"]] as const) {
          const v = String(offer[key] ?? "off");
          if (v === "required" || v === "optional") requirements.push(`${name} (${v})`);
        }
        return json({ vendor: source, supported: true, questions, requirements });
      }
      if (source === "breezy" || source === "pinpoint") {
        const { data: row } = await client
          .from("job_board_postings").select("apply_url").eq("id", id).maybeSingle();
        const postingUrl = String((row as { apply_url?: string } | null)?.apply_url ?? "");
        if (!postingUrl) return unsupported();
        const url = source === "breezy" ? breezyApplyUrl(postingUrl) : pinpointApplyUrl(postingUrl);
        const res = await fetchWithTimeout(url);
        if (!res.ok) return unsupported();
        const html = await res.text();
        const raw = source === "breezy" ? parseBreezyQuestions(html) : parsePinpointQuestions(html);
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
let attachMsAccum = 0;
async function attachRecheckedAt(
  client: SupabaseClient,
  jobs: Array<Record<string, unknown>>,
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
  const tokens = [...new Set(jobs.map((j) => String(j.token ?? "")).filter(Boolean))].slice(0, 80);
  if (tokens.length === 0) return jobs;
  const { data, error } = await withDeadline(
    client.from("job_board_verifications").select("company_token,verified_at").in("company_token", tokens),
    1_500,
  ) as { data: unknown[] | null; error?: unknown };
  if (error || !Array.isArray(data)) return jobs;
  const byToken = new Map<string, string>();
  for (const r of data) {
    const t = (r as { company_token?: string }).company_token;
    const v = (r as { verified_at?: string }).verified_at;
    if (t && v) byToken.set(t, v);
  }
  for (const j of jobs) {
    const v = byToken.get(String(j.token ?? ""));
    if (v && !j.missingSince) j.recheckedAt = v;
  }
  return jobs;
}
function preferMatchedLocation(
  jobs: Array<Record<string, unknown>>,
  locTerms: string[],
): Array<Record<string, unknown>> {
  if (locTerms.length === 0) return jobs;
  const needles = locTerms.map((t) => t.toLowerCase().replace(/^,\s*/, "")).filter(Boolean);
  if (needles.length === 0) return jobs;
  for (const j of jobs) {
    const loc = typeof j.location === "string" ? j.location : "";
    const parts = loc.split(/\s*[;/]\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const hit = parts.findIndex((part) => needles.some((n) => part.toLowerCase().includes(n)));
    if (hit <= 0) continue; 
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
  missingSince: r.missing_since ?? null,
  ...(typeof r.agency === "boolean"
    ? {
      agency: r.agency,
    }
    : {}),
  ...(typeof r.snippet === "string" && r.snippet.includes("[[") ? { snippet: r.snippet } : {}),
  ...(typeof r.title_match === "boolean"
    ? { matchScope: r.title_match ? ("title" as const) : ("description" as const) }
    : {}),
});
async function serveList(
  client: SupabaseClient,
  body: Record<string, unknown>,
  meta?: { v: Record<string, unknown>; updated_at: string } | null,
  entryAt?: number,
  pre?: Record<string, number>,
) {
  const limitRaw = Number(body.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 200) : 60;
  const offsetRaw = Number(body.offset);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  const countOnly = body.countOnly === true;
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
  // EMPLOYMENT-TYPE LIFTS ARM THEMSELVES ON COVERAGE. Lifting "part time"
  // out of the query and into the filter is only an upgrade once enough of
  // the corpus carries a typed value — against thin coverage it would REPLACE
  // a working literal-text search with a near-empty filter (the exact
  // downgrade the work-mode lifts were measured NOT to be). Below the floor,
  // a sentinel in the lift's view of the body trips the caller's-own-filter
  // conflict rule for exactly those lifts: the words stay in the query and
  // behaviour is byte-identical to before the lifts existed. The gate reads
  // the same cached coverage figure the disclosure serves, so the feature
  // switches on by itself as rotation types the corpus.
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
  const reqStart = entryAt ?? Date.now();
  const budgetStart = Date.now();
  const phase: Record<string, number> = { ...(pre ?? {}) };
  attachMsAccum = 0;
  const phaseOutcome: Record<string, string> = {};
  const markFrom = (name: string, t0: number, outcome?: "ok" | "deadline" | "error" | "declined") => {
    phase[name] = (phase[name] ?? 0) + (Date.now() - t0);
    if (outcome) phaseOutcome[name] = outcome;
  };
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
      tookMs: Date.now() - reqStart,
      phaseMs: { ...phase, attachRecheckedAt: attachMsAccum },
      ...(Object.keys(phaseOutcome).length ? { phaseOutcome: { ...phaseOutcome } } : {}),
    };
  };
  const unfiltered = isUnfiltered(applied);
  const wantCount = !unfiltered;
  const openTotal = (() => {
    const cov = (meta?.v as Record<string, unknown> | undefined)?.coverage as { open?: unknown } | undefined;
    const n = Number(cov?.open);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const safeMetaTotal = openTotal ?? (Number.isFinite(metaTotal) && metaTotal > 0 ? metaTotal : null);
  const trackedTotal = (() => {
    const cov = (meta?.v as Record<string, unknown> | undefined)?.coverage as { tracked?: unknown } | undefined;
    const n = Number(cov?.tracked);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const OFFSET_CEILING = 1_000_000;
  if (!countOnly && (offset >= OFFSET_CEILING || (safeMetaTotal !== null && offset >= safeMetaTotal))) {
    return json({
      jobs: [], total: unfiltered ? safeMetaTotal : null, hasMore: false, nextOffset: offset,
      ...(!unfiltered || safeMetaTotal === null ? { countUnavailable: true } : {}),
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(maxAgeClamped ? { maxAgeClampedTo: 30 } : {}),
      ...exclusionDisclosure(excludedTerms),
      ...exclusionCountsCaveat(excludedTerms),
      searchId, totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
      companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0,
      refreshedAt: null,
      tookMs: Date.now() - reqStart,
      phaseMs: { ...phase },
      ...(Object.keys(phaseOutcome).length ? { phaseOutcome: { ...phaseOutcome } } : {}),
    });
  }
  const buildQuery = (
    dateCol: string,
    withCount = wantCount,
    categoryOverride?: string,
    opts?: { skipTerms?: boolean },
  ) => {
    let q = client
      .from("job_board_postings")
      .select(
        "id,source,company_token,company,title,location,country,remote,work_mode,employment_type,department,category,posted_at,apply_url,salary,salary_min_annual,salary_max_annual,salary_period,salary_currency,experience_band,min_years,agency,last_seen,missing_since,effective_posted",
        withCount ? { count: "exact" } : {},
      )
      .gte(dateCol, freshCutoffIso)
      .is("missing_since", null);
    const terms = queryTerms(body.q).terms.slice(0, 8);
    if (!opts?.skipTerms) for (const t of terms) q = q.or(`title.ilike.%${t}%,company.ilike.%${t}%,department.ilike.%${t}%`);
    const locTerms = locationTerms(body.location).terms;
    if (locTerms.length === 1) q = q.ilike("location", `%${locTerms[0]}%`);
    else if (locTerms.length > 1) q = q.or(locTerms.map((t) => `location.ilike."%${t}%"`).join(","));
    if (applied.remote) {
      q = q.eq("remote", true);
    }
    if (applied.workMode) q = q.in("work_mode", applied.workMode.split(","));
    if (applied.employmentType) q = q.in("employment_type", applied.employmentType.split(","));
    if (applied.country) {
      const cs = applied.country.split(",").filter(Boolean);
      q = cs.length > 1 ? q.in("country", cs) : q.eq("country", cs[0]);
    }
    if (categoryOverride) {
      const ov = categoryOverride.split(",").filter(Boolean);
      q = ov.length > 1 ? q.in("category", ov) : q.eq("category", ov[0]);
    } else if (applied.category) {
      const cats = applied.category.split(",").filter(Boolean);
      const wanted = applied.includeUncategorised ? [...cats, "other"] : cats;
      q = wanted.length > 1 ? q.in("category", wanted) : q.eq("category", wanted[0]);
    }
    if (applied.sendableOnly) q = q.in("source", [...SENDABLE_VENDORS]);
    if (applied.experience.length === 1) q = q.eq("experience_band", applied.experience[0]);
    else if (applied.experience.length > 1) q = q.in("experience_band", applied.experience);
    if (applied.salaryFloor !== null) {
      q = applied.includeUnstatedPay
        ? q.or(`salary_rank_usd.gte.${applied.salaryFloor},salary_rank_usd.is.null`)
        : q.gte("salary_rank_usd", applied.salaryFloor);
    }
    if (applied.salaryCeiling !== null) {
      q = applied.includeUnstatedPay
        ? q.or(`salary_rank_usd.lte.${applied.salaryCeiling},salary_rank_usd.is.null`)
        : q.lte("salary_rank_usd", applied.salaryCeiling);
    }
    if (applied.hasStatedPay) q = q.not("salary_min_annual", "is", null);
    if (applied.payBasis === "hourly") q = q.eq("salary_period", "hour");
    else if (applied.payBasis === "salaried") q = q.in("salary_period", [...SALARIED_PERIODS]);
    if (applied.maxYears !== null) q = q.lte("min_years", applied.maxYears);
    if (applied.department) q = q.ilike("department", `%${applied.department}%`);
    if (applied.vendors.length) q = q.in("source", applied.vendors);
    if (applied.companies.length) q = q.in("company_token", applied.companies);
    if (applied.excludeAgencies) q = q.eq("agency", false);
    if (applied.postedAfter) q = q.gt("posted_at", applied.postedAfter);
    if (applied.maxAgeDays !== null) {
      q = q.gte("posted_at", new Date(Date.now() - applied.maxAgeDays * 86_400_000).toISOString());
    }
    return q;
  };
  const missingColumn = (e: { message?: string } | null) => !!e?.message?.includes("effective_posted");
  const COUNT_CAP = 10_000;
  const cappedCount = async (): Promise<{ n: number; capped: boolean } | null> => {
    if (applied.country && applied.country.includes(",")) return null;
    if (rpcBlindFilters(applied).length) return null;
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
      return Number.isFinite(n) ? { n, capped: row.capped === true } : null;
    } catch {
      return null; 
    }
  };
  const qt = queryTerms(body.q);
  const qText = qt.terms.join(" ").slice(0, 200) || (qt.liftedSalary ? "" : String(body.q ?? "").trim().slice(0, 200));
  if (body.facetCounts === true) {
    const FACET_CHUNK = 6;
    const FACET_DEADLINE = Date.now() + (qText ? 1_500 : 4_000);
    const counts: Record<string, number> = {};
    let facetCapped = false;
    const cats = [...JOB_CATEGORIES];
    for (let i = 0; i < cats.length; i += FACET_CHUNK) {
      if (Date.now() > FACET_DEADLINE) break;
      const chunk = cats.slice(i, i + FACET_CHUNK);
      const chunkBudget = Math.max(250, FACET_DEADLINE - Date.now());
      const facetQ = queryTerms(body.q).terms;
      const facetUseRpc = qText && facetQ.length <= 1;
      const chunkWork = Promise.all(chunk.map(async (c) => {
        try {
          if (facetUseRpc) {
            const t_count_jobs_capped_5 = Date.now();
            const { data, error } = await client.rpc("count_jobs_capped", {
              p_fresh_cutoff: freshCutoffIso,
              p_q: qText,
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
          const n = r.count ?? 0;
          return [c, Math.min(n, COUNT_CAP), n > COUNT_CAP] as const;
        } catch {
          return [c, null, false] as const;
        }
      }));
      const raced = await withDeadline(chunkWork, chunkBudget);
      const settled = Array.isArray(raced) ? raced : [];
      for (const [c, n, capped] of settled) {
        if (typeof n === "number") counts[c] = n;
        if (capped) facetCapped = true;
      }
    }
    return json({
      categories: counts,
      ...(facetCapped ? { countCapped: true } : {}),
      facetSource: qText ? "ranked" : "filters",
      appliedSignature: JSON.stringify(applied),
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
    });
  }
  const onlyQuery = isUnfiltered({ ...applied, q: "" });
  const routeDecision = qText && onlyQuery
    ? pickRoute(qText, EMPLOYER_ALIASES)
    : { route: "BROWSE" as const, reason: "not routable", tokens: undefined as string[] | undefined, matchedName: undefined as string | undefined };
  const routedRetriever = RETRIEVER_FOR[routeDecision.route];
  const ROUTE_WINDOW = 400;
  const routedQueryTokens = qText.split(/\s+/).filter(Boolean).length;
  const ROUTED_DEADLINE_MS = routedQueryTokens >= 3 ? 2_500 : 7_000;
  if (countOnly) {
    const countHonesty = {
      ...(ignoredFilters.length ? { ignoredFilters } : {}),
      ...(maxAgeClamped ? { maxAgeClampedTo: 30 } : {}),
      ...exclusionDisclosure(excludedTerms),
      ...exclusionCountsCaveat(excludedTerms),
    };
    if (!wantCount) return json({ total: safeMetaTotal, ...(safeMetaTotal === null ? { countUnavailable: true } : {}), ...countHonesty }); 
    if (qText && body.sort !== "salary" && (routedRetriever === "company" || routedRetriever === "simple")) {
      try {
        let rqC = buildQuery("effective_posted", false, undefined, { skipTerms: true });
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
          Math.min(ROUTED_DEADLINE_MS, budgetLeft()),
        ) as { data: unknown[] | null; error?: unknown };
        markFrom("related_count", t_related_count);
        if (rcRows === null) console.warn(`[JOB-BOARD] routed count (${routeDecision.route}) hit its deadline for q=${JSON.stringify(qText)}`);
        if (!rcErr && Array.isArray(rcRows) && rcRows.length > 0) {
          const rcCapped = rcRows.length >= ROUTE_WINDOW;
          return json({ total: rcCapped ? null : rcRows.length, ...(rcCapped ? { countUnavailable: true, totalAtLeast: rcRows.length } : {}), ...countHonesty });
        }
      } catch {  }
    }
    const qtC = queryTerms(body.q);
    const qTextC = qtC.terms.join(" ").slice(0, 200) || (qtC.liftedSalary ? "" : String(body.q ?? "").trim().slice(0, 200));
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
          const trC = Number((rc[0] as { total_rows?: number } | undefined)?.total_rows);
          const tC = rc.length ? (Number.isFinite(trC) ? trC : rc.length) : 0;
          const rrC = Number((rc[0] as { related_rows?: number | null } | undefined)?.related_rows);
          const relC = rc.length && Number.isFinite(rrC) ? rrC : null;
          const tier2C = (rc as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string");
          const cappedC = relC === null ? tC >= (tier2C ? 3_000 : 10_000) : tC >= 10_000;
          return json({
            total: tC,
            ...(cappedC ? { countCapped: true } : {}),
            ...(relC === null || relC === 0
              ? {}
              : { relatedTotal: relC, ...(tC + relC >= 3_000 ? { relatedCapped: true } : {}) }),
            ...countHonesty,
          });
        }
      } catch {  }
    }
    const t_count_direct = Date.now();
    const capped = await cappedCount();
    markFrom("count_jobs_capped", t_count_direct);
    if (capped) return json({ total: capped.n, ...(capped.capped ? { countCapped: true } : {}), ...countHonesty });
    let { count, error } = await buildQuery("effective_posted").range(0, 0);
    if (missingColumn(error)) ({ count, error } = await buildQuery("posted_at").range(0, 0));
    if (error) return json({ total: null, countUnavailable: true, ...countHonesty });
    return json({ total: count ?? 0, ...countHonesty });
  }
  const newestFirst = body.sort === "newest";
  const scoreRanked = !newestFirst && body.sort !== "salary" && !countOnly;
  const headTermRing = (() => {
    const toks = qText.trim().split(/\s+/).filter(Boolean);
    return toks.length >= 1 && toks.length <= 2 && qText.trim().length >= 3;
  })();
  const deepPageable = scoreRanked
    && routedRetriever !== "company" && routedRetriever !== "simple"
    && routeDecision.route !== "SYMBOL";
  const ringMerged = scoreRanked && headTermRing && deepPageable;
  const pagePlan = planRankedPage({ offset, fetchLimit, scoreRanked, newestFirst, deepPageable, ringMerged });
  const deepPage = pagePlan.deepPage;
  const metaV = (meta?.v ?? {}) as Record<string, unknown>;
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
        total: null,
        countUnavailable: true,
        hasMore: salJobs.length >= limit,
        nextOffset: offset + salGrouped.rawConsumed,
        searchRoute: "SALARY",
        searchRouteReason: "salary-sorted text search, ordered on the indexed pay column",
        salaryStatedOnly: true,
        ...exclusionCountsCaveat(excludedTerms),
        totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
        companies: [],
        companiesCount: ((metaV.companiesCount as number | undefined) ?? ((metaV.companiesFacet as unknown[]) ?? []).length),
        categories: {},
        failedSources: [], failedCount: 0,
        refreshedAt: (metaV.refreshedAt as string) ?? null,
      });
    }
  } catch {  }
  if (!countOnly && (routedRetriever === "company" || routedRetriever === "simple")) try {
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
      Math.min(ROUTED_DEADLINE_MS, budgetLeft()),
    ) as { data: unknown[] | null; error?: unknown };
    markFrom("routed_retriever", t_routed_retriever);
    if (routedRows === null) {
      console.warn(`[JOB-BOARD] routed retrieval (${routeDecision.route}) hit its deadline for q=${JSON.stringify(qText)}`);
    }
    if (!rErr && Array.isArray(routedRows) && routedRows.length > 0) {
      const mapped = (routedRows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
      const orderReadings = [qText, ...routedExpand.expansions];
      const ordered = routedRetriever === "company" ? mapped : rerankWindow(mapped, orderReadings);
      const inBlock = offset - blockStart;
      const page = ordered.slice(inBlock, inBlock + limit);
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
          total: knownTotal,
          ...(blockFull ? { countUnavailable: true, totalAtLeast: blockStart + ordered.length } : {}),
          hasMore: blockFull || inBlock + limit < ordered.length,
          nextOffset: blockFull
            ? Math.min(offset + limit, blockStart + ROUTE_WINDOW)
            : Math.min(offset + limit, blockStart + ordered.length),
          searchRoute: routeDecision.route,
          searchRouteReason: routeDecision.reason,
          ...(routedRetriever === "company" ? {} : { ranked: true }),
          ...(routedExpand.expansions.length ? { aliases: routedExpand.expansions } : {}),
          ...(routeDecision.matchedName ? { companyMatched: routeDecision.matchedName } : {}),
          ...exclusionCountsCaveat(excludedTerms),
          ...exclusionCeiling(excludedTerms, knownTotal),
          totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
          companies: [],
          companiesCount: ((metaV.companiesCount as number | undefined) ?? ((metaV.companiesFacet as unknown[]) ?? []).length),
          categories: {},
          failedSources: [], failedCount: 0,
          refreshedAt: (metaV.refreshedAt as string) ?? null,
        });
      }
    }
  } catch {  }
  let rankedFellBack: string | null = null;
  let semanticDegraded: "embed" | "ann_deadline" | "ann_error" | "refilter_deadline" | null = null;
  const FACET_COMPANY_LIMIT = 150;
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
  if (qText && body.sort !== "salary" && !countOnly && !rpcBlindFilters(applied).length) {
    try {
      const { q: expandedQ, expansions } = expandQuery(qText);
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
        p_limit: pagePlan.pLimit,
        p_offset: pagePlan.pOffset,
      });
      markFrom("search_jobs", t_search_jobs_3);
      if (rankErr) {
        rankedFellBack = (rankErr.code ? `${rankErr.code}: ` : "") +
          String(rankErr.message ?? rankErr).slice(0, 160);
        console.error(`[JOB-BOARD] ranked search failed for q=${JSON.stringify(qText)}: ${rankedFellBack}`);
      }
      if (!rankErr && Array.isArray(ranked)) {
        const trR = Number((ranked[0] as { total_rows?: number } | undefined)?.total_rows);
        const total = ranked.length ? (Number.isFinite(trR) ? trR : ranked.length) : (offset > 0 ? null : 0);
        const rrR = Number((ranked[0] as { related_rows?: number | null } | undefined)?.related_rows);
        const related = ranked.length && Number.isFinite(rrR) ? rrR : null;
        const pageTotal = total === null ? null : total + (related ?? 0);
        const rankedTier2 = (ranked as Array<{ snippet?: unknown }>).some((r) => typeof r.snippet === "string");
        const rankedCapped = related === null
          ? (total ?? 0) >= (rankedTier2 ? 3_000 : 10_000)
          : (total ?? 0) >= 10_000;
        const relatedCapped = related !== null && (total ?? 0) + related >= 3_000;
        const v0 = (meta?.v ?? {}) as Record<string, unknown>;
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
        const semanticRows = async (
          want: number,
          embedBudgetMs: number,
          exclude?: { ids: Set<string>; keys: Set<string> },
        ): Promise<Array<Record<string, unknown>>> => {
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
            if (semFiltered === null) {
              semanticDegraded = "refilter_deadline";
              console.warn(`[JOB-BOARD] semantic re-filter exceeded its deadline for q=${JSON.stringify(qText)}`);
            }
            semSource = Array.isArray(semFiltered)
              ? (semFiltered as Array<Record<string, unknown>>)
                .sort((a, b) => (semRank.get(String(a.id)) ?? 0) - (semRank.get(String(b.id)) ?? 0))
              : [];
          }
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
          ...(applied.employmentType ? { p_employment_type: applied.employmentType } : {}),
          ...rescueVendorsParam(applied),
        } : {};
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
                  Math.min(3_500, budgetLeft()),
                ) as Promise<{ data: unknown[] | null }>)
                  .catch(() => ({ data: null }))
              ));
              markFrom("location_split", t_location_split);
              let won: { rows: Array<Record<string, unknown>>; head: string; place: string; hits: number } | null = null;
              for (let i = 0; i < splits.length && !won; i++) {
                const rows = probes[i]?.data;
                if (!Array.isArray(rows) || rows.length === 0) continue;
                const hits = Number((rows[0] as { total_rows?: number } | undefined)?.total_rows);
                if (!Number.isFinite(hits) || hits < Math.max(2 * total, 15)) continue;
                won = {
                  rows: (rows as unknown[]).map(rowToJob) as Array<Record<string, unknown>>,
                  head: splits[i].head,
                  place: splits[i].place,
                  hits,
                };
              }
              if (won) {
                const splitJobs = excludedTerms.length
                  ? won.rows.filter((r) => !titleExcluded(String(r.title ?? ""), excludedTerms))
                  : won.rows;
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
                    locationSplit: { q: won.head, location: won.place },
                    total: won.hits,
                    ...(won.hits >= 10_000 ? { countCapped: true } : {}),
                    hasMore: false,
                    nextOffset: offset + splitGrouped.rawConsumed,
                    ...exclusionCountsCaveat(excludedTerms),
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
          } catch {  }
        }
        if (ranked.length === 0 && offset === 0 && !countOnly) {
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
          let simpleTierProvedEmpty = false;
          let fuzzyTierProvedEmpty = false;
          if (qText.length >= 2) try {
            const t_simple_config = Date.now();
            const { data: simpleRows, error: sErr2 } = await withDeadline(
              Promise.allSettled([
                buildQuery("effective_posted", false, undefined, { skipTerms: true })
                  .textSearch("title", ftsQuery(qText), { type: "websearch", config: "simple" })
                  .order("effective_posted", { ascending: false, nullsFirst: false })
                  .order("id", { ascending: true })
                  .range(0, Math.max(limit * 2 - 1, 0)),
                buildQuery("effective_posted", false, undefined, { skipTerms: true })
                  .textSearch("company", ftsQuery(qText), { type: "websearch", config: "simple" })
                  .order("effective_posted", { ascending: false })
                  .order("id", { ascending: true })
                  .range(0, Math.max(limit * 2 - 1, 0)),
              ]).then((settled) => {
                const halves = settled.map((r) =>
                  r.status === "fulfilled" ? r.value as { data?: unknown[] | null; error?: unknown } : null);
                simpleTierProvedEmpty = halves.every((h) =>
                  h && !h.error && Array.isArray(h.data) && h.data.length === 0);
                return {
                  data: halves.flatMap((h) => (h?.data ?? []) as unknown[]),
                  error: null,
                };
              }),
              Math.min(7_000, budgetLeft()),
            ) as { data: unknown[] | null; error?: unknown };
            markFrom("simple_config", t_simple_config);
            if (simpleRows === null) {
              console.warn(`[JOB-BOARD] exact-word tier exceeded its deadline for q=${JSON.stringify(qText)}`);
            }
            if (!sErr2 && Array.isArray(simpleRows) && simpleRows.length > 0) {
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
                total: null,
                countUnavailable: true,
                hasMore: false,
                nextOffset: offset + simpleGrouped.jobs.length,
                exactWordMatch: qText,
                ...exclusionCountsCaveat(excludedTerms),
                totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                companies: [],
                companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
                categories: {},
                failedSources: [], failedCount: 0,
                refreshedAt: (v0.refreshedAt as string) ?? null,
              });
            }
          } catch {  }
          if (qText.length >= 3) try {
            const t_fuzzy_title_search_2 = Date.now();
            const { data: fuzzy, error: fErr } = await withDeadline(
              client.rpc("fuzzy_title_search", {
                p_q: qText, p_fresh_cutoff: freshCutoffIso, p_limit: limit,
                ...rescueFilterParams(),
              }),
              Math.min(4_000, budgetLeft()),
            ) as { data: unknown[] | null; error?: unknown };
            markFrom("fuzzy_title_search", t_fuzzy_title_search_2);
            if (!fErr && Array.isArray(fuzzy)) fuzzyTierProvedEmpty = fuzzy.length === 0;
            if (!fErr && Array.isArray(fuzzy) && fuzzy.length > 0) {
              const fuzzyRows = (fuzzy as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              const fuzzyGrouped = groupSimilar
                ? collapseClusters(fuzzyRows, limit)
                : { jobs: fuzzyRows.slice(0, limit), rawConsumed: Math.min(fuzzyRows.length, limit) };
              logMiss("fuzzy");
              const FUZZY_RPC_CAP = 60;
              const fzCap = Math.min(limit, FUZZY_RPC_CAP);
              const fzTotal = Number((fuzzy[0] as { total_rows?: number }).total_rows);
              const fzKnown = Number.isFinite(fzTotal) && fzTotal > 0 && fzTotal < fzCap;
              logSearch("fuzzy", fuzzyGrouped.jobs.length, fzKnown ? fzTotal : null, "fuzzy");
              return json({
                jobs: preferMatchedLocation(await attachRecheckedAt(client, fuzzyGrouped.jobs, excludedTerms), locationTerms(body.location).terms),
                searchId,
                ...searchDisclosures(body, applied, maxAgeClamped),
                ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
                ...coverageDisclosure(applied, meta),
                ...honesty(fuzzyGrouped.jobs),
                hasMore: false,
                nextOffset: offset + fuzzyGrouped.jobs.length,
                total: fzKnown ? fzTotal : null,
                ...(fzKnown ? {} : {
                  countUnavailable: true,
                  totalAtLeast: Number.isFinite(fzTotal) && fzTotal >= fzCap ? fzTotal : fuzzyGrouped.jobs.length,
                }),
                ...exclusionCountsCaveat(excludedTerms),
                totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                companies: [],
                companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
          categories: visibleCategories(v0.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
                failedSources: (v0.failedSources as string[]) ?? [],
          failedCount: (v0.failedCount as number | undefined) ?? 0,
                refreshedAt: (v0.refreshedAt as string) ?? null,
                fuzzy: qText,
              });
            }
          } catch {  }
          const qTokenCount = qText.trim().split(/\s+/).filter(Boolean).length;
          if (qText.length >= 3 && !(simpleTierProvedEmpty && fuzzyTierProvedEmpty && qTokenCount <= 1)) {
            try {
              const semSource = await semanticRows(fetchLimit, 2_500);
                if (semSource.length > 0) {
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
                    nextOffset: offset + semGrouped.jobs.length,
                    ...exclusionCountsCaveat(excludedTerms),
                    totalAllCompanies: safeMetaTotal ?? 0,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
                    companies: [],
                    companiesCount: ((v0.companiesCount as number | undefined) ?? ((v0.companiesFacet as unknown[]) ?? []).length),
          categories: visibleCategories(v0.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
                    failedSources: (v0.failedSources as string[]) ?? [],
          failedCount: (v0.failedCount as number | undefined) ?? 0,
                    refreshedAt: (v0.refreshedAt as string) ?? null,
                    semantic: qText,
                  });
                }
            } catch {  }
          }
          logMiss(semanticDegraded ? "degraded" : "none");
        }
        const includeFacets0 = (body as { includeFacets?: boolean }).includeFacets !== false;
        const fullCompanies0 = (v0.companiesFacet as Array<{ count?: number }>) ?? [];
        const rankedRows = (ranked as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
        if (newestFirst) {
          rankedRows.sort((a, b) => {
            const da = Date.parse(String(a.postedAt ?? "")) || 0;
            const db = Date.parse(String(b.postedAt ?? "")) || 0;
            return db - da;
          });
        }
        let headRows: Array<Record<string, unknown>> = [];
        let ringResolved = headRingP === null; 
        if (headRingP) {
          try {
            const { data: hr } = await headRingP;
            markFrom("head_ring", t_head_ring_started);
            if (Array.isArray(hr)) {
              headRows = (hr as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              ringResolved = true;
            } else {
              console.warn(`[JOB-BOARD] head-term ring missed its deadline for q=${JSON.stringify(qText)}`);
            }
          } catch {  }
        }
        const mergedSeen = new Set<string>();
        let mergedRows: Array<Record<string, unknown>>;
        let deepRingRawUsed: ((consumedSurvivors: number) => number) | null = null;
        if (deepPage && ringMerged) {
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
        const rankedScored = pagePlan.rerank ? rerankWindow(mergedRows, [qText, ...expansions]) : mergedRows;
        const rankedWindow = rankedScored.slice(pagePlan.sliceStart, pagePlan.sliceEnd);
        const rankedSequence = rankedWindow;
        let rankedGrouped = groupSimilar
          ? collapseClusters(rankedWindow, limit)
          : { jobs: rankedWindow.slice(0, limit), rawConsumed: Math.min(rankedWindow.length, limit) };
        if (deepRingRawUsed) {
          rankedGrouped = { ...rankedGrouped, rawConsumed: deepRingRawUsed(rankedGrouped.rawConsumed) };
        }
        const poolExhausted = ringMerged && !deepPage && (
          ringResolved
            ? offset + rankedGrouped.rawConsumed >= rankedScored.length
            : offset + rankedGrouped.rawConsumed >= RANKED_WINDOW
        );
        if (deepPage && scoreRanked && rankedGrouped.jobs.length > 1) {
          rankedGrouped = { ...rankedGrouped, jobs: rerankWindow(rankedGrouped.jobs, [qText, ...expansions]) };
        }
        const FUZZY_AUGMENT_BELOW = 20;
        let fuzzyTitlesForDym: string[] | null = null;
        let fuzzyExtraOut: { q: string; count: number } | null = null;
        let semanticExtraOut: { q: string; count: number } | null = null;
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
            if (!fzErr && Array.isArray(fz)) fuzzyTitlesForDym = (fz as Array<{ title?: unknown }>).map((r) => String(r.title ?? ""));
            if (!fzErr && Array.isArray(fz) && fz.length > 0) {
              const haveKeys = new Set(rankedGrouped.jobs.map((j) => {
                const r = j as Record<string, unknown>;
                return clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""));
              }));
              const fuzzyRows = (fz as unknown[]).map(rowToJob) as Array<Record<string, unknown>>;
              const room = Math.max(0, limit - rankedGrouped.jobs.length);
              const novel = fuzzyRows.filter((r) =>
                !haveKeys.has(clusterKey(String(r.company ?? r.token ?? ""), String(r.title ?? ""))) &&
                !(excludedTerms.length && titleExcluded(String(r.title ?? ""), excludedTerms)));
              const extra = (groupSimilar ? collapseClusters(novel, room).jobs : novel.slice(0, room))
                .map((j) => ({ ...(j as Record<string, unknown>), closeMatch: true }));
              if (extra.length > 0) {
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
          } catch {  }
        }
        if (
          semanticExtraOut === null &&
          pageTotal !== null && pageTotal > 0 && pageTotal < FUZZY_AUGMENT_BELOW &&
          offset === 0 && !countOnly && !newestFirst && qText.length >= 3 &&
          rankedGrouped.jobs.length < limit && budgetLeft() > 3_000
        ) {
          try {
            const room = Math.max(0, limit - rankedGrouped.jobs.length);
            const haveIds = new Set(rankedGrouped.jobs.map((j) => String((j as Record<string, unknown>).id ?? "")));
            const haveKeys2 = new Set(rankedGrouped.jobs.map((j) =>
              clusterKey(String((j as Record<string, unknown>).company ?? ""), String((j as Record<string, unknown>).title ?? ""))));
            const semSource = await semanticRows(Math.min(room * 3, 60), 1_500, { ids: haveIds, keys: haveKeys2 });
            if (semSource.length > 0) {
              const novelSem = ((semSource as unknown[]).map(rowToJob) as Array<Record<string, unknown>>)
                .filter((r) => !(excludedTerms.length && titleExcluded(String(r.title ?? ""), excludedTerms)));
              const semExtra = (groupSimilar ? collapseClusters(novelSem, room).jobs : novelSem.slice(0, room))
                .map((j) => ({ ...(j as Record<string, unknown>), semanticMatch: true }));
              if (semExtra.length > 0) {
                rankedGrouped = { ...rankedGrouped, jobs: [...rankedGrouped.jobs, ...semExtra] };
                semanticExtraOut = { q: qText, count: semExtra.length };
              }
            }
          } catch {  }
        }
        const augmented = fuzzyExtraOut !== null || semanticExtraOut !== null;
        logSearch("ranked", rankedGrouped.jobs.length, augmented ? null : total);
        const shownRowCount = rankedGrouped.jobs.length;
        const totalUnderstated = !augmented && typeof total === "number" && (offset + shownRowCount) > total;
        let earnedDym: string | null = null;
        if (
          fuzzyTitlesForDym && fuzzyTitlesForDym.length >= 5 && !newestFirst &&
          !DID_YOU_MEAN[String(body.q ?? "").trim().toLowerCase()]
        ) {
          try {
            const titles = fuzzyTitlesForDym.map((t) => t.toLowerCase());
            const titleWords = titles.map((t) => new Set(t.split(/[^\p{L}]+/u).filter((w) => w.length >= 4)));
            const allWords = new Set(titleWords.flatMap((ws) => [...ws]));
            const tokens = qText.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
            for (const tok of tokens) {
              const tokSupport = titleWords.filter((ws) => ws.has(tok)).length;
              for (const w of allWords) {
                if (w === tok || !within2Edits(tok, w)) continue;
                const support = titleWords.filter((ws) => ws.has(w)).length;
                if (support >= 3 && support >= tokSupport * 3) {
                  earnedDym = qText.toLowerCase().replace(new RegExp(`(?<=^|[^\\p{L}])${tok}(?=$|[^\\p{L}])`, "u"), w);
                  break;
                }
              }
              if (earnedDym) break;
            }
          } catch {  }
        }
        return json({
          jobs: preferMatchedLocation(await attachRecheckedAt(client, rankedGrouped.jobs, excludedTerms), locationTerms(body.location).terms),
          searchId,
          ...searchDisclosures(body, applied, maxAgeClamped),
          ...(earnedDym ? { didYouMean: earnedDym } : {}),
          ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
          ...coverageDisclosure(applied, meta),
          ...honesty(rankedGrouped.jobs),
          ...(augmented ? { countUnavailable: true } : {}),
          nextOffset: poolExhausted ? RING_WINDOW : offset + rankedGrouped.rawConsumed,
          hasMore: deepPage
            ? (rankedSequence.length > rankedGrouped.rawConsumed || rankedRows.length >= fetchLimit)
            : ringMerged
            ? (rankedSequence.length > rankedGrouped.rawConsumed
              || (pageTotal !== null && pageTotal > RANKED_WINDOW))
            : (newestFirst || scoreRanked)
            ? (rankedSequence.length > rankedGrouped.rawConsumed
              || (deepPageable && pageTotal !== null && offset + rankedGrouped.rawConsumed < pageTotal))
            : (rankedSequence.length > rankedGrouped.rawConsumed || rankedSequence.length >= fetchLimit),
          total: augmented || totalUnderstated ? null : total,
          ...(totalUnderstated ? { countUnavailable: true, totalAtLeast: offset + shownRowCount } : {}),
          ...(augmented || totalUnderstated || related === null || related === 0
            ? {}
            : { relatedTotal: related, ...(relatedCapped ? { relatedCapped: true } : {}) }),
          ...(rankedCapped ? { countCapped: true } : {}),
          ...exclusionCountsCaveat(excludedTerms),
          ...(augmented || totalUnderstated ? {} : exclusionCeiling(excludedTerms, total)),
          totalAllCompanies: safeMetaTotal ?? total,
          ...(trackedTotal !== null ? { trackedTotal } : {}),
          companies: includeFacets0
            ? facetHead(fullCompanies0 as Array<{ token?: string; name?: string; count?: number }>)
                .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
            : [],
          companiesCount: ((v0.companiesCount as number | undefined) ?? fullCompanies0.length),
          categories: visibleCategories(v0.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
          failedSources: (v0.failedSources as string[]) ?? [],
          failedCount: (v0.failedCount as number | undefined) ?? 0,
          refreshedAt: (v0.refreshedAt as string) ?? null,
          ranked: true,
          ...(semanticDegraded ? { semanticDegraded } : {}),
          ...(expansions.length ? { aliases: expansions } : {}),
          ...(fuzzyExtraOut ? { fuzzyExtra: fuzzyExtraOut } : {}),
          ...(semanticExtraOut ? { semanticExtra: semanticExtraOut } : {}),
        });
      }
    } catch (e) {
      console.error(`[JOB-BOARD] ranked path failed, serving recency instead: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
      rankedFellBack = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 160) : String(e).slice(0, 160);
    }
  }
  const sortSalary = body.sort === "salary";
  const twoSubset = !!applied.category && applied.includeUncategorised;
  const twoSubsetLimit = Math.min(fetchLimit, limit);
  const fetchUsed = twoSubset ? twoSubsetLimit : fetchLimit;
  const ordered = (q: any, dateCol: string, salaryCol: string) =>
    (sortSalary
      ? q.order(salaryCol, { ascending: false, nullsFirst: false })
      : newestFirst
        ? q.order("posted_at", { ascending: false, nullsFirst: false })
        : q.order(dateCol, { ascending: false, nullsFirst: false })
    ).order("id", { ascending: true });
  const pageWith = async (dateCol: string, salaryCol: string, withCount: boolean) => {
    const t0 = Date.now();
    try { return await pageWithInner(dateCol, salaryCol, withCount); }
    finally { markFrom("page_query", t0); }
  };
  const pageWithInner = async (dateCol: string, salaryCol: string, withCount: boolean) => {
    if (!twoSubset) {
      if (cursor && !sortSalary && !newestFirst) {
        return await ordered(buildQuery(dateCol, withCount), dateCol, salaryCol)
          .or(`${dateCol}.lt."${cursor.ep}",and(${dateCol}.eq."${cursor.ep}",id.gt."${cursor.id}")`)
          .limit(fetchLimit);
      }
      return await ordered(buildQuery(dateCol, withCount), dateCol, salaryCol)
        .range(offset, offset + fetchLimit - 1);
    }
    const aCount = await buildQuery(dateCol, true, applied.category!).range(0, 0);
    if (aCount.error) return aCount;
    const countA = aCount.count ?? 0;
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
    let count: number | null = null;
    if (withCount) {
      const bCount = await buildQuery(dateCol, true, "other").range(0, 0);
      count = bCount.error ? null : countA + (bCount.count ?? 0);
    }
    return { data: [...(ra.data ?? []), ...(rb.data ?? [])], error: null, count };
  };
  const COUNT_DEADLINE_MS = 1_500;
  let countTimedOut = false;
  const t_count_raced = Date.now();
  const racedCount: Promise<{ n: number; capped?: boolean } | null> = wantCount
    ? Promise.race([
      (cappedCount() as unknown as PromiseLike<{ n: number; capped?: boolean } | null>)
        .then((r) => ({ kind: "settled" as const, r })),
      new Promise<{ kind: "timeout" }>((res) => setTimeout(() => res({ kind: "timeout" }), COUNT_DEADLINE_MS)),
    ]).then((outcome) => {
      const r = outcome.kind === "settled" ? outcome.r : null;
      if (outcome.kind === "timeout") countTimedOut = true;
      markFrom("count_jobs_capped", t_count_raced);
      return r && typeof (r as { n?: number }).n === "number" ? r as { n: number; capped?: boolean } : null;
    })
    : Promise.resolve(null);
  const [firstPage, cappedRes] = await Promise.all([
    pageWith("effective_posted", "salary_rank_usd", false),
    racedCount,
  ]);
  const needInlineCount = wantCount && !cappedRes && !countTimedOut;
  if (countTimedOut) {
    console.warn(`[JOB-BOARD] capped count exceeded ${COUNT_DEADLINE_MS}ms — serving the page without a total`);
  }
  const page = (dateCol: string, salaryCol: string) => pageWith(dateCol, salaryCol, needInlineCount);
  let { data, error, count } = needInlineCount
    ? await page("effective_posted", "salary_rank_usd")
    : { data: firstPage.data, error: firstPage.error, count: cappedRes?.n ?? null };
  if (sortSalary && error?.message?.includes("salary_rank_usd")) {
    ({ data, error, count } = await page("effective_posted", "salary_min_annual"));
  }
  if (missingColumn(error)) ({ data, error, count } = await page("posted_at", "salary_min_annual"));
  let countUnavailable = countTimedOut || (wantCount && count === null);
  if (error && wantCount) {
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
  const missQ = String(body.q ?? "").slice(0, 120).trim();
  const missLoc = String(body.location ?? "").slice(0, 120).trim();
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
  const v = (meta?.v ?? {}) as Record<string, unknown>;
  const includeFacets = (body as { includeFacets?: boolean }).includeFacets !== false;
  const fullCompanies = (v.companiesFacet as Array<{ count?: number }>) ?? [];
  const servedCompanies = includeFacets
    ? facetHead(fullCompanies as Array<{ token?: string; name?: string; count?: number }>)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    : [];
  const mappedRows = (data ?? []).map(rowToJob) as Array<Record<string, unknown>>;
  let rawSequence = mappedRows;
  let rawKeys = (data ?? []) as Array<{ effective_posted?: string; id?: string }>;
  let grouped = groupSimilar
    ? collapseClusters(mappedRows, limit)
    : { jobs: mappedRows.slice(0, limit), rawConsumed: Math.min(mappedRows.length, limit) };
  if (
    groupSimilar && !twoSubset && !sortSalary && !countOnly &&
    grouped.jobs.length < limit &&
    !newestFirst &&                          
    mappedRows.length >= fetchLimit          
  ) {
    const lastRaw = rawKeys[rawKeys.length - 1];
    if (lastRaw?.effective_posted && lastRaw?.id) {
      try {
        const t_topup = Date.now();
        const topUp = await withDeadline(
          ordered(
            buildQuery("effective_posted", false).or(
              `effective_posted.lt."${lastRaw.effective_posted}",and(effective_posted.eq."${lastRaw.effective_posted}",id.gt."${lastRaw.id}")`,
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
          rawKeys = [...rawKeys, ...((topUp.data ?? []) as typeof rawKeys)];
          const merged = collapseClusters(rawSequence, limit);
          grouped = merged;
        }
      } catch {  }
    }
  }
  if (!sortSalary) grouped.jobs = interleaveByCompany(grouped.jobs);
  logSearch("recency", grouped.jobs.length, countUnavailable ? null : (wantCount ? (count ?? 0) : safeMetaTotal));
  return json({
    jobs: preferMatchedLocation(await attachRecheckedAt(client, grouped.jobs, excludedTerms), locationTerms(body.location).terms),
    searchId,
    ...honesty(grouped.jobs),
    nextOffset: offset + grouped.rawConsumed,
    ...searchDisclosures(body, applied, maxAgeClamped),
    ...intentDisclosure(intentLift),
          ...exclusionDisclosure(excludedTerms),
    ...coverageDisclosure(applied, meta),
    ...(rankedFellBack ? { rankedFellBack } : {}),
    ...(semanticDegraded ? { semanticDegraded } : {}),
    nextCursor: (() => {
      if (twoSubset || sortSalary || newestFirst) return null;
      const r = rawKeys[Math.max(0, grouped.rawConsumed - 1)];
      return r?.effective_posted && r?.id ? { ep: r.effective_posted, id: r.id } : null;
    })(),
    total: countUnavailable ? null : (wantCount ? (count ?? 0) : safeMetaTotal),
    ...(countUnavailable || (!wantCount && safeMetaTotal === null) ? { countUnavailable: true } : {}),
    ...(cappedRes?.capped ? { countCapped: true } : {}),
    hasMore: (data ?? []).length > grouped.rawConsumed || (data ?? []).length === fetchUsed,
    ...exclusionCountsCaveat(excludedTerms),
    totalAllCompanies: safeMetaTotal ?? count ?? 0,
    ...(trackedTotal !== null ? { trackedTotal } : {}),
    companies: servedCompanies,
    companiesCount: ((v.companiesCount as number | undefined) ?? fullCompanies.length),
    categories: visibleCategories(v.categoriesFacet as Record<string, number> | undefined, unfiltered, applied.category),
    failedSources: (v.failedSources as string[]) ?? [],
    failedCount: (v.failedCount as number | undefined) ?? 0,
    refreshedAt: (v.refreshedAt as string) ?? null,
  });
}