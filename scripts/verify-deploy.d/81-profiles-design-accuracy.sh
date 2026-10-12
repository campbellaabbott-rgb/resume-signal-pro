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
#       ones: the served copy carries the window and the zero-with-total
#       sentence; BASS ABA's live rows give the "older roles listed" reading;
#       Stripe's board total is within 10% of its own Greenhouse feed.
#   81d Databricks and Canva print no "never half" (their 30-day share is
#       under one half).
#   81e no live 14-day share sits outside its own interval.
#   81f an anon REST read of each locked table is refused (42501), selecting a
#       real column; 81g the three company-page readers still answer as anon.
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
    const bt = has ? { total: r.feed_total, readAt: r.feed_read_at, state: r.feed_state, capped: r.feed_capped } : null;
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
}
{
  const r = rowOf("bassabatherapy");
  const mm = model && model.bassabatherapy;
  const listTotal = ext.bass ? ext.bass.total : null;
  if (!r || !mm) out("INFO", "81c BASS ABA: no curve row answered, nothing to judge");
  else if (!mm.feedColumns) out("FAIL", "81c BASS ABA: the reply carries no feed_total, so 20261012121000 is not applied and the zero page can say only what the list holds");
  else if (listTotal !== 0) out("INFO", `81c BASS ABA: the board serves ${listTotal ?? "an unread number of"} role(s) on this read; not a zero page now`);
  else if (mm.zeroReading === "older") out("PASS", `81c BASS ABA: nothing served in the window and its board listed ${r.feed_total} roles at ${r.feed_read_at} (${r.feed_state}): the page says none of them is dated in the last 30 days`);
  else out("INFO", `81c BASS ABA: zero reading "${mm.zeroReading}" (feed_total ${r.feed_total}, state ${r.feed_state}, read ${r.feed_read_at}): no complete read to stand on within 48 hours`);
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
'
