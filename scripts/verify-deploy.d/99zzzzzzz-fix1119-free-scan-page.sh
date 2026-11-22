# shellcheck shell=bash
# ── 99zzzzzzz-fix1119-free-scan-page. THE BUG RECONCILE OF 2026-11-19, LANE
# FREE-SCAN-PAGE (branch fix/1119-free-scan-page): seventeen items on the free
# report, the scanner's market list, the builder's tag lists and the uploader.
# The lane changes no function and no migration; the merge publishes it with
# the page.
#
# THE CHUNKS, read from production with the crawler's user agent, never
# assumed: /resume-checker preloads the scanner's chunk (/assets/Index-*.js),
# which carries the market list and names the report's chunk
# (FreeKeywordResults-*.js). The role cards (src/config/personalization.ts)
# ride in the report chunk or in one it imports: the one that holds the
# Physician card. The entry (/assets/index-*.js) names the builder's chunk
# (ResumeBuilder-*.js); the tag list rides in it or in one it imports: the one
# that reads resumeBuilder.tagList.typeToAdd.
#
# THE STAGE: the lane's marks in the report chunk, its score breakdown's
# heading key (freeScanPage.report.breakdown) and the realism nudge's mark
# (data-realism-nudge). Until both are published every claim that the lane
# changes is INFO ("not yet published", with what holds today); from then on
# it is PASS or FAIL.
#
# THE CLAIMS, one line each:
#   L0  every chunk below can be read (FAIL when the layout moved).
#   L1  the stage; FAIL when only one of the two marks is published.
#   S14X-057  the report chunk holds none of the six English headings as text.
#   OI-28     the Physician card's alias list has no bare "specialist".
#   S14X-032  the scanner chunk's market list holds Kuwait, Qatar, Bahrain and
#             Oman (KW, QA, BH, OM).
#   NB-45     the builder's tag input has an aria-label beside its placeholder.
#   SCAN-01   the findings builder reads a red flag's issue before its title
#             and flag fields.
#   SCAN-05   the quantification finding reads the scan's score field, and
#             the bare-number branch that compared the object is gone.
#   X1  INFO: the rest is proved in the suite (the tests named below).
#
# READ-ONLY. GETs of /resume-checker, the home page and their chunks. Nothing
# is posted and no scan is run.
echo "== 99zzzzzzz-fix1119-free-scan-page. bug reconcile 2026-11-19, free-scan-page lane: the free report's findings, headings, cards and inputs =="

rm -f /tmp/vd_f19fsp_page.html /tmp/vd_f19fsp_idx.js /tmp/vd_f19fsp_fkr.js /tmp/vd_f19fsp_roles.js \
  /tmp/vd_f19fsp_home.html /tmp/vd_f19fsp_entry.js /tmp/vd_f19fsp_rb.js /tmp/vd_f19fsp_tags.js /tmp/vd_f19fsp_cand.js
curl -s -m 30 -A "$UA" "$SITE/resume-checker" > /tmp/vd_f19fsp_page.html
VDF19_IDX=$(grep -ao '/assets/Index-[A-Za-z0-9_-]*\.js' /tmp/vd_f19fsp_page.html | head -1)
[ -n "$VDF19_IDX" ] && curl -s -m 60 -A "$UA" "$SITE$VDF19_IDX" > /tmp/vd_f19fsp_idx.js
VDF19_FKR=$( { [ -f /tmp/vd_f19fsp_idx.js ] && grep -ao 'FreeKeywordResults-[A-Za-z0-9_-]*\.js' /tmp/vd_f19fsp_idx.js; } | head -1)
[ -n "$VDF19_FKR" ] && curl -s -m 60 -A "$UA" "$SITE/assets/$VDF19_FKR" > /tmp/vd_f19fsp_fkr.js

# The role cards: the report chunk itself, or a chunk it imports.
VDF19_ROLES=""
if [ -s /tmp/vd_f19fsp_fkr.js ]; then
  if grep -qF 'name:"Physician"' /tmp/vd_f19fsp_fkr.js; then VDF19_ROLES=$VDF19_FKR; cp /tmp/vd_f19fsp_fkr.js /tmp/vd_f19fsp_roles.js
  else
    for VDF19_C in $(grep -aoE 'from"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_f19fsp_fkr.js | sed -E 's/^from"\.\/(.*)"$/\1/' | sort -u); do
      case "$VDF19_C" in index-*) continue;; esac
      rm -f /tmp/vd_f19fsp_cand.js
      curl -s -m 30 -A "$UA" "$SITE/assets/$VDF19_C" > /tmp/vd_f19fsp_cand.js
      if grep -qF 'name:"Physician"' /tmp/vd_f19fsp_cand.js; then VDF19_ROLES=$VDF19_C; cp /tmp/vd_f19fsp_cand.js /tmp/vd_f19fsp_roles.js; break; fi
    done
  fi
