# shellcheck shell=bash
# ── 99zzzzzzz-fix1119-board-ui. THE BUG BUILD OF 2026-11-21, LANE BOARD-UI
# (branch fix/1119-board-ui): the reconcile's L2-15 (page half), S10-067,
# S10-154, S10-155, S10-156, S10-157, S10-159, NB-22, S10-163, S10-164, and
# the 18 November sweep's MATCH-01, BOARD-01, BOARD-02 (page half), BOARD-04,
# BOARD-05, MATCH-09, MATCH-12, MATCH-M1 and the board's half of MATCH-11.
# Frontend only: no function and no migration changes in this lane, so the
# board and the board-ui strings are published by the merge itself.
#
# THE STAGE, read from production, never assumed:
#   frontend  the published Jobs chunk (with every chunk it imports) carries
#             any of this lane's marks below: the merge published. Until then
#             every claim is INFO; from then on a missing mark, or a retired
#             spelling still present, is a FAIL.
#
# THE CLAIMS, one line each:
#   B1  L2-15: a null live answer is not mapped straight to the feed's
#       "uncheckable" sentence; only a null the board names page-capped is.
#   B2  S10-154: the board's keydown handler returns on Cmd, Ctrl, Alt or a
#       composing key before its j/k test.
#   B3  BOARD-02: the Jobs chunk reads the board's offset_too_deep refusal.
#   B4  MATCH-09: the fit header names the résumé (orderFitNoResumeTerms).
#   S1  the board-ui strings carry the new header key in English (the Jobs
#       chunk or a chunk it imports) and in each of the eight lazy shards.
#   N1  the Jobs chunk holds neither 'Half of these roles are filled by day'
#       nor 'Deterministic keyword coverage' (the English fallbacks, this
#       lane's half of S11-064 and S14X-291).
#   N2  no jobsPage namespace bundle holds either: the locale values are lane
#       site-copy's, so this is INFO until that lane's own section is in this
#       checkout (it merged), and a FAIL from then on.
#   I1  INFO only: what needs a browser, a signed-in reader or job-board's
#       verify reason (L2-15's server half, the jobs build's).
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the posting opened by
# link that is scored or says why not (a-posting-opened-by-link-gets-a-score-
# or-says-why-not), the pay line under the field alone (the-pay-line-shows-
# only-while-the-field-is-the-only-filter), the employer counts
# (an-employer-option-prints-a-count-only-on-an-otherwise-unfiltered-board),
# the numbered saved searches (saving-a-search-already-saved-under-a-numbered-
# name-adds-no-row-and-alerts-that-row), the tracker writes (a-saved-posting-
# is-not-called-applied-and-an-apply-click-marks-the-card-at-once,
# an-evening-apply-click-is-dated-the-readers-own-day, watching-an-employer-
# twice-covers-every-board-it-has, saving-a-posting-stores-the-fit-of-the-
# resume-the-board-ranked-with), the reader's day on the card (a-card-read-at-
# one-in-the-morning-utc-says-posted-today-in-new-york), the fit budget (a-
# resume-drop-spends-no-fit-call-on-the-page-it-replaces, a-posting-already-
# being-scored-is-not-sent-again, a-query-typed-while-the-resume-terms-load-
# is-kept) and the pass refusals (a-slow-pass-does-not-blank-the-counts-and-a-
# background-refusal-does-not-lock-the-board), because each needs a mounted
# page, a session or a board pass this read-only section never holds.
#
# READ-ONLY. GETs of the homepage, its entry, the Jobs chunk and every chunk
# it imports, the jobsPage namespace bundles they name, and the eight
# board-ui shard chunks. Nothing is posted, no function is called.
echo "== 99zzzzzzz-fix1119-board-ui. bug build of 2026-11-21, board-ui lane: an undecided check never blames the employer's feed, chords stay their own, a too-deep page says to narrow, the fit header names its cause =="

