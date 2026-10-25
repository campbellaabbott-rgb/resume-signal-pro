# shellcheck shell=bash
# ── 81. PROFILES + DESIGN, THE ACCURACY ROUND (branch pd/accuracy): ghost spec
# Track 1 (A1-A5) on named live company pages, and the lock on the four
# company tables (20261012130000). A FRONTEND + MIGRATION deploy
# (20261012120000, 20261012121000, 20261012122000, 20261012130000); no edge
# function changes, so there is no build to check. Sourced by
# scripts/verify-deploy.sh; $B $K $SITE $UA are in scope.
#
# THE CLAIMS:
#   81a the lap_pending boards the 2026-10-11 sample named (AutoZone egud,
#       Marriott ejwl, Kroger eluq, Kotak hcbt) print no 14-day share and no
#       median: this checkout's gate refuses their live rows as an unproven
#       read, and the served chunks carry that refusal's sentence.
#   81b the came-back caution is the neutral sentence and no served string
#       carries a removed phrase; on Centria Autism and BAYADA (one title live
#       at many sites) the gate refuses the 90-day counts because the re-post
#       test reads other sites, which needs the multi-site column the reissued
#       reader adds.
#   81c no page says an employer has no open roles while its board lists older
#       ones, and none says we have not read a board we read in full: the
#       served copy carries the window, the zero-with-total sentence and the
#       full-read sentence, and the Jobs chunk hands the zero page the curve's
#       read bucket and tracking days; BASS ABA's live row (a Greenhouse board
#       read whole in one visit, so no total is stated) gives the full-read
#       reading, never "not read" (the 2026-10-24 hotfix); Stripe's board
#       total is within 10% of its own Greenhouse feed (FAIL by decision until
#       job-board records whole-feed totals).
#   81d Databricks and Canva print no "never half" (their 30-day share is
#       under one half).
#   81e no live 14-day share sits outside its own interval.
#   81f an anon REST read of each locked table is refused (42501), selecting a
#       real column; 81g the three company-page readers still answer as anon.
#   81h get_similar_companies (20261012136000) lists no USAJOBS row, under any
#       name, for CVS Health and Eurofins, whose lists led with it on
#       2026-10-18 as "Veterans Health Administration".
#   81i get_company_intel answers Workday tokens: three Workday company pages
#       the sitemap listed on 2026-10-24 and one made-up Workday token each
#       answer HTTP 200 with the reader object within 3 seconds, and each of
#       the three real ones reads facts: a Workday source with open roles in
#       open_by_source, and places or fields. 81g probes only stripe, so it
#       stayed green while every Workday token answered 500 57014 after 15
#       seconds (20261012135000 ran the hosting-tenant test once per snapshot
#       row; 20261012137000 runs it once per call).
#   81j the baked crawler copy of those three Workday company pages states
#       where their roles are or in which fields (the bake's "holding the most
#       of its roles" lines), with Domino's as the positive control: the bake
#       drops the facts without failing when the reader is slow (its 90 s
#       deadline), so a fast reader alone does not prove the pages.
#
# HOW IT IS JUDGED. Live rows are judged by this checkout's gate and lander
# model (src/lib/hiring-record-gate.ts and src/lib/company/lander-model.ts,
# through tsx), and the served bundle (the entry, the Jobs chunk, the chunks
# it imports and the English locale chunks) is searched for the copy and the
# refusal keys. Both must hold for a PASS. Read-only: GETs (PostgREST runs a
# GET RPC in a read-only transaction), the job-board's read-only list, and one
# public Greenhouse feed.
echo "== 81. profiles + design accuracy: Track 1 on named pages, the four-table lock =="

