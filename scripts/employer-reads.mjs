// WHAT THE EMPLOYER'S OWN SYSTEM SAYS ABOUT ONE POSTING, READ WITH GET ONLY
// (SEO/GEO audit 2026-11-07: B01, G4J-01, SD-01, F01; B06, SD-04, F05, SD-05).
//
// The bake's carry re-check asked the board's detail action, which reads our
// stored row and never the employer, so a posting the employer had taken down
// kept a live page with JobPosting markup until our crawler noticed. Measured
// 2026-11-07: about 7% of the 500 baked posting pages were already closed at
// the employer (7 of 110 sampled), over the owner's 5% stop line. And on
// 2026-11-08 the day's bake still baked three Workday postings live whose
// employer answered 403 S22 (Sanford R-0278723, Fresenius R0270716, JCI
// WD30282057).
//
// So the bake and the daily check (scripts/posting-closure-check.mjs) ask the
// employer's own endpoint, one GET per posting (one per board for Ashby), and
// read the answer as one of three states:
//   open     the employer's system serves the posting;
//   closed   the employer's system says it does not, in a way that cannot be a
//            wrong address of ours (Workday's 403 S22, a 404 or 410 from an API
//            keyed by the posting's own id, an Ashby id missing from its whole
//            board, Paylocity's own "JobNotFound" page);
//   unknown  anything else: a network error, a timeout, a refusal, a 5xx, a
//            vendor this module does not read, a Workday 404 (our applyUrl's
//            slug is sometimes wrong, so a 404 there proves nothing).
// Only "closed" retires a page. Unknown keeps the page exactly as it was, and is
// counted, so a build network that blocks vendor GETs shows up as a large
// unknown share in the bake log and the ledger, never as retired pages.
//
// THE SAME READ CARRIES WHAT THE EMPLOYER STATES (B06): Workday's endDate,
// startDate (its own posting date), timeType and remoteType, Greenhouse's application deadline, Lever's
// commitment and workplaceType, SmartRecruiters' typeOfEmployment and remote
// flag, Ashby's employmentType and remote fields, Paylocity's own JobPosting
// (its original datePosted, its structured address, TELECOMMUTE) and UKG's
// PostedDate. Each is returned as `stated`, and applyEmployerStatements
// (scripts/employer-statements.mjs, which the posting page runs too) puts it
// into the PostingRow fields the page already has.
//
// Plain JavaScript whose one import is that plain module, so plain node runs
// it in the bake, in the daily workflow and under vitest alike. Every request
// is a GET.

import { applyEmployerStatements } from "./employer-statements.mjs";

export { applyEmployerStatements };

/** One request's ceiling. */
export const EMPLOYER_READ_TIMEOUT_MS = 10_000;
/** Requests in flight at once: gentle on every vendor. */
export const EMPLOYER_READ_CONCURRENCY = 4;
/** The whole read's ceiling inside a publish build: rows not reached by then are unknown, and the build goes on. */
export const EMPLOYER_READ_BUDGET_MS = 150_000;
/** Who is asking, said plainly to every vendor. */
export const EMPLOYER_READ_USER_AGENT = "Mozilla/5.0 (compatible; resumebooster-posting-check/1.0; +https://resumebooster.work/jobs)";

/** The vendors whose answer can say open or closed. */
export const READ_VENDORS = Object.freeze(["workday", "greenhouse", "lever", "smartrecruiters", "ashby", "icims", "paylocity", "teamtailor", "personio"]);
/** Vendors read only for what the employer states (their answer never says closed). */
export const STATED_ONLY_VENDORS = Object.freeze(["ukg"]);

/** The three parts of a board id ("workday:tenant~wd5~Site:R123"), or null. */
export function idParts(id) {
  const parts = String(id ?? "").split(":");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [source, token, key] = parts;
  return { source, token, key };
}

/** The board id a posting page path names ("/jobs/posting/<source>/<token>/<key>"), or null. */
export function idFromPostingPath(path) {
  const parts = String(path ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 5 || parts[0] !== "jobs" || parts[1] !== "posting") return null;
  const id = `${parts[2]}:${parts[3]}:${parts[4]}`;
  return idParts(id) ? id : null;
}

const httpsUrl = (s) => {
  try {
    const u = new URL(String(s ?? ""));
    return u.protocol === "https:" ? u : null;
  } catch { return null; }
};
const SLUG = /^[A-Za-z0-9._-]+$/;

