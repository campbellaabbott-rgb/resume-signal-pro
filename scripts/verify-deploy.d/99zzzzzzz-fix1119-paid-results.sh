# shellcheck shell=bash
# ── 99zzzzzzz. BUG RECONCILE OF 2026-11-19, LANE PAID-RESULTS (branch
# fix/1119-paid-results; S13-051, S11-068, S10-060, S10-062, S10-151; build
# generate-interview-coach.2026-11-21.1; no migration).
#
# Named 99zzzzzzz-fix1119-* so it sorts after the 99zzzzzzz-bugs-* sections
# ("f" after "b") and before 99zzzzzzzz-board-103 (one more "z"), in byte
# order and under a collating locale.
#
# THE CLAIMS, one line each below:
#   PR1 generate-interview-coach serves 2026-11-21.1 or later (its preflight's
#       x-fn-build): a set is prepared for the posting it was given (S10-060).
#       Anything older, or no header, is FAIL.
#   PR2 the published success page (its chunk) no longer calls the report's
#       old "already on your résumé" key, and heads the posting's other
#       requirements with paidAnalysis.alsoAskedInPosting (S13-051). The old
#       key is INFO (the site has not published yet) until PR1 passes, then
#       FAIL. Neither key is FAIL: the report moved and cannot be judged.
#   PR3 the published purchase page's ATS Defense PDF writer (from its
#       header line to its save) passes no check mark, cross, warning sign or
#       arrow to the PDF writer (S10-062): any of the four, as a character or
#       as an escape, is INFO until PR1 passes, then FAIL. Without its ASCII
#       arrow ("% -> Target: ") the writer changed shape and cannot be judged:
#       FAIL. No writer found is FAIL.
#   PR4 what no read here can prove is INFO.
#
# READ-ONLY. One preflight (OPTIONS runs no function logic) and GETs of the
# site's entry and two chunks. No function is POSTed, nothing is written, no
# model is called and no mail is sent.
echo "== 99zzzzzzz. bug reconcile, paid results: the coach reads the posting, the report claims no unchecked match, the ATS Defense PDF prints what helvetica can =="

# PR1
VDPR_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/generate-interview-coach" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VDPR_NEW=0
if [ -z "$VDPR_H" ]; then
  echo "FAIL  PR1 generate-interview-coach preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge generate-interview-coach "$VDPR_H" "2026-11-21" "1"; then
  echo "PASS  PR1 generate-interview-coach preflight x-fn-build = $VDPR_H (generate-interview-coach.2026-11-21.1 or later: a set is prepared for the posting it was given)"
  VDPR_NEW=1
else
  echo "FAIL  PR1 generate-interview-coach preflight x-fn-build = $VDPR_H, older than generate-interview-coach.2026-11-21.1: a past buyer's set is still written for 'the role matching their background', not the posting"
fi

# The entry names both chunks.
VDPR_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDPR_MAINJS=""
[ -n "$VDPR_MAIN" ] && VDPR_MAINJS=$(curl -s -m 30 "$SITE$VDPR_MAIN")
VDPR_SUCC=$(printf '%s' "$VDPR_MAINJS" | grep -o '"\./Success-[A-Za-z0-9_-]*\.js"' | head -1 | tr -d '"' | sed 's|^\./||')
VDPR_PS=$(printf '%s' "$VDPR_MAINJS" | grep -o '"\./ProductSuccess-[A-Za-z0-9_-]*\.js"' | head -1 | tr -d '"' | sed 's|^\./||')

vdpr_late() { # $1 claim, $2 the chunk, $3 what it still does
  if [ "$VDPR_NEW" = 1 ]; then echo "FAIL  $1 the published $2 $3 while generate-interview-coach serves 2026-11-21.1: this lane's frontend has not published"
  else echo "INFO  $1 the published $2 $3: this lane's frontend has not published yet"; fi
}

# PR2
if [ -z "$VDPR_SUCC" ]; then
  echo "FAIL  PR2 the served entry (${VDPR_MAIN:-none found}) names no Success chunk: the frontend is not serving, or the bundle layout moved, so the report cannot be judged"
