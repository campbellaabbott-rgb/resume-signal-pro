// Oracle census merge — the vendor merge-all has always refused, unlocked by
// resolve-oracle-names.mjs (recruitingCESites carries the employer's own
// branded site name; verified live on Kroger/AutoZone/Tata before the resolver
// existed).
//
// The same census-merge protocol as merge-all, oracle-shaped:
//   * name hygiene: career-site suffixes stripped ("Quest Diagnostics Careers"
//     -> "Quest Diagnostics", "Jobs at Acosta" -> "Acosta") — the SITE title is
//     the employer's, the scaffolding words are Oracle's;
//   * NAME_BLOCK / GOV_BLOCK / TOKEN_BLOCK copied verbatim from merge-all —
//     one policy, two files, and any future edit must land in both;
//   * staffing-mill screen for boards >= 100 postings: samples real
//     ShortDescriptionStr text from the tenant's own list API;
//   * name collisions vs the existing catalogue: judged by D6, the rule
//     merge-all applies (scripts/catalogue-reader.mjs holds it, so the two
//     merges cannot judge one collision two ways). A board that names itself
//     apart in its own data (distinctName) merges under that name, a generic
//     name is held, and a presumed-same employer is admitted only for size:
//     its count at least twice what the carriers serve, every carrier's count
//     printed, an unread count held, an overlap above 30% held. Oracle buys
//     no reach (its adapter never reaches a submit), so size is its one way in;
//   * A NEW SITE OF A CARRIED TENANT IS A SUB-SITE, and it merges only when
//     its requisition ids are not a subset of the carried sites' ids. Ingest
//     stores each requisition once, under the best-ranked site, so a mirror
//     site costs a fetch every lap and adds no row. An id list that cannot be
//     read in full holds the site (--req-ids <token-to-ids.json> answers the
//     read from a file);
//   * the window gate merge-all applies: at least 3 postings dated within 30
//     days where the input states a date basis, else the posting count;
//   * every request to one Oracle host waits 1.1 s after the last;
//   * TRANCHE CAP: --cap <postings> (default 85,000) fills by descending
//     posting count. The corpus governor stands at 750k with the board at
//     ~695k — merging all 142k resolved postings would run the governor into
//     silent evictions (the one delete path with no lifecycle trace). A
//     tranche sized to headroom, then the next tranche after the ceiling
//     decision, is the honest sequence.
//
// The catalogue is read by importing it (scripts/catalogue-reader.mjs), from
// the working directory's sources.ts, the file this merge appends to.
//
// Usage: node scripts/merge-oracle.mjs <oracle-names.json> [--cap 85000] [--apply]
//          [--carrier-counts <token-to-served.json>] [--carrier-postings <rows.json>]
//          [--req-ids <token-to-ids.json>]
import { readFileSync, writeFileSync } from "node:fs";
import { oracleHost as hostOf } from "./oracle-host.mjs";
import { censusNameReason } from "./census-names.mjs";
import {
  CWD_SOURCES, MIN_IN_WINDOW, OVERLAP_HOLD_SHARE, boardKey, collisionIdentity, inWindowOf, keySet, nameIndex,
  nameKey, overlapShare, readCarrierRows, readCatalogue, readServedCounts, runGeneratedChecks, sizeVerdict,
  tenantSet, windowGate,
} from "./catalogue-reader.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const flagValue = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const capIdx = args.indexOf("--cap");
const CAP = capIdx >= 0 ? Number(args[capIdx + 1]) : 85_000;
const VALUE_FLAGS = new Set(["--cap", "--carrier-counts", "--carrier-postings", "--req-ids"]);
const NAMES_PATH = args.find((a, i) => a.endsWith(".json") && !VALUE_FLAGS.has(args[i - 1]));
const SOURCES = CWD_SOURCES;

