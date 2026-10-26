# shellcheck shell=bash
# ── 92. WAVE 4, THE SECOND RECHECK OF THE DESCOPE (2026-10-25): the builds
# that carry its fixes serve, and what wave 4 makes false is gone from what
# crawlers and AI hosts read (docs/wave4/README.md, "The second recheck of
# the descope").
#
# THE CLAIMS, one line each below:
#   - agent-mcp and public-api serve 2026-10-11.36 or later (a remote the
#     person excluded is never a remote filter, a cover-letter text box is
#     the person's, the job card's salary wording); create-agent-checkout and
#     create-pass-checkout 2026-10-11.17 or later, create-product-checkout
#     2026-10-11.26 or later (the refusal line says what ChatGPT reads). No
#     read-only route runs readQuery or whoAnswers on input of our choosing
#     without spending the keyless allowance, so their behaviour is proved by
#     the tests (the-first-search-answers-the-question-as-asked,
#     a-status-inside-a-work-question-or-a-hint-is-the-persons), not here;
#   - the crawler's /freelance-boost (Googlebot) is noindex and says
#     Freelance Boost is no longer sold, with none of the old sales page;
#   - sitemap.xml names no /freelance-boost;
#   - llms.txt sells no cut product (no Freelance Boost at $29, no one-time
#     tools) and says that inside ChatGPT the form is read only for
#     Greenhouse or Recruitee.
#
# READ-ONLY. Five OPTIONS preflights and three GETs of the site.
echo "== 92. w4b the second recheck of the descope: builds, the /freelance-boost bake, the sitemap and llms.txt =="

for VD92Z_PAIR in agent-mcp:36 public-api:36 create-agent-checkout:17 create-pass-checkout:17 create-product-checkout:26; do
  VD92Z_FN=${VD92Z_PAIR%%:*}; VD92Z_N=${VD92Z_PAIR##*:}
  VD92Z_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD92Z_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD92Z_H" ]; then echo "FAIL  $VD92Z_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$VD92Z_FN" "$VD92Z_H" "2026-10-11" "$VD92Z_N"; then echo "PASS  $VD92Z_FN x-fn-build = $VD92Z_H ($VD92Z_FN.2026-10-11.$VD92Z_N or later: the second recheck's fixes)"
  else echo "FAIL  $VD92Z_FN x-fn-build = $VD92Z_H (want $VD92Z_FN.2026-10-11.$VD92Z_N or later: the second recheck's fixes are not serving)"; fi
done

rm -f /tmp/vd_92z_fb.html /tmp/vd_92z_sitemap.xml /tmp/vd_92z_llms.txt
curl -s -m 30 -A "$UA" "$SITE/freelance-boost" > /tmp/vd_92z_fb.html
curl -s -m 30 -A "$UA" "$SITE/sitemap.xml" > /tmp/vd_92z_sitemap.xml
curl -s -m 30 -A "$UA" "$SITE/llms.txt" > /tmp/vd_92z_llms.txt
node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const line=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const fb=rd("/tmp/vd_92z_fb.html"), sm=rd("/tmp/vd_92z_sitemap.xml"), ll=rd("/tmp/vd_92z_llms.txt");
const noindex=/<meta name="robots" content="noindex/.test(fb), says=/no longer sold/i.test(fb), sells=/in about 15 seconds|Turn Projects Into Resume Experience|What it produces/.test(fb);
line(fb.length>500&&noindex&&says&&!sells, "the crawler copy of /freelance-boost is noindex and says Freelance Boost is no longer sold ("+(fb.length>500?"noindex="+noindex+" no-longer-sold="+says+" old sales page="+sells:"no page read")+")");
line(sm.includes("<urlset")&&!/\/freelance-boost</.test(sm), "sitemap.xml names no /freelance-boost"+(sm.includes("<urlset")?"":" (no sitemap read)"));
line(ll.length>1000&&!/\$29 one-time|Paid tools are one-time purchases|One-time tools and the all-access plan/.test(ll), "llms.txt sells no cut product: no Freelance Boost at $29, no one-time tools"+(ll.length>1000?"":" (no llms.txt read)"));
line(/Inside ChatGPT, your AI reads the application form only when the employer uses Greenhouse or Recruitee\./.test(ll), "llms.txt says that inside ChatGPT the form is read only for Greenhouse or Recruitee");
'
