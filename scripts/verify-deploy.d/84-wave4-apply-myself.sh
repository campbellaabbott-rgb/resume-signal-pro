# shellcheck shell=bash
# ── 84. WAVE 4, APPLYING YOURSELF: apply_myself hands the person's own AI the
# employer's real form, says who answers each question, and submits nothing
# (owner decisions 2026-10-11: the apply pivot, R2, default-deny drafting;
# branches w4/mcp and w4/api; docs/wave4/README.md).
#
# THE CLAIMS, one line each below:
#   - for a live Greenhouse posting, keyless apply_myself returns the
#     employer-published form: every question has answeredBy, a question
#     with options carries them, no question that is not free text is marked
#     draft_from_your_cv, the submitter is "you", and the call draws on the
#     forms pool (unkeyed.pool "forms"), never the lookups;
#   - the markdown edition carries its five headings;
#   - a Workday posting (no form reader) answers not-published with the
#     apply link, and a SmartRecruiters posting is restricted;
#   - with RB_API_KEY, GET /v1/jobs/{id}/application answers 200 with the
#     same form source, and 451 for SmartRecruiters (INFO without the key);
#   - application_form_cache and its writer refuse anon.
#
# READ-ONLY. Up to FOUR keyless apply_myself calls, all from the forms pool
# (Greenhouse twice, Workday, SmartRecruiters); the Greenhouse form is read
# through the 24-hour cache, so the second call reads no employer system. The
# posting ids come from job-board lists with the probe budget. The two keyed
# /v1 reads cost two calls of the owner's own free key. The probes are GETs,
# which PostgREST runs read-only.
echo "== 84. wave 4 apply myself: the employer's real form, who answers each question, nothing submitted =="

VD84_GH=$(J '{"action":"list","vendor":"greenhouse","limit":3}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=(JSON.parse(s).jobs||[]).find((x)=>x&&x.source==="greenhouse"&&typeof x.id==="string");process.stdout.write(r?r.id:"")}catch{process.stdout.write("")}})')
VD84_WD=$(J '{"action":"list","vendor":"workday","limit":1}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=(JSON.parse(s).jobs||[])[0];process.stdout.write(r&&r.source==="workday"?r.id:"")}catch{process.stdout.write("")}})')
VD84_SR=$(J '{"action":"list","vendor":"smartrecruiters","limit":1}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=(JSON.parse(s).jobs||[])[0];process.stdout.write(r&&r.source==="smartrecruiters"?r.id:"")}catch{process.stdout.write("")}})')

if [ -z "$VD84_GH" ]; then
  echo "FAIL  the board answered no live Greenhouse posting to read a form from (J list vendor=greenhouse)"
else
  MC -D /tmp/vd_84_gh.h -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"apply_myself\",\"arguments\":{\"id\":\"$VD84_GH\"}}}" > /tmp/vd_84_gh.json
  MC -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"apply_myself\",\"arguments\":{\"id\":\"$VD84_GH\",\"format\":\"markdown\"}}}" > /tmp/vd_84_md.json
  VD84_GH="$VD84_GH" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const hdr=(f,n)=>{try{const m=new RegExp("^"+n+":\\s*(.*)$","im").exec(fs.readFileSync(f,"utf8").replace(/\r/g,""));return m?m[1].trim():null}catch{return null}};
