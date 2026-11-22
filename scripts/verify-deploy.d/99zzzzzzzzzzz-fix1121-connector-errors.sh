# shellcheck shell=bash
# ── 99zzzzzzzzzzz-fix1121-connector-errors. THE ERRORS PEOPLE MET IN THE
# CONNECTOR AND THE API (lane fix/1121-connector-errors, owner 2026-11-21:
# "people are getting errors when using the mcp and API - lets fix it").
# Eleven z's: it sorts after 99zzzzzzzzzz-api4-od16-federal.sh in byte order
# and under a locale that ignores the dash.
#
# THE CLAIMS, one line each (the key opens the line):
#   CE0   agent-mcp and public-api serve this lane's builds or later. Until
#         BOTH do, every line below prints INFO and no further call is made;
#   CE1   (uncounted) initialize answers 2024-11-05, 2025-03-26, 2025-06-18
#         and 2025-11-25 as asked, and 2025-11-25 to 2099-01-01; a preflight
#         from http://localhost:6274 allows mcp-method and mcp-name;
#   CE2   (uncounted) server/discover in the 2026-07-28 shape is either served
#         (200, resultType complete, supportedVersions with 2026-07-28; then a
#         _meta version of 1900-01-01 is HTTP 400 with -32022) or answered
#         with the fallback (HTTP 400 whose code is none of -32022, -32020 and
#         -32601). Today's HTTP 200 with -32601 FAILs;
#   CE3   (uncounted) five refusals in band, before the meter: page 2 names
#         offset, Atlantis is named, Georgia names GE and US, employmentType
#         sometimes lists full_time, maxAgeDays 0 names postedAfter; none
#         carries X-Unkeyed-Remaining;
#   CE4   (uncounted) tools/list with no Authorization and with a bearer that
#         is no key lists the same keyless names, without key_status; key_status
#         with no key is an answer (key.tier none, keyless.lookupsPerDay). The
#         listing half is INFO while sign-in is on;
#   CE5   (VERIFY_KEYLESS_CALLS=1, one counted call) search_jobs {keyword:
#         Recruiter, country: Ireland, limit: 50, location: null, sort: '',
#         colour: red}: read as query, Ireland as IE on every card, total
#         under 1,000, the limit cut to 10 and said, a page that withheld
#         rows full or its shortness said (a first read that withheld nothing
#         is never refilled and owes no reason), and no SmartRecruiters id;
#   CE5d  (the same call; owner D3) colour, a name search_jobs does not take,
#         is not refused: the answer's first line says it was not applied,
#         notApplied leads the answer and ignoredArguments names it. The call
#         is counted would_refuse, one a run, in the owner's 7-day count;
#   CE6   (VERIFY_KEYLESS_CALLS=1, one counted call, sent with the revoked
#         key when the precheck confirms it revoked, and two anonymous board
#         count reads beside it) search_jobs {query: Manager, country: IT,
#         limit: 10}: no SmartRecruiters id, a short page says why, the total
#         drops the withheld rows or says it counts them, within 3 of the
#         board's own counts; with the revoked key, an answer whose
#         unkeyed.keyNote names revoked;
#   CE5+6 every search answer says how fresh the data is (feedFreshness);
#   CE7   (VERIFY_KEYLESS_CALLS=1, one counted call) employer_growth
#         {company: Anthropic} answers the anthropic board with asked
#         Anthropic, or a name_not_resolved row with candidates (INFO);
#   CE8   (unmetered) the API with no key: /v1/openapi.json is the OpenAPI
#         3.1 document, an unknown path is 404 no_such_endpoint, /v1/jobs is
#         401 with WWW-Authenticate and a body naming the data-api page and
#         x-api-key, /v1 names getAKey and openapi and a keylessSample that
#         agrees with the keyless /v1/jobs, HEAD /v1 is 200; with the revoked
#         key in x-api-key, /v1/stats is 403 key_revoked;
#   CE9   (needs RB_API_KEY_FRESH, sent as x-api-key with no Authorization)
#         /v1/jobs?country=Ireland binds IE and says countryRead and
#         coverage.feedFreshness; Atlantis is 400 naming it;
#         /v1/companies?limit=500 says maxLimit 100 and limitCapped;
#   CE11  (VERIFY_KEYLESS_CALLS=1, one counted call) check_jobs_open with two
#         ids from CE6's page sent as one comma string checks 2 and closes
#         neither;
#   CE12  (uncounted) the guide never says total counts title matches only,
#         and says notApplied opens an answer that was sent a name the tool
#         does not take (owner D3: said and counted, not refused, this lane)
#         and that argumentDidYouMean offers the name meant;
#   CE13  INFO: refusals counted by what refused them, and the answered
#         corrected and would_refuse calls (20261206130000), are read by the
#         owner's query (mcp_calls_daily is service-role only).
#
# KEYS, BY THE NAMES THE VERIFIER HOLDS: the revoked key is
# ${RB_REVOKED_KEY:-${RB}} (RB is .env.local's RB_API_KEY, read by
# verify-deploy.sh), sent only after GET /v1/stats with it answers 403
# key_revoked; the fresh key is RB_API_KEY_FRESH, which the owner mints at
# /data-api. Keys go as headers and are never printed.
#
# READ-ONLY. Three OPTIONS preflights; JSON-RPC reads to agent-mcp (initialize,
# tools/list, server/discover, resources/read and read tools, never fit_resume
# or anything that runs a model), each with x-rb-budget: probe and spaced
# VERIFY_CALL_GAP seconds apart (1.1 by default), and the section stops calling
# the connector at its first 429; GETs and one HEAD to public-api; two job-board
# count reads under x-rb-budget: probe. Counted keyless calls only with
# VERIFY_KEYLESS_CALLS=1: four (CE5, CE6, CE7, CE11).
echo "== 99zzzzzzzzzzz. the connector and API errors of 2026-11-21: full pages, read arguments, countries by name, the key door, protocol revisions =="

