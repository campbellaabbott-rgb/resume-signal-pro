// THE WORKDAY LINK ROUND TRIP, MEASURED ON LIVE CARDS (MCP upgrade 3, W1 lane
// L3; the F13 gate).
//
//   node scripts/measure-job-link-roundtrip.mjs                  # read live, print
//   node scripts/measure-job-link-roundtrip.mjs --write <file>   # and record the sample
//   node scripts/measure-job-link-roundtrip.mjs --from <file>    # replay a recorded sample, no network
//
// Read-only. It reads 300 or more live Workday cards through job-board's
// public list (vendor workday; job-board serves a caller without a secret 60
// rows a call whatever limit it sends, anon-budget.ts BROWSER_PAGE_ROWS, so
// five calls), each POST carrying x-rb-budget: probe, and asks agent-mcp/job-link.ts's parseJobLink, with the
// Workday reading on, to name each card's id from its applyUrl, and from the
// forms a person pastes: the host in capitals, the locale dropped, swapped or
// added, the /details/ page, the myworkdaysite.com address with and without a
// locale, the /apply page and a tracking query. It prints each form's hit
// rate. The Workday reading ships on only when every form reaches 98% (F13);
// below that, WORKDAY_LINKS_READ in job-link.ts stays false.
//
// No shebang: a test imports roundTrip and workdayVariants from this file.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseJobLink } from "../supabase/functions/agent-mcp/job-link.ts";

const BASE = process.env.BOARD_URL ?? "https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board";
// The site's public anon key (the same one scripts/verify-board-search.mjs carries).
const KEY = process.env.BOARD_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3aGRhemJvdHBibGloZHhjbWhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMDM2NTgsImV4cCI6MjA2Njc3OTY1OH0.WWetSNSyWlG5CkedbeIQ1p7MB2Q1eLPTUiWy2FrPeGE";
const WANT = 300;
// The rows job-board serves a call without a secret (anon-budget.ts BROWSER_PAGE_ROWS).
// The first run (2026-11-17) asked for 200 a call and stepped the offset by
// 200, so it read 60 of every 200 rows, 240 cards in four calls; the offset
// now steps by the rows each call returned.
const PAGE = 60;
const MAX_CALLS = 6;

