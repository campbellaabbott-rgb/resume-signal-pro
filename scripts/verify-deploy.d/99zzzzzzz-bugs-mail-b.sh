# shellcheck shell=bash
# ── 99zzzzzzz-bugs-mail-b. THE BUG ROUND OF 2026-11-08, PART B, LANE mail-b
# (branch bugs/b-mail): what the scan-report mails say an outcome answer is
# for (S14X-170). The answers go to scan_outcomes, which nothing reads, and
# the site says no public figure is built from them; the report ask, the
# day-6 line and the day-14 line now say the same in all nine languages, and
# the score preview is a rough guide, as on the site's report. One function
# at 2026-11-13.1 (the integrator's stamp): send-scan-report, through its own
# copy.ts. No migration, no page, no shard.
#
# THE STAGES, read from production, never assumed:
#   function  send-scan-report serves 2026-11-13.1 or later: the part-B paste
#             is live. Until then the item line is INFO; a function the paste
#             left behind is section 49's to list. (Part A's stamp,
#             2026-11-12.1, is not this lane's build: it still says the old
#             lines.)
#
# THE CLAIMS, one line each:
#   B          send-scan-report serves 2026-11-13.1 or later.
#   R0         the repo's copy.ts, read in all nine languages, says the
#              answers help study which scores lead to interviews, says no
#              public figure is built from them yet, says none of the old
#              lines, and calls the preview a rough guide; and index.ts prints
#              those lines in the report mail and the day-6 and day-14 mails
#              (offline: a report mail is sent only to an inbox that asked
#              for one, so none is sent here; the build says which code is
#              live).
#   S14X-170   the report and follow-up mails promise no public figure from
#              an outcome answer.
#
# READ-ONLY. One OPTIONS preflight. Nothing is posted, scanned, mailed or
# written; no key is printed.
echo "== 99zzzzzzz. bug round part B, mail-b: send-scan-report's build, and what its mails say an outcome answer is for =="

rm -f /tmp/vd_bmb_pre.txt