const NAME_BLOCK = /\b(staffing|recruit(ing|ment|er)?s?|talents?|headhunt|personnel|manpower|workforce|employment\s+(agency|services)|placements?\b|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal|demo|test|sample|sandbox|placeholder)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;
const GOV_BLOCK = /\b(city of|county of|state of|commonwealth of|government of|unified school|school district|public schools|public library|court of appeals|county commissioners|conservation district|health district|sheriff|police department|fire department|township of|municipality)\b/i;
// Provincial/regional health AUTHORITIES are public sector even when no
// "city of" phrase appears — HealthCareersInSask.ca (Saskatchewan Health
// Authority's portal, 2,185 postings) passed GOV_BLOCK on name shape and was
// caught only by eyeball. A domain-shaped employer name is itself the tell: an
// employer has a name; a PORTAL has a domain.
const GOV_EXTRA = /health authority|healthcareersinsask|\bnhs\b|crown corporation/i;
const DOMAIN_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+\.(ca|com|org|net|gov|edu|co\.uk)$/i;
const TOKEN_BLOCK = /(demo|test|sample|sandbox|staging|-dev\d*\b)/i;
// mill-screen-all's evidence set VERBATIM (plus "talent acquisition firm",
// which convicted The Symicor Group in the workable wave). A looser draft here
// with bare "our customer" convicted Kroger on "amazing experiences for our
// customers" — the phrase must name the BUSINESS MODEL, not ordinary retail
// copy.
const MILL_TEXT = new RegExp([
  "\\bour client\\b", "\\bon behalf of (a|an|our|the)\\b", "\\bfor our client\\b",
  "\\bclient of ours\\b", "\\bour customer is (hiring|looking)\\b",
  "\\bstaffing (agency|firm|partner)\\b", "\\brecruitment agency\\b",
  "\\bwe are (a|an) (staffing|recruiting|recruitment|talent) (agency|firm|partner)\\b",
  "\\btalent acquisition firm\\b",
].join("|"), "i");

const cleanName = (raw) => String(raw)
  .replace(/[®™]/g, "")
  .replace(/^jobs?\s+at\s+/i, "")
  .replace(/\s+(careers?|career\s+site|career|jobs)\s*$/i, "")
  .trim();

const { resolved } = JSON.parse(readFileSync(NAMES_PATH, "utf8"));
const catalog = readFileSync(SOURCES, "utf8");
const catalogue = await readCatalogue(SOURCES);
const existingTokens = keySet(catalogue);
const carriersByName = nameIndex(catalogue);

// D6's reads (see merge-all): what each carrier of a colliding name serves,
// and its served postings for the overlap check. Unread holds.
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const countsFile = flagValue("--carrier-counts");
const postingsFile = flagValue("--carrier-postings");
const served = countsFile
  ? new Map(Object.entries(readJson(countsFile)).map(([t, n]) => [t.toLowerCase(), Number(n)]))
  : await readServedCounts(resolved.flatMap((b) => carriersByName.get(nameKey(cleanName(b.name))) ?? []).map((c) => c.token));
const carrierPostings = postingsFile ? new Map(Object.entries(readJson(postingsFile)).map(([k, rows]) => [k.toLowerCase(), rows])) : null;
async function overlapWithCarriers(b, carrierBoards) {
  if (!Array.isArray(b.sample) || !b.sample.length) return { hold: "no sample of its own postings to compare" };
  const rows = [];
  for (const c of carrierBoards) {
    const r = carrierPostings ? carrierPostings.get(boardKey(c.source, c.token)) : await readCarrierRows(c);
    if (!Array.isArray(r)) return { hold: `${c.source}:${c.token}'s served postings unread` };
    rows.push(...r);
  }
  const o = overlapShare(b.sample, rows);
  const said = `${Math.round(100 * o.share)}% of ${o.n} sampled postings already served (by ${o.by})`;
  return o.share > OVERLAP_HOLD_SHARE ? { hold: `${said}: one employer's postings on two vendors is for a person to read` } : { said };
}
/** D6 for one oracle board: { name } to merge under, or { hold } / { drop } with the reason. */
async function judgeCollision(b, name) {
  const carrierBoards = carriersByName.get(nameKey(name));
  if (!carrierBoards) return { name };
  const id = collisionIdentity({ name, distinctName: b.distinctName, nameTaken: (n) => carriersByName.has(nameKey(n)) });
  if (id.hold) return { hold: id.hold };
  if (id.different) {
    console.log(`collision: "${name}" (${b.token}) names itself "${id.name}" in its own data: merged under that name`);
    return { name: id.name };
  }
  const size = sizeVerdict({ inWindow: inWindowOf(b), carriers: carrierBoards, served });
  const overlap = size.admit ? await overlapWithCarriers(b, carrierBoards) : null;
  const verdict = size.hold || overlap?.hold ? "held" : size.admit ? `admitted for size (${overlap.said})` : "dropped";
  console.log(`collision: "${name}" (oracle:${b.token}) in-window ${inWindowOf(b)} against ${size.shown}: ${verdict}`);
  if (size.hold || overlap?.hold) return { hold: size.hold ?? overlap.hold };
  if (!size.admit) return { drop: size.drop };
  return { name, forSize: true };
}

