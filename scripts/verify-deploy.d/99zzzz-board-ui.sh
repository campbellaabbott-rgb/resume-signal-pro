# shellcheck shell=bash
# ── 99zzzz. BOARD UI ROUND (branch fix/bs-ui, the bug audit's "ui" group of
# 2026-10-31): a FRONTEND publish plus send-search-digest 2026-11-02.1. No
# job-board change and no migration.
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh in byte order ("-"
# sorts before "z") and under a collating locale that ignores the dash
# ("99zzztrust..." before "99zzzzboard...").
#
# THE CLAIMS, one line each, read from the code the served /jobs loads (its
# Jobs chunk and its English jobsPage strings, fetched as Googlebot). Each
# line names the constructs it found missing, so before the publish every U
# line FAILs by design:
#   U1a S12-012 the board's own pick of the top posting opens in a mode that
#       writes no address, and the address is written only for a push or a
#       replace the reader caused;
#   U1b S12-012 going back from a panel the reader opened trims ?job= from the
#       entry it lands on instead of leaving the panel's address there;
#   U2a S12-033 a posting the board opened by itself is not marked viewed and
#       is not added to Jump back in;
#   U2b S12-033 Enter opens the apply page only for a posting the reader chose;
#   U3  S10-008 Load more weaves each page on its own and appends it, so no
#       card already drawn moves;
#   U4  S12-048 a folded card counts the postings it stands for (not the 50 it
#       lists) and its toggle says aria-expanded and names its list;
#   U5  S12-034 relatedUnavailable is read: the list is not called complete,
#       the count is named as title matches and the gap is said, in English
#       in the jobsPage strings;
#   U6  S13-119 the company page's filter row carries the order control at
#       every width;
#   U7  S12-021 an employer page lists and counts every board the bake pools
#       for it, says how many, and saves its watch over all of them;
#   U8  S13-117 a board name two hiring systems share is watched and toasted
#       as "boards named ...", in the code and in English;
#   U9  S12-016 the hiring badges are asked for a screen at a time, and the
#       board's route wrapper keeps the answers across the board pages it
#       remounts for;
#   D1  send-search-digest 2026-11-02.1 or later: a saved watch's list of
#       boards is what the digest asks for and links.
#
# READ-ONLY: GETs of /jobs, the scripts it names (and its entry, when the page
# names no Jobs chunk), as Googlebot, and one OPTIONS preflight. Nothing is
# written.
echo "== 99zzzz. Board UI round: the board's own pick, history, folded cards, Load more, pooled employer pages, badges =="

VDZ4_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/send-search-digest" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VDZ4_H" ]; then echo "FAIL  D1 send-search-digest preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge send-search-digest "$VDZ4_H" "2026-11-02" "1"; then echo "PASS  D1 send-search-digest x-fn-build = $VDZ4_H (2026-11-02.1 or later: a saved watch's boards are what the digest asks for and links)"
else echo "FAIL  D1 send-search-digest x-fn-build = $VDZ4_H (want send-search-digest.2026-11-02.1 or later: the digest still asks for the watch's one board)"; fi

rm -f /tmp/vd_99zzzz_jobs.html /tmp/vd_99zzzz_entry.js /tmp/vd_99zzzz_jobs.js /tmp/vd_99zzzz_ns.js
curl -s -m 30 -A "$UA" -o /tmp/vd_99zzzz_jobs.html "$SITE/jobs"
VDZ4_JOBS=$(grep -oE '/assets/Jobs-[A-Za-z0-9_-]+\.js' /tmp/vd_99zzzz_jobs.html 2>/dev/null | head -1)
VDZ4_NS=$(grep -oE '/assets/rb-en_ns_jobsPage-[A-Za-z0-9_-]+\.js' /tmp/vd_99zzzz_jobs.html 2>/dev/null | head -1)
if [ -z "$VDZ4_JOBS" ]; then
  VDZ4_ENTRY=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_99zzzz_jobs.html 2>/dev/null | head -1)
  if [ -n "$VDZ4_ENTRY" ]; then
    curl -s -m 60 -A "$UA" -o /tmp/vd_99zzzz_entry.js "$SITE$VDZ4_ENTRY"
    VDZ4_J=$(grep -oE 'Jobs-[A-Za-z0-9_-]+\.js' /tmp/vd_99zzzz_entry.js 2>/dev/null | head -1)
    [ -n "$VDZ4_J" ] && VDZ4_JOBS="/assets/$VDZ4_J"
    VDZ4_N=$(grep -oE 'rb-en_ns_jobsPage-[A-Za-z0-9_-]+\.js' /tmp/vd_99zzzz_entry.js 2>/dev/null | head -1)
    [ -z "$VDZ4_NS" ] && [ -n "$VDZ4_N" ] && VDZ4_NS="/assets/$VDZ4_N"
  fi
fi
[ -n "$VDZ4_JOBS" ] && curl -s -m 60 -A "$UA" -o /tmp/vd_99zzzz_jobs.js "$SITE$VDZ4_JOBS"
[ -n "$VDZ4_NS" ] && curl -s -m 60 -A "$UA" -o /tmp/vd_99zzzz_ns.js "$SITE$VDZ4_NS"

