# shellcheck shell=bash
# ── 99zzzz. CONNECT W4 AND W5 (connect-apply-2026-11-07, plan.waves W4 and
# W5): apply_myself tells the truth about each form, and reads five more
# hiring systems' forms. Rides agent-mcp.2026-11-08.1 and public-api.2026-11-08.1
# (branch fix/connect-mcp). No migration.
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh (README.md here).
#
# THE CLAIMS, one line each:
#   A1  an iCIMS posting's route says an employer account comes before the
#       form, and a CAPTCHA the person solves; its note names the account;
#   A2  srs-merchandising's paragraph about companies "not listed on your
#       resume" is answered by the person, and the Breezy page's CV setting
#       fills documents;
#   A3  East West Rail's Pinpoint posting on its own domain is read from
#       pinpointhq.com: four or more questions;
#   A4  a Greenhouse route says the check is invisible;
#   A5  a Workday posting's terms carry no "veteran" or "color", and its note
#       says the form opens after a sign-in;
#   A6  the apply_myself prompt ends with the application-log step;
#   R1  Workable C6A04F38AA is read: 30 or more questions;
#   R2  a live Lever posting is read;
#   R3  BambooHR alstonco 1410 asks sponsorship of "you";
#   R4  a live Paylocity posting is read, with no answer-key field anywhere;
#   R5  a live Teamtailor posting is read;
#   G1  inside ChatGPT, apply_myself still names only Greenhouse and Recruitee;
#   V1  with RB_API_KEY, /v1 answers the same route for iCIMS and reads
#       Workable C6A04F38AA (INFO without the key);
#   and, INFO only, the share of AI-servable postings whose form is read,
#   from the board's source facet (a catalogue figure, not a deploy check).
#
# WHAT WAITS FOR WHAT. Every claim waits for agent-mcp.2026-11-08.1 (V1 for
# public-api.2026-11-08.1); each prints INFO until its build serves.
#
# READ-ONLY. OPTIONS preflights; job-board list and facets reads with
# x-rb-budget: probe; agent-mcp tools/list and prompts/get (free); up to TEN
# apply_myself calls, each a GET of an employer's public form, never a submit.
# With RB_API_KEY they are keyed (ten of the owner's free key's calls);
# without it they are keyless, from the forms pool, 16 seconds apart so the
# pool's 4-a-minute cap is not what answers. A posting that closed since it was
# recorded prints INFO. Two keyed /v1 reads with the key.
echo "== 99zzzz. connect W4 and W5: what a person meets on each form, and five more hiring systems read =="

rm -f /tmp/vd_99ca_*.json /tmp/vd_99ca_*.txt

VD99CA_MCP=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD99CA_LIVE=0
if [ -z "$VD99CA_MCP" ]; then echo "FAIL  agent-mcp preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge agent-mcp "$VD99CA_MCP" "2026-11-08" "1"; then echo "PASS  agent-mcp preflight x-fn-build = $VD99CA_MCP (agent-mcp.2026-11-08.1 or later: ten form readers, the measured route)"; VD99CA_LIVE=1
else echo "INFO  agent-mcp preflight x-fn-build = $VD99CA_MCP: agent-mcp.2026-11-08.1 is not serving yet, so A1-A6, R1-R5 and G1 wait for it"; fi

VD99CA_API=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/public-api" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD99CA_API_LIVE=0
if [ -z "$VD99CA_API" ]; then echo "FAIL  public-api preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge public-api "$VD99CA_API" "2026-11-08" "1"; then echo "PASS  public-api preflight x-fn-build = $VD99CA_API (public-api.2026-11-08.1 or later)"; VD99CA_API_LIVE=1
else echo "INFO  public-api preflight x-fn-build = $VD99CA_API: public-api.2026-11-08.1 is not serving yet, so V1 waits for it"; fi

