#!/usr/bin/env node
// Census round-3 mass verification: probe every candidate against the vendor's
// OFFICIAL public API, drop tokens already in sources.ts (case-insensitive),
// and keep only live boards with ≥3 postings. SmartRecruiters candidates must
// additionally pass the corporate role-mix rule (proFrac≥0.50, retailFrac≤0.20)
// — the rung-1 decision that keeps staffing/retail-mill inventory off the board.
// Captures display name + posting count for HOT selection and the ≥100-posting
// staffing-mill screen at merge time.
//
// Usage: node scripts/verify-all.mjs <census.json> <verified-out.json>

import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LABEL_NAMED_VENDORS, adpWelcomeName, ashbyOrganizationName, censusNameReason, pickAshbyName, sameSiteRedirect, ukgName } from "./census-names.mjs";
const execFileP = promisify(execFile);

const [, , CENSUS_PATH, OUT] = process.argv;
// Resume sidecars: every probed token is appended to .progress, every hit to
// .hits (JSONL) — a killed run resumes where it stopped instead of re-probing.
const PROGRESS_PATH = `${OUT}.progress`;
const HITS_PATH = `${OUT}.hits`;
const probed = new Set(fs.existsSync(PROGRESS_PATH) ? fs.readFileSync(PROGRESS_PATH, "utf8").split("\n").filter(Boolean) : []);
const priorHits = fs.existsSync(HITS_PATH) ? fs.readFileSync(HITS_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
if (probed.size) console.log(`resuming: ${probed.size} already probed, ${priorHits.length} prior hits`);
const census = JSON.parse(fs.readFileSync(CENSUS_PATH, "utf8"));
// EU tenants arrive from the census under their own keys carrying BARE tenant
// slugs, because discovery reads hostnames and the hostname is the only place
// the region shows. The catalog has no EU vendor — an EU board is the same
// vendor routed to its EU hosts via the compound-token prefix — so the keys
// fold into their vendor's candidate list here, prefixed. Folding BEFORE the
// catalog dedupe is the point: the catalog stores EU boards under the
// prefixed token, and an unprefixed candidate would never match its own entry
// and be probed (and merged) twice.
for (const [euKey, vendor] of [["greenhouse-eu", "greenhouse"], ["lever-eu", "lever"]]) {
  const bare = census[euKey] ?? [];
  if (!bare.length) continue;
  const have = new Set(census[vendor] ?? []);
  census[vendor] = [...(census[vendor] ?? [])];
  for (const t of bare) {
    const tok = t.startsWith("eu~") ? t : `eu~${t}`;
    if (!have.has(tok)) { census[vendor].push(tok); have.add(tok); }
  }
  console.log(`${euKey}: folded ${bare.length} candidates into ${vendor} under the routing prefix`);
}
const MIN_POSTINGS = 3;
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── existing catalog: never re-verify what we already serve ────────────────
const srcText = fs.readFileSync(new URL("../supabase/functions/job-board/sources.ts", import.meta.url), "utf8");
// BOTH parses below deliberately stop at the token and never touch the
// closing brace. Catalog entries grew optional suffixes twice on 2026-08-31
// (the per-board window override, then the agency disclosure flag), and every
// parser that anchored past the token went blind to the suffixed entries —
// the catalog-invariants regex lost PetSmart that way. A dedupe that
// unmatches on a suffix re-probes (and re-merges) boards the catalog already
// carries, which is the ~2.7k-wasted-probes failure with a duplicate-entry
// chaser. Keep them prefix-anchored.
const existing = new Set();
for (const m of srcText.matchAll(/s\("(?:[^"\\]|\\.)*",\s*"([a-z]+)",\s*"([^"]+)"/g)) {
  existing.add(`${m[1]}:${m[2].toLowerCase()}`);
}
// Object-literal entries (rung 3 + census merges) — missing this format cost
// ~2.7k wasted probes in round 3.
for (const m of srcText.matchAll(/source:\s*"(\w+)",\s*token:\s*"([^"]+)"/g)) {
  existing.add(`${m[1]}:${m[2].toLowerCase()}`);
}
console.log(`catalog holds ${existing.size} boards — deduping candidates against it`);

const prettify = (t) => t.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim().slice(0, 60);

// curl-backed: node's fetch gets ECONNREFUSED from background contexts in
// this environment; curl subprocesses always have network. Async execFile
// keeps the per-vendor concurrency real (execFileSync would serialize it).
/**
 * POST twin of probe(), for vendors whose list is a JSON envelope rather than
 * a GET. Same retry, same 429 backoff, same status contract — only the verb
 * and a body differ, so a vendor cannot get quieter treatment by needing one.
 */
async function probePost(url, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const { stdout } = await execFileP(
        "/usr/bin/curl",
        ["-s", "-m", "15", "-X", "POST", "-H", `User-Agent: ${UA["User-Agent"]}`,
         "-H", "Content-Type: application/json", "-H", "Accept: application/json",
         "--data", JSON.stringify(body), "-w", "\n__STATUS__%{http_code}", url],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      const cut = stdout.lastIndexOf("\n__STATUS__");
      if (cut < 0) return null;
      const status = Number(stdout.slice(cut + 11));
      if (status === 429) { await sleep(8000 * (i + 1)); continue; }
      if (status < 200 || status >= 300) return null;
      try { return JSON.parse(stdout.slice(0, cut)); } catch { return null; }
    } catch { await sleep(1500); }
  }
  return null;
}

