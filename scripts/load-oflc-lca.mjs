// THE CERTIFIED WAGE CELLS, READ FROM THE DISCLOSURE FILE AND WRITTEN NOWHERE.
//
// (No shebang, on purpose -- the same reason scripts/layoff-board-names-mirror.mjs
// carries none: vite hoists an import helper above line 1 of a module that uses
// import(), and a shebang there breaks the vitest that imports this file.)
//
// WHAT THIS IS. The US Department of Labor's Office of Foreign Labor
// Certification publishes one xlsx per fiscal quarter listing every Labor
// Condition Application it decided -- the H-1B programme's filed pay, per
// employer, per SOC occupation, per worksite state. Measured 2026-09-22:
//
//   https://www.dol.gov/media/LCA_Disclosure_Data_FY2026_Q3.xlsx
//   HTTP 200, no auth, 251,850,891 bytes, quarterly, ~5-week publication lag.
//   1,032,735 sheet rows, 437,496 of them carrying data (the rest is empty
//   padding the generator leaves behind). 401,412 rows whose CASE_STATUS
//   EQUALS 'Certified'.
//
// THE EQUALITY. CASE_STATUS is matched by EQUALITY and never by prefix. A
// startsWith('Certified') test silently adds the 26,303 rows whose status is
// 'Certified - Withdrawn' -- an application the employer pulled after it was
// certified, which is not a wage the employer stands behind. This is the same
// defect class as the read-quality-by-EQUALITY rule in the actively-hiring
// verdict, and it is guarded in
// src/test/a-certified-status-is-an-equality-not-a-prefix.test.ts.
//
// THE WAGE IS FILED, NEVER DERIVED, AND THAT IS WHY A CELL IS ANNUAL. Every
// row carries a WAGE_UNIT_OF_PAY, and the units are not equivalent statements
// of one number: only the yearly ones state a year. Measured over the 14,230
// certified rows this join matches (2026-09-22): Year 13,185, Hour 1,021,
// Week 11, Month 7, Bi-Weekly 6. Multiplying an hourly figure by 2,080 does
// not read a yearly wage out of the file, it assumes a full-time schedule the
// filing never states -- and the repository already wrote that rule down for
// the identical arithmetic, in the structured salary parser: an hourly, daily
// or weekly rate is LOAD-DEPENDENT, and the honest behaviour is to REFUSE the
// annual figure rather than guess a load. A single cell mixing the two would
// be worse still: one range whose floor was filed and whose ceiling we
// invented, printed under copy that says "filed".
//
// So a row is kept only where the unit IS yearly. The other 1,045 -- 7.3% of
// the matched population -- are HELD and COUNTED under their own name in the
// run summary, never folded into the missing-wage counter and never converted.
// The cost is stated rather than hidden: those employers' cells are thinner or
// absent, which is the recoverable error.
//
// THE JOIN IS THE FILINGS MATCHER'S, NOT A SECOND ONE. An employer name
// reaches a board token exactly the way a layoff filing does: normalised by
// the one normaliser (keyNorm, imported from the layoff-filings function --
// never re-implemented here), compared for EQUALITY against the mirrored
// board display names under the >=2-token rule, and refused unless the names
// that match belong to exactly ONE employer. The mirror rows come from the
// same module the deploy and the mirror script use (mirror-rows.ts) over the
// same catalogue and the same alias ledger (job-board/employer-aliases.ts),
// so there is one matcher and one alias ledger for filings and for LCAs.
//
// Measured under that rule: 1,460 board tokens (3.31% of the catalogue) match
// on the catalogue names alone, 1,504 (3.41%) once the alias file's facet
// names are included -- and it is the alias side that picks up General Motors
// (607 rows), Applied Materials (474) and Palo Alto Networks (433).
//
// THE PARITY GATE. keyNorm and public.layoff_norm are two implementations of
// one rule, and over today's catalogue they agree on 43,391 of 43,423 distinct
// names and disagree on 32 -- every one of them a name carrying a character
// outside ASCII (a ligature, a trademark sign, a superscript digit, a
// Vietnamese or Turkish letter the SQL fold table does not list). A name whose
// two normalisations differ could be joined to the wrong employer, so a name
// that is not plain ASCII after trimming is HELD and COUNTED on both sides of
// the join and never matched. The parity test measures the claim rather than
// asserting it:
// src/test/the-employer-name-normaliser-is-one-rule-in-two-runtimes.test.ts.
//
// WHAT IT WRITES. Files. Nothing else. This script never opens a database
// connection, never uses a service-role key, never calls a board action. It
// emits the rows a later operator step hands to public.oflc_lca_wages_load,
// and prints a summary whose every number names what it counted.
//
// LICENCE. dol.gov/general/aboutdol/copyright: the data is a work of the US
// government, public domain, redistributable. Two obligations we carry into
// the copy: the source is named on every surface that prints a number from
// it, and nothing may imply that DOL endorses this site.
//
// USAGE
//   node scripts/load-oflc-lca.mjs --file LCA_Disclosure_Data_FY2026_Q3.xlsx \
//        --published 2026-08-25 --out lca-rows.json
//   --file <path>        the downloaded xlsx (REQUIRED; this script does not fetch)
//   --published <date>   the file's publication date, YYYY-MM-DD (REQUIRED:
//                        it is not in the file, and a figure with no basis
//                        does not ship)
//   --quarter "FY2026 Q3"  overrides the quarter read from the file name
//   --url <url>          the source URL stored with every row (default: the
//                        measured dol.gov media URL for the quarter)
//   --visa H-1B          keep only these VISA_CLASS values (repeatable);
//                        omitted, every class in the LCA file is kept, which
//                        is what the 401,412 measurement counted
//   --no-facet-names     leave the alias file's facet spellings out of the
//                        mirror (drops the ~44 tokens the alias side adds)
//   --out <path>         write the rows as JSON (default: stdout summary only)
//   --sample <n>         stop after n data rows (a smoke run over the real file)
//
// MEMORY. The sheet XML is ~1.6 GB uncompressed. Nothing here inflates it:
// the entry is streamed through zlib.createInflateRaw and cut into rows as the
// bytes arrive. The shared-string table is the one structure held whole, and
// it is the reason a run wants a few hundred MB of heap.

