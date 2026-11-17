# shellcheck shell=bash
# ── 99zzzzzzz-bugs-data-pages-b. THE BUG ROUND OF 2026-11-08, PART B, LANE
# DATA-PAGES-B (branch bugs/b-data-pages): the closure rollup's suspect
# column (one migration, 20261113100000; the integrator sets the final
# stamp), the company page's header and Pay card, and the German Austria
# CV-standards page. No function changes in this lane.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it.
#
# THE STAGES, read from production and the repo, never assumed:
#   db        the migration has applied once a drizzle stub in
#             drizzle/migrations names its file or holds its text (Lovable's
#             runner writes one per applied file, under the file's name, a
#             staged name, or a title of its own over the same SQL; matched by
#             title, so a new stamp from the integrator still counts). Until
#             then a missing column prints INFO; from then on, a FAIL.
#   frontend  the entry, or the Jobs chunk with every chunk it imports,
#             carries one of this lane's code markers: the merge published.
#             Until then each page claim is INFO; from then on a missing
#             marker is a FAIL. The bake ships in the same publish.
#
# THE CLAIMS, one line each:
#   D1  S14X-159       job_board_closure_rollup has suspect_n and anon cannot
#                      read it: the column probe answers 42501, not 42703,
#                      and never 200.
#   F1  S14X-195       the company header and Pay card read whose roles the
#                      intel counts: their two keys in the code, the English
#                      label in the entry.
#   F2  RC-OI-42/header  a board with no name is headed by its hiring system,
#                      never its token: the two headings and the menu label.
#   F3  S14X-161/header  the hiring chip names the board its record reads:
#                      its key and its data attribute.
#   B1  S14X-215       the German Austria page names the formal titles (Mag.)
#                      and makes no claim about Zeugnisse.
#   I1                 the browser checks no request can make (INFO only).
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the rollup's figures and
# its one-statement prune (a-pruned-takedown-is-counted-in-the-column-its-
# mark-names), the pooled wording on PwC's page (a-tenant-wide-fact-on-a-one-
# board-page-says-so), the zero page's heading and title (a-zero-page-never-
# prints-a-system-code-as-its-name), the chip's title (the-hiring-chip-names-
# the-board-its-record-reads), and the migration's own DO block.
#
# READ-ONLY. GETs of the homepage, its entry, the Jobs chunk and the chunks
# it imports, one baked page, and one PostgREST column probe of a table anon
# is denied. Nothing is posted.
echo "== 99zzzzzzz-bugs-data-pages-b. bug round part B, data-pages-b: a suspect takedown has its own column, a pooled fact says so, no system code is a heading, the chip names its board, Austria in German says what English says =="

rm -f /tmp/vd_bdpb_*
VDDPB_DRIZZLE="${VDDPB_DRIZZLE:-drizzle/migrations}"
VDDPB_MIGDIR="${VDDPB_MIGDIR:-supabase/migrations}"

# The published app: the entry, then the Jobs chunk with every chunk it imports.
curl -s -m 30 "$SITE/" -o /tmp/vd_bdpb_home.html
VDDPB_MAIN=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_bdpb_home.html 2>/dev/null | head -1)
if [ -n "$VDDPB_MAIN" ]; then curl -s -m 60 "$SITE$VDDPB_MAIN" -o /tmp/vd_bdpb_entry.js; else : > /tmp/vd_bdpb_entry.js; fi
: > /tmp/vd_bdpb_board.js
VDDPB_JOBSN=$(grep -oE 'assets/Jobs-[A-Za-z0-9_-]+\.js' /tmp/vd_bdpb_entry.js 2>/dev/null | head -1 | sed 's#^assets/##')
if [ -n "$VDDPB_JOBSN" ]; then
  curl -s -m 60 "$SITE/assets/$VDDPB_JOBSN" -o /tmp/vd_bdpb_jobs.js
  cat /tmp/vd_bdpb_jobs.js >> /tmp/vd_bdpb_board.js 2>/dev/null
  for VDDPB_C in $(grep -oE 'from"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bdpb_jobs.js 2>/dev/null | sed -E 's/^from"\.\/(.*)"$/\1/' | sort -u); do
    case "$VDDPB_C" in index-*) continue;; esac
    rm -f /tmp/vd_bdpb_cand.js
    curl -s -m 30 "$SITE/assets/$VDDPB_C" -o /tmp/vd_bdpb_cand.js
    { echo; cat /tmp/vd_bdpb_cand.js 2>/dev/null; } >> /tmp/vd_bdpb_board.js
  done
fi

# The bake, as a crawler reads it.
curl -s -m 60 -A "$UA" "$SITE/de/lebenslauf-standards/oesterreich" -o /tmp/vd_bdpb_at.html

# The database: a column probe of a table anon is denied (42501 when the
# column exists, 42703 when it does not). A GET with limit=0 reads no row.
curl -s -m 30 "$B/rest/v1/job_board_closure_rollup?select=suspect_n&limit=0" -H "apikey: $K" -H "Authorization: Bearer $K" -o /tmp/vd_bdpb_roll.json

VDDPB_P=/tmp/vd_bdpb_ VDDPB_DRIZZLE="$VDDPB_DRIZZLE" VDDPB_MIGDIR="$VDDPB_MIGDIR" SITE="$SITE" node -e '
const fs = require("fs");
const P = process.env.VDDPB_P;
const txt = (f) => { try { return fs.readFileSync(P + f, "utf8"); } catch { return ""; } };
const count = (s, needle) => s.split(needle).length - 1;
const say = (v, m) => console.log(v + "  " + m);
const head = (s) => JSON.stringify(String(s).slice(0, 80));