rm -f /tmp/vd_f19bu_*
curl -s -m 30 "$SITE/" -o /tmp/vd_f19bu_home.html
VDF19BU_MAIN=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_f19bu_home.html 2>/dev/null | head -1)
if [ -n "$VDF19BU_MAIN" ]; then curl -s -m 60 "$SITE$VDF19BU_MAIN" -o /tmp/vd_f19bu_entry.js; else : > /tmp/vd_f19bu_entry.js; fi
VDF19BU_JOBSN=$(grep -oE 'assets/Jobs-[A-Za-z0-9_-]+\.js' /tmp/vd_f19bu_entry.js 2>/dev/null | head -1 | sed 's#^assets/##')
: > /tmp/vd_f19bu_jobs.js
: > /tmp/vd_f19bu_board.js
: > /tmp/vd_f19bu_ns.js
if [ -n "$VDF19BU_JOBSN" ]; then
  curl -s -m 60 "$SITE/assets/$VDF19BU_JOBSN" -o /tmp/vd_f19bu_jobs.js
  cp /tmp/vd_f19bu_jobs.js /tmp/vd_f19bu_board.js
  # Every chunk the Jobs chunk imports, named or for its effects (the card,
  # the saved-search pills and the English board-ui strings live there).
  for VDF19BU_C in $(grep -oE '(from|import)"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_f19bu_jobs.js | sed -E 's/^(from|import)"\.\/(.*)"$/\2/' | sort -u); do
    case "$VDF19BU_C" in index-*) continue;; esac
    rm -f /tmp/vd_f19bu_cand.js
    curl -s -m 30 "$SITE/assets/$VDF19BU_C" -o /tmp/vd_f19bu_cand.js
    { echo; cat /tmp/vd_f19bu_cand.js 2>/dev/null; } >> /tmp/vd_f19bu_board.js
  done
fi
# The jobsPage namespace bundles the entry and the Jobs chunk name (rb-<lng>_ns_jobsPage-*.js).
VDF19BU_NSN=$(grep -ohE 'rb-[A-Za-z-]+_ns_jobsPage-[A-Za-z0-9_-]+\.js' /tmp/vd_f19bu_entry.js /tmp/vd_f19bu_jobs.js 2>/dev/null | sort -u | tr '\n' ' ')
for VDF19BU_C in $VDF19BU_NSN; do
  rm -f /tmp/vd_f19bu_cand.js
  curl -s -m 30 "$SITE/assets/$VDF19BU_C" -o /tmp/vd_f19bu_cand.js
  { echo "/*@@$VDF19BU_C@@*/"; cat /tmp/vd_f19bu_cand.js 2>/dev/null; echo; } >> /tmp/vd_f19bu_ns.js
done
# The eight lazy board-ui shards the entry maps (./shards/board-ui/<lng>.json -> chunk).
: > /tmp/vd_f19bu_shards.txt
grep -oE '"\./shards/board-ui/[A-Za-z-]+\.json":\(\)=>[A-Za-z_$]+\(\(\)=>import\("\./[A-Za-z0-9_-]+\.js"' /tmp/vd_f19bu_entry.js 2>/dev/null | while IFS= read -r VDF19BU_L; do
  VDF19BU_LNG=$(printf '%s' "$VDF19BU_L" | sed -E 's#.*shards/board-ui/([A-Za-z-]+)\.json.*#\1#')
  VDF19BU_SF=$(printf '%s' "$VDF19BU_L" | grep -oE '[A-Za-z0-9_-]+\.js"$' | tr -d '"')
  rm -f "/tmp/vd_f19bu_shard_$VDF19BU_LNG.js"
  curl -s -m 30 "$SITE/assets/$VDF19BU_SF" -o "/tmp/vd_f19bu_shard_$VDF19BU_LNG.js"
  echo "$VDF19BU_LNG $VDF19BU_SF" >> /tmp/vd_f19bu_shards.txt
done
# Lane site-copy's own section in this checkout means that lane merged, and
# the locale values its half rewords are judged here too.
VDF19BU_SITECOPY=no
[ -f scripts/verify-deploy.d/99zzzzzzz-fix1119-site-copy.sh ] && VDF19BU_SITECOPY=yes