async function probe(url, asText = false, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const { stdout } = await execFileP(
        "/usr/bin/curl",
        ["-s", "-m", "15", "-H", `User-Agent: ${UA["User-Agent"]}`, "-w", "\n__STATUS__%{http_code}", url],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      const cut = stdout.lastIndexOf("\n__STATUS__");
      if (cut < 0) return null;
      const status = Number(stdout.slice(cut + 11));
      const body = stdout.slice(0, cut);
      if (status === 429) { await sleep(8000 * (i + 1)); continue; }
      if (status < 200 || status >= 300) return null;
      return asText ? body : JSON.parse(body);
    } catch { await sleep(1500); }
  }
  return null;
}

// SmartRecruiters corporate role-mix rule (rung-1 decision, re-derived):
// classify posting titles; a board qualifies only when professional roles
// dominate and retail/hourly roles are a small minority.
const PRO = /\b(engineer|developer|manager|director|analyst|designer|architect|scientist|consultant|accountant|counsel|attorney|marketing|product|program|finance|hr\b|recruiter|specialist|coordinator|administrator|executive|officer|lead|principal|strateg|research|data|software|devops|security|nurse practitioner|physician|therapist|pharmacist)\b/i;
const RETAIL = /\b(cashier|crew|stocker|barista|server|bartender|dishwasher|housekeep|janitor|custodian|retail associate|sales associate|store associate|team member|warehouse operative|picker|packer|delivery driver|courier|line cook|prep cook|host(?:ess)?|cleaner|laborer|groundskeeper)\b/i;
function roleMixOk(titles) {
  if (titles.length === 0) return false;
  const pro = titles.filter((t) => PRO.test(t)).length / titles.length;
  const retail = titles.filter((t) => RETAIL.test(t)).length / titles.length;
  return pro >= 0.5 && retail <= 0.2;
}

