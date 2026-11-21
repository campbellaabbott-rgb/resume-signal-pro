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
// employer's own endpoint, one GET per posting (one per board for Ashby,
// Breezy and Recruitee), and read the answer as one of three states:
//   open     the employer's system serves the posting;
//   closed   the employer's system says it does not, in a way that cannot be a
//            wrong address of ours (Workday's 403 S22, a 404 or 410 from an API
//            keyed by the posting's own id, an id missing from an Ashby,
//            Breezy or Recruitee board's whole list, Paylocity's own
//            "JobNotFound" page, an Oracle requisition finder that finds
//            nothing, ADP's empty requisition);
//            an Oracle requisition the finder does return is open only when
//            the row's own career site lists it (the finder ignores the
//            site, and answers for an internal-only posting too);
//   unknown  anything else: a network error, a timeout, a refusal, a 5xx, a
//            vendor this module does not read, a Workday 404 (our applyUrl's
//            slug is sometimes wrong, so a 404 there proves nothing).
// Only "closed" retires a page. Unknown keeps the page exactly as it was, and is
// counted, so a build network that blocks vendor GETs shows up as a large
// unknown share in the bake log and the ledger, never as retired pages.
//
// FOUR VENDORS WERE NEVER ASKED (SEO check 2026-11-15, F01): Oracle (36 live
// pages), ADP (16), Breezy (7) and Recruitee (3), 72 of the 490 marked-up
// pages, so two postings Oracle no longer served (Kroger 216822, Caesars
// 91598) kept 'index, follow' and job markup. Each is read now, by the address
// the board itself reads it at (job-board/index.ts checkLive and the ADP
// detail fetch), measured 2026-11-15 against postings the board had already
// seen go: Oracle's ById finder answers 200 with no items, and ADP answers 200
// with an empty requisition (no itemID), for one the employer took down.
//
// THE SAME READ CARRIES WHAT THE EMPLOYER STATES (B06): Workday's endDate,
// startDate (its own posting date), timeType, remoteType and the country of
// its requisition location, Oracle's end date, schedule, remote workplace and
// primary country, Greenhouse's application deadline, Lever's
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
export const READ_VENDORS = Object.freeze(["workday", "greenhouse", "lever", "smartrecruiters", "ashby", "icims", "paylocity", "teamtailor", "personio", "oracle", "adp", "breezy", "recruitee"]);
/** Vendors read only for what the employer states (their answer never says closed). */
export const STATED_ONLY_VENDORS = Object.freeze(["ukg"]);
/**
 * Vendors read with one list request per board (employerReadPlan kind
 * "board"): one failed GET makes every page of that board unknown, so the
 * daily check's per-vendor judgement counts their unknown BOARDS (98-r2 G1).
 */
export const BOARD_LIST_VENDORS = Object.freeze(["ashby", "breezy", "recruitee"]);

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
/** A name that is only ever one label of a host (a Breezy or Recruitee board, an Oracle tenant): no dot, so it can name no other host. */
const HOST_LABEL = /^[A-Za-z0-9-]+$/;
/** ADP's client id is a UUID; its career-center id and requisition ids are digits and underscores. */
const ADP_CLIENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADP_KEY = /^[0-9_]+$/;
/** The career center an ADP token without one is read under, as the board reads it (job-board normalize.ts adpBoardParams). */
const ADP_DEFAULT_CAREER_CENTER = "19000101_000001";