# One posting id of a vendor from the board, or "".
vd99ca_pick() { J "{\"action\":\"list\",\"vendor\":\"$1\",\"limit\":3,\"groupSimilar\":false,\"includeFacets\":false}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=(JSON.parse(s).jobs||[]).find((x)=>x&&x.source===process.argv[1]&&typeof x.id==="string");process.stdout.write(r?r.id:"")}catch{process.stdout.write("")}})' "$1"; }
VD99CA_N=0
# vd99ca_apply OUT ID [format]: one apply_myself call, keyed when the owner's key is here.
vd99ca_apply() {
  local fmt=""; [ -n "${3:-}" ] && fmt=",\"format\":\"$3\""
  local body="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"apply_myself\",\"arguments\":{\"id\":\"$2\"$fmt}}}"
  if [ -n "${RB:-}" ]; then MC -H "Authorization: Bearer $RB" -d "$body" > "$1"
  else [ "$VD99CA_N" -gt 0 ] && sleep 16; MC -d "$body" > "$1"; fi
  VD99CA_N=$((VD99CA_N+1))
}

if [ "$VD99CA_LIVE" = 1 ]; then
  VD99CA_IC=$(vd99ca_pick icims); VD99CA_GH=$(vd99ca_pick greenhouse); VD99CA_WD=$(vd99ca_pick workday)
  VD99CA_PL=$(vd99ca_pick paylocity); VD99CA_TT=$(vd99ca_pick teamtailor); VD99CA_LV=$(vd99ca_pick lever)
  [ -n "$VD99CA_IC" ] && vd99ca_apply /tmp/vd_99ca_ic.json "$VD99CA_IC"
  vd99ca_apply /tmp/vd_99ca_brz.json "breezy:srs-merchandising:fb71083e7019-retail-store-support-specialist-temecula-ca"
  vd99ca_apply /tmp/vd_99ca_pp.json "pinpoint:eastwestrail:612221"
  [ -n "$VD99CA_GH" ] && vd99ca_apply /tmp/vd_99ca_gh.json "$VD99CA_GH"
  vd99ca_apply /tmp/vd_99ca_wdr.json "workday:iko~wd3~Roofmart_Careers:REQ-13889" markdown
  [ -n "$VD99CA_WD" ] && vd99ca_apply /tmp/vd_99ca_wd.json "$VD99CA_WD"
  vd99ca_apply /tmp/vd_99ca_wk.json "workable:acdisaster:C6A04F38AA"
  [ -n "$VD99CA_LV" ] && vd99ca_apply /tmp/vd_99ca_lv.json "$VD99CA_LV"
  vd99ca_apply /tmp/vd_99ca_bh.json "bamboohr:alstonco:1410"
  [ -n "$VD99CA_PL" ] && vd99ca_apply /tmp/vd_99ca_pl.json "$VD99CA_PL"
  [ -n "$VD99CA_TT" ] && vd99ca_apply /tmp/vd_99ca_tt.json "$VD99CA_TT"
  MC -d '{"jsonrpc":"2.0","id":2,"method":"prompts/get","params":{"name":"apply_myself","arguments":{"id":"greenhouse:acme:1"}}}' > /tmp/vd_99ca_prompt.json
  MC -H "user-agent: openai-mcp/1.0 (ChatGPT)" -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}' > /tmp/vd_99ca_gpt.json
  VD99CA_IC="$VD99CA_IC" VD99CA_GH="$VD99CA_GH" VD99CA_WD="$VD99CA_WD" VD99CA_PL="$VD99CA_PL" VD99CA_TT="$VD99CA_TT" VD99CA_LV="$VD99CA_LV" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const raw=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const res=(f)=>{const j=rd(f);const r=(j&&j.result)||null;if(!r)return null;const text=String(((r.content||[])[0]||{}).text||"");const sc=r.structuredContent||(()=>{try{return JSON.parse(text)}catch{return {}}})();return {r,sc,text}};
// A claim that could not be judged on this posting says why, as INFO; null when it can be judged.
const skip=(tag,id,x)=>{
  if(!id)return tag+" the board answered no posting of this hiring system to read";
  if(!x)return null;
  if(x.r.isError&&/allowance is spent|Too many keyless calls/.test(x.text))return tag+" refused for the forms pool, not the posting: "+x.text.slice(0,120);
  if(!x.r.isError&&x.sc.state&&x.sc.state!=="open")return tag+" "+id+" is "+x.sc.state+" since it was recorded; not judged";
  if(!x.r.isError&&(x.sc.form||{}).source==="unreachable")return tag+" "+id+": the hiring system did not answer just now; run the section again";
  return null;
};
const judge=(tag,id,f,fn)=>{const x=res(f);const s=skip(tag,id,x);if(s){info(s);return}if(!x){ok(false,tag+" "+id+" answered no result: "+raw(f).slice(0,160));return}if(x.r.isError){ok(false,tag+" "+id+" refused: "+x.text.slice(0,160));return}fn(x.sc)};
const E=process.env;
judge("A1",E.VD99CA_IC,"/tmp/vd_99ca_ic.json",(sc)=>{const r=sc.route||{};const note=String((sc.form||{}).note||"");
  ok(r.needsEmployerAccount===true&&r.captcha==="visible"&&/sign in or make an account/.test(note),"A1 iCIMS "+E.VD99CA_IC+": route "+JSON.stringify(r)+", note "+JSON.stringify(note.slice(0,90))+" (want an account before the form, a visible CAPTCHA, and a note that says so)")});