// Paylocity self-names are page headings the employer typed into a text box,
// and many type a heading rather than their company. A heading built entirely
// from hiring vocabulary carries no identity — the prober then resolves the
// employer from the first posting's structured data instead of shipping the
// heading as a display name. A word set rather than a phrase list, because
// headings arrive in every arrangement of the same few dozen words.
const HIRING_VOCAB = new Set([
  "all", "and", "apply", "at", "available", "board", "career", "careers",
  "current", "currently", "default", "employment", "external", "for", "here",
  "hiring", "internal", "job", "jobs", "join", "listing", "listings", "new",
  "now", "open", "opening", "openings", "opportunities", "opportunity", "our",
  "page", "portal", "position", "positions", "posting", "postings",
  "recruiting", "recruitment", "search", "team", "the", "us", "vacancies",
  "vacancy", "we", "we're", "welcome", "with", "work",
]);
const headingOnly = (name) => {
  const words = String(name).toLowerCase().replace(/[^a-z0-9']+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length === 0 || words.every((w) => HIRING_VOCAB.has(w));
};

/**
 * ONE REQUEST A SECOND PER HOST for the pages a census reads beside a
 * vendor's API: an Ashby board's hosted page (a second Ashby host, read for
 * every new board) and an employer's homepage (the review, 2026-10-26: the
 * hosted page ran at the API's 14-way concurrency, and the homepage read
 * followed redirects to any host). Calls for one host queue behind each
 * other. A redirect is followed only within the same registrable domain
 * (sameSiteRedirect), at most three times, and only when asked: a homepage
 * that moves to another company's site has left its employer's own words.
 */
const POLITE_SPACING_MS = 1100;
const politeLast = new Map();
const politeChain = new Map();
async function politeSlot(host) {
  const prev = politeChain.get(host) ?? Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  politeChain.set(host, prev.then(() => mine));
  await prev;
  const wait = (politeLast.get(host) ?? 0) + POLITE_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  politeLast.set(host, Date.now());
  return release;
}
async function politeText(url, { sameSiteRedirects = false } = {}) {
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    let host;
    try { host = new URL(at).hostname; } catch { return null; }
    const release = await politeSlot(host);
    let stdout = "";
    try {
      ({ stdout } = await execFileP(
        "/usr/bin/curl",
        ["-s", "-m", "15", "-H", `User-Agent: ${UA["User-Agent"]}`, "-w", "\n__STATUS__%{http_code} %{redirect_url}", at],
        { maxBuffer: 32 * 1024 * 1024 },
      ));
    } catch { return null; } finally { release(); }
    const cut = stdout.lastIndexOf("\n__STATUS__");
    if (cut < 0) return null;
    const [code, next = ""] = stdout.slice(cut + 11).trim().split(" ");
    const status = Number(code);
    if (status >= 200 && status < 300) return stdout.slice(0, cut);
    if (status >= 300 && status < 400 && sameSiteRedirects && next && sameSiteRedirect(at, next)) { at = new URL(next, at).href; continue; }
    return null;
  }
  return null;
}

const verifiers = {
  greenhouse: async (t) => {
    const eu = t.startsWith("eu~");
    const host = eu ? "boards.eu.greenhouse.io" : "boards-api.greenhouse.io";
    const tok = eu ? t.slice(3) : t;
    const d = await probe(`https://${host}/v1/boards/${tok}/jobs`);
    const jobs = d?.jobs;
    if (!Array.isArray(jobs) || jobs.length < MIN_POSTINGS) return null;
    const meta = await probe(`https://${host}/v1/boards/${tok}`);
    return { name: (meta?.name || prettify(tok)).slice(0, 60), count: jobs.length };
  },
  // The posting API carries no organization name; the hosted jobs page embeds
  // the organization record, whose name field is the vendor's own. When that
  // record is empty the page title is the bare vendor word, so the title is
  // never read; the board's own slug is the fallback, unless it keeps a label
  // word. An organization name that does not match the slug leaves a new
  // board unnamed for review (pickAshbyName), and the census rule below
  // refuses a label.
  ashby: async (t) => {
    const d = await probe(`https://api.ashbyhq.com/posting-api/job-board/${t}`);
    const jobs = d?.jobs;
    if (!Array.isArray(jobs) || jobs.length < MIN_POSTINGS) return null;
    const page = await politeText(`https://jobs.ashbyhq.com/${encodeURIComponent(t)}`);
    const pick = pickAshbyName(ashbyOrganizationName(page), t);
    return { name: pick.name, count: jobs.length, nameFrom: pick.from };
  },
  smartrecruiters: async (t) => {
    const d = await probe(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(t)}/postings?limit=100`);
    const content = d?.content;
    const total = Number(d?.totalFound) || (Array.isArray(content) ? content.length : 0);
    if (!Array.isArray(content) || total < MIN_POSTINGS) return null;
    const titles = content.map((p) => String(p?.name ?? "")).filter(Boolean);
    if (!roleMixOk(titles)) return null; // corporate-only rule
    return { name: (content[0]?.company?.name || prettify(t)).slice(0, 60), count: total };
  },
  workable: async (t) => {
    const d = await probe(`https://apply.workable.com/api/v1/widget/accounts/${t}?details=false`);
    const jobs = d?.jobs;
    const total = Number(d?.total) || (Array.isArray(jobs) ? jobs.length : 0);
    if (!Array.isArray(jobs) || total < MIN_POSTINGS) return null;
    return { name: (d?.name || prettify(t)).slice(0, 60), count: total };
  },
  bamboohr: async (t) => {
    const d = await probe(`https://${t}.bamboohr.com/careers/list`);
    const rows = d?.result;
    if (!Array.isArray(rows) || rows.length < MIN_POSTINGS) return null;
    return { name: prettify(t), count: rows.length };
  },
  // Oracle Fusion. Token is tenant~region~site, exactly as sources.ts stores
  // it, so a verified hit merges without translation.
  //
  // The count comes from TotalJobsCount rather than the returned page: this
  // endpoint pages at 25 by default, and counting the page would report every
  // large employer as a 25-posting board — under the 161/board average that
  // makes this vendor worth censusing at all.
  //
  // The name comes from the employer's own EmployerName where the payload
  // carries one; the tenant code (edel, ebxr) is meaningless to a reader, so
  // prettify() is a poor fallback here and a merge-time name collision would
  // be the only other check. Verified live 2026-08-10: an existing tenant
  // returned TotalJobsCount 906.
  oracle: async (t) => {
    const [tenant, region, site] = String(t).split("~");
    if (!tenant || !region || !site) return null;
    const finder = `findReqs;siteNumber=${site},limit=1`;
    const d = await probe(
      `https://${tenant}.fa.${region}.oraclecloud.com/hcmRestApi/resources/latest/` +
      `recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`,
    );
    const item = Array.isArray(d?.items) ? d.items[0] : null;
    const total = Number(item?.TotalJobsCount) || 0;
    if (total < MIN_POSTINGS) return null;
    const first = Array.isArray(item?.requisitionList) ? item.requisitionList[0] : null;
    const name = String(first?.EmployerName || prettify(tenant)).slice(0, 60);
    return { name, count: total };
  },
  recruitee: async (t) => {
    const d = await probe(`https://${t}.recruitee.com/api/offers/`);
    const offers = d?.offers;
    if (!Array.isArray(offers) || offers.length < MIN_POSTINGS) return null;
    return { name: (offers[0]?.company_name || prettify(t)).slice(0, 60), count: offers.length };
  },
  teamtailor: async (t) => {
    const x = await probe(`https://${t}.teamtailor.com/jobs.rss`, true);
    if (!x || !x.includes("<item>")) return null;
    const items = (x.match(/<item>/g) || []).length;
    if (items < MIN_POSTINGS) return null;
    const chTitle = (x.split("<item>")[0].match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? "";
    const name = chTitle.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/^\s*(jobs?|careers?)\s+(at|@)\s+/i, "").trim();
    return { name: (name || prettify(t)).slice(0, 60), count: items };
  },
  personio: async (t) => {
    const host = census.personio_hosts?.[t] ?? "jobs.personio.de";
    let x = await probe(`https://${t}.${host}/xml`, true);
    if (!x || !x.includes("<position")) {
      const alt = host.endsWith(".de") ? "jobs.personio.com" : "jobs.personio.de";
      x = await probe(`https://${t}.${alt}/xml`, true);
      if (!x || !x.includes("<position")) return null;
    }
    const n = (x.match(/<position>/g) || []).length;
    if (n < MIN_POSTINGS) return null;
    return { name: prettify(t), count: n };
  },
  breezy: async (t) => {
    const d = await probe(`https://${t}.breezy.hr/json`);
    if (!Array.isArray(d) || d.length < MIN_POSTINGS) return null;
    const cn = d[0]?.company?.name;
    return { name: ((typeof cn === "string" && cn) || prettify(t)).slice(0, 60), count: d.length };
  },
  pinpoint: async (t) => {
    const d = await probe(`https://${t}.pinpointhq.com/postings.json`);
    const data = d?.data;
    if (!Array.isArray(data) || data.length < MIN_POSTINGS) return null;
    return { name: prettify(t), count: data.length };
  },
  lever: async (t) => {
    // Same EU routing as greenhouse above: a tenant lives on exactly one side,
    // and the US host answers 404 for an EU tenant (verified live 2026-08-31,
    // asobostudio). prettify gets the STRIPPED slug — the prefix is routing,
    // not identity, and would otherwise ship inside a display name.
    const eu = t.startsWith("eu~");
    const host = eu ? "api.eu.lever.co" : "api.lever.co";
    const tok = eu ? t.slice(3) : t;
    const d = await probe(`https://${host}/v0/postings/${encodeURIComponent(tok)}?mode=json`);
    if (!Array.isArray(d) || d.length < MIN_POSTINGS) return null;
    return { name: prettify(tok), count: d.length };
  },
  rippling: async (t) => {
    // Embedded __NEXT_DATA__ payload (same extraction the board fetcher uses).
    const html = await probe(`https://ats.rippling.com/${t}/jobs`, true);
    const m = html?.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    try {
      const d = JSON.parse(m[1]);
      const q = (d?.props?.pageProps?.dehydratedState?.queries ?? []).find((x) => Array.isArray(x.queryKey) && x.queryKey[2] === "job-posts");
      const total = Number(q?.state?.data?.totalItems) || 0;
      if (total < MIN_POSTINGS) return null;
      return { name: (d?.props?.pageProps?.board?.name || prettify(t)).slice(0, 60), count: total };
    } catch { return null; }
  },
  // Paylocity has no public list API: the board page embeds its entire posting
  // list as one JSON assignment in a script tag, and per-posting pages carry a
  // structured-data block naming the hiring organization. Two consequences: a
  // response without a parseable payload is UNREADABLE — fail, never zero, or
  // a throttled or reshaped page would read as an empty board — and a heading
  // with no identity gets its name resolved from the first posting instead.
  // prettify() is useless here; tokens are opaque board GUIDs.
  // ADP Workforce Now. Token cid or cid~ccId (the ccId selects the career
  // center — one live cid answers 19 postings on its default center and 1 on
  // its second, so the compound token is identity, not routing). The list
  // endpoint is the career-center SPA's own public JSON; a response without
  // the requisition envelope is UNREADABLE — fail, never zero. The count is
  // the tenant's own advertised total from the page meta (the page caps at 20
  // rows, so counting the page would report every large employer as a
  // 20-posting board — the oracle lesson).
  //
  // NAMES ARE THE HARD PART, harder than paylocity's: NO payload names the
  // employer — not the list, not the detail, not the page shell (measured
  // across six live boards 2026-08-31; the page <title> is the vendor's own
  // generic word). What the branding config DOES carry is the employer's own
  // welcome prose ("Welcome to League School!"), so the name is read from
  // that, held to the census rule, and left EMPTY when it carries no identity
  // — resolve-adp-names then reads the employer's own posting prose, and
  // merge-all's name gate holds a board neither can name.
  //
  // The logo's file name is NOT a source (trusted-pages round 2026-10-25): its
  // residue shipped "C3 CMYK", "BTB2.png" and "HRH Secaucus University
  // Transparent" as employers, and a board named that way never reached the
  // posting-prose resolver, which only reads boards that arrive unnamed.
  adp: async (t) => {
    const [cid, ccIdRaw] = String(t).split("~");
    const ccId = ccIdRaw || "19000101_000001";
    const base = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1";
    const qs = `cid=${cid}&ccId=${ccId}&timeStamp=${Date.now()}&lang=en_US&locale=en_US`;
    const d = await probe(`${base}/job-requisitions?${qs}&$top=20&$skip=1`);
    const reqs = d?.jobRequisitions;
    if (!Array.isArray(reqs)) return null;
    const external = reqs.filter((r) => !(r?.customFieldGroup?.indicatorFields ?? [])
      .some((f) => f?.nameCode?.codeValue === "InternalPostingFlag" && f?.indicatorValue === true));
    const total = Number(d?.meta?.totalNumber) || 0;
    // totalNumber counts internal-only postings the adapter refuses to serve;
    // scale it by the sampled external share so a heavily-internal board
    // cannot inflate its way over the mill-screen threshold.
    const externalShare = reqs.length > 0 ? external.length / reqs.length : 1;
    const count = total > reqs.length ? Math.round(total * externalShare) : external.length;
    if (count < MIN_POSTINGS) return null;
    const links = await probe(`${base}/content-links/career-center?${qs}`);
    let name = adpWelcomeName(links?.contentLinks);
    if (headingOnly(name)) name = "";
    return { name: name.slice(0, 60), count, nameFrom: "welcome prose" };
  },
  ukg: async (t) => {
    // Token is pod~TENANT~guid; all three come from the crawled URL, so the
    // board is fetchable without resolving anything.
    const [pod, tenant, board] = String(t).split("~");
    if (!pod || !tenant || !board) return null;
    const base = `https://${pod}.ultipro.com/${tenant}/JobBoard/${board}`;
    const d = await probePost(`${base}/JobBoardView/LoadSearchResults`,
      { opportunitySearch: { Top: 1, Skip: 0, QueryString: "", OrderBy: [], Filters: [] } });
    if (!d || !Array.isArray(d.opportunities)) return null;
    const count = Number(d.totalCount) || d.opportunities.length;
    if (count < MIN_POSTINGS) return null;
    // THE NAME COMES FROM THE BOARD'S OWN NAME FIELD. The board page embeds
    // its jobBoard record, whose Name is the vendor's name field for the
    // board, and a footer link the employer set to its own domain. The image
    // text on the page is the brand asset's internal label in UKG's admin
    // screens, not a name: it shipped "Axia Logo Horizontal", "US - LLC
    // Recruiting" and "Westminster Brand 051816" as employers (trusted-pages
    // round 2026-10-25), so it is never read. The Name wins when it is a
    // name and agrees with the footer domain; otherwise the employer's own
    // homepage names itself; otherwise the board stays unnamed and out.
    const read = await ukgName(base, (url) => (url === base ? probe(url, true, 2) : politeText(url, { sameSiteRedirects: true })));
    if (!read) return null;
    const name = headingOnly(read.name) ? "" : read.name;
    return { name: name.slice(0, 60), count, nameFrom: read.evidence };
  },
  paylocity: async (t) => {
    const html = await probe(`https://recruiting.paylocity.com/recruiting/jobs/All/${t}`, true);
    const m = html?.match(/window\.pageData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
    if (!m) return null;
    let d; try { d = JSON.parse(m[1]); } catch { return null; }
    if (!Array.isArray(d.Jobs)) return null;
    const jobs = d.Jobs.filter((j) => !j?.IsInternal);
    if (jobs.length < MIN_POSTINGS) return null;
    let name = String(d.ModuleTitle ?? "")
      .replace(/^\s*(?:jobs?|careers?|openings?|positions?)\s+(?:at|@|with)\s+/i, "")
      .replace(/[\s:;|,\u2013\u2014-]+$/, "").trim();
    if (headingOnly(name)) {
      const det = await probe(`https://recruiting.paylocity.com/recruiting/jobs/Details/${jobs[0].JobId}`, true);
      const ld = det?.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
      try {
        const org = JSON.parse(ld?.[1] ?? "null")?.hiringOrganization?.name;
        if (typeof org === "string" && org.trim()) name = org.trim();
      } catch { /* heading stands; merge hygiene holds it */ }
    }
    if (!name) return null;
    return { name: name.slice(0, 60), count: jobs.length };
  },
};

// adp candidates all hit ONE shared vendor host (workforcenow.adp.com), and a
// hit costs two requests (list + branding) — held to 5 workers at 250ms so the
// probe stays inside the same politeness the census tooling promises.
const CONCURRENCY = { greenhouse: 14, ashby: 14, smartrecruiters: 8, workable: 8, bamboohr: 14, recruitee: 14, teamtailor: 14, breezy: 14, personio: 2, rippling: 10, lever: 14, pinpoint: 14, paylocity: 6, adp: 5, oracle: 6, ukg: 6 };
const SPACING_MS = { greenhouse: 60, ashby: 60, smartrecruiters: 150, workable: 150, bamboohr: 60, recruitee: 60, teamtailor: 60, breezy: 60, personio: 1600, rippling: 120, lever: 60, pinpoint: 60, paylocity: 250, adp: 250, oracle: 250, ukg: 250 };

// EVERY vendor's name meets the census rule (scripts/census-names.mjs, which
// applies the bake's own rule and adds the label shapes a census meets) before
// it is written. A refused name is written as no name, with the refused text
// and the reason beside it for whoever reads the hits: merge-all holds an
// unnamed board back and counts it, so nothing is shortened into a name.
function refuseLabelName(vendor, hit) {
  if (!hit?.name) return hit;
  const why = censusNameReason(hit.name, { fromLabel: LABEL_NAMED_VENDORS.has(vendor) });
  return why ? { ...hit, name: "", refusedName: hit.name, refusedWhy: why } : hit;
}

async function run(vendor, tokens) {
  const verified = [];
  let done = 0;
  const queue = [...tokens];
  await Promise.all(Array.from({ length: CONCURRENCY[vendor] }, async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const r = refuseLabelName(vendor, await verifiers[vendor](t).catch(() => null));
      fs.appendFileSync(PROGRESS_PATH, `${vendor}:${t}\n`);
      if (r) {
        verified.push({ token: t, ...r });
        fs.appendFileSync(HITS_PATH, JSON.stringify({ vendor, token: t, ...r }) + "\n");
      }
      done++;
      if (done % 250 === 0) console.log(`  ${vendor}: ${done}/${tokens.length} probed, ${verified.length} verified`);
      await sleep(SPACING_MS[vendor]);
    }
  }));
  return verified;
}