/**
 * THE ONE GET THAT ANSWERS FOR A ROW, or a reason there is none. `kind` says
 * how the answer is read: "workday" (CXS detail JSON), "api" (a JSON endpoint
 * keyed by the posting's own id), "board" (a whole board's JSON list, one read
 * per board: Ashby, Breezy, Recruitee), "page" (the employer's page and its
 * own JobPosting markup), "oracle" (the tenant's requisition finder), "adp"
 * (Workforce Now's public requisition detail) or "ukg" (the opportunity detail
 * page, read for its stated date only).
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
    // The board's own list addresses (job-board/index.ts listUrl).
    case "breezy":
      if (!HOST_LABEL.test(token)) return { vendor: source, url: null, why: "not a Breezy board name" };
      return { vendor: source, kind: "board", url: `https://${token}.breezy.hr/json`, accept: "application/json" };
    case "recruitee":
      if (!HOST_LABEL.test(token)) return { vendor: source, url: null, why: "not a Recruitee board name" };
      return { vendor: source, kind: "board", url: `https://${token}.recruitee.com/api/offers/`, accept: "application/json" };
    case "oracle": {
      // tenant~region~site ("eluq~us2~CX_1"; a region-less host has an empty
      // region, "jpmc~~CX_1001"), read at the host the board reads it at
      // (job-board normalize.ts oracleHost). The requisition id goes into the
      // finder quoted, as the report's evidence read it, so an id with a
      // letter in it ("REQ_822358", "N134928") is read too; one that could
      // close the quote is not read at all.
      const [tenant, region = "", site = ""] = token.split("~");
      if (!tenant || !HOST_LABEL.test(tenant) || !/^[A-Za-z0-9]*$/.test(region) || !/^[A-Za-z0-9_]+$/.test(site)) return { vendor: source, url: null, why: "not an Oracle tenant~region~site token" };
      if (!SLUG.test(key)) return { vendor: source, url: null, why: "not an Oracle requisition id" };
      const host = `${tenant}.fa.${region ? `${region}.` : ""}oraclecloud.com`;
      // THE SITE'S OWN LIST, searched for the id (review of 2026-11-15): the
      // ById finder ignores siteNumber, so it answers for a requisition
      // posted only on an internal site too. An open answer stands only when
      // the row's own site lists the requisition (employerVerdict, "oracle").
      return {
        vendor: source,
        kind: "oracle",
        url: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=${enc(`ById;Id="${key}",siteNumber=${site}`)}`,
        siteUrl: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${enc(`findReqs;siteNumber=${site},keyword=${key},limit=25`)}`,
        accept: "application/json",
      };
    }
    case "adp": {
      // cid or cid~ccId, read at the detail address the board's description
      // fetch reads (job-board/index.ts).
      const [cid, ccId = ""] = token.split("~");
      const center = ccId || ADP_DEFAULT_CAREER_CENTER;
      if (!ADP_CLIENT.test(cid ?? "") || !ADP_KEY.test(center) || !ADP_KEY.test(key)) return { vendor: source, url: null, why: "not an ADP client id and requisition" };
      return { vendor: source, kind: "adp", url: `https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions/${key}?cid=${cid}&ccId=${center}&lang=en_US&locale=en_US`, accept: "application/json" };
    }
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
/**
 * THE LAST WHOLE DAY AN END INSTANT LEAVES, as "YYYY-MM-DD". The page writes
 * validThrough as that day's 23:59:59 UTC, so an instant is taken back to the
 * last UTC day that ends at or before it: Oracle's 2026-11-17T05:00:00+00:00
 * (midnight in Virginia) is the 16th, and 2026-12-09T18:30:00+00:00 (midnight
 * in Bengaluru) the 8th. Erring early is the safe side: a window that ends a
 * few hours before the employer's never says a closed posting is open. A date
 * with no time is the last day as stated.
 */
const statedEndDay = (v) => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return statedDay(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t - 86_399_000).toISOString().slice(0, 10) : null;
};
/**
 * WHAT A DESCRIPTION SAYS ABOUT BEING ON SITE (SEO audit 2026-11-18,
 * STRUCTURED-6). Google's TELECOMMUTE is for a job worked remotely 100% of the
 * time. Turner & Townsend 744000161597359 was marked TELECOMMUTE because
 * SmartRecruiters set location.remote, while its own description asks for an
 * "onsite expectation of 3-4 days per month minimum" at the Frederick, MD
 * project site. A vendor's remote flag is stated only when the description
 * carries no on-site obligation: a number of days a week or a month on site,
 * in the office, in person or travelling to a site; an on-site expectation,
 * presence or requirement; daily on-site work; a hybrid schedule; travel to
 * the project or client site. A sentence that offers fully remote work as the
 * alternative ("one or two days a week in the office, or fully remote
 * anywhere in Australia") is not an obligation, and neither is travel that
 * "may be required" or a technical word ("hybrid cloud").
 *
 * Built against 865 vendor-flagged remote postings with their own text (847
 * Lever workplaceType remote, 18 SmartRecruiters location.remote, read
 * 2026-11-01; src/test/fixtures/remote-flag-corpus-2026-11-18.json, labelled
 * by hand): it refuses none labelled fully remote, so it is never worse than
 * the flag alone. Returns the phrase that obliges, or null.
 */
