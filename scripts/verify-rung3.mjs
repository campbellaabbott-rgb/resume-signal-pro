#!/usr/bin/env node
// Rung-3 mass verification: probe every census candidate against the vendor's
// OFFICIAL public API and keep only live boards with ≥3 postings (census-merge
// protocol). Captures display name + posting count (for HOT selection and the
// ≥100-posting staffing-mill screen).
//
// Usage: node scripts/verify-rung3.mjs <census.json> <verified-out.json>

import fs from "node:fs";

const [, , CENSUS_PATH, OUT] = process.argv;
const census = JSON.parse(fs.readFileSync(CENSUS_PATH, "utf8"));
const MIN_POSTINGS = 3;
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prettify = (t) =>
  t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);

async function probe(url, asText = false, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { headers: UA, signal: ctrl.signal });
      clearTimeout(to);
      if (res.status === 429) { await sleep(8000 * (i + 1)); continue; }
      if (!res.ok) return null;
      return asText ? await res.text() : await res.json();
    } catch { await sleep(1500); }
  }
  return null;
}

const verifiers = {
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
};

// Personio rate-limits hard — 2 workers with spacing. Others parallelize.
const CONCURRENCY = { recruitee: 14, teamtailor: 14, breezy: 14, personio: 2 };
const SPACING_MS = { recruitee: 60, teamtailor: 60, breezy: 60, personio: 1600 };

async function run(vendor, tokens) {
  const verified = [];
  let done = 0;
  const queue = [...tokens];
  await Promise.all(Array.from({ length: CONCURRENCY[vendor] }, async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const r = await verifiers[vendor](t).catch(() => null);
      if (r) verified.push({ token: t, ...r });
      done++;
      if (done % 200 === 0) console.log(`  ${vendor}: ${done}/${tokens.length} probed, ${verified.length} verified`);
      await sleep(SPACING_MS[vendor]);
    }
  }));
  return verified.sort((a, b) => b.count - a.count);
}

const out = {};
for (const vendor of ["recruitee", "teamtailor", "breezy", "personio"]) {
  const tokens = census[vendor] ?? [];
  console.log(`${vendor}: probing ${tokens.length} candidates…`);
  out[vendor] = await run(vendor, tokens);
  const postings = out[vendor].reduce((s, x) => s + x.count, 0);
  console.log(`${vendor}: ${out[vendor].length} verified boards, ${postings} postings visible`);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const totals = Object.entries(out).map(([k, v]) => `${k}=${v.length} boards/${v.reduce((s, x) => s + x.count, 0)} postings`);
console.log(`\nWrote ${OUT}: ${totals.join(", ")}`);
