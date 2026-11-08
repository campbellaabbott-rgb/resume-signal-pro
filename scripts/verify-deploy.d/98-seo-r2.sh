# shellcheck shell=bash
# ── 98-r2. THE SEO/GEO ROUND OF 2026-11-07 (seo-connect, fe track): the
# owner's conditions for Google for Jobs, judged on the served documents.
# A FRONTEND + PRERENDER deploy (no edge function, no migration).
# Sourced by scripts/verify-deploy.sh; $SITE and $UA are in scope.
#
# THE CLAIMS:
#   G1  (B01, G4J-01, SD-01) the daily closed-but-baked check, run live: every
#       live posting page the sitemap names is asked of its employer's own
#       system (GET only, scripts/posting-closure-check.mjs) and the closed
#       share is printed with its 95% interval. FAIL over 5% (the owner's
#       line: two consecutive daily checks over it fire the STOP rule); INFO
#       when more than 20% of the answers are unknown (not judged).
#   G2  (B01) the STOP switch as served: with JOB_POSTING_MARKUP true in
#       src/config/seo-switches.ts every sitemap posting page serves exactly
#       one JobPosting (a page the ledger says D7 keeps without markup serves
#       none); with it false, none does.
#   G3  (B01) no sitemap posting page is one the ledger calls closed at the
#       employer, and every such page serves a noindex stub with no JobPosting.
#
# Read-only: GETs of the site's sitemap, ledger and posting pages, and GETs of
# the employers' own endpoints. Nothing is sent or written.
echo "== 98-r2. the SEO round of 2026-11-07: closed-but-baked share, the STOP switch, employer-closed stubs =="

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
    if (rec.unknownShare === null || rec.unknownShare > 0.2) out("INFO", `${head} — NOT JUDGED (over 20% unknown)`);
    else out(rec.closedShare > 0.05 ? "FAIL" : "PASS", `${head} — the owner line is 5%; twice in a row fires the STOP rule`);
    for (const p of (rec.closedPaths ?? []).slice(0, 12)) out("INFO", `G1   closed at the employer: ${p}`);
  }
}

// G2 and G3: the switch and the employer-closed stubs, as served.
const sitemap = (await get("/sitemap.xml")).body;
let ledger = {};
try { ledger = JSON.parse((await get("/prerender-ledger.json")).body).postings ?? {}; } catch { ledger = {}; }
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim().replace(/^https?:\/\/[^/]+/, "")).filter((p) => p.startsWith("/jobs/posting/"));
if (SWITCH !== "true" && SWITCH !== "false") out("FAIL", "G2 src/config/seo-switches.ts names no JOB_POSTING_MARKUP = true|false line");
else if (!paths.length) out("FAIL", "G2 the sitemap names no posting page");
else {
  const wrong = [];
  for (let i = 0; i < paths.length; i += 8) {
    await Promise.all(paths.slice(i, i + 8).map(async (p) => {
      const r = await get(p);
      const n = jobBlocks(r.body).length;
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
'
