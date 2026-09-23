#!/usr/bin/env node
/**
 * SETTLE THE SWEDEN NUMBER BEFORE ANY ADAPTER EXISTS.
 *
 * WHAT THIS IS. A read-only operator script. It pulls one JobStream window
 * from Arbetsformedlingen's open job-ad API and answers the single question
 * the owner's ruling turns on: how many Swedish ads would actually be LEFT
 * after the board suppressed the ones it already reads and the ones it cannot
 * link to an employer. It writes nothing anywhere -- no database, no board
 * action, no repo data file -- and it needs no key, because the register is
 * unauthenticated and its ads are CC0.
 *
 * WHERE THESE ADS COME FROM, IN PROSE, BECAUSE IT IS THE DECISION.
 * Every row this script reads is an advertisement held in Sweden's NATIONAL
 * EMPLOYMENT REGISTER. Arbetsformedlingen is a government agency; Platsbanken
 * is its statutory public register of vacancies; JobStream is the machine
 * channel onto that register. These ads are therefore read from a government
 * intermediary, NOT from the employer's own career page and NOT from an ATS
 * vendor's own public board API. That is a different thing from everything the
 * board carries today, and the difference is not legal -- the licence is CC0,
 * which is a stronger redistribution right than any vendor grant the board
 * relies on -- it is a difference of PROVENANCE.
 *
 * The catalogue file this script reads for suppression opens by promising that
 * every board it holds was verified against the ATS's own public job-board API,
 * published by the vendor for exactly that consumption. Publishing register ads
 * beside those postings would make that promise, and the site copy that repeats
 * it, false for part of the corpus. So shipping a Sweden adapter is not a code
 * decision that can be taken by whoever writes the adapter: the provenance
 * sentence on the site has to change FIRST, or the copy goes false the day the
 * first Swedish row lands. This script exists to put a real number in front of
 * that decision instead of an estimate, and to do it before anybody writes an
 * adapter whose shape (a firehose with removal events) does not fit the
 * per-token model the catalogue is built on.
 *
 * WHAT IT MEASURES.
 *   SUPPRESSION SET A  active rows whose apply URL resolves to an ATS tenant
 *                      the catalogue ALREADY carries. Matched on the ATS TOKEN
 *                      parsed out of application_details.url, never on the
 *                      employer name: Swedish legal names carry AB / Aktiebolag
 *                      / Sverige suffixes the catalogue does not, and exact name
 *                      matching was measured on 2026-09-22 to recover roughly
 *                      one duplicate in forty. Token matching found 117 rows on
 *                      one sample that name matching missed entirely.
 *   SUPPRESSION SET B  active rows with no application_details.url at all. They
 *                      have no employer-side landing page, so the only link the
 *                      board could print is the register's own page.
 *   30-DAY FENCE       the board's existing maxAgeDays rule, applied to the
 *                      register's own publication_date -- a company-stated
 *                      posting date, never a discovery stamp.
 *   RESIDUAL           active AND inside the fence AND in neither A nor B.
 *                      This is the number. If it is small, no adapter is worth
 *                      writing and the provenance question never has to be
 *                      asked.
 *
 * TWO READS, AND THE SECOND IS THE ANSWER. A stream window is a sample of ads
 * that CHANGED, so it leans young, and the suppression rate is not flat across
 * the fence -- on the oldest band of the 30-day window about a third of ads
 * carry no apply URL at all, against about a tenth on the youngest. Reading one
 * window and multiplying by the fenced total moves the answer by thousands of
 * ads. So --stock sizes each age band exactly, samples each band separately,
 * and combines them by population. Run the window read to see what the firehose
 * looks like; quote the stock read.
 *
 * HOW TO RUN IT.
 *   node scripts/sweden-jobtech-yield.mjs --stock             THE NUMBER
 *   node scripts/sweden-jobtech-yield.mjs                     one 24h window
 *   node scripts/sweden-jobtech-yield.mjs --hours 168         a wider window
 *   node scripts/sweden-jobtech-yield.mjs --save <file>       keep the payload
 *   node scripts/sweden-jobtech-yield.mjs --from <file>       re-read a payload
 *   node scripts/sweden-jobtech-yield.mjs --json <file>       machine-readable
 *   node scripts/sweden-jobtech-yield.mjs --rows <file>       per-row tuples
 * The payload for a 24h window is tens of megabytes. Save it OUTSIDE the repo.
 *
 * WHY JOBSTREAM AND NOT THE SEARCH API. The search endpoint caps limit at 100
 * and offset at 2000, so at most 2,100 ads are reachable per query and the
 * register cannot be walked by paging. JobStream is the only channel that
 * yields the whole population, and it is a firehose keyed on a timestamp: each
 * row carries a removed flag, so one window mixes live ads with takedowns.
 * Only rows that are not removed are counted anywhere below.
 *
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO. It does not classify employers as
 * staffing agencies or public sector. Those splits were estimated elsewhere
 * from a name vocabulary, and a name heuristic is exactly what this script was
 * written to stop standing in for a measurement.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/** The catalogue the board actually deploys. Parsed, never grepped. */
export const SOURCES_PATH = resolve(REPO, "supabase/functions/job-board/sources.ts");

