# shellcheck shell=bash
# ── 99zzzzzzz-bugs-free-scan-page. THE BUG ROUND OF 2026-11-08, LANE
# FREE-SCAN-PAGE (branch bugs/a-free-scan-page; owner halves on
# bugs/a-free-scan-page-owner): the free scanner page and its report, which the
# merge itself publishes. The lane changes no function and no migration; the
# owner branch changes save-lead and notify-owner (S14X-101, at the round's
# build, 2026-11-12.1 or later; the integrator sets the stamps).
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE CHUNKS, read from production, never assumed: /resume-checker names the
# entry (/assets/index-*.js) and preloads the scanner's own chunk
# (/assets/Index-*.js, the one that calls the scanner); the scanner chunk
# names the report's chunk (FreeKeywordResults-*.js); the report or the
# scanner names the parse simulator's (ATSParseSimulator-*.js); the entry
# names the CV standards page's (CvStandards-*.js). English VALUES ride in
# the entry (a build before the bug round's) or in the rb-en_ns_* namespace
# chunks the scanner, the report and the parse simulator import (this
# round's: a shard's English loads with its page), and a namespace's English
# values can ride in a component chunk as object literals, so every literal
# check below reads a component chunk and matches the literal only where JSX
# or code prints it (children:"…", label:"…", an array item), never a
# key:"value" pair. The two "no chunk carries" sentences also read those
# namespace chunks (never rb-en_all, the whole-file safety net).
#
# THE STAGE: the scanner chunk reads a freeScanPage.* key (only this lane
# writes that root). Until it does, every claim is INFO ("not yet
# published"); from then on each one is PASS or FAIL.
#
# THE CLAIMS, one line each (by key):
#   L0  the chunks above can be read (FAIL when the layout moved: nothing
#       below could be judged).
#   L1  the stage; FAIL when the scanner chunk is new and the report's is not.
#   S14X-019  the scanner keeps the report across a sign-in (rb_pending_report).
#   S14X-020  the free-scan button wraps its label (h-auto min-h-16; the fixed
#             one-line 'h-16 text-lg' is gone from that button).
#   S14X-032  the 'Applying in' select lists every market the scanner keeps
#             standards for (52, not 24) and the CV standards page links the
#             scan with ?market=.
#   S14X-057  the report prints none of fifteen English headings and labels,
#             the market card's title is a freeScanPage key, the parse
#             simulator reads its strings, and the career-situation badge does
#             not interpolate the raw confidence enum.
#   S14X-058  the report's tailor call retries only an unanswered request with
#             no breaker, and the raw 'Failed to generate tailored resume'
#             fallback is gone.
#   S14X-182  the backup scanner's hourly budget has its own toast.
#   S14X-210  the share card's ring is an SVG arc (no conic-gradient), and
#             NB-16: a card with no name reads 'Your results'.
#   S14X-240  the pulse box says why no confirmation was asked for.
#   S14X-257  the hero drop zone offers no .doc.
#   RC-OI-28  role tips do not match the substring 'ea'.
#   RC-S13-036 no chunk says 'Not a simulation' of an upload.
#   RC-OI-29  the diagnostic header and the PDF subject print no raw industry
#             id with '(… confidence)'.
#   RC-S13-019 the report prints no backup-scanner atsNote.
#   RC-S13-094 no chunk carries a hand-typed '7 scans' sentence.
#   RC-S13-099 the old-address router sends a scan-report mail's /#pricing to
#             /pricing#full-analysis.
#   S14X-048  the uploader says before checkout how much of a long posting is
#             read.
#   S14X-253  the drop and credit toasts and the hero drop zone are keys.
#   S14X-285  the builder hand-off carries the résumé's fingerprint.
#   S14X-118, S14X-144  the backup-scanner request carries userContext and
#             deadlineAt.
#   S14X-269  no chunk claims every quoted line is verified.
#   S14X-270  the posting box can say a clipped link (shows once
#             fetch-job-posting sends its truncated flag).
#   S14X-028  the length card reads the country's page range when the scan
#             sends one.
#   NB-7      the PDF summary draws no arrow and has a print-dialog fallback.
#   NB-17     the intent block and the parse banner are keys.
#   O1  S14X-012 option B (owner-gated): the report offers no drip opt-in.
#   O2  S14X-101 'remove' (owner-gated): the report calls no save-lead.
#   O3  S14X-101 'remove' (owner-gated): save-lead and notify-owner serve
#       2026-11-12.1 or later (both, or a FAIL for half a paste).
#   An owner line prints INFO 'owner pending' until
#   reservations['bug-round'].ownerDecided in docs/deploy-ledger.json names its
#   key.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite (INFO line X1):
# S14X-046 (one-industry-correction-is-one-logged-row), S14X-255
# (the-scan-page-formats-numbers-and-dates-in-the-readers-language), S14X-043's
# retry half (the-backup-scan-is-sent-what-the-visitor-asked-for), NB-6
# (the-section-audit-is-not-shown-for-a-cv-in-another-language), NB-15
# (a-scan-answered-for-a-resume-no-longer-on-screen-shows-nothing) and NB-45
# (every-field-on-the-scanner-page-has-a-name).
#
# READ-ONLY. GETs of /resume-checker and five chunks, two OPTIONS preflights.
# Nothing is posted and no scan is run.
echo "== 99zzzzzzz-bugs-free-scan-page. bug round, free-scan-page lane: the scanner and its report in the reader's language, a report kept across sign-in, every market, honest claims =="