/**
 * THE ONE GET THAT ANSWERS FOR A ROW, or a reason there is none. `kind` says
 * how the answer is read: "workday" (CXS detail JSON), "api" (a JSON endpoint
 * keyed by the posting's own id), "board" (a whole board's JSON list, one read
 * per board), "page" (the employer's page and its own JobPosting markup) or
 * "ukg" (the opportunity detail page, read for its stated date only).
 */
export function employerReadPlan(row) {
  const p = idParts(row?.id);
  if (!p) return { vendor: "?", url: null, why: "not a board id" };
  const { source, token, key } = p;
  const enc = encodeURIComponent;
  switch (source) {
    case "workday": {
      // tenant~wdN~site, and the posting's external path from its applyUrl:
      // https://<tenant>.<wdN>.myworkdayjobs.com/en-US/<site>/job/<place>/<slug>_<req>
      const [tenant, dc, site] = token.split("~");
      const u = httpsUrl(row.applyUrl);
      if (!tenant || !dc || !site || !u) return { vendor: source, url: null, why: "no Workday address" };
      if (u.hostname.toLowerCase() !== `${tenant}.${dc}.myworkdayjobs.com`.toLowerCase()) return { vendor: source, url: null, why: "applyUrl is not the tenant's Workday host" };
      const at = u.pathname.indexOf("/job/");
      if (at < 0) return { vendor: source, url: null, why: "applyUrl names no job path" };
      return { vendor: source, kind: "workday", url: `https://${u.hostname}/wday/cxs/${tenant}/${site}${u.pathname.slice(at)}`, accept: "application/json" };
    }
    // An "eu~" token is the vendor's EU instance, read where the board reads it
    // (job-board/normalize.ts greenhouseApi and leverApi).
    case "greenhouse": {
      const eu = token.startsWith("eu~");
      const slug = eu ? token.slice(3) : token;
      if (!SLUG.test(slug)) return { vendor: source, url: null, why: "not a Greenhouse board slug" };
      return { vendor: source, kind: "api", url: `https://${eu ? "boards.eu.greenhouse.io" : "boards-api.greenhouse.io"}/v1/boards/${enc(slug)}/jobs/${enc(key)}`, accept: "application/json" };
    }
    case "lever": {
      const eu = token.startsWith("eu~");
      const slug = eu ? token.slice(3) : token;
      if (!SLUG.test(slug)) return { vendor: source, url: null, why: "not a Lever board slug" };
      return { vendor: source, kind: "api", url: `https://${eu ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${enc(slug)}/${enc(key)}`, accept: "application/json" };
    }
    case "smartrecruiters":
      return { vendor: source, kind: "api", url: `https://api.smartrecruiters.com/v1/companies/${enc(token)}/postings/${enc(key)}`, accept: "application/json" };
    case "ashby":
      return { vendor: source, kind: "board", url: `https://api.ashbyhq.com/posting-api/job-board/${enc(token)}`, accept: "application/json" };
    case "paylocity":
      return { vendor: source, kind: "page", url: `https://recruiting.paylocity.com/recruiting/jobs/Details/${enc(key)}`, accept: "text/html" };
    case "icims":
    case "teamtailor":
    case "personio": {
      const u = httpsUrl(row.applyUrl);
      if (!u) return { vendor: source, url: null, why: "no https applyUrl" };
      // AN iCIMS HOST SERVES A FRAME, AND THE FRAME CARRIES THE JOB: the
      // <portal>.icims.com page is a 4-23 KB wrapper with no JobPosting, and
      // the same address with in_iframe=1 is the posting with its own markup
      // (200), or 410 for one the employer closed (measured 2026-11-08: all 17
      // live iCIMS pages read unknown without it).
      if (source === "icims" && /\.icims\.com$/i.test(u.hostname)) u.searchParams.set("in_iframe", "1");
      return { vendor: source, kind: "page", url: u.href, accept: "text/html" };
    }
    case "ukg": {
      const u = httpsUrl(row.applyUrl);
      if (!u || !/\.ultipro\.com$/i.test(u.hostname)) return { vendor: source, url: null, why: "no UKG opportunity address" };
      return { vendor: source, kind: "ukg", url: u.href, accept: "text/html", statedOnly: true };
    }
    default:
      return { vendor: source, url: null, why: "a vendor this reader does not read" };
  }
}

const parseJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

/** Every JSON-LD node in a page whose @type is JobPosting. */
export function jobPostingBlocks(html) {
  const out = [];
  for (const m of String(html ?? "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const j = parseJson(m[1].trim());
    const nodes = Array.isArray(j) ? j : Array.isArray(j?.["@graph"]) ? j["@graph"] : [j];
    for (const n of nodes) {
      const t = n && n["@type"];
      if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) out.push(n);
    }
  }
  return out;
}

