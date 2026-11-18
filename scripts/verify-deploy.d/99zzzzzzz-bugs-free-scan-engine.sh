# shellcheck shell=bash
# ── 99zzzzzzz-bugs-free-scan-engine. BUG ROUND A, LANE FREE-SCAN-ENGINE
# (branch bugs/a-free-scan-engine). The two free scanners (free-keyword-scan,
# the primary, and free-keyword-scan-stream, the page's backup) and migration
# 20261112170000: a scan that delivered no full report gives the visitor's
# day back (give_back_scan_day, service role only), the correction log takes
# only labels the scanner knows and that differ, the public total leaves out
# cache replays and names its basis, and the health reader counts a report
# the model did not write apart from a success (model_fallback_last_hour).
# Country standards no longer state a legal bar the law does not set (Poland,
# Italy), the length judged is the market's own, and a scan in any of the
# nine report languages is read in that language.
#
# THE CLAIMS, one line each:
#   B   free-keyword-scan serves 2026-11-15.2 or later (above hotfix NB-1's
#       2026-11-15.1) and free-keyword-scan-stream 2026-11-12.1 or later, on
#       their preflights. While neither does, INFO (not pasted yet); once one
#       does, the other older is a FAIL (a partial paste). A preflight with
#       no x-fn-build is a FAIL either way;
#   M   give_back_scan_day exists and the publishable key cannot run it
#       (42501). Before the paste it is missing (PGRST202): INFO, and a FAIL
#       once the scanners serve the round's build (the migration goes first);
#   C   log_industry_correction, both overloads, refuses a label the scanner
#       does not know, and one that only differs in case, before any write: a
#       GET answers 204 or null where it answered 25006 (it reached its write
#       and only the read-only transaction stopped it). The control, a real
#       correction (technology to healthcare), must still reach its write
#       (25006) or no refusal line is judged. Before the migration the
#       refusals are INFO;
#   T   get_scan_totals names its basis, and the basis says cache replays are
#       not counted (S14X-145). INFO before the migration;
#   H   get_scan_health_status carries model_fallback_last_hour, and an hour
#       with fallbacks names them in its issues (RC-OI-04). INFO before the
#       migration;
#   P   /cv-standards/poland and /cv-standards/italy, as Googlebot reads
#       them, no longer say employers "cannot process applications" or CVs
#       are "often filtered out" without a consent line (S14X-030, S14X-029).
#       Each page must carry its consent line at all (RODO; 196/2003) to be
#       judged. The old text is INFO until the scanners serve the round's
#       build (the publish follows the functions), a FAIL after;
#   O   S14X-101 (the alert carries no IP) prints INFO owner pending until
#       docs/deploy-ledger.json reservations['bug-round'].ownerDecided names
#       it; then free-keyword-scan must serve the round's build.
#
# WHAT THIS SECTION CANNOT SEE: every other claim needs a scan, which spends
# a model call and writes a report and a metric, so it is proven in the suite
# on the shipped handlers (the a-*.test.ts files the lane added, and the free
# scan's hour test), and the owner's read-only SQL is printed below as INFO.
#
# READ-ONLY. Two OPTIONS preflights, GETs of five PostgREST functions (each a
# GET, which PostgREST runs in a read-only transaction, so a function that
# tries to write fails with 25006 and commits nothing), and two pages as
# Googlebot. Nothing is posted.
echo "== 99zzzzzzz. bug round A free-scan-engine: two scanner builds, the day given back, the correction log's labels, the totals' basis, the fallback count, two country pages, owner gate =="