import { createReadStream } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/** Require TypeScript modules through tsx for the duration of one call. Not reached under vitest
 *  (tsx's esbuild refuses that environment) and not reached on a node that strips types itself. */
function withTsx(fn) {
  const require = createRequire(`${REPO}/package.json`);
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  try {
    return fn(require);
  } finally {
    unregister();
  }
}

/** The ONE normaliser, the layoff-filings function's own module. Imported natively where node strips
 *  types (22.18+ / 23.6+; the repo runs 25) and under vitest, which transforms it; through tsx on a
 *  node that refuses a .ts import (20, the CI pin). Never re-implemented in this file. */
async function loadNormalizer() {
  const rel = "../supabase/functions/layoff-filings/normalize.ts";
  try {
    return await import(rel);
  } catch (e) {
    if (e?.code !== "ERR_UNKNOWN_FILE_EXTENSION") throw e;
    return withTsx((require) => require(resolve(REPO, "supabase/functions/layoff-filings/normalize.ts")));
  }
}

const { keyNorm } = await loadNormalizer();

// ── the parity gate ────────────────────────────────────────────────────────

/**
 * Is this name one the two normalisers provably strip the same way?
 *
 * keyNorm folds with NFKD (which decomposes superscripts and ligatures) and
 * public.layoff_norm folds with a translate() table (which does not). On plain
 * ASCII both fold passes are no-ops and every later step is the same rule, so
 * the two agree. Off ASCII they can differ, and a name normalised one way on
 * our side and another way in the mirror is a name that can reach the wrong
 * employer. Those are held and counted, never guessed at.
 *
 * The string must also be its own trim: keyNorm's trailing-state-tag pattern
 * tolerates trailing whitespace and the SQL's does not, which is a divergence
 * on pure ASCII.
 */