rm -f /tmp/vd_bfsp_page.html /tmp/vd_bfsp_entry.js /tmp/vd_bfsp_idx.js /tmp/vd_bfsp_fkr.js /tmp/vd_bfsp_aps.js /tmp/vd_bfsp_cvs.js /tmp/vd_bfsp_en.js
VDFS_LEDGER="${VDFS_LEDGER:-docs/deploy-ledger.json}"

# Owner answers, from the ledger the integrator writes: the decided value, or empty.
# An answer is a string, or an object whose choice (or option) names it: the
# plan records {choice, rule}, and the rule's words are not the answer.
vdfs_owner() { # $1 key
  VDFS_K="$1" node -e 'const fs=require("fs");let d=null;try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{}const o=d&&d.reservations&&d.reservations["bug-round"]&&d.reservations["bug-round"].ownerDecided;const r=o&&typeof o==="object"&&Object.prototype.hasOwnProperty.call(o,process.env.VDFS_K)?o[process.env.VDFS_K]:null;const v=r&&typeof r==="object"&&typeof (r.choice??r.option)==="string"?(r.choice??r.option):r;console.log(v===null||v===undefined?"":(typeof v==="string"?v:JSON.stringify(v)).replace(/\s+/g," ").slice(0,80)||"decided")' "$VDFS_LEDGER"
}
vdfs_build() { # $1 function -> the x-fn-build header, or empty
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -ai '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}
VDFS_O012=$(vdfs_owner S14X-012)
VDFS_O101=$(vdfs_owner S14X-101)

# The chunks.
curl -s -m 30 "$SITE/resume-checker" > /tmp/vd_bfsp_page.html
VDFS_ENTRY=$(grep -ao '/assets/index-[A-Za-z0-9_-]*\.js' /tmp/vd_bfsp_page.html | head -1)
VDFS_IDX=$(grep -ao '/assets/Index-[A-Za-z0-9_-]*\.js' /tmp/vd_bfsp_page.html | head -1)
[ -n "$VDFS_ENTRY" ] && curl -s -m 60 "$SITE$VDFS_ENTRY" > /tmp/vd_bfsp_entry.js
[ -n "$VDFS_IDX" ] && curl -s -m 60 "$SITE$VDFS_IDX" > /tmp/vd_bfsp_idx.js
VDFS_FKR=$( { [ -f /tmp/vd_bfsp_idx.js ] && grep -ao 'FreeKeywordResults-[A-Za-z0-9_-]*\.js' /tmp/vd_bfsp_idx.js; } | head -1)
[ -n "$VDFS_FKR" ] && curl -s -m 60 "$SITE/assets/$VDFS_FKR" > /tmp/vd_bfsp_fkr.js
VDFS_APS=$( { [ -f /tmp/vd_bfsp_fkr.js ] && grep -ao 'ATSParseSimulator-[A-Za-z0-9_-]*\.js' /tmp/vd_bfsp_fkr.js; [ -f /tmp/vd_bfsp_idx.js ] && grep -ao 'ATSParseSimulator-[A-Za-z0-9_-]*\.js' /tmp/vd_bfsp_idx.js; } | head -1)
[ -n "$VDFS_APS" ] && curl -s -m 60 "$SITE/assets/$VDFS_APS" > /tmp/vd_bfsp_aps.js
VDFS_CVS=$( { [ -f /tmp/vd_bfsp_entry.js ] && grep -ao 'CvStandards-[A-Za-z0-9_-]*\.js' /tmp/vd_bfsp_entry.js; } | head -1)
[ -n "$VDFS_CVS" ] && curl -s -m 60 "$SITE/assets/$VDFS_CVS" > /tmp/vd_bfsp_cvs.js
: > /tmp/vd_bfsp_en.js
for VDFS_NS in $(cat /tmp/vd_bfsp_idx.js /tmp/vd_bfsp_fkr.js /tmp/vd_bfsp_aps.js 2>/dev/null | grep -aoE 'rb-en_ns_[A-Za-z0-9_-]+\.js' | sort -u | head -40); do
  curl -s -m 60 "$SITE/assets/$VDFS_NS" >> /tmp/vd_bfsp_en.js; echo >> /tmp/vd_bfsp_en.js
done

# The two functions the owner's S14X-101 answer changes.
VDFS_SLB=$(vdfs_build save-lead)
VDFS_NOB=$(vdfs_build notify-owner)
VDFS_SLGE=no; [ -n "$VDFS_SLB" ] && build_ge save-lead "$VDFS_SLB" 2026-11-12 1 && VDFS_SLGE=yes
VDFS_NOGE=no; [ -n "$VDFS_NOB" ] && build_ge notify-owner "$VDFS_NOB" 2026-11-12 1 && VDFS_NOGE=yes

VDFS_N_ENTRY="$VDFS_ENTRY" VDFS_N_IDX="$VDFS_IDX" VDFS_N_FKR="$VDFS_FKR" VDFS_N_APS="$VDFS_APS" VDFS_N_CVS="$VDFS_CVS" \
VDFS_O012="$VDFS_O012" VDFS_O101="$VDFS_O101" VDFS_SLB="$VDFS_SLB" VDFS_NOB="$VDFS_NOB" VDFS_SLGE="$VDFS_SLGE" VDFS_NOGE="$VDFS_NOGE" node -e '
const fs = require("fs");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const E = process.env;
const C = { entry: rd("/tmp/vd_bfsp_entry.js"), idx: rd("/tmp/vd_bfsp_idx.js"), fkr: rd("/tmp/vd_bfsp_fkr.js"), aps: rd("/tmp/vd_bfsp_aps.js"), cvs: rd("/tmp/vd_bfsp_cvs.js"), en: rd("/tmp/vd_bfsp_en.js") };
const N = { entry: E.VDFS_N_ENTRY || "", idx: E.VDFS_N_IDX || "", fkr: E.VDFS_N_FKR || "", aps: E.VDFS_N_APS || "", cvs: E.VDFS_N_CVS || "" };
const NAME = { entry: "entry", idx: "scanner", fkr: "report", aps: "parse simulator", cvs: "CV standards", en: "English namespace" };
const say = (v, id, m) => console.log(v + "  " + id + " " + m);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// L0: the layout.
const unread = [];
if (!N.entry || !C.entry) unread.push("the entry (/assets/index-*.js)");
if (!N.idx || !/startStreamingScan|free-keyword-scan/.test(C.idx)) unread.push("the scanner chunk (/assets/Index-*.js that calls the scanner)");
if (!N.fkr || !C.fkr) unread.push("the report chunk (FreeKeywordResults-*.js)");
const blind = unread.length > 0;
if (blind) say("FAIL", "L0", "/resume-checker could not be read down to " + unread.join(", ") + ": the bundle layout moved, so no chunk claim of this lane can be judged");
else say("INFO", "L0", "chunks read: " + [N.entry, N.idx, N.fkr, N.aps || "(no parse simulator chunk named)", N.cvs || "(no CV standards chunk named)"].map((s) => s.replace("/assets/", "")).join(", "));

// L1: the stage.
const live = !blind && /freeScanPage\./.test(C.idx);
if (blind) { /* nothing to stage */ }
else if (live) say("PASS", "L1", "the published scanner chunk reads the lane\x27s freeScanPage strings: the merge carrying the round published");
else say("INFO", "L1", "the published scanner chunk is today\x27s page (no freeScanPage key): the merge carrying the round has not published, so each claim below is INFO");
if (live && !/freeScanPage\./.test(C.fkr)) say("FAIL", "L1", "the report chunk reads no freeScanPage key though the scanner chunk does: the report was not rebuilt with the page");

const claim = (id, what, need, test) => {
  if (blind) return;
  const gone = need.filter((c) => !C[c]);
  if (!live) {
    let today = "";
    if (!gone.length) { try { if (test()[0]) today = " (already holds today)"; } catch { /* judged after the merge */ } }
    say("INFO", id, what + ": not yet published" + today);
    return;
  }
  if (gone.length) { say("FAIL", id, what + ": the " + gone.map((c) => NAME[c]).join(" and ") + " chunk could not be read"); return; }
  const [ok, why] = test();
  say(ok ? "PASS" : "FAIL", id, what + (ok ? "" : " — but " + why));
};
const has = (c, re) => re.test(C[c]);

claim("S14X-019", "a sign-in from the report keeps the report in this tab and comes back to it (rb_pending_report)", ["idx"],
  () => [has("idx", /rb_pending_report/), "the scanner chunk never writes rb_pending_report: the reader comes back to an empty scanner"]);
claim("S14X-020", "the free-scan button wraps its label on a phone (h-auto min-h-16)", ["idx"],
  () => {
    const old = has("idx", /h-16 text-lg gap-3 border-2 border-success/);
    const wraps = has("idx", /h-auto min-h-16/);
    return [!old && wraps, old ? "the free-scan button still carries the fixed one-line h-16 text-lg" : "no button carries h-auto min-h-16"];
  });
claim("S14X-032", "the Applying-in select lists every market the scanner keeps standards for, and the CV standards page links the scan with ?market=", ["idx", "cvs"],
  () => {
    const lists = C.idx.match(/\[(?:\["[A-Z]{2}","[^"\\]+"\],?){20,}\]/g) || [];
    const n = Math.max(0, ...lists.map((l) => (l.match(/\["[A-Z]{2}"/g) || []).length));
    const link = has("cvs", /\?market=\$\{/);
    return [n >= 52 && link, (n < 52 ? "the longest market list holds " + n + " markets, not 52" : "") + (n < 52 && !link ? "; " : "") + (!link ? "the CV standards chunk builds no ?market= link" : "")];
  });
const LITERALS = ["ATS Compatibility", "Recruiter Impact", "Credibility Flags", "High Priority", "Content Insights", "Quantified Metrics Found", "Executive Scope Check", "Section Length Audit", "ATS Parse Preview", "Target ATS: ", "Must have", "High impact", " Market Intelligence", " CV norms", "Triggered by:"];
claim("S14X-057", "the report prints its headings in the reader\x27s language: none of " + LITERALS.length + " English literals, the market title, the parse simulator and the confidence word are keys", ["fkr", "aps"],
  () => {
    const printed = LITERALS.filter((s) => new RegExp("(?:children:\\[?|label:|[,\\[])\"" + esc(s) + "\"").test(C.fkr));
    const why = [];
    if (printed.length) why.push("the report chunk still prints " + printed.map((s) => JSON.stringify(s.trim())).join(", "));
    if (!has("fkr", /freeScanPage\.market\.title/)) why.push("the market card names no freeScanPage.market.title");
    if (!has("aps", /freeScanPage\.parseCheck\./)) why.push("the parse simulator reads no freeScanPage.parseCheck key");
    if (has("fkr", /confidencePercent",\{confidence:[\w$.]+\.confidence\}/)) why.push("the career-situation badge still interpolates the raw confidence enum");
    return [why.length === 0, why.join("; ")];
  });
claim("S14X-058", "the report\x27s tailor call retries only an unanswered request, with no breaker, and words its refusal as the writing tools do", ["idx"],
  () => {
    const raw = has("idx", /Failed to generate tailored resume/);
    const once = has("idx", /"generate-tailored-resume",\{[\s\S]{0,900}?\},\{[^{}]{0,120}?shouldRetry:[\w$]+,enableCircuitBreaker:!1/);
    return [!raw && once, [raw ? "the raw \x27Failed to generate tailored resume\x27 fallback is still there" : "", once ? "" : "the tailor call carries no shouldRetry with the breaker off"].filter(Boolean).join("; ")];
  });
claim("S14X-182", "the backup scanner\x27s hourly budget has its own toast, not the daily limit\x27s", ["idx"],
  () => [has("idx", /freeScanPage\.toast\.budgetTitle/), "the scanner chunk names no freeScanPage.toast.budgetTitle"]);
claim("S14X-210", "the share card\x27s ring is an SVG arc html2canvas draws, and a card with no name reads \x27Your results\x27 (NB-16)", ["fkr"],
  () => {
    const why = [];
    if (has("fkr", /conic-gradient\(/)) why.push("a conic-gradient is still drawn");
    if (!has("fkr", /data-score-arc/)) why.push("no data-score-arc");
    if (!has("fkr", /freeScanPage\.share\.yourResults/) || has("fkr", /,"\x27s Results"\]/)) why.push("the nameless heading is still built as \x27…\x27s Results\x27");
    return [why.length === 0, why.join("; ")];
  });
claim("S14X-240", "the pulse box says why no confirmation was asked for", ["fkr"],
  () => [has("fkr", /freeScanPage\.pulse\.notAsked/), "the report chunk names no freeScanPage.pulse.notAsked"]);
claim("S14X-257", "the hero drop zone offers only what the scanner reads (no .doc)", ["idx"],
  () => [!has("idx", /accept:"\.pdf,\.docx,\.doc,\.txt/), "a drop zone still accepts .doc"]);
claim("RC-OI-28", "role tips match a title by whole words (no substring \x27ea\x27)", ["fkr"],
  () => [!has("fkr", /\.includes\("ea"\)/), "the report chunk still tests .includes(\"ea\")"]);
claim("RC-S13-036", "no chunk says \x27Not a simulation\x27 of an upload", ["fkr", "aps"],
  () => [!has("fkr", /Not a simulation/) && !has("aps", /Not a simulation/), "\x27Not a simulation\x27 is still printed"]);
claim("RC-OI-29", "the diagnostic header and the PDF subject name the industry in words with a translated confidence", ["fkr"],
  () => [!has("fkr", / confidence\)`/) && has("fkr", /freeScanPage\.confidence\./), has("fkr", / confidence\)`/) ? "the raw \x27(… confidence)\x27 template is still there" : "no freeScanPage.confidence key"]);
claim("RC-S13-019", "the report prints no backup-scanner atsNote graded on its own bands", ["fkr"],
  () => [!has("fkr", /\.atsNote\b/), "the report chunk still reads .atsNote"]);
const SEVEN = /\b7 (?:free )?scans(?:\/day| a day)|Tienes 7 escaneos/;
claim("RC-S13-094", "no chunk carries a hand-typed \x277 scans\x27 sentence (the allowance is read from one module)", ["entry", "idx", "fkr"],
  () => { const at = ["entry", "idx", "fkr", "en"].filter((c) => SEVEN.test(C[c])); return [at.length === 0, "the " + at.map((c) => NAME[c]).join(" and ") + " chunk still types it"]; });
claim("RC-S13-099", "the old-address router sends a scan-report mail\x27s /#pricing to /pricing#full-analysis", ["entry"],
  () => [has("entry", /scan_report[\s\S]{0,400}#full-analysis|#full-analysis[\s\S]{0,400}scan_report/), "the entry has no scan_report route to #full-analysis"]);
claim("S14X-048", "the uploader says before checkout how much of a long posting the analysis reads", ["idx"],
  () => [has("idx", /freeScanPage\.checkout\.postingOverCap/), "the scanner chunk names no freeScanPage.checkout.postingOverCap"]);
claim("S14X-253", "the drop and credit toasts and the hero drop zone are in the reader\x27s language", ["idx"],
  () => {
    const lit = has("idx", /title:"Unsupported file type"/) || has("idx", /title:"Scan credit used"/);
    const keys = has("idx", /freeScanPage\.toast\.creditUsedTitle/) && has("idx", /freeScanPage\.hero\.dropzone/);
    return [!lit && keys, lit ? "an English toast title is still typed" : "the toast or drop-zone keys are missing"];
  });
claim("S14X-285", "the builder hand-off names the résumé it was made for (fingerprint)", ["fkr"],
  () => [has("fkr", /rb_scan_fixes",JSON\.stringify\(\{[\s\S]{0,300}?fingerprint/), "rb_scan_fixes is written with no fingerprint"]);
claim("S14X-118", "the backup-scanner request carries what the visitor told the primary (userContext)", ["idx"],
  () => [has("idx", /JSON\.stringify\(\{resumeText:(?:(?!signal:)[\s\S]){0,900}?userContext/), "the fork\x27s request body has no userContext"]);
claim("S14X-144", "the backup-scanner request carries the page\x27s deadline (deadlineAt)", ["idx"],
  () => [has("idx", /JSON\.stringify\(\{resumeText:(?:(?!signal:)[\s\S]){0,900}?deadlineAt/), "the fork\x27s request body has no deadlineAt"]);
const EVERY = /Every quoted line (?:in the full report )?is verified/;
claim("S14X-269", "no chunk claims every quoted line is verified", ["entry", "idx", "fkr"],
  () => { const at = ["entry", "idx", "fkr", "en"].filter((c) => EVERY.test(C[c])); return [at.length === 0, "the " + at.map((c) => NAME[c]).join(" and ") + " chunk still says it"]; });
claim("S14X-270", "the posting box can say a clipped link (it shows once fetch-job-posting sends truncated)", ["idx"],
  () => [has("idx", /freeScanPage\.jobUrl\.truncated/), "the scanner chunk names no freeScanPage.jobUrl.truncated"]);
claim("S14X-028", "the length card reads the country\x27s page range when the scan sends one", ["fkr"],
  () => [has("fkr", /pagesMin/), "the report chunk never reads pagesMin"]);
claim("NB-7", "the PDF summary draws no arrow and sends what its font cannot draw to the print dialog", ["fkr"],
  () => [!has("fkr", /→ {1,2}about/) && has("fkr", /data-summary-print/), has("fkr", /→ {1,2}about/) ? "the score line still draws an arrow" : "no print-dialog fallback (data-summary-print)"]);
claim("NB-17", "the intent block and the parse banner are in the reader\x27s language", ["idx"],
  () => [has("idx", /freeScanPage\.intent\.heading/) && has("idx", /freeScanPage\.parse\.issue\./), "the intent or parse-banner keys are missing"]);
if (!blind) say("INFO", "X1", "proved in the suite, not from outside: S14X-046, S14X-255, S14X-043 (the retry half), NB-6, NB-15, NB-45");

// Owner-gated.
const optB = (v) => /(^|[^A-Za-z])B([^A-Za-z]|$)/.test(v);
if (blind) { /* O1 reads the report chunk */ }
else if (!E.VDFS_O012) say("INFO", "O1", "the report offers no drip opt-in and promises no drip mail (S14X-012 option B): owner pending");
else if (!optB(E.VDFS_O012)) say("INFO", "O1", "S14X-012 decided \"" + E.VDFS_O012 + "\": the report keeps its drip box, so nothing here changes");
else if (!live) say("INFO", "O1", "the report offers no drip opt-in (S14X-012 option B): not yet published");
else if (has("fkr", /dripOptIn|dripConfirmSent/)) say("FAIL", "O1", "S14X-012 is decided B but the report chunk still offers the drip opt-in or its confirmation line");
else say("PASS", "O1", "the report offers no drip opt-in and promises no drip mail (S14X-012 option B)");

const removed = (v) => /remove/i.test(v);
if (blind) { /* O2 reads the report chunk */ }
else if (!E.VDFS_O101) say("INFO", "O2", "the report has no weekly-tips box posting to save-lead (S14X-101): owner pending");
else if (!removed(E.VDFS_O101)) say("INFO", "O2", "S14X-101 decided \"" + E.VDFS_O101 + "\": not the removal this section judges");
else if (!live) say("INFO", "O2", "the report has no weekly-tips box posting to save-lead (S14X-101): not yet published");
else if (has("fkr", /"save-lead"/)) say("FAIL", "O2", "S14X-101 is decided \x27remove\x27 but the report chunk still calls save-lead");
else say("PASS", "O2", "the report has no weekly-tips box posting to save-lead (S14X-101)");

const sl = E.VDFS_SLB || "", no = E.VDFS_NOB || "";
const builds = "save-lead " + (sl || "(none)") + ", notify-owner " + (no || "(none)");
if (!E.VDFS_O101) say("INFO", "O3", "save-lead and notify-owner send the owner no address, IP or country (S14X-101): owner pending (" + builds + ")");
else if (!removed(E.VDFS_O101)) say("INFO", "O3", "S14X-101 decided \"" + E.VDFS_O101 + "\": not the removal this section judges (" + builds + ")");
else if (!sl || !no) say("FAIL", "O3", "a preflight carries no x-fn-build (" + builds + "): the owner alerts cannot be judged");
else if (E.VDFS_SLGE === "yes" && E.VDFS_NOGE === "yes") say("PASS", "O3", "save-lead and notify-owner serve the round\x27s build or later (" + builds + "): the owner\x27s alerts carry no address, IP or country (S14X-101)");
else if (E.VDFS_SLGE === "yes" || E.VDFS_NOGE === "yes") say("FAIL", "O3", "only one of the two alerting functions carries 2026-11-12.1 or later (" + builds + "): half of S14X-101 was pasted");
else say("INFO", "O3", "the round\x27s paste with 2026-11-12.1 has not landed for save-lead and notify-owner (" + builds + "; section 49 lists the gap)");
'