const out = {};
await Promise.all(Object.keys(verifiers).map(async (vendor) => {
  const fresh = (census[vendor] ?? []).filter((t) => !existing.has(`${vendor}:${t.toLowerCase()}`) && !probed.has(`${vendor}:${t}`));
  console.log(`${vendor}: ${census[vendor]?.length ?? 0} candidates, ${fresh.length} to probe (after catalog dedupe + resume)`);
  const freshHits = await run(vendor, fresh);
  // Fold in prior-run hits so the output is complete regardless of restarts.
  const seen = new Set(freshHits.map((h) => h.token));
  for (const h of priorHits) {
    if (h.vendor === vendor && !seen.has(h.token)) { freshHits.push(refuseLabelName(vendor, { token: h.token, name: h.name, count: h.count, ...(h.nameFrom ? { nameFrom: h.nameFrom } : {}) })); seen.add(h.token); }
  }
  out[vendor] = freshHits.sort((a, b) => b.count - a.count);
  const postings = out[vendor].reduce((s, x) => s + x.count, 0);
  console.log(`${vendor}: ${out[vendor].length} verified NEW boards, ${postings} postings visible`);
}));
out.personio_hosts = census.personio_hosts ?? {};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const totals = Object.entries(out).filter(([k]) => k !== "personio_hosts")
  .map(([k, v]) => `${k}=${v.length}/${v.reduce((s, x) => s + x.count, 0)}p`);
console.log(`\nWrote ${OUT}: ${totals.join(", ")}`);
