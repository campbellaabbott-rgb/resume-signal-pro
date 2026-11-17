# shellcheck shell=bash
# ── 99zzzzzzz-bugs-site-shell-b. THE BUG ROUND OF 2026-11-08, PART B, LANE
# SITE-SHELL-B (branch bugs/b-site-shell): the skip link speaks the reader's
# language (S14X-177); a move to another page is said and focused
# (S14X-256); a crash in the browser is written to the error log whatever
# the analytics choice, and never to the A/B list (NB-42). Frontend only: no
# function and no migration changes in this lane.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it.
#
# THE STAGE, read from production, never assumed:
#   frontend  the served entry carries one of this lane's code markers: the
#             round's publish is live. Until then each code claim is INFO;
#             from then on a missing marker is a FAIL (one entry carries all
#             three keys, so one present and another missing is a broken
#             build, not a late one).
#
# THE CLAIMS, one line each:
#   H1        the served /pricing opens <body> with the shell's skip link, the
#             one link S14X-177 localises (judged at every stage: the
#             localiser and every skip-link press depend on it);
#   S14X-177  the entry carries the shell link's localiser and its key, and
#             the German site-shell chunk the entry names carries
#             siteShell.skipToMain in this commit's German words;
#   S14X-256  the entry carries the route announcer (#rb-route-announcer)
#             and the modal-dialog rule it waits on;
#   NB-42     the entry writes crashes through log_error_telemetry
#             (CRASH_<where>, window error and unhandledrejection), and no
#             longer sends the A/B event client_error;
#   I1/I2     what needs a browser or the service role (INFO only).
#
# READ-ONLY. GETs of /pricing, its entry and one German string chunk.
# Nothing is posted, no RPC is called, no key is printed.
echo "== 99zzzzzzz-bugs-site-shell-b. bug round part B, site-shell-b: the skip link in the reader's language, a route change said and focused, crashes in the error log =="

rm -f /tmp/vd_bssb_*
VDSSB_SHARD_DIR="${VDSSB_SHARD_DIR:-src/i18n/shards/site-shell}"

