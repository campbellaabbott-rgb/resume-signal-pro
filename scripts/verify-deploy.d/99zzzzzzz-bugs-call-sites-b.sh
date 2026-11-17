# shellcheck shell=bash
# ── 99zzzzzzz-bugs-call-sites-b. THE BUG ROUND OF 2026-11-08, PART B, LANE
# CALL-SITES-B (branch bugs/b-call-sites): S14X-255 (C-S14-100, figures and
# dates that followed the browser's language) and the call-sites half of
# S14X-283 (five upload boxes that read a .txt as UTF-8 only; the reader that
# honours a byte-order mark is ingest-parsers' readTextFile). No function and
# no migration: the merge's frontend publish carries all of it.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE CHUNKS, read from production, never assumed: the homepage and /jobs
# name the entry and its preloads; every chunk a chunk read names (a static
# or dynamic import, or the entry's preload list) is read in turn until no
# new name appears, so the walk reaches every chunk the router can load (355
# on 2026-11-17; 458 files in a build of this branch).
#
# THE STAGE: a chunk carries ingestParsers.refusal.txtUnreadable, the
# scanner landing's refusal of a .txt that is still not text after its mark is
# honoured (only this lane writes that key). Until one does, every claim is
# INFO ("not published yet"); from then on each one is PASS or FAIL.
#
# THE CLAIMS, one line each:
#   L0  the walk read the entry, at least 100 chunks, and the five upload
#       boxes' page chunks (Index-, Jobs-, ProductSuccess-, Shortlist-,
#       Success-, the last holding the résumé recovery panel); FAIL when it
#       did not: nothing below could be judged.
#   L1  the stage; once published, FAIL when the chunk that refuses the .txt
#       neither decodes utf-16le itself nor imports a chunk that does.
#   D1  S14X-255: no chunk a reader can load calls a toLocale string method
#       with no locale, void 0 or an empty list, or builds an Intl number,
#       date, relative-time, plural or list formatter that way (a bare
#       DateTimeFormat whose only use is resolvedOptions reads the time zone
#       and prints nothing). The owner's five dashboards (HealthCheck,
#       AnalyticsDashboard, AdminClaims, ScanMetrics, ErrorDashboard) and the
#       dashboard parts only they import are English, read by the owner alone,
#       and left out by name, as the suite's guard leaves out their files.
#   T1  S14X-283 (call sites): no chunk reads a .txt upload through the
#       File's UTF-8-only text(): a text/plain, "txt", ".txt" or /\.txt$/
#       test followed within 160 characters by an await of an identifier's
#       text().
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: what a page asked for in
# German prints (no-page-formats-in-the-browsers-locale) and what each box
# keeps from a UTF-16 .txt (a-unicode-txt-resume-is-read-at-every-upload-box).
#
# READ-ONLY. GETs of the homepage, /jobs and the chunks they lead to. Nothing
# is posted.
echo "== 99zzzzzzz-bugs-call-sites-b. bug round, call-sites lane: figures and dates in the reader's language, a Unicode .txt read as text at every upload box =="

rm -rf /tmp/vd_bcs_c
mkdir -p /tmp/vd_bcs_c
rm -f /tmp/vd_bcs_home.html /tmp/vd_bcs_jobs.html /tmp/vd_bcs_seen.txt /tmp/vd_bcs_new.txt /tmp/vd_bcs_next.txt
curl -s -m 30 "$SITE/" > /tmp/vd_bcs_home.html
curl -s -m 30 "$SITE/jobs" > /tmp/vd_bcs_jobs.html
VDBCS_ENTRY=$(grep -aoE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_bcs_home.html | head -1)
cat /tmp/vd_bcs_home.html /tmp/vd_bcs_jobs.html | grep -aoE '/assets/[A-Za-z0-9_.-]+\.js' | sed 's#^/assets/##' | LC_ALL=C sort -u > /tmp/vd_bcs_new.txt
: > /tmp/vd_bcs_seen.txt
VDBCS_ROUNDS=0
while [ -s /tmp/vd_bcs_new.txt ] && [ "$VDBCS_ROUNDS" -lt 12 ]; do
  VDBCS_ROUNDS=$((VDBCS_ROUNDS + 1))
  cat /tmp/vd_bcs_new.txt >> /tmp/vd_bcs_seen.txt
  LC_ALL=C sort -u -o /tmp/vd_bcs_seen.txt /tmp/vd_bcs_seen.txt
  xargs -P 6 -I{} curl -s -m 60 -o /tmp/vd_bcs_c/{} "$SITE/assets/{}" < /tmp/vd_bcs_new.txt
  sed 's#^#/tmp/vd_bcs_c/#' /tmp/vd_bcs_new.txt | xargs grep -aohE '(assets/|"\./)[A-Za-z0-9_.-]+\.js' 2>/dev/null | sed -E 's#^(assets/|"\./)##' | LC_ALL=C sort -u > /tmp/vd_bcs_next.txt
  LC_ALL=C comm -23 /tmp/vd_bcs_next.txt /tmp/vd_bcs_seen.txt > /tmp/vd_bcs_new.txt
done

