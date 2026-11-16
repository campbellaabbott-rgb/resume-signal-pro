# shellcheck shell=bash
# ── 99zzzzzzz-bugs-shortlist. THE BUG ROUND OF 2026-11-08, PART A, LANE
# shortlist (branch bugs/a-shortlist): the employer's Shortlist page and the
# function that scores a candidate. One function at 2026-11-12.1 (the
# integrator's stamp): shortlist-evaluate, changed directly and through its
# redaction.ts (moved from _shared into the function's own folder at the
# round's integration: it has no other importer, and the job-board upload
# tally counts every _shared byte). One migration in 20261112210000-219999: the notice log
# keeps the server's clock, an explicit sent date and the recipients
# (S14X-163). The Shortlist page publishes with the round; it has no t()
# strings, so there is no shard.
#
# THE STAGES, read from production, never assumed:
#   function  shortlist-evaluate serves 2026-11-12.1 or later: the paste is
#             live. Until then every function claim is INFO.
#   frontend  the published Shortlist chunk carries any of the lane's marks:
#             the round published. Until then every page claim is INFO; from
#             then on a missing mark is a FAIL, and so is a function or a
#             migration the paste left behind. A chunk that cannot be found,
#             or is not the Shortlist page, is a FAIL either way.
#   owner     S14X-073 prints INFO owner pending until docs/deploy-ledger.json
#             reservations['bug-round'].ownerDecided names it (the integrator
#             writes it); then the rule chosen is judged.
#
# THE CLAIMS, one line each:
#   B          shortlist-evaluate serves 2026-11-12.1 or later.
#   R0         the repo's redaction.ts, run on fixed samples, does what the
#              function claims below (offline: no résumé can be posted here).
#   RC-S13-073 the function reads no caller blocklist from the request.
#   S14X-022   birth dates and family status are read in German, French,
#              Spanish, Portuguese, Dutch, Chinese and Japanese too.
#   S14X-023   the model sees one neutral mark; a leave reads as a career break.
#   S14X-024   an affinity rule never reads past the line it starts on.
#   S14X-025   "Black Hat" and "worked as a Japanese interpreter" stay.
#   S14X-072/fn  a name below line six is masked, the file name's words are
#              used, and the record says when no name was found.
#   S14X-105   a Chinese name is masked; a title or heading is not a name.
#   S14X-106   pronouns, gendered roles and age prose are neutralised.
#   S14X-288   a birth date with a capitalised month loses its year.
#   S14X-289   a candidate whose attestation note fails is removed.
#   S14X-197/fn  a scorer outage is named, with Retry-After exposed to the page.
#   S14X-075   the page reads decisions by role and pages its reads.
#   S14X-162   the page shows what the model saw.
#   S14X-163/page  a notice is logged only on an explicit sent date.
#   S14X-163/db    shortlist_notices has logged_at and recipients (anon refused).
#   S14X-197/page  the page reads the refusal's sentence and Retry-After.
#   S14X-233   the page explains itself in place: no /methodology link, no
#              four-year promise.
#   S14X-072/page  the page warns when no name was found.
#   G1-G3      the guards of sections 72 and 92: attestation, shortlist_decide,
#              no demographics table.
#   S14X-073   (owner) rule A: the employer's delete, its log and the daily
#              four-year purge; rule B: the copy alone.
#
# READ-ONLY. One OPTIONS preflight, GETs of the site's /shortlist page, its
# entry and the Shortlist chunk, one anon GET of shortlist_notices with
# limit=0 (it answers only whether two columns exist), and, once rule A is
# decided, an anon GET of get_cron_health, of the deletions log with limit=0
# and of shortlist_delete_candidate (PostgREST runs a GET in a read-only
# transaction, and anon is refused before it runs). Nothing is posted,
# scored, mailed or written; no key is printed.
echo "== 99zzzzzzz. bug round part A, shortlist: the scorer's build and redaction, the page's reads, notices and refusals, the notice columns, one owner gate =="

rm -f /tmp/vd_bs_pre.txt /tmp/vd_bs_page.html /tmp/vd_bs_entry.js /tmp/vd_bs_chunk.js /tmp/vd_bs_cols.json /tmp/vd_bs_cron.json /tmp/vd_bs_del.json /tmp/vd_bs_rpc.json

