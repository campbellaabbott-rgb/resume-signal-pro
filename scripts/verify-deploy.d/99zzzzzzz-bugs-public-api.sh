# shellcheck shell=bash
# ── 99zzzzzzz-bugs-public-api. BUG ROUND A, LANE PUBLIC-API (branch bugs/a-public-api).
# /v1 refuses a non-POST /v1/fit before the key is metered, and a fit call
# that scored nothing gives its allowance back (api_key_fit_unscored,
# 20261112200000); a refusal states only the limits api_key_check read; the
# change feed reads up to a settled horizon and hands back a resume cursor; a
# keyset page carries its leading bound and a cursor carries only a key; the
# employer counts, the pay-floor share and the closure index are dated by the
# run that counted them; the field curve names the boards it admits; the
# 90-day closure figure says it counts events; the stats basis types no
# rollup cadence; a country filter takes only a country; the federal feed is
# withheld without a claim its terms forbid it.
#
# THE CLAIMS, one line each:
#   B    public-api serves 2026-11-12.1 or later on its preflight. Until it
#        does, every line that judges this round's code prints INFO;
#   M1   api_key_fit_unscored(uuid, text) exists and anon may not call it
#        (42501). Missing before the paste INFO, after it a FAIL; callable
#        by anon is a FAIL either way;
#   M2   api_fit_unscored exists and anon may not read it, judged as M1;
#   M3   api_key_fit_allowance(uuid, text) is still there and anon-refused;
#   R    a revoked key's 403 carries no X-Quota-* (C-S14-122). Needs a key
#        api_key_check answers "revoked": RB_REVOKED_KEY, default .env.local's
#        RB_API_KEY. VERIFY_BURST=1 also runs the per-minute 429 against it;
#   F    GET /v1/fit with no key answers 405 (M-S14-106: refused before the
#        key is metered);
#   U    the keyless /v1 index still withholds the federal feed and its
#        reason claims no prohibition in the feed's terms (USAJOBS-COPY-2).
#        From public-api 2026-11-19.1 on (OD16) both U lines print INFO:
#        the federal rows are handed on and section 99zzzzzzzzzz judges them;
#   K*   the keyed lines, run only with RB_API_KEY_FRESH (a live confirmed
#        free key the owner mints at /data-api): lifecycle dated by its own
#        run and carriedForward (S14X-160), closure events (S14X-192), the
#        admitted boards (S14X-277), the stats basis against the live cron
#        schedule (NB-32, CW-121000, two-sided), the companies stamp
#        (S14X-274), the pay-floor share against the board's own (S14X-276),
#        the settled change feed (S14X-065), a GET /v1/fit spending nothing
#        (S14X-132), a deep cursor's time (S14X-037), a comma cursor
#        (NB-30) and country=EU (NB-27);
#   O    the owner-gated keys (OD14-REDIST-2, OD14-ASHBY-2) print INFO owner
#        pending until docs/deploy-ledger.json reservations['bug-round']
#        .ownerDecided names them; then each judges what its decision ships;
#   SH1  (lane SH, the shared half of OD14-ASHBY, keyed) one Ashby posting
#        /v1/jobs?source=ashby serves, asked for its application form,
#        answers form.source not-read-on-this-surface with no read (readAt
#        null, no questions), and the same response's x-fn-build is at or
#        above the public-api build that first carries the shared stop
#        (VDBA_SH_DAY and VDBA_SH_N below). The stop itself cannot be seen
#        from outside: /v1's own vendor list already leaves Ashby out on the
#        build before it, so only the build tells the two apart. That is why
#        the shared stop has a build of its own: round B's integration branch
#        carries the build before it without the stop. Until the build is
#        live the line prints INFO.
#
# WHAT THIS SECTION CANNOT SEE: a POST. The give-back on each unscored
# outcome and the noLog flag on a résumé-read query (GP-NOLOG-2) are proven
# on the shipped handler by the suite, never here.
#
# READ-ONLY. An OPTIONS preflight, GETs of /v1 (each keyed one metered like
# any customer call), GETs of two anon read RPCs and three PostgREST probes,
# and job-board list reads under x-rb-budget: probe. Keys are sent as
# headers and never printed.
echo "== 99zzzzzzz. bug round A public-api: the build, the give-back migration, refusals, the change feed, dated figures, owner gates =="

