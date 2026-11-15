# shellcheck shell=bash
# ── 99zzzzzzz-bugs-privacy-retention. THE BUG ROUND, PRIVACY-RETENTION LANE
# (branch bugs/a-privacy-retention): S14X-042, NEW-PRIVACY-RETENTION-01,
# S14X-181, S14X-231, NB-13, NB-38, the Privacy half of S14X-097, and the
# owner-gated S14X-021, S14X-073 and NB-39. Three migrations in the lane's
# 20261112100000-109999 range, no edge function, and Privacy copy published
# by the merge itself.
#
# Named 99zzzzzzz so it sorts after the 99zzzzzz-* sections in byte order
# ("-" before "z") and under a locale that ignores the dash.
#
# THE CLAIMS, one line each. None FAILs on today's production, before the
# merge and the paste: each reads INFO until what it judges has shipped, and
# can FAIL from then on.
#   PR0  the stamp signals. privacy_retention_nightly() answers anon 42501
#        once 20261112100000 applied (PGRST202 before: INFO); a 25006 or rows
#        mean a client can run the purge (FAIL). client_table_grants()
#        answers once 20261112102000 applied (PGRST202 before: INFO).
#   PR1  the job 'privacy-retention-nightly' (get_cron_health): listed,
#        active, a statement_timeout in its command, and once it has run,
#        no failed and no timed-out run (a timed-out night did not keep the
#        90-day promise). INFO before PR0 shows 20261112100000; FAIL after.
#   PR2  the four log writers refuse anon: log_scan_metric,
#        log_heartbeat_result, log_parse_failure and log_industry_detection,
#        each probed by GET (a read-only transaction: 25006 means callable,
#        and nothing was written). Live 2026-11-15 the first two answer 25006
#        and client_callable_census counts 2 unlisted client-callable
#        definers. A callable writer is INFO before PR0 shows the migration
#        and a FAIL after it; the census must then count 0, or name another
#        lane's function (INFO, section 40 lists it).
#   PR3  the served /privacy (crawler UA) says what the lane ships, judged
#        once the lane's copy is served: any one of its new sentences on the
#        page (the 'Job Board Searches:' line, the Resend fallback, the
#        emailed scan report, signing out clears this browser) means the
#        publish happened, and from then each claim stands or FAILs on its
#        own. The Last updated day alone cannot say it: the connector-prune
#        flip may re-date the page before the round publishes.
#          a  section 11 no longer reads 'AI models and fonts' (S14X-181)
#          b  the sign-in processor line names Resend (S14X-181): scoped to
#             the <li> that names sign-in emails, never the whole page, where
#             'Resend' already appears twice
#          c  the ipinfo line names the emailed scan report (S14X-181)
#          d  the 'In Your Browser' item says signing out clears it (S14X-097)
#          e  'Job Board Searches:' says 180 days, then daily totals (NB-38)
#          f  the Log Data line still promises 90 days (S14X-042: the nightly
#             is what makes it true; this guards the sentence it enforces,
#             and is judged before the round too, where it already PASSes)
#   PR4  the service-only tables (NB-13): client_table_grants() names none of
#        the fifty-two tables 20261112102000 closes, and api_keys, read by a
#        real column, answers 42501 (the control that the catalogue reader is
#        not lying). INFO before PR0 shows 20261112102000.
#   PR5  OWNER-GATED. S14X-021 (the Affiliate program entry naming
#        affiliate_ref, its 30 days, the keyed address hash and the 90-day
#        click records), S14X-073 (the Shortlist sentence states the rule the
#        owner chose: A, the employer deletes a candidate or role and a
#        four-year purge; B, kept until the employer deletes the account,
#        erasure requests by email) and NB-39 (once the connector row says 30
#        days, option 1 names the searches made before September 7, 2026).
#        Each prints INFO 'owner pending' until docs/deploy-ledger.json
#        reservations['bug-round'].ownerDecided names its key; then it judges
#        a page whose Last updated is on or after the recorded day (the
#        integrator re-dates the page on the merge day), and reads INFO on an
#        older page, which cannot carry an answer it predates.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite and at apply time: the
# rows the nightly deletes and the addresses the triggers withhold
# (a-log-older-than-ninety-days-keeps-no-address, pglite; the migration's own
# rolled-back probe claim RAISEs unless it stores 'withheld'), every overload
# closed (a-metrics-writer-answers-only-the-service-role), the erase of a
# deleted account's cache rows (a-deleted-account-leaves-no-subscription-
# cache-row; 20261112101000's rolled-back probe), and the table grants
# (a-table-only-the-server-reads-answers-only-the-server).
#
# READ-ONLY. GETs only: four RPC probes of writers (read-only transaction),
# three anon read RPCs (get_cron_health, client_callable_census,
# client_table_grants), one GET probe of the purge, one column read of a
# closed table, and one GET of /privacy with the crawler UA. Nothing is posted.
echo "== 99zzzzzzz. bug round, privacy-retention: logs keep no address past 90 days, the log writers and service tables refuse strangers, and /privacy says what shipped =="