curl -s -m 30 -D /tmp/vd_bs_pre.txt -o /dev/null -X OPTIONS "$B/functions/v1/shortlist-evaluate" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST"
VDBS_BUILD=$( { tr -d '\r' < /tmp/vd_bs_pre.txt | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g'; } 2>/dev/null)
VDBS_EXPOSE=$( { tr -d '\r' < /tmp/vd_bs_pre.txt | grep -i '^access-control-expose-headers:' | head -1 | sed -E 's/^[^:]+: *//'; } 2>/dev/null)
VDBS_FN=0
[ -n "$VDBS_BUILD" ] && build_ge shortlist-evaluate "$VDBS_BUILD" 2026-11-12 1 && VDBS_FN=1

curl -s -m 30 "$SITE/shortlist" > /tmp/vd_bs_page.html
VDBS_MAIN=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_bs_page.html | head -1)
[ -n "$VDBS_MAIN" ] && curl -s -m 60 "$SITE$VDBS_MAIN" > /tmp/vd_bs_entry.js
VDBS_CH=$( { [ -f /tmp/vd_bs_entry.js ] && grep -oE '(\./|assets/)Shortlist-[A-Za-z0-9_-]+\.js' /tmp/vd_bs_entry.js; } | head -1 | sed -E 's#^(\./|assets/)##')
[ -n "$VDBS_CH" ] && curl -s -m 60 "$SITE/assets/$VDBS_CH" > /tmp/vd_bs_chunk.js

# 200 [] (anon still holds SELECT) or 42501 (refused) both resolve the columns;
# 42703 means the migration has not applied.
curl -s -m 30 "$B/rest/v1/shortlist_notices?select=logged_at,recipients&limit=0" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_bs_cols.json

VDBS_O073=$(node -e 'let l={};try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
const d=((l.reservations||{})["bug-round"]||{}).ownerDecided||{};const v=d["S14X-073"]??d["S14X-073-shortlist"];
process.stdout.write(v==null?"":typeof v==="object"?String(v.choice??v.option??JSON.stringify(v)):String(v))' "${VDBS_LEDGER:-docs/deploy-ledger.json}")
if printf '%s' "$VDBS_O073" | grep -qiE '^A'; then
  curl -s -m 60 "$B/rest/v1/rpc/get_cron_health?p_hours=24" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_bs_cron.json
  curl -s -m 30 "$B/rest/v1/shortlist_deletions?select=id&limit=0" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_bs_del.json
  curl -s -m 30 "$B/rest/v1/rpc/shortlist_delete_candidate?p_candidate_id=00000000-0000-0000-0000-000000000000" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_bs_rpc.json
fi

VDBS_BUILD="$VDBS_BUILD" VDBS_FN="$VDBS_FN" VDBS_EXPOSE="$VDBS_EXPOSE" VDBS_MAIN="$VDBS_MAIN" VDBS_CH="$VDBS_CH" VDBS_O073="$VDBS_O073" \
VDBS_REDACTION="${VDBS_REDACTION:-supabase/functions/shortlist-evaluate/redaction.ts}" VDBS_FN_SRC="${VDBS_FN_SRC:-supabase/functions/shortlist-evaluate/index.ts}" \
node --input-type=module -e '
import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const E = process.env;
const say = (v, m) => console.log(v.padEnd(5) + " " + m);
const raw = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const json = (f) => { try { return JSON.parse(raw(f)); } catch { return undefined; } };
const peek = (f) => JSON.stringify(raw(f).slice(0, 140));
const build = E.VDBS_BUILD || "";
const fnNew = E.VDBS_FN === "1";

// ── B: the build.
if (!build) say("FAIL", "B shortlist-evaluate preflight carries no x-fn-build (want shortlist-evaluate.2026-11-12.1 or later): the function is not deployed, or its preflight does not answer");
else if (fnNew) say("PASS", "B shortlist-evaluate x-fn-build = " + build + " (2026-11-12.1 or later)");
else say("INFO", "B shortlist-evaluate x-fn-build = " + build + ": the part-A paste with 2026-11-12.1 has not landed (section 49 lists the gap)");

// ── The published page.
const chunk = raw("/tmp/vd_bs_chunk.js");
let read = true;
if (!E.VDBS_MAIN) { read = false; say("FAIL", "F0 /shortlist names no /assets/index-*.js entry: the published app cannot be read"); }
else if (!E.VDBS_CH || !chunk.includes("shortlist_decide")) { read = false; say("FAIL", "F0 the entry " + E.VDBS_MAIN + " names no Shortlist chunk that decides through shortlist_decide (" + (E.VDBS_CH || "none named") + "): the bundle layout moved, so the page cannot be judged"); }
const MARKS = ["data-how-shortlist-works", "data-model-saw", "data-notice-log", "data-read-error", "data-name-not-found", "shortlist_candidates.role_id"];
const fe = read && MARKS.some((m) => chunk.includes(m));
if (read) say("INFO", "F0 reading " + E.VDBS_CH + " (" + chunk.length + " bytes): the lane page is " + (fe ? "published" : "unpublished") + "; shortlist-evaluate serves " + (build || "no build"));
const roundLive = fnNew || fe;

// ── R0: the repo code the build claims, run offline.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fnSrc = strip(raw(E.VDBS_FN_SRC));
let red = null, why = "";
try { red = (await import(pathToFileURL(resolve(E.VDBS_REDACTION)).href)).redactForScoring; }
catch (e) { why = String(e && e.code || e && e.message || e).slice(0, 120); }
const off = {};
const ok = (k, cond, detail) => { off[k] = cond ? { ok: true } : { ok: false, detail }; };
if (typeof red !== "function") {
  say(/ERR_UNKNOWN_FILE_EXTENSION|ERR_UNSUPPORTED/.test(why) ? "INFO" : "FAIL", "R0 the repo redaction.ts could not be loaded here (" + (why || "no redactForScoring export") + "): the function claims are judged by the build alone");
} else {
  const r = (t, c) => { try { return red(t, c); } catch (e) { return { redacted: "THREW " + (e && e.message), exclusionsApplied: [], nameFound: null }; } };
  let x = r("Jane Okafor\nGeburtsdatum: 15.03.1970\nFamilienstand: verheiratet\nBerufserfahrung\nSoftwareentwicklerin bei Siemens");
  let y = r("履歴書\n氏名　山田 花子\n生年月日　1970年3月15日\n職務経歴書");
  ok("S14X-022", !/1970|verheiratet|山田/.test(x.redacted + y.redacted) && /Berufserfahrung/.test(x.redacted) && /職務経歴書/.test(y.redacted), "a German or Japanese birth date, marital status or name reached the text: " + JSON.stringify((x.redacted + " | " + y.redacted).slice(0, 160)));
  x = r("Jane Okafor\nSenior Analyst, Acme 2015-2019\nMaternity leave 2019-2020\nOver-50 professional");
  ok("S14X-023", !/\[REDACTED-/.test(x.redacted) && /Career break 2019-2020/.test(x.redacted), "the text names the category it hid or keeps the leave: " + JSON.stringify(x.redacted.slice(0, 160)));
  x = r("Jane Okafor\nMember, Society of Black Engineers\nBuilt a Kafka pipeline for payments");
  ok("S14X-024", /Built a Kafka pipeline for payments/.test(x.redacted) && !/Black Engineers/.test(x.redacted), "the affinity rule read across lines: " + JSON.stringify(x.redacted.slice(0, 160)));
  x = r("Jane Okafor\nAs a Black woman in tech I mentor others\nPresented at Black Hat 2023\nWorked as a Japanese interpreter for Sony");
  ok("S14X-025", !/Black woman/.test(x.redacted) && /Black Hat 2023/.test(x.redacted) && /Japanese interpreter/.test(x.redacted), "job evidence was erased, or the identity it sits beside passed: " + JSON.stringify(x.redacted.slice(0, 160)));
  x = r("CURRICULUM VITAE\nPage 1 of 2\nConfidential\nContact\n+1 555 123 4567\nAustin, TX\nJane Okafor\nSenior Engineer at Acme\nOkafor led the team.");
  y = r("EXPERIENCE\nBuilt pipelines for 10 years at Okafor Labs.\nJane Okafor shipped it.", { nameHint: "Jane_Okafor_CV.pdf" });
  const z = r("EXPERIENCE\nBuilt pipelines for 10 years at Acme Corp.\nSKILLS\nPython, SQL");
  ok("S14X-072/fn", !/Okafor/.test(x.redacted) && !/Jane Okafor/.test(y.redacted) && z.nameFound === false && /nameHint/.test(fnSrc) && /nameDetected/.test(fnSrc), "a name on line seven or in the file name reached the text, nameFound is not false, or shortlist-evaluate neither hands the file name over nor records nameDetected: " + JSON.stringify((x.redacted + " | " + y.redacted).slice(0, 160)) + " nameFound=" + z.nameFound);
  x = r("个人简历\n姓名：王小明\n性别：女\n工作经历\n王小明负责项目");
  y = r("软件工程师\n王小明\n工作经历\n软件工程师，负责后端开发");
  ok("S14X-105", !/王小明/.test(x.redacted + y.redacted) && /个人简历/.test(x.redacted) && /软件工程师/.test(y.redacted), "a Chinese name reached the text, or a title was taken for one: " + JSON.stringify((x.redacted + " | " + y.redacted).slice(0, 160)));
  x = r("Jane Okafor\nShe led the team as chairman of the board.\nOver-50 professional");
  ok("S14X-106", /They led the team as chair of the board/.test(x.redacted) && !/Over-50/.test(x.redacted), "a pronoun, a gendered role or age prose passed: " + JSON.stringify(x.redacted.slice(0, 160)));
  x = r("Jane Okafor\nBorn: March 3, 1958\nD.O.B. 3 March 1958");
  ok("S14X-288", !/1958/.test(x.redacted), "a birth year passed: " + JSON.stringify(x.redacted.slice(0, 160)));
  ok("RC-S13-073", fnSrc.length > 0 && !/body\.redactionConfig/.test(fnSrc) && !/from\s+"\.\/caller-blocklist/.test(fnSrc) && !fs.existsSync(resolve(E.VDBS_FN_SRC, "..", "caller-blocklist.ts")), "shortlist-evaluate still reads the request body for a blocklist or imports the caller-blocklist module");
  ok("S14X-289", /from\("shortlist_candidates"\)\s*\.delete\(\)/.test(fnSrc) && /attestation_log_failed/.test(fnSrc), "shortlist-evaluate keeps a scored candidate whose attestation note failed");
  ok("S14X-197/fn", /scoring_unavailable/.test(fnSrc) && /"Retry-After"/.test(fnSrc) && /Access-Control-Expose-Headers"\s*:\s*"[^"]*retry-after/i.test(fnSrc), "shortlist-evaluate does not name a scorer outage with Retry-After, or does not expose it");
  const bad = Object.entries(off).filter(([, v]) => !v.ok).map(([k]) => k);
  if (bad.length) say("FAIL", "R0 the repo code does not do what the round claims for " + bad.join(", ") + " (each is named below)");
  else say("PASS", "R0 the repo redaction.ts and shortlist-evaluate do what the round claims on " + Object.keys(off).length + " fixed samples");
}

// ── The function claims: the repo code, then the build.
const fnKey = (k, what) => {
  const o = off[k];
  if (o && !o.ok) say("FAIL", k + " the repo code does not do it (" + o.detail + "): " + what);
  else if (fnNew && k === "S14X-197/fn" && !/retry-after/i.test(E.VDBS_EXPOSE || "")) say("FAIL", k + " shortlist-evaluate serves " + build + " but its preflight exposes " + JSON.stringify(E.VDBS_EXPOSE || "nothing") + ", so the page cannot read Retry-After: " + what);
  else if (fnNew) say("PASS", k + " shortlist-evaluate serves " + build + (o ? " (R0 proves the code)" : "") + ": " + what);
  else if (fe) say("FAIL", k + " the round published its Shortlist page but shortlist-evaluate serves " + (build || "no build") + ", so the paste left the function behind: " + what);
  else say("INFO", k + " waits for the part-A paste (shortlist-evaluate serves " + (build || "no build") + "): " + what);
};
fnKey("RC-S13-073", "the function reads no caller blocklist from the request, so no request can make the redactor run a pattern");
fnKey("S14X-022", "birth dates, marital status and names are read in the site languages and Chinese and Japanese, not only English");
fnKey("S14X-023", "the model sees one neutral [REDACTED] mark, and a parental or medical leave reads as a career break");
fnKey("S14X-024", "an affinity or religion rule never reads past the line it starts on");
fnKey("S14X-025", "named things (Black Hat) and roles (a Japanese interpreter) stay as job evidence");
fnKey("S14X-072/fn", "a name below line six, or in the file name, is masked, and the record says when no name was found");
fnKey("S14X-105", "a Chinese or Japanese name is masked, and a job title or heading is never taken for one");
fnKey("S14X-106", "pronouns, gendered role nouns, age and origin prose are neutralised");
fnKey("S14X-288", "a birth date written with a capitalised month loses its year");
fnKey("S14X-289", "a candidate whose attestation note cannot be written is removed, or the employer is told it was kept");
fnKey("S14X-197/fn", "a scorer outage answers scoring_unavailable with Retry-After, exposed to the page");

// ── The page claims.
const mark = (k, what, has, lacks = []) => {
  if (!read) return;
  const missing = has.filter((m) => !chunk.includes(m)), present = lacks.filter((m) => chunk.includes(m));
  if (!missing.length && !present.length) say("PASS", k + " " + what + " (the published chunk holds " + has.join(", ") + (lacks.length ? " and no " + lacks.join(", ") : "") + ")");
  else if (fe) say("FAIL", k + " the round published but the chunk " + [missing.length ? "lacks " + missing.join(", ") : "", present.length ? "still holds " + present.join(", ") : ""].filter(Boolean).join(" and ") + ", so this is not true: " + what);
  else say("INFO", k + " not published yet (" + [missing.length ? "no " + missing.join(", ") : "", present.length ? "still " + present.join(", ") : ""].filter(Boolean).join("; ") + "): " + what);
};
mark("S14X-075", "the page reads a role decisions through the candidate role, in pages, and ranks nothing after a failed read", ["shortlist_candidates.role_id", ".range(", "data-read-error"], [".in(\"candidate_id\""]);
mark("S14X-162", "the employer sees the text the model scored and the export carries it", ["redacted_text", "candidate_jurisdiction", "data-model-saw"]);
mark("S14X-163/page", "a notice is logged as sent only on a date the employer gives, and copying it logs nothing", ["data-notice-log", "logged_at"], ["Copy + log as sent"]);
mark("S14X-197/page", "a refusal shows its own sentence and when to try again, never one generic line", ["Shortlist could not be reached", "retry-after", ".context"], ["Evaluation failed — try again."]);
mark("S14X-233", "the page says how Shortlist works in place, with no /methodology link and no four-year promise", ["data-how-shortlist-works"], ["\"/methodology\"", "Records retained 4 years"]);
mark("S14X-072/page", "the page warns when no name was found in a resume", ["data-name-not-found"]);
if (read) {
  say(chunk.includes("attested") ? "PASS" : "FAIL", "G1 the page " + (chunk.includes("attested") ? "still sends" : "no longer sends") + " the uploader attestation (verify 92)");
  say(chunk.includes("shortlist_decide") ? "PASS" : "FAIL", "G2 decisions " + (chunk.includes("shortlist_decide") ? "still go" : "no longer go") + " through shortlist_decide (verify 72)");
  say(chunk.includes("shortlist_demographics") ? "FAIL" : "PASS", "G3 the page " + (chunk.includes("shortlist_demographics") ? "names" : "names no") + " demographics table (D14, verify 92)");
}

// ── S14X-163/db: the notice columns.
const cols = json("/tmp/vd_bs_cols.json");
const code = cols && typeof cols === "object" && !Array.isArray(cols) ? String(cols.code ?? "") : "";
if (code === "42501") say("PASS", "S14X-163/db shortlist_notices has logged_at and recipients, and anon is refused (42501): 20261112210000 applied");
else if (code === "42703") say(roundLive ? "FAIL" : "INFO", "S14X-163/db shortlist_notices has no logged_at or recipients yet (42703): " + (roundLive ? "the round is live but 20261112210000 did not apply (re-apply it under a fresh stamp)" : "the part-A paste has not landed"));
else if (Array.isArray(cols)) say(roundLive ? "FAIL" : "INFO", "S14X-163/db logged_at and recipients resolve but anon still reads shortlist_notices (200): " + (roundLive ? "20261112210000 revokes anon, so it did not apply or a grant came back" : "a later state than the paste expects; judged once the paste lands"));
else say("FAIL", "S14X-163/db the column probe answered " + peek("/tmp/vd_bs_cols.json") + " (want 42501 once 20261112210000 applies, or 42703 before)");

// ── S14X-073 (owner).
const o = E.VDBS_O073 || "";
if (!o) say("INFO", "S14X-073 owner pending: rule A (the employer deletes a candidate or a role, a log keeps the fact, and a daily job deletes what is four years old) or rule B (the copy alone). Until then the lane page promises no retention it does not keep (S14X-233 judges that); ownerDecided names S14X-073 when the integrator records it");
else if (/^A/i.test(o)) {
  const cron = json("/tmp/vd_bs_cron.json"), del = json("/tmp/vd_bs_del.json"), rpc = json("/tmp/vd_bs_rpc.json");
  const rows = Array.isArray(cron) ? cron.filter((r) => r && typeof r.ch_jobname === "string") : null;
  const job = rows ? rows.find((r) => /shortlist/i.test(r.ch_jobname) && /purge/i.test(r.ch_jobname)) : null;
  const c = (j) => (j && typeof j === "object" && !Array.isArray(j) ? String(j.code ?? "") : Array.isArray(j) ? "200" : "none");
  const miss = [];
  if (!rows || !rows.length) miss.push("get_cron_health answered no jobs (" + peek("/tmp/vd_bs_cron.json") + ")");
  else if (!job) miss.push("no shortlist purge job among " + rows.length);
  else if (job.ch_timeout == null || String(job.ch_timeout).trim() === "") miss.push(job.ch_jobname + " has no statement_timeout of its own");
  else if (job.ch_active === false) miss.push(job.ch_jobname + " is switched off");
  else if (job.ch_last_status === "failed") miss.push(job.ch_jobname + " last ran and failed");
  if (c(del) !== "42501") miss.push("the deletions log answered anon " + c(del) + " (want 42501)");
  if (c(rpc) !== "42501") miss.push("shortlist_delete_candidate answered anon " + c(rpc) + " (want 42501)");
  if (read && !chunk.includes("shortlist_delete_candidate")) miss.push("the Shortlist chunk has no delete control");
  if (!miss.length) say("PASS", "S14X-073 decided (" + o + "): " + job.ch_jobname + " runs " + job.ch_schedule + " with statement_timeout " + job.ch_timeout + ", the deletions log and shortlist_delete_candidate exist and refuse anon, and the page offers the delete");
  else if (roundLive) say("FAIL", "S14X-073 decided (" + o + ") and the round is live, but " + miss.join("; "));
  else say("INFO", "S14X-073 decided (" + o + "): waits for the paste (" + miss.join("; ") + ")");
} else if (/^B/i.test(o)) {
  if (!read) say("INFO", "S14X-073 decided (" + o + "): the page cannot be read, so the copy cannot be judged (F0 says why)");
  else if (/Records retained 4 years|deleted after 4 years|four-year purge/i.test(chunk)) say(fe ? "FAIL" : "INFO", "S14X-073 decided (" + o + "): the page still promises a four-year retention no job keeps");
  else if (fe) say("PASS", "S14X-073 decided (" + o + "): the page promises no four-year retention and says records stay until the account is closed");
  else say("INFO", "S14X-073 decided (" + o + "): waits for the round to publish");
} else say("FAIL", "S14X-073 ownerDecided names S14X-073 as " + JSON.stringify(o) + ", which is neither rule A nor rule B");
'

echo "INFO  proven in the suite, never here (each needs an employer session and a model call): what the scorer stores on each refusal path, that a failed attestation removes the row (a-failed-attestation-log-left-a-scored-candidate-behind), the notice trigger's clock and its future-date refusal (a-shortlist-notice-log-keeps-the-servers-clock, pglite), and the redaction corpus that loses no job evidence (shortlist-redaction-passed-english-prose-proxies). Owner read-only SQL after the paste: SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shortlist_notices' AND column_name IN ('logged_at', 'recipients') -- two rows"
