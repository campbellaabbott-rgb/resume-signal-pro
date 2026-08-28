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
//   * name-collision guard vs the existing catalog: SKIPPED conservatively
//     (listed for review) — oracle is drivable, but claiming an existing
//     employer's name from a second vendor needs eyes, not a rule;
//   * TRANCHE CAP: --cap <postings> (default 85,000) fills by descending
//     posting count. The corpus governor stands at 750k with the board at
//     ~695k — merging all 142k resolved postings would run the governor into
//     silent evictions (the one delete path with no lifecycle trace). A
//     tranche sized to headroom, then the next tranche after the ceiling
//     decision, is the honest sequence.
//
// Usage: node scripts/merge-oracle.mjs <oracle-names.json> [--cap 85000] [--apply]
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const capIdx = args.indexOf("--cap");
const CAP = capIdx >= 0 ? Number(args[capIdx + 1]) : 85_000;
const NAMES_PATH = args.find((a) => a.endsWith(".json"));
const SOURCES = "supabase/functions/job-board/sources.ts";

const NAME_BLOCK = /\b(staffing|recruit(ing|ment|er)?s?|talents?|headhunt|personnel|manpower|workforce|employment\s+(agency|services)|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal|demo|test|sample|sandbox|placeholder)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;
const GOV_BLOCK = /\b(city of|county of|state of|commonwealth of|government of|unified school|school district|public schools|public library|court of appeals|county commissioners|conservation district|health district|sheriff|police department|fire department|township of|municipality)\b/i;
// Provincial/regional health AUTHORITIES are public sector even when no
// "city of" phrase appears — HealthCareersInSask.ca (Saskatchewan Health
// Authority's portal, 2,185 postings) passed GOV_BLOCK on name shape and was
// caught only by eyeball. A domain-shaped employer name is itself the tell: an
// employer has a name; a PORTAL has a domain.
const GOV_EXTRA = /health authority|healthcareersinsask|\bnhs\b|crown corporation/i;
const DOMAIN_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+\.(ca|com|org|net|gov|edu|co\.uk)$/i;
const TOKEN_BLOCK = /(demo|test|sample|sandbox|staging)/i;
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
const existingTokens = new Set([...catalog.matchAll(/token: "([^"]+)"/g)].map((m) => m[1].toLowerCase()));
const existingNames = new Set(
  [...catalog.matchAll(/name: "([^"]+)"/g)].map((m) => m[1].toLowerCase())
    .concat([...catalog.matchAll(/s\("([^"]+)"/g)].map((m) => m[1].toLowerCase())),
);

const hostOf = (token) => { const [t, dc] = token.split("~"); return `${t}.fa.${dc}.oraclecloud.com`; };
const jget = async (url) => {
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

// REVIEWED, in the mill screen's own "printed for review" tradition: boards
// whose text tripped "our client" but whose employer verifiably hires its own
// staff. BNY is a custody bank describing client service; Startek is a BPO
// hiring its own call-center agents. Every entry here was read in context by
// a human before being cleared — add nothing to this set without doing that.
const MILL_REVIEWED_CLEAR = new Set([
  "eofe~us2~CX_1",                // BNY — bank; postings describe serving bank clients
  "fa-evuf-saasfaprod1~ocs~CX_1", // Startek — BPO; hires its own agents
]);

const dropped = { blockedName: [], blockedGov: [], blockedToken: [], dupe: [], nameCollision: [], mill: [], millUnreadable: [] };
const kept = [];
let budget = CAP;
for (const b of resolved) {
  const name = cleanName(b.name);
  if (!name) continue;
  // The census token is kept verbatim. A missing `expand=requisitionList`
  // once made every site look empty and nearly caused a token rebuild onto
  // the "active" site — measured afterwards, CX_1 and the branded site serve
  // the SAME requisitions once expand is passed. The reachability half of the
  // mill sample below still proves each token serves rows before it ships.
  if (existingTokens.has(b.token.toLowerCase())) { dropped.dupe.push(b.token); continue; }
  if (TOKEN_BLOCK.test(b.token)) { dropped.blockedToken.push(b.token); continue; }
  if (NAME_BLOCK.test(name)) { dropped.blockedName.push(`${name} (${b.token})`); continue; }
  if (GOV_BLOCK.test(name) || GOV_EXTRA.test(name) || DOMAIN_NAME.test(name)) { dropped.blockedGov.push(`${name} (${b.token})`); continue; }
  if (existingNames.has(name.toLowerCase())) { dropped.nameCollision.push(`${name} (${b.token})`); continue; }
  if (b.count > budget) continue; // tranche full for a board this size; smaller ones may still fit
  try {
    const m = await millSample(b.token);
    if (m.read === 0) { dropped.millUnreadable.push(`${name} (${b.token})`); continue; }
    if (b.count >= 100 && m.hits >= 2 && !MILL_REVIEWED_CLEAR.has(b.token)) { dropped.mill.push(`${name} (${b.token}) ${m.hits}/${m.read}`); continue; }
  } catch { dropped.millUnreadable.push(`${name} (${b.token})`); continue; }
  kept.push({ name, token: b.token, count: b.count });
  budget -= b.count;
}

const postings = kept.reduce((n, b) => n + b.count, 0);
console.log(`kept ${kept.length} boards / ${postings.toLocaleString()} postings (cap ${CAP.toLocaleString()}, budget left ${budget.toLocaleString()})`);
for (const [k, v] of Object.entries(dropped)) if (v.length) console.log(`dropped ${k}: ${v.length}${k === "mill" || k === "blockedGov" ? " — " + v.slice(0, 6).join("; ") : ""}`);

if (!APPLY) { console.log("\nDry run. Re-run with --apply to append to sources.ts."); process.exit(0); }

const banner = `\n  // ── Oracle census (merged 2026-08-28): names resolved from each tenant's own recruitingCESites branding, mill-screened on real posting text, tranche-capped to governor headroom ──\n`;
const entries = kept.map((b) => `  { name: ${JSON.stringify(b.name)}, source: "oracle", token: ${JSON.stringify(b.token)} },`).join("\n");
const closeIdx = catalog.lastIndexOf("];");
writeFileSync(SOURCES, catalog.slice(0, closeIdx) + banner + entries + "\n" + catalog.slice(closeIdx));
console.log(`\nAPPLIED: ${kept.length} oracle boards appended to sources.ts — bump BUILD_VERSION in the same commit.`);
