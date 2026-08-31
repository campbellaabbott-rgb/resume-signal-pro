// ADP employer-name resolution — the unlock for the ~600 nameless ADP boards.
//
// merge-all holds a nameless board out of the catalog, and "an employer name
// comes from the employer" (commit 15086a72, the oracle discipline) forbids
// inventing one. verify-all's ADP prober mines the branding config's welcome
// prose and logo filename; roughly 600 verified boards carry identity in
// neither, so they enumerate but never merge.
//
// Where the name actually lives, measured live 2026-08-31 on ten real
// nameless boards before this script existed:
//   - the per-requisition DETAIL JSON's structured fields are barren on every
//     board sampled (organizationalUnits, postingInstructions, links,
//     additionalProperties: all empty arrays/objects; no organization or
//     company field anywhere) — the structured payload really never names
//     the employer, confirming the prober's note;
//   - but the same detail JSON serves requisitionDescription, the employer's
//     OWN job-description prose, and employers name themselves there
//     constantly: the equal-opportunity-employer sentence, "At X, we...",
//     "About X", "join the X team" (7 of 10 sampled boards carried at least
//     one, e.g. Eurasia Group, Amalgamated Bank, Sceye — all 3/3 postings
//     agreeing);
//   - the branding config's OTHER content-link types carry prose identity the
//     prober never read: VIDEO-BRND titles ("About City Barbeque") and the
//     full WELCOME-TXT body, whose opening sentence often names the employer
//     in patterns the prober's two regexes miss ("City Barbeque is a
//     fast-casual restaurant which serves...");
//   - the hosted page is dead: its title is the vendor's one generic word on
//     8/8 sampled boards, with no structured-data block and no og tags;
//   - DOCS-BRND filenames are employer-authored but dirty enough to violate
//     the discipline (a sampled bank's own PDFs misspell the bank), so they
//     are never used as a name source.
//
// The first full sweep (2026-08-31) taught two more lessons, both encoded
// below: (1) one employer writes its own name several ways — ampersand vs
// "and", hyphen vs space, okina vs plain vowel, acronym vs full form — and a
// resolver that compares raw strings calls that one voice a disagreement
// (186 postings sat behind a single ampersand), so candidate identity is
// judged on a normalized key with acronym folding; (2) opening-sentence
// prose sometimes introduces the ROLE or the pay, not the employer, so
// candidates that are job-title or compensation shrapnel are refused
// outright.
//
// SELECTION, in the empirically-earned order:
//   1. JD prose across up to 4 sampled requisition details. A candidate wins
//      only when at least two distinct postings yield the same name, or one
//      posting yields it and the name recurs verbatim in the body text of a
//      second. Two unrelated multi-posting names on one board -> ambiguous,
//      skipped (a staffing shell may serve several clients; one entry must
//      not claim them all).
//   2. WELCOME-TXT prose re-mined with the fuller pattern set, then
//      VIDEO-BRND titles; when both speak they must agree.
//   3. Nothing prose-borne -> unresolved, skipped. Hygiene throughout: a
//      candidate that is hiring vocabulary only, a pronoun phrase, a slug, or
//      sentence shrapnel is refused; Careers/Jobs/Career Site affixes are
//      stripped the way resolve-oracle-sites strips them.
//
// A JD-resolved name is cross-checked against the branding prose: when the
// welcome text or video titles yield a DIFFERENT employer name under the
// same extraction discipline, the board is FLAGGED and held out of resolved
// — flagged, never guessed.
//
// Politeness: every candidate hits the one shared vendor host, so the sweep
// holds to 5 workers at 250ms per-worker spacing, verify-all's ceiling for
// this vendor. Resume sidecars mirror verify-all: every finished token lands
// in .progress, every outcome record in .hits (JSONL) — a killed run
// continues where it stopped.
//
// Usage: node scripts/resolve-adp-names.mjs <adp-verified.json> <out.json>
// Output: { resolved: [{token,name,count,evidence}], unresolved: [...],
//           flagged: [...], stats: {...} } — resolved is the shape
//           merge-all's adp input expects.
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