/** The register's incremental channel. No auth, no key, no registration. */
export const JOBSTREAM_URL = "https://jobstream.api.jobtechdev.se/stream";

/**
 * The register's query channel. It cannot be walked -- limit caps at 100 and
 * offset at 2000, so 2,100 ads is all any single query will yield -- but it
 * answers two things the firehose cannot: the exact size of a date band, and a
 * sample drawn from ads that have not changed recently.
 */
export const JOBSEARCH_URL = "https://jobsearch.api.jobtechdev.se/search";

/**
 * Age bands for the stock read, in days before now.
 *
 * WHY BANDS AT ALL. A stream window is a sample of ads that CHANGED; it
 * over-represents the young end of the fence. That matters here because the
 * suppression rate is not flat across the fence: on the oldest band of the
 * 30-day window, roughly a third of ads carry no apply URL at all, against
 * roughly a tenth on the youngest. Reading one sample and multiplying it by the
 * fenced total would have moved the answer by thousands of ads. Each band is
 * sized exactly and sampled separately, and the bands are combined by
 * POPULATION, never by sample count.
 */
export const STOCK_BANDS = [
  [0, 6],
  [6, 12],
  [12, 18],
  [18, 24],
  [24, 30],
];

/** Ads sampled per band. The query channel caps a single query at 2,100. */
export const STOCK_SAMPLE_PER_BAND = 600;

/** Identify the caller to the agency rather than arriving anonymously. */
const USER_AGENT = "resumebooster.work research (campbellabbott@gmail.com)";

/** The board's existing posting-age fence, in days. */
export const DEFAULT_FENCE_DAYS = 30;

/**
 * The vendors whose apply URLs are worth parsing: every vendor the catalogue
 * carries whose tenant identity is recoverable from a public apply URL.
 * Ordered as the report prints them.
 */
export const PARSED_VENDORS = [
  "teamtailor",
  "smartrecruiters",
  "workday",
  "greenhouse",
  "lever",
  "recruitee",
  "breezy",
  "ashby",
  "oracle",
  "icims",
];

// ─────────────────────────────────────────────────────────────────────────────
// The catalogue reader.
//
// src/test/helpers/catalog.ts is the repo's one catalogue reader, but it is a
// TypeScript module that resolves its own path through __dirname and so cannot
// be loaded by a plain node script. Rather than let this script grep the file
// -- the failure this repo has already paid for, where four guards silently
// read 1% of a repacked catalogue -- it parses the same three entry forms here
// and a guard in src/test/ asserts, by set equality over every vendor, that
// what this parser sees is exactly what that reader sees. If the catalogue is
// repacked again, that guard goes red instead of this script going blind.
// ─────────────────────────────────────────────────────────────────────────────

const SIMPLE_ESCAPES = { n: "\n", t: "\t", r: "\r", v: "\v", b: "\b", f: "\f" };

/**
 * Blank out line and block comments, preserving every byte offset so the
 * positions a parse reports still line up with the raw file. String and
 * template literals are consumed whole first, so a slash-slash inside a token
 * never eats the rest of a line.
 */
export function stripTsComments(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out.push(c);
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out.push(src[i], src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out.push(src[i]);
        const closed = src[i] === quote;
        i++;
        if (closed) break;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const stop = nl === -1 ? src.length : nl;
      out.push(" ".repeat(stop - i));
      i = stop;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const stop = close === -1 ? src.length : close + 2;
      out.push(src.slice(i, stop).replace(/[^\n]/g, " "));
      i = stop;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

const fail = (message) => {
  throw new Error(`[sweden-jobtech-yield] ${message}`);
};

/** Decode a JS string-literal body the way the runtime would. */
function decodeStringBody(body) {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    const esc = body[i + 1];
    i += 2;
    if (esc === undefined) fail("string literal ends in a lone backslash");
    if (esc === "u") {
      if (body[i] === "{") {
        const close = body.indexOf("}", i);
        if (close === -1) fail("unterminated unicode escape");
        out += String.fromCodePoint(Number.parseInt(body.slice(i + 1, close), 16));
        i = close + 1;
        continue;
      }
      const hex = body.slice(i, i + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(`bad unicode escape "${hex}"`);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
      continue;
    }
    if (esc === "x") {
      const hex = body.slice(i, i + 2);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail(`bad hex escape "${hex}"`);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 2;
      continue;
    }
    if (esc === "\n") continue;
    if (esc === "\r") {
      if (body[i] === "\n") i++;
      continue;
    }
    if (esc === "0" && !/[0-9]/.test(body[i] ?? "")) {
      out += "\0";
      continue;
    }
    out += SIMPLE_ESCAPES[esc] ?? esc;
  }
  return out;
}

function readStringLiteral(src, start) {
  const quote = src[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    fail(`expected a string literal at offset ${start}`);
  }
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) return { value: decodeStringBody(src.slice(start + 1, i)), end: i + 1 };
    i++;
  }
  return fail(`unterminated string literal at offset ${start}`);
}

const skipSpace = (src, i) => {
  let j = i;
  while (j < src.length && /\s/.test(src[j])) j++;
  return j;
};

/**
 * A parse that returns a short list is worse than a parse that dies. The floor
 * sits far below the catalogue's real size so ordinary growth never trips it
 * and only a broken parse does.
 */