VDCE_PA="$B/functions/v1/public-api"
VDCE_MCP="$B/functions/v1/agent-mcp"
VDCE_FRESH="${RB_API_KEY_FRESH:-}"
VDCE_REV="${RB_REVOKED_KEY:-${RB:-}}"
VDCE_GAP="${VERIFY_CALL_GAP:-1.1}"
# The lane's builds. The merge sets them to max(2026-11-21.2, live + 1).
# 2026-11-21.2 is the review's fixes (2026-11-22): the argument suggestion's
# own key, the refill that a short refill read no longer ends, N/A unread, and
# /v1/fit reading a country list. .1 lacks them, so it is INFO here.
VDCE_API_DAY=2026-11-21; VDCE_API_N=2
VDCE_MCP_DAY=2026-11-21; VDCE_MCP_N=2

rm -f /tmp/vd_ce_*

# ── CE0: the builds ──
VDCE_API_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$VDCE_PA/v1" -H "apikey: $K" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: GET" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
VDCE_MCP_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$VDCE_MCP" -H "apikey: $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
VDCE_LIVE=0
if [ -n "$VDCE_API_H" ] && build_ge public-api "$VDCE_API_H" "$VDCE_API_DAY" "$VDCE_API_N" \
  && [ -n "$VDCE_MCP_H" ] && build_ge agent-mcp "$VDCE_MCP_H" "$VDCE_MCP_DAY" "$VDCE_MCP_N"; then
  VDCE_LIVE=1
  echo "PASS  CE0 public-api x-fn-build = $VDCE_API_H and agent-mcp x-fn-build = $VDCE_MCP_H (public-api.$VDCE_API_DAY.$VDCE_API_N and agent-mcp.$VDCE_MCP_DAY.$VDCE_MCP_N or later: the fixes are serving)"
else
  echo "INFO  CE0 public-api x-fn-build = ${VDCE_API_H:-none}, agent-mcp x-fn-build = ${VDCE_MCP_H:-none}: the fixes need public-api.$VDCE_API_DAY.$VDCE_API_N and agent-mcp.$VDCE_MCP_DAY.$VDCE_MCP_N or later"
fi

if [ "$VDCE_LIVE" != 1 ]; then
  echo "INFO  CE1-CE13 not run: the fixes are not serving (CE0), so no connector, API or board call is made"
