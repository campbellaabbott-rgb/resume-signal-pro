# shellcheck shell=bash
# ── 99zzzzzzz-bugs-copy-i18n. THE BUG ROUND OF 2026-11-08, LANE COPY-I18N
# (branch bugs/a-copy-i18n; owner halves on bugs/a-copy-i18n-owner): the nine
# main string bundles, the Trust page's retention table and the edge-error
# module, which the merge itself publishes. The lane changes no function and
# no migration.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE CHUNKS, read from production, never assumed: / names the entry
# (/assets/index-*.js), and the entry names every language's string chunks.
# English ships as rb-en_*-XXXXXXXX.js, each a JSON.parse of one template
# literal; every other language as <lng>-XXXXXXXX.js, a module whose
# namespaces are object literals exported by name (V as trustPage). A
# language's main bundle is its chunk that exports jobsPage, its changelog the
# one that exports changelogEntries. Both forms are PARSED here, and a key is
# read at its own path (trustPage.retention.rows.agent is not agent.reach),
# never matched anywhere in a chunk. The edge-error module is found by its
# telemetry call and a server sentence its map keeps, in the entry or in the
# 40 chunks the most pages load. /trust is read as a crawler reads it.
#
# THE STAGE: a language bundle serves the edgeErrors namespace (only this lane
# writes that root). Until one does, every claim is INFO ("not yet
# published"); from then on each one is PASS or FAIL.
#
# THE CLAIMS, one line each (by key):
#   L0  the entry and all nine main bundles can be read, and four keys every
#       bundle has served for months resolve in all nine (FAIL when the
#       layout moved: nothing below could be judged).
#   L1  the stage.
#   S14X-176  nine counted strings have _one and _other in all nine languages
#             (and _many in es, fr and pt).
#   S14X-232  the Trust row says deleting the account erases the agent's CV
#             file as well as its text: /trust says so, and no language keeps
#             its old 'email us to have the file erased' clause.
#   S14X-097  the browser-storage row names signing out, on /trust and in each
#             language's own words.
#   S14X-253  the coverage strip, eyebrow, counted line and as-of line and the
#             free results page's board button are strings in all nine.
#   S14X-183  edge errors are a served namespace in all nine (with the 422
#             entry), and the module reads edgeErrors keys and maps a 422.
#   S14X-109  the module maps ai_unavailable and the gateway's 'credits
#             depleted' 402 to a retryable outage.
#   S14X-110  the module maps model_busy and limiter_unavailable.
#   S14X-225  the unsubscribe line no longer says the agent keeps running, in
#             any language, and the page's tab title is a string in all nine.
#   S14X-178  Hindi and Tagalog say the network rate limit in their own words.
#   S14X-291  no English bundle calls the fit score a share of keywords, the
#             fit tooltip prints no percent, and the retired coverage key is
#             gone.
#   NEW-COPY-I18N-02  the retired agent's panels have their strings in all nine.
#   O1  S14X-073 rule A (owner-gated): the Shortlist row names the four-year
#       deletion, on /trust and in every language.
#   O2  S14X-012 option B (owner-gated): no bundle, no FixPlanConfirm chunk and
#       no /trust row promises fix-plan emails.
#   O3  NB-11 (owner-gated): the Pro card's badge names the plan, not the
#       writing tools.
#   O4  NB-47 (owner-gated): the board's ticker says postings taken down, not
#       roles filled.
#   An owner line prints INFO 'owner pending' until
#   reservations['bug-round'].ownerDecided in docs/deploy-ledger.json names its
#   key.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite (INFO line X1): that every
# literal key a page asks for resolves in nine languages
# (every-key-a-page-asks-for-is-served-in-nine-languages), that a count of one
# renders the singular (a-count-of-one-is-said-in-the-singular), and that an
# answer's code is read before its sentence (an-edge-error-is-said-in-the-
# readers-language).
#
# READ-ONLY. GETs of /, /trust, the entry, the string chunks it names, at most
# 40 shared chunks and the FixPlanConfirm chunk. Nothing is posted.
echo "== 99zzzzzzz-bugs-copy-i18n. bug round, copy-i18n lane: the nine string bundles, the Trust rows and edge errors in the reader's language =="

rm -rf /tmp/vd_bci_home.html /tmp/vd_bci_entry.js /tmp/vd_bci_trust.html /tmp/vd_bci_fpc.js /tmp/vd_bci_edge.js /tmp/vd_bci_strings.txt /tmp/vd_bci_shared.txt /tmp/vd_bci_c
mkdir -p /tmp/vd_bci_c
VDCI_LEDGER="${VDCI_LEDGER:-docs/deploy-ledger.json}"