export const MIN_EXPECTED_BOARDS = 20_000;

/**
 * Every catalogue entry, in file order, as { name, source, token, host }.
 * Reads the packed spread form, the object-literal form and the legacy call
 * form; anything else throws rather than being skipped.
 */
export function parseCatalog(rawSource) {
  const code = stripTsComments(rawSource);

  const kindMatch = /export\s+type\s+JobSourceKind\s*=([\s\S]*?);/.exec(code);
  if (!kindMatch) fail("could not find the vendor union in the catalogue");
  const kinds = [...kindMatch[1].matchAll(/"([^"]+)"/g)].map((k) => k[1]);
  if (!kinds.length) fail("the vendor union parsed to zero vendors");

  const orderMatch = /\bconst\s+V\s*:\s*JobSourceKind\[\]\s*=\s*\[([\s\S]*?)\]/.exec(code);
  if (!orderMatch) fail("could not find the packed vendor index");
  const order = [...orderMatch[1].matchAll(/"([^"]+)"/g)].map((v) => v[1]);
  const unknown = order.filter((v) => !kinds.includes(v));
  if (unknown.length) fail(`packed vendor index names unknown vendors: ${unknown.join(", ")}`);

  const decl = /export\s+const\s+JOB_SOURCES\s*:[^=]*=\s*\[/.exec(code);
  if (!decl) fail("could not find the catalogue array");
  const open = decl.index + decl[0].length - 1;
  let depth = 1;
  let end = -1;
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      i = readStringLiteral(code, i).end - 1;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) fail("the catalogue array is never closed");

  const entries = [];
  let i = open + 1;
  while (i < end) {
    const c = code[i];
    if (/\s/.test(c) || c === ",") {
      i++;
      continue;
    }

    if (code.startsWith("...u(", i)) {
      const litStart = skipSpace(code, i + 5);
      const { value, end: litEnd } = readStringLiteral(code, litStart);
      for (const record of value.split("\n")) {
        const fields = record.split("");
        if (fields.length !== 3) {
          fail(`packed record has ${fields.length} fields, expected 3: ${JSON.stringify(record.slice(0, 80))}`);
        }
        const idx = Number(fields[1]);
        if (!Number.isInteger(idx) || idx < 0 || idx >= order.length) {
          fail(`packed record names vendor index ${JSON.stringify(fields[1])}`);
        }
        entries.push({ name: fields[0], source: order[idx], token: fields[2], host: null });
      }
      i = skipSpace(code, litEnd);
      if (code[i] !== ")") fail(`unterminated packed spread at offset ${i}`);
      i++;
      continue;
    }

    if (c === "{") {
      let d = 0;
      let j = i;
      while (j < end) {
        const ch = code[j];
        if (ch === '"' || ch === "'" || ch === "`") {
          j = readStringLiteral(code, j).end;
          continue;
        }
        if (ch === "{") d++;
        else if (ch === "}") {
          d--;
          if (d === 0) {
            j++;
            break;
          }
        }
        j++;
      }
      const objText = code.slice(i, j);
      const prop = (name) => {
        const m = new RegExp(`\\b${name}\\s*:\\s*(?=["'\`])`).exec(objText);
        return m ? readStringLiteral(objText, m.index + m[0].length).value : null;
      };
      const name = prop("name");
      const source = prop("source");
      const token = prop("token");
      if (name === null || source === null || token === null) {
        fail(`catalogue object is missing name, source or token: ${JSON.stringify(objText.slice(0, 120))}`);
      }
      if (!kinds.includes(source)) fail(`catalogue object names unknown vendor ${JSON.stringify(source)}`);
      entries.push({ name, source, token, host: prop("host") });
      i = j;
      continue;
    }

    const legacy = /^s\s*\(\s*(?=["'`])/.exec(code.slice(i, i + 8));
    if (legacy && !/[\w$.]/.test(code[i - 1] ?? "")) {
      let j = i + legacy[0].length;
      const parts = [];
      for (let f = 0; f < 3; f++) {
        j = skipSpace(code, j);
        const lit = readStringLiteral(code, j);
        parts.push(lit.value);
        j = skipSpace(code, lit.end);
        if (f < 2) {
          if (code[j] !== ",") fail(`legacy entry at offset ${i} has fewer than 3 arguments`);
          j++;
        }
      }
      if (code[j] !== ")") fail(`legacy entry at offset ${i} is not closed`);
      if (!kinds.includes(parts[1])) fail(`legacy entry names unknown vendor ${JSON.stringify(parts[1])}`);
      entries.push({ name: parts[0], source: parts[1], token: parts[2], host: null });
      i = j + 1;
      continue;
    }

    fail(
      `unrecognised element in the catalogue at offset ${i}: ` +
        `${JSON.stringify(code.slice(i, i + 100))}. Teach this parser the new entry form.`,
    );
  }

  if (entries.length < MIN_EXPECTED_BOARDS) {
    fail(
      `parsed only ${entries.length} boards, fewer than the ${MIN_EXPECTED_BOARDS} floor. ` +
        `A short parse means this reader has gone blind to an entry form. Fix the reader.`,
    );
  }
  return entries;
}

/** Public suffixes that push the registrable label one segment further left. */
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz",
  "com.br", "co.jp", "co.in", "com.mx", "co.za", "com.sg", "com.tr",
]);

/**
 * The registrable label of a hostname: the part that identifies the
 * organisation, with the public suffix and any leading subdomains removed.
 * `careers.publicisgroupe.com` and `jobs.publicisgroupe.com` both give
 * `publicisgroupe`.
 */
export function domainLabel(hostname) {
  if (typeof hostname !== "string" || hostname.trim() === "") return null;
  const parts = hostname.trim().toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length < 2) return null;
  const lastTwo = parts.slice(-2).join(".");
  const idx = TWO_PART_SUFFIXES.has(lastTwo) ? parts.length - 3 : parts.length - 2;
  return idx >= 0 ? parts[idx] : null;
}

