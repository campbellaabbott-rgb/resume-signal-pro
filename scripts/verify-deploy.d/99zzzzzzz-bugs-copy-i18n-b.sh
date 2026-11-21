# shellcheck shell=bash
# ── 99zzzzzzz-bugs-copy-i18n-b. THE BUG ROUND OF 2026-11-08, PART B, LANE
# COPY-I18N-B (branch bugs/b-copy-i18n): S14X-179, the changelog follows a
# language switch, and CW2-AI7 (cost wave 2's AI-7), no progress screen names
# a model. The lane changes no function and no migration; the merge publishes
# it with the page.
#
# Named 99zzzzzzz-bugs-*-b as the ledger's bug-round verifySections list it:
# it sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# WHAT WAS WRONG:
#   S14X-179  /changelog fetched its release notes (their own lazy bundle) in
#             an effect that ran once, at mount. A switch from the header's
#             picker loaded the new language's main strings and never its
#             notes, so every entry stayed in English until a reload. The
#             load is now keyed on the interface language.
#   CW2-AI7   the free scan's progress card said it was using a named Gemini
#             model, and the paid generation overlay named GPT-5 three times,
#             in English literals it typed itself. The model that answers
#             changes on the AI gateway's schedule, so the copy went false on
#             its own. No string names a model now, and the overlay reads its
#             words from the locale files.
#
# THE CHUNKS, read from production, never assumed: / names the entry
# (/assets/index-*.js), which names the changelog page's chunk
# (Changelog-*.js), the paid success page's chunk (ProductSuccess-*.js, where
# the generation overlay rides, or in a chunk of its own it names) and every
# language's string chunks; /resume-checker preloads the scanner's chunk
# (/assets/Index-*.js). A progress namespace (scanProgress,
# aiGenerationProgress, streamingContent) is read as an object wherever the
# build put it: a JSON key in an English rb-en_* chunk, a const exported by
# name in a language chunk, or an object handed to the string registry inline
# in a page chunk. Only string VALUES are judged, never key names.
#
# THE STAGE: the lane marks what it changed. The changelog list carries
# data-changelog-lng (the language whose notes it holds), and the overlay asks
# for aiGenerationProgress.title. Until a chunk carries its mark, its claim is
# INFO ("not yet published"); from then on it is PASS or FAIL.
#
# THE CLAIMS, one line each:
#   L0  the entry, the changelog chunk (it reads changelogEntries.), the
#       scanner chunk and the overlay chunk can be read, and scanProgress and
#       aiGenerationProgress are read in all nine languages (FAIL when the
#       layout moved: the claims below could not be judged).
#   L1  the stage; FAIL when only one of the two marks is published.
#   S14X-179  every hook in the changelog chunk that waits on a load
#             (.finally) is keyed on something (deps not []), and there is
#             one.
#   CW2-AI7   no progress string in any language, and no string literal in
#             the overlay's chunk, names a model (Gemini, or GPT with a
#             version number; ChatGPT, the app, is a host and is not matched).
#   X1  INFO: what the suite proves and this section cannot.
#
# READ-ONLY. GETs of /, /resume-checker, the entry, three page chunks and the
# string chunks they name. Nothing is posted.
echo "== 99zzzzzzz-bugs-copy-i18n-b. bug round part B, copy-i18n-b lane: the changelog follows a language switch, and no progress screen names a model =="