VDFSE_NEW=""
VDFSE_OLD=""
for VDFSE_W in free-keyword-scan:2026-11-15:2 free-keyword-scan-stream:2026-11-12:1; do
  VDFSE_F=${VDFSE_W%%:*}; VDFSE_R=${VDFSE_W#*:}; VDFSE_D=${VDFSE_R%%:*}; VDFSE_N=${VDFSE_R#*:}
  rm -f /tmp/vd_fse_hdr
  curl -s -m 30 -D /tmp/vd_fse_hdr -o /dev/null -X OPTIONS "$B/functions/v1/$VDFSE_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST"
  VDFSE_H=$(tr -d '\r' < /tmp/vd_fse_hdr 2>/dev/null | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -n "$VDFSE_H" ] && build_ge "$VDFSE_F" "$VDFSE_H" "$VDFSE_D" "$VDFSE_N"; then VDFSE_NEW="$VDFSE_NEW $VDFSE_F=$VDFSE_H=$VDFSE_D.$VDFSE_N"
  else VDFSE_OLD="$VDFSE_OLD $VDFSE_F=${VDFSE_H:-none}=$VDFSE_D.$VDFSE_N"; fi
done
VDFSE_LIVE=0
[ -n "$VDFSE_NEW" ] && VDFSE_LIVE=1
for VDFSE_P in $VDFSE_NEW; do
  VDFSE_F=${VDFSE_P%%=*}; VDFSE_R=${VDFSE_P#*=}
  echo "PASS  B $VDFSE_F preflight x-fn-build = ${VDFSE_R%%=*} (${VDFSE_R#*=} or later: the round's scanner)"
done
for VDFSE_P in $VDFSE_OLD; do
  VDFSE_F=${VDFSE_P%%=*}; VDFSE_R=${VDFSE_P#*=}; VDFSE_H=${VDFSE_R%%=*}; VDFSE_WANT=${VDFSE_R#*=}
  if [ "$VDFSE_H" = none ]; then echo "FAIL  B $VDFSE_F preflight carries no x-fn-build (not deployed, or its preflight does not answer; want $VDFSE_F.$VDFSE_WANT or later)"
  elif [ "$VDFSE_LIVE" = 1 ]; then echo "FAIL  B $VDFSE_F preflight x-fn-build = $VDFSE_H while the other scanner serves the round's build: a partial paste (want $VDFSE_F.$VDFSE_WANT or later)"
  else echo "INFO  B $VDFSE_F preflight x-fn-build = $VDFSE_H: bug round A's free-scan-engine ($VDFSE_WANT) is not pasted yet"; fi
done

# One GET of a PostgREST function; the body lands in /tmp/vd_fse_body and the
# HTTP status is printed. vdfse_code names what the body is: an error's code,
# EMPTY, NULL, ROWS:n, OBJECT, SCALAR or NONJSON.
vdfse_get() {
  rm -f /tmp/vd_fse_body
  curl -s -m 30 -o /tmp/vd_fse_body -w '%{http_code}' "$B/rest/v1/rpc/$1" -H "apikey: $K" -H "Authorization: Bearer $K"
}
vdfse_code() {
  node -e 'let s="";try{s=require("fs").readFileSync(process.argv[1],"utf8")}catch{}
if(s.trim()===""){console.log("EMPTY");process.exit(0)}
let j;try{j=JSON.parse(s)}catch{console.log("NONJSON");process.exit(0)}
console.log(j===null?"NULL":Array.isArray(j)?"ROWS:"+j.length:typeof j==="object"?(j.code?String(j.code):"OBJECT"):"SCALAR")' /tmp/vd_fse_body
}
vdfse_body() { head -c "${1:-160}" /tmp/vd_fse_body 2>/dev/null | tr -d '\n'; }

# M: give_back_scan_day, the migration's marker (S14X-043). A test-net address
# and a function name it refuses, so even a callable one would change nothing.
VDFSE_HTTP=$(vdfse_get "give_back_scan_day?p_ip=192.0.2.1&p_function=verify-probe")
VDFSE_C=$(vdfse_code)
VDFSE_MIG=0
case "$VDFSE_C" in
  42501) VDFSE_MIG=1; echo "PASS  M give_back_scan_day exists and the publishable key cannot run it (42501): a scan that delivered no full report gives the day back, and a stranger cannot give themselves days" ;;
  PGRST202)
    if [ "$VDFSE_LIVE" = 1 ]; then echo "FAIL  M give_back_scan_day does not exist (PGRST202) while a scanner serves the round's build: migration 20261112170000 is not applied, so a failed scan still costs the visitor one of the day's scans"
    else echo "INFO  M give_back_scan_day does not exist yet (PGRST202): migration 20261112170000 is not applied"; fi ;;
  25006|NULL|SCALAR|ROWS:*) VDFSE_MIG=1; echo "FAIL  M give_back_scan_day answered the publishable key (HTTP $VDFSE_HTTP, $VDFSE_C): anyone could give themselves days (must be 42501)  $(vdfse_body)" ;;
  *) echo "FAIL  M give_back_scan_day answered HTTP $VDFSE_HTTP ($VDFSE_C), neither 42501 nor PGRST202  $(vdfse_body)" ;;
