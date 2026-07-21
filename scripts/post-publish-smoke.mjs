#!/usr/bin/env node
// Post-publish DEPLOY VERIFIER — run after EVERY Lovable publish.
//
//   node scripts/post-publish-smoke.mjs
//   # optional: force a guaranteed (non-rate-limited) freshness scan
//   HEARTBEAT_SECRET=… node scripts/post-publish-smoke.mjs
//
// Catches the deploy gaps Lovable has silently shipped before — the July 2026
// incidents where "publish" updated the frontend but NOT the edge functions
// (stale code) or the DB migrations (missing RPCs/tables), and nothing noticed
// for days/weeks because every consumer degraded quietly:
//   1. functions respond but run STALE code   → engine-version mismatch (2b)
//   2. migrations never applied               → RPCs/tables 404 PGRST202/205 (7)
//   3. the scanner's report is malformed      → (2)
//   4. checkout / heartbeat / frontend / prerender regressions → (3–6)
//
// Exit 0 = safe to walk away; exit 1 = something specific is broken below.
// Costs at most one AI scan (skipped if the rate limiter answers and no
// HEARTBEAT_SECRET is provided).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env"), "utf8");
const grab = (k) => env.match(new RegExp(`${k}="?([^"\\n]+)`))?.[1];
const URL_BASE = grab("VITE_SUPABASE_URL");
const KEY = grab("VITE_SUPABASE_PUBLISHABLE_KEY");
const HEARTBEAT = process.env.HEARTBEAT_SECRET; // optional: bypasses per-IP rate limit so freshness is always verifiable
const SITE = "https://resumebooster.work";

// The engine version this checkout expects live. Bumped on meaningful backend
// changes; if a deployed scan reports an OLDER value, the functions didn't ship.
const COMMITTED_ENGINE = (readFileSync(join(root, "supabase/functions/free-keyword-scan/index.ts"), "utf8")
  .match(/REPORT_ENGINE_VERSION = '([^']+)'/) || [])[1];

const CORPUS = `Sam Ortiz\nsam@email.com\n\nEXPERIENCE\nStaff Accountant, Meridian LLC (2021-present)\n- Closed monthly books for 8 entities in QuickBooks\n- Cut close cycle from 10 to 6 days\n\nCERTIFICATIONS\nCPA, Texas\n\nEDUCATION\nBS Accounting (deploy-verify-corpus)`;

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const hdrs = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const post = (fn, body, ms = 90000, extra = {}) =>
  fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: "POST", headers: { ...hdrs, ...extra }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });

// ---- 1. Every user-facing function answers OPTIONS (404 = not deployed at all) ----
// Only proves the function RESPONDS, not that it runs CURRENT code — the
// engine-version check (2b) is the real staleness signal.
const FUNCTIONS = [
  "free-keyword-scan", "create-product-checkout", "verify-product-purchase",
  "generate-freelance-boost", "import-freelance-profile", "generate-resume-roast",
  "send-scan-report", "check-subscription", "parse-pdf", "parse-docx",
  "generate-premium-package-stream", "generate-cover-letter", "recover-purchase",
  "generate-product-preview", "scan-heartbeat", "health-check", "job-board",
  "send-search-digest",
];
const optionsChecks = await Promise.all(FUNCTIONS.map(async (fn) => {
  try {
    const r = await fetch(`${URL_BASE}/functions/v1/${fn}`, { method: "OPTIONS", signal: AbortSignal.timeout(10000) });
    return { fn, ok: r.status === 200 };
  } catch (e) {
    return { fn, ok: false, err: String(e) };
  }
}));
const missing = optionsChecks.filter((c) => !c.ok);
record("edge functions respond", missing.length === 0,
  missing.length ? `NOT deployed: ${missing.map((c) => c.fn).join(", ")}` : `${FUNCTIONS.length}/${FUNCTIONS.length}`);

