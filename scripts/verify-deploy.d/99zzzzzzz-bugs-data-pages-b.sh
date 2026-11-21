# shellcheck shell=bash
# ── 99zzzzzzz-bugs-data-pages-b. THE BUG ROUND OF 2026-11-08, PART B, LANE
# DATA-PAGES-B (branch bugs/b-data-pages): the closure rollup's suspect
# column (one migration, 20261113100000; the integrator sets the final
# stamp), the company page's header and Pay card, and the German Austria
# CV-standards page; with the side branch bugs/b-data-pages-census, the field
# curve closed to the publishable key (20261113101000). No function changes
# in this lane.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it.
#
# THE STAGES, read from production and the repo, never assumed:
#   db        a migration has applied once a drizzle stub in
#             drizzle/migrations names its file or holds its text (Lovable's
#             runner writes one per applied file, under the file's name, a
#             staged name, or a title of its own over the same SQL; matched by
#             title, so a new stamp from the integrator still counts). Each of
#             the two files is staged on its own. Until then a missing column,
#             or a curve anon still reaches, prints INFO; from then on, a FAIL.
#   frontend  the entry, or the Jobs chunk with every chunk it imports,
#             carries one of this lane's code markers: the merge published.
#             Until then each page claim is INFO; from then on a missing
#             marker is a FAIL. The bake ships in the same publish.
#
# THE CLAIMS, one line each:
#   D1  S14X-159       job_board_closure_rollup has suspect_n and anon cannot
#                      read it: the column probe answers 42501, not 42703,
#                      and never 200.
#   D2  CW2-SC5        the field curve answers only the service role: a POST
#                      whose day count cannot cast answers 42501, not 22P02.
#   F1  S14X-195       the company header and Pay card read whose roles the
#                      intel counts: their two keys in the code, the English
#                      label in the US English strings.
#   F2  RC-OI-42/header  a board with no name is headed by its hiring system,
#                      never its token: the two headings and the menu label,
#                      and the English heading in the US English strings.
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
# WHERE THE ENGLISH LABEL AND HEADING ARE READ. Not in the entry: since the
# English strings travel with the pages that read them, the entry carries
# neither, and the published site carries both in its US English strings
# chunk (rb-en_all) and, as the t() call's default, in the Jobs chunk. F1 and
# F2 read the label and the heading from the first chunk
# scripts/verify-us-english.sh prints that carries the company shard's
# countriesLabel key (rb-en_all, else the entry, else another US en-* chunk;
# never en-GB), as sections 52g, 62 and 72 find their strings. At main
# 4a3c2a0bd (2026-11-21) both lines FAILed on a site that carried both
# strings, because they looked in the entry alone.
#
# READ-ONLY. GETs of the homepage, its entry, the US English strings chunks,
# the Jobs chunk and the chunks it imports, one baked page, and one PostgREST
# column probe of a table anon is denied; one POST to a read RPC whose
# argument cannot cast, so the curve never runs (D2). Nothing is written.
echo "== 99zzzzzzz-bugs-data-pages-b. bug round part B, data-pages-b: a suspect takedown has its own column, the field curve answers only the service role, a pooled fact says so, no system code is a heading, the chip names its board, Austria in German says what English says =="

rm -f /tmp/vd_bdpb_*
VDDPB_DRIZZLE="${VDDPB_DRIZZLE:-drizzle/migrations}"
VDDPB_MIGDIR="${VDDPB_MIGDIR:-supabase/migrations}"

# The published app: the entry, then the Jobs chunk with every chunk it imports.
curl -s -m 30 "$SITE/" -o /tmp/vd_bdpb_home.html
VDDPB_MAIN=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_bdpb_home.html 2>/dev/null | head -1)
if [ -n "$VDDPB_MAIN" ]; then curl -s -m 60 "$SITE$VDDPB_MAIN" -o /tmp/vd_bdpb_entry.js; else : > /tmp/vd_bdpb_entry.js; fi
# The US English strings: the first chunk verify-us-english.sh prints that
# carries the company shard's countriesLabel key (never en-GB).
: > /tmp/vd_bdpb_en.js
VDDPB_ENCH=""
if [ -n "$VDDPB_MAIN" ]; then
  for VDDPB_C in $(bash scripts/verify-us-english.sh "$SITE$VDDPB_MAIN"); do
    rm -f /tmp/vd_bdpb_encand.js
    curl -s -m 60 "$SITE/assets/$VDDPB_C" -o /tmp/vd_bdpb_encand.js
    grep -q 'countriesLabel' /tmp/vd_bdpb_encand.js 2>/dev/null || continue
    cp /tmp/vd_bdpb_encand.js /tmp/vd_bdpb_en.js
    VDDPB_ENCH=$VDDPB_C
    break
  done
fi
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

# The field curve, asked with a day count that cannot cast. A POST carries its
# arguments as JSON that the statement converts after the executor checked
# EXECUTE, so a closed function answers 42501 and an open one 22P02, and in
# neither case does the curve run (live 2026-11-17: a reader the census closed
# answered 42501, an open one 22P02, the curve 22P02 in 0.36 s). A GET would
# not do: it casts the query string first and answers 22P02 either way.
curl -s -m 30 -X POST "$B/rest/v1/rpc/get_category_fill_curve" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"p_days":"x","p_min_n":300}' -o /tmp/vd_bdpb_curve.json