const res=(f)=>{const j=rd(f);const r=(j&&j.result)||null;if(!r)return null;const sc=r.structuredContent||(()=>{try{return JSON.parse(((r.content||[])[0]||{}).text||"{}")}catch{return{}}})();return {r,sc,text:String(((r.content||[])[0]||{}).text||"")}};
const id=process.env.VD84_GH;const x=res("/tmp/vd_84_gh.json");
if(!x){console.log("FAIL  apply_myself "+id+" answered no result");}
else if(x.r.isError&&/allowance is spent|Too many keyless calls/.test(x.text)){info("apply_myself refused for the forms pool, not the posting: "+x.text.slice(0,140));}
else if(x.r.isError){console.log("FAIL  apply_myself "+id+" refused: "+x.text.slice(0,160));}
else{
  const sc=x.sc;const f=sc.form||{};const qs=Array.isArray(f.questions)?f.questions:[];
  if(sc.state!=="open"){info("apply_myself "+id+": the posting is "+sc.state+" since the list read; the form is not judged ("+String(sc.note||"").slice(0,80)+")");}
  else if(f.source==="unreachable"){info("apply_myself "+id+": Greenhouse did not answer just now (form.source unreachable, nothing cached); run the section again");}
  else{
    ok(f.source==="employer-published"&&f.vendor==="greenhouse"&&qs.length>0,"apply_myself "+id+" returns the employer-published Greenhouse form ("+qs.length+" questions, source "+f.source+", read "+f.readAt+")");
    const BY=new Set(["you","your_details","your_documents","draft_from_your_cv"]);
    const noBy=qs.filter((q)=>!BY.has(q.answeredBy));
    ok(noBy.length===0,"every question says who answers it"+(noBy.length?" (missing on "+noBy.map((q)=>JSON.stringify(q.label)).slice(0,3).join(", ")+")":" ("+[...BY].map((b)=>b+" "+qs.filter((q)=>q.answeredBy===b).length).join(", ")+")"));
    // The free-text control types _shared/self-apply.ts (FREE_TEXT_TYPE) accepts; anything else is never drafted.
    const FREE=/^(?:input_text|textarea|text|string|longtext|long_text|short_text|shorttext|paragraph|free_?text|multi_?line(?:_text)?|text_?area|text_?field|essay|open|open_question|long_?answer|short_?answer)$/i;
    const drafted=qs.filter((q)=>q.answeredBy==="draft_from_your_cv");
    const wrong=drafted.filter((q)=>(Array.isArray(q.options)&&q.options.length>0)||(q.type&&!FREE.test(String(q.type))));
    ok(wrong.length===0,"no question with options or a non-text type is marked draft_from_your_cv (default-deny; "+drafted.length+" drafted"+(wrong.length?": "+wrong.map((q)=>q.type+" "+JSON.stringify(q.label)).slice(0,3).join(", "):"")+")");
    const choice=qs.filter((q)=>/select|radio|checkbox|boolean|multi/i.test(String(q.type||"")));
    if(!choice.length)info("this form has no choice question, so its options are not judged here (the vendor fixtures prove them)");
    else ok(choice.every((q)=>Array.isArray(q.options)&&q.options.length>0),"each choice question carries its options ("+choice.length+": "+choice.slice(0,2).map((q)=>JSON.stringify(q.label)+" "+(q.options||[]).length).join(", ")+")");
    ok((sc.route||{}).submitter==="you","route.submitter is \"you\": we never submit ("+JSON.stringify(sc.route||{}).slice(0,120)+")");
    const u=sc.unkeyed||{};
    ok(u.pool==="forms"&&hdr("/tmp/vd_84_gh.h","x-unkeyed-remaining")!==null,"applying yourself draws on the forms pool, never the lookups (unkeyed.pool "+u.pool+", "+u.callsLeftToday+" of "+u.ipCap+" form reads left)");
  }
}
const md=res("/tmp/vd_84_md.json");
if(!md||md.r.isError){info("the markdown edition was not read: "+String(md&&md.text||"no result").slice(0,120));}
else if(md.sc.state!=="open"){info("the markdown edition: the posting is "+md.sc.state);}
else{
  const t=String(md.sc.markdown||"");
  const H=["## The posting","## Questions you answer yourself","## Questions your AI may draft from your CV","## Documents to attach","## Where to apply"];
  const miss=H.filter((h)=>!t.includes(h));
  ok(miss.length===0,"the markdown packet carries its five headings"+(miss.length?" (missing: "+miss.join(", ")+")":" ("+t.length+" characters)"));
}'
fi

if [ -z "$VD84_WD" ]; then echo "INFO  the board answered no Workday posting: the not-published answer is proved in an-employers-form-is-read-where-it-was-published-and-never-guessed"
else
  MC -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"apply_myself\",\"arguments\":{\"id\":\"$VD84_WD\"}}}" > /tmp/vd_84_wd.json
  VD84_WD="$VD84_WD" node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_84_wd.json","utf8"))}catch{}
