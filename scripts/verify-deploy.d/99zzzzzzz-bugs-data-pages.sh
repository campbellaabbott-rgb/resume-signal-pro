# shellcheck shell=bash
# ── 99zzzzzzz-bugs-data-pages. THE BUG ROUND OF 2026-11-08, LANE DATA-PAGES
# (branch bugs/a-data-pages): the five data pages (/ghost-job-index,
# /hiring-trends, /pay-transparency, /research/ats-score-benchmarks,
# /data-api), their bake, llms.txt, the company-page bake and seven
# migrations (20261112190000 financials, 191000 trending fields, 191500 the
# weekly series, 192000 and 192500 the fill chains, 194000 the Ghost Index
# row, 195000 the scan floor; the integrator sets the final stamps). No
# function changes in this lane.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE STAGES, read from production, never assumed:
#   db        get_public_scan_insights answers band_floor: 20261112195000,
#             the lane's last file, applied, and with it every earlier one
#             (the runner applies a round's files in stamp order and stops at
#             the first that fails). Until then each database claim prints
#             INFO with today's reading; from then on, a FAIL.
#   frontend  any of the five page chunks carries one of this branch's
#             markers: the merge published. Until then the page claims are
#             INFO; from then on a chunk missing its own marker is a FAIL.
#   bake      any of the bake's markers is served (the /trust allowance line,
#             the freshness denominator, the application route in llms.txt,
#             the affiliate periods, the per-connection allowance). The bake
#             and llms.txt ship with the frontend publish; until then INFO.
#   owner     a line that depends on an owner's answer prints INFO 'owner
#             pending' until reservations['bug-round'].ownerDecided in
#             docs/deploy-ledger.json names its key: NB-5, SEO-F24, SEO-F03,
#             SEO-F10 and RC-S12-016 (their options are on
#             bugs/a-data-pages-owner).
#
# THE CLAIMS, one line each:
#   D1  S14X-026  a filing's revenue is the company's: no row's net income
#                 above its revenue, the latest revenue at filing scale.
#   D2  S14X-038  get_trending_categories(p_watch_days) answers.
#   D3  NB-46     get_hiring_trends keeps its shape (week_start,
#                 new_postings, closed).
#   D4  S14X-066  a fill chain counts a role that came back as no fill:
#                 fills_90d within filled_roles_90d.
#   D5  S14X-160  get_ghost_job_index_stats returns stale_parts.
#   D6  S14X-273  the Ghost Index row states open_window_days 30, and its
#                 open count is not above the chips' measured beside it.
#   D7  S14X-193  no histogram band under 25 scans; an 80+ share only over 25.
#   F1  S14X-160  the Ghost Index, Hiring Trends and Pay chunks say what was
#                 carried (their data- markers).
#   F2  S14X-192  the Ghost Index chunk counts closure events, not roles.
#   F3  S14X-194  the freshness sample is job boards holding a live posting,
#                 in the chunk and the bake.
#   F4  S14X-193  the score chunk counts the scans it held back.
#   F5  SEO-F07   the Ghost Index chunk names a stale audit run's age.
#   F6  S14X-255  no bare toLocale*() in the five page chunks.
#   F7  S14X-065  the DataApi chunk and the /data-api bake say where a
#                 /v1/changes reader resumes (settledThrough, resumeCursor).
#   B1  RC-S13-105  GET /v1/jobs/{id}/application in llms.txt, llms-full, the
#                 /data-api bake and the DataApi chunk.
#   B2  S14X-043  llms.txt promises the same full report on a rescan.
#   B3  RC-S13-094/bake  /trust prints both allowances from scan-allowance.ts.
#   B4  S14X-259/bake  /agents names no network address; its connection hosts
#                 carry their own allowance line.
#   B5  S14X-212/bake  /affiliates lists the dashboard's four periods.
#   B6  RC-S12-021/bake  /landers.json maps PwC's below-cut US board to PwC's
#                 page.
#   B7  S14X-214 + SEO-F16  the Spanish industry pages print the engine's
#                 terms, under a capitalised description.
#   B8  NB-32     the /ghost-job-index cadence words match the live schedule.
#   B9  SEO-F17   /companies states each linked page's own count.
#   B10 SEO-F18   BreadcrumbList on /ats, the study and a translated CV page,
#                 whose trail is shown and marked up in its own language.
#   B11 SEO-F16   /ats descriptions open with no bare reply word.
#   B12 SEO-F11   /jobs' list prints no name the gate refuses.
#   B13 SEO-F08   a posting's markup country agrees with its employer's
#                 stated country (INFO until the reader states one).
#   B14 S14X-269  llms.txt's quote promise rides on the grounded engine
#                 (free-keyword-scan 2026-11-15.2 or later, above the hotfix).
#   O1  NB-5      no staffing board on the actively-hiring list.
#   O2  SEO-F24   the data pages' Dataset markup names a licence.
#   O3  SEO-F03   /jobs/company/usasurveyjob is not indexable.
#   O4  SEO-F10   an unbaked address is not served as an indexable homepage.
#   O5  RC-S12-016  get_company_fill_curve answers three boards in 10 s.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the pooled count on an
# employer page (an-employer-page-pools-every-board-it-runs), the markup
# withheld on a contradicted country (a-posting-line-and-its-markup-follow-
# the-page-and-the-employer), each page's carried note (each-data-page-is-
# dated-by-its-own-part), and each migration's own DO block.
#
# READ-ONLY. GETs of the homepage, its entry and five chunks, nineteen baked
# pages, /landers.json, llms.txt and llms-full.txt; GETs of eleven anon read
# functions; one OPTIONS preflight. Nothing is posted.
echo "== 99zzzzzzz-bugs-data-pages. bug round, data-pages lane: each page dated by its own part, the floors it says it keeps, the routes and terms it says it prints =="

