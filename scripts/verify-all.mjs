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

const verifiers = {
  greenhouse: async (t) => {
    const d = await probe(`https://boards-api.greenhouse.io/v1/boards/${t}/jobs`);
    const jobs = d?.jobs;
    if (!Array.isArray(jobs) || jobs.length < MIN_POSTINGS) return null;
    const meta = await probe(`https://boards-api.greenhouse.io/v1/boards/${t}`);
    return { name: (meta?.name || prettify(t)).slice(0, 60), count: jobs.length };
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
  lever: async (t) => {
    const d = await probe(`https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`);
    if (!Array.isArray(d) || d.length < MIN_POSTINGS) return null;
    return { name: prettify(t), count: d.length };
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
};

const CONCURRENCY = { greenhouse: 14, ashby: 14, smartrecruiters: 8, workable: 8, bamboohr: 14, recruitee: 14, teamtailor: 14, breezy: 14, personio: 2, rippling: 10, lever: 14 };
const SPACING_MS = { greenhouse: 60, ashby: 60, smartrecruiters: 150, workable: 150, bamboohr: 60, recruitee: 60, teamtailor: 60, breezy: 60, personio: 1600, rippling: 120, lever: 60 };

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
