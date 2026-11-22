# shellcheck shell=bash
# ── 99zzzzzzz-bugs-connector. BUG ROUND A, LANE CONNECTOR (branch bugs/a-connector).
# The AI connector (agent-mcp) refuses a web page that would spend the keyless
# allowance, asks a no-key fit call for the key and not the CV, shows an
# unsigned caller what it can sign in for while sign-in is on, says a null fit
# is unscorable, says back a country or remote location it searched as words,
# prints an employer's hiring record only as the site's own gate admits it,
# and says the federal feed is withheld by our choice; the shared form reader
# (agent-mcp and public-api) treats a cut-off body as unreachable and a
# Greenhouse heading as a section; the /agents page gives each app its own
# allowance line, keyed steps that work, and every form reader the connector
# uses. Three owner options wait on bugs/a-connector-owner.
#
# THE CLAIMS, one line each (the key opens the line):
#   V0   agent-mcp and public-api serve this round's 2026-11-12.1 or later
#        (NB-29: the floor is the round's own build, not a cost-wave one).
#        Until agent-mcp does, no agent-mcp POST is made and its lines print
#        INFO; until public-api does, the shared form reader's lines do;
#   S14X-091   a preflight from a foreign page is not allowed, our own page's
#        is, by name, with its Max-Age; a text/plain POST from a foreign page
#        is 415 (or 403) and a JSON one 403, both before any count; a POST
#        with no Origin (how Claude and ChatGPT call) lists the tools;
#   S14X-263   fit_resume with no credential is told the key or sign-in, never
#        to send the CV (an unmetered refusal on both builds);
#   S14X-262   while sign-in is on an unsigned listing shows fit_resume and
#        key_status oauth2-only; while it is off, INFO (latent), and FAIL if
#        an unsigned listing shows either or any security scheme;
#   S14X-052   a keyed listing's fit_resume says a null fit is unscorable;
#   S14X-260   what a key adds to the listing is exactly fit_resume and
#        key_status (what the page's keyed title now promises);
#   RC-S9-002  search_jobs' output schema names locationNote, the guide says
#        what it means, and browse_jobs relays it;
#   M2-01      employer_hiring_record's rows carry gate and the role counts,
#        and no event count or retired median;
#   USAJOBS-COPY-1   the guide says we choose not to hand on the federal feed
#        and claims no prohibition in its terms;
#   NB-31      every prefix OpenAI's live ChatGPT egress list names is in the
#        bundled copy this deploy ships (read from the checkout);
#   rides      RC-S13-041, S14X-016, S14X-133, S14X-134, S14X-135, S14X-264,
#        S14X-275, S14X-132/agent-mcp, GP-NOLOG-1 and NB-28 have no read-only
#        live trigger: each is PASS on the build that carries it and names
#        the suite file that proves it on the shipped handler;
#   K    VERIFY_KEYLESS_CALLS=1 adds four keyless tool calls (four of today's
#        shared allowance): RC-S9-002 and RC-S13-041 on search_jobs, M2-01
#        with NB-28 on employer_hiring_record. Off by default: INFO;
#   C    the live /agents chunks and bake: S14X-259, S14X-260, S14X-261,
#        S14X-262, SEO-F15 and USAJOBS-COPY-1 as the page says them. While
#        every string this round removed is still served the frontend is not
#        published yet and each prints INFO; after it, each can FAIL;
#   S14X-056-install   the install repo's README no longer says applying is
#        paid. The owner pushes it: INFO owner pending until
#        docs/deploy-ledger.json reservations['bug-round'].ownerDecided names
#        S14X-056, FAIL after that while it still says so;
#   GEO-2   (SEO audit 2026-11-18b) the install README agrees with /agents as
#        crawlers are served it: its apply_myself sentence names no form
#        reader the page's apply_myself sentence does not (Ashby left with
#        OD14-ASHBY-1), and it carries the page's Claude authentication step
#        word for word (HO-1's choice), never the step that kept the detected
#        settings unless the page still says it. FAIL while it does not (the
#        owner pushes the install repo: its main is protected); INFO while
#        the README or the page cannot be read, or the bake is still the one
#        this round replaced. It reads the form sentence, not every line
#        that names apply_myself: the job-id sentence rightly says
#        apply_myself takes an Ashby posting link;
#   O    the owner-gated keys, each INFO owner pending until ownerDecided
#        names it, INFO when the choice ships nothing, and judged once the
#        build (or the frontend publish) that carries the choice is live:
#        OD14-REDIST-1 "withhold": the listing, the guide and the
#        instructions withhold UKG, ADP and Breezy and read no Breezy form;
#        OD14-ASHBY-1 "stop": apply_myself names no Ashby form reader;
#        HO-1 (the choice the owner's install-link check recorded): the
#        Claude steps name that choice, never "keep them as they are".
#        The SEO-F15 reader list leaves out the readers a choice withholds.
#
# READ-ONLY. OPTIONS preflights; agent-mcp POSTs that are never counted
# (initialize, tools/list, prompts/get, the guide, a no-key fit_resume, and
# two POSTs a foreign page would send, which the fixed build refuses before
# anything runs); GETs of the live site, OpenAI's published list and the
# install README. The keyless tool calls run only when asked for. The key is
# sent as a header and never printed.
echo "== 99zzzzzzz. bug round A connector: the browser gate, the listings, the hiring record, the /agents copy, the ChatGPT egress, the install README =="

rm -f /tmp/vd_99bc_*

VDBC_LEDGER="${VDBC_LEDGER:-docs/deploy-ledger.json}"

