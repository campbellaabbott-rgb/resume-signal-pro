# shellcheck shell=bash
# ── 92. WAVE 4, THE RECHECK OF THE MERGE OF MAIN 899be058 (2026-10-25): what
# the merged branch said that wave 4 had made false is gone from what crawlers
# and AI hosts read, a brand's name is not a staffing board's, and a required
# minimum survives a wish that names something else (docs/wave4/README.md,
# "The recheck of the merge").
#
# THE CLAIMS, one line each below:
#   - layoff-filings serves 2026-10-11.1 or later (its catalogue copy labels
#     the "Meta" SmartRecruiters board a staffing agency);
#   - the crawler's /pricing (Googlebot) names the one report and Pro: no
#     "One-Time Tools" title, no range whose two ends are one price, no bundle
#     discount, the "One paid report" heading;
#   - the crawler's /data-api and /agents, llms.txt and llms-full.txt never
#     pair fit scoring with "paid" without the free allowance, and each states
#     "scorings a day on a confirmed free key";
#   - job-board answers companies:["Meta"] with no rows and the Meta1 board
#     held as a handful of roles (recheck 3: held "few_open", never named in
#     unknownCompanies, since the board carries it);
#   - Tapestry's sales associate rows, whose postings say "Required
#     Qualifications 1+ years of sales experience (luxury retail preferred)",
#     still carry minYears 1, before the experience re-derive and after it (a
#     FAIL once fewer than a third of the first rows that carry a figure say 1).
# The Oracle lettered-requisition plan and the section 83 C7 changelog cut are
# proved by their tests: a fetch-job-posting call is metered, and C7 runs in
# section 83 itself.
#
# READ-ONLY. One OPTIONS preflight, four GETs of the site and two job-board
# list reads on the probe budget.
echo "== 92. w4b the merge recheck: layoff-filings, the /pricing bake, fit is free, a held name, a required minimum =="

VD92M_LF=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/layoff-filings" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD92M_LF" ]; then echo "FAIL  layoff-filings preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge layoff-filings "$VD92M_LF" "2026-10-11" "1"; then echo "PASS  layoff-filings x-fn-build = $VD92M_LF (layoff-filings.2026-10-11.1 or later: the catalogue copy labels Meta1 an agency)"
else echo "FAIL  layoff-filings x-fn-build = $VD92M_LF (want layoff-filings.2026-10-11.1 or later)"; fi

