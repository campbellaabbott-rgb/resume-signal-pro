# shellcheck shell=bash
# ── 99zzzzzzz-bugs-writing-tools. THE BUG ROUND OF 2026-11-08, LANE WRITING
# TOOLS (branch bugs/a-writing-tools): RC-S12-051, RC-S12-052, RC-S12-114,
# RC-S13-064, S14X-059, S14X-090, S14X-109, S14X-119, S14X-167, S14X-169,
# S14X-205, S14X-265, S14X-266, S14X-267, S14X-268, S14X-270, the
# InterviewCoach half of S14X-058, the savedCopy half of RC-S12-042, the
# answers half of S14X-255, and NB-10 (owner-gated). Five functions carry
# their own change at 2026-11-12.1 (generate-apply-package,
# generate-tailored-resume, generate-interview-coach,
# generate-application-answers, fetch-job-posting); five more are rebuilt for
# _shared/ai-gateway-response.ts (generate-career-path, generate-career-
# snapshot, generate-graduate-gameplan, generate-keyword-fix,
# generate-product-preview). No migration. The pages are published by the
# merge itself.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE STAGES, read from production, never assumed:
#   functions  any of the ten functions answers 2026-11-12.1 or later: the
#              round's paste is live. Until then an older build is INFO; from
#              then on, a function still on an older build is a FAIL (the
#              paste left it behind), and so is the kit writer's preflight
#              without retry-after.
#   frontend   any of the page markers below is in the published bundle: the
#              merge published. Until then every page line is INFO; from then
#              on, a marker missing is a FAIL.
#   owner      NB-10 prints INFO 'owner pending' until
#              reservations['bug-round'].ownerDecided in docs/deploy-ledger.json
#              names it; an answer naming retire is then judged by a GET.
#
# THE CLAIMS, one line each:
#   F1-F10 each function serves 2026-11-12.1 or later.
#   S1  the kit writer's preflight exposes retry-after, so the co-pilot can
#       say when its limit ends (RC-S12-051).
#   P1  the tailor's toast for a busy model is the tailor's busy copy, never
#       the hourly limit (S14X-265).
#   P2  the answers panel words the site-wide and the network ceilings as not
#       the reader's own (S14X-205).
#   P3  a failed chunk's questions are shown to draft again (S14X-119).
#   P4  reopening Prepare mid-draft joins the running draft (RC-S12-052).
#   P5  a letter, essay or résumé rewrite asked by a form is handed back as
#       its own kind (S14X-090).
#   P6  the prep-guide export holds no English label of its own (RC-S12-114,
#       S14X-167).
#   P7  the co-pilot says which cover letters are still owed (S14X-267).
#   P8  the co-pilot reads code ai_unavailable as the AI service being down
#       (S14X-109).
#   P9  the Interview Coach words a refusal with the writing tools' shared
#       sentences (S14X-058).
#   P10 the Interview Coach takes a saved copy (RC-S12-042).
#   P11 the tailored résumé says when the posting was cut (S14X-270).
#   O1  NB-10, owner-gated: once the owner answers retire,
#       generate-product-preview answers 410 retired.
#
# NOT PROVABLE FROM OUTSIDE without a POST or a model call, so proved in the
# suite: the fact check and the keyword rules (writing-a-tailored-resume-is-
# fact-checked-and-never-told-to-inject-missing-keywords), the whole posting
# and the reader's clip (writing-tailor-reads-the-whole-posting-and-the-url-
# reader-leaves-room-for-its-header), the gateway's 402 as a 503 (writing-a-
# gateway-out-of-credits-is-a-retryable-503-not-a-payment), the kit's plan read
# and its allowance sentence (writing-the-kit-refusal-names-pros-real-
# allowance-and-a-failed-plan-read-is-503), the kit's chain and cap (writing-
# the-apply-kit-asks-the-next-model-for-an-unusable-reply-under-a-cap), its
# counted log line (writing-a-rejected-kit-logs-counts-not-the-resume), the
# free account's flash score (writing-scoring-a-free-accounts-answer-runs-on-
# flash), the answers' letter rule, clip and cap (writing-the-answers-mode-
# drafts-no-letter-and-caps-each-answer), the retryable chunk (writing-a-
# failed-answers-chunk-is-retryable-not-left-for-you) and the board pass the
# answers drafter counts (writing-a-site-wide-answers-ceiling-is-not-your-own-
# limit).
#
# READ-ONLY. OPTIONS preflights of the ten functions; GETs of the homepage and
# the chunks it reaches; one GET of generate-product-preview, only once the
# owner has answered retire. Nothing is posted.
echo "== 99zzzzzzz-bugs-writing-tools. bug round, writing-tools lane: fact-checked tailoring, a whole posting, an outage that is not a payment, answers that are answers =="