# ── V0: the builds ──
VDBC_AM_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "apikey: $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
VDBC_AM=0
if [ -z "$VDBC_AM_H" ]; then echo "FAIL  V0 agent-mcp preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
elif build_ge agent-mcp "$VDBC_AM_H" 2026-11-12 1; then VDBC_AM=1; echo "PASS  V0 agent-mcp preflight x-fn-build = $VDBC_AM_H (NB-29: this round's agent-mcp.2026-11-12.1 or later)"
else echo "INFO  V0 agent-mcp preflight x-fn-build = $VDBC_AM_H: bug round A's agent-mcp.2026-11-12.1 is not pasted yet, so its lines wait and no tool is asked"; fi

VDBC_PA_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/public-api" -H "apikey: $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
VDBC_PA=0
if [ -z "$VDBC_PA_H" ]; then echo "FAIL  V0 public-api preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
elif build_ge public-api "$VDBC_PA_H" 2026-11-12 1; then VDBC_PA=1; echo "PASS  V0 public-api preflight x-fn-build = $VDBC_PA_H (NB-29: this round's public-api.2026-11-12.1 or later, which carries the shared form reader)"
else echo "INFO  V0 public-api preflight x-fn-build = $VDBC_PA_H: public-api.2026-11-12.1 is not pasted yet, so the form reader's lines wait for it"; fi

# vdbc_ride KEY NEEDS WHAT TEST: a fix with no read-only live trigger, judged by the build(s) that carry it.
# NEEDS is am (agent-mcp) or both (agent-mcp and public-api, for the shared form reader).
vdbc_ride() {
  local id="$1" need="$2" what="$3" test="$4" builds="$VDBC_AM_H"
  if [ "$need" = both ]; then builds="$VDBC_AM_H and $VDBC_PA_H"; fi
  if [ -z "$VDBC_AM_H" ] || { [ "$need" = both ] && [ -z "$VDBC_PA_H" ]; }; then echo "FAIL  $id cannot be judged: a preflight carries no x-fn-build ($what)"
  elif [ "$VDBC_AM" = 1 ] && { [ "$need" = am ] || [ "$VDBC_PA" = 1 ]; }; then echo "PASS  $id rides $builds: $what (no read-only live trigger; proven on the shipped code by src/test/$test)"
  else echo "INFO  $id waits for this round's build ($what)"; fi
}

# ── the owner's choices. ownerDecided maps key -> choice (a string, or an
# object with a choice), written by the integrator alone; each option's code
# is one commit on bugs/a-connector-owner. ──
vdbc_decided() {
  node -e 'let l={};try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
const d=((l.reservations||{})["bug-round"]||{}).ownerDecided||{};const v=Array.isArray(d)?(d.includes(process.argv[2])?"yes":null):d[process.argv[2]];
process.stdout.write(v==null?"":typeof v==="object"?String(v.choice??v.option??JSON.stringify(v)):String(v))' "$VDBC_LEDGER" "$1"
}
VDBC_O_REDIST=$(vdbc_decided OD14-REDIST-1)
VDBC_O_ASHBY=$(vdbc_decided OD14-ASHBY-1)
VDBC_O_HO1=$(vdbc_decided HO-1)

# ── the connector, asked only what is never counted ──
if [ "$VDBC_AM" = 1 ]; then
  MC -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-deploy","version":"1"}}}' > /tmp/vd_99bc_init.json
  MC -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' > /tmp/vd_99bc_tools.json
  # The keyed listing: a bearer in the shape of a key. From agent-mcp.2026-11-21.1
  # (lane fix/1121-connector-errors, item 6) a bearer that is neither a key nor,
  # while sign-in is on, a sign-in token is listed the keyless tools only; tools/list
  # reads only the shape and never looks the key up, so this one is no key at all.
  MC -H "Authorization: Bearer rb_live_listing_shape_only_not_a_key" -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}' > /tmp/vd_99bc_tools_keyed.json
  MC -d '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"browse_jobs","arguments":{"what":"nurse","where":"United States"}}}' > /tmp/vd_99bc_prompt.json
  MC -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"resumebooster://guide"}}' > /tmp/vd_99bc_guide.json
  VDBC_FIT_CODE=$(MC -D /tmp/vd_99bc_fit.h -o /tmp/vd_99bc_fit.json -w '%{http_code}' -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"fit_resume","arguments":{}}}')
  curl -s -m 30 -D /tmp/vd_99bc_evil.h -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
  curl -s -m 30 -D /tmp/vd_99bc_own.h -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type, mcp-protocol-version"
  VDBC_PLAIN=$(curl -s -m 60 -o /tmp/vd_99bc_plain.json -w '%{http_code}' -X POST "$B/functions/v1/agent-mcp" -H "Content-Type: text/plain;charset=UTF-8" -H "apikey: $K" -H "Origin: https://evil.example" -d '{"jsonrpc":"2.0","id":7,"method":"tools/list","params":{}}')
  VDBC_FOREIGN=$(curl -s -m 60 -o /tmp/vd_99bc_foreign.json -w '%{http_code}' -X POST "$B/functions/v1/agent-mcp" -H "Content-Type: application/json" -H "apikey: $K" -H "Origin: https://evil.example" -d '{"jsonrpc":"2.0","id":8,"method":"tools/list","params":{}}')
  VDBC_FIT_CODE="$VDBC_FIT_CODE" VDBC_PLAIN="$VDBC_PLAIN" VDBC_FOREIGN="$VDBC_FOREIGN" SITE="$SITE" VDBC_P=/tmp/vd_99bc_ node -e '
const fs=require("fs");const P=process.env.VDBC_P;const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const raw=(f)=>{try{return fs.readFileSync(P+f,"utf8")}catch{return ""}};
const rd=(f)=>{try{return JSON.parse(raw(f))}catch{return null}};
const hdr=(f,n)=>{const m=new RegExp("^"+n+":[ \\t]*(.*)$","im").exec(raw(f).replace(/\r/g,""));return m?m[1].trim():null};
const why=(f)=>JSON.stringify(raw(f).slice(0,140));
const toolsOf=(f)=>{const j=rd(f);return j&&j.result&&Array.isArray(j.result.tools)?j.result.tools:null};
const kl=toolsOf("tools.json"),ky=toolsOf("tools_keyed.json");const names=(t)=>(t||[]).map((x)=>x.name).sort();
const schemes=(t)=>Array.isArray(t&&t.securitySchemes)?t.securitySchemes.map((s)=>s&&s.type):null;