else
  VDCE_STOP=0
  # One connector call: the answer in $1, its headers in $1.h and its status
  # in $1.code; the body is $2; any further arguments go to curl. Nothing is
  # sent after a 429.
  vdce_mc() {
    local f="$1" body="$2"
    shift 2
    if [ "$VDCE_STOP" = 1 ]; then return 0; fi
    MC -H "x-rb-budget: probe" -D "$f.h" -o "$f" -w '%{http_code}' "$@" -d "$body" > "$f.code"
    vdce_after "$f"
  }
  # After every connector call, the ones sent without MC included: a 429
  # stops the section calling the connector; then the gap.
  vdce_after() {
    if [ "$(cat "$1.code" 2>/dev/null)" = "429" ]; then
      VDCE_STOP=1
      echo "INFO  a connector call answered HTTP 429: the section sends the connector nothing more (the keyless allowance or its minute is spent)"
    fi
    sleep "$VDCE_GAP"
  }

  # ── CE1: the handshake revisions and the current revision's headers ──
  VDCE_I=0
  for VDCE_V in 2024-11-05 2025-03-26 2025-06-18 2025-11-25 2099-01-01; do
    VDCE_I=$((VDCE_I+1))
    vdce_mc "/tmp/vd_ce_init_$VDCE_V.json" "{\"jsonrpc\":\"2.0\",\"id\":1$VDCE_I,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"$VDCE_V\",\"capabilities\":{},\"clientInfo\":{\"name\":\"verify-deploy\",\"version\":\"1\"}}}"
  done
  curl -s -m 30 -D /tmp/vd_ce_cors.h -o /dev/null -X OPTIONS "$VDCE_MCP" -H "apikey: $K" -H "Origin: http://localhost:6274" \
    -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: mcp-method, mcp-name"

  # ── CE2: a 2026-07-28 client ──
  if [ "$VDCE_STOP" != 1 ]; then
    curl -s -m 60 -X POST "$VDCE_MCP" -D /tmp/vd_ce_discover.json.h -o /tmp/vd_ce_discover.json -w '%{http_code}' \
      -H "Content-Type: application/json" -H "apikey: $K" -H "x-rb-budget: probe" \
      -H "MCP-Protocol-Version: 2026-07-28" -H "Mcp-Method: server/discover" \
      -d '{"jsonrpc":"2.0","id":21,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}' > /tmp/vd_ce_discover.json.code
    vdce_after /tmp/vd_ce_discover.json
    if [ "$VDCE_STOP" != 1 ] && node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j&&j.result&&j.result.resultType==="complete"?0:1)}catch{process.exit(1)}' /tmp/vd_ce_discover.json; then
      curl -s -m 60 -X POST "$VDCE_MCP" -o /tmp/vd_ce_oldmeta.json -w '%{http_code}' \
        -H "Content-Type: application/json" -H "apikey: $K" -H "x-rb-budget: probe" \
        -H "MCP-Protocol-Version: 1900-01-01" -H "Mcp-Method: tools/list" \
        -d '{"jsonrpc":"2.0","id":22,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"1900-01-01"}}}' > /tmp/vd_ce_oldmeta.json.code
      vdce_after /tmp/vd_ce_oldmeta.json
    fi
  fi

  # ── CE3: refusals in band, uncounted ──
  vdce_mc /tmp/vd_ce_r_page.json '{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"nurse","page":2}}}'
  vdce_mc /tmp/vd_ce_r_atlantis.json '{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"nurse","country":"Atlantis"}}}'
  vdce_mc /tmp/vd_ce_r_georgia.json '{"jsonrpc":"2.0","id":33,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"nurse","location":"Atlanta","country":"Georgia"}}}'
  vdce_mc /tmp/vd_ce_r_type.json '{"jsonrpc":"2.0","id":34,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"nurse","employmentType":"sometimes"}}}'
  vdce_mc /tmp/vd_ce_r_age.json '{"jsonrpc":"2.0","id":35,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"nurse","maxAgeDays":0}}}'

  # ── CE4: the listing and key_status, uncounted ──
  vdce_mc /tmp/vd_ce_list_none.json '{"jsonrpc":"2.0","id":41,"method":"tools/list","params":{}}'
  vdce_mc /tmp/vd_ce_list_junk.json '{"jsonrpc":"2.0","id":42,"method":"tools/list","params":{}}' -H "Authorization: Bearer not-a-key"
  vdce_mc /tmp/vd_ce_keystatus.json '{"jsonrpc":"2.0","id":43,"method":"tools/call","params":{"name":"key_status","arguments":{}}}'

  # ── CE12: the guide, uncounted ──
  vdce_mc /tmp/vd_ce_guide.json '{"jsonrpc":"2.0","id":121,"method":"resources/read","params":{"uri":"resumebooster://guide"}}'

  # The revoked key, only once the API itself calls it revoked.
  VDCE_REV_OK=0
  if [ -n "$VDCE_REV" ]; then
    VDCE_RC=$(curl -s -m 60 -o /tmp/vd_ce_revcheck.json -w '%{http_code}' "$VDCE_PA/v1/stats" -H "Authorization: Bearer $VDCE_REV" -H "apikey: $K")
    VDCE_RE=$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).error.code))}catch{process.stdout.write("?")}' /tmp/vd_ce_revcheck.json)
    if [ "$VDCE_RC" = 403 ] && [ "$VDCE_RE" = key_revoked ]; then VDCE_REV_OK=1; fi
  fi

  # ── CE5, CE6, CE7, CE11: the counted calls, only when asked for ──
  VDCE_KEYLESS=0
  if [ "${VERIFY_KEYLESS_CALLS:-0}" = 1 ]; then
    VDCE_KEYLESS=1
    vdce_mc /tmp/vd_ce_s5.json '{"jsonrpc":"2.0","id":51,"method":"tools/call","params":{"name":"search_jobs","arguments":{"keyword":"Recruiter","country":"Ireland","limit":50,"location":null,"sort":"","colour":"red"}}}'
    if [ "$VDCE_STOP" != 1 ]; then
      J '{"action":"list","q":"Manager","country":"IT","countOnly":true}' > /tmp/vd_ce_count_all.json
      J '{"action":"list","q":"Manager","country":"IT","vendor":"smartrecruiters","countOnly":true}' > /tmp/vd_ce_count_sr.json
    fi
    if [ "$VDCE_REV_OK" = 1 ]; then
      vdce_mc /tmp/vd_ce_s6.json '{"jsonrpc":"2.0","id":61,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"Manager","country":"IT","limit":10}}}' -H "Authorization: Bearer $VDCE_REV"
    else
      vdce_mc /tmp/vd_ce_s6.json '{"jsonrpc":"2.0","id":61,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"Manager","country":"IT","limit":10}}}'
    fi
    vdce_mc /tmp/vd_ce_s7.json '{"jsonrpc":"2.0","id":71,"method":"tools/call","params":{"name":"employer_growth","arguments":{"company":"Anthropic"}}}'
    # Two ids from CE6's page (else CE5's), as one comma-separated string.
    VDCE_IDS=$(node -e 'const fs=require("fs");const ids=[];for(const f of process.argv.slice(1)){try{const j=JSON.parse(fs.readFileSync(f,"utf8"));const s=j.result.structuredContent||JSON.parse(j.result.content[0].text);for(const c of s.jobs||[])if(c&&typeof c.id==="string"&&/^[a-z0-9_-]+:[^\s,"\\]+:[^\s,"\\]+$/.test(c.id)&&!ids.includes(c.id))ids.push(c.id)}catch{}}process.stdout.write(ids.slice(0,2).join(", "))' /tmp/vd_ce_s6.json /tmp/vd_ce_s5.json)
    case "$VDCE_IDS" in
      *", "*) vdce_mc /tmp/vd_ce_s11.json "{\"jsonrpc\":\"2.0\",\"id\":111,\"method\":\"tools/call\",\"params\":{\"name\":\"check_jobs_open\",\"arguments\":{\"ids\":\"$VDCE_IDS\"}}}" ;;
    esac
  fi

  # ── CE8: the API with no key (unmetered), and the revoked key in x-api-key ──
  VDCE_DOC=$(curl -s -m 60 -o /tmp/vd_ce_doc.json -w '%{http_code}' "$VDCE_PA/v1/openapi.json" -H "apikey: $K")
  VDCE_NOPE=$(curl -s -m 60 -o /tmp/vd_ce_nope.json -w '%{http_code}' "$VDCE_PA/v1/no-such-path" -H "apikey: $K")
  VDCE_JOBS=$(curl -s -m 60 -D /tmp/vd_ce_jobs401.h -o /tmp/vd_ce_jobs401.json -w '%{http_code}' "$VDCE_PA/v1/jobs?limit=1" -H "apikey: $K")
  VDCE_ROOT=$(curl -s -m 60 -o /tmp/vd_ce_root.json -w '%{http_code}' "$VDCE_PA/v1" -H "apikey: $K")
  VDCE_HEAD=$(curl -s -m 60 -I -o /dev/null -w '%{http_code}' "$VDCE_PA/v1" -H "apikey: $K")
  VDCE_XREV=""
  if [ "$VDCE_REV_OK" = 1 ]; then
    VDCE_XREV=$(curl -s -m 60 -o /tmp/vd_ce_xrev.json -w '%{http_code}' "$VDCE_PA/v1/stats" -H "x-api-key: $VDCE_REV" -H "apikey: $K")
  fi

  # ── CE9: the API with a fresh key in x-api-key ──
  VDCE_K9=0
  if [ -n "$VDCE_FRESH" ]; then
    VDCE_K9=1
    VDCE_IE=$(curl -s -m 60 -o /tmp/vd_ce_k_ie.json -w '%{http_code}' "$VDCE_PA/v1/jobs?country=Ireland&limit=5" -H "x-api-key: $VDCE_FRESH" -H "apikey: $K")
    VDCE_AT=$(curl -s -m 60 -o /tmp/vd_ce_k_at.json -w '%{http_code}' "$VDCE_PA/v1/jobs?country=Atlantis&limit=5" -H "x-api-key: $VDCE_FRESH" -H "apikey: $K")
    VDCE_CO=$(curl -s -m 60 -o /tmp/vd_ce_k_co.json -w '%{http_code}' "$VDCE_PA/v1/companies?limit=500" -H "x-api-key: $VDCE_FRESH" -H "apikey: $K")
  fi

  VDCE_KEYLESS="$VDCE_KEYLESS" VDCE_REV_OK="$VDCE_REV_OK" VDCE_K9="$VDCE_K9" VDCE_STOP="$VDCE_STOP" \
  VDCE_DOC="$VDCE_DOC" VDCE_NOPE="$VDCE_NOPE" VDCE_JOBS="$VDCE_JOBS" VDCE_ROOT="$VDCE_ROOT" VDCE_HEAD="$VDCE_HEAD" VDCE_XREV="$VDCE_XREV" \
  VDCE_IE="${VDCE_IE:-}" VDCE_AT="${VDCE_AT:-}" VDCE_CO="${VDCE_CO:-}" VDCE_IDS="${VDCE_IDS:-}" \
  node - /tmp/vd_ce_ <<'NODE'
