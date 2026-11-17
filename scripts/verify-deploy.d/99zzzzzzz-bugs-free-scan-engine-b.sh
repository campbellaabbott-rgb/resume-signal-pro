# shellcheck shell=bash
# ── 99zzzzzzz-bugs-free-scan-engine-b. BUG ROUND B, LANE FREE-SCAN-ENGINE-B
# (branch bugs/b-free-scan-engine). The free scanners' presence test, both
# copies of term-presence.ts: a singular is no longer found in a plural that
# is another word ("security" in "Securities and Exchange Commission",
# RC-OI-25), and a word broken by a line-end hyphen, a soft hyphen, a
# zero-width space or a non-ASCII hyphen is read as the word (S14X-280, the
# scanner's half). The scanner's model chain ends at gemini-2.5-pro: the
# third step it had is not served by the gateway (CW2-AI1), in the shared
# list (free-keyword-scan, test-ai-fallback) and the stream fork's hand copy.
#
# THE CLAIMS, one line each:
#   B   free-keyword-scan serves 2026-11-15.3 or later (above part A's
#       2026-11-15.2), free-keyword-scan-stream and test-ai-fallback
#       2026-11-13.1 or later, on their preflights. While none does, INFO
#       (not pasted yet); once one does, another older is a FAIL (a partial
#       paste). A preflight with no x-fn-build is a FAIL either way. The
#       integrator's stamps are the numbers in VDFSB_WANT below;
#   T   offline, at this checkout, through tsx: both term-presence.ts copies
#       read "manage-" / "ment", "Kuber" + U+00AD + "netes", "CI" + U+2011 +
#       "CD" and "Py" + U+200B + "thon" as present, and "security" as absent
#       from a text that only names the Securities and Exchange Commission
#       or securities trading; the control, "a security clearance", is
#       present. Without tsx the line is INFO (nothing read);
#   I   the two copies are byte-identical (a hand fork that drifted is a
#       FAIL);
#   M   offline: the shared chain (_shared/scan-models.ts) and the stream
#       fork's AI_MODELS no longer name OpenAI's 4o-mini, which the gateway
#       never served, and the fork's list is the shared one, in order.
#
# WHAT THIS SECTION CANNOT SEE: which models a scan asks, and that a 402
# stops at the first, needs a scan (a model call, a report and a metric
# written), so it is proven in the suite on the shipped handlers
# (a-diagnostic-that-tests-a-chain-production-never-runs-passes-for-nothing,
# a-scan-that-delivered-nothing-gives-its-day-back), and test-ai-fallback
# answers only the owner's key. The owner's read is printed as INFO.
#
# READ-ONLY. Three OPTIONS preflights, and reads of this checkout. Nothing is
# posted and no scan is run.
echo "== 99zzzzzzz-bugs-free-scan-engine-b. bug round B free-scan-engine-b: three builds, the presence test in both copies, the model chain =="

VDFSB_WANT="${VDFSB_WANT:-free-keyword-scan:2026-11-15:3 free-keyword-scan-stream:2026-11-13:1 test-ai-fallback:2026-11-13:1}"
VDFSB_TP_PRIMARY="${VDFSB_TP_PRIMARY:-supabase/functions/free-keyword-scan/term-presence.ts}"
VDFSB_TP_STREAM="${VDFSB_TP_STREAM:-supabase/functions/free-keyword-scan-stream/term-presence.ts}"
VDFSB_CHAIN="${VDFSB_CHAIN:-supabase/functions/_shared/scan-models.ts}"
VDFSB_FORK="${VDFSB_FORK:-supabase/functions/free-keyword-scan-stream/index.ts}"
rm -f /tmp/vd_fseb_hdr /tmp/vd_fseb_presence.json