curl -s -m 30 "$SITE/pricing" -o /tmp/vd_bssb_page.html
VDSSB_MAIN=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_bssb_page.html 2>/dev/null | head -1)
if [ -n "$VDSSB_MAIN" ]; then curl -s -m 60 "$SITE$VDSSB_MAIN" -o /tmp/vd_bssb_entry.js; else : > /tmp/vd_bssb_entry.js; fi
# The German site-shell strings: the chunk the entry maps ./shards/site-shell/de.json to.
VDSSB_DE=$(grep -oE '"\./shards/site-shell/de\.json":[^"]{0,40}"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bssb_entry.js 2>/dev/null | head -1 | grep -oE '[A-Za-z0-9_-]+\.js"$' | tr -d '"')
if [ -n "$VDSSB_DE" ]; then curl -s -m 30 "$SITE/assets/$VDSSB_DE" -o /tmp/vd_bssb_de.js; else : > /tmp/vd_bssb_de.js; fi

VDSSB_P=/tmp/vd_bssb_ VDSSB_MAIN="$VDSSB_MAIN" VDSSB_DE="$VDSSB_DE" VDSSB_SHARD_DIR="$VDSSB_SHARD_DIR" node -e '
const fs = require("fs");
const E = process.env;
const txt = (f) => { try { return fs.readFileSync(E.VDSSB_P + f, "utf8"); } catch { return ""; } };
const say = (v, m) => console.log(v + "  " + m);
const PAGE = txt("page.html"), ENTRY = txt("entry.js"), DE = txt("de.js");

// ---- the stage ----
const MARKS = {
  "S14X-177": ["siteShell.skipToMain", "body > a[href=\"#main-content\"]"],
  "S14X-256": ["rb-route-announcer", "[role=\"dialog\"][aria-modal=\"true\"]"],
  "NB-42": ["log_error_telemetry", "CRASH_", "unhandledrejection"],
};
const FE = Object.values(MARKS).some((ms) => ms.some((m) => ENTRY.includes(m)));
if (!ENTRY) say("FAIL", "stage /pricing named no entry script (" + (E.VDSSB_MAIN || "none found") + "), or it could not be read: the published app cannot be judged");
else say("INFO", "stage: frontend " + (FE ? "published (the entry " + E.VDSSB_MAIN + " carries a marker of this lane)" : "not published (the entry " + E.VDSSB_MAIN + " carries no marker of this lane)"));
const verdict = (good, m) => say(good ? "PASS" : FE ? "FAIL" : "INFO", m + (good || FE ? "" : " -- the round part B frontend is not published yet"));
const missing = (key) => MARKS[key].filter((m) => !ENTRY.includes(m));

// ---- H1: the shell link the localiser reads ----
const body = (PAGE.match(/<body[^>]*>([\s\S]*)$/i) || ["", ""])[1].replace(/<!--[\s\S]*?-->/g, "").trimStart();
const first = (body.match(/^<a\b[^>]*>/i) || [""])[0];
if (/href="#main-content"/.test(first)) say("PASS", "H1 /pricing opens <body> with the shell skip link (a[href=\"#main-content\"]), the link S14X-177 gives the reader language");
else say("FAIL", "H1 /pricing does not open <body> with the shell skip link (it opens " + JSON.stringify(body.slice(0, 60)) + "): every skip-link press and S14X-177 depend on it");

// ---- S14X-177 ----
let want = "";
try { want = JSON.parse(fs.readFileSync(E.VDSSB_SHARD_DIR + "/de.json", "utf8")).siteShell.skipToMain || ""; } catch { want = ""; }
const m177 = missing("S14X-177");
const deHas = !!want && DE.includes(JSON.stringify(want));
const deEnglish = /skipToMain:"Skip to main content"/.test(DE);
if (!want) say("FAIL", "S14X-177 this checkout has no siteShell.skipToMain in " + E.VDSSB_SHARD_DIR + "/de.json to compare the served chunk with");
else if (!m177.length && deHas && !deEnglish) say("PASS", "S14X-177 the entry localises the shell skip link (siteShell.skipToMain, " + JSON.stringify(MARKS["S14X-177"][1]) + ") and the German site-shell chunk " + E.VDSSB_DE + " says " + JSON.stringify(want));
else {
  const why = [];
  if (m177.length) why.push("the entry lacks " + m177.map((x) => JSON.stringify(x)).join(" and "));
  if (!E.VDSSB_DE) why.push("the entry names no chunk for ./shards/site-shell/de.json");
  else if (deEnglish) why.push("the German chunk " + E.VDSSB_DE + " gives the link the English words");
  else if (!deHas) why.push("the German chunk " + E.VDSSB_DE + " does not carry " + JSON.stringify(want));
  verdict(false, "S14X-177 the skip link is not in the reader language: " + why.join("; "));
}

// ---- S14X-256 ----
const m256 = missing("S14X-256");
verdict(!m256.length, "S14X-256 " + (m256.length ? "the entry lacks " + m256.map((x) => JSON.stringify(x)).join(" and ") + ": a move to another page is neither said nor focused" : "the entry carries the route announcer (#rb-route-announcer) and waits out an open modal dialog: a move to another page is said and focused"));

// ---- NB-42 ----
const m42 = missing("NB-42");
const abCrash = /testName:"client_error"/.test(ENTRY);
if (!m42.length && !abCrash) say("PASS", "NB-42 the entry writes crashes to the error log (log_error_telemetry, CRASH_<where>, window errors and unhandled rejections) and sends no client_error A/B event");
else if (!m42.length && abCrash) say("FAIL", "NB-42 the entry writes crashes to the error log but still sends the A/B event client_error: a crash still lands in the A/B list");
else verdict(false, "NB-42 the entry lacks " + m42.map((x) => JSON.stringify(x)).join(" and ") + (abCrash ? " and still sends the A/B event client_error" : "") + ": crashes do not reach the error log");
'

echo "INFO  I1 browser checks this read-only section cannot make (the suite proves them on the shipped code: the-skip-link-speaks-the-readers-language, a-route-change-moves-focus-to-the-new-page-and-says-its-title, a-crash-reaches-the-error-log-without-consent-and-never-the-ab-list): with locale de-DE and empty storage /pricing link reads the German words with lang de; from /pricing a header link pressed with Enter leaves focus on the new page main and #rb-route-announcer equal to document.title"
echo "INFO  I2 owner read-only SQL after the publish (service role, never held here): NB-42 SELECT error_code, count(*) FROM error_telemetry WHERE error_type = 'client' AND error_code LIKE 'CRASH%' AND created_at > :publish GROUP BY 1 -- rows appear as crashes happen (none is not a failure); SELECT count(*) FROM ab_test_events WHERE test_name = 'client_error' AND created_at > :publish + interval '2 days' -- near 0 (only tabs still on an earlier build send it; track-ab-event keeps accepting it until they are gone)"