rm -f /tmp/vd_bpr_cron.json /tmp/vd_bpr_census.json /tmp/vd_bpr_grants.json /tmp/vd_bpr_privacy.html /tmp/vd_bpr_purge.json /tmp/vd_bpr_keys.json
VDBPR_LEDGER="${VDBPR_LEDGER:-docs/deploy-ledger.json}"

# The code of a PostgREST answer: 42501, PGRST202, 25006 ..., ROWS:n for an
# array, OBJECT for any other JSON object, NONJSON when it is not JSON.
vdbpr_code() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{console.log("NONJSON");return}if(Array.isArray(j)){console.log("ROWS:"+j.length);return}if(j&&typeof j==="object"&&j.code){console.log(String(j.code));return}console.log(j&&typeof j==="object"?"OBJECT":"NONJSON")})'; }
vdbpr_get() { curl -s -m 60 "$B/rest/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K"; }

# The owner's recorded answer for a key, as "choice<TAB>day", or nothing.
# ownerDecided maps key -> choice and date (the integrator writes it): a bare
# string is a choice with no day.
vdbpr_owner() {
  node -e '
    const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(0)}
    const rs=(j&&j.reservations)||{};const r=Array.isArray(rs)?rs.find((x)=>x&&x.name==="bug-round"):rs["bug-round"];
    const od=r&&r.ownerDecided;if(!od||typeof od!=="object")process.exit(0);
    const v=od[process.argv[2]];if(v===undefined||v===null||v===false||v==="")process.exit(0);
    const choice=typeof v==="string"?v:(v&&v.choice!==undefined?String(v.choice):JSON.stringify(v));
    const day=v&&typeof v==="object"?String(v.date||v.decided||v.on||""):"";
    process.stdout.write(choice.replace(/\s+/g," ")+"\t"+day);
  ' "$VDBPR_LEDGER" "$1" 2>/dev/null
}

# ── PR0: the stamp signals ──────────────────────────────────────────────────
vdbpr_get "rpc/privacy_retention_nightly" > /tmp/vd_bpr_purge.json
VDBPR_M1=unknown
case "$(vdbpr_code < /tmp/vd_bpr_purge.json)" in
  42501) VDBPR_M1=applied; echo "PASS  PR0 privacy_retention_nightly exists and anon may not run it (42501): 20261112100000 applied";;
  PGRST202) VDBPR_M1=pending; echo "INFO  PR0 privacy_retention_nightly is not there yet (PGRST202): 20261112100000 has not applied, so PR1 and PR2 read INFO";;
  25006) VDBPR_M1=applied; echo "FAIL  PR0 privacy_retention_nightly is CALLABLE by anon (25006: only this read-only GET stopped its deletes)";;
  *) echo "FAIL  PR0 privacy_retention_nightly as anon -> $(head -c 160 /tmp/vd_bpr_purge.json) (want 42501, or PGRST202 before the paste)";;
esac
rm -f /tmp/vd_bpr_purge.json

vdbpr_get "rpc/client_table_grants" > /tmp/vd_bpr_grants.json
VDBPR_M3=unknown
case "$(vdbpr_code < /tmp/vd_bpr_grants.json)" in
  OBJECT) VDBPR_M3=applied;;
  PGRST202) VDBPR_M3=pending;;
esac