rm -f /tmp/vd_bdp_*
VDDP_LEDGER="${VDDP_LEDGER:-docs/deploy-ledger.json}"

vddp_get() { curl -s -m 60 "$1" -o "$2"; }
vddp_bake() { curl -s -m 60 -A "$UA" "$SITE$1" -o "$2"; }
vddp_rpc() { curl -s -m 90 "$B/rest/v1/rpc/$1${2:+?$2}" -H "apikey: $K" -H "Authorization: Bearer $K" -o "$3"; }

# The published frontend: the entry, then five page chunks by name.
vddp_get "$SITE/" /tmp/vd_bdp_home.html
VDDP_ENTRY=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_bdp_home.html 2>/dev/null | head -1)
if [ -n "$VDDP_ENTRY" ]; then vddp_get "$SITE$VDDP_ENTRY" /tmp/vd_bdp_entry.js; else : > /tmp/vd_bdp_entry.js; fi
for VDDP_C in GhostJobIndex HiringTrends PayTransparencyIndex ScoreStudy DataApi; do
  VDDP_F=$(grep -oE "assets/$VDDP_C-[A-Za-z0-9_-]+\.js" /tmp/vd_bdp_entry.js 2>/dev/null | head -1)
  if [ -n "$VDDP_F" ]; then vddp_get "$SITE/$VDDP_F" "/tmp/vd_bdp_c_$VDDP_C.js"; else : > "/tmp/vd_bdp_c_$VDDP_C.js"; fi
done

# The bake, as a crawler reads it.
vddp_bake /ghost-job-index /tmp/vd_bdp_b_ghost.html
vddp_bake /trust /tmp/vd_bdp_b_trust.html
vddp_bake /agents /tmp/vd_bdp_b_agents.html
vddp_bake /affiliates /tmp/vd_bdp_b_aff.html
vddp_bake /data-api /tmp/vd_bdp_b_dataapi.html
vddp_bake /companies /tmp/vd_bdp_b_companies.html
vddp_bake /ats/lever /tmp/vd_bdp_b_lever.html
vddp_bake /ats/workday /tmp/vd_bdp_b_workday.html
vddp_bake /research/ats-score-benchmarks /tmp/vd_bdp_b_study.html
vddp_bake /es/normas-cv/espana /tmp/vd_bdp_b_cves.html
vddp_bake /es/industrias/legal /tmp/vd_bdp_b_eslegal.html
vddp_bake /es/industrias/finance /tmp/vd_bdp_b_esfin.html
vddp_bake /jobs /tmp/vd_bdp_b_jobs.html
vddp_bake /jobs/company/usasurveyjob /tmp/vd_bdp_b_survey.html
vddp_bake /zz-not-real /tmp/vd_bdp_b_unbaked.html
vddp_bake "/jobs/posting/workday/hcmportal~wd5~Search/R26040621" /tmp/vd_bdp_b_posting.html
vddp_get "$SITE/landers.json" /tmp/vd_bdp_landers.json
vddp_get "$SITE/llms.txt" /tmp/vd_bdp_llms.txt
vddp_get "$SITE/llms-full.txt" /tmp/vd_bdp_llmsfull.txt

# /companies: the first rows that state a count (PwC's first when it is
# listed), and the pages they link, to compare the two numbers.
VDDP_COS=$(VDDP_P=/tmp/vd_bdp_ node -e 'const fs=require("fs");let h="";try{h=fs.readFileSync(process.env.VDDP_P+"b_companies.html","utf8")}catch{}const rows=[...h.matchAll(/<a href="\/jobs\/company\/([A-Za-z0-9._~-]+)"[^>]*>[^<]*<\/a>(?:\s*<span[^>]*>\([^)]*\)<\/span>)?\s*<span[^>]*>— ([\d,]+) open roles<\/span>/g)].map((m)=>m[1]);const pwc=rows.filter((t)=>/^pwc~/.test(t));const out=[...new Set([...pwc,...rows])].slice(0,3);console.log(out.join(" "))' 2>/dev/null)
VDDP_I=0
for VDDP_T in $VDDP_COS; do VDDP_I=$((VDDP_I + 1)); vddp_bake "/jobs/company/$VDDP_T" "/tmp/vd_bdp_co_$VDDP_I.html"; done

