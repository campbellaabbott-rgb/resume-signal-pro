# shellcheck shell=bash
# ── 95. R1 SIGN-IN, WEB HALF (critical-path round R1, group CP-B frontend;
# branch r1/signin-web). The plan: reports/critical-path-and-accounts-2026-10-12.md,
# "R1: SIGN-IN, RECOVERY AND MAIL" and "Account UX spec".
#
# THE CLAIMS, one line each below:
#   - the first script in <head> on /, /auth and a prerendered page (/jobs) is
#     the inline classic stash (no src, module, defer or async), so a token in
#     a URL is moved into sessionStorage before the host's deferred analytics
#     records the address;
#   - that script, RUN here for two Stripe returns to /success in one tab,
#     drops the first purchase's share when the second arrives (S13-002, the
#     R1 hotfix): otherwise the second buyer is shown the first analysis;
#   - the live Auth chunk is the R1 page (it carries the rb-auth flags mark)
#     and has no magic-link copy left;
#   - each sign-in switch, read from the deployed bundle, and a switch that is
#     on while the account guard is not READY is a FAIL (Google, the emailed
#     code and recovery all prove a mailbox, which only the account guard may
#     act on); Apple on is always a FAIL (owner decision D10).
#     THE GUARD IS READY only when all of what section 96 proves holds (lead
#     decision A, third fixer round): auth-signed-in answers 2026-10-14.1 or
#     later AND migration 20261014110000 is applied, read here the way
#     section 96 reads it, as anon: the two tables answer the permission
#     refusal (42501) and the account-change reader is refused for permission
#     (42501), never for not existing (PGRST205, 42P01, PGRST202). A build
#     that serves over missing tables answers every guard call 503, and a
#     reset then never shows its password form (S12-057).
#
# READ-ONLY: GETs of public pages and static assets, one OPTIONS preflight of
# auth-signed-in, two anon GETs of the proof tables selecting a real column,
# and one anon GET probe of a definer (PostgREST runs it read-only). Nothing
# is signed in, sent or written.
echo "== 95. R1 sign-in (web): the first-script stash, no magic link, each sign-in method behind its switch =="