/**
 * The suppression index: lowercased tokens per vendor, plus every hostname the
 * catalogue serves a board from. Tokens are compared case-insensitively because
 * several vendors mix case in the tenant id and a case miss would read as a
 * net-new row, which is the direction that flatters the proposal.
 *
 * iCIMS gets a third index. The catalogue keys iCIMS boards by the employer's
 * own career HOSTNAME, while an apply URL on the vendor's host carries the
 * tenant as a subdomain instead -- `careers.publicisgroupe.com` in the
 * catalogue against `careers-publicisgroupe.icims.com` in the register, the
 * same employer written two ways. Comparing the registrable domain LABEL
 * recovers those. It is the one place this file compares anything but an exact
 * token, it is confined to a single vendor, and it is counted separately so the
 * owner can subtract it.
 */
export function buildCatalogIndex(entries) {
  const tokensByVendor = new Map();
  const hosts = new Set();
  const icimsLabels = new Set();
  for (const e of entries) {
    if (!tokensByVendor.has(e.source)) tokensByVendor.set(e.source, new Set());
    tokensByVendor.get(e.source).add(e.token.toLowerCase());
    if (e.host) hosts.add(e.host.toLowerCase().replace(/^www\./, ""));
    // iCIMS tenants are catalogued by the employer's career HOSTNAME, so the
    // token doubles as a host for matching purposes.
    if (e.source === "icims" && e.token.includes(".")) {
      hosts.add(e.token.toLowerCase().replace(/^www\./, ""));
      const label = domainLabel(e.token);
      if (label) icimsLabels.add(label);
    }
  }
  return { tokensByVendor, hosts, icimsLabels, size: entries.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// The apply-URL parser. This is the part the unit test exists for: every rule
// below is a guess about a vendor's public URL shape until a real row or a real
// catalogue token proves it round-trips.
// ─────────────────────────────────────────────────────────────────────────────

/** Path segments, non-empty, un-decoded percent-escapes left alone. */
const segments = (pathname) => pathname.split("/").filter(Boolean);

/** A two-letter language segment, optionally with a region: en, en-US, sv-SE. */
const isLangSegment = (s) => /^[a-z]{2}([-_][A-Za-z]{2,4})?$/.test(s);

/**
 * Parse an ATS tenant out of an apply URL.
 *
 * Returns { host, vendor, token } where vendor and token are null when the URL
 * is a live page this parser does not recognise as one of the carried vendors
 * (the overwhelming majority of Swedish apply URLs: varbi, reachmee, visma
 * recruit, ponty and a long tail of employer-built forms). Returns null only
 * when there is no URL to parse at all.
 *
 * Nothing here looks at the employer's name. That is the point.
 */
export function parseAtsRef(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") return null;
  let u;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return { host: null, vendor: null, token: null, unparseable: true };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { host: null, vendor: null, token: null, unparseable: true };
  }
  const host = u.hostname.toLowerCase();
  const bare = host.replace(/^www\./, "");
  const seg = segments(u.pathname);
  const at = (n) => seg[n] ?? null;
  const hit = (vendor, token) =>
    token && token.length > 0 ? { host, vendor, token } : { host, vendor: null, token: null };

  // Teamtailor: the tenant is the subdomain. Custom domains carry no tenant at
  // all (the vendor rewrites every absolute URL), so they fall through to the
  // host check in classifyRow rather than being guessed at from the name.
  let m = /^([a-z0-9][a-z0-9-]*)\.teamtailor\.com$/.exec(host);
  if (m && m[1] !== "www") return hit("teamtailor", m[1]);

  // SmartRecruiters: jobs.smartrecruiters.com/<Tenant>/<id>, and the one-click
  // flow which hides the tenant one segment deeper.
  if (bare.endsWith("smartrecruiters.com")) {
    if (at(0) === "oneclick-ui" || at(0) === "publication") {
      const idx = seg.indexOf("company");
      if (idx >= 0) return hit("smartrecruiters", at(idx + 1));
    }
    const first = at(0);
    if (first && !isLangSegment(first)) return hit("smartrecruiters", first);
    return { host, vendor: null, token: null };
  }

  // Workday: <tenant>.wdN.myworkdayjobs.com/<lang?>/<site>/...
  m = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(host);
  if (m) {
    const rest = at(0) && isLangSegment(at(0)) ? seg.slice(1) : seg;
    const site = rest[0] ?? null;
    return hit("workday", site ? `${m[1]}~${m[2]}~${site}` : null);
  }

  // Greenhouse: the board host families, plus the embed form that carries the
  // tenant in a query parameter instead of the path.
  if (/(^|\.)greenhouse\.io$/.test(bare)) {
    const forParam = u.searchParams.get("for");
    if (forParam) return hit("greenhouse", forParam);
    const first = at(0);
    if (first === "embed") return { host, vendor: null, token: null };
    if (first) return hit("greenhouse", first);
    return { host, vendor: null, token: null };
  }

  // Lever: jobs.lever.co/<tenant>/<id>, and the EU host.
  if (/(^|\.)lever\.co$/.test(bare)) {
    const first = at(0);
    return hit("lever", first);
  }

  // Recruitee: the tenant is the subdomain.
  m = /^([a-z0-9][a-z0-9-]*)\.recruitee\.com$/.exec(host);
  if (m && m[1] !== "www" && m[1] !== "jobs" && m[1] !== "careers") return hit("recruitee", m[1]);

  // Breezy: the tenant is the subdomain.
  m = /^([a-z0-9][a-z0-9-]*)\.breezy\.hr$/.exec(host);
  if (m && m[1] !== "www" && m[1] !== "app") return hit("breezy", m[1]);

  // Ashby: jobs.ashbyhq.com/<tenant>/<id>.
  if (/(^|\.)ashbyhq\.com$/.test(bare)) {
    const first = at(0);
    return hit("ashby", first);
  }

  // Oracle Recruiting Cloud: <tenant>.fa.<region>.oraclecloud.<tld>, and the
  // site name sits after the "sites" segment of the candidate-experience path.
  // The EU data centres serve the same product from a different top-level
  // domain -- a real Swedish row proved that, and a com-only rule missed it.
  m = /^([a-z0-9-]+)\.fa\.([a-z0-9-]+)\.oraclecloud\.(?:com|eu)$/.exec(host);
  if (m) {
    const idx = seg.indexOf("sites");
    const site = idx >= 0 ? seg[idx + 1] ?? null : null;
    return hit("oracle", site ? `${m[1]}~${m[2]}~${site}` : null);
  }

  // iCIMS: the vendor host carries the tenant as a subdomain, but the
  // catalogue keys iCIMS boards by the employer's career hostname, so the host
  // check in classifyRow is what usually decides these.
  m = /^([a-z0-9][a-z0-9-]*)\.icims\.com$/.exec(host);
  if (m && m[1] !== "www") return hit("icims", m[1]);

  return { host, vendor: null, token: null };
}

/**
 * Ad rows out of a payload. JobStream answers with a bare array; the saved
 * sample wraps the same rows in an object that carries where they came from,
 * because a data file with no provenance is the start of every wrong number.
 */
export function loadRows(payload) {
  let parsed;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      // A truncated read of a 140 MB firehose is a normal network event and it
      // must not dump 140 MB of ads into the terminal on its way out. Say what
      // arrived and what it ended with, and stop.
      fail(
        `the payload is not valid JSON: ${err.message.slice(0, 120)}. ` +
          `${Buffer.byteLength(payload)} bytes arrived, ending ` +
          `${JSON.stringify(payload.slice(-60))} -- a truncated read. Re-run it.`,
      );
    }
  } else {
    parsed = payload;
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  return fail("payload is neither an array of ads nor an object carrying one");
}

