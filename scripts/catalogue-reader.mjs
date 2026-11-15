/**
 * THE CENSUS READS THE CATALOGUE THE BOARD DEPLOYS, BY IMPORTING IT.
 *
 * Twelve census and merge scripts each read sources.ts with a regex of their
 * own. On main (2026-11-08) they saw 496 of 44,523 boards: the catalogue was
 * repacked into u() literals on 2026-09-06 and every regex kept reading the
 * object entries only. verify-all re-probed 15,844 boards we already carry,
 * merge-all judged name collisions against 477 of 43,279 names, and
 * census-drivable-yield could not run at all.
 *
 * So this module imports JOB_SOURCES itself, the array the bundle builds,
 * and every script reads through it:
 *
 *   - native type stripping where Node has it (22.18+, 23.6+), else tsx's
 *     ESM tsImport. Never a CJS require: it cannot load a module with a
 *     top-level await, which is the shape a compressed catalogue takes.
 *     tsx is a devDependency in package.json, so CI's Node 20 has the route.
 *   - never a regex over the file, whatever form the entries take.
 *   - it prints the absolute path it read, so a read of another checkout's
 *     catalogue shows in the output (a worktree path holds spaces: every path
 *     here stays a path, never a string for a shell).
 *
 * BESIDE THE READER, the rules the two merges share, so merge-all and
 * merge-oracle cannot judge one collision two ways: the name-collision
 * verdict (D6), the served counts it reads, and the lap and room projection
 * (CAP-6, CAP-11). They live here because each is a question about the
 * catalogue: who carries this name, what do they serve, what would it cost.
 *
 *   node scripts/catalogue-reader.mjs [sources.ts] [--count]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** This checkout's root: the folder above scripts/. */
export const REPO_ROOT = resolve(HERE, "..");
/** The catalogue of this checkout, resolved from this file, never from the working directory. */
export const REPO_SOURCES = resolve(REPO_ROOT, "supabase/functions/job-board/sources.ts");
/** The catalogue a cwd-relative script writes: merge-all, merge-oracle and census-pinpoint run in a scratch dir under test. */
export const CWD_SOURCES = "supabase/functions/job-board/sources.ts";

/** A native import that fails with one of these is a Node without type stripping; tsx is tried. Anything else is a real error. */
const NO_STRIPPING = new Set(["ERR_UNKNOWN_FILE_EXTENSION", "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING", "ERR_NO_TYPESCRIPT"]);

/** Which loader runs: CATALOGUE_READER_ROUTE=native|tsx forces one (the parity test runs both). */
export function readerRoute() {
  const forced = process.env.CATALOGUE_READER_ROUTE;
  if (forced === "native" || forced === "tsx") return forced;
  return process.features?.typescript ? "native" : "tsx";
}

async function importModule(file, route) {
  const st = statSync(file);
  // The query makes a rewritten file a new module: an import is cached by URL.
  const url = `${pathToFileURL(file).href}?catalogue=${st.mtimeMs}-${st.size}`;
  if (route === "native") return import(url);
  const { tsImport } = await import("tsx/esm/api");
  return tsImport(url, import.meta.url);
}

/**
 * Every catalogue entry in JOB_SOURCES order (the refresh cursor is
 * positional), as { index, name, source, token } plus the optional fields an
 * entry carries: agency, pages, host, brand, org.
 */
export async function readCatalogue(path = REPO_SOURCES, { quiet = false, log = console.log } = {}) {
  const file = resolve(path);
  let route = readerRoute();
  let mod;
  try {
    mod = await importModule(file, route);
  } catch (e) {
    if (route !== "native" || !NO_STRIPPING.has(e?.code)) throw e;
    route = `tsx (this Node refused native type stripping: ${e.code})`;
    mod = await importModule(file, "tsx");
  }
  const list = mod?.JOB_SOURCES;
  if (!Array.isArray(list)) throw new Error(`${file} exports no JOB_SOURCES array`);
  const out = list.map((e, index) => {
    if (!e || typeof e.name !== "string" || typeof e.source !== "string" || typeof e.token !== "string") {
      throw new Error(`${file}: JOB_SOURCES[${index}] has no name, source and token: ${JSON.stringify(e).slice(0, 120)}`);
    }
    const row = { index, name: e.name, source: e.source, token: e.token };
    for (const k of ["agency", "pages", "host", "brand", "org"]) if (e[k] !== undefined) row[k] = e[k];
    return row;
  });
  if (!quiet) log(`catalogue: ${out.length} boards from ${file} (${route})`);
  return out;
}