// S14X-091: the browser gate.
const evil=hdr("evil.h","access-control-allow-origin"),own=hdr("own.h","access-control-allow-origin"),age=hdr("own.h","access-control-max-age");
const site=process.env.SITE;
ok(raw("evil.h")!==""&&evil!=="*"&&evil!=="https://evil.example"&&own===site&&!!age,"S14X-091 a preflight from https://evil.example is answered with Access-Control-Allow-Origin "+(evil===null?"none":JSON.stringify(evil))+" (want none, never * or itself); our own page is answered "+JSON.stringify(own)+" with Max-Age "+JSON.stringify(age)+" (want "+site+" by name, with one)");
const plain=process.env.VDBC_PLAIN,foreign=process.env.VDBC_FOREIGN;
ok((plain==="415"||plain==="403")&&foreign==="403","S14X-091 a text/plain POST from a foreign page answers HTTP "+plain+" (want 415 or 403) and a JSON one HTTP "+foreign+" (want 403), refused before anything is counted");
ok(!!kl&&kl.length>0,"S14X-091 positive control: a JSON POST with no Origin, as Claude and ChatGPT call, lists "+(kl?kl.length:0)+" tools"+(kl?"":": "+why("tools.json")));

// S14X-263: a no-key fit call is told the key or sign-in, never asked for the CV.
const fitCode=process.env.VDBC_FIT_CODE;const fit=rd("fit.json");const fitText=JSON.stringify(fit&&fit.result||fit||raw("fit.json"));
const challenged=fitCode==="401"&&/Bearer/i.test(hdr("fit.h","www-authenticate")||"");
const told=fitCode==="200"&&!!(fit&&fit.result&&fit.result.isError)&&/\bkey\b|sign/i.test(fitText);
ok((challenged||told)&&!/whole CV/i.test(fitText),"S14X-263 fit_resume with no credential answers HTTP "+fitCode+(challenged?" with the sign-in challenge":told?" naming the key or sign-in":" naming neither the key nor sign-in")+(/whole CV/i.test(fitText)?", and asks for the whole CV":", never for the CV")+": "+fitText.slice(0,140));

// S14X-262: what an unsigned caller is shown.
const init=rd("init.json");const meta=init&&init.result&&init.result._meta||{};const state=(meta["work.resumebooster/sign-in"]||{}).state||"unknown";
if(!kl)ok(false,"S14X-262 the unsigned listing answered no tools: "+why("tools.json"));
else if(state==="on"){const pick=(n)=>kl.find((t)=>t.name===n);const ko=["fit_resume","key_status"].every((n)=>JSON.stringify(schemes(pick(n)))===JSON.stringify(["oauth2"]));
  ok(ko&&!pick("debug_search"),"S14X-262 sign-in is on: an unsigned listing shows fit_resume and key_status oauth2-only ("+["fit_resume","key_status"].map((n)=>n+" "+JSON.stringify(schemes(pick(n)))).join(", ")+"), debug_search "+(pick("debug_search")?"LISTED":"never"));}
else if(state==="off"){const shown=kl.filter((t)=>["fit_resume","key_status","debug_search"].includes(t.name)).map((t)=>t.name);const sch=kl.filter((t)=>t.securitySchemes).map((t)=>t.name);
  if(shown.length||sch.length)ok(false,"S14X-262 sign-in is off, yet an unsigned listing shows "+JSON.stringify(shown)+" and security schemes on "+JSON.stringify(sch)+" (want neither while off)");
  else console.log("INFO  S14X-262 sign-in is off ("+((meta["work.resumebooster/sign-in"]||{}).reason||"no reason")+"): latent until it is on; an unsigned listing shows no keyed tool and no security scheme, as it must while off");}
else console.log("INFO  S14X-262 the sign-in state reads "+JSON.stringify(state)+": nothing to judge");

// S14X-052: the null-fit sentence, on the keyed listing.
const fr=(ky||[]).find((t)=>t.name==="fit_resume");const frd=String(fr&&fr.description||"");
ok(!!fr&&/A null fit is unscorable/.test(frd)&&!/A null fit means the posting has no stored text to score/.test(frd),"S14X-052 a keyed listing\x27s fit_resume says "+(fr?(/A null fit means the posting has no stored text/.test(frd)?"a null fit always means no stored text":/A null fit is unscorable/.test(frd)?"a null fit is unscorable, for either reason":"nothing about a null fit"):"nothing: fit_resume is not on it"));

// S14X-260: what a key adds is what the page promises.
const anon=(kl||[]).filter((t)=>!t.securitySchemes||t.securitySchemes.some((s)=>s&&s.type==="noauth")).map((t)=>t.name);
const adds=names(ky).filter((n)=>!anon.includes(n));
ok(!!ky&&!!kl&&JSON.stringify(adds)===JSON.stringify(["fit_resume","key_status"])&&!names(ky).includes("debug_search"),"S14X-260 a key adds "+JSON.stringify(adds)+" to the listing (want [\"fit_resume\",\"key_status\"], the keyed title\x27s promise), debug_search "+(names(ky).includes("debug_search")?"LISTED":"never listed"));

// RC-S9-002: locationNote is in the schema, the guide and the prompt.
const sj=(kl||[]).find((t)=>t.name==="search_jobs");const sjp=sj&&sj.outputSchema&&sj.outputSchema.properties||{};
const guide=JSON.stringify(rd("guide.json")||"");const prompt=JSON.stringify(rd("prompt.json")||"");
ok(!!sjp.locationNote&&/locationNote/.test(guide)&&/locationNote as the board says them, and offer the search locationNote names/.test(prompt),"RC-S9-002 search_jobs\x27 output schema "+(sjp.locationNote?"names":"does not name")+" locationNote; the guide "+(/locationNote/.test(guide)?"says":"never says")+" what it means; browse_jobs "+(/offer the search locationNote names/.test(prompt)?"relays it and offers the search":"does not relay it"));