const fs = require("fs");
const P = process.argv[2];
const E = process.env;
const say = (v, m) => console.log(`${v}  ${m}`);
const raw = (f) => { try { return fs.readFileSync(P + f, "utf8"); } catch { return ""; } };
const rd = (f) => { try { return JSON.parse(raw(f)); } catch { return null; } };
const code = (f) => raw(`${f}.code`).trim();
const hdr = (f, name) => {
  const line = raw(f).replace(/\r/g, "").split("\n").find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line === undefined ? null : line.slice(line.indexOf(":") + 1).trim();
};
const short = (x) => JSON.stringify(x === undefined ? null : x).slice(0, 180);
// A tool's answer: { isError, data (its structured content, or its JSON text
// block read), text, first (the first line of its first text block) }. Under
// owner D3 a not-applied line may come as a plain text block ahead of the JSON.
const tool = (f) => {
  const j = rd(f);
  if (!j || !j.result) return null;
  const blocks = Array.isArray(j.result.content) ? j.result.content.map((b) => (b && typeof b.text === "string" ? b.text : "")) : [];
  const text = blocks.join("\n");
  let data = j.result.structuredContent || null;
  if (!data) { for (const b of blocks) { if (b.trimStart().startsWith("{")) { try { data = JSON.parse(b); break; } catch { /* the next block */ } } } }
  return { isError: j.result.isError === true, data, text: `${text} ${JSON.stringify(j.result.structuredContent || "")}`, first: (blocks[0] || "").split("\n")[0] };
};
const stopped = E.VDCE_STOP === "1";
// A call that was never sent (the section stopped at a 429), or that itself
// answered 429 (the shared keyless allowance or its minute was spent), is not
// judged: INFO. A refusal that answered 429 is judged (CE3: it was metered).
const unsent = (key, f) => {
  if (code(f) === "429") { say("INFO", `${key} answered HTTP 429: the keyless allowance or its minute is spent, so it is not judged`); return true; }
  if (stopped && !raw(f)) { say("INFO", `${key} not sent: the section stopped calling the connector at a 429`); return true; }
  return false;
};
const ISO = /^\d{4}-\d{2}-\d{2}T/;
const WITHHELD = /^smartrecruiters:/i;

// CE1
const init = {};
for (const v of ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2099-01-01"]) {
  const j = rd(`init_${v}.json`);
  init[v] = j && j.result ? j.result.protocolVersion : null;
}
const initSpent = Object.keys(init).find((v) => code(`init_${v}.json`) === "429" || (stopped && !raw(`init_${v}.json`)));
if (initSpent) say("INFO", `CE1 initialize not judged: asking ${initSpent} answered HTTP 429 or was never sent (the section stopped calling the connector)`);
else {
  const wrong = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].filter((v) => init[v] !== v);
  if (wrong.length || init["2099-01-01"] !== "2025-11-25") {
    say("FAIL", `CE1 initialize answered ${short(init)} (want each of 2024-11-05, 2025-03-26, 2025-06-18 and 2025-11-25 as asked, and 2025-11-25 to 2099-01-01)`);
  } else {
    say("PASS", "CE1 initialize answers 2024-11-05, 2025-03-26, 2025-06-18 and 2025-11-25 as asked, and 2025-11-25 to a revision it does not speak");
  }
}
const allow = (hdr("cors.h", "access-control-allow-headers") || "").toLowerCase().split(",").map((x) => x.trim());
if (allow.includes("mcp-method") && allow.includes("mcp-name")) say("PASS", "CE1 a preflight from http://localhost:6274 allows mcp-method and mcp-name");
else say("FAIL", `CE1 a preflight from http://localhost:6274 allows ${short(allow.join(", "))} (want mcp-method and mcp-name, so a 2026-07-28 client in a browser reaches the server)`);

// CE2
if (!unsent("CE2 server/discover", "discover.json")) {
  const st = code("discover.json");
  const d = rd("discover.json");
  const c = d && d.error ? d.error.code : null;
  if (st === "200" && d && d.result && d.result.resultType === "complete" && Array.isArray(d.result.supportedVersions) && d.result.supportedVersions.includes("2026-07-28")) {
    const o = rd("oldmeta.json");
    if (code("oldmeta.json") === "400" && o && o.error && o.error.code === -32022) say("PASS", "CE2 server/discover is served in the 2026-07-28 shape, and a _meta version of 1900-01-01 answers HTTP 400 with -32022");
    else say("FAIL", `CE2 server/discover is served, but a _meta version of 1900-01-01 answered HTTP ${code("oldmeta.json") || "none"} ${short(o && o.error)} (want 400 with -32022)`);
  } else if (st === "400" && typeof c === "number" && ![-32022, -32020, -32601].includes(c)) {
    say("PASS", `CE2 a 2026-07-28 client is answered HTTP 400 with ${c} (${short(d.error.message)}): the fallback a dual-era client reads as "send initialize"`);
  } else {
    say("FAIL", `CE2 server/discover in the 2026-07-28 shape answered HTTP ${st || "none"} ${short(d && (d.error || d.result))} (want 200 with resultType complete, or 400 with a code other than -32022, -32020 and -32601)`);
  }
}

