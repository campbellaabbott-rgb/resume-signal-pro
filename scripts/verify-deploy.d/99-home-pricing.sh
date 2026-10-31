# shellcheck shell=bash
# ── 99. HOME-PRICING, THE SWITCH-OVER: "/" is the board-first homepage and
# /pricing the new pricing page (docs/homepage-pricing/README.md, step 14;
# reservation home-pricing, deployOrder 5). A FRONTEND + PRERENDER deploy,
# plus the builds the reservation names, so the crawler claims are judged on
# the served documents with the Googlebot UA and the rendered claims in one
# headless browser whose writes are answered inside it.
# Sourced by scripts/verify-deploy.sh; $SITE, $UA, $B, $K and build_ge are in
# scope.
#
# THE CLAIMS:
#   C1  "/" serves the owner's H1, a <form action="/jobs" method="get"> with
#       q and location, and a count line whose figure and stamp are
#       get_board_vendor_counts' openTotal and as_of ("N open postings ·
#       counted D, T UTC"), read by this section; equal when the row has not
#       refreshed since the publish, within a tenth of it and older when it
#       has. No floored "950,000+" figure.
#   C2  "/" carries no "new · " flow pairing and no word "verified".
#   C3  Every /jobs/field/ link on "/" is one of the category list's slugs
#       (src/lib/job-board-categories.ts), never retail or hospitality.
#   C4  "/pricing" and "/" say all sales are final, and name no place as
#       unsold: no line says the EU, the EEA, the UK or India is not sold to or
#       waits for a tax registration (the owner, 2026-10-27: "Keep selling as
#       today"), and none names a billing address, an IP address or a lookup
#       (W5).
#   C5  Sales stay on with no seller named (the owner, 2026-10-27), whatever
#       src/config/seller.ts holds: the JSON-LD of "/" and "/pricing" offers
#       the Full Analysis and Pro at their prices, the /pricing description
#       names both prices, no card prints a gate note, and neither page says
#       purchases open soon.
#   C6  The builds home-pricing carries, on land/all: free-keyword-scan
#       2026-10-31.1 (H0, the report sweep's photo notes, then its review's
#       whole-word lists and prompt) and free-keyword-scan-stream 2026-10-31.1
#       (the same market and country modules), send-search-digest 2026-10-25.1,
#       send-scan-report and send-market-pulse 2026-10-31.1 (the scanner's own
#       address in their links, on land/all's sending with no pause),
#       create-subscription-checkout 2026-10-31.2 (Pro's list says packages,
#       on land/all's checkout that refuses nobody for where they are),
#       create-product-checkout 2026-10-31.2 (it bundles that list), and
#       send-product-email 2026-10-31.1 (a failed Full Analysis payment's
#       button opens /resume-checker), each that build or a later one. Each
#       2026-10-31 build names the merge: the branches' own earlier builds of
#       these five carry one side's change and not the other's.
#   C7  The page React renders: the homepage's own chunk (named in the served
#       "/") carries its sentences and none of the retired homepage hero's
#       strings, and the entry every page loads does not carry them (they ride
#       with the page since the review round of 2026-10-26).
#   C8  (headless) "/#upload" lands on /resume-checker at its uploader (the
#       scanner scrolls to #upload and then clears the hash, as it always has),
#       and /resume-checker still renders the scanner's uploader.
#   C9  (headless, the rendered "/" and "/pricing", header and footer
#       included) no Freelance Boost, Transition Pro, Premium, Scan Pack or
#       "unlimited" anywhere, and exactly one filled button across header
#       and main.
#   C8  also: the scan report's rescan link and "/?ref=<a 12-hex code>" land
#       on /resume-checker with their query, and a directory's "/?ref=" tag
#       stays on "/".
#   C10 The apply agent is retired (agent_sender_public_status false, or
#       /trust says it is switched off); while neither holds, no surface that
#       makes the promise says "never submit": "/", "/pricing", the baked
#       "/resume-checker", /llms.txt and the FAQ /resume-checker renders (this
#       checkout's faq.questions.bringYourAgent).
#   C12 (headless) a fresh "/pricing#pro" lands with the Pro card's top inside
#       the first screen, below the header.
#   C11 (owner decision 2026-10-25) "/pricing" says Pro is billed in US
#       dollars and how the Full Analysis is charged, "/" its strip's
#       currency line for the rows it shows; neither page puts both products
#       in one currency or promises "your local currency"; a Full Analysis
#       Offer anywhere carries pricingPlans.fa.currency as its description.
#   G4  (W6, a ledger precondition) is printed as a note.
#   SPEED (owner decision 2026-10-27) is not judged here, and is printed as a
#       note: the new "/" is never slower than the old one, on the Lighthouse
#       mobile profile and on the unthrottled 4x-CPU profile. It is a lab
#       comparison of two builds on one machine, so a curl of production cannot
#       judge it: the old build's measurement, the baseline, is
#       docs/homepage-pricing/speed-baseline.json, and
#       scripts/home-speed-gate.mjs judges it and any re-measure (README step
#       15). The first-load JavaScript ships as measured (349,482 B gzip once
#       the cards render), by the same decision. Real visitors' Core Web Vitals
#       are the owner's read in Search Console, before the publish and about 28
#       days after it.
#
# READ-ONLY: GETs of the site and of two anon RPCs (PostgREST runs a GET in a
# read-only transaction), OPTIONS preflights, and one headless browser whose
# every non-GET request is answered inside it (an RPC is re-sent as a GET, a
# job-board list read carries x-rb-budget: probe). Before the deploy C1-C9
# and C11 FAIL by design. VD99_RENDER=0 skips the browser (INFO).
echo "== 99. home-pricing: the board-first homepage and the new pricing page =="