/**
 * The per-row tuple the brief asks for: the identity fields, the parsed ATS
 * reference and the two dates that decide the fence.
 */
export function rowTuple(row) {
  const url = row?.application_details?.url ?? null;
  const ref = parseAtsRef(url);
  return {
    id: row?.id ?? null,
    organization_number: row?.employer?.organization_number ?? null,
    employer_name: row?.employer?.name ?? null,
    apply_url: url,
    ats_host: ref?.host ?? null,
    ats_vendor: ref?.vendor ?? null,
    ats_token: ref?.token ?? null,
    publication_date: row?.publication_date ?? null,
    source_type: row?.source_type ?? null,
    removed: row?.removed === true,
  };
}

/**
 * Decide, for one tuple, whether the catalogue already reads this tenant.
 * TOKEN first, then the hostname the catalogue serves a board from. Never the
 * employer name.
 */
export function carriedBy(tuple, index) {
  if (tuple.ats_vendor && tuple.ats_token) {
    const tokens = index.tokensByVendor.get(tuple.ats_vendor);
    if (tokens && tokens.has(tuple.ats_token.toLowerCase())) {
      return { carried: true, by: "token", vendor: tuple.ats_vendor };
    }
  }
  if (tuple.ats_host) {
    const bare = tuple.ats_host.replace(/^www\./, "");
    if (index.hosts.has(bare)) return { carried: true, by: "host", vendor: tuple.ats_vendor ?? "custom-domain" };
  }
  if (tuple.ats_vendor === "icims" && tuple.ats_token) {
    const label = tuple.ats_token.toLowerCase().replace(/^(?:careers?|jobs?)[-_.]/, "");
    if (label && index.icimsLabels?.has(label)) {
      return { carried: true, by: "icims-domain", vendor: "icims" };
    }
  }
  return { carried: false, by: null, vendor: null };
}

