#!/usr/bin/env node
// Staffing-mill screen, all vendors (census-merge protocol): for every board
// ≥100 postings, sample REAL posting text from the vendor API and look for
// agency/mill evidence — postings recruited "on behalf of" clients rather than
// the company hiring for itself. Boards with evidence are EXCLUDED (printed
// for review); clean boards land in round3-mill-cleared.json.
// Vendors whose list feeds carry no posting text (workable/bamboohr/rippling)
// are screened on titles + posting-name patterns — weaker, so borderline
// cases print for eyeballing rather than silently passing.
//
// Usage: node scripts/mill-screen-all.mjs round3-mill-worklist.json

import fs from "node:fs";

const worklist = JSON.parse(fs.readFileSync(process.argv[2] ?? "round3-mill-worklist.json", "utf8"));
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ENGLISH ONLY WAS A BLIND SPOT, and the board is mostly European now.
//
// 2026-08-08: this screen CLEARED `teamtailor:jobtalentfrance` — Jobandtalent
// France, one of Europe's largest temp-staffing platforms. Its postings are
// repeated generic warehouse roles and one names the client outright
// ("A08-RHENUS-Préparateur de commandes"). Nothing matched, because every
// pattern below the fold was English and the postings are French.
//
// The vendors this catalogue grows fastest on — teamtailor, personio — are
// European, so an English-only mill screen fails exactly where it is most
// needed. Phrases added for FR/DE/ES/NL/IT, chosen to be industry terms rather
// than ordinary words: "agence d'intérim" and "Zeitarbeit" name the business
// model, whereas a bare "client"/"Kunde" appears in perfectly normal postings.
const MILL_TEXT = new RegExp([
  // English
  "\\bour client\\b", "\\bon behalf of (a|an|our|the)\\b", "\\bfor our client\\b",
  "\\bclient of ours\\b", "\\bour customer is (hiring|looking)\\b",
  "\\bstaffing (agency|firm|partner)\\b", "\\brecruitment agency\\b",
  "\\bwe are (a|an) (staffing|recruiting|recruitment|talent) (agency|firm|partner)\\b",
  // French — intérim is the industry's own word for it
  "\\bnotre client\\b", "\\bpour le compte de\\b", "\\bagence d.int.rim\\b",
  "\\bagence de recrutement\\b", "\\bcabinet de recrutement\\b", "\\bsoci.t. d.int.rim\\b",
  // German — Zeitarbeit / Arbeitnehmerüberlassung are the regulated terms
  "\\bunser Kunde\\b", "\\bim Auftrag (unseres|eines|der)\\b", "\\bZeitarbeit\\b",
  "\\bPersonaldienstleist", "\\bArbeitnehmer.berlassung\\b", "\\bPersonalvermittlung\\b",
  // Spanish — ETT is the legal category
  "\\bnuestro cliente\\b", "\\bempresa de trabajo temporal\\b", "\\bagencia de empleo\\b",
  // Dutch — uitzendbureau / detachering
  "\\bonze klant\\b", "\\buitzendbureau\\b", "\\bdetacherings?bureau\\b",
  // Italian
  "\\bnostro cliente\\b", "\\bagenzia per il lavoro\\b", "\\bsomministrazione di lavoro\\b",
].join("|"), "i");
const strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function get(url, asText = false) {
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    return asText ? await res.text() : await res.json();
  } catch { return null; }
}

