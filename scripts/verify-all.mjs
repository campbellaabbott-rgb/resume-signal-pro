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
  ashby: async (t) => {
    const d = await probe(`https://api.ashbyhq.com/posting-api/job-board/${t}`);
    const jobs = d?.jobs;
    if (!Array.isArray(jobs) || jobs.length < MIN_POSTINGS) return null;
    return { name: prettify(t), count: jobs.length };
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
  // welcome prose ("Welcome to League School!") and a logo filename, so the
  // name is resolved from those, hygiene-checked, and left EMPTY when neither
  // carries identity — merge-all's name gate then holds the board back, the
  // oracle discipline, instead of shipping a GUID as a display name.
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
    let name = "";
    const links = await probe(`${base}/content-links/career-center?${qs}`);
    for (const cl of links?.contentLinks ?? []) {
      const code = cl?.linkTypeCode?.codeValue;
      if (code === "WELCOME-TXT") {
        const prose = String(cl?.linkTypeCode?.longName ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|\s+/g, " ").trim();
        const m = prose.match(/\bwelcome to ([^.!?|]{2,60}?)\s*[.!?|]/i) ||
          prose.match(/\b(?:employment|a career|careers?|a position|positions?|opportunit\w+|working) (?:with|at) ([A-Z][^.!?,|]{1,60}?)\s*[.!?,|]/);
        if (m) name = m[1].trim();
      } else if (code === "IMG_LOGO" && !name) {
        // Logo filenames often lead with the employer's name; strip asset
        // vocabulary and sizes, keep what identity remains, and let the
        // hygiene gate below throw the residue away.
        const stem = String(cl?.linkTypeCode?.shortName ?? "").replace(/\.[a-z0-9]+$/i, "");
        const cleaned = stem.split(/[-_\s]+/)
          .filter((w) => w && !/^(logos?|untitled|images?|img|icons?|headers?|banners?|brand(ing)?|final|web|blk|wht|black|white|colou?r|rgb|png|jpe?g|small|large|horiz\w*|vert\w*|stacked|primary|copy|new|old|updated|\d+x\d+|v?\d+)$/i.test(w))
          .join(" ").trim();
        if (/[a-z]{3,}/i.test(cleaned)) name = cleaned;
      }
    }
    name = name.replace(/[\s:;|,–—-]+$/, "").trim();
    if (headingOnly(name)) name = "";
    return { name: name.slice(0, 60), count };
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
const CONCURRENCY = { greenhouse: 14, ashby: 14, smartrecruiters: 8, workable: 8, bamboohr: 14, recruitee: 14, teamtailor: 14, breezy: 14, personio: 2, rippling: 10, lever: 14, pinpoint: 14, paylocity: 6, adp: 5, oracle: 6 };
const SPACING_MS = { greenhouse: 60, ashby: 60, smartrecruiters: 150, workable: 150, bamboohr: 60, recruitee: 60, teamtailor: 60, breezy: 60, personio: 1600, rippling: 120, lever: 60, pinpoint: 60, paylocity: 250, adp: 250, oracle: 250 };

async function run(vendor, tokens) {
  const verified = [];
  let done = 0;
  const queue = [...tokens];
  await Promise.all(Array.from({ length: CONCURRENCY[vendor] }, async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const r = await verifiers[vendor](t).catch(() => null);
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
    if (h.vendor === vendor && !seen.has(h.token)) { freshHits.push({ token: h.token, name: h.name, count: h.count }); seen.add(h.token); }
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