# The database, through its anon readers (GET: a read-only transaction).
vddp_rpc get_public_scan_insights "" /tmp/vd_bdp_si.json
for VDDP_T in oscar mtb~wd5~mtb uhaul~wd1~UhaulJobs affirm; do vddp_rpc get_company_financials "p_token=$VDDP_T" "/tmp/vd_bdp_fin_$VDDP_T.json"; done
vddp_rpc get_trending_categories "p_watch_days=14" /tmp/vd_bdp_trend.json
vddp_rpc get_hiring_trends "" /tmp/vd_bdp_weeks.json
VDDP_T0=$(node -e 'console.log(Date.now())')
vddp_rpc get_company_fill_curve "p_tokens=%7BFonio,ATEXIS,jj~wd5~JJ%7D" /tmp/vd_bdp_fc.json
VDDP_FC_MS=$(( $(node -e 'console.log(Date.now())') - VDDP_T0 ))
vddp_rpc get_ghost_job_index_stats "" /tmp/vd_bdp_gji.json
vddp_rpc get_explore_cache "" /tmp/vd_bdp_ec.json
vddp_rpc get_stats_cache "" /tmp/vd_bdp_sc.json
vddp_rpc get_cron_health "p_hours=26" /tmp/vd_bdp_cron.json
VDDP_FKS=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/free-keyword-scan" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VDDP_FKS_ROUND=no
# The round's free-keyword-scan is 2026-11-15.2: the NB-1 hotfix stamped
# 2026-11-15.1 sorts above any 2026-11-12 floor and carries no grounding.
if [ -n "$VDDP_FKS" ] && build_ge free-keyword-scan "$VDDP_FKS" 2026-11-15 2; then VDDP_FKS_ROUND=yes; fi

# Every verdict, from the files above. JSON.parse is guarded throughout: a
# gateway's HTML body prints a FAIL or an INFO that shows it.
VDDP_P=/tmp/vd_bdp_ VDDP_LEDGER="$VDDP_LEDGER" VDDP_FKS="$VDDP_FKS" VDDP_FKS_ROUND="$VDDP_FKS_ROUND" VDDP_FC_MS="$VDDP_FC_MS" VDDP_COS="$VDDP_COS" node -e '
const fs = require("fs");
const P = process.env.VDDP_P;
const txt = (f) => { try { return fs.readFileSync(P + f, "utf8"); } catch { return ""; } };
const json = (f) => { const s = txt(f); try { return { ok: true, j: JSON.parse(s), s }; } catch { return { ok: false, j: null, s }; } };
const one = (j) => (Array.isArray(j) ? j[0] ?? null : j);
const count = (s, needle) => s.split(needle).length - 1;
const say = (v, m) => console.log(v + "  " + m);
const head = (s) => JSON.stringify(String(s).slice(0, 80));
let ledger = null; try { ledger = JSON.parse(fs.readFileSync(process.env.VDDP_LEDGER, "utf8")); } catch {}
const decided = (ledger && ledger.reservations && ledger.reservations["bug-round"] && ledger.reservations["bug-round"].ownerDecided) || {};
const owner = (k) => (decided && typeof decided === "object" && Object.prototype.hasOwnProperty.call(decided, k) ? String(decided[k] ?? "") : null);

