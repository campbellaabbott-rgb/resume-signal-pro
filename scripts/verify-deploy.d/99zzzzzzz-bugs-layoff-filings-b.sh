# shellcheck shell=bash
# ── 99zzzzzzz-bugs-layoff-filings-b. THE BUG ROUND OF 2026-11-08, PART B, LANE
# LAYOFF-FILINGS-B (branch bugs/b-layoff-filings): one migration,
# 20261113110000 (the integrator sets the final stamp; the title stays),
# a_state_notice_names_the_town_its_street_is_in. No function changes in
# this lane: both layoff readers are rewritten in the database, and agent-mcp
# reads the same reader.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it.
#
# THE STAGE, read from the repo and production, never assumed: the migration
# has applied once a drizzle stub in drizzle/migrations names its title or
# holds its text (Lovable's runner writes one per applied file, under the
# file's name, a staged name, or a title of its own over the same SQL), or
# once M1 finds its helper. Before then every line below that waits for it is
# INFO; from then on, a FAIL.
#
# THE CLAIMS, one line each:
#   M1        S14X-185  public.layoff_site_text exists and anon is refused it:
#                       a GET (PostgREST runs it read-only) answers 42501, not
#                       PGRST202, and never a value.
#   S14X-185            every Illinois notice the readers print names its town:
#                       the cards' reader for each employer the layoff
#                       catalogue carries (board-employer-aliases.ts) and the
#                       Illinois employers the plan named, and the employer
#                       page's reader for each of those with more than one
#                       filing. Each Illinois row is looked up in the state's
#                       file as layoff-filings reads it (Big Local News' raw
#                       il.csv, fetched only when an Illinois row is printed):
#                       a site that holds the town PASSes; a site that is the
#                       street cell alone while the state names a town it lacks
#                       is the defect (Tyson Foods' "28424 38TH Ave. North",
#                       Hillsdale, is pinned); a row the file no longer holds
#                       is not judged. No Illinois row printed: INFO, not
#                       judged.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the joining rule itself
# (a road named after its town, a town in a multi-site cell, regex characters
# in a town) and that nothing else in either reader moved
# (a-notice-site-names-its-town), and the migration's own DO block.
#
# READ-ONLY. One anon GET of a closed function, anon POSTs of the two public
# layoff readers, and a GET of the state's public file. Nothing is written; no
# key is printed.
echo "== 99zzzzzzz-bugs-layoff-filings-b. bug round part B, layoff-filings-b: a state notice prints the town its street is in =="

rm -f /tmp/vd_lfb_*
VDLFB_DRIZZLE="${VDLFB_DRIZZLE:-drizzle/migrations}"
VDLFB_MIGDIR="${VDLFB_MIGDIR:-supabase/migrations}"
VDLFB_ALIASES="${VDLFB_ALIASES:-supabase/functions/layoff-filings/board-employer-aliases.ts}"
VDLFB_IL_URL="https://raw.githubusercontent.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/il.csv"

# M1: the helper, as anon. Typed values; p_site and p_city are its argument names.
curl -s -m 30 -o /tmp/vd_lfb_m1.json "$B/rest/v1/rpc/layoff_site_text?p_site=1%20Main%20St&p_city=Springfield" -H "apikey: $K" -H "Authorization: Bearer $K"