esac

# C: the correction log's labels (S14X-046). The control first.
VDFSE_HTTP=$(vdfse_get "log_industry_correction?p_detected=technology&p_corrected=healthcare")
VDFSE_C=$(vdfse_code)
VDFSE_CTL=0
if [ "$VDFSE_C" = 25006 ]; then VDFSE_CTL=1; echo "PASS  C control: a real correction (technology to healthcare) still reaches its write (25006: this GET's read-only transaction stopped it)"
elif [ "$VDFSE_MIG" = 1 ]; then echo "FAIL  C control: a real correction (technology to healthcare) no longer reaches its write (HTTP $VDFSE_HTTP, $VDFSE_C): the label check refuses real labels, or the function is broken  $(vdfse_body)"
else echo "INFO  C control: a real correction did not reach its write before the migration (HTTP $VDFSE_HTTP, $VDFSE_C), so the refusal lines below are not judged  $(vdfse_body)"; fi
for VDFSE_Q in \
  "4-argument call refuses a label the scanner does not know|p_detected=technology&p_corrected=zz-not-an-industry" \
  "9-argument call refuses a label the scanner does not know|p_original_industry=technology&p_corrected_industry=zz-not-an-industry" \
  "9-argument call refuses a correction to the same label in another case|p_original_industry=technology&p_corrected_industry=Technology"; do
  VDFSE_WHAT=${VDFSE_Q%%|*}
  VDFSE_HTTP=$(vdfse_get "log_industry_correction?${VDFSE_Q#*|}")
  VDFSE_C=$(vdfse_code)
  if [ "$VDFSE_CTL" = 0 ]; then echo "INFO  C log_industry_correction's $VDFSE_WHAT: not judged (HTTP $VDFSE_HTTP, $VDFSE_C), the control did not reach its write"
  elif { [ "$VDFSE_HTTP" = 204 ] && [ "$VDFSE_C" = EMPTY ]; } || { [ "$VDFSE_HTTP" = 200 ] && { [ "$VDFSE_C" = NULL ] || [ "$VDFSE_C" = EMPTY ]; }; }; then
    echo "PASS  C log_industry_correction's $VDFSE_WHAT before any write (HTTP $VDFSE_HTTP), where the control reached its write"
  elif [ "$VDFSE_MIG" = 1 ]; then echo "FAIL  C log_industry_correction's $VDFSE_WHAT: not so (HTTP $VDFSE_HTTP, $VDFSE_C; 25006 means it reached its write)  $(vdfse_body)"
  else echo "INFO  C log_industry_correction's $VDFSE_WHAT: not yet (HTTP $VDFSE_HTTP, $VDFSE_C), migration 20261112170000 is not applied"; fi
done

# T: the public total's basis (S14X-145).
VDFSE_HTTP=$(vdfse_get "get_scan_totals")
VDFSE_T=$(node -e 'let s="";try{s=require("fs").readFileSync(process.argv[1],"utf8")}catch{}
let j=null;try{j=JSON.parse(s)}catch{}
if(!j||typeof j!=="object"||Array.isArray(j)||typeof j.total_scans!=="number"){console.log("BAD");process.exit(0)}
if(typeof j.basis!=="string"||j.basis===""){console.log("NOBASIS\t"+j.total_scans);process.exit(0)}
console.log((/cache/i.test(j.basis)&&/not counted|excluded|left out/i.test(j.basis)?"BASIS":"OTHERBASIS")+"\t"+j.total_scans+"\t"+j.basis.slice(0,160))' /tmp/vd_fse_body)
VDFSE_TR=${VDFSE_T#*	}; VDFSE_TN=${VDFSE_TR%%	*}; VDFSE_TB=${VDFSE_TR#*	}
case "${VDFSE_T%%	*}" in
  BASIS) echo "PASS  T get_scan_totals names its basis, cache replays not counted (total $VDFSE_TN; basis '$VDFSE_TB')" ;;
  OTHERBASIS) echo "FAIL  T get_scan_totals names a basis that does not leave out cache replays (total $VDFSE_TN; basis '$VDFSE_TB')" ;;
  NOBASIS)
    if [ "$VDFSE_MIG" = 1 ]; then echo "FAIL  T get_scan_totals names no basis (total $VDFSE_TN) while migration 20261112170000 is applied: cache replays are still counted"
    else echo "INFO  T get_scan_totals names no basis yet (total $VDFSE_TN): migration 20261112170000 is not applied"; fi ;;
  *) echo "FAIL  T get_scan_totals did not answer a total (HTTP $VDFSE_HTTP)  $(vdfse_body)" ;;