VDBCS_N_ENTRY="$VDBCS_ENTRY" node -e '
const fs = require("fs");
const DIR = "/tmp/vd_bcs_c";
const say = (v, id, m) => console.log(v + "  " + id + " " + m);
const src = new Map();
let names = [];
try { names = fs.readdirSync(DIR).filter((n) => n.endsWith(".js")).sort(); } catch { names = []; }
for (const n of names) {
  let s = "";
  try { s = fs.readFileSync(DIR + "/" + n, "utf8"); } catch { s = ""; }
  // A name the server does not hold answers its HTML shell or nothing.
  if (s.length && !/^\s*</.test(s)) src.set(n, s);
}
const entry = (process.env.VDBCS_N_ENTRY || "").replace(/^\/assets\//, "");
const BOXES = ["Index", "Jobs", "ProductSuccess", "Shortlist", "Success"];
const has = (prefix) => [...src.keys()].some((n) => n.startsWith(prefix + "-"));

// L0: the layout.
const lost = BOXES.filter((b) => !has(b));
if (!entry || !src.has(entry)) { say("FAIL", "L0", entry ? "the entry " + entry + " the homepage names could not be read: the published app cannot be judged" : "the homepage names no /assets/index-*.js entry: the published app cannot be judged"); process.exit(0); }
if (src.size < 100 || lost.length) { say("FAIL", "L0", "the walk from " + entry + " read " + src.size + " chunks" + (lost.length ? " and no page chunk for " + lost.join(", ") : "") + " (want at least 100 and all five upload boxes): the bundle layout moved, so D1 and T1 cannot be judged"); process.exit(0); }
say("INFO", "L0", "the walk from " + entry + " read " + src.size + " chunks, the five upload boxes among them");

// L1: the stage, and the landing reads a .txt through the decoder.
const KEY = "ingestParsers.refusal.txtUnreadable";
const carriers = [...src].filter(([, s]) => s.includes(KEY)).map(([n]) => n);
const published = carriers.length > 0;
const DECODER = "\"utf-16le\"";
const importsOf = (s) => [...s.matchAll(/(?:from|import)\s*"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map((m) => m[1]);
const decoderOf = (n) => { const s = src.get(n) || ""; if (s.includes(DECODER)) return n; return importsOf(s).find((d) => (src.get(d) || "").includes(DECODER)) || ""; };
if (!published) say("INFO", "L1", "no chunk carries " + KEY + ": the merge carrying call-sites-b has not published, so D1 and T1 are INFO");
else {
  const blind = carriers.filter((n) => !decoderOf(n));
  if (blind.length) say("FAIL", "L1", "S14X-283 " + blind.join(", ") + " refuses an unreadable .txt but neither decodes utf-16le nor imports a chunk that does: the landing still reads a Notepad Unicode file as UTF-8");
  else say("PASS", "L1", "S14X-283 the scanner landing (" + carriers.join(", ") + ") reads a .txt through the byte-order decoder (" + carriers.map(decoderOf).join(", ") + ") and refuses one that is still not text");
}

// D1: the browser picks the language.
const OWNER = /^(HealthCheck|AnalyticsDashboard|AdminClaims|ScanMetrics|ErrorDashboard|UserHealthTable|IndustryDetectionChart|AIGenerationTrendChart|EmailTrendChart|HealthTrendChart|WebhookTrendChart)-/;
const METHOD = /\.toLocale(?:Date|Time)?String\(\s*(?:\)|void 0\b|\[\s*\])/g;
const INTL = /\bIntl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat)\(\s*(?:\)(?!\s*\.resolvedOptions\b)|void 0\b|\[\s*\])/g;
const bare = [];
let total = 0, owner = 0;
for (const [n, s] of src) {
  const k = (s.match(METHOD) || []).length + (s.match(INTL) || []).length;
  if (!k) continue;
  if (OWNER.test(n)) { owner += k; continue; }
  bare.push(n + " x" + k);
  total += k;
}
const ownerNote = " (the owner dashboards, English by design, hold " + owner + ")";
if (!published) say("INFO", "D1", "S14X-255 " + total + " calls in " + bare.length + " chunks let the browser pick the language of a figure or a date" + ownerNote + ": not published yet");
else if (total) say("FAIL", "D1", "S14X-255 " + total + " calls still let the browser pick the language of a figure or a date, not the language the reader chose: " + bare.slice(0, 15).join(", ") + (bare.length > 15 ? " and " + (bare.length - 15) + " more chunks" : ""));
else say("PASS", "D1", "S14X-255 none of the " + src.size + " chunks a reader can load lets the browser pick the language of a figure or a date" + ownerNote);

// T1: a .txt read as UTF-8 only.
const TXT = /(?:"text\/plain"|"txt"|"\.txt"|\\\.txt\$)[^]{0,160}?await [A-Za-z_$][\w$]*\.text\(\)/g;
const reads = [];
for (const [n, s] of src) for (const m of s.matchAll(TXT)) reads.push(n + " (" + m[0].slice(-90).replace(/\s+/g, " ") + ")");
if (!published) say("INFO", "T1", "S14X-283 " + reads.length + " places read a .txt upload with the UTF-8-only File text()" + (reads.length ? ": " + reads.map((r) => r.split(" ")[0]).join(", ") : "") + ": not published yet");
else if (reads.length) say("FAIL", "T1", "S14X-283 " + reads.length + " places still read a .txt upload with the UTF-8-only File text(), so a Notepad Unicode file arrives with a NUL beside every letter: " + reads.slice(0, 6).join("; "));
else say("PASS", "T1", "S14X-283 no chunk reads a .txt upload with the UTF-8-only File text(): the landing, the board, the success page, Shortlist and the recovery panel all read it in the encoding it was saved in");
'