const r=(j&&j.result)||{};const sc=r.structuredContent||{};const f=sc.form||{};const t=String(((r.content||[])[0]||{}).text||"");
if(r.isError&&/allowance is spent|Too many keyless calls/.test(t))console.log("INFO  apply_myself on Workday refused for the forms pool: "+t.slice(0,120));
else if(sc.state&&sc.state!=="open")console.log("INFO  apply_myself "+process.env.VD84_WD+": the posting is "+sc.state);
else console.log((!r.isError&&f.source==="not-published"&&(sc.route||{}).submitter==="you"&&typeof sc.applyUrl==="string"?"PASS":"FAIL")+"  a Workday posting answers not-published with its apply link, the person submitting (source "+f.source+", applyUrl "+String(sc.applyUrl||"none").slice(0,60)+")");'
fi

if [ -z "$VD84_SR" ]; then echo "INFO  the board answered no SmartRecruiters posting: the withheld answer is proved in the-connector-handed-on-smartrecruiters-folded-siblings-and-sold-inside-chatgpt"
else
  MC -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"apply_myself\",\"arguments\":{\"id\":\"$VD84_SR\"}}}" > /tmp/vd_84_sr.json
  node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_84_sr.json","utf8"))}catch{}
const r=(j&&j.result)||{};const sc=r.structuredContent||{};const t=String(((r.content||[])[0]||{}).text||"");
if(r.isError&&/allowance is spent|Too many keyless calls/.test(t))console.log("INFO  apply_myself on SmartRecruiters refused for the forms pool: "+t.slice(0,120));
else console.log((sc.state==="restricted"&&!sc.form?"PASS":"FAIL")+"  a SmartRecruiters posting is restricted and no form is read (state "+sc.state+")");'
fi

if [ -z "${RB:-}" ]; then
  echo "INFO  RB_API_KEY missing from .env.local -- GET /v1/jobs/{id}/application (200 for Greenhouse, 451 for SmartRecruiters) is not read here"
elif [ -z "$VD84_GH" ]; then
  echo "INFO  no Greenhouse posting to read through /v1"
else
  VD84_V1=$(curl -s -m 60 -o /tmp/vd_84_v1.json -w '%{http_code}' "$B/functions/v1/public-api/v1/jobs/$VD84_GH/application" -H "Authorization: Bearer $RB" -H "apikey: $K")
  if [ -n "$VD84_SR" ]; then VD84_V1SR=$(curl -s -m 60 -o /tmp/vd_84_v1sr.json -w '%{http_code}' "$B/functions/v1/public-api/v1/jobs/$VD84_SR/application" -H "Authorization: Bearer $RB" -H "apikey: $K"); else VD84_V1SR=""; fi
  VD84_V1="$VD84_V1" VD84_V1SR="$VD84_V1SR" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_84_v1.json","utf8"))}catch{}
const code=process.env.VD84_V1;const f=(j&&j.form)||{};
if(code==="503")console.log("INFO  /v1/jobs/{id}/application -> 503 form_unreachable: Greenhouse did not answer just now (nothing cached); run again");
else ok(code==="200"&&f.source==="employer-published"&&(j.route||{}).submitter==="you","GET /v1/jobs/{id}/application -> "+code+" (form source "+f.source+", "+(Array.isArray(f.questions)?f.questions.length:0)+" questions; want 200 employer-published, the person submitting)");
if(process.env.VD84_V1SR)ok(process.env.VD84_V1SR==="451","GET /v1/jobs/{SmartRecruiters id}/application -> "+process.env.VD84_V1SR+" (want 451: a withheld system is refused before any read)");'
fi

code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/application_form_cache?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); { [ "$code" = "401" ] || [ "$code" = "403" ]; } && echo "PASS  application_form_cache SELECT as anon -> $code" || echo "FAIL  application_form_cache SELECT as anon -> $code (want 401 or 403: the cache is service-role only)"
probe application_form_cache_put '{"p_posting_id":"greenhouse:verify:0","p_vendor":"greenhouse","p_ok":false,"p_form":{}}'