REPO_ROOT81="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rm -f /tmp/vd_81_*.json /tmp/vd_81_*.txt
SITE="$SITE" B="$B" K="$K" node -e '
const { SITE, B, K } = process.env;
const fs = require("fs");
const H = { apikey: K, Authorization: `Bearer ${K}` };
const get = async (url, headers = {}) => { try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(60000) }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: "" }; } };
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const TOKENS = ["egud~us2~CX_1", "ejwl~us2~CX", "eluq~us2~CX_1", "hcbt~em2~CX_1001", "databricks", "Canva", "centriaautism", "bayada", "stripe", "bassabatherapy"];
(async () => {
  // The rows the employer pages read, over a read-only GET.
  const arr = "{" + TOKENS.map((t) => JSON.stringify(t)).join(",") + "}";
  const c = await get(`${B}/rest/v1/rpc/get_company_fill_curve?p_tokens=${encodeURIComponent(arr)}`, H);
  fs.writeFileSync("/tmp/vd_81_curves.json", JSON.stringify({ status: c.status, body: json(c.body) }));
  // The served bundle: the entry, the Jobs chunk and what it imports, the English locale chunks.
  const home = await get(`${SITE}/`);
  const main = (home.body.match(/\/assets\/index-[^"]*\.js/) || [])[0];
  let bundle = "";
  let jobsChunk = "";
  if (main) {
    const mainJs = (await get(`${SITE}${main}`)).body;
    bundle = mainJs;
    jobsChunk = ((mainJs.match(/"\.\/Jobs-[A-Za-z0-9_-]*\.js"/) || [])[0] || "").replace(/"/g, "").replace(/^\.\//, "");
    const en = [...new Set([...mainJs.matchAll(/"\.\/(en(?:-GB)?-[A-Za-z0-9_-]+\.js)"/g)].map((m) => m[1]))].slice(0, 8);
    for (const d of en) bundle += "\n" + (await get(`${SITE}/assets/${d}`)).body;
    if (jobsChunk) {
      const jobsJs = (await get(`${SITE}/assets/${jobsChunk}`)).body;
      bundle += "\n" + jobsJs;
      const deps = [...new Set([...jobsJs.matchAll(/"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map((m) => m[1]))].slice(0, 60);
      for (const d of deps) bundle += "\n" + (await get(`${SITE}/assets/${d}`)).body;
    }
  }
  fs.writeFileSync("/tmp/vd_81_bundle.txt", bundle);
  fs.writeFileSync("/tmp/vd_81_meta.json", JSON.stringify({ main: main || null, jobsChunk: jobsChunk || null }));
  // BASS ABA: what the board serves (the read-only list).
  let bass = { status: 0, total: null };
  try {
    const r = await fetch(`${B}/functions/v1/job-board`, { method: "POST", headers: { ...H, "Content-Type": "application/json", "x-rb-budget": "probe" }, body: JSON.stringify({ action: "list", companies: ["bassabatherapy"], limit: 5, includeFacets: false }), signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    bass = { status: r.status, total: typeof j?.total === "number" ? j.total : null };
  } catch { bass = { status: 0, total: null }; }
  // Stripe: its own Greenhouse feed states the total.
  const gh = await get("https://boards-api.greenhouse.io/v1/boards/stripe/jobs");
  const ghj = json(gh.body);
  fs.writeFileSync("/tmp/vd_81_ext.json", JSON.stringify({ bass, stripeFeed: { status: gh.status, total: ghj && ghj.meta && typeof ghj.meta.total === "number" ? ghj.meta.total : (ghj && Array.isArray(ghj.jobs) ? ghj.jobs.length : null) } }));
  // The four locked tables, each by a real column, as anon.
  const lock = {};
  for (const [t, col] of [["showcase_excluded", "company_token"], ["company_profiles", "company_token"], ["company_financials", "slug"], ["company_name_overrides", "slug"]]) {
    const r = await get(`${B}/rest/v1/${t}?select=${col}&limit=1`, H);
    lock[t] = { col, status: r.status, body: r.body.slice(0, 300) };
  }
  fs.writeFileSync("/tmp/vd_81_lock.json", JSON.stringify(lock));
  // The three company-page readers, as anon, over GET.
  const readers = {};
  for (const [fn, qs] of [["get_company_intel", "p_token=stripe"], ["get_company_financials", "p_token=stripe"], ["get_similar_companies", "p_token=stripe&p_limit=3"]]) {
    const r = await get(`${B}/rest/v1/rpc/${fn}?${qs}`, H);
    readers[fn] = { status: r.status, body: r.body.slice(0, 300) };
  }
  fs.writeFileSync("/tmp/vd_81_readers.json", JSON.stringify(readers));
  // The similar-employers list for two boards whose lists led with USAJOBS.
  const similar = {};
  for (const t of ["cvshealth~wd1~CVS_Health_Careers", "Eurofins"]) {
    const r = await get(`${B}/rest/v1/rpc/get_similar_companies?p_token=${encodeURIComponent(t)}&p_limit=20`, H);
    similar[t] = { status: r.status, body: json(r.body) };
  }
  fs.writeFileSync("/tmp/vd_81_similar.json", JSON.stringify(similar));
})();
'
# This checkout's gate and lander model, applied to the live rows.
( cd "$REPO_ROOT81" && npx --no-install tsx -e '
Promise.all([import("./src/lib/hiring-record-gate.ts"), import("./src/lib/company/lander-model.ts")]).then(([g, m]) => {
  const fs = require("fs");
  let rows = [];
  try { const c = JSON.parse(fs.readFileSync("/tmp/vd_81_curves.json", "utf8")); rows = Array.isArray(c.body) ? c.body : []; } catch { rows = []; }
  const gate = {};
  const model = {};
  for (const r of rows) {
    gate[r.company_token] = g.hiringRecordGate(r);
    const has = Object.prototype.hasOwnProperty.call(r, "feed_total");
    const bt = has ? { total: r.feed_total, readAt: r.feed_read_at, state: r.feed_state, capped: r.feed_capped, bucket: r.observability_bucket, trackingDays: r.tracking_days } : null;
    model[r.company_token] = { feedColumns: has, boardTotal: has ? m.boardTotalFact(bt) : null, zeroReading: has ? m.zeroReadingOf({ boardTotal: bt }) : null };
  }
  fs.writeFileSync("/tmp/vd_81_gate.json", JSON.stringify(gate));
  fs.writeFileSync("/tmp/vd_81_model.json", JSON.stringify(model));
}).catch(() => {});
' ) 2>/dev/null

node -e '
const fs = require("fs");
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const curves = read("/tmp/vd_81_curves.json", { status: 0, body: null });
const gate = read("/tmp/vd_81_gate.json", null);
const model = read("/tmp/vd_81_model.json", null);
const meta = read("/tmp/vd_81_meta.json", {});
const ext = read("/tmp/vd_81_ext.json", { bass: {}, stripeFeed: {} });
const lock = read("/tmp/vd_81_lock.json", {});
const readers = read("/tmp/vd_81_readers.json", {});
let bundle = ""; try { bundle = fs.readFileSync("/tmp/vd_81_bundle.txt", "utf8"); } catch { bundle = ""; }
const has = (s) => bundle.includes(s);
const rows = Array.isArray(curves.body) ? curves.body : [];
const rowOf = (t) => rows.find((r) => r.company_token === t) || null;
const served = !!meta.main && bundle.length > 0;
const words = (...w) => w.join(" ");
if (!served) out("FAIL", `could not read the served bundle from the live entry (${meta.main || "no entry"}): the copy claims below cannot be judged`);
if (!gate) out("FAIL", "this checkout could not run its own gate (npx tsx unavailable or src/lib/hiring-record-gate.ts missing): the row claims cannot be judged");
if (curves.status !== 200) out("FAIL", `get_company_fill_curve answered HTTP ${curves.status} over GET: no row can be judged`);

// ---- 81a: lap_pending boards print no pace ----
const pendingServed = served && has("jobsPage.hhGate.unprovenRead");
for (const [label, t] of [["AutoZone", "egud~us2~CX_1"], ["Marriott", "ejwl~us2~CX"], ["Kroger", "eluq~us2~CX_1"], ["Kotak", "hcbt~em2~CX_1001"]]) {
  const r = rowOf(t);
  const g = gate && gate[t];
  if (!r || !g) { out("INFO", `81a ${label} (${t}): no row answered, nothing to judge`); continue; }
  const facts = `bucket ${r.observability_bucket}, watched_from ${r.watched_from ?? "none"}, sufficient ${r.sufficient}, 14-day share ${r.fill_rate_14}`;
  if (r.observability_bucket === "full_read" && r.watched_from) out("INFO", `81a ${label}: now read in full with a watch floor (${facts}); the gate may print its share`);
  else if (g.share14.ok || g.median.ok) out("FAIL", `81a ${label}: this checkout\x27s gate lets a board we have not proven we read print its 14-day share or median (${facts})`);
  else if (!pendingServed) out("FAIL", `81a ${label}: the served chunks lack jobsPage.hhGate.unprovenRead, so the page still prints a 14-day share on this board (${facts})`);
  else out("PASS", `81a ${label}: no 14-day share and no median (gate: ${g.share14.reason}; the served chunks carry the unproven-read sentence) [${facts}]`);
}

// ---- 81b: the neutral relist sentence ----
const NEUTRAL = "had another posting with the same title live when they came down";
const BANNED = [words("Worth", "knowing", "before", "you", "invest"), words("responses", "may", "be", "slow"), words("real", "number", "can", "be", "higher"), words("Re-lists", "roles", "often")];
if (served) {
  if (has(NEUTRAL)) out("PASS", "81b the served English copy carries the neutral re-post sentence");
  else out("FAIL", "81b the served English copy lacks the neutral re-post sentence: the old caution still renders");
  const hits = BANNED.filter((p) => bundle.toLowerCase().includes(p.toLowerCase()));
  if (hits.length) out("FAIL", `81b the served bundle still carries ${hits.length} removed phrase(s): ${hits.join(" | ")}`);
  else out("PASS", `81b none of the ${BANNED.length} removed phrases is served`);
}
const otherServed = served && has("jobsPage.hhGate.otherSites");
for (const [label, t] of [["Centria Autism", "centriaautism"], ["BAYADA", "bayada"]]) {
  const r = rowOf(t);
  const g = gate && gate[t];
  if (!r || !g) { out("INFO", `81b ${label}: no row answered, nothing to judge`); continue; }
  const facts = `bucket ${r.observability_bucket}, ${r.filled_roles_90d} down, ${r.relisted_roles_90d} back, multi-site share ${r.multi_site_title_share ?? "absent"}`;
  if (!Object.prototype.hasOwnProperty.call(r, "multi_site_title_share")) out("FAIL", `81b ${label}: the reply carries no multi_site_title_share, so 20261012121000 is not applied (the page refuses the counts as unread meanwhile) [${facts}]`);
  else if (g.counts90.ok) out("FAIL", `81b ${label}: this checkout\x27s gate lets the 90-day counts print (${facts})`);
  else if (g.counts90.reason !== "relist test reads other sites") out("INFO", `81b ${label}: counts withheld for another reason (${g.counts90.reason}) [${facts}]`);
  else if (!otherServed) out("FAIL", `81b ${label}: the served chunks lack jobsPage.hhGate.otherSites, so the page cannot say why (${facts})`);
  else out("PASS", `81b ${label}: no 90-day counts and no caution: the re-post test reads other sites here [${facts}]`);
}

// ---- 81c: no "no open roles" while older ones are listed ----
if (served) {
  const old = words("has", "no", "open", "roles", "on", "their", "job", "board");
  if (has(old)) out("FAIL", "81c the served copy still says an employer has no open roles on its board, whatever the board lists");
  else if (!has("dated in the last 30 days")) out("FAIL", "81c the served copy does not name the 30-day window its counts cover");
  else out("PASS", "81c the served copy names the 30-day window and never says an employer has no open roles on its board");
  if (has("companyProfile.zero.older")) out("PASS", "81c the served chunks carry the zero-with-total sentence (companyProfile.zero.older)");
  else out("FAIL", "81c the served chunks lack companyProfile.zero.older: a zero page cannot say its board lists older roles");
  if (has("companyProfile.zero.fullRead")) out("PASS", "81c the served chunks carry the full-read zero sentence (companyProfile.zero.fullRead)");
  else out("FAIL", "81c the served chunks lack companyProfile.zero.fullRead: a zero page of a board read in full still says we have not read it (the 2026-10-24 hotfix is not published)");
  // The lander input the Jobs chunk builds from the curve row, minified: the
  // bucket and the tracking days beside the feed columns (src/pages/Jobs.tsx).
  if (/bucket:\s*([\w$]+)\.observability_bucket\s*,\s*trackingDays:\s*\1\.tracking_days\b/.test(bundle)) out("PASS", "81c the served Jobs chunk hands the zero page the curve\x27s read bucket and tracking days");
  else out("FAIL", "81c the served Jobs chunk does not hand the zero page the curve\x27s observability_bucket and tracking_days: it says \"not read\" of every board with no stated total");
}
{
  const r = rowOf("bassabatherapy");
  const mm = model && model.bassabatherapy;
  const listTotal = ext.bass ? ext.bass.total : null;
  const stated = r && r.feed_total !== null && r.feed_total !== undefined;
  const facts = r ? `bucket ${r.observability_bucket ?? "none"}, ${r.tracking_days ?? "no"} tracking days, ${stated ? `feed_total ${r.feed_total} (${r.feed_state}, read ${r.feed_read_at})` : "no stated total"}` : "";
  if (!r || !mm) out("INFO", "81c BASS ABA: no curve row answered, nothing to judge");
  else if (!mm.feedColumns) out("FAIL", "81c BASS ABA: the reply carries no feed_total, so 20261012121000 is not applied and the zero page can say only what the list holds");
  else if (listTotal !== 0) out("INFO", `81c BASS ABA: the board serves ${listTotal ?? "an unread number of"} role(s) on this read; not a zero page now`);
  else if (mm.zeroReading === "unread" && r.observability_bucket === "full_read") out("FAIL", `81c BASS ABA: this checkout\x27s lander model says we have not read a board whose newest read was complete (${facts}): the zero page prints the false "not read" sentence`);
  else if (mm.zeroReading === "fullRead") out("PASS", `81c BASS ABA: nothing served in the window and its newest read was complete (${facts}): the page says that as of our latest full read no role is dated in the last 30 days`);
  else if (mm.zeroReading === "older") out("PASS", `81c BASS ABA: nothing served in the window and its board listed ${r.feed_total} roles at ${r.feed_read_at} on a read that kept none in the window (${r.feed_state}): the page says none of them is dated in the last 30 days`);
  else if (mm.zeroReading === "empty") out("PASS", `81c BASS ABA: nothing served in the window and its board listed none when we read it at ${r.feed_read_at} (${r.feed_state}): the page says so`);
  else if (mm.zeroReading === "unread") out("INFO", `81c BASS ABA: zero reading "unread" (${facts}): no complete read stands behind the page, so "not read" is true`);
  else out("INFO", `81c BASS ABA: no zero reading (${facts}): the page prints only the list\x27s own line`);
}
{
  const r = rowOf("stripe");
  const feed = ext.stripeFeed || {};
  if (!r) out("INFO", "81c Stripe: no curve row answered, nothing to judge");
  else if (!Object.prototype.hasOwnProperty.call(r, "feed_total")) out("FAIL", "81c Stripe: the reply carries no feed_total, so 20261012121000 is not applied and no board total prints");
  else if (typeof feed.total !== "number" || feed.total <= 0) out("INFO", `81c Stripe: its Greenhouse feed answered HTTP ${feed.status} with no total; nothing to compare`);
  else if (r.feed_total === null || r.feed_total === undefined) out("FAIL", `81c Stripe: no board total from a complete read (state ${r.feed_state ?? "none"}) while its feed states ${feed.total}`);
  else {
    const rel = Math.abs(Number(r.feed_total) - feed.total) / feed.total;
    if (rel <= 0.1) out("PASS", `81c Stripe: board total ${r.feed_total} (read ${r.feed_read_at}) within 10% of its Greenhouse feed (${feed.total})`);
    else out("FAIL", `81c Stripe: board total ${r.feed_total} is ${Math.round(rel * 100)}% off its Greenhouse feed (${feed.total})`);
  }
}

// ---- 81d: never half ----
// The bound is read from S in the served page only where the served copy is
// the new bound ("come down and stay down"), which shipped with that rule.
const boundServed = served && has("come down and stay down inside");
for (const [label, t] of [["Databricks", "databricks"], ["Canva", "Canva"]]) {
  const r = rowOf(t);
  const g = gate && gate[t];
  if (!r || !g) { out("INFO", `81d ${label}: no row answered, nothing to judge`); continue; }
  const facts = `median censored ${r.median_censored}, 30-day share ${r.still_open_30} [${r.still_open_30_lo}, ${r.still_open_30_hi}]`;
  if (g.neverHalf.ok) {
    if (Number(r.still_open_30_lo) > 0.5) out("INFO", `81d ${label}: the 30-day share\x27s lower bound is now above one half, so the bound is true (${facts})`);
    else out("FAIL", `81d ${label}: this checkout\x27s gate prints "never half" beside a 30-day share under one half (${facts})`);
  } else if (!boundServed) out("FAIL", `81d ${label}: the served copy is the old bound, which the page printed from a censored fill median alone (${facts})`);
  else out("PASS", `81d ${label}: no "never half" (gate: ${g.neverHalf.reason}; the served bound is read from every takedown) [${facts}]`);
}

// ---- 81e: shares inside their own interval ----
{
  const judged = rows.filter((r) => [r.fill_rate_14, r.fill_rate_14_lo, r.fill_rate_14_hi].every((v) => v !== null && v !== undefined && Number.isFinite(Number(v))));
  const esc = judged.filter((r) => Number(r.fill_rate_14) < Number(r.fill_rate_14_lo) - 0.0001 || Number(r.fill_rate_14) > Number(r.fill_rate_14_hi) + 0.0001);
  if (judged.length === 0) out("INFO", "81e no row carried a 14-day share with its interval; nothing to judge");
  else if (esc.length) out("FAIL", `81e ${esc.length} of ${judged.length} rows publish a 14-day share outside its own interval (20261012121000 clamps it): ${esc.map((r) => `${r.company_token} ${r.fill_rate_14} [${r.fill_rate_14_lo}, ${r.fill_rate_14_hi}]`).join("; ")}`);
  else out("PASS", `81e all ${judged.length} rows publish their 14-day share inside its own interval`);
}

// ---- 81f: the four tables refuse a client ----
for (const t of ["showcase_excluded", "company_profiles", "company_financials", "company_name_overrides"]) {
  const a = lock[t];
  if (!a) { out("FAIL", `81f ${t}: not probed`); continue; }
  const code = (String(a.body).match(/"code":"([^"]+)"/) || [])[1] || "";
  if ((a.status === 401 || a.status === 403) && code === "42501") out("PASS", `81f ${t}: an anon read of ${a.col} is refused (HTTP ${a.status}, 42501)`);
  else if (a.status === 200) out("FAIL", `81f ${t}: an anon read of ${a.col} answered 200 (${String(a.body).slice(0, 80)}): 20261012130000 is not applied`);
  else if (a.status === 400) out("FAIL", `81f ${t}: HTTP 400 on ${a.col} (${String(a.body).slice(0, 120)}): the probe names a column the table lacks`);
  else out("FAIL", `81f ${t}: HTTP ${a.status} (${String(a.body).slice(0, 120)}): not the lock\x27s refusal`);
}

// ---- 81g: the readers still answer as anon ----
for (const fn of ["get_company_intel", "get_company_financials", "get_similar_companies"]) {
  const a = readers[fn];
  if (!a) { out("FAIL", `81g ${fn}: not probed`); continue; }
  const code = (String(a.body).match(/"code":"([^"]+)"/) || [])[1] || "";
  if (a.status === 200) out("PASS", `81g ${fn} answers anon over GET (HTTP 200): the company page still reads the locked tables through it`);
  else if (code === "42501") out("FAIL", `81g ${fn} refuses anon (42501): the lock took the company page\x27s reader away`);
  else if (code === "PGRST202") out("INFO", `81g ${fn} -> PGRST202 (argument names differ or the reader is not deployed)`);
  else out("FAIL", `81g ${fn} answered HTTP ${a.status} (${String(a.body).slice(0, 120)})`);
}

// ---- 81h: the similar-employers list names no federal listing site ----
{
  const similar = read("/tmp/vd_81_similar.json", null);
  if (!similar) out("FAIL", "81h get_similar_companies: not probed");
  else for (const [t, a] of Object.entries(similar)) {
    if (!a || a.status !== 200 || !Array.isArray(a.body)) { out("FAIL", `81h ${t}: HTTP ${a && a.status} (${JSON.stringify(a && a.body).slice(0, 120)})`); continue; }
    const fed = a.body.filter((r) => r && r.company_token === "usajobs");
    if (fed.length) out("FAIL", `81h ${t}: the list names the USAJOBS board as "${fed.map((r) => r.company).join(", ")}" (20261012136000 is not applied)`);
    else out("PASS", `81h ${t}: ${a.body.length} similar employer(s), none of them the USAJOBS board`);
  }
}
'

# ---- 81i: get_company_intel answers Workday tokens within 3 seconds ----
# Read-only: one GET of the sitemap and one anon GET of the reader per token,
# timed from request to the last byte of the reply.
SITE="$SITE" B="$B" K="$K" node -e '
const { SITE, B, K } = process.env;
const fs = require("fs");
const H = { apikey: K, Authorization: `Bearer ${K}` };
// Three Workday company pages the live sitemap listed on 2026-10-24, and a
// made-up Workday token with no postings, no snapshots and no override.
const REAL = ["cat~wd5~caterpillarcareers", "nvidia~wd5~NVIDIAExternalCareerSite", "dollartree~wd5~dollartreeus"];
const MADE_UP = "zzzz-none~wd1~Careers";
(async () => {
  let sitemap = null;
  try { const r = await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(30000) }); if (r.ok) sitemap = await r.text(); } catch { sitemap = null; }
  const probes = [];
  for (const token of [...REAL, MADE_UP]) {
    const t0 = Date.now();
    let status = 0;
    let body = "";
    try {
      const r = await fetch(`${B}/rest/v1/rpc/get_company_intel?p_token=${encodeURIComponent(token)}`, { headers: H, signal: AbortSignal.timeout(30000) });
      status = r.status;
      body = await r.text();
    } catch (e) { body = String((e && e.name) || e); }
    const ms = Date.now() - t0;
    const inSitemap = token === MADE_UP || sitemap === null ? null : sitemap.includes(`/jobs/company/${token}</loc>`);
    probes.push({ token, madeUp: token === MADE_UP, status, ms, body: body.slice(0, 400), inSitemap });
  }
  fs.writeFileSync("/tmp/vd_81_workday.json", JSON.stringify({ at: new Date().toISOString(), probes }));
})();
'
node -e '
const fs = require("fs");
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const BOUND_MS = 3000;
let w = null;
try { w = JSON.parse(fs.readFileSync("/tmp/vd_81_workday.json", "utf8")); } catch { w = null; }
const probes = w && Array.isArray(w.probes) ? w.probes : [];
if (probes.length === 0) out("FAIL", "81i get_company_intel on Workday tokens: not probed");
for (const p of probes) {
  const secs = (Number(p.ms) / 1000).toFixed(2);
  const label = p.madeUp ? `${p.token} (made up: no postings, no override)` : p.token;
  let j = null;
  try { j = JSON.parse(p.body); } catch { j = null; }
  const code = (String(p.body).match(/"code":"([^"]+)"/) || [])[1] || "";
  const shaped = !!j && typeof j === "object" && !Array.isArray(j) && Object.prototype.hasOwnProperty.call(j, "open_by_source");
  const fast = Number.isFinite(Number(p.ms)) && Number(p.ms) <= BOUND_MS;
  if (p.status === 200 && fast && shaped) {
    const n = (v) => (Array.isArray(v) ? v.length : 0);
    const read = `usd_n ${j.usd_n}, ${n(j.countries)} countries, ${n(j.categories)} fields, net_7d ${j.net_7d}`;
    // A real Workday page must read facts, not only answer: a Workday source
    // with open roles, and places or fields (what the page and the bake print).
    // The made-up token has no postings, so its empty object is the answer.
    const wd = Array.isArray(j.open_by_source) ? j.open_by_source.filter((x) => x && x.source === "workday" && Number(x.open_roles) > 0) : [];
    const wdOpen = wd.reduce((a, x) => a + Number(x.open_roles), 0);
    if (p.madeUp) out("PASS", `81i ${label}: get_company_intel answered 200 in ${secs} s, within 3 s [${read}]`);
    else if (wd.length && n(j.countries) + n(j.categories) > 0) out("PASS", `81i ${label}: get_company_intel answered 200 in ${secs} s, within 3 s, with facts [${read}, workday open ${wdOpen}]`);
    else out("FAIL", `81i ${label}: get_company_intel answered 200 in ${secs} s but read no facts: ${wd.length ? `workday open ${wdOpen}` : "no Workday source with open roles in open_by_source"}, ${n(j.countries)} countries, ${n(j.categories)} fields (the page would print none)`);
  } else if (p.status === 200 && fast) {
    out("FAIL", `81i ${label}: get_company_intel answered 200 in ${secs} s but not with the reader object (${String(p.body).slice(0, 120)})`);
  } else {
    const why = code === "57014" ? ": a statement timeout, the hosting-tenant test running once per row (is 20261012137000 applied?)" : "";
    out("FAIL", `81i ${label}: get_company_intel answered HTTP ${p.status}${code ? ` ${code}` : ""} in ${secs} s, want 200 within 3 s${why}`);
  }
  if (p.inSitemap === false) out("INFO", `81i ${p.token} is no longer in the live sitemap: the reader was still timed, but swap in a Workday company page the sitemap lists`);
}
'

# ---- 81j: the baked Workday company pages state their places or fields ----
# Read-only: GETs of the homepage and four company pages with the crawler's
# UA. The bake writes "The countries holding the most of its roles on this
# board" and "The fields holding the most ..." from get_company_intel, and
# drops both without failing when the reader is slow (its 90-second deadline,
# or 18 failures in a row), so 81i's fast reader does not prove the pages:
# on 2026-10-24 none of these three Workday pages carried either line and
# Domino's carried both.
SITE="$SITE" UA="$UA" node -e '
const { SITE, UA } = process.env;
const fs = require("fs");
// The three Workday pages 81i times, and the dominos board (SmartRecruiters),
// the positive control: a page whose facts the bake wrote on 2026-10-24.
const PAGES = ["cat~wd5~caterpillarcareers", "nvidia~wd5~NVIDIAExternalCareerSite", "dollartree~wd5~dollartreeus", "dominos"];
const get = async (path) => { try { const r = await fetch(`${SITE}${path}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: "" }; } };
(async () => {
  const home = await get("/");
  const pages = [];
  for (const token of PAGES) {
    const r = await get(`/jobs/company/${encodeURIComponent(token)}`);
    pages.push({ token, control: token === "dominos", status: r.status, body: r.body.slice(0, 400000) });
  }
  fs.writeFileSync("/tmp/vd_81_baked.json", JSON.stringify({ at: new Date().toISOString(), home: home.body.slice(0, 400000), pages }));
})();
'
node -e '
const fs = require("fs");
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
let b = null;
try { b = JSON.parse(fs.readFileSync("/tmp/vd_81_baked.json", "utf8")); } catch { b = null; }
const pages = b && Array.isArray(b.pages) ? b.pages : [];
if (pages.length === 0) out("FAIL", "81j the baked Workday company pages: not probed");
const titleOf = (h) => (String(h || "").match(/<title>([^<]*)<\/title>/) || [])[1] || "";
const homeTitle = b ? titleOf(b.home) : "";
const lines = (h) => ({
  places: (String(h || "").match(/The countries holding the most of its roles on this board/g) || []).length,
  fields: (String(h || "").match(/The fields holding the most of its roles on this board/g) || []).length,
});
const control = pages.find((p) => p.control);
const controlBare = !!control && control.status === 200 && lines(control.body).places + lines(control.body).fields === 0;
for (const p of pages) {
  const label = p.control ? `${p.token} (positive control)` : p.token;
  const t = titleOf(p.body);
  if (p.status !== 200) { out("FAIL", `81j ${label}: HTTP ${p.status} to a crawler, want 200 with the baked page`); continue; }
  if (!t || (homeTitle && t === homeTitle)) { out("FAIL", `81j ${label}: served the homepage shell to a crawler (title "${t}"): the page is not baked`); continue; }
  const c = lines(p.body);
  const n = c.places + c.fields;
  if (p.control) {
    if (n) out("PASS", `81j ${label}: the baked page states ${n} fact line(s) (places ${c.places}, fields ${c.fields}): the bake read the company reader`);
    else out("FAIL", `81j ${label}: the baked page states no fact line either: this bake wrote no places or fields on any page (it could not read get_company_intel, or ran past its deadline)`);
    continue;
  }
  const what = c.places && c.fields ? "where its roles are and in which fields" : c.places ? "where its roles are" : "in which fields its roles are";
  if (n) out("PASS", `81j ${label}: the baked page states ${what} (${n} fact line${n === 1 ? "" : "s"})`);
  else out("FAIL", `81j ${label}: the baked page states neither where its roles are nor in which fields${controlBare ? "" : ", while the control does"}: the bake dropped this Workday page\x27s facts (is 20261012137000 applied, and did the publish re-bake after it?)`);
}
'