esac

# H: the health reader's fallback count (RC-OI-04).
VDFSE_HTTP=$(vdfse_get "get_scan_health_status")
VDFSE_HS=$(node -e 'let s="";try{s=require("fs").readFileSync(process.argv[1],"utf8")}catch{}
let j=null;try{j=JSON.parse(s)}catch{}
if(!Array.isArray(j)){console.log("BAD");process.exit(0)}
if(j.length===0){console.log("EMPTY");process.exit(0)}
const r=j[0]||{};
if(!("model_fallback_last_hour" in r)){console.log("NOCOL\t"+String(r.status));process.exit(0)}
const n=Number(r.model_fallback_last_hour);
if(!Number.isFinite(n)){console.log("NOTNUM\t"+String(r.model_fallback_last_hour));process.exit(0)}
const named=(Array.isArray(r.issues)?r.issues:[]).some((x)=>/model fallback/i.test(String(x)));
console.log((n>0&&!named?"UNNAMED":"OK")+"\t"+n+"\t"+String(r.status))' /tmp/vd_fse_body)
VDFSE_HR=${VDFSE_HS#*	}
case "${VDFSE_HS%%	*}" in
  OK) echo "PASS  H get_scan_health_status counts reports the model did not write apart: model_fallback_last_hour = ${VDFSE_HR%%	*} (status ${VDFSE_HR#*	})" ;;
  UNNAMED) echo "FAIL  H get_scan_health_status counts ${VDFSE_HR%%	*} model fallbacks this hour but no issue names them (status ${VDFSE_HR#*	})" ;;
  NOCOL)
    if [ "$VDFSE_MIG" = 1 ]; then echo "FAIL  H get_scan_health_status has no model_fallback_last_hour while migration 20261112170000 is applied: a rule-based report still reads as a success"
    else echo "INFO  H get_scan_health_status has no model_fallback_last_hour yet (status $VDFSE_HR): migration 20261112170000 is not applied"; fi ;;
  EMPTY) echo "INFO  H get_scan_health_status returned no row, so there is nothing to judge (HTTP $VDFSE_HTTP)" ;;
  NOTNUM) echo "FAIL  H get_scan_health_status's model_fallback_last_hour is not a number: $VDFSE_HR" ;;
  *) echo "FAIL  H get_scan_health_status did not answer rows (HTTP $VDFSE_HTTP)  $(vdfse_body)" ;;
esac

