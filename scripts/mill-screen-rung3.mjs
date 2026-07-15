#!/usr/bin/env node
// Staffing-mill screen (census-merge protocol): for every board ≥100 postings,
// sample REAL posting text from the vendor API and look for agency/mill
// evidence — postings recruited "on behalf of" clients rather than the company
// hiring for itself. Boards with evidence are EXCLUDED (printed for review);
// clean boards land in rung3-mill-cleared.json for merge-rung3 --apply.
//
// Usage: node scripts/mill-screen-rung3.mjs rung3-mill-worklist.json

import fs from "node:fs";

const worklist = JSON.parse(fs.readFileSync(process.argv[2] ?? "rung3-mill-worklist.json", "utf8"));
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mill evidence in posting TEXT (not just the name): recruiting for third parties.
const MILL_TEXT = /\bour client\b|\bon behalf of (a|an|our|the)\b|\bfor our client\b|\bclient of ours\b|\bour customer is (hiring|looking)\b|\bstaffing (agency|firm|partner)\b|\brecruitment agency\b|\bwe are (a|an) (staffing|recruiting|recruitment|talent) (agency|firm|partner)\b/i;

const strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function sampleTexts(vendor, token) {
  try {
    if (vendor === "recruitee") {
      const d = await (await fetch(`https://${token}.recruitee.com/api/offers/`, { headers: UA })).json();
      return (d.offers ?? []).slice(0, 12).map((o) => `${o.title}\n${strip(o.description)}`);
    }
    if (vendor === "breezy") {
      const d = await (await fetch(`https://${token}.breezy.hr/json`, { headers: UA })).json();
      return (Array.isArray(d) ? d : []).slice(0, 12).map((p) => `${p.name}\n${strip(p.description)}`);
    }
    if (vendor === "teamtailor") {
      const x = await (await fetch(`https://${token}.teamtailor.com/jobs.rss`, { headers: UA })).text();
      return (x.match(/<item>[\s\S]*?<\/item>/g) ?? []).slice(0, 12).map(strip);
    }
    if (vendor === "personio") {
      for (const host of ["jobs.personio.de", "jobs.personio.com"]) {
        const res = await fetch(`https://${token}.${host}/xml`, { headers: UA });
        if (res.ok) {
          const x = await res.text();
          if (x.includes("<position")) return (x.match(/<position>[\s\S]*?<\/position>/g) ?? []).slice(0, 12).map(strip);
        }
        await sleep(1500);
      }
    }
  } catch { /* unreachable board — treat as not cleared */ }
  return null;
}

const cleared = [];
const excluded = [];
for (const b of worklist) {
  const texts = await sampleTexts(b.vendor, b.token);
  if (!texts || texts.length === 0) { excluded.push({ ...b, reason: "unreachable at screen time" }); continue; }
  const hits = texts.filter((t) => MILL_TEXT.test(t)).length;
  if (hits >= 2) excluded.push({ ...b, reason: `mill text in ${hits}/${texts.length} sampled postings` });
  else cleared.push(b);
  await sleep(b.vendor === "personio" ? 2000 : 300);
}

fs.writeFileSync("rung3-mill-cleared.json", JSON.stringify(cleared, null, 1));
console.log(`Cleared ${cleared.length}/${worklist.length} large boards.`);
if (excluded.length) {
  console.log("EXCLUDED (review):");
  for (const e of excluded) console.log(`  ${e.vendor}:${e.token} (${e.count} postings) — ${e.reason}`);
}
