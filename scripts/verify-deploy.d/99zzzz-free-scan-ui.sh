# shellcheck shell=bash
# ── 99zzzz. THE FREE SCAN'S PAGE: the report mail's Full Analysis button, the
# report and builder strings, the feedback vote's answer (branch
# fix/free-scan-ui, send-scan-report 2026-11-01.1, migration 20261101150000,
# the frontend publish; registers S13-008/018/019/023/025/036/038/056/057/
# 094/099/122/126/127).
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh both in byte order
# ("-" sorts before "z") and under a collating locale that ignores the dash.
#
# THE CLAIMS, one line each:
#   FS1  send-scan-report answers build 2026-11-01.1 or later on its preflight
#        (the report mail's "Get the full analysis" goes to
#        /pricing#full-analysis, not /resume-checker#pricing, which has no
#        such element);
#   FS2  the button's destination is a Full Analysis offer: /pricing, as a
#        crawler reads it, carries the Full Analysis card (data-plan
#        "full-analysis") and its JSON-LD names /pricing#full-analysis as that
#        Offer's url (React's card owns the id; the baked card carries none on
#        purpose, see scripts/prerender-seo.mjs);
#   FS3  the published app carries this branch's English strings: the vendor
#        card's "layout not checked" line (S13-036), the truncated-résumé
#        banner (S13-008) and the builder's kept-draft toast (S13-126). The
#        strings are read where the browser gets them (rb-en_all since
#        SEO-040, found by scripts/verify-us-english.sh, never en-GB), from
#        the chunk that holds a key every published build since 2026-10 has
#        carried (resumeBuilder's replaceWithLatestScan): no chunk holding it
#        is a FAIL that says so, never a pass over nothing;
#   FS4  INFO: record_scan_feedback's true/false answer (20261101150000)
#        cannot be read from outside without calling a writer; the migration
#        refuses its own transaction unless the one definition returns
#        boolean, keeps its grants and gives PUBLIC none.
#
# Every probe is a GET or an OPTIONS.

rm -f /tmp/vd_fs_pricing.html /tmp/vd_fs_home.html /tmp/vd_fs_en.js

# ---- FS1: the build ----
VDFS_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/send-scan-report" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VDFS_H" ]; then echo "FAIL  FS1 send-scan-report preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge send-scan-report "$VDFS_H" 2026-11-01 1; then echo "PASS  FS1 send-scan-report x-fn-build = $VDFS_H (send-scan-report.2026-11-01.1 or later: the mail's Full Analysis button goes to /pricing#full-analysis)"
else echo "FAIL  FS1 send-scan-report x-fn-build = $VDFS_H (want send-scan-report.2026-11-01.1 or later: the mail still sends readers to /resume-checker#pricing)"; fi

# ---- FS2: the button's destination ----
curl -s -m 30 -A "$UA" "$SITE/pricing" > /tmp/vd_fs_pricing.html
node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const line=(s,m)=>console.log(s.padEnd(5)+" "+m);
const pricing=rd("/tmp/vd_fs_pricing.html");
if (pricing.length<500) { line("FAIL","FS2 the crawler /pricing answered no page ("+pricing.length+" bytes): the mail button lands nowhere this section can see"); process.exit(0); }
const card=/<section\b[^>]*data-plan="full-analysis"/.test(pricing);
const urls=[];
for (const m of pricing.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
  let j=null;try{j=JSON.parse(m[1])}catch{continue}
  const walk=(v)=>{if(!v||typeof v!=="object")return;if(Array.isArray(v)){v.forEach(walk);return}if(/Offer$/.test(String(v["@type"]||""))&&typeof v.url==="string")urls.push(v.url);Object.values(v).forEach(walk)};
  walk(j);
}
const named=urls.some((u)=>/\/pricing#full-analysis$/.test(u));
line(card&&named?"PASS":"FAIL","FS2 /pricing "+(card?"carries the Full Analysis card":"carries NO Full Analysis card (data-plan=\"full-analysis\")")+" and its JSON-LD "+(named?"names /pricing#full-analysis as an Offer url":"names no Offer url /pricing#full-analysis (offer urls: "+(urls.join(", ")||"none")+")"));
'

# ---- FS3: the English strings the browser loads ----
VDFS_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDFS_FOUND=""
if [ -n "$VDFS_MAIN" ]; then
  for VDFS_CAND in $(bash scripts/verify-us-english.sh "$SITE$VDFS_MAIN"); do
    curl -s -m 60 "$SITE/assets/$VDFS_CAND" > /tmp/vd_fs_en.js
    if grep -qF "replaceWithLatestScan" /tmp/vd_fs_en.js; then VDFS_FOUND=$VDFS_CAND; break; fi
  done
fi
if [ -z "$VDFS_MAIN" ]; then echo "FAIL  FS3 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDFS_FOUND" ]; then echo "FAIL  FS3 no English chunk the entry $VDFS_MAIN names holds resumeBuilder's strings: the bundle layout moved, so this branch's strings cannot be judged"
else
  VDFS_MISSING=""
  for VDFS_PAIR in "parsing: layout not checked|S13-036 vendor card" "This scan did not read your whole r|S13-008 truncation banner" "Only bullets already in your draft were changed|S13-126 kept-draft toast"; do
    grep -qF "${VDFS_PAIR%%|*}" /tmp/vd_fs_en.js || VDFS_MISSING="$VDFS_MISSING, ${VDFS_PAIR#*|}"
  done
  if [ -n "$VDFS_MISSING" ]; then echo "FAIL  FS3 the English strings ($VDFS_FOUND) lack this branch's${VDFS_MISSING#,} (the frontend publish has not happened, or an older one is serving)"
  else echo "PASS  FS3 the English strings ($VDFS_FOUND) carry this branch's vendor card, truncation banner and kept-draft toast"; fi
fi

echo "INFO  FS4 record_scan_feedback answers true/false from 20261101150000; a GET cannot reach past its budget write, so this is not probed: the migration's self-check refuses its own transaction unless the one definition returns boolean, is SECURITY DEFINER with search_path public, keeps EXECUTE for anon, authenticated and service_role, and gives PUBLIC none"