# P: two country pages as Googlebot reads them (S14X-030, S14X-029).
for VDFSE_Q in "poland|RODO|cannot process applications|not a legal requirement" "italy|196/2003|often filtered out|does not require it on a CV you send"; do
  VDFSE_PAGE=${VDFSE_Q%%|*}; VDFSE_R=${VDFSE_Q#*|}
  VDFSE_CTLW=${VDFSE_R%%|*}; VDFSE_R=${VDFSE_R#*|}; VDFSE_OLDW=${VDFSE_R%%|*}; VDFSE_NEWW=${VDFSE_R#*|}
  rm -f /tmp/vd_fse_page
  curl -s -m 30 -A "$UA" -o /tmp/vd_fse_page "$SITE/cv-standards/$VDFSE_PAGE"
  VDFSE_HAS_CTL=$(grep -cF "$VDFSE_CTLW" /tmp/vd_fse_page 2>/dev/null)
  VDFSE_HAS_OLD=$(grep -cF "$VDFSE_OLDW" /tmp/vd_fse_page 2>/dev/null)
  VDFSE_HAS_NEW=$(grep -cF "$VDFSE_NEWW" /tmp/vd_fse_page 2>/dev/null)
  if [ "${VDFSE_HAS_CTL:-0}" = 0 ]; then echo "INFO  P /cv-standards/$VDFSE_PAGE as Googlebot reads it carries no consent line at all ('$VDFSE_CTLW'), so it is not judged"
  elif [ "${VDFSE_HAS_OLD:-0}" = 0 ] && [ "${VDFSE_HAS_NEW:-0}" != 0 ]; then echo "PASS  P /cv-standards/$VDFSE_PAGE as Googlebot reads it says '$VDFSE_NEWW', not '$VDFSE_OLDW'"
  elif [ "${VDFSE_HAS_OLD:-0}" != 0 ] && [ "$VDFSE_LIVE" = 1 ]; then echo "FAIL  P /cv-standards/$VDFSE_PAGE as Googlebot reads it still says '$VDFSE_OLDW' while the scanners serve the round's build: the page was not re-baked"
  elif [ "${VDFSE_HAS_OLD:-0}" != 0 ]; then echo "INFO  P /cv-standards/$VDFSE_PAGE as Googlebot reads it still says '$VDFSE_OLDW': the round has not published"
  elif [ "$VDFSE_LIVE" = 1 ]; then echo "FAIL  P /cv-standards/$VDFSE_PAGE as Googlebot reads it says neither the old line nor '$VDFSE_NEWW' while the scanners serve the round's build"
  else echo "INFO  P /cv-standards/$VDFSE_PAGE as Googlebot reads it says neither the old line nor the new one: the round has not published"; fi
done

# O: the owner-gated key. ownerDecided maps key -> choice (a string, or an
# object with a choice), written by the integrator alone.
VDFSE_OD=$(node -e 'let l={};try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
const d=((l.reservations||{})["bug-round"]||{}).ownerDecided||{};const v=d[process.argv[2]];
process.stdout.write(v==null?"":typeof v==="object"?String(v.choice??v.option??JSON.stringify(v)):String(v))' "${VDFSE_LEDGER:-docs/deploy-ledger.json}" S14X-101)
if [ -z "$VDFSE_OD" ]; then echo "INFO  S14X-101 owner pending: the free scan's failure alert still carries the visitor's address, and each scanner's scan note the visitor's country, until the owner's answer is recorded"
else
  case " $VDFSE_NEW " in
    *" free-keyword-scan="*) echo "PASS  S14X-101 decided ($VDFSE_OD): free-keyword-scan, whose alert no longer carries the visitor's address, serves the round's build (the alert and note bodies are proven in the suite: a live alert needs a failing scan)" ;;
    *) if [ "$VDFSE_LIVE" = 1 ]; then echo "FAIL  S14X-101 decided ($VDFSE_OD), but free-keyword-scan does not serve the round's build while the stream does"
       else echo "INFO  S14X-101 decided ($VDFSE_OD); free-keyword-scan does not serve the round's build yet"; fi ;;
  esac
fi

echo "INFO  owner read-only SQL after the paste (each needs the service role, which this script never holds): S14X-046 SELECT count(*) FROM industry_corrections WHERE created_at > :paste AND (NOT scan_industry_known(original_industry) OR NOT scan_industry_known(corrected_industry) OR lower(original_industry) = lower(corrected_industry)) -- 0; S14X-043 a free scan that failed after the day was counted logs 'the day's scan was given back' in free-keyword-scan's (or the stream's) function log, never 'Day give-back not recorded'; RC-OI-04 SELECT count(*) FROM scan_metrics WHERE error_code = 'MODEL_FALLBACK' AND created_at > now() - interval '1 hour' -- equals model_fallback_last_hour above"
echo "INFO  proven in the suite, never here (each needs a scan, which spends a model call and writes a report): the day given back on a 5xx, a 402, a 429 and the hour ceiling, a backup scan that stops when the page gives up, the exhausted address that makes no hour check, the market's own page length, Japan's norms, the nine languages' sections and parse check, the Chinese CV's length, the printed CV's bullets, an international phone number, the triggered-by quote checked against the résumé, the open-ended dates, the employer names that are not skills"