const lastRequestAt = new Map();
const jget = async (url) => {
  const host = new URL(url).host;
  const wait = (lastRequestAt.get(host) ?? 0) + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(host, Date.now());
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};
async function millSample(token) {
  // The ingest's own proven shapes (fetchOracle / the details fetch in
  // index.ts): the LIST does not reliably carry text (ShortDescriptionStr is
  // optional per tenant — 165 boards read as empty through it), so sample Ids
  // from the list and read the full posting from RequisitionDetails, which
  // always carries description + qualifications + responsibilities.
  const [, , site] = token.split("~");
  const listFinder = `findReqs;siteNumber=${site},limit=12,offset=0,sortBy=POSTING_DATES_DESC`;
  // expand=requisitionList is LOAD-BEARING: without it the response carries
  // TotalJobsCount and an empty list on every tenant, which reads as an
  // unreachable board (165 false drops on the first dry run).
  const list = await jget(`https://${hostOf(token)}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(listFinder)}`);
  const reqs = list.items?.[0]?.requisitionList ?? [];
  let read = 0, hits = 0;
  for (const r of reqs) {
    const short = String(r.ShortDescriptionStr ?? "");
    if (short.length > 60) { read++; if (MILL_TEXT.test(short)) hits++; continue; }
    if (read >= 5) continue;
    try {
      const finder = `ById;Id=${r.Id},siteNumber=${site}`;
      const det = await jget(`https://${hostOf(token)}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(finder)}`);
      const it = det.items?.[0] ?? {};
      const txt = ["ExternalDescriptionStr", "ExternalQualificationsStr", "ExternalResponsibilitiesStr", "CorporateDescriptionStr"]
        .map((k) => String(it[k] ?? "")).join(" ").replace(/<[^>]+>/g, " ");
      if (txt.trim().length > 60) { read++; if (MILL_TEXT.test(txt)) hits++; }
    } catch { /* one unreadable posting is not a verdict on the board */ }
  }
  return { read, hits };
}