# The cards' reader, 200 tokens a call (its own cap).
VDLFB_ALIASES="$VDLFB_ALIASES" node -e '
const fs=require("fs");let src="";try{src=fs.readFileSync(process.env.VDLFB_ALIASES,"utf8")}catch{}
const toks=[...src.matchAll(/tokens: \[([^\]]*)\]/g)].flatMap((m)=>[...m[1].matchAll(/"([^"]+)"/g)].map((x)=>x[1]));
const named=["tysonfoods~wd5~TSN","tysonfoods~wd5~TSN5","medline~wd5~Medline","iaziqy~ocs~CX_1","recruiting~CAR1022CIS~97f02cc1-98a9-4655-8137-e220d3e8a5d6","dsvgruppe~wd103~DSV","koppers~wd5~Koppers"];
const all=[...new Set([...named,...toks])];
for(let i=0;i*200<all.length;i++)fs.writeFileSync("/tmp/vd_lfb_cardq_"+String(i).padStart(2,"0")+".json",JSON.stringify({p_tokens:all.slice(i*200,i*200+200)}));
fs.writeFileSync("/tmp/vd_lfb_ntok.txt",String(all.length)+" "+String(toks.length));'
for VDLFB_Q in /tmp/vd_lfb_cardq_*.json; do
  [ -f "$VDLFB_Q" ] || continue
  R get_employer_layoff_filings "$(cat "$VDLFB_Q")" > "${VDLFB_Q/cardq_/card_}"
done

# The employer page's reader: Tyson Foods, and each token whose card says it has more than one filing (at most 20).
node -e '
const fs=require("fs");const toks=new Set(["tysonfoods~wd5~TSN"]);
for(const f of fs.readdirSync("/tmp/").filter((x)=>/^vd_lfb_card_\d+\.json$/.test(x)).sort()){
  let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/"+f,"utf8"))}catch{}
  if(Array.isArray(j))for(const r of j)if(r&&Number(r.lf_more_n)>0&&toks.size<20)toks.add(String(r.lf_company_token));}
[...toks].forEach((t,i)=>fs.writeFileSync("/tmp/vd_lfb_listq_"+String(i).padStart(2,"0")+".json",JSON.stringify({p_token:t})));'
for VDLFB_Q in /tmp/vd_lfb_listq_*.json; do
  [ -f "$VDLFB_Q" ] || continue
  R get_employer_layoff_filings_all "$(cat "$VDLFB_Q")" > "${VDLFB_Q/listq_/list_}"
done

# The state's file, only when a reader printed an Illinois row.
if cat /tmp/vd_lfb_card_*.json /tmp/vd_lfb_list_*.json 2>/dev/null | grep -qE '"l[fa]_state" *: *"IL"'; then
  curl -s -m 90 -o /tmp/vd_lfb_il.csv "$VDLFB_IL_URL"
fi

VDLFB_DRIZZLE="$VDLFB_DRIZZLE" VDLFB_MIGDIR="$VDLFB_MIGDIR" VDLFB_ALIASES="$VDLFB_ALIASES" node -e '
const fs=require("fs");const E=process.env;
const raw=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const read=(f)=>{try{return JSON.parse(raw(f))}catch{return undefined}};
const peek=(f)=>JSON.stringify(raw(f).slice(0,140));
const say=(v,s)=>console.log(v+"  "+s);
const pre="before this part is pasted";

// ---- the stage ----
const FILE="a_state_notice_names_the_town_its_street_is_in";
const sqlText=(s)=>String(s||"").replace(/\/\*[\s\S]*?\*\//g," ").replace(/--[^\n]*/g," ").replace(/\s+/g," ").trim();
let ours="";
try{const m=fs.readdirSync(E.VDLFB_MIGDIR).find((f)=>f.endsWith("_"+FILE+".sql"));if(m)ours=sqlText(raw(E.VDLFB_MIGDIR+"/"+m))}catch{}
let stub=false;
try{for(const f of fs.readdirSync(E.VDLFB_DRIZZLE)){if(!f.endsWith(".sql"))continue;
  if(f.includes(FILE)){stub=true;break}
  const s=raw(E.VDLFB_DRIZZLE+"/"+f);if(s.includes(FILE)||(ours&&sqlText(s)===ours)){stub=true;break}}}catch{}
const m1=read("/tmp/vd_lfb_m1.json");
const c1=m1!==null&&typeof m1==="object"&&!Array.isArray(m1)?String(m1.code??""):"";
const helper=c1==="42501"?"closed":(c1==="PGRST202"||c1==="42883")?"missing":m1===undefined||c1?"unread":"open";
const applied=stub||helper==="closed";
say("INFO","stage: database "+(applied?"applied ("+(stub?"a drizzle stub names "+FILE:"its helper answers")+")":"pending (no drizzle stub names "+FILE+" and its helper is missing)"));

// ---- M1 ----
if(helper==="closed")say("PASS","M1 S14X-185 20261113110000 is applied: layoff_site_text exists and anon is refused it (42501)");
else if(helper==="open")say("FAIL","M1 S14X-185 layoff_site_text answers anon: "+peek("/tmp/vd_lfb_m1.json"));
else if(helper==="missing")say(stub?"FAIL":"INFO","M1 S14X-185 layoff_site_text is not in the database"+(stub?" although a drizzle stub names "+FILE:" ("+pre+")"));
else say("FAIL","M1 S14X-185 the layoff_site_text probe answered something unreadable: "+peek("/tmp/vd_lfb_m1.json"));

// ---- S14X-185 ----
{
  const files=(re)=>fs.readdirSync("/tmp/").filter((x)=>re.test(x)).sort().map((x)=>"/tmp/"+x);
  const cards=files(/^vd_lfb_card_\d+\.json$/),lists=files(/^vd_lfb_list_\d+\.json$/);
  const [nAll,nCat]=raw("/tmp/vd_lfb_ntok.txt").split(" ").map(Number);
  const bad=[],il=[],seen=new Set();
  const take=(r,p,via)=>{if(!r||r[p+"_source"]!=="state_warn"||r[p+"_state"]!=="IL")return;
    const x={token:String(r[p+"_company_token"]),filer:String(r[p+"_filer"]??""),date:String(r[p+"_event_date"]??""),workers:Number(r[p+"_workers"]),site:r[p+"_site"]==null?"":String(r[p+"_site"]),via};
    const k=[x.token,x.filer,x.date,x.site].join("|");if(!seen.has(k)){seen.add(k);il.push(x)}};
  for(const f of cards){const j=read(f);if(!Array.isArray(j)){bad.push(f.replace("/tmp/vd_lfb_","")+" "+peek(f));continue}j.forEach((r)=>take(r,"lf","card"))}
  for(const f of lists){const j=read(f);if(!Array.isArray(j)){bad.push(f.replace("/tmp/vd_lfb_","")+" "+peek(f));continue}j.forEach((r)=>take(r,"la","page"))}
  // The state file, as layoff-filings reads it: Location Name, the earliest Notification Date, the street and the town.
  const norm=(s)=>String(s??"").replace(/\s+/g," ").trim().toLowerCase();
  const iso=(s)=>{const t=String(s).trim();let m=/^(\d{4})-(\d{2})-(\d{2})/.exec(t);if(m)return m[1]+"-"+m[2]+"-"+m[3];
    m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);return m?m[3]+"-"+m[1].padStart(2,"0")+"-"+m[2].padStart(2,"0"):""};
  const parse=(s)=>{const rows=[];let row=[],f="",q=false;
    for(let i=0;i<s.length;i++){const c=s[i];
      if(q){if(c==="\""){if(s[i+1]==="\""){f+="\"";i++}else q=false}else f+=c}
      else if(c==="\"")q=true;else if(c===","){row.push(f);f=""}
      else if(c==="\n"||c==="\r"){if(c==="\r"&&s[i+1]==="\n")i++;row.push(f);rows.push(row);row=[];f=""}
      else f+=c}
    if(f!==""||row.length){row.push(f);rows.push(row)}return rows};
  const byKey=new Map();let fileRows=0;
  {const rows=parse(raw("/tmp/vd_lfb_il.csv"));const h=rows[0]||[];const col=(n)=>h.indexOf(n);
   const [cN,cA,cC,cD,cR,cX]=["Location Name","Location Address","Location City","Notification Date(s)","Revised Layoff","Expected Layoff"].map(col);
   if(cN>=0&&cA>=0&&cC>=0&&cD>=0)for(const r of rows.slice(1)){
     const d=String(r[cD]??"").split(",").map(iso).filter(Boolean).sort()[0];if(!d)continue;fileRows++;
     const k=norm(r[cN])+"|"+d;const w=Number(String((cR>=0&&r[cR])||(cX>=0&&r[cX])||"").replace(/[^\d.]/g,""));
     if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push({street:norm(r[cA]),city:norm(r[cC]),town:String(r[cC]??"").trim(),workers:w})}}
  const good=[],wrong=[],unjudged=[];
  for(const x of il){
    const show=x.token+" "+x.date+" "+JSON.stringify(x.site);
    if(norm(x.site)==="28424 38th ave. north"){wrong.push(show+" (the state names Hillsdale)");continue}
    let c=byKey.get(norm(x.filer)+"|"+x.date)||[];const w=c.filter((y)=>y.workers===x.workers);if(w.length)c=w;
    c=c.filter((y)=>y.city);
    if(!c.length){unjudged.push(show);continue}
    if(c.some((y)=>norm(x.site).includes(y.city)))good.push(show);
    else if(c.some((y)=>y.street&&norm(x.site)===y.street))wrong.push(show+" (the state names "+c.map((y)=>y.town).join(" or ")+")");
    else unjudged.push(show+" (the state file now reads otherwise)");
  }
  const asked=nAll+" token(s), "+nCat+" from the layoff catalogue";
  if(bad.length)say("FAIL","S14X-185 a layoff reader answered something unreadable: "+bad.slice(0,2).join("; "));
  else if(!cards.length||!(nAll>0)||!(nCat>0))say("FAIL","S14X-185 the layoff catalogue "+JSON.stringify(E.VDLFB_ALIASES||"")+" was not read: "+(Number.isFinite(nCat)?nCat:0)+" of its tokens asked, so no employer it carries was judged");
  else if(wrong.length)say(applied?"FAIL":"INFO","S14X-185 "+wrong.length+" Illinois notice(s) print a bare street: "+wrong.slice(0,3).join("; ")+(applied?"":" ("+pre+")"));
  else if(good.length)say("PASS","S14X-185 "+good.length+" Illinois notice(s) print the street with its town ("+good.slice(0,3).join("; ")+")"+(unjudged.length?"; "+unjudged.length+" not in the state file":"")+", over "+asked);
  else if(il.length)say("INFO","S14X-185 not judged: "+il.length+" Illinois notice(s) printed and none found in the state file ("+(fileRows?fileRows+" rows read":"unreadable")+"): "+unjudged.slice(0,3).join("; "));
  else say("INFO","S14X-185 not judged: none of "+asked+" prints an Illinois notice (the Tyson Foods notice left the 90-day window about 2026-11-11)");
}
'
