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
#   81c a zero page says only what its inputs agree on (the 2026-10-25
#       corpus of every live zero page, src/test/fixtures/zero-page-corpus-
#       2026-10-25.json): the served copy carries the window and the page's
#       own line ("No roles are listed on this page right now."), the served
#       chunks ask for neither sentence the corpus refuted (the older-roles
#       and full-read sentences), and the Jobs chunk hands the zero page the
#       curve's read bucket and tracking days (its "not read" needs them);
#       BASS ABA (read in full, no stated total), Delaney at the Green (an
#       Oracle sub-site whose requisitions a sibling site serves) and Akumin's
#       ADG site (a Workday site that stated 5 at a read in state empty while
#       its own feed dated 2 roles this month) each give no reading at all on
#       this checkout's model when nothing is listed; the served chunks ask
#       for the zero page's own head (companyProfile.zero.seoTitle and
#       companyProfile.zero.seoDescription, round 3) and the served company
#       chunk prints the watch sentence (companyProfile.zero.body) only on
#       the lander model's watchPromise (round 3), and on that gate the page
#       promises that a watch counts new postings only where no total is
#       stated and the token is a site neither dedupe can empty (Delaney's
#       watch can count nothing: a sibling Oracle site holds its
#       requisitions; Boeing's PRIDE site, read in full with no stated total,
#       is one of five Workday sites of its tenant, whose new requisition
#       copies the Workday cross-site dedupe skips when a sibling holds the
#       base id, round 4). The served chunk that holds the site rule (the
#       one with its Oracle site pattern) carries round 4's Workday arm: the
#       tenant-capturing Workday pattern, exec'd and tested against a Set
#       built from the generated multi-site tenant list, whose names
#       minification keeps as string literals (akumincorp and boeing among
#       them; the SEO round's merge of main, 2026-10-25). The watch lines
#       judge this checkout's model, so they PASS only once the served chunk
#       carries the gate, and on a Workday site (Akumin ADG, Boeing PRIDE)
#       only once it also carries that arm, and print INFO before; Stripe's
#       board total is within 10% of its own Greenhouse feed (FAIL by
#       decision until job-board records whole-feed totals).
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
#   81j at least 90% of 24 Workday company pages sampled from the live
#       sitemap (its first 4, the largest, which a reader too slow on big
#       tenants loses; its last 8, where the bake's 90 s intel deadline cuts
#       first; and 12 spread over the rest) state the bake's places or fields
#       line on their own baked file, and each of the first 4 does: the bake
#       drops the facts without failing when the reader is slow, so neither a
#       fast reader (81i) nor three of the largest pages proves the re-bake.
#
# HOW IT IS JUDGED. Live rows are judged by this checkout's gate and lander
# model (src/lib/hiring-record-gate.ts and src/lib/company/lander-model.ts,
# through tsx), and the served bundle (the entry, the Jobs chunk, the chunks
# it imports and the English locale chunks) is searched for the copy and the
# refusal keys. Both must hold for a PASS; a line that reads only this
# checkout's model before the bundle carries what it judges prints INFO. The
# probe puts a marker line naming each chunk before it, so a line can judge
# one chunk (the Workday arm must sit in the chunk that holds the site rule).
# Property names survive minification, so the watch gate is read from the
# served code itself ("X.watchPromise&&" opening the element whose children
# call companyProfile.zero.body). Read-only: GETs (PostgREST runs a
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
const TOKENS = ["egud~us2~CX_1", "ejwl~us2~CX", "eluq~us2~CX_1", "hcbt~em2~CX_1001", "databricks", "Canva", "centriaautism", "bayada", "stripe", "bassabatherapy", "eexs~us2~CX_19005", "akumincorp~wd5~adgcareers", "boeing~wd1~PRIDE"];
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
  // Each chunk is preceded by a marker line naming it, so a line can judge one chunk.
  const tag = (name) => `\n/*vd81 chunk ${name}*/\n`;
  if (main) {
    const mainJs = (await get(`${SITE}${main}`)).body;
    bundle = tag(main) + mainJs;
    jobsChunk = ((mainJs.match(/"\.\/Jobs-[A-Za-z0-9_-]*\.js"/) || [])[0] || "").replace(/"/g, "").replace(/^\.\//, "");
    const en = [...new Set([...mainJs.matchAll(/"\.\/(en(?:-GB)?-[A-Za-z0-9_-]+\.js)"/g)].map((m) => m[1]))].slice(0, 8);
    for (const d of en) bundle += tag(d) + (await get(`${SITE}/assets/${d}`)).body;
    if (jobsChunk) {
      const jobsJs = (await get(`${SITE}/assets/${jobsChunk}`)).body;
      bundle += tag(jobsChunk) + jobsJs;
      const deps = [...new Set([...jobsJs.matchAll(/"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map((m) => m[1]))].slice(0, 60);
      for (const d of deps) bundle += tag(d) + (await get(`${SITE}/assets/${d}`)).body;
    }
  }
  fs.writeFileSync("/tmp/vd_81_bundle.txt", bundle);
  fs.writeFileSync("/tmp/vd_81_meta.json", JSON.stringify({ main: main || null, jobsChunk: jobsChunk || null }));
  // What the zero boards serve (the read-only list): BASS ABA, the two disagreeing shapes and a multi-site Workday site.
  const listed = async (token) => {
    try {
      const r = await fetch(`${B}/functions/v1/job-board`, { method: "POST", headers: { ...H, "Content-Type": "application/json", "x-rb-budget": "probe" }, body: JSON.stringify({ action: "list", companies: [token], limit: 5, includeFacets: false }), signal: AbortSignal.timeout(60000) });
      const j = await r.json();
      return { status: r.status, total: typeof j?.total === "number" ? j.total : null };
    } catch { return { status: 0, total: null }; }
  };
  const bass = await listed("bassabatherapy");
  const zeroLists = {};
  for (const t of ["eexs~us2~CX_19005", "akumincorp~wd5~adgcareers", "boeing~wd1~PRIDE"]) zeroLists[t] = await listed(t);
  // Stripe: its own Greenhouse feed states the total.
  const gh = await get("https://boards-api.greenhouse.io/v1/boards/stripe/jobs");
  const ghj = json(gh.body);
  fs.writeFileSync("/tmp/vd_81_ext.json", JSON.stringify({ bass, zeroLists, stripeFeed: { status: gh.status, total: ghj && ghj.meta && typeof ghj.meta.total === "number" ? ghj.meta.total : (ghj && Array.isArray(ghj.jobs) ? ghj.jobs.length : null) } }));
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
    model[r.company_token] = { feedColumns: has, boardTotal: has ? m.boardTotalFact(bt) : null, zeroReading: has ? m.zeroReadingOf({ boardTotal: bt }) : null, watchPromise: has && typeof m.watchPromiseOf === "function" ? m.watchPromiseOf({ boardTotal: bt, token: r.company_token }) : null };
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

// ---- 81c: a zero page says only what its inputs agree on ----
const OWN_LINE = "No roles are listed on this page right now.";
if (served) {
  const old = words("has", "no", "open", "roles", "on", "their", "job", "board");
  if (has(old)) out("FAIL", "81c the served copy still says an employer has no open roles on its board, whatever the board lists");
  else if (!has("dated in the last 30 days")) out("FAIL", "81c the served copy does not name the 30-day window its counts cover");
  else out("PASS", "81c the served copy names the 30-day window and never says an employer has no open roles on its board");
  if (has(OWN_LINE)) out("PASS", `81c the served copy carries the zero page\x27s own line ("${OWN_LINE}")`);
  else out("FAIL", "81c the served copy lacks the zero page\x27s own line: a zero page still prints a sentence about what a read of its board found (the 2026-10-25 safe default is not published)");
  // Asked for by key in the served code (the shard text is not looked at).
  const refuted = ["companyProfile.zero.older", "companyProfile.zero.fullRead"].filter((k) => has(k));
  if (refuted.length) out("FAIL", `81c the served chunks still ask for ${refuted.join(" and ")}: sentences the 2026-10-25 corpus found false on zero pages whose inputs matched true ones`);
  else out("PASS", "81c the served chunks ask for neither zero sentence the corpus refuted (companyProfile.zero.older, companyProfile.zero.fullRead)");
  // The lander input the Jobs chunk builds from the curve row, minified: the
  // bucket and the tracking days beside the feed columns (src/pages/Jobs.tsx).
  if (/bucket:\s*([\w$]+)\.observability_bucket\s*,\s*trackingDays:\s*\1\.tracking_days\b/.test(bundle)) out("PASS", "81c the served Jobs chunk hands the zero page the curve\x27s read bucket and tracking days");
  else out("FAIL", "81c the served Jobs chunk does not hand the zero page the curve\x27s observability_bucket and tracking_days: its \"not read\" cannot tell a board we read in full from one we did not");
}
// Round 3 in the served bundle (round 4, 2026-10-25): the zero page\x27s own
// head, asked for by key, and the watch sentence gated on the model.
let watchGateServed = false;
if (served) {
  const head = ["companyProfile.zero.seoTitle", "companyProfile.zero.seoDescription"].filter((k) => !has(k));
  if (head.length) out("FAIL", `81c the served chunks do not ask for ${head.join(" or ")}: a zero page\x27s title and description still say the employer has open roles (round 3\x27s head is not published)`);
  else out("PASS", "81c the served chunks ask for companyProfile.zero.seoTitle and companyProfile.zero.seoDescription: a zero page\x27s title and description name no open roles");
  // Each call of the watch sentence must sit in an element the model\x27s
  // watchPromise opens, as the production build writes CompanyEmptyState:
  // X.watchPromise&&n.jsx("p",{...,children:t("companyProfile.zero.body",...
  // A negated receiver (!X.watchPromise) is not the gate.
  const GATED = /(?<![!\w$.])[\w$]+(?:\.[\w$]+)*\.watchPromise\s*(?:&&|\?)\s*(?:\(\s*0\s*,\s*)?[\w$]+\.jsxs?\)?\(\s*"p"\s*,\s*\{[^{}]*?children:\s*[\w$]+\(\s*$/;
  const calls = [...bundle.matchAll(/["\x27`]companyProfile\.zero\.body["\x27`]/g)].map((m) => m.index);
  const ungated = calls.filter((i) => !GATED.test(bundle.slice(Math.max(0, i - 400), i)));
  if (!calls.length) out("FAIL", "81c the served chunks never ask for companyProfile.zero.body: the watch sentence moved, so its gate cannot be read (re-anchor this line on CompanyEmptyState)");
  else if (ungated.length) out("FAIL", `81c the served company chunk prints companyProfile.zero.body without the lander model\x27s watchPromise (${ungated.length} of ${calls.length} call(s)): every zero page promises a watch counts its new postings, Delaney at the Green included (round 3\x27s gate is not published)`);
  else { watchGateServed = true; out("PASS", `81c the served company chunk prints companyProfile.zero.body only where the lander model\x27s watchPromise opens it (${calls.length} call(s))`); }
}
// Round 4 in the served bundle (the SEO round\x27s merge of main, 2026-10-25):
// the site rule (lander-model\x27s siteDedupedToken) carries its Workday arm.
// The chunk that holds the rule is the one with its Oracle site pattern
// (round 3); in that chunk the tenant-capturing Workday pattern must be
// exec\x27d and its capture tested against a Set built from the generated
// multi-site tenant list, which minification leaves as string literals, so
// akumincorp and boeing must be in it. A pattern that is never used, a list
// without them, or an arm in another chunk is not the arm.
let workdayArmServed = false;
if (served) {
  const ORACLE_ARM = "/^[^~]+~[^~]+~CX(?:_\\w+)?$/";
  const WORKDAY_ARM = "/^([^~]+)~wd\\d+~[^~]+$/";
  const ARM_TENANTS = ["akumincorp", "boeing"];
  const esc = (v) => v.replace(/[$]/g, "\\$");
  const parts = bundle.split(/\n\/\*vd81 chunk ([^*\n]*)\*\/\n/);
  const chunks = parts.length === 1 ? [{ name: "the served bundle", body: bundle }] : Array.from({ length: (parts.length - 1) / 2 }, (_, k) => ({ name: parts[2 * k + 1], body: parts[2 * k + 2] }));
  const armOf = (body) => {
    const at = body.indexOf(WORKDAY_ARM);
    if (at < 0) return null;
    const v = (/([\w$]+)=$/.exec(body.slice(Math.max(0, at - 60), at)) || [])[1];
    if (!v) return null;
    const use = new RegExp(`(?<![\\w$.])${esc(v)}\\.exec\\([\\w$]+\\)[;,]\\s*return\\s*!!([\\w$]+)\\s*&&\\s*([\\w$]+)\\.has\\(\\s*\\1\\[1\\]\\s*\\)`).exec(body);
    if (!use) return null;
    const set = use[2];
    const decl = new RegExp(`(?<![\\w$.])${esc(set)}=new Set\\(([\\w$]+)\\)`).exec(body);
    const list = decl
      ? (new RegExp(`(?<![\\w$.])${esc(decl[1])}=\\[([^\\[\\]]*)\\]`).exec(body) || [])[1]
      : (new RegExp(`(?<![\\w$.])${esc(set)}=new Set\\(\\[([^\\[\\]]*)\\]\\)`).exec(body) || [])[1];
    if (!list) return null;
    const names = [...list.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    return ARM_TENANTS.every((x) => names.includes(x)) ? { tenants: names.length } : null;
  };
  const holders = chunks.filter((c) => c.body.includes(ORACLE_ARM));
  const armed = holders.map((c) => ({ c, arm: armOf(c.body) })).find((x) => x.arm);
  if (!holders.length) out("FAIL", "81c no served chunk carries the zero page\x27s site rule (its Oracle site pattern): rounds 3 and 4 are not published, or the rule moved (re-anchor this line on lander-model\x27s siteDedupedToken)");
  else if (!armed) out("FAIL", `81c the served chunk holding the zero page\x27s site rule (${holders.map((c) => c.name).join(", ")}) carries no Workday arm: no tenant-capturing Workday pattern tested against a set holding ${ARM_TENANTS.join(" and ")}, so a zero page on a Workday site of a multi-site tenant (Akumin ADG, Boeing PRIDE) still promises a watch counts its new postings (round 4 is not published)`);
  else { workdayArmServed = true; out("PASS", `81c the served chunk holding the zero page\x27s site rule (${armed.c.name}) carries round 4\x27s Workday arm: the tenant-capturing Workday pattern, tested against a set of ${armed.arm.tenants} multi-site tenants (${ARM_TENANTS.join(" and ")} among them)`); }
}
// The zero boards, each judged by this checkout\x27s model on its live row when nothing is listed.
const facts81c = (r) => `bucket ${r.observability_bucket ?? "none"}, ${r.tracking_days ?? "no"} tracking days, ${r.feed_total !== null && r.feed_total !== undefined ? `feed_total ${r.feed_total} (${r.feed_state}, read ${r.feed_read_at})` : "no stated total"}`;
// The fifth field names the dedupe that can empty the site, when one can: an
// Oracle site (the sub-site dedupe), or a Workday site of a tenant with more
// than one catalogued site (the copy dedupe; the catalogue counts are pinned
// against sources.ts by the-accuracy-verifier-can-fail-every-claim-it-makes).
const ZERO_BOARDS = [
  ["BASS ABA", "bassabatherapy", "a Greenhouse board read whole in one visit, so no total is stated", ext.bass, null],
  ["Delaney at the Green", "eexs~us2~CX_19005", "an Oracle sub-site whose requisitions a sibling site serves", (ext.zeroLists || {})["eexs~us2~CX_19005"], "an Oracle site the sub-site dedupe empties"],
  ["Akumin ADG", "akumincorp~wd5~adgcareers", "a Workday site whose own feed dated 2 roles this month while a read in state empty stated 5", (ext.zeroLists || {})["akumincorp~wd5~adgcareers"], "a Workday site of a tenant with 2 catalogued sites, which the copy dedupe can empty"],
  ["Boeing PRIDE", "boeing~wd1~PRIDE", "a Workday site read in full with no stated total, one of its tenant\x27s five", (ext.zeroLists || {})["boeing~wd1~PRIDE"], "a Workday site of a tenant with 5 catalogued sites, which the copy dedupe can empty"],
];
for (const [label, t, shape, list, deduped] of ZERO_BOARDS) {
  const r = rowOf(t);
  const mm = model && model[t];
  const listTotal = list ? list.total : null;
  if (!r || !mm) { out("INFO", `81c ${label}: no curve row answered, nothing to judge`); continue; }
  if (!mm.feedColumns) { out("FAIL", `81c ${label}: the reply carries no feed_total, so 20261012121000 is not applied and the zero page cannot be judged`); continue; }
  if (listTotal !== 0) { out("INFO", `81c ${label}: the board serves ${listTotal ?? "an unread number of"} role(s) on this read; not a zero page now`); continue; }
  if (mm.zeroReading === null) out("PASS", `81c ${label} (${shape}): nothing listed (${facts81c(r)}): the page says only "${OWN_LINE}"`);
  else if (mm.zeroReading === "unread" && r.observability_bucket !== "full_read" && r.observability_bucket !== "lap_proven" && (r.feed_total === null || r.feed_total === undefined)) out("INFO", `81c ${label}: zero reading "unread" (${facts81c(r)}): our own reads show no complete read, so "not read" is true`);
  else if (mm.zeroReading === "empty" && Number(r.feed_total) === 0) out("PASS", `81c ${label}: nothing listed and its board stated none at ${r.feed_read_at}: the page says so`);
  else out("FAIL", `81c ${label} (${shape}): this checkout\x27s lander model gives the zero reading "${mm.zeroReading}" (${facts81c(r)}): the page would print a sentence about what a read found where the board and the page disagree`);
  // The watch promise ("your account will count its new postings"): a watch
  // counts only postings stored under this token, so a board that states
  // roles this page does not list (Delaney, whose requisitions CX_3001
  // holds), an Oracle sub-site, or a Workday site whose tenant has another
  // site gets none (round 3 review and round 4, 2026-10-25). These lines read
  // this checkout\x27s model, so they PASS only where the served company chunk
  // gates the sentence on it (the line above), and say INFO before.
  const stated = r.feed_total !== null && r.feed_total !== undefined;
  const why = [stated ? `the board states ${r.feed_total} role(s) this page does not list` : "", deduped || ""].filter(Boolean).join("; ");
  // A Workday site\x27s line also needs the served rule\x27s Workday arm (the
  // line above): round 3\x27s served rule promised on Boeing\x27s PRIDE site.
  const workdaySite = /~wd\d+~/.test(t);
  const servedRule = watchGateServed && (!workdaySite || workdayArmServed);
  const live = !watchGateServed ? "; the served company chunk does not gate the sentence (the line above FAILs), so the live page prints it whatever this model says"
    : !servedRule ? "; the served site rule has no Workday arm (the line above FAILs), so the live page promises the watch here whatever this model says" : "";
  if (typeof mm.watchPromise !== "boolean") out("FAIL", `81c ${label}: this checkout\x27s lander model has no watch rule (watchPromiseOf), so the zero page promises every watch counts new postings`);
  else if (mm.watchPromise && why) out("FAIL", `81c ${label}: this checkout\x27s model would promise a watch counts its new postings (${facts81c(r)}; ${why}): a watch on this token can count nothing the board lists`);
  else if (mm.watchPromise) out(servedRule ? "PASS" : "INFO", `81c ${label}: ${servedRule ? "the page promises" : "this checkout\x27s model promises"} a watch counts its new postings, where no total is stated, the newest read was whole and neither dedupe can empty the site (${facts81c(r)})${live}`);
  else out(servedRule ? "PASS" : "INFO", `81c ${label}: ${servedRule ? "the page offers" : "this checkout\x27s model offers"} Watch without promising what it counts (${facts81c(r)}${why ? `; ${why}` : ""})${live}`);
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
    probes.push({ token, madeUp: token === MADE_UP, status, ms, body, inSitemap });
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
# Read-only: GETs of the live sitemap, the homepage and a sample of baked
# Workday company pages, with the crawler's UA. The bake writes two fact
# lines on a company page from get_company_intel, exactly
#   "The countries holding the most of its roles on this board:" and
#   "The fields holding the most of its roles on this board:"
# in main's bake of 2026-10-25, and the same two lines with the scope it read
# in place of "on this board" in the SEO round's bake (S13-116: "across"
# the employer's hiring system, its possessive HTML-escaped, or "across
# USAJOBS"); either counts. The bake drops both without failing when the reader is slow: it reads six pages
# at a time in its own page order (open roles, largest first), and past its
# 90-second deadline, or after 18 failures in a row, every page after that
# point states neither. So the line samples the sitemap, which lists the
# company pages in that same order: its first 4 Workday pages (the largest
# tenants, which an 8-second per-call timeout drops first when the reader is
# slow on big boards), its last 8 (where a deadline cut lands first) and 12
# more spread evenly between them, 24 in all, chosen from the sitemap alone,
# so every run reads the same pages. It PASSes only when at least 90% of the
# sample states a fact line on the page's own baked file and every one of the
# first 4 does (round 3 review, 2026-10-25: a block of the 20 largest pages
# without facts PASSed 22 of 24). A homepage shell, an HTTP error or a page
# with neither line counts against it; an unreadable sitemap, fewer than 20
# Workday pages or an empty sample FAILs outright. The tail is the deadline's
# only while the sitemap keeps the bake's order (open roles, largest first),
# so an INFO says when the sampled titles' role counts stop falling. 81i's
# 3-second reader does not prove the bake fitted its deadline (the whole bake
# fits only at about 1.1 s per round of six); this line does. On 2026-10-25
# none of the 283 Workday pages in the sitemap stated either line.
SITE="$SITE" UA="$UA" node -e '
const { SITE, UA } = process.env;
const fs = require("fs");
const HEAD = 4;
const TAIL = 8;
const SAMPLE = 24;
const get = async (url) => { try { const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: "" }; } };
(async () => {
  const sm = await get(`${SITE}/sitemap.xml`);
  const locs = sm.status === 200 ? [...sm.body.matchAll(/<loc>([^<]*\/jobs\/company\/([^<]+))<\/loc>/g)].map((m) => ({ url: m[1], token: m[2] })) : [];
  const wd = locs.filter((l) => /~wd\d+~/.test(l.token));
  // The first HEAD and the last TAIL in the sitemap order, then evenly spaced between them.
  const pick = new Set();
  const lo = Math.min(HEAD, wd.length);
  for (let i = 0; i < lo; i++) pick.add(i);
  const hi = Math.max(lo, wd.length - TAIL);
  for (let i = hi; i < wd.length; i++) pick.add(i);
  const mid = hi - lo;
  const spread = Math.min(mid, SAMPLE - pick.size);
  for (let k = 0; k < spread; k++) pick.add(lo + (spread === 1 ? 0 : Math.round((k * (mid - 1)) / (spread - 1))));
  const sample = [...pick].sort((a, b) => a - b).map((i) => ({ pos: i, ...wd[i] }));
  const home = await get(`${SITE}/`);
  const pages = [];
  for (const p of sample) {
    const r = await get(p.url);
    pages.push({ token: p.token, url: p.url, pos: p.pos, status: r.status, body: r.body.slice(0, 400000) });
  }
  // The positive control (SmartRecruiters): says whether this bake wrote facts anywhere.
  const ctl = await get(`${SITE}/jobs/company/dominos`);
  fs.writeFileSync("/tmp/vd_81_baked.json", JSON.stringify({ at: new Date().toISOString(), site: SITE, sitemapStatus: sm.status, companyPages: locs.length, workdayPages: wd.length, home: home.body.slice(0, 400000), pages, control: { token: "dominos", status: ctl.status, body: ctl.body.slice(0, 400000) } }));
})();
'
node -e '
const fs = require("fs");
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const MIN_SAMPLE = 20;
const MIN_SHARE = 0.9;
const HEAD = 4;
const PLACES = "The countries holding the most of its roles on this board:";
const FIELDS = "The fields holding the most of its roles on this board:";
// The SEO round bakes the scope it read in place of "on this board" (S13-116):
// across the employer\x27s hiring system (its possessive escaped), or across USAJOBS.
const SCOPED = /<p>The (?:countries|fields) holding the most of its roles across (?:USAJOBS|[^<:]{1,200} hiring system): /g;
let b = null;
try { b = JSON.parse(fs.readFileSync("/tmp/vd_81_baked.json", "utf8")); } catch { b = null; }
const count = (h, s) => String(h || "").split(s).length - 1;
const facts = (h) => count(h, PLACES) + count(h, FIELDS) + (String(h || "").match(SCOPED) || []).length;
const titleOf = (h) => (String(h || "").match(/<title>([^<]*)<\/title>/) || [])[1] || "";
const canonOf = (h) => (String(h || "").match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || "";
const verdict = (p, homeTitle, site) => {
  if (p.status !== 200) return `HTTP ${p.status}`;
  const t = titleOf(p.body);
  const own = `${site}/jobs/company/${p.token}`;
  if (!t || (homeTitle && t === homeTitle) || canonOf(p.body) !== own) return `the homepage shell (title "${t.slice(0, 60)}", canonical "${canonOf(p.body) || "absent"}")`;
  return facts(p.body) > 0 ? null : "neither fact line";
};
if (!b) out("FAIL", "81j the baked Workday company pages: not probed");
else if (b.sitemapStatus !== 200) out("FAIL", `81j the live sitemap answered HTTP ${b.sitemapStatus}: no Workday company page to sample`);
else {
  const pages = Array.isArray(b.pages) ? b.pages : [];
  const homeTitle = titleOf(b.home);
  if (pages.length === 0) out("FAIL", `81j the live sitemap lists ${b.workdayPages ?? 0} Workday company page(s) among ${b.companyPages ?? 0} company pages: the sample is empty, nothing proves the bake`);
  else if ((b.workdayPages ?? 0) < MIN_SAMPLE) out("FAIL", `81j the live sitemap lists only ${b.workdayPages} Workday company page(s), fewer than the ${MIN_SAMPLE} this line samples: the bake wrote too few to judge`);
  else {
    const judged = pages.map((p) => ({ p, why: verdict(p, homeTitle, b.site) }));
    const good = judged.filter((x) => x.why === null);
    const share = good.length / pages.length;
    const pct = Math.round(share * 1000) / 10;
    const tail = judged.slice(-8);
    const tailGood = tail.filter((x) => x.why === null).length;
    // The first HEAD sitemap Workday pages, each of which must be sampled and state a fact line.
    const head = judged.filter((x) => x.p.pos < HEAD);
    const headWant = Math.min(HEAD, b.workdayPages);
    const headGood = head.filter((x) => x.why === null).length;
    const headOk = head.length === headWant && headGood === headWant;
    const what = `${good.length} of ${pages.length} sampled Workday company pages (sitemap positions ${pages[0].pos + 1} to ${pages[pages.length - 1].pos + 1} of ${b.workdayPages}; the first ${headWant}: ${headGood}${head.length < headWant ? ` of ${head.length} sampled` : ""}, the last ${tail.length}: ${tailGood}) state a fact line ("${PLACES}" or "${FIELDS}", or the same line across the employer\x27s hiring system or USAJOBS): ${pct}%`;
    if (pages.length >= MIN_SAMPLE && share >= MIN_SHARE && headOk) out("PASS", `81j ${what}, at least 90% and each of the first ${headWant}: the bake read the company reader for its Workday pages, its largest and its tail included`);
    else if (pages.length >= MIN_SAMPLE && share >= MIN_SHARE) out("FAIL", `81j ${what}, but not each of the first ${headWant}: the largest Workday pages baked without facts (is the reader too slow on big tenants for the bake\x27s 8-second per-call timeout?)`);
    else out("FAIL", `81j ${what}, want at least 90% of at least ${MIN_SAMPLE} and each of the first ${headWant}: the bake dropped Workday facts (is 20261012137000 applied, did the publish re-bake after it, and did the bake run past its 90-second intel deadline?)`);
    // The tail is the deadline\x27s only while the sitemap keeps the bake\x27s order (open roles, largest first).
    const roles = (p) => { const m = /([\d,]+)\+? open roles/.exec(titleOf(p.body)); return m ? Number(m[1].replace(/,/g, "")) : null; };
    const counted = judged.map((x) => ({ pos: x.p.pos, n: roles(x.p) })).filter((x) => x.n !== null);
    const rise = counted.findIndex((x, i) => i > 0 && x.n > counted[i - 1].n);
    if (rise > 0) out("INFO", `81j the sampled titles\x27 role counts rise in sitemap order (position ${counted[rise - 1].pos + 1}: ${counted[rise - 1].n}, position ${counted[rise].pos + 1}: ${counted[rise].n}): the sitemap may no longer list Workday pages in the bake\x27s order, so its last 8 may not be where the deadline cuts`);
    const misses = judged.filter((x) => x.why !== null);
    for (const x of misses.slice(0, 8)) out("INFO", `81j ${x.p.token} (sitemap Workday position ${x.p.pos + 1}): ${x.why}`);
    if (misses.length > 8) out("INFO", `81j ... and ${misses.length - 8} more sampled page(s) without a fact line`);
    const c = b.control || {};
    const cn = facts(c.body);
    out("INFO", `81j control dominos (SmartRecruiters): HTTP ${c.status}, ${cn} fact line(s)${cn ? "" : ": this bake wrote no places or fields on any page it was checked on"}`);
  }
}
'