judge("A2","breezy:srs-merchandising:fb71083e7019","/tmp/vd_99ca_brz.json",(sc)=>{const f=sc.form||{};const qs=f.questions||[];const q=qs.find((x)=>/not listed on your resume/i.test(String(x.label||"")));
  ok(!!q&&q.answeredBy==="you"&&Array.isArray(f.documents)&&f.documents.length>0,"A2 srs-merchandising: the paragraph about companies not listed on your resume is answered by "+(q?q.answeredBy:"(question not found)")+", documents "+JSON.stringify(f.documents||[]).slice(0,100)+" (want you, and the page\x27s CV setting)")});
judge("A3","pinpoint:eastwestrail:612221","/tmp/vd_99ca_pp.json",(sc)=>{const f=sc.form||{};const n=(f.questions||[]).length;
  ok(f.source==="employer-published"&&n>=4,"A3 East West Rail (an employer-domain Pinpoint link) is read from pinpointhq.com: source "+f.source+", "+n+" questions (want employer-published, 4 or more)")});
judge("A4",E.VD99CA_GH,"/tmp/vd_99ca_gh.json",(sc)=>{const r=sc.route||{};
  ok(r.captcha==="invisible"&&r.captchaLikely===true,"A4 Greenhouse "+E.VD99CA_GH+": route.captcha "+JSON.stringify(r.captcha)+" (want invisible: no puzzle to solve)")});
{const x=res("/tmp/vd_99ca_wdr.json");const terms=(y)=>(y&&Array.isArray(y.sc.postingTerms))?y.sc.postingTerms:null;
 const s=skip("A5","workday:iko~wd3~Roofmart_Careers:REQ-13889",x);
 let y=x,used="REQ-13889";if(s){info(s+"; judging a listed Workday posting instead");y=res("/tmp/vd_99ca_wd.json");used=E.VD99CA_WD||"(none)"}
 const s2=y===x?null:skip("A5",E.VD99CA_WD,y);
 if(s2)info(s2);
 else if(!y||y.r.isError)ok(false,"A5 Workday "+used+" answered no result: "+String(y&&y.text||"").slice(0,140));
 else{const t=terms(y)||[];const note=String((y.sc.form||{}).note||"")+String(y.sc.markdown||"");
   ok(!t.includes("veteran")&&!t.includes("color")&&/sign in or make an account/.test(note)&&!/does not publish/.test(note),"A5 Workday "+used+": postingTerms "+JSON.stringify(t.slice(0,12))+" carry no veteran or color, and the note names the sign-in (want both)")}}
{const p=rd("/tmp/vd_99ca_prompt.json");const t=String((((p||{}).result||{}).messages||[{}])[0]?.content?.text||"").trimEnd();
 ok(/add a row to my application log in this chat \(date, company, title, job id, applyUrl\) and offer to re-check them later with check_jobs_open\.$/.test(t),"A6 the apply_myself prompt ends with the application-log step ("+JSON.stringify(t.slice(-90))+")")}
judge("R1","workable:acdisaster:C6A04F38AA","/tmp/vd_99ca_wk.json",(sc)=>{const f=sc.form||{};const n=(f.questions||[]).length;
  ok(f.source==="employer-published"&&n>=30,"R1 Workable C6A04F38AA: source "+f.source+", "+n+" questions (want employer-published, 30 or more)")});
judge("R2",E.VD99CA_LV,"/tmp/vd_99ca_lv.json",(sc)=>{const f=sc.form||{};
  ok(f.source==="employer-published"&&Array.isArray(f.documents)&&f.documents.length>0,"R2 Lever "+E.VD99CA_LV+": source "+f.source+", "+(f.questions||[]).length+" questions, documents "+JSON.stringify(f.documents||[]).slice(0,80)+" (want employer-published with its CV setting)")});
judge("R3","bamboohr:alstonco:1410","/tmp/vd_99ca_bh.json",(sc)=>{const f=sc.form||{};const q=(f.questions||[]).find((x)=>/sponsorship/i.test(String(x.label||"")));
  ok(f.source==="employer-published"&&!!q&&q.answeredBy==="you","R3 BambooHR alstonco 1410: source "+f.source+", sponsorship question answered by "+(q?q.answeredBy:"(not found)")+" (want employer-published, you)")});
judge("R4",E.VD99CA_PL,"/tmp/vd_99ca_pl.json",(sc)=>{const f=sc.form||{};const leak=/isCorrect|isGraded|targetScore|isAutoReject/.test(raw("/tmp/vd_99ca_pl.json"));
  ok(f.source==="employer-published"&&(f.questions||[]).length>0&&!leak,"R4 Paylocity "+E.VD99CA_PL+": source "+f.source+", "+(f.questions||[]).length+" questions, "+((f.questions||[]).filter((q)=>q.screens).length)+" marked screens, answer-key fields "+(leak?"PRESENT":"absent")+" (want a form and no key)")});