const NUM = "(?:\\d+|one|two|three|four|five)";
const DAYS_PER = new RegExp(`\\b${NUM}(?:\\s*(?:-|–|to|or)\\s*${NUM})?\\s+days?\\s+(?:per|a|each|every)\\s+(?:week|month)\\b|\\b${NUM}(?:\\s*(?:-|–|to|or)\\s*${NUM})?\\s+days?\\s+(?:on-?\\s?site|in (?:the |our )?office|in-office|in person|in-person)\\b`, "i");
// "on site" as two words only where it is not "based on site requirements".
const ON_SITE = "(?<!\\bbased )on-?\\s?site";
const PRESENCE_WORD = new RegExp(`\\b(?:${ON_SITE}|in (?:the |our )?office|in-office|in person|in-person|travel\\w*|visits?|commute)\\b`, "i");
const OBLIGATION = [
  new RegExp(`\\b${ON_SITE} (?:expectation|presence|requirement|attendance)s?\\b`, "i"),
  new RegExp(`\\b(?:daily|weekly|regular) ${ON_SITE} (?:support|presence|work|attendance)\\b`, "i"),
  /\bhybrid (?:work(?:ing)? )?(?:schedule|model|arrangement|setting)\b/i,
  // "hybrid role" also names a role that mixes two disciplines ("a hybrid role
  // that spans product management and product delivery"): it is a work
  // arrangement only beside a place or a count of days, or standing alone.
  /\bhybrid (?:role|position)\b(?=[^.]{0,60}\b(?:based|office|days?|week|on-?site|in-person|location|requir\w*)\b)/i,
  /^\W*hybrid (?:role|position)\W*$/i,
  /\bhybride werken\b/i,
  /\btravel to (?:the |our |a )?(?:project|client|customer|job) sites?\b/i,
  new RegExp(`\\b(?:required|expected|must be able) to (?:work|be|report) (?:${ON_SITE}|in (?:the |our )?office)\\b`, "i"),
];
/** A sentence that gives fully remote work as the other choice states no obligation. */
const REMOTE_ALTERNATIVE = /\bor (?:fully |100% )?remote(?:ly)?\b/i;
/** Presence the text calls occasional or possible is not an obligation ("occasional travel or on-site presence may be required"). */
const OCCASIONAL = /\b(?:occasional(?:ly)?|may be (?:required|needed|requested)|if (?:needed|required)|from time to time)\b/i;
export function onSiteObligation(text) {
  const t = String(text ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
  if (!t.trim()) return null;
  for (const raw of t.split(/(?<=[.!?;])\s+|\n+/)) {
    const s = raw.replace(/\s+/g, " ").trim();
    if (!s || REMOTE_ALTERNATIVE.test(s)) continue;
    // A count of days a week or a month at a place is an obligation however
    // the sentence is hedged ("five days a week, with occasional off-shift support").
    if (DAYS_PER.test(s) && PRESENCE_WORD.test(s)) return s.slice(0, 160);
    if (OCCASIONAL.test(s)) continue;
    for (const re of OBLIGATION) if (re.test(s)) return s.slice(0, 160);
  }
  return null;
}
/** A vendor's remote flag, kept only when its own text obliges no time on site. */
const remoteUnlessObliged = (flag, text) => flag === true && !onSiteObligation(text);
/** The text fields of an answer, joined, for onSiteObligation. */
const textOf = (...parts) => parts.flat().filter((x) => typeof x === "string" && x).join("\n");

/**
 * THE STATEMENTS WITHOUT A REMOTE FLAG THE PAGE'S OWN TEXT CONTRADICTS
 * (STRUCTURED-6). The vendor's answer is read against its own text where it
 * carries one; the bake reads the stored description too, because a list
 * answer (Ashby's, Paylocity's page) may carry none. Returns the statements
 * unchanged, or a copy without `remote` and with `remoteRefused` naming the
 * sentence that obliged.
 */
export function withoutObligedRemote(stated, text) {
  if (!stated || typeof stated !== "object" || stated.remote !== true) return stated;
  const why = onSiteObligation(text);
  if (!why) return stated;
  const { remote: _remote, ...rest } = stated;
  return { ...rest, remoteRefused: why };
}

/** A two-letter country code a vendor stated, or null. */
const statedCountry = (v) => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(s) ? s : null;
};

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
  // A percentage is a WORKLOAD, not a place (F13): Swisscom R-0006822's
  // '80-100%' is the hours of the job, and its text offers the office or home,
  // so only the whole value "100%" (or "100% remote") is read as remote.
  const rt = label(info?.remoteType);
  if (rt && /^(?:fully\s+remote|100\s*%(?:\s+remote)?)$/i.test(rt) && remoteUnlessObliged(true, textOf(info?.jobDescription))) out.remote = true;
  // THE COUNTRY WORKDAY FILES THE REQUISITION'S LOCATION UNDER (F08). The
  // board read "AR - BUENOS AIRES (ARBUO)" as Arkansas, US; Workday's own
  // answer says Argentina. The code is stated so the page can see when it
  // disagrees with the row's country (posting-page.ts postingCountryMismatch).
  const loc = info?.jobRequisitionLocation?.country;
  const code = statedCountry(loc?.alpha2Code) ?? countryCodeOfDescriptor(loc?.descriptor ?? info?.country?.descriptor);
  if (code) out.country = code;
  return out;
}