rm -f /tmp/vd_92m_pricing.html /tmp/vd_92m_dataapi.html /tmp/vd_92m_agents.html /tmp/vd_92m_llms.txt /tmp/vd_92m_llmsfull.txt /tmp/vd_92m_meta.json /tmp/vd_92m_tap.json
curl -s -m 30 -A "$UA" "$SITE/pricing" > /tmp/vd_92m_pricing.html
curl -s -m 30 -A "$UA" "$SITE/data-api" > /tmp/vd_92m_dataapi.html
curl -s -m 30 -A "$UA" "$SITE/agents" > /tmp/vd_92m_agents.html
curl -s -m 60 -A "$UA" "$SITE/llms.txt" > /tmp/vd_92m_llms.txt
curl -s -m 60 -A "$UA" "$SITE/llms-full.txt" > /tmp/vd_92m_llmsfull.txt
curl -s -m 60 -o /tmp/vd_92m_meta.json -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","companies":["Meta"],"limit":10}'
curl -s -m 60 -o /tmp/vd_92m_tap.json -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","q":"sales associate","companies":["tapestry~wd108~Tapestry_Careers"],"limit":50}'
node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const line=(s,m)=>console.log(s.padEnd(5)+" "+m);
const text=(h)=>h.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"\x27").replace(/&quot;/g,"\"").replace(/\s+/g," ");
const pr=rd("/tmp/vd_92m_pricing.html");
const title=(pr.match(/<title>([^<]*)<\/title>/)||[])[1]||"";
const ONE=/\$\s?(\d[\d,.]*)\s?[–—-]\s?\$\s?\1(?![\d,.]*\d)/;
if (pr.length<500) line("FAIL","the crawler /pricing answered no page ("+pr.length+" bytes)");
else {
  const t=text(pr);
  const bad=[/one-time tools/i.test(title)&&"a One-Time Tools title", ONE.test(pr)&&"a one-price range ("+(pr.match(ONE)||[""])[0]+")", /bundle discount/i.test(t)&&"a bundle discount", /Paid tools are one-time purchases/.test(t)&&"the list lead"].filter(Boolean);
  line(!bad.length&&/One paid report/.test(t)?"PASS":"FAIL", "the crawler /pricing names the one report and Pro (\""+title.slice(0,90)+"\")"+(bad.length?": still says "+bad.join(", "):/One paid report/.test(t)?"":": no One paid report heading"));
}
const FIT=/\/v1\/fit\b|\bfit_resume\b/;
const paired=(s)=>s.split(/(?<=[.!?])\s+|;|\n|<\/?(?:li|p|td|tr|div|h\d)\b[^>]*>|,\s+and\s+/).filter((c)=>FIT.test(c)&&/\bpaid\b/i.test(c)&&!/\bfree\b/i.test(c));
for (const [name,f] of [["/data-api","/tmp/vd_92m_dataapi.html"],["/agents","/tmp/vd_92m_agents.html"],["/llms.txt","/tmp/vd_92m_llms.txt"],["/llms-full.txt","/tmp/vd_92m_llmsfull.txt"]]) {
  const b=rd(f);
  if (b.length<1000) { line("FAIL",name+" answered no document ("+b.length+" bytes)"); continue; }
  const p=paired(b), states=/scorings a day on a confirmed free key/.test(f.endsWith(".html")?text(b):b);
  line(!p.length&&states?"PASS":"FAIL", name+(p.length?" still pairs fit scoring with paid: \""+p[0].replace(/<[^>]+>/g,"").trim().slice(0,110)+"\"":states?" says fit scoring is free on a confirmed key (scorings a day on a confirmed free key)":" never states the free fit allowance"));
}
let m=null;try{m=JSON.parse(rd("/tmp/vd_92m_meta.json"))}catch{}
const u=m&&Array.isArray(m.companiesUnresolved)?m.companiesUnresolved[0]:null;
if (!m) line("FAIL","job-board companies:[\"Meta\"] answered no JSON");
else { const unk=Array.isArray(m.unknownCompanies)&&m.unknownCompanies.includes("Meta"); line(u&&u.held==="few_open"&&!unk&&u.candidates&&u.candidates[0]&&u.candidates[0].token==="Meta1"&&Number(m.total)===0?"PASS":"FAIL","job-board companies:[\"Meta\"] serves "+(m.total??"?")+" rows and holds "+(u?JSON.stringify({held:u.held,candidate:u.candidates&&u.candidates[0]}).slice(0,160):"nothing")+(unk?", and names Meta in unknownCompanies":"")+" (want 0 rows, the Meta1 board held as a handful of roles, and Meta never named uncarried)"); }
let t=null;try{t=JSON.parse(rd("/tmp/vd_92m_tap.json"))}catch{}
const jobs=t&&Array.isArray(t.jobs)?t.jobs:[];
const withFig=jobs.filter((j)=>typeof j.minYears==="number"), ones=withFig.filter((j)=>j.minYears===1).length;
if (!jobs.length) line("INFO","Tapestry sales associate rows: none answered ("+(t?JSON.stringify(t).slice(0,100):"no JSON")+")");
else line(withFig.length&&ones*3>=withFig.length?"PASS":"FAIL","Tapestry sales associate rows: "+ones+" of the "+withFig.length+" that carry a figure say minYears 1, of "+jobs.length+" read (a required 1+ years beside \"(luxury retail preferred)\" is kept)");
'
