# shellcheck shell=bash
# ── 98-r2. THE SEO/GEO ROUND OF 2026-11-07 (seo-connect, fe track): the
# owner's conditions for Google for Jobs, judged on the served documents.
# A FRONTEND + PRERENDER deploy and no edge function; its one migration,
# 20261108100000 (B05's names), is judged by the names the pages print.
# Sourced by scripts/verify-deploy.sh; $SITE and $UA are in scope.
#
# THE CLAIMS:
#   G1  (B01, G4J-01, SD-01) the daily closed-but-baked check, run live: every
#       live posting page the sitemap names is asked of its employer's own
#       system (GET only, scripts/posting-closure-check.mjs) and the closed
#       share is printed with its 95% interval. FAIL over 5% (the owner's
#       line: two consecutive daily checks over it fire the STOP rule); INFO
#       when more than 20% of the answers are unknown (not judged). PER
#       VENDOR (SEO check 2026-11-15, F01): every vendor over 20% unknown is
#       named, and FAILs (two unknown pages or more, in a judged run) unless
#       the reader reads it for its statements only (STATED_ONLY_VENDORS in
#       scripts/employer-reads.mjs), which is named as not checked. A vendor
#       read once per board (BOARD_LIST_VENDORS: Ashby, Breezy, Recruitee)
#       FAILs only when its unknown pages come from two boards or more: one
#       failed list GET makes a whole board unknown (review of 2026-11-15).
#   G1b (SEO audit 2026-11-18, STRUCTURED-1) the publish bake's own employer
#       reads, as the served /prerender-ledger.json records them
#       (employerReads.byVendor): a vendor the reader checks (not
#       STATED_ONLY_VENDORS) with over 20% of its pages unknown and two
#       unknown pages or more FAILs, named with why (budget, challenge,
#       timeout, an HTTP status...). Bot challenges ("challenge", and "vendor
#       challenged" for the rows not asked after three) are printed on their
#       own line. A ledger whose reads carry no why counts is a bake from
#       before the fix, and FAILs.
#   G2  (B01) the STOP switch as served: with JOB_POSTING_MARKUP true in
#       src/config/seo-switches.ts every sitemap posting page serves exactly
#       one JobPosting (a page the ledger says D7 keeps without markup serves
#       none); with it false, none does.
#   G3  (B01) no sitemap posting page is one the ledger calls closed at the
#       employer, and every such page serves a noindex stub with no JobPosting.
#   G4  (B02, G4J-02) no JobPosting on a sitemap posting page names its
#       employer by a web address or by text the bake's name gate refuses (a
#       logo or colour caption), judged by scripts/prerender-names.mjs itself.
#   G5  (B05) the company pages the audit read under a tenant code ("Nyuhs",
#       "Papajohns", "Ssctech", "Hubinternational") carry their employer's
#       own name in the title and the H1. A page not served is INFO.
#   G6  (B02) /pay-transparency's system column prints the vendor's name,
#       never a raw key ("ukg", "workday"; src/config/ats-vendors.ts).
#   G7  (SEO check 2026-11-15, F02) no JobPosting on a sitemap posting page is
#       for the employer's own people only: its board (the token in the path,
#       its hiringOrganization) is not an internal, referral, employees-only or
#       invitation-only board, and its own title and description do not say
#       only internal or current employees may apply, judged by
#       scripts/prerender-posting-rule.mjs itself (internalBoardReason,
#       internalOnlyTextReason).
#   G8  (SEO check 2026-11-15, F03) no JobPosting on a sitemap posting page is
#       a paid-survey panel ad: its board is not a feed the rule holds
#       (PAID_SURVEY_AD_BOARDS: usasurveyjob) and its title and description do
#       not recruit survey takers (paidSurveyAdReason), judged by the same file.
#
# Read-only: GETs of the site's sitemap, ledger and posting pages, and GETs of
# the employers' own endpoints. Nothing is sent or written.
echo "== 98-r2. the SEO round of 2026-11-07: closed-but-baked share, the bake's own employer reads, the STOP switch, employer-closed stubs, employer names, system names, internal-only postings, survey ads =="