// M2-01: the hiring record carries the gate and the role counts, never the event counts or retired medians.
const ehr=(kl||[]).find((t)=>t.name==="employer_hiring_record");
const rowp=ehr&&ehr.outputSchema&&ehr.outputSchema.properties&&ehr.outputSchema.properties.employers&&ehr.outputSchema.properties.employers.items&&ehr.outputSchema.properties.employers.items.properties||null;
const gone=["closed_90d","superseded_90d","median_days_open","median_days_to_close"].filter((k)=>rowp&&k in rowp);
const want=["gate","filled_roles_90d","relisted_roles_90d","median_days_to_fill"].filter((k)=>!rowp||!(k in rowp));
ok(!!rowp&&!gone.length&&!want.length,"M2-01 employer_hiring_record\x27s rows "+(rowp?"carry "+(gone.length?"the retired "+JSON.stringify(gone):"no event count or retired median")+" and "+(want.length?"lack "+JSON.stringify(want):"gate with the role counts"):"are not described: "+why("tools.json")));

// USAJOBS-COPY-1: the guide says the choice is ours.
ok(/which we choose not to redistribute for now|federal announcements whose who-may-apply statement is not stored/.test(guide)&&!/forbid redistribut/.test(guide),"USAJOBS-COPY-1 the guide says the federal feed is "+(/forbid redistribut/.test(guide)?"withheld because its terms forbid it":/federal announcements whose who-may-apply statement is not stored/.test(guide)?"handed on once who may apply is stored (OD16), never that its terms forbid it":/which we choose not to redistribute for now/.test(guide)?"withheld by our own choice, for now":"withheld with no reason it names"));
'

  # ── NB-31: the bundled ChatGPT egress against OpenAI's live list ──
  VDBC_OAI=$(curl -s -m 30 -o /tmp/vd_99bc_oai.json -w '%{http_code}' https://openai.com/chatgpt-connectors.json)
  VDBC_OAI="$VDBC_OAI" VDBC_P=/tmp/vd_99bc_ node -e '
const fs=require("fs");const P=process.env.VDBC_P;let live=null;try{live=JSON.parse(fs.readFileSync(P+"oai.json","utf8"))}catch{}
const pre=live&&Array.isArray(live.prefixes)?live.prefixes.map((p)=>p&&p.ipv4Prefix).filter(Boolean):[];
let src="";try{src=fs.readFileSync("supabase/functions/agent-mcp/chatgpt-egress.ts","utf8")}catch{}
const bundled=new Set(src.match(/\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}/g)||[]);
const at=(/BUNDLED_CHATGPT_EGRESS_AT\s*=\s*"([^"]+)"/.exec(src)||[])[1]||"unknown";
if(!src||!bundled.size)console.log("FAIL  NB-31 the checkout holds no bundled ChatGPT egress list (supabase/functions/agent-mcp/chatgpt-egress.ts)");
else if(process.env.VDBC_OAI!=="200"||!pre.length)console.log("INFO  NB-31 OpenAI\x27s list could not be read (HTTP "+process.env.VDBC_OAI+", "+pre.length+" prefixes): the bundled copy of "+at+" is not compared");
else{const missing=pre.filter((p)=>!bundled.has(p));
  console.log((missing.length?"FAIL":"PASS")+"  NB-31 OpenAI\x27s list of "+(live.creationTime||"no date")+" names "+pre.length+" IPv4 prefixes; the bundled copy of "+at+" holds "+(missing.length?"all but "+missing.length+": "+missing.slice(0,8).join(", "):"every one"));}
'
else
  echo "INFO  S14X-091, S14X-263, S14X-262, S14X-052, S14X-260, RC-S9-002, M2-01, USAJOBS-COPY-1 and NB-31 wait for agent-mcp.2026-11-12.1 (no agent-mcp POST is made before it)"
fi

vdbc_ride RC-S13-041 am "\"N. Ireland\" is the UK and a country word before a US state is no country" "bs-search-a-country-word-inside-another-place-is-not-that-country.test.ts"
vdbc_ride S14X-016 am "a board 404 on a detail read is notFound, and the keyless call is given back" "a-closed-id-under-a-carried-prefix-is-not-found-and-given-back.test.ts"
vdbc_ride S14X-133 am "a keyed read of board/stats is the five-minute cached answer" "a-keyed-read-of-the-board-statistics-is-the-cached-answer.test.ts"
vdbc_ride S14X-134 both "a form body cut off mid-read is unreachable and never cached" "a-cut-off-form-body-is-unreachable-and-never-cached.test.ts"
vdbc_ride S14X-135 am "a layoff filing carries the reader's workforce flag" "the-bars-an-agent-is-told-about-a-filing-are-the-readers-bars.test.ts"
vdbc_ride S14X-264 both "a Greenhouse heading is the next question's section, and an unmarked cached form is read again" "a-greenhouse-heading-is-a-section-not-a-question-hint.test.ts"
vdbc_ride S14X-275 am "a keyed refusal for the minute or a revoked key carries no quota headers" "a-key-refused-for-its-minute-is-not-told-its-day.test.ts"
vdbc_ride S14X-132/agent-mcp am "a fit_resume call that scored nothing gives its call back through api_key_fit_unscored" "an-mcp-fit-call-that-scored-nothing-gives-its-allowance-back.test.ts"
vdbc_ride GP-NOLOG-1 am "the search for a title read from the CV carries noLog" "a-title-read-from-the-cv-is-not-written-to-the-search-log.test.ts"
vdbc_ride NB-28 am "a failed filing read says so without the database's words" "the-hiring-record-says-only-what-the-site-would-say.test.ts"