const pct = (n, d) => (d === 0 ? 0 : (n / d) * 100);

/**
 * The whole computation, as a pure function over tuples, so the test can run it
 * on a fixture without a network call.
 */
export function computeYield(tuples, index, { now = new Date(), fenceDays = DEFAULT_FENCE_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - fenceDays * 24 * 60 * 60 * 1000);
  const active = tuples.filter((t) => !t.removed);

  const setA = [];
  const setB = [];
  const byVendor = new Map();
  const byMatchKind = { token: 0, host: 0, "icims-domain": 0 };
  const inFence = [];
  const residual = [];
  const fenceA = [];
  const fenceB = [];
  const fenceBoth = [];

  for (const t of active) {
    const fresh = t.publication_date != null && new Date(t.publication_date) >= cutoff;
    const hasUrl = typeof t.apply_url === "string" && t.apply_url.trim() !== "";
    const { carried, by, vendor } = carriedBy(t, index);
    if (carried) {
      setA.push(t);
      byMatchKind[by] += 1;
      const key = vendor ?? "unknown";
      byVendor.set(key, (byVendor.get(key) ?? 0) + 1);
    }
    if (!hasUrl) setB.push(t);
    if (fresh) {
      inFence.push(t);
      if (carried) fenceA.push(t);
      if (!hasUrl) fenceB.push(t);
      if (carried && !hasUrl) fenceBoth.push(t);
      if (!carried && hasUrl) residual.push(t);
    }
  }

  const distinctOrgs = (rows) => new Set(rows.map((t) => t.organization_number).filter(Boolean)).size;
  const residualSet = new Set(residual);
  const suppressedInFence = inFence.filter((t) => !residualSet.has(t));

  return {
    catalogue_entries: index.size,
    rows_in_window: tuples.length,
    removed_rows: tuples.length - active.length,
    active_rows: active.length,
    fence_days: fenceDays,
    fence_cutoff: cutoff.toISOString(),
    set_a: {
      rows: setA.length,
      pct_of_active: pct(setA.length, active.length),
      by_match_kind: byMatchKind,
      by_vendor: Object.fromEntries([...byVendor].sort((x, y) => y[1] - x[1])),
    },
    set_b: {
      rows: setB.length,
      pct_of_active: pct(setB.length, active.length),
    },
    fence: {
      rows: inFence.length,
      pct_of_active: pct(inFence.length, active.length),
      distinct_orgs: distinctOrgs(inFence),
      // The two suppressions inside the fence, so this reads directly against
      // any overlap figure quoted for the fenced window alone.
      set_a_rows: fenceA.length,
      set_a_pct: pct(fenceA.length, inFence.length),
      set_b_rows: fenceB.length,
      set_b_pct: pct(fenceB.length, inFence.length),
      both_rows: fenceBoth.length,
    },
    suppressed_in_fence: {
      rows: suppressedInFence.length,
      pct_of_fence: pct(suppressedInFence.length, inFence.length),
    },
    residual: {
      rows: residual.length,
      pct_of_fence: pct(residual.length, inFence.length),
      pct_of_active: pct(residual.length, active.length),
      distinct_orgs: distinctOrgs(residual),
      // How the register got the ad. VIA_ANNONSERA rows were typed into the
      // agency's own form, so they exist nowhere else -- genuinely novel
      // inventory, and by the same fact the furthest from an employer career
      // page. Both halves of that matter to the ruling, so both are printed.
      by_source_type: (() => {
        const counts = new Map();
        for (const t of residual) counts.set(t.source_type ?? "unknown", (counts.get(t.source_type ?? "unknown") ?? 0) + 1);
        return Object.fromEntries([...counts].sort((x, y) => y[1] - x[1]));
      })(),
    },
    // Rows whose apply URL is a live page this parser cannot attribute to any
    // carried vendor. Some of them ARE carried boards served from an employer's
    // own hostname, and no URL rule can tell. They are why the residual is an
    // upper bound rather than an answer.
    unattributable: {
      rows: residual.filter((t) => t.ats_host && !t.ats_vendor).length,
      pct_of_residual: pct(residual.filter((t) => t.ats_host && !t.ats_vendor).length, residual.length),
    },
    unrecognised_hosts: (() => {
      const counts = new Map();
      for (const t of active) {
        if (!t.ats_host || t.ats_vendor) continue;
        counts.set(t.ats_host, (counts.get(t.ats_host) ?? 0) + 1);
      }
      return [...counts].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([host, n]) => ({ host, n }));
    })(),
  };
}

/**
 * Combine per-band measurements into one figure for the whole fenced stock.
 *
 * Pure, and separate from the fetching, because this is where the arithmetic
 * error lives: bands are sampled to the same depth but hold very different
 * numbers of ads, so the mean of the band rates is not the rate of the stock.
 * Every rate below is weighted by the band's measured POPULATION.
 */
