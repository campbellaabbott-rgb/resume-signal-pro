# shellcheck shell=bash
# ── 99zzzzzzzzzz-api4-od16-federal. OD16: THE U.S. FEDERAL ROWS GO TO /v1 AND
# THE CLAUDE CONNECTOR (branch api4/od16-federal, owner's yes of 2026-11-18).
# USAJOBS leaves the withheld list of /v1 and the connector. A federal row is
# handed on only once the agency's who-may-apply statement is stored
# (job-board .104, migration 20261119110000), with the agency as the employer,
# closes_at, OPM's notice, the official link and the date we read the feed,
# and with no age: our first sighting rides only as on_board_since.
#
# THE CLAIMS, one line each (the key opens the line):
#   FED0  public-api and agent-mcp serve this lane's builds or later (the
#         stamps below; a merge that raises them through deploy-ledger
#         --against raises them here too). Until BOTH do, every other line
#         prints INFO and no keyed or keyless call is made;
#   FED1  the keyless /v1 index lists exactly ["smartrecruiters"] as withheld,
#         and its federal block names OPM's notice and the who_may_apply gate;
#   FED2  (keyed) a /v1/jobs?source=usajobs page: every row carries a
#         who_may_apply statement, a closes_at key, the agency as company
#         (never USAJOBS) with federal.agency equal to it and a usajobs.gov
#         official link, and at least one row a closing date; the body names
#         meta.attribution.federal with OPM's notice, the official site and a
#         retrieval date. A page with no row is INFO: .104's walk labels the
#         federal rows a lap at a time;
#   FED3  (keyed) no federal row prints an age: first_seen null, no age or
#         days key on the row or its federal block, and on_board_since a date;
#   FED4  (keyed) up to four of the board's own federal ids that the page did
#         not serve, asked for one by one: each answers 200 with who_may_apply
#         or 404 saying an open federal announcement waits for its statement,
#         never 200 without one. All of them served is INFO (no unlabelled id
#         in the sample);
#   FED5  (VERIFY_KEYLESS_CALLS=1, two of today's shared keyless allowance)
#         a connector search for a federal title gives federal cards each with
#         federal.whoMayApply and no postedAt, and federalAttribution with
#         OPM's notice; get_job on a SmartRecruiters id answers restricted;
#   INFO  (keyed) the labelled federal rows /v1 serves (federalAgencies on
#         /v1/companies) against the 18,505 the 2026-11-18 report measured;
#   FED6  the site's AI line ("Your AI searches N of M open postings: ...") in
#         the live llms.txt counts no federal posting the AI cannot reach. It
#         names USAJOBS among what stays on this website (the site subtracts
#         every federal posting while FEDERAL_ROWS_IN_REACH is false in
#         src/lib/home/board-figures.ts): PASS once OD16 serves, INFO before,
#         and an INFO saying the flag may flip once the labelled rows reach
#         about the board's federal count. A line that counts federal
#         postings FAILs before OD16 serves (the AI reaches none of them, so
#         this line runs even before FED0 passes), and after it unless the
#         labelled rows (keyed, complete) are at least 98% of the federal
#         count the homepage bake prints;
#   FED7  (keyed, on FED2's page: no further call) coverage.note on /v1/jobs
#         no longer promises every row is live in the feed's last read: it
#         names the federal exception and the agency's closing date;
#   FED8  (keyed) /v1/changes since two days ago: the body says which federal
#         announcements opened[] can never show (federalCoverage), and every
#         federal closure has first_seen null and a federal block with OPM's
#         notice and a usajobs.gov link, every opened federal row its
#         who_may_apply, and the body OPM's credit with a retrieval date.
#         A page with no federal row is INFO for the shape and the credit;
#   FED9  the /agents page as crawlers are served it says federal
#         announcements are handed on (MCP_WITHHELD_NOTE) only while OD16 is
#         serving. Saying it before FED0 passes FAILs: the site was published
#         before the two functions, and agent-mcp still refuses every federal
#         posting (the claim moved runtimes ahead of its subject). A page
#         that still says the feed is withheld by our own choice is INFO: it
#         waits for the frontend publish.
#
# The keyed lines need RB_API_KEY_FRESH (a live confirmed free key the owner
# mints at /data-api; the .env.local key is revoked). Without it they print
# INFO.
#
# READ-ONLY. Two OPTIONS preflights, GETs of the live llms.txt, the homepage
# bake and the /agents bake (as Googlebot, which is served the bake), a GET of the
# keyless /v1 index, keyed GETs of /v1 (the federal page, up to four ids, the
# companies count and one change-feed page, each metered like any customer
# call), job-board list reads
# under x-rb-budget: probe, and, only with VERIFY_KEYLESS_CALLS=1, two
# agent-mcp tool calls (search_jobs and get_job), which read. Keys are sent as
# headers and never printed.
echo "== 99zzzzzzzzzz. OD16: the U.S. federal rows go to /v1 and the Claude connector, labelled, credited and never aged =="