/**
 * A COUNTRY'S CODE FROM ITS ENGLISH NAME, as the runtime names regions
 * (Workday's country.descriptor when no alpha2Code comes with it), or null
 * when the name is not one the runtime gives. Built once, on first use.
 */
let regionCodes = null;
function countryCodeOfDescriptor(name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!key) return null;
  if (!regionCodes) {
    regionCodes = new Map([["united states of america", "US"], ["korea, republic of", "KR"], ["czech republic", "CZ"]]);
    try {
      const names = new Intl.DisplayNames(["en"], { type: "region" });
      for (let a = 65; a <= 90; a++) {
        for (let b = 65; b <= 90; b++) {
          const code = String.fromCharCode(a, b);
          const n = names.of(code);
          if (n && n !== code && !regionCodes.has(n.toLowerCase())) regionCodes.set(n.toLowerCase(), code);
        }
      }
    } catch { /* a runtime without region names: the fixed spellings only */ }
  }
  return regionCodes.get(key) ?? null;
}

/**
 * WHAT AN ORACLE REQUISITION STATES (F01, F14): its end date, its schedule
 * ("Full time", "Part time"), a fully remote workplace and its primary
 * country. ORA_REMOTE is Oracle's remote workplace code, but an employer
 * names it: Dell labels it "Field" (a role run in customers' data centres),
 * so the code counts only under a label that says remote and nothing else.
 */
function oracleStated(item) {
  const out = {};
  const end = statedEndDay(item?.ExternalPostedEndDate);
  if (end) out.employerValidThrough = end;
  const schedule = label(item?.JobSchedule);
  if (schedule) out.employmentType = schedule;
  const workplace = label(item?.WorkplaceType);
  const oracleText = textOf(item?.ExternalDescriptionStr, item?.ExternalResponsibilitiesStr, item?.ExternalQualificationsStr, item?.CorporateDescriptionStr, item?.OrganizationDescriptionStr);
  if (item?.WorkplaceTypeCode === "ORA_REMOTE" && workplace && /\bremote\b/i.test(workplace) && !/\b(?:hybrid|partial|partly|flex\w*|field|on-?site|office)\b/i.test(workplace) && remoteUnlessObliged(true, oracleText)) out.remote = true;
  const country = statedCountry(item?.PrimaryLocationCountry);
  if (country) out.country = country;
  return out;
}

/** The entries of a board's whole list, per vendor, or null when the answer is not one. */
function boardEntries(vendor, j) {
  if (vendor === "breezy") return Array.isArray(j) ? j : null;
  if (vendor === "recruitee") return Array.isArray(j?.offers) ? j.offers : null;
  return Array.isArray(j?.jobs) ? j.jobs : null;
}
/** The keys a list entry may be stored under: Breezy's board id is its friendly id, else its id (job-board normalize.ts). */
const entryKeys = (vendor, x) => (vendor === "breezy" ? [x?.friendly_id, x?.id] : [x?.id]).filter((k) => k !== undefined && k !== null && k !== "").map(String);

/** What an API answer for one posting states, per vendor. */
function apiStated(vendor, j) {
  const out = {};
  if (vendor === "greenhouse") {
    const end = statedDay(j?.application_deadline);
    if (end) out.employerValidThrough = end;
  } else if (vendor === "lever") {
    const c = label(j?.categories?.commitment);
    if (c) out.employmentType = c;
    const leverText = textOf(j?.descriptionPlain, j?.openingPlain, (Array.isArray(j?.lists) ? j.lists : []).map((l) => `${l?.text ?? ""}\n${l?.content ?? ""}`), j?.additionalPlain, j?.descriptionBodyPlain);
    if (String(j?.workplaceType ?? "").toLowerCase() === "remote" && remoteUnlessObliged(true, leverText)) out.remote = true;
  } else if (vendor === "smartrecruiters") {
    const t = label(j?.typeOfEmployment?.label);
    if (t) out.employmentType = t;
    const sections = j?.jobAd?.sections && typeof j.jobAd.sections === "object" ? Object.values(j.jobAd.sections).map((x) => x?.text) : [];
    if (j?.location?.remote === true && j?.location?.hybrid !== true && remoteUnlessObliged(true, textOf(sections))) out.remote = true;
  }
  return out;
}