# ── O: the connector's owner choices, read from the same unmetered answers ──
VDBC_AM="$VDBC_AM" VDBC_O_REDIST="$VDBC_O_REDIST" VDBC_O_ASHBY="$VDBC_O_ASHBY" VDBC_P=/tmp/vd_99bc_ node -e '
const fs=require("fs");const P=process.env.VDBC_P;const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const raw=(f)=>{try{return fs.readFileSync(P+f,"utf8")}catch{return ""}};
const rd=(f)=>{try{return JSON.parse(raw(f))}catch{return null}};
const am=process.env.VDBC_AM==="1";
const j=rd("tools.json");const tools=j&&j.result&&Array.isArray(j.result.tools)?j.result.tools:null;
const tool=(n)=>(tools||[]).find((t)=>t.name===n)||{};
const amDesc=String(tool("apply_myself").description||"");
const vend=String((((tool("search_jobs").inputSchema||{}).properties||{}).vendor||{}).description||"");
const init=rd("init.json");const instr=String(init&&init.result&&init.result.instructions||"");
const readers=(/publishes one \(([^)]*)\)/.exec(instr)||[])[1]||"";
const guide=JSON.stringify(rd("guide.json")||"");
const judge=(id,choice,yes,pending,other,f)=>{
  if(!choice)info(id+" owner pending: "+pending);
  else if(!yes.test(choice))info(id+" decided ("+choice+"): "+other);
  else if(!am)info(id+" decided ("+choice+"); waits for agent-mcp.2026-11-12.1, which carries it");
  else if(!tools)ok(false,id+" decided ("+choice+"), but the keyless listing answered no tools");
  else f(choice);
};
judge("OD14-REDIST-1",process.env.VDBC_O_REDIST||"",/withh|yes/i,
  "the connector hands UKG, ADP and Breezy postings on, as today (option \"withhold\" is a commit on bugs/a-connector-owner, with /v1\x27s OD14-REDIST-2)",
  "the connector keeps handing UKG, ADP and Breezy on; nothing of this lane\x27s ships",
  (c)=>{const vOk=/not served/.test(vend)&&["ukg","adp","breezy"].every((n)=>new RegExp("\\b"+n+"\\b").test(vend)),gOk=["UKG","ADP","Breezy"].every((n)=>guide.includes(n)),iOk=/UKG, ADP and Breezy postings are not served here/.test(instr),fOk=!/Breezy/.test(amDesc)&&!/Breezy/.test(readers)&&/Greenhouse/.test(amDesc);
    ok(vOk&&gOk&&iOk&&fOk,"OD14-REDIST-1 decided ("+c+"): search_jobs\x27 vendor filter "+(vOk?"says ukg, adp and breezy are not served":"does NOT withhold ukg, adp and breezy: "+JSON.stringify(vend.slice(0,120)))+"; the guide "+(gOk?"names UKG, ADP and Breezy":"does NOT name all three")+"; the instructions "+(iOk?"say their postings are not served":"do NOT say so")+"; apply_myself "+(fOk?"names no Breezy form reader":"still names Breezy as a form reader"));});
judge("OD14-ASHBY-1",process.env.VDBC_O_ASHBY||"",/stop|yes/i,
  "apply_myself reads Ashby forms from jobs.ashbyhq.com/api/, as today (option \"stop\" is a commit on bugs/a-connector-owner, with /v1\x27s OD14-ASHBY-2)",
  "apply_myself keeps reading Ashby forms; nothing of this lane\x27s ships",
  (c)=>{const fOk=!/Ashby/.test(amDesc)&&/Greenhouse/.test(amDesc),iOk=!!readers&&!/Ashby/.test(readers);
    ok(fOk&&iOk,"OD14-ASHBY-1 decided ("+c+"): apply_myself "+(fOk?"names no Ashby form reader":/Ashby/.test(amDesc)?"still names Ashby as a form reader":"names no reader at all")+"; the instructions\x27 reader list "+(iOk?"leaves Ashby out":readers?"still names Ashby":"is missing"));});
'

# ── K: the keyless tool calls, only when asked for ──
if [ "$VDBC_AM" = 1 ] && [ "${VERIFY_KEYLESS_CALLS:-0}" = 1 ]; then
  MC -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"registered nurse","location":"United States","limit":1}}}' > /tmp/vd_99bc_k_us.json
  MC -d '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"nurse in N. Ireland","limit":1}}}' > /tmp/vd_99bc_k_ni.json
  MC -d '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"nurse in Mexico Missouri","limit":1}}}' > /tmp/vd_99bc_k_mo.json
  MC -d '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"employer_hiring_record","arguments":{"companyTokens":["centriaautism","generalmotors~wd5~Careers_GM"]}}}' > /tmp/vd_99bc_k_hr.json
  VDBC_P=/tmp/vd_99bc_ node -e '