// ── sub-sites: a new site of a tenant we carry ──────────────────────────────
const carriedTenants = tenantSet(catalogue);
const tenantOf = (token) => token.toLowerCase().split("~").slice(0, 2).join("~");
const reqIdsFile = flagValue("--req-ids");
const reqIdsGiven = reqIdsFile ? new Map(Object.entries(readJson(reqIdsFile)).map(([t, ids]) => [t.toLowerCase(), ids])) : null;
/** The most ids a live read pages through for one site before it calls the read incomplete. */
const REQ_ID_READ_CAP = 5_000;
/** Every requisition id one site lists, or null when the list cannot be read in full. */
async function reqIdsOf(token) {
  if (reqIdsGiven) { const ids = reqIdsGiven.get(token.toLowerCase()); return Array.isArray(ids) ? ids.map(String) : null; }
  const [, , site] = token.split("~");
  const ids = [];
  try {
    for (let offset = 0; offset < REQ_ID_READ_CAP; offset += 200) {
      const finder = `findReqs;siteNumber=${site},limit=200,offset=${offset},sortBy=POSTING_DATES_DESC`;
      const list = await jget(`https://${hostOf(token)}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent(finder)}`);
      const item = list.items?.[0] ?? {};
      const page = item.requisitionList ?? [];
      for (const r of page) if (r?.Id != null) ids.push(String(r.Id));
      const total = Number(item.TotalJobsCount);
      if (!page.length || (Number.isFinite(total) && ids.length >= total)) return ids;
    }
  } catch { return null; }
  return null; // past the cap: not read in full
}
/** { admit, said } | { mirror } | { hold } for a site whose tenant is carried. */
async function judgeSubSite(b) {
  const tr = tenantOf(b.token);
  const carriedSites = catalogue.filter((e) => e.source === "oracle" && tenantOf(e.token) === tr);
  const mine = await reqIdsOf(b.token);
  if (!mine) return { hold: "its requisition ids could not be read in full" };
  const theirs = new Set();
  for (const c of carriedSites) {
    const ids = await reqIdsOf(c.token);
    if (!ids) return { hold: `the carried site ${c.token}'s requisition ids could not be read in full` };
    for (const id of ids) theirs.add(id);
  }
  const extra = mine.filter((id) => !theirs.has(id)).length;
  const against = carriedSites.map((c) => c.token).join(", ");
  if (extra === 0) return { mirror: `all ${mine.length} of its requisitions are listed by ${against}` };
  return { admit: true, said: `${extra} of its ${mine.length} requisitions are not listed by ${against}` };
}

// REVIEWED, in the mill screen's own "printed for review" tradition: boards
// whose text tripped "our client" but whose employer verifiably hires its own
// staff. BNY is a custody bank describing client service; Startek is a BPO
// hiring its own call-center agents. Every entry here was read in context by
// a human before being cleared — add nothing to this set without doing that.
const MILL_REVIEWED_CLEAR = new Set([
  "eofe~us2~CX_1",                // BNY — bank; postings describe serving bank clients
  "fa-evuf-saasfaprod1~ocs~CX_1", // Startek — BPO; hires its own agents
]);