VDFED_PA="$B/functions/v1/public-api"
VDFED_KEY="${RB_API_KEY_FRESH:-}"
# The lane's builds. The merge sets them to max(2026-11-19.1, live + 1).
VDFED_API_DAY=2026-11-19; VDFED_API_N=1
VDFED_MCP_DAY=2026-11-19; VDFED_MCP_N=1
# The federal rows the 2026-11-18 report measured on the board.
VDFED_MEASURED=18505

rm -f /tmp/vd_od16_*

# ── FED0: the builds ──
VDFED_API_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$VDFED_PA/v1" -H "apikey: $K" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: GET" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
VDFED_MCP_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "apikey: $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
VDFED_LIVE=0
if [ -n "$VDFED_API_H" ] && build_ge public-api "$VDFED_API_H" "$VDFED_API_DAY" "$VDFED_API_N" \
  && [ -n "$VDFED_MCP_H" ] && build_ge agent-mcp "$VDFED_MCP_H" "$VDFED_MCP_DAY" "$VDFED_MCP_N"; then
  VDFED_LIVE=1
  echo "PASS  FED0 public-api x-fn-build = $VDFED_API_H and agent-mcp x-fn-build = $VDFED_MCP_H (public-api.$VDFED_API_DAY.$VDFED_API_N and agent-mcp.$VDFED_MCP_DAY.$VDFED_MCP_N or later: OD16 is serving)"
else
  echo "INFO  FED0 public-api x-fn-build = ${VDFED_API_H:-none}, agent-mcp x-fn-build = ${VDFED_MCP_H:-none}: OD16 needs public-api.$VDFED_API_DAY.$VDFED_API_N and agent-mcp.$VDFED_MCP_DAY.$VDFED_MCP_N or later, so every line below prints INFO"
fi