# Owner answers, from the ledger the integrator writes: the decided value, or empty.
# An answer is a string, or an object whose choice (or option) names it: the
# plan records {choice, rule}, and the rule's words are not the answer.
vdci_owner() { # $1 key
  VDCI_K="$1" node -e 'const fs=require("fs");let d=null;try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{}const o=d&&d.reservations&&d.reservations["bug-round"]&&d.reservations["bug-round"].ownerDecided;const r=o&&typeof o==="object"&&Object.prototype.hasOwnProperty.call(o,process.env.VDCI_K)?o[process.env.VDCI_K]:null;const v=r&&typeof r==="object"&&typeof (r.choice??r.option)==="string"?(r.choice??r.option):r;console.log(v===null||v===undefined?"":(typeof v==="string"?v:JSON.stringify(v)).replace(/\s+/g," ").slice(0,80)||"decided")' "$VDCI_LEDGER"
}
VDCI_O073=$(vdci_owner S14X-073)
VDCI_O012=$(vdci_owner S14X-012)
VDCI_ONB11=$(vdci_owner NB-11)
VDCI_ONB47=$(vdci_owner NB-47)

# The pages and the entry.
curl -s -m 30 "$SITE/" > /tmp/vd_bci_home.html
curl -s -m 30 -A "$UA" "$SITE/trust" > /tmp/vd_bci_trust.html
VDCI_ENTRY=$(grep -ao '/assets/index-[A-Za-z0-9_-]*\.js' /tmp/vd_bci_home.html | head -1)
[ -n "$VDCI_ENTRY" ] && curl -s -m 60 "$SITE$VDCI_ENTRY" > /tmp/vd_bci_entry.js