node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const [jf,nf,jn,nn]=process.argv.slice(1);
const J=rd(jf),N=rd(nf);
const line=(s,m)=>console.log(s.padEnd(5)+" "+m);
if(!jn){line("FAIL","U0 the served /jobs names no Jobs chunk, in the page or in its entry, so no U claim can be read");process.exit(0)}
if(J.length<20000||!/get_company_fill_curve/.test(J)){line("FAIL","U0 "+jn+" answered "+J.length+" bytes that are not the board page ("+JSON.stringify(J.slice(0,80))+"), so no U claim can be read");process.exit(0)}
line("INFO","U0 reading "+jn+" ("+J.length+" bytes) and "+(N.length?nn+" ("+N.length+" bytes)":"no English jobsPage strings (the page names none, so the string checks below fail)"));
const I="[\\w$]+";
const R=(s)=>new RegExp(s.replace(/@/g,I));
const check=(id,what,marks)=>{const miss=marks.filter(([,re,src])=>!re.test(src===undefined?J:src)).map(([n])=>n);line(miss.length?"FAIL":"PASS",id+" "+what+(miss.length?": missing "+miss.join("; "):""));};
check("U1a","S12-012 the board\x27s own pick writes no address",[
  ["the auto-pick opens the top posting in \"auto\" mode",/\.primary,"auto"\)/],
  ["the address is written only for push or replace",R("(@)===\"push\"\\|\\|\\1===\"replace\"\\)\\{const @=new URLSearchParams")]]);
check("U1b","S12-012 going back from a panel the reader opened trims ?job= from the entry it lands on",[
  ["the popped panel\x27s ?job= is deleted and the entry replaced",R("(@)&&(@)\\.has\\(\"job\"\\)\\)\\{\\2\\.delete\\(\"job\"\\);const @=\\2\\.toString\\(\\);@\\(\"replace\"")]]);
check("U2a","S12-033 a posting the board opened by itself is not marked viewed or added to Jump back in",[
  ["viewed and recent are written only for a posting the reader chose",R("(@)=@!==\"auto\";[\\s\\S]{0,300}?\\1&&@\\(@=>\\{if\\(@\\.has\\(@\\.id\\)\\)return @;[\\s\\S]{0,200}?\"rb_viewed_jobs\"[\\s\\S]{0,120}?\\),\\1\\)try\\{const @=JSON\\.parse\\(localStorage\\.getItem\\(\"rb_recent_jobs\"\\)")]]);
check("U2b","S12-033 Enter applies only to a posting the reader chose",[
  ["Enter skips the board\x27s own pick",R("key===\"Enter\"&&(@)&&@\\.current!==\\1\\.id&&window\\.matchMedia\\(\"\\(min-width: 1024px\\)\"\\)\\.matches")]]);
check("U3","S10-008 Load more weaves each page on its own",[
  ["each row carries the offset of the page it came on",R(",listOffset:@\\}")],
  ["the weave groups by that page",/\.primary\.listOffset\?\?0/]]);
check("U4","S12-048 a folded card counts what it stands for and says whether it is open",[
  ["the count is the postings, not the listed siblings",R("Math\\.max\\(@\\.length,@-1\\)")],
  ["the toggle says aria-expanded and names its list",R("\"aria-expanded\":@\\.has\\(@\\.id\\),\"aria-controls\":`fold-\\$\\{encodeURIComponent\\(@\\.id\\)\\}`")],
  ["the list carries that id",R("id:`fold-\\$\\{encodeURIComponent\\(@\\.id\\)\\}`")]]);
check("U5","S12-034 a search whose description tier was not read says so",[
  ["the list is not called complete",/\.relatedUnavailable\)!==!0/],
  ["the notice is rendered",/"data-related-unavailable":!0/],
  ["the count is named as title matches",/"jobsPage\.resultsSummaryTitleOnly"/],
  ["English: the title-match count",/openings with your search in the title/,N],
  ["English: the notice",/only in their description could not be searched just now/,N]]);
check("U6","S13-119 the company page\x27s filter row carries the order control at every width",[
  ["sort is passed with no width condition",R("token:@\\?\\?void 0\\}:void 0,sort:\\{value:")]]);
check("U7","S12-021 an employer page lists, counts and watches every board the bake pools",[
  ["the list reads the pooled boards when the page has them",R("companyTokens:@\\?\\?@")],
  ["the watch saves every pooled board beside the page\x27s own",R("\\{company:(@),companies:@\\}:\\{company:\\1\\}")],
  ["the page says how many boards it counts",/"data-company-pooled-boards":""/]]);
check("U8","S13-117 a shared board name is watched as boards named it",[
  ["the watch name",/"jobsPage\.watchNameBoards"/],
  ["the saved toast",/"jobsPage\.watchSavedBoards"/],
  ["the already-watching toast",/"jobsPage\.watchExistsBoards"/],
  ["English: the watch name",/"watchNameBoards":"New roles on boards named “\{\{token\}\}”"/,N],
  ["English: the saved toast",/"watchSavedBoards":"Watching boards named “\{\{token\}\}”"/,N]]);
check("U9","S12-016 the hiring badges are asked for a screen at a time and kept across the board pages it remounts for",[
  ["the curve is read one chunk at a time",R("for\\(const (@) of @\\(@\\)\\)\\{const\\{data:@,error:@\\}=await @\\.rpc\\(\"get_company_fill_curve\",\\{p_tokens:\\1\\}\\)")],
  ["the route wrapper hands each board instance its memo",R("\\{boardId:@\\.current\\.id,curveMemo:@\\.current\\}")]]);
' /tmp/vd_99zzzz_jobs.js /tmp/vd_99zzzz_ns.js "$VDZ4_JOBS" "$VDZ4_NS"
