// Search Console → action list. Turns a GSC performance export into the
// prioritized to-do list that makes SEO iterative instead of guesswork:
// which titles to rewrite, which pages to deepen, which queries deserve a
// page that doesn't exist yet.
//
// Usage:
//   1. Search Console → Performance → Search results → date range 28 days
//      (or 3 months) → EXPORT → Download CSV. That zip contains Queries.csv
//      and Pages.csv.
//   2. node scripts/gsc-actions.mjs <Queries.csv> [Pages.csv]
//
// Buckets:
//   CTR FIX      — page ranks well (pos ≤ 10) with impressions but a weak
//                  click-through: rewrite the <title>/meta description so the
//                  snippet earns the click. Cheapest wins available.
//   STRIKING     — position 11–25 with real impressions: page two. Deepen
//                  the content, add internal links pointing at it, refresh
//                  lastmod. These are the next page-one candidates.
//   NEW PAGE     — decent impressions but position > 25: nothing on the site
//                  really answers this query; candidate for a new guide/page.
//   WINS         — pos ≤ 10 and healthy CTR: leave alone (listed for morale).

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/gsc-actions.mjs <Queries.csv> [Pages.csv]");
  process.exit(1);
}

// GSC CSVs are simple (no embedded newlines) but query text may contain
// commas inside quotes.
const parseCsv = (text) =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const cells = [];
      let cur = "", inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
        else cur += ch;
      }
      cells.push(cur);
      return cells;
    });

const num = (s) => parseFloat(String(s).replace(/[%,]/g, "")) || 0;

const rows = parseCsv(readFileSync(file, "utf8"));
const header = rows[0].map((h) => h.toLowerCase());
const col = (name) => header.findIndex((h) => h.includes(name));
const [qi, ci, ii, ri, pi] = [col("quer"), col("click"), col("impression"), col("ctr"), col("position")];
if (qi < 0 || ii < 0 || pi < 0) {
  console.error(`Unrecognized header: ${rows[0].join(", ")} — expected a GSC Queries.csv`);
  process.exit(1);
}

const data = rows.slice(1).map((r) => ({
  query: r[qi],
  clicks: num(r[ci]),
  impressions: num(r[ii]),
  ctr: num(r[ri]),
  position: num(r[pi]),
}));

// Expected CTR by position (rough industry curves) — used to spot snippets
// underperforming their rank, not as gospel.
const expectedCtr = (pos) =>
  pos <= 1 ? 28 : pos <= 2 ? 15 : pos <= 3 ? 10 : pos <= 5 ? 6 : pos <= 10 ? 2.5 : 1;

const ctrFix = data
  .filter((d) => d.position <= 10 && d.impressions >= 20 && d.ctr < expectedCtr(d.position) * 0.5)
  .sort((a, b) => b.impressions - a.impressions);
const striking = data
  .filter((d) => d.position > 10 && d.position <= 25 && d.impressions >= 10)
  .sort((a, b) => b.impressions - a.impressions);
const newPage = data
  .filter((d) => d.position > 25 && d.impressions >= 15)
  .sort((a, b) => b.impressions - a.impressions);
const wins = data
  .filter((d) => d.position <= 10 && d.clicks >= 3 && d.ctr >= expectedCtr(d.position) * 0.5)
  .sort((a, b) => b.clicks - a.clicks);

const fmt = (d) =>
  `  ${d.query}  —  pos ${d.position.toFixed(1)}, ${d.impressions} impr, ${d.clicks} clicks (${d.ctr}% CTR)`;
const section = (title, items, hint, cap = 15) => {
  console.log(`\n${title} (${items.length})${items.length ? ` — ${hint}` : ""}`);
  for (const d of items.slice(0, cap)) console.log(fmt(d));
  if (items.length > cap) console.log(`  … and ${items.length - cap} more`);
};

console.log(`Parsed ${data.length} queries from ${file}`);
section("CTR FIX", ctrFix, "ranks fine, snippet loses the click — rewrite title/description");
section("STRIKING DISTANCE", striking, "page two — deepen content + add internal links");
section("NEW PAGE CANDIDATES", newPage, "no page really answers this — write one");
section("WINS", wins, "healthy — leave alone", 10);

// Pages.csv (optional second arg): flag pages burning impressions with no clicks.
const pagesFile = process.argv[3];
if (pagesFile) {
  const pr = parseCsv(readFileSync(pagesFile, "utf8"));
  const ph = pr[0].map((h) => h.toLowerCase());
  const pcol = (n) => ph.findIndex((h) => h.includes(n));
  const [ui, pci, pii] = [pcol("page"), pcol("click"), pcol("impression")];
  const zero = pr
    .slice(1)
    .map((r) => ({ url: r[ui], clicks: num(r[pci]), impressions: num(r[pii]) }))
    .filter((p) => p.impressions >= 30 && p.clicks === 0)
    .sort((a, b) => b.impressions - a.impressions);
  console.log(`\nZERO-CLICK PAGES (${zero.length}) — impressions but no clicks: check title/description match`);
  for (const p of zero.slice(0, 15)) console.log(`  ${p.url}  —  ${p.impressions} impr`);
}