# ── PR1: the nightly job ────────────────────────────────────────────────────
vdbpr_get "rpc/get_cron_health?p_hours=48" > /tmp/vd_bpr_cron.json
VDBPR_M1="$VDBPR_M1" node - /tmp/vd_bpr_cron.json <<'VDBPR_JS'
const fs = require("fs");
const applied = process.env.VDBPR_M1 === "applied";
let j = null; try { j = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { /* judged below */ }
if (!Array.isArray(j)) {
  console.log("FAIL  PR1 get_cron_health did not answer a list (" + JSON.stringify(j).slice(0, 120) + "): the nightly cannot be judged");
} else {
  const job = j.find((r) => r && r.ch_jobname === "privacy-retention-nightly");
  if (!job) {
    console.log((applied ? "FAIL" : "INFO") + "  PR1 no job 'privacy-retention-nightly' among " + j.length + " jobs" + (applied ? ", though 20261112100000 applied: nothing enforces the 90-day log promise" : ": 20261112100000 has not applied"));
  } else if (job.ch_active !== true) {
    console.log("FAIL  PR1 'privacy-retention-nightly' is listed but not active: nothing runs the 90-day purge");
  } else if (!job.ch_timeout) {
    console.log("FAIL  PR1 'privacy-retention-nightly' carries no statement_timeout in its command (the session's 2 minutes would cut it)");
  } else {
    console.log("PASS  PR1 'privacy-retention-nightly' is scheduled (" + job.ch_schedule + "), active, with statement_timeout " + job.ch_timeout + " in its command");
    const runs = Number(job.ch_runs) || 0, failed = Number(job.ch_failed) || 0, timeouts = Number(job.ch_timeouts) || 0;
    if (runs === 0) console.log("INFO  PR1 'privacy-retention-nightly' has not run in the last 48 hours yet (it runs at 04:41 UTC)");
    else if (failed > 0 || timeouts > 0) console.log("FAIL  PR1 'privacy-retention-nightly' ran " + runs + " time(s) in 48 hours with " + failed + " failed and " + timeouts + " timed out (last: " + job.ch_last_status + "): a night that failed did not keep the 90-day promise");
    else console.log("PASS  PR1 'privacy-retention-nightly' ran " + runs + " time(s) in 48 hours, none failed or timed out (last " + job.ch_last_status + " at " + job.ch_last_start + ")");
  }
}
VDBPR_JS
rm -f /tmp/vd_bpr_cron.json

# ── PR2: the four log writers ───────────────────────────────────────────────
VDBPR_OPEN=0
for VDBPR_SPEC in 'log_scan_metric|p_scan_type=x' \
                  'log_heartbeat_result|p_function_name=x&p_status=x&p_response_time_ms=1&p_test_passed=true' \
                  'log_parse_failure|p_file_type=x' \
                  'log_industry_detection|p_resume_text_length=1'; do
  VDBPR_FN="${VDBPR_SPEC%%|*}"; VDBPR_QS="${VDBPR_SPEC#*|}"
  VDBPR_C=$(vdbpr_get "rpc/$VDBPR_FN?$VDBPR_QS" | vdbpr_code)
  case "$VDBPR_C" in
    42501) echo "PASS  PR2 $VDBPR_FN refuses anon (42501)";;
    25006) VDBPR_OPEN=$((VDBPR_OPEN + 1))
      if [ "$VDBPR_M1" = applied ]; then echo "FAIL  PR2 $VDBPR_FN is CALLABLE by anon (25006: only this read-only GET stopped its insert), though 20261112100000 applied: an overload stayed open"
      else echo "INFO  PR2 $VDBPR_FN is still callable by anon (25006, nothing written): 20261112100000 closes every overload of it"; fi;;
    PGRST202) if [ "$VDBPR_M1" = applied ]; then echo "FAIL  PR2 $VDBPR_FN has no overload taking $VDBPR_QS: the probe no longer reaches the writer, so it is unjudged"
      else echo "INFO  PR2 $VDBPR_FN -> PGRST202 for $VDBPR_QS"; fi;;
    *) echo "FAIL  PR2 $VDBPR_FN as anon -> $VDBPR_C (want 42501)";;
  esac