# The string chunks the entry names, and the shared chunks ranked by how many
# of its dynamic imports load them (the edge-error module is imported by most pages).
[ -s /tmp/vd_bci_entry.js ] && node -e '
const fs = require("fs");
const s = fs.readFileSync(process.argv[1], "utf8");
const names = new Set();
for (const m of s.matchAll(/(?:\.\/|assets\/)([A-Za-z0-9_.-]+\.js)/g)) names.add(m[1]);
const STR = /^(?:(?:en-GB|en|de|es|fr|hi|nl|pt|tl)-[A-Za-z0-9_-]{8}|rb-en_[A-Za-z_]+-[A-Za-z0-9_-]{8})\.js$/;
fs.writeFileSync(process.argv[2], [...names].filter((n) => STR.test(n)).sort().join("\n") + "\n");
let deps = [];
try { deps = JSON.parse((/m\.f=(\[[^\]]*\])/.exec(s) || [])[1] || "[]"); } catch { deps = []; }
const count = new Map();
for (const m of s.matchAll(/__vite__mapDeps\(\[([\d,]+)\]\)/g)) for (const i of m[1].split(",")) count.set(+i, (count.get(+i) || 0) + 1);
const ranked = [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i]) => String(deps[i] || "").replace(/^assets\//, "")).filter((n) => /^[A-Za-z0-9_.-]+\.js$/.test(n) && !STR.test(n));
fs.writeFileSync(process.argv[3], ranked.slice(0, 40).join("\n") + "\n");
' /tmp/vd_bci_entry.js /tmp/vd_bci_strings.txt /tmp/vd_bci_shared.txt
[ -s /tmp/vd_bci_strings.txt ] && grep -a '\.js$' /tmp/vd_bci_strings.txt | xargs -P 6 -I{} curl -s -m 60 -o /tmp/vd_bci_c/{} "$SITE/assets/{}"

# The edge-error module: in the entry, or the first shared chunk that holds it.
VDCI_EDGE=""
if [ -s /tmp/vd_bci_entry.js ] && grep -aqF 'Payment verification required.' /tmp/vd_bci_entry.js && grep -aqF 'log_error_telemetry' /tmp/vd_bci_entry.js; then
  VDCI_EDGE="${VDCI_ENTRY#/assets/}"; cp /tmp/vd_bci_entry.js /tmp/vd_bci_edge.js
elif [ -s /tmp/vd_bci_shared.txt ]; then
  while read -r VDCI_F; do
    [ -n "$VDCI_F" ] || continue
    curl -s -m 60 "$SITE/assets/$VDCI_F" < /dev/null > /tmp/vd_bci_edge.js
    if grep -aqF 'Payment verification required.' /tmp/vd_bci_edge.js && grep -aqF 'log_error_telemetry' /tmp/vd_bci_edge.js; then VDCI_EDGE="$VDCI_F"; break; fi
  done < /tmp/vd_bci_shared.txt
  [ -n "$VDCI_EDGE" ] || rm -f /tmp/vd_bci_edge.js
fi

# The fix-plan confirmation page's chunk (owner line O2).
VDCI_FPC=$( { [ -s /tmp/vd_bci_entry.js ] && grep -ao 'FixPlanConfirm-[A-Za-z0-9_-]*\.js' /tmp/vd_bci_entry.js; } | head -1)
[ -n "$VDCI_FPC" ] && curl -s -m 60 "$SITE/assets/$VDCI_FPC" > /tmp/vd_bci_fpc.js

VDCI_N_ENTRY="$VDCI_ENTRY" VDCI_N_EDGE="$VDCI_EDGE" VDCI_N_FPC="$VDCI_FPC" \
VDCI_O073="$VDCI_O073" VDCI_O012="$VDCI_O012" VDCI_ONB11="$VDCI_ONB11" VDCI_ONB47="$VDCI_ONB47" node -e '
const fs = require("fs");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const E = process.env;
const say = (v, id, m) => console.log(v + "  " + id + " " + m);
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const DIR = "/tmp/vd_bci_c/";
const FILES = (() => { try { return fs.readdirSync(DIR).filter((f) => /\.js$/.test(f)).sort(); } catch { return []; } })();
const TEXT = new Map(FILES.map((f) => [f, rd(DIR + f)]));
const ENTRY = rd("/tmp/vd_bci_entry.js"), TRUST = rd("/tmp/vd_bci_trust.html"), EDGE = rd("/tmp/vd_bci_edge.js"), FPC = rd("/tmp/vd_bci_fpc.js");
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// A JS literal as esbuild prints one: objects, arrays, strings in any quote,
// numbers, !0/!1. A bare name stays a {ref}. Throws on anything else.
function skip(s, i) { while (i < s.length && /\s/.test(s[i])) i++; return i; }
function str(s, i) {
  const q = s[i]; let out = ""; i++;
  while (i < s.length) {
    const c = s[i];
    if (c === q) return [out, i + 1];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === "n") out += "\n"; else if (n === "t") out += "\t"; else if (n === "r") out += "\r";
      else if (n === "b") out += "\b"; else if (n === "f") out += "\f"; else if (n === "v") out += "\v";
      else if (n === "x") { out += String.fromCharCode(parseInt(s.substr(i + 2, 2), 16)); i += 4; continue; }
      else if (n === "u") {
        if (s[i + 2] === "{") { const j = s.indexOf("}", i + 3); out += String.fromCodePoint(parseInt(s.slice(i + 3, j), 16)); i = j + 1; continue; }
        out += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)); i += 6; continue;
      }
      else if (n === "\n") { /* a line continuation */ }
      else if (n === "\r") { if (s[i + 2] === "\n") i++; }
      else if (n === "0" && !/[0-9]/.test(s[i + 2] || "")) out += "\0";
      else out += n;
      i += 2; continue;
    }
    if (q === "`" && c === "$" && s[i + 1] === "{") throw new Error("a template expression at " + i);
    out += c; i++;
  }
  throw new Error("an unterminated string");
}
function val(s, i) {
  i = skip(s, i);
  const c = s[i];
  if (c === "{" || c === "[") {
    const obj = c === "{", o = obj ? {} : [];
    i = skip(s, i + 1);
    if (s[i] === (obj ? "}" : "]")) return [o, i + 1];
    for (;;) {
      i = skip(s, i);
      if (obj) {
        let k;
        if (s[i] === "\"" || s[i] === "\x27" || s[i] === "`") [k, i] = str(s, i);
        else { const m = /^[A-Za-z0-9_$]+/.exec(s.slice(i, i + 200)); if (!m) throw new Error("a key at " + i); k = m[0]; i += k.length; }
        i = skip(s, i);
        if (s[i] !== ":") throw new Error("no colon at " + i);
        let v; [v, i] = val(s, i + 1); o[k] = v;
      } else { let v; [v, i] = val(s, i); o.push(v); }
      i = skip(s, i);
      if (s[i] === ",") { i = skip(s, i + 1); if (s[i] === (obj ? "}" : "]")) return [o, i + 1]; continue; }
      if (s[i] === (obj ? "}" : "]")) return [o, i + 1];
      throw new Error("an unclosed " + (obj ? "object" : "array") + " at " + i);
    }
  }
  if (c === "\"" || c === "\x27" || c === "`") return str(s, i);
  if (c === "!" && (s[i + 1] === "0" || s[i + 1] === "1")) return [s[i + 1] === "0", i + 2];
  const m = /^-?(?:\d[\d.]*(?:e[+-]?\d+)?|\.\d+)|^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 100));
  if (!m) throw new Error("a value at " + i);
  const t = m[0];
  return [/^-?[\d.]/.test(t) ? Number(t) : t === "true" ? true : t === "false" ? false : t === "null" ? null : { ref: t }, i + t.length];
}
const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A module chunk: its exports, each parsed only when asked for.
function moduleBundle(s) {
  const ex = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(s.trim());
  const names = new Map();
  for (const part of (ex ? ex[1] : "").split(",")) { const m = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part); if (m) names.set(m[2] || m[1], m[1]); }
  const cache = new Map();
  return {
    has: (ns) => names.has(ns),
    ns(nsName) {
      if (cache.has(nsName)) return cache.get(nsName);
      let out;
      const local = names.get(nsName);
      if (local) {
        const d = new RegExp("(?:^|[\\s,;])(?:const |let |var )?" + esc(local) + "=(?=[{\\[])").exec(s);
        if (d) { try { out = val(s, d.index + d[0].length)[0]; } catch { out = undefined; } }
      }
      cache.set(nsName, out);
      return out;
    },
  };
}
// The English chunks: each hands the entry one bundle, as a JSON.parse of a
// string literal or, for a small namespace, as an object literal.
function jsonBundle(s) {
  const m = /JSON\.parse\(\s*(?=["\x27`])/.exec(s);
  if (m) { try { return JSON.parse(str(s, m.index + m[0].length)[0]); } catch { return null; } }
  const o = /^import\s*\{[^}]*\}\s*from\s*["\x27][^"\x27]*["\x27];?\s*[\w$]+\(\s*(?=\{)/.exec(s);
  if (!o) return null;
  try { const v = val(s, o[0].length)[0]; return isObj(v) ? v : null; } catch { return null; }
}
function merge(a, b) { for (const [k, v] of Object.entries(b)) a[k] = isObj(a[k]) && isObj(v) ? merge(a[k], v) : v; return a; }

// Per language: its main bundle(s) and its changelog chunk.
const lngOf = (f) => (/^rb-en_[A-Za-z_]+-[A-Za-z0-9_-]{8}\.js$/.test(f) ? "en" : ((/^(en-GB|en|de|es|fr|hi|nl|pt|tl)-[A-Za-z0-9_-]{8}\.js$/.exec(f) || [])[1] || ""));
const MAIN = {}, CHANGELOG = {}, NAMES = {};
for (const l of LNGS) { MAIN[l] = []; NAMES[l] = []; }
for (const [f, t] of TEXT) {
  const l = lngOf(f);
  if (!l) continue;
  if (/^rb-en_/.test(f)) {
    const j = jsonBundle(t);
    if (j) { MAIN.en.push({ has: (ns) => ns in j, ns: (ns) => j[ns] }); NAMES.en.push(f); }
    continue;
  }
  if (/\bas changelogEntries\b|[{,]changelogEntries:/.test(t) && !/\bas jobsPage\b/.test(t)) { CHANGELOG[l] = { f, t }; continue; }
  if (l !== "en" && /\bas jobsPage\b/.test(t)) { MAIN[l].push(moduleBundle(t)); NAMES[l].push(f); }
}
const get = (l, path) => {
  const [ns, ...rest] = path.split(".");
  for (const b of MAIN[l]) {
    if (!b.has(ns)) continue;
    let o = b.ns(ns);
    for (const p of rest) o = isObj(o) ? o[p] : undefined;
    if (o !== undefined) return o;
  }
  return undefined;
};
const str_ = (l, path) => { const v = get(l, path); return typeof v === "string" ? v : null; };
const missingIn = (pred) => LNGS.filter((l) => !pred(l));
const named = (ls) => (ls.length === 9 ? "all nine" : ls.join(", "));

// L0: the layout.
const unread = [];
if (!E.VDCI_N_ENTRY || !ENTRY) unread.push("the entry (/assets/index-*.js)");
const noMain = missingIn((l) => MAIN[l].length > 0);
if (ENTRY && noMain.length) unread.push("the main string bundle of " + named(noMain));
const CONTROLS = ["atsCoverage.heading", "uploader.otherJobsAvailable_one", "freeResults.matches.title", "jobsPage.dropRateLimited"];
if (ENTRY && !noMain.length) for (const k of CONTROLS) { const m = missingIn((l) => str_(l, k) !== null); if (m.length) unread.push(k + " in " + named(m)); }
const blind = unread.length > 0;
if (blind) say("FAIL", "L0", "the string bundles could not be read down to " + unread.join("; ") + ": the bundle layout moved, so no claim of this lane can be judged");
else say("INFO", "L0", "bundles read: " + LNGS.map((l) => l + " " + NAMES[l].length).join(", ") + " chunk(s); changelogs " + Object.keys(CHANGELOG).length + "; edge-error module " + (E.VDCI_N_EDGE || "not found") + "; FixPlanConfirm " + (E.VDCI_N_FPC || "not named") + "; /trust " + (TRUST.length ? TRUST.length + " bytes" : "empty"));

// L1: the stage.
const servesEdge = LNGS.filter((l) => isObj(get(l, "edgeErrors")));
const live = !blind && servesEdge.length > 0;
if (blind) { /* nothing to stage */ }
else if (live) say("PASS", "L1", "a published bundle serves the lane\x27s edgeErrors namespace (" + named(servesEdge) + "): the merge carrying the round published");
else say("INFO", "L1", "no published bundle serves an edgeErrors namespace: the merge carrying the round has not published, so each claim below is INFO");

const trustRead = /<\/td>/.test(TRUST);
const NEED = { trust: () => trustRead, edge: () => !!EDGE, fpc: () => !!FPC };
const NEEDNAME = { trust: "/trust as a crawler reads it", edge: "the edge-error module (found by its telemetry call and \x27Payment verification required.\x27 in the entry or the 40 most shared chunks)", fpc: "the FixPlanConfirm chunk" };
const claim = (id, what, need, test) => {
  if (blind) return;
  const gone = need.filter((n) => !NEED[n]());
  if (!live) {
    let today = "";
    if (!gone.length) { try { if (test()[0]) today = " (already holds today)"; } catch { /* judged after the merge */ } }
    say("INFO", id, what + ": not yet published" + today);
    return;
  }
  if (gone.length) { say("FAIL", id, what + ": " + gone.map((n) => NEEDNAME[n]).join(" and ") + " could not be read"); return; }
  const [ok, why] = test();
  say(ok ? "PASS" : "FAIL", id, what + (ok ? "" : " — but " + why));
};
const rowCell = (anchor) => { const at = TRUST.indexOf(anchor); return at < 0 ? null : ((TRUST.slice(at).match(/<\/td><td[^>]*>([^<]*)<\/td>/) || [])[1] ?? null); };
const rowHowLong = (what) => { const at = TRUST.indexOf(what + "</th>"); return at < 0 ? null : ((TRUST.slice(at).match(/^[^]*?<td[^>]*>[^<]*<\/td><td[^>]*>([^<]*)<\/td>/) || [])[1] ?? null); };

const PLURALS = ["freeResults.actionBanner.issuesFound", "jobsPage.a11yResults", "freeResults.lockedInsights.kwDescWithStats", "homepage.toast.unreadCharactersDescription", "jobKeywordMatcher.topActions", "jobsPage.fuzzyExtraLine", "jobsPage.hiddenCount", "jobsPage.hiddenByViews", "accountPage.tracked"];
claim("S14X-176", "nine counted strings say a count of one in the singular: _one and _other in all nine languages, _many in es, fr and pt", [],
  () => {
    const bad = [];
    for (const k of PLURALS) {
      const m = missingIn((l) => str_(l, k + "_one") !== null && str_(l, k + "_other") !== null && (!["es", "fr", "pt"].includes(l) || str_(l, k + "_many") !== null));
      if (m.length) bad.push(k + " (" + named(m) + ")");
    }
    return [bad.length === 0, "no full plural group for " + bad.join(", ")];
  });

const DELETE_OLD = { en: "to have the file erased", "en-GB": "to have the file erased", de: "um die Datei löschen zu lassen", es: "para que borremos el archivo", fr: "pour faire effacer le fichier", hi: "फ़ाइल मिटवाने के लिए", nl: "om het bestand te laten wissen", pt: "para apagar o ficheiro", tl: "para ipabura ang file" };
claim("S14X-232", "the Trust page says deleting the account erases the agent\x27s CV file as well as its text, in every language", ["trust"],
  () => {
    const why = [];
    if (TRUST.includes(DELETE_OLD.en)) why.push("/trust still says email us \x27to have the file erased\x27");
    if (!TRUST.includes("erases both the text and the file")) why.push("/trust does not say deleting the account \x27erases both the text and the file\x27");
    const m = missingIn((l) => { const v = str_(l, "trustPage.retention.rows.agent.howLong"); return v !== null && !v.includes(DELETE_OLD[l]); });
    if (m.length) why.push("the agent row keeps its old clause, or is missing, in " + named(m));
    return [why.length === 0, why.join("; ")];
  });

const SIGN_OUT = { en: /signing out/i, "en-GB": /signing out/i, de: /Abmelden/, es: /cerrar sesión/, fr: /déconnexion/, hi: /साइन आउट/, nl: /uitloggen/, pt: /sair da conta/, tl: /pag-sign out/ };
claim("S14X-097", "the browser-storage row says signing out on the device clears it, on /trust and in each language\x27s words", ["trust"],
  () => {
    const cell = rowCell("local storage, on your device</td>");
    const why = [];
    if (cell === null) why.push("/trust has no browser-storage row (found by its \x27local storage, on your device\x27 cell)");
    else if (!/signing out/i.test(cell)) why.push("/trust\x27s row reads \x27" + cell.slice(0, 80) + "…\x27");
    const m = missingIn((l) => SIGN_OUT[l].test(str_(l, "trustPage.retention.rows.browserLocal.howLong") || ""));
    if (m.length) why.push("the row names no signing out in " + named(m));
    return [why.length === 0, why.join("; ")];
  });

const STRIP = ["atsCoverage.stripHeading", "atsCoverage.stripSub", "atsCoverage.subCounted", "atsCoverage.eyebrow", "atsCoverage.asOf", "freeResults.matches.openBoard"];
claim("S14X-253", "the coverage strip, eyebrow, counted and as-of lines and the free results page\x27s board button are strings in all nine languages", [],
  () => { const bad = STRIP.map((k) => [k, missingIn((l) => str_(l, k) !== null)]).filter(([, m]) => m.length); return [bad.length === 0, bad.map(([k, m]) => k + " is missing in " + named(m)).join("; ")]; });

claim("S14X-183", "an edge error is said in the reader\x27s language: the edgeErrors namespace (with its 422 entry) in all nine, and the module reads edgeErrors keys and has a 422 entry", ["edge"],
  () => {
    const why = [];
    const m = missingIn((l) => str_(l, "edgeErrors.status422.title") !== null && str_(l, "edgeErrors.unknown.title") !== null);
    if (m.length) why.push("edgeErrors is not served in " + named(m));
    if (!/edgeErrors\./.test(EDGE)) why.push("the module reads no edgeErrors key");
    if (!/(?:^|[{,\s])422\s*:\s*\{/.test(EDGE)) why.push("the module has no 422 entry");
    return [why.length === 0, why.join("; ")];
  });
claim("S14X-109", "the module answers code ai_unavailable and the gateway\x27s \x27credits depleted\x27 402 as a retryable outage, never a payment", ["edge"],
  () => [/\bai_unavailable\s*:/.test(EDGE) && EDGE.includes("credits depleted"), "the module maps " + [/\bai_unavailable\s*:/.test(EDGE) ? "" : "no ai_unavailable code", EDGE.includes("credits depleted") ? "" : "no \x27credits depleted\x27 sentence"].filter(Boolean).join(" and ")]);
claim("S14X-110", "the module answers model_busy and limiter_unavailable as a retryable busy answer", ["edge"],
  () => [/\bmodel_busy\s*:/.test(EDGE) && /\blimiter_unavailable\s*:/.test(EDGE), "the module maps " + ["model_busy", "limiter_unavailable"].filter((c) => !new RegExp("\\b" + c + "\\s*:").test(EDGE)).join(" and ") + " to nothing"]);

const KEEPS_RUNNING = { en: "Your agent keeps running", "en-GB": "Your agent keeps running", de: "Ihr Agent läuft weiter", es: "Tu agente sigue funcionando", fr: "Votre agent continue de tourner", hi: "आपका एजेंट चलता रहेगा", nl: "Je agent blijft draaien", pt: "O seu agente continua a funcionar", tl: "Patuloy na tatakbo ang iyong agent" };
claim("S14X-225", "the unsubscribe page says the apply agent is retired, never that it keeps running, and its tab title is a string, in all nine languages", [],
  () => {
    const why = [];
    const run = missingIn((l) => { const v = str_(l, "emailUnsubscribe.agentDigest"); return v !== null && !v.includes(KEEPS_RUNNING[l]); });
    if (run.length) why.push("emailUnsubscribe.agentDigest says the agent keeps running, or is missing, in " + named(run));
    const meta = missingIn((l) => str_(l, "emailUnsubscribe.metaTitle") !== null);
    if (meta.length) why.push("emailUnsubscribe.metaTitle is missing in " + named(meta));
    return [why.length === 0, why.join("; ")];
  });

const DROP_EN = "Too many scans from this network for now";
claim("S14X-178", "Hindi and Tagalog say the network rate limit in their own language", [],
  () => { const bad = ["hi", "tl"].filter((l) => { const v = str_(l, "jobsPage.dropRateLimited"); return v === null || v.includes(DROP_EN); }); return [bad.length === 0, "jobsPage.dropRateLimited is the English sentence, or missing, in " + bad.join(", ")]; });

const SHARE = ["of the posting\x27s recognized keywords are in your resume", "of this posting\x27s recognized keywords are already in your resume"];
claim("S14X-291", "no bundle calls the keyword fit score a share of the posting\x27s keywords", [],
  () => {
    const why = [];
    const enText = FILES.filter((f) => lngOf(f) === "en" && /^rb-en_/.test(f)).map((f) => TEXT.get(f)).join("\n");
    const hits = SHARE.filter((p) => enText.includes(p));
    if (hits.length) why.push("an English bundle still says \x27" + hits[0] + "\x27");
    const pct = missingIn((l) => { const v = str_(l, "accountPage.acFitTitle"); return v !== null && !/\{\{pct\}\}\s*%/.test(v); });
    if (pct.length) why.push("accountPage.acFitTitle prints {{pct}} as a percent, or is missing, in " + named(pct));
    const cov = LNGS.filter((l) => get(l, "jobsPage.matchCoverage") !== undefined);
    if (cov.length) why.push("the retired jobsPage.matchCoverage is still served in " + named(cov));
    return [why.length === 0, why.join("; ")];
  });

const PANELS = ["agentControls.blocklist.title", "agentControls.pause.title", "agentNight.title", "agent.reach.title", "agentSetup.title", "receipt.title", "agentQueue.countryAny", "morningQueue.qPlaceholder", "accountPage.notifAgentEmail"];
claim("NEW-COPY-I18N-02", "the retired agent\x27s panels a past buyer still sees have their strings in all nine languages", [],
  () => { const bad = PANELS.map((k) => [k, missingIn((l) => str_(l, k) !== null)]).filter(([, m]) => m.length); return [bad.length === 0, bad.map(([k, m]) => k + " is missing in " + named(m)).join("; ")]; });

if (!blind) say("INFO", "X1", "proved in the suite, not from outside: every literal key a page asks for resolves in nine languages, a count of one renders the singular, and an answer\x27s code is read before its sentence");

// Owner-gated.
const FOUR = { en: /four years/, "en-GB": /four years/, de: /vier Jahre/, es: /cuatro años/, fr: /quatre ans/, hi: /चार साल/, nl: /vier jaar/, pt: /quatro anos/, tl: /apat na taon/ };
const SHORTLIST_WHAT = "Candidates\x27 resumes an employer screens with Shortlist";
const ruleIs = (v, r) => new RegExp("(^|[^A-Za-z])" + r + "([^A-Za-z]|$)").test(v);
if (blind) { /* O1 reads the bundles */ }
else if (!E.VDCI_O073) say("INFO", "O1", "the Shortlist row names the employer\x27s delete and the four-year deletion (S14X-073 rule A): owner pending");
else if (!ruleIs(E.VDCI_O073, "A") && !ruleIs(E.VDCI_O073, "B")) say("INFO", "O1", "S14X-073 decided \"" + E.VDCI_O073 + "\": not a rule this section judges");
else if (!live) say("INFO", "O1", "the Shortlist row states S14X-073 rule " + (ruleIs(E.VDCI_O073, "A") ? "A" : "B") + ": not yet published");
else if (!trustRead) say("FAIL", "O1", "S14X-073 is decided but /trust could not be read");
else {
  const cell = rowHowLong(SHORTLIST_WHAT);
  if (ruleIs(E.VDCI_O073, "A")) {
    const m = missingIn((l) => FOUR[l].test(str_(l, "trustPage.retention.rows.shortlist.howLong") || ""));
    const ok = cell !== null && /four years/.test(cell) && !m.length;
    say(ok ? "PASS" : "FAIL", "O1", "the Shortlist row names the employer\x27s delete and the four-year deletion (S14X-073 rule A)" + (ok ? "" : " — but " + [cell === null ? "/trust has no Shortlist row" : /four years/.test(cell) ? "" : "/trust\x27s row reads \x27" + cell.slice(0, 80) + "\x27", m.length ? "no four-year deletion in " + named(m) : ""].filter(Boolean).join("; ")));
  } else {
    const ok = cell !== null && !cell.includes("Until the employer deletes them");
    say(ok ? "PASS" : "FAIL", "O1", "the Shortlist row no longer says it is kept until the employer deletes them (S14X-073 rule B)" + (ok ? "" : " — but " + (cell === null ? "/trust has no Shortlist row" : "/trust still says it")));
  }
}

const FIRST_MAIL = { en: "The first email arrives in two days", "en-GB": "The first email arrives in two days", de: "Die erste E-Mail kommt in zwei Tagen", es: "El primer correo llega en dos días", fr: "Le premier e-mail arrive dans deux jours", hi: "पहला ईमेल दो दिन में आएगा", nl: "De eerste e-mail komt over twee dagen", pt: "O primeiro e-mail chega em dois dias", tl: "Darating ang unang email sa loob ng dalawang araw" };
const FIX_PLAN_ROW = ["fix-plan emails you opt into", "scheduled fix-plan emails wait in our send queue", "go out over 14 days"];
if (blind) { /* O2 reads the bundles */ }
else if (!E.VDCI_O012) say("INFO", "O2", "no page promises fix-plan emails (S14X-012 option B): owner pending");
else if (!ruleIs(E.VDCI_O012, "B")) say("INFO", "O2", "S14X-012 decided \"" + E.VDCI_O012 + "\": the fix-plan copy stays, so nothing here changes");
else if (!live) say("INFO", "O2", "no page promises fix-plan emails (S14X-012 option B): not yet published");
else {
  const why = [];
  if (!FPC) why.push("the FixPlanConfirm chunk could not be read");
  else if (FPC.includes(FIRST_MAIL.en)) why.push("the FixPlanConfirm chunk still says \x27" + FIRST_MAIL.en + "\x27");
  const m = LNGS.filter((l) => FILES.filter((f) => lngOf(f) === l).some((f) => TEXT.get(f).includes(FIRST_MAIL[l])));
  if (m.length) why.push("the first-email promise is still served in " + named(m));
  if (!trustRead) why.push("/trust could not be read");
  else { const row = FIX_PLAN_ROW.filter((p) => TRUST.includes(p)); if (row.length) why.push("/trust still says \x27" + row[0] + "\x27"); }
  say(why.length ? "FAIL" : "PASS", "O2", "no page promises fix-plan emails: no first-email date in any language and no queued fix-plan row on /trust (S14X-012 option B)" + (why.length ? " — but " + why.join("; ") : ""));
}

if (blind) { /* O3 reads the bundles */ }
else if (!E.VDCI_ONB11) say("INFO", "O3", "the Pro card\x27s badge names the plan, not the writing tools (NB-11): owner pending");
else if (!/proposed/i.test(E.VDCI_ONB11)) say("INFO", "O3", "NB-11 decided \"" + E.VDCI_ONB11 + "\": not the proposed wording this section judges");
else if (!live) say("INFO", "O3", "the Pro card\x27s badge names the plan (NB-11): not yet published");
else {
  const m = missingIn((l) => str_(l, "proPlan.badge") === "Pro");
  say(m.length ? "FAIL" : "PASS", "O3", "the Pro card\x27s badge reads \x27Pro\x27, not \x27Writing tools\x27, in all nine languages (NB-11)" + (m.length ? " — but not in " + named(m) : ""));
}

const FILLED = { en: /filled/i, "en-GB": /filled/i, de: /besetzt/, es: /cubiert/, fr: /pourvu/, hi: /भरी/, nl: /vervuld/, pt: /preenchid/, tl: /napunan/ };
if (blind) { /* O4 reads the bundles */ }
else if (!E.VDCI_ONB47) say("INFO", "O4", "the board\x27s ticker says postings taken down, not roles filled (NB-47): owner pending");
else if (!/taken down/i.test(E.VDCI_ONB47)) say("INFO", "O4", "NB-47 decided \"" + E.VDCI_ONB47 + "\": not the noun this section judges");
else if (!live) say("INFO", "O4", "the board\x27s ticker says postings taken down (NB-47): not yet published");
else {
  const m = missingIn((l) => { const v = str_(l, "jobsPage.takedownsLast24h"); return v !== null && !FILLED[l].test(v) && (!l.startsWith("en") || /postings taken down/.test(v)); });
  say(m.length ? "FAIL" : "PASS", "O4", "the board\x27s ticker says postings taken down in the last 24 hours, never roles filled, in all nine languages (NB-47)" + (m.length ? " — but not in " + named(m) : ""));
}
'