/** vendor:token, token lowercased: the key every census dedupe compares. */
export const boardKey = (source, token) => `${source}:${String(token).toLowerCase()}`;

/** Every board's vendor:token key. */
export function keySet(entries) {
  return new Set(entries.map((e) => boardKey(e.source, e.token)));
}

/** One vendor's tokens, lowercased. */
export function tokensOf(entries, source) {
  return new Set(entries.filter((e) => e.source === source).map((e) => e.token.toLowerCase()));
}

/**
 * The tenants the catalogue carries: workday:<tenant> (the token's first
 * segment) and oracle:<tenant>~<region>. A new site of a carried tenant is a
 * sub-site, which is judged differently from a new employer.
 */
export function tenantSet(entries) {
  const out = new Set();
  for (const e of entries) {
    const parts = e.token.toLowerCase().split("~");
    if (e.source === "workday" && parts[0]) out.add(`workday:${parts[0]}`);
    if (e.source === "oracle" && parts[0]) out.add(`oracle:${parts[0]}~${parts[1] ?? ""}`);
  }
  return out;
}

/** The name key a collision compares: lowercased, trimmed, inner spaces folded. */
export const nameKey = (n) => String(n ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** name key -> every board carrying that name, as { source, token, index }. */
export function nameIndex(entries) {
  const out = new Map();
  for (const e of entries) {
    const k = nameKey(e.name);
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ source: e.source, token: e.token, index: e.index });
  }
  return out;
}

// ── what the catalogue serves (production reads, read-only) ─────────────────

/** The anon URL and key: the environment first, then this checkout's .env. */
export function anonEnv() {
  let envText = "";
  try { envText = readFileSync(resolve(REPO_ROOT, ".env"), "utf8"); } catch { /* none */ }
  const grab = (k) => process.env[k] || (envText.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
  return { url: grab("VITE_SUPABASE_URL") || "", key: grab("VITE_SUPABASE_PUBLISHABLE_KEY") || "" };
}

/**
 * Served rows per carried token, from the anon get_company_fill_curve read
 * (open_roles), 25 tokens a call, by GET so PostgREST runs it read-only.
 * A token the read does not answer for is absent from the map: unreadable,
 * which a collision treats as hold, never as zero.
 */
export async function readServedCounts(tokens, { env = anonEnv(), fetchImpl = fetch } = {}) {
  const out = new Map();
  const list = [...new Set(tokens)];
  if (!env.url || !env.key || !list.length) return out;
  for (let i = 0; i < list.length; i += 25) {
    const batch = list.slice(i, i + 25);
    const arr = `{${batch.map((t) => `"${String(t).replace(/["\\]/g, "")}"`).join(",")}}`;
    try {
      const res = await fetchImpl(`${env.url}/rest/v1/rpc/get_company_fill_curve?p_tokens=${encodeURIComponent(arr)}`, {
        headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const rows = await res.json();
      for (const r of Array.isArray(rows) ? rows : []) {
        if (typeof r?.company_token === "string" && Number.isFinite(Number(r.open_roles))) out.set(r.company_token.toLowerCase(), Number(r.open_roles));
      }
    } catch { /* the batch stays unread */ }
  }
  return out;
}