done
vdbpr_get "rpc/client_callable_census" > /tmp/vd_bpr_census.json
VDBPR_OPEN="$VDBPR_OPEN" VDBPR_M1="$VDBPR_M1" node - /tmp/vd_bpr_census.json <<'VDBPR_JS'
const fs = require("fs");
const applied = process.env.VDBPR_M1 === "applied", open = Number(process.env.VDBPR_OPEN) || 0;
let j = null; try { j = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { /* judged below */ }
const r = Array.isArray(j) ? j[0] : j;
const n = r && typeof r === "object" ? r.unlisted_client_callable : undefined;
if (typeof n !== "number") console.log("FAIL  PR2 client_callable_census answered no unlisted_client_callable (" + JSON.stringify(j).slice(0, 120) + ")");
else if (n === 0) console.log("PASS  PR2 client_callable_census counts 0 unlisted client-callable definers");
else if (!applied) console.log("INFO  PR2 client_callable_census counts " + n + " unlisted client-callable definer(s) (2 on 2026-11-15: the two log writers 20261112100000 closes)");
else if (open > 0) console.log("FAIL  PR2 client_callable_census counts " + n + " unlisted client-callable definer(s) and " + open + " log writer(s) still answer anon, though 20261112100000 applied");
else console.log("INFO  PR2 client_callable_census counts " + n + " unlisted client-callable definer(s), none of them the four log writers: another change opened it (section 40 names it)");
VDBPR_JS
rm -f /tmp/vd_bpr_census.json

# ── PR3 and PR5: the served /privacy ────────────────────────────────────────
curl -s -m 30 -A "$UA" "$SITE/privacy" > /tmp/vd_bpr_privacy.html
VDBPR_O21="$(vdbpr_owner S14X-021)" VDBPR_O73="$(vdbpr_owner S14X-073)" VDBPR_O39="$(vdbpr_owner NB-39)" \
  node - /tmp/vd_bpr_privacy.html <<'VDBPR_JS'
const fs = require("fs");
let raw = ""; try { raw = fs.readFileSync(process.argv[2], "utf8"); } catch { /* judged below */ }
const ent = (s) => s.replace(/&#39;|&#x27;|&apos;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
const html = ent(raw);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let updated = null;
const iso = /Last updated:\s*(\d{4}-\d{2}-\d{2})/.exec(html);
const written = /Last updated:\s*([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(html);
if (iso) updated = iso[1];
else if (written && MONTHS.includes(written[1])) updated = `${written[3]}-${String(MONTHS.indexOf(written[1]) + 1).padStart(2, "0")}-${written[2].padStart(2, "0")}`;
const lis = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
if (!updated || !/Privacy Policy/.test(html) || lis.length < 20) {
  console.log("FAIL  PR3 /privacy could not be read (" + raw.length + " bytes, Last updated " + (updated || "not found") + ", " + lis.length + " list items): nothing on the page can be judged");
  process.exit(0);
}
const signIn = lis.find((t) => /sign-in emails/.test(t)) || "";
const ipinfo = lis.find((t) => /^ipinfo \(/.test(t)) || "";
const browser = lis.find((t) => t.startsWith("In Your Browser:")) || "";
const searches = lis.find((t) => t.startsWith("Job Board Searches:")) || "";
const logData = lis.filter((t) => t.startsWith("Log Data:")).find((t) => /90 days/.test(t)) || "";
// PUBLISHED when any sentence only this lane writes is on the page. The date
// alone cannot say it: the connector-prune flip may re-date the page first.
const LANE = [["the 'Job Board Searches:' line", !!searches], ["the Resend fallback", /Resend/.test(signIn)],
  ["the emailed scan report", /scan report/.test(ipinfo)], ["signing out clears this browser", /Signing out on this device/.test(browser)]];
const seen = LANE.filter(([, on]) => on).map(([n]) => n);
const published = seen.length > 0;
const why = `Last updated ${updated}; ${seen.length} of the lane's ${LANE.length} new sentences on the page`;
const judge = (id, ok, pass, fail) => { if (published) console.log(ok ? `PASS  PR3${id} ${pass}` : `FAIL  PR3${id} ${fail} (${why})`); };
if (!published) console.log(`INFO  PR3a-e not judged yet: none of the lane's new sentences is served (${why}): the round's frontend has not published`);
judge("a", !/AI models and fonts/.test(html), "section 11 names Google for AI models only: no font host is claimed anywhere", "the page still names Google for 'AI models and fonts', while it says no font host is asked");
judge("b", /Resend/.test(signIn) && /Mailgun/.test(signIn), "the sign-in processor line names Mailgun and the Resend fallback", "the sign-in processor line does not name the Resend fallback: '" + signIn.slice(0, 120) + "'");
judge("c", /scan report/.test(ipinfo) && /free scan/.test(ipinfo), "the ipinfo line names the free scan and the emailed scan report", "the ipinfo line names no emailed scan report: '" + ipinfo.slice(0, 120) + "'");
judge("d", /Signing out on this device clears them too/.test(browser), "the In Your Browser item says signing out clears what this browser keeps", "the In Your Browser item does not say signing out clears the builder resume, scan history and reports");
judge("e", /180 days/.test(searches) && /daily totals/.test(searches), "Job Board Searches: kept 180 days, then daily totals only", "no 'Job Board Searches:' line saying 180 days, then daily totals");
// f is true before the round too: the promise the nightly makes true.
console.log(logData ? "PASS  PR3f the Log Data line promises 90 days (privacy-retention-nightly enforces it once 20261112100000 applies)" : `FAIL  PR3f no Log Data line promising 90 days (${why})`);

// An owner line judges only a page published on or after the day the answer
// was recorded (the integrator re-dates the page on the merge day); an older
// page cannot carry an answer it predates.
const owner = (id, key, rec, check) => {
  const [choice = "", on = ""] = String(rec || "").split("\t");
  if (!choice) { console.log(`INFO  PR5${id} ${key} owner pending: docs/deploy-ledger.json reservations['bug-round'].ownerDecided does not name ${key}`); return; }
  const day = /^\d{4}-\d{2}-\d{2}/.test(on) ? on.slice(0, 10) : null;
  if (day && updated < day) { console.log(`INFO  PR5${id} ${key} decided (${choice.slice(0, 60)}) on ${day}; the served page (Last updated ${updated}) predates the answer`); return; }
  if (!day && !published) { console.log(`INFO  PR5${id} ${key} decided (${choice.slice(0, 60)}); not judged until the round's frontend publishes (${why})`); return; }
  const [ok, pass, fail] = check(choice);
  console.log(ok === null ? `INFO  PR5${id} ${key}: ${pass}` : ok ? `PASS  PR5${id} ${key}: ${pass}` : `FAIL  PR5${id} ${key}: ${fail}`);
};
owner("a", "S14X-021", process.env.VDBPR_O21, () => {
  const entry = lis.find((t) => /affiliate_ref/.test(t)) || "";
  return [/30 days/.test(entry) && /90 days/.test(entry) && /keyed hash/.test(entry),
    "the page names the affiliate_ref referral cookie, its 30 days, the keyed address hash and the 90-day click records",
    "the owner approved the Affiliate program entry, and the served page " + (entry ? "names affiliate_ref without its 30 days, keyed hash or 90 days: '" + entry.slice(0, 160) + "'" : "never names affiliate_ref")];
});
owner("b", "S14X-073", process.env.VDBPR_O73, (choice) => {
  const s = lis.find((t) => t.startsWith("Shortlist:")) || "";
  const today = /until they delete the role or their account/.test(s);
  const rule = /^\s*(rule\s*)?B\b/i.test(choice) ? "B" : /^\s*(rule\s*)?A\b/i.test(choice) ? "A" : null;
  if (!rule) return [false, "", "ownerDecided['S14X-073'] reads '" + choice.slice(0, 60) + "', neither rule A nor rule B: nothing says which sentence the page must carry"];
  if (rule === "B") return [!today && /delete their account/.test(s) && /by email/.test(s) && !/four years/.test(s),
    "the Shortlist sentence says records stay until the employer deletes the account, and where erasure requests go (rule B)",
    "rule B was chosen, and the Shortlist sentence " + (today ? "is still today's text" : "does not say records stay until the account is deleted and erasure requests go by email") + ": '" + s.slice(0, 160) + "'"];
  return [!today && /delete the candidate/.test(s) && /four years/.test(s),
    "the Shortlist sentence states the employer's delete of a candidate or role and the four-year purge (rule A)",
    "rule A was chosen, and the Shortlist sentence " + (today ? "is still today's text" : "does not state the candidate delete and the four-year purge") + ": '" + s.slice(0, 160) + "'"];
});
owner("c", "NB-39", process.env.VDBPR_O39, (choice) => {
  const cell = ((html.match(/<td\b[^>]*>\s*From Claude and other connections: the search words[\s\S]*?<\/td>/) || [""])[0]).replace(/<[^>]+>/g, "");
  if (!cell) return [false, "", "the connector row's kept cell is not on the page"];
  if (/kept for up to 180 days/.test(cell)) return [null, "the connector row still says up to 180 days (the 30-day flip has not published), which is true of every connector search: nothing to judge"];
  if (/^\s*(option\s*)?2\b|delete/i.test(choice)) return [null, "option 2 (delete the searches logged before the caller column) was chosen; that delete is not readable from outside, so the 30-day wording is not judged here"];
  return [/September 7, 2026/.test(cell),
    "the connector row says 30 days and names the searches made before September 7, 2026, kept like the site's own",
    "the connector row says 30 days without naming the searches made before September 7, 2026, which the 30-day prune cannot tell apart from the site's own and keeps 180 days"];
});
VDBPR_JS
rm -f /tmp/vd_bpr_privacy.html

# ── PR4: the service-only tables ────────────────────────────────────────────
if [ "$VDBPR_M3" = applied ]; then
  VDBPR_KEYS=$(vdbpr_get "api_keys?select=id&limit=1" | vdbpr_code)
  VDBPR_KEYS="$VDBPR_KEYS" node - /tmp/vd_bpr_grants.json <<'VDBPR_JS'
const fs = require("fs");
const CLOSED = ["ab_test_events", "affiliate_clicks", "affiliate_conversions", "affiliate_sessions", "affiliates",
  "agent_subscribers", "agent_worker_heartbeat", "ai_response_cache", "alert_log",
  "api_keys", "api_quota", "api_rate", "api_usage", "cohort_weekly_reports", "company_claims",
  "detection_telemetry", "email_logs", "email_send_log", "email_send_state", "email_unsubscribe_tokens",
  "free_scan_leads",
  "job_board_board_state", "job_board_board_watch", "job_board_click_rollup", "job_board_closures",
  "job_board_company_dim_snapshots", "job_board_company_flow", "job_board_embeddings", "job_board_exit_rollup",
  "job_board_exits", "job_board_field_changes", "job_board_pool_samples", "job_board_posting_reports",
  "job_board_search_clicks", "job_board_search_events", "job_board_search_misses", "job_board_search_rollup",
  "parse_failures", "payment_failures", "pro_grants", "pro_subscribers", "rate_limits", "resume_analyses",
  "scan_feedback", "scan_industry_pins", "scan_metrics", "scan_outcomes", "scan_report_cache", "scan_slots",
  "suppressed_emails", "temp_resume_storage", "webhook_events"];
let j = null; try { j = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { /* judged below */ }
if (!j || !Array.isArray(j.anon) || !Array.isArray(j.authenticated)) {
  console.log("FAIL  PR4 client_table_grants answered no anon and authenticated lists (" + JSON.stringify(j).slice(0, 120) + ")");
} else {
  const open = CLOSED.filter((t) => j.anon.includes(t) || j.authenticated.includes(t));
  if (open.length) console.log("FAIL  PR4 " + open.length + " service-only table(s) a client role can still touch: " + open.slice(0, 12).join(", "));
  else console.log("PASS  PR4 none of the " + CLOSED.length + " service-only tables answers anon or authenticated (client_table_grants lists " + j.anon.length + " for anon, " + j.authenticated.length + " for authenticated)");
  const keys = process.env.VDBPR_KEYS;
  if (keys === "42501") console.log("PASS  PR4 api_keys read by a real column as anon -> 42501 (the control: the catalogue reader matches a real read)");
  else console.log("FAIL  PR4 api_keys read by a real column as anon -> " + keys + " (want 42501" + (j.anon.includes("api_keys") ? "" : ", and client_table_grants says it is closed: the reader and the table disagree") + ")");
}
VDBPR_JS
elif [ "$VDBPR_M3" = pending ]; then
  echo "INFO  PR4 client_table_grants is not there yet (PGRST202): 20261112102000 has not applied, so the fifty-two service-only tables still answer anon an empty list"
else
  echo "FAIL  PR4 client_table_grants as anon -> $(head -c 160 /tmp/vd_bpr_grants.json) (want an object, or PGRST202 before the paste)"
fi
rm -f /tmp/vd_bpr_grants.json