rm -rf /tmp/vd_bwt_chunks /tmp/vd_bwt_home.html /tmp/vd_bwt_want.txt /tmp/vd_bwt_preview.json /tmp/vd_bwt_preview.code
mkdir -p /tmp/vd_bwt_chunks
VDWT_LEDGER="${VDWT_LEDGER:-docs/deploy-ledger.json}"

# The owner's answer for a key, from the ledger the integrator writes: the
# answer's text, or empty when the key is not named.
vdwt_owner() { # $1 key
  VDWT_K="$1" node -e 'const fs=require("fs");let d=null;try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{}const o=d&&d.reservations&&d.reservations["bug-round"]&&d.reservations["bug-round"].ownerDecided;if(o&&typeof o==="object"&&Object.prototype.hasOwnProperty.call(o,process.env.VDWT_K)){const v=o[process.env.VDWT_K];console.log(typeof v==="string"&&v?v:JSON.stringify(v)||"decided")}' "$VDWT_LEDGER"
}
# A preflight's headers, lower-cased names, one per line.
vdwt_preflight() { # $1 function
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "apikey: $K" | tr -d '\r' | awk -F': *' 'NF>1{print tolower($1)": "$2}'
}

# F1-F10: the builds. The stage is set by any of them.
VDWT_FNS="generate-apply-package generate-tailored-resume generate-interview-coach generate-application-answers fetch-job-posting generate-career-path generate-career-snapshot generate-graduate-gameplan generate-keyword-fix generate-product-preview"
VDWT_STAGE=pending
VDWT_N=0
VDWT_ROWS=""
for VDWT_F in $VDWT_FNS; do
  VDWT_N=$((VDWT_N + 1))
  VDWT_H=$(vdwt_preflight "$VDWT_F")
  VDWT_BUILD=$(printf '%s\n' "$VDWT_H" | grep '^x-fn-build: ' | head -1 | sed 's/^x-fn-build: //')
  if [ -n "$VDWT_BUILD" ] && build_ge "$VDWT_F" "$VDWT_BUILD" 2026-11-12 1; then VDWT_STAGE=live; VDWT_NEW=yes; else VDWT_NEW=no; fi
  VDWT_ROWS="$VDWT_ROWS$VDWT_N|$VDWT_F|$VDWT_NEW|$VDWT_BUILD"$'\n'
  if [ "$VDWT_F" = generate-apply-package ]; then VDWT_KIT_EXPOSE=$(printf '%s\n' "$VDWT_H" | grep '^access-control-expose-headers: ' | head -1 | sed 's/^access-control-expose-headers: //' | tr 'A-Z' 'a-z'); VDWT_KIT_NEW=$VDWT_NEW; fi
done
printf '%s' "$VDWT_ROWS" | while IFS='|' read -r VDWT_I VDWT_F VDWT_NEW VDWT_BUILD; do
  [ -n "$VDWT_F" ] || continue
  if [ "$VDWT_NEW" = yes ]; then echo "PASS  F$VDWT_I $VDWT_F x-fn-build = $VDWT_BUILD (2026-11-12.1 or later)"
  elif [ -z "$VDWT_BUILD" ]; then echo "FAIL  F$VDWT_I $VDWT_F preflight carries no x-fn-build (want $VDWT_F.2026-11-12.1 or later)"
  elif [ "$VDWT_STAGE" = live ]; then echo "FAIL  F$VDWT_I $VDWT_F x-fn-build = $VDWT_BUILD, older than 2026-11-12.1, though this round's paste is live on another function: the paste left it behind"
  else echo "INFO  F$VDWT_I $VDWT_F x-fn-build = $VDWT_BUILD: not deployed yet (the round's paste with 2026-11-12.1 has not landed; section 49 lists the gap)"; fi
done

# S1 (RC-S12-051).
if printf '%s' "${VDWT_KIT_EXPOSE:-}" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -qx 'retry-after'; then
  echo "PASS  S1 generate-apply-package's preflight exposes retry-after ($VDWT_KIT_EXPOSE): the co-pilot can say when the kit writer's limit ends (RC-S12-051)"
elif [ "${VDWT_KIT_NEW:-no}" = yes ]; then
  echo "FAIL  S1 generate-apply-package serves this round's build but its preflight exposes '${VDWT_KIT_EXPOSE:-nothing}', not retry-after: the co-pilot reads every kit limit as 'try tomorrow'"