/** The forms of one Workday applyUrl a person may paste, each named; [] when the link is no Workday posting link. */
export function workdayVariants(applyUrl) {
  const m = /^https:\/\/([^./]+)\.([^./]+)\.myworkdayjobs\.com\/(.*)$/i.exec(String(applyUrl ?? ""));
  if (!m) return [];
  const [, tenant, dc, rest] = m;
  const path = rest.split(/[?#]/)[0];
  const seg = path.split("/");
  const LOCALE = /^[a-z]{2,3}-[A-Za-z0-9]{2,4}$/;
  const hasLocale = LOCALE.test(seg[0] ?? "");
  const bare = hasLocale ? seg.slice(1) : seg; // <site>/job/<place>/<slug>
  const [site, kind] = bare;
  if (!site || (kind !== "job" && kind !== "details")) return [];
  const after = bare.slice(1).join("/"); // job/<place>/<slug>
  const slug = bare[bare.length - 1];
  const host = `${tenant}.${dc}.myworkdayjobs.com`;
  return [
    { name: "case", url: `https://${host.toUpperCase()}/${path}` },
    { name: "locale", url: `https://${host}/${hasLocale ? "" : "en-US/"}${bare.join("/")}` },
    { name: "locale", url: `https://${host}/de-DE/${bare.join("/")}` },
    { name: "details", url: `https://${host}/${hasLocale ? `${seg[0]}/` : ""}${site}/details/${slug}` },
    { name: "myworkdaysite", url: `https://${dc}.myworkdaysite.com/recruiting/${tenant}/${site}/${after}` },
    { name: "myworkdaysite", url: `https://${dc}.myworkdaysite.com/en-US/recruiting/${tenant}/${site}/details/${slug}` },
    { name: "apply", url: `https://${host}/${path}/apply/applyManually?source=LinkedIn` },
  ];
}

/**
 * Each card's applyUrl, and each of its pasted forms, read back through `parse`
 * (url -> id or null). The rate of a form is its hits over every card: a card
 * whose link yields no form counts as a miss for every form.
 */
export function roundTrip(cards, parse) {
  const tally = new Map();
  const count = (name, hit) => {
    const t = tally.get(name) ?? { hit: 0, n: 0 };
    t.n++;
    if (hit) t.hit++;
    tally.set(name, t);
  };
  const misses = [];
  const FORMS = ["case", "locale", "details", "myworkdaysite", "apply"];
  for (const c of cards) {
    const got = parse(c.applyUrl);
    count("exact", got === c.id);
    if (got !== c.id) misses.push({ form: "exact", id: c.id, url: c.applyUrl, got });
    const vs = workdayVariants(c.applyUrl);
    for (const name of FORMS) {
      const own = vs.filter((v) => v.name === name);
      if (!own.length) {
        count(name, false);
        misses.push({ form: name, id: c.id, url: c.applyUrl, got: "no such form" });
        continue;
      }
      for (const v of own) {
        const g = parse(v.url);
        count(name, g === c.id);
        if (g !== c.id) misses.push({ form: name, id: c.id, url: v.url, got: g });
      }
    }
  }
  const rates = {};
  const counts = {};
  for (const [name, t] of tally) {
    rates[name] = t.n ? t.hit / t.n : 0;
    counts[name] = t;
  }
  return { n: cards.length, rates, counts, misses };
}

async function board(body) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY, "x-rb-budget": "probe" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* reported below */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

async function readLive() {
  const cards = new Map();
  const calls = [];
  let offset = 0;
  for (let i = 0; i < MAX_CALLS && cards.size < WANT; i++) {
    const body = { action: "list", vendor: "workday", limit: PAGE, offset, groupSimilar: false };
    const t = Date.now();
    const r = await board(body);
    const jobs = Array.isArray(r.json?.jobs) ? r.json.jobs : [];
    calls.push({ offset: body.offset, status: r.status, rows: jobs.length, ms: Date.now() - t, ignoredFilters: r.json?.ignoredFilters ?? null });
    if (r.status !== 200 || !jobs.length) {
      console.log(`call ${i + 1}: HTTP ${r.status}, ${jobs.length} rows: ${r.text}`);
      break;
    }
    for (const j of jobs) {
      if (typeof j?.id === "string" && j.id.startsWith("workday:") && typeof j.applyUrl === "string" && !cards.has(j.id)) {
        cards.set(j.id, { id: j.id, applyUrl: j.applyUrl });
      }
    }
    offset += jobs.length;
    if (r.json?.hasMore === false) break;
  }
  return { cards: [...cards.values()], calls };
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;

async function main() {
  const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i > 0 ? process.argv[i + 1] : null;
  };
  const from = arg("--from");
  const write = arg("--write");
  let cards;
  let calls = [];
  let measuredAt = new Date().toISOString();
  if (from) {
    const rec = JSON.parse(readFileSync(from, "utf8"));
    cards = rec.cards;
    measuredAt = rec.measuredAt;
    console.log(`replaying ${cards.length} cards recorded ${measuredAt} (no network)`);
  } else {
    const live = await readLive();
    cards = live.cards;
    calls = live.calls;
    for (const [i, c] of calls.entries()) {
      console.log(`call ${i + 1}: offset ${c.offset}, HTTP ${c.status}, ${c.rows} rows, ${c.ms} ms${c.ignoredFilters ? `, ignoredFilters ${JSON.stringify(c.ignoredFilters)}` : ""}`);
    }
  }
  const sites = new Set(cards.map((c) => c.id.split(":")[1]));
  const tenants = new Set(cards.map((c) => c.id.split(":")[1].split("~")[0]));
  const upperTenant = cards.filter((c) => /[A-Z]/.test(c.id.split(":")[1].split("~").slice(0, 2).join("~")));
  const notWorkdayHost = cards.filter((c) => !/\.myworkdayjobs\.com\//i.test(c.applyUrl));
  console.log(`cards: ${cards.length} distinct Workday ids, ${sites.size} careers sites, ${tenants.size} tenants`);
  console.log(`tokens whose tenant or data centre has a capital: ${upperTenant.length}; applyUrls not on myworkdayjobs.com: ${notWorkdayHost.length}`);
  const out = roundTrip(cards, (u) => {
    const r = parseJobLink(u, { workday: true });
    return r.kind === "words" ? null : r.id;
  });
  for (const [name, t] of Object.entries(out.counts)) {
    console.log(`  ${name.padEnd(14)} ${String(t.hit).padStart(4)}/${String(t.n).padEnd(4)} ${pct(out.rates[name])}`);
  }
  const lowest = Math.min(...Object.values(out.rates));
  const pass = cards.length >= WANT && lowest >= 0.98;
  console.log(`hit rate (parseJobLink(applyUrl) === id): ${pct(out.rates.exact)}; lowest of every form: ${pct(lowest)}`);
  console.log(`GATE (${WANT}+ cards, 98% on every form, F13): ${pass ? "PASS: the Workday reading may ship on" : `FAIL: keep WORKDAY_LINKS_READ false${cards.length < WANT ? ` (only ${cards.length} cards)` : ""}`}`);
  for (const m of out.misses.slice(0, 25)) console.log(`  miss [${m.form}] ${m.id} <- ${m.url} (read ${m.got})`);
  if (out.misses.length > 25) console.log(`  ... ${out.misses.length - 25} more misses`);
  if (write && !from) {
    writeFileSync(write, `${JSON.stringify({
      measuredAt,
      source: `job-board list {vendor: workday, limit ${PAGE}, groupSimilar false}, offsets ${calls.map((c) => c.offset).join(", ")}, x-rb-budget: probe; scripts/measure-job-link-roundtrip.mjs`,
      printed: `${cards.length} cards, ${sites.size} careers sites, ${tenants.size} tenants; ${Object.entries(out.counts).map(([k, t]) => `${k} ${t.hit}/${t.n}`).join(", ")}; lowest ${pct(lowest)}; gate ${pass ? "PASS" : "FAIL"}`,
      cards,
    }, null, 1)}\n`);
    console.log(`recorded ${cards.length} cards to ${write}`);
  }
  process.exitCode = pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
