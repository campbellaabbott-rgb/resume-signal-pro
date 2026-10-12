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
#   - the live Auth chunk is the R1 page (it carries the rb-auth flags mark)
#     and has no magic-link copy left;
#   - each sign-in switch, read from the deployed bundle, and a switch that is
#     on while auth-signed-in is not serving its R1 build is a FAIL (Google,
#     the emailed code and recovery all prove a mailbox, which only the account
#     guard may act on); Apple on is always a FAIL (owner decision D10).
#
# READ-ONLY: GETs of public pages and static assets, and one OPTIONS preflight
# of auth-signed-in. Nothing is signed in, sent or written.
echo "== 95. R1 sign-in (web): the first-script stash, no magic link, each sign-in method behind its switch =="

VD95_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/auth-signed-in" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -n "$VD95_H" ] && build_ge auth-signed-in "$VD95_H" 2026-10-14 1; then
  VD95_GUARD=1; echo "INFO  auth-signed-in preflight x-fn-build = $VD95_H (the account guard serves: a switch may be on)"
else
  VD95_GUARD=0; echo "INFO  auth-signed-in preflight x-fn-build = ${VD95_H:-none} (want auth-signed-in.2026-10-14.1 or later before any mailbox-proving switch is on)"
fi

SITE="$SITE" VD95_GUARD="$VD95_GUARD" node -e '(async()=>{
const SITE=process.env.SITE;
const guard=process.env.VD95_GUARD==="1";
const UA={"user-agent":"Mozilla/5.0 (compatible; resumebooster-verify/95)"};
const get=async(u)=>{try{const r=await fetch(u,{headers:UA});return {status:r.status,text:await r.text()}}catch(e){return {status:0,text:"",err:String(e).slice(0,120)}}};
const say=(s,m)=>console.log(s+"  "+m);
try{
// 1. The first <head> script on three pages.
for(const path of ["/","/auth","/jobs"]){
  const r=await get(SITE+path);
  if(r.status!==200){say("FAIL",path+" answered "+r.status+(r.err?" ("+r.err+")":"")+": the stash script could not be read");continue;}
  const head=(r.text.match(/<head[^>]*>([\s\S]*?)<\/head>/i)||[])[1];
  if(!head){say("FAIL",path+" has no <head>: the stash script could not be read");continue;}
  const m=head.match(/<script\b([^>]*)>([\s\S]*?)<\/script>/i);
  const attrs=m?m[1]:"";
  const classic=!!m&&!/\bsrc\s*=|\btype\s*=\s*["\x27]?module|\bdefer\b|\basync\b/i.test(attrs);
  const stash=!!m&&/rb_url_stash/.test(m[2])&&/replaceState/.test(m[2]);
  const firstChild=/^\s*<script\b/i.test(head);
  if(classic&&stash)say("PASS",path+": the first <head> script is the inline classic stash"+(firstChild?", and the first child of <head>":" (something that is not a script precedes it)"));
  else say("FAIL",path+": the first <head> script is "+(!m?"missing":stash?"the stash but not inline classic ("+attrs.trim().slice(0,60)+")":"not the stash ("+(attrs.trim().slice(0,60)||"inline, no rb_url_stash")+")")+": a token in a URL reaches the analytics script before anything moves it");
}

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
say("INFO","sign-in switches live in the bundle: google="+flags.google+" code="+flags.code+" recovery="+flags.recovery+" apple="+flags.apple+(guard?" (auth-signed-in serves its R1 build)":" (auth-signed-in does not serve its R1 build yet)"));
const googleUi=/auth\.google\.continue/.test(corpus);
const codeUi=/one-time-code/.test(corpus);
const resetUi=/auth\.reset\.title/.test(corpus);
const judge=(name,state,label)=>{
  if(state==="on"){
    if(name==="apple")say("FAIL",label+" is ON: owner decision D10 says no Apple sign-in");
    else if(!guard)say("FAIL",label+" is ON while auth-signed-in does not serve its R1 build: a mailbox proof would reach no guard (flip it only after section 96 passes)");
    else say("PASS",label+" is on, and auth-signed-in serves its R1 build");
  }else if(state==="off")say("PASS",label+" is off in the live bundle");
  else if(state==="unknown")say("INFO",label+": the bundle carries both halves of its mark (the constant was not folded), so the switch cannot be read from it");
  else say(r1?"FAIL":"INFO",label+": no mark for this switch in the bundle");
};
judge("google",flags.google,"Google sign-in");
judge("code",flags.code,"Emailed sign-in code");
judge("recovery",flags.recovery,"Password recovery");
judge("apple",flags.apple,"Apple sign-in");
if(flags.google==="on"&&!googleUi)say("FAIL","Google is on but the bundle has no auth.google.continue control");
if(flags.code==="on")say("INFO","the emailed code is the main button: confirm the owner P0 test and the three-codes-in-ten-minutes rate check passed first (D2)");
if(flags.recovery==="on")say(resetUi&&codeUi?"PASS":"FAIL","recovery is on: the bundle "+(resetUi&&codeUi?"carries":"lacks")+" the reset form and the one-time-code field");
}catch(e){say("INFO","section 95 stopped early: "+String(e).slice(0,160))}
})()'