/** job-board status by the probe budget (status and list reads only), or null when it cannot be read. */
export async function readBoardStatus({ env = anonEnv(), fetchImpl = fetch } = {}) {
  if (!env.url || !env.key) return null;
  try {
    const res = await fetchImpl(`${env.url}/functions/v1/job-board`, {
      method: "POST",
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", "x-rb-budget": "probe" },
      body: JSON.stringify({ action: "status" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j && typeof j === "object" && !Array.isArray(j) ? j : null;
  } catch { return null; }
}

/**
 * Up to 100 served rows of one carried board, as { t: title, c: city }, by a
 * job-board list read at the probe budget; null when it cannot be read.
 */
export async function readCarrierRows({ source, token }, { env = anonEnv(), fetchImpl = fetch } = {}) {
  if (!env.url || !env.key) return null;
  try {
    const res = await fetchImpl(`${env.url}/functions/v1/job-board`, {
      method: "POST",
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", "x-rb-budget": "probe" },
      body: JSON.stringify({ action: "list", companies: [token], vendor: [source], groupSimilar: false, includeFacets: false, limit: 100 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!Array.isArray(j?.jobs)) return null;
    return j.jobs.map((x) => ({ t: String(x?.title ?? ""), c: String(x?.location ?? "").split(/[,;|]/)[0].trim() }));
  } catch { return null; }
}

// ── D6: a name collision, judged ─────────────────────────────────────────────

/**
 * NAMES THAT DO NOT NAME ONE EMPLOYER. An exact match on one of these is no
 * evidence that two boards are the same company, so the incoming board needs
 * its own distinguishing name, taken from its own data (City and County of
 * Denver), or it is held for a person. Each entry says whose boards prove it.
 *
 * A length rule (one word under seven letters is generic) was proposed with
 * this list and refused on its own examples: it holds Visa, Thales and Amgen,
 * the cross-vendor upgrades this rule exists to admit.
 */
export const GENERIC_NAMES = new Map([
  ["alliance", "breezy:alliance is one of many employers called Alliance"],
  ["denver", "bamboohr:denver; a city, a university and a county are all Denver"],
  ["global", "a word, not an employer (the census name rule holds it first)"],
  ["clear", "a word, not an employer"],
  ["ans", "an abbreviation several companies share"],
  ["emerson", "workday:emerson is Emerson College, lever:emersonhc Emerson Health, oracle hdjq Emerson Electric"],
]);

/** The incoming board is admitted for size when its in-window count is at least this many times the carriers' served rows. */
export const COLLISION_SIZE_FACTOR = 2;
/** A size admission whose sampled postings the carriers already serve above this share is held for review. */
export const OVERLAP_HOLD_SHARE = 0.3;

/**
 * Is this colliding board a different employer by its own words?
 *   { different: true, name } - its own data names it apart (admit under that name)
 *   { hold: reason }          - a generic name with nothing to tell it apart
 *   { same: true }            - presumed the same employer: reach, then size, decide
 */
export function collisionIdentity({ name, distinctName, nameTaken }) {
  const own = String(distinctName ?? "").trim();
  if (own && nameKey(own) !== nameKey(name)) {
    if (nameTaken(own)) return { hold: `its own name "${own}" is carried too` };
    return { different: true, name: own };
  }
  const generic = GENERIC_NAMES.get(nameKey(name));
  if (generic) return { hold: `"${name}" is a generic name (${generic}): it needs its own name from its own data` };
  return { same: true };
}

/** Title + city, or the requisition number where both sides have one: the share of the incoming sample the carriers already serve. */
export function overlapShare(sample, carrierRows) {
  const mine = Array.isArray(sample) ? sample : [];
  const theirs = Array.isArray(carrierRows) ? carrierRows : [];
  if (!mine.length || !theirs.length) return { share: 0, by: "nothing to compare", n: mine.length };
  const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const byReq = mine.some((x) => x?.r) && theirs.some((x) => x?.r);
  const key = byReq ? (x) => norm(x?.r) : (x) => `${norm(x?.t)}|${norm(x?.c)}`;
  const have = new Set(theirs.map(key).filter((k) => k && k !== "|"));
  const hit = mine.filter((x) => have.has(key(x))).length;
  return { share: hit / mine.length, by: byReq ? "requisition number" : "title and city", n: mine.length };
}

/**
 * The size half of D6, for a collision presumed to be one employer:
 *   { admit: true }  - in-window >= 2x what the carriers serve
 *   { hold: reason } - a carrier's served count is unread (never read as zero)
 *   { drop: reason } - the carriers serve as much or more
 */
export function sizeVerdict({ inWindow, carriers, served }) {
  const sizes = carriers.map((c) => ({ ...c, served: served.get(String(c.token).toLowerCase()) }));
  const unread = sizes.filter((c) => !Number.isFinite(c.served));
  const shown = sizes.map((c) => `${c.source}:${c.token} serves ${Number.isFinite(c.served) ? c.served : "unread"}`).join(", ");
  if (unread.length) return { hold: `carrier count unread (${shown})`, shown };
  const total = sizes.reduce((s, c) => s + c.served, 0);
  if (Number.isFinite(inWindow) && inWindow >= COLLISION_SIZE_FACTOR * total) return { admit: true, total, shown };
  return { drop: `in-window ${inWindow} < ${COLLISION_SIZE_FACTOR} x ${total} served`, total, shown };
}

// ── the merge gates every --apply path shares ───────────────────────────────

/** A board merges only with at least this many postings dated within 30 days. */
export const MIN_IN_WINDOW = 3;

/**
 * The window gate: { pass, dated }. A hit that states a date basis is judged
 * by its in-window count (a first-page count is a floor, and a floor under 3
 * fails: the safe side is not merging a board we could not show is current).
 * A vendor that states no date (dateBasis "none") or an older hit without the
 * fields falls back to its posting count, and the merge tallies those apart.
 */
export function windowGate(b) {
  const dated = !!b?.dateBasis && b.dateBasis !== "none" && Number.isFinite(Number(b?.inWindow30)) && b.inWindow30 !== null;
  const n = dated ? Number(b.inWindow30) : Number(b?.count);
  return { pass: Number.isFinite(n) && n >= MIN_IN_WINDOW, dated };
}

/** The generated modules a catalogue change can make stale; each script's --check exits 1 when it is. */
export const GENERATED_CHECKS = ["scripts/board-collisions.ts", "scripts/workday-multi-site-tenants.ts"];

/**
 * After an --apply wrote a catalogue: run both generated-module checks, when
 * it is this checkout's catalogue (a scratch copy has no modules to check, and
 * says so). Returns { ran, stale: [script] }; a stale module prints the
 * command that regenerates it.
 */
export function runGeneratedChecks(written, { log = console.log, exec = execFileSync } = {}) {
  const file = resolve(written);
  if (file !== REPO_SOURCES) {
    log(`generated-module checks skipped: ${file} is not this checkout's catalogue (${REPO_SOURCES})`);
    return { ran: false, stale: [] };
  }
  const stale = [];
  for (const script of GENERATED_CHECKS) {
    try {
      log(String(exec("npx", ["tsx", script, "--check"], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).trim());
    } catch (e) {
      stale.push(script);
      log(`${script} --check FAILED: ${String(e?.stdout || e?.stderr || e?.message || e).trim()}`);
      log(`  regenerate: npx tsx ${script}   (then commit the module with the catalogue)`);
    }
  }
  return { ran: true, stale };
}

// ── the repeated-title flag (review only) ───────────────────────────────────

/**
 * ONE ADVERT POSTED IN MANY PLACES IS NOT MANY OPENINGS (EUTALENTS: 6 distinct
 * titles in its first 60 served rows). From a hit's sample of up to 100
 * { t, c, l }: a title repeated across 5 or more cities, or 2 or more stated
 * languages, or distinct titles at most a tenth of the sample. It FLAGS for a
 * person and excludes nothing: a rule that excluded would first need a
 * labelled corpus of at least 300 boards.
 */
export function repeatedTitleFlag(sample) {
  const rows = (Array.isArray(sample) ? sample : []).filter((x) => x && String(x.t ?? "").trim());
  if (!rows.length) return null;
  const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const byTitle = new Map();
  for (const x of rows) {
    const k = norm(x.t);
    if (!byTitle.has(k)) byTitle.set(k, { cities: new Set(), langs: new Set() });
    if (x.c) byTitle.get(k).cities.add(norm(x.c));
    if (x.l) byTitle.get(k).langs.add(norm(x.l));
  }
  const why = [];
  for (const [t, v] of byTitle) {
    if (v.cities.size >= 5) why.push(`"${t}" in ${v.cities.size} cities`);
    if (v.langs.size >= 2) why.push(`"${t}" in ${v.langs.size} languages`);
  }
  if (rows.length >= 10 && byTitle.size / rows.length <= 0.1) why.push(`${byTitle.size} distinct titles in ${rows.length} sampled`);
  return why.length ? why.slice(0, 3).join("; ") : null;
}

// ── CAP-6 / CAP-11: what a batch would cost ─────────────────────────────────

/** job-board's CORPUS_TARGET (index.ts): the governor evicts down to this. A test holds the two equal. */
export const CORPUS_TARGET = 1_150_000;
/** Room guard: the corpus left under the target must hold this many times the batch's in-window rows. */
export const ROOM_FACTOR = 1.5;
/** CAP-6's clean marginal: 10,000 more boards cost about 80 minutes of lap. */
export const LAP_MIN_PER_10K_BOARDS = 80;
/** --apply is refused when the batch would lengthen the lap by more than this share, unless --tranche-ok. */
export const LAP_GROWTH_LIMIT = 0.1;
/** The lap the growth is judged against when none is supplied: section 90's reference, .89's 357 minutes. */
export const REFERENCE_LAP_MIN = 357;
/** The rows one visit fetches per board: the list cap, 500 for the two paged giants. */
const fetchCap = (vendor) => (vendor === "workday" || vendor === "oracle" ? 500 : 250);
/** A hit's in-window rows: its dated count, or its count where the vendor states no date. */
export const inWindowOf = (b) => (b?.dateBasis && b.dateBasis !== "none" && Number.isFinite(Number(b.inWindow30)) ? Number(b.inWindow30) : Number(b?.count) || 0);

/**
 * The projection for a batch: { vendors: {v: {...}}, total: {...}, lapGrowthMin,
 * lapMin, lapSource, room, roomNeeded, roomOk, refusal }.
 * status may be null (unread): the room line then says so and refuses nothing.
 */
export function projectBatch(byVendor, { status = null, lapMin = null, linesBytes = 0 } = {}) {
  const vendors = {};
  let boards = 0, fetched = 0, rows = 0;
  for (const [v, list] of Object.entries(byVendor)) {
    if (!list?.length) continue;
    const f = list.reduce((s, b) => s + Math.min(Number(b.count) || 0, fetchCap(v)), 0);
    const r = list.reduce((s, b) => s + inWindowOf(b), 0);
    vendors[v] = { boards: list.length, fetched: f, inWindowRows: r };
    boards += list.length; fetched += f; rows += r;
  }
  const published = Number(status?.lastWrapMin);
  const lap = Number.isFinite(Number(lapMin)) && Number(lapMin) > 0 ? { min: Number(lapMin), from: "--lap-min" }
    : Number.isFinite(published) && published > 0 ? { min: published, from: "status.lastWrapMin" }
    : { min: REFERENCE_LAP_MIN, from: "section 90's reference lap (.89, 44,399 boards)" };
  const lapGrowthMin = (boards * LAP_MIN_PER_10K_BOARDS) / 10_000;
  const total = Number(status?.totalPostings);
  const room = Number.isFinite(total) ? CORPUS_TARGET - total : null;
  const roomNeeded = ROOM_FACTOR * rows;
  return {
    vendors, boards, fetched, inWindowRows: rows,
    lapMin: lap.min, lapSource: lap.from, lapGrowthMin, lapGrowthShare: lapGrowthMin / lap.min,
    room, roomNeeded, roomOk: room === null ? null : room >= roomNeeded,
    linesBytes, bytesPerPosting: rows > 0 ? linesBytes / rows : null,
  };
}

/** The lines a merge prints for its projection. */
export function projectionLines(p) {
  const out = [];
  for (const [v, x] of Object.entries(p.vendors)) out.push(`  ${v.padEnd(16)} ${String(x.boards).padStart(5)} boards, fetched per lap ${x.fetched}, in-window rows ${x.inWindowRows}`);
  out.push(`  ${"all".padEnd(16)} ${String(p.boards).padStart(5)} boards, fetched per lap ${p.fetched}, in-window rows ${p.inWindowRows}`);
  out.push(`  lap: +${p.lapGrowthMin.toFixed(p.lapGrowthMin < 1 ? 3 : 1)} min on a ${p.lapMin}-minute lap (${(100 * p.lapGrowthShare).toFixed(1)}%; from ${p.lapSource}; refused above ${100 * LAP_GROWTH_LIMIT}% without --tranche-ok)`);
  out.push(p.room === null
    ? `  room: status not read (pass --status <file> or --status live), so the ${ROOM_FACTOR}x room guard for ${p.inWindowRows} in-window rows is unjudged`
    : `  room: ${p.room} under the ${CORPUS_TARGET} target against ${ROOM_FACTOR} x ${p.inWindowRows} = ${Math.round(p.roomNeeded)} needed: ${p.roomOk ? "fits" : "DOES NOT FIT"}`);
  out.push(`  catalogue bytes: ${p.linesBytes}${p.bytesPerPosting === null ? "" : ` (${p.bytesPerPosting.toFixed(2)} per projected posting)`}`);
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--")) ?? REPO_SOURCES;
  const entries = await readCatalogue(path, { log: args.includes("--count") ? (m) => console.error(m) : console.log });
  if (args.includes("--count")) console.log(entries.length);
}