fi

# The builder's tag list: the builder chunk itself, or a chunk it imports.
curl -s -m 30 -A "$UA" "$SITE/" > /tmp/vd_f19fsp_home.html
VDF19_MAIN=$(grep -ao '/assets/index-[^"]*\.js' /tmp/vd_f19fsp_home.html | head -1)
[ -n "$VDF19_MAIN" ] && curl -s -m 60 -A "$UA" "$SITE$VDF19_MAIN" > /tmp/vd_f19fsp_entry.js
VDF19_RB=$( { [ -f /tmp/vd_f19fsp_entry.js ] && grep -aoE 'ResumeBuilder-[A-Za-z0-9_-]+\.js' /tmp/vd_f19fsp_entry.js; } | head -1)
[ -n "$VDF19_RB" ] && curl -s -m 30 -A "$UA" "$SITE/assets/$VDF19_RB" > /tmp/vd_f19fsp_rb.js
VDF19_TAGS=""
if [ -s /tmp/vd_f19fsp_rb.js ]; then
  if grep -qF 'resumeBuilder.tagList.typeToAdd' /tmp/vd_f19fsp_rb.js; then VDF19_TAGS=$VDF19_RB; cp /tmp/vd_f19fsp_rb.js /tmp/vd_f19fsp_tags.js
  else
    for VDF19_C in $(grep -aoE 'from"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_f19fsp_rb.js | sed -E 's/^from"\.\/(.*)"$/\1/' | sort -u); do
      case "$VDF19_C" in index-*) continue;; esac
      rm -f /tmp/vd_f19fsp_cand.js
      curl -s -m 30 -A "$UA" "$SITE/assets/$VDF19_C" > /tmp/vd_f19fsp_cand.js
      if grep -qF 'resumeBuilder.tagList.typeToAdd' /tmp/vd_f19fsp_cand.js; then VDF19_TAGS=$VDF19_C; cp /tmp/vd_f19fsp_cand.js /tmp/vd_f19fsp_tags.js; break; fi
    done
  fi
fi

VDF19_N_IDX="$VDF19_IDX" VDF19_N_FKR="$VDF19_FKR" VDF19_N_ROLES="$VDF19_ROLES" VDF19_N_RB="$VDF19_RB" VDF19_N_TAGS="$VDF19_TAGS" node -e '
const fs = require("fs");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const E = process.env;
const idx = rd("/tmp/vd_f19fsp_idx.js"), fkr = rd("/tmp/vd_f19fsp_fkr.js");
const roles = rd("/tmp/vd_f19fsp_roles.js"), tags = rd("/tmp/vd_f19fsp_tags.js");
const say = (v, id, m) => console.log(v + "  " + id + " " + m);

// L0: the layout.
const unread = [];
if (!E.VDF19_N_IDX || !idx) unread.push("the scanner chunk (/resume-checker preloads no readable /assets/Index-*.js)");
else if (!E.VDF19_N_FKR || !fkr) unread.push("the report chunk (the scanner chunk names no readable FreeKeywordResults-*.js)");
if (fkr && (!E.VDF19_N_ROLES || !roles)) unread.push("the role cards (neither the report chunk nor a chunk it imports holds the Physician card)");
if (!E.VDF19_N_RB) unread.push("the builder chunk (the entry names no ResumeBuilder-*.js)");
else if (!E.VDF19_N_TAGS || !tags) unread.push("the tag list (neither the builder chunk nor a chunk it imports reads resumeBuilder.tagList.typeToAdd)");
if (unread.length) {
  say("FAIL", "L0", "could not read " + unread.join("; ") + ": the bundle layout moved, so this lane cannot be judged");
  process.exit(0);
}
say("INFO", "L0", "chunks read: " + [E.VDF19_N_IDX.replace("/assets/", ""), E.VDF19_N_FKR, E.VDF19_N_ROLES, E.VDF19_N_RB, E.VDF19_N_TAGS].join(", "));