# B: the three builds.
VDFSB_NEW=""
VDFSB_OLD=""
for VDFSB_W in $VDFSB_WANT; do
  VDFSB_F=${VDFSB_W%%:*}; VDFSB_R=${VDFSB_W#*:}; VDFSB_D=${VDFSB_R%%:*}; VDFSB_N=${VDFSB_R#*:}
  rm -f /tmp/vd_fseb_hdr
  curl -s -m 30 -D /tmp/vd_fseb_hdr -o /dev/null -X OPTIONS "$B/functions/v1/$VDFSB_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST"
  VDFSB_H=$(tr -d '\r' < /tmp/vd_fseb_hdr 2>/dev/null | grep -ai '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -n "$VDFSB_H" ] && build_ge "$VDFSB_F" "$VDFSB_H" "$VDFSB_D" "$VDFSB_N"; then VDFSB_NEW="$VDFSB_NEW $VDFSB_F=$VDFSB_H=$VDFSB_D.$VDFSB_N"
  else VDFSB_OLD="$VDFSB_OLD $VDFSB_F=${VDFSB_H:-none}=$VDFSB_D.$VDFSB_N"; fi
done
VDFSB_LIVE=0
[ -n "$VDFSB_NEW" ] && VDFSB_LIVE=1
for VDFSB_P in $VDFSB_NEW; do
  VDFSB_F=${VDFSB_P%%=*}; VDFSB_R=${VDFSB_P#*=}
  echo "PASS  B $VDFSB_F preflight x-fn-build = ${VDFSB_R%%=*} (${VDFSB_R#*=} or later: bug round B)"
done
for VDFSB_P in $VDFSB_OLD; do
  VDFSB_F=${VDFSB_P%%=*}; VDFSB_R=${VDFSB_P#*=}; VDFSB_H=${VDFSB_R%%=*}; VDFSB_WB=${VDFSB_R#*=}
  if [ "$VDFSB_H" = none ]; then echo "FAIL  B $VDFSB_F preflight carries no x-fn-build (not deployed, or its preflight does not answer; want $VDFSB_F.$VDFSB_WB or later)"
  elif [ "$VDFSB_LIVE" = 1 ]; then echo "FAIL  B $VDFSB_F preflight x-fn-build = $VDFSB_H while another of this lane's functions serves bug round B: a partial paste (want $VDFSB_F.$VDFSB_WB or later)"
  else echo "INFO  B $VDFSB_F preflight x-fn-build = $VDFSB_H: bug round B's free-scan-engine-b ($VDFSB_WB) is not pasted yet"; fi
done

# T: the presence test, both copies, read here.
VDFSB_TP_PRIMARY="$VDFSB_TP_PRIMARY" VDFSB_TP_STREAM="$VDFSB_TP_STREAM" npx --no-install tsx -e '
const path = require("path");
const cases = [
  ["S14X-280 a line-end hyphen", "Led project manage-\nment for the rollout", "management", true],
  ["S14X-280 a soft hyphen", "Ran Kuber­netes clusters", "Kubernetes", true],
  ["S14X-280 a non-breaking hyphen", "Built CI‑CD pipelines", "CI/CD", true],
  ["S14X-280 a zero-width space", "Wrote Py​thon services", "Python", true],
  ["RC-OI-25 the Securities and Exchange Commission", "Filed reports with the Securities and Exchange Commission on time.", "security", false],
  ["RC-OI-25 securities trading", "Traded fixed-income securities for institutional clients.", "security", false],
  ["control a security clearance", "Held a security clearance.", "security", true],
];
(async () => {
  const out = [];
  for (const [copy, file] of [["free-keyword-scan", process.env.VDFSB_TP_PRIMARY], ["free-keyword-scan-stream", process.env.VDFSB_TP_STREAM]]) {
    const m = await import(path.resolve(file));
    for (const [name, text, term, want] of cases) out.push({ copy, name, want, got: m.resumeHasTerm(text, term) });
  }
  process.stdout.write(JSON.stringify(out));
})().catch(() => {});' > /tmp/vd_fseb_presence.json 2>/dev/null
node -e '
const fs = require("fs");
let rows = null;
try { rows = JSON.parse(fs.readFileSync("/tmp/vd_fseb_presence.json", "utf8")); } catch {}
if (!Array.isArray(rows) || rows.length === 0) { console.log("INFO  T the presence test could not be read here (no tsx, or the module did not load): both copies are proven in the suite (a-hyphen-or-invisible-character-does-not-hide-a-skill-on-the-resume, a-singular-skill-is-not-found-in-a-plural-that-is-another-word)"); process.exit(0); }
for (const copy of ["free-keyword-scan", "free-keyword-scan-stream"]) {
  const mine = rows.filter((r) => r.copy === copy);
  const bad = mine.filter((r) => r.got !== r.want);
  if (mine.length === 0) console.log("FAIL  T " + copy + " term-presence.ts answered nothing");
  else if (bad.length === 0) console.log("PASS  T " + copy + " term-presence.ts reads all " + mine.length + " cases right: a word broken by a line end, a soft hyphen, a non-ASCII hyphen or a zero-width space is the word, and security is not found in securities");
  else console.log("FAIL  T " + copy + " term-presence.ts reads " + bad.map((r) => r.name + " as " + (r.got ? "present" : "absent")).join("; "));
}'

# I: the two copies are one file.
if [ -f "$VDFSB_TP_PRIMARY" ] && [ -f "$VDFSB_TP_STREAM" ] && cmp -s "$VDFSB_TP_PRIMARY" "$VDFSB_TP_STREAM"; then
  echo "PASS  I the stream fork's term-presence.ts is byte-identical to the primary's"
else
  echo "FAIL  I the stream fork's term-presence.ts differs from the primary's (or one is missing): the two scanners read the same résumé differently"
fi

# M: the model chain names only models the gateway serves, in both lists.
VDFSB_CHAIN="$VDFSB_CHAIN" VDFSB_FORK="$VDFSB_FORK" node -e '
const fs = require("fs");
const read = (f) => { try { return fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " "); } catch { return null; } };
const names = (s) => s === undefined || s === null ? null : [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const shared = names((/SCAN_MODEL_CHAIN[^=]*=\s*\[([^\]]*)\]/.exec(read(process.env.VDFSB_CHAIN) || "") || [])[1]);
const fork = names((/const AI_MODELS = \[([^\]]*)\]/.exec(read(process.env.VDFSB_FORK) || "") || [])[1]);
const NEVER_SERVED = ["openai/gpt-4o-mini"];
const unserved = (l) => l.filter((m) => NEVER_SERVED.includes(m));
if (!shared || shared.length === 0 || !fork || fork.length === 0) console.log("FAIL  M the model chain could not be read here (shared " + JSON.stringify(shared) + ", stream fork " + JSON.stringify(fork) + "): the layout moved");
else if (unserved(shared).length || unserved(fork).length) console.log("FAIL  M the scanner chain still names a model the gateway does not serve: " + [...new Set([...unserved(shared), ...unserved(fork)])].join(", ") + " (shared " + shared.join(" > ") + "; stream fork " + fork.join(" > ") + ")");
else if (shared.join(",") !== fork.join(",")) console.log("FAIL  M the stream fork walks " + fork.join(" > ") + " where the shared chain is " + shared.join(" > "));
else console.log("PASS  M both scanners walk " + shared.join(" > ") + ": no step the gateway does not serve");'

echo "INFO  owner (read-only): in Lovable, More > AI, the AI activity list shows no new run on the OpenAI 4o-mini model after this paste; a run that does names a scanner still on its old build"