/** A day "YYYY-MM-DD" a vendor stated, or null. */
const statedDay = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : null);
/**
 * A date a vendor stated, AS IT WROTE IT (its own offset kept), or null. The
 * page prints the first ten characters: Paylocity's "2026-08-12T22:31:03-05:00"
 * is the 12th where the employer is, and would read as the 13th in UTC.
 */
const statedInstant = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v.trim()) || v.trim().length > 40) return null;
  return Number.isFinite(Date.parse(v.trim())) ? v.trim() : null;
};
const label = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** What a Workday CXS detail states: the end date, the posting date, the time type and a fully remote posting. */
function workdayStated(info) {
  const out = {};
  const end = statedDay(info?.endDate);
  if (end) out.employerValidThrough = end;
  // startDate IS THE DATE WORKDAY'S OWN JobPosting STATES as datePosted (the
  // Allstate R35646 page says 2026-11-06, as its CXS startDate does); the
  // board's list date is "Posted N Days Ago" read off a label, which the
  // board's own description filler already replaces with it where it runs.
  const start = statedDay(info?.startDate);
  if (start) out.postedAt = statedInstant(start);
  const tt = label(info?.timeType);
  if (tt) out.employmentType = tt;
  // TELECOMMUTE STANDS ONLY ON THE VENDOR'S OWN FIELD (SEO-003), and only on
  // its fully remote values: "Hybrid" and "Flexible" are not work from anywhere.
  const rt = label(info?.remoteType);
  if (rt && (/^fully\s+remote$/i.test(rt) || /100\s*%/.test(rt))) out.remote = true;
  return out;
}

/** What an API answer for one posting states, per vendor. */
function apiStated(vendor, j) {
  const out = {};
  if (vendor === "greenhouse") {
    const end = statedDay(j?.application_deadline);
    if (end) out.employerValidThrough = end;
  } else if (vendor === "lever") {
    const c = label(j?.categories?.commitment);
    if (c) out.employmentType = c;
    if (String(j?.workplaceType ?? "").toLowerCase() === "remote") out.remote = true;
  } else if (vendor === "smartrecruiters") {
    const t = label(j?.typeOfEmployment?.label);
    if (t) out.employmentType = t;
    if (j?.location?.remote === true && j?.location?.hybrid !== true) out.remote = true;
  }
  return out;
}

/** What one Ashby board entry states. */
function ashbyStated(job) {
  const out = {};
  const t = label(job?.employmentType);
  if (t) out.employmentType = t;
  const wt = String(job?.workplaceType ?? "").toLowerCase();
  if (wt === "remote" || (job?.isRemote === true && !wt)) out.remote = true;
  return out;
}

/** What an employer's own JobPosting markup states that the board does not carry (Paylocity: B06, SD-03, SD-05). */
function pageStated(vendor, node) {
  const out = {};
  if (vendor !== "paylocity") return out;
  const posted = statedInstant(node?.datePosted);
  if (posted) out.postedAt = posted;
  const a = node?.jobLocation?.address ?? (Array.isArray(node?.jobLocation) ? node.jobLocation[0]?.address : null);
  if (a && typeof a === "object") {
    const address = {};
    for (const k of ["addressLocality", "addressRegion", "postalCode", "addressCountry"]) {
      const v = label(a[k]);
      if (v) address[k] = v;
    }
    if (address.addressLocality) out.address = address;
  }
  if (node?.jobLocationType === "TELECOMMUTE") out.remote = true;
  return out;
}

/**
 * THE VERDICT ON ONE ANSWER. `res` is { status, url, body } (url: the final
 * address after redirects), or { error } when the request never answered.
 * Returns { state, why, stated }.
 */