judge("R5",E.VD99CA_TT,"/tmp/vd_99ca_tt.json",(sc)=>{const f=sc.form||{};
  ok(f.source==="employer-published"||(f.source==="not-published"&&/could not read a form/.test(String(f.note||""))),"R5 Teamtailor "+E.VD99CA_TT+": source "+f.source+", "+(f.questions||[]).length+" questions"+(f.source==="employer-published"?"":" ("+String(f.note||"").slice(0,80)+")")+" (want employer-published; a posting gone from Teamtailor reads not-published with a reason)")});
{const j=rd("/tmp/vd_99ca_gpt.json");const t=(((j||{}).result||{}).tools||[]).find((x)=>x&&x.name==="apply_myself");const d=String(t&&t.description||"");
 ok(!!t&&/Greenhouse or Recruitee/.test(d)&&!/Paylocity|Workable|Teamtailor|Lever|BambooHR|Ashby|Breezy|Pinpoint/.test(d),"G1 inside ChatGPT apply_myself names only Greenhouse and Recruitee ("+(t?JSON.stringify(d.slice(0,140)):"apply_myself missing from tools/list")+")")}'
else
  echo "INFO  A1-A6, R1-R5 and G1 wait for agent-mcp.2026-11-08.1"
fi

if [ -z "${RB:-}" ]; then
  echo "INFO  RB_API_KEY missing from .env.local -- V1 (/v1/jobs/{id}/application for iCIMS and Workable) is not read here"
elif [ "$VD99CA_API_LIVE" != 1 ]; then
  echo "INFO  V1 waits for public-api.2026-11-08.1"
else
  VD99CA_IC2=$(vd99ca_pick icims)
  [ -n "$VD99CA_IC2" ] && curl -s -m 60 -o /tmp/vd_99ca_v1ic.json "$B/functions/v1/public-api/v1/jobs/$VD99CA_IC2/application" -H "Authorization: Bearer $RB" -H "apikey: $K"
  VD99CA_V1WK=$(curl -s -m 60 -o /tmp/vd_99ca_v1wk.json -w '%{http_code}' "$B/functions/v1/public-api/v1/jobs/workable:acdisaster:C6A04F38AA/application" -H "Authorization: Bearer $RB" -H "apikey: $K")
  VD99CA_IC2="$VD99CA_IC2" VD99CA_V1WK="$VD99CA_V1WK" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const ic=rd("/tmp/vd_99ca_v1ic.json");const d=(ic&&(ic.data||ic))||{};
if(!process.env.VD99CA_IC2)console.log("INFO  V1 the board answered no iCIMS posting");
else ok(!!d.route&&d.route.needsEmployerAccount===true&&d.route.captcha==="visible","V1 /v1 route for iCIMS "+process.env.VD99CA_IC2+": "+JSON.stringify(d.route||ic).slice(0,140)+" (want the account and the visible CAPTCHA)");
const wk=rd("/tmp/vd_99ca_v1wk.json");const w=(wk&&(wk.data||wk))||{};const code=process.env.VD99CA_V1WK;
if(code==="503")console.log("INFO  V1 /v1 Workable answered 503: Workable did not answer just now");
else if(code==="404"||code==="410")console.log("INFO  V1 /v1 Workable C6A04F38AA answered "+code+": the posting left the board since it was recorded");
else ok(code==="200"&&(w.form||{}).source==="employer-published"&&((w.form||{}).questions||[]).length>=30,"V1 /v1 reads Workable C6A04F38AA -> "+code+", source "+(w.form||{}).source+", "+(((w.form||{}).questions)||[]).length+" questions (want 200, employer-published, 30 or more)");'
fi

# The share of AI-servable postings whose form is read: a catalogue figure.
J '{"action":"facets"}' > /tmp/vd_99ca_facets.json
node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_99ca_facets.json","utf8"))}catch{}
const s=j&&j.sources;if(!s||typeof s!=="object"){console.log("INFO  the board answered no source facet; the form-read share is not computed");process.exit(0)}
const READ=["ashby","bamboohr","breezy","greenhouse","lever","paylocity","pinpoint","recruitee","teamtailor","workable"];const WITHHELD=["smartrecruiters","usajobs"];
const all=Object.entries(s).filter(([k])=>!WITHHELD.includes(k)).reduce((a,[,v])=>a+Number(v||0),0);const read=READ.reduce((a,k)=>a+Number(s[k]||0),0);
console.log("INFO  form-read share of AI-servable postings: "+read+" of "+all+" ("+(all?(100*read/all).toFixed(1):"?")+"%; the five connect W5 readers add "+["bamboohr","lever","paylocity","teamtailor","workable"].reduce((a,k)=>a+Number(s[k]||0),0)+"; facet of "+j.sourcesAt+")")'