VD98R2_SWITCH=$(/usr/bin/grep -Eo '^export const JOB_POSTING_MARKUP = (true|false);' src/config/seo-switches.ts 2>/dev/null | /usr/bin/grep -Eo '(true|false)' || echo "")

VD98R2_OUT=$(node scripts/posting-closure-check.mjs --site "$SITE" --json 2>&1)
VD98R2_CODE=$?
SITE="$SITE" UA="$UA" SWITCH="$VD98R2_SWITCH" CLOSURE_CODE="$VD98R2_CODE" CLOSURE_OUT="$VD98R2_OUT" node --input-type=module -e '
const { SITE, UA, SWITCH, CLOSURE_CODE, CLOSURE_OUT } = process.env;
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const get = async (path, ms = 30000) => {
  try {
    const r = await fetch(path.startsWith("http") ? path : SITE + path, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    return { status: r.status, body: await r.text() };
  } catch (e) { return { status: 0, body: "" }; }
};
const jobBlocks = (h) => [...String(h).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => { try { return JSON.parse(m[1].replace(/\\u003c/g, "<")); } catch { return {}; } })
  .filter((d) => d && d["@type"] === "JobPosting");

// G1: the closure check, as it ran above.
{
  const line = String(CLOSURE_OUT).split("\n").find((l) => l.startsWith("POSTING_CLOSURE_JSON ")) ?? "";
  let rec = null;
  try { rec = JSON.parse(line.slice("POSTING_CLOSURE_JSON ".length)); } catch { rec = null; }
  if (!rec) {
    out("FAIL", `G1 the closure check printed no record (exit ${CLOSURE_CODE}): ${String(CLOSURE_OUT).split("\n").slice(-2).join(" | ").slice(0, 200)}`);
  } else {
    const pct = (x) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);
    const head = `G1 ${rec.date}: ${rec.checked} live posting pages asked of their employers: ${rec.open} open, ${rec.closed} closed, ${rec.unknown} unknown; closed share ${pct(rec.closedShare)} (95% CI ${pct(rec.wilson95[0])}-${pct(rec.wilson95[1])}), unknown ${pct(rec.unknownShare)}`;
    const judgedRun = !(rec.unknownShare === null || rec.unknownShare > 0.2);
    if (!judgedRun) out("INFO", `${head} — NOT JUDGED (over 20% unknown)`);
    else out(rec.closedShare > 0.05 ? "FAIL" : "PASS", `${head} — the owner line is 5%; twice in a row fires the STOP rule`);
    for (const p of (rec.closedPaths ?? []).slice(0, 12)) out("INFO", `G1   closed at the employer: ${p}`);
    // PER VENDOR (SEO check 2026-11-15, F01): the overall share hid four
    // vendors that were never asked (72 pages, 100% unknown, under an overall
    // 15-16%). A vendor over 20% unknown is named. It FAILs when the reader
    // claims to check it (two pages or more, in a judged run); a vendor the
    // reader reads for its statements only is named as not checked (INFO).
    let statedOnly = [];
    let boardVendors = [];
    try {
      const reads = await import(`${process.cwd()}/scripts/employer-reads.mjs`);
      statedOnly = [...(reads.STATED_ONLY_VENDORS ?? [])];
      boardVendors = [...(reads.BOARD_LIST_VENDORS ?? [])];
    } catch { statedOnly = []; boardVendors = []; }
    const vendors = Object.entries(rec.byVendor ?? {})
      .map(([v, c]) => [v, c.unknown ?? 0, (c.open ?? 0) + (c.closed ?? 0) + (c.unknown ?? 0)])
      .filter(([, , n]) => n > 0)
      .sort((a, b) => b[1] / b[2] - a[1] / a[2] || a[0].localeCompare(b[0]));
    const overShare = vendors.filter(([, u, n]) => u / n > 0.2);
    for (const [v, u, n] of overShare) {
      const share = pct(u / n);
      // A vendor read once per board is judged by its unknown boards: one
      // failed list GET is every page of one board (review of 2026-11-15).
      const boards = rec.unknownBoards?.[v];
      const perBoard = boardVendors.includes(v) && typeof boards === "number";
      const from = typeof boards === "number" ? `, from ${boards} board${boards === 1 ? "" : "s"}` : "";
      if (statedOnly.includes(v)) out("INFO", `G1 ${v}: ${u} of ${n} live posting pages NOT CHECKED at the employer (${share} unknown): the reader reads ${v} for what it states only, so a closure there is never seen`);
      else out(judgedRun && (perBoard ? boards >= 2 : u >= 2) ? "FAIL" : "INFO", `G1 ${v}: ${u} of ${n} live posting pages unknown at the employer (${share}, over 20%)${from}: their closures are not being seen${perBoard ? " (read once per board: a FAIL needs two boards)" : ""}`);
    }
    const checked = vendors.filter(([v, u, n]) => !statedOnly.includes(v) && u / n <= 0.2);
    if (judgedRun && !overShare.some(([v]) => !statedOnly.includes(v))) {
      out("PASS", `G1 every vendor checked at the employer is at most 20% unknown (${checked.map(([v, u, n]) => `${v} ${u} of ${n}`).join(", ")})`);
    }
  }
}