export function employerVerdict(plan, res, row) {
  const unknown = (why) => ({ state: "unknown", why, stated: {} });
  if (!plan?.url) return unknown(plan?.why ?? "nothing to read");
  if (!res || res.error) return unknown(`no answer (${res?.error ?? "network"})`);
  const { status } = res;
  const body = String(res.body ?? "");
  const key = idParts(row?.id)?.key ?? "";
  switch (plan.kind) {
    case "workday": {
      if (status === 200) {
        const j = parseJson(body);
        return j && j.jobPostingInfo ? { state: "open", why: "200", stated: workdayStated(j.jobPostingInfo) } : unknown("200 without jobPostingInfo");
      }
      // S22 IS WORKDAY'S "TAKEN DOWN": on the same tenant an open posting
      // answers 200 and an invented path 404 S21 (measured 2026-11-07 and 08).
      if (status === 403 && parseJson(body)?.errorCode === "S22") return { state: "closed", why: "403 S22", stated: {} };
      return unknown(status === 404 ? "404 (the applyUrl slug may be wrong)" : `HTTP ${status}`);
    }
    case "api": {
      if (status === 200) {
        const j = parseJson(body);
        return j && typeof j === "object" ? { state: "open", why: "200", stated: apiStated(plan.vendor, j) } : unknown("200 that is not JSON");
      }
      if (status === 404) return { state: "closed", why: "404", stated: {} };
      return unknown(`HTTP ${status}`);
    }
    case "board": {
      if (status !== 200) return unknown(`board HTTP ${status}`);
      const j = parseJson(body);
      const jobs = Array.isArray(j?.jobs) ? j.jobs : null;
      // An empty or unreadable board says nothing about one posting: a board
      // that answered with no jobs at all is far likelier a hiccup than every
      // one of its postings closing at once.
      if (!jobs || jobs.length === 0) return unknown("board listed nothing");
      const job = jobs.find((x) => String(x?.id ?? "") === key);
      return job ? { state: "open", why: "listed", stated: ashbyStated(job) } : { state: "closed", why: "missing from the board", stated: {} };
    }
    case "page": {
      if (status === 404 || status === 410) return { state: "closed", why: String(status), stated: {} };
      if (plan.vendor === "paylocity" && /\/jobs\/JobNotFound\b/i.test(String(res.url ?? ""))) return { state: "closed", why: "JobNotFound", stated: {} };
      if (status !== 200) return unknown(`HTTP ${status}`);
      const blocks = jobPostingBlocks(body);
      return blocks.length ? { state: "open", why: "200 with its JobPosting", stated: pageStated(plan.vendor, blocks[0]) } : unknown("200 without a JobPosting");
    }
    case "ukg": {
      // READ FOR ITS DATE ONLY: what a closed opportunity's page serves was not
      // measured, so no UKG answer ever says open or closed.
      const stated = {};
      if (status === 200 && body.includes(`"Id":"${key}"`)) {
        const m = /"PostedDate":"([^"]+)"/.exec(body);
        const posted = m ? statedInstant(m[1]) : null;
        if (posted) stated.postedAt = posted;
      }
      return { state: "unknown", why: "UKG is read for its stated date only", stated };
    }
    default:
      return unknown("a vendor this reader does not read");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One GET with a timeout, and one retry on 429 or a 5xx. Never throws. */
export async function employerGet(url, { fetchImpl = globalThis.fetch, timeoutMs = EMPLOYER_READ_TIMEOUT_MS, accept = "*/*", retryDelayMs = 1500 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": EMPLOYER_READ_USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const status = r.status;
      if ((status === 429 || status >= 500) && attempt === 0) {
        try { await r.text(); } catch { /* drained */ }
        await sleep(retryDelayMs);
        continue;
      }
      let body = "";
      try { body = await r.text(); } catch { body = ""; }
      return { status, url: r.url || url, body };
    } catch (e) {
      return { error: String(e?.name === "TimeoutError" ? "timeout" : e?.message ?? e).slice(0, 80) };
    }
  }
  return { error: "retry exhausted" };
}

/**
 * READ EVERY ROW, BOUNDED. At most `concurrency` GETs in flight, each under
 * `timeoutMs`, and none started once `budgetMs` has passed since the call (or
 * since `deadline`, a shared epoch-ms bound for a bake that reads twice): a
 * row the budget did not reach is unknown ("budget"), so a slow or blocked
 * vendor can never hang a publish build. A board list (Ashby) is read once per
 * board. `stated: false` skips the vendors read only for their statements.
 * Returns a Map of row id to { id, vendor, state, why, stated }.
 */