const [, , VERIFIED_PATH, OUT] = process.argv;
if (!VERIFIED_PATH || !OUT) {
  console.error("usage: node scripts/resolve-adp-names.mjs <adp-verified.json> <out.json>");
  process.exit(1);
}
const verified = JSON.parse(fs.readFileSync(VERIFIED_PATH, "utf8"));
const boards = (verified.adp ?? []).filter((b) => !b.name);
console.log(`${boards.length} nameless adp boards to resolve`);

const CONCURRENCY = 5;
const SPACING_MS = 250;
const DETAILS_PER_BOARD = 4;
const UA = "resumebooster.work job board (contact: support@resumebooster.work)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── resume sidecars (verify-all's protocol) ────────────────────────────────
const PROGRESS_PATH = `${OUT}.progress`;
const HITS_PATH = `${OUT}.hits`;
const probed = new Set(fs.existsSync(PROGRESS_PATH) ? fs.readFileSync(PROGRESS_PATH, "utf8").split("\n").filter(Boolean) : []);
const priorRecords = fs.existsSync(HITS_PATH) ? fs.readFileSync(HITS_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
if (probed.size) console.log(`resuming: ${probed.size} already probed, ${priorRecords.length} prior records`);

// curl-backed like verify-all: node's fetch gets ECONNREFUSED from background
// contexts in this environment; async execFile keeps the concurrency real.
async function probe(url, asText = false, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await sleep(SPACING_MS);
    try {
      const { stdout } = await execFileP(
        "/usr/bin/curl",
        ["-s", "-m", "15", "-H", `User-Agent: ${UA}`, "-w", "\n__STATUS__%{http_code}", url],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      const cut = stdout.lastIndexOf("\n__STATUS__");
      if (cut < 0) return null;
      const status = Number(stdout.slice(cut + 11));
      const body = stdout.slice(0, cut);
      if (status === 429) { await sleep(8000 * (i + 1)); continue; }
      if (status < 200 || status >= 300) return null;
      return asText ? body : JSON.parse(body);
    } catch { await sleep(1500); }
  }
  return null;
}

// ── HTML -> prose, with block boundaries preserved as ¶ so a candidate can
// never bleed across a heading, list item, or paragraph the way it does when
// tags collapse to plain spaces (a sampled library's status line glued onto
// its own name until this marker existed).
function strip(html) {
  return String(html ?? "")
    .replace(/<\s*(?:\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/ul|\/ol|\/table|\/section|br\s*\/?)\s*>/gi, " ¶ ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&#8217;|&apos;/gi, "'")
    .replace(/&quot;|&#34;|&ldquo;|&rdquo;/gi, '"')
    // numeric entities decode to their real character; dash entities (with or
    // without their semicolon — a welcome text shipped a bare one) decode to a
    // dash, and a SPACED dash is a separator the way a block boundary is: a
    // heading like "Name - Role Wanted" must not glue into one candidate
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return " "; } })
    .replace(/&(?:ndash|mdash)\b;?/gi, "–")
    .replace(/&(?:hellip|bull|middot|lsquo|laquo|raquo|trade|reg|copy)\b;?/gi, " ")
    .replace(/\s[–—]\s/g, " ¶ ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── hygiene ────────────────────────────────────────────────────────────────
// verify-all's hiring vocabulary, widened with the generic entity/section
// nouns JD prose adds ("Our facility", "About The Role") — a candidate whose
// every word sits in this set carries no identity.
const VOCAB = new Set([
  "all", "and", "apply", "at", "available", "board", "career", "careers",
  "current", "currently", "default", "employment", "external", "for", "here",
  "hiring", "internal", "job", "jobs", "join", "listing", "listings", "new",
  "now", "open", "opening", "openings", "opportunities", "opportunity", "our",
  "page", "portal", "position", "positions", "posting", "postings",
  "recruiting", "recruitment", "search", "team", "the", "us", "vacancies",
  "vacancy", "we", "we're", "welcome", "with", "work",
  "about", "you", "your", "role", "this", "that", "it", "company", "facility",
  "organization", "organisation", "employer", "business", "location",
  "property", "community", "group", "staff", "member", "members", "employee",
  "employees", "people", "place", "family", "future", "today", "together",
  "success", "growth", "grow", "start", "responsibilities", "benefits",
  "requirements", "qualifications", "duties", "description", "summary",
  "overview", "department", "schedule", "salary", "compensation", "hours",
  "shift", "perks", "culture", "mission", "values", "story", "journey",
  "offer", "who", "what", "why", "where", "statement", "equal", "eeo",
  "association",
]);
// A short candidate built from job-title nouns is the ROLE the JD opens
// with, not the employer (a paving crew's JDs open with the trade itself).
const ROLE_WORDS = new Set([
  "mechanic", "driver", "technician", "nurse", "teacher", "cook", "server",
  "manager", "director", "coordinator", "assistant", "associate",
  "specialist", "supervisor", "operator", "laborer", "welder", "electrician",
  "plumber", "therapist", "accountant", "engineer", "analyst",
  "receptionist", "custodian", "dispatcher", "estimator", "foreman",
  "machinist", "painter", "carpenter", "clerk", "attendant", "aide",
  "intern", "recruiter", "housekeeper", "janitor", "cashier", "barista",
  "bartender", "stylist", "groomer", "caregiver", "cna", "lpn", "rn",
  "superintendent", "senior", "junior", "lead", "general", "a", "an",
]);
const PRONOUN_START = /^(?:we|our|you|your|it|this|that|these|those|there|i|are|is|do|does|did|if|when|come|ready|looking|thank|thanks|please|for|since|over|during|from|take|click|contact|actual)\b/i;
// Sentence shrapnel that passed the word-set test in round 1: pay ranges,
// application boilerplate, translation notes.
const JUNK_RE = /\b(?:salary|compensation|wage|pay|hourly|base)\s+ranges?\b|version of this|\bper hour\b|\bbenefits? package\b|page to complete|online application|\bcover letter\b|\bbackground check\b|\bjob description\b|\b(?:coordinator|manager|director|recruiter|assistant|specialist|supervisor|technician|officer)s?\s+at\s+|\bwanted\b|\bnow hiring\b/i;
const CONNECTORS = new Set(["of", "and", "the", "for", "at", "de", "la", "del", "di", "da", "van", "von", "&", "dba", "by"]);

function hygieneOk(name, token) {
  const n = String(name);
  if (n.length < 2 || n.length > 60) return false;
  if (!/[a-z]/i.test(n)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(n)) return false; // guid-shaped
  if (n.toLowerCase() === String(token).toLowerCase()) return false; // bare slug
  if (PRONOUN_START.test(n)) return false;
  if (JUNK_RE.test(n)) return false;
  const words = n.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  if (words.every((w) => VOCAB.has(w))) return false;
  if (words.every((w) => VOCAB.has(w) || ROLE_WORDS.has(w))) return false;
  return true;
}

function cleanup(name) {
  let n = String(name).replace(/\s+/g, " ").trim();
  // heading labels that ride in front of the name in the same block
  n = n.replace(/^(?:AAP\/?\s*)?EEO(?:\/AAP?)?(?:\s+Statement)?\s+/i, "")
    .replace(/^Equal (?:Employment )?Opportunity(?:\s+(?:Employer|Statement))?\s+/i, "");
  // an employer speaking of its own arm names itself in the possessive
  n = n.replace(/^(.{3,50}?)['’]s\s+(?:[A-Z][\w&-]*\s+){0,4}(?:Division|Department|Dept\.?)$/, "$1");
  n = n.replace(/^(.{3,50}?)['’]s\s+(?:\([A-Z0-9]{2,8}\)\s+)?mission$/i, "$1");
  n = n.replace(/^The (?:mission|vision|goal|purpose) of (?:the )?/i, "");
  // mixed-case shrapnel welded before an all-caps name: keep the all-caps tail
  const toks = n.split(" ");
  const caps = (t) => /^[A-Z0-9&'.,-]+$/.test(t) && /[A-Z]/.test(t);
  let s = toks.length;
  while (s > 0 && caps(toks[s - 1])) s--;
  if (s > 0 && s <= toks.length - 2 && toks.slice(0, s).some((t) => /[a-z]/.test(t))) n = toks.slice(s).join(" ");
  if (n.length > 60) {
    n = n.slice(0, 60);
    const sp = n.lastIndexOf(" ");
    if (sp > 30) n = n.slice(0, sp); // never ship a mid-word truncation
  }
  if (n.includes("(") && !n.includes(")")) n = n.slice(0, n.indexOf("(")); // unbalanced parenthetical tail
  n = n.replace(/^[\s,;:"'()–—-]+/, "").replace(/[\s,;:"'(–—-]+$/, "");
  n = n.replace(/\s+(Careers?|Jobs?|Career Site)$/i, ""); // resolve-oracle-sites' affix strip
  return n.trim();
}

// ── one employer, many spellings ───────────────────────────────────────────
// Identity is judged on a normalized key: diacritics/okina folded, ampersand
// read as "and", punctuation dropped. Acronyms fold into their full form via
// word initials, the display form's capital run, or a parenthetical the
// employer wrote itself.
const normKey = (s) => String(s).toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[ʻ‘’'`]/g, "")
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const SUFFIX_WORDS = new Set(["inc", "llc", "llp", "ltd", "corp", "co", "company", "pllc", "pc", "plc", "incorporated", "corporation"]);
const NORM_STOP = new Set(["the", "of", "and", "for", "a", "an", "at"]);
const sigWords = (s) => normKey(s).split(" ").filter((w) => w && !SUFFIX_WORDS.has(w) && !NORM_STOP.has(w));

function isAcronymOf(shortDisp, longDisp) {
  const sw = sigWords(shortDisp);
  const s = sw.join("");
  if (s.length < 2 || s.length > 8) return false;
  // several sig words are still one acronym when every one is written in
  // capitals ("BB&N" normalizes to two words; "DF LLP" to one plus a suffix)
  if (sw.length > 1) {
    const dispSig = String(shortDisp).split(/\s+/).filter((w) => {
      const k = normKey(w);
      return k && !SUFFIX_WORDS.has(k) && !NORM_STOP.has(k);
    });
    if (!dispSig.length || !dispSig.every((w) => /^[A-Z0-9&.'-]+$/.test(w))) return false;
  }
  const par = longDisp.match(/\(([^)]+)\)/);
  if (par && normKey(par[1]).replace(/ /g, "") === s) return true;
  const initials = sigWords(longDisp).map((w) => w[0]).join("");
  if (initials.length >= 2 && (initials === s || (s.length >= 3 && initials.startsWith(s)))) return true;
  const capsRun = [...longDisp].filter((c) => /[A-Z0-9]/.test(c)).join("").toLowerCase();
  return capsRun.length >= 2 && capsRun === s;
}

const wordContains = (longDisp, shortDisp) => ` ${normKey(longDisp)} `.includes(` ${normKey(shortDisp)} `);
const sameEmployer = (a, b) =>
  wordContains(a, b) || wordContains(b, a) || isAcronymOf(a, b) || isAcronymOf(b, a);

// ── extraction ─────────────────────────────────────────────────────────────
// Backward: the name precedes the anchor. Walk from the anchor to the nearest
// block/sentence boundary, then keep the capitalized-token tail.
const BACK_ANCHORS = [
  ["eoe", /,?\s+(?:is|are)\s+an?\s+[Ee]qual[\s-][Oo]pportunity/g],
  ["eoe-proud", /,?\s+is\s+proud\s+to\s+be\s+an?\s+[Ee]qual/g],
  ["eoe-provides", /,?\s+provides\s+[Ee]qual\s+[Ee]mployment\s+[Oo]pportunit/g],
  ["eoe-abbr", /,?\s+is\s+an\s+(?:EEO|EOE)\b/g],
];
function backNames(text, anchorRe) {
  const out = [];
  anchorRe.lastIndex = 0;
  let m;
  while ((m = anchorRe.exec(text))) {
    let slice = text.slice(Math.max(0, m.index - 90), m.index);
    for (const c of ["¶", "!", "?", ":", ";", "|", "•"]) {
      const i = slice.lastIndexOf(c);
      if (i >= 0) slice = slice.slice(i + 1);
    }
    // sentence period, but not an abbreviation's own dot
    const sb = [...slice.matchAll(/\.\s+/g)].filter((x) => !/\b(?:St|Mt|Dr|Mr|Mrs|Ms|Jr|Sr|Inc|Co|Corp|Ltd|No|Bros|U\.S)$/.test(slice.slice(0, x.index)));
    if (sb.length) slice = slice.slice(sb[sb.length - 1].index + sb[sb.length - 1][0].length);
    const toks = slice.trim().split(/\s+/).filter(Boolean);
    const kept = [];
    for (let i = toks.length - 1; i >= 0; i--) {
      const bare = toks[i].replace(/^[("'«]+|[,)"'»]+$/g, "");
      if (/^[A-Z0-9]/.test(bare)) { kept.unshift(toks[i]); continue; }
      if (CONNECTORS.has(bare.toLowerCase()) && kept.length) { kept.unshift(toks[i]); continue; }
      break;
    }
    while (kept.length && /^[a-z]/.test(kept[0])) kept.shift();
    if (kept.length) out.push(kept.join(" "));
  }
  return out;
}

// Forward: the name follows the anchor. ¶ and sentence punctuation end it.
const NAME_BODY = "(?:\\.(?!\\s)|[^\\u00B6.!?:;,|])";
const FWD_PATTERNS = [
  ["about", new RegExp(`\\bAbout\\s+([A-Z]${NAME_BODY}{1,58})`, "g")],
  ["at-we", new RegExp(`\\bAt\\s+([A-Z]${NAME_BODY}{1,58}?),\\s+(?:we|our|you)\\b`, "g")],
  ["join-team", new RegExp(`\\b[Jj]oin\\s+(?:the\\s+)?([A-Z]${NAME_BODY}{1,58}?)\\s+team\\b`, "g")],
  ["careers-at", new RegExp(`\\b[Cc]areers?\\s+(?:at|with)\\s+([A-Z]${NAME_BODY}{1,58})`, "g")],
  ["welcome-to", new RegExp(`\\b[Ww]elcome\\s+to\\s+([A-Z]${NAME_BODY}{1,58})`, "g")],
];
// Opening-sentence self-description — position 0 only, the way an employer
// introduces itself at the top of its own prose.
const LEAD_RE = new RegExp(`^([A-Z]${NAME_BODY}{1,58}?)\\s+(?:is|has been|was founded)\\s`);

function candidatesFrom(text, token) {
  const found = [];
  for (const [tag, re] of BACK_ANCHORS) for (const raw of backNames(text, re)) found.push({ raw, tag });
  for (const [tag, re] of FWD_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) found.push({ raw: m[1], tag });
  }
  const lead = text.match(LEAD_RE);
  if (lead) found.push({ raw: lead[1], tag: "lead" });
  const out = [];
  for (const f of found) {
    const name = cleanup(f.raw);
    if (hygieneOk(name, token)) out.push({ name, tag: f.tag });
  }
  return out;
}

// ── per-board resolution ───────────────────────────────────────────────────
const BASE = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1";

function pickWinner(cands, jdTexts) {
  // bucket by normalized key first — one voice, several spellings
  const byKey = new Map(); // normKey -> {variants: Map(display -> Set(jd)), jds:Set, tags:Set}
  for (const c of cands) {
    const key = normKey(c.name);
    if (!key) continue;
    const cur = byKey.get(key) ?? { variants: new Map(), jds: new Set(), tags: new Set() };
    const v = cur.variants.get(c.name) ?? new Set();
    v.add(c.jd);
    cur.variants.set(c.name, v);
    cur.jds.add(c.jd);
    cur.tags.add(c.tag);
    byKey.set(key, cur);
  }
  const display = (e) => [...e.variants.entries()].sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length)[0][0];
  // fold contained forms and acronyms into their fullest form
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  for (const long of keys) {
    for (const short of keys) {
      if (short === long || !byKey.has(short) || !byKey.has(long)) continue;
      if (short.length >= long.length) continue;
      const l = byKey.get(long), sh = byKey.get(short);
      if (wordContains(long, short) || isAcronymOf(display(sh), display(l))) {
        for (const id of sh.jds) l.jds.add(id);
        for (const t of sh.tags) l.tags.add(t);
        byKey.delete(short);
      }
    }
  }
  const scored = [...byKey.values()].map((e) => {
    const name = display(e);
    let support = e.jds.size;
    if (support === 1) {
      const inTexts = jdTexts.filter((t) => normKey(t).includes(normKey(name))).length;
      if (inTexts >= 2) support = inTexts; // recurs verbatim in other postings' bodies
    }
    return { name, jds: e.jds, tags: e.tags, support };
  }).filter((c) => c.support >= 2 || (c.jds.size >= 1 && jdTexts.length === 1));
  scored.sort((a, b) => b.support - a.support || b.name.length - a.name.length);
  if (!scored.length) return { status: "none" };
  if (scored.length > 1 && scored[1].support >= 2 && !sameEmployer(scored[0].name, scored[1].name)) {
    return { status: "ambiguous", names: scored.slice(0, 4).map((c) => c.name) };
  }
  return { status: "won", pick: scored[0] };
}

// A real contradiction is the branding prose naming a DIFFERENT employer
// under the same extraction discipline — not a marketing phrase or an
// address. Round 1 flagged eight boards on capitalized-run scraping and all
// eight hints were slogans; only pattern-extracted names (plus capitalized
// runs carrying a legal suffix) accuse now.
function brandingConflicts(welcomeProse, videoTitles, name, token) {
  const cands = [];
  if (welcomeProse) for (const c of candidatesFrom(welcomeProse, token)) cands.push(c.name);
  for (const t of videoTitles) {
    const m = t.match(/^(?:About|Welcome to)\s+(.{2,60})$/i);
    if (m) {
      const n = cleanup(m[1]);
      if (hygieneOk(n, token)) cands.push(n);
    }
  }
  for (const r of (welcomeProse ?? "").match(/[A-Z][\w&'.-]*(?:\s+(?:[A-Z][\w&'.-]*|of|and|the|for|&)){0,5}/g) ?? []) {
    if (!/\b(?:Inc|LLC|LLP|Corp|Corporation|Ltd|PLLC)\.?$/.test(r.trim())) continue;
    if (!sigWords(r).length) continue; // a bare legal suffix accuses no one
    const n = cleanup(r);
    if (hygieneOk(n, token)) cands.push(n);
  }
  // possessive-folded word sharing: "Wendel's Career Center" is Wendel's own voice
  const sfold = (w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  const sig = new Set(sigWords(name).map(sfold));
  const conflicts = [...new Set(cands)].filter((c) =>
    !sameEmployer(c, name) && !sigWords(c).some((w) => sig.has(sfold(w))));
  return conflicts.length ? conflicts.slice(0, 3) : null;
}

async function resolveBoard(b) {
  const [cid, ccIdRaw] = String(b.token).split("~");
  const ccId = ccIdRaw || "19000101_000001";
  const qs = () => `cid=${cid}&ccId=${ccId}&timeStamp=${Date.now()}&lang=en_US&locale=en_US`;

  const list = await probe(`${BASE}/job-requisitions?${qs()}&$top=6&$skip=1`);
  const reqs = list?.jobRequisitions;
  if (!Array.isArray(reqs)) return { token: b.token, count: b.count, status: "unresolved", reason: "list unreadable" };
  const ids = reqs.map((r) => r.itemID).filter(Boolean).slice(0, DETAILS_PER_BOARD);

  const jdTexts = [];
  const cands = []; // {name, tag, jd}
  for (const id of ids) {
    const det = await probe(`${BASE}/job-requisitions/${id}?${qs()}`);
    const text = strip(det?.requisitionDescription);
    if (!text) continue;
    jdTexts.push(text);
    for (const c of candidatesFrom(text, b.token)) cands.push({ ...c, jd: id });
  }

  // branding config: welcome prose for the cross-check, other types as fallback
  const links = await probe(`${BASE}/content-links/career-center?${qs()}`);
  let welcomeProse = "";
  const videoTitles = [];
  for (const cl of links?.contentLinks ?? []) {
    const code = cl?.linkTypeCode?.codeValue;
    if (code === "WELCOME-TXT") welcomeProse = strip(cl?.linkTypeCode?.longName);
    else if (code === "VIDEO-BRND") {
      const t = strip(cl?.linkTypeCode?.longName);
      if (t) videoTitles.push(t);
    }
  }

  const jd = pickWinner(cands, jdTexts);
  if (jd.status === "ambiguous") {
    return { token: b.token, count: b.count, status: "unresolved", reason: `ambiguous: ${jd.names.join(" / ")}` };
  }
  if (jd.status === "won") {
    const conflicts = brandingConflicts(welcomeProse, videoTitles, jd.pick.name, b.token);
    const evidence = `jd ${[...jd.pick.tags].join("+")} — ${jd.pick.jds.size}/${jdTexts.length} postings, support ${jd.pick.support}`;
    if (conflicts) {
      return { token: b.token, count: b.count, status: "flagged", name: jd.pick.name, evidence, welcomeHint: conflicts };
    }
    return { token: b.token, count: b.count, status: "resolved", name: jd.pick.name, evidence, source: "jd" };
  }

  // fallback: welcome prose with the fuller patterns, then video titles
  const wCands = welcomeProse ? candidatesFrom(welcomeProse, b.token) : [];
  const vCands = [];
  for (const t of videoTitles) {
    const m = t.match(/^(?:About|Welcome to)\s+(.{2,60})$/i);
    if (m) {
      const name = cleanup(m[1]);
      if (hygieneOk(name, b.token)) vCands.push(name);
    }
  }
  const wName = wCands.length ? wCands.sort((a, b2) => b2.name.length - a.name.length)[0] : null;
  const vName = vCands.length ? vCands.sort((a, b2) => b2.length - a.length)[0] : null;
  if (wName && vName) {
    if (!sameEmployer(wName.name, vName)) {
      return { token: b.token, count: b.count, status: "flagged", name: wName.name, evidence: `welcome-txt ${wName.tag}`, welcomeHint: [vName] };
    }
    const name = wName.name.length >= vName.length ? wName.name : vName;
    return { token: b.token, count: b.count, status: "resolved", name, evidence: `welcome-txt ${wName.tag} + video-brnd agree`, source: "welcome+video" };
  }
  if (wName) return { token: b.token, count: b.count, status: "resolved", name: wName.name, evidence: `welcome-txt ${wName.tag}`, source: "welcome" };
  if (vName) return { token: b.token, count: b.count, status: "resolved", name: vName, evidence: "video-brnd title", source: "video" };

  return { token: b.token, count: b.count, status: "unresolved", reason: jdTexts.length ? "no identity in jd or branding prose" : "no jd text" };
}

// ── sweep ──────────────────────────────────────────────────────────────────
const queue = boards.filter((b) => !probed.has(b.token));
const records = [...priorRecords];
const total = queue.length;
let done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const b = queue.shift();
    if (!b) return;
    let rec;
    try {
      rec = await resolveBoard(b);
    } catch (e) {
      rec = { token: b.token, count: b.count, status: "unresolved", reason: String(e.message ?? e).slice(0, 60) };
    }
    records.push(rec);
    fs.appendFileSync(HITS_PATH, JSON.stringify(rec) + "\n");
    fs.appendFileSync(PROGRESS_PATH, b.token + "\n");
    if (++done % 25 === 0) {
      console.log(`  ${done}/${total} this run — resolved ${records.filter((x) => x.status === "resolved").length}, flagged ${records.filter((x) => x.status === "flagged").length}, unresolved ${records.filter((x) => x.status === "unresolved").length}`);
    }
  }
}));

const resolved = records.filter((r) => r.status === "resolved").map(({ token, name, count, evidence }) => ({ token, name, count, evidence }));
const flagged = records.filter((r) => r.status === "flagged").map(({ token, name, count, evidence, welcomeHint }) => ({ token, name, count, evidence, welcomeHint }));
const unresolved = records.filter((r) => r.status === "unresolved").map(({ token, count, reason }) => ({ token, count, reason }));
resolved.sort((a, b) => b.count - a.count);

const stats = {};
for (const r of records.filter((x) => x.status === "resolved")) stats[r.source ?? "jd"] = (stats[r.source ?? "jd"] ?? 0) + 1;
fs.writeFileSync(OUT, JSON.stringify({ resolved, unresolved, flagged, stats }, null, 1));

const postings = resolved.reduce((n, b) => n + b.count, 0);
console.log(`\nresolved ${resolved.length}/${boards.length} boards (${postings.toLocaleString()} postings), flagged ${flagged.length}, unresolved ${unresolved.length} -> ${OUT}`);
console.log("by source:", JSON.stringify(stats));
console.log("top 10:", resolved.slice(0, 10).map((b) => `${b.name} (${b.count})`).join(", "));