VDF19BU_P=/tmp/vd_f19bu_ VDF19BU_MAIN="$VDF19BU_MAIN" VDF19BU_JOBSN="$VDF19BU_JOBSN" VDF19BU_NSN="$VDF19BU_NSN" VDF19BU_SITECOPY="$VDF19BU_SITECOPY" node -e '
const fs = require("fs");
const E = process.env;
const txt = (f) => { try { return fs.readFileSync(E.VDF19BU_P + f, "utf8"); } catch { return ""; } };
const say = (v, m) => console.log(v + "  " + m);
const ENTRY = txt("entry.js"), JOBS = txt("jobs.js"), BOARD = txt("board.js"), NS = txt("ns.js");
const SHARDS = txt("shards.txt").split("\n").filter(Boolean).map((l) => { const [lng, file] = l.split(" "); return { lng, file, body: txt("shard_" + lng + ".js") }; });

if (!E.VDF19BU_MAIN || !ENTRY) { say("FAIL", "B0 the homepage names no /assets/index-*.js entry, or it could not be read: the published board cannot be judged"); process.exit(0); }
if (!E.VDF19BU_JOBSN || !JOBS.includes("jobsPage.compareTitle")) { say("FAIL", "B0 the entry " + E.VDF19BU_MAIN + " names no Jobs chunk holding the board (" + (E.VDF19BU_JOBSN || "none named") + "): the bundle layout moved, so the board cannot be judged"); process.exit(0); }

const ID = "[A-Za-z_$][A-Za-z0-9_$]*";
const CHORD = new RegExp("\\." + "metaKey\\|\\|" + ID + "\\.ctrlKey\\|\\|" + ID + "\\.altKey\\|\\|" + ID + "\\.isComposing\\)return");
const JK = /\.key==="j"\|\|[A-Za-z_$][A-Za-z0-9_$]*\.key==="k"/;
const chordBeforeJk = () => {
  const m = CHORD.exec(JOBS);
  if (!m) return false;
  const after = JOBS.slice(m.index, m.index + 2500);
  return JK.test(after);
};
const RETIRED_NULL = /\]===null\)return"uncheckable"/;

// ---- the stage ----
const MARKS = {
  B1: JOBS.includes("page-capped") && !RETIRED_NULL.test(JOBS),
  B2: chordBeforeJk(),
  B3: JOBS.includes("offset_too_deep"),
  B4: BOARD.includes("boardUi.orderFitNoResumeTerms"),
};
const hits = Object.values(MARKS).filter(Boolean).length;
const FE = hits > 0;
say("INFO", "stage: frontend " + (FE ? "published (" + hits + " of 4 of this lane'"'"'s marks in " + E.VDF19BU_JOBSN + " and its imports)" : "not published (" + E.VDF19BU_JOBSN + " and its imports carry none of this lane'"'"'s marks)"));
const verdict = (good, m) => say(good ? "PASS" : FE ? "FAIL" : "INFO", m + (good || FE ? "" : " -- the lane is not published yet"));