// CE3
const refusals = [
  ["page.json", "{query: nurse, page: 2}", [/offset/]],
  ["atlantis.json", "{country: Atlantis}", [/Atlantis/]],
  ["georgia.json", "{location: Atlanta, country: Georgia}", [/\bGE\b/, /\bUS\b/]],
  ["type.json", "{employmentType: sometimes}", [/full_time/]],
  ["age.json", "{maxAgeDays: 0}", [/postedAfter/]],
];
for (const [f, what, want] of refusals) {
  if (code(`r_${f}`) === "429") { say("FAIL", `CE3 search_jobs ${what} answered HTTP 429: it went through the meter, and a refusal must come before it`); continue; }
  if (unsent(`CE3 ${what}`, `r_${f}`)) continue;
  const t = tool(`r_${f}`);
  const counted = hdr(`r_${f}.h`, "x-unkeyed-remaining");
  if (!t) say("FAIL", `CE3 search_jobs ${what} answered no tool result: HTTP ${code(`r_${f}`) || "none"} ${short(raw(`r_${f}`))}`);
  else if (!t.isError || !want.every((re) => re.test(t.text))) say("FAIL", `CE3 search_jobs ${what} answered ${t.isError ? "an error" : "a page"} naming ${want.filter((re) => !re.test(t.text)).map(String).join(", ") || "what it should"} not: ${short(t.text)}`);
  else if (counted !== null) say("FAIL", `CE3 search_jobs ${what} was refused but counted (X-Unkeyed-Remaining: ${counted}): a refusal must come before the meter`);
  else say("PASS", `CE3 search_jobs ${what} is refused in band, uncounted, naming ${want.map((re) => String(re).replace(/\\b|\//g, "")).join(" and ")}`);
}

// CE4
const names = (f) => { const j = rd(f); return j && j.result && Array.isArray(j.result.tools) ? j.result.tools.map((t) => t && t.name).sort() : null; };
const initAny = rd("init_2025-06-18.json") || rd("init_2025-11-25.json");
const signIn = initAny && initAny.result && initAny.result._meta && initAny.result._meta["work.resumebooster/sign-in"] ? initAny.result._meta["work.resumebooster/sign-in"].state : "unknown";
if (!unsent("CE4 tools/list", "list_none.json")) {
  const a = names("list_none.json"), b = names("list_junk.json");
  if (!a || !b) say("FAIL", `CE4 tools/list answered no tool list: ${short(raw(a ? "list_junk.json" : "list_none.json"))}`);
  else if (signIn === "on") say("INFO", `CE4 sign-in is on: an unsigned listing may show the keyed tools (no key ${a.length}, a bearer that is no key ${b.length})`);
  else if (JSON.stringify(a) !== JSON.stringify(b) || a.includes("key_status") || a.length !== 10) say("FAIL", `CE4 tools/list lists ${a.length} with no Authorization and ${b.length} with a bearer that is no key (${b.filter((n) => !a.includes(n)).join(", ") || "same names"}${a.includes("key_status") ? "; key_status listed with no key" : ""}): want the same ten keyless names, without key_status`);
  else say("PASS", `CE4 tools/list lists the same ten keyless tools with no Authorization and with a bearer that is no key, without key_status`);
}
if (!unsent("CE4 key_status", "keystatus.json")) {
  const t = tool("keystatus.json");
  const st = code("keystatus.json");
  if (st === "401" && signIn === "on") say("INFO", "CE4 key_status with no key answered the sign-in challenge: sign-in is on, and the challenge is how the host shows its Connect card");
  else if (!t || t.isError) say("FAIL", `CE4 key_status with no key answered ${t ? "isError" : `HTTP ${st || "none"}`}: ${short(t ? t.text : raw("keystatus.json"))} (want an answer: what a keyless caller has)`);
  else {
    const k = t.data && t.data.key, kl = t.data && t.data.keyless;
    const per = kl && kl.lookupsPerDay;
    if (!k || k.tier !== "none" || !(Number.isInteger(per) && per > 0)) say("FAIL", `CE4 key_status with no key answered key ${short(k)} and keyless.lookupsPerDay ${short(per)} (want tier none and a positive whole number)`);
    else say("PASS", `CE4 key_status with no key is an answer: key.tier none, ${per} lookups a day`);
  }
}