REPO_ROOT99="${VD99_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
rm -f /tmp/vd_99_home.html /tmp/vd_99_pricing.html /tmp/vd_99_trust.html /tmp/vd_99_vc.json /tmp/vd_99_agent.json /tmp/vd_99_entry.js /tmp/vd_99_homechunk.js /tmp/vd_99_checker.html /tmp/vd_99_llms.txt
curl -s -m 30 -A "$UA" "$SITE/" > /tmp/vd_99_home.html
curl -s -m 30 -A "$UA" "$SITE/pricing" > /tmp/vd_99_pricing.html
curl -s -m 30 -A "$UA" "$SITE/trust" > /tmp/vd_99_trust.html
curl -s -m 30 -A "$UA" "$SITE/resume-checker" > /tmp/vd_99_checker.html
curl -s -m 30 -A "$UA" "$SITE/llms.txt" > /tmp/vd_99_llms.txt
curl -s -m 30 -o /tmp/vd_99_vc.json "$B/rest/v1/rpc/get_board_vendor_counts" -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s -m 30 -o /tmp/vd_99_agent.json "$B/rest/v1/rpc/agent_sender_public_status" -H "apikey: $K" -H "Authorization: Bearer $K"
VD99_ENTRY=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_99_home.html | head -1)
if [ -n "$VD99_ENTRY" ]; then curl -s -m 60 "$SITE$VD99_ENTRY" > /tmp/vd_99_entry.js; fi
VD99_HOMECHUNK=$(grep -oE 'HomePage-[A-Za-z0-9_-]+\.js' /tmp/vd_99_home.html | head -1)
if [ -n "$VD99_HOMECHUNK" ]; then curl -s -m 60 "$SITE/assets/$VD99_HOMECHUNK" > /tmp/vd_99_homechunk.js; fi