curl -s -m 30 -D /tmp/vd_bmb_pre.txt -o /dev/null -X OPTIONS "$B/functions/v1/send-scan-report" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST"
VDBMB_BUILD=$( { tr -d '\r' < /tmp/vd_bmb_pre.txt | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g'; } 2>/dev/null)
VDBMB_FN=0
[ -n "$VDBMB_BUILD" ] && build_ge send-scan-report "$VDBMB_BUILD" 2026-11-13 1 && VDBMB_FN=1

VDBMB_BUILD="$VDBMB_BUILD" VDBMB_FN="$VDBMB_FN" \
VDBMB_COPY="${VDBMB_COPY:-supabase/functions/send-scan-report/copy.ts}" VDBMB_FN_SRC="${VDBMB_FN_SRC:-supabase/functions/send-scan-report/index.ts}" \
node --input-type=module -e '
import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const E = process.env;
const say = (v, m) => console.log(v.padEnd(5) + " " + m);
const build = E.VDBMB_BUILD || "";
const fnNew = E.VDBMB_FN === "1";

// ── B: the build.
if (!build) say("FAIL", "B send-scan-report preflight carries no x-fn-build (want send-scan-report.2026-11-13.1 or later): the function is not deployed, or its preflight does not answer");
else if (fnNew) say("PASS", "B send-scan-report x-fn-build = " + build + " (2026-11-13.1 or later)");
else say("INFO", "B send-scan-report x-fn-build = " + build + ": the part-B paste with 2026-11-13.1 has not landed (section 49 lists the gap)");

// ── R0: the repo code the build claims, read offline.
const LANGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const STUDY = {
  en: /helps? us study which scores lead to interviews/i,
  "en-GB": /helps? us study which scores lead to interviews/i,
  de: /hilft uns zu untersuchen, welche Scores zu Vorstellungsgesprächen führen/,
  es: /nos ayuda a estudiar qué puntuaciones llevan a entrevistas/,
  fr: /nous aide à étudier quels scores mènent à des entretiens/,
  hi: /समझने में मदद करता है कि कौन-से स्कोर इंटरव्यू तक ले जाते हैं/,
  nl: /helpt (die )?ons te onderzoeken welke scores tot gesprekken leiden/,
  pt: /nos ajuda a estudar quais pontuações levam a entrevistas/,
  tl: /pag-aralan kung aling mga score ang humahantong sa interview/,
};
const NO_FIGURE = {
  en: /no public figure is built from the answers yet/i,
  "en-GB": /no public figure is built from the answers yet/i,
  de: /eine öffentliche Zahl entsteht aus den Antworten noch nicht/i,
  es: /todavía no publicamos ninguna cifra basada en las respuestas/i,
  fr: /aucun chiffre public n\x27est encore tiré des réponses/i,
  hi: /जवाबों से अभी कोई सार्वजनिक आँकड़ा नहीं बनाया गया है/,
  nl: /er wordt nog geen openbaar cijfer van de antwoorden gemaakt/i,
  pt: /ainda não publicamos nenhum número com base nas respostas/i,
  tl: /wala pa kaming inilalabas na pampublikong numero mula sa mga sagot/i,
};
// What the old lines claimed, one pattern per claim and language.
const OLD = /benchmark|how we measure|helps us measure|Vergleichswerte|so messen wir|hilft uns zu messen|datos de referencia públicos|así medimos|nos ayuda a medir|repères publics|est ainsi que nous mesurons|nous aide à mesurer|सार्वजनिक मानकों|इसी से हम मापते हैं|पता चलता है कि कौन-से स्कोर सच में|openbare maatstaven|zo meten we|helpt ons meten|parâmetros públicos|é assim que medimos|nos ajuda a medir|ganyan namin sinusukat|para masukat namin/i;
const ROUGH = {
  en: "(a rough guide)", "en-GB": "(a rough guide)", de: "(ein grober Richtwert)", es: "(una guía aproximada)", fr: "(une indication approximative)",
  hi: "(एक मोटा अनुमान)", nl: "(een ruwe indicatie)", pt: "(uma estimativa aproximada)", tl: "(magaspang na gabay)",
};
let table = null, why = "";
try { table = (await import(pathToFileURL(resolve(E.VDBMB_COPY)).href)).REPORT_COPY; }
catch (e) { why = String(e && e.code || e && e.message || e).slice(0, 120); }
let src = "";
try { src = fs.readFileSync(E.VDBMB_FN_SRC, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); } catch { src = ""; }
let r0 = null;
if (!table || typeof table !== "object") {
  if (/ERR_UNKNOWN_FILE_EXTENSION|ERR_UNSUPPORTED/.test(why)) say("INFO", "R0 the repo copy.ts could not be loaded by this node (" + why + "): S14X-170 is judged by the build alone");
  else { r0 = false; say("FAIL", "R0 the repo copy.ts gave no REPORT_COPY table (" + (why || "no such export") + ")"); }
} else {
  const link = (t) => "<a>" + t + "</a>";
  const call = (f, ...a) => { try { return typeof f === "function" ? String(f(...a)) : "(not a function)"; } catch (e) { return "(threw " + (e && e.message) + ")"; } };
  const bad = [];
  for (const l of LANGS) {
    const c = table[l];
    if (!c) { bad.push(l + " is missing from the table"); continue; }
    const lines = { outcomeAsk: String(c.outcomeAsk ?? ""), day6Outcome: call(c.day6Outcome, link, link), day14Why: String(c.day14Why ?? "") };
    for (const [k, t] of Object.entries(lines)) {
      if (!STUDY[l].test(t)) bad.push(l + " " + k + " does not say the answers help study which scores lead to interviews: " + JSON.stringify(t.slice(0, 120)));
      const old = OLD.exec(t);
      if (old) bad.push(l + " " + k + " still says " + JSON.stringify(old[0]));
    }
    for (const k of ["outcomeAsk", "day14Why"]) if (!NO_FIGURE[l].test(lines[k])) bad.push(l + " " + k + " does not say no public figure is built from the answers yet");
    const p = call(c.projected, 81);
    if (!p.includes("81") || !p.includes(ROUGH[l])) bad.push(l + " projected does not call 81 " + ROUGH[l] + ": " + JSON.stringify(p.slice(0, 120)));
  }
  const wired = /\$\{c\.outcomeAsk\}/.test(src) && /\$\{c\.day6Outcome\(/.test(src) && /\$\{c\.day14Why\}/.test(src) && /\$\{c\.projected\(/.test(src);
  if (!wired) bad.push("send-scan-report/index.ts no longer prints c.outcomeAsk, c.day6Outcome(...), c.day14Why and c.projected(...) in its mails");
  r0 = bad.length === 0;
  if (r0) say("PASS", "R0 the repo copy says, in all " + LANGS.length + " languages, that an answer helps study which scores lead to interviews and that no public figure is built from the answers yet, says none of the old lines, calls the preview a rough guide, and index.ts prints those lines");
  else say("FAIL", "R0 the repo code does not do what the round claims (" + bad.length + "): " + bad.slice(0, 4).join("; ") + (bad.length > 4 ? "; and " + (bad.length - 4) + " more" : ""));
}

// ── S14X-170: the repo code, then the build.
const what = "the report mail, the day-6 mail and the day-14 mail say an outcome answer helps us study which scores lead to interviews and that no public figure is built from the answers yet, in all nine languages";
if (r0 === false) say("FAIL", "S14X-170 the repo code does not do it (R0 says why): " + what);
else if (fnNew) say("PASS", "S14X-170 send-scan-report serves " + build + (r0 ? " (R0 proves the code)" : "") + ": " + what);
else say("INFO", "S14X-170 waits for the part-B paste (send-scan-report serves " + (build || "no build") + "): " + what);
'

echo "INFO  proven in the suite, never here (a report mail is sent only to an inbox that asked for it, and the fix-plan sequence is withdrawn): that the report mail, the day-6 mail and the day-14 mail print these lines, and that the preview carries the site report's own rough-guide words in each language (the-scan-report-mails-promise-no-public-figure-from-an-outcome-answer)"