const fs=require("fs");const P=process.env.VDBC_P;const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const raw=(f)=>{try{return fs.readFileSync(P+f,"utf8")}catch{return ""}};
const sc=(f)=>{try{const j=JSON.parse(raw(f));return j&&j.result&&!j.result.isError?(j.result.structuredContent||null):null}catch{return null}};
const why=(f)=>JSON.stringify(raw(f).slice(0,140));
const us=sc("k_us.json");const note=String(us&&us.locationNote||"");
ok(!!us&&/country: "US"/.test(note),"RC-S9-002 K location \"United States\" is said back with the filter that searches the board\x27s field: "+(us?JSON.stringify(note.slice(0,140)||"no locationNote"):why("k_us.json")));
const ni=sc("k_ni.json"),mo=sc("k_mo.json");const nil=ni&&ni.locationInterpreted||{},mol=mo&&mo.locationInterpreted||{};
ok(!!ni&&!!mo&&nil.country==="GB"&&!/^N\.?$/.test(String(nil.location||""))&&mol.country!=="MX","RC-S13-041 K \"nurse in N. Ireland\" reads "+JSON.stringify(nil).slice(0,100)+" (want GB, no place \"N.\"); \"nurse in Mexico Missouri\" reads "+JSON.stringify(mol).slice(0,100)+" (want no MX)");
const hr=sc("k_hr.json");const rows=hr&&Array.isArray(hr.employers)?hr.employers:[];const text=raw("k_hr.json");
const bad=rows.filter((r)=>["closed_90d","superseded_90d","median_days_open","median_days_to_close"].some((k)=>k in r)).map((r)=>r.company_token);
const ungated=rows.filter((r)=>!r.gate).map((r)=>r.company_token);
const leak=/ERROR:|violates|permission denied|does not exist|syntax error/i.test(text);
if(!hr)ok(false,"M2-01 K employer_hiring_record answered no result: "+why("k_hr.json"));
else if(!rows.length)console.log("INFO  M2-01 K employer_hiring_record answered no row to judge");
else ok(!bad.length&&!ungated.length&&!leak,"M2-01 K "+rows.length+" rows: "+(bad.length?"event counts or retired medians on "+JSON.stringify(bad):"no event count or retired median")+", "+(ungated.length?"no gate on "+JSON.stringify(ungated):"each with its gate")+", "+(leak?"and database error text (NB-28)":"and no database error text (NB-28)"));
'
else
  echo "INFO  K the keyless tool calls (RC-S9-002, RC-S13-041, M2-01 with NB-28) are not run: VERIFY_KEYLESS_CALLS=1 runs them, four of today's shared keyless allowance"
fi