VD95_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/auth-signed-in" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD95_NOT_READY=""
if [ -n "$VD95_H" ] && build_ge auth-signed-in "$VD95_H" 2026-10-14 1; then
  # The migration behind the build: the tables and the reader must be refused for permission, not missing.
  for VD95_TSEL in account_mailbox_proofs:user_id account_password_clears:session_id; do
    VD95_T=${VD95_TSEL%%:*}; VD95_COL=${VD95_TSEL#*:}
    curl -s -m 30 -o /tmp/vd_95_table.json "$B/rest/v1/$VD95_T?select=$VD95_COL&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"
    VD95_TCODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_95_table.json","utf8"));process.stdout.write(Array.isArray(j)?"ROWS:"+j.length:String(j.code??"NOCODE"))}catch{process.stdout.write("NONJSON")}')
    [ "$VD95_TCODE" = "42501" ] || VD95_NOT_READY="$VD95_NOT_READY $VD95_T -> $VD95_TCODE"
  done
  curl -s -m 60 -o /tmp/vd_95_rpc.json "$B/rest/v1/rpc/auth_changed_since?p_user_id=00000000-0000-0000-0000-000000000000&p_since=2026-01-01T00%3A00%3A00Z" -H "apikey: $K" -H "Authorization: Bearer $K"
  VD95_RCODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_95_rpc.json","utf8"));process.stdout.write(Array.isArray(j)?"ROWS:"+j.length:String(j.code??"NOCODE"))}catch{process.stdout.write("NONJSON")}')
  [ "$VD95_RCODE" = "42501" ] || VD95_NOT_READY="$VD95_NOT_READY auth_changed_since -> $VD95_RCODE"
  if [ -z "$VD95_NOT_READY" ]; then
    VD95_GUARD=1; echo "INFO  the account guard is ready: auth-signed-in x-fn-build = $VD95_H, and 20261014110000 is applied (the proof tables and the account-change reader are refused for permission as anon): a mailbox-proving switch may be on"
  else
    VD95_GUARD=0; echo "FAIL  auth-signed-in serves $VD95_H but the account guard is NOT ready: 20261014110000 is not applied (as anon:$VD95_NOT_READY; want 42501 for each). Every guard call answers 503 and the reset dead-ends. Apply the migration before the frontend (section 96 says the same)"
  fi
else
  VD95_GUARD=0; echo "INFO  auth-signed-in preflight x-fn-build = ${VD95_H:-none} (want auth-signed-in.2026-10-14.1 or later, over migration 20261014110000, before any mailbox-proving switch is on)"
fi

SITE="$SITE" VD95_GUARD="$VD95_GUARD" node -e '(async()=>{
const SITE=process.env.SITE;
const guard=process.env.VD95_GUARD==="1";
const UA={"user-agent":"Mozilla/5.0 (compatible; resumebooster-verify/95)"};
const get=async(u)=>{try{const r=await fetch(u,{headers:UA});return {status:r.status,text:await r.text()}}catch(e){return {status:0,text:"",err:String(e).slice(0,120)}}};
const say=(s,m)=>console.log(s+"  "+m);
try{
// 1. The first <head> script on three pages.
let rootScript="";
for(const path of ["/","/auth","/jobs"]){
  const r=await get(SITE+path);
  if(r.status!==200){say("FAIL",path+" answered "+r.status+(r.err?" ("+r.err+")":"")+": the stash script could not be read");continue;}
  const head=(r.text.match(/<head[^>]*>([\s\S]*?)<\/head>/i)||[])[1];
  if(!head){say("FAIL",path+" has no <head>: the stash script could not be read");continue;}
  const m=head.match(/<script\b([^>]*)>([\s\S]*?)<\/script>/i);
  if(path==="/"&&m)rootScript=m[2];
  const attrs=m?m[1]:"";
  const classic=!!m&&!/\bsrc\s*=|\btype\s*=\s*["\x27]?module|\bdefer\b|\basync\b/i.test(attrs);
  const stash=!!m&&/rb_url_stash/.test(m[2])&&/replaceState/.test(m[2]);
  const firstChild=/^\s*<script\b/i.test(head);
  if(classic&&stash)say("PASS",path+": the first <head> script is the inline classic stash"+(firstChild?", and the first child of <head>":" (something that is not a script precedes it)"));
  else say("FAIL",path+": the first <head> script is "+(!m?"missing":stash?"the stash but not inline classic ("+attrs.trim().slice(0,60)+")":"not the stash ("+(attrs.trim().slice(0,60)||"inline, no rb_url_stash")+")")+": a token in a URL reaches the analytics script before anything moves it");
}

// 1b. The live stash script, RUN (S13-002): two Stripe returns to /success in
// one tab, over one stand-in sessionStorage, with the first purchase share
// stashed between them as the success page stashes it. The second return
// must drop that share, or the second buyer is shown the first analysis and
// theirs is never generated. Nothing is sent anywhere.
const runStash=(src,url,store)=>{
  const u=new URL(url,"https://vd95.invalid");const loc={pathname:u.pathname,search:u.search,hash:u.hash};
  const win={sessionStorage:{getItem:(k)=>store.has(k)?store.get(k):null,setItem:(k,v)=>{store.set(k,String(v))},removeItem:(k)=>{store.delete(k)}}};
  const hist={state:null,replaceState:(s,t,a)=>{const n=new URL(a,"https://vd95.invalid");loc.pathname=n.pathname;loc.search=n.search;loc.hash=n.hash;}};
  new Function("location","history","window",src)(loc,hist,win);
};
if(!rootScript)say("FAIL","the stash script on / could not be read, so its /success rule (S13-002) could not be run");
else{try{
  const store=new Map();
  runStash(rootScript,"/success?session_id=cs_vd95_first",store);
  const o=JSON.parse(store.get("rb_url_stash")||"{}");
  o.share="vd95-share-of-the-first";o.share_path="/success";o.share_session="cs_vd95_first";
  store.set("rb_url_stash",JSON.stringify(o));
  runStash(rootScript,"/success?session_id=cs_vd95_second",store);
  const s=JSON.parse(store.get("rb_url_stash")||"{}");
  if(s.session_id==="cs_vd95_second"&&s.share===undefined)say("PASS","the live stash script, run for two purchases on /success in one tab, drops the first purchase share when the second arrives (S13-002): the second purchase gets its own analysis");
  else if(s.session_id!=="cs_vd95_second")say("FAIL","the live stash script did not stash the second purchase on /success: "+JSON.stringify(s).slice(0,140));
  else say("FAIL","the live stash script keeps the first purchase share beside a second purchase on /success (S13-002): the buyer is shown the old analysis and the new one is never generated. Publish the frontend with the R1 hotfix");
}catch(e){say("FAIL","the live stash script could not be run here: "+String(e).slice(0,140))}}

// 2. The live Auth chunk, the chunks it imports, and the entry that names it.
const shell=await get(SITE+"/auth");
const entry=(shell.text.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)||[])[0];
const main=entry?(await get(SITE+entry)).text:"";
const authName=(main.match(/"\.\/(Auth-[A-Za-z0-9_-]+\.js)"/)||[])[1];
if(!entry||!authName){say("FAIL","could not find the Auth chunk from the live entry ("+(entry||"no entry")+"): nothing below can be judged");return;}
const auth=(await get(SITE+"/assets/"+authName)).text;
const deps=[...new Set([...auth.matchAll(/from\s*"\.\/([A-Za-z0-9_-]+\.js)"/g)].map((x)=>x[1]))].filter((d)=>!/^index-/.test(d));
let corpus=main+"\n"+auth;
for(const d of deps)corpus+="\n"+(await get(SITE+"/assets/"+d)).text;
const r1=/rb-auth:google=(on|off)/.test(corpus);
if(r1)say("PASS",authName+" (with "+deps.length+" imported chunks) is the R1 sign-in page: it carries the rb-auth flags mark");
else say("FAIL",authName+" carries no rb-auth flags mark: the R1 sign-in page is not serving");

const magic=/Magic link sent|sign-in link instead|Email me a sign-in link/.test(corpus);
if(!r1)say("INFO","magic-link copy "+(magic?"still present":"absent")+" in a chunk that is not the R1 page");
else if(magic)say("FAIL",authName+" still carries the magic-link copy: the fallback that reopens the pre-registration takeover is live");
else say("PASS",authName+" carries no magic-link copy (no magic-link button, no \"Magic link sent\")");

// 3. Each switch, read from the bundle. When the build folds a constant only
// the live half of its mark survives; both halves means it was not folded.
const flag=(name)=>{const on=corpus.includes("rb-auth:"+name+"=on"),off=corpus.includes("rb-auth:"+name+"=off");return on&&!off?"on":off&&!on?"off":on&&off?"unknown":"absent";};
const flags={google:flag("google"),code:flag("code"),recovery:flag("recovery"),apple:flag("apple")};
say("INFO","sign-in switches live in the bundle: google="+flags.google+" code="+flags.code+" recovery="+flags.recovery+" apple="+flags.apple+(guard?" (the account guard is ready)":" (the account guard is not ready yet)"));
const googleUi=/auth\.google\.continue/.test(corpus);
const codeUi=/one-time-code/.test(corpus);
const resetUi=/auth\.reset\.title/.test(corpus);
const judge=(name,state,label)=>{
  if(state==="on"){
    if(name==="apple")say("FAIL",label+" is ON: owner decision D10 says no Apple sign-in");
    else if(!guard)say("FAIL",label+" is ON while the account guard is not ready (the R1 build of auth-signed-in over migration 20261014110000): a mailbox proof would reach no guard (flip it only after section 96 passes)");
    else say("PASS",label+" is on, and the account guard is ready");
  }else if(state==="off")say("PASS",label+" is off in the live bundle");
  else if(state==="unknown")say("INFO",label+": the bundle carries both halves of its mark (the constant was not folded), so the switch cannot be read from it");
  else say(r1?"FAIL":"INFO",label+": no mark for this switch in the bundle");
};
judge("google",flags.google,"Google sign-in");
judge("code",flags.code,"Emailed sign-in code");
judge("recovery",flags.recovery,"Password recovery");
judge("apple",flags.apple,"Apple sign-in");
if(flags.google==="on"&&!googleUi)say("FAIL","Google is on but the bundle has no auth.google.continue control");
// THE DEPLOY ORDER, READ FROM THE BUNDLE ITSELF (S12-057: Google and recovery
// ship in the first publish). Whatever the marks say, a live sign-in page that
// offers Google or "Forgot password?" while the account guard is not ready
// (its R1 build over its migration) has been published before section 96
// passed: a Google sign-in or a reset proves a mailbox no guard acts on.
const forgotUi=/auth\.forgot|Forgot password\?/.test(corpus);
const googleCopy=googleUi||/Continue with Google/.test(corpus);
if(r1&&!guard&&(forgotUi||googleCopy))say("FAIL","the live sign-in page offers "+[googleCopy?"Google":"",forgotUi?"\"Forgot password?\"":""].filter(Boolean).join(" and ")+" while the account guard is not ready: the frontend was published before section 96 passed (deploy order: migration 20261014110000 and the functions first, section 96 PASS in full, then the frontend)");
else if(r1&&guard&&(forgotUi||googleCopy))say("PASS","the live sign-in page offers "+[googleCopy?"Google":"",forgotUi?"\"Forgot password?\"":""].filter(Boolean).join(" and ")+", and the account guard is ready");
if(flags.code==="on")say("INFO","the emailed code is the main button: confirm the owner P0 test and the three-codes-in-ten-minutes rate check passed first (D2)");
if(flags.recovery==="on")say(resetUi&&codeUi?"PASS":"FAIL","recovery is on: the bundle "+(resetUi&&codeUi?"carries":"lacks")+" the reset form and the one-time-code field");
}catch(e){say("INFO","section 95 stopped early: "+String(e).slice(0,160))}
})()'