export function weightedStock(bands) {
  let population = 0;
  let residual = 0;
  let setA = 0;
  let setB = 0;
  let sampled = 0;
  for (const b of bands) {
    if (!Number.isFinite(b.population) || b.population < 0) fail(`band ${b.label} has no measured population`);
    population += b.population;
    sampled += b.sampled;
    residual += (b.population * b.residual_pct) / 100;
    setA += (b.population * b.set_a_pct) / 100;
    setB += (b.population * b.set_b_pct) / 100;
  }
  return {
    bands,
    fenced_population: population,
    sampled_rows: sampled,
    set_a_pct: pct(setA, population),
    set_b_pct: pct(setB, population),
    residual_pct: pct(residual, population),
    residual_ads: Math.round(residual),
  };
}

const n = (x) => x.toLocaleString("en-US");
const p = (x) => `${x.toFixed(2)}%`;

export function formatReport(r, meta = {}) {
  const lines = [];
  lines.push("SWEDEN JOBTECH RESIDUAL YIELD");
  lines.push("  Source: Sweden's national employment register (Arbetsformedlingen / Platsbanken),");
  lines.push("  read through JobStream. NOT an employer career page and NOT an ATS vendor API.");
  if (meta.window_from) lines.push(`  Window from:        ${meta.window_from}`);
  if (meta.fetched_at) lines.push(`  Fetched at:         ${meta.fetched_at}`);
  if (meta.payload_bytes) lines.push(`  Payload bytes:      ${n(meta.payload_bytes)}`);
  lines.push(`  Catalogue entries:  ${n(r.catalogue_entries)}  (${SOURCES_PATH})`);
  lines.push("");
  lines.push(`  Rows in window:     ${n(r.rows_in_window)}`);
  lines.push(`  Removal events:     ${n(r.removed_rows)}  (excluded from every count below)`);
  lines.push(`  ACTIVE rows:        ${n(r.active_rows)}  = the denominator`);
  lines.push("");
  lines.push(`  SUPPRESSION SET A (apply URL resolves to a tenant the catalogue already reads)`);
  lines.push(`    rows              ${n(r.set_a.rows)}  ${p(r.set_a.pct_of_active)} of active`);
  lines.push(`    matched on token  ${n(r.set_a.by_match_kind.token)}`);
  lines.push(`    matched on host   ${n(r.set_a.by_match_kind.host)}  (catalogued custom domains and iCIMS career hosts)`);
  lines.push(`    matched on domain ${n(r.set_a.by_match_kind["icims-domain"])}  (iCIMS only: same employer domain written two ways; subtractable)`);
  for (const [vendor, count] of Object.entries(r.set_a.by_vendor)) {
    lines.push(`      ${vendor.padEnd(18)}${n(count)}`);
  }
  lines.push("");
  lines.push(`  SUPPRESSION SET B (no application_details.url -- nothing employer-side to link)`);
  lines.push(`    rows              ${n(r.set_b.rows)}  ${p(r.set_b.pct_of_active)} of active`);
  lines.push("");
  lines.push(`  30-DAY FENCE (publication_date within ${r.fence_days} days -- the register's own stated date)`);
  lines.push(`    cutoff            ${r.fence_cutoff}`);
  lines.push(`    rows              ${n(r.fence.rows)}  ${p(r.fence.pct_of_active)} of active`);
  lines.push(`    distinct orgs     ${n(r.fence.distinct_orgs)}`);
  lines.push(`    set A inside      ${n(r.fence.set_a_rows)}  ${p(r.fence.set_a_pct)} of fenced`);
  lines.push(`    set B inside      ${n(r.fence.set_b_rows)}  ${p(r.fence.set_b_pct)} of fenced`);
  lines.push(`    in both A and B   ${n(r.fence.both_rows)}`);
  lines.push(`    suppressed (A+B)  ${n(r.suppressed_in_fence.rows)}  ${p(r.suppressed_in_fence.pct_of_fence)} of fenced`);
  lines.push("");
  lines.push(`  RESIDUAL (active, inside the fence, in neither A nor B)`);
  lines.push(`    rows              ${n(r.residual.rows)}  ${p(r.residual.pct_of_fence)} of fenced, ${p(r.residual.pct_of_active)} of active`);
  lines.push(`    distinct orgs     ${n(r.residual.distinct_orgs)}`);
  for (const [kind, count] of Object.entries(r.residual.by_source_type)) {
    lines.push(`      ${kind.padEnd(18)}${n(count)}  ${p(pct(count, r.residual.rows))} of residual`);
  }
  lines.push("");
  lines.push(
    `    of which the apply host names no carried vendor: ${n(r.unattributable.rows)} ` +
      `(${p(r.unattributable.pct_of_residual)} of residual)`,
  );
  lines.push("    THE RESIDUAL IS AN UPPER BOUND. An ATS board served from the employer's own");
  lines.push("    hostname carries no tenant anywhere in the URL, so a board the catalogue");
  lines.push("    already reads can sit in that line and no URL rule can see it.");
  lines.push("");
  lines.push("  Top apply hosts this parser does not resolve to a carried vendor:");
  for (const { host, n: count } of r.unrecognised_hosts) {
    lines.push(`    ${String(count).padStart(6)}  ${host}`);
  }
  lines.push("");
  lines.push("  A residual share is a share of ONE WINDOW, not of the register. Scale it to the");
  lines.push("  register only against a separately measured fenced total, and say which is which.");
  return lines.join("\n");
}