# ── C: the /agents page as served ──
VDBC_ENTRY=$(curl -s -m 30 "$SITE/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
: > /tmp/vd_99bc_entry.js; : > /tmp/vd_99bc_ac.js; : > /tmp/vd_99bc_mt.js
if [ -n "$VDBC_ENTRY" ]; then
  curl -s -m 30 "$SITE$VDBC_ENTRY" > /tmp/vd_99bc_entry.js
  VDBC_ACN=$(grep -oE 'AgentConnect-[A-Za-z0-9_-]+\.js' /tmp/vd_99bc_entry.js | head -1)
  if [ -n "$VDBC_ACN" ]; then curl -s -m 30 "$SITE/assets/$VDBC_ACN" > /tmp/vd_99bc_ac.js; fi
  VDBC_MTN=$(cat /tmp/vd_99bc_ac.js /tmp/vd_99bc_entry.js | grep -oE 'mcp-tools-[A-Za-z0-9_-]+\.js' | head -1)
  if [ -n "$VDBC_MTN" ]; then curl -s -m 30 "$SITE/assets/$VDBC_MTN" > /tmp/vd_99bc_mt.js; fi
fi
curl -s -m 30 -A "$UA" "$SITE/agents" > /tmp/vd_99bc_bake.html
VDBC_ENTRY="$VDBC_ENTRY" VDBC_ACN="${VDBC_ACN:-}" VDBC_MTN="${VDBC_MTN:-}" VDBC_O_REDIST="$VDBC_O_REDIST" VDBC_O_ASHBY="$VDBC_O_ASHBY" VDBC_O_HO1="$VDBC_O_HO1" VDBC_P=/tmp/vd_99bc_ node -e '
const fs=require("fs");const P=process.env.VDBC_P;const raw=(f)=>{try{return fs.readFileSync(P+f,"utf8")}catch{return ""}};
const ac=raw("ac.js"),mt=raw("mt.js"),js=ac+"\n"+mt,bake=raw("bake.html");
const names=(process.env.VDBC_ACN||"no AgentConnect chunk")+" + "+(process.env.VDBC_MTN||"no mcp-tools chunk");
const has=(s,x)=>s.includes(x);
const OLD_JS=["opens every read tool","last confirmed it open","to open a posting in full or to check a shortlist","whose terms forbid redistributing","label:\"Pinpoint\"}]","the unkeyed tools still answer"];
const OLD_BAKE=["opens every read tool","last confirmed it open","the unkeyed tools still answer","whose terms forbid redistributing","Breezy or Pinpoint"];
// The form readers the page names (src/config/mcp-tools.ts MCP_FORM_VENDORS), less any an owner choice withholds:
// OD14-REDIST-1 "withhold" refuses Breezy postings before their form is read; OD14-ASHBY-1 "stop" reads no Ashby form.
const NOT_READ=[...(/withh|yes/i.test(process.env.VDBC_O_REDIST||"")?["Breezy"]:[]),...(/stop|yes/i.test(process.env.VDBC_O_ASHBY||"")?["Ashby"]:[])];
const VENDORS=["Greenhouse","Ashby","Recruitee","Breezy","Pinpoint","Paylocity","Workable","Teamtailor","Lever","BambooHR"].filter((v)=>!NOT_READ.includes(v));
// HO-1: the authentication choice the owner\x27s install-link check recorded, as the Claude steps must name it.
const HO1=process.env.VDBC_O_HO1||"";const HO1_WANT=/no sign.?in/i.test(HO1)?["No sign in"]:/when needed/i.test(HO1)?["Sign in when needed"]:["Sign in when needed","No sign in"];
const KEEP="Keep them as they are";
const line=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
if(!ac){console.log("FAIL  C /agents ships no AgentConnect chunk (entry "+(process.env.VDBC_ENTRY||"none")+"): the page cannot be judged");}
else if(OLD_JS.every((x)=>has(js,x))){for(const k of ["S14X-259","S14X-260","S14X-261","S14X-262","SEO-F15","USAJOBS-COPY-1"].concat(HO1?["HO-1"]:[]))console.log("INFO  "+k+" waits for the frontend publish: the live /agents chunks ("+names+") still carry every string this round replaced");}
else{
  line(has(mt,"Your calls come from your own internet connection")&&has(ac,"data-allowance")&&has(mt,"Claude users share one allowance"),"S14X-259 the Claude Code, Cursor, VS Code and other panels say the calls come from the person\x27s own internet connection ("+(has(mt,"Your calls come from your own internet connection")?"said":"MISSING")+", rendered by "+(has(ac,"data-allowance")?"the panel\x27s own allowance line":"NO panel line")+") while Claude\x27s keeps its shared allowance ("+(has(mt,"Claude users share one allowance")?"kept":"MISSING")+") ("+names+")");
  line(!has(js,"opens every read tool")&&has(js,"With a free key (optional")&&has(js," adds ")&&has(js,"claude mcp remove ")&&has(js,"gemini mcp remove --scope user ")&&!has(js,"the unkeyed tools still answer")&&has(js,"the unkeyed tools answer again"),"S14X-260 the keyed steps: the title "+(has(js,"opens every read tool")?"still promises every read tool":"says what a key adds")+", the Claude Code and Gemini steps "+(has(js,"claude mcp remove ")&&has(js,"gemini mcp remove --scope user ")?"remove the keyless entry first":"do NOT remove the keyless entry")+", and the quota row "+(has(js,"the unkeyed tools still answer")?"still says the unkeyed tools answer while the spent key is set":has(js,"the unkeyed tools answer again")?"says to remove the key":"is MISSING"));
  line(!has(js,"last confirmed it open")&&has(js,"when the board last read the employer"),"S14X-261 get_job on /agents says "+(has(js,"last confirmed it open")?"the feed last confirmed the posting open":has(js,"when the board last read the employer")?"when the board last read the employer\x27s feed":"neither"));
  line(!has(js,"to open a posting in full or to check a shortlist")&&has(js,"to score your CV against postings or to show your key"),"S14X-262 Claude\x27s sign-in line names "+(has(js,"to open a posting in full or to check a shortlist")?"keyless work (opening a posting, checking a shortlist)":has(js,"to score your CV against postings or to show your key")?"scoring a CV and the key\x27s status, which need an account":"neither"));
  const missing=VENDORS.filter((v)=>!has(mt,"label:\""+v+"\""));
  const named=NOT_READ.filter((v)=>has(mt,"label:\""+v+"\""));
  line(!missing.length&&!named.length&&!has(mt,"label:\"Pinpoint\"}]"),"SEO-F15 the page names "+(VENDORS.length-missing.length)+" of the "+VENDORS.length+" form readers the connector uses"+(missing.length?" (missing "+missing.join(", ")+")":"")+(named.length?", and names "+named.join(", ")+", whose form the owner\x27s choice stops it reading":"")+(has(mt,"label:\"Pinpoint\"}]")?", and its list still ends at Pinpoint":""));
  if(HO1){const said=HO1_WANT.filter((x)=>has(mt,x));line(!has(mt,KEEP)&&said.length>0,"HO-1 decided ("+HO1+"): the Claude steps on /agents "+(has(mt,KEEP)?"still say to keep the detected authentication settings":"no longer say to keep the detected settings")+" and "+(said.length?"name "+JSON.stringify(said[0]):"name no authentication choice ("+HO1_WANT.join(" or ")+")"));}
  line((has(js,"which we choose not to redistribute for now")||has(js,"U.S. federal announcements are handed on once"))&&!has(js,"whose terms forbid redistributing"),"USAJOBS-COPY-1 /agents says the federal feed is "+(has(js,"whose terms forbid redistributing")?"withheld because its terms forbid it":has(js,"U.S. federal announcements are handed on once")?"handed on once who may apply is stored (OD16)":has(js,"which we choose not to redistribute for now")?"withheld by our own choice, for now":"withheld with no reason"));
}
// GEO-2 below compares the install README with this bake, and waits as these lines do while it is the old one.
try{fs.writeFileSync(P+"bake_old",bake.includes("<")&&OLD_BAKE.every((x)=>has(bake,x))?"1":"0")}catch{}
if(!bake.includes("<"))console.log("FAIL  C the /agents bake answered no page");
else if(OLD_BAKE.every((x)=>has(bake,x))){for(const k of ["S14X-260","S14X-261","SEO-F15","USAJOBS-COPY-1"].concat(HO1?["HO-1"]:[]))console.log("INFO  "+k+" (bake) waits for the frontend publish: the /agents bake still carries every string this round replaced");}
else{
  line(!has(bake,"opens every read tool")&&!has(bake,"the unkeyed tools still answer")&&has(bake,"the unkeyed tools answer again"),"S14X-260 (bake) the keyed title and the quota row as crawlers read them: "+(has(bake,"opens every read tool")?"the title promises every read tool":"no promise of every read tool")+", "+(has(bake,"the unkeyed tools still answer")?"the old quota fix":has(bake,"the unkeyed tools answer again")?"the new quota fix":"no quota fix"));
  line(!has(bake,"last confirmed it open")&&has(bake,"when the board last read the employer"),"S14X-261 (bake) get_job as crawlers read it says "+(has(bake,"last confirmed it open")?"the feed last confirmed it open":has(bake,"when the board last read the employer")?"when the board last read the feed":"neither"));
  line(has(bake,"Lever or BambooHR")&&!has(bake,"Breezy or Pinpoint"),"SEO-F15 (bake) apply_myself as crawlers read it names "+(has(bake,"Lever or BambooHR")?"its form readers":has(bake,"Breezy or Pinpoint")?"five form readers":"no reader list"));
  if(HO1){const said=HO1_WANT.filter((x)=>has(bake,x));line(!has(bake,KEEP)&&said.length>0,"HO-1 (bake) decided ("+HO1+"): the Claude steps as crawlers read them "+(has(bake,KEEP)?"still say to keep the detected settings":"no longer say to keep the detected settings")+" and "+(said.length?"name "+JSON.stringify(said[0]):"name no authentication choice"));}
  line((has(bake,"which we choose not to redistribute for now")||has(bake,"U.S. federal announcements are handed on once"))&&!has(bake,"whose terms forbid redistributing"),"USAJOBS-COPY-1 (bake) the federal note as crawlers read it says "+(has(bake,"whose terms forbid redistributing")?"the terms forbid it":has(bake,"U.S. federal announcements are handed on once")?"they are handed on once who may apply is stored (OD16)":has(bake,"which we choose not to redistribute for now")?"we choose not to, for now":"nothing"));
}
if(!HO1)console.log("INFO  HO-1 owner pending: /agents keeps the Add to Claude button off and tells Claude users to keep the detected authentication settings, until the owner\x27s install-link check records which choice saves and searches (the one-click option is a commit on bugs/a-connector-owner)");
'

# ── S14X-056-install: the install README, which the owner pushes ──
VDBC_RM=$(curl -s -m 30 -o /tmp/vd_99bc_readme.md -w '%{http_code}' https://raw.githubusercontent.com/campbellaabbott-rgb/resumebooster-mcp/main/README.md)
VDBC_RM="$VDBC_RM" VDBC_LEDGER="$VDBC_LEDGER" VDBC_P=/tmp/vd_99bc_ node -e '
const fs=require("fs");const P=process.env.VDBC_P;let md="";try{md=fs.readFileSync(P+"readme.md","utf8")}catch{}
let decided=false;try{const j=JSON.parse(fs.readFileSync(process.env.VDBC_LEDGER,"utf8"));const d=((j.reservations||{})["bug-round"]||{}).ownerDecided||{};decided=Array.isArray(d)?d.includes("S14X-056"):Object.prototype.hasOwnProperty.call(d,"S14X-056")}catch{}
const n=(md.match(/Applying is paid/g)||[]).length;
if(process.env.VDBC_RM!=="200"||!/resumebooster/i.test(md))console.log("INFO  S14X-056-install the install README could not be read (HTTP "+process.env.VDBC_RM+"): not judged");
else if(!n)console.log("PASS  S14X-056-install the install README says nothing of paid applying (0 of \"Applying is paid\")");
else if(decided)console.log("FAIL  S14X-056-install the install README still says \"Applying is paid\" "+n+" time(s), and the owner\x27s decision is recorded: push the re-synced branch and republish server.json");
else console.log("INFO  S14X-056-install owner pending: the install README still says \"Applying is paid\" "+n+" time(s) until the owner pushes the re-synced branch (ownerDecided names no S14X-056)");
'

# ── GEO-2: the install README against /agents as crawlers are served it ──
VDBC_RM="$VDBC_RM" VDBC_P=/tmp/vd_99bc_ node -e '
const fs=require("fs");const P=process.env.VDBC_P;const raw=(f)=>{try{return fs.readFileSync(P+f,"utf8")}catch{return ""}};
const md=raw("readme.md"),bake=raw("bake.html");
// One reading for both: tags, bold marks and code ticks out, entities in, spaces collapsed, no space before a stop.
const flat=(s)=>s.replace(/<[^>]+>/g," ").replace(/\*\*|`/g,"").replace(/&#x27;|&#39;/g,"\x27").replace(/&quot;/g,"\"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/\s+/g," ").replace(/ ([.,;:])/g,"$1");
const page=flat(bake),readme=flat(md);
const list=(re,s)=>{const m=re.exec(s);return m?m[1].split(/, or |, | or /).map((x)=>x.trim()).filter(Boolean):null};
const pv=list(/When the employer uses ([^.:;]+?), it returns the employer\x27s real application form/,page);
const rv=list(/when the posting\x27s hiring system is ([^.:;]+?), it returns the employer\x27s real application form/,readme);
const KEEP="Keep them as they are and click Continue.";
const step=(/Under authentication, choose [^.]+? and click Continue\./.exec(page)||[])[0]||(page.includes(KEEP)?KEEP:null);
const fix="the owner pushes the install repo\x27s re-synced branch (its main is protected)";
if(process.env.VDBC_RM!=="200"||!/resumebooster/i.test(md))console.log("INFO  GEO-2 the install README could not be read (HTTP "+process.env.VDBC_RM+"): not compared with /agents");
else if(!bake.includes("<"))console.log("INFO  GEO-2 the /agents bake answered no page: the install README is not compared with it");
else if(raw("bake_old")==="1")console.log("INFO  GEO-2 waits for the frontend publish: the /agents bake still carries every string this round replaced, so the install README is not compared with it");
else{
  if(!pv)console.log("INFO  GEO-2 form readers: the /agents bake names no apply_myself reader list (SEO-F15 (bake) judges that), so the install README\x27s is not compared");
  else if(!rv)console.log("FAIL  GEO-2 form readers: the install README\x27s apply_myself sentence names no reader list, where /agents names "+pv.length+" ("+pv.join(", ")+")");
  else{const extra=rv.filter((v)=>!pv.includes(v)),missing=pv.filter((v)=>!rv.includes(v));
    console.log((extra.length?"FAIL":"PASS")+"  GEO-2 form readers: the install README\x27s apply_myself sentence names "+rv.length+" ("+rv.join(", ")+")"+(extra.length?", among them "+extra.join(", ")+", which /agents does not name as a reader: "+fix:", none that /agents does not")+(missing.length?"; it leaves out "+missing.join(", ")+", which /agents names":""));}
  if(!step)console.log("INFO  GEO-2 Claude step: the /agents bake names no authentication step, so the install README\x27s is not compared");
  else{const has=readme.includes(step),kept=step!==KEEP&&readme.includes(KEEP);
    console.log((has&&!kept?"PASS":"FAIL")+"  GEO-2 Claude step: /agents says "+JSON.stringify(step)+"; the install README "+(has?"says it too":"does not")+(kept?" and still says "+JSON.stringify(KEEP):"")+(has&&!kept?"":": "+fix));}
}
'
