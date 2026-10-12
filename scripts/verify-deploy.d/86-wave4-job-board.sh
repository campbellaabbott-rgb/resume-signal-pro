# shellcheck shell=bash
# ── 86. WAVE 4, JOB-BOARD .93: the pass-end tail finishes every pass with a
# receipt per step, a search asked not to be logged is not logged, and a
# search is read the way it was asked (branch w4/jobboard;
# docs/job-board-deploy-notes.md "## 2026-09-09.93"; docs/wave4/README.md).
#
# THE CLAIMS, one line each below:
#   - job-board serves 2026-09-09.93 or later;
#   - the latest pass-end receipt (status.passEnd) is finished: a doneAt after
#     its startedAt and every step (serve, kicks, hygiene, sweep, capacity,
#     names) carrying its own doneAt; a tail still inside its 30 minutes is
#     INFO, a start with an open step past them is a FAIL naming that step;
#   - the no-log flag: the two bundles that carry it serve (job-board .93
#     honours noLog only with the reader proof agent-mcp sends; agent-mcp
#     2026-10-11.3 sets it only for a call from OpenAI's published egress),
#     a browser-style list that sends noLog without the proof is still
#     answered, and a search with ChatGPT's user agent answers in the
#     ChatGPT edition. Neither read can show whether a row was written
#     (honouring the flag changes no answer): that is the owner's
#     service-role SQL, printed with this run's nonce;
#   - "nurse jobs in Texas" returns at least 90% of q "nurse" with location
#     "Texas" and names the place in intentFilters, and so does "software
#     engineer jobs in new york" against its location form; an employer asked
#     for by name ("Humana") resolves with companiesResolved.
#
# READ-ONLY. job-board reads use the probe budget (anonymous reads of our own
# tooling); ONE keyless MCP lookup is spent, as ChatGPT's user agent from this
# machine (outside OpenAI's egress), so the owner can check that a user agent
# alone no longer keeps a search out of the log. No write, no maintenance
# action.
echo "== 86. wave 4 job-board .93: pass-end receipts, the no-log flag, search as asked =="

VD86_JB=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD86_MCP=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD86_LIVE=0
if [ -z "$VD86_JB" ]; then echo "FAIL  job-board preflight carries no x-fn-build"
elif build_ge job-board "$VD86_JB" "2026-09-09" "93"; then echo "PASS  job-board preflight x-fn-build = $VD86_JB (job-board.2026-09-09.93 or later)"; VD86_LIVE=1
else echo "FAIL  job-board preflight x-fn-build = $VD86_JB (want job-board.2026-09-09.93 or later: the pass-end hops, the no-log flag and the place lift are not serving)"; fi

J '{"action":"status"}' > /tmp/vd_86_status.json
VD86_LIVE="$VD86_LIVE" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_86_status.json","utf8"))}catch{}
const STEPS=["serve","kicks","hygiene","sweep","capacity","names"];
const pe=j&&j.passEnd;
if(!j){console.log("FAIL  job-board status answered no JSON");process.exit(0)}
if(process.env.VD86_LIVE!=="1"){info("the pass-end receipts are not judged: .93 is not serving (the line above), and .92 writes no steps");process.exit(0)}
if(!pe||!pe.startedAt){ok(false,"status.passEnd carries no receipt (want {startedAt, steps, doneAt} once a .93 pass has ended)");process.exit(0)}
const t=(x)=>typeof x==="string"?Date.parse(x):NaN;
const s0=t(pe.startedAt),d0=t(pe.doneAt);const steps=pe.steps||{};
const open=STEPS.filter((s)=>!(steps[s]&&Number.isFinite(t(steps[s].doneAt))&&t(steps[s].doneAt)>=t(steps[s].startedAt)));
const failed=STEPS.filter((s)=>steps[s]&&steps[s].ok===false);
const age=Math.round((Date.now()-s0)/60000);
if(Number.isFinite(d0)&&d0>=s0&&open.length===0)ok(failed.length===0,"the last pass-end tail finished: started "+pe.startedAt+", done "+pe.doneAt+", every step with its own receipt ("+STEPS.map((s)=>s+" "+Math.round((Number(steps[s].ms)||0)/1000)+"s"+(steps[s].hops>1?" x"+steps[s].hops:"")).join(", ")+")"+(failed.length?"; but "+failed.join(", ")+" reported ok:false":""));
else if(Date.now()-s0<30*60000)info("the pass-end tail started "+pe.startedAt+" ("+age+" min ago) and is in flight (next "+pe.next+"; open "+open.join(", ")+"): a tail inside its 30 minutes proves nothing either way; run this section again later");
else ok(false,"the pass-end tail started "+pe.startedAt+" ("+age+" min ago) and never finished: step "+(pe.next||open[0])+" has no receipt of its own (open: "+open.join(", ")+"; done "+(pe.doneAt||"never")+")");
info("scan-heartbeat job_board_pass_end fails any pass whose start has no finish after 30 minutes, so every pass is watched, not only the one read here");'