// ---- B1 L2-15 ----
if (RETIRED_NULL.test(JOBS)) verdict(false, "B1 L2-15 " + E.VDF19BU_JOBSN + " still maps a null live answer straight to the uncheckable outcome, which tells the reader the employer'"'"'s feed is at fault for our own failed check");
else verdict(MARKS.B1, "B1 L2-15 " + (MARKS.B1 ? E.VDF19BU_JOBSN + " maps a null live answer to the uncheckable outcome only when the board names it page-capped; any other null is our check not going through" : E.VDF19BU_JOBSN + " no longer maps a null straight to uncheckable but names no page-capped reason: the bundle layout moved"));

// ---- B2 S10-154 ----
verdict(MARKS.B2, "B2 S10-154 " + (MARKS.B2 ? "the board'"'"'s keydown handler returns on Cmd, Ctrl, Alt or a composing key before its j/k test" : E.VDF19BU_JOBSN + "'"'"'s keydown handler has no Cmd/Ctrl/Alt/composing guard before its j/k test: Cmd+K still moves the selected posting"));

// ---- B3 BOARD-02 ----
verdict(MARKS.B3, "B3 BOARD-02 " + (MARKS.B3 ? E.VDF19BU_JOBSN + " reads the board'"'"'s offset_too_deep refusal: a too-deep page takes Load more away and says to narrow the list" : E.VDF19BU_JOBSN + " does not read offset_too_deep: a refused deep page is retried without end"));

// ---- B4 MATCH-09 ----
verdict(MARKS.B4, "B4 MATCH-09 " + (MARKS.B4 ? "the board'"'"'s fit header asks for boardUi.orderFitNoResumeTerms: an unranked page names the résumé when the résumé is the cause" : "neither " + E.VDF19BU_JOBSN + " nor a chunk it imports asks for boardUi.orderFitNoResumeTerms: the fit header still blames the descriptions for every cause"));

// ---- S1 the strings ----
const KEY = "orderFitNoResumeTerms:";
const enHas = BOARD.includes(KEY) || ENTRY.includes(KEY);
const missing = SHARDS.filter((s) => !s.body.includes(KEY)).map((s) => s.lng + " (" + s.file + ")");
if (SHARDS.length !== 8) verdict(false, "S1 the entry names " + SHARDS.length + " lazy board-ui shards, not 8: the new header key cannot be judged in every language");
else if (!enHas || missing.length) verdict(false, "S1 the board-ui strings lack the new no_resume_terms header key (orderFitNoResumeTerms) in " + [!enHas ? "en (the Jobs chunk, its imports and the entry)" : null, ...missing].filter(Boolean).join(", "));
else say("PASS", "S1 the board-ui strings carry the new no_resume_terms header key (orderFitNoResumeTerms) in English and in each of the 8 lazy shards");

// ---- N1 / N2 the retired English (S11-064, S14X-291) ----
const RETIRED = ["Half of these roles are filled by day", "Deterministic keyword coverage"];
const inJobs = RETIRED.filter((s) => JOBS.includes(s));
if (!inJobs.length) say(FE ? "PASS" : "INFO", "N1 " + E.VDF19BU_JOBSN + " holds neither " + RETIRED.map((s) => JSON.stringify(s)).join(" nor ") + (FE ? "" : ", but the lane has not published, so nothing is proved yet"));
else verdict(false, "N1 " + E.VDF19BU_JOBSN + " still holds " + inJobs.map((s) => JSON.stringify(s)).join(" and ") + " as an English fallback");
const nsNames = (E.VDF19BU_NSN || "").trim().split(/\s+/).filter(Boolean);
if (!nsNames.length || !NS.trim()) say("INFO", "N2 neither the entry nor " + E.VDF19BU_JOBSN + " names a jobsPage namespace bundle (rb-<lng>_ns_jobsPage-*.js): the locale values cannot be read here");
else {
  const held = [];
  for (const part of NS.split("/*@@").slice(1)) {
    const name = part.slice(0, part.indexOf("@@*/"));
    for (const s of RETIRED) if (part.includes(s)) held.push(name + " holds " + JSON.stringify(s));
  }
  if (!held.length) say("PASS", "N2 no jobsPage namespace bundle (" + nsNames.join(", ") + ") holds " + RETIRED.map((s) => JSON.stringify(s)).join(" or "));
  else if (E.VDF19BU_SITECOPY === "yes") say("FAIL", "N2 " + held.join("; ") + ": lane site-copy has merged, so its reworded locale values should be live");
  else say("INFO", "N2 " + held.join("; ") + ": the locale values are lane site-copy'"'"'s, which has not merged into this checkout");
}
'

echo "INFO  I1 what this read-only section cannot see: L2-15's server half (job-board's verify naming uncheckable[id] = page-capped, the jobs build's) decides whether any undecided check is told as the feed's; until it lands every undecided check gets the neutral sentence. The mounted, signed-in and board-pass behaviours are proved in the suite (see this file's header)."