// ---- 2. Real scan returns a well-formed diagnostic report ----
// Costs one AI scan. `npm run verify:deploy` sets NO_SCAN=1 and skips it;
// use `npm run verify:deploy:scan` when the report pipeline needs
// end-to-end proof.
let deployedEngine = null;
let scanFields = null;
if (process.env.NO_SCAN) {
  record("free scan end-to-end", true, "SKIPPED (NO_SCAN=1) — zero-cost mode; run verify:deploy:scan for end-to-end proof");
  record("AI generation live", true, "SKIPPED (NO_SCAN=1)");
} else try {
  const t0 = Date.now();
  // Prefer the heartbeat bypass (guaranteed run, logged as scan_type='heartbeat'
  // so it stays out of published stats). Without the secret, fall back to
  // synthetic:true (also excluded from stats) which may hit the per-IP limit.
  const r = await post("free-keyword-scan",
    HEARTBEAT ? { resumeText: CORPUS } : { resumeText: CORPUS, synthetic: true },
    90000,
    HEARTBEAT ? { "x-heartbeat-secret": HEARTBEAT } : {});
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 429) {
    record("free scan end-to-end", true, `rate-limited from this IP — function alive, report+freshness UNVERIFIED (set HEARTBEAT_SECRET to force) (${secs}s)`);
  } else if (!r.ok) {
    record("free scan end-to-end", false, `HTTP ${r.status}: ${(await r.text()).slice(0, 150)}`);
  } else {
    const j = await r.json();
    deployedEngine = j.reportMeta?.engineVersion || null;
    scanFields = { parseQuality: "parseQuality" in j, countryStandards: "countryStandards" in j };
    const anatomy = typeof j.atsScoreEstimate === "number" && j.reportMeta?.reportId && j.scoreBand;
    record("free scan end-to-end", !!anatomy,
      anatomy
        ? `score ${j.atsScoreEstimate}, report ${j.reportMeta.reportId}, engine ${deployedEngine}, ${secs}s`
        : "200 but missing atsScoreEstimate/reportMeta/scoreBand");
    // The scan has a deterministic fallback, so score/reportId/scoreBand all
    // pass even when the AI gateway is down (proven 2026-07-09: this check said
    // PASS score 41 during a 402 out-of-credits outage — users were getting
    // empty reports). Assert real AI prose is present so a degraded scan FAILS.
    const aiProse = [j.topStrength, j.quickWins, j.redFlags]
      .map((v) => JSON.stringify(v ?? "").length)
      .reduce((a, b) => Math.max(a, b), 0);
    record("AI generation live", aiProse > 60,
      aiProse > 60
        ? `AI-written report content present (${aiProse} chars in largest field)`
        : `AI CONTENT MISSING (largest AI field: ${aiProse} chars) — gateway down or out of credits? Check Lovable AI credits + scan-heartbeat`);
  }
} catch (e) {
  record("free scan end-to-end", false, String(e));
}

// ---- 2b. Engine-version FRESHNESS (stale-function detector) ----
// This is the check that would have caught the functions sitting 5 days stale.
if (!COMMITTED_ENGINE) {
  record("engine version fresh", false, "could not read committed REPORT_ENGINE_VERSION from source");
} else if (!deployedEngine) {
  record("engine version fresh", true, process.env.NO_SCAN
    ? `UNVERIFIED (NO_SCAN=1) — committed ${COMMITTED_ENGINE}; a user-run scan on the site shows the deployed version`
    : `UNVERIFIED (no scan response; rate-limited?) — committed ${COMMITTED_ENGINE}; re-run with HEARTBEAT_SECRET`);
} else {
  const fresh = deployedEngine === COMMITTED_ENGINE;
  record("engine version fresh", fresh,
    fresh ? `deployed ${deployedEngine} == committed`
          : `STALE FUNCTIONS: deployed ${deployedEngine} != committed ${COMMITTED_ENGINE} — functions did NOT deploy`);
  const staleFields = scanFields ? Object.entries(scanFields).filter(([, v]) => !v).map(([k]) => k) : [];
  if (staleFields.length) record("scan emits current fields", false, `missing keys: ${staleFields.join(", ")} — deployed function predates them`);
}

// ---- 3. Checkout session creation (no charge — just session validity) ----
try {
  const r = await post("create-product-checkout", { productId: "premiumPackage", email: "smoke-test-nonpro@example.com" }, 30000);
  const j = await r.json().catch(() => ({}));
  record("Stripe checkout session", !!j.url?.includes("checkout.stripe.com"), j.url ? j.url.slice(0, 45) : JSON.stringify(j).slice(0, 120));
} catch (e) {
  record("Stripe checkout session", false, String(e));
}

// ---- 4. Heartbeat sentinel reports on itself ----
try {
  const r = await post("scan-heartbeat", {}, 120000);
  const j = await r.json();
  const failed = (j.checks || []).filter((c) => !c.passed).map((c) => c.name);
  record("heartbeat sentinel", j.status === "healthy",
    `status=${j.status}${failed.length ? `, failing: ${failed.join(", ")}` : ""} (${j.responseTimeMs}ms)`);
} catch (e) {
  record("heartbeat sentinel", false, String(e));
}