export function formatStockReport(s, meta = {}) {
  const lines = [];
  lines.push("SWEDEN JOBTECH RESIDUAL YIELD -- STOCK READ, BY PUBLICATION-AGE BAND");
  lines.push("  Source: Sweden's national employment register (Arbetsformedlingen / Platsbanken).");
  lines.push("  Each band's size is counted exactly; each band's rates come from its own sample;");
  lines.push("  the bands are combined by POPULATION, never by sample count.");
  if (meta.measured_at) lines.push(`  Measured at:        ${meta.measured_at}`);
  if (meta.register_total) lines.push(`  Register total:     ${n(meta.register_total)} ads (all ages)`);
  lines.push("");
  lines.push("  band (days ago)   population   sampled   set A    set B    residual");
  for (const b of s.bands) {
    lines.push(
      `  ${b.label.padEnd(16)}${String(n(b.population)).padStart(10)}${String(n(b.sampled)).padStart(10)}` +
        `${p(b.set_a_pct).padStart(9)}${p(b.set_b_pct).padStart(9)}${p(b.residual_pct).padStart(12)}`,
    );
  }
  lines.push("");
  lines.push(`  FENCED POPULATION   ${n(s.fenced_population)} ads inside the 30-day fence`);
  lines.push(`  sampled             ${n(s.sampled_rows)} ads`);
  lines.push(`  SET A (carried)     ${p(s.set_a_pct)}`);
  lines.push(`  SET B (no url)      ${p(s.set_b_pct)}`);
  lines.push(`  RESIDUAL            ${p(s.residual_pct)}  =  ${n(s.residual_ads)} ads`);
  lines.push("");
  lines.push("  The residual is an UPPER bound: an ATS board served from an employer's own");
  lines.push("  hostname carries no tenant in its URL, so some of these are boards already read.");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator entry point.
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flagValue = (name, dflt = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};

/** The one place this file touches the network. Every read goes through here. */
async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) fail(`${url} answered HTTP ${res.status}`);
  return res.text();
}
const getJson = async (url) => JSON.parse(await getText(url));

/** An ISO timestamp the register's query parameters accept, N days back. */
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "");

/** Read the fenced stock band by band and combine it. */
export async function readStock({ bands = STOCK_BANDS, perBand = STOCK_SAMPLE_PER_BAND, index } = {}) {
  const head = await getJson(`${JOBSEARCH_URL}?limit=1`);
  const measured = [];
  for (const [young, old] of bands) {
    const q = `published-after=${daysAgo(old)}&published-before=${daysAgo(young)}`;
    const sized = await getJson(`${JOBSEARCH_URL}?limit=0&${q}`);
    const rows = [];
    for (let offset = 0; offset < perBand; offset += 100) {
      const page = await getJson(`${JOBSEARCH_URL}?limit=100&offset=${offset}&${q}`);
      rows.push(...page.hits);
      if (page.hits.length < 100) break;
    }
    // The band IS the fence for its own rows, so the age rule is already
    // satisfied by the query; a second cut here would double-count it.
    const y = computeYield(rows.map(rowTuple), index, { fenceDays: 36_500 });
    measured.push({
      label: `${old}-${young}d`,
      population: sized.total.value,
      sampled: y.active_rows,
      set_a_pct: y.set_a.pct_of_active,
      set_b_pct: y.set_b.pct_of_active,
      residual_pct: y.residual.pct_of_fence,
    });
  }
  return { stock: weightedStock(measured), register_total: head.total.value, measured_at: new Date().toISOString() };
}

export async function main() {
  const hours = Number(flagValue("--hours", "24"));
  const fenceDays = Number(flagValue("--fence-days", String(DEFAULT_FENCE_DAYS)));
  const fromFile = flagValue("--from", null);
  const saveFile = flagValue("--save", null);
  const jsonFile = flagValue("--json", null);
  const rowsFile = flagValue("--rows", null);

  const index = buildCatalogIndex(parseCatalog(readFileSync(SOURCES_PATH, "utf8")));

  if (args.includes("--stock")) {
    const { stock, register_total, measured_at } = await readStock({ index });
    process.stdout.write(`${formatStockReport(stock, { register_total, measured_at })}\n`);
    if (jsonFile) writeFileSync(jsonFile, JSON.stringify({ register_total, measured_at, stock }, null, 1));
    return;
  }

  const meta = {};
  let payload;
  if (fromFile) {
    payload = readFileSync(fromFile, "utf8");
    meta.window_from = `(replayed from ${fromFile})`;
  } else {
    const from = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "");
    const url = `${JOBSTREAM_URL}?date=${from}`;
    meta.window_from = from;
    process.stderr.write(`[sweden-jobtech-yield] GET ${url}\n`);
    payload = await getText(url);
    meta.fetched_at = new Date().toISOString();
    if (saveFile) writeFileSync(saveFile, payload);
  }
  meta.payload_bytes = Buffer.byteLength(payload);

  const tuples = loadRows(payload).map(rowTuple);
  const report = computeYield(tuples, index, { fenceDays });

  process.stdout.write(`${formatReport(report, meta)}\n`);
  if (jsonFile) writeFileSync(jsonFile, JSON.stringify({ meta, report }, null, 1));
  if (rowsFile) writeFileSync(rowsFile, JSON.stringify(tuples, null, 1));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