else
  VDPR_SJS=$(curl -s -m 30 "$SITE/assets/$VDPR_SUCC")
  VDPR_OLD=0; printf '%s' "$VDPR_SJS" | grep -qF 'analysisResults.jdKeywordsOnResume' && VDPR_OLD=1
  VDPR_NEWKEY=0; printf '%s' "$VDPR_SJS" | grep -qF 'paidAnalysis.alsoAskedInPosting' && VDPR_NEWKEY=1
  if [ "$VDPR_OLD" = 1 ]; then vdpr_late "PR2 S13-051" "success page ($VDPR_SUCC)" "still heads the posting's requirements as already on the buyer's résumé (analysisResults.jdKeywordsOnResume), which nothing checks"
  elif [ "$VDPR_NEWKEY" = 1 ]; then echo "PASS  PR2 S13-051 the published success page ($VDPR_SUCC) heads the posting's other requirements as asked for in the posting (paidAnalysis.alsoAskedInPosting), never as already on the résumé"
  else echo "FAIL  PR2 S13-051 the published success page ($VDPR_SUCC) carries neither the old heading's key nor paidAnalysis.alsoAskedInPosting: the report moved, so the claim cannot be judged"; fi
fi

# PR3: the writer is the stretch from its header line to its save; the
# report's strings (the same title among them) ride in the chunk too, so the
# header is found as the writer draws it.
if [ -z "$VDPR_PS" ]; then
  echo "FAIL  PR3 the served entry (${VDPR_MAIN:-none found}) names no ProductSuccess chunk: the frontend is not serving, or the bundle layout moved, so the ATS Defense PDF cannot be judged"
else
  VDPR_PJS=$(curl -s -m 30 "$SITE/assets/$VDPR_PS")
  # A writer split into a chunk of its own is read from there.
  if ! printf '%s' "$VDPR_PJS" | grep -qF 'ats-defense-report.pdf'; then
    VDPR_ATS=$(printf '%s' "$VDPR_PJS" | grep -o '"\./ATSDefense[A-Za-z0-9_]*-[A-Za-z0-9_-]*\.js"' | head -1 | tr -d '"' | sed 's|^\./||')
    [ -n "$VDPR_ATS" ] && VDPR_PS="$VDPR_ATS" && VDPR_PJS=$(curl -s -m 30 "$SITE/assets/$VDPR_ATS")
  fi
  VDPR_W=$(printf '%s' "$VDPR_PJS" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
const m=/\.text\(\s*["\x27`]ATS Defense Complete Report["\x27`]/.exec(s);const end=s.indexOf("ats-defense-report.pdf");
if(!m||end<0||end<m.index){console.log("NOWRITER");return}
const w=s.slice(m.index,end);const found=[];
for(const [cp,name] of [[0x2713,"check mark"],[0x2714,"check mark"],[0x2717,"cross"],[0x2718,"cross"],[0x26a0,"warning sign"],[0x2192,"arrow"]]){
const hex=cp.toString(16);if(w.includes(String.fromCodePoint(cp))||new RegExp("\\\\u\\{?0*"+hex+"\\}?","i").test(w))found.push(name+" U+"+hex.toUpperCase().padStart(4,"0"))}
if(found.length){console.log("GLYPHS:"+[...new Set(found)].join(", "));return}
console.log(w.includes("% -> Target: ")?"CLEAN":"NOARROW")})')
  case "$VDPR_W" in
    CLEAN) echo "PASS  PR3 S10-062 the published ATS Defense PDF writer ($VDPR_PS) passes no check mark, cross, warning sign or arrow to helvetica, and draws its arrow in ASCII (% -> Target:)" ;;
    GLYPHS:*) vdpr_late "PR3 S10-062" "ATS Defense PDF writer ($VDPR_PS)" "still passes ${VDPR_W#GLYPHS:} to helvetica, which jsPDF writes in WinAnsi, so each prints as other glyphs" ;;
    NOARROW) echo "FAIL  PR3 S10-062 the published ATS Defense PDF writer ($VDPR_PS) carries none of the four glyphs but no ASCII arrow either (% -> Target:): the writer changed shape, so the claim cannot be judged" ;;
    *) echo "FAIL  PR3 S10-062 the published $VDPR_PS holds no ATS Defense PDF writer (its header line through ats-defense-report.pdf; read: ${VDPR_W:-nothing}): the bundle layout moved, so the PDF cannot be judged" ;;
  esac
fi

echo "INFO  PR4 proven in the suite, never here (each needs a POST to a function, a model call, a purchase or a rendered page): the coach puts a posting's title, company and first 4,000 characters in its prompt, a call without them sends the prompt it always did, and a delivery's stand-in title for a checkout that named no job is never the role (S10-060); a wrapped action or red flag pushes the next line below it (S10-062); a LinkedIn score with no breakdown, or one malformed section, leaves the rest of the paid report on the page, and the builder keeps only the strings of its lists (S11-068); the generation overlay's clock starts when it is shown (S10-151)"