async function sampleTexts(vendor, token) {
  if (vendor === "greenhouse") {
    const d = await get(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
    return (d?.jobs ?? []).slice(0, 12).map((j) => `${j.title}\n${strip(j.content)}`);
  }
  if (vendor === "ashby") {
    const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`);
    return (d?.jobs ?? []).slice(0, 12).map((j) => `${j.title}\n${strip(j.descriptionPlain ?? j.descriptionHtml)}`);
  }
  if (vendor === "smartrecruiters") {
    const list = await get(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=6`);
    const out = [];
    for (const p of (list?.content ?? []).slice(0, 6)) {
      const d = await get(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings/${p.id}`);
      const sections = d?.jobAd?.sections ?? {};
      out.push(`${p.name}\n${strip(Object.values(sections).map((s) => s?.text ?? "").join(" "))}`);
      await sleep(150);
    }
    return out;
  }
  if (vendor === "recruitee") {
    const d = await get(`https://${token}.recruitee.com/api/offers/`);
    return (d?.offers ?? []).slice(0, 12).map((o) => `${o.title}\n${strip(o.description)}`);
  }
  if (vendor === "breezy") {
    const d = await get(`https://${token}.breezy.hr/json`);
    return (Array.isArray(d) ? d : []).slice(0, 12).map((p) => `${p.name}\n${strip(p.description)}`);
  }
  if (vendor === "teamtailor") {
    const x = await get(`https://${token}.teamtailor.com/jobs.rss`, true);
    return x ? x.split("<item>").slice(1, 13).map((b) => strip(b)) : [];
  }
  if (vendor === "personio") {
    for (const host of ["jobs.personio.de", "jobs.personio.com"]) {
      const x = await get(`https://${token}.${host}/xml`, true);
      if (x && x.includes("<position")) return x.split("<position>").slice(1, 13).map((b) => strip(b));
    }
    return [];
  }
  // workable / bamboohr / rippling: list feeds carry no posting text —
  // titles-only screen (weaker; flagged in output).
  if (vendor === "workable") {
    const d = await get(`https://apply.workable.com/api/v1/widget/accounts/${token}?details=false`);
    return (d?.jobs ?? []).slice(0, 20).map((j) => String(j.title ?? ""));
  }
  if (vendor === "bamboohr") {
    const d = await get(`https://${token}.bamboohr.com/careers/list`);
    return (d?.result ?? []).slice(0, 20).map((j) => String(j.jobOpeningName ?? ""));
  }
  if (vendor === "rippling") {
    const x = await get(`https://ats.rippling.com/${token}/jobs`, true);
    const m = x?.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    try {
      const d = JSON.parse(m[1]);
      const q = (d?.props?.pageProps?.dehydratedState?.queries ?? []).find((z) => z.queryKey?.[2] === "job-posts");
      return (q?.state?.data?.items ?? []).slice(0, 20).map((j) => String(j.name ?? ""));
    } catch { return []; }
  }
  if (vendor === "pinpoint") {
    // postings.json carries full description HTML — real text screen.
    const d = await get(`https://${token}.pinpointhq.com/postings.json`);
    return (d?.data ?? []).slice(0, 12).map((j) => strip(String(j.description ?? j.title ?? "")));
  }
  return [];
}

const TITLE_ONLY = new Set(["workable", "bamboohr", "rippling"]);
const cleared = [];
const excluded = [];
let i = 0;
for (const b of worklist) {
  i++;
  const texts = await sampleTexts(b.vendor, b.token);
  const hits = texts.filter((t) => MILL_TEXT.test(t)).length;
  const weak = TITLE_ONLY.has(b.vendor);
  if (hits > 0) {
    excluded.push({ ...b, hits, sampled: texts.length });
    console.log(`EXCLUDE ${b.vendor}:${b.token} "${b.name}" — ${hits}/${texts.length} sampled postings show mill evidence`);
  } else {
    cleared.push({ vendor: b.vendor, token: b.token });
    if (weak) console.log(`clear*  ${b.vendor}:${b.token} "${b.name}" (${b.count}p) — titles-only screen, review name above`);
    else if (i % 10 === 0) console.log(`  …${i}/${worklist.length} screened`);
  }
  await sleep(250);
}
fs.writeFileSync("round3-mill-cleared.json", JSON.stringify(cleared, null, 1));
console.log(`\nCleared ${cleared.length}/${worklist.length}; excluded ${excluded.length}. Wrote round3-mill-cleared.json`);