// CE5 and CE6, and freshness on both.
const fresh = [];
const freshOf = (key, d) => {
  if (!d) return;
  const ff = d.feedFreshness;
  if (ff === undefined) { fresh.push([key, null]); return; }
  const bad = [];
  if (!(typeof ff.p50Minutes === "number" && ff.p50Minutes >= 0)) bad.push(`p50Minutes ${short(ff.p50Minutes)}`);
  if (!(typeof ff.p95Minutes === "number" && ff.p95Minutes >= ff.p50Minutes)) bad.push(`p95Minutes ${short(ff.p95Minutes)}`);
  const at = Date.parse(String(ff.asOf));
  if (!ISO.test(String(ff.asOf)) || !Number.isFinite(at) || at > Date.now() + 60_000) bad.push(`asOf ${short(ff.asOf)}`);
  fresh.push([key, bad]);
};
if (E.VDCE_KEYLESS !== "1") {
  say("INFO", "CE5, CE6, CE7 and CE11 (and the freshness line) are not run: VERIFY_KEYLESS_CALLS=1 runs them, four of today's shared keyless allowance");
} else {
  if (!unsent("CE5", "s5.json")) {
    const t = tool("s5.json");
    if (!t || t.isError) {
      say("FAIL", `CE5 search_jobs {keyword: Recruiter, country: Ireland, limit: 50, location: null, sort: '', colour: red} answered ${t ? "isError" : `HTTP ${code("s5.json") || "none"}`}: ${short(t ? t.text : raw("s5.json"))} (a null and an empty string are not sent, and a name the tool does not take is answered without)`);
      say("FAIL", `CE5d search_jobs refused colour, or did not answer: owner D3 says a name a search tool does not take is answered without it, said first and counted, never refused in this lane`);
    } else {
      // CE5d: colour is not applied, said on the first line, and listed (D3).
      {
        const d = t.data || {};
        const LINE = /^search_jobs does not take "colour", so it was not applied\. It takes: query, /;
        const why = [];
        if (!LINE.test(t.first)) why.push(`the first line is ${short(t.first.slice(0, 120))}`);
        if (!Array.isArray(d.notApplied) || !LINE.test(String(d.notApplied[0] || ""))) why.push(`notApplied ${short(d.notApplied)}`);
        if (!Array.isArray(d.ignoredArguments) || !d.ignoredArguments.includes("colour")) why.push(`ignoredArguments ${short(d.ignoredArguments)}`);
        if (why.length) say("FAIL", `CE5d colour, a name search_jobs does not take, was answered without a word of it: ${why.join("; ")} (want the first line to say it was not applied, notApplied, and ignoredArguments naming it)`);
        else say("PASS", "CE5d colour, a name search_jobs does not take, is not refused: the first line says it was not applied and names what the tool takes, and ignoredArguments lists it");
      }
      const d = t.data || {};
      const jobs = Array.isArray(d.jobs) ? d.jobs : [];
      const why = [];
      if (!d.argumentsRead || d.argumentsRead.keyword !== "query") why.push(`argumentsRead ${short(d.argumentsRead)}`);
      if (!d.countryRead || d.countryRead.Ireland !== "IE") why.push(`countryRead ${short(d.countryRead)}`);
      const off = jobs.filter((j) => j.country !== "IE");
      if (off.length) why.push(`${off.length} of ${jobs.length} cards outside IE (${short(off[0] && off[0].country)})`);
      if (!(typeof d.total === "number" && d.total < 1000)) why.push(`total ${short(d.total)}`);
      if (d.limitApplied !== 10 || d.limitAsked !== 50 || !/nextOffset/.test(String(d.limitNote || ""))) why.push(`limitAsked ${short(d.limitAsked)}, limitApplied ${short(d.limitApplied)}, limitNote ${short(d.limitNote)}`);
      // A short page is owed a reason only when it withheld rows: a first read
      // that drops nothing is never refilled and carries none (CE6's rule).
      const withheld = Number(d.withheld || 0);
      if (jobs.length < 10 && d.hasMore === true && withheld >= 1 && !d.pageShortBecause) why.push(`${jobs.length} rows with hasMore true and withheld ${withheld}, and no pageShortBecause`);
      const held = jobs.filter((j) => WITHHELD.test(String(j.id)));
      if (held.length) why.push(`withheld ids ${held.map((j) => j.id).slice(0, 2).join(", ")}`);
      if (why.length) say("FAIL", `CE5 the Recruiter-in-Ireland call: ${why.join("; ")}`);
      else if (!jobs.length) say("INFO", "CE5 the Recruiter-in-Ireland call answered no row: read as query, Ireland as IE and the cap said, but there is no card to judge");
      else say("PASS", `CE5 keyword read as query, Ireland as IE on all ${jobs.length} cards, total ${d.total}, limit 50 cut to 10 and said, no withheld id`);
      freshOf("CE5", d);
    }
  }
  if (!unsent("CE6", "s6.json")) {
    const t = tool("s6.json");
    const rev = E.VDCE_REV_OK === "1";
    if (!t || t.isError) say("FAIL", `CE6 search_jobs {query: Manager, country: IT, limit: 10}${rev ? " with the revoked key" : ""} answered ${t ? "isError" : `HTTP ${code("s6.json") || "none"}`}: ${short(t ? t.text : raw("s6.json"))}`);
    else {
      const d = t.data || {};
      const jobs = Array.isArray(d.jobs) ? d.jobs : [];
      const withheld = Number(d.withheld || 0);
      const why = [], info = [];
      const held = jobs.filter((j) => WITHHELD.test(String(j.id)));
      if (held.length) why.push(`SmartRecruiters ids handed on: ${held.map((j) => j.id).slice(0, 2).join(", ")}`);
      const isShort = jobs.length < 10 && d.hasMore === true;
      if (isShort && withheld >= 1 && !d.pageShortBecause) why.push(`${jobs.length} rows with hasMore true and withheld ${withheld}, and no pageShortBecause`);
      if (d.pageShortBecause === "refill_limit" && !(Number(d.refillReads) >= 2)) why.push(`pageShortBecause refill_limit after ${short(d.refillReads)} refill reads`);
      if (isShort && d.pageShortBecause) info.push(`short page (${jobs.length}) with a stated reason: ${d.pageShortBecause}`);
      if (withheld >= 1 && d.withheldTotal === undefined && d.totalIncludesWithheld !== true) why.push(`withheld ${withheld} and neither withheldTotal nor totalIncludesWithheld`);
      const all = rd("count_all.json"), sr = rd("count_sr.json");
      if (typeof d.withheldTotal === "number") {
        if (!sr || typeof sr.total !== "number" || !all || typeof all.total !== "number") info.push("the board's own counts did not answer, so withheldTotal is not compared");
        else {
          if (Math.abs(d.withheldTotal - sr.total) > 3) why.push(`withheldTotal ${d.withheldTotal} against the board's SmartRecruiters count ${sr.total}`);
          if (Math.abs(d.total + d.withheldTotal - all.total) > 3) why.push(`total ${d.total} + withheldTotal ${d.withheldTotal} against the board's all-source count ${all.total}`);
        }
      }
      if (d.totalIncludesWithheld === true) info.push("totalIncludesWithheld: the count read was late or not allowed");
      if (rev && !/revoked/i.test(String((d.unkeyed && d.unkeyed.keyNote) || ""))) why.push(`unkeyed.keyNote ${short(d.unkeyed && d.unkeyed.keyNote)} does not name revoked`);
      if (why.length) say("FAIL", `CE6 the Manager-in-Italy call: ${why.join("; ")}`);
      else if (!jobs.length) say("INFO", "CE6 the Manager-in-Italy call answered no row: nothing to judge");
      else say("PASS", `CE6 ${jobs.length} rows (withheld ${withheld}${d.refillReads ? `, ${d.refillReads} refill reads` : ""}), no SmartRecruiters id, total ${d.total}${typeof d.withheldTotal === "number" ? ` beside withheldTotal ${d.withheldTotal}` : ""}${rev ? "; the revoked key got the keyless answer and a note naming revoked" : ""}`);
      for (const m of info) say("INFO", `CE6 ${m}`);
      if (!rev) say("INFO", "CE6 no key confirmed revoked (RB_REVOKED_KEY or .env.local's RB_API_KEY answering 403 key_revoked): the call went with no key");
      freshOf("CE6", d);
    }
  }
  // CE5+CE6 freshness
  if (fresh.length) {
    const bad = fresh.filter(([, b]) => Array.isArray(b) && b.length);
    const absent = fresh.filter(([, b]) => b === null);
    if (bad.length) say("FAIL", `CE5+6 feedFreshness: ${bad.map(([k, b]) => `${k} ${b.join(", ")}`).join("; ")}`);
    else if (absent.length === fresh.length) say("FAIL", `CE5+6 no search answer carries feedFreshness (${fresh.map(([k]) => k).join(", ")})`);
    else {
      say("PASS", `CE5+6 feedFreshness is on ${fresh.length - absent.length} of ${fresh.length} search answers, each a measured age with its time`);
      if (absent.length) say("INFO", `CE5+6 feedFreshness absent from ${absent.map(([k]) => k).join(", ")}: the rollup read missed its 250 ms`);
    }
  }
  if (!unsent("CE7", "s7.json")) {
    const t = tool("s7.json");
    if (!t || t.isError) say("FAIL", `CE7 employer_growth {company: Anthropic} answered ${t ? "isError" : `HTTP ${code("s7.json") || "none"}`}: ${short(t ? t.text : raw("s7.json"))}`);
    else {
      const rows = (t.data && Array.isArray(t.data.employers)) ? t.data.employers : [];
      const hit = rows.find((r) => r && r.company_token === "anthropic" && r.asked === "Anthropic");
      const unresolved = rows.find((r) => r && r.unknown_reason === "name_not_resolved" && Array.isArray(r.candidates));
      if (hit) say("PASS", `CE7 employer_growth asked by name answers the anthropic board (asked Anthropic${hit.resolvedFrom ? `, resolvedFrom ${hit.resolvedFrom}` : ""}, verdict ${short(hit.verdict)})`);
      else if (unresolved) say("INFO", `CE7 the board placed no board for Anthropic: a name_not_resolved row with ${unresolved.candidates.length} candidates (nothing to judge)`);
      else say("FAIL", `CE7 employer_growth {company: Anthropic} has no row for company_token anthropic with asked Anthropic: ${short(rows)}`);
    }
  }
  if (!String(E.VDCE_IDS || "").includes(", ")) say("INFO", "CE11 not sent: CE6 and CE5 gave fewer than two ids");
  else if (!unsent("CE11", "s11.json")) {
    const ids = E.VDCE_IDS.split(", ");
    const t = tool("s11.json");
    const d = t && t.data;
    const closed = d && Array.isArray(d.closed) ? d.closed.map((x) => (typeof x === "string" ? x : x && x.id)) : [];
    if (!t || t.isError) say("FAIL", `CE11 check_jobs_open with two ids as one string answered ${t ? "isError" : `HTTP ${code("s11.json") || "none"}`}: ${short(t ? t.text : raw("s11.json"))}`);
    else if (d.checked !== 2 || ids.some((id) => closed.includes(id)) || closed.some((c) => String(c).includes(","))) say("FAIL", `CE11 check_jobs_open with "${ids.join(", ")}" checked ${short(d.checked)} and closed ${short(closed)} (want 2 checked, neither closed)`);
    else say("PASS", "CE11 two ids sent as one comma-separated string are checked as two, and neither is called closed");
  }
}