VDBA_PA="$B/functions/v1/public-api"
VDBA_FRESH="${RB_API_KEY_FRESH:-}"
VDBA_REV="${RB_REVOKED_KEY:-${RB:-}}"
# SH1 waits for this public-api build: the first one that carries the shared stop.
VDBA_SH_DAY=2026-11-18; VDBA_SH_N=2

# B: the build.
VDBA_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$VDBA_PA/v1/stats" -H "apikey: $K" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: GET" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
VDBA_LIVE=0
if [ -n "$VDBA_H" ] && build_ge public-api "$VDBA_H" 2026-11-12 1; then
  VDBA_LIVE=1
  echo "PASS  B public-api preflight x-fn-build = $VDBA_H (2026-11-12.1 or later)"
else
  echo "INFO  B public-api preflight x-fn-build = ${VDBA_H:-none}: bug round A's public-api is not pasted yet (the lines that judge it print INFO until it is)"
fi
# A line that judges this round's code: FAIL once it is live, INFO before.
vdba_judge() { if [ "$VDBA_LIVE" = 1 ]; then echo "FAIL  $1"; else echo "INFO  $1 (not pasted yet)"; fi; }

# M1-M3: the migration, probed as anon. GET runs in a read-only transaction.
vdba_probe() {
  local id="$1" path="$2" what="$3" mig="$4" out code body
  out=$(curl -s -m 30 -w '\n%{http_code}' "$B/rest/v1/$path" -H "apikey: $K" -H "Authorization: Bearer $K")
  code=$(printf '%s' "$out" | tail -n 1)
  body=$(printf '%s' "$out" | sed '$d')
  if printf '%s' "$body" | grep -q '42501'; then echo "PASS  $id $what exists ($mig), and anon is refused it"
  elif printf '%s' "$body" | grep -qE 'PGRST202|PGRST205|42883|42P01'; then
    if [ "$mig" = "20261011110000" ]; then echo "FAIL  $id $what is missing: the free fit allowance cannot be read"
    else vdba_judge "$id $what does not exist: $mig is not applied, so every fit call that scored nothing still spends the allowance"; fi
  elif [ "$code" = "200" ]; then echo "FAIL  $id $what answered anon HTTP 200 ($(printf '%s' "$body" | head -c 80)): no client role may reach it"
  else echo "FAIL  $id $what -> ${code:-no answer} $(printf '%s' "$body" | head -c 160) (want 42501)"; fi
}
VDBA_Z="p_key_id=00000000-0000-4000-8000-000000000000&p_endpoint=/v1/fit"
vdba_probe M1 "rpc/api_key_fit_unscored?$VDBA_Z" "api_key_fit_unscored(uuid, text)" 20261112200000
vdba_probe M2 "api_fit_unscored?select=key_id&limit=1" "public.api_fit_unscored" 20261112200000
vdba_probe M3 "rpc/api_key_fit_allowance?$VDBA_Z" "api_key_fit_allowance(uuid, text)" 20261011110000

# R: a revoked key's refusal states no daily figure.
if [ -n "$VDBA_REV" ]; then
  VDBA_C=$(curl -s -m 60 -o /tmp/vdba_rev.json -D /tmp/vdba_rev.h -w '%{http_code}' "$VDBA_PA/v1/stats" -H "Authorization: Bearer $VDBA_REV" -H "apikey: $K")
  VDBA_E=$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).error.code))}catch{process.stdout.write("?")}' /tmp/vdba_rev.json)
  VDBA_Q=$(tr -d '\r' < /tmp/vdba_rev.h | grep -i '^x-quota-remaining:' | sed -E 's/^[^:]+: *//')
  if [ "$VDBA_C" != "403" ] || [ "$VDBA_E" != "key_revoked" ]; then echo "INFO  R RB_REVOKED_KEY answered HTTP $VDBA_C $VDBA_E, not 403 key_revoked: this line needs a revoked key"
  elif [ -n "$VDBA_Q" ]; then vdba_judge "R a revoked key's 403 carries X-Quota-Remaining: $VDBA_Q (C-S14-122: the day bucket was never read, so no daily figure may be stated)"
  else echo "PASS  R a revoked key's 403 key_revoked carries no X-Quota-* header"; fi
  if [ "${VERIFY_BURST:-0}" = "1" ]; then
    VDBA_GOT=""
    for VDBA_I in $(seq 1 75); do
      VDBA_C=$(curl -s -m 30 -o /dev/null -D /tmp/vdba_burst.h -w '%{http_code}' "$VDBA_PA/v1/stats" -H "Authorization: Bearer $VDBA_REV" -H "apikey: $K")
      if [ "$VDBA_C" = "429" ]; then VDBA_GOT=1; break; fi
    done
    if [ -z "$VDBA_GOT" ]; then echo "INFO  R no per-minute 429 inside 75 calls (the minute rolled over); re-run with VERIFY_BURST=1"
    elif tr -d '\r' < /tmp/vdba_burst.h | grep -qi '^x-quota-'; then vdba_judge "R the per-minute 429 carries an X-Quota-* header although the day bucket was never read"
    else echo "PASS  R the per-minute 429 carries no X-Quota-* header"; fi
  fi