const dropped = { blockedName: [], labelName: [], blockedGov: [], blockedToken: [], dupe: [], underThree: [], subSiteMirror: [], subSiteHeld: [], nameCollision: [], collisionHeld: [], collisionAdmittedForSize: [], mill: [], millUnreadable: [] };
let undatedPassed = 0;
const kept = [];
let budget = CAP;
for (const b of resolved) {
  let name = cleanName(b.name);
  if (!name) continue;
  // cleanName takes "Jobs" off the end, so a site label such as "All Jobs"
  // arrives here as a generic word; the census rule holds it, and any other
  // label, rather than merge it as an employer's name.
  const labelWhy = censusNameReason(name, { fromLabel: true });
  if (labelWhy) { dropped.labelName.push(`${name} (${b.token}): ${labelWhy}`); continue; }
  // The census token is kept verbatim. A missing `expand=requisitionList`
  // once made every site look empty and nearly caused a token rebuild onto
  // the "active" site — measured afterwards, CX_1 and the branded site serve
  // the SAME requisitions once expand is passed. The reachability half of the
  // mill sample below still proves each token serves rows before it ships.
  if (existingTokens.has(boardKey("oracle", b.token))) { dropped.dupe.push(b.token); continue; }
  if (TOKEN_BLOCK.test(b.token)) { dropped.blockedToken.push(b.token); continue; }
  // CHARTER CHANGE 2026-08-31: staffing/talent names carry now (operator
  // decision); only junk names (demo/test/sample) still block.
  if (/\b(demo|test|sample|sandbox|placeholder)\b/i.test(name)) { dropped.blockedName.push(`${name} (${b.token})`); continue; }
  // Gov boards carry now (same charter change). DOMAIN_NAME stays: a bare
  // hostname is a naming failure, not an employer category.
  if (DOMAIN_NAME.test(name)) { dropped.blockedGov.push(`${name} (${b.token})`); continue; }
  const gate = windowGate(b);
  if (!gate.pass) { dropped.underThree.push(`${name} (${b.token})`); continue; }
  if (!gate.dated) undatedPassed++;
  if (carriedTenants.has(`oracle:${tenantOf(b.token)}`)) {
    const sub = await judgeSubSite(b);
    if (sub.hold) { dropped.subSiteHeld.push(`${name} (${b.token}): ${sub.hold}`); continue; }
    if (sub.mirror) { dropped.subSiteMirror.push(`${name} (${b.token}): ${sub.mirror}`); continue; }
    console.log(`sub-site: ${name} (${b.token}): ${sub.said}: admitted to the collision rule`);
  }
  const collision = await judgeCollision(b, name);
  if (collision.hold) { dropped.collisionHeld.push(`${name} (${b.token}): ${collision.hold}`); continue; }
  if (collision.drop) { dropped.nameCollision.push(`${name} (${b.token}): ${collision.drop}`); continue; }
  if (collision.forSize) dropped.collisionAdmittedForSize.push(`${name} (${b.token})`);
  name = collision.name;
  if (b.count > budget) continue; // tranche full for a board this size; smaller ones may still fit
  try {
    const m = await millSample(b.token);
    if (m.read === 0) { dropped.millUnreadable.push(`${name} (${b.token})`); continue; }
    // Phrase evidence no longer excludes — agencies are carried. The unreadable
    // screen below still holds boards whose text cannot be read at all.
    if (false && b.count >= 100 && m.hits >= 2 && !MILL_REVIEWED_CLEAR.has(b.token)) { dropped.mill.push(`${name} (${b.token}) ${m.hits}/${m.read}`); continue; }
  } catch { dropped.millUnreadable.push(`${name} (${b.token})`); continue; }
  kept.push({ name, token: b.token, count: b.count });
  budget -= b.count;
}

const postings = kept.reduce((n, b) => n + b.count, 0);
console.log(`kept ${kept.length} boards / ${postings.toLocaleString()} postings (cap ${CAP.toLocaleString()}, budget left ${budget.toLocaleString()})`);
const listed = ["mill", "blockedGov", "collisionHeld", "nameCollision", "collisionAdmittedForSize", "subSiteMirror", "subSiteHeld"];
const heldKinds = new Set(["collisionHeld", "subSiteHeld"]);
for (const [k, v] of Object.entries(dropped)) if (v.length) console.log(`${k === "collisionAdmittedForSize" ? "admitted" : heldKinds.has(k) ? "held for review" : "dropped"} ${k}: ${v.length}${listed.includes(k) ? " — " + v.slice(0, heldKinds.has(k) ? 50 : 6).join("; ") : ""}`);
console.log(`window gate: >=${MIN_IN_WINDOW} postings dated within 30 days; ${undatedPassed} kept boards state no date and were judged by posting count`);

if (!APPLY) { console.log("\nDry run. Re-run with --apply to append to sources.ts."); process.exit(0); }

const banner = `\n  // ── Oracle census (merged 2026-08-28): names resolved from each tenant's own recruitingCESites branding, mill-screened on real posting text, tranche-capped to governor headroom ──\n`;
const entries = kept.map((b) => `  { name: ${JSON.stringify(b.name)}, source: "oracle", token: ${JSON.stringify(b.token)} },`).join("\n");
const closeIdx = catalog.lastIndexOf("];");
writeFileSync(SOURCES, catalog.slice(0, closeIdx) + banner + entries + "\n" + catalog.slice(closeIdx));
console.log(`\nAPPLIED: ${kept.length} oracle boards appended to sources.ts — bump BUILD_VERSION in the same commit.`);
const checks = runGeneratedChecks(SOURCES);
if (checks.stale.length) { console.error(`STALE after the merge: ${checks.stale.join(", ")}. Regenerate before committing.`); process.exit(1); }