// ---- 5. Frontend serves + sitemap is current ----
try {
  const [home, sitemap] = await Promise.all([
    fetch(SITE, { signal: AbortSignal.timeout(10000) }),
    fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(10000) }),
  ]);
  const urlCount = ((await sitemap.text()).match(/<url>/g) || []).length;
  const localCount = (readFileSync(join(root, "public/sitemap.xml"), "utf8").match(/<url>/g) || []).length;
  record("frontend + sitemap", home.ok && sitemap.ok && urlCount === localCount,
    `home ${home.status}, sitemap ${urlCount} URLs (local has ${localCount}${urlCount === localCount ? " — in sync" : " — STALE FRONTEND"})`);
} catch (e) {
  record("frontend + sitemap", false, String(e));
}

// ---- 6. Prerendered SEO pages actually served (informational) ----
try {
  const r = await fetch(`${SITE}/industries/healthcare`, { signal: AbortSignal.timeout(10000) });
  const html = await r.text();
  const served = html.includes("x-prerendered");
  record("prerendered pages served", true, served
    ? "static HTML live — all crawlers see content"
    : "host serving SPA fallback — Google-only rendering (investigate hosting config)");
} catch (e) {
  record("prerendered pages served", false, String(e));
}

// ---- 7. Migrations APPLIED — critical DB objects reachable (PGRST202/205 = unapplied) ----
// The check that would have caught the benchmarks page, scan counter and outcome
// tracking silently offline for weeks. Add an entry here whenever a migration
// ships an RPC/table the app depends on.
const rpcState = async (name, body) => {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: hdrs, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
    return (await r.json().catch(() => ({})))?.code === "PGRST202" ? "MISSING" : "ok";
  } catch { return "error"; }
};
const tableState = async (name) => {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/${name}?select=count`, { headers: { ...hdrs, Prefer: "count=exact" }, signal: AbortSignal.timeout(15000) });
    return (await r.json().catch(() => ({})))?.code === "PGRST205" ? "MISSING" : "ok";
  } catch { return "error"; }
};
const dbObjects = {
  "get_scan_totals()": await rpcState("get_scan_totals"),
  "get_job_board_facets()": await rpcState("get_job_board_facets"),
  "get_public_scan_insights()": await rpcState("get_public_scan_insights"),
  "get_real_score_distribution()": await rpcState("get_real_score_distribution", { p_industry: "technology" }),
  "get_industry_score_benchmark()": await rpcState("get_industry_score_benchmark", { p_industry: "technology", p_score: 70 }),
  // A call (not a table check) so a PARTIALLY-applied migration — table present,
  // function missing, exactly what happened — is still caught. Writes one
  // identifiable probe row (report_id "deploy-verify-probe"); harmless.
  "record_scan_outcome()": await rpcState("record_scan_outcome", { p_report_id: "deploy-verify-probe", p_outcome: "interview", p_ip: "deploy-verify" }),
  "table scan_outcomes": await tableState("scan_outcomes"),
  "table job_board_postings": await tableState("job_board_postings"),
  "table user_job_searches": await tableState("user_job_searches"),
  // Behavioral, not just reachable: 20260721230000 redefined closed_90d as
  // genuine-tenure fills and made tracking_days the global log span, so even a
  // token with zero closures gets tracking_days >= 1; the old definition
  // returned 0 for it. Old definition live = repost churn is wearing the
  // "Actively hiring" badge with copy that claims tenure-vetted fills.
  "get_company_hiring_health() real-fills def": await (async () => {
    try {
      const r = await fetch(`${URL_BASE}/rest/v1/rpc/get_company_hiring_health`, { method: "POST", headers: hdrs, body: JSON.stringify({ p_tokens: ["deploy-verify-no-such-company"] }), signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => null);
      if (j?.code === "PGRST202") return "MISSING";
      return Array.isArray(j) && (j[0]?.tracking_days ?? 0) >= 1 ? "ok" : "MISSING";
    } catch { return "error"; }
  })(),
};
const dbMissing = Object.entries(dbObjects).filter(([, v]) => v === "MISSING").map(([k]) => k);
record("migrations applied (critical DB objects)", dbMissing.length === 0,
  dbMissing.length
    ? `NOT APPLIED: ${dbMissing.join(", ")} — run pending migrations in Lovable's SQL editor, then \`notify pgrst, 'reload schema'\``
    : `${Object.keys(dbObjects).length} objects reachable`);

// ---- Verdict ----
const failures = results.filter((r) => !r.ok);
console.log(failures.length === 0
  ? "\nALL CLEAR — publish verified."
  : `\n${failures.length} FAILURE(S) — do not walk away:\n${failures.map((f) => `  - ${f.name}: ${f.detail}`).join("\n")}`);
process.exit(failures.length === 0 ? 0 : 1);