// G1b: the employer reads of the publish bake, as its ledger records them.
{
  let reads = null;
  try { reads = JSON.parse((await get("/prerender-ledger.json")).body)?.employerReads ?? null; } catch { reads = null; }
  let statedOnly = [];
  try { statedOnly = [...((await import(`${process.cwd()}/scripts/employer-reads.mjs`)).STATED_ONLY_VENDORS ?? [])]; } catch { statedOnly = []; }
  const phrase = (why) => Object.entries(why ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(", ");
  if (!reads || typeof reads.byVendor !== "object") out("INFO", "G1b the served ledger records no employer reads (a bake that wrote no posting pages)");
  else {
    const rows = Object.entries(reads.byVendor).map(([v, c]) => ({ v, u: c.unknown ?? 0, n: (c.open ?? 0) + (c.closed ?? 0) + (c.unknown ?? 0), why: c.why ?? null }));
    const missingWhy = rows.filter((r) => r.u > 0 && !r.why);
    if (missingWhy.length) out("FAIL", `G1b the ledger of ${reads.at ?? "?"} counts unknown employer answers with no reason (${missingWhy.map((r) => `${r.v} ${r.u}`).join(", ")}): a bake from before STRUCTURED-1`);
    const challenged = rows.filter((r) => r.why && ((r.why.challenge ?? 0) + (r.why["vendor challenged"] ?? 0)) > 0);
    for (const r of challenged) out("INFO", `G1b ${r.v}: bot challenges in the bake of ${reads.at ?? "?"}: ${r.why.challenge ?? 0} answered with a challenge, ${r.why["vendor challenged"] ?? 0} not asked after three (never retried, never worked around)`);
    const over = rows.filter((r) => !statedOnly.includes(r.v) && r.n > 0 && r.u / r.n > 0.2 && r.u >= 2);
    for (const r of over) out("FAIL", `G1b ${r.v}: ${r.u} of ${r.n} posting pages unknown at the employer in the bake of ${reads.at ?? "?"} (${(100 * r.u / r.n).toFixed(1)}%, over 20%)${r.why ? `: ${phrase(r.why)}` : ""}; its closures are not being seen`);
    for (const r of rows.filter((x) => statedOnly.includes(x.v) && x.u > 0)) out("INFO", `G1b ${r.v}: ${r.u} of ${r.n} read for their statements only (not checked for closure)`);
    if (!over.length && !missingWhy.length) out("PASS", `G1b every vendor the bake of ${reads.at ?? "?"} checked at the employer is at most 20% unknown (${rows.filter((r) => !statedOnly.includes(r.v)).map((r) => `${r.v} ${r.u} of ${r.n}`).join(", ") || "none read"})`);
  }
}

// G2 and G3: the switch and the employer-closed stubs, as served.
const sitemap = (await get("/sitemap.xml")).body;
let ledger = {};
try { ledger = JSON.parse((await get("/prerender-ledger.json")).body).postings ?? {}; } catch { ledger = {}; }
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim().replace(/^https?:\/\/[^/]+/, "")).filter((p) => p.startsWith("/jobs/posting/"));
/** [path, hiringOrganization.name] of every JobPosting the G2 walk read, for G4. */
const orgNames = [];
/** Every JobPosting the G2 walk read, with the text G7 judges. */
const marked = [];
if (SWITCH !== "true" && SWITCH !== "false") out("FAIL", "G2 src/config/seo-switches.ts names no JOB_POSTING_MARKUP = true|false line");
else if (!paths.length) out("FAIL", "G2 the sitemap names no posting page");
else {
  const wrong = [];
  for (let i = 0; i < paths.length; i += 8) {
    await Promise.all(paths.slice(i, i + 8).map(async (p) => {
      const r = await get(p);
      const blocks = jobBlocks(r.body);
      const n = blocks.length;
      for (const b of blocks) if (typeof b?.hiringOrganization?.name === "string") orgNames.push([p, b.hiringOrganization.name]);
      for (const b of blocks) marked.push({ path: p, org: typeof b?.hiringOrganization?.name === "string" ? b.hiringOrganization.name : "", text: `${b?.title ?? ""}\n${b?.description ?? ""}` });
      const kept = !!ledger[p]?.markupWithheld && ledger[p].markupWithheld !== "switch";
      const want = SWITCH === "true" ? (kept ? 0 : 1) : 0;
      if (r.status !== 200 || n !== want) wrong.push(`${p} (HTTP ${r.status}, ${n} JobPosting, want ${want})`);
    }));
  }
  out(wrong.length ? "FAIL" : "PASS", `G2 switch ${SWITCH === "true" ? "ON" : "OFF"}: ${paths.length - wrong.length} of ${paths.length} sitemap posting pages serve ${SWITCH === "true" ? "exactly one JobPosting (none where D7 withholds it)" : "no JobPosting"}${wrong.length ? `; e.g. ${wrong.slice(0, 3).join("; ")}` : ""}`);
}
{
  const closed = Object.entries(ledger).filter(([, e]) => e && e.state === "gone" && e.basis === "employer").map(([p]) => p);
  const inSitemap = closed.filter((p) => paths.includes(p));
  const bad = [];
  for (const p of closed.slice(0, 20)) {
    const r = await get(p);
    if (!/<meta name="robots" content="noindex/.test(r.body) || jobBlocks(r.body).length) bad.push(p);
  }
  if (!closed.length) out("INFO", "G3 the ledger names no posting closed at the employer (none closed at this bake, or the bake could not reach the employers)");
  else out(inSitemap.length || bad.length ? "FAIL" : "PASS", `G3 ${closed.length} postings closed at the employer: ${inSitemap.length} still in the sitemap, ${bad.length} of the first ${Math.min(20, closed.length)} serving markup or no noindex${bad.length ? ` (${bad.slice(0, 3).join(", ")})` : ""}`);
}
// G4: the employer names the job markup gives, judged by the gate the bake runs.
{
  let gate = null;
  try { gate = (await import(`${process.cwd()}/scripts/prerender-names.mjs`)).unpublishableNameReason; } catch { gate = null; }
  if (typeof gate !== "function") out("FAIL", "G4 scripts/prerender-names.mjs could not be loaded from the working directory");
  else if (!orgNames.length) out("INFO", "G4 no sitemap posting page served a JobPosting naming an employer (nothing to judge)");
  else {
    const bad = orgNames.map(([p, n]) => [p, n, n.includes("://") ? "web address" : gate(n)]).filter(([, , why]) => why);
    out(bad.length ? "FAIL" : "PASS", `G4 ${orgNames.length - bad.length} of ${orgNames.length} JobPosting employer names on sitemap posting pages are names, not a web address or a logo or colour caption${bad.length ? `; e.g. ${bad.slice(0, 3).map(([p, n, why]) => `${p} "${n}" (${why})`).join("; ")}` : ""}`);
  }
}
// G7 (F02): no job markup on a posting open only to people the employer already employs.
{
  let rule = null;
  try { rule = await import(`${process.cwd()}/scripts/prerender-posting-rule.mjs`); } catch { rule = null; }
  if (typeof rule?.internalBoardReason !== "function" || typeof rule?.internalOnlyTextReason !== "function") out("FAIL", "G7 scripts/prerender-posting-rule.mjs could not be loaded from the working directory");
  else if (!marked.length) out("INFO", "G7 no sitemap posting page served a JobPosting (nothing to judge)");
  else {
    const tokenOf = (p) => { try { return decodeURIComponent(p.split("/")[4] ?? ""); } catch { return p.split("/")[4] ?? ""; } };
    const bad = [];
    for (const m of marked) {
      const board = rule.internalBoardReason(tokenOf(m.path), m.org);
      const says = board ? null : rule.internalOnlyTextReason(m.text);
      if (board) bad.push(`${m.path} (${board}: "${m.org}")`);
      else if (says) bad.push(`${m.path} (its text says "${says}")`);
    }
    out(bad.length ? "FAIL" : "PASS", `G7 ${marked.length - bad.length} of ${marked.length} JobPostings on sitemap posting pages are open to everyone: no internal, referral, employees-only or invitation-only board, and no text saying only the employer\u0027s own people may apply${bad.length ? `; e.g. ${bad.slice(0, 3).join("; ")}` : ""}`);
  }
}
// G8 (F03): no job markup on a paid-survey panel ad.
{
  let rule = null;
  try { rule = await import(`${process.cwd()}/scripts/prerender-posting-rule.mjs`); } catch { rule = null; }
  if (!(rule?.PAID_SURVEY_AD_BOARDS instanceof Set) || typeof rule?.paidSurveyAdReason !== "function") out("FAIL", "G8 scripts/prerender-posting-rule.mjs could not be loaded from the working directory");
  else if (!marked.length) out("INFO", "G8 no sitemap posting page served a JobPosting (nothing to judge)");
  else {
    const bad = [];
    for (const m of marked) {
      const token = m.path.split("/")[4] ?? "";
      const says = rule.PAID_SURVEY_AD_BOARDS.has(token) ? null : rule.paidSurveyAdReason(m.text);
      if (rule.PAID_SURVEY_AD_BOARDS.has(token)) bad.push(`${m.path} (a board held as a paid-survey ad feed)`);
      else if (says) bad.push(`${m.path} (its text says "${says}")`);
    }
    out(bad.length ? "FAIL" : "PASS", `G8 ${marked.length - bad.length} of ${marked.length} JobPostings on sitemap posting pages are jobs, not paid-survey panel ads${bad.length ? `; e.g. ${bad.slice(0, 3).join("; ")}` : ""}`);
  }
}
// G5: company pages the audit read under a tenant code, as served.
{
  const decode = (t) => String(t).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;|&#x27;|&apos;|\u2019/g, "\u0027").replace(/\s+/g, " ").trim();
  const NAMED = [
    ["nyuhs~wd12~nyuhscareers1", "United Health Services"],
    ["papajohns~wd1~PapaJohnsCareers", "Papa John\u0027s"],
    ["ssctech~wd1~ssctechnologies", "SS&C Technologies"],
    ["hubinternational~wd1~HUBInternational", "HUB International"],
  ];
  for (const [t, name] of NAMED) {
    const r = await get(`/jobs/company/${t}`);
    const title = decode((r.body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? "");
    const h1 = decode((r.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] ?? "");
    if (r.status !== 200) out("INFO", `G5 /jobs/company/${t} answered HTTP ${r.status}: not served this publish, not judged`);
    else out(title.includes(name) && h1.includes(name) ? "PASS" : "FAIL", `G5 /jobs/company/${t} names ${name}: title "${title.slice(0, 90)}", H1 "${h1.slice(0, 70)}"`);
  }
}
// G6: the system column of the pay page, as served.
{
  let keys = [];
  try { keys = [...(await import("node:fs")).readFileSync("src/config/ats-vendors.ts", "utf8").matchAll(/key: "([a-z0-9_-]+)"/g)].map((m) => m[1]); } catch { keys = []; }
  const r = await get("/pay-transparency");
  const cells = [...r.body.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
  const raw = cells.filter((c) => keys.includes(c));
  if (!keys.length) out("FAIL", "G6 src/config/ats-vendors.ts names no vendor key");
  else if (r.status !== 200) out("FAIL", `G6 /pay-transparency answered HTTP ${r.status}`);
  else out(raw.length ? "FAIL" : "PASS", `G6 /pay-transparency prints ${raw.length ? `raw vendor keys in its table: ${[...new Set(raw)].slice(0, 6).join(", ")}` : "no raw vendor key in its table"} (${cells.length} cells read)`);
}
'