export async function readEmployers(rows, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    concurrency = EMPLOYER_READ_CONCURRENCY,
    timeoutMs = EMPLOYER_READ_TIMEOUT_MS,
    budgetMs = EMPLOYER_READ_BUDGET_MS,
    deadline = null,
    stated: wantStated = true,
    retryDelayMs = 1500,
    now = () => Date.now(),
  } = opts;
  const until = typeof deadline === "number" ? deadline : now() + budgetMs;
  const out = new Map();
  const boards = new Map();
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === "string") : [];
  let next = 0;
  const one = async (row) => {
    const plan = employerReadPlan(row);
    if (!plan.url || (plan.statedOnly && !wantStated)) {
      out.set(row.id, { id: row.id, vendor: plan.vendor, state: "unknown", why: plan.url ? "not read for state" : plan.why, stated: {} });
      return;
    }
    if (now() >= until) {
      out.set(row.id, { id: row.id, vendor: plan.vendor, state: "unknown", why: "budget", stated: {} });
      return;
    }
    const left = Math.max(1, Math.min(timeoutMs, until - now()));
    let res;
    if (plan.kind === "board") {
      if (!boards.has(plan.url)) boards.set(plan.url, employerGet(plan.url, { fetchImpl, timeoutMs: left, accept: plan.accept, retryDelayMs }));
      res = await boards.get(plan.url);
    } else {
      res = await employerGet(plan.url, { fetchImpl, timeoutMs: left, accept: plan.accept, retryDelayMs });
    }
    const v = employerVerdict(plan, res, row);
    out.set(row.id, { id: row.id, vendor: plan.vendor, ...v });
  };
  const worker = async () => {
    while (next < list.length) {
      const row = list[next++];
      await one(row);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length || 1)) }, worker));
  return out;
}

/**
 * A CLOSED ANSWER THAT IS IMPLAUSIBLE BY ITS NUMBERS IS NOT TRUSTED. The
 * measured closed share is about 7% (2026-11-07). A vendor with at least
 * `minDefinite` definite answers of which more than `maxShare` say closed, or
 * a Workday tenant whose every read (at least three) said closed, is far more
 * likely refusing this network than closing every posting at once, and
 * retiring its pages on that would take down good pages. Those answers become
 * unknown, with the reason, so the log and the ledger show the refusal.
 * Returns a new Map.
 */
export function distrustImplausibleClosures(results, { minDefinite = 8, maxShare = 0.5 } = {}) {
  const out = new Map(results);
  const byVendor = new Map();
  const byTenant = new Map();
  for (const r of out.values()) {
    if (r.state !== "open" && r.state !== "closed") continue;
    const v = byVendor.get(r.vendor) ?? { open: 0, closed: 0 };
    v[r.state]++;
    byVendor.set(r.vendor, v);
    if (r.vendor === "workday") {
      const t = (idParts(r.id)?.token ?? "").split("~")[0].toLowerCase();
      const c = byTenant.get(t) ?? { open: 0, closed: 0 };
      c[r.state]++;
      byTenant.set(t, c);
    }
  }
  for (const [id, r] of out) {
    if (r.state !== "closed") continue;
    const v = byVendor.get(r.vendor);
    const definite = v.open + v.closed;
    if (definite >= minDefinite && v.closed / definite > maxShare) {
      out.set(id, { ...r, state: "unknown", why: `implausible: ${v.closed} of ${definite} ${r.vendor} answers said closed` });
      continue;
    }
    if (r.vendor === "workday") {
      const t = (idParts(id)?.token ?? "").split("~")[0].toLowerCase();
      const c = byTenant.get(t);
      if (c && c.open === 0 && c.closed >= 3) out.set(id, { ...r, state: "unknown", why: `implausible: every one of ${c.closed} reads on this Workday tenant said closed` });
    }
  }
  return out;
}

/** Counts by state, overall and by vendor. */
export function summarizeEmployerReads(results) {
  const s = { checked: 0, open: 0, closed: 0, unknown: 0, byVendor: {} };
  for (const r of results instanceof Map ? results.values() : results ?? []) {
    s.checked++;
    s[r.state] = (s[r.state] ?? 0) + 1;
    const v = (s.byVendor[r.vendor] ??= { open: 0, closed: 0, unknown: 0 });
    v[r.state] = (v[r.state] ?? 0) + 1;
  }
  return s;
}

/** The bake log's one line. */
export function employerReadLine(summary) {
  const vendors = Object.entries(summary.byVendor ?? {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([v, c]) => `${v} ${c.open}/${c.closed}/${c.unknown}`)
    .join(", ");
  return `employer reads: ${summary.open} open, ${summary.closed} closed (retired), ${summary.unknown} unknown of ${summary.checked}${vendors ? `; open/closed/unknown by vendor: ${vendors}` : ""}`;
}

/** Wilson score interval at 95% for k of n, as [low, high]; [0, 1] for n = 0. */
export function wilson95(k, n) {
  if (!n) return [0, 1];
  const z = 1.959963984540054;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