// L1: the stage.
const markA = fkr.includes("freeScanPage.report.breakdown");
const markB = /"data-realism-nudge":/.test(fkr);
const live = markA && markB;
if (live) say("PASS", "L1", "the report chunk carries both of the lane\x27s marks (the breakdown\x27s heading key and the realism nudge\x27s mark): the merge carrying fix/1119-free-scan-page published");
else if (markA || markB) say("FAIL", "L1", "the report chunk carries only the " + (markA ? "breakdown heading key" : "realism nudge mark") + ": the report was not built from one commit of the lane");
else say("INFO", "L1", "the report chunk carries neither of the lane\x27s marks: the merge has not published, so the lane\x27s claims below are INFO");

const verdict = (id, holds, what, why) => {
  if (live) say(holds ? "PASS" : "FAIL", id, what + (holds ? "" : " — but " + why));
  else say("INFO", id, what + ": not yet published (" + (holds ? "already holds today" : "today: " + why) + ")");
};

// S14X-057: the six English headings, as string literals.
const HEADINGS = ["Skills Freshness", "Career Trajectory", "Keywords Expected at Your Level", "Employment Timeline", "Employment gap detected", "Score Breakdown"];
const left = HEADINGS.filter((h) => fkr.includes(h));
verdict("S14X-057", left.length === 0, "the report\x27s deeper cards and its score breakdown head themselves in the reader\x27s language", "the report chunk still holds " + left.map((h) => JSON.stringify(h)).join(", "));

// OI-28: the Physician card\x27s aliases.
const physician = roles.match(/name:"Physician",aliases:\[([^\]]*)\]/);
if (!physician) say("FAIL", "OI-28", "the Physician card has no alias list the check can read in " + E.VDF19_N_ROLES + ": the card moved, so the claim cannot be judged");
else {
  const aliases = (physician[1].match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1));
  verdict("OI-28", !aliases.includes("specialist"), "a Marketing, HR or Payroll Specialist is not handed the Physician card: its aliases (" + aliases.length + ") hold no bare \"specialist\"", "the Physician card\x27s aliases still hold \"specialist\"");
}

// S14X-032: the GCC four in the market list.
const MARKETS = ["KW", "QA", "BH", "OM"];
if (!/\["SA","Saudi Arabia \(GCC\)"\]/.test(idx)) say("FAIL", "S14X-032", "the scanner chunk holds no market list the check can read (no [\"SA\",\"Saudi Arabia (GCC)\"] pair): the list moved, so the claim cannot be judged");
else {
  const missing = MARKETS.filter((c) => !new RegExp("\\[\"" + c + "\",\"[^\"]+\"\\]").test(idx));
  verdict("S14X-032", missing.length === 0, "the scanner\x27s \"Applying in\" list offers Kuwait, Qatar, Bahrain and Oman, as the country pages link them", "the market list lacks " + missing.join(", "));
}

// NB-45: the tag input\x27s name, read in the props right after its
// placeholder (the remove button\x27s own label sits before it).
const at = tags.indexOf("resumeBuilder.tagList.typeToAdd");
const after = tags.slice(at, at + 160);
const named = /^[^}]*"aria-label":/.test(after);
verdict("NB-45", named, "the builder\x27s skills and certifications inputs are named by their section heading, not by their placeholder", "the tag input in " + E.VDF19_N_TAGS + " has a placeholder and no aria-label");

// SCAN-01: the findings builder reads issue first.
const oldRead = /(\w+)\.title\|\|\1\.flag/.test(fkr) || /(\w+)\.title\|\|(\w+)\.flag\b/.test(fkr);
const newRead = /\[(\w+)\.issue,\1\.title,\1\.flag\]/.test(fkr);
verdict("SCAN-01", newRead && !oldRead, "a red flag the scanner sends (its sentence in issue) is counted in the summary, the Findings index, the PDF and the mail", oldRead ? "the findings builder still reads title||flag with no issue before it" : "the findings builder\x27s read of issue, title and flag is not in the report chunk");

// SCAN-05: the quantification finding reads .score.
const dead = /typeof (\w+)=="number"&&\1<40/.test(fkr);
const reads = /typeof (\w+)\?\.score=="number"/.test(fkr);
verdict("SCAN-05", !dead && reads, "the quantification finding reads the scan\x27s score field", dead ? "the report chunk still compares the quantification object as a bare number (typeof X==\"number\"&&X<40)" : "no read of a quantification score field was found in the report chunk");

say("INFO", "X1", "proved in the suite, not from outside: a second scan keeps the first (a-second-scan-keeps-the-first-in-the-history), the corrected industry reaches the tips, the coach and the share card, the length tip follows the market, a heading is not flagged by a bullet, a fallback report in French prints no English finding, the backup report names the posting it did not compare, the contact card never ticks a missing phone, a report with no contact facts claims none, and every icon-only button has a name");
'