/** What one Ashby board entry states. */
function ashbyStated(job) {
  const out = {};
  const t = label(job?.employmentType);
  if (t) out.employmentType = t;
  const wt = String(job?.workplaceType ?? "").toLowerCase();
  if ((wt === "remote" || (job?.isRemote === true && !wt)) && remoteUnlessObliged(true, textOf(job?.descriptionPlain, job?.descriptionHtml))) out.remote = true;
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
  if (node?.jobLocationType === "TELECOMMUTE" && remoteUnlessObliged(true, textOf(node?.description))) out.remote = true;
  return out;
}

/**
 * WHETHER AN ORACLE SITE'S OWN LIST NAMES THE REQUISITION: true, false (the
 * list was read and does not hold it), or the reason it could not be read.
 * `siteRes` is the answer to plan.siteUrl, or undefined when it was not asked.
 */
function oracleSiteLists(siteRes, key) {
  if (!siteRes) return "its own site's list was not read";
  if (siteRes.error) return `its own site's list did not answer (${siteRes.error})`;
  if (siteRes.challenge) return "challenge";
  if (siteRes.status !== 200) return `its own site's list answered HTTP ${siteRes.status}`;
  const list = parseJson(String(siteRes.body ?? ""))?.items?.[0]?.requisitionList;
  if (!Array.isArray(list)) return "its own site's list is not one";
  return list.some((x) => String(x?.Id ?? "") === key);
}

/** The requisition an Oracle ById answer carries for this key, or null: the read that earns a second GET of the row's own site. */
function oracleRequisitionIn(res, key) {
  if (!res || res.error || res.status !== 200) return null;
  const items = parseJson(String(res.body ?? ""))?.items;
  return Array.isArray(items) ? items.find((x) => String(x?.Id ?? "") === key) ?? null : null;
}

/**
 * THE VERDICT ON ONE ANSWER. `res` is { status, url, body } (url: the final
 * address after redirects), or { error } when the request never answered.
 * `siteRes` is the same for an Oracle row's own site list (plan.siteUrl),
 * asked only when the ById finder returned the requisition. Returns
 * { state, why, stated }.
 */