else
  echo "INFO  S1 generate-apply-package's preflight exposes '${VDWT_KIT_EXPOSE:-nothing}': the round's build has not landed"
fi

# P1-P11: the published app. Every chunk the entry reaches, two hops deep.
curl -s -m 30 -o /tmp/vd_bwt_home.html "$SITE/"
VDWT_MAIN=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /tmp/vd_bwt_home.html 2>/dev/null | head -1)
if [ -n "$VDWT_MAIN" ]; then
  curl -s -m 60 -o "/tmp/vd_bwt_chunks/${VDWT_MAIN#assets/}" "$SITE/$VDWT_MAIN"
  # Eight at a time; a chunk already read is not read again.
  for VDWT_ROUND in 1 2; do
    { grep -oh 'assets/[A-Za-z0-9_.-]*\.js' /tmp/vd_bwt_chunks/*.js; grep -oh '"\./[A-Za-z0-9_.-]*\.js"' /tmp/vd_bwt_chunks/*.js | tr -d '"' | sed 's#^\./#assets/#'; } 2>/dev/null \
      | sort -u | head -600 | while read -r VDWT_C; do [ -f "/tmp/vd_bwt_chunks/${VDWT_C#assets/}" ] || echo "$VDWT_C"; done > /tmp/vd_bwt_want.txt
    VDWT_SITE="$SITE" xargs -P 8 -n 1 sh -c 'curl -s -m 30 -o "/tmp/vd_bwt_chunks/${1#assets/}" "$VDWT_SITE/$1"' _ < /tmp/vd_bwt_want.txt
  done
fi
VDWT_MAIN="$VDWT_MAIN" node -e '
const fs=require("fs"),path=require("path");const dir=process.argv[1];
const main=process.env.VDWT_MAIN||"";
let names=[];try{names=fs.readdirSync(dir).filter((n)=>n.endsWith(".js"))}catch{}
const src=new Map(names.map((n)=>[n,fs.readFileSync(path.join(dir,n),"utf8")]));
if(!main||!src.get(path.basename(main))){console.log("FAIL  P0 the homepage names no /assets/index-*.js entry that could be read: the published app cannot be judged");process.exit(0)}
const holding=(s)=>[...src].filter(([,t])=>t.includes(s)).map(([n])=>n);
const one=(s)=>holding(s)[0]||null;
const importsOf=(t)=>[...t.matchAll(/["(]\.\/([A-Za-z0-9_.-]+\.js)"/g)].map((m)=>m[1]);
const closure=(start)=>{const seen=new Set();const stack=[start];while(stack.length){const n=stack.pop();if(seen.has(n)||!src.has(n))continue;seen.add(n);stack.push(...importsOf(src.get(n)))}return seen};
// The page markers: any one present means the merge published.
const MARKERS=["writingTools.tailorBusyTitle","answers-retryable","answers-joined-draft","answers-writing","writingTools.lettersStillOwed","tailor-posting-truncated","writingTools.export.whyAsked"];
const live=MARKERS.some((m)=>holding(m).length>0);
const say=(ok,id,pass,fail)=>console.log(ok?"PASS  "+id+" "+pass:live?"FAIL  "+id+" "+fail+", though the page of this round is published":"INFO  "+id+" "+fail+": the merge carrying the round has not published");
if(!live)console.log("INFO  P0 none of the page markers of this round ("+MARKERS.join(", ")+") is in the "+src.size+" chunks read: the merge has not published, so the page lines below are INFO");
// P1 (S14X-265): the toast helper is the chunk whose copy table pairs the
// tailor error copy with its limit copy (the board page names the error key
// on its own too, so the key alone finds the wrong chunk).
{const c=one("errorTitle:[\"jobsPage.tailorErrorTitle\"");const t=c?src.get(c):"";
 say(!!c&&t.includes("limitTitle:[\"writingTools.tailorBusyTitle\"")&&!t.includes("limitTitle:[\"jobsPage.tailorLimitTitle\""),"P1","the tailor toast ("+c+") words a busy model with writingTools.tailorBusy, never the hourly limit (S14X-265)","the tailor toast ("+(c||"not found")+") still words a busy model as jobsPage.tailorLimit");}
// P2 (S14X-205): between the panel sentence for a sign-in and its plain failure.
{const c=one("applyAnswers.signIn");const t=c?src.get(c):"";const a=t.indexOf("applyAnswers.signIn"),b=t.indexOf("applyAnswers.failed",a);const body=a>=0&&b>a?t.slice(a,b):"";
 say(body.includes("rate_limited_global")&&body.includes("rate_limited_network"),"P2","answersFailureMessage ("+c+") words rate_limited_global and rate_limited_network as not the reader own limit (S14X-205)","answersFailureMessage ("+(c||"not found")+") has no rate_limited_global and rate_limited_network branches");}
const has=(id,needle,pass,fail)=>{const c=holding(needle);say(c.length>0,id,pass+" ("+c[0]+")",fail)};
has("P3","answers-retryable","the answers panel shows a failed chunk questions to draft again (S14X-119)","no chunk renders answers-retryable");
has("P4","answers-joined-draft","the answers panel joins a draft already running for the job (RC-S12-052)","no chunk renders answers-joined-draft");
has("P5","answers-writing","the answers panel hands a letter, essay or rewrite back as its own kind (S14X-090)","no chunk renders answers-writing");
// P6 (RC-S12-114, S14X-167): the export module is the chunk naming the guide file.
{const c=one("interview_prep_guide.pdf");const t=c?src.get(c):"";const english=["Why they ask:","Questions to Ask Them","Skills to develop:","Do This Week"].filter((s)=>t.includes(s));
 if(!c)console.log((live?"FAIL":"INFO")+"  P6 no chunk names interview_prep_guide.pdf: the export module cannot be judged");
 else say(english.length===0,"P6","the export module ("+c+") holds no English label: the guide is drawn and printed with the reader labels (RC-S12-114, S14X-167)","the export module ("+c+") still draws "+JSON.stringify(english));}
has("P7","writingTools.lettersStillOwed","the co-pilot says which cover letters are still owed (S14X-267)","no chunk words writingTools.lettersStillOwed");
{const c=one("accountPage.acAiUnavailable");say(!!c&&src.get(c).includes("ai_unavailable"),"P8","the co-pilot ("+c+") reads code ai_unavailable as the AI service being down (S14X-109)","the co-pilot ("+(c||"not found")+") does not read code ai_unavailable");}
{const c=one("interviewCoach.evaluateFailed");const reach=c?[...closure(c)].some((n)=>src.get(n).includes("writingRefusal.dailyNoTime")):false;
 say(!!c&&src.get(c).includes("\"coach\",")&&reach,"P9","the Interview Coach ("+c+") words a refusal with the writing tools shared sentences (S14X-058)","the Interview Coach ("+(c||"not found")+") does not call the writing tools refusal copy");}
{const c=one("interviewCoach.evaluateFailed");say(!!c&&src.get(c).includes("savedCopy"),"P10","the Interview Coach ("+c+") takes a saved copy and shows it without a call (RC-S12-042)","the Interview Coach ("+(c||"not found")+") takes no savedCopy");}
has("P11","tailor-posting-truncated","the tailored resume says when the posting was cut (S14X-270)","no chunk renders tailor-posting-truncated");
' /tmp/vd_bwt_chunks

# O1 (NB-10, owner-gated).
VDWT_NB10=$(vdwt_owner NB-10)
if [ -z "$VDWT_NB10" ]; then
  echo "INFO  O1 owner pending: reservations['bug-round'].ownerDecided does not name NB-10 (retire generate-product-preview, or keep previews signed-in only)"
elif ! printf '%s' "$VDWT_NB10" | grep -qi 'retire'; then
  echo "INFO  O1 the owner answered NB-10 '$VDWT_NB10', not retire: the previews stay, and the lane's retire commit is not in this deploy"
else
  VDWT_PB=$(printf '%s\n' "$VDWT_ROWS" | awk -F'|' '$2=="generate-product-preview"{print $3"|"$4}')
  curl -s -m 30 -o /tmp/vd_bwt_preview.json -w '%{http_code}\n' "$B/functions/v1/generate-product-preview" -H "apikey: $K" > /tmp/vd_bwt_preview.code
  VDWT_PC=$(cat /tmp/vd_bwt_preview.code 2>/dev/null)
  if [ "$VDWT_PC" = 410 ] && grep -q '"retired"' /tmp/vd_bwt_preview.json; then
    echo "PASS  O1 generate-product-preview answers 410 retired: no preview is written for anyone (NB-10, owner: retire)"
  elif [ "${VDWT_PB%%|*}" = yes ]; then
    echo "FAIL  O1 the owner answered retire and generate-product-preview serves this round's build (${VDWT_PB#*|}), but a GET answered $VDWT_PC, not 410 retired: the retire commit did not ride the paste"
  else
    echo "INFO  O1 the owner answered retire; generate-product-preview is on ${VDWT_PB#*|} and answered $VDWT_PC: the round's paste has not landed"
  fi
fi