export function isParitySafe(raw) {
  if (typeof raw !== "string") return false;
  if (raw !== raw.trim()) return false;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) > 127) return false;
  return true;
}

/** The employer name as the matcher compares it, or null when the parity gate holds it. */
export function normEmployer(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "" || !isParitySafe(s)) return null;
  return keyNorm(s);
}

// ── the >=2-token rule and the one-employer rule ───────────────────────────

/** A normalised name is comparable only when it has two or more tokens of two or more characters --
 *  a possessive "s" and a dotted "com" are punctuation, not words (Kohl's, Macy's, Amazon.com are
 *  single-word brands). Mirrors the token floor in the layoff matcher. */
export function hasTwoRealTokens(norm) {
  if (typeof norm !== "string" || norm === "") return false;
  let n = 0;
  for (const t of norm.split(" ")) if (t.length >= 2 && ++n >= 2) return true;
  return false;
}

/** The vendor path segments under which a token's FIRST segment names the vendor, not the employer.
 *  Mirrored from the layoff matcher; the guard reads both sides rather than trusting this copy. */
export const VENDOR_PATH_SEGMENTS = ["recruiting", "recruiting2"];
/** ...and the segment under which the whole token is the employer key (the EU pods). */
export const WHOLE_TOKEN_SEGMENT = "eu";

/** Who is ONE employer: the token's first '~' segment, except where that segment is a vendor path
 *  every client shares (UKG's two recruiting pods take the client segment too) or an EU pod (where
 *  the whole token is the key). Two clients of one vendor must never count as one employer. */
export function employerKey(token) {
  const first = token.split("~")[0];
  if (VENDOR_PATH_SEGMENTS.includes(first)) return `${first}~${token.split("~")[1] ?? ""}`;
  if (first === WHOLE_TOKEN_SEGMENT) return token;
  return first;
}

/**
 * The mirrored board names indexed by their normalised spelling.
 *
 * display_norm is computed HERE with the same keyNorm the employer side uses,
 * and a board name the parity gate holds is left out of the index entirely --
 * so a held name can neither match nor make another name ambiguous. Held names
 * are counted, because a silent drop is how a matcher goes blind.
 */
export function indexMirror(rows) {
  const byNorm = new Map();
  let heldNonAscii = 0;
  for (const r of rows) {
    const norm = normEmployer(r.display_name);
    if (norm === null) { heldNonAscii += 1; continue; }
    if (norm === "" || !hasTwoRealTokens(norm)) continue;
    let e = byNorm.get(norm);
    if (!e) { e = { tokens: new Set(), employers: new Set() }; byNorm.set(norm, e); }
    e.tokens.add(r.company_token);
    e.employers.add(employerKey(r.company_token));
  }
  return { byNorm, heldNonAscii, names: rows.length };
}

/**
 * The tokens an employer name joins to, or a refusal that says why.
 * Returns { tokens: string[] } on a match, or { refused: reason } -- the same
 * three refusals the layoff matcher counts: a name the parity gate holds, a
 * name below the token floor, a name that resolves to more than one employer,
 * and a name no board carries.
 */
export function matchEmployer(rawName, index) {
  const norm = normEmployer(rawName);
  if (norm === null) return { refused: "held_non_ascii" };
  if (norm === "") return { refused: "empty" };
  if (!hasTwoRealTokens(norm)) return { refused: "single_token" };
  const e = index.byNorm.get(norm);
  if (!e) return { refused: "unmatched" };
  if (e.employers.size !== 1) return { refused: "ambiguous" };
  return { tokens: [...e.tokens].sort(), norm };
}

// ── the file's own vocabulary ──────────────────────────────────────────────

/** The one status a wage cell may be built from, matched by EQUALITY. */
export const CERTIFIED = "Certified";