export function employerVerdict(plan, res, row, siteRes) {
  const unknown = (why) => ({ state: "unknown", why, stated: {} });
  if (!plan?.url) return unknown(plan?.why ?? "nothing to read");
  if (!res || res.error) return unknown(`no answer (${res?.error ?? "network"})`);
  // A bot challenge says nothing about the posting (STRUCTURED-M2).
  if (res.challenge) return unknown("challenge");
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
      const jobs = boardEntries(plan.vendor, parseJson(body));
      // An empty or unreadable board says nothing about one posting: a board
      // that answered with no jobs at all is far likelier a hiccup than every
      // one of its postings closing at once.
      if (!jobs || jobs.length === 0) return unknown("board listed nothing");
      // A LIST WHOSE ENTRIES CARRY NO ID WE READ says nothing about one
      // posting either (review of 2026-11-15): a vendor that renamed its key
      // field would otherwise make every posting "missing from the board",
      // under the implausibility guard's eight-answer floor (Breezy has 7 live
      // pages, Recruitee 3).
      if (!jobs.some((x) => entryKeys(plan.vendor, x).length > 0)) return unknown("list entries carry no id");
      const job = jobs.find((x) => entryKeys(plan.vendor, x).includes(key));
      if (!job) return { state: "closed", why: "missing from the board", stated: {} };
      return { state: "open", why: "listed", stated: plan.vendor === "ashby" ? ashbyStated(job) : {} };
    }
    case "oracle": {
      if (status !== 200) return unknown(status === 404 ? "404 (not the requisition finder)" : `HTTP ${status}`);
      const items = parseJson(body)?.items;
      if (!Array.isArray(items)) return unknown("200 without an items list");
      // THE FINDER FINDS NOTHING FOR A REQUISITION THE EMPLOYER NO LONGER
      // POSTS (Kroger 216822, Caesars 91598, Chili's 15571; measured
      // 2026-11-15). The site number does not narrow it: an open requisition
      // read under another site still comes back. So an empty answer is
      // posted on no site at all, and a non-empty one proves only that the
      // requisition is posted on SOME site, which may be an internal one.
      if (items.length === 0) return { state: "closed", why: "the requisition finder found nothing", stated: {} };
      const item = items.find((x) => String(x?.Id ?? "") === key);
      if (!item) return unknown("200 naming another requisition");
      // A REQUISITION THE FINDER RETURNS IS POSTED ON SOME SITE, NOT
      // NECESSARILY THIS ONE (review of 2026-11-15): Suffolk's 25308 comes
      // back under its external site while only the internal site lists it.
      // So "open" needs the row's own site's list to name the id. Listed
      // nowhere on that site it is unknown, never closed (a search index can
      // lag a new posting); what the requisition states stays the employer's
      // word either way.
      const stated = oracleStated(item);
      const listed = oracleSiteLists(siteRes, key);
      if (listed === true) return { state: "open", why: "200 with its requisition, listed on its site", stated };
      return { state: "unknown", why: listed === false ? "not listed on this site" : listed, stated };
    }
    case "adp": {
      if (status !== 200) return unknown(`HTTP ${status}`);
      const j = parseJson(body);
      if (!j || typeof j !== "object" || Array.isArray(j)) return unknown("200 that is not JSON");
      if (String(j.itemID ?? "") === key) return { state: "open", why: "200 with its requisition", stated: {} };
      // THE EMPTY REQUISITION: no itemID, no title, no posting date and no
      // location, the answer for each of the seven postings the board had seen
      // go (measured 2026-11-15); an open answer carries all of them. Read
      // from that whole fingerprint, so a renamed itemID on an open answer
      // is not a closure (review of 2026-11-15). Another client id answers
      // the same, but the client id is the board's own token, the one the
      // board read the posting from.
      if (j.itemID === undefined && j.requisitionTitle === undefined && j.postDate === undefined && Array.isArray(j.requisitionLocations) && j.requisitionLocations.length === 0) return { state: "closed", why: "ADP served an empty requisition", stated: {} };
      return unknown("200 naming another requisition");
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

/**
 * A BOT CHALLENGE IS A REFUSAL, NOT A SLOW ANSWER (SEO audit 2026-11-18,
 * STRUCTURED-M2). From 2026-11-17 Workday's edge answered the bake's Node
 * fetch with a Cloudflare challenge: HTTP 429, "Security Check ... Enable
 * JavaScript and cookies to continue", a script setting window._cf_chl_opt.
 * The reader retried it after 1.5 s and recorded a plain "HTTP 429", so about
 * 300 Workday rows each spent two seconds of the shared budget and the log
 * read as a flaky network. A 403, 429 or 503 that carries Cloudflare's
 * cf-mitigated: challenge header, or a body with the challenge's script or its
 * cookie sentence, is named "challenge" and never asked again. Nothing here
 * changes the client, the user agent or the runtime to get past one: a
 * challenge means stop asking that vendor (CHALLENGES_BEFORE_STOP).
 */
export const CHALLENGE_STATUSES = Object.freeze([403, 429, 503]);
/** Challenges from one vendor in one run after which its remaining rows are not requested at all. */
export const CHALLENGES_BEFORE_STOP = 3;
const headerOf = (r, name) => {
  try { return typeof r?.headers?.get === "function" ? r.headers.get(name) : null; } catch { return null; }
};
/** Whether one answer is a bot challenge: status, Cloudflare's header, or the challenge page's own markers. */
export function isChallenge(status, body, cfMitigated = null) {
  if (!CHALLENGE_STATUSES.includes(status)) return false;
  if (typeof cfMitigated === "string" && cfMitigated.trim().toLowerCase() === "challenge") return true;
  const b = String(body ?? "");
  return b.includes("_cf_chl_opt") || /Enable JavaScript and cookies/i.test(b);
}

/** One GET with a timeout, and one retry on 429 or a 5xx that is not a challenge. Never throws. */
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
      let body = "";
      try { body = await r.text(); } catch { body = ""; }
      // A challenge is answered once and never retried (STRUCTURED-M2).
      if (isChallenge(status, body, headerOf(r, "cf-mitigated"))) return { status, url: r.url || url, body: "", challenge: true };
      if ((status === 429 || status >= 500) && attempt === 0) {
        await sleep(retryDelayMs);
        continue;
      }
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
  /** Challenges seen per vendor this run (STRUCTURED-M2): past CHALLENGES_BEFORE_STOP its rows are not requested. */
  const challenged = new Map();
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === "string") : [];
  let next = 0;
  const one = async (row) => {
    const plan = employerReadPlan(row);
    if (!plan.url || (plan.statedOnly && !wantStated)) {
      out.set(row.id, { id: row.id, vendor: plan.vendor, state: "unknown", why: plan.url ? "not read for state" : plan.why, stated: {} });
      return;
    }
    if ((challenged.get(plan.vendor) ?? 0) >= CHALLENGES_BEFORE_STOP) {
      out.set(row.id, { id: row.id, vendor: plan.vendor, state: "unknown", why: "vendor challenged", stated: {} });
      return;
    }
    if (now() >= until) {
      out.set(row.id, { id: row.id, vendor: plan.vendor, state: "unknown", why: "budget", stated: {} });
      return;
    }
    const left = Math.max(1, Math.min(timeoutMs, until - now()));
    let res;
    if (plan.kind === "board") {
      if (!boards.has(plan.url)) {
        const p = employerGet(plan.url, { fetchImpl, timeoutMs: left, accept: plan.accept, retryDelayMs });
        boards.set(plan.url, p);
        // One board's challenge counts once, however many rows share its list.
        p.then((r) => { if (r?.challenge) challenged.set(plan.vendor, (challenged.get(plan.vendor) ?? 0) + 1); });
      }
      res = await boards.get(plan.url);
    } else {
      res = await employerGet(plan.url, { fetchImpl, timeoutMs: left, accept: plan.accept, retryDelayMs });
      if (res?.challenge) challenged.set(plan.vendor, (challenged.get(plan.vendor) ?? 0) + 1);
    }
    // An Oracle requisition the finder returned is asked of the row's own site.
    let siteRes;
    if (plan.siteUrl && oracleRequisitionIn(res, idParts(row.id)?.key ?? "")) {
      siteRes = now() >= until
        ? { error: "budget" }
        : await employerGet(plan.siteUrl, { fetchImpl, timeoutMs: Math.max(1, Math.min(timeoutMs, until - now())), accept: plan.accept, retryDelayMs });
      if (siteRes?.challenge) challenged.set(plan.vendor, (challenged.get(plan.vendor) ?? 0) + 1);
    }
    const v = employerVerdict(plan, res, row, siteRes);
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

/** Vendors read one posting at a time under a tenant (the token's first part), whose tenant can refuse this network as a whole. */
const TENANT_VENDORS = new Set(["workday", "oracle", "adp"]);

/**
 * A CLOSED ANSWER THAT IS IMPLAUSIBLE BY ITS NUMBERS IS NOT TRUSTED. The
 * measured closed share is about 7% (2026-11-07). A vendor with at least
 * `minDefinite` definite answers of which more than `maxShare` say closed, or
 * a Workday, Oracle or ADP tenant whose every read (at least three) said
 * closed, is far more likely refusing this network than closing every posting
 * at once, and retiring its pages on that would take down good pages. Those
 * answers become unknown, with the reason, so the log and the ledger show the
 * refusal. Returns a new Map.
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
    if (TENANT_VENDORS.has(r.vendor)) {
      const t = `${r.vendor}:${(idParts(r.id)?.token ?? "").split("~")[0].toLowerCase()}`;
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
    if (TENANT_VENDORS.has(r.vendor)) {
      const t = `${r.vendor}:${(idParts(id)?.token ?? "").split("~")[0].toLowerCase()}`;
      const c = byTenant.get(t);
      if (c && c.open === 0 && c.closed >= 3) out.set(id, { ...r, state: "unknown", why: `implausible: every one of ${c.closed} reads on this ${r.vendor} tenant said closed` });
    }
  }
  return out;
}

/**
 * WHY AN ANSWER IS UNKNOWN, as one of a few named reasons (SEO audit
 * 2026-11-18, STRUCTURED-1). The ledger kept counts only, so the 18 Nov
 * publish bake's 276 unknown Workday answers of 302 could not say whether the
 * budget ran out, a vendor refused, or a challenge stood in the way, and the
 * fixes were aimed at the budget. The reasons: "budget" (the row was never
 * reached), "challenge" (a bot challenge answered), "vendor challenged" (not
 * asked: its vendor had already challenged CHALLENGES_BEFORE_STOP times),
 * "timeout", "network", "429", "403", "404", "5xx", "other HTTP",
 * "implausible closure", "not listed" (an Oracle requisition its own site
 * does not list), "stated only" (UKG), "no plan" (no address this reader can
 * ask, or a vendor it does not read) and "other".
 */
export function unknownReason(why) {
  const w = String(why ?? "");
  if (w === "budget" || /\(budget\)$/.test(w)) return "budget";
  if (w === "challenge") return "challenge";
  if (w === "vendor challenged") return "vendor challenged";
  if (/^no answer \(timeout\)/.test(w) || /did not answer \(timeout\)/.test(w)) return "timeout";
  if (/^no answer\b/.test(w) || /did not answer/.test(w)) return "network";
  if (/^implausible\b/.test(w)) return "implausible closure";
  if (w === "not listed on this site") return "not listed";
  if (/stated date only|not read for state/.test(w)) return "stated only";
  // "HTTP 503", "board HTTP 403", "its own site's list answered HTTP 429", and
  // Workday's "404 (the applyUrl slug may be wrong)"; a 200 that carried no
  // answer ("200 without jobPostingInfo") is "other".
  const status = /\bHTTP (\d{3})\b/.exec(w)?.[1] ?? (/^(404)\b/.exec(w)?.[1] ?? null);
  if (status === "429") return "429";
  if (status === "403") return "403";
  if (status === "404") return "404";
  if (status && status.startsWith("5")) return "5xx";
  if (status) return "other HTTP";
  if (/^(?:not a |no |applyUrl |a vendor this reader|nothing to read)/.test(w)) return "no plan";
  return "other";
}

/**
 * Counts by state, overall and by vendor, and for every unknown answer its
 * reason (unknownReason), overall and per vendor (`why`).
 */
export function summarizeEmployerReads(results) {
  const s = { checked: 0, open: 0, closed: 0, unknown: 0, why: {}, byVendor: {} };
  for (const r of results instanceof Map ? results.values() : results ?? []) {
    s.checked++;
    s[r.state] = (s[r.state] ?? 0) + 1;
    const v = (s.byVendor[r.vendor] ??= { open: 0, closed: 0, unknown: 0 });
    v[r.state] = (v[r.state] ?? 0) + 1;
    if (r.state === "unknown") {
      const reason = unknownReason(r.why);
      s.why[reason] = (s.why[reason] ?? 0) + 1;
      v.why ??= {};
      v.why[reason] = (v.why[reason] ?? 0) + 1;
    }
  }
  return s;
}

/** A why-count map as one short phrase ("budget 3, challenge 2"), largest first. */
export const whyPhrase = (why) => Object.entries(why ?? {})
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([k, n]) => `${k} ${n}`)
  .join(", ");