rm -rf /tmp/vd_bcib_home.html /tmp/vd_bcib_rc.html /tmp/vd_bcib_entry.js /tmp/vd_bcib_cl.js /tmp/vd_bcib_idx.js /tmp/vd_bcib_ps.js /tmp/vd_bcib_agp.js /tmp/vd_bcib_names.txt /tmp/vd_bcib_c
mkdir -p /tmp/vd_bcib_c
curl -s -m 30 "$SITE/" > /tmp/vd_bcib_home.html
curl -s -m 30 "$SITE/resume-checker" > /tmp/vd_bcib_rc.html
VDCB_ENTRY=$(grep -ao '/assets/index-[A-Za-z0-9_-]*\.js' /tmp/vd_bcib_home.html | head -1)
[ -n "$VDCB_ENTRY" ] && curl -s -m 60 "$SITE$VDCB_ENTRY" > /tmp/vd_bcib_entry.js
# A chunk is named by its whole file name: a bare grep for Changelog-*.js
# would also cut one out of a longer name ending in the same word.
vdcb_chunk() { grep -aoE "(\./|assets/)$1-[A-Za-z0-9_-]+\.js" "$2" 2>/dev/null | head -1 | sed -E 's#^(\./|assets/)##'; }
VDCB_CL=$( [ -s /tmp/vd_bcib_entry.js ] && vdcb_chunk Changelog /tmp/vd_bcib_entry.js)
[ -n "$VDCB_CL" ] && curl -s -m 60 "$SITE/assets/$VDCB_CL" > /tmp/vd_bcib_cl.js
VDCB_PS=$( [ -s /tmp/vd_bcib_entry.js ] && vdcb_chunk ProductSuccess /tmp/vd_bcib_entry.js)
[ -n "$VDCB_PS" ] && curl -s -m 60 "$SITE/assets/$VDCB_PS" > /tmp/vd_bcib_ps.js
VDCB_AGP=$( [ -s /tmp/vd_bcib_ps.js ] && vdcb_chunk AIGenerationProgress /tmp/vd_bcib_ps.js)
[ -n "$VDCB_AGP" ] && curl -s -m 60 "$SITE/assets/$VDCB_AGP" > /tmp/vd_bcib_agp.js
VDCB_IDX=$(grep -ao '/assets/Index-[A-Za-z0-9_-]*\.js' /tmp/vd_bcib_rc.html | head -1)
[ -n "$VDCB_IDX" ] && curl -s -m 60 "$SITE$VDCB_IDX" > /tmp/vd_bcib_idx.js

# The string chunks the entry and the two progress pages name, by their whole
# file name (a bare grep would cut de-XXXXXXXX.js out of Guide-XXXXXXXX.js).
node -e '
const fs = require("fs");
const STR = /^(?:(?:en-GB|en|de|es|fr|hi|nl|pt|tl)-[A-Za-z0-9_-]{8}|rb-en_[A-Za-z_]+-[A-Za-z0-9_-]{8})\.js$/;
const names = new Set();
for (const p of process.argv.slice(1)) { // node -e: the first argument is argv[1]
  let s = ""; try { s = fs.readFileSync(p, "utf8"); } catch { continue; }
  for (const m of s.matchAll(/(?:\.\/|assets\/)([A-Za-z0-9_.-]+\.js)/g)) if (STR.test(m[1])) names.add(m[1]);
}
fs.writeFileSync("/tmp/vd_bcib_names.txt", [...names].sort().join("\n") + "\n");
' /tmp/vd_bcib_entry.js /tmp/vd_bcib_idx.js /tmp/vd_bcib_ps.js /tmp/vd_bcib_agp.js
[ -s /tmp/vd_bcib_names.txt ] && grep -a '\.js$' /tmp/vd_bcib_names.txt | xargs -P 6 -I{} curl -s -m 60 -o /tmp/vd_bcib_c/{} "$SITE/assets/{}"

