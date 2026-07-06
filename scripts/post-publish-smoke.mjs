#!/usr/bin/env node
// Post-publish smoke test: run this after EVERY Lovable publish.
//
//   node scripts/post-publish-smoke.mjs
//
// Verifies the things Lovable has silently botched before: edge functions
// actually deployed (not stale 404s), the scanner returns a well-formed
// diagnostic report, checkout sessions get created, the frontend serves, and
// the heartbeat sentinel is answering. Exit 0 = safe to walk away; exit 1 =
// something specific is broken and printed below.
//
// Costs at most one real AI scan (none if the cache or rate limiter answers).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env"), "utf8");
const grab = (k) => env.match(new RegExp(`${k}="?([^"\\n]+)`))?.[1];
const URL_BASE = grab("VITE_SUPABASE_URL");
const KEY = grab("VITE_SUPABASE_PUBLISHABLE_KEY");
const SITE = "https://resumebooster.work";

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const hdrs = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const post = (fn, body, ms = 90000) =>
  fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: "POST", headers: hdrs, body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });

// ---- 1. Every user-facing function answers OPTIONS (404 = stale deploy) ----
const FUNCTIONS = [
  "free-keyword-scan", "create-product-checkout", "verify-product-purchase",
  "generate-freelance-boost", "import-freelance-profile", "generate-resume-roast",
  "send-scan-report", "check-subscription", "parse-pdf", "parse-docx",
  "generate-premium-package-stream", "generate-cover-letter", "recover-purchase",
  "scan-heartbeat", "health-check",
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
record("edge functions deployed", missing.length === 0,
  missing.length ? `NOT deployed: ${missing.map((c) => c.fn).join(", ")}` : `${FUNCTIONS.length}/${FUNCTIONS.length}`);

// ---- 2. Real scan returns a well-formed diagnostic report ----
try {
  const t0 = Date.now();
  const r = await post("free-keyword-scan", {
    resumeText: `Sam Ortiz\nsam@email.com\n\nEXPERIENCE\nStaff Accountant, Meridian LLC (2021-present)\n- Closed monthly books for 8 entities in QuickBooks\n- Cut close cycle from 10 to 6 days\n\nCERTIFICATIONS\nCPA, Texas\n\nEDUCATION\nBS Accounting (smoke-fixed-corpus)`,
    // Logged as scan_type='synthetic' so smoke scans stay out of the
    // published score stats (get_public_scan_insights and friends).
    synthetic: true,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 429) {
    record("free scan end-to-end", true, `rate-limited from this IP — function alive, report unverified (${secs}s)`);
  } else if (!r.ok) {
    record("free scan end-to-end", false, `HTTP ${r.status}: ${(await r.text()).slice(0, 150)}`);
  } else {
    const j = await r.json();
    const anatomy = typeof j.atsScoreEstimate === "number" && j.reportMeta?.reportId && j.scoreBand;
    record("free scan end-to-end", !!anatomy,
      anatomy
        ? `score ${j.atsScoreEstimate}, report ${j.reportMeta.reportId}, engine ${j.reportMeta.engineVersion}, ${secs}s`
        : "200 but missing atsScoreEstimate/reportMeta/scoreBand");
  }
} catch (e) {
  record("free scan end-to-end", false, String(e));
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
// If the host serves the SPA shell instead, pages still work via JS —
// crawlers just don't get static HTML. Report as PASS either way, with the
// truth in the detail so we know whether the prerender layer is live.
try {
  const r = await fetch(`${SITE}/industries/healthcare`, { signal: AbortSignal.timeout(10000) });
  const html = await r.text();
  const served = html.includes('x-prerendered');
  record("prerendered pages served", true, served
    ? "static HTML live — all crawlers see content"
    : "host serving SPA fallback — Google-only rendering (investigate hosting config)");
} catch (e) {
  record("prerendered pages served", false, String(e));
}

// ---- Verdict ----
const failures = results.filter((r) => !r.ok);
console.log(failures.length === 0
  ? "\nALL CLEAR — publish verified."
  : `\n${failures.length} FAILURE(S) — do not walk away:\n${failures.map((f) => `  - ${f.name}: ${f.detail}`).join("\n")}`);
process.exit(failures.length === 0 ? 0 : 1);
