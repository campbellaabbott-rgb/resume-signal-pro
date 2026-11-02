# shellcheck shell=bash
# ── 99zzzz. THE FREE-SCAN WAVE'S REVIEW ROUND (2026-11-01; registers S13-004,
# S13-005, S13-008, S13-009, S13-010, S13-022, S13-024, S13-038, S13-050,
# S13-057, S13-058, S13-092, S13-094, S13-122, S10-006, S10-007).
#
# Named 99zzzz-free-scan-wave-review so it sorts after the engine and UI
# sections of the same wave.
#
# THE CLAIMS, one line each:
#   FR1  the published app carries the review round's English strings: the
#        hand-off box's no-rewrite offer (S13-038), the Pro footer (S13-094),
#        the too-long refusal (S13-008), the simulator's no-gain line at the
#        cap (S13-058) and the language banner's "look for English terms"
#        (S13-024). Read where the browser gets them, from the chunk holding
#        resumeBuilder's replaceWithLatestScan (as section FS3 does); no such
#        chunk is a FAIL that says so;
#   FR2  /research/ats-score-benchmarks, as a crawler reads it, counts "scans
#        logged" and never "completed scans" (S13-050/S13-087), and once
#        get_public_scan_insights answers scorer 'primary' (20261101100000)
#        the baked subline names the primary scanner. The bake reads the RPC
#        at publish time, so a publish before the migration bakes the older,
#        still-true subline: that case FAILs naming the order to fix;
#   FR3  INFO: the engine fixes (acronym plurals, employer lines, seasons and
#        glued dates, bare-number quantification, role and industry lookups,
#        the posting-host check) need a scan; their builds are judged in the
#        engine section and their behaviour in the vitest suite.
#
# Every probe is a GET (an anon RPC read of aggregates, two page fetches, one
# script chunk). No scan, upload, vote or checkout.

rm -f /tmp/vd_fr_en.js /tmp/vd_fr_study.html

# ---- FR1: the English strings the browser loads ----
VDFR_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDFR_FOUND=""
if [ -n "$VDFR_MAIN" ]; then
  for VDFR_CAND in $(bash scripts/verify-us-english.sh "$SITE$VDFR_MAIN"); do
    curl -s -m 60 "$SITE/assets/$VDFR_CAND" > /tmp/vd_fr_en.js
    if grep -qF "replaceWithLatestScan" /tmp/vd_fr_en.js; then VDFR_FOUND=$VDFR_CAND; break; fi
  done
fi
if [ -z "$VDFR_MAIN" ]; then echo "FAIL  FR1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDFR_FOUND" ]; then echo "FAIL  FR1 no English chunk the entry $VDFR_MAIN names holds resumeBuilder's strings: the bundle layout moved, so the review round's strings cannot be judged"
else
  VDFR_MISSING=""
  for VDFR_PAIR in \
    "Open in builder with your resume and missing keywords|S13-038 no-rewrite hand-off" \
    "Pro: no daily cap on scans|S13-094 Pro footer" \
    "the free scan reads up to|S13-008 too-long refusal" \
    "it projects no score above|S13-058 simulator cap line" \
    "look for English terms|S13-024 language banner"; do
    grep -qF "${VDFR_PAIR%%|*}" /tmp/vd_fr_en.js || VDFR_MISSING="$VDFR_MISSING, ${VDFR_PAIR#*|}"
  done
  if [ -n "$VDFR_MISSING" ]; then echo "FAIL  FR1 the English strings ($VDFR_FOUND) lack the review round's${VDFR_MISSING#,} (the frontend publish has not happened, or an older one is serving)"
  else echo "PASS  FR1 the English strings ($VDFR_FOUND) carry the hand-off offer, the Pro footer, the too-long refusal, the simulator's cap line and the language banner"; fi
fi

# ---- FR2: the benchmark page as a crawler reads it ----
curl -s -m 30 -A "$UA" "$SITE/research/ats-score-benchmarks" > /tmp/vd_fr_study.html
VDFR_INS=$(R get_public_scan_insights)
VD_BODY="$VDFR_INS" node -e '
const fs=require("fs");
const line=(s,m)=>console.log(s.padEnd(5)+" "+m);
let page="";try{page=fs.readFileSync("/tmp/vd_fr_study.html","utf8")}catch{}
if (page.length<500) { line("FAIL","FR2 the crawler /research/ats-score-benchmarks answered no page ("+page.length+" bytes)"); process.exit(0); }
const logged=/scans logged/.test(page), completed=/completed scans?/i.test(page);
line(logged&&!completed?"PASS":"FAIL","FR2 the crawler benchmark page "+(logged?"counts scans logged":"never says scans logged")+(completed?" and still says completed scans":" and never says completed scans"));
let r=null;try{r=JSON.parse(process.env.VD_BODY||"")}catch{}
const primary=!!r&&typeof r==="object"&&r.scorer==="primary";
const named=/Every figure is scored by our primary scanner\./.test(page);
if (!primary&&named) line("FAIL","FR2 the baked subline names the primary scanner while get_public_scan_insights answers no scorer ("+String(process.env.VD_BODY||"").slice(0,120)+"): the page claims a basis the RPC does not state");
else if (!primary) line("INFO","FR2 get_public_scan_insights does not answer scorer primary yet (20261101100000 not applied), so the baked subline rightly names no scorer");
else line(named?"PASS":"FAIL","FR2 the RPC answers scorer primary and the baked subline "+(named?"names the primary scanner and what it left out":"names no scorer: the frontend was published before 20261101100000 applied; publish the frontend again"));
'

echo "INFO  FR3 the engine half of the review round (acronym plurals, employer lines, seasons and glued dates, bare-number quantification, the role and industry lookups, the posting-host check) needs a scan: the builds are judged in 99zzzz-free-scan-wave-engine.sh, the behaviour in the vitest suite"