else
  echo "INFO  R no revoked key to probe with (RB_REVOKED_KEY, or RB_API_KEY in .env.local)"
fi

# F: a keyless GET /v1/fit is refused before the key is read.
VDBA_C=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$VDBA_PA/v1/fit")
if [ "$VDBA_C" = "405" ]; then echo "PASS  F GET /v1/fit with no key -> 405 (refused before api_key_check meters it)"
else vdba_judge "F GET /v1/fit with no key -> HTTP $VDBA_C, want 405: the method is refused only after the key is metered, so a keyed GET spends a free fit call"; fi

# U and O: the keyless /v1 index.
curl -s -m 30 -o /tmp/vdba_index.json "$VDBA_PA/v1"
vdba_decided() {
  node -e 'let l={};try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
const d=((l.reservations||{})["bug-round"]||{}).ownerDecided||{};const v=d[process.argv[2]];
process.stdout.write(v==null?"":typeof v==="object"?String(v.choice??v.option??JSON.stringify(v)):String(v))' "${VDBA_LEDGER:-docs/deploy-ledger.json}" "$1"
}
# OD16 (owner 2026-11-18): from public-api 2026-11-19.1 on, /v1 hands on the
# federal rows whose who-may-apply statement is stored, so both U lines print
# INFO there; section 99zzzzzzzzzz-api4-od16-federal judges the federal rows.
VDBA_OD16=0; [ -n "$VDBA_H" ] && build_ge public-api "$VDBA_H" 2026-11-19 1 && VDBA_OD16=1
VDBA_OD16="$VDBA_OD16" VDBA_LIVE="$VDBA_LIVE" VDBA_REDIST="$(vdba_decided OD14-REDIST-2)" VDBA_ASHBY="$(vdba_decided OD14-ASHBY-2)" node - /tmp/vdba_index.json <<'NODE'
const fs = require("fs");
const live = process.env.VDBA_LIVE === "1";
const say = (v, m) => console.log(`${v}  ${m}`);
const judge = (ok, pass, fail) => (ok ? say("PASS", pass) : live ? say("FAIL", fail) : say("INFO", `${fail} (not pasted yet)`));
let ix = null; try { ix = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { /* below */ }
const r = ix && ix.restrictions;
if (!r || !Array.isArray(r.excludedSources)) { say("FAIL", `U the /v1 index answered no restrictions block: ${JSON.stringify(ix).slice(0, 160)}`); process.exit(0); }
const claims = /terms[^.]*(forbid|prohibit|do not permit|bar)|forbid[^.]*redistribut/i.test(String(r.reason || ""));
if (process.env.VDBA_OD16 === "1") {
  say("INFO", `U the /v1 index lists ${JSON.stringify(r.excludedSources)} as withheld: public-api 2026-11-19.1 or later hands on labelled federal rows (OD16), so section 99zzzzzzzzzz judges this, not round A`);
  say("INFO", `U the withholding reason ${claims ? "says a feed's terms forbid handing it on" : "claims nothing about a feed's terms"}: "${String(r.reason || "").slice(0, 120)}" (OD16: section 99zzzzzzzzzz judges it)`);
} else {
  if (!r.excludedSources.includes("usajobs")) say("FAIL", "U the /v1 index no longer withholds usajobs (the owner's decision keeps it withheld)");
  judge(!claims, "U the withholding reason claims nothing about the federal feed's terms (USAJOBS-COPY-2)",
    `U the withholding reason still says the federal feed's terms forbid handing it on: "${String(r.reason).slice(0, 140)}"`);
}
if (!process.env.VDBA_REDIST) say("INFO", "OD14-REDIST-2 owner pending: UKG, ADP and Breezy rows are still handed on by /v1 until the owner decides");
else if (/withh/i.test(process.env.VDBA_REDIST)) {
  const want = ["ukg", "adp", "breezy"].filter((s) => !r.excludedSources.includes(s));
  judge(want.length === 0, `OD14-REDIST-2 (${process.env.VDBA_REDIST}) /v1 withholds ukg, adp and breezy`, `OD14-REDIST-2 (${process.env.VDBA_REDIST}) /v1 still hands on ${want.join(", ")}`);
} else if (/^keep\b/i.test(process.env.VDBA_REDIST)) {
  // The owner kept them (2026-11-18): the claim is that /v1 still hands on all three.
  const gone = ["ukg", "adp", "breezy"].filter((s) => r.excludedSources.includes(s));
  judge(gone.length === 0, `OD14-REDIST-2 (${process.env.VDBA_REDIST}) /v1 still hands on ukg, adp and breezy`, `OD14-REDIST-2 (${process.env.VDBA_REDIST}) /v1 withholds ${gone.join(", ")} although the owner kept them`);
} else say("INFO", `OD14-REDIST-2 recorded as "${process.env.VDBA_REDIST}", which names neither withhold nor keep: nothing is judged`);
if (!process.env.VDBA_ASHBY) say("INFO", "OD14-ASHBY-2 owner pending: /v1's application-form route still reads Ashby's form endpoint until the owner decides");
else {
  const d = String((ix.modes || {}).applicationForm || "");
  judge(d !== "" && !/Ashby/.test(d), `OD14-ASHBY-2 (${process.env.VDBA_ASHBY}) /v1's form reader no longer names Ashby`, `OD14-ASHBY-2 (${process.env.VDBA_ASHBY}) /v1's form reader still names Ashby: "${d.slice(0, 120)}"`);
}
NODE
echo "INFO  GP-NOLOG-2 and the give-back on each unscored outcome are POSTs: proven on the shipped handler in the suite (a-fit-query-read-from-a-resume-is-not-logged, a-fit-call-that-scored-nothing-gives-its-allowance-back), never here"

if [ -z "$VDBA_FRESH" ]; then
  echo "INFO  K RB_API_KEY_FRESH is not set: the keyed lines (S14X-160, S14X-192, S14X-277, NB-32, S14X-274, S14X-276, S14X-065, S14X-132, S14X-037, NB-30, NB-27, SH1) are not run. OWNER: mint a confirmed free key at https://resumebooster.work/data-api and export it as RB_API_KEY_FRESH (the .env.local key is revoked)"
else
  vdba_v1() { curl -s -m 60 -o "$2" -w '%{http_code}' "$VDBA_PA$1" -H "Authorization: Bearer $VDBA_FRESH" -H "apikey: $K"; }
  vdba_rpc() { curl -s -m 60 -o "$2" "$B/rest/v1/rpc/$1" -H "apikey: $K" -H "Authorization: Bearer $K"; }
  vdba_board() { curl -s -m 60 -X POST -o "$2" "$B/functions/v1/job-board" -H "apikey: $K" -H "Authorization: Bearer $K" -H "Content-Type: application/json" -H "x-rb-budget: probe" -d "$1"; }
  vdba_rpc get_stats_cache /tmp/vdba_cache1.json
  vdba_rpc get_cron_health /tmp/vdba_cron.json
  vdba_board '{"action":"list","limit":1}' /tmp/vdba_board1.json
  vdba_board '{"action":"list","limit":1,"salaryFloor":50000}' /tmp/vdba_boardsal.json
  vdba_v1 /v1/stats /tmp/vdba_stats.json >/dev/null
  vdba_rpc get_stats_cache /tmp/vdba_cache2.json
  vdba_v1 "/v1/companies?limit=1" /tmp/vdba_companies.json >/dev/null
  vdba_board '{"action":"list","limit":1}' /tmp/vdba_board2.json
  vdba_v1 "/v1/jobs?salary_min=50000&limit=1" /tmp/vdba_jobsal.json >/dev/null
  VDBA_SINCE=$(node -e 'console.log(new Date(Date.now()-6*3600e3).toISOString())')
  vdba_v1 "/v1/changes?since=$VDBA_SINCE&limit=100" /tmp/vdba_changes.json >/dev/null
  vdba_v1 /v1/usage /tmp/vdba_u1.json >/dev/null
  VDBA_FIT=$(vdba_v1 /v1/fit /tmp/vdba_fitget.json)
  vdba_v1 /v1/usage /tmp/vdba_u2.json >/dev/null
  VDBA_CUR=$(node -e 'const e=(o)=>Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const ep=new Date(Date.now()-27*864e5).toISOString();console.log(e({ep,id:"zzzz"})+" "+e({ep:new Date(Date.now()-3600e3).toISOString(),id:"1),or(event_id.gt.0"}))')
  VDBA_T1=$(curl -s -m 60 -o /dev/null -w '%{http_code} %{time_total}' "$VDBA_PA/v1/jobs?limit=25" -H "Authorization: Bearer $VDBA_FRESH" -H "apikey: $K")
  VDBA_T2=$(curl -s -m 60 -o /dev/null -w '%{http_code} %{time_total}' "$VDBA_PA/v1/jobs?limit=25&cursor=${VDBA_CUR%% *}" -H "Authorization: Bearer $VDBA_FRESH" -H "apikey: $K")
  VDBA_NB30=$(vdba_v1 "/v1/changes?since=$VDBA_SINCE&closed_cursor=${VDBA_CUR#* }" /tmp/vdba_nb30.json)
  VDBA_NB27=$(vdba_v1 "/v1/jobs?country=EU&limit=1" /tmp/vdba_nb27.json)
  VDBA_LIVE="$VDBA_LIVE" VDBA_FIT="$VDBA_FIT" VDBA_T1="$VDBA_T1" VDBA_T2="$VDBA_T2" VDBA_NB30="$VDBA_NB30" VDBA_NB27="$VDBA_NB27" node - /tmp <<'NODE'
const fs = require("fs"); const T = process.argv[2];
const j = (f) => { try { return JSON.parse(fs.readFileSync(`${T}/vdba_${f}.json`, "utf8")); } catch { return null; } };
const live = process.env.VDBA_LIVE === "1";
const say = (v, m) => console.log(`${v}  ${m}`);
const judge = (ok, pass, fail) => (ok ? say("PASS", pass) : live ? say("FAIL", fail) : say("INFO", `${fail} (not pasted yet)`));
const s = j("stats"), c1 = j("cache1"), c2 = j("cache2"), cron = j("cron");
const d = s && s.data, l = d && d.lifecycle;
const sameRun = !!(c1 && c2 && c1.computed_at === c2.computed_at);
if (!d) say("FAIL", `K /v1/stats answered no data: ${JSON.stringify(s).slice(0, 160)}`);
else {
  // S14X-160: lifecycle dated by the index's own run, and carriedForward.
  if (!l) say("INFO", "S14X-160 lifecycle is null");
  else if (!sameRun) say("INFO", "S14X-160 the stats cache refreshed between the reads; re-run");
  else {
    const g = c2.ghost_stats && c2.ghost_stats.computed_at;
    const kept = Array.isArray(c2.stale_parts) && c2.stale_parts.includes("ghost_stats");
    if (!g) say("INFO", "S14X-160 the cache's ghost_stats carries no computed_at");
    else judge(l.asOf === g, `S14X-160 lifecycle.asOf ${l.asOf} is the index's own run (cache root ${c2.computed_at})`, `S14X-160 lifecycle.asOf ${l.asOf}, the index ran at ${g} (cache root ${c2.computed_at})`);
    judge(typeof l.carriedForward === "boolean" && l.carriedForward === kept, `S14X-160 lifecycle.carriedForward ${l.carriedForward} matches stale_parts`, `S14X-160 lifecycle.carriedForward is ${l.carriedForward}, stale_parts names ghost_stats: ${kept}`);
  }
  // S14X-192: events, not roles.
  if (l) {
    const b = String(l.closuresLogged90dBasis || "");
    judge(/^Closure events/.test(b), "S14X-192 closuresLogged90dBasis says it counts closure events", `S14X-192 closuresLogged90dBasis opens "${b.slice(0, 60)}"`);
  }
  // S14X-277: each row's admitted boards equal the cache's, and the rule is stated.
  const fc = l && l.fillCurve;
  if (!fc) say("INFO", "S14X-277 fillCurve is null");
  else if (!sameRun) say("INFO", "S14X-277 the stats cache refreshed between the reads; re-run");
  else {
    const rows = (c2.fill_curve && (Array.isArray(c2.fill_curve) ? c2.fill_curve : c2.fill_curve.rows)) || [];
    const by = Object.fromEntries(rows.map((r) => [String(r.category), r]));
    const bad = fc.data.filter((r) => !(by[r.category] && r.admittedBoards14 === (by[r.category].admitted_boards_14 ?? null) && r.admittedBoards30 === (by[r.category].admitted_boards_30 ?? null)));
    judge(fc.data.length > 0 && bad.length === 0, `S14X-277 all ${fc.data.length} fillCurve rows carry the cache's admitted boards`, `S14X-277 ${bad.length} of ${fc.data.length} fillCurve rows do not carry the cache's admitted_boards_14/_30`);
    judge(/read in full/.test(fc.basis || "") && /watch floor/.test(fc.basis || ""), "S14X-277 the fillCurve basis states the admission rule", "S14X-277 the fillCurve basis does not state the admission rule (boards read in full, the watch floor)");
  }
  // NB-32 (CW-121000), two-sided: a typed rollup cadence must be the cron's.
  const roll = Array.isArray(cron) ? cron.find((r) => r.ch_jobname === "job-board-stats-rollup") : null;
  const typed = /rollup recomputed every (\d+) minutes/.exec(String(s.basis || ""));
  const runs = roll && /^\*\/(\d+) \* \* \* \*$/.exec(String(roll.ch_schedule || ""));
  if (!typed) say("PASS", `NB-32 the /v1/stats basis types no rollup cadence (the cron runs ${roll ? `'${roll.ch_schedule}'` : "a schedule get_cron_health did not report"})`);
  else if (!roll) say("INFO", `NB-32 the basis types every ${typed[1]} minutes and get_cron_health has no job-board-stats-rollup row to judge it by`);
  else judge(false, "", `NB-32 the /v1/stats basis types 'every ${typed[1]} minutes' and the rollup runs '${roll.ch_schedule}'${runs && runs[1] === typed[1] ? " (true today, false the day a migration re-times it)" : ": a false statement live"}`);
  // S14X-274 (stats half).
  judge(typeof d.companiesAsOf === "string" && typeof d.companiesCarried === "boolean", `S14X-274 /v1/stats companiesAsOf ${d.companiesAsOf} (carried ${d.companiesCarried})`, `S14X-274 /v1/stats companiesAsOf is ${d.companiesAsOf}, companiesCarried ${d.companiesCarried}`);
}
// S14X-274: /v1/companies is dated by the pass that counted it.
const co = j("companies"), b1 = j("board1"), b2 = j("board2");
if (!co || !("asOf" in co)) say("FAIL", `S14X-274 /v1/companies answered no asOf: ${JSON.stringify(co).slice(0, 160)}`);
else {
  const passes = [b1 && b1.refreshedAt, b2 && b2.refreshedAt].filter(Boolean);
  if (typeof co.countsCarried !== "boolean") judge(false, "", `S14X-274 /v1/companies carries no countsCarried (asOf ${co.asOf})`);
  else if (!passes.length) say("INFO", "S14X-274 job-board list gave no refreshedAt to judge /v1/companies by");
  else {
    const ok = co.countsCarried ? passes.some((p) => Date.parse(co.asOf) < Date.parse(p)) : passes.includes(co.asOf);
    judge(ok, `S14X-274 /v1/companies asOf ${co.asOf} is the board pass that counted it (countsCarried ${co.countsCarried})`, `S14X-274 /v1/companies asOf ${co.asOf} (countsCarried ${co.countsCarried}) vs the board pass ${passes.join(" / ")}`);
    if (d && typeof d.companiesAsOf === "string") judge(d.companiesAsOf === co.asOf, "S14X-274 /v1/stats companiesAsOf equals /v1/companies asOf", `S14X-274 /v1/stats companiesAsOf ${d.companiesAsOf} vs /v1/companies asOf ${co.asOf}`);
  }
}
// S14X-276: the pay-floor share is the board's own, at the same pass.
const js = j("jobsal"), bs = j("boardsal");
const cov = js && js.coverage;
if (!cov) say("FAIL", `S14X-276 /v1/jobs?salary_min answered no coverage: ${JSON.stringify(js).slice(0, 160)}`);
else {
  const share = bs && bs.filterCoverage && bs.filterCoverage.salaryFloor, at = bs && bs.filterCoverageAt;
  if (!("statedPayShareAt" in cov)) judge(false, "", `S14X-276 statedPayShare ${cov.statedPayShare} carries no statedPayShareAt (the board's own share is ${share} at ${at})`);
  else if (typeof share !== "number" || !at) say("INFO", `S14X-276 the board served no salaryFloor share to compare; /v1 says ${cov.statedPayShare} at ${cov.statedPayShareAt}`);
  else if (cov.statedPayShareAt !== at) say("INFO", `S14X-276 /v1 ${cov.statedPayShare} at ${cov.statedPayShareAt}, board ${share} at ${at}: a pass ran between the reads; re-run`);
  else judge(cov.statedPayShare === share, `S14X-276 statedPayShare ${cov.statedPayShare} is the board's share at ${at}`, `S14X-276 statedPayShare ${cov.statedPayShare}, the board's share is ${share} at ${at}`);
}
// S14X-065: the change feed reads to a settled horizon and hands back a resume cursor.
const ch = j("changes");
if (!ch || !ch.page) say("FAIL", `S14X-065 /v1/changes answered no page: ${JSON.stringify(ch).slice(0, 160)}`);
else {
  const st = ch.page.closed && ch.page.closed.settledThrough, now = Date.now();
  if (typeof st !== "string") judge(false, "", "S14X-065 page.closed.settledThrough is missing: closed[] runs to now, so a closure committed behind a consumer's cursor is never delivered");
  else {
    judge(Date.parse(st) <= now - 14 * 60e3, `S14X-065 closed[] is settled through ${st}, at least 14 minutes behind now`, `S14X-065 settledThrough ${st} is less than 14 minutes behind now`);
    const late = (ch.closed || []).filter((r) => Date.parse(r.closed_at) > Date.parse(st));
    judge(late.length === 0, "S14X-065 no closed[] row is newer than settledThrough", `S14X-065 ${late.length} closed[] rows are newer than settledThrough`);
  }
  if ((ch.closed || []).length > 0) judge(typeof ch.page.closed.resumeCursor === "string", `S14X-065 a closed page of ${ch.closed.length} hands back a resumeCursor (hasMore ${ch.page.closed.hasMore})`, "S14X-065 a non-empty closed page hands back no resumeCursor");
}
// S14X-132: a GET /v1/fit is refused and spends nothing.
const u1 = j("u1"), u2 = j("u2");
const ua = u1 && u1.fit && u1.fit.usedToday, ub = u2 && u2.fit && u2.fit.usedToday;
judge(process.env.VDBA_FIT === "405", "S14X-132 a keyed GET /v1/fit -> 405", `S14X-132 a keyed GET /v1/fit -> HTTP ${process.env.VDBA_FIT}, want 405`);
if (typeof ua !== "number" || typeof ub !== "number") say("INFO", `S14X-132 /v1/usage fit.usedToday is not a number (${ua} -> ${ub}): the key may be unconfirmed`);
else judge(ub === ua, `S14X-132 fit.usedToday ${ua} -> ${ub} across a GET /v1/fit`, `S14X-132 fit.usedToday ${ua} -> ${ub} across a GET /v1/fit, which scored nothing`);
// S14X-037: a cursor 27 days deep seeks.
const [c1s, t1] = String(process.env.VDBA_T1 || "").split(" "), [c2s, t2] = String(process.env.VDBA_T2 || "").split(" ");
judge(c1s === "200" && c2s === "200" && Number(t2) <= Math.max(3 * Number(t1), 3),
  `S14X-037 a /v1/jobs cursor 27 days deep: HTTP ${c2s} in ${t2}s against page 1's ${t1}s`,
  `S14X-037 /v1/jobs page 1 HTTP ${c1s} in ${t1}s, a cursor 27 days deep HTTP ${c2s} in ${t2}s (bound: max(3x page 1, 3s))`);
// NB-30 and NB-27.
const e30 = j("nb30"), e27 = j("nb27");
judge(process.env.VDBA_NB30 === "400" && e30 && e30.error && e30.error.code === "bad_cursor", "NB-30 a closure cursor carrying an OR branch -> 400 bad_cursor", `NB-30 a closure cursor carrying an OR branch -> HTTP ${process.env.VDBA_NB30} ${e30 && e30.error ? e30.error.code : ""}`);
judge(process.env.VDBA_NB27 === "400" && e27 && e27.error && /"EU"/.test(e27.error.message || ""), "NB-27 country=EU -> 400 naming EU", `NB-27 country=EU -> HTTP ${process.env.VDBA_NB27}`);
NODE
  # SH1: one served Ashby posting's form, asked of /v1, judged by the build that answered.
  vdba_v1 "/v1/jobs?source=ashby&limit=1" /tmp/vdba_ashbylist.json >/dev/null
  VDBA_SHID=$(node -e 'try{const r=(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).data||[]).find((x)=>x&&typeof x.id==="string"&&x.id.startsWith("ashby:"));process.stdout.write(r?encodeURIComponent(r.id):"")}catch{}' /tmp/vdba_ashbylist.json)
  VDBA_SHC=""; VDBA_SHB=""
  if [ -n "$VDBA_SHID" ]; then
    VDBA_SHC=$(curl -s -m 60 -o /tmp/vdba_ashbyform.json -D /tmp/vdba_ashbyform.h -w '%{http_code}' "$VDBA_PA/v1/jobs/$VDBA_SHID/application" -H "Authorization: Bearer $VDBA_FRESH" -H "apikey: $K")
    VDBA_SHB=$(tr -d '\r' < /tmp/vdba_ashbyform.h | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  fi
  VDBA_SHLIVE=0
  if [ -n "$VDBA_SHB" ] && build_ge public-api "$VDBA_SHB" "$VDBA_SH_DAY" "$VDBA_SH_N"; then VDBA_SHLIVE=1; fi
  VDBA_SHLIVE="$VDBA_SHLIVE" VDBA_SHC="$VDBA_SHC" VDBA_SHB="$VDBA_SHB" VDBA_SHMIN="public-api.$VDBA_SH_DAY.$VDBA_SH_N" node - /tmp <<'NODE'
const fs = require("fs"); const T = process.argv[2];
const j = (f) => { try { return JSON.parse(fs.readFileSync(`${T}/vdba_${f}.json`, "utf8")); } catch { return null; } };
const say = (v, m) => console.log(`${v}  ${m}`);
const live = process.env.VDBA_SHLIVE === "1", min = process.env.VDBA_SHMIN;
const list = j("ashbylist");
const row = list && Array.isArray(list.data) ? list.data.find((x) => x && typeof x.id === "string" && x.id.startsWith("ashby:")) : null;
if (!row) say("INFO", `SH1 /v1/jobs?source=ashby served no Ashby posting to ask for its form (${JSON.stringify(list).slice(0, 120)}): nothing judged`);
else {
  const f = j("ashbyform"), form = f && f.data && f.data.form;
  const unread = !!form && form.source === "not-read-on-this-surface" && form.vendor === "ashby" && form.readAt === null
    && Array.isArray(form.questions) && form.questions.length === 0;
  const what = `SH1 ${row.id}: /v1 application -> HTTP ${process.env.VDBA_SHC || "none"}, form.source ${form ? form.source : "none"}, readAt ${form ? form.readAt : "none"}, x-fn-build ${process.env.VDBA_SHB || "none"}`;
  if (unread && live) say("PASS", `${what}: not read, on ${min} or later, the build whose shared form reader stops Ashby whatever list a caller passes`);
  else if (unread) say("INFO", `${what}: /v1's own list leaves Ashby out, and the shared stop ships in ${min} or later, which is not live yet`);
  else if (live) say("FAIL", `${what}: want form.source not-read-on-this-surface with no read (readAt null, no questions) on the build that carries the shared stop`);
  else say("INFO", `${what}: want form.source not-read-on-this-surface with no read once ${min} or later is live (not pasted yet)`);
}
NODE
fi
echo "INFO  owner read-only SQL after the paste (needs the service role, which this script never holds): S14X-132 SELECT day, endpoint, count(*), sum(calls) FROM api_fit_unscored GROUP BY 1, 2 ORDER BY 1 DESC -- rows appear once a free key's fit call scores nothing, and no row's calls exceed api_usage's for the same key, day and endpoint"