/** True only for the exact status. 'Certified - Withdrawn' is a different decision and is refused. */
export function isCertified(status) {
  return status === CERTIFIED;
}

/** The only unit this loader will build an annual cell from, matched the way the file spells it. */
export const ANNUAL_UNITS = ["year", "yr"];

/**
 * Was this wage FILED as a yearly figure?
 *
 * The one comparison that keeps a derived number out of a cell labelled as filed. See the header:
 * every other unit in the file is load-dependent, and multiplying it by an assumed schedule
 * invents the schedule. A row that is not yearly is held and counted, never converted.
 */
export function isAnnualUnit(unit) {
  return ANNUAL_UNITS.includes(String(unit ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-"));
}

/**
 * The yearly figure the employer filed, or null.
 *
 * Null for a unit that is not yearly -- there is no multiplier here and no table of them, because
 * a table is the thing that makes the conversion look like a reading. Null also for an amount that
 * is not a positive finite number or that lands outside the range a filed annual wage can occupy.
 */
export function filedAnnualWage(amount, unit) {
  if (!isAnnualUnit(unit)) return null;
  const n = typeof amount === "number" ? amount : Number(String(amount ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1 && n <= 100_000_000 ? Math.round(n * 100) / 100 : null;
}

/** '15-1252.00' / '151252' / '15-1252' to the seven-character form, or null when it is not a SOC code. */
export function socCode(raw) {
  const s = String(raw ?? "").trim();
  let m = /^(\d{2})-?(\d{4})(?:\.\d{2})?$/.exec(s);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** A two-letter US state/territory code, uppercased, or null. */
export function stateCode(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** The header names this loader accepts for each field it needs; the first present one wins.
 *  A REQUIRED field with no column present stops the run -- a loader that silently reads zero
 *  rows of a column reports an honest-looking zero. */
export const COLUMNS = {
  caseStatus: { required: true, names: ["CASE_STATUS"] },
  employer: { required: true, names: ["EMPLOYER_NAME", "EMPLOYER_BUSINESS_DBA"] },
  soc: { required: true, names: ["SOC_CODE"] },
  wageFrom: { required: true, names: ["WAGE_RATE_OF_PAY_FROM", "WAGE_RATE_OF_PAY_FROM_1"] },
  wageUnit: { required: true, names: ["WAGE_UNIT_OF_PAY", "WAGE_UNIT_OF_PAY_1"] },
  state: { required: true, names: ["WORKSITE_STATE", "WORKSITE_STATE_1", "EMPLOYER_STATE"] },
  wageTo: { required: false, names: ["WAGE_RATE_OF_PAY_TO", "WAGE_RATE_OF_PAY_TO_1"] },
  socTitle: { required: false, names: ["SOC_TITLE"] },
  visaClass: { required: false, names: ["VISA_CLASS"] },
};

/** Resolve the header row to column indexes. Throws, by name, on a missing required column. */
export function resolveColumns(header) {
  const at = new Map();
  header.forEach((h, i) => {
    const k = String(h ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    if (k !== "" && !at.has(k)) at.set(k, i);
  });
  const out = {};
  const missing = [];
  for (const [field, spec] of Object.entries(COLUMNS)) {
    const found = spec.names.find((n) => at.has(n));
    if (found === undefined) {
      out[field] = -1;
      if (spec.required) missing.push(`${field} (one of ${spec.names.join(", ")})`);
    } else {
      out[field] = at.get(found);
    }
  }
  if (missing.length > 0) {
    throw new Error(`the sheet is missing required column(s): ${missing.join("; ")} -- header was ${header.slice(0, 12).join(" | ")}...`);
  }
  return out;
}

// ── the accumulator ────────────────────────────────────────────────────────

/** A fresh accumulation over (company_token, soc_code, worksite_state). */
export function newCells() {
  return { byKey: new Map(), kept: 0 };
}

const CELL_SEP = "";

/** Fold one certified, matched, yearly-filed row into its cell. */
export function addCell(cells, { token, soc, state, socTitle, lowAnnual, highAnnual }) {
  const key = [token, soc, state].join(CELL_SEP);
  let c = cells.byKey.get(key);
  if (!c) {
    c = { company_token: token, soc_code: soc, worksite_state: state, soc_title: socTitle ?? null, lows: [], low: Infinity, high: 0, n: 0 };
    cells.byKey.set(key, c);
  }
  if (c.soc_title == null && socTitle) c.soc_title = socTitle;
  c.lows.push(lowAnnual);
  if (lowAnnual < c.low) c.low = lowAnnual;
  if (highAnnual > c.high) c.high = highAnnual;
  c.n += 1;
  cells.kept += 1;
  return c;
}

/** The median of a numeric list, to the cent. */
export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  const m = v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return Math.round(m * 100) / 100;
}

/** The cells as the writer takes them: one row per (token, soc, state), each carrying the file it
 *  came from and that file's publication date, because a number with no basis does not ship. */
export function finishCells(cells, { sourceFile, sourceUrl, fiscalQuarter, publishedOn }) {
  const rows = [];
  for (const c of cells.byKey.values()) {
    rows.push({
      company_token: c.company_token,
      soc_code: c.soc_code,
      worksite_state: c.worksite_state,
      soc_title: c.soc_title,
      wage_low_annual: Math.round(c.low * 100) / 100,
      wage_high_annual: Math.round(Math.max(c.high, c.low) * 100) / 100,
      wage_median_annual: median(c.lows),
      filings_n: c.n,
      source_file: sourceFile,
      source_url: sourceUrl,
      fiscal_quarter: fiscalQuarter,
      published_on: publishedOn,
    });
  }
  rows.sort((a, b) =>
    a.company_token.localeCompare(b.company_token) || a.soc_code.localeCompare(b.soc_code) || a.worksite_state.localeCompare(b.worksite_state));
  return rows;
}

// ── the zip reader (streaming; nothing is inflated whole) ──────────────────

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;

/** Read the central directory of a zip without inflating anything: the tail, then the directory. */
export async function readZipDirectory(path) {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 66_560);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`${basename(path)} is not a zip archive (no end-of-central-directory record)`);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    let cdSize = tail.readUInt32LE(eocd + 12);
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      let loc = -1;
      for (let i = eocd - 20; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD64_LOC_SIG) { loc = i; break; }
      if (loc < 0) throw new Error("zip64 archive without a zip64 locator");
      const z64At = Number(tail.readBigUInt64LE(loc + 8));
      const z64 = Buffer.alloc(56);
      await fh.read(z64, 0, 56, z64At);
      if (z64.readUInt32LE(0) !== EOCD64_SIG) throw new Error("zip64 locator does not point at a zip64 record");
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = new Map();
    let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === CEN_SIG) {
      const method = cd.readUInt16LE(p + 10);
      let compressed = cd.readUInt32LE(p + 20);
      let uncompressed = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) {
        let q = p + 46 + nameLen;
        const end = q + extraLen;
        while (q + 4 <= end) {
          const id = cd.readUInt16LE(q);
          const len = cd.readUInt16LE(q + 2);
          if (id === 0x0001) {
            let r = q + 4;
            if (uncompressed === 0xffffffff) { uncompressed = Number(cd.readBigUInt64LE(r)); r += 8; }
            if (compressed === 0xffffffff) { compressed = Number(cd.readBigUInt64LE(r)); r += 8; }
            if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(r)); r += 8; }
          }
          q += 4 + len;
        }
      }
      entries.set(name, { name, method, compressed, uncompressed, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** The bytes of one zip entry, inflated as they arrive. The 1.6 GB sheet never exists in memory. */
export async function* streamZipEntry(path, entry) {
  const fh = await open(path, "r");
  let header;
  try {
    header = Buffer.alloc(30);
    await fh.read(header, 0, 30, entry.localOffset);
  } finally {
    await fh.close();
  }
  const nameLen = header.readUInt16LE(26);
  const extraLen = header.readUInt16LE(28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const raw = createReadStream(path, { start, end: start + entry.compressed - 1, highWaterMark: 1 << 20 });
  if (entry.method === 0) {
    yield* raw;
    return;
  }
  if (entry.method !== 8) throw new Error(`${entry.name} uses compression method ${entry.method}; only store and deflate are read here`);
  yield* raw.pipe(createInflateRaw());
}

// ── the xml readers (streaming; one row at a time) ─────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text to a JS string: the five named entities and numeric references. */
export function unescapeXml(s) {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/**
 * Cut a byte stream into the chunks between an opening tag and its close.
 *
 * The buffer only ever holds the tail after the last complete element, so a
 * 1.6 GB sheet costs one row of memory at a time. A decoder joins the chunks
 * because a UTF-8 character can straddle a chunk boundary, and the character
 * after the tag name must be a delimiter so that looking for <row never opens
 * on <rowBreaks -- an element whose close tag never arrives makes the buffer
 * grow without bound, which is how a streaming reader turns into a full load.
 */
async function* elements(byteStream, tag) {
  const { StringDecoder } = await import("node:string_decoder");
  const decoder = new StringDecoder("utf8");
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let buf = "";
  for await (const chunk of byteStream) {
    buf += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let from = 0;
    for (;;) {
      let s = buf.indexOf(open, from);
      while (s >= 0 && !(s + open.length < buf.length && /[\s/>]/.test(buf[s + open.length]))) {
        if (s + open.length >= buf.length) break;
        s = buf.indexOf(open, s + 1);
      }
      if (s < 0 || s + open.length >= buf.length) break;
      const tagEnd = buf.indexOf(">", s);
      if (tagEnd < 0) break;
      if (buf[tagEnd - 1] === "/") { yield buf.slice(s, tagEnd + 1); from = tagEnd + 1; continue; }
      const e = buf.indexOf(close, tagEnd);
      if (e < 0) break;
      yield buf.slice(s, e + close.length);
      from = e + close.length;
    }
    buf = buf.slice(from);
  }
}

/** The shared-string table, in order. The one structure this loader holds whole. */
export async function readSharedStrings(byteStream) {
  const out = [];
  for await (const si of elements(byteStream, "si")) {
    let text = "";
    for (const m of si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += unescapeXml(m[1]);
    out.push(text);
  }
  return out;
}

/** 'BC' to 1-based 55. */
export function colIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
}

/** One sheet row as an array of strings, nulls where the cell is empty. */
export function parseRow(xml, shared) {
  const cells = [];
  let widest = 0;
  for (const m of xml.matchAll(/<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const rAttr = /\sr="([A-Z]+)\d+"/.exec(attrs);
    const t = /\st="([^"]+)"/.exec(attrs)?.[1] ?? "n";
    const at = rAttr ? colIndex(rAttr[1]) : widest + 1;
    widest = Math.max(widest, at);
    let value = null;
    if (t === "inlineStr") {
      let s = "";
      for (const tm of inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += unescapeXml(tm[1]);
      value = s;
    } else {
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (v !== undefined) {
        if (t === "s") {
          const idx = Number(v);
          value = shared[idx] ?? "";
        } else {
          value = unescapeXml(v);
        }
      }
    }
    cells[at - 1] = value ?? null;
  }
  for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
  return cells;
}

/** Every <row> of the sheet, as arrays. */
export async function* streamSheetRows(byteStream, shared) {
  for await (const xml of elements(byteStream, "row")) yield parseRow(xml, shared);
}

// ── the run ────────────────────────────────────────────────────────────────

/** 'LCA_Disclosure_Data_FY2026_Q3.xlsx' to 'FY2026 Q3'. */
export function quarterFromFileName(name) {
  const m = /FY(\d{4})[_ -]?Q([1-4])/i.exec(basename(String(name ?? "")));
  return m ? `FY${m[1]} Q${m[2]}` : null;
}

/** The measured publication URL for a quarter, as the file names it. */
export function defaultSourceUrl(fileName) {
  return `https://www.dol.gov/media/${basename(String(fileName))}`;
}

/**
 * Read one disclosure file into wage cells. Pure of the database and of the
 * network: it takes a local path and an already-built mirror index.
 */
export async function loadDisclosureFile({ file, index, sourceUrl, fiscalQuarter, publishedOn, visaClasses = null, sample = 0, onProgress = null }) {
  const entries = await readZipDirectory(file);
  const sheetName = [...entries.keys()].find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
    ?? [...entries.keys()].find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n));
  if (!sheetName) throw new Error(`${basename(file)} carries no worksheet XML`);
  const sharedEntry = [...entries.keys()].find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
  const shared = sharedEntry ? await readSharedStrings(streamZipEntry(file, entries.get(sharedEntry))) : [];

  const counts = {
    sheetRows: 0, dataRows: 0, certified: 0, notCertified: 0, certifiedWithdrawnPrefix: 0,
    visaFiltered: 0, heldNonAsciiEmployer: 0, refusedSingleToken: 0, refusedAmbiguous: 0,
    unmatchedEmployer: 0, heldNoWage: 0, heldNonAnnualUnit: 0, heldNoSoc: 0, heldNoState: 0,
    matchedRows: 0, cellWrites: 0,
  };
  const cells = newCells();
  let cols = null;
  const matchedTokens = new Set();

  for await (const row of streamSheetRows(streamZipEntry(file, entries.get(sheetName)), shared)) {
    counts.sheetRows += 1;
    const any = row.some((c) => c !== null && c !== "");
    if (!any) continue;
    if (cols === null) { cols = resolveColumns(row); continue; }
    counts.dataRows += 1;
    if (onProgress && counts.dataRows % 50_000 === 0) onProgress(counts);

    const status = row[cols.caseStatus];
    if (!isCertified(status)) {
      counts.notCertified += 1;
      // Counted, not kept: the prefix a startsWith test would have swept in.
      if (typeof status === "string" && status !== CERTIFIED && status.startsWith(CERTIFIED)) counts.certifiedWithdrawnPrefix += 1;
      continue;
    }
    counts.certified += 1;
    if (visaClasses && cols.visaClass >= 0 && !visaClasses.includes(String(row[cols.visaClass] ?? "").trim())) { counts.visaFiltered += 1; continue; }

    const m = matchEmployer(row[cols.employer], index);
    if (m.refused) {
      if (m.refused === "held_non_ascii") counts.heldNonAsciiEmployer += 1;
      else if (m.refused === "single_token" || m.refused === "empty") counts.refusedSingleToken += 1;
      else if (m.refused === "ambiguous") counts.refusedAmbiguous += 1;
      else counts.unmatchedEmployer += 1;
      continue;
    }
    const soc = socCode(row[cols.soc]);
    if (!soc) { counts.heldNoSoc += 1; continue; }
    const state = stateCode(row[cols.state]);
    if (!state) { counts.heldNoState += 1; continue; }
    const unit = row[cols.wageUnit];
    // HELD, AND COUNTED AS ITS OWN REFUSAL. A row filed by the hour, the week,
    // the fortnight or the month says nothing about a year without a schedule
    // nobody stated. It is not a missing wage and must not be counted as one.
    if (!isAnnualUnit(unit)) { counts.heldNonAnnualUnit += 1; continue; }
    const low = filedAnnualWage(row[cols.wageFrom], unit);
    if (low === null) { counts.heldNoWage += 1; continue; }
    const high = (cols.wageTo >= 0 ? filedAnnualWage(row[cols.wageTo], unit) : null) ?? low;

    counts.matchedRows += 1;
    for (const token of m.tokens) {
      matchedTokens.add(token);
      addCell(cells, { token, soc, state, socTitle: cols.socTitle >= 0 ? (row[cols.socTitle] ?? null) : null, lowAnnual: low, highAnnual: Math.max(high, low) });
      counts.cellWrites += 1;
    }
    if (sample > 0 && counts.matchedRows >= sample) break;
  }
  if (cols === null) throw new Error(`${basename(file)} has no header row`);

  const rows = finishCells(cells, { sourceFile: basename(file), sourceUrl, fiscalQuarter, publishedOn });
  return { rows, counts, tokens: matchedTokens.size };
}

/** The mirror the join reads: the same rule, catalogue and alias ledger the filings matcher uses. */
export async function buildIndexFromCatalogue({ withFacetNames = true, catalog = null, employerAliases = null } = {}) {
  const { mirrorRows } = await import("./layoff-board-names-mirror.mjs");
  const built = mirrorRows({ withFacetNames, catalog, employerAliases });
  return { index: indexMirror(built.rows), mirror: built };
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const opts = (name) => args.reduce((acc, a, i) => (a === name && args[i + 1] ? [...acc, args[i + 1]] : acc), []);

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = opt("--file");
  const published = opt("--published");
  if (!file) throw new Error("--file <path to the LCA disclosure xlsx> is required; this script does not download the 250 MB file");
  if (!published || !/^\d{4}-\d{2}-\d{2}$/.test(published)) {
    throw new Error("--published YYYY-MM-DD is required: the publication date is not inside the file, and a figure whose basis is unknown does not ship");
  }
  const fiscalQuarter = opt("--quarter") ?? quarterFromFileName(file);
  if (!fiscalQuarter) throw new Error(`could not read a fiscal quarter from ${basename(file)}; pass --quarter "FY2026 Q3"`);
  const sourceUrl = opt("--url") ?? defaultSourceUrl(file);
  const visaClasses = opts("--visa");
  const { index, mirror } = await buildIndexFromCatalogue({ withFacetNames: !flag("--no-facet-names") });
  console.error(`[load-oflc-lca] mirror rows=${mirror.rows.length} catalogue=${mirror.catalogue} facet=${mirror.facet} comparable_norms=${index.byNorm.size} held_non_ascii_names=${index.heldNonAscii}`);

  const { rows, counts, tokens } = await loadDisclosureFile({
    file, index, sourceUrl, fiscalQuarter, publishedOn: published,
    visaClasses: visaClasses.length > 0 ? visaClasses : null,
    sample: Number(opt("--sample", "0")) || 0,
    onProgress: (c) => console.error(`[load-oflc-lca] data_rows=${c.dataRows} certified=${c.certified} matched=${c.matchedRows}`),
  });

  console.error(`[load-oflc-lca] sheet_rows=${counts.sheetRows} data_rows=${counts.dataRows}`);
  console.error(`[load-oflc-lca] certified_by_equality=${counts.certified} other_status=${counts.notCertified} of_which_certified_prefix_refused=${counts.certifiedWithdrawnPrefix}`);
  console.error(`[load-oflc-lca] refused: single_token=${counts.refusedSingleToken} ambiguous=${counts.refusedAmbiguous} unmatched=${counts.unmatchedEmployer} held_non_ascii=${counts.heldNonAsciiEmployer}`);
  console.error(`[load-oflc-lca] held: no_soc=${counts.heldNoSoc} no_state=${counts.heldNoState} no_readable_wage=${counts.heldNoWage} wage_not_filed_yearly=${counts.heldNonAnnualUnit}`);
  console.error(`[load-oflc-lca] matched_rows=${counts.matchedRows} tokens=${tokens} cells=${rows.length} quarter="${fiscalQuarter}" published=${published}`);

  const out = opt("--out");
  if (out) {
    await writeFile(out, JSON.stringify(rows));
    console.error(`[load-oflc-lca] wrote ${rows.length} cells to ${out}`);
  } else {
    process.stdout.write(JSON.stringify(rows.slice(0, 20), null, 1) + "\n");
  }
}