// ---- the stages ----
const si = json("si.json");
const siRow = si.ok ? one(si.j) : null;
const DB = !!(siRow && typeof siRow === "object" && "band_floor" in siRow);
const C = { ghost: txt("c_GhostJobIndex.js"), trends: txt("c_HiringTrends.js"), pay: txt("c_PayTransparencyIndex.js"), score: txt("c_ScoreStudy.js"), data: txt("c_DataApi.js") };
const FE_MARK = { ghost: "data-ghost-stats-carried", trends: "data-trends-as-of", pay: "data-pay-carried", score: "data-band-floor-hidden", data: "settledThrough" };
const FE = Object.entries(FE_MARK).some(([k, m]) => C[k].includes(m));
const Bk = { ghost: txt("b_ghost.html"), trust: txt("b_trust.html"), agents: txt("b_agents.html"), aff: txt("b_aff.html"), data: txt("b_dataapi.html"), companies: txt("b_companies.html"), lever: txt("b_lever.html"), workday: txt("b_workday.html"), study: txt("b_study.html"), cves: txt("b_cves.html"), eslegal: txt("b_eslegal.html"), esfin: txt("b_esfin.html"), jobs: txt("b_jobs.html"), survey: txt("b_survey.html"), unbaked: txt("b_unbaked.html"), posting: txt("b_posting.html") };
const LLMS = txt("llms.txt"), LLMSF = txt("llmsfull.txt");
const BAKE_MARKS = [[Bk.trust, "with a free account)"], [Bk.ghost, "job boards we read that hold a live posting"], [LLMS, "/v1/jobs/{id}/application"], [Bk.aff, "over the last 7, 30, 90 or 365 days"], [Bk.agents, "for each internet connection an app calls from"]];
const BAKE = BAKE_MARKS.some(([s, m]) => s.includes(m));
say("INFO", "stages: database " + (DB ? "live (band_floor answered)" : "pending (get_public_scan_insights has no band_floor)") + "; frontend " + (FE ? "published" : "not published (no page chunk carries a marker of this round)") + "; bake " + (BAKE ? "published" : "not published (no bake marker served)"));
const dbVerdict = (good, m) => say(good ? "PASS" : DB ? "FAIL" : "INFO", m + (good || DB ? "" : " -- the lane'"'"'s migrations have not applied yet"));
const feVerdict = (good, m) => say(good ? "PASS" : FE ? "FAIL" : "INFO", m + (good || FE ? "" : " -- the round'"'"'s frontend is not published yet"));
const bakeVerdict = (good, m) => say(good ? "PASS" : BAKE ? "FAIL" : "INFO", m + (good || BAKE ? "" : " -- the round'"'"'s bake is not published yet"));

// ---- D1 S14X-026 ----
{
  const floor = { oscar: 1e9, affirm: 2e9, "uhaul~wd1~UhaulJobs": 3e9 };
  const bad = [], seen = [];
  let unread = 0;
  for (const tok of ["oscar", "mtb~wd5~mtb", "uhaul~wd1~UhaulJobs", "affirm"]) {
    const r = json("fin_" + tok + ".json");
    const d = r.ok ? one(r.j) : null;
    const s = d && Array.isArray(d.series) ? d.series : null;
    if (!s) { unread++; continue; }
    if (!s.length) continue;
    seen.push(tok);
    for (const x of s) if (typeof x.revenue === "number" && typeof x.net_income === "number" && x.net_income > 0 && x.net_income > x.revenue) bad.push(tok + " FY" + x.fy + " net income " + x.net_income + " > revenue " + x.revenue);
    const top = s.reduce((a, b) => ((b.fy ?? 0) > (a.fy ?? 0) ? b : a), s[0]);
    if (floor[tok] && typeof top.revenue === "number" && top.revenue < floor[tok]) bad.push(tok + " FY" + top.fy + " revenue " + top.revenue + " < " + floor[tok]);
  }
  if (!seen.length) say(unread ? "FAIL" : "INFO", "D1 S14X-026 get_company_financials answered " + (unread ? "no readable series for " + unread + " of 4 boards" : "no series for any of the four boards") + ", so the revenue line cannot be judged");
  else dbVerdict(!bad.length, "D1 S14X-026 company financials over " + seen.join(", ") + ": " + (bad.length ? bad.join("; ") : "every net income within its revenue, the latest revenue at filing scale"));
}

// ---- D2 S14X-038 ----
{
  const r = json("trend.json");
  if (r.ok && Array.isArray(r.j)) say("PASS", "D2 S14X-038 get_trending_categories(p_watch_days => 14) answers " + r.j.length + " fields: the two weeks read only boards watched through both");
  else if (r.ok && r.j && r.j.code === "PGRST202") dbVerdict(false, "D2 S14X-038 get_trending_categories(p_watch_days) does not exist (PGRST202)");
  else say("FAIL", "D2 S14X-038 get_trending_categories(p_watch_days => 14) answered " + (r.ok ? JSON.stringify(r.j).slice(0, 160) : "non-JSON " + head(r.s)));
}

// ---- D3 NB-46 ----
{
  const r = json("weeks.json");
  const rows = r.ok && Array.isArray(r.j) ? r.j : null;
  const shaped = !!rows && rows.length > 0 && rows.every((w) => w && "week_start" in w && "new_postings" in w && "closed" in w);
  if (shaped) say("PASS", "D3 NB-46 get_hiring_trends answers " + rows.length + " weeks in its own shape (week_start, new_postings, closed)" + (DB ? ", read since 20261112191500 over boards watched from the first week" : ""));
  else say(rows && !rows.length ? "INFO" : "FAIL", "D3 NB-46 get_hiring_trends answered " + (rows ? rows.length + " rows without its shape" : r.ok ? JSON.stringify(r.j).slice(0, 160) : "non-JSON " + head(r.s)));
}

// ---- D4 S14X-066 ----
{
  const r = json("fc.json");
  const rows = r.ok && Array.isArray(r.j) ? r.j : null;
  const read = (rows || []).filter((x) => x && typeof x.fills_90d === "number" && typeof x.filled_roles_90d === "number");
  if (!rows) say("FAIL", "D4 S14X-066 get_company_fill_curve answered " + (r.ok ? JSON.stringify(r.j).slice(0, 160) : "non-JSON " + head(r.s)));
  else if (!read.length) say("INFO", "D4 S14X-066 get_company_fill_curve answered no row with both counts for Fonio, ATEXIS, jj~wd5~JJ");
  else {
    const over = read.filter((x) => x.fills_90d > x.filled_roles_90d + Math.max(2, Math.round(x.filled_roles_90d * 0.02)));
    dbVerdict(!over.length, "D4 S14X-066 fills_90d within filled_roles_90d: " + read.map((x) => x.company_token + " " + x.fills_90d + " vs " + x.filled_roles_90d).join("; "));
  }
}

// ---- D5 S14X-160, D6 S14X-273 ----
{
  const r = json("gji.json");
  const g = r.ok ? one(r.j) : null;
  if (!g || typeof g !== "object" || g.code) say("FAIL", "D5 S14X-160 get_ghost_job_index_stats answered " + (r.ok ? JSON.stringify(r.j).slice(0, 160) : "non-JSON " + head(r.s)));
  else {
    dbVerdict("stale_parts" in g, "D5 S14X-160 get_ghost_job_index_stats returns stale_parts (keys: " + Object.keys(g).sort().join(",") + ")");
    const ec = json("ec.json");
    const cc = ec.ok && one(ec.j) && one(ec.j).chip_coverage;
    let msg = "open_window_days " + g.open_window_days + "; total_open " + g.total_open + " @" + g.computed_at;
    let good = g.open_window_days === 30;
    if (good && cc && typeof cc.open === "number" && typeof g.total_open === "number") {
      const dt = Math.abs(Date.parse(g.computed_at) - Date.parse(cc.at));
      msg += " vs chip_coverage.open " + cc.open + " @" + cc.at;
      if (Number.isFinite(dt) && dt <= 70 * 60000 && g.total_open > cc.open * 1.002) { good = false; msg += " (the Index counts 0.2% more than the board serves)"; }
    }
    dbVerdict(good, "D6 S14X-273 " + msg);
  }
}

// ---- D7 S14X-193 ----
{
  const s = siRow;
  if (!s || typeof s !== "object" || s.code) say("FAIL", "D7 S14X-193 get_public_scan_insights answered " + (si.ok ? JSON.stringify(si.j).slice(0, 160) : "non-JSON " + head(si.s)));
  else {
    const small = (s.histogram || []).filter((h) => (h.n || 0) < 25);
    const o = s.overall || {}, n = o.n || 0, p = o.pct_80_plus;
    const pOk = p === null || p === undefined || (n > 0 && (p * n) / 100 >= 24.5);
    dbVerdict(!small.length && pOk, "D7 S14X-193 bands under 25 scans: " + (small.length ? small.map((h) => h.bucket + ":" + h.n).join(", ") : "none") + "; pct_80_plus " + p + " of n " + n + (s.histogram_hidden_n !== undefined ? "; held back " + s.histogram_hidden_n : ""));
  }
}

// ---- F1-F7, the page chunks ----
{
  const miss = Object.entries({ ghost: FE_MARK.ghost, trends: FE_MARK.trends, pay: FE_MARK.pay }).filter(([k, m]) => !C[k].includes(m)).map(([k, m]) => k + " (" + m + ")");
  feVerdict(!miss.length, "F1 S14X-160 the Ghost Index, Hiring Trends and Pay chunks say what was carried" + (miss.length ? ": missing " + miss.join(", ") : ""));
  const took = count(C.ghost, "roles an employer took down");
  feVerdict(!took && C.ghost.includes("closure events"), "F2 S14X-192 GhostJobIndex chunk: \"roles an employer took down\" x" + took + ", \"closure events\" x" + count(C.ghost, "closure events"));
  const feeds = count(C.ghost, "company feeds") + count(Bk.ghost, "company feeds");
  feVerdict(!feeds && C.ghost.includes("job boards we read that hold a live posting"), "F3 S14X-194 the freshness sample: \"company feeds\" x" + feeds + " (chunk and bake), the live-posting denominator in the chunk x" + count(C.ghost, "job boards we read that hold a live posting"));
  feVerdict(C.score.includes(FE_MARK.score), "F4 S14X-193 ScoreStudy chunk counts the scans it held back (" + FE_MARK.score + " x" + count(C.score, FE_MARK.score) + ")");
  feVerdict(C.ghost.includes("but this is the latest run on record"), "F5 SEO-F07 GhostJobIndex chunk names a stale audit run'"'"'s age (x" + count(C.ghost, "but this is the latest run on record") + ")");
  // A chunk also carries the modules only its page imports. Two of them are
  // not this lane'"'"'s and still format bare: LayoffPartitionSection (2 calls,
  // in the Ghost Index chunk) and hiring-trends-trust (1, in Hiring Trends).
  // Live on 2026-11-16 the chunks held 13, 1, 1, 3 and 2.
  const ALLOW = { ghost: 2, trends: 1, pay: 0, score: 0, data: 0 };
  const bare = Object.entries(C).map(([k, s]) => [k, (s.match(/toLocale(?:Date|Time)?String\(\)/g) || []).length]);
  feVerdict(bare.every(([k, n]) => n <= ALLOW[k]), "F6 S14X-255 bare toLocale*() in the five page chunks: " + bare.map(([k, n]) => k + "=" + n + (ALLOW[k] ? " (" + ALLOW[k] + " from a module not this lane'"'"'s)" : "")).join(" "));
  const rs = (s) => s.includes("settledThrough") && s.includes("resumeCursor");
  feVerdict(rs(C.data) && (!BAKE || rs(Bk.data)), "F7 S14X-065 /v1/changes resumes at settledThrough/resumeCursor: chunk " + rs(C.data) + ", /data-api bake " + rs(Bk.data));
}

// ---- B1-B14, the bake and llms.txt ----
{
  const route = "jobs/{id}/application";
  const where = { "llms.txt": count(LLMS, route), "llms-full": count(LLMSF, route), "/data-api bake": count(Bk.data, route), "DataApi chunk": count(C.data, route) };
  const allThere = Object.values(where).every((n) => n > 0);
  say(allThere ? "PASS" : BAKE || FE ? "FAIL" : "INFO", "B1 RC-S13-105 GET /v1/" + route + ": " + Object.entries(where).map(([k, n]) => k + " x" + n).join(", ") + (allThere || BAKE || FE ? "" : " -- the round is not published yet"));
  bakeVerdict(LLMS.includes("returns the same full report under the same report ID; a partial report is not kept"), "B2 S14X-043 llms.txt names the cached report a full report and says a partial one is not kept");
  let free = null, signed = null;
  try { const a = fs.readFileSync("src/config/scan-allowance.ts", "utf8"); free = (/FREE_SCANS_PER_DAY\s*=\s*(\d+)/.exec(a) || [])[1] ?? null; signed = (/SIGNED_IN_SCANS_PER_DAY\s*=\s*(\d+)/.exec(a) || [])[1] ?? null; } catch {}
  if (!free || !signed) say("FAIL", "B3 RC-S13-094/bake src/config/scan-allowance.ts did not name both allowances, so /trust cannot be judged");
  else bakeVerdict(Bk.trust.includes(free + " free scans a day (" + signed + " with a free account)"), "B3 RC-S13-094/bake /trust says \"" + free + " free scans a day (" + signed + " with a free account)\" (scan-allowance.ts)");
  const netAddr = count(Bk.agents, "per network address");
  bakeVerdict(!netAddr && Bk.agents.includes("for each internet connection an app calls from") && Bk.agents.includes("your own internet connection"), "B4 S14X-259/bake /agents: \"per network address\" x" + netAddr + ", a connection'"'"'s day x" + count(Bk.agents, "for each internet connection an app calls from") + ", the own-connection allowance line x" + count(Bk.agents, "your own internet connection"));
  bakeVerdict(!Bk.aff.includes("any date range you pick") && Bk.aff.includes("over the last 7, 30, 90 or 365 days"), "B5 S14X-212/bake /affiliates: \"any date range you pick\" x" + count(Bk.aff, "any date range you pick") + ", the four periods x" + count(Bk.aff, "over the last 7, 30, 90 or 365 days"));
  const L = json("landers.json");
  const us = L.ok && L.j && typeof L.j === "object" ? L.j["pwc~wd3~US_Experienced_Careers"] : undefined;
  if (!L.ok) say(BAKE ? "FAIL" : "INFO", "B6 RC-S12-021/bake /landers.json is not JSON: " + head(L.s));
  else bakeVerdict(typeof us === "string" && /\/jobs\/company\/pwc~wd3~Global_Experienced_Careers$/.test(us), "B6 RC-S12-021/bake /landers.json maps pwc~wd3~US_Experienced_Careers to " + JSON.stringify(us ?? null) + " (want PwC'"'"'s Global page)");
  const desc = (h) => (/<meta name="description" content="([^"]*)"/.exec(h) || [])[1] ?? null;
  const dl = desc(Bk.eslegal);
  bakeVerdict(count(Bk.eslegal, "litigios") > 0 && count(Bk.esfin, "contador") > 0 && !!dl && /^[A-ZÁÉÍÓÚÑ]/.test(dl), "B7 S14X-214 + SEO-F16 /es/industrias/legal \"litigios\" x" + count(Bk.eslegal, "litigios") + ", /es/industrias/finance \"contador\" x" + count(Bk.esfin, "contador") + ", legal description " + JSON.stringify((dl || "").slice(0, 40)));
  const cr = json("cron.json");
  const rows = cr.ok && Array.isArray(cr.j) ? cr.j : null;
  const phrase = (expr) => { const f = String(expr ?? "").trim().split(/\s+/); if (f.length !== 5 || f.slice(1).some((x) => x !== "*")) return null; const st = /^\*\/(\d+)$/.exec(f[0]); if (st) return "recomputed every " + st[1] + " minutes"; if (!/^\d+(,\d+)*$/.test(f[0])) return null; const n = f[0].split(",").length; return n === 1 ? "recomputed once an hour" : n === 2 ? "recomputed twice an hour" : "recomputed " + n + " times an hour"; };
  if (!rows) say("FAIL", "B8 NB-32 get_cron_health answered " + (cr.ok ? JSON.stringify(cr.j).slice(0, 160) : "non-JSON " + head(cr.s)));
  else {
    const want = [];
    for (const job of ["refresh-ghost-stats", "job-board-stats-rollup"]) {
      const r = rows.find((x) => x && x.ch_jobname === job && x.ch_active !== false);
      const p = r ? phrase(r.ch_schedule) : null;
      if (p) want.push([job, r.ch_schedule, p]);
    }
    if (!want.length) say("INFO", "B8 NB-32 neither refresh-ghost-stats nor job-board-stats-rollup runs a schedule the words can say, so the bake keeps DATA_PAGE_CADENCE");
    else bakeVerdict(want.every(([, , p]) => Bk.ghost.includes(p)), "B8 NB-32 the /ghost-job-index cadence words follow pg_cron: " + want.map(([j, s, p]) => j + " \"" + s + "\" -> \"" + p + "\" x" + count(Bk.ghost, p)).join("; "));
  }
  const cos = (process.env.VDDP_COS || "").split(/\s+/).filter(Boolean);
  if (!cos.length) say(BAKE ? "FAIL" : "INFO", "B9 SEO-F17 /companies listed no row with a count to compare");
  else {
    const diffs = [];
    cos.forEach((t, i) => {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const row = new RegExp("/jobs/company/" + esc + "\"[^>]*>[^<]*</a>(?:\\s*<span[^>]*>\\([^)]*\\)</span>)?\\s*<span[^>]*>— ([\\d,]+) open roles").exec(Bk.companies);
      const page = (/<title>[^<]*?([\d,]+) open roles/.exec(txt("co_" + (i + 1) + ".html")) || [])[1] ?? null;
      diffs.push([t, row ? row[1] : null, page]);
    });
    const judged = diffs.filter(([, a, b]) => a && b);
    if (!judged.length) say("INFO", "B9 SEO-F17 no linked page states a count in its title to compare: " + diffs.map(([t, a, b]) => t + " " + a + "/" + b).join("; "));
    else bakeVerdict(judged.every(([, a, b]) => a === b), "B9 SEO-F17 /companies row against its page'"'"'s title: " + judged.map(([t, a, b]) => t + " " + a + " vs " + b).join("; "));
  }
  const crumbs = { "/ats/lever": Bk.lever, "/research/ats-score-benchmarks": Bk.study, "/es/normas-cv/espana": Bk.cves };
  const noCrumb = Object.entries(crumbs).filter(([, h]) => !h.includes("\"BreadcrumbList\"")).map(([p]) => p);
  // The translated page marks up the trail it shows, in Spanish: "Inicio" in the markup and in a visible nav.
  const esShown = /"name":"Inicio"/.test(Bk.cves) && /<nav[^>]*>(?:(?!<\/nav>)[\s\S])*>Inicio<\/a>/.test(Bk.cves);
  const esBad = !noCrumb.includes("/es/normas-cv/espana") && !esShown;
  bakeVerdict(!noCrumb.length && !esBad, "B10 SEO-F18 BreadcrumbList on /ats/lever, the study and /es/normas-cv/espana, whose trail is shown and marked up in Spanish" + (noCrumb.length ? ": missing on " + noCrumb.join(", ") : "") + (esBad ? ": /es/normas-cv/espana marks up a trail it does not show in Spanish (no Inicio in both the markup and a visible nav)" : ""));
  const ats = [["lever", desc(Bk.lever)], ["workday", desc(Bk.workday)]];
  const lead = ats.filter(([, d]) => !d || /^(?:Yes|No|Unreliably|Often not)\b/.test(d));
  bakeVerdict(!lead.length, "B11 SEO-F16 /ats descriptions: " + ats.map(([v, d]) => v + " " + JSON.stringify((d || "").slice(0, 30))).join(", "));
  const refused = ["withMVSB", "Email Signature", "No Strapline", "Logo Horizontal"].filter((s) => Bk.jobs.includes(s));
  bakeVerdict(!refused.length, "B12 SEO-F11 /jobs'"'"' list prints no refused name" + (refused.length ? ": " + refused.join(", ") : ""));
  const meta = (/<meta name="x-rb-employer-stated" content="([^"]*)"/.exec(Bk.posting) || [])[1] ?? null;
  let stated = null; try { stated = meta ? JSON.parse(meta.replace(/&quot;/g, "\"").replace(/&amp;/g, "&")) : null; } catch {}
  const sc = stated && stated.address && typeof stated.address.addressCountry === "string" ? stated.address.addressCountry.trim() : null;
  const ldc = (/"addressCountry":"([A-Z]{2})"/.exec(Bk.posting) || [])[1] ?? null;
  if (!sc) say("INFO", "B13 SEO-F08 the Buenos Aires posting'"'"'s page carries no employer-stated country yet (the reader half, scripts/employer-reads.mjs, states none), markup country " + ldc);
  else { const code = /^[A-Za-z]{2}$/.test(sc) ? sc.toUpperCase() : /argentin/i.test(sc) ? "AR" : null; bakeVerdict(!ldc || !code || ldc === code, "B13 SEO-F08 the employer states " + sc + ", the markup says " + ldc); }
  const quoted = count(LLMS, "every quoted line checked");
  if (!process.env.VDDP_FKS) say("FAIL", "B14 S14X-269 free-keyword-scan'"'"'s preflight carries no x-fn-build");
  else if (!quoted || process.env.VDDP_FKS_ROUND === "yes") say("PASS", "B14 S14X-269 llms.txt \"every quoted line checked\" x" + quoted + " with free-keyword-scan at " + process.env.VDDP_FKS);
  else say("INFO", "B14 S14X-269 llms.txt promises every quoted line checked while free-keyword-scan is at " + process.env.VDDP_FKS + ": the grounded trigger arrives with the round'"'"'s paste");
}

// ---- O1-O5, the owner'"'"'s answers ----
{
  const pending = (k, what) => say("INFO", k + " owner pending: " + what);
  const o1 = owner("NB-5");
  if (o1 === null) pending("O1 NB-5", "exclude staffing boards from the actively-hiring list, or label them");
  else {
    const sc = json("sc.json");
    const rowsOf = (c) => { const a = c && c.actively_hiring; return Array.isArray(a) ? a : a && Array.isArray(a.rows) ? a.rows : null; };
    const rows = sc.ok ? rowsOf(one(sc.j)) : null;
    const named = ["weekday-1", "distro", "mercier-consultancy-group"];
    if (!rows) say("INFO", "O1 NB-5 the stats cache carries no actively_hiring rows to judge (" + (sc.ok ? "no part" : "non-JSON") + ")");
    else if (/label/i.test(o1)) say("INFO", "O1 NB-5 the owner chose to label (" + o1 + "): the list keeps them, labelled by the lane that builds it");
    else { const hit = rows.filter((r) => named.includes(r.company_token)); say(hit.length ? "FAIL" : "PASS", "O1 NB-5 (" + o1 + ") the actively-hiring list holds " + (hit.length ? hit.map((r) => r.company_token).join(", ") : "none of the named staffing boards") + " over " + rows.length + " rows"); }
  }
  const o2 = owner("SEO-F24");
  if (o2 === null) pending("O2 SEO-F24", "the licence the data pages'"'"' Dataset markup names");
  else bakeVerdict(/"license":"https?:\/\//.test(Bk.ghost), "O2 SEO-F24 (" + o2 + ") the /ghost-job-index Dataset names a licence");
  const o3 = owner("SEO-F03");
  if (o3 === null) pending("O3 SEO-F03", "retire or noindex /jobs/company/usasurveyjob (the mill screen)");
  else { const noidx = /<meta name="robots" content="noindex/.test(Bk.survey), named = /usasurveyjob/i.test(Bk.survey); bakeVerdict(noidx || !named, "O3 SEO-F03 (" + o3 + ") /jobs/company/usasurveyjob is " + (noidx ? "noindex" : named ? "INDEXABLE" : "not served as a company page")); }
  const o4 = owner("SEO-F10");
  if (o4 === null) pending("O4 SEO-F10", "whether an unbaked live posting is indexable");
  else if (!/noindex|not indexable/i.test(o4)) say("INFO", "O4 SEO-F10 the owner chose " + JSON.stringify(o4) + ": those pages need baked files, judged by the lane that bakes them");
  else bakeVerdict(/location\.pathname!=="\/"[^<]*noindex/.test(Bk.unbaked), "O4 SEO-F10 (" + o4 + ") the fallback marks an unbaked address noindex");
  const o5 = owner("RC-S12-016");
  const ms = Number(process.env.VDDP_FC_MS);
  if (o5 === null) pending("O5 RC-S12-016", "a cache for the employer fill curve (it answered three boards in " + ms + " ms)");
  else if (!/cache/i.test(o5)) say("INFO", "O5 RC-S12-016 the owner chose " + JSON.stringify(o5) + ": no cache to judge");
  else say(Number.isFinite(ms) && ms <= 10000 ? "PASS" : "FAIL", "O5 RC-S12-016 (" + o5 + ") get_company_fill_curve answered three boards in " + ms + " ms (want 10 s or less)");
}
'