/** The bake log's one line. */
export function employerReadLine(summary) {
  const vendors = Object.entries(summary.byVendor ?? {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([v, c]) => `${v} ${c.open}/${c.closed}/${c.unknown}${c.why && c.unknown ? ` (${whyPhrase(c.why)})` : ""}`)
    .join(", ");
  return `employer reads: ${summary.open} open, ${summary.closed} closed (retired), ${summary.unknown} unknown of ${summary.checked}${vendors ? `; open/closed/unknown by vendor: ${vendors}` : ""}`;
}

/** A vendor with at least this many pages read in one bake is judged by EMPLOYER_READ_ALARM_SHARE. */
export const EMPLOYER_READ_ALARM_MIN_PAGES = 20;
/** Over this share unknown, such a vendor's closures are not being seen, and the bake says so at the FAIL tier. */
export const EMPLOYER_READ_ALARM_SHARE = 0.5;

/**
 * THE BAKE'S FAIL-TIER LINES (STRUCTURED-1): one per vendor with at least
 * EMPLOYER_READ_ALARM_MIN_PAGES pages of which more than half came back
 * unknown, naming the vendor and why. A vendor read for its statements only
 * (STATED_ONLY_VENDORS) is never checked, so it is not named here. The bake
 * prints these with console.error and goes on: a publish is never blocked, and
 * an unknown answer keeps its page as it was.
 */
export function employerReadAlarms(summary) {
  const lines = [];
  for (const [v, c] of Object.entries(summary?.byVendor ?? {}).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (STATED_ONLY_VENDORS.includes(v)) continue;
    const n = (c.open ?? 0) + (c.closed ?? 0) + (c.unknown ?? 0);
    if (n < EMPLOYER_READ_ALARM_MIN_PAGES || (c.unknown ?? 0) / n <= EMPLOYER_READ_ALARM_SHARE) continue;
    lines.push(`EMPLOYER READS FAIL: ${v} answered for ${n - c.unknown} of ${n} pages (${c.unknown} unknown, ${Math.round((c.unknown / n) * 100)}%: ${whyPhrase(c.why) || "no reason recorded"}); its closures are not being seen, and its pages keep their job markup as they were`);
  }
  return lines;
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