// ---- the stages ----
const FILE = "a_pruned_takedown_is_counted_in_the_column_its_mark_names";
// The SQL with its comments and runs of whitespace set aside, as the deploy
// ledger compares a stub Lovable retyped with its file (sqlText).
const sqlText = (s) => String(s || "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
let ours = "";
try { const m = fs.readdirSync(process.env.VDDPB_MIGDIR).find((f) => f.endsWith("_" + FILE + ".sql")); if (m) ours = sqlText(fs.readFileSync(process.env.VDDPB_MIGDIR + "/" + m, "utf8")); } catch {}
let applied = false;
try {
  const dir = process.env.VDDPB_DRIZZLE;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".sql")) continue;
    if (f.includes(FILE)) { applied = true; break; }
    let s = ""; try { s = fs.readFileSync(dir + "/" + f, "utf8"); } catch {}
    if (s.includes(FILE) || (ours && sqlText(s) === ours)) { applied = true; break; }
  }
} catch {}
const ENTRY = txt("entry.js"), BOARD = txt("board.js"), CODE = ENTRY + "\n" + BOARD;
const MARKS = {
  F1: ["companyProfile.facts.countriesLabelPooled", "companyProfile.pay.floorPooled"],
  F2: ["companyProfile.h1SystemBoard", "companyProfile.h1ThisBoard", "companyProfile.actions.moreThis"],
  F3: ["companyProfile.employerChipOneBoard", "data-employer-chip-board"],
};
const FE = Object.values(MARKS).some((ms) => ms.some((m) => CODE.includes(m)));
say("INFO", "stages: database " + (applied ? "applied (a drizzle stub names " + FILE + ")" : "pending (no drizzle stub names " + FILE + " yet)") + "; frontend " + (FE ? "published" : "not published (neither the entry nor the Jobs chunks carry a marker of this lane)"));
const feVerdict = (good, m) => say(good ? "PASS" : FE ? "FAIL" : "INFO", m + (good || FE ? "" : " -- the frontend of this round is not published yet"));

// ---- D1 S14X-159 ----
{
  const s = txt("roll.json");
  let j = null; try { j = JSON.parse(s); } catch {}
  const code = j && !Array.isArray(j) && typeof j === "object" ? String(j.code ?? "") : "";
  if (Array.isArray(j)) say("FAIL", "D1 S14X-159 anon READ job_board_closure_rollup (the probe answered rows, not 42501): the closure rollup is open to the publishable key");
  else if (code === "42501") say("PASS", "D1 S14X-159 job_board_closure_rollup.suspect_n exists and anon is denied (42501): a suspect takedown has its own column");
  else if (code === "42703") say(applied ? "FAIL" : "INFO", "D1 S14X-159 job_board_closure_rollup has no suspect_n (42703)" + (applied ? " although the migration applied" : " -- the migration has not applied yet"));
  else say("FAIL", "D1 S14X-159 the suspect_n probe answered " + (j ? JSON.stringify(j).slice(0, 160) : "non-JSON " + head(s)));
}

// ---- F1-F3, the company page ----
{
  const miss = (k) => MARKS[k].filter((m) => !CODE.includes(m));
  const f1 = miss("F1");
  const label = "Most roles across the {{company}} hiring system in";
  feVerdict(!f1.length && ENTRY.includes(label), "F1 S14X-195 the header and Pay card say whose roles the intel counts: " + MARKS.F1.map((m) => m + " x" + count(CODE, m)).join(", ") + ", the English label in the entry x" + count(ENTRY, label));
  const f2 = miss("F2");
  const heading = "Roles on a {{system}} board";
  feVerdict(!f2.length && ENTRY.includes(heading), "F2 RC-OI-42/header a board with no name is headed by its hiring system: " + MARKS.F2.map((m) => m + " x" + count(CODE, m)).join(", ") + ", the English heading in the entry x" + count(ENTRY, heading));
  const f3 = miss("F3");
  feVerdict(!f3.length, "F3 S14X-161/header the hiring chip names the board its record reads: " + MARKS.F3.map((m) => m + " x" + count(CODE, m)).join(", "));
}

// ---- B1 S14X-215 ----
{
  const at = txt("at.html");
  const mag = count(at, "Mag."), zeug = count(at, "Zeugnisse werden erwartet");
  if (!at) say(FE ? "FAIL" : "INFO", "B1 S14X-215 /de/lebenslauf-standards/oesterreich answered nothing");
  else feVerdict(mag > 0 && zeug === 0, "B1 S14X-215 /de/lebenslauf-standards/oesterreich: \"Mag.\" x" + mag + " (want 1 or more), \"Zeugnisse werden erwartet\" x" + zeug + " (want 0)");
}

// ---- I1, what only a browser can see ----
say("INFO", "I1 read-only browser checks: " + process.env.SITE + "/jobs/company/pwc~wd3~US_Experienced_Careers reads \"Most roles across the PwC hiring system in\" and its Pay line says \"whole hiring system\"; an unnamed UKG board page has no ~ token in its h1 or title; on " + process.env.SITE + "/jobs/company/pwc~wd3~Global_Experienced_Careers the [data-employer-chip] title opens with the board its record reads");
'