VDDPB_P=/tmp/vd_bdpb_ VDDPB_DRIZZLE="$VDDPB_DRIZZLE" VDDPB_MIGDIR="$VDDPB_MIGDIR" VDDPB_ENCH="$VDDPB_ENCH" SITE="$SITE" node -e '
const fs = require("fs");
const P = process.env.VDDPB_P;
const txt = (f) => { try { return fs.readFileSync(P + f, "utf8"); } catch { return ""; } };
const count = (s, needle) => s.split(needle).length - 1;
const say = (v, m) => console.log(v + "  " + m);
const head = (s) => JSON.stringify(String(s).slice(0, 80));

// ---- the stages ----
const FILE = "a_pruned_takedown_is_counted_in_the_column_its_mark_names";
const CURVE_FILE = "a_field_curve_no_page_calls_answers_only_the_service_role";
// The SQL with its comments and runs of whitespace set aside, as the deploy
// ledger compares a stub Lovable retyped with its file (sqlText).
const sqlText = (s) => String(s || "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
const appliedFile = (name) => {
  let ours = "";
  try { const m = fs.readdirSync(process.env.VDDPB_MIGDIR).find((f) => f.endsWith("_" + name + ".sql")); if (m) ours = sqlText(fs.readFileSync(process.env.VDDPB_MIGDIR + "/" + m, "utf8")); } catch {}
  try {
    const dir = process.env.VDDPB_DRIZZLE;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".sql")) continue;
      if (f.includes(name)) return true;
      let s = ""; try { s = fs.readFileSync(dir + "/" + f, "utf8"); } catch {}
      if (s.includes(name) || (ours && sqlText(s) === ours)) return true;
    }
  } catch {}
  return false;
};
const applied = appliedFile(FILE);
const curveApplied = appliedFile(CURVE_FILE);
const ENTRY = txt("entry.js"), BOARD = txt("board.js"), CODE = ENTRY + "\n" + BOARD;
// The US English strings verify-us-english.sh found, and where.
const EN = txt("en.js"), ENCH = process.env.VDDPB_ENCH || "";
const LABEL = "Most roles across the {{company}} hiring system in";
const HEADING = "Roles on a {{system}} board";
const inEnglish = (what, needle) => ENCH ? "the English " + what + " in the US English strings (" + ENCH + ") x" + count(EN, needle) : "the English " + what + " x0 (no US English strings chunk the entry names carries countriesLabel)";
const MARKS = {
  F1: ["companyProfile.facts.countriesLabelPooled", "companyProfile.pay.floorPooled"],
  F2: ["companyProfile.h1SystemBoard", "companyProfile.h1ThisBoard", "companyProfile.actions.moreThis"],
  F3: ["companyProfile.employerChipOneBoard", "data-employer-chip-board"],
};
const FE = Object.values(MARKS).some((ms) => ms.some((m) => CODE.includes(m)));
say("INFO", "stages: database " + (applied ? "applied (a drizzle stub names " + FILE + ")" : "pending (no drizzle stub names " + FILE + " yet)") + ", field curve " + (curveApplied ? "applied (a drizzle stub names " + CURVE_FILE + ")" : "pending") + "; frontend " + (FE ? "published" : "not published (neither the entry nor the Jobs chunks carry a marker of this lane)"));
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

// ---- D2 CW2-SC5 ----
{
  const s = txt("curve.json");
  let j = null; try { j = JSON.parse(s); } catch {}
  const code = j && !Array.isArray(j) && typeof j === "object" ? String(j.code ?? "") : "";
  if (code === "42501") say("PASS", "D2 CW2-SC5 get_category_fill_curve refuses the publishable key (42501): the field curve answers only the service role");
  else if (code === "22P02") say(curveApplied ? "FAIL" : "INFO", "D2 CW2-SC5 the publishable key still reaches get_category_fill_curve (22P02 from the argument, so nothing ran)" + (curveApplied ? " although the migration applied" : " -- the migration has not applied yet"));
  else say("FAIL", "D2 CW2-SC5 the field curve probe answered " + (Array.isArray(j) ? "rows, so the curve ran on an argument that cannot cast" : j ? JSON.stringify(j).slice(0, 160) : "non-JSON " + head(s)));
}

// ---- F1-F3, the company page ----
{
  const miss = (k) => MARKS[k].filter((m) => !CODE.includes(m));
  const f1 = miss("F1");
  feVerdict(!f1.length && EN.includes(LABEL), "F1 S14X-195 the header and Pay card say whose roles the intel counts: " + MARKS.F1.map((m) => m + " x" + count(CODE, m)).join(", ") + ", " + inEnglish("label", LABEL));
  const f2 = miss("F2");
  feVerdict(!f2.length && EN.includes(HEADING), "F2 RC-OI-42/header a board with no name is headed by its hiring system: " + MARKS.F2.map((m) => m + " x" + count(CODE, m)).join(", ") + ", " + inEnglish("heading", HEADING));
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