# ── FED1: the keyless /v1 index ──
curl -s -m 30 -o /tmp/vd_od16_index.json "$VDFED_PA/v1"
VDFED_LIVE="$VDFED_LIVE" node - /tmp/vd_od16_index.json <<'NODE'
const fs = require("fs");
const live = process.env.VDFED_LIVE === "1";
const say = (v, m) => console.log(`${v}  ${m}`);
const judge = (ok, pass, fail) => (ok ? say(live ? "PASS" : "INFO", live ? pass : `${pass} (OD16 not serving yet)`) : say(live ? "FAIL" : "INFO", live ? fail : `${fail} (OD16 not serving yet)`));
let ix = null; try { ix = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { /* below */ }
const ex = ix && ix.restrictions && Array.isArray(ix.restrictions.excludedSources) ? ix.restrictions.excludedSources : null;
if (!ex) { judge(false, "", `FED1 the /v1 index answered no restrictions block: ${JSON.stringify(ix).slice(0, 160)}`); process.exit(0); }
judge(JSON.stringify(ex) === JSON.stringify(["smartrecruiters"]),
  `FED1 /v1 restrictions.excludedSources = ${JSON.stringify(ex)}: SmartRecruiters alone is withheld`,
  `FED1 /v1 restrictions.excludedSources = ${JSON.stringify(ex)} (want exactly ["smartrecruiters"]: the federal feed is handed on since OD16)`);
const fed = ix.federal || null;
const notice = String((fed && fed.notice) || "");
judge(!!fed && /not operated, sponsored, approved or endorsed by OPM/.test(notice) && /who_may_apply/.test(String(fed.gate || "")),
  "FED1 the /v1 index states how federal rows are handed on: OPM's notice and the who_may_apply gate",
  `FED1 the /v1 index ${fed ? `names notice "${notice.slice(0, 80)}" and gate "${String(fed.gate || "").slice(0, 80)}"` : "has no federal block"} (want OPM's notice and the who_may_apply gate)`);
NODE

if [ "$VDFED_LIVE" != 1 ]; then
  echo "INFO  FED2-FED5, FED7 and FED8 not run: OD16 is not serving (FED0), so no keyed or keyless call is spent"
else
  # ── FED2-FED4 and the count: keyed ──
  if [ -z "$VDFED_KEY" ]; then
    echo "INFO  FED2, FED3, FED4, FED7, FED8 and the labelled count are not run: RB_API_KEY_FRESH is not set. OWNER: mint a confirmed free key at https://resumebooster.work/data-api and export it as RB_API_KEY_FRESH"
  else
    vdfed_v1() { curl -s -m 60 -o "$2" -w '%{http_code}' "$VDFED_PA$1" -H "Authorization: Bearer $VDFED_KEY" -H "apikey: $K"; }
    VDFED_PAGE=$(vdfed_v1 "/v1/jobs?source=usajobs&limit=25" /tmp/vd_od16_page.json)
    J '{"action":"list","vendor":"usajobs","limit":40}' > /tmp/vd_od16_board.json
    # The ids to ask about: the board's federal ids the page did not serve
    # (the likeliest unlabelled ones), at most four.
    VDFED_IDS=$(node -e 'const fs=require("fs");const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const page=rd(process.argv[1]),board=rd(process.argv[2]);const served=new Set(((page&&page.data)||[]).map((r)=>r&&r.id));
const ids=((board&&board.jobs)||[]).map((j)=>j&&j.id).filter((id)=>typeof id==="string"&&/^usajobs:usajobs:[0-9A-Za-z-]+$/.test(id)&&!served.has(id)).slice(0,4);
process.stdout.write(ids.join(" "))' /tmp/vd_od16_page.json /tmp/vd_od16_board.json)
    VDFED_N=0
    for VDFED_ID in $VDFED_IDS; do
      VDFED_N=$((VDFED_N+1))
      VDFED_C=$(vdfed_v1 "/v1/jobs/$VDFED_ID" "/tmp/vd_od16_one_$VDFED_N.json")
      printf '%s %s\n' "$VDFED_C" "$VDFED_ID" >> /tmp/vd_od16_ones.txt
    done
    vdfed_v1 "/v1/companies?q=usajobs&limit=1" /tmp/vd_od16_companies.json >/dev/null
    # The change feed since two days ago: a free key reaches three days of closures.
    VDFED_SINCE=$(node -e 'process.stdout.write(new Date(Date.now()-2*86400000).toISOString().slice(0,19)+"Z")')
    VDFED_CH=$(vdfed_v1 "/v1/changes?since=$VDFED_SINCE&limit=100" /tmp/vd_od16_changes.json)
    VDFED_PAGE="$VDFED_PAGE" VDFED_CH="$VDFED_CH" VDFED_MEASURED="$VDFED_MEASURED" node - /tmp/vd_od16_ <<'NODE'
const fs = require("fs");
const P = process.argv[2];
const say = (v, m) => console.log(`${v}  ${m}`);
const rd = (f) => { try { return JSON.parse(fs.readFileSync(P + f, "utf8")); } catch { return null; } };
const raw = (f) => { try { return fs.readFileSync(P + f, "utf8"); } catch { return ""; } };
const ISO = /^\d{4}-\d{2}-\d{2}/;
const AGE_KEY = /^(age|days|age_days|posted_days_ago|days_ago)$|Age$|Days$/;

// FED2 and FED3: the page.
const page = rd("page.json");
const code = process.env.VDFED_PAGE;
const rows = page && Array.isArray(page.data) ? page.data : null;
if (code !== "200" || !rows) {
  say("FAIL", `FED2 /v1/jobs?source=usajobs answered HTTP ${code} ${JSON.stringify(page).slice(0, 160)} (want 200 with data: the federal feed is answered since OD16)`);
  say("INFO", "FED3 not judged: the federal page did not answer");
} else if (!rows.length) {
  say("INFO", "FED2 /v1/jobs?source=usajobs answered 200 with no row: no federal announcement has its who-may-apply statement stored yet (.104's walk labels them a lap at a time)");
  say("INFO", "FED3 no federal row to judge for an age");
} else {
  const bad = [];
  for (const r of rows) {
    const f = r.federal || {};
    const why = [];
    if (typeof r.who_may_apply !== "string" || !r.who_may_apply.trim()) why.push("no who_may_apply");
    if (!("closes_at" in r)) why.push("no closes_at key");
    if (typeof r.company !== "string" || !r.company.trim() || /^usajobs$/i.test(r.company.trim())) why.push(`company ${JSON.stringify(r.company)}`);
    if (f.agency !== r.company) why.push(`federal.agency ${JSON.stringify(f.agency)} is not the company`);
    if (!/^https:\/\/(www\.)?usajobs\.gov\//.test(String(f.official_url || ""))) why.push(`official_url ${JSON.stringify(f.official_url)}`);
    if (why.length) bad.push(`${r.id}: ${why.join(", ")}`);
  }
  const closing = rows.filter((r) => typeof r.closes_at === "string" && ISO.test(r.closes_at)).length;
  const fa = page.meta && page.meta.attribution && page.meta.attribution.federal;
  const credit = !!fa && /not operated, sponsored, approved or endorsed by OPM/.test(String(fa.notice || ""))
    && /^https:\/\/www\.usajobs\.gov/.test(String(fa.officialSite || "")) && ISO.test(String(fa.retrievedAt || ""));
  if (bad.length || !closing || !credit) {
    say("FAIL", `FED2 ${rows.length} federal rows: ${bad.length ? bad.slice(0, 3).join("; ") : "each labelled"}; ${closing} with a closing date; meta.attribution.federal ${fa ? JSON.stringify({ notice: String(fa.notice || "").slice(0, 60), officialSite: fa.officialSite, retrievedAt: fa.retrievedAt }) : "absent"}`);
  } else {
    say("PASS", `FED2 ${rows.length} federal rows, each with who_may_apply, closes_at (${closing} dated), the agency as employer (e.g. ${JSON.stringify(rows[0].company)}) and its usajobs.gov link; the body names OPM's notice, the official site and retrievedAt ${fa.retrievedAt}`);
  }
  const aged = [];
  for (const r of rows) {
    const f = r.federal || {};
    const keys = [...Object.keys(r), ...Object.keys(f)].filter((k) => AGE_KEY.test(k));
    if (r.first_seen !== null || keys.length || !ISO.test(String(f.on_board_since || ""))) {
      aged.push(`${r.id}: first_seen ${JSON.stringify(r.first_seen)}, on_board_since ${JSON.stringify(f.on_board_since)}${keys.length ? `, keys ${keys.join(",")}` : ""}`);
    }
  }
  if (aged.length) say("FAIL", `FED3 ${aged.length} of ${rows.length} federal rows print our first sighting as a field or an age: ${aged.slice(0, 2).join("; ")}`);
  else say("PASS", `FED3 none of ${rows.length} federal rows prints an age: first_seen null, on_board_since a date (e.g. ${rows[0].federal.on_board_since})`);
}

// FED7: what the page promises about "live" names the federal exception.
if (code !== "200" || !page) say("INFO", "FED7 not judged: the federal page did not answer");
else {
  const note = String((page.coverage && page.coverage.note) || "");
  if (/U\.S\. federal announcements/.test(note) && /agency's closing date/.test(note)) {
    say("PASS", "FED7 the /v1/jobs coverage note says a federal row is open until the agency's closing date, not that our last read of the feed listed it");
  } else {
    say("FAIL", `FED7 the /v1/jobs coverage note names no federal exception to "still live in the employer's own feed": "${note.slice(0, 160)}"`);
  }
}

// FED8: the change feed says what it cannot open, and shapes and credits a federal row.
const OPM_RE = /not operated, sponsored, approved or endorsed by OPM/;
const ch = rd("changes.json");
const chCode = process.env.VDFED_CH;
if (chCode !== "200" || !ch || !Array.isArray(ch.opened) || !Array.isArray(ch.closed)) {
  say("FAIL", `FED8 /v1/changes answered HTTP ${chCode} ${JSON.stringify(ch).slice(0, 160)} (want 200 with opened and closed)`);
} else {
  const cov = ch.federalCoverage || {};
  if (/never appears in opened\[\]/.test(String(cov.opened || "")) && /federal closure/.test(String(cov.closed || ""))) {
    say("PASS", "FED8 the change feed says which federal announcements opened[] can never show, and what closed[] carries of them (federalCoverage)");
  } else {
    say("FAIL", `FED8 the change feed does not say which federal announcements opened[] cannot show: federalCoverage ${JSON.stringify(ch.federalCoverage || null).slice(0, 160)}`);
  }
  const fc = ch.closed.filter((c) => c && c.source === "usajobs");
  const fo = ch.opened.filter((o) => o && o.source === "usajobs");
  if (!fc.length && !fo.length) {
    say("INFO", `FED8 the change feed since ${ch.since} carried no federal row: the closure's shape and the credit are not judged`);
  } else {
    const bad = [];
    for (const c of fc) {
      const f = c.federal || {};
      const why = [];
      if (c.first_seen !== null) why.push(`first_seen ${JSON.stringify(c.first_seen)}`);
      if (!OPM_RE.test(String(f.notice || ""))) why.push("no OPM notice");
      if (!/^https:\/\/(www\.)?usajobs\.gov\//.test(String(f.official_url || ""))) why.push(`official_url ${JSON.stringify(f.official_url)}`);
      if (why.length) bad.push(`closed ${c.posting_id}: ${why.join(", ")}`);
    }
    for (const o of fo) {
      const why = [];
      if (typeof o.who_may_apply !== "string" || !o.who_may_apply.trim()) why.push("no who_may_apply");
      if (!o.federal || !OPM_RE.test(String(o.federal.notice || ""))) why.push("no OPM notice");
      if (why.length) bad.push(`opened ${o.id}: ${why.join(", ")}`);
    }
    const fa = ch.meta && ch.meta.attribution && ch.meta.attribution.federal;
    const credit = !!fa && OPM_RE.test(String(fa.notice || "")) && ISO.test(String(fa.retrievedAt || ""));
    if (bad.length || !credit) {
      say("FAIL", `FED8 ${fc.length} federal closures and ${fo.length} opened federal rows: ${bad.length ? bad.slice(0, 3).join("; ") : "each shaped"}; meta.attribution.federal ${fa ? JSON.stringify({ notice: String(fa.notice || "").slice(0, 60), retrievedAt: fa.retrievedAt }) : "absent"}`);
    } else {
      say("PASS", `FED8 ${fc.length} federal closures (first_seen null, OPM's notice, the usajobs.gov link) and ${fo.length} opened federal rows (each with who_may_apply); the body names OPM's credit with retrievedAt ${fa.retrievedAt}`);
    }
  }
}

// FED4: the board's own federal ids, one by one.
const ones = raw("ones.txt").split("\n").filter(Boolean).map((l) => { const [c, id] = l.split(" "); return { c, id }; });
if (!ones.length) say("INFO", "FED4 the board's list named no federal id the page did not serve: nothing to ask for");
else {
  const fails = [], held = [], served = [], other = [];
  ones.forEach((o, i) => {
    const b = rd(`one_${i + 1}.json`);
    if (o.c === "200") {
      const d = b && b.data;
      if (d && typeof d.who_may_apply === "string" && d.who_may_apply.trim()) served.push(o.id);
      else fails.push(`${o.id} answered 200 with who_may_apply ${JSON.stringify(d && d.who_may_apply)}`);
    } else if (o.c === "404") {
      const msg = String((b && b.error && b.error.message) || "");
      if (/who may apply/i.test(msg)) held.push(o.id);
      else fails.push(`${o.id} answered 404 without saying an open federal announcement waits for its statement: "${msg.slice(0, 100)}"`);
    } else other.push(`${o.id} HTTP ${o.c}`);
  });
  if (fails.length) say("FAIL", `FED4 ${fails.join("; ")}`);
  else if (held.length) say("PASS", `FED4 ${held.length} of ${ones.length} federal ids the page did not serve answer 404 saying who may apply is not stored yet${served.length ? `, ${served.length} answer 200 with who_may_apply` : ""}; none is served without it`);
  else if (served.length) say("INFO", `FED4 all ${served.length} federal ids asked for answer 200 with who_may_apply: no unlabelled id in the sample to judge the 404 by`);
  if (other.length) say("INFO", `FED4 not judged: ${other.join(", ")}`);
}

// The labelled count.
const co = rd("companies.json");
const fa = co && co.federalAgencies;
if (!fa || !Array.isArray(fa.agencies)) say("INFO", `FED count /v1/companies answered no federalAgencies block: ${JSON.stringify(co).slice(0, 140)}`);
else {
  const n = fa.agencies.reduce((a, x) => a + Number(x.open_postings || 0), 0);
  say("INFO", `FED count ${n.toLocaleString("en-US")} labelled federal rows served across ${fa.agencies.length} agencies (complete: ${fa.complete}, as of ${fa.asOf}), against ${Number(process.env.VDFED_MEASURED).toLocaleString("en-US")} federal rows measured on 2026-11-18`);
}
NODE
  fi

  # ── FED5: the connector, only when asked for ──
  if [ "${VERIFY_KEYLESS_CALLS:-0}" = 1 ]; then
    J '{"action":"list","vendor":"smartrecruiters","limit":1}' > /tmp/vd_od16_sr.json
    VDFED_SR=$(node -e 'let j=null;try{j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{};const r=((j&&j.jobs)||[]).find((x)=>x&&x.source==="smartrecruiters"&&typeof x.id==="string"&&/^[A-Za-z0-9:._~-]+$/.test(x.id));process.stdout.write(r?r.id:"")' /tmp/vd_od16_sr.json)
    MC -d '{"jsonrpc":"2.0","id":51,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"transportation security officer","vendor":"usajobs"}}}' > /tmp/vd_od16_search.json
    if [ -n "$VDFED_SR" ]; then
      MC -d "{\"jsonrpc\":\"2.0\",\"id\":52,\"method\":\"tools/call\",\"params\":{\"name\":\"get_job\",\"arguments\":{\"id\":\"$VDFED_SR\"}}}" > /tmp/vd_od16_srjob.json
    fi
    VDFED_SR="$VDFED_SR" node - /tmp/vd_od16_ <<'NODE'
const fs = require("fs");
const P = process.argv[2];
const say = (v, m) => console.log(`${v}  ${m}`);
const raw = (f) => { try { return fs.readFileSync(P + f, "utf8"); } catch { return ""; } };
// The tool's answer: its structured content, or the text it carries.
const sc = (f) => {
  try {
    const j = JSON.parse(raw(f));
    if (!j || !j.result || j.result.isError) return null;
    if (j.result.structuredContent) return j.result.structuredContent;
    const t = j.result.content && j.result.content[0] && j.result.content[0].text;
    return t ? JSON.parse(t) : null;
  } catch { return null; }
};
const s = sc("search.json");
if (!s) say("FAIL", `FED5 search_jobs for a federal title answered no result: ${JSON.stringify(raw("search.json").slice(0, 160))}`);
else {
  const cards = (Array.isArray(s.jobs) ? s.jobs : []).filter((j) => /^usajobs:/.test(String(j && j.id)));
  if (!cards.length) say("INFO", `FED5 search_jobs gave no federal card for "transportation security officer" (withheld ${s.withheld ?? 0}): no labelled announcement matched, nothing to judge`);
  else {
    const bad = cards.filter((c) => !(c.federal && typeof c.federal.whoMayApply === "string" && c.federal.whoMayApply.trim()) || "postedAt" in c || /^usajobs$/i.test(String(c.company || "")))
      .map((c) => `${c.id}: whoMayApply ${JSON.stringify(c.federal && c.federal.whoMayApply)}, postedAt ${JSON.stringify(c.postedAt)}, company ${JSON.stringify(c.company)}`);
    const credit = s.federalAttribution && /not operated, sponsored, approved or endorsed by OPM/.test(String(s.federalAttribution.notice || ""));
    if (bad.length || !credit) say("FAIL", `FED5 ${cards.length} federal cards: ${bad.length ? bad.slice(0, 2).join("; ") : "each labelled"}; federalAttribution ${credit ? "names OPM's notice" : JSON.stringify(s.federalAttribution || null).slice(0, 120)}`);
    else say("PASS", `FED5 ${cards.length} federal cards, each with federal.whoMayApply (e.g. ${JSON.stringify(cards[0].federal.whoMayApply)}), no postedAt and the agency as company; the result names OPM's notice in federalAttribution`);
  }
}
if (!process.env.VDFED_SR) say("INFO", "FED5 the board's list gave no SmartRecruiters id: the withheld id is not asked for");
else {
  const g = sc("srjob.json");
  if (g && g.restricted === true && g.job === null) say("PASS", "FED5 get_job on a SmartRecruiters id answers restricted, with no posting: SmartRecruiters stays withheld");
  else say("FAIL", `FED5 get_job on a SmartRecruiters id answered ${JSON.stringify(g || raw("srjob.json").slice(0, 160)).slice(0, 200)} (want restricted: true, job: null)`);
}
NODE
  else
    echo "INFO  FED5 the connector calls are not run: VERIFY_KEYLESS_CALLS=1 runs them, two of today's shared keyless allowance"
  fi
fi

# ── FED6: the site's AI line counts no federal posting the AI cannot reach ──
# Run whether or not OD16 serves: a site publish that counts federal postings
# before the connector hands them on is the failure this line exists for.
curl -s -m 30 -A "$UA" -o /tmp/vd_od16_llms.txt "$SITE/llms.txt"
curl -s -m 30 -A "$UA" -o /tmp/vd_od16_home.html "$SITE/"
VDFED_LIVE="$VDFED_LIVE" node - /tmp/vd_od16_ <<'NODE'
const fs = require("fs");
const P = process.argv[2];
const live = process.env.VDFED_LIVE === "1";
const say = (v, m) => console.log(`${v}  ${m}`);
const raw = (f) => { try { return fs.readFileSync(P + f, "utf8"); } catch { return ""; } };
const rd = (f) => { try { return JSON.parse(raw(f)); } catch { return null; } };
const num = (s) => Number(String(s).replace(/,/g, ""));
const fmt = (n) => n.toLocaleString("en-US");
const line = /Your AI searches ([\d,]+) of the ([\d,]+) open postings: (.+?) postings \(([\d,]+)\) stay on this website\./.exec(raw("llms.txt"));
if (!line) { say("INFO", "FED6 the live llms.txt carries no AI reach line: nothing to judge"); process.exit(0); }
const [, reach, total, names] = line;
// The board's federal count, as the homepage bake prints it (the same read the line subtracts).
const row = /USAJOBS <span[^>]*>\([^)]*\)<\/span><\/td><td[^>]*>([\d,]+)<\/td>/.exec(raw("home.html"));
const board = row ? num(row[1]) : null;
// The labelled federal rows /v1 serves (keyed, OD16 serving), when FED count read them.
const co = rd("companies.json");
const fa = co && co.federalAgencies && Array.isArray(co.federalAgencies.agencies) ? co.federalAgencies : null;
const labelled = fa ? fa.agencies.reduce((n, a) => n + Number(a.open_postings || 0), 0) : null;
const caughtUp = live && fa && fa.complete === true && board !== null && board > 0 && labelled >= 0.98 * board;
if (/\bUSAJOBS\b/.test(names)) {
  say(live ? "PASS" : "INFO", `FED6 the live AI line (${reach} of ${total}) subtracts every federal posting and names USAJOBS among what stays on this website: never above what the AI can reach${live ? "" : " (OD16 not serving yet)"}`);
  if (caughtUp) say("INFO", `FED6 the labelled federal rows /v1 serves (${fmt(labelled)}) are at least 98% of the board's federal count (${fmt(board)}): the AI line may now count them (set FEDERAL_ROWS_IN_REACH in src/lib/home/board-figures.ts and drop the clause about it from MCP_WITHHELD_NOTE)`);
  process.exit(0);
}
if (!live) {
  say("FAIL", `FED6 the live AI line (${reach} of ${total}, naming only ${names}) counts every federal posting as searchable while OD16 is not serving (FED0): the AI reaches none of them`);
} else if (caughtUp) {
  say("PASS", `FED6 the live AI line counts the federal postings, and the labelled rows /v1 serves (${fmt(labelled)}) are at least 98% of the board's federal count (${fmt(board)})`);
} else if (labelled === null || board === null) {
  say("INFO", `FED6 the live AI line counts the federal postings, and ${labelled === null ? "the labelled rows /v1 serves were not read (RB_API_KEY_FRESH)" : "the homepage bake printed no federal count"}: not judged`);
} else {
  say("FAIL", `FED6 the live AI line counts every federal posting as searchable, but /v1 serves ${fmt(labelled)} labelled of the board's ${fmt(board)}${fa.complete === true ? "" : " (the count stopped early)"}: the line is about ${fmt(Math.max(0, board - labelled))} above what the AI can reach`);
}
NODE

# ── FED9: the site says federal announcements are handed on only once they are ──
# Run whether or not OD16 serves, as FED6 is: a site published before the two
# functions says the connector hands on postings it still refuses.
curl -s -m 30 -A "$UA" -o /tmp/vd_od16_agents.html "$SITE/agents"
VDFED_LIVE="$VDFED_LIVE" node - /tmp/vd_od16_agents.html <<'NODE'
const fs = require("fs");
const live = process.env.VDFED_LIVE === "1";
const say = (v, m) => console.log(`${v}  ${m}`);
let bake = ""; try { bake = fs.readFileSync(process.argv[2], "utf8"); } catch { /* below */ }
const handedOn = bake.includes("U.S. federal announcements are handed on once");
const byChoice = bake.includes("which we choose not to redistribute for now");
if (handedOn && live) say("PASS", "FED9 /agents says U.S. federal announcements are handed on once who may apply is stored, and OD16 is serving");
else if (handedOn) say("FAIL", "FED9 /agents already says U.S. federal announcements are handed on, but OD16 is not serving (FED0): the connector still refuses every federal posting. Publish the site after public-api and agent-mcp");
else if (byChoice) say("INFO", `FED9 /agents still says the federal feed is withheld by our own choice${live ? ": it waits for the frontend publish, while the connector already hands on labelled announcements" : ", as the connector still does (OD16 not serving yet)"}`);
else say("INFO", "FED9 the /agents bake carries neither federal wording: not judged");
NODE