# ---- C6: the builds the reservation carries ----
for VD99_PAIR in "free-keyword-scan|2026-10-31|1" "free-keyword-scan-stream|2026-10-31|1" "send-scan-report|2026-10-31|1" "send-search-digest|2026-10-25|1" "send-market-pulse|2026-10-31|1" "create-subscription-checkout|2026-10-31|2" "create-product-checkout|2026-10-31|2" "send-product-email|2026-10-31|1"; do
  VD99_FN="${VD99_PAIR%%|*}"; VD99_REST="${VD99_PAIR#*|}"; VD99_DAY="${VD99_REST%%|*}"; VD99_N="${VD99_REST#*|}"
  VD99_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD99_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD99_H" ]; then echo "FAIL  C6 $VD99_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$VD99_FN" "$VD99_H" "$VD99_DAY" "$VD99_N"; then echo "PASS  C6 $VD99_FN x-fn-build = $VD99_H ($VD99_FN.$VD99_DAY.$VD99_N or later)"
  else echo "FAIL  C6 $VD99_FN x-fn-build = $VD99_H (want $VD99_FN.$VD99_DAY.$VD99_N or later)"; fi
done

REPO_ROOT="$REPO_ROOT99" node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const line=(s,m)=>console.log(s.padEnd(5)+" "+m);
const R=process.env.REPO_ROOT;
const text=(h)=>h.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"\x27").replace(/&quot;/g,"\"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
const lds=(h)=>[...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m)=>{try{return JSON.parse(m[1])}catch{return null}}).filter(Boolean);
const offers=(v,out=[],seen=new Set())=>{if(!v||typeof v!=="object"||seen.has(v))return out;seen.add(v);if(Array.isArray(v)){v.forEach((x)=>offers(x,out,seen));return out}if(/Offer$/.test(String(v["@type"]||"")))out.push(v);Object.values(v).forEach((x)=>offers(x,out,seen));return out};
const priced=(o)=>[o.price,o.highPrice,o.lowPrice].map(Number).some((n)=>Number.isFinite(n)&&n>0);
let H={},P={};try{H=JSON.parse(rd(R+"/src/i18n/shards/home/en.json")).home||{}}catch{}try{P=JSON.parse(rd(R+"/src/i18n/shards/pricing/en.json")).pricingPlans||{}}catch{}
const home=rd("/tmp/vd_99_home.html"), pricing=rd("/tmp/vd_99_pricing.html"), trust=rd("/tmp/vd_99_trust.html");
const ht=text(home), pt=text(pricing);
if (home.length<500) line("FAIL","the crawler / answered no page ("+home.length+" bytes): nothing on it can be judged");
if (pricing.length<500) line("FAIL","the crawler /pricing answered no page ("+pricing.length+" bytes)");
if (!H.hero||!P.meta) line("FAIL","this checkout has no homepage or pricing strings (src/i18n/shards/home|pricing/en.json): the sentences below cannot be judged");