// CE8
{
  const doc = rd("doc.json");
  if (E.VDCE_DOC === "200" && doc && /^3\.1/.test(String(doc.openapi || "")) && doc.paths && doc.paths["/v1/jobs"]) say("PASS", `CE8 GET /v1/openapi.json with no key answers the OpenAPI ${doc.openapi} document, /v1/jobs among its paths`);
  else say("FAIL", `CE8 GET /v1/openapi.json with no key answered HTTP ${E.VDCE_DOC || "none"} ${short(doc && (doc.error || doc.openapi))} (want 200, openapi 3.1, a /v1/jobs path)`);
  const nope = rd("nope.json");
  if (E.VDCE_NOPE === "404" && nope && nope.error && nope.error.code === "no_such_endpoint") say("PASS", "CE8 GET /v1/no-such-path with no key answers 404 no_such_endpoint, before any key is read");
  else say("FAIL", `CE8 GET /v1/no-such-path with no key answered HTTP ${E.VDCE_NOPE || "none"} ${short(nope && nope.error)} (want 404 no_such_endpoint)`);
  const j401 = raw("jobs401.json");
  const www = hdr("jobs401.h", "www-authenticate");
  if (E.VDCE_JOBS === "401" && www && /^Bearer/i.test(www) && j401.includes("https://resumebooster.work/data-api") && /x-api-key/.test(j401)) say("PASS", "CE8 GET /v1/jobs with no key answers 401 with WWW-Authenticate and a body naming the data-api page and x-api-key");
  else say("FAIL", `CE8 GET /v1/jobs with no key answered HTTP ${E.VDCE_JOBS || "none"}, WWW-Authenticate ${short(www)}, body ${short(j401.slice(0, 160))} (want 401, the header, the data-api page and x-api-key)`);
  const root = rd("root.json");
  const offered = root && root.keylessSample ? root.keylessSample.offered : undefined;
  const keylessServed = E.VDCE_JOBS === "200";
  if (E.VDCE_ROOT === "200" && root && root.getAKey && root.getAKey.url && root.openapi && typeof offered === "boolean" && offered === keylessServed) say("PASS", `CE8 GET /v1 names getAKey (${root.getAKey.url}), openapi (${root.openapi}) and keylessSample.offered ${offered}, which is what the keyless /v1/jobs did`);
  else say("FAIL", `CE8 GET /v1 answered HTTP ${E.VDCE_ROOT || "none"} with getAKey ${short(root && root.getAKey && root.getAKey.url)}, openapi ${short(root && root.openapi)}, keylessSample.offered ${short(offered)} while a keyless /v1/jobs answered ${E.VDCE_JOBS || "none"}`);
  if (E.VDCE_HEAD === "200") say("PASS", "CE8 HEAD /v1 answers 200");
  else say("FAIL", `CE8 HEAD /v1 answered HTTP ${E.VDCE_HEAD || "none"} (want 200: HEAD is answered as GET with no body)`);
  if (E.VDCE_REV_OK !== "1") say("INFO", "CE8 no key confirmed revoked: the x-api-key half is not judged");
  else {
    const x = rd("xrev.json");
    if (E.VDCE_XREV === "403" && x && x.error && x.error.code === "key_revoked") say("PASS", "CE8 the revoked key sent in x-api-key with no Authorization is read and refused 403 key_revoked");
    else say("FAIL", `CE8 the revoked key sent in x-api-key answered HTTP ${E.VDCE_XREV || "none"} ${short(x && x.error)} (want 403 key_revoked: x-api-key is read)`);
  }
}