# The no-log flag. The nonce is this run's own, so the owner's SQL finds only it.
VD86_NONCE="vdnolog$(date +%s)"
J "{\"action\":\"list\",\"q\":\"nurse\",\"noLog\":true,\"limit\":1}" > /tmp/vd_86_nolog_browser.json
if build_ge agent-mcp "$VD86_MCP" "2026-10-11" "3"; then
  MC -A "ChatGPT-User/1.0; +https://openai.com/bot" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"search_jobs\",\"arguments\":{\"query\":\"$VD86_NONCE\",\"limit\":1}}}" > /tmp/vd_86_gpt.json
else : > /tmp/vd_86_gpt.json; fi
VD86_LIVE="$VD86_LIVE" VD86_MCP="$VD86_MCP" VD86_NONCE="$VD86_NONCE" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const b=rd("/tmp/vd_86_nolog_browser.json");
ok(!!b&&Array.isArray(b.jobs)&&b.jobs.length>0,"a browser-style list that sends noLog without the reader proof is still answered ("+(b&&Array.isArray(b.jobs)?b.jobs.length+" row":JSON.stringify(b).slice(0,100))+"); whether it was logged is the owner SQL below, not this line");
const g=rd("/tmp/vd_86_gpt.json");const r=(g&&g.result)||null;
if(!r)info("the ChatGPT-edition search was not made: agent-mcp "+(process.env.VD86_MCP||"(no build)")+" is older than 2026-10-11.3, which sets the no-log flag only from OpenAI egress");
else{
  const t=String(((r.content||[])[0]||{}).text||"");
  if(r.isError&&/allowance is spent|Too many keyless calls/.test(t))info("the ChatGPT-edition search was refused for the allowance: "+t.slice(0,120));
  else ok(!r.isError&&!/utm_/.test(t),"a search with the ChatGPT user agent answers in the ChatGPT edition (no tracking tags); whether it was logged is the owner SQL below");
}
if(process.env.VD86_LIVE==="1")info("owner, service role, a minute after this run: SELECT count(*) FROM job_board_search_events WHERE q = '\''"+process.env.VD86_NONCE+"'\'' must be 1, and the same count on job_board_search_misses 1 too: this run called from outside OpenAI'\''s published egress, and from agent-mcp 2026-10-11.3 a user agent alone no longer keeps a search out of the log (0 means the flag still follows the user agent); that a search from OpenAI'\''s egress is not logged is proved in the suite (a-model-reads-slim-cards-and-a-chatgpt-search-is-not-logged, every-claude-and-chatgpt-user-shared-one-addresss-unkeyed-allowance) and, live, by SELECT count(*) FROM job_board_search_events WHERE caller = '\''mcp'\'' AND at::date = current_date staying near the Claude and other search_jobs and search calls in mcp_calls_daily for the day, never those plus ChatGPT'\''s; once .93 has served an hour, SELECT count(*) FROM job_board_search_events WHERE caller = '\''mcp'\'' AND at > now() - interval '\''1 hour'\'' AND jsonb_array_length(coalesce(shown, '\''[]'\''::jsonb)) > 0 must be 0 (an MCP search keeps its words, never its shown ids)");'

# Search as asked: the place moved out of the words, and an employer by name.
J '{"action":"list","q":"nurse jobs in Texas","limit":1}' > /tmp/vd_86_q1.json
J '{"action":"list","q":"nurse","location":"Texas","limit":1}' > /tmp/vd_86_l1.json
J '{"action":"list","q":"software engineer jobs in new york","limit":1}' > /tmp/vd_86_q2.json
J '{"action":"list","q":"software engineer","location":"new york","limit":1}' > /tmp/vd_86_l2.json
J '{"action":"list","companies":["Humana"],"limit":1}' > /tmp/vd_86_name.json
VD86_LIVE="$VD86_LIVE" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
if(process.env.VD86_LIVE!=="1"){info("search as asked is not judged: .93 is not serving");process.exit(0)}
const n=(j)=>j&&typeof j.total==="number"?j.total:(j&&typeof j.totalAtLeast==="number"?j.totalAtLeast:null);
for(const [q,l,label,place] of [["/tmp/vd_86_q1.json","/tmp/vd_86_l1.json","\"nurse jobs in Texas\"",/texas/i],["/tmp/vd_86_q2.json","/tmp/vd_86_l2.json","\"software engineer jobs in new york\"",/new york/i]]){
  const a=rd(q),b=rd(l);const na=n(a),nb=n(b);
  if(na===null||nb===null||nb===0){info(label+": a count was not given (asked "+na+", location form "+nb+"), so the share is not judged");continue}
  const named=JSON.stringify((a&&a.intentFilters)||[]);
  ok(na>=0.9*nb&&place.test(named),label+" returns "+na+" of the location form'"'"'s "+nb+" ("+Math.round(100*na/nb)+"%, want 90% or more) and names the place in intentFilters ("+named.slice(0,100)+")");
}
const c=rd("/tmp/vd_86_name.json");const res=(c&&c.companiesResolved)||[];
ok(n(c)>0&&res.some((r)=>/humana/i.test(String(r.asked))&&Array.isArray(r.tokens)&&r.tokens.length>0),"companies:[\"Humana\"] resolves by name ("+n(c)+" rows; companiesResolved "+JSON.stringify(res).slice(0,140)+")");'