// ---- C1: the headline, the form, the one figure ----
if (home.length>=500) {
  const h1=((home.match(/<h1\b[^>]*>([^<]*)<\/h1>/)||[])[1]||"").replace(/&#39;/g,"\x27").trim();
  const want="Live jobs, straight from employers\x27 own hiring systems.";
  const form=(home.match(/<form\b[^>]*action="\/jobs"[^>]*method="get"[\s\S]*?<\/form>/i)||[""])[0];
  const formOk=/name="q"/.test(form)&&/name="location"/.test(form);
  line(h1===want&&formOk?"PASS":"FAIL","C1 / serves the H1 \""+h1.slice(0,70)+"\""+(h1===want?"":" (want \""+want+"\")")+(formOk?" and a GET /jobs form with q and location":", and no GET /jobs form with q and location"));
  const floor=ht.match(/\b\d{1,3}(?:,\d{3})*,000\+/);
  if (floor) line("FAIL","C1 / prints a floored figure \""+floor[0]+"\": the count must be the exact openTotal with its moment");
  const cl=(home.match(/data-home-count="">([\s\S]*?)<\/p>/)||[])[1];
  let vc=null;try{vc=JSON.parse(rd("/tmp/vd_99_vc.json"))}catch{}
  const live=vc&&typeof vc==="object"&&!Array.isArray(vc)?{total:Number(vc.openTotal),at:Date.parse(String(vc.as_of||""))}:null;
  if (cl===undefined) line("FAIL","C1 / carries no count line (data-home-count): the homepage is not the one this section judges");
  else {
    const fig=Number(((text(cl).match(/^([\d,]+) open postings? · counted /)||[])[1]||"").replace(/,/g,""));
    const iso=(cl.match(/<time datetime="([^"]+)"/)||[])[1]||"";
    const at=Date.parse(iso);
    const stampText=(text(cl).match(/counted (\d{1,2} \w{3} \d{4}), (\d\d:\d\d) UTC/)||[]);
    if (!text(cl)) line(live&&Number.isFinite(live.total)?"FAIL":"INFO","C1 / prints no open-postings figure (the bake could not read the board"+(live&&Number.isFinite(live.total)?"; the board answers "+live.total+" now: republish":", and neither can this section")+")");
    else if (!Number.isFinite(fig)||!fig||!Number.isFinite(at)||!stampText.length) line("FAIL","C1 / count line is not \"N open postings · counted D, T UTC\" with its <time datetime>: \""+text(cl).slice(0,90)+"\"");
    else if (!live||!Number.isFinite(live.total)||!Number.isFinite(live.at)) line("INFO","C1 / prints "+fig.toLocaleString("en-US")+" counted "+iso+"; get_board_vendor_counts answered no row to compare ("+rd("/tmp/vd_99_vc.json").slice(0,80)+")");
    else if (at===live.at) line(fig===live.total?"PASS":"FAIL","C1 / prints "+fig.toLocaleString("en-US")+" open postings counted "+iso+", and the row says "+live.total.toLocaleString("en-US")+" at the same moment");
    else if (at<live.at&&Math.abs(fig-live.total)<=live.total*0.1) line("PASS","C1 / prints "+fig.toLocaleString("en-US")+" open postings counted "+iso+" (the read the publish made); the row has refreshed since, to "+live.total.toLocaleString("en-US")+" at "+new Date(live.at).toISOString()+", within a tenth of it");
    else line("FAIL","C1 / prints "+fig.toLocaleString("en-US")+" counted "+iso+" against the row\x27s "+live.total.toLocaleString("en-US")+" at "+new Date(live.at).toISOString()+(at>live.at?": a moment later than the row itself":": more than a tenth apart"));
  }
}

// ---- C2: no flow pairing, never verified ----
if (home.length>=500) {
  const bad=[/new · /.test(ht)&&"a \"new · \" flow pairing", (/verified/i.test(ht)||/verified/i.test(JSON.stringify(lds(home))))&&"the word verified"].filter(Boolean);
  line(bad.length?"FAIL":"PASS","C2 / "+(bad.length?"carries "+bad.join(" and "):"carries no flow pairing and no \"verified\", prose or structured data"));
}

// ---- C3: field links from the category list ----
if (home.length>=500) {
  const cat=rd(R+"/src/lib/job-board-categories.ts");
  const slugs=new Set([...((cat.match(/BOARD_CATEGORY_SLUGS[^=]*=\s*\[([\s\S]*?)\]/)||[])[1]||"").matchAll(/"([a-z_]+)"/g)].map((m)=>m[1]));
  const links=[...home.matchAll(/href="\/jobs\/field\/([^"/?#]+)"/g)].map((m)=>m[1]);
  const stray=links.filter((s)=>!slugs.has(s)||s==="retail"||s==="hospitality");
  if (!slugs.size) line("FAIL","C3 this checkout\x27s category list (src/lib/job-board-categories.ts BOARD_CATEGORY_SLUGS) could not be read");
  else if (!links.length) line("FAIL","C3 / links no field page");
  else line(stray.length?"FAIL":"PASS","C3 / links "+links.length+" field pages"+(stray.length?", "+stray.length+" outside the category list: "+stray.join(", "):", every one a category slug ("+links.join(", ")+")"));
}

// ---- C4: all sales final, and no place named as unsold ----
{
  const terr=(t)=>({final:/All sales are final/.test(t),place:(t.match(/(?:not (?:yet )?sold|we don\x27t sell)[^.]{0,40}(?:EU|EEA|India)|EU, the EEA, the UK (?:or|and) India|registered for (?:tax|VAT)|GST in India/i)||[])[0],bad:(t.match(/billing address|IP address|\blook-?up\b/i)||[])[0]});
  for (const [p,t,h] of [["/pricing",pt,pricing],["/",ht,home]]) {
    if (h.length<500) continue;
    const a=terr(t);
    line(a.final&&!a.place&&!a.bad?"PASS":"FAIL","C4 "+p+" "+[a.final?"says all sales are final":"never says all sales are final",a.place?"names a place as unsold (\""+a.place+"\"; the owner, 2026-10-27: keep selling as today)":"names no place as unsold"].join(", ")+(a.bad?", and names \""+a.bad+"\"":""));
  }
}

// ---- C5: sales stay on with no seller named ----
{
  if (home.length>=500&&pricing.length>=500) {
    const bad=[];
    for (const [p,h] of [["/",home],["/pricing",pricing]]) {
      const os=offers(lds(h));
      for (const want of ["Full Analysis","Pro"]) if (!os.some((o)=>o.name===want&&priced(o))) bad.push(p+" offers no "+want+" at a price");
    }
    if (/data-gate=/.test(pricing)) bad.push("/pricing prints a gate note");
    const desc=((pricing.match(/<meta name="description" content="([^"]*)"/)||[])[1]||"");
    if (!/\$5\b/.test(desc)||!/\$45\b/.test(desc)) bad.push("the /pricing description does not name both prices (\""+desc.slice(0,90)+"\")");
    for (const [p,t] of [["/",ht],["/pricing",pt]]) if (/open soon/i.test(t)) bad.push(p+" says purchases open soon");
    line(bad.length?"FAIL":"PASS","C5 sales stay on with no seller named: "+(bad.length?bad.join("; "):"both pages offer the Full Analysis and Pro at their prices, the /pricing description names both, no card prints a gate note and nothing opens soon"));
  }
}

// ---- C7: what React renders ----
{
  const entry=rd("/tmp/vd_99_entry.js"), chunk=rd("/tmp/vd_99_homechunk.js");
  if (entry.length<1000) line("FAIL","C7 the served / names no readable /assets/index-*.js entry ("+entry.length+" bytes): the React strings were not read");
  else {
    const both=entry+"\n"+chunk;
    const ours=both.includes("Search postings from employers")&&both.includes("own job boards and USAJOBS");
    const inEntry=entry.includes("Search postings from employers");
    const old=["Apply yourself, with your own AI","Live job board + your own AI","Scan your CV for free, search the board here or from Claude or ChatGPT"].filter((x)=>both.includes(x));
    const where=chunk.length?"the homepage\x27s chunk":"the React entry (the served / names no HomePage chunk)";
    line(ours&&!old.length&&!inEntry?"PASS":"FAIL","C7 "+where+" "+(ours?"carries the homepage\x27s sentences":"does not carry the homepage\x27s sentences (home.hero.sub)")+(inEntry?", and the entry every page loads still carries them":", the entry every page loads does not")+(old.length?", and the retired hero\x27s "+old.map((x)=>"\""+x+"\"").join(", ")+" are still served":", and none of the retired hero\x27s"));
  }
}

// ---- C10: the apply agent, and the never-submit promise ----
{
  const a=rd("/tmp/vd_99_agent.json").trim();
  const off=a==="false", on=a==="true";
  const trustOff=/The apply agent is switched off/.test(text(trust));
  let faq="";try{faq=JSON.parse(rd(R+"/src/i18n/locales/en.json")).faq.questions.bringYourAgent.answer||""}catch{}
  const surfaces=[["/",ht],["/pricing",pt],["/resume-checker",text(rd("/tmp/vd_99_checker.html"))],["/llms.txt",rd("/tmp/vd_99_llms.txt")],["the FAQ /resume-checker renders (faq.questions.bringYourAgent)",faq]];
  const promise=surfaces.filter(([,t])=>/never submits?\b/i.test(t)).map(([p])=>p);
  if (off||trustOff) line("PASS","C10 the apply agent is retired ("+(off?"agent_sender_public_status answers false":"/trust says it is switched off")+")"+(promise.length?"; "+promise.join(" and ")+" may say it never submits":""));
  else if (!on) line("INFO","C10 agent_sender_public_status answered "+(a.slice(0,60)||"nothing")+" and /trust does not say the agent is off: "+(promise.length?promise.join(" and ")+" say never submit":"no surface it reads says never submit"));
  else line(promise.length?"FAIL":"PASS","C10 the apply agent is live (agent_sender_public_status true), and "+(promise.length?promise.join(" and ")+" still promise never to submit":"no surface it reads promises never to submit"));
}

// ---- C11: each product in its own currency ----
if (H.plans&&P.fa&&pricing.length>=500&&home.length>=500) {
  const one=/Prices (?:are )?in US dollars|your local currency/i;
  const proBilled=/Pro is billed in US dollars/.test(pt);
  const faWay=pt.includes("priced in US dollars and charged at about the same value in the currency of your device\x27s time zone when we recognize the zone and support its currency, or in US dollars otherwise");
  const proRow=/data-plan="pro"/.test(home);
  const strip=ht.includes(text(proRow?H.plans.termCurrency:H.plans.termCurrencyFa));
  const lone=[one.test(pt)&&"/pricing puts both products in one currency or promises your local currency", one.test(ht)&&"/ puts both products in one currency or promises your local currency"].filter(Boolean);
  const faOffers=[...offers(lds(home)),...offers(lds(pricing))].filter((o)=>/Full Analysis/.test(String(o.name||"")));
  const badOffer=faOffers.filter((o)=>o.description!==P.fa.currency);
  const ok=proBilled&&faWay&&strip&&!lone.length&&!badOffer.length;
  line(ok?"PASS":"FAIL","C11 "+(proBilled&&faWay?"/pricing says Pro is billed in US dollars and how the Full Analysis is charged":"/pricing does not say "+[!proBilled&&"Pro is billed in US dollars",!faWay&&"how the Full Analysis is charged"].filter(Boolean).join(" or "))+"; / "+(strip?"says its strip\x27s currency line for the rows it shows ("+(proRow?"Pro and the Full Analysis":"the Full Analysis")+")":"does not say its strip\x27s currency line")+(lone.length?"; "+lone.join("; "):"")+(faOffers.length?(badOffer.length?"; "+badOffer.length+" Full Analysis Offer(s) without the currency sentence":"; every Full Analysis Offer carries the currency sentence"):"; no Full Analysis Offer is published"));
}
'

# ---- C8, C9: the rendered pages, in one headless browser ----
if [ "${VD99_RENDER:-1}" = "0" ]; then echo "INFO  C8 C9 C12 the headless run is skipped (VD99_RENDER=0): hp-routes, hp-fix-switch-over-gate and hp-fix-an-address-with-a-fragment-lands-on-its-element hold them in the suite"
elif [ ! -f "$REPO_ROOT99/scripts/verify-home-pricing-rendered.mjs" ]; then echo "FAIL  C8 C9 this checkout has no scripts/verify-home-pricing-rendered.mjs: the rendered pages were not read"
else SITE="$SITE" REPO_ROOT="$REPO_ROOT99" node "$REPO_ROOT99/scripts/verify-home-pricing-rendered.mjs" || echo "FAIL  C8 C9 the headless run exited with an error"; fi

echo "INFO  G4 (W6): R1 is a verified deploy (its verifiedDeploys entry, ea8acb5e); sections 94-96 read it again"
echo "INFO  SPEED (owner decision 2026-10-27): never slower than the old \"/\" on the Lighthouse mobile and unthrottled 4x-CPU profiles, a lab comparison this section cannot make: node scripts/home-speed-gate.mjs judges docs/homepage-pricing/speed-baseline.json and any re-measure; real-visitor Core Web Vitals are the owner's Search Console read, before the publish and about 28 days after"