// CE9
if (E.VDCE_K9 !== "1") {
  say("INFO", "CE9 not run: RB_API_KEY_FRESH is not set, so the keyed /v1 halves (a country by name, coverage.feedFreshness, the cap) are judged by unit tests only. OWNER: mint a confirmed free key at https://resumebooster.work/data-api and export it as RB_API_KEY_FRESH");
} else {
  const ie = rd("k_ie.json");
  const rows = ie && Array.isArray(ie.data) ? ie.data : null;
  const cr = ie && ie.disclosures && ie.disclosures.countryRead;
  const crIE = cr && ((cr.read && cr.read.Ireland) || cr.Ireland);
  const ff = ie && ie.coverage && ie.coverage.feedFreshness;
  const why = [];
  if (E.VDCE_IE !== "200" || !rows) why.push(`HTTP ${E.VDCE_IE || "none"} ${short(ie && ie.error)}`);
  else {
    if (rows.some((r) => r.country !== "IE")) why.push(`rows outside IE (${short(rows.find((r) => r.country !== "IE").country)})`);
    if (crIE !== "IE") why.push(`disclosures.countryRead ${short(cr)}`);
    if (!ff || !ISO.test(String(ff.asOf || ""))) why.push(`coverage.feedFreshness ${short(ff)}`);
  }
  if (why.length) say("FAIL", `CE9 /v1/jobs?country=Ireland with the key in x-api-key: ${why.join("; ")}`);
  else if (!rows.length) say("INFO", "CE9 /v1/jobs?country=Ireland answered 200 with no row: countryRead and feedFreshness said, no row to judge");
  else say("PASS", `CE9 /v1/jobs?country=Ireland with the key in x-api-key: ${rows.length} rows in IE, countryRead Ireland IE, feedFreshness as of ${ff.asOf}`);
  const at = rd("k_at.json");
  if (E.VDCE_AT === "400" && /Atlantis/.test(JSON.stringify(at && at.error))) say("PASS", "CE9 /v1/jobs?country=Atlantis answers 400 naming Atlantis");
  else say("FAIL", `CE9 /v1/jobs?country=Atlantis answered HTTP ${E.VDCE_AT || "none"} ${short(at && at.error)} (want 400 naming Atlantis)`);
  const co = rd("k_co.json");
  const cap = co && co.page ? co.page.maxLimit : undefined;
  const lc = co && co.disclosures && co.disclosures.limitCapped;
  if (E.VDCE_CO === "200" && cap === 100 && lc && lc.requested === 500) say("PASS", "CE9 /v1/companies?limit=500 says page.maxLimit 100 and disclosures.limitCapped.requested 500");
  else say("FAIL", `CE9 /v1/companies?limit=500 answered HTTP ${E.VDCE_CO || "none"}, maxLimit ${short(cap)}, limitCapped ${short(lc)} (want 100 and requested 500)`);
}

// CE12
if (!unsent("CE12", "guide.json")) {
  const g = rd("guide.json");
  const text = g && g.result && Array.isArray(g.result.contents) ? g.result.contents.map((c) => c && c.text).join("\n") : "";
  if (!text) say("FAIL", `CE12 resources/read of the guide answered no text: ${short(raw("guide.json"))}`);
  else if (/whose TITLE match/i.test(text) && !(/employer name/i.test(text) && /department/i.test(text))) say("FAIL", "CE12 the guide says total counts postings whose TITLE matches, without naming the employer name and department it also counts");
  else if (!(/employer name/i.test(text) && /department/i.test(text))) say("FAIL", "CE12 the guide does not say what total counts (title, employer name or department)");
  else say("PASS", "CE12 the guide says total counts title, employer name or department matches");
  // The suggestion for a misspelt argument name is argumentDidYouMean; didYouMean
  // is the board's spelling of the search words, a string in the schema.
  if (text && /`notApplied` opens an answer/.test(text) && /`argumentDidYouMean`/.test(text)) say("PASS", "CE12 the guide says notApplied opens an answer sent a name the tool does not take, and that argumentDidYouMean offers the name meant");
  else if (text && /`notApplied` opens an answer/.test(text)) say("FAIL", "CE12 the guide says to resend a misspelt name under the name didYouMean offers, without naming argumentDidYouMean (didYouMean is the board's spelling suggestion for the search words)");
  else if (text) say("FAIL", "CE12 the guide does not say that notApplied opens an answer sent a name the tool does not take (owner D3: such a name is answered without, said first and counted)");
}

// CE13
say("INFO", "CE13 refusals are counted as argument under their tool or unknown in mcp_calls_daily, which is service-role only: the unit test is the judge, and the owner's read-only query is the live read");
say("INFO", "CE13 OWNER, service role: SELECT tool, outcome, calls FROM mcp_connector_report(7) WHERE kind = 'calls' AND outcome IN ('corrected', 'would_refuse') -- searches answered with a name read as another, and searches sent a name they do not take (counted, not refused: D3 switches refusal on only after this 7-day count and a replay of 300 or more real argument shapes); kind 'answered' is every answered call. 20261206130000's own self-check proved both words land at apply time. With VERIFY_KEYLESS_CALLS=1 this section's CE5 adds one would_refuse to search_jobs per run: take the runs out of the count");
NODE
fi