VDCB_N_ENTRY="$VDCB_ENTRY" VDCB_N_CL="$VDCB_CL" VDCB_N_PS="$VDCB_PS" VDCB_N_AGP="$VDCB_AGP" VDCB_N_IDX="$VDCB_IDX" node -e '
const fs = require("fs");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const E = process.env;
const say = (v, id, m) => console.log(v + "  " + id + " " + m);
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const DIR = "/tmp/vd_bcib_c/";
const FILES = (() => { try { return fs.readdirSync(DIR).filter((f) => /\.js$/.test(f)).sort(); } catch { return []; } })();
const ENTRY = rd("/tmp/vd_bcib_entry.js"), CL = rd("/tmp/vd_bcib_cl.js"), IDX = rd("/tmp/vd_bcib_idx.js");
const PS = rd("/tmp/vd_bcib_ps.js"), AGP = rd("/tmp/vd_bcib_agp.js");
const OVERLAY = PS + "\n" + AGP;
const name = (p) => String(p || "").replace(/^\/assets\//, "");
const MODEL = /\bgemini\b|\bgpt-?\d/i;

/** The balanced {...} starting at s[i] === "{", skipping string literals. */
function braceAt(s, i) {
  let depth = 0, q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === "\\") { j++; continue; } if (c === q) q = null; continue; }
    if (c === "\"" || c === "\x27" || c === "`") { q = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return null;
}
const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Every object a chunk holds for a namespace, in any form the build prints. */
function namespaces(body, ns) {
  const out = [];
  const add = (i) => { const b = braceAt(body, i); if (b) out.push(b); };
  for (const m of body.matchAll(new RegExp("\"" + esc(ns) + "\":\\{", "g"))) add(m.index + m[0].length - 1);
  for (const m of body.matchAll(new RegExp("[{,]" + esc(ns) + ":\\{", "g"))) add(m.index + m[0].length - 1);
  const locals = new Set();
  for (const m of body.matchAll(new RegExp("([A-Za-z_$][\\w$]*) as " + esc(ns) + "\\b", "g"))) locals.add(m[1]);
  for (const m of body.matchAll(new RegExp("[{,]" + esc(ns) + ":([A-Za-z_$][\\w$]*)[,}]", "g"))) locals.add(m[1]);
  for (const n of locals) { const d = new RegExp("(?:^|[,;{\\s])" + esc(n) + "=\\{").exec(body); if (d) add(d.index + d[0].length - 1); }
  return out;
}
/** The string literal VALUES in a stretch of code: a literal followed by a colon is a key and is skipped. */
function values(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|\x27((?:[^\x27\\]|\\.)*)\x27|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(text))) {
    if (/^\s*:/.test(text.slice(re.lastIndex, re.lastIndex + 8))) continue;
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

// The progress namespaces, per language.
const lngOf = (f) => (/^rb-en_[A-Za-z_]+-[A-Za-z0-9_-]{8}\.js$/.test(f) ? "en" : ((/^(en-GB|en|de|es|fr|hi|nl|pt|tl)-[A-Za-z0-9_-]{8}\.js$/.exec(f) || [])[1] || ""));
const SOURCES = FILES.map((f) => ({ f, l: lngOf(f), t: rd(DIR + f) })).filter((s) => s.l);
if (IDX) SOURCES.push({ f: name(E.VDCB_N_IDX), l: "en", t: IDX });
// The overlay chunk is read for its English namespace, but judged below by
// every literal it holds, so its strings are not counted twice.
if (OVERLAY.trim()) SOURCES.push({ f: name(E.VDCB_N_PS), l: "en", t: OVERLAY, whole: true });
const ROOTS = { scanProgress: /(?:^|[{,])"?subtitle"?:/, aiGenerationProgress: /(?:^|[{,])"?quality"?:/, streamingContent: /(?:^|[{,])"?waiting"?:/ };
const read = {}; for (const r of Object.keys(ROOTS)) read[r] = new Set();
const hits = [];
for (const s of SOURCES) {
  for (const [root, tell] of Object.entries(ROOTS)) {
    for (const obj of namespaces(s.t, root)) {
      if (tell.test(obj)) read[root].add(s.l);
      if (!s.whole) for (const v of values(obj)) if (MODEL.test(v)) hits.push(s.f + " " + root + ": \"" + v.slice(0, 70) + "\"");
    }
  }
}
// The overlay types its own words: every string value in its chunk.
for (const v of values(OVERLAY)) if (MODEL.test(v)) hits.push((name(E.VDCB_N_PS) || "overlay") + " literal: \"" + v.slice(0, 70) + "\"");
const uniq = [...new Set(hits)];

// L0: the layout.
const unread = [];
if (!ENTRY) unread.push("the entry (/ names no /assets/index-*.js, or it has no body)");
if (!E.VDCB_N_CL) unread.push("the changelog chunk (the entry names no Changelog-*.js)");
else if (!/changelogEntries\./.test(CL)) unread.push("the changelog chunk " + E.VDCB_N_CL + " (it reads no changelogEntries. key)");
if (!E.VDCB_N_PS || !PS) unread.push("the overlay chunk (the entry names no ProductSuccess-*.js, or it has no body)");
if (!E.VDCB_N_IDX || !IDX) unread.push("the scanner chunk (/resume-checker preloads no /assets/Index-*.js, or it has no body)");
for (const root of ["scanProgress", "aiGenerationProgress"]) {
  const miss = LNGS.filter((l) => !read[root].has(l));
  if (miss.length) unread.push(root + " in " + miss.join(", "));
}
if (unread.length) {
  say("FAIL", "L0", "could not read " + unread.join("; ") + ": the bundle layout moved, so S14X-179 and CW2-AI7 cannot be judged");
  process.exit(0);
}
say("INFO", "L0", "read: " + name(E.VDCB_N_ENTRY) + ", " + E.VDCB_N_CL + ", " + E.VDCB_N_PS + (E.VDCB_N_AGP ? " + " + E.VDCB_N_AGP : "") + ", " + name(E.VDCB_N_IDX) + " and " + FILES.length + " string chunks; scanProgress and aiGenerationProgress in all nine languages, streamingContent in " + read.streamingContent.size);

// L1: the stage.
const clMark = /"data-changelog-lng":/.test(CL);
const agpMark = /["\x27`]aiGenerationProgress\.title["\x27`]/.test(OVERLAY);
if (clMark && agpMark) say("PASS", "L1", "the changelog chunk carries data-changelog-lng and the overlay asks for aiGenerationProgress.title: the merge carrying part B published");
else if (clMark || agpMark) say("FAIL", "L1", "only " + (clMark ? "the changelog\x27s mark is" : "the overlay\x27s keys are") + " published: the two halves of the lane were not published by one build");
else say("INFO", "L1", "neither the changelog\x27s mark nor the overlay\x27s keys are published: the merge carrying part B has not published, so both claims are INFO");

// S14X-179: the hook that waits on the notes is keyed.
function hooks(s) {
  const out = [];
  for (let i = s.indexOf("(()=>{"); i >= 0; i = s.indexOf("(()=>{", i + 6)) {
    const b = braceAt(s, i + 5);
    if (!b) continue;
    const d = /^,\[([^\]]*)\]\)/.exec(s.slice(i + 5 + b.length, i + 5 + b.length + 200));
    if (d) out.push({ body: b, deps: d[1].trim() });
  }
  return out;
}
const waits = hooks(CL).filter((h) => h.body.includes(".finally("));
const once = waits.filter((h) => h.deps === ""), keyed = waits.filter((h) => h.deps !== "");
const what179 = "the changelog loads each language\x27s release notes when the language changes (" + E.VDCB_N_CL + ": the hook that waits on the load is keyed on the language, not run once)";
const seen179 = waits.length ? keyed.length + " keyed" + (keyed.length ? " (deps [" + keyed.map((h) => h.deps).join("], [") + "])" : "") + ", " + once.length + " run once (deps [])" : "no hook in the chunk waits on a load (.finally)";
if (clMark) say(keyed.length > 0 && once.length === 0 ? "PASS" : "FAIL", "S14X-179", what179 + ": " + seen179);
else say("INFO", "S14X-179", what179 + ": not yet published (today: " + seen179 + ")");

// CW2-AI7: no progress string names a model.
const what7 = "no progress string in any language, and no literal in the overlay\x27s chunk, names a model";
const seen7 = uniq.length ? uniq.length + " name one: " + uniq.slice(0, 4).join("; ") + (uniq.length > 4 ? "; ..." : "") : "none names one";
if (agpMark) say(uniq.length === 0 ? "PASS" : "FAIL", "CW2-AI7", what7 + ": " + seen7);
else say("INFO", "CW2-AI7", what7 + ": not yet published (today: " + seen7 + ")");

say("INFO", "X1", "proved in the suite, not from outside: a switch to Spanish, French and back shows each language\x27s notes (the-changelog-follows-a-language-switch), and the overlay and the scan card render the locale\x27s words with no model in English and German (the-progress-screens-name-no-model)");
'
